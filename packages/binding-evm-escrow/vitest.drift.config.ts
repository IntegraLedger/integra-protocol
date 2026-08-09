import { defineConfig } from "vitest/config";

/**
 * The drift lane, and nothing else.
 *
 * `include` is exhaustive on purpose: these cases make live public-RPC reads, and the whole point of the
 * separate lane is that `pnpm -r test` → `pnpm verify` → `ci.yml` → `mutation.yml` can never reach them.
 * Vitest's default `include` globs `*.test.ts`, so `*.drift.ts` is already invisible to the `test` script —
 * this config is what makes it reachable deliberately, rather than what makes it hidden.
 *
 * Run with `pnpm --filter @integraledger/lcp-binding-evm-escrow drift`, or weekly via drift-guard.yml.
 */
export default defineConfig({
  test: {
    include: ["drift/**/*.drift.ts"],
    // A chain read over a public endpoint is slower than a unit test and occasionally retries.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
