// Runs the transactionV1 sections of x402-exact-solana.json, x402-upto-solana.json and x402-batch-settlement.json:
// version-1 transactions (SIMD-0385) as the stock @x402/svm 2.31.0 clients write them, read through each pairing's
// bound, reference, status and recover. The stock client is run again here and must write the recorded payload byte
// for byte; @solana/kit 8.4.0's own transaction decoder and @noble/curves' Ed25519 check the message the payer signed.
// x402-exact-solana.json's changed rows also hold each rule of the version-1 decoder, and where a row names kit,
// @solana/kit 8.4.0 is run on it and must give the row's verdict.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import {
  createTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isTransactionWithinSizeLimit,
  setTransactionMessageHeapSize,
  type Address,
} from "@solana/kit";
import { ReaderError } from "../src/evm.js";
import { decodeSvmTx, type SvmLanded, type SvmReader, type SvmRef } from "../src/svm.js";
import { batchSvm } from "../src/x402-batch-settlement.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import { rowsOf } from "./rows.js";
import { stockBatch, stockExact, stockUpto, type Stock } from "./stock-svm.js";

/** A transactionV1 section, as the three files write it. */
interface V1 {
  now: number;
  expectAsked: string[];
  presented: {
    x402Version: 2;
    accepted: { network: string; extra: { feePayer: string; transactionVersions: number[] } };
    payload: Payload;
  };
  expectVersionByte: number;
  messageLength: number;
  messageSha256: string;
  expectBound: string;
  expectReference: { network: string; digest: string; feePayer: string; blockhash: string };
  landedWireBase64: string;
  txid: string;
  statusRows: { at: "finalized" | "confirmed"; err: unknown; expect: unknown }[];
  expectRecover: string;
  changed: { case: string; wireBase64: string; expect: unknown; kit?: Kit }[];
  landedChanged: { landedWireBase64: string; expect: unknown };
}
/** @solana/kit 8.4.0's verdict on a changed row's wire. */
type Kit =
  | { check: "isTransactionWithinSizeLimit"; expect: boolean }
  | { check: "messageDecoder"; expect: "throws" }
  | { check: "setTransactionMessageHeapSize"; value: number; expect: "accepts" | "throws" };
/** The payload members that hold the wire: `transaction`, `openTransaction` or `deposit.transaction`. */
interface Payload {
  transaction?: string;
  openTransaction?: string;
  deposit?: { amount: string; transaction: string };
}
const load = (f: string) => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
const E = load("x402-exact-solana.json");
const U = load("x402-upto-solana.json");
const B = load("x402-batch-settlement.json");
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));
const sha256 = (b: Uint8Array): string => `0x${createHash("sha256").update(b).digest("hex")}`;
/** What @solana/kit 8.4.0 answers for `wire` under the row's check. */
function kitVerdict(kit: Kit, wire: Uint8Array): unknown {
  const throws = (f: () => unknown) => {
    try {
      f();
      return "accepts";
    } catch {
      return "throws";
    }
  };
  if (kit.check === "isTransactionWithinSizeLimit") return isTransactionWithinSizeLimit(getTransactionDecoder().decode(wire));
  if (kit.check === "messageDecoder") {
    return throws(() => getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(wire).messageBytes));
  }
  return throws(() => setTransactionMessageHeapSize(kit.value, createTransactionMessage({ version: 1 })));
}
const landed = (wire: Uint8Array, err: unknown = null): SvmLanded => ({ wire, err, loaded: { writable: [], readonly: [] }, inner: [] });

function readerFor(network: string, at: "finalized" | "confirmed" | "reader-error", l: SvmLanded, txid: string): SvmReader {
  return {
    network: network as SvmReader["network"],
    transaction: async (sig, commitment) => {
      if (at === "reader-error") throw new ReaderError("transport");
      if (sig !== txid) return { notFound: true, slot: null };
      if (at === "confirmed" && commitment === "finalized") return { notFound: true, slot: null };
      return l;
    },
    signatures: async () => [],
    blockhashValid: async () => ({ valid: true, slot: 0n }),
    firstAvailableBlock: async () => 0n,
    account: async () => {
      throw new Error("this reference names no nonce account");
    },
  };
}

type Codec = {
  bound(p: unknown): Promise<unknown>;
  reference(p: unknown): Promise<unknown>;
  status(ref: never, reader: SvmReader): Promise<unknown>;
  recover(ref: never, reader: SvmReader): Promise<unknown>;
};

const cases: {
  file: string;
  v: V1;
  changedRows: number;
  codec: Codec;
  wireOf: (payload: Payload) => string;
  withWire: (payload: Payload, wire: string) => Payload;
  stock: (v: V1) => Promise<Stock>;
}[] = [
  {
    file: "x402-exact-solana.json",
    v: E.transactionV1,
    changedRows: 26,
    codec: exactSvm as unknown as Codec,
    wireOf: (p) => p.transaction!,
    withWire: (p, transaction) => ({ ...p, transaction }),
    stock: (v) => stockExact(E.fixed.payerSeed, v.presented.accepted, v.now),
  },
  {
    file: "x402-upto-solana.json",
    v: U.transactionV1,
    changedRows: 3,
    codec: uptoSvm as unknown as Codec,
    wireOf: (p) => p.openTransaction!,
    withWire: (p, openTransaction) => ({ ...p, openTransaction }),
    stock: (v) => stockUpto(U.fixed.payerSeed, v.presented.accepted, v.now, Uint8Array.of(7, 0, 0, 0, 0, 0, 0, 0)),
  },
  {
    file: "x402-batch-settlement.json",
    v: B.transactionV1,
    changedRows: 3,
    codec: batchSvm as unknown as Codec,
    wireOf: (p) => p.deposit!.transaction,
    withWire: (p, transaction) => ({ ...p, deposit: { ...p.deposit!, transaction } }),
    stock: (v) => stockBatch(B.fixed.svm.payerSeed, v.presented.accepted, v.now, B.fixed.svm.salt, B.fixed.svm.deposit),
  },
];

describe.each(cases)("$file transactionV1", ({ v, changedRows, codec, wireOf, withWire, stock }) => {
  const presented = v.presented;
  const wire = b64(wireOf(presented.payload));
  const presentedWith = (w: string) => ({ ...presented, payload: withWire(presented.payload, w) });

  it("the stock client writes the recorded payload, a version-1 transaction, making only the reads named", async () => {
    expect(presented.accepted.extra.transactionVersions).toEqual([0, 1]);
    const { out, asked } = await stock(v);
    expect(asked).toEqual(v.expectAsked);
    expect(out.payload).toEqual(presented.payload);
    expect(wire[0]).toBe(v.expectVersionByte);
  });

  it("lcp's message is the one @solana/kit decodes and the payer signed, and its digest is messageSha256", () => {
    const kit = getTransactionDecoder().decode(wire);
    const message = Uint8Array.from(kit.messageBytes);
    expect(message.length).toBe(v.messageLength);
    expect(sha256(message)).toBe(v.messageSha256);
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    expect(Buffer.from(tx.message).equals(Buffer.from(message))).toBe(true);
    const signers = Object.keys(kit.signatures);
    expect(tx.keys.slice(0, signers.length).map((k) => base58.encode(k))).toEqual(signers);
    expect(signers).toEqual([v.expectReference.feePayer, E.fixed.payer]);
    expect(ed25519.verify(tx.signatures[1]!, message, tx.keys[1]!)).toBe(true);
    expect(tx.signatures[0]!.every((x) => x === 0)).toBe(true);
  });

  it("bound gives H and reference the message's digest, the fee payer and the blockhash", async () => {
    expect(await codec.bound(presented)).toBe(v.expectBound);
    expect(await codec.reference(presented)).toEqual(v.expectReference);
  });

  it("each changed member is refused with its code", async () => {
    for (const row of rowsOf(v.changed, "transactionV1.changed", { exact: changedRows })) {
      expect(await codec.bound(presentedWith(row.wireBase64)), row.case).toEqual(row.expect);
    }
  });

  it("decodeSvmTx alone gives each changed row's svm/tx-* refusal, and decodes every other row", () => {
    for (const row of rowsOf(v.changed, "transactionV1.changed", { exact: changedRows })) {
      const d = decodeSvmTx(b64(row.wireBase64));
      const code = (row.expect as { code?: string }).code;
      if (code?.startsWith("svm/tx-")) expect(d, row.case).toEqual(row.expect);
      else expect("refused" in d ? d.code : "decoded", row.case).toBe("decoded");
    }
  });

  it("@solana/kit 8.4.0 gives each changed row's kit verdict", () => {
    const rows = v.changed.filter((row) => row.kit !== undefined);
    expect(rows).toHaveLength(changedRows === 3 ? 0 : 9);
    for (const row of rows) expect(kitVerdict(row.kit!, b64(row.wireBase64)), row.case).toEqual(row.kit!.expect);
  });

  it("status and recover of the landed wire, and the landed wire with its memo changed", async () => {
    const lw = b64(v.landedWireBase64);
    const kit = getTransactionDecoder().decode(lw);
    const feePayer = v.expectReference.feePayer;
    const sig = Uint8Array.from(kit.signatures[feePayer as Address]!);
    expect(base58.encode(sig)).toBe(v.txid);
    expect(ed25519.verify(sig, Uint8Array.from(kit.messageBytes), base58.decode(feePayer))).toBe(true);
    const own = await codec.reference({ ...presented, payload: withWire(presented.payload, v.landedWireBase64) });
    expect(own).toEqual({ ...v.expectReference, transaction: v.txid });
    const ref = { ...(own as SvmRef), fromSlot: "0" } as never;
    const net = v.expectReference.network;
    for (const row of rowsOf(v.statusRows, "transactionV1.statusRows", { exact: 3 })) {
      expect(await codec.status(ref, readerFor(net, row.at, landed(lw, row.err), v.txid)), JSON.stringify(row)).toEqual(row.expect);
    }
    expect(await codec.recover(ref, readerFor(net, "finalized", landed(lw), v.txid))).toBe(v.expectRecover);
    const changed = b64(v.landedChanged.landedWireBase64);
    expect(await codec.status(ref, readerFor(net, "finalized", landed(changed), v.txid))).toEqual(v.landedChanged.expect);
  });
});
