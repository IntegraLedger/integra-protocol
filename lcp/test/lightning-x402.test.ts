// Runs vectors/x402-exact-lnbtc.json through the lightning entry point: the invoices, each rewritten by bolt11 1.4.1 and
// read by light-bolt11-decoder 3.2.0 as the file's about states; x402's request binding vectors; and the hash form's
// placement, build, bound, reference, validation and preimage check, each row the file's good input with the one change
// its case names and the code it expects.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode as lightDecode } from "light-bolt11-decoder";
import bolt11 from "bolt11";
import { isRefusal, type AtrHash } from "../src/index.js";
import { pairingOf } from "../src/index.js";
import {
  checkPreimage,
  decodeBolt11,
  exactLnbtcPaymentHash as ln,
  invoiceH,
  requestHash,
  validateExactLnbtc,
  type Bolt11,
  type LnUnsigned,
} from "../src/lightning.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const V = load("x402-exact-lnbtc.json");
const H: AtrHash = V.fixed.H;
const ID = "x402/exact/lnbtc/payment-hash";
const hex = (b: Uint8Array | null) => (b === null ? null : Buffer.from(b).toString("hex"));
const section = (d: ReturnType<typeof lightDecode>, name: string) =>
  (d.sections as { name: string; value?: unknown }[]).find((s) => s.name === name)?.value;
const refused = (code: string) => ({ refused: true, code });

/** A copy of `base` with each dotted path of `changes` set, or removed where its value is null. */
function set<T>(base: T, changes: Record<string, unknown>): T {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    if (value === null) delete at[keys[keys.length - 1]!];
    else at[keys[keys.length - 1]!] = structuredClone(value);
  }
  return copy as T;
}
/** A request of the file, its body given as hex, as `build` takes it. */
const requestOf = (r: { bodyHex?: string; [k: string]: unknown }) =>
  r.bodyHex === undefined ? r : { ...r, bodyHex: undefined, body: Uint8Array.from(Buffer.from(r.bodyHex, "hex")) };
const choice = (changes: Record<string, unknown> = {}) => {
  const c = set({ required: V.fixed.required, accepted: V.fixed.O, now: V.fixed.now, request: V.fixed.request }, changes);
  return { ...c, request: requestOf(c.request) } as never;
};
const NETWORK = { bech32: "bc", pubKeyHash: 0x00, scriptHash: 0x05, validWitnessVersions: [0, 1] };

describe("the invoices, as bolt11 writes them and light-bolt11-decoder reads them", () => {
  const invoices = rowsOf(Object.entries(V.invoices) as [string, { case: string; encode: { millisatoshis: string; timestamp: number; tags: never[]; key: string }; invoice: string; signer: string }][], "invoices", { exact: 9 });
  it.each(invoices)("%s: bolt11 writes it from its fields and key", (_, inv) => {
    const { millisatoshis, timestamp, tags, key } = inv.encode;
    expect(bolt11.sign(bolt11.encode({ network: NETWORK, millisatoshis, timestamp, tags }), key).paymentRequest).toBe(inv.invoice);
    expect(bolt11.decode(inv.invoice).payeeNodeKey).toBe(inv.signer);
    const light = lightDecode(inv.invoice);
    const p = inv.encode.tags.find((t: { tagName: string }) => t.tagName === "payment_hash") as unknown as { data: string };
    expect(section(light, "payment_hash")).toBe(p.data);
  });

  it("x402's example invoice: payTo signed it, its p is the payment hash, its h the request hash", () => {
    const x = V.fixed.x402Invoice;
    expect(bolt11.decode(x).payeeNodeKey).toBe(V.fixed.payee);
    const light = lightDecode(x);
    expect(section(light, "payment_hash")).toBe(V.fixed.paymentHash);
    expect(section(light, "description_hash")).toBe(V.fixed.requestHash);
    expect(section(light, "expiry")).toBe(300);
    expect(light.sections.some((s: { name: string }) => s.name === "description")).toBe(false);
  });

  it("the refused invoices break the field rule their case names, as light-bolt11-decoder reads them", () => {
    const names = (inv: string) => (lightDecode(inv).sections as { name: string }[]).map((s) => s.name);
    expect(names(V.invoices.withD.invoice)).toContain("description");
    expect(names(V.invoices.twoH.invoice).filter((n) => n === "description_hash").length).toBe(2);
    expect(names(V.invoices.noS.invoice)).not.toContain("payment_secret");
    expect(section(lightDecode(V.invoices.otherP.invoice), "payment_hash")).toBe("22".repeat(32));
  });
});

describe("x402's request binding vectors", () => {
  it.each(rowsOf(V.requestHashes.rows as { case: string; profile: string; params: unknown; request: { url?: string; bodyHex?: string }; expect: string }[], "requestHashes", { exact: 6 }).map((r) => [r.case, r] as const))(
    "%s",
    (_, r) => {
      expect(requestHash(r.profile, r.params, requestOf(r.request), r.request.url)).toBe(r.expect);
    },
  );
});

describe("the offer before its invoice", () => {
  it("advertiseBeforeCarrier places fixed.offer; unplaced gives it from fixed.O", () => {
    const doc = { x402Version: 2, resource: V.fixed.resource, accepts: [V.fixed.offer] } as PaymentRequired;
    expect(ln.advertiseBeforeCarrier(doc, H, V.fixed.link, V.fixed.offer)).toEqual(V.offers.placed);
    expect(ln.unplaced(V.fixed.O)).toEqual(V.fixed.offer);
    expect(ln.advertise(doc, H, V.fixed.link, V.fixed.offer)).toEqual(refused("ln/invoice-malformed"));
  });

  it.each(rowsOf(V.offers.rows as { case: string; offer: PaymentRequirements; expect: string }[], "offers", { exact: 5 }).map((r) => [r.case, r] as const))(
    "refuses an offer %s",
    (_, r) => {
      const doc = { x402Version: 2, resource: V.fixed.resource, accepts: [r.offer] } as PaymentRequired;
      expect(ln.advertiseBeforeCarrier(doc, H, V.fixed.link, r.offer)).toEqual(refused(r.expect));
    },
  );
});

describe("the option with its invoice", () => {
  it("read offers fixed.O and each option of options, and the root pairingOf names the pairing", () => {
    for (const o of [V.fixed.O, ...V.options.rows.map((r: { option: unknown }) => r.option)] as PaymentRequirements[]) {
      const doc = { ...V.fixed.required, accepts: [o] };
      expect(isRefusal(ln.read(doc))).toBe(false);
      expect(pairingOf(o)).toBe(ID);
    }
    expect(ln.read(V.fixed.required)).toMatchObject({ h: H, link: V.fixed.link });
  });
});

describe("build: the scheme's client checks", () => {
  it("pays fixed.x402Invoice, and complete gives fixed.P", async () => {
    const u = (await ln.build(choice(), H)) as LnUnsigned;
    expect(u.request).toEqual({ kind: "bolt11-pay", invoice: V.fixed.x402Invoice });
    expect(u.complete(V.fixed.preimage)).toEqual(V.fixed.P);
  });

  it.each(rowsOf(V.build.rows as { case: string; set: Record<string, unknown>; expect: string }[], "build.rows", { exact: 11 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, r) => {
      const u = await ln.build(choice(r.set), H);
      if (r.expect === "served") expect(isRefusal(u)).toBe(false);
      else expect(u).toEqual(refused(r.expect));
    },
  );

  it.each(rowsOf(V.build.complete as { case: string; preimage: string; expect: string }[], "build.complete", { exact: 2 }).map((r) => [r.case, r] as const))(
    "complete refuses %s",
    async (_, r) => {
      const u = (await ln.build(choice(), H)) as LnUnsigned;
      expect(u.complete(r.preimage)).toEqual(refused(r.expect));
    },
  );
});

describe("bound and reference of the payment presented", () => {
  it("bound gives H; reference names the network, the payment hash and the proof's last second", async () => {
    expect(await ln.bound(V.fixed.P)).toBe(H);
    expect(await ln.reference(V.fixed.P, V.fixed.O)).toEqual(V.reference.expect);
    expect(await ln.reference(V.fixed.P, V.fixed.offer)).toEqual(V.reference.expect);
    expect(await ln.reference(V.fixed.P, V.reference.other)).toEqual(refused(V.reference.otherExpect));
    expect(await ln.broadcaster(V.fixed.P)).toBe("payer");
  });

  it.each(rowsOf(V.bound.rows as { case: string; set: Record<string, unknown>; expect: string }[], "bound.rows", { exact: 5 }).map((r) => [r.case, r] as const))(
    "bound refuses %s",
    async (_, r) => {
      expect(await ln.bound(set(V.fixed.P, r.set))).toEqual(refused(r.expect));
    },
  );
});

describe("validateExactLnbtc: x402's validation with the form's added check", () => {
  it("validates fixed.P against fixed.O at fixed.now", () => {
    expect(validateExactLnbtc(V.fixed.P, V.fixed.O, { now: V.fixed.now })).toEqual(V.validate.valid);
  });

  type Row = { case: string; payload?: Record<string, unknown>; requirements?: Record<string, unknown>; at?: { now: number; skew?: number }; expect: string };
  it.each(rowsOf(V.validate.rows as Row[], "validate.rows", { exact: 22 }).map((r) => [r.case, r] as const))("%s", (_, r) => {
    const answer = validateExactLnbtc(set(V.fixed.P, r.payload ?? {}), set(V.fixed.O, r.requirements ?? {}), r.at ?? { now: V.fixed.now });
    expect(answer).toEqual(r.expect === "valid" ? V.validate.valid : { valid: false, reason: r.expect });
  });

  it.each(rowsOf(V.validate.refused as Row[], "validate.refused", { exact: 1 }).map((r) => [r.case, r] as const))("refuses %s", (_, r) => {
    expect(validateExactLnbtc(V.fixed.P, V.fixed.O, r.at!)).toEqual(refused(r.expect));
  });
});

describe("checkPreimage", () => {
  it("x402's preimage hashes to its payment hash", () => {
    expect(checkPreimage(V.fixed.preimage, V.fixed.paymentHash)).toBe(true);
  });
  it.each(rowsOf(V.checkPreimage.rows as { case: string; preimage: string; paymentHash: string; expect: string }[], "checkPreimage.rows", { exact: 3 }).map((r) => [r.case, r] as const))(
    "refuses %s",
    (_, r) => {
      expect(checkPreimage(r.preimage, r.paymentHash)).toEqual(refused(r.expect));
    },
  );
});

describe("BOLT11", () => {
  it("L1: BOLT11's published h example", async () => {
    const b = (await decodeBolt11(V.L1.invoice)) as Bolt11;
    expect(hex(b.descriptionHash)).toBe(V.L1.expectDescriptionHash);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(V.L1.description));
    expect(Buffer.from(digest).toString("hex")).toBe(V.L1.expectDescriptionHash);
  });

  it("L4: an x402 invoice that carries the request hash in h and H in m", async () => {
    const b = (await decodeBolt11(V.L4.invoice)) as Bolt11;
    const e = V.L4.expect;
    expect({
      currency: b.currency,
      amountMsat: b.amountMsat?.toString(),
      timestamp: b.timestamp,
      expiry: b.expiry,
      paymentHash: hex(b.paymentHash),
      descriptionHash: hex(b.descriptionHash),
      metadata: hex(b.metadata),
      description: b.description,
    }).toEqual(e);
    expect(invoiceH(b, "m")).toBe(H);
    expect(invoiceH(b, "h")).toBe(`0x${e.descriptionHash}`);
    const light = lightDecode(V.L4.invoice);
    expect(section(light, "description_hash")).toBe(e.descriptionHash);
    expect(section(light, "metadata")).toBe(e.metadata);
    expect(bolt11.decode(V.L4.invoice).payeeNodeKey).toBe(V.L4.expectPayee);
  });

  // BOLT11's published example "Please make a donation of any amount" (mpp-session-lightning.json's returnInvoice)
  // carries a description and neither an h nor an m field, as light-bolt11-decoder reads it too.
  it("invoiceH: an invoice without the field is ln/no-description-hash or ln/no-metadata", async () => {
    const invoice: string = load("mpp-session-lightning.json").fixed.returnInvoice;
    expect(section(lightDecode(invoice), "description_hash")).toBeUndefined();
    expect(section(lightDecode(invoice), "metadata")).toBeUndefined();
    const donation = (await decodeBolt11(invoice)) as Bolt11;
    expect(invoiceH(donation, "h")).toEqual({ refused: true, code: "ln/no-description-hash" });
    expect(invoiceH(donation, "m")).toEqual({ refused: true, code: "ln/no-metadata" });
  });
});

describe("BOLT11: a description that begins with a byte-order mark", () => {
  // BOLT 11's `d` field is "UTF-8 encoded". The invoice is written and signed by bolt11 1.4.1 with BOLT 11's example
  // private key, its `d` field EF BB BF then "coffee". Strict UTF-8 reads EF BB BF as U+FEFF, a character of the text, as
  // bolt11's decode does; light-bolt11-decoder 3.2.0 decodes with TextDecoder's default, which removes a leading U+FEFF.
  const KEY = "e126f68f7eafcc8b74f54d269fe206be715000f94dac067d1c04a8ca3b2db734";
  const text = "﻿coffee";
  const invoice = bolt11.sign(
    bolt11.encode({
      network: NETWORK,
      satoshis: 1000,
      timestamp: 1790000000,
      tags: [
        { tagName: "payment_hash", data: "11".repeat(32) },
        { tagName: "payment_secret", data: "22".repeat(32) },
        { tagName: "description", data: text },
      ],
    }),
    KEY,
  ).paymentRequest!;

  it("the d field is EF BB BF then coffee: bolt11 keeps the mark, light-bolt11-decoder removes it", () => {
    const d = bolt11.decode(invoice).tagsObject.description!;
    expect(Buffer.from(d, "utf8").toString("hex")).toBe("efbbbf636f66666565");
    expect(d).toBe(text);
    expect(section(lightDecode(invoice), "description")).toBe("coffee");
  });

  it("decodeBolt11 keeps the mark in description", async () => {
    const b = (await decodeBolt11(invoice)) as Bolt11;
    expect(b.description).toBe(text);
    expect(b.tags.filter((t) => t === 13).length).toBe(1);
  });
});

describe("BOLT11: an amount past any fixed-width integer", () => {
  // L7's amount is read as an integer of any length (BOLT 11: the amount is a positive decimal integer, then the
  // multiplier); the decoded amount is the file's, its digits times 100 millisatoshi for n. L4 has no `n` field, so its
  // signer is recovered from the signature, and over the changed amount the recovered key is another than L4's.
  it("L7: L4 with a 4,301-digit amount decodes, with that amount and L4's other fields", async () => {
    const hrp = V.L7.invoice.slice(0, V.L7.invoice.lastIndexOf("1"));
    expect(hrp.length).toBe("lnbc".length + 4301 + 1);
    const b = (await decodeBolt11(V.L7.invoice)) as Bolt11;
    expect("refused" in b).toBe(false);
    expect(b.amountMsat?.toString()).toBe(V.L7.expectAmountMsat);
    const l4 = (await decodeBolt11(V.L4.invoice)) as Bolt11;
    expect(b.signer).not.toBe(l4.signer);
    expect({ ...b, amountMsat: null, signer: "" }).toEqual({ ...l4, amountMsat: null, signer: "" });
  });
});
