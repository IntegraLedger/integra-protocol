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

/**
 * Does the refusal list this host as a FINDING, on its own line?
 *
 * ⭐ Line EQUALITY rather than `output.includes(host)`: `includes` also passes on the host appearing
 * inside a `named by:` path, inside the remedy sentence, or as a SUFFIX of a longer host — and a bare
 * `.includes()` over a hostname-shaped constant is the `url.includes("example.com")` antipattern CodeQL
 * flags. The gate prints a finding's host alone on its line.
 */
const namesHost = (output: string, host: string): boolean =>
  output.split("\n").some((line) => line.trim() === host);

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
  // ⛔⛔ THE HOST-EXTRACTION CASES. Each was driven against this gate at `a59607a` before being fixed;
  // the comments on `hostOf` carry what each one reported then. They are grouped because they are one
  // change to one function, and because two of them fail OPEN rather than merely noisily.

  it("⛔⛔ a host behind USERINFO is named as the HOST, never as the username", () => {
    // At a59607a this reported `user`. It still went red — what was poisoned is the DECLARATION path.
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nconst h = "https://user@api.blockcypher.com/v1";\nit("x", () => h);\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.output).toContain("api.blockcypher.com");
    // The refusal lists a finding's host alone on its line; `user` must not be that line.
    expect(
      r.output.split("\n").some((line) => line.trim() === "user"),
      r.output,
    ).toBe(false);
  });

  it("⛔⛔ declaring the USERINFO does not exempt the host behind it", () => {
    // This is the whole consequence: one plausible entry, and every credentialed URL to every third
    // party is exempt. Driven at a59607a, this exact fixture exited 0.
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nconst a = "https://user@api.blockcypher.com/v1";\nconst b = "https://user@cardanoscan.io/x";\nit("x", () => [a, b]);\n',
      },
      {
        namedNotCalled: { user: "a placeholder in a credential fixture" },
        imports: VITEST,
      },
    );
    const r = run(root);
    expect(r.status, r.output).toBe(1);

    // ⭐⭐ THREE PROPERTIES, AND THE THIRD IS WHAT MAKES THE FIX DURABLE RATHER THAN MERELY CORRECT. A
    // peer session ran this fixture against the merged half and named their COMPOSITION; they were
    // asserted here only in pieces.
    //
    // 1 · the scan reads PAST the `@`, so the real host is named;
    expect(namesHost(r.output, "api.blockcypher.com"), r.output).toBe(true);
    // 2 · and does not stop at the FIRST — which is what says the old behaviour collapsed an unbounded
    //     set of destinations onto a single entry;
    expect(namesHost(r.output, "cardanoscan.io"), r.output).toBe(true);
    // 3 · ⛔ and because the table is closed in BOTH directions, the `user` entry — the declaration that
    //     WAS the exploit — is itself reported as excluding nothing. The artifact of the hole cannot
    //     quietly survive its repair: whoever cleans up cannot leave the door propped.
    expect(r.output, r.output).toMatch(
      /\buser\n\s+is listed in NAMED_NOT_CALLED and appears in no non-live test/,
    );
  });

  it("⛔⛔ an IPv6 LITERAL is seen — the same destination by name and by address", () => {
    // ⭐ This one failed OPEN with no declaration needed: `[` was outside the old character class, so the
    // pattern matched nothing at all. At a59607a the literal exited 0 while the NAME was refused.
    const byName = run(
      tree(
        {
          "test/a.test.ts":
            'import { it } from "vitest";\nconst h = "https://one.one.one.one/dns-query";\nit("x", () => h);\n',
        },
        { namedNotCalled: {}, imports: VITEST },
      ),
    );
    const byAddress = run(
      tree(
        {
          "test/a.test.ts":
            'import { it } from "vitest";\nconst h = "https://[2606:4700:4700::1111]/dns-query";\nit("x", () => h);\n',
        },
        { namedNotCalled: {}, imports: VITEST },
      ),
    );
    expect(byName.status, byName.output).toBe(1);
    expect(byAddress.status, byAddress.output).toBe(1);
    expect(byAddress.output).toContain("[2606:4700:4700::1111]");
  });

  it("⭐ …and LOOPBACK as an IPv6 literal stays hermetic", () => {
    // A test that binds its own socket and talks to it is hermetic — RESERVED already covers `[::1]`.
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nconst h = "https://[::1]/x";\nit("x", () => h);\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    expect(run(root).status).toBe(0);
  });

  it("⛔ an INTERPOLATED authority names no host — and reports no fragment of one", () => {
    // At a59607a this reported `u`, the userinfo, because the trailing-`$` check cannot see a `$` that
    // is not at the end of the match.
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nconst H = process.env["H"] ?? "";\nconst h = `https://u:p@${H}/x`;\nit("x", () => h);\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status, r.output).toBe(0);
  });

  it("⛔⛔ an interpolation INSIDE the host names nothing — the shape that disproved truncating", () => {
    // ⭐ From the private seller-side tree, where this was driven: `https://seam${i}.example` has the
    // interpolation inside the HOST, and the real host is reserved. A draft of this fix truncated at the
    // `${` and reported `seam` — and declaring that would exempt `https://seam${anything}` to any host,
    // which is the poisoned-declaration shape this change removes, one line over.
    const dollar = "$";
    const root = tree(
      {
        "test/a.test.ts": `import { it } from "vitest";\nconst h = "https://seam${dollar}{i}.example";\nconst g = "https://u:p@${dollar}{h}/x";\nit("x", () => [h, g]);\n`,
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status, r.output).toBe(0);
    expect(r.output).not.toContain("seam");
  });

  // ⚠️⚠️ THE BOUNDARY, ASSERTED SO IT CANNOT BE "FIXED" BACK INTO THE DEFECT IT REPLACED. An interpolated
  // authority is unjudgeable and therefore EVADABLE. This states that as INTENDED, with the reason:
  // truncating to the literal prefix instead fails accidentally — a good-faith declaration of a reported
  // `seam` silently exempts `https://seam${anything}` — while this fails only deliberately, and a `${""}`
  // between scheme and host is visible in review in a way a declarations entry is not.
  // ⛔ If you are here because you found the evasion: closing it by truncating reintroduces the defect this
  // replaced. The claim a green supports is "no test NAMES a literal third-party host".
  it("⚠️ KNOWN AND INTENDED: a no-op interpolation evades the scan, while the literal URL does not", () => {
    const dollar = "$";
    const root = tree(
      {
        "test/a.test.ts": `import { it } from "vitest";\nit("x", async () => { await fetch(\`https://api.blockcypher.com${dollar}{""}/x\`); });\n`,
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status, r.output).toBe(0);
  });

  // ⭐⭐ THE CONTROL THAT MAKES THE CASE ABOVE A BOUNDARY RATHER THAN BLINDNESS — and note what it does
  // NOT do: it passes under BOTH implementations. It is not sensitive to the skip, it is sensitive to the
  // gate being blind. A control that went red alongside its subject would be a second assertion of the
  // same thing and could not tell you the subject was there at all.
  it("⭐ CONTROL: the same host written literally IS refused — so the case above is a boundary", () => {
    const root = tree(
      {
        "test/a.test.ts":
          'import { it } from "vitest";\nit("x", async () => { await fetch("https://api.blockcypher.com/x"); });\n',
      },
      { namedNotCalled: {}, imports: VITEST },
    );
    const r = run(root);
    expect(r.status, r.output).toBe(1);
    expect(namesHost(r.output, "api.blockcypher.com"), r.output).toBe(true);
  });
});
