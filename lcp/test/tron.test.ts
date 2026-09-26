// Runs the Tron pairing's vector file through the tron entry point. Every expected value is the file's, taken from
// a live mainnet transaction, coincurve 21.0.0, base58 2.1.1, pycryptodome 3.23.0 and
// hashlib.
import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import {
  TRANSFER_TOPIC,
  decodeTronTx,
  encodeTronRaw,
  exactTronMemo,
  pairingOf,
  tronAddress,
  tronCarrier,
  type TronInfo,
  type TronPayment,
  type TronReader,
  type TronRef,
} from "../src/tron.js";
import { hash, type AtrHash } from "../src/core.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tron-lcp-trc20-memo.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const txOf = (rawHex: string, sigHex: string) => {
  const raw = bytes(rawHex);
  const len: number[] = [];
  let n = raw.length;
  while (n >= 0x80) {
    len.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
  len.push(n);
  return hex(Uint8Array.from([0x0a, ...len, ...raw, 0x12, 0x41, ...bytes(sigHex)]));
};
const payment = (transaction: string): TronPayment => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted: O,
  payload: { transaction },
});
const choice = () => ({
  required,
  accepted: O,
  payer: V.fixed.payer as string,
  refBlock: { number: BigInt(V.fixed.refBlock.number), id: V.fixed.refBlock.id },
  now: BigInt(V.fixed.now),
  feeLimit: BigInt(V.fixed.feeLimit),
});

type Answer = { blockNumber: string; result: string; logs: TronInfo["logs"] } | null | "reader-error";
function readerFor(a: {
  solid?: Answer;
  head?: Answer;
  solidHead?: { number: string; timestamp: string } | null;
  rawDataHex?: string | null;
}): TronReader {
  const info = (x: Answer | undefined): TronInfo | null => {
    if (x === "reader-error") throw new ReaderError("transport");
    if (x === null || x === undefined) return null;
    return { blockNumber: BigInt(x.blockNumber), result: x.result, logs: x.logs };
  };
  return {
    network: V.V4.ref.network,
    info: async (_txid, level) => info(level === "solid" ? a.solid : a.head),
    transaction: async () => {
      if (a.rawDataHex === "reader-error") throw new ReaderError("transport");
      return a.rawDataHex === null || a.rawDataHex === undefined ? null : { rawDataHex: a.rawDataHex };
    },
    solidHead: async () => {
      if (a.solidHead === null || a.solidHead === undefined) throw new ReaderError("transport");
      return { number: BigInt(a.solidHead.number), timestamp: BigInt(a.solidHead.timestamp) };
    },
  };
}
const REF: TronRef = V.V4.ref;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

describe("x402-exact-tron-lcp-trc20-memo.json", () => {
  it("V1: the live mainnet transaction decodes, re-encodes byte-equal and hashes to its id", async () => {
    const d = decodeTronTx(txOf(V.V1.rawHex, V.V1.signatureForPayload));
    if ("refused" in d) throw new Error(d.code);
    const r = d.raw;
    expect({
      refBlockBytes: hex(r.refBlockBytes),
      refBlockHash: hex(r.refBlockHash),
      expiration: r.expiration.toString(),
      data: hex(r.data),
      owner: hex(r.owner),
      contractAddress: hex(r.contractAddress),
      callData: hex(r.callData),
      timestamp: r.timestamp.toString(),
      feeLimit: r.feeLimit.toString(),
    }).toEqual(V.V1.expectDecoded);
    expect(new TextDecoder().decode(r.data)).toBe(V.V1.expectDataUtf8);
    expect(hex(encodeTronRaw(r))).toBe(V.V1.rawHex);
    expect(await hash(d.rawBytes)).toBe(V.V1.expectTxid);
    expect(await exactTronMemo.bound(payment(txOf(V.V1.rawHex, V.V1.signatureForPayload)))).toEqual(V.V1.expectBound);
  });

  it("V2: build gives the vector's raw data and id, and complete the vector's 360-byte transaction", async () => {
    const u = await exactTronMemo.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("tron-txid");
    expect("0x" + hex(u.request.txid)).toBe(V.V2.expectTxid);

    const key = bytes(V.fixed.payerKey);
    const recovered = secp256k1.sign(u.request.txid, key, { prehash: false, format: "recovered" });
    const signature = Uint8Array.from([...recovered.subarray(1), recovered[0]!]);
    expect(hex(signature)).toBe(V.V2.expectSignature);
    const pub = secp256k1.recoverPublicKey(recovered, u.request.txid, { prehash: false });
    expect(hex(pub)).toBe(hex(secp256k1.getPublicKey(key)));
    expect(hex((await tronAddress(V.V2.expectRecoversTo)) as Uint8Array)).toBe(V.fixed.payerBytes);

    const paid = u.complete(signature);
    expect(paid).toEqual(V.V2.expectPayload);
    const d = decodeTronTx((paid as TronPayment).payload.transaction);
    if ("refused" in d) throw new Error(d.code);
    expect(hex(d.rawBytes)).toBe(V.V2.expectRawHex);
    expect(hex(d.raw.refBlockBytes)).toBe(V.V2.expectRefBlockBytes);
    expect(hex(d.raw.refBlockHash)).toBe(V.V2.expectRefBlockHash);
    expect(await tronCarrier(d)).toEqual({ h: H, txid: V.V2.expectTxid });
  });

  it("V3: bound and reference, and each refusal", async () => {
    const p = payment(V.V2.expectTransactionHex);
    expect(await exactTronMemo.bound(p)).toBe(V.V3.expectBound);
    const ref = await exactTronMemo.reference(p);
    expect(ref).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of V.V3.refusals) {
      expect([row.case, await exactTronMemo.bound(payment(row.transaction))]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
  });

  it("V4: status and recover on reader fixtures", async () => {
    for (const row of V.V4.status) {
      const got = await exactTronMemo.status(REF, readerFor(row));
      expect([row.case, plain(got)]).toEqual([row.case, row.expect]);
    }
    for (const row of V.V4.recover) {
      const got = await exactTronMemo.recover({ network: REF.network, txid: REF.txid }, readerFor(row));
      expect([row.case, got]).toEqual([row.case, row.expect]);
    }
    expect(TRANSFER_TOPIC).toBe(V.fixed.transferTopic);
  });

  it("plant: a Transfer-topic log from another contract is never the settlement", async () => {
    expect(plain(await exactTronMemo.status(REF, readerFor({ solid: V.plant.solid })))).toEqual(V.plant.expect);
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of V.agreedRefusals.rows) {
      if (row.option !== undefined) {
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.option] };
        expect([row.case, exactTronMemo.advertise(doc, H, V.fixed.link, row.option)]).toEqual([
          row.case,
          { refused: true, code: row.expect },
        ]);
        expect(pairingOf(row.option)).toBeUndefined();
      } else if (row.transaction !== undefined) {
        expect([row.case, await exactTronMemo.bound(payment(row.transaction))]).toEqual([
          row.case,
          { refused: true, code: row.expect },
        ]);
      } else if (row.payer !== undefined) {
        expect(await exactTronMemo.build({ ...choice(), payer: row.payer }, H)).toEqual({ refused: true, code: row.expect });
      } else if (row.feeLimit !== undefined) {
        for (const f of row.feeLimit) {
          expect(await exactTronMemo.build({ ...choice(), feeLimit: BigInt(f) }, H)).toEqual({
            refused: true,
            code: row.expect,
          });
        }
      } else if (row.refBlockId !== undefined) {
        const c = choice();
        expect(await exactTronMemo.build({ ...c, refBlock: { ...c.refBlock, id: row.refBlockId } }, H)).toEqual({
          refused: true,
          code: row.expect,
        });
        expect(await exactTronMemo.build({ ...c, now: 0n }, H)).toEqual({ refused: true, code: row.expect });
      } else if (row.signatureV !== undefined) {
        const u = await exactTronMemo.build(choice(), H);
        if ("refused" in u) throw new Error(u.code);
        const s = bytes(V.V2.expectSignature);
        s[64] = row.signatureV;
        expect(u.complete(s)).toEqual({ refused: true, code: row.expect });
        expect(u.complete(s.subarray(0, 64))).toEqual({ refused: true, code: row.expect });
      } else if (row.case.startsWith("bound with payload.transaction")) {
        const p = { ...payment(""), payload: { transaction: 7 } };
        expect(await exactTronMemo.bound(p)).toEqual({ refused: true, code: row.expect });
      } else if (row.case.startsWith("recover when the reader fails")) {
        const r = readerFor({ rawDataHex: "reader-error" });
        expect(await exactTronMemo.recover({ network: REF.network, txid: REF.txid }, r)).toEqual({
          refused: true,
          code: row.expect,
        });
      } else if (row.case.startsWith("recover of raw data")) {
        const r = readerFor({ rawDataHex: V.V1.rawHex });
        expect(await exactTronMemo.recover({ network: REF.network, txid: REF.txid }, r)).toEqual({
          refused: true,
          code: row.expect,
        });
      } else {
        throw new Error(`no runner for ${row.case}`);
      }
    }
  });

  it("the option filter, advertise and read follow x402's document", async () => {
    expect(pairingOf(O)).toBe("x402/exact/tron/lcp-trc20-memo");
    const doc = exactTronMemo.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(O);
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: V.fixed.link });
    const r = exactTronMemo.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: V.fixed.link, options: [O] });
    expect(exactTronMemo.unplaced(O)).toBe(O);
    expect(exactTronMemo.pattern.publicProof).toBe(true);
    expect(exactTronMemo.claims).toBe(true);
    expect(exactTronMemo.carrier).toBeNull();
  });

  it("a network mismatch is pending for status and wrong-reader for recover", async () => {
    const r = { ...readerFor({}), network: "tron:3448148188" as const };
    expect(await exactTronMemo.status(REF, r)).toEqual({ state: "pending", why: "unreadable" });
    expect(await exactTronMemo.recover({ network: REF.network, txid: REF.txid }, r)).toEqual({
      refused: true,
      code: "tron/wrong-reader",
    });
  });
});
