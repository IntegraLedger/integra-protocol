// Runs the NEAR pairing's vector file through the near entry point. Every expected value is the file's, computed with
// borsh-construct 0.1.0, hashlib and PyNaCl 1.6.2.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { deserialize, serialize } from "borsh";
import { KeyType, PublicKey, SCHEMA } from "near-api-js";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";
import {
  exactNear,
  ftTransferArgs,
  nearCarrier,
  nearLapsed,
  type NearOutcome,
  type NearReader,
  type NearRef,
} from "../src/near.js";
import type { AtrHash } from "../src/core.js";
import { pairingOf } from "../src/index.js";
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

  // JSON reads 0.0 as the number 0 (RFC 8259 section 6: a number is digits with an optional fraction), so a signer's
  // answer with keyType written 0.0 is keyType 0.
  // secp256k1: under a secp256k1 access key the delegate action ends in key type 1 and the key's 64 bytes, and complete
  // with keyType 1 writes a 65-byte signature. Each is held to the value written by hand from borsh, NEP-366 and NEP-461
  // (secp256k1's case); the signature verifies over the request hash under that key (@noble/curves).
  it("secp256k1: build under a secp256k1 key and complete with keyType 1 give the delegate written by hand", async () => {
    const S = V.secp256k1;
    const key = base58.decode(S.publicKey.slice("secp256k1:".length));
    expect(Buffer.from(secp256k1.getPublicKey(Uint8Array.from(Buffer.from(S.privateKey, "hex")), false)).toString("hex")).toBe(
      `04${Buffer.from(key).toString("hex")}`,
    );
    const u = await exactNear.build({ ...choice(), publicKey: S.publicKey }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.hash).toString("hex")).toBe(S.expectRequestHash);
    const signature = Uint8Array.from(Buffer.from(S.signature, "hex"));
    expect(secp256k1.verify(signature.subarray(0, 64), u.request.hash, Uint8Array.of(4, ...key), { prehash: false })).toBe(true);
    const p = u.complete({ keyType: 1, bytes: signature });
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.signedDelegateAction).toBe(S.expectSignedDelegateAction);
    expect(Buffer.from(p.payload.signedDelegateAction, "base64").length - 66).toBe(S.expectDelegateActionBytes);
    expect(await exactNear.bound(p)).toBe(H);
  });

  it("V2: complete with keyType written 0.0 gives V2's payment", async () => {
    expect(V.V2.keyTypeWritten.keyType).toBe(0);
    const u = await exactNear.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ keyType: V.V2.keyTypeWritten.keyType, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.signedDelegateAction).toBe(V.V2.expectSignedDelegateAction);
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
    for (const row of rowsOf(V.V2.refusals, "x402-exact-near.json V2.refusals")) {
      expect([row.case, await exactNear.bound(payment(row.signedDelegateAction))]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
    const c = nearCarrier(V.V2.expectSignedDelegateAction);
    if ("refused" in c) throw new Error(c.code);
    expect(c.h).toBe(H);
  });

  // V2's signed delegate is borsh: the delegate action (sender and receiver as u32-length strings, a u32 count of
  // actions, nonce, max height, then the key as a one-byte type and its bytes), then the signature as a one-byte type
  // and its bytes. Its key is Ed25519 (type 0, 32 bytes) and its signature Ed25519 (type 0, 64 bytes).
  const v2Bytes = () => Buffer.from(V.V2.expectSignedDelegateAction, "base64");
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };

  // The borsh specification encodes a String as the u32 length and the bytes of its UTF-8 (github.com/near/borsh,
  // "String": utf8_encoding(x) as Vec<u8>). A receiver whose bytes are not UTF-8 is no borsh string; a sender in UTF-8
  // beyond ASCII reads as the characters it encodes.
  it("V2: a delegate's strings are read as UTF-8, and bytes that are not UTF-8 are near/sda-malformed", async () => {
    const bytes = v2Bytes();
    const senderEnd = 4 + bytes.readUInt32LE(0);
    const receiverAt = senderEnd + 4;
    expect(bytes.subarray(receiverAt, receiverAt + 12).toString("latin1")).toBe(O.asset);
    const notUtf8 = Buffer.from(bytes);
    notUtf8[receiverAt + 4] = 0xff;
    const refused = { refused: true, code: "near/sda-malformed" };
    expect(nearCarrier(notUtf8.toString("base64"))).toEqual(refused);
    expect(await exactNear.bound(payment(notUtf8.toString("base64")))).toEqual(refused);
    const payer = "payer-\u00e9.testnet";
    const named = Buffer.concat([u32(Buffer.byteLength(payer)), Buffer.from(payer, "utf8"), bytes.subarray(senderEnd)]);
    const c = nearCarrier(named.toString("base64"));
    if ("refused" in c) throw new Error(c.code);
    expect([c.payer, c.h]).toEqual([payer, H]);
  });

  // NEAR's key and signature enums give type 0 to Ed25519 and 1 to secp256k1, the two x402's NEAR scheme admits
  // ("Signature type and key type MUST be valid NEAR-supported types (`ed25519` or `secp256k1`)",
  // scheme_exact_near.md at f5dd40ef). near-api-js 7.3.1's schema adds type 2, ML-DSA-65, with a 1952-byte key and a
  // 3309-byte signature. V2 with the signature or the delegate's key written as type 2 is no delegate this pairing
  // reads. A delegate of two actions, the second a DeleteKey (variant 6) under a type-2 key, is refused by its count
  // of actions, which is read before the actions.
  it("V2: a delegate whose signature or key is neither Ed25519 nor secp256k1 is near/sda-malformed", async () => {
    const bytes = v2Bytes();
    const delegate = bytes.subarray(0, bytes.length - 65);
    const keyAt = delegate.length - 33;
    const tail = delegate.subarray(delegate.length - 49);
    const senderEnd = 4 + bytes.readUInt32LE(0);
    const actionsAt = senderEnd + 4 + bytes.readUInt32LE(senderEnd);
    const zeroSignature = Buffer.concat([Buffer.from([0]), Buffer.alloc(64)]);
    const mlDsaKey = Buffer.concat([Buffer.from([2]), Buffer.alloc(1952, 1)]);
    const cases = [
      Buffer.concat([delegate, Buffer.from([2]), Buffer.alloc(3309)]),
      Buffer.concat([delegate.subarray(0, keyAt), mlDsaKey, zeroSignature]),
      Buffer.concat([
        delegate.subarray(0, actionsAt),
        u32(2),
        delegate.subarray(actionsAt + 4, delegate.length - tail.length),
        Buffer.from([6]),
        mlDsaKey,
        tail,
        zeroSignature,
      ]),
    ];
    const codes = ["near/sda-malformed", "near/sda-malformed", "near/actions"];
    for (const [i, sda] of cases.map((b) => b.toString("base64")).entries()) {
      expect([i, nearCarrier(sda)]).toEqual([i, { refused: true, code: codes[i] }]);
      expect([i, await exactNear.bound(payment(sda))]).toEqual([i, { refused: true, code: codes[i] }]);
    }
    const mlDsaPublicKey = `ml-dsa-65:${base58.encode(new Uint8Array(1952).fill(1))}`;
    expect(await exactNear.build({ ...choice(), publicKey: mlDsaPublicKey }, H)).toEqual({ refused: true, code: "x402/option-malformed" });
  });

  it("V2 presented under an option with timeout 0 is refused; build under a timeout of 1 opens a window of one block", async () => {
    const [row] = rowsOf(V.V2.presentedOptions, "x402-exact-near.json V2.presentedOptions", { exact: 1 });
    const presented = { ...payment(V.V2.expectSignedDelegateAction), accepted: row.accepted };
    const want = { refused: true, code: row.expect };
    const doc = exactNear.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(row.accepted.maxTimeoutSeconds).toBe(0);
    expect(exactNear.read({ ...doc, accepts: [row.accepted] })).toEqual({ refused: true, code: "x402/no-payable-option" });
    expect([row.case, await exactNear.bound(presented)]).toEqual([row.case, want]);
    expect([row.case, await exactNear.reference(presented)]).toEqual([row.case, want]);
    expect(await exactNear.build({ ...choice(), required: { ...required, accepts: [row.accepted] }, accepted: row.accepted }, H)).toEqual(want);
    // x402's scheme_exact_near: timeoutBlocks = max(1, ceil(maxTimeoutSeconds / estimatedBlockSeconds)), 1 s blocks.
    const accepted = { ...O, maxTimeoutSeconds: 1 };
    const u = await exactNear.build({ ...choice(), required: { ...required, accepts: [accepted] }, accepted }, H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    const ref = await exactNear.reference(p);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.maxBlockHeight).toBe((BigInt(V.fixed.finalHeight) + 1n).toString());
  });

  it("V3: status, nearLapsed and recover on reader fixtures", async () => {
    for (const row of rowsOf(V.V3.status, "x402-exact-near.json V3.status")) {
      expect([row.case, await exactNear.status(REF, readerFor(row))]).toEqual([row.case, row.expect]);
    }
    for (const row of rowsOf(V.V3.lapsed, "x402-exact-near.json V3.lapsed")) {
      expect([row.case, await nearLapsed(REF, readerFor(row))]).toEqual([row.case, row.expect]);
    }
    for (const row of rowsOf(V.V3.recover, "x402-exact-near.json V3.recover")) {
      const got = await exactNear.recover({ network: REF.network, transaction: REF.transaction }, readerFor(row));
      expect([row.case, got]).toEqual([row.case, row.expect]);
    }
  });

  // x402's NEAR scheme settles by a relayed meta transaction, whose outer transaction carries the payer's
  // SignedDelegate (NEP-366). A transaction the relayers know that carries no delegate action is not that payment, and
  // a later read of it gives the same answer: status reads it as failed (docs/guides/rails.md, "Reading settlement":
  // failed is a transaction "that does not carry this payment"), and recover refuses it as not an ft_transfer delegate.
  // A transaction no relayer knows is not found yet.
  it("V3: recover refuses a known transaction with no delegate action near/not-ft-transfer, and an unknown one near/not-found", async () => {
    const landed = V.V3.recover[0];
    const none: Fixture = { ...landed.outcome, delegate: null };
    expect(await exactNear.status(REF, readerFor({ outcome: none }))).toEqual({ state: "failed", why: "not-this-instrument" });
    const recover = (outcome: Fixture | null) =>
      exactNear.recover({ network: REF.network, transaction: REF.transaction }, readerFor({ outcome }));
    expect(await recover(none)).toEqual({ refused: true, code: "near/not-ft-transfer" });
    expect(await recover(null)).toEqual({ refused: true, code: "near/not-found" });
    expect(await recover(landed.outcome)).toBe(landed.expect);
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
  // rules); a public key is written `ed25519:` and the base58 of its 32 bytes (near-api-js PublicKey.toString).
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

  // A secp256k1 key is written `secp256k1:` and the base58 of its 64 bytes, x then y (near-api-js 7.3.1
  // PublicKey.toString). The key here is the public key of the scalar 1, the generator G of secp256k1 (SEC 2 v2.0,
  // §2.4.1). A delegate under such a key, otherwise V3's settled outcome, settles as that row.
  it("V3: a ref whose public key is a secp256k1 key as near-api-js writes it settles", async () => {
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
    for (const row of rowsOf(V.agreedRefusals.rows, "x402-exact-near.json agreedRefusals.rows", {
      keep: ["the rows this test runs at advertise, build, complete, bound or recover", (r) => !r.expect.endsWith("/peer-missing")],
      leave: ["the peer-missing row, which ton-near-peer-missing.test.ts runs with the NEAR SDK and borsh absent", (r) => r.expect.endsWith("/peer-missing")],
    })) {
      const want = { refused: true, code: row.expect };
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

  // RFC 8259 §8.1: implementations "MUST NOT add a byte order mark (U+FEFF) to the beginning of a networked-transmitted
  // JSON text". The agreedRefusals row whose arguments begin with one, read with borsh 2.0.0 and near-api-js 7.3.1's
  // SCHEMA: V2's delegate action with its ft_transfer arguments EF BB BF and V1's arguments, and nothing else changed,
  // signed with fixed.seedHex over SHA-256 of V1's NEP-461 prefix and the delegate action.
  it("the agreedRefusals row whose arguments begin with a byte-order mark is V2's delegate action with only them changed", () => {
    type Signed = {
      delegateAction: { actions: { functionCall: { args: Uint8Array } }[] };
      signature: { ed25519Signature: { data: Uint8Array } };
    };
    const row = V.agreedRefusals.rows.find((r: { case: string }) => r.case.startsWith("args that begin with a byte-order mark"));
    expect(row.expect).toBe("near/args-malformed");
    const read = (b64: string) => deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")) as Signed;
    const led = read(row.signedDelegateAction);
    const v2 = read(V.V2.expectSignedDelegateAction);
    const args = led.delegateAction.actions[0]!.functionCall.args;
    expect(Buffer.from(args).toString("hex")).toBe(`efbbbf${Buffer.from(V.V1.expectArgsUtf8, "utf8").toString("hex")}`);
    const prefix = Buffer.from(V.V1.expectPrefix, "hex");
    const digest = createHash("sha256").update(prefix).update(serialize(SCHEMA.DelegateAction, led.delegateAction)).digest();
    const key = PublicKey.fromString(V.fixed.publicKey).data;
    expect(ed25519.verify(Uint8Array.from(led.signature.ed25519Signature.data), digest, key)).toBe(true);
    led.delegateAction.actions[0]!.functionCall.args = v2.delegateAction.actions[0]!.functionCall.args;
    expect(serialize(SCHEMA.DelegateAction, led.delegateAction)).toEqual(serialize(SCHEMA.DelegateAction, v2.delegateAction));
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
