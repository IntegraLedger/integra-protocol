/**
 * Content addressing + deterministic CARv1 encoding for evidence bundles.
 *
 * **CID == atrHash.** A raw-leaf CIDv1 (`0x01` version, `0x55` raw codec, `0x12` sha2-256 multihash,
 * `0x20` length) frames the atrHash's own 32-byte digest — no content is re-hashed, so the CID's digest
 * IS the atrHash (LCP §7.2). multiformats v14 builds the CID object (string form); the CARv1 framing is
 * hand-rolled to the
 * IPLD CARv1 spec: `[varint | DAG-CBOR header][varint | CID | data]…`, LEB128 varints, the header a
 * DAG-CBOR `{roots:[cid], version:1}` with CIDs as tag-42. **Determinism is ours to supply — CARv1 leaves
 * block order unspecified — so `encodeCar` preserves the caller's block order; `vectors/evidence/
 * car-determinism.json` pins the exact bytes (authored from the spec, cross-confirmed against @ipld/car).**
 *
 * The **1 MiB raw-block ceiling** (`cidForBytes`): above it an IPFS importer chunks into a dag-pb tree
 * whose root CID hashes the TREE, not the file — breaking CID == atrHash. Oversize input fails loud at
 * CID-derivation time, never silently minting a non-matching CID.
 */
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { create as createDigest } from "multiformats/hashes/digest";
import { sha256 } from "multiformats/hashes/sha2";

const SHA256_CODE = 0x12;
const SHA256_DIGEST_BYTES = 32;
/** 1 MiB — the single raw-block ceiling; above it CID == atrHash no longer holds (dag-pb chunking). */
export const RAW_BLOCK_MAX_BYTES = 1_048_576;

/** A CID or CAR fault, carrying a stable `code` (`car/truncated`, `car/cid-version`, `car/bad-root-index`,
 *  …). Compare the `code`, not the message. Every one of them means the bytes are malformed — a
 *  well-formed bundle whose content simply does not verify is reported as a result, not thrown. */
export class CidError extends Error {
  // Declared-and-assigned, not a `public readonly` constructor parameter: parameter properties are
  // TypeScript-only syntax that cannot be erased, and the workspace compiles under `erasableSyntaxOnly`.
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CidError";
  }
}

function hexToDigest(atrHash: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]*$/.test(atrHash))
    throw new CidError("cid/bad-atrhash", `atrHash is not 0x-hex: ${atrHash}`);
  const h = atrHash.slice(2);
  if (h.length !== SHA256_DIGEST_BYTES * 2)
    throw new CidError(
      "cid/bad-atrhash-length",
      `atrHash decodes to ${h.length / 2} bytes, not ${SHA256_DIGEST_BYTES} — only a 32-byte SHA-256 digest is a valid atrHash (LCP §7.2)`,
    );
  const out = new Uint8Array(SHA256_DIGEST_BYTES);
  for (let i = 0; i < SHA256_DIGEST_BYTES; i++)
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Frame an existing atrHash (32-byte SHA-256 digest) as a raw-CIDv1 — no re-hash. Returns the CID string. */
export function cidForAtrHash(atrHash: string): string {
  return CID.create(
    1,
    raw.code,
    createDigest(SHA256_CODE, hexToDigest(atrHash)),
  ).toString();
}

/** Recover the atrHash from a raw-CIDv1 string; fail-loud if the CID is not a 32-byte SHA-256 raw leaf. */
export function atrHashFromCid(cidStr: string): `0x${string}` {
  let cid: CID;
  try {
    cid = CID.parse(cidStr);
  } catch {
    throw new CidError("cid/unparseable", `'${cidStr}' is not a parseable CID`);
  }
  if (cid.multihash.code !== SHA256_CODE)
    throw new CidError(
      "cid/not-sha256",
      `CID '${cidStr}' multihash is 0x${cid.multihash.code.toString(16)}, not sha2-256 (0x12)`,
    );
  if (cid.multihash.digest.length !== SHA256_DIGEST_BYTES)
    throw new CidError(
      "cid/bad-digest-length",
      `CID '${cidStr}' digest is not 32 bytes`,
    );
  let hex = "0x";
  for (const b of cid.multihash.digest) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

/** Hash arbitrary bytes to a raw-CIDv1 string. Enforces the 1 MiB ceiling (fail-loud). Async (WebCrypto). */
export async function cidForBytes(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > RAW_BLOCK_MAX_BYTES)
    throw new CidError(
      "cid/oversize",
      `${bytes.byteLength}B exceeds the single raw-block ceiling (${RAW_BLOCK_MAX_BYTES}B) — IPFS would chunk it into a dag-pb tree whose root CID is not the atrHash (LCP §7.2)`,
    );
  return CID.create(1, raw.code, await sha256.digest(bytes)).toString();
}

// ── CARv1 framing (hand-rolled to the spec) ────────────────────────────────────────────────────

function leb128(n: number): number[] {
  const out: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    out.push(b);
  } while (v !== 0);
  return out;
}

function readVarint(
  bytes: Uint8Array,
  at: number,
): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = at;
  for (;;) {
    const b = bytes[i];
    if (b === undefined)
      throw new CidError("car/truncated", "varint ran past end of buffer");
    // Five bytes is the whole accepted range: a CARv1 length wider than that is not a length this decoder
    // can honour, and `decodeCar` feeds the value straight to its loop cursor. A counterparty-authored CAR
    // must not be able to state a length that indexes backwards — refuse it rather than decode it to a lie.
    if (shift > 28)
      throw new CidError(
        "car/varint-overflow",
        "varint exceeds the 32-bit length range this decoder accepts",
      );
    // Arithmetic rather than `(b & 0x7f) << shift`: `<<` is a 32-bit SIGNED op, so at shift 28 a set high
    // bit turns the length negative and past 31 the shift wraps. Multiplying keeps 2^31..2^35 positive.
    value += (b & 0x7f) * 2 ** shift;
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  // No range check follows: the `shift > 28` refusal already caps `value` below 2^35, and arithmetic
  // accumulation cannot go negative, so a further guard would be unreachable.
  return { value, next: i };
}

/** DAG-CBOR of `{roots:[cid], version:1}` — keys length-sorted (roots < version); CID as tag-42 with the
 *  0x00 identity-multibase prefix. Only the single-root evidence-bundle shape is encoded (fixed structure). */
function encodeHeader(rootCidBytes: Uint8Array): number[] {
  const cidByteString = [0x00, ...rootCidBytes]; // identity multibase prefix + CID bytes
  return [
    0xa2, // map(2)
    0x65,
    0x72,
    0x6f,
    0x6f,
    0x74,
    0x73, // "roots"
    0x81, // array(1)
    0xd8,
    0x2a, // tag(42)
    0x58,
    cidByteString.length, // bytes(N)
    ...cidByteString,
    0x67,
    0x76,
    0x65,
    0x72,
    0x73,
    0x69,
    0x6f,
    0x6e, // "version"
    0x01, // 1
  ];
}

interface CarBlock {
  cidBytes: Uint8Array;
  data: Uint8Array;
}

/** Encode a CARv1 from ordered blocks + a single root CID (bytes). Order is preserved — the caller owns
 *  determinism (CARv1 does not). Section = `varint(len(cid)+len(data)) ‖ cid ‖ data`. Chunk-based (never
 *  `push(...block)` — spreading a large block as call arguments blows the JS arg-count/stack limit above
 *  ~64 KB; a legitimate block runs to the 1 MiB ceiling). */
function encodeCar(blocks: CarBlock[], rootCidBytes: Uint8Array): Uint8Array {
  const header = encodeHeader(rootCidBytes);
  const chunks: Uint8Array[] = [
    Uint8Array.from(leb128(header.length)),
    Uint8Array.from(header),
  ];
  for (const { cidBytes, data } of blocks)
    chunks.push(
      Uint8Array.from(leb128(cidBytes.length + data.length)),
      cidBytes,
      data,
    );
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Compute a block's raw-CIDv1 bytes (the 36-byte `01 55 12 20 <digest>` form). */
async function rawCidBytes(data: Uint8Array): Promise<Uint8Array> {
  return CID.create(1, raw.code, await sha256.digest(data)).bytes;
}

/** Encode ordered raw blocks into a CARv1, rooted at `blocks[rootIndex]`. Returns lowercase hex (the
 *  conformance `carEncode` surface + the byte-exact vector target). */
export async function encodeCarBlocksHex(
  blocks: Uint8Array[],
  rootIndex: number,
): Promise<string> {
  const withCids: CarBlock[] = [];
  for (const data of blocks)
    withCids.push({ cidBytes: await rawCidBytes(data), data });
  const root = withCids[rootIndex];
  if (root === undefined)
    throw new CidError(
      "car/bad-root-index",
      `rootIndex ${rootIndex} out of range`,
    );
  const car = encodeCar(withCids, root.cidBytes);
  let hex = "";
  for (const b of car) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** A CAR archive after decoding: its declared roots and every block it carries. Decoding does NOT verify —
 *  the `cid` strings are what the archive claims, and confirming each block hashes to its own CID is a
 *  separate step. Treat a `DecodedCar` as parsed input, not as evidence. */
export interface DecodedCar {
  roots: string[];
  blocks: { cid: string; bytes: Uint8Array }[];
}

/** Read one raw-CIDv1 (`01 55 12 20 <32>`) from `bytes` at `at`; returns the CID + its byte span. */
function readCid(bytes: Uint8Array, at: number): { cid: CID; next: number } {
  const v = readVarint(bytes, at); // version
  if (v.value !== 1)
    throw new CidError("car/cid-version", "only CIDv1 blocks are supported");
  const codec = readVarint(bytes, v.next);
  const mhCode = readVarint(bytes, codec.next);
  const mhLen = readVarint(bytes, mhCode.next);
  const digestEnd = mhLen.next + mhLen.value;
  const digest = bytes.subarray(mhLen.next, digestEnd);
  if (digest.length !== mhLen.value)
    throw new CidError("car/truncated", "CID digest truncated");
  const cid = CID.create(1, codec.value, createDigest(mhCode.value, digest));
  return { cid, next: digestEnd };
}

/** Decode a CARv1 (roots + raw blocks). Minimal — supports the single-root, raw-CIDv1 evidence shape. */
export function decodeCar(car: Uint8Array): DecodedCar {
  const hlen = readVarint(car, 0);
  const headerEnd = hlen.next + hlen.value;
  const header = car.subarray(hlen.next, headerEnd);
  const roots = decodeHeaderRoots(header);
  const blocks: { cid: string; bytes: Uint8Array }[] = [];
  let i = headerEnd;
  while (i < car.length) {
    const seclen = readVarint(car, i);
    const sectionEnd = seclen.next + seclen.value;
    const { cid, next: dataStart } = readCid(car, seclen.next);
    blocks.push({
      cid: cid.toString(),
      bytes: car.subarray(dataStart, sectionEnd),
    });
    i = sectionEnd;
  }
  return { roots, blocks };
}

/** Extract the root CID strings from the fixed `{roots:[…], version:1}` DAG-CBOR header. */
function decodeHeaderRoots(header: Uint8Array): string[] {
  // map(2) 0xa2, "roots" (0x65 + 5), array(N) 0x8N, then N tag-42 CIDs.
  if (header[0] !== 0xa2 || header[1] !== 0x65)
    throw new CidError("car/header", "unexpected CARv1 header shape");
  let i = 2 + 5; // past 0x65 "roots"
  const arrayByte = header[i];
  if (arrayByte === undefined || (arrayByte & 0xf0) !== 0x80)
    throw new CidError("car/header", "roots is not a CBOR array");
  const count = arrayByte & 0x0f;
  i++;
  const roots: string[] = [];
  for (let n = 0; n < count; n++) {
    if (header[i] !== 0xd8 || header[i + 1] !== 0x2a)
      throw new CidError("car/header", "root is not a tag-42 CID");
    i += 2;
    if (header[i] !== 0x58)
      throw new CidError(
        "car/header",
        "unexpected CID byte-string length encoding",
      );
    const bslen = header[i + 1];
    if (bslen === undefined)
      throw new CidError("car/header", "truncated CID byte string");
    i += 2;
    if (header[i] !== 0x00)
      throw new CidError(
        "car/header",
        "CID byte string missing the identity multibase prefix",
      );
    const cidBytes = header.subarray(i + 1, i + bslen);
    roots.push(CID.decode(cidBytes).toString());
    i += bslen;
  }
  return roots;
}
