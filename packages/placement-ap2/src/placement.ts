import {
  makePlacement,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { AP2_PLACEMENT } from "./manifest.js";

/**
 * The AP2 reference placement — `binding-core`'s placement kit and nothing else.
 *
 * `object-path` writes ONLY `metadata.legalContext`, so the mandate is carried through by reference and
 * cannot be touched: the tier-B shape is unreachable from this package by construction, not by discipline.
 * There is no protocol rule here that the kit cannot know — unlike UCP, whose terms link had to be forced to
 * HTTPS, AP2's carrier holds the reference itself and every rule about it is already the codec's.
 *
 * The mandate-boundary tests still earn their place: they pin the CONSEQUENCE a reader cares about, and they
 * would fail loudly if some future edit widened the write path.
 */
export const ap2Placement: ReferencePlacementAdapter =
  makePlacement(AP2_PLACEMENT);
