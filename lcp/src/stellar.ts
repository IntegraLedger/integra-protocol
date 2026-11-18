/**
 * Stellar rail pieces: the payer-signed Soroban `transfer` and the digest of its authorization entry, the
 * signed-payload precondition over H, the search for a buyer's acts, and the read of the agreement
 * `x402/exact/stellar/precondition`.
 *
 * It also holds the position P of a transaction and the muxed address `M(payee, P)`; the precondition's 40-byte
 * payload; and the events that show what moved. Every read goes through a bounded reader.
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
  StellarPaymentPayload,
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
