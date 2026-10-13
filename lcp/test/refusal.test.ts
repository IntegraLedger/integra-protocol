// Refusals are values the package makes. A value handed in, whatever its members, is never passed back as a refusal:
// `isRefusal` recognises only what `refusal` made, and the readers that hand a caller's payment or credential back
// refuse one that carries a `refused` member with their own malformed-input code.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assemble, BINDINGS, isRefusal as rootIsRefusal } from "../src/index.js";
import { credentialOf } from "../src/mpp-challenge.js";
import { isRefusal, refusal } from "../src/refusal.js";

const dir = new URL("../vectors/", import.meta.url);
const presentedOf: Map<string, unknown> = new Map(
  readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .flatMap((n) => {
      const d = JSON.parse(readFileSync(new URL(n, dir), "utf8")) as {
        buyer?: { rows: { name: string; pairing: string; input: { presented?: unknown } }[] };
      };
      return (d.buyer?.rows ?? []).filter((r) => r.name === "B6").map((r) => [r.pairing, r.input.presented] as const);
    }),
);

/** A caller's value in the shape of a refusal, with a code the package never returns from these calls. */
const shaped = () => ({ refused: true, code: "claim/store-unavailable", extra: "<b>x</b>" });
const withRefused = (p: unknown) => ({ ...(p as object), refused: true, code: "claim/store-unavailable" });
const codeOf = (v: unknown): string | undefined => (isRefusal(v) ? v.code : undefined);

describe("isRefusal", () => {
  it("is true for a refusal the package made, and for assemble's refusal", async () => {
    expect(isRefusal(refusal("x402/not-v2"))).toBe(true);
    const r = await assemble("6f1c2b0e-8d4a-4c3b-9e2f-1a7d5c9b3e40", ["bind", {}], [["id", new TextEncoder().encode("{}")]]);
    expect(isRefusal(r)).toBe(true);
    expect(r).toEqual({ refused: true, code: "core/slot-reserved" });
  });

  it("is the package root's export", () => {
    expect(rootIsRefusal).toBe(isRefusal);
  });

  it("is false for a refusal another loaded copy of the module made, and that copy's isRefusal for this one's", async () => {
    // A query string makes the module loader evaluate the file again: a second copy, as two installs of the package give.
    const specifier = "../src/refusal.js?second-copy";
    const second = (await import(specifier)) as typeof import("../src/refusal.js");
    expect(second.isRefusal).not.toBe(isRefusal);
    expect(second.isRefusal(second.refusal("x402/not-v2"))).toBe(true);
    expect(isRefusal(second.refusal("x402/not-v2"))).toBe(false);
    expect(second.isRefusal(refusal("x402/not-v2"))).toBe(false);
  });

  it("is false for a value of the same shape that the package did not make", () => {
    const made = refusal("x402/not-v2");
    expect(isRefusal({ refused: true, code: "x402/not-v2" })).toBe(false);
    expect(isRefusal(JSON.parse(JSON.stringify(made)))).toBe(false);
    expect(isRefusal(structuredClone(made))).toBe(false);
    expect(isRefusal({ ...made })).toBe(false);
    for (const v of [null, undefined, "x402/not-v2", 0, true, []]) expect(isRefusal(v)).toBe(false);
  });
});

describe("no entry point passes a caller's value back as a refusal", () => {
  for (const b of BINDINGS) {
    it(`${b.id}: bound, and reference where the pairing has one, of a value shaped as a refusal return the package's own refusal`, async () => {
      const calls = [b.bound, (b as { reference?: unknown }).reference].filter((f) => typeof f === "function");
      expect(calls.length).toBeGreaterThan(0);
      for (const f of calls as ((p: unknown) => unknown)[]) {
        const out = await f(shaped());
        expect(isRefusal(out)).toBe(true);
        expect(codeOf(out)).not.toBe("claim/store-unavailable");
      }
    });
  }

  it("MPP's credential reader refuses a credential carrying a refused member as malformed", () => {
    const c = presentedOf.get("mpp/charge/tempo/push");
    expect(isRefusal(credentialOf(c))).toBe(false);
    expect(credentialOf(withRefused(c))).toEqual({ refused: true, code: "mpp/credential-malformed" });
    expect(credentialOf(shaped())).toEqual({ refused: true, code: "mpp/credential-malformed" });
  });

  const malformed: Record<string, string> = {
    "x402/exact/eip155/eip3009": "x402/payload-malformed",
    "x402/exact/casper": "casper/payload-malformed",
  };
  for (const b of BINDINGS) {
    const p = presentedOf.get(b.id);
    const expected = b.id.startsWith("mpp/") ? "mpp/credential-malformed" : malformed[b.id];
    if (p === undefined || expected === undefined) continue;
    it(`${b.id}: the signed payment with a refused member added is ${expected}`, async () => {
      const bound = b.bound as (p: unknown) => Promise<unknown>;
      expect(typeof (await bound(structuredClone(p)))).toBe("string");
      expect(await bound(withRefused(structuredClone(p)))).toEqual({ refused: true, code: expected });
    });
  }

  // The checkout pairings' unplaced hands an option back unchanged, so it refuses one that carries a refused member,
  // with the pairing's option-malformed code (docs/reference/refusals.md), as the readers above do for a payment.
  const options: Record<string, unknown> = {
    ack: { id: "opt_1" },
    acp: { requires_delegate_payment: true },
    ap2: { checkout: "chk_1" },
    card: { scheme: "visa-tap", checkout: "chk_1" },
    ucp: { checkout: "chk_1" },
  };
  const checkouts = BINDINGS.filter((b) => options[b.id.split("/")[0]!] !== undefined);
  it("the ACK, ACP, AP2, card and UCP pairings are twelve", () => {
    expect(checkouts.length).toBe(12);
  });
  for (const b of checkouts) {
    const ns = b.id.split("/")[0]!;
    const option = b.id.startsWith("ucp/booking/") ? { booking: "bk_1" } : options[ns];
    it(`${b.id}: unplaced refuses an option carrying a refused member as ${ns}/option-malformed`, () => {
      const unplaced = b.unplaced as (o: unknown) => unknown;
      expect(unplaced(option)).toBe(option);
      const expected = { refused: true, code: `${ns}/option-malformed` };
      for (const v of [withRefused(option), shaped(), refusal("ack/token-malformed")]) {
        const out = unplaced(v);
        expect(out).toEqual(expected);
        expect(isRefusal(out)).toBe(true);
      }
    });
  }

  // x402/exact/lnbtc/invoice-named's unplaced hands the option back unchanged as well (its invoice carries no hash, and
  // the ATR names the option as issued), so it refuses one that carries a refused member with x402/option-malformed,
  // the code its option checks give; a value that is not an object comes back as it is. The option is the vector
  // file's O_N.
  it("x402/exact/lnbtc/invoice-named: unplaced refuses an option carrying a refused member as x402/option-malformed", () => {
    const named = BINDINGS.find((b) => b.id === "x402/exact/lnbtc/invoice-named");
    const unplaced = named?.unplaced as (o: unknown) => unknown;
    const option = JSON.parse(readFileSync(new URL("x402-exact-lnbtc-invoice-named.json", dir), "utf8")).fixed.O_N as object;
    expect(unplaced(option)).toBe(option);
    const expected = { refused: true, code: "x402/option-malformed" };
    for (const v of [withRefused(option), shaped(), refusal("ack/token-malformed")]) {
      const out = unplaced(v);
      expect(out).toEqual(expected);
      expect(isRefusal(out)).toBe(true);
    }
    for (const v of ["lnbc", 7, null]) expect(unplaced(v)).toBe(v);
  });

  // The x402 EVM pairings' unplaced hands the option back unchanged as well (none carries the hash inside the option),
  // so it refuses one that carries a refused member with x402/option-malformed, the code their option checks give; a
  // value that is not an object comes back as it is. Each option is its pairing's vector file's.
  const evm = BINDINGS.filter((b) => /^x402\/[a-z-]+\/eip155\//.test(b.id));
  it("the x402 EVM pairings are seven", () => {
    expect(evm.map((b) => b.id).sort()).toEqual([
      "x402/auth-capture/eip155/eip3009",
      "x402/auth-capture/eip155/permit2",
      "x402/exact/eip155/eip3009",
      "x402/exact/eip155/erc7710",
      "x402/exact/eip155/erc7710-salt",
      "x402/exact/eip155/permit2",
      "x402/upto/eip155/permit2",
    ]);
  });
  for (const b of evm) {
    it(`${b.id}: unplaced refuses an option carrying a refused member as x402/option-malformed`, () => {
      const file = new URL(`${b.id.replaceAll("/", "-")}.json`, dir);
      const fixed = (JSON.parse(readFileSync(file, "utf8")) as { fixed: Record<string, object> }).fixed;
      const option = fixed["O"] ?? fixed["option"];
      expect(option).toBeTypeOf("object");
      const unplaced = b.unplaced as (o: unknown) => unknown;
      expect(unplaced(option)).toBe(option);
      const expected = { refused: true, code: "x402/option-malformed" };
      for (const v of [withRefused(option), shaped(), refusal("ack/token-malformed")]) {
        const out = unplaced(v);
        expect(out).toEqual(expected);
        expect(isRefusal(out)).toBe(true);
      }
      for (const v of ["exact", 7, null]) expect(unplaced(v)).toBe(v);
    });
  }

  // The x402 pairings on other rails whose option carries no hash hand it back unchanged too, so their unplaced refuses
  // one that carries a refused member with x402/option-malformed, the option-malformed code of the namespace the
  // pairing's id begins with; a value that is not an object comes back as it is. Each option is its vector file's O.
  const noCarrier = [
    "x402/exact/algorand",
    "x402/exact/aptos",
    "x402/exact/cardano",
    "x402/exact/casper",
    "x402/exact/ccd",
  ];
  for (const id of noCarrier) {
    it(`${id}: unplaced refuses an option carrying a refused member as x402/option-malformed`, () => {
      const b = BINDINGS.find((p) => p.id === id);
      expect(b).toBeDefined();
      const file = new URL(`${id.replaceAll("/", "-")}.json`, dir);
      const option = (JSON.parse(readFileSync(file, "utf8")) as { fixed: { O: object } }).fixed.O;
      expect(option).toBeTypeOf("object");
      const unplaced = b!.unplaced as (o: unknown) => unknown;
      expect(unplaced(option)).toBe(option);
      const expected = { refused: true, code: "x402/option-malformed" };
      for (const v of [withRefused(option), shaped(), refusal("ack/token-malformed")]) {
        const out = unplaced(v);
        expect(out).toEqual(expected);
        expect(isRefusal(out)).toBe(true);
      }
      for (const v of ["exact", 7, null]) expect(unplaced(v)).toBe(v);
    });
  }

  for (const b of BINDINGS) {
    const fetchPresented = (b as { fetchPresented?: (c: unknown, r: unknown) => Promise<unknown> }).fetchPresented;
    const p = presentedOf.get(b.id);
    if (fetchPresented === undefined || p === undefined || !b.id.startsWith("mpp/")) continue;
    it(`${b.id}: fetchPresented refuses a credential carrying a refused member before any read`, async () => {
      let reads = 0;
      const reader = new Proxy({}, { get: () => (reads++, () => Promise.reject(new Error("no read"))) });
      expect(await fetchPresented(withRefused(structuredClone(p)), reader)).toEqual({
        refused: true,
        code: "mpp/credential-malformed",
      });
      expect(reads).toBe(0);
    });
  }
});
