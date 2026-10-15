// Functions whose work is linear in their input, held without a clock: each shape is read at two sizes, and the work
// test/work.ts counts at the larger size is at most two and a half times the work at the smaller, where work quadratic
// in the input would be about four times.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readEntry } from "../src/internal/avm.js";
import { workOf } from "./work.js";

describe("readEntry: an Algorand payment entry is decoded in time linear in its bytes", () => {
  // V2's payment entry of x402-exact-algorand.json, {sig, txn}, and its transaction id (py-algorand-sdk).
  const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
  const V2 = Uint8Array.from(Buffer.from(V.V2.expectPaymentGroup[1] as string, "base64"));
  const V2_TXID: string = V.V2.expectPaymentTxid;
  // The msgpack specification's formats.
  const str = (t: string) => [0xa0 | t.length, ...Buffer.from(t)];
  const mapHead = (n: number) => (n < 16 ? [0x80 | n] : [0xde, n >> 8, n & 0xff]);
  const arrayHead = (n: number) => (n < 16 ? [0x90 | n] : [0xdc, n >> 8, n & 0xff]);
  const uint = (v: number) => (v < 0x80 ? [v] : v < 0x100 ? [0xcc, v] : [0xcd, v >> 8, v & 0xff]);
  const NIL = 0xc0;
  // V2 is a map of two members, `sig` (a bin of 64 bytes) and `txn` (a map of eleven).
  const SIG_MEMBER = [...V2.subarray(1, 1 + 4 + 2 + 64)];
  const TXN_MEMBERS = [...V2.subarray(1 + 4 + 2 + 64 + 4 + 1)];

  /**
   * V2's members and `msig: {subsig: [nil × long], subsig: [] × repeats}`: the last list is empty, so the multisignature
   * is at its default, both readers read V2's transaction, and the entry reads with V2's id.
   */
  function repeatedList(long: number, repeats: number): Uint8Array {
    const msig = [...mapHead(1 + repeats), ...str("subsig"), ...arrayHead(long), ...new Array<number>(long).fill(NIL)];
    for (let k = 0; k < repeats; k++) msig.push(...str("subsig"), ...arrayHead(0));
    return Uint8Array.from([...mapHead(3), ...V2.subarray(1), ...str("msig"), ...msig]);
  }

  /**
   * V2 with `sp: {r: {0 … long-1: nil}, r: {} × repeats, r: nil}` added to its transaction: the last `r` is nil, so the
   * state proof is at its default and the entry reads with V2's id.
   */
  function repeatedMap(long: number, repeats: number): Uint8Array {
    const r = [...str("r"), ...mapHead(long)];
    for (let k = 0; k < long; k++) r.push(...uint(k), NIL);
    for (let k = 0; k < repeats; k++) r.push(...str("r"), ...mapHead(0));
    r.push(...str("r"), NIL);
    const txn = [...mapHead(12), ...TXN_MEMBERS, ...str("sp"), ...mapHead(repeats + 2), ...r];
    return Uint8Array.from([0x82, ...SIG_MEMBER, ...str("txn"), ...txn]);
  }

  const cases: [string, (n: number) => Uint8Array, number][] = [
    ["a list member written long, then empty many times", (n) => repeatedList(n, n / 8), 768],
    ["a map member written long, then empty many times", (n) => repeatedMap(n, (2 * n) / 3), 384],
  ];
  for (const [name, shape, n] of cases) {
    it(`${name}: the work at twice the size is at most two and a half times the work`, () => {
      const small = shape(n);
      const large = shape(2 * n);
      // Both sizes within the 6,144 bytes an 8,192-character entry decodes to.
      expect(large.length).toBeLessThanOrEqual(6144);
      for (const b of [small, large]) expect(readEntry(b, 32)).toMatchObject({ txid: V2_TXID });
      const atSmall = workOf(() => readEntry(small, 32));
      const atLarge = workOf(() => readEntry(large, 32));
      expect(atSmall).toBeGreaterThan(n);
      expect(atLarge).toBeLessThanOrEqual(2.5 * atSmall);
    });
  }
});
