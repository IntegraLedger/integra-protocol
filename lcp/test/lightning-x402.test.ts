// Runs vectors/x402-exact-lnbtc.json and vectors/x402-exact-lnbtc-invoice-named.json through the lightning entry
// point. Every expected value is the files' (L1, L4, L5, L6 and plant 2, each naming its source there);
// the invoices are also read by light-bolt11-decoder and bolt11 as a cross-check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode as lightDecode } from "light-bolt11-decoder";
import bolt11 from "bolt11";
import { assemble, type AtrHash } from "../src/index.js";
import { issuedDigest, tie, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import {
  atrNamesInvoice,
  decodeBolt11,
  exactLnbtc,
  exactLnbtcNamed,
  invoiceH,
  lnbtcPairingOf,
  type Bolt11,
  type LnPaymentPayload,
  type LnUnsigned,
} from "../src/lightning.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const V = load("x402-exact-lnbtc.json");
const N = load("x402-exact-lnbtc-invoice-named.json");
const H: AtrHash = V.fixed.H;
const hex = (b: Uint8Array | null) => (b === null ? null : Buffer.from(b).toString("hex"));
const required = (o: PaymentRequirements): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });

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
});

describe("x402/exact/lnbtc", () => {
  const O: PaymentRequirements = V.fixed.O;

  it("L5: unplaced drops the invoice, and the issued digest is the vector's", async () => {
    const u = exactLnbtc.unplaced(O);
    expect(u.extra).not.toHaveProperty("invoice");
    expect(await issuedDigest(u)).toBe(V.L5.expectIssuedDigestOfUnplaced);
    expect(O.extra).toHaveProperty("invoice");
  });

  it("L5: advertise accepts the option; with x402's example invoice it refuses", () => {
    const doc = exactLnbtc.advertise(required(O), H, V.fixed.link, O) as PaymentRequired;
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: V.fixed.link });
    expect(doc.accepts[0]).toEqual(O);
    const plain = set<PaymentRequirements>(O, { "extra.invoice": V.fixed.x402ExampleInvoice });
    expect(exactLnbtc.advertise(required(plain), H, V.fixed.link, plain)).toEqual(V.L5.withExampleInvoice.expect);
    expect(exactLnbtc.read(doc)).toEqual({ h: H, link: V.fixed.link, offer: { required: doc, options: [O] } });
  });

  it("L5: build, complete, bound and reference", async () => {
    const u = (await exactLnbtc.build({ required: required(O), accepted: O }, H)) as LnUnsigned;
    expect(u.request).toEqual({ kind: "bolt11-pay", invoice: V.L4.invoice });
    const payment = u.complete(V.fixed.preimage) as LnPaymentPayload;
    expect(payment).toEqual(V.L5.payment);
    expect(await exactLnbtc.bound(payment)).toBe(V.L5.expectBound);
    expect(await exactLnbtc.reference(payment)).toEqual(V.L5.expectReference);
  });

  describe("refusal codes left to the implementation", () => {
    for (const row of V.refusals.rows) {
      it(row.case, async () => {
        const option = set(O, row.optionSet ?? {}) as PaymentRequirements;
        if (row.fn === "advertise") {
          expect(exactLnbtc.advertise(required(option), H, V.fixed.link, option)).toEqual(row.expect);
        } else if (row.fn === "advertiseOtherH") {
          expect(exactLnbtc.advertise(required(O), row.h, V.fixed.link, O)).toEqual(row.expect);
        } else if (row.fn === "complete") {
          const u = (await exactLnbtc.build({ required: required(O), accepted: O }, H)) as LnUnsigned;
          expect(u.complete(row.preimage)).toEqual(row.expect);
        } else {
          expect(await exactLnbtc.bound(set<unknown>(V.L5.payment, { accepted: option }))).toEqual(row.expect);
        }
      });
    }
  });
});

describe("x402/exact/lnbtc/invoice-named", () => {
  const ON: PaymentRequirements = N.fixed.O_N;
  const atr = async () => {
    const [slot, value] = tie([ON], N.fixed.request);
    const a = await assemble(N.fixed.atrId, [slot, value], []);
    if ("refused" in a) throw new Error(a.code);
    return a;
  };

  it("L6: the invoice N, O_N's digest, A_N and H_N", async () => {
    const b = (await decodeBolt11(N.L6.invoice)) as Bolt11;
    expect({
      currency: b.currency,
      amountMsat: b.amountMsat?.toString(),
      expiry: b.expiry,
      paymentHash: hex(b.paymentHash),
      descriptionHash: hex(b.descriptionHash),
      metadata: hex(b.metadata),
    }).toEqual(N.L6.expectDecoded);
    expect(section(lightDecode(N.L6.invoice), "metadata")).toBeUndefined();
    expect(bolt11.decode(N.L6.invoice).payeeNodeKey).toBe(N.fixed.payee);
    expect(await issuedDigest(ON)).toBe(N.L6.expectIssuedDigestOfO_N);
    expect(exactLnbtcNamed.unplaced(ON)).toBe(ON);
    const a = await atr();
    expect(a.bytes.length).toBe(N.L6.expectAtrLength);
    expect(a.atrHash).toBe(N.L6.expectH_N);
    expect(atrNamesInvoice(a.bytes, N.L6.invoice)).toBe(N.L6.expectAtrNamesInvoice);
  });

  it("L6: build pays N, and bound gives H_N from the echoed legal context", async () => {
    const a = await atr();
    const u = (await exactLnbtcNamed.build({ required: required(ON), accepted: ON, atr: a.bytes }, a.atrHash)) as LnUnsigned;
    expect(u.request).toEqual(N.L6.expectBuild);
    expect(await exactLnbtcNamed.bound(N.L6.payment)).toBe(N.L6.expectBound);
    expect(await exactLnbtcNamed.reference(N.L6.payment)).toEqual(N.L6.expectReference);
    const withL4 = set<unknown>(N.L6.payment, { "accepted.extra.invoice": N.fixed.L4 });
    expect(await exactLnbtcNamed.bound(withL4)).toEqual(N.L6.withL4.expect);
    const bare = set<unknown>(N.L6.payment, { extensions: undefined });
    expect(await exactLnbtcNamed.bound(bare)).toEqual(N.L6.withoutExtensions.expect);
  });

  it("an echoed option names its pairing by whether its invoice has m", () => {
    expect(lnbtcPairingOf(V.fixed.O)).toBe("x402/exact/lnbtc");
    expect(lnbtcPairingOf(ON)).toBe("x402/exact/lnbtc/invoice-named");
  });

  it("atrNamesInvoice: the named invoice is read only from the one x402 member that follows atrVersion and id", () => {
    const invoices: Record<string, string> = { N: N.L6.invoice, N2: N.plant2.invoice };
    const rows = N.atrNamesInvoice.rows as { case: string; atrHex: string; members: string[] | null; expect: Record<string, boolean> }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const bytes = Uint8Array.from(Buffer.from(r.atrHex, "hex"));
      const m = r.members;
      const layout = m !== null && m[0] === "atrVersion" && m[1] === "id" && m[2] === "x402" && new Set(m).size === m.length;
      if (!layout) expect([r.case, Object.values(r.expect).some((v) => v)]).toEqual([r.case, false]);
      for (const [name, expected] of Object.entries(r.expect)) {
        expect([r.case, name, atrNamesInvoice(bytes, invoices[name]!)]).toEqual([r.case, name, expected]);
      }
    }
  });

  it("plant 2: the buyer never pays an invoice its ATR does not name", async () => {
    const a = await atr();
    const offered = set(ON, { "extra.invoice": N.plant2.invoice }) as PaymentRequirements;
    expect(await exactLnbtcNamed.build({ required: required(offered), accepted: offered, atr: a.bytes }, a.atrHash)).toEqual(
      N.plant2.expect,
    );
  });
});
