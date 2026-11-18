/**
 * Algorand: the pairing `x402/exact/algorand`, in which the payer signs an asset transfer whose note is the ATR hash's
 * LCP string, and the settlement read from an Indexer by the transaction id computed from the signed bytes.
 *
 * `algosdk` is an optional peer: this module loads it when present, and `build` writes the transactions with it. The
 * addresses and the payment entries are read without it, so the option filter, `advertise`, `read`, `bound`,
 * `reference` and `avmCarrier` need no peer, and `build` refuses `avm/peer-missing` only after every check that needs
 * none.
 *
 * @module
 */
import type * as Algosdk from "algosdk";
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { isAlgorandAddress, readEntry, type AvmEntry, type AvmPaymentPayload } from "./internal/avm.js";
import { advertiseFor, chosen, isAmount, isTimeoutSeconds, paymentWith, presentedWith, readFor, sameJson, x402Broadcaster, type X402Read, type X402Forms } from "./internal/x402.js";
import { fromBase64, toBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { ALGORAND } from "./internal/data/algorand.js";
import { x402Payee } from "./internal/payee.js";
import type { RecoverInput, StatusAnswer, StatusQuery } from "./internal/read.js";
import { avmRead } from "./internal/avm-read.js";
export { AVM_SEARCH_PAGES } from "./internal/avm-read.js";
import type { Entry } from "./internal/registry.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

const sdk: typeof Algosdk | null = await import("algosdk").then(
  (m) => m,
  () => null,
);

/** CAIP-2: the first 32 characters of the URL-safe base64 genesis hash. */
export type AlgorandNetwork = `algorand:${string}`;

/** The buyer's read of algod `GET /v2/transactions/params`. `genesisHash` is its base64. */
export interface AvmParams {
  firstValid: bigint;
  genesisHash: string;
  genesisId: string;
  minFee: bigint;
  feePerByte: bigint;
}

/** The x402 payload on Algorand. */
export interface AvmPresented {
  paymentIndex: number;
  paymentGroup: readonly string[];
}

/** An asset transfer's members, as the Indexer reports them under `asset-transfer-transaction`. */
export interface AvmAssetTransfer {
  /** `xaid`: `asset-id`. */
  assetId: bigint;
  /** `arcv`: `receiver`. */
  receiver: string;
  /** `aamt`: `amount`. */
  amount: bigint;
  /** `aclose`: `close-to`; null where unset. */
  closeTo: string | null;
  /** `close-amount`: what the close moved to `closeTo`; 0 where there is no close. */
  closeAmount: bigint;
  /** `asnd`: the asset transfer's `sender`, set only on a clawback; null where unset. */
  assetSender: string | null;
}

/** A transaction as the Indexer reports it, with the members the read needs. */
export interface AvmIndexed {
  /** `id`, the transaction id. An inner transaction carries its root's. */
  id: string;
  /** `confirmed-round`. */
  confirmedRound: bigint;
  /** `tx-type`: `axfer` for an asset transfer. */
  type: string;
  /** `sender`: `snd`. */
  sender: string;
  /** `auth-addr`: `sgnr`, the signer where it is not the sender; null where the signer is the sender. */
  authAddr: string | null;
  /** The member of `signature` that is set: `sig`, `multisig`, `logicsig` or `pqsig`; `none` on an inner transaction. */
  signature: "sig" | "multisig" | "logicsig" | "pqsig" | "none";
  /** `note`, decoded from its base64. */
  note: Uint8Array;
  /** `asset-transfer-transaction`, where `type` is `axfer`; null otherwise. */
  transfer: AvmAssetTransfer | null;
  /** `inner-txns`. */
  inner: readonly AvmIndexed[];
}

/** One page of an account's transactions, as the Indexer answers it. */
export interface AvmPage {
  /** The answer's `current-round`. */
  currentRound: bigint;
  /** The page's transactions, newest first; one the reader cannot parse is `{ unparseable: true, id }`, by its id. */
  transactions: readonly (AvmIndexed | { unparseable: true; id: string })[];
  /** `next-token`; absent on the page that holds no transaction. */
  next?: string;
}

/** Bounded, read-only calls against one network's Indexer. Every failure rejects. */
export interface AvmReader {
  readonly network: AlgorandNetwork;
  /** True where the Indexer is declared archival: it holds every round, so the history is shown without a read. */
  readonly archival?: boolean;
  /** `GET /v2/transactions?txid=…`: the answer's `current-round`, and the transaction, or null where it holds none. */
  transaction(txid: string): Promise<{ currentRound: bigint; found: AvmIndexed | null }>;
  /** `GET /v2/blocks/{round}?header-only=true`: true where it answers the block's header, false where it holds none. */
  header(round: bigint): Promise<boolean>;
  /** `GET /v2/accounts/{account}/transactions` with `min-round`, and `max-round` and `next` where given. */
  accountPage(account: string, q: { minRound: bigint; maxRound?: bigint; next?: string }): Promise<AvmPage>;
}

/**
 * The read keys `reference` returns, computed from the signed bytes with no network: the network, the transaction id,
 * its last valid round as a decimal string, H, the payer `snd`, the signer the payment entry names (`sgnr` where set,
 * else `snd`), and the option's payee.
 */
export interface AvmRef {
  network: AlgorandNetwork;
  txid: string;
  lastValid: string;
  /** The hash the payment's note carries: the search for H's key. */
  h: AtrHash;
  /** The payer, `snd`: the account whose transactions the search for H reads. */
  sender: string;
  /** The signer the presented entry names: `sgnr` where set, else `snd`. */
  signer: string;
  /** The option's `payTo`. */
  payee: string;
}

/**
 * The search's position: the round through which it is read whole, and, for a sub-range under way, its top and the
 * `next` token of the last page read.
 */
export interface AvmSearch {
  through: bigint;
  top?: bigint;
  next?: string;
}

/**
 * The answer of `avmStatus`: positions are confirmed rounds, the one mark is `final`, and the search's position is
 * `AvmSearch`. A `settled` answer states `presented`: `yes` where the act is the transaction the reference was built
 * from, `no` where it is another. Each transfer of what moved is named by its transaction id and its place, the member
 * naming the account it reached (`arcv`, or `aclose` for a holding closed to it).
 */
export type AvmStatus = StatusAnswer<bigint, "final", AvmSearch>;

/** The bytes the payer signs, and how the signature completes the payment. */
export interface AvmUnsigned {
  /** "TX" ‖ msgpack(txn) */
  request: { kind: "algorand-txn"; bytes: Uint8Array<ArrayBuffer> };
  /**
   * Completes the payment with the payer's 64-byte Ed25519 signature over `request.bytes`; a signature of any other
   * length is `avm/signature-malformed`.
   */
  complete(signature: Uint8Array): AvmPaymentPayload | Refusal;
}

const ID = "x402/exact/algorand" as const;
const NETWORK = /^algorand:([-_a-zA-Z0-9]{32})$/;
const ASSET = /^(0|[1-9][0-9]{0,19})$/;
const UINT64_LIMIT = 1n << 64n;
/**
 * A transaction id as `reference` writes it: the base32 of a 32-byte hash without padding, 52 characters, the last
 * holding one bit of the hash and four zero bits.
 */
const TXID = /^[A-Z2-7]{51}[AQ]$/;
/** The most transactions a payment group holds: x402's Algorand scheme's bound, the chain's own group size. */
export const AVM_MAX_GROUP = 16;
/**
 * lcp's own resource bound on one payment entry: at most 8,192 base64 characters, so that no entry costs more to read
 * than a signed asset transfer with the largest note the chain admits and a multisignature of many keys.
 */
export const AVM_MAX_ENTRY = 8192;
/**
 * lcp's own resource bound on a payment entry's note, 4,096 bytes, above the chain's 1,024, so that the reader refuses
 * no note algod could take and reads no unbounded one.
 */
export const AVM_MAX_NOTE = 4096;
/**
 * The longest a signed transaction stays payable, in rounds after its first valid round: the chain's maximum
 * transaction life, which lcp's client never exceeds when it sets the last valid round.
 */
export const AVM_MAX_LIFE = 1000;
const MAX_GROUP = AVM_MAX_GROUP;
const MAX_ENTRY = AVM_MAX_ENTRY;
const MAX_NOTE = AVM_MAX_NOTE;
const MAX_TXN_LIFE = BigInt(AVM_MAX_LIFE);
/**
 * A 64-byte signature that is not all zero bytes, which the encoding writes in full: the entry `build` checks is as
 * long as any `complete` writes.
 */
const FULL_SIGNATURE = new Uint8Array(64).fill(1);
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ENCODER = new TextEncoder();
/**
 * The deepest nesting of msgpack arrays and maps `avmCarrier` reads in a payment entry, the outermost container being
 * level 1. algod's signed transaction nests at most 10 (a state proof's reveal, down to a byte string written as an
 * array of numbers), so the cap refuses no entry algod decodes.
 */
export const MSGPACK_MAX_DEPTH = 32;

function uint64Of(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !ASSET.test(s)) return undefined;
  const v = BigInt(s);
  return v < UINT64_LIMIT ? v : undefined;
}

/**
 * The pairing's option filter: the option's scheme, network, asset, `payTo` and `extra` (its fee payer, no transfer
 * method, and no flow other than `"authorization"`), the amount `"0"` or a positive decimal (`isAmount`) below 2^64,
 * since the scheme sets no floor and the pairing's agreement floor is zero, and
 * `maxTimeoutSeconds` a positive safe integer, which `build` writes into the asset transfer and its last valid round.
 * `pairingOf`, `advertise`, `read` and `build` apply it, and `bound` and `reference` hold the option a presented payment
 * echoes to it. An `exact` option on an `algorand:` network is this pairing's; any other option is not. The `payTo` and
 * the fee payer are read as addresses' text (`isAlgorandAddress`: 58 characters of the base32 alphabet and the
 * checksum). Nothing here needs algosdk, so every answer is the same with it and without it.
 */
function check(o: PaymentRequirements): true | Refusal | undefined {
  if (!isObject(o) || typeof o.network !== "string" || !o.network.startsWith("algorand:")) return undefined;
  if (o.scheme !== "exact") return undefined;
  const extra = o.extra;
  if (extra !== undefined && !isObject(extra)) return refusal("avm/option-malformed");
  if (!NETWORK.test(o.network)) return refusal("avm/network-malformed");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("avm/option-malformed");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("avm/option-malformed");
  if (
    uint64Of(o.asset) === undefined ||
    !(isAmount(o.amount) || o.amount === "0") ||
    uint64Of(o.amount) === undefined ||
    !isTimeoutSeconds(o.maxTimeoutSeconds)
  ) {
    return refusal("avm/option-malformed");
  }
  const feePayer = extra?.["feePayer"];
  if (!isAlgorandAddress(o.payTo) || (feePayer !== undefined && !isAlgorandAddress(feePayer))) {
    return refusal("avm/option-malformed");
  }
  return true;
}

/**
 * The payment transaction of an x402 Algorand payload: `paymentGroup[paymentIndex]`, read as a signed asset transfer
 * whose note is an LCP string. Gives the hash, the transaction id and the last valid round. On the x402 path the entry
 * has two readers: the facilitator decodes it, and algod decodes the bytes the facilitator submits, which are the
 * entry's own. The entry is read only when it is one msgpack value nesting at most `MSGPACK_MAX_DEPTH` deep, algod's
 * decoder takes it as a signed transaction of a type algod knows with no member of another type set, the
 * facilitator's decoder takes it as an asset transfer, and both read the same signed transaction: their canonical
 * encodings are equal, and the facilitator can compute its id (it has a genesis hash). An entry a Falcon signature
 * (`pqsig`) authorises, which the facilitator's decoder does not read, is read by algod's decoder alone, where `pqsig` is
 * its one signature, Falcon-1024's, within go-codec's bounds. Any other entry is `avm/txn-malformed`, and one algod reads
 * as another type is `avm/not-axfer`. So a repeated scalar key, keys out of
 * order, a member written at its default, an integer or length in a longer format than it needs, a nil member, or a
 * binary and a string in each other's place reads as algod reads it, and the transaction id is the one algod computes,
 * from the transaction's canonical encoding. Where the two read different transactions the entry is refused: a
 * repeated struct whose earlier occurrences set a member the last one does not, which algod merges in and the
 * facilitator does not read, a repeated list whose elements algod decodes into those an earlier list left, and a
 * fixed-length byte member of another length. A byte member written as a msgpack string is read as its
 * bytes, whatever they are; a string member (`type`, `gen`) is refused when its bytes are not UTF-8, which the
 * facilitator reads as other text. Each answer is a function of the entry's bytes alone. Both readers are the package's
 * own (`readEntry`), so nothing here needs algosdk: every answer is the same without it. Then, the note carrying H, an
 * entry a logic signature authorises is `avm/logic-signature` and one that names an asset sender, `asnd`, is
 * `avm/clawback`: under a logic signature no key signs the transaction, and a transfer that names `asnd` is the act of
 * the asset's clawback address, so neither is the payer's signed act. Gives H, the transaction id, the last valid
 * round, the sender `snd` and the signer, `sgnr` where the payment entry names one and `snd` otherwise.
 */
export function avmCarrier(
  p: AvmPresented,
): { h: AtrHash; txid: string; lastValid: bigint; sender: string; signer: string } | Refusal {
  if (!isObject(p) || !Array.isArray(p.paymentGroup)) return refusal("avm/txn-malformed");
  const group = p.paymentGroup;
  if (group.length < 1 || group.length > MAX_GROUP) return refusal("avm/group-too-large");
  const i = p.paymentIndex;
  if (!Number.isSafeInteger(i) || i < 0 || i >= group.length) return refusal("avm/index-out-of-range");
  const read = paymentEntry(group[i]);
  if (isRefusal(read)) return read;
  let note: string;
  try {
    note = UTF8.decode(read.note);
  } catch {
    return refusal("avm/note-not-lcp");
  }
  const h = fromLcpString(note);
  if (h === null) return refusal("avm/note-not-lcp");
  if (read.logicSig) return refusal("avm/logic-signature");
  if (read.clawback) return refusal("avm/clawback");
  return { h, txid: read.txid, lastValid: read.lastValid, sender: read.sender, signer: read.authAddr ?? read.sender };
}

/**
 * One payment entry as `avmCarrier` reads it: base64 of at most `MAX_ENTRY` characters, read by `readEntry` within
 * `MSGPACK_MAX_DEPTH`, with a note of at most `MAX_NOTE` bytes. An entry algod reads as another transaction type is
 * `avm/not-axfer`; any other entry outside these bounds is `avm/txn-malformed`.
 */
function paymentEntry(entry: unknown): AvmEntry | Refusal {
  if (typeof entry !== "string" || entry.length > MAX_ENTRY) return refusal("avm/txn-malformed");
  const bytes = fromBase64(entry);
  if (bytes === null) return refusal("avm/txn-malformed");
  const read = readEntry(bytes, MSGPACK_MAX_DEPTH);
  if (read === "malformed") return refusal("avm/txn-malformed");
  if (read === "not-axfer") return refusal("avm/not-axfer");
  if (read.note.length > MAX_NOTE) return refusal("avm/txn-malformed");
  return read;
}

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(check)(doc, h, link, offer, agreementUrl);
}

/**
 * The buyer's reading of the challenge over the option filter (`readFor`). It needs no algosdk: every answer is the
 * same with it and without it.
 */
function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(check)(doc);
}

/** The URL-safe base64 of a standard base64 string, as CAIP-2's reference for Algorand is taken from. */
function urlSafe(s: string): string {
  return s.replaceAll("+", "-").replaceAll("/", "_");
}

/**
 * The asset transfer the payer signs, with the hash's LCP string as its note; with the option's fee payer, grouped
 * after that fee payer's zero payment, which carries both fees. The suggested parameters' genesis id is written as each
 * transaction's `gen`, a msgpack string, so one holding a lone surrogate, which UTF-8 cannot encode, is
 * `avm/option-malformed`. The payment entry is read as `avmCarrier` reads it, with a 64-byte signature in place, as
 * `complete` writes it, so `build` writes no payment `bound` refuses: an entry `avmCarrier` would refuse, one whose
 * base64 is longer than 8,192 characters included, is `avm/option-malformed`. H is checked first, then the form of
 * the choice's payer and suggested parameters: a payer that is not an address's text (`isAlgorandAddress`: 58
 * characters of the base32 alphabet and the checksum), or a parameter outside its type, is `avm/option-malformed`,
 * and a genesis hash that is not the base64 of 32 bytes `avm/network-mismatch`. Then the choice's document and the
 * option's place in it are checked, then the genesis hash against the option's network. None of those needs algosdk,
 * which writes the transactions after them: without it the choice is `avm/peer-missing` only then.
 */
async function build(
  c: { required: PaymentRequired; accepted: PaymentRequirements; payer: string; params: AvmParams },
  h: AtrHash,
): Promise<AvmUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("avm/option-malformed");
  const pr = c.params;
  if (
    !isAlgorandAddress(c.payer) ||
    !isObject(pr) ||
    typeof pr.firstValid !== "bigint" ||
    typeof pr.minFee !== "bigint" ||
    typeof pr.feePerByte !== "bigint" ||
    typeof pr.genesisId !== "string" ||
    !pr.genesisId.isWellFormed() ||
    pr.firstValid < 0n ||
    pr.minFee < 0n ||
    pr.feePerByte < 0n
  ) {
    return refusal("avm/option-malformed");
  }
  const gh = fromBase64(pr.genesisHash);
  if (gh === null || gh.length !== 32) return refusal("avm/network-mismatch");
  const ok = chosen(c.required, c.accepted, check);
  if (ok !== true) return ok;
  const { required, accepted } = c;
  if (urlSafe(pr.genesisHash).slice(0, 32) !== NETWORK.exec(accepted.network)![1]) return refusal("avm/network-mismatch");
  if (sdk === null) return refusal("avm/peer-missing");

  const firstValid = pr.firstValid;
  const lastValid = firstValid + (BigInt(accepted.maxTimeoutSeconds) < MAX_TXN_LIFE ? BigInt(accepted.maxTimeoutSeconds) : MAX_TXN_LIFE);
  const params = (fee: bigint, flatFee: boolean): Algosdk.SuggestedParams => ({
    flatFee,
    fee: flatFee ? fee : pr.feePerByte,
    minFee: pr.minFee,
    firstValid,
    lastValid,
    genesisID: pr.genesisId,
    genesisHash: gh,
  });
  const feePayer = isObject(accepted.extra) ? (accepted.extra["feePayer"] as string | undefined) : undefined;
  const axfer = (sp: Algosdk.SuggestedParams) =>
    sdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: c.payer,
      receiver: accepted.payTo,
      assetIndex: uint64Of(accepted.asset)!,
      amount: uint64Of(accepted.amount)!,
      note: ENCODER.encode(toLcpString(nh)),
      suggestedParams: sp,
    });

  let group: Algosdk.Transaction[];
  let paymentIndex: number;
  try {
    if (feePayer === undefined) {
      group = [axfer(params(0n, false))];
      paymentIndex = 0;
    } else {
      const zeroPay = (sp: Algosdk.SuggestedParams) =>
        sdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: feePayer,
          receiver: feePayer,
          amount: 0n,
          suggestedParams: sp,
        });
      const fee = zeroPay(params(0n, false)).fee + axfer(params(0n, false)).fee;
      group = [zeroPay(params(fee, true)), axfer(params(0n, true))];
      const groupId = sdk.computeGroupID(group);
      for (const txn of group) txn.group = groupId;
      paymentIndex = 1;
    }
  } catch {
    return refusal("avm/option-malformed");
  }
  const payment = group[paymentIndex]!;
  const signed = sdk.encodeMsgpack(new sdk.SignedTransaction({ txn: payment, sig: FULL_SIGNATURE }));
  if (isRefusal(paymentEntry(toBase64(signed)))) return refusal("avm/option-malformed");
  return {
    request: { kind: "algorand-txn", bytes: Uint8Array.from(payment.bytesToSign()) },
    complete(signature: Uint8Array): AvmPaymentPayload | Refusal {
      if (!(signature instanceof Uint8Array) || signature.length !== 64) return refusal("avm/signature-malformed");
      const paymentGroup = group.map((txn, i) =>
        toBase64(sdk.encodeMsgpack(new sdk.SignedTransaction(i === paymentIndex ? { txn, sig: signature.slice() } : { txn }))),
      );
      return paymentWith(required, accepted, { paymentIndex, paymentGroup });
    },
  };
}

/**
 * The hash inside what the payer signed: the payment transaction's note. The echoed option is held to the filter `read`
 * applies, so a payment under an option `read` would not offer is refused. The transaction's amount, receiver,
 * asset, fee payer and sender are not read, and no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const carried = carriedOf(presented);
  return isRefusal(carried) ? carried : carried.h;
}

/**
 * The read keys of the presented payment, from the signed bytes with no network: the network, the transaction id, the
 * last valid round, H, the payer `snd` and the signer, with the echoed option checked as `bound` checks it; and the
 * payee, the `payTo` of the option the payment answers. A payment whose `accepted` is not that option, compared as
 * RFC 8785 JSON, is `x402/accepted-not-option`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<AvmRef | Refusal> {
  const carried = carriedOf(presented);
  if (isRefusal(carried)) return carried;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const accepted = (presented as { accepted: PaymentRequirements }).accepted;
  if (!sameJson(accepted, option)) return refusal("x402/accepted-not-option");
  const network = accepted.network as AlgorandNetwork;
  const { h, txid, lastValid, sender, signer } = carried;
  return { network, txid, lastValid: lastValid.toString(), h, sender, signer, payee };
}

function carriedOf(presented: unknown): ReturnType<typeof avmCarrier> {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  return avmCarrier(p.payload as unknown as AvmPresented);
}

/**
 * The read of the payment by the transaction id and, where it decides, the search for H, as the profiles
 * `read-status` and `x402/exact/algorand/note` answer it. The facts the search rests on are not yet shown by a run, so
 * a search read whole answers `pending`, `search-incomplete`, where it would answer `failed`.
 */
export async function avmStatus(ref: AvmRef, reader: AvmReader, query: StatusQuery<AvmRef, bigint, "final", AvmSearch>): Promise<AvmStatus> {
  return avmRead(ref, reader, query);
}

/**
 * The hash from the landed payment's note, for anyone holding the transaction id. An input whose `tx` is not the 52
 * base32 characters of a 32-byte hash, or whose option is not an object, is `avm/wrong-reader`, with nothing read; the
 * option is not read further. One call.
 */
export async function avmRecover(
  input: RecoverInput<AlgorandNetwork, PaymentRequirements | MppChallenge>,
  reader: AvmReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("avm/wrong-reader");
  if (!isTxid(input.tx) || !isObject(input.option)) return refusal("avm/wrong-reader");
  let answer: Awaited<ReturnType<AvmReader["transaction"]>>;
  try {
    answer = await reader.transaction(input.tx);
  } catch {
    return refusal("avm/unreadable");
  }
  if (!isObject(answer) || typeof answer.currentRound !== "bigint") return refusal("avm/unreadable");
  if (answer.found === null) return refusal("avm/not-found");
  if (!isObject(answer.found) || !(answer.found.note instanceof Uint8Array)) return refusal("avm/unreadable");
  let note: string;
  try {
    note = UTF8.decode(answer.found.note);
  } catch {
    return refusal("avm/note-not-lcp");
  }
  return fromLcpString(note) ?? refusal("avm/note-not-lcp");
}

function isTxid(t: unknown): t is string {
  return typeof t === "string" && TXID.test(t);
}

/**
 * The option unchanged: the hash rides in the signed note, not in the option. An option that carries a `refused`
 * member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: "x402/exact/algorand/note",
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: true,
});

/**
 * `x402/exact/algorand`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
 * signed transaction `complete` returns; `status` reads it by the transaction id computed from the signed bytes.
 */
export const exactAvm = Object.freeze({
  id: ID,
  data: ALGORAND[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: avmStatus,
  recover: avmRecover,
}) satisfies Entry<
  typeof ID,
  AvmPaymentPayload,
  AvmRef,
  AvmReader,
  X402Forms & {
    choice: Parameters<typeof build>[0];
    unsigned: AvmUnsigned;
    landed: unknown;
    network: AlgorandNetwork;
    query: StatusQuery<AvmRef, bigint, "final", AvmSearch>;
    answer: AvmStatus;
  }
>;
