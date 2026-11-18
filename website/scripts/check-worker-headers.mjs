#!/usr/bin/env node
// Checks the headers of every response worker.js returns. Cloudflare does not apply _headers to a response the Worker
// returns, so the Worker sets them itself; here it runs in front of static assets that answer with no header at all,
// so each header a response carries is one the Worker set:
// - for every page address, its .md address (`/index.md` for the home page) and each Accept header below, a GET and
//   a conditional GET answered 304, and for addresses the site does not hold, answered 404, the response
//   carries exactly the headers out/_headers gives the address asked for (headers.mjs), with the Worker's own Link
//   after the rules' (on a page's HTML, a 200 or a 304, its Markdown address; on its Markdown at its .md address, the
//   page as canonical; on the page's Markdown at its own address and on a 404, none), and `Vary: Accept` when the
//   Accept header decides the answer, which is at every address but a .md address;
// - a request that asks for Markdown at a page address, or for its .md address, is answered with the page's Markdown
//   copy, and any other with the page's HTML or the 404 page, so each response checked is the one its case names; a
//   .md address that names no page is answered 404 in Markdown that names /llms.txt;
// - .worker/headers.mjs, the module the Worker reads its rules from, holds out/_headers as it is;
// - scripts/check-live-headers.mjs, the check made after a deploy, run against worker.js on a loopback port in front of
//   static assets that give each file only its Content-Type, finds no difference.
// Each failure names the address, the Accept header and the header that differs.
//
// Usage, from website/, after `pnpm build` there:
//   node scripts/check-worker-headers.mjs
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { headersFor, parseHeaders } from "../headers.mjs";
import { alternateLink, canonicalLink, checkLiveHeaders, ORIGIN, withLink } from "./check-live-headers.mjs";
import { fileFor, pagesOf, TYPES } from "./serve-export.mjs";
import { MODULE, moduleOf } from "./worker-headers.mjs";

const OUT = resolve("out");
const ORIGIN = "https://worker.check";
/** The entity tag the static assets below give every file, so a request carrying it is answered 304. */
const ETAG = '"check-worker-headers"';
/** Accept headers, and whether each asks for Markdown (README.md, "How it is served"). */
const ACCEPTS = [
  [null, false],
  ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false],
  ["*/*", false],
  ["text/plain", false],
  ["text/markdown", true],
  ["text/x-markdown", true],
  ["text/markdown, text/html;q=0.5", true],
];
/** Addresses the site does not hold. */
const MISSING = ["/check-worker-headers", "/check-worker-headers.md", "/guides/check-worker-headers"];
/** The body a case expects when it is the Worker's Markdown 404, not a file of out/. */
const MARKDOWN_404 = "the Markdown 404";

/** What a .md address that names no page is answered with: Markdown that names the index of every page. */
const isMarkdown404 = (bytes) => {
  const text = bytes.toString("utf8");
  return text.startsWith("# Page not found\n") && text.includes(`${ORIGIN}/llms.txt`);
};

const text = readFileSync(join(OUT, "_headers"), "utf8");
if (!readFileSync("worker.js", "utf8").includes(`const ORIGIN = "${ORIGIN}";`)) {
  console.error(`worker.js does not name ${ORIGIN}, src/lib/site.ts's url, as its ORIGIN`);
  process.exit(1);
}
if (!existsSync(MODULE) || readFileSync(MODULE, "utf8") !== moduleOf(text)) {
  console.error(`${MODULE} does not hold out/_headers as it is: run pnpm build in website/`);
  process.exit(1);
}
const rules = parseHeaders(text);
const { default: worker } = await import("../worker.js");

/**
 * Static assets as the Worker's ASSETS binding, answering from out/ with no header on any response, or, with `typed`,
 * with the file's Content-Type alone.
 */
const assets = (typed) => ({
  async fetch(input) {
    const request = input instanceof Request ? input : new Request(input);
    const file = fileFor(OUT, new URL(request.url).pathname);
    const served = file ?? join(OUT, "404.html");
    const headers = typed ? { "content-type": TYPES[extname(served)] } : {};
    const body = request.method === "HEAD" ? null : readFileSync(served);
    const response =
      file === undefined
        ? new Response(body, { status: 404, headers })
        : request.headers.get("if-none-match") === ETAG
          ? new Response(null, { status: 304, headers })
          : new Response(body, { status: 200, headers });
    if ([...response.headers].length !== (typed ? 1 : 0)) throw new Error("the static assets' response carries a header");
    return response;
  },
});
const ASSETS = assets(false);

const failures = [];
const seen = { markdown: 0, html: 0, notModified: 0, notFound: 0 };
/** Asks the Worker for an address, and checks the response's status, body and headers. */
async function check(address, { method = "GET", accept = null, conditional = false, status, body, varies, link }) {
  const headers = new Headers();
  if (accept !== null) headers.set("accept", accept);
  if (conditional) headers.set("if-none-match", ETAG);
  const response = await worker.fetch(new Request(`${ORIGIN}${address}`, { method, headers }), { ASSETS });
  const at = `${method} ${address}${accept === null ? "" : `, Accept: ${accept}`}${conditional ? ", If-None-Match" : ""}`;
  if (response.status !== status) failures.push(`${at}: status ${response.status}, not ${status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (method === "GET" && status !== 304) {
    if (body === MARKDOWN_404 ? !isMarkdown404(bytes) : !bytes.equals(readFileSync(body))) {
      failures.push(`${at}: the body is not ${body === MARKDOWN_404 ? "the Markdown 404" : body.slice(OUT.length + 1)}`);
    }
  }
  const wanted = { ...withLink(headersFor(rules, address), link), ...(varies ? { vary: "Accept" } : {}) };
  const got = Object.fromEntries(response.headers);
  for (const name of new Set([...Object.keys(wanted), ...Object.keys(got)])) {
    if (got[name] !== wanted[name]) failures.push(`${at}: ${name} is ${JSON.stringify(got[name])}, not ${JSON.stringify(wanted[name])}`);
  }
  if (status === 304) seen.notModified++;
  else if (status === 404) seen.notFound++;
  else if (body.endsWith(".md")) seen.markdown++;
  else seen.html++;
}

const pages = pagesOf(OUT);
let asked = 0;
for (const page of pages) {
  const html = fileFor(OUT, page);
  const copy = join(OUT, page === "/" ? "md/index.md" : `md${page}.md`);
  const hasCopy = existsSync(copy);
  const dotMd = page === "/" ? "/index.md" : `${page}.md`;
  for (const [accept, asksMarkdown] of ACCEPTS) {
    const markdown = asksMarkdown && hasCopy;
    const link = markdown ? undefined : alternateLink(page);
    await check(page, { accept, status: 200, body: markdown ? copy : html, varies: true, link });
    await check(page, { accept, conditional: true, status: 304, varies: true, link });
    await check(
      dotMd,
      hasCopy ? { accept, status: 200, body: copy, link: canonicalLink(page) } : { accept, status: 404, body: MARKDOWN_404 },
    );
    if (hasCopy) await check(dotMd, { accept, conditional: true, status: 304, link: canonicalLink(page) });
    asked += hasCopy ? 4 : 3;
  }
}
for (const address of MISSING) {
  for (const [accept] of ACCEPTS) {
    const md = address.endsWith(".md");
    await check(address, { accept, status: 404, body: md ? MARKDOWN_404 : join(OUT, "404.html"), varies: !md });
    asked++;
  }
}

/** Serves `answer` (a Request to a Response) on a loopback port; resolves to its origin and a close function. */
async function serve(answer) {
  const server = createServer(async (req, res) => {
    const headers = Object.entries(req.headers).filter(([, v]) => typeof v === "string");
    const response = await answer(new Request(new URL(req.url, "http://127.0.0.1"), { method: req.method, headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

const typed = { ASSETS: assets(true) };
const server = await serve((request) => worker.fetch(request, typed));
try {
  const { lines, failures: found } = await checkLiveHeaders(server.origin, OUT);
  if (lines.length !== 6) failures.push(`check-live-headers.mjs made ${lines.length} requests, not 6`);
  failures.push(...found.map((f) => `check-live-headers.mjs, against worker.js: ${f}`));
} finally {
  await server.close();
}

const each = `${seen.markdown} Markdown, ${seen.html} HTML, ${seen.notModified} 304 and ${seen.notFound} 404`;
if (seen.markdown === 0 || seen.html === 0 || seen.notModified === 0 || seen.notFound === 0) {
  failures.push(`the cases did not give each kind of response: ${each}`);
}
if (failures.length > 0) {
  console.error(`${failures.length} failures over ${asked} requests:`);
  for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(
  `${asked} requests to worker.js over ${pages.length} pages, ${ACCEPTS.length} Accept headers and ${MISSING.length} ` +
    `missing addresses (${each}): each response carries exactly the headers out/_headers gives its address, and ` +
    "Vary: Accept wherever the Accept header decides the answer; check-live-headers.mjs finds no difference at the " +
    "Worker's loopback port",
);
