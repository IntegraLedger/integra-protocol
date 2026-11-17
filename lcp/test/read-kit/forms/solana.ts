// The forms of the Solana pairings: each case of read-status.json made on a constructed Solana ledger and read through
// the pairing's own `status`. Every fixture here is constructed, not recorded: the transactions are legacy wire
// transactions encoded by this file's own encoder (Solana's documented message layout: the header's three counts, the
// compact-u16 key list, the recent blockhash and the compiled instructions), with token balances and slots as
// `getTransaction` returns them, and the reader answers as the JSON-RPC methods it stands for document their results.
//
// How a case's terms map to the Solana ledger:
// - a position p is the slot 1000 + p; the mark `final` is `finalized`, the one mark. A transaction of a case at `safe` or
//   `included` is one found only at `confirmed`, the latest head, which is no mark: the read names it with no finality,
//   and the answer is put back at the case's mark below `final`;
// - the act's signer is the buyer, `payee` the option's payee, `other` a third account; a transfer pairing's act of
//   another kind holds a payment-channels instruction, and a channel pairing's is a plain transfer;
// - the account an act names: a `TransferChecked` from the buyer's token account to one the payee owns (`payee`) or a
//   third account owns (`other`), or no transfer (`none`); for a channel, an `open` whose distribution holds the payee,
//   a third account, or no one;
// - a single-use value read (the case's `value`) is a reference that holds the presented message: the transaction that
//   consumed it carries that message, and an unconsumed one is a presented transaction no lookup finds; a value the read
//   cannot read (no `value`) is a reference to a transaction alone, the transaction that consumed it (else one no lookup
//   finds), which is what was presented, so `presented` compares by that transaction (read-status rule 13), and an act
//   whose message differs from the one presented is another transaction of the buyer; a value consumed by no transaction
//   found is a durable nonce that moved; a lapse is the finalized slot (or, below the final mark, the confirmed slot) 150
//   past the context slot of an `isBlockhashValid` answer of `true`;
// - each transfer of what moved sits at the place the case names, the instructions before it Compute Budget ones;
// - a search not read whole is one whose listing names a candidate carrying H that neither lookup finds; its handle maps
//   to the case's position 42 and back; a handle that holds no range left (only the blockhash's bound) reads again from the
//   head, the case's own position, or none where an item the search could not decode gives none, that item being listed
//   first; at coverage `none` the lookup is the search, and an item it could not decode is held at the lookup;
// - a reader that does not show its history answers a first available block above the position (above 0 where none is
//   given); the unreadable cases are a rejected call, an answer out of its documented form, a `too-large` rejection and a
//   reader for another network.
import { base58 } from "@scure/base";
import { BINDINGS, type AtrHash, type PairingId } from "../../../src/index.js";
import type { Act } from "../../../src/internal/read.js";
import type { SvmLanded, SvmReader, SvmRef, SvmSignature, SvmStatus } from "../../../src/internal/svm-read.js";
import { decodeSvmTx, svmDigest } from "../../../src/internal/svm.js";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { answering, READ_STATUS } from "../harness.js";

type Seen = ReadCase["facts"]["seen"][number];

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const OTHER_NETWORK = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const H = `0x${"5a".repeat(32)}` as AtrHash;
const MEMO_TEXT = `lcp:sha256:${H}`;

/** A 32-byte key of one repeated byte, as base58. */
const key = (b: number): string => base58.encode(new Uint8Array(32).fill(b));
const FEE_PAYER = key(1);
const BUYER = key(2);
const PAYEE = key(3);
const OTHER = key(4);
const MINT = key(5);
/** The mint each asset a case names stands for. */
const MINTS: Readonly<Record<string, string>> = { A: key(5), B: key(14) };
const BUYER_TOKEN = key(6);
const PAYEE_TOKEN = key(7);
const OTHER_TOKEN = key(8);
const CHANNEL = key(9);
const NONCE_ACCOUNT = key(10);
const NONCE_VALUE = key(11);
const BLOCKHASH = key(12);
const OTHER_BLOCKHASH = key(13);
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SYSTEM = "11111111111111111111111111111111";
const CHANNELS = "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const RECENT_BLOCKHASHES = "SysvarRecentB1ockHashes11111111111111111111";

/** A signature of 64 repeated bytes: the transaction id of the fixture numbered `n`. */
const signature = (n: number): Uint8Array => new Uint8Array(64).fill(n);
const PRESENTED = 200; // a presented transaction no lookup finds
const GHOST = 201; // a listed candidate no lookup finds
const TOP = 202; // the newest signature listed, which carries no memo
const FIRST = 300; // an item listed above every other, with no signature before it

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

interface Ix {
  program: string;
  accounts: string[];
  data: number[];
}

/**
 * A legacy wire transaction: the signers first (writable), then the other writable keys, then the read-only ones, in
 * first-use order; one signature per signer, the first `sig`, the rest zeros.
 */
function wire(signers: string[], writable: string[], ixs: Ix[], blockhash: string, sig: Uint8Array): { wire: Uint8Array; keys: string[] } {
  const keys: string[] = [...signers];
  for (const k of writable) if (!keys.includes(k)) keys.push(k);
  const readonly: string[] = [];
  for (const ix of ixs) for (const k of [...ix.accounts, ix.program]) if (!keys.includes(k) && !readonly.includes(k)) readonly.push(k);
  keys.push(...readonly);
  const message = [
    signers.length,
    0,
    readonly.length,
    ...compact(keys.length),
    ...keys.flatMap((k) => [...base58.decode(k)]),
    ...base58.decode(blockhash),
    ...compact(ixs.length),
    ...ixs.flatMap((ix) => [
      keys.indexOf(ix.program),
      ...compact(ix.accounts.length),
      ...ix.accounts.map((a) => keys.indexOf(a)),
      ...compact(ix.data.length),
      ...ix.data,
    ]),
  ];
  const sigs = signers.flatMap((_, i) => [...(i === 0 ? sig : new Uint8Array(64))]);
  return { wire: Uint8Array.from([...compact(signers.length), ...sigs, ...message]), keys };
}

const memo: Ix = { program: MEMO, accounts: [], data: [...new TextEncoder().encode(MEMO_TEXT)] };

/** The act's transaction for a seen transaction of a case, on a transfer or a channel pairing. */
function actOf(
  kind: "transfer" | "channel",
  s: Seen,
  n: number,
  opts: { nonce?: boolean; memo?: boolean; blockhash?: string },
): { wire: Uint8Array; keys: string[] } {
  const signer = s.party === "payer" ? BUYER : s.party === "payee" ? PAYEE : OTHER;
  const to = s.account === "payee" ? PAYEE : OTHER;
  const moved = s.moved?.[0];
  const mint = MINTS[moved?.asset ?? "A"] ?? MINT;
  const amount = BigInt(moved?.amount ?? n);
  const ixs: Ix[] = [];
  if (opts.nonce) ixs.push({ program: SYSTEM, accounts: [NONCE_ACCOUNT, RECENT_BLOCKHASHES, signer], data: [4, 0, 0, 0] });
  const transferOf = (m: { asset?: string; amount?: string } | undefined): Ix => ({
    program: TOKEN,
    accounts: [BUYER_TOKEN, MINTS[m?.asset ?? "A"] ?? MINT, to === PAYEE ? PAYEE_TOKEN : OTHER_TOKEN, signer],
    data: [12, ...u64(BigInt(m?.amount ?? n)), 6],
  });
  const transfer = transferOf(moved);
  // Several transfers, each at the place the case names: the instructions before each, Compute Budget ones.
  const placed = (s.moved ?? []).filter((m) => typeof (m as { place?: unknown }).place === "number");
  if (kind === "transfer" && sameKindOf(s) && placed.length > 1) {
    for (const m of placed) {
      const at = (m as { place: number }).place;
      while (ixs.length < at) ixs.push({ program: COMPUTE_BUDGET, accounts: [], data: [3, ...u64(1n)] });
      ixs.push(transferOf(m));
    }
    ixs.push(memo);
    return wire([FEE_PAYER, signer], [BUYER_TOKEN, PAYEE_TOKEN, OTHER_TOKEN], ixs, opts.blockhash ?? BLOCKHASH, signature(n));
  }
  const open = (recipients: string[]): Ix => ({
    program: CHANNELS,
    accounts: [signer, FEE_PAYER, PAYEE, mint, signer, CHANNEL],
    data: [
      1,
      ...u64(BigInt(n)),
      ...u64(amount),
      0, 0, 0, 0,
      ...u64(0n),
      ...[recipients.length, 0, 0, 0],
      ...recipients.flatMap((r) => [...base58.decode(r), 0x10, 0x27]),
    ],
  });
  const sameKind = s.kind === "same";
  if (kind === "transfer") {
    if (s.account !== "none") ixs.push(transfer);
    if (!sameKind) ixs.push(open([PAYEE]));
  } else if (sameKind) {
    ixs.push(open(s.account === "none" ? [] : [to]));
  } else if (s.account !== "none") {
    ixs.push(transfer);
  }
  if (opts.memo !== false) ixs.push(memo);
  const writable = [BUYER_TOKEN, PAYEE_TOKEN, OTHER_TOKEN, CHANNEL, ...(opts.nonce ? [NONCE_ACCOUNT] : [])];
  const blockhash = opts.nonce ? NONCE_VALUE : (opts.blockhash ?? (n % 2 === 0 ? BLOCKHASH : OTHER_BLOCKHASH));
  return wire([FEE_PAYER, signer], writable, ixs, blockhash, signature(n));
}

const sameKindOf = (s: Seen): boolean => s.kind === "same";

const SLOT = (p: number): bigint => 1000n + BigInt(p);

/**
 * The answer in the case's terms: its transactions by the case's names, its slots as positions, `finalized` as `final`
 * and `confirmed` as the case's mark below it, and its search handle as the case's search position: the position of the
 * item the handle resumes at (the item listed after its `before`), or the case's own where the handle reads again from the
 * head; a handle that holds only the blockhash's bound, where the case names no position, is no search position.
 */
function back(
  c: ReadCase,
  a: SvmStatus,
  names: Map<string, string>,
  below: CaseMark,
  listing: readonly SvmSignature[],
  positions: Map<string, unknown>,
): CaseAnswer {
  const name = (t: string): string => names.get(t) ?? t;
  const out: Record<string, unknown> = { ...a };
  if ("transaction" in a && typeof a.transaction === "string") out["transaction"] = name(a.transaction);
  if ("position" in a && typeof a.position === "bigint") out["position"] = Number(a.position - 1000n);
  // `finalized` is the case's `final`; a transaction named with no finality was met only above the final head.
  if ("finality" in a && a.finality !== undefined) out["finality"] = a.finality === "finalized" ? "final" : a.finality;
  else if ("transaction" in a && typeof a.transaction === "string") out["finality"] = below;
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(name);
  if ("search" in a) {
    const h = (a.search ?? {}) as { before?: string; head?: string };
    let mapped: unknown;
    if (h.before !== undefined) {
      const next = listing[listing.findIndex((e) => e.signature === h.before) + 1]?.signature;
      mapped = next === undefined ? undefined : positions.get(next);
    } else if (h.head === undefined) {
      // From the head: the case's own position; none where an item that holds the search gives none; at coverage `none`,
      // the lookup's own item.
      const given = new Set((c.query.others ?? []).map((o) => (o as { transaction?: string }).transaction));
      const holding = (c.facts.undecoded ?? []).filter((u) => !given.has(u.transaction));
      mapped = holding.some((u) => u.at === undefined) ? undefined : (c.facts.search.at ?? holding[0]?.at);
    }
    if (mapped !== undefined) out["search"] = mapped;
    else if (h.before === undefined && h.head === undefined) delete out["search"];
  }
  const asset = (m: string): string => Object.entries(MINTS).find(([, k]) => k === m)?.[0] ?? m;
  const to = (t: string): string => (t === PAYEE ? "payee" : t === OTHER ? "elsewhere" : t);
  const movedBack = (list: readonly { asset: string; to: string; transaction?: string }[] | undefined) =>
    list?.map((m) => ({
      ...m,
      asset: asset(m.asset),
      to: to(m.to),
      ...(m.transaction === undefined ? {} : { transaction: name(m.transaction) }),
    }));
  if ("moved" in a && a.moved !== undefined) out["moved"] = movedBack(a.moved);
  out["foreign"] = a.foreign.map((f) => ({
    ...f,
    transaction: name(f.transaction),
    ...(f.position === undefined ? {} : { position: Number(f.position - 1000n) }),
    ...(f.moved === undefined ? {} : { moved: movedBack(f.moved) }),
  }));
  return out as unknown as CaseAnswer;
}

// ── the declarations: the cases the read cannot meet on Solana, as each pairing's profile states them ───────────────

const ENTRY = "declared inapplicable to the read kit, a case the read cannot meet on Solana";

/** On every pairing with a read: a seller names `finalized` alone. */
const BELOW: Inapplicable = {
  case: "an act read at the finality asked for, below the final mark, is settled at that mark",
  stated: `${ENTRY}, on every pairing with a read: an act read at the finality asked for, below the final mark, since a seller names finalized alone`,
};

/**
 * While the search proves no absence, until a run shows that the buyer's signatures list every transaction the buyer
 * signs: every case at coverage `full` whose answer on the act is `instrument-unused`, `instrument-consumed` or
 * `transaction-failed`, its search resting on the fact not yet shown.
 */
const GATE: readonly Inapplicable[] = (["instrument-unused", "instrument-consumed", "transaction-failed"] as const)
  .flatMap((reason) =>
    answering(
      reason,
      `${ENTRY}: while the search proves no absence, until a run shows that the buyer's signatures list every ` +
        "transaction the buyer signs, the cases its gate holds; the read answers them " +
        "pending, search-incomplete (vectors/svm-read.json)",
    ),
  )
  .filter((d) => READ_STATUS.cases.find((c) => c.case === d.case)?.coverage === "full");

/** Where the read holds the signed message: its search and lookups read on to `confirmed`, and its lapse. */
const HELD_MESSAGE: readonly Inapplicable[] = [
  {
    case: "a read that did not read the value at the latest head never answers instrument-live",
    stated: `${ENTRY}, where the read holds the signed message: a read that did not read the value at the latest head, since its search and its lookups read on to confirmed`,
  },
  {
    case: "a value whose validity passed, unconsumed at the final mark and consumed at the latest head, is not instrument-unused: search-incomplete",
    stated:
      `${ENTRY}, where the read holds the signed message: a value whose validity passed, unconsumed at the final mark and ` +
      "consumed at the latest head, since a blockhash message is consumed only by its own transaction, which that read " +
      "finds, and a durable-nonce message has no lapse",
  },
];

/**
 * On the channel openings (`x402/upto/solana`, `x402/batch-settlement/solana`, `mpp/session/solana/memo`): the act holds
 * exactly one `open`, whose one deposit into the channel's token account is what moved.
 */
const ONE_TRANSFER: Inapplicable = {
  case: "each transfer of what moved is named by its transaction and its place in it, in the pairing's own spelling",
  stated:
    `${ENTRY}, on x402/upto/solana, x402/batch-settlement/solana and mpp/session/solana/memo: each transfer of what moved ` +
    "is named by its transaction and its place in it, since the act of each is an opening that holds exactly one open, " +
    "whose one deposit into the channel's token account is what moved, a transaction holding more being no act of these pairings",
};

/** The declared cases of a pairing at coverage `full`, every Solana read holding the signed message it was presented. */
const FULL: readonly Inapplicable[] = [BELOW, ...GATE, ...HELD_MESSAGE];
/** The same, on the channel openings that carry H. */
const OPENING: readonly Inapplicable[] = [...FULL, ONE_TRANSFER];
/** At coverage `none` the read makes no search, so no case is held by the search's gate. */
const NONE: readonly Inapplicable[] = [BELOW, ...HELD_MESSAGE];

function declared(list: readonly Inapplicable[], c: ReadCase, act: Act): Inapplicable | undefined {
  return list.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
}

// ── the case on a Solana ledger ─────────────────────────────────────────────────────────────────────────────────

/** The case made on a Solana ledger for one act, read through the pairing's `status`. */
function arrange(id: PairingId, kind: "transfer" | "channel", coverage: "full" | "none", c: ReadCase, act: Act) {
  const stated = declared(declarations(kind, coverage), c, act);
  if (stated !== undefined) return { inapplicable: stated.stated };
  const entry = BINDINGS.find((e) => e.id === id)!;
  const status = (entry as unknown as { status: (r: SvmRef, rd: SvmReader, q: unknown) => Promise<SvmStatus> }).status;
  const f = c.facts;
  const value = f.value;
  const below: CaseMark = ([...f.seen.map((s) => s.mark), value?.mark, c.query.finality].find((m) => m !== undefined && m !== "final") ??
    "safe") as CaseMark;
  const consumedSeen = f.seen.some((s) => s.consumed);
  // A value consumed with no transaction of the payer's carrying the message is a durable nonce that moved.
  const nonce =
    value !== undefined &&
    ((!consumedSeen && (value.consumed || value.head?.consumed === true)) || f.seen.some((s) => s.consumed && s.party !== "payer"));
  // An act whose message differs from the one presented: the payment was presented as another transaction.
  const differs = f.seen.some((s) => s.presented === "no");
  const names = new Map<string, string>();
  const positions = new Map<string, unknown>();
  const landed = new Map<string, { landed: SvmLanded; final: boolean; slot: bigint }>();
  let presented: string | undefined;
  f.seen.forEach((s, i) => {
    const n = 10 + i;
    const sig = base58.encode(signature(n));
    names.set(sig, s.transaction);
    // At coverage `none` the opening the reference names carries no H, as the stock opening does not.
    const built = actOf(kind, s, n, { nonce: nonce && s.consumed, memo: coverage === "full" || s.carries });
    const index = (k: string) => built.keys.indexOf(k);
    const post = [
      { account: index(BUYER_TOKEN), mint: MINT, owner: BUYER },
      { account: index(PAYEE_TOKEN), mint: MINT, owner: PAYEE },
      { account: index(OTHER_TOKEN), mint: MINT, owner: OTHER },
    ].filter((b) => b.account >= 0);
    const slot = SLOT(s.position ?? 10);
    landed.set(sig, {
      landed: {
        wire: built.wire,
        err: s.result === "failed" ? { InstructionError: [0, "Custom"] } : null,
        ...(s.position === undefined ? {} : { slot }),
        loaded: { writable: [], readonly: [] },
        inner: [],
        post,
      },
      final: s.mark === "final",
      slot,
    });
    if (s.consumed && !nonce && !differs) presented ??= sig;
  });
  const listing: SvmSignature[] = [...landed.entries()].map(([sig, l]) => ({ signature: sig, slot: l.slot, memo: `[77] ${MEMO_TEXT}` }));
  // Items that do not decode, above the others in the case's order, each named; one that gives no position is listed
  // first of all, with no signature before it; and a plain signature above the rest.
  (f.undecoded ?? []).forEach((u, i) => {
    const sig = base58.encode(signature(u.at === undefined ? FIRST + i : 100 + i));
    const slot = u.at === undefined ? SLOT(80 - i) : SLOT(60 - i);
    names.set(sig, u.transaction);
    positions.set(sig, u.at);
    listing.push({ signature: sig, slot, memo: `[77] ${MEMO_TEXT}` });
    landed.set(sig, {
      landed: { wire: Uint8Array.of(0xff, 0xff), err: null, slot, loaded: { writable: [], readonly: [] }, inner: [] },
      final: true,
      slot,
    });
  });
  if (!f.search.whole) {
    const ghost = base58.encode(signature(GHOST));
    positions.set(ghost, f.search.at);
    listing.push({ signature: ghost, slot: SLOT(40), memo: `[77] ${MEMO_TEXT}` });
  }
  listing.push({ signature: base58.encode(signature(TOP)), slot: SLOT(70), memo: null });
  listing.sort((x, y) => (x.slot > y.slot ? -1 : x.slot < y.slot ? 1 : 0));
  // The reference: the presented message where the case reads a value, else a transaction alone.
  const presentedSig = base58.encode(signature(PRESENTED));
  const base = { network: NETWORK, payer: BUYER, payee: PAYEE, h: H, feePayer: FEE_PAYER } as const;
  let ref: SvmRef;
  if (coverage === "none") {
    // The lookup's transaction: the one the case names, else the item it could not decode, else one no lookup finds.
    const named = f.seen[0] !== undefined ? base58.encode(signature(10)) : f.undecoded?.[0] !== undefined ? [...names].find(([, n]) => n === f.undecoded![0]!.transaction)![0] : presentedSig;
    ref = { ...base, transaction: named, digest: "pending" as never, blockhash: BLOCKHASH };
    presented = landed.has(named) && f.seen[0] !== undefined ? named : undefined;
    if (presented === undefined) ref = { ...base, transaction: named, digest: `0x${"66".repeat(32)}`, blockhash: BLOCKHASH };
  } else if (value === undefined) {
    const own = f.seen.findIndex((s) => s.consumed);
    ref = { ...base, transaction: own >= 0 && !differs ? base58.encode(signature(10 + own)) : presentedSig };
  } else if (nonce) {
    ref = { ...base, digest: `0x${"77".repeat(32)}`, nonce: { account: NONCE_ACCOUNT, value: NONCE_VALUE } };
  } else if (presented !== undefined) {
    ref = { ...base, transaction: presented, digest: "pending" as never, blockhash: BLOCKHASH };
  } else {
    ref = { ...base, transaction: presentedSig, digest: `0x${"66".repeat(32)}`, blockhash: BLOCKHASH };
  }
  const finalSlot = value?.lapsed === true && value.mark === "final" ? 1200n : 1100n;
  const headSlot = value?.lapsed === true ? 1210n : 1120n;
  const after = c.query.after === undefined ? undefined : SLOT(c.query.after);
  const nonceAccount = (spent: boolean) => {
    const data = new Uint8Array(80);
    data.set([1, 0, 0, 0, 1, 0, 0, 0]);
    data.set(base58.decode(spent ? OTHER_BLOCKHASH : NONCE_VALUE), 40);
    return { owner: SYSTEM, data };
  };
  let bounded = false;
  let reader: SvmReader = {
    network: NETWORK,
    transaction: async (sig, commitment) => {
      const l = landed.get(sig);
      if (l === undefined || (commitment === "finalized" && !l.final)) {
        return { notFound: true, slot: commitment === "finalized" ? finalSlot : headSlot };
      }
      return l.landed;
    },
    signatures: async (address, page) => {
      if (address !== BUYER) return [];
      let list = listing;
      if (page.until !== undefined) list = list.slice(0, Math.max(0, list.findIndex((e) => e.signature === page.until)));
      if (page.before !== undefined) list = list.slice(list.findIndex((e) => e.signature === page.before) + 1);
      return list.slice(0, page.limit);
    },
    slot: async (commitment) => (commitment === "finalized" ? finalSlot : headSlot),
    // At `confirmed`, first, the answer of true that bounds the blockhash's slot; once bounded, its validity at the
    // commitment read: passed at `finalized` where the case's value lapsed at the final mark, at `confirmed` where it lapsed.
    blockhashValid: async (_blockhash, commitment) => {
      if (commitment === "confirmed" && !bounded) {
        bounded = true;
        return { valid: true, slot: 1000n };
      }
      const passed = value?.lapsed === true && (commitment === "confirmed" || value.mark === "final");
      return { valid: !passed, slot: commitment === "finalized" ? finalSlot : headSlot };
    },
    firstAvailableBlock: async () => (f.history ? 0n : (after ?? 0n) + 1n),
    account: async (_address, commitment) => ({
      slot: commitment === "finalized" ? finalSlot : headSlot,
      value: nonceAccount(commitment === "finalized" ? value?.consumed === true : value?.consumed === true || value?.head?.consumed === true),
    }),
  };
  if (f.unreadable === "transport") reader = { ...reader, firstAvailableBlock: async () => Promise.reject(new Error("timeout")) };
  if (f.unreadable === "unparseable") reader = { ...reader, firstAvailableBlock: async () => "0" as never };
  if (f.unreadable === "too-large") {
    reader = {
      ...reader,
      firstAvailableBlock: async () => Promise.reject(Object.assign(new Error("too large"), { name: "ReaderError", kind: "too-large" })),
    };
  }
  if (f.unreadable === "chain-mismatch") reader = { ...reader, network: OTHER_NETWORK };
  const others = (c.query.others ?? []).map((o) => {
    const t = (o as { transaction: string }).transaction;
    return { transaction: [...names].find(([, n]) => n === t)?.[0] ?? t };
  });
  // The one mark: every case's query asks for `final`, but the declared one below it.
  const query = {
    act,
    finality: "finalized",
    ...(after === undefined ? {} : { after }),
    ...(others.length === 0 ? {} : { others }),
  };
  return {
    run: async (): Promise<CaseAnswer> => {
      if (ref.digest === ("pending" as never)) {
        const tx = decodeSvmTx(landed.get(presented!)!.landed.wire);
        if ("refused" in tx) throw new Error(`fixture does not decode: ${tx.code}`);
        ref = { ...ref, digest: await svmDigest(tx) };
      }
      return back(c, await status(ref, reader, query), names, below, listing, positions);
    },
  };
}

/** The declarations of a pairing's form: by its coverage, and on a channel opening that carries H, the one transfer. */
function declarations(kind: "transfer" | "channel", coverage: "full" | "none"): readonly Inapplicable[] {
  return coverage === "none" ? NONE : kind === "channel" ? OPENING : FULL;
}

const form = (id: PairingId, kind: "transfer" | "channel", coverage: "full" | "none" = "full"): DeclaredForm => ({
  form: { subject: id, arrange: (c, act) => arrange(id, kind, coverage, c, act) },
  inapplicable: declarations(kind, coverage),
});

export const forms: readonly DeclaredForm[] = [
  form("x402/exact/solana", "transfer"),
  form("mpp/charge/solana", "transfer"),
  form("mpp/charge/solana/unsponsored", "transfer"),
  form("mpp/charge/usdc/solana", "transfer"),
  form("mpp/subscription/solana", "transfer"),
  form("x402/upto/solana", "channel"),
  form("x402/batch-settlement/solana", "channel"),
  form("mpp/session/solana/memo", "channel"),
  form("mpp/session/solana/stock", "channel", "none"),
];
