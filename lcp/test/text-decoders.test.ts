// Every TextDecoder in src/ decodes strict UTF-8 and keeps a leading byte-order mark as a character. The Encoding
// Standard's TextDecoder removes a leading U+FEFF unless ignoreBOM is true, which would read text that begins with
// EF BB BF as the text after the mark; RFC 8259 section 8.1 forbids the mark before networked JSON text.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rowsOf } from "./rows.js";

const srcDir = new URL("../src/", import.meta.url);
const decoders = rowsOf(
  readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .flatMap((f) => [...readFileSync(new URL(f, srcDir), "utf8").matchAll(/new TextDecoder\(([^)]*)\)/g)].map((m) => [f, m[1]!])),
  "src/, each new TextDecoder(…) in its .ts files",
);

describe("the text decoders in src", () => {
  it("src holds TextDecoders", () => {
    expect(decoders.length).toBeGreaterThan(0);
  });

  it.each(decoders)("%s: TextDecoder(%s) is fatal UTF-8 that keeps a leading byte-order mark", (_, args) => {
    expect(args).toBe('"utf-8", { fatal: true, ignoreBOM: true }');
  });
});
