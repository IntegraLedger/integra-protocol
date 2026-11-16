/**
 * The option's payee, which a pairing's `reference` takes from the option the payment answers: the key of the read's
 * two party tests (the profile `read-status`, rules 8 and 9), and no search key.
 */
import { decodeObject, isChallengeShape } from "../mpp-challenge.js";
import { refusal, type Refusal } from "../refusal.js";

/** An x402 option's `payTo`, a non-empty string; anything else is `x402/option-malformed`. */
export function x402Payee(option: unknown): string | Refusal {
  if (typeof option !== "object" || option === null) return refusal("x402/option-malformed");
  const payTo = (option as { payTo?: unknown }).payTo;
  return typeof payTo === "string" && payTo.length > 0 ? payTo : refusal("x402/option-malformed");
}

/**
 * An MPP challenge's payee: the decoded request's `recipient`, a non-empty string. A value that is not a challenge is
 * `mpp/challenge-malformed`, and a request that does not decode to an object with that member `mpp/request-malformed`.
 */
export function mppPayee(challenge: unknown): string | Refusal {
  if (!isChallengeShape(challenge)) return refusal("mpp/challenge-malformed");
  const request = decodeObject(challenge.request);
  const recipient = request === undefined ? undefined : request["recipient"];
  return typeof recipient === "string" && recipient.length > 0 ? recipient : refusal("mpp/request-malformed");
}
