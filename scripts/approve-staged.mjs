/**
 * Approve staged package versions — the human half of the DS-4 gate.
 *
 * The release workflow only STAGES. Nothing is installable until a maintainer approves it with a 2FA
 * challenge the registry enforces against the exact bytes, which is what makes the gate survive a
 * compromised workflow. This script is the ergonomics of that approval, not the authority for it: every
 * approval below is still an `npm stage approve` that npm accepts or refuses on its own terms.
 *
 * It exists because a coordinated release is one approval per package — `npm stage approve` takes one
 * stage id, and
 * batch approval is undocumented. Thirty-odd hand-typed commands is how a step gets skipped.
 *
 * It also OWNS TAGGING, and that placement is the point. `changeset publish` used to tag in the runner at
 * publish time; staging is not publishing, so a tag written then could point at a version later rejected.
 * Tags are written here, after the registry has confirmed the version is live, and only for what actually
 * went live.
 *
 *   node scripts/approve-staged.mjs --otp 123456          approve what is staged AT THE TREE'S VERSION, then tag
 *   node scripts/approve-staged.mjs --otp 123456 --dry-run  show what would be approved
 *   node scripts/approve-staged.mjs --list                  just list what is staged
 *   node scripts/approve-staged.mjs --otp 123456 --reject-stale   first reject rows staged at any OTHER version
 *
 * It approves only the version the tree is at. Staging happens on every push and a staged version cannot be
 * re-staged, so a correction landed after a stage leaves the superseded bytes staged beside the corrected
 * ones; rows at another version are refused by name, and rejected only with --reject-stale.
 *
 * A TOTP code lives about 30 seconds. npm accepts one per approval, so a long run may need a second code:
 * on an OTP rejection this stops rather than continuing, and re-running skips what already went live.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const arg = (flag) => {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return v;
};
const has = (flag) => argv.includes(flag);

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** What npm currently holds staged for this account. */
function staged() {
  let out;
  try {
    out = run("npm", ["stage", "list", "--json"]);
  } catch (cause) {
    const msg = String(cause.stderr ?? cause.message);
    // The two failures an operator actually hits, told apart, because the fix differs and a stack trace
    // in the middle of a release tells them neither.
    if (/E401|Unable to authenticate|need auth/i.test(msg))
      throw new Error(
        "not authenticated to npm. Approval is a proof-of-presence action tied to your account — run\n" +
          "`npm login` first. CI cannot do this step and is not supposed to be able to.",
      );
    if (
      /Unknown command|not a valid command|stage/i.test(msg) &&
      /Unknown|Usage/i.test(msg)
    )
      throw new Error(
        `this npm CLI has no \`stage\` command (npm ${run("npm", ["--version"]).trim()}). Staged publishing\n` +
          "needs npm 11.15.0 or newer.",
      );
    throw new Error(`\`npm stage list\` failed:\n${msg.trim()}`);
  }
  const parsed = JSON.parse(out);
  // npm's shape has moved between minors; accept an array or a wrapped list rather than guessing one.
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed.staged ?? parsed.results ?? []);
  return rows.map((r) => ({
    id: r.id ?? r.stageId ?? r.stage_id,
    name: r.name ?? r.package,
    version: r.version,
  }));
}

let rows;
try {
  rows = staged();
} catch (e) {
  console.error(`\n${e.message}`);
  exit(1);
}
if (rows.length === 0) {
  console.log("nothing staged.");
  exit(0);
}

console.log(`${rows.length} staged version(s):`);
for (const r of rows) console.log(`  ${r.name}@${r.version}  (${r.id})`);

/* ---------- The version the TREE is at is the only version this script may approve ----------
 *
 * Staging is append-only from the registry's side: a version staged once cannot be re-staged, and every
 * push of `main` stages whatever `package.json` carries. So a correction landed after a stage — the
 * ordinary case, since staging happens on every push — leaves the earlier bytes sitting staged beside
 * the later ones, and this script used to approve EVERYTHING it listed. One `--otp` would have published
 * both the superseded bytes and the corrected ones. The tree knows which version it is at, so the tree
 * decides: rows at any other version are refused, named, and — only when asked — rejected. */
const treeVersion = (() => {
  const versions = new Set(
    readdirSync("packages")
      .map((p) => {
        try {
          return JSON.parse(readFileSync(join("packages", p, "package.json"), "utf8")).version;
        } catch {
          return undefined;
        }
      })
      .filter((v) => typeof v === "string"),
  );
  if (versions.size !== 1) {
    console.error(
      `\nthe tree carries ${versions.size} package versions (${[...versions].join(", ")}); the fixed group is one\n` +
        "number, so nothing can be approved until it is.",
    );
    exit(1);
  }
  return [...versions][0];
})();

const matching = rows.filter((r) => r.version === treeVersion);
const stale = rows.filter((r) => r.version !== treeVersion);
if (stale.length > 0) {
  console.log(`\n${stale.length} staged at a version this tree is NOT at (tree: ${treeVersion}):`);
  for (const r of stale) console.log(`  ${r.name}@${r.version}  (${r.id})`);
}

if (has("--list")) exit(0);
if (has("--dry-run")) {
  const staleNote =
    stale.length === 0
      ? "."
      : `; ${stale.length} stale row(s) would be ${has("--reject-stale") ? "rejected first" : "REFUSED — pass --reject-stale to reject them"}.`;
  console.log(`\n--dry-run: nothing approved. Would approve ${matching.length} at ${treeVersion}${staleNote}`);
  exit(0);
}

if (stale.length > 0 && !has("--reject-stale")) {
  console.error(
    `\nRefusing to approve: ${stale.length} staged row(s) are at a version other than ${treeVersion}, and an\n` +
      "approval here approves every row it is given. Either reject them first — `npm stage reject <id>` for\n" +
      "each id above — or re-run with --reject-stale to have this script reject them before approving the rest.",
  );
  exit(1);
}
for (const r of stale) {
  process.stdout.write(`rejecting ${r.name}@${r.version} … `);
  try {
    run("npm", ["stage", "reject", r.id]);
    console.log("rejected");
  } catch (cause) {
    console.log("FAILED");
    console.error(`\n${String(cause.stderr ?? cause.message).trim()}`);
    exit(1);
  }
}
if (matching.length === 0) {
  console.log(`\nnothing staged at ${treeVersion}; nothing to approve.`);
  exit(0);
}
rows = matching;

const otp = arg("--otp");
if (otp === undefined) {
  // No prompting, and no fallback to an unauthenticated attempt: an approval that silently did not happen
  // is the one outcome this script must never produce.
  console.error(
    "\n--otp <code> is required. Approval is a proof-of-presence action; npm will not accept an OIDC\n" +
      "token for it, and this script will not pretend to have approved something it did not.",
  );
  exit(1);
}

const approved = [];
for (const r of rows) {
  process.stdout.write(`approving ${r.name}@${r.version} … `);
  try {
    run("npm", ["stage", "approve", r.id, "--otp", otp]);
    console.log("live");
    approved.push(r);
  } catch (cause) {
    const msg = String(cause.stderr ?? cause.message);
    console.log("FAILED");
    // An expired or reused OTP is the expected failure on a long run, and continuing would burn the
    // remaining ids against a code npm has already rejected. Stop, report, let the operator re-run.
    if (/otp|one-time|EOTP|401|403/i.test(msg)) {
      console.error(
        `\nnpm rejected the OTP. ${approved.length} approved before this point and are live;\n` +
          "re-run with a fresh code to continue — what is already live will not appear as staged again.",
      );
    } else {
      console.error(`\n${msg.trim()}`);
    }
    break;
  }
}

if (approved.length === 0) exit(1);

/* ---------- Tagging ----------
 *
 * ⛔⛔ THIS STEP SILENTLY PRODUCED NOTHING FOR FIVE CONSECUTIVE RELEASES — 0.12.0 through 0.13.0, 155
 * tags — and the run that produced none still printed `pushed. N ... live and tagged.` The rewrite below
 * is aimed at that: the old code could not tell "tagged the right commit" from "tagged something", and
 * could not tell "pushed" from "the remote has it".
 *
 * Three defects, each fixed by a line you can point at:
 *
 *   1. `git tag -a <name> -m <name>` takes NO commit-ish, so it tags **HEAD**. Approval happens on a
 *      maintainer's machine, minutes-to-days after the workflow that built the artifact, so HEAD is
 *      whatever they last checked out. Demonstrated: with the release at `72a0530` and HEAD moved one
 *      commit on, every tag landed on the wrong commit and the script reported success.
 *      ⇒ The commit now comes from the package's OWN SLSA PROVENANCE on the registry — the same record
 *      `npm audit signatures` verifies — so the tag names the commit the published bytes were built
 *      from, not the commit the operator happens to be standing on.
 *   2. `git push origin --tags` pushes every local tag, including anything unrelated the operator has
 *      lying around, and says nothing about which ones the remote took.
 *      ⇒ Explicit refspecs, one per tag, and nothing else moves.
 *   3. Nothing verified the outcome. `push` returning 0 means the transport succeeded, not that the
 *      intended refs are on the remote at the intended commits.
 *      ⇒ `git ls-remote` afterwards, compared against what we meant to write, and a NON-ZERO EXIT when
 *      they disagree. A release that could not be tagged must not look like one that was.
 *
 * ⚠️ NO FALLBACK TO HEAD. If provenance cannot be read the script REFUSES and tells the operator to
 * re-run. Tagging the wrong commit is worse than not tagging: an untagged release is visibly missing,
 * while a mis-tagged one is a wrong answer that reads as a right one — which is precisely how this went
 * unnoticed five times. The registry also lags itself right after a publish, so the read retries before
 * it gives up. */

/** The commit a published version was built from, per its own SLSA provenance. `null` if unreadable. */
async function provenanceCommit(name, version) {
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(name)}@${version}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        for (const att of body.attestations ?? []) {
          if (!/slsa/i.test(att.predicateType ?? "")) continue;
          const payload = att.bundle?.dsseEnvelope?.payload;
          if (!payload) continue;
          const stmt = JSON.parse(Buffer.from(payload, "base64").toString());
          const deps =
            stmt.predicate?.buildDefinition?.resolvedDependencies ?? [];
          const sha = deps.find((d) => /git/i.test(d.uri ?? ""))?.digest
            ?.gitCommit;
          if (sha) return sha;
        }
      }
    } catch {
      // fall through to the wait — a transport blip and a 404 are the same "not yet" here
    }
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return null;
}

/** Every tag on the remote, mapped to the COMMIT it resolves to.
 *  Annotated tags emit two lines — the tag object, then `<ref>^{}` with the commit — and it is the
 *  second that answers "which commit is tagged". Comparing tag OBJECTS instead would report a false
 *  mismatch whenever a message or tagger differs, which is exactly what a re-run produces. */
function remoteTagCommits() {
  const map = new Map();
  for (const line of run("git", ["ls-remote", "--tags", "origin"]).split(
    "\n",
  )) {
    const [sha, ref] = line.split("\t");
    if (!ref) continue;
    const deref = ref.endsWith("^{}");
    const name = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    if (deref || !map.has(name)) map.set(name, sha);
  }
  return map;
}

console.log(`\ntagging ${approved.length} live version(s)…`);
const defects = [];
const desired = [];
for (const r of approved) {
  const tag = `${r.name}@${r.version}`;
  const sha = await provenanceCommit(r.name, r.version);
  if (sha === null) {
    defects.push(
      `${tag} — provenance unreadable on the registry (retried); NOT tagged`,
    );
    continue;
  }
  // The commit must be one THIS clone holds, or the tag would name an object the remote cannot resolve.
  try {
    run("git", ["cat-file", "-e", `${sha}^{commit}`]);
  } catch {
    defects.push(
      `${tag} — provenance names ${sha.slice(0, 8)}, absent from this clone; \`git fetch\` and re-run`,
    );
    continue;
  }
  let local = null;
  try {
    local = run("git", ["rev-list", "-n", "1", `refs/tags/${tag}`]).trim();
  } catch {
    // no local tag yet — the ordinary case on a fresh release
  }
  if (local === null) {
    run("git", [
      "tag",
      "-a",
      tag,
      sha,
      "-m",
      tag,
      "-m",
      `Published from ${sha.slice(0, 8)} via stage-only trusted publishing; approved with 2FA.\n` +
        "Commit taken from this package's own SLSA provenance on the registry, not from HEAD.\n" +
        "Verified present on the remote before this script reported success.",
    ]);
  } else if (local !== sha) {
    // A local tag naming a different commit is never silently corrected: moving a tag that may already
    // be published is a decision, not a repair.
    defects.push(
      `${tag} — local tag is at ${local.slice(0, 8)}, provenance says ${sha.slice(0, 8)}; left alone`,
    );
    continue;
  }
  desired.push({ tag, sha });
}

// ⛔ PUSH ONLY WHAT THE REMOTE LACKS. Re-pushing a tag the remote already holds is REJECTED by git
// ("already exists"), and the first version of this rewrite let that rejection escape as an uncaught
// stack trace — losing the report the operator actually needs. A tag the remote holds at a DIFFERENT
// commit is a defect to report, never something to force.
const before = remoteTagCommits();
const toPush = [];
for (const t of desired) {
  const at = before.get(t.tag);
  if (at === undefined) toPush.push(t);
  else if (at !== t.sha)
    defects.push(
      `${t.tag} — remote tag is at ${at.slice(0, 8)}, provenance says ${t.sha.slice(0, 8)}; NOT forced`,
    );
}
if (toPush.length > 0) {
  try {
    run("git", ["push", "origin", ...toPush.map((t) => `refs/tags/${t.tag}`)]);
  } catch (cause) {
    // Reported, never thrown: the packages are already live, so the operator needs the list of what is
    // untagged far more than a stack trace.
    defects.push(
      `push failed for ${toPush.length} tag(s): ${
        String(cause.stderr ?? cause.message)
          .trim()
          .split("\n")[0]
      }`,
    );
  }
}

// THE REMOTE IS THE ONLY WITNESS. `push` exiting 0 means the transport worked, not that the refs landed.
const after = remoteTagCommits();
const confirmed = desired.filter((t) => after.get(t.tag) === t.sha);
for (const t of desired)
  if (after.get(t.tag) !== t.sha)
    defects.push(
      `${t.tag} — not on the remote at ${t.sha.slice(0, 8)} after push`,
    );

console.log(
  `\n${approved.length} of ${rows.length} staged version(s) live; ${confirmed.length} of ${approved.length} tagged and confirmed on the remote.`,
);
if (approved.length !== rows.length)
  console.log(
    `${rows.length - approved.length} still staged — re-run with a fresh --otp.`,
  );
if (defects.length > 0) {
  console.error(
    `\n⛔ ${defects.length} problem(s) — these versions are LIVE BUT NOT TAGGED:\n` +
      defects.map((d) => `  - ${d}`).join("\n") +
      "\n\nThe packages are published; only tags are missing, so this is repairable. Re-run this script,\n" +
      "or write each tag by hand against the commit that version's own provenance names.\n",
  );
  exit(1);
}
