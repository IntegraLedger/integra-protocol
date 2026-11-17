// Runs the transactionV1 sections of x402-exact-solana.json, x402-upto-solana.json and x402-batch-settlement.json:
// version-1 transactions (SIMD-0385) as the stock @x402/svm 2.31.0 clients write them, read through each pairing's
// bound, reference, status and recover. The stock client is run again here and must write the recorded payload byte
// for byte; @solana/kit 8.4.0's own transaction decoder and @noble/curves' Ed25519 check the message the payer signed.
// Each section's build holds lcp's build of the stock client's inputs, which must ask the payer to sign the stock
// client's message byte for byte. x402-exact-solana.json's changed rows also hold each rule of the version-1 decoder, and where a row names kit,
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
    accepted: { network: string; payTo: string; extra: { feePayer: string; memo: string; transactionVersions: number[] } };
    payload: Payload;
  };
  expectVersionByte: number;
  messageLength: number;
  messageSha256: string;
  expectBound: string;
  expectReference: { network: string; digest: string; feePayer: string; blockhash: string; payee: string; payer: string; h: string };
  landedWireBase64: string;
  txid: string;
  statusRows: { case: string; at: "finalized" | "confirmed"; err: unknown; query: Query; expect: unknown }[];
  expectRecover: string;
  changed: { case: string; wireBase64: string; expect: unknown; kit?: Kit }[];
  landedChanged: { case: string; landedWireBase64: string; query: Query; expect: unknown };
  build: { input: Record<string, string | number> };
}
/** A status read's query: the act and the finality asked for, the one Solana mark. */
type Query = { act: "payment" | "agreement"; finality: "finalized" };
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
  voucher?: { signature: string };
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
    slot: async () => 0n,
    firstAvailableBlock: async () => 0n,
    account: async () => {
      throw new Error("this reference names no nonce account");
    },
  };
}

/**
 * A reader for the read back of a landed version-1 wire, a constructed one: the buyer's account lists the transaction,
 * its memo rendered as `getSignaturesForAddress` renders it (`[length] text`), at `confirmed`; `getTransaction` holds it
 * at `finalized` where `at` is `finalized`, else only at `confirmed`, with the token balances `getTransaction` gives
 * (`meta.postTokenBalances`): each token account a `TransferChecked` of the message names, its owner the payer for the
 * source and the option's payee for the destination; the finalized slot 1,100, the confirmed one 1,120, the blockhash
 * valid at slot 1,000, and every block held from slot 0.
 */
function readBackReader(network: string, at: "finalized" | "confirmed", l: SvmLanded, txid: string, memo: string, owners: { payer: string; payee: string }): SvmReader {
  const tx = decodeSvmTx(l.wire);
  if ("refused" in tx) throw new Error(tx.code);
  const post: { account: number; mint: string; owner: string }[] = [];
  for (const ix of tx.instructions) {
    if (base58.encode(tx.keys[ix.program]!) !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" || ix.data[0] !== 12) continue;
    const [source, mint, destination] = ix.accounts;
    post.push({ account: source!, mint: base58.encode(tx.keys[mint!]!), owner: owners.payer });
    post.push({ account: destination!, mint: base58.encode(tx.keys[mint!]!), owner: owners.payee });
  }
  const held: SvmLanded = { ...l, post };
  return {
    network: network as SvmReader["network"],
    transaction: async (sig, commitment) =>
      sig !== txid || (at === "confirmed" && commitment === "finalized") ? { notFound: true, slot: commitment === "finalized" ? 1100n : 1120n } : held,
    signatures: async (address, page) =>
      address === owners.payer && page.before === undefined ? [{ signature: txid, slot: 1050n, memo: `[${new TextEncoder().encode(memo).length}] ${memo}` }] : [],
    blockhashValid: async () => ({ valid: true, slot: 1000n }),
    slot: async (commitment) => (commitment === "finalized" ? 1100n : 1120n),
    firstAvailableBlock: async () => 0n,
    account: async () => {
      throw new Error("this reference names no nonce account");
    },
  };
}

/** A status answer as the vector files write it: the slot positions as decimal strings. */
const plain = (a: unknown): unknown => JSON.parse(JSON.stringify(a, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/** The section's option, offered alone in a document. */
function offeredAlone(v: V1) {
  return { required: { x402Version: 2, resource: E.fixed.resource, accepts: [v.presented.accepted] }, accepted: v.presented.accepted };
}

/** The Solana message a build asks the payer to sign; a refusal throws its code. */
function messageOf(u: unknown): Uint8Array {
  if (typeof u === "object" && u !== null && "refused" in u) throw new Error((u as unknown as { code: string }).code);
  const b = u as { request?: { message: Uint8Array }; requests?: { kind: string; message: Uint8Array }[] };
  return b.request?.message ?? b.requests!.find((r) => r.kind === "solana-message")!.message;
}

/** A completed payment's payload, or the refusal complete answered. */
const payloadOf = (r: unknown): unknown => (typeof r === "object" && r !== null && "payload" in r ? r.payload : r);

type Codec = {
  bound(p: unknown): Promise<unknown>;
  reference(p: unknown, option: unknown): Promise<unknown>;
  status(ref: never, reader: SvmReader, query: Query): Promise<unknown>;
  recover(input: { network: string; tx: string; option: unknown }, reader: SvmReader): Promise<unknown>;
};

const cases: {
  file: string;
  v: V1;
  changedRows: number;
  codec: Codec;
  wireOf: (payload: Payload) => string;
  withWire: (payload: Payload, wire: string) => Payload;
  stock: (v: V1) => Promise<Stock>;
  build: (v: V1) => Promise<unknown>;
  complete: (built: unknown, payerSignature: Uint8Array, payload: Payload) => unknown;
}[] = [
  {
    file: "x402-exact-solana.json",
    v: E.transactionV1,
    changedRows: 26,
    codec: exactSvm as unknown as Codec,
    wireOf: (p) => p.transaction!,
    withWire: (p, transaction) => ({ ...p, transaction }),
    stock: (v) => stockExact(E.fixed.payerSeed, v.presented.accepted, v.now),
    build: async (v) => {
      const i = v.build.input;
      const u = await exactSvm.build(
        { ...offeredAlone(v), payer: i.payer, decimals: i.decimals, tokenProgram: i.tokenProgram, recentBlockhash: i.recentBlockhash, computeUnitLimit: i.computeUnitLimit, computeUnitPrice: BigInt(i.computeUnitPrice!) } as never,
        E.fixed.H,
      );
      return u;
    },
    complete: (u, sig) => payloadOf((u as { complete(s: Uint8Array): unknown }).complete(sig)),
  },
  {
    file: "x402-upto-solana.json",
    v: U.transactionV1,
    changedRows: 3,
    codec: uptoSvm as unknown as Codec,
    wireOf: (p) => p.openTransaction!,
    withWire: (p, openTransaction) => ({ ...p, openTransaction }),
    stock: (v) => stockUpto(U.fixed.payerSeed, v.presented.accepted, v.now, Uint8Array.of(7, 0, 0, 0, 0, 0, 0, 0)),
    build: async (v) => {
      const i = v.build.input;
      const u = await uptoSvm.build(
        { ...offeredAlone(v), payer: i.payer, nonce: BigInt(i.nonce!), openSlot: BigInt(i.openSlot!), now: i.now, tokenProgram: i.tokenProgram, recentBlockhash: i.recentBlockhash } as never,
        U.fixed.H,
      );
      return u;
    },
    complete: (u, sig) => payloadOf((u as { complete(s: Uint8Array): unknown }).complete(sig)),
  },
  {
    file: "x402-batch-settlement.json",
    v: B.transactionV1,
    changedRows: 3,
    codec: batchSvm as unknown as Codec,
    wireOf: (p) => p.deposit!.transaction,
    withWire: (p, transaction) => ({ ...p, deposit: { ...p.deposit!, transaction } }),
    stock: (v) => stockBatch(B.fixed.svm.payerSeed, v.presented.accepted, v.now, B.fixed.svm.salt, B.fixed.svm.deposit),
    build: async (v) => {
      const i = v.build.input;
      const u = await batchSvm.build(
        { ...offeredAlone(v), payer: i.payer, payerAuthorizer: i.payerAuthorizer, deposit: BigInt(i.deposit!), salt: BigInt(i.salt!), openSlot: BigInt(i.openSlot!), tokenProgram: i.tokenProgram, recentBlockhash: i.recentBlockhash } as never,
        B.fixed.H,
      );
      return u;
    },
    complete: (u, sig, payload) =>
      payloadOf((u as { complete(s: readonly string[]): unknown }).complete([base58.encode(sig), payload.voucher!.signature])),
  },
];

describe.each(cases)("$file transactionV1", ({ v, changedRows, codec, wireOf, withWire, stock, build, complete }) => {
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

  it("lcp's build of the stock client's inputs asks the payer to sign the stock client's message, byte for byte", async () => {
    const stockMessage = Uint8Array.from(getTransactionDecoder().decode(wire).messageBytes);
    const message = messageOf(await build(v));
    expect(message[0]).toBe(0x81);
    expect(Buffer.from(message).equals(Buffer.from(stockMessage))).toBe(true);
  });

  it("lcp's build, completed with the payer's signature from the stock client's wire, writes the stock client's wire, byte for byte", async () => {
    const signature = getTransactionDecoder().decode(wire).signatures[v.build.input.payer as Address];
    expect(signature).toBeTruthy();
    const out = complete(await build(v), Uint8Array.from(signature!), presented.payload) as Payload;
    expect("refused" in out ? out : wireOf(out)).toBe(wireOf(presented.payload));
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
    expect(await codec.reference(presented, presented.accepted)).toEqual(v.expectReference);
  });

  it("each changed member is answered with its row's code, or H for a row within every rule", async () => {
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

  it("reference and recover of the landed wire", async () => {
    const lw = b64(v.landedWireBase64);
    const kit = getTransactionDecoder().decode(lw);
    const feePayer = v.expectReference.feePayer;
    const sig = Uint8Array.from(kit.signatures[feePayer as Address]!);
    expect(base58.encode(sig)).toBe(v.txid);
    expect(ed25519.verify(sig, Uint8Array.from(kit.messageBytes), base58.decode(feePayer))).toBe(true);
    const own = await codec.reference({ ...presented, payload: withWire(presented.payload, v.landedWireBase64) }, presented.accepted);
    expect(own).toEqual({ ...v.expectReference, transaction: v.txid });
    const net = v.expectReference.network;
    const input = { network: net, tx: v.txid, option: presented.accepted };
    expect(await codec.recover(input, readerFor(net, "finalized", landed(lw), v.txid))).toBe(v.expectRecover);
  });

  it("status reads the landed version-1 wire back: each statusRows row, and the landed wire with its memo changed under the same id", async () => {
    const lw = b64(v.landedWireBase64);
    const ref = { ...v.expectReference, transaction: v.txid } as unknown as SvmRef;
    const owners = { payer: v.expectReference.payer, payee: v.expectReference.payee };
    const memo = v.presented.accepted.extra.memo;
    const net = v.expectReference.network;
    for (const row of rowsOf(v.statusRows, "transactionV1.statusRows", { exact: 3 })) {
      const reader = readBackReader(net, row.at, landed(lw, row.err), v.txid, memo, owners);
      expect([row.case, plain(await codec.status(ref as never, reader, row.query))]).toEqual([row.case, row.expect]);
    }
    const changed = v.landedChanged;
    const reader = readBackReader(net, "finalized", landed(b64(changed.landedWireBase64)), v.txid, "lcp:sha256:0x" + "00".repeat(32), owners);
    expect(plain(await codec.status(ref as never, reader, changed.query))).toEqual(changed.expect);
  });
});
