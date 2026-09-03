#!/usr/bin/env node
/**
 * RUN the documentation's self-contained example calls, and refuse one that fails.
 *
 * `check:docs` compiles every `ts` fence in `docs/`, the root README and every package README. Compiling is
 * a real gate and it is not this one: a fence can typecheck perfectly and still be the first thing a
 * stranger runs and the first thing that fails. Measured 2026-09-03, before this gate existed:
 * `binding-evm-x402`'s README opened with `getX402Deployment("base-sepolia-usdc")`, and the known keys are
 * `base`, `base-sepolia`, `avalanche` and `monad`. The parameter is a `string`, so `tsc` had nothing to
 * say; the function throws on the second line of the npmjs landing page.
 *
 * **The subject set is the calls that CAN be run, derived rather than listed.** A fence's values mostly
 * arrive through `declare const`, which erases — there is no value to pass. So this gate takes the calls
 * that need nothing from the reader: a call of something imported from an `@integraledger/*` package whose
 * every argument is a literal, or an object/array built only out of literals. Those are exactly the lines
 * that assert a fact about a closed vocabulary — a deployment key, a network name, a manifest id — and
 * exactly the ones a typechecker cannot judge.
 *
 * Two failures are refused, and they are different facts:
 *
 *   • **A THROW.** The example does not work. Nothing more needs saying.
 *   • **A RETURNED `Refusal`.** The example runs and the library declines it. In this workspace a refusal
 *     is a returned value rather than an exception, so a documented call that refuses is a documented
 *     call that fails — it just fails quietly.
 *
 * **A call the documentation SAYS fails is required to fail**, and that is the same gate read the other
 * way. Documentation here demonstrates refusals on purpose — `decodeLegalContextString("lcp:sha256:")` is
 * annotated `// throws carrier/malformed`, `placementFor("mastercard-vi")` is annotated `// THROWS — see
 * below`. A trailing `//` comment on the call's own line reading `throws`, `refuses` or `refused` inverts
 * the expectation, so a demonstration that quietly starts SUCCEEDING is a failure too. No new marker was
 * invented for this: the annotation the documents already carry is the annotation that is checked. The
 * match is on those three words exactly — a comment reading "not a hole to fill with a throwing stub" is
 * prose about a throw, not a claim that this line throws.
 *
 * Two shapes are skipped rather than run, and both are structural rather than a list:
 *
 *   • **An ELIDED argument** — any literal containing `…` or `...`. That is a placeholder the reader
 *     substitutes, not a value the example asserts, and calling it would only ever prove the ellipsis is
 *     not a hash.
 *   • **A call inside a `try`** — the fence has already said it expects this to throw, in the only way a
 *     program can say it.
 *
 * ⛔ It imports the BUILT package, like `check:docs`, so it runs after `build`. A gate reading `src/`
 * would certify a fence against code the reader will never receive.
 *
 * ⛔ It refuses an empty subject set. A fence extractor that stops matching finds no failing calls, which
 * is the same colour as a documentation set that works.
 *
 * Usage: node scripts/check-doc-calls.mjs
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSync } from "@swc/core";

const ROOT = process.cwd();

/** `JSON.stringify` throws on a BigInt, and a fence may well pass one. */
const bigintSafe = (_k, v) => (typeof v === "bigint" ? `${v}n` : v);

/** The same three sources `check:docs` reads: docs/ entire, the root README, every package README. */
function markdownFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".md")) out.push(p);
    }
  };
  const docs = join(ROOT, "docs");
  if (existsSync(docs)) walk(docs);
  const rootReadme = join(ROOT, "README.md");
  if (existsSync(rootReadme)) out.push(rootReadme);
  for (const entry of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const readme = join(ROOT, "packages", entry.name, "README.md");
    if (existsSync(readme)) out.push(readme);
  }
  return out.sort();
}

/**
 * Fences opened at column 0 as ```ts / ```typescript, with the line the fence body starts on.
 * `no-check` is exempt because `check:docs` exempts it.
 */
function fences(src) {
  const lines = src.split("\n");
  const out = [];
  let open = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (open === null) {
      const m = /^`{3,}\s*(ts|typescript)((?:\s+[a-z-]+)*)\s*$/.exec(line);
      if (m)
        open = { start: i + 2, body: [], flags: (m[2] ?? "").split(/\s+/) };
      continue;
    }
    if (/^`{3,}\s*$/.test(line)) {
      if (!open.flags.includes("no-check"))
        out.push({ line: open.start, code: open.body.join("\n") });
      open = null;
      continue;
    }
    open.body.push(line);
  }
  return out;
}

/** A value this gate can build without asking the reader for anything. */
function literalValue(node) {
  switch (node?.type) {
    case "StringLiteral":
      return { ok: true, value: node.value };
    case "NumericLiteral":
      return { ok: true, value: node.value };
    case "BooleanLiteral":
      return { ok: true, value: node.value };
    case "NullLiteral":
      return { ok: true, value: null };
    case "BigIntLiteral":
      // swc reports the value in a shape BigInt() will not always take; the raw literal is exact.
      try {
        return { ok: true, value: BigInt((node.raw ?? "").replace(/n$/, "")) };
      } catch {
        return { ok: false };
      }
    case "TemplateLiteral":
      // Only a template with no substitutions — `${x}` reintroduces the reader's value.
      return node.expressions.length === 0
        ? {
            ok: true,
            value: node.quasis.map((q) => q.cooked ?? q.raw).join(""),
          }
        : { ok: false };
    case "ArrayExpression": {
      const out = [];
      for (const el of node.elements) {
        if (el === null || el === undefined || el.spread) return { ok: false };
        const v = literalValue(el.expression);
        if (!v.ok) return { ok: false };
        out.push(v.value);
      }
      return { ok: true, value: out };
    }
    case "ObjectExpression": {
      const out = {};
      for (const prop of node.properties) {
        if (prop.type !== "KeyValueProperty") return { ok: false };
        const key =
          prop.key.type === "Identifier"
            ? prop.key.value
            : prop.key.type === "StringLiteral"
              ? prop.key.value
              : null;
        if (key === null) return { ok: false };
        const v = literalValue(prop.value);
        if (!v.ok) return { ok: false };
        out[key] = v.value;
      }
      return { ok: true, value: out };
    }
    // `as const`, `satisfies`, `as X` — the type annotation is erased, the value beneath it is not.
    case "TsAsExpression":
    case "TsConstAssertion":
    case "TsSatisfiesExpression":
    case "TsNonNullExpression":
      return literalValue(node.expression);
    default:
      return { ok: false };
  }
}

function walk(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "span") continue;
    walk(node[key], visit);
  }
}

const failures = [];
let callsRun = 0;
let fencesSeen = 0;

for (const file of markdownFiles()) {
  const src = readFileSync(file, "utf8");
  for (const fence of fences(src)) {
    fencesSeen += 1;
    let ast;
    try {
      ast = parseSync(fence.code, {
        syntax: "typescript",
        target: "es2022",
        comments: false,
      });
    } catch {
      // A fence that does not parse is `check:docs`' failure to report, not this gate's.
      continue;
    }

    // Which local names come from a workspace package, and from which module.
    const imported = new Map();
    for (const stmt of ast.body) {
      if (stmt.type !== "ImportDeclaration") continue;
      const from = stmt.source.value;
      if (!from.startsWith("@integraledger/")) continue;
      for (const spec of stmt.specifiers) {
        if (spec.type === "ImportSpecifier" && spec.typeOnly !== true)
          imported.set(spec.local.value, {
            from,
            name: (spec.imported ?? spec.local).value,
          });
      }
    }
    if (imported.size === 0) continue;

    const bytes = Buffer.from(fence.code, "utf8");
    const base = ast.span.end - bytes.length;
    const fenceLines = fence.code.split("\n");
    const lineOf = (span) => {
      const at = Math.max(0, Math.min(bytes.length, span.start - base));
      let line = 0;
      for (let i = 0; i < at; i += 1) if (bytes[i] === 0x0a) line += 1;
      return line; // 0-based index into fenceLines
    };

    const calls = [];
    const collect = (node, inTry) => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) collect(child, inTry);
        return;
      }
      // A call the fence already wraps in `try` has said, in code, that it expects to throw.
      const nowInTry = inTry || node.type === "TryStatement";
      if (node.type === "CallExpression") {
        // `f(...)` or `f.g(...)` — the root identifier is what must be imported.
        let root = node.callee;
        const path = [];
        let ok = true;
        while (root?.type === "MemberExpression") {
          if (root.property?.type !== "Identifier") {
            ok = false;
            break;
          }
          path.unshift(root.property.value);
          root = root.object;
        }
        const origin =
          ok && root?.type === "Identifier"
            ? imported.get(root.value)
            : undefined;
        if (origin !== undefined && !nowInTry) {
          const args = [];
          let runnable = true;
          for (const a of node.arguments) {
            if (a.spread) {
              runnable = false;
              break;
            }
            const v = literalValue(a.expression);
            if (!v.ok) {
              runnable = false;
              break;
            }
            args.push(v.value);
          }
          // An ellipsis is a placeholder the reader replaces, never a value the example asserts.
          if (runnable && !/…|\.\.\./.test(JSON.stringify(args, bigintSafe)))
            calls.push({
              origin,
              path,
              args,
              expectsFailure: /\/\/.*\b(throws|refuses|refused)\b/i.test(
                fenceLines[lineOf(node.span)] ?? "",
              ),
            });
        }
      }
      for (const key of Object.keys(node)) {
        if (key === "span") continue;
        collect(node[key], nowInTry);
      }
    };
    collect(ast, false);

    for (const call of calls) {
      const where = `${relative(ROOT, file)}:${fence.line}`;
      let mod;
      try {
        mod = await import(call.origin.from);
      } catch (err) {
        failures.push(
          `${where}: the fence imports ${call.origin.from}, which does not load (${err.message}). ` +
            `This gate reads the BUILT package — run \`pnpm -r build\` first.`,
        );
        continue;
      }
      let fn = mod[call.origin.name];
      for (const seg of call.path) fn = fn?.[seg];
      if (typeof fn !== "function") continue; // not a call this gate can make
      callsRun += 1;
      const shown = `${call.origin.name}${call.path.map((p) => `.${p}`).join("")}(${call.args
        .map((a) => JSON.stringify(a, bigintSafe))
        .join(", ")})`;
      let result;
      let threw = null;
      try {
        result = await fn(...call.args);
      } catch (err) {
        threw = err;
      }
      const refused =
        threw === null &&
        result !== null &&
        typeof result === "object" &&
        result.refused === true;
      if (call.expectsFailure) {
        // The document says this fails. If it stopped failing, the document now teaches the wrong lesson.
        if (threw === null && !refused)
          failures.push(
            `${where}: \`${shown}\` is annotated as throwing/refusing and SUCCEEDED. A demonstration ` +
              `that quietly starts working is as wrong as an example that quietly stops.`,
          );
        continue;
      }
      if (threw !== null)
        failures.push(`${where}: \`${shown}\` THREW — ${threw.message}`);
      else if (refused)
        failures.push(
          `${where}: \`${shown}\` REFUSED (${result.code}) — a documented example that declines is a ` +
            `documented example that fails, it just fails quietly. Fix the example, or annotate the ` +
            `line as refusing if the refusal is the point.`,
        );
    }
  }
}

if (fencesSeen === 0)
  failures.push(
    "found no checkable ts fences at all. An extractor that stops matching reports every document as " +
      "working, which is the failure this gate exists to refuse.",
  );
if (callsRun === 0 && fencesSeen > 0)
  failures.push(
    `parsed ${fencesSeen} fences and could run no example call in any of them. That is a broken scan, ` +
      "not clean documentation.",
  );

if (failures.length > 0) {
  console.error("check:doc-calls — REFUSING:\n");
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}

console.log(
  `check:doc-calls — ran ${callsRun} self-contained example call(s) across ${fencesSeen} fences: ` +
    "none threw, none refused.",
);
