// A constructed Cardano ledger for the read's tests and the read kit's Cardano forms: every transaction, address and
// answer here is built for the test and marked so; none is a recorded answer of a real endpoint. Transactions are
// CBOR in the ledger's shape, encoded by the small encoder below (RFC 8949, definite lengths), their ids the
// Blake2b-256 of the body's bytes, and their auxiliary data the CIP-20 message lcp's `auxiliaryData` writes.
import { bech32 } from "@scure/base";
import { blake2b } from "@noble/hashes/blake2.js";
import type { AtrHash } from "../src/core.js";
import { auxiliaryData, type CardanoReader, type CardanoRef } from "../src/cardano.js";
import { ReaderError } from "../src/evm.js";

type C = number | bigint | boolean | Uint8Array | C[] | { tag: number; item: C } | Map<C, C>;

/** CBOR, definite lengths: unsigned integers, bytes, arrays, maps, tags and the two booleans. */
export function cbor(v: C): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: bigint): void => {
    const m = major << 5;
    if (n < 24n) out.push(m | Number(n));
    else if (n < 256n) out.push(m | 24, Number(n));
    else if (n < 65536n) out.push(m | 25, Number(n >> 8n), Number(n & 255n));
    else if (n < 4294967296n) out.push(m | 26, ...[24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 255n)));
    else out.push(m | 27, ...[56n, 48n, 40n, 32n, 24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 255n)));
  };
  const put = (x: C): void => {
    if (typeof x === "boolean") out.push(x ? 0xf5 : 0xf4);
    else if (typeof x === "number" || typeof x === "bigint") head(0, BigInt(x));
    else if (x instanceof Uint8Array) {
      head(2, BigInt(x.length));
      out.push(...x);
    } else if (Array.isArray(x)) {
      head(4, BigInt(x.length));
      x.forEach(put);
    } else if (x instanceof Map) {
      head(5, BigInt(x.size));
      for (const [k, v] of x) {
        put(k);
        put(v);
      }
    } else {
      head(6, BigInt(x.tag));
      put(x.item);
    }
  };
  put(v);
  return Uint8Array.from(out);
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fill = (byte: number, n = 28): Uint8Array => new Uint8Array(n).fill(byte);

/** Payment credentials of the constructed ledger, each a key hash of one repeated byte. */
export const CRED = { payer: fill(0xaa), payee: fill(0xbb), other: fill(0xcc), escrow: fill(0xdd) } as const;
export type Who = keyof typeof CRED;
export const credOf = (who: Who | Uint8Array): string =>
  who instanceof Uint8Array ? `key:${hex(who)}` : `${who === "escrow" ? "script" : "key"}:${hex(CRED[who])}`;

/** A testnet enterprise address of a credential (CIP-19 type 6, or 7 for the escrow script), or a base address with a stake part. */
export function addressOf(who: Who | Uint8Array, stake?: number): Uint8Array {
  const key = who instanceof Uint8Array ? who : CRED[who];
  if (stake !== undefined) return Uint8Array.from([0x00, ...key, ...fill(stake)]);
  return Uint8Array.from([who === "escrow" ? 0x70 : 0x60, ...key]);
}
export const bech = (address: Uint8Array): string => bech32.encode("addr_test", bech32.toWords(address), 1023);

/** The Masumi escrow datum of x402's Cardano scheme (its encoding test vector's shape), with field 2's seller key hash. */
export function masumiDatum(seller: Uint8Array): C {
  const addr = (key: Uint8Array): C => ({ tag: 121, item: [{ tag: 121, item: [key] }, { tag: 122, item: [] }] });
  const fields: C[] = [addr(fill(0x11)), { tag: 122, item: [] }, addr(seller)];
  while (fields.length < 19) fields.push(0);
  return { tag: 121, item: fields };
}

export interface TxSpec {
  inputs: string[];
  collateral?: string[];
  /** Each output: to whom (or raw address bytes), its coin, and an inline datum. */
  outputs: { to: Who | Uint8Array; coin: bigint; token?: [string, bigint]; datum?: C | "undecodable"; datumBytes?: Uint8Array }[];
  h?: AtrHash;
  ttl?: bigint;
  valid?: boolean;
}

/** A transaction's bytes and id. */
export function txOf(spec: TxSpec): { id: `0x${string}`; bytes: Uint8Array } {
  const body = new Map<C, C>();
  body.set(0, spec.inputs.map((i) => [Uint8Array.from(Buffer.from(i.split("#")[0]!, "hex")), BigInt(i.split("#")[1]!)]));
  body.set(
    1,
    spec.outputs.map((o) => {
      const m = new Map<C, C>();
      m.set(0, o.to instanceof Uint8Array ? o.to : addressOf(o.to));
      const [policy, qty] = o.token ?? [];
      m.set(1, policy === undefined ? o.coin : [o.coin, new Map([[Uint8Array.from(Buffer.from(policy, "hex")), new Map([[new Uint8Array(0), qty!]])]])]);
      if (o.datumBytes !== undefined) m.set(2, [1, { tag: 24, item: o.datumBytes }]);
      else if (o.datum !== undefined) m.set(2, [1, { tag: 24, item: o.datum === "undecodable" ? Uint8Array.from([0xff]) : cbor(o.datum) }]);
      return m;
    }),
  );
  body.set(2, 170000);
  if (spec.ttl !== undefined) body.set(3, spec.ttl);
  const aux = auxiliaryData(spec.h ?? (`0x${"ee".repeat(32)}` as AtrHash)) as Uint8Array;
  body.set(7, blake2b(aux, { dkLen: 32 }));
  if (spec.collateral !== undefined) body.set(13, spec.collateral.map((i) => [Uint8Array.from(Buffer.from(i.split("#")[0]!, "hex")), BigInt(i.split("#")[1]!)]));
  const bodyBytes = cbor(body);
  const bytes = Uint8Array.from([0x84, ...bodyBytes, 0xa0, spec.valid === false ? 0xf4 : 0xf5, ...aux]);
  return { id: `0x${hex(blake2b(bodyBytes, { dkLen: 32 }))}`, bytes };
}

export interface LedgerTx {
  bytes: Uint8Array;
  height: bigint;
  valid: boolean;
  /** Who holds each input, in the body's order. */
  holders: Who[];
}

/** A constructed ledger, and the reader over it. Slots are 20 per block; heights below `held` are not held. */
export interface World {
  network?: CardanoReader["network"];
  k: bigint;
  tip: bigint;
  /** The lowest height the indexer holds, and whether it holds the genesis block. */
  held: bigint;
  genesis: boolean;
  txs: Map<string, LedgerTx>;
  /** The output the reference's input names, or notFound. */
  output: { address: string; spentBy?: `0x${string}` | null; slot?: bigint } | { notFound: true };
  /** The payer's credential's transactions, listed in height order. */
  listed: { txId: `0x${string}`; blockHeight: bigint }[];
  /** The height the endpoint names before each page. */
  through: bigint;
  /** A lookup of an absent transaction names this slot; the tip's by default. */
  lagSlot?: bigint;
  fail?: "transport" | "too-large" | "malformed";
}

export function readerOf(w: World): CardanoReader & { calls: string[] } {
  const calls: string[] = [];
  const check = (name: string): void => {
    calls.push(name);
    if (w.fail === "transport") throw new Error("down");
    if (w.fail === "too-large") throw new ReaderError("too-large");
  };
  return {
    network: w.network ?? "cardano:preprod",
    calls,
    async securityParam() {
      check("securityParam");
      return (w.fail === "malformed" ? "2160" : w.k) as bigint;
    },
    async tip() {
      check("tip");
      return { blockHeight: w.tip, slot: w.tip * 20n };
    },
    async slotAt(height: bigint) {
      check("slotAt");
      if (height === 0n) return w.genesis ? 0n : null;
      return height >= w.held && height <= w.tip ? height * 20n : null;
    },
    async transaction(id: `0x${string}`, withCbor: boolean) {
      check("transaction");
      const t = w.txs.get(id);
      if (t === undefined) return { notFound: true as const, slot: w.lagSlot ?? w.tip * 20n };
      return { blockHeight: t.height, slot: t.height * 20n, valid: t.valid, ...(withCbor ? { cbor: t.bytes } : {}) };
    },
    async output() {
      check("output");
      return w.output;
    },
    async inputAddresses(id: `0x${string}`) {
      check("inputAddresses");
      return (w.txs.get(id)?.holders ?? []).map((who) => bech(addressOf(who)));
    },
    async credentialTransactions(_cred: string, from: bigint, to: bigint, offset: number) {
      check("credentialTransactions");
      const inRange = w.listed.filter((t) => t.blockHeight >= from && t.blockHeight <= to && t.blockHeight <= w.through);
      return { through: w.through, transactions: inRange.slice(offset, offset + 2), more: inRange.length > offset + 2 };
    },
  };
}

/** The reference's input, held by the payer, and another of the payer's inputs for each other act. */
export const REF_INPUT = `${"12".repeat(32)}#0`;
export const inputN = (n: number): string => `${"34".repeat(32)}#${n}`;

/** A reference for a body of the constructed ledger; a Masumi lock's names the escrow script's address. */
export function refFor(id: `0x${string}`, h: AtrHash, method: CardanoRef["method"], ttl?: bigint): CardanoRef {
  return {
    network: "cardano:preprod",
    txId: id,
    ...(ttl === undefined ? {} : { ttlSlot: ttl.toString() }),
    input: REF_INPUT,
    payee: bech(addressOf("payee")),
    ...(method === "masumi" ? { escrow: bech(addressOf("escrow")) } : {}),
    method,
    h,
  };
}
