// The agreement URL, and the link beside it, on every pairing whose record has no public proof. The documents without
// the URL are the vector files' expected values or are written out here by hand from the profiles' placement rules; the
// documents with the URL are the same with the one member added beside the link, written out by hand.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paymentRequest } from "../src/ack.js";
import { delegated, undelegated } from "../src/acp.js";
import { checkoutMandate } from "../src/ap2.js";
import { exactAptos } from "../src/aptos.js";
import { sellerReference, viAutonomous, viImmediate, visaTap } from "../src/card.js";
import { exactHederaExecutor } from "../src/hedera.js";
import { BINDINGS, canonicalJson, type AtrHash, type Json } from "../src/index.js";
import { chargeLightning, exactLnbtc, exactLnbtcNamed, sessionLightning } from "../src/lightning.js";
import {
  chargeCard,
  chargeNearIntents,
  chargeStripe,
  evmHash,
  evmTransaction,
  pairingsOf,
  subscriptionStripe,
  type MppChallenge,
} from "../src/mpp.js";
import { ap2Mandate, bookingAp2Mandate, bookingUnsigned, unsigned } from "../src/ucp.js";
import { exactErc7710 } from "../src/x402.js";
import { batchCloudflare } from "../src/x402-batch-settlement.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const refused = (code: string) => ({ refused: true, code });

/** The JSON Schema of the x402 `legalContext` extension's `info`, as `advertise` places it beside `info`. */
const SCHEMA = JSON.parse(
  '{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"type":{"const":"sha256"},' +
    '"value":{"type":"string","pattern":"^0x[0-9a-f]{64}$"},"legalContextUrl":{"type":"string","pattern":"^https://"}},' +
    '"required":["type","value","legalContextUrl"]}',
);

const agreementFor = (h: string) => `https://pay.seller.example/agreement/${h}`;
const HTTP = "http://pay.seller.example/agreement/0x00";
const TOO_LONG = `https://pay.seller.example/${"a".repeat(2049 - "https://pay.seller.example/".length)}`;
const TOO_LONG_HTTP = `http://pay.seller.example/${"a".repeat(2049 - "http://pay.seller.example/".length)}`;
/** Bad values that are not a URL with another scheme: empty, unparseable, no host, userinfo, overlong. */
const MALFORMED = ["", "not a url", "https://", "https://exa mple.com/", "https://u@pay.seller.example/", TOO_LONG, TOO_LONG_HTTP];
/** The same bad values in the link's place. */
const LINK_MALFORMED = MALFORMED;

type Doc = unknown;
interface Case {
  id: string;
  binding: { advertise: (...a: never[]) => unknown; read: (doc: never) => unknown };
  args: [Doc, AtrHash, string, Doc];
  /** The advertised document without an agreement URL. */
  before: Json;
  /** The advertised document with agreement URL `a`. */
  after: (a: string) => Json;
  /** What `read` takes, from an advertised document. */
  readable: (advertised: Json) => unknown;
  prefix: string;
}

const call = (c: Case, ...extra: unknown[]) =>
  (c.binding.advertise as (...a: unknown[]) => unknown)(...c.args, ...extra) as Json;
const readOf = (c: Case, doc: unknown) =>
  (c.binding.read as (d: unknown) => { h: string; link: string; agreement?: string } | { refused: true; code: string })(doc);

// ── x402: `extensions.legalContext.info` gains `legalContextAgreementUrl` after `legalContextUrl`.

function x402Case(id: string, binding: Case["binding"], h: AtrHash, link: string, resource: Json, option: Json): Case {
  const doc = { x402Version: 2, resource, accepts: [option] };
  const withInfo = (info: Json) => ({ ...doc, extensions: { legalContext: { info, schema: SCHEMA } } });
  return {
    id,
    binding,
    args: [doc, h, link, option],
    before: withInfo({ type: "sha256", value: h, legalContextUrl: link }),
    after: (a) => withInfo({ type: "sha256", value: h, legalContextUrl: link, legalContextAgreementUrl: a }),
    readable: (d) => d,
    prefix: "x402",
  };
}

const ERC7710 = load("x402-exact-eip155-erc7710.json");
const AP = load("x402-exact-aptos.json");
const HX = load("x402-exact-hedera-transfer-executor.json");
const BS = load("x402-batch-settlement.json");
const LN = load("x402-exact-lnbtc.json");
const LNN = load("x402-exact-lnbtc-invoice-named.json");

const X402_CASES: Case[] = [
  x402Case("x402/exact/eip155/erc7710", exactErc7710, ERC7710.fixed.H, ERC7710.fixed.link, ERC7710.fixed.resource, ERC7710.fixed.option),
  x402Case("x402/exact/aptos", exactAptos, AP.fixed.H, AP.fixed.link, AP.fixed.resource, AP.fixed.O),
  x402Case("x402/exact/hedera/transfer-executor", exactHederaExecutor, HX.fixed.H, HX.fixed.link, HX.fixed.resource, HX.fixed.O),
  x402Case("x402/batch-settlement/cloudflare", batchCloudflare, BS.fixed.H, BS.fixed.link, BS.fixed.resource, BS.EC1.payload.accepted),
  x402Case("x402/exact/lnbtc", exactLnbtc, LN.fixed.H, LN.fixed.link, LN.fixed.resource, LN.fixed.O),
  x402Case(
    "x402/exact/lnbtc/invoice-named",
    exactLnbtcNamed,
    LNN.fixed.H,
    `https://atr.seller.example/${LNN.fixed.H}`,
    LNN.fixed.resource,
    LNN.fixed.O_N,
  ),
];

// ── MPP: `opaque` is base64url of RFC 8785 JSON with `legalContextAgreementUrl` beside `legalContextUrl`; the id is H
// in base64url with the challenge's position.

const MC = load("mpp-challenge.json");
const TX = load("mpp-charge-evm-transaction.json");
const NI = load("mpp-charge-nearintents.json");
const LC = load("mpp-charge-lightning.json");
const LS = load("mpp-session-lightning.json");
const CC = load("mpp-charge-card.json");
const CS = load("mpp-charge-stripe.json");

const idOf = (h: string, i: number) => `${Buffer.from(h.slice(2), "hex").toString("base64url")}.${i}`;
const opaqueOf = (h: string, link: string, a?: string) =>
  b64u(
    a === undefined
      ? `{"legalContext":"lcp:sha256:${h}","legalContextUrl":"${link}"}`
      : `{"legalContext":"lcp:sha256:${h}","legalContextAgreementUrl":"${a}","legalContextUrl":"${link}"}`,
  );
const encode = (request: Json) => b64u(canonicalJson(request) as string);
/** An advertised document with its link replaced by `bad`: the link's text in JSON, or the MPP `opaque` re-encoded with it. */
const withLink = (c: Case, doc: Json, bad: string): Json =>
  c.prefix === "mpp"
    ? (doc as unknown as MppChallenge[]).map((m) => ({ ...m, opaque: opaqueOf(c.args[1], bad) }))
    : JSON.parse(JSON.stringify(doc).replaceAll(JSON.stringify(c.args[2]).slice(1, -1), bad));

function mppCase(id: string, binding: Case["binding"], h: AtrHash, link: string, challenge: MppChallenge, placed: Json): Case {
  return {
    id,
    binding,
    args: [[challenge], h, link, challenge],
    before: [placed],
    after: (a) => [{ ...(placed as object), opaque: opaqueOf(h, link, a) }],
    readable: (d) => d,
    prefix: "mpp",
  };
}

const evmChallenge: MppChallenge = {
  realm: MC.fixed.realm,
  method: "evm",
  intent: "charge",
  request: b64u(TX.fixed.R_ENoTypes),
  expires: MC.fixed.expires,
};
const lnCharge = { ...LC.L3.challenge, request: encode(LC.L3.request) } as MppChallenge;
const lnSession = { ...LS.S1.challenge, request: encode(LS.S1.request) } as MppChallenge;
const byHand = (c: MppChallenge, h: string, link: string) => ({ ...c, id: idOf(h, 0), opaque: opaqueOf(h, link) });
const issuedMpp = (method: string, intent: string, request: Json): MppChallenge =>
  ({ realm: MC.fixed.realm, method, intent, request: encode(request), expires: MC.fixed.expires }) as MppChallenge;
const cardChallenge = issuedMpp("card", "charge", CC.M1.request);
const stripeDetails = (r: { methodDetails: object }) => ({ ...r, methodDetails: { ...r.methodDetails, metadata: { legal_context: `lcp:sha256:${MC.fixed.H}` } } });
const stripeChallenge = issuedMpp("stripe", "charge", CS.M2.request);
const subscriptionChallenge = issuedMpp("stripe", "subscription", CS.M2.request);
/** MPP's placement: the carrier set to H's LCP string, the request re-encoded, then the id and opaque. */
const carried = (c: MppChallenge, request: Json) => byHand({ ...c, request: encode(request) }, MC.fixed.H, MC.fixed.link);

const MPP_CASES: Case[] = [
  mppCase("mpp/charge/evm/transaction", evmTransaction, MC.fixed.H, MC.fixed.link, evmChallenge, byHand(evmChallenge, MC.fixed.H, MC.fixed.link)),
  mppCase("mpp/charge/evm/hash", evmHash, MC.fixed.H, MC.fixed.link, evmChallenge, byHand(evmChallenge, MC.fixed.H, MC.fixed.link)),
  mppCase("mpp/charge/lightning", chargeLightning, LC.fixed.H, LC.fixed.link, lnCharge, byHand(lnCharge, LC.fixed.H, LC.fixed.link)),
  mppCase("mpp/session/lightning", sessionLightning, LS.fixed.H, LS.fixed.link, lnSession, byHand(lnSession, LS.fixed.H, LS.fixed.link)),
  mppCase("mpp/charge/nearintents", chargeNearIntents, NI.fixed.H, NI.fixed.link, NI.challenge, NI.place.expect),
  mppCase("mpp/charge/card", chargeCard, MC.fixed.H, MC.fixed.link, cardChallenge, carried(cardChallenge, { ...CC.M1.request, externalId: `lcp:sha256:${MC.fixed.H}` })),
  mppCase("mpp/charge/stripe", chargeStripe, MC.fixed.H, MC.fixed.link, stripeChallenge, carried(stripeChallenge, stripeDetails(CS.M2.request))),
  mppCase("mpp/subscription/stripe", subscriptionStripe, MC.fixed.H, MC.fixed.link, subscriptionChallenge, carried(subscriptionChallenge, stripeDetails(CS.M2.request))),
];

// ── The other surfaces.

const ACK = load("ack-payment-request.json");
const ACP = load("acp-checkout.json");
const AP2 = load("ap2-checkout-mandate.json");
const CARD = load("card.json");
const UCP = load("ucp.json");

const ack: Case = {
  id: "ack/payment-request",
  binding: paymentRequest,
  args: [ACK.K1.advertise.doc, ACK.K1.advertise.h, ACK.K1.advertise.link, ACK.K1.advertise.offer],
  before: ACK.K1.expect,
  after: (a) => ({ ...ACK.K1.expect, legalContext: { ...ACK.K1.expect.legalContext, legalContextAgreementUrl: a } }),
  readable: (d) => ({ ...ACK.K2.body, legalContext: (d as { legalContext: Json }).legalContext }),
  prefix: "ack",
};

const acpCase = (id: string, binding: Case["binding"]): Case => {
  const s = ACP.V2.expectSession;
  return {
    id,
    binding,
    args: [ACP.V2.advertise.doc, ACP.V2.advertise.h, ACP.V2.advertise.link, ACP.V2.advertise.offer],
    before: s,
    after: (a) => ({ ...s, metadata: { ...s.metadata, legal_context: { ...s.metadata.legal_context, legal_context_agreement_url: a } } }),
    readable: (d) => d,
    prefix: "acp",
  };
};

const ap2Jwt = (payload: Json) => `${b64u(AP2.fixed.jwtHeader)}.${b64u(JSON.stringify(payload))}.${AP2.fixed.signature}`;
const ap2: Case = {
  id: "ap2/checkout-mandate",
  binding: checkoutMandate,
  args: [AP2.V2.advertise.payload, AP2.V2.advertise.h, AP2.V2.advertise.link, AP2.V2.advertise.offer],
  before: AP2.V2.expectPayload,
  after: (a) => ({ ...AP2.V2.expectPayload, legalContext: { ...AP2.V2.expectPayload.legalContext, legalContextAgreementUrl: a } }),
  readable: ap2Jwt,
  prefix: "ap2",
};

const cardJwt = (values: Json) =>
  `${b64u(JSON.stringify({ alg: "ES256", typ: "JWT" }))}.${b64u(JSON.stringify({ legalContext: (values as { legalContext: Json }).legalContext }))}.${Buffer.alloc(64).toString("base64url")}`;
const cardCase = (id: string, binding: Case["binding"], scheme: string, readable: Case["readable"]): Case => {
  const e = CARD.C1.advertise.expect;
  return {
    id,
    binding,
    args: [{}, CARD.fixed.H, CARD.fixed.link, { ...CARD.C1.advertise.offer, scheme }],
    before: e,
    after: (a) => ({ ...e, legalContext: { ...e.legalContext, legalContextAgreementUrl: a } }),
    readable,
    prefix: "card",
  };
};

const signed = (d: Json) => ({ ...(d as object), ap2: { merchant_authorization: UCP.fixed.merchantAuthorization } });
const ucpCase = (id: string, binding: Case["binding"], v: { advertise: { h: AtrHash; link: string; offer: Json } }, doc: Json, before: Json, readable: Case["readable"]): Case => ({
  id,
  binding,
  args: [doc, v.advertise.h, v.advertise.link, v.advertise.offer],
  before,
  after: (a) => ({ ...(before as object), links: [...(before as { links: Json[] }).links, { type: "legal_context_agreement", url: a }] }),
  readable,
  prefix: "ucp",
});

const OTHER_CASES: Case[] = [
  ack,
  acpCase("acp/checkout/delegated", delegated),
  acpCase("acp/checkout/undelegated", undelegated),
  ap2,
  cardCase("card/visa-tap", visaTap, "visa-tap", (d) => d),
  cardCase("card/mastercard-vi/immediate", viImmediate, "mastercard-vi", cardJwt),
  cardCase("card/mastercard-vi/autonomous", viAutonomous, "mastercard-vi", cardJwt),
  cardCase("card/seller-reference", sellerReference, "seller-reference", (d) => d),
  ucpCase("ucp/checkout/ap2-mandate", ap2Mandate, UCP.V2, UCP.V2.advertise.doc, UCP.V2.expectCheckout, signed),
  ucpCase("ucp/checkout/unsigned", unsigned, UCP.V2, UCP.V2.advertise.doc, UCP.V2.expectCheckout, (d) => d),
  ucpCase("ucp/booking/ap2-mandate", bookingAp2Mandate, UCP.V2b, UCP.V2b.B0, UCP.V2b.expectBooking, signed),
  ucpCase("ucp/booking/unsigned", bookingUnsigned, UCP.V2b, UCP.V2b.B0, UCP.V2b.expectBooking, (d) => d),
];

const CASES: Case[] = [...X402_CASES, ...MPP_CASES, ...OTHER_CASES];

describe("the agreement URL", () => {
  it("covers every registered pairing whose record has no public proof", () => {
    const registered = BINDINGS.filter((b) => b.pattern.publicProof === false).map((b) => b.id);
    expect([...registered].sort()).toEqual(CASES.map((c) => c.id).sort());
    for (const c of CASES) expect(BINDINGS.find((b) => b.id === c.id)).toBe(c.binding);
  });

  it("the MPP EVM challenge pays through the two call pairings, and the hand-built ids match the vectors", () => {
    expect(pairingsOf(evmChallenge)).toEqual(TX.MV11.expectPairings);
    expect(idOf(LC.fixed.H, 0)).toBe(LC.L3.expectId);
    expect((NI.place.expect as { opaque: string }).opaque).toBe(opaqueOf(NI.fixed.H, NI.fixed.link));
  });

  for (const c of CASES) {
    describe(c.id, () => {
      const h = c.args[1];
      const link = c.args[2];
      const A = agreementFor(h);

      it("without an agreement URL, advertise writes what it wrote before, and read returns no agreement", () => {
        const doc = call(c);
        expect(canonicalJson(doc)).toBe(canonicalJson(c.before));
        expect(doc).toEqual(c.before);
        const r = readOf(c, c.readable(doc));
        expect(r).toMatchObject({ h, link });
        expect(r).not.toHaveProperty("agreement");
      });

      it("with an https agreement URL, advertise places it beside the link and read returns it byte for byte", () => {
        const doc = call(c, A);
        expect(canonicalJson(doc)).toBe(canonicalJson(c.after(A)));
        const r = readOf(c, c.readable(doc));
        expect(r).toMatchObject({ h, link });
        expect((r as { agreement?: string }).agreement).toBe(A);
      });

      // Only a URL of at most 2048 characters that parses with a scheme other than https is the pairing's link
      // refusal; every other value is `legal-context-malformed`, at advertise and at read alike. vectors/buyer.json
      // BA5 declines an http agreement URL "link-not-https".
      it("advertise: an agreement URL whose scheme is not https is link-not-https; any other bad value is malformed", () => {
        expect(call(c, HTTP)).toEqual(refused(`${c.prefix}/link-not-https`));
        for (const bad of MALFORMED) {
          expect([bad.slice(0, 40), call(c, bad)]).toEqual([bad.slice(0, 40), refused(`${c.prefix}/legal-context-malformed`)]);
        }
      });

      // The link takes the same split as the agreement URL, at advertise and at read alike.
      it("advertise: a link whose scheme is not https is link-not-https; any other bad value is malformed", () => {
        const advertise = c.binding.advertise as (...a: unknown[]) => unknown;
        expect(advertise(c.args[0], h, HTTP, c.args[3])).toEqual(refused(`${c.prefix}/link-not-https`));
        for (const bad of LINK_MALFORMED) {
          const got = advertise(c.args[0], h, bad, c.args[3]);
          expect([bad.slice(0, 40), got]).toEqual([bad.slice(0, 40), refused(`${c.prefix}/legal-context-malformed`)]);
        }
      });

      it("read: a link whose scheme is not https is link-not-https; any other bad value is malformed", () => {
        expect(readOf(c, c.readable(withLink(c, c.before, HTTP)))).toEqual(refused(`${c.prefix}/link-not-https`));
        for (const bad of LINK_MALFORMED) {
          const got = readOf(c, c.readable(withLink(c, c.before, bad)));
          expect([bad.slice(0, 40), got]).toEqual([bad.slice(0, 40), refused(`${c.prefix}/legal-context-malformed`)]);
        }
      });

      it("read: an agreement URL whose scheme is not https is link-not-https; any other bad value is malformed", () => {
        expect(readOf(c, c.readable(c.after(HTTP)))).toEqual(refused(`${c.prefix}/link-not-https`));
        for (const bad of MALFORMED) {
          const got = readOf(c, c.readable(c.after(bad)));
          expect([bad.slice(0, 40), got]).toEqual([bad.slice(0, 40), refused(`${c.prefix}/legal-context-malformed`)]);
        }
      });
    });
  }
});

describe("the agreement URL on an x402 document that already carries a legal context", () => {
  const c = X402_CASES[0]!;
  const [, h, link, option] = c.args;
  const A = agreementFor(h);

  it("advertising the same agreement URL again returns an equal document", () => {
    const once = call(c, A);
    const again = (c.binding.advertise as (...a: unknown[]) => unknown)(once, h, link, option, A);
    expect(again).toEqual(c.after(A));
  });

  it("another agreement URL, or none where one is present, or one where none is present, is a conflict", () => {
    const withA = call(c, A);
    const advertise = c.binding.advertise as (...a: unknown[]) => unknown;
    expect(advertise(withA, h, link, option, `${A}?other`)).toEqual(refused("x402/legal-context-conflict"));
    expect(advertise(withA, h, link, option)).toEqual(refused("x402/legal-context-conflict"));
    expect(advertise(call(c), h, link, option, A)).toEqual(refused("x402/legal-context-conflict"));
  });
});
