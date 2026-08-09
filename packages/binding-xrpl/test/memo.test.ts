import { describe, expect, it } from "vitest";
import {
  atrHashMemoBytes,
  buildLcpMemo,
  decodeLcpMemo,
  LCP_MEMO_FORMAT_HEX,
  LCP_MEMO_TYPE_HEX,
  readLcpMemoAtrHash,
  verifyLcpMemo,
  type XrplMemo,
} from "../src/memo.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const ATR_BARE_UPPER = ATR.slice(2).toUpperCase();

// Independent oracle: Node's Buffer, NOT the package's codec — the XRPL Memo sub-fields are hex of the
// ASCII label bytes, and MemoData is the bare hex of the 32 atrHash bytes.
const oracleType = Buffer.from("lcp/atrHash", "utf8")
  .toString("hex")
  .toUpperCase();
const oracleFormat = Buffer.from("application/octet-stream", "utf8")
  .toString("hex")
  .toUpperCase();

describe("buildLcpMemo / decodeLcpMemo", () => {
  it("builds a Memo with MemoType=hex(lcp/atrHash), MemoData=bare-upper-hex(atrHash), MemoFormat=hex(octet-stream)", () => {
    const { Memo } = buildLcpMemo(ATR);
    expect(Memo.MemoData).toBe(ATR_BARE_UPPER);
    expect(Memo.MemoType).toBe(oracleType); // cross-checked vs Buffer oracle
    expect(Memo.MemoFormat).toBe(oracleFormat);
    // and the package constants agree with the oracle
    expect(LCP_MEMO_TYPE_HEX).toBe(oracleType);
    expect(LCP_MEMO_FORMAT_HEX).toBe(oracleFormat);
    // XRPL Memo fields are hex — confirm the label hex round-trips back to UTF-8.
    expect(Buffer.from(Memo.MemoType ?? "", "hex").toString("utf8")).toBe(
      "lcp/atrHash",
    );
    expect(Buffer.from(Memo.MemoFormat ?? "", "hex").toString("utf8")).toBe(
      "application/octet-stream",
    );
  });

  it("MemoData is the hex of the 32 atrHash bytes (payload bytes == atrHash bytes)", () => {
    const { Memo } = buildLcpMemo(ATR);
    // decode the bare hex back to bytes and compare to the atrHash's raw bytes (independent Buffer path)
    const memoBytes = Buffer.from(Memo.MemoData, "hex");
    expect(memoBytes.length).toBe(32);
    expect(memoBytes.equals(Buffer.from(ATR.slice(2), "hex"))).toBe(true);
    expect(Buffer.from(atrHashMemoBytes(ATR)).equals(memoBytes)).toBe(true);
  });

  it("decodes back to a 0x-prefixed lower-case atrHash (round-trip)", () => {
    expect(decodeLcpMemo(buildLcpMemo(ATR))).toBe(ATR);
  });

  it("accepts an uppercase atrHash (ATR any-case canon) and normalises on decode", () => {
    const memo = buildLcpMemo(ATR.toUpperCase().replace("0X", "0x"));
    expect(memo.Memo.MemoData).toBe(ATR_BARE_UPPER);
    expect(decodeLcpMemo(memo)).toBe(ATR);
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() => buildLcpMemo("0xdead")).toThrow(/32-byte/);
    expect(() => buildLcpMemo("not-hex")).toThrow();
    expect(() => buildLcpMemo(`0x${"a".repeat(63)}`)).toThrow();
  });

  it("decodeLcpMemo returns null for a non-LCP memo (a scan skips it, not errors)", () => {
    // wrong MemoType
    const notLcp: XrplMemo = {
      Memo: { MemoType: "6e6f742d6c6370", MemoData: ATR_BARE_UPPER },
    };
    expect(decodeLcpMemo(notLcp)).toBeNull();
    // right MemoType, but MemoData is not a 32-byte value
    const badData: XrplMemo = {
      Memo: { MemoType: LCP_MEMO_TYPE_HEX, MemoData: "DEADBEEF" },
    };
    expect(decodeLcpMemo(badData)).toBeNull();
    // no MemoType at all
    const noType: XrplMemo = { Memo: { MemoData: ATR_BARE_UPPER } };
    expect(decodeLcpMemo(noType)).toBeNull();
  });

  it("tolerates a lower-case MemoType and a 0x-prefixed MemoData from a lenient producer", () => {
    const lenient: XrplMemo = {
      Memo: {
        MemoType: LCP_MEMO_TYPE_HEX.toLowerCase(),
        MemoData: `0x${ATR.slice(2)}`,
      },
    };
    expect(decodeLcpMemo(lenient)).toBe(ATR);
  });
});

describe("readLcpMemoAtrHash", () => {
  it("finds the LCP memo among others and returns 0x-prefixed lower-case", () => {
    const other: XrplMemo = {
      Memo: { MemoType: "6e6f742d6c6370", MemoData: "00" },
    };
    expect(readLcpMemoAtrHash([other, buildLcpMemo(ATR)])).toBe(ATR);
  });
  it("returns null for undefined / empty / no-LCP-memo arrays", () => {
    expect(readLcpMemoAtrHash(undefined)).toBeNull();
    expect(readLcpMemoAtrHash([])).toBeNull();
    expect(
      readLcpMemoAtrHash([
        { Memo: { MemoType: "6e6f742d6c6370", MemoData: "deadbeef" } },
      ]),
    ).toBeNull();
  });
});

describe("verifyLcpMemo", () => {
  it("confirms a matching memo and rejects a mismatched one", () => {
    const memos = [buildLcpMemo(ATR)];
    expect(verifyLcpMemo({ memos, atrHash: ATR })).toBe(true);
    expect(
      verifyLcpMemo({
        memos,
        atrHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
    expect(verifyLcpMemo({ memos: undefined, atrHash: ATR })).toBe(false);
  });

  it("rejects a malformed QUERIED atrHash, even against a well-formed memo", () => {
    const memos = [buildLcpMemo(ATR)];
    expect(verifyLcpMemo({ memos, atrHash: "0xdead" })).toBe(false);
    expect(verifyLcpMemo({ memos, atrHash: "" })).toBe(false);
  });

  it("matches case-insensitively, as the ATR canon requires", () => {
    expect(
      verifyLcpMemo({
        memos: [buildLcpMemo(ATR)],
        atrHash: `0x${ATR.slice(2).toUpperCase()}`,
      }),
    ).toBe(true);
  });
});

describe("decodeLcpMemo — the MemoType gate", () => {
  it("matches MemoType case-insensitively (rippled returns upper-case hex)", () => {
    // XRPL hex fields come back upper-case from rippled but a client may submit lower. Comparing
    // case-sensitively would refuse a genuine weld depending on which node answered.
    const upper = buildLcpMemo(ATR);
    const lower: XrplMemo = {
      Memo: {
        ...upper.Memo,
        MemoType: (upper.Memo.MemoType as string).toLowerCase(),
      },
    };
    expect(decodeLcpMemo(lower)).toBe(ATR);
  });

  it("returns null when MemoData is present but not a string", () => {
    const bad = {
      Memo: { MemoType: LCP_MEMO_TYPE_HEX, MemoData: 42 },
    } as unknown as XrplMemo;
    expect(decodeLcpMemo(bad)).toBeNull();
  });

  it("returns null for a memo object with no Memo field at all", () => {
    expect(decodeLcpMemo({} as unknown as XrplMemo)).toBeNull();
  });
});

describe("atrHashMemoBytes", () => {
  it("fails loud on a malformed atrHash rather than emitting short payload bytes", () => {
    expect(() => atrHashMemoBytes("0xdead")).toThrow(/32-byte/);
    expect(() => atrHashMemoBytes("not-hex")).toThrow(/32-byte/);
  });
});
