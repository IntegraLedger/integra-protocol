/**
 * Sui, and the `x402/exact/sui` pairing: the ATR hash as the one `Pure` input of the payer's programmable transaction
 * that no command uses. The payer's signature covers it, the rail executes the transaction unchanged, and the hash
 * stays on chain in the transaction's input list. Settlement is read by the transaction digest, which the signed
 * bytes fix before any money moves. BCS decoding uses @mysten/sui, loaded once when this module is, and decoding a
 * transaction's bytes is the one step that needs it: without it a function refuses `sui/peer-missing` only when it
 * reaches that step, after the checks that need no peer, `build` gives the request it gives with it, and `status` reads
 * as it does with it, pending `unreadable` only there. A digest is base58, read and written with the package's own
 * dependency @scure/base, so it is checked without the peer.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { base58 } from "@scure/base";
import type { bcs as SuiBcs } from "@mysten/sui/bcs";
import { fromRawBytes, toRawBytes, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import type { SuiPaymentPayload } from "./internal/sui.js";
import {
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  paymentWith,
  presentedWith,
  readFor,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { base64Bytes, decimalBelow, sameBytes, toBase64, U64_LIMIT } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { SUI } from "./internal/data/sui.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import { decide, type Facts, type RecoverInput, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import { actSeen, bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

const peer: { bcs: typeof SuiBcs } | undefined = await import("@mysten/sui/bcs").then(
  (b) => ({ bcs: b.bcs }),
  () => undefined,
);

export type SuiNetwork = "sui:mainnet" | "sui:testnet" | "sui:devnet";

/**
 * A decoded `TransactionData`: the bytes as received, their digest, the unused `Pure` inputs, and the epoch bound. `B`
 * is what its bytes are backed by: `decodeSuiTx` gives `SuiTx<ArrayBuffer>`, each byte field in its own fresh
 * `ArrayBuffer`, and `suiCarrier` takes any backing.
 */
export interface SuiTx<B extends ArrayBufferLike = ArrayBufferLike> {
  bytes: Uint8Array<B>;
  /** Base58 of Blake2b-256 over `"TransactionData::"` followed by the bytes. */
  digest: string;
  unusedPure: readonly Uint8Array<B>[];
  untilEpoch: bigint | null;
}

export interface SuiExecuted {
  transactionBcs: Uint8Array;
  status: "SUCCESS" | "FAILURE";
  checkpoint: bigint | null;
}

/**
 * Bounded, read-only calls against one network's GraphQL endpoint. Every failure rejects, for example with
 * `ReaderError` from `@integraledger/lcp/evm`; any rejection reads as unreadable. `read` is one request, so one
 * snapshot: `query($d:String!){transaction(digest:$d){transactionBcs effects{status checkpoint{sequenceNumber}}}
 * checkpoint{epoch{epochId}} serviceConfig{availableRange(type:"Query",field:"transaction"){first{sequenceNumber}}}}`.
 * `epoch` is the latest checkpoint's epoch. `firstCheckpoint` is the first checkpoint from which the endpoint holds
 * transactions (the available range's inclusive lower bound), or null when the endpoint states none.
 */
export interface SuiReader {
  readonly network: SuiNetwork;
  read(digest: string): Promise<{ tx: SuiExecuted | null; epoch: bigint; firstCheckpoint: bigint | null }>;
}

/** The read keys: the network, the digest, the epoch bound, and the payee, the `payTo` of the option the payment answers. */
export interface SuiRef {
  network: SuiNetwork;
  payee: string;
  digest: string;
  /** The last epoch the transaction can execute in, as a decimal string, or null when it sets no maximum epoch. */
  untilEpoch: string | null;
}

/**
 * The answer of `suiStatus`, as the profile `read-status` gives it. Its one mark is `final`, the effects of an executed
 * transaction, and its position the checkpoint sequence number.
 */
export type SuiStatus = StatusAnswer<bigint, SuiMark>;

type SuiMark = "final";
const MARKS: readonly SuiMark[] = ["final"];

/** What the read of the digest found; `holds`, whether the endpoint holds transactions from the position given. */
type SuiRead =
  | { state: "settled"; checkpoint: bigint | null }
  | { state: "pending"; why: "not-found"; holds: boolean }
  | { state: "failed"; why: "aborted"; checkpoint: bigint | null }
  | { state: "failed"; why: "expired" | "not-this-instrument" }
  | { state: "unreadable"; reason: UnreadableReason };

/** The payload x402's Sui scheme defines. */
export interface SuiPayload {
  signature: string;
  transaction: string;
}

/** What `build` hands the payer's wallet, and how it checks what comes back. */
export interface SuiUnsigned {
  request: {
    kind: "sui-transaction";
    accepted: PaymentRequirements;
    pureInput: Uint8Array<ArrayBuffer>;
    expiration: "epoch-bounded";
  };
  complete(signed: SuiPayload): SuiPaymentPayload | Refusal;
}

const ID = "x402/exact/sui" as const;
/** `max_tx_size_bytes`: 128 KiB. */
const MAX_TX_BYTES = 128 * 1024;
const NETWORKS: readonly string[] = ["sui:mainnet", "sui:testnet", "sui:devnet"];
const PAY_TO = /^0x[0-9a-f]{64}$/;
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const COIN_TYPE = new RegExp(`^0x[0-9a-fA-F]{1,64}::${IDENT}::${IDENT}$`);
const DIGEST_PREFIX = new TextEncoder().encode("TransactionData::");
/**
 * Sui's `max_type_argument_depth`, 16: Sui's transaction checks refuse a type with a node at that depth, the outermost
 * node at depth 1.
 */
const TYPE_DEPTH_LIMIT = 16;
const PRIMITIVE_TYPES: ReadonlySet<string> = new Set(["address", "bool", "signer", "u8", "u16", "u32", "u64", "u128", "u256"]);
/** A vector type and a struct type as @mysten/sui writes them, and reads them back to serialise them. */
const VECTOR_TYPE = /^vector<(.+)>$/;
const STRUCT_TYPE = /^([^:]+)::([^:]+)::([^<]+)(<(.+)>)?/;

/**
 * Decodes a base64 `TransactionData` V1 with a programmable kind. A programmable transaction with a type (a call's
 * type argument, a vector's element type, a funds withdrawal's type) that has a node at depth 16, Sui's type depth
 * limit, is `sui/tx-malformed`, the code of bytes that do not decode: @mysten/sui decodes a type by recursion, and the
 * bound gives the same answer whether this host's stack would hold the type or not. A V1 `TransactionData` of another
 * kind is `sui/not-programmable`, answered from its kind's tag before its body is decoded. The base64, the size bound
 * and the two tags are read without @mysten/sui: without it, bytes they refuse get the code they get with it, and any
 * other bytes are `sui/peer-missing`.
 */
export function decodeSuiTx(base64: string): SuiTx<ArrayBuffer> | Refusal {
  const bytes = base64Bytes(base64, MAX_TX_BYTES);
  if (bytes === "too-large") return refusal("sui/tx-too-large");
  if (bytes === "malformed") return refusal("sui/tx-malformed");
  // TransactionData opens with two BCS enum tags: its version, V1 (0), and its kind, ProgrammableTransaction (0), one
  // byte each. Both are read here, without the peer. V1 is the only version @mysten/sui reads: bytes that do not open
  // with its tag and a kind's do not decode. Another kind is answered from its tag before its body is decoded: the
  // bound below reads no type of it.
  if (bytes.length < 2 || bytes[0] !== 0) return refusal("sui/tx-malformed");
  if (bytes[1] !== 0) return refusal("sui/not-programmable");
  if (peer === undefined) return refusal("sui/peer-missing");
  const { bcs } = peer;

  let data: ReturnType<typeof SuiBcs.TransactionData.parse>;
  let epoch: bigint | null = null;
  try {
    data = bcs.TransactionData.parse(bytes);
    if (!typesOf(data).every(typeWithinDepth)) return refusal("sui/tx-malformed");
    // @mysten/sui reads an `Epoch` expiration as a JavaScript number, exact only up to 2^53 - 1, where Sui's epoch is
    // a u64. The expiration is the transaction's last field, so the epoch is read as a u64 from the last eight bytes,
    // and the round trip below holds only when those bytes are that field.
    let value: Parameters<typeof SuiBcs.TransactionData.serialize>[0] = data;
    if (data.$kind === "V1" && data.V1.expiration.$kind === "Epoch") {
      epoch = BigInt(bcs.U64.parse(bytes.subarray(bytes.length - 8)));
      value = { V1: { ...data.V1, expiration: { Epoch: epoch.toString() } } };
    }
    // BCS has one encoding per value: bytes that do not serialise back to themselves carry trailing or
    // non-canonical data.
    if (!sameBytes(bcs.TransactionData.serialize(value).toBytes(), bytes)) return refusal("sui/tx-malformed");
  } catch {
    return refusal("sui/tx-malformed");
  }
  if (data.$kind !== "V1") return refusal("sui/not-programmable");
  const v1 = data.V1;
  if (v1.kind.$kind !== "ProgrammableTransaction") return refusal("sui/not-programmable");
  const { inputs, commands } = v1.kind.ProgrammableTransaction;

  const used = new Set<number>();
  for (const command of commands) {
    for (const arg of commandArguments(command)) {
      if (arg.$kind === "Input") used.add(arg.Input);
    }
  }
  const unusedPure: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (input.$kind !== "Pure" || used.has(i)) continue;
    const b = base64Bytes(input.Pure.bytes, MAX_TX_BYTES);
    if (typeof b === "string") return refusal("sui/tx-malformed");
    unusedPure.push(b);
  }

  const exp = v1.expiration;
  let untilEpoch: bigint | null = null;
  if (exp.$kind === "Epoch") untilEpoch = epoch;
  else if (exp.$kind === "ValidDuring" && exp.ValidDuring.maxEpoch !== null) untilEpoch = BigInt(exp.ValidDuring.maxEpoch);
  else if (exp.$kind === "Validity" && exp.Validity.maxEpoch !== null) untilEpoch = BigInt(exp.Validity.maxEpoch);

  return { bytes, digest: suiDigest(bytes), unusedPure, untilEpoch };
}

/**
 * The hash carried by exactly one unused `Pure` input of exactly 32 bytes. A `tx` that is not a decoded transaction, an
 * object whose `unusedPure` is an array of `Uint8Array`s, is `sui/tx-malformed`.
 */
export function suiCarrier(tx: SuiTx): AtrHash | Refusal {
  if (!isObject(tx) || !Array.isArray(tx.unusedPure) || !tx.unusedPure.every((b) => b instanceof Uint8Array)) {
    return refusal("sui/tx-malformed");
  }
  if (tx.unusedPure.length === 0) return refusal("sui/hash-not-carried");
  if (tx.unusedPure.length > 1) return refusal("sui/ambiguous");
  const h = fromRawBytes(tx.unusedPure[0]!);
  return h === null ? refusal("sui/hash-not-carried") : h;
}

/**
 * Answers the read of the recorded digest as the profile `read-status` gives it. The digest is the single-use value:
 * Sui derives it from the signed bytes alone, so a transaction with it that executed, succeeded or not, consumed it. A
 * present transaction must be these bytes carrying this hash, else it carries no act that binds H; its effects' status
 * then decides: `SUCCESS` is the payer's act, and `FAILURE` the act included with a failed result, each at the one
 * mark `final` and at its checkpoint, where the effects name one. An absent transaction is past its validity once the
 * latest epoch is past its bound and the endpoint holds transactions from the position the query gives as `after`, or
 * earlier: such a position is at or before every checkpoint the payment could have executed in, such as the latest
 * checkpoint when the payment is requested. Otherwise it names no included act, since an endpoint that holds a shorter
 * history may have pruned a transaction that executed; one with no bound (a null `untilEpoch`) can execute in any later
 * epoch. The read holds no search for H, so none of these answers `failed` but `before-position`. A read that rejects
 * is unreadable `transport`; an answer out of the reader's form, bytes that do not hash to the digest, or, without
 * @mysten/sui, bytes that hash to the digest and that `decodeSuiTx` cannot read before the peer, are `unparseable`;
 * and a reader for another network than the ref's is `chain-mismatch`. A ref, a reader or a query that is not one, a
 * reader that names no network, a ref whose `digest` is not base58 of 32 bytes, whose `h` is not `0x` and 64 hex
 * digits, or whose `untilEpoch` is neither null nor a decimal string below 2^64, and an `after` that is not a
 * non-negative bigint, are unreadable `unparseable`, with nothing read. One call. Only the decode of a present
 * transaction's bytes needs @mysten/sui; every other answer is the one with it.
 */
export async function suiStatus(
  ref: SuiRef & { h: AtrHash },
  reader: SuiReader,
  query: StatusQuery<SuiRef & { h: AtrHash }, bigint, SuiMark>,
): Promise<SuiStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint" && p >= 0n)) return UNPARSEABLE;
  return decide(factsOf(await readSui(ref, reader, query.after), ref), query, LEDGER);
}

const LEDGER = ledgerOf<bigint, SuiMark>(SUI[ID].coverage, MARKS, bigintOrder);

async function readSui(ref: SuiRef & { h: AtrHash }, reader: SuiReader, position: bigint | undefined): Promise<SuiRead> {
  const unparseable = { state: "unreadable", reason: "unparseable" } as const;
  if (!isObject(ref) || !isObject(reader) || typeof reader.network !== "string") return unparseable;
  const untilEpoch = ref.untilEpoch === null ? null : decimalBelow(ref.untilEpoch, U64_LIMIT);
  const h = normalHash(ref.h);
  if (!NETWORKS.includes(ref.network) || untilEpoch === undefined || h === null || !isDigest(ref.digest)) return unparseable;
  if (reader.network !== ref.network) return { state: "unreadable", reason: "chain-mismatch" };
  const answer = await readOnce(reader, ref.digest);
  if (typeof answer === "string") return { state: "unreadable", reason: answer };
  const { tx, epoch, firstCheckpoint } = answer;
  if (tx === null) {
    const holds = position !== undefined && firstCheckpoint !== null && firstCheckpoint <= position;
    const expired = untilEpoch !== null && epoch > untilEpoch && holds;
    return expired ? { state: "failed", why: "expired" } : { state: "pending", why: "not-found", holds };
  }
  if (suiDigest(tx.transactionBcs) !== ref.digest) return unparseable;
  const decoded = decodeSuiTx(toBase64(tx.transactionBcs));
  if (isRefusal(decoded) && decoded.code === "sui/peer-missing") return unparseable;
  if (isRefusal(decoded)) return { state: "failed", why: "not-this-instrument" };
  const carried = suiCarrier(decoded);
  if (isRefusal(carried) || carried !== h) return { state: "failed", why: "not-this-instrument" };
  if (tx.status === "FAILURE") return { state: "failed", why: "aborted", checkpoint: tx.checkpoint };
  return { state: "settled", checkpoint: tx.checkpoint };
}

/**
 * The read's facts: the act where it executed, succeeded or failed, with the digest read consumed; the digest read
 * unconsumed with its validity passed where it expired; and nothing else, with the history the endpoint showed for a
 * transaction not found. The lookup by digest is never a search read whole.
 */
function factsOf(read: SuiRead, ref: SuiRef): Facts<bigint, SuiMark> {
  const none = { seen: [], search: { whole: false }, history: false } as const;
  const at = (checkpoint: bigint | null) => (checkpoint === null ? undefined : checkpoint);
  switch (read.state) {
    case "unreadable":
      return { ...none, unreadable: read.reason };
    case "settled":
      return { ...none, seen: [actSeen<bigint, SuiMark>(ref.digest, "final", at(read.checkpoint))] };
    case "pending":
      return { ...none, history: read.holds };
    case "failed":
      switch (read.why) {
        case "aborted":
          return {
            ...none,
            seen: [actSeen<bigint, SuiMark>(ref.digest, "final", at(read.checkpoint), "failed")],
            value: { consumed: true, lapsed: false, mark: "final" },
          };
        case "expired":
          return { ...none, history: true, value: { consumed: false, lapsed: true, mark: "final" } };
        case "not-this-instrument":
          return none;
      }
  }
}

/**
 * Reads the hash back from the executed transaction alone, by its digest, the input's `tx`; the input's `option` is
 * the option the payment answers, an object, of which the read needs no member. An input whose `tx` is not base58 of
 * 32 bytes, or whose option is not an object, is `sui/wrong-reader`, with nothing read. Bytes that do not hash to the
 * digest are `sui/unreadable`; bytes that do, and that `decodeSuiTx` refuses, give its refusal, as `suiStatus` reads
 * no act in them. Without @mysten/sui the transaction cannot be decoded: bytes that hash to the digest, of a
 * transaction that did not abort, are `sui/peer-missing`, after the input, the reader and the read are checked, which
 * need no peer. One call.
 */
export async function suiRecover(
  input: RecoverInput<SuiNetwork, PaymentRequirements | MppChallenge>,
  reader: SuiReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("sui/wrong-reader");
  if (!isDigest(input.tx) || !isObject(input.option)) return refusal("sui/wrong-reader");
  const answer = await readOnce(reader, input.tx);
  if (typeof answer === "string") return refusal("sui/unreadable");
  const { tx } = answer;
  if (tx === null) return refusal("sui/not-found");
  if (suiDigest(tx.transactionBcs) !== input.tx) return refusal("sui/unreadable");
  if (tx.status === "FAILURE") return refusal("sui/aborted");
  const decoded = decodeSuiTx(toBase64(tx.transactionBcs));
  if (isRefusal(decoded)) return decoded;
  return suiCarrier(decoded);
}

/** The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not. */
function suiOptionCheck(option: unknown): Refusal | undefined {
  if (!isObject(option) || option["scheme"] !== "exact") return refusal("x402/option-not-this-pairing");
  const network = option["network"];
  if (typeof network !== "string" || !network.startsWith("sui:")) return refusal("x402/option-not-this-pairing");
  if (!NETWORKS.includes(network)) return refusal("sui/network-malformed");
  const extra = option["extra"];
  if (extra !== undefined && !isObject(extra)) return refusal("x402/option-not-this-pairing");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  const payTo = option["payTo"];
  const asset = option["asset"];
  if (typeof payTo !== "string" || !PAY_TO.test(payTo)) return refusal("x402/option-not-this-pairing");
  if (typeof asset !== "string" || !COIN_TYPE.test(asset)) return refusal("x402/option-not-this-pairing");
  const amount = option["amount"];
  if (!isAmount(amount) || decimalBelow(amount, U64_LIMIT) === undefined) return refusal("x402/option-not-this-pairing");
  if (!isTimeoutSeconds(option["maxTimeoutSeconds"])) return refusal("x402/option-not-this-pairing");
  return undefined;
}

/** The filter step over `suiOptionCheck`. */
const suiFilter: OptionFilter = (o) => suiOptionCheck(o) ?? true;

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(suiFilter)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(suiFilter)(doc);
}

/**
 * The wallet request: the scheme's payment plus one unused `Pure` input holding the hash, bounded by epoch. H is checked
 * first, then the choice's document and option. The request is written without @mysten/sui, so `build` gives it with
 * the peer and without it. `complete` reads the signed transaction as `bound` does: one whose hash is not H, or that
 * `bound` refuses, is `x402/signed-not-bound`; without the peer, a transaction whose form, size and tags pass is
 * `sui/peer-missing`, as its decode is the one step that needs the peer.
 */
async function build(
  choice: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<SuiUnsigned | Refusal> {
  const expected = normalHash(h);
  if (expected === null) return refusal("x402/payload-malformed");
  const ok = chosen(choice?.required, choice?.accepted, suiFilter);
  if (ok !== true) return ok;
  const accepted = choice.accepted;
  const { required } = choice;
  return {
    request: { kind: "sui-transaction", accepted, pureInput: toRawBytes(expected), expiration: "epoch-bounded" },
    complete(signed: SuiPayload): SuiPaymentPayload | Refusal {
      const payment = paymentWith(required, accepted, signed);
      const got = boundNow(payment);
      if (isRefusal(got) && got.code === "sui/peer-missing") return got;
      if (isRefusal(got) || got !== expected) return refusal("x402/signed-not-bound");
      return payment;
    },
  };
}

/** The hash inside the transaction the payer signed. The signature is not verified here. */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  return boundNow(presented);
}

/**
 * The read keys for this payment: network, digest and the epoch bound, null for a transaction that sets none; and the
 * payee, the `payTo` of the option the payment answers.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<SuiRef | Refusal> {
  return referenceNow(presented, option);
}

function boundNow(presented: unknown): AtrHash | Refusal {
  const tx = presentedTx(presented);
  return isRefusal(tx) ? tx : suiCarrier(tx.tx);
}

function referenceNow(presented: unknown, option: PaymentRequirements): SuiRef | Refusal {
  const tx = presentedTx(presented);
  if (isRefusal(tx)) return tx;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const { digest, untilEpoch } = tx.tx;
  return { network: tx.network, payee, digest, untilEpoch: untilEpoch === null ? null : untilEpoch.toString() };
}

function presentedTx(presented: unknown): { network: SuiNetwork; tx: SuiTx } | Refusal {
  const parts = presentedWith(presented, suiFilter);
  if (isRefusal(parts)) return parts;
  const { signature, transaction } = parts.payload;
  if (typeof signature !== "string" || signature.length === 0) return refusal("x402/signature-malformed");
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  const tx = decodeSuiTx(transaction);
  if (isRefusal(tx)) return tx;
  return { network: parts.accepted.network as SuiNetwork, tx };
}

/**
 * The option unchanged: the hash rides in the transaction, not in the option. An option that carries a `refused` member
 * is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/sui`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator executes the
 * transaction the payer signed; `status` reads it by the digest the signed bytes fix.
 */
export const exactSui = Object.freeze({
  id: ID,
  data: SUI[ID],
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
  status: suiStatus,
  recover: suiRecover,
}) satisfies Entry<
  typeof ID,
  SuiPaymentPayload,
  SuiRef,
  SuiReader,
  X402Forms & {
    choice: { required: PaymentRequired; accepted: PaymentRequirements };
    unsigned: SuiUnsigned;
    landed: { h: AtrHash };
    network: SuiNetwork;
    query: StatusQuery<SuiRef & { h: AtrHash }, bigint, SuiMark>;
    answer: SuiStatus;
  }
>;

type ParsedCommand = ReturnType<typeof SuiBcs.Command.parse>;
type ParsedArgument = ReturnType<typeof SuiBcs.Argument.parse>;

/** Every argument a command names: the definition of "used" that Sui's own gasless check applies. */
function commandArguments(c: ParsedCommand): readonly ParsedArgument[] {
  switch (c.$kind) {
    case "MoveCall":
      return c.MoveCall.arguments;
    case "TransferObjects":
      return [...c.TransferObjects.objects, c.TransferObjects.address];
    case "SplitCoins":
      return [c.SplitCoins.coin, ...c.SplitCoins.amounts];
    case "MergeCoins":
      return [c.MergeCoins.destination, ...c.MergeCoins.sources];
    case "MakeMoveVec":
      return c.MakeMoveVec.elements;
    case "Upgrade":
      return [c.Upgrade.ticket];
    case "Publish":
      return [];
  }
}

/**
 * The types a programmable transaction carries: each call's type arguments, each vector's element type, and each funds
 * withdrawal's type. None for any other kind. Each is listed on its own, so the list takes constant stack however many
 * types a call carries.
 */
function typesOf(data: ReturnType<typeof SuiBcs.TransactionData.parse>): readonly string[] {
  if (data.$kind !== "V1" || data.V1.kind.$kind !== "ProgrammableTransaction") return [];
  const { inputs, commands } = data.V1.kind.ProgrammableTransaction;
  const out: string[] = [];
  for (const input of inputs) {
    if (input.$kind === "FundsWithdrawal") out.push(input.FundsWithdrawal.typeArg.Balance);
  }
  for (const command of commands) {
    if (command.$kind === "MoveCall") for (const type of command.MoveCall.typeArguments) out.push(type);
    else if (command.$kind === "MakeMoveVec" && command.MakeMoveVec.type !== null) out.push(command.MakeMoveVec.type);
  }
  return out;
}

/**
 * True when every node of `type`, as @mysten/sui writes a type, sits at a depth below `TYPE_DEPTH_LIMIT`. The walk
 * reads the text one level at a time the way @mysten/sui reads it back, keeps its own list and stops at the limit: a
 * primitive, `vector<T>`, or `address::module::name` followed by `<T, U, …>` when the struct has type parameters, split
 * on the commas outside angle brackets. Text that reads as no type is not within the limit.
 */
function typeWithinDepth(type: string): boolean {
  const todo: [string, number][] = [[type, 1]];
  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    const [t, depth] = next;
    if (depth >= TYPE_DEPTH_LIMIT) return false;
    if (PRIMITIVE_TYPES.has(t)) continue;
    const vector = VECTOR_TYPE.exec(t);
    if (vector !== null) {
      todo.push([vector[1]!, depth + 1]);
      continue;
    }
    const struct = STRUCT_TYPE.exec(t);
    if (struct === null) return false;
    if (struct[5] !== undefined) for (const p of typeParameters(struct[5])) todo.push([p, depth + 1]);
  }
  return true;
}

/** `a, b<c, d>` split on the commas outside angle brackets, each part trimmed. */
function typeParameters(s: string): string[] {
  const out: string[] = [];
  let level = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<") level++;
    else if (c === ">") level--;
    else if (c === "," && level === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/**
 * True for a transaction digest as `suiDigest` writes one: base58 of 32 bytes, at most 44 characters, as @mysten/sui's
 * `isValidTransactionDigest` reads it with the same base58.
 */
function isDigest(d: unknown): d is string {
  if (typeof d !== "string" || d.length > 44) return false;
  try {
    return base58.decode(d).length === 32;
  } catch {
    return false;
  }
}

/** The digest: base58 of the BLAKE2b-256 of `TransactionData::` and the bytes. */
function suiDigest(bytes: Uint8Array): string {
  const m = new Uint8Array(DIGEST_PREFIX.length + bytes.length);
  m.set(DIGEST_PREFIX, 0);
  m.set(bytes, DIGEST_PREFIX.length);
  return base58.encode(blake2b(m, { dkLen: 32 }));
}

/**
 * One read, with its answer's shape checked; `transport` for a failed read, `too-large` for transaction bytes over the
 * bound, and `unparseable` for any other malformed answer.
 */
async function readOnce(
  reader: SuiReader,
  digest: string,
): Promise<{ tx: SuiExecuted | null; epoch: bigint; firstCheckpoint: bigint | null } | "transport" | "unparseable" | "too-large"> {
  let answer: unknown;
  try {
    answer = await reader.read(digest);
  } catch {
    return "transport";
  }
  if (!isObject(answer) || typeof answer["epoch"] !== "bigint") return "unparseable";
  const epoch = answer["epoch"];
  const firstCheckpoint = answer["firstCheckpoint"];
  if (firstCheckpoint !== null && typeof firstCheckpoint !== "bigint") return "unparseable";
  const tx = answer["tx"];
  if (tx === null) return { tx: null, epoch, firstCheckpoint };
  if (!isObject(tx) || !(tx["transactionBcs"] instanceof Uint8Array)) return "unparseable";
  if (tx["status"] !== "SUCCESS" && tx["status"] !== "FAILURE") return "unparseable";
  if (tx["checkpoint"] !== null && typeof tx["checkpoint"] !== "bigint") return "unparseable";
  if (tx["transactionBcs"].length > MAX_TX_BYTES) return "too-large";
  return { tx: tx as unknown as SuiExecuted, epoch, firstCheckpoint };
}
