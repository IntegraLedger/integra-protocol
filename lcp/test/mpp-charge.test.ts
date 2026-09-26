// The six MPP charge pairings against their vector files. Every expected value is the files';
// viem 2.56.8 is the independent tool for EIP-712, signatures, RLP and keccak.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  concat,
  domainSeparator,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  toHex,
  toRlp,
  type Hex as ViemHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TRANSFER_TOPIC, type EvmLog, type EvmRef, type Permit2TypedData } from "../src/evm.js";
import {
  attributionMemo,
  challengeHash,
  challengeId,
  checkAttribution,
  evmAuthorization,
  evmHash,
  evmPermit2,
  evmTransaction,
  pairingsOf,
  place,
  tempoMemo,
  tempoPush,
  type LandedCredential,
  type MppChallenge,
  type MppCredential,
  type MppUnsigned,
} from "../src/mpp.js";
import { TRANSFER_WITH_MEMO_SELECTOR, TRANSFER_WITH_MEMO_TOPIC, decodeTempoTx, memoCalldata } from "../src/tempo.js";
import { C_E, C_T, H, challenge, link, load, readerFor, realm, topicOf, withBigints, wordOf } from "./mpp-fixtures.js";

const A = load("mpp-charge-evm-authorization.json");
const P = load("mpp-charge-evm-permit2.json");
const TX = load("mpp-charge-evm-transaction.json");
const HS = load("mpp-charge-evm-hash.json");
const M = load("mpp-charge-tempo-memo.json");
const PU = load("mpp-charge-tempo-push.json");

const sha256 = (b: Uint8Array) => "0x" + createHash("sha256").update(b).digest("hex");
const forViem = (td: unknown) => td as Parameters<typeof hashTypedData>[0];
const payer = privateKeyToAccount(A.fixed.payerKey);
const affix = (v: string, e: { prefix: string; suffix: string }) => {
  expect(v.startsWith(e.prefix)).toBe(true);
  expect(v.endsWith(e.suffix)).toBe(true);
};
const placedOf = (c: MppChallenge) => (place([c], H, link, c) as MppChallenge[])[0] as MppChallenge & { id: string };
const eip712 = (u: MppUnsigned | { refused: true; code: string }) => {
  if ("refused" in u || u.request.kind !== "eip712") throw new Error("not an eip712 request");
  return u as Extract<MppUnsigned, { request: { kind: "eip712" } }>;
};
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const RECIPIENT_E = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PATHUSD = M.fixed.pathUSD;
const num = (n: number | bigint) => (BigInt(n) === 0n ? "0x" : toHex(BigInt(n)));

describe("mpp-charge-evm-authorization.json", () => {
  const ch = placedOf(C_E);
  const build = async () =>
    eip712(await evmAuthorization.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, tokenDomain: A.fixed.tokenDomain }, H));

  it("MV5: typed data, signature, credential, bound and reference", async () => {
    const u = await build();
    expect(hashTypedData(forViem(u.request.typedData))).toBe(A.MV5.expectDigest);
    affix(domainSeparator({ domain: u.request.typedData.domain }), A.MV5.expectDomainSeparator);
    const signature = await payer.signTypedData(forViem(u.request.typedData));
    expect(signature).toBe(A.MV5.expectSignature);
    expect(await recoverTypedDataAddress({ ...forViem(u.request.typedData), signature })).toBe(A.fixed.payer);
    const cred = u.complete(signature) as MppCredential;
    expect(cred.source).toBe(A.MV5.expectSource);
    expect(cred.payload["nonce"]).toBe(A.MV5.expectNonce);
    expect(cred.payload["validBefore"]).toBe(A.MV5.expectValidBefore);
    expect(await evmAuthorization.bound(cred)).toBe(H);
    const other = structuredClone(cred);
    other.payload["nonce"] = challengeHash(ch.id, A.fixed.otherRealm);
    expect(await evmAuthorization.bound(other)).toEqual(A.MV5.expectBoundOtherRealm);
    const ref = (await evmAuthorization.reference(cred)) as EvmRef;
    expect(ref.transferLog?.digest).toBe(A.MV5.expectTransferDigest);
    expect(JSON.parse(JSON.stringify(ref))).toEqual({
      network: "eip155:84532",
      settleBy: A.MV5.expectValidBefore,
      bindingLog: { address: USDC, topic0: A.MV5.expectAuthorizationUsedTopic, index: 2, value: A.MV5.expectNonce },
      transferLog: { address: USDC, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: A.MV5.expectTransferDigest },
      search: { address: USDC, topics: [A.MV5.expectAuthorizationUsedTopic, null, A.MV5.expectNonce] },
    });
  });

  it("build and bound refuse what is not this pairing's", async () => {
    const H2 = "0x88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589";
    expect(await evmAuthorization.build({ challenge: ch, from: A.fixed.payer, now: 0, tokenDomain: A.fixed.tokenDomain }, H2))
      .toEqual({ refused: true, code: "mpp/id-not-ours" });
    expect(await evmAuthorization.build({ challenge: ch, from: A.fixed.payer, now: 0 }, H)).toEqual({ refused: true, code: "mpp/input-malformed" });
    const u = await build();
    const cred = u.complete(A.MV5.expectSignature) as MppCredential;
    expect(await evmPermit2.bound(cred)).toEqual({ refused: true, code: "mpp/credential-type" });
    expect(await evmAuthorization.bound({ ...cred, challenge: { ...cred.challenge, id: challengeId(H, 1) as string } }))
      .toEqual({ refused: true, code: "mpp/nonce-not-challenge-hash" });
    expect(await evmAuthorization.bound({ ...cred, challenge: { ...cred.challenge, opaque: undefined } as never }))
      .toEqual({ refused: true, code: "mpp/opaque-not-this-hash" });
    expect(u.complete("0x1234")).toEqual({ refused: true, code: "mpp/credential-malformed" });
    expect(evmAuthorization.pattern).toEqual(Object.fromEntries(Object.entries(A.pattern).filter(([k]) => k !== "claims")));
    expect(evmAuthorization.claims).toBe(A.pattern.claims);
  });

  // Profile mpp/charge rule 2: "The challenge `id` is the base64url (no padding) of H's 32 bytes, then `.` and the
  // challenge's position in the 402, except that a Tempo `subscription` challenge's id is exactly the base64url (no
  // padding) of H". A charge echoing the bare form signs a nonce that is none of the 32 positioned ids' challengeHash
  // (viem's keccak256 over the id and realm), so a holder of the ATR cannot confirm H from it.
  it("a charge credential echoing the bare base64url of H as its id is not bound", async () => {
    const bare = ch.id.slice(0, ch.id.indexOf("."));
    const nonce = keccak256(toBytes(`${bare}${realm}`));
    const positioned = Array.from({ length: 32 }, (_, i) => keccak256(toBytes(`${challengeId(H, i) as string}${realm}`)));
    expect(positioned).not.toContain(nonce);
    const u = await build();
    const cred = u.complete(A.MV5.expectSignature) as MppCredential;
    const bareAuth = { ...cred, challenge: { ...cred.challenge, id: bare }, payload: { ...cred.payload, nonce } };
    expect(await evmAuthorization.bound(bareAuth)).toEqual({ refused: true, code: "mpp/id-not-ours" });
    const p2 = await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: 0, spender: P.fixed.spender }, H);
    if ("refused" in p2) throw new Error(p2.code);
    const pc = p2.complete(P.MV6.expectSignature) as MppCredential;
    const witness = { ...(pc.payload["witness"] as object), challengeHash: nonce };
    const bareP2 = { ...pc, challenge: { ...pc.challenge, id: bare }, payload: { ...pc.payload, witness } };
    expect(await evmPermit2.bound(bareP2)).toEqual({ refused: true, code: "mpp/id-not-ours" });
    expect(await evmAuthorization.build({ challenge: { ...ch, id: bare }, from: A.fixed.payer, now: 0, tokenDomain: A.fixed.tokenDomain }, H))
      .toEqual({ refused: true, code: "mpp/id-not-ours" });
  });
});

describe("mpp-charge-evm-permit2.json", () => {
  const spender = P.fixed.spender;
  const typeHashOf = (s: string) => keccak256(toBytes(s));

  it("MV6: the single form, and MPP's literal witness string gives another digest", async () => {
    const ch = placedOf(C_E);
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    const td = u.request.typedData as Permit2TypedData;
    expect(td.primaryType).toBe("PermitWitnessTransferFrom");
    expect(hashTypedData(forViem(td))).toBe(P.MV6.expectDigest);
    const sep = domainSeparator({ domain: td.domain });
    affix(sep, P.MV6.expectDomainSeparator);
    const signature = await payer.signTypedData(forViem(td));
    expect(signature).toBe(P.MV6.expectSignature);
    const cred = u.complete(signature) as MppCredential;
    expect(await evmPermit2.bound(cred)).toBe(H);

    const literalTypeHash = typeHashOf(
      "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline," +
        P.MV6.literalWitnessString,
    );
    affix(literalTypeHash, P.MV6.expectLiteralTypeHash);
    const w = (td.message.witness ?? {}) as { challengeHash: ViemHex; externalId: string };
    const permitted = td.message.permitted as { token: ViemHex; amount: bigint };
    const tokenPermissions = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [typeHashOf("TokenPermissions(address token,uint256 amount)"), permitted.token, permitted.amount],
      ),
    );
    const witnessHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
        [typeHashOf("PaymentWitness(bytes32 challengeHash, string externalId)"), w.challengeHash, keccak256(toBytes(w.externalId))],
      ),
    );
    const struct = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
        [literalTypeHash, tokenPermissions, td.message.spender, td.message.nonce, td.message.deadline, witnessHash],
      ),
    );
    affix(keccak256(concat(["0x1901", sep, struct])), P.MV6.expectLiteralDigest);
  });

  it("MV6b: the batch form", async () => {
    const c6b = challenge("evm", "charge", P.fixed.R_E6b);
    expect(pairingsOf(c6b)).toEqual(P.MV6b.expectPairings);
    expect(pairingsOf(challenge("evm", "charge", P.fixed.R_E6bAuthorizationOnly))).toEqual(P.MV6b.expectAuthorizationOnly);
    const ch = placedOf(c6b);
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    const td = u.request.typedData;
    expect(td.primaryType).toBe("PermitBatchWitnessTransferFrom");
    expect(
      typeHashOf(
        "PermitBatchWitnessTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline," +
          "PaymentWitness witness)PaymentWitness(bytes32 challengeHash,string externalId)TokenPermissions(address token,uint256 amount)",
      ),
    ).toBe(P.MV6b.expectTypeHash);
    expect(hashTypedData(forViem(td))).toBe(P.MV6b.expectDigest);
    const signature = await payer.signTypedData(forViem(td));
    expect(signature).toBe(P.MV6b.expectSignature);
    const cred = u.complete(signature) as MppCredential;
    expect(cred.payload["transferDetails"]).toEqual(P.MV6b.expectTransferDetails);
    expect(await evmPermit2.bound(cred)).toBe(H);
    const ref = (await evmPermit2.reference(cred)) as EvmRef;
    expect(ref.transferLog?.digest).toBe(P.MV6b.expectPrimaryIdentity);
    expect(ref.bindingLog).toBeUndefined();
    expect(ref.search).toBeUndefined();
    expect(ref.settleBy).toBe("1790000060");
    const split: EvmLog = {
      address: USDC,
      topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf("0x8Ba1f109551bD432803012645Ac136ddd64DBA72")],
      data: wordOf(500n),
    };
    const reader = readerFor("eip155:84532", { status: 1, blockNumber: "100", logs: [split] });
    expect(await evmPermit2.status({ ...ref, transaction: `0x${"22".repeat(32)}` }, reader)).toEqual(
      P.MV6b.splitOnlyReceipt.expect,
    );
    expect(await evmPermit2.reference({ ...cred, source: undefined } as never)).toEqual({
      refused: true,
      code: "mpp/source-required",
    });
  });

  it("plant: a witness for the same ATR's other challenge is not bound to this one", async () => {
    const ch = placedOf(challenge("evm", "charge", P.fixed.R_E6b));
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    const cred = u.complete(P.MV6b.expectSignature) as MppCredential;
    const planted = structuredClone(cred);
    (planted.payload["witness"] as { challengeHash: string }).challengeHash = P.plant.challengeHashOfPosition1;
    expect(challengeHash(challengeId(H, 1) as string, realm)).toBe(P.plant.challengeHashOfPosition1);
    expect(await evmPermit2.bound(planted)).toEqual(P.plant.expect);
  });

  it("build refuses splits that leave no primary amount", async () => {
    const r = JSON.parse(P.fixed.R_E6b);
    r.methodDetails.splits = [{ amount: "10000", recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72" }];
    const ch = placedOf(challenge("evm", "charge", JSON.stringify(r)));
    expect(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: 0, spender }, H)).toEqual({
      refused: true,
      code: "mpp/input-malformed",
    });
    expect(await evmPermit2.build({ challenge: placedOf(C_E), from: A.fixed.payer, now: 0 }, H)).toEqual({
      refused: true,
      code: "mpp/input-malformed",
    });
  });
});

describe("mpp-charge-evm-transaction.json and mpp-charge-evm-hash.json", () => {
  it("MV11: the transfer call, signed as a whole transaction, carries no H", async () => {
    expect(pairingsOf(challenge("evm", "charge", TX.fixed.R_ENoTypes))).toEqual(TX.MV11.expectPairings);
    expect(pairingsOf(challenge("evm", "charge", TX.fixed.R_ESplitsCallTypes))).toEqual(TX.MV11.expectSplitsCallTypes);
    const ch = placedOf(challenge("evm", "charge", TX.fixed.R_ENoTypes));
    const u = await evmTransaction.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now }, H);
    if ("refused" in u || u.request.kind !== "evm-call") throw new Error("not an evm call");
    expect(u.request).toEqual({ kind: "evm-call", chainId: 84532, call: { to: USDC, data: TX.MV11.expectCalldata }, broadcast: false });
    const t = TX.MV11.transaction;
    const raw = await payer.signTransaction({
      type: "eip1559",
      chainId: t.chainId,
      nonce: t.nonce,
      maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas),
      maxFeePerGas: BigInt(t.maxFeePerGas),
      gas: BigInt(t.gas),
      to: t.to,
      data: u.request.call.data,
    });
    const bytes = toBytes(raw);
    expect(bytes.length).toBe(TX.MV11.expectRawLength);
    expect(sha256(bytes)).toBe(TX.MV11.expectRawSha256);
    expect(keccak256(raw)).toBe(TX.MV11.expectTxHash);
    expect(raw.split(H.slice(2)).length - 1).toBe(TX.MV11.expectHOccurrences);
    const cred = u.complete(raw) as MppCredential;
    expect(cred.payload).toEqual({ type: "transaction", signature: raw });
    expect(await evmTransaction.bound(cred)).toEqual(TX.MV11.expectBound);
    expect(evmTransaction.claims).toBe(TX.MV11.expectClaims);
    expect(evmTransaction.pattern).toEqual(Object.fromEntries(Object.entries(TX.pattern).filter(([k]) => k !== "claims")));
  });

  it("MV12: the hash credential, the network reference, and transferPresent", async () => {
    const ch = placedOf(challenge("evm", "charge", TX.fixed.R_ENoTypes));
    const u = await evmHash.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request).toMatchObject({ kind: "evm-call", broadcast: true });
    const cred = u.complete(HS.MV12.hash) as MppCredential;
    expect(cred.payload).toEqual({ type: "hash", hash: HS.MV12.hash });
    // The reference names the asset the read needs: the challenge's `currency`, a read key, never an amount, so a
    // caller holding only the chosen challenge maps nothing itself.
    const keys = await evmHash.reference({ challenge: C_E } as MppCredential);
    expect(keys).toEqual(HS.MV12.expectReference);
    expect(await evmTransaction.reference({ challenge: C_E } as MppCredential)).toEqual(HS.MV12.expectReference);
    const transfer = (address: string): EvmLog => ({
      address: address as `0x${string}`,
      topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(RECIPIENT_E)],
      data: wordOf(10000n),
    });
    if ("refused" in keys) throw new Error(keys.code);
    const ref = { ...keys, transaction: HS.MV12.hash };
    const status = async (r: Parameters<typeof readerFor>[1]) => withBigints(await evmHash.status(ref, readerFor("eip155:84532", r)));
    expect(await status({ status: 1, blockNumber: "100", logs: [transfer(USDC)] })).toEqual(HS.MV12.expectSettled);
    expect(await status({ status: 1, blockNumber: "100", logs: [transfer("0x0000000000000000000000000000000000000001")] }))
      .toEqual(HS.MV12.expectOtherEmitter);
    expect(await status({ status: 0, blockNumber: "100", logs: [] })).toEqual(HS.MV12.expectReverted);
    expect(await status("reader-error")).toEqual({ state: "pending", why: "unreadable" });
    expect(evmHash.pattern).toEqual(Object.fromEntries(Object.entries(HS.pattern).filter(([k]) => k !== "claims")));
  });
});

/** The vector's wire T: `0x76` ‖ rlp([...]) with `calldata` as the one call, and a 65-byte 0x11 signature. */
function wireT(calldata: string): Uint8Array {
  const body = toRlp([
    num(42431),
    num(1),
    num(2),
    num(100000),
    [[PATHUSD, num(0), calldata as ViemHex]],
    [],
    num(0),
    num(0),
    num(1790000060),
    "0x",
    PATHUSD,
    "0x",
    [],
    `0x${"11".repeat(65)}`,
  ]);
  return toBytes(concat(["0x76", body]));
}

describe("mpp-charge-tempo-memo.json", () => {
  const ch = placedOf(C_T);
  const memo = M.MV7.expectMemo;

  it("MV7: the attribution memo and its check", () => {
    expect(attributionMemo(realm, ch.id)).toBe(memo);
    expect(attributionMemo(realm, challengeId(H, 1) as string)).toBe(M.MV7.expectMemoPosition1);
    expect(checkAttribution(memo, realm, ch.id)).toBe(true);
    expect(checkAttribution(memo, realm, challengeId(H, 1) as string)).toEqual(M.MV7.expectMismatch);
    expect(checkAttribution(memo, M.fixed.otherRealm, ch.id)).toEqual(M.MV7.expectMismatch);
    expect(checkAttribution(M.MV7.memoMalformed, realm, ch.id)).toEqual(M.MV7.expectMalformed);
    expect(checkAttribution(attributionMemo(realm, ch.id, "wallet-7"), realm, ch.id)).toBe(true);
    expect(keccak256(toBytes("mpp")).slice(0, 10)).toBe(memo.slice(0, 10));
    expect(keccak256(toBytes(realm)).slice(2, 22)).toBe(memo.slice(12, 32));
    expect(keccak256(toBytes(ch.id)).slice(2, 16)).toBe(memo.slice(52));
  });

  it("MV7: the selector, topic, calldata, wire, build, bound and reference", async () => {
    expect(keccak256(toBytes(M.MV7.selectorSignature)).slice(0, 10)).toBe(TRANSFER_WITH_MEMO_SELECTOR);
    expect(TRANSFER_WITH_MEMO_SELECTOR).toBe(M.MV7.expectSelector);
    expect(keccak256(toBytes(M.MV7.topicSignature))).toBe(TRANSFER_WITH_MEMO_TOPIC);
    expect(memoCalldata(M.fixed.recipient, 1000000n, memo)).toBe(M.MV7.expectCalldata);
    const u = await tempoMemo.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request).toEqual({
      kind: "tempo-call",
      chainId: 42431,
      call: { to: PATHUSD, data: M.MV7.expectCalldata },
      validBefore: 1790000060,
      broadcast: false,
    });
    const T = wireT(M.MV7.expectCalldata);
    expect(T.length).toBe(M.MV7.expectWireLength);
    expect(sha256(T)).toBe(M.MV7.expectWireSha256);
    const decoded = decodeTempoTx(T);
    if ("refused" in decoded) throw new Error(decoded.code);
    expect(decoded.chainId).toBe(42431n);
    expect(decoded.validBefore).toBe(1790000060n);
    const cred = u.complete(toHex(T)) as MppCredential;
    expect(cred.payload).toEqual({ type: "transaction", signature: toHex(T) });
    expect(await tempoMemo.bound(cred)).toBe(H);
    const ref = (await tempoMemo.reference(cred)) as EvmRef;
    expect(JSON.parse(JSON.stringify(ref))).toEqual({
      network: "eip155:42431",
      settleBy: "1790000060",
      bindingLog: { address: PATHUSD, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: memo },
      transferLog: { address: PATHUSD, topic0: TRANSFER_WITH_MEMO_TOPIC, identity: "to,value", digest: M.MV7.expectReferenceDigest },
      search: { address: PATHUSD, topics: [TRANSFER_WITH_MEMO_TOPIC, null, null, memo] },
    });
  });

  it("MV8: status on fixture receipts", async () => {
    const cred = { challenge: ch, source: "", payload: { type: "transaction", signature: toHex(wireT(M.MV7.expectCalldata)) } };
    const ref = { ...((await tempoMemo.reference(cred)) as EvmRef), transaction: `0x${"33".repeat(32)}` as `0x${string}` };
    const logs = (emitter: string): EvmLog[] => [
      { address: PATHUSD, topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(M.fixed.recipient)], data: wordOf(1000000n) },
      {
        address: emitter as `0x${string}`,
        topics: [TRANSFER_WITH_MEMO_TOPIC, topicOf(A.fixed.payer), topicOf(M.fixed.recipient), memo],
        data: wordOf(1000000n),
      },
    ];
    const status = async (l: EvmLog[]) =>
      withBigints(await tempoMemo.status(ref, readerFor("eip155:42431", { status: 1, blockNumber: "100", logs: l })));
    expect(await status(logs(PATHUSD))).toEqual(M.MV8.expectSettled);
    expect(await status(logs("0x0000000000000000000000000000000000000001"))).toEqual(M.MV8.expectOtherEmitter);
    const blocked: EvmLog[] = [
      { address: PATHUSD, topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(M.MV8.guard)], data: wordOf(1000000n) },
    ];
    expect(await status(blocked)).toEqual(M.MV8.expectBlocked);
    expect(tempoMemo.pattern).toEqual(Object.fromEntries(Object.entries(M.pattern).filter(([k]) => k !== "claims")));
  });

  it("plant: a memo signed for the challenge ….1 does not bind the challenge ….0", async () => {
    const planted = M.MV7.expectCalldata.slice(0, -64) + M.MV7.expectMemoPosition1.slice(2);
    const cred = { challenge: ch, source: "", payload: { type: "transaction", signature: toHex(wireT(planted)) } };
    expect(await tempoMemo.bound(cred)).toEqual(M.plant.expect);
  });

  it("decodeTempoTx refuses what is not a 0x76 transaction", async () => {
    const T = wireT(M.MV7.expectCalldata);
    expect(decodeTempoTx(T.subarray(1))).toEqual({ refused: true, code: "tempo/tx-malformed" });
    expect(decodeTempoTx(new Uint8Array(65_537).fill(0x76))).toEqual({ refused: true, code: "tempo/tx-too-large" });
    const nonCanonical = Uint8Array.from([0x76, 0xc1, 0x81, 0x05]);
    expect(decodeTempoTx(nonCanonical)).toEqual({ refused: true, code: "tempo/tx-malformed" });
    const noMemo = { challenge: ch, source: "", payload: { type: "transaction", signature: toHex(wireT("0x")) } };
    expect(await tempoMemo.bound(noMemo)).toEqual({ refused: true, code: "tempo/memo-not-bound" });
  });
});

describe("mpp-charge-tempo-push.json", () => {
  const cNoModes = challenge("tempo", "charge", PU.fixed.R_TNoModes);
  const ch = placedOf(cNoModes);
  const receipt = PU.MV13.receipt;

  it("MV13: modes, build, fetchPresented, bound and reference", async () => {
    expect(pairingsOf(cNoModes)).toEqual(PU.MV13.expectPairings);
    expect(pairingsOf(challenge("tempo", "charge", PU.fixed.R_TFeePayer))).toEqual(PU.MV13.expectFeePayer);
    const u = await tempoPush.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request).toEqual({
      kind: "tempo-call",
      chainId: 42431,
      call: { to: PATHUSD, data: M.MV7.expectCalldata },
      validBefore: 1790000060,
      broadcast: true,
    });
    const cred = u.complete(PU.MV13.T_P) as MppCredential;
    expect(cred.payload).toEqual({ type: "hash", hash: PU.MV13.T_P });
    const landed = (await tempoPush.fetchPresented(cred, readerFor("eip155:42431", receipt))) as LandedCredential;
    expect(withBigints(landed.landed)).toEqual({ transaction: PU.MV13.T_P, blockNumber: "100", logs: receipt.logs });
    expect(await tempoPush.bound(landed)).toBe(H);
    const ref = (await tempoPush.reference(landed)) as EvmRef;
    expect(ref.transferLog?.digest).toBe(PU.MV13.expectReferenceDigest);
    expect(ref.settleBy).toBeUndefined();
    expect(ref.bindingLog).toEqual({ address: PATHUSD, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: M.MV7.expectMemo });
    expect(await tempoPush.fetchPresented(cred, readerFor("eip155:42431", null))).toEqual(PU.MV13.expectNotFound);
    expect(await tempoPush.fetchPresented(cred, readerFor("eip155:42431", { ...receipt, status: 0 }))).toEqual(
      PU.MV13.expectReverted,
    );
    expect(await tempoPush.fetchPresented(cred, readerFor("eip155:42431", "reader-error"))).toEqual({
      refused: true,
      code: "tempo/unreadable",
    });
  });

  it("plant: a memo log emitted by another TIP-20 is not this payment's carrier", async () => {
    const u = await tempoPush.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    const cred = u.complete(PU.MV13.T_P) as MppCredential;
    const moved = { ...receipt, logs: [receipt.logs[0], { ...receipt.logs[1], address: PU.fixed.otherTip20 }] };
    const landed = (await tempoPush.fetchPresented(cred, readerFor("eip155:42431", moved))) as LandedCredential;
    expect(await tempoPush.bound(landed)).toEqual(PU.plant.expect);
    const forged = { ...cred, landed: { transaction: PU.MV13.T_P, blockNumber: 100n, logs: moved.logs } };
    expect(await tempoPush.bound(forged)).toEqual(PU.plant.expect);
  });
});
