// The USDC charges: M3 (usdc/evm, with the usdc draft's example A.1 and the plant), M5 (usdc/gateway), and the
// usdc/solana charge on the Solana charge's vectors. Expected values are the vector files'; canonicalize and js-sha3
// recompute the derivations independently of the package.
import canonicalize from "canonicalize";
import sha3 from "js-sha3";
import { describe, expect, it } from "vitest";
import { domainSeparator, hashTypedData, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
import { b64u, fromB64u, load, withBigints } from "./mpp-fixtures.js";

const EVM = load("mpp-charge-usdc-evm.json");
const SOL = load("mpp-charge-usdc-solana.json");
const GW = load("mpp-charge-usdc-gateway.json");
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
  const doc = (b.advertise as (d: unknown, h: string, l: string, o: unknown) => unknown)([c], F.H, F.link, c);
  if (!Array.isArray(doc)) throw new Error(JSON.stringify(doc));
  return doc[0] as MppChallenge & { id: string };
}

describe("mpp/charge/usdc/evm (M3)", () => {
  const c = issued(EVM.M3.requestJson);

  it("offers the pairing on eip155:84532", () => {
    expect(pairingsOf(c)).toEqual(["mpp/charge/usdc/evm"]);
    expect(network(c)).toBe("eip155:84532");
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
    return out;
  }

  it("build's EIP-3009 digest is the vector's, and bound of the completed credential gives H", async () => {
    const cred = await signed();
    expect(await chargeUsdcEvm.bound(cred)).toBe(F.H);
  });

  it("a nonce taken for another realm gives mpp/nonce-not-usdc-derivation", async () => {
    const cred = await signed();
    const rh = (await usdcRequestHash(c.request)) as `0x${string}`;
    const other = { ...cred, payload: { ...cred.payload, nonce: usdcNonce(F.MV1, F.otherRealm, rh) as string } };
    expect(await chargeUsdcEvm.bound(other)).toEqual(EVM.M3.expectBoundOtherRealm);
  });

  it("a request re-encoded with a space after a colon gives mpp/request-not-jcs", async () => {
    const cred = await signed();
    const notJcs = placedWith(chargeUsdcEvm, issued(EVM.M3.notJcsRequestJson));
    expect(fromB64u(notJcs.request)).toBe(EVM.M3.notJcsRequestJson);
    expect(await chargeUsdcEvm.bound({ ...cred, challenge: notJcs })).toEqual(EVM.M3.expectNotJcs);
  });

  it("reference names the AuthorizationUsed nonce and validBefore, and survives JSON", async () => {
    const cred = await signed();
    const ref = await chargeUsdcEvm.reference(cred);
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
    });
    expect(await chargeUsdcEvm.authorizer(cred)).toBe(F.payer.toLowerCase());
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
    expect({ ...chargeUsdcEvm.pattern, claims: chargeUsdcEvm.claims }).toEqual(EVM.pattern);
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

  it("bound and reference of the Solana charge's V2 wire are that file's", async () => {
    const p = placedWith(chargeUsdcSolana, c);
    const cred = { challenge: p, payload: { type: "transaction", transaction: SOL.V2.wireBase64 } };
    expect(await chargeUsdcSolana.bound(cred)).toBe(SOL.V2.expectBound);
    expect(await chargeUsdcSolana.reference(cred)).toEqual(SOL.V2.expectReference);
  });

  it.each(SOL.refusals.rows as { case: string; externalId?: string; extra?: object; type?: string; dropNetwork?: boolean; expect: unknown }[])(
    "$case",
    (row) => {
      const md = { ...S.request.methodDetails, ...(row.extra ?? {}), ...(row.type !== undefined ? { type: row.type } : {}) };
      if (row.dropNetwork) md.solana = Object.fromEntries(Object.entries(md.solana).filter(([k]) => k !== "network"));
      const r = { ...S.request, methodDetails: md, ...(row.externalId !== undefined ? { externalId: row.externalId } : {}) };
      const o = issued(JSON.stringify(r));
      expect(chargeUsdcSolana.advertise([o], F.H, F.link, o)).toEqual(row.expect);
    },
  );

  it.each(SOL.refusals.credentials.rows as { case: string; payload: object; expect: unknown }[])(
    "pull only: $case",
    async (row) => {
      const cred = { challenge: placedWith(chargeUsdcSolana, c), payload: row.payload };
      expect(await chargeUsdcSolana.bound(cred)).toEqual(row.expect);
      expect(await chargeUsdcSolana.reference(cred)).toEqual(row.expect);
    },
  );

  it("pull only: it reads no landed payment", () => {
    expect(chargeUsdcSolana).not.toHaveProperty("fetchPresented");
    expect(chargeUsdcSolana).not.toHaveProperty("landedTx");
  });

  it("its record is the Solana charge's", () => {
    expect(SOL.patternAs).toBe(chargeSolana.id);
    expect(chargeUsdcSolana.pattern).toEqual(chargeSolana.pattern);
    expect(chargeUsdcSolana.claims).toBe(chargeSolana.claims);
  });
});

describe("mpp/charge/usdc/gateway (M5)", () => {
  const G = GW.fixed;
  const c = issued(GW.M5.requestJson);

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

  it("build's request carries the salt's preimage as data; the client's salt, set before signing, is bound to H", async () => {
    const challenge = placedWith(chargeUsdcGateway, c);
    const u = await chargeUsdcGateway.build({ challenge, from: G.payer, now: 0 }, G.H);
    if ("refused" in u) throw new Error(u.code);
    const preimage = { id: G.MV1, realm: G.realm, requestHash: GW.M5.expectRequestHash, recipient: GW.M5.saltInput.recipient };
    expect(u.request).toEqual({ kind: "gateway-burn-intent", preimage });
    expect(JSON.parse(JSON.stringify(u.request))).toEqual(u.request);
    const { recipient: _r, ...own } = GW.M5.saltInput;
    expect(usdcGatewaySalt({ ...u.request.preimage, ...own })).toBe(GW.M5.expectSalt);
    const burnIntent = GW.M5.payload.authorization.transfer.burnIntent;
    const signature = await privateKeyToAccount(G.payerKey).signTypedData(burnIntentTypedData(burnIntent));
    const cred = u.complete({ source: GW.M5.source, ...GW.M5.payload, burnIntent, signature });
    if ("refused" in cred) throw new Error(cred.code);
    expect(cred.payload).toEqual({ ...GW.M5.payload, authorization: { format: "circle-gateway-v1", transfer: { burnIntent, signature } } });
    expect(await chargeUsdcGateway.bound(cred)).toBe(GW.M5.expectBound);
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
    expect({ ...chargeUsdcGateway.pattern, claims: chargeUsdcGateway.claims }).toEqual(GW.pattern);
  });
});

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
