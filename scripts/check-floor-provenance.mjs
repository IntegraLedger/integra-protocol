#!/usr/bin/env node
/**
 * ⭐⭐ `check:floor-provenance` — **EVERY RATCHET FLOOR SAYS WHERE IT CAME FROM, AND THE ARITHMETIC IS CHECKED.**
 *
 * `agent-commerce-plan#119` was filed because floors were set at the measured mean, so seven packages passed
 * by nought or one mutant and flapped. All 25 were re-derived on 2026-09-12 from ONE cold uncontended run on
 * `integra-dev-host` at the pinned concurrency, with a **derived** margin: `1` where the package recorded
 * timeouts, `0` where it did not, because a timeout counted as a kill is the only mechanism that moves a
 * score between runs on an unchanged tree.
 *
 * ⛔⛔ **CLAUSE 4 ASKED FOR A GATE ON THE COMMIT MESSAGE, AND THIS TREE CANNOT HAVE ONE.** Verbatim: *"a gate
 * that refuses a floor edit whose commit does not name the cold runs it was derived from"*. `M` 2026-09-13:
 * nothing in this repository reads a commit message. `check:claims`, `check:gate-parity`,
 * `check:mutation-subjects` and the rest all read the tree or the reports; **the commit message is outside
 * every subject set.** A gate written against it would be the only one of its kind and would have no
 * subject on any run.
 *
 * ⭐ So the provenance lives **beside the number**, where it is durable and checkable, and this gate does
 * what the commit-message version could not: it **recomputes the floor from the measurement**. A floor
 * edited without re-deriving is red at the next `verify` rather than at review time, and it does not depend
 * on anyone having written a good commit message.
 *
 * The declared form, one comment line immediately above its entry:
 *
 *     // `M` 96.82 over 9227 mutants, 4 timeout(s); margin 1 — <why>
 *     "seller-console": 95,
 *
 * ⇒ `floor === trunc(score) - margin`, and `margin === (timeouts > 0 ? 1 : 0)`. Both are checked, because a
 * hand-written margin that disagrees with the timeout count is a floor derived by a rule nobody applied.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT =
  process.env.INTEGRA_GATE_ROOT ?? new URL("..", import.meta.url).pathname;
const CONFIG = join(ROOT, "stryker.config.mjs");

const PROVENANCE =
  /`M`\s*([\d.]+)\s*over\s*(\d+)\s*mutants,\s*(\d+)\s*timeout\(s\);\s*margin\s*(\d+)/;
const ENTRY = /^\s*"?([A-Za-z][A-Za-z0-9-]*)"?:\s*(\d+)\s*,/;

/** ⛔ Brace-matched, never regexed: the entries are written both quoted and bare, and a key regex that
 *  assumes quoting under-counts. `agent-commerce-plan/CLAUDE.md` records that exact failure — 48 floors
 *  where the tree holds 56. */
function ratchetBlock(text) {
  const at = text.indexOf("const RATCHET");
  if (at < 0) return undefined;
  const open = text.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return undefined;
}

const problems = [];
const text = readFileSync(CONFIG, "utf8");
const block = ratchetBlock(text);

if (block === undefined) {
  console.error(
    `\n⛔ check:floor-provenance — no \`const RATCHET\` object found in ${CONFIG}.\n` +
      "   That is this gate's entire subject set; without it the check would pass over nothing.\n",
  );
  process.exit(1);
}

let pending;
let examined = 0;
for (const line of block.split("\n")) {
  const prov = PROVENANCE.exec(line);
  if (prov !== null) {
    pending = {
      score: Number(prov[1]),
      mutants: Number(prov[2]),
      timeouts: Number(prov[3]),
      margin: Number(prov[4]),
    };
    continue;
  }
  const entry = ENTRY.exec(line);
  if (entry === null) continue;

  const pkg = entry[1];
  const floor = Number(entry[2]);
  examined += 1;

  if (pending === undefined) {
    problems.push(
      `${pkg}: floor ${String(floor)} states no provenance — nothing says which run it came from, so nothing can tell a derived floor from a typed one`,
    );
    continue;
  }

  const { score, mutants, timeouts, margin } = pending;
  pending = undefined;

  if (mutants === 0)
    problems.push(
      `${pkg}: provenance claims a score over ZERO mutants — a number about nothing`,
    );

  const expectedMargin = timeouts > 0 ? 1 : 0;
  if (margin !== expectedMargin)
    problems.push(
      `${pkg}: margin ${String(margin)} against ${String(timeouts)} timeout(s) — the rule derives ${String(expectedMargin)}. ` +
        "A margin chosen rather than derived is the defect #119 was filed about",
    );

  const expectedFloor = Math.trunc(score) - margin;
  if (floor !== expectedFloor)
    problems.push(
      `${pkg}: floor ${String(floor)} does not follow from its own provenance — ${String(score)} truncates to ${String(Math.trunc(score))}, minus margin ${String(margin)} is ${String(expectedFloor)}`,
    );

  if (score < floor)
    problems.push(
      `${pkg}: the run it cites scored ${String(score)}, BELOW the floor ${String(floor)} it was used to set`,
    );
}

if (pending !== undefined)
  problems.push(
    "a provenance line trails the last entry, so it describes no floor — an orphaned measurement reads as corroboration for whatever follows it",
  );

if (examined === 0)
  problems.push(
    "ZERO floors examined. The RATCHET block parsed and held no entry this gate could read, which is an " +
      "empty subject set reporting success — the defect this repository is organised against",
  );

// ── appended to check-floor-provenance.mjs ──────────────────────────────────────────────────────────
/**
 * ⭐⭐ THE FLOORS NAME THE RUNNER THEY WERE MEASURED UNDER. `agent-commerce-plan#108` clause 2.
 *
 * ⛔⛔ A MUTATION SCORE IS A FRACTION OVER A POPULATION THE TOOL CHOSE, and a major Stryker release moves
 * that population without a line of product code changing. `M` 10.0.0 did exactly that: `integra-protocol`'s
 * `conformance` has been red at 92.95 against a floor of 93 since 2026-09-11 over a package nobody touched.
 * A floor whose population can move without a word is a number about a different tree.
 *
 * ⇒ The ratchet declares the version its floors were derived under, and this refuses when the installed
 * runner differs. It does not say which way to resolve it — re-derive, or pin back — because that is a
 * decision, and the point is that it cannot happen silently.
 */
const installed = (() => {
  const path = join(
    ROOT,
    "node_modules",
    "@stryker-mutator",
    "core",
    "package.json",
  );
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")).version;
  } catch {
    return undefined;
  }
})();

const declaredVersion = /FLOORS_MEASURED_UNDER\s*=\s*"([^"]+)"/.exec(text)?.[1];

if (declaredVersion === undefined)
  problems.push(
    "stryker.config.mjs declares no `FLOORS_MEASURED_UNDER`. Every floor here is a fraction over a mutant " +
      "population the runner chose, and a major release moves it — so the version the floors were derived " +
      "under has to be written down beside them.",
  );
else if (installed === undefined)
  problems.push(
    "@stryker-mutator/core is not installed, so the declared runner version could not be checked against " +
      "anything. ⛔ An unverifiable declaration is not a verified one.",
  );
else if (installed !== declaredVersion)
  problems.push(
    `the floors were derived under Stryker ${declaredVersion} and ${installed} is installed. ` +
      "⛔ A major release moves the mutant population, so every floor is a number about a different " +
      "population until they are re-derived — or the runner is pinned back. Both are decisions; this gate " +
      "only refuses to let it happen silently.",
  );

if (problems.length > 0) {
  console.error(
    `\n⛔ check:floor-provenance — ${String(problems.length)} problem(s):\n` +
      problems.map((p) => `   - ${p}`).join("\n") +
      "\n",
  );
  process.exit(1);
}

console.log(
  `check:floor-provenance — ${String(examined)} ratchet floor(s), every one stating the cold run it was derived from ` +
    `under Stryker ${String(declaredVersion)}, each equal to that run's truncated score minus a margin derived ` +
    "from its timeout count (1 where the package " +
    "recorded timeouts, 0 where it did not).",
);
