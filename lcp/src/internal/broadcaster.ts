/**
 * Every pairing's `broadcaster` member: who puts what the payer presents on its rail. `"payer"` when the payer sent the
 * payment before presenting it, so the seller reads a landed payment; `"payee"` when the seller, or the facilitator or
 * processor acting for it, sends or executes what was presented. Pure: no reader, no peer.
 *
 * It answers only for a payment of a type and kind the pairing takes, within the shape gate its `bound` applies first;
 * for any other payment it gives the refusal `bound` gives that fault. Faults `bound` finds in anything else, such as
 * H, the challenge, an amount or a signature, do not change the answer.
 */
import { isRefusal, type Refusal } from "../refusal.js";

/**
 * Who broadcasts what a payer presents under a pairing: `"payer"`, which sent the payment before presenting it, or
 * `"payee"`, the seller, or the facilitator or processor acting for it, which sends or executes it after. A pairing's
 * `broadcaster` gives this only for a payment of a type and kind the pairing takes, within the shape gate its `bound`
 * applies first; any other payment gets the refusal `bound` gives it.
 */
export type Broadcaster = "payer" | "payee";

/**
 * The `broadcaster` of a pairing whose `bound` applies no shape gate and whose every payment takes one path: `answer`,
 * read from nothing presented.
 */
export function broadcasts(answer: Broadcaster): (presented: unknown) => Promise<Broadcaster> {
  return async (_presented: unknown) => answer;
}

/**
 * The `broadcaster` that answers what `read` reads from what is presented: who broadcasts a payment of a type and kind
 * the pairing takes, or the refusal `bound` gives any other.
 */
export function broadcasterOf(
  read: (presented: unknown) => Broadcaster | Refusal,
): (presented: unknown) => Promise<Broadcaster | Refusal> {
  return async (presented: unknown) => read(presented);
}

/**
 * The `broadcaster` of a pairing whose every payment takes one path: `answer` for a payment `gate` passes, and `gate`'s
 * refusal for any other.
 */
export function broadcastsWithin(
  gate: (presented: unknown) => unknown,
  answer: Broadcaster,
): (presented: unknown) => Promise<Broadcaster | Refusal> {
  return broadcasterOf((presented) => {
    const g = gate(presented);
    return isRefusal(g) ? g : answer;
  });
}
