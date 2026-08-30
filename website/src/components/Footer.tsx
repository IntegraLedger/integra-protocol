import Link from "next/link";
import { packages } from "@/lib/packages";
import { repoFile, siteConfig } from "@/lib/site";
import { packageVersion } from "@/lib/version";

export function Footer() {
  return (
    <footer className="border-t border-fd-border px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-sm text-fd-muted-foreground md:flex-row md:justify-between">
        <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a
            href={`${siteConfig.githubUrl}/tags`}
            className="rounded-full border border-fd-border px-2.5 py-0.5 font-mono text-xs hover:text-fd-foreground"
            target="_blank"
            rel="noopener noreferrer"
            title="Every package is released at this version together"
          >
            v{packageVersion}
          </a>
          <span>
            Apache-2.0 &middot; {packages.length} packages &middot; no account,
            no key, no telemetry
          </span>
        </span>
        <nav
          aria-label="Footer"
          className="flex flex-wrap justify-center gap-4"
        >
          <Link href="/" className="hover:text-fd-foreground">
            Overview
          </Link>
          <a
            href={siteConfig.standard.specUrl}
            className="hover:text-fd-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            The standard
          </a>
          <a
            href={siteConfig.githubUrl}
            className="hover:text-fd-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            href={repoFile("CONTRIBUTING.md")}
            className="hover:text-fd-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            Contributing
          </a>
          <a
            href={repoFile("SECURITY.md")}
            className="hover:text-fd-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            Report a vulnerability
          </a>
        </nav>
      </div>
    </footer>
  );
}
