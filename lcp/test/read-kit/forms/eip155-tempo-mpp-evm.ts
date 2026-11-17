// The read kit's forms of the MPP charges on EVM chains: `mpp/charge/evm/authorization`, `mpp/charge/usdc/evm`,
// `…/transaction` and `…/hash`, and of `mpp/session/evm`'s opening, whose opening another account funded is met in a
// batch beside a deposit of the payer's (`sessionTx`); each case of read-status.json arranged on a constructed ledger (eip155-tempo-mpp-ledger.ts)
// and run through the pairing's own `status`. A case's transactions are placed at its positions as block numbers and at
// its marks by the three heads; each act of the payer is a use of the reference's nonce, on the asset where it consumes
// the value and on another token, whose authorization the payer signed in that token's domain, where it does not; a
// transaction another account signed is that account's cancellation of the nonce on the asset; an item the search
// cannot decode is a use on another token whose call is not in the input; the value is answered as the case reads it.
// On Permit2, an act of the payer that consumed nothing is a permit under another nonce carrying the presented witness.
// The answer is put back in the case's terms: transaction names, block numbers as integers, marks, and a search
// position left at the page bound as the case's.
//
// Each form skips only the cases its pairing's profile states cannot arise (mpp-charge.md rule 15,
// mpp-session-evm-tempo.md rule 8), each with the reason the read cannot meet it. The EIP-3009 and Permit2 reads always
// hold their single-use value and read it at the final mark and at the latest head, so the case of a read with no
// value that never answers failed, and that of one that did not read it at the latest head, cannot arise on them. A case of the value's read whose facts give no value and whose search is not read whole is arranged with the
// value lapsed and unconsumed at both heads, a state the search alone holds at search-incomplete.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  addressWord,
  bytes32Word,
  bytesOf,
  concat,
  hexOf,
  keccak,
  keccakHex,
  uintWord,
  type Hex,
} from "../../../src/evm-abi.js";
import { AUTHORIZATION_USED_TOPIC, ReaderError, TRANSFER_TOPIC, TRANSFER_WITH_AUTHORIZATION_TYPEHASH, type EvmLog } from "../../../src/evm.js";
import { evmAuthorization, evmHash, evmPermit2, evmTransaction, chargeUsdcEvm, sessionEvm } from "../../../src/mpp.js";
import {
  AUTHORIZATION_CANCELED_TOPIC,
  OPEN_WITH_AUTHORIZATION_SELECTOR,
  OPEN_WITH_PERMIT2_SELECTOR,
  type MppSessionOpeningRef,
  PERMIT2_WITNESS_SELECTORS,
  UNORDERED_NONCE_INVALIDATION_TOPIC,
  type MppEip3009Ref,
  type MppNamedRef,
  type MppPermit2Ref,
} from "../../../src/internal/mpp-evm-read.js";
import type { Act, StatusAnswer } from "../../../src/internal/read.js";
import { CASE_MARK_OF, ledgerReader, txHashOf, txNameOf, type LedgerSpec, type LedgerTx } from "../../eip155-tempo-mpp-ledger.js";
import type { CaseAnswer, CaseMark, CaseSeen, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS, answering } from "../harness.js";

const NETWORK = "eip155:84532" as const;
const CHAIN = 84532n;
/** Anvil's published development key #0 and its account, the payer. */
const PAYER_KEY = bytesOf("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")!;
const PAYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Hex;
const PAYEE = "0x209693bc6afc0c5328ba36faf03c514ef312287c" as Hex;
const ELSEWHERE = "0x8888888888888888888888888888888888888888" as Hex;
const STRANGER = "0x7777777777777777777777777777777777777777" as Hex;
const SETTLER = "0x5555555555555555555555555555555555555555" as Hex;
/** The asset, the challenge's `currency`; the case's asset `A`. */
const CURRENCY = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex;
/** Another EIP-3009 token, the case's asset `B`, whose domain is `Token`, version `1`. */
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
/** A contract whose `AuthorizationUsed` the read cannot verify: no call in the input. */
const UNDECODED = "0xdddddddddddddddddddddddddddddddddddddddd" as Hex;
const NONCE = keccakHex("the reference's nonce");
const PAGE_END = 80_000n;

const word = (v: bigint): Hex => hexOf(uintWord(v));
const topic = (a: Hex): Hex => hexOf(addressWord(a));
const assetOf: Readonly<Record<string, Hex>> = { A: CURRENCY, B: OTHER };
const nameOfAsset = (a: string): string => (a.toLowerCase() === OTHER ? "B" : a.toLowerCase() === CURRENCY ? "A" : a);
const nameOfAccount = (a: string): string => (a.toLowerCase() === PAYEE ? "payee" : a.toLowerCase() === ELSEWHERE ? "elsewhere" : a);
const timeOf = (b: bigint): bigint => 1000n + 12n * b;

/** An ABI `string` answer. */
function abiString(s: string): Hex {
  const b = new TextEncoder().encode(s);
  const padded = new Uint8Array(Math.ceil(b.length / 32) * 32);
  padded.set(b);
  return hexOf(concat([uintWord(32n), uintWord(BigInt(b.length)), padded]));
}

/** `transferWithAuthorization`'s call, signed by the payer in the domain of `token` (name `Token`, version `1`). */
function signedCall(token: Hex, to: Hex, value: bigint, validBefore: bigint): Hex {
  const domain = keccak(
    concat([
      keccak("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
      keccak("Token"),
      keccak("1"),
      uintWord(CHAIN),
      addressWord(token),
    ]),
  );
  const struct = keccak(
    concat([
      bytesOf(TRANSFER_WITH_AUTHORIZATION_TYPEHASH)!,
      addressWord(PAYER),
      addressWord(to),
      uintWord(value),
      uintWord(0n),
      uintWord(validBefore),
      bytes32Word(NONCE),
    ]),
  );
  const sig = secp256k1.sign(keccak(concat([new Uint8Array([0x19, 0x01]), domain, struct])), PAYER_KEY, {
    prehash: false,
    format: "recovered",
  });
  const r = sig.subarray(1, 33);
  const s = sig.subarray(33, 65);
  return hexOf(
    concat([
      bytesOf("0xe3ee160e")!,
      addressWord(PAYER),
      addressWord(to),
      uintWord(value),
      uintWord(0n),
      uintWord(validBefore),
      bytes32Word(NONCE),
      uintWord(27n + BigInt(sig[0]!)),
      r,
      s,
    ]),
  );
}

/** The heads a case is arranged under, the first block its search reads, and the deadline its value lapses at. */
interface Plan {
  readonly heads: { latest: bigint; safe: bigint; finalized: bigint };
  readonly start: bigint;
  readonly validBefore: bigint;
}

function planOf(c: ReadCase): Plan {
  const seen = c.facts.seen.filter((s) => s.position !== undefined);
  const at = (m: CaseMark) => seen.filter((s) => s.mark === m).map((s) => BigInt(s.position!));
  const max = (xs: bigint[]) => xs.reduce((a, b) => (a > b ? a : b));
  const min = (xs: bigint[]) => xs.reduce((a, b) => (a < b ? a : b));
  const fin = at("final");
  const above = [...at("safe"), ...at("included")];
  const finalized = fin.length > 0 ? max(fin) + 1n : above.length > 0 ? min(above) - 1n : 50n;
  const safe = at("safe").length > 0 ? max(at("safe")) : at("included").length > 0 ? min(at("included")) - 1n : finalized + 10n;
  const start = c.query.after !== undefined ? BigInt(c.query.after) + 1n : 0n;
  const all = [...seen.map((s) => BigInt(s.position!)), ...(c.facts.undecoded ?? []).flatMap((u) => (u.at === undefined ? [] : [BigInt(u.at)])), safe];
  const latest = c.facts.search.whole ? max(all) + 10n : start + PAGE_END + 10n;
  const v = c.facts.value;
  const validBefore = lapsedForSearch(c)
    ? timeOf(finalized)
    : v === undefined || !v.lapsed
      ? timeOf(latest) + 1000n
      : v.mark === "final"
        ? timeOf(finalized)
        : v.mark === "safe"
          ? timeOf(finalized) + 1n
          : timeOf(safe) + 1n;
  return { heads: { latest, safe: safe < finalized ? finalized : safe, finalized }, start, validBefore };
}

/** Whether a case is one of the value's read (read-status rules 22 and 23). */
function valueRule(c: ReadCase): boolean {
  const rules = new Set(c.rules.match(/[0-9]+/g) ?? []);
  return rules.has("22") || rules.has("23");
}

/** A case of the value's read whose facts give no value and whose search has range left: its value is made lapsed. */
function lapsedForSearch(c: ReadCase): boolean {
  return valueRule(c) && c.facts.value === undefined && !c.facts.search.whole;
}

/** The value as the ledger answers it at the final mark and at the latest head. */
function valueOf(c: ReadCase): { final: boolean; head: boolean } {
  const v = c.facts.value;
  const unplaced = c.facts.seen.some((s) => s.position === undefined);
  if (lapsedForSearch(c)) return { final: false, head: false };
  if (v === undefined) return { final: false, head: true };
  return { final: v.consumed, head: unplaced ? true : (v.head?.consumed ?? (v.consumed || !v.lapsed)) };
}

/** The faults a case's unreadable reason, or a history not shown, is arranged by. */
function faultOf(c: ReadCase): LedgerSpec["fault"] {
  switch (c.facts.unreadable) {
    case "transport":
      return { method: "block", error: new ReaderError("transport") };
    case "too-large":
      return { method: "block", error: new ReaderError("too-large") };
    case undefined:
      return c.facts.history ? undefined : { method: "logs", error: new ReaderError("history") };
    default:
      return undefined;
  }
}

/** A case's answer, put back in its terms. */
function caseAnswer(a: StatusAnswer<bigint, "latest" | "safe" | "finalized">, plan: Plan, c: ReadCase): CaseAnswer {
  const moved = (m: readonly { asset: string; amount: string; to: string; transaction?: string; place?: number | string }[]) =>
    m.map((x) => ({
      ...x,
      asset: nameOfAsset(x.asset),
      to: nameOfAccount(x.to),
      ...(x.transaction === undefined ? {} : { transaction: txNameOf(x.transaction) }),
    }));
  const out: Record<string, unknown> = { ...a };
  if ("transaction" in a && a.transaction !== undefined) out["transaction"] = txNameOf(a.transaction);
  if ("position" in a && a.position !== undefined) out["position"] = Number(a.position);
  if ("finality" in a && a.finality !== undefined) out["finality"] = CASE_MARK_OF[a.finality];
  if ("moved" in a && a.moved !== undefined) out["moved"] = moved(a.moved);
  if ("search" in a && a.search !== undefined) {
    out["search"] = a.search === plan.start + PAGE_END ? c.facts.search.at : Number(a.search);
  }
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(txNameOf);
  out["foreign"] = a.foreign.map((f) => ({
    ...f,
    transaction: txNameOf(f.transaction),
    ...(f.position === undefined ? {} : { position: Number(f.position) }),
    ...(f.moved === undefined ? {} : { moved: moved(f.moved) }),
  }));
  return out as unknown as CaseAnswer;
}

/** The query of a case on this ledger: its block numbers, and the other acts it gives by their hashes. */
function queryOf(c: ReadCase, act: Act) {
  return {
    act,
    finality: ({ included: "latest", safe: "safe", final: "finalized" } as const)[c.query.finality],
    ...(c.query.after === undefined ? {} : { after: BigInt(c.query.after) }),
    ...(c.query.search === undefined ? {} : { search: BigInt(c.query.search) }),
    ...(c.query.others === undefined
      ? {}
      : { others: c.query.others.map((o) => ("transaction" in o ? { transaction: txHashOf(o.transaction) } : o)) }),
  };
}

// ── EIP-3009.

/**
 * The reference of a case: the payment presented is the act the case states `presented: yes` for, and otherwise moves
 * a value no case's transfer moves, so that a settled act reads `presented: no`. It names no transaction: an act at or
 * before the position given is found by the read's own lookup below that position.
 */
function eip3009Ref(c: ReadCase, plan: Plan): MppEip3009Ref {
  const yes = c.facts.seen.find((s) => s.presented === "yes");
  const moved = yes?.moved?.[0];
  return {
    network: NETWORK,
    payee: PAYEE,
    payer: PAYER,
    authorization: { at: CURRENCY, nonce: NONCE, deadline: plan.validBefore.toString() },
    presented: {
      token: moved === undefined ? CURRENCY : assetOf[moved.asset]!,
      from: PAYER,
      to: PAYEE,
      value: yes === undefined ? "1000000" : (moved?.amount ?? "1"),
      nonce: NONCE,
    },
  };
}

/** One seen item of a case as a transaction of the EIP-3009 ledger, or none where it cannot be placed. */
function eip3009Tx(s: CaseSeen, c: ReadCase, plan: Plan): LedgerTx | undefined {
  if (s.position === undefined) return undefined;
  const hash = txHashOf(s.transaction);
  const block = BigInt(s.position);
  if (s.result === "failed") return { hash, block, status: 0, from: SETTLER, to: CURRENCY, input: "0x", logs: [] };
  // Another account's transaction consumes the payer's nonce only as the payer's own cancellation, which it carries.
  const consumerByOther = s.consumed && s.party !== "payer";
  const by = consumerByOther ? PAYER : s.party === "payee" ? PAYEE : s.party === "other" ? STRANGER : PAYER;
  if (s.kind === "other" || consumerByOther || by !== PAYER) {
    const canceled: EvmLog = { address: CURRENCY, topics: [AUTHORIZATION_CANCELED_TOPIC, topic(by), NONCE], data: "0x" };
    return { hash, block, status: 1, from: by, to: CURRENCY, input: "0x", logs: [canceled] };
  }
  // The consumer found after an act the read cannot place: a use that does not consume the asset's value.
  const consumes = s.consumed && !c.facts.seen.some((x) => x.position === undefined);
  const named = s.moved?.[0];
  const token = named !== undefined ? assetOf[named.asset]! : consumes ? CURRENCY : OTHER;
  const to = s.account === "payee" ? PAYEE : ELSEWHERE;
  const value = BigInt(named?.amount ?? "1");
  const used: EvmLog = { address: token, topics: [AUTHORIZATION_USED_TOPIC, topic(PAYER), NONCE], data: "0x" };
  const paid: EvmLog = { address: token, topics: [TRANSFER_TOPIC, topic(PAYER), topic(to)], data: word(value) };
  const logs = s.account === "none" ? [used] : [used, paid];
  const input = token === CURRENCY ? "0x" : signedCall(token, to, value, plan.validBefore);
  return { hash, block, status: 1, from: SETTLER, to: token, input: input as Hex, logs };
}

/** The block of the case's consumer at or before the position it gives, from which the value reads consumed. */
function belowConsumer(c: ReadCase): bigint | undefined {
  const after = c.query.after;
  if (after === undefined) return undefined;
  const at = c.facts.seen.filter((s) => s.position !== undefined && s.position <= after && s.result === "succeeded" && s.consumed);
  return at.length === 0 ? undefined : at.map((s) => BigInt(s.position!)).reduce((a, b) => (a < b ? a : b));
}

function eip3009Ledger(c: ReadCase, plan: Plan): LedgerSpec {
  const txs = c.facts.seen.flatMap((s) => eip3009Tx(s, c, plan) ?? []);
  for (const u of c.facts.undecoded ?? []) {
    if (u.at === undefined) continue;
    const used: EvmLog = { address: UNDECODED, topics: [AUTHORIZATION_USED_TOPIC, topic(PAYER), NONCE], data: "0x" };
    txs.push({ hash: txHashOf(u.transaction), block: BigInt(u.at), status: 1, from: SETTLER, to: UNDECODED, input: "0x", logs: [used] });
  }
  const value = valueOf(c);
  const below = belowConsumer(c);
  const fault = faultOf(c);
  return {
    network: NETWORK,
    heads: plan.heads,
    txs,
    call: (to, data, block) => {
      if (data === "0x06fdde03") return abiString("Token");
      if (data === "0x54fd4d50") return abiString("1");
      if (c.facts.unreadable === "unparseable") return "0x1234";
      if (below !== undefined) return word(block >= below ? 1n : 0n);
      return word((block >= plan.heads.latest ? value.head : value.final) ? 1n : 0n);
    },
    ...(fault === undefined ? {} : { fault }),
  };
}

/**
 * Why a case cannot arise on a charge read that holds an EIP-3009 nonce or a Permit2 bit, or undefined where it can:
 * a failed result that consumed the value (a reverted settlement consumes neither); an answer `not-found` (the read
 * always holds and reads its value); a case of the value's read (read-status rules 22 and 23) whose facts give no value,
 * or a value unconsumed at the final mark and not read at the latest head (the read holds its value and reads it at both
 * heads; a value consumed at the final mark is consumed at the latest head, which the rules decide alike); an act or an
 * item with no position (every log and transaction is in a block).
 */
function chargeCannot(c: ReadCase, act: Act): string | undefined {
  const want = c.expect[act];
  const reason = "reason" in want ? want.reason : undefined;
  if (valueRule(c)) {
    const v = c.facts.value;
    if (v === undefined && c.facts.search.whole) return "the read holds its single-use value and reads it at a finalized block and at the latest block";
    if (v !== undefined && v.head === undefined && !v.consumed) return "the read reads its value at the latest block whenever it reads it at a finalized block";
  }
  if (reason === "transaction-failed" || c.case.startsWith("a failed result that consumed the value")) {
    return "a reverted settlement consumes no authorization nonce or Permit2 bit, so no failed result consumed the value";
  }
  if (reason === "not-found") return "the read holds its single-use value and reads it, so it never answers not-found";
  if (c.facts.seen.some((x) => x.position === undefined) || (c.facts.undecoded ?? []).some((u) => u.at === undefined)) {
    return "every log and transaction the read meets is in a block, which places it";
  }
  return undefined;
}

/** An EIP-3009 form: the case on the ledger, through the pairing's own `status`. */
function eip3009Form(entry: typeof evmAuthorization | typeof chargeUsdcEvm): DeclaredForm {
  const inapplicable = declarations([...CHARGE_DECLARED, ...HELD_DECLARED, ...ONE_TRANSFER_DECLARED]);
  return {
    form: {
      subject: entry.id,
      arrange: (c, act) => {
        const declared = statedFor(inapplicable, c, act);
        if (declared !== undefined) return { inapplicable: declared };
        const cannot = chargeCannot(c, act);
        if (cannot !== undefined) return { inapplicable: cannot };
        if (c.facts.seen.some((x) => (x.moved?.length ?? 0) > 1)) return { inapplicable: "an EIP-3009 use moves one transfer" };
        const plan = planOf(c);
        const spec = eip3009Ledger(c, plan);
        const reader = { ...ledgerReader(spec), ...(c.facts.unreadable === "chain-mismatch" ? { network: "eip155:1" as const } : {}) };
        return {
          run: async () =>
            caseAnswer(await entry.status(eip3009Ref(c, plan), reader, queryOf(c, act) as never), plan, c),
        };
      },
    },
    inapplicable,
  };
}

// ── Permit2.

/** The canonical Permit2 deployment, the reference's `authorization.at`. */
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as Hex;
/** The witness hash the payer signed: the reference's `presented.witness`. */
const WITNESS = keccakHex("the payment witness");
/** Another nonce the payer signs a permit under, with the same witness: an act carrying H that consumes no value. */
const WITNESS_NONCE = keccakHex("another nonce under the payment witness");
/** A log of another contract, which places a transfer among a receipt's logs. */
const FILLER: EvmLog = { address: OTHER, topics: [keccakHex("Filler()")], data: "0x" };

/** The payer's `permitWitnessTransferFrom`, single where it makes one transfer and batch where it makes several. */
function permit2Call(transfers: readonly { token: Hex; to: Hex; amount: bigint }[], deadline: bigint, nonce: Hex = NONCE): Hex {
  const empty = [uintWord(0n), uintWord(0n)];
  if (transfers.length === 1) {
    const t = transfers[0]!;
    return hexOf(
      concat([
        bytesOf(PERMIT2_WITNESS_SELECTORS[0]!)!,
        addressWord(t.token),
        uintWord(t.amount),
        bytes32Word(nonce),
        uintWord(deadline),
        addressWord(t.to),
        uintWord(t.amount),
        addressWord(PAYER),
        bytes32Word(WITNESS),
        uintWord(10n * 32n),
        uintWord(11n * 32n),
        ...empty,
      ]),
    );
  }
  const n = BigInt(transfers.length);
  // Six head words; the permit (offset to its list, nonce, deadline, then the list); the transfer details; two empties.
  const permitAt = 6n * 32n;
  const permitBytes = 3n * 32n + 32n + n * 64n;
  const detailsAt = permitAt + permitBytes;
  const stringAt = detailsAt + 32n + n * 64n;
  return hexOf(
    concat([
      bytesOf(PERMIT2_WITNESS_SELECTORS[1]!)!,
      uintWord(permitAt),
      uintWord(detailsAt),
      addressWord(PAYER),
      bytes32Word(WITNESS),
      uintWord(stringAt),
      uintWord(stringAt + 32n),
      uintWord(3n * 32n),
      bytes32Word(nonce),
      uintWord(deadline),
      uintWord(n),
      ...transfers.flatMap((t) => [addressWord(t.token), uintWord(t.amount)]),
      uintWord(n),
      ...transfers.flatMap((t) => [addressWord(t.to), uintWord(t.amount)]),
      ...empty,
    ]),
  );
}

/** The members `presented` compares for a single transfer of `amount` of `token` to `to`. */
function permit2Presented(token: Hex, to: Hex, amount: string, deadline: bigint): MppPermit2Ref["presented"] {
  return {
    permitted: `${token}:${amount}`,
    nonce: hexOf(bytes32Word(NONCE)),
    deadline: deadline.toString(),
    owner: PAYER,
    transfers: `${to}:${amount}`,
    witness: WITNESS,
  };
}

/** The reference of a case: as `eip3009Ref` builds it, over Permit2's members. */
function permit2Ref(c: ReadCase, plan: Plan): MppPermit2Ref {
  const deadline = plan.validBefore - 1n;
  const yes = c.facts.seen.find((s) => s.presented === "yes");
  const moved = yes?.moved?.[0];
  return {
    network: NETWORK,
    payee: PAYEE,
    payer: PAYER,
    authorization: { at: PERMIT2, nonce: NONCE, deadline: deadline.toString() },
    presented: permit2Presented(moved === undefined ? CURRENCY : assetOf[moved.asset]!, PAYEE, yes === undefined ? "1000000" : (moved?.amount ?? "1"), deadline),
  };
}

/** Why a case cannot arise on the Permit2 read beyond `chargeCannot`, or undefined where it can. */
function permit2Cannot(c: ReadCase): string | undefined {
  for (const s of c.facts.seen) {
    if (s.position === undefined || s.result !== "succeeded" || s.consumed) continue;
    if (s.party === "payer" && s.kind === "other") continue;
    if (s.party !== "payer") {
      return "the search finds the payer's transfers and cancellations alone, so it meets no act another account signed that consumed nothing";
    }
  }
  return undefined;
}

/** One seen item of a case as a transaction of the Permit2 ledger, or none where it cannot be placed. */
function permit2Tx(s: CaseSeen, deadline: bigint): LedgerTx | undefined {
  if (s.position === undefined) return undefined;
  const hash = txHashOf(s.transaction);
  const block = BigInt(s.position);
  const to = s.account === "payee" ? PAYEE : ELSEWHERE;
  const transfers = (s.moved ?? [{ asset: "A", amount: "1", to: s.account }]).map((m) => ({
    token: assetOf[m.asset] ?? CURRENCY,
    to,
    amount: BigInt(m.amount),
  }));
  // An act of the payer's that consumed nothing: a permit under another nonce carrying the presented witness word.
  const witnessHit = s.result === "succeeded" && s.party === "payer" && s.kind === "same" && !s.consumed;
  const input = permit2Call(transfers, deadline, witnessHit ? WITNESS_NONCE : NONCE);
  if (s.result === "failed") return { hash, block, status: 0, from: SETTLER, to: PERMIT2, input, logs: [] };
  // The payer's act of another pairing that consumed no bit: the `authorization` charge's EIP-3009 use of the nonce.
  if (s.kind === "other" && s.party === "payer" && !s.consumed) {
    const value = BigInt(s.moved?.[0]?.amount ?? "1");
    const used: EvmLog = { address: CURRENCY, topics: [AUTHORIZATION_USED_TOPIC, topic(PAYER), NONCE], data: "0x" };
    const paid: EvmLog = { address: CURRENCY, topics: [TRANSFER_TOPIC, topic(PAYER), topic(to)], data: word(value) };
    return { hash, block, status: 1, from: SETTLER, to: CURRENCY, input: signedCall(CURRENCY, to, value, deadline + 1n), logs: [used, paid] };
  }
  // An act of another kind, or one another account signed that consumed the value, as the payer's cancellation of the
  // nonce's bit (rule 16 decides before it asks who signed the consumer).
  if (s.kind === "other" || s.party !== "payer") {
    const n = BigInt(NONCE);
    const invalidated: EvmLog = {
      address: PERMIT2,
      topics: [UNORDERED_NONCE_INVALIDATION_TOPIC, topic(PAYER)],
      data: hexOf(concat([uintWord(n >> 8n), uintWord(1n << (n & 0xffn))])),
    };
    return { hash, block, status: 1, from: PAYER, to: PERMIT2, input: "0x", logs: [invalidated] };
  }
  // Each transfer at the place the case names, the receipt's other places holding another contract's log.
  const logs: EvmLog[] = [];
  transfers.forEach((t, i) => {
    const place = s.moved?.[i]?.place;
    while (typeof place === "number" && logs.length < place) logs.push(FILLER);
    logs.push({ address: t.token, topics: [TRANSFER_TOPIC, topic(PAYER), topic(t.to)], data: word(t.amount) });
  });
  return { hash, block, status: 1, from: SETTLER, to: PERMIT2, input, logs };
}

function permit2Ledger(c: ReadCase, plan: Plan): LedgerSpec {
  const deadline = plan.validBefore - 1n;
  const txs = c.facts.seen.flatMap((s) => permit2Tx(s, deadline) ?? []);
  for (const u of c.facts.undecoded ?? []) {
    if (u.at === undefined) continue;
    // A transfer from the payer whose transaction carries the nonce in no call the read decodes.
    const paid: EvmLog = { address: OTHER, topics: [TRANSFER_TOPIC, topic(PAYER), topic(ELSEWHERE)], data: word(1n) };
    txs.push({ hash: txHashOf(u.transaction), block: BigInt(u.at), status: 1, from: SETTLER, to: UNDECODED, input: NONCE, logs: [paid] });
  }
  const value = valueOf(c);
  const consumers = c.facts.seen.filter((s) => s.position !== undefined && s.result === "succeeded" && s.consumed).map((s) => BigInt(s.position!));
  const first = consumers.length === 0 ? undefined : consumers.reduce((a, b) => (a < b ? a : b));
  // The bit follows the act that set it where the case places one, so a consumer above the final head reads unset at
  // the final mark (rules 17 and 22 decide that case alike), and otherwise the value as the case reads it.
  const bit = (block: bigint): boolean =>
    first !== undefined
      ? block >= first || (block >= plan.heads.latest && value.head)
      : (block >= plan.heads.finalized && value.final) || (block >= plan.heads.latest && value.head);
  // The payer's bit for another nonce under the witness: set from the first block whose act took it.
  const hits = c.facts.seen
    .filter((s) => s.position !== undefined && s.result === "succeeded" && s.party === "payer" && s.kind === "same" && !s.consumed)
    .map((s) => BigInt(s.position!));
  const hitAt = hits.length === 0 ? undefined : hits.reduce((a, b) => (a < b ? a : b));
  const witnessWord = hexOf(uintWord(BigInt(WITNESS_NONCE) >> 8n)).slice(2);
  const fault = faultOf(c);
  return {
    network: NETWORK,
    heads: plan.heads,
    txs,
    call: (_to, data, block) => {
      if (c.facts.unreadable === "unparseable") return "0x1234";
      if (data.toLowerCase().endsWith(witnessWord)) {
        return word(hitAt !== undefined && block >= hitAt ? 1n << (BigInt(WITNESS_NONCE) & 0xffn) : 0n);
      }
      return word(bit(block) ? 1n << (BigInt(NONCE) & 0xffn) : 0n);
    },
    ...(fault === undefined ? {} : { fault }),
  };
}

/** The Permit2 form: the case on the ledger, through the pairing's own `status`. */
function permit2Form(): DeclaredForm {
  const inapplicable = declarations([...CHARGE_DECLARED, ...HELD_DECLARED, ...PERMIT2_DECLARED]);
  return {
    form: {
      subject: evmPermit2.id,
      arrange: (c, act) => {
        const declared = statedFor(inapplicable, c, act);
        if (declared !== undefined) return { inapplicable: declared };
        const cannot = chargeCannot(c, act) ?? permit2Cannot(c);
        if (cannot !== undefined) return { inapplicable: cannot };
        const plan = planOf(c);
        const reader = {
          ...ledgerReader(permit2Ledger(c, plan)),
          ...(c.facts.unreadable === "chain-mismatch" ? { network: "eip155:1" as const } : {}),
        };
        return { run: async () => caseAnswer(await evmPermit2.status(permit2Ref(c, plan), reader, queryOf(c, act) as never), plan, c) };
      },
    },
    inapplicable,
  };
}


// ── mpp/session/evm: the opening, read by its Permit2 funding.

/** The session's escrow, H, and another salt; the payer's Permit2 nonce for the opening is `NONCE`. */
const SESSION_ESCROW = "0x1234567890abcdef1234567890abcdef12345678" as Hex;
const SESSION_H = keccakHex("the session's ATR hash");
const SESSION_H2 = keccakHex("another session's ATR hash");
const OTHER_NONCE = keccakHex("another Permit2 nonce");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;
const PARTY: Readonly<Record<"payer" | "payee" | "other", Hex>> = { payer: PAYER, payee: PAYEE, other: STRANGER };

/** The escrow's `openWithPermit2` (draft-evm-session-00), its 65-byte signature of zero bytes, which no read checks. */
function openWithPermit2(o: { payee: Hex; token: Hex; amount: bigint; salt: Hex; from: Hex; nonce: Hex; deadline: bigint }): Hex {
  return hexOf(
    concat([
      bytesOf(OPEN_WITH_PERMIT2_SELECTOR)!,
      addressWord(o.payee),
      addressWord(o.token),
      uintWord(o.amount),
      bytes32Word(o.salt),
      addressWord(ZERO_ADDRESS),
      addressWord(o.from),
      bytes32Word(o.nonce),
      uintWord(o.deadline),
      uintWord(9n * 32n),
      uintWord(65n),
      new Uint8Array(96),
    ]),
  );
}

/**
 * The escrow's `openWithAuthorization` (draft-evm-session-00) of `from`, with the nonce the escrow recomputes over the
 * call's from, payee, token, salt and signer, its 65-byte signature of zero bytes, which no read checks; and the logs
 * the token emits when it runs, `AuthorizationUsed` of `from` and that nonce, then the deposit's `Transfer`.
 */
function openWithAuthorization(o: { payee: Hex; token: Hex; amount: bigint; salt: Hex; from: Hex; deadline: bigint }): { input: Hex; logs: EvmLog[] } {
  const nonce = keccakHex(concat([addressWord(o.from), addressWord(o.payee), addressWord(o.token), bytes32Word(o.salt), addressWord(ZERO_ADDRESS)]));
  const input = hexOf(
    concat([
      bytesOf(OPEN_WITH_AUTHORIZATION_SELECTOR)!,
      addressWord(o.payee),
      addressWord(o.token),
      uintWord(o.amount),
      bytes32Word(o.salt),
      addressWord(ZERO_ADDRESS),
      addressWord(o.from),
      uintWord(0n),
      uintWord(o.deadline),
      bytes32Word(nonce),
      uintWord(10n * 32n),
      uintWord(65n),
      new Uint8Array(96),
    ]),
  );
  const used: EvmLog = { address: o.token, topics: [AUTHORIZATION_USED_TOPIC, topic(o.from), nonce], data: "0x" };
  const deposit: EvmLog = { address: o.token, topics: [TRANSFER_TOPIC, topic(o.from), topic(SESSION_ESCROW)], data: word(o.amount) };
  return { input, logs: [used, deposit] };
}

/** The escrow's `open`, which its payer sends itself, funded by a `hash`: an act of another kind. */
function openPlain(payee: Hex, token: Hex, amount: bigint, salt: Hex): Hex {
  const selector = keccakHex("open(address,address,uint128,bytes32,address)").slice(0, 10) as Hex;
  return hexOf(concat([bytesOf(selector)!, addressWord(payee), addressWord(token), uintWord(amount), bytes32Word(salt), addressWord(ZERO_ADDRESS)]));
}

/** The reference of a case, as `sessionEvm.reference` writes it for a `permit2` opening. */
function sessionRef(c: ReadCase, plan: Plan): MppSessionOpeningRef {
  const deadline = plan.validBefore - 1n;
  const yes = c.facts.seen.find((s) => s.presented === "yes");
  const moved = yes?.moved?.[0];
  return {
    network: NETWORK,
    payee: PAYEE,
    payer: PAYER,
    opens: { escrow: SESSION_ESCROW, channel: keccakHex("the channel"), h: SESSION_H, chainId: Number(CHAIN) },
    funding: { type: "permit2", token: CURRENCY, at: PERMIT2, nonce: NONCE, deadline: deadline.toString() },
    presented: {
      funding: "permit2",
      token: moved === undefined ? CURRENCY : assetOf[moved.asset]!,
      amount: yes === undefined ? "1000000" : (moved?.amount ?? "1"),
      nonce: NONCE,
      deadline: deadline.toString(),
      spender: SESSION_ESCROW,
      owner: PAYER,
      witness: `${PAYEE}:${SESSION_H}:${ZERO_ADDRESS}`,
    },
  };
}

/**
 * Why a case cannot be made on the session's ledger, or undefined where it can: an act of another kind that consumed
 * the value (an `open` the payer sends itself takes no Permit2 bit).
 */
function sessionCannot(c: ReadCase): string | undefined {
  if (c.facts.seen.some((s) => s.kind === "other" && s.consumed)) return "an open the payer sends itself takes no Permit2 bit";
  return undefined;
}

/** One seen item of a case as a transaction of the session's ledger. */
function sessionTx(s: CaseSeen, deadline: bigint): LedgerTx | undefined {
  if (s.position === undefined) return undefined;
  const hash = txHashOf(s.transaction);
  const block = BigInt(s.position);
  // A transaction another account signed that consumed the payer's value: the payer's own (rule 16 decides first).
  const by = s.consumed ? PAYER : PARTY[s.party];
  const payee = s.account === "payee" ? PAYEE : ELSEWHERE;
  const salt = s.carries ? SESSION_H : SESSION_H2;
  const m = s.moved?.[0];
  const token = m === undefined ? CURRENCY : (assetOf[m.asset] ?? CURRENCY);
  const amount = BigInt(m?.amount ?? "1");
  const nonce = s.consumed ? NONCE : OTHER_NONCE;
  const deposit: EvmLog = { address: token, topics: [TRANSFER_TOPIC, topic(by), topic(SESSION_ESCROW)], data: word(amount) };
  if (s.result === "failed") {
    return { hash, block, status: 0, from: SETTLER, to: SESSION_ESCROW, input: openWithPermit2({ payee, token, amount, salt, from: by, nonce, deadline }), logs: [] };
  }
  if (s.party !== "payer" && !s.consumed) {
    // An opening another account funded, met where it shares a transaction with a deposit of the payer's: a batch of two
    // `openWithAuthorization` calls, each shown run by its token's `AuthorizationUsed`, the payer's under another salt,
    // which carries nothing and decides nothing. Each call's signer is its own `from`, so the item's party is the case's,
    // and its first reason, the party's, whatever its kind: it is built as an `authorization` opening (rule 14 names the
    // first reason). A `permit2` opening counts only as a transaction's own call, so none is batched.
    const own = openWithAuthorization({ payee: PAYEE, token: CURRENCY, amount: 1n, salt: SESSION_H2, from: PAYER, deadline });
    const theirs = openWithAuthorization({ payee, token, amount, salt, from: by, deadline });
    return { hash, block, status: 1, from: SETTLER, to: BATCHER, input: hexOf(concat([bytesOf(own.input)!, bytesOf(theirs.input)!])), logs: [...own.logs, ...theirs.logs] };
  }
  if (s.kind === "other") return { hash, block, status: 1, from: by, to: SESSION_ESCROW, input: openPlain(payee, token, amount, salt), logs: [deposit] };
  return { hash, block, status: 1, from: SETTLER, to: SESSION_ESCROW, input: openWithPermit2({ payee, token, amount, salt, from: by, nonce, deadline }), logs: [deposit] };
}

/** A contract that batches calls to the escrow. */
const BATCHER = "0xba7c4e5000000000000000000000000000000000" as Hex;

function sessionLedger(c: ReadCase, plan: Plan): LedgerSpec {
  const deadline = plan.validBefore - 1n;
  const txs = c.facts.seen.flatMap((s) => sessionTx(s, deadline) ?? []);
  for (const u of c.facts.undecoded ?? []) {
    if (u.at === undefined) continue;
    // The payer's deposit to the escrow in a transaction whose input carries H in no open call the read decodes.
    const deposit: EvmLog = { address: CURRENCY, topics: [TRANSFER_TOPIC, topic(PAYER), topic(SESSION_ESCROW)], data: word(1n) };
    txs.push({ hash: txHashOf(u.transaction), block: BigInt(u.at), status: 1, from: SETTLER, to: UNDECODED, input: SESSION_H, logs: [deposit] });
  }
  const value = valueOf(c);
  const consumers = c.facts.seen.filter((s) => s.position !== undefined && s.result === "succeeded" && s.consumed).map((s) => BigInt(s.position!));
  const first = consumers.length === 0 ? undefined : consumers.reduce((a, b) => (a < b ? a : b));
  const bit = (block: bigint): boolean =>
    first !== undefined
      ? block >= first || (block >= plan.heads.latest && value.head)
      : (block >= plan.heads.finalized && value.final) || (block >= plan.heads.latest && value.head);
  const fault = faultOf(c);
  return {
    network: NETWORK,
    heads: plan.heads,
    txs,
    call: (_to, _data, block) => {
      if (c.facts.unreadable === "unparseable") return "0x1234";
      return word(bit(block) ? 1n << (BigInt(NONCE) & 0xffn) : 0n);
    },
    ...(fault === undefined ? {} : { fault }),
  };
}

/** The session's form: the case on the ledger, through the pairing's own `status`. */
function sessionForm(): DeclaredForm {
  const inapplicable = declarations(SESSION_DECLARED);
  return {
    form: {
      subject: sessionEvm.id,
      arrange: (c, act) => {
        const declared = statedFor(inapplicable, c, act);
        if (declared !== undefined) return { inapplicable: declared };
        const cannot = sessionCannot(c);
        if (cannot !== undefined) return { inapplicable: cannot };
        const plan = planOf(c);
        const reader = {
          ...ledgerReader(sessionLedger(c, plan)),
          ...(c.facts.unreadable === "chain-mismatch" ? { network: "eip155:1" as const } : {}),
        };
        return { run: async () => caseAnswer((await sessionEvm.status(sessionRef(c, plan) as never, reader as never, queryOf(c, act) as never)) as never, plan, c) };
      },
    },
    inapplicable,
  };
}

// ── Coverage `none`: the named transaction.

const NAMED_REF = (c: ReadCase): MppNamedRef => ({
  network: NETWORK,
  payee: PAYEE,
  payer: PAYER,
  transaction: txHashOf(c.facts.seen[0]?.transaction ?? "t1"),
});

function namedForm(entry: typeof evmTransaction | typeof evmHash): DeclaredForm {
  return {
    form: {
      subject: entry.id,
      arrange: (c, act) => {
        if ((c.facts.undecoded ?? []).length > 0) {
          return { inapplicable: "the read names its transaction and searches nothing, so it meets no item it cannot decode" };
        }
        const plan = planOf(c);
        const txs = c.facts.seen.flatMap((s): LedgerTx[] => {
          if (s.position === undefined) return [];
          const by = s.party === "payee" ? PAYEE : s.party === "other" ? STRANGER : PAYER;
          const to = s.account === "payee" ? PAYEE : ELSEWHERE;
          const succeeded = s.result === "succeeded";
          const logs: EvmLog[] =
            s.account === "none" || !succeeded ? [] : [{ address: CURRENCY, topics: [TRANSFER_TOPIC, topic(by), topic(to)], data: word(1n) }];
          // The transaction's own call: `transfer(to, 1)` on the asset where the act names an account, else none.
          const input = s.account === "none" ? "0x" : hexOf(concat([bytesOf("0xa9059cbb")!, addressWord(to), uintWord(1n)]));
          return [{ hash: txHashOf(s.transaction), block: BigInt(s.position), status: succeeded ? 1 : 0, from: by, to: CURRENCY, input, logs }];
        });
        const fault = faultOf(c);
        const reader = {
          ...ledgerReader({ network: NETWORK, heads: plan.heads, txs, ...(fault === undefined ? {} : { fault }) }),
          ...(c.facts.history ? { archival: true } : {}),
        };
        return { run: async () => caseAnswer(await entry.status(NAMED_REF(c), reader, queryOf(c, act) as never), plan, c) };
      },
    },
    inapplicable: NAMED_DECLARED,
  };
}

// ── The declarations: the cases each read cannot meet, with the reason, as the pairings' profiles state them.

const DECLARED = "declared inapplicable to the read kit";
const PLACED = "on every pairing at coverage full, since every log and transaction the read meets is in a block, which places it";

/** The cases whose text opens with `words`, on both acts, as stated. */
function opening(words: string, stated: string): Inapplicable[] {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words)).map((c) => ({ case: c.case, stated }));
  if (found.length === 0) throw new Error(`no case of read-status.json opens "${words}"`);
  return found;
}

/** One statement per case and act: the cases two declarations name on one act are stated once, with both texts. */
function declarations(list: readonly Inapplicable[]): Inapplicable[] {
  const byKey = new Map<string, { case: string; act: Act; stated: string[] }>();
  for (const d of list) {
    for (const act of d.acts ?? ACTS) {
      const key = `${d.case}\u0000${act}`;
      const had = byKey.get(key);
      if (had === undefined) byKey.set(key, { case: d.case, act, stated: [d.stated] });
      else if (!had.stated.includes(d.stated)) had.stated.push(d.stated);
    }
  }
  return [...byKey.values()].map((d) => ({ case: d.case, acts: [d.act], stated: d.stated.join("; ") }));
}

/** On `evm/authorization`, `usdc/evm` and `evm/permit2`, and on every pairing at coverage `full`. */
const CHARGE_DECLARED: readonly Inapplicable[] = [
  // On `evm/authorization`, `usdc/evm` and `evm/permit2`, `transaction-failed` and the cases opening *a failed result
  // that consumed the value*, since a reverted settlement consumes no authorization nonce or Permit2 bit.
  ...answering(
    "transaction-failed",
    `${DECLARED}: on evm/authorization, usdc/evm and evm/permit2, transaction-failed, since a reverted settlement consumes no authorization nonce or Permit2 bit`,
  ),
  ...opening(
    "a failed result that consumed the value",
    `${DECLARED}: on evm/authorization, usdc/evm and evm/permit2, the cases opening "a failed result that consumed the value", since a reverted settlement consumes no authorization nonce or Permit2 bit`,
  ),
  // And `not-found`, since each read holds its single-use value, the authorization's nonce or the Permit2 bit.
  ...answering(
    "not-found",
    `${DECLARED}: on evm/authorization, usdc/evm and evm/permit2, not-found, since each read holds its single-use value, the authorization's nonce or the Permit2 bit`,
  ),
  // By the case's words, on every pairing at coverage `full`, *an act the read cannot place against the position
  // given* (its three cases) and *an item the search could not decode that gives no position*, since every log and
  // transaction the read meets is in a block, which places it.
  ...opening(
    "an act the read cannot place against the position given",
    `${DECLARED}: on every pairing at coverage full, "an act the read cannot place against the position given", since every log and transaction the read meets is in a block, which places it`,
  ),
  ...opening(
    "an item the search could not decode that gives no position",
    `${DECLARED}: on every pairing at coverage full, "an item the search could not decode that gives no position", since every log and transaction the read meets is in a block, which places it`,
  ),
];

/** On `evm/authorization`, `usdc/evm` and `evm/permit2`: the reads hold their value and read it at both heads. */
const HELD_TEXT =
  `${DECLARED}: on evm/authorization, usdc/evm and evm/permit2, since each read holds its single-use value and reads it at a ` +
  "finalized block and at the latest block";
const HELD_DECLARED: readonly Inapplicable[] = [
  // On `evm/authorization`, `usdc/evm` and `evm/permit2`, *a read with no means to read the single-use value* and *a
  // read that did not read the value at the latest head*, since each read holds its single-use value and reads it at a
  // `finalized` block and at the latest block.
  ...opening("a read with no means to read the single-use value", HELD_TEXT),
  ...opening("a read that did not read the value at the latest head", HELD_TEXT),
];

/** The statement that declares a case on an act, where one does. */
function statedFor(inapplicable: readonly Inapplicable[], c: ReadCase, act: Act): string | undefined {
  return inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)))?.stated;
}

/** On `evm/authorization` and `usdc/evm` alone. */
const ONE_TRANSFER_DECLARED: readonly Inapplicable[] = [
  // On `evm/authorization` and `usdc/evm`, *each transfer of what moved is named by its transaction and its place*,
  // since an EIP-3009 use moves one transfer.
  ...opening(
    "each transfer of what moved is named by its transaction and its place",
    `${DECLARED}: on evm/authorization and usdc/evm, "each transfer of what moved is named by its transaction and its place", since an EIP-3009 use moves one transfer`,
  ),
];

/** On `evm/permit2` alone. */
const PERMIT2_TEXT =
  `${DECLARED}: on evm/permit2, since each gives an act carrying H that another account signed and that consumed nothing, ` +
  "and the Permit2 search reads the payer's own transfers and cancellations, so every act it meets is the payer's";
const PERMIT2_DECLARED: readonly Inapplicable[] = [
  // On `evm/permit2`, *an act the option's payee signed*, *an act carrying H under another account's signature*, *a
  // transaction for which two reasons hold* and *the settled act's answer names every foreign item*, since each gives an
  // act carrying H that another account signed and that consumed nothing.
  ...opening("an act the option's payee signed", PERMIT2_TEXT),
  ...opening("an act carrying H under another account's signature", PERMIT2_TEXT),
  ...opening("a transaction for which two reasons hold", PERMIT2_TEXT),
  ...opening("the settled act's answer names every foreign item", PERMIT2_TEXT),
];

/** On `mpp/session/evm`. */
const SESSION_HOLDS = `${DECLARED}: on session/evm, since the read holds what the payer signed, its opening's authorization or permit, and reads that value`;
const SESSION_DECLARED: readonly Inapplicable[] = [
  ...answering("not-found", SESSION_HOLDS),
  ...opening("a read with no means to read the single-use value", SESSION_HOLDS),
  ...opening("search-incomplete is answered before not-found", `${DECLARED}: on session/evm, which makes no search for H`),
  ...opening(
    "a read that did not read the value at the latest head",
    `${DECLARED}: on session/evm, since it reads its value at a finalized block and at the latest block`,
  ),
  ...["instrument-unused", "instrument-consumed", "transaction-failed"].flatMap((r) =>
    answering(r, `${DECLARED}: on session/evm, since it answers no failed but before-position, its search being no search for H`),
  ),
  ...opening("an act the read cannot place against the position given", `${DECLARED}: ${PLACED}`),
  ...opening("an item the search could not decode that gives no position", `${DECLARED}: ${PLACED}`),
  ...opening(
    "each transfer of what moved is named by its transaction and its place",
    `${DECLARED}: on session/evm, since an opening moves one deposit, from the payer to the escrow, and names its channel's payee`,
  ),
  ...opening(
    "an act carrying H that names no account",
    `${DECLARED}: on session/evm, since an opening moves one deposit, from the payer to the escrow, and names its channel's payee`,
  ),
];

/** On `evm/transaction` and `evm/hash`. */
const NAMED_DECLARED: readonly Inapplicable[] = [
  // On `evm/transaction` and `evm/hash`, *at coverage none, a lookup read whole beside an item the search could not
  // decode*, since each reads the transaction the claim names and makes no search.
  ...opening(
    "at coverage none, a lookup read whole beside an item the search could not decode",
    `${DECLARED}: on evm/transaction and evm/hash, "at coverage none, a lookup read whole beside an item the search could not decode", since each reads the transaction the claim names and makes no search`,
  ),
];

/** The forms of the MPP charges and the session on EVM chains, each with its profile's declarations. */
export const forms: readonly DeclaredForm[] = [
  eip3009Form(evmAuthorization),
  eip3009Form(chargeUsdcEvm),
  permit2Form(),
  namedForm(evmTransaction),
  namedForm(evmHash),
  sessionForm(),
];

