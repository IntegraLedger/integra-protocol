/**
 * The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's forms, the https-link
 * rule, the JSON and base64 forms they read and write, `isRefusal` and `readToRepeat`, with no pairing, rail or
 * optional peer.
 *
 * Besides those, it holds the agreement's own value of a hash; the hash's string and structured forms; the URL
 * Standard's host and domain parsers the https-link rule reads a link with; the RFC 8785 form of a JSON value and its
 * digest; JSON reading capped at 64 levels; and padded standard base64 and unpadded base64url, each read in its
 * canonical form only (with or without a bound on its size) and written. It imports no pairing, no rail and no optional
 * peer, so a bundle of it holds these functions and nothing else. The package root exports the same functions: each is
 * one function, reached by either path.
 *
 * @module
 */
export {
  agreementValue,
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
export { domainToAscii, parseHost, readUrl } from "./internal/url-host.js";
export type { UrlAuthority } from "./internal/url-host.js";
export { base64Bytes, base64UrlBytes, fromBase64, fromBase64Url, toBase64, toBase64Url } from "./rail-bytes.js";
export { isRefusal, readToRepeat } from "./refusal.js";
export type { Refusal } from "./refusal.js";
