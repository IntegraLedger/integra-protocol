import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarkIcon } from "@/components/MarkIcon";
import { siteConfig } from "@/lib/site";

// Next marks the not-found route noindex itself. `null` stops the root layout's
// `index, follow` from being inherited beside it, which would emit two contradictory tags.
export const metadata: Metadata = {
  title: "Page not found",
  robots: null,
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
      <main
        id="main"
        className="flex flex-1 items-center justify-center px-6 py-24"
      >
        <div className="max-w-xl text-center">
          <div className="mb-6 flex justify-center">
            <MarkIcon size={72} className="text-fd-muted-foreground" />
          </div>
          <p className="mb-2 font-mono text-sm text-fd-muted-foreground">404</p>
          <h1 className="mb-4 text-3xl font-bold tracking-tight">
            Nothing is served at this address
          </h1>
          <p className="mb-8 text-lg text-fd-muted-foreground [text-wrap:balance]">
            The page may have moved, or the link that brought you here was
            wrong. Every package this site documents is listed on the overview.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center rounded-lg bg-fd-primary px-6 py-3 text-base font-semibold text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
            >
              Overview
            </Link>
            <a
              href={siteConfig.githubUrl}
              className="inline-flex items-center rounded-lg border border-fd-muted-foreground px-6 py-3 text-base font-semibold transition-colors hover:bg-fd-accent"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
