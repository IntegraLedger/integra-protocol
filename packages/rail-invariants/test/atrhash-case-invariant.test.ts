/**
 * THE atrHash CASE INVARIANT — one place in the tree may case-fold an atrHash, and it is not yours.
 *
 * LCP §2.5 says two things about the spelling of an `atrHash`, and this repository implements each of them
 * exactly once, in `kernel/src/atrHash.ts`:
 *
 *   - comparison is over DECODED BYTES ("implementations MUST compare the decoded bytes rather than the
 *     strings") — `atrHashEquals`, which validates both sides and answers `false` for anything that is not
 *     an atrHash, because a READ path meets malformed data as a matter of course;
 *   - emission is RECOMMENDED lowercase — `canonicalAtrHash`, which validates and THROWS, because an EMIT
 *     path holding a non-hash has a wiring defect and a canonical spelling of a non-hash is a fabricated
 *     reference on a wire.
 *
 * Both are `x.toLowerCase()` underneath. That is the whole problem: the two rules are indistinguishable at
 * a glance, so open-coding either one reads as obviously correct while being the other one by accident.
 *
 * ★ WHY THIS FILE EXISTS. Before 2026-08-08 the rules held by coincidence. `atrHashEquals` compared
 * case-folded STRINGS and validated nothing — `atrHashEquals("hello", "HELLO")` answered `true` — and had
 * ZERO production callers, so nothing exercised it. Around it sat THIRTY-ONE hand-rolled foldings: twenty
 * comparisons across thirteen packages, and eleven encoders that each opened with `if (!isAtrHash(v))
 * throw …` followed by `v.toLowerCase()`, which is `canonicalAtrHash` inlined eleven times in five
 * spellings. Every one was correct. None of them was checked, and site thirty-two was a one-line edit away.
 *
 * ★ WHAT IT ASSERTS, and why it is TOTAL. Not "no bad comparison" — no case-folding of an atrHash AT ALL,
 * outside the one file. A rule with exemptions needs a reader to judge which side of the line a new site
 * falls on, and that judgement is exactly what produced thirty-one correct-looking sites around one broken
 * primitive. There is nothing to judge here: if you are folding an atrHash you are re-implementing one of
 * two functions that already exist, and the failure message names them.
 *
 * ★ SCOPE. `src/` only. `src/` ships in every tarball; `test/` and `drift/` do not, and a test may
 * legitimately construct a mis-spelled pair in order to assert that it is refused.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = new URL("../../", import.meta.url).pathname;

/** The one file that may case-fold an atrHash: both §2.5 primitives live there and nowhere else. */
const HOME = "kernel/src/atrHash.ts";

/**
 * `.toLowerCase()` applied to an expression whose atrHash-ness is visible in a NAME.
 *
 * The name is the signal, because it is all a lint-shaped check can see. `settledAtrHash.toLowerCase()`
 * concerns a terms reference; `log.address.toLowerCase()` does not. Both are legal JavaScript, and only one
 * is governed by §2.5.
 *
 * ⛔ THREE SPELLINGS WERE INVISIBLE, AND ALL THREE WERE IN THE TREE. The old character class was
 * `[A-Za-z0-9_.[\]?]` — it admitted a bracket but not the QUOTE inside one, so `doc["atrHash"]` could not
 * be reached; and it required the fold to sit directly against the name, so neither `f(atrHash)` nor
 * `atrHashFromCid(cid)` could be. Meanwhile the docblock at the top of this file said "nothing in the tree
 * case-folds an atrHash except this file", and `discovery/src/emit.ts`, `binding-canton/src/anchor.ts` and
 * `evidence/src/manifest.ts` each did. A gate that names its reach must actually reach that far, or the
 * sentence is the defect.
 *
 * KNOWN LIMIT, stated rather than hidden: an atrHash held in a variable not named for one —
 * `const h = ref.value; h.toLowerCase()`, or `e.ref.slice(11).toLowerCase()` — is still invisible.
 * Closing that needs type information this check does not have. A gate whose reach is written down beats
 * one that quietly over-claims.
 */
const FOLDED_ATRHASH =
  /[Aa]tr[Hh]ash[A-Za-z0-9_]*\s*(?:\([^)]*\))?\s*["']?\]?\)?\??\s*\.toLowerCase\(\)/;

/** Every `.ts` under a package's `src/`, as a package-relative path. */
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
  }
  return out;
}

describe("atrHash case handling lives in exactly one file", () => {
  const files = shippedSourceFiles();

  it("walks a plausible number of shipped source files", () => {
    // The blind-gate canary. A walker that silently stops finding files reports "clean" forever, which is
    // the failure mode every sweep-shaped check in this repository has to answer for.
    expect(files.length).toBeGreaterThan(80);
  });

  it(`no shipped source outside ${HOME} case-folds an atrHash`, () => {
    const offenders = files
      .filter((f) => f !== HOME)
      .flatMap((f) =>
        readFileSync(join(PACKAGES, f), "utf8")
          .split("\n")
          .flatMap((line, i) =>
            FOLDED_ATRHASH.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [],
          ),
      );
    // If this fails: you want `atrHashEquals` (comparing) or `canonicalAtrHash` (emitting), both exported
    // from `@integraledger/lcp-kernel`. If you want neither, the value is not an atrHash and should not be
    // named like one.
    expect(offenders).toEqual([]);
  });

  it("the home file really does still hold both primitives", () => {
    // Without this, deleting or gutting `kernel/src/atrHash.ts` would make the sweep above pass vacuously.
    const home = readFileSync(join(PACKAGES, HOME), "utf8");
    expect(home).toContain("export function atrHashEquals");
    expect(home).toContain("export function canonicalAtrHash");
    expect(FOLDED_ATRHASH.test(home)).toBe(true);
  });

  it("the pattern actually discriminates", () => {
    // Without this, a pattern that matched nothing would satisfy the sweep forever. The positives are
    // shapes the thirty-one migrated sites really wore; the negatives are the case-foldings that remain in
    // the tree and are none of §2.5's business.
    const positives = [
      "acceptance.atrHash.toLowerCase()",
      "inputs.atrHash.toLowerCase()",
      "settledAtrHash.toLowerCase()",
      "const want = params.atrHash.toLowerCase();",
      "return hexToBytes(atrHash.toLowerCase());",
      'atrHash.toLowerCase().replace(/^0x/, "")',
    ];
    const negatives = [
      "if (log.address.toLowerCase() !== asset) continue;",
      "if (signature.toLowerCase() !== TRANSFER_WITH_MEMO_TOPIC0) return null;",
      "if (k.toLowerCase() === want) return map[k];",
      "observedNonces.find((o) => o.toLowerCase() === nonce)",
      "isPublicV6(host.toLowerCase())",
      "const asset = params.asset.toLowerCase();",
    ];
    for (const p of positives)
      expect(FOLDED_ATRHASH.test(p), `should flag: ${p}`).toBe(true);
    for (const n of negatives)
      expect(FOLDED_ATRHASH.test(n), `should pass: ${n}`).toBe(false);
  });
});
