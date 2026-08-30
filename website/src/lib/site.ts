/**
 * Single source of truth for site-wide identity, canonical URL, and SEO/LLM
 * metadata. Every absolute URL, canonical tag, sitemap entry, robots directive,
 * and JSON-LD block derives from here — never hardcode the domain elsewhere.
 *
 * Imported by client components too, so nothing here may touch Node APIs; the
 * package set and its version, which need the filesystem, live in `packages.ts`
 * and `version.ts`.
 */

export const siteConfig = {
  /**
   * Canonical production origin.
   *
   * PLACEHOLDER. The subdomain for this site is not decided; `docs.` and `protocol.` are both
   * plausible. Changing it is this one line — nothing else in the site states a host — but it
   * must not be attached until it is ruled, and `CANONICAL_HOST_ATTACHED` in wrangler.toml
   * stays "false" until whichever host is chosen answers.
   *
   * It also may not live under `integraledger.com/lcp/*`: those paths are held at the zone by
   * another service, and no deploy of this site can reach them.
   */
  url: "https://docs.integraledger.com",
  name: "Integra LCP Packages",
  shortName: "LCP Packages",
  /** ~60 chars: brand front-loaded, no word repetition, keyword-rich. */
  title: "Integra LCP Packages — Legal Context Protocol, Implemented",
  titleTemplate: "%s | Integra LCP Packages",
  /** ≤155 chars so search results show the whole claim; leads with the value proposition. */
  description:
    "Reference implementation of the Legal Context Protocol's open layer: 31 Apache-2.0 packages for ATR hashing, the verification walk, bindings and placements.",
  keywords: [
    "Legal Context Protocol",
    "LCP",
    "reference implementation",
    "agentic commerce",
    "atrHash",
    "ATR",
    "Agentic Transaction Record",
    "settlement binding",
    "placement",
    "conformance corpus",
    "verification walk",
    "delegated authority",
    "x402",
    "ACP",
    "AP2",
    "MPP",
    "TypeScript",
  ],
  github: {
    owner: "IntegraLedger",
    repo: "integra-protocol",
  },
  githubUrl: "https://github.com/IntegraLedger/integra-protocol",
  /** The npm scope every package on this site publishes under. */
  npmScope: "@integraledger",
  /**
   * The standard these packages implement.
   *
   * This site documents an IMPLEMENTATION, not the specification. LCP is co-stewarded by
   * Integra Ledger and AAA-ICDR and published elsewhere; the distinction is stated in the
   * persistent chrome rather than once in prose, because most entrances to a reference site
   * are deep pages rather than its front door.
   */
  standard: {
    name: "Legal Context Protocol",
    short: "LCP",
    url: "https://legalcontextprotocol.org",
    specUrl: "https://legalcontextprotocol.org/standard",
  },
  // Next's app/opengraph-image.tsx file convention emits this extensionless
  // route (referenced from JSON-LD and from every docs page's own metadata).
  ogImage: "/opengraph-image",
  ogImageAlt:
    "Integra LCP Packages — the Legal Context Protocol reference implementation",
  locale: "en_US",
  publisher: {
    name: "Integra Ledger",
    url: "https://www.integraledger.com",
  },
} as const;

/** Build an absolute URL on the canonical origin from a root-relative path. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteConfig.url).toString();
}

/** A file in the repository, on `main`, as a browsable GitHub URL. */
export function repoFile(path: string): string {
  return `${siteConfig.githubUrl}/blob/main/${path}`;
}

/** A directory in the repository, on `main`, as a browsable GitHub URL. */
export function repoTree(path: string): string {
  return `${siteConfig.githubUrl}/tree/main/${path}`;
}

/** The npm page for a published package. */
export function npmUrl(packageName: string): string {
  return `https://www.npmjs.com/package/${packageName}`;
}

/** Organization JSON-LD — resolves "who publishes these packages". */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteConfig.url}/#organization`,
    name: siteConfig.publisher.name,
    url: siteConfig.publisher.url,
    logo: absoluteUrl("/icon.svg"),
    description:
      "Integra Ledger builds the record infrastructure for agentic commerce and co-stewards the Legal Context Protocol.",
    sameAs: [siteConfig.githubUrl],
  };
}

/** WebSite JSON-LD — establishes the canonical site entity. */
export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteConfig.url}/#website`,
    name: siteConfig.name,
    alternateName: siteConfig.shortName,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en",
    publisher: { "@id": `${siteConfig.url}/#organization` },
    license: "https://www.apache.org/licenses/LICENSE-2.0",
  };
}

/**
 * SoftwareSourceCode JSON-LD for one published package. Emitted on that package's own page
 * rather than site-wide: thirty-one blocks in the head of every page would be noise, and the
 * question "what do I install" is answered per package here.
 */
export function softwareJsonLd(pkg: {
  name: string;
  description: string;
  version: string;
  directory: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    "@id": `${siteConfig.url}/#${pkg.name}`,
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    codeRepository: repoTree(pkg.directory),
    programmingLanguage: "TypeScript",
    runtimePlatform: "Node.js",
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    isPartOf: { "@id": `${siteConfig.url}/#website` },
    publisher: { "@id": `${siteConfig.url}/#organization` },
  };
}

/** BreadcrumbList JSON-LD for a docs page given its labeled path segments. */
export function breadcrumbJsonLd(
  crumbs: Array<{ name: string; path: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: absoluteUrl(c.path),
    })),
  };
}
