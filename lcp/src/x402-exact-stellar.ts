/**
 * Stellar on x402: the pairing `x402/exact/stellar/precondition` (`exactStellarPrecondition`), an agreement in which
 * the buyer signs a Soroban authorization of `transfer(buyer, payTo, amount)` and the 40-byte payload of H and that
 * authorization's nonce, which the transaction carries as a signed-payload precondition; its choice type
 * `StellarPreconditionChoice`; and the `Broadcaster` type, which every pairing's `broadcaster` answers.
 *
 * @module
 */
export { exactStellarPrecondition } from "./x402-exact-stellar-precondition.js";
export type { StellarPreconditionChoice } from "./x402-exact-stellar-precondition.js";
export type { Broadcaster } from "./internal/broadcaster.js";
