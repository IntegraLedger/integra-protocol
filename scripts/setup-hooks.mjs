#!/usr/bin/env node
/**
 * Point git at the repository's tracked hooks, from the root `prepare` script.
 *
 * Hooks are NOT tracked content — `.git/hooks` never travels with a clone — so every fresh checkout and
 * every second machine starts with none. `core.hooksPath` is the supported way to redirect git at a
 * directory that IS tracked, and running it from `prepare` means a contributor gets the DCO sign-off hook
 * from `pnpm install` without reading a setup step first.
 *
 * Scope is deliberately small: `--local`, so this writes to `.git/config` in this repository and touches
 * no global or system configuration.
 *
 * ⚠️ This is convenience, never enforcement. A contributor who skips `pnpm install`, commits from a tool
 * that bypasses hooks, or uses `--no-verify` still lands an unsigned commit — which is why
 * `commit-policy.yml` checks the pushed range and is the thing that actually holds the line.
 */
import { execFileSync } from "node:child_process";

// A published tarball has no .git, and neither does a docker build context; `prepare` still runs in both.
// Reporting that plainly beats throwing, because nothing is wrong — there is simply no repository to
// configure. Every other failure is real and is allowed to surface.
try {
  execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
} catch {
  console.log(
    "setup-hooks — no git repository here; skipping (this is normal outside a clone).",
  );
  process.exit(0);
}

// CI checks out, installs and never commits, so the hook has nothing to do there. Skipping keeps CI's
// git configuration exactly as actions/checkout left it.
if (process.env.CI) {
  console.log("setup-hooks — CI detected; skipping (CI does not commit).");
  process.exit(0);
}

execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});
console.log(
  "setup-hooks — core.hooksPath -> .githooks (DCO sign-off is now automatic).",
);
