import {
  makePlacement,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { A2A_PLACEMENT } from "./manifest.js";

/**
 * The A2A reference placement — the manifest IS the adapter.
 *
 * `makePlacement(A2A_PLACEMENT)` supplies the whole of it: the `metadata.legalContext` write, the declared
 * snake_case read, canonical-wins ordering, purity, and every refusal the vectors pin. There is nothing to
 * compose on top, and that is a finding rather than an omission — A2A's `metadata` is a
 * `google.protobuf.Struct` whose values the spec constrains only to being representable in JSON, so this
 * protocol asks for no rule the kit does not already hold. UCP needed a wrap because UCP's carrier is a URL
 * and an `http:` URL is rewritable in transit; A2A's carrier has no such semantics of its own.
 *
 * Nothing here knows about Agent Cards or the `A2A-Extensions` header. Both are real and both are Tier A,
 * and neither is a per-transaction reference carrier: see the manifest's docblock for why the Agent Card is
 * `@integraledger/lcp-discovery`'s and not a second carrier entry here.
 */
export const a2aPlacement: ReferencePlacementAdapter =
  makePlacement(A2A_PLACEMENT);
