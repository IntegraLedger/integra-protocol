import Link from "next/link";
import { packageGroups, packages, packageUrl } from "@/lib/packages";

/**
 * Every documented package, grouped, on the overview page.
 *
 * Derived from the workspace, never listed here. A hand-kept index would go stale the next
 * time a package landed, and it would go stale silently — the one failure mode a documentation
 * site cannot detect from the inside.
 *
 * Rendered by the page shell rather than from MDX so the overview's own source stays plain
 * prose: the Markdown exports at `/md/index.md` and `/llms-full.txt` would otherwise carry a
 * component tag no reader outside this site can resolve. `/llms.txt` already indexes all
 * thirty-one pages with their descriptions, so nothing is lost to a machine reader.
 */
export function PackageIndex() {
  return (
    <div className="not-prose mt-12 flex flex-col gap-10">
      {packageGroups.map((group) => {
        const members = packages.filter((pkg) => pkg.group === group.id);
        if (members.length === 0) return null;
        return (
          <section key={group.id}>
            <h2 className="mb-1 text-xl font-semibold tracking-tight text-fd-foreground">
              {group.title}{" "}
              <span className="font-mono text-sm font-normal text-fd-muted-foreground">
                {members.length}
              </span>
            </h2>
            <p className="mb-4 text-fd-muted-foreground">{group.description}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {members.map((pkg) => (
                <li key={pkg.name}>
                  <Link
                    href={packageUrl(pkg.dir)}
                    className="flex h-full flex-col rounded-lg border border-fd-border bg-fd-card p-4 transition-colors hover:border-fd-primary"
                  >
                    <span className="font-mono text-sm font-medium text-fd-foreground">
                      {pkg.name}
                    </span>
                    <span className="mt-1.5 text-sm text-fd-muted-foreground">
                      {pkg.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
