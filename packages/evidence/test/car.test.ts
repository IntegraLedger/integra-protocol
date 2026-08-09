import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  atrHashFromCid,
  CidError,
  cidForAtrHash,
  cidForBytes,
  decodeCar,
  encodeCarBlocksHex,
  RAW_BLOCK_MAX_BYTES,
} from "../src/car.js";

const V = (
  name: string,
): {
  cases: { name: string; input: unknown; expected?: unknown; error?: string }[];
} =>
  JSON.parse(
    readFileSync(
      new URL(`../../../vectors/evidence/${name}`, import.meta.url),
      "utf8",
    ),
  );

function decodeInput(i: { encoding: string; data: string }): Uint8Array {
  if (i.encoding === "utf8") return new TextEncoder().encode(i.data);
  const h = i.data.slice(2);
  return Uint8Array.from(
    (h.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)),
  );
}
const toHex = (u8: Uint8Array): string =>
  [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("CARv1 determinism (spec-derived, @ipld/car-confirmed vectors)", () => {
  const cases = V("car-determinism.json").cases;
  it.each(cases)("$name", async ({ input, expected }) => {
    const { blocks, rootIndex } = input as {
      blocks: { encoding: string; data: string }[];
      rootIndex: number;
    };
    const hex = await encodeCarBlocksHex(blocks.map(decodeInput), rootIndex);
    expect(hex).toBe(expected);
  });
});

describe("CID == atrHash (raw-CIDv1)", () => {
  const cases = V("cid-atrhash.json").cases;
  it.each(cases)("$name", ({ input, expected, error }) => {
    if (error !== undefined) {
      try {
        cidForAtrHash(input as string);
        throw new Error("expected a CidError");
      } catch (e) {
        expect(e).toBeInstanceOf(CidError);
        expect((e as CidError).code).toBe(error);
      }
    } else {
      expect(cidForAtrHash(input as string)).toBe(expected);
    }
  });

  it("atrHashFromCid inverts cidForAtrHash (round-trip)", () => {
    const atr =
      "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    expect(atrHashFromCid(cidForAtrHash(atr))).toBe(atr);
  });
});

describe("cidForBytes — the 1 MiB raw-block ceiling (fail-loud)", () => {
  it("hashes a small block to a raw-CIDv1", async () => {
    const cid = await cidForBytes(new TextEncoder().encode("hello"));
    expect(cid).toBe(
      "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq",
    );
  });
  it("refuses a block over 1 MiB (would chunk into a dag-pb tree, breaking CID == atrHash)", async () => {
    const oversize = new Uint8Array(RAW_BLOCK_MAX_BYTES + 1);
    await expect(cidForBytes(oversize)).rejects.toThrow(/ceiling/);
  });
  it("accepts a block exactly at the ceiling", async () => {
    await expect(
      cidForBytes(new Uint8Array(RAW_BLOCK_MAX_BYTES)),
    ).resolves.toMatch(/^bafk/);
  });
});

describe("decodeCar round-trips encodeCar", () => {
  it("recovers the root and every block from a two-block CAR", async () => {
    const a = new TextEncoder().encode("hello");
    const b = new TextEncoder().encode("world");
    const hex = await encodeCarBlocksHex([a, b], 0);
    const car = Uint8Array.from(
      (hex.match(/../g) ?? []).map((x) => Number.parseInt(x, 16)),
    );
    const decoded = decodeCar(car);
    expect(decoded.roots).toHaveLength(1);
    expect(decoded.roots[0]).toBe(await cidForBytes(a));
    expect(decoded.blocks.map((bl) => toHex(bl.bytes))).toEqual([
      toHex(a),
      toHex(b),
    ]);
    expect(decoded.blocks[0]?.cid).toBe(await cidForBytes(a));
  });
});
