/**
 * Site identity, canonical origin and the structured-data helpers built from them. Every
 * absolute URL the site emits is derived from `siteConfig.url`.
 *
 * Imported by client components too, so nothing here touches Node APIs.
 */

import { DOCS_DIR } from "@/lib/docs-dir";

export const siteConfig = {
  url: "https://lcp.integraledger.com",
  name: "Integra Protocol",
  title: "Integra Protocol: the Legal Context Protocol reference implementation",
  titleTemplate: "%s | Integra Protocol",
  description:
    "The Legal Context Protocol's reference implementation: assemble an Agentic Transaction Record (ATR), hash its exact bytes, and bind the hash into x402, MPP and agentic checkout payments.",
  keywords: [
    "Legal Context Protocol",
    "LCP",
    "Agentic Transaction Record",
    "ATR",
    "ATR hash",
    "agentic payments",
    "x402",
    "MPP",
    "agentic checkout",
  ],
  github: {
    owner: "IntegraLedger",
    repo: "integra-protocol",
  },
  githubUrl: "https://github.com/IntegraLedger/integra-protocol",
  securityUrl: "https://github.com/IntegraLedger/integra-protocol/security/advisories/new",
  package: {
    name: "@integraledger/lcp",
    npm: "https://www.npmjs.com/package/@integraledger/lcp",
  },
  license: {
    name: "Apache-2.0",
    url: "https://www.apache.org/licenses/LICENSE-2.0",
  },
  ogImage: "/opengraph-image",
  ogImageAlt: "Integra Protocol: the Legal Context Protocol reference implementation",
  locale: "en_US",
  publisher: {
    name: "Integra Ledger",
    url: "https://www.integraledger.com",
  },
} as const;

/** An absolute URL on the canonical origin for a root-relative path. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteConfig.url).toString();
}

/** A file in the repository, on `main`, as a GitHub URL. `path` is relative to the repository root. */
export function repoFile(path: string): string {
  return `${siteConfig.githubUrl}/blob/main/${path}`;
}

/** The repository path of a documentation page, given its path inside the docs tree. */
export function docSourcePath(contentPath: string): string {
  return `${DOCS_DIR.replace(/^\.\.\//, "")}/${contentPath}`;
}

/** Organization JSON-LD for the publisher. */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteConfig.url}/#organization`,
    name: siteConfig.publisher.name,
    url: siteConfig.publisher.url,
    logo: absoluteUrl("/icon.svg"),
    sameAs: [siteConfig.githubUrl],
  };
}

/** WebSite JSON-LD for this site. */
export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteConfig.url}/#website`,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en",
    publisher: { "@id": `${siteConfig.url}/#organization` },
    license: siteConfig.license.url,
  };
}

/** SoftwareSourceCode JSON-LD for the package, at the given version. */
export function softwareJsonLd(version: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    "@id": `${siteConfig.url}/#package`,
    name: siteConfig.package.name,
    version,
    url: siteConfig.package.npm,
    codeRepository: siteConfig.githubUrl,
    programmingLanguage: "TypeScript",
    license: siteConfig.license.url,
    isPartOf: { "@id": `${siteConfig.url}/#website` },
    publisher: { "@id": `${siteConfig.url}/#organization` },
  };
}

/** BreadcrumbList JSON-LD for a page, from its labelled path segments. */
export function breadcrumbJsonLd(crumbs: Array<{ name: string; path: string }>) {
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
