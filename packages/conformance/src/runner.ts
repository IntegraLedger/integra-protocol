import { readFileSync } from "node:fs";
import { type CorpusProvenance, verifyCorpusSeal } from "./seal.js";
import type { Subject } from "./subject.js";

type Case = {
  name: string;
  input?: unknown;
  expected?: unknown;
  error?: string;
};
/** The result of a corpus run. **`passed` alone is meaningless without `corpus`** — a truncated corpus
 *  also reports a pass count, and a large one is exactly what a silently-shortened run produces. Read the
 *  provenance first, then the number. `skipped` names cases the subject declined, which is a real answer
 *  and not a failure. */
export type Report = {
  passed: number;
  skipped: string[];
  failed: { area: string; case: string; expected: unknown; got: unknown }[];
  /** What corpus this run certified against. A pass count means nothing without it — the number a
   *  truncated corpus reports is also a pass count. */
  corpus: CorpusProvenance;
};
/** Where to read the corpus from, and how far up the activation ladder to run. `phase` is CUMULATIVE —
 *  `P4` runs every area at or below P4, not only P4's own — and defaults to the full set. Passing
 *  `vectors` points the runner at a corpus other than the packed one, which is also what waives the
 *  seal's authenticity refusal, so use it only when you know why. */
export type RunOptions = { vectors: URL; phase?: string };

/**
 * The ordered activation ladder. An area's manifest `phase` is immutable provenance — it records the
 * activation stage that wired the area and is never edited afterwards, and the manifest ships packed
 * with the runner, so a consumer cannot re-stage an area independently of the corpus that certifies it.
 *
 * P8 is appended after P6 while P5 and P6 still have no areas. That is not a jump past two wired phases; it
 * is a jump past two EMPTY ones. The floor is cumulative, so running at P8 runs every area at or below it —
 * with P5/P6 empty, exactly the set P4 runs today plus P8's own. No existing area changes its activation,
 * and nothing sits between them to be reordered, so numeric order and activation order stay consistent.
 */
const PHASES = ["P1", "P3", "P4", "P5", "P6", "P8"];
function phaseIndex(p: string): number {
  const i = PHASES.indexOf(p);
  if (i === -1) throw new Error(`unknown phase: ${p}`);
  return i;
}

/**
 * Run every area whose `phase` is AT OR BELOW the requested phase (default "P1") from the given
 * tree. The comparison is CUMULATIVE — a floor, never an exact match: running at "P3" exercises
 * the whole P1 corpus too, so a later phase can never produce a confident green that skipped the
 * kernel. Later-phase areas are skipped, never failed. The tree location is explicit — the caller
 * states which tree certifies (the repo tree in-repo; the packaged copy via the CLI default).
 * No guessing, no fallback.
 */
export async function runCorpus(
  subject: Subject,
  opts: RunOptions,
): Promise<Report> {
  const read = (rel: string): unknown =>
    JSON.parse(readFileSync(new URL(rel, opts.vectors), "utf8"));
  const upTo = phaseIndex(opts.phase ?? "P1");
  const manifest = read("conformance/corpus-manifest.json") as {
    areas: {
      id: string;
      file: string;
      class: string;
      phase: string;
      schema?: string;
    }[];
  };
  // Establish WHAT is being certified against before certifying anything. The seal is verified over the
  // whole manifest, never the phase-filtered subset: a truncation that removed a later-phase area would
  // otherwise hide behind `--phase`, and "this run skipped it" and "this corpus no longer has it" are the
  // two readings the whole seal exists to separate.
  const corpus = verifyCorpusSeal(
    {
      bytes: (rel) => readFileSync(new URL(rel, opts.vectors)),
      text: (rel) => readFileSync(new URL(rel, opts.vectors), "utf8"),
    },
    manifest.areas,
  );
  const report: Report = { passed: 0, skipped: [], failed: [], corpus };
  for (const area of manifest.areas) {
    if (phaseIndex(area.phase) > upTo) {
      report.skipped.push(area.id);
      continue;
    }
    const schema = area.schema === undefined ? undefined : read(area.schema); // canonical schema, passed inline (subjects stay tree-independent)
    const { cases } = read(area.file) as { cases: Case[] };
    for (const c of cases) {
      const res = await subject.handle({
        class: area.class,
        input: c.input,
        ...(schema === undefined ? {} : { schema }),
      });
      const ok =
        c.error !== undefined
          ? res.error === c.error
          : deepEqual(res.output, c.expected);
      if (ok) report.passed++;
      else
        report.failed.push({
          area: area.id,
          case: c.name,
          expected: c.error ?? c.expected,
          got: res.error ?? res.output,
        });
    }
  }
  return report;
}

// Fixtures here are order-controlled on both sides (adapter output and vector `expected` are built in the same key order),
// so JSON-string equality is sound. If an ordering-sensitive class is added later, replace with a structural compare.
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
