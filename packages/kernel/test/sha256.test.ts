import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hexToBytes } from "../src/hex.js";
import { sha256Hex } from "../src/sha256.js";

type Case = {
  name: string;
  input: { encoding: "utf8" | "hex"; data: string };
  expected: string;
};
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/sha256/digest.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: Case[];
};

/** The byte-input convention: utf8 -> UTF-8 encode; hex -> 0x-prefixed via hexToBytes. */
function decode({
  encoding,
  data,
}: {
  encoding: "utf8" | "hex";
  data: string;
}): Uint8Array {
  return encoding === "utf8"
    ? new TextEncoder().encode(data)
    : hexToBytes(data);
}

describe("sha256Hex", () => {
  it.each(V.cases)("$name", async ({ input, expected }) => {
    expect(await sha256Hex(decode(input))).toBe(expected);
  });
});
