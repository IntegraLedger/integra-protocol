import type { Metadata } from "next";
import { DocView, docMetadata } from "@/components/DocView";
import { PackageIndex } from "@/components/PackageIndex";

/**
 * The site root: the overview page, inside the docs shell.
 *
 * This site is a reference for a set of packages, so the front door is the first page of the
 * reference rather than a landing page in front of it. The overview's prose is authored MDX
 * (`content/docs/index.mdx`); the index of packages below it is derived from the workspace.
 */
export default function Home() {
  return (
    <DocView slug={[]}>
      <PackageIndex />
    </DocView>
  );
}

export function generateMetadata(): Metadata {
  return docMetadata([]);
}
