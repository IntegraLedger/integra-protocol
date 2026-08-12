export {
  buildMuxedDestination,
  createStellarAdapter,
  isSettledSuccessfully,
  STELLAR_PREFIX_NOTE,
  type StellarAdapter,
  type StellarMuxConfirmation,
  type StellarMuxPrefixRecovery,
  type StellarReader,
  type StellarSettlementRef,
  type StellarSettlementView,
} from "./adapter.js";
export {
  getStellarConfig,
  MUX_ID_BYTES,
  MUX_SCHEME,
  PUBNET_PASSPHRASE,
  STELLAR_USDC_DECIMALS,
  type StellarNetwork,
  type StellarNetworkConfig,
  TESTNET_PASSPHRASE,
} from "./constants.js";
export { STELLAR_MANIFEST } from "./manifest.js";
export {
  type DecodedMuxedAddress,
  decodeMuxedAddress,
  deriveMuxId,
  encodeMuxedAddress,
  recoverMuxIdPrefix8,
  verifyMuxedBinding,
} from "./mux.js";
