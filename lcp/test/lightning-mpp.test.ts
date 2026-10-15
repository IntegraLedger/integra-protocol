// Runs vectors/mpp-charge-lightning.json and vectors/mpp-session-lightning.json through the lightning entry point's
// MPP pairings. Every expected value is the files' (L2, L3 and plant 1, each naming its source there); the
// invoice is also read by light-bolt11-decoder and bolt11 as a cross-check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode as lightDecode } from "light-bolt11-decoder";
import bolt11 from "bolt11";
import { canonicalJson, type AtrHash, type Json } from "../src/index.js";
import { issuedDigest, pairingsOf, type MppChallenge, type MppCredential } from "../src/mpp.js";
import {
  chargeLightning,
  decodeBolt11,
  exactLnbtc,
  exactLnbtcNamed,
  sessionLightning,
  type Bolt11,
  type LnMppUnsigned,
} from "../src/lightning.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const C = load("mpp-charge-lightning.json");
const S = load("mpp-session-lightning.json");
const H: AtrHash = C.fixed.H;
const hex = (b: Uint8Array | null) => (b === null ? null : Buffer.from(b).toString("hex"));
const encode = (request: Json) => Buffer.from(canonicalJson(request) as string).toString("base64url");
const decodeRequest = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

function set<T>(base: T, changes: Record<string, unknown>): T {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    if (value === null) delete at[keys[keys.length - 1]!];
    else at[keys[keys.length - 1]!] = value;
  }
  return copy as T;
}
const challengeOf = (v: { challenge: object; request: Json }, requestSet = {}, challengeSet = {}): MppChallenge =>
  ({ ...set(v.challenge, challengeSet), request: encode(set(v.request, requestSet)) }) as MppChallenge;

describe("mpp/charge/lightning", () => {
  const offer = challengeOf(C.L3);
  const placed = () => {
    const doc = chargeLightning.advertise([offer], H, C.fixed.link, offer);
    if (!Array.isArray(doc)) throw new Error((doc as { code: string }).code);
    return doc[0]! as MppChallenge & { id: string };
  };

  it("L2: the invoice carries H as its description hash", async () => {
    const b = (await decodeBolt11(C.L2.invoice)) as Bolt11;
    expect({
      currency: b.currency,
      amountMsat: b.amountMsat?.toString(),
      timestamp: b.timestamp,
      expiry: b.expiry,
      paymentHash: hex(b.paymentHash),
      descriptionHash: hex(b.descriptionHash),
      metadata: hex(b.metadata),
    }).toEqual(C.L2.expect);
    const light = lightDecode(C.L2.invoice).sections as { name: string; value?: unknown }[];
    expect(light.find((s) => s.name === "description_hash")?.value).toBe(C.L2.expect.descriptionHash);
    expect(bolt11.decode(C.L2.invoice).payeeNodeKey).toBe(C.L2.expectPayee);
  });

  it("L3: place sets the id from H, and the issued digest is the vector's with and without the invoice", async () => {
    expect(placed().id).toBe(C.L3.expectId);
    const issued = chargeLightning.unplaced(offer) as MppChallenge;
    expect(await issuedDigest(issued)).toBe(C.L3.expectIssuedDigest);
    expect(await issuedDigest(offer)).toBe(C.L3.expectIssuedDigest);
    expect(decodeRequest(issued.request).methodDetails).not.toHaveProperty("invoice");
  });

  it("L3: build pays L2, and bound of the credential gives H", async () => {
    const challenge = placed();
    const u = (await chargeLightning.build({ challenge }, H)) as LnMppUnsigned;
    expect(u.request).toEqual({ kind: "bolt11-pay", invoice: C.L2.invoice });
    const credential = u.complete(C.fixed.preimage) as MppCredential;
    expect(credential).toEqual({ challenge, payload: { preimage: C.fixed.preimage } });
    expect(await chargeLightning.bound(credential)).toBe(C.L3.expectBound);
    expect(await chargeLightning.reference(credential)).toEqual(C.L3.expectReference);
  });

  describe("L3: advertise's refusals", () => {
    for (const row of rowsOf(C.L3.refusals, "mpp-charge-lightning.json L3.refusals")) {
      it(row.case, () => {
        const bad = challengeOf(C.L3, row.requestSet ?? {}, row.challengeSet ?? {});
        expect(chargeLightning.advertise([bad], H, C.fixed.link, bad)).toEqual(row.expect);
      });
    }
  });

  // draft-lightning-charge-00's `network`: "MUST be one of "mainnet", "regtest", or "signet". If present, MUST match the
  // network implied by the invoice's human-readable prefix." L2's prefix `lnbc` is mainnet (BOLT 11). An echo carrying
  // L3's request with another network keeps the placed id and opaque; the reads answer it as advertise does.
  describe("L3: bound and reference check the echoed network as advertise does", () => {
    const rows: [string, Record<string, unknown>, string][] = [
      ...(rowsOf(C.L3.refusals, "mpp-charge-lightning.json L3.refusals", {
        exact: 1,
        keep: [
          "the network row on the request",
          (r: { expect: { code: string }; challengeSet?: unknown }) => r.expect.code === "ln/currency-network" && r.challengeSet === undefined,
        ],
        leave: [
          "every other row, which L3: advertise's refusals runs above",
          (r: { expect: { code: string }; challengeSet?: unknown }) => r.expect.code !== "ln/currency-network" || r.challengeSet !== undefined,
        ],
      }) as any)
        .map((r: { case: string; requestSet: Record<string, unknown> }) => [r.case, r.requestSet, "ln/currency-network"]),
      ["network bogus", { "methodDetails.network": "bogus" }, "ln/currency-network"],
      ["network 5", { "methodDetails.network": 5 }, "ln/currency-network"],
      ["network testnet, which MPP Lightning does not name", { "methodDetails.network": "testnet" }, "ln/currency-network"],
    ];
    it("the file gives one network row", () => {
      expect(rows.length).toBe(4);
    });
    for (const [name, change, code] of rows) {
      it(name, async () => {
        const bad = challengeOf(C.L3, change);
        expect(chargeLightning.advertise([bad], H, C.fixed.link, bad)).toEqual({ refused: true, code });
        const credential: MppCredential = { challenge: { ...placed(), request: encode(set(C.L3.request, change)) }, payload: { preimage: C.fixed.preimage } };
        expect(await chargeLightning.bound(credential)).toEqual({ refused: true, code });
        expect(await chargeLightning.reference(credential)).toEqual({ refused: true, code });
      });
    }
    it("no network: the read keys name the network of the invoice's currency, mainnet", async () => {
      const request = set(C.L3.request, { "methodDetails.network": null });
      const credential: MppCredential = { challenge: { ...placed(), request: encode(request) }, payload: { preimage: C.fixed.preimage } };
      expect(await chargeLightning.reference(credential)).toEqual(C.L3.expectReference);
    });
  });

  it("plant 1: an echo whose invoice does not carry the challenge's hash is never bound", async () => {
    const challenge = placed();
    const request = set(C.L3.request, { "methodDetails.invoice": C.plant.invoice });
    const credential: MppCredential = { challenge: { ...challenge, request: encode(request) }, payload: { preimage: C.fixed.preimage } };
    expect(await chargeLightning.bound(credential)).toEqual(C.plant.expect);
  });
});

describe("mpp/session/lightning", () => {
  const offer = challengeOf(S.S1);
  const placed = () => {
    const doc = sessionLightning.advertise([offer], H, S.fixed.link, offer);
    if (!Array.isArray(doc)) throw new Error((doc as { code: string }).code);
    return doc[0]! as MppChallenge & { id: string };
  };

  it("unplaced drops the deposit invoice at the top of request", () => {
    const issued = sessionLightning.unplaced(offer) as MppChallenge;
    expect(decodeRequest(issued.request)).toEqual(S.S1.expectUnplacedRequest);
  });

  it("the open action pays the deposit invoice and binds H", async () => {
    const challenge = placed();
    const u = (await sessionLightning.build({ challenge, returnInvoice: S.fixed.returnInvoice }, H)) as LnMppUnsigned;
    const credential = u.complete(S.fixed.preimage) as MppCredential;
    expect(credential.payload).toEqual({ action: "open", preimage: S.fixed.preimage, returnInvoice: S.fixed.returnInvoice });
    expect(await sessionLightning.bound(credential)).toBe(S.S1.expectBound);
  });

  for (const row of rowsOf(S.S1.rows, "mpp-session-lightning.json S1.rows")) {
    it(row.case, async () => {
      expect(await sessionLightning.bound({ challenge: placed(), payload: row.payload })).toEqual(row.expect);
    });
  }

  it("the return invoice has no amount: light-bolt11-decoder 3.2.0 and bolt11 1.4.1 find none", async () => {
    const light = lightDecode(S.fixed.returnInvoice);
    expect(light.sections.find((s: { name: string }) => s.name === "amount")).toBeUndefined();
    const decoded = bolt11.decode(S.fixed.returnInvoice);
    expect(decoded.millisatoshis ?? null).toBe(null);
    expect(decoded.satoshis ?? null).toBe(null);
    expect(((await decodeBolt11(S.fixed.returnInvoice)) as Bolt11).amountMsat).toBe(null);
  });

  describe("build refuses, before naming the deposit invoice to pay, a return invoice the open action cannot carry", () => {
    for (const row of rowsOf(S.S1.returnInvoiceRows, "mpp-session-lightning.json S1.returnInvoiceRows")) {
      it(row.case, async () => {
        if (typeof row.returnInvoice === "string" && row.returnInvoice.startsWith("lnbc")) {
          expect(bolt11.decode(row.returnInvoice).millisatoshis).not.toBe(null);
        }
        const choice = row.returnInvoice === null ? { challenge: placed() } : { challenge: placed(), returnInvoice: row.returnInvoice };
        const u = await sessionLightning.build(choice, H);
        expect("request" in u).toBe(false);
        expect(u).toEqual({ refused: row.expectRefused, code: row.expectCode });
      });
    }
  });
});

describe("mpp/session/lightning's channel members (draft-lightning-session-00's actions)", () => {
  const offer = challengeOf(S.S1);
  const placed = () => (sessionLightning.advertise([offer], H, S.fixed.link, offer) as (MppChallenge & { id: string })[])[0]!;
  const ph: string = S.fixed.paymentHash;
  it("kind: open, bearer and topUp within, close, anything else refused", () => {
    const k = (payload: object) => sessionLightning.channel.kind({ challenge: placed(), payload });
    expect(k({ action: "open", preimage: S.fixed.preimage })).toBe("open");
    expect(k({ action: "bearer", sessionId: ph, preimage: S.fixed.preimage })).toBe("within");
    expect(k({ action: "topUp", sessionId: ph, topUpPreimage: S.fixed.preimage })).toBe("within");
    expect(k({ action: "close", sessionId: ph, preimage: S.fixed.preimage })).toBe("close");
    expect(k({ action: "renew" })).toEqual({ refused: true, code: "mpp/session-action" });
  });
  it("ref: the open's challenge paymentHash, and every later action's sessionId, name one channel", async () => {
    const open = await sessionLightning.channel.ref({ challenge: placed(), payload: { action: "open", preimage: S.fixed.preimage } });
    const bearer = await sessionLightning.channel.ref({
      challenge: { ...S.S1.challenge, id: "x", request: encode({ amount: "2", currency: "sat", paymentHash: "00".repeat(32) }) },
      payload: { action: "bearer", sessionId: ph.toUpperCase(), preimage: S.fixed.preimage },
    });
    expect(open).toEqual(bearer);
    expect(open).toEqual({ network: "lightning", channel: ph.toLowerCase() });
  });
  it("boundWithin refuses, and until is undefined", async () => {
    const bearer = { challenge: placed(), payload: { action: "bearer", sessionId: ph, preimage: S.fixed.preimage } };
    expect(await sessionLightning.channel.boundWithin(bearer)).toEqual({ refused: true, code: "mpp/not-bound-within" });
    expect(sessionLightning.channel.until(bearer)).toBe(undefined);
  });
});

// The session's read keys name the network the MPP challenge names in `methodDetails.network`, else the network of
// the invoice's currency; its channel key is `{network: "lightning", channel: <payment hash>}` whatever that network.
// The regtest, testnet and signet invoices are S1's deposit invoice (L2, h = H) with its human-readable part changed to
// `lnbcrt250n`, `lntb250n` and `lntbs250n` and its BIP-173 checksum recomputed; lcp's decoder verifies no signature.
// BOLT11's currency prefixes: `bcrt` is regtest, `tbs` is signet, and `tb` is Bitcoin's testnets, testnet3 and testnet4.
describe("mpp/session/lightning's read keys name the challenge's network", () => {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const polymod = (values: number[]): number => {
    const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= G[i]!;
    }
    return chk;
  };
  const expand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  /** The invoice with its human-readable part replaced by `hrp` and its checksum recomputed. */
  const rehrp = (invoice: string, hrp: string): string => {
    const sep = invoice.lastIndexOf("1");
    const data = [...invoice.slice(sep + 1, -6)].map((c) => CHARSET.indexOf(c));
    const mod = polymod([...expand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
    const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
    return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join("")}`;
  };
  const deposit: string = S.S1.request.depositInvoice;
  const opened = (invoice: string, details?: object) => {
    const offer = challengeOf(S.S1, { depositInvoice: invoice, ...(details !== undefined ? { methodDetails: details } : {}) });
    const doc = sessionLightning.advertise([offer], H, S.fixed.link, offer);
    if (!Array.isArray(doc)) throw new Error((doc as { code: string }).code);
    return { challenge: doc[0]!, payload: { action: "open", preimage: S.fixed.preimage, returnInvoice: S.fixed.returnInvoice } };
  };

  it("the rewritten invoices decode to the regtest, testnet and signet currencies with S1's hash and h", async () => {
    const r = (await decodeBolt11(rehrp(deposit, "lnbcrt250n"))) as Bolt11;
    const t = (await decodeBolt11(rehrp(deposit, "lntb250n"))) as Bolt11;
    const s = (await decodeBolt11(rehrp(deposit, "lntbs250n"))) as Bolt11;
    expect([r.currency, t.currency, s.currency]).toEqual(["bcrt", "tb", "tbs"]);
    expect(hex(r.paymentHash)).toBe(S.fixed.paymentHash);
  });

  it("a regtest session naming regtest: the read keys name regtest, the channel key lightning", async () => {
    const credential = opened(rehrp(deposit, "lnbcrt250n"), { network: "regtest" });
    expect(await sessionLightning.bound(credential)).toBe(H);
    expect(await sessionLightning.reference(credential)).toMatchObject({ network: "regtest", paymentHash: S.fixed.paymentHash });
    expect(await sessionLightning.channel.ref(credential)).toEqual({ network: "lightning", channel: S.fixed.paymentHash });
  });

  it("a regtest session naming no network: the read keys name the invoice currency's, regtest", async () => {
    const credential = opened(rehrp(deposit, "lnbcrt250n"));
    expect(await sessionLightning.reference(credential)).toMatchObject({ network: "regtest" });
  });

  it("a signet session naming signet: the read keys name signet", async () => {
    const credential = opened(rehrp(deposit, "lntbs250n"), { network: "signet" });
    expect(await sessionLightning.reference(credential)).toMatchObject({ network: "signet" });
  });

  it("a testnet session naming no network: the read keys name the invoice currency's, testnet", async () => {
    const credential = opened(rehrp(deposit, "lntb250n"));
    expect(await sessionLightning.reference(credential)).toMatchObject({ network: "testnet" });
  });

  // draft-lightning-charge-00's `network`: "MUST be one of "mainnet", "regtest", or "signet". If present, MUST match the
  // network implied by the invoice's human-readable prefix." BOLT 11 (11-payment-encoding.md), the invoice's prefix:
  // "`ln` + BIP-0173 currency prefix (e.g. `lnbc` for Bitcoin mainnet, `lntb` for Bitcoin testnet, `lntbs` for Bitcoin
  // signet, and `lnbcrt` for Bitcoin regtest)". draft-lightning-session-00 defines no `network`, so the session reads
  // `methodDetails.network` by the charge's rule.
  /**
   * `offer` as the buyer's chosen challenge: with the id and the `opaque` that `place` writes for S1's deposit invoice,
   * which `build` holds as `bound` holds an echoed challenge.
   */
  const chosen = (offer: MppChallenge) => {
    const placed = opened(deposit).challenge;
    return { ...offer, id: placed.id, opaque: placed.opaque } as MppChallenge & { id: string };
  };
  /** The open credential of a placed session challenge, echoed with `request` in place of the one placed. */
  const echoing = (request: Json) => {
    const credential = opened(deposit);
    return { ...credential, challenge: { ...credential.challenge, request: encode(request) } };
  };

  describe("advertise, build, bound and reference refuse a named network the invoice's currency does not match", () => {
    const rows: [string, string, object][] = [
      ["S1's mainnet invoice naming regtest", deposit, { network: "regtest" }],
      ["a regtest invoice naming mainnet", rehrp(deposit, "lnbcrt250n"), { network: "mainnet" }],
      ["a testnet invoice naming testnet4, which MPP Lightning does not name", rehrp(deposit, "lntb250n"), { network: "testnet4" }],
      ["a testnet invoice naming signet", rehrp(deposit, "lntb250n"), { network: "signet" }],
    ];
    for (const [name, invoice, details] of rows) {
      it(name, async () => {
        const offer = challengeOf(S.S1, { depositInvoice: invoice, methodDetails: details });
        expect(sessionLightning.advertise([offer], H, S.fixed.link, offer)).toEqual({ refused: true, code: "ln/currency-network" });
        const challenge = chosen(offer);
        expect(await sessionLightning.build({ challenge, returnInvoice: S.fixed.returnInvoice }, H)).toEqual({ refused: true, code: "ln/currency-network" });
        const echo = echoing(set(S.S1.request, { depositInvoice: invoice, methodDetails: details }));
        expect(await sessionLightning.bound(echo)).toEqual({ refused: true, code: "ln/currency-network" });
        expect(await sessionLightning.reference(echo)).toEqual({ refused: true, code: "ln/currency-network" });
      });
    }
  });

  // A `network` that is not a string MPP Lightning defines names no network an invoice can match, and a `methodDetails`
  // that is not an object has no `network` to read: each read answers as `advertise` does, never with the invoice's own
  // network in the record.
  describe("bound and reference answer a network that is not one MPP Lightning defines, or no methodDetails object, as advertise does", () => {
    const rows: [string, Record<string, unknown>, string][] = [
      ["network bogus", { methodDetails: { network: "bogus" } }, "ln/currency-network"],
      ["network 5", { methodDetails: { network: 5 } }, "ln/currency-network"],
      ["methodDetails the string mainnet", { methodDetails: "mainnet" }, "mpp/request-malformed"],
    ];
    for (const [name, change, code] of rows) {
      it(name, async () => {
        const request = set(S.S1.request, change);
        const offer = challengeOf(S.S1, change);
        expect(sessionLightning.advertise([offer], H, S.fixed.link, offer)).toEqual({ refused: true, code });
        expect(await sessionLightning.bound(echoing(request))).toEqual({ refused: true, code });
        expect(await sessionLightning.reference(echoing(request))).toEqual({ refused: true, code });
      });
    }
    it("a regtest invoice echoed naming regtest binds and reads regtest", async () => {
      const echo = echoing(set(S.S1.request, { depositInvoice: rehrp(deposit, "lnbcrt250n"), methodDetails: { network: "regtest" } }));
      expect(await sessionLightning.bound(echo)).toBe(H);
      expect(await sessionLightning.reference(echo)).toMatchObject({ network: "regtest", paymentHash: S.fixed.paymentHash });
    });
  });

  describe("S1's refusals: advertise and build, and bound and reference on a network row", () => {
    for (const row of rowsOf(S.S1.refusals, "mpp-session-lightning.json S1.refusals")) {
      it(row.case, async () => {
        const offer = challengeOf(S.S1, row.requestSet ?? {}, row.challengeSet ?? {});
        expect(sessionLightning.advertise([offer], H, S.fixed.link, offer)).toEqual(row.expect);
        const challenge = chosen(offer);
        expect(await sessionLightning.build({ challenge, returnInvoice: S.fixed.returnInvoice }, H)).toEqual(row.expect);
        if (row.expect.code === "ln/currency-network" && row.challengeSet === undefined) {
          const echo = echoing(set(S.S1.request, row.requestSet));
          expect(await sessionLightning.bound(echo)).toEqual(row.expect);
          expect(await sessionLightning.reference(echo)).toEqual(row.expect);
        }
      });
    }
  });
});

// MPP's Lightning drafts give the request's `amount` in satoshis and its `currency` as "sat" (draft-lightning-charge-00,
// draft-lightning-session-00). Neither pairing reads either member: H rides in the invoice's `h`, and the ATR commits the
// request's `paymentHash`. A request with another currency, or no amount, names its pairing, is placed with the id each
// file gives (L3's expectId, S1's B6 challenge), and binds the file's H.
describe("the Lightning MPP pairings read no amount or currency", () => {
  const rows: [string, Record<string, unknown>][] = [
    ["currency BTC", { currency: "BTC" }],
    ["no currency", { currency: null }],
    ["an amount that is not a decimal integer", { amount: "2.5" }],
    ["no amount", { amount: null }],
  ];
  for (const [name, change] of rows) {
    it(`mpp/charge/lightning: ${name}`, async () => {
      const offer = challengeOf(C.L3, change);
      expect(pairingsOf(offer)).toEqual(["mpp/charge/lightning"]);
      const doc = chargeLightning.advertise([offer], H, C.fixed.link, offer) as (MppChallenge & { id: string })[];
      expect(doc[0]!.id).toBe(C.L3.expectId);
      const u = (await chargeLightning.build({ challenge: doc[0]! }, H)) as LnMppUnsigned;
      expect(await chargeLightning.bound(u.complete(C.fixed.preimage))).toBe(C.L3.expectBound);
    });
    it(`mpp/session/lightning: ${name}`, async () => {
      const offer = challengeOf(S.S1, change);
      expect(pairingsOf(offer)).toEqual(["mpp/session/lightning"]);
      const doc = sessionLightning.advertise([offer], H, S.fixed.link, offer) as (MppChallenge & { id: string })[];
      expect(doc[0]!.id).toBe(S.buyer.rows.find((r: { name: string }) => r.name === "B6").input.presented.challenge.id);
      const u = (await sessionLightning.build({ challenge: doc[0]!, returnInvoice: S.fixed.returnInvoice }, H)) as LnMppUnsigned;
      expect(await sessionLightning.bound(u.complete(S.fixed.preimage))).toBe(S.S1.expectBound);
    });
  }
});

// The pairings read the invoice, never a payment: settlement is the seller's report, the invoice and its preimage are
// what the parties hold, and no signature is verified here. Each record whose invoice carries the hash says so, and
// none says that the payer paid, that its node checked a signature, or that the seller did not verify one.
describe("the records of the Lightning pairings whose invoice carries the hash", () => {
  for (const b of [exactLnbtc, chargeLightning, sessionLightning]) {
    it(`${b.id}: proves states that no signature is verified here and that settlement is the seller's report`, () => {
      expect(b.pattern.proves).toContain(
        "Its signature is not verified here, and the payer signed nothing that carries the hash. Settlement is the " +
          "seller's report; the invoice and its preimage, which the parties hold, show that the invoice was paid; " +
          "they do not show who paid it, and no public ledger shows the payment.",
      );
      expect(b.pattern.proves).not.toMatch(/the payer paid|checked the node signature|did not verify/i);
    });
  }
});

// On x402/exact/lnbtc/invoice-named the invoice carries no hash and the ATR names the option as issued. Its record says
// that, and that settlement is the seller's report; it says nothing of the payer's payment, of the buyer's gate or of a
// check the seller made, none of which the pairing reads.
describe("the invoice-named Lightning pairing's record", () => {
  it("proves states what the ATR names and that settlement is the seller's report", () => {
    const proves = exactLnbtcNamed.pattern.proves;
    expect(proves).toContain(
      "The ATR names this payment: its binding slot holds the payment option as issued, including the seller node's " +
        "signed BOLT11 invoice, whose description hash is x402's request hash.",
    );
    expect(proves).toContain("Settlement is the seller's report; the invoice and its preimage, which the parties hold,");
    expect(proves).not.toMatch(/the payer paid|gate paid|seller checked/i);
  });
});

// Both MPP Lightning pairings carry the ATR hash as the `mpp/charge` profile places it: the pattern names that profile.
describe("the Lightning MPP patterns' profile", () => {
  it("both MPP pairings name the profile mpp/charge", () => {
    expect([chargeLightning.pattern.profile, sessionLightning.pattern.profile]).toEqual(["mpp/charge", "mpp/charge"]);
    expect(sessionLightning.pattern).toMatchObject({ pattern: "native-field", canonical: true, buyerSigns: false });
  });
});
