// The reference of card/seller-reference, acp/checkout/undelegated and ucp/checkout/unsigned against
// vectors/charge-reference.json: the seller's own reference for the charge, with the checkout of the option it answers
// where the option names one; a malformed presentation refused first, then a malformed option.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { undelegated } from "../src/acp.js";
import { MAX_CHARGE_REFERENCE, sellerReference } from "../src/card.js";
import { unsigned } from "../src/ucp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/charge-reference.json", import.meta.url), "utf8"));
type Row = { pairing: string; case: string; presented: unknown; option: unknown; expect?: unknown; expectRefusal?: string };
const BY_ID: Record<string, { reference(presented: unknown, option: never): Promise<unknown> }> = {
  "card/seller-reference": sellerReference,
  "acp/checkout/undelegated": undelegated,
  "ucp/checkout/unsigned": unsigned,
};

describe("the seller's charge reference", () => {
  const rows = rowsOf(V.rows as Row[], "charge-reference.json rows", { min: 30 });
  it.each(rows.map((r) => [`${r.pairing}: ${r.case}`, r] as const))("%s", async (_name, row) => {
    const entry = BY_ID[row.pairing];
    expect(entry, row.pairing).toBeDefined();
    const r = await entry!.reference(row.presented, row.option as never);
    expect(r).toEqual(row.expectRefusal !== undefined ? { refused: true, code: row.expectRefusal } : row.expect);
  });

  it("covers each of the three pairings, and bounds the reference at 255 characters", () => {
    expect([...new Set(rows.map((r) => r.pairing))].sort()).toEqual(Object.keys(BY_ID).sort());
    expect(MAX_CHARGE_REFERENCE).toBe(255);
  });

  it("each of the three keeps claims false: nothing the payer signs carries H", () => {
    for (const entry of [sellerReference, undelegated, unsigned]) expect(entry.claims).toBe(false);
  });
});
