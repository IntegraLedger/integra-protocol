/**
 * THE STRYKER RUNNER'S JOIN SPELLING MATCHES THE CATALOG'S VITEST MAJOR — AND THE GATE THAT SAYS SO HAS
 * BEEN DRIVEN.
 *
 * ★ WHY IT EXISTS. `@stryker-mutator/vitest-runner` builds its per-mutant test filter by joining a test's
 * suite names and its own name with a SINGLE SPACE; vitest 5 matches that pattern against a name composed
 * with `" > "`. The two spellings are not the same string, and ⛔ vitest does not error on a pattern that
 * matches nothing — it SKIPS every test and exits 0, so Stryker records every filtered mutant as SURVIVED.
 * `5420510` is where this tree met that: `placements` scored 35.19 against a ratchet of 100, and the only
 * mutants it killed were its 19 static ones.
 *
 * ★ AND THE RED WAS THE LUCKY HALF. A package whose ratchet sits below the score its static mutants alone
 * produce would have stayed GREEN over a suite that executed nothing. `mutation` here is
 * `disabled_manually`, so there is no automated reading that would notice.
 *
 * ★ WHAT THE GATE ASSERTS, and why all three facts are needed. The catalog's vitest major, the INSTALLED
 * vitest major, and the installed runner's spelling must agree. Comparing only the last two passes the
 * failure that was live in this repository's own shared clone on 2026-09-13 — a declared `vitest: "5.0.0"`
 * and `patchedDependencies` over a `node_modules` holding 4.1.11 and an unpatched runner, which is
 * self-consistent and wrong. It is the CATALOG that makes it a finding.
 *
 * ★ WHAT THIS FILE IS FOR. `scripts/check-runner-patch.mjs` is the gate; this is its DRIVE. A gate is not
 * finished when it is green — it is finished when the defect it names has been re-planted and it went red.
 * The three plants below are the three ways the pairing breaks, and two more assert that it fails CLOSED,
 * which is the half that reads as success when it stops working.
 *
 * ★ It lives here rather than beside the script because `pnpm test` runs the workspace, and a drive
 * nothing executes is a drive that rots — which is the class `check:gate-parity` exists to name in the
 * sibling repository.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  assess,
  canaryRefusals,
  catalogVitest,
  // @ts-expect-error — the gate is plain ESM JavaScript with JSDoc types, not part of a package's build
} from "../../../scripts/check-runner-patch.mjs";

const GATE = fileURLToPath(
  new URL("../../../scripts/check-runner-patch.mjs", import.meta.url),
);
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const PATCHED = "return nameParts.join(' > ').trim();";
const UNPATCHED = "return nameParts.join(' ').trim();";
const both = (src: string) => ({
  "stryker-setup.js": src,
  "test-helpers.js": src,
});

describe("the pairings that are correct, in both directions", () => {
  it("vitest 5 beside a patched runner passes, and names the spelling it saw", () => {
    const { refusals, want, seen } = assess({
      catalogVersion: "5.0.0",
      installedVitest: "5.0.0",
      sites: both(PATCHED),
    });
    expect(refusals).toStrictEqual([]);
    expect(want).toBe("join(' > ')");
    expect(seen).toHaveLength(2);
  });

  it("★ vitest 4 beside an UNPATCHED runner ALSO passes — it demands consistency, not the patch", () => {
    // This is what makes it the mechanical form of the atomicity rule rather than a preference: a tree
    // that has not bumped yet is correct, and stays correct, until the bump and the patch move together.
    const { refusals, want } = assess({
      catalogVersion: "4.1.11",
      installedVitest: "4.1.11",
      sites: both(UNPATCHED),
    });
    expect(refusals).toStrictEqual([]);
    expect(want).toBe("join(' ')");
  });
});

describe("⛔ the three plants — every way the pairing can break", () => {
  it("the patch DROPPED while the catalog still says 5", () => {
    const { refusals } = assess({
      catalogVersion: "5.0.0",
      installedVitest: "5.0.0",
      sites: both(UNPATCHED),
    });
    expect(refusals).toHaveLength(2);
    for (const r of refusals)
      expect(r).toMatch(
        /does not spell `join\(' > '\)` — it spells `join\(' '\)`/,
      );
  });

  it("vitest DOWNGRADED to 4 under a patch that stayed — the mirror image", () => {
    const { refusals } = assess({
      catalogVersion: "4.1.11",
      installedVitest: "4.1.11",
      sites: both(PATCHED),
    });
    expect(refusals).toHaveLength(2);
    for (const r of refusals)
      expect(r).toMatch(
        /does not spell `join\(' '\)` — it spells `join\(' > '\)`/,
      );
  });

  it("⛔⛔ the STALE INSTALL — catalog 5, node_modules 4 — which a runner/vitest check alone PASSES", () => {
    // ★ The runner and vitest agree with each other here, so a gate reading only those two reports this
    // tree clean. That shape was live in this repository's shared clone on 2026-09-13.
    const { refusals } = assess({
      catalogVersion: "5.0.0",
      installedVitest: "4.1.11",
      sites: both(UNPATCHED),
    });
    expect(
      refusals.some((r: string) =>
        /asks for vitest 5\.0\.0 but 4\.1\.11 is INSTALLED/.test(r),
      ),
    ).toBe(true);
  });
});

describe("⛔ failing closed, which is the half that reads as success when it breaks", () => {
  it("a runner whose dist layout moved is REFUSED, never passed over as nothing to check", () => {
    const { refusals } = assess({
      catalogVersion: "5.0.0",
      installedVitest: "5.0.0",
      sites: { "stryker-setup.js": PATCHED },
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(
      /test-helpers\.js is not in the installed runner/,
    );
  });

  it("a site spelling NEITHER form is said differently from one spelling the wrong form", () => {
    const { refusals, seen } = assess({
      catalogVersion: "5.0.0",
      installedVitest: "5.0.0",
      sites: both("return nameParts.join(SEPARATOR).trim();"),
    });
    expect(refusals).toHaveLength(2);
    for (const r of refusals) expect(r).toMatch(/and spells neither form/);
    for (const s of seen) expect(s).toMatch(/NEITHER/);
  });

  it("the canaries discriminate — a predicate that stopped matching would pass everything", () => {
    expect(canaryRefusals()).toStrictEqual([]);
  });

  it("a catalog with no `vitest:` line REFUSES rather than reading an empty subject set", () => {
    const { error } = catalogVitest(
      fileURLToPath(new URL(".", import.meta.url)),
    );
    expect(error).toMatch(/pnpm-workspace\.yaml is not there|found 0/);
  });

  it("★ and over THIS workspace it finds exactly one — the positive control on that shape", () => {
    const { version, error } = catalogVitest(ROOT);
    expect(error).toBeUndefined();
    expect(version).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+/);
  });
});

it("★ spawned over this tree as `pnpm verify` spawns it, the gate exits 0 and names both sites", () => {
  // ⚠️ The plants drive the DECISION; this drives the WIRING — that the script reads a real install and
  // resolves the runner the tree actually links. Neither stands in for the other.
  const out = execFileSync(process.execPath, [GATE], { encoding: "utf8" });
  expect(out).toMatch(/check:runner-patch — catalog vitest/);
  expect(out).toMatch(/stryker-setup\.js=/);
  expect(out).toMatch(/test-helpers\.js=/);
});
