// The expected ids are the implemented pairings: x402/exact/eip155/eip3009 first, then every
// other pairing's id by id, with the MPP pairings in MPP_BINDINGS' order. A2A is a carrier, not a pairing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import { exactTronMemo } from "../src/tron.js";
import { exactEip3009 } from "../src/x402.js";
import { rowsOf } from "./rows.js";

describe("BINDINGS", () => {
  it("lists exactly the implemented pairings", () => {
    expect(BINDINGS.map((b) => b.id)).toEqual([
      "x402/exact/eip155/eip3009",
      "ack/payment-request",
      "acp/checkout/delegated",
      "acp/checkout/undelegated",
      "ap2/checkout-mandate",
      "card/mastercard-vi/autonomous",
      "card/mastercard-vi/immediate",
      "card/seller-reference",
      "card/visa-tap",
      "mpp/charge/evm/authorization",
      "mpp/charge/evm/permit2",
      "mpp/charge/evm/transaction",
      "mpp/charge/evm/hash",
      "mpp/charge/tempo/memo",
      "mpp/charge/tempo/push",
      "mpp/session/evm",
      "mpp/session/tempo",
      "mpp/subscription/tempo",
      "mpp/charge/lightning",
      "mpp/session/lightning",
      "mpp/charge/hedera",
      "mpp/charge/solana",
      "mpp/charge/stellar",
      "mpp/charge/xrpl",
      "mpp/charge/nearintents",
      "mpp/session/hedera",
      "mpp/session/solana",
      "mpp/session/xrpl",
      "mpp/charge/card",
      "mpp/charge/stripe",
      "mpp/subscription/stripe",
      "mpp/charge/usdc/evm",
      "mpp/charge/usdc/solana",
      "mpp/charge/usdc/stacks",
      "mpp/charge/usdc/gateway",
      "ucp/booking/ap2-mandate",
      "ucp/booking/unsigned",
      "ucp/checkout/ap2-mandate",
      "ucp/checkout/unsigned",
      "x402/auth-capture/eip155/eip3009",
      "x402/auth-capture/eip155/permit2",
      "x402/batch-settlement/cloudflare",
      "x402/batch-settlement/eip155",
      "x402/batch-settlement/solana",
      "x402/exact/algorand",
      "x402/exact/aptos",
      "x402/exact/cardano",
      "x402/exact/casper",
      "x402/exact/ccd",
      "x402/exact/eip155/erc7710",
      "x402/exact/eip155/erc7710-salt",
      "x402/exact/eip155/permit2",
      "x402/exact/hedera",
      "x402/exact/hedera/transfer-executor",
      "x402/exact/lnbtc",
      "x402/exact/lnbtc/invoice-named",
      "x402/exact/near",
      "x402/exact/polkadot/lcp-assets-remark",
      "x402/exact/solana",
      "x402/exact/starknet",
      "x402/exact/stellar",
      "x402/exact/sui",
      "x402/exact/tron/lcp-trc20-memo",
      "x402/exact/tvm",
      "x402/exact/xrpl",
      "x402/upto/eip155/permit2",
      "x402/upto/solana",
    ]);
    expect(BINDINGS[0]).toBe(exactEip3009);
    expect(BINDINGS).toContain(exactTronMemo);
  });
});

// The record each pairing states carries the members of the field table in docs/concepts/binding.md ("What each
// binding proves") and no other.
describe("the record's members", () => {
  const page = readFileSync(new URL("../../docs/concepts/binding.md", import.meta.url), "utf8");
  const start = page.indexOf("| Field | Meaning |");
  const table = page.slice(start, page.indexOf("\n\n", start));
  const fields = new Set([...table.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((m) => m[1]));
  it("the field table lists nine members", () => {
    expect([...fields].sort()).toEqual([
      "buyerSigns",
      "canonical",
      "forwardIndexable",
      "onChain",
      "pattern",
      "profile",
      "proves",
      "publicProof",
      "zeroPartyRecoverable",
    ]);
  });
  it("every pairing's record carries only those members", () => {
    for (const b of rowsOf(BINDINGS, "BINDINGS, the implemented pairings", { exact: 67 }))
      for (const k of rowsOf(Object.keys(b.pattern), `${b.id}: its record's members`)) expect(fields.has(k), `${b.id}: ${k}`).toBe(true);
  });
});

// LCP §8.3's Zero-party recoverable property, atrHash reconstructed from the settlement transaction hash alone: a
// pairing declares zeroPartyRecoverable exactly where it has the recover that does so.
describe("recover and zeroPartyRecoverable", () => {
  it("every pairing has recover exactly where its pattern says H is recoverable from the chain alone", () => {
    const differ = BINDINGS.filter((b) => ("recover" in b && typeof b.recover === "function") !== b.pattern.zeroPartyRecoverable);
    expect(differ.map((b) => b.id)).toEqual([]);
    for (const id of ["x402/exact/eip155/permit2", "x402/upto/eip155/permit2", "mpp/session/evm", "mpp/session/tempo"]) {
      const b = BINDINGS.find((x) => x.id === id)!;
      expect(b.pattern.zeroPartyRecoverable, id).toBe(true);
    }
  });
});
