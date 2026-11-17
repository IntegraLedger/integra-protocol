// The read kit's forms of the pairings that live on Tempo alone: `mpp/charge/tempo/split-memo` (pull and push),
// `mpp/session/tempo` and `mpp/subscription/tempo`. Each
// case of read-status.json is arranged on a constructed Tempo ledger (test/eip155-tempo-mpp-tempo-ledger.ts: blocks one
// second apart, the nonce precompile's state derived from the ledger's own signed transactions) and run through the
// pairing's own `status`, its answer put back in the case's terms. The transactions are `0x76` transactions signed here
// with Anvil's published development keys under one 2D nonce lane, so that the payer's transactions over one value can
// differ in what they pay. Only the cases the pairings' profiles state cannot arise, with the reason, are
// skipped (mpp-charge-tempo-split-memo.md rule 14, mpp-session-evm-tempo.md rule 8).
import { concat, keccak256, toHex, toRlp, type Hex as ViemHex } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import type { Hex } from "../../../src/evm-abi.js";
import { ReaderError, type EvmLog } from "../../../src/evm.js";
import { TRANSFER_TOPIC } from "../../../src/internal/evm.js";
import type { Act, ForeignItem, Moved } from "../../../src/internal/read.js";
import { tempoValueOf } from "../../../src/internal/tempo-nonce.js";
import { tempoSplitMemo, tempoSplitMemoPush, type TempoSplitRef } from "../../../src/mpp-tempo.js";
import { evmChannelId, sessionTempo, subscriptionTempo, type SessionRef } from "../../../src/mpp.js";
import { CHANNEL_OPENED_V1_TOPIC, KEY_AUTHORIZATION_WITNESS_TOPIC, OPEN_V1_SELECTOR, TRANSFER_WITH_MEMO_SELECTOR, TRANSFER_WITH_MEMO_TOPIC } from "../../../src/tempo.js";
import { txHashOf, txNameOf, type LedgerTx } from "../../eip155-tempo-mpp-ledger.js";
import { tempoLedgerReader, type TempoLedgerSpec } from "../../eip155-tempo-mpp-tempo-ledger.js";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { answering, READ_STATUS } from "../harness.js";

// The published Anvil development keys #0, #1 and #2: the payer, the option's payee and another account.
const KEYS = {
  payer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  payee: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  other: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const;
const ADDRESS = {
  payer: privateKeyToAccount(KEYS.payer).address.toLowerCase() as Hex,
  payee: privateKeyToAccount(KEYS.payee).address.toLowerCase() as Hex,
  other: privateKeyToAccount(KEYS.other).address.toLowerCase() as Hex,
};
const ELSEWHERE = "0x4444444444444444444444444444444444444444" as Hex;
const FILLER = "0x5555555555555555555555555555555555555555" as Hex;
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as Hex;
const H2 = "0x88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589" as Hex;
const CHAIN = 42431;
const NETWORK = `eip155:${CHAIN}` as const;
const TOKENS: Readonly<Record<string, Hex>> = {
  A: "0x20c0000000000000000000000000000000000000",
  B: "0x20c0000000000000000000000000000000000001",
};
/** The 2D nonce lane the payer signs under, and the nonce of the value the act takes. */
const LANE = 7n;
/** The final block, and the latest: beyond the read's sixteen pages where the case leaves the search open. */
const FINAL = 1000n;
/** Block b's timestamp: one second a block. */
const T0 = 1_800_000_000n;
const timestamp = (b: bigint): bigint => T0 + b;

const word = (a: string): Hex => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
const uint = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const num = (n: bigint): ViemHex => (n === 0n ? "0x" : toHex(n));

/** Why a case cannot be made on this ledger; only a case the pairing's profile states cannot arise may be skipped. */
class Cannot extends Error {}

/** A signed `0x76` transaction: its calls, nonce `nonce` of 2D lane `lane`, and `validBefore`; `gas` tells two contents apart. */
async function signed(key: Hex, calls: readonly [Hex, Hex][], lane: bigint, nonce: bigint, validBefore: bigint, gas = 200_000n): Promise<Hex> {
  const fields = [
    num(BigInt(CHAIN)), num(1n), num(2n), num(gas),
    calls.map(([to, data]) => [to, "0x", data]),
    [], num(lane), num(nonce), num(validBefore), "0x", "0x", "0x", [],
  ];
  const s = await sign({ hash: keccak256(concat(["0x76", toRlp(fields as never)])), privateKey: key });
  return concat(["0x76", toRlp([...fields, concat([s.r, s.s, toHex(Number(s.v), { size: 1 })])] as never)]) as Hex;
}

const memoCall = (to: Hex, amount: bigint, memo: Hex): Hex =>
  `${TRANSFER_WITH_MEMO_SELECTOR}${word(to).slice(2)}${uint(amount).slice(2)}${memo.slice(2)}` as Hex;

type CaseSeen = ReadCase["facts"]["seen"][number];

/** The names, positions and marks of one case, and the ledger's spelling of each. */
class Mapping {
  readonly blocks = new Map<bigint, number>();
  readonly marks = new Map<string, CaseMark>();
  readonly names = new Map<string, string>();
  constructor(readonly c: ReadCase) {}
  name(hash: string): string {
    return this.names.get(hash.toLowerCase()) ?? txNameOf(hash);
  }
  back(a: CaseAnswer): CaseAnswer {
    const out: Record<string, unknown> = { ...a };
    const named = "transaction" in a && a.transaction !== undefined ? a.transaction : undefined;
    if (named !== undefined) out["transaction"] = this.name(named);
    if ("position" in a && a.position !== undefined) out["position"] = this.blocks.get(a.position as unknown as bigint) ?? a.position;
    if ("finality" in a && a.finality !== undefined) {
      // Tempo's one mark: a transaction above `finalized` is read at the latest head, the case's own mark below the final one.
      const f = a.finality as unknown as string;
      out["finality"] = f === "finalized" ? "final" : (named !== undefined ? this.marks.get(this.name(named)) : undefined) ?? "included";
    }
    if ("search" in a && a.search !== undefined) out["search"] = this.blocks.get(a.search as unknown as bigint) ?? this.c.facts.search.at;
    if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map((u) => this.name(u));
    if ("moved" in a && a.moved !== undefined) {
      const want = this.c.facts.seen.find((s) => s.moved !== undefined)?.moved?.[0];
      out["moved"] = a.moved.map((m: Moved) => ({
        asset: Object.keys(TOKENS).find((k) => TOKENS[k] === m.asset) ?? m.asset,
        amount: m.amount,
        to: m.to === ADDRESS.payee ? "payee" : m.to === ELSEWHERE ? "elsewhere" : m.to,
        ...(want !== undefined && "transaction" in want ? { transaction: this.name(m.transaction!), place: m.place } : {}),
      }));
    }
    out["foreign"] = a.foreign.map((f: ForeignItem<unknown>) => ({ transaction: this.name(f.transaction), reason: f.reason }));
    return out as unknown as CaseAnswer;
  }
}

/** The block of a transaction at `position` read at `mark`: at the position below the final head, above it otherwise. */
const blockOf = (position: number, mark: CaseMark): bigint => BigInt(position) + (mark === "final" ? 0n : FINAL);

/**
 * The validity bound a case's value takes: passed at the final head, passed at the latest head alone, or not passed. A
 * value that is unconsumed at the final mark and consumed at the latest head, with its validity passed, is made with the
 * bound between the two heads: on Tempo a value read past its bound is read at the last block below it, so both reads
 * would be one read at the final head.
 */
function boundOf(c: ReadCase, latest: bigint): bigint {
  const v = c.facts.value;
  if (v === undefined) return c.facts.seen.some((s) => s.consumed) ? timestamp(latest) + 1000n : timestamp(FINAL) - 100n;
  if (!v.lapsed) return timestamp(latest) + 1000n;
  if (v.mark !== "final" || (!v.consumed && v.head?.consumed === true)) return timestamp(FINAL) + 50n;
  return timestamp(FINAL) - 100n;
}

/** The case's facts as a split-memo payment on the ledger, the reference and the query, or why they cannot be. */
async function splitLedger(c: ReadCase, act: Act, push: boolean) {
  const f = c.facts;
  const m = new Mapping(c);
  if (f.value !== undefined && f.value.head === undefined && !f.value.lapsed && f.value.consumed === false) {
    throw new Cannot("the read reads the value at the latest head whenever it reads it at the final mark");
  }
  const whole = f.search.whole;
  const latest = whole ? 3000n : 200_000n;
  const validBefore = boundOf(c, latest);
  const txs: LedgerTx[] = [];
  let presented: { hash: Hex; raw: Hex } | undefined;
  let namedHash: Hex | undefined;
  const consumed: { value: NonNullable<ReturnType<typeof tempoValueOf>>; from: bigint }[] = [];
  for (const [i, s] of f.seen.entries()) {
    if (s.position === undefined) throw new Cannot("every transaction the search meets is in a block, so the read places it");
    const block = blockOf(s.position, s.mark);
    m.blocks.set(block, s.position);
    m.marks.set(s.transaction, s.mark);
    // A consumer is the payer's: on Tempo only the payer's own signed transaction takes the payer's nonce, and rule 16
    // answers before-position before it asks who signed the transaction that consumed the value.
    const party = s.consumed ? "payer" : s.party;
    const moved = s.moved ?? [{ asset: "A", amount: "5", to: s.account === "payee" ? "payee" : "elsewhere" }];
    // An act that names no account is made as one that pays another (read-status rule 9 treats the two alike).
    const toOf = (to: string): Hex => (to === "payee" ? ADDRESS.payee : ELSEWHERE);
    const memo = s.carries ? H : H2;
    const calls: [Hex, Hex][] = moved.map((mv, k) => [TOKENS[mv.asset]!, memoCall(toOf(mv.to), BigInt(mv.amount), k === 0 ? memo : H2)]);
    // A transaction that does not take the value is signed on a lane of its own: a lane's nonces are taken in order.
    const lane = s.consumed ? LANE : LANE + 1n + BigInt(i);
    const gas = s.presented === "yes" ? 300_000n : 200_000n + BigInt(i);
    const raw = s.kind === "same" ? await signed(KEYS[party], calls, lane, 0n, validBefore, gas) : (`0x02${"ab".repeat(40)}` as Hex);
    // On push the credential names the payer's transaction over the value: its hash is its signed bytes' own.
    // Not one the case states is another payment than the one presented, nor one the caller gives as another act.
    const givenAsOther = (c.query.others ?? []).some((o) => "transaction" in o && o.transaction === s.transaction);
    const isNamed =
      push && (s.presented === "yes" || (s.consumed && s.presented === undefined && !givenAsOther && !f.seen.some((x) => x.presented === "yes")));
    const served = !(isNamed && s.result === "failed" && f.value === undefined);
    const hash = isNamed && served ? (keccak256(raw) as Hex) : txHashOf(s.transaction);
    if (isNamed) namedHash = hash;
    if (s.presented === "yes") presented = { hash, raw };
    m.names.set(hash.toLowerCase(), s.transaction);
    // The receipt's logs: each transfer from the payer at its place, and the transfer that carries H.
    const logs: EvmLog[] = [];
    if (s.result === "succeeded") {
      const places = moved.map((mv, k) => (typeof mv.place === "number" ? mv.place : k));
      const size = Math.max(...places) + 1;
      for (let p = 0; p < size; p++) logs.push({ address: FILLER, topics: [uint(BigInt(p))], data: "0x" });
      moved.forEach((mv, k) => {
        logs[places[k]!] = { address: TOKENS[mv.asset]!, topics: [TRANSFER_TOPIC, word(ADDRESS.payer), word(toOf(mv.to))], data: uint(BigInt(mv.amount)) };
      });
      const first = moved[0]!;
      logs.push({ address: TOKENS[first.asset]!, topics: [TRANSFER_WITH_MEMO_TOPIC, word(ADDRESS.payer), word(toOf(first.to)), memo], data: uint(BigInt(first.amount)) });
    }
    // A failed payment the credential names, on a case whose read holds no value: the endpoint returns no bytes for it.
    txs.push({ hash, block, status: s.result === "succeeded" ? 1 : 0, from: ADDRESS[party], to: TOKENS.A!, input: "0x", logs, ...(served ? { raw } : {}) });
  }
  // The payment presented, where no transaction of the case is it: the payer's, over the value, landed nowhere.
  if (presented === undefined) {
    const raw = await signed(KEYS.payer, [[TOKENS.A!, memoCall(ADDRESS.payee, 1n, H)]], LANE, 0n, validBefore, 400_000n);
    presented = { hash: keccak256(raw) as Hex, raw };
  }
  const value = tempoValueOf(Buffer.from(presented.raw.slice(2), "hex"))!;
  // The value's state where no transaction of the case takes it: consumed by a transaction the ledger does not hold.
  const v = f.value;
  if (v !== undefined && !f.seen.some((s) => s.consumed)) {
    if (v.consumed) consumed.push({ value, from: 1n });
    else if (v.head?.consumed === true) consumed.push({ value, from: FINAL + 10n });
  }
  for (const u of f.undecoded ?? []) {
    if (u.at === undefined) throw new Cannot("every item the search meets is in a block, so the read holds the search at it");
    const block = BigInt(u.at);
    m.blocks.set(block, u.at);
    const log = { address: TOKENS.A!, topics: [TRANSFER_WITH_MEMO_TOPIC, word(ADDRESS.other), word(ADDRESS.payee), H] as Hex[], data: uint(1n) };
    txs.push({ hash: txHashOf(u.transaction), block, status: 1, from: ADDRESS.other, to: TOKENS.A!, input: "0x", logs: [{ ...log, topics: [log.topics[0]!, word(ADDRESS.payer), log.topics[2]!, H] }], raw: `0x76${"c1".repeat(8)}` });
  }
  if (!whole && f.search.at === undefined && f.undecoded === undefined) throw new Cannot("a search with range left gives its position");
  // On push the read holds the value only where the endpoint returns the named transaction's bytes: a value the case
  // gives is the named payment's, returned though it has not landed; a case with no value names one the endpoint lacks.
  const named = !push ? undefined : (namedHash ?? (v === undefined ? txHashOf("t-unknown") : presented.hash));
  const spec: TempoLedgerSpec = { network: NETWORK, heads: { latest, safe: FINAL, finalized: FINAL }, txs, timestamp, consumed };
  let network: string = NETWORK;
  if (f.unreadable === "chain-mismatch") network = "eip155:1";
  const base = tempoLedgerReader({ ...spec, network });
  const fault = (method: string): boolean =>
    (f.unreadable === "transport" && method === "logs") || (f.unreadable === "too-large" && method === "logs");
  const reader = {
    ...base,
    async logs(filter: Parameters<typeof base.logs>[0]) {
      if (fault("logs")) throw new ReaderError(f.unreadable === "too-large" ? "too-large" : "transport");
      return base.logs(filter);
    },
    async block(at: "latest" | "safe" | "finalized" | bigint) {
      if (f.unreadable === "unparseable" && at === "finalized") return { number: "x" } as never;
      if (typeof at === "bigint" && !f.history && at < latest) throw new ReaderError("transport", "no such block on this node");
      return base.block(at);
    },
    async storageAt(address: Hex, slot: Hex, block: bigint) {
      if (!f.history && block < latest) throw new ReaderError("transport", "no state for that block");
      return base.storageAt(address, slot, block);
    },
    async call(to: Hex, data: Hex, block: bigint) {
      if (!f.history && block < latest) throw new ReaderError("transport", "no state for that block");
      return base.call(to, data, block);
    },
    async raw(tx: Hex) {
      if (named !== undefined && namedHash === undefined && tx.toLowerCase() === presented!.hash.toLowerCase() && v !== undefined) return presented!.raw;
      return base.raw(tx);
    },
  };
  const ref: TempoSplitRef = {
    network: NETWORK,
    payer: ADDRESS.payer,
    payee: ADDRESS.payee,
    currency: TOKENS.A!,
    h: H,
    validBefore: validBefore.toString(),
    nonce: { key: LANE.toString(), value: "0" },
    signed: value.signed,
    ...(named === undefined ? {} : { named }),
  };
  const others = (c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: txHashOf(o.transaction) } : o));
  const query = {
    act,
    finality: "finalized" as const,
    ...(c.query.after === undefined ? {} : { after: BigInt(c.query.after) }),
    ...(c.query.search === undefined ? {} : { search: BigInt(c.query.search) }),
    ...(others.length === 0 ? {} : { others }),
  };
  return { m, ref, reader, query };
}

const STATED = (why: string, profile = "mpp-charge-tempo-split-memo.md, rule 14"): string =>
  `declared inapplicable to the read kit: ${why}; profile ${profile}`;

const PLACED = "by the case's words, on every pairing at coverage `full`, since every log and transaction the read meets is in a block, which places it";

/** The cases whose name opens with `words`, on both acts, as one statement; a phrase no case opens with is a fault. */
function opening(words: string, stated: string): Inapplicable[] {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words)).map((c) => ({ case: c.case, stated }));
  if (found.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return found;
}

/** Declared on both forms: the four pairings on Tempo alone; every pairing at coverage full; the split-memo charge. */
const BOTH: Inapplicable[] = [
  ...opening(
    "an act read at the finality asked for, below the final mark",
    STATED("on the four pairings that live on Tempo alone, since no finality below `finalized`, Tempo's one mark, is asked"),
  ),
  ...opening(
    "an act the read cannot place against the position given",
    STATED("by the case's words, on every pairing at coverage `full`, since every log and transaction the read meets is in a block, which places it"),
  ),
  ...opening(
    "an item the search could not decode that gives no position",
    STATED("by the case's words, on every pairing at coverage `full`, since every log and transaction the read meets is in a block, which places it"),
  ),
  ...opening(
    "a read that did not read the value at the latest head",
    STATED("on the split-memo charge, on pull and on push, since each reads the value at `latest` whenever it reads it at `finalized`"),
  ),
];

const HOLDS = STATED("on the split-memo charge's pull, since the read holds what the payer signed, its transaction, and reads that value");

/**
 * Declared on pull alone: the read always holds the value, so `not-found` and, so, *a read with no means to read the
 * single-use value*; *search-incomplete is answered before not-found* runs, a search not read whole answering it.
 */
const PULL_ONLY: Inapplicable[] = [
  ...answering("not-found", HOLDS),
  ...opening("a read with no means to read the single-use value", HOLDS),
];

/**
 * Declared on push alone: the read meets a failed result of the payer's only as the transaction the credential names,
 * and every transaction a block includes has consumed its own nonce whatever its calls' result, so a failed result the
 * read meets consumed the value.
 */
const PUSH_ONLY: Inapplicable[] = opening(
  "a read with no means to read the single-use value that meets a failed result of the payer's",
  STATED(
    "on the split-memo charge's push, since the read meets a failed result of the payer's only as the transaction the " +
      "credential names, and every transaction a block includes consumed its nonce before its calls ran, whatever their " +
      "result (rule 8), so a failed result the read meets consumed the value",
  ),
);

function splitForm(subject: "mpp/charge/tempo/split-memo" | "mpp/charge/tempo/split-memo/push", inapplicable: Inapplicable[]): DeclaredForm {
  const push = subject.endsWith("/push");
  const codec = push ? tempoSplitMemoPush : tempoSplitMemo;
  return {
    form: {
      subject,
      arrange: (c, act) => {
        const declared = inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
        if (declared !== undefined) return { inapplicable: declared.stated };
        return {
          run: async () => {
            const { m, ref, reader, query } = await splitLedger(c, act, push);
            return m.back((await codec.status(ref as never, reader as never, query as never)) as never);
          },
        };
      },
    },
    inapplicable,
  };
}

// ── mpp/session/tempo: the opening, by the v1 escrow's ChannelOpened, the value by the opening's nonce.

const ESCROW = "0x9d136eea063ede5418a6bc7beaff009bbb6cfa70" as Hex;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const CHANNEL = evmChannelId({ payer: ADDRESS.payer, payee: ADDRESS.payee, token: TOKENS.A!, salt: H, authorizedSigner: ZERO, escrow: ESCROW, chainId: CHAIN }) as Hex;
const openCall = (payee: Hex, token: Hex, deposit: bigint, salt: Hex): Hex =>
  `${OPEN_V1_SELECTOR}${word(payee).slice(2)}${word(token).slice(2)}${uint(deposit).slice(2)}${salt.slice(2)}${word(ZERO).slice(2)}` as Hex;

/** The case's facts as a Tempo session's opening on the ledger, or why they cannot be. */
async function sessionTempoLedger(c: ReadCase, act: Act) {
  const f = c.facts;
  const m = new Mapping(c);
  if (f.value !== undefined && f.value.head === undefined && !f.value.lapsed && f.value.consumed === false) {
    throw new Cannot("the read reads the value at the latest head whenever it reads it at the final mark");
  }
  const latest = f.search.whole ? 3000n : 200_000n;
  const validBefore = boundOf(c, latest);
  const txs: LedgerTx[] = [];
  const consumed: { value: NonNullable<ReturnType<typeof tempoValueOf>>; from: bigint }[] = [];
  let presented: Hex | undefined;
  let named: Hex | undefined;
  for (const [i, s] of f.seen.entries()) {
    if (s.position === undefined) throw new Cannot("every transaction the search meets is in a block, so the read places it");
    if (s.account === "none") throw new Cannot("every opening names its channel's payee");
    if ((s.moved?.length ?? 1) !== 1) throw new Cannot("an opening deposits once, recorded as one deposit");
    const block = blockOf(s.position, s.mark);
    m.blocks.set(block, s.position);
    m.marks.set(s.transaction, s.mark);
    const hash = txHashOf(s.transaction);
    const party = s.consumed ? "payer" : s.party;
    const moved = s.moved?.[0];
    const token = TOKENS[moved?.asset ?? "A"]!;
    const payee = s.account === "payee" ? ADDRESS.payee : ELSEWHERE;
    const salt = s.carries ? H : H2;
    const deposit = BigInt(moved?.amount ?? "10000000");
    const lane = s.consumed ? LANE : LANE + 1n + BigInt(i);
    const gas = s.presented === "yes" ? 300_000n : 200_000n + BigInt(i);
    const raw = s.kind === "same" ? await signed(KEYS[party], [[ESCROW, openCall(payee, token, deposit, salt)]], lane, 0n, validBefore, gas) : (`0x02${"ab".repeat(40)}` as Hex);
    if (s.presented === "yes") presented = raw;
    // A reverted opening emits no event: the read meets it where it took the value, by the value's read.
    const data = concat([word(token), word(ZERO), salt, uint(deposit)]) as Hex;
    const log = { address: ESCROW, topics: [CHANNEL_OPENED_V1_TOPIC, CHANNEL, word(ADDRESS[party]), word(payee)] as Hex[], data };
    // `presented` unshown: the node holds no signed bytes for the transaction.
    const shown = s.presented !== "unshown";
    txs.push({ hash, block, status: s.result === "succeeded" ? 1 : 0, from: ADDRESS[party], to: ESCROW, input: "0x", logs: s.result === "succeeded" ? [log] : [], ...(shown ? { raw } : {}) });
  }
  presented ??= await signed(KEYS.payer, [[ESCROW, openCall(ADDRESS.payee, TOKENS.A!, 10_000_000n, H)]], LANE, 0n, validBefore, 400_000n);
  const value = tempoValueOf(Buffer.from(presented.slice(2), "hex"))!;
  const v = f.value;
  if (v !== undefined && !f.seen.some((s) => s.consumed)) {
    if (v.consumed) consumed.push({ value, from: 1n });
    else if (v.head?.consumed === true) consumed.push({ value, from: FINAL + 10n });
  }
  for (const u of f.undecoded ?? []) {
    if (u.at === undefined) throw new Cannot("every item the search meets is in a block, so the read holds the search at it");
    const block = BigInt(u.at);
    m.blocks.set(block, u.at);
    const log = { address: ESCROW, topics: [CHANNEL_OPENED_V1_TOPIC, CHANNEL, word(ADDRESS.other), word(ADDRESS.payee)] as Hex[], data: "0x" as Hex };
    txs.push({ hash: txHashOf(u.transaction), block, status: 1, from: ADDRESS.other, to: ESCROW, input: "0x", logs: [log], raw: `0x76${"c1".repeat(8)}` });
  }
  if (!f.search.whole && f.undecoded === undefined && f.search.at === undefined) throw new Cannot("a search with range left gives its position");
  let network: string = NETWORK;
  if (f.unreadable === "too-large" || f.unreadable === "unparseable") named = txHashOf("t-named");
  if (f.unreadable === "chain-mismatch") network = "eip155:1";
  const base = tempoLedgerReader({ network, heads: { latest, safe: FINAL, finalized: FINAL }, txs, timestamp, consumed });
  const old = (block: bigint): void => {
    if (!f.history && block < latest) throw new ReaderError("transport", "no state for that block");
  };
  const reader = {
    ...base,
    async logs(filter: Parameters<typeof base.logs>[0]) {
      if (f.unreadable === "transport") throw new ReaderError("transport");
      return base.logs(filter);
    },
    async receipt(tx: Hex) {
      if (f.unreadable === "too-large" && tx === named) throw new ReaderError("too-large");
      if (f.unreadable === "unparseable" && tx === named) return { status: 1, blockNumber: "x", logs: [] } as never;
      return base.receipt(tx);
    },
    async block(at: "latest" | "safe" | "finalized" | bigint) {
      if (typeof at === "bigint") old(at);
      return base.block(at);
    },
    async storageAt(address: Hex, slot: Hex, block: bigint) {
      old(block);
      return base.storageAt(address, slot, block);
    },
    async call(to: Hex, data: Hex, block: bigint) {
      old(block);
      return base.call(to, data, block);
    },
  };
  const ref: SessionRef = {
    network: NETWORK as SessionRef["network"],
    payee: ADDRESS.payee,
    opened: { address: ESCROW, version: "v1", channel: CHANNEL, h: H, chainId: CHAIN },
    payer: ADDRESS.payer,
    signed: value.signed,
    nonce: { key: LANE.toString(), value: "0" },
    validBefore: validBefore.toString(),
    ...(named === undefined ? {} : { transaction: named }),
  };
  const others = (c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: txHashOf(o.transaction) } : o));
  const query = {
    act,
    finality: "finalized" as const,
    ...(c.query.after === undefined ? {} : { after: BigInt(c.query.after) }),
    ...(c.query.search === undefined ? {} : { search: BigInt(c.query.search) }),
    ...(others.length === 0 ? {} : { others }),
  };
  return { m, ref, reader, query };
}

const SESSION_HOLDS = STATED(
  "on `session/tempo`, `not-found`, since the read holds what the payer signed, its opening's transaction, and reads that value",
  "mpp-session-evm-tempo.md, rule 8",
);
const SESSION_NO_SEARCH = STATED(
  "on `session/tempo` and `session/evm`, since neither answers `failed` but `before-position`, neither making a search for H for an opening",
  "mpp-session-evm-tempo.md, rule 8",
);
const SESSION_ONE_DEPOSIT = STATED(
  "by the case's words, on `session/tempo` and `session/evm`, since an opening moves one deposit, from the payer to the escrow, and names its channel's `payee`",
  "mpp-session-evm-tempo.md, rule 8",
);

/**
 * `mpp/session/tempo`'s declarations, as the profile mpp-session-evm-tempo.md rule 8 states
 * them. *A read with no means to read the single-use value* and *search-incomplete is answered before not-found* run:
 * the read answers no `failed` but `before-position`, and a search not read whole answers `search-incomplete`.
 */
const SESSION_TEMPO: Inapplicable[] = [
  ...answering("not-found", SESSION_HOLDS),
  ...opening(
    "an act read at the finality asked for, below the final mark",
    STATED("on the four pairings that live on Tempo alone, since no finality below `finalized`, Tempo's one mark, is asked", "mpp-session-evm-tempo.md, rule 8"),
  ),
  ...answering("instrument-unused", SESSION_NO_SEARCH),
  ...answering("instrument-consumed", SESSION_NO_SEARCH),
  ...answering("transaction-failed", SESSION_NO_SEARCH),
  ...opening("an act the read cannot place against the position given", STATED(PLACED, "mpp-session-evm-tempo.md, rule 8")),
  ...opening("an item the search could not decode that gives no position", STATED(PLACED, "mpp-session-evm-tempo.md, rule 8")),
  ...opening(
    "a read that did not read the value at the latest head",
    STATED("on `session/tempo`, since it reads the value at `latest` whenever it reads it at `finalized`", "mpp-session-evm-tempo.md, rule 8"),
  ),
  ...opening("each transfer of what moved is named by its transaction and its place", SESSION_ONE_DEPOSIT),
  ...opening("an act carrying H that names no account", SESSION_ONE_DEPOSIT),
].filter((d, i, all) => all.findIndex((x) => x.case === d.case && JSON.stringify(x.acts) === JSON.stringify(d.acts)) === i);

const sessionTempoForm: DeclaredForm = {
  form: {
    subject: "mpp/session/tempo",
    arrange: (c, act) => {
      const declared = SESSION_TEMPO.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
      if (declared !== undefined) return { inapplicable: declared.stated };
      return {
        run: async () => {
          const { m, ref, reader, query } = await sessionTempoLedger(c, act);
          return m.back((await sessionTempo.status(ref as never, reader as never, query as never)) as never);
        },
      };
    },
  },
  inapplicable: SESSION_TEMPO,
};

// ── mpp/subscription/tempo: the activation, by the account keychain's KeyAuthorizationWitness carrying H.

const KEYCHAIN = "0xaaaaaaaa00000000000000000000000000000000" as Hex;
/** The access key the challenge issues, and another key. */
const ACCESS_KEY = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Hex;
const OTHER_KEY = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" as Hex;

/** A key authorization in the RLP items `toRlp` writes: its token, key, recipients, expiry and witness. */
function keyAuthorizationItems(token: Hex, keyId: Hex, recipients: readonly Hex[], expiry: bigint, witness: Hex): unknown[] {
  return [num(BigInt(CHAIN)), "0x", keyId, num(expiry), [[token, num(10_000_000n), num(2_592_000n)]], [[token, [[TRANSFER_WITH_MEMO_SELECTOR, [...recipients]]]]], witness];
}

/** The key authorization `items` signed by `key` over keccak-256 of its bytes, as the RLP items and as its signed bytes. */
async function signedKeyAuthorization(key: Hex, items: unknown[]): Promise<{ item: unknown[]; bytes: Hex }> {
  const s = await sign({ hash: keccak256(toRlp(items as never)), privateKey: key });
  const item = [items, concat([s.r, s.s, toHex(Number(s.v), { size: 1 })])];
  return { item, bytes: toRlp(item as never) as Hex };
}

/** A signed `0x76` transaction carrying a key authorization, item 13, before the sender's signature, with `calls`. */
async function activationTx(key: Hex, keyAuthorization: unknown[] | undefined, gas: bigint, calls: readonly [Hex, Hex][] = []): Promise<Hex> {
  const fields = [
    num(BigInt(CHAIN)), num(1n), num(2n), num(gas), calls.map(([to, data]) => [to, "0x", data]), [], num(LANE), "0x", "0x", "0x", "0x", "0x", [],
    ...(keyAuthorization === undefined ? [] : [keyAuthorization]),
  ];
  const s = await sign({ hash: keccak256(concat(["0x76", toRlp(fields as never)])), privateKey: key });
  return concat(["0x76", toRlp([...fields, concat([s.r, s.s, toHex(Number(s.v), { size: 1 })])] as never)]) as Hex;
}

/** `authorizeAdminKey(keyId, secp256k1, witness)`: a keychain call that authorizes `keyId` for the caller. */
const authorizeCall = (keyId: Hex, witness: Hex): Hex => `0x9a424307${word(keyId).slice(2)}${uint(0n).slice(2)}${witness.slice(2)}` as Hex;

/** The case's facts as a subscription's activation on the ledger, or why they cannot be. */
async function activationLedger(c: ReadCase, act: Act) {
  const f = c.facts;
  const m = new Mapping(c);
  const v = f.value;
  if (v !== undefined && v.head === undefined && !v.lapsed && !v.consumed) throw new Cannot("the read reads the slot at `latest` whenever it reads it at `finalized`");
  const latest = f.search.whole ? 3000n : 200_000n;
  // The bound: passed at the final head, at the latest head alone, or not signed. A case that gives no value is made
  // with the bound passed and the slot unconsumed where no transaction of it registers the key, so that the slot's read
  // decides nothing the case does not state.
  const expiry =
    v === undefined
      ? f.seen.some((s) => s.consumed) ? undefined : timestamp(FINAL) - 100n
      : !v.lapsed ? undefined : v.mark === "final" ? timestamp(FINAL) - 100n : timestamp(FINAL) + 50n;
  const txs: LedgerTx[] = [];
  const keys: { account: Hex; keyId: Hex; from: bigint }[] = [];
  let signed: Hex | undefined;
  const witness = (account: Hex): EvmLog => ({ address: KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, word(account), H], data: "0x" });
  for (const [i, s] of f.seen.entries()) {
    if (s.position === undefined) throw new Cannot("every transaction the search meets is in a block, so the read places it");
    const block = blockOf(s.position, s.mark);
    m.blocks.set(block, s.position);
    m.marks.set(s.transaction, s.mark);
    // A consumer is the payer's: only the account's own transaction registers a key in its keychain.
    const party = s.consumed ? "payer" : s.party;
    const recipients = s.account === "payee" ? [ADDRESS.payee] : s.account === "other" ? [ELSEWHERE] : [ADDRESS.payee, ELSEWHERE];
    // The payer's key authorization for the issued key registers the slot whatever its result.
    if (party === "payer" && s.kind === "same" && !s.consumed) throw new Cannot("the payer's key authorization for the key registers its slot");
    // A consumer of another kind registers the key by its own keychain call, which a revert undoes.
    const byCall = s.consumed && s.kind === "other";
    if (byCall && s.result === "failed") throw new Cannot("a reverted keychain call registers no key");
    const items = keyAuthorizationItems(TOKENS.A!, s.kind === "same" ? ACCESS_KEY : OTHER_KEY, recipients, 1_900_000_000n + BigInt(i), s.carries ? H : H2);
    const ka = await signedKeyAuthorization(KEYS[party], items);
    // The key authorization presented: the case's, where it states one, else the payer's own act's.
    if (s.presented === "yes" || (s.presented === undefined && signed === undefined && party === "payer" && s.kind === "same")) {
      signed = keccak256(ka.bytes) as Hex;
    }
    if (s.presented === "no") signed = keccak256((await signedKeyAuthorization(KEYS[party], keyAuthorizationItems(TOKENS.A!, ACCESS_KEY, recipients, 1_950_000_000n, H))).bytes) as Hex;
    // The log's place in the receipt is the place each transfer names; the others hold the witness and fillers.
    const transfers = (s.moved ?? []).map((mv, j) => ({ mv, place: typeof mv.place === "number" ? mv.place : j + 1 }));
    const logs: EvmLog[] = [];
    const size = Math.max(1, ...transfers.map((t) => t.place + 1));
    for (let p = 0; p < size; p++) logs.push({ address: FILLER, topics: [H2], data: "0x" });
    const free = logs.findIndex((_, p) => !transfers.some((t) => t.place === p));
    if (s.carries) logs[free === -1 ? logs.length : free] = witness(ADDRESS[party]);
    for (const { mv, place } of transfers) {
      const to = mv.to === "payee" ? ADDRESS.payee : ELSEWHERE;
      logs[place] = { address: TOKENS[mv.asset]!, topics: [TRANSFER_TOPIC, word(ADDRESS[party]), word(to)], data: uint(BigInt(mv.amount)) };
    }
    const calls: [Hex, Hex][] = byCall ? [[KEYCHAIN, authorizeCall(ACCESS_KEY, H2)]] : [];
    if (byCall) keys.push({ account: ADDRESS.payer, keyId: ACCESS_KEY, from: block });
    const raw = await activationTx(KEYS[party], ka.item, 200_000n + BigInt(i), calls);
    // A reverted activation's receipt holds its witness log, as the recorded Moderato receipt in
    // test/fixtures/tempo-access-key.json does; the ledger's log search returns no reverted receipt's logs, so the read
    // meets a reverted activation by the key slot alone.
    txs.push({ hash: txHashOf(s.transaction), block, status: s.result === "succeeded" ? 1 : 0, from: ADDRESS[party], to: null, input: "0x", logs, raw });
  }
  // The slot's state where no transaction of the case registers it: registered by a transaction the read cannot find.
  if (v !== undefined && !f.seen.some((s) => s.consumed)) {
    if (v.consumed) keys.push({ account: ADDRESS.payer, keyId: ACCESS_KEY, from: 1n });
    else if (v.head?.consumed === true) keys.push({ account: ADDRESS.payer, keyId: ACCESS_KEY, from: FINAL + 10n });
  }
  // With no act of the payer's, the key authorization presented is one that never landed.
  signed ??= keccak256(
    (await signedKeyAuthorization(KEYS.payer, keyAuthorizationItems(TOKENS.A!, ACCESS_KEY, [ADDRESS.payee], 1_950_000_000n, H))).bytes,
  ) as Hex;
  for (const u of f.undecoded ?? []) {
    if (u.at === undefined) throw new Cannot("every item the search meets is in a block, so the read holds the search at it");
    const block = BigInt(u.at);
    m.blocks.set(block, u.at);
    txs.push({ hash: txHashOf(u.transaction), block, status: 1, from: ADDRESS.other, to: null, input: "0x", logs: [witness(ADDRESS.other)], raw: `0x76${"c1".repeat(8)}` });
  }
  if (!f.search.whole && f.undecoded === undefined && f.search.at === undefined) throw new Cannot("a search with range left gives its position");
  let named: Hex | undefined;
  if (f.unreadable === "too-large" || f.unreadable === "unparseable") named = txHashOf("t-named");
  const network = f.unreadable === "chain-mismatch" ? "eip155:1" : NETWORK;
  const base = tempoLedgerReader({ network, heads: { latest, safe: FINAL, finalized: FINAL }, txs, timestamp, keys });
  const old = (block: bigint): void => {
    if (!f.history && block < latest) throw new ReaderError("transport", "no state for that block");
  };
  const reader = {
    ...base,
    async logs(filter: Parameters<typeof base.logs>[0]) {
      if (f.unreadable === "transport") throw new ReaderError("transport");
      return base.logs(filter);
    },
    async receipt(tx: Hex) {
      if (f.unreadable === "too-large" && tx === named) throw new ReaderError("too-large");
      if (f.unreadable === "unparseable" && tx === named) return { status: 1, blockNumber: "x", logs: [] } as never;
      return base.receipt(tx);
    },
    async block(at: "latest" | "safe" | "finalized" | bigint) {
      if (typeof at === "bigint") old(at);
      return base.block(at);
    },
    async call(to: Hex, data: Hex, block: bigint) {
      old(block);
      return base.call(to, data, block);
    },
  };
  const ref: SessionRef = {
    network: NETWORK as SessionRef["network"],
    payee: ADDRESS.payee,
    bindingLog: { address: KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: H as never },
    accessKey: { keyId: ACCESS_KEY, token: TOKENS.A!, to: H, ...(expiry === undefined ? {} : { expiry: expiry.toString() }) },
    payer: ADDRESS.payer,
    signed,
    ...(named === undefined ? {} : { transaction: named }),
  };
  const others = (c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: txHashOf(o.transaction) } : o));
  const query = {
    act,
    finality: "finalized" as const,
    ...(c.query.after === undefined ? {} : { after: BigInt(c.query.after) }),
    ...(c.query.search === undefined ? {} : { search: BigInt(c.query.search) }),
    ...(others.length === 0 ? {} : { others }),
  };
  return { m, ref, reader, query };
}

const SUBSCRIPTION_HOLDS = STATED(
  "on `subscription/tempo`, since the read holds its single-use value, the key slot the presented key authorization " +
    "names, and reads it at `finalized` and at `latest`",
  "mpp-session-evm-tempo.md, rule 8",
);

const SUBSCRIPTION_REGISTERS = STATED(
  "on `subscription/tempo`, since the payer's key authorization for the issued key registers the key's slot whatever " +
    "the transaction's result, before its calls run, so every act of the payer's of the pairing's kind consumed the value",
  "mpp-session-evm-tempo.md, rule 8",
);

/** `mpp/subscription/tempo`'s declarations, as the profile mpp-session-evm-tempo.md rule 8 states them. */
const SUBSCRIPTION: Inapplicable[] = [
  ...answering("not-found", SUBSCRIPTION_HOLDS),
  ...opening("a read with no means to read the single-use value", SUBSCRIPTION_HOLDS),
  ...opening("a read that did not read the value at the latest head", SUBSCRIPTION_HOLDS),
  ...opening("an act carrying H that names no account and consumed nothing", SUBSCRIPTION_REGISTERS),
  ...opening("an act the caller gave as another act under the same H", SUBSCRIPTION_REGISTERS),
  ...opening("transactions carrying H with a failed result, the payer's own and one the payee signed", SUBSCRIPTION_REGISTERS),
  ...opening("a failed result that left the value unconsumed", SUBSCRIPTION_REGISTERS),
  ...opening(
    "an act read at the finality asked for, below the final mark",
    STATED("on the four pairings that live on Tempo alone, since no finality below `finalized`, Tempo's one mark, is asked", "mpp-session-evm-tempo.md, rule 8"),
  ),
  ...opening("an act the read cannot place against the position given", STATED(PLACED, "mpp-session-evm-tempo.md, rule 8")),
  ...opening("an item the search could not decode that gives no position", STATED(PLACED, "mpp-session-evm-tempo.md, rule 8")),
];

/** `mpp/subscription/tempo`'s form: each activation arranged on the keychain's ledger and read by its own `status`. */
const subscriptionForm: DeclaredForm = {
  form: {
    subject: "mpp/subscription/tempo",
    arrange: (c, act) => {
      const declared = SUBSCRIPTION.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
      if (declared !== undefined) return { inapplicable: declared.stated };
      return {
        run: async () => {
          const { m, ref, reader, query } = await activationLedger(c, act);
          return m.back((await subscriptionTempo.status(ref as never, reader as never, query as never)) as never);
        },
      };
    },
  },
  inapplicable: SUBSCRIPTION,
};

export const forms: readonly DeclaredForm[] = [
  splitForm("mpp/charge/tempo/split-memo", [...BOTH, ...PULL_ONLY]),
  splitForm("mpp/charge/tempo/split-memo/push", [...BOTH, ...PUSH_ONLY]),
  sessionTempoForm,
  subscriptionForm,
];

export { Cannot, type CaseSeen };
