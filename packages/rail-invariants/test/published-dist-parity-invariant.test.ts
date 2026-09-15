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
    expect(r.compared).toBe(DIST_FLOOR);
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

  it("⭐⭐ THE LIVE CONTROL — the REAL registry, 31 REAL tarballs, a REAL root build, and it is PARITY", async () => {
    const r = await distParityReport({
      manifests: manifests(),
      registry: NetworkRegistry({}),
      root: ROOT,
    });
    expect(r.faults).toEqual([]);
    expect(r.drift).toEqual([]);
    expect(r.compared).toBe(DIST_FLOOR);
    expect(verdict(r).kind).toBe("parity");
  }, 180_000);
});
