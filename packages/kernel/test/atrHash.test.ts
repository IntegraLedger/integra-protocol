import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashAtr, isAtrHash } from "../src/atrHash.js";
import { hexToBytes } from "../src/hex.js";

type Case = {
  name: string;
  input: { encoding: "utf8" | "hex"; data: string };
  expected: string;
};
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/atrhash/compute-atrhash.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: Case[];
};

describe("hashAtr", () => {
  it.each(V.cases)("$name", async ({ input, expected }) => {
    const bytes =
      input.encoding === "utf8"
        ? new TextEncoder().encode(input.data)
        : hexToBytes(input.data);
    expect(await hashAtr(bytes)).toBe(expected);
  });
  it("accepts uppercase hex as a valid atrHash (any-case, decision A nuance i)", () => {
    expect(
      isAtrHash(
        "0x2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824",
      ),
    ).toBe(true);
  });
});

/**
 * `isAtrHash` is the protocol's primary validator — every rail's weld, every ref, every acceptance
 * runs through it — so its regex must be proved ANCHORED. Without a case presenting a valid hash with
 * something around it, both anchors could be dropped with the whole suite green.
 * That is the shape a hostile value takes: not a malformed hash, but a well-formed one embedded in a
 * larger string, so a substring match accepts what an exact match refuses.
 */
describe("isAtrHash is anchored at BOTH ends", () => {
  const H =
    "0x2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

  it("accepts the bare hash", () => {
    expect(isAtrHash(H)).toBe(true);
  });

  it("rejects a valid hash with anything PREFIXED — the `^` anchor", () => {
    expect(isAtrHash(`lcp:sha256:${H}`)).toBe(false);
    expect(isAtrHash(`00${H}`)).toBe(false);
    expect(isAtrHash(` ${H}`)).toBe(false);
    expect(isAtrHash(`0x${H}`)).toBe(false);
  });

  it("rejects a valid hash with anything APPENDED — the `$` anchor", () => {
    expect(isAtrHash(`${H}00`)).toBe(false);
    expect(isAtrHash(`${H} `)).toBe(false);
    expect(isAtrHash(`${H}\n`)).toBe(false);
    expect(isAtrHash(`${H}::PaymentSettled`)).toBe(false);
  });

  it("rejects a hash embedded mid-string", () => {
    expect(isAtrHash(`before${H}after`)).toBe(false);
  });

  it("rejects the near-misses either anchor alone would let through", () => {
    expect(isAtrHash(H.slice(0, -1))).toBe(false); // 63 hex digits
    expect(isAtrHash(`${H}f`)).toBe(false); // 65
    expect(isAtrHash(H.slice(2))).toBe(false); // no 0x
    expect(isAtrHash(`0X${H.slice(2)}`)).toBe(false); // uppercase prefix — canon requires lowercase 0x
    expect(isAtrHash("")).toBe(false);
  });
});
