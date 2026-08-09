/**
 * The TIP-20 memo LOG reader — PURE, CHAIN-LEVEL, MPP-free. This is the half that makes the binding
 * recoverable and indexable, and it is deliberately separable from the MPP challenge handling so a
 * bare-TIP-20 binding can reuse it (LCP §C.1's note that the chain-level property is independent of MPP).
 *
 * Four observations shape this module, none of which is in LCP's Appendix C; the
 * first three come from a real mainnet settlement and the fourth from the token standard itself:
 *
 * 1. **A memo transfer emits TWO logs** — the standard ERC-20 `Transfer` and `TransferWithMemo`. Matching
 *    `Transfer` finds no memo, so `parseTransferWithMemoLog` refuses everything but topic 0.
 * 2. **`TransferWithMemo` is emitted for transfers, MINTS and BURNS** ("Emitted when a transfer, mint, or
 *    burn is performed with an attached memo"; `from = address(0)` for mints, `to = address(0)` for burns).
 *    An issuer can therefore put any 32 bytes on this topic with nobody paying anybody, so the parsed
 *    event carries an explicit `movement` and callers must not treat a mint as a settlement.
 * 3. **A virtual-address recipient is resolved before the event is emitted** — "the effective recipient
 *    becomes the registered master wallet, and authorization, balance updates, and event emission target
 *    that master wallet". So `to` is not necessarily the address the seller advertised, and enumeration
 *    filters on the memo topic and the TOKEN rather than on a recipient.
 * 4. **The memo topic identifies a reference; it does not authenticate an emitter.** TIP-20 tokens are
 *    permissionlessly creatable and every one of them emits this same event with any 32 bytes it likes, so
 *    a log is only evidence of a settlement once it is scoped to the token the seller advertised. Nothing
 *    in this module decides which token that is — it decodes and reports `address`, and the adapter
 *    scopes. `TempoLogRange.address` is required so the query cannot be built unscoped.
 */
import { requireTip20Token, TRANSFER_WITH_MEMO_TOPIC0 } from "./constants.js";
import { addressFromTopic, quantityToNumber, uint256FromData } from "./hex.js";
import { decodeAtrMemo, requireMemo } from "./memo.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** One EVM log in the shape `eth_getLogs` / `eth_getTransactionReceipt` return it. */
export interface TempoLogView {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly transactionHash?: string;
  /** JSON-RPC quantity (`"0x3"`) or plain number. */
  readonly logIndex?: string | number;
  readonly blockNumber?: string | number;
}

/** Which kind of token movement a `TransferWithMemo` log recorded. */
export type TokenMovement = "transfer" | "mint" | "burn";

/** A decoded `TransferWithMemo(from, to, amount, memo)`. */
export interface TransferWithMemoEvent {
  /** The emitting TIP-20 token, lower-cased. */
  readonly address: string;
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly amount: bigint;
  readonly memo: `0x${string}`;
  readonly movement: TokenMovement;
}

/** A Tempo settlement reference — a transaction hash, optionally narrowed to one log. */
export interface TempoSettlementRef {
  readonly txHash: string;
  readonly logIndex?: number;
}

/** The block window an enumeration covers — the half a caller chooses. */
export interface TempoBlockRange {
  readonly fromBlock: string | number;
  readonly toBlock: string | number;
}

/**
 * A block window scoped to ONE TIP-20 token. `address` is REQUIRED and there is deliberately no
 * every-token spelling: the memo topic identifies a reference, it does not authenticate an emitter, and
 * TIP-20 token creation is permissionless (see `TIP20_FACTORY_ADDRESS`). An unscoped memo query returns
 * any token's log for that memo, including a token the attacker minted.
 */
export interface TempoLogRange extends TempoBlockRange {
  readonly address: string;
}

/** The `eth_getLogs` filter that indexes settlements by memo, within one token. */
export interface TempoMemoLogFilter {
  readonly address: string;
  readonly topics: readonly [string, null, null, `0x${string}`];
  readonly fromBlock: string | number;
  readonly toBlock: string | number;
}

/**
 * Decode one log as `TransferWithMemo`, or `null` when it is not one (a scan skips it). It reports the
 * emitting token in `address` and never judges it: which token counts is the adapter's scope, not the
 * decoder's.
 */
export function parseTransferWithMemoLog(
  log: TempoLogView,
): TransferWithMemoEvent | null {
  const [signature, fromTopic, toTopic, memoTopic] = log.topics;
  if (signature === undefined) return null;
  if (signature.toLowerCase() !== TRANSFER_WITH_MEMO_TOPIC0) return null;
  if (
    fromTopic === undefined ||
    toTopic === undefined ||
    memoTopic === undefined
  )
    return null;
  const from = addressFromTopic(fromTopic);
  const to = addressFromTopic(toTopic);
  const memo = decodeAtrMemo(memoTopic);
  const amount = uint256FromData(log.data);
  if (from === null || to === null || memo === null || amount === null)
    return null;
  const movement: TokenMovement =
    from === ZERO_ADDRESS ? "mint" : to === ZERO_ADDRESS ? "burn" : "transfer";
  return {
    address: log.address.toLowerCase(),
    from,
    to,
    amount,
    memo,
    movement,
  };
}

/** Every `TransferWithMemo` in a set of logs, in the order given (a split emits one per recipient). */
export function readTransferWithMemoEvents(
  logs: readonly TempoLogView[],
): TransferWithMemoEvent[] {
  const events: TransferWithMemoEvent[] = [];
  for (const log of logs) {
    const event = parseTransferWithMemoLog(log);
    if (event !== null) events.push(event);
  }
  return events;
}

/**
 * The settlement reference a log belongs to. THROWS when the log carries no `transactionHash`: every log a
 * node returns has one, so its absence is a broken transport, not a policy outcome — and silently dropping
 * the log would understate an enumeration.
 */
export function settlementRefOf(log: TempoLogView): TempoSettlementRef {
  const txHash = log.transactionHash;
  if (txHash === undefined)
    throw new Error(
      "settlementRefOf: the log carries no transactionHash — a log cannot be attributed to a settlement without one",
    );
  const logIndex = quantityToNumber(log.logIndex);
  return logIndex === null ? { txHash } : { txHash, logIndex };
}

/**
 * Build the `eth_getLogs` filter that makes this binding forward-indexable: the token pinned as
 * `address`, topic 0 pinned to the event, `from` and `to` left open, and the memo pinned as topic 3. One
 * query returns every settlement of that token ever bound to one reference.
 *
 * `from`/`to` are open because TIP-20 resolves a virtual-address recipient to its master wallet before
 * emitting, so filtering on the advertised recipient would miss real settlements. The token is NOT open,
 * for the opposite reason: any address may create a TIP-20 token, so the emitter is the only part of this
 * filter that establishes whose settlement it is.
 */
export function tempoMemoLogFilter(
  memo: string,
  range: TempoLogRange,
): TempoMemoLogFilter {
  const topic = requireMemo(memo, "tempoMemoLogFilter");
  const address = requireTip20Token(range.address, "tempoMemoLogFilter");
  const topics: readonly [string, null, null, `0x${string}`] = [
    TRANSFER_WITH_MEMO_TOPIC0,
    null,
    null,
    topic,
  ];
  return {
    address,
    topics,
    fromBlock: range.fromBlock,
    toBlock: range.toBlock,
  };
}
