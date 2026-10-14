// Refusals are values the package makes. A value handed in, whatever its members, is never passed back as a refusal:
// `isRefusal` recognises only what `refusal` made, and the readers that hand a caller's payment or credential back,
// and the functions that return a copy of a seller's document, refuse one that carries a `refused` member with their
// own malformed-input code.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { place as a2aPlace } from "../src/a2a.js";
import { delegated as acpDelegated, undelegated as acpUndelegated } from "../src/acp.js";
import { checkoutMandate } from "../src/ap2.js";
import { assemble, BINDINGS, fromLcpString, isRefusal as rootIsRefusal } from "../src/index.js";
import { place } from "../src/mpp.js";
import { credentialOf } from "../src/mpp-challenge.js";
import { isRefusal, refusal } from "../src/refusal.js";
import { ap2Mandate as ucpAp2, bookingAp2Mandate as ucpBookingAp2, bookingUnsigned as ucpBookingUnsigned, unsigned as ucpUnsigned } from "../src/ucp.js";
import { rowsOf } from "./rows.js";

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
  for (const b of rowsOf(BINDINGS, "BINDINGS, every pairing")) {
    it(`${b.id}: bound, and reference where the pairing has one, of a value shaped as a refusal return the package's own refusal`, async () => {
      const calls = rowsOf(
        [b.bound, (b as { reference?: unknown }).reference].filter((f) => typeof f === "function"),
        `${b.id}: bound, and reference where the pairing has one`,
      );
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
  for (const b of rowsOf(BINDINGS, "BINDINGS", {
    keep: [
      "the pairings with a B6 credential: the MPP pairings, and the two x402 pairings this table names",
      (b) => presentedOf.get(b.id) !== undefined && (b.id.startsWith("mpp/") || malformed[b.id] !== undefined),
    ],
    leave: [
      "the pairings with no B6 credential in the vectors, and the other pairings outside MPP, which this table names no code for",
      (b) => presentedOf.get(b.id) === undefined || (!b.id.startsWith("mpp/") && malformed[b.id] === undefined),
    ],
  })) {
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
  const checkouts = rowsOf(BINDINGS, "BINDINGS", {
    exact: 12,
    keep: ["the ACK, ACP, AP2, card and UCP pairings", (b) => options[b.id.split("/")[0]!] !== undefined],
    leave: ["the x402 and MPP pairings, which the tests below take", (b) => b.id.startsWith("x402/") || b.id.startsWith("mpp/")],
  });
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
  const evm = rowsOf(BINDINGS, "BINDINGS", {
    exact: 7,
    keep: ["the x402 EVM pairings", (b) => /^x402\/[a-z-]+\/eip155\//.test(b.id)],
    leave: ["every other pairing, which the other unplaced tests here take", (b) => !/^x402\/[a-z-]+\/eip155\//.test(b.id)],
  });
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

  // On the x402 pairings of other rails whose option carries no hash, unplaced hands the option back as it is given, so
  // it refuses one that carries a refused member with x402/option-malformed, the option-malformed code of the namespace
  // the pairing's id begins with; a value that is not an object comes back as it is. Each option is its vector file's
  // O, and the batch pairings' are x402-batch-settlement.json's: the EVM channel's fixed option and EC1's accepted one.
  const batch = JSON.parse(readFileSync(new URL("x402-batch-settlement.json", dir), "utf8")) as {
    fixed: { evm: { option: object } };
    EC1: { payload: { accepted: object } };
  };
  const batchOptions: Record<string, object> = {
    "x402/batch-settlement/eip155": batch.fixed.evm.option,
    "x402/batch-settlement/cloudflare": batch.EC1.payload.accepted,
  };
  const noCarrier = [
    "x402/exact/algorand",
    "x402/exact/aptos",
    "x402/exact/cardano",
    "x402/exact/casper",
    "x402/exact/ccd",
    "x402/exact/hedera",
    "x402/exact/hedera/transfer-executor",
    "x402/exact/near",
    "x402/exact/polkadot/lcp-assets-remark",
    "x402/exact/starknet",
    "x402/exact/sui",
    "x402/exact/tron/lcp-trc20-memo",
    "x402/batch-settlement/eip155",
    "x402/batch-settlement/cloudflare",
  ];
  for (const id of noCarrier) {
    it(`${id}: unplaced refuses an option carrying a refused member as x402/option-malformed`, () => {
      const b = BINDINGS.find((p) => p.id === id);
      expect(b).toBeDefined();
      const file = new URL(`${id.replaceAll("/", "-")}.json`, dir);
      const option = batchOptions[id] ?? (JSON.parse(readFileSync(file, "utf8")) as { fixed: { O: object } }).fixed.O;
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

  // On the x402 pairings whose option carries the hash (in the member the pairing's carrier names), unplaced gives the
  // option as the seller issued it: without that member, or on x402/exact/stellar with payTo back to its base account.
  // It refuses an option that carries a refused member with x402/option-malformed before it removes anything, whether
  // or not the carrier is in place; a value that is not an object comes back as it is. Each option is the one its
  // pairing's vector file advertises (buyer row B2, the document's one option), with the carrier in place.
  const placedOf: Map<string, unknown> = new Map(
    readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .flatMap((n) => {
        const d = JSON.parse(readFileSync(new URL(n, dir), "utf8")) as {
          buyer?: { rows: { name: string; pairing: string; input: { doc?: { accepts?: unknown[] } } }[] };
        };
        return (d.buyer?.rows ?? [])
          .filter((r) => r.name === "B2" && r.pairing.startsWith("x402/") && r.input.doc?.accepts?.length === 1)
          .map((r) => [r.pairing, r.input.doc?.accepts?.[0]] as const);
      }),
  );
  const carrierX402 = [
    "x402/exact/solana",
    "x402/upto/solana",
    "x402/batch-settlement/solana",
    "x402/exact/xrpl",
    "x402/exact/stellar",
    "x402/exact/tvm",
    "x402/exact/lnbtc",
  ];
  for (const id of carrierX402) {
    it(`${id}: unplaced refuses an option carrying a refused member as x402/option-malformed`, () => {
      const option = placedOf.get(id);
      expect(option).toBeTypeOf("object");
      const unplaced = BINDINGS.find((b) => b.id === id)?.unplaced as (o: unknown) => unknown;
      const issued = unplaced(option);
      expect(isRefusal(issued)).toBe(false);
      expect(issued).not.toEqual(option);
      const expected = { refused: true, code: "x402/option-malformed" };
      for (const v of [withRefused(option), withRefused(issued), shaped(), refusal("ack/token-malformed")]) {
        const out = unplaced(v);
        expect(out).toEqual(expected);
        expect(isRefusal(out)).toBe(true);
      }
      for (const v of ["exact", 7, null]) expect(unplaced(v)).toBe(v);
    });
  }

  // The MPP pairings whose unplaced hands the challenge back as given (the hash rides in the challenge id and opaque,
  // never in request) refuse a challenge that carries a refused member with mpp/challenge-malformed, the code the
  // challenge checks give a challenge that is not challenge-shaped (docs/reference/refusals.md); a value that is not an
  // object comes back as it is. Each challenge is the one its pairing's vector file advertises (buyer row B2).
  const advertisedOf: Map<string, unknown> = new Map(
    readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .flatMap((n) => {
        const d = JSON.parse(readFileSync(new URL(n, dir), "utf8")) as {
          buyer?: { rows: { name: string; pairing: string; input: { doc?: unknown[] } }[] };
        };
        return (d.buyer?.rows ?? [])
          .filter((r) => r.name === "B2" && r.pairing.startsWith("mpp/"))
          .map((r) => [r.pairing, r.input.doc?.[0]] as const);
      }),
  );
  const sameChallenge = [
    "mpp/charge/evm/authorization",
    "mpp/charge/evm/permit2",
    "mpp/charge/evm/transaction",
    "mpp/charge/evm/hash",
    "mpp/charge/tempo/memo",
    "mpp/charge/tempo/push",
    "mpp/session/evm",
    "mpp/session/tempo",
    "mpp/subscription/tempo",
    "mpp/charge/hedera",
    "mpp/session/hedera",
    "mpp/session/solana",
    "mpp/session/xrpl",
    "mpp/charge/usdc/evm",
    "mpp/charge/usdc/stacks",
    "mpp/charge/usdc/gateway",
  ];
  it("the MPP pairings whose unplaced returns the advertised challenge as given are these sixteen", () => {
    const mpp = rowsOf(BINDINGS, "BINDINGS", {
      exact: 26,
      keep: ["the MPP pairings", (b) => b.id.startsWith("mpp/")],
      leave: ["the pairings of the other carriers, which the tests above take", (b) => !b.id.startsWith("mpp/")],
    });
    for (const b of mpp) expect(advertisedOf.get(b.id), b.id).toBeTypeOf("object");
    const same = mpp.filter((b) => (b.unplaced as (c: unknown) => unknown)(advertisedOf.get(b.id)) === advertisedOf.get(b.id));
    expect(same.map((b) => b.id).sort()).toEqual([...sameChallenge].sort());
    expect(sameChallenge.length).toBe(16);
  });
  for (const id of sameChallenge) {
    it(`${id}: unplaced refuses a challenge carrying a refused member as mpp/challenge-malformed`, () => {
      const challenge = advertisedOf.get(id);
      expect(challenge).toBeTypeOf("object");
      const unplaced = BINDINGS.find((b) => b.id === id)?.unplaced as (c: unknown) => unknown;
      expect(unplaced(challenge)).toBe(challenge);
      const expected = { refused: true, code: "mpp/challenge-malformed" };
      for (const v of [withRefused(challenge), shaped(), refusal("ack/token-malformed")]) {
        const out = unplaced(v);
        expect(out).toEqual(expected);
        expect(isRefusal(out)).toBe(true);
      }
      for (const v of ["charge", 7, null]) expect(unplaced(v)).toBe(v);
    });
  }

  // On the MPP pairings whose request carries the hash (in the member the pairing's carrier names), unplaced gives the
  // challenge with that member removed from request, or on mpp/charge/stellar with recipient back to its base account.
  // It refuses a challenge that carries a refused member with mpp/challenge-malformed before it removes anything,
  // whether or not the carrier is in place; a value that is not an object comes back as it is. Each challenge is the
  // one its pairing's vector file advertises (buyer row B2), with the carrier in place.
  const carrierMpp = [
    "mpp/charge/lightning",
    "mpp/session/lightning",
    "mpp/charge/solana",
    "mpp/charge/usdc/solana",
    "mpp/charge/xrpl",
    "mpp/charge/nearintents",
    "mpp/charge/stellar",
    "mpp/charge/card",
    "mpp/charge/stripe",
    "mpp/subscription/stripe",
  ];
  for (const id of carrierMpp) {
    it(`${id}: unplaced refuses a challenge carrying a refused member as mpp/challenge-malformed`, () => {
      const challenge = advertisedOf.get(id);
      expect(challenge).toBeTypeOf("object");
      const unplaced = BINDINGS.find((b) => b.id === id)?.unplaced as (c: unknown) => unknown;
      const issued = unplaced(challenge);
      expect(isRefusal(issued)).toBe(false);
      expect(issued).not.toEqual(challenge);
      const expected = { refused: true, code: "mpp/challenge-malformed" };
      for (const v of [withRefused(challenge), withRefused(issued), shaped(), refusal("ack/token-malformed")]) {
        const out = unplaced(v);
        expect(out).toEqual(expected);
        expect(isRefusal(out)).toBe(true);
      }
      for (const v of ["charge", 7, null]) expect(unplaced(v)).toBe(v);
    });
  }

  // The pairings of the two carrier blocks above are exactly those whose unplaced gives the advertised option or
  // challenge back as a copy without its carrier; every other x402 and MPP pairing gives it back as given.
  it("the x402 and MPP pairings whose unplaced removes a carrier are these seventeen", () => {
    const pairings = rowsOf(BINDINGS, "BINDINGS", {
      exact: 29 + 26,
      keep: ["the x402 and MPP pairings", (b) => b.id.startsWith("x402/") || b.id.startsWith("mpp/")],
      leave: ["the ACK, ACP, AP2, card and UCP pairings, whose unplaced the checkout tests above take", (b) => options[b.id.split("/")[0]!] !== undefined],
    });
    const removing = pairings.filter((b) => {
      const advertised = b.id.startsWith("mpp/") ? advertisedOf.get(b.id) : placedOf.get(b.id);
      expect(advertised, b.id).toBeTypeOf("object");
      return (b.unplaced as (o: unknown) => unknown)(advertised) !== advertised;
    });
    expect(removing.map((b) => b.id).sort()).toEqual([...carrierX402, ...carrierMpp].sort());
    expect(carrierX402.length + carrierMpp.length).toBe(17);
  });

  // So no pairing hands back a value that carries a refused member: every unplaced refuses one, with
  // mpp/challenge-malformed on MPP and, elsewhere, the option-malformed code of the namespace its id begins with.
  it("every pairing's unplaced refuses a value shaped as a refusal", () => {
    for (const b of rowsOf(BINDINGS, "BINDINGS, every pairing")) {
      const ns = b.id.split("/")[0]!;
      const code = ns === "mpp" ? "mpp/challenge-malformed" : `${ns}/option-malformed`;
      const out = (b.unplaced as (o: unknown) => unknown)(shaped());
      expect(out, b.id).toEqual({ refused: true, code });
      expect(isRefusal(out), b.id).toBe(true);
    }
  });

  for (const b of rowsOf(BINDINGS, "BINDINGS", {
    keep: [
      "the MPP pairings with fetchPresented and a B6 credential",
      (b) => (b as { fetchPresented?: unknown }).fetchPresented !== undefined && presentedOf.get(b.id) !== undefined && b.id.startsWith("mpp/"),
    ],
    leave: [
      "the pairings with no fetchPresented, no B6 credential, or outside MPP",
      (b) => (b as { fetchPresented?: unknown }).fetchPresented === undefined || presentedOf.get(b.id) === undefined || !b.id.startsWith("mpp/"),
    ],
  })) {
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

// A placement function returns a copy of the seller's document with the carrier placed: every x402 and MPP pairing's
// advertise, advertiseBeforeCarrier where a pairing has it, MPP's and A2A's place, and the ACP, AP2 and UCP pairings'
// advertise. Like unplaced, it refuses a document that carries a refused member before it places anything, with the
// malformed code of its namespace for that document (docs/reference/refusals.md): x402/option-malformed for an x402
// document, mpp/challenge-malformed for a challenge in an MPP challenge list, a2a/legal-context-malformed for an A2A
// task, acp/session-malformed for an ACP session, ap2/jws-malformed for an AP2 checkout payload and
// ucp/checkout-malformed for a UCP checkout or booking. Each document is its pairing's vector file's as the seller
// issued it: advertise places it into the vector file's own placed document, and advertiseBeforeCarrier and MPP's place
// place it without a refusal.
describe("every placement function refuses a seller document carrying a refused member", () => {
  const vectors = readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(new URL(n, dir), "utf8")) as Record<string, unknown>);
  const load = (n: string) => JSON.parse(readFileSync(new URL(n, dir), "utf8"));
  const advertisedDoc: Map<string, unknown> = new Map(
    vectors.flatMap((d) =>
      ((d["buyer"] as { rows: { name: string; pairing: string; input: { doc?: unknown } }[] } | undefined)?.rows ?? [])
        .filter((r) => r.name === "B2")
        .map((r) => [r.pairing, r.input.doc] as const),
    ),
  );
  type Place = (doc: unknown, h: unknown, link: unknown, offer: unknown, agreementUrl?: string) => unknown;
  const refused = (code: string) => ({ refused: true, code });

  // An x402 document as issued: buyer row B2's advertised document without its legal context, its one option without
  // the carrier (unplaced). The x402/exact/lnbtc invoice, which carries the hash, exists when advertise is called, so
  // advertise takes the option with it, and advertiseBeforeCarrier takes it without.
  const x402 = rowsOf(BINDINGS, "BINDINGS", {
    exact: 29,
    keep: ["the x402 pairings", (b) => b.id.startsWith("x402/")],
    leave: ["the pairings of the other carriers", (b) => !b.id.startsWith("x402/")],
  });
  it("the x402 pairings are twenty-nine, each with an advertised document of one option", () => {
    expect(x402.length).toBe(29);
    for (const b of x402) expect((advertisedDoc.get(b.id) as { accepts: unknown[] }).accepts.length, b.id).toBe(1);
  });
  const x402Calls = [
    ...x402.map((b) => [b.id, "advertise", b.advertise as Place, b.id !== "x402/exact/lnbtc"] as const),
    ...rowsOf(x402, "the x402 pairings", {
      keep: ["the x402 pairings with advertiseBeforeCarrier", (b) => typeof b.advertiseBeforeCarrier === "function"],
      leave: ["the x402 pairings with none, which place only with advertise", (b) => b.advertiseBeforeCarrier === undefined],
    }).map((b) => [b.id, "advertiseBeforeCarrier", b.advertiseBeforeCarrier as Place, true] as const),
  ];
  const issuedX402 = (id: string, asIssued: boolean) => {
    const b = BINDINGS.find((p) => p.id === id)!;
    const advertised = advertisedDoc.get(id) as { accepts: unknown[]; extensions: { legalContext: { info: Record<string, string> } } };
    const info = advertised.extensions.legalContext.info;
    const { legalContext: _, ...extensions } = advertised.extensions;
    const option = (asIssued ? (b.unplaced as (o: unknown) => unknown)(advertised.accepts[0]) : advertised.accepts[0]) as object;
    const issued: Record<string, unknown> = { ...advertised, accepts: [option], extensions };
    if (Object.keys(extensions).length === 0) delete issued["extensions"];
    const rest = [info["value"], info["legalContextUrl"], info["legalContextAgreementUrl"]] as const;
    return { advertised, issued, option, rest };
  };
  for (const [id, member, placeIn, asIssued] of x402Calls) {
    it(`${id}: ${member} refuses a document carrying a refused member as x402/option-malformed`, () => {
      const { advertised, issued, option, rest } = issuedX402(id, asIssued);
      const args = [rest[0], rest[1], option, rest[2]] as const;
      const placed = placeIn(structuredClone(issued), ...args);
      if (member === "advertise") expect(placed).toEqual(advertised);
      else expect(isRefusal(placed)).toBe(false);
      for (const doc of [withRefused(issued), { ...withRefused(issued), x402Version: 1 }, shaped()]) {
        const out = placeIn(doc, ...args);
        expect(out).toEqual(refused("x402/option-malformed"));
        expect(isRefusal(out)).toBe(true);
      }
    });
  }

  // The copy an x402 placement returns keeps every option in accepts, so an option there that carries a refused member
  // is refused as well, with x402/option-malformed: at the first or the last place, offered or not. The document is the
  // one above with a second option, the offered one at another amount, which the placement leaves as it is.
  for (const [id, member, placeIn, asIssued] of x402Calls) {
    it(`${id}: ${member} refuses a document with an option in accepts carrying a refused member as x402/option-malformed`, () => {
      const { issued, option, rest } = issuedX402(id, asIssued);
      const other = { ...option, amount: "7" };
      const call = (accepts: unknown[], offer: unknown) => placeIn({ ...issued, accepts }, rest[0], rest[1], offer, rest[2]);
      for (const accepts of [[option, other], [other, option]]) {
        const placed = call(structuredClone(accepts), structuredClone(option)) as { accepts: unknown[] };
        expect(isRefusal(placed)).toBe(false);
        expect(placed.accepts[accepts.indexOf(other)]).toEqual(other);
      }
      const offered = withRefused(option);
      const cases: [unknown[], unknown][] = [
        [[offered, other], offered],
        [[other, offered], offered],
        [[withRefused(other), option], option],
        [[option, withRefused(other)], option],
      ];
      for (const [accepts, offer] of cases) {
        const out = call(structuredClone(accepts), structuredClone(offer));
        expect(out).toEqual(refused("x402/option-malformed"));
        expect(isRefusal(out)).toBe(true);
      }
    });
  }

  // The options are read only within the 32-option bound docs/reference/refusals.md gives for accepts: an accepts of 40
  // options is refused as x402/option-malformed with no option at index 32 or above read, whatever those options hold.
  for (const [id, member, placeIn, asIssued] of x402Calls) {
    it(`${id}: ${member} reads no option of accepts beyond its 32-option bound`, () => {
      const { issued, option, rest } = issuedX402(id, asIssued);
      const read = new Set<number>();
      const accepts = new Proxy(
        Array.from({ length: 40 }, (_, i) => (i === 39 ? withRefused(option) : structuredClone(option))),
        {
          get(t, k, r) {
            if (typeof k === "string" && /^[0-9]+$/.test(k) && Number(k) >= 32) read.add(Number(k));
            return Reflect.get(t, k, r);
          },
        },
      );
      const out = placeIn({ ...issued, accepts }, rest[0], rest[1], option, rest[2]);
      expect(out).toEqual(refused("x402/option-malformed"));
      expect([...read]).toEqual([]);
    });
  }

  // An MPP challenge as issued: buyer row B2's advertised challenge without its carrier (unplaced), its id and its
  // opaque, which place writes. The Lightning invoice, which carries the hash, exists when advertise is called, so
  // advertise takes the challenge with it, and advertiseBeforeCarrier takes it without.
  const mpp = rowsOf(BINDINGS, "BINDINGS", {
    exact: 26,
    keep: ["the MPP pairings", (b) => b.id.startsWith("mpp/")],
    leave: ["the pairings of the other carriers", (b) => !b.id.startsWith("mpp/")],
  });
  const issuedChallenge = (id: string, unplace: boolean) => {
    const c = (advertisedDoc.get(id) as Record<string, string>[])[0]!;
    const opaque = JSON.parse(Buffer.from(c["opaque"]!, "base64url").toString("utf8")) as Record<string, string>;
    const unplaced = BINDINGS.find((p) => p.id === id)!.unplaced as (o: unknown) => Record<string, string>;
    const { id: _id, opaque: _opaque, ...issued } = unplace ? unplaced(c) : c;
    const h = fromLcpString(opaque["legalContext"]!);
    return { issued, h, link: opaque["legalContextUrl"]!, agreementUrl: opaque["legalContextAgreementUrl"] };
  };
  it("the MPP pairings are twenty-six, each with an advertised list of one challenge whose opaque holds only the legal context", () => {
    expect(mpp.length).toBe(26);
    for (const b of mpp) {
      const [c, ...rest] = advertisedDoc.get(b.id) as Record<string, string>[];
      expect(rest, b.id).toEqual([]);
      const opaque = JSON.parse(Buffer.from(c!["opaque"]!, "base64url").toString("utf8")) as Record<string, string>;
      expect(Object.keys(opaque).filter((k) => !k.startsWith("legalContext")), b.id).toEqual([]);
    }
  });
  const lightning = new Set(["mpp/charge/lightning", "mpp/session/lightning"]);
  const mppCalls = [
    ...mpp.map((b) => [b.id, "advertise", b.advertise as Place, !lightning.has(b.id)] as const),
    ...rowsOf(mpp, "the MPP pairings", {
      keep: ["the MPP pairings with advertiseBeforeCarrier", (b) => typeof b.advertiseBeforeCarrier === "function"],
      leave: ["the MPP pairings with none, which place with advertise and place", (b) => b.advertiseBeforeCarrier === undefined],
    }).map((b) => [b.id, "advertiseBeforeCarrier", b.advertiseBeforeCarrier as Place, true] as const),
    ...mpp.map((b) => [b.id, "place", place as Place, true] as const),
  ];
  for (const [id, member, placeIn, unplace] of mppCalls) {
    it(`${id}: ${member} refuses a challenge list in which a challenge carries a refused member as mpp/challenge-malformed`, () => {
      const { issued, h, link, agreementUrl } = issuedChallenge(id, unplace);
      const placed = placeIn([structuredClone(issued)], h, link, structuredClone(issued), agreementUrl);
      if (member === "advertise") expect(placed).toEqual(advertisedDoc.get(id));
      else expect(isRefusal(placed)).toBe(false);
      const other = { ...issued, realm: "other.seller.example" };
      for (const doc of [[withRefused(issued)], [issued, withRefused(other)], [withRefused(other), issued]]) {
        const out = placeIn(doc, h, link, withRefused(issued), agreementUrl);
        expect(out).toEqual(refused("mpp/challenge-malformed"));
        expect(isRefusal(out)).toBe(true);
      }
    });
  }

  // A2A: a2a-legal-context.json's task A2, which place places into A2's placed task.
  it("a2a's place refuses a task carrying a refused member as a2a/legal-context-malformed", () => {
    const A = load("a2a-legal-context.json");
    const { h, link } = A.A2.expectRead;
    expect(a2aPlace(structuredClone(A.A2.task), h, link)).toEqual(A.A2.expectPlaced);
    for (const task of [withRefused(A.A2.task), shaped()]) {
      const out = a2aPlace(task, h, link);
      expect(out).toEqual(refused("a2a/legal-context-malformed"));
      expect(isRefusal(out)).toBe(true);
    }
  });

  // The checkout pairings whose advertise copies the seller's document: ACP's session (acp-checkout.json V2), AP2's
  // checkout payload (ap2-checkout-mandate.json V2) and UCP's checkout (ucp.json V2) or booking (V2b).
  const A = load("acp-checkout.json").V2;
  const P = load("ap2-checkout-mandate.json").V2;
  const U = load("ucp.json");
  const checkoutCalls: [string, Place, unknown, { h: string; link: string; offer: unknown }, unknown, string][] = [
    ["acp/checkout/delegated", acpDelegated.advertise as Place, A.advertise.doc, A.advertise, A.expectSession, "acp/session-malformed"],
    ["acp/checkout/undelegated", acpUndelegated.advertise as Place, A.advertise.doc, A.advertise, A.expectSession, "acp/session-malformed"],
    ["ap2/checkout-mandate", checkoutMandate.advertise as Place, P.advertise.payload, P.advertise, P.expectPayload, "ap2/jws-malformed"],
    ["ucp/checkout/unsigned", ucpUnsigned.advertise as Place, U.V2.advertise.doc, U.V2.advertise, U.V2.expectCheckout, "ucp/checkout-malformed"],
    ["ucp/checkout/ap2-mandate", ucpAp2.advertise as Place, U.V2.advertise.doc, U.V2.advertise, U.V2.expectCheckout, "ucp/checkout-malformed"],
    ["ucp/booking/unsigned", ucpBookingUnsigned.advertise as Place, U.V2b.B0, U.V2b.advertise, U.V2b.expectBooking, "ucp/checkout-malformed"],
    ["ucp/booking/ap2-mandate", ucpBookingAp2.advertise as Place, U.V2b.B0, U.V2b.advertise, U.V2b.expectBooking, "ucp/checkout-malformed"],
  ];
  for (const [id, advertise, doc, a, expected, code] of checkoutCalls) {
    it(`${id}: advertise refuses a document carrying a refused member as ${code}`, () => {
      expect(advertise(structuredClone(doc), a.h, a.link, a.offer)).toEqual(expected);
      for (const d of [withRefused(doc), shaped()]) {
        const out = advertise(d, a.h, a.link, a.offer);
        expect(out).toEqual(refused(code));
        expect(isRefusal(out)).toBe(true);
      }
    });
  }
});
