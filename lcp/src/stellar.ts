/**
 * Stellar rail pieces: the payer-signed Soroban `transfer` and the digest of the authorization entry that signs it; the
 * position P of a transaction and the muxed address `M(payee, P)`; the 40-byte payload of the signed-payload
 * precondition over H; the events that show what moved; the search for a buyer's acts; and the read of the agreement
 * `x402/exact/stellar/precondition`, through a bounded reader.
 *
 * @module
 */
export {
  MAX_CANDIDATES,
  MAX_PAGES,
  PASSPHRASE,
  SCVAL_MAX_DEPTH,
  decodeStellarTx,
  stellarLocate,
  stellarRecover,
  stellarStatus,
  transferEventOf,
  transferEventTopics,
} from "./internal/stellar.js";
export type {
  PayloadSigner,
  StellarCandidate,
  StellarEvent,
  StellarEventRow,
  StellarLanded,
  StellarMark,
  StellarNetwork,
  StellarPayment,
  StellarQuery,
  StellarReader,
  StellarRef,
  StellarSearch,
  StellarStatus,
  StellarUnsigned,
} from "./internal/stellar.js";
export {
  MAX_ORDER,
  PAYLOAD_BYTES,
  muxedFor,
  parseStellarPosition,
  readSignedPayload,
  signedPayload,
  stellarPosition,
} from "./internal/stellar-position.js";
