/**
 * Markers that must never appear anywhere in this PUBLIC repository.
 *
 * ⛔⛔ **ONE LIST, TWO SURFACES, TWO STANDARDS — AND THE NARROWER ONE WAS ALREADY MET.**
 * `packages/rail-invariants/test/no-private-referents.test.ts` holds shipped prose to "a stranger holding
 * nothing but the tarball can resolve every referent", and it is green: it walks `src/`, every README and
 * every CHANGELOG a `files` field packs, and it names both private repositories in its own patterns. What it
 * deliberately does NOT walk is stated in its header — *"`test/` and `drift/` are not shipped and are not
 * checked here"*. That is a correct boundary for the question it asks.
 *
 * ⇒ **This file asks the other question.** A GitHub repository is world-readable in full, not in the subset
 * npm packs. `scripts/`, `stryker.config.mjs` and every test are read by strangers who never install a
 * tarball, and 16 occurrences of two private repository names sat in exactly those files while the shipped
 * gate reported clean — correctly, because they are not shipped.
 *
 * ⭐ **The list lives here rather than in either checker** because a rule stated in two places is a rule that
 * drifts in one of them. `no-private-referents.test.ts` imports {@link PRIVATE_REPOSITORIES} from here rather
 * than restating it, so the shipped standard and the repository standard can never disagree about WHAT is
 * private while disagreeing, deliberately, about WHERE it may not appear.
 *
 * A marker belongs here when a stranger reading it learns something about how this repository is worked on
 * rather than about the software. That test is deliberately different from an unresolvable-identifier rule:
 * these referents ARE resolvable — to people who hold the private repository — and that is exactly the
 * problem.
 */

/**
 * Each entry carries a SAMPLE it must match and the reason it is banned.
 *
 * ⛔ **A pattern that stops matching reports every file clean, which looks exactly like success.** The sample
 * lives beside the pattern so the gate can prove each one still discriminates. ⚠️ Assert them
 * INDIVIDUALLY — a `.some()` over the list lets one live pattern vouch for all of them, and a second broken
 * one is then invisible. That failure is recorded in the sibling public repository's copy of this file.
 *
 * Samples may be spelled out here because this file is in {@link SELF_NAMING}. Nothing else may spell them.
 *
 * ⛔⛔ **NO `\b` ANCHORS, AND THAT IS NOT AN OVERSIGHT.** Written first as `/\bagent-commerce-plan\b/i`,
 * this list was blind to its own subject: the text `/\bagent-commerce-plan\b/gi` in a regex literal puts a
 * word character (`b`) immediately before the name, so `\b` cannot match there — and a file spelling the
 * name in a pattern is exactly the file most likely to hold it. Measured: the anchored version reported 18
 * hits and missed 2, both in the gate that bans the same names. A bare substring cannot be evaded that way,
 * and a longer word containing the name discloses it just as completely.
 *
 * @type {ReadonlyArray<readonly [RegExp, string, string]>}
 */
export const FORBIDDEN_LITERALS = [
  [
    /claude\.ai\/code\/session/i,
    "a Claude session URL",
    "see https://claude.ai/code/session_0123",
  ],
  [
    /Co-Authored-By:\s*Claude/i,
    "an agent-authorship trailer",
    "Co-Authored-By: Claude <noreply@anthropic.com>",
  ],
  [
    /integra-agentic-commerce/i,
    "the private seller-side repository by name",
    "ported from integra-agentic-commerce, where it shipped",
  ],
  [
    /agent-commerce-plan/i,
    "the private planning register by name",
    "the record is agent-commerce-plan#87",
  ],
  [
    /aug-31-live/i,
    "the private collaboration repository by name",
    "the runbook in aug-31-live says",
  ],
];

/**
 * The private repository patterns alone, for the SHIPPED-prose gate to consume.
 *
 * ⭐ It bans more than these — plan tokens, audit finding ids, phrases — under a different standard. What it
 * must not do is keep its OWN copy of these two names: that is the drift this single-sourcing prevents.
 *
 * @type {ReadonlyArray<RegExp>}
 */
export const PRIVATE_REPOSITORIES = FORBIDDEN_LITERALS.slice(2).map(
  ([pattern]) => new RegExp(pattern.source, "gi"),
);

/**
 * Files whose whole purpose is to state the forbidden markers, and which must therefore spell them.
 *
 * ⛔ **Two, listed, never a pattern.** An exemption expressed as a glob is an exemption that silently grows:
 * a file added under a pattern inherits a licence nobody granted it. This estate has been bitten by the
 * poisoned-declaration shape and the answer is that an exemption must be enumerated and short enough to read.
 */
export const SELF_NAMING = new Set([
  "scripts/forbidden-literals.mjs",
  "scripts/check-commit-trailers.mjs",
]);

/** A line that must match NOTHING above — proof the patterns discriminate rather than flagging all prose. */
export const BENIGN_SAMPLE =
  "Reviewed-By: a colleague; see https://example.invalid/docs for the public register";
