// The lcp half of buyer.json's rows for the agreement option, content codings, Stellar builds and mpp/session/xrpl
// amounts: each fixture is what its row says it is, and each build the rows name refuses with the row's code before
// anything reaches a signer. The gates run the whole rows. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { hash, hashEquals, pairingOf, type AtrHash } from "../src/index.js";
import { chargeStellar, type MppChallenge } from "../src/mpp.js";
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
  const cases = row("BX1").input.cases as { case: string; doc: { request: string }[]; expect: { detail?: string } }[];

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
      else expect(c.expect.detail).toBe("mpp/request-malformed");
    });
  }
});
