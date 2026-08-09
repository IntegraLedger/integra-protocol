/**
 * One parametric Stryker config for every package, rather than a JSON file each.
 *
 *   pnpm mutation verify      # a single package
 *   pnpm mutation:all         # every package, sequentially
 *
 * A test COUNT says how much ran; a mutation SCORE says how much the tests constrain. A defect can sit
 * under a fully green suite indefinitely; this measures the property a green suite does not establish.
 *
 * THE RUN IS ROOTED AT THE REPO ROOT, not the package. Stryker's TSConfigPreprocessor calls
 * `ts.parseConfigFileTextToJson`, which TypeScript 7's native compiler API removed — the same class of
 * break that forces dependency-cruiser onto its swc parser. Rooting here sidesteps it: nothing the sandbox
 * needs (`tsconfig.base.json`, `vectors/`) then resolves outside the sandbox, so no path rewriting is
 * required.
 *
 * WHAT MUTATION SCORE CANNOT SEE: `conformance` imports each package's built `dist`, not `src`. A corpus
 * vector therefore can never kill a source mutant in another package. Cross-party coverage (the corpus) and
 * mutation-detectable coverage (package tests) are complementary, not substitutes — a rule proven only in
 * the corpus will still read as an unkilled mutant here, and that is correct, not a false positive.
 *
 * WORK DONE AT MODULE SCOPE IS INVISIBLE TO THIS INSTRUMENT, and it reads as the opposite of what
 * happened. A mutant that makes an import — or a `describe` body — throw fails the whole test FILE before
 * any test runs, and vitest then reports zero FAILED tests. Stryker records that as SURVIVED, not killed.
 * Two consequences: build fixtures inside `it`, never in a describe body; and where the source itself
 * throws at import — a `parseAbi` of a malformed signature, say — put the guard in its own file and
 * `await import()` it inside the test, so the failure lands on a test task and names what drifted.
 * `pnpm verify` catches these either way; only the score is fooled.
 *
 * THRESHOLDS ARE RATCHETS. `break` sits just under each package's measured score. Raise it when the score
 * rises; never lower it to make a build pass. A package absent from the table has not been measured yet —
 * it runs at break 0 and prints its baseline.
 */

/**
 * Measured floors — every publishable package, set to the integer BELOW its measured score. Seeding all of
 * them means no package can regress while the weaker ones are brought up. These are records of where each
 * suite stands, not targets to be satisfied with.
 */
const RATCHET = {
  authority: 98,
  // RAISED 89 -> 91. Measured 91.81 twice on 2026-08-09, identical to two decimal places.
  'binding-aptos': 91,
  // RAISED 94 -> 95. Measured 95.48 twice on 2026-08-09.
  'binding-canton': 95,
  // RAISED 94 -> 96. Measured 96.58 twice on 2026-08-09. The floor was seeded at the sibling overlay
  // rail's number when this package split out, and had never been measured against its own suite.
  'binding-canton-x402': 96,
  // RAISED 89 -> 91. Measured 91.37 twice on 2026-08-09.
  'binding-cardano': 91,
  // RAISED 91 -> 92. The conditional-write axis's conjunction (`WriteCondition.and`) measured 92.18 at
  // 625/678, up from 91.95 at 594/646 — the new code came in with 31 more killed mutants and three survivors,
  // and all three are the SEPARATOR literal inside a message (`permits.join("/")`, `.join(" and ")`,
  // `paths.join("/")`). Those are refusal and throw prose: the tests assert the message NAMES every term, which
  // is the contract, and pinning its punctuation would encode one implementation's phrasing as the standard.
  'binding-core': 92,
  // RAISED 97 -> 98. Measured 98.31 on 2026-08-08. `assetWasTransferred` was promoted into this package
  // WITHOUT its tests and landed as fifteen NoCoverage mutants — the ratchet caught a module that had been
  // fully exercised in its old home the day before. erc20.test.ts pins every arm; the floor holds it.
  'binding-evm-common': 98,
  // RAISED 90 -> 97. Measured 97.22 on 2026-08-08 after the recover ambiguity work. The floor had been
  // seven points below the real score, which is the shape the handoff warned about: a ratchet that passes
  // on headroom rather than on kills reports green for a suite that has stopped covering something.
  'binding-evm-escrow': 97,
  // RAISED 96 -> 99. Measured 99.32 twice on 2026-08-09, up from the 96.53 the floor was set at: the
  // §8.3.5 id-reuse work landed with tests. The surviving mutants are refusal `detail` prose literals,
  // left alive deliberately — pinning them would encode one implementation's phrasing as the standard.
  // Everything with behaviour — the derivation, the candidate check, the logIndex disambiguation, the
  // credential-type classifier, the refusal codes — is killed.
  'binding-evm-mpp': 99,
  // Raised 96 → 97 when the deployment registry landed: 97.08 measured, 133/137, and constants.ts itself
  // sits at 100/26. The four survivors are all refusal `detail` prose literals in adapter.ts and
  // permit2-filter.ts, left alive on the same reasoning as binding-evm-mpp above — pinning phrasing would
  // encode one implementation's wording as the standard. The registry's own prose is the exception and IS
  // pinned: its message names the two `cast` calls that produce a correct EIP-712 domain, which is
  // actionable instruction rather than phrasing, and a caller who loses it re-derives a wrong config.
  'binding-evm-x402': 97,
  // RAISED 91 -> 94. Measured 94.33 twice on 2026-08-09, after the MPP attribution-memo discrimination
  // work brought its own tests.
  'binding-hedera': 94,
  // RAISED 91 -> 92. Measured 92.51 twice on 2026-08-09.
  'binding-solana': 92,
  // RAISED 93 -> 97. Measured 97.40 twice on 2026-08-09 — the largest headroom in the tree, and the
  // shape the handoff warned about: a floor four points low passes on headroom rather than on kills.
  'binding-stellar': 97,
  'binding-sui': 97,
  // 94.17 measured over 343 mutants; 20 unkilled = 19 SURVIVED + 1 with NO COVERAGE, and every one is
  // accounted for below. Two different reasons, and conflating them would be the dishonest part — some are
  // prose we decline to pin, the rest are equivalents nothing could kill:
  //   PROSE, deliberately alive (9 survived + 1 no-coverage StringLiteral) — 4 refusal `detail` literals
  //     (adapter 170/177/184, plus the `", "` that joins the ambiguous memos), the 5 `context` arguments
  //     threaded into a thrower's message (adapter 137/250, calls 56, log 162/163), and the message inside
  //     the unreachable throw (adapter 190, no coverage because the line never runs). Killing these pins
  //     wording, not behaviour. The `no-memo-event` detail is NOT in this set any more: it names the scoped
  //     token, and the forged-token test asserts that, so the mutant dies.
  //   EQUIVALENT, unkillable rather than undesirable (10 survived):
  //     - adapter 188 — the defensive throw's own condition; a non-empty transfer set always yields a memo.
  //     - calls 68 ×2, hex 40 ×2 — regex anchors on FIXED-WIDTH slices; `^…{8}$` against an 8-char slice
  //       matches identically with either anchor dropped.
  //     - log 98 ×3 and log 99 — the `fromTopic`/`toTopic === undefined` legs. `log.topics` is a contiguous
  //       array, so topic 3 present implies topics 1 and 2 present, and the `memoTopic === undefined` leg
  //       (which IS killed, as is the whole-condition mutant) returns null first for every shorter shape.
  //       MEASURED, not argued: each of the four was applied to the source in turn with `topics.slice(0,1)`
  //       and `slice(0,2)` probes added, and the suite stayed green at 25/25 all four times.
  //     - hex 48 — dropping `value === undefined` falls through to `Number.parseInt(undefined, 16)` → NaN,
  //       which the next line already maps to the same `null`.
  // Baseline was 84 before the log/hex/calls edge cases were added.
  'binding-tempo-mpp': 94,
  'binding-xrpl': 95,
  // 88 -> 92 on 2026-08-08. Briefly 94, which was WRONG and is the note worth keeping: 94 was set at a
  // single run's 94.47, and the confirming run of the identical tree measured 93.81 and failed its own
  // floor. Nothing in this package changed between them. This suite carries a ~46-second CLI/stdio test,
  // so mutants near the timeout boundary resolve differently under different machine load and the score
  // moves ~0.7 between runs on unchanged code.
  //
  // A ratchet may only rise, which makes an over-raise expensive to undo — so the floor belongs BELOW the
  // observed MINIMUM with margin, never at a single run's maximum. Observed 93.81 and 94.47; floor 93.
  // Raise it from a repeated low, not from one good reading.
  //
  // ⚠ OBSERVED BAND WIDENED 2026-08-09: 92.70 BELOW this floor on unchanged code. Two readings of one
  // tree, minutes apart — 92.70 during a back-to-back run of all 31 packages, 93.58 alone on an idle
  // machine. Same 452 mutants both times; four of them moved between `Survived` and `Timeout`, which is
  // the boundary this note already describes, now measured at ~0.9 rather than ~0.7. So a full-tree
  // mutation sweep can red-flag this package on a tree nobody touched.
  // The floor is NOT lowered — a ratchet only rises — and it is left at 93 knowingly, above the observed
  // minimum.
  //
  // ⚠ CORRECTION, 2026-08-09: an earlier draft of this note said the fix was a package-specific
  // `timeoutMS` generous enough to make classification mutant-dependent. That is BACKWARDS and would have
  // sent the next reader the wrong way. Stryker's allowance is `netTime * timeoutFactor + timeoutMS` with
  // `netTime` taken from the dry run, so a LOADED machine measures a slow baseline, grants a LARGER
  // allowance, times out FEWER mutants — and a timeout counts as killed, so the score goes DOWN. That is
  // the direction actually observed: the idle run had 9 timeouts and 22 survivors (93.58), the loaded run
  // 3 and 26 (92.70). Raising `timeoutMS` would lower the score further, not stabilise it.
  //
  // What the split really says is that up to 9 of this package's "killed" mutants are killed by a CLOCK
  // rather than by an assertion. The honest fix is therefore to make the ~46-second CLI/stdio test fast
  // or to scope it out of the mutation run, so those mutants are judged by a test — real work on the
  // suite, not a knob. Until then: re-run this package ALONE before believing a red from it.
  // Measured 92.92 earlier the same day. The seal work first DROPPED this to 85.29: `seal.ts`
  // arrived with gaps, and the exit-code decision went into `cli.ts` — a top-level-await shell no test can
  // import, so all 30 of its mutants were NoCoverage. The fix was to move the decision into `summary.ts`
  // rather than to accept the score; logic that decides whether a conformance run passes does not belong
  // where nothing can exercise it.
  conformance: 93,
  // RAISED 86 -> 89. The capability declaration (S5) measured 89.94 at 304/338, and
  // `capability-identity.ts` sits at 100. 27 of the 34 unkilled live in `capability.ts` and every one is
  // accounted for: 26 are refusal-message STRING literals, including the two field-name arguments threaded
  // into a thrower's message (`asAcceptedList`'s `field`, `requireAuthorityOrigin`'s second argument) —
  // killing them pins wording, not behaviour. The 27th is a true equivalent: emptying `originOf`'s catch
  // makes it return `undefined` where it returned `null`, and `undefined !==
  // LCP_CAPABILITY_AUTHORITY_ORIGIN` is exactly as true, so no caller can tell.
  //
  // Mutants that LOOKED like prose but were real gaps, killed by vectors rather than excused: dropping
  // `.trim()` from the description guard (a whitespace-only description would have been emitted);
  // collapsing `requireAuthorityOrigin`'s `typeof value === "string"` test (an array-wrapped spec URL
  // string-coerces to a valid URL with the right origin, so the guard would have accepted a spoof); and the
  // three the fix pass added — `readRequired`/`readDescription`'s `null` arms and the blank-string arm,
  // `optionsRecord`'s key whitelist, and `Object.hasOwn` in `get`. Each of those is a behaviour a vector or
  // a package test now names, so a revert reads as a failure rather than a score drift.
  discovery: 89,
  evidence: 86,
  kernel: 92,
  // 100 at 17/17, and the 17 is the point: every mutant lives in the MANIFEST, because
  // `makePlacement(A2A_PLACEMENT)` is the whole adapter and holds no literal to mutate. A2A asks for no rule
  // the kit does not already hold, so a survivor here would mean a manifest value nothing pins.
  'placement-a2a': 100,
  // 100, measured 30/30 with zero survivors (15/15 before the wrap, which doubled the mutant count and left
  // none of it uncovered). A manifest plus `makePlacement(ACK_PLACEMENT)` plus ONE wrap — the ordering rule —
  // and the pinned-manifest equality test kills every StringLiteral mutant in the manifest by construction.
  // The wrap's own branches are covered by the four ordering vectors (issued refuses, unissued places, a null
  // proof places, extract is unguarded) and by the package-local test that pins its `detail` prose. If this
  // ever dips, a branch of the wrap lost its case — fix the tests, never this number.
  'placement-ack': 100,
  // 100, and it can stay there: S7 moved every mechanic into binding-core's kit, so this package is now a
  // manifest plus `makePlacement(ACP_PLACEMENT)`. There is no logic left for a mutant to survive in. Measured
  // 48/48 with the write half's two-term `writeCondition` on board — the gate more than tripled the manifest's
  // literal count (the identifier, the tag, the tag field, the value field, the array path, the permits entry,
  // and the eleven `CheckoutSessionBase.status` values of the document-kind term), and the pinned-manifest
  // equality test kills every one by construction. A dip here means the gate's own values stopped being
  // pinned — fix the pin, never this number.
  'placement-acp': 100,
  // 100 with nothing to argue about: `placement.ts` is one annotated `makePlacement` call, so every mutant
  // Stryker finds (15 of them) is a literal in the manifest, and the pinned-manifest equality test kills the
  // lot. Measured 15/15 at first run. A dip here means the manifest gained a value the vector tree does not
  // pin — fix the pin, never this number.
  'placement-ap2': 100,
  // 100, measured 51/51 — and this is the one placement whose manifest is BUILT, so 50 of the 51 mutants sit
  // in `manifest.ts`: the pinned-manifest equality test kills every literal, and the namespace guard's own
  // branches are killed by the empty / malformed / reserved cases. The Regex mutant that drops the END anchor
  // needed its own inputs (`"com.example "`, `"com.exampleX"`) — a prefix that IS a valid reverse domain with
  // junk after it, which without the anchor would mint a tag carrying a space. If this dips, the guard has
  // lost a case or the manifest gained a value the vector tree does not pin — fix those, never this number.
  'placement-mastercard-vi': 100,
  // 100, and every one of the 12 mutants lives in `manifest.ts`: `placement.ts` is a single annotated call to
  // `makePlacement`, so there is no operator for stryker to flip there at all. The manifest is pinned
  // byte-for-byte against the vector tree AND asserted claim-by-claim (the bare-slot cap, the absent
  // discovery alias, both locators inside methodDetails), so a StringLiteral or ObjectLiteral mutant has
  // nowhere to hide. If this ever dips, the manifest's own guards have gone missing — fix them, not this.
  'placement-mpp': 100,
  // 100 by the same S7 logic — a manifest whose every value is pinned byte-for-byte against the vector tree
  // leaves nothing for a StringLiteral mutant to change unnoticed. Measured at 27/27 before this was set.
  // The HTTPS wrap (P1's next unit) adds real branches; if the score dips below 100 then, the wrap's own
  // tests are missing cases — fix the tests, never this number.
  'placement-ucp': 100,
  // 97, not 100, and the gap is the override: this is the one placement whose `place` is hand-written, so it
  // has real branches for a mutant to sit in. Two survive deliberately — the `document-malformed` detail
  // prose (killable only by pinning phrasing) and the `instanceof CarrierError` re-throw (needs a non-carrier
  // fault injected, which would be a mock). `ext !== null` used to survive as a true equivalent mutant on the
  // reasoning that `{...null}` IS `{}`; that stopped being true when a present-but-unmergeable `extensions`
  // began to REFUSE, and the null-extensions vector now kills it. Measured 97.40 at 50 tests.
  'placement-x402': 97,
  // 100 again, and for the strongest of the three reasons: this package is a manifest plus
  // `makePlacement(...)`, with no wrap at all — `header-map` needs no protocol rule the kit cannot know.
  // Measured 11/11 killed. Every mutant lives in a manifest value the pinned-manifest equality test compares
  // byte-for-byte, so a dip below 100 means the manifest and the vector tree have parted company.
  'placement-visa-tap': 100,
  // 100, measured 52/52 with zero survivors on the first run. Data plus three total functions, and every
  // mutant lands somewhere a test looks: the nine registration ObjectLiterals and their `kind` discriminants
  // die on the key-matches-manifest loop and the kind census, the `namespaced` branch and its throw message
  // die on the two factory tests (no namespace → throws naming what is owed; two namespaces → two carriers),
  // and `placementsByTier`'s condition pair dies on the tier partition plus the unconfigured-report test.
  // Note what is NOT measured here: Stryker does not mutate object property KEYS, so no mutant proves the
  // registry is keyed by the closed set's own tokens — the `visa-tap`/`visaTap` test does that, and it is not
  // redundant with anything this number says. A dip means a new member or branch the tests do not reach.
  // STILL 52/52 after the own-property guard landed, and the count staying put is the interesting part. The
  // guard first went in as a separate early return, which measured 54/55 — the survivor was `if (false)` on
  // the `registration === undefined` check that followed it, because after an own-property test that branch
  // is unreachable. Folding the guard into the lookup (`Object.hasOwn(…) ? PLACEMENTS[protocol] : undefined`)
  // leaves one reachable absence, and the instrument went back to zero survivors. Worth remembering as a
  // pattern: a defensive guard added in front of an existing one can turn the existing one into dead code,
  // and the mutation score is what says so — `pnpm verify` stays green either way.
  placements: 100,
  verify: 99,
};

const pkg = process.env.STRYKER_PKG;
if (!pkg) {
  throw new Error(
    "STRYKER_PKG is required — run `pnpm mutation <package>` (e.g. `pnpm mutation verify`).",
  );
}
// A missing ratchet used to read as `?? 0`, which is not "no opinion" — it is a break threshold of zero,
// under which every score passes. The run went green, the HTML report rendered, and the package was
// enforced against nothing. A ratchet that can silently become vacuous is worse than none, because the
// green is what gets believed. Absence is now loud, and the entry has to be earned by a measured run.
if (!(pkg in RATCHET)) {
  throw new Error(
    `no mutation ratchet recorded for "${pkg}". Measure it with a run, then add the floor to RATCHET in ` +
      `this file — a package with no entry would otherwise be enforced at a break threshold of 0.`,
  );
}

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["html", "json", "clear-text"],
  coverageAnalysis: "perTest",
  mutate: [`packages/${pkg}/src/**/*.ts`],
  vitest: { dir: `packages/${pkg}` },
  htmlReporter: { fileName: `reports/mutation/${pkg}/index.html` },
  jsonReporter: { fileName: `reports/mutation/${pkg}/mutation.json` },
  thresholds: { high: 95, low: 90, break: RATCHET[pkg] },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  concurrency: 4,
};
