// MPP's challenge pieces against mpp-challenge.json. Every expected value is the file's.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodePacked, keccak256 } from "viem";
import {
  chargeHedera,
  chargeSolana,
  chargeStellar,
  chargeXrpl,
  challengeH,
  challengeHash,
  challengeId,
  evmAuthorization,
  evmTransaction,
  issuedDigest,
  network,
  pairingsOf,
  pairingsOfPlaced,
  parseChallenges,
  place,
  problem,
  read,
  sessionHedera,
  sessionResume,
  tempoPush,
  tie,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { ReaderError } from "../src/evm.js";
import type { HederaEvmReader, HederaReader } from "../src/hedera.js";
import type { StellarReader } from "../src/stellar.js";
import type { SvmLanded, SvmReader } from "../src/svm.js";
import type { XrplReader } from "../src/xrpl.js";
import { REFUSAL_CODES } from "../src/internal/codes.js";
import { C_E, C_T, H, V, b64u, challenge, fromB64u, link, load, readerFor, realm } from "./mpp-fixtures.js";

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

  // MPP's Status Codes and Error Codes tables (draft-httpauth-payment-01 at 08e7dd87, lines 168-176 and 852-864) give
  // each class its status and type.
  it("MV10: problem's status and type for each class of code", () => {
    for (const row of V.MV10.rows) expect([row.code, problem(row.code)]).toEqual([row.code, row.expect]);
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
    expect(pairingsOf(md({ credentialTypes: ["permit2"], splits: [{ recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72", amount: "1.5" }] })))
      .toEqual({ refused: true, code: "mpp/splits-malformed" });
    const eleven = Array.from({ length: 11 }, () => ({ recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72", amount: "1" }));
    expect(pairingsOf(md({ credentialTypes: ["permit2"], splits: eleven }))).toEqual({ refused: true, code: "mpp/splits-malformed" });
    const withOpaque = (map: object) => ({ ...C_E, opaque: b64u(JSON.stringify(map)) });
    expect(pairingsOf(withOpaque({ legalContext: "x" }))).toEqual({ refused: true, code: "mpp/carrier-taken" });
    expect(pairingsOf(withOpaque({ legalContextAgreementUrl: "https://a.example/" }))).toEqual({ refused: true, code: "mpp/carrier-taken" });
    expect(pairingsOf(withOpaque({ order: "42" }))).toEqual(["mpp/charge/evm/permit2", "mpp/charge/evm/authorization"]);
    const memoT = challenge("tempo", "charge", JSON.stringify({ amount: "1", currency: "0x20c0000000000000000000000000000000000000", recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", methodDetails: { memo: "0x" + "00".repeat(32) } }));
    expect(pairingsOf(memoT)).toEqual({ refused: true, code: "mpp/carrier-taken" });
    // The Permit2 build writes `permit2Address` as the verifying contract (draft-evm-charge-00 L281) and `externalId`
    // into the signed witness (L453-456), so their form is checked where a Permit2 pairing is offered, and only there.
    const reqMalformed = { refused: true, code: "mpp/request-malformed" };
    expect(pairingsOf(md({ credentialTypes: ["transaction"], permit2Address: "nope" }))).toEqual(["mpp/charge/evm/transaction"]);
    expect(pairingsOf(md({}, { externalId: 7 }))).toEqual(["mpp/charge/evm/transaction", "mpp/charge/evm/hash"]);
    expect(pairingsOf(md({ credentialTypes: ["authorization", "hash"] }, { externalId: 7 }))).toEqual([
      "mpp/charge/evm/authorization",
      "mpp/charge/evm/hash",
    ]);
    expect(pairingsOf(md({ credentialTypes: ["transaction", "permit2"], permit2Address: "nope" }))).toEqual(reqMalformed);
    expect(pairingsOf(md({ credentialTypes: ["permit2"] }, { externalId: 7 }))).toEqual(reqMalformed);
    const { expires: _unset, ...unexpiring } = md({ credentialTypes: ["transaction", "permit2"], permit2Address: "nope" }, { externalId: 7 });
    expect(pairingsOf(unexpiring)).toEqual(["mpp/charge/evm/transaction"]);
    const pushOnlyFeePayer = challenge("tempo", "charge", JSON.stringify({ amount: "1", currency: "0x20c0000000000000000000000000000000000000", recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", methodDetails: { supportedModes: ["push"], feePayer: true } }));
    expect(pairingsOf(pushOnlyFeePayer)).toEqual({ refused: true, code: "mpp/modes-pull-only" });
  });

  // MPP's EVM charge draft (draft-evm-charge-00, "Payment Splits"): a split's `amount` is "Amount in base units for this
  // recipient", and the constraints bound the splits' count and their sum ("strictly less than `amount`"), not the sign
  // of one split.
  it("an EVM split of amount 0 is accepted, and leaves Permit2", () => {
    const zeroSplit = challenge("evm", "charge", JSON.stringify({ amount: "10000", currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", recipient: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C", methodDetails: { chainId: 84532, splits: [{ recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72", amount: "0" }] } }));
    expect(pairingsOf(zeroSplit)).toEqual({ refused: true, code: "mpp/credential-types" });
    const permit2 = challenge("evm", "charge", JSON.stringify({ amount: "10000", currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", recipient: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C", methodDetails: { chainId: 84532, credentialTypes: ["permit2", "authorization"], splits: [{ recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72", amount: "0" }] } }));
    expect(pairingsOf(permit2)).toEqual(["mpp/charge/evm/permit2"]);
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
    // A challenge of no session pairing names no channel to resume; a session challenge with no channelId names a new
    // channel and gives null (mpp-session-evm.json's ES8 reads one that names it).
    const notSession = rows.find((r) => r.case === "sessionResume of a challenge of no session pairing")!.expect;
    expect(sessionResume(C_E)).toEqual({ refused: true, code: notSession });
    expect(sessionResume(C_T)).toEqual({ refused: true, code: notSession });
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

// `problem` maps the codes this package returns, and only those. The statuses and types are MPP's Status Codes and
// Error Codes tables (draft-httpauth-payment-01 at 08e7dd87, lines 168-176 and 852-864); MV10 gives a row of each
// class.
describe("problem", () => {
  type Row = { code: string; expect: { status: number; type: string } };
  const rows = V.MV10.rows as Row[];
  const expectOf = (code: string) => rows.find((r) => r.code === code)!.expect;
  const internal = expectOf("mpp/not-a-code");
  const verificationFailed = expectOf("mpp/nonce-not-challenge-hash");
  const answered500 = rows.filter((r) => r.expect.status === 500 && REFUSAL_CODES.has(r.code)).map((r) => r.code);

  it("answers every code the package returns with a 402, except a read to repeat and a call that cannot read the payment, which are 500", () => {
    // 11 reads to repeat, and 10 calls that cannot read the payment: five wrong-reader and five read-first codes.
    expect(answered500.length).toBe(21);
    for (const code of REFUSAL_CODES) {
      const p = problem(code);
      const row = rows.find((r) => r.code === code);
      if (row !== undefined) expect([code, p]).toEqual([code, row.expect]);
      else expect([code, p]).toEqual([code, verificationFailed]);
    }
  });

  it("answers a code the package does not return with 500 internal-payment-error, whatever its namespace", () => {
    const foreign = [
      "claim/read-unavailable",
      "door/unavailable",
      "x402/anything",
      "MPP/CREDENTIAL-MALFORMED",
      "mpp/id-not-ours/",
      "",
    ];
    for (const code of foreign) expect([code, problem(code)]).toEqual([code, internal]);
    for (const code of [undefined, null, 402, {}]) expect(problem(code as never)).toEqual(internal);
  });

  // A pushed payment the reader cannot read yet answers 500 and no challenge, so the buyer is not asked to pay again; a
  // revert answers 402, since nothing moved. Each credential is its vector file's buyer row as presented.
  it("a push the seller's reader cannot read yet answers 500; a revert answers 402", async () => {
    const tempo = load("mpp-charge-tempo-push.json");
    const tempoCredential = tempo.buyer.rows[1].input.presented as MppCredential;
    const reverted = { ...tempo.MV13.receipt, status: 0 as const };
    const tempoAnswers = async (r: Parameters<typeof readerFor>[1]) => {
      const out = await tempoPush.fetchPresented(tempoCredential, readerFor("eip155:42431", r));
      return "refused" in out ? [out.code, problem(out.code)] : out;
    };
    expect(await tempoAnswers(null)).toEqual(["tempo/not-found", internal]);
    expect(await tempoAnswers("reader-error")).toEqual(["tempo/unreadable", internal]);
    expect(await tempoAnswers(reverted)).toEqual(["tempo/reverted", verificationFailed]);

    const hedera = load("mpp-session-hedera-solana-xrpl.json");
    const hederaCredential = hedera.buyer.rows[1].input.presented as MppCredential;
    const hederaAnswers = async (r: Parameters<typeof readerFor>[1]) => {
      const reader = readerFor("hedera:testnet", r) as unknown as HederaEvmReader;
      const out = await sessionHedera.fetchPresented(hederaCredential, reader);
      return "refused" in out ? [out.code, problem(out.code)] : out;
    };
    expect(await hederaAnswers(null)).toEqual(["hedera/not-found", internal]);
    expect(await hederaAnswers("reader-error")).toEqual(["hedera/unreadable", internal]);
    const hederaReverted = { status: 0 as const, blockNumber: "100", logs: [] };
    expect(await hederaAnswers(hederaReverted)).toEqual(["hedera/reverted", verificationFailed]);
  });

  // Tempo push: `bound` and `reference` on the buyer's credential as sent, before fetchPresented has read the landed
  // logs, answer tempo/read-first, 500 and no challenge, as MV10's row gives. The credential is the vector file's B6
  // buyer row without the `landed` member fetchPresented adds; with it, bound reads H (MV13).
  it("mpp/charge/tempo/push: bound and reference before fetchPresented answer tempo/read-first, 500", async () => {
    const tempo = load("mpp-charge-tempo-push.json");
    const presented = tempo.buyer.rows.find((r: { name: string }) => r.name === "B6").input.presented;
    const { landed: _landed, ...asSent } = presented as MppCredential & { landed: unknown };
    expect(await tempoPush.bound(asSent)).toEqual({ refused: true, code: "tempo/read-first" });
    expect(await tempoPush.reference(asSent)).toEqual({ refused: true, code: "tempo/read-first" });
    expect(problem("tempo/read-first")).toEqual(expectOf("tempo/read-first"));
    expect(expectOf("tempo/read-first")).toEqual(internal);
    expect(await tempoPush.bound(presented)).toBe(H);
  });

  // Tempo push: a reader that is missing or for another network than the challenge's chain (Ethereum mainnet,
  // eip155:1) answers tempo/wrong-reader, 500 and no challenge, as MV10's row gives; a reader for the chain that fails
  // still answers the read to repeat, tempo/unreadable. The credential is the vector file's B6 buyer row as presented.
  it("mpp/charge/tempo/push: a reader missing or of another network answers tempo/wrong-reader, 500", async () => {
    const tempo = load("mpp-charge-tempo-push.json");
    const presented = tempo.buyer.rows.find((r: { name: string }) => r.name === "B6").input.presented as MppCredential;
    for (const reader of [readerFor("eip155:1", tempo.MV13.receipt), undefined, null]) {
      const out = await tempoPush.fetchPresented(presented, reader as never);
      expect([reader?.network, out]).toEqual([reader?.network, { refused: true, code: "tempo/wrong-reader" }]);
    }
    expect(problem("tempo/wrong-reader")).toEqual(expectOf("tempo/wrong-reader"));
    expect(expectOf("tempo/wrong-reader")).toEqual(internal);
    const failing = await tempoPush.fetchPresented(presented, readerFor("eip155:42431", "reader-error"));
    expect(failing).toEqual({ refused: true, code: "tempo/unreadable" });
  });

  // The Hedera session: a reader that is missing or for another network than the challenge's chainId 296
  // (hedera:testnet) answers hedera/wrong-reader, 500 and no challenge, as MV10's row gives; a reader for that network
  // that fails answers the read to repeat, hedera/unreadable. The credential is the vector file's buyer row as
  // presented.
  it("mpp/session/hedera: a reader missing or of another network answers hedera/wrong-reader, 500", async () => {
    const hedera = load("mpp-session-hedera-solana-xrpl.json");
    const presented = hedera.buyer.rows[1].input.presented as MppCredential;
    const reader = (network: string) => readerFor(network, null) as unknown as HederaEvmReader;
    for (const r of [reader("hedera:mainnet"), undefined, null]) {
      const out = await sessionHedera.fetchPresented(presented, r as never);
      expect([r?.network, out]).toEqual([r?.network, { refused: true, code: "hedera/wrong-reader" }]);
    }
    expect(problem("hedera/wrong-reader")).toEqual(expectOf("hedera/wrong-reader"));
    expect(expectOf("hedera/wrong-reader")).toEqual(internal);
    const failing = readerFor("hedera:testnet", "reader-error") as unknown as HederaEvmReader;
    expect(await sessionHedera.fetchPresented(presented, failing)).toEqual({ refused: true, code: "hedera/unreadable" });
  });

  // Solana's, Stellar's, XRPL's and the Hedera charge's push reads, one case per arm: a read that fails, finds no
  // transaction, or finds an XRPL transaction not yet in a validated ledger, a reader of another network, and `bound`
  // on the push credential before fetchPresented has read it answer 500 and no challenge; a landed transaction that
  // failed answers 402 verification-failed. Each credential is its vector file's B6 buyer row's challenge as presented,
  // with that file's push payload. The failed transactions are the files' agreedRefusals rows (Solana's meta.err, XRPL's
  // tecPATH_DRY) and Hedera's fetchPresented row for a user entry without SUCCESS; the other Hedera reads are its
  // fetchPresented rows, and the other network the rail's mainnet; the codes are
  // those rows', `<rail>/wrong-reader` for another network, and the files' "not yet fetched" refusals rows (Hedera's
  // push.expectWithout) for `bound` before fetchPresented.
  const SO = load("mpp-charge-solana.json");
  const ST = load("mpp-charge-stellar.json");
  const XR = load("mpp-charge-xrpl.json");
  const HE = load("mpp-charge-hedera.json");
  const pushed = (file: typeof SO, payload: MppCredential["payload"]): MppCredential => ({
    challenge: file.buyer.rows.find((r: { name: string }) => r.name === "B6").input.presented.challenge,
    payload,
  });
  const agreed = (file: typeof SO, code: string) => file.agreedRefusals.rows.find((r: { expect: string }) => r.expect === code);
  const notYetFetched = (file: typeof SO) => file.refusals.find((r: { case: string }) => r.case.endsWith("not yet fetched"));
  const failing = async (): Promise<never> => {
    throw new ReaderError("transport");
  };

  const solanaPush = pushed(SO, { type: "signature", signature: SO.push.txid });
  const solana = (transaction: SvmReader["transaction"], network = SO.push.network): SvmReader => ({
    network,
    transaction,
    signatures: async () => [],
    blockhashValid: async () => ({ valid: true, slot: 0n }),
    firstAvailableBlock: async () => 0n,
    account: failing,
  });
  const solanaLanded = (err: unknown): SvmLanded => ({
    wire: Uint8Array.from(Buffer.from(SO.push.landedWireBase64, "base64")),
    err,
    loaded: { writable: [], readonly: [] },
    inner: [],
  });

  // A push under the sourceAccount section's challenge, whose feePayer is false: under feePayer true nothing is read.
  const stellarPush: MppCredential = { challenge: ST.sourceAccount.challenge, payload: ST.refusals[0].payload };
  const stellar = (transaction: StellarReader["transaction"], network: StellarReader["network"] = "stellar:testnet"): StellarReader => ({
    network,
    transaction,
    transfers: async () => ({ events: [], complete: true, oldestLedger: 1, latestLedger: 1000 }),
    latestLedger: async () => 1000,
  });

  const xrplPush = pushed(XR, XR.refusals[0].payload);
  const xrpl = (tx: XrplReader["tx"], network: XrplReader["network"] = "xrpl:1"): XrplReader => ({
    network,
    tx,
    txBlob: async () => XR.V3.blob,
    validatedLedger: async () => 1000,
  });
  const xrplLanded = (validated: boolean, result: string) => async () => ({ validated, result, ledgerIndex: 990, transactionType: "Payment" });

  const hederaPush = pushed(HE, { type: "hash", transactionId: HE.push.transactionId });
  const HEDERA_FAILED = "the user entry reached consensus without SUCCESS: the transfer failed";
  const hederaRow = (rowCase: string) => HE.fetchPresented.rows.find((r: { case: string }) => r.case === rowCase);
  const hedera = (rowCase: string): HederaReader => {
    const row = hederaRow(rowCase);
    return {
      network: row.readerNetwork ?? HE.fetchPresented.reader,
      transactions: async () => (row.throws === true ? failing() : row.entries),
    };
  };

  const arms: [string, () => Promise<unknown>, string, { status: number; type: string }][] = [
    ["mpp/charge/solana: no transaction at confirmed", () => chargeSolana.fetchPresented(solanaPush, solana(async () => ({ notFound: true as const, slot: null }))), "svm/not-found", internal],
    ["mpp/charge/solana: the read fails", () => chargeSolana.fetchPresented(solanaPush, solana(failing)), "svm/unreadable", internal],
    [
      "mpp/charge/solana: the landed transaction carries an error",
      () => chargeSolana.fetchPresented(solanaPush, solana(async () => solanaLanded(agreed(SO, "svm/err").err))),
      "svm/err",
      verificationFailed,
    ],
    [
      "mpp/charge/solana: a reader of another network",
      () => chargeSolana.fetchPresented(solanaPush, solana(async () => solanaLanded(null), "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")),
      "svm/wrong-reader",
      internal,
    ],
    [
      "mpp/charge/solana: bound on the push credential before fetchPresented",
      () => chargeSolana.bound(pushed(SO, notYetFetched(SO).payload)),
      notYetFetched(SO).expect,
      internal,
    ],
    [
      "mpp/charge/stellar: no transaction",
      () => chargeStellar.fetchPresented(stellarPush, stellar(async () => ({ status: "NOT_FOUND", oldestLedger: 1 }))),
      "stellar/not-found",
      internal,
    ],
    ["mpp/charge/stellar: the read fails", () => chargeStellar.fetchPresented(stellarPush, stellar(failing)), "stellar/unreadable", internal],
    [
      "mpp/charge/stellar: the ledger records the transaction FAILED",
      () => chargeStellar.fetchPresented(stellarPush, stellar(async () => ({ status: "FAILED", envelopeXdr: ST.V3.envelope, ledger: 990, oldestLedger: 1 }))),
      "stellar/tx-failed",
      verificationFailed,
    ],
    [
      "mpp/charge/stellar: a reader of another network",
      () => chargeStellar.fetchPresented(stellarPush, stellar(failing, "stellar:pubnet")),
      "stellar/wrong-reader",
      internal,
    ],
    [
      "mpp/charge/stellar: bound on the push credential before fetchPresented",
      () => chargeStellar.bound({ ...stellarPush, payload: notYetFetched(ST).payload }),
      notYetFetched(ST).expect,
      internal,
    ],
    [
      "mpp/charge/xrpl: no transaction",
      () => chargeXrpl.fetchPresented(xrplPush, xrpl(async () => ({ notFound: true, searchedAll: true }))),
      "xrpl/not-found",
      internal,
    ],
    ["mpp/charge/xrpl: the read fails", () => chargeXrpl.fetchPresented(xrplPush, xrpl(failing)), "xrpl/unreadable", internal],
    [
      "mpp/charge/xrpl: the transaction is not yet in a validated ledger",
      () => chargeXrpl.fetchPresented(xrplPush, xrpl(xrplLanded(false, "tesSUCCESS"))),
      "xrpl/not-validated",
      internal,
    ],
    [
      "mpp/charge/xrpl: the validated result is not tesSUCCESS",
      () => chargeXrpl.fetchPresented(xrplPush, xrpl(xrplLanded(true, agreed(XR, "xrpl/not-success").result))),
      "xrpl/not-success",
      verificationFailed,
    ],
    [
      "mpp/charge/xrpl: a reader of another network",
      () => chargeXrpl.fetchPresented(xrplPush, xrpl(failing, "xrpl:0")),
      "xrpl/wrong-reader",
      internal,
    ],
    [
      "mpp/charge/xrpl: bound on the push credential before fetchPresented",
      () => chargeXrpl.bound(pushed(XR, notYetFetched(XR).payload)),
      notYetFetched(XR).expect,
      internal,
    ],
    [
      "mpp/charge/hedera: the mirror node holds no such transaction",
      () => chargeHedera.fetchPresented(hederaPush, hedera("the mirror node holds no such transaction")),
      hederaRow("the mirror node holds no such transaction").expect,
      internal,
    ],
    [
      "mpp/charge/hedera: the read fails",
      () => chargeHedera.fetchPresented(hederaPush, hedera("the read fails")),
      hederaRow("the read fails").expect,
      internal,
    ],
    [
      "mpp/charge/hedera: a reader of another network",
      () => chargeHedera.fetchPresented(hederaPush, hedera("a reader of another network")),
      hederaRow("a reader of another network").expect,
      internal,
    ],
    [
      "mpp/charge/hedera: the user entry reached consensus without SUCCESS",
      () => chargeHedera.fetchPresented(hederaPush, hedera(HEDERA_FAILED)),
      hederaRow(HEDERA_FAILED).expect,
      verificationFailed,
    ],
    [
      "mpp/charge/hedera: bound on the push credential before fetchPresented",
      () => chargeHedera.bound(hederaPush),
      HE.push.expectWithout,
      internal,
    ],
  ];
  for (const [arm, fetched, code, answer] of arms) {
    it(`${arm}: ${code}, answered ${answer.status}`, async () => {
      const out = (await fetched()) as MppCredential | { refused: true; code: string } | string;
      const refused = typeof out === "object" && out !== null && "refused" in out;
      expect(refused ? [out.code, problem(out.code)] : out).toEqual([code, answer]);
    });
  }
});

// The core draft makes `expires` a SHOULD for servers (draft-httpauth-payment-01 L324), and the charge intent's
// "REQUIRED for blockchain methods" is an example of a method elevating it (draft-payment-intent-charge-00 L143-145).
// A pairing needs it where its build writes it into what the payer signs: the EIP-3009 validBefore, the Permit2
// deadline, the Tempo transaction's validBefore, the Stellar entry's expiration ledger and the session openings'
// deadline; and on NEAR Intents, whose draft says `expires` "MUST be set to the 1Click quote deadline"
// (draft-nearintents-charge-01 L414-415), and on the XRP Ledger charge, whose draft says "The server MUST reject a
// credential whose challenge carries no `expires`" (draft-xrpl-charge-00 L391-392). Without `expires` those pairings
// are left out, and a challenge left with none is mpp/expires-required.
describe("expires: required where a build writes it into what the payer signs", () => {
  const NEEDS = new Set([
    "mpp/charge/evm/authorization",
    "mpp/charge/evm/permit2",
    "mpp/charge/tempo/memo",
    "mpp/charge/tempo/push",
    "mpp/charge/usdc/evm",
    "mpp/charge/stellar",
    "mpp/charge/nearintents",
    "mpp/charge/xrpl",
    "mpp/session/evm",
    "mpp/session/tempo",
  ]);
  const required = { refused: true, code: "mpp/expires-required" };
  const files = [
    "mpp-charge-evm-authorization.json",
    "mpp-charge-hedera.json",
    "mpp-charge-lightning.json",
    "mpp-charge-nearintents.json",
    "mpp-charge-solana.json",
    "mpp-charge-stellar.json",
    "mpp-charge-tempo-memo.json",
    "mpp-charge-tempo-push.json",
    "mpp-charge-usdc-evm.json",
    "mpp-charge-usdc-gateway.json",
    "mpp-charge-usdc-solana.json",
    "mpp-charge-usdc-stacks.json",
    "mpp-charge-xrpl.json",
    "mpp-session-evm.json",
    "mpp-session-hedera-solana-xrpl.json",
    "mpp-session-lightning.json",
    "mpp-session-tempo.json",
    "mpp-subscription-tempo.json",
  ];

  it("each vector file's challenge, without expires, offers its pairings that do not need it", () => {
    for (const file of files) {
      const row = (load(file).buyer.rows as { input: { presented?: { challenge?: MppChallenge } } }[]).find(
        (r) => r.input.presented?.challenge !== undefined,
      )!;
      const { id: _id, opaque: _opaque, ...offer } = row.input.presented!.challenge!;
      const named = pairingsOf(offer) as string[];
      const kept = named.filter((p) => !NEEDS.has(p));
      const { expires: _expires, ...unexpiring } = offer;
      expect([file, pairingsOf(unexpiring)]).toEqual([file, kept.length === 0 ? required : kept]);
      expect([file, pairingsOf({ ...offer, expires: "tomorrow" })]).toEqual([file, required]);
    }
  });

  it("card, Stripe and the EVM transaction and hash charges need none", () => {
    const issued = (method: string, intent: string, request: unknown) => ({ realm, method, intent, request: b64u(JSON.stringify(request)) });
    expect(pairingsOf(issued("card", "charge", load("mpp-charge-card.json").M1.request))).toEqual(["mpp/charge/card"]);
    expect(pairingsOf(issued("stripe", "charge", load("mpp-charge-stripe.json").M2.request))).toEqual(["mpp/charge/stripe"]);
    expect(pairingsOf(issued("stripe", "subscription", load("mpp-subscription-stripe.json").S1.request))).toEqual([
      "mpp/subscription/stripe",
    ]);
    const { expires: _expires, ...evm } = challenge("evm", "charge", load("mpp-charge-evm-transaction.json").fixed.R_ENoTypes);
    expect(pairingsOf(evm)).toEqual(["mpp/charge/evm/transaction", "mpp/charge/evm/hash"]);
  });

  it("pairingsOf, advertise and build read alike: a pairing that needs expires is left out without it", async () => {
    const r = JSON.parse(V.fixed.R_E);
    const mixed = challenge("evm", "charge", JSON.stringify({ ...r, methodDetails: { ...r.methodDetails, credentialTypes: ["authorization", "transaction"] } }));
    const { expires: _expires, ...offer } = mixed;
    expect(pairingsOf(offer)).toEqual(["mpp/charge/evm/transaction"]);
    expect(evmAuthorization.advertise([offer], H, link, offer)).toEqual({ refused: true, code: "mpp/not-this-pairing" });
    const placed = evmTransaction.advertise([offer], H, link, offer) as (MppChallenge & { id: string })[];
    expect(placed[0]!.expires).toBeUndefined();
    const from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
    const tokenDomain = { name: "USD Coin", version: "2" };
    expect(await evmAuthorization.build({ challenge: placed[0]!, from, now: 0, tokenDomain }, H)).toEqual({
      refused: true,
      code: "mpp/not-this-pairing",
    });
    expect(await evmTransaction.build({ challenge: placed[0]!, from, now: 0 }, H)).toMatchObject({ request: { kind: "evm-call" } });
    const { expires: _e, ...both } = C_E;
    expect(place([both], H, link, both)).toEqual(required);
    const { expires: _placedExpires, ...unexpired } = (place([C_E], H, link, C_E) as (MppChallenge & { id: string })[])[0]!;
    expect(await evmAuthorization.build({ challenge: unexpired, from, now: 0, tokenDomain }, H)).toEqual(required);
  });
});
