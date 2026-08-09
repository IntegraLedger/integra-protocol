// The carrier codec (LCP §8.1/§8.2). One protocol-agnostic codec for the `legalContext`/`atrHash`
// reference across the three LCP §8.1 shapes — (a) `lcp:{type}:{value}` string, (b) `{ legalContext: {type,value} }`
// JSON, (c) raw atrHash bytes — over the LCP §8.2 open `type` registry (`sha256`/`ipfs`/`ar`/`url`).
//
// Two adaptations from the plain carrier shape: (1) the `sha256` value
// is validated by `kernel.isAtrHash` (case-insensitive, the ATR-canon any-case rule — the decode path
// consumes a counterparty's carrier and MUST accept uppercase hex); (2) faults throw a typed
// `CarrierError` with a stable `code` (the conformance runner compares codes, not interpolated messages;
// the kernel's KernelError pattern). LCP §8.2: an unknown `type` is IGNORED (decode → undefined), never an
// error; a structurally corrupt `lcp:`-prefixed string, or a present-but-empty value, IS an error.
import { isAtrHash } from "@integraledger/lcp-kernel";

/**
 * A carrier codec fault, carrying a stable `code` (`carrier/malformed`, `carrier/bad-hex`,
 * `carrier/bad-sha256`, `carrier/no-byte-form`, `carrier/bad-byte-length`).
 *
 * Compare the `code`, never the message: messages interpolate the offending value and change freely,
 * and the conformance corpus pins codes for exactly that reason. Note what this class does NOT signal —
 * an unrecognised LCP §8.2 `type` is ignored (the decoder answers `undefined`), so a thrown
 * `CarrierError` always means the carrier was structurally corrupt, never merely unfamiliar.
 */
export class CarrierError extends Error {
  // Declared-and-assigned, not a `public readonly` constructor parameter: parameter properties are
  // TypeScript-only syntax that cannot be erased, and the workspace compiles under `erasableSyntaxOnly`.
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CarrierError";
  }
}

/** The LCP §8.2 carrier `type` registry (open; unknown types are ignored on decode). */
export type CarrierType = "sha256" | "ipfs" | "ar" | "url";
/** The four `type` values this codec recognises. The LCP §8.2 registry is OPEN, so this is what the
 *  reference implementation understands today, not a closed set a conforming carrier may not exceed —
 *  a `type` outside it is ignored on decode rather than rejected. */
export const KNOWN_CARRIER_TYPES: readonly CarrierType[] = [
  "sha256",
  "ipfs",
  "ar",
  "url",
];
/** Narrow an arbitrary value to a {@link CarrierType}. Answers on the four types in
 *  {@link KNOWN_CARRIER_TYPES}, so a `false` means "this codec does not handle it", not "invalid". */
export function isKnownCarrierType(value: unknown): value is CarrierType {
  return (
    typeof value === "string" &&
    (KNOWN_CARRIER_TYPES as readonly string[]).includes(value)
  );
}

/** A decoded LCP carrier reference: a LCP §8.2 `type` and its `value`. */
export interface LegalContextRef {
  readonly type: CarrierType;
  readonly value: string;
}
/** The structured-JSON carrier object (LCP §8.1 shape b). */
export interface LegalContextCarrier {
  readonly legalContext: { readonly type: string; readonly value: string };
}
/** The raw structural result of parsing an `lcp:{type}:{value}` string, before the LCP §8.2 registry. */
export interface ParsedLcpString {
  readonly type: string;
  readonly value: string;
}

const LCP_PREFIX = "lcp:";
const ATR_HASH_BYTE_LENGTH = 32; // the only fixed-width value the raw-byte carrier (LCP §8.1 shape c) holds

/** The raw-byte carrier's hex convention: 0x-prefixed (distinct from the kernel's bare sha256Hex). */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
/** Decode 0x-prefixed hex to bytes. The `0x` prefix is REQUIRED and must be lowercase — `0X…` throws
 *  `carrier/bad-hex`, which is the trap when a caller has upper-cased a whole atrHash string. The hex
 *  DIGITS themselves may be either case. */
export function hexToBytes(hex: string): Uint8Array {
  if (!hex.startsWith("0x"))
    throw new CarrierError(
      "carrier/bad-hex",
      `hex must be 0x-prefixed: ${hex}`,
    );
  const h = hex.slice(2);
  if (h.length % 2 !== 0)
    throw new CarrierError("carrier/bad-hex", `odd-length hex: ${hex}`);
  if (!/^[0-9a-fA-F]*$/.test(h))
    throw new CarrierError("carrier/bad-hex", `non-hex characters: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Assert a value is well-formed for its type. The codec validates the `sha256` value (must be an
 * atrHash, any-case); `ipfs`/`ar`/`url` values are opaque per LCP §8.2 and only required to be non-empty.
 */
function assertValidValue(type: CarrierType, value: string): void {
  if (value.length === 0)
    throw new CarrierError(
      "carrier/empty-value",
      `empty value for type '${type}'`,
    );
  if (type === "sha256" && !isAtrHash(value))
    throw new CarrierError(
      "carrier/bad-sha256",
      `sha256 value must be an atrHash (0x + 64 hex): '${value}'`,
    );
}

// (a) String field — `lcp:{type}:{value}` -------------------------------------------------------

/** Encode a reference as the `lcp:{type}:{value}` string carrier (LCP §8.1 shape a). A `sha256` value is
 *  emitted lowercase per §2.5 whatever case the caller supplied; every other type is emitted verbatim,
 *  because folding a url or a base58 CID would name a different document. */
export function encodeLegalContextString(ref: LegalContextRef): string {
  assertValidValue(ref.type, ref.value);
  return `${LCP_PREFIX}${ref.type}:${emitValue(ref)}`;
}

/**
 * The value as EMITTED. LCP v0.1.38 §2.5 gained a RECOMMENDED that an atrHash is emitted lowercase, so a
 * `sha256` reference has exactly one wire form however the caller spelled it.
 *
 * **Scoped to `sha256`, and the scoping is load-bearing rather than tidiness.** A `url`'s path and query
 * are case-SENSITIVE, so folding one would rewrite the reference into a different document. The other
 * content-addressed types are no safer: base58btc CIDs are mixed-case by construction and Arweave ids are
 * base64url. §2.5's recommendation is about an atrHash's hex digits and nothing else.
 *
 * **Emission only.** The read side returns what it received, verbatim — `extract` on an uppercase document
 * answers uppercase, which the corpus pins as its own case. §2.5 constrains what an implementation WRITES;
 * rewriting on read would discard what a counterparty actually sent.
 */
function emitValue(ref: LegalContextRef): string {
  return ref.type === "sha256" ? ref.value.toLowerCase() : ref.value;
}

/** Parse the STRUCTURE per the LCP §8.1 parse rule (no registry consulted). Split on the first colon for
 *  the namespace, the second for the type; the value keeps every later colon (URLs). Returns undefined
 *  when not `lcp:`-prefixed; throws (carrier/malformed) when `lcp:`-prefixed but structurally corrupt. */
export function parseLcpString(input: string): ParsedLcpString | undefined {
  if (!input.startsWith(LCP_PREFIX)) return undefined;
  const afterNamespace = input.slice(LCP_PREFIX.length);
  const typeEnd = afterNamespace.indexOf(":");
  if (typeEnd === -1)
    throw new CarrierError(
      "carrier/malformed",
      `malformed lcp reference (missing the type:value separator): '${input}'`,
    );
  const type = afterNamespace.slice(0, typeEnd);
  const value = afterNamespace.slice(typeEnd + 1);
  if (type.length === 0)
    throw new CarrierError(
      "carrier/malformed",
      `empty type segment in '${input}'`,
    );
  if (value.length === 0)
    throw new CarrierError(
      "carrier/malformed",
      `empty value segment in '${input}'`,
    );
  return { type, value };
}

/** Decode an `lcp:` string, narrowed to the LCP §8.2 registry (unknown type → undefined, ignored). */
export function decodeLegalContextString(
  input: string,
): LegalContextRef | undefined {
  const parsed = parseLcpString(input);
  if (parsed === undefined) return undefined;
  if (!isKnownCarrierType(parsed.type)) return undefined; // LCP §8.2: ignore unrecognized types
  assertValidValue(parsed.type, parsed.value);
  return { type: parsed.type, value: parsed.value };
}

// (b) Structured JSON — `{ "legalContext": { "type", "value" } }` ------------------------------

/** Encode a reference as the structured-JSON carrier (LCP §8.1 shape b), for protocol fields that hold an
 *  object rather than a string. Same §2.5 lowercase-on-emit rule as the string carrier. */
export function encodeLegalContextJson(
  ref: LegalContextRef,
): LegalContextCarrier {
  assertValidValue(ref.type, ref.value);
  // Same §2.5 emission rule as the string carrier — one wire form per reference, whichever shape carries it.
  return { legalContext: { type: ref.type, value: emitValue(ref) } };
}

/** Decode the structured-JSON carrier. Absent/malformed carrier → undefined; a recognized type with a
 *  present-but-empty value is a CORRUPT carrier and throws (consistent with the string decoder). */
export function decodeLegalContextJson(
  carrier: unknown,
): LegalContextRef | undefined {
  if (typeof carrier !== "object" || carrier === null) return undefined;
  const legalContext = (carrier as { legalContext?: unknown }).legalContext;
  if (typeof legalContext !== "object" || legalContext === null)
    return undefined;
  const { type, value } = legalContext as { type?: unknown; value?: unknown };
  if (typeof type !== "string" || typeof value !== "string") return undefined;
  if (!isKnownCarrierType(type)) return undefined; // LCP §8.2: ignore unrecognized types
  assertValidValue(type, value); // a present-but-empty value is corrupt, not absent — fail loud
  return { type, value };
}

// (c) Raw byte field — the raw `atrHash` bytes ------------------------------------------------

/** Encode as the raw-byte carrier (32 atrHash bytes). Only `sha256` has a fixed-width byte form. */
export function encodeLegalContextBytes(ref: LegalContextRef): Uint8Array {
  if (ref.type !== "sha256")
    throw new CarrierError(
      "carrier/no-byte-form",
      `the raw-byte carrier holds only the atrHash bytes (type 'sha256'); type '${ref.type}' has no fixed-width byte form`,
    );
  assertValidValue(ref.type, ref.value);
  return hexToBytes(ref.value);
}

/** Decode exactly 32 atrHash bytes into a `sha256` ref. A wrong length is a corrupt carrier (fail loud). */
export function decodeLegalContextBytes(bytes: Uint8Array): LegalContextRef {
  if (bytes.length !== ATR_HASH_BYTE_LENGTH)
    throw new CarrierError(
      "carrier/bad-byte-length",
      `expected exactly ${ATR_HASH_BYTE_LENGTH} atrHash bytes, got ${bytes.length}`,
    );
  return { type: "sha256", value: bytesToHex(bytes) };
}

// Language-neutral operation dispatch ---------------------------------------------------------

/** A carrier operation by name — the language-neutral surface the conformance `carrier` class drives
 *  (and binding-core's own vector tests). `decode*` map undefined (ignored/absent) to null so the
 *  result is JSON-representable; `encodeBytes` returns 0x-hex so bytes compare as JSON. */
export type CarrierOp =
  | { op: "parseString"; arg: string }
  | { op: "decodeString"; arg: string }
  | { op: "decodeJson"; arg: unknown }
  | { op: "decodeBytes"; arg: string }
  | { op: "encodeString"; arg: LegalContextRef }
  | { op: "encodeJson"; arg: LegalContextRef }
  | { op: "encodeBytes"; arg: LegalContextRef }
  | { op: "isKnownType"; arg: unknown };

/** Execute one {@link CarrierOp} and return a JSON-representable result. This is the codec's
 *  language-neutral entry point — a conformance runner in any language drives the same eight operations
 *  through it. Faults still THROW a {@link CarrierError}; only the "ignored/absent" answer is mapped, to
 *  `null`. */
export function carrierOp(req: CarrierOp): unknown {
  switch (req.op) {
    case "parseString":
      return parseLcpString(req.arg) ?? null;
    case "decodeString":
      return decodeLegalContextString(req.arg) ?? null;
    case "decodeJson":
      return decodeLegalContextJson(req.arg) ?? null;
    case "decodeBytes":
      return decodeLegalContextBytes(hexToBytes(req.arg));
    case "encodeString":
      return encodeLegalContextString(req.arg);
    case "encodeJson":
      return encodeLegalContextJson(req.arg);
    case "encodeBytes":
      return bytesToHex(encodeLegalContextBytes(req.arg));
    case "isKnownType":
      return isKnownCarrierType(req.arg);
  }
}
