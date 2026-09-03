#!/usr/bin/env node
/**
 * Refuse a live-rail harness that can report PASS without doing its work.
 *
 * `scripts/live-proof-gate.mjs` adjudicates a live run on the JSON reporter's counts — `failed === 0`,
 * `pending === 0`, `passed > 0` — because Vitest exits 0 over an all-skipped run and the exit code
 * therefore certifies nothing. That closes the EMPTY run. It cannot close the HOLLOW one: a test whose
 * body returns early is recorded as **passed**, not pending, so a suite that signed, submitted and read
 * nothing satisfies all three counts and the gate prints "Rail proven live" over it.
 *
 * Measured 2026-09-03 on `binding-xrpl`: `test/integration.onchain.test.ts` probed for its optional
 * signing SDK, `console.warn`ed and `return`ed when the import failed. The comment above it called that a
 * "skip LOUD". Vitest has no such outcome for a returning body — the run was a PASS, and the only reason
 * it never happened in CI is that `--frozen-lockfile` happens to install both dev dependencies. One of
 * eleven harnesses could pass, credentialed, without touching a chain.
 *
 * Counts cannot express this, so the property is checked where it is decidable: in the source. Two
 * refusals, both over the same derived subject set:
 *
 *   1. **No `return` in a live-rail test body.** A live harness ends by falling off the end or by
 *      throwing. A missing dependency, an unusable credential, an unreachable node — each is a REFUSAL,
 *      and a refusal is a throw. Returns inside functions declared *within* the body (a local JSON-RPC
 *      helper, a poll loop) are ordinary control flow and are not counted; only a return that ends the
 *      TEST is.
 *   2. **At least one `expect` per live-rail test body.** A body that asserts nothing has nothing to
 *      fail, which is the hollow pass by another route. Counted at any depth, including local helpers,
 *      because an assertion made inside one still runs.
 *
 * ⛔ The subject set is not a glob and not a list kept here. It is `scripts/live-rails.mjs --matrix` —
 * the same inventory `check:live-rails` refuses a short version of — so a rail added, renamed or moved is
 * covered by this gate on the day the inventory sees it, and a disagreement between the two is
 * impossible. Empty is refused three ways: no harnesses, no parsed test bodies, and an inventory that
 * itself refuses (its non-zero exit propagates).
 *
 * Usage: node scripts/check-harness-proof.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "@swc/core";

const ROOT = process.cwd();

/** The live-rail harnesses, from the one inventory that already refuses a short set. */
function harnesses() {
  const out = execFileSync(
    process.execPath,
    [join(ROOT, "scripts", "live-rails.mjs"), "--matrix"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return JSON.parse(out).include;
}

/** Node kinds that open a new function scope — a `return` inside one ends IT, not the test. */
const FUNCTION_LIKE = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ClassMethod",
  "PrivateMethod",
  "MethodProperty",
  "GetterProperty",
  "SetterProperty",
]);

/** Walk every child node, applying `visit`; `visit` returns false to stop descending. */
function walk(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === "string" && visit(node) === false) return;
  for (const key of Object.keys(node)) {
    if (key === "span") continue;
    walk(node[key], visit);
  }
}

/** `it` / `test`, bare or with any modifier (`it.each`, `test.concurrent`). */
function isTestCallee(callee) {
  if (callee?.type === "Identifier")
    return callee.value === "it" || callee.value === "test";
  if (callee?.type === "MemberExpression") return isTestCallee(callee.object);
  return false;
}

/** `expect(...)` at any depth, bare or chained off a modifier. */
function isExpectCallee(callee) {
  if (callee?.type === "Identifier") return callee.value === "expect";
  if (callee?.type === "MemberExpression") return isExpectCallee(callee.object);
  return false;
}

const rails = harnesses();
const failures = [];

if (rails.length === 0)
  failures.push(
    "the live-rail inventory returned no harnesses. A gate with no subject asserts nothing, which is " +
      "the failure this file exists to refuse — fix the inventory rather than this floor.",
  );

let bodiesSeen = 0;

for (const rail of rails) {
  const file = join(ROOT, rail.file.replace(/^\//, ""));
  const src = readFileSync(file, "utf8");
  const ast = parseSync(src, {
    syntax: "typescript",
    target: "es2022",
    comments: false,
  });
  // swc spans are BYTE offsets into a per-process source map that accumulates across parses, not into
  // this file — and the module's own `start` is its first TOKEN, so a leading docblock shifts it. The
  // module's `end` is EOF, so `end - byteLength` is this file's zero. Getting this wrong does not fail;
  // it prints a plausible line number for the wrong line.
  const bytes = Buffer.from(src, "utf8");
  const base = ast.span.end - bytes.length;
  const lineOf = (span) => {
    const at = Math.max(0, Math.min(bytes.length, span.start - base));
    let line = 1;
    for (let i = 0; i < at; i += 1) if (bytes[i] === 0x0a) line += 1;
    return line;
  };

  walk(ast, (node) => {
    if (node.type !== "CallExpression" || !isTestCallee(node.callee)) return;
    // The body is the last FUNCTION-LIKE argument, not the last argument: nine of these eleven pass a
    // per-test timeout after it, and `.at(-1)` on those is a number. Taking the last argument silently
    // matched one harness of eleven and reported the other ten clean without opening a body.
    const body = node.arguments
      .map((a) => a?.expression)
      .filter((e) => FUNCTION_LIKE.has(e?.type))
      .at(-1)?.body;
    if (body === undefined || body === null) return;
    bodiesSeen += 1;

    const returns = [];
    walk(body, (inner) => {
      if (FUNCTION_LIKE.has(inner.type)) return false; // a nested scope's returns are its own
      if (inner.type === "ReturnStatement") returns.push(lineOf(inner.span));
    });

    let expects = 0;
    walk(body, (inner) => {
      if (inner.type === "CallExpression" && isExpectCallee(inner.callee))
        expects += 1;
    });

    const where = `${rail.rail} — ${rail.file}:${lineOf(node.span)}`;
    for (const line of returns)
      failures.push(
        `${where}: a live-rail test body RETURNS at line ${line}. Vitest records a return as PASSED, ` +
          `so this path reports the rail proven while touching no chain. A missing dependency, an ` +
          `unusable credential or an unreachable node is a REFUSAL — throw it.`,
      );
    if (expects === 0)
      failures.push(
        `${where}: a live-rail test body contains no \`expect\`. A test that asserts nothing cannot ` +
          `fail, and live-proof-gate counts it as a pass.`,
      );
  });
}

if (bodiesSeen === 0 && rails.length > 0)
  failures.push(
    `parsed ${rails.length} harness file(s) and found no \`it\`/\`test\` body in any of them. That is a ` +
      `broken walk, not a clean tree — a scan that stops matching reports zero problems.`,
  );

if (failures.length > 0) {
  console.error("check:harness-proof — REFUSING:\n");
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  `check:harness-proof — ${bodiesSeen} live-rail test bodies across ${rails.length} harnesses: ` +
    `none returns early, all assert.`,
);
