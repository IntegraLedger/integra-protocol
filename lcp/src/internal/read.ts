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

/**
 * One transfer or deposit an act made, as the read observed it, named by its transaction and its place in it, so that
 * two answers that name one transfer are told from two transfers.
 */
export interface Moved {
  readonly asset: string;
  readonly amount: string;
  /** The account it reached, or the beneficiary a contract names. */
  readonly to: string;
  /** The transaction it was read from. */
  readonly transaction?: string;
  /**
   * Its place in that transaction, in the pairing's own spelling: on EVM the position of its `Transfer` log among the
   * receipt's logs; elsewhere the position of the instruction, operation, output or event it was read from.
   */
  readonly place?: number | string;
  /**
   * Where the ledger states it for the asset, the number of decimals in which `amount` is written: `amount` counts the
   * asset's smallest unit, and the amount in the asset's own unit is `amount` × 10^-`decimals`. Observed, and never
   * compared with anything.
   */
  readonly decimals?: number;
  /**
   * True where the ledger records that the payer signed the payment as one that may deliver less than the amount it
   * names, and `amount` is then what it delivered; absent otherwise. Observed, and never judged.
   */
  readonly partial?: true;
}

/** A transaction that carries H, succeeded, and is not the act asked about. */
export interface ForeignItem<Position> {
  readonly transaction: string;
  readonly position?: Position;
  readonly signer?: string;
  /** The authority the ledger records for its signer, where the read records one. */
  readonly authority?: string;
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

export interface Named<Position, Mark> {
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
      /**
       * Whether the act is the payment the reference was built from: `yes` where every member its form names of the
       * message the payer signed equals the one presented, `no` where one differs, `unshown` where the read could not
       * read every member. It decides no answer.
       */
      readonly presented: "yes" | "no" | "unshown";
      readonly foreign: readonly ForeignItem<Position>[];
    })
  | (Named<Position, Mark> & {
      readonly state: "pending";
      readonly reason: PendingReason;
      readonly search?: Cursor;
      /** On `search-incomplete`, each item the search could not decode, by its transaction, the one it is held at first. */
      readonly undecoded?: readonly string[];
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

/** Whether a landed act is the payment presented, its signed message compared member by member with that payment's. */
export type Presented = "yes" | "no" | "unshown";

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
  /**
   * The account it names against the option's payee's: `none` where it names no account. For a transaction with a
   * failed result, which moved nothing, the destination in what the payer signed, as the pairing identifies it.
   */
  readonly account: "payee" | "other" | "none";
  /** True where the pairing's read matched it to an other act the caller gave by its reference. */
  readonly given?: boolean;
  /**
   * Whether the message signed in it equals, member by member as the pairing's form names them, the payment presented:
   * `yes`; `no` where a member differs; `unshown` where the read could not read every member. A `settled` answer
   * states the act's.
   */
  readonly presented: "yes" | "no" | "unshown";
  readonly moved?: readonly Moved[];
  readonly signer?: string;
  readonly authority?: string;
}

/** An item a search met and could not decode: its transaction, and the search position held at it. */
export interface Undecoded<Cursor> {
  readonly transaction: string;
  readonly at?: Cursor;
}

/** What a pairing's read observed, from which `decide` composes the answer. */
export interface Facts<Position, Mark, Cursor = Position> {
  /** Set where the read established nothing. */
  readonly unreadable?: UnreadableReason;
  /** Every transaction the read met that carries H, consumed the single-use value, or is the one the reference names. */
  readonly seen: readonly Seen<Position, Mark>[];
  /**
   * The single-use value as read: whether it is consumed, whether its validity has passed, and the mark it was read at;
   * and `head`, whether it is consumed at the latest head the endpoint serves, absent where the read did not read it
   * there, which never answers `instrument-live`. Absent where the read has no means to read the value.
   */
  readonly value?: {
    readonly consumed: boolean;
    readonly lapsed: boolean;
    readonly mark: Mark;
    readonly head?: { readonly consumed: boolean };
  };
  /**
   * The search, or the lookup at coverage `none`: `whole` where its range was read to its end and the endpoint answered
   * in the form it documents; `at`, the position to resume from where it was not. On a pairing whose single-use value
   * is H's own carrier (read-status rule 26), the read of the value at the final mark and at the latest head is the
   * search, read whole by those two reads, and such a read reports no item it could not decode, the value admitting no
   * act but one that consumed it.
   */
  readonly search: { readonly whole: boolean; readonly at?: Cursor };
  /**
   * The items the search met and could not decode, however it found them, in the order of their `at`, the earliest
   * first. Each one the caller did not give by its transaction holds the search; one the caller gave holds none, and is
   * named `given`. `at` is the search position held at the item, at or before `search.at` where the search has one, so
   * that the next call reads every item again; where an item that holds the search gives none, the answer gives no
   * search position, and the next call reads the range again from its start.
   */
  readonly undecoded?: readonly Undecoded<Cursor>[];
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
 * `payment` or `agreement` is `unreadable`, `unparseable`, as a malformed reference is. Applies, in order:
 * `before-position` first; the act asked about, identified by its binding and its parties and never one the caller
 * gave, settled at or above the finality asked for and `below-mark` under it; `transaction-failed` only for the act
 * asked about but for its result, any other transaction that consumed the value, whatever its result, being the
 * transaction of `instrument-consumed`; `failed` only at the final mark and, at
 * coverage `full`, only once the search was read whole, an item it could not decode that the caller did not give
 * holding it; a value read consumed, at the final mark or at the latest head, with no transaction found as
 * `search-incomplete`, and so is a value unread beside a failed result of the payer's that the read does not show
 * consumed it; `instrument-live` only where the value reads unconsumed at the final mark and at the latest head;
 * `not-found` only where the reader showed its history, and `history-gap` otherwise; and the `pending` reasons in
 * their order, `search-incomplete` held at the first item it could not decode and naming each. A `settled` answer
 * states `presented` as the read compared the act with what was presented; it never changes which state is answered.
 * Every transaction that carries H, succeeded, is not the act and is not named as the consumer of the value is a
 * foreign item where a reason holds, named with the first; and an item the caller gave by its transaction that the read
 * could not decode is named `given`.
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
  // An item the search could not decode holds it, unless the caller gave it by its transaction; one met twice, by two
  // keys, is one item; and one given that the read also decoded is named once, from what it read.
  const undecoded = (facts.undecoded ?? []).filter((u, i, all) => all.findIndex((v) => v.transaction === u.transaction) === i);
  const holding = undecoded.filter((u) => !givenTx.has(u.transaction));
  const givenUndecoded = undecoded.filter((u) => givenTx.has(u.transaction) && !facts.seen.some((s) => s.transaction === u.transaction));
  const whole = facts.search.whole && holding.length === 0;
  // Held at the first item that holds the search; at none where such an item gives no position, so nothing is skipped.
  const searchAt = holding.length === 0 ? facts.search.at : holding.some((u) => u.at === undefined) ? undefined : holding[0]!.at;
  const bindsAct = (s: Seen<Position, Mark>): boolean => ledger.coverage === "none" || s.carries;
  const isAct = (s: Seen<Position, Mark>): boolean =>
    s.result === "succeeded" &&
    bindsAct(s) &&
    s.party === "payer" &&
    !isGiven(s) &&
    s.kind === "same" &&
    (query.act === "agreement" || s.account === "payee");
  // The act asked about but for its result (rules 7 to 9): at coverage `full` it carries H, and an act `payment` names
  // the payee's account, the destination in what the payer signed. Only such a transaction answers `transaction-failed`.
  const ownFailed = (s: Seen<Position, Mark>): boolean =>
    s.result === "failed" &&
    bindsAct(s) &&
    s.party === "payer" &&
    !isGiven(s) &&
    s.kind === "same" &&
    (query.act === "agreement" || s.account === "payee");
  // Any other transaction that consumed the value, whatever its result, is the transaction of `instrument-consumed`.
  const consumer = (s: Seen<Position, Mark>): boolean => s.consumed && !isAct(s) && !ownFailed(s);

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
  const foreignOf = (except: Seen<Position, Mark> | undefined): ForeignItem<Position>[] => [
    ...facts.seen.flatMap((s) => {
      if (s === except || s.result !== "succeeded" || !s.carries || isAct(s)) return [];
      const reason = reasonOf(s);
      return reason === undefined ? [] : [itemOf(s, reason)];
    }),
    ...givenUndecoded.map((u): ForeignItem<Position> => ({ transaction: u.transaction, reason: "given" })),
  ];

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
      return {
        state: "settled",
        ...namedOf(act),
        transaction: act.transaction,
        finality: act.mark,
        presented: act.presented,
        foreign: foreignOf(act),
      };
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
    } else if (facts.value === undefined || (ledger.coverage === "full" && !whole) || acts.length > placed.length) {
      // No failed where the value is unread, the search not whole, or an act was found that cannot be placed (rule 16).
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
    const v = facts.value;
    // A value consumed at the latest head, though unconsumed at the final mark, was consumed by an act above it.
    if (v.consumed || v.head?.consumed === true) pendingReasons.add("search-incomplete");
    else if (v.lapsed) failedAt("instrument-unused", v.mark);
    else if (isFinal(v.mark) && v.head !== undefined) pendingReasons.add("instrument-live");
    else pendingReasons.add("search-incomplete");
  } else if (facts.seen.some((s) => s.result === "failed" && s.party === "payer" && !s.consumed)) {
    // With the value unread, a failed result of the payer's that the read does not show consumed it, the act's own or
    // another, leaves the value's state unshown: it may have been taken, or the signed act may still land.
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

  if (!whole) pendingReasons.add("search-incomplete");
  const first = PENDING_ORDER.find((r) => pendingReasons.has(r));
  if (first !== undefined) return pending(first, first === "below-mark" ? below : undefined);
  if (facts.value === undefined && !facts.history) return { state: "unreadable", reason: "history-gap", foreign: foreignOf(undefined) };
  return pending("not-found", undefined);

  function pending(reason: PendingReason, by: Seen<Position, Mark> | undefined): StatusAnswer<Position, Mark, Cursor> {
    return {
      state: "pending",
      reason,
      ...(by === undefined ? {} : namedOf(by)),
      ...(searchAt === undefined ? {} : { search: searchAt }),
      ...(reason === "search-incomplete" && holding.length > 0 ? { undecoded: holding.map((u) => u.transaction) } : {}),
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
    ...(s.authority === undefined ? {} : { authority: s.authority }),
    ...(s.moved === undefined ? {} : { moved: s.moved }),
    reason,
  };
}
