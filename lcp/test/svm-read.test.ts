// Runs vectors/svm-read.json: the Solana read's own rules, each row a constructed ledger read through the pairing's
// `status`. The transactions are legacy wire transactions this file encodes (Solana's documented message layout: the
// header's three counts, the compact-u16 key list, the recent blockhash, the compiled instructions); the reader answers
// as the JSON-RPC methods it stands for document their results (getSignaturesForAddress newest first, `before` and
// `until` exclusive, its memo rendered `[length] text`; getTransaction with `meta.err`, the token balances and the inner
// instructions; isBlockhashValid with its context slot; getFirstAvailableBlock; getAccountInfo of a nonce account).
// A row names its transactions by id and its keys by role; the answer is put back in those names, slots as decimal
// strings. A row's `asks` holds what the read must and must not call.
import { readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { BINDINGS, type AtrHash } from "../src/index.js";
import type { SvmLanded, SvmReader, SvmRef, SvmSignature, SvmStatus } from "../src/internal/svm-read.js";
import { decodeSvmTx, svmDigest } from "../src/internal/svm.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/svm-read.json", import.meta.url), "utf8"));

type Role = "feePayer" | "payer" | "payee" | "other" | "mint" | "payerToken" | "payeeToken" | "otherToken" | "channel" | "nonceAccount";
interface Tx {
  id: string;
  signer?: "payer" | "payee" | "other";
  to?: "payee" | "other" | "none";
  asset?: "token" | "sol";
  amount?: string;
  memo?: "H" | "H-upper" | "none";
  kind?: "transfer" | "channel";
  inner?: boolean;
  nonce?: boolean;
  blockhash?: "own" | "other";
  at: "finalized" | "confirmed" | "missing" | "undecodable";
  err?: unknown;
  slot: number;
  listed?: "payer" | "feePayer" | "none";
  /** The token balances name no owner, as a node that omits `owner` gives them. */
  ownerless?: boolean;
  /** A second signer beside the fee payer and `signer`, neither the buyer nor the payee. */
  cosigned?: boolean;
}
interface Row {
  case: string;
  rules: string;
  pairing: string;
  ref: { holds: "message" | "transaction" | "nonce"; tx: string; digestOf?: string };
  query: { act: "payment" | "agreement"; finality: string; after?: number; search?: Record<string, string | string[]>; others?: string[] };
  txs: Tx[];
  reader: {
    firstAvailableBlock: number;
    finalized: number;
    confirmed: number;
    /** isBlockhashValid's answer at `confirmed` while the read holds no bound. */
    valid: [boolean, number];
    /** Its answers once the read holds a bound, at `finalized` and at `confirmed`. */
    lapse?: { finalized?: [boolean, number]; confirmed?: [boolean, number] };
    nonceMoved?: boolean;
    filler?: number;
  };
  asks?: { never?: string[]; signaturesOf?: string[] };
  expect: unknown;
}

const key = (b: number): string => base58.encode(new Uint8Array(32).fill(b));
const KEYS: Record<Role, string> = {
  feePayer: key(1),
  payer: key(2),
  payee: key(3),
  other: key(4),
  mint: key(5),
  payerToken: key(6),
  payeeToken: key(7),
  otherToken: key(8),
  channel: key(9),
  nonceAccount: key(10),
};
const NONCE_VALUE = key(11);
/** A program of the signer's whose call runs a transfer as an inner instruction. */
const WRAPPER = key(20);
const BLOCKHASH = key(12);
/** A signer that is neither the buyer nor the payee, beside another such signer. */
const COSIGNER = key(14);
const OTHER_BLOCKHASH = key(13);
const H = V.fixed.H as AtrHash;
const MEMO_TEXT = `lcp:sha256:${H}`;
const PROGRAMS = {
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  system: "11111111111111111111111111111111",
  channels: "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX",
  recentBlockhashes: "SysvarRecentB1ockHashes11111111111111111111",
};
/** The signature, and so the transaction id, of a transaction by its row id. */
const sigOf = (id: string): string => {
  const b = new Uint8Array(64);
  new TextEncoder().encode(id).forEach((x, i) => (b[i] = x));
  b[63] = 1;
  return base58.encode(b);
};

function compact(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    if (n < 0x80) return [...out, n];
    out.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
}
function u64(v: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return [...b];
}
type Ix = { program: string; accounts: string[]; data: number[] };

/**
 * A legacy wire: the fee payer and the signers first, then the writable keys, then the read-only ones in first use; the
 * fee payer's signature slot holds the transaction's id, the others zero.
 */
function wire(signers: string[], ixs: Ix[], blockhash: string, id: string): { wire: Uint8Array; keys: string[] } {
  const keys = [KEYS.feePayer, ...signers];
  for (const k of [KEYS.payerToken, KEYS.payeeToken, KEYS.otherToken, KEYS.channel, KEYS.nonceAccount, KEYS.payee, KEYS.other]) {
    if (!keys.includes(k) && ixs.some((ix) => ix.accounts.includes(k))) keys.push(k);
  }
  const writable = keys.length;
  for (const ix of ixs) for (const k of [...ix.accounts, ix.program]) if (!keys.includes(k)) keys.push(k);
  const message = [
    1 + signers.length,
    0,
    keys.length - writable,
    ...compact(keys.length),
    ...keys.flatMap((k) => [...base58.decode(k)]),
    ...base58.decode(blockhash),
    ...compact(ixs.length),
    ...ixs.flatMap((ix) => [keys.indexOf(ix.program), ...compact(ix.accounts.length), ...ix.accounts.map((a) => keys.indexOf(a)), ...compact(ix.data.length), ...ix.data]),
  ];
  const slots = [...base58.decode(sigOf(id)), ...new Uint8Array(64 * signers.length)];
  return { wire: Uint8Array.from([1 + signers.length, ...slots, ...message]), keys };
}

/** A row's transaction: its instructions, as landed with the balances and inner instructions getTransaction gives. */
function landedOf(t: Tx): { landed: SvmLanded; memo: string | null } {
  const signer = KEYS[t.signer ?? "payer"];
  const to = t.to ?? "payee";
  const amount = BigInt(t.amount ?? "5");
  const ixs: Ix[] = [];
  if (t.nonce) ixs.push({ program: PROGRAMS.system, accounts: [KEYS.nonceAccount, PROGRAMS.recentBlockhashes, signer], data: [4, 0, 0, 0] });
  let transfer: Ix | undefined;
  if (to !== "none" && (t.kind ?? "transfer") === "transfer") {
    transfer =
      t.asset === "sol"
        ? { program: PROGRAMS.system, accounts: [signer, KEYS[to]], data: [2, 0, 0, 0, ...u64(amount)] }
        : { program: PROGRAMS.token, accounts: [KEYS.payerToken, KEYS.mint, to === "payee" ? KEYS.payeeToken : KEYS.otherToken, signer], data: [12, ...u64(amount), 6] };
  }
  if (t.kind === "channel") {
    const recipients = to === "none" ? [] : [KEYS[to]];
    ixs.push({
      program: PROGRAMS.channels,
      accounts: [signer, KEYS.feePayer, KEYS.payee, KEYS.mint, signer, KEYS.channel],
      data: [1, ...u64(7n), ...u64(amount), 0, 0, 0, 0, ...u64(0n), recipients.length, 0, 0, 0, ...recipients.flatMap((r) => [...base58.decode(r), 0x10, 0x27])],
    });
  }
  // An inner transfer runs under the transaction's first instruction, a program call of the signer's.
  if (transfer !== undefined && !t.inner) ixs.push(transfer);
  if (transfer !== undefined && t.inner) ixs.push({ program: WRAPPER, accounts: [...transfer.accounts, transfer.program], data: [9] });
  const memo = t.memo === "none" ? null : t.memo === "H-upper" ? `lcp:sha256:0x${H.slice(2).toUpperCase()}` : MEMO_TEXT;
  if (memo !== null) ixs.push({ program: PROGRAMS.memo, accounts: [], data: [...new TextEncoder().encode(memo)] });
  const blockhash = t.nonce ? NONCE_VALUE : t.blockhash === "other" ? OTHER_BLOCKHASH : BLOCKHASH;
  const built = wire(t.cosigned ? [signer, COSIGNER] : [signer], ixs, blockhash, t.id);
  const index = (k: string) => built.keys.indexOf(k);
  const inner =
    transfer !== undefined && t.inner
      ? [{ index: ixs.findIndex((ix) => ix.data[0] === 9), program: index(transfer.program), accounts: transfer.accounts.map(index), data: Uint8Array.from(transfer.data) }]
      : [];
  const post = [
    { account: index(KEYS.payerToken), mint: KEYS.mint, owner: KEYS.payer },
    { account: index(KEYS.payeeToken), mint: KEYS.mint, owner: KEYS.payee },
    { account: index(KEYS.otherToken), mint: KEYS.mint, owner: KEYS.other },
  ]
    .filter((b) => b.account >= 0)
    .map(({ owner, ...b }) => (t.ownerless ? b : { ...b, owner }));
  return {
    landed: { wire: built.wire, err: t.err ?? null, slot: BigInt(t.slot), loaded: { writable: [], readonly: [] }, inner, post },
    memo: memo === null ? null : `[${memo.length}] ${memo}`,
  };
}

/** The answer in the row's names: transaction ids, key roles, slots as decimal strings. */
function named(a: unknown, ids: Map<string, string>): unknown {
  const roles = new Map<string, string>(Object.entries(KEYS).map(([r, k]) => [k, r]));
  return JSON.parse(
    JSON.stringify(a, (_, x) => (typeof x === "bigint" ? x.toString() : x)),
    (_, x) => (typeof x === "string" ? (ids.get(x) ?? roles.get(x) ?? x) : x),
  );
}

async function run(row: Row): Promise<{ answer: unknown; asked: string[] }> {
  const asked: string[] = [];
  const ids = new Map<string, string>();
  const held = new Map<string, { landed: SvmLanded | "undecodable"; at: Tx["at"] }>();
  const listings: Record<"payer" | "feePayer", SvmSignature[]> = { payer: [], feePayer: [] };
  for (const t of row.txs) {
    const sig = sigOf(t.id);
    ids.set(sig, t.id);
    const { landed, memo } = landedOf(t);
    held.set(sig, { landed: t.at === "undecodable" ? "undecodable" : landed, at: t.at });
    const listed = t.listed ?? "payer";
    if (listed !== "none" && t.at !== "missing") listings[listed].push({ signature: sig, slot: BigInt(t.slot), memo });
  }
  // Filler signatures of the buyer's account with no memo, newer than every row's transaction.
  for (let i = 0; i < (row.reader.filler ?? 0); i++) {
    const sig = sigOf(`f${i}`);
    ids.set(sig, `f${i}`);
    listings.payer.push({ signature: sig, slot: BigInt(5000 + (row.reader.filler ?? 0) - i), memo: null });
  }
  for (const l of Object.values(listings)) l.sort((x, y) => (x.slot > y.slot ? -1 : x.slot < y.slot ? 1 : 0));
  const r = row.reader;
  // Whether the read holds the blockhash's bound: from the handle, or from an answer of true at `confirmed`.
  let bounded = row.query.search?.["validAt"] !== undefined;
  const nonceData = (moved: boolean) => {
    const data = new Uint8Array(80);
    data.set([1, 0, 0, 0, 1, 0, 0, 0]);
    data.set(base58.decode(moved ? OTHER_BLOCKHASH : NONCE_VALUE), 40);
    return data;
  };
  const reader: SvmReader = {
    network: V.fixed.network,
    transaction: async (sig, commitment) => {
      asked.push(`getTransaction ${ids.get(sig) ?? sig} ${commitment}`);
      const h = held.get(sig);
      if (h === undefined || h.at === "missing" || (commitment === "finalized" && h.at === "confirmed")) {
        return { notFound: true, slot: BigInt(commitment === "finalized" ? r.finalized : r.confirmed) };
      }
      return h.landed === "undecodable" ? ({ wire: Uint8Array.of(0xff), err: null, loaded: { writable: [], readonly: [] }, inner: [] } as SvmLanded) : h.landed;
    },
    signatures: async (address, page) => {
      const who = address === KEYS.payer ? "payer" : address === KEYS.feePayer ? "feePayer" : address;
      asked.push(`getSignaturesForAddress ${who}`);
      let list = who === "payer" ? listings.payer : who === "feePayer" ? listings.feePayer : [];
      if (page.until !== undefined) list = list.slice(0, Math.max(0, list.findIndex((e) => e.signature === page.until)));
      if (page.before !== undefined) list = list.slice(list.findIndex((e) => e.signature === page.before) + 1);
      return list.slice(0, page.limit);
    },
    slot: async (commitment) => BigInt(commitment === "finalized" ? r.finalized : r.confirmed),
    blockhashValid: async (_blockhash, commitment) => {
      asked.push(`isBlockhashValid ${bounded ? "lapse" : "bound"} ${commitment}`);
      if (commitment === "confirmed" && !bounded) {
        bounded = r.valid[0];
        return { valid: r.valid[0], slot: BigInt(r.valid[1]) };
      }
      const answer = r.lapse?.[commitment];
      if (answer === undefined) throw new Error(`the row gives no isBlockhashValid answer at ${commitment} once a bound is held`);
      return { valid: answer[0], slot: BigInt(answer[1]) };
    },
    firstAvailableBlock: async () => BigInt(r.firstAvailableBlock),
    account: async (_a, commitment) => ({
      slot: BigInt(commitment === "finalized" ? r.finalized : r.confirmed),
      value: { owner: PROGRAMS.system, data: nonceData(r.nonceMoved === true) },
    }),
  };
  const base = { network: V.fixed.network, payer: KEYS.payer, payee: KEYS.payee, h: H, feePayer: KEYS.feePayer };
  const own = row.txs.find((t) => t.id === (row.ref.digestOf ?? row.ref.tx));
  const digestOf = async (t: Tx | undefined) => {
    const tx = decodeSvmTx(landedOf(t ?? { id: row.ref.tx, at: "missing", slot: 0 }).landed.wire);
    if ("refused" in tx) throw new Error(tx.code);
    return svmDigest(tx);
  };
  const ref: SvmRef =
    row.ref.holds === "transaction"
      ? { ...base, transaction: sigOf(row.ref.tx) }
      : row.ref.holds === "nonce"
        ? { ...base, digest: await digestOf(own), nonce: { account: KEYS.nonceAccount, value: NONCE_VALUE } }
        : { ...base, transaction: sigOf(row.ref.tx), digest: await digestOf(own), blockhash: BLOCKHASH };
  const entry = BINDINGS.find((e) => e.id === row.pairing)!;
  const status = (entry as unknown as { status: (r: SvmRef, rd: SvmReader, q: unknown) => Promise<SvmStatus> }).status;
  const search =
    row.query.search === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(row.query.search).map(([k, v]) => [k, k === "validAt" ? v : Array.isArray(v) ? v.map(sigOf) : sigOf(v)]),
        );
  const query = {
    ...row.query,
    ...(row.query.after === undefined ? {} : { after: BigInt(row.query.after) }),
    ...(search === undefined ? {} : { search }),
    ...(row.query.others === undefined ? {} : { others: row.query.others.map((id) => ({ transaction: sigOf(id) })) }),
  };
  return { answer: named(await status(ref, reader, query), ids), asked };
}

describe("svm-read.json: the Solana read's own rules", () => {
  for (const row of rowsOf<Row>(V.rows, "svm-read.json rows", { exact: 25 })) {
    it(`${row.case} (${row.rules})`, async () => {
      const { answer, asked } = await run(row);
      expect(answer).toEqual(row.expect);
      for (const call of row.asks?.never ?? []) expect(asked.filter((a) => a.startsWith(call)), `never ${call}`).toEqual([]);
      if (row.asks?.signaturesOf !== undefined) {
        expect([...new Set(asked.filter((a) => a.startsWith("getSignaturesForAddress")).map((a) => a.split(" ")[1]))]).toEqual(row.asks.signaturesOf);
      }
    });
  }
});
