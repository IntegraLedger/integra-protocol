// Runs the MPP Hedera charge vector file through the hedera entry point. Every expected value is the file's, or names its source.
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, toLcpString, type AtrHash } from "../src/index.js";
import { chargeHedera, hederaStatus, type HederaUnsigned } from "../src/hedera.js";
import { attributionMemo, checkAttribution, type MppChallenge, type MppCredential } from "../src/mpp.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-charge-hedera.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** A challenge as MPP's `place` leaves it: the id derived from H and `opaque` naming H and the link. */
function placed(request: unknown = V.fixed.request): MppChallenge & { id: string } {
  return {
    id: V.fixed.challengeId,
    realm: V.fixed.realm,
    method: "hedera",
    intent: "charge",
    request: b64u(canonicalJson(request as never) as string),
    expires: V.fixed.expires,
    opaque: b64u(canonicalJson({ legalContext: toLcpString(H), legalContextUrl: V.fixed.link }) as string),
  };
}
const credential = (payload: MppCredential["payload"]): MppCredential => ({ challenge: placed(), payload });

/** The values of every length-delimited field numbered `n` of a protobuf message, read by the wire format alone. */
function lengthDelimited(buf: Uint8Array, n: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0;
  const varint = (): number => {
    let v = 0;
    for (let shift = 0; ; shift += 7) {
      const b = buf[i++]!;
      v += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return v;
    }
  };
  while (i < buf.length) {
    const key = varint();
    const wt = key & 7;
    if (wt === 0) varint();
    else if (wt === 1) i += 8;
    else if (wt === 5) i += 4;
    else {
      const len = varint();
      if (Math.floor(key / 8) === n) out.push(buf.subarray(i, i + len));
      i += len;
    }
  }
  return out;
}

describe("mpp-charge-hedera.json", () => {
  it("V4: the attribution memo, and a memo of another challenge id", () => {
    expect(attributionMemo(V.V4.realm, V.V4.id)).toBe(V.V4.expectMemo);
    expect(attributionMemo(V.V4.realm, V.V4.id, V.V4.clientId)).toBe(V.V4.expectMemoWithClient);
    expect(checkAttribution(V.V4.expectMemo, V.V4.realm, V.V4.otherId)).toEqual({ refused: true, code: V.V4.expectOther });
    expect(checkAttribution(V.V4.expectMemoWithClient, V.V4.realm, V.V4.id)).toBe(true);
  });

  it("build writes the attribution memo and the legs; the signature completes the transaction", async () => {
    const u = (await chargeHedera.build({ id: V.fixed.challengeId, realm: V.fixed.realm }, V.fixed.request, {
      payer: V.fixed.payer,
      node: V.fixed.node,
      validStart: { seconds: BigInt(V.fixed.validStart.seconds), nanos: V.fixed.validStart.nanos },
      maxFee: BigInt(V.fixed.maxFee),
    })) as HederaUnsigned;
    expect(hex(u.request.bodyBytes)).toBe(V.build.expectBodyBytes);
    const publicKey = Buffer.from(V.fixed.publicKey, "hex");
    const signature = Buffer.from(V.fixed.signature, "hex");
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey.toString("base64url") }, format: "jwk" });
    expect(verify(null, u.request.bodyBytes, key, signature)).toBe(true);
    expect(u.complete({ publicKey, signature, type: "ed25519" })).toBe(V.build.expectTransactionBase64);
  });

  it("build with credentialType hash hands the same body over as a push; transaction or none, as a pull", async () => {
    const P = V.build.push;
    const at = (credentialType?: string) =>
      chargeHedera.build({ id: V.fixed.challengeId, realm: V.fixed.realm }, V.fixed.request, {
        payer: V.fixed.payer,
        node: V.fixed.node,
        validStart: { seconds: BigInt(V.fixed.validStart.seconds), nanos: V.fixed.validStart.nanos },
        maxFee: BigInt(V.fixed.maxFee),
        ...(credentialType !== undefined ? { credentialType: credentialType as never } : {}),
      });
    const asHex = (u: HederaUnsigned) => ({ ...u.request, bodyBytes: hex(u.request.bodyBytes) });
    expect(asHex((await at(P.credentialType)) as HederaUnsigned)).toEqual(P.expectRequest);
    expect(asHex((await at("transaction")) as HederaUnsigned)).toEqual(P.expectPullRequest);
    expect(asHex((await at()) as HederaUnsigned)).toEqual(P.expectPullRequest);
    expect(await at(P.otherCredentialType)).toEqual({ refused: true, code: P.expectOther });
  });

  const reader = (network: string, entries: unknown, throws = false) => ({
    network,
    transactions: async () => {
      if (throws) throw new Error("read failed");
      return entries;
    },
  });

  it("bound and reference of the pull credential; another challenge's memo is refused", async () => {
    const pull = credential({ type: "transaction", transaction: V.build.expectTransactionBase64 });
    expect(await chargeHedera.bound(pull)).toBe(V.bound.expectBound);
    const landed = await chargeHedera.fetchPresented(pull, reader(V.fetchPresented.reader, null) as never);
    const ref = await chargeHedera.reference(landed);
    expect(ref).toEqual(V.bound.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const other = credential({ type: "transaction", transaction: V.bound.otherTransactionBase64 });
    expect(await chargeHedera.bound(other)).toEqual({ refused: true, code: V.bound.expectOther });
  });

  it("a push credential is bound only with the landed memo, which fetchPresented reads", async () => {
    const push = credential({ type: "hash", transactionId: V.push.transactionId });
    expect(await chargeHedera.bound(push)).toEqual({ refused: true, code: V.push.expectWithout });
    const landed = await chargeHedera.fetchPresented(push, reader(V.fetchPresented.reader, V.fetchPresented.entries) as never);
    expect((landed as { landed: unknown }).landed).toEqual(V.fetchPresented.expectLanded);
    expect(await chargeHedera.bound(landed)).toBe(H);
    expect(await chargeHedera.reference(landed)).toEqual(V.push.expectReference);
  });

  it("fetchPresented's refusals", async () => {
    const push = credential({ type: "hash", transactionId: V.push.transactionId });
    for (const row of V.fetchPresented.rows) {
      const r = reader(row.readerNetwork ?? V.fetchPresented.reader, row.entries, row.throws === true);
      expect(await chargeHedera.fetchPresented(push, r as never), row.case).toEqual({ refused: true, code: row.expect });
    }
  });

  it("fetchPresented's network: the request's chainId, else the given default", async () => {
    for (const row of V.fetchPresented.defaults) {
      const methodDetails = row.chainId === undefined ? {} : { chainId: row.chainId };
      const pull = { challenge: placed({ ...V.fixed.request, methodDetails }), payload: { type: "transaction", transaction: V.build.expectTransactionBase64 } };
      const got = await chargeHedera.fetchPresented(pull, reader(V.fetchPresented.reader, null) as never, row.defaultNetwork);
      if (row.expect !== undefined) expect(got, row.case).toEqual({ refused: true, code: row.expect });
      else expect((got as { landed: { network: string } }).landed.network, row.case).toBe(row.expectNetwork);
    }
  });

  it("network", () => {
    for (const row of V.network) {
      const request = row.chainId === undefined ? { ...V.fixed.request, methodDetails: {} } : { ...V.fixed.request, methodDetails: { chainId: row.chainId } };
      const got = chargeHedera.network(request, row.default);
      expect(typeof got === "string" ? got : got.code).toBe(row.expect);
    }
  });

  it("status of the pull reference", async () => {
    const reader = { network: "hedera:testnet" as const, transactions: async () => V.status.entries };
    expect(await hederaStatus(V.bound.expectReference, reader)).toEqual(V.status.expect);
  });

  /** `advertise` of the challenge before placement: the Hedera request checks, then MPP's `place`. */
  const advertised = (c: MppChallenge) => {
    const { id: _id, opaque: _opaque, ...offer } = c;
    return chargeHedera.advertise([offer], H, V.fixed.link, offer);
  };

  it("the request checks", () => {
    expect(advertised(placed())).toEqual([placed()]);
    for (const row of V.requests) expect(advertised(placed(row.request)), row.case).toEqual({ refused: true, code: row.expect });
  });

  // MPP's Hedera charge draft (draft-hedera-charge-00, the request's `amount`): "The value MUST be a positive integer
  // that fits in a 64-bit signed integer".
  it("a request amount of 0 is refused", () => {
    expect(advertised(placed({ ...V.fixed.request, amount: "0", splits: [] }))).toEqual({ refused: true, code: "hedera/option-malformed" });
  });

  it("eight splits build ten token transfer entries, the most a Hedera transaction carries (hiero-consensus-node LedgerConfig tokenTransfers.maxLen, default 10)", async () => {
    const splits = Array.from({ length: 8 }, (_, i) => ({ recipient: `0.0.${70000 + i}`, amount: "1" }));
    const request = { ...V.fixed.request, splits };
    expect(advertised(placed(request))).toEqual([placed(request)]);
    const u = (await chargeHedera.build({ id: V.fixed.challengeId, realm: V.fixed.realm }, request, {
      payer: V.fixed.payer,
      node: V.fixed.node,
      validStart: { seconds: BigInt(V.fixed.validStart.seconds), nanos: V.fixed.validStart.nanos },
      maxFee: BigInt(V.fixed.maxFee),
    })) as HederaUnsigned;
    // TransactionBody.cryptoTransfer (14) → CryptoTransferTransactionBody.tokenTransfers (2) → TokenTransferList.transfers (2)
    const entries = lengthDelimited(u.request.bodyBytes, 14)
      .flatMap((t) => lengthDelimited(t, 2))
      .flatMap((l) => lengthDelimited(l, 2));
    expect(entries.length).toBe(10);
  });

  it("the record states what it proves", () => {
    expect(chargeHedera.pattern.publicProof).toBe(true);
    expect(chargeHedera.pattern.buyerSigns).toBe(false);
    expect(chargeHedera.claims).toBe(true);
  });

  // LCP §8.3.5, Id-Reuse: the memo's nonce, keccak256 of the challenge id that carries H, is a derivation of H on the
  // public ledger, so the binding is visible there (§8.3's On-chain property) but H is not recovered from it.
  it("the record is id-reuse and on chain, and not recoverable from the chain alone", () => {
    expect(chargeHedera.pattern).toMatchObject({ pattern: "id-reuse", onChain: true, zeroPartyRecoverable: false });
  });
});
