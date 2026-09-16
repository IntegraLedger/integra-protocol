/**
 * The drive for `check:published-dist-parity`.
 *
 * ⛔⛔ THE LIVE CONTROL IS NOT IN THIS FILE ANY MORE. It runs from
 * `.github/workflows/published-dist-parity.yml`, and everything left here injects its registry, so `pnpm
 * verify` now reaches no third party from this file at all. Ruled 2026-09-16; tracked on the planning
 * register as row 281. The two reasons are below, and the first one is a release deadlock rather than a
 * preference.
 *
 *   ⛔⛔ A BUMP COMMIT REDS A LIVE CONTROL, AND THE BUMP COMMIT IS THE RELEASE. `.changeset/config.json`
 *   declares ONE fixed group, `@integraledger/lcp-*`, and all 31 publishable packages match it at a single
 *   version (0.18.3, measured 2026-09-16). `changeset version` therefore moves ALL THIRTY-ONE at once;
 *   every one is then unpublished, every one is skipped as "is not published", and `compared` is 0 —
 *   driven against the live registry with the manifests bumped in memory: `compared = 0, skipped = 31,
 *   verdict() -> unmeasured` (check-published-dist-parity.mjs:257). ⇒ A live control inside `verify` fails
 *   at `compared > 0`, `pnpm test` reds, `ci` reds, and `release.yml` fires only off a GREEN `ci` —
 *   `workflow_run` on one path and an API read of this commit's `ci` conclusion on the manual one, so both
 *   entry points are gated. The packages could not be published until the release ran, and the release
 *   could not run until they were published.
 *
 *   ⭐ The other half of that deadlock was measured rather than assumed, on a tree with NO bump: the
 *   release run for this file's own landing commit completed, found all 31 versions already live and
 *   reported `staged 0; already staged 0; live on the registry 31 — nothing to release`. ⇒ The release path
 *   is exercised on every green `ci` on `main` and is a green no-op; a version bump is the only thing that
 *   turns it into a release, and that is precisely the commit a live control refuses.
 *
 *   ⛔ AND IT WAS NEVER ADMISSIBLE IN `verify` ON THIS REPOSITORY'S OWN RULE. `check:hermetic-tests`
 *   (stage 7 of 20) refuses a non-live test that reaches a third party, and `NetworkRegistry({})` defaults
 *   to the real registry origin (`check-published-parity.mjs:304`). The live control passed that gate only
 *   because `registry.npmjs.org` carries a `namedNotCalled` declaration — a claim that the host "is never
 *   fetched" — written for the SIBLING gate's drive, which injects a local `node:http` server. That gate
 *   declares by HOST over the whole tree and not by file, so the claim covered this file by coincidence.
 *   ⇒ Stage 7 was green over a declaration this file had falsified. It is true again now, and the
 *   declaration says so in as many words.
 *
 * ⇒ WHERE THE LIVE MEASUREMENT LIVES NOW. `published-dist-parity.yml` runs `check-published-dist-parity.mjs`
 * itself — every six hours and on dispatch, with an install, a `--frozen-lockfile` toolchain and a real
 * build — and maps the gate's five verdicts onto a job status and a summary line: drift, a stale floor and
 * an instrument fault RED the job; `unmeasured` is REPORTED and green, because at a bump commit a run that
 * opened no published dist is telling the truth and must not stand between a release and its own gate.
 *
 * ⛔ THE LIVE DRIVER IS THE GATE SCRIPT, NOT A TEST FILE THAT ONLY THAT WORKFLOW RUNS, and the reason is
 * measurable rather than aesthetic: `check-hermetic-tests.mjs` ENUMERATES its test subjects by walking
 * `packages/` on disk (`:166`) and knows nothing about which command ran them. A registry-reaching
 * `.test.ts` parked here "for the workflow only" would be enumerated as a non-live test exactly as the live
 * control was, and would need the same declaration defect to stay green. A `scripts/` module is not
 * enumerated as a test at all.
 *
 *   ⚠️ THE DISTINCTION IS THE ENUMERATION AND NOT THE REACH, and the first cut of this note said "walk",
 *   which reads as the second. That gate's HOST SCAN does follow relative imports transitively with no root
 *   bound (`supportReachedBy`, `:239-263`), so it reaches `scripts/` and always has — the tree's own
 *   `registry.npmjs.org` entry attributes the host to `check-published-parity.mjs`'s `REGISTRY_ORIGIN`,
 *   which is a `scripts/` file, and is the proof. What moving the control changes is not what the gate can
 *   SEE: it is that no test calls the host any more, so the entry's claim — "named, not called" — is true
 *   again.
 *
 * ⚠️ THE COST, STATED: `main()` asserts the verdict and not per-skip accountability, so that rule is
 * asserted below against the gate's CODE — which is where the rule lives — rather than against a live
 * report.
 *
 * ⛔⛔ THE MOTIVATING FAILURE CANNOT BE PLANTED AGAINST THE LIVE REGISTRY, and that is a property of the
 * subject rather than a gap in the drive: a published version is immutable, so nothing can make npmjs serve
 * a stale `dist/` beside a correct `src/`. Every case needing a defective artifact injects one — which is
 * also why moving the live control out costs no injected coverage: it never carried any.
 *
 * ⛔ THE BUILD IS STUBBED IN EVERY CASE. The gate's subject is the COMPARISON, not the compiler, and a
 * drive that rebuilt 31 packages per case would measure `tsc` thirty-one times over to assert something
 * about a Map. The real build is the workflow's, once every six hours.
 *
 * ⛔⛔ THE INJECTED CONTROL KEEPS `compared === DIST_FLOOR` EXACTLY, and that is now the only place the
 * floor is asserted by equality. `faithful()` builds its fixtures FROM THE TREE — published src equals tree
 * src by construction, so nothing can legitimately be skipped and a package joining or leaving moves that
 * number the same day it happens. ⚠️ The live control could NOT assert it, and asserting it was a real
 * defect that reddened a real branch:
 *
 *   `distParityReport` SKIPS a package whose published src differs from the tree — by design, with a note,
 *   because rebuilding the wrong source gives a dist verdict that is a true red with a false diagnosis.
 *   ⇒ Every branch that changes a publishable package's `src/` legitimately skips that package, so
 *   `compared` is 30 while the gate itself exits 0 (`compared + skipped.length === floor` → `parity`).
 *   The test asserted a STRICTER rule than the gate it drives, satisfiable only on a tree byte-identical
 *   to the last release. Measured 2026-09-16 on the first branch after this file landed to touch a
 *   publishable `src/`, and reproduced on two CI runners at the same line.
 *
 * ⭐ AND EVERY SKIP IS READ RATHER THAN COUNTED. A number that admits skips is only honest if each one is
 * accounted for, so the drive asserts, over EVERY skip the report carries, that a note names that package
 * and gives one of the two reasons the gate defines — and it plants both of those paths in one report so
 * the assertion is never vacuous.
 *
 *   ⚠️ WHAT THAT IS AND IS NOT, because the first cut of this note claimed more. It holds a REPORT
 *   accountable: no skip in it goes unexplained, and a path that stopped pushing a note fails the moment a
 *   fixture reaches it. It does NOT close the SET of skip paths — a third one added later is caught only
 *   if some fixture happens to trigger it, and nobody is obliged to write that fixture. ⭐ The live control
 *   this replaced was conditional in exactly the same way, on whatever the registry offered that day, so
 *   nothing was lost in the move; the difference is that this one is stated.
 *
 * ⚠️ WHAT THIS DOES NOT CATCH, stated rather than discovered later: nothing in `verify` now opens a
 * published tarball, so a `dist/` that shipped stale is invisible to every gate in `verify` and is caught
 * only by the parity workflow's next run — within six hours, and reported as an issue that names the files.
 * That is the price of the move and it is the right way round: a release that cannot happen is worse than a
 * finding that arrives six hours after it could have.
 */
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  compare,
  DIST_FLOOR,
  distParityReport,
  hashTree,
  verdict,
  // @ts-expect-error — the gate is plain ESM JavaScript with JSDoc types, not part of a package's build
} from "../../../scripts/check-published-dist-parity.mjs";
import {
  publishableManifests,
  readManifests,
  // @ts-expect-error — as above
} from "../../../scripts/check-published-parity.mjs";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "../../..");
const manifests = () => readManifests(ROOT);
const noBuild = () => {};

/** Entries that agree with the tree, so a faithful run is parity. */
function faithful(): Record<string, Map<string, string>> {
  const out: Record<string, Map<string, string>> = {};
  for (const { path, pkg } of publishableManifests(manifests())) {
    const dir = dirname(path as string);
    const e = new Map<string, string>();
    for (const [p, h] of hashTree(join(dir, "src")) as Map<string, string>)
      e.set(`src/${p}`, h);
    for (const [p, h] of hashTree(join(dir, "dist")) as Map<string, string>)
      e.set(`dist/${p}`, h);
    out[`${pkg.name}@${pkg.version}`] = e;
  }
  return out;
}

const stubRegistry = (byPkg: Record<string, Map<string, string>>) => ({
  async metadata(name: string) {
    const versions: Record<string, unknown> = {};
    for (const key of Object.keys(byPkg))
      if (key.startsWith(`${name}@`))
        versions[key.slice(name.length + 1)] = {
          dist: { tarball: `https://example.invalid/${key}.tgz` },
        };
    return { versions };
  },
  async contents(name: string, version: string) {
    const e = byPkg[`${name}@${version}`];
    if (e === undefined) throw new Error(`no fixture for ${name}@${version}`);
    return e;
  },
});

const firstKey = (fx: Record<string, Map<string, string>>) =>
  Object.keys(fx)[0] as string;

/**
 * The two reasons `distParityReport` excuses a package from the comparison, as its own notes spell them.
 *
 * ⛔ Written here rather than imported because the gate does not export them, and matched against the NOTE
 * rather than the name: the point is that a reader learns WHY a package was not measured, and a skip whose
 * reason this pattern does not recognise is a skip nobody has accounted for.
 */
const SKIP_REASONS = /is not published|the published src differs from the tree/;

describe("published-dist-parity", () => {
  it("⭐ THE CONTROL — entries agreeing with the tree are parity, and the floor is met", async () => {
    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(faithful()),
      root: ROOT,
      build: noBuild,
    });
    expect(r.faults).toEqual([]);
    expect(r.drift).toEqual([]);
    // ⛔ EXACT EQUALITY BELONGS HERE AND NOT IN THE LIVE CONTROL — see the head note. These fixtures are
    // built from the tree, so a skip is impossible by construction and anything short of the floor is a
    // package that joined or left. Relaxing this one too would leave the floor asserted nowhere.
    expect(r.compared).toBe(DIST_FLOOR);
    expect(r.skipped).toEqual([]);
    expect(verdict(r).kind).toBe("parity");
  });

  it("⛔⛔ THE MOTIVATING FAILURE — a STALE published dist beside a CORRECT src is DRIFT", async () => {
    const fx = faithful();
    const key = firstKey(fx);
    const e = new Map(fx[key]);
    const victim = [...e.keys()].find(
      (k) => k.startsWith("dist/") && k.endsWith(".js"),
    );
    e.set(victim as string, "0".repeat(64));
    fx[key] = e;

    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(fx),
      root: ROOT,
      build: noBuild,
    });
    expect(verdict(r).kind).toBe("drift");
    expect(r.drift.some((d: string) => d.includes("DIFFER in content"))).toBe(
      true,
    );
  });

  it("⛔ DRIFT, MISSING — a file this source emits and the tarball lacks is named that way round", async () => {
    const fx = faithful();
    const key = firstKey(fx);
    const e = new Map(fx[key]);
    e.delete([...e.keys()].find((k) => k.startsWith("dist/")) as string);
    fx[key] = e;

    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(fx),
      root: ROOT,
      build: noBuild,
    });
    expect(r.drift.some((d: string) => d.includes("is MISSING"))).toBe(true);
    expect(r.drift.some((d: string) => d.includes("does not emit"))).toBe(
      false,
    );
  });

  it("⛔⛔ DRIFT, UNEXPECTED — and the OPPOSITE shape is named the OPPOSITE way, which shipped inverted once", async () => {
    const fx = faithful();
    const key = firstKey(fx);
    const e = new Map(fx[key]);
    e.set("dist/nobody-wrote-this.js", "1".repeat(64));
    fx[key] = e;

    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(fx),
      root: ROOT,
      build: noBuild,
    });
    expect(r.drift.some((d: string) => d.includes("does not emit"))).toBe(true);
    expect(r.drift.some((d: string) => d.includes("is MISSING"))).toBe(false);
  });

  it("⛔⛔ A DIFFERING src is SKIPPED and handed to the OTHER gate, never reported as dist drift", async () => {
    const fx = faithful();
    const key = firstKey(fx);
    const e = new Map(fx[key]);
    e.set(
      [...e.keys()].find((k) => k.startsWith("src/")) as string,
      "2".repeat(64),
    );
    fx[key] = e;

    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(fx),
      root: ROOT,
      build: noBuild,
    });
    expect(r.drift).toEqual([]);
    expect(
      r.notes.some((n: string) => n.includes("check:published-parity")),
    ).toBe(true);
  });

  it("⭐ EVERY SKIP IS ACCOUNTED FOR — both skip paths in one report, each named by a note that says WHY", async () => {
    // ⛔⛔ THIS RULE IS THE ONE THING THE LIVE CONTROL ASSERTED THAT THE GATE SCRIPT DOES NOT, so it is
    // asserted here rather than lost when the live control left — see the head note. It belongs here on
    // its merits anyway: the skip notes are written by `distParityReport`, so the rule is a property of
    // the gate's CODE, and fixtures drive both paths in one run where a live registry offers whichever it
    // happens to offer that day.
    const fx = faithful();
    const [gone, differing] = Object.keys(fx) as [string, string];
    // Path 1 — "is not published": no fixture at all, so `metadata()` answers with no such version. This
    // is the shape a release bump puts EVERY package into, thirty-one at a time.
    delete fx[gone];
    // Path 2 — "the published src differs from the tree".
    const e = new Map(fx[differing]);
    e.set(
      [...e.keys()].find((k) => k.startsWith("src/")) as string,
      "3".repeat(64),
    );
    fx[differing] = e;

    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(fx),
      root: ROOT,
      build: noBuild,
    });

    expect(r.skipped).toHaveLength(2);
    for (const name of r.skipped as string[]) {
      const note = (r.notes as string[]).find((n) => n.startsWith(`${name}@`));
      expect(note, `${name} was skipped and no note says why`).toBeDefined();
      expect(note).toMatch(SKIP_REASONS);
    }
    // ⛔ BOTH REASONS, not merely two notes: a run in which one path pushed both notes would satisfy the
    // loop above and would mean the gate had stopped telling the two apart.
    expect(
      (r.notes as string[]).filter((n) => /is not published/.test(n)),
    ).toHaveLength(1);
    expect(
      (r.notes as string[]).filter((n) =>
        /the published src differs from the tree/.test(n),
      ),
    ).toHaveLength(1);
    // ⭐ And a skip is never counted as a comparison, while the gate's own rule still accounts for it.
    expect(r.compared).toBe(DIST_FLOOR - 2);
    expect(r.drift).toEqual([]);
    expect(r.faults).toEqual([]);
    expect(verdict(r).kind).toBe("parity");
  });

  it("⛔⛔ ZERO COMPARED IS UNMEASURED, and never a tick", async () => {
    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry({}),
      root: ROOT,
      build: noBuild,
    });
    expect(r.compared).toBe(0);
    expect(verdict(r).kind).toBe("unmeasured");
    expect(verdict(r).code).not.toBe(0);
  });

  it("⛔ AN UNREACHABLE REGISTRY IS A FAULT — not drift, never parity, and the build never runs", async () => {
    let built = false;
    const r = await distParityReport({
      manifests: manifests(),
      registry: {
        async metadata() {
          throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
        },
        async contents() {
          throw new Error("unreachable");
        },
      },
      root: ROOT,
      build: () => {
        built = true;
      },
    });
    expect(verdict(r).kind).toBe("fault");
    expect(r.drift).toEqual([]);
    // ⭐ 31 rebuilds are not spent to report a fault that was already known.
    expect(built).toBe(false);
  });

  it("⛔ A FAILED ROOT REBUILD IS A FAULT, reported against the RUN — the cost of one root build", async () => {
    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(faithful()),
      root: ROOT,
      build: () => {
        throw new Error("tsc exploded");
      },
    });
    expect(verdict(r).kind).toBe("fault");
    expect(
      r.faults.some((f: string) => f.includes("root rebuild failed")),
    ).toBe(true);
  });

  it("⛔ A tarball with NO dist/ entries is a FAULT, not parity over nothing", async () => {
    const fx = faithful();
    const key = firstKey(fx);
    fx[key] = new Map(
      [...(fx[key] as Map<string, string>)].filter(
        ([k]) => !k.startsWith("dist/"),
      ),
    );

    const r = await distParityReport({
      manifests: manifests(),
      registry: stubRegistry(fx),
      root: ROOT,
      build: noBuild,
    });
    expect(verdict(r).kind).toBe("fault");
  });

  it("⛔ THE FLOOR is held EQUAL — a package joining refuses just as one leaving does", () => {
    const base = { drift: [], faults: [], skipped: [] };
    expect(verdict({ ...base, compared: DIST_FLOOR }).kind).toBe("parity");
    expect(verdict({ ...base, compared: DIST_FLOOR - 1 }).kind).toBe(
      "stale-floor",
    );
    expect(verdict({ ...base, compared: DIST_FLOOR + 1 }).kind).toBe(
      "stale-floor",
    );
  });

  it("⛔ compare() names each side by the side it is on", () => {
    const pub = new Map([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
    const reb = new Map([
      ["a", "1"],
      ["b", "9"],
      ["d", "4"],
    ]);
    expect(compare(pub, reb)).toEqual({
      onlyPublished: ["c"],
      onlyRebuilt: ["d"],
      different: ["b"],
    });
  });

  it("⛔⛔ A SYMLINK UNDER THE TREE IS SKIPPED, NOT FOLLOWED — the guard the sibling shipped dead", async () => {
    const { mkdtempSync, writeFileSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "proto-dist-symlink-"));
    writeFileSync(join(dir, "real.js"), "export const a = 1;\n");
    const outside = mkdtempSync(join(tmpdir(), "proto-dist-outside-"));
    writeFileSync(join(outside, "stranger.js"), "export const b = 2;\n");
    symlinkSync(join(outside, "stranger.js"), join(dir, "linked.js"));
    symlinkSync(join(dir, "real.js"), join(dir, "alias.js"));

    expect([...(hashTree(dir) as Map<string, string>).keys()].sort()).toEqual([
      "real.js",
    ]);
  });
});
