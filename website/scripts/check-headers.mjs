#!/usr/bin/env node
// Checks the content policy the site serves (public/_headers, which the build copies to out/_headers) in the pinned
// browser (scripts/browser.mjs):
// - every page of out/, served with the headers out/_headers gives it (scripts/serve-export.mjs), loads in the light
//   and the dark theme with no content policy violation, with its first Twoslash popup opened where it has one, and
//   the search dialog opened with a query typed over the home page;
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
const server = await serveExport(OUT, { [REFUSED]: REFUSED_PAGE, [REFUSED_FORM]: REFUSED_FORM_PAGE });
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
try {
  for (const scheme of SCHEMES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
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
        return { response, violations: [...seen, ...logged.map((t) => `console: ${t}`)] };
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
          for (const v of violations) failures.push(`${address} (${scheme}): ${v}`);
          const headers = (await response?.allHeaders()) ?? {};
          if (!/(^|;)\s*frame-ancestors 'none'\s*(;|$)/.test(headers["content-security-policy"] ?? "")) {
            failures.push(`${address} (${scheme}): its content policy does not hold frame-ancestors 'none'`);
          }
          if (headers["x-frame-options"] !== "DENY") failures.push(`${address} (${scheme}): X-Frame-Options is not DENY`);
          const refusedElements = await page.evaluate(() => [...document.querySelectorAll("base, form")].map((e) => e.localName));
          if (refusedElements.length > 0) {
            failures.push(`${address} (${scheme}): holds ${refusedElements.join(", ")}, which base-uri or form-action refuses`);
          }
        }
        await page.close();
      }),
    );

    const { page, visit } = await tab();
    const search = await visit("/", async () => {
      await page.locator("button[data-search-full]").first().click();
      await page.locator('[role="dialog"] input').fill(QUERY);
      await page.locator('[role="dialog"] [role="option"]').first().waitFor({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    });
    for (const v of search.violations) failures.push(`the search dialog for "${QUERY}" (${scheme}): ${v}`);

    const refused = await visit(REFUSED, () => page.waitForTimeout(700));
    for (const directive of REFUSED_DIRECTIVES) {
      if (!refused.violations.some((v) => v.startsWith(`${directive} `))) {
        failures.push(`${REFUSED} (${scheme}): the policy allows what ${directive} would refuse`);
      }
    }
    const form = await visit(REFUSED_FORM, async () => {
      await page.evaluate(() => document.forms[0].requestSubmit());
      await page.waitForLoadState("networkidle");
    });
    if (new URL(page.url()).pathname !== REFUSED_FORM || !form.violations.some((v) => v.startsWith("form-action "))) {
      failures.push(`${REFUSED_FORM} (${scheme}): the policy allows a form's submission, which form-action would refuse`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.log(`${failures.length} failure(s) of the content policy in out/_headers:`);
  for (const f of failures.sort()) console.log(`  ${f}`);
  process.exit(1);
}
console.log(
  `${pages.length} pages in the light and the dark theme (${loads} loads, ${popups} with a Twoslash popup open) and the ` +
    `search dialog load with no content policy violation, each page under frame-ancestors 'none' and X-Frame-Options ` +
    `DENY and with no <base> or <form>; a data: image, a data: font, a blob: worker, a <base> and a form's submission ` +
    `are each refused`,
);
