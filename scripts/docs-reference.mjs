#!/usr/bin/env node
// Writes the parts of the documentation that are generated from the lcp package: the pairing list in lcp/README.md
// (between its pairings markers), and the reference pages docs/reference/pairings.md (from the registry,
// BINDINGS), docs/reference/entry-points.md (from package.json's exports, each module's doc comment, the runtime
// exports and the emitted declarations) and docs/reference/vectors.md (from the vector files). It also checks that
// docs/reference/refusals.md lists every code the source names in refusal(…) and refuse(…).
//
// Usage, from the repository root after lcp is built:
//   node scripts/docs-reference.mjs           write the pages
//   node scripts/docs-reference.mjs --check   exit 1 when a committed page differs from what the package gives
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const lcp = join(root, "lcp");
const reference = join(root, "docs", "reference");
const check = process.argv.includes("--check");
const REPO = "https://github.com/IntegraLedger/integra-protocol/blob/main";

const pkg = JSON.parse(readFileSync(join(lcp, "package.json"), "utf8"));
const entries = Object.keys(pkg.exports).map((k) => (k === "." ? "index" : k.slice(2)));
const load = (name) => import(pathToFileURL(join(lcp, "dist", `${name}.js`)).href);
const index = await load("index");

/** The first paragraph of a source file's leading doc comment, as one line. */
function moduleSummary(name) {
  const text = readFileSync(join(lcp, "src", `${name}.ts`), "utf8");
  const m = /^\/\*\*([\s\S]*?)\*\//.exec(text);
  if (m === null) return "";
  const lines = m[1].split("\n").map((l) => l.replace(/^\s*\* ?/, "").trimEnd());
  const para = [];
  for (const l of lines) {
    if (l.trim() === "") {
      if (para.length > 0) break;
      continue;
    }
    para.push(l.trim());
  }
  return para.join(" ");
}

/** The type names a declaration file exports, following `export type { … } from` and `export { type … }`. */
function typeExports(name) {
  const text = readFileSync(join(lcp, "dist", `${name}.d.ts`), "utf8");
  const names = new Set();
  for (const m of text.matchAll(/^export (?:declare )?(?:type|interface) ([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export type \{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop();
      if (n) names.add(n);
    }
  }
  for (const m of text.matchAll(/^export \{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (!p.startsWith("type ")) continue;
      const n = p.slice(5).trim().split(/\s+as\s+/).pop();
      if (n) names.add(n);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const code = (s) => `\`${s}\``;
const cell = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");
const yes = (b) => (b ? "yes" : "no");
const header = (title, description) => `---\ntitle: ${title}\ndescription: ${description}\n---\n\n# ${title}\n\n`;
const generatedNote =
  "This page is generated from the package by `node scripts/docs-reference.mjs`, and CI checks that it matches.\n\n";

// Where each pairing is exported: the entry points whose runtime exports hold that pairing object.
const exportedFrom = new Map();
const modules = new Map();
for (const e of entries) {
  const mod = await load(e);
  modules.set(e, mod);
  for (const [k, v] of Object.entries(mod)) {
    if (e === "index") continue;
    const b = index.BINDINGS.find((x) => x === v);
    if (b === undefined) continue;
    const list = exportedFrom.get(b.id) ?? [];
    list.push(`${e}.${k}`);
    exportedFrom.set(b.id, list);
  }
}
const subpath = (e) => (e === "index" ? "@integraledger/lcp" : `@integraledger/lcp/${e}`);

function pairingsPage() {
  const rows = [...index.BINDINGS].sort((a, b) => a.id.localeCompare(b.id));
  const surfaces = [...new Set(rows.map((b) => b.id.split("/")[0]))];
  let s = header("Pairings", "Every pairing @integraledger/lcp implements, generated from its registry.");
  s += generatedNote;
  s +=
    `\`BINDINGS\` holds ${rows.length} pairings on ${surfaces.length} surfaces (${surfaces.map(code).join(", ")}). ` +
    "Each row gives the pairing's id, the export that implements it, and its `pattern` record: the binding pattern, " +
    "whether the buyer's signature covers the ATR hash, whether the hash itself is on chain, whether the settlement " +
    "is a public proof, whether the hash can be recovered from the chain alone, and the LCP profile that defines the " +
    "binding, where one does. [Binding](../concepts/binding.md) explains each field.\n\n";
  for (const surface of surfaces) {
    s += `## ${code(surface)}\n\n`;
    s += "| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |\n";
    s += "|---|---|---|---|---|---|---|---|\n";
    for (const b of rows.filter((x) => x.id.split("/")[0] === surface)) {
      const p = b.pattern;
      const where = (exportedFrom.get(b.id) ?? []).map((w) => {
        const [e, k] = w.split(".");
        return `${code(k)} from ${code(subpath(e))}`;
      });
      const profile = p.profile === undefined ? "" : profileLink(p.profile);
      s += `| ${code(b.id)} | ${where.join("<br>")} | ${code(p.pattern)} | ${yes(p.buyerSigns)} | ${yes(p.onChain)} | ${yes(p.publicProof)} | ${yes(p.zeroPartyRecoverable)} | ${profile} |\n`;
    }
    s += "\n";
  }
  s += "## What each binding proves\n\n";
  s +=
    "Each pairing's `pattern.proves` states what a payment through it shows, and what it does not. The text is the " +
    "package's own, quoted as it is. Where it names `<network>` and `<transaction>`, the record fills them in.\n\n";
  for (const b of rows) s += `### ${code(b.id)}\n\n${b.pattern.proves}\n\n`;
  return s;
}

function profileLink(profile) {
  const file = readdirSync(join(lcp, "profiles")).find((f) => {
    const first = readFileSync(join(lcp, "profiles", f), "utf8").split("\n")[0];
    return first.includes(`LCP profile \`${profile}\``);
  });
  return file === undefined ? code(profile) : `[${code(profile)}](../../lcp/profiles/${file})`;
}

function entryPointsPage() {
  let s = header("Entry points", "Every entry point of @integraledger/lcp and what it exports.");
  s += generatedNote;
  s +=
    "Import each entry point by its subpath. Every entry point is ESM with its own type declarations. The " +
    "[API reference](./api/index.md) gives each export's signature and documentation.\n\n";
  s += "| Entry point | What it holds |\n|---|---|\n";
  for (const e of entries) s += `| [${code(subpath(e))}](#${anchor(subpath(e))}) | ${cell(moduleSummary(e) || indexSummary(e))} |\n`;
  s += "\n";
  for (const e of entries) {
    const mod = modules.get(e);
    const values = Object.keys(mod).sort((a, b) => a.localeCompare(b));
    const types = typeExports(e);
    const pairings = [...exportedFrom.entries()].filter(([, w]) => w.some((x) => x.startsWith(`${e}.`))).map(([id]) => id).sort();
    s += `## ${code(subpath(e))}\n\n`;
    s += `${moduleSummary(e) || indexSummary(e)}\n\n`;
    s += "```ts no-check\n";
    s += `import { ${values.slice(0, 3).join(", ")}${values.length > 3 ? ", …" : ""} } from "${subpath(e)}";\n`;
    s += "```\n\n";
    if (pairings.length > 0) s += `**Pairings:** ${pairings.map(code).join(", ")}.\n\n`;
    s += `**Values (${values.length}):** ${values.map(code).join(", ")}.\n\n`;
    if (types.length > 0) s += `**Types (${types.length}):** ${types.map(code).join(", ")}.\n\n`;
  }
  return s;
}

function indexSummary(e) {
  return e === "index"
    ? "The core: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's string and structured forms, the https-link rule, and the registry of every pairing (`BINDINGS`, `pairingOf`, `canonicalTx`)."
    : "";
}

function anchor(text) {
  return text.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-");
}

function vectorsPage() {
  const files = readdirSync(join(lcp, "vectors")).filter((f) => f.endsWith(".json")).sort();
  let s = header("Vector files", "Every vector file @integraledger/lcp ships, and what it fixes.");
  s += generatedNote;
  s +=
    `The package ships ${files.length} vector files in \`vectors/\`. Each file's \`about\` states what it covers and ` +
    "where its expected values come from; it is quoted here as it is. The [Vectors](../concepts/vectors.md) page " +
    "explains how to run them.\n\n";
  s += "| File | About |\n|---|---|\n";
  for (const f of files) {
    const about = JSON.parse(readFileSync(join(lcp, "vectors", f), "utf8")).about ?? "";
    s += `| [${code(f)}](../../lcp/vectors/${f}) | ${cell(about)} |\n`;
  }
  return `${s}\n`;
}

/** The codes `refusal("…")` and `refuse("…")` name in the source, and the codes refusals.md lists. */
function refusalCodes() {
  const inSource = new Set();
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".ts")) {
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/\b(?:refusal|refuse)\(\s*"([a-z0-9]+\/[a-z0-9-]+)"/g)) inSource.add(m[1]);
      }
    }
  };
  walk(join(lcp, "src"));
  const page = join(reference, "refusals.md");
  const listed = new Set();
  if (existsSync(page)) {
    for (const m of readFileSync(page, "utf8").matchAll(/^\| `([a-z0-9]+\/[a-z0-9-]+)` \|/gm)) listed.add(m[1]);
  }
  return { inSource, listed };
}

function readmePairings() {
  const rows = [...index.BINDINGS].sort((a, b) => a.id.localeCompare(b.id));
  const surfaces = [...new Set(rows.map((b) => b.id.split("/")[0]))];
  let s = `${rows.length} pairings on ${surfaces.length} surfaces.\n\n`;
  s += "| Surface | Pairings |\n|---|---|\n";
  for (const surface of surfaces) {
    const ids = rows.filter((b) => b.id.split("/")[0] === surface).map((b) => code(b.id));
    s += `| ${code(surface)} (${ids.length}) | ${ids.join(", ")} |\n`;
  }
  return s;
}

const README = join(lcp, "README.md");
const START = "<!-- pairings:start -->\n";
const END = "<!-- pairings:end -->";
function readmeText() {
  const text = readFileSync(README, "utf8");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error("lcp/README.md has no pairings markers");
  return `${text.slice(0, a + START.length)}${readmePairings()}${text.slice(b)}`;
}

const pages = [
  ["pairings.md", pairingsPage()],
  ["entry-points.md", entryPointsPage()],
  ["vectors.md", vectorsPage()],
];
let stale = 0;
const readme = readmeText();
if (check) {
  if (readFileSync(README, "utf8") !== readme) {
    stale++;
    console.error("lcp/README.md's pairing list differs from BINDINGS: run node scripts/docs-reference.mjs");
  } else {
    console.log("lcp/README.md's pairing list matches BINDINGS");
  }
} else {
  writeFileSync(README, readme);
  console.log("wrote the pairing list in lcp/README.md");
}
for (const [name, text] of process.argv.includes("--readme-only") ? [] : pages) {
  const path = join(reference, name);
  if (check) {
    const committed = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (committed !== text) {
      stale++;
      console.error(`docs/reference/${name} differs from what the package gives: run node scripts/docs-reference.mjs`);
    } else {
      console.log(`docs/reference/${name} matches the package`);
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote docs/reference/${name}`);
  }
}
const { inSource, listed } = refusalCodes();
const missing = [...inSource].filter((c) => !listed.has(c)).sort();
if (missing.length > 0) {
  stale++;
  console.error(`docs/reference/refusals.md does not list: ${missing.join(", ")}`);
} else {
  console.log(`docs/reference/refusals.md lists all ${inSource.size} codes the source names in refusal(…) and refuse(…)`);
}
process.exit(stale === 0 ? 0 : 1);
