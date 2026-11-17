// The refusal codes that are reads to repeat, each decided from the code's meaning in docs/reference/refusals.md and
// from the code that returns it, never read from `readToRepeat`; every other code the package returns is not one. A read to
// repeat rests on a read of the rail that may answer differently later, with nothing the caller must change: a reader
// that failed or answered out of its documented form, no landed transaction yet, or a transaction not final yet. Every
// other code is a verdict that a later read answers the same way, or a call the caller must change before it can
// succeed: a reader for another network or a ref it cannot read, a push credential read before `fetchPresented`, a
// missing peer dependency, or malformed input.

/** The reads to repeat. */
export const READS_TO_REPEAT: readonly string[] = [
  "avm/not-found",
  "avm/unreadable",
  "cardano/not-found",
  "cardano/unreadable",
  "casper/not-executed",
  "casper/not-found",
  "casper/unreadable",
  "ccd/not-finalized",
  "ccd/not-found",
  "ccd/unreadable",
  "evm/not-final",
  "evm/not-found",
  "evm/unreadable",
  "hedera/not-found",
  "hedera/unreadable",
  "near/not-found",
  "near/unreadable",
  "polkadot/not-final",
  "polkadot/not-found",
  "polkadot/unreadable",
  "stacks/not-final",
  "stacks/not-found",
  "stacks/unreadable",
  "starknet/not-final",
  "starknet/not-found",
  "starknet/unreadable",
  "stellar/not-found",
  "stellar/unreadable",
  "sui/not-found",
  "sui/unreadable",
  "svm/not-final",
  "svm/not-found",
  "svm/unreadable",
  "tempo/not-final",
  "tempo/not-found",
  "tempo/unreadable",
  "tron/not-found",
  "tron/unreadable",
  "tvm/not-found",
  "tvm/unreadable",
  "xrpl/not-found",
  "xrpl/not-validated",
  "xrpl/unreadable",
];
