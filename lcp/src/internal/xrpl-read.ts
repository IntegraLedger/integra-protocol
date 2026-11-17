/**
 * The read of an XRPL payment, opening or channel, as the profile `read-status` answers it. A payment is found by its
 * instrument, the payer's `Account` with the signed `Sequence` or `TicketSequence`, never by a hash, which only helps
 * to look: the read takes the presented transaction by its hash, reads the instrument at the validated ledger and at
 * the current one, and searches the payer's `account_tx` from the issue ledger to the latest ledger the server serves
 * for every transaction that carries H or took the instrument. A channel at coverage `none` is found by the
 * `PaymentChannelCreate` that made its `PayChannel` entry. The public names are re-exported by `../xrpl.ts`.
 */
import { hashEquals, type AtrHash } from "../core.js";
import { isObject, normalHash } from "../fields.js";
import { isRefusal } from "../refusal.js";
import {
  decide,
  type Facts,
  type Moved,
  type OtherAct,
  type Seen,
  type Undecoded,
  type UnreadableReason,
} from "./read.js";
import {
  decodeBlob,
  isXrplNetwork,
  isXrplQuery,
  lcpMemoOf,
  mppInvoiceId,
  networkId,
  rejectedAs,
  signedBodyOf,
  signedOf,
  x402InvoiceId,
  xrplLedger,
  type XrplAmount,
  type XrplChannelEntry,
  type XrplLanded,
  type XrplLedgerName,
  type XrplNetwork,
  type XrplQuery,
  type XrplReached,
  type XrplReader,
  type XrplRef,
  type XrplServer,
  type XrplSigned,
  type XrplStatus,
  type XrplTxJson,
} from "./xrpl.js";
import { xrplChannelId } from "./xrpl-session.js";

/**
 * The most `account_tx` pages one read takes: lcp's own bound on the calls a read makes. A search with pages left
 * answers `pending`, `search-incomplete`, with the ledger the next read resumes from.
 */
export const XRPL_MAX_PAGES = 16;

/**
 * Whether a run has shown the fact the search for H, and a channel's search for its create, rest on: that `account_tx`
 * lists, for every ledger it answers for, each transaction of the account, a delegated payment and an inner `Batch`
 * transaction among them. Not at this release, as each XRPL pairing's profile states: a search read whole proves no
 * absence, so where the read would answer `failed`, `instrument-unused`, `instrument-consumed` or `transaction-failed`,
 * it answers `pending`, `search-incomplete`, the search's position the ledger after the last it read; and where the
 * stock session's channel read would answer `failed`, `before-position` because the search holds no create of a
 * channel the ledger shows, it answers `pending`, `search-incomplete`, its position held where that search began. A
 * payment on these pairings that lapsed, or whose sequence number or ticket another transaction took, and a channel
 * created before the position, stay pending until that run.
 */
const SEARCH_SHOWN = false;

/** The `failed` reasons whose answer rests on the search for H read whole, which its gate holds. */
const GATED: ReadonlySet<string> = new Set(["instrument-unused", "instrument-consumed", "transaction-failed"]);

/** The form in which a pairing carries H: x402's `InvoiceID` digest, MPP's `InvoiceID`, or an opening's one LCP memo. */
export type XrplForm = "x402" | "mpp" | "memo";

const TYPE_OF: { readonly [f in XrplForm]: string } = { x402: "Payment", mpp: "Payment", memo: "PaymentChannelCreate" };
const HASH256 = /^[0-9A-Fa-f]{64}$/;
const RANGE = /^([0-9]{1,10})(?:-([0-9]{1,10}))?$/;

/** A read that established nothing, with its reason. */
class Unreadable {
  constructor(readonly reason: UnreadableReason) {}
}

/** A reader's call, whose rejection is unreadable by `rejectedAs`. */
async function call<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw new Unreadable(rejectedAs(e));
  }
}

function unparseable(): never {
  throw new Unreadable("unparseable");
}

const isIndex = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** `server_info`, held to its form. */
async function serverOf(reader: XrplReader): Promise<XrplServer> {
  const s = await call(() => reader.server());
  if (!isObject(s) || !isIndex(s.validated) || !isIndex(s.latest) || typeof s.completeLedgers !== "string") unparseable();
  if (s.networkId !== undefined && !isIndex(s.networkId)) unparseable();
  return s;
}

/** `complete_ledgers` as ranges, each `[first, last]`; `"empty"` is none. Another form is `unparseable`. */
export function completeRanges(text: string): [number, number][] {
  if (text === "empty") return [];
  const out: [number, number][] = [];
  for (const part of text.split(",")) {
    const m = RANGE.exec(part);
    if (m === null) unparseable();
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a) unparseable();
    out.push([a, b]);
  }
  return out;
}

/** Whether the ranges hold every ledger from `from` to `to`, adjacent ranges joined. */
export function holds(ranges: readonly [number, number][], from: number, to: number): boolean {
  if (to < from) return true;
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  let reach = from - 1;
  for (const [a, b] of sorted) {
    if (a > reach + 1) {
      if (a <= from) reach = b;
      else if (reach >= from - 1) break;
      continue;
    }
    if (b > reach) reach = b;
  }
  return sorted.some(([a]) => a <= from) && reach >= to;
}

/**
 * An amount as rippled writes it, as what moved: XRP in drops, an issued currency as `CUR:issuer`, an MPT by its id,
 * named by the transaction it was read from. A Payment delivers one amount to its one `Destination` and a
 * PaymentChannelCreate makes one deposit, so its place is the whole transaction, and no `place` is stated; an inner
 * `Batch` payment is named by its own inner transaction.
 */
function movedOf(amount: XrplAmount | undefined, to: string | undefined, transaction: string): Moved | undefined {
  if (to === undefined) return undefined;
  if (typeof amount === "string") return /^[0-9]{1,20}$/.test(amount) ? { asset: "XRP", amount, to, transaction } : undefined;
  if (!isObject(amount) || typeof amount.value !== "string") return undefined;
  if ("mpt_issuance_id" in amount && typeof amount.mpt_issuance_id === "string") {
    return { asset: amount.mpt_issuance_id, amount: amount.value, to, transaction };
  }
  if ("currency" in amount && typeof amount.currency === "string" && typeof amount.issuer === "string") {
    return { asset: `${amount.currency}:${amount.issuer}`, amount: amount.value, to, transaction };
  }
  return undefined;
}

/** The authority a transaction acted under, beside its signer: its `Signers`, its `Delegate`, or its `Batch`. */
function authorityOf(tx: XrplTxJson, landed: XrplLanded): string | undefined {
  if (Array.isArray(tx["Signers"])) {
    const accounts = (tx["Signers"] as unknown[]).map((s) =>
      isObject(s) && isObject(s["Signer"]) ? String((s["Signer"] as { Account?: unknown }).Account) : "?",
    );
    return `Signers ${accounts.join(",")}`;
  }
  if (typeof tx["Delegate"] === "string") return `Delegate for ${tx.Account}`;
  if (typeof landed.parent === "string") return `inner Batch of ${landed.parent.toUpperCase()}`;
  return undefined;
}

/**
 * What one read classifies a transaction against: the pairing's form, H, the payee, the instrument, the others, and
 * the comparison of a transaction, by its hash and its signed body, with the payment presented.
 */
interface Context {
  readonly form: XrplForm;
  readonly h: AtrHash;
  readonly x402: string;
  readonly payee: string;
  readonly signed: XrplSigned;
  readonly others: readonly OtherAct<XrplRef>[];
  readonly presented: (hash: string, body: string | undefined) => "yes" | "no" | "unshown";
}

function sameInstrument(tx: XrplTxJson, signed: XrplSigned): boolean {
  if (tx.Account !== signed.account) return false;
  return signed.ticket !== undefined
    ? tx["Sequence"] === 0 && tx["TicketSequence"] === signed.ticket
    : signed.sequence !== 0 && tx["Sequence"] === signed.sequence;
}

function givenBy(others: readonly OtherAct<XrplRef>[], tx: XrplTxJson, hash: string): boolean {
  return others.some((o) => {
    if (!isObject(o)) return false;
    if ("transaction" in o) return typeof o.transaction === "string" && o.transaction.toUpperCase() === hash;
    const r = (o as { ref?: unknown }).ref;
    if (!isObject(r)) return false;
    const ref = r as Partial<XrplRef>;
    if (typeof ref.transaction === "string" && ref.transaction.toUpperCase() === hash) return true;
    return isObject(ref.signed) && sameInstrument(tx, ref.signed as XrplSigned);
  });
}

/** The result of a transaction in a ledger: `tesSUCCESS`, or a `tec` code; any other is no ledger's. */
function resultOf(result: unknown): Seen<number, XrplReached>["result"] | undefined {
  if (result === "tesSUCCESS") return "succeeded";
  return typeof result === "string" && /^tec[A-Z_]+$/.test(result) ? "failed" : undefined;
}

/**
 * A transaction as the read classifies it against the context: undefined where it neither carries H, nor took the
 * instrument, nor is `named`; `"undecodable"` where its blob does not decode, its answer is not of its form, or its
 * result is no ledger's.
 */
async function classify(
  ctx: Context,
  landed: XrplLanded,
  named: string | undefined,
): Promise<Seen<number, XrplReached> | "undecodable" | undefined> {
  const l = landed;
  if (typeof l.blob !== "string" || typeof l.validated !== "boolean") return "undecodable";
  if (l.ledgerIndex !== undefined && !isIndex(l.ledgerIndex)) return "undecodable";
  const result = resultOf(l.result);
  if (result === undefined) return "undecodable";
  const d = await decodeBlob(l.blob);
  if (isRefusal(d)) {
    if (d.code === "xrpl/peer-missing") unparseable();
    return "undecodable";
  }
  const { tx, hash } = d;
  const invoice = typeof tx.InvoiceID === "string" ? tx.InvoiceID.toUpperCase() : undefined;
  const memo = lcpMemoOf(tx);
  const byForm: { [f in XrplForm]: boolean } = {
    x402: invoice === ctx.x402,
    mpp: invoice === mppInvoiceId(ctx.h),
    memo: !isRefusal(memo) && hashEquals(memo, ctx.h),
  };
  const carries = byForm.x402 || byForm.mpp || byForm.memo;
  const consumed = sameInstrument(tx, ctx.signed);
  if (!carries && !consumed && hash !== named) return undefined;
  const delegate = typeof tx["Delegate"] === "string" ? (tx["Delegate"] as string) : undefined;
  const party = tx.Account === ctx.payee || delegate === ctx.payee ? "payee" : tx.Account === ctx.signed.account ? "payer" : "other";
  const destination = typeof tx["Destination"] === "string" ? (tx["Destination"] as string) : undefined;
  let moved: Moved[] | undefined = [];
  if (result === "succeeded") {
    const m =
      tx.TransactionType === "PaymentChannelCreate"
        ? movedOf(tx["Amount"] as XrplAmount, destination, hash)
        : tx.TransactionType === "Payment"
          ? movedOf(l.delivered, destination, hash)
          : undefined;
    moved = m === undefined ? undefined : [m];
  }
  const authority = authorityOf(tx, l);
  return {
    transaction: hash,
    ...(l.ledgerIndex === undefined ? {} : { position: l.ledgerIndex }),
    mark: l.validated ? "validated" : "current",
    result,
    consumed,
    carries,
    party,
    kind: tx.TransactionType === TYPE_OF[ctx.form] && byForm[ctx.form] ? "same" : "other",
    account: destination === undefined ? "none" : destination === ctx.payee ? "payee" : "other",
    ...(givenBy(ctx.others, tx, hash) ? { given: true } : {}),
    presented: ctx.presented(hash, await signedBodyOf(tx)),
    ...(moved === undefined ? {} : { moved }),
    signer: delegate ?? tx.Account,
    ...(authority === undefined ? {} : { authority }),
  };
}

/**
 * What a search read: whether it read its range whole, where the next read resumes where it did not, whether it
 * covered `from`, and the items it could not decode.
 */
interface Searched {
  readonly whole: boolean;
  readonly at?: number;
  /** The ledger a next read resumes from: `at` where the search is not whole, else the one after the last it covered. */
  readonly end: number;
  readonly covered: boolean;
  readonly undecoded: Undecoded<number>[];
}

/**
 * `account_tx` of `account` from `from` to `to`, page by page, at most `XRPL_MAX_PAGES`, each transaction handed to
 * `take`, which answers false for one it cannot decode: that one is named by its hash, at its ledger. Whole where no
 * marker is left and the pages reached `to`; not whole, the search resumes from the ledger after the last a page
 * covered, or, where pages are left, the ledger of the last transaction read. `covered`: the pages began at or before
 * `from`. A page, or a transaction in it with no hash of 64 hex digits, that is not of its form is `unparseable`.
 */
async function searchAccount(
  reader: XrplReader,
  account: string,
  from: number,
  to: number,
  take: (landed: XrplLanded) => Promise<boolean>,
): Promise<Searched> {
  const undecoded: Undecoded<number>[] = [];
  if (to < from) return { whole: true, end: from, covered: true, undecoded };
  let marker: unknown;
  let last = from;
  let covered = true;
  for (let pages = 1; ; pages++) {
    const page = await call(() => reader.accountTx(account, { min: from, max: to }, marker));
    if (!isObject(page) || !Array.isArray(page.transactions) || !isIndex(page.min) || !isIndex(page.max)) unparseable();
    if (page.min > from) covered = false;
    for (const t of page.transactions as unknown[]) {
      const l = t as XrplLanded;
      if (typeof t !== "object" || t === null || typeof l.hash !== "string" || !HASH256.test(l.hash)) unparseable();
      const at = isIndex(l.ledgerIndex) ? l.ledgerIndex : undefined;
      if (at !== undefined && at > last) last = at;
      if (!(await take(l))) undecoded.push({ transaction: l.hash.toUpperCase(), ...(at === undefined ? {} : { at }) });
    }
    marker = page.marker;
    if (marker === undefined) {
      return page.max >= to
        ? { whole: true, end: page.max + 1, covered, undecoded }
        : { whole: false, at: page.max + 1, end: page.max + 1, covered, undecoded };
    }
    if (pages >= XRPL_MAX_PAGES) return { whole: false, at: last, end: last, covered, undecoded };
  }
}

/** The single-use value read at one ledger: consumed or not, and the ledger it was read at; undefined: no account. */
async function valueAt(
  reader: XrplReader,
  signed: XrplSigned,
  ledger: XrplLedgerName,
): Promise<{ consumed: boolean; ledgerIndex: number } | undefined> {
  if (signed.ticket !== undefined) {
    const t = await call(() => reader.ticket(signed.account, signed.ticket!, ledger));
    if (!isObject(t) || typeof t.present !== "boolean" || !isIndex(t.ledgerIndex)) unparseable();
    return { consumed: !t.present, ledgerIndex: t.ledgerIndex };
  }
  const a = await call(() => reader.accountInfo(signed.account, ledger));
  if (!isObject(a) || !isIndex(a.ledgerIndex)) unparseable();
  if ("notFound" in a) return undefined;
  if (!isIndex(a.sequence)) unparseable();
  return { consumed: a.sequence > signed.sequence, ledgerIndex: a.ledgerIndex };
}

/**
 * The single-use value as `decide` takes it, read at the validated ledger and at the current one, the latest head the
 * server serves (`head`): consumed or lapsed past the signed `LastLedgerSequence` at the validated ledger, at the mark
 * `validated`; else lapsed at the current ledger only, read there, `current`, which is no mark; else unconsumed and
 * live. Undefined where the validated ledger shows no account for the payer: deleted or never funded, which gives no
 * read of the value as unconsumed, since a deleted account may have taken it.
 */
async function valueOf(reader: XrplReader, signed: XrplSigned): Promise<Facts<number, XrplReached>["value"]> {
  const lapsed = (at: number): boolean => signed.lastLedgerSequence !== null && at > signed.lastLedgerSequence;
  const v = await valueAt(reader, signed, "validated");
  if (v === undefined) return undefined;
  if (v.consumed) return { consumed: true, lapsed: lapsed(v.ledgerIndex), mark: "validated" };
  const c = await valueAt(reader, signed, "current");
  const head = c === undefined ? {} : { head: { consumed: c.consumed } };
  if (lapsed(v.ledgerIndex)) return { consumed: false, lapsed: true, mark: "validated", ...head };
  if (c !== undefined && !c.consumed && lapsed(c.ledgerIndex)) return { consumed: false, lapsed: true, mark: "current", ...head };
  return { consumed: false, lapsed: false, mark: "validated", ...head };
}

function isSigned(s: unknown): s is XrplSigned {
  if (!isObject(s)) return false;
  const v = s as Partial<XrplSigned>;
  return (
    typeof v.account === "string" &&
    Number.isSafeInteger(v.sequence) &&
    (v.ticket === undefined || Number.isSafeInteger(v.ticket)) &&
    (v.lastLedgerSequence === null || Number.isSafeInteger(v.lastLedgerSequence)) &&
    typeof v.body === "string"
  );
}

/** A reference of the form `reference` writes, with the issue ledger the caller adds. */
function isRef(ref: unknown): ref is XrplRef {
  if (!isObject(ref)) return false;
  const r = ref as Partial<XrplRef>;
  return (
    isXrplNetwork(r.network) &&
    typeof r.transaction === "string" &&
    HASH256.test(r.transaction) &&
    normalHash(r.h) !== null &&
    typeof r.payee === "string" &&
    isIndex(r.fromLedger) &&
    (r.signed === undefined || isSigned(r.signed))
  );
}

function unreadableAnswer(reason: UnreadableReason): XrplStatus {
  return { state: "unreadable", reason, foreign: [] };
}

/** The query with each other act given by its transaction spelled as the read names transactions, in upper case. */
function normalised<Ref>(query: XrplQuery<Ref>): XrplQuery<Ref> {
  if (!Array.isArray(query.others)) return query;
  const others = query.others.map((o) =>
    isObject(o) && "transaction" in o && typeof o.transaction === "string" ? { transaction: o.transaction.toUpperCase() } : o,
  );
  return { ...query, others };
}

/** The checks every read makes before it calls: the query, the reference, the reader and its network. */
function precheck(query: unknown, refOk: boolean, reader: unknown, network: XrplNetwork | undefined): XrplStatus | undefined {
  if (!isXrplQuery(query) || !refOk) return unreadableAnswer("unparseable");
  const r = reader as { network?: unknown } | null;
  if (typeof r !== "object" || r === null || !isXrplNetwork(r.network)) return unreadableAnswer("unparseable");
  if (r.network !== network) return unreadableAnswer("chain-mismatch");
  return undefined;
}

const FULL = xrplLedger("full");
const NONE = xrplLedger("none");

/**
 * The read of a payment or an opening at coverage `full` whose H rides in `form`, as the profile `read-status`
 * answers it. It reads `server_info`; the presented transaction by its hash, a way to look, which, where the payment
 * was presented by its hash alone, names the instrument once found and is otherwise the read, a lookup from the issue
 * ledger to the validated ledger; the instrument at the validated ledger and the current one (`account_info`, or the
 * ticket's `ledger_entry`); and the payer's `account_tx` from the issue ledger, or the search position the query
 * gives, to the latest ledger the server serves. Every transaction it meets that carries H in any of the family's
 * forms, took the instrument, or is the presented one, is classified for `decide`: its signer against the payee (an
 * `Account` or `Delegate` that is the payee's) and the payer, its kind by the pairing's type and form, the account its
 * `Destination` names, what it delivered (`meta.delivered_amount`, or a create's `Amount`), and an other act the
 * caller gives, by its transaction or its reference's instrument. The history holds where `complete_ledgers` holds the
 * issue ledger to the validated ledger and the search began at its start; without it a value read consumed or lapsed
 * is no evidence. A transaction whose blob or answer is not of its form holds the search at its ledger, unless the
 * read names it, which is `unparseable`. A `settled` answer states `presented`: the act's signed body against the
 * presented blob's, or, for a payment presented by its hash, whether the act is that transaction. An account the
 * validated ledger does not show, deleted or never funded, gives no read of the value: the search decides, and with no
 * act found the answer is `pending`, `search-incomplete`, never `not-found`. A transaction found in a ledger not yet
 * validated was read at `current`, no mark: an act there is `pending`, `below-mark`. Until a run shows that
 * `account_tx` lists every transaction of the payer's account (`SEARCH_SHOWN`), a search read whole proves no absence:
 * where the read would answer `failed`, `instrument-unused`, `instrument-consumed` or `transaction-failed`, it answers
 * `pending`, `search-incomplete`, the search's position the ledger after the last it read.
 */
export function xrplPaymentStatus(form: XrplForm) {
  return async (ref: XrplRef, reader: XrplReader, query: XrplQuery<XrplRef>): Promise<XrplStatus> => {
    const fault = precheck(query, isRef(ref), reader, isObject(ref) ? (ref as XrplRef).network : undefined);
    if (fault !== undefined) return fault;
    try {
      const server = await serverOf(reader);
      if (server.networkId !== undefined && server.networkId !== networkId(ref.network)) return unreadableAnswer("chain-mismatch");
      let history = holds(completeRanges(server.completeLedgers), ref.fromLedger, server.validated);
      const presentedHash = ref.transaction.toUpperCase();
      const byHash = ref.signed === undefined;
      const lookup = await call(() =>
        reader.tx(presentedHash, byHash ? { min: ref.fromLedger, max: server.validated } : null),
      );
      if (!isObject(lookup)) unparseable();
      let signed = ref.signed;
      if (!("notFound" in lookup) && signed === undefined) {
        const d = await decodeBlob((lookup as XrplLanded).blob);
        if (isRefusal(d) || d.hash !== presentedHash) return unreadableAnswer("unparseable");
        signed = await signedOf(d.tx);
        if (signed === undefined) return unreadableAnswer("unparseable");
      }
      const met = new Map<string, Seen<number, XrplReached>>();
      let value: Facts<number, XrplReached>["value"];
      let search: Facts<number, XrplReached>["search"];
      let accountShown = true;
      let undecoded: Undecoded<number>[] = [];
      let end: number | undefined;
      if (signed === undefined) {
        const l = lookup as { notFound: true; searchedAll: unknown };
        if (typeof l.searchedAll !== "boolean") unparseable();
        search = { whole: l.searchedAll };
      } else {
        const ctx: Context = {
          form,
          h: ref.h,
          x402: await x402InvoiceId(ref.h),
          payee: ref.payee,
          signed,
          others: Array.isArray(query.others) ? query.others : [],
          presented: (hash, body) =>
            byHash ? (hash === presentedHash ? "yes" : "no") : body === undefined ? "unshown" : body === ref.signed!.body ? "yes" : "no",
        };
        const take = async (landed: XrplLanded, named?: string): Promise<boolean> => {
          const c = await classify(ctx, landed, named);
          if (c === "undecodable") return false;
          if (c !== undefined && !met.has(c.transaction)) met.set(c.transaction, c);
          return true;
        };
        if (!("notFound" in lookup) && !(await take(lookup as XrplLanded, presentedHash))) return unreadableAnswer("unparseable");
        value = await valueOf(reader, signed);
        accountShown = value !== undefined;
        const from = isIndex(query.search) ? query.search : ref.fromLedger;
        const s = await searchAccount(reader, signed.account, from, server.latest, (t) => take(t));
        if (!s.covered) history = false;
        search = s.at === undefined ? { whole: s.whole } : { whole: s.whole, at: s.at };
        undecoded = s.undecoded;
        end = s.end;
      }
      if (!history && value !== undefined && (value.consumed || value.lapsed)) value = undefined;
      const facts: Facts<number, XrplReached> = {
        seen: [...met.values()],
        ...(value === undefined ? {} : { value }),
        search,
        ...(undecoded.length === 0 ? {} : { undecoded }),
        history,
      };
      let answer = decide(facts, normalised(query), FULL);
      // The search's gate: until a run shows that `account_tx` lists every transaction of the payer's account, a search
      // read whole proves no absence, and the failed answers that rest on it are search-incomplete at the search's end.
      if (!SEARCH_SHOWN && end !== undefined && answer.state === "failed" && GATED.has(answer.reason)) {
        answer = decide({ ...facts, search: { whole: false, at: end } }, normalised(query), FULL);
      }
      // An account the validated ledger does not show gives no read of the value: the search decides, and with no act
      // found the answer is search-incomplete, never not-found, since a deleted account may have taken the value.
      if (!accountShown && answer.state === "pending" && answer.reason === "not-found") {
        return { ...answer, reason: "search-incomplete" };
      }
      return answer;
    } catch (e) {
      if (e instanceof Unreadable) return unreadableAnswer(e.reason);
      throw e;
    }
  };
}

/** The read of an in-band opening, `mpp/session/xrpl`: `xrplPaymentStatus` of the opening's one LCP memo. */
export const xrplOpenStatus = /* @__PURE__ */ xrplPaymentStatus("memo");

/** The read of `x402/exact/xrpl`: `xrplPaymentStatus` of x402's `InvoiceID`, the SHA-256 of H's LCP string. */
export const xrplStatus = /* @__PURE__ */ xrplPaymentStatus("x402");

/** The read of `mpp/charge/xrpl`: `xrplPaymentStatus` of MPP's `InvoiceID`, H itself. */
export const xrplChargeStatus = /* @__PURE__ */ xrplPaymentStatus("mpp");

/**
 * The read keys of a channel at coverage `none`: the network, the channel the presented payment names, in upper case,
 * the payer it names, the option's payee, and the ledger index the create must come after, which is the caller's.
 */
export interface XrplChannelRef {
  network: XrplNetwork;
  channel: string;
  payer: string;
  payee: string;
  fromLedger: number;
}

function isChannelRef(ref: unknown): ref is XrplChannelRef {
  if (!isObject(ref)) return false;
  const r = ref as Partial<XrplChannelRef>;
  return (
    isXrplNetwork(r.network) &&
    typeof r.channel === "string" &&
    HASH256.test(r.channel) &&
    typeof r.payer === "string" &&
    typeof r.payee === "string" &&
    isIndex(r.fromLedger)
  );
}

/**
 * The read of a channel at coverage `none`, as the profile `read-status` answers it: the `PayChannel` at the validated
 * ledger (`ledger_entry`); then the `account_tx` of the channel's `Account`, or, where the validated ledger does not
 * show the channel, of the payer the presented payment names, from the ledger the create must come after, or the
 * search position the query gives, to the latest ledger the server serves, for the `PaymentChannelCreate` whose
 * metadata creates the channel's entry, or, where the metadata names none, whose `Account`, `Destination` and sequence
 * or ticket give the channel's id. That create is the act where its `Account` is the payer and its `Destination` the
 * payee; one another account opened, or one to another account, took the channel and answers `failed`,
 * `instrument-consumed`; one at or before the query's `after`, `failed`, `before-position`. A channel the validated
 * ledger shows whose create the search, read whole, does not hold is `unreadable`, `history-gap` where the server does
 * not hold the range; where it holds it, the create was made at or before the search's start, so at or before the
 * query's `after` where the search began no later than the ledger after it, `failed`, `before-position`, once a run
 * shows that `account_tx` lists every transaction of the opener's account (`SEARCH_SHOWN`); until then that absence
 * proves nothing and the answer is `pending`, `search-incomplete`, its search position held where this search began,
 * so that the next read reads the range again. A channel it does not show whose create the search does not hold is
 * `pending`, `not-found`, where the history holds, and `unreadable`, `history-gap` where it does not. `presented` is
 * `yes` where the create's `Account` is the payer the payment names, the create being the one whose metadata made the
 * channel's entry, so on every `settled` answer.
 */
export async function xrplChannelStatus(
  ref: XrplChannelRef,
  reader: XrplReader,
  query: XrplQuery<XrplChannelRef>,
): Promise<XrplStatus> {
  const fault = precheck(query, isChannelRef(ref), reader, isObject(ref) ? (ref as XrplChannelRef).network : undefined);
  if (fault !== undefined) return fault;
  try {
    const server = await serverOf(reader);
    if (server.networkId !== undefined && server.networkId !== networkId(ref.network)) return unreadableAnswer("chain-mismatch");
    let history = holds(completeRanges(server.completeLedgers), ref.fromLedger, server.validated);
    const channel = ref.channel.toUpperCase();
    const entry = await call(() => reader.channel(channel, "validated"));
    if (typeof entry !== "object" || entry === null) unparseable();
    const shown = !("notFound" in entry);
    const e = entry as Partial<XrplChannelEntry>;
    if (shown && (typeof e.account !== "string" || typeof e.destination !== "string")) unparseable();
    const opener = shown ? e.account! : ref.payer;
    const met: Seen<number, XrplReached>[] = [];
    const take = async (l: XrplLanded): Promise<boolean> => {
      if (typeof l.blob !== "string" || typeof l.validated !== "boolean") return false;
      if (l.ledgerIndex !== undefined && !isIndex(l.ledgerIndex)) return false;
      if (resultOf(l.result) === undefined) return false;
      const d = await decodeBlob(l.blob);
      if (isRefusal(d)) {
        if (d.code === "xrpl/peer-missing") unparseable();
        return false;
      }
      const tx = d.tx;
      if (tx.TransactionType !== "PaymentChannelCreate" || l.result !== "tesSUCCESS") return true;
      const created = Array.isArray(l.createdChannels)
        ? l.createdChannels.some((c) => typeof c === "string" && c.toUpperCase() === channel)
        : (() => {
            const seq = tx["Sequence"] === 0 ? tx["TicketSequence"] : tx["Sequence"];
            const id = xrplChannelId(tx.Account, tx["Destination"] as string, seq as number);
            return !isRefusal(id) && id === channel;
          })();
      if (!created || met.some((s) => s.transaction === d.hash)) return true;
      const delegate = typeof tx["Delegate"] === "string" ? (tx["Delegate"] as string) : undefined;
      const destination = typeof tx["Destination"] === "string" ? (tx["Destination"] as string) : undefined;
      const moved = movedOf(tx["Amount"] as XrplAmount, destination, d.hash);
      const authority = authorityOf(tx, l);
      met.push({
        transaction: d.hash,
        ...(l.ledgerIndex === undefined ? {} : { position: l.ledgerIndex }),
        mark: l.validated ? "validated" : "current",
        result: "succeeded",
        consumed: true,
        carries: false,
        party: tx.Account === ref.payee || delegate === ref.payee ? "payee" : tx.Account === ref.payer ? "payer" : "other",
        kind: "same",
        account: destination === ref.payee ? "payee" : "other",
        presented: tx.Account === ref.payer ? "yes" : "no",
        ...(moved === undefined ? {} : { moved: [moved] }),
        signer: delegate ?? tx.Account,
        ...(authority === undefined ? {} : { authority }),
      });
      return true;
    };
    const from = isIndex(query.search) ? query.search : ref.fromLedger;
    const s = await searchAccount(reader, opener, from, server.latest, take);
    if (!s.covered) history = false;
    const search = s.at === undefined ? { whole: s.whole } : { whole: s.whole, at: s.at };
    const after = query.after;
    // A channel the validated ledger shows whose create the search, read whole, does not hold: on a server that does not
    // hold the range, the read proves nothing and goes to an endpoint that does; on one that holds it, the channel was
    // created at or before the search's start, which only a search that lists every transaction of the opener's account
    // proves. Until a run shows that, the absence releases nothing, and the position stays where this search began.
    const absent = shown && met.length === 0 && s.whole && s.undecoded.length === 0;
    if (absent && !history) return unreadableAnswer("history-gap");
    const beforeByAbsence = absent && after !== undefined && from <= after + 1;
    if (beforeByAbsence && SEARCH_SHOWN) {
      return { state: "failed", reason: "before-position", finality: "validated", foreign: [] };
    }
    const value: Facts<number, XrplReached>["value"] = shown
      ? { consumed: true, lapsed: false, mark: "validated" }
      : met[0] === undefined
        ? undefined
        : { consumed: true, lapsed: false, mark: met[0].mark };
    const facts: Facts<number, XrplReached> = {
      seen: met,
      ...(value === undefined ? {} : { value }),
      search,
      ...(s.undecoded.length === 0 ? {} : { undecoded: s.undecoded }),
      history,
    };
    return decide(beforeByAbsence ? { ...facts, search: { whole: false, at: from } } : facts, normalised(query), NONE);
  } catch (e) {
    if (e instanceof Unreadable) return unreadableAnswer(e.reason);
    throw e;
  }
}
