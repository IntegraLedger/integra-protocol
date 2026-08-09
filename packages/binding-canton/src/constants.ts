/**
 * Canton / Daml constants for the LCP `LcpAnchor` overlay-contract binding.
 *
 * Canton is an **overlay-contract** rail by CHOICE (canonical LCP §8.3.2). The claim this file used to
 * make — that "Daml has no native arbitrary-bytes carrier on a transaction — no memo, no metadata label,
 * no nonce" — is false: x402's exact-Canton scheme defines `extra.memo`, carried in the transfer's own
 * metadata. What is true is narrower and is why this package exists: that scheme settles **Canton Coin
 * only**, so every other Canton deployment — any instrument, any synchronizer, no facilitator — still has
 * no native field to ride, and a custom template is the only surface available to it. The x402 carrier
 * lives in `@integraledger/lcp-binding-canton-x402`. The `LcpAnchor` template (signatory = buyer, observer = seller) carries the
 * atrHash as a `Text` field on the contract instance; the seller/observer queries the participant's
 * active contract set for the anchor whose `atrHash` matches. That IS an overlay contract by definition.
 *
 * The template module is `Main` (`<packageId>:Main:LcpAnchor`), matching the deployed lcp-anchor DAR.
 * The package id is deployment-specific (it is the hash of the compiled DAR) and is supplied per-call,
 * never hardcoded here.
 */

/** The Daml module the `LcpAnchor` template lives in (the deployed lcp-anchor DAR's `Main` module). */
export const LCP_ANCHOR_MODULE = "Main";
/** The Daml template entity name carrying the atrHash. */
export const LCP_ANCHOR_ENTITY = "LcpAnchor";

/** Build the fully-qualified Daml template id `<packageId>:Main:LcpAnchor` for a deployed DAR. */
export function lcpAnchorTemplateId(packageId: string): string {
  if (packageId.length === 0)
    throw new Error(
      "lcpAnchorTemplateId: packageId is empty (deploy the lcp-anchor DAR and pass its package id)",
    );
  return `${packageId}:${LCP_ANCHOR_MODULE}:${LCP_ANCHOR_ENTITY}`;
}

/** The three Canton environments this binding ships constants for — `sandbox` is a local Daml Sandbox. */
export type CantonNetwork = "sandbox" | "devnet" | "mainnet";

/** Per-network constants, and they are thin by necessity: no RPC URL, because a Canton participant node is
 *  a deployment's own and there is no public endpoint to name, and no package id, because that is the hash
 *  of the DAR you deployed. Both are supplied per call. */
export interface CantonNetworkConfig {
  network: CantonNetwork;
  /** Explorer base for a contract link (Daml Sandbox has no public explorer — Navigator stand-in). */
  explorerBase: string;
  /** CAIP-2-style identifier — Canton has no canonical namespace yet (informal, like Cardano's). */
  caip2: string;
}

const SANDBOX: CantonNetworkConfig = {
  network: "sandbox",
  explorerBase: "http://localhost:7500",
  caip2: "canton:sandbox",
};

const DEVNET: CantonNetworkConfig = {
  network: "devnet",
  explorerBase: "https://scan.global.dev.sync.global",
  caip2: "canton:devnet",
};

const MAINNET: CantonNetworkConfig = {
  network: "mainnet",
  explorerBase: "https://scan.sync.global",
  caip2: "canton:mainnet",
};

/** The constants for one environment. */
export function getCantonConfig(network: CantonNetwork): CantonNetworkConfig {
  if (network === "sandbox") return SANDBOX;
  if (network === "devnet") return DEVNET;
  return MAINNET;
}
