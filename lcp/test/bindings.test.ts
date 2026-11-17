// BINDINGS is the registry of implemented pairings, x402/exact/eip155/eip3009 first. A2A is a carrier, not a pairing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import { exactTronMemo } from "../src/tron.js";
import { exactEip3009 } from "../src/x402.js";
import { rowsOf } from "./rows.js";

describe("BINDINGS", () => {
  it("start with x402/exact/eip155/eip3009 and hold the Tron pairing of its own entry point", () => {
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
  it("the field table lists five members", () => {
    expect([...fields].sort()).toEqual(["forwardIndexable", "onChain", "pattern", "profile", "zeroPartyRecoverable"]);
  });
  it("every pairing's record carries only those members, and every one but x402/exact/starknet's names its pattern", () => {
    for (const b of rowsOf(BINDINGS, "BINDINGS, the implemented pairings")) {
      for (const k of rowsOf(Object.keys(b.pattern), `${b.id}: its record's members`)) expect(fields.has(k), `${b.id}: ${k}`).toBe(true);
      expect(b.pattern.pattern === undefined, b.id).toBe(b.id === "x402/exact/starknet");
    }
  });
});

// LCP §8.3's Zero-party recoverable property, atrHash reconstructed from the settlement transaction hash alone: a
// pairing declares zeroPartyRecoverable exactly where it has the recover that does so, save x402/exact/starknet, whose
// recover gives the 250 of H's bits the chain holds (x402-exact-starknet.md, rule 23), and x402/exact/xrpl, whose recover
// gives the InvoiceID, the SHA-256 of H's LCP string (x402-exact-xrpl.md, rule 5): neither reconstructs H; and the two
// auth-capture pairings, whose recover gives PaymentInfo.salt, which is H only where the option binds neither a receiver
// authorizer nor a policy, and otherwise a commitment over them and H (x402-auth-capture-eip155.md).
describe("recover and zeroPartyRecoverable", () => {
  it("every pairing has recover exactly where its pattern says H is recoverable from the chain alone, save Starknet's low bits, XRPL's digest and auth-capture's salt", () => {
    const carriedInPlace = ["x402/exact/starknet", "x402/exact/xrpl"];
    const saltOnly = ["x402/auth-capture/eip155/eip3009", "x402/auth-capture/eip155/permit2"];
    const differ = BINDINGS.filter(
      (b) =>
        !carriedInPlace.includes(b.id) &&
        !saltOnly.includes(b.id) &&
        ("recover" in b && typeof b.recover === "function") !== ("pattern" in b && b.pattern.zeroPartyRecoverable),
    );
    for (const id of carriedInPlace) {
      const b = BINDINGS.find((x) => x.id === id)!;
      expect(["recover" in b && typeof b.recover === "function", "pattern" in b && b.pattern.zeroPartyRecoverable], id).toEqual([true, false]);
    }
    expect(differ.map((b) => b.id)).toEqual([]);
    for (const id of saltOnly) {
      const b = BINDINGS.find((x) => x.id === id)!;
      expect(["recover" in b && typeof b.recover === "function", "pattern" in b && b.pattern.zeroPartyRecoverable], id).toEqual([true, false]);
    }
    for (const id of ["x402/exact/eip155/permit2", "x402/upto/eip155/permit2", "mpp/session/evm", "mpp/session/tempo"]) {
      const b = BINDINGS.find((x) => x.id === id)!;
      expect("pattern" in b && b.pattern.zeroPartyRecoverable, id).toBe(true);
    }
  });
});
