#!/usr/bin/env node
/**
 * Copy the canonical root LICENSE and NOTICE next to the package being packed. Runs as each publishable
 * package's `prepack`, so every tarball carries both without committed per-package copies that would drift
 * the moment the root changed.
 *
 * npm force-includes a file named exactly `LICENSE` regardless of `files`, so that one would ship anyway.
 * NOTICE would NOT — Apache-2.0 §4(d) requires it to travel with the distribution, and a `files` allowlist
 * silently drops it. Both are copied here and both are allowlisted in each package's `files`, because
 * relying on npm's special case for one of the pair is the kind of asymmetry nobody remembers.
 *
 * FAILS LOUD. A missing root LICENSE or NOTICE throws rather than packing a tarball without them: shipping
 * an unlicensed artifact is worse than a failed publish, and `prepack` runs inside every `pnpm pack` —
 * including the one `release.yml` stages from — where a silent skip would be discovered by a consumer
 * rather than by us. The copies are gitignored — the
 * root files are the only tracked ones.
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// `prepack` runs with the package directory as cwd, which is what makes one root script serve every package.
const packageDir = process.cwd();

for (const name of ["LICENSE", "NOTICE"]) {
  const from = join(repoRoot, name);
  if (!existsSync(from))
    throw new Error(
      `sync-license: ${from} is missing — refusing to pack ${packageDir} without it. The root ${name} is the single source; restore it rather than committing a per-package copy.`,
    );
  copyFileSync(from, join(packageDir, name));
}
