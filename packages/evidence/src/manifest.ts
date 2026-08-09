/**
 * The manifest-rooted evidence bundle. A bundle is a CARv1 whose ROOT block is a manifest listing
 * every artifact by role + `lcp:sha256:` reference; the remaining blocks are the artifacts themselves.
 * Self-describing and checkable by recomputation: every block's CID is its content's raw-CIDv1, and the
 * manifest's refs are the same digests — so `verifyBundle` recomputes and confirms both integrity (each
 * block hashes to its CID) and completeness (every referenced artifact is present; a ref with no block is
 * an incomplete bundle, per the manifest schema's role contract).
 */
import { hashAtr } from "@integraledger/lcp-kernel";
import {
  atrHashFromCid,
  CidError,
  cidForBytes,
  type DecodedCar,
  decodeCar,
  encodeCarBlocksHex,
  RAW_BLOCK_MAX_BYTES,
} from "./car.js";

/** The role vocabulary (kept in sync with vectors/evidence/manifest.schema.json's `role` enum). */
export type EvidenceRole =
  | "atr"
  | "referenced terms document"
  | "signed acceptance"
  | "authority chain"
  | "spend artifact"
  | "attestation"
  | "settlement"
  | "settlement-response"
  | "weld"
  | "terminal-state"
  | "witnessed-transition"
  | "timestamp"
  | "orc4-log"
  | "fulfillment"
  | "order-state"
  | "reconciliation-id"
  | "status-list-snapshot"
  | "issuer-key-state";

/** An artifact to place in a bundle: its role and its plaintext bytes (hash-is-identity; stores plaintext). */
export interface Artifact {
  role: EvidenceRole;
  bytes: Uint8Array;
  /** stated assurance for attestation entries (flows to the manifest entry). */
  assurance?: string;
}

/** A manifest entry — one artifact by role + content-addressed reference. */
export interface ManifestEntry {
  role: EvidenceRole;
  ref: `lcp:sha256:0x${string}`;
  assurance?: string;
}

/** A packaged evidence bundle: one CARv1 archive rooted at a manifest that names every artifact inside it
 *  by content address. `car` is the whole thing and the only part that travels — `root` and `entries` are
 *  a readout of what was just built, so a recipient re-derives them from the bytes rather than trusting
 *  them. Artifacts are stored as PLAINTEXT: hash-is-identity, and this format encrypts nothing. */
export interface EvidenceBundle {
  /** The CARv1 bytes (manifest-rooted). */
  car: Uint8Array;
  /** The manifest's own CID (the CAR root). */
  root: string;
  /** The manifest entries, in artifact order. */
  entries: ManifestEntry[];
}

function refFor(digest: `0x${string}`): `lcp:sha256:0x${string}` {
  return `lcp:sha256:${digest}` as `lcp:sha256:0x${string}`;
}

const MANIFEST_REF_RE = /^lcp:sha256:0x[0-9a-fA-F]{64}$/;

/**
 * Read a parsed manifest's `entries`, or `undefined` when the document states them malformed. An absent
 * `entries` key reads as none (completeness over an empty set is vacuous); anything present that is not
 * a list of `{role, ref}` is the counterparty's error, and `verifyBundle` reports it rather than
 * dereferencing it. `assurance` rides along when stated, so the readout matches what was written.
 */
function readEntries(parsed: unknown): ManifestEntry[] | undefined {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const raw = (parsed as Record<string, unknown>)["entries"];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  const entries: ManifestEntry[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== "object" || Array.isArray(e))
      return undefined;
    const { role, ref, assurance } = e as Record<string, unknown>;
    if (typeof role !== "string" || role.length === 0) return undefined;
    if (typeof ref !== "string" || !MANIFEST_REF_RE.test(ref)) return undefined;
    if (assurance !== undefined && typeof assurance !== "string")
      return undefined;
    entries.push({
      role: role as EvidenceRole,
      ref: ref as `lcp:sha256:0x${string}`,
      ...(assurance !== undefined ? { assurance } : {}),
    });
  }
  return entries;
}

/** Deterministic manifest bytes — compact JSON, entries in artifact order, fixed key order (role, ref,
 *  [assurance]). The manifest is itself a raw block, so its bytes fix the bundle's root CID. */
function serializeManifest(entries: ManifestEntry[]): Uint8Array {
  const doc = {
    entries: entries.map((e) => ({
      role: e.role,
      ref: e.ref,
      ...(e.assurance !== undefined ? { assurance: e.assurance } : {}),
    })),
  };
  return new TextEncoder().encode(JSON.stringify(doc));
}

/** Build a manifest-rooted CARv1 evidence bundle from role-tagged artifacts. */
export async function buildBundle(
  artifacts: Artifact[],
): Promise<EvidenceBundle> {
  if (artifacts.length === 0)
    throw new Error(
      "evidence bundle requires at least one artifact (the manifest schema's minItems: 1)",
    );
  const entries: ManifestEntry[] = [];
  for (const a of artifacts) {
    // The 1 MiB raw-block ceiling holds on the BUILD path too (fail-loud) — above it an IPFS importer
    // chunks into a dag-pb tree whose root CID is not the atrHash, so the bundle's CID == atrHash
    // invariant would silently break (matches cidForBytes; car.ts's rawCidBytes is uncapped by itself).
    if (a.bytes.byteLength > RAW_BLOCK_MAX_BYTES)
      throw new CidError(
        "cid/oversize",
        `artifact "${a.role}" is ${a.bytes.byteLength}B — over the ${RAW_BLOCK_MAX_BYTES}B raw-block ceiling (LCP §7.2)`,
      );
    entries.push({
      role: a.role,
      ref: refFor(await hashAtr(a.bytes)),
      ...(a.assurance !== undefined ? { assurance: a.assurance } : {}),
    });
  }
  const manifestBytes = serializeManifest(entries);
  // Block order (deterministic): the manifest (root) first, then artifacts in input order.
  const blocks = [manifestBytes, ...artifacts.map((a) => a.bytes)];
  const hex = await encodeCarBlocksHex(blocks, 0);
  const car = Uint8Array.from(
    (hex.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)),
  );
  const root = await cidForBytes(manifestBytes);
  return { car, root, entries };
}

/** The verdict on a foreign bundle. `ok` covers two things at once — integrity (every block hashes to its
 *  own CID) and completeness (every manifest ref resolves to a block that is actually present) — and
 *  `reason` names which failed. What it does NOT cover: whether the artifacts mean anything. A bundle can
 *  be perfectly `ok` and contain the wrong documents. */
export interface BundleVerification {
  ok: boolean;
  entries: ManifestEntry[];
  reason?: string;
}

/** Decode a bundle CAR and confirm integrity (every block hashes to its CID) + completeness (every
 *  manifest ref resolves to a present block). Returns an honest outcome — never a silent pass. */
export async function verifyBundle(
  car: Uint8Array,
): Promise<BundleVerification> {
  // The FRAME is counterparty-authored too, and `decodeCar` is fail-loud by design — so it is caught
  // here rather than allowed past. An undecodable CAR is the plainest possible {ok:false}: this function
  // exists to judge foreign bundles, and one that throws on the malformed input it was handed cannot
  // report the malformation. Catching is not a fallback path — returning a verdict IS the contract.
  let decoded: DecodedCar;
  try {
    decoded = decodeCar(car);
  } catch (cause) {
    return {
      ok: false,
      entries: [],
      reason: `car is not decodable: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const root = decoded.roots[0];
  if (root === undefined)
    return { ok: false, entries: [], reason: "car has no root" };

  // Integrity: recompute each block's CID from its bytes; collect the present digests.
  const presentDigests = new Set<string>();
  let manifestBytes: Uint8Array | undefined;
  for (const block of decoded.blocks) {
    // Guard the ceiling BEFORE cidForBytes (which throws on oversize): a corrupt oversize block is an
    // honest {ok:false}, never an uncaught crash — verifyBundle's contract is a value, not an exception.
    if (block.bytes.byteLength > RAW_BLOCK_MAX_BYTES)
      return {
        ok: false,
        entries: [],
        reason: `block ${block.cid} is ${block.bytes.byteLength}B — over the ${RAW_BLOCK_MAX_BYTES}B raw-block ceiling`,
      };
    const recomputed = await cidForBytes(block.bytes);
    if (recomputed !== block.cid)
      return {
        ok: false,
        entries: [],
        reason: `block ${block.cid} does not hash to its content (tamper)`,
      };
    presentDigests.add(atrHashFromCid(block.cid).toLowerCase());
    if (block.cid === root) manifestBytes = block.bytes;
  }
  if (manifestBytes === undefined)
    return {
      ok: false,
      entries: [],
      reason: "manifest block (the root) is absent from the car",
    };

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return { ok: false, entries: [], reason: "manifest is not valid JSON" };
  }
  // SHAPE-CHECKED, not cast. The manifest block need only hash to the root CID — which the CAR also
  // supplies — so every byte of this JSON is the counterparty's. Casting it to ManifestEntry[] and
  // dereferencing `e.ref` threw a raw TypeError on `{"entries":"nope"}` and on any entry missing a ref,
  // out of a function whose contract is a value. An absent `entries` key stays vacuously complete (the
  // manifest SCHEMA's minItems is checked elsewhere); a PRESENT but malformed one is a refusal.
  const entries = readEntries(parsed);
  if (entries === undefined)
    return {
      ok: false,
      entries: [],
      reason:
        "manifest entries are malformed — each entry must state a role and an lcp:sha256 ref",
    };

  // Completeness: every referenced artifact is a present block.
  for (const e of entries) {
    const digest = e.ref.slice("lcp:sha256:".length).toLowerCase();
    if (!presentDigests.has(digest))
      return {
        ok: false,
        entries,
        reason: `manifest references ${e.ref} (${e.role}) but no such block is present — incomplete bundle`,
      };
  }
  return { ok: true, entries };
}
