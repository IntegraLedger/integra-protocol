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

/** The role vocabulary, verbatim from vectors/evidence/manifest.schema.json's `role` enum. ONE spelling:
 *  `EvidenceRole` is derived from this array and `verifyBundle` checks a foreign manifest against it, so
 *  the type a caller writes against and the words a counterparty's bytes are judged by cannot drift. */
export const EVIDENCE_ROLES = [
  "atr",
  "referenced terms document",
  "signed acceptance",
  "authority chain",
  "spend artifact",
  "attestation",
  "settlement",
  "settlement-response",
  "weld",
  "terminal-state",
  "witnessed-transition",
  "timestamp",
  "orc4-log",
  "fulfillment",
  "order-state",
  "reconciliation-id",
  "status-list-snapshot",
  "issuer-key-state",
] as const;

/** One of the eighteen `EVIDENCE_ROLES` — what an artifact IS, from a closed vocabulary. */
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

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

const ROLE_VOCABULARY: ReadonlySet<string> = new Set(EVIDENCE_ROLES);

/** Narrow a counterparty-authored value to the closed role vocabulary — a predicate, not a cast, because
 *  the only thing that makes `role as EvidenceRole` true is this check having run. */
function isEvidenceRole(value: unknown): value is EvidenceRole {
  return typeof value === "string" && ROLE_VOCABULARY.has(value);
}

/** The same, for the `lcp:sha256:` reference form. */
function isManifestRef(value: unknown): value is `lcp:sha256:0x${string}` {
  return typeof value === "string" && MANIFEST_REF_RE.test(value);
}

/**
 * Read a parsed manifest's `entries`, or `undefined` when the document does not state a well-formed list.
 *
 * ⛔ `entries` is REQUIRED and every role must be one of the eighteen — both are the manifest schema's own
 * rules (`required: ["entries"]`, `role: {enum: […]}`), and `vectors/evidence/manifest-documents.json`
 * already rules "unknown role" invalid. An absent key used to read as "no entries", which handed
 * `verifyBundle` a vacuous pass over `{}`; an unknown role used to be CAST into `EvidenceRole`, so the
 * readout's own type was a claim about the counterparty's bytes that nothing had checked.
 *
 * `assurance` rides along when stated, so the readout matches what was written.
 */
function readEntries(parsed: unknown): ManifestEntry[] | undefined {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const raw = (parsed as Record<string, unknown>)["entries"];
  if (!Array.isArray(raw)) return undefined;
  const entries: ManifestEntry[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== "object" || Array.isArray(e))
      return undefined;
    const { role, ref, assurance } = e as Record<string, unknown>;
    if (!isEvidenceRole(role)) return undefined;
    if (!isManifestRef(ref)) return undefined;
    if (assurance !== undefined && typeof assurance !== "string")
      return undefined;
    entries.push({
      role,
      ref,
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
  const car = new Uint8Array(hex.length / 2);
  for (let i = 0; i < car.length; i++)
    car[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const root = await cidForBytes(manifestBytes);
  return { car, root, entries };
}

/**
 * Which of the three questions a refusal answers — and they are three different sentences a party may
 * later have to stand behind.
 *
 * ⛔ `"malformed"` is NOT a negative verdict. It says *we could not read these bytes as a bundle* — an
 * undecodable CAR frame, a manifest that is not JSON, a manifest that states no entries. Reporting that as
 * "the bundle does not verify" accuses a counterparty of handing over bad evidence when the honest
 * finding may be an interrupted download. A verification surface that collapses the two has no way to say
 * so, which is why this discriminator exists rather than a bare boolean and a sentence.
 *
 * `"integrity"` — the bundle was read, and a block does not hash to the CID that claims it.
 * `"completeness"` — the bundle was read and intact, and the manifest and the blocks do not account for
 * each other: a ref with no block, or a block no ref names.
 */
export type BundleFault = "malformed" | "integrity" | "completeness";

/** The verdict on a foreign bundle: integrity (every block hashes to its own CID) and completeness (the
 *  manifest and the blocks account for each other, both ways), with `fault` naming which question a
 *  refusal answers. A union rather than `ok: boolean` + optional fields, so a refusal without a reason —
 *  or a pass carrying one — cannot be written. What NEITHER covers: whether the artifacts mean anything.
 *  A bundle can be perfectly `ok` and contain the wrong documents. */
export type BundleVerification =
  | { ok: true; entries: ManifestEntry[] }
  | {
      ok: false;
      entries: ManifestEntry[];
      fault: BundleFault;
      reason: string;
    };

/** One refusal, with the question it answers. `entries` is what the verifier could read at the point it
 *  refused — nothing beyond that, since listing entries it never validated would be a claim. */
function refused(
  fault: BundleFault,
  reason: string,
  entries: ManifestEntry[] = [],
): BundleVerification {
  return { ok: false, entries, fault, reason };
}

/**
 * Decode a bundle CAR and confirm integrity (every block hashes to its CID) + completeness (the manifest
 * and the blocks account for each other, both ways). Returns an honest outcome — never a silent pass.
 *
 * ⛔ **Every refusal `buildBundle` makes on the way out, this makes on the way in.** They are one
 * definition of "a bundle" read in two directions, and where they disagreed the builder was the strict
 * one: it will not construct an entry-less bundle (`minItems: 1`), while this used to bless `{}` as
 * "vacuously complete" and answer `ok: true`. An empty bundle proves nothing, so `ok: true` about one is
 * a false claim — the single worst thing this function can say. The remaining asymmetries are of the same
 * kind and closed the same way: a bundle rooted at more than one manifest, and a block that no manifest
 * ref names, are both shapes `buildBundle` cannot produce and this therefore will not accept.
 */
export async function verifyBundle(
  car: Uint8Array,
): Promise<BundleVerification> {
  // The FRAME is counterparty-authored too, and `decodeCar` is fail-loud by design — so it is caught
  // here rather than allowed past. An undecodable CAR is `fault: "malformed"`: this function exists to
  // judge foreign bundles, and one that throws on the malformed input it was handed cannot report the
  // malformation. Catching is not a fallback path — returning a verdict IS the contract.
  let decoded: DecodedCar;
  try {
    decoded = decodeCar(car);
  } catch (cause) {
    return refused(
      "malformed",
      `car is not decodable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const root = decoded.roots[0];
  if (root === undefined) return refused("malformed", "car has no root");
  // A second root is a second manifest, and only the first was ever consulted — so a bundle could name
  // evidence in a root nothing read. One manifest, or this is not the shape `buildBundle` builds.
  if (decoded.roots.length > 1)
    return refused(
      "malformed",
      `car declares ${decoded.roots.length} roots — an evidence bundle is rooted at exactly one manifest`,
    );

  // Integrity: recompute each block's CID from its bytes; collect the present digests.
  const presentDigests = new Set<string>();
  let manifest: { bytes: Uint8Array; digest: string } | undefined;
  for (const block of decoded.blocks) {
    // Guard the ceiling BEFORE cidForBytes (which throws on oversize): a corrupt oversize block is an
    // honest refusal, never an uncaught crash — verifyBundle's contract is a value, not an exception.
    if (block.bytes.byteLength > RAW_BLOCK_MAX_BYTES)
      return refused(
        "malformed",
        `block ${block.cid} is ${block.bytes.byteLength}B — over the ${RAW_BLOCK_MAX_BYTES}B raw-block ceiling`,
      );
    const recomputed = await cidForBytes(block.bytes);
    if (recomputed !== block.cid)
      return refused(
        "integrity",
        `block ${block.cid} does not hash to its content (tamper)`,
      );
    // `atrHashFromCid` renders each byte with `toString(16)`, so its output is lowercase by
    // construction. The `.toLowerCase()` that used to sit here restated a canonicalization that had
    // already happened, in the one place the tree reserves for doing it.
    const digest = atrHashFromCid(block.cid);
    presentDigests.add(digest);
    if (block.cid === root) manifest = { bytes: block.bytes, digest };
  }
  if (manifest === undefined)
    return refused(
      "malformed",
      "manifest block (the root) is absent from the car",
    );

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(manifest.bytes));
  } catch {
    return refused("malformed", "manifest is not valid JSON");
  }
  // SHAPE-CHECKED, not cast. The manifest block need only hash to the root CID — which the CAR also
  // supplies — so every byte of this JSON is the counterparty's. Casting it to ManifestEntry[] and
  // dereferencing `e.ref` threw a raw TypeError on `{"entries":"nope"}` and on any entry missing a ref,
  // out of a function whose contract is a value.
  const entries = readEntries(parsed);
  if (entries === undefined)
    return refused(
      "malformed",
      "manifest entries are malformed — the manifest must state an entries list, each entry a role from the vocabulary and an lcp:sha256 ref",
    );
  if (entries.length === 0)
    return refused(
      "malformed",
      "manifest states no entries — an empty bundle evidences nothing, and buildBundle refuses to construct one (manifest schema minItems: 1)",
    );

  // Completeness, both directions. Refs first: every artifact the manifest names is a present block.
  const referencedDigests = new Set<string>();
  for (const e of entries) {
    const digest = e.ref.slice("lcp:sha256:".length).toLowerCase();
    if (!presentDigests.has(digest))
      return refused(
        "completeness",
        `manifest references ${e.ref} (${e.role}) but no such block is present — incomplete bundle`,
        entries,
      );
    referencedDigests.add(digest);
  }
  // …then blocks: an unlisted block is content travelling inside the evidence package that the manifest
  // — the readout a dispute reads — does not account for. The manifest names what is in the bundle, or
  // it does not describe the bundle.
  for (const digest of presentDigests)
    if (digest !== manifest.digest && !referencedDigests.has(digest))
      return refused(
        "completeness",
        `car carries a block with digest ${digest} that no manifest entry references — an unlisted block is not evidence`,
        entries,
      );
  return { ok: true, entries };
}
