// Runs x402-exact-xrpl.json through the xrpl and x402/exact/xrpl entry points. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode } from "ripple-binary-codec";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { resigned } from "./fixtures/xrpl-resign.js";
import { pairingOf, type AtrHash } from "../src/index.js";
import { decodeBlob, mppInvoiceId, x402InvoiceId, xrplStatus, type XrplReader, type XrplRef } from "../src/xrpl.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { landed, xrplReader } from "./fixtures/xrpl-reader.js";
import { chargeXrpl } from "../src/mpp.js";
import { vi } from "vitest";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-xrpl.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const refused = (code: string) => ({ refused: true, code });
/** An XRPL status read's query: the act payment at the mark validated. */
const VALIDATED = { act: "payment", finality: "validated" } as const;
const unreadable = (reason: string) => ({ state: "unreadable", reason, foreign: [] });
const payment = (blob: string, accepted: PaymentRequirements) => ({
  x402Version: 2,
  accepted,
  payload: { signedTxBlob: blob },
});

function readerFor(tx: unknown, validated = 1000, onTx?: (hash: string) => void): XrplReader {
  return xrplReader({
    server: async () => ({ validated, latest: validated + 1, completeLedgers: `1-${validated + 1}` }),
    tx: async (hash) => {
      onTx?.(hash);
      if (tx === "reader-error") throw new ReaderError("transport");
      return tx as Awaited<ReturnType<XrplReader["tx"]>>;
    },
  });
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

  it("reference refuses a payment whose accepted is not the option it is given", async () => {
    const other = { ...V.V2.accepted, payTo: "rPPdduC9MRTrXZP1J7MQyEKKEYiFigWZ6Q" };
    expect(await exactXrpl.reference(payment(V.V2.blob, V.V2.accepted), other)).toEqual(refused("x402/accepted-not-option"));
  });

  it("V2: bound, reference, and build's txJson equal to the blob's signed fields", async () => {
    const p = payment(V.V2.blob, V.V2.accepted);
    expect(await exactXrpl.bound(p)).toBe(V.V2.expectBound);
    expect(await exactXrpl.reference(p, V.V2.accepted)).toEqual(V.V2.expectReference);
    const ref = await exactXrpl.reference(p, V.V2.accepted);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [V.V2.accepted] };
    const u = await exactXrpl.build({ required, accepted: V.V2.accepted, ...V.V2.build }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("xrpl-tx");
    const { SigningPubKey: _, TxnSignature: __, ...signed } = decode(V.V2.blob) as Record<string, unknown>;
    expect(u.request.txJson).toEqual(signed);
    expect(u.request.txJson).toEqual(V.V2.expectTxJson);
    const completed = await u.complete(V.V2.blob);
    if ("refused" in completed) throw new Error(completed.code);
    expect(await exactXrpl.bound(completed)).toBe(H);
  });

  it("build refuses an H that is not a 32-byte hash as x402/payload-malformed (docs/reference/refusals.md)", async () => {
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [V.V2.accepted] };
    for (const bad of [null, "0x12", H.slice(2), `lcp:sha256:${H}`]) {
      const got = await exactXrpl.build({ required, accepted: V.V2.accepted, ...V.V2.build }, bad as AtrHash);
      expect(got, String(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("V3: the MPP blob's hash and InvoiceID", async () => {
    const d = await decodeBlob(V.V3.blob);
    if ("refused" in d) throw new Error(d.code);
    expect(d.hash).toBe(V.V3.hash);
    expect(d.tx.InvoiceID).toBe(V.V3.invoiceId);
  });

  it("strictEncoding: a blob that is not the canonical serialization of what it decodes to is refused", async () => {
    for (const row of rowsOf(V.strictEncoding.rows, "x402-exact-xrpl.json strictEncoding.rows")) {
      expect(() => decode(row.blob), row.case).not.toThrow();
      expect(await decodeBlob(row.blob), row.case).toEqual(refused(row.expect));
      expect(await exactXrpl.bound(payment(row.blob, V.V2.accepted)), row.case).toEqual(refused(row.expect));
    }
  });

  it("multisigned: bound gives H, and reference names one signed body for both quorums' copies of one payment", async () => {
    const [three, two] = V.multisigned.rows;
    const bodies = new Set<string>();
    for (const row of rowsOf(V.multisigned.rows, "x402-exact-xrpl.json multisigned.rows")) {
      const d = await decodeBlob(row.blob);
      if ("refused" in d) throw new Error(d.code);
      expect(d.hash, row.case).toBe(row.hash);
      expect(row.expect, row.case).toBe("admitted");
      expect(await exactXrpl.bound(payment(row.blob, V.V2.accepted)), row.case).toBe(H);
      const ref = await exactXrpl.reference(payment(row.blob, V.V2.accepted), V.V2.accepted);
      if ("refused" in ref) throw new Error(ref.code);
      expect([ref.transaction, ref.signed?.account, ref.signed?.sequence], row.case).toEqual([row.hash, V.fixed.payer, 7]);
      bodies.add(ref.signed!.body);
    }
    expect(bodies.size).toBe(1);
    const a = decode(three.blob) as { InvoiceID: string; Sequence: number; Signers: unknown[] };
    const b = decode(two.blob) as { InvoiceID: string; Sequence: number; Signers: unknown[] };
    expect([a.InvoiceID, a.Sequence, a.Signers.length]).toEqual([V.V1.x402InvoiceId, 7, 3]);
    expect([b.InvoiceID, b.Sequence, b.Signers.length]).toEqual([V.V1.x402InvoiceId, 7, 2]);
    expect(three.hash).not.toBe(two.hash);
  });

  it("plant: a memo is never read as the carrier", async () => {
    const d = await decodeBlob(V.plant.blob);
    if ("refused" in d) throw new Error(d.code);
    expect(d.hash).toBe(V.plant.hash);
    expect(await exactXrpl.bound(payment(V.plant.blob, V.plant.accepted))).toEqual(refused(V.plant.expect));
  });
});

// x402-exact-xrpl.json's agreedRefusals rows state each refusal in words. Each case below calls the entry points its row
// names, once for each condition the row lists, with inputs built from the file's V2 payment and choice, its
// strictEncoding blobs and V2's reference, and every result is the row's code. The recover row's function is the XRPL rail's
// recover, which mpp/charge/xrpl exports: x402/exact/xrpl has none.
describe("x402-exact-xrpl.json agreedRefusals: every row runs", () => {
  const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [V.V2.accepted] };
  /** build with V2's choice for H, the option given and any of the choice's fields replaced. */
  const build = (accepted: PaymentRequirements, choice: Record<string, unknown> = {}) =>
    exactXrpl.build({ ...V.V2.build, ...choice, required: { ...required, accepts: [accepted] }, accepted } as never, H);
  /** decodeBlob, bound and reference of V2's payment carrying `blob`. */
  const read = async (blob: string) => [
    await decodeBlob(blob),
    await exactXrpl.bound(payment(blob, V.V2.accepted)),
    await exactXrpl.reference(payment(blob, V.V2.accepted), V.V2.accepted),
  ];

  const cases: Record<string, () => Promise<unknown[]>> = {
    // The codec's modules fail to load, as a package that is not installed does, for a fresh import of the xrpl entry point.
    "decodeBlob when ripple-binary-codec is not installed": async () => {
      const missing = () => {
        throw new Error("Cannot find package 'ripple-binary-codec'");
      };
      vi.resetModules();
      vi.doMock("ripple-binary-codec", missing);
      vi.doMock("ripple-binary-codec/dist/serdes/binary-parser.js", missing);
      try {
        const { decodeBlob: withoutCodec } = await import("../src/xrpl.js");
        return [await withoutCodec(V.V2.blob), await withoutCodec(V.V3.blob)];
      } finally {
        vi.doUnmock("ripple-binary-codec");
        vi.doUnmock("ripple-binary-codec/dist/serdes/binary-parser.js");
        vi.resetModules();
      }
    },
    "a blob that is not an even number of hex digits, or that the codec cannot decode": async () => [
      ...(await read(V.V2.blob.slice(0, -1))),
      ...(await read(`ZZ${V.V2.blob.slice(2)}`)),
      ...(await read(V.V2.blob.slice(0, -2))),
      ...(await read("FFFF")),
    ],
    "a blob that is not the canonical serialization of what it decodes to (strictEncoding)": async () =>
      (await Promise.all((V.strictEncoding.rows as { blob: string }[]).map((r) => read(r.blob)))).flat(),
    "a blob over 32768 hex characters (16,384 bytes, XRPL_MAX_BLOB_BYTES)": async () => [
      ...(await read("00".repeat(16385))),
      ...(await read(`${V.V2.blob}${"00".repeat(16385 - V.V2.blob.length / 2)}`)),
    ],
    "recover when the reader fails or answers malformed": async () => {
      const ref = { network: V.V2.expectReference.network, tx: V.V2.expectReference.transaction, option: V.V2.accepted as PaymentRequirements };
      return [
        await chargeXrpl.recover(ref, readerFor("reader-error")),
        await chargeXrpl.recover(ref, readerFor(null)),
        await chargeXrpl.recover(ref, readerFor("tesSUCCESS")),
      ];
    },
    "build with a malformed fee, sequence, ticket sequence or LastLedgerSequence, or an amount build cannot write": async () => {
      const ticketed = { ...V.V2.accepted, extra: { ...V.V2.accepted.extra, assetTransferMethod: "ticketSequence" } };
      expect("refused" in (await build(ticketed, { ticketSequence: 5 }))).toBe(false);
      return [
        await build(V.V2.accepted, { fee: "1.2" }),
        await build(V.V2.accepted, { fee: 12 }),
        await build(V.V2.accepted, { sequence: -1 }),
        await build(V.V2.accepted, { sequence: 2 ** 32 }),
        await build(ticketed, { ticketSequence: -1 }),
        await build(ticketed, { ticketSequence: 2 ** 32 }),
        await build(ticketed),
        await build(V.V2.accepted, { lastLedgerSequence: -1 }),
        await build(V.V2.accepted, { lastLedgerSequence: 2 ** 32 }),
        await build({ ...V.V2.accepted, amount: "1.5" }),
        await build({ ...V.V2.accepted, asset: "USD" }),
      ];
    },
    "a payment whose option fails the pairing's filter": async () => {
      const extra = V.V2.accepted.extra;
      const options = [
        { ...V.V2.accepted, scheme: "upto" },
        { ...V.V2.accepted, network: "eip155:8453" },
        { ...V.V2.accepted, extra: { ...extra, areFeesSponsored: true } },
        { ...V.V2.accepted, extra: { ...extra, assetTransferMethod: "permit2" } },
        { ...V.V2.accepted, extra: { ...extra, invoiceId: 7 } },
      ];
      return (
        await Promise.all(options.map(async (o) => [await exactXrpl.bound(payment(V.V2.blob, o)), await exactXrpl.reference(payment(V.V2.blob, o), o)]))
      ).flat();
    },
  };

  // The rows whose blobs are read on a network: V2's option on the row's network, and V2's Payment re-signed with each of
  // the row's networkIds (the same steps without one give V2's blob). bound, reference and build's complete read the
  // blob's NetworkID by rippled's rule, so each call is refused. On xrpl:21337 the Payment carrying 21337 is taken.
  type NetworkRow = { case: string; network: `xrpl:${number}`; networkIds?: number[]; blobs: string[]; expect: string };
  const networkRows = (V.agreedRefusals.rows as NetworkRow[]).filter((r) => r.network !== undefined);
  const onNetwork = (network: `xrpl:${number}`) => ({ ...V.V2.accepted, network }) as PaymentRequirements;
  const calls = async (accepted: PaymentRequirements, blob: string) => {
    const u = await build(accepted);
    if ("refused" in u) throw new Error(u.code);
    return [await exactXrpl.bound(payment(blob, accepted)), await exactXrpl.reference(payment(blob, accepted), accepted), await u.complete(blob)];
  };
  for (const r of networkRows) {
    cases[r.case] = async () => {
      expect(resigned(V.V2.blob)).toBe(V.V2.blob);
      expect(r.networkIds?.map((n) => resigned(V.V2.blob, n)) ?? [V.V2.blob]).toEqual(r.blobs);
      return (await Promise.all(r.blobs.map((blob) => calls(onNetwork(r.network), blob)))).flat();
    };
  }
  it("the network rows: three, and the Payment carrying xrpl:21337's own id is taken there", async () => {
    expect(networkRows.map((r) => r.network)).toEqual(["xrpl:1", "xrpl:21337", "xrpl:21337"]);
    const own = resigned(V.V2.blob, 21337);
    const [bound, reference, completed] = await calls(onNetwork("xrpl:21337"), own);
    expect(bound).toBe(H);
    expect(reference).toMatchObject({ network: "xrpl:21337" });
    expect(completed).toMatchObject({ payload: { signedTxBlob: own } });
    expect(await calls(V.V2.accepted, V.V2.blob)).toMatchObject([H, V.V2.expectReference, { payload: { signedTxBlob: V.V2.blob } }]);
  });

  const rows = rowsOf(V.agreedRefusals.rows as { case: string; expect: string }[], "x402-exact-xrpl.json agreedRefusals.rows", {
    exact: Object.keys(cases).length,
  });

  it("names a case for every row, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }
});
