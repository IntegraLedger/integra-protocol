// Stacks addresses in c32check. Expected values: stacks-core 4.0.5's own table for `c32_address` (stacks-network/
// stacks-core d736ba0, stacks-common/src/address/c32.rs:415-484, `test_addresses`), and @stacks/transactions 7.6.0's
// writer (`addressToString` of `addressFromVersionHash`, which calls c32check 2.0.0's `c32address`) for every version
// from 0 to 31 over edge and seeded hash160s.
import * as S from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import { c32Address } from "../src/internal/c32.js";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));

describe("c32check addresses", () => {
  it("stacks-core's table: five hash160s at versions 22, 0, 31, 20, 26 and 21", () => {
    const hashes = [
      "a46ff88886c2ef9762d970b4d2c63678835bd39d",
      "0000000000000000000000000000000000000000",
      "0000000000000000000000000000000000000001",
      "1000000000000000000000000000000000000001",
      "1000000000000000000000000000000000000000",
    ];
    const table: [number, string[]][] = [
      [22, ["SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7", "SP000000000000000000002Q6VF78", "SP00000000000000000005JA84HQ", "SP80000000000000000000000000000004R0CMNV", "SP800000000000000000000000000000033H8YKK"]],
      [0, ["S02J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKPVKG2CE", "S0000000000000000000002AA028H", "S000000000000000000006EKBDDS", "S080000000000000000000000000000007R1QC00", "S080000000000000000000000000000003ENTGCQ"]],
      [31, ["SZ2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQ9H6DPR", "SZ000000000000000000002ZE1VMN", "SZ00000000000000000005HZ3DVN", "SZ80000000000000000000000000000004XBV6MS", "SZ800000000000000000000000000000007VF5G0"]],
      [20, ["SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQVX8X0G", "SM0000000000000000000062QV6X", "SM00000000000000000005VR75B2", "SM80000000000000000000000000000004WBEWKC", "SM80000000000000000000000000000000JGSYGV"]],
      [26, ["ST2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQYAC0RQ", "ST000000000000000000002AMW42H", "ST000000000000000000042DB08Y", "ST80000000000000000000000000000006BYJ4R4", "ST80000000000000000000000000000002YBNPV3"]],
      [21, ["SN2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKP6D2ZK9", "SN000000000000000000003YDHWKJ", "SN00000000000000000005341MC8", "SN800000000000000000000000000000066KZWY0", "SN800000000000000000000000000000006H75AK"]],
    ];
    const got = table.map(([version]) => [version, hashes.map((h) => c32Address(version, bytes(h)))]);
    expect(got).toEqual(table);
  });

  it("every version from 0 to 31, as @stacks/transactions 7.6.0 writes it, over edge and seeded hash160s", () => {
    let s = 20261014n;
    const rand = () => {
      s ^= s << 13n; s &= (1n << 64n) - 1n; s ^= s >> 7n; s ^= s << 17n; s &= (1n << 64n) - 1n;
      return Number(s & 0xffn);
    };
    const hashes: Uint8Array[] = [new Uint8Array(20), new Uint8Array(20).fill(0xff)];
    for (let k = 1; k < 20; k++) hashes.push(Uint8Array.from({ length: 20 }, (_, i) => (i < k ? 0 : i === k ? 1 : rand())));
    for (let n = 0; n < 64; n++) hashes.push(Uint8Array.from({ length: 20 }, rand));
    let compared = 0;
    for (let version = 0; version < 32; version++) {
      for (const h of hashes) {
        const want = S.addressToString(S.addressFromVersionHash(version, Buffer.from(h).toString("hex")));
        expect([version, c32Address(version, h)]).toEqual([version, want]);
        compared++;
      }
    }
    expect(compared).toBe(32 * 85);
  });

  it("throws TypeError for a version c32check cannot write, or a hash160 that is not 20 bytes", () => {
    for (const version of [32, 255, -1, 1.5, Number.NaN]) {
      expect(() => c32Address(version, new Uint8Array(20)), String(version)).toThrow(TypeError);
    }
    for (const hash160 of [new Uint8Array(19), new Uint8Array(21), Array(20).fill(0) as unknown as Uint8Array]) {
      expect(() => c32Address(22, hash160)).toThrow(TypeError);
    }
  });
});
