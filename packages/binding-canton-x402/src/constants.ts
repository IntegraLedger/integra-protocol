/**
 * Canton / Daml constants for the LCP transfer-memo binding.
 *
 * **Canton has a native arbitrary-bytes carrier, and this binding uses it.** x402's `exact` scheme for
 * Canton defines `PaymentRequirements.extra.memo` — "Seller-defined UTF-8 string, max 256 bytes. When
 * present, the client MUST include it in the transfer's metadata" — and its facilitator rule 12 rejects
 * `invalid_exact_canton_memo_mismatch` when the transfer metadata does not carry the identical value under
 * `x402.memo`. Seller-committed, payer-echoed, facilitator-verified, and riding the same transaction as
 * the value.
 *
 * Daml is often said to have no native arbitrary-bytes carrier — no memo, no metadata label, no nonce. That
 * is true of the LEDGER's own primitives and false of a payment settled through x402, which is why this
 * rail exists beside `@integraledger/lcp-binding-canton`'s overlay contract rather than instead of it.
 */

/**
 * The transfer-metadata key the facilitator compares against `extra.memo`. The host's, read exactly: a
 * metadata map carrying our value under a different key is a transfer no facilitator checked.
 */
export const CANTON_X402_MEMO_KEY = "x402.memo";

/** The scheme's stated ceiling for `extra.memo`. A canonical atrHash is 66 UTF-8 bytes. */
export const CANTON_X402_MEMO_MAX_BYTES = 256;

/** The three Canton environments this binding ships constants for. */
export type CantonX402Network = "sandbox" | "devnet" | "mainnet";

/** Per-network constants. Same shape as the overlay rail's and for the same reason: a Canton participant
 *  node is a deployment's own, so there is no endpoint to pin here. */
export interface CantonX402NetworkConfig {
  network: CantonX402Network;
  /** Explorer base for a contract link (Daml Sandbox has no public explorer — Navigator stand-in). */
  explorerBase: string;
  /** CAIP-2-style identifier — Canton has no canonical namespace yet (informal, like Cardano's). */
  caip2: string;
}

const SANDBOX: CantonX402NetworkConfig = {
  network: "sandbox",
  explorerBase: "http://localhost:7500",
  caip2: "canton:sandbox",
};

const DEVNET: CantonX402NetworkConfig = {
  network: "devnet",
  explorerBase: "https://scan.global.dev.sync.global",
  caip2: "canton:devnet",
};

const MAINNET: CantonX402NetworkConfig = {
  network: "mainnet",
  explorerBase: "https://scan.sync.global",
  caip2: "canton:mainnet",
};

/** The constants for one environment. Which Canton rail you want is the real choice: this one only reaches
 *  payments settled through x402's Canton-Coin scheme, and `@integraledger/lcp-binding-canton`'s overlay
 *  covers everything else. */
export function getCantonX402Config(
  network: CantonX402Network,
): CantonX402NetworkConfig {
  if (network === "sandbox") return SANDBOX;
  if (network === "devnet") return DEVNET;
  return MAINNET;
}
