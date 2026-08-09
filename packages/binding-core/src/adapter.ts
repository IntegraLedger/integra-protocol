import type { BindingManifest } from "./manifest.js";
// Import port types directly from their modules — NEVER from "./index.js": the barrel re-exports
// this file, so a barrel import is a type-only cycle that trips the no-circular rule (swc does not
// tag type-only edges, so the exemption would not fire).
import type {
  LifecycleTransition,
  SettlementRef,
  VerifierPorts,
} from "./ports.js";
import type { Outcome } from "./vocabulary.js";

/**
 * The port every rail implements — the seam between LCP's record and one settlement system.
 *
 * Four methods, three of them mandatory. `propose` writes the atrHash into whatever the rail's
 * pre-settlement artifact is; `observe` reads a settlement's events back as lifecycle transitions; and
 * `recover` answers the question the whole design exists for — given a settlement, which terms document
 * governed it. `enumerate` is the reverse index and is OPTIONAL because most rails cannot offer one.
 *
 * Two things surprise a first-time implementer. **No method sends a transaction**: a `WeldAdapter` is a
 * reader plus a pure encoder, and `propose` returns the artifact for the caller to submit. And **failure
 * is a returned {@link Outcome}, never a throw** — narrow with `"refused" in result` rather than reaching
 * for `try`. (Not `result.ok`: `Refusal` has no such property, so the union cannot discriminate on it.)
 *
 * What an adapter may claim is bounded by its {@link BindingManifest}: `recovery.zeroPartyRecoverable`
 * says whether `recover` works for someone holding no off-chain state, and `recovery.forwardIndexable`
 * is exactly the declaration that `enumerate` is present.
 */
export interface WeldAdapter {
  manifest: BindingManifest;
  /** bind atrHash into the pre-settlement artifact; flag low-entropy uniqueness. */
  propose(atrHash: `0x${string}`, ctx: unknown): Promise<Outcome<unknown>>;
  /** settlement events → typed lifecycle transitions. */
  observe(
    ref: SettlementRef,
    ports: VerifierPorts,
  ): Promise<Outcome<LifecycleTransition[]>>;
  /** settlement record → atrHash (zero-party recovery where declared). */
  recover(
    ref: SettlementRef,
    ports: VerifierPorts,
  ): Promise<Outcome<`0x${string}`>>;
  /** forward index where declared (else absent). */
  enumerate?(
    atrHash: `0x${string}`,
    ports: VerifierPorts,
  ): Promise<SettlementRef[]>;
}
