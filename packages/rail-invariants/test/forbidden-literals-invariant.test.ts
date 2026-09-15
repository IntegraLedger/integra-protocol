/**
 * THE DRIVE FOR `check:forbidden-literals`.
 *
 * ⛔⛔ **A GATE IS NOT FINISHED WHEN IT IS GREEN. It is finished when the defect it names has been
 * re-planted and it went red.** The gate landed with a plant-and-restore run by hand once; a plant nobody
 * can re-run is a claim about the past. Every case below runs the real gate against a FIXTURE tree via
 * `INTEGRA_GATE_ROOT`, plus one case over this repository.
 *
 * ⭐ **WHY THE FIXTURE IS A REAL GIT REPOSITORY.** The gate's subject set is `git ls-files` — TRACKED files,
 * not every file on disk, because an ignored build artifact is not something a reader meets on github.com.
 * A fixture that was a bare directory would exercise semantics this gate does not have, and would pass while
 * proving nothing about the one it does. So each fixture is `git init`-ed and its files added.
 *
 * ⚠️ **This file may not spell the markers it drives.** It is not in the gate's `SELF_NAMING` set, and it is
 * tracked, so a literal here would be reported by the very gate it tests — correctly. The planted strings
 * are assembled from fragments at runtime, which is why they look the way they do.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GATE = fileURLToPath(
  new URL("../../../scripts/check-forbidden-literals.mjs", import.meta.url),
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

/** A real repository holding exactly these files, tracked. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forbidden-fixture-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  if (Object.keys(files).length > 0) git("add", "-A");
  return root;
}

/** Assembled so this file does not itself carry a marker the gate would report. */
const PRIVATE_SELLER_REPO = ["integra", "agentic", "commerce"].join("-");
const PRIVATE_PLAN_REPO = ["agent", "commerce", "plan"].join("-");
const AGENT_TRAILER = `Co-Authored-${"By"}: Claude <x@example.invalid>`;

describe("check:forbidden-literals refuses a private referent anywhere a stranger can read", () => {
  it("⛔ a private repository name in an ordinary tracked file is REFUSED", () => {
    const { status, output } = run(
      tree({ "src/index.ts": `// ported from ${PRIVATE_SELLER_REPO}\n` }),
    );
    expect(status).toBe(1);
    expect(output).toMatch(/private seller-side repository by name/);
    expect(output).toMatch(/src\/index\.ts:1/);
  });

  it("⛔ the other private repository is refused too — one live pattern must not vouch for the rest", () => {
    const { status, output } = run(
      tree({ "docs/note.md": `see ${PRIVATE_PLAN_REPO}#42\n` }),
    );
    expect(status).toBe(1);
    expect(output).toMatch(/private planning register by name/);
  });

  it("⛔ an agent-authorship trailer is refused — a different marker CLASS, not a second spelling", () => {
    const { status, output } = run(tree({ "NOTES.md": `${AGENT_TRAILER}\n` }));
    expect(status).toBe(1);
    expect(output).toMatch(/agent-authorship trailer/);
  });

  it("⭐ CONTROL — a tree with none of them passes, so the gate can return the other answer", () => {
    const { status, output } = run(
      tree({
        "src/index.ts": "export const ok = 1;\n",
        "README.md":
          "Reviewed-By: a colleague; see https://example.invalid/docs\n",
      }),
    );
    expect(status).toBe(0);
    expect(output).toMatch(/2 tracked file\(s\) scanned/);
  });

  it("⛔⛔ AN EMPTY SUBJECT SET REFUSES — a gate that examined nothing must not report clean", () => {
    const { status, output } = run(tree({}));
    expect(status).toBe(1);
    expect(output).toMatch(/examined nothing|no files/i);
  });

  it("⭐ an UNTRACKED file is outside the subject set, and the gate says how many it read", () => {
    const root = tree({ "src/index.ts": "export const ok = 1;\n" });
    writeFileSync(join(root, "untracked.md"), `${PRIVATE_SELLER_REPO}\n`);
    const { status, output } = run(root);
    expect(status).toBe(0);
    expect(output).toMatch(/1 tracked file\(s\) scanned/);
  });

  it("⭐ THIS REPOSITORY is clean, and the gate reports the set size it actually read", () => {
    const { status, output } = run(REPO);
    expect(status).toBe(0);
    expect(output).toMatch(/[0-9]{3,} tracked file\(s\) scanned/);
  });
});
