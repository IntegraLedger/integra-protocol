// The CRC32C a bag of cells carries is read without @ton/core (src/internal/tvm.ts), so a BoC whose checksum does not
// match is refused before its cells are decoded. Here it is held to @ton/core's crc32c.
import { crc32c as tonCrc32c } from "@ton/core";
import { describe, expect, it } from "vitest";
import { crc32c } from "../src/internal/tvm.js";
import { rowsOf } from "./rows.js";

describe("crc32c", () => {
  it("gives @ton/core's CRC32C, read least significant byte first, for inputs of 0 to 299 bytes", () => {
    const lengths = rowsOf(Array.from({ length: 300 }, (_, n) => n), "300 lengths", { exact: 300 });
    for (const n of lengths) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 151 + n * 31 + 7) & 0xff);
      expect([n, crc32c(b)]).toEqual([n, tonCrc32c(Buffer.from(b)).readUInt32LE(0)]);
    }
  });
});
