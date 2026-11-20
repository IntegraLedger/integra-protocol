/**
 * Stellar on x402: the pairing `x402/exact/stellar/precondition` (`exactStellarPrecondition`), an agreement in which
 * the buyer signs a Soroban authorization of `transfer(buyer, payTo, amount)` and a 40-byte payload of H and that
 * authorization's nonce.
 *
 * The transaction carries that payload as a signed-payload precondition. The entry point also exports the pairing's
 * choice type `StellarPreconditionChoice`, its `assetTransferMethod` `LCP_PRECONDITION`, and the `Broadcaster` type,
 * which every pairing's `broadcaster` answers.
 *
 * @module
 */
export { exactStellarPrecondition, LCP_PRECONDITION } from "./x402-exact-stellar-precondition.js";
export type { StellarPreconditionChoice } from "./x402-exact-stellar-precondition.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { X402Read } from "./internal/x402.js";
