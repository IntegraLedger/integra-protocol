#!/usr/bin/env node
/**
 * Commit-message policy, enforced on the range a push actually adds.
 *
 * Two rules, and they fail for opposite reasons:
 *
 * 1. **Every commit carries a DCO `Signed-off-by:` matching its author.** CONTRIBUTING.md promises this
 *    of "every commit" and the promise was empty — 64 commits carried none, because nothing checked. The
 *    trailer is the only per-commit provenance record LCP has, and CONTRIBUTING says why it matters: a
 *    contribution whose provenance was never attested is the one that becomes hard to move toward the
 *    standard later. It "cannot be reconstructed after the fact", so the gate has to be at the door.
 *
 * 2. **No agent-authorship trailers.** `Co-Authored-By: Claude` and `claude.ai/code` session URLs are
 *    tooling exhaust, and this repository is world-readable and permanent. The sibling repo bans the same
 *    literals in FILES; commit messages are just as public and were the half nobody scanned.
 *
 * **This gate is CI-only and cannot join `pnpm verify`.** Its subject is a push range, which does not
 * exist locally — a verify run has no "before". Run it by hand over any range instead:
 *
 *     node scripts/check-commit-trailers.mjs                 # unpushed commits (@{u}..HEAD)
 *     node scripts/check-commit-trailers.mjs HEAD~5..HEAD    # an explicit range
 *     node scripts/check-commit-trailers.mjs <before> <after> # the shape CI passes
 *
 * ⛔ A RANGE THAT RESOLVES TO NOTHING IS A FAILURE, NEVER A PASS. A commit-message gate that cannot find
 * the commits reports clean over an unchecked push, which is indistinguishable from compliance and is how
 * this class of gate rots. Every path that narrows the subject set says so on stdout, and an empty set
 * exits 1.
 */
import { execFileSync } from "node:child_process";

const ZERO = "0".repeat(40);

/** `git` with arguments, trimmed — throws on a non-zero exit rather than returning a partial answer. */
function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * Does this object exist in the local repository? A CI checkout can be shallow enough to lack `before`.
 *
 * stderr is discarded rather than inherited: probing a ref that is legitimately absent — `origin/main` in
 * a fresh clone that has no remote — makes git print `fatal: Not a valid object name`, and a `fatal:` in
 * a green run's log reads as a broken gate to the next person triaging one.
 */
function exists(rev) {
  try {
    execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The commits a run must judge, plus the prose explaining how the set was chosen.
 *
 * The fallbacks are ordered by how much they can see, and each one ANNOUNCES itself. A branch's first push
 * carries `before` as forty zeroes and a force-push can leave `before` unreachable; silently degrading to
 * "just the tip" in either case would check one commit out of many and still print a green line.
 */
function subject(argv) {
  if (argv.length === 2) {
    const [before, after] = argv;
    if (before !== ZERO && exists(before))
      return {
        range: `${before}..${after}`,
        how: `push range ${before.slice(0, 7)}..${after.slice(0, 7)}`,
      };
    // A new branch, or a force-push whose old tip this checkout never fetched. The default branch is the
    // only other anchor available; where it exists and is not this ref, the commits unique to this push
    // are the ones it does not already contain.
    for (const base of ["origin/main", "main"])
      if (exists(base) && git("rev-parse", base) !== git("rev-parse", after))
        return {
          range: `${base}..${after}`,
          how: `no usable 'before' (${before === ZERO ? "new branch" : "unreachable"}) — fell back to ${base}..HEAD`,
        };
    return {
      range: `${after}~1..${after}`,
      how: "NARROWED: no 'before' and no default branch to compare against — only the pushed tip was checked",
    };
  }
  if (argv.length === 1)
    return { range: argv[0], how: `explicit range ${argv[0]}` };
  try {
    git("rev-parse", "@{u}");
    return { range: "@{u}..HEAD", how: "unpushed commits (@{u}..HEAD)" };
  } catch {
    return {
      range: "HEAD~1..HEAD",
      how: "NARROWED: no upstream configured — only HEAD was checked",
    };
  }
}

/**
 * The agent-authorship markers, as SHAPES rather than the bare word: a commit legitimately discussing
 * Claude the product is not a policy breach, a trailer or a session URL is.
 *
 * ⚠️ EACH PATTERN MUST DISTINGUISH A USE FROM A MENTION, and the first draft did not. This gate's own
 * introducing commit explains the rule it enforces, so its message names the markers — and a bare
 * `claude.ai/code` substring test failed that commit for describing what it forbids. A rule nobody can
 * document without tripping it is a rule that gets narrowed under deadline.
 *
 * So each pattern is anchored to the form the exhaust ACTUALLY takes: the trailer at the start of a line
 * (prose quoting `Co-Authored-By:` mid-sentence is fine), and the session path rather than the bare host
 * (a real trailer is always `claude.ai/code/session_…`).
 */
const FORBIDDEN = [
  {
    re: /^\s*co-authored-by:.*claude/im,
    what: "a Co-Authored-By trailer naming Claude",
  },
  {
    re: /claude\.ai\/code\/session/i,
    what: "a claude.ai/code session URL",
  },
  {
    re: /generated with \[claude code\]/i,
    what: "a 'Generated with Claude Code' line",
  },
];

const { range, how } = subject(process.argv.slice(2));
console.log(`check:commit-trailers — subject: ${how}`);

let shas;
try {
  // --no-merges: a merge commit's message is generated by git, and DCO practice everywhere exempts it.
  // main has never held one; the flag is here so the first merge does not produce a mystery red.
  shas = git("rev-list", "--no-merges", range).split("\n").filter(Boolean);
} catch {
  console.error(
    `check:commit-trailers — could not resolve '${range}'. The range is the gate's whole subject, so an ` +
      "unresolvable one is a failure rather than an empty pass. In CI this usually means the checkout was " +
      "shallow: actions/checkout needs fetch-depth: 0 for a range to exist.",
  );
  process.exit(1);
}

if (shas.length === 0) {
  console.error(
    `check:commit-trailers — BLIND GATE: '${range}' resolved to zero commits. A push adds at least one, ` +
      "so an empty subject means the range was computed wrongly, and reporting clean over it would " +
      "certify an unchecked push.",
  );
  process.exit(1);
}

const failures = [];
for (const sha of shas) {
  const [name, email] = git("show", "-s", "--format=%an%n%ae", sha).split("\n");
  const body = git("show", "-s", "--format=%B", sha);
  const short = `${sha.slice(0, 7)} ${git("show", "-s", "--format=%s", sha)}`;

  const signoffs = [
    ...body.matchAll(/^\s*Signed-off-by:\s*(.+?)\s*<([^>]+)>\s*$/gim),
  ].map((m) => ({
    name: m[1],
    email: m[2],
  }));
  if (signoffs.length === 0)
    failures.push(
      `${short}\n      no Signed-off-by trailer. Expected: Signed-off-by: ${name} <${email}>`,
    );
  else if (
    !signoffs.some(
      (s) =>
        s.email.toLowerCase() === email.toLowerCase() &&
        s.name.toLowerCase() === name.toLowerCase(),
    )
  )
    failures.push(
      `${short}\n      Signed-off-by does not match the author. Author: ${name} <${email}>; ` +
        `signed: ${signoffs.map((s) => `${s.name} <${s.email}>`).join(", ")}`,
    );

  for (const { re, what } of FORBIDDEN)
    if (re.test(body))
      failures.push(
        `${short}\n      carries ${what} — this history is public and permanent`,
      );
}

if (failures.length > 0) {
  console.error(
    `\ncheck:commit-trailers — ${failures.length} problem(s) across ${shas.length} commit(s):\n`,
  );
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    "\nA missing sign-off on an UNPUSHED commit: `git commit --amend -s`, or `git rebase --signoff <base>`\n" +
      "for a branch. Once a commit is on public main the fix is the habit, not a rewrite — rewriting\n" +
      "published history breaks every clone and orphans the release tags. Install the hook so it cannot\n" +
      "happen again: `git config core.hooksPath .githooks` (pnpm install does this for you).",
  );
  process.exit(1);
}

console.log(
  `check:commit-trailers — ${shas.length} commit(s) checked: all signed off by their author, none carrying agent-authorship trailers.`,
);
