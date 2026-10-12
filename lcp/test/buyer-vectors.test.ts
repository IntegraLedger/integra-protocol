// The lcp half of buyer.json's rows for the agreement option and its PAYMENT-REQUIRED header, content codings, Stellar
// builds, mpp/session/xrpl amounts and the within challenge's opaque: each fixture is what its row says it is, and each
// build the rows name refuses with the row's code before anything reaches a signer. The gates run the whole rows.
// Every expected value is the file's.
import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { hash, hashEquals, pairingOf, toLcpString, type AtrHash } from "../src/index.js";
import { chargeStellar, pairingsOf, sessionResume, sessionTempo, type MppChallenge } from "../src/mpp.js";
import { decodeStringMap } from "../src/mpp-challenge.js";
import { isRefusal } from "../src/refusal.js";
import { exactEip3009, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import { exactStellar } from "../src/x402-exact-stellar.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const B = load("buyer.json");
const row = (name: string) => B.rows.find((r: { name: string }) => r.name === name);
const fromHex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));
const AG = B.fixed.agreement;
const H: AtrHash = row("B1").expect.h;
const LINK = `https://atr.seller.example/${H}`;
const request = (c: { request: string }) => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));

describe("buyer.json: the agreement option the gate asks approval for", () => {
  const OPTION: PaymentRequirements = AG.option;

  it("requiredMixed is the agreement challenge exactEip3009.advertise writes for accepts [a Solana option, the agreement option]", () => {
    const [sol] = AG.requiredMixed.accepts as PaymentRequirements[];
    expect(pairingOf(sol!)).toBe("x402/exact/solana");
    expect(sol!.network.startsWith("solana:")).toBe(true);
    const base: PaymentRequired = { x402Version: 2, resource: { url: AG.url }, accepts: [sol!, OPTION] };
    expect(exactEip3009.advertise(base, H, LINK, OPTION)).toEqual(AG.requiredMixed);
  });

  it("every approval a row expects is the chosen EVM option's amount, asset, payTo and network", () => {
    const terms = { amount: OPTION.amount, asset: OPTION.asset, payTo: OPTION.payTo, network: OPTION.network };
    const rows = B.rows.filter((r: { expect?: { approval?: unknown } }) => r.expect?.approval !== undefined);
    expect(rows.map((r: { name: string }) => r.name)).toEqual(["BA1", "BA3", "BA4", "BA7", "BA8", "BA9", "BA11"]);
    for (const r of rows) expect(r.expect.approval, r.name).toEqual(terms);
    for (const r of rows) expect(typeof r.input.approve, r.name).toBe("boolean");
  });

  it("requiredTimeoutText is required's JSON text with maxTimeoutSeconds written 60.0, the same number", () => {
    const text: string = AG.requiredTimeoutText;
    expect(text).toContain('"maxTimeoutSeconds":60.0,');
    expect(text.replace('"maxTimeoutSeconds":60.0,', '"maxTimeoutSeconds":60,')).toBe(JSON.stringify(AG.required));
    expect(JSON.parse(text)).toEqual(AG.required);
  });

  it("BA10's bound is the chosen option's: 60 + 180 s, 120 paid requests two seconds apart", () => {
    const r = row("BA10");
    expect(r.input.advanceMs).toBe((OPTION.maxTimeoutSeconds + 180) * 1000);
    expect(r.expect.paidRequests).toBe(r.input.advanceMs / 1000 / Number(r.input.agreement[1].retryAfter));
  });
});

describe("buyer.json BA13: a PAYMENT-REQUIRED without its pad characters is not base64 (RFC 4648 section 3.2)", () => {
  // RFC 4648 section 4: every quantum of four characters, the last ending in "==" or "=" where the data ends short.
  const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  const padded = Buffer.from(JSON.stringify(AG.required), "utf8").toString("base64");

  it("requiredUnpadded is required's base64 with its two trailing pad characters removed", () => {
    expect(padded.endsWith("==")).toBe(true);
    expect(AG.requiredUnpadded).toBe(padded.slice(0, -2));
    expect(BASE64.test(padded)).toBe(true);
    expect(AG.requiredUnpadded.length % 4).toBe(2);
    expect(BASE64.test(AG.requiredUnpadded)).toBe(false);
    expect(JSON.parse(Buffer.from(`${AG.requiredUnpadded}==`, "base64").toString("utf8"))).toEqual(AG.required);
  });

  it("BA13's 402 sends it as the header, and the gate declines agreement-failed with nothing signed or paid", () => {
    const r = row("BA13");
    expect(r.input.agreement).toEqual([{ status: 402, paymentRequiredHeader: "requiredUnpadded" }]);
    expect(r.input.approve).toBeUndefined();
    expect(r.expect).toEqual({ decline: "agreement-failed", signCalls: 0, agreementFetches: 1, paidRequests: 0 });
  });
});

describe("buyer.json BE1: the served bodies decode to A under the coding each case names", () => {
  const A = fromHex(B.fixed.A);
  const C = fromHex(B.fixed.C);
  const decode: Record<string, (b: Buffer) => Buffer> = {
    gzip: (b) => gunzipSync(b),
    "x-gzip": (b) => gunzipSync(b),
    deflate: (b) => inflateSync(b),
    br: (b) => brotliDecompressSync(b),
    "gzip, gzip": (b) => gunzipSync(gunzipSync(b)),
    "identity, gzip": (b) => gunzipSync(b),
  };
  for (const c of row("BE1").input.cases as { case: string; contentEncoding: string; bodyHex: string }[]) {
    it(`${c.case}: Content-Encoding ${c.contentEncoding}`, () => {
      const body = decode[c.contentEncoding]!(Buffer.from(c.bodyHex, "hex"));
      const expected = c.case.includes("two members") ? Buffer.concat([A, C]) : Buffer.from(A);
      expect(body.equals(expected)).toBe(true);
    });
  }
});

interface StellarCase {
  case: string;
  inputs: { simulatedXdr: string; currentLedger: number };
  expect: { decline?: string; detail?: string; signCalls: number; signRequestKind?: string };
}

describe("buyer.json BS1 and BS2: the Stellar build refuses before the signer", () => {
  it("abc, which the links serve, hashes to the advertised H", async () => {
    for (const name of ["BS1", "BS2", "BX1"]) {
      const h = await hash(fromHex(row(name).input.servesHex));
      expect(hashEquals(h, "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")).toBe(true);
    }
  });

  const payerOf = (account: string) => account.split(":")[2]!;
  const outcome = (u: unknown) =>
    isRefusal(u) ? { decline: "offer-unreadable", detail: u.code, signCalls: 0 } : { signCalls: 1, signRequestKind: (u as { request: { kind: string } }).request.kind };

  it("BS1: x402/exact/stellar", async () => {
    const r = row("BS1").input;
    expect(r.pairing).toBe("x402/exact/stellar");
    const read = exactStellar.read(r.doc);
    if (isRefusal(read)) throw new Error(read.code);
    for (const c of r.cases as StellarCase[]) {
      const accepted = read.offer.options[0]!;
      const u = await exactStellar.build({ required: read.offer.required, accepted, ...c.inputs, payer: payerOf(r.account) }, read.h);
      expect([c.case, outcome(u)]).toEqual([c.case, c.expect]);
    }
  });

  it("BS2: mpp/charge/stellar", async () => {
    const r = row("BS2").input;
    expect(r.pairing).toBe("mpp/charge/stellar");
    const read = chargeStellar.read(r.doc);
    if (isRefusal(read)) throw new Error(read.code);
    const challenge = read.offer.challenges[0] as MppChallenge & { id: string };
    for (const c of r.cases as StellarCase[]) {
      const u = await chargeStellar.build({ challenge, ...c.inputs, now: r.now, payer: payerOf(r.account) }, read.h);
      expect([c.case, outcome(u)]).toEqual([c.case, c.expect]);
    }
  });
});

describe("buyer.json BX1: each document is the mpp/session/xrpl B2 document with only request.amount replaced", () => {
  const B2 = load("mpp-session-hedera-solana-xrpl.json").buyer.rows.find(
    (r: { name: string; pairing: string }) => r.name === "B2" && r.pairing === "mpp/session/xrpl",
  ).input;
  const cases = row("BX1").input.cases as { case: string; doc: { request: string }[]; expect: { decline?: string; detail?: string; refusal?: string } }[];

  it("the row's account and inputs are B2's", () => {
    expect(row("BX1").input.account).toBe(B2.account);
    expect(row("BX1").input.inputs).toEqual(B2.inputs);
  });

  for (const c of cases) {
    it(c.case, () => {
      const [got] = c.doc;
      const [base] = B2.doc as { request: string }[];
      expect({ ...got, request: undefined }).toEqual({ ...base, request: undefined });
      expect({ ...request(got!), amount: undefined }).toEqual({ ...request(base!), amount: undefined });
      if (c.expect.detail === undefined) expect(request(got!).amount).toBe("100");
      else {
        expect(c.expect).toMatchObject({ decline: "no-payable-option", detail: "mpp/no-payable-option", refusal: "mpp/request-malformed" });
      }
    });
  }
});

describe("buyer.json BW1 and BW2: the within challenge's opaque, a map whose every value is a string", () => {
  const T = load("mpp-session-tempo.json");
  const opening = T.buyer.rows.find((r: { name: string }) => r.name === "B6").input.presented;
  const hold = row("BW1").input.hold as { opening: string; atrHex: string; network: string; channel: string };
  const control = row("BW1").control.input as { opaqueText: string; doc: MppChallenge[] };
  const docs: { name: string; opaqueText: string; doc: MppChallenge[] }[] = [
    { name: "BW1", opaqueText: row("BW1").input.opaqueText, doc: row("BW1").input.doc },
    ...(row("BW2").input.cases as { case: string; opaqueText: string; doc: MppChallenge[] }[]).map((c) => ({
      name: `BW2, ${c.case}`,
      opaqueText: c.opaqueText,
      doc: c.doc,
    })),
  ];
  // lcp's code for an opaque that is not a flat string map, the refusal mpp-challenge.json agrees for pairingsOf.
  const OPAQUE_MALFORMED = "mpp/opaque-malformed";
  // RFC 8785 for these values: object members in code-unit order, no whitespace, integers and ASCII strings as written.
  const jcs = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(jcs)
      : typeof v === "object" && v !== null
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, jcs((v as Record<string, unknown>)[k])]))
        : v;

  it("the hold is the channel mpp-session-tempo.json's B6 opens for the ATR atrHex", async () => {
    expect(hold.opening).toBe("mpp-session-tempo.json buyer row B6, input.presented");
    expect(await sessionTempo.channel.kind(opening)).toBe("open");
    expect(hashEquals((await sessionTempo.bound(opening)) as string, await hash(fromHex(hold.atrHex)))).toBe(true);
    expect(await sessionTempo.channel.ref(opening)).toEqual({ network: hold.network, channel: hold.channel });
    expect(row("BW2").input.hold).toBe("as BW1");
    expect(row("BW2").control).toBe("as BW1");
  });

  it("each challenge is the seller's own on the held channel: the issued request naming it, JCS", () => {
    const issued = JSON.parse(T.fixed.requestV2);
    const without = (c: MppChallenge) => ({ ...c, id: undefined, request: undefined, opaque: undefined });
    for (const { doc } of [...docs, control]) {
      expect(doc).toHaveLength(1);
      const c = doc[0]!;
      expect(without(c)).toEqual(without(opening.challenge));
      const text = Buffer.from(c.request, "base64url").toString("utf8");
      const methodDetails = { ...issued.methodDetails, channelId: hold.channel };
      expect(JSON.parse(text)).toEqual({ ...issued, methodDetails });
      expect(text).toBe(JSON.stringify(jcs(JSON.parse(text))));
      expect(sessionResume(c)).toEqual({ network: hold.network, channel: hold.channel });
    }
  });

  for (const d of docs) {
    it(`${d.name}: opaqueText holds a value that is not a string, lcp reads no map from the opaque, and pairingsOf refuses it`, () => {
      const opaque = d.doc[0]!.opaque!;
      expect(Buffer.from(opaque, "base64url").toString("utf8")).toBe(d.opaqueText);
      expect(d.opaqueText).toBe(JSON.stringify(jcs(JSON.parse(d.opaqueText))));
      expect(Object.values(JSON.parse(d.opaqueText)).some((v) => typeof v !== "string")).toBe(true);
      expect(decodeStringMap(opaque)).toBeUndefined();
      expect(pairingsOf(d.doc[0]!)).toEqual({ refused: true, code: OPAQUE_MALFORMED });
    });
  }

  it("the control's opaque is the opening's own: only the LCP members, naming the held H", async () => {
    const h = await hash(fromHex(hold.atrHex));
    const opaque = control.doc[0]!.opaque!;
    expect(opaque).toBe(opening.challenge.opaque);
    expect(Buffer.from(opaque, "base64url").toString("utf8")).toBe(control.opaqueText);
    const lcpMembers = { legalContext: toLcpString(h), legalContextUrl: `https://atr.seller.example/${h}` };
    expect(decodeStringMap(opaque)).toEqual(lcpMembers);
  });

  it("both rows decline before the signer, and the control signs one voucher in the held channel", () => {
    for (const name of ["BW1", "BW2"]) {
      const declined = { decline: "offer-unreadable", detail: OPAQUE_MALFORMED, signCalls: 0 };
      expect(row(name).expect, name).toEqual(declined);
    }
    const voucher = { action: "voucher", channelId: hold.channel };
    expect(row("BW1").control.expect).toMatchObject({ signCalls: 1, signedPayload: voucher });
  });
});
