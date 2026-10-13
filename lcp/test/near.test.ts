// Runs the NEAR pairing's vector file through the near entry point. Every expected value is the file's, computed with
// borsh-construct 0.1.0, hashlib and PyNaCl 1.6.2.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { KeyType, PublicKey } from "@near-js/crypto";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import {
  exactNear,
  ftTransferArgs,
  nearCarrier,
  nearLapsed,
  pairingOf,
  type NearOutcome,
  type NearReader,
  type NearRef,
} from "../src/near.js";
import type { AtrHash } from "../src/core.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const seed = Uint8Array.from(Buffer.from(V.fixed.seedHex, "hex"));
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const choice = () => ({
  required,
  accepted: O,
  payer: V.fixed.payer as string,
  publicKey: V.fixed.publicKey as string,
  accessKeyNonce: BigInt(V.fixed.accessKeyNonce),
  finalHeight: BigInt(V.fixed.finalHeight),
});
const payment = (signedDelegateAction: string) => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted: O,
  payload: { signedDelegateAction },
});
type Fixture = {
  status: string;
  delegate: null | { senderId: string; publicKey: string; nonce: string; receiverId: string; methodName: string; argsBase64: string };
  receipts: NearOutcome["receipts"];
};
function readerFor(a: {
  outcome?: Fixture | null | "reader-error";
  finalHeight?: string;
  keyNonce?: { nonce: string; blockHeight: string } | null;
  relayers?: string[];
}): NearReader {
  return {
    network: V.V3.ref.network,
    relayers: a.relayers ?? V.V3.relayers,
    txStatus: async () => {
      if (a.outcome === "reader-error") throw new ReaderError("transport");
      if (a.outcome === null || a.outcome === undefined) return null;
      const d = a.outcome.delegate;
      return { ...a.outcome, delegate: d === null ? null : { ...d, nonce: BigInt(d.nonce) } };
    },
    finalHeight: async () => BigInt(a.finalHeight ?? "0"),
    accessKeyNonce: async () =>
      a.keyNonce === null || a.keyNonce === undefined
        ? null
        : { nonce: BigInt(a.keyNonce.nonce), blockHeight: BigInt(a.keyNonce.blockHeight) },
  };
}
const REF: NearRef & { transaction: string } = V.V3.ref;

describe("x402-exact-near.json", () => {
  // The interface: "No function throws"; a value that is not a hash is x402's `payload-malformed`, as in `build`.
  it("V1: a value that is not a 32-byte hash is refused, not thrown", () => {
    for (const bad of ["0x12", H.slice(2)] as unknown as AtrHash[]) {
      expect(ftTransferArgs(O.payTo, O.amount, bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("V1: the arguments, the delegate action's bytes and the request hash", async () => {
    const args = ftTransferArgs(O.payTo, O.amount, H);
    if ("refused" in args) throw new Error(args.code);
    expect(new TextDecoder().decode(args)).toBe(V.V1.expectArgsUtf8);
    expect(createHash("sha256").update(args).digest("hex")).toBe(V.V1.expectArgsSha256);
    const u = await exactNear.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("near-delegate");
    expect(Buffer.from(u.request.hash).toString("hex")).toBe(V.V1.expectRequestHash);
    const sig = ed25519.sign(u.request.hash, seed);
    const hexSig = Buffer.from(sig).toString("hex");
    expect(hexSig.startsWith(V.V1.expectSignature.prefix) && hexSig.endsWith(V.V1.expectSignature.suffix)).toBe(true);
    expect(ed25519.verify(sig, u.request.hash, ed25519.getPublicKey(seed))).toBe(true);
    const signed = u.complete({ keyType: 0, bytes: sig });
    if ("refused" in signed) throw new Error(signed.code);
    const bytes = Buffer.from(signed.payload.signedDelegateAction, "base64");
    // SignedDelegate = DelegateAction ‖ key type ‖ 64-byte signature.
    const delegateBytes = bytes.subarray(0, bytes.length - 65);
    expect(delegateBytes.length).toBe(V.V1.expectDelegateActionBytes);
    const prefixed = Buffer.concat([Buffer.from(V.V1.expectPrefix, "hex"), delegateBytes]);
    expect(createHash("sha256").update(prefixed).digest("hex")).toBe(V.V1.expectRequestHash);
  });

  it("V2: complete, bound and reference, and each refusal", async () => {
    const u = await exactNear.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.signedDelegateAction).toBe(V.V2.expectSignedDelegateAction);
    expect(p).toEqual(payment(V.V2.expectSignedDelegateAction));
    expect(await exactNear.bound(p)).toBe(V.V2.expectBound);
    const ref = await exactNear.reference(p);
    expect(ref).toEqual(V.V2.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of V.V2.refusals) {
      expect([row.case, await exactNear.bound(payment(row.signedDelegateAction))]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
    const c = nearCarrier(V.V2.expectSignedDelegateAction);
    if ("refused" in c) throw new Error(c.code);
    expect(c.h).toBe(H);
  });

  it("V2 presented under an option with timeout 0 gives H; build opens a window of one block", async () => {
    for (const row of V.V2.presentedOptions) {
      const p = { ...payment(V.V2.expectSignedDelegateAction), accepted: row.accepted };
      expect([row.case, await exactNear.bound(p)]).toEqual([row.case, row.expectBound]);
      expect([row.case, await exactNear.reference(p)]).toEqual([row.case, row.expectReference]);
    }
    // x402's scheme_exact_near: timeoutBlocks = max(1, ceil(maxTimeoutSeconds / estimatedBlockSeconds)), 1 s blocks.
    const accepted = { ...O, maxTimeoutSeconds: 0 };
    const u = await exactNear.build({ ...choice(), required: { ...required, accepts: [accepted] }, accepted }, H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    const ref = await exactNear.reference(p);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.maxBlockHeight).toBe((BigInt(V.fixed.finalHeight) + 1n).toString());
  });

  it("V3: status, nearLapsed and recover on reader fixtures", async () => {
    for (const row of V.V3.status) {
      expect([row.case, await exactNear.status(REF, readerFor(row))]).toEqual([row.case, row.expect]);
    }
    for (const row of V.V3.lapsed) {
      expect([row.case, await nearLapsed(REF, readerFor(row))]).toEqual([row.case, row.expect]);
    }
    for (const row of V.V3.recover) {
      const got = await exactNear.recover({ network: REF.network, transaction: REF.transaction }, readerFor(row));
      expect([row.case, got]).toEqual([row.case, row.expect]);
    }
  });

  // view_access_key at finality "final" answers the key's nonce with the block_height it read it at (nearcore RPC). A
  // delegate action executes only while the block height is at most maxBlockHeight and its nonce is above the key's, so
  // a key read below the final height read first cannot show that the delegate never executed: the read lags.
  it("V3: a key read below the final height read first is never a lapse", async () => {
    const final = 200000061n;
    for (const [at, want] of [
      [200000050n, false],
      [200000060n, false],
      [final, true],
      [final + 5n, true],
    ] as const) {
      const reader = { ...readerFor({ finalHeight: final.toString() }), accessKeyNonce: async () => ({ nonce: 100n, blockHeight: at }) };
      expect([at, await nearLapsed(REF, reader)]).toEqual([at, want]);
    }
    const bare = { ...readerFor({ finalHeight: final.toString() }), accessKeyNonce: async () => 100n as never };
    expect(await nearLapsed(REF, bare)).toBe(false);
    const unnamed = { ...readerFor({ finalHeight: final.toString() }), accessKeyNonce: async () => ({ nonce: 100n }) as never };
    expect(await nearLapsed(REF, unnamed)).toBe(false);
  });

  // The ref's argsDigest is a 32-byte hash compared as bytes, as hashEquals compares hashes; a ref without one cannot
  // name the instrument, so the read is pending.
  it("V3: status needs the ref's args digest, compared as 32 bytes", async () => {
    const settled = V.V3.status[0];
    const { argsDigest, ...noDigest } = REF;
    expect(await exactNear.status(noDigest as never, readerFor(settled))).toEqual({ state: "pending", why: "unreadable" });
    expect(await exactNear.status({ ...REF, argsDigest: "0x12" as never }, readerFor(settled))).toEqual({ state: "pending", why: "unreadable" });
    const upper = `0x${argsDigest.slice(2).toUpperCase()}` as const;
    expect(await exactNear.status({ ...REF, argsDigest: upper }, readerFor(settled))).toEqual(settled.expect);
    // NEAR account ids are 2 to 64 characters of lowercase letters, digits, ".", "_" and "-", so this ref names no token.
    expect(await exactNear.status({ ...REF, asset: "USDC.testnet" }, readerFor(settled))).toEqual({ state: "pending", why: "unreadable" });
  });

  // A ref that cannot name the delegate is pending before any read. NEAR account ids are lowercase (nearcore's account id
  // rules); a public key is written `ed25519:` and the base58 of its 32 bytes (@near-js/crypto PublicKey.toString).
  it("V3: a ref whose nonce, asset, payer, public key or digest is malformed is pending unreadable, with nothing read", async () => {
    const settled = V.V3.status[0];
    const [, key] = REF.publicKey.split(":") as [string, string];
    const malformed = [
      { nonce: "x" }, { asset: "USDC.testnet" }, { argsDigest: "0x12" },
      { payer: REF.payer.toUpperCase() }, { payer: undefined }, { payer: "" },
      { publicKey: `ED25519:${key}` }, { publicKey: undefined }, { publicKey: key }, { publicKey: `ed25519:${key.slice(0, -2)}` },
      { publicKey: `secp256k1:${key}` },
    ];
    for (const change of malformed) {
      const { reader, calls } = counting(readerFor(settled));
      expect(await exactNear.status({ ...REF, ...change } as typeof REF, reader)).toEqual({ state: "pending", why: "unreadable" });
      expect(calls).toEqual([]);
    }
    expect(await exactNear.status(REF, readerFor(settled))).toEqual(settled.expect);
  });

  // A secp256k1 key is written `secp256k1:` and the base58 of its 64 bytes, x then y (@near-js/crypto 2.5.1
  // PublicKey.toString). The key here is the public key of the scalar 1, the generator G of secp256k1 (SEC 2 v2.0,
  // §2.4.1). A delegate under such a key, otherwise V3's settled outcome, settles as that row.
  it("V3: a ref whose public key is a secp256k1 key as @near-js/crypto writes it settles", async () => {
    const G =
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" +
      "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
    const publicKey = new PublicKey({ keyType: KeyType.SECP256K1, data: Uint8Array.from(Buffer.from(G, "hex")) }).toString();
    const settled = V.V3.status[0];
    const outcome = { ...settled.outcome, delegate: { ...settled.outcome.delegate, publicKey } };
    expect(await exactNear.status({ ...REF, publicKey }, readerFor({ ...settled, outcome }))).toEqual(settled.expect);
  });

  // nearcore's RPC gives a function call's args as base64; an answer that is not base64 is a reader fault, so the read
  // is pending, never failed, once the delegate's sender, key, nonce, receiver and method are the ref's.
  it("V3: a delegate whose args are not base64 is unreadable, after the instrument's other members", async () => {
    const settled = V.V3.status[0];
    const garbled = (delegate: object) => ({ ...settled, outcome: { ...settled.outcome, delegate: { ...settled.outcome.delegate, ...delegate } } });
    expect(await exactNear.status(REF, readerFor(garbled({ argsBase64: "not base64!" })))).toEqual({ state: "pending", why: "unreadable" });
    expect(await exactNear.status(REF, readerFor(garbled({ argsBase64: "not base64!", nonce: "102" })))).toEqual({
      state: "failed",
      why: "not-this-instrument",
    });
  });

  it("plant: a successful outer transaction is not the payment when the token's receipt fails", async () => {
    expect(await exactNear.status(REF, readerFor(V.plant))).toEqual(V.plant.expect);
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of V.agreedRefusals.rows) {
      const want = { refused: true, code: row.expect };
      if (row.expect.endsWith("/peer-missing")) continue;
      if (row.option !== undefined) {
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.option] };
        expect([row.case, exactNear.advertise(doc, H, V.fixed.link, row.option)]).toEqual([row.case, want]);
        expect(pairingOf(row.option)).toBeUndefined();
      } else if (row.signedDelegateAction !== undefined) {
        expect([row.case, await exactNear.bound(payment(row.signedDelegateAction))]).toEqual([row.case, want]);
      } else if (row.publicKey !== undefined) {
        expect(await exactNear.build({ ...choice(), publicKey: row.publicKey }, H)).toEqual(want);
      } else if (row.signatureBytes !== undefined) {
        const u = await exactNear.build(choice(), H);
        if ("refused" in u) throw new Error(u.code);
        expect(u.complete({ keyType: 0, bytes: new Uint8Array(row.signatureBytes) })).toEqual(want);
      } else if (row.case.startsWith("recover when the reader fails")) {
        const r = readerFor({ outcome: "reader-error" });
        expect(await exactNear.recover({ network: REF.network, transaction: REF.transaction }, r)).toEqual(want);
      } else if (row.case.startsWith("recover with no relayer")) {
        const r = readerFor({ relayers: [] });
        expect(await exactNear.recover({ network: REF.network, transaction: REF.transaction }, r)).toEqual(want);
      } else {
        throw new Error(`no runner for ${row.case}`);
      }
    }
  });

  it("the option filter, advertise and read follow x402's document", () => {
    expect(pairingOf(O)).toBe("x402/exact/near");
    const doc = exactNear.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts).toEqual([O]);
    const r = exactNear.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: V.fixed.link, options: [O] });
    expect(exactNear.pattern.publicProof).toBe(true);
    expect(exactNear.pattern.profile).toBe("x402/exact/near/memo");
  });
});
