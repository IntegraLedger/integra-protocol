/**
 * Hold each PUBLISHED `dist/` against a rebuild of the source it was cut from.
 *
 * ⛔⛔ WHY `check:published-parity` DOES NOT ALREADY COVER THIS. That gate compares files under a declared
 * SOURCE directory, because source is tracked and therefore has something in the tree to be held against.
 * `dist/` is untracked, so it has nothing — and `dist/` is the entire consumed surface: every `exports`
 * target in this repository resolves into it. ⇒ A gate that reads the registry compares the half no
 * consumer loads, and the half every consumer loads is compared by nothing that reads the registry.
 *
 * ⭐ WHAT IT CATCHES: a publish cut from a stale build directory. `src/` ships correct, `dist/` ships old,
 * and every existing gate is green — the parity gate compares the src that is fine, and nothing else looks
 * at what actually shipped.
 *
 * ⛔⛔ WHAT IT DOES NOT CATCH, AND THIS WAS MEASURED IN THE SIBLING REPOSITORY RATHER THAN ASSUMED. An
 * artifact built from a tree that predates a feature is INTERNALLY COHERENT — the file is absent from its
 * src and from its dist alike — and this gate passes it. That failure belongs to `check:published-parity`,
 * which catches it by holding the published src against the tree. ⇒ This is a SECOND SUBJECT SET, not a
 * better instrument for the first one, and the two must not be merged.
 *
 * ⭐ REBUILDING IS SOUND HERE, MEASURED ACROSS ALL 31 PUBLISHABLE PACKAGES BEFORE THIS WAS WRITTEN. Each
 * was rebuilt at its published version and compared byte for byte against the tarball on npmjs:
 * 31 byte-identical, 0 mismatched, 0 skipped — including `@integraledger/lcp-conformance`, the one package
 * whose build is not a bare `tsc` (`tsc -p tsconfig.build.json && node scripts/pack-vectors.mjs`).
 *
 * ⚠️ Determinism holds AT THE PINNED TOOLCHAIN. A TypeScript bump changes emitted output legitimately, so a
 * red here after one is this gate telling the truth: the published artifact no longer corresponds to its
 * source. Republish; never weaken the gate. `--frozen-lockfile` is what makes the comparison mean anything.
 *
 * ⛔ ONE ROOT BUILD, NOT THIRTY-ONE PACKAGE BUILDS. `pnpm -r build` is how this repository builds and it
 * respects the dependency graph; thirty-one independent invocations would both be slower and build some
 * packages against stale siblings. ⚠️ The cost is coarser attribution — a build failure is reported against
 * the run rather than against one package — and that is stated rather than hidden.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  NetworkRegistry,
  publishableManifests,
  readManifests,
} from "./check-published-parity.mjs";

/**
 * ⛔ THE FLOOR: how many published `dist/` trees a healthy run compares. Held EQUAL to the count and never
 * merely below it — the sibling gate's reason applies unchanged: a package that silently LEFT the set
 * would keep a green behind it, and "raise it as packages start shipping" only ever moves in the
 * flattering direction.
 */
export const DIST_FLOOR = 31;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Every regular file under `dir`, as `Map<relPath, sha256>`; empty when `dir` is absent.
 *
 * ⛔⛔ `withFileTypes` RATHER THAN A `stat` PER ENTRY, FOR TWO REASONS, AND THE SIBLING REPOSITORY SHIPPED
 * THE SECOND ONE. `statSync` FOLLOWS symlinks, so an `isSymbolicLink()` guard written against it can never
 * be true: the link is followed and hashed, and the guard reads as present while doing nothing. Driven
 * there, the stat walk returned three entries — a link out of the tree and a link to a sibling, both
 * hashed — where this one returns the single regular file. ⚠️ CodeQL named the other half independently,
 * `js/file-system-race`: a check whose answer may be stale by the time the file is opened.
 */
export function hashTree(dir) {
  const out = new Map();
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      let buf;
      try {
        buf = readFileSync(p);
      } catch {
        continue;
      }
      out.set(relative(dir, p), sha256(buf));
    }
  };
  walk(dir);
  return out;
}

/** One half of a published tarball's entries, rekeyed without the prefix. */
export const underPrefix = (entries, prefix) => {
  const out = new Map();
  for (const [path, hash] of entries)
    if (path.startsWith(prefix)) out.set(path.slice(prefix.length), hash);
  return out;
};

/**
 * Compare two `Map<path, sha256>` in BOTH directions.
 *
 * ⛔ NAMED FOR THE SIDE EACH IS ON. The sibling repository first called these `absent` and `extra` and then
 * wrote the two drift sentences the other way round, so a file present in the tarball and NOT emitted by
 * the source was reported as "the published dist is MISSING it". Both messages existed and both fired; only
 * the diagnosis was inverted, which no count-only assertion can see.
 */
export function compare(published, rebuilt) {
  return {
    onlyPublished: [...published.keys()].filter((k) => !rebuilt.has(k)).sort(),
    onlyRebuilt: [...rebuilt.keys()].filter((k) => !published.has(k)).sort(),
    different: [...published.keys()]
      .filter((k) => rebuilt.has(k) && published.get(k) !== rebuilt.get(k))
      .sort(),
  };
}

export const buildAll = (root) =>
  execFileSync("pnpm", ["-r", "build"], {
    cwd: root,
    stdio: "pipe",
    encoding: "utf8",
  });

/**
 * ⛔ `faults` are the INSTRUMENT failing and are never reported as a product finding. `skipped` is a
 * package this gate deliberately declined to judge, and must never be counted as compared.
 */
export async function distParityReport({
  manifests,
  registry,
  root,
  build = buildAll,
}) {
  const drift = [];
  const faults = [];
  const skipped = [];
  const notes = [];
  let compared = 0;

  const subjects = publishableManifests(manifests);

  // ⛔ Fetch everything BEFORE building: a rebuild that runs and is then thrown away because the registry
  // was unreachable spends thirty-one builds to report a fault it could have reported first.
  const fetched = [];
  for (const { path, pkg } of subjects) {
    // ⛔ This repository's `readManifests` answers `{ name, path, pkg }`, where `name` is the DIRECTORY
    // and the package's own name is `pkg.name`. The sibling repository's answers `{ dir, pkg }`. Writing
    // this gate independently rather than porting the sibling's is what surfaced the difference, at the
    // cost of one run — a port would have read `dir` as undefined and joined it.
    const dir = dirname(path);
    const { name, version } = pkg;
    try {
      const meta = await registry.metadata(name);
      const v = meta.versions?.[version];
      if (v === undefined) {
        notes.push(
          `${name}@${version} is not published — a release in progress is not a lost subject, and this gate gives no opinion on it.`,
        );
        skipped.push(name);
        continue;
      }
      fetched.push({
        dir,
        name,
        version,
        entries: await registry.contents(name, version, v.dist?.tarball),
      });
    } catch (err) {
      faults.push(`${name}@${version} — ${err.message}`);
    }
  }

  if (faults.length > 0 || fetched.length === 0)
    return { drift, faults, skipped, notes, compared };

  try {
    build(root);
  } catch (err) {
    faults.push(
      `the root rebuild failed, so nothing could be compared: ${String(err.message).slice(0, 400)}`,
    );
    return { drift, faults, skipped, notes, compared };
  }

  for (const { dir, name, version, entries } of fetched) {
    const pubDist = underPrefix(entries, "dist/");
    if (pubDist.size === 0) {
      faults.push(
        `${name}@${version} published NO dist/ entries; a tick here would be a statement about an artifact this run never opened.`,
      );
      continue;
    }

    // ⛔ A rebuild is only meaningful if the published source is the source we hold. When it is not, that is
    // `check:published-parity`'s finding and this gate gives NO dist verdict — a true red with a false
    // diagnosis is worse than no verdict.
    const srcDiff = compare(
      underPrefix(entries, "src/"),
      hashTree(join(dir, "src")),
    );
    if (
      srcDiff.onlyPublished.length +
        srcDiff.onlyRebuilt.length +
        srcDiff.different.length >
      0
    ) {
      skipped.push(name);
      notes.push(
        `${name}@${version} — the published src differs from the tree, so a rebuild would be of the wrong source. That is \`check:published-parity\`'s finding, not this one.`,
      );
      continue;
    }

    const rebuilt = hashTree(join(dir, "dist"));
    if (rebuilt.size === 0) {
      faults.push(
        `${name}@${version} — the rebuild emitted no dist/, so nothing was compared.`,
      );
      continue;
    }

    const d = compare(pubDist, rebuilt);
    compared += 1;
    if (d.onlyRebuilt.length > 0)
      drift.push(
        `${name}@${version} — the published dist/ is MISSING ${d.onlyRebuilt.length} file(s) this source emits: ${d.onlyRebuilt.slice(0, 8).join(", ")}`,
      );
    if (d.onlyPublished.length > 0)
      drift.push(
        `${name}@${version} — the published dist/ carries ${d.onlyPublished.length} file(s) this source does not emit: ${d.onlyPublished.slice(0, 8).join(", ")}`,
      );
    if (d.different.length > 0)
      drift.push(
        `${name}@${version} — ${d.different.length} published dist/ file(s) DIFFER in content from the rebuild: ${d.different.slice(0, 8).join(", ")}`,
      );
  }

  return { drift, faults, skipped, notes, compared };
}

/**
 * ⛔⛔ ZERO COMPARED IS UNMEASURED HOWEVER WELL ACCOUNTED FOR. A run that skipped every package because a
 * full release is in flight has no opinion to give, and a tick there is the empty-subject-set defect.
 */
export function verdict({
  drift,
  faults,
  skipped,
  compared,
  floor = DIST_FLOOR,
}) {
  if (drift.length > 0) return { code: 1, kind: "drift" };
  if (faults.length > 0) return { code: 3, kind: "fault" };
  if (compared === 0) return { code: 2, kind: "unmeasured" };
  if (compared + skipped.length !== floor)
    return { code: 4, kind: "stale-floor" };
  return { code: 0, kind: "parity" };
}

export async function main({
  root = new URL("..", import.meta.url).pathname,
  registry = NetworkRegistry({}),
} = {}) {
  const manifests = readManifests(root);
  const report = await distParityReport({ manifests, registry, root });
  const v = verdict(report);

  for (const n of report.notes) console.log(`  · ${n}\n`);

  if (v.kind === "drift") {
    console.error("\n✕ check:published-dist-parity — DRIFT\n");
    for (const d of report.drift) console.error(`   • ${d}`);
    console.error(
      "\n⛔ The dist/ a consumer loads is not what this source emits. A version is a promise about bytes: the remedy is a version bump and a release, never an adjustment here.\n",
    );
    return v.code;
  }
  if (v.kind === "fault") {
    console.error("\n✕ check:published-dist-parity — THE INSTRUMENT FAILED\n");
    for (const f of report.faults) console.error(`   • ${f}`);
    console.error(
      "\n⛔ NOT a product finding and must not be reported as one.\n",
    );
    return v.code;
  }
  if (v.kind === "stale-floor") {
    console.error(
      `\n✕ check:published-dist-parity — the floor is ${DIST_FLOOR} and this run accounted for ${report.compared + report.skipped.length}. ⛔ Raise DIST_FLOOR when a package joins; never lower it to quieten one that left.\n`,
    );
    return v.code;
  }
  if (v.kind === "unmeasured") {
    console.error(
      `\n⚠ check:published-dist-parity — UNMEASURED: ${report.compared} compared. A run that opened no published dist has no opinion to give.\n`,
    );
    return v.code;
  }

  console.log(
    `✓ check:published-dist-parity — ${report.compared} published dist/ tree(s) rebuilt from their own source and matched byte for byte.`,
  );
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname)
  process.exit(await main());
