// The USDC charges: M3 (usdc/evm, with the usdc draft's example A.1 and the plant), M5 (usdc/gateway), and the
// usdc/solana charge on the Solana charge's vectors. Expected values are the vector files'; canonicalize and js-sha3
// recompute the derivations independently of the package.
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import canonicalize from "canonicalize";
import sha3 from "js-sha3";
import { describe, expect, it } from "vitest";
import {
  domainSeparator,
  hashTypedData,
  parseSignature,
  serializeCompactSignature,
  signatureToCompactSignature,
  toBytes,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_CONFIGS, GatewayClient } from "@circle-fin/x402-batching/client";
import {
  chargeSolana,
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  issuedDigest,
  network,
  pairingsOf,
  usdcGatewaySalt,
  usdcNonce,
  usdcRequestHash,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { TRANSFER_TOPIC, type EvmLog, type EvmRef } from "../src/evm.js";
import { b64u, fromB64u, load, readerFor, topicOf, withBigints, wordOf } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";
import { ledgerReader } from "./eip155-tempo-mpp-ledger.js";

const EVM = load("mpp-charge-usdc-evm.json");
const SOL = load("mpp-charge-usdc-solana.json");
const GW = load("mpp-charge-usdc-gateway.json");
const STX = load("mpp-charge-usdc-stacks.json");
/** The file's buyer B6 row's presented payment. */
const b6 = (V: { buyer: { rows: { name: string; input: { presented: unknown } }[] } }) => V.buyer.rows.find((r) => r.name === "B6")!.input.presented as MppCredential;
const F = EVM.fixed;
const keccakJcs = (v: unknown) => `0x${sha3.keccak256(canonicalize(v)!)}`;

const issued = (requestJson: string): MppChallenge => ({
  realm: F.realm,
  method: "usdc",
  intent: "charge",
  request: b64u(requestJson),
  expires: F.expires,
});
function placedWith(b: { advertise: (...a: never[]) => unknown }, c: MppChallenge): MppChallenge & { id: string } {
  const doc = (b.advertise as (d: unknown, h: string, l: string, o: unknown, p: number) => unknown)([c], F.H, F.link, c, 0);
  if (!Array.isArray(doc)) throw new Error(JSON.stringify(doc));
  return doc[0] as MppChallenge & { id: string };
}

describe("mpp/charge/usdc/evm (M3)", () => {
  const c = issued(EVM.M3.requestJson);

  it("offers the pairing on eip155:84532", () => {
    expect(pairingsOf(c)).toEqual(["mpp/charge/usdc/evm"]);
    expect(network(c)).toBe("eip155:84532");
  });

  // The usdc draft lets the EVM profile's `credentialTypes` hold only `authorization` (draft-usdc-charge-00 L298); the
  // build makes an authorization whatever the list holds, so pairingsOf names the pairing whatever it holds.
  it("pairingsOf admits credentialTypes absent or [\"authorization\"] and decimals 6 alone, as v00 of the draft requires", () => {
    const request = JSON.parse(EVM.M3.requestJson);
    const evm = (e: Record<string, unknown>): string => {
      const details = { ...request.methodDetails.evm, ...e };
      for (const k of Object.keys(e)) if (e[k] === undefined) delete details[k];
      return canonicalize({ ...request, methodDetails: { ...request.methodDetails, evm: details } }) as string;
    };
    for (const credentialTypes of [["authorization", "permit2"], ["permit2"], [], "authorization", ["hash"]]) {
      expect([credentialTypes, pairingsOf(issued(evm({ credentialTypes })))]).toEqual([credentialTypes, { refused: true, code: "mpp/credential-types" }]);
    }
    expect(pairingsOf(issued(evm({ credentialTypes: undefined })))).toEqual(["mpp/charge/usdc/evm"]);
    expect(pairingsOf(issued(evm({ credentialTypes: ["authorization"] })))).toEqual(["mpp/charge/usdc/evm"]);
    for (const decimals of [18, 0, "6", undefined]) {
      expect([decimals, pairingsOf(issued(evm({ decimals })))]).toEqual([decimals, { refused: true, code: "mpp/request-malformed" }]);
    }
  });

  // "Servers MUST verify that request.currency is the native USDC token contract published by Circle for
  // methodDetails.evm.chainId" (draft-usdc-charge-00 L300-301); Circle's *USDC Contract Addresses*, read on 2026-11-17:
  // Base 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, Base Sepolia 0x036CbD53842c5426634e7929541eC2318f3dCF7e, Arc Testnet
  // 0x3600000000000000000000000000000000000000.
  it("pairingsOf names the pairing only where currency is Circle's native USDC for the chainId, in any case of hex", () => {
    const request = JSON.parse(EVM.M3.requestJson);
    const on = (chainId: number, currency: string): string =>
      canonicalize({ ...request, currency, methodDetails: { ...request.methodDetails, evm: { ...request.methodDetails.evm, chainId } } }) as string;
    expect(pairingsOf(issued(on(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")))).toEqual(["mpp/charge/usdc/evm"]);
    expect(pairingsOf(issued(on(5042002, "0x3600000000000000000000000000000000000000")))).toEqual(["mpp/charge/usdc/evm"]);
    expect(pairingsOf(issued(on(84532, "0x036cbd53842c5426634e7929541ec2318f3dcf7e")))).toEqual(["mpp/charge/usdc/evm"]);
    const notNative = { refused: true, code: "mpp/usdc-not-native" };
    // Base Sepolia's token on Base; a token one digit off; a chain Circle publishes no native USDC for.
    expect(pairingsOf(issued(on(8453, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")))).toEqual(notNative);
    expect(pairingsOf(issued(on(84532, "0x036CbD53842c5426634e7929541eC2318f3dCF7f")))).toEqual(notNative);
    expect(pairingsOf(issued(on(31337, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")))).toEqual(notNative);
  });

  it("usdcRequestHash and usdcNonce are the vector's, and canonicalize with js-sha3 agree", async () => {
    const rh = await usdcRequestHash(c.request);
    expect(rh).toBe(EVM.M3.expectRequestHash);
    expect(`0x${sha3.keccak256(canonicalize(JSON.parse(EVM.M3.requestJson))!)}`).toBe(EVM.M3.expectRequestHash);
    expect(usdcNonce(F.MV1, F.realm, rh as `0x${string}`)).toBe(EVM.M3.expectNonce);
    const preimage = { id: F.MV1, method: "usdc", realm: F.realm, intent: "charge", requestHash: EVM.M3.expectRequestHash };
    expect(keccakJcs(preimage)).toBe(EVM.M3.expectNonce);
  });

  async function signed(): Promise<MppCredential> {
    const challenge = placedWith(chargeUsdcEvm, c);
    const u = await chargeUsdcEvm.build({ challenge, from: F.payer, now: F.now, tokenDomain: F.tokenDomain }, F.H);
    if ("refused" in u) throw new Error(u.code);
    if (u.request.kind !== "eip712") throw new Error(u.request.kind);
    const typedData = u.request.typedData as unknown as TypedDataDefinition;
    expect(hashTypedData(typedData)).toBe(EVM.M3.expectDigest);
    expect(u.request.typedData.message.nonce).toBe(EVM.M3.expectNonce);
    expect(u.request.typedData.message.validBefore.toString()).toBe(EVM.M3.expectValidBefore);
    const signature = await privateKeyToAccount(F.payerKey).signTypedData(typedData);
    const out = (u as { complete(s: `0x${string}`): MppCredential | { refused: true } }).complete(signature);
    if ("refused" in out) throw new Error("complete refused");
    // complete's credential is buyer B6's presented, whole; B6's note says how it is written by hand from the draft.
    expect(out).toStrictEqual(b6(EVM));
    expect(JSON.stringify(out.payload)).toBe(JSON.stringify(b6(EVM).payload));
    return out;
  }

  it("build's EIP-3009 digest is the vector's, and bound of the completed credential gives H", async () => {
    const cred = await signed();
    expect(await chargeUsdcEvm.bound(cred)).toBe(F.H);
  });

  // EIP-2098 writes a secp256k1 signature in 64 bytes (viem's serializeCompactSignature of the payer's), and an ERC-1271
  // contract signature has no fixed length, so `complete` takes a signature of 1 to 8192 bytes of hex.
  it("complete takes a signature of 1 to 8192 bytes: EIP-2098's 64-byte form of the payer's", async () => {
    const challenge = placedWith(chargeUsdcEvm, c);
    const u = await chargeUsdcEvm.build({ challenge, from: F.payer, now: F.now, tokenDomain: F.tokenDomain }, F.H);
    if ("refused" in u || u.request.kind !== "eip712") throw new Error("not eip712");
    const complete = (u as { complete(s: `0x${string}`): MppCredential | { refused: true; code: string } }).complete;
    const full = await privateKeyToAccount(F.payerKey).signTypedData(u.request.typedData as unknown as TypedDataDefinition);
    const compact = serializeCompactSignature(signatureToCompactSignature(parseSignature(full)));
    expect(toBytes(compact).length).toBe(64);
    expect((complete(compact) as MppCredential).payload["signature"]).toBe(compact);
    for (const bad of ["0x", `0x${"11".repeat(8193)}`] as const) {
      expect(complete(bad)).toEqual({ refused: true, code: "mpp/credential-malformed" });
    }
  });

  it("a nonce taken for another realm gives mpp/nonce-not-usdc-derivation", async () => {
    const cred = await signed();
    const rh = (await usdcRequestHash(c.request)) as `0x${string}`;
    const other = { ...cred, payload: { ...cred.payload, nonce: usdcNonce(F.MV1, F.otherRealm, rh) as string } };
    expect(await chargeUsdcEvm.bound(other)).toEqual(EVM.M3.expectBoundOtherRealm);
  });

  it("a request re-encoded with a space after a colon gives mpp/request-not-jcs", async () => {
    const cred = await signed();
    const notJcs = { ...cred.challenge, request: b64u(EVM.M3.notJcsRequestJson) };
    expect(fromB64u(notJcs.request)).toBe(EVM.M3.notJcsRequestJson);
    expect(pairingsOf(issued(EVM.M3.notJcsRequestJson))).toEqual(EVM.M3.expectNotJcs);
    expect(chargeUsdcEvm.advertise([issued(EVM.M3.notJcsRequestJson)], F.H, F.link, issued(EVM.M3.notJcsRequestJson), 0)).toEqual(EVM.M3.expectNotJcs);
    expect(await chargeUsdcEvm.bound({ ...cred, challenge: notJcs })).toEqual(EVM.M3.expectNotJcs);
  });

  it("reference names the AuthorizationUsed nonce and validBefore, and survives JSON", async () => {
    const cred = await signed();
    const ref = await chargeUsdcEvm.reference(cred, cred.challenge);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(withBigints(ref));
    expect(ref).toMatchObject({
      network: "eip155:84532",
      settleBy: EVM.M3.expectValidBefore,
      bindingLog: { index: 2, value: EVM.M3.expectNonce },
      search: { topics: [expect.any(String), null, EVM.M3.expectNonce] },
    });
    const currency = JSON.parse(EVM.M3.requestJson).currency;
    expect(ref).toMatchObject({
      authorization: { scheme: "eip3009", at: currency, nonce: EVM.M3.expectNonce, deadline: EVM.M3.expectValidBefore, asset: currency },
      payee: JSON.parse(EVM.M3.requestJson).recipient,
    });
    expect(await chargeUsdcEvm.authorizer(cred)).toBe(F.payer.toLowerCase());
  });

  // A receipt at block 100, finalized 100, holding the authorization's AuthorizationUsed and the Transfer it produced.
  it("status settles on the authorization's use and transfer, on the act payment and on the act agreement, and is before a position at its own block", async () => {
    const cred = await signed();
    const ref = (await chargeUsdcEvm.reference(cred, cred.challenge)) as Exclude<Awaited<ReturnType<typeof chargeUsdcEvm.reference>>, { refused: true }>;
    const p = cred.payload as { from: string; to: string; value: string };
    const currency = JSON.parse(EVM.M3.requestJson).currency as `0x${string}`;
    const logs: EvmLog[] = [
      { address: currency, topics: [ref.bindingLog!.topic0, topicOf(p.from), EVM.M3.expectNonce], data: "0x" },
      { address: currency, topics: [TRANSFER_TOPIC, topicOf(p.from), topicOf(p.to)], data: wordOf(BigInt(p.value)) },
    ];
    const tx = `0x${"22".repeat(32)}` as const;
    const reader = ledgerReader({
      network: ref.network,
      heads: { latest: 100n, safe: 100n, finalized: 100n },
      txs: [{ hash: tx, block: 100n, status: 1, from: p.from as `0x${string}`, to: currency, input: "0x", logs }],
      call: () => `0x${"0".repeat(63)}1`,
    });
    const status = async (query: Parameters<typeof chargeUsdcEvm.status>[2]) =>
      withBigints(await chargeUsdcEvm.status({ ...ref, transaction: tx }, reader, query));
    const settled = { state: "settled", transaction: tx, position: "100", finality: "finalized", foreign: [], presented: "yes" };
    expect(await status({ act: "payment", finality: "finalized" })).toMatchObject(settled);
    expect(chargeUsdcEvm.data.agreement).toBeDefined();
    expect(await status({ act: "agreement", finality: "finalized" })).toMatchObject(settled);
    expect(await status({ act: "payment", finality: "finalized", after: 100n })).toMatchObject({
      state: "failed",
      reason: "before-position",
      transaction: tx,
      position: "100",
      finality: "finalized",
      foreign: [],
    });
    expect(await status({ act: "payment", finality: "finalized", after: 99n })).toMatchObject(settled);
  });

  it("A.1: the draft's request, id and realm give the nonce the draft prints", async () => {
    const rh = await usdcRequestHash(EVM.A1.request);
    expect(rh).toBe(EVM.A1.expectRequestHash);
    expect(usdcNonce(EVM.A1.id, EVM.A1.realm, rh as `0x${string}`)).toBe(EVM.A1.expectNonce);
    expect(usdcNonce(EVM.A1.id, EVM.A1.realm, (rh as string).toUpperCase().replace("0X", "0x") as `0x${string}`)).toBe(
      EVM.A1.expectNonce,
    );
    const pre = (requestHash: string) => ({ id: EVM.A1.id, method: "usdc", realm: EVM.A1.realm, intent: "charge", requestHash });
    expect(keccakJcs(pre(EVM.A1.expectRequestHash))).toBe(EVM.A1.expectNonce);
    const bare = keccakJcs(pre(EVM.A1.expectRequestHash.slice(2)));
    const upper = keccakJcs(pre(`0x${EVM.A1.expectRequestHash.slice(2).toUpperCase()}`));
    expect([bare.slice(0, 10), bare.slice(-4)]).toEqual([EVM.A1.withoutPrefix.prefix, EVM.A1.withoutPrefix.suffix]);
    expect([upper.slice(0, 10), upper.slice(-4)]).toEqual([EVM.A1.upperCase.prefix, EVM.A1.upperCase.suffix]);
  });

  it("plant: the base evm method's challengeHash as the nonce gives mpp/nonce-not-usdc-derivation, never H", async () => {
    const cred = await signed();
    const planted = { ...cred, payload: { ...cred.payload, nonce: EVM.plant.nonce } };
    expect(await chargeUsdcEvm.bound(planted)).toEqual(EVM.plant.expect);
  });

  it("states what it proves", () => {
    expect({ ...chargeUsdcEvm.pattern, proves: chargeUsdcEvm.data.proves, claims: chargeUsdcEvm.claims }).toEqual(EVM.pattern);
  });
});

// usdc's EVM, Stacks and Gateway profiles read no `externalId` (their builds take none, and their derivations hash the
// request as issued); the Solana profile carries the LCP memo in it, as the Solana charge does, so only there is it
// checked. Each request is written in its RFC 8785 form (canonicalize), as the EVM and Gateway derivations need.
describe("externalId is checked only where it is the carrier", () => {
  for (const [name, requestJson, pairing] of [
    ["evm", EVM.M3.requestJson, "mpp/charge/usdc/evm"],
    ["stacks", JSON.stringify(STX.fixed.request), "mpp/charge/usdc/stacks"],
    ["gateway", GW.M5.requestJson, "mpp/charge/usdc/gateway"],
  ] as const) {
    it(`${name}: an externalId of null or a number names the pairing`, () => {
      for (const externalId of [null, 5]) {
        expect(pairingsOf(issued(canonicalize({ ...JSON.parse(requestJson), externalId }) as string))).toEqual([pairing]);
      }
    });
  }

  it("solana: an externalId that is not a string is refused mpp/request-malformed", () => {
    for (const externalId of [null, 5]) {
      expect(pairingsOf(issued(JSON.stringify({ ...SOL.fixed.request, externalId })))).toEqual({ refused: true, code: "mpp/request-malformed" });
    }
  });
});

describe("mpp/charge/usdc/solana", () => {
  const S = SOL.fixed;
  const c = issued(JSON.stringify(S.request));

  it("offers the pairing on Solana devnet, and advertise sets externalId = L", async () => {
    expect(pairingsOf(c)).toEqual(["mpp/charge/usdc/solana"]);
    expect(network(c)).toBe(SOL.V2.expectReference.network);
    const p = placedWith(chargeUsdcSolana, c);
    expect(JSON.parse(fromB64u(p.request)).externalId).toBe(S.L);
    expect(await issuedDigest(p)).toBe(await issuedDigest(c));
  });

  it("unplaced gives the challenge as issued: its request without externalId", () => {
    const jcs = issued(canonicalize(S.request)!);
    const p = placedWith(chargeUsdcSolana, jcs);
    expect(chargeUsdcSolana.unplaced(p)).toEqual({ ...p, request: jcs.request });
  });

  // build is the Solana charge's on the same request: it compiles mpp-charge-solana.json's build message, whose
  // buildMessageSha256 is @solana/kit 8.4.0's compilation of that file's V2 wire message (that file's build.case), and
  // complete writes that file's wire, buildWireSha256, written by hand from the Solana transaction format.
  it("build compiles the Solana charge's message and complete writes its wire, byte for byte its buildMessageSha256 and buildWireSha256", async () => {
    const CS = load("mpp-charge-solana.json");
    const p = placedWith(chargeUsdcSolana, c);
    const u = await chargeUsdcSolana.build(
      { challenge: p, payer: CS.fixed.payer, computeUnitLimit: CS.build.computeUnitLimit, computeUnitPrice: BigInt(CS.build.computeUnitPrice) },
      S.H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(createHash("sha256").update(u.request.message).digest("hex")).toBe(CS.build.buildMessageSha256);
    const seed = Uint8Array.from(Buffer.from(load("x402-exact-solana.json").fixed.payerSeed, "hex"));
    const cred = u.complete(ed25519.sign(u.request.message, seed));
    if ("refused" in cred) throw new Error(cred.code);
    const wire = Buffer.from(cred.payload["transaction"] as string, "base64");
    expect(createHash("sha256").update(wire).digest("hex")).toBe(CS.build.buildWireSha256);
  });

  it("bound and reference of the Solana charge's V2 wire are that file's", async () => {
    const p = placedWith(chargeUsdcSolana, c);
    const cred = { challenge: p, payload: { type: "transaction", transaction: SOL.V2.wireBase64 } };
    expect(await chargeUsdcSolana.bound(cred)).toBe(SOL.V2.expectBound);
    expect(await chargeUsdcSolana.reference(cred, p)).toEqual(SOL.V2.expectReference);
  });

  it.each(rowsOf(SOL.refusals.rows as { case: string; externalId?: string; extra?: object; type?: string; dropNetwork?: boolean; expect: unknown }[], "mpp-charge-usdc-solana.json refusals.rows"))(
    "$case",
    (row) => {
      const md = { ...S.request.methodDetails, ...(row.extra ?? {}), ...(row.type !== undefined ? { type: row.type } : {}) };
      if (row.dropNetwork) md.solana = Object.fromEntries(Object.entries(md.solana).filter(([k]) => k !== "network"));
      const r = { ...S.request, methodDetails: md, ...(row.externalId !== undefined ? { externalId: row.externalId } : {}) };
      const o = issued(JSON.stringify(r));
      expect(chargeUsdcSolana.advertise([o], F.H, F.link, o, 0)).toEqual(row.expect);
    },
  );

  it.each(rowsOf(SOL.refusals.credentials.rows as { case: string; payload: object; expect: unknown }[], "mpp-charge-usdc-solana.json refusals.credentials.rows"))(
    "pull only: $case",
    async (row) => {
      const cred = { challenge: placedWith(chargeUsdcSolana, c), payload: row.payload };
      expect(await chargeUsdcSolana.bound(cred)).toEqual(row.expect);
      expect(await chargeUsdcSolana.reference(cred, cred.challenge)).toEqual(row.expect);
    },
  );

  it("pull only: it reads no landed payment", () => {
    expect(chargeUsdcSolana).not.toHaveProperty("fetchPresented");
    expect(chargeUsdcSolana).not.toHaveProperty("landedTx");
  });

  it("its record is the Solana charge's, under its own profile", () => {
    expect(SOL.patternAs).toBe(chargeSolana.id);
    expect(chargeUsdcSolana.pattern).toEqual({ ...chargeSolana.pattern, profile: SOL.profile });
    expect(chargeUsdcSolana.data.proves).toBe(chargeSolana.data.proves);
    expect(chargeUsdcSolana.claims).toBe(chargeSolana.claims);
  });
});

describe("mpp/charge/usdc/gateway (M5)", () => {
  const G = GW.fixed;
  const c = issued(GW.M5.requestJson);

  // The usdc draft's Gateway details (`acceptedSources`, `destinationNetwork`, `maxFee`, `credentialTypes`,
  // draft-usdc-charge-00 L410-414) are what the server checks the payer's transfer against (L770-801); the build hashes
  // the request whole and reads none of them, so pairingsOf names the pairing whatever they hold.
  it("pairingsOf reads none of the Gateway details but credentialTypes", () => {
    const request = JSON.parse(GW.M5.requestJson);
    const edits: Record<string, unknown>[] = [
      { acceptedSources: [] },
      { acceptedSources: Array.from({ length: 33 }, (_, i) => `eip155:${i + 1}`) },
      { destinationNetwork: "base" },
      { maxFee: "0.5" },
    ];
    const gateway = (e: Record<string, unknown>): string =>
      canonicalize({ ...request, methodDetails: { ...request.methodDetails, gateway: { ...request.methodDetails.gateway, ...e } } }) as string;
    for (const e of edits) {
      expect([e, pairingsOf(issued(gateway(e)))]).toEqual([e, ["mpp/charge/usdc/gateway"]]);
    }
    // credentialTypes is read: v00 admits it absent or ["transfer"] alone (draft-usdc-charge-00 at 1f0574a, line 414).
    expect(pairingsOf(issued(gateway({ credentialTypes: ["transfer"] })))).toEqual(["mpp/charge/usdc/gateway"]);
    for (const credentialTypes of [["transfer", "authorization"], ["authorization"], []]) {
      expect([credentialTypes, pairingsOf(issued(gateway({ credentialTypes })))]).toEqual([credentialTypes, { refused: true, code: "mpp/credential-types" }]);
    }
  });

  it("usdcRequestHash and usdcGatewaySalt are the vector's, and canonicalize with js-sha3 agree", async () => {
    expect(pairingsOf(c)).toEqual(["mpp/charge/usdc/gateway"]);
    const rh = await usdcRequestHash(c.request);
    expect(rh).toBe(GW.M5.expectRequestHash);
    const input = { id: G.MV1, realm: G.realm, requestHash: rh as `0x${string}`, ...GW.M5.saltInput };
    expect(usdcGatewaySalt(input)).toBe(GW.M5.expectSalt);
    expect(keccakJcs({ ...input, method: "usdc", intent: "charge", type: "gateway" })).toBe(GW.M5.expectSalt);
  });

  it("the burn intent's EIP-712 domain separator and digest are the record's", () => {
    const td = burnIntentTypedData(GW.M5.payload.authorization.transfer.burnIntent);
    expect(domainSeparator({ domain: td.domain! })).toBe(GW.M5.expectDomainSeparator);
    const d = hashTypedData(td);
    expect([d.slice(0, 10), d.slice(-4)]).toEqual([GW.M5.expectDigest.prefix, GW.M5.expectDigest.suffix]);
  });

  async function credential(saltOverride?: string): Promise<MppCredential> {
    const challenge = placedWith(chargeUsdcGateway, c);
    const burnIntent = structuredClone(GW.M5.payload.authorization.transfer.burnIntent);
    if (saltOverride !== undefined) burnIntent.spec.salt = saltOverride;
    const signature = await privateKeyToAccount(G.payerKey).signTypedData(burnIntentTypedData(burnIntent));
    const payload = structuredClone(GW.M5.payload);
    payload.authorization.transfer = { burnIntent, signature };
    return { challenge, source: GW.M5.source, payload };
  }

  it("bound gives H", async () => {
    expect(await chargeUsdcGateway.bound(await credential())).toBe(GW.M5.expectBound);
  });

  it("build's request carries the salt's preimage as data and the ceiling; the client's salt, set before signing, is bound to H", async () => {
    const challenge = placedWith(chargeUsdcGateway, c);
    const { expectMaxBlockHeight, ...served } = GW.ceiling.good;
    const u = await chargeUsdcGateway.build({ challenge, ...served }, G.H);
    if ("refused" in u) throw new Error(u.code);
    const preimage = { id: G.MV1, realm: G.realm, requestHash: GW.M5.expectRequestHash, recipient: GW.M5.saltInput.recipient };
    expect(u.request).toEqual({ kind: "gateway-burn-intent", preimage, maxBlockHeight: expectMaxBlockHeight });
    expect(GW.M5.payload.authorization.transfer.burnIntent.maxBlockHeight).toBe(expectMaxBlockHeight);
    expect(JSON.parse(JSON.stringify(u.request))).toEqual(u.request);
    const { recipient: _r, ...own } = GW.M5.saltInput;
    expect(usdcGatewaySalt({ ...u.request.preimage, ...own })).toBe(GW.M5.expectSalt);
    const burnIntent = GW.M5.payload.authorization.transfer.burnIntent;
    const signature = await privateKeyToAccount(G.payerKey).signTypedData(burnIntentTypedData(burnIntent));
    const cred = u.complete({ source: GW.M5.source, ...GW.M5.payload, burnIntent, signature });
    if ("refused" in cred) throw new Error(cred.code);
    expect(cred.payload).toEqual({ ...GW.M5.payload, authorization: { format: "circle-gateway-v1", transfer: { burnIntent, signature } } });
    // The credential is held whole, as JSON text, to the Gateway Transfer credential the usdc draft writes
    // (draft-usdc-charge-00, blob ec7fc1868b, L615-636 and A.4 L1304-1349): challenge, source, then M5's payload, its
    // members in the draft's order, with the signature made here.
    const byHand = {
      challenge,
      source: GW.M5.source,
      payload: {
        type: "transfer",
        sourceNetwork: GW.M5.payload.sourceNetwork,
        destinationNetwork: GW.M5.payload.destinationNetwork,
        maxFee: GW.M5.payload.maxFee,
        authorization: { format: "circle-gateway-v1", transfer: { burnIntent, signature } },
      },
    };
    expect(JSON.stringify(GW.M5.payload)).toBe(JSON.stringify({ ...byHand.payload, authorization: GW.M5.payload.authorization }));
    expect(JSON.stringify(cred)).toBe(JSON.stringify(byHand));
    expect(await chargeUsdcGateway.bound(cred)).toBe(GW.M5.expectBound);
  });

  describe("the ceiling: maxBlockHeight at the served burnIntentExpirationHeight plus 100 s in the wallet's withdrawalDelay pace", () => {
    const { expectMaxBlockHeight: _m, ...good } = GW.ceiling.good;
    const challenge = () => placedWith(chargeUsdcGateway, c);

    for (const row of rowsOf(GW.ceiling.built as { case: string; burnIntentExpirationHeight: string; withdrawalDelay: string; expectMaxBlockHeight: string }[], "mpp-charge-usdc-gateway.json ceiling.built", { exact: 5 })) {
      it(`build writes ${row.case}`, async () => {
        const u = await chargeUsdcGateway.build({ challenge: challenge(), burnIntentExpirationHeight: row.burnIntentExpirationHeight, withdrawalDelay: row.withdrawalDelay }, G.H);
        if ("refused" in u) throw new Error(u.code);
        expect(u.request.maxBlockHeight).toBe(row.expectMaxBlockHeight);
      });
    }

    for (const row of rowsOf(GW.ceiling.buildRefusals as { case: string; omit?: string; set?: Record<string, unknown>; expect: unknown }[], "mpp-charge-usdc-gateway.json ceiling.buildRefusals", { exact: 8 })) {
      it(`build refuses ${row.case}`, async () => {
        const choice: Record<string, unknown> = { challenge: challenge(), ...good, ...row.set };
        if (row.omit !== undefined) delete choice[row.omit];
        expect(await chargeUsdcGateway.build(choice as never, G.H)).toEqual(row.expect);
      });
    }

    async function completed(burnIntent: Record<string, unknown>) {
      const u = await chargeUsdcGateway.build({ challenge: challenge(), ...good }, G.H);
      if ("refused" in u) throw new Error(u.code);
      const signature = await privateKeyToAccount(G.payerKey).signTypedData(burnIntentTypedData(GW.M5.payload.authorization.transfer.burnIntent));
      const { authorization: _a, type: _t, ...own } = GW.M5.payload;
      return u.complete({ source: GW.M5.source, ...own, burnIntent: burnIntent as never, signature });
    }

    it("complete takes the burn intent signed at the ceiling", async () => {
      const cred = await completed(structuredClone(GW.M5.payload.authorization.transfer.burnIntent));
      if ("refused" in cred) throw new Error(cred.code);
      expect(await chargeUsdcGateway.bound(cred)).toBe(GW.M5.expectBound);
    });

    for (const row of rowsOf(GW.ceiling.completeRefusals as { case: string; stock?: boolean; expectStockMaxBlockHeight?: string; set?: string; omit?: boolean; expect: unknown }[], "mpp-charge-usdc-gateway.json ceiling.completeRefusals", { exact: 6 })) {
      it(`complete refuses ${row.case}`, async () => {
        const burnIntent: Record<string, unknown> = structuredClone(GW.M5.payload.authorization.transfer.burnIntent);
        if (row.stock === true) {
          const stock = stockBurnIntent(G.payerKey);
          expect(stock.maxBlockHeight).toBe(row.expectStockMaxBlockHeight);
          expect({ ...stock.spec, salt: GW.M5.expectSalt }).toEqual(burnIntent["spec"]);
          stock.spec.salt = GW.M5.expectSalt;
          expect(await completed(stock)).toEqual(row.expect);
          return;
        }
        if (row.omit === true) delete burnIntent["maxBlockHeight"];
        else burnIntent["maxBlockHeight"] = row.set;
        expect(await completed(burnIntent)).toEqual(row.expect);
      });
    }
  });

  it("a salt computed for another realm gives mpp/salt-not-usdc-derivation", async () => {
    const rh = (await usdcRequestHash(c.request)) as `0x${string}`;
    const other = usdcGatewaySalt({ id: G.MV1, realm: G.otherRealm, requestHash: rh, ...GW.M5.saltInput }) as string;
    expect([other.slice(0, 10), other.slice(-4)]).toEqual([GW.M5.otherRealmSalt.prefix, GW.M5.otherRealmSalt.suffix]);
    expect(await chargeUsdcGateway.bound(await credential(other))).toEqual(GW.M5.expectSaltRefusal);
  });

  it("a salt computed with sourceSigner as the bare address gives mpp/salt-not-usdc-derivation", async () => {
    const rh = (await usdcRequestHash(c.request)) as `0x${string}`;
    const input = { id: G.MV1, realm: G.realm, requestHash: rh, ...GW.M5.saltInput, sourceSigner: GW.M5.bareSignerSalt.sourceSigner };
    const bare = usdcGatewaySalt(input) as string;
    expect([bare.slice(0, 10), bare.slice(-4)]).toEqual([GW.M5.bareSignerSalt.prefix, GW.M5.bareSignerSalt.suffix]);
    expect(await chargeUsdcGateway.bound(await credential(bare))).toEqual(GW.M5.expectSaltRefusal);
  });

  it("a burnIntentSet in place of the transfer gives mpp/gateway-unread", async () => {
    const cred = await credential();
    const payload = structuredClone(cred.payload) as { authorization: { transfer: unknown } };
    const t = payload.authorization.transfer as { burnIntent: unknown; signature: string };
    payload.authorization.transfer = { burnIntentSet: { intents: [t.burnIntent] }, signature: t.signature };
    expect(await chargeUsdcGateway.bound({ ...cred, payload } as MppCredential)).toEqual(GW.M5.expectSetRefusal);
  });

  it("states what it proves", () => {
    expect({ ...chargeUsdcGateway.pattern, proves: chargeUsdcGateway.data.proves, claims: chargeUsdcGateway.claims }).toEqual(GW.pattern);
  });
});

/**
 * The burn intent Circle's own client builds, `GatewayClient.createBurnIntent` (@circle-fin/x402-batching 4.0.0,
 * dist/client/index.mjs:1472-1495), from Arc Testnet to Base Sepolia for M5's value, fee and recipient, as that client
 * writes it to Gateway's `/transfer` (bigints as decimal strings, :1420-1423). Nothing is fetched or signed.
 */
function stockBurnIntent(key: `0x${string}`): { maxBlockHeight: string; maxFee: string; spec: Record<string, unknown> } {
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: key });
  const make = (client as unknown as { createBurnIntent: (...a: unknown[]) => unknown }).createBurnIntent.bind(client);
  const intent = make(client.chainConfig, CHAIN_CONFIGS.baseSepolia, { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }, 25000000n, GW.M5.saltInput.recipient, 500000n);
  return JSON.parse(JSON.stringify(intent, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

/** The Circle Gateway burn intent as EIP-712 typed data: domain `{GatewayWallet, 1}` only, as Circle Gateway defines it. */
function burnIntentTypedData(b: { maxBlockHeight: string; maxFee: string; spec: Record<string, unknown> }): TypedDataDefinition {
  const bytes32 = [
    "sourceContract",
    "destinationContract",
    "sourceToken",
    "destinationToken",
    "sourceDepositor",
    "destinationRecipient",
    "sourceSigner",
    "destinationCaller",
  ];
  return {
    domain: { name: "GatewayWallet", version: "1" },
    types: {
      TransferSpec: [
        { name: "version", type: "uint32" },
        { name: "sourceDomain", type: "uint32" },
        { name: "destinationDomain", type: "uint32" },
        ...bytes32.map((name) => ({ name, type: "bytes32" })),
        { name: "value", type: "uint256" },
        { name: "salt", type: "bytes32" },
        { name: "hookData", type: "bytes" },
      ],
      BurnIntent: [
        { name: "maxBlockHeight", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "spec", type: "TransferSpec" },
      ],
    },
    primaryType: "BurnIntent",
    message: { maxBlockHeight: BigInt(b.maxBlockHeight), maxFee: BigInt(b.maxFee), spec: { ...b.spec, value: BigInt(b.spec["value"] as string) } },
  } as TypedDataDefinition;
}
