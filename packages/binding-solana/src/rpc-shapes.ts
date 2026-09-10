/**
 * THE SOLANA JSON-RPC SHAPES THIS BINDING READS, DECLARED HERE RATHER THAN IMPORTED FROM AN SDK.
 *
 * This package used to import six types and two classes from `@solana/web3.js`. It needed the SDK for
 * almost nothing — five of the imports were `type` only, erased at build — and it paid for all of it:
 * `@solana/web3.js` depends on `jayson`, which depends on `stream-json`, which carried a moderate
 * advisory (GHSA-528h-pc64-c93x) that turned `pnpm audit` red and, because `release.yml` runs on a
 * successful `ci`, held the release train. No override could fix it: `stream-json` 3.5.0 and 3.6.0 both
 * moved their modules under `src/` and renamed them to kebab-case, so `stream-json/streamers/StreamValues`
 * — the path `jayson` requires — resolves at NO fixed version.
 *
 * The shapes below are the WIRE, which is what a binding actually depends on. Solana's `jsonParsed`
 * encoding returns `programId` as a base58 STRING; the SDK wraps it in a `PublicKey` and this package
 * immediately called `.toBase58()` to get the string back. Declaring the wire directly is both smaller and
 * more honest: it says what the RPC sends, and it lets a consumer bring any SDK, or none.
 *
 * ⚠️ **A `@solana/web3.js` `Connection` does NOT satisfy {@link SolanaRpc} structurally, and saying so
 * would be the kind of claim this package exists to avoid.** Its `getSignaturesForAddress` takes a
 * `PublicKey`; the port takes the base58 string the wire carries. The two-line wrapper that bridges them
 * is the consumer's, and `test/integration.onchain.test.ts` writes it out in full against a live devnet
 * connection — which is the honest demonstration that the port is wirable, rather than an assertion that
 * it is already wired.
 */

/** One instruction as `jsonParsed` reports it. `programId` is base58, as the wire sends it. */
export type ParsedInstructionShape =
  // ⛔ DISCRIMINATED, and the discriminant is which member EXISTS. The RPC parses an instruction it knows
  // (the Memo program's `parsed` is a plain string) and leaves one it does not as base58 `data`. An
  // optional `parsed` would make `"parsed" in ins` unable to narrow, which is exactly the branch this
  // binding turns on to keep a genuinely welded settlement from reading as unwelded.
  | { readonly programId: string; readonly parsed: unknown }
  | { readonly programId: string; readonly data: string };

/** The confirmed-transaction shape this binding reads, and nothing more of it than that. */
export interface ParsedTransactionShape {
  readonly transaction: {
    readonly message: {
      readonly instructions: readonly ParsedInstructionShape[];
    };
  };
  readonly meta: {
    readonly err: unknown;
    readonly innerInstructions?: readonly {
      readonly instructions: readonly ParsedInstructionShape[];
    }[];
  } | null;
}

/**
 * The two reads this binding performs, as a PORT.
 *
 * A consumer wires it to whatever they already have — an SDK client or a bare `fetch` against a JSON-RPC
 * endpoint — in a few lines. This package installs no SDK to offer it, which is the point: a binding that
 * shipped one would make every consumer run the version it chose.
 */
export interface SolanaRpc {
  getParsedTransaction(
    signature: string,
    config?: { readonly maxSupportedTransactionVersion?: number },
  ): Promise<ParsedTransactionShape | null>;
  /** ⛔ The ADDRESS AS BASE58, which is what the wire carries. An SDK that wants its own address type is
   *  the caller's to bridge — two lines, and the live integration test shows them. */
  getSignaturesForAddress(
    address: string,
    config?: { readonly limit?: number },
  ): Promise<readonly { readonly signature: string }[]>;
}

/**
 * An SPL Memo instruction, as a plain value.
 *
 * It was a `@solana/web3.js` `TransactionInstruction`. Returning the SDK's class made this package the
 * arbiter of which SDK version a consumer runs, for a value that is three fields. `programId` is base58
 * and `data` is the memo bytes; a caller hands both to whatever builder their SDK provides.
 */
export interface SolanaInstruction {
  readonly keys: readonly never[];
  readonly programId: string;
  readonly data: Uint8Array;
}
