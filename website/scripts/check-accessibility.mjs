#!/usr/bin/env node
// Checks the site against every WCAG 2.0, 2.1 and 2.2 rule of levels A and AA that axe-core holds, in the pinned browser
// (scripts/browser.mjs), and requires that none fails:
// - every page of out/, served with the headers out/_headers gives it (scripts/serve-export.mjs), in the light and the
//   dark theme, at a desktop and a phone width;
// - every Twoslash popup of every page, each opened in turn by a click on its trigger, in both themes at the desktop
//   width;
// - the search dialog, opened from the home page with a query typed, with each of its results selected in turn, in
//   both themes, at both widths.
// Each page is checked to be drawn in the theme asked for, each popup to be shown, and each search state to have the
// result asked for selected, so a run that reached no such state fails. Each failure is listed by address, theme,
// width, rule and element.
//
// It also presses each printable character key alone (U+0021 to U+007E), with the focus on no text field, on a page in
// each theme, and fails when one changes the page: its theme, its address, the focus, what is expanded or open, or its
// scroll (WCAG 2.1.4, which axe-core does not test).
//
// Usage, from website/, after `pnpm run browser` and `pnpm build` there:
//   node scripts/check-accessibility.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import { browserExecutable } from "./browser.mjs";
import { pagesOf, serveExport } from "./serve-export.mjs";

const require = createRequire(import.meta.url);
const axe = require("axe-core");
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
/** axe-core's tags of WCAG 2.0, 2.1 and 2.2 at levels A and AA: wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa. */
const TAGS = [...new Set(axe.getRules().flatMap((rule) => rule.tags))].filter((t) => /^wcag2[12]?a{1,2}$/.test(t)).sort();
const RULES = axe.getRules(TAGS).length;
const SCHEMES = ["light", "dark"];
const WIDTHS = [1280, 390];
/** A query whose results hold pages, headings and text, each with the path of the page it is on. */
const QUERY = "refusal";
const OUT = "out";
/** How many pages are loaded and checked at once, each in a tab of its own. */
const TABS = 4;
/** The width at which every Twoslash popup is opened and the keys are pressed. */
const DESKTOP = 1280;
/** The printable characters, each typed by one key press: "!" to "~". */
const KEYS = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i));
/** The page the keys are pressed on. */
const KEY_PAGE = "/getting-started";

/** axe's failures on the page, or within `include`, each as `rule element (detail)`. */
async function failuresOf(page, include) {
  if (!(await page.evaluate(() => "axe" in window))) await page.evaluate(AXE_SOURCE);
  return page.evaluate(
    async ({ tags, include }) => {
      const result = await window.axe.run(include ? { include: [include] } : document, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations"],
      });
      return result.violations.flatMap((rule) =>
        rule.nodes.map((node) => {
          const ratio = node.any.find((check) => check.data?.contrastRatio)?.data.contrastRatio;
          return `${rule.id} ${node.target.join(" ")}${ratio ? ` (${ratio}:1)` : ""}`;
        }),
      );
    },
    { tags: TAGS, include },
  );
}

/** Opens each distinct Twoslash popup of the loaded page in turn (src/components/TwoslashPopups.tsx) and checks it. */
async function checkPopups(page, address, at) {
  const numbers = await page.evaluate(() => [
    ...new Set([...document.querySelectorAll("button.twoslash-hover")].map((b) => b.dataset.popup ?? "")),
  ]);
  for (const n of numbers) {
    const shown = await page.evaluate(async (n) => {
      const trigger = document.querySelector(`button.twoslash-hover[data-popup="${n}"]`);
      trigger.scrollIntoView({ block: "center" });
      trigger.click();
      const popup = document.getElementById("twoslash-popup");
      for (let i = 0; i < 400; i++) {
        if (popup && !popup.hidden && trigger.getAttribute("aria-expanded") === "true") return true;
        await new Promise((done) => setTimeout(done, 25));
      }
      return false;
    }, n);
    popups++;
    if (!shown) failures.push(`${address}, Twoslash popup ${n} (${at}): not shown by a click on its trigger`);
    else for (const f of await failuresOf(page, "#twoslash-popup")) failures.push(`${address}, Twoslash popup ${n} open (${at}): ${f}`);
  }
}

/**
 * Presses each printable key alone, with the focus on the page's body, and records each that changes the page. After a
 * change the page is loaded again, so each key is pressed on the page as it loads.
 */
async function checkKeys(page, reload, at) {
  const state = () =>
    page.evaluate(() =>
      JSON.stringify({
        class: document.documentElement.getAttribute("class"),
        style: document.documentElement.getAttribute("style"),
        address: location.href,
        focus: document.activeElement === document.body ? "body" : (document.activeElement?.outerHTML.slice(0, 80) ?? "none"),
        expanded: document.querySelectorAll('[aria-expanded="true"]').length,
        open: [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].filter(
          (e) => !e.hidden && e.getClientRects().length > 0,
        ).length,
        scroll: [window.scrollX, window.scrollY],
      }),
    );
  const settle = async () => {
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    return state();
  };
  let before = await settle();
  if (!before.includes('"focus":"body"')) failures.push(`${KEY_PAGE} (${at}): the focus is not on the body before the keys`);
  for (const key of KEYS) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    const after = await state();
    keys++;
    if (after !== before) {
      failures.push(`${KEY_PAGE} (${at}): the key "${key}" pressed alone changes the page: ${before} -> ${after}`);
      await reload();
      before = await settle();
    }
  }
  await page.waitForTimeout(500);
  const last = await state();
  if (last !== before) failures.push(`${KEY_PAGE} (${at}): the page changes after the last key: ${before} -> ${last}`);
}

const pages = pagesOf(OUT);
if (pages.length === 0) {
  console.error(`${OUT} holds no page: run pnpm build in website/ first`);
  process.exit(1);
}
const failures = [];
let selected = 0;
let popups = 0;
let keys = 0;
const server = await serveExport(OUT);
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
try {
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
      const at = `${scheme}, ${width} px`;
      const load = async (page, address) => {
        await page.goto(`${server.origin}${address}`, { waitUntil: "networkidle", timeout: 120_000 });
        await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, scheme === "dark", {
          timeout: 10_000,
        });
      };
      const queue = [...pages];
      await Promise.all(
        Array.from({ length: TABS }, async () => {
          const page = await context.newPage();
          for (let address = queue.shift(); address !== undefined; address = queue.shift()) {
            await load(page, address);
            for (const f of await failuresOf(page)) failures.push(`${address} (${at}): ${f}`);
            if (width === DESKTOP) await checkPopups(page, address, at);
          }
          await page.close();
        }),
      );
      if (width === DESKTOP) {
        const page = await context.newPage();
        await load(page, KEY_PAGE);
        // A key that changed the page may have stored a choice, such as the theme, that the next load would read.
        const reload = async () => {
          await page.evaluate(() => localStorage.clear());
          await load(page, KEY_PAGE);
        };
        await checkKeys(page, reload, at);
        await page.close();
      }

      // The search dialog over the home page, with the query typed, and each result selected in turn by the arrow keys.
      const page = await context.newPage();
      await load(page, "/");
      await page.locator(width < 768 ? "button[data-search]" : "button[data-search-full]").first().click();
      await page.locator('[role="dialog"] input').fill(QUERY);
      await page.locator('[role="dialog"] [role="option"]').first().waitFor({ timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      const options = await page.locator('[role="dialog"] [role="option"]').evaluateAll((all) => all.map((o) => o.id));
      const dialog = `the search dialog for "${QUERY}"`;
      for (const f of await failuresOf(page)) failures.push(`${dialog} (${at}): ${f}`);
      for (const [i, id] of options.entries()) {
        if (i > 0) await page.keyboard.press("ArrowDown");
        const reached = await page
          .waitForFunction(
            (want) => document.querySelector('[role="dialog"] [role="option"][aria-selected="true"]')?.id === want,
            id,
            { timeout: 5_000 },
          )
          .then(
            () => true,
            () => false,
          );
        if (!reached) {
          failures.push(`${dialog} (${at}): result ${i + 1} of ${options.length}, ${id}, is not selected by the arrow keys`);
          break;
        }
        selected++;
        // The whole dialog is checked above; this checks the selected result, whose colours change with the selection.
        for (const f of await failuresOf(page, `[id="${id}"]`)) failures.push(`${dialog}, ${id} selected (${at}): ${f}`);
      }
      if (options.length === 0) failures.push(`${dialog} (${at}): no result`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.log(`${failures.length} failure(s) of axe-core ${axe.version}'s WCAG 2.0, 2.1 and 2.2 A and AA rules:`);
  for (const f of failures.sort()) console.log(`  ${f}`);
  process.exit(1);
}
console.log(
  `${pages.length} pages in the light and the dark theme at ${WIDTHS.join(" and ")} px, ${popups} Twoslash popups opened ` +
    `at ${DESKTOP} px, and the search dialog with each of its results selected (${selected} states): no failure of ` +
    `axe-core ${axe.version}'s ${RULES} rules tagged ${TAGS.join(", ")}; ${keys} single printable key presses change nothing`,
);
