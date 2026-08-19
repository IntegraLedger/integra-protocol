/**
 * THE HOST-SPECIFICATION PINS ARE WELL-FORMED, AND THEY COVER THE HOSTS THIS TREE TALKS ABOUT.
 *
 * `spec-pins.json` names every host specification a package makes claims about and the revision it was
 * read at. `pnpm spec-drift` compares those revisions against upstream when a maintainer runs it — by
 * hand, because this repository stands alone and does not take a scheduled dependency on eight
 * third-party APIs. This test is the offline half, and it is the half that runs in `verify`: it cannot
 * tell whether a host has moved, but it can guarantee the file is worth reading, which is the part that
 * rots silently.
 *
 * ★ WHY IT EXISTS. Measured 2026-08-12, shipped source carried about thirty-six host claims pinned by DATE
 * ("read 2026-08-08") and roughly ten by revision. A date cannot be checked by anything, which is why an
 * external-conformance audit of this tree "has a shelf life measured in weeks" — its own words. The pins
 * turn that into a scheduled job; this keeps the pins honest.
 *
 * ★ WHAT IT ASSERTS, AND WHY EACH ONE. Structure, so the runner cannot silently skip a malformed entry.
 * Coverage, so adding a placement for a new protocol without pinning its host fails here rather than
 * going unnoticed. And that every `drifted` entry carries a note — a recorded debt is only a debt if it
 * says what is owed; without that it is indistinguishable from an entry nobody has looked at.
 *
 * ★ AND THAT THE PIN FILE IS THE CLOSED SET. The assertions above make `spec-pins.json` well-formed; they
 * say nothing about whether shipped source cites the revisions it records. Measured 2026-08-19, eight sites
 * across three packages and the corpus cited an x402 revision that touches neither file they name — its
 * PARENT is what moved the specification — while pairing it with a read date months before the section
 * being quoted existed. The bytes were right and every checkable part of the citation was wrong, which is
 * the failure mode a pin file exists to end. So the sweep below reads every `owner/repo@sha` in source and
 * refuses one this file does not record, under `readAt` or under `alsoCited`.
 *
 * ★ WHAT THE SWEEP DOES NOT CATCH, said plainly. It matches on REPOSITORY, not on path: a host whose pin
 * file holds two entries for two path sets will accept either revision at either citation. Tying a sha to a
 * path would require every citation to name one, and several legitimately do not. What it guarantees is
 * that no revision is cited which nobody recorded — the state that let all eight sites survive every
 * previous gate.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_PROTOCOL_IDS } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url).pathname;

/** A revision of a host's pinned paths that source cites INSTEAD of `readAt`, and why it does. */
type AlsoCited = { revision: string; readOn: string; reason: string };

type Host = {
  id: string;
  repo?: string;
  url?: string;
  paths?: string[];
  readAt?: string;
  readOn: string;
  status?: "current" | "drifted";
  tracksUpstream?: false;
  pinnable?: false;
  reason?: string;
  note?: string;
  alsoCited?: AlsoCited[];
  citedBy: string[];
};

const PINS = JSON.parse(readFileSync(`${ROOT}spec-pins.json`, "utf8")) as {
  hosts: Host[];
};

/**
 * Directories the sweep does not enter, each for a reason no pattern can carry.
 *
 * `node_modules` is other people's code and `dist` is `src` compiled — and a stale `dist` sorts before
 * `src`, so a walker that reads it reports a citation nobody can edit. `lib` is a vendored upstream
 * submodule whose citations are its owner's claims, not this tree's. `.github` pins ACTIONS by digest:
 * `owner/repo@sha` shaped, but a supply-chain pin annotated with the tag it resolves to and advanced by
 * Dependabot, which is a different discipline from a claim about a host specification.
 */
const NOT_SOURCE = new Set([
  ".git",
  ".github",
  ".stryker-tmp",
  "dist",
  "lib",
  "node_modules",
  "reports",
]);

/** `packages/conformance/vectors` is a gitignored build copy; the root `vectors/` is the corpus. */
const NOT_SOURCE_PATHS = new Set(["packages/conformance/vectors"]);

/** The extensions that carry prose or manifests. Lockfiles and binaries carry neither. */
const TEXT = /\.(?:ts|mts|cts|js|mjs|cjs|json|md)$/;

/** `owner/repo@<sha>` in any of the spellings source uses — backticked, bare, or inside a JSON string. */
const CITATION =
  /\b([A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+)@([0-9a-f]{7,40})\b/g;

/** Every source file the sweep reads, repository-relative. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const next = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (NOT_SOURCE.has(e.name) || NOT_SOURCE_PATHS.has(next)) continue;
        walk(next);
      } else if (TEXT.test(e.name)) out.push(next);
    }
  };
  walk("");
  return out;
}

/** One host-revision citation found in source: where it is, and what it names. */
type Citation = { file: string; line: number; repo: string; sha: string };

const CITATIONS: Citation[] = sourceFiles().flatMap((file) =>
  readFileSync(join(ROOT, file), "utf8")
    .split("\n")
    .flatMap((text, i) =>
      [...text.matchAll(CITATION)].map((m) => ({
        file,
        line: i + 1,
        repo: m[1] as string,
        sha: m[2] as string,
      })),
    ),
);

/** Every revision this file records, by repository — `readAt` and `alsoCited` alike. */
const RECORDED = new Map<string, string[]>();
for (const h of PINS.hosts) {
  if (h.repo === undefined) continue;
  const known = RECORDED.get(h.repo) ?? [];
  if (h.readAt !== undefined) known.push(h.readAt);
  for (const a of h.alsoCited ?? []) known.push(a.revision);
  RECORDED.set(h.repo, known);
}

/** A pin may be abbreviated and so may a citation; agree on whichever prefix is shorter. */
function isRecorded(repo: string, sha: string): boolean {
  return (RECORDED.get(repo) ?? []).some(
    (rev) => rev.startsWith(sha) || sha.startsWith(rev),
  );
}

describe("spec-pins.json is a file worth running a drift job against", () => {
  it("parses, and pins a plausible number of hosts", () => {
    // The blind-gate canary. An empty or truncated file makes every assertion below vacuous.
    expect(PINS.hosts.length).toBeGreaterThan(8);
  });

  it("every host is either pinned by revision or says why it cannot be", () => {
    const bad = PINS.hosts
      .filter((h) =>
        h.pinnable === false
          ? !(h.url && h.reason)
          : !(h.repo && h.paths?.length && h.readAt && h.status),
      )
      .map((h) => h.id);
    // A host with neither a revision nor a stated reason is the date-pinning this file exists to end.
    expect(bad).toEqual([]);
  });

  it("every readAt is a git object id, and every readOn a date", () => {
    for (const h of PINS.hosts) {
      if (h.readAt !== undefined)
        expect(h.readAt, h.id).toMatch(/^[0-9a-f]{10,40}$/);
      expect(h.readOn, h.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every drifted host records what the re-read owes", () => {
    const silent = PINS.hosts
      .filter((h) => h.status === "drifted" && (h.note ?? "").length < 80)
      .map((h) => h.id);
    // A drifted pin with no note is indistinguishable from one nobody has looked at, and the weekly job
    // does not fail on it — so the note is the only thing standing between a recorded debt and a hole.
    expect(silent).toEqual([]);
  });

  it("every cited package exists, and no package is cited twice by one host", () => {
    const dirs = new Set(readdirSync(`${ROOT}packages`));
    for (const h of PINS.hosts) {
      expect(h.citedBy.length, `${h.id} cites nothing`).toBeGreaterThan(0);
      expect(new Set(h.citedBy).size, `${h.id} repeats a package`).toBe(
        h.citedBy.length,
      );
      for (const pkg of h.citedBy)
        expect(dirs.has(pkg), `${h.id} cites missing package ${pkg}`).toBe(
          true,
        );
    }
  });

  it("every alsoCited revision is a git object id and says why it is cited instead of readAt", () => {
    for (const h of PINS.hosts)
      for (const a of h.alsoCited ?? []) {
        expect(a.revision, h.id).toMatch(/^[0-9a-f]{10,40}$/);
        expect(a.readOn, h.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // A tree pin with no reason is a stray sha with a home. The reason is the whole difference: it says
        // what the citation is tied to that `readAt` cannot give it, so the next reader can check the claim
        // rather than assume the pin was a typo and "fix" it.
        expect(a.reason.length, `${h.id} @ ${a.revision}`).toBeGreaterThan(80);
      }
  });

  it("the sweep walks source and finds the citations that are there", () => {
    // The blind-gate canary, and it is not decoration: a walker that skips `vectors/` or stops at the first
    // package reports clean over a tree full of stray shas. These two are the citations that exist today —
    // a corpus vector and a placement — so a sweep that misses either has stopped reading something.
    expect(CITATIONS.length).toBeGreaterThan(8);
    expect(
      CITATIONS.some((c) => c.file === "vectors/placement/a2a.json"),
      "sweep never reached the corpus",
    ).toBe(true);
    expect(
      CITATIONS.some((c) => c.file.startsWith("packages/placement-x402/")),
      "sweep never reached the placements",
    ).toBe(true);
  });

  it("every revision cited in source is one this file records", () => {
    const stray = CITATIONS.filter((c) => !isRecorded(c.repo, c.sha)).map(
      (c) => `${c.file}:${c.line} cites ${c.repo}@${c.sha}`,
    );
    expect(
      stray.sort(),
      "A citation must resolve to a revision spec-pins.json records for that repository. Repoint it to " +
        "that host's `readAt` — the last commit touching the pinned paths, which is NOT the commit that " +
        "happened to be at the tip when someone read them — or, when the tree pin is deliberate, record it " +
        "under that host's `alsoCited` with the reason it is tied to that tree.",
    ).toEqual([]);
  });

  it("every protocol this tree places into has a pinned host", () => {
    // The coverage assertion, and the reason this test lives beside the manifests. `mcp` is the one
    // protocol id with no placement — a delivery surface rather than a carrier — so it is the one id that
    // legitimately needs no host pin. Everything else does: a placement is a claim about a host.
    const pinned = new Set(PINS.hosts.map((h) => h.id));
    const missing = KNOWN_PROTOCOL_IDS.filter(
      (id) =>
        id !== "mcp" &&
        !pinned.has(id === "mastercard-vi" ? "verifiable-intent" : id),
    );
    expect(missing).toEqual([]);
  });
});
