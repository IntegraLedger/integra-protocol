// MPP_BINDINGS lists every MPP pairing, the two Lightning pairings among them, and every pairing's reference is plain JSON.
import { describe, expect, it } from "vitest";
import { concat, keccak256, toBytes, toHex, toRlp } from "viem";
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
  chargeNearIntents,
  chargeStripe,
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  chargeUsdcStacks,
  subscriptionStripe,
  chargeSolana,
  chargeXrpl,
  sessionXrpl,
  type MppChallenge,
  type MppCredential,
  type SessionUnsigned,
} from "../src/mpp.js";
import { chargeLightning, sessionLightning } from "../src/lightning.js";
import type { KeyAuthorizationUnsigned } from "../src/tempo.js";
import { createHash } from "node:crypto";
import { pairingsOf } from "../src/mpp.js";
import { C_E, H, V, b64u, challenge, link, load } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

const A = load("mpp-charge-evm-authorization.json");
const M = load("mpp-charge-tempo-memo.json");
const E = load("mpp-session-evm.json");
const T = load("mpp-session-tempo.json");
const U = load("mpp-subscription-tempo.json");
const SR = load("mpp-session-hedera-solana-xrpl.json");
const UE = load("mpp-charge-usdc-evm.json");
const UG = load("mpp-charge-usdc-gateway.json");
const US = load("mpp-charge-usdc-stacks.json");
const placed = (c: MppChallenge) =>
  (place([c], H, link, c, c.intent === "subscription" && c.method === "tempo" ? null : 0) as MppChallenge[])[0] as MppChallenge & { id: string };
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
      "mpp/session/evm",
      "mpp/session/tempo",
      "mpp/subscription/tempo",
      "mpp/charge/lightning",
      "mpp/session/lightning",
      "mpp/charge/solana",
      "mpp/charge/xrpl",
      "mpp/charge/nearintents",
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
              sessionEvm,
      sessionTempo,
      subscriptionTempo,
      chargeLightning,
      sessionLightning,
          chargeSolana,
          chargeXrpl,
      chargeNearIntents,
              sessionXrpl,
      chargeCard,
      chargeStripe,
      subscriptionStripe,
      chargeUsdcEvm,
      chargeUsdcSolana,
      chargeUsdcStacks,
      chargeUsdcGateway,
    ]);
    for (const b of rowsOf(MPP_BINDINGS, "MPP_BINDINGS, the MPP pairings", { exact: 20 })) {
      expect(Object.isFrozen(b)).toBe(true);
      expect(Object.isFrozen(b.pattern)).toBe(true);
    }
  });

  it("every pairing's reference survives JSON unchanged", async () => {
    const refs: unknown[] = [];
    /** A pairing's `reference` of a credential, with the challenge it echoes as the option the payment answers. */
    const issued = <C extends MppCredential>(reference: (c: C, option: MppChallenge) => Promise<unknown>, c: C) => reference(c, c.challenge);
    const chE = placed(C_E);
    const auth = await evmAuthorization.build({ challenge: chE, from: A.fixed.payer, now: 0, tokenDomain: A.fixed.tokenDomain }, H);
    if ("refused" in auth) throw new Error(auth.code);
    refs.push(await issued(evmAuthorization.reference, auth.complete(A.MV5.expectSignature) as MppCredential));
    const p2 = await evmPermit2.build({ challenge: chE, from: A.fixed.payer, now: 0, spender: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }, H);
    if ("refused" in p2) throw new Error(p2.code);
    refs.push(await issued(evmPermit2.reference, p2.complete(A.MV5.expectSignature) as MppCredential));
    const chEH = challenge("evm", "charge", load("mpp-charge-evm-transaction.json").fixed.R_ENoTypes);
    refs.push(await issued(evmTransaction.reference, { challenge: chEH, source: A.MV5.expectSource } as MppCredential));
    refs.push(await issued(evmHash.reference, { challenge: chEH, source: A.MV5.expectSource } as MppCredential));
    const chES = placed(challenge("evm", "session", E.fixed.request));
    const s = (await sessionEvm.build(
      { challenge: chES, from: E.fixed.payer, now: 0, deposit: 5000000n, credentialType: "authorization", tokenDomain: E.fixed.tokenDomain },
      H,
    )) as SessionUnsigned;
    const fundSig = await payer.signTypedData((s.funding as unknown as { typedData: never }).typedData);
    refs.push(await issued(sessionEvm.reference, s.complete(fundSig, fundSig) as MppCredential));
    const chTS = placed(challenge("tempo", "session", T.fixed.requestV2));
    const st = (await sessionTempo.build({ challenge: chTS, from: T.fixed.payer, now: 0, deposit: 10000000n }, H)) as SessionUnsigned;
    const call = (st.funding as { call: { data: `0x${string}` } }).call.data;
    const fields = ["0xa5bf", "0x01", "0x02", "0x030d40", [[T.fixed.escrowV2, "0x", call]], [], toHex((1n << 256n) - 1n), "0x", "0x6ab05f3c", "0x", T.fixed.pathUSD, "0x", []];
    const tx = toHex(toBytes(concat(["0x76", toRlp([...fields, await sig65(keccak256(concat(["0x76", toRlp(fields as never)])))] as never)])));
    refs.push(await issued(sessionTempo.reference, st.complete(tx, `0x${"66".repeat(65)}`) as MppCredential));
    const chSub = placed(challenge("tempo", "subscription", U.fixed.request));
    const sub = (await subscriptionTempo.build({ challenge: chSub, from: U.fixed.payer, now: 0 }, H)) as KeyAuthorizationUnsigned;
    refs.push(await issued(subscriptionTempo.reference, sub.complete(await sig65(sub.request.digest)) as MppCredential));

    expect(refs.length).toBe(7);
    for (const r of rowsOf(refs, "the references the seven pairings above build", { exact: 7 })) {
      expect(r).not.toHaveProperty("refused");
      expect(roundTrip(r)).toEqual(r);
    }
  });
});

describe("mpp-challenge.json agreedRefusals, the rows the pairings apply", () => {
  it("each code as recorded", async () => {
    const call = [M.fixed.pathUSD, "0x", M.MV7.expectCalldata];
    const twice = concat([
      "0x76",
      toRlp(["0xa5bf", "0x01", "0x02", "0x0186a0", [call, call], [], "0x", "0x", "0x6ab05f3c", "0x", M.fixed.pathUSD, "0x", [], `0x${"11".repeat(65)}`] as never),
    ]);
    const { memoCalldata, tempoChannelId, expiringNonceHash } = await import("../src/tempo.js");
    expect(memoCalldata("0x12", 1n, M.MV7.expectMemo)).toEqual({ refused: true, code: "tempo/tx-malformed" });
    expect(tempoChannelId({} as never)).toEqual({ refused: true, code: "tempo/descriptor-mismatch" });
    expect(expiringNonceHash(toBytes(twice), "0x12")).toEqual({ refused: true, code: "tempo/tx-malformed" });

    const chE = placed(C_E);
    const calls = challenge("evm", "charge", load("mpp-charge-evm-transaction.json").fixed.R_ENoTypes);
    const second = (place([C_E, calls], H, link + "?other", calls, 0) as MppChallenge[])[1]!;
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
  type Advertise = (d: readonly MppChallenge[], h: string, l: string, o: MppChallenge, p: number | null, a?: string) => MppChallenge[] | { refused: true };
  const advertiseOf = (b: { advertise: unknown }) => b.advertise as Advertise;
  const sha256 = (s: string) => "0x" + createHash("sha256").update(s).digest("hex");

  it("two pairings of one challenge place equal lists, in either order", () => {
    expect(pairingsOf(mixed)).toEqual(["mpp/charge/evm/permit2", "mpp/charge/evm/transaction"]);
    const byPermit2 = advertiseOf(evmPermit2)([mixed], H, link, mixed, 0, agreement);
    const byTransaction = advertiseOf(evmTransaction)([mixed], H, link, mixed, 0, agreement) as MppChallenge[];
    expect(byPermit2).toEqual(byTransaction);
    expect(advertiseOf(evmPermit2)(byTransaction, H, link, mixed, 0, agreement)).toEqual(byTransaction);
    expect(advertiseOf(evmTransaction)(byPermit2 as MppChallenge[], H, link, mixed, 0, agreement)).toEqual(byTransaction);
  });

  it("each pairing's opaque carries the agreement URL: MV14's opaque, whatever the request", () => {
    const issued: MppChallenge[] = [
      C_E,
      mixed,
      challenge("evm", "charge", load("mpp-charge-evm-transaction.json").fixed.R_ENoTypes),
      challenge("evm", "session", E.fixed.request),
      challenge("tempo", "session", T.fixed.requestV2),
      challenge("tempo", "subscription", U.fixed.request),
      SR.SS1.xrpl.challenge,
      challenge("usdc", "charge", UE.M3.requestJson),
      challenge("usdc", "charge", UG.M5.requestJson),
      { ...challenge("usdc", "charge", "{}"), request: b64u(JSON.stringify(US.fixed.request)) },
    ];
    const placedBy = new Set<string>();
    for (const b of rowsOf(MPP_BINDINGS, "MPP_BINDINGS, the MPP pairings", { exact: 20 })) {
      for (const option of issued) {
        const offered = pairingsOf(option);
        if (!Array.isArray(offered) || !offered.includes(b.id as never)) continue;
        const out = advertiseOf(b)([option], H, link, option, b.id === "mpp/subscription/tempo" ? null : 0, agreement);
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
        "mpp/session/evm",
        "mpp/session/tempo",
        "mpp/subscription/tempo",
        "mpp/session/xrpl",
        "mpp/charge/usdc/evm",
        "mpp/charge/usdc/gateway",
        "mpp/charge/usdc/stacks",
      ].sort(),
    );
  });
});
