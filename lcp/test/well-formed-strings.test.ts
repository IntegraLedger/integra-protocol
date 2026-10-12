// A string holding a lone surrogate has no UTF-8 form: UTF-8 encodes no surrogate code point (The Unicode Standard
// 16.0, section 3.9, D92), and Python 3's "\ud800".encode("utf-8") raises UnicodeEncodeError. TextEncoder writes
// U+FFFD (EF BF BD) in its place (WHATWG Encoding, "UTF-8 encode" over a scalar value string), so a hash or signature
// over its UTF-8 covers bytes the caller did not write. Where the package encodes a caller's string to sign or hash
// it, it refuses such a string, with the code the step already gives for that input (`usdcNonce`'s
// mpp/challenge-malformed for a challenge, the builders' input codes), or, for a writer, throws TypeError. The same
// string with U+FFFD, which is well-formed, is the control: it is read and built as before.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chargeHedera } from "../src/hedera.js";
import {
  attributionMemo,
  challengeHash,
  evmAuthorization,
  pairingsOf,
  place,
  tempoMemo,
  tempoPush,
  usdcNonce,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { buildChannelMessage, buildSvmMessage, sessionProof, type ChannelBuildInput, type SvmBuildInput } from "../src/svm.js";
import { H, V, b64u, link, load, realm } from "./mpp-fixtures.js";

const LONE = "\uD800";
const FFFD = "�";
const A = load("mpp-charge-evm-authorization.json");
const HD = load("mpp-charge-hedera.json");
const PU = load("mpp-charge-tempo-push.json");
const B = load("x402-batch-settlement.json");
const refused = (code: string) => ({ refused: true, code });
const issued = (r: string, method = "evm", request = V.fixed.R_E): MppChallenge => ({
  realm: r,
  method,
  intent: "charge",
  request: b64u(request),
  expires: V.fixed.expires,
});
const placed = (c: MppChallenge) => (place([c], H, link, c) as MppChallenge[])[0] as MppChallenge & { id: string };

it("the strings: one is not well-formed, and TextEncoder writes it as the other", () => {
  expect((realm + LONE).isWellFormed()).toBe(false);
  expect((realm + FFFD).isWellFormed()).toBe(true);
  expect(new TextEncoder().encode(realm + LONE)).toEqual(new TextEncoder().encode(realm + FFFD));
  expect(Buffer.from(new TextEncoder().encode(FFFD)).toString("hex")).toBe("efbfbd");
});

describe("MPP: a challenge's realm and id, and the payer's client id", () => {
  it("a challenge whose realm is not well-formed is mpp/challenge-malformed, the code usdcNonce gives", () => {
    expect(usdcNonce("i", realm + LONE, `0x${"00".repeat(32)}`)).toEqual(refused("mpp/challenge-malformed"));
    expect(pairingsOf(issued(realm + LONE))).toEqual(refused("mpp/challenge-malformed"));
    // An issued id is never hashed: place writes H's id in its place.
    expect(pairingsOf({ ...issued(realm), id: `x${LONE}` })).toEqual(pairingsOf(issued(realm)));
    expect(placed({ ...issued(realm), id: `x${LONE}` }).id).toBe(placed(issued(realm)).id);
    expect(place([issued(realm + LONE)], H, link, issued(realm + LONE))).toEqual(refused("mpp/challenge-malformed"));
    expect(pairingsOf(issued(realm + FFFD))).toEqual(pairingsOf(issued(realm)));
  });

  it("build refuses a chosen challenge with such a realm; bound refuses an echoed one", async () => {
    const ok = placed(issued(realm + FFFD));
    const choice = (challenge: MppChallenge & { id: string }) => ({
      challenge,
      from: A.fixed.payer,
      now: A.fixed.now,
      tokenDomain: A.fixed.tokenDomain,
    });
    const lone = { ...ok, realm: realm + LONE };
    expect(await evmAuthorization.build(choice(lone), H)).toEqual(refused("mpp/challenge-malformed"));
    const u = await evmAuthorization.build(choice(ok), H);
    if ("refused" in u) throw new Error(u.code);
    const cred = u.complete(`0x${"11".repeat(65)}`) as MppCredential;
    expect(cred.payload["nonce"]).toBe(challengeHash(ok.id, realm + FFFD));
    expect(challengeHash(ok.id, realm + LONE)).toBe(challengeHash(ok.id, realm + FFFD));
    expect(await evmAuthorization.bound(cred)).toBe(H);
    expect(await evmAuthorization.bound({ ...cred, challenge: { ...cred.challenge, realm: realm + LONE } })).toEqual(
      refused("mpp/challenge-malformed"),
    );
    // An echoed id is hashed only once H is read from it, and an id with a lone surrogate is no base64url of H.
    expect(await evmAuthorization.bound({ ...cred, challenge: { ...cred.challenge, id: ok.id + LONE } })).toEqual(
      refused("mpp/id-not-ours"),
    );
  });

  it("the Tempo builds refuse a client id that is not well-formed: mpp/input-malformed", async () => {
    const memo = placed(issued(realm, "tempo", V.fixed.R_T));
    const push = placed(issued(realm, "tempo", PU.fixed.R_TNoModes));
    expect(attributionMemo(realm, memo.id, `c${LONE}`)).toBe(attributionMemo(realm, memo.id, `c${FFFD}`));
    for (const [build, ch] of [
      [tempoMemo.build, memo],
      [tempoPush.build, push],
    ] as const) {
      const at = (clientId: string) => ({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, clientId });
      expect(await build(at(`c${LONE}`), H)).toEqual(refused("mpp/input-malformed"));
      expect("refused" in (await build(at(`c${FFFD}`), H))).toBe(false);
    }
  });

  it("the Hedera charge build refuses such a realm or id (mpp/challenge-malformed) and client id (hedera/option-malformed)", async () => {
    const build = (challenge: { id: string; realm: string }, clientId?: string) =>
      chargeHedera.build(challenge, HD.fixed.request, {
        payer: HD.fixed.payer,
        node: HD.fixed.node,
        validStart: { seconds: BigInt(HD.fixed.validStart.seconds), nanos: HD.fixed.validStart.nanos },
        maxFee: BigInt(HD.fixed.maxFee),
        ...(clientId === undefined ? {} : { clientId }),
      });
    const id = HD.fixed.challengeId as string;
    const r = HD.fixed.realm as string;
    expect(await build({ id, realm: r + LONE })).toEqual(refused("mpp/challenge-malformed"));
    expect(await build({ id: id + LONE, realm: r })).toEqual(refused("mpp/challenge-malformed"));
    expect(await build({ id, realm: r }, `c${LONE}`)).toEqual(refused("hedera/option-malformed"));
    expect("refused" in (await build({ id, realm: r + FFFD }))).toBe(false);
    expect("refused" in (await build({ id, realm: r }, `c${FFFD}`))).toBe(false);
  });
});

describe("Solana: the message builders refuse a memo that is not well-formed: svm/input-malformed", () => {
  const S = B.fixed.svm;
  const tokenProgram = B.ES4.accepted.extra.tokenProgram as string;

  it("buildSvmMessage", async () => {
    const i = (memo: string): SvmBuildInput => ({
      feePayer: S.feePayer,
      payer: S.payer,
      mint: S.mint,
      tokenProgram,
      decimals: 6,
      payTo: S.payTo,
      amount: 1000n,
      recentBlockhash: S.blockhash,
      memo,
      computeUnitLimit: 200_000,
      computeUnitPrice: 1n,
    });
    expect(await buildSvmMessage(i(`m${LONE}`))).toEqual(refused("svm/input-malformed"));
    expect(await buildSvmMessage(i(`m${FFFD}`))).toBeInstanceOf(Uint8Array);
  });

  it("buildChannelMessage", async () => {
    const i = (memo: string): ChannelBuildInput => ({
      feePayer: S.feePayer,
      payer: S.payer,
      mint: S.mint,
      tokenProgram,
      recentBlockhash: S.blockhash,
      memo,
      computeUnitLimit: 200_000,
      computeUnitPrice: 1n,
      instruction: { kind: "request_close", channel: B.ES1.channelPda },
    });
    expect(await buildChannelMessage(i(`m${LONE}`))).toEqual(refused("svm/input-malformed"));
    expect(await buildChannelMessage(i(`m${FFFD}`))).toBeInstanceOf(Uint8Array);
  });
});

describe("sessionProof throws TypeError for a string that is not well-formed, and never returns the empty message", () => {
  const base = { channelId: "C", payer: "P", challengeId: "x" };
  for (const k of ["channelId", "payer", "challengeId"] as const) {
    it(k, () => {
      expect(() => sessionProof({ ...base, [k]: `x${LONE}` })).toThrow(TypeError);
      expect(() => sessionProof({ ...base, [k]: 5 } as never)).toThrow(TypeError);
      const proof = new TextDecoder().decode(sessionProof({ ...base, [k]: `x${FFFD}` }));
      expect(JSON.parse(proof)[k === "challengeId" ? "sessionChallengeId" : k]).toBe(`x${FFFD}`);
    });
  }
  it("a null or missing argument", () => {
    expect(() => sessionProof(null as never)).toThrow(TypeError);
    expect(() => sessionProof(undefined as never)).toThrow(TypeError);
  });
});

it("the vectors' row reads the memo the file writes", () => {
  const text = readFileSync(new URL("../vectors/x402-batch-settlement.json", import.meta.url), "utf8");
  expect(text).toContain('"memo": "lcp:\\ud800"');
  expect(B.ES6.loneSurrogateMemo.memo).toBe(`lcp:${LONE}`);
});
