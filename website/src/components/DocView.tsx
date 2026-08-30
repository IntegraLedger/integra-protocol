import { Callout } from "fumadocs-ui/components/callout";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import {
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { JsonLd } from "@/components/JsonLd";
import { PackageMeta } from "@/components/PackageMeta";
import { markdownPath } from "@/lib/llms";
import { packageForUrl, description as siteDescription } from "@/lib/packages";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  repoFile,
  siteConfig,
  softwareJsonLd,
} from "@/lib/site";
import { source } from "@/lib/source";

/**
 * One documentation page, whether it is the authored overview at `/` or one of the thirty-one
 * generated from a package README. Both routes render through here so a change to the page
 * chrome cannot reach one and miss the other.
 */

type DocPage = NonNullable<ReturnType<typeof source.getPage>>;

/** Title-case a slug segment as a breadcrumb fallback label. */
function humanize(segment: string): string {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Home → …ancestors… → current, using real page titles where resolvable. */
function buildCrumbs(slug: string[], title: string) {
  const crumbs = [{ name: "Home", path: "/" }];
  slug.forEach((segment, i) => {
    const sub = slug.slice(0, i + 1);
    const isLast = i === slug.length - 1;
    const page = source.getPage(sub);
    crumbs.push({
      name: isLast ? title : (page?.data.title ?? humanize(segment)),
      path: `/${sub.join("/")}`,
    });
  });
  return crumbs;
}

/**
 * The repository file a page is written in.
 *
 * For a package page that is the README it renders, NOT the generated `.md` under
 * `content/docs/packages/` — that file is a build artifact, is gitignored, and "edit this page"
 * pointing at it would send a reader to a 404 and, if they found it, to a file the next build
 * overwrites. The README is where the edit belongs.
 */
function sourcePathOf(page: DocPage): string {
  return (
    packageForUrl(page.url)?.readmePath ??
    `website/content/docs/${page.data.info.path}`
  );
}

export function DocView({
  slug,
  children,
}: {
  slug: string[];
  children?: ReactNode;
}) {
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const pkg = packageForUrl(page.url);
  const lastModified = page.data.lastModified;
  const sourcePath = sourcePathOf(page);
  const markdownUrl = markdownPath(page.url);

  const techArticle = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.data.title,
    name: page.data.title,
    description: page.data.description,
    url: absoluteUrl(page.url),
    inLanguage: "en",
    isPartOf: { "@id": `${siteConfig.url}/#website` },
    publisher: { "@id": `${siteConfig.url}/#organization` },
    image: absoluteUrl(siteConfig.ogImage),
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    ...(lastModified ? { dateModified: lastModified.toISOString() } : {}),
  };

  return (
    <DocsPage
      id="main"
      tabIndex={-1}
      toc={page.data.toc}
      full={page.data.full}
      lastUpdate={lastModified}
      editOnGithub={{
        owner: siteConfig.github.owner,
        repo: siteConfig.github.repo,
        sha: "main",
        path: sourcePath,
      }}
    >
      <JsonLd
        data={[
          techArticle,
          breadcrumbJsonLd(buildCrumbs(slug, page.data.title)),
          ...(pkg ? [softwareJsonLd(pkg)] : []),
        ]}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      {pkg ? <PackageMeta pkg={pkg} /> : null}
      <div className="flex flex-row items-center gap-2 border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={absoluteUrl(markdownUrl)}
          githubUrl={repoFile(sourcePath)}
        />
      </div>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents, Callout, Tab, Tabs }} />
        {children}
      </DocsBody>
    </DocsPage>
  );
}

/** Per-page metadata: canonical, Open Graph and Twitter, for the same page `DocView` renders. */
export function docMetadata(slug: string[]): Metadata {
  const page = source.getPage(slug);
  if (!page) return {};
  const description = page.data.description ?? siteDescription;
  const image = {
    url: siteConfig.ogImage,
    width: 1200,
    height: 630,
    alt: siteConfig.ogImageAlt,
  };
  return {
    title: page.data.title,
    description,
    alternates: { canonical: page.url },
    openGraph: {
      type: "article",
      url: absoluteUrl(page.url),
      title: page.data.title,
      description,
      siteName: siteConfig.name,
      // Nested `openGraph` replaces the root's whole block — nothing set at the root
      // reaches here, so locale and the file-convention image are restated.
      locale: siteConfig.locale,
      images: [image],
      ...(page.data.lastModified
        ? { modifiedTime: page.data.lastModified.toISOString() }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description,
      images: [image],
    },
  };
}
