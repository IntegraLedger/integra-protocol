// A TON ledger written as a TON Center v3 index would answer for it: the payer's W5 wallet, its transactions newest
// first, each linked to its predecessor with the account's status and data hash before and after it, the Jetton wallets
// each run's transfer reached, and the index's statement of the blocks it holds. It is a constructed fixture, not a
// recorded one: the read kit's TON form and tvm.test.ts arrange their cases on it, and no recorded answer of a tvm:-3
// index is held yet. The cells are written with @ton/core 0.63.1 as the profile x402-exact-tvm lays
// them out; the presented request is the vector file's (V2's settlement).
import { readFileSync } from "node:fs";
import { Address, beginCell, Cell } from "@ton/core";
import type { TonAccountStatus, TonIndexed, TonTx, TonWalletState, TvmReader, TvmRef } from "../src/tvm.js";

export const TVM_V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tvm.json", import.meta.url), "utf8"));
/** The reference V2's payment gives under its option. */
export const TVM_REF: TvmRef = TVM_V.V3.expectReference;
export const W5R1 = "0x20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f";
const OTHER_CODE = `0x${"ab".repeat(32)}`;
const account = (byte: string) => `0:${byte.repeat(32)}`;
/** Two Jetton masters, the payer's Jetton wallet of each, the payee's, and an account that is neither. */
export const MASTERS = { A: account("aa"), B: account("bb") } as const;
const PAYER_JW: Record<string, string> = { [MASTERS.A]: TVM_REF.jettonWallet, [MASTERS.B]: account("12") };
const PAYEE_JW: Record<string, string> = { [MASTERS.A]: account("33"), [MASTERS.B]: account("34") };
export const ELSEWHERE = account("44");
export const STRANGER = account("55");

/** One transaction of the payer's W5 wallet. */
export interface LedgerTx {
  readonly hash: string;
  /**
   * `request`: the presented request itself, which the lookup by its body hash finds; `aborted`: the presented request,
   * aborted; `run`: another request of the wallet's key at `seqno`; `extension`: an installed extension's actions, from
   * `source`; `incoming`: a transfer to the wallet with no body, which runs nothing; `undecodable`: one whose inbound
   * body is no bag of cells.
   */
  readonly form: "request" | "aborted" | "run" | "extension" | "incoming" | "undecodable";
  readonly seqno?: number;
  readonly source?: string;
  /** What it sent: a Jetton `transfer` carrying H (the default), a plain comment carrying H, or nothing. */
  readonly sends?: "jetton" | "comment" | "nothing";
  /** Its masterchain block; null while none holds it. */
  readonly mc?: bigint | null;
  /** The finality state of it and of the transactions its transfer led to. */
  readonly finality?: 0 | 1 | 2;
  /**
   * Where its transfer went: the payee's Jetton wallet (the default), another account, bounced, or no
   * `internal_transfer`; not yet taken; or delivered with an `internal_transfer` body the read cannot decode.
   */
  readonly delivery?: "payee" | "elsewhere" | "bounced" | "no-internal" | "untaken" | "garbled";
  /** Absent from the wallet's list, which the index gives without it: only the lookup by the request's body finds it. */
  readonly unlisted?: boolean;
  /** Its logical time, in decimal; 1000 less its place in the list where absent. */
  readonly lt?: string;
  /** A transaction the index gives without the account's state before and after it, which holds the list there. */
  readonly unlinked?: boolean;
  /** The destination its Jetton transfer names: the payee (the default) or another account. */
  readonly destination?: "payee" | "elsewhere";
  readonly master?: string;
  readonly amount?: string;
  /** A request whose signature the wallet refused: it ran nothing and left the data unchanged. */
  readonly refused?: boolean;
  /** A run whose request holds an exotic cell, which the read cannot hash. */
  readonly exotic?: boolean;
  /** Several Jetton transfers carrying H, each named by its place; one, at place 0, where absent. */
  readonly transfers?: readonly { readonly place: number; readonly amount: string }[];
}

export interface LedgerSpec {
  readonly ref?: TvmRef;
  readonly network?: string;
  /** The latest head's time, or how its read fails. */
  readonly head: number | "reject" | "malformed" | "too-large";
  readonly indexed: TonIndexed | null;
  readonly wallet: { readonly status: TonAccountStatus; readonly code: "w5" | "other" | null; readonly seqno: number | null };
  /** The wallet's transactions, newest first. */
  readonly txs: readonly LedgerTx[];
}

const boc = (c: Cell) => Uint8Array.from(c.toBoc({ idx: false, crc32: true }));
const comment = (h: string) => beginCell().storeUint(0, 32).storeBuffer(Buffer.from(`lcp:sha256:${h}`, "utf8")).endCell();
const PRESENTED = Cell.fromBase64(TVM_V.V2.expectSettlementBoc).refs.at(-1)!;
/** A library cell, which TON creates as exotic. */
const LIBRARY = beginCell().storeUint(2, 8).storeBuffer(Buffer.alloc(32, 1)).endCell({ exotic: true });
/** A request of the wallet's key at `seqno`, its action list a stand-in cell and its signature 64 zero bytes. */
const requestAt = (seqno: number, exotic = false) =>
  beginCell()
    .storeUint(0x73696e74, 32)
    .storeUint(TVM_V.fixed.walletId, 32)
    .storeUint(TVM_REF.validUntil, 32)
    .storeUint(seqno, 32)
    .storeBit(1)
    .storeRef(exotic ? beginCell().storeUint(7, 8).storeRef(LIBRARY).endCell() : beginCell().storeUint(7, 8).endCell())
    .storeBit(0)
    .storeBuffer(Buffer.alloc(64))
    .endCell();
const transferBody = (h: string, to: Address | null = null) =>
  beginCell()
    .storeUint(0x0f8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(10000n)
    .storeAddress(to)
    .storeAddress(null)
    .storeBit(0)
    .storeCoins(0n)
    .storeBit(1)
    .storeRef(comment(h))
    .endCell();
const internalTransfer = (amount: bigint) => beginCell().storeUint(0x178d4519, 32).storeUint(0, 64).storeCoins(amount).endCell();

/** A TON Center v3 reader that answers for the ledger, as `TvmReader` documents each call. */
export function ledgerReader(spec: LedgerSpec): TvmReader {
  const ref = spec.ref ?? TVM_REF;
  const h = ref.h;
  const order = spec.txs.filter((t) => t.unlisted !== true);
  const all = spec.txs.map((t): TonTx => {
    const i = Math.max(0, order.indexOf(t));
    const sends = t.sends ?? (t.form === "aborted" ? "nothing" : "jetton");
    const inBody =
      t.form === "incoming"
        ? null
        : t.form === "undecodable"
          ? Uint8Array.of(1, 2, 3)
          : t.form === "request" || t.form === "aborted"
        ? boc(PRESENTED)
        : t.form === "run"
          ? boc(requestAt(t.seqno ?? ref.seqno, t.exotic === true))
          : boc(beginCell().storeUint(0x6578746e, 32).storeUint(0, 64).endCell());
    const outMsgs =
      t.form === "aborted" || t.form === "incoming" || t.form === "undecodable" || t.refused === true || sends === "nothing"
        ? []
        : sends === "comment"
          ? [{ hash: `${t.hash}:c`, opcode: 0, body: boc(comment(h)) }]
          : (t.transfers ?? [{ place: 0 }]).map((x) => ({
              hash: `${t.hash}:t${x.place}`,
              opcode: 0x0f8a7ea5,
              body: boc(transferBody(h, Address.parseRaw(t.destination === "elsewhere" ? ELSEWHERE : ref.payee))),
            }));
    const next = t.unlisted === true ? undefined : order[i + 1];
    const changed = (t.form === "request" || t.form === "run") && t.refused !== true;
    return {
      hash: t.hash,
      account: ref.wallet,
      aborted: t.form === "aborted",
      finality: t.finality ?? 2,
      inBody,
      outMsgs,
      inSource: t.form === "extension" ? (t.source ?? STRANGER) : TVM_V.fixed.wallet === ref.wallet ? STRANGER : null,
      mcSeqno: t.mc === undefined ? 10n : t.mc,
      lt: t.lt ?? String(1000 - i),
      prev: next === undefined ? null : { hash: next.hash, lt: next.lt ?? String(1000 - i - 1) },
      ...(t.unlinked === true
        ? {}
        : { before: { status: "active" as const, dataHash: `d${i + 1}` }, after: { status: "active" as const, dataHash: changed ? `d${i}` : `d${i + 1}` } }),
    };
  });
  const txs = all.filter((_, k) => spec.txs[k]!.unlisted !== true);
  const byHash = new Map(spec.txs.map((t) => [t.hash, t]));
  const payeeJw = (master: string, owner: string) => (owner === ref.payee ? PAYEE_JW[master] ?? account("35") : account("36"));
  const fail = (): never => {
    throw Object.assign(new Error("too large"), { name: "ReaderError", kind: "too-large" });
  };
  return {
    network: (spec.network ?? ref.network) as TvmReader["network"],
    headUtime: async () => {
      if (spec.head === "reject") throw new Error("transport");
      if (spec.head === "too-large") return fail();
      return (spec.head === "malformed" ? "x" : spec.head) as number;
    },
    indexed: async () => spec.indexed,
    byInBody: async (bodyHash) =>
      bodyHash === ref.requestBodyHash ? all.filter((t) => ["request", "aborted"].includes(byHash.get(t.hash)!.form)) : [],
    walletState: async () => ({
      status: spec.wallet.status,
      codeHash: (spec.wallet.code === "w5" ? W5R1 : spec.wallet.code === "other" ? OTHER_CODE : null) as TonWalletState["codeHash"],
      seqno: spec.wallet.seqno,
      last: txs[0] === undefined ? null : { hash: txs[0].hash, lt: txs[0].lt! },
    }),
    transactions: async (_account, from, limit) => {
      const at = txs.findIndex((t) => t.hash === from.hash);
      return at < 0 ? [] : txs.slice(at, at + limit);
    },
    byInMessage: async (msgHash) => {
      const [hash, tail] = msgHash.split(":") as [string, string];
      const kind = tail.slice(0, 1);
      const place = Number(tail.slice(1));
      const t = byHash.get(hash);
      if (t === undefined || (t.delivery ?? "payee") === "untaken") return [];
      const master = t.master ?? MASTERS.A;
      const finality = t.finality ?? 2;
      if (kind === "t") {
        const internal = t.delivery === "no-internal" ? [] : [{ hash: `${hash}:i${place}`, opcode: 0x178d4519 }];
        return [{ hash: `${hash}-j${place}`, account: PAYER_JW[master]!, aborted: false, finality, inBody: null, outMsgs: internal }];
      }
      if (kind !== "i") return [];
      const to = t.delivery === "elsewhere" ? ELSEWHERE : PAYEE_JW[master]!;
      return [
        {
          hash: `${hash}-d${place}`,
          account: to,
          aborted: t.delivery === "bounced",
          finality,
          inBody: t.delivery === "garbled" ? Uint8Array.of(9, 9, 9) : boc(internalTransfer(BigInt(t.transfers?.find((x) => x.place === place)?.amount ?? t.amount ?? "1"))),
          outMsgs: [],
        },
      ];
    },
    byHash: async () => null,
    jettonMaster: async (jw) => Object.entries(PAYER_JW).find(([, w]) => w === jw)?.[0] ?? account("99"),
    jettonWallet: async (master, owner) => payeeJw(master, owner),
  };
}
