// MPP's challenge pieces against mpp-challenge.json. Every expected value is the file's.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodePacked, keccak256 } from "viem";
import {
  challengeH,
  challengeHash,
  challengeId,
  issuedDigest,
  network,
  pairingsOf,
  pairingsOfPlaced,
  parseChallenges,
  place,
  problem,
  read,
  tie,
  type MppChallenge,
} from "../src/mpp.js";
import { C_E, C_T, H, V, b64u, challenge, fromB64u, link, realm } from "./mpp-fixtures.js";

const sha256 = (s: string) => "0x" + createHash("sha256").update(s).digest("hex");

describe("mpp-challenge.json", () => {
  it("MV1: the id and its inverse", () => {
    expect(challengeId(H, 0)).toBe(V.MV1.expectId);
    expect(challengeH(V.MV1.expectId)).toBe(H);
    for (const id of V.MV1.notOurs) expect(challengeH(id)).toEqual(V.MV1.expectNotOurs);
    expect(challengeH("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0.00")).toEqual(V.MV1.expectNotOurs);
    expect(challengeH("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa1.0")).toEqual(V.MV1.expectNotOurs);
    expect(challengeId(H, 32)).toEqual({ refused: true, code: "mpp/challenge-malformed" });
  });

  it("MV2: challengeHash, and viem's keccak256(encodePacked(string, string)) agrees", () => {
    expect(challengeHash(V.MV1.expectId, realm)).toBe(V.MV2.expect);
    expect(keccak256(encodePacked(["string", "string"], [V.MV1.expectId, realm]))).toBe(V.MV2.expect);
  });

  it("MV3: place writes the id and opaque, leaves request unchanged, and read gives H and the link", () => {
    for (const c of [C_E, C_T]) {
      const placed = place([c], H, link, c) as MppChallenge[];
      expect(placed[0]!.id).toBe(V.MV3.expectId);
      expect(placed[0]!.opaque).toBe(V.MV3.expectOpaque);
      expect(placed[0]!.request).toBe(c.request);
      expect(read(placed)).toEqual({ h: H, link, offer: { challenges: placed } });
      expect(place(placed, H, link, c)).toEqual(placed);
      expect(place([c], H, link, c)).toEqual(placed);
    }
  });

  it("MV4: the issued digest, equal for the option and its echo, changed by header", async () => {
    const echoE = (place([C_E], H, link, C_E) as MppChallenge[])[0]!;
    const echoT = (place([C_T], H, link, C_T) as MppChallenge[])[0]!;
    expect(await issuedDigest(C_E)).toBe(V.MV4.expectE);
    expect(await issuedDigest(echoE)).toBe(V.MV4.expectE);
    expect(await issuedDigest({ ...C_E, header: V.MV4.header })).toBe(V.MV4.expectEWithHeader);
    expect(await issuedDigest(C_T)).toBe(V.MV4.expectT);
    expect(await issuedDigest(echoT)).toBe(V.MV4.expectT);
    expect(await issuedDigest({ ...echoE, description: "shown to the user" })).toBe(V.MV4.expectE);
    expect(await issuedDigest({ ...C_E, expires: "2026-09-21T14:14:21Z" })).not.toBe(V.MV4.expectE);
  });

  it("MV9: MPP's two-challenge example, as two values and as one", () => {
    const two = parseChallenges(V.MV9.fieldValues) as MppChallenge[];
    expect(two.map((c) => c.id)).toEqual(V.MV9.expectIds);
    const one = parseChallenges([V.MV9.fieldValues.join(", ")]) as MppChallenge[];
    expect(one.map((c) => c.id)).toEqual(V.MV9.expectIds);
    expect(one[1]).toEqual({ id: V.MV9.expectIds[1], realm: "api.example.com", method: "signed", intent: "charge", request: "..." });
  });

  it("MV9: other schemes, token68, quoted-pairs and unknown parameters", () => {
    const got = parseChallenges([
      'Bearer abc==, Payment ID="x\\"y", realm=r, method="evm", intent="charge", request="e30", extra="dropped", Basic',
    ]) as MppChallenge[];
    expect(got).toEqual([{ id: 'x"y', realm: "r", method: "evm", intent: "charge", request: "e30" }]);
  });

  it("MV10: problem types", () => {
    for (const row of V.MV10.rows) expect(problem(row.code)).toEqual(row.expect);
  });

  it("MV14: the agreement URL in opaque", async () => {
    const placed = place([C_E], H, link, C_E, V.fixed.agreementUrl) as MppChallenge[];
    const opaque = placed[0]!.opaque!;
    expect(opaque.length).toBe(V.MV14.expectOpaqueLength);
    expect(sha256(opaque)).toBe(V.MV14.expectOpaqueSha256);
    expect(await issuedDigest(placed[0]!)).toBe(V.MV14.expectIssuedDigest);
    expect(read(placed)).toEqual({ h: H, link, agreement: V.fixed.agreementUrl, offer: { challenges: placed } });
    expect(JSON.parse(fromB64u(opaque))).toEqual({
      legalContext: `lcp:sha256:${H}`,
      legalContextAgreementUrl: V.fixed.agreementUrl,
      legalContextUrl: link,
    });
  });

  it("S1: a Tempo subscription challenge's id is the bare base64url of H, one per 402", () => {
    const sub = challenge(
      "tempo",
      "subscription",
      JSON.stringify({
        amount: "10000000",
        currency: "0x20c0000000000000000000000000000000000000",
        methodDetails: { accessKey: { accessKeyAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", keyType: "secp256k1" }, chainId: 42431 },
        periodCount: "30",
        periodUnit: "day",
        recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
        subscriptionExpires: "2026-12-20T00:00:00Z",
      }),
    );
    const placed = place([C_E, sub], H, link, sub) as MppChallenge[];
    expect(placed[1]!.id).toBe(V.S1.expectBareId);
    expect(challengeH(V.S1.expectBareId)).toBe(H);
    const other = { ...sub, realm: "api.other.example" };
    expect(place([sub, other], H, link, sub)).toEqual({ refused: true, code: "mpp/witness-taken" });
  });

  // `pairingsOf` names a challenge's pairings as issued, and refuses an `opaque` already carrying `legalContext`
  // (mpp/carrier-taken); a placed challenge names the same pairings once its `opaque` is set aside. C_E lists
  // credentialTypes ["permit2", "authorization"], in that order; C_T's supportedModes is ["pull"].
  it("pairingsOfPlaced: the pairings of a placed challenge, as issued", () => {
    const e = (place([C_E], H, link, C_E) as MppChallenge[])[0]!;
    const t = (place([C_T], H, link, C_T, V.fixed.agreementUrl) as MppChallenge[])[0]!;
    expect(pairingsOf(e)).toEqual({ refused: true, code: "mpp/carrier-taken" });
    expect(pairingsOfPlaced(e)).toEqual(["mpp/charge/evm/permit2", "mpp/charge/evm/authorization"]);
    expect(pairingsOfPlaced(t)).toEqual(["mpp/charge/tempo/memo"]);
    expect(pairingsOfPlaced(C_E)).toEqual(pairingsOf(C_E));
    expect(pairingsOfPlaced({ ...e, expires: undefined } as never)).toEqual([]);
    expect(pairingsOfPlaced(null as never)).toEqual([]);
  });

  it("the checks on a challenge as issued", () => {
    const md = (details: object, extra: object = {}) =>
      challenge("evm", "charge", JSON.stringify({ amount: "10000", currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", recipient: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C", methodDetails: { chainId: 84532, ...details }, ...extra }));
    expect(pairingsOf({ ...C_E, expires: undefined } as unknown as MppChallenge)).toEqual({ refused: true, code: "mpp/expires-required" });
    expect(pairingsOf({ ...C_E, expires: "tomorrow" })).toEqual({ refused: true, code: "mpp/expires-required" });
    expect(pairingsOf(md({ credentialTypes: ["permit2", "card"] }))).toEqual({ refused: true, code: "mpp/credential-types" });
    expect(pairingsOf(md({ credentialTypes: [] }))).toEqual({ refused: true, code: "mpp/credential-types" });
    expect(pairingsOf(md({ credentialTypes: ["permit2"], splits: [] }))).toEqual({ refused: true, code: "mpp/splits-malformed" });
    expect(pairingsOf(md({ credentialTypes: ["permit2"], splits: [{ recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72", amount: "0" }] })))
      .toEqual({ refused: true, code: "mpp/splits-malformed" });
    const eleven = Array.from({ length: 11 }, () => ({ recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72", amount: "1" }));
    expect(pairingsOf(md({ credentialTypes: ["permit2"], splits: eleven }))).toEqual({ refused: true, code: "mpp/splits-malformed" });
    const withOpaque = (map: object) => ({ ...C_E, opaque: b64u(JSON.stringify(map)) });
    expect(pairingsOf(withOpaque({ legalContext: "x" }))).toEqual({ refused: true, code: "mpp/carrier-taken" });
    expect(pairingsOf(withOpaque({ legalContextAgreementUrl: "https://a.example/" }))).toEqual({ refused: true, code: "mpp/carrier-taken" });
    expect(pairingsOf(withOpaque({ order: "42" }))).toEqual(["mpp/charge/evm/permit2", "mpp/charge/evm/authorization"]);
    const memoT = challenge("tempo", "charge", JSON.stringify({ amount: "1", currency: "0x20c0000000000000000000000000000000000000", recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", methodDetails: { memo: "0x" + "00".repeat(32) } }));
    expect(pairingsOf(memoT)).toEqual({ refused: true, code: "mpp/carrier-taken" });
    const pushOnlyFeePayer = challenge("tempo", "charge", JSON.stringify({ amount: "1", currency: "0x20c0000000000000000000000000000000000000", recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", methodDetails: { supportedModes: ["push"], feePayer: true } }));
    expect(pairingsOf(pushOnlyFeePayer)).toEqual({ refused: true, code: "mpp/modes-pull-only" });
  });

  it("place and read refusals", () => {
    const placed = place([C_E], H, link, C_E) as MppChallenge[];
    const H2 = "0x88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589";
    expect(place(placed, H2, link, C_E)).toEqual({ refused: true, code: "mpp/legal-context-conflict" });
    expect(place(placed, H, link + "?v=2", C_E)).toEqual({ refused: true, code: "mpp/legal-context-conflict" });
    expect(place([C_E], H, "http://atr.seller.example/x", C_E)).toEqual({ refused: true, code: "mpp/link-not-https" });
    expect(place([C_E], H, link, C_E, "http://pay.seller.example/")).toEqual({ refused: true, code: "mpp/link-not-https" });
    expect(place([C_E], H, link, C_T)).toEqual({ refused: true, code: "mpp/not-this-pairing" });
    expect(read([C_E])).toEqual({ refused: true, code: "mpp/no-legal-context" });
    const other = place([C_T], H2, link, C_T) as MppChallenge[];
    expect(read([placed[0]!, { ...other[0]!, id: (challengeId(H2, 1) as string) }])).toEqual({
      refused: true,
      code: "mpp/legal-context-conflict",
    });
    expect(read([{ ...placed[0]!, id: challengeId(H2, 0) as string }])).toEqual({ refused: true, code: "mpp/no-legal-context" });
    const http = b64u(JSON.stringify({ legalContext: `lcp:sha256:${H}`, legalContextUrl: "http://atr.seller.example/x" }));
    expect(read([{ ...placed[0]!, opaque: http }])).toEqual({ refused: true, code: "mpp/link-not-https" });
  });

  it("tie keeps each distinct challenge once, with MPP's bound members in order", () => {
    const placed = place([C_E], H, link, C_E) as MppChallenge[];
    const [slot, value] = tie([C_E, C_E, { ...C_T, description: "d", id: "x" }]);
    expect(slot).toBe("mpp");
    expect(value.challenges).toEqual([C_E, C_T]);
    expect(Object.keys(value.challenges[0]!)).toEqual(["realm", "method", "intent", "request", "expires"]);
    expect(JSON.stringify(tie([placed[0]!])[1])).toContain("opaque");
  });

  it("agreedRefusals", async () => {
    const i = V.agreedRefusals.inputs;
    expect(pairingsOf(challenge("evm", "charge", i.requestMalformed))).toEqual({ refused: true, code: "mpp/request-malformed" });
    expect(pairingsOf(challenge("tempo", "charge", i.modesMalformed))).toEqual({ refused: true, code: "mpp/request-malformed" });
    expect(pairingsOf({ ...C_E, opaque: b64u(i.opaqueNotFlat) })).toEqual({ refused: true, code: "mpp/opaque-malformed" });
    expect(pairingsOf({ ...C_E, intent: "charge", method: "no-such-method" })).toEqual({ refused: true, code: "mpp/not-this-pairing" });
    expect(pairingsOf(challenge("evm", "charge", i.duplicateTypes))).toEqual(["mpp/charge/evm/permit2"]);
    expect(parseChallenges([i.headerDuplicate])).toEqual({ refused: true, code: "mpp/challenge-malformed" });
    expect(parseChallenges([i.headerEmptyId])).toEqual({ refused: true, code: "mpp/challenge-malformed" });
    expect(parseChallenges([i.headerBroken])).toEqual({ refused: true, code: "mpp/header-malformed" });
    expect(parseChallenges(["Payment " + "a".repeat(8200)])).toEqual({ refused: true, code: "mpp/header-malformed" });
    const many = Array.from({ length: 33 }, (_, k) => `Payment id="${k}", realm="r", method="m", intent="i", request="e30"`);
    expect(parseChallenges(many)).toEqual({ refused: true, code: "mpp/header-malformed" });
    expect(challengeId("0x12" as `0x${string}`, 0)).toEqual({ refused: true, code: "mpp/challenge-malformed" });
    expect(await issuedDigest(null as unknown as MppChallenge)).toEqual({ refused: true, code: "mpp/challenge-malformed" });
    const rows = V.agreedRefusals.rows as { case: string; expect: string }[];
    const notHttps = rows.find((r) => r.case.startsWith("read with a legalContextAgreementUrl of at most 2048"))!.expect;
    const malformed = rows.find((r) => r.case.startsWith("read with a legalContextAgreementUrl that is not a string"))!.expect;
    const placed = place([C_E], H, link, C_E) as MppChallenge[];
    const withAgreement = (a: string) => [
      { ...placed[0]!, opaque: b64u(JSON.stringify({ legalContext: `lcp:sha256:${H}`, legalContextAgreementUrl: a, legalContextUrl: link })) },
    ];
    expect(read(withAgreement(V.fixed.agreementUrl))).toMatchObject({ h: H, link, agreement: V.fixed.agreementUrl });
    for (const a of ["http://pay.seller.example/agreement", "HTTP://pay.seller.example/agreement", "ftp://pay.seller.example/a"]) {
      expect([a, read(withAgreement(a))]).toEqual([a, { refused: true, code: notHttps }]);
    }
    const long = `https://pay.seller.example/${"a".repeat(2030)}`;
    const longHttp = `http://pay.seller.example/${"a".repeat(2030)}`;
    for (const a of ["https://", "", "not a url", "https://u@pay.seller.example/", long, longHttp]) {
      expect([a.slice(0, 40), read(withAgreement(a))]).toEqual([a.slice(0, 40), { refused: true, code: malformed }]);
    }
  });

  it("network: each row's challenge, placed and issued, pays on the row's CAIP-2 network or is refused as the row says", () => {
    const rows = V.network.rows as { case: string; method: string; intent: string; request: string; expect: unknown }[];
    for (const r of rows) {
      const c = challenge(r.method, r.intent, r.request);
      expect([r.case, network(c)]).toEqual([r.case, r.expect]);
      const placed = place([c], H, link, c);
      if (Array.isArray(placed)) expect([r.case, network(placed[0]!)]).toEqual([r.case, r.expect]);
    }
  });
});
