/**
 * Stellar rail pieces: the payer-signed Soroban `transfer`, its muxed `to` whose 8-byte id is the ATR hash's first 8
 * bytes, the digest of the signed authorization entry, and settlement read through a bounded reader.
 */
export {
  PASSPHRASE,
  SCVAL_MAX_DEPTH,
  SCVAL_MAX_ELEMENTS,
  decodeStellarTx,
  muxedFor,
  muxedId,
  scValsWithinCaps,
  stellarLocate,
  stellarStatus,
  transferEventOf,
  transferEventTopics,
} from "./internal/stellar.js";
export type {
  StellarNetwork,
  StellarPayment,
  StellarReader,
  StellarRef,
  StellarStatus,
  StellarUnsigned,
} from "./internal/stellar.js";
