// A constructed Stacks Blockchain API for the Stacks read's tests and its read-kit form: an in-memory ledger of
// transactions answering the reader's calls as stacks-blockchain-api 9.9.0's routes answer them. Every answer here is
// constructed, none recorded from a live endpoint. Block `h`'s tenure is `h`, and the tenure after it starts at Bitcoin
// height BURN0 + h + 1; the tip's Bitcoin height is BURN0 + finalThrough + 7, so a block is at `bitcoin` exactly where
// it is at or below `finalThrough` (6 Bitcoin blocks from the one after that burn block).
import { ReaderError } from "../src/evm.js";
import type { StacksAssetEvent, StacksLanded, StacksListed, StacksReader } from "../src/stacks.js";

export const BURN0 = 800_000n;

/** A transaction of the ledger: a landed one, or one the API holds unmined. */
export type LedgerTx = (StacksLanded & { order?: number }) | { mined: false; txid: `0x${string}`; status: string };

/** A rejection the reader gives for one of its calls: by `ReaderError`'s kind, or a value of no documented shape. */
export type Fault = { kind: "transport" | "too-large" | "malformed" } | { answer: unknown };

export interface Ledger {
  network: `stacks:${string}`;
  txs: LedgerTx[];
  tipHeight: bigint;
  finalThrough: bigint;
  /** Heights the nonce and block routes answer 404 for, besides those above the tip. */
  unknownHeights?: bigint[];
  /** The lookup by origin and nonce's answer for a nonce, in place of the ledger's. */
  byNonce?: Map<bigint, StacksListed[]>;
  /** A call that fails, by the reader's call name. */
  faults?: Partial<Record<keyof StacksReader, Fault>>;
}

const landedOf = (t: LedgerTx): t is StacksLanded & { order?: number } => t.mined;
const included = (t: StacksLanded) => t.canonical && t.status !== "problematic_skipped";
const listed = (t: StacksLanded): StacksListed => ({ txid: t.txid, sender: t.sender.address, nonce: t.sender.nonce });

/** The reader over a ledger, with the calls it was asked, by name. */
export function ledgerReader(l: Ledger): StacksReader & { calls: string[] } {
  const calls: string[] = [];
  const unknown = (h: bigint) => h < 1n || h > l.tipHeight || (l.unknownHeights ?? []).includes(h);
  const fault = (name: keyof StacksReader): unknown => {
    calls.push(name);
    const f = l.faults?.[name];
    if (f === undefined) return undefined;
    if ("kind" in f) throw new ReaderError(f.kind === "malformed" ? "malformed" : f.kind);
    return f.answer;
  };
  const answered = <T>(name: keyof StacksReader, v: () => T): T => {
    const f = fault(name);
    return (f === undefined ? v() : f) as T;
  };
  const landed = () => l.txs.filter(landedOf);
  const ordered = (ts: StacksLanded[]) =>
    [...ts].sort((a, b) => (a.blockHeight === b.blockHeight ? Number(a.sender.nonce - b.sender.nonce) : a.blockHeight < b.blockHeight ? -1 : 1));
  const page = (ts: StacksLanded[], offset: number) => ({ results: ts.slice(offset, offset + 50).map(listed), total: ts.length });
  return {
    calls,
    network: l.network,
    async tip() {
      return answered("tip", () => ({ height: l.tipHeight, burnHeight: BURN0 + l.finalThrough + 7n }));
    },
    async transaction(txid) {
      return answered("transaction", () => {
        const t = l.txs.find((x) => x.txid.toLowerCase() === txid.toLowerCase());
        if (t === undefined) return { notFound: true as const };
        if (!t.mined) return { mined: false as const, status: t.status };
        const { order: _, ...tx } = t;
        return tx;
      });
    },
    async lastNonce(principal, height) {
      return answered("lastNonce", () => {
        if (height !== undefined && unknown(height)) return { unknownHeight: true as const };
        const ns = landed()
          .filter((t) => included(t) && t.sender.address === principal && (height === undefined || t.blockHeight <= height))
          .map((t) => t.sender.nonce);
        return { nonce: ns.length === 0 ? null : ns.reduce((a, b) => (a > b ? a : b)) };
      });
    },
    async byNonce(principal, nonce) {
      return answered("byNonce", () => {
        const given = l.byNonce?.get(nonce);
        if (given !== undefined) return given;
        return landed()
          .filter((t) => t.sender.address === principal && t.sender.nonce === nonce)
          .map(listed);
      });
    },
    async byOrigin(principal, offset) {
      return answered("byOrigin", () => page(ordered(landed().filter((t) => t.sender.address === principal)), offset));
    },
    async inBlock(height, offset) {
      return answered("inBlock", () => {
        if (unknown(height)) return { unknownHeight: true as const };
        return page(
          landed().filter((t) => t.blockHeight === height && t.canonical),
          offset,
        );
      });
    },
    async nextTenureBurn(height) {
      return answered("nextTenureBurn", () => (height < l.tipHeight ? BURN0 + height + 1n : null));
    },
  };
}

/** A transfer event of `contract`'s token `token`. */
export function ftEvent(index: number, contract: string, token: string, sender: string, recipient: string, amount: bigint): StacksAssetEvent {
  return { index, assetId: `${contract}::${token}`, sender, recipient, amount };
}
