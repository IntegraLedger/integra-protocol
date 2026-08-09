import {
  makePlacement,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { VISA_TAP_PLACEMENT_TIER_A } from "./manifest.js";

/**
 * The Visa TAP reference placement. The manifest IS the adapter (S7) — there is nothing else here, and that
 * is a claim about the protocol, not brevity for its own sake.
 *
 * `header-map` supplies every mechanic this placement needs: the RFC 9110 case fold on read, the
 * existing-key-casing reuse on write so this placement never ADDS a second spelling of one HTTP field
 * (a document that arrived with two is not repaired either — README), creation of an absent header map,
 * replacement of an unmergeable one, purity, and every refusal the vectors pin. TAP adds no
 * semantic rule on top — unlike UCP, whose terms link must be HTTPS, the only thing this header can hold is
 * an atrHash, and the §8.1 codec already rules on that. A wrap here would be a third override of the kit
 * with nothing to justify it.
 *
 * **A CONSTANT, not a factory.** The header name is fixed by this package, not by the deployment: it is an
 * ordinary custom HTTP field, so there is no namespace to parameterize and nothing a caller could supply that
 * would make the header any more bound than it is. The export set is pinned by a test for the related
 * reason — no helper here may build an unsigned sibling body object.
 */
export const visaTapPlacement: ReferencePlacementAdapter = makePlacement(
  VISA_TAP_PLACEMENT_TIER_A,
);
