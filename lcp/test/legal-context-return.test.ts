// legal-context-return.json: the Legal-Context header written and read, and the member by which an agreement option
// names the charge options it serves, read alone and against an ATR's bytes. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkLegalContextReturn, fromLegalContextHeader, isRefusal, servesOf, toLegalContextHeader } from "../src/index.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/legal-context-return.json", import.meta.url), "utf8"));
const bytes = (hex: string | undefined) => (hex === undefined ? undefined : Uint8Array.from(Buffer.from(hex, "hex")));
const hex = (b: Uint8Array | undefined) => (b === undefined ? undefined : Buffer.from(b).toString("hex"));

describe("legal-context-return.json", () => {
  for (const row of rowsOf([...V.write, ...V.writeRefusals], "legal-context-return.json write and writeRefusals", { exact: 5 })) {
    it(`toLegalContextHeader: ${row.case}`, () => {
      expect(toLegalContextHeader(row.h, bytes(row.returnValueHex))).toEqual(row.expect);
    });
  }
  for (const row of rowsOf(V.read, "legal-context-return.json read", { exact: 8 })) {
    it(`fromLegalContextHeader: ${row.case}`, () => {
      const got = fromLegalContextHeader(row.value);
      if (row.expect !== undefined) expect(got).toEqual(row.expect);
      else {
        expect(isRefusal(got)).toBe(false);
        if (isRefusal(got)) return;
        expect([got.h, hex(got.returnValue)]).toEqual([row.expectH, row.expectReturnValueHex]);
      }
    });
  }
  for (const row of rowsOf(V.readRefusals, "legal-context-return.json readRefusals", { exact: 30 })) {
    it(`fromLegalContextHeader refuses ${row.case}`, () => {
      expect(fromLegalContextHeader(row.value)).toEqual(row.expect);
    });
  }
  it("a header written is read back", () => {
    for (const row of V.write) {
      const header = toLegalContextHeader(row.h, bytes(row.returnValueHex)) as string;
      const got = fromLegalContextHeader(header);
      expect(isRefusal(got)).toBe(false);
      if (!isRefusal(got)) expect([got.h, hex(got.returnValue)]).toEqual([row.h.toLowerCase(), row.returnValueHex]);
    }
  });
  for (const row of rowsOf([...V.serves, ...V.servesRefusals], "legal-context-return.json serves and servesRefusals", { exact: 19 })) {
    it(`servesOf: ${row.case}`, () => {
      const atr = row.atr === undefined ? undefined : new TextEncoder().encode(V.atrs[row.atr]);
      expect(servesOf(row.option, atr) ?? null).toEqual(row.expect);
    });
  }
});

describe("legal-context-return.json check", () => {
  for (const row of rowsOf(V.check, "legal-context-return.json check")) {
    it(`checkLegalContextReturn: ${row.case}`, () => {
      const rv = bytes(row.record.returnValueHex);
      expect(checkLegalContextReturn(row.value, { h: row.record.h, ...(rv === undefined ? {} : { returnValue: rv }) })).toEqual(row.expect);
    });
  }
});
