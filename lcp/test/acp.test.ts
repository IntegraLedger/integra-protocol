// Runs acp-checkout.json through the acp entry point. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assemble, canonicalJson, type AtrHash, type Json } from "../src/index.js";
import { delegated, issuedDigest, tie, undelegated, type Presented, type Session, type Unsigned } from "../src/acp.js";

const V = JSON.parse(readFileSync(new URL("../vectors/acp-checkout.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const utf8 = new TextEncoder();

/** Expands `{"$repeat": [s, n]}` into s repeated n times. */
function expand(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expand);
  if (typeof v === "object" && v !== null) {
    const r = (v as { $repeat?: [string, number] }).$repeat;
    if (r !== undefined) return r[0].repeat(r[1]);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
  }
  return v;
}

const pairings = { delegated, undelegated } as const;

describe("acp-checkout.json", () => {
  it("V1: the slot is the acp value in A, and assembling A's parts gives A and H", async () => {
    const slot = tie(V.V1.options);
    expect(slot).toEqual(V.V1.expectSlot);
    expect(canonicalJson(slot[1] as unknown as Json)).toBe(V.V1.expectSlotText);
    expect(V.fixed.A).toContain(`"acp":${V.V1.expectSlotText}`);
    expect(V.fixed.A).not.toContain(H.slice(2));
    const a = V.V1.assemble;
    const out = await assemble(
      a.id,
      slot,
      a.content.map(([s, text]: [string, string]) => [s, utf8.encode(text)] as const),
    );
    if ("refused" in out) throw new Error(out.code);
    expect(new TextDecoder().decode(out.bytes)).toBe(a.expectBytes);
    expect(out.atrHash).toBe(a.expectHash);
  });

  it("V2: advertise and read", () => {
    const a = V.V2.advertise;
    const session = delegated.advertise(a.doc, a.h, a.link, a.offer);
    expect(session).toEqual(V.V2.expectSession);
    const r = delegated.read(session as Session);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link }).toEqual(V.V2.expectRead);
    expect(r.offer.session).toEqual(V.V2.expectSession);
    const upper = { ...(session as Session), id: V.V2.readUpperCaseId.id };
    expect((delegated.read(upper) as { h: AtrHash }).h).toBe(V.V2.readUpperCaseId.expectH);
    expect(delegated.advertise(V.V2.idConflict.doc, a.h, a.link, a.offer)).toEqual(V.V2.idConflict.expect);
    expect(delegated.advertise(a.doc, a.h, V.V2.httpLink.link, a.offer)).toEqual(V.V2.httpLink.expect);
  });

  it("V3: option digests", async () => {
    for (const row of V.V3.digests) expect(await issuedDigest(row.option)).toBe(row.expect);
  });

  it("V4: build, complete and bound", async () => {
    const u = (await delegated.build(V.V4.choice, V.V4.h)) as Unsigned;
    expect(u.allowance).toEqual(V.V4.expectAllowance);
    expect(Object.keys(u.allowance)).toEqual(Object.keys(V.V4.expectAllowance));
    const request: Presented = { allowance: u.allowance, payment_method: { type: "card" } };
    expect(u.complete(request)).toBe(request);
    expect(await delegated.bound(request)).toBe(V.V4.expectBound);
    const changed = { ...request, allowance: { ...u.allowance, ...{ checkout_session_id: V.V4.changedSessionId.checkout_session_id } } };
    expect(u.complete(changed)).toEqual(V.V4.changedSessionId.expect);
    expect(await delegated.build({ ...V.V4.choice, currency: V.V4.upperCurrency.currency }, V.V4.h)).toEqual(
      V.V4.upperCurrency.expect,
    );
  });

  it("V4: the allowance handed out is a copy; changing it does not change what complete accepts", async () => {
    const u = (await delegated.build(V.V4.choice, V.V4.h)) as Unsigned;
    const given = u.allowance;
    given.checkout_session_id = V.fixed.otherH;
    expect(u.complete({ allowance: given })).toEqual(V.V4.changedSessionId.expect);
  });

  it("V5: the undelegated pairing reads, and neither builds nor bounds", async () => {
    const r = undelegated.read(V.V5.session);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link }).toEqual(V.V5.expectRead);
    expect(await undelegated.build(V.V4.choice, H)).toEqual(V.V5.expectBuild);
    expect(await undelegated.bound({ allowance: V.V4.expectAllowance })).toEqual(V.V5.expectBound);
  });

  it("V6: a top-level legal_context is never read", () => {
    expect(delegated.read(V.V6.doc)).toEqual(V.V6.expect);
    expect(undelegated.read(V.V6.doc)).toEqual(V.V6.expect);
  });

  it("plant: unsigned metadata naming another hash never stands in for the id", () => {
    expect(delegated.read(V.plant.doc)).toEqual(V.plant.expect);
    expect(undelegated.read(V.plant.doc)).toEqual(V.plant.expect);
  });

  it("each record states its pattern, and neither pairing claims", () => {
    for (const b of [delegated, undelegated]) {
      const { proves, ...rest } = b.pattern;
      expect({ ...rest, claims: b.claims }).toEqual(V.patterns[b.id]);
      expect(proves.startsWith("Before this payment, the buyer signed and paid an agreement transaction")).toBe(true);
      expect(b.unplaced(V.V1.options[0])).toBe(V.V1.options[0]);
    }
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of V.agreedRefusals.rows) {
      const [name, fn] = row.call.split(".") as [keyof typeof pairings, "advertise" | "read" | "build" | "bound"];
      const args = expand(row.args) as unknown[];
      const out = await (pairings[name][fn] as (...a: unknown[]) => unknown)(...args);
      const got =
        typeof out === "object" && out !== null && "allowance" in out && !("refused" in out)
          ? { allowance: (out as Unsigned).allowance }
          : out;
      expect(got, row.case).toEqual(row.expect);
    }
  });
});
