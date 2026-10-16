#!/usr/bin/env node
// Checks the name each table's region takes (rehypeTableNames in src/mdx/rehype-docs.ts), by compiling pages of its
// own as the site's build compiles a page: through the @mdx-js/mdx that fumadocs-mdx compiles with, under the options
// source.config.ts gives it, with fumadocs-mdx's own plugins (remark-gfm's footnotes, the image plugin) among them. A
// table is named by the heading it sits under, by that heading's text with each image's alt text and without its
// footnote references, and a table under a heading with no name "Table": the cases are a heading that is only an
// image, one with a footnote reference and one with no text. Each case lists the names it gives and the names wanted.
//
// Usage, from website/, after `pnpm install` or `pnpm build` there (either writes .source/):
//   node scripts/check-table-names.mjs
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyMdxPreset } from "fumadocs-mdx/config";
import config from "../.source/source.config.mjs";
import { DOCS_DIR } from "../src/lib/docs-dir.ts";

const TITLE = "Table names";
const TABLE = "| Code | Meaning |\n| --- | --- |\n| 1 | One |\n";
/** Each case: a page's Markdown, and the names its tables must take, in order. */
const CASES = [
  ["a heading that is only an image", `## Accounts\n\n${TABLE}\n## ![EVM logo](./evm.png)\n\n${TABLE}`, ["Accounts", "EVM logo"]],
  ["a heading with a footnote reference", `## Fees[^1]\n\n${TABLE}\n[^1]: A note.\n`, ["Fees"]],
  ["a heading with no text", `## Accounts\n\n${TABLE}\n##\n\n${TABLE}`, ["Accounts", "Table"]],
];

// The @mdx-js/mdx fumadocs-mdx itself imports, so the pages here are compiled by the same compiler as the site's.
const fromFumadocs = createRequire(createRequire(import.meta.url).resolve("fumadocs-mdx/config"));
const { createProcessor } = await import(pathToFileURL(fromFumadocs.resolve("@mdx-js/mdx")).href);
const options = await applyMdxPreset(config.mdxOptions)("bundler");

/** The names a page's tables take, in order. */
async function namesOf(markdown) {
  const names = [];
  const collect = () => (tree) => {
    const visit = (node) => {
      if (node.type === "element" && node.tagName === "table") names.push(node.properties?.dataName);
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
  const processor = createProcessor({ ...options, format: "md", rehypePlugins: [...options.rehypePlugins, collect] });
  await processor.process({
    value: markdown,
    path: join(resolve(DOCS_DIR), "check-table-names.md"),
    data: { frontmatter: { title: TITLE } },
  });
  return names;
}

let failures = 0;
for (const [what, markdown, wanted] of CASES) {
  const names = await namesOf(markdown);
  const ok = JSON.stringify(names) === JSON.stringify(wanted);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${JSON.stringify(names)}${ok ? "" : `, not ${JSON.stringify(wanted)}`}`);
}
if (failures > 0) {
  console.error(`${failures} of ${CASES.length} cases name their tables otherwise than wanted`);
  process.exit(1);
}
console.log(`each of ${CASES.length} cases names its tables as wanted, compiled as the site compiles a page`);
