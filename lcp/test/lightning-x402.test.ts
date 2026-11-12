// Runs vectors/x402-exact-lnbtc.json's BOLT11 invoices through the lightning entry point's decoder. Every expected value
// is the file's (L1, L4 and L7, each naming its source there); the invoices are also read by light-bolt11-decoder and
// bolt11 as a cross-check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode as lightDecode } from "light-bolt11-decoder";
import bolt11 from "bolt11";
import type { AtrHash } from "../src/index.js";
import { decodeBolt11, invoiceH, type Bolt11 } from "../src/lightning.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const V = load("x402-exact-lnbtc.json");
const H: AtrHash = V.fixed.H;
const hex = (b: Uint8Array | null) => (b === null ? null : Buffer.from(b).toString("hex"));
const section = (d: ReturnType<typeof lightDecode>, name: string) =>
  (d.sections as { name: string; value?: unknown }[]).find((s) => s.name === name)?.value;

describe("BOLT11", () => {
  it("L1: BOLT11's published h example", async () => {
    const b = (await decodeBolt11(V.L1.invoice)) as Bolt11;
    expect(hex(b.descriptionHash)).toBe(V.L1.expectDescriptionHash);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(V.L1.description));
    expect(Buffer.from(digest).toString("hex")).toBe(V.L1.expectDescriptionHash);
  });

  it("L4: the x402 invoice carries the request hash in h and H in m", async () => {
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
      network: { bech32: "bc", pubKeyHash: 0x00, scriptHash: 0x05, validWitnessVersions: [0, 1] },
      satoshis: 1000,
      timestamp: 1790000000,
      tags: [
        { tagName: "payment_hash", data: "11".repeat(32) },
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
  // multiplier); the decoded amount is the file's, its digits times 100 millisatoshi for n.
  it("L7: L4 with a 4,301-digit amount decodes, with that amount and L4's other fields", async () => {
    const hrp = V.L7.invoice.slice(0, V.L7.invoice.lastIndexOf("1"));
    expect(hrp.length).toBe("lnbc".length + 4301 + 1);
    const b = (await decodeBolt11(V.L7.invoice)) as Bolt11;
    expect("refused" in b).toBe(false);
    expect(b.amountMsat?.toString()).toBe(V.L7.expectAmountMsat);
    const l4 = (await decodeBolt11(V.L4.invoice)) as Bolt11;
    expect({ ...b, amountMsat: null }).toEqual({ ...l4, amountMsat: null });
  });
});
