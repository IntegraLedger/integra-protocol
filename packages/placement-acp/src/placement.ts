import {
  makePlacement,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { ACP_PLACEMENT } from "./manifest.js";

/**
 * The ACP reference placement.
 *
 * There is no adapter body here, and that is the point (U-β — "adding a protocol is data, never a core
 * change"). ACP's container is `object-path`, its encoding is `lcp-string`, and its accepted spellings are
 * declared in the manifest, so `makePlacement` IS the implementation. What would otherwise be ~90 lines of
 * refuse-encode-copy-write and its mirror on read now lives once in `binding-core`, tested exhaustively in
 * `kit.test.ts`, and a defect fixed there is fixed for every protocol at once.
 *
 * **This package is the kit's regression test.** ACP was the first placement ever shipped, and every case in
 * its vector file predating the kit still asserts the same input and the same output — not one edited. If the
 * kit were wrong in any of the behaviours the hand-written body had (refusing a null document rather than
 * fabricating a session, preserving the merchant's own `metadata` keys, structurally copying at every level,
 * refusing a corrupt carrier before it reaches the wire, reading the declared aliases in strength order),
 * those vectors would fail. They pass byte-identical, which is the evidence the abstraction was discovered
 * rather than imposed — and the conditional write added in 2026-07-30 did not move one of them, because a
 * session that declares nothing behaves exactly as it did when the strong carrier was read-only.
 *
 * The protocol-specific reasoning — why `metadata.legal_context` and not a top-level field, why
 * `http-advisory` and not `protocol-extension`, why the declared-extension carrier is written only into a
 * session RESPONSE that authorizes it, why `links` must never be a fallback — lives in `manifest.ts`, where it
 * belongs. This file has nothing to say that the manifest does not already say.
 */
export const acpPlacement: ReferencePlacementAdapter =
  makePlacement(ACP_PLACEMENT);
