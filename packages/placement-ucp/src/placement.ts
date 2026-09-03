import {
  type LegalContextAdvertisement,
  type LegalContextRef,
  makePlacement,
  type ReferencePlacementAdapter,
  type Refusal,
} from "@integraledger/lcp-binding-core";
import { UCP_PLACEMENT } from "./manifest.js";

const base = makePlacement(UCP_PLACEMENT);

/** The one rule, stated once: a url-typed reference on this protocol must be HTTPS. */
function insecureTermsUrl(ref: LegalContextRef): Refusal | null {
  if (ref.type !== "url" || ref.value.startsWith("https://")) return null;
  return {
    refused: true,
    haltClass: "verification-failure",
    code: "ucp/insecure-terms-url",
    detail: `a terms link must be HTTPS — an http: reference is rewritable in transit: ${ref.value}`,
  };
}

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
 * top — and it wraps BOTH directions, because the rule is about the carrier and both directions carry one.
 *
 * ⛔ It wrapped `extract` alone until 2026-09-03, under the reasoning that "`place` never writes the links
 * alias, so the write side has no URL to police". That was already false when it was written and became
 * more so: the policies entry `place` writes carries the reference itself, `url` is a permitted carrier
 * type here, and the kit's own terms-URL slot landed on the same entry. So `place` accepted an `http:`
 * reference and emitted a document this very module's `extract` refuses — a placement that will not read
 * back the bytes it wrote, and a round trip that fails on our own output rather than on a counterparty's.
 * A url-typed reference inside a policies entry is exactly as rewritable in transit as one in `links`.
 *
 * The terms URL was never the gap: the kit already refuses a non-https `termsUrl` at
 * `ucp/terms-url-malformed`. The REFERENCE was.
 *
 * **Scoped to url-typed results, deliberately.** A sha256 answer must never be blocked by a bad link sitting
 * beside it — the capability WINS over links, and refusing the winner for the loser's defect would invert the
 * strength order. The vector "the capability WINS over links when both are present — even when the link is
 * http:" pins exactly this. The scope is by TYPE, not by which carrier answered: a url-typed reference is
 * legal in the capability too, and an http: URL there is exactly as rewritable as one in `links`.
 */
export const ucpPlacement: ReferencePlacementAdapter = {
  ...base,
  place(ad: LegalContextAdvertisement, doc: unknown) {
    // BEFORE the kit writes: a document that has already been written into is a document a caller may
    // reasonably send, and refusing after building it would make the refusal advisory.
    return insecureTermsUrl(ad.ref) ?? base.place(ad, doc);
  },
  extract(doc: unknown) {
    const out = base.extract(doc);
    if ("refused" in out) return out;
    return insecureTermsUrl(out.value.ref) ?? out;
  },
};
