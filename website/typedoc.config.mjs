// `pnpm run api`: Markdown API pages for every entry point of @integraledger/lcp, one page per
// entry point, written into the documentation tree.
import { readFileSync } from "node:fs";
import { DOCS_DIR } from "./src/lib/docs-dir.ts";

const manifest = JSON.parse(readFileSync(new URL("../lcp/package.json", import.meta.url), "utf8"));
const entries = Object.keys(manifest.exports).map((key) => (key === "." ? "index" : key.slice(2)));

/** @type {import("typedoc").TypeDocOptions & import("typedoc-plugin-markdown").PluginOptions} */
export default {
  entryPoints: entries.map((name) => `../lcp/src/${name}.ts`),
  tsconfig: "../lcp/tsconfig.json",
  out: `${DOCS_DIR}/reference/api`,
  plugin: ["typedoc-plugin-markdown", "./scripts/typedoc-pages.mjs"],
  router: "module",
  entryModule: "index",
  entryFileName: "index",
  readme: "none",
  cleanOutputDir: true,
  disableSources: true,
  hidePageHeader: true,
  hideBreadcrumbs: true,
  parametersFormat: "table",
  interfacePropertiesFormat: "table",
  classPropertiesFormat: "table",
  typeAliasPropertiesFormat: "table",
  enumMembersFormat: "table",
  typeDeclarationFormat: "table",
  logLevel: "Warn",
};
