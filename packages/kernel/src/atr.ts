/** v0.3 recourse elections (governing law distinct from forum; liability allocation). */
export type Recourse = {
  governingLaw?: string;
  forum?: string;
  disputeMethod?: string;
  liabilityAllocation?: unknown;
  returns?: unknown;
};

/**
 * The ATR v0.3 — required lcp+terms+id, optional proportional slots, unknown keys preserved.
 * This is the shape of the artifact `atrHash` is taken over, not a wrapper around one.
 * Anchored by vectors/atr/schema.json (the tree is the source of truth); the runtime opinion is
 * assemble()'s fail-fast checks — the kernel carries no validator (zero-dep).
 */
export type Atr = {
  lcp: "0.3";
  terms: string;
  id: string;
  identity?: unknown;
  spendAuthority?: unknown;
  acceptanceAuthority?: unknown;
  intent?: unknown;
  offer?: unknown;
  regime?: "arms-length" | "augmented"; // regime discriminant (CMP-2); absent = arms-length
  standingTrust?: {
    identityRoot?: string;
    agreement?: string;
    baselineHash?: `0x${string}`;
  }; // CMP-2's explicit references
  recourse?: Recourse;
  declarations?: unknown;
  caps?: unknown;
  [slot: string]: unknown; // open extensibility — unknown keys preserved
};
