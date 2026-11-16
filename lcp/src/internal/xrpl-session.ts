/**
 * MPP XRPL session pieces: the payment channel's id, the claim bytes a voucher signs, the `CancelAfter` of a signed
 * `PaymentChannelCreate` blob, and the reads of an opening and of a reported close. The public names are re-exported
 * by `../xrpl.ts`.
 */
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { isObject } from "../fields.js";
import { refusal, type Refusal } from "../refusal.js";
import { decide } from "./read.js";
import {
  isXrplNetwork,
  isXrplQuery,
  readXrplTx,
  rejectedAs,
  upperOf,
  xrplFacts,
  xrplLedger,
  type XrplNetwork,
  type XrplQuery,
  type XrplRead,
  type XrplReader,
  type XrplRef,
  type XrplStatus,
} from "./xrpl.js";

/** The read keys of a reported close: the network, the channel, the close's transaction and the option's payee. */
export type XrplCloseRef = { phase: "close"; network: XrplNetwork; channel: string; transaction: string; payee: string };
/** A reported close's read, as the profile `read-status` answers it: the answer `XrplStatus` names. */
export type XrplCloseStatus = XrplStatus;

const SESSION_LEDGER = xrplLedger("mpp/session/xrpl");

const PAY_CHANNEL_SPACE = Uint8Array.of(0x00, 0x78);
const CLAIM_PREFIX = Uint8Array.of(0x43, 0x4c, 0x4d, 0x00);
const HASH256 = /^[0-9A-Fa-f]{64}$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
/** Seconds from the Unix epoch to the XRP Ledger's epoch, 2000-01-01T00:00:00Z. */
export const RIPPLE_EPOCH = 946_684_800;

function upperHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s.toUpperCase();
}

function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const XRPL_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

/** Base58 with the XRPL alphabet, at most 25 bytes; null on any other character or a longer value. */
function base58xrpl(s: string): Uint8Array | null {
  if (typeof s !== "string" || s.length === 0 || s.length > 35) return null;
  let n = 0n;
  for (const ch of s) {
    const v = XRPL_ALPHABET.indexOf(ch);
    if (v === -1) return null;
    n = n * 58n + BigInt(v);
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === XRPL_ALPHABET[0]) zeros++;
  const out = Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
  return out.length > 25 ? null : out;
}

/** The 20-byte AccountID of a classic address (base58 with the XRPL alphabet, version 0, double-SHA-256 checksum). */
export function accountIdOf(address: string): Uint8Array | null {
  const raw = base58xrpl(address);
  if (raw === null || raw.length !== 25 || raw[0] !== 0) return null;
  const check = sha256(sha256(raw.subarray(0, 21))).subarray(0, 4);
  if (!check.every((x, i) => x === raw[21 + i])) return null;
  return raw.slice(1, 21);
}

/**
 * The PayChannel id: SHA-512Half of `0x0078` ‖ the source's AccountID ‖ the destination's AccountID ‖ the creating
 * transaction's sequence (or ticket sequence), big-endian; upper-case hex. An address that is not a classic address,
 * or a sequence that is not a UInt32, is `mpp/input-malformed`.
 */
export function xrplChannelId(account: string, destination: string, sequence: number): string | Refusal {
  const a = accountIdOf(account);
  const d = accountIdOf(destination);
  if (a === null || d === null || !Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
    return refusal("mpp/input-malformed");
  }
  const input = new Uint8Array(2 + 20 + 20 + 4);
  input.set(PAY_CHANNEL_SPACE, 0);
  input.set(a, 2);
  input.set(d, 22);
  new DataView(input.buffer).setUint32(42, sequence, false);
  return upperHex(sha512(input).subarray(0, 32));
}

/**
 * The bytes a channel claim signs: `CLM\0` ‖ channel id (32 bytes) ‖ drops as u64 big-endian. A channel id that is not
 * 64 hex digits, or drops that are not a `bigint` UInt64, is `mpp/input-malformed`.
 */
export function xrplClaim(channelId: string, drops: bigint): Uint8Array<ArrayBuffer> | Refusal {
  if (typeof channelId !== "string" || !HASH256.test(channelId) || typeof drops !== "bigint" || drops < 0n || drops >= 1n << 64n) {
    return refusal("mpp/input-malformed");
  }
  const out = new Uint8Array(44);
  out.set(CLAIM_PREFIX, 0);
  out.set(fromHex(channelId), 4);
  new DataView(out.buffer).setBigUint64(36, drops, false);
  return out;
}

/**
 * The `CancelAfter` (field 36 of type UInt32) of a signed blob, read from the canonical field order: every UInt16
 * field, then every UInt32 field in field-code order, precede all others. Undefined when the blob has none.
 */
export function cancelAfterOf(blobHex: string): number | undefined {
  if (typeof blobHex !== "string" || !HEX.test(blobHex)) return undefined;
  const b = fromHex(blobHex);
  let at = 0;
  while (at < b.length) {
    const head = b[at++]!;
    let type = head >> 4;
    let field = head & 0x0f;
    if (type === 0) type = b[at++] ?? 0xff;
    if (field === 0) field = b[at++] ?? 0xff;
    if (type === 1) at += 2;
    else if (type === 2) {
      if (at + 4 > b.length) return undefined;
      if (field === 36) return new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, false);
      if (field > 36) return undefined;
      at += 4;
    } else return undefined;
  }
  return undefined;
}

/**
 * Reads an opening by the hash computed from its signed blob, as the profile `read-status` answers it: the
 * `PaymentChannelCreate` a validated ledger holds with `tesSUCCESS` is `settled` at its ledger index. A `tec` result,
 * a validated success of another type, an expiry past `LastLedgerSequence`, a lookup that finds nothing and a
 * transaction in no validated ledger yet are `pending`, `search-incomplete`, since this read is no search for H; a
 * ledger index at or before the query's `after` is `failed`, `before-position`. A ref, reader or query of the wrong
 * form is `unreadable`, `unparseable`, and a reader for another network `chain-mismatch`, each with nothing read; the
 * transaction is looked up in upper case. At most two calls.
 */
export async function xrplOpenStatus(
  ref: Omit<XrplRef, "expect">,
  reader: XrplReader,
  query: XrplQuery<Omit<XrplRef, "expect">>,
): Promise<XrplStatus> {
  if (!isXrplQuery(query)) return { state: "unreadable", reason: "unparseable", foreign: [] };
  const read = await readXrplTx(ref, reader, (r) => r.transactionType === "PaymentChannelCreate", false);
  return decide(xrplFacts(read, upperOf(ref), SESSION_LEDGER), query, SESSION_LEDGER);
}

/**
 * Reads a reported close: validated with the channel among the transaction's deleted `PayChannel` entries is settled;
 * validated without it shows no close; otherwise nothing is found. A ref whose channel or transaction is not 64 hex
 * digits, or whose network is not an XRPL network, and a reader that is not an object or names no XRPL network, are
 * `unparseable`, and a reader for another network `chain-mismatch`, each with nothing read; the transaction is looked
 * up in upper case. A rejected read is unreadable by `rejectedAs`; an answer of another shape, and a validated ledger
 * index that is not an integer, are `unparseable`. One call.
 */
async function readClose(ref: XrplCloseRef, reader: XrplReader): Promise<XrplRead> {
  if (!isObject(ref) || !isXrplNetwork(ref.network)) return { state: "unreadable", reason: "unparseable" };
  if (typeof ref.channel !== "string" || !HASH256.test(ref.channel)) return { state: "unreadable", reason: "unparseable" };
  if (typeof ref.transaction !== "string" || !HASH256.test(ref.transaction)) return { state: "unreadable", reason: "unparseable" };
  if (!isObject(reader) || !isXrplNetwork(reader.network)) return { state: "unreadable", reason: "unparseable" };
  if (reader.network !== ref.network) return { state: "unreadable", reason: "chain-mismatch" };
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(ref.transaction.toUpperCase(), null);
  } catch (e) {
    return { state: "unreadable", reason: rejectedAs(e) };
  }
  if (typeof r !== "object" || r === null) return { state: "unreadable", reason: "unparseable" };
  if ("notFound" in r) return { state: "pending", why: "not-found" };
  if (r.validated !== true) return { state: "pending", why: "not-validated" };
  const deleted = Array.isArray(r.deletedChannels) ? r.deletedChannels : [];
  if (!deleted.some((c) => typeof c === "string" && c.toUpperCase() === ref.channel.toUpperCase())) {
    return { state: "failed", why: "not-a-close" };
  }
  if (!Number.isSafeInteger(r.ledgerIndex)) return { state: "unreadable", reason: "unparseable" };
  return { state: "settled", ledgerIndex: r.ledgerIndex! };
}

/**
 * A reported close's read, as the profile `read-status` answers it: the close is `settled` at its ledger index; a
 * validated transaction that deleted no such channel, a lookup that finds nothing and a transaction in no validated
 * ledger yet are `pending`, `search-incomplete`; a ledger index at or before the query's `after` is `failed`,
 * `before-position`; and a ref, reader or query of the wrong form is `unreadable`, as `readClose` gives it. One call.
 */
export async function xrplCloseStatus(
  ref: XrplCloseRef,
  reader: XrplReader,
  query: XrplQuery<XrplCloseRef>,
): Promise<XrplCloseStatus> {
  if (!isXrplQuery(query)) return { state: "unreadable", reason: "unparseable", foreign: [] };
  return decide(xrplFacts(await readClose(ref, reader), upperOf(ref), SESSION_LEDGER), query, SESSION_LEDGER);
}
