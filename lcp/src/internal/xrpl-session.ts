/**
 * MPP XRPL session pieces: the payment channel's id, the claim bytes a voucher signs, the `CancelAfter` of a signed
 * `PaymentChannelCreate` blob, and the reads of an opening and of a reported close. The public names are re-exported
 * by `../xrpl.ts`.
 */
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { refusal, type Refusal } from "../refusal.js";
import type { XrplNetwork, XrplReader, XrplRef, XrplStatus } from "./xrpl.js";

export type XrplCloseRef = { phase: "close"; network: XrplNetwork; channel: string; transaction: string };
export type XrplCloseStatus =
  | { state: "settled"; ledgerIndex: number }
  | { state: "pending"; why: "not-found" | "not-validated" | "unreadable" }
  | { state: "failed"; why: "not-a-close" };

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
 * transaction's sequence (or ticket sequence), big-endian; upper-case hex. A malformed address or sequence is
 * `xrpl/not-channel-create`.
 */
export function xrplChannelId(account: string, destination: string, sequence: number): string | Refusal {
  const a = accountIdOf(account);
  const d = accountIdOf(destination);
  if (a === null || d === null || !Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff) {
    return refusal("xrpl/not-channel-create");
  }
  const input = new Uint8Array(2 + 20 + 20 + 4);
  input.set(PAY_CHANNEL_SPACE, 0);
  input.set(a, 2);
  input.set(d, 22);
  new DataView(input.buffer).setUint32(42, sequence, false);
  return upperHex(sha512(input).subarray(0, 32));
}

/** The bytes a channel claim signs: `CLM\0` ‖ channel id (32 bytes) ‖ drops as u64 big-endian. */
export function xrplClaim(channelId: string, drops: bigint): Uint8Array | Refusal {
  if (typeof channelId !== "string" || !HASH256.test(channelId) || typeof drops !== "bigint" || drops < 0n || drops >= 1n << 64n) {
    return refusal("xrpl/not-channel-create");
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
 * Reads an opening by the hash computed from its signed blob: settled only when a validated ledger holds it with
 * `tesSUCCESS` as a `PaymentChannelCreate`; `tec` codes are final failures that claimed the fee; past
 * `LastLedgerSequence` with the whole range searched it expired. A failed read is pending. At most two calls.
 */
export async function xrplOpenStatus(ref: Omit<XrplRef, "expect">, reader: XrplReader): Promise<XrplStatus> {
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
    if (r.transactionType !== "PaymentChannelCreate") return { state: "failed", why: "not-this-instrument" };
    if (!Number.isSafeInteger(r.ledgerIndex)) return { state: "pending", why: "unreadable" };
    return { state: "settled", ledgerIndex: r.ledgerIndex! };
  }
  if (typeof r.result === "string" && r.result.startsWith("tec")) return { state: "failed", why: "claimed-fee" };
  return { state: "pending", why: "unreadable" };
}

/**
 * Reads a reported close: validated with the channel among the transaction's deleted `PayChannel` entries is settled;
 * validated without it is failed `not-a-close`; otherwise pending. One call.
 */
export async function xrplCloseStatus(ref: XrplCloseRef, reader: XrplReader): Promise<XrplCloseStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(ref.transaction, null);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (typeof r !== "object" || r === null) return { state: "pending", why: "unreadable" };
  if ("notFound" in r) return { state: "pending", why: "not-found" };
  if (r.validated !== true) return { state: "pending", why: "not-validated" };
  const deleted = Array.isArray(r.deletedChannels) ? r.deletedChannels : [];
  if (!deleted.some((c) => typeof c === "string" && c.toUpperCase() === ref.channel.toUpperCase())) {
    return { state: "failed", why: "not-a-close" };
  }
  if (!Number.isSafeInteger(r.ledgerIndex)) return { state: "pending", why: "unreadable" };
  return { state: "settled", ledgerIndex: r.ledgerIndex! };
}
