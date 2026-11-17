// A constructed EVM endpoint for the eip155 reads' tests and read-kit forms: blocks with their times and three heads,
// transactions with their receipts and inputs, `eth_getLogs` over them by address and topics, `eth_call` by a handler,
// a widest range the endpoint takes, and a lowest block it holds. Every answer is built from these, so a read sees one
// consistent ledger; nothing here is a recorded endpoint's answer.
import { ReaderError, type EvmLog, type EvmLogEntry, type EvmReader, type EvmTransaction, type Hex } from "../src/evm.js";

/** A transaction of the constructed ledger: its hash, block, result, logs, and the body `eth_getTransactionByHash` gives. */
export interface ChainTx {
  readonly hash: Hex;
  readonly block: bigint;
  readonly status: 0 | 1;
  readonly logs: readonly EvmLog[];
  readonly from?: Hex;
  readonly to?: Hex | null;
  readonly input?: Hex;
}

/** The constructed ledger. */
export interface Chain {
  readonly network: `eip155:${string}`;
  readonly heads: { readonly finalized: bigint; readonly safe: bigint; readonly latest: bigint };
  /** Each block's timestamp. */
  readonly time: (block: bigint) => bigint;
  readonly txs: readonly ChainTx[];
  /** `eth_call`'s answer, or a rejection. */
  readonly call?: (to: Hex, data: Hex, block: bigint) => Hex | Promise<Hex>;
  /** The widest `eth_getLogs` range the endpoint takes; a wider one is refused `too-large`. */
  readonly maxRange?: bigint;
  /** The lowest block the endpoint holds; a block below it is refused `history`. */
  readonly lowest?: bigint;
  /** A failure every log query gives instead of an answer. */
  readonly logsFault?: () => Error;
  /** A failure the read of the `finalized` head gives instead of an answer, or `malformed`, an answer that is no block. */
  readonly headFault?: () => Error | "malformed";
  /** Absent members of the reader: `logs` or `block`. */
  readonly without?: readonly ("logs" | "block")[];
}

const lower = (s: string): string => s.toLowerCase();

/** The reader of a constructed ledger, with the log of every call it answered. */
export function readerOf(c: Chain): EvmReader & { readonly asked: string[] } {
  const asked: string[] = [];
  const byHash = new Map(c.txs.map((t) => [lower(t.hash), t]));
  const mark = (tag: "latest" | "safe" | "finalized"): bigint => c.heads[tag];
  const reader: EvmReader & { asked: string[] } = {
    asked,
    network: c.network,
    receipt: async (tx) => {
      asked.push(`receipt ${tx}`);
      const t = byHash.get(lower(tx));
      if (t === undefined || t.block > c.heads.latest) return null;
      return { status: t.status, blockNumber: t.block, logs: t.logs.map((l) => ({ ...l, topics: [...l.topics] })) };
    },
    blockNumber: async (tag) => mark(tag),
    transaction: async (tx): Promise<EvmTransaction | null> => {
      asked.push(`transaction ${tx}`);
      const t = byHash.get(lower(tx));
      if (t === undefined || t.block > c.heads.latest) return null;
      return { from: t.from ?? `0x${"00".repeat(20)}`, to: t.to ?? null, input: t.input ?? "0x" };
    },
    call: async (to, data, block) => {
      asked.push(`call ${to} ${data.slice(0, 10)} ${block}`);
      if (c.call === undefined) throw new ReaderError("transport", "no call handler");
      return c.call(to, data, block);
    },
  };
  if (!(c.without ?? []).includes("logs")) {
    reader.logs = async (f) => {
      asked.push(`logs ${f.address ?? "*"} ${f.fromBlock}-${f.toBlock}`);
      if (c.logsFault !== undefined) throw c.logsFault();
      if (c.maxRange !== undefined && f.toBlock - f.fromBlock + 1n > c.maxRange) throw new ReaderError("too-large");
      if (c.lowest !== undefined && f.fromBlock < c.lowest) throw new ReaderError("history");
      const out: EvmLogEntry[] = [];
      for (const t of [...c.txs].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0))) {
        if (t.block < f.fromBlock || t.block > f.toBlock || t.block > c.heads.latest || t.status === 0) continue;
        t.logs.forEach((l, i) => {
          if (f.address !== undefined && lower(f.address) !== lower(l.address)) return;
          if (f.topics.length > l.topics.length) return;
          if (!f.topics.every((x, k) => x === null || lower(x) === lower(l.topics[k]!))) return;
          out.push({ ...l, topics: [...l.topics], transactionHash: t.hash, blockNumber: t.block, logIndex: i });
        });
      }
      return out;
    };
  }
  if (!(c.without ?? []).includes("block")) {
    reader.block = async (at) => {
      asked.push(`block ${at}`);
      if (at === "finalized" && c.headFault !== undefined) {
        const f = c.headFault();
        if (f === "malformed") return { number: -1n, timestamp: 0n };
        throw f;
      }
      const n = typeof at === "bigint" ? at : mark(at);
      if (c.lowest !== undefined && n < c.lowest) throw new ReaderError("history");
      if (n > c.heads.latest) throw new ReaderError("transport", "no such block");
      return { number: n, timestamp: c.time(n) };
    };
  }
  return reader;
}

/** A 32-byte word of an address, for a topic. */
export function topicOf(a: string): Hex {
  return `0x${"00".repeat(12)}${a.slice(2).toLowerCase()}` as Hex;
}

/** One 32-byte word of an unsigned integer. */
export function wordOf(n: bigint): Hex {
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

/** An ABI-encoded `string` return. */
export function abiStringOf(s: string): Hex {
  const b = new TextEncoder().encode(s);
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64 || 64, "0");
  return `0x${(32n).toString(16).padStart(64, "0")}${BigInt(b.length).toString(16).padStart(64, "0")}${padded}` as Hex;
}
