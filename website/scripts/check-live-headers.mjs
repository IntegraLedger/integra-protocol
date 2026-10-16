#!/usr/bin/env node
// Checks the headers a deployed copy of the site serves, the step after a deploy (README.md, "How it is served"). It
// asks the site, at the base URL given, for:
// - a page, as HTML and as Markdown, and the page's .md address, which worker.js answers;
// - a file that is not a page, /icon.svg, which the static assets serve without the Worker;
// - an address the site does not hold, which worker.js answers with the 404 page;
// and compares each response with out/_headers, the rules the deployed build holds: its status, each header those
// rules give the address, value for value (headers.mjs), and, where worker.js answers by the Accept header,
// `Vary: Accept`. The page is the first of out/'s pages, other than the home page, that has a Markdown copy.
// Each response is listed, and each difference named.
//
// Usage, from website/, with the deployed build in out/:
//   node scripts/check-live-headers.mjs <base URL>
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { headersFor, parseHeaders } from "../headers.mjs";
import { pagesOf } from "./serve-export.mjs";

/** An address the site does not hold. */
const MISSING = "/check-live-headers-missing";
/** A file that is not a page, served without the Worker (wrangler.toml). */
const FILE = "/icon.svg";

/** The requests this check makes, for the build in `out`. */
export function requestsFor(out) {
  const page = pagesOf(out).find((p) => p !== "/" && existsSync(join(out, `md${p}.md`)));
  if (page === undefined) throw new Error(`${out} holds no page with a Markdown copy: run pnpm build in website/ first`);
  if (!existsSync(join(out, FILE.slice(1)))) throw new Error(`${out} holds no ${FILE}`);
  return [
    { address: page, accept: "text/html", status: 200, type: "text/html", varies: true },
    { address: page, accept: "text/markdown", status: 200, type: "text/markdown", varies: true },
    { address: `${page}.md`, accept: null, status: 200, type: "text/markdown", varies: false },
    { address: FILE, accept: null, status: 200, type: "image/svg+xml", varies: false },
    { address: MISSING, accept: "text/html", status: 404, type: "text/html", varies: true },
  ];
}

/**
 * Asks the site at `base` for each request of `requestsFor(out)`, and compares each response with the headers
 * out/_headers gives its address. Resolves to a line per response and the differences found.
 */
export async function checkLiveHeaders(base, out = "out") {
  const rules = parseHeaders(readFileSync(join(out, "_headers"), "utf8"));
  const lines = [];
  const failures = [];
  for (const { address, accept, status, type, varies } of requestsFor(out)) {
    const at = `${address}${accept === null ? "" : ` (Accept: ${accept})`}`;
    const response = await fetch(new URL(address, base), {
      headers: accept === null ? {} : { accept },
      redirect: "manual",
    });
    await response.arrayBuffer();
    const differ = [];
    if (response.status !== status) differ.push(`status ${response.status}, not ${status}`);
    if (!(response.headers.get("content-type") ?? "").startsWith(type)) {
      differ.push(`Content-Type ${JSON.stringify(response.headers.get("content-type"))}, not ${type}`);
    }
    for (const [name, value] of Object.entries(headersFor(rules, address))) {
      const got = response.headers.get(name);
      if (got !== value) differ.push(`${name} ${JSON.stringify(got)}, not ${JSON.stringify(value)}`);
    }
    const vary = (response.headers.get("vary") ?? "").split(",").map((v) => v.trim().toLowerCase());
    if (varies && !vary.includes("accept")) differ.push(`Vary ${JSON.stringify(response.headers.get("vary"))} does not name Accept`);
    lines.push(`${at}: ${response.status}, ${differ.length === 0 ? "every header as out/_headers gives it" : `${differ.length} differences`}`);
    failures.push(...differ.map((d) => `${at}: ${d}`));
  }
  return { lines, failures };
}

if (import.meta.main) {
  const base = process.argv[2];
  if (!base || !/^https?:\/\//.test(base)) {
    console.error("usage: node scripts/check-live-headers.mjs <base URL>, from website/, with the deployed build in out/");
    process.exit(2);
  }
  const { lines, failures } = await checkLiveHeaders(base, resolve("out"));
  for (const line of lines) console.log(line);
  if (failures.length > 0) {
    console.error(`${failures.length} differences from out/_headers at ${base}:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(`every response from ${base} carries the headers out/_headers gives its address`);
}
