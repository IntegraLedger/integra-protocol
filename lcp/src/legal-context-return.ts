/**
 * The return after an agreement (legal-context-return.md): the `Legal-Context` header, by which a buyer's agent that has
 * made the agreement repeats its request with the sale's H and, where the sale has one, its return value; and the
 * member by which an agreement option names the sale's charge options it serves.
 */
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import { isObject, normalHash } from "./fields.js";
import { opaqueMembers } from "./mpp-challenge.js";
import { fromBase64, toBase64 } from "./rail-bytes.js";
import { refusal, type Refusal } from "./refusal.js";

/** The header's name. */
export const LEGAL_CONTEXT_HEADER = "Legal-Context";

/** The member by which an agreement option names the charge options it serves: in an x402 option's `extra`, in an MPP challenge's `opaque`. */
export const LEGAL_CONTEXT_SERVES = "legalContextServes";

/** The length of a sale's return value, in bytes. */
export const RETURN_VALUE_BYTES = 32;

/** What a `Legal-Context` header carries: H, and the sale's return value where it has one, as 32 bytes. */
export interface LegalContextReturn {
  h: AtrHash;
  returnValue?: Uint8Array;
}

const LCP_TOKEN = /^lcp:sha256:0x[0-9a-f]{64}$/;
const SERVED = /^(?:x402|mpp)\/(?:[0-9]|[12][0-9]|3[01])$/;
const MAX_SERVED = 32;

/**
 * The header's value, an RFC 9651 Item: H's LCP string as a token, and, where `returnValue` is given, the parameter
 * `rv`, its 32 bytes as a byte sequence. An H that is not a 32-byte hash, or a return value that is not 32 bytes, is
 * `return/header-malformed`.
 */
export function toLegalContextHeader(h: AtrHash, returnValue?: Uint8Array): string | Refusal {
  const hash = normalHash(h);
  if (hash === null) return refusal("return/header-malformed");
  if (returnValue === undefined) return toLcpString(hash);
  if (!(returnValue instanceof Uint8Array) || returnValue.length !== RETURN_VALUE_BYTES) {
    return refusal("return/header-malformed");
  }
  return `${toLcpString(hash)};rv=:${toBase64(returnValue)}:`;
}

/**
 * H, and the return value where the header carries `rv`, from a `Legal-Context` header's value: an RFC 9651 Item whose
 * bare item is a token that is H's LCP string in lowercase hex, with no parameter but `rv`, a byte sequence of 32 bytes
 * in canonical padded base64, and spaces only where RFC 9651 admits them (before and after the item, and after a `;`).
 * Any other value is `return/header-malformed`.
 */
export function fromLegalContextHeader(value: unknown): LegalContextReturn | Refusal {
  if (typeof value !== "string") return refusal("return/header-malformed");
  const item = value.replace(/^ +| +$/g, "");
  const semi = item.indexOf(";");
  const token = semi === -1 ? item : item.slice(0, semi);
  if (!LCP_TOKEN.test(token)) return refusal("return/header-malformed");
  const h = fromLcpString(token);
  if (h === null) return refusal("return/header-malformed");
  if (semi === -1) return { h };
  const param = item.slice(semi + 1).replace(/^ +/, "");
  const m = /^rv=:([A-Za-z0-9+/=]*):$/.exec(param);
  const bytes = m === null ? null : fromBase64(m[1]);
  if (bytes === null || bytes.length !== RETURN_VALUE_BYTES) return refusal("return/header-malformed");
  return { h, returnValue: bytes };
}

/**
 * The charge options an agreement option names as those it serves: each `x402/<i>` or `mpp/<i>`, the option at index
 * `i` of the ATR binding slot of that name (`accepts` of `x402`, `challenges` of `mpp`). On an x402 option the member is
 * `extra.legalContextServes`, an array of those strings; on an MPP challenge it is `opaque`'s `legalContextServes`, those
 * strings joined by one space. Undefined where the option carries no such member; `return/serves-malformed` where the
 * member is not 1 to 32 distinct such strings.
 */
export function servesOf(option: unknown): readonly string[] | undefined | Refusal {
  if (!isObject(option)) return refusal("return/serves-malformed");
  let listed: unknown;
  if (typeof option["scheme"] === "string") {
    const extra = option["extra"];
    if (extra === undefined) return undefined;
    if (!isObject(extra)) return refusal("return/serves-malformed");
    listed = extra[LEGAL_CONTEXT_SERVES];
  } else {
    const opaque = option["opaque"];
    if (opaque === undefined) return undefined;
    const members = typeof opaque === "string" ? opaqueMembers(opaque) : undefined;
    if (members === undefined) return refusal("return/serves-malformed");
    const joined = members[LEGAL_CONTEXT_SERVES];
    listed = typeof joined === "string" ? joined.split(" ") : joined;
  }
  if (listed === undefined) return undefined;
  if (
    !Array.isArray(listed) ||
    listed.length === 0 ||
    listed.length > MAX_SERVED ||
    !listed.every((s) => typeof s === "string" && SERVED.test(s)) ||
    new Set(listed).size !== listed.length
  ) {
    return refusal("return/serves-malformed");
  }
  return Object.freeze([...(listed as string[])]);
}
