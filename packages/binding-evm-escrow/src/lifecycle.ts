/**
 * The escrow lifecycle as a discriminated union — illegal states are not constructible. The
 * `charged` state is terminal for COLLECTION (the one-step charge path — no authorize/capture follows),
 * but `refunded` stays reachable within `refundExpiry`, which is exactly the manifest's
 * `finality: { reversible: true }`: an on-rail refund, not a capture reversal — the two answer different
 * questions and both hold. Transitions join on the indexed `paymentInfoHash`.
 */
export type EscrowState =
  | { s: "proposed" }
  | { s: "authorized"; amount: bigint }
  | { s: "captured"; amount: bigint }
  | { s: "charged"; amount: bigint }
  | { s: "voided" }
  | { s: "reclaimed" }
  | { s: "refunded"; amount: bigint };

/** The six on-chain escrow events (`AuthCaptureEscrow`) that drive lifecycle transitions. */
export type EscrowEventName =
  | "PaymentAuthorized"
  | "PaymentCaptured"
  | "PaymentCharged"
  | "PaymentVoided"
  | "PaymentReclaimed"
  | "PaymentRefunded";

/** The lifecycle state name each event lands in (the manifest's `lifecycleStates`, minus the off-chain
 *  `proposed`). Used to label `observe`'s transitions. */
export const EVENT_TO_STATE: Record<EscrowEventName, EscrowState["s"]> = {
  PaymentAuthorized: "authorized",
  PaymentCaptured: "captured",
  PaymentCharged: "charged",
  PaymentVoided: "voided",
  PaymentReclaimed: "reclaimed",
  PaymentRefunded: "refunded",
};

/** Build the discriminated `EscrowState` for an event + its amount (amount ignored for void/reclaim). */
export function stateFor(event: EscrowEventName, amount: bigint): EscrowState {
  switch (event) {
    case "PaymentAuthorized":
      return { s: "authorized", amount };
    case "PaymentCaptured":
      return { s: "captured", amount };
    case "PaymentCharged":
      return { s: "charged", amount };
    case "PaymentVoided":
      return { s: "voided" };
    case "PaymentReclaimed":
      return { s: "reclaimed" };
    case "PaymentRefunded":
      return { s: "refunded", amount };
  }
}
