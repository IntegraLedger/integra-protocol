/**
 * The read of a landed payment or agreement, as the profile `read-status` states it: what `status` takes, what it
 * answers, and `decide`, which applies the profile's rules to what a pairing's read observed.
 */
import type { Coverage } from "./registry.js";

/** The act `status` is asked about. */
export type Act = "payment" | "agreement";

/** The reasons of a `pending` answer, in the order in which they are answered: the first that holds. */
export type PendingReason = "below-mark" | "instrument-live" | "search-incomplete" | "not-found";
/** The reasons of a `failed` answer. */
export type FailedReason = "instrument-unused" | "instrument-consumed" | "transaction-failed" | "before-position";
/** The reasons of an `unreadable` answer. */
export type UnreadableReason = "history-gap" | "transport" | "unparseable" | "too-large" | "chain-mismatch";
/** Why a transaction that carries H is not the act asked about, in the order in which they are tried. */
export type ForeignReason = "payee-signed" | "other-signer" | "given" | "other-kind" | "other-account";

/** One transfer or deposit an act made, as the read observed it. */
export interface Moved {
  readonly asset: string;
  readonly amount: string;
  /** The account it reached, or the beneficiary a contract names. */
  readonly to: string;
}

/** A transaction that carries H, succeeded, and is not the act asked about. */
export interface ForeignItem<Position> {
  readonly transaction: string;
  readonly position?: Position;
  readonly signer?: string;
  readonly moved?: readonly Moved[];
  readonly reason: ForeignReason;
}

/** Another act under the same H, which `status` never settles on: by its reference, or by its transaction. */
export type OtherAct<Ref> = { readonly ref: Ref } | { readonly transaction: string };

/**
 * What `status` takes beside the reference and the reader: the act, the finality asked for, and, where the caller gives
 * them, the final position the transaction must come after, the search position an earlier answer returned, and the
 * other acts under the same H.
 */
export interface StatusQuery<Ref, Position, Mark, Cursor = Position> {
  readonly act: Act;
  readonly finality: Mark;
  readonly after?: Position;
  readonly search?: Cursor;
  readonly others?: readonly OtherAct<Ref>[];
}

interface Named<Position, Mark> {
  readonly transaction?: string;
  readonly position?: Position;
  /** The mark the read reached for the transaction it names. */
  readonly finality?: Mark;
  readonly moved?: readonly Moved[];
  readonly signer?: string;
  readonly authority?: string;
}

/** The answer of `status`: one state, one reason of a closed list, what it read, and the foreign items it met. */
export type StatusAnswer<Position, Mark, Cursor = Position> =
  | (Named<Position, Mark> & {
      readonly state: "settled";
      readonly transaction: string;
      readonly finality: Mark;
      readonly foreign: readonly ForeignItem<Position>[];
    })
  | (Named<Position, Mark> & {
      readonly state: "pending";
      readonly reason: PendingReason;
      readonly search?: Cursor;
      readonly foreign: readonly ForeignItem<Position>[];
    })
  | (Named<Position, Mark> & {
      readonly state: "failed";
      readonly reason: FailedReason;
      /** On `instrument-consumed`, the reason that holds for the transaction named, where it carries H. */
      readonly carries?: ForeignReason;
      readonly foreign: readonly ForeignItem<Position>[];
    })
  | { readonly state: "unreadable"; readonly reason: UnreadableReason; readonly foreign: readonly ForeignItem<Position>[] };

/** What `recover` takes: the network, the transaction id, and the option or challenge the ATR's binding slot holds. */
export interface RecoverInput<Network, Option> {
  readonly network: Network;
  readonly tx: string;
  readonly option: Option;
}

/** A transaction a read met, as the pairing's read classified it against the reference and the option. */
export interface Seen<Position, Mark> {
  readonly transaction: string;
  readonly position?: Position;
  /** The highest mark the read reached for it. */
  readonly mark: Mark;
  /** `succeeded`, or included with a failed result. */
  readonly result: "succeeded" | "failed";
  /** Whether it consumed the act's single-use value. */
  readonly consumed: boolean;
  /** Whether it carries H, or for an agreement on a pairing that has one, the agreement's own value. */
  readonly carries: boolean;
  /** Its signer against the reference's payer and the option's payee. */
  readonly party: "payer" | "payee" | "other";
  /** Whether it is an act of the reference's pairing and of the act's kind. */
  readonly kind: "same" | "other";
  /** The account it names against the option's payee's: `none` where it names no account. */
  readonly account: "payee" | "other" | "none";
  /** True where the pairing's read matched it to an other act the caller gave by its reference. */
  readonly given?: boolean;
  readonly moved?: readonly Moved[];
  readonly signer?: string;
  readonly authority?: string;
}

/** What a pairing's read observed, from which `decide` composes the answer. */
export interface Facts<Position, Mark, Cursor = Position> {
  /** Set where the read established nothing. */
  readonly unreadable?: UnreadableReason;
  /** Every transaction the read met that carries H, consumed the single-use value, or is the one the reference names. */
  readonly seen: readonly Seen<Position, Mark>[];
  /**
   * The single-use value as read: whether it is consumed, whether its validity has passed, and the mark it was read at.
   * Absent where the read has no means to read it.
   */
  readonly value?: { readonly consumed: boolean; readonly lapsed: boolean; readonly mark: Mark };
  /**
   * The search, or the lookup at coverage `none`: `whole` where it was read to its end and the endpoint answered in
   * the form it documents; `at`, the position to resume from where it was not.
   */
  readonly search: { readonly whole: boolean; readonly at?: Cursor };
  /** Whether the reader showed that it holds the history the act would be in. */
  readonly history: boolean;
}

/** A pairing's marks and positions: their order, and the final mark. */
export interface Ledger<Position, Mark> {
  readonly coverage: Coverage;
  readonly final: Mark;
  /** Negative, zero or positive as `a` is below, at or above `b`. */
  readonly markOrder: (a: Mark, b: Mark) => number;
  /** Negative, zero or positive as `a` is before, at or after `b`. */
  readonly positionOrder: (a: Position, b: Position) => number;
}

const FOREIGN_ORDER: readonly ForeignReason[] = ["payee-signed", "other-signer", "given", "other-kind", "other-account"];
const PENDING_ORDER: readonly PendingReason[] = ["below-mark", "instrument-live", "search-incomplete", "not-found"];

/**
 * The answer the profile `read-status` gives for what a read observed. A query that is not an object naming the act
 * `payment` or `agreement` is `unreadable`, `unparseable`, as a malformed reference is. Applies, in order: `before-position` first; the
 * act asked about, identified by its binding and its parties and never one the caller gave, settled at or above the
 * finality asked for and `below-mark` under it; `failed` only at the final mark and, at coverage `full`, only once
 * the search was read whole; a value read consumed with no transaction found as `search-incomplete`; `not-found` only
 * where the reader showed its history, and `history-gap` otherwise; and the `pending` reasons in their order. Every
 * transaction that carries H, succeeded, is not the act and is not named as the consumer of the value is a foreign
 * item where a reason holds, named with the first.
 */
export function decide<Ref, Position, Mark, Cursor>(
  facts: Facts<Position, Mark, Cursor>,
  query: StatusQuery<Ref, Position, Mark, Cursor>,
  ledger: Ledger<Position, Mark>,
): StatusAnswer<Position, Mark, Cursor> {
  if (facts.unreadable !== undefined) return { state: "unreadable", reason: facts.unreadable, foreign: [] };
  if (typeof query !== "object" || query === null || (query.act !== "payment" && query.act !== "agreement")) {
    return { state: "unreadable", reason: "unparseable", foreign: [] };
  }
  const isFinal = (m: Mark): boolean => ledger.markOrder(m, ledger.final) >= 0;
  const givenTx = new Set(
    (query.others ?? []).flatMap((o) => ("transaction" in o && typeof o.transaction === "string" ? [o.transaction] : [])),
  );
  const isGiven = (s: Seen<Position, Mark>): boolean => s.given === true || givenTx.has(s.transaction);
  const bindsAct = (s: Seen<Position, Mark>): boolean => ledger.coverage === "none" || s.carries;
  const isAct = (s: Seen<Position, Mark>): boolean =>
    s.result === "succeeded" &&
    bindsAct(s) &&
    s.party === "payer" &&
    !isGiven(s) &&
    s.kind === "same" &&
    (query.act === "agreement" || s.account === "payee");
  const ownFailed = (s: Seen<Position, Mark>): boolean =>
    s.result === "failed" && s.party === "payer" && s.kind === "same" && !isGiven(s);
  const consumer = (s: Seen<Position, Mark>): boolean => s.result === "succeeded" && s.consumed && !isAct(s);

  const reasonOf = (s: Seen<Position, Mark>): ForeignReason | undefined =>
    FOREIGN_ORDER.find((r) => {
      switch (r) {
        case "payee-signed":
          return s.party === "payee";
        case "other-signer":
          return s.party === "other";
        case "given":
          return isGiven(s);
        case "other-kind":
          return s.kind === "other";
        case "other-account":
          return query.act === "payment" && s.account !== "payee";
      }
    });
  const foreignOf = (except: Seen<Position, Mark> | undefined): ForeignItem<Position>[] =>
    facts.seen.flatMap((s) => {
      if (s === except || s.result !== "succeeded" || !s.carries || isAct(s)) return [];
      const reason = reasonOf(s);
      return reason === undefined ? [] : [itemOf(s, reason)];
    });

  // Before the position: decided before any other reason.
  const deciding = facts.seen.filter((s) => isAct(s) || consumer(s) || (ownFailed(s) && s.consumed));
  if (query.after !== undefined) {
    const after = query.after;
    const before = deciding.find((s) => s.position !== undefined && ledger.positionOrder(s.position, after) <= 0);
    if (before !== undefined) {
      return { state: "failed", reason: "before-position", ...namedOf(before), foreign: foreignOf(before) };
    }
  }

  const acts = facts.seen.filter(isAct);
  const placed = query.after === undefined ? acts : acts.filter((s) => s.position !== undefined);
  const act = placed[0];
  if (act !== undefined) {
    if (ledger.markOrder(act.mark, query.finality) >= 0) {
      return { state: "settled", ...namedOf(act), transaction: act.transaction, finality: act.mark, foreign: foreignOf(act) };
    }
    return pending("below-mark", act);
  }

  const pendingReasons = new Set<PendingReason>();
  let below: Seen<Position, Mark> | undefined;
  let failed: { reason: FailedReason; by?: Seen<Position, Mark> } | undefined;
  const failedAt = (reason: FailedReason, mark: Mark, by?: Seen<Position, Mark>): void => {
    if (!isFinal(mark)) {
      pendingReasons.add("below-mark");
      below ??= by;
    } else if (facts.value === undefined || (ledger.coverage === "full" && !facts.search.whole)) {
      pendingReasons.add("search-incomplete");
    } else {
      failed = by === undefined ? { reason } : { reason, by };
    }
  };

  if (acts.length > placed.length) pendingReasons.add("search-incomplete");
  const consumedBy = facts.seen.find(consumer);
  const failedOwn = facts.seen.find((s) => ownFailed(s) && s.consumed);
  if (consumedBy !== undefined) failedAt("instrument-consumed", consumedBy.mark, consumedBy);
  else if (failedOwn !== undefined) failedAt("transaction-failed", failedOwn.mark, failedOwn);
  else if (facts.value !== undefined) {
    if (facts.value.consumed) pendingReasons.add("search-incomplete");
    else if (facts.value.lapsed) failedAt("instrument-unused", facts.value.mark);
    else if (isFinal(facts.value.mark)) pendingReasons.add("instrument-live");
    else pendingReasons.add("search-incomplete");
  } else if (facts.seen.some((s) => ownFailed(s) && !s.consumed)) {
    pendingReasons.add("search-incomplete");
  }

  if (failed !== undefined) {
    const by = failed.by;
    if (by === undefined) return { state: "failed", reason: failed.reason, finality: ledger.final, foreign: foreignOf(undefined) };
    const carries = by.carries ? reasonOf(by) : undefined;
    return {
      state: "failed",
      reason: failed.reason,
      ...namedOf(by),
      ...(failed.reason === "instrument-consumed" && carries !== undefined ? { carries } : {}),
      foreign: foreignOf(by),
    };
  }

  if (!facts.search.whole) pendingReasons.add("search-incomplete");
  const first = PENDING_ORDER.find((r) => pendingReasons.has(r));
  if (first !== undefined) return pending(first, first === "below-mark" ? below : undefined);
  if (facts.value === undefined && !facts.history) return { state: "unreadable", reason: "history-gap", foreign: foreignOf(undefined) };
  return pending("not-found", undefined);

  function pending(reason: PendingReason, by: Seen<Position, Mark> | undefined): StatusAnswer<Position, Mark, Cursor> {
    return {
      state: "pending",
      reason,
      ...(by === undefined ? {} : namedOf(by)),
      ...(facts.search.at === undefined ? {} : { search: facts.search.at }),
      foreign: foreignOf(by),
    };
  }
}

function namedOf<Position, Mark>(s: Seen<Position, Mark>): Named<Position, Mark> & { transaction: string; finality: Mark } {
  return {
    transaction: s.transaction,
    ...(s.position === undefined ? {} : { position: s.position }),
    finality: s.mark,
    ...(s.moved === undefined ? {} : { moved: s.moved }),
    ...(s.signer === undefined ? {} : { signer: s.signer }),
    ...(s.authority === undefined ? {} : { authority: s.authority }),
  };
}

function itemOf<Position, Mark>(s: Seen<Position, Mark>, reason: ForeignReason): ForeignItem<Position> {
  return {
    transaction: s.transaction,
    ...(s.position === undefined ? {} : { position: s.position }),
    ...(s.signer === undefined ? {} : { signer: s.signer }),
    ...(s.moved === undefined ? {} : { moved: s.moved }),
    reason,
  };
}
