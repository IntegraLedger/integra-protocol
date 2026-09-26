import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The version of the package these pages document, read from its manifest at build time.
 * Server components only: it reads the filesystem.
 */
export const packageVersion: string = (() => {
  // `next build` runs in website/; the package's manifest is at ../lcp/package.json.
  const manifest = join(process.cwd(), "..", "lcp", "package.json");
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`${manifest} carries no version`);
  }
  return version;
})();
