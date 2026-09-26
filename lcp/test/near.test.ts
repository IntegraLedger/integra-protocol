// Runs the NEAR pairing's vector file through the near entry point. Every expected value is the file's, computed with
// borsh-construct 0.1.0, hashlib and PyNaCl 1.6.2.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import {
  exactNear,
  ftTransferArgs,
  nearCarrier,
  nearLapsed,
  pairingOf,
  type NearOutcome,
  type NearPayment,
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
const payment = (signedDelegateAction: string): NearPayment => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted: O,
  payload: { signedDelegateAction },
});
type Fixture = { status: string; delegate: null | { senderId: string; publicKey: string; nonce: string; argsBase64: string }; receipts: NearOutcome["receipts"] };
function readerFor(a: {
  outcome?: Fixture | null | "reader-error";
  finalHeight?: string;
  keyNonce?: string | null;
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
    accessKeyNonce: async () => (a.keyNonce === null || a.keyNonce === undefined ? null : BigInt(a.keyNonce)),
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
    const signed = u.complete({ keyType: 0, bytes: sig }) as NearPayment;
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
    const p = u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) }) as NearPayment;
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
