/**
 * The ATA chain CUSTODY walk: presented `AtaGrant[]` in, verified readout out.
 *
 * `verify.authorityStep` consumes a per-link readout ({bounds, parentBounds, parentDelegable, …}) and
 * applies the delegation gates over it — but every field of that readout is a DERIVED fact, and whoever
 * derives it from the presented VCs is a trusted, unverified oracle unless something checks the custody
 * itself: that link N+1 was SIGNED by link N's subject, that the proof covers the grant as presented, and
 * that the leaf was granted to the key that signed the acceptance. That is this walk's job.
 *
 * The checks, in walk order:
 *   1. CONTINUITY / SPLICE PREVENTION — the root is issued by the declared principal and signed by the
 *      issuer's key; every later link is signed by its parent's subject key and states that subject as
 *      its issuer. Without this the chain is unrelated assertions and anyone can splice a link in.
 *   2. SIGNED-BYTES-MATCH-PRESENTED-LINK — the proof must verify over the grant AS PRESENTED, so the
 *      visible grant and the signed grant cannot differ. Cryptographic, therefore port-injected
 *      (`GrantProofVerifier`), the same hexagonal split as acceptance.ts's `SignatureVerifier`: the
 *      structural walk is corpus-certified (vectors/authority/chain-walk.json); the proof gate is proven
 *      in package tests against a real cryptosuite. A port REJECTION propagates — infrastructure failure
 *      is the caller's to see, never a silent verdict (the same transparency as `verifyAcceptance`).
 *   3. LEAF BINDING — the leaf subject's key must be the acceptance signer (scheme-canonical form).
 *   4. ATA-3 PER HOP — everything `linkAttenuates` gates at issuance, applied verbatim at verification:
 *      the parent permitted delegation, depth arithmetic holds, bounds are contained (`isWithin`, where
 *      an absent child dimension is UNBOUNDED — the forged `{}` link is refused, never "inherited").
 *      The verdict IS `linkAttenuates`'s — one implementation, so producer and verifier cannot diverge;
 *      the per-gate refusal codes only NAME which gate it was.
 *   5. LIFECYCLE AS-OF SETTLEMENT — validity windows and revocation are evaluated at the settlement
 *      instant, never "now" (status.ts): expiry via `isActiveAsOf`, revocation from the hash-pinned
 *      status-list snapshot captured at settlement, never a live dereference presented as history.
 *
 * Outcome discipline is verify's three-way rule, and the walk is TOTAL over untrusted wire input: a
 * chain that CONTRADICTS itself is `refused` (verification-failure, with a code naming the defect); a
 * missing or unwalkable input — no chain, no snapshot for a claimed status list, a malformed element, a
 * link carrying no proof — is `not-attempted`, never failed, never passed. A crash is not a decision.
 *
 * Identifier equality is EXACT. The core has no per-rail case rules — folding case would corrupt
 * case-sensitive identifiers to accommodate one rail. The one bridge is `did:pkh` (the DID method whose
 * final `:`-segment IS the account identifier): a leaf `did:pkh:eip155:…:0xabc` binds the
 * scheme-canonical signer `0xabc`. Producers of any other identifier form must grant to the signer's
 * exact identifier.
 *
 * `WalkedLink` is structurally compatible with `verify.AuthorityLink` BY CONSTRUCTION, but the named
 * type lives here: verify imports authority, so authority cannot import the name back without a cycle.
 * The root link's parent is synthesized as the principal's own authority — unbounded in every ATA-2
 * dimension (`{}` as a PARENT restricts nothing) and inherently delegable, because issuing the root
 * grant is itself the act of delegating it. A single direct grant therefore reads out as one link, not
 * as an empty (unprovable) chain.
 */
import type { HaltClass } from "@integraledger/lcp-binding-core";
import type { Bounds } from "./bounds.js";
import { type AtaGrant, linkAttenuates } from "./grant.js";
import { decodeStatusList, isActiveAsOf, statusBit } from "./status.js";

/** One verified hop of the chain — the flattened readout `verify.authorityStep` consumes. */
export interface WalkedLink {
  bounds: Bounds;
  parentBounds: Bounds;
  parentDelegable: boolean;
  parentMaxDepth?: number;
  maxDepth?: number;
  /** Always stated, never defaulted: the walk CHECKED the pinned snapshot (or the grant carries no status entry). */
  revoked: boolean;
  /** Always stated: the walk evaluated the validity window as-of the settlement instant. */
  active: boolean;
}

/** The proof-verification port: does the proof verify over the grant AS PRESENTED (signed bytes = visible
 *  bytes, under the proof's stated verificationMethod)? Cryptosuite implementations live with their
 *  producers/rails; refusing suites it does not implement — and rejecting, never throwing synchronously —
 *  is the port's contract, exactly as `SignatureVerifier`'s (acceptance.ts). */
export interface GrantProofVerifier {
  verify(grant: AtaGrant): Promise<boolean>;
}

/** What a custody walk needs. `statusSnapshots` maps `statusListCredential` → the hash-pinned
 *  `encodedList` captured at settlement — as-of means the snapshot, never a live dereference. */
export interface ChainWalkInput {
  /** The declared principal the root grant must be issued (and signed) by. */
  principal: string;
  /** Root first, leaf last: the root grant, then each delegation link below it. */
  chain: AtaGrant[];
  /** The acceptance signer in the scheme's canonical form (acceptance.ts) the leaf must bind. */
  acceptanceSigner: string;
  /** The settlement instant (RFC 3339) every window and revocation is evaluated as-of. */
  asOf: string;
  statusSnapshots?: Record<string, string>;
}

/** The three-way readout: verified custody, a reasoned refusal, or an honest gap. */
export type ChainWalkResult =
  | { status: "walked"; links: WalkedLink[] }
  | { status: "refused"; haltClass: HaltClass; code: string; detail: string }
  | { status: "not-attempted"; depth: string };

/**
 * The STRUCTURAL walk — deterministic over the presented documents, no cryptography: continuity, leaf
 * binding, ATA-3 per hop, lifecycle as-of settlement. This is the half the conformance corpus certifies
 * cross-implementation; `walkChain` composes the proof gate on top. Exported directly so a subject with
 * no cryptosuite can still certify the portable behavior — the same split as `verifyAcceptanceStructure`.
 */
export async function walkChainStructure(
  input: ChainWalkInput,
): Promise<ChainWalkResult> {
  const raw: Record<string, unknown> = isObject(input) ? input : {};
  const chain = raw["chain"];
  if (!Array.isArray(chain)) return gap("no-authority-chain");
  if (chain.length === 0) return gap("empty-authority-chain");
  const principal = raw["principal"];
  if (!nonEmptyString(principal)) return gap("no-principal");
  const signer = raw["acceptanceSigner"];
  if (!nonEmptyString(signer)) return gap("no-acceptance-signer");
  const asOf = raw["asOf"];
  if (!nonEmptyString(asOf)) return gap("no-settlement-instant");
  if (Number.isNaN(Date.parse(asOf)))
    return gap("unreadable-settlement-instant");
  const snapshots = isObject(raw["statusSnapshots"])
    ? (raw["statusSnapshots"] as Record<string, string>)
    : undefined;

  const links: WalkedLink[] = [];
  let parent: AtaGrant | undefined;
  for (const [i, element] of chain.entries()) {
    const grant = walkableGrant(element);
    if (grant === undefined) return gap("malformed-authority-chain");
    const signedBy = proofKey(grant);
    if (signedBy === undefined) return gap("unproven-link");
    if (parent === undefined) {
      if (grant.issuer !== principal)
        return refuse(
          "walk/root-not-principal",
          `the root is issued by ${grant.issuer}, not the declared principal ${principal}`,
        );
      if (signedBy !== grant.issuer)
        return refuse(
          "walk/root-key-mismatch",
          `the root is signed by ${signedBy}, not its issuer ${grant.issuer}`,
        );
    } else {
      if (signedBy !== parent.credentialSubject.id)
        return refuse(
          "walk/spliced-link",
          `link ${i} is signed by ${signedBy}, not the parent's subject ${parent.credentialSubject.id} — the chain is spliced`,
        );
      if (grant.issuer !== parent.credentialSubject.id)
        return refuse(
          "walk/issuer-discontinuity",
          `link ${i} states issuer ${grant.issuer} but the parent delegated to ${parent.credentialSubject.id}`,
        );
      if (!linkAttenuates(grant, parent))
        return refuse(
          attenuationCode(grant, parent),
          `link ${i} does not attenuate its parent (ATA-3)`,
        );
    }
    if (!isActiveAsOf(grant.validFrom, grant.validUntil, asOf))
      return refuse(
        "walk/inactive-link",
        `link ${i} is not temporally active as-of the settlement instant ${asOf}`,
      );
    if (grant.credentialStatus !== undefined) {
      const revocation = await revocationFromSnapshot(
        grant.credentialStatus,
        snapshots,
      );
      if (revocation !== "unrevoked") {
        if (revocation === "revoked")
          return refuse(
            "walk/revoked-link",
            `link ${i} is revoked as-of settlement in the pinned status-list snapshot`,
          );
        return gap(revocation);
      }
    }
    links.push(readout(grant, parent));
    parent = grant;
  }
  // `parent` is the leaf here — the loop ran at least once (empty chains returned above).
  const leaf = (parent as AtaGrant).credentialSubject.id;
  if (!bindsSigner(leaf, signer))
    return refuse(
      "walk/leaf-not-signer",
      `custody ends at ${leaf}, but the acceptance was signed by ${signer}`,
    );
  return { status: "walked", links };
}

/**
 * The full custody walk: the structural walk, then the proof gate per link through the port. Anything
 * short of `walked` passes through unchanged; a proof that does not verify over the grant as presented
 * refuses the whole chain. Port rejections propagate — see the header.
 */
export async function walkChain(
  input: ChainWalkInput,
  proofs: GrantProofVerifier,
): Promise<ChainWalkResult> {
  const structural = await walkChainStructure(input);
  if (structural.status !== "walked") return structural;
  for (const [i, grant] of input.chain.entries()) {
    if (!(await proofs.verify(grant)))
      return refuse(
        "walk/proof-invalid",
        `link ${i}'s proof does not verify over the grant as presented`,
      );
  }
  return structural;
}

function gap(depth: string): ChainWalkResult {
  return { status: "not-attempted", depth };
}

function refuse(code: string, detail: string): ChainWalkResult {
  return { status: "refused", haltClass: "verification-failure", code, detail };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Every slot the walk dereferences, shape-checked — a malformed element is a GAP, never a crash and
 *  never a refusal: the caller's shape error says nothing about whether the chain is self-consistent. */
function walkableGrant(v: unknown): AtaGrant | undefined {
  if (!isObject(v)) return undefined;
  if (!nonEmptyString(v["issuer"])) return undefined;
  const subject = v["credentialSubject"];
  if (!isObject(subject)) return undefined;
  if (!nonEmptyString(subject["id"])) return undefined;
  if (!walkableBounds(subject["bounds"])) return undefined;
  const delegable = subject["delegable"];
  if (delegable !== undefined && typeof delegable !== "boolean")
    return undefined;
  // FINITE, not merely `typeof "number"`: `NaN` compares false on BOTH sides of every depth gate
  // (`NaN <= 0`, `x > NaN - 1`), so it would silently disengage the ATA-3 escalation arithmetic in
  // `linkAttenuates` AND in the re-walking `authorityStep` — a stated-but-unusable depth is a shape
  // gap. (Negative and fractional depths need no screening: the arithmetic fails closed on them.)
  const maxDepth = subject["maxDepth"];
  if (maxDepth !== undefined && !Number.isFinite(maxDepth)) return undefined;
  if (!walkableInstant(v["validFrom"]) || !walkableInstant(v["validUntil"]))
    return undefined;
  return v as unknown as AtaGrant;
}

/** Known dimensions must carry their declared types (or `isWithin` would crash mid-walk); UNKNOWN keys
 *  are deliberately not screened here — they are `isWithin`'s fail-closed refusal, not a shape gap. */
function walkableBounds(v: unknown): boolean {
  if (!isObject(v)) return false;
  const stringArray = (x: unknown): boolean =>
    x === undefined ||
    (Array.isArray(x) && x.every((s) => typeof s === "string"));
  if (
    !stringArray(v["jurisdictions"]) ||
    !stringArray(v["disputeMethods"]) ||
    !stringArray(v["forbiddenClauseCategories"])
  )
    return false;
  const caps = v["caps"];
  if (caps !== undefined) {
    if (!isObject(caps)) return false;
    for (const cap of Object.values(caps))
      if (typeof cap !== "string") return false;
  }
  return true;
}

function walkableInstant(v: unknown): boolean {
  return (
    v === undefined || (typeof v === "string" && !Number.isNaN(Date.parse(v)))
  );
}

/** The key that signed the grant: `verificationMethod` minus its `#fragment` — a DID's verification
 *  method is a fragment under its controller. `undefined` = no usable proof (a gap, not a refusal). */
function proofKey(grant: AtaGrant): string | undefined {
  const proof: unknown = grant.proof;
  if (!isObject(proof)) return undefined;
  const method = proof["verificationMethod"];
  if (!nonEmptyString(method)) return undefined;
  const hash = method.indexOf("#");
  return hash === -1 ? method : method.slice(0, hash);
}

/** Exact identity, plus the one method-defined bridge: a `did:pkh` leaf binds its account segment. */
function bindsSigner(leafId: string, signer: string): boolean {
  if (leafId === signer) return true;
  if (leafId.startsWith("did:pkh:"))
    return leafId.slice(leafId.lastIndexOf(":") + 1) === signer;
  return false;
}

/** NAME the ATA-3 gate that refused — the verdict itself is `linkAttenuates`'s, already given. The order
 *  mirrors the predicate's own (delegable → depth → bounds), so the last arm needs no third re-check. */
function attenuationCode(link: AtaGrant, parent: AtaGrant): string {
  if (parent.credentialSubject.delegable !== true)
    return "walk/parent-not-delegable";
  return depthFits(link, parent)
    ? "walk/widened-bounds"
    : "walk/depth-escalation";
}

/** The depth half of `linkAttenuates`, re-stated for naming only: under a depth-bounded parent the link
 *  must STATE a depth of at most `parentDepth - 1` (absent = unbounded = escalation). The `!== undefined`
 *  clause is TypeScript's truth, not JavaScript's — `undefined <= n` is already false — so its mutant is
 *  EQUIVALENT and survives mutation testing; that is the one accepted survivor in this file. */
function depthFits(link: AtaGrant, parent: AtaGrant): boolean {
  const parentDepth = parent.credentialSubject.maxDepth;
  if (parentDepth === undefined) return true;
  if (parentDepth <= 0) return false;
  const linkDepth = link.credentialSubject.maxDepth;
  return linkDepth !== undefined && linkDepth <= parentDepth - 1;
}

/** Revocation as-of settlement, from the pinned snapshot alone. Three-way by design: `"revoked"` refuses,
 *  `"unrevoked"` proceeds, and any string beyond those two is the GAP depth to report — an unreadable or
 *  missing snapshot can never pass, and can never impeach either. */
async function revocationFromSnapshot(
  status: unknown,
  snapshots: Record<string, string> | undefined,
): Promise<"revoked" | "unrevoked" | string> {
  if (!isObject(status)) return "malformed-credential-status";
  const list = status["statusListCredential"];
  const index = status["statusListIndex"];
  const purpose = status["statusPurpose"];
  if (
    !nonEmptyString(list) ||
    typeof index !== "string" ||
    !/^\d+$/.test(index) ||
    !nonEmptyString(purpose)
  )
    return "malformed-credential-status";
  // Bitstring Status List v1.0 REQUIRES `statusPurpose`, and it is what the set bit MEANS — a bit set
  // under `suspension` is not a revocation, and reading it as one would refuse a chain over a state this
  // walk has no semantics for. Unknown purposes therefore fail closed as a GAP, exactly as `isWithin`
  // refuses a bound dimension it cannot check: never read as revocation, and never a pass either.
  if (purpose !== "revocation") return "unsupported-status-purpose";
  const snapshot = snapshots?.[list];
  if (snapshot === undefined) return "no-status-snapshot";
  let bits: Uint8Array;
  try {
    bits = await decodeStatusList(snapshot);
  } catch {
    return "unreadable-status-snapshot";
  }
  const at = Number.parseInt(index, 10);
  if (at >= bits.length * 8) return "status-index-out-of-range";
  return statusBit(bits, at) ? "revoked" : "unrevoked";
}

/** One verified hop, flattened. The root's synthesized parent is the principal's own authority:
 *  unbounded (`{}` restricts nothing as a parent) and inherently delegable — see the header. */
function readout(grant: AtaGrant, parent: AtaGrant | undefined): WalkedLink {
  const subject = grant.credentialSubject;
  const parentMaxDepth = parent?.credentialSubject.maxDepth;
  return {
    bounds: subject.bounds,
    parentBounds: parent === undefined ? {} : parent.credentialSubject.bounds,
    // Uniformly true BY THE TIME A READOUT EXISTS: a hop below a non-delegable parent was refused
    // before this call, and the synthesized root parent is inherently delegable. Re-deriving it here
    // would be dead logic wearing a check's clothes.
    parentDelegable: true,
    ...(parentMaxDepth !== undefined ? { parentMaxDepth } : {}),
    ...(subject.maxDepth !== undefined ? { maxDepth: subject.maxDepth } : {}),
    revoked: false,
    active: true,
  };
}
