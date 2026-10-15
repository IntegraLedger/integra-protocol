#!/usr/bin/env node
// Checks the content policies the site serves in the pinned browser (scripts/browser.mjs): the one public/_headers
// gives every response (the build copies it to out/_headers), and each page's script policy, which
// scripts/script-policy.mjs writes into the page:
// - every page of out/, served with the headers out/_headers gives it (scripts/serve-export.mjs), loads in the light
//   and the dark theme, at a desktop and a phone width, with no content policy violation, its own inline scripts run,
//   and its first Twoslash popup opened where it has one; and over the home page, the search dialog opens with a query
//   typed, a sidebar link moves to its page in place, and the theme switch changes the theme, each with no violation;
// - on every page so loaded, an inline script added to it, which its script policy does not hash, is refused;
// - an SVG document holding an inline script, served at an address that is not a page under the headers out/_headers
//   gives it, has the script refused, and the site's own SVG icon, opened as a document, loads with no violation;
// - every page is served with `frame-ancestors 'none'` and `X-Frame-Options: DENY`, so no origin shows it in a frame,
//   and holds no <base> or <form> element;
// - a page served under the same headers that loads a data: image and a data: font, starts a blob: worker and sets a
//   <base> has each refused, and a page that submits a form has the submission refused, so the policy allows none of
//   those, and a page that needed one would fail the first check.
// Each violation is listed by address, theme, directive and blocked address.
//
// Usage, from website/, after `pnpm run browser` and `pnpm build` there:
//   node scripts/check-headers.mjs
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { pagesOf, serveExport } from "./serve-export.mjs";

const OUT = "out";
const SCHEMES = ["light", "dark"];
const WIDTHS = [1280, 390];
const QUERY = "refusal";
/** How many pages are loaded at once, each in a tab of its own. */
const TABS = 4;
/** The address of the page that uses each source the policy refuses; the export holds no page there. */
const REFUSED = "/check-headers-refused";
const REFUSED_PAGE = `<!doctype html>
<html lang="en"><head><title>Refused sources</title><base href="/check-headers-base/">
<style>@font-face { font-family: refused; src: url(data:font/woff2;base64,d09GMgABAAAAAA) format("woff2"); }
body { font-family: refused, sans-serif; }</style></head>
<body><p>Refused sources</p>
<img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
<script>try { new Worker(URL.createObjectURL(new Blob([""], { type: "text/javascript" }))); } catch {}</script>
</body></html>
`;
/** The directives the page above violates, one for each source it uses. */
const REFUSED_DIRECTIVES = ["base-uri", "font-src", "img-src", "worker-src"];
/** The address of a page with a form to the home page, which the check submits and the policy refuses. */
const REFUSED_FORM = "/check-headers-refused-form";
const REFUSED_FORM_PAGE = `<!doctype html>
<html lang="en"><head><title>Refused form</title></head>
<body><form action="/" method="get"><input name="q" value="x"></form></body></html>
`;

const pages = pagesOf(OUT);
if (pages.length === 0) {
  console.error(`${OUT} holds no page: run pnpm build in website/ first`);
  process.exit(1);
}
const failures = [];
let loads = 0;
let popups = 0;
let planted = 0;
let interactions = 0;
/** The address of an SVG document holding an inline script; like every file that is not a page, its script is refused. */
const REFUSED_SVG = "/check-headers-refused.svg";
const REFUSED_SVG_FILE = {
  type: "image/svg+xml",
  body: '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svgScript = true;</script></svg>',
};
/** A file of the site that is not a page, opened as a document. */
const ICON = "/icon.svg";
const server = await serveExport(OUT, {
  [REFUSED]: REFUSED_PAGE,
  [REFUSED_FORM]: REFUSED_FORM_PAGE,
  [REFUSED_SVG]: REFUSED_SVG_FILE,
});
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
try {
  for (const [width, scheme] of WIDTHS.flatMap((w) => SCHEMES.map((s) => [w, s]))) {
    const at = `${scheme}, ${width} px`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    // Each violation the page reports, as `directive blocked-address`.
    await context.addInitScript(() => {
      window.__violations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.__violations.push(`${e.effectiveDirective} ${e.blockedURI || "inline"}`),
      );
    });
    /** A tab, and a function that loads an address in it, runs `act`, and gives the violations reported there. */
    const tab = async () => {
      const page = await context.newPage();
      // A violation Chrome reports only to the console, such as one in a worker, is counted too.
      const logged = [];
      page.on("console", (m) => /Content.Security.Policy/i.test(m.text()) && logged.push(m.text()));
      const visit = async (address, act) => {
        logged.length = 0;
        const response = await page.goto(`${server.origin}${address}`, { waitUntil: "networkidle", timeout: 120_000 });
        await act?.();
        await page.waitForTimeout(300);
        const seen = await page.evaluate(() => window.__violations);
        // A console message names the whole policy, which can be thousands of characters long: its start is kept.
        return { response, violations: [...seen, ...logged.map((t) => `console: ${t.slice(0, 160)}`)] };
      };
      return { page, visit };
    };

    const queue = [...pages];
    await Promise.all(
      Array.from({ length: TABS }, async () => {
        const { page, visit } = await tab();
        for (let address = queue.shift(); address !== undefined; address = queue.shift()) {
          const { response, violations } = await visit(address, async () => {
            const trigger = page.locator("button.twoslash-hover").first();
            if ((await trigger.count()) === 0) return;
            await trigger.click();
            await page.locator(".twoslash-popover").first().waitFor({ timeout: 30_000 });
            await page.waitForLoadState("networkidle");
            popups++;
          });
          loads++;
          for (const v of violations) failures.push(`${address} (${at}): ${v}`);
          // The page's own inline scripts ran: Next.js's payload scripts fill self.__next_f, and the theme script sets
          // the theme's class.
          const ran = await page.evaluate(
            (scheme) => Array.isArray(self.__next_f) && document.documentElement.classList.contains(scheme),
            scheme,
          );
          if (!ran) failures.push(`${address} (${at}): its inline scripts did not run`);
          // An inline script its policy does not hash is refused.
          const plant = await page.evaluate(async () => {
            const before = window.__violations.length;
            const script = document.createElement("script");
            script.textContent = "window.__planted = true;";
            document.head.append(script);
            await new Promise((done) => setTimeout(done, 100));
            return { ran: window.__planted === true, refused: window.__violations.slice(before).some((v) => v.startsWith("script-src")) };
          });
          planted++;
          if (plant.ran || !plant.refused) failures.push(`${address} (${at}): an inline script its policy does not hash ran`);
          const headers = (await response?.allHeaders()) ?? {};
          if (!/(^|;)\s*frame-ancestors 'none'\s*(;|$)/.test(headers["content-security-policy"] ?? "")) {
            failures.push(`${address} (${at}): its content policy does not hold frame-ancestors 'none'`);
          }
          if (headers["x-frame-options"] !== "DENY") failures.push(`${address} (${at}): X-Frame-Options is not DENY`);
          const refusedElements = await page.evaluate(() => [...document.querySelectorAll("base, form")].map((e) => e.localName));
          if (refusedElements.length > 0) {
            failures.push(`${address} (${at}): holds ${refusedElements.join(", ")}, which base-uri or form-action refuses`);
          }
        }
        await page.close();
      }),
    );

    const { page, visit } = await tab();
    const search = await visit("/", async () => {
      await page.locator(width < 768 ? "button[data-search]" : "button[data-search-full]").first().click();
      await page.locator('[role="dialog"] input').fill(QUERY);
      await page.locator('[role="dialog"] [role="option"]').first().waitFor({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    });
    for (const v of search.violations) failures.push(`the search dialog for "${QUERY}" (${at}): ${v}`);

    // A sidebar link, followed in place by the client's router, and the theme switch, at the desktop width, where both
    // show without a menu.
    if (width >= 768) {
      let to;
      const moved = await visit("/", async () => {
        const link = page.locator('#nd-sidebar a[href^="/"]:not([href="/"]):visible').first();
        to = await link.getAttribute("href");
        await page.evaluate(() => {
          window.__sameDocument = true;
        });
        await link.click();
        await page.waitForURL((url) => url.pathname === to, { timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        if (!(await page.evaluate(() => window.__sameDocument === true))) {
          failures.push(`/ (${at}): the sidebar link to ${to} loads a new document, not the page in place`);
        }
        const before = await page.evaluate(() => document.documentElement.className);
        await page.locator("button[data-theme-toggle]:visible").first().click();
        await page.waitForFunction((b) => document.documentElement.className !== b, before, { timeout: 10_000 });
      });
      interactions++;
      for (const v of moved.violations) failures.push(`/ (${at}), the sidebar link to ${to} and the theme switch: ${v}`);
    }

    const refused = await visit(REFUSED, () => page.waitForTimeout(700));
    for (const directive of REFUSED_DIRECTIVES) {
      if (!refused.violations.some((v) => v.startsWith(`${directive} `))) {
        failures.push(`${REFUSED} (${at}): the policy allows what ${directive} would refuse`);
      }
    }
    const form = await visit(REFUSED_FORM, async () => {
      await page.evaluate(() => document.forms[0].requestSubmit());
      await page.waitForLoadState("networkidle");
    });
    if (new URL(page.url()).pathname !== REFUSED_FORM || !form.violations.some((v) => v.startsWith("form-action "))) {
      failures.push(`${REFUSED_FORM} (${at}): the policy allows a form's submission, which form-action would refuse`);
    }
    const svg = await visit(REFUSED_SVG);
    const svgRan = await page.evaluate(() => window.__svgScript === true);
    if (svgRan || !svg.violations.some((v) => v.startsWith("script-src"))) {
      failures.push(`${REFUSED_SVG} (${at}): an inline script in a file that is not a page is not refused`);
    }
    for (const v of (await visit(ICON)).violations) failures.push(`${ICON} (${at}): ${v}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.log(`${failures.length} failure(s) of the content policies of out/:`);
  for (const f of failures.sort()) console.log(`  ${f}`);
  process.exit(1);
}
console.log(
  `${pages.length} pages in the light and the dark theme at ${WIDTHS.join(" and ")} px (${loads} loads, ${popups} with a ` +
    `Twoslash popup open), the search dialog, ${interactions} sidebar moves and theme switches load with no content ` +
    `policy violation and their inline scripts run, ` +
    `each page under frame-ancestors 'none' and X-Frame-Options DENY and with no <base> or <form>; an inline script ` +
    `the page's policy does not hash is refused on each of the ${planted} loads; a data: image, a data: font, a blob: ` +
    `worker, a <base> and a form's submission are each refused, and so is an inline script in an SVG document that ` +
    `is not a page; ${ICON} loads as a document with no violation`,
);
