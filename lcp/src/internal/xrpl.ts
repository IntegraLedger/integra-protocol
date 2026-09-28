/**
 * XRP Ledger rail pieces: the signed Payment blob, its `InvoiceID` carrying the ATR hash in each scheme's form, the
 * transaction hash computed from the blob, and settlement read by that hash through a bounded reader. Blobs are
 * decoded with ripple-binary-codec, loaded when first needed; without it those functions refuse `xrpl/peer-missing`.
 * The public names are re-exported by `../xrpl.ts`.
 */
import { hash, toLcpString, toRawBytes, type AtrHash } from "../core.js";
import { refusal, type Refusal } from "../refusal.js";

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

/** Bounded, read-only calls against one network's endpoint. Every failure rejects with `ReaderError`. */
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

/** The read keys recorded at claim. */
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

export const MAX_BLOB_HEX = 4096;
/**
 * The deepest nesting of STObject and STArray fields inside a transaction: an object or array field one level below
 * its container, and an array's member object one level below the array.
 */
export const XRPL_MAX_DEPTH = 64;
/**
 * The most fields, counting array members, that one blob may hold. Every field takes at least its one-byte header, so
 * no blob within `MAX_BLOB_HEX` holds more.
 */
export const XRPL_MAX_FIELDS = MAX_BLOB_HEX / 2;
const NETWORK = /^xrpl:(0|[1-9][0-9]{0,9})$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const HASH256 = /^[0-9A-Fa-f]{64}$/;
const TXN_PREFIX = Uint8Array.of(0x54, 0x58, 0x4e, 0x00);

type Codec = typeof import("ripple-binary-codec");
type Parser = typeof import("ripple-binary-codec/dist/serdes/binary-parser.js").BinaryParser;
let codec: Promise<{ c: Codec; BinaryParser: Parser } | undefined> | undefined;

/** The codec and its `BinaryParser`, loaded together on first use; undefined when the peer is not installed. */
function loadCodec(): Promise<{ c: Codec; BinaryParser: Parser } | undefined> {
  codec ??= Promise.all([import("ripple-binary-codec"), import("ripple-binary-codec/dist/serdes/binary-parser.js")]).then(
    ([c, p]) => ({ c, BinaryParser: p.BinaryParser }),
    () => undefined,
  );
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

/** Uppercase hex of SHA-256 over the UTF-8 bytes of the hash's LCP string: x402's `InvoiceID` for `extra.invoiceId`. */
export async function x402InvoiceId(h: AtrHash): Promise<string> {
  const d = await hash(new TextEncoder().encode(toLcpString(h)));
  return d.slice(2).toUpperCase();
}

/** The hash's 64 hex digits in upper case, without `0x`: MPP's `methodDetails.invoiceId`. */
export function mppInvoiceId(h: AtrHash): string {
  return upperHex(toRawBytes(h));
}

/**
 * Decodes a signed blob of at most 4 KiB of hex, and computes its transaction hash as the ledger does: SHA-512Half
 * over `54584E00` and the blob, in upper case. Before the codec decodes it, a single pass over its fields refuses a
 * blob that nests STObject and STArray fields more than `XRPL_MAX_DEPTH` deep or holds more than `XRPL_MAX_FIELDS`
 * fields and array members. The blob must be the canonical serialization of what it decodes to: the codec's encoding
 * of the decoded fields gives back the same bytes, so nothing follows a top-level end marker and every array member is
 * an object.
 */
export async function decodeBlob(hex: string): Promise<{ tx: XrplTxJson; hash: string } | Refusal> {
  if (typeof hex !== "string" || !HEX.test(hex)) return refusal("xrpl/blob-malformed");
  if (hex.length > MAX_BLOB_HEX) return refusal("xrpl/blob-too-large");
  const loaded = await loadCodec();
  if (loaded === undefined) return refusal("xrpl/peer-missing");
  const { c, BinaryParser } = loaded;
  if (!withinCaps(new BinaryParser(hex, c.DEFAULT_DEFINITIONS))) return refusal("xrpl/blob-malformed");
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
 * True when the serialized transaction nests STObject and STArray fields at most `XRPL_MAX_DEPTH` deep and holds at
 * most `XRPL_MAX_FIELDS` fields and array members, and every object and array it opens is closed. It reads each field
 * header once: an object or array field opens a level in place, its end marker closes it, and every other field's
 * value is read as a leaf, so the pass is linear in the blob's length. Levels open and close as the codec's decode
 * reads them: inside an object only `ObjectEndMarker` closes, inside an array only `ArrayEndMarker` closes, and any
 * other field whose type is STObject or STArray opens a level.
 */
function withinCaps(parser: InstanceType<Parser>): boolean {
  const open: ("STObject" | "STArray")[] = [];
  let fields = 0;
  try {
    while (!parser.end()) {
      const field = parser.readField();
      const inside = open.at(-1) ?? "STObject";
      const closes = inside === "STObject" ? "ObjectEndMarker" : "ArrayEndMarker";
      if (field.name === closes) {
        if (open.pop() === undefined) return false;
        continue;
      }
      if (++fields > XRPL_MAX_FIELDS) return false;
      const type = field.type.name;
      if (type === "STObject" || type === "STArray") {
        if (open.length >= XRPL_MAX_DEPTH) return false;
        open.push(type);
      } else {
        parser.readFieldValue(field);
      }
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
  if ("refused" in d) return d;
  return "Signers" in d.tx ? refusal("xrpl/multisigned") : d;
}

/**
 * Reads a transaction by the hash computed from its signed blob. Settled only when a validated ledger holds it with
 * `tesSUCCESS` as a Payment whose `InvoiceID` is the one expected; `tec` codes are final failures that claimed the fee;
 * past `LastLedgerSequence` with the whole range searched it expired. A failed read is pending. At most two calls.
 */
export async function xrplStatus(ref: XrplRef, reader: XrplReader): Promise<XrplStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  const range = ref.lastLedgerSequence === null ? null : { min: ref.fromLedger, max: ref.lastLedgerSequence };
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(ref.transaction, range);
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

/** Zero-party: the validated `tesSUCCESS` Payment's `InvoiceID`, as a candidate hash. One call. */
export async function xrplInvoiceOf(
  ref: { network: XrplNetwork; transaction: string },
  reader: XrplReader,
): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("xrpl/wrong-reader");
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(ref.transaction, null);
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
