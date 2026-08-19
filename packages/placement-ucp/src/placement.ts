import {
  makePlacement,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { UCP_PLACEMENT } from "./manifest.js";

const base = makePlacement(UCP_PLACEMENT);

/**
 * The UCP reference placement — the kit plus ONE protocol rule the kit cannot know.
 *
 * `makePlacement(UCP_PLACEMENT)` supplies everything structural: the tagged-array write into `policies[]`,
 * the tagged-array read of the `links` discovery alias, strength-ordered extraction, purity, and every
 * refusal the vectors pin. (An earlier revision described a dotted-key capability write through the
 * container's `segments`; that carrier was retired when UCP turned out to define no `extensions` map, and
 * `segments` now has no shipped declarer.) This
 * file adds only the rule that is UCP's semantics rather than any container's mechanics: **a terms link must
 * be HTTPS.** An `http:` URL is rewritable in transit, so accepting one would put an unauthenticated document
 * behind a reference the record cites.
 *
 * This is the composition the kit is shaped for — generic mechanics, protocol-specific semantics layered on
 * top —
 * and it wraps `extract`, not `place`: `place` never writes the links alias (the terms URL is the
 * DEPLOYMENT's datum, not the reference — see the manifest), so the write side has no URL to police.
 *
 * **Scoped to url-typed results, deliberately.** A sha256 answer must never be blocked by a bad link sitting
 * beside it — the capability WINS over links, and refusing the winner for the loser's defect would invert the
 * strength order. The vector "the capability WINS over links when both are present — even when the link is
 * http:" pins exactly this. The scope is by TYPE, not by which carrier answered: a url-typed reference is
 * legal in the capability too, and an http: URL there is exactly as rewritable as one in `links`.
 */
export const ucpPlacement: ReferencePlacementAdapter = {
  ...base,
  extract(doc: unknown) {
    const out = base.extract(doc);
    if ("refused" in out) return out;
    const { ref } = out.value;
    if (ref.type === "url" && !ref.value.startsWith("https://"))
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "ucp/insecure-terms-url",
        detail: `a terms link must be HTTPS — an http: reference is rewritable in transit: ${ref.value}`,
      };
    return out;
  },
};
