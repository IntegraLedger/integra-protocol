// The rules of a `_headers` file, and the headers they give an address, as Cloudflare's static assets apply them
// (https://developers.cloudflare.com/workers/static-assets/headers/). worker.js gives each response it returns these
// headers, and scripts/serve-export.mjs, scripts/check-script-policy.mjs, scripts/check-worker-headers.mjs and
// scripts/check-live-headers.mjs read the rules here, so the Worker and the checks match an address one way.
//
// A rule is a path, which may hold one splat (`*`, any characters), and the headers on the indented lines below it. A
// form this reader does not match as Cloudflare does is refused, naming the line: a detach (`! Name`), whose order
// against the rules that set the header the page does not give; a placeholder (`:name`); a second splat, which the page
// does not allow; and a rule for an absolute URL. This file runs in the Worker too, so it imports nothing.

/** The rules of a `_headers` file, in order: each path, and its headers as [lowercase name, value] pairs. */
export function parseHeaders(text) {
  const rules = [];
  text.split("\n").forEach((line, i) => {
    const refuse = (why) => {
      throw new Error(`_headers line ${i + 1} ${why}, which headers.mjs does not match: ${line.trim()}`);
    };
    if (line.trim() === "" || line.trimStart().startsWith("#")) return;
    if (!/^\s/.test(line)) {
      const path = line.trim();
      if (!path.startsWith("/")) refuse("is a rule for an absolute URL");
      if (/:[A-Za-z]/.test(path)) refuse("holds a placeholder");
      if (path.split("*").length > 2) refuse("holds more than one splat");
      rules.push({ path, headers: [] });
    } else {
      if (rules.length === 0) refuse("is a header before any path");
      if (line.trimStart().startsWith("!")) refuse("detaches a header");
      const colon = line.indexOf(":");
      if (colon === -1) refuse("is a header line without a colon");
      rules.at(-1).headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
    }
  });
  return rules;
}

/** Whether a rule's path matches an address: the splat matches any characters, and every other character itself. */
export function matches(path, address) {
  const star = path.indexOf("*");
  if (star === -1) return path === address;
  const head = path.slice(0, star);
  const tail = path.slice(star + 1);
  return address.length >= head.length + tail.length && address.startsWith(head) && address.endsWith(tail);
}

/**
 * The headers the rules give an address, by lowercase name: every rule whose path matches applies, in the file's order,
 * and a header that two rules set takes both values joined by a comma.
 */
export function headersFor(rules, address) {
  const headers = {};
  for (const rule of rules) {
    if (!matches(rule.path, address)) continue;
    for (const [name, value] of rule.headers) headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  return headers;
}
