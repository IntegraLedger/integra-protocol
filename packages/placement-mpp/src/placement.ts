import {
  makePlacement,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { MPP_PLACEMENT } from "./manifest.js";

/**
 * The MPP reference placement — the kit and nothing else.
 *
 * `object-path` + `bare-value`/`sha256`: `methodDetails.atrHash` holds the raw hash MPP integrators expect
 * (LCP §C.1), not an `lcp:` string. Every rule this placement obeys is declared in `manifest.ts` and
 * implemented once in `binding-core`, so there is deliberately no body here.
 *
 * MPP is the case where a protocol-specific wrap would be a mistake rather than an omission. The one rule
 * that might tempt one — that the hash must be `0x` + 64 hex — is already the `sha256` carrier's own rule,
 * enforced by the codec on both halves; re-checking it here would put the same rule in two places that can
 * later disagree. The genuinely MPP-specific facts are not read-time predicates at all: `methodDetails` is
 * inside the challenge-bound `request` body, the binding's mechanism is implementation-defined, and each
 * method specification owns its own `methodDetails` schema. Those are statements about deployment, recorded
 * in the manifest and the README, and no `extract` wrapper could check any of them.
 *
 * The explicit `ReferencePlacementAdapter` annotation is required by `isolatedDeclarations`, not decoration.
 */
export const mppPlacement: ReferencePlacementAdapter =
  makePlacement(MPP_PLACEMENT);
