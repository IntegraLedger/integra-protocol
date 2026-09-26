// Runs vectors/mpp-charge-lightning.json and vectors/mpp-session-lightning.json through the lightning entry point's
// MPP pairings. Every expected value is the files' (L2, L3 and plant 1, each naming its source there); the
// invoice is also read by light-bolt11-decoder and bolt11 as a cross-check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode as lightDecode } from "light-bolt11-decoder";
import bolt11 from "bolt11";
import { canonicalJson, type AtrHash, type Json } from "../src/index.js";
import { issuedDigest, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { chargeLightning, decodeBolt11, sessionLightning, type Bolt11, type LnMppUnsigned } from "../src/lightning.js";

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
    expect(await issuedDigest(chargeLightning.unplaced(offer))).toBe(C.L3.expectIssuedDigest);
    expect(await issuedDigest(offer)).toBe(C.L3.expectIssuedDigest);
    expect(decodeRequest(chargeLightning.unplaced(offer).request).methodDetails).not.toHaveProperty("invoice");
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
    for (const row of C.L3.refusals) {
      it(row.case, () => {
        const bad = challengeOf(C.L3, row.requestSet ?? {}, row.challengeSet ?? {});
        expect(chargeLightning.advertise([bad], H, C.fixed.link, bad)).toEqual(row.expect);
      });
    }
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
    expect(decodeRequest(sessionLightning.unplaced(offer).request)).toEqual(S.S1.expectUnplacedRequest);
  });

  it("the open action pays the deposit invoice and binds H", async () => {
    const challenge = placed();
    const u = (await sessionLightning.build({ challenge, returnInvoice: S.fixed.returnInvoice }, H)) as LnMppUnsigned;
    const credential = u.complete(S.fixed.preimage) as MppCredential;
    expect(credential.payload).toEqual({ action: "open", preimage: S.fixed.preimage, returnInvoice: S.fixed.returnInvoice });
    expect(await sessionLightning.bound(credential)).toBe(S.S1.expectBound);
  });

  for (const row of S.S1.rows) {
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
    for (const row of S.S1.returnInvoiceRows) {
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
// The regtest and testnet invoices are S1's deposit invoice (L2, h = H) with its human-readable part changed to
// `lnbcrt250n` and `lntb250n` and its BIP-173 checksum recomputed; lcp's decoder verifies no signature. BOLT11's
// currency prefixes: `bcrt` is regtest, and `tb` is Bitcoin's testnets, testnet3 and testnet4.
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

  it("the rewritten invoices decode to the regtest and testnet currencies with S1's hash and h", async () => {
    const r = (await decodeBolt11(rehrp(deposit, "lnbcrt250n"))) as Bolt11;
    const t = (await decodeBolt11(rehrp(deposit, "lntb250n"))) as Bolt11;
    expect([r.currency, t.currency]).toEqual(["bcrt", "tb"]);
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

  it("a testnet4 session naming testnet4: the read keys name testnet4", async () => {
    const credential = opened(rehrp(deposit, "lntb250n"), { network: "testnet4" });
    expect(await sessionLightning.reference(credential)).toMatchObject({ network: "testnet4" });
  });
});

// Both MPP Lightning pairings carry the ATR hash as the `mpp/charge` profile places it: the pattern names that profile.
describe("the Lightning MPP patterns' profile", () => {
  it("both MPP pairings name the profile mpp/charge", () => {
    expect([chargeLightning.pattern.profile, sessionLightning.pattern.profile]).toEqual(["mpp/charge", "mpp/charge"]);
    expect(sessionLightning.pattern).toMatchObject({ pattern: "native-field", canonical: true, buyerSigns: false });
  });
});
