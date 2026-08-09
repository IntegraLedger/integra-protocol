/**
 * SHIPPED SOURCE CARRIES NO PRIVATE REFERENTS.
 *
 * `src/**‍/*.ts` is in every published tarball — `npm pack --dry-run` on `kernel` reports 55 files, ten of
 * them `src/`, and the `files` field is `["dist","src","CHANGELOG.md","LICENSE","NOTICE"]`. Source comments
 * are therefore PUBLISHED DOCUMENTATION. `test/` and `drift/` are not shipped and are not checked here.
 *
 * ★ THE README IS SHIPPED TOO, and scoping this gate to `src/` alone was a hole rather than a boundary. npm
 * always packs a package's own README, and it is the FIRST thing a consumer reads — earlier than any source
 * comment. When `H-1` was retired from `src/` in 2026-08 the sweep reported clean while **21 occurrences
 * survived across eleven package READMEs**, in exactly the "the assertion H-1 forbids" shape the retirement
 * was about. The ROOT README is not in any tarball, so defining the token there resolved nothing for the
 * consumer who has only the package. Both are checked now.
 *
 * The one exclusion is a fenced code block: a README fence may legitimately show a host protocol's own
 * id-shaped token, and a snippet is quoted material rather than this repository's prose.
 *
 * The standard: a comment ships only if a stranger holding nothing but the tarball can resolve every
 * referent in it. An audit finding id fails that however true the sentence around it is.
 *
 * ★ WHY THIS FILE EXISTS. `H-1` appeared 23 times across 11 packages, used as though it were a named
 * principle a reader could look up — "H-1's prohibition exactly", "See H-1", "the assertion H-1 forbids".
 * It is a finding id from a private audit document. A consumer who installs
 * `@integraledger/lcp-binding-core` and reads "H-1's prohibition exactly" can resolve nothing.
 *
 * The principle behind it was real and worth keeping, so it was NAMED instead — "THE HOST GOVERNS", stated
 * once in `binding-core/src/placement.ts` above the manifest type, where every consumer of the placement
 * seam already reads. The 23 sites now carry the meaning inline rather than a token to look up. Without
 * this gate, id 24 arrives next month.
 *
 * ★ THE PATTERN, and why it is narrow. Only ONE- and TWO-letter prefixes are treated as private ids. That
 * is not arbitrary: measured across shipped source, every three-letter id is either a public standard
 * (`EIP-3009`, `TIP-20`, `CAP-67`, `ERC-1271`, `CIP-20`, `SHA-256`) or a requirement id from Integra's
 * functional specification (`RCS-5`, `PAY-3`, `ATA-3`, `WLD-3`, `IDN-1`, `TRM-6`). Requirement ids are a
 * SEPARATE problem — they resolve to a register no consumer holds — and the answer there is the gloss
 * block, not deletion, so they are deliberately out of scope here.
 *
 * `TC-*` is the one two-letter exception and it is allowed: LCP's transaction-class ladder is defined in
 * the published specification, so `TC-4` resolves for anyone holding the spec this package implements.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = new URL("../../", import.meta.url).pathname;

/** An id-shaped token with a one- or two-letter prefix: `H-1`, `D-5`, `B-12`, `Q-7`, `RUL-3`… */
const ID_SHAPED = /\b[A-Z]{1,2}-\d+\b/g;

/**
 * Prefixes that resolve for a stranger holding only the tarball and the published LCP specification.
 *
 * `TC` — the transaction-class ladder (TC-0 … TC-4), defined in the spec this package implements.
 */
const PUBLIC_PREFIXES = new Set(["TC"]);

/** Every file npm packs whose PROSE is ours: `src/**\/*.ts` plus each package's own README. */
function shippedSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${rel}/${name}`);
      else if (name.endsWith(".ts")) out.push(`${rel}/${name}`);
    }
  };
  for (const pkg of readdirSync(PACKAGES)) {
    const src = join(PACKAGES, pkg, "src");
    try {
      if (statSync(src).isDirectory()) walk(src, `${pkg}/src`);
    } catch {
      // A package without src/ is not a defect here.
    }
    if (existsSync(join(PACKAGES, pkg, "README.md")))
      out.push(`${pkg}/README.md`);
  }
  return out;
}

/** Strip fenced code blocks — a fence quotes a host protocol, not this repository's prose. */
function outsideFences(text: string): string {
  let fenced = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

/** Private-referent hits in one file, as `path:line: token` strings. */
function privateReferents(rel: string, text: string): string[] {
  return text.split("\n").flatMap((line, i) =>
    [...line.matchAll(ID_SHAPED)]
      .map((m) => m[0])
      .filter((tok) => !PUBLIC_PREFIXES.has(tok.split("-")[0] ?? ""))
      .map((tok) => `${rel}:${i + 1}: ${tok}`),
  );
}

describe("shipped source carries no private referents", () => {
  const files = shippedSourceFiles();

  it("walks a plausible number of shipped source files", () => {
    // The blind-gate canary. A walker that stops finding files reports clean forever.
    expect(files.length).toBeGreaterThan(110);
  });

  it("cites no audit finding id, plan section or session token", () => {
    const offenders = files.flatMap((f) =>
      privateReferents(
        f,
        outsideFences(readFileSync(join(PACKAGES, f), "utf8")),
      ),
    );
    // If this fails: the sentence is probably right and the CITATION is the problem. Say what the finding
    // said, inline, so a reader holding only the tarball can follow it — that is what replacing `H-1` with
    // "the host governs" did.
    expect(offenders).toEqual([]);
  });

  it("the pattern discriminates — private ids flagged, public ones not", () => {
    // Without this, a pattern that matched nothing would satisfy the sweep forever. The negatives are the
    // id-shaped tokens really present in shipped source, and each is resolvable by a stranger: public
    // standards, and requirement ids whose answer is the gloss block rather than deletion.
    const flagged = (s: string): string[] => privateReferents("f.ts", s);
    for (const bad of ["H-1", "D-5", "B-12", "Q-7", "A-3", "C-4", "R-2"])
      expect(flagged(`// see ${bad} for why`), bad).not.toEqual([]);
    for (const ok of [
      "TC-4",
      "EIP-3009",
      "TIP-20",
      "CAP-67",
      "ERC-1271",
      "SHA-256",
      "RCS-5",
      "PAY-3",
      "IDN-1",
      "WLD-3",
    ])
      expect(flagged(`// per ${ok}`), ok).toEqual([]);
  });

  it("no published README sends a reader to the private requirement-id anchor", () => {
    // The requirement-id gloss is the ONLY path a consumer has to decode an id they meet in a runtime
    // error string — `binding-evm-mpp` emits "(PAY-3/RCS-5)" in its manifest's finality.note. It linked to
    // github.com/IntegraLedger/integra-protocol#requirement-ids on 21 READMEs, which returns 404 for every
    // anonymous reader (measured 2026-08-08) because the repository is private. The fourteen-family table
    // is inlined instead.
    //
    // The distinction from the other repo links in these files is deliberate: "see the documentation" is a
    // courtesy that starts working when D7 makes the repository public, while this one is load-bearing NOW
    // and had to stop depending on that.
    const offenders = readdirSync(PACKAGES)
      .map((pkg) => [pkg, join(PACKAGES, pkg, "README.md")] as const)
      .filter(([, f]) => existsSync(f))
      .filter(([, f]) =>
        readFileSync(f, "utf8").includes("integra-protocol#requirement-ids"),
      )
      .map(([pkg]) => pkg);
    expect(offenders).toEqual([]);
  });

  it("every package citing a requirement id carries the gloss that decodes it", () => {
    // A package that emits `RCS-5` and explains nothing leaves the reader with a token and no dictionary.
    const FAMILIES =
      /\b(ASP|ATA|CMP|DSC|FRC|IDN|OFR|OPS|ORC|PAY|PRS|RCS|TRM|WLD)-\d+\b/;
    const missing = readdirSync(PACKAGES).filter((pkg) => {
      const cites = shippedSourceFiles()
        .filter((f) => f.startsWith(`${pkg}/src/`))
        .some((f) => FAMILIES.test(readFileSync(join(PACKAGES, f), "utf8")));
      if (!cites) return false;
      const readme = join(PACKAGES, pkg, "README.md");
      return (
        !existsSync(readme) ||
        !readFileSync(readme, "utf8").includes("## Requirement ids")
      );
    });
    expect(missing).toEqual([]);
  });

  it("the principle H-1 stood for is stated where a consumer reads it", () => {
    // Deleting the token would have been a regression if the rule went with it. This is the vacuity guard
    // on the replacement: the seam every placement consumer imports states the rule in full.
    const seam = readFileSync(
      join(PACKAGES, "binding-core/src/placement.ts"),
      "utf8",
    );
    expect(seam).toContain("THE HOST GOVERNS");
    expect(seam).toContain(
      "never asserts a shape onto a host protocol's wire that the host has not defined",
    );
  });
});
