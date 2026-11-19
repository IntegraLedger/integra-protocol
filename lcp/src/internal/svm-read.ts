/**
 * The Solana read, as the profile `read-status` answers it: `status` of the pairings whose act is a transfer
 * (`x402/exact/solana`, `mpp/charge/solana`, `mpp/charge/usdc/solana`) and of those whose act is a payment channel's
 * opening (`x402/upto/solana`, `x402/batch-settlement/solana`), the search for H by the buyer's own account, the read of
 * the signed message's life, the reference's keys, and `recover`. Every fact `status` gives `decide` is read from the
 * landed transactions against the reference and the option's payee; none is a constant.
 */
import { fromLcpString, toLcpString, type AtrHash } from "../core.js";
import type { Hex } from "../evm.js";
import { isObject, notFoundPoint } from "../fields.js";
import type { MppChallenge } from "../mpp-challenge.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import { mppPayee, x402Payee } from "./payee.js";
import type { PaymentRequirements } from "../x402.js";
import {
  decode,
  decodeSvmTx,
  durableNonce,
  isKey,
  isSignature,
  isSolanaNetwork,
  keyString,
  memoData,
  PAYMENT_CHANNELS,
  staticNonce,
  svmCarrier,
  svmDigest,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  type SolanaNetwork,
  type SvmNonce,
  type SvmTx,
} from "./svm.js";
import {
  decide,
  type Facts,
  type Ledger,
  type Moved,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type UnreadableReason,
} from "./read.js";

/**
 * The one Solana mark: `finalized`, a block at maximum lockout, the default and the final mark. A seller names it
 * alone, and a caller asks for it alone.
 */
export type SvmMark = "finalized";

/**
 * A commitment an RPC call names: `finalized`, the mark, or `confirmed`, a block a supermajority of the cluster voted
 * on, which is the latest head the search for H and the lookups read on to before a `failed`, and no mark.
 */
export type SvmCommitment = "confirmed" | "finalized";

/**
 * Where the read met a transaction or read the value: at the mark, or only above the final head, at the latest head
 * (`head`), which is no mark: a transaction met there answers `pending`, `below-mark`, naming no finality.
 */
type Reached = SvmMark | "head";

const REACHED: readonly Reached[] = ["head", "finalized"];

/** One instruction of `meta.innerInstructions`: the top-level instruction it ran under (`index`), and its own fields. */
export interface SvmInner {
  /** The index, among the message's top-level instructions, of the instruction it ran under. */
  index: number;
  /** Indexes the static keys, then `loaded.writable`, then `loaded.readonly`, as a top-level instruction does. */
  program: number;
  accounts: readonly number[];
  data: Uint8Array;
}

/** One entry of `meta.preTokenBalances` or `meta.postTokenBalances`. */
export interface SvmTokenBalance {
  /** `accountIndex`: the token account, indexing the keys as an instruction does. */
  account: number;
  mint: string;
  /**
   * The token account's owner, which the read requires: a landed transaction whose balances name no owner cannot show
   * whose account a transfer reached, so the search holds it as an item it could not decode, never another account.
   */
  owner?: string;
}

/**
 * A landed transaction as `getTransaction` returns it with encoding `base64` and `maxSupportedTransactionVersion` 1,
 * the highest message version this package decodes.
 */
export interface SvmLanded {
  wire: Uint8Array;
  err: unknown | null;
  /** The slot of the block that holds it, as `getTransaction` gives it; absent where the endpoint gives none. */
  slot?: bigint;
  loaded: { writable: readonly Uint8Array[]; readonly: readonly Uint8Array[] };
  /** `meta.innerInstructions`, in the node's order, each with the top-level instruction it ran under. */
  inner: readonly SvmInner[];
  /** `meta.preTokenBalances`; absent read as none. */
  pre?: readonly SvmTokenBalance[];
  /** `meta.postTokenBalances`; absent read as none. */
  post?: readonly SvmTokenBalance[];
}

/** One entry of `getSignaturesForAddress`. */
export interface SvmSignature {
  signature: string;
  slot: bigint;
  /** The RPC's rendering of the transaction's memos (`[len] text`, joined by `; `), or null when it has none. */
  memo: string | null;
}

/**
 * Bounded, read-only calls against one network's endpoint. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`, and no function in this package reads a rejection as finding nothing: a rejected call is
 * `unreadable`, `transport` (`too-large` or `unparseable` for a `ReaderError` of kind `too-large` or `malformed`).
 */
export interface SvmReader {
  readonly network: SolanaNetwork;
  /**
   * `getTransaction` at that commitment, with encoding `base64` and `maxSupportedTransactionVersion: 1`, or `notFound`
   * with the node's slot there (`getSlot`, read from the same node before the lookup), or null when the reader cannot
   * read it. A reader must ask with 1: a node asked with 0 answers a version-1 transaction with an error (-32015).
   */
  transaction(signature: string, commitment: SvmCommitment): Promise<SvmLanded | { notFound: true; slot: bigint | null }>;
  /**
   * `getSignaturesForAddress` at that commitment, newest first, `before` and `until` as the RPC takes them (each
   * exclusive), and `minContextSlot`, "the minimum slot that the request can be evaluated at", so a node that has not
   * reached it fails the call.
   */
  signatures(
    address: string,
    page: { before?: string; until?: string; limit: 1000; commitment: SvmCommitment; minContextSlot?: bigint },
  ): Promise<readonly SvmSignature[]>;
  /** `getSlot` at that commitment. */
  slot(commitment: SvmCommitment): Promise<bigint>;
  /**
   * `isBlockhashValid` at that commitment: `valid` is the response's `value`, and `slot` its context slot, the slot the
   * node evaluated it at.
   */
  blockhashValid(blockhash: string, commitment: SvmCommitment): Promise<{ valid: boolean; slot: bigint }>;
  /** `getFirstAvailableBlock`: the lowest slot whose block the node still holds. */
  firstAvailableBlock(): Promise<bigint>;
  /**
   * `getAccountInfo` at that commitment with encoding `base64`: the response's context slot, and the account's owner and
   * data, or null when no account exists at that address.
   */
  account(address: string, commitment: SvmCommitment): Promise<{ slot: bigint; value: { owner: string; data: Uint8Array } | null }>;
}

/**
 * The read keys of a presented payment, which `reference` returns: the network; the transaction id once the message is
 * signed in its first slot; the digest of the message the payer signed, the payment presented compared whole, absent
 * where the payment was presented as a transaction alone; the buyer's account, which the search pages and whose
 * signature is the act's; H as the presented payment carries it, which the search looks for; the option's payee, the
 * key of the read's two party tests; the fee payer; and what bounds the message's life: its recent blockhash, or the
 * durable nonce it uses.
 */
export interface SvmRef {
  network: SolanaNetwork;
  transaction?: string;
  digest?: Hex;
  payer: string;
  h: AtrHash;
  payee: string;
  feePayer?: string;
  /** The recent blockhash; absent for a durable-nonce message and for a transaction alone. */
  blockhash?: string;
  /** Present exactly when the message uses a durable nonce. */
  nonce?: SvmNonce;
}

/**
 * The search's handle, which a `pending` answer returns and the next call takes: `before`, the signature below which
 * the buyer's account has range left to read; `head`, the newest signature an earlier pass read, so the next pass reads
 * the head down to it; `met`, the signatures of the transactions carrying H an earlier pass met that the answer rests
 * on, each a transaction that consumed the value or one the payer signed, other than those the caller gave, which the
 * next pass looks up by signature, since the ranges it resumes no longer list them; and `validAt`, the context slot of
 * the first `isBlockhashValid` answer of `true` at `confirmed`, as a decimal string, which bounds the blockhash's own
 * slot from above.
 */
export interface SvmCursor {
  readonly before?: string;
  readonly head?: string;
  readonly met?: readonly string[];
  readonly validAt?: string;
}

/** What a Solana status read takes with the reference and the reader. */
export type SvmQuery = StatusQuery<SvmRef, bigint, SvmMark, SvmCursor>;

/**
 * The place of the instruction a transfer was read from, in this family's spelling: its index among the message's
 * top-level instructions, a number; for an inner instruction, the index of the top-level instruction it ran under and
 * its place among that one's inner instructions as `meta.innerInstructions` gives them, the string `"<index>.<place>"`.
 */
function placeOf(instruction: number, inner?: number): number | string {
  return inner === undefined ? instruction : `${instruction}.${inner}`;
}

/**
 * A Solana settlement read, as the profile `read-status` answers it, the position a slot and the one mark `finalized`.
 * A `settled` answer states `presented`: `yes` where the landed message is the one the reference holds, by its digest,
 * or, for a payment presented as a transaction alone, where the act is that transaction; `no` otherwise; never
 * `unshown`, since the read decodes every message it settles on. A `pending` or `failed` answer that names a
 * transaction met only above the final head names no finality.
 */
export type SvmStatus = StatusAnswer<bigint, SvmMark, SvmCursor>;

/** A channel opening's read: the answer `svmStatus` gives. */
export type ChannelStatus = SvmStatus;

/**
 * The most candidates one pass of the search reads: lcp's own bound, since each candidate costs up to two
 * `getTransaction` calls, so one pass makes at most 100 lookups beside its 10 pages. A pass that meets more is not read
 * whole, and the next call resumes it.
 */
export const SVM_MAX_CANDIDATES = 50;
/**
 * Whether a run has shown the fact the search's completeness rests on: that every transaction the buyer signs is listed
 * under its account's signatures (`getSignaturesForAddress`), which no run has shown yet. Until a run shows it,
 * a search read whole proves no absence (read-status rule 25): the read answers no `failed` but `before-position`, and
 * where it would answer `failed` it answers `pending`, `search-incomplete`. A later release sets it from that run.
 */
export const SVM_SEARCH_SHOWN = false;
/** The pages of one pass, each of 1,000 signatures. */
const MAX_PAGES = 10;
const PAGE = 1000;
/**
 * The slots past the bound on the blockhash's own slot before a read of its validity can decide: the chain ends it 150
 * blocks after the blockhash's own block, and a slot is at most one block.
 */
const BLOCKHASH_SLOTS = 150n;
const NONCE_ACCOUNT_BYTES = 80;
const SLOT = /^(0|[1-9][0-9]{0,19})$/;

/** The read's ledger at a coverage: the one mark, `finalized`, above the latest head, and slots in order. */
function ledgerAt(coverage: "full" | "none"): Ledger<bigint, Reached> {
  return {
    coverage,
    final: "finalized",
    markOrder: (a, b) => REACHED.indexOf(a) - REACHED.indexOf(b),
    positionOrder: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  };
}

type Unread = { unreadable: UnreadableReason };

function isUnread(v: unknown): v is Unread {
  return typeof v === "object" && v !== null && "unreadable" in v;
}

/**
 * The reason a rejected read gives: a `ReaderError` of kind `too-large` is `too-large`, one of kind `malformed`
 * `unparseable`, and any other rejection, a timeout among them, `transport`.
 */
function rejectedAs(e: unknown): UnreadableReason {
  if (typeof e !== "object" || e === null || (e as { name?: unknown }).name !== "ReaderError") return "transport";
  const kind = (e as { kind?: unknown }).kind;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

async function call<T>(f: () => Promise<T>): Promise<T | Unread> {
  try {
    return await f();
  } catch (e) {
    return { unreadable: rejectedAs(e) };
  }
}

// ── the landed transaction ──────────────────────────────────────────────────────────────────────────────────────

function isBalances(v: unknown): boolean {
  return (
    v === undefined ||
    (Array.isArray(v) &&
      v.every(
        (b) =>
          isObject(b) &&
          Number.isInteger(b["account"]) &&
          typeof b["mint"] === "string" &&
          typeof b["owner"] === "string",
      ))
  );
}

function isLanded(v: unknown): v is SvmLanded {
  if (!isObject(v)) return false;
  const l = v as unknown as SvmLanded;
  return (
    l.wire instanceof Uint8Array &&
    "err" in l &&
    (l.slot === undefined || typeof l.slot === "bigint") &&
    isObject(l.loaded) &&
    Array.isArray(l.loaded.writable) &&
    Array.isArray(l.loaded.readonly) &&
    Array.isArray(l.inner) &&
    l.inner.every(
      (x) =>
        Number.isInteger(x?.index) &&
        Number.isInteger(x.program) &&
        Array.isArray(x.accounts) &&
        x.accounts.every((a: unknown) => Number.isInteger(a)) &&
        x.data instanceof Uint8Array,
    ) &&
    isBalances(l.pre) &&
    isBalances(l.post)
  );
}

/** A landed transaction decoded: the transaction, every key its instructions may index, and its signers. */
interface Opened {
  tx: SvmTx;
  keys: readonly string[];
  signers: readonly string[];
}

/**
 * A landed transaction's wire, decoded, with every key its instructions may index, in the runtime's order: the static
 * keys, then the addresses its lookup tables loaded, writable, then read-only (`meta.loadedAddresses`). Null when the
 * wire does not decode, when `loaded` does not hold 32-byte keys in exactly the numbers the message's lookups name, or
 * when a loaded key repeats a static or another loaded key, which the runtime refuses (`AccountLoadedTwice`).
 */
export function decodeLanded(landed: SvmLanded): Opened | null {
  const d = decode(landed.wire);
  if (isRefusal(d)) return null;
  const { writable, readonly } = landed.loaded;
  const isKeyList = (list: readonly unknown[], n: number) =>
    list.length === n && list.every((k) => k instanceof Uint8Array && k.length === 32);
  if (!isKeyList(writable, d.loads.writable) || !isKeyList(readonly, d.loads.readonly)) return null;
  const keys = [...d.keys, ...writable, ...readonly].map(keyString);
  if (new Set(keys).size !== keys.length) return null;
  const { requiredSignatures, loads: _, lookups: __, ...tx } = d;
  return { tx, keys, signers: keys.slice(0, requiredSignatures) };
}

/** A u64 little-endian at `at` of `data`, or null where the data is too short. */
function u64At(data: Uint8Array, at: number): bigint | null {
  if (data.length < at + 8) return null;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(at, true);
}

/** The owner and mint a token account has by the transaction's token balances, after then before. */
function balanceOf(landed: SvmLanded, account: number): { mint?: string; owner?: string } {
  const all = [...(landed.post ?? []), ...(landed.pre ?? [])].filter((b) => b.account === account);
  const mint = all.find((b) => b.mint !== "")?.mint;
  const owner = all.find((b) => b.owner !== undefined)?.owner;
  return { ...(mint === undefined ? {} : { mint }), ...(owner === undefined ? {} : { owner }) };
}

/** A transfer the buyer's account made, as read: from a token account it owns, or by System `transfer` from it. */
interface Transfer extends Moved {
  readonly fromBuyer: boolean;
}

/**
 * Every Token or Token-2022 `TransferChecked` (12) or `Transfer` (3), and every System `transfer` (2), top-level or
 * inner, with its place. A token transfer is the buyer's where its source's owner, by the token balances, is the buyer,
 * or, where the balances name no owner, its authority is; its `to` is its destination's owner by the balances, else the
 * destination. A System transfer is the buyer's where its source is the buyer.
 */
function transfersOf(o: Opened, landed: SvmLanded, buyer: string, transaction: string): Transfer[] {
  const out: Transfer[] = [];
  const places: { instruction: number; inner?: number; program: number; accounts: readonly number[]; data: Uint8Array }[] = [
    ...o.tx.instructions.map((ix, i) => ({ instruction: i, program: ix.program, accounts: ix.accounts, data: ix.data })),
  ];
  const seenPerIndex = new Map<number, number>();
  for (const x of landed.inner) {
    const n = seenPerIndex.get(x.index) ?? 0;
    seenPerIndex.set(x.index, n + 1);
    places.push({ instruction: x.index, inner: n, program: x.program, accounts: x.accounts, data: x.data });
  }
  for (const p of places) {
    const program = o.keys[p.program];
    const at = { transaction, place: placeOf(p.instruction, p.inner) };
    if ((program === TOKEN || program === TOKEN_2022) && (p.data[0] === 12 || p.data[0] === 3)) {
      const checked = p.data[0] === 12;
      const [source, second, third, fourth] = p.accounts;
      const destination = checked ? third : second;
      const authority = checked ? fourth : third;
      const amount = u64At(p.data, 1);
      if (source === undefined || destination === undefined || authority === undefined || amount === null) continue;
      const from = balanceOf(landed, source);
      const to = balanceOf(landed, destination);
      const fromBuyer = from.owner !== undefined ? from.owner === buyer : o.keys[authority] === buyer;
      const mint = (checked ? o.keys[second!] : undefined) ?? to.mint ?? from.mint ?? "";
      const destKey = o.keys[destination] ?? "";
      out.push({
        asset: mint,
        amount: amount.toString(),
        to: to.owner ?? destKey,
        ...at,
        fromBuyer,
      });
    } else if (program === SYSTEM && p.data.length >= 12 && p.data[0] === 2 && p.data[1] === 0 && p.data[2] === 0 && p.data[3] === 0) {
      const [from, to] = p.accounts;
      const lamports = u64At(p.data, 4);
      if (from === undefined || to === undefined || lamports === null) continue;
      out.push({ asset: "sol", amount: lamports.toString(), to: o.keys[to] ?? "", ...at, fromBuyer: o.keys[from] === buyer });
    }
  }
  return out;
}

/** The transaction's top-level payment-channels instructions. */
function channelIxs(o: Opened) {
  return o.tx.instructions.map((ix, i) => ({ ix, i })).filter(({ ix }) => o.keys[ix.program] === PAYMENT_CHANNELS);
}

/**
 * A channel `open`'s deposit and distribution: `01` ‖ salt u64 ‖ deposit u64 ‖ gracePeriod u32 ‖ openSlot u64 ‖ count
 * u32 ‖ (recipient 32 ‖ bps u16) per recipient; its accounts name the payer first, the mint fourth and the channel
 * sixth (`openInstructionData`, `buildChannelMessage`). Null where the instruction is no `open` of that form.
 */
function openOf(o: Opened, ix: { program: number; accounts: readonly number[]; data: Uint8Array }) {
  const d = ix.data;
  if (d[0] !== 1 || d.length < 33 || ix.accounts.length < 6) return null;
  const deposit = u64At(d, 9)!;
  const count = new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(29, true);
  if (d.length < 33 + 34 * count) return null;
  const recipients: string[] = [];
  for (let r = 0; r < count; r++) recipients.push(keyString(d.subarray(33 + 34 * r, 65 + 34 * r)));
  return {
    payer: o.keys[ix.accounts[0]!] ?? "",
    mint: o.keys[ix.accounts[3]!] ?? "",
    channel: o.keys[ix.accounts[5]!] ?? "",
    deposit,
    recipients,
  };
}

/** The H the one top-level Memo holding an LCP string carries, where exactly one does; else null. */
function carriedH(tx: SvmTx): AtrHash | null {
  const found: AtrHash[] = [];
  for (const data of memoData(tx)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      continue;
    }
    const h = fromLcpString(text);
    if (h !== null) found.push(h);
  }
  return found.length === 1 ? found[0]! : null;
}

/** The durable nonce account the message's first instruction, `AdvanceNonceAccount`, advances, or null. */
function advancedNonce(o: Opened): string | null {
  const first = o.tx.instructions[0];
  if (first === undefined || o.keys[first.program] !== SYSTEM) return null;
  const d = first.data;
  if (!(d.length >= 4 && d[0] === 4 && d[1] === 0 && d[2] === 0 && d[3] === 0)) return null;
  const account = first.accounts[0];
  return account === undefined ? null : (o.keys[account] ?? null);
}

/** Which act a pairing's read asks about: a transfer, or a payment channel's opening. */
export type SvmActKind = "transfer" | "channel";

/** A landed transaction classified against the reference, the option's payee and the pairing's act. */
type Classified = Seen<bigint, Reached>;

/**
 * The profile's facts of one landed transaction, from its data alone: its result by `meta.err`; whether it carries H
 * (exactly one top-level Memo holds an LCP string, and it is H's); its signer against the reference's payer and the
 * option's payee (`payer` where the buyer signed it and is not the payee, `payee` where the payee signed it, else
 * `other`); its kind (a transfer pairing's act holds no payment-channels instruction, a channel pairing's exactly one
 * `open`); the account it names (`payee` where a transfer of the buyer's reaches the payee or an `open`'s distribution
 * holds the payee, `other` where it moves value elsewhere, `none` where it moves nothing), for a failed result the
 * destination of what the payer signed, its top-level instructions, since that result moved nothing; whether it consumed the
 * act's single-use value (the same signed message, or the reference's durable nonce advanced); whether it is an act the
 * caller gave by its reference; whether its message is the one presented (by its digest, or, for a payment presented
 * as a transaction alone, by that transaction); what moved, each transfer by its transaction and place, none for a failed result.
 */
async function classify(
  kind: SvmActKind,
  ref: SvmRef,
  query: SvmQuery,
  signature: string,
  landed: SvmLanded,
  mark: Reached,
  o: Opened,
): Promise<Classified> {
  const digest = await svmDigest(o.tx);
  const channels = channelIxs(o);
  const open = channels.length === 1 ? openOf(o, channels[0]!.ix) : null;
  // A failed result moved nothing: the account it names is the destination in what the payer signed, its top-level
  // instructions, and what moved is empty.
  const failed = landed.err !== null && landed.err !== undefined;
  let moved: Moved[];
  let account: Classified["account"];
  if (kind === "channel") {
    moved =
      open === null || failed
        ? []
        : [
            {
              asset: open.mint,
              amount: open.deposit.toString(),
              to: open.recipients.includes(ref.payee) ? ref.payee : (open.recipients[0] ?? open.channel),
              contract: open.channel,
              ...(open.recipients.length === 0 ? {} : { beneficiary: open.recipients.includes(ref.payee) ? ref.payee : open.recipients[0]! }),
              transaction: signature,
              place: placeOf(channels[0]!.i),
            },
          ];
    account =
      open === null || open.recipients.length === 0 ? "none" : open.recipients.includes(ref.payee) ? "payee" : "other";
  } else {
    const transfers = transfersOf(o, failed ? { ...landed, inner: [] } : landed, ref.payer, signature).filter((t) => t.fromBuyer);
    moved = failed ? [] : transfers.map(({ fromBuyer: _, ...m }) => m);
    account = transfers.length === 0 ? "none" : transfers.some((t) => t.to === ref.payee) ? "payee" : "other";
  }
  const payerSigned = o.signers.includes(ref.payer) && ref.payer !== ref.payee;
  const party = payerSigned ? "payer" : o.signers.includes(ref.payee) ? "payee" : "other";
  const sameKind = kind === "channel" ? open !== null : channels.length === 0;
  const nonce = ref.nonce;
  const consumed =
    (ref.digest !== undefined ? digest === ref.digest.toLowerCase() : signature === ref.transaction) ||
    (nonce !== undefined && advancedNonce(o) === nonce.account && keyString(o.tx.blockhash) === nonce.value);
  const given = (query.others ?? []).some(
    (x) =>
      isObject(x) &&
      "ref" in x &&
      isObject(x.ref) &&
      ((typeof x.ref.digest === "string" && x.ref.digest.toLowerCase() === digest) || x.ref.transaction === signature),
  );
  // Past the fee payer the signers are ordered by role and address (@solana/kit 8.4.0
  // `transaction-messages/src/compile/v0/accounts.ts:225-236`), so their order says nothing of who signed H: another
  // signer is named only where one alone signed beside the fee payer, or the fee payer signed alone.
  const others = o.signers.slice(1);
  const signer = payerSigned ? ref.payer : party === "payee" ? ref.payee : others.length <= 1 ? (others[0] ?? o.signers[0]) : undefined;
  return {
    transaction: signature,
    ...(landed.slot === undefined ? {} : { position: landed.slot }),
    mark,
    result: failed ? "failed" : "succeeded",
    consumed,
    carries: carriedH(o.tx)?.toLowerCase() === ref.h.toLowerCase(),
    party,
    kind: sameKind ? "same" : "other",
    account,
    ...(given ? { given: true } : {}),
    // The payment presented, compared whole by its message's digest; where it was presented as a transaction alone, that
    // transaction is what was presented (read-status rule 13).
    presented: (ref.digest !== undefined ? digest === ref.digest.toLowerCase() : signature === ref.transaction) ? "yes" : "no",
    moved,
    ...(signer === undefined ? {} : { signer }),
  };
}

/**
 * One transaction looked up at `finalized`, then at the latest head (`confirmed`): landed, at the mark or found only
 * above the final head (`head`); `missing` where neither lookup finds it; `undecodable` where the wire or its loaded
 * keys are out of the documented form; or unreadable.
 */
async function lookUp(
  reader: SvmReader,
  signature: string,
): Promise<{ landed: SvmLanded; mark: Reached; o: Opened } | { missing: true } | { undecodable: true } | Unread> {
  for (const commitment of ["finalized", "confirmed"] as const) {
    const answer = await call(() => reader.transaction(signature, commitment));
    if (isUnread(answer)) return answer;
    if (notFoundPoint(answer, "slot") !== undefined) continue;
    if (!isLanded(answer)) return { undecodable: true };
    const o = decodeLanded(answer);
    return o === null ? { undecodable: true } : { landed: answer, mark: commitment === "finalized" ? "finalized" : "head", o };
  }
  return { missing: true };
}

// ── the search for H ────────────────────────────────────────────────────────────────────────────────────────────

interface Searched {
  seen: Classified[];
  whole: boolean;
  /** The handle to resume from where the pass was not read whole, without the blockhash's bound. */
  cursor: SvmCursor;
  /** Each candidate whose answer did not decode, with the handle that resumes the search at it. */
  undecoded: { transaction: string; at: SvmCursor }[];
}

/**
 * The search for H: the buyer's own account's signatures at `confirmed`, which lists the finalized ones too, newest
 * first, evaluated at or past `confirmedSlot`, from the head down to and including the position given (or to the
 * account's first signature where none is given), in two ranges where the handle holds them: the head down to its
 * `head`, then its `before` down. A signature is a candidate where its memo rendering holds H's LCP string, case
 * ignored; each is looked up and classified. At most 10 pages and `SVM_MAX_CANDIDATES` candidates; a pass that meets
 * either bound, a candidate neither lookup finds, or one whose answer does not decode, is not read whole, and its
 * handle holds the range left, at the first such candidate, with the transactions met that the answer rests on (`met`),
 * which the next pass looks up by signature before its ranges, so a pass that meets one still advances.
 */
async function search(
  kind: SvmActKind,
  ref: SvmRef,
  reader: SvmReader,
  query: SvmQuery,
  confirmedSlot: bigint,
  handle: SvmCursor,
): Promise<Searched | Unread> {
  const carrier = toLcpString(ref.h);
  const seen: Classified[] = [];
  let pages = 0;
  let candidates = 0;
  let newest: string | undefined;
  let missing: { prior: string | undefined } | undefined;
  const undecodable: { transaction: string; prior: string | undefined }[] = [];
  let stop: string | undefined;
  let whole = true;
  // The transactions an earlier pass met that the answer rests on, looked up again by signature; one neither lookup
  // finds, or whose answer does not decode, holds the pass and stays in the handle.
  const kept: string[] = [];
  for (const signature of handle.met ?? []) {
    const found = await lookUp(reader, signature);
    if (isUnread(found)) return found;
    if ("missing" in found || "undecodable" in found) {
      whole = false;
      kept.push(signature);
      continue;
    }
    seen.push(await classify(kind, ref, query, signature, found.landed, found.mark, found.o));
  }
  const ranges: { before?: string; until?: string }[] =
    handle.head === undefined
      ? [{}]
      : [{ until: handle.head }, ...(handle.before === undefined ? [] : [{ before: handle.before }])];
  ranges: for (const [r, range] of ranges.entries()) {
    let before = range.before;
    for (;;) {
      if (pages === MAX_PAGES) {
        whole = false;
        stop = before;
        break ranges;
      }
      pages++;
      const list = await call(() =>
        reader.signatures(ref.payer, {
          ...(before === undefined ? {} : { before }),
          ...(range.until === undefined ? {} : { until: range.until }),
          limit: PAGE,
          commitment: "confirmed",
          minContextSlot: confirmedSlot,
        }),
      );
      if (isUnread(list)) return list;
      if (!Array.isArray(list) || list.length > PAGE) return { unreadable: "unparseable" };
      let ended = list.length < PAGE;
      for (const entry of list) {
        if (!isObject(entry) || typeof entry.signature !== "string" || typeof entry.slot !== "bigint") {
          return { unreadable: "unparseable" };
        }
        if (entry.memo !== null && typeof entry.memo !== "string") return { unreadable: "unparseable" };
        if (r === 0) newest ??= entry.signature;
        // The pages end below the position given; a candidate already listed there is read all the same, since it
        // can only answer `before-position`.
        if (query.after !== undefined && entry.slot < query.after) ended = true;
        const prior = before;
        before = entry.signature;
        if (entry.memo === null || !entry.memo.toLowerCase().includes(carrier)) continue;
        if (seen.some((s) => s.transaction === entry.signature)) continue;
        if (++candidates > SVM_MAX_CANDIDATES) {
          whole = false;
          stop = prior;
          break ranges;
        }
        const found = await lookUp(reader, entry.signature);
        if (isUnread(found)) return found;
        if ("missing" in found) {
          whole = false;
          missing ??= { prior };
          continue;
        }
        if ("undecodable" in found) {
          undecodable.push({ transaction: entry.signature, prior });
          continue;
        }
        seen.push(await classify(kind, ref, query, entry.signature, found.landed, found.mark, found.o));
      }
      if (ended) break;
    }
  }
  // A handle that resumes at the item listed after `prior`: the head down to the newest signature this pass listed, then
  // the range below `prior`; from the head where no signature precedes the item. Each carries the transactions met that
  // the answer rests on, a consumer of the value or one the payer signed, other than those the caller gave, which the
  // next pass looks up by signature: a transaction that decides nothing, the agreement the caller gave among them,
  // never sends the next pass back to the head.
  const givenTx = new Set(
    (query.others ?? []).flatMap((o) => (isObject(o) && "transaction" in o && typeof o.transaction === "string" ? [o.transaction] : [])),
  );
  const met = [
    ...kept,
    ...seen.filter((s) => (s.consumed || s.party === "payer") && s.given !== true && !givenTx.has(s.transaction)).map((s) => s.transaction),
  ];
  const withMet = (c: SvmCursor): SvmCursor => (met.length === 0 ? c : { ...c, met });
  const head = newest ?? handle.head;
  const resumeAt = (prior: string | undefined): SvmCursor =>
    withMet(prior === undefined ? {} : { ...(head === undefined ? {} : { head }), before: prior });
  const cursor: SvmCursor = whole
    ? {}
    : missing !== undefined
      ? resumeAt(missing.prior)
      : withMet({ ...(head === undefined ? {} : { head }), ...(stop === undefined ? {} : { before: stop }) });
  return {
    seen,
    whole,
    cursor,
    undecoded: undecodable.map((u) => ({ transaction: u.transaction, at: resumeAt(u.prior) })),
  };
}

// ── the single-use value ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the durable nonce the reference records is spent: the nonce account read at `finalized` holds another value,
 * is no initialized current-version nonce account, or is gone. A legacy-version account is not read as spent.
 */
async function nonceSpent(nonce: SvmNonce, reader: SvmReader, commitment: SvmCommitment): Promise<boolean | Unread> {
  const read = await call(() => reader.account(nonce.account, commitment));
  if (isUnread(read)) return read;
  if (!isObject(read) || typeof read.slot !== "bigint" || !("value" in read)) return { unreadable: "unparseable" };
  if (read.value === null) return true;
  const { owner, data } = read.value;
  if (owner !== SYSTEM || !(data instanceof Uint8Array) || data.length !== NONCE_ACCOUNT_BYTES) return true;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(4, true) !== 1) return true;
  const version = view.getUint32(0, true);
  if (version === 0) return false;
  if (version !== 1) return true;
  return keyString(data.subarray(40, 72)) !== nonce.value;
}

// ── the blockhash's lapse ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Where the blockhash has lapsed: at `finalized` where `isBlockhashValid` read there answers `false` at a context slot at
 * or past `bound`, 150 past the slot that bounds the blockhash's own from above; else at the latest head where the same
 * read at `confirmed` does; else nowhere. A commitment is read only once its slot has reached `bound`, and a slot count
 * alone decides nothing: a skipped slot adds no block, so a blockhash can still be valid 150 slots past its own.
 */
async function lapsedAt(
  blockhash: string,
  reader: SvmReader,
  bound: bigint,
  slots: { finalized: bigint; confirmed: bigint },
): Promise<Reached | undefined | Unread> {
  for (const commitment of ["finalized", "confirmed"] as const) {
    if (slots[commitment] < bound) continue;
    const v = await call(() => reader.blockhashValid(blockhash, commitment));
    if (isUnread(v)) return v;
    if (!isObject(v) || typeof v.valid !== "boolean" || typeof v.slot !== "bigint") return { unreadable: "unparseable" };
    if (!v.valid && v.slot >= bound) return commitment === "finalized" ? "finalized" : "head";
  }
  return undefined;
}

// ── status ──────────────────────────────────────────────────────────────────────────────────────────────────────

function isRef(ref: unknown): ref is SvmRef {
  if (!isObject(ref)) return false;
  const r = ref as Partial<SvmRef>;
  return (
    isSolanaNetwork(r.network) &&
    isKey(r.payer) &&
    isKey(r.payee) &&
    typeof r.h === "string" &&
    /^0x[0-9a-f]{64}$/.test(r.h) &&
    (r.transaction === undefined || isSignature(r.transaction)) &&
    (r.digest === undefined || (typeof r.digest === "string" && /^0x[0-9a-fA-F]{64}$/.test(r.digest))) &&
    (r.blockhash === undefined || isKey(r.blockhash)) &&
    (r.nonce === undefined || (isObject(r.nonce) && isKey(r.nonce.account) && isKey(r.nonce.value))) &&
    (r.digest !== undefined || r.transaction !== undefined)
  );
}

function isCursor(c: unknown): c is SvmCursor {
  return (
    isObject(c) &&
    (c["before"] === undefined || isSignature(c["before"])) &&
    (c["head"] === undefined || isSignature(c["head"])) &&
    (c["met"] === undefined ||
      (Array.isArray(c["met"]) && c["met"].length <= SVM_MAX_CANDIDATES && c["met"].every((m: unknown) => isSignature(m)))) &&
    (c["validAt"] === undefined || (typeof c["validAt"] === "string" && SLOT.test(c["validAt"])))
  );
}

/** A query that is not an object of a known act and mark, with a slot, a handle and a list where it gives them. */
function isQuery(query: unknown): query is SvmQuery {
  if (!isObject(query)) return false;
  const q = query as Partial<SvmQuery>;
  return (
    (q.act === "payment" || q.act === "agreement") &&
    q.finality === "finalized" &&
    (q.after === undefined || (typeof q.after === "bigint" && q.after >= 0n)) &&
    (q.search === undefined || isCursor(q.search)) &&
    (q.others === undefined || Array.isArray(q.others))
  );
}

const unreadable = (reason: UnreadableReason): SvmStatus => ({ state: "unreadable", reason, foreign: [] });

/**
 * What the read observed, in the profile's terms. The node shows its history where its first available block is at or
 * below the position given (at 0 where none is given). The single-use value is the signed message: consumed where a
 * transaction found carries the same message or advanced the reference's durable nonce, or the nonce account no longer
 * holds the value; unconsumed only from the lookup of the reference's transaction on a node that holds the history, or
 * from the search read whole; lapsed, for a blockhash, where `isBlockhashValid` answers `false` at a slot at least 150
 * past the context slot of the first answer of `true` at `confirmed` (the handle's `validAt`), read at `finalized` and,
 * below it, at the latest head (`confirmed`, no mark) (`lapsedAt`); never lapsed for a durable nonce. A transaction
 * alone, or a node that does not hold the history, reads no value.
 */
async function observe(
  kind: SvmActKind,
  ref: SvmRef,
  reader: SvmReader,
  query: SvmQuery,
): Promise<Facts<bigint, Reached, SvmCursor> | Unread> {
  const first = await call(() => reader.firstAvailableBlock());
  if (isUnread(first)) return first;
  if (typeof first !== "bigint") return { unreadable: "unparseable" };
  const history = query.after === undefined ? first === 0n : first <= query.after;
  const handle: SvmCursor = query.search ?? {};
  let validAt = handle.validAt === undefined ? undefined : BigInt(handle.validAt);
  if (ref.blockhash !== undefined && ref.nonce === undefined && ref.digest !== undefined && validAt === undefined) {
    const v = await call(() => reader.blockhashValid(ref.blockhash!, "confirmed"));
    if (isUnread(v)) return v;
    if (!isObject(v) || typeof v.valid !== "boolean" || typeof v.slot !== "bigint") return { unreadable: "unparseable" };
    if (v.valid) validAt = v.slot;
  }
  const finalSlot = await call(() => reader.slot("finalized"));
  if (isUnread(finalSlot)) return finalSlot;
  const headSlot = await call(() => reader.slot("confirmed"));
  if (isUnread(headSlot)) return headSlot;
  if (typeof finalSlot !== "bigint" || typeof headSlot !== "bigint") return { unreadable: "unparseable" };

  const found = await search(kind, ref, reader, query, headSlot, handle);
  if (isUnread(found)) return found;
  const seen = [...found.seen];
  let named: "found" | "missing" | "none" = "none";
  if (ref.transaction !== undefined) {
    const own = seen.find((s) => s.transaction === ref.transaction);
    if (own !== undefined) named = "found";
    else {
      const looked = await lookUp(reader, ref.transaction);
      if (isUnread(looked)) return looked;
      if ("undecodable" in looked) return { unreadable: "unparseable" };
      if ("missing" in looked) named = "missing";
      else {
        named = "found";
        seen.push(await classify(kind, ref, query, ref.transaction, looked.landed, looked.mark, looked.o));
      }
    }
  }

  // The value at the final mark and at the latest head: consumed where a transaction found carries the same message or
  // advanced the durable nonce (at `finalized`, or at either mark), or the nonce account read there no longer holds it.
  let value: Facts<bigint, Reached>["value"];
  if (ref.digest !== undefined && history) {
    let atFinal = seen.some((s) => s.consumed && s.mark === "finalized");
    let atHead = seen.some((s) => s.consumed);
    let known = atHead || named === "missing" || found.whole;
    if (ref.nonce !== undefined) {
      const final = await nonceSpent(ref.nonce, reader, "finalized");
      if (isUnread(final)) return final;
      const head = await nonceSpent(ref.nonce, reader, "confirmed");
      if (isUnread(head)) return head;
      atFinal ||= final;
      atHead ||= head || final;
      known = true;
    }
    if (known) {
      const bound = ref.nonce !== undefined || validAt === undefined ? undefined : validAt + BLOCKHASH_SLOTS;
      const lapsed =
        atHead || bound === undefined || ref.blockhash === undefined
          ? undefined
          : await lapsedAt(ref.blockhash, reader, bound, { finalized: finalSlot, confirmed: headSlot });
      if (isUnread(lapsed)) return lapsed;
      value = {
        consumed: atFinal,
        lapsed: lapsed !== undefined,
        mark: lapsed ?? "finalized",
        head: { consumed: atHead },
      };
    }
  }
  // A search not read whole returns its handle, `{}` where the next pass reads again from the head; one read whole
  // returns a handle only to keep the blockhash's bound.
  const at: SvmCursor | undefined = !found.whole
    ? { ...found.cursor, ...(validAt === undefined ? {} : { validAt: validAt.toString() }) }
    : validAt === undefined
      ? undefined
      : { validAt: validAt.toString() };
  // `decide` settles on the first act in this order: the payment presented, then the earliest.
  const ordered = [...seen].sort(
    (x, y) =>
      Number(y.consumed) - Number(x.consumed) ||
      (x.position === undefined ? 1 : y.position === undefined ? -1 : x.position < y.position ? -1 : x.position > y.position ? 1 : 0),
  );
  const withBound = (c: SvmCursor): SvmCursor => ({ ...c, ...(validAt === undefined ? {} : { validAt: validAt.toString() }) });
  return {
    seen: ordered,
    ...(value === undefined ? {} : { value }),
    search: { whole: found.whole, ...(at === undefined ? {} : { at }) },
    history,
    ...(found.undecoded.length === 0
      ? {}
      : { undecoded: found.undecoded.map((u) => ({ transaction: u.transaction, at: withBound(u.at) })) }),
  };
}

/**
 * What the read observed at coverage `none`, where it makes no search: the transaction the reference names, looked up
 * at `finalized` and at the latest head, is the act whether or not it carries H. The value is the signed message,
 * consumed where that transaction landed, whatever its result; where the lookup finds nothing the read holds no value,
 * and answers `not-found` on a node that holds the history. A named transaction whose answer does not decode is an
 * item the read could not decode.
 */
async function observeNamed(
  kind: SvmActKind,
  ref: SvmRef,
  reader: SvmReader,
  query: SvmQuery,
): Promise<Facts<bigint, Reached, SvmCursor> | Unread> {
  const first = await call(() => reader.firstAvailableBlock());
  if (isUnread(first)) return first;
  if (typeof first !== "bigint") return { unreadable: "unparseable" };
  const history = query.after === undefined ? first === 0n : first <= query.after;
  const looked = await lookUp(reader, ref.transaction!);
  if (isUnread(looked)) return looked;
  // The lookup is the search at coverage `none`: an answer that does not decode holds it at the lookup, read again.
  if ("undecodable" in looked) return { seen: [], search: { whole: true }, history, undecoded: [{ transaction: ref.transaction!, at: {} }] };
  if ("missing" in looked) return { seen: [], search: { whole: true }, history };
  return {
    seen: [await classify(kind, ref, query, ref.transaction!, looked.landed, looked.mark, looked.o)],
    value: { consumed: looked.mark === "finalized", lapsed: false, mark: "finalized", head: { consumed: true } },
    search: { whole: true },
    history,
  };
}

/** The answer in the read's terms: one that names a transaction met only above the final head names no finality. */
function atMark(answer: StatusAnswer<bigint, Reached, SvmCursor>): SvmStatus {
  if (!("finality" in answer) || answer.finality !== "head") return answer as SvmStatus;
  const { finality: _, ...rest } = answer;
  return rest as SvmStatus;
}

/**
 * The read of a Solana pairing's act, by the profile `read-status`, at the one mark `finalized`. A ref, reader or query
 * of the wrong form (a finality other than `finalized` among them) is `unreadable`, `unparseable`, and a reader for
 * another network `chain-mismatch`, each with nothing read; a rejected call is unreadable by `rejectedAs`. At coverage
 * `full` the calls are: `firstAvailableBlock`; `isBlockhashValid` at `confirmed` until one answers `true`; `getSlot` at
 * `finalized` and at the latest head; the search's pages and its candidates' lookups; the named transaction's lookup;
 * once a slot there is 150 past that answer's, `isBlockhashValid` at `finalized`, then at `confirmed`; and, for a
 * durable nonce, the nonce account. Until a run shows the fact the search's completeness rests on (`SVM_SEARCH_SHOWN`),
 * a `failed` but `before-position` is answered `pending`, `search-incomplete`. At coverage `none` (`observeNamed`) the
 * calls are `firstAvailableBlock` and the named transaction's lookup, and the read makes no search.
 */
export async function svmRead(
  kind: SvmActKind,
  ref: SvmRef,
  reader: SvmReader,
  query: SvmQuery,
  coverage: "full" | "none" = "full",
): Promise<SvmStatus> {
  if (!isQuery(query) || !isRef(ref)) return unreadable("unparseable");
  if (coverage === "none" && ref.transaction === undefined) return unreadable("unparseable");
  if (!isObject(reader) || !isSolanaNetwork(reader.network)) return unreadable("unparseable");
  if (reader.network !== ref.network) return unreadable("chain-mismatch");
  const facts = coverage === "full" ? await observe(kind, ref, reader, query) : await observeNamed(kind, ref, reader, query);
  if (isUnread(facts)) return unreadable(facts.unreadable);
  const answer = atMark(decide(facts, query as StatusQuery<SvmRef, bigint, Reached, SvmCursor>, ledgerAt(coverage)));
  if (coverage === "full" && !SVM_SEARCH_SHOWN && answer.state === "failed" && answer.reason !== "before-position") {
    const at = facts.search.at;
    return { state: "pending", reason: "search-incomplete", ...(at === undefined ? {} : { search: at }), foreign: answer.foreign };
  }
  return answer;
}

/** The read of a transfer pairing (`x402/exact/solana`, the three MPP charges, `mpp/subscription/solana`). */
export function svmStatus(ref: SvmRef, reader: SvmReader, query: SvmQuery): Promise<SvmStatus> {
  return svmRead("transfer", ref, reader, query);
}

/** The read of a channel opening that carries H (`x402/upto/solana`, `x402/batch-settlement/solana`, `mpp/session/solana/memo`). */
export function svmChannelStatus(ref: SvmRef, reader: SvmReader, query: SvmQuery): Promise<ChannelStatus> {
  return svmRead("channel", ref, reader, query);
}

/**
 * The read of a named channel opening at coverage `none` (`mpp/session/solana/stock`): the opening the reference names
 * is the act, whether or not it carries H, and the read makes no search.
 */
export function svmOpeningStatus(ref: SvmRef, reader: SvmReader, query: SvmQuery): Promise<ChannelStatus> {
  return svmRead("channel", ref, reader, query, "none");
}

// ── the reference ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The read keys of a signed transaction: its message digest; the fee payer (static key 0); the buyer: an `open`'s
 * payer where the transaction holds one payment-channels `open`, else the first signer other than the fee payer, or
 * the fee payer where it signs alone; the fee payer's signature as the transaction id when that slot is signed; and what
 * bounds the message's life: the recent blockhash, or the durable nonce it uses. A message `staticNonce` refuses has no
 * reference.
 */
export async function svmReference(
  network: SolanaNetwork,
  tx: SvmTx,
): Promise<Omit<SvmRef, "h" | "payee"> | Refusal> {
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const keys = tx.keys.map(keyString);
  const signers = keys.slice(0, tx.signatures.length);
  const opened: Opened = { tx, keys, signers };
  const channels = channelIxs(opened);
  const open = channels.length === 1 ? openOf(opened, channels[0]!.ix) : null;
  const feePayer = keys[0]!;
  const payer = open !== null && open.payer !== "" ? open.payer : (signers.find((s) => s !== feePayer) ?? feePayer);
  const digest = await svmDigest(tx);
  const signed = tx.signatures[0]!.some((x) => x !== 0);
  const nonce = durableNonce(tx);
  return {
    network,
    ...(signed ? { transaction: keyString(tx.signatures[0]!) } : {}),
    digest,
    feePayer,
    payer,
    ...(nonce === null ? { blockhash: keyString(tx.blockhash) } : { nonce }),
  };
}

/**
 * Whether two option or challenge objects hold the same members with the same values, members compared in name order
 * and arrays in order, as canonical JSON (RFC 8785) orders them.
 */
export function sameOption(accepted: unknown, option: unknown): boolean {
  return canonical(accepted) === canonical(option);
}

/**
 * An x402 Solana payment's reference: the transaction's keys (`svmReference`), H, and the payee of `option`, the option
 * the payment answers (`x402Payee`). A presented payment whose `accepted` is not `option`, member for member, is
 * `x402/accepted-not-option`: the payment answers another option, so `option`'s payee is not its payee.
 */
export async function x402SvmReference(
  accepted: PaymentRequirements,
  tx: SvmTx,
  h: AtrHash,
  option: PaymentRequirements,
): Promise<SvmRef | Refusal> {
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameOption(accepted, option)) return refusal("x402/accepted-not-option");
  const ref = await svmReference(accepted.network as SolanaNetwork, tx);
  return isRefusal(ref) ? ref : { ...ref, h, payee };
}

/**
 * An MPP Solana payment's reference: the transaction's keys, H, and the payee of `option`, the challenge the payment
 * answers (`mppPayee`). A credential whose echoed challenge is not `option`, member for member, is
 * `mpp/challenge-not-option`.
 */
export async function mppSvmReference(
  echoed: unknown,
  network: SolanaNetwork,
  tx: SvmTx,
  h: AtrHash,
  option: MppChallenge,
): Promise<SvmRef | Refusal> {
  const payee = mppPayee(option);
  if (isRefusal(payee)) return payee;
  if (!sameOption(echoed, option)) return refusal("mpp/challenge-not-option");
  const ref = await svmReference(network, tx);
  return isRefusal(ref) ? ref : { ...ref, h, payee };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// ── recover ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Zero-party recovery: the ATR hash in the landed transaction's one memo, read by `tx`, the transaction's signature, at
 * `finalized`; `option`, the x402 option or MPP challenge the ATR's binding slot holds, must be an object, and no
 * member of it is read. A transaction that landed with an error at `finalized` is `svm/err`; one the read at
 * `confirmed` alone holds, with an error or none, is `svm/not-final`, a read to repeat, since a block not yet finalized
 * can be replaced. A landed wire that does not decode is `svm/unreadable`. An input or option that is not an object,
 * and a `tx` that is not a signature, are `svm/wrong-reader`, with nothing read. One or two calls.
 */
export async function svmRecover(
  input: RecoverInput<SolanaNetwork, PaymentRequirements | MppChallenge>,
  reader: SvmReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(input.option)) return refusal("svm/wrong-reader");
  const tx = await landedTransaction({ network: input.network, transaction: input.tx }, reader);
  if (isRefusal(tx)) return tx;
  const c = svmCarrier(tx);
  return isRefusal(c) ? c : c.h;
}

/**
 * The named transaction, landed without error at `finalized` and decoded. An error the read at `finalized` holds is
 * `svm/err`; a transaction only the read at `confirmed` holds is `svm/not-final`, with an error or none. A landed wire
 * that does not decode is `svm/unreadable`. One or two calls.
 */
export async function landedTransaction(
  ref: { network: SolanaNetwork; transaction: string },
  reader: SvmReader,
): Promise<SvmTx | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("svm/wrong-reader");
  if (!isSignature(ref.transaction)) return refusal("svm/wrong-reader");
  for (const mark of ["finalized", "confirmed"] as const) {
    const read: unknown = await call(() => reader.transaction(ref.transaction, mark));
    if (isUnread(read)) return refusal("svm/unreadable");
    if (notFoundPoint(read, "slot") !== undefined) continue;
    const answer = read as Record<string, unknown>;
    if (!isObject(read) || !(answer["wire"] instanceof Uint8Array) || !("err" in answer)) return refusal("svm/unreadable");
    if (mark === "confirmed") return refusal("svm/not-final");
    if (answer["err"] !== null && answer["err"] !== undefined) return refusal("svm/err");
    const tx = decodeSvmTx(answer["wire"]);
    return isRefusal(tx) ? refusal("svm/unreadable") : tx;
  }
  return refusal("svm/not-found");
}
