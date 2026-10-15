/**
 * The x402 payment a TON payer presents, and the CRC32C a bag of cells carries. `../tvm.ts` returns the payment from
 * `complete`, and the root names it among the payments `Presented` covers; no entry point exports either name.
 */
import type { X402Payment } from "./x402.js";

export type TvmPayment = X402Payment<{ settlementBoc: string; asset: string }>;

/** CRC-32C's reflected polynomial, 0x1EDC6F41 bit-reversed. */
const CRC32C_POLY = 0x82f63b78;
const CRC32C_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ CRC32C_POLY : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * The CRC-32C (Castagnoli) of the bytes, as an unsigned 32-bit number: the checksum a bag of cells with the CRC flag
 * holds in its last four bytes, least significant byte first (ton-blockchain/ton `crypto/vm/boc.cpp`, `td::crc32c`).
 * `@ton/core`'s `crc32c` gives the same four bytes; this reads them without it.
 */
export function crc32c(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC32C_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
