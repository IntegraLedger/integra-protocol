/**
 * lcp's own resource bounds: the largest input each of its decoders accepts. None is a specification's limit; each
 * bounds the work a decoder does on a value whose specification sets no size, and is the same for every caller, so a
 * server sizes its own request limits from them.
 */

/**
 * The longest signature lcp decodes, in bytes. A smart-contract wallet's signature (ERC-1271, and ERC-6492's wrapped
 * form) has no length its standard fixes, so lcp bounds it here, for every pairing that reads one.
 */
export const MAX_SIGNATURE_BYTES = 8192;

/**
 * The longest link, in characters, that a placement writes or a reader accepts: the ATR's link and the agreement's URL.
 * No specification of a link's carrier fixes a length.
 */
export const MAX_LINK_LENGTH = 2048;

/** The most options lcp reads in one x402 document (`accepts`). x402 sets no count. */
export const MAX_OPTIONS = 32;

/**
 * The most challenges lcp reads in one MPP response. A challenge id lcp derives from H names the challenge's position
 * in the response, and an id holds the positions 0 to 31.
 */
export const MAX_CHALLENGES = 32;

/** The largest MPP credential lcp decodes, in bytes. The MPP draft sets no size. */
export const MAX_CREDENTIAL_BYTES = 65_536;

/**
 * The deepest nesting of arrays and objects in any JSON lcp writes or reads, an ATR's among it. RFC 8259 permits any
 * depth; a parser's recursion is bounded by it.
 */
export const MAX_JSON_DEPTH = 64;

/**
 * The deepest nesting of arrays and objects lcp reads in an MPP challenge's decoded `request` and `opaque`. A challenge
 * is read before anything is bound to it, so it is held to less depth than an ATR.
 */
export const MAX_CHALLENGE_DEPTH = 16;
