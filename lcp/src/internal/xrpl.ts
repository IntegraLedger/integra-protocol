/**
 * XRP Ledger rail pieces: the signed Payment blob, its `InvoiceID` carrying the ATR hash in each scheme's form, the
 * transaction hash computed from the blob, and settlement read by that hash through a bounded reader. Blobs are
 * decoded with ripple-binary-codec, loaded when first needed; without it those functions refuse `xrpl/peer-missing`.
 * The public names are re-exported by `../xrpl.ts`.
 */
import { hash, toLcpString, toRawBytes, type AtrHash } from "../core.js";
import { isObject } from "../fields.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

/** CAIP-2: `xrpl:` and the chain's NetworkID, 0 to 4294967295. */
export type XrplNetwork = `xrpl:${number}`;

export interface XrplTxJson {
  TransactionType: string;
  Account: string;
  InvoiceID?: string;
  LastLedgerSequence?: number;
  Memos?: unknown;
  [field: string]: unknown;
}

/**
 * Bounded, read-only calls against one network's endpoint. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`; any rejection reads as unreadable.
 */
export interface XrplReader {
  readonly network: XrplNetwork;
  /** `tx` by hash, with `min_ledger` and `max_ledger` when a range is given. */
  tx(hash: string, range: { min: number; max: number } | null): Promise<XrplLanded | { notFound: true; searchedAll: boolean }>;
  /** `tx` with `binary: true`: the signed blob, for credentials that name only a hash. */
  txBlob(hash: string): Promise<string | null>;
  /** `ledger` `validated` → `ledger_index`. */
  validatedLedger(): Promise<number>;
}

export interface XrplLanded {
  validated: boolean;
  /** `meta.TransactionResult`. */
  result: string;
  ledgerIndex?: number;
  transactionType: string;
  invoiceId?: string;
  /** The `PayChannel` `DeletedNode`s of the transaction's `meta`. */
  deletedChannels?: readonly string[];
}

/** The read keys `reference` returns, with `fromLedger`, the ledger index the transaction search starts from. */
export interface XrplRef {
  network: XrplNetwork;
  transaction: string;
  expect: string;
  lastLedgerSequence: number | null;
  fromLedger: number;
}

export type XrplStatus =
  | { state: "settled"; ledgerIndex: number }
  | { state: "pending"; why: "not-found" | "not-validated" | "unreadable" }
  | { state: "failed"; why: "expired" | "claimed-fee" | "not-this-instrument" };

/** What the wallet signs, and how its signed blob completes the payment. */
export interface XrplUnsigned<P> {
  request: { kind: "xrpl-tx"; txJson: XrplTxJson };
  complete(signedBlob: string): P | Refusal;
}

/**
 * A payment on `x402/exact/xrpl`: the wallet's signed blob, hex. `../x402-exact-xrpl.ts` returns it from `complete`,
 * and the root names it among the payments `Presented` covers; no entry point exports the name.
 */
export interface XrplPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { signedTxBlob: string };
  extensions?: PaymentRequired["extensions"];
}

export const MAX_BLOB_HEX = 4096;
/**
 * The deepest level a field of a transaction sits at, rippled's limit: its deserializer refuses a field whose depth is
 * above 10 (rippled 3.4.1, `src/libxrpl/protocol/STVar.cpp`, the `STVar` constructor that reads a `SerialIter`). A
 * top-level field is at level 1, each field inside an STObject or STArray field one level below that field, and an
 * array's member object one level below the array. An end marker sits at no level, so an object or array at this
 * level holds no field.
 */
export const XRPL_MAX_DEPTH = 10;
const NETWORK = /^xrpl:(0|[1-9][0-9]{0,9})$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const HASH256 = /^[0-9A-Fa-f]{64}$/;
const TXN_PREFIX = Uint8Array.of(0x54, 0x58, 0x4e, 0x00);

type Codec = typeof import("ripple-binary-codec");
type Parser = typeof import("ripple-binary-codec/dist/serdes/binary-parser.js").BinaryParser;
let codec: Promise<{ c: Codec; Scanner: Parser } | undefined> | undefined;

/**
 * The codec, and a `BinaryParser` that reads from an offset into the blob, loaded together on first use; undefined
 * when the peer is not installed. The codec's own parser copies every byte after the ones it reads at each read; this
 * one gives a view of the bytes it reads and moves its offset past them, so a pass over a blob's fields is linear in
 * the blob's length. The codec's field and value readers read the bytes through these five methods only.
 */
function loadCodec(): Promise<{ c: Codec; Scanner: Parser } | undefined> {
  codec ??= Promise.all([
    import("ripple-binary-codec").catch(() => undefined),
    import("ripple-binary-codec/dist/serdes/binary-parser.js").catch(() => undefined),
  ]).then(([c, p]) => {
    if (c === undefined || p === undefined) return undefined;
    class Scanner extends p.BinaryParser {
      readonly #b: Uint8Array;
      #at = 0;
      constructor(hex: string, definitions?: ConstructorParameters<Parser>[1]) {
        super("", definitions);
        this.#b = fromHex(hex);
      }
      override peek(): number {
        if (this.#at >= this.#b.length) throw new Error("peek past the end");
        return this.#b[this.#at]!;
      }
      override skip(n: number): void {
        if (n < 0 || n > this.size()) throw new Error("skip past the end");
        this.#at += n;
      }
      override read(n: number): Uint8Array {
        if (n < 0 || n > this.size()) throw new Error("read past the end");
        this.#at += n;
        return this.#b.subarray(this.#at - n, this.#at);
      }
      override size(): number {
        return this.#b.length - this.#at;
      }
      override end(customEnd?: number): boolean {
        const length = this.size();
        return length === 0 || (customEnd !== undefined && length <= customEnd);
      }
    }
    return { c, Scanner };
  });
  return codec;
}

export function isXrplNetwork(s: unknown): s is XrplNetwork {
  if (typeof s !== "string") return false;
  const m = NETWORK.exec(s);
  return m !== null && Number(m[1]) <= 0xffffffff;
}

export function networkId(n: XrplNetwork): number {
  return Number(n.slice("xrpl:".length));
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function upperHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s.toUpperCase();
}

/** True when two 256-bit hex values decode to the same bytes, ignoring case. */
export function sameInvoice(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && HASH256.test(a) && HASH256.test(b) && a.toUpperCase() === b.toUpperCase();
}

/**
 * Uppercase hex of SHA-256 over the UTF-8 bytes of the hash's LCP string: x402's `InvoiceID` for `extra.invoiceId`.
 * Rejects with a TypeError when `h` is not a 32-byte hash.
 */
export async function x402InvoiceId(h: AtrHash): Promise<string> {
  const d = await hash(new TextEncoder().encode(toLcpString(h)));
  return d.slice(2).toUpperCase();
}

/**
 * The hash's 64 hex digits in upper case, without `0x`: MPP's `methodDetails.invoiceId`. Throws TypeError when `h` is
 * not a 32-byte hash.
 */
export function mppInvoiceId(h: AtrHash): string {
  return upperHex(toRawBytes(h));
}

/**
 * Decodes a signed blob of at most 4096 hex characters (2048 bytes), and computes its transaction hash as the ledger
 * does: SHA-512Half over `54584E00` and the blob, in upper case. Before the codec decodes it, a single pass over its
 * fields refuses a blob with a field deeper than `XRPL_MAX_DEPTH`, as rippled refuses it. The blob must be the
 * canonical serialization of what it decodes to: the codec's encoding of the decoded fields gives back the same bytes,
 * so nothing follows a top-level end marker and every array member is an object.
 */
export async function decodeBlob(hex: string): Promise<{ tx: XrplTxJson; hash: string } | Refusal> {
  if (typeof hex !== "string" || !HEX.test(hex)) return refusal("xrpl/blob-malformed");
  if (hex.length > MAX_BLOB_HEX) return refusal("xrpl/blob-too-large");
  const loaded = await loadCodec();
  if (loaded === undefined) return refusal("xrpl/peer-missing");
  const { c, Scanner } = loaded;
  if (!withinCaps(new Scanner(hex, c.DEFAULT_DEFINITIONS))) return refusal("xrpl/blob-malformed");
  let tx: XrplTxJson;
  let canonical: string;
  try {
    tx = c.decode(hex) as XrplTxJson;
    canonical = c.encode(tx as Parameters<Codec["encode"]>[0]);
  } catch {
    return refusal("xrpl/blob-malformed");
  }
  if (canonical.toUpperCase() !== hex.toUpperCase()) return refusal("xrpl/blob-malformed");
  if (typeof tx !== "object" || tx === null || typeof tx.TransactionType !== "string" || typeof tx.Account !== "string") {
    return refusal("xrpl/blob-malformed");
  }
  const bytes = fromHex(hex);
  const pre = new Uint8Array(TXN_PREFIX.length + bytes.length);
  pre.set(TXN_PREFIX, 0);
  pre.set(bytes, TXN_PREFIX.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", pre));
  return { tx, hash: upperHex(digest.subarray(0, 32)) };
}

/**
 * True when no field of the serialized transaction sits deeper than `XRPL_MAX_DEPTH`, and every object and array it
 * opens is closed. It reads each field header once: a field other than an end marker sits one level below the objects
 * and arrays open around it, an object or array field opens a level in place, its end marker closes it, and every
 * other field's value is read as a leaf, so the pass is linear in the blob's length. Levels open and close as the
 * codec's decode reads them: inside an object only `ObjectEndMarker` closes, inside an array only `ArrayEndMarker`
 * closes, and any other field whose type is STObject or STArray opens a level.
 */
function withinCaps(parser: InstanceType<Parser>): boolean {
  const open: ("STObject" | "STArray")[] = [];
  try {
    while (!parser.end()) {
      const field = parser.readField();
      const inside = open.at(-1) ?? "STObject";
      const closes = inside === "STObject" ? "ObjectEndMarker" : "ArrayEndMarker";
      if (field.name === closes) {
        if (open.pop() === undefined) return false;
        continue;
      }
      if (open.length >= XRPL_MAX_DEPTH) return false;
      const type = field.type.name;
      if (type === "STObject" || type === "STArray") open.push(type);
      else parser.readFieldValue(field);
    }
  } catch {
    return false;
  }
  return open.length === 0;
}

type Decoded = { tx: XrplTxJson; hash: string };
const presented = new WeakMap<object, { hex: unknown; decoded: Promise<Decoded | Refusal> }>();

/**
 * The signed blob a presented payment holds, decoded once per holding object: a later call with the same object and
 * the same blob gives the first call's result. A blob that carries `Signers` is refused `xrpl/multisigned`: the payer
 * signs with a single key, so the transaction hash computed from the blob is the one that can land.
 */
export async function decodePresented(holder: object, hex: unknown): Promise<Decoded | Refusal> {
  let seen = presented.get(holder);
  if (seen === undefined || seen.hex !== hex) {
    seen = { hex, decoded: decodeBlob(hex as string) };
    presented.set(holder, seen);
  }
  const d = await seen.decoded;
  if (isRefusal(d)) return d;
  return "Signers" in d.tx ? refusal("xrpl/multisigned") : d;
}

/**
 * Reads a transaction by the hash computed from its signed blob. Settled only when a validated ledger holds it with
 * `tesSUCCESS` as a Payment whose `InvoiceID` is the one expected; `tec` codes are final failures that claimed the fee;
 * past `LastLedgerSequence` with the whole range searched it expired. A failed read is pending. A ref whose
 * `transaction` or `expect` is not 64 hex digits is pending `unreadable`, with nothing read; the transaction is looked
 * up in upper case, and invoice ids compare in either case. At most two calls.
 */
export async function xrplStatus(ref: XrplRef, reader: XrplReader): Promise<XrplStatus> {
  if (!isObject(ref) || !isObject(reader)) return { state: "pending", why: "unreadable" };
  if (reader.network !== ref.network || typeof ref.expect !== "string" || !HASH256.test(ref.expect)) {
    return { state: "pending", why: "unreadable" };
  }
  if (typeof ref.transaction !== "string" || !HASH256.test(ref.transaction)) return { state: "pending", why: "unreadable" };
  const range = ref.lastLedgerSequence === null ? null : { min: ref.fromLedger, max: ref.lastLedgerSequence };
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(ref.transaction.toUpperCase(), range);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (typeof r !== "object" || r === null) return { state: "pending", why: "unreadable" };
  if ("notFound" in r) {
    if (r.searchedAll !== true || ref.lastLedgerSequence === null) return { state: "pending", why: "not-found" };
    let validated: number;
    try {
      validated = await reader.validatedLedger();
    } catch {
      return { state: "pending", why: "unreadable" };
    }
    if (!Number.isSafeInteger(validated)) return { state: "pending", why: "unreadable" };
    return validated > ref.lastLedgerSequence ? { state: "failed", why: "expired" } : { state: "pending", why: "not-found" };
  }
  if (r.validated !== true) return { state: "pending", why: "not-validated" };
  if (r.result === "tesSUCCESS") {
    if (r.transactionType !== "Payment" || !sameInvoice(r.invoiceId, ref.expect)) {
      return { state: "failed", why: "not-this-instrument" };
    }
    if (!Number.isSafeInteger(r.ledgerIndex)) return { state: "pending", why: "unreadable" };
    return { state: "settled", ledgerIndex: r.ledgerIndex! };
  }
  if (typeof r.result === "string" && r.result.startsWith("tec")) return { state: "failed", why: "claimed-fee" };
  return { state: "pending", why: "unreadable" };
}

/**
 * Zero-party: the validated `tesSUCCESS` Payment's `InvoiceID`, as a candidate hash. A ref whose `transaction` is not
 * 64 hex digits is `xrpl/wrong-reader`, with nothing read; the transaction is looked up in upper case, as `xrplStatus`
 * looks it up. One call.
 */
export async function xrplInvoiceOf(
  ref: { network: XrplNetwork; transaction: string },
  reader: XrplReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("xrpl/wrong-reader");
  if (typeof ref.transaction !== "string" || !HASH256.test(ref.transaction)) return refusal("xrpl/wrong-reader");
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(ref.transaction.toUpperCase(), null);
  } catch {
    return refusal("xrpl/unreadable");
  }
  if (typeof r !== "object" || r === null) return refusal("xrpl/unreadable");
  if ("notFound" in r) return refusal("xrpl/not-found");
  if (r.validated !== true) return refusal("xrpl/not-validated");
  if (r.result !== "tesSUCCESS" || r.transactionType !== "Payment") return refusal("xrpl/not-success");
  if (typeof r.invoiceId !== "string" || !HASH256.test(r.invoiceId)) return refusal("xrpl/no-invoice-id");
  return `0x${r.invoiceId.toLowerCase()}`;
}
