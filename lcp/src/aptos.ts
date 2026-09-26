/**
 * Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer
 * carries the ATR hash, so the hash is advertised in the challenge, read back from the echoed extension, and tied to
 * the payment by the seller's claim. The settlement is found by the payer's sender and sequence number, and identified
 * by a digest of the transfer the payer signed.
 */
import { digestJson, parseJson, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { base64Bytes, decimalBelow, hexOf, U64_LIMIT } from "./rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  legalContextOf,
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

/** CAIP-2: `aptos:` and the numeric chain id. */
export type AptosNetwork = `aptos:${number}`;

/** The transfer the payer signed, in one normal form shared by the signed bytes and the chain's REST answer. */
export interface AptosInstrument {
  sender: Hex;
  sequenceNumber: bigint;
  expiresAt: bigint;
  chainId: number;
  function: string;
  typeArguments: readonly string[];
  arguments: readonly string[];
}

/** A committed user transaction as the REST API returns it. */
export interface AptosCommitted {
  type: "user_transaction";
  hash: string;
  version: string;
  success: boolean;
  sender: string;
  sequence_number: string;
  expiration_timestamp_secs: string;
  payload: { type: string; function: string; type_arguments: string[]; arguments: unknown[] };
}

/** Bounded, read-only calls against one network's REST endpoint. Every failure rejects with `ReaderError`. */
export interface AptosReader {
  readonly network: AptosNetwork;
  /** `GET /v1/transactions/by_hash/{hash}`; null on 404. */
  byHash(hash: Hex): Promise<AptosCommitted | { type: "pending_transaction" } | null>;
  /** `GET /v1/accounts/{sender}/transactions?start=n&limit=1`, kept only when its `sequence_number` is n. */
  bySequence(sender: Hex, n: bigint): Promise<AptosCommitted | null>;
  /** `GET /v1`. */
  ledger(): Promise<{ chainId: number; timestampUsecs: bigint }>;
}

export interface AptosRef {
  network: AptosNetwork;
  sender: Hex;
  /** Decimal strings. */
  sequenceNumber: string;
  expiresAt: string;
  idDigest: Hex;
  /** The facilitator's transaction hash, once named. */
  transaction?: Hex;
}

export type AptosStatus =
  | { state: "settled"; version: bigint; transaction: Hex }
  | { state: "pending"; why: "not-found" | "in-mempool" | "unreadable" }
  | { state: "failed"; why: "aborted" | "superseded" | "expired" };

export interface AptosPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string };
  extensions?: PaymentRequired["extensions"];
}

export interface AptosUnsigned {
  request: { kind: "aptos-transaction"; accepted: PaymentRequirements };
  complete(signed: { transaction: string }): AptosPaymentPayload | Refusal;
}

const ID = "x402/exact/aptos" as const;
/** `max_transaction_size_in_bytes`: 64 KiB. */
const MAX_TX_BYTES = 64 * 1024;
const NETWORK = /^aptos:([1-9][0-9]{0,2})$/;
const ADDRESS_64 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_ANY = /^0x[0-9a-fA-F]{1,64}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
const ENTRY_FUNCTION = 2;
const TYPE_TAG_STRUCT = 7;
const FRAMEWORK = "0x" + "0".repeat(63) + "1";
const TRANSFERS: readonly string[] = [
  `${FRAMEWORK}::primary_fungible_store::transfer`,
  `${FRAMEWORK}::fungible_asset::transfer`,
];

/**
 * Reads the `RawTransaction` prefix of a base64 transaction, in either wire form: the scheme's BCS bytes, or x402's
 * reference form, base64 of the JSON `{"transaction": [bytes], "senderAuthenticator": [bytes]}`. Only an entry
 * function call to a framework fungible-asset transfer is accepted.
 */
export function decodeAptosTx(transaction: string): AptosInstrument | Refusal {
  const decoded = base64Bytes(transaction, MAX_TX_BYTES);
  if (decoded === "too-large") return refusal("aptos/tx-too-large");
  if (decoded === "malformed") return refusal("aptos/tx-malformed");
  const bytes = referenceForm(decoded) ?? decoded;
  const r = new Reader(bytes);
  try {
    const sender = hexOf(r.bytes(32));
    const sequenceNumber = r.u64();
    if (r.uleb() !== ENTRY_FUNCTION) return refusal("aptos/not-entry-function");
    const moduleAddress = hexOf(r.bytes(32));
    const module = r.ident();
    const name = r.ident();
    const fn = `${moduleAddress}::${module}::${name}`;
    const typeArgCount = r.uleb();
    if (!TRANSFERS.includes(fn) || typeArgCount !== 1) return refusal("aptos/not-an-x402-transfer");
    if (r.uleb() !== TYPE_TAG_STRUCT) return refusal("aptos/not-an-x402-transfer");
    const typeArgument = `${hexOf(r.bytes(32))}::${r.ident()}::${r.ident()}`;
    if (r.uleb() !== 0) return refusal("aptos/not-an-x402-transfer");
    if (r.uleb() !== 3) return refusal("aptos/not-an-x402-transfer");
    const first = r.bytes(r.uleb());
    const second = r.bytes(r.uleb());
    const amount = r.bytes(r.uleb());
    if (first.length !== 32 || second.length !== 32 || amount.length !== 8) return refusal("aptos/not-an-x402-transfer");
    r.u64();
    r.u64();
    const expiresAt = r.u64();
    const chainId = r.u8();
    return {
      sender,
      sequenceNumber,
      expiresAt,
      chainId,
      function: fn,
      typeArguments: [typeArgument],
      arguments: [hexOf(first), hexOf(second), leU64(amount).toString()],
    };
  } catch {
    return refusal("aptos/tx-malformed");
  }
}

/** SHA-256 over the RFC 8785 form of `{sender, sequenceNumber, function, typeArguments, arguments}`. */
export async function aptosIdDigest(i: AptosInstrument): Promise<Hex | Refusal> {
  return digestJson({
    sender: i.sender,
    sequenceNumber: i.sequenceNumber.toString(),
    function: i.function,
    typeArguments: [...i.typeArguments],
    arguments: [...i.arguments],
  });
}

/**
 * The REST answer in the normal form: every address as `0x` and 64 lowercase hex, `{"inner": a}` as `a`, and the
 * amount as its decimal string. The REST answer carries no chain id, so the caller supplies the ledger's.
 */
export function committedInstrument(t: AptosCommitted, chainId: number): AptosInstrument | Refusal {
  if (!isCommitted(t) || t.payload.type !== "entry_function_payload") return refusal("aptos/not-an-x402-transfer");
  const sender = longAddress(t.sender);
  const sequenceNumber = decimalBelow(t.sequence_number, U64_LIMIT);
  const expiresAt = decimalBelow(t.expiration_timestamp_secs, U64_LIMIT);
  const fn = moveName(t.payload.function);
  const types = t.payload.type_arguments;
  const args = t.payload.arguments;
  if (sender === null || sequenceNumber === undefined || expiresAt === undefined || fn === null) {
    return refusal("aptos/not-an-x402-transfer");
  }
  if (!Array.isArray(types) || types.length !== 1 || !Array.isArray(args) || args.length !== 3) {
    return refusal("aptos/not-an-x402-transfer");
  }
  const typeArgument = moveName(types[0]);
  const first = longAddress(objectAddress(args[0]));
  const second = longAddress(objectAddress(args[1]));
  const amount = decimalBelow(args[2], U64_LIMIT);
  if (typeArgument === null || first === null || second === null || amount === undefined) {
    return refusal("aptos/not-an-x402-transfer");
  }
  return {
    sender,
    sequenceNumber,
    expiresAt,
    chainId,
    function: fn,
    typeArguments: [typeArgument],
    arguments: [first, second, amount.toString()],
  };
}

/**
 * Finds the payer's transaction by the facilitator's hash when named, else by sender and sequence number, and
 * identifies it by the transfer's digest. Only `success` decides a committed, matching transaction. A failed read,
 * or a reader for another network, is pending. At most three calls.
 */
export async function aptosStatus(ref: AptosRef, reader: AptosReader): Promise<AptosStatus> {
  const unreadable = { state: "pending", why: "unreadable" } as const;
  const chainId = chainOf(ref.network);
  if (reader.network !== ref.network || chainId === undefined) return unreadable;
  const sequenceNumber = decimalBelow(ref.sequenceNumber, U64_LIMIT);
  const expiresAt = decimalBelow(ref.expiresAt, U64_LIMIT);
  if (sequenceNumber === undefined || expiresAt === undefined) return unreadable;
  try {
    const ledger = await reader.ledger();
    if (!isObject(ledger) || ledger.chainId !== chainId || typeof ledger.timestampUsecs !== "bigint") return unreadable;

    if (ref.transaction !== undefined) {
      const named = await reader.byHash(ref.transaction);
      if (named !== null && !isObject(named)) return unreadable;
      if (named !== null && named.type === "pending_transaction") return { state: "pending", why: "in-mempool" };
      if (named !== null) {
        if (!isCommitted(named)) return unreadable;
        if (await matches(named, ref, chainId)) return decided(named);
      }
    }

    const found = await reader.bySequence(ref.sender, sequenceNumber);
    if (found === null) {
      return ledger.timestampUsecs / 1_000_000n > expiresAt
        ? { state: "failed", why: "expired" }
        : { state: "pending", why: "not-found" };
    }
    if (!isCommitted(found)) return unreadable;
    if (longAddress(found.sender) !== ref.sender.toLowerCase() || found.sequence_number !== sequenceNumber.toString()) {
      return unreadable;
    }
    if (!(await matches(found, ref, chainId))) return { state: "failed", why: "superseded" };
    return decided(found);
  } catch {
    return unreadable;
  }
}

/** The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not. */
export function aptosOptionCheck(option: unknown): Refusal | undefined {
  if (!isObject(option) || option["scheme"] !== "exact") return refusal("x402/option-not-this-pairing");
  const network = option["network"];
  if (typeof network !== "string" || !network.startsWith("aptos:")) return refusal("x402/option-not-this-pairing");
  if (chainOf(network) === undefined) return refusal("aptos/network-malformed");
  const extra = option["extra"];
  if (extra !== undefined && !isObject(extra)) return refusal("x402/option-not-this-pairing");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  const asset = option["asset"];
  const payTo = option["payTo"];
  if (typeof asset !== "string" || !ADDRESS_64.test(asset)) return refusal("x402/option-not-this-pairing");
  if (typeof payTo !== "string" || !ADDRESS_64.test(payTo)) return refusal("x402/option-not-this-pairing");
  if (decimalBelow(option["amount"], U64_LIMIT) === undefined) return refusal("x402/option-not-this-pairing");
  return undefined;
}

/** The filter step over `aptosOptionCheck`. */
const aptosFilter: OptionFilter = (o) => aptosOptionCheck(o) ?? true;

/** This pairing's id for an option it can pay, or undefined. */
export function aptosPairingOf(option: PaymentRequirements): typeof ID | undefined {
  return aptosOptionCheck(option) === undefined ? ID : undefined;
}

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(aptosFilter)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(aptosFilter)(doc);
}

/** The wallet request: the scheme's own payment, which carries no hash. */
async function build(
  choice: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<AptosUnsigned | Refusal> {
  const ok = chosen(choice?.required, choice?.accepted, aptosFilter);
  if (ok !== true) return ok;
  const accepted = choice.accepted;
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  const { required } = choice;
  return {
    request: { kind: "aptos-transaction", accepted },
    complete(signed: { transaction: string }): AptosPaymentPayload | Refusal {
      const payment = paymentWith(required, accepted, signed);
      return isRefusal(instrumentOf(payment)) ? refusal("x402/signed-not-bound") : payment;
    },
  };
}

/** The hash in the echoed, unsigned `extensions.legalContext`; the seller's claim ties it to this request. */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const parts = presentedWith(presented, aptosFilter);
  if (isRefusal(parts)) return parts;
  if (typeof parts.payload["transaction"] !== "string") return refusal("x402/payload-malformed");
  const lc = legalContextOf(parts.extensions);
  return isRefusal(lc) ? refusal("x402/no-legal-context") : lc.h;
}

/** The read keys for this payment: sender, sequence number, expiry, and the transfer's digest. */
async function reference(presented: unknown): Promise<AptosRef | Refusal> {
  const found = instrumentOf(presented);
  if (isRefusal(found)) return found;
  const idDigest = await aptosIdDigest(found.instrument);
  if (isRefusal(idDigest)) return idDigest;
  const i = found.instrument;
  return {
    network: found.network,
    sender: i.sender,
    sequenceNumber: i.sequenceNumber.toString(),
    expiresAt: i.expiresAt.toString(),
    idDigest,
  };
}

function instrumentOf(presented: unknown): { network: AptosNetwork; instrument: AptosInstrument } | Refusal {
  const parts = presentedWith(presented, aptosFilter);
  if (isRefusal(parts)) return parts;
  const transaction = parts.payload["transaction"];
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  const instrument = decodeAptosTx(transaction);
  if (isRefusal(instrument)) return instrument;
  const network = parts.accepted.network as AptosNetwork;
  if (instrument.chainId !== chainOf(network)) return refusal("aptos/chain-mismatch");
  return { network, instrument };
}

/** The option unchanged: nothing of the hash rides in it. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "http-advisory",
  canonical: true,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
    "recorded in <transaction>. " +
    "The ATR was assembled and written to the seller's storage before the challenge went out, and the challenge " +
    "advertised its hash and link. The payer's signed Aptos transaction does not carry the hash. The seller " +
    "tied the hash to this payment when it claimed it for this request, and identified the settlement as " +
    "the payer's committed transaction by sender, sequence number and a digest of its transfer. This does not show " +
    "that the buyer's approval carried the hash, or that amount, payee, asset or timing match the ATR's content.",
});

export const exactAptos = Object.freeze({
  id: ID,
  pattern,
  claims: false as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: aptosStatus,
});

async function matches(t: AptosCommitted, ref: AptosRef, chainId: number): Promise<boolean> {
  const i = committedInstrument(t, chainId);
  if (isRefusal(i)) return false;
  const d = await aptosIdDigest(i);
  return !isRefusal(d) && d === ref.idDigest.toLowerCase();
}

function decided(t: AptosCommitted): AptosStatus {
  const version = decimalBelow(t.version, U64_LIMIT);
  const hash = normalHash(t.hash);
  if (version === undefined || hash === null) return { state: "pending", why: "unreadable" };
  return t.success ? { state: "settled", version, transaction: hash } : { state: "failed", why: "aborted" };
}

function isCommitted(t: unknown): t is AptosCommitted {
  if (!isObject(t) || t["type"] !== "user_transaction") return false;
  const p = t["payload"];
  return (
    typeof t["hash"] === "string" &&
    typeof t["version"] === "string" &&
    typeof t["success"] === "boolean" &&
    typeof t["sender"] === "string" &&
    typeof t["sequence_number"] === "string" &&
    typeof t["expiration_timestamp_secs"] === "string" &&
    isObject(p) &&
    typeof p["type"] === "string" &&
    typeof p["function"] === "string" &&
    Array.isArray(p["type_arguments"]) &&
    Array.isArray(p["arguments"])
  );
}

function chainOf(network: string): number | undefined {
  const m = NETWORK.exec(network);
  if (m === null) return undefined;
  const id = Number(m[1]);
  return id >= 1 && id <= 255 ? id : undefined;
}

/** `0x` and 64 lowercase hex digits for an address written with 1 to 64 digits, or null. */
function longAddress(a: unknown): Hex | null {
  if (typeof a !== "string" || !ADDRESS_ANY.test(a)) return null;
  return `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** `<address>::<module>::<name>` with the address in long form, or null. */
function moveName(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const parts = s.split("::");
  if (parts.length !== 3) return null;
  const address = longAddress(parts[0]);
  if (address === null || !IDENT.test(parts[1]!) || !IDENT.test(parts[2]!)) return null;
  return `${address}::${parts[1]}::${parts[2]}`;
}

function objectAddress(v: unknown): unknown {
  return isObject(v) ? v["inner"] : v;
}

/** The `transaction` byte array of x402's reference wire form, or undefined when the bytes are not that JSON. */
function referenceForm(b: Uint8Array): Uint8Array | undefined {
  if (b[0] !== 0x7b) return undefined;
  let o: unknown;
  try {
    o = parseJson(new TextDecoder("utf-8", { fatal: true }).decode(b));
  } catch {
    return undefined;
  }
  if (!isObject(o)) return undefined;
  const t = o["transaction"];
  if (!Array.isArray(t) || !t.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return undefined;
  return Uint8Array.from(t as number[]);
}

function leU64(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
  return v;
}

/** A bounded BCS reader; every read past the end throws, and the caller turns that into a refusal. */
class Reader {
  private at = 0;
  constructor(private readonly b: Uint8Array) {}

  bytes(n: number): Uint8Array {
    if (n < 0 || this.at + n > this.b.length) throw new RangeError("short");
    const out = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  u8(): number {
    return this.bytes(1)[0]!;
  }

  u64(): bigint {
    return leU64(this.bytes(8));
  }

  /** ULEB128 up to 2^32 - 1, in its shortest form. */
  uleb(): number {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      v += (byte & 0x7f) * 2 ** (7 * i);
      if ((byte & 0x80) === 0) {
        if (i > 0 && byte === 0) throw new RangeError("non-canonical");
        if (v > 0xffffffff) throw new RangeError("too large");
        return v;
      }
    }
    throw new RangeError("too long");
  }

  ident(): string {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(this.uleb()));
    if (!IDENT.test(s)) throw new RangeError("identifier");
    return s;
  }
}
