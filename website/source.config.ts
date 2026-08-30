import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { publicPackages, repoRoot } from "./scripts/public-packages.mjs";

/**
 * Last-commit dates for every path in the repository, from one `git log`.
 *
 * A shallow clone has no history to read and yields an empty map, which is why the CI job
 * checks out with `fetch-depth: 0`. Every page would otherwise silently date to the build.
 */
let gitDates: Map<string, Date> | undefined;
function lastCommitDates(): Map<string, Date> {
  if (gitDates) return gitDates;
  const dates = new Map<string, Date>();
  const log = execFileSync(
    "git",
    ["-c", "core.quotepath=off", "log", "--format=commit:%aI", "--name-only"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  let date: Date | undefined;
  for (const line of log.split("\n")) {
    if (line.startsWith("commit:")) {
      const parsed = new Date(line.slice(7));
      date = Number.isNaN(parsed.getTime()) ? undefined : parsed;
    } else if (line.length > 0 && date && !dates.has(line)) {
      dates.set(line, date);
    }
  }
  gitDates = dates;
  return dates;
}

/**
 * Absolute path of a generated page -> the tracked file it actually renders.
 *
 * fumadocs hands `lastModified` an ABSOLUTE path. Keying this map on anything else silently
 * matches nothing, every page loses its date, and the build stays green — which is what
 * happened the first time this was written. `scripts/check-export.mjs` asserts the sitemap
 * carries a `<lastmod>` for every URL so a miss cannot pass as a pass again.
 */
const pageSource = new Map(
  publicPackages().map((pkg) => [
    join(process.cwd(), "content", "docs", "packages", `${pkg.dir}.md`),
    pkg.readmePath,
  ]),
);

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      // Exposes each page as processed Markdown (`getText("processed")`), which is what
      // `/llms-full.txt` serves — the same source the HTML is rendered from, never a copy.
      // Heading IDs are an HTML-anchor concern; in plain Markdown they are noise.
      includeProcessedMarkdown: { headingIds: false },
    },

    /**
     * Each page's last-modified time, so the sitemap's `<lastmod>` and the "last updated" line
     * state the commit that changed the page rather than the build clock.
     *
     * NOT `fumadocs-mdx/plugins/last-modified`, and the difference is the whole point on this
     * site. That plugin dates a page by the history of its own file. Thirty-one of the
     * thirty-two pages here are generated into a gitignored directory before every build, so
     * their own files have no history at all — the plugin would return `undefined` for each and
     * the sitemap would carry a `<lastmod>` for exactly one URL, with nothing to show that the
     * other thirty-one had silently lost theirs. A package page is dated by the README it
     * renders, which is the file whose changes actually change the page.
     */
    lastModified: async (filePath: string) => {
      const tracked = pageSource.get(filePath) ?? relative(repoRoot, filePath);
      return lastCommitDates().get(tracked);
    },
  },
});

export default defineConfig();
