/**
 * The refusal codes that are reads to repeat: each rests on a read of the rail that may answer differently later, with
 * nothing the caller must change. `readToRepeat` answers from this set, and `node scripts/docs-reference.mjs` marks each
 * of these codes in `docs/reference/refusals.md` from it. Its `--check` fails when the page's marks differ from this
 * set, or when this set holds a code the page does not list.
 */
export const READS_TO_REPEAT: ReadonlySet<string> = new Set([
  // The reader failed, or answered out of its documented form.
  "avm/unreadable",
  "cardano/unreadable",
  "casper/unreadable",
  "ccd/unreadable",
  "evm/unreadable",
  "hedera/unreadable",
  "near/unreadable",
  "polkadot/unreadable",
  "stacks/unreadable",
  "starknet/unreadable",
  "stellar/unreadable",
  "sui/unreadable",
  "svm/unreadable",
  "tempo/unreadable",
  "tron/unreadable",
  "tvm/unreadable",
  "xrpl/unreadable",
  // The reader holds no landed transaction for the reference yet.
  "avm/not-found",
  "cardano/not-found",
  "casper/not-found",
  "ccd/not-found",
  "evm/not-found",
  "hedera/not-found",
  "near/not-found",
  "polkadot/not-found",
  "stacks/not-found",
  "starknet/not-found",
  "stellar/not-found",
  "sui/not-found",
  "svm/not-found",
  "tempo/not-found",
  "tron/not-found",
  "tvm/not-found",
  "xrpl/not-found",
  // The transaction is not final yet: not executed, not finalized, not in a validated ledger, reverted in a block
  // above the reader's `finalized` mark, which can be replaced by one in which it succeeds, or failed with an error at
  // Solana's `confirmed` and not found at `finalized`.
  "casper/not-executed",
  "ccd/not-finalized",
  "hedera/not-final",
  "svm/not-final",
  "tempo/not-final",
  "xrpl/not-validated",
]);
