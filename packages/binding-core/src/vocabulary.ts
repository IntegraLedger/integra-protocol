/** Why something stopped, in three kinds that must not be flattened into one. `risk-block` and
 *  `policy-rejection` are a COUNTERPARTY's decision not to proceed — the record notes it and takes no
 *  view; `verification-failure` is this implementation saying the evidence does not support the claim.
 *  Collapsing them would make a seller's own risk decision read as a failed verification. */
export type HaltClass =
  | "risk-block"
  | "policy-rejection"
  | "verification-failure";
/** Refusals are values, not exceptions. */
export type Refusal = {
  refused: true;
  haltClass: HaltClass;
  code: string;
  detail?: string;
};
/** Success or a {@link Refusal} — the return type of every adapter method.
 *
 *  **Narrow with `"refused" in outcome`, not with `outcome.ok`.** `Refusal` carries no `ok` property at
 *  all, so TypeScript cannot discriminate on one and `outcome.ok` is a compile error on the union;
 *  `refused` is the member present on exactly one arm. There is no thrown-exception path to catch
 *  instead — a refusal is an answer the record keeps, not an error the caller recovers from. */
export type Outcome<T> = { ok: true; value: T } | Refusal;

/** LCP §8.3 binding-pattern vocabulary — same rationale as HaltClass: the names are load-bearing,
 *  and a manifest that cannot say "id-reuse" will misdeclare one as a native field. */
export type BindingPattern =
  | "native-field"
  | "overlay-contract"
  | "sidecar-attestation"
  | "opaque-challenge"
  | "id-reuse"
  | "protocol-extension"
  | "http-advisory";

/** Whether — and how — a binding's recovery path observes the settled asset. "filtered": recovery reads
 *  the token's own log, so the record proves THIS token moved. "carried": the token's identity is written
 *  into the record itself. "proposal-only": the asset is named at proposal but never re-checked at
 *  recovery. "none": recovery never observes the asset — the weld rides the transaction envelope, which is
 *  indifferent to its payload (the same property that makes the rail asset-independent). Four values
 *  because measurement found four cases; a boolean cannot express "proposal-only" honestly. Same rationale
 *  as zeroPartyRecoverable: a weaker evidentiary claim is declared as weaker, never flattened into
 *  equality — and never enforced, which would end the envelope rails' asset-independence and cross the
 *  recorder-not-judge line. */
export type AssetBinding = "filtered" | "carried" | "proposal-only" | "none";

/** HOW a binding's recovery path knows the settlement actually happened — the sibling axis to
 *  `assetBinding`. That one declares whether recovery observes WHAT moved; this declares whether it
 *  observes THAT anything moved. The question is load-bearing because a rail that cannot tell a failed
 *  transaction from a settled one will mint a settlement record out of a failure — fee charged, nothing
 *  moved — which needs no payment at all and is the strongest misreport a binding can make.
 *
 *  "raw-field": the rail RECORDS failed transactions along with their weld payload, so the reader must
 *  supply the chain's own outcome field and the pure recovery gates on it (`err` on solana, `validated`/
 *  `engineResult` on xrpl, `result` on hedera, `success`/`vm_status` on aptos, Horizon `successful` on
 *  stellar, `valid_contract` on cardano). Fail-closed: absent is never evidence of success.
 *
 *  "structural": the rail CANNOT produce a failed transaction that still carries a weld, so no field is
 *  read and none is needed — a reverted EVM transaction emits no logs, an aborted Sui PTB discards its
 *  events, and a Daml command that did not commit leaves no contract. The claim is about the rail, so it
 *  is only as durable as the reader's data source: sourcing events from something that survives a failure
 *  (a dry-run, a mempool feed, an archived-contract query) breaks it and demands "raw-field" instead.
 *
 *  Deliberately NO third value. "recovery cannot tell" is not a posture a profile may publish — it is the
 *  defect the 2026-08-03 sweep closed on stellar and cardano. This differs from `assetBinding`, whose
 *  "none" IS honest: a rail may legitimately not observe the asset (that indifference is what makes the
 *  envelope rails asset-independent), but no rail may legitimately not observe settlement and still claim
 *  to record one. A rail that cannot gate has nothing to declare here — it has a bug to fix. */
export type SuccessGate = "raw-field" | "structural";
