// Expected values come from vectors/x402-exact-cardano.json: cbor2 and pycardano encodings, a real preprod
// transaction read through Koios, Python's hashlib Blake2b digests, and x402's Cardano scheme for the TTL and the
// confirmation depth. Nothing here is a snapshot of this code.
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/core.js";
import { readFileSync } from "node:fs";
import { ReaderError } from "../src/evm.js";
import {
  LCP_MARKER,
  auxiliaryData,
  cardanoPairingOf,
  decodeCardanoTx,
  exactCardano,
  type CardanoPaymentPayload,
  type CardanoReader,
  type CardanoRef,
} from "../src/cardano.js";
import type { PaymentRequired } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-cardano.json", import.meta.url), "utf8"));
const H: `0x${string}` = V.fixed.H;
const O = V.fixed.O;
const LINK: string = V.fixed.link;
const TX: Record<string, string> = { V2: V.V2.transactionBase64, V3: V.V3.transactionBase64 };
const DEPTH = BigInt(V.V5.depth);

function payment(transaction: string, accepted = O): CardanoPaymentPayload {
  return { x402Version: 2, accepted, payload: { transaction, nonce: V.fixed.nonce } };
}

function bytesOf(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

type Tip = { blockHeight: string; slot: string };
type OnChain = { blockHeight: string; slot: string; valid: boolean } | null;

/** A scripted reader. `slotAt` answers `deep`'s slot at `deep`'s height, and null (no block held) at any other. */
function reader(
  tip: Tip,
  tx: OnChain | "error",
  cbor?: string,
  network = "cardano:preprod",
  deep?: Tip,
): CardanoReader & { calls: number; heights: bigint[] } {
  const r = {
    network: network as CardanoReader["network"],
    calls: 0,
    heights: [] as bigint[],
    async tip() {
      r.calls++;
      if (tx === "error") throw new ReaderError("timeout");
      return { blockHeight: BigInt(tip.blockHeight), slot: BigInt(tip.slot) };
    },
    async slotAt(blockHeight: bigint) {
      r.calls++;
      r.heights.push(blockHeight);
      return deep !== undefined && BigInt(deep.blockHeight) === blockHeight ? BigInt(deep.slot) : null;
    },
    async transaction(_id: `0x${string}`, withCbor: boolean) {
      r.calls++;
      if (tx === "error") throw new ReaderError("timeout");
      if (tx === null) return null;
      return {
        blockHeight: BigInt(tx.blockHeight),
        slot: BigInt(tx.slot),
        valid: tx.valid,
        ...(withCbor && cbor !== undefined ? { cbor: bytesOf(cbor) } : {}),
      };
    },
  };
  return r;
}

function refOf(v: { network: string; txId: string; ttlSlot: string }): CardanoRef {
  return { network: v.network as CardanoRef["network"], txId: v.txId as `0x${string}`, ttlSlot: v.ttlSlot };
}

/** A reference as the issuer stores it: through JSON, which throws on a bigint. The round trip must change nothing. */
function throughJson<T>(v: T): T {
  const back = JSON.parse(JSON.stringify(v)) as T;
  expect(back).toEqual(v);
  return back;
}

function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

function refused(code: string) {
  return { refused: true, code };
}

describe("V1 · the auxiliary data", () => {
  it("is cbor2's and pycardano's 95 bytes", () => {
    const a = auxiliaryData(H);
    if ("refused" in a) throw new Error(a.code);
    expect(a.length).toBe(V.V1.bytes);
    expect(Buffer.from(a).toString("hex")).toBe(V.V1.auxiliaryDataHex);
    expect(LCP_MARKER).toBe("lcp:sha256:0x");
  });

  // The interface: "No function throws"; a value that is not a hash is x402's `payload-malformed`, as in `build`.
  it("a value that is not a 32-byte hash is refused, not thrown", () => {
    for (const bad of ["0x12", H.slice(2)] as unknown as AtrHash[]) {
      expect(auxiliaryData(bad)).toEqual(refused("x402/payload-malformed"));
    }
  });
});

describe("V2 · bound and reference", () => {
  it("bound gives H; reference gives the id and the TTL", async () => {
    const tx = await decodeCardanoTx(V.V2.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.txId).toBe(V.V2.expectReference.txId);
    expect(await exactCardano.bound(payment(V.V2.transactionBase64))).toBe(V.V2.expectBound);
    expect(throughJson(await exactCardano.reference(payment(V.V2.transactionBase64)))).toEqual(V.V2.expectReference);
  });
  it("a CIP-34 alias is normalised", async () => {
    const r = await exactCardano.reference(payment(V.V2.transactionBase64, { ...O, network: "cip34:0-1" }));
    expect(throughJson(r)).toEqual(V.V2.expectReference);
  });
});

describe("V3 · the real rail", () => {
  it("the id is the body's hash; the message carries no hash; no TTL", async () => {
    const tx = await decodeCardanoTx(V.V3.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.txId).toBe(V.V3.txId);
    expect(tx.ttlSlot).toBeNull();
    expect(await exactCardano.bound(payment(V.V3.transactionBase64))).toEqual(refused(V.V3.expectBound));
    expect(await exactCardano.reference(payment(V.V3.transactionBase64))).toEqual(refused(V.V3.expectReference));
  });
});

describe("V4 · refusals", () => {
  for (const row of V.V4) {
    it(row.case, async () => {
      const accepted = row.network !== undefined ? { ...O, network: row.network } : O;
      expect(await exactCardano.bound(payment(row.transactionBase64, accepted))).toEqual(refused(row.expectBound));
    });
  }
  it("a transaction over 64 KiB", async () => {
    expect(await decodeCardanoTx(Buffer.alloc(64 * 1024 + 1).toString("base64"))).toEqual(refused("cardano/tx-too-large"));
  });
  it("nesting deeper than 64", async () => {
    const deep = Buffer.concat([Buffer.alloc(70, 0x81), Buffer.from([0x00])]).toString("base64");
    expect(await decodeCardanoTx(deep)).toEqual(refused("cardano/tx-malformed"));
  });
});

describe("V5 · status and recover", () => {
  for (const row of V.V5.status) {
    it(`status: ${row.case}`, async () => {
      const r = reader(row.tip ?? V.V5.tip, row.readerError ? "error" : row.tx, undefined, undefined, row.deep);
      expect(plain(await exactCardano.status(refOf(V.V5.ref), r, DEPTH))).toEqual(row.expect);
      expect(r.calls).toBeLessThanOrEqual(3);
    });
  }
  it("status: a reader for another network is unreadable", async () => {
    const r = reader(V.V5.tip, V.V5.status[0].tx, undefined, "cardano:preview");
    expect(await exactCardano.status(refOf(V.V5.ref), r, DEPTH)).toEqual({ state: "pending", why: "unreadable" });
  });

  // The block `depth` below the tip decides expiry; above it a block can still be rolled back (x402's Cardano scheme),
  // so an absent transaction whose expiry that block does not show is pending not-found.
  const PAST = { blockHeight: "5216538", slot: "134620400" };
  it("status: slotAt is read only for an absent transaction once the tip's slot is past the TTL", async () => {
    const included = reader(PAST, V.V5.status[0].tx);
    expect(plain(await exactCardano.status(refOf(V.V5.ref), included, DEPTH))).toEqual(V.V5.status[0].expect);
    const early = reader(V.V5.tip, null);
    expect(await exactCardano.status(refOf(V.V5.ref), early, DEPTH)).toEqual({ state: "pending", why: "not-found" });
    expect([included.heights, early.heights]).toEqual([[], []]);
  });
  it("status: a tip fewer than depth blocks high, or no block held at that height, is pending not-found", async () => {
    const low = reader({ blockHeight: "19", slot: "134620400" }, null);
    expect(await exactCardano.status(refOf(V.V5.ref), low, DEPTH)).toEqual({ state: "pending", why: "not-found" });
    expect(low.heights).toEqual([]);
    const none = reader(PAST, null);
    expect(await exactCardano.status(refOf(V.V5.ref), none, DEPTH)).toEqual({ state: "pending", why: "not-found" });
    expect(none.heights).toEqual([5216518n]);
  });
  it("status: depth 0 reads expiry at the tip's own slot, with no slotAt call", async () => {
    const r = reader(PAST, null);
    expect(await exactCardano.status(refOf(V.V5.ref), r, 0n)).toEqual({ state: "failed", why: "expired" });
    expect(r.heights).toEqual([]);
  });
  // The interface: a failed read is pending `unreadable`, and so is a call or an answer outside its types.
  it("status: a failed or malformed slotAt, or a depth that is not a non-negative bigint, is unreadable", async () => {
    const unreadable = { state: "pending", why: "unreadable" };
    const failing = { ...reader(PAST, null), slotAt: async () => Promise.reject(new ReaderError("timeout")) };
    expect(await exactCardano.status(refOf(V.V5.ref), failing, DEPTH)).toEqual(unreadable);
    const malformed = { ...reader(PAST, null), slotAt: async () => "134620001" as never };
    expect(await exactCardano.status(refOf(V.V5.ref), malformed, DEPTH)).toEqual(unreadable);
    for (const depth of [undefined, 20, "20", -1n]) {
      const r = reader(PAST, null);
      expect(await exactCardano.status(refOf(V.V5.ref), r, depth as never)).toEqual(unreadable);
      expect(r.calls).toBe(0);
    }
  });
  for (const row of V.V5.recover) {
    it(`recover: ${row.case}`, async () => {
      const r = reader(V.V5.tip, { blockHeight: "5216518", slot: "134617000", valid: true }, TX[row.cbor]);
      const got = await exactCardano.recover({ network: "cardano:preprod", txId: row.txId }, r);
      expect(got).toEqual(row.expect.startsWith("0x") ? row.expect : refused(row.expect));
    });
  }
  it("recover: wrong reader, failed read, absent, invalid, no cbor, and bytes for another id", async () => {
    const ref = { network: "cardano:preprod" as const, txId: V.V2.expectReference.txId };
    const ok = { blockHeight: "1", slot: "1", valid: true };
    expect(await exactCardano.recover(ref, reader(V.V5.tip, ok, TX["V2"], "cardano:preview"))).toEqual(
      refused("cardano/wrong-reader"),
    );
    expect(await exactCardano.recover(ref, reader(V.V5.tip, "error"))).toEqual(refused("cardano/unreadable"));
    expect(await exactCardano.recover(ref, reader(V.V5.tip, null))).toEqual(refused("cardano/not-found"));
    expect(await exactCardano.recover(ref, reader(V.V5.tip, { ...ok, valid: false }, TX["V2"]))).toEqual(
      refused("cardano/not-valid"),
    );
    expect(await exactCardano.recover(ref, reader(V.V5.tip, ok))).toEqual(refused("cardano/unreadable"));
    expect(await exactCardano.recover(ref, reader(V.V5.tip, ok, TX["V3"]))).toEqual(refused("cardano/unreadable"));
  });
});

describe("plant", () => {
  it("metadata the signed body does not commit to is refused, never read", async () => {
    const got = await exactCardano.bound(payment(V.plant.transactionBase64));
    expect(got).toEqual(refused(V.plant.expectBound));
    expect(got).not.toBe(H);
  });
});

describe("the pairing's filter, advertise, read, build and complete", () => {
  it("takes the named networks, their CIP-34 aliases and the three methods", () => {
    for (const network of ["cardano:mainnet", "cardano:preview", "cip34:1-764824073", "cip34:0-2"]) {
      expect(cardanoPairingOf({ ...O, network })).toBe("x402/exact/cardano");
    }
    for (const m of ["script", "masumi"]) {
      expect(cardanoPairingOf({ ...O, extra: { assetTransferMethod: m } })).toBe("x402/exact/cardano");
    }
    expect(cardanoPairingOf({ ...O, extra: { assetTransferMethod: "eip3009" } })).toBeUndefined();
    expect(cardanoPairingOf({ ...O, extra: { paymentFlow: "upfront" } })).toBeUndefined();
    expect(cardanoPairingOf({ ...O, network: "cip34:0-4" })).toBeUndefined();
  });
  it("advertise and read; build asks for the auxiliary data; complete accepts only a payment bound to H", async () => {
    const required = exactCardano.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, LINK, O);
    if ("refused" in required) throw new Error(required.code);
    const r = exactCardano.read(required as PaymentRequired);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: LINK, options: [O] });
    const u = await exactCardano.build({ required, accepted: O }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("cardano-transaction");
    expect(Buffer.from(u.request.auxiliaryData).toString("hex")).toBe(V.V1.auxiliaryDataHex);
    const signed = await u.complete({ transaction: V.V2.transactionBase64, nonce: V.fixed.nonce });
    if ("refused" in signed) throw new Error(signed.code);
    expect(signed).toEqual({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: O,
      payload: { transaction: V.V2.transactionBase64, nonce: V.fixed.nonce },
      extensions: required.extensions,
    });
    expect(await u.complete({ transaction: V.V3.transactionBase64, nonce: V.fixed.nonce })).toEqual(
      refused("x402/signed-not-bound"),
    );
  });
  it("the pattern states what the record proves", () => {
    expect(exactCardano.pattern).toMatchObject({
      pattern: "native-field",
      canonical: false,
      profile: "x402/exact/cardano",
      buyerSigns: true,
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
      publicProof: true,
    });
    expect(exactCardano.claims).toBe(true);
  });
});
