/**
 * The pieces a pairing's `status` shares when it turns what its read observed into the profile `read-status`'s facts:
 * its ledger from the pairing's coverage and its marks in ascending order, the check of a query's act and finality,
 * and the row of a transaction the read identified as the payer's act.
 */
import { isObject } from "../fields.js";
import type { Coverage } from "./registry.js";
import type { Ledger, Seen, StatusAnswer } from "./read.js";

/** The ledger of a pairing whose marks are `marks`, lowest first, the last final. */
export function ledgerOf<Position, Mark>(
  coverage: Coverage,
  marks: readonly Mark[],
  positionOrder: (a: Position, b: Position) => number,
): Ledger<Position, Mark> {
  return {
    coverage,
    final: marks[marks.length - 1]!,
    markOrder: (a, b) => marks.indexOf(a) - marks.indexOf(b),
    positionOrder,
  };
}

/** Bigint positions in their numeric order. */
export function bigintOrder(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Number positions in their numeric order. */
export function numberOrder(a: number, b: number): number {
  return a - b;
}

/**
 * True for a query whose act is `payment` or `agreement`, whose finality is one of `marks`, whose `others`, where given,
 * is an array of objects, and whose `after`, where given, passes `isPosition`.
 */
export function isQuery<Mark>(query: unknown, marks: readonly Mark[], isPosition: (p: unknown) => boolean): boolean {
  if (!isObject(query)) return false;
  if (query["act"] !== "payment" && query["act"] !== "agreement") return false;
  if (!marks.includes(query["finality"] as Mark)) return false;
  const others = query["others"];
  if (others !== undefined && !(Array.isArray(others) && others.every(isObject))) return false;
  return query["after"] === undefined || isPosition(query["after"]);
}

/** The answer to a query that is not one: unreadable, unparseable. */
export const UNPARSEABLE: StatusAnswer<never, never> = Object.freeze({ state: "unreadable", reason: "unparseable", foreign: [] });

/**
 * The row of a transaction the read identified as the payer's act, signed by the payer, of the pairing's kind, and
 * naming the payee's account: `succeeded`, or included with a failed result, which consumed the single-use value
 * where `consumed`.
 */
export function actSeen<Position, Mark>(
  transaction: string,
  mark: Mark,
  position?: Position,
  result: "succeeded" | "failed" = "succeeded",
  consumed = true,
): Seen<Position, Mark> {
  return {
    transaction,
    ...(position === undefined ? {} : { position }),
    mark,
    result,
    consumed,
    carries: true,
    party: "payer",
    kind: "same",
    account: "payee",
  };
}
