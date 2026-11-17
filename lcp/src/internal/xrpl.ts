/**
 * XRP Ledger rail pieces: the signed blob, its `InvoiceID` or memo carrying the ATR hash in each scheme's form, the
 * transaction hash computed from the blob, the payer's instrument and signed body, and the reader's types. Blobs are
 * decoded with ripple-binary-codec, loaded when first needed; without it those functions refuse `xrpl/peer-missing`.
 * The public names are re-exported by `../xrpl.ts`.
 */
import { canonicalJson, fromLcpString, hash, toLcpString, toRawBytes, type AtrHash } from "../core.js";
import { isObject } from "../fields.js";
import { challengeSnapshot, type MppChallenge } from "../mpp-challenge.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";
import type { Ledger, RecoverInput, StatusAnswer, StatusQuery, UnreadableReason } from "./read.js";

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

/** The ledger an `account_info` or `ledger_entry` call names: the latest validated one, or the current one. */
export type XrplLedgerName = "validated" | "current";

/** What `server_info` states: the ledgers the server holds and serves, and the network it serves. */
export interface XrplServer {
  /** `validated_ledger.seq`: the index of the latest validated ledger. */
  readonly validated: number;
  /** The index of the latest ledger the server serves at the read, validated or not, to which a search reads. */
  readonly latest: number;
  /** `complete_ledgers`, as the server writes it: `"empty"`, or ranges `a-b` and single indexes joined by commas. */
  readonly completeLedgers: string;
  /** `network_id`, where the server states one. */
  readonly networkId?: number;
}

/** A transaction as the server answers it: its signed blob and what its metadata shows. */
export interface XrplLanded {
  /** The transaction's hash, 64 hex digits, as the server names it. */
  readonly hash: string;
  /** Whether the ledger that holds it is validated. */
  readonly validated: boolean;
  /** The index of the ledger that holds it; absent where the server names none. */
  readonly ledgerIndex?: number;
  /** `meta.TransactionResult`. */
  readonly result: string;
  /** The signed transaction, hex (`tx_blob`); an inner `Batch` transaction's own serialization. */
  readonly blob: string;
  /** `meta.delivered_amount` where the metadata gives one: drops, or an issued or MPT amount. */
  readonly delivered?: XrplAmount;
  /** The ids of the `PayChannel` entries the metadata creates. */
  readonly createdChannels?: readonly string[];
  /** The ids of the `PayChannel` entries the metadata deletes. */
  readonly deletedChannels?: readonly string[];
  /** For an inner `Batch` transaction, the hash of the `Batch` that holds it (`meta.ParentBatchID`). */
  readonly parent?: string;
}

/** An amount as rippled writes it: drops of XRP, an issued currency's value, or an MPT's. */
export type XrplAmount =
  | string
  | { readonly currency: string; readonly issuer: string; readonly value: string }
  | { readonly mpt_issuance_id: string; readonly value: string };

/** One page of `account_tx`, forward, in binary form: the transactions, the ledgers it covered, and its marker. */
export interface XrplPage {
  readonly transactions: readonly XrplLanded[];
  /** `ledger_index_min` and `ledger_index_max` as the server answers them: the ledgers the page's search covered. */
  readonly min: number;
  readonly max: number;
  /** `marker`, where more of the range is left to read. */
  readonly marker?: unknown;
}

/** A `PayChannel` ledger entry. */
export interface XrplChannelEntry {
  readonly account: string;
  readonly destination: string;
  readonly amount: string;
}

/**
 * Bounded, read-only calls against one network's server. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`; any rejection reads as unreadable. A call that names a ledger answers with the index of the
 * ledger it read.
 */
export interface XrplReader {
  readonly network: XrplNetwork;
  /** `server_info`. */
  server(): Promise<XrplServer>;
  /** `tx` by hash, with `min_ledger` and `max_ledger` where a range is given: the transaction, or not found. */
  tx(hash: string, range: { min: number; max: number } | null): Promise<XrplLanded | { notFound: true; searchedAll: boolean }>;
  /** `account_tx` for `account`, forward, binary, over the range, resuming at `marker`: one page. */
  accountTx(account: string, range: { min: number; max: number }, marker?: unknown): Promise<XrplPage>;
  /** `account_info` at the ledger named: the account's `Sequence`, or no such account (`actNotFound`). */
  accountInfo(
    account: string,
    ledger: XrplLedgerName,
  ): Promise<{ sequence: number; ledgerIndex: number } | { notFound: true; ledgerIndex: number }>;
  /** `ledger_entry` of the account's `Ticket` at the ledger named: whether it is present. */
  ticket(account: string, ticketSequence: number, ledger: XrplLedgerName): Promise<{ present: boolean; ledgerIndex: number }>;
  /** `ledger_entry` of a `PayChannel` at the ledger named, or no such entry (`entryNotFound`). */
  channel(id: string, ledger: XrplLedgerName): Promise<XrplChannelEntry | { notFound: true; ledgerIndex: number }>;
}

/**
 * The payer's instrument and the message it signed, read from a presented blob: the signed `Account`, its `Sequence`
 * or, where `Sequence` is 0, its `TicketSequence`, its `LastLedgerSequence` or null, and the signed body, the blob's
 * fields but `TxnSignature`, `SigningPubKey` and `Signers`, in the codec's canonical encoding, hex.
 */
export interface XrplSigned {
  readonly account: string;
  readonly sequence: number;
  readonly ticket?: number;
  readonly lastLedgerSequence: number | null;
  readonly body: string;
}

/**
 * The read keys `reference` returns: the network; the presented transaction's hash, a way to look and never the
 * identity; H; the option's payee, which `reference` takes from the option the payment answers; and, where the
 * payment presents its blob, the payer's instrument and signed body. `fromLedger`, the ledger index the search starts
 * from, the issue ledger, is the caller's.
 */
export interface XrplRef {
  network: XrplNetwork;
  transaction: string;
  h: AtrHash;
  payee: string;
  signed?: XrplSigned;
  fromLedger: number;
}

/**
 * The XRP Ledger's one mark, `validated`: a state of a transaction its servers tell apart, the default and the final
 * mark, and the only finality a query names.
 */
export type XrplMark = "validated";

/**
 * What a read reached for a transaction it names: `validated`, the mark, or `current`, a ledger the server serves above
 * the latest validated one, up to the latest ledger the search for H reads on to. `current` is no mark a query names:
 * an act or a lapse read there is `pending`, `below-mark`.
 */
export type XrplReached = XrplMark | "current";

/** An XRPL read, as the profile `read-status` answers it. The position is a ledger index, and so is the search's. */
export type XrplStatus = StatusAnswer<number, XrplReached>;

/** What an XRPL status read takes with the reference and the reader. */
export type XrplQuery<Ref> = StatusQuery<Ref, number, XrplMark>;

/**
 * The reason a rejected read gives: a `ReaderError` of kind `too-large` is `too-large`, one of kind `malformed`
 * `unparseable`, and any other rejection, a timeout among them, `transport`.
 */
export function rejectedAs(e: unknown): UnreadableReason {
  if (typeof e !== "object" || e === null || (e as { name?: unknown }).name !== "ReaderError") return "transport";
  const kind = (e as { kind?: unknown }).kind;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/**
 * The ledger of an XRPL pairing at `coverage`: its one mark, `validated`, the final, above what a read reaches in a
 * ledger not yet validated, and ledger indexes in their order.
 */
export function xrplLedger(coverage: Ledger<number, XrplReached>["coverage"]): Ledger<number, XrplReached> {
  const rank = (m: XrplReached): number => (m === "validated" ? 1 : 0);
  return { coverage, final: "validated", markOrder: (a, b) => rank(a) - rank(b), positionOrder: (a, b) => a - b };
}

/**
 * Whether a credential's echoed challenge is `option`, the challenge the caller gives: each of MPP's challenge members
 * equal, `request` and `opaque` as the strings echoed, since a server's id check takes the echo verbatim. A payment that
 * echoes another challenge answers that challenge, whose payee the read's party tests would not take.
 */
export function echoesOption(echoed: unknown, option: unknown): boolean {
  const a = canonicalJson(challengeSnapshot(echoed) as never);
  return typeof a === "string" && a === canonicalJson(challengeSnapshot(option) as never);
}

/** A query that is an object of a known act at the XRP Ledger's one mark, `validated`. */
export function isXrplQuery(query: unknown): query is XrplQuery<never> {
  if (!isObject(query)) return false;
  const q = query as { act?: unknown; finality?: unknown };
  return (q.act === "payment" || q.act === "agreement") && q.finality === "validated";
}

/** What the wallet signs, and how its signed blob completes the payment. */
export interface XrplUnsigned<P> {
  request: { kind: "xrpl-tx"; txJson: XrplTxJson };
  /**
   * The payment of the wallet's signed blob, hex, read as `bound` reads it: a blob that does not decode, or is
   * multi-signed, gets the refusal `bound` gives it, and one whose `NetworkID` a node of the option's network does not
   * take, as rippled reads it, is `xrpl/network-mismatch`.
   */
  complete(signedBlob: string): Promise<P | Refusal>;
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

/**
 * The largest signed blob lcp decodes, in bytes: lcp's own bound, read by every XRPL pairing. It holds a Payment or a
 * PaymentChannelCreate signed by the 32 signers a signer list admits at most (rippled `3c72fb54`,
 * `include/xrpl/protocol/STTx.h:49`), with the paths a stock client finds and memos of rippled's 1,024 bytes
 * (`src/libxrpl/protocol/STTx.cpp:697`); rippled's own bound on a transaction, 1 MB (`include/xrpl/protocol/Protocol.h:38`),
 * is no payment's.
 */
export const XRPL_MAX_BLOB_BYTES = 16_384;
const MAX_BLOB_HEX = 2 * XRPL_MAX_BLOB_BYTES;
/**
 * The deepest level a field of a transaction sits at, rippled's limit: its deserializer refuses a field whose depth is
 * above 10 (rippled 3.4.1, `src/libxrpl/protocol/STVar.cpp` L104-108, the `STVar` constructor that reads a
 * `SerialIter`). A top-level field is at level 1, each field inside an STObject or STArray field one level below that
 * field, and an array's member object one level below the array. An end marker that closes its own object or array
 * sits at no level, so an object or array at this level holds no field.
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

/**
 * True when a node of `network` takes the transaction for its `NetworkID`, as rippled 3.4.1 reads it in `preflight0`
 * (`src/libxrpl/tx/Transactor.cpp` L73-93): a network whose id is at most 1024 takes a transaction without `NetworkID`
 * only (`telNETWORK_ID_MAKES_TX_NON_CANONICAL`, whatever its value), and one above 1024 takes one whose `NetworkID` is
 * its own id only (`telREQUIRES_NETWORK_ID`, `telWRONG_NETWORK`).
 */
export function networkIdHeld(tx: XrplTxJson, network: XrplNetwork): boolean {
  const id = networkId(network);
  return id <= 1024 ? tx["NetworkID"] === undefined : tx["NetworkID"] === id;
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
 * Decodes a signed blob of at most `XRPL_MAX_BLOB_BYTES` bytes, and computes its transaction hash as the ledger
 * does: SHA-512Half over `54584E00` and the blob, in upper case. Before the codec decodes it, a single pass over its
 * fields refuses a blob with a field deeper than `XRPL_MAX_DEPTH`, or with an end marker in an object or array it does
 * not close, as rippled refuses either. The blob must be the canonical serialization of what it decodes to: the
 * codec's encoding of the decoded fields gives back the same bytes, so nothing follows a top-level end marker and every
 * array member is an object.
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
 * opens is closed by its own end marker. It reads each field header once: a field other than an end marker sits one
 * level below the objects and arrays open around it, an object or array field opens a level in place, its end marker
 * closes it, and every other field's value is read as a leaf, so the pass is linear in the blob's length. Inside an
 * object only `ObjectEndMarker` closes, and inside an array only `ArrayEndMarker` closes; any other end marker is
 * refused, as rippled 3.4.1 refuses an array end marker in an object (`src/libxrpl/protocol/STObject.cpp` L240-244)
 * and an object end marker as an array's member (`src/libxrpl/protocol/STArray.cpp` L54-58).
 */
function withinCaps(parser: InstanceType<Parser>): boolean {
  const open: ("STObject" | "STArray")[] = [];
  try {
    while (!parser.end()) {
      const field = parser.readField();
      const inside = open.at(-1) ?? "STObject";
      const closes = inside === "STObject" ? "ObjectEndMarker" : "ArrayEndMarker";
      if (field.name === "ObjectEndMarker" || field.name === "ArrayEndMarker") {
        if (field.name !== closes || open.pop() === undefined) return false;
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
 * the same blob gives the first call's result. A multisigned blob is admitted: the read finds the payment by its
 * instrument, so another quorum's copy, under another hash, is the same payment.
 */
export async function decodePresented(holder: object, hex: unknown): Promise<Decoded | Refusal> {
  let seen = presented.get(holder);
  if (seen === undefined || seen.hex !== hex) {
    seen = { hex, decoded: decodeBlob(hex as string) };
    presented.set(holder, seen);
  }
  return seen.decoded;
}

const UNSIGNED = ["TxnSignature", "SigningPubKey", "Signers"];

/**
 * The signed body of a decoded transaction: its fields but `TxnSignature`, `SigningPubKey` and `Signers`, encoded by
 * the codec, hex in upper case. One message signed with another key, or by another quorum, has this body and another
 * hash. Undefined where the codec cannot encode it.
 */
export async function signedBodyOf(tx: XrplTxJson): Promise<string | undefined> {
  const loaded = await loadCodec();
  if (loaded === undefined) return undefined;
  const body: { [k: string]: unknown } = {};
  for (const [k, v] of Object.entries(tx)) if (!UNSIGNED.includes(k)) body[k] = v;
  try {
    return loaded.c.encode(body as Parameters<Codec["encode"]>[0]).toUpperCase();
  } catch {
    return undefined;
  }
}

const U32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;

/**
 * The payer's instrument and signed body of a decoded transaction (`XrplSigned`): its `Account`, its `Sequence`, and,
 * where `Sequence` is 0, its `TicketSequence`. Undefined where the account, the sequence or the ticket is not of its
 * form, or the body does not encode.
 */
export async function signedOf(tx: XrplTxJson): Promise<XrplSigned | undefined> {
  const sequence = tx["Sequence"];
  const ticket = tx["TicketSequence"];
  if (typeof tx.Account !== "string" || !U32(sequence)) return undefined;
  if (sequence === 0 && !U32(ticket)) return undefined;
  const body = await signedBodyOf(tx);
  if (body === undefined) return undefined;
  const lls = tx.LastLedgerSequence;
  return {
    account: tx.Account,
    sequence,
    ...(sequence === 0 ? { ticket: ticket as number } : {}),
    lastLedgerSequence: U32(lls) ? lls : null,
    body,
  };
}

const MAX_MEMOS = 8;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The hash of a transaction's one LCP memo: among at most 8 memos, exactly one whose `MemoData` is UTF-8 parsing as an
 * LCP string. More than 8 memos, or more than one such, is `xrpl/memo-count`; none is `xrpl/no-memo`.
 */
export function lcpMemoOf(tx: XrplTxJson): AtrHash | Refusal {
  const memos = Array.isArray(tx.Memos) ? (tx.Memos as unknown[]) : [];
  if (memos.length > MAX_MEMOS) return refusal("xrpl/memo-count");
  const found: AtrHash[] = [];
  for (const m of memos) {
    const data = isObject(m) && isObject(m["Memo"]) ? (m["Memo"] as { [k: string]: unknown })["MemoData"] : undefined;
    if (typeof data !== "string" || !HEX.test(data)) continue;
    let text: string;
    try {
      text = UTF8.decode(fromHex(data));
    } catch {
      continue;
    }
    const h = fromLcpString(text);
    if (h !== null) found.push(h);
  }
  if (found.length === 0) return refusal("xrpl/no-memo");
  if (found.length > 1) return refusal("xrpl/memo-count");
  return found[0]!;
}

/**
 * A transaction the server answers by `tx`, read for `recover`: validated with `tesSUCCESS`, its blob decoding to the
 * transaction the hash names. `xrpl/not-found`, `xrpl/not-validated` and `xrpl/not-success` where it is not; a blob
 * that does not decode or whose hash is not the one asked is `xrpl/unreadable`, an answer out of the reader's form, and
 * a codec that cannot be loaded `xrpl/peer-missing`. An input or option that is not an object, a reader for another
 * network, and a `tx` that is not 64 hex digits, are `xrpl/wrong-reader`, with nothing read. One call.
 */
export async function landedFor(
  input: RecoverInput<XrplNetwork, unknown>,
  reader: XrplReader,
): Promise<{ tx: XrplTxJson; hash: string } | Refusal> {
  if (!isObject(input) || !isObject(input.option)) return refusal("xrpl/wrong-reader");
  if (!isObject(reader) || reader.network !== input.network) return refusal("xrpl/wrong-reader");
  if (typeof input.tx !== "string" || !HASH256.test(input.tx)) return refusal("xrpl/wrong-reader");
  const transaction = input.tx.toUpperCase();
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(transaction, null);
  } catch {
    return refusal("xrpl/unreadable");
  }
  if (typeof r !== "object" || r === null) return refusal("xrpl/unreadable");
  if ("notFound" in r) return refusal("xrpl/not-found");
  if (r.validated !== true) return refusal("xrpl/not-validated");
  if (r.result !== "tesSUCCESS") return refusal("xrpl/not-success");
  const decoded = await decodeBlob(r.blob);
  if (isRefusal(decoded)) return decoded.code === "xrpl/peer-missing" ? decoded : refusal("xrpl/unreadable");
  if (decoded.hash !== transaction) return refusal("xrpl/unreadable");
  return decoded;
}

/**
 * Zero-party: the `InvoiceID` of a validated `tesSUCCESS` Payment, as a candidate hash, read by `tx`, the
 * transaction's hash (`landedFor`, with its codes); `option`, the challenge the ATR's binding slot holds, must be an
 * object, and no member of it is read. Another type is `xrpl/not-payment`, and a Payment with no `InvoiceID`
 * `xrpl/no-invoice-id`. One call.
 */
export async function xrplInvoiceOf(
  input: RecoverInput<XrplNetwork, PaymentRequirements | MppChallenge>,
  reader: XrplReader,
): Promise<AtrHash | Refusal> {
  const landed = await landedFor(input, reader);
  if (isRefusal(landed)) return landed;
  if (landed.tx.TransactionType !== "Payment") return refusal("xrpl/not-payment");
  const id = landed.tx.InvoiceID;
  if (typeof id !== "string" || !HASH256.test(id)) return refusal("xrpl/no-invoice-id");
  return `0x${id.toLowerCase()}`;
}
