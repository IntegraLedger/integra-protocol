/**
 * THE DOCUMENTATION IS A PROJECTION OF THE TREE, AND IS CHECKED AGAINST IT.
 *
 * `docs/developer/` describes machine-readable facts in prose: which rails exist, what each manifest
 * declares, how large the corpus is, what `pnpm verify` runs. Every one of those is derivable, and every
 * one of them was wrong somewhere.
 *
 * ★ WHY THIS FILE EXISTS. The 2026-08-10 sweep found thirteen contradictions between `docs/developer/` and
 * the manifests it describes — `evm:escrow` documented as forward-indexable when its manifest says `false`,
 * `canton` as zero-party-recoverable when it says `false`, a thirteen-rail set presented as a twelve-row
 * table headed "All twelve", "four rails declare `true`" over a set of three, a corpus of 823 that has
 * been 812 since the ACP retirement, and two verify chains three stages short. Not one of them was a
 * judgement call; each was a fact the tree already knew and the prose had copied by hand and then outlived.
 *
 * ★ WHY `check:docs` DID NOT CATCH THEM. It typechecks ` ```ts ` fences, which is a real gate and finds
 * real breakage — but every one of the thirteen sits in a ` ```text ` block or in ordinary prose, which is
 * exactly the region a TypeScript compiler cannot see. Widening it to text fences is not the answer either:
 * a text block has no type to check. The answer is to derive the claim and compare, which is what
 * `check:docs` already does for its own file count, refusing to run against a number it did not compute.
 *
 * ★ WHY IT LIVES HERE. It needs every binding manifest at once, which is what this package is and what its
 * dependency list already carries. A docs gate that had to re-import thirteen packages to exist would be a
 * second copy of this package.
 *
 * ★ WHAT IT DELIBERATELY DOES NOT DO. It does not assert prose *wording* — only numbers and table contents.
 * A doc that explains a fact differently is doing its job; a doc that states a different fact is not.
 */
import { readFileSync } from "node:fs";
import { APTOS_MANIFEST } from "@integraledger/lcp-binding-aptos";
import { CANTON_MANIFEST } from "@integraledger/lcp-binding-canton";
import { CANTON_X402_MANIFEST } from "@integraledger/lcp-binding-canton-x402";
import { CARDANO_MANIFEST } from "@integraledger/lcp-binding-cardano";
import type { BindingManifest } from "@integraledger/lcp-binding-core";
import { ESCROW_MANIFEST } from "@integraledger/lcp-binding-evm-escrow";
import { MPP_EVM_MANIFEST } from "@integraledger/lcp-binding-evm-mpp";
import { X402_MANIFEST } from "@integraledger/lcp-binding-evm-x402";
import { HEDERA_MANIFEST } from "@integraledger/lcp-binding-hedera";
import { SOLANA_MANIFEST } from "@integraledger/lcp-binding-solana";
import { STELLAR_MANIFEST } from "@integraledger/lcp-binding-stellar";
import { SUI_MANIFEST } from "@integraledger/lcp-binding-sui";
import { TEMPO_MPP_MANIFEST } from "@integraledger/lcp-binding-tempo-mpp";
import { XRPL_MANIFEST } from "@integraledger/lcp-binding-xrpl";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(`${ROOT}${rel}`, "utf8");

/** Every shipped rail manifest. A new binding that is not added here fails the membership check below. */
const MANIFESTS: readonly BindingManifest[] = [
  APTOS_MANIFEST,
  CANTON_MANIFEST,
  CANTON_X402_MANIFEST,
  CARDANO_MANIFEST,
  ESCROW_MANIFEST,
  MPP_EVM_MANIFEST,
  X402_MANIFEST,
  HEDERA_MANIFEST,
  SOLANA_MANIFEST,
  STELLAR_MANIFEST,
  SUI_MANIFEST,
  TEMPO_MPP_MANIFEST,
  XRPL_MANIFEST,
];

const RAILS = MANIFESTS.map((m) => m.rail).sort();
const yesNo = (b: boolean): string => (b ? "yes" : "no");

/**
 * The rail ids a markdown table names, in document order.
 *
 * Scans the whole row rather than one column: the recovery table keys on the rail, the carrier table keys
 * on the package and carries the rail beside it, and a gate that assumed either shape would silently
 * measure nothing on the other — which is how a blind gate is built.
 */
function tableRails(markdown: string, headerCell: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`| ${headerCell} |`));
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    for (const m of line.matchAll(/`([a-z0-9:-]+)`/g))
      if (RAILS.includes(m[1] as string)) out.push(m[1] as string);
  }
  return out;
}

/** The single number a sentence carries, as a word. Numbers in this prose are written out. */
const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
] as const;
const word = (n: number): string => WORDS[n] ?? String(n);

describe("docs/developer describes the tree the tree actually is", () => {
  const welds = read("docs/developer/concepts/welds.md");

  it("reads the documents it claims to check", () => {
    // The blind-gate canary: a walker pointed at a moved file reports clean forever.
    expect(welds.length).toBeGreaterThan(5_000);
    expect(MANIFESTS).toHaveLength(13);
  });

  it("the recovery table lists every rail, once", () => {
    expect(tableRails(welds, "Rail").sort()).toEqual(RAILS);
  });

  it("the carrier table lists every rail, once", () => {
    expect(tableRails(welds, "Package").sort()).toEqual(RAILS);
  });

  it("every recovery-table cell matches the manifest it describes", () => {
    const rows = new Map<string, string>();
    for (const line of welds.split("\n")) {
      const m = line.match(
        /^\| `([a-z0-9:]+)` \| `([a-z-]+)` \| \*{0,2}(yes|no)\*{0,2} \| \*{0,2}(yes|no)\*{0,2} \|$/,
      );
      if (m) rows.set(m[1] as string, `${m[2]}/${m[3]}/${m[4]}`);
    }
    const documented = [...rows].sort().map(([r, v]) => `${r} ${v}`);
    const declared = MANIFESTS.map(
      (m) =>
        `${m.rail} ${m.assetBinding}/${yesNo(m.recovery.zeroPartyRecoverable)}/${yesNo(m.recovery.forwardIndexable)}`,
    ).sort();
    expect(documented).toEqual(declared);
  });

  it("the prose counts are the counts", () => {
    const rails = MANIFESTS.length;
    const fwd = MANIFESTS.filter((m) => m.recovery.forwardIndexable).length;
    const notZero = MANIFESTS.filter(
      (m) => !m.recovery.zeroPartyRecoverable,
    ).length;
    const onChain = MANIFESTS.filter((m) => m.recovery.onChain).length;
    // Each assertion names the sentence it guards, so a failure says which line to edit.
    expect(welds, "«All <n> declare recovery.onChain: true»").toContain(
      `All ${word(onChain)} declare \`recovery.onChain: true\``,
    );
    expect(welds, "«<n> rails answer no» — zero-party").toContain(
      `${word(notZero).replace(/^./, (c) => c.toUpperCase())} rails answer no`,
    );
    expect(welds, "«<n> rails declare `true`» — forward-indexable").toContain(
      `${word(fwd).replace(/^./, (c) => c.toUpperCase())} rails declare \`true\``,
    );
    expect(welds, "«The other <n> declare `false`»").toContain(
      `other ${word(rails - fwd)} declare \`false\``,
    );
  });

  it("the successGate split is the split", () => {
    const guide = read("docs/developer/guides/implement-a-binding.md");
    const raw = MANIFESTS.filter((m) => m.successGate === "raw-field").length;
    const structural = MANIFESTS.length - raw;
    expect(guide, "«<n> raw-field / <n> structural»").toContain(
      `${word(raw)} \`raw-field\` and ${word(structural)} \`structural\``,
    );
  });

  it("the pattern split is the split, and id-reuse is counted from it", () => {
    const guide = read("docs/developer/guides/implement-a-binding.md");
    const native = MANIFESTS.filter((m) => m.pattern === "native-field").length;
    const overlay = MANIFESTS.filter(
      (m) => m.pattern === "overlay-contract",
    ).length;
    expect(guide, "«the answer on <n> of the <n> shipped rails»").toContain(
      `the answer on ${word(native)} of the ${word(MANIFESTS.length)}`,
    );
    // `id-reuse` is whatever is left, and the guide names its ordinal. Ordinal = native + overlay + 1.
    expect(guide, "«The <ordinal> is `id-reuse`»").toContain(
      `The ${word(native + overlay + 1)}th is \`id-reuse\``,
    );
  });

  it("every `recover` behaviour in verify-a-settlement covers every rail", () => {
    const guide = read("docs/developer/guides/verify-a-settlement.md");
    const named = new Set<string>();
    for (const line of guide.split("\n")) {
      if (!line.startsWith("| `")) continue;
      for (const m of (line.split("|")[1] ?? "").matchAll(/`([a-z0-9:]+)`/g))
        if (RAILS.includes(m[1] as string)) named.add(m[1] as string);
    }
    expect([...named].sort()).toEqual(RAILS);
    expect(guide, "«across the <n> rails»").toContain(
      `across the ${word(MANIFESTS.length)} rails`,
    );
  });

  it("the corpus size in the docs is the corpus size", () => {
    const seal = JSON.parse(read("vectors/conformance/corpus-seal.json")) as {
      areas: Record<string, { cases: number }>;
    };
    const cases = Object.values(seal.areas).reduce((n, a) => n + a.cases, 0);
    // Any `conformance: N passed` line in the docs is a real run's output or a lie about one — but only
    // FULL-corpus runs are comparable. A `--phase` example legitimately totals less, and says so by
    // printing a non-zero skip count, which is the runner's own way of refusing to look complete.
    //
    // The allowed totals are the corpus, or the corpus plus one: `add-a-placement` walks the reader
    // through adding a vector and running BEFORE implementing, so its example totals `cases + 1`. Anything
    // else is a number nobody re-ran — which is how 823 outlived the corpus by eleven cases.
    for (const file of [
      "docs/developer/guides/add-a-placement.md",
      "docs/developer/guides/run-conformance.md",
      "packages/conformance/README.md",
    ])
      for (const m of read(file).matchAll(
        /conformance: (\d+) passed, (\d+) failed, (\d+) skipped/g,
      )) {
        if (Number(m[3]) > 0) continue;
        expect(
          [cases, cases + 1],
          `${file}: ${m[0]} totals ${Number(m[1]) + Number(m[2])}, and the corpus is ${cases}`,
        ).toContain(Number(m[1]) + Number(m[2]));
      }
  });

  it("every documented `pnpm verify` chain is the chain package.json runs", () => {
    const script = (
      JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    ).scripts["verify"] as string;
    // The stage names, in order, as a reader would list them.
    const stages = script
      .split("&&")
      .map((s) => s.trim())
      .map((s) =>
        s
          .replace(/^pnpm (-r )?/, "")
          .replace(/^node scripts\/([a-z-]+)\.mjs/, "$1")
          .replace(/ .*$/, ""),
      );
    for (const file of [
      "README.md",
      "AGENTS.md",
      "CONTRIBUTING.md",
      "docs/developer/guides/implement-a-binding.md",
      "docs/developer/guides/add-a-placement.md",
    ]) {
      const text = read(file);
      for (const m of text.matchAll(/pnpm verify\s+#([^\n]*)\n?([^\n]*)/g)) {
        const documented = `${m[1]} ${m[2] ?? ""}`
          .replace(/#/g, " ")
          .split("→")
          .map((s) => s.trim())
          .filter(Boolean);
        if (documented.length < 2) continue;
        expect(
          documented.length,
          `${file}: documents ${documented.length} verify stages, the script runs ${stages.length} (${stages.join(" → ")})`,
        ).toBe(stages.length);
      }
    }
  });
});
