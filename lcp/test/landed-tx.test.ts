import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, type Binding } from "../src/index.js";

const vectors = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}.json`, import.meta.url), "utf8"));
const SOLANA = vectors("mpp-charge-solana");
const XRPL = vectors("mpp-charge-xrpl");
const SESSION_SOLANA = vectors("mpp-session-solana");

const challenge = { id: "x", realm: "api.seller.example", method: "m", intent: "charge", request: "e30" };
const credential = (payload: Record<string, unknown>) => ({ challenge, payload });
const byId = (id: string): Binding => BINDINGS.find((b) => b.id === id)!;

// Push mode is any pairing whose entry point exports fetchPresented or landedTx. Each names the transaction it pushed.
// The EVM session is none: an opening funded by a `hash`, which its payer broadcasts, is no part of it.
const PUSHED_HASH = `0x${"55".repeat(32)}`;
const ROWS: readonly [id: string, payload: Record<string, unknown>, landed: string][] = [
  ["mpp/charge/solana", { type: "signature", signature: SOLANA.refusals[1].payload.signature }, SOLANA.refusals[1].payload.signature],
  ["mpp/charge/solana/unsponsored", { type: "signature", signature: SOLANA.refusals[1].payload.signature }, SOLANA.refusals[1].payload.signature],
  ["mpp/charge/xrpl", { type: "hash", hash: XRPL.refusals[0].payload.hash }, XRPL.refusals[0].payload.hash],
  ["mpp/charge/tempo/split-memo/push", { type: "hash", hash: PUSHED_HASH }, PUSHED_HASH],
  ["mpp/session/solana/stock", SESSION_SOLANA.stock.credential.payload, SESSION_SOLANA.stock.expectTransaction],
];

describe("landedTx on push-mode pairings", () => {
  it("is exactly on the pairings that read a landed payment", () => {
    const push = BINDINGS.filter((b) => "fetchPresented" in b).map((b) => b.id);
    const landed = BINDINGS.filter((b) => typeof b.landedTx === "function").map((b) => b.id);
    expect(landed.filter((id) => (push as readonly string[]).includes(id))).toEqual(push);
    expect([...landed].sort()).toEqual(ROWS.map(([id]) => id).sort());
  });

  for (const [id, payload, landed] of ROWS) {
    it(`${id}: the pushed transaction, and nothing for any other credential`, () => {
      const b = byId(id);
      expect(b.landedTx?.(credential(payload))).toBe(landed);
      const other = "type" in payload ? { ...payload, type: "transaction" } : { ...payload, action: "voucher" };
      expect(b.landedTx?.(credential(other))).toBeUndefined();
      for (const junk of [undefined, null, "x", {}, { challenge, payload: "x" }]) expect(b.landedTx?.(junk)).toBeUndefined();
    });
  }
});
