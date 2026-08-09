/**
 * Aptos network constants for the LCP overlay-contract binding. The atrHash rides as the
 * `payment_id: vector<u8>` argument of a `<lcpModuleAddress>::payment::settle_payment<Coin>` Move entry
 * call — a bespoke `lcp_payment` Move module the demo deploys, NOT a stock Aptos primitive. That makes
 * this an **overlay-contract** binding by LCP §7.3/§8.3 (a custom deployed module IS an overlay contract),
 * even though an earlier descriptor labelled it `native-field`: that label is
 * superseded by the canonical per-chain binding table ("Aptos = Overlay"). Aptos's stock USDC/APT
 * coins carry no arbitrary-bytes field, so a settlement can only bind atrHash through this custom
 * module — the definition of an overlay contract.
 *
 * The module address is per-deployment (the demo's deployer key). Mainnet is unpublished (`0x0` sentinel
 * → any mainnet call fails loud in `getAptosConfig`, never silently calling `0x0::payment::settle_payment`).
 */

/** The two networks this binding ships constants for. `"mainnet"` is declared but not usable — the
 *  overlay module is unpublished there, and {@link getAptosConfig} throws rather than return a `0x0`. */
export type AptosNetwork = "testnet" | "mainnet";

/** The per-network constants for the overlay module. The field that matters is `lcpModuleAddress`: this
 *  binding rides a Move module someone deployed, so the address is a property of a DEPLOYMENT, not of
 *  Aptos — two deployments of `lcp_payment` are two different overlays and do not read each other. */
export interface AptosNetworkConfig {
  network: AptosNetwork;
  /** Aptos fullnode REST base (…/v1) — reads tx-by-hash + events. */
  fullnodeUrl: string;
  /**
   * Move type tag for the settlement coin. The demo settles in APT
   * (`0x1::aptos_coin::AptosCoin`) on testnet so buyer + seller skip a USDC trustline/mint dance; the LCP
   * binding is preserved regardless — atrHash rides as `payment_id`, `Coin<T>` is generic.
   */
  settlementCoin: string;
  decimals: number;
  /** Address that published the `lcp_payment` Move module (`0x0` = unpublished on this network). */
  lcpModuleAddress: string;
  explorerBase: string;
}

/** The `settle_payment` entry-function name under the published module. */
export const SETTLE_PAYMENT_FUNCTION = "payment::settle_payment" as const;
/** The event a successful settlement emits (module-qualified via `paymentSettledEventType`). */
export const PAYMENT_SETTLED_EVENT = "payment::PaymentSettled" as const;

const TESTNET: AptosNetworkConfig = {
  network: "testnet",
  fullnodeUrl: "https://fullnode.testnet.aptoslabs.com/v1",
  settlementCoin: "0x1::aptos_coin::AptosCoin",
  decimals: 8,
  // Published from on-chain/aptos/lcp-payment by the deployer key (its account addr).
  lcpModuleAddress:
    "0x1ad2769f4ba8f340368395e6706a42e686a33c90bff7c8e48de7bae39f935be9",
  explorerBase: "https://explorer.aptoslabs.com",
};

const MAINNET: AptosNetworkConfig = {
  network: "mainnet",
  fullnodeUrl: "https://fullnode.mainnet.aptoslabs.com/v1",
  settlementCoin: "0x1::aptos_coin::AptosCoin",
  decimals: 8,
  // The lcp_payment Move module is not yet published on Aptos mainnet. The `0x0` sentinel makes any
  // mainnet caller fail loud in getAptosConfig rather than silently call `0x0::payment::settle_payment`.
  lcpModuleAddress: "0x0",
  explorerBase: "https://explorer.aptoslabs.com",
};

/** The constants for one network. **`"mainnet"` THROWS** — the `lcp_payment` module is unpublished there,
 *  and a `0x0` module address would otherwise send a settlement to a call target that does not exist.
 *  That refusal is the design; there is no fallback network. */
export function getAptosConfig(network: AptosNetwork): AptosNetworkConfig {
  if (network === "testnet") return TESTNET;
  if (network === "mainnet") {
    if (MAINNET.lcpModuleAddress === "0x0")
      throw new Error(
        "getAptosConfig: lcp_payment Move module is unpublished on Aptos mainnet — publish it before enabling mainnet runs (no fallback, by design)",
      );
    return MAINNET;
  }
  throw new Error(`getAptosConfig: unsupported network "${network}"`);
}

/** The fully-qualified `<moduleAddress>::payment::settle_payment` entry-function id for a Move call. */
export function settlePaymentFunction(
  lcpModuleAddress: string,
): `${string}::payment::settle_payment` {
  return `${lcpModuleAddress}::${SETTLE_PAYMENT_FUNCTION}`;
}

/** The fully-qualified `<moduleAddress>::payment::PaymentSettled` event type this binding reads. */
export function paymentSettledEventType(
  lcpModuleAddress: string,
): `${string}::payment::PaymentSettled` {
  return `${lcpModuleAddress}::${PAYMENT_SETTLED_EVENT}`;
}

/** An Aptos Explorer link for a settlement hash. Convenience for logs and receipts — it resolves the
 *  config, so calling it with `"mainnet"` throws for the same reason {@link getAptosConfig} does. */
export function explorerTxUrl(network: AptosNetwork, hash: string): string {
  const suffix =
    network === "mainnet" ? "?network=mainnet" : "?network=testnet";
  return `${getAptosConfig(network).explorerBase}/txn/${hash}${suffix}`;
}
