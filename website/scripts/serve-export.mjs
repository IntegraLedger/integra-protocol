// Serves the exported site, website/out, on a loopback port, as Cloudflare's static assets serve it (wrangler.toml), for
// the checks that load its pages in the pinned browser:
// - `/` is index.html, `/<page>` is <page>.html, and any other address is the file at that path;
// - an address with no file is answered 404 with 404.html (`not_found_handling = "404-page"`);
// - each response carries the headers of every rule of out/_headers whose path matches its address, in the file's
//   order, a rule's Content-Type replacing the one the file's extension gives.
// worker.js is not run: it answers only a request that asks for Markdown, and a browser loading a page asks for HTML.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

/** The rules of a `_headers` file, in order: each path pattern, as a regular expression, and its headers. */
export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const pattern = line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
      rules.push({ path: line.trim(), match: new RegExp(`^${pattern}$`), headers: [] });
    } else if (rules.length > 0) {
      const colon = line.indexOf(":");
      rules.at(-1).headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
    }
  }
  return rules;
}

/** The headers the rules give an address: a header named by more than one rule takes their values joined by commas. */
export function headersFor(rules, address) {
  const headers = {};
  for (const rule of rules) {
    if (!rule.match.test(address)) continue;
    for (const [name, value] of rule.headers) headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  return headers;
}

/** The file that serves an address, or undefined. */
function fileFor(outDir, address) {
  const path = resolve(outDir, `.${decodeURIComponent(address)}`);
  if (path !== outDir && !path.startsWith(outDir + sep)) return undefined;
  const candidates = address === "/" ? [join(outDir, "index.html")] : [path, `${path}.html`, join(path, "index.html")];
  return candidates.find((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

/** The address of each page of the export: an .html file whose address the headers serve as HTML. */
export function pagesOf(outDir) {
  const rules = parseHeaders(readFileSync(join(outDir, "_headers"), "utf8"));
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => {
      const path = relative(outDir, join(e.parentPath, e.name)).split(sep).join("/");
      return path === "index.html" ? "/" : `/${path.slice(0, -".html".length)}`;
    })
    .filter((address) => (headersFor(rules, address)["content-type"] ?? "text/html").startsWith("text/html"))
    .sort();
}

/**
 * Starts the server on 127.0.0.1 and a port the system picks. `extra` maps an address the export does not hold to the
 * HTML it is answered with, under the headers out/_headers gives that address. Resolves to the origin and a close
 * function.
 */
export async function serveExport(outDir, extra = {}) {
  const out = resolve(outDir);
  const rules = parseHeaders(readFileSync(join(out, "_headers"), "utf8"));
  const server = createServer((request, response) => {
    const address = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    let status = 200;
    let body;
    let type;
    if (Object.hasOwn(extra, address)) {
      body = Buffer.from(extra[address]);
      type = TYPES[".html"];
    } else {
      let file = fileFor(out, address);
      if (file === undefined) {
        status = 404;
        file = join(out, "404.html");
      }
      body = readFileSync(file);
      type = TYPES[extname(file)] ?? "application/octet-stream";
    }
    const headers = { "content-type": type, ...headersFor(rules, address) };
    response.writeHead(status, headers);
    response.end(request.method === "HEAD" ? undefined : body);
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
