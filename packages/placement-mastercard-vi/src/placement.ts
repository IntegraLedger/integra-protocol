import {
  makePlacement,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { mastercardViManifest } from "./manifest.js";

/**
 * Build the Mastercard VI placement for a deployment's own reverse-domain namespace.
 *
 * **DECLARATION ONLY — `place` refuses, and that is the ruling, not a gap.** The manifest is the
 * machine-readable statement of where an LCP reference WOULD sit in a VI mandate, and it is exact. What is
 * withdrawn is emitting one. LCP v1.38 §C.7, closing "Tier B — there is no Tier A carrier":
 *
 * > A deployment **MUST NOT** write an unregistered legal-context constraint into a VI mandate and expect
 * > it to travel.
 *
 * The reasoning is the host's own and leaves no carrier. Only the OPEN mandates carry a `constraints`
 * array, and there "regardless of strictness mode, verifiers MUST reject open mandates containing unknown
 * constraint types" — an unevaluable constraint would leave the agent's authority unbounded. The
 * Immediate-mode credentials that a permissive verifier would tolerate carry no `constraints` array at all.
 * So the permissive skip rule has nothing to skip in, and a written constraint does not degrade gracefully:
 * **it causes the whole mandate to be rejected**, which is worse for the deployment than the carrier simply
 * not existing.
 *
 * **`tier: "B"` IS A LABEL, NOT A GATE — which is why the refusal is in code here.** `binding-core` gates
 * `place()` on `writeCondition` alone and never reads `tier`, so declaring Tier B does not stop a writer
 * from writing. Nothing but this refusal does.
 *
 * **`extract` is unchanged and is the point of the package.** A counterparty who does write such a
 * constraint — a deployment controlling both ends, where the mandate never meets a stock verifier — holds a
 * real reference, and reading it costs nothing. Refusing to read would discard evidence over a
 * disagreement about whose mandate it is.
 *
 * A FACTORY because the namespace is the deployment's and has NO default — `mastercardViManifest` throws on
 * an empty, malformed or reserved one, so no argument means no adapter. The namespace reaches the reader
 * through `container.tag`, which is what makes it matched EXACTLY: another deployment's namespaced
 * constraint is not our reference, and reading it would attribute one deployment's terms to another's
 * credential.
 */
export function makeMastercardViPlacement(
  reverseDomain: string,
): ReferencePlacementAdapter {
  const manifest = mastercardViManifest(reverseDomain);
  const kit = makePlacement(manifest);
  return {
    manifest,
    extract: kit.extract,
    place: () => ({
      refused: true,
      haltClass: "verification-failure",
      code: "mastercard-vi/tier-b-not-writable",
      detail:
        "this placement is declaration-only: LCP v1.38 §C.7 states a deployment MUST NOT write an unregistered legal-context constraint into a VI mandate, because open mandates carrying an unknown constraint type MUST be rejected in whole by any conformant verifier — the manifest records where the reference would sit if the type were registered, and `extract` reads one a counterparty wrote",
    }),
  };
}
