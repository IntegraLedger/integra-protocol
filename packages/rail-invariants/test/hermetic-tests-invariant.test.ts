/**
 * `check:hermetic-tests`' drive — **and the case that matters most is the one that must stay GREEN.**
 *
 * ⛔ The gate refuses a third-party host named by any non-live test, or by a module such a test imports.
 * ⭐ But this repository's live rail harnesses reach real endpoints *by design*, and they are spelled
 * `integration*.test.ts` rather than commerce's `*.live.test.ts`. A port that carried the wrong spelling
 * would have reddened all 11 of them — so the exclusion is driven here, not assumed.
 *
 * ⚠️ Every case runs the gate against a FIXTURE tree via `INTEGRA_GATE_ROOT`, plus one case over this
 * repository itself so the pass is read against real subjects rather than trusted.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM JavaScript with JSDoc types, shared with live-rails.mjs so the two cannot
// disagree about what a live rail harness is.
import { isLiveHarnessFile } from "../../../scripts/live-harness-files.mjs";

/** Every `.test.ts` under a directory, recursively — the gate's own subject set, counted independently. */
function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFilesUnder(p));
    else if (
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".test.tsx")
    )
      out.push(p);
  }
  return out;
}

const GATE = fileURLToPath(
  new URL("../../../scripts/check-hermetic-tests.mjs", import.meta.url),
);
const REPO = fileURLToPath(new URL("../../..", import.meta.url));

function run(root: string): { status: number; output: string } {
  try {
    return {
      status: 0,
      output: execFileSync("node", [GATE], {
        encoding: "utf8",
        env: { ...process.env, INTEGRA_GATE_ROOT: root },
        stdio: "pipe",
      }),
    };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

/** A tree with one package, the given test/support files, and a declarations table. */
function tree(
  files: Record<string, string>,
  declarations: Record<string, unknown> = { namedNotCalled: {}, imports: {} },
): string {
  const root = mkdtempSync(join(tmpdir(), "hermetic-fixture-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, "packages", "p", rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "hermetic-tests.declarations.json"),
    JSON.stringify(declarations, null, 2),
  );
  return root;
}

const VITEST = { vitest: { kind: "inert", why: "the runner" } };

describe("check:hermetic-tests", () => {
  it("⭐⭐ passes over THIS repository, and its count IS the exclusion", () => {
    const r = run(REPO);
    expect(r.status, r.output).toBe(0);

    // ⛔ NOT a literal. The first draft of this canary asserted `143`, and adding THIS file to the tree
    // moved it to 144 — a constant that the act of testing invalidates. What is invariant is the
    // RELATIONSHIP: the gate's non-live count is every `.test.ts` under packages/ minus every live rail
    // harness. That catches a walker that silently stops finding files AND an exclusion that widens to
    // swallow real tests, which a floor would not.
    const all = testFilesUnder(join(REPO, "packages"));
    const harnesses = all.filter((f) => isLiveHarnessFile(basename(f)));
    expect(harnesses.length).toBeGreaterThan(0); // the exclusion has real subjects
    const reported = /(\d+) non-live test file\(s\)/.exec(r.output)?.[1];
    expect(Number(reported)).toBe(all.length - harnesses.length);
  });

  it("⛔ a third-party host in a TEST file is refused, naming the file", () => {
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nconst h = "https://api.blockcypher.com/v1";\nit("x", () => h);\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("api.blockcypher.com");
    expect(r.output).toContain("p/test/a.test.ts");
  });

  it("⛔⛔ a third-party host in a HELPER a test imports is refused too — #87's widening", () => {
    // The defect the sibling gate was written about sat one `import` outside its subject set.
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nimport { H } from "./helper.js";\nit("x", () => H);\n',
        "test/helper.ts":
          'export const H = "https://api.blockcypher.com/v1";\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("p/test/helper.ts");
  });

  it("⭐⭐ a host in a LIVE RAIL HARNESS is NOT refused — integration*.test.ts, not *.live.test.ts", () => {
    // If this ever reddens, the port took commerce's spelling and all 11 harnesses are in the subject set.
    const root = tree(
      {
        "test/integration.canton.test.ts":
          'import { it } from "vitest";\nconst h = "https://api.blockcypher.com/v1";\nit("x", () => h);\n',
        "test/a.test.ts": 'import { it } from "vitest";\nit("x", () => 1);\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status, r.output).toBe(0);
  });

  it("⛔ a declared host that appears nowhere is refused — a stale exception", () => {
    const root = tree(
      { "test/a.test.ts": 'import { it } from "vitest";\nit("x", () => 1);\n' },
      {
        namedNotCalled: { "gone.invalid-host.example-not": "stale" },
        imports: VITEST,
      },
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("gone.invalid-host.example-not");
  });

  it("⛔⛔ an EMPTY subject set refuses — a gate green over nothing examined", () => {
    const root = tree({ "src/index.ts": "export const a = 1;\n" });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/NO non-live test files/);
  });

  it("⭐ a RESERVED host needs no exception, in any case — RFC 2606 and RFC 4343", () => {
    // `Seller.Example` in discovery.test.ts was reported as third-party because RESERVED carries no `i`
    // flag. Host names are case-insensitive; declaring it would have written a permanent exception for a
    // host that does not exist.
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nconst h = "https://Seller.Example/Terms/AbC.md";\nit("x", () => h);\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status, r.output).toBe(0);
  });
});
