// Runs x402-exact-stellar-precondition.json and stellar-position.json through the stellar and x402-exact-stellar entry
// points. Every expected value is the files'.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import { muxedFor, parseStellarPosition, readSignedPayload, signedPayload, stellarPosition } from "../src/stellar.js";
import { exactStellarPrecondition as codec } from "../src/x402-exact-stellar.js";
import { pairingOf } from "../src/index.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const V = load("x402-exact-stellar-precondition.json");
const P = load("stellar-position.json");
const refused = (code: string) => ({ refused: true, code });
const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;
const option = V.fixed.option;
const required = { x402Version: 2, resource: V.fixed.resource, accepts: [option] } as never;
const choice = { required, accepted: option, simulatedXdr: V.build.simulatedXdr, currentLedger: V.build.currentLedger, payer: V.fixed.buyer };
const presentedWith = (envelope: string, accepted: unknown = option) => ({ x402Version: 2, accepted, payload: { transaction: envelope } });

describe("stellar-position.json", () => {
  it("compose: each ledger and order is the position, and parses back", () => {
    for (const r of rowsOf(P.compose, "compose", { exact: 6 })) {
      expect(stellarPosition(r.ledger, r.order)).toBe(r.p);
      expect(parseStellarPosition(r.p)).toEqual({ ledger: r.ledger, order: r.order });
    }
  });
  it("horizon: each paging_token of Horizon's examples parses to its ledger", () => {
    for (const r of rowsOf(P.horizon, "horizon", { exact: 4 })) {
      const got = parseStellarPosition(r.paging_token);
      if ("refused" in got) throw new Error(got.code);
      expect(got.ledger, r.paging_token).toBe(r.ledger);
    }
  });
  it("parseRefused and composeRefused: one member changed is refused", () => {
    for (const r of rowsOf(P.parseRefused, "parseRefused", { exact: 9 })) expect(parseStellarPosition(r.p), r.case).toEqual(refused(r.expect));
    for (const r of rowsOf(P.composeRefused, "composeRefused", { exact: 5 })) {
      expect(stellarPosition(r.ledger, r.order), r.case).toEqual(refused(r.expect));
    }
  });
  it("muxed: M(payee, P)", () => {
    expect(muxedFor(P.muxed.payee, P.muxed.position)).toBe(P.muxed.M);
  });
});

describe("x402-exact-stellar-precondition.json", () => {
  it("payload: H then the int64, its signer key's payload, and back", () => {
    for (const r of rowsOf(V.payload, "payload", { exact: 3 })) {
      const got = signedPayload(r.h, BigInt(r.value));
      if ("refused" in got) throw new Error(got.code);
      expect(hex(got), r.case).toBe(r.payload);
      const key = xdr.SignerKey.fromXdr(r.signerKeyXdr, "base64").toXdrObject();
      if (key.type !== 3) throw new Error("not a signed payload signer");
      expect(hex(key.ed25519SignedPayload.payload), r.case).toBe(r.payload);
      expect(readSignedPayload(got), r.case).toEqual({ h: r.h, value: BigInt(r.value) });
    }
    expect(readSignedPayload(new Uint8Array(41))).toEqual(refused("stellar/carrier-mismatch"));
  });

  it("build: the preimage, the payload, and the signed envelope byte for byte; bound and reference of it", async () => {
    const u = await codec.build(choice as never, V.fixed.H);
    if ("refused" in u) throw new Error(u.code);
    expect(createHash("sha256").update(u.request.preimage).digest("hex")).toBe(V.build.expectPreimageSha256);
    expect(hex(u.request.payload)).toBe(V.build.expectPayload);
    const payment = u.complete({ entry: Buffer.from(V.build.entrySignature, "hex"), payload: Buffer.from(V.build.payloadSignature, "hex") });
    if ("refused" in payment) throw new Error(payment.code);
    expect(payment.payload.transaction).toBe(V.build.expectEnvelope);
    expect(payment).toEqual(V.build.expectPayment);
    const presented = presentedWith(V.build.expectEnvelope);
    expect(await codec.bound(presented)).toBe(V.fixed.H);
    expect(await codec.reference(presented, option)).toEqual(V.build.expectReference);
    expect(pairingOf(option)).toBe("x402/exact/stellar/precondition");
  });

  it("refusedBuild: a choice with one member changed", async () => {
    for (const r of rowsOf(V.refusedBuild, "refusedBuild", { exact: 7 })) {
      expect(await codec.build({ ...choice, ...r.change } as never, V.fixed.H), r.case).toEqual(refused(r.expect));
    }
  });

  it("refusedBound: the built envelope with one member changed", async () => {
    for (const r of rowsOf(V.refusedBound, "refusedBound", { exact: 7 })) {
      expect(await codec.bound(presentedWith(r.envelope)), r.case).toEqual(refused(r.expect));
    }
  });

  it("refusedFilter and acceptedFilter: an option with one member changed, at advertise, read and bound", async () => {
    const doc = (o: unknown) => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }) as never;
    for (const r of rowsOf(V.refusedFilter, "refusedFilter", { exact: 11 })) {
      const o = { ...option, ...r.change };
      expect(codec.advertise(doc(o), V.fixed.H, V.fixed.link, o), r.case).toEqual(refused(r.expect));
      expect(await codec.bound(presentedWith(V.build.expectEnvelope, o)), r.case).toEqual(refused(r.expect));
    }
    for (const r of rowsOf(V.acceptedFilter, "acceptedFilter", { exact: 1 })) {
      const o = { ...option, ...r.change };
      expect("refused" in codec.advertise(doc(o), V.fixed.H, V.fixed.link, o), r.case).toBe(false);
    }
  });

  it("refusedReference: a presented accepted that is not the option given", async () => {
    for (const r of rowsOf(V.refusedReference, "refusedReference", { exact: 1 })) {
      expect(await codec.reference(presentedWith(V.build.expectEnvelope), { ...option, ...r.change }), r.case).toEqual(refused(r.expect));
    }
  });
});
