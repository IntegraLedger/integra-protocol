import "server-only";
import { packageVersion } from "@/lib/packages";

/**
 * The version of the packages these pages document, read from the workspace at build time.
 *
 * Every package is one `fixed` changesets group, so one number describes all thirty-one.
 * Read from the manifests rather than restated here: a version typed into the site would be a
 * second statement of a fact the release process owns, and it would drift the first time a
 * release shipped without someone remembering this file.
 *
 * ⛔ This is the version at HEAD, not the version on the registry, and the two are not the same
 * thing between a merge and a release. That is deliberate: the site is built from the workspace
 * it lives in, so it documents the code it was built from. `packages.ts` asserts the thirty-one
 * agree with each other; nothing here consults npm.
 */
export { packageVersion };
