/**
 * Every pairing's `broadcaster` member: who puts what the payer presents on its rail. `"payer"` when the payer sent the
 * payment before presenting it, so the seller reads a landed payment; `"payee"` when the seller, or the facilitator or
 * processor acting for it, sends or executes what was presented. Pure: no reader, no peer.
 */
import { isRefusal, type Refusal } from "../refusal.js";

/**
 * Who broadcasts what a payer presents under a pairing: `"payer"`, which sent the payment before presenting it, or
 * `"payee"`, the seller, or the facilitator or processor acting for it, which sends or executes it after.
 */
export type Broadcaster = "payer" | "payee";

/** The `broadcaster` of a pairing whose every payment takes one path: `answer`, read from nothing presented. */
export function broadcasts(answer: Broadcaster): (presented: unknown) => Promise<Broadcaster> {
  return async (_presented: unknown) => answer;
}

/**
 * The `broadcaster` of a pairing that takes more than one kind of payment: the answer `kindOf` reads from what is
 * presented. Where it reads none, the refusal `bound` gives the same input, so the two never refuse one input with two
 * codes, or `fallback`'s refusal where `bound` takes that input.
 */
export function broadcastsByKind(
  kindOf: (presented: unknown) => Broadcaster | undefined,
  bound: (presented: unknown) => Promise<unknown>,
  fallback: () => Refusal,
): (presented: unknown) => Promise<Broadcaster | Refusal> {
  return async (presented: unknown) => {
    const kind = kindOf(presented);
    if (kind !== undefined) return kind;
    const b = await bound(presented);
    return isRefusal(b) ? b : fallback();
  };
}
