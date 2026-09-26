// The agreement URL on every x402 pairing: `advertise` places it once per document in `extensions.legalContext.info`,
// after `legalContextUrl`, and `read` returns it. The mixed challenge is x402-exact-eip155-eip3009.json's MX.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, canonicalJson, type Json } from "../src/index.js";
import { exactEip3009, exactErc7710, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}.json`, import.meta.url), "utf8"));
const at = (v: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], v);
const refused = (code: string) => ({ refused: true, code });

type Advertise = (doc: unknown, h: string, link: string, offer: unknown, agreementUrl?: string) => unknown;
type Read = (doc: unknown) => unknown;
const bindingOf = (id: string) => {
  const b = BINDINGS.find((x) => x.id === id);
  if (b === undefined) throw new Error(id);
  return b as unknown as { advertise: Advertise; read: Read };
};

const MX = load("x402-exact-eip155-eip3009").MX;

describe("MX: a challenge mixing a public-proof pairing and one without", () => {
  const { doc, h, link, agreementUrl, offers } = MX.advertise as {
    doc: PaymentRequired;
    h: string;
    link: string;
    agreementUrl: string;
    offers: { pairing: string; option: PaymentRequirements }[];
  };
  const place = (order: typeof offers, url?: string, last?: string | null) =>
    order.reduce<unknown>((d, o, i) => {
      if ((d as { refused?: boolean }).refused === true) return d;
      const u = i === order.length - 1 && last !== undefined ? (last ?? undefined) : url;
      return bindingOf(o.pairing).advertise(d, h, link, o.option, u);
    }, doc);

  it("each offer's pairing advertises the agreement URL, in either order, and the document carries it once", () => {
    for (const order of [offers, [...offers].reverse()]) {
      const placed = place(order, agreementUrl);
      expect(canonicalJson(placed as Json)).toBe(canonicalJson(MX.expectDocument));
      expect(placed).toEqual(MX.expectDocument);
      const info = (placed as { extensions: { legalContext: { info: object } } }).extensions.legalContext.info;
      expect(Object.keys(info)).toEqual(Object.keys(MX.expectDocument.extensions.legalContext.info));
    }
  });

  it("either pairing's read returns the agreement URL", () => {
    for (const b of [exactEip3009, exactErc7710]) {
      const r = b.read(MX.expectDocument);
      expect(r).toMatchObject(MX.expectRead);
      expect((r as { agreement?: string }).agreement).toBe(MX.expectRead.agreement);
    }
  });

  it("another agreement URL, or none, from the second pairing is a conflict", () => {
    for (const c of MX.conflicts as { case: string; agreementUrl: string | null; expect: string }[]) {
      expect([c.case, place(offers, agreementUrl, c.agreementUrl)]).toEqual([c.case, refused(c.expect)]);
    }
  });
});

// Each x402 pairing's fixed option from its vectors, the hash its option was built for, and the link.
const ROWS: readonly [id: string, file: string, option: string, h: string][] = [
  ["x402/exact/eip155/eip3009", "x402-exact-eip155-eip3009", "fixed.O", "fixed.H"],
  ["x402/exact/eip155/permit2", "x402-exact-eip155-permit2", "fixed.option", "fixed.H"],
  ["x402/exact/eip155/erc7710", "x402-exact-eip155-erc7710", "fixed.option", "fixed.H"],
  ["x402/exact/eip155/erc7710-salt", "x402-exact-eip155-erc7710-salt", "fixed.option", "fixed.H"],
  ["x402/upto/eip155/permit2", "x402-upto-eip155-permit2", "fixed.option", "fixed.H"],
  ["x402/auth-capture/eip155/eip3009", "x402-auth-capture-eip155-eip3009", "fixed.option", "fixed.H"],
  ["x402/auth-capture/eip155/permit2", "x402-auth-capture-eip155-permit2", "fixed.option", "fixed.H"],
  ["x402/batch-settlement/eip155", "x402-batch-settlement", "fixed.evm.option", "fixed.H"],
  ["x402/batch-settlement/solana", "x402-batch-settlement", "fixed.svm.option", "fixed.H"],
  ["x402/batch-settlement/cloudflare", "x402-batch-settlement", "EC1.payload.accepted", "fixed.H"],
  ["x402/exact/algorand", "x402-exact-algorand", "fixed.O", "fixed.H"],
  ["x402/exact/aptos", "x402-exact-aptos", "fixed.O", "fixed.H"],
  ["x402/exact/cardano", "x402-exact-cardano", "fixed.O", "fixed.H"],
  ["x402/exact/casper", "x402-exact-casper", "fixed.O", "fixed.H"],
  ["x402/exact/ccd", "x402-exact-ccd", "fixed.O", "fixed.H"],
  ["x402/exact/hedera", "x402-exact-hedera", "fixed.O", "fixed.H"],
  ["x402/exact/hedera/transfer-executor", "x402-exact-hedera-transfer-executor", "fixed.O", "fixed.H"],
  ["x402/exact/lnbtc", "x402-exact-lnbtc", "fixed.O", "fixed.H"],
  ["x402/exact/lnbtc/invoice-named", "x402-exact-lnbtc-invoice-named", "fixed.O_N", "fixed.H"],
  ["x402/exact/near", "x402-exact-near", "fixed.O", "fixed.H"],
  ["x402/exact/polkadot/lcp-assets-remark", "x402-exact-polkadot-lcp-assets-remark", "fixed.O", "fixed.H"],
  ["x402/exact/solana", "x402-exact-solana", "fixed.option", "fixed.H"],
  ["x402/upto/solana", "x402-upto-solana", "fixed.option", "fixed.H"],
  ["x402/exact/starknet", "x402-exact-starknet", "fixed.O", "fixed.H"],
  ["x402/exact/stellar", "x402-exact-stellar", "fixed.option", "fixed.H"],
  ["x402/exact/sui", "x402-exact-sui", "fixed.O", "fixed.H"],
  ["x402/exact/tron/lcp-trc20-memo", "x402-exact-tron-lcp-trc20-memo", "fixed.O", "fixed.H"],
  ["x402/exact/tvm", "x402-exact-tvm", "fixed.O", "fixed.H"],
  ["x402/exact/xrpl", "x402-exact-xrpl", "fixed.option", "fixed.H"],
];

describe("every x402 pairing takes the agreement URL", () => {
  it("the rows cover every x402 pairing in BINDINGS", () => {
    const x402 = BINDINGS.map((b) => b.id).filter((id) => id.startsWith("x402/"));
    expect([...x402].sort()).toEqual(ROWS.map(([id]) => id).sort());
  });

  for (const [id, file, optionPath, hPath] of ROWS) {
    it(`${id}: the URL is placed once, after the link, and read back`, () => {
      const v = load(file);
      const option = at(v, optionPath);
      const h = at(v, hPath) as string;
      const link = `https://atr.seller.example/${h}`;
      const A = `https://pay.seller.example/agreement/${h}`;
      const doc = { x402Version: 2, resource: { url: "https://api.seller.example/r" }, accepts: [option] };
      const b = bindingOf(id);
      const without = b.advertise(doc, h, link, option) as PaymentRequired;
      expect(without).not.toHaveProperty("refused");
      const info = without.extensions!["legalContext"]!.info as Record<string, Json>;
      const expected = {
        ...without,
        extensions: { ...without.extensions, legalContext: { ...without.extensions!["legalContext"], info: { ...info, legalContextAgreementUrl: A } } },
      };
      const withA = b.advertise(doc, h, link, option, A) as PaymentRequired;
      expect(canonicalJson(withA as unknown as Json)).toBe(canonicalJson(expected as unknown as Json));
      expect(Object.keys(withA.extensions!["legalContext"]!.info as object)).toEqual([
        "type",
        "value",
        "legalContextUrl",
        "legalContextAgreementUrl",
      ]);
      expect(b.advertise({ ...withA, accepts: doc.accepts }, h, link, option, A)).toEqual(withA);
      expect(b.advertise(doc, h, link, option, `http://pay.seller.example/agreement/${h}`)).toEqual(refused("x402/link-not-https"));
      const r = b.read(withA) as { agreement?: string; refused?: boolean };
      expect(r.refused).toBeUndefined();
      expect(r.agreement).toBe(A);
      expect(b.read(without)).not.toHaveProperty("agreement");
    });
  }
});

// vectors/buyer.json BA5 declines an http agreement URL "link-not-https", before any fetch of it and any signature. The
// document is MX's with BA5's URL in the agreement URL's place; everything else is as the vector file has it.
describe("BA5: a well-formed legal context whose agreement URL is http", () => {
  const BA5 = load("buyer").rows.find((r: { name: string }) => r.name === "BA5");
  const withHttpAgreement = (): PaymentRequired => {
    const doc = structuredClone(MX.expectDocument) as PaymentRequired;
    (doc.extensions!["legalContext"]!.info as Record<string, unknown>)["legalContextAgreementUrl"] = BA5.input.agreementUrl;
    return doc;
  };

  it("BA5's expectation is link-not-https", () => {
    expect(BA5.expect.decline).toBe("link-not-https");
  });
  for (const b of [exactErc7710, exactEip3009]) {
    it(`${b.id}: read refuses it as x402/link-not-https`, () => {
      expect(b.read(withHttpAgreement())).toEqual(refused("x402/link-not-https"));
    });
  }
});
