#!/usr/bin/env node
// Checks the LCP documents the documentation site publishes (website/scripts/lcp-documents.mjs) against
// lcp/profiles/, byte for byte. Each document names its own address: a schema by its `$id`, a profile in its text. And
// every URI in the package's A2A_EXTENSION_URIS is a published document.
//
// Usage, from the repository root:
//   node scripts/check-lcp-documents.mjs --out website/out   the export, after lcp is built and `pnpm build` in website/
//   node scripts/check-lcp-documents.mjs [origin]            the live site, after its deploy (default: the site's origin)
//
// Against the live site, each document must answer 200 with no redirect (UCP: a platform MUST NOT follow a 3xx when it
// fetches a schema), with the bytes of lcp/profiles/, its type, a public Cache-Control of at least 60 seconds with no
// private, no-store or no-cache, and an ETag that a conditional request answers with 304. Each near miss must answer
// 404, so that a catch-all answering every path would fail.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CACHE_CONTROL,
  DOCUMENTS,
  MARKDOWN,
  ORIGIN,
  SCHEMA,
  exportFile,
  sourceBytes,
} from "../website/scripts/lcp-documents.mjs";

/** Addresses beside the documents that must not resolve. */
const NEAR_MISSES = [
  "/ucp/",
  "/ucp/x402/",
  "/ucp/x402/2026-10-02/schema",
  "/ucp/x402/2027-01-01",
  "/ucp/x402/2027-01-01/schema.json",
  "/ucp/with/",
  "/ucp/with/2026-10-02/schema",
  "/ucp/with/2027-01-01",
  "/ucp/with/2027-01-01/schema.json",
  "/a2a/legal-context/",
  "/a2a/legal-context/v2",
];

const root = join(import.meta.dirname, "..");
const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// What every run checks: each document names its own address, and the package's A2A URIs are published.
const published = new Set(DOCUMENTS.map((d) => `${ORIGIN}${d.path}`));
for (const doc of DOCUMENTS) {
  const address = `${ORIGIN}${doc.path}`;
  const text = sourceBytes(doc).toString("utf8");
  if (doc.type === SCHEMA) {
    const id = JSON.parse(text).$id;
    check(`${doc.source} $id`, id === address, `expected ${address}, got ${id}`);
  } else {
    check(`${doc.source} address`, doc.type === MARKDOWN && text.includes(`\`${address}\``), `does not name ${address}`);
  }
}
const a2aModule = join(root, "lcp", "dist", "a2a.js");
if (!existsSync(a2aModule)) throw new Error(`${a2aModule} does not exist: build lcp first`);
const { A2A_EXTENSION_URIS } = await import(pathToFileURL(a2aModule).href);
for (const uri of A2A_EXTENSION_URIS) check(`A2A_EXTENSION_URIS ${uri}`, published.has(uri), "is not a published document");

const outAt = process.argv.indexOf("--out");
if (outAt !== -1) {
  // The export: each file, and its address's rule in _headers.
  const out = resolve(process.argv[outAt + 1] ?? "website/out");
  const headers = parseHeaders(readFileSync(join(out, "_headers"), "utf8"));
  for (const doc of DOCUMENTS) {
    const file = exportFile(out, doc);
    const bytes = existsSync(file) ? readFileSync(file) : undefined;
    check(`${doc.path} file`, bytes !== undefined && bytes.equals(sourceBytes(doc)), bytes === undefined ? `${file} is missing` : `${file} differs from ${doc.source}`);
    const rule = headers.get(doc.path) ?? {};
    check(`${doc.path} Content-Type rule`, rule["content-type"] === doc.type, `expected ${doc.type}, got ${rule["content-type"]}`);
    check(`${doc.path} Cache-Control rule`, rule["cache-control"] === CACHE_CONTROL, `expected ${CACHE_CONTROL}, got ${rule["cache-control"]}`);
  }
  report(`${DOCUMENTS.length} documents in ${out} equal lcp/profiles/, each with its type and caching in _headers`);
} else {
  // The live site.
  const origin = process.argv[2] ?? ORIGIN;
  for (const doc of DOCUMENTS) {
    const url = new URL(doc.path, origin);
    const res = await fetch(url, { redirect: "manual" });
    const location = res.headers.get("location");
    check(`${doc.path} status`, res.status === 200, `expected 200, got ${res.status}${location ? ` to ${location}` : ""}`);
    if (res.status !== 200) continue;
    const bytes = Buffer.from(await res.arrayBuffer());
    const want = sourceBytes(doc);
    check(`${doc.path} bytes`, bytes.equals(want), `served ${bytes.length} bytes, sha256 ${sha(bytes).slice(0, 16)}…; ${doc.source} is ${want.length} bytes, sha256 ${sha(want).slice(0, 16)}…`);
    check(`${doc.path} content-type`, res.headers.get("content-type") === doc.type, `expected ${doc.type}, got ${res.headers.get("content-type")}`);
    const cache = res.headers.get("cache-control") ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(cache)?.[1] ?? -1);
    check(`${doc.path} cache-control`, /\bpublic\b/.test(cache) && maxAge >= 60 && !/private|no-store|no-cache/.test(cache), `expected public with max-age of at least 60 and no private, no-store or no-cache, got "${cache}"`);
    const etag = res.headers.get("etag");
    check(`${doc.path} etag`, etag !== null, "no ETag");
    if (etag !== null) {
      const again = await fetch(url, { redirect: "manual", headers: { "if-none-match": etag } });
      check(`${doc.path} conditional GET`, again.status === 304, `expected 304 for If-None-Match ${etag}, got ${again.status}`);
    }
    const head = await fetch(url, { method: "HEAD", redirect: "manual" });
    check(`${doc.path} HEAD`, head.status === 200 && head.headers.get("content-type") === doc.type, `expected 200 ${doc.type}, got ${head.status} ${head.headers.get("content-type")}`);
  }
  for (const path of NEAR_MISSES) {
    const res = await fetch(new URL(path, origin), { redirect: "manual" });
    check(`${path} near miss`, res.status === 404, `expected 404, got ${res.status} (${res.headers.get("content-type")})`);
  }
  report(`${DOCUMENTS.length} documents at ${origin} equal lcp/profiles/, with their types, caching and ETags, no redirect; ${NEAR_MISSES.length} near misses 404`);
}

/** The rules of a `_headers` file: each path's headers, by lowercase name. */
function parseHeaders(text) {
  const rules = new Map();
  let current;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = {};
      rules.set(line.trim(), current);
    } else if (current !== undefined) {
      const colon = line.indexOf(":");
      current[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }
  }
  return rules;
}

function report(ok) {
  if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed:`);
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(ok);
}
