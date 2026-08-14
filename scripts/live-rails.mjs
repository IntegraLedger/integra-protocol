#!/usr/bin/env node
/**
 * The live-rail harness inventory: which packages carry an opt-in on-chain suite, and what each one
 * REQUIRES before that suite will do anything.
 *
 * **Why this exists as a script rather than a list in a workflow.** The set was hand-derived once, from the
 * filename `integration.onchain.test.ts`, and it was wrong: `binding-canton` and `binding-canton-x402` name
 * theirs `integration.canton.test.ts`, so both were omitted, and the plan built on that count concluded
 * Canton had no live path anywhere and sized a build for harnesses that already existed. A filename is a
 * convention anyone may vary; the PROPERTY — a test file that gates a suite on `process.env` — is what the
 * inventory is actually about, so that is what this derives.
 *
 * Deriving is necessary and not sufficient, because a derived set can also go silently EMPTY. So the two
 * guards run together and both are refusals, never warnings:
 *
 *   1. `FLOOR` — a blind non-empty floor, the same discipline `check-docblocks.mjs` and `depcruise-gate.mjs`
 *      use. A parse that stops matching returns zero, and zero must never read as "nothing to run".
 *   2. `EXPECTED` — the named set. Disagreement in EITHER direction is an error: a harness present but
 *      unnamed means new work nobody wired into CI, and a name with no harness means a suite was deleted or
 *      renamed while the workflow kept reporting green over its absence.
 *
 * Keeping both is the point. Derivation alone reintroduces the empty-set failure; a hand list alone
 * reintroduces the Canton miss. Neither catches the other's blind spot.
 *
 * **Every env var a harness reads is treated as REQUIRED, including ones with a `??` fallback.** A fallback
 * means "use the public default", and a standing gate must not silently run against a default: Sui's public
 * fullnode has deprecated JSON-RPC, so the fallback path fails in a way that looks like a code fault rather
 * than a missing credential. The harness reads it, so the gate demands it.
 *
 * Usage:
 *   node scripts/live-rails.mjs                     human-readable inventory
 *   node scripts/live-rails.mjs --matrix            GitHub Actions matrix JSON on stdout
 *   node scripts/live-rails.mjs --env               newline-separated union of every required var
 *   node scripts/live-rails.mjs --requires <rail>   the vars ONE rail needs, one per line
 *   node scripts/live-rails.mjs --check-env <rail>  exit 1 naming any of that rail's vars unset here
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

/**
 * Far below the real count (11 on 2026-08-14) and far above zero. Raise it when rails are added; never
 * lower it to make a run pass — a lowered floor is how a gate stops asserting anything.
 */
const FLOOR = 8;

/**
 * The named set, as package directory names. This is the half a rename cannot silently defeat.
 * `binding-canton` and `binding-canton-x402` are listed explicitly because their omission is the incident
 * this file exists to prevent recurring.
 */
const EXPECTED = Object.freeze([
  "binding-aptos",
  "binding-canton",
  "binding-canton-x402",
  "binding-cardano",
  "binding-evm-mpp",
  "binding-hedera",
  "binding-solana",
  "binding-stellar",
  "binding-sui",
  "binding-tempo-mpp",
  "binding-xrpl",
]);

/** A test file counts as a live harness only if it BOTH reads env and gates a suite on what it read. */
const GATES_ON_ENV = /describe\.skip/;
const ENV_READ =
  /process\.env\[\s*["']([A-Z0-9_]+)["']\s*\]|process\.env\.([A-Z0-9_]+)/g;

/** Every `integration*.test.ts` under a package's `test/`, whatever it is called. */
function harnessFiles(pkgDir) {
  const testDir = join(root, "packages", pkgDir, "test");
  if (!existsSync(testDir)) return [];
  return readdirSync(testDir)
    .filter((f) => f.startsWith("integration") && f.endsWith(".test.ts"))
    .map((f) => join(testDir, f));
}

const rails = [];
for (const pkgDir of readdirSync(join(root, "packages")).sort()) {
  for (const file of harnessFiles(pkgDir)) {
    const src = readFileSync(file, "utf8");
    if (!GATES_ON_ENV.test(src)) continue;

    const vars = new Set();
    for (const m of src.matchAll(ENV_READ)) vars.add(m[1] ?? m[2]);
    if (vars.size === 0) continue; // gated on something other than env — not a credentialed rail

    const manifest = JSON.parse(
      readFileSync(join(root, "packages", pkgDir, "package.json"), "utf8"),
    );
    rails.push({
      dir: pkgDir,
      name: manifest.name,
      file: file.slice(root.length),
      env: [...vars].sort(),
    });
  }
}

const failures = [];

if (rails.length < FLOOR) {
  failures.push(
    `saw only ${rails.length} live-rail harnesses (floor ${FLOOR}). A parser that stops matching reports ` +
      `zero, and zero must never read as "nothing to run" — fix the scan rather than the floor.`,
  );
}

const found = rails.map((r) => r.dir);
const unnamed = found.filter((d) => !EXPECTED.includes(d));
const missing = EXPECTED.filter((d) => !found.includes(d));

if (unnamed.length > 0) {
  failures.push(
    `harness present but NOT in EXPECTED: ${unnamed.join(", ")}. A rail CI does not know about is a rail ` +
      `nobody is proving — add it to EXPECTED (and to the workflow's secrets) rather than deleting this check.`,
  );
}
if (missing.length > 0) {
  failures.push(
    `EXPECTED names a rail with no live harness: ${missing.join(", ")}. Either the suite was renamed or ` +
      `removed — in both cases the gate has been reporting green over a rail it never ran.`,
  );
}

/**
 * The workflow must MAP every variable the harnesses read.
 *
 * GitHub cannot enumerate secrets into a job's environment, so `live-proofs.yml` names them one by one —
 * the single hand-kept list in the whole mechanism, and therefore the one place that drifts. It drifted
 * immediately: the first draft mapped 32 of the 33 required names, omitting `TEMPO_MAINNET_RPC_URL`, which
 * would have turned a *credentialed* rail red for a reason no error message would have explained.
 *
 * Checked statically, on every `pnpm verify`, rather than discovered on the weekly live run — a gate that
 * only fires when the rails run is a gate that reports the drift a week late.
 */
function checkWorkflowMapping() {
  const wf = join(root, ".github/workflows/live-proofs.yml");
  if (!existsSync(wf)) {
    return [
      `no live-proofs workflow at .github/workflows/live-proofs.yml. ${rails.length} live-rail harnesses ` +
        `exist and nothing runs them — which is the state this inventory was written to make visible.`,
    ];
  }
  const src = readFileSync(wf, "utf8");
  const required = [...new Set(rails.flatMap((r) => r.env))].sort();

  // Checked PER STEP, not per file. Two steps need the credentials for different reasons — the preflight
  // to report what is missing, the run step to hand them to the harness — and a var present in one but not
  // the other fails in a way neither message explains. "Mapped somewhere" is the weaker property, and it
  // is the one that let the first canary of this very check pass while the mapping was genuinely broken.
  const steps = src.split(/^ {6}- /m);
  const problems = [];
  for (const step of steps) {
    // `NAME: ${{ secrets.NAME }}` — the only mapping form this workflow uses.
    const mapped = new Set(
      [
        ...step.matchAll(
          /^\s+([A-Z0-9_]+):\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/gm,
        ),
      ]
        .filter((m) => m[1] === m[2])
        .map((m) => m[1]),
    );
    if (mapped.size === 0) continue; // not a credential-carrying step
    const unmapped = required.filter((v) => !mapped.has(v));
    if (unmapped.length > 0) {
      const label =
        /^\s*name:\s*(.+)$/m.exec(step)?.[1]?.trim() ?? "(unnamed step)";
      problems.push(
        `live-proofs.yml step "${label}" does not map: ${unmapped.join(", ")}. A harness reads these, so ` +
          `without a mapping the rail cannot run no matter which secrets exist.`,
      );
    }
  }
  return problems;
}

failures.push(...checkWorkflowMapping());

if (failures.length > 0) {
  console.error("live-rails — REFUSING:\n");
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

const mode = process.argv[2];

/** Resolve a rail by directory name, refusing an unknown one rather than returning an empty requirement set. */
function railOrDie(dir) {
  const hit = rails.find((r) => r.dir === dir);
  if (!hit) {
    console.error(
      `live-rails: no live-rail harness named "${dir}". Known: ${rails.map((r) => r.dir).join(", ")}`,
    );
    process.exit(1);
  }
  return hit;
}

if (mode === "--matrix") {
  process.stdout.write(
    JSON.stringify({
      include: rails.map((r) => ({ rail: r.dir, pkg: r.name, file: r.file })),
    }),
  );
} else if (mode === "--env") {
  const union = [...new Set(rails.flatMap((r) => r.env))].sort();
  process.stdout.write(`${union.join("\n")}\n`);
} else if (mode === "--requires") {
  process.stdout.write(`${railOrDie(process.argv[3]).env.join("\n")}\n`);
} else if (mode === "--check-env") {
  // Runs INSIDE the job, so it sees the environment the workflow's hand-kept `env:` block actually
  // produced. That is the point: it compares the derived requirement against what was really supplied, so a
  // var a harness reads but the workflow forgot to map turns the rail red instead of skipping it silently.
  const rail = railOrDie(process.argv[3]);
  const missing = rail.env.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(
      `::error::${rail.dir} — cannot run, missing credentials: ${missing.join(" ")}`,
    );
    console.error(
      "This rail is NOT proven. Add the secrets above (and map them in the workflow's env: block), or the",
    );
    console.error(
      "rail stays red — a rail that cannot run must never report green.",
    );
    process.exit(1);
  }
  console.log(
    `live-rails — ${rail.dir}: all ${rail.env.length} required credential(s) present.`,
  );
} else {
  console.log(
    `live-rails — ${rails.length} live-rail harnesses (floor ${FLOOR}), matching EXPECTED exactly.\n`,
  );
  for (const r of rails) {
    console.log(`  ${r.dir}`);
    console.log(`    ${r.file}`);
    console.log(`    requires: ${r.env.join(" ")}`);
  }
}
