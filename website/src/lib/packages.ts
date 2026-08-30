import "server-only";
import {
  GROUPS,
  lockstepVersion,
  publicPackages,
} from "../../scripts/public-packages.mjs";

/**
 * The package set this site documents, read from the workspace at build time.
 *
 * `server-only` makes a client import a build error naming this file, rather than a bundler
 * complaint about `node:fs`. The derivation itself lives in `scripts/public-packages.mjs`
 * because the page generator needs the same set and a second copy of the rule "published means
 * `private` is not true" is exactly the kind of duplicate that goes wrong quietly.
 */

export interface DocumentedPackage {
  /** Directory under `packages/`, and the last segment of the page URL. */
  dir: string;
  name: string;
  description: string;
  version: string;
  group: string;
  readmePath: string;
  directory: string;
}

export const packages: DocumentedPackage[] = publicPackages();

/** The one version every documented package carries; asserted, not assumed. */
export const packageVersion: string = lockstepVersion(packages);

export const packageGroups: Array<{
  id: string;
  title: string;
  description: string;
}> = GROUPS;

/** Page URL of a package's documentation. */
export function packageUrl(dir: string): string {
  return `/packages/${dir}`;
}

const byUrl = new Map(packages.map((pkg) => [packageUrl(pkg.dir), pkg]));

/** The package a documentation URL documents, or `undefined` for an authored page. */
export function packageForUrl(url: string): DocumentedPackage | undefined {
  return byUrl.get(url);
}
