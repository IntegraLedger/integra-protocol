#!/usr/bin/env node
/**
 * Hold every PUBLISHED package against the source at the SAME version, BY CONTENT.
 *
 * ★ INSTALLED WHILE THIS TREE IS CLEAN, AND THAT IS THE ARGUMENT FOR IT. `M` 2026-09-14: all 31 publishable
 * packages here match their published artifacts byte for byte. A gate installed on a clean subject has a
 * green that MEANS something — its first red is a new regression. A gate installed on a drifted subject is
 * permanently red until someone cuts a release, and its green only ever says "the known backlog is still
 * there". The clean moment is the rare one and it does not come back once a repository drifts.
 *
 * ⛔ WHAT IT WATCHES FOR, measured in the sibling repository rather than imagined here. In
 * `integra-agentic-terms`, `packages/agentic-terms/src/x402-envelope.ts` is tracked on `main`, exported, and
 * ABSENT from the published `0.17.0` tarball — while the source `package.json` also reads `0.17.0`. The work
 * landed four and a half hours AFTER that version published. Source and registry agreed on the version
 * string and disagreed on the bytes, and every gate in that repository stayed green: its `check:dist` built
 * from correct source, its runtime smoke packs the working tree, and its tag reconciliation asks whether
 * published versions are TAGGED rather than CURRENT. Six defects across two packages, and nothing saw them.
 *
 * ★ SAME VERSION MUST MEAN SAME CONTENT. A version number is a promise about bytes.
 *
 * ⛔ AND IT COMPARES HASHES, NOT FILENAMES. A filename check saw ONE of the six defects in that sibling: one
 * file was absent and five were PRESENT WITH DIFFERENT BYTES. Editing a published file without a bump is the
 * commoner shape and is exactly the one a name-only comparison cannot see.
 *
 * ## ⛔ THE STATED LIMITS, ANNOUNCED RATHER THAN HIDDEN
 *
 * Only files under a declared SOURCE directory are compared. `dist/` is build output: comparing it would
 * require reproducing the exact toolchain of whatever machine published, and a mismatch would be a finding
 * about build determinism rather than drift. A package shipping `dist` alone is reported NOT COMPARABLE
 * rather than silently passing — an unmeasured package must never read as a clean one.
 *
 * ⛔ A SHRINKING SUBJECT SET IS THE FAILURE THIS GATE IS MOST LIKELY TO DIE OF, so it carries a FLOOR.
 * Dropping `src` from a package's `files` — an ordinary "stop shipping source" edit — would turn that
 * package into a NOT COMPARABLE note while the rest compared green, and the run would exit 0 over the
 * absence of the subject that mattered.
 *
 * ⛔ AN UNREACHABLE REGISTRY IS A FAULT, never "in parity" — and A FAULT IS NOT DRIFT. Exit 3 says the
 * instrument failed; exit 1 says an artifact is behind. Filing the second over the first asserts a defect
 * nobody measured.
 *
 * ⚠️ THIS IS A SECOND COPY OF THE SIBLING REPOSITORY'S GATE, and that is a known cost rather than an
 * oversight. The two repositories share no package, so sharing the logic would mean publishing one, and that
 * is a decision nobody has taken. Until it is, the copies are independent and may drift; the drive is what
 * keeps this one honest.
 *
 * USAGE
 *   node scripts/check-published-parity.mjs
 *
 * ⚠️ `INTEGRA_PARITY_ROOT` and `INTEGRA_PARITY_ORIGIN` exist so the drive can run THIS FILE as a process
 * against a fixture tree and a local registry, and assert the exit CODES rather than the return values — the
 * workflow reads the process's code, and a drive that only checks return values does not span that join.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { argv, env, exit } from "node:process";
import { gunzipSync } from "node:zlib";

export const REGISTRY_ORIGIN = "https://registry.npmjs.org";

/** Directories in `files[]` that hold TRACKED SOURCE, and are therefore comparable byte-for-byte. */
const SOURCE_DIRS = new Set(["src"]);

/**
 * ⛔ THE FLOOR: how many packages this repository declares comparable. `M` 2026-09-15: 32 manifests, 31
 * publishable — `lcp-rail-invariants` is `private: true` and correctly excluded — and 31 comparable.
 *
 * ⛔⛔ **IT IS A DECLARATION HELD EQUAL TO THE TREE, NOT A FLOOR TO CLEAR.** See {@link floorRefusal}.
 * Written as a one-sided floor, it went stale by construction: a number a human must remember to raise at
 * exactly the moment they are thinking about something else, which is a release. A package that JOINS the
 * comparable set and is not counted here leaves exactly one package's worth of slack — so the next package
 * to LEAVE the set is absorbed silently, and the run prints a tick over a subject that walked away.
 */
export const COMPARABLE_FLOOR = 31;

/**
 * The packages this gate's floor is a declaration ABOUT — derived from the TREE, never from the registry.
 *
 * ⛔⛔ **AND THAT DISTINCTION IS THE WHOLE OF WHY THIS IS NOT `checked`.** `parityReport`'s `checked` counts
 * what a run actually compared, and it legitimately drops: a package whose source version is not on the
 * registry yet is skipped with a note, which is the ORDINARY state of every package between a version bump
 * and the publish that follows it. Holding a declaration equal to THAT would refuse on a healthy tree every
 * time somebody bumped a version — a control whose failure mode is "the release you are preparing is the
 * red", which has moved the work rather than removed it.
 *
 * ⇒ Membership here is two tree facts and no network: the package publishes, and it ships source. Dropping
 * `src` from a `files` field — an ordinary "stop shipping source" cleanup — changes this count, which is
 * precisely the silent departure the floor exists to catch.
 */
export function comparableSubjects(manifests) {
  return publishableManifests(manifests).filter(
    ({ path, pkg }) =>
      declaredSourceFiles(join(path, ".."), pkg.files).comparable,
  );
}

/**
 * Whether {@link COMPARABLE_FLOOR} still agrees with the tree. `null` when it does.
 *
 * ⛔⛔ **BOTH DIRECTIONS, BECAUSE A GATE THAT REFUSES ONE IS REFUSING HALF THE QUERY.**
 *
 *   fewer than the floor — a subject LEFT the set, and lowering the number to match would delete the
 *                          coverage rather than notice it
 *   more than the floor  — a subject JOINED and the declaration is behind the tree. ⭐ THIS is the
 *                          direction that was silent, and it is the one that matters: the slack it leaves
 *                          is exactly what lets the NEXT departure pass unnoticed
 *
 * ⭐ The `>` refusal fires on the first run after a package becomes comparable, which is the run whose
 * author is already holding that package in mind. The number is raised in the change that created the
 * subject rather than years later by somebody auditing.
 *
 * ⚠️ **Reported as a FAULT rather than as UNMEASURED, deliberately.** `unmeasured` means the registry side
 * could not answer. This is the gate's own declaration disagreeing with the tree it is pointed at — the
 * instrument is misdeclared, and that must never read as a statement about the product.
 */
export function floorRefusal({ manifests, floor = COMPARABLE_FLOOR }) {
  const subjects = comparableSubjects(manifests);
  if (subjects.length === floor) return null;
  const names = subjects
    .map(({ pkg }) => pkg.name)
    .sort()
    .join(", ");
  return subjects.length > floor
    ? `COMPARABLE_FLOOR is ${floor}; the tree now holds ${subjects.length} comparable package(s). ` +
        "A package JOINED the comparable set and the declaration was not raised with it. ⛔ Raise it in " +
        "the change that added the package: every unraised subject is one silent departure this gate " +
        `would go on to absorb. The ${subjects.length} are: ${names}.`
    : `COMPARABLE_FLOOR is ${floor}; the tree now holds only ${subjects.length} comparable package(s). ` +
        "A package LEFT the comparable set — it stopped publishing, or stopped shipping source. ⛔ Do not " +
        "lower this number to match: that deletes the coverage instead of noticing it. Restore the " +
        `package's source in \`files\`, or remove it deliberately and say so. The ${subjects.length} ` +
        `remaining are: ${names}.`;
}

/**
 * Read every package manifest under `packages/`.
 *
 * ⚠️ Written here rather than imported: this repository has no shared manifest helper, and the sibling's
 * lives in a file that is about protocol dependency ranges, which is a different subject.
 */
export function readManifests(root) {
  const out = [];
  const dir = join(root, "packages");
  for (const name of readdirSync(dir)) {
    const path = join(dir, name, "package.json");
    try {
      out.push({ name, path, pkg: JSON.parse(readFileSync(path, "utf8")) });
    } catch {
      // a directory with no manifest is not a package; a malformed one is caught by `check:versions`
    }
  }
  if (out.length === 0)
    throw new Error(
      `no package manifest found under ${dir} — the subject set would be empty`,
    );
  return out;
}

/* ------------------------------------------------------------------ the subject set */

/**
 * Every package this repository declares publishable. ⛔ The predicate is the one a PUBLISH uses — `private`
 * absent or false AND `publishConfig.access` public — never a hand-kept list, which would be a second place
 * for the judgement to live and the place it would go stale.
 */
export function publishableManifests(manifests) {
  return manifests.filter(
    ({ pkg }) =>
      pkg.private !== true &&
      pkg.publishConfig?.access === "public" &&
      typeof pkg.name === "string" &&
      typeof pkg.version === "string",
  );
}

/**
 * npm accepts `src`, `src/` and `./src` for one directory. ⛔ A first draft normalised only for the
 * membership test and then interpolated the RAW spelling, so `"files": ["src/"]` produced `src//a.ts` and
 * reported every file in the package as missing, while `"./src"` fell out of `SOURCE_DIRS` entirely and took
 * the package out of the subject set — a false red and a false green from two legal spellings of one thing.
 */
const normaliseDir = (f) => f.replace(/^\.\//, "").replace(/\/+$/, "");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Walk, yielding one entry per file and one per unreadable path rather than abandoning the directory. */
function* walk(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    yield { path: dir, error: error.code ?? String(error) };
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try {
      // `lstatSync`: a broken symlink becomes a fault to NAME, not an exception that loses its siblings.
      st = lstatSync(p);
    } catch (error) {
      yield { path: p, error: error.code ?? String(error) };
      continue;
    }
    if (st.isSymbolicLink()) {
      yield {
        path: p,
        error: "a symbolic link — not comparable byte-for-byte",
      };
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else yield { path: p };
  }
}

/** The source a manifest declares it ships: `{ comparable, files: Map<relPath, sha256>, faults }`. */
export function declaredSourceFiles(packageDir, files) {
  const dirs = (files ?? [])
    .map(normaliseDir)
    .filter((f) => SOURCE_DIRS.has(f));
  const out = new Map();
  const faults = [];
  for (const d of dirs) {
    const abs = join(packageDir, d);
    for (const { path, error } of walk(abs)) {
      if (error) {
        // ⛔ NAMED, NEVER SWALLOWED. A first draft caught at the DIRECTORY level and continued, so one
        // broken symlink emptied the whole directory and the run then refused with "declares a source
        // directory and it holds no files" — a true refusal carrying a false diagnosis.
        faults.push(`${d}/${relative(abs, path)}: ${error}`);
        continue;
      }
      out.set(`${d}/${relative(abs, path)}`, sha256(readFileSync(path)));
    }
  }
  return { comparable: dirs.length > 0, files: out, faults };
}

/* ------------------------------------------------------------------ reading a tarball safely */

/**
 * \u26d4\u26d4 THE ARCHIVE IS NEVER EXTRACTED TO DISK, AND THAT IS A SECURITY PROPERTY RATHER THAN A STYLE CHOICE.
 *
 * A first draft wrote the downloaded tarball to a temp directory and shelled out to `tar xzf`. GitHub's
 * CodeQL flagged it on the pull request \u2014 *"network data written to file: write to file system depends on
 * untrusted data"* \u2014 and it was right. A registry tarball is externally controlled input, and extracting
 * one is a path-traversal and symlink-escape surface: an entry named `../../x`, an absolute path, or a
 * symlink followed by a later entry can place bytes outside the directory the caller chose. That modern GNU
 * tar strips most of those is a property of the tool that happened to be on the box, not of this code.
 *
 * \u2b50 So the tar is walked in memory and only REGULAR FILE entries are hashed. Nothing is written, nothing is
 * executed, and a hostile entry name can at worst appear as a key in a Map that is then compared against a
 * list of names this repository already declared. The traversal class is not mitigated; it is absent.
 *
 * The format is POSIX ustar: 512-byte header, `size` as octal at offset 124, content padded to 512.
 * Type `0` or NUL is a regular file; `x`/`g` are pax metadata and `L` is a GNU long name, whose payloads are
 * skipped along with everything else that is not a regular file.
 */
export function hashTarEntries(tar) {
  const out = new Map();
  const BLOCK = 512;
  for (let off = 0; off + BLOCK <= tar.length; ) {
    const header = tar.subarray(off, off + BLOCK);
    // Two consecutive NUL blocks end the archive; one is enough to stop reading names.
    if (header[0] === 0) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header
      .subarray(345, 500)
      .toString("utf8")
      .replace(/\0.*$/, "");
    const sizeField = header
      .subarray(124, 136)
      .toString("utf8")
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeField, 8);
    if (!Number.isFinite(size) || size < 0)
      throw new Error(`tar entry '${name}' has an unreadable size field`);

    const type = String.fromCharCode(header[156]);
    const body = off + BLOCK;
    if ((type === "0" || type === "\0") && name.length > 0)
      out.set(
        prefix.length > 0 ? `${prefix}/${name}` : name,
        sha256(tar.subarray(body, body + size)),
      );

    off = body + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

/* ------------------------------------------------------------------ the registry seam */

/**
 * The real registry. ⭐ Exposed as a SEAM so the drive can exercise every verdict offline — and the drive
 * ALSO runs this implementation against a local HTTP server, because a seam whose real half is never
 * executed is a seam whose real half is unmeasured: replacing all of `NetworkRegistry` with stubs once broke
 * no test at all.
 */
export function NetworkRegistry({
  origin = env["INTEGRA_PARITY_ORIGIN"] ?? REGISTRY_ORIGIN,
  fetchImpl = fetch,
} = {}) {
  return {
    async metadata(name) {
      const res = await fetchImpl(`${origin}/${encodeURIComponent(name)}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) return { versions: {} };
      if (!res.ok)
        throw new Error(`registry answered ${res.status} for ${name}`);
      return await res.json();
    },
    /** `Map<pathWithoutPackagePrefix, sha256>` for every regular file in the published tarball. */
    async contents(name, version, tarballUrl) {
      if (typeof tarballUrl !== "string" || tarballUrl.length === 0)
        throw new Error(
          `${name}@${version} carries no dist.tarball in its registry metadata`,
        );
      const res = await fetchImpl(tarballUrl);
      if (!res.ok)
        throw new Error(
          `tarball for ${name}@${version} answered ${res.status}`,
        );
      const entries = hashTarEntries(
        gunzipSync(Buffer.from(await res.arrayBuffer())),
      );
      // \u26d4 npm wraps every tarball in a single `package/` directory, and the caller compares against
      // paths relative to the package root. Dropping the strip made every declared file read as ABSENT \u2014
      // 16 of 16 rather than the 4 real defects \u2014 which is a false RED, the cheap direction, and was
      // caught by the drive's assertion that the prefix is removed.
      const out = new Map();
      for (const [path, hash] of entries)
        if (path.startsWith("package/"))
          out.set(path.slice("package/".length), hash);
      return out;
    },
  };
}

/* ------------------------------------------------------------------ the report */

/**
 * Compare each publishable package's source against the artifact published at the SAME version.
 *
 * `drift`  — the artifact is behind its own source. A product finding.
 * `faults` — the instrument could not measure. ⛔ NOT a product finding, and never reported as one.
 * `checked`— packages actually COMPARED, so a caller can refuse a run that measured less than the floor.
 */
export async function parityReport({ manifests, registry }) {
  const drift = [];
  const faults = [];
  const notes = [];
  let checked = 0;

  const subjects = publishableManifests(manifests);
  if (subjects.length === 0)
    return {
      drift,
      faults: [
        "no package in this repository declares itself publishable (`private` absent and " +
          "`publishConfig.access: public`). That is a subject set of zero, not a clean run — either the " +
          "predicate is wrong or this gate is pointed at the wrong tree.",
      ],
      notes,
      checked: 0,
    };

  for (const { name: dirName, path, pkg } of subjects) {
    const packageDir = join(path, "..");
    const label = `${pkg.name}@${pkg.version}`;

    let meta;
    try {
      meta = await registry.metadata(pkg.name);
    } catch (error) {
      faults.push(
        `${pkg.name} — the registry could not be read (${error.message}). ` +
          "⛔ An unreachable registry is NOT parity: nothing was compared.",
      );
      continue;
    }

    const versions = meta?.versions ?? {};
    if (Object.keys(versions).length === 0) {
      notes.push(
        `${pkg.name} — never published (\`${dirName}\` declares itself publishable). Nothing to compare; ` +
          "a first publish is not drift. ⚠️ A registry 404 reads the same way here, so a package that was " +
          "unpublished or renamed arrives as this note — which is what the floor exists to catch.",
      );
      continue;
    }

    const published = versions[pkg.version];
    if (published === undefined) {
      notes.push(
        `${label} — this version is not on the registry yet, so there is nothing to be out of parity with. ` +
          `Published: ${Object.keys(versions).sort().join(", ")}.`,
      );
      continue;
    }

    const {
      comparable,
      files: sourceFiles,
      faults: walkFaults,
    } = declaredSourceFiles(packageDir, pkg.files);

    if (walkFaults.length > 0) {
      faults.push(
        `${label} — ${walkFaults.length} source path(s) could not be read, so any comparison would be over ` +
          `a partial set:\n${walkFaults.map((f) => `        - ${f}`).join("\n")}`,
      );
      continue;
    }
    if (!comparable) {
      notes.push(
        `${label} — NOT COMPARABLE: it declares no source directory in \`files\` ` +
          `(${JSON.stringify(pkg.files ?? [])}). Build output is deliberately not compared. ` +
          "⚠️ Read this as unmeasured, never as clean.",
      );
      continue;
    }
    if (sourceFiles.size === 0) {
      faults.push(
        `${label} declares a source directory in \`files\` and that directory holds no files in this tree. ` +
          "A comparison against an empty source set would pass over nothing.",
      );
      continue;
    }

    let contents;
    try {
      contents = await registry.contents(
        pkg.name,
        pkg.version,
        published.dist?.tarball,
      );
    } catch (error) {
      faults.push(
        `${label} — the published tarball could not be read (${error.message}). Not compared.`,
      );
      continue;
    }

    if (contents.size === 0) {
      faults.push(
        `${label} — the published tarball yielded no files. The artifact is empty or its layout changed; ` +
          "either way nothing was compared.",
      );
      continue;
    }

    const missing = [];
    const differing = [];
    for (const [rel, hash] of sourceFiles) {
      const theirs = contents.get(rel);
      if (theirs === undefined) missing.push(rel);
      else if (theirs !== hash) differing.push(rel);
    }
    checked += 1;

    if (missing.length > 0 || differing.length > 0) {
      const lines = [
        ...missing.map((f) => `        - ABSENT    ${f}`),
        ...differing.map((f) => `        - DIFFERENT ${f}`),
      ];
      drift.push(
        `⛔ ${label} IS PUBLISHED AND IS BEHIND ITS OWN SOURCE — ${missing.length} file(s) absent, ` +
          `${differing.length} present with different bytes:\n${lines.join("\n")}\n\n` +
          `      The source tree and the registry both say \`${pkg.version}\`, so a version bump and a ` +
          "publish are what close this — republishing the same version is not possible and is not the " +
          `remedy. Control: ${contents.size} file(s) were read from that tarball and ${sourceFiles.size} ` +
          "from this tree, so both sides of the comparison were populated.",
      );
    }
  }

  return { drift, faults, notes, checked };
}

/**
 * ⛔⛔ FOUR ANSWERS, AND THREE OF THEM ARE NOT "PASS". Collapsing any pair would state something nobody
 * measured. This estate learned the distinction on the measured-run lock, where `--conflict-exit-code 75`
 * keeps "never got the box" separate from "below floor".
 *
 *   0  compared at least `floor` packages, and every one matched its source byte-for-byte
 *   1  DRIFT — a published artifact is behind its own source. A product finding.
 *   2  UNMEASURED — fewer than `floor` packages were comparable. No opinion is available.
 *   3  FAULT — the instrument failed. ⛔ Never reported as drift.
 */
export function verdict({ drift, faults, checked, floor = COMPARABLE_FLOOR }) {
  if (drift.length > 0) return { code: 1, kind: "drift" };
  if (faults.length > 0) return { code: 3, kind: "fault" };
  if (checked < floor)
    return {
      code: 2,
      kind: "unmeasured",
      message:
        `only ${checked} package(s) were compared, below the floor of ${floor}. Every other publishable ` +
        "package was ahead of the registry, never published, or not comparable on this axis. ⛔ A package " +
        "that LEAVES the comparable set takes its own coverage with it, and a run over what remains must " +
        "not print a tick. This is not a pass, it is not drift, and the instrument did not fail.",
    };
  return { code: 0, kind: "parity" };
}

/* ------------------------------------------------------------------ entry point */

async function main() {
  const root =
    env["INTEGRA_PARITY_ROOT"] ?? new URL("..", import.meta.url).pathname;
  const manifests = readManifests(root);

  /**
   * ⛔ The floor is INJECTABLE for the reason every port in this repository is: so a drive can point the
   * whole process at a fixture. ⚠️ A malformed value is refused rather than coerced — `Number("x")` is
   * `NaN`, every comparison against it is false, and the refusal below would then report the wrong
   * direction with complete confidence.
   */
  const declared = env["INTEGRA_PARITY_FLOOR"];
  let floor = COMPARABLE_FLOOR;
  if (declared !== undefined) {
    floor = Number(declared);
    if (!Number.isInteger(floor) || floor < 0) {
      console.error(
        `\n✕ check:published-parity — INTEGRA_PARITY_FLOOR is ${JSON.stringify(declared)}, ` +
          "which is not a whole number. Nothing was compared.\n",
      );
      exit(3);
    }
  }

  // ⛔ BEFORE THE NETWORK. This asks a question about the tree, so it must answer whether or not the
  // registry is reachable — and a run that cannot reach the registry is exactly when a stale declaration
  // would otherwise go another cycle unnoticed.
  const staleFloor = floorRefusal({ manifests, floor });
  if (staleFloor !== null) {
    console.error(
      `\n✕ check:published-parity — THE FLOOR NO LONGER DESCRIBES THIS TREE\n\n  • ${staleFloor}\n`,
    );
    exit(3);
  }

  const { drift, faults, notes, checked } = await parityReport({
    manifests,
    registry: NetworkRegistry(),
  });

  for (const n of notes) console.log(`  · ${n}\n`);

  const v = verdict({ drift, faults, checked, floor });

  // ⛔⛔ **GUARDED ON THE POSITIVE CONDITION, AND THAT IS THE CONTROL RATHER THAN ANOTHER ARM.**
  //
  // This tested three kinds BY NAME and let anything else fall through to the success line below. The
  // function was correct and the process that reads it was blind: a verdict added later — any fifth kind,
  // for any reason — would have printed a tick and exited 0. ⛔ Nothing that drives `verdict()` can see
  // that, by construction, which is why 23 green unit cases in the sibling repository sat over exactly
  // this shape until the gate was run as a PROCESS.
  //
  // ⇒ Inverting the guard makes the hazard impossible rather than handled: the worst a missing arm can now
  // do is print less detail. A kind nobody wrote an arm for still refuses, still carries its own exit
  // code, and cannot reach the tick.
  if (v.kind !== "parity") {
    if (v.kind === "drift") {
      console.error("\n✕ check:published-parity — DRIFT\n");
      for (const d of drift) console.error(`  • ${d}\n`);
    } else if (v.kind === "fault") {
      console.error("\n✕ check:published-parity — THE INSTRUMENT FAILED\n");
      for (const f of faults) console.error(`  • ${f}\n`);
    } else {
      console.error(
        `\n⚠ check:published-parity — ${v.message ?? `refused as \`${v.kind}\``}\n`,
      );
    }
    exit(v.code);
  }

  console.log(
    `✓ every published version matches the source it was cut from, byte for byte ` +
      `(${checked} package(s) compared, floor ${floor}).`,
  );
}

// Importable for its drive; the registry read happens only when this file IS the entry point.
// ⛔ BOTH SIDES REALPATHED, for the reason `reconcile-tags.mjs` records: `import.meta.filename` is already
// resolved through symlinks and `argv[1]` is not, so the naive comparison makes the whole script a silent
// no-op for anyone whose checkout is reached through a symlinked directory.
if (
  argv[1] !== undefined &&
  realpathSync(resolve(argv[1])) === import.meta.filename
)
  await main();
