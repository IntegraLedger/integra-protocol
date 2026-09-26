// Runs x402-exact-xrpl.json through the xrpl and x402/exact/xrpl entry points. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode } from "ripple-binary-codec";
import { ReaderError } from "../src/evm.js";
import type { AtrHash } from "../src/index.js";
import { decodeBlob, mppInvoiceId, x402InvoiceId, xrplStatus, type XrplReader, type XrplRef } from "../src/xrpl.js";
import { exactXrpl, pairingOf, type XrplPaymentPayload } from "../src/x402-exact-xrpl.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-xrpl.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const refused = (code: string) => ({ refused: true, code });
const payment = (blob: string, accepted: PaymentRequirements): XrplPaymentPayload => ({
  x402Version: 2,
  accepted,
  payload: { signedTxBlob: blob },
});

function readerFor(tx: unknown, validated = 0, onTx?: (hash: string) => void): XrplReader {
  return {
    network: "xrpl:1",
    tx: async (hash) => {
      onTx?.(hash);
      if (tx === "reader-error") throw new ReaderError("transport");
      return tx as Awaited<ReturnType<XrplReader["tx"]>>;
    },
    txBlob: async () => null,
    validatedLedger: async () => validated,
  };
}

describe("x402-exact-xrpl.json", () => {
  it("V1: the InvoiceID forms", async () => {
    expect(await x402InvoiceId(H)).toBe(V.V1.x402InvoiceId);
    expect(mppInvoiceId(H)).toBe(V.V1.mppInvoiceId);
    expect(createHash("sha256").update(V.fixed.L).digest("hex").toUpperCase()).toBe(V.V1.x402InvoiceId);
  });

  it("advertise places L in extra.invoiceId, read gives H, unplaced gives the option as issued", () => {
    const doc = exactXrpl.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(V.V2.accepted);
    const r = exactXrpl.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
    expect(exactXrpl.unplaced(doc.accepts[0]!)).toEqual(O);
    expect(pairingOf(O)).toBe("x402/exact/xrpl");
    const occupied = { ...O, extra: { ...O.extra, invoiceId: "INV-1" } };
    expect(
      exactXrpl.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [occupied] }, H, V.fixed.link, occupied),
    ).toEqual(refused("xrpl/carrier-occupied"));
  });

  it("V2: bound, reference, and build's txJson equal to the blob's signed fields", async () => {
    const p = payment(V.V2.blob, V.V2.accepted);
    expect(await exactXrpl.bound(p)).toBe(V.V2.expectBound);
    expect(await exactXrpl.reference(p)).toEqual(V.V2.expectReference);
    const ref = await exactXrpl.reference(p);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [V.V2.accepted] };
    const u = await exactXrpl.build({ required, accepted: V.V2.accepted, ...V.V2.build }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("xrpl-tx");
    const { SigningPubKey: _, TxnSignature: __, ...signed } = decode(V.V2.blob) as Record<string, unknown>;
    expect(u.request.txJson).toEqual(signed);
    expect(u.request.txJson).toEqual(V.V2.expectTxJson);
    const completed = u.complete(V.V2.blob);
    if ("refused" in completed) throw new Error(completed.code);
    expect(await exactXrpl.bound(completed)).toBe(H);
  });

  it("V3: the MPP blob's hash and InvoiceID", async () => {
    const d = await decodeBlob(V.V3.blob);
    if ("refused" in d) throw new Error(d.code);
    expect(d.hash).toBe(V.V3.hash);
    expect(d.tx.InvoiceID).toBe(V.V3.invoiceId);
  });

  it("V4: three conventions", async () => {
    const hex = createHash("sha512").update(V.V4.challengeId).digest("hex").slice(0, 64).toUpperCase();
    expect(hex).toBe(V.V4.derivedInvoiceId);
    const row = V.V4.x402Row;
    expect(await xrplStatus(row.ref as XrplRef, readerFor(row.landed))).toEqual(row.expect);
    expect(await exactXrpl.bound(payment(V.V4.v3UnderX402.blob, V.V4.v3UnderX402.accepted))).toEqual(
      refused(V.V4.v3UnderX402.expect),
    );
  });

  it("V5: status", async () => {
    for (const row of V.V5.rows) {
      expect(await xrplStatus(V.V5.ref as XrplRef, readerFor(row.tx, row.validated ?? 0)), row.case).toEqual(row.expect);
    }
  });

  it("V6: reads by the blob's hash, never the facilitator's", async () => {
    const asked: string[] = [];
    const reader = readerFor({ notFound: true, searchedAll: false }, 990, (h) => asked.push(h));
    expect(await xrplStatus(V.V6.ref as XrplRef, reader)).toEqual(V.V6.expect);
    expect(asked).toEqual([V.V6.ref.transaction]);
    expect(asked).not.toContain(V.V6.named);
  });

  it("strictEncoding: a blob that is not the canonical serialization of what it decodes to is refused", async () => {
    for (const row of V.strictEncoding.rows) {
      expect(() => decode(row.blob), row.case).not.toThrow();
      expect(await decodeBlob(row.blob), row.case).toEqual(refused(row.expect));
      expect(await exactXrpl.bound(payment(row.blob, V.V2.accepted)), row.case).toEqual(refused(row.expect));
    }
  });

  it("plant: a memo is never read as the carrier", async () => {
    const d = await decodeBlob(V.plant.blob);
    if ("refused" in d) throw new Error(d.code);
    expect(d.hash).toBe(V.plant.hash);
    expect(await exactXrpl.bound(payment(V.plant.blob, V.plant.accepted))).toEqual(refused(V.plant.expect));
  });
});
