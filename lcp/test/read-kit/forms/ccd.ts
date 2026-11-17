// The read kit's form for x402/exact/ccd: each case of read-status.json made on a constructed Concordium node and run
// through the pairing's own read, as it ships: the facts its search rests on not yet shown (the profile's rule 15), so
// the cases its gate holds are declared. The sender's signed sequence number is consumed by the item at it where the case
// reads the value consumed, or reads no value and names no act that consumed it (then by a plain transfer, so that the
// search runs); every other act of the sender's the case names, and each item it could not decode, sits at another of
// the sender's numbers, after the signed one where that is consumed and before it where not. An act under another
// account's signature, and the act at the signed number read below the final mark, is the item a hint names. Positions
// are block heights above a base, an item below the final mark sitting above the last finalized height; the search's
// positions, `{next}`, are mapped to the case's numbers.
import { createHash } from "node:crypto";
import { ccdMemo, ccdStatus, exactCcd, pltMemo, type CcdBlockItem, type CcdItem, type CcdReader, type CcdRef, type CcdTransfer } from "../../../src/ccd.js";
import type { AtrHash } from "../../../src/core.js";
import { accountText } from "../../../src/internal/ccd.js";
import { isRefusal } from "../../../src/refusal.js";
import type { PaymentRequirements } from "../../../src/x402.js";
import type { Act, Moved, Seen } from "../../../src/internal/read.js";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS } from "../harness.js";

const NETWORK = "ccd:4221332d34e1694168c2a0c0b3fd0f27" as const;
const MAINNET = "ccd:9dd9ca4d19e9393877d2c44b70f89acb" as const;
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as AtrHash;
const MEMO = ccdMemo(H);
const OTHER_MEMO = new Uint8Array([0x67, ...new TextEncoder().encode("another")]);
const sha = (label: string): Uint8Array<ArrayBuffer> => new Uint8Array(createHash("sha256").update(`read kit ${label}`).digest());
const hashOf = (name: string): string => createHash("sha256").update(`read kit item ${name}`).digest("hex");
const PAYER = sha("payer");
const PAYEE = sha("payee");
const STRANGER = sha("another signer");
const ELSEWHERE = [sha("another receiver 1"), sha("another receiver 2")];
const SPONSOR = sha("sponsor");
const BASE = 1000n;
const FINAL = BASE + 100n;
const EXPIRY = 1790000060n;
/** The last finalized block's own time, in milliseconds: before the signed expiry, and past it. */
const NOW = 1790000000000n;
const LATE = 1790000061000n;
/** The transaction-specific cost each signed header states, x402's `executionEnergyAmount`. */
const EXECUTION = 300;
/**
 * The energy in the header the sender signed, as a node gives it: 100 for each of the two signatures, the sender's and
 * the sponsor's, 1 for each byte of the 94-byte sponsored header and of the payload, and the transaction-specific cost
 * (`@concordium/web-sdk` 12.0.2, `getEnergyCost`; vectors/x402-exact-ccd.json, D3.signedEnergy).
 */
const energyOf = (payload: Uint8Array): bigint => 200n + 94n + BigInt(payload.length) + BigInt(EXECUTION);
const hexOf = (b: Uint8Array): string => Buffer.from(b).toString("hex");
/**
 * The x402 payment a payer presents for a payload of `transferWithMemo` (22) or `tokenUpdate` (27), in the wire form, with
 * the option it answers; `reference` takes it as it takes any payment, so the read is held to the reference it gives.
 */
function presentedOf(payload: Uint8Array, nonce: bigint): { payment: unknown; option: PaymentRequirements } {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let body: Record<string, unknown>;
  let asset = "CCD";
  if (payload[0] === 22) {
    const n = view.getUint16(33);
    body = { type: "transferWithMemo", toAddress: accountText(payload.subarray(1, 33)), memo: hexOf(payload.subarray(33, 35 + n)), amount: view.getBigUint64(35 + n).toString() };
  } else if (payload[0] === 27) {
    const idLength = payload[1]!;
    asset = new TextDecoder().decode(payload.subarray(2, 2 + idLength));
    body = { type: "tokenUpdate", tokenId: asset, operations: hexOf(payload.subarray(2 + idLength + 4)) };
  } else {
    throw new Error(`the form presents no payload of type ${payload[0]}`);
  }
  const option = {
    scheme: "exact",
    network: NETWORK,
    amount: "1",
    asset,
    payTo: accountText(PAYEE),
    maxTimeoutSeconds: 60,
    extra: { feePayer: accountText(SPONSOR) },
  } as PaymentRequirements;
  const header = {
    sender: accountText(PAYER),
    nonce: Number(nonce),
    expiry: Number(EXPIRY),
    executionEnergyAmount: EXECUTION,
    numSignatures: 1,
    sponsor: { account: accountText(SPONSOR), numSignatures: 1 },
  };
  const signedTransaction = { version: 1, signatures: { sender: { "0": { "0": "00".repeat(64) } } }, header, payload: body };
  return { payment: { x402Version: 2, accepted: option, payload: { signedTransaction } }, option };
}

// --- The cases this read cannot meet, as the profile's rule 16 states them: by a reason, every case whose answer on the
// act carries it; by the opening words of a case's text, every case that opens so; and the cases the search's gate
// holds while the facts its search rests on are not yet shown. Each case and act is stated once, under the first
// statement that takes it.
const RULE = "x402-exact-ccd.md, rule 16, cases this read cannot meet";
const HOLDS = "since the read holds the sequence number and reads the next number at the latest head";
const PLACED = "since every item is located at a block's height";

/** Every case whose expected answer on an act carries `reason`, on those acts. */
const byReason = (reason: string, why: string): Inapplicable[] =>
  READ_STATUS.cases.flatMap((c) => {
    const acts = ACTS.filter((a) => "reason" in c.expect[a] && c.expect[a].reason === reason);
    return acts.length === 0 ? [] : [{ case: c.case, acts, stated: `${RULE}: \`${reason}\`, ${why}` }];
  });
/** Every case whose text opens with `words`, on both acts; words that open no case throw. */
const byWords = (words: string, why: string): Inapplicable[] => {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words));
  if (found.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return found.map((c) => ({ case: c.case, stated: `${RULE}: *${words}*, ${why}` }));
};
/** The cases the search's gate holds: at coverage full, those whose answer on an act is one of the gated failures. */
const GATED = new Set(["instrument-unused", "instrument-consumed", "transaction-failed"]);
const gate = (why: string): Inapplicable[] =>
  READ_STATUS.cases.flatMap((c) => {
    if (c.coverage !== "full") return [];
    const acts = ACTS.filter((a) => c.expect[a].state === "failed" && "reason" in c.expect[a] && GATED.has(c.expect[a].reason));
    return acts.length === 0 ? [] : [{ case: c.case, acts, stated: `${RULE}: ${why}` }];
  });

/** The statements, the first that takes a case and act holding it. */
function once(statements: readonly Inapplicable[]): Inapplicable[] {
  const seen = new Set<string>();
  const out: Inapplicable[] = [];
  for (const d of statements) {
    const acts = (d.acts ?? ACTS).filter((a) => !seen.has(`${d.case}\u0000${a}`));
    for (const a of acts) seen.add(`${d.case}\u0000${a}`);
    if (acts.length > 0) out.push(acts.length === ACTS.length ? { case: d.case, stated: d.stated } : { ...d, acts });
  }
  return out;
}

const inapplicable: Inapplicable[] = once([
  ...byReason(
    "not-found",
    "since the read holds the single-use value, the sender's sequence number, and answers one not passed `pending`, " +
      "`instrument-live`, and one passed whose item is not located `pending`, `search-incomplete`",
  ),
  ...byWords(
    "an act read at the finality asked for, below the final mark",
    "since a seller names `finalized` alone, the search's latest head above it being no mark",
  ),
  ...byWords("a read with no means to read the single-use value", HOLDS),
  ...byWords("a read that did not read the value at the latest head", HOLDS),
  ...byWords(
    "a value read consumed whose transaction the search has not found",
    "since the search locates the item behind every number the account consumed after the position, so one not located " +
      "leaves the search with range left, held at that number, and a search read whole has found the transaction",
  ),
  ...byWords(
    "the validity passed with the value unconsumed, read below the final mark",
    "since the `expiry` is compared with a finalized block's own timestamp alone",
  ),
  ...byWords("an act the read cannot place against the position given", PLACED),
  ...byWords("an item the search could not decode that gives no position", PLACED),
  ...gate(
    "while the search proves no absence (rule 15), the cases its gate holds: its failed answers but before-position, " +
      "which the read answers pending, search-incomplete",
  ),
]);
const declared = (c: ReadCase, act: Act): Inapplicable | undefined =>
  inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));

// --- Payloads in the protocol's binary form (`concordium-base` `Execution.hs:776-780`, `:829-832`), as the profile's
// rule 11 reads them.
const be = (n: bigint, bytes: number): number[] => Array.from({ length: bytes }, (_, i) => Number((n >> BigInt(8 * (bytes - 1 - i))) & 0xffn));
const text = (s: string): number[] => [0x60 + s.length, ...new TextEncoder().encode(s)];
/** `transferWithMemo` (22): the receiver, the memo with a 2-byte length, the amount as 8 bytes. */
const p22 = (to: Uint8Array, memo: Uint8Array, amount: bigint): Uint8Array =>
  new Uint8Array([22, ...to, ...be(BigInt(memo.length), 2), ...memo, ...be(amount, 8)]);
/** `transferWithScheduleAndMemo` (24): another kind of act, whose memo the read reads. */
const p24 = (to: Uint8Array, memo: Uint8Array): Uint8Array =>
  new Uint8Array([24, ...to, ...be(BigInt(memo.length), 2), ...memo, 1, ...be(EXPIRY * 1000n, 8), ...be(1n, 8)]);
/** `transfer` (3): a plain CCD transfer, no memo. */
const p3 = (to: Uint8Array, amount: bigint): Uint8Array => new Uint8Array([3, ...to, ...be(amount, 8)]);
/**
 * `tokenUpdate` (27): the token id and one `transfer` operation in the steward's CBOR (vectors/x402-exact-ccd.json, D3's
 * token payment, its recipient replaced): the memo H's PLT memo, an amount, the recipient's account.
 */
const p27 = (token: string, to: Uint8Array): Uint8Array => {
  const op = [
    0xa1, ...text("transfer"), 0xa3,
    ...text("memo"), ...pltMemo(H),
    ...text("amount"), 0xc4, 0x82, 0x25, 0x1a, 0x00, 0x4c, 0x4b, 0x40,
    ...text("recipient"), 0xd9, 0x9d, 0x73, 0xa2, 0x01, 0xd9, 0x9d, 0x71, 0xa1, 0x01, 0x19, 0x03, 0x97, 0x03, 0x58, 0x20, ...to,
  ];
  const ops = [0x81, ...op];
  return new Uint8Array([27, token.length, ...new TextEncoder().encode(token), ...be(BigInt(ops.length), 4), ...ops]);
};

type CaseSeen = Seen<number, CaseMark>;
/** One item of the constructed node: an item of the sender's at a height and number, or one under another signature. */
interface NodeItem {
  hash: string;
  height: bigint;
  nonce: bigint;
  sender: Uint8Array;
  payload: Uint8Array;
  outcome: { success: boolean; transfers: CcdTransfer[] };
  undecoded?: true;
  hidden?: true;
}

/** The case's ledger: the node, the reader over it, the reference and query, and the maps back to the case's names. */
function arrange(c: ReadCase, act: Act): { run: () => Promise<CaseAnswer> } {
  const f = c.facts;
  const toName = new Map<string, string>();
  const id = (name: string): string => {
    toName.set(hashOf(name), name);
    return hashOf(name);
  };
  const receivers = new Map<string, Uint8Array>([["payee", PAYEE]]);
  const receiverOf = (to: string): Uint8Array => {
    if (!receivers.has(to)) receivers.set(to, ELSEWHERE[receivers.size - 1]!);
    return receivers.get(to)!;
  };
  const accountOf = (s: CaseSeen): Uint8Array =>
    s.account === "payee" ? PAYEE : s.moved?.[0] !== undefined ? receiverOf(s.moved[0].to) : ELSEWHERE[0]!;
  // An asset of the case is CCD where it is the first, `A`, and otherwise a token whose id is `T` and its name.
  const tokenOf = (asset: string): string | undefined => (asset === "A" ? undefined : `T${asset}`);
  const places = new Map<string, number | string>();
  const transfersOf = (s: CaseSeen): CcdTransfer[] => {
    const moved = s.moved ?? [{ asset: "A", amount: "1", to: s.account === "payee" ? "payee" : "elsewhere" }];
    return moved.map((m, i) => {
      if (m.place !== undefined) places.set(`${id(s.transaction)}\u0000${i}`, m.place);
      const token = tokenOf(m.asset);
      const memo = !s.carries ? null : token === undefined ? MEMO : pltMemo(H);
      return {
        kind: token === undefined ? ("ccd" as const) : ("plt" as const),
        ...(token === undefined ? {} : { tokenId: token, decimals: 6 }),
        receiver: s.account === "payee" && i === 0 ? PAYEE : receiverOf(m.to),
        amount: BigInt(m.amount),
        memo,
      };
    });
  };
  // What the sender signed for an act the case names: one transfer whose memo is H (of its first asset), an act of
  // another kind (a scheduled transfer whose memo is H), or a transfer whose memo is not H.
  const payloadOf = (s: CaseSeen): Uint8Array => {
    const first = s.moved?.[0];
    const to = accountOf(s);
    if (s.kind === "other") return s.carries ? p24(to, MEMO) : p3(to, 1n);
    if (!s.carries) return p22(to, OTHER_MEMO, BigInt(first?.amount ?? "1"));
    const token = first === undefined ? undefined : tokenOf(first.asset);
    return token === undefined ? p22(to, MEMO, BigInt(first?.amount ?? "1")) : p27(token, to);
  };
  const heights = new Map<bigint, number>();
  const atHeight = (p: number, above: boolean): bigint => {
    const h = (above ? FINAL : BASE) + BigInt(p);
    heights.set(h, p);
    return h;
  };
  const itemOf = (s: CaseSeen, nonce: bigint, height: bigint): NodeItem => ({
    hash: id(s.transaction),
    height,
    nonce,
    sender: PAYER,
    payload: payloadOf(s),
    outcome: s.result === "succeeded" ? { success: true, transfers: transfersOf(s) } : { success: false, transfers: [] },
  });

  // The item at the signed number, the act read through the hint, and the sender's other items.
  const atN = f.seen.find((s) => s.consumed);
  const hinted = f.seen.filter((s) => (s.party !== "payer" && !s.consumed) || (s === atN && s.mark !== "final"));
  if (hinted.length > 1) throw new Error("the form gives one hint");
  const others = f.seen.filter((s) => s !== atN && !hinted.includes(s) && s.position !== undefined);
  const consumedFinal = atN !== undefined ? atN.mark === "final" : (f.value?.consumed ?? true);
  const consumedHead = f.value?.head?.consumed ?? (consumedFinal || atN !== undefined);
  const lapsed = f.value?.lapsed ?? false;

  // Numbers: the sender's other items after the signed one where it is consumed, before it where not.
  const undecoded = f.undecoded ?? [];
  const after = consumedFinal || consumedHead;
  const nonce = after ? 1n : BigInt(others.length + undecoded.length + 1);
  let next = after ? 2n : 1n;
  const items: NodeItem[] = [];
  const cursors = new Map<bigint, number>();
  const fillerAt = BigInt((c.query.after ?? 0) + 1);
  if (consumedFinal || consumedHead) {
    if (atN !== undefined) {
      items.push(itemOf(atN, nonce, atHeight(atN.position ?? 10, atN.mark !== "final")));
    } else {
      // A value read consumed with no act named: a plain transfer of the sender's consumed it, or, where the case reads
      // it consumed and states that the search has not found its transaction, an item located at no block's items.
      const hidden = f.seen.length === 0 && undecoded.length === 0 && f.value?.consumed === true;
      items.push({
        hash: id("the plain transfer at the signed number"),
        height: consumedFinal ? BASE + fillerAt : FINAL + 5n,
        nonce,
        sender: PAYER,
        payload: p3(ELSEWHERE[1]!, 5n),
        outcome: { success: true, transfers: [{ kind: "ccd", receiver: ELSEWHERE[1]!, amount: 5n, memo: null }] },
        ...(hidden ? { hidden: true as const } : {}),
      });
    }
  }
  for (const s of [...others].sort((a, b) => a.position! - b.position!)) {
    items.push(itemOf(s, next, atHeight(s.position!, s.mark !== "final")));
    next++;
  }
  undecoded.forEach((u, i) => {
    if (u.at !== undefined) cursors.set(next, u.at as number);
    items.push({ hash: id(u.transaction), height: BASE + 50n + BigInt(i), nonce: next, sender: PAYER, payload: new Uint8Array(), outcome: { success: true, transfers: [] }, undecoded: true });
    next++;
  });
  const nHead = items.reduce((m, i) => (i.nonce >= m ? i.nonce + 1n : m), 1n);
  if (f.search.at !== undefined) cursors.set(nHead, f.search.at as number);

  // The hint: an act under another account's signature, or the act at the signed number read below the final mark.
  let hint: (CcdItem & { hash: string }) | undefined;
  const h = hinted[0];
  if (h !== undefined) {
    const above = h.mark !== "final";
    hint = {
      hash: id(h.transaction),
      state: above ? "committed" : "finalized",
      success: h.result === "succeeded",
      sender: h.party === "payee" ? PAYEE : h.party === "other" ? STRANGER : PAYER,
      transfers: h.result === "succeeded" ? transfersOf(h) : [],
      height: h === atN ? items[0]!.height : atHeight(h.position ?? 10, above),
      nonce: h === atN ? nonce : 1n,
    };
  }

  // Where the read runs no search, the case's search position is the one an earlier answer gave.
  const settlesAtN =
    atN !== undefined &&
    atN.mark === "final" &&
    atN.result === "succeeded" &&
    atN.carries &&
    atN.kind === "same" &&
    (act === "agreement" || atN.account === "payee") &&
    !(c.query.others ?? []).some((o) => "transaction" in o && o.transaction === atN.transaction);
  const before = atN !== undefined && c.query.after !== undefined && atN.position !== undefined && atN.position <= c.query.after;
  const searches = (consumedFinal && !settlesAtN && !before) || (!consumedFinal && lapsed && !consumedHead);
  const held = (undecoded[0]?.at ?? f.search.at) as number | undefined;
  const given = !searches && held !== undefined ? { next: nHead } : undefined;
  if (given !== undefined) cursors.set(nHead, held!);

  const missing = f.history === false ? FINAL : undefined;
  const reader: CcdReader = {
    network: f.unreadable === "chain-mismatch" ? MAINNET : NETWORK,
    lastFinal: async () => {
      if (f.unreadable === "transport") throw new Error("transport");
      if (f.unreadable === "too-large" || f.unreadable === "unparseable") {
        throw Object.assign(new Error(f.unreadable), { name: "ReaderError", kind: f.unreadable === "too-large" ? "too-large" : "malformed" });
      }
      return FINAL;
    },
    block: async (height) => (height >= 0n && height <= FINAL && height !== missing ? { slotTime: height === FINAL ? (lapsed ? LATE : NOW) : 0n } : null),
    nextNonce: async (account, at) => {
      // The node holds the sender's numbers alone: a read that asks another account's is answered with an error.
      if (account !== accountText(PAYER)) throw new Error(`the read asked the numbers of ${account}, not the sender's`);
      if (at !== "best" && (at < 0n || at > FINAL || at === missing)) return null;
      const used = items.filter((i) => at === "best" || i.height <= at).map((i) => i.nonce);
      return used.reduce((m, n) => (n >= m ? n + 1n : m), 1n);
    },
    items: async (height): Promise<CcdBlockItem[]> =>
      items
        .filter((i) => i.height === height && i.hidden !== true)
        .map((i) =>
          i.undecoded
            ? { hash: i.hash, undecoded: true as const }
            : { hash: i.hash, sender: i.sender, nonce: i.nonce, expiry: EXPIRY, energy: energyOf(i.payload), sponsor: SPONSOR, payload: i.payload },
        ),
    item: async (hash) => {
      if (hint !== undefined && hint.hash === hash) return hint;
      const i = items.find((x) => x.hash === hash && x.undecoded !== true);
      return i === undefined ? null : { state: i.height <= FINAL ? "finalized" : "committed", sender: i.sender, ...i.outcome };
    },
  };

  const back = (a: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...a };
    const name = typeof a["transaction"] === "string" ? (toName.get(a["transaction"]) ?? a["transaction"]) : undefined;
    if (name !== undefined) out["transaction"] = name;
    if (typeof a["position"] === "bigint") out["position"] = heights.get(a["position"]) ?? Number(a["position"] - BASE);
    if (a["finality"] === "finalized") out["finality"] = "final";
    if (a["finality"] === "committed") out["finality"] = f.seen.find((s) => s.transaction === name)?.mark ?? "included";
    if (Array.isArray(a["moved"])) {
      out["moved"] = (a["moved"] as Moved[]).map((m) => ({
        asset: m.asset === "CCD" ? "A" : m.asset.replace(/^T/, ""),
        amount: m.amount,
        to: [...receivers].find(([, b]) => accountText(b) === m.to)?.[0] ?? m.to,
        ...(m.transaction === undefined ? {} : { transaction: toName.get(m.transaction) ?? m.transaction }),
        ...(m.place === undefined ? {} : { place: places.get(`${m.transaction}\u0000${m.place}`) ?? m.place }),
      }));
    }
    if (a["search"] !== undefined) {
      const at = (a["search"] as { next: bigint }).next;
      out["search"] = cursors.get(at) ?? a["search"];
    }
    if (Array.isArray(a["undecoded"])) out["undecoded"] = (a["undecoded"] as string[]).map((t) => toName.get(t) ?? t);
    if (Array.isArray(a["foreign"])) out["foreign"] = (a["foreign"] as Record<string, unknown>[]).map((i) => back(i));
    return out;
  };

  return {
    run: async () => {
      // What was presented: the act at the signed number where the case states it is, and otherwise a payment no item holds.
      const presented = presentedOf(atN !== undefined && atN.presented === "yes" ? items[0]!.payload : p22(PAYEE, MEMO, 999n), nonce);
      const referenced = await exactCcd.reference(presented.payment, presented.option);
      if (isRefusal(referenced)) throw new Error(`reference refuses the payment the case presents: ${referenced.code}`);
      const ref: CcdRef = { ...referenced, ...(hint === undefined ? {} : { transaction: hint.hash }) };
      const query = {
        act,
        finality: "finalized" as const,
        ...(c.query.after === undefined ? {} : { after: BASE + BigInt(c.query.after) }),
        ...(given === undefined ? {} : { search: given }),
        ...(c.query.others === undefined
          ? {}
          : { others: c.query.others.map((o) => ("transaction" in o ? { transaction: id(o.transaction) } : o)) }),
      };
      return back((await ccdStatus(ref, reader, query as never)) as unknown as Record<string, unknown>) as unknown as CaseAnswer;
    },
  };
}

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/ccd",
      arrange: (c, act) => {
        const stated = declared(c, act);
        return stated !== undefined ? { inapplicable: stated.stated } : arrange(c, act);
      },
    },
    inapplicable,
  },
];
