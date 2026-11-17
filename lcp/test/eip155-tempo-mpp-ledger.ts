// A constructed EVM ledger for the MPP pairings on EVM chains and on Tempo: blocks, the three heads, transactions with
// their receipts, logs and signed bytes, and the contract calls a read makes, answered through `EvmSearchReader`.
// The read kit's forms of this family arrange each case of read-status.json on such a ledger; a constructed ledger is
// marked as one, so that it is never taken for a recorded answer of an endpoint.
import type { Hex } from "../src/evm-abi.js";
import type { EvmLog, EvmReceipt, EvmTransaction } from "../src/evm.js";
import { ReaderError } from "../src/evm.js";
import type { EvmLogEntry, EvmSearchReader } from "../src/mpp.js";
import type { CaseMark } from "./read-kit/form.js";

/** This ledger is constructed, not recorded from an endpoint. */
export const CONSTRUCTED = true;

/** One transaction on the ledger: its hash, block, result, sender, call, logs and, where given, its signed bytes. */
export interface LedgerTx {
  readonly hash: Hex;
  readonly block: bigint;
  readonly status: 0 | 1;
  readonly from: Hex;
  readonly to: Hex | null;
  readonly input: Hex;
  readonly logs: readonly EvmLog[];
  readonly raw?: Hex;
}

/** A reader method that rejects, and the error it rejects with. */
export interface LedgerFault {
  readonly method: "receipt" | "transaction" | "call" | "logs" | "block" | "blockNumber" | "raw" | "all";
  readonly error: unknown;
}

export interface LedgerSpec {
  readonly network: string;
  /** The block numbers of the three heads: `finalized` <= `safe` <= `latest`. */
  readonly heads: { readonly latest: bigint; readonly safe: bigint; readonly finalized: bigint };
  readonly txs: readonly LedgerTx[];
  /** A block's timestamp; 1,000 + 12 seconds a block where absent. */
  readonly timestamp?: (block: bigint) => bigint;
  /** `eth_call` of `data` to `to` in the state after `block`; rejects as `transport` where absent. */
  readonly call?: (to: Hex, data: Hex, block: bigint) => Hex | Promise<Hex>;
  /** The largest range, `toBlock - fromBlock + 1`, that `logs` answers; larger ranges reject `transport`. */
  readonly logRange?: bigint;
  readonly fault?: LedgerFault;
}

const timestampOf = (spec: LedgerSpec, n: bigint): bigint => (spec.timestamp ?? ((b: bigint) => 1000n + 12n * b))(n);

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The reader of a constructed ledger: every member answers from `spec`, and `spec.fault` rejects its method. */
export function ledgerReader(spec: LedgerSpec): EvmSearchReader & { readonly calls: string[] } {
  const calls: string[] = [];
  const guard = (method: LedgerFault["method"]): void => {
    calls.push(method);
    if (spec.fault !== undefined && (spec.fault.method === method || spec.fault.method === "all")) throw spec.fault.error;
  };
  const byHash = (tx: Hex): LedgerTx | undefined => spec.txs.find((t) => same(t.hash, tx));
  const visible = (t: LedgerTx): boolean => t.block <= spec.heads.latest;
  return {
    calls,
    network: spec.network as EvmSearchReader["network"],
    async receipt(tx: Hex): Promise<EvmReceipt | null> {
      guard("receipt");
      const t = byHash(tx);
      return t === undefined || !visible(t) ? null : { status: t.status, blockNumber: t.block, logs: t.logs };
    },
    async blockNumber(tag: "safe" | "finalized"): Promise<bigint> {
      guard("blockNumber");
      return spec.heads[tag];
    },
    async transaction(tx: Hex): Promise<EvmTransaction | null> {
      guard("transaction");
      const t = byHash(tx);
      return t === undefined || !visible(t) ? null : { from: t.from, to: t.to, input: t.input };
    },
    async call(to: Hex, data: Hex, block: bigint): Promise<Hex> {
      guard("call");
      if (spec.call === undefined) throw new ReaderError("transport", "no call on this ledger");
      return spec.call(to, data, block);
    },
    async logs(filter): Promise<readonly EvmLogEntry[]> {
      guard("logs");
      const { address, topics, fromBlock, toBlock } = filter;
      if (spec.logRange !== undefined && toBlock - fromBlock + 1n > spec.logRange) {
        throw new ReaderError("transport", "range refused");
      }
      const out: EvmLogEntry[] = [];
      const ordered = [...spec.txs].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
      for (const t of ordered) {
        if (t.status !== 1 || t.block < fromBlock || t.block > toBlock || !visible(t)) continue;
        t.logs.forEach((log, logIndex) => {
          if (address !== undefined && !same(log.address, address)) return;
          if (topics.some((want, i) => want !== null && (log.topics[i] === undefined || !same(log.topics[i]!, want)))) return;
          out.push({ ...log, transactionHash: t.hash, blockNumber: t.block, logIndex });
        });
      }
      return out;
    },
    async block(at): Promise<{ number: bigint; timestamp: bigint }> {
      guard("block");
      const n = typeof at === "bigint" ? at : spec.heads[at];
      if (n > spec.heads.latest) throw new ReaderError("transport", "no such block");
      return { number: n, timestamp: timestampOf(spec, n) };
    },
    async raw(tx: Hex): Promise<Hex | null> {
      guard("raw");
      const t = byHash(tx);
      return t === undefined || !visible(t) || t.raw === undefined ? null : t.raw;
    },
  };
}

/** The EVM mark of each mark of the cases. */
export const EVM_MARK_OF: Readonly<Record<CaseMark, "latest" | "safe" | "finalized">> = {
  included: "latest",
  safe: "safe",
  final: "finalized",
};

/** The case mark of each EVM mark. */
export const CASE_MARK_OF: Readonly<Record<"latest" | "safe" | "finalized", CaseMark>> = {
  latest: "included",
  safe: "safe",
  finalized: "final",
};

/** A 32-byte transaction hash for a case's transaction name, fixed by the name. */
export function txHashOf(name: string): Hex {
  const hex = Buffer.from(name, "utf8").toString("hex").padStart(64, "0").slice(-64);
  return `0x${hex}`;
}

/** The case's transaction name for a hash `txHashOf` gave, or the hash itself. */
export function txNameOf(hash: string): string {
  const bytes = Buffer.from(hash.slice(2), "hex");
  const name = bytes.subarray(bytes.findIndex((b) => b !== 0)).toString("utf8");
  return txHashOf(name).toLowerCase() === hash.toLowerCase() ? name : hash;
}
