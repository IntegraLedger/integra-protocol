/**
 * The drive for `check:published-dist-parity`.
 *
 * ⛔⛔ THE MOTIVATING FAILURE CANNOT BE PLANTED AGAINST THE LIVE REGISTRY, and that is a property of the
 * subject rather than a gap in the drive: a published version is immutable, so nothing can make npmjs serve
 * a stale `dist/` beside a correct `src/`. Every case needing a defective artifact injects one.
 *
 * ⭐ The live registry is driven once, as a control, because a suite of injected fixtures proves only that
 * the gate agrees with fixtures. ⚠️ That case rebuilds all 31 packages and is therefore the slow one.
 *
 * ⛔ THE BUILD IS STUBBED IN EVERY INJECTED CASE. The gate's subject is the COMPARISON, not the compiler,
 * and a drive that rebuilds 31 packages per case would measure `tsc` thirty-one times over to assert
 * something about a Map.
 *
 * ⛔⛔ THE TWO CONTROLS ASSERT DIFFERENT THINGS ABOUT THE FLOOR, AND THAT IS THE FIX RATHER THAN A
 * WEAKENING. The injected control keeps `compared === DIST_FLOOR` exactly, because `faithful()` builds its
 * fixtures FROM THE TREE — published src equals tree src by construction, so nothing can legitimately be
 * skipped and a package joining or leaving moves that number the same day it happens. ⚠️ The LIVE control
 * cannot assert it, and asserting it was a real defect that reddened a real branch:
 *
 *   `distParityReport` SKIPS a package whose published src differs from the tree — by design, with a note,
 *   because rebuilding the wrong source gives a dist verdict that is a true red with a false diagnosis.
 *   ⇒ Every branch that changes a publishable package's `src/` legitimately skips that package, so
 *   `compared` is 30 while the gate itself exits 0 (`compared + skipped.length === floor` → `parity`).
 *   The test asserted a STRICTER rule than the gate it drives, satisfiable only on a tree byte-identical
 *   to the last release. Measured 2026-09-16 on the first branch after this file landed to touch a
 *   publishable `src/`, and reproduced on two CI runners at the same line.
 *
 * ⛔⛔ A VERSION BUMP DOES NOT HELP EITHER, AND WHAT IT DOES INSTEAD IS WORSE THAN THIS — it is a release
 * deadlock, it is PRE-EXISTING, and it is NOT fixed here. `.changeset/config.json` declares one fixed
 * group, `@integraledger/lcp-*`, and all 31 publishable packages match it at a single version (0.18.3,
 * measured). So `changeset version` moves ALL THIRTY-ONE at once; every one is then unpublished, every one
 * is skipped as "is not published", and `compared` is **0** — driven against the live registry with the
 * manifests bumped in memory: `compared = 0, skipped = 31`, `verdict() -> unmeasured`
 * (check-published-dist-parity.mjs:257). ⇒ The live control fails at the `compared > 0` guard and at the
 * parity assertion, and the `compared + skipped === floor` line PASSES — the empty-subject guard is
 * working exactly as intended, because a bump commit genuinely measures nothing.
 *
 *   ⚠️ The deadlock is the WORKFLOW ORDER, not this assertion. `release.yml` fires only off a green `ci`
 *   (`workflow_run`), and its manual entry point checks the API for a green `ci` on the same commit
 *   rather than trusting the trigger — so both paths are gated. `ci` runs `pnpm verify`, whose last stage
 *   is this suite. The bump commit is therefore red until the packages are published, and they cannot be
 *   published until the release runs. ⭐ The old `compared === DIST_FLOOR` fails identically at 0, so this
 *   is not something the fix above introduced; it was simply never reached, because the last releases
 *   predate this file. Filed as register row 281 (protocol, release path) and answered there, not here.
 *
 * ⇒ The live control asserts THE GATE'S OWN RULE — `compared + skipped.length === DIST_FLOOR`, which a
 * package joining or leaving still moves — plus `compared > 0` SEPARATELY, so the empty-subject-set guard
 * survives the relaxation and a run that skipped everything can never read as a tick.
 *
 * ⭐ AND EVERY SKIP IS READ RATHER THAN COUNTED. A number that admits skips is only honest if each one is
 * accounted for, so the control requires a note NAMING each skipped package and giving one of the two
 * reasons the gate defines, and logs it. ⛔ Closed in both directions on purpose: a third skip path
 * added later, or one that pushes no note, fails here until somebody states what it is — a new way to be
 * excused from a measurement is a decision, never a default.
 *
 * ⚠️ WHAT THIS DOES NOT CATCH, stated rather than discovered later: a run in which 30 of the 31 packages
 * are legitimately skipped passes on ONE comparison. There is no honest numeric bound above zero — the
 * skip set is "packages whose src has moved since their last release", which is unbounded by nothing but
 * release cadence — so the guarantee here is per-skip accountability, not a quorum.
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
  NetworkRegistry,
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

  it("⭐⭐ THE LIVE CONTROL — the REAL registry, REAL tarballs, a REAL root build, and it is PARITY", async () => {
    const r = await distParityReport({
      manifests: manifests(),
      registry: NetworkRegistry({}),
      root: ROOT,
    });
    expect(r.faults).toEqual([]);
    expect(r.drift).toEqual([]);
    // THE GATE'S OWN RULE, which a package joining or leaving still moves — and which a legitimate skip
    // does not. `compared` alone is not the subject set; `compared + skipped` is.
    expect(r.compared + r.skipped.length).toBe(DIST_FLOOR);
    // ⛔ SEPARATELY, and never folded into the line above: a run that opened no published dist has no
    // opinion to give, and the sum would be satisfied by skipping all 31.
    expect(r.compared).toBeGreaterThan(0);
    // ⭐ EVERY SKIP READ RATHER THAN COUNTED. Each one must be named by a note giving one of the two
    // reasons the gate defines; a third path, or one that pushes no note, fails here.
    for (const name of r.skipped as string[]) {
      const note = (r.notes as string[]).find((n) => n.startsWith(`${name}@`));
      expect(note, `${name} was skipped and no note says why`).toBeDefined();
      expect(note).toMatch(SKIP_REASONS);
      // ⛔⛔ THE ASSERTIONS ABOVE ARE THE GUARD; THIS LINE IS ONLY LEGIBILITY, and where it is legible was
      // measured rather than assumed — the first version of this comment got it backwards.
      //
      // A probe test that logs and annotates from a PASSING case, run three ways:
      //   vitest's own default pick under an agent shell (`minimal`) — neither the log nor the annotation
      //   `--reporter=default`, what a human and CI's log get — the LOG prints, the annotation does not
      //   `--reporter=verbose`                                      — both print
      // ⇒ `console.log` is at least as visible as an annotation under every reporter and strictly more
      // visible under the one that matters, which is the opposite of what this comment used to claim.
      //
      // ⚠️ AND THE ANNOTATION ROUTE IS DEFEATED HERE ANYWAY. Vitest emits `::notice …` in CI, but `pnpm -r`
      // prefixes every line with `packages/rail-invariants test: ` and the runner's command parser only
      // takes a line that BEGINS with `::`. Measured on this file's own green run: both `verify` matrix
      // check-runs report `annotations_count=0` while the `::notice` sits, prefixed, in the raw log.
      // ⇒ What a reader actually sees on a pass: nothing under an agent shell, this line under the
      // default reporter and in CI's raw log, and nothing in GitHub's annotations panel.
      console.log(`  dist-parity — skipped: ${note}`);
    }
    console.log(
      `  dist-parity — ${r.compared} compared, ${r.skipped.length} skipped, floor ${DIST_FLOOR}`,
    );
    expect(verdict(r).kind).toBe("parity");
  }, 180_000);
});
