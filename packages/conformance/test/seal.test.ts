/**
 * The seal is only worth having if it catches the thing it was built for. Every case here is a truncation
 * or a tamper that the pre-seal runner reported as `exit 0` — a certifier quietly certifying against a
 * subset. The last two are the ones that matter most: they are the attacks that defeat a seal stored
 * beside the corpus it seals, and they are why the root is compiled into the package instead.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORPUS_ROOT } from "../src/corpus-root.js";
import {
  type CorpusReader,
  type CorpusSeal,
  computeRoot,
  verifyCorpusSeal,
} from "../src/seal.js";

const VECTORS = new URL("../vectors/", import.meta.url);
const realBytes = (rel: string) => readFileSync(new URL(rel, VECTORS));
const realText = (rel: string) => readFileSync(new URL(rel, VECTORS), "utf8");

const manifest = JSON.parse(realText("conformance/corpus-manifest.json")) as {
  areas: { id: string; file: string }[];
};
const seal = JSON.parse(realText("conformance/corpus-seal.json")) as CorpusSeal;

/** A reader over the real corpus with specific paths overridden — the tamper is the override. */
function readerWith(overrides: Record<string, string>): CorpusReader {
  return {
    bytes: (rel) =>
      rel in overrides
        ? new TextEncoder().encode(overrides[rel] as string)
        : realBytes(rel),
    text: (rel) =>
      rel in overrides ? (overrides[rel] as string) : realText(rel),
  };
}
/** Re-seal a mutated seal so it is internally consistent — the tamper a naive gate would not catch. */
const resealed = (s: CorpusSeal): string =>
  JSON.stringify({ ...s, root: computeRoot(s) });

describe("the packaged corpus", () => {
  it("verifies against its own seal and the compiled anchor", () => {
    const p = verifyCorpusSeal(readerWith({}), manifest.areas);
    expect(p.sealed).toBe(true);
    expect(p.authentic).toBe(true);
    if (!p.sealed) return;
    expect(p.root).toBe(CORPUS_ROOT);
    expect(p.areas.actual).toBe(p.areas.expected);
    expect(p.cases.actual).toBe(p.cases.expected);
  });

  it("the generator and the verifier compute the same root — they are a matched pair", () => {
    // `scripts/corpus-seal.mjs` writes the root and `seal.ts` recomputes it. Two implementations of one
    // formula drift silently; this is the test that makes the drift loud.
    expect(computeRoot(seal)).toBe(seal.root);
  });
});

describe("truncation and tampering", () => {
  it("REFUSES a corpus whose area file has lost cases, and names the area", () => {
    const area = manifest.areas[0] as { id: string; file: string };
    const shrunk = JSON.parse(realText(area.file)) as { cases: unknown[] };
    shrunk.cases = shrunk.cases.slice(0, 1);
    expect(() =>
      verifyCorpusSeal(
        readerWith({ [area.file]: JSON.stringify(shrunk) }),
        manifest.areas,
      ),
    ).toThrow(new RegExp(`area ${area.id}.*cases, found 1`, "s"));
  });

  it("REFUSES a corpus whose file bytes changed at all, and names the file", () => {
    const area = manifest.areas[0] as { id: string; file: string };
    const edited = JSON.parse(realText(area.file)) as {
      cases: { name: string }[];
    };
    (edited.cases[0] as { name: string }).name = "renamed";
    expect(() =>
      verifyCorpusSeal(
        readerWith({ [area.file]: JSON.stringify(edited) }),
        manifest.areas,
      ),
    ).toThrow(new RegExp(area.file.replace(/[/.]/g, "\\$&")));
  });

  it("REFUSES when the MANIFEST has dropped an area the seal still knows about", () => {
    // The original defect precisely: an area removed from the manifest was not skipped and not failed. It
    // ceased to exist, and the run stayed green with a smaller pass count.
    const dropped = manifest.areas[0] as { id: string };
    expect(() =>
      verifyCorpusSeal(readerWith({}), manifest.areas.slice(1)),
    ).toThrow(
      new RegExp(
        `area ${dropped.id} is in the seal but missing from the manifest`,
      ),
    );
  });

  it("REFUSES a seal edited to match a truncation — its own entries no longer compute its stated root", () => {
    const forged: CorpusSeal = {
      ...seal,
      totals: { ...seal.totals, cases: seal.totals.cases - 5 },
    };
    expect(() =>
      verifyCorpusSeal(
        readerWith({
          "conformance/corpus-seal.json": JSON.stringify(forged),
        }),
        manifest.areas,
      ),
    ).toThrow(/internally inconsistent/);
  });

  it("a CONSISTENTLY re-sealed corpus is caught by the compiled anchor — the reason the root is not stored only in the tree", () => {
    // The attack a seal-beside-the-corpus cannot survive: truncate an area file, update its digest and
    // count in the seal, and recompute the seal's own root so everything agrees. Every check that reads
    // only the tree now passes. The compiled `CORPUS_ROOT` is the one statement the attacker did not get
    // to rewrite, so the verdict comes back `authentic: false` rather than green.
    const area = manifest.areas[0] as { id: string; file: string };
    const shrunk = { cases: [] as unknown[] };
    const shrunkText = JSON.stringify(shrunk);
    const consistent: CorpusSeal = {
      ...seal,
      totals: {
        areas: seal.totals.areas,
        cases:
          seal.totals.cases -
          (seal.areas.find((a) => a.id === area.id)?.cases ?? 0),
      },
      areas: seal.areas.map((a) => (a.id === area.id ? { ...a, cases: 0 } : a)),
      files: seal.files.map((f) =>
        f.path === area.file ? { ...f, sha256: sha256OfText(shrunkText) } : f,
      ),
    };
    const p = verifyCorpusSeal(
      readerWith({
        [area.file]: shrunkText,
        "conformance/corpus-seal.json": resealed(consistent),
      }),
      manifest.areas,
    );
    expect(p.sealed).toBe(true);
    expect(p.authentic).toBe(false); // <- the whole design, in one assertion
    if (p.sealed) expect(p.root).not.toBe(CORPUS_ROOT);
  });
});

describe("an unsealed tree", () => {
  it("is a GAP, not an error — it reports actual counts and claims no completeness", () => {
    const p = verifyCorpusSeal(
      {
        bytes: realBytes,
        text: (rel) => {
          if (rel === "conformance/corpus-seal.json") {
            const e = new Error("ENOENT") as NodeJS.ErrnoException;
            e.code = "ENOENT";
            throw e;
          }
          return realText(rel);
        },
      },
      manifest.areas,
    );
    expect(p.sealed).toBe(false);
    expect(p.authentic).toBe(false);
    expect(p.areas.actual).toBe(manifest.areas.length);
    expect("expected" in p.areas).toBe(false);
  });

  it("but an unreadable-for-another-reason seal still THROWS — only ENOENT means unsealed", () => {
    expect(() =>
      verifyCorpusSeal(
        {
          bytes: realBytes,
          text: (rel) => {
            if (rel === "conformance/corpus-seal.json") {
              const e = new Error("EACCES") as NodeJS.ErrnoException;
              e.code = "EACCES";
              throw e;
            }
            return realText(rel);
          },
        },
        manifest.areas,
      ),
    ).toThrow(/EACCES/);
  });
});

/** Test-local digest, deliberately NOT imported from seal.ts: a tamper fixture that shares the code under
 *  test would agree with its mistakes. */
function sha256OfText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("gaps the mutation ratchet found", () => {
  it("computeRoot is order-INDEPENDENT over areas — a reordered seal has the same root", () => {
    // The generator emits areas already sorted, so the sort inside computeRoot never changed anything and
    // every mutant of it survived. It is not decoration: the root must be a function of the CONTENT, or a
    // seal rewritten by a different JSON serializer would read as a different corpus.
    const reversed: CorpusSeal = { ...seal, areas: [...seal.areas].reverse() };
    expect(computeRoot(reversed)).toBe(computeRoot(seal));
  });

  it("REFUSES an area the manifest has but the seal does not — the other direction of the set check", () => {
    // The seal-has-it/manifest-lost-it direction was covered; this one was not, and it is the case a
    // freshly added area hits before anyone re-seals.
    expect(() =>
      verifyCorpusSeal(readerWith({}), [
        ...manifest.areas,
        { id: "zz.unsealed", file: manifest.areas[0]?.file as string },
      ]),
    ).toThrow(/area zz\.unsealed is in the manifest but not in the seal/);
  });

  it("reports expected and actual as SEPARATE numbers, from separate sources", () => {
    // `expected` comes from the seal's stated totals, `actual` from counting the tree. Collapsing them —
    // reporting either one twice — would make a shortfall invisible in exactly the case the counts exist
    // for, and both mutants of the object literal survived until this asserted them apart.
    const p = verifyCorpusSeal(readerWith({}), manifest.areas);
    if (!p.sealed) throw new Error("packaged corpus must be sealed");
    expect(p.areas.expected).toBe(seal.totals.areas);
    expect(p.cases.expected).toBe(seal.totals.cases);
    expect(p.areas.actual).toBe(manifest.areas.length);
    expect(p.cases.actual).toBe(
      manifest.areas.reduce(
        (n, a) =>
          n +
          (JSON.parse(realText(a.file)) as { cases: unknown[] }).cases.length,
        0,
      ),
    );
  });
});
