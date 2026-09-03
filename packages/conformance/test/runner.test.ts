import { describe, expect, it } from "vitest";
import { CliSubject } from "../src/adapters/cli.js";
import { InProcessSubject } from "../src/adapters/inprocess.js";
import { runCorpus } from "../src/runner.js";

const VECTORS = new URL("../../../vectors/", import.meta.url); // the repo's canonical tree — stated, never guessed

/**
 * The exact size of the corpus at the wired phase, pinned deliberately.
 *
 * `toBeGreaterThan(0)` cannot tell a full corpus from a truncated one: drop an area from the manifest, or
 * a case from a vector file, and a count-free assertion stays green while coverage silently shrinks. That
 * is the one failure mode a vectors-gated design cannot afford, because every downstream claim of
 * conformance is a claim about this number. Raising it when vectors are added is the intended friction —
 * it makes growth a decision and shrinkage a build failure.
 */
// 806 → 808 on 2026-08-03: the successGate axis added its two negative cases (a profile missing the field,
// and one carrying a value outside the two-token enum) — the same pair assetBinding carries. Injecting the
// field into the 37 existing profile objects added no cases; only these two did.
// 808 → 819 on 2026-08-04: `verify.identity` registered IDN-1/IDN-3 as a NORMATIVE area (11 cases). The
// resolve-party semantics were previously pinned only in our own unit suite, so an independent
// implementation could prove attribution from an identity naming no party and no method and still pass
// conformance — the hole verify 0.11.0 closed in our code, left open in the standard. Canary-checked: the
// pre-0.11.0 permissive step fails 7 of the 11.
// 819 → 822 on 2026-08-07: `verify.authorityWalk` pinned `authorityStep`'s totality over its bounds slots
// (three cases: absent, non-object, and null). The step reached `isWithin` with unwalkable slots and threw
// out of a module whose stated contract is totality, so an independent implementation could crash where this
// one now reports `malformed-authority-chain` — and both would have passed conformance. Canary-checked: the
// unguarded step fails all 3, two by throwing and one by answering `failed` on a bounds it never read.
// 822 → 823 on 2026-08-07: the ARRAY arm of the same guard. `typeof [] === "object"` and `[] !== null`,
// so the first two terms admit it and `Object.keys([])` answers `[]` rather than throwing — an array would
// read as an UNBOUNDED bounds. It is the only input that distinguishes the `Array.isArray` term, which a
// surviving mutant proved: the guard was written before this case existed and the mutation ratchet caught it.
// 823 → 826 on 2026-08-07: `verify.identity` pinned the assurance half of IDN-3 (absent level, blank level,
// and the gate read on the seller side). `resolve-party` gated `subject` and `via` but never `assurance`, so
// an identity stating no level at all read `proved` — presence substituting for statement, the exact
// misreading these cases exist to make unpassable. Canary-checked: the ungated step reads all three `proved`.
// 826 → 832 on 2026-08-08: `verify.authorityWalk` pinned the revocation and liveness slots. `authorityStep`
// read an ABSENT `revoked` as unrevoked and an absent `active` as live, and PROVED on both — the permissive
// direction of the one rule the module states in capitals, and the only step that broke it. Six cases: the
// two gaps by name, the two non-boolean shape errors, the precedence pin (a widened link still FAILS with
// the slots absent, because a contradiction outranks a gap), and the per-hop pin (a later hop's omission is
// not covered by an earlier hop's statement). Nineteen existing cases omitted both slots and were completed
// wherever their own subject was delegation, depth or bounds — the two multi-hop failure cases had only
// their PRECEDING hops completed, so each still fails at the hop it is named for. Canary-checked against
// the permissive step: it fails 5 of the 6. The sixth — the precedence pin — passes under BOTH readings and
// is kept deliberately: it discriminates nothing about this change and everything about a future one, since
// hoisting the revocation gate above `isWithin` would turn that contradiction into a gap and break it.
// 832 → 835 on 2026-08-08: RCS-4's conditional rung. An ATR may carry its terms INLINE or by
// `lcp:sha256:` REFERENCE, and for the ref form the package must retain the referenced document —
// `manifest.schema.json` stated that rule and nothing enforced it, so a package holding a fingerprint of
// a document nobody kept cleared RCS-4 and carried a record to TC-3. Three cases: the omission
// (`referenced-terms-not-retained`), the ref form WITH the document (proved), and the inline form, which
// needs no such role because the ATR artifact IS the document. The third is what makes the rule
// conditional rather than a new unconditional role. Canary-checked: the pre-fix step passes 2 of the 3
// and fails the omission case, which is the only one that discriminates.
// 835 → 839 on 2026-08-08: the discovery document's non-blank rule. `disputeResolution.{method,
// jurisdiction,contact,source,catalog}`, `returns`, `api` and `contact.{legal,technical}` were bare
// optional strings, so `""` validated — and a §4.2 policy engine testing PRESENCE of
// `disputeResolution.method` reads a blank as present, which is strictly worse than absent because an
// absent field at least reads as absent. LCP §2.5 imposes no such rule, so this is the tree applying its
// own "an empty election is not an election" discipline consistently. Four cases: blank, whitespace, the
// same rule on the contact block, and a real election that must still validate.
// 839 → 825 on 2026-08-08: placement-acp's top-level carrier WRITE was retired (LCP v1.38 §C.2 —
// CheckoutSessionBase is additionalProperties:false and CheckoutSession is a bare allOf over it, so no
// ExtensionDeclaration can authorise a new top-level key; measured INVALID with ajv 8.20 against
// spec/2026-04-17). Fifteen cases went with it: the six that asserted the write, and the nine whose whole
// subject was whether the two-term gate permitted it. They were DELETED rather than reworked into
// refusals, because the path they covered no longer exists and a case named for a gate that is gone would
// mislead the next reader. One case replaced them — a session that DECLARES the extension and still gets
// only the `metadata` carrier, which is the exact document shape that would previously have been written
// into. The READ side is untouched: `extract` still reads the top-level path, because a counterparty who
// emits one holds a real reference.
// 825 → 826 on 2026-08-08: Canton gained a SECOND rail and therefore a second published profile. The
// LcpAnchor overlay stays for the deployments x402's exact-Canton scheme cannot reach — it settles Canton
// Coin only — and `canton:x402` binds the scheme's own `extra.memo`, which is the stronger carrier
// wherever it applies. One case, for the new profile's schema validation.
// 826 → 827 on 2026-08-08: placement-ucp's canonical carrier moved from an `extensions` map UCP does not
// define to a `policies[]` entry, and gained one case — a counterparty's EXISTING policy entry keeps its own
// `description` when our reference is merged in. Verified at UCP HEAD: checkout.json has eighteen properties
// and `extensions` is not among them, while `additionalProperties: true` meant the old write landed and was
// never read. Silent, which is worse than rejected.
// 827 → 810 on 2026-08-08: placement-mastercard-vi became DECLARATION-ONLY. LCP v1.38 §C.7, closing
// "Tier B — there is no Tier A carrier" —
// "A deployment MUST NOT write an unregistered legal-context constraint into a VI mandate and expect it to
// travel" — and the host leaves no carrier: only OPEN mandates carry a constraints array, and there
// "verifiers MUST reject open mandates containing unknown constraint types", while the Immediate-mode
// credentials a permissive verifier would tolerate carry no constraints array at all. A written constraint
// does not degrade; it gets the WHOLE mandate rejected. Eighteen place cases deleted rather than reworked —
// the path they covered is gone — and one replaces them, using the checkout OPEN mandate the withdrawn
// writeCondition permitted, so it fails if the write ever returns. Every extract case survives: a
// counterparty who writes one holds a real reference, and reading it costs nothing.
// 810 → 812 on 2026-08-08: LCP v0.1.38 §2.5's new RECOMMENDED — an atrHash is EMITTED lowercase — with
// its companion negative. The second case is the one that matters: `url` must pass through with its case
// EXACTLY intact, because a URL's path and query are case-sensitive and folding one would rewrite the
// reference into a different document. The same holds for the other content-addressed types (base58btc
// CIDs are mixed-case, Arweave ids are base64url), so the normalization is scoped to sha256 alone. Read
// side untouched: visa-tap pins that `extract` returns a received value verbatim.
// 812 → 844 on 2026-08-19: the terms-URL half of the placement seam gains its write path and its
// certification (integra-protocol#8). Every extract expectation becomes the ExtractedAdvertisement —
// reference plus a typed terms-URL reading — every slot-declaring manifest gains the advertisement
// refusals (terms-url-missing, terms-url-malformed, mismatch), every slot-less manifest gains
// terms-url-unplaceable, and every protocol gains a ROUNDTRIP case: place then extract in one op, the
// composition certification whose absence let two separately-conformant halves ship jointly broken.
// 844 → 847 on 2026-08-19, from the audit remediation: `discovery` certifies that a UCP business profile
// omitting the OPTIONAL `spec` is read rather than refused; `report.schema` gains a report missing
// `claimedClass`, now a required member; and `placement.ucp` gains the terms-url-missing refusal, which
// UCP could not state while its manifest declared no slot for a locator its host has always had.
// 847 → 848 on 2026-08-31: `envelope.assemble` gains the refusal for a number beyond the safe-integer
// range in any slot. Its sibling case moved rather than being added — the old pin carried `exp: 1e21`
// and asserted that raw numbers outside `caps` are byte-stable, which is true and no longer reachable,
// because above 2^53 the engine cannot know whether the double it holds is the literal the caller wrote.
// 2026-09-02: area ids envelope.assemble/envelope.schema became atr.assemble/atr.schema. Size unchanged —
// the corpus moved, nothing was added or removed.
// 848 → 852 on 2026-09-02: `atr.assemble` gains three reserved-slot refusals — `atrVersion` as a caller's
// slot, which the kernel had refused since the member existed and the corpus had never asked; and bare
// `lcp` and `atr`, which name the specification and the record — plus one preservation case pinning
// `lcpVersion` open as the ordinary name for a profile's targeted specification version.
// 852 → 856 on 2026-09-02: `verify.authorityWalk` gains four `parentDelegable` cases — three non-boolean
// shapes the truthiness read had proved (the strings "false" and "0" among them, so the word denying
// permission read as permission), plus a control pinning that an ABSENT flag still FAILS under ATA-3's
// restrictive default rather than becoming a gap alongside them.
const CORPUS_SIZE = 856;

describe("conformance runner", () => {
  it("runs the WHOLE corpus green in-process, with nothing skipped", async () => {
    // Phase P8 is the wired floor, so this is every area. Running without an explicit phase defaults to
    // P1, which exercises 95 cases — well under CORPUS_SIZE, and a green that means far less than it
    // appears to. Only P1's share is stated as a literal: it is a property of the P1 areas and does not
    // move when a later phase grows, so unlike a hardcoded total it cannot go stale behind the pin.
    const report = await runCorpus(new InProcessSubject(), {
      vectors: VECTORS,
      phase: "P8",
    });
    expect(report.failed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.passed).toBe(CORPUS_SIZE);
  });

  // Spawns one node subprocess PER case (each loading the full InProcessSubject) — inherently slow, and
  // slower on CI runners, so it gets a generous timeout rather than the 5s default.
  it("runs the WHOLE corpus green over the CLI/stdio door a foreign subject uses", async () => {
    // This door is the reason the corpus is language-neutral, so it must see every area — not just P1.
    // Left at the default P1 it would never exercise a single P3, P4 or P8 class, which would mean
    // the ATA-3, carrier, discovery, verify and placement areas were certified only through the
    // in-process path.
    const fixture = new URL("./fixtures/subject-stdio.mjs", import.meta.url)
      .pathname;
    const report = await runCorpus(new CliSubject("node", [fixture]), {
      vectors: VECTORS,
      phase: "P8",
    });
    expect(report.failed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.passed).toBe(CORPUS_SIZE);
  }, 180_000);

  it("the ladder is CUMULATIVE — running at P3 skips the later-phase areas, never fails them", async () => {
    const report = await runCorpus(new InProcessSubject(), {
      vectors: VECTORS,
      phase: "P3",
    });
    expect(report.failed).toEqual([]);
    // Every area above P3, in manifest order: the three P4 areas and the P8 areas. Pinned as a list
    // rather than a count so that an area skipped for the WRONG reason — a phase typo, say — reads as a
    // named difference instead of an off-by-one.
    expect(report.skipped).toEqual([
      "verify.authorityWalk",
      "verify.classLadder",
      "verify.recourse",
      "verify.identity",
      "vocabulary.protocolId",
      "placement.manifestSchema",
      "placement.acp",
      "placement.ap2",
      "placement.ucp",
      "placement.a2a",
      "placement.x402",
      "placement.ack",
      "placement.mpp",
      "placement.visa-tap",
      "placement.mastercard-vi",
      "placement.dispatch",
      "verify.referencePlacement",
      "discovery.capability",
    ]);
  });
});
