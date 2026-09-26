import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { transformerTwoslash } from "fumadocs-twoslash";
import type { ShikiTransformer } from "shiki";
import ts from "typescript";
import { DOCS_DIR } from "./src/lib/docs-dir";
import { rehypeMermaid, rehypeUncheckedUnder, hasMetaFlag } from "./src/mdx/rehype-docs";
import { remarkDocLinks, remarkHtmlAnchors, remarkStripLeadingTitle } from "./src/mdx/remark-docs";

// `next build`, `next dev` and `fumadocs-mdx` run in website/.
const protocolRoot = resolve(process.cwd(), "..");
const docsDir = resolve(process.cwd(), DOCS_DIR);
const apiDir = resolve(docsDir, "reference/api");
const lcpTypes = resolve(protocolRoot, "lcp/dist");
const viem = resolve(protocolRoot, "lcp/node_modules/viem");

if (!existsSync(resolve(lcpTypes, "index.d.ts"))) {
  throw new Error(
    `${lcpTypes}/index.d.ts is missing: build the package first (pnpm --filter @integraledger/lcp run build at the repository root)`,
  );
}

export const docs = defineDocs({
  dir: DOCS_DIR,
  docs: {
    lastModified: true,
    postprocess: {
      // Each page's Markdown after the remark plugins, served by /md, /llms-full.txt and the
      // page's copy button.
      includeProcessedMarkdown: { headingIds: false },
    },
  },
});

// The TypeScript samples are checked as ES modules (top-level await allowed) under these strict
// options, with the package's imports resolved to its built declarations in ../lcp/dist.
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2024,
  lib: ["lib.es2024.d.ts", "lib.dom.d.ts"],
  types: ["node"],
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  verbatimModuleSyntax: true,
  skipLibCheck: true,
  paths: {
    "@integraledger/lcp": [`${lcpTypes}/index.d.ts`],
    "@integraledger/lcp/*": [`${lcpTypes}/*.d.ts`],
    // ESM resolution does not load a directory, so each specifier maps to its declaration file.
    viem: [`${viem}/_types/index.d.ts`],
    "viem/*": [`${viem}/_types/*/index.d.ts`],
  },
};

/** Whether a code block is type-checked: a `ts` block whose meta does not carry `no-check`. */
function isChecked(lang: string, meta: unknown): boolean {
  return (lang === "ts" || lang === "typescript") && !hasMetaFlag(meta, "no-check");
}

/**
 * Prepends Twoslash's `@module` and `@moduleResolution` flags to each checked block. Twoslash
 * applies its own `moduleResolution` default on every call, after the configured options, and
 * the flags in the code are applied last; Twoslash removes the flag lines from the output.
 */
const nodeNextFlags: ShikiTransformer = {
  name: "twoslash-nodenext",
  preprocess(code, options) {
    if (!isChecked(options.lang, options.meta?.__raw)) return undefined;
    return `// @module: nodenext\n// @moduleResolution: nodenext\n${code}`;
  },
};

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [
      remarkStripLeadingTitle,
      remarkHtmlAnchors,
      [
        remarkDocLinks,
        {
          docsDir,
          repoRoot: protocolRoot,
          githubUrl: "https://github.com/IntegraLedger/integra-protocol",
          branch: "main",
        },
      ],
      ...plugins,
    ],
    rehypePlugins: (plugins) => [[rehypeUncheckedUnder, [apiDir]], rehypeMermaid, ...plugins],
    rehypeCodeOptions: {
      themes: { light: "github-light", dark: "github-dark" },
      transformers: [
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        nodeNextFlags,
        transformerTwoslash({
          // Every `ts` block is checked unless its meta carries `no-check`; a type error
          // fails the build.
          filter: (lang, _code, options) => isChecked(lang, options.meta?.__raw),
          throws: true,
          twoslashOptions: { compilerOptions },
        }),
      ],
    },
  },
});
