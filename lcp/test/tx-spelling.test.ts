// One spelling of a transaction id per rail. TON: x402's TON scheme gives the settlement's `transaction` as
// "Transaction hash (64-character hex string)", and TON Center v3 answers a transaction's `hash` in base64. The hex of
// the recorded mainnet transaction `KUEFV90QTjY7x+rW6N6rdn1C4kNYeIhioHGu/INLVDE=` is
// `echo KUEFV90QTjY7x+rW6N6rdn1C4kNYeIhioHGu/INLVDE= | base64 -d | xxd -p -c 64`. Tron: the transaction id is the
// SHA-256 of `raw_data`, which the node answers as `txID` in hex without `0x`; the vector file writes V1's with `0x`.
// Every other pairing keeps the id it is given.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, canonicalTx, type Binding } from "../src/index.js";

const TRON = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tron-lcp-trc20-memo.json", import.meta.url), "utf8"));
const binding = (id: string) => BINDINGS.find((b) => b.id === id) as Binding;
const TON_B64 = "KUEFV90QTjY7x+rW6N6rdn1C4kNYeIhioHGu/INLVDE=";
const TON_HEX = "29410557dd104e363bc7ead6e8deab767d42e24358788862a071aefc834b5431";

describe("canonicalTx", () => {
  it("TON: base64, base64url, unpadded, and hex in any case with or without 0x are one lowercase hex id", () => {
    const tvm = binding("x402/exact/tvm");
    const url = TON_B64.replace(/\+/g, "-").replace(/\//g, "_");
    for (const spelling of [TON_B64, url, url.replace(/=$/, ""), TON_HEX, TON_HEX.toUpperCase(), `0x${TON_HEX}`]) {
      expect(canonicalTx(tvm, spelling)).toBe(TON_HEX);
    }
    expect(canonicalTx(tvm, "not a hash")).toBe("not a hash");
    expect(canonicalTx(tvm, "AAAA")).toBe("AAAA");
  });

  it("Tron: the txID with or without 0x, in any case, is one lowercase hex id without 0x", () => {
    const tron = binding("x402/exact/tron/lcp-trc20-memo");
    const txid = TRON.V1.expectTxid as string;
    const bare = txid.slice(2);
    for (const spelling of [txid, bare, bare.toUpperCase(), `0x${bare.toUpperCase()}`]) {
      expect(canonicalTx(tron, spelling)).toBe(bare);
    }
    expect(canonicalTx(tron, TON_B64)).toBe(TON_B64);
  });

  it("every other pairing keeps the id it is given", () => {
    const evmTx = "0x9A11F56E00000000000000000000000000000000000000000000000000001010";
    for (const b of BINDINGS.filter((x) => x.id !== "x402/exact/tvm" && x.id !== "x402/exact/tron/lcp-trc20-memo")) {
      expect(canonicalTx(b, evmTx)).toBe(evmTx);
      expect(canonicalTx(b, TON_B64)).toBe(TON_B64);
    }
    expect(canonicalTx(undefined, TON_B64)).toBe(TON_B64);
  });
});
