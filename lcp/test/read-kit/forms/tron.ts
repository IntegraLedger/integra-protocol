// The read kit's form for x402/exact/tron/lcp-trc20-memo: each case of read-status.json made on a ledger of constructed
// full-node answers (marked so: no recorded endpoint answers these cases), read through the pairing's own `tronStatus`,
// and the answer put back in the cases' terms. A case's position is the block number; the mark `final` is the
// solidified level and a lower mark the head; the transaction whose id is the single-use value is the presented one,
// the reference's, and every other act is a transaction carrying H in a block the search reads. Blocks are named by
// their number, the 8 bytes java-tron's `blockID` begins with, and the bytes `ab` after it, each block's `parentHash`
// the one before it. Transactions are `raw_data` written with lcp's own protobuf writer, `encodeTronRaw`, or by hand for
// a contract of another kind (`TransferContract`, `Tron.proto`'s type 1).
import { sha256 } from "@noble/hashes/sha2.js";
import { createBase58check } from "@scure/base";
import { toLcpString, type AtrHash } from "../../../src/core.js";
import type { Act, Moved } from "../../../src/internal/read.js";
import {
  TRANSFER_SELECTOR,
  TRANSFER_TOPIC,
  encodeTronRaw,
  tronStatus,
  type TronBlock,
  type TronInfo,
  type TronLevel,
  type TronReader,
  type TronRef,
  type TronStatus,
} from "../../../src/tron.js";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS } from "../harness.js";

const NETWORK = "tron:728126428" as const;
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as AtrHash;
const B58 = createBase58check(sha256);
const bytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const PAYER = bytes("41f39fd6e51aad88f6f4ce6ab8827279cfffb92266");
const PAYTO = bytes("41209693bc6afc0c5328ba36faf03c514ef312287c");
const OTHER = bytes("412222222222222222222222222222222222222222");
const ELSEWHERE = bytes("411111111111111111111111111111111111111111");
const TOKENS: Record<string, Uint8Array> = {
  A: bytes("41a614f803b6fd780986a42c78ec9c7f77e6ded13c"),
  B: bytes("41b4a428ab7092c2f1395f376ce297033b3bb446c1"),
};
const MEMO = new TextEncoder().encode(toLcpString(H));
const EXPIRATION = 1_000_000n;
const ACCOUNTS: Record<string, Uint8Array> = { payee: PAYTO, elsewhere: ELSEWHERE };

const blockId = (n: bigint): `0x${string}` => `0x${n.toString(16).padStart(16, "0")}${"ab".repeat(24)}`;
const idOf = (raw: Uint8Array): `0x${string}` => `0x${hex(sha256(raw))}`;

/** `transfer(to, amount)`: its selector and two 32-byte words. */
function callData(to: Uint8Array, amount: bigint): Uint8Array {
  const out = new Uint8Array(68);
  out.set(bytes(TRANSFER_SELECTOR), 0);
  out.set(to.subarray(1), 16);
  let a = amount;
  for (let i = 67; i >= 36; i--) {
    out[i] = Number(a & 0xffn);
    a >>= 8n;
  }
  return out;
}

/** The form's transaction: one `TriggerSmartContract` calling `transfer(to, amount)` with `data`, at `timestamp`. */
function formRaw(owner: Uint8Array, to: Uint8Array, amount: bigint, timestamp: bigint, data: Uint8Array = MEMO): Uint8Array {
  return encodeTronRaw({
    refBlockBytes: bytes("4d2d"),
    refBlockHash: bytes("7d1ddbe0b0adbe87"),
    expiration: EXPIRATION,
    data,
    owner,
    contractAddress: TOKENS["A"]!,
    callData: callData(to, amount),
    timestamp,
    feeLimit: 100_000_000n,
  });
}

/** A protobuf length-delimited field, for the hand-written contract of another kind. */
function field(no: number, value: Uint8Array): number[] {
  const out = [(no << 3) | 2];
  let n = value.length;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>= 7;
  }
  out.push(n, ...value);
  return out;
}

/** A `TransferContract` (type 1) of one TRX from `owner` to `to` with `data`: an act of another kind than the form. */
function otherKindRaw(owner: Uint8Array, to: Uint8Array, timestamp: number): Uint8Array {
  const value = Uint8Array.from([...field(1, owner), ...field(2, to), 0x18, 0x01]);
  const any = Uint8Array.from([...field(1, new TextEncoder().encode("type.googleapis.com/protocol.TransferContract")), ...field(2, value)]);
  const contract = Uint8Array.from([0x08, 0x01, ...field(2, any)]);
  return Uint8Array.from([...field(10, MEMO), ...field(11, contract), 0x70, timestamp & 0x7f]);
}

type Seen = ReadCase["facts"]["seen"][number];

/** The receipt of an act: its result, and a `Transfer` log for each transfer of what moved, at the place a case names. */
function infoOf(s: Seen, at: bigint): TronInfo {
  if (s.result === "failed") return { blockNumber: at, result: "REVERT", logs: [] };
  const moved: readonly Moved[] = s.moved ?? (s.account === "none" ? [] : [{ asset: "A", amount: "10000", to: s.account === "payee" ? "payee" : "elsewhere" }]);
  const logs: TronInfo["logs"][number][] = [];
  for (const m of moved) {
    const place = typeof m.place === "number" ? m.place : logs.length;
    while (logs.length < place) logs.push({ address: hex(TOKENS["A"]!.subarray(1)), topics: ["00".repeat(32)], data: "" });
    logs.push({
      address: hex((TOKENS[m.asset] ?? TOKENS["A"]!).subarray(1)),
      topics: [TRANSFER_TOPIC, `${"00".repeat(12)}${hex(PAYER.subarray(1))}`, `${"00".repeat(12)}${hex((ACCOUNTS[m.to] ?? ELSEWHERE).subarray(1))}`],
      data: BigInt(m.amount).toString(16).padStart(64, "0"),
    });
  }
  return { blockNumber: at, result: "SUCCESS", logs };
}

interface Made {
  ref: TronRef;
  reader: TronReader;
  after: bigint;
  names: Map<string, string>;
  lower: CaseMark;
  held: Map<string, number>;
}

/** The case on a Tron ledger, or why the read cannot meet it. */
function make(c: ReadCase): Made {
  const f = c.facts;
  const marks = [...f.seen.map((s) => s.mark), ...(f.value ? [f.value.mark] : []), c.query.finality];
  const lower: CaseMark = marks.includes("safe") ? "safe" : "included";
  const after = BigInt(c.query.after ?? 1);
  const names = new Map<string, string>();
  const held = new Map<string, number>();
  const blocks = new Map<bigint, string[]>();
  const infos = new Map<string, { at: bigint; info: TronInfo; final: boolean }>();
  const put = (n: bigint, raw: Uint8Array): void => void blocks.set(n, [...(blocks.get(n) ?? []), hex(raw)]);

  // The transaction whose id is the single-use value: the one that consumed it, the presented one. An act the case
  // gives as another message than the one presented, or found above the final head by a search, is in the ledger's own
  // spelling another transaction the payer signed over H, which the search finds: its id is another, and the
  // presented transaction, unsent, lapses.
  const x = f.seen.find((s) => s.consumed && s.presented !== "no" && !(s.mark !== "final" && f.search.at !== undefined));
  const xAccount = x?.moved?.[0]?.to ?? (x?.account === "other" ? "elsewhere" : "payee");
  const xAmount = BigInt(x?.moved?.[0]?.amount ?? "10000");
  const owner = x?.party === "payee" ? PAYTO : PAYER;
  const presented = formRaw(owner, ACCOUNTS[xAccount] ?? PAYTO, xAmount, 1_000n);
  const txid = idOf(presented);
  if (x !== undefined) {
    names.set(txid, x.transaction);
    const at = BigInt(x.position ?? 10);
    infos.set(txid, { at, info: infoOf(x, at), final: x.mark === "final" });
    put(at, presented);
  }
  let stamp = 2_000n;
  for (const s of f.seen) {
    if (s === x) continue;
    const signer = s.party === "payee" ? PAYTO : s.party === "other" ? OTHER : PAYER;
    const m = s.moved?.[0];
    const raw =
      s.kind === "other"
        ? otherKindRaw(signer, PAYTO, Number(stamp++ % 100n))
        : formRaw(signer, m === undefined ? (s.account === "other" ? ELSEWHERE : PAYTO) : (ACCOUNTS[m.to] ?? ELSEWHERE), BigInt(m?.amount ?? "10000"), stamp++, s.carries ? MEMO : new Uint8Array(77));
    const id = idOf(raw);
    names.set(id, s.transaction);
    const at = BigInt(s.position ?? 10);
    infos.set(id, { at, info: infoOf(s, at), final: s.mark === "final" });
    put(at, raw);
  }
  (f.undecoded ?? []).forEach((u, i) => {
    // A transaction whose bytes are no protobuf message: a field number 0.
    const raw = Uint8Array.from([0x00, i]);
    const at = BigInt(u.at ?? 40 + i);
    names.set(idOf(raw), u.transaction);
    if (u.at !== undefined) held.set(blockId(at - 1n), u.at);
    put(at, raw);
  });
  const finals = [...infos.values()].filter((v) => v.final).map((v) => v.at);
  const lows = [...infos.values()].filter((v) => !v.final).map((v) => v.at);
  let solid = lows.length > 0 ? lows.reduce((a, b) => (a < b ? a : b)) - 1n : 20n;
  for (const n of [...finals, ...[...blocks.keys()].filter((n) => !lows.includes(n))]) if (n > solid) solid = n;
  const head = [solid + 1n, ...lows].reduce((a, b) => (a > b ? a : b));
  // The value's validity passed where the case says so, and where an act other than the presented one must be met by
  // the search, which the read makes only before a failed.
  const lapsed = f.value?.lapsed ?? (x === undefined && f.seen.length + (f.undecoded?.length ?? 0) > 0);
  const time = lapsed ? EXPIRATION + 6_000n : EXPIRATION - 1n;
  const fault = f.unreadable;
  const level = (l: TronLevel): bigint => (l === "solid" ? solid : head);
  const blockOf = (n: bigint): TronBlock => ({ blockId: blockId(n), number: n, parentHash: blockId(n - 1n), transactions: blocks.get(n) ?? [] });
  const reader: TronReader = {
    network: fault === "chain-mismatch" ? "tron:3448148188" : NETWORK,
    info: async (id, l) => {
      if (fault === "transport") throw new Error("transport");
      const i = infos.get(id);
      return i !== undefined && (l === "head" || i.final) ? i.info : { notFound: true, timestamp: time };
    },
    transaction: async () => null,
    now: async (l) => {
      if (fault === "unparseable") return { number: "x" } as never;
      return { number: level(l), blockId: blockId(level(l)), timestamp: time };
    },
    blocks: async (start, end, l) => {
      const out: TronBlock[] = [];
      for (let n = start; n < end && n <= level(l); n++) {
        if (fault === "too-large" && n === after + 1n) throw Object.assign(new Error("too-large"), { kind: "too-large" });
        out.push(blockOf(n));
      }
      return { head: level(l), blocks: out };
    },
    block: async (n, l) => {
      if (fault === "too-large") throw Object.assign(new Error("too-large"), { kind: "too-large" });
      if (f.history === false && n === after) return { head: level(l), block: null };
      return { head: level(l), block: n <= level(l) ? blockOf(n) : null };
    },
  };
  const ref: TronRef = {
    network: NETWORK,
    payee: B58.encode(PAYTO),
    payer: B58.encode(owner),
    txid,
    raw: hex(presented),
    asset: `0x${hex(TOKENS["A"]!)}`,
    expiration: EXPIRATION.toString(),
  };
  return { ref, reader, after, names, lower, held };
}

function back(a: TronStatus, m: Made, c: ReadCase): CaseAnswer {
  const name = (t: string): string => m.names.get(t) ?? t;
  const mark = (k: unknown): CaseMark => (k === "solidified" ? "final" : m.lower);
  const account = (to: string): string => Object.keys(ACCOUNTS).find((k) => to === `0x${hex(ACCOUNTS[k]!)}`) ?? to;
  const movedBack = (mv: readonly Moved[]): Moved[] =>
    mv.map((v) => ({
      asset: Object.keys(TOKENS).find((k) => v.asset === `0x${hex(TOKENS[k]!)}`) ?? v.asset,
      amount: v.amount,
      to: account(v.to),
      ...(v.transaction === undefined ? {} : { transaction: name(v.transaction) }),
      ...(v.place === undefined ? {} : { place: v.place }),
    }));
  const foreign = a.foreign.map(({ position, ...f }) => ({ ...f, transaction: name(f.transaction), ...(position === undefined ? {} : { position: Number(position) }) }));
  if (a.state === "unreadable") return { ...a, foreign };
  const out: Record<string, unknown> = { ...a, foreign };
  if (a.transaction !== undefined) out["transaction"] = name(a.transaction);
  if (a.position !== undefined) out["position"] = Number(a.position);
  if (a.finality !== undefined) out["finality"] = mark(a.finality);
  if (a.moved !== undefined) out["moved"] = movedBack(a.moved);
  if ("search" in a && a.search !== undefined) out["search"] = m.held.get(a.search.blockId) ?? c.facts.search.at ?? 42;
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(name);
  return out as CaseAnswer;
}

/** Every case whose text opens with `words`, stated on both acts. */
function opening(words: string, stated: string): Inapplicable[] {
  const cases = READ_STATUS.cases.filter((c) => c.case.startsWith(words));
  if (cases.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return cases.map((c) => ({ case: c.case, stated }));
}

/** The cases at coverage `full` whose expected answer on an act carries one of `reasons`, stated on those acts. */
function answeringFull(reasons: readonly string[], stated: string): Inapplicable[] {
  return READ_STATUS.cases.flatMap((c) => {
    if (c.coverage !== "full") return [];
    const acts = ACTS.filter((act) => {
      const want = c.expect[act];
      return "reason" in want && reasons.includes(want.reason);
    });
    return acts.length === 0 ? [] : [{ case: c.case, acts, stated }];
  });
}

const ENTRY = "Declared inapplicable to the read kit: ";
const PROFILE = "; the profile x402-exact-tron-lcp-trc20-memo.md, rule 8, Cases that cannot arise";
const BY_ID =
  "*a value read consumed whose transaction the search has not found* and *a value unconsumed at the final mark and " +
  "consumed at the latest head* and *a value whose validity passed, unconsumed at the final mark and consumed at the " +
  "latest head*, since the value is the transaction id, read consumed only by the lookup that returns its transaction";
const HELD =
  "*a read with no means to read the single-use value*, *search-incomplete is answered before not-found* and *a read " +
  "that did not read the value at the latest head*, since the read holds the id and looks it up at the solidified level " +
  "and at the head";
const LATE =
  "*the settled act's answer names every foreign item*, *instrument-live is answered before search-incomplete* and " +
  "*instrument-live is answered before an item the search could not decode*, since the search is made only before a " +
  "`failed`";
const PLACED =
  "*an act the read cannot place against the position given* (its three cases) and *an item the search could not decode " +
  "that gives no position*, since the search reads blocks by number";

/** The cases this read cannot meet, each by its reason or the opening words of its text, as the profile's rule 8 states them. */
const DECLARED: readonly Inapplicable[] = [
  ...answeringFull(["not-found"], ENTRY + "`not-found`, since the read always holds the value" + PROFILE),
  ...opening("a value read consumed whose transaction the search has not found", ENTRY + BY_ID + PROFILE),
  ...opening("a value unconsumed at the final mark and consumed at the latest head", ENTRY + BY_ID + PROFILE),
  ...opening("a value whose validity passed, unconsumed at the final mark and consumed at the latest head", ENTRY + BY_ID + PROFILE),
  ...opening("a read with no means to read the single-use value", ENTRY + HELD + PROFILE),
  ...opening("search-incomplete is answered before not-found", ENTRY + HELD + PROFILE),
  ...opening("a read that did not read the value at the latest head", ENTRY + HELD + PROFILE),
  ...opening("the settled act's answer names every foreign item", ENTRY + LATE + PROFILE),
  ...opening("instrument-live is answered before search-incomplete", ENTRY + LATE + PROFILE),
  ...opening("instrument-live is answered before an item the search could not decode", ENTRY + LATE + PROFILE),
  ...opening("an act the read cannot place against the position given", ENTRY + PLACED + PROFILE),
  ...opening("an item the search could not decode that gives no position", ENTRY + PLACED + PROFILE),
  ...opening(
    "the validity passed with the value unconsumed, read below the final mark",
    ENTRY +
      "*the validity passed with the value unconsumed, read below the final mark*, since `expiration` is compared with the " +
      "solidified head alone" + PROFILE,
  ),
  ...answeringFull(
    ["instrument-unused", "instrument-consumed", "transaction-failed"],
    ENTRY +
      "until a run on a test network shows that a block's answer lists every transaction of its block, the cases at " +
      "coverage `full` answering `instrument-unused`, `instrument-consumed` or `transaction-failed`: a complete search shows " +
      "the chain of headers, not that an answer lists every transaction of its block, so it proves no absence" + PROFILE,
  ),
];

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/tron/lcp-trc20-memo",
      arrange: (c: ReadCase, act: Act) => {
        const declared = DECLARED.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
        if (declared !== undefined) return { inapplicable: declared.stated };
        const m = make(c);
        return {
          run: async () => {
            const ids = (t: string): string => [...m.names].find(([, v]) => v === t)?.[0] ?? t;
            const others = (c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: ids(o.transaction) } : o));
            const answer = await tronStatus(m.ref, m.reader, {
              act,
              finality: c.query.finality === "final" ? "solidified" : "head",
              after: m.after,
              ...(others.length === 0 ? {} : { others: others as never }),
            });
            return back(answer, m, c);
          },
        };
      },
    },
    inapplicable: DECLARED,
  },
];
