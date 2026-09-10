/**
 * Sui network constants for the LCP Pay402 `payment_id` binding. The atrHash rides the
 * FULL 32 raw bytes of the Pay402 Move facilitator's `settle_payment<T>(.., payment_id: vector<u8>, ..)`
 * argument — no truncation (canonical LCP §8.3.1 Native Field per the LCP per-chain binding table; Pay402 is
 * an MIT-licensed third-party Sui x402 facilitator, hamiha70/Pay402 — NOT the canonical one, because x402
 * publishes its own exact-Sui scheme and does not name Pay402; see the manifest). The buyer signs the
 * settlement transaction that carries `payment_id`, so the weld is signature-grade. The facilitator emits a
 * `PaymentSettled { payment_id, buyer, merchant, .. }` Move event carrying the same 32 bytes back.
 */

/** The Pay402 Move module name (within the deployed package). */
export const PAY402_MODULE = "payment";
/** The Pay402 settle entry function. */
export const PAY402_SETTLE_FUNCTION = "settle_payment";
/** The Pay402 event struct emitted on a successful settlement (unqualified name). */
export const PAY402_SETTLED_EVENT = "PaymentSettled";

/** The two networks this binding ships constants for. */
export type SuiNetwork = "testnet" | "mainnet";

/** Per-network constants. Notice what is NOT here: the Pay402 package id. Pay402 is a deployed Move
 *  package, so its id is a property of a deployment and is passed per call to
 *  {@link pay402SettleTarget} / {@link pay402SettledEventType} rather than pinned in this file. */
export interface SuiNetworkConfig {
  network: SuiNetwork;
  /**
   * The network's public fullnode JSON-RPC endpoint.
   *
   * ⛔ MEASURED DEAD 2026-09-10, on BOTH networks: every method answers `-32601 "JSON-RPC on public
   * fullnodes has been deprecated. Please migrate to gRPC or GraphQL endpoints."` This is therefore not a
   * rate-limited default to be outgrown, it is a URL that serves nothing — supply a provider endpoint, or
   * read over {@link SuiNetworkConfig.graphqlUrl}. It stays published because a JSON-RPC endpoint is still
   * how a provider one is addressed and how `SuiJsonRpcClient` submits a settlement; what it is no longer
   * is a value anything may fall back to.
   */
  rpcUrl: string;
  /** The network's public GraphQL endpoint — served (measured 2026-09-10) and what `makeSuiGraphqlRpc`
   *  speaks. This is the read transport the deprecation notice above points at. */
  graphqlUrl: string;
  /** Circle-issued (or bridged) USDC `Coin<T>` type tag on this network. */
  usdcCoinType: string;
}

const TESTNET: SuiNetworkConfig = {
  network: "testnet",
  rpcUrl: "https://fullnode.testnet.sui.io",
  graphqlUrl: "https://graphql.testnet.sui.io/graphql",
  usdcCoinType:
    "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
};

const MAINNET: SuiNetworkConfig = {
  network: "mainnet",
  rpcUrl: "https://fullnode.mainnet.sui.io",
  graphqlUrl: "https://graphql.mainnet.sui.io/graphql",
  usdcCoinType:
    "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
};

/** The constants for one network. ⛔ `rpcUrl` names a public fullnode whose JSON-RPC is DEPRECATED and
 *  answers `-32601` to every method — nothing may fall back to it. `graphqlUrl` is the read transport that
 *  answers; bind it with `makeSuiGraphqlRpc`. */
export function getSuiConfig(network: SuiNetwork): SuiNetworkConfig {
  return network === "testnet" ? TESTNET : MAINNET;
}

/**
 * The fully-qualified Pay402 `PaymentSettled` event type for a deployed package
 * (`<packageId>::payment::PaymentSettled`) — the `MoveEventType` filter for `queryEvents`/enumerate.
 */
export function pay402SettledEventType(packageId: string): string {
  return `${packageId}::${PAY402_MODULE}::${PAY402_SETTLED_EVENT}`;
}

/** The fully-qualified Pay402 `settle_payment` call target for a deployed package. */
export function pay402SettleTarget(packageId: string): string {
  return `${packageId}::${PAY402_MODULE}::${PAY402_SETTLE_FUNCTION}`;
}

/**
 * USDC on Sui has 6 decimals — 1 USDC = 1_000_000 base units.
 *
 * RAIL-QUALIFIED ON PURPOSE. Four bindings publish a USDC decimal count and they are NOT all the same —
 * Stellar's is 7 where Hedera's, Solana's and Sui's are 6. A bare `USDC_DECIMALS` exported four times
 * from four packages is one name with two meanings, and the way that fails is silent: a consumer who reads
 * it from one rail and applies it on another is off by a factor of ten in an amount, at settlement rather
 * than at compile time. Each value is correct for its own chain, which is why no per-package test can
 * catch the clash; the prefix is what makes it impossible to import the wrong one by accident.
 */
export const SUI_USDC_DECIMALS = 6;

/**
 * ⛔⛔ THE COLLECTION PATH THIS RAIL'S `weldGrades` IS KEYED BY — exported so a consumer looks the grade up
 * with the SAME token this manifest declares it under.
 *
 * `binding-evm-x402` shipped `0.15.1` with `weldGrades` keyed `ERC3009` — the escrow sibling's COLLECTOR
 * name — while the value a consumer computes from an x402 offer is `eip3009`. The map and the lookup key
 * disagreed inside one published package, so `weldGrades[assetTransferMethod]` answered `undefined`: the
 * grade absent rather than wrong, which reads as a rail declaring no weld grade at all. Nothing caught it —
 * the profile schema constrains weldGrades VALUES (`signature` | `tx`) and says nothing about keys.
 *
 * ⇒ The key is a constant, not a literal, on every rail. `check:weld-grade-keys` holds it.
 */
export const SUI_COLLECTION_PATH = "pay402";
