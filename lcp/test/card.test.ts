// Every expected value comes from vectors/card.json: FIPS 180-2's SHA-256("abc"), RFC 9421's test-key-ed25519 and its
// worked TAP request, RFC 9901's published disclosures, and a Verifiable Intent recipe with its printed digests and
// ES256 signatures.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { digestJson, type AtrHash } from "../src/index.js";
import {
  TAP_FIELD,
  disclosureDigest,
  sellerReference,
  tie,
  viAutonomous,
  viImmediate,
  visaTap,
  type CardOption,
  type TapPresented,
} from "../src/card.js";

const V = JSON.parse(readFileSync(new URL("../vectors/card.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const E: AtrHash = V.fixed.E;
const L: string = V.fixed.link;
const VI = V.vi;
const PAIRINGS = [visaTap, viImmediate, viAutonomous, sellerReference] as const;
const refused = (code: string) => ({ refused: true, code });
const tap = (over: Partial<TapPresented>): TapPresented => ({
  signatureInput: V.C2.request.signatureInput,
  signature: V.C2.request.signature,
  lcpHash: V.C2.request.lcpHash,
  ...over,
});
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/**
 * `s`, base64url without padding, with its last character's lowest pad bit set: the same bytes, in a form that is not
 * canonical (RFC 4648 §3.5). Its length is 2 or 3 mod 4, so that the last character has pad bits.
 */
const padBit = (s: string) => {
  if (s.length % 4 < 2) throw new Error(`no pad bits in ${s.length} characters`);
  return s.slice(0, -1) + ALPHABET[ALPHABET.indexOf(s.at(-1)!) | 1];
};
const enc = (v: unknown) => b64u(new TextEncoder().encode(JSON.stringify(v)));
/** A compact JWS with the given header and payload and a 64-byte zero signature, for shape tests only. */
const jws = (header: unknown, payload: unknown) => `${enc(header)}.${enc(payload)}.${b64u(new Uint8Array(64))}`;
const disc = (salt: string, value: unknown) => enc([salt, value]);

async function verifyEs256(token: string, jwk: { x: string; y: string }): Promise<boolean> {
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const [h, p, s] = token.split(".") as [string, string, string];
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64u(s), new TextEncoder().encode(`${h}.${p}`));
}

/**
 * ES256 under one of the recipe's keys, key(name) = SHA-256(name) mod n on P-256, derived here: "lcp-test/agent" is
 * AGENT's private key and "lcp-test/user" USER's.
 */
async function recipeSign(name: string, jwk: { x: string; y: string }, signingInput: string): Promise<string> {
  const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  const seed = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)));
  const d = BigInt(`0x${Buffer.from(seed).toString("hex")}`) % n;
  const dBytes = Uint8Array.from(Buffer.from(d.toString(16).padStart(64, "0"), "hex"));
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: b64u(dBytes) },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64u(new Uint8Array(sig))}`;
}

/** ES256 under the recipe's agent key. */
const agentSign = (signingInput: string) => recipeSign("lcp-test/agent", V.fixed.AGENT, signingInput);

describe("C1 values and digests", () => {
  it("advertise returns the legal context and the 77-character reference, equal on every pairing and scheme", () => {
    const { offer, expect: want, referenceLength } = V.C1.advertise;
    for (const p of PAIRINGS) {
      expect(p.advertise({}, H, L, offer)).toEqual(want);
      for (const scheme of V.C1.otherSchemes) expect(p.advertise({}, H, L, { ...offer, scheme })).toEqual(want);
    }
    expect(want.reference.length).toBe(referenceLength);
  });

  it("an http link is card/link-not-https", () => {
    expect(visaTap.advertise({}, H, V.C1.httpLink.link, V.C1.advertise.offer)).toEqual(refused(V.C1.httpLink.expect));
  });

  it("digestJson of each option is the printed SHA-256", async () => {
    for (const row of V.C1.digestJson) expect(await digestJson(row.option)).toBe(row.expect);
  });

  it("a malformed option is card/option-malformed", () => {
    for (const offer of [
      { scheme: "amex", checkout: "chk_1001" },
      { scheme: "visa-tap", checkout: "" },
      { scheme: "visa-tap", checkout: "x".repeat(129) },
      { scheme: "visa-tap", checkout: "chk 1001" },
      null,
    ]) {
      expect(visaTap.advertise({}, H, L, offer as CardOption)).toEqual(refused("card/option-malformed"));
    }
    expect(visaTap.advertise({}, H, L, { scheme: "visa-tap", checkout: "x".repeat(128) })).not.toHaveProperty("refused");
  });

  it("tie holds every option exactly as issued; unplaced is the identity", () => {
    const options: CardOption[] = [
      { scheme: "visa-tap", checkout: "chk_1001" },
      { scheme: "seller-reference", checkout: "chk_1001" },
    ];
    const slot = tie(options);
    expect(slot).toEqual(["card", { options }]);
    expect(slot[1].options).toBe(options);
    for (const p of PAIRINGS) expect(p.unplaced(options[0]!)).toBe(options[0]);
  });
});

describe("C2 TAP", () => {
  it("bound returns H when the agent-payer-auth signature lists lcp-hash", async () => {
    expect(await visaTap.bound(tap({}))).toBe(V.C2.expectBound);
  });

  it("an upper-case field is returned lowercase", async () => {
    expect(await visaTap.bound(tap({ lcpHash: V.C2.upperCaseField.lcpHash }))).toBe(V.C2.upperCaseField.expectBound);
    expect(await visaTap.bound(tap({ lcpHash: [` \t${H}\t `] }))).toBe(H);
  });

  it("two lcp-hash lines are card/tap-field-repeated; none is card/tap-field-missing", async () => {
    expect(await visaTap.bound(tap({ lcpHash: V.C2.repeatedField.lcpHash }))).toEqual(refused(V.C2.repeatedField.expect));
    expect(await visaTap.bound(tap({ lcpHash: [] }))).toEqual(refused("card/tap-field-missing"));
    expect(await visaTap.bound(tap({ lcpHash: ["0x1234"] }))).toEqual(refused("card/tap-field-malformed"));
  });

  it("build returns the field, its value and the component", async () => {
    expect(await visaTap.build(V.C2.build.doc, H)).toEqual(V.C2.build.expect);
    expect(TAP_FIELD).toBe("lcp-hash");
  });

  it("the worked example: sig2's base has the printed SHA-256 and verifies under RFC 9421's test-key-ed25519", async () => {
    const base = new TextEncoder().encode(V.C2.sig2Base);
    expect(Buffer.from(await crypto.subtle.digest("SHA-256", base)).toString("hex")).toBe(V.C2.expectSig2BaseSha256);
    const key = await crypto.subtle.importKey("spki", Buffer.from(V.C2.testKeyEd25519Spki, "base64"), { name: "Ed25519" }, false, ["verify"]);
    const sig2 = /sig2=:([^:]+):/.exec(V.C2.request.signature)![1]!;
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, Buffer.from(sig2, "base64"), base)).toBe(true);
  });

  it("read returns the shown legal context", () => {
    expect(visaTap.read(V.C2.build.doc)).toEqual({ h: H, link: L });
    expect(visaTap.read({})).toEqual(refused("card/no-legal-context"));
    expect(visaTap.read({ legalContext: { type: "sha256", value: "0x12" } })).toEqual(refused("card/legal-context-malformed"));
    const http = { legalContext: { type: "sha256", value: H, legalContextUrl: V.C1.httpLink.link } };
    expect(visaTap.read(http)).toEqual(refused("card/legal-context-malformed"));
  });
});

describe("C3 TAP plant: the lcp-hash listing must be the agent-payer-auth signature's", () => {
  it("sig1 lists lcp-hash and sig2 does not: card/tap-hash-not-covered, never H", async () => {
    const r = await visaTap.bound({ signatureInput: V.C3.signatureInput, signature: V.C3.signature, lcpHash: V.C3.lcpHash });
    expect(r).toEqual(refused(V.C3.expect));
    expect(r).not.toBe(H);
  });
});

describe("C9 TAP: every agent-payer-auth signature must list lcp-hash", () => {
  it.each(V.C9.rows as { case: string; signatureInput: string; signature: string; lcpHash: string[]; expect: unknown }[])(
    "$case",
    async (row) => {
      expect(await visaTap.bound({ signatureInput: row.signatureInput, signature: row.signature, lcpHash: row.lcpHash })).toEqual(
        row.expect,
      );
    },
  );
});

describe("TAP bound, the remaining refusals", () => {
  const input = V.C2.request.signatureInput as string;
  it("no agent-payer-auth member is card/tap-no-payer-signature, including a Token tag", async () => {
    expect(await visaTap.bound(tap({ signatureInput: input.replace('tag="agent-payer-auth"', 'tag="agent-browser-auth"') }))).toEqual(
      refused("card/tap-no-payer-signature"),
    );
    expect(await visaTap.bound(tap({ signatureInput: input.replace('tag="agent-payer-auth"', "tag=agent-payer-auth") }))).toEqual(
      refused("card/tap-no-payer-signature"),
    );
  });

  it("a parameter on the lcp-hash component is not coverage", async () => {
    expect(await visaTap.bound(tap({ signatureInput: input.replace('"lcp-hash")', '"lcp-hash";sf)') }))).toEqual(
      refused("card/tap-hash-not-covered"),
    );
  });

  it("a covering member with no Signature member is card/tap-signature-missing", async () => {
    const signature = (V.C2.request.signature as string).split(", ")[0]!;
    expect(await visaTap.bound(tap({ signature }))).toEqual(refused("card/tap-signature-missing"));
  });

  it("malformed dictionaries are refused by field", async () => {
    for (const signatureInput of [
      "sig2=(",
      'sig2=("lcp-hash"),',
      "Sig2=()",
      'sig2=("lcp-hash");tag="agent-payer-auth";x=1.5',
      'sig2=("lcp-hash");tag="agent-payer-auth";x=:AAAA:',
      'sig2=(lcp-hash);tag="agent-payer-auth"',
      'sig2="lcp-hash";tag="agent-payer-auth"',
    ]) {
      expect(await visaTap.bound(tap({ signatureInput }))).toEqual(refused("card/tap-signature-input-malformed"));
    }
    for (const signature of ["sig2=(:AAAA:)", 'sig2="abc"', "sig2=:AA$A:", "sig2=:AAAA"]) {
      expect(await visaTap.bound(tap({ signature }))).toEqual(refused("card/tap-signature-malformed"));
    }
  });

  it("bounds: 8 KiB fields, 16 members, 32 components, 256-byte lines", async () => {
    expect(await visaTap.bound(tap({ signatureInput: input + " ".repeat(8193 - input.length) }))).toEqual(refused("card/too-large"));
    const members = Array.from({ length: 17 }, (_, i) => `s${i}=()`).join(", ");
    expect(await visaTap.bound(tap({ signatureInput: members }))).toEqual(refused("card/too-large"));
    const components = Array.from({ length: 33 }, (_, i) => `"c${i}"`).join(" ");
    expect(await visaTap.bound(tap({ signatureInput: `sig2=(${components})` }))).toEqual(refused("card/too-large"));
    expect(await visaTap.bound(tap({ lcpHash: [H + " ".repeat(200)] }))).toEqual(refused("card/too-large"));
  });

  it("a repeated key takes the later value, as RFC 9651 parses it", async () => {
    const later = `${input}, sig2=("@path");tag="agent-payer-auth"`;
    expect(await visaTap.bound(tap({ signatureInput: later }))).toEqual(refused("card/tap-hash-not-covered"));
  });
});

describe("C4 disclosureDigest", () => {
  it("RFC 9901's published disclosures give its published digests", async () => {
    for (const row of V.C4) expect(await disclosureDigest(row.disclosure)).toBe(row.expect);
  });
});

describe("the VI fixtures", () => {
  it("recompute the printed digests", async () => {
    const [l2iJws, dc, dp] = VI.L2i.split("~");
    const [l2aJws, dco] = VI.L2a.split("~");
    const [, d3] = VI.L3b.split("~");
    expect(await disclosureDigest(VI.CJ)).toBe(VI.printed["CH"]);
    expect(await disclosureDigest(VI.L1)).toBe(VI.printed["D(L1)"]);
    expect(await disclosureDigest(dc)).toBe(VI.printed["D(dc)"]);
    expect(await disclosureDigest(dp)).toBe(VI.printed["D(dp)"]);
    expect(await disclosureDigest(dco)).toBe(VI.printed["D(dco)"]);
    expect(await disclosureDigest(VI.L2a)).toBe(VI.printed["D(L2a)"]);
    expect(await disclosureDigest(d3)).toBe(VI.printed["D(d3)"]);
    expect(await verifyEs256(l2iJws, V.fixed.USER)).toBe(true);
    expect(await verifyEs256(l2aJws, V.fixed.USER)).toBe(true);
    expect(await verifyEs256(VI.L3b.split("~")[0], V.fixed.AGENT)).toBe(true);
  });
});

describe("C5 VI read and build", () => {
  it("read(CJ) returns H and L", () => {
    for (const p of [viImmediate, viAutonomous]) expect(p.read(V.C5.read.doc)).toEqual(V.C5.read.expect);
  });

  it("build(CJ, H) returns the checkout mandate, and transactionId, as CH", async () => {
    for (const p of [viImmediate, viAutonomous]) expect(await p.build(VI.CJ, V.C5.build.h)).toEqual(V.C5.build.expect);
  });

  it("build(CJ, E) is card/vi-legal-context-conflict", async () => {
    expect(await viImmediate.build(VI.CJ, V.C5.conflict.h)).toEqual(refused(V.C5.conflict.expect));
  });

  // build takes the checkout_jwt's legal context as read does: card.json agreedRefusals, "read with a legalContext
  // whose link is not https".
  it("build of a checkout_jwt whose link is not https is card/legal-context-malformed, as read gives", async () => {
    const legalContext = { type: "sha256", value: H, legalContextUrl: V.C1.httpLink.link };
    const cj = jws({ alg: "ES256", typ: "JWT" }, { legalContext });
    expect(viImmediate.read(cj)).toEqual(refused("card/legal-context-malformed"));
    for (const p of [viImmediate, viAutonomous]) expect(await p.build(cj, H)).toEqual(refused("card/legal-context-malformed"));
  });

  it("a checkout_jwt that is not a JWS, or too large, is refused", () => {
    expect(viImmediate.read("a.b")).toEqual(refused("card/vi-malformed"));
    expect(viImmediate.read(42)).toEqual(refused("card/vi-malformed"));
    expect(viImmediate.read(`${enc({ alg: "none" })}.${enc({})}.`)).toEqual(refused("card/no-legal-context"));
    expect(viImmediate.read("a".repeat(16385))).toEqual(refused("card/too-large"));
  });
});

describe("C6 VI Immediate", () => {
  it("bound({l2: L2i}) returns H", async () => {
    expect(await viImmediate.bound(V.C6.bound.presented)).toBe(V.C6.bound.expect);
  });

  it("plant: a substituted checkout disclosure the signed payload does not reference is refused, never its hash", async () => {
    const r = await viImmediate.bound(V.C6.plant.presented);
    expect(r).toEqual(refused(V.C6.plant.expect));
    expect(r).not.toBe(V.C6.plant.never);
  });

  it("a payment mandate whose transaction_id differs is card/vi-transaction-id-mismatch", async () => {
    const dp2 = disc("c2FsdA", { vct: "mandate.payment.1", transaction_id: "x" });
    const dc = VI.L2i.split("~")[1];
    const layer = `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(dc) }, { "...": await disclosureDigest(dp2) }] })}~${dc}~${dp2}~`;
    expect(await viImmediate.bound({ l2: layer })).toEqual(refused("card/vi-transaction-id-mismatch"));
  });

  it("a checkout_hash that is not the checkout_jwt's digest is card/vi-checkout-hash-mismatch", async () => {
    const d = disc("c2FsdA", { vct: "mandate.checkout.1", checkout_jwt: VI.CJ, checkout_hash: VI.printed["D(dc)"] });
    const layer = `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }] })}~${d}~`;
    expect(await viImmediate.bound({ l2: layer })).toEqual(refused("card/vi-checkout-hash-mismatch"));
  });

  it("bound of a checkout_jwt whose link is not https is card/legal-context-malformed, as read gives", async () => {
    const legalContext = { type: "sha256", value: H, legalContextUrl: V.C1.httpLink.link };
    const cj = jws({ alg: "ES256", typ: "JWT" }, { legalContext });
    const d = disc("c2FsdA", { vct: "mandate.checkout.1", checkout_jwt: cj, checkout_hash: await disclosureDigest(cj) });
    const layer = `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }] })}~${d}~`;
    expect(await viImmediate.bound({ l2: layer })).toEqual(refused("card/legal-context-malformed"));
  });

  it("layout refusals", async () => {
    const d = VI.L2i.split("~")[1];
    const ok = { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }] };
    expect(await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt+kb" }, ok)}~${d}~` })).toEqual(refused("card/vi-typ"));
    expect(await viImmediate.bound({ l2: `${jws({ alg: "ES384", typ: "kb-sd-jwt" }, ok)}~${d}~` })).toEqual(refused("card/vi-typ"));
    expect(await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, ok)}~` })).toEqual(refused("card/vi-malformed"));
    expect(await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, ok)}~${d}` })).toEqual(refused("card/vi-malformed"));
    expect(
      await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, { ...ok, _sd_alg: "sha-512" })}~${d}~` }),
    ).toEqual(refused("card/vi-malformed"));
    expect(await viImmediate.bound({ l2: "x".repeat(65537) })).toEqual(refused("card/too-large"));
    const two = `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }, { "...": VI.printed["D(d3)"] }] })}~${d}~${VI.L3b.split("~")[1]}~`;
    expect(await viImmediate.bound({ l2: two })).toEqual(refused("card/vi-no-checkout-mandate"));
  });

  // The SD-JWT reader under a layer: RFC 9901 sections 4.2.1 and 4.2.2 make each disclosure a base64url-encoded JSON
  // array, and a payload nested deeper than the package's 64 levels is too large (docs/reference/refusals.md,
  // card/vi-malformed and card/too-large).
  it("a disclosure that is not an array is card/vi-malformed; a payload nested too deeply is card/too-large", async () => {
    const d = VI.L2i.split("~")[1];
    const ok = { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }] };
    const notArray = enc({ vct: "mandate.checkout.1" });
    expect(await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, ok)}~${notArray}~` })).toEqual(
      refused("card/vi-malformed"),
    );
    let deep: unknown = 0;
    for (let i = 0; i < 65; i++) deep = [deep];
    expect(await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, { ...ok, deep })}~${d}~` })).toEqual(
      refused("card/too-large"),
    );
  });
});

describe("C7 VI Autonomous", () => {
  it("bound({l1, l2: L2a, l3b}) returns H", async () => {
    expect(await viAutonomous.bound(V.C7.bound.presented)).toBe(V.C7.bound.expect);
  });

  it("one flipped byte in L3b's signature is card/vi-signature-invalid", async () => {
    expect(await viAutonomous.bound(V.C7.flippedSignature.presented)).toEqual(refused(V.C7.flippedSignature.expect));
  });

  it("an l2 without dco is card/vi-sd-hash-mismatch", async () => {
    expect(await viAutonomous.bound(V.C7.withoutDco.presented)).toEqual(refused(V.C7.withoutDco.expect));
  });

  it("L2 bound to another L1, or a kid that is not the delegated key's, is refused", async () => {
    const { l1, l2, l3b } = V.C7.bound.presented;
    expect(await viAutonomous.bound({ l1: `${l1}x~`, l2, l3b })).toEqual(refused("card/vi-sd-hash-mismatch"));
    const [head, payload, sig] = l3b.split("~")[0].split(".");
    const otherKid = `${enc({ ...JSON.parse(Buffer.from(head, "base64url").toString()), kid: "agent-2" })}.${payload}.${sig}~${l3b.split("~")[1]}~`;
    expect(await viAutonomous.bound({ l1, l2, l3b: otherKid })).toEqual(refused("card/vi-kid-mismatch"));
  });

  it("an L2 signature that does not verify under L1's cnf.jwk is card/vi-signature-invalid", async () => {
    // L1 re-issued with the agent's key as the user's; L2a re-pointed at it by sd_hash, so its user signature no
    // longer verifies; L3b re-pointed at that L2 and signed under the agent key derived at test time from the recipe.
    const { l1, l3b } = V.C7.bound.presented;
    const l1Payload = JSON.parse(Buffer.from(l1.split(".")[1], "base64url").toString());
    l1Payload.cnf.jwk = V.fixed.AGENT;
    const [l1h, , l1s] = l1.slice(0, -1).split(".");
    const l1Other = `${l1h}.${enc(l1Payload)}.${l1s}~`;
    const [l2h, l2p, l2s] = VI.L2a.split("~")[0].split(".");
    const l2Payload = JSON.parse(Buffer.from(l2p, "base64url").toString());
    l2Payload.sd_hash = await disclosureDigest(l1Other);
    const l2 = `${l2h}.${enc(l2Payload)}.${l2s}~${VI.L2a.split("~")[1]}~`;
    const [l3h, l3p] = l3b.split("~")[0].split(".");
    const l3Payload = JSON.parse(Buffer.from(l3p, "base64url").toString());
    l3Payload.sd_hash = await disclosureDigest(l2);
    const l3Signed = await agentSign(`${l3h}.${enc(l3Payload)}`);
    const l3 = `${l3Signed}~${l3b.split("~")[1]}~`;
    expect(await viAutonomous.bound({ l1: l1Other, l2, l3b: l3 })).toEqual(refused("card/vi-signature-invalid"));
    expect(await viAutonomous.bound({ l1: l1Other, l2: VI.L2a, l3b: l3 })).toEqual(refused("card/vi-sd-hash-mismatch"));
  });
});

describe("C8 plain checkout", () => {
  it("bound and build refuse card/no-signed-place for any input, and buyerSigns is false", async () => {
    for (const x of V.C8.inputs) {
      expect(await sellerReference.bound(x)).toEqual(refused(V.C8.expect));
      expect(await sellerReference.build(x, H)).toEqual(refused(V.C8.expect));
    }
    expect(sellerReference.pattern.buyerSigns).toBe(V.C8.buyerSigns);
    expect(sellerReference.read(V.C2.build.doc)).toEqual({ h: H, link: L });
  });
});

describe("what each record proves", () => {
  const opening =
    "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. ";
  it("every card pairing has publicProof false and opens with the agreement sentence", () => {
    for (const p of PAIRINGS) {
      expect(p.pattern.publicProof).toBe(false);
      expect(p.pattern.onChain).toBe(false);
      expect(p.pattern.zeroPartyRecoverable).toBe(false);
      expect(p.pattern.forwardIndexable).toBe(false);
      expect(p.pattern.proves.startsWith(opening)).toBe(true);
      expect(Object.isFrozen(p.pattern)).toBe(true);
    }
  });

  it("patterns, profiles, buyerSigns and claims per pairing", () => {
    expect([visaTap, viImmediate, viAutonomous, sellerReference].map((p) => [p.id, p.pattern.pattern, p.pattern.canonical, p.pattern.profile, p.pattern.buyerSigns, p.claims])).toEqual([
      ["card/visa-tap", "protocol-extension", false, "card/visa-tap", true, true],
      ["card/mastercard-vi/immediate", "id-reuse", true, "card/mastercard-vi", true, true],
      ["card/mastercard-vi/autonomous", "id-reuse", true, "card/mastercard-vi", true, true],
      ["card/seller-reference", "http-advisory", true, undefined, false, false],
    ]);
  });

  it("no card pairing reads a rail", () => {
    for (const p of PAIRINGS) {
      expect(p).not.toHaveProperty("status");
      expect(p).not.toHaveProperty("recover");
      expect(p).not.toHaveProperty("reference");
    }
  });
});

describe("no function throws", () => {
  const junk: unknown[] = [undefined, null, 0, "", "~", "a.b.c~", [], {}, { l2: 1 }, { signatureInput: 1 }, { l1: "", l2: "", l3b: "" }];
  it("every entry returns a value for any input", async () => {
    for (const x of junk) {
      for (const p of PAIRINGS) {
        await expect(p.bound(x as never)).resolves.toBeDefined();
        await expect(p.build(x, H)).resolves.toBeDefined();
        expect(p.read(x)).toBeDefined();
        expect(p.advertise({}, x as AtrHash, x as string, x as CardOption)).toBeDefined();
      }
    }
  });
});

describe("card.json agreedRefusals: every row runs", () => {
  const offer = V.C1.advertise.offer as CardOption;
  const input = V.C2.request.signatureInput as string;
  const presented = V.C7.bound.presented as { l1: string; l2: string; l3b: string };
  const partsOf = (layer: string) => layer.split("~")[0]!.split(".") as [string, string, string];
  const payloadOf = (layer: string) => JSON.parse(Buffer.from(partsOf(layer)[1], "base64url").toString());
  const headerOf = (layer: string) => JSON.parse(Buffer.from(partsOf(layer)[0], "base64url").toString());
  const rest = (layer: string) => layer.slice(layer.indexOf("~"));
  /** L1 with another `cnf.jwk`, L2a re-pointed at it, and L3b re-pointed at that L2 and signed under the agent key. */
  const withUserKey = async (jwk: unknown) => {
    const l1Payload = payloadOf(presented.l1);
    l1Payload.cnf.jwk = jwk;
    const [l1h, , l1s] = presented.l1.slice(0, -1).split(".");
    const l1 = `${l1h}.${enc(l1Payload)}.${l1s}~`;
    const l2Payload = payloadOf(VI.L2a);
    l2Payload.sd_hash = await disclosureDigest(l1);
    const [l2h, , l2s] = partsOf(VI.L2a);
    const l2 = `${l2h}.${enc(l2Payload)}.${l2s}${rest(VI.L2a)}`;
    const l3Payload = payloadOf(presented.l3b);
    l3Payload.sd_hash = await disclosureDigest(l2);
    const l3b = `${await agentSign(`${partsOf(presented.l3b)[0]}.${enc(l3Payload)}`)}${rest(presented.l3b)}`;
    return { l1, l2, l3b };
  };
  /**
   * The presented chain with L1's `cnf.jwk` set to `user` and the `cnf.jwk` of L2's open checkout mandate to `agent`,
   * where given, and every sd_hash re-pointed: L2 is signed again under USER and L3b under AGENT, so the chain differs
   * from C7's only in the keys it names.
   */
  const resigned = async (keys: { user?: unknown; agent?: unknown }) => {
    const l1Payload = payloadOf(presented.l1);
    if (keys.user !== undefined) l1Payload.cnf.jwk = keys.user;
    const [l1h, , l1s] = presented.l1.slice(0, -1).split(".");
    const l1 = `${l1h}.${enc(l1Payload)}.${l1s}~`;
    const l2Payload = payloadOf(presented.l2);
    let discs = presented.l2.split("~").slice(1, -1);
    if (keys.agent !== undefined) {
      const open = discs.find((d) => JSON.parse(Buffer.from(d, "base64url").toString())[1].vct === "mandate.checkout.open.1")!;
      const [salt, value] = JSON.parse(Buffer.from(open, "base64url").toString());
      const swapped = disc(salt, { ...value, cnf: { jwk: keys.agent } });
      const [from, to] = [await disclosureDigest(open), await disclosureDigest(swapped)];
      l2Payload._sd = l2Payload._sd.map((s: string) => (s === from ? to : s));
      l2Payload.delegate_payload = l2Payload.delegate_payload.map((e: { "...": string }) => ({ "...": e["..."] === from ? to : e["..."] }));
      discs = discs.map((d) => (d === open ? swapped : d));
    }
    l2Payload.sd_hash = await disclosureDigest(l1);
    const l2 = `${await recipeSign("lcp-test/user", V.fixed.USER, `${partsOf(presented.l2)[0]}.${enc(l2Payload)}`)}~${discs.map((d) => `${d}~`).join("")}`;
    const l3Payload = { ...payloadOf(presented.l3b), sd_hash: await disclosureDigest(l2) };
    const l3b = `${await agentSign(`${partsOf(presented.l3b)[0]}.${enc(l3Payload)}`)}${rest(presented.l3b)}`;
    return { l1, l2, l3b };
  };
  const USER = V.fixed.USER as { kty: string; crv: string; x: string; y: string };
  const AGENT = V.fixed.AGENT as { kty: string; crv: string; x: string; y: string; kid: string };

  // RFC 7518 §6.2.1.2-3: x and y are the full 32-byte P-256 coordinates, base64url-encoded; RFC 7515 §2 omits the
  // padding. The chain re-signed under the keys as given is bound to H, so each row's chain differs in its key alone.
  it("a chain re-signed under the recipe keys as given is bound to H", async () => {
    expect(await viAutonomous.bound(await resigned({ user: USER }))).toBe(H);
    expect(await viAutonomous.bound(await resigned({ agent: AGENT }))).toBe(H);
  });

  const cases: Record<string, () => Promise<unknown[]>> = {
    "advertise with a link over 2048 characters": async () => [
      visaTap.advertise({}, H, `https://atr.seller.example/${"a".repeat(2048)}`, offer),
    ],
    "advertise or TAP build with a hash that is not 0x and 64 hex digits": async () => [
      visaTap.advertise({}, "0x12" as AtrHash, L, offer),
      await visaTap.build({}, H.slice(2) as AtrHash),
    ],
    "read of shown JSON that is not an object, or has no legalContext member": async () => [
      visaTap.read([]),
      visaTap.read({ other: 1 }),
    ],
    "read with a legalContext whose link is not https": async () => [
      visaTap.read({ legalContext: { type: "sha256", value: H, legalContextUrl: L.replace("https:", "http:") } }),
    ],
    "read with a legalContext whose link is over 2048 characters": async () => [
      visaTap.read({ legalContext: { type: "sha256", value: H, legalContextUrl: `https://a.example/${"a".repeat(2048)}` } }),
    ],
    "VI read or build of a checkout_jwt that is not a string of three dot-separated visible-ASCII segments whose second decodes to a JSON object":
      async () => [viImmediate.read("a.b"), viImmediate.read(42), await viAutonomous.build(`a.${enc([1])}.b`, H)],
    "VI read or build of a checkout_jwt over 16384 characters": async () => [
      viImmediate.read("a".repeat(16385)),
      await viImmediate.build("a".repeat(16385), H),
    ],
    "TAP bound with presented not an object, or signatureInput not a string": async () => [
      await visaTap.bound("sig2=()"),
      await visaTap.bound(tap({ signatureInput: 7 as unknown as string })),
    ],
    "TAP bound with signatureInput or signature over 8192 characters, a dictionary over 16 members, or an inner list over 32 items":
      async () => [
        await visaTap.bound(tap({ signatureInput: input + " ".repeat(8193 - input.length) })),
        await visaTap.bound(tap({ signature: "s".repeat(8193) })),
        await visaTap.bound(tap({ signatureInput: Array.from({ length: 17 }, (_, i) => `s${i}=()`).join(", ") })),
        await visaTap.bound(tap({ signatureInput: `sig2=(${Array.from({ length: 33 }, (_, i) => `"c${i}"`).join(" ")})` })),
      ],
    "TAP bound with a Decimal, Date or Display String anywhere, or a Byte Sequence parameter, in signatureInput": async () => [
      await visaTap.bound(tap({ signatureInput: `${input};x=1.5` })),
      await visaTap.bound(tap({ signatureInput: `${input};x=@1790000000` })),
      await visaTap.bound(tap({ signatureInput: `${input};x=%"a"` })),
      await visaTap.bound(tap({ signatureInput: `${input};x=:AAAA:` })),
    ],
    "TAP bound with tag=agent-payer-auth as a Token rather than a String": async () => [
      await visaTap.bound(tap({ signatureInput: input.replace('tag="agent-payer-auth"', "tag=agent-payer-auth") })),
    ],
    "TAP bound with lcpHash not an array, or a line that is not a string": async () => [
      await visaTap.bound(tap({ lcpHash: H as unknown as string[] })),
      await visaTap.bound(tap({ lcpHash: [7] as unknown as string[] })),
    ],
    "TAP bound with the one lcp-hash line over 256 characters": async () => [
      await visaTap.bound(tap({ lcpHash: [H + " ".repeat(200)] })),
    ],
    "VI bound with a layer over 65536 characters or over 32 disclosures": async () => {
      const d = VI.L2i.split("~")[1];
      const many = `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, { _sd_alg: "sha-256", delegate_payload: [] })}~${`${d}~`.repeat(33)}`;
      return [await viImmediate.bound({ l2: "x".repeat(65537) }), await viImmediate.bound({ l2: many })];
    },
    "VI bound with an L2 or L3b layer that has no disclosure or a non-empty last part": async () => {
      const d = VI.L2i.split("~")[1];
      const ok = { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }] };
      const l3Jws = presented.l3b.split("~")[0];
      return [
        await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, ok)}~` }),
        await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, ok)}~${d}` }),
        await viAutonomous.bound({ ...presented, l3b: `${l3Jws}~` }),
        await viAutonomous.bound({ ...presented, l3b: `${presented.l3b}x` }),
      ];
    },
    "VI bound with a layer payload lacking _sd_alg sha-256 or a delegate_payload array of {\"...\": string} entries": async () => {
      const d = VI.L2i.split("~")[1];
      const head = { alg: "ES256", typ: "kb-sd-jwt" };
      return [
        await viImmediate.bound({ l2: `${jws(head, { delegate_payload: [{ "...": await disclosureDigest(d) }] })}~${d}~` }),
        await viImmediate.bound({ l2: `${jws(head, { _sd_alg: "sha-512", delegate_payload: [{ "...": await disclosureDigest(d) }] })}~${d}~` }),
        await viImmediate.bound({ l2: `${jws(head, { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }, 7] })}~${d}~` }),
      ];
    },
    "VI bound with two referenced mandate.checkout.1 values": async () => {
      const d = VI.L2i.split("~")[1];
      const d2 = disc("c2FsdDI", JSON.parse(Buffer.from(d, "base64url").toString())[1]);
      const payload = { _sd_alg: "sha-256", delegate_payload: [{ "...": await disclosureDigest(d) }, { "...": await disclosureDigest(d2) }] };
      return [await viImmediate.bound({ l2: `${jws({ alg: "ES256", typ: "kb-sd-jwt" }, payload)}~${d}~${d2}~` })];
    },
    "VI Autonomous bound with an L3b header lacking a string kid": async () => {
      const [, p, s] = partsOf(presented.l3b);
      const { kid: _kid, ...head } = headerOf(presented.l3b);
      return [await viAutonomous.bound({ ...presented, l3b: `${enc(head)}.${p}.${s}${rest(presented.l3b)}` })];
    },
    "VI Autonomous bound with no, or more than one, referenced mandate.checkout.open.1 in L2, or an L1 cnf.jwk that is not EC P-256":
      async () => {
        const open = VI.L2a.split("~")[1];
        const openTwice = disc("c2FsdDI", JSON.parse(Buffer.from(open, "base64url").toString())[1]);
        const repoint = async (discs: string[]) => {
          const l2Payload = { ...payloadOf(VI.L2a), _sd: undefined, delegate_payload: await Promise.all(discs.map(async (x) => ({ "...": await disclosureDigest(x) }))) };
          const l2 = `${partsOf(VI.L2a)[0]}.${enc(l2Payload)}.${partsOf(VI.L2a)[2]}~${discs.map((x) => `${x}~`).join("")}`;
          const l3Payload = { ...payloadOf(presented.l3b), sd_hash: await disclosureDigest(l2) };
          const [h3, , s3] = partsOf(presented.l3b);
          return viAutonomous.bound({ l1: presented.l1, l2, l3b: `${h3}.${enc(l3Payload)}.${s3}${rest(presented.l3b)}` });
        };
        const other = disc("c2FsdDM", { vct: "mandate.payment.open.1" });
        return [
          await repoint([other]),
          await repoint([open, openTwice]),
          await viAutonomous.bound(await withUserKey({ kty: "OKP", crv: "Ed25519", x: V.fixed.AGENT.x })),
        ];
      },
    "VI Autonomous bound with L2's sd_hash not the digest of l1": async () => [
      await viAutonomous.bound({ ...presented, l1: `${presented.l1}x~` }),
    ],
    "VI Autonomous bound with an L2 signature that does not verify under L1's cnf.jwk": async () => [
      await viAutonomous.bound(await withUserKey(V.fixed.AGENT)),
    ],
    "VI Autonomous bound with an L1 or L2 cnf.jwk whose x or y is not unpadded base64url of 32 bytes": async () => [
      await viAutonomous.bound(await resigned({ user: { ...USER, x: `${USER.x}=` } })),
      await viAutonomous.bound(await resigned({ user: { ...USER, y: `${USER.y}=` } })),
      await viAutonomous.bound(await resigned({ user: { ...USER, x: b64u(Uint8Array.of(0, ...unb64u(USER.x))) } })),
      await viAutonomous.bound(await resigned({ user: { ...USER, y: b64u(unb64u(USER.y).subarray(1)) } })),
      await viAutonomous.bound(await resigned({ agent: { ...AGENT, x: `${AGENT.x}=` } })),
    ],
    "VI Autonomous bound with an L1 or L2 cnf.jwk whose x or y has a pad bit set in its last character": async () => [
      await viAutonomous.bound(await resigned({ user: { ...USER, x: padBit(USER.x) } })),
      await viAutonomous.bound(await resigned({ user: { ...USER, y: padBit(USER.y) } })),
      await viAutonomous.bound(await resigned({ agent: { ...AGENT, x: padBit(AGENT.x) } })),
    ],
    "VI read or bound with a checkout_jwt or layer segment, or a disclosure, that has a pad bit set in its last character":
      async () => {
        const [ch, cp, cs] = (VI.CJ as string).split(".") as [string, string, string];
        const [h3, p3, s3] = partsOf(presented.l3b);
        const [h2, p2, s2] = partsOf(presented.l2);
        // L2's signature with a pad bit set: L3b's sd_hash names L2's text, so L3b is re-pointed and signed again.
        const l2 = `${h2}.${p2}.${padBit(s2)}${rest(presented.l2)}`;
        const l3Payload = { ...payloadOf(presented.l3b), sd_hash: await disclosureDigest(l2) };
        const l3b = `${await agentSign(`${h3}.${enc(l3Payload)}`)}${rest(presented.l3b)}`;
        // L3b's checkout mandate disclosure with a pad bit set, listed by that text's digest, and L3b signed again.
        const discs = presented.l3b.split("~").slice(1, -1);
        const mandate = discs.find((d) => JSON.parse(Buffer.from(d, "base64url").toString())[1].vct === "mandate.checkout.1")!;
        const [from, to] = [await disclosureDigest(mandate), await disclosureDigest(padBit(mandate))];
        const swap = (d: string) => (d === from ? to : d);
        const p3Swapped = payloadOf(presented.l3b);
        if (Array.isArray(p3Swapped._sd)) p3Swapped._sd = p3Swapped._sd.map(swap);
        p3Swapped.delegate_payload = p3Swapped.delegate_payload.map((e: { "...": string }) => ({ "...": swap(e["..."]) }));
        const discsSwapped = discs.map((d) => `${d === mandate ? padBit(d) : d}~`).join("");
        const l3bDisclosure = `${await agentSign(`${h3}.${enc(p3Swapped)}`)}~${discsSwapped}`;
        return [
          viImmediate.read(`${padBit(ch)}.${cp}.${cs}`),
          viImmediate.read(`${ch}.${padBit(cp)}.${cs}`),
          viImmediate.read(`${ch}.${cp}.${padBit(cs)}`),
          await viAutonomous.bound({ ...presented, l3b: `${h3}.${p3}.${padBit(s3)}${rest(presented.l3b)}` }),
          await viAutonomous.bound({ ...presented, l2, l3b }),
          await viAutonomous.bound({ ...presented, l3b: l3bDisclosure }),
        ];
      },
  };

  it("names a case for every row, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual((V.agreedRefusals.rows as { case: string }[]).map((r) => r.case).sort());
  });

  for (const row of V.agreedRefusals.rows as { case: string; expect: string }[]) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }
});
