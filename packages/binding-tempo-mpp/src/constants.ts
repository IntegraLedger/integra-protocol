/**
 * Tempo chain constants for the LCP TIP-20 memo binding. CHAIN-LEVEL and MPP-FREE — everything here is a
 * property of Tempo's token standard, not of any payment protocol, so a future bare-TIP-20 binding reuses
 * this module unchanged (LCP §C.1: "the same chain-level property would also support direct-TIP-20 LCP
 * bindings outside MPP").
 *
 * Verified against the live TIP-20 specification at
 * `https://tempo.xyz/developers/docs/protocol/tip20/spec` on 2026-07-30 — note that `docs.tempo.xyz` now
 * 308-redirects there, so the URLs in older Integra research are stale. The two hashes are derived
 * independently (`cast keccak` / `cast sig`) and cross-checked against a real mainnet settlement in the
 * tests.
 */
import { isHexBytes, stripHexPrefix } from "./hex.js";

/**
 * `keccak256("TransferWithMemo(address,address,uint256,bytes32)")` — topic 0 of every memo-bearing TIP-20
 * movement. The event is `TransferWithMemo(address indexed from, address indexed to, uint256 amount,
 * bytes32 indexed memo)`, so the memo is an INDEXED parameter and is therefore queryable by topic.
 */
export const TRANSFER_WITH_MEMO_TOPIC0 =
  "0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0";

/** `bytes4(keccak256("transferWithMemo(address,uint256,bytes32)"))` — the payer-signed memo transfer. */
export const TRANSFER_WITH_MEMO_SELECTOR = "0x95777d59";

/**
 * `bytes4(keccak256("transferFromWithMemo(address,address,uint256,bytes32)"))` — the allowance-based memo
 * transfer. It emits the SAME event, but the spender chooses the memo, which is why the manifest grades
 * the two call paths differently and why the grade needs the calldata rather than the log.
 */
export const TRANSFER_FROM_WITH_MEMO_SELECTOR = "0x929c2539";

/** Where the memo sits in the log's topics: `[signature, from, to, memo]`. */
export const MEMO_TOPIC_INDEX = 3;

/** Every TIP-20 token address begins with this 12-byte prefix (the spec's reserved token range). */
export const TIP20_ADDRESS_PREFIX = "0x20c000000000000000000000";

/**
 * The `TIP20Factory` precompile — and the reason a verifier MUST be told which token it is verifying.
 * Token creation through this precompile is permissionless, every token emits the same
 * `TransferWithMemo`, and the memo accepts any 32 bytes. So an attacker's own token can emit a log that
 * looks exactly like a settlement of any reference. The prefix is therefore not a trust boundary: the
 * forgery sits inside the reserved range too. Scope to a token, never to the range.
 */
export const TIP20_FACTORY_ADDRESS =
  "0x20Fc000000000000000000000000000000000000";

/**
 * The `ReceivePolicyGuard` precompile added in the T6 network upgrade. It matters to a verifier: when a
 * receiver's policy blocks delivery **the call still succeeds** and the funds are redirected to the guard
 * to be claimed later. So a `TransferWithMemo` event proves the memo was welded to a settled movement — it
 * does NOT prove the named recipient received the funds. Those are two different facts and this binding
 * only ever claims the first.
 */
export const RECEIVE_POLICY_GUARD_ADDRESS =
  "0xB10C000000000000000000000000000000000000";

/** Tempo's two networks. Testnet is named "Moderato". */
export type TempoNetwork = "mainnet" | "testnet";

/** Per-network constants. Tempo is EVM, so `chainId` and the `eip155:` CAIP-2 form are the same number;
 *  what is deliberately NOT here is a token address, because scoping a verification to one TIP-20 token is
 *  the caller's decision and the whole of this binding's forgery defence. */
export interface TempoNetworkConfig {
  readonly network: TempoNetwork;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly explorerBase: string;
  /** CAIP-2 chain id — Tempo is EVM, so `eip155:<chainId>`. */
  readonly caip2: string;
}

const MAINNET: TempoNetworkConfig = {
  network: "mainnet",
  chainId: 4217,
  rpcUrl: "https://rpc.tempo.xyz",
  explorerBase: "https://explore.tempo.xyz",
  caip2: "eip155:4217",
};

/** Tempo Testnet, named "Moderato". */
const TESTNET: TempoNetworkConfig = {
  network: "testnet",
  chainId: 42431,
  rpcUrl: "https://rpc.moderato.tempo.xyz",
  explorerBase: "https://explore.testnet.tempo.xyz",
  caip2: "eip155:42431",
};

/** The constants for one network. */
export function getTempoConfig(network: TempoNetwork): TempoNetworkConfig {
  return network === "mainnet" ? MAINNET : TESTNET;
}

/** True iff `address` sits in the TIP-20 token range — case-insensitive, prefix optional. */
export function isTip20Address(address: string): boolean {
  return stripHexPrefix(address)
    .toLowerCase()
    .startsWith(stripHexPrefix(TIP20_ADDRESS_PREFIX));
}

/**
 * One TIP-20 token address, lower-cased for exact comparison against a log's `address` — THROWS naming
 * `context` when it is not one. Every read path that scopes to a token goes through here, so "which token
 * counts" is answered in exactly one place. Both checks are load-bearing: the range says the address could
 * be a TIP-20 token at all, the 20-byte length says it is an address rather than the bare prefix.
 */
export function requireTip20Token(token: string, context: string): string {
  if (!isHexBytes(token, 20) || !isTip20Address(token))
    throw new Error(
      `${context}: expected a 20-byte TIP-20 token address (${TIP20_ADDRESS_PREFIX}… range), got "${token}"`,
    );
  return token.toLowerCase();
}
