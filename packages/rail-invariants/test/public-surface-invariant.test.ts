/**
 * THE PUBLISHED-SURFACE INVARIANT: ONE NAME MEANS ONE THING ACROSS THE WHOLE SCOPE.
 *
 * Every publishable package resolves under `@integraledger/lcp-*`, so a consumer meets them as one
 * vocabulary rather than thirty-one unrelated libraries. That makes a name exported by two packages a
 * claim: *these are the same thing*. When they are not, the failure is silent and lands on the consumer,
 * never on us — a scoped import compiles, a barrel re-export compiles, and the wrong value is used.
 *
 * ★ WHY THIS FILE EXISTS. `USDC_DECIMALS` was exported by four bindings. Three meant 6; `binding-stellar`
 * meant 7, because Stellar assets carry seven decimals. Every value was correct for its own chain, so no
 * package contained a defect and every package's own `constants.test.ts` passed — the clash existed only
 * BETWEEN them, and the realisation was a ten-fold error in a settlement amount. It shipped on the day the
 * Stellar binding landed and was found by hand months later. Nothing in this repository looked at the
 * published surface; five cross-rail invariants sat beside it and none of them was the `.d.ts`.
 *
 * The sweep renamed the four. This keeps the CLASS fixed, which is the same division of labour
 * `success-gate-invariant` draws: a sweep fixes instances, a gate fixes the class.
 *
 * ★ WHY IT READS `dist/`, NOT `src/`. `dist/index.d.ts` is the artifact a consumer's compiler actually
 * resolves. `isolatedDeclarations` means it is emitted rather than inferred, so it is exact — and reading
 * the real published surface rather than a re-derivation of it is the whole point of the gate. `verify`
 * builds before it tests, so the files are there; the canary below fails loudly if they are not.
 *
 * ★ HOW A COLLISION IS ALLOWED. Add it to {@link ALLOWED} with a reason. A deliberate re-export is a real
 * pattern — one definition, two import paths — and so is a rail-generic verb whose input type differs per
 * chain. What the allowlist forbids is the SILENT case: two independent definitions under one name that a
 * reader would take for one thing. Writing the reason down is the gate; the entry is just where it lives.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = new URL("../../", import.meta.url).pathname;

/**
 * Collisions that are correct, each with the reason it is correct.
 *
 * `reExport` — one definition, re-exported for the consumer who holds only the downstream package.
 * `railGeneric` — one verb, one job, a rail-specific input type; the import path IS the disambiguation and
 * there is no value a reader could carry from one rail to another and misuse.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // Defined once in `kernel`; `binding-cardano` re-exports it because the value is written on-chain as the
  // metadatum `v`, and a consumer holding only the cardano package must be able to read what it stamped.
  LCP_SPEC_VERSION: "reExport",
  // Defined once in `binding-core/src/mpp-attribution.ts` after the Hedera collision guard was centralised;
  // `binding-tempo-mpp` re-exports because it is where the tag was first measured and consumers look there.
  MPP_ATTRIBUTION_TAG: "reExport",
  MPP_ATTRIBUTION_VERSION: "reExport",
  // One verb over a rail-specific transaction view. There is no cross-rail value to carry: each takes that
  // chain's own view type, so calling the wrong one does not typecheck.
  recoverAtrHashFromTxView: "railGeneric",
  readTxView: "railGeneric",
  parseTxView: "railGeneric",
};

/** Every publishable package directory — `private` is the rule, never a name pattern. */
function publishableDirs(): string[] {
  return readdirSync(PACKAGES).filter((dir) => {
    const manifest = join(PACKAGES, dir, "package.json");
    if (!existsSync(manifest)) return false;
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      private?: boolean;
    };
    return pkg.private !== true;
  });
}

/**
 * The names one package's published `.d.ts` exports.
 *
 * Both spellings the emitter produces are read: a `declare`d entity on its own line, and the trailing
 * `export { … }` list. An `as` rename is recorded under the name a consumer imports, which is the only one
 * that can collide.
 */
function exportedNames(dts: string): Set<string> {
  const out = new Set<string>();
  for (const m of dts.matchAll(
    /^(?:export )?declare (?:const|function|class) ([A-Za-z_$][\w$]*)/gm,
  ))
    out.add(m[1] as string);
  for (const m of dts.matchAll(
    /^(?:export )?(?:type|interface) ([A-Za-z_$][\w$]*)/gm,
  ))
    out.add(m[1] as string);
  for (const m of dts.matchAll(/export \{([^}]*)\}/g))
    for (const clause of (m[1] as string).split(",")) {
      const name = clause
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
    }
  return out;
}

describe("the published surface carries one meaning per name", () => {
  const dirs = publishableDirs();
  const surfaces = new Map<string, Set<string>>();
  for (const dir of dirs) {
    const dts = join(PACKAGES, dir, "dist", "index.d.ts");
    if (existsSync(dts))
      surfaces.set(dir, exportedNames(readFileSync(dts, "utf8")));
  }

  it("reads a plausible published surface", () => {
    // The blind-gate canary, twice over. A walker that stops finding packages reports clean forever, and so
    // does one that finds packages whose `.d.ts` it cannot parse. `verify` builds first, so a miss here is
    // a broken walker rather than a missing build.
    expect(dirs.length).toBeGreaterThan(25);
    expect(surfaces.size).toBe(dirs.length);
    const total = [...surfaces.values()].reduce((n, s) => n + s.size, 0);
    expect(total).toBeGreaterThan(300);
  });

  it("exports no name from two packages without a recorded reason", () => {
    const byName = new Map<string, string[]>();
    for (const [dir, names] of surfaces)
      for (const name of names) {
        const seen = byName.get(name);
        if (seen) seen.push(dir);
        else byName.set(name, [dir]);
      }
    const offenders = [...byName]
      .filter(
        ([name, where]) => where.length > 1 && ALLOWED[name] === undefined,
      )
      .map(
        ([name, where]) => `${name} — exported by ${where.sort().join(", ")}`,
      )
      .sort();
    // If this fails: the two are probably NOT the same thing, and the consumer is the one who finds out.
    // Rail-qualify the name (`STELLAR_USDC_DECIMALS`), or add it to ALLOWED with the reason it is safe.
    expect(offenders).toEqual([]);
  });

  it("the allowlist has no stale entry — every exemption still describes a real collision", () => {
    // An allowlist that outlives its collisions stops being a record and becomes noise, and the next real
    // collision hides inside it. Same both-directions discipline the success-gate invariant uses.
    const collided = new Set<string>();
    const counts = new Map<string, number>();
    for (const names of surfaces.values())
      for (const name of names) {
        const n = (counts.get(name) ?? 0) + 1;
        counts.set(name, n);
        if (n > 1) collided.add(name);
      }
    expect(
      Object.keys(ALLOWED)
        .filter((n) => !collided.has(n))
        .sort(),
    ).toEqual([]);
  });
});
