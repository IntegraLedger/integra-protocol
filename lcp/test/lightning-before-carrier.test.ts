// The Lightning pairings whose invoice the seller's node writes after H: `advertiseBeforeCarrier` places the offer the
// seller's stack sends to `issue`, before any invoice exists. It makes every check `advertise` makes except those on
// the invoice. The offers are the vectors' own (L3, S1) with the invoice removed, as `unplaced` leaves them;
// the placements and refusal codes are the vectors' and the entry point's closed codes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, canonicalJson, type AtrHash, type Json } from "../src/index.js";
import type { MppChallenge } from "../src/mpp.js";
import { chargeLightning, sessionLightning } from "../src/lightning.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const C = load("mpp-charge-lightning.json");
const S = load("mpp-session-lightning.json");
const V = load("x402-exact-lnbtc.json");
const H: AtrHash = V.fixed.H;

function set<T>(base: T, changes: Record<string, unknown>): T {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    if (value === undefined) delete at[keys[keys.length - 1]!];
    else at[keys[keys.length - 1]!] = value;
  }
  return copy as T;
}
const encode = (request: Json) => Buffer.from(canonicalJson(request) as string).toString("base64url");
const challengeOf = (v: { challenge: object; request: Json }, requestSet = {}): MppChallenge =>
  ({ ...v.challenge, request: encode(set(v.request, requestSet)) }) as MppChallenge;
const opaqueOf = (c: MppChallenge) => JSON.parse(Buffer.from(c.opaque!, "base64url").toString("utf8"));

describe("mpp/charge/lightning before its invoice", () => {
  const offer = challengeOf(C.L3, { "methodDetails.invoice": undefined });

  it("advertise refuses the challenge without its invoice", () => {
    expect(chargeLightning.advertise([offer], H, C.fixed.link, offer)).toEqual({ refused: true, code: "ln/invoice-malformed" });
  });

  it("advertiseBeforeCarrier places it with L3's id and the legal context", () => {
    const placed = chargeLightning.advertiseBeforeCarrier([offer], H, C.fixed.link, offer) as MppChallenge[];
    expect(placed[0]!.id).toBe(C.L3.expectId);
    expect(placed[0]!.request).toBe(offer.request);
    expect(opaqueOf(placed[0]!)).toMatchObject({ legalContextUrl: C.fixed.link });
  });

  it.each([
    ["a request description", { description: "Weather" }, "ln/description-present"],
    ["no payment hash", { "methodDetails.paymentHash": undefined }, "ln/payment-hash-required"],
    ["a network MPP Lightning does not name", { "methodDetails.network": "litecoin" }, "ln/currency-network"],
  ])("still refuses %s", (_, requestSet, code) => {
    const bad = challengeOf(C.L3, { "methodDetails.invoice": undefined, ...requestSet });
    expect(chargeLightning.advertiseBeforeCarrier([bad], H, C.fixed.link, bad)).toEqual({ refused: true, code });
  });
});

describe("mpp/session/lightning before its deposit invoice", () => {
  const offer = challengeOf(S.S1, { depositInvoice: undefined });

  it("advertise refuses the challenge without its deposit invoice", () => {
    expect(sessionLightning.advertise([offer], H, S.fixed.link, offer)).toEqual({ refused: true, code: "ln/invoice-malformed" });
  });

  it("advertiseBeforeCarrier places it; its request is S1's unplaced request", () => {
    const placed = sessionLightning.advertiseBeforeCarrier([offer], H, S.fixed.link, offer) as MppChallenge[];
    expect(JSON.parse(Buffer.from(placed[0]!.request, "base64url").toString("utf8"))).toEqual(S.S1.expectUnplacedRequest);
    expect(opaqueOf(placed[0]!)).toMatchObject({ legalContextUrl: S.fixed.link });
  });

  it("still refuses a challenge with no payment hash", () => {
    const bad = challengeOf(S.S1, { depositInvoice: undefined, paymentHash: undefined });
    expect(sessionLightning.advertiseBeforeCarrier([bad], H, S.fixed.link, bad)).toEqual({ refused: true, code: "ln/payment-hash-required" });
  });

  it("still refuses a network MPP Lightning does not name", () => {
    const bad = challengeOf(S.S1, { depositInvoice: undefined, methodDetails: { network: "litecoin" } });
    expect(sessionLightning.advertiseBeforeCarrier([bad], H, S.fixed.link, bad)).toEqual({ refused: true, code: "ln/currency-network" });
  });
});

describe("which pairings declare a carrier written after H", () => {
  it("exactly the two whose invoice the seller's node writes after H", () => {
    const ids = BINDINGS.filter((b) => typeof (b as { advertiseBeforeCarrier?: unknown }).advertiseBeforeCarrier === "function").map((b) => b.id);
    expect(ids.sort()).toEqual(["mpp/charge/lightning", "mpp/session/lightning"]);
  });
});
