import { pathToFileURL } from "node:url";

export type CliArgs = { vectors: URL; phase: string };

/** `CliArgs` plus whether the caller NAMED a tree. The seal's verdict is read differently in each case: an
 *  unrecognised corpus is a refusal when it arrived with the package and a reported fact when the caller
 *  pointed at it deliberately. Derived here rather than by comparing URLs in `cli.ts`, because a caller who
 *  passes `--vectors` at the packaged path has still made the explicit choice. */
export type ParsedCliArgs = CliArgs & { vectorsExplicit: boolean };

/**
 * Parse `lcp-conformance`'s two flags, pure over an argv array so the fail-fast contract is provable —
 * the bin itself is a top-level-await shell that runs a whole corpus on import.
 *
 * A flag present with no value is an ERROR, never a fall back to the default. `--vectors` with a
 * missing path would certify the PACKAGED tree while the caller believed it was certifying theirs,
 * and `--phase` with a missing value would run a different rung of the ladder — both produce a green
 * that answers a question nobody asked.
 */
export function parseCliArgs(
  argv: readonly string[],
  defaults: CliArgs,
): ParsedCliArgs {
  const vectorsPath = flagValue(argv, "--vectors", "--vectors requires a path");
  const phase = flagValue(argv, "--phase", "--phase requires a value");
  return {
    // A directory URL — the trailing slash is what makes the manifest resolve INSIDE the tree rather
    // than beside it, so it is added here and not left to the caller to remember.
    vectors:
      vectorsPath === undefined
        ? defaults.vectors
        : pathToFileURL(`${vectorsPath}/`),
    phase: phase ?? defaults.phase,
    vectorsExplicit: vectorsPath !== undefined,
  };
}

function flagValue(
  argv: readonly string[],
  flag: string,
  complaint: string,
): string | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value === undefined) throw new Error(complaint);
  return value;
}
