/**
 * MPP XRPL session pieces: the payment channel's id, the claim bytes a voucher signs, the `CancelAfter` of a signed
 * `PaymentChannelCreate` blob, and the read of a reported close. The public names are re-exported
 * by `../xrpl.ts`.
 */
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { isObject } from "../fields.js";
import { refusal, type Refusal } from "../refusal.js";
import { decide, type Facts, type UnreadableReason } from "./read.js";
import {
  isXrplNetwork,
  isXrplQuery,
  rejectedAs,
  xrplLedger,
  type XrplLanded,
  type XrplReached,
  type XrplNetwork,
  type XrplQuery,
  type XrplReader,
  type XrplStatus,
} from "./xrpl.js";

/** The read keys of a reported close: the network, the channel, the close's transaction and the option's payee. */
export type XrplCloseRef = { phase: "close"; network: XrplNetwork; channel: string; transaction: string; payee: string };
/** A reported close's read, as the profile `read-status` answers it: the answer `XrplStatus` names. */
export type XrplCloseStatus = XrplStatus;

const CLOSE_LEDGER = xrplLedger("none");

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
 * A reported close's read, as the profile `read-status` answers it: the transaction the ref names, read by `tx`, is the
 * close where its metadata deletes the channel, `settled` at its ledger index at the mark it was read at
 * (`current` in a ledger not yet validated, which is no mark), `pending`, `below-mark` under `validated`; a transaction that
 * deleted no such channel, and one not found, are `pending`, `search-incomplete`; a ledger index at or before the
 * query's `after` is `failed`, `before-position`. A ref whose channel or transaction is not 64 hex digits, or whose
 * network is not an XRPL network, a query of another form, and a reader that is not an object or names no XRPL
 * network, are `unparseable`, and a reader for another network `chain-mismatch`, each with nothing read; the
 * transaction is looked up in upper case. A rejected read is unreadable by `rejectedAs`; an answer of another shape is
 * `unparseable`. One call.
 */
export async function xrplCloseStatus(
  ref: XrplCloseRef,
  reader: XrplReader,
  query: XrplQuery<XrplCloseRef>,
): Promise<XrplCloseStatus> {
  const unreadable = (reason: UnreadableReason): XrplStatus => ({
    state: "unreadable",
    reason,
    foreign: [],
  });
  if (!isXrplQuery(query) || !isObject(ref) || !isXrplNetwork(ref.network)) return unreadable("unparseable");
  if (typeof ref.channel !== "string" || !HASH256.test(ref.channel)) return unreadable("unparseable");
  if (typeof ref.transaction !== "string" || !HASH256.test(ref.transaction)) return unreadable("unparseable");
  if (!isObject(reader) || !isXrplNetwork(reader.network)) return unreadable("unparseable");
  if (reader.network !== ref.network) return unreadable("chain-mismatch");
  const transaction = ref.transaction.toUpperCase();
  let r: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    r = await reader.tx(transaction, null);
  } catch (e) {
    return unreadable(rejectedAs(e));
  }
  if (!isObject(r)) return unreadable("unparseable");
  const facts: Facts<number, XrplReached> = { seen: [], search: { whole: false }, history: false };
  if (!("notFound" in r)) {
    const l = r as XrplLanded;
    if (typeof l.validated !== "boolean" || (l.ledgerIndex !== undefined && !Number.isSafeInteger(l.ledgerIndex))) {
      return unreadable("unparseable");
    }
    const deleted = Array.isArray(l.deletedChannels) ? l.deletedChannels : [];
    if (l.result === "tesSUCCESS" && deleted.some((c) => typeof c === "string" && c.toUpperCase() === ref.channel.toUpperCase())) {
      const seen = {
        transaction,
        ...(l.ledgerIndex === undefined ? {} : { position: l.ledgerIndex }),
        mark: (l.validated ? "validated" : "current") as XrplReached,
        result: "succeeded" as const,
        consumed: true,
        carries: false,
        party: "payer" as const,
        kind: "same" as const,
        account: "payee" as const,
        presented: "yes" as const,
      };
      return decide({ ...facts, seen: [seen] }, query, CLOSE_LEDGER);
    }
  }
  return decide(facts, query, CLOSE_LEDGER);
}
