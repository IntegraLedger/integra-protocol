import type { DocumentedPackage } from "@/lib/packages";
import { npmUrl, repoFile, repoTree } from "@/lib/site";

/**
 * The facts about a package that its README does not state: the version at this commit, and
 * where the published artifact and its source live.
 *
 * The README says what the package does; the manifest says which one and which version. Both
 * are read at build time, so neither is a claim this site maintains.
 */
export function PackageMeta({ pkg }: { pkg: DocumentedPackage }) {
  return (
    <div className="not-prose mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <a
        href={repoFile(`${pkg.directory}/CHANGELOG.md`)}
        className="rounded-full border border-fd-border px-2.5 py-0.5 font-mono text-xs text-fd-muted-foreground hover:text-fd-foreground"
        target="_blank"
        rel="noopener noreferrer"
        title="Changelog"
      >
        v{pkg.version}
      </a>
      <a
        href={npmUrl(pkg.name)}
        className="text-fd-primary hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        npm
      </a>
      <a
        href={repoTree(pkg.directory)}
        className="text-fd-primary hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        Source
      </a>
      <span className="text-fd-muted-foreground">Apache-2.0</span>
    </div>
  );
}
