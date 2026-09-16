/**
 * The ATA chain CUSTODY walk: presented `AtaGrant[]` in, verified readout out.
 *
 * `verify.authorityStep` consumes a per-link readout ({bounds, parentBounds, parentDelegable, …}) and
 * applies the delegation gates over it — but every field of that readout is a DERIVED fact, and whoever
 * derives it from the presented VCs is a trusted, unverified oracle unless something checks the custody
 * itself: that link N+1 was SIGNED by link N's subject, that the proof covers the grant as presented, and
 * that the leaf was granted to the key that signed the acceptance. That is this walk's job.
 *
 * The checks, PER LINK and in the order the loop applies them:
 *   1. CONTINUITY / SPLICE PREVENTION — the root is issued by the declared principal and signed by the
 *      issuer's key; every later link is signed by its parent's subject key and states that subject as
 *      its issuer. Without this the chain is unrelated assertions and anyone can splice a link in.
 *   2. ATA-3 PER HOP — everything `linkAttenuates` gates at issuance, applied verbatim at verification:
 *      the parent permitted delegation, depth arithmetic holds, bounds are contained (`isWithin`, where
 *      an absent child dimension is UNBOUNDED — the forged `{}` link is refused, never "inherited").
 *      The verdict IS `linkAttenuates`'s — one implementation, so producer and verifier cannot diverge;
 *      the per-gate refusal codes only NAME which gate it was.
 *   3. SIGNED-BYTES-MATCH-PRESENTED-LINK — the proof must verify over the grant AS PRESENTED, so the
 *      visible grant and the signed grant cannot differ. Cryptographic, therefore port-injected
 *      (`GrantProofVerifier`), the same hexagonal split as acceptance.ts's `SignatureVerifier`: the
 *      structural walk is corpus-certified (vectors/authority/chain-walk.json); the proof gate is proven
 *      in package tests against a real cryptosuite. A port REJECTION propagates — infrastructure failure
 *      is the caller's to see, never a silent verdict (the same transparency as `verifyAcceptance`).
 *      Only `walkChain` supplies the port; `walkChainStructure` runs the same loop with none.
 *   4. LIFECYCLE AS-OF SETTLEMENT — validity windows and revocation are evaluated at the settlement
 *      instant, never "now" (status.ts): expiry via `isActiveAsOf`, revocation from the hash-pinned
 *      status-list snapshot captured at settlement, never a live dereference presented as history.
 * Then, once every link has passed:
 *   5. LEAF BINDING — the leaf subject's key must be the acceptance signer (scheme-canonical form).
 *
 * And ONE thing the walk records rather than checks: profiled attestations the presenter addressed to a
 * link's subject (attestation-profile.ts). They are read as envelopes, carried onto the readout, and
 * examined no further — no substrate cryptography is verified here and no set of acceptable substrates
 * exists to compare one against. A recorded attestation can never refuse a chain and can never pass one;
 * it makes the artifact reachable and says, in the readout's own structure, that nobody here checked it.
 *
 * THE PROOF GATE IS INSIDE THE LOOP, and that is a bound rather than a refinement. It used to run as a
 * second pass over the whole chain, so the ENTIRE structural walk — every attenuation gate, every
 * status-list inflation — completed before a single proof was consulted. Measured on a 5000-link chain
 * presented in 2.4 MB, each link pointing at a 1 MiB status list: 3.9 s of blocked work and 5.2 GB
 * inflated before the port was asked about link 0, whose proof was forged. Now a forged link stops the
 * walk where it sits, and `AUTHORITY_CHAIN_MAX_LINKS` bounds how far a chain can get in the first place.
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
import {
  type ProfiledAttestation,
  type RecordedAttestation,
  recordAttestation,
} from "./attestation-profile.js";
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
  /**
   * Revoked as-of settlement — STATED ONLY WHERE A STATUS ENTRY WAS CONSULTED, absent otherwise.
   *
   * It used to be stated always, `false` where the grant carried no `credentialStatus` at all. That is the
   * PROVING value, given for a check nobody performed: the walk had consulted no status list, because the
   * grant named none. `verify.authorityStep` reads an absent `revoked` as `not-attempted` with depth
   * `no-revocation-stated` and has since 2026-08-08, on the rule its own corpus states — "the flattener
   * never consulted a status list" and "the pinned snapshot says unrevoked" must not be the same value.
   * Stamping `false` here meant the walk-fed door, the one `verify` documents as PREFERRED precisely
   * because it removes the caller's trust, was the one door that could never reach that gap. The strict
   * reading bit only the hand-flattener it was written to catch.
   *
   * A grant that names no status entry is not a grant known to be unrevoked; it is a grant whose principal
   * has no way to revoke it. ATA-3 requires revocability and `authority-producer-ref` emits a Bitstring
   * Status List entry FROM ISSUANCE for exactly that reason, so a conformant LCP grant always carries one
   * and this absence is a real deficiency rather than an ordinary shape.
   *
   * `true` never appears here: a revoked link refuses the whole chain before a readout exists.
   */
  revoked?: boolean;
  /**
   * Temporally active as-of settlement. Always stated, and it does NOT follow `revoked` above.
   *
   * The two look alike and are not. An absent `validFrom`/`validUntil` is a complete statement under VC
   * 2.0 — an unbounded window — and `isActiveAsOf` EVALUATES it against the settlement instant, so the
   * walk always has an answer it derived. Revocation status is not in the document at all: the credential
   * points at a list, and with no pointer there is nothing to consult and nothing to state.
   */
  active: boolean;
  /**
   * The attestations the presenter addressed to THIS link's subject, each recorded as an envelope this
   * walk read and did not check (attestation-profile.ts).
   *
   * PRESENT ONLY WHERE THE PRESENTER ADDRESSED THIS SUBJECT, absent otherwise — the same discipline as
   * `revoked` above: an empty list means "addressed, and it was empty", and absence means "nothing was
   * addressed here", which are different facts and must not be the same value.
   *
   * ⛔ Nothing in this list can refuse a chain. A substrate this build has never heard of, a profile it
   * cannot interpret and an element it could not read at all all travel through to the readout, because
   * refusing one would make this implementation the arbiter of which roots of trust count. The walk's
   * verdict is about CUSTODY; what an attestation is worth is the reader's question, and the `ref` in each
   * envelope is how they reach the artifact to answer it.
   */
  attestations?: RecordedAttestation[];
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
  /**
   * Profiled attestations presented ALONGSIDE the chain, keyed by the subject identifier they are
   * addressed to — the same shape as `statusSnapshots`, and for the same reason: the presenter says what
   * each artifact is about, rather than the walk inferring it.
   *
   * Keyed rather than a flat list deliberately. An element nobody can interpret still has an address, so
   * it lands on a link's readout as a stated gap instead of vanishing; a flat list matched on each
   * element's own `subject` could only drop the ones whose subject was the unreadable part.
   *
   * ⚠️ An attestation is recorded on the link it is ADDRESSED to, and it also states the subject it claims
   * to vouch for. Where those disagree the walk records both and refuses nothing: the disagreement is
   * visible in the readout, which is the honest answer, and refusing over it would be this walk ruling on
   * evidence it has not checked.
   *
   * ⛔ A key naming no walked link — the declared PRINCIPAL above all, which is an issuer and never a
   * subject — still reaches the record, as {@link UnwalkedAttestation} on the result. It used to reach
   * nothing, and a readout identical to one that was given nothing is a record that misreports its input.
   * The walk still neither refuses over such a key nor invents a link to hang it on.
   */
  attestations?: Record<string, ProfiledAttestation[]>;
}

/**
 * How many links one walk will consider. A chain is UNTRUSTED WIRE INPUT and every link costs work the
 * presenter does not pay for — an attenuation pass, a proof verification, a status-list inflation. 2.4 MB
 * of presented JSON bought 5.2 GB of decompression before this ceiling existed.
 *
 * 64 is far past any authority anyone delegates. ATA-3's depth arithmetic already forces a stated
 * `maxDepth` to decrease at every hop below a bounded parent, so only an UNBOUNDED root can produce a long
 * chain at all, and the deployed shape is principal → org → officer → agent. The number is a ceiling on
 * abuse, not a budget to spend.
 *
 * Over-length is a GAP, never a refusal: the chain did not contradict itself, this verifier declined to
 * walk it. The same ruling `decodeStatusList`'s own ceiling gets (`unreadable-status-snapshot`) — a bound
 * the verifier imposes can never impeach a record, and can never pass one either.
 */
export const AUTHORITY_CHAIN_MAX_LINKS = 64;

/** The two halting arms both walks share. A halt says nothing about which walk produced it: a spliced link
 *  is a spliced link whether or not a cryptosuite was available to check the proofs. */
export type ChainWalkHalt =
  | { status: "refused"; haltClass: HaltClass; code: string; detail: string }
  | { status: "not-attempted"; depth: string };

/**
 * One presented attestation that NO WALKED LINK could carry, recorded on the result rather than dropped.
 *
 * ⛔⛔ THIS FIELD EXISTS BECAUSE THREE PRESENTER INPUTS USED TO VANISH BYTE-IDENTICALLY TO "NOTHING WAS
 * PRESENTED", which is a readout quieter than its input and therefore the exact defect a recorder must not
 * have: an attestation addressed to the declared principal, one addressed to an identifier the chain never
 * reached, and a whole `attestations` slot that was not a keyed object. Each is legitimate wire input, none
 * of them is a reason to refuse anything, and a record that shows none of them tells a reader the presenter
 * supplied less than they did.
 *
 * ⭐ THE PRINCIPAL IS NOT A LINK, AND THAT IS THE COMMONEST CASE HERE RATHER THAN A DEFECT. A `WalkedLink`
 * is keyed on `credentialSubject.id` — who a grant was issued TO. The principal is the root grant's
 * `issuer`, the party the chain hangs FROM, and its own authority is synthesized as the root's parent
 * (unbounded, inherently delegable — see the file header) rather than walked. It therefore has no readout
 * of its own to carry anything, and an attestation about the principal — exactly what a counterparty
 * vouching for the org at the top of the chain would present — lands here, keyed as such.
 *
 * ⚠️ Two boundaries, stated rather than left to be found. A HALT carries none of this: a refused or
 * not-attempted walk has no readout at all and the halt is the whole answer. And an EMPTY list addressed
 * to an unwalked identifier contributes no entry, because there was no attestation to carry — that is a
 * distinction this flat list cannot express, and nothing is lost by it.
 *
 * ⛔ A THIRD, AND IT IS THE EXACT-IDENTIFIER RULE RATHER THAN AN OVERSIGHT. The match is against
 * `credentialSubject.id` forms alone, so an attestation addressed by the leaf's SCHEME-CANONICAL SIGNER —
 * `0xabc` where the leaf subject is `did:pkh:eip155:…:0xabc` — reads `addressed-to-no-walked-link`, even
 * though `bindsSigner` binds that very pair one gate earlier. Widening the match with that bridge would
 * put a second, silent identifier equivalence in a walk whose header says equality is EXACT and names the
 * `did:pkh` bridge as the ONE exception, defined for leaf binding; and `bindsSigner` is one-way, so the
 * answer would depend on which form the presenter happened to use. ⇒ Address to the exact identifier, as
 * a producer must GRANT to the exact identifier. The record stays honest either way: the attestation is
 * recorded, with `addressedTo` naming the form the presenter used, so a reader who knows the bridge can
 * see what happened.
 */
export interface UnwalkedAttestation {
  /** Why no link carried it — the principal is distinguished from an identifier the chain never reached. */
  depth:
    | "addressed-to-the-declared-principal"
    | "addressed-to-no-walked-link"
    | "attestations-slot-not-keyed";
  /** The identifier the presenter addressed it to, where the slot was keyed at all. */
  addressedTo?: string;
  /** Read exactly as a link-carried attestation is — the same envelope, the same stated gaps. */
  recorded: RecordedAttestation;
}

/** The STRUCTURAL walk's three-way readout: a chain walked over the presented DOCUMENTS, a reasoned
 *  refusal, or an honest gap. `walked` is deliberately NOT `verified` — see {@link VerifiedChainWalkResult}.
 *  `unwalkedAttestations` is present only when there were any, so a walk over a chain that presented none
 *  reads out exactly as it always has — which is what keeps every conformance vector byte-identical. */
export type ChainWalkResult =
  | {
      status: "walked";
      links: WalkedLink[];
      unwalkedAttestations?: UnwalkedAttestation[];
    }
  | ChainWalkHalt;

/**
 * The FULL walk's three-way readout. Its success arm is `verified`, and that one literal is the whole
 * difference — it is what makes "the documents are self-consistent" distinguishable from "and every proof
 * covers the grant as presented".
 *
 * Before the split there was nowhere in the type to record that a proof had been checked, so `walkChain`
 * returned `walkChainStructure`'s object verbatim and the two readouts were the same value. MEASURED: a
 * chain whose only proof carried the literal `proofValue: "zTOTALLYFORGED"` read `{status:"walked"}` —
 * hence `proved` at `verify`'s authority rung — through the structural walk, and `refused` through the
 * full one. `verify` documents the walk as the PREFERRED authority input and could not tell them apart,
 * so the door that removes the caller's trust was the one that silently trusted the proofs.
 *
 * `verify.authorityWalk` now accepts only this type, which makes handing it a structural walk a COMPILE
 * error rather than a runtime check nobody wrote.
 */
export type VerifiedChainWalkResult =
  | {
      status: "verified";
      links: WalkedLink[];
      unwalkedAttestations?: UnwalkedAttestation[];
    }
  | ChainWalkHalt;

/**
 * The STRUCTURAL walk — deterministic over the presented documents, no cryptography: continuity, ATA-3
 * per hop, lifecycle as-of settlement, leaf binding. This is the half the conformance corpus certifies
 * cross-implementation; `walkChain` runs the same loop WITH the proof port. Exported directly so a subject
 * with no cryptosuite can still certify the portable behavior — the same split as
 * `verifyAcceptanceStructure`. Its success arm is `walked`, never `verified`: nothing here checked a proof.
 */
export async function walkChainStructure(
  input: ChainWalkInput,
): Promise<ChainWalkResult> {
  const out = await walkLinks(input, undefined);
  return "links" in out ? { status: "walked", ...out } : out;
}

/**
 * The full custody walk: the structural gates AND the proof gate, per link, in one pass. A proof that does
 * not verify over the grant as presented refuses the whole chain at the link that carries it — no later
 * link is read and no later status list is inflated. Port rejections propagate — see the header.
 *
 * It RE-TAGS rather than returning what the loop produced: the loop yields links, and only the two public
 * entry points can name a status for them, so `walkChain` cannot hand back a structural readout even by
 * accident.
 */
export async function walkChain(
  input: ChainWalkInput,
  proofs: GrantProofVerifier,
): Promise<VerifiedChainWalkResult> {
  const out = await walkLinks(input, proofs);
  return "links" in out ? { status: "verified", ...out } : out;
}

/**
 * The one walk both entry points run. Yields the LINKS on success and a halt otherwise — untagged, because
 * naming the success arm is the caller's job and the entire point of the split.
 *
 * `proofs` is the only difference between the two walks. Supplied, each link's proof is checked as the
 * loop reaches it; absent, the same gates run with the cryptography left out.
 */
async function walkLinks(
  input: ChainWalkInput,
  proofs: GrantProofVerifier | undefined,
): Promise<
  | { links: WalkedLink[]; unwalkedAttestations?: UnwalkedAttestation[] }
  | ChainWalkHalt
> {
  const raw: Record<string, unknown> = isObject(input) ? input : {};
  const chain = raw["chain"];
  if (!Array.isArray(chain)) return gap("no-authority-chain");
  if (chain.length === 0) return gap("empty-authority-chain");
  if (chain.length > AUTHORITY_CHAIN_MAX_LINKS)
    return gap("authority-chain-too-long");
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
  // A presented `attestations` slot that is not a keyed object addresses nobody, so nothing can hang on a
  // link — but it is not therefore ABSENT, and reading it that way was a defect: the presenter put
  // something there, and a readout identical to one that was given nothing is a record that misreports its
  // own input. It can still never impeach a chain; it is carried out to `unwalkedAttestations` below.
  const attestationSlot = raw["attestations"];
  const attestations = isObject(attestationSlot)
    ? (attestationSlot as Record<string, unknown>)
    : undefined;

  // ONE INFLATION PER STATUS LIST, not one per link. Every link of a chain normally points at the SAME
  // issuer status list, and each entry was decoded independently — 64 links against a list at the 1 MiB
  // ceiling inflated 64 MiB to read 64 bits. The snapshots are hash-pinned and immutable for the walk, so
  // a decode is a pure function of the encoded string and caching it changes no answer. Only successes are
  // cached; a throw is re-derived, and re-derives the same way.
  const decoded = new Map<string, Uint8Array>();
  const links: WalkedLink[] = [];
  // The identifiers a readout EXISTS for. Collected rather than re-derived from `links`, which carries
  // bounds and not subjects, and it is what decides whether a presented key had anywhere to land.
  const walkedSubjects = new Set<string>();
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
    // THE PROOF GATE, HERE rather than in a second pass — the header's bound. It sits behind the
    // continuity and ATA-3 gates so a link the documents already contradict is named by the gate that
    // caught it (`walk/spliced-link`, not `walk/proof-invalid`), and in FRONT of lifecycle so a forged
    // link never inflates a status list. Absent port ⇒ this is the structural walk and there is nothing
    // to consult.
    if (proofs !== undefined && !(await proofs.verify(grant)))
      return refuse(
        "walk/proof-invalid",
        `link ${i}'s proof does not verify over the grant as presented`,
      );
    if (!isActiveAsOf(grant.validFrom, grant.validUntil, asOf))
      return refuse(
        "walk/inactive-link",
        `link ${i} is not temporally active as-of the settlement instant ${asOf}`,
      );
    // `undefined` unless a status entry was actually CONSULTED. It stays that way for a grant carrying no
    // `credentialStatus`, and that absence travels all the way into the readout — see `readout`.
    let revoked: boolean | undefined;
    if (grant.credentialStatus !== undefined) {
      const revocation = await revocationFromSnapshot(
        grant.credentialStatus,
        snapshots,
        decoded,
      );
      if (revocation !== "unrevoked") {
        if (revocation === "revoked")
          return refuse(
            "walk/revoked-link",
            `link ${i} is revoked as-of settlement in the pinned status-list snapshot`,
          );
        return gap(revocation);
      }
      revoked = false; // the pinned snapshot was read as-of settlement and the bit is clear
    }
    // AFTER every gate above, and deliberately: recording is the last thing the loop does for a link, so
    // no presented attestation can be reached before the walk has already decided the link is sound.
    links.push(
      readout(
        grant,
        parent,
        revoked,
        addressedAttestations(attestations, grant.credentialSubject.id),
      ),
    );
    walkedSubjects.add(grant.credentialSubject.id);
    parent = grant;
  }
  // `parent` is the leaf here — the loop ran at least once (empty chains returned above).
  const leaf = (parent as AtaGrant).credentialSubject.id;
  if (!bindsSigner(leaf, signer))
    return refuse(
      "walk/leaf-not-signer",
      `custody ends at ${leaf}, but the acceptance was signed by ${signer}`,
    );
  const unwalkedAttestations = unwalked(
    attestationSlot,
    attestations,
    walkedSubjects,
    principal,
  );
  return {
    links,
    // OMITTED WHEN EMPTY, never `[]`. The key's presence is itself the statement that something was
    // presented and could not be carried, and an empty array would add a key to every readout in the
    // conformance corpus — which compares the whole object.
    ...(unwalkedAttestations.length > 0 ? { unwalkedAttestations } : {}),
  };
}

/**
 * Everything the presenter supplied that no walked link could carry — see {@link UnwalkedAttestation}.
 *
 * ⛔ Total and refusal-free, like every other reader on this path. The unkeyed slot is read through
 * `recordAttestation` exactly as a keyed element is, so a flat list of attestations reads out as its
 * elements rather than as one opaque "that was not an object", and a scalar reads out as the stated gap
 * `attestation-not-an-object`. Nothing here can change the chain's verdict.
 */
function unwalked(
  slot: unknown,
  attestations: Record<string, unknown> | undefined,
  walkedSubjects: Set<string>,
  principal: string,
): UnwalkedAttestation[] {
  const out: UnwalkedAttestation[] = [];
  if (slot !== undefined && attestations === undefined)
    for (const item of Array.isArray(slot) ? slot : [slot])
      out.push({
        depth: "attestations-slot-not-keyed",
        recorded: recordAttestation(item),
      });
  if (attestations !== undefined)
    for (const key of Object.keys(attestations)) {
      if (walkedSubjects.has(key)) continue;
      const depth =
        key === principal
          ? "addressed-to-the-declared-principal"
          : "addressed-to-no-walked-link";
      const addressed = attestations[key];
      if (!Array.isArray(addressed)) {
        out.push({
          depth,
          addressedTo: key,
          recorded: {
            status: "not-attempted",
            depth: "attestations-not-a-list",
          },
        });
        continue;
      }
      for (const item of addressed)
        out.push({
          depth,
          addressedTo: key,
          recorded: recordAttestation(item),
        });
    }
  return out;
}

function gap(depth: string): ChainWalkHalt {
  return { status: "not-attempted", depth };
}

function refuse(code: string, detail: string): ChainWalkHalt {
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
  decoded: Map<string, Uint8Array>,
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
  // THE CACHE IS CONSULTED FIRST, before the snapshot is even read out of the record. A list already
  // decoded on an earlier link was, by that fact, present — so the `no-status-snapshot` gap below cannot
  // be reached a second time for the same list, and the caller's map is touched exactly once per list.
  let bits = decoded.get(list);
  if (bits === undefined) {
    const snapshot = snapshots?.[list];
    if (snapshot === undefined) return "no-status-snapshot";
    try {
      bits = await decodeStatusList(snapshot);
    } catch {
      return "unreadable-status-snapshot";
    }
    decoded.set(list, bits);
  }
  const at = Number.parseInt(index, 10);
  if (at >= bits.length * 8) return "status-index-out-of-range";
  return statusBit(bits, at) ? "revoked" : "unrevoked";
}

/** One verified hop, flattened. The root's synthesized parent is the principal's own authority:
 *  unbounded (`{}` restricts nothing as a parent) and inherently delegable — see the header.
 *
 *  `revoked` is THREADED IN rather than re-derived from `grant.credentialStatus`: the loop is where the
 *  snapshot was consulted, and a second reading of the same slot here would be a copy that can drift from
 *  what actually happened. Absent ⇒ no status entry was consulted, which is not the same fact as clean. */
function readout(
  grant: AtaGrant,
  parent: AtaGrant | undefined,
  revoked: boolean | undefined,
  attestations: RecordedAttestation[] | undefined,
): WalkedLink {
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
    ...(revoked !== undefined ? { revoked } : {}),
    active: true,
    ...(attestations !== undefined ? { attestations } : {}),
  };
}

/**
 * What the presenter addressed to one WALKED subject, recorded. `undefined` where they addressed it nothing
 * at all — the readout then omits the field, and an empty list stays an empty list.
 *
 * A slot addressed to a subject but holding something that is not a list is itself a stated gap rather than
 * a discarded one: the presenter put SOMETHING there, and a readout that showed nothing would be reporting
 * that they did not. Keys this never sees — because no link carries them — are {@link unwalked}'s.
 */
function addressedAttestations(
  attestations: Record<string, unknown> | undefined,
  subject: string,
): RecordedAttestation[] | undefined {
  if (attestations === undefined) return undefined;
  if (!Object.hasOwn(attestations, subject)) return undefined;
  const addressed = attestations[subject];
  if (!Array.isArray(addressed))
    return [{ status: "not-attempted", depth: "attestations-not-a-list" }];
  return addressed.map(recordAttestation);
}
