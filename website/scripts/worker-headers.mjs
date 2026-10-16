#!/usr/bin/env node
// Writes .worker/headers.mjs, the module worker.js imports: the text of out/_headers, the file the static assets serve
// with, after scripts/lcp-documents.mjs has added its rules. Cloudflare does not apply _headers to a response the Worker
// returns, so the Worker sets those headers itself, from these rules, matched by headers.mjs. The step reads the rules
// first, so a form headers.mjs does not match stops the build.
//
// Usage, from website/, the last step of `pnpm build`:
//   node scripts/worker-headers.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseHeaders } from "../headers.mjs";

export const MODULE = ".worker/headers.mjs";

/** The module's text: the rules' file as its default export. */
export function moduleOf(text) {
  return `// Written by scripts/worker-headers.mjs from out/_headers, for worker.js.\nexport default ${JSON.stringify(text)};\n`;
}

if (import.meta.main) {
  const text = readFileSync("out/_headers", "utf8");
  const rules = parseHeaders(text);
  mkdirSync(".worker", { recursive: true });
  writeFileSync(MODULE, moduleOf(text));
  console.log(`wrote ${MODULE}: the ${rules.length} rules of out/_headers, for worker.js`);
}
