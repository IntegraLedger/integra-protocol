#!/usr/bin/env node
/**
 * `check:forbidden-literals` — **no private referent appears anywhere a stranger can read, which on GitHub
 * is the whole repository rather than the subset npm packs.**
 *
 * ⛔⛔ **WHY THIS EXISTS BESIDE A GREEN GATE.** `no-private-referents.test.ts` already holds SHIPPED prose to
 * a resolvability standard and it passes. Its subject set is `src/`, every README, every CHANGELOG a `files`
 * field packs, and the conformance vectors — correct for "a stranger holding only the tarball". `M` A sweep
 * of the tracked tree found **16 occurrences of two private repository names across 7 files**, every one of
 * them outside that set: `scripts/`, `stryker.config.mjs`, and tests. The shipped gate was right and the
 * repository was still disclosing, because a reader on github.com installs nothing.
 *
 * ⭐ **THE TWO GATES SHARE A LIST AND NOT A STANDARD.** `PRIVATE_REPOSITORIES` is imported by both from
 * `forbidden-literals.mjs`. What is private is stated once; where it may not appear is stated twice, on
 * purpose, because the answers genuinely differ.
 *
 * ⛔ **THE SUBJECT SET IS `git ls-files` UNDER {@link root}, DERIVED AND NEVER LISTED.** It is TRACKED
 * files, not every file on disk: an ignored build artifact is not something a reader meets on github.com.
 * ⇒ A fixture tree must therefore be a real repository with its files added, which the drive does, because
 * a fixture that is not one would exercise semantics this gate does not have.
 A hand-maintained roster of files to
 * scan is a roster that goes stale the first time someone adds a directory. The one exclusion is
 * {@link SELF_NAMING}: two files that must spell the markers in order to ban them, enumerated rather than
 * matched by pattern.
 *
 * ⛔ **IT REFUSES AN EMPTY SUBJECT SET RATHER THAN REPORTING IT CLEAN.** A gate that examines nothing and
 * exits 0 is this estate's most-paid-for defect. If `git ls-files` returns nothing — not a repository, a
 * broken pathspec, a future refactor that moves the root — this dies loudly instead.
 *
 * ⛔ **AND IT PROVES ITS OWN PATTERNS BEFORE TRUSTING THEM, ONE BY ONE.** Every pattern must match its own
 * sample and the benign sample must match none of them. Asserted individually: a `.some()` lets one live
 * pattern vouch for the rest.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BENIGN_SAMPLE,
  FORBIDDEN_LITERALS,
  SELF_NAMING,
} from "./forbidden-literals.mjs";

/**
 * ⛔ **Resolved from THIS FILE, never from the process cwd** — the convention every other gate here
 * follows. A `git rev-parse --show-toplevel` answers about wherever the caller happens to stand, so the
 * gate would scan a different tree than the one it lives in, and die outright when invoked from outside a
 * repository. `INTEGRA_GATE_ROOT` is the same override `check:hermetic-tests` and `check:floor-provenance`
 * take, and it is what lets this gate have a DRIVE rather than only a hand-run plant.
 */
const root =
  process.env.INTEGRA_GATE_ROOT ?? new URL("..", import.meta.url).pathname;

const problems = [];

// ── The canaries, before anything is scanned ────────────────────────────────
for (const [pattern, why, sample] of FORBIDDEN_LITERALS) {
  if (!pattern.test(sample))
    problems.push(
      `CANARY: the pattern for ${why} no longer matches its own sample. ` +
        "A pattern that matches nothing reports every file clean, which is indistinguishable from success.",
    );
  if (pattern.test(BENIGN_SAMPLE))
    problems.push(
      `CANARY: the pattern for ${why} matches the BENIGN sample. It is flagging ordinary prose, ` +
        "so its reports say nothing about whether a real marker is present.",
    );
}

// ── The subject set, derived ────────────────────────────────────────────────
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

if (tracked.length === 0)
  problems.push(
    "REFUSING TO VERIFY: `git ls-files` returned no files, so this gate examined nothing. " +
      "An empty subject set is a broken instrument, not a clean tree.",
  );

let scanned = 0;
const hits = [];
for (const rel of tracked) {
  if (SELF_NAMING.has(rel)) continue;
  let text;
  try {
    text = readFileSync(join(root, rel), "utf8");
  } catch {
    continue; // unreadable or removed under us — not a finding about content
  }
  if (text.includes("\0")) continue; // binary
  scanned += 1;
  const lines = text.split("\n");
  for (const [pattern, why] of FORBIDDEN_LITERALS) {
    for (let i = 0; i < lines.length; i += 1) {
      const probe = new RegExp(pattern.source, pattern.flags.replace("g", ""));
      if (probe.test(lines[i])) hits.push(`${rel}:${i + 1} — ${why}`);
    }
  }
}

if (scanned === 0 && tracked.length > 0)
  problems.push(
    "REFUSING TO VERIFY: every tracked file was skipped, so nothing was examined.",
  );

if (hits.length > 0) {
  problems.push(
    `${hits.length} forbidden literal(s) in this PUBLIC repository:\n` +
      hits.map((h) => `    - ${h}`).join("\n") +
      "\n\n  Describe the referent; never spell it. A reader on github.com cannot follow a private" +
      "\n  repository name, and the name discloses that the repository exists.",
  );
}

if (problems.length > 0) {
  console.error(`\ncheck:forbidden-literals — FAILED\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log(
  `check:forbidden-literals — ${scanned} tracked file(s) scanned against ${FORBIDDEN_LITERALS.length} marker(s), ` +
    `each proved against its own sample and against a benign line; ${SELF_NAMING.size} self-naming file(s) excluded by name.`,
);
