/**
 * Corpus seal verification — does this runner have the whole, unaltered corpus?
 *
 * The question is not rhetorical. `report.skipped` derives from the same manifest a truncation would edit,
 * so before this module a shrunken corpus reported fewer passes, zero skips, and exit 0. Every consumer of
 * this package runs it to certify their own implementation, and a certifier that cannot detect its own
 * truncation certifies whatever it happens to hold.
 *
 * Three checks, in order, because each one's failure means something different:
 *
 *  1. **Per-file digest.** A file the seal names whose bytes differ. Named individually so the failure says
 *     WHICH file, not just that something moved.
 *  2. **Per-area case count and the area set.** A manifest that has lost an area, or an area file that has
 *     lost cases. Redundant with the digests for detection and not redundant at all for diagnosis: "27 of
 *     31 cases" is actionable where "sha mismatch" is not.
 *  3. **Root against the compiled anchor.** The seal states a root; this module recomputes it from the
 *     seal's own entries (so a hand-edited seal fails its own arithmetic) and compares it to `CORPUS_ROOT`,
 *     which is compiled into this package. That comparison is the one a corpus edit cannot satisfy on its
 *     own, and it is the difference between a seal and a checksum sitting next to the thing it checksums.
 *
 * **What is deliberately NOT checked: files ADDED to the tree.** The seal names the files it covers and
 * verifies each one; a file that is merely present and not named passes unnoticed. That is the correct
 * boundary rather than a hole, and the reasoning should not have to be rediscovered. The runner reads
 * exactly two things — `corpus-manifest.json`, and the area and schema files that manifest names — so an
 * unreferenced file is inert. Making it matter means referencing it, which means editing the manifest, and
 * the manifest is itself one of the sealed files. So the property that actually matters holds without a
 * directory walk: **every byte this runner reads is sealed.** Adding a `list` capability to `CorpusReader`
 * to detect inert additions would buy tidiness, not integrity.
 *
 * Damage (1 and 2, or a seal inconsistent with itself) THROWS: there is no honest verdict to report about a
 * corpus that is not what it says it is. Inauthenticity alone (3) does not throw — it is reported as
 * `authentic: false` with the observed root, because pointing `--vectors` at a foreign or in-development
 * tree is a supported thing to do and answering it with a crash would make the tool unusable for exactly
 * the implementers it is for. The CLI decides what to do with that verdict; see `cli.ts`.
 */
import { createHash } from "node:crypto";
import { CORPUS_ROOT } from "./corpus-root.js";

/** What the shipped seal carries. */
export type CorpusSeal = {
  root: string;
  totals: { areas: number; cases: number };
  areas: { id: string; cases: number }[];
  files: { path: string; sha256: string }[];
};

/**
 * The provenance a report states about the corpus it ran.
 *
 * A union, because an UNSEALED tree and a sealed one are different states and flattening them would
 * reintroduce the defect in miniature: reporting `44/44` for a tree that carries no statement of what 44
 * would have been is the same false reassurance as counting a truncated corpus's passes. A tree with no
 * seal has nothing to be measured against — that is a gap, and it reads as one.
 *
 * Unsealed is not an error. An implementer pointing `--vectors` at a corpus they are still writing is the
 * tool working as intended; the CLI, not this module, decides that an unrecognised corpus arriving WITH the
 * package is a refusal.
 */
export type CorpusProvenance =
  | {
      sealed: true;
      /** The root recomputed from the tree that actually ran — never copied from the seal's own claim. */
      root: string;
      /** Does that root equal the one compiled into this package? */
      authentic: boolean;
      areas: { expected: number; actual: number };
      cases: { expected: number; actual: number };
    }
  | {
      sealed: false;
      /** Never true: a tree that states no root cannot be recognised as the packaged one. */
      authentic: false;
      areas: { actual: number };
      cases: { actual: number };
    };

/** Byte reader for the corpus tree — injected so this module stays testable and free of ambient I/O. */
export type CorpusReader = {
  bytes: (rel: string) => Uint8Array;
  text: (rel: string) => string;
};

const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/**
 * Recompute the root from a seal's entries. Mirrors `scripts/corpus-seal.mjs` exactly — the two are a
 * matched pair, and the round-trip test in this package is what keeps them matched.
 */
export function computeRoot(seal: CorpusSeal): string {
  const lines = [
    ...seal.files.map((f) => `file ${f.path} ${f.sha256}`),
    ...[...seal.areas]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((a) => `area ${a.id} ${a.cases}`),
    `totals ${seal.totals.areas} ${seal.totals.cases}`,
  ];
  return sha256(lines.join("\n"));
}

/**
 * Verify the corpus in `read` against its own seal and against this package's compiled anchor.
 *
 * @throws if the corpus is damaged — a file whose bytes do not match, an area whose case count does not
 *   match, a manifest and seal that disagree on the area set, or a seal whose stated root does not follow
 *   from its own entries.
 */
export function verifyCorpusSeal(
  read: CorpusReader,
  manifestAreas: { id: string; file: string }[],
): CorpusProvenance {
  const countCases = (areas: { file: string }[]): number =>
    areas.reduce(
      (n, a) =>
        n +
        (JSON.parse(read.text(a.file)) as { cases: unknown[] }).cases.length,
      0,
    );

  let raw: string;
  try {
    raw = read.text("conformance/corpus-seal.json");
  } catch (cause) {
    // ENOENT ONLY. An unreadable-for-any-other-reason seal (a permission error, a directory where the file
    // should be) is a real fault and must not be laundered into "this tree is simply unsealed" — that would
    // turn the one condition the CLI refuses on into the one it tolerates.
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    return {
      sealed: false,
      authentic: false,
      areas: { actual: manifestAreas.length },
      cases: { actual: countCases(manifestAreas) },
    };
  }
  const seal = JSON.parse(raw) as CorpusSeal;

  // The seal must first be consistent with ITSELF. A hand-edited entry that also updated the stated root
  // would otherwise pass every per-file check below and only surface at the anchor comparison, where the
  // message would blame the wrong thing.
  const restated = computeRoot(seal);
  if (restated !== seal.root)
    throw new Error(
      `corpus seal is internally inconsistent: it states root ${seal.root.slice(0, 16)}… but its own entries compute ${restated.slice(0, 16)}…`,
    );

  const damage: string[] = [];

  for (const f of seal.files) {
    const actual = sha256(read.bytes(f.path));
    if (actual !== f.sha256)
      damage.push(
        `${f.path}: sealed ${f.sha256.slice(0, 16)}…, found ${actual.slice(0, 16)}…`,
      );
  }

  const sealedAreas = new Map(seal.areas.map((a) => [a.id, a.cases]));
  for (const area of manifestAreas) {
    const sealedCases = sealedAreas.get(area.id);
    if (sealedCases === undefined) {
      damage.push(`area ${area.id} is in the manifest but not in the seal`);
      continue;
    }
    const actual = (JSON.parse(read.text(area.file)) as { cases: unknown[] })
      .cases.length;
    if (actual !== sealedCases)
      damage.push(
        `area ${area.id} (${area.file}): sealed ${sealedCases} cases, found ${actual}`,
      );
  }
  // The direction that catches a truncated MANIFEST: an area the seal knows about and the manifest no
  // longer lists would otherwise vanish without a trace, which is the original defect exactly.
  const manifestIds = new Set(manifestAreas.map((a) => a.id));
  for (const a of seal.areas)
    if (!manifestIds.has(a.id))
      damage.push(`area ${a.id} is in the seal but missing from the manifest`);

  if (damage.length > 0)
    throw new Error(
      `corpus is not what its seal says it is — refusing to certify against it:\n  ${damage.join("\n  ")}`,
    );

  return {
    sealed: true,
    root: restated,
    authentic: restated === CORPUS_ROOT,
    areas: { expected: seal.totals.areas, actual: manifestAreas.length },
    cases: { expected: seal.totals.cases, actual: countCases(manifestAreas) },
  };
}
