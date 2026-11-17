// The four MPP EVM charge pairings against their vector files, and the tempo entry point's memo pieces against
// mpp-charge-tempo-memo.json. Every expected value is the files';
// viem 2.57.4 is the independent tool for EIP-712, signatures, RLP and keccak.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  concat,
  domainSeparator,
  encodeAbiParameters,
  encodeFunctionData,
  hashStruct,
  hashTypedData,
  keccak256,
  parseAbi,
  parseSignature,
  recoverTypedDataAddress,
  serializeCompactSignature,
  signatureToCompactSignature,
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
  type MppChallenge,
  type MppCredential,
  type MppUnsigned,
} from "../src/mpp.js";
import {
  RECEIVE_POLICY_GUARD,
  TRANSFER_WITH_MEMO_SELECTOR,
  TRANSFER_WITH_MEMO_TOPIC,
  decodeTempoTx,
  memoCalldata,
} from "../src/tempo.js";
import { counting } from "./fixtures/counting-reader.js";
import { ledgerReader } from "./eip155-tempo-mpp-ledger.js";
import { C_E, H, b64u, challenge, link, load, readerFor, realm, topicOf, withBigints, wordOf } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

const A = load("mpp-charge-evm-authorization.json");
const P = load("mpp-charge-evm-permit2.json");
const TX = load("mpp-charge-evm-transaction.json");
const HS = load("mpp-charge-evm-hash.json");
/** An EVM charge challenge without `credentialTypes`, which offers the `transaction` and `hash` pairings. */
const C_EH = challenge("evm", "charge", TX.fixed.R_ENoTypes);
const M = load("mpp-charge-tempo-memo.json");

const sha256 = (b: Uint8Array) => "0x" + createHash("sha256").update(b).digest("hex");
const forViem = (td: unknown) => td as Parameters<typeof hashTypedData>[0];
const payer = privateKeyToAccount(A.fixed.payerKey);
const affix = (v: string, e: { prefix: string; suffix: string }) => {
  expect(v.startsWith(e.prefix)).toBe(true);
  expect(v.endsWith(e.suffix)).toBe(true);
};
const placedOf = (c: MppChallenge) => (place([c], H, link, c, 0) as MppChallenge[])[0] as MppChallenge & { id: string };
const eip712 = (u: MppUnsigned | { refused: true; code: string }) => {
  if ("refused" in u || u.request.kind !== "eip712") throw new Error("not an eip712 request");
  return u as Extract<MppUnsigned, { request: { kind: "eip712" } }>;
};
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const RECIPIENT_E = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PATHUSD = M.fixed.pathUSD;
const num = (n: number | bigint) => (BigInt(n) === 0n ? "0x" : toHex(BigInt(n)));
/** The file's buyer B6 row's presented payment. */
const b6 = (V: { buyer: { rows: { name: string; input: { presented: unknown } }[] } }) => V.buyer.rows.find((r) => r.name === "B6")!.input.presented as MppCredential;
/** The query of a payment read at the final mark. */
const FINAL = { act: "payment", finality: "finalized" } as const;
const pendingSearch = { state: "pending", reason: "search-incomplete", foreign: [] };

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
    // complete's credential is buyer B6's presented, whole; B6's note says how it is written by hand from the draft.
    expect(cred).toStrictEqual(b6(A));
    expect(JSON.stringify(cred.payload)).toBe(JSON.stringify(b6(A).payload));
    expect(cred.source).toBe(A.MV5.expectSource);
    expect(cred.payload["nonce"]).toBe(A.MV5.expectNonce);
    expect(cred.payload["validBefore"]).toBe(A.MV5.expectValidBefore);
    expect(await evmAuthorization.bound(cred)).toBe(H);
    const other = structuredClone(cred);
    other.payload["nonce"] = challengeHash(ch.id, A.fixed.otherRealm);
    expect(await evmAuthorization.bound(other)).toEqual(A.MV5.expectBoundOtherRealm);
    const ref = (await evmAuthorization.reference(cred, cred.challenge)) as EvmRef;
    expect(ref.transferLog?.digest).toBe(A.MV5.expectTransferDigest);
    expect(JSON.parse(JSON.stringify(ref))).toEqual({
      network: "eip155:84532",
      settleBy: A.MV5.expectValidBefore,
      bindingLog: { address: USDC, topic0: A.MV5.expectAuthorizationUsedTopic, index: 2, value: A.MV5.expectNonce },
      transferLog: { address: USDC, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: A.MV5.expectTransferDigest },
      search: { address: USDC, topics: [A.MV5.expectAuthorizationUsedTopic, null, A.MV5.expectNonce] },
      authorization: { scheme: "eip3009", at: USDC, nonce: A.MV5.expectNonce, deadline: A.MV5.expectValidBefore, asset: USDC },
      payer: A.fixed.payer.toLowerCase(),
      presented: {
        token: USDC.toLowerCase(),
        from: A.fixed.payer.toLowerCase(),
        to: RECIPIENT_E.toLowerCase(),
        value: cred.payload["value"],
        nonce: A.MV5.expectNonce,
      },
      payee: RECIPIENT_E,
    });
    expect(await evmAuthorization.reference(cred, { ...cred.challenge, request: b64u("{}") })).toEqual({
      refused: true,
      code: "mpp/request-malformed",
    });
    expect(await evmAuthorization.authorizer(cred)).toBe(A.fixed.payer.toLowerCase());
    expect(await evmAuthorization.authorizer(other)).toEqual(A.MV5.expectBoundOtherRealm);
  });

  it("MV5: status reads the authorization's use and its transfer from the named transaction and the search", async () => {
    const cred = (await build()).complete(A.MV5.expectSignature) as MppCredential;
    const ref = (await evmAuthorization.reference(cred, cred.challenge)) as Exclude<Awaited<ReturnType<typeof evmAuthorization.reference>>, { refused: true }>;
    const another = "0x3333333333333333333333333333333333333333";
    const used = (by: string): EvmLog => ({
      address: USDC,
      topics: [A.MV5.expectAuthorizationUsedTopic, topicOf(by), A.MV5.expectNonce],
      data: "0x",
    });
    const paid: EvmLog = { address: USDC, topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(RECIPIENT_E)], data: wordOf(10000n) };
    const tx = `0x${"22".repeat(32)}` as const;
    const status = async (logs: EvmLog[], query: Parameters<typeof evmAuthorization.status>[2] = FINAL) =>
      withBigints(
        await evmAuthorization.status(
          { ...ref, transaction: tx },
          ledgerReader({
            network: "eip155:84532",
            heads: { latest: 110n, safe: 105n, finalized: 100n },
            txs: [{ hash: tx, block: 100n, status: 1, from: P.fixed.spender, to: USDC, input: "0x", logs }],
            call: () => toHex(logs[0]!.topics[1] === topicOf(A.fixed.payer) ? 1n : 0n, { size: 32 }),
          }),
          query,
        ),
      );
    const settled = { state: "settled", transaction: tx, position: "100", finality: "finalized", foreign: [], presented: "yes" };
    expect(await status([used(A.fixed.payer), paid])).toMatchObject(settled);
    // Another authorizer's use of the nonce consumes nothing of the payer's: the payer's value reads unconsumed.
    expect(await status([used(another), paid])).toMatchObject({ state: "pending", reason: "instrument-live", foreign: [{ transaction: tx, reason: "other-signer" }] });
    // The agreement act on the same read is the same act: the pairing's data offers its payment as an agreement.
    expect(evmAuthorization.data.agreement).toBeDefined();
    expect(await status([used(A.fixed.payer), paid], { act: "agreement", finality: "finalized" })).toMatchObject(settled);
    // A position the caller gives at the transaction's own block: the act is not after it.
    expect(await status([used(A.fixed.payer), paid], { ...FINAL, after: 100n })).toEqual({
      state: "failed",
      reason: "before-position",
      transaction: tx,
      position: "100",
      finality: "finalized",
      moved: [{ asset: USDC.toLowerCase(), amount: "10000", to: RECIPIENT_E.toLowerCase(), transaction: tx, place: 1 }],
      signer: A.fixed.payer.toLowerCase(),
      foreign: [],
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
    expect(u.complete("0x")).toEqual({ refused: true, code: "mpp/credential-malformed" });
    expect({ ...evmAuthorization.pattern, proves: evmAuthorization.data.proves }).toEqual(Object.fromEntries(Object.entries(A.pattern).filter(([k]) => k !== "claims")));
    expect(evmAuthorization.claims).toBe(A.pattern.claims);
  });

  // EIP-2098 writes a secp256k1 signature in 64 bytes (viem's serializeCompactSignature of MV5's and MV6's), and an
  // ERC-1271 contract signature has no fixed length, so `complete` takes a signature of 1 to 8192 bytes of hex.
  it("complete takes a signature of 1 to 8192 bytes: EIP-2098's 64-byte form of MV5's and MV6's", async () => {
    const compact = (s: ViemHex) => serializeCompactSignature(signatureToCompactSignature(parseSignature(s)));
    const a = eip712(await evmAuthorization.build({ challenge: ch, from: A.fixed.payer, now: 0, tokenDomain: A.fixed.tokenDomain }, H));
    const p = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: 0, spender: P.fixed.spender }, H));
    for (const [u, signature] of [[a, compact(A.MV5.expectSignature)], [p, compact(P.MV6.expectSignature)]] as const) {
      expect(toBytes(signature).length).toBe(64);
      expect((u.complete(signature) as MppCredential).payload["signature"]).toBe(signature);
      expect((u.complete("0x01") as MppCredential).payload["signature"]).toBe("0x01");
      for (const bad of ["0x", "0x123", `0x${"11".repeat(8193)}`] as const) {
        expect([bad.slice(0, 8), u.complete(bad)]).toEqual([bad.slice(0, 8), { refused: true, code: "mpp/credential-malformed" }]);
      }
    }
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
    // complete's credential is buyer B6's presented, whole; B6's note says how it is written by hand from the draft.
    expect(cred).toStrictEqual(b6(P));
    expect(JSON.stringify(cred.payload)).toBe(JSON.stringify(b6(P).payload));
    expect(await evmPermit2.bound(cred)).toBe(H);
    expect(await evmPermit2.authorizer(cred)).toBe(A.fixed.payer.toLowerCase());
    expect(await evmPermit2.authorizer({ ...cred, source: undefined } as never)).toEqual({
      refused: true,
      code: "mpp/source-required",
    });

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
    const ref = (await evmPermit2.reference(cred, cred.challenge)) as EvmRef;
    expect(ref.transferLog?.digest).toBe(P.MV6b.expectPrimaryIdentity);
    expect(ref.bindingLog).toBeUndefined();
    expect(ref.search).toBeUndefined();
    expect(ref.settleBy).toBe("1790000060");
    expect(await evmPermit2.reference({ ...cred, source: undefined } as never, cred.challenge)).toEqual({
      refused: true,
      code: "mpp/source-required",
    });
  });

  it("MV6b splitOnlyReceipt: a batch whose receipt holds the split's Transfer and not the primary's", async () => {
    const ch = placedOf(challenge("evm", "charge", P.fixed.R_E6b));
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    const cred = u.complete(P.MV6b.expectSignature) as MppCredential;
    const ref = (await evmPermit2.reference(cred, cred.challenge)) as Exclude<Awaited<ReturnType<typeof evmPermit2.reference>>, { refused: true }>;
    const p = cred.payload as any;
    const nonce = BigInt(p.permit.nonce);
    // Permit2's batch permitWitnessTransferFrom (Uniswap Permit2 SignatureTransfer.sol), encoded by viem.
    const spend = encodeFunctionData({
      abi: parseAbi([
        "function permitWitnessTransferFrom(((address token, uint256 amount)[] permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount)[] transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)",
      ]),
      args: [
        { permitted: p.permit.permitted.map((x: any) => ({ token: x.token, amount: BigInt(x.amount) })), nonce, deadline: BigInt(p.permit.deadline) },
        p.transferDetails.map((x: any) => ({ to: x.to.toLowerCase(), requestedAmount: BigInt(x.requestedAmount) })),
        A.fixed.payer,
        hashStruct({ data: (u.request.typedData as Permit2TypedData).message.witness, primaryType: "PaymentWitness", types: u.request.typedData.types } as Parameters<typeof hashStruct>[0]),
        "PaymentWitness witness)PaymentWitness(bytes32 challengeHash,string externalId)TokenPermissions(address token,uint256 amount)",
        p.signature,
      ],
    });
    const split = p.transferDetails[1];
    const splitPaid: EvmLog = { address: USDC, topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(split.to)], data: wordOf(BigInt(split.requestedAmount)) };
    const tx = `0x${"23".repeat(32)}` as const;
    const bit = 1n << (nonce & 0xffn);
    const reader = ledgerReader({
      network: "eip155:84532",
      heads: { latest: 100n, safe: 100n, finalized: 100n },
      txs: [{ hash: tx, block: 100n, status: 1, from: P.fixed.spender, to: ref.authorization.at as ViemHex, input: spend, logs: [splitPaid] }],
      call: (_to, _d, block) => toHex(block >= 100n ? bit : 0n, { size: 32 }),
    });
    expect(withBigints(await evmPermit2.status(ref, reader, FINAL))).toEqual(P.MV6b.splitOnlyReceipt.expect);
  });

  it("MV6: the reference names Permit2's record of the nonce, which status reads with the transaction that spends the permit", async () => {
    const ch = placedOf(C_E);
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    const cred = u.complete(P.MV6.expectSignature) as MppCredential;
    const ref = (await evmPermit2.reference(cred, cred.challenge)) as Exclude<Awaited<ReturnType<typeof evmPermit2.reference>>, { refused: true }>;
    expect(ref.payee).toBe(RECIPIENT_E);
    // Uniswap's Permit2, at one address on every chain; the Permit2 nonce is the challengeHash (MV5's nonce, the same
    // challenge), and the deadline the challenge's expiry.
    const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    expect(ref.authorization).toEqual({ scheme: "permit2", at: PERMIT2, nonce: A.MV5.expectNonce, deadline: A.MV5.expectValidBefore, asset: USDC });
    const nonce = BigInt(A.MV5.expectNonce);
    // Permit2's SignatureTransfer records nonce n in nonceBitmap(owner, n >> 8), bit n & 0xff (_useUnorderedNonce).
    const data = encodeFunctionData({
      abi: parseAbi(["function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)"]),
      args: [A.fixed.payer, nonce >> 8n],
    });
    const paid: EvmLog = { address: USDC, topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(RECIPIENT_E)], data: wordOf(10000n) };
    const tx = `0x${"22".repeat(32)}` as const;
    // The server's call that spends the permit: Permit2's permitWitnessTransferFrom(permit, transferDetails, owner,
    // witness, witnessTypeString, signature) (Uniswap Permit2 SignatureTransfer.sol), encoded by viem; the nonce is the
    // permit's second word. A plain ERC-20 transfer of the same amount carries no nonce.
    const p = cred.payload as any;
    const spend = encodeFunctionData({
      abi: parseAbi([
        "function permitWitnessTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)",
      ]),
      args: [
        { permitted: { token: p.permit.permitted[0].token, amount: BigInt(p.permit.permitted[0].amount) }, nonce, deadline: BigInt(p.permit.deadline) },
        { to: p.transferDetails[0].to, requestedAmount: BigInt(p.transferDetails[0].requestedAmount) },
        A.fixed.payer,
        hashStruct({
          data: (u.request.typedData as Permit2TypedData).message.witness,
          primaryType: "PaymentWitness",
          types: u.request.typedData.types,
        } as Parameters<typeof hashStruct>[0]),
        "PaymentWitness witness)PaymentWitness(bytes32 challengeHash,string externalId)TokenPermissions(address token,uint256 amount)",
        p.signature,
      ],
    });
    const plainTransfer = encodeFunctionData({
      abi: parseAbi(["function transfer(address to, uint256 value) returns (bool)"]),
      args: [RECIPIENT_E, 10000n],
    });
    expect(spend.slice(2).indexOf(A.MV5.expectNonce.slice(2))).toBeGreaterThan(0);
    expect(plainTransfer.indexOf(A.MV5.expectNonce.slice(2))).toBe(-1);
    const status = async (input: ViemHex, at: bigint, before: bigint, query: Parameters<typeof evmPermit2.status>[2] = FINAL) => {
      const calls: unknown[] = [];
      const reader = ledgerReader({
        network: "eip155:84532",
        heads: { latest: 100n, safe: 100n, finalized: 100n },
        txs: [{ hash: tx, block: 100n, status: 1, from: P.fixed.spender, to: PERMIT2 as ViemHex, input, logs: [paid] }],
        call: (to, d, block) => {
          calls.push([to, d, block]);
          return toHex(block === 100n ? at : before, { size: 32 });
        },
      });
      return { status: withBigints(await evmPermit2.status({ ...ref, transaction: tx }, reader, query)), calls };
    };
    const bit = 1n << (nonce & 0xffn);
    // viem's encoding of the call is the oracle of the read's decoding: the call is the transaction's own, and every
    // member the payer signed, the witness's hash among them, equals the presented permit's.
    const settled = { state: "settled", transaction: tx, position: "100", finality: "finalized", foreign: [], presented: "yes" };
    expect(await status(spend, bit, 0n)).toMatchObject({
      status: settled,
      calls: [[PERMIT2, data, 100n], [PERMIT2, data, 100n], [PERMIT2, data, 99n]],
    });
    // The bit unset at the receipt's block: no act, and the value unconsumed with its deadline ahead.
    expect((await status(spend, 0n, 0n)).status).toEqual({ state: "pending", reason: "instrument-live", foreign: [] });
    // The bit set before the receipt's block, or a transaction that carries no nonce: no act, the value consumed.
    expect((await status(spend, bit, bit)).status).toEqual(pendingSearch);
    expect((await status(plainTransfer, bit, 0n)).status).toEqual(pendingSearch);
    // The agreement act on the same read is the same act: the pairing's data offers its payment as an agreement.
    expect(evmPermit2.data.agreement).toBeDefined();
    expect((await status(spend, bit, 0n, { act: "agreement", finality: "finalized" })).status).toMatchObject(settled);
    // A position the caller gives at the transaction's own block: the act is not after it.
    expect((await status(spend, bit, 0n, { ...FINAL, after: 100n })).status).toMatchObject({
      state: "failed",
      reason: "before-position",
      transaction: tx,
      position: "100",
      finality: "finalized",
      foreign: [],
    });
  });

  it("witnessOtherNonce: a permit under another nonce carrying this challenge's witness is an act carrying H", async () => {
    const row = P.witnessOtherNonce;
    const ch = placedOf(C_E);
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    const cred = u.complete(P.MV6.expectSignature) as MppCredential;
    const ref = (await evmPermit2.reference(cred, cred.challenge)) as Exclude<Awaited<ReturnType<typeof evmPermit2.reference>>, { refused: true }>;
    const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    const nonce = BigInt(row.nonce);
    const p = cred.payload as any;
    // Permit2's permitWitnessTransferFrom, encoded by viem, under the row's nonce with MV6's witness hash.
    const spend = encodeFunctionData({
      abi: parseAbi([
        "function permitWitnessTransferFrom(((address token, uint256 amount) permitted, uint256 nonce, uint256 deadline) permit, (address to, uint256 requestedAmount) transferDetails, address owner, bytes32 witness, string witnessTypeString, bytes signature)",
      ]),
      args: [
        { permitted: { token: p.permit.permitted[0].token, amount: BigInt(p.permit.permitted[0].amount) }, nonce, deadline: BigInt(p.permit.deadline) },
        { to: p.transferDetails[0].to, requestedAmount: BigInt(p.transferDetails[0].requestedAmount) },
        A.fixed.payer,
        hashStruct({ data: (u.request.typedData as Permit2TypedData).message.witness, primaryType: "PaymentWitness", types: u.request.typedData.types } as Parameters<typeof hashStruct>[0]),
        "PaymentWitness witness)PaymentWitness(bytes32 challengeHash,string externalId)TokenPermissions(address token,uint256 amount)",
        p.signature,
      ],
    });
    expect(spend.slice(2).indexOf(A.MV5.expectNonce.slice(2))).toBe(-1);
    expect(spend.slice(2).indexOf(ref.presented["witness"]!.slice(2))).toBeGreaterThan(0);
    // The row's nonce lies in nonceBitmap(owner, nonce >> 8), bit nonce & 0xff: set at block 100, unset before; the
    // challenge hash's word reads unset throughout.
    const ownWord = encodeFunctionData({
      abi: parseAbi(["function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)"]),
      args: [A.fixed.payer, nonce >> 8n],
    });
    const paid: EvmLog = { address: USDC, topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(RECIPIENT_E)], data: wordOf(10000n) };
    const reader = ledgerReader({
      network: "eip155:84532",
      heads: { latest: 100n, safe: 100n, finalized: 100n },
      txs: [{ hash: row.transaction, block: 100n, status: 1, from: spender, to: PERMIT2 as ViemHex, input: spend, logs: [paid] }],
      call: (_to, d, block) => toHex(d.toLowerCase() === ownWord.toLowerCase() && block >= 100n ? 1n << (nonce & 0xffn) : 0n, { size: 32 }),
    });
    expect(withBigints(await evmPermit2.status(ref, reader, FINAL))).toEqual(row.expect);
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

  it("a permit whose nonce is not the challenge hash is not bound", async () => {
    const ch = placedOf(challenge("evm", "charge", P.fixed.R_E6b));
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    const cred = u.complete(P.MV6b.expectSignature) as MppCredential;
    expect(await evmPermit2.bound(cred)).toBe(H);
    const planted = structuredClone(cred);
    (planted.payload["permit"] as { nonce: string }).nonce = P.nonceNotChallengeHash.nonce;
    expect(await evmPermit2.bound(planted)).toEqual(P.nonceNotChallengeHash.expect);
  });

  it("build refuses splits that leave no primary amount", async () => {
    const r = JSON.parse(P.fixed.R_E6b);
    r.methodDetails.splits = [{ amount: "10000", recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72" }];
    // `place` refuses this request (pairingsOf), so the challenge carrying it is R_E6b's placed challenge with the
    // request replaced: its id and opaque carry H, and the filter reads the splits.
    expect(place([challenge("evm", "charge", JSON.stringify(r))], H, link, challenge("evm", "charge", JSON.stringify(r)), 0)).toEqual({
      refused: true,
      code: "mpp/input-malformed",
    });
    const ch = { ...placedOf(challenge("evm", "charge", P.fixed.R_E6b)), request: challenge("evm", "charge", JSON.stringify(r)).request };
    expect(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: 0, spender }, H)).toEqual({
      refused: true,
      code: "mpp/input-malformed",
    });
    expect(await evmPermit2.build({ challenge: placedOf(C_E), from: A.fixed.payer, now: 0 }, H)).toEqual({
      refused: true,
      code: "mpp/input-malformed",
    });
  });

  // draft-evm-charge-00 ("Payment Splits"): the primary recipient receives `amount` minus the sum of the splits, and
  // `transferDetails[0]` is the primary transfer and `transferDetails[i+1]` is `splits[i]`.
  it("build writes a split of amount 0 as its own transfer, after the primary", async () => {
    const r = JSON.parse(P.fixed.R_E6b);
    r.methodDetails.splits = [{ amount: "0", recipient: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72" }];
    const ch = placedOf(challenge("evm", "charge", JSON.stringify(r)));
    const u = eip712(await evmPermit2.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now, spender }, H));
    expect(u.request.typedData.primaryType).toBe("PermitBatchWitnessTransferFrom");
    const cred = u.complete(P.MV6b.expectSignature) as MppCredential;
    expect(cred.payload["transferDetails"]).toEqual([
      { to: RECIPIENT_E, requestedAmount: "10000" },
      { to: "0x8Ba1f109551bD432803012645Ac136ddd64DBA72", requestedAmount: "0" },
    ]);
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
    expect([u.request.broadcast, await evmTransaction.broadcaster(cred)]).toEqual([false, "payee"]);
    expect(cred.payload).toEqual({ type: "transaction", signature: raw });
    expect(await evmTransaction.bound(cred)).toEqual(TX.MV11.expectBound);
    expect(evmTransaction.claims).toBe(TX.MV11.expectClaims);
    expect({ ...evmTransaction.pattern, proves: evmTransaction.data.proves }).toEqual(Object.fromEntries(Object.entries(TX.pattern).filter(([k]) => k !== "claims")));
  });

  // draft-evm-charge-00 (tempoxyz/mpp-specs 08e7dd87) L696-697 and L873-879: the transaction credential carries an
  // EIP-1559 transaction, which the server deserializes and holds to methodDetails.chainId before it broadcasts. build's
  // complete reads it so: bytes that are not an EIP-1559 transaction are mpp/credential-malformed, and one for another
  // chain is evm/chain-mismatch. bound reads nothing of it.
  it("agreedRefusals: build's complete refuses a transaction for another chain, or bytes that are not an EIP-1559 transaction", async () => {
    type Row = { case: string; chainIds?: number[]; transactions: ViemHex[]; expect: string };
    const rows = rowsOf(TX.agreedRefusals.rows as Row[], "mpp-charge-evm-transaction.json agreedRefusals.rows", { exact: 2 });
    const signer = privateKeyToAccount(TX.fixed.payerKey);
    const t = TX.MV11.transaction;
    const fields = { nonce: t.nonce, gas: BigInt(t.gas), to: t.to as ViemHex, data: TX.MV11.expectCalldata as ViemHex };
    const fees = { maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGas), maxFeePerGas: BigInt(t.maxFeePerGas) };
    const mv11 = await signer.signTransaction({ type: "eip1559", chainId: t.chainId, ...fields, ...fees });
    expect(sha256(toBytes(mv11))).toBe(TX.MV11.expectRawSha256);
    // Row 0's transactions are MV11's with each chainId; row 1's are MV11's transfer as a legacy and as an EIP-2930
    // transaction, then MV11's with a zero byte after it.
    const otherChains = await Promise.all(rows[0]!.chainIds!.map((chainId) => signer.signTransaction({ type: "eip1559", chainId, ...fields, ...fees })));
    expect(otherChains).toEqual(rows[0]!.transactions);
    const gasPrice = BigInt(t.maxFeePerGas);
    const legacy = await signer.signTransaction({ type: "legacy", chainId: t.chainId, ...fields, gasPrice });
    const eip2930 = await signer.signTransaction({ type: "eip2930", chainId: t.chainId, ...fields, gasPrice, accessList: [] });
    expect([legacy, eip2930, `${mv11}00`]).toEqual(rows[1]!.transactions);
    const ch = placedOf(challenge("evm", "charge", TX.fixed.R_ENoTypes));
    const u = await evmTransaction.build({ challenge: ch, from: signer.address, now: A.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.complete(mv11)).toEqual({ challenge: ch, source: `did:pkh:eip155:${t.chainId}:${signer.address}`, payload: { type: "transaction", signature: mv11 } });
    // An access list nests three lists deep in the transaction's list; a transaction that carries one is taken too.
    const listed = await signer.signTransaction({ type: "eip1559", chainId: t.chainId, ...fields, ...fees, accessList: [{ address: fields.to, storageKeys: [H] }] });
    expect(u.complete(listed)).not.toHaveProperty("refused");
    for (const r of rows) {
      for (const w of r.transactions) expect([r.case, w, u.complete(w)]).toEqual([r.case, w, { refused: true, code: r.expect }]);
    }
  });

  // MV12.expectCalldata is eth-abi 6.0.0's transfer(address,uint256) of the request's recipient and amount; viem 2.57.4's
  // encodeFunctionData re-derives it here, and build's whole request, broadcast by the payer, is held to it.
  it("MV12: the hash credential's request, byte for byte as eth-abi and viem encode the transfer, the network reference, and transferPresent", async () => {
    const r = JSON.parse(TX.fixed.R_ENoTypes);
    const erc20 = parseAbi(["function transfer(address to, uint256 value)"]);
    expect(encodeFunctionData({ abi: erc20, functionName: "transfer", args: [r.recipient, BigInt(r.amount)] })).toBe(HS.MV12.expectCalldata);
    expect(HS.MV12.expectCalldata).toBe(TX.MV11.expectCalldata);
    const ch = placedOf(challenge("evm", "charge", TX.fixed.R_ENoTypes));
    const u = await evmHash.build({ challenge: ch, from: A.fixed.payer, now: A.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request).toEqual({ kind: "evm-call", chainId: 84532, call: { to: USDC, data: HS.MV12.expectCalldata }, broadcast: true });
    const cred = u.complete(HS.MV12.hash) as MppCredential;
    expect([(u.request as { broadcast?: boolean }).broadcast, await evmHash.broadcaster(cred)]).toEqual([true, "payer"]);
    expect(cred.payload).toEqual({ type: "hash", hash: HS.MV12.hash });
    // The reference names the read keys: the challenge's `currency`, and the payer's Transfer, identified by its sender
    // alone, the address of the credential's `did:pkh` source. It names no amount and no payee.
    const keys = await evmHash.reference(cred, cred.challenge);
    expect(keys).toEqual(HS.MV12.expectReference);
    expect(HS.MV12.expectReference.transferLog.digest).toBe(sha256(toBytes(A.fixed.payer)));
    expect(HS.MV12.expectReference.transferLog.topic0).toBe(keccak256(toBytes("Transfer(address,address,uint256)")));
    expect(await evmTransaction.reference({ ...cred, challenge: C_EH } as MppCredential, C_EH)).toEqual(HS.MV12.expectReference);
    const transfer = (address: string): EvmLog => ({
      address: address as `0x${string}`,
      topics: [TRANSFER_TOPIC, topicOf(A.fixed.payer), topicOf(RECIPIENT_E)],
      data: wordOf(10000n),
    });
    if ("refused" in keys) throw new Error(keys.code);
    const status = async (r: { status: 0 | 1; logs: EvmLog[] } | null, query: Parameters<typeof evmHash.status>[2] = FINAL) =>
      withBigints(
        await evmHash.status(
          keys,
          {
            ...ledgerReader({
              network: "eip155:84532",
              heads: { latest: 100n, safe: 100n, finalized: 100n },
              txs: r === null ? [] : [{ hash: HS.MV12.hash, block: 100n, status: r.status, from: A.fixed.payer, to: USDC, input: HS.MV12.expectCalldata, logs: r.logs }],
            }),
            archival: true,
          },
          query,
        ),
      );
    expect(await status({ status: 1, logs: [transfer(USDC)] })).toEqual(HS.MV12.expectSettled);
    // A transfer to the recipient of another token pays the recipient: the token is compared with nothing.
    expect(await status({ status: 1, logs: [transfer("0x0000000000000000000000000000000000000001")] })).toMatchObject({ state: "settled" });
    expect(await status({ status: 0, logs: [] })).toEqual(HS.MV12.expectReverted);
    expect(await status(null)).toEqual(HS.MV12.expectNotFound);
    // A position the caller gives at the transaction's own block: the act is not after it.
    expect(await status({ status: 1, logs: [transfer(USDC)] }, { ...FINAL, after: 100n })).toMatchObject({
      state: "failed",
      reason: "before-position",
      transaction: HS.MV12.hash,
      position: "100",
      finality: "finalized",
      foreign: [],
    });
    expect({ ...evmHash.pattern, proves: evmHash.data.proves }).toEqual(Object.fromEntries(Object.entries(HS.pattern).filter(([k]) => k !== "claims")));
  });

  // Neither pairing binds (nothing the payer signs carries H), and both hold the echoed challenge to their filter first:
  // a challenge pairingsOf does not name for them is refused with its code, by bound and by reference.
  it("MV11 and MV12: bound and reference refuse a challenge pairingsOf does not name for the pairing, with its code", async () => {
    const source = A.MV5.expectSource;
    const types = placedOf(C_E);
    const noAmount = { ...placedOf(C_EH), request: b64u(JSON.stringify({ ...JSON.parse(TX.fixed.R_ENoTypes), amount: undefined })) };
    for (const pairing of [evmTransaction, evmHash]) {
      const payload = { type: "hash", hash: HS.MV12.hash };
      expect(pairingsOf(C_E)).toEqual(["mpp/charge/evm/permit2", "mpp/charge/evm/authorization"]);
      expect(await pairing.bound({ challenge: types, source, payload })).toEqual({ refused: true, code: "mpp/not-this-pairing" });
      expect(await pairing.reference({ challenge: types, source, payload } as MppCredential, types)).toEqual({ refused: true, code: "mpp/not-this-pairing" });
      expect(await pairing.bound({ challenge: placedOf(C_EH), source, payload })).toEqual({ refused: true, code: "mpp/no-signed-place" });
      expect(await pairing.bound({ challenge: noAmount, source, payload })).toEqual({ refused: true, code: "mpp/request-malformed" });
      expect(await pairing.reference({ challenge: noAmount, source, payload } as MppCredential, noAmount)).toEqual({
        refused: true,
        code: "mpp/request-malformed",
      });
    }
  });

  // An address is `0x` and 40 hex digits in either case (Ethereum execution-apis, `src/schemas/base-types.yaml`
  // `address`, the form a receipt log's `address` takes in `src/schemas/receipt.yaml`). A reference whose `asset` or
  // transfer log address is any other string names no emitter a receipt can hold, and the rails guide ("Reading
  // settlement") reads a transfer log not of the form its pairing writes as pending `unreadable`, with nothing read.
});

/**
 * The vector's wire T: `0x76` ‖ rlp([...]) with `calldata` as its call, then a second call to PATHUSD with value 0 and
 * `padding` zero bytes as its input where `padding` is given, and a 65-byte 0x11 signature.
 */
function wireT(calldata: string, chainId = 42431, padding?: number): Uint8Array {
  const calls: unknown[] = [[PATHUSD, num(0), calldata as ViemHex]];
  if (padding !== undefined) calls.push([PATHUSD, num(0), `0x${"00".repeat(padding)}`]);
  const body = toRlp([
    num(chainId),
    num(1),
    num(2),
    num(100000),
    calls as never,
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
  // The id MPP's placement gives the one challenge it places: H's challengeId at position 0.
  const ch = { id: challengeId(H, 0) as string };
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

  it("MV7: the selector, topic, calldata and wire", async () => {
    expect(keccak256(toBytes(M.MV7.selectorSignature)).slice(0, 10)).toBe(TRANSFER_WITH_MEMO_SELECTOR);
    expect(TRANSFER_WITH_MEMO_SELECTOR).toBe(M.MV7.expectSelector);
    expect(keccak256(toBytes(M.MV7.topicSignature))).toBe(TRANSFER_WITH_MEMO_TOPIC);
    expect(memoCalldata(M.fixed.recipient, 1000000n, memo)).toBe(M.MV7.expectCalldata);
    const T = wireT(M.MV7.expectCalldata);
    expect(T.length).toBe(M.MV7.expectWireLength);
    expect(sha256(T)).toBe(M.MV7.expectWireSha256);
    const decoded = decodeTempoTx(T);
    if ("refused" in decoded) throw new Error(decoded.code);
    expect(decoded.chainId).toBe(42431n);
    expect(decoded.validBefore).toBe(1790000060n);
  });

  it("decodeTempoTx refuses what is not a 0x76 transaction", async () => {
    const T = wireT(M.MV7.expectCalldata);
    expect(decodeTempoTx(T.subarray(1))).toEqual({ refused: true, code: "tempo/tx-malformed" });
    expect(decodeTempoTx(new Uint8Array(65_537).fill(0x76))).toEqual({ refused: true, code: "tempo/tx-too-large" });
    const nonCanonical = Uint8Array.from([0x76, 0xc1, 0x81, 0x05]);
    expect(decodeTempoTx(nonCanonical)).toEqual({ refused: true, code: "tempo/tx-malformed" });
  });
});

// splits.expectCalls: the calls that pay the splits request on Tempo, in array order (draft-tempo-charge-00 L273): the
// primary recipient's transfer of amount minus the splits' sum (L233), carrying the challenge's attribution memo, then
// one call per split, transferWithMemo where the split carries a memo (L313-315) and transfer where it does not, each
// to the request's currency. memoCalldata writes the transferWithMemo calls.
describe("mpp-charge-tempo-memo.json splits.expectCalls: memoCalldata's transferWithMemo calls", () => {
  type Call = { to: string; data: string };
  const r = JSON.parse(M.splits.request);
  const splits = r.methodDetails.splits as { amount: string; recipient: ViemHex; memo?: ViemHex }[];
  const primary = BigInt(r.amount) - splits.reduce((t, s) => t + BigInt(s.amount), 0n);
  const id = challengeId(H, 0) as string;
  const transfers = [
    { to: r.recipient as ViemHex, amount: primary, memo: attributionMemo(realm, id) as ViemHex | undefined },
    ...splits.map((s) => ({ to: s.recipient, amount: BigInt(s.amount), memo: s.memo })),
  ];
  const transferSelector = keccak256(toBytes("transfer(address,uint256)")).slice(0, 10);
  const calls = M.splits.expectCalls as Call[];

  it("the calls are the primary transfer, then each split's: transferWithMemo where it carries a memo, transfer where not", () => {
    expect(calls.map((c) => [c.to, c.data.slice(0, 10)])).toEqual(
      transfers.map((t) => [r.currency, t.memo === undefined ? transferSelector : TRANSFER_WITH_MEMO_SELECTOR]),
    );
  });

  // Each call's data is eth-abi 6.0.0's transferWithMemo(address,uint256,bytes32) or transfer(address,uint256) of its
  // recipient, amount and memo, the primary's memo being MV7.expectMemo; viem 2.57.4's encodeFunctionData re-derives each.
  it("the calls are byte for byte eth-abi's and viem's transferWithMemo and transfer calldata of each recipient, amount and memo", () => {
    const abi = parseAbi([
      "function transferWithMemo(address to, uint256 amount, bytes32 memo)",
      "function transfer(address to, uint256 amount)",
    ]);
    expect(transfers[0]!.memo).toBe(M.MV7.expectMemo);
    const memos: (ViemHex | undefined)[] = [M.MV7.expectMemo, ...splits.map((s) => s.memo)];
    const encoded = transfers.map((t, i) => {
      const memo = memos[i];
      const to = t.to.toLowerCase() as ViemHex;
      return {
        to: r.currency,
        data:
          memo === undefined
            ? encodeFunctionData({ abi, functionName: "transfer", args: [to, t.amount] })
            : encodeFunctionData({ abi, functionName: "transferWithMemo", args: [to, t.amount, memo] }),
      };
    });
    expect(encoded).toEqual(calls);
  });

  const withMemo = rowsOf(calls, "mpp-charge-tempo-memo.json splits.expectCalls", {
    keep: ["the transferWithMemo calls", (c) => c.data.startsWith(TRANSFER_WITH_MEMO_SELECTOR)],
    leave: ["the transfer call of the split without a memo, which memoCalldata does not write", (c) => c.data.startsWith(transferSelector)],
  });
  for (const call of withMemo) {
    const i = calls.indexOf(call);
    it(`call ${i}, ${i === 0 ? "the primary transfer" : `split ${i - 1}`}: memoCalldata of its recipient, amount and memo`, () => {
      const t = transfers[i]!;
      expect({ to: r.currency, data: memoCalldata(t.to, t.amount, t.memo!) }).toEqual(call);
    });
  }
});
