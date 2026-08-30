import type { MetadataRoute } from "next";
import { packageForUrl } from "@/lib/packages";
import { absoluteUrl, siteConfig } from "@/lib/site";
import { source } from "@/lib/source";

// Required for metadata route handlers under `output: export`.
export const dynamic = "force-static";

/**
 * Generated from the live route tree, so the sitemap can never drift from the pages that
 * actually exist. `lastModified` is the last commit that changed each page's source — for a
 * package page, the README it renders — and not the build clock; a sitemap that dates every
 * URL "now" on every deploy tells a crawler nothing.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages().filter((page) => page.url !== "/");

  const docs = pages.map((page) => ({
    url: absoluteUrl(page.url),
    lastModified: page.data.lastModified,
    changeFrequency: "monthly" as const,
    // The seven core packages are the entry points a reader needs first; the twenty-four
    // rails and placements are looked up once a reader knows which one they are on.
    priority: packageForUrl(page.url)?.group === "core" ? 0.9 : 0.8,
  }));

  // The overview changes whenever any page does: date it by the newest commit.
  const newest = pages
    .map((page) => page.data.lastModified)
    .filter((d): d is Date => d instanceof Date)
    .reduce<Date | undefined>(
      (acc, d) => (acc === undefined || d > acc ? d : acc),
      undefined,
    );

  const home: MetadataRoute.Sitemap[number] = {
    // No trailing slash — matches the rel=canonical Next emits for "/".
    url: siteConfig.url,
    lastModified: newest,
    changeFrequency: "weekly",
    priority: 1.0,
  };

  return [home, ...docs];
}
