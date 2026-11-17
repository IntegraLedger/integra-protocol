// The read kit's form for x402/exact/polkadot/lcp-assets-remark: each case of read-status.json made on a ledger of
// constructed polkadot-rest-api answers (marked so: no recorded endpoint answers these cases), read through the
// pairing's own `polkadotStatus`, and the answer put back in the cases' terms. The extrinsics are SCALE by hand: a signed
// v4 extrinsic is its length, 0x84, `MultiAddress::Id` and the signer, an Ed25519 signature of zeros (the read verifies
// no signature), the era (period 4, phase 0), the compact nonce, a zero tip, no fee asset and the metadata-hash mode 0,
// then the call: the profile call, or `system.remark_with_event` of the remark alone for an act that names no account.
import { blake2b } from "@noble/hashes/blake2.js";
import { toLcpString, type AtrHash } from "../../../src/core.js";
import type { Act, Moved } from "../../../src/internal/read.js";
import {
  encodeProfileCall,
  extrinsicHash,
  polkadotStatus,
  ss58Decode,
  type PolkadotExtrinsic,
  type PolkadotReader,
  type PolkadotRef,
  type PolkadotStatus,
} from "../../../src/polkadot.js";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { answering, READ_STATUS } from "../harness.js";

const NETWORK = "polkadot:68d56f15f85d3136970ec16946040bc1" as const;
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as AtrHash;
const PAYEE_SS58 = "15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5";
const PAYEE = ss58Decode(PAYEE_SS58) as Uint8Array;
const PAYER = Uint8Array.from(Buffer.from("f0a9102f0c58b6b1616671d59b86bfe96ab7211ce9f3eec1a3f6b43e24cc957e", "hex"));
const OTHER = new Uint8Array(32).fill(0x22);
const ELSEWHERE = new Uint8Array(32).fill(0x11);
const REMARK = new TextEncoder().encode(toLcpString(H));
const NONCE = 5;
const ASSETS: Record<string, number> = { A: 1337, B: 1984 };

const hex = (b: Uint8Array): `0x${string}` => `0x${Buffer.from(b).toString("hex")}`;
const blockHash = (n: bigint): `0x${string}` => `0x${n.toString(16).padStart(64, "0")}`;
const compact = (n: number): number[] => (n < 64 ? [n << 2] : [((n << 2) | 1) & 0xff, n >> 6]);

function signed(signer: Uint8Array, nonce: number, call: Uint8Array): Uint8Array {
  const body = [0x84, 0x00, ...signer, 0x00, ...new Uint8Array(64), 0x01, 0x00, ...compact(nonce), 0x00, 0x00, 0x00, ...call];
  return Uint8Array.from([...compact(body.length), ...body]);
}

const remarkOnly = (): Uint8Array => Uint8Array.from([0x00, 0x07, ...compact(REMARK.length), ...REMARK]);
/** `assets.transfer_keep_alive(asset, Id(dest), amount)` alone: a call that carries no remark. */
const transferOnly = (asset: number, dest: Uint8Array, amount: number): Uint8Array =>
  Uint8Array.from([50, 9, ...compact(asset), 0x00, ...dest, ...compact(amount)]);

/**
 * The presented extrinsic where no act of the case is the one presented: the payer's, at the signed nonce, paying the
 * payee 99,999 of asset 1337, which no act of a case moves.
 */
const NOT_LANDED = signed(PAYER, NONCE, encodeProfileCall({ assetId: 1337, dest: PAYEE, amount: 99_999n, remark: REMARK }));
const refOf = (presented: Uint8Array): PolkadotRef => ({
  network: NETWORK,
  payee: PAYEE_SS58,
  signer: hex(PAYER),
  nonce: String(NONCE),
  era: { period: 4, phase: 0 },
  extrinsic: hex(presented),
});

type Item = { raw: Uint8Array; record: Omit<PolkadotExtrinsic, "at"> };
type Ledger = {
  blocks: Map<bigint, Item[]>;
  finalized: bigint;
  head: bigint;
  nonce: { finalized: bigint; head: bigint };
  valid?: bigint;
  missing?: bigint;
  fault?: "transport" | "unparseable" | "chain-mismatch";
};

function readerOf(l: Ledger): PolkadotReader {
  const heightOf = (b: `0x${string}` | bigint): bigint | undefined =>
    typeof b === "bigint" ? b : [...l.blocks.keys(), ...range(0n, l.head)].find((n) => blockHash(n) === b.toLowerCase());
  const at = async (): Promise<void> => {
    if (l.fault === "transport") throw new Error("transport");
  };
  return {
    network: l.fault === "chain-mismatch" ? "polkadot:67f9723393ef76214df0118c34bbbd3d" : NETWORK,
    extrinsic: async (b, index) => {
      await at();
      const n = heightOf(b);
      const item = n === undefined ? undefined : l.blocks.get(n)?.[index];
      return item === undefined || n === undefined ? null : { ...item.record, at: { height: n, hash: blockHash(n) } };
    },
    rawExtrinsics: async (b) => {
      await at();
      const n = heightOf(b);
      if (n === undefined || n > l.head || n === l.missing) return null;
      return (l.blocks.get(n) ?? []).map((i) => hex(i.raw));
    },
    finalizedHeight: async () => (await at(), (l.fault === "unparseable" ? "x" : l.finalized) as bigint),
    headHeight: async () => (await at(), l.head),
    accountNonce: async (_a, mark) => (await at(), mark === "finalized" ? l.nonce.finalized : l.nonce.head),
    validate: async () => (await at(), l.valid === undefined ? { valid: false, head: 0n } : { valid: true, head: l.valid }),
  };
}

function range(from: bigint, to: bigint): bigint[] {
  const out: bigint[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

/**
 * The extrinsic's events: each transfer of what moved as an `assets.Transferred`, at the index the case names as its
 * place where it names one (the indexes before it holding the fee's `balances.Withdraw`), then `Remarked` and
 * `ExtrinsicSuccess`; or `ExtrinsicFailed` alone.
 */
function eventsOf(signer: Uint8Array, ok: boolean, carries: boolean, moved: readonly Moved[]): PolkadotExtrinsic["events"] {
  if (!ok) return [{ pallet: "system", method: "ExtrinsicFailed", data: [] }];
  const events: PolkadotExtrinsic["events"][number][] = [];
  for (const m of moved.filter((v) => v.amount !== "0")) {
    const at = typeof m.place === "number" ? m.place : events.length;
    while (events.length < at) events.push({ pallet: "balances", method: "Withdraw", data: [hex(signer), "1"] });
    events.push({
      pallet: "assets",
      method: "Transferred",
      data: [String(ASSETS[m.asset] ?? 1337), hex(signer), hex(m.to === "payee" ? PAYEE : ELSEWHERE), m.amount],
    });
  }
  return [
    ...events,
    ...(carries ? [{ pallet: "system", method: "Remarked", data: [hex(signer), hex(blake2b(REMARK, { dkLen: 32 }))] }] : []),
    { pallet: "system", method: "ExtrinsicSuccess", data: [] },
  ];
}

type Made = {
  ledger: Ledger;
  /** The extrinsic the reference is built from. */
  presented: Uint8Array;
  names: Map<string, string>;
  hint?: string;
  after: bigint;
  lower: CaseMark;
  /** The case's search position for each block that holds an item the search cannot decode. */
  held: Map<bigint, number>;
};

/** The case on a Polkadot ledger, or why it cannot arise there. */
function make(c: ReadCase, act: Act): Made | { inapplicable: string } {
  const declared = DECLARED.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
  if (declared !== undefined) return { inapplicable: declared.stated };
  const f = c.facts;
  const marks = [...f.seen.map((s) => s.mark), ...(f.value ? [f.value.mark] : []), c.query.finality];
  const lower: CaseMark = marks.includes("safe") ? "safe" : "included";
  const after = BigInt(c.query.after ?? 1);
  const undecodedAt = (f.undecoded ?? []).map((u, i) => BigInt(u.at ?? 40 + i));
  const finals = [...f.seen.filter((s) => s.mark === "final").map((s) => BigInt(s.position!)), ...undecodedAt];
  const nonFinals = f.seen.filter((s) => s.mark !== "final").map((s) => BigInt(s.position!));
  let finalized = nonFinals.length > 0 ? nonFinals.reduce((a, b) => (a < b ? a : b)) - 1n : 20n;
  if (f.value?.lapsed && f.value.mark !== "final") finalized = 6n;
  for (const p of finals) if (p > finalized) finalized = p;
  const top = [finalized, ...finals, ...nonFinals].reduce((a, b) => (a > b ? a : b));
  const head = f.search.whole ? (f.value?.lapsed && f.value.mark !== "final" ? 8n : top + 1n) : 200n;

  const blocks = new Map<bigint, Item[]>();
  const names = new Map<string, string>();
  let hint: string | undefined;
  let x: (typeof f.seen)[number] | undefined;
  let later = NONCE + 1;
  let presented: Uint8Array | undefined;
  for (const s of f.seen) {
    const isX = s.consumed && x === undefined && s.party !== "payee";
    if (isX) x = s;
    const signer = s.party === "payee" ? PAYEE : isX || s.party === "payer" ? PAYER : OTHER;
    const nonce = isX ? NONCE : s.party === "payer" ? (s.consumed ? later++ : NONCE - 1) : 0;
    const moved: readonly Moved[] =
      s.moved ?? (s.account === "none" ? [] : [{ asset: "A", amount: "10000", to: s.account === "payee" ? "payee" : "elsewhere" }]);
    const first = moved[0];
    const call = !s.carries
      ? transferOnly(ASSETS[first?.asset ?? "A"] ?? 1337, first?.to === "elsewhere" ? ELSEWHERE : PAYEE, Number(first?.amount ?? 10_000))
      : first === undefined
        ? remarkOnly()
        : encodeProfileCall({
            assetId: ASSETS[first.asset] ?? 1337,
            dest: first.to === "payee" ? PAYEE : ELSEWHERE,
            amount: BigInt(first.amount),
            remark: REMARK,
          });
    const raw = signed(signer, nonce, call);
    if (signer === PAYER && s.presented === "yes") presented ??= raw;
    if (isX && s.presented !== "no") presented ??= raw;
    const ok = s.result === "succeeded";
    const n = BigInt(s.position!);
    const list = blocks.get(n) ?? [];
    names.set(`${blockHash(n)}-${list.length}`, s.transaction);
    if (n <= after) hint = `${blockHash(n)}-${list.length}`;
    list.push({ raw, record: { hash: extrinsicHash(raw), success: ok, events: eventsOf(signer, ok, s.carries, moved) } });
    blocks.set(n, list);
  }
  if (f.unreadable === "too-large") {
    blocks.set(3n, [{ raw: signed(PAYER, NONCE, new Uint8Array(4200)), record: { hash: "0x00", success: true, events: [] } }]);
  }
  const held = new Map<bigint, number>();
  (f.undecoded ?? []).forEach((u, i) => {
    // A v5 general extrinsic (version byte 0x45), which the unit does not decode and which could be the signer's.
    const raw = Uint8Array.from([...compact(3), 0x45, 0x00, 0x00]);
    const n = undecodedAt[i]!;
    const list = blocks.get(n) ?? [];
    names.set(`${blockHash(n)}-${list.length}`, u.transaction);
    if (u.at !== undefined) held.set(n, u.at);
    list.push({ raw, record: { hash: extrinsicHash(raw), success: true, events: [] } });
    blocks.set(n, list);
  });
  const consumed = f.value?.consumed ?? true;
  const xFinal = x === undefined || x.mark === "final";
  const nonce = {
    finalized: BigInt(consumed && xFinal ? NONCE + 3 : NONCE),
    head: BigInt((f.value?.head?.consumed ?? consumed) ? NONCE + 3 : NONCE),
  };
  const ledger: Ledger = {
    blocks,
    finalized,
    head,
    nonce,
    ...(f.value?.lapsed ? { valid: 4n } : {}),
    ...(f.history ? {} : { missing: finalized }),
    ...(f.unreadable === "transport" || f.unreadable === "unparseable" || f.unreadable === "chain-mismatch" ? { fault: f.unreadable } : {}),
  };
  return { ledger, presented: presented ?? NOT_LANDED, names, ...(hint === undefined ? {} : { hint }), after, lower, held };
}

function back(a: PolkadotStatus, m: Made, c: ReadCase): CaseAnswer {
  const name = (t: string): string => m.names.get(t) ?? t;
  const mark = (k: unknown): CaseMark => (k === "finalized" ? "final" : m.lower);
  const movedBack = (mv: readonly Moved[]): Moved[] =>
    mv.map((v) => ({
      asset: Object.keys(ASSETS).find((k) => v.asset === `assets:${ASSETS[k]}`) ?? v.asset,
      amount: v.amount,
      to: v.to === hex(PAYEE) ? "payee" : v.to === hex(ELSEWHERE) ? "elsewhere" : v.to,
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
  if ("search" in a && a.search !== undefined) out["search"] = m.held.get(a.search.next) ?? 42;
  // A search read whole keeps a position only to carry the head the chain's validation proved, which the next call
  // takes back; the case's terms hold no such head, and a case whose search was read whole gives no position.
  if (c.facts.search.whole && c.facts.search.at === undefined && (c.facts.undecoded ?? []).length === 0) delete out["search"];
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(name);
  return out as CaseAnswer;
}

/** Every case whose text opens with `words`, stated on both acts. */
function opening(words: string, stated: string): Inapplicable[] {
  const cases = READ_STATUS.cases.filter((c) => c.case.startsWith(words));
  if (cases.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return cases.map((c) => ({ case: c.case, stated }));
}

const ENTRY = "Declared inapplicable to the read kit: ";
const PROFILE = "; the profile x402-exact-polkadot-lcp-assets-remark.md, rule 8, Cases that cannot arise";
const NONCE_HELD =
  "*a read with no means to read the single-use value* and *a read that did not read the value at the latest head*, " +
  "since the read holds the account nonce and reads it at finalized and at the " +
  "latest head";
const PLACED =
  "*an act the read cannot place against the position given* (its three cases) and *an item the search could not decode " +
  "that gives no position*, since every extrinsic is read at its block's height";

/** The cases this read cannot meet, each by its reason or the opening words of its text, as the profile's rule 8 states them. */
const DECLARED: readonly Inapplicable[] = [
  ...answering(
    "not-found",
    ENTRY +
      "`not-found`, since the read holds the single-use value, the account nonce, which it reads at finalized" + PROFILE,
  ),
  ...opening(
    "an act of another pairing or kind carrying H",
    ENTRY +
      "*an act of another pairing or kind carrying H*, since the network has one pairing and every extrinsic of the signer " +
      "that carries the remark is its act wherever the remark sits, an agreement and a charge alike" + PROFILE,
  ),
  ...opening("an act the read cannot place against the position given", ENTRY + PLACED + PROFILE),
  ...opening("an item the search could not decode that gives no position", ENTRY + PLACED + PROFILE),
  ...opening(
    "the validity passed with the value unconsumed, read below the final mark",
    ENTRY + "*the validity passed with the value unconsumed, read below the final mark*, since the era's end is compared with finalized alone" + PROFILE,
  ),
  ...opening("a read with no means to read the single-use value", ENTRY + NONCE_HELD + PROFILE),
  ...opening("a read that did not read the value at the latest head", ENTRY + NONCE_HELD + PROFILE),
];

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/polkadot/lcp-assets-remark",
      arrange: (c: ReadCase, act: Act) => {
        const m = make(c, act);
        if ("inapplicable" in m) return m;
        return {
          run: async () => {
            const others = (c.query.others ?? []).map((o) =>
              "transaction" in o ? { transaction: [...m.names].find(([, v]) => v === o.transaction)?.[0] ?? o.transaction } : o,
            );
            const answer = await polkadotStatus({ ...refOf(m.presented), h: H, ...(m.hint === undefined ? {} : { transaction: m.hint }) }, readerOf(m.ledger), {
              act,
              finality: c.query.finality === "final" ? "finalized" : "head",
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
