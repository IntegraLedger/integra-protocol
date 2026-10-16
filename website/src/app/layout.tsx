import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { organizationJsonLd, siteConfig, softwareJsonLd, webSiteJsonLd } from "@/lib/site";
import { packageVersion } from "@/lib/version";
import "./global.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { template: siteConfig.titleTemplate, default: siteConfig.title },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.publisher.name, url: siteConfig.publisher.url }],
  creator: siteConfig.publisher.name,
  publisher: siteConfig.publisher.name,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.url,
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
  },
  alternates: {
    types: { "text/plain": [{ url: "/llms.txt", title: "llms.txt" }] },
  },
  /**
   * The llms.txt index that describes each page (https://llmstxt.org) is a link among the metadata tags, which every
   * build writes in one order. React hoists a <link> written in the body into <head> in the order its chunks arrive,
   * so it could change places with a page's robots meta between two builds. A config `icons` replaces the icon Next.js
   * reads from app/icon.svg, so that file's address is listed here too.
   */
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
    other: [{ rel: "describedby", url: "/llms.txt", type: "text/plain" }],
  },
};

/**
 * Text of the docs theme set here. The search dialog's close button shows "ESC", so its accessible name begins with
 * that label (WCAG 2.5.3).
 */
const translations = { "Close Search(search dialog)(aria-label)": "Esc: close search" };

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-fd-primary px-4 py-2 text-fd-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <JsonLd data={[organizationJsonLd(), webSiteJsonLd(), softwareJsonLd(packageVersion)]} />
        {/* The theme changes only through the layout's theme switch: no key pressed alone changes it (WCAG 2.1.4). */}
        <RootProvider
          search={{ enabled: true, options: { type: "static", api: "/api/search" } }}
          theme={{ hotKey: false }}
          i18n={{ translations }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
