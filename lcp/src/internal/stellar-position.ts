/**
 * The position of a Stellar transaction, and the 40-byte payload of a signed-payload precondition over H. Neither needs
 * @stellar/stellar-sdk. `../stellar.ts` re-exports the public names.
 *
 * The position P of a transaction is `ledger` × 2^32 + `order` × 2^12, an unsigned 64-bit integer whose low 12 bits are
 * zero: `ledger` is the sequence of the closed ledger that holds the transaction (a `uint32`), and `order` its
 * application order in that ledger, counted from 1, at most 2^20 − 1. P is written as a decimal string with no leading
 * zero, wherever it is carried.
 */
import { toRawBytes, type AtrHash } from "../core.js";
import { normalHash } from "../fields.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import { muxedOf } from "./stellar-strkey.js";

/** The largest application order a position holds: 20 bits. */
export const MAX_ORDER = 0xfffff;
/** The length of the signed-payload precondition's payload: H's 32 bytes, then an `int64`'s 8. */
export const PAYLOAD_BYTES = 40;

const POSITION = /^[1-9][0-9]{0,19}$/;
const U64_LIMIT = 1n << 64n;
const I64_MIN = -(1n << 63n);
const I64_LIMIT = 1n << 63n;

/** A ledger sequence: an integer from 0 to 2^32 − 1. */
export function isLedgerSequence(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
}

/**
 * The position of the transaction at application order `order` of ledger `ledger`, as its decimal string. A `ledger`
 * that is not a ledger sequence, or an `order` that is not an integer from 1 to 2^20 − 1, is `stellar/position-malformed`.
 */
export function stellarPosition(ledger: number, order: number): string | Refusal {
  if (!isLedgerSequence(ledger)) return refusal("stellar/position-malformed");
  if (!Number.isInteger(order) || order < 1 || order > MAX_ORDER) return refusal("stellar/position-malformed");
  return ((BigInt(ledger) << 32n) | (BigInt(order) << 12n)).toString();
}

/**
 * The ledger and the application order of a position. A value that is not a decimal string with no sign and no
 * leading zero below 2^64, one whose low 12 bits are not zero, or one whose order is 0, is `stellar/position-malformed`.
 */
export function parseStellarPosition(p: unknown): { ledger: number; order: number } | Refusal {
  if (typeof p !== "string" || !POSITION.test(p)) return refusal("stellar/position-malformed");
  const v = BigInt(p);
  if (v >= U64_LIMIT || (v & 0xfffn) !== 0n) return refusal("stellar/position-malformed");
  const order = Number((v >> 12n) & BigInt(MAX_ORDER));
  if (order === 0) return refusal("stellar/position-malformed");
  return { ledger: Number(v >> 32n), order };
}

/**
 * The largest position in ledger `ledger`, which every transaction of that ledger is at or before: the order 2^20 − 1.
 * It is the position that stands for "at or before ledger `ledger`" where a read compares positions.
 */
export function lastPositionOf(ledger: number): string {
  return ((BigInt(ledger) << 32n) | (BigInt(MAX_ORDER) << 12n)).toString();
}

/**
 * The `M…` strkey of the account `payee` and the id P, the position of a transaction. A `payee` that is not a `G…`
 * strkey is `stellar/option-malformed`, the code of a recipient that cannot take a muxed id; a P the position's codec
 * refuses is `stellar/position-malformed`.
 */
export function muxedFor(payee: string, position: string): string | Refusal {
  const p = parseStellarPosition(position);
  if (isRefusal(p)) return p;
  return muxedOf(payee, BigInt(position)) ?? refusal("stellar/option-malformed");
}

/**
 * The 40-byte payload of the signed-payload precondition: H's 32 bytes, then `value`, an `int64` (the authorization
 * entry's nonce, or a transaction's sequence number), 8 bytes big-endian two's complement. An `h` that is not a 32-byte
 * hash is `x402/payload-malformed`, as the other rails' carrier writers answer one; a `value` that is not a bigint in
 * the `int64` range `stellar/carrier-mismatch`.
 */
export function signedPayload(h: AtrHash, value: bigint): Uint8Array<ArrayBuffer> | Refusal {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (typeof value !== "bigint" || value < I64_MIN || value >= I64_LIMIT) return refusal("stellar/carrier-mismatch");
  const out = new Uint8Array(PAYLOAD_BYTES);
  out.set(toRawBytes(nh), 0);
  new DataView(out.buffer).setBigInt64(32, value, false);
  return out;
}

/**
 * H and the `int64` of a 40-byte payload: bytes of any other length, trailing bytes among them, are
 * `stellar/carrier-mismatch`.
 */
export function readSignedPayload(bytes: Uint8Array): { h: AtrHash; value: bigint } | Refusal {
  if (!(bytes instanceof Uint8Array) || bytes.length !== PAYLOAD_BYTES) return refusal("stellar/carrier-mismatch");
  let hex = "";
  for (let i = 0; i < 32; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  const value = new DataView(bytes.buffer, bytes.byteOffset + 32, 8).getBigInt64(0, false);
  return { h: `0x${hex}` as AtrHash, value };
}
