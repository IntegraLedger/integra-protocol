/**
 * The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's string and structured
 * forms, the https-link rule, the RFC 8785 form of a JSON value and its digest, JSON reading capped at 64 levels,
 * padded standard base64 read in its canonical form only (with or without a bound on its size) and written,
 * `isRefusal` and `readToRepeat`. It imports no pairing, no rail and no optional peer, so a bundle of it holds these
 * functions and nothing else. The package root exports the same functions: each is one function, reached by either
 * path.
 */
export {
  assemble,
  canonicalJson,
  digestJson,
  fromLcpString,
  fromLegalContext,
  fromRawBytes,
  hash,
  hashEquals,
  isHttpsLink,
  isOtherSchemeLink,
  newAtrId,
  parseJson,
  toLcpString,
  toLegalContext,
  toRawBytes,
} from "./internal/core.js";
export type { AtrHash, CoreRefusal, Json } from "./internal/core.js";
export { base64Bytes, fromBase64, toBase64 } from "./rail-bytes.js";
export { isRefusal, readToRepeat } from "./refusal.js";
export type { Refusal } from "./refusal.js";
