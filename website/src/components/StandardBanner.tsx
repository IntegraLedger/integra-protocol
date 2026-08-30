import { siteConfig } from "@/lib/site";

/**
 * What this site is, and what it is not, on every page.
 *
 * These packages implement a standard that is published somewhere else and stewarded by more
 * than one organization. A reference implementation's documentation is the single easiest
 * thing in the ecosystem to mistake for the specification, and most entrances to a reference
 * site are deep pages arrived at from a search rather than the front door — so the distinction
 * is stated in the persistent chrome rather than once in prose and assumed thereafter.
 */
export function StandardBanner() {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card p-3 text-sm">
      <p className="mb-1 font-medium text-fd-foreground">
        An implementation, not the standard
      </p>
      <p className="text-fd-muted-foreground">
        These packages implement the <strong>{siteConfig.standard.name}</strong>{" "}
        ({siteConfig.standard.short}
        ), co-stewarded by Integra Ledger and AAA-ICDR. The specification is
        published separately.{" "}
        <a
          href={siteConfig.standard.specUrl}
          className="text-fd-primary hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the standard &rarr;
        </a>
      </p>
    </div>
  );
}
