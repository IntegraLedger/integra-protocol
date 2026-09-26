/**
 * Sui, and the `x402/exact/sui` pairing: the ATR hash as the one `Pure` input of the payer's programmable transaction
 * that no command uses. The payer's signature covers it, the rail executes the transaction unchanged, and the hash
 * stays on chain in the transaction's input list. Settlement is read by the transaction digest, which the signed
 * bytes fix before any money moves. BCS decoding and base58 use @mysten/sui, loaded once when this module is; without it
 * every function that needs it refuses `sui/peer-missing`, and `status` reads as pending `unreadable`.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import type { bcs as SuiBcs } from "@mysten/sui/bcs";
import { fromRawBytes, toRawBytes, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { base64Bytes, decimalBelow, sameBytes, toBase64, U64_LIMIT } from "./rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  paymentWith,
  presentedWith,
  readFor,
  tie,
  type LcpPattern,
  type OptionFilter,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

const peer: { bcs: typeof SuiBcs; toBase58: (b: Uint8Array) => string } | undefined = await Promise.all([
  import("@mysten/sui/bcs"),
  import("@mysten/sui/utils"),
]).then(
  ([b, u]) => ({ bcs: b.bcs, toBase58: u.toBase58 }),
  () => undefined,
);

export type SuiNetwork = "sui:mainnet" | "sui:testnet" | "sui:devnet";

/** A decoded `TransactionData`: the bytes as received, their digest, the unused `Pure` inputs, and the epoch bound. */
export interface SuiTx {
  bytes: Uint8Array;
  /** Base58 of Blake2b-256 over `"TransactionData::"` followed by the bytes. */
  digest: string;
  unusedPure: readonly Uint8Array[];
  untilEpoch: bigint | null;
}

export interface SuiExecuted {
  transactionBcs: Uint8Array;
  status: "SUCCESS" | "FAILURE";
  checkpoint: bigint | null;
}

/**
 * Bounded, read-only calls against one network's GraphQL endpoint. Every failure rejects with `ReaderError`.
 * `read` is one request, so one snapshot:
 * `query($d:String!){transaction(digest:$d){transactionBcs effects{status checkpoint{sequenceNumber}}}
 * checkpoint{epoch{epochId}}}`, where the last field is the latest checkpoint's epoch.
 */
export interface SuiReader {
  readonly network: SuiNetwork;
  read(digest: string): Promise<{ tx: SuiExecuted | null; epoch: bigint }>;
}

export interface SuiRef {
  network: SuiNetwork;
  digest: string;
  /** The last epoch the transaction can execute in, as a decimal string. */
  untilEpoch: string;
}

export type SuiStatus =
  | { state: "settled"; checkpoint: bigint | null }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "aborted" | "expired" | "not-this-instrument" };

/** The payload x402's Sui scheme defines. */
export interface SuiPayload {
  signature: string;
  transaction: string;
}

export interface SuiPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: SuiPayload;
  extensions?: PaymentRequired["extensions"];
}

/** What `build` hands the payer's wallet, and how it checks what comes back. */
export interface SuiUnsigned {
  request: { kind: "sui-transaction"; accepted: PaymentRequirements; pureInput: Uint8Array; expiration: "epoch-bounded" };
  complete(signed: SuiPayload): SuiPaymentPayload | Refusal;
}

const ID = "x402/exact/sui" as const;
/** `max_tx_size_bytes`: 128 KiB. */
const MAX_TX_BYTES = 128 * 1024;
const MAX_SIGNATURE = 8192;
const NETWORKS: readonly string[] = ["sui:mainnet", "sui:testnet", "sui:devnet"];
const PAY_TO = /^0x[0-9a-f]{64}$/;
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const COIN_TYPE = new RegExp(`^0x[0-9a-fA-F]{1,64}::${IDENT}::${IDENT}$`);
const DIGEST_PREFIX = new TextEncoder().encode("TransactionData::");

/** Decodes a base64 `TransactionData` V1 with a programmable kind. */
export function decodeSuiTx(base64: string): SuiTx | Refusal {
  if (peer === undefined) return refusal("sui/peer-missing");
  const { bcs } = peer;
  const bytes = base64Bytes(base64, MAX_TX_BYTES);
  if (bytes === "too-large") return refusal("sui/tx-too-large");
  if (bytes === "malformed") return refusal("sui/tx-malformed");

  let data: ReturnType<typeof SuiBcs.TransactionData.parse>;
  try {
    data = bcs.TransactionData.parse(bytes);
    // BCS has one encoding per value: bytes that do not serialise back to themselves carry trailing or
    // non-canonical data.
    if (!sameBytes(bcs.TransactionData.serialize(data).toBytes(), bytes)) return refusal("sui/tx-malformed");
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
  const unusedPure: Uint8Array[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (input.$kind !== "Pure" || used.has(i)) continue;
    const b = base64Bytes(input.Pure.bytes, MAX_TX_BYTES);
    if (typeof b === "string") return refusal("sui/tx-malformed");
    unusedPure.push(b);
  }

  const exp = v1.expiration;
  let untilEpoch: bigint | null = null;
  if (exp.$kind === "Epoch") untilEpoch = BigInt(exp.Epoch);
  else if (exp.$kind === "ValidDuring" && exp.ValidDuring.maxEpoch !== null) untilEpoch = BigInt(exp.ValidDuring.maxEpoch);
  else if (exp.$kind === "Validity" && exp.Validity.maxEpoch !== null) untilEpoch = BigInt(exp.Validity.maxEpoch);

  return { bytes, digest: suiDigest(bytes)!, unusedPure, untilEpoch };
}

/** The hash carried by exactly one unused `Pure` input of exactly 32 bytes. */
export function suiCarrier(tx: SuiTx): AtrHash | Refusal {
  if (tx.unusedPure.length === 0) return refusal("sui/hash-not-carried");
  if (tx.unusedPure.length > 1) return refusal("sui/ambiguous");
  const h = fromRawBytes(tx.unusedPure[0]!);
  return h === null ? refusal("sui/hash-not-carried") : h;
}

/**
 * Reads the recorded digest. A failed read, or a reader for another network, is pending. An absent transaction is
 * expired once the latest epoch is past its bound; a present one must be these bytes carrying this hash, and its
 * effects' status decides. One call.
 */
export async function suiStatus(ref: SuiRef & { h: AtrHash }, reader: SuiReader): Promise<SuiStatus> {
  if (peer === undefined || reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  const untilEpoch = decimalBelow(ref.untilEpoch, U64_LIMIT);
  if (untilEpoch === undefined) return { state: "pending", why: "unreadable" };
  const answer = await readOnce(reader, ref.digest);
  if (answer === null) return { state: "pending", why: "unreadable" };
  const { tx, epoch } = answer;
  if (tx === null) {
    return epoch > untilEpoch ? { state: "failed", why: "expired" } : { state: "pending", why: "not-found" };
  }
  if (suiDigest(tx.transactionBcs) !== ref.digest) return { state: "pending", why: "unreadable" };
  const decoded = decodeSuiTx(toBase64(tx.transactionBcs));
  if (isRefusal(decoded)) return { state: "failed", why: "not-this-instrument" };
  const carried = suiCarrier(decoded);
  const h = normalHash(ref.h);
  if (isRefusal(carried) || h === null || carried !== h) return { state: "failed", why: "not-this-instrument" };
  if (tx.status === "FAILURE") return { state: "failed", why: "aborted" };
  return { state: "settled", checkpoint: tx.checkpoint };
}

/** Reads the hash back from the executed transaction alone, by its digest. One call. */
export async function suiRecover(
  ref: { network: SuiNetwork; digest: string },
  reader: SuiReader,
): Promise<AtrHash | Refusal> {
  if (peer === undefined) return refusal("sui/peer-missing");
  if (reader.network !== ref.network) return refusal("sui/wrong-reader");
  const answer = await readOnce(reader, ref.digest);
  if (answer === null) return refusal("sui/unreadable");
  const { tx } = answer;
  if (tx === null) return refusal("sui/not-found");
  if (suiDigest(tx.transactionBcs) !== ref.digest) return refusal("sui/unreadable");
  if (tx.status === "FAILURE") return refusal("sui/aborted");
  const decoded = decodeSuiTx(toBase64(tx.transactionBcs));
  if (isRefusal(decoded)) return refusal("sui/unreadable");
  return suiCarrier(decoded);
}

/** The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not. */
export function suiOptionCheck(option: unknown): Refusal | undefined {
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
  if (decimalBelow(option["amount"], U64_LIMIT) === undefined) return refusal("x402/option-not-this-pairing");
  return undefined;
}

/** The filter step over `suiOptionCheck`. */
const suiFilter: OptionFilter = (o) => suiOptionCheck(o) ?? true;

/** This pairing's id for an option it can pay, or undefined. */
export function suiPairingOf(option: PaymentRequirements): typeof ID | undefined {
  return suiOptionCheck(option) === undefined ? ID : undefined;
}

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

/** The wallet request: the scheme's payment plus one unused `Pure` input holding the hash, bounded by epoch. */
async function build(
  choice: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<SuiUnsigned | Refusal> {
  if (peer === undefined) return refusal("sui/peer-missing");
  const ok = chosen(choice?.required, choice?.accepted, suiFilter);
  if (ok !== true) return ok;
  const accepted = choice.accepted;
  const expected = normalHash(h);
  if (expected === null) return refusal("x402/payload-malformed");
  const { required } = choice;
  return {
    request: { kind: "sui-transaction", accepted, pureInput: toRawBytes(expected), expiration: "epoch-bounded" },
    complete(signed: SuiPayload): SuiPaymentPayload | Refusal {
      const payment = paymentWith(required, accepted, signed);
      const got = boundNow(payment);
      if (isRefusal(got) || got !== expected || isRefusal(referenceNow(payment))) {
        return refusal("x402/signed-not-bound");
      }
      return payment;
    },
  };
}

/** The hash inside the transaction the payer signed. The signature is not verified here. */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  return boundNow(presented);
}

/** The read keys for this payment: network, digest and the epoch bound. */
async function reference(presented: unknown): Promise<SuiRef | Refusal> {
  return referenceNow(presented);
}

function boundNow(presented: unknown): AtrHash | Refusal {
  const tx = presentedTx(presented);
  return isRefusal(tx) ? tx : suiCarrier(tx.tx);
}

function referenceNow(presented: unknown): SuiRef | Refusal {
  const tx = presentedTx(presented);
  if (isRefusal(tx)) return tx;
  if (tx.tx.untilEpoch === null) return refusal("sui/expiration-unbounded");
  return { network: tx.network, digest: tx.tx.digest, untilEpoch: tx.tx.untilEpoch.toString() };
}

function presentedTx(presented: unknown): { network: SuiNetwork; tx: SuiTx } | Refusal {
  const parts = presentedWith(presented, suiFilter);
  if (isRefusal(parts)) return parts;
  const { signature, transaction } = parts.payload;
  if (typeof signature !== "string" || signature.length === 0 || signature.length > MAX_SIGNATURE) {
    return refusal("x402/signature-malformed");
  }
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  const tx = decodeSuiTx(transaction);
  if (isRefusal(tx)) return tx;
  return { network: parts.accepted.network as SuiNetwork, tx };
}

/** The option unchanged: the hash rides in the transaction, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: ID,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a Sui transaction whose one unused Pure input is this ATR's hash. The network executed that " +
    "transaction successfully, and the hash is on chain in its input list, readable by its digest while a node " +
    "retains it. This does not show that amount, payee, coin type or timing match the ATR's content.",
});

export const exactSui = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: suiStatus,
  recover: suiRecover,
});

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

/** The digest, or undefined without the peer. */
function suiDigest(bytes: Uint8Array): string | undefined {
  if (peer === undefined) return undefined;
  const m = new Uint8Array(DIGEST_PREFIX.length + bytes.length);
  m.set(DIGEST_PREFIX, 0);
  m.set(bytes, DIGEST_PREFIX.length);
  return peer.toBase58(blake2b(m, { dkLen: 32 }));
}

/** One read, with its answer's shape checked; null for a failed read or a malformed answer. */
async function readOnce(
  reader: SuiReader,
  digest: string,
): Promise<{ tx: SuiExecuted | null; epoch: bigint } | null> {
  let answer: unknown;
  try {
    answer = await reader.read(digest);
  } catch {
    return null;
  }
  if (!isObject(answer) || typeof answer["epoch"] !== "bigint") return null;
  const tx = answer["tx"];
  if (tx === null) return { tx: null, epoch: answer["epoch"] };
  if (!isObject(tx) || !(tx["transactionBcs"] instanceof Uint8Array)) return null;
  if (tx["status"] !== "SUCCESS" && tx["status"] !== "FAILURE") return null;
  if (tx["checkpoint"] !== null && typeof tx["checkpoint"] !== "bigint") return null;
  if (tx["transactionBcs"].length > MAX_TX_BYTES) return null;
  return { tx: tx as unknown as SuiExecuted, epoch: answer["epoch"] };
}
