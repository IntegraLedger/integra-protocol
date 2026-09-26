// MPP_BINDINGS lists the nine MPP charge and session pairings and the two Lightning pairings, and every pairing's reference is plain JSON.
import { describe, expect, it } from "vitest";
import { concat, toBytes, toHex, toRlp } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import {
  MPP_BINDINGS,
  evmAuthorization,
  evmHash,
  evmPermit2,
  evmTransaction,
  place,
  sessionEvm,
  sessionTempo,
  subscriptionTempo,
  chargeCard,
  chargeHedera,
  chargeNearIntents,
  chargeStripe,
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  chargeUsdcStacks,
  subscriptionStripe,
  chargeSolana,
  chargeStellar,
  chargeXrpl,
  sessionHedera,
  sessionSolana,
  sessionXrpl,
  tempoMemo,
  tempoPush,
  type MppChallenge,
  type MppCredential,
  type SessionUnsigned,
} from "../src/mpp.js";
import { chargeLightning, sessionLightning } from "../src/lightning.js";
import type { KeyAuthorizationUnsigned } from "../src/tempo.js";
import { createHash } from "node:crypto";
import { pairingsOf } from "../src/mpp.js";
import { C_E, C_T, H, V, b64u, challenge, link, load, readerFor } from "./mpp-fixtures.js";

const A = load("mpp-charge-evm-authorization.json");
const M = load("mpp-charge-tempo-memo.json");
const PU = load("mpp-charge-tempo-push.json");
const E = load("mpp-session-evm.json");
const T = load("mpp-session-tempo.json");
const U = load("mpp-subscription-tempo.json");
const SR = load("mpp-session-hedera-solana-xrpl.json");
const UE = load("mpp-charge-usdc-evm.json");
const UG = load("mpp-charge-usdc-gateway.json");
const US = load("mpp-charge-usdc-stacks.json");
const placed = (c: MppChallenge) => (place([c], H, link, c) as MppChallenge[])[0] as MppChallenge & { id: string };
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));
const payer = privateKeyToAccount(A.fixed.payerKey);
const sig65 = async (hash: `0x${string}`) => {
  const s = await sign({ hash, privateKey: A.fixed.payerKey });
  return concat([s.r, s.s, toHex(Number(s.v), { size: 1 })]);
};

describe("MPP_BINDINGS", () => {
  it("lists exactly the implemented MPP pairings", () => {
    expect(MPP_BINDINGS.map((b) => b.id)).toEqual([
      "mpp/charge/evm/authorization",
      "mpp/charge/evm/permit2",
      "mpp/charge/evm/transaction",
      "mpp/charge/evm/hash",
      "mpp/charge/tempo/memo",
      "mpp/charge/tempo/push",
      "mpp/session/evm",
      "mpp/session/tempo",
      "mpp/subscription/tempo",
      "mpp/charge/lightning",
      "mpp/session/lightning",
      "mpp/charge/hedera",
      "mpp/charge/solana",
      "mpp/charge/stellar",
      "mpp/charge/xrpl",
      "mpp/charge/nearintents",
      "mpp/session/hedera",
      "mpp/session/solana",
      "mpp/session/xrpl",
      "mpp/charge/card",
      "mpp/charge/stripe",
      "mpp/subscription/stripe",
      "mpp/charge/usdc/evm",
      "mpp/charge/usdc/solana",
      "mpp/charge/usdc/stacks",
      "mpp/charge/usdc/gateway",
    ]);
    expect(MPP_BINDINGS).toEqual([
      evmAuthorization,
      evmPermit2,
      evmTransaction,
      evmHash,
      tempoMemo,
      tempoPush,
      sessionEvm,
      sessionTempo,
      subscriptionTempo,
      chargeLightning,
      sessionLightning,
      chargeHedera,
      chargeSolana,
      chargeStellar,
      chargeXrpl,
      chargeNearIntents,
      sessionHedera,
      sessionSolana,
      sessionXrpl,
      chargeCard,
      chargeStripe,
      subscriptionStripe,
      chargeUsdcEvm,
      chargeUsdcSolana,
      chargeUsdcStacks,
      chargeUsdcGateway,
    ]);
    for (const b of MPP_BINDINGS) {
      expect(Object.isFrozen(b)).toBe(true);
      expect(Object.isFrozen(b.pattern)).toBe(true);
    }
  });

  it("every pairing's reference survives JSON unchanged", async () => {
    const refs: unknown[] = [];
    const chE = placed(C_E);
    const auth = await evmAuthorization.build({ challenge: chE, from: A.fixed.payer, now: 0, tokenDomain: A.fixed.tokenDomain }, H);
    if ("refused" in auth) throw new Error(auth.code);
    refs.push(await evmAuthorization.reference(auth.complete(A.MV5.expectSignature) as MppCredential));
    const p2 = await evmPermit2.build({ challenge: chE, from: A.fixed.payer, now: 0, spender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }, H);
    if ("refused" in p2) throw new Error(p2.code);
    refs.push(await evmPermit2.reference(p2.complete(A.MV5.expectSignature) as MppCredential));
    refs.push(await evmTransaction.reference({ challenge: C_E } as MppCredential));
    refs.push(await evmHash.reference({ challenge: C_E } as MppCredential));
    const chT = placed(C_T);
    const wire = concat([
      "0x76",
      toRlp(["0xa5bf", "0x01", "0x02", "0x0186a0", [[M.fixed.pathUSD, "0x", M.MV7.expectCalldata]], [], "0x", "0x", "0x6ab05f3c", "0x", M.fixed.pathUSD, "0x", [], `0x${"11".repeat(65)}`] as never),
    ]);
    refs.push(await tempoMemo.reference({ challenge: chT, payload: { type: "transaction", signature: wire } }));
    const chP = placed(challenge("tempo", "charge", PU.fixed.R_TNoModes));
    const landed = await tempoPush.fetchPresented(
      { challenge: chP, payload: { type: "hash", hash: PU.MV13.T_P } },
      readerFor("eip155:42431", PU.MV13.receipt),
    );
    refs.push(await tempoPush.reference(landed as MppCredential));

    const chES = placed(challenge("evm", "session", E.fixed.request));
    const s = (await sessionEvm.build(
      { challenge: chES, from: E.fixed.payer, now: 0, deposit: 5000000n, credentialType: "authorization", tokenDomain: E.fixed.tokenDomain },
      H,
    )) as SessionUnsigned;
    const fundSig = await payer.signTypedData((s.funding as unknown as { typedData: never }).typedData);
    refs.push(await sessionEvm.reference(s.complete(fundSig, fundSig) as MppCredential));
    const chTS = placed(challenge("tempo", "session", T.fixed.requestV2));
    const st = (await sessionTempo.build({ challenge: chTS, from: T.fixed.payer, now: 0, deposit: 10000000n }, H)) as SessionUnsigned;
    const call = (st.funding as { call: { data: `0x${string}` } }).call.data;
    const fields = ["0xa5bf", "0x01", "0x02", "0x030d40", [[T.fixed.escrowV2, "0x", call]], [], toHex((1n << 256n) - 1n), "0x", "0x6ab05f3c", "0x", T.fixed.pathUSD, "0x", []];
    const tx = toHex(toBytes(concat(["0x76", toRlp([...fields, `0x${"11".repeat(65)}`] as never)])));
    refs.push(await sessionTempo.reference(st.complete(tx, `0x${"66".repeat(65)}`) as MppCredential));
    const chSub = placed(challenge("tempo", "subscription", U.fixed.request));
    const sub = (await subscriptionTempo.build({ challenge: chSub, from: U.fixed.payer, now: 0 }, H)) as KeyAuthorizationUnsigned;
    refs.push(await subscriptionTempo.reference(sub.complete(await sig65(sub.request.digest)) as MppCredential));

    expect(refs.length).toBe(9);
    for (const r of refs) {
      expect(r).not.toHaveProperty("refused");
      expect(roundTrip(r)).toEqual(r);
    }
  });
});

describe("mpp-challenge.json agreedRefusals, the rows the pairings apply", () => {
  it("each code as recorded", async () => {
    const chT = placed(C_T);
    const call = [M.fixed.pathUSD, "0x", M.MV7.expectCalldata];
    const twice = concat([
      "0x76",
      toRlp(["0xa5bf", "0x01", "0x02", "0x0186a0", [call, call], [], "0x", "0x", "0x6ab05f3c", "0x", M.fixed.pathUSD, "0x", [], `0x${"11".repeat(65)}`] as never),
    ]);
    expect(await tempoMemo.bound({ challenge: chT, payload: { type: "transaction", signature: twice } })).toEqual({
      refused: true,
      code: "tempo/ambiguous",
    });
    const { memoCalldata, tempoChannelId, expiringNonceHash } = await import("../src/tempo.js");
    expect(memoCalldata("0x12", 1n, M.MV7.expectMemo)).toEqual({ refused: true, code: "tempo/tx-malformed" });
    expect(tempoChannelId({} as never)).toEqual({ refused: true, code: "tempo/descriptor-mismatch" });
    expect(expiringNonceHash(toBytes(twice), "0x12")).toEqual({ refused: true, code: "tempo/tx-malformed" });

    const chE = placed(C_E);
    const second = (place([C_E, C_T], H, link + "?other", C_T) as MppChallenge[])[1]!;
    const { read } = await import("../src/mpp.js");
    expect(read([chE, second])).toEqual({ refused: true, code: "mpp/legal-context-conflict" });

    const auth = await evmAuthorization.build({ challenge: chE, from: A.fixed.payer, now: 0, tokenDomain: A.fixed.tokenDomain }, H);
    if ("refused" in auth) throw new Error(auth.code);
    const cred = auth.complete(A.MV5.expectSignature) as MppCredential;
    expect(await evmAuthorization.bound({ ...cred, payload: { ...cred.payload, pad: "x".repeat(70_000) } })).toEqual({
      refused: true,
      code: "mpp/credential-malformed",
    });
    let deep: unknown = "x";
    for (let i = 0; i < 20; i++) deep = [deep];
    expect(await evmAuthorization.bound({ ...cred, payload: { ...cred.payload, deep: deep as never } })).toEqual({
      refused: true,
      code: "mpp/credential-malformed",
    });
    expect(await evmAuthorization.bound({ challenge: chE } as MppCredential)).toEqual({ refused: true, code: "mpp/credential-malformed" });
    expect(await evmAuthorization.build({ challenge: chE, from: "0x12" as never, now: 0, tokenDomain: A.fixed.tokenDomain }, H)).toEqual({
      refused: true,
      code: "mpp/input-malformed",
    });
    const push = await tempoPush.build({ challenge: placed(challenge("tempo", "charge", PU.fixed.R_TNoModes)), from: A.fixed.payer, now: 0 }, H);
    if ("refused" in push) throw new Error(push.code);
    expect(push.complete("0x1234")).toEqual({ refused: true, code: "mpp/credential-malformed" });
    expect(await tempoMemo.bound({ challenge: chT, payload: { type: "hash", hash: PU.MV13.T_P } })).toEqual({
      refused: true,
      code: "mpp/credential-type",
    });

    const { pairingsOf } = await import("../src/mpp.js");
    const noChain = JSON.parse(E.fixed.request);
    delete noChain.methodDetails.chainId;
    expect(pairingsOf(challenge("evm", "session", JSON.stringify(noChain)))).toEqual({ refused: true, code: "mpp/chain-id-required" });
    const month = JSON.parse(U.fixed.request);
    month.periodUnit = "month";
    expect(pairingsOf(challenge("tempo", "subscription", JSON.stringify(month)))).toEqual({ refused: true, code: "mpp/request-malformed" });
  });
});

describe("the agreement URL, placed by every pairing of one challenge", () => {
  /** One challenge offering `permit2` (a public proof) and `transaction` (none), on MPP's EVM charge request. */
  const mixed = challenge(
    "evm",
    "charge",
    JSON.stringify({ ...JSON.parse(V.fixed.R_E), methodDetails: { ...JSON.parse(V.fixed.R_E).methodDetails, credentialTypes: ["permit2", "transaction"] } }),
  );
  const agreement = V.fixed.agreementUrl as string;
  type Advertise = (d: readonly MppChallenge[], h: string, l: string, o: MppChallenge, a?: string) => MppChallenge[] | { refused: true };
  const advertiseOf = (b: { advertise: unknown }) => b.advertise as Advertise;
  const sha256 = (s: string) => "0x" + createHash("sha256").update(s).digest("hex");

  it("two pairings of one challenge place equal lists, in either order", () => {
    expect(pairingsOf(mixed)).toEqual(["mpp/charge/evm/permit2", "mpp/charge/evm/transaction"]);
    const byPermit2 = advertiseOf(evmPermit2)([mixed], H, link, mixed, agreement);
    const byTransaction = advertiseOf(evmTransaction)([mixed], H, link, mixed, agreement) as MppChallenge[];
    expect(byPermit2).toEqual(byTransaction);
    expect(advertiseOf(evmPermit2)(byTransaction, H, link, mixed, agreement)).toEqual(byTransaction);
    expect(advertiseOf(evmTransaction)(byPermit2 as MppChallenge[], H, link, mixed, agreement)).toEqual(byTransaction);
  });

  it("each pairing's opaque carries the agreement URL: MV14's opaque, whatever the request", () => {
    const issued: MppChallenge[] = [
      C_E,
      mixed,
      challenge("evm", "charge", load("mpp-charge-evm-transaction.json").fixed.R_ENoTypes),
      C_T,
      challenge("tempo", "charge", PU.fixed.R_TNoModes),
      challenge("evm", "session", E.fixed.request),
      challenge("tempo", "session", T.fixed.requestV2),
      challenge("tempo", "subscription", U.fixed.request),
      SR.SS1.hedera.challenge,
      SR.SS1.solana.challenge,
      SR.SS1.xrpl.challenge,
      challenge("usdc", "charge", UE.M3.requestJson),
      challenge("usdc", "charge", UG.M5.requestJson),
      { ...challenge("usdc", "charge", "{}"), request: b64u(JSON.stringify(US.fixed.request)) },
    ];
    const placedBy = new Set<string>();
    for (const b of MPP_BINDINGS) {
      for (const option of issued) {
        const offered = pairingsOf(option);
        if (!Array.isArray(offered) || !offered.includes(b.id as never)) continue;
        const out = advertiseOf(b)([option], H, link, option, agreement);
        if (!Array.isArray(out)) throw new Error(`${b.id}: ${JSON.stringify(out)}`);
        expect(out[0]!.opaque!.length).toBe(V.MV14.expectOpaqueLength);
        expect(sha256(out[0]!.opaque!)).toBe(V.MV14.expectOpaqueSha256);
        placedBy.add(b.id);
      }
    }
    expect([...placedBy].sort()).toEqual(
      [
        "mpp/charge/evm/authorization",
        "mpp/charge/evm/permit2",
        "mpp/charge/evm/transaction",
        "mpp/charge/evm/hash",
        "mpp/charge/tempo/memo",
        "mpp/charge/tempo/push",
        "mpp/session/evm",
        "mpp/session/tempo",
        "mpp/subscription/tempo",
        "mpp/session/hedera",
        "mpp/session/solana",
        "mpp/session/xrpl",
        "mpp/charge/usdc/evm",
        "mpp/charge/usdc/gateway",
        "mpp/charge/usdc/stacks",
      ].sort(),
    );
  });
});
