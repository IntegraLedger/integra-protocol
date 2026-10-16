#!/usr/bin/env node
// Writes each exported page's script policy, a step of `pnpm build`: a
// `<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'sha256-…' …">`, placed right after the page's
// `<meta charSet>`, the head's first element, which so stays within the page's first 1,024 bytes, and before every
// script, link and style, naming the SHA-256 of each inline script the page holds.
//
// The browser enforces that policy beside the one public/_headers gives every response, so a script runs only when it
// is one of the site's own files or one of the page's inline scripts, byte for byte. The hashes go in the page because
// a static export carries no nonce, and one page's hashes are longer than a line of _headers may be (Cloudflare takes
// 2,000 characters). The header policy allows the site's scripts and inline scripts, which this policy narrows to the
// hashed ones, and keeps frame-ancestors, which a <meta> policy cannot carry.
//
// It reads a page as the HTML standard's tokenizer does, as far as the pages need: comments, text elements (style,
// title, textarea and the rest), SVG and MathML, and the script types a policy governs. It stops the build, naming the
// page, at what it does not read: a page that is not UTF-8, does not begin `<!DOCTYPE html><html …><head><meta
// charSet="utf-8"/>` or holds another Content-Security-Policy meta element; a script inside SVG, MathML, a template or a
// noscript element; a script whose text holds "<!--" or a NUL, or whose type or language attribute holds a character
// reference; a style, title, textarea or other text element inside SVG or MathML whose text holds "<", which the
// browser reads as markup or as text depending on where it stands.
//
// A page is an .html file under out/ that begins `<!DOCTYPE html>`; the LCP documents written as .html are Markdown and
// are left alone. Writing a page that holds a policy replaces it, so the step gives the same pages however often it runs.
//
// Usage, from website/, after `next build` and scripts/lcp-documents.mjs:
//   node scripts/script-policy.mjs
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const OUT = "out";
/** The page's policy element, as this step writes it. */
const POLICY = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/;
/** The start of a page as Next.js writes it, up to the end of its `<meta charSet>`. */
const START = /^<!DOCTYPE html><html\b[^>]*><head><meta charSet="utf-8"\/>/;

/** The JavaScript MIME type essences (WHATWG MIME Sniffing, "JavaScript MIME type"). */
const JAVASCRIPT_TYPES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/** ASCII lowercase, as the HTML standard compares names and types. */
const lower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Whether an inline script element is one a content policy governs, from its type and language attributes (`null`
 * when absent), as the HTML standard's "prepare the script element" reads them: a classic or a module script, an
 * import map or speculation rules. Any other type is a data block, such as a page's JSON-LD, which the browser
 * neither runs nor checks against a policy.
 */
export function governs(type, language) {
  const string =
    type === "" || (type === null && !language)
      ? "text/javascript"
      : type !== null
        ? type.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "")
        : `text/${language}`;
  const kind = lower(string);
  return JAVASCRIPT_TYPES.has(kind) || kind === "module" || kind === "importmap" || kind === "speculationrules";
}

/** A script's hash as a policy source, over its text as the browser holds it: UTF-8, each CR or CR LF read as LF. */
export function scriptHash(text) {
  return `'sha256-${createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("base64")}'`;
}

const DELIMITER = /[\t\n\f\r />]/;
const SPACE = /[\t\n\f\r ]/;
/** The elements whose content is text up to their end tag (RAWTEXT and RCDATA). */
const TEXT_ELEMENTS = new Set(["style", "xmp", "iframe", "noembed", "noframes", "textarea", "title"]);

/** The index of the end tag `</name` that closes a text element's content from `from`, or the page's end. */
function endTag(html, name, from) {
  const re = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi");
  re.lastIndex = from;
  return re.exec(html)?.index ?? html.length;
}

/** A tag's attributes, from the end of its name: the index past its `>`, the attributes and whether it ends in `/>`. */
function attributes(html, at) {
  const found = new Map();
  let i = at;
  let selfClosing = false;
  for (;;) {
    while (i < html.length && (SPACE.test(html[i]) || html[i] === "/")) selfClosing = html[i++] === "/";
    if (i >= html.length) return undefined;
    if (html[i] === ">") return { end: i + 1, attrs: found, selfClosing };
    selfClosing = false;
    let j = i + 1;
    while (j < html.length && !/[\t\n\f\r />=]/.test(html[j])) j++;
    const name = lower(html.slice(i, j));
    i = j;
    while (i < html.length && SPACE.test(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < html.length && SPACE.test(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return undefined;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        let k = i;
        while (k < html.length && !/[\t\n\f\r >]/.test(html[k])) k++;
        value = html.slice(i, k);
        i = k;
      }
    }
    if (!found.has(name)) found.set(name, value);
  }
}

/**
 * Reads a page that holds no script policy: where its policy goes (right after its `<meta charSet>`) and the text of
 * each inline script a policy governs, in the page's order. Throws, naming the page, at what it does not read (above).
 */
export function readPage(html, page) {
  const fail = (what) => {
    throw new Error(`${page} ${what}, which scripts/script-policy.mjs does not read`);
  };
  const start = START.exec(html);
  if (!start) fail('does not begin <!DOCTYPE html><html …><head><meta charSet="utf-8"/>');
  const scripts = [];
  let foreign = 0;
  let template = 0;
  let i = 0;
  while (i < html.length) {
    i = html.indexOf("<", i);
    if (i < 0) break;
    if (html.startsWith("<!--", i)) {
      // A comment ends at "-->" or "--!>"; "<!-->" and "<!--->" end where they stand.
      if (html.startsWith(">", i + 4)) i += 5;
      else if (html.startsWith("->", i + 4)) i += 6;
      else {
        const close = /--!?>/g;
        close.lastIndex = i + 4;
        const found = close.exec(html);
        i = found ? found.index + found[0].length : html.length;
      }
      continue;
    }
    if (foreign > 0 && html.startsWith("<![CDATA[", i)) {
      const close = html.indexOf("]]>", i + 9);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const close = html.indexOf(">", i + 2);
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    const isEnd = html[i + 1] === "/";
    const nameAt = i + (isEnd ? 2 : 1);
    if (!/[A-Za-z]/.test(html[nameAt] ?? "")) {
      if (!isEnd) i++;
      else if (html[nameAt] === ">") i = nameAt + 1;
      else {
        const close = html.indexOf(">", nameAt);
        i = close < 0 ? html.length : close + 1;
      }
      continue;
    }
    let n = nameAt;
    while (n < html.length && !DELIMITER.test(html[n])) n++;
    const name = lower(html.slice(nameAt, n));
    const tag = attributes(html, n);
    if (!tag) fail(`has a <${name}> tag that does not end`);
    i = tag.end;
    if (isEnd) {
      if (name === "svg" || name === "math") foreign = Math.max(0, foreign - 1);
      if (name === "template") template = Math.max(0, template - 1);
      continue;
    }
    if (name === "script") {
      if (foreign > 0) fail("has a script inside SVG or MathML");
      if (template > 0) fail("has a script inside a template element");
      const close = endTag(html, "script", tag.end);
      const text = html.slice(tag.end, close);
      if (text.includes("<!--")) fail('has a script whose text holds "<!--"');
      if (text.includes("\0")) fail("has a script whose text holds a NUL character");
      i = close;
      if (tag.attrs.has("src")) continue;
      const type = tag.attrs.get("type") ?? null;
      const language = tag.attrs.get("language") ?? null;
      if (`${type ?? ""}${language ?? ""}`.includes("&")) fail("has a script whose type or language holds a character reference");
      if (governs(type, language)) scripts.push(text);
      continue;
    }
    if (foreign > 0 && (TEXT_ELEMENTS.has(name) || name === "noscript" || name === "plaintext")) {
      // Inside SVG or MathML such an element holds markup, but past an element that ends foreign content, or inside
      // foreignObject or an SVG title, the browser reads its content as text. With no "<" in it, the two readings agree.
      const text = html.slice(tag.end, endTag(html, name, tag.end));
      if (name === "plaintext" || text.includes("<")) fail(`has a <${name}> inside SVG or MathML whose text holds "<"`);
    }
    if (name === "svg" || name === "math") {
      if (!tag.selfClosing) foreign++;
      continue;
    }
    if (foreign > 0) continue;
    if (name === "meta" && lower(tag.attrs.get("http-equiv") ?? "") === "content-security-policy") {
      fail("holds a Content-Security-Policy meta element");
    } else if (name === "template") {
      template++;
    } else if (name === "noscript") {
      const close = endTag(html, "noscript", tag.end);
      if (/<script/i.test(html.slice(tag.end, close))) fail("has a script inside a noscript element");
      i = close;
    } else if (name === "plaintext") {
      break;
    } else if (TEXT_ELEMENTS.has(name)) {
      i = endTag(html, name, tag.end);
    }
  }
  return { at: start[0].length, scripts };
}

/** A page with its script policy written in, in place of the one it holds. */
export function withPolicy(html, page) {
  const bare = html.replace(POLICY, "");
  const { at, scripts } = readPage(bare, page);
  const policy = ["script-src 'self'", ...new Set(scripts.map(scriptHash))].join(" ");
  return { html: `${bare.slice(0, at)}<meta http-equiv="Content-Security-Policy" content="${policy}"/>${bare.slice(at)}`, scripts };
}

/** Every .html file under a folder. */
function htmlFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

if (import.meta.main) {
  let pages = 0;
  let count = 0;
  for (const file of htmlFiles(OUT)) {
    const bytes = readFileSync(file);
    const read = bytes.toString("utf8");
    if (!read.startsWith("<!DOCTYPE html>")) continue;
    const page = relative(OUT, file);
    if (!Buffer.from(read, "utf8").equals(bytes)) throw new Error(`${page} is not UTF-8, which scripts/script-policy.mjs does not read`);
    const { html, scripts } = withPolicy(read, page);
    writeFileSync(file, html);
    pages++;
    count += scripts.length;
  }
  if (pages === 0) throw new Error(`${OUT} holds no page: run next build first`);
  console.log(`wrote the script policy of ${pages} pages in ${OUT}, hashing their ${count} inline scripts`);
}
