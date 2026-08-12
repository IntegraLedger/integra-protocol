#!/usr/bin/env node
/**
 * Has a host specification moved since this tree read it?
 *
 * Every entry in `spec-pins.json` names a host repository, the paths this tree makes claims about, and the
 * commit those paths were at when they were read. This asks GitHub for the latest commit touching each
 * path set and compares. Run it by hand: `pnpm spec-drift`.
 *
 * ★ DELIBERATELY NOT A SCHEDULED WORKFLOW. This repository stands alone: no Actions secrets, no cross-repo
 * CI, and a `verify` that runs offline and reproducibly. A weekly job reaching eight third-party APIs would
 * hand it a standing dependency on someone else's uptime and rate limits, and buy a red badge caused by
 * neither the code nor the commit that triggered it. The pins are the durable half — they turn a date
 * nobody can check into a revision anybody can — and this is the command that reads them when a maintainer
 * chooses to look. `drift-guard.yml` is scheduled because a deployed contract can change under a shipped
 * binding and produce a wrong answer on a real payment; a host's prose moving cannot.
 *
 * WHY PATH-SCOPED, not repository-scoped. A host's README typo is not drift in its specification, and a
 * job that fires on one teaches people to close it without reading. x402 pushes to `go/` and `typescript/`
 * constantly and to `specs/` rarely; only the second changes what this tree may claim.
 *
 * WHY A `drifted` ENTRY DOES NOT FAIL. It is a debt the pin file already records, with a note saying what
 * the re-read owes. Failing on it would make the job permanently red, and a permanently red job is one
 * nobody reads — which is the state this whole mechanism exists to escape. The offline gate
 * (`rail-invariants/test/spec-pins-invariant.test.ts`) is what stops a `drifted` entry being silent.
 *
 * NO SECRETS. Every host is a public repository, and the API is reachable unauthenticated. Actions
 * supplies `GITHUB_TOKEN` automatically for rate limits, and it is not a configured repository secret —
 * this repository deliberately has none.
 */
import { readFileSync } from "node:fs";

const pins = JSON.parse(
  readFileSync(new URL("../spec-pins.json", import.meta.url), "utf8"),
);
const token = process.env["GITHUB_TOKEN"];

/** The newest commit touching `path` in `repo`, or null when the API declines to say. */
async function latest(repo, path) {
  const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`;
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "integra-protocol-spec-drift",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${repo} ${path}: HTTP ${res.status}`);
  const [head] = await res.json();
  return head
    ? { sha: head.sha, date: head.commit.committer.date.slice(0, 10) }
    : null;
}

const moved = [];
const known = [];
const unpinnable = [];
const pinnedDeliberately = [];

for (const host of pins.hosts) {
  if (host.pinnable === false) {
    unpinnable.push(host);
    continue;
  }
  // A host we pin to a DEPLOYED revision rather than to its latest specification. Upstream moving is
  // expected there and says nothing: `commerce-payments` is pinned to the commit whose bytecode is on
  // chain, and drift-guard.yml checks that pin against the chain itself every week. Asking "has the
  // default branch moved" would fire forever and mean nothing.
  if (host.tracksUpstream === false) {
    pinnedDeliberately.push(host);
    continue;
  }
  // The newest commit across every path this host is cited for.
  const heads = await Promise.all(host.paths.map((p) => latest(host.repo, p)));
  const newest = heads
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!newest)
    throw new Error(
      `${host.id}: no commits found for ${host.paths.join(", ")}`,
    );
  // A pin may be abbreviated; compare on the prefix that was recorded.
  const same =
    newest.sha.startsWith(host.readAt) || host.readAt.startsWith(newest.sha);
  if (same) continue;
  (host.status === "drifted" ? known : moved).push({ host, newest });
}

for (const { host, newest } of known)
  console.log(
    `· ${host.id}: still drifted — pinned ${host.readAt.slice(0, 10)}, upstream ${newest.sha.slice(0, 10)} (${newest.date}). Re-read owed:\n  ${host.note}`,
  );

for (const host of unpinnable)
  console.log(`· ${host.id}: not pinnable — ${host.reason.slice(0, 96)}…`);

for (const host of pinnedDeliberately)
  console.log(
    `· ${host.id}: pinned to a deployed revision, not tracking upstream — see its note.`,
  );

if (moved.length === 0) {
  console.log(
    `\nspec-drift — every pinned host is at the revision this tree read.`,
  );
  process.exit(0);
}

console.error(
  `\nspec-drift — ${moved.length} host specification(s) moved since this tree read them:\n`,
);
for (const { host, newest } of moved) {
  console.error(`  ${host.id}  (${host.repo})`);
  console.error(`    read at   ${host.readAt.slice(0, 10)} on ${host.readOn}`);
  console.error(`    upstream  ${newest.sha.slice(0, 10)} on ${newest.date}`);
  console.error(
    `    compare   https://github.com/${host.repo}/compare/${host.readAt}...${newest.sha}`,
  );
  console.error(`    affects   ${host.citedBy.join(", ")}\n`);
}
console.error(
  `Re-read the diff against the claims those packages make. If the claims still hold, advance \`readAt\`\n` +
    `and say so in the note. If they do not, fix the package first — the host governs, and a pin moved to\n` +
    `silence this job is worse than no pin at all. If the re-read cannot happen now, set \`status\` to\n` +
    `"drifted" with a note saying what is owed; the job will report it without failing.`,
);
process.exit(1);
