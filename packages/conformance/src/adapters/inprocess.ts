import { Validator } from "@cfworker/json-schema";
import {
  type AtaGrant,
  type Bounds,
  type ChainWalkInput,
  isWithin,
  linkAttenuates,
  type SignedAcceptance,
  verifyAcceptanceStructure,
  walkChainStructure,
} from "@integraledger/lcp-authority";
import {
  type CarrierOp,
  carrierOp,
  isKnownProtocolId,
  type LegalContextRef,
  type Outcome,
} from "@integraledger/lcp-binding-core";
import {
  type AgentCardExtensionOptions,
  emitAgentCardExtension,
  emitUcpCapability,
  isLegalContextJson,
  type LcpCapabilityDeclaration,
  readAgentCard,
  readUcpProfile,
} from "@integraledger/lcp-discovery";
import { cidForAtrHash, encodeCarBlocksHex } from "@integraledger/lcp-evidence";
import {
  assemble,
  hashAtr,
  normalizeTerms,
  type Slot,
} from "@integraledger/lcp-kernel";
import { placementFor } from "@integraledger/lcp-placements";
import {
  type AuthorityLink,
  authorityStep,
  computeVerified,
  jcsCanonicalize,
  type RecordIdentity,
  recourseStep,
  referencePlacementStep,
  resolvePartyStep,
  type StepName,
  type TransactionClass,
  type VerifyDepth,
} from "@integraledger/lcp-verify";
import type { Subject, SubjectRequest, SubjectResponse } from "../subject.js";

/**
 * The vector byte-input convention (`{ encoding: "utf8" | "hex", data }`, hex lowercase-0x-required
 * — the same prefix rule as the kernel's `hexToBytes`, pinned by the `uppercase-0X-prefix` reject vector),
 * owned by the harness so foreign subjects agree on input bytes. Strict — the reject vectors pin it.
 * Encoding is checked FIRST: an un-normalized vector (`utf-8`/`value`) is an unknown-encoding
 * port error, not bad data — the code must name the actual defect.
 */
function decodeInput(input: { encoding: string; data: unknown }): Uint8Array {
  if (input.encoding !== "utf8" && input.encoding !== "hex")
    throw Object.assign(new Error("unknown encoding"), {
      code: "byteInput/unknown-encoding",
    });
  if (typeof input.data !== "string")
    throw Object.assign(new Error("non-string data"), {
      code: "byteInput/bad-data",
    });
  if (input.encoding === "utf8") return new TextEncoder().encode(input.data);
  if (!input.data.startsWith("0x"))
    throw Object.assign(new Error("hex data must be 0x-prefixed"), {
      code: "byteInput/bad-hex",
    });
  const h = input.data.slice(2);
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h))
    throw Object.assign(new Error("bad hex"), { code: "byteInput/bad-hex" });
  return Uint8Array.from(
    (h.match(/../g) ?? []).map((b) => Number.parseInt(b, 16)),
  );
}

/**
 * The namespace this subject deploys under, for the placements whose carrier sits in one.
 *
 * The harness is a deployment like any other: `@integraledger/lcp-placements` refuses to default a reverse-domain
 * namespace, so the subject states its own. This value is the one the mastercard-vi vectors are written
 * in — a different value here would fail every one of those cases on a namespace mismatch rather than on
 * behaviour.
 */
const SUBJECT_DEPLOYMENT = { reverseDomain: "com.integraledger" } as const;

/**
 * Drop a refusal's `detail` before it reaches a vector comparison. `detail` is human-facing prose, so
 * pinning it would encode one implementation's phrasing as the standard and make every wording change a
 * vector amendment; `refused`/`haltClass`/`code` are the cross-implementation contract. The same
 * normalization the `acceptance` and `chainWalk` classes apply, for the same reason.
 */
function normalizeRefusal(outcome: Outcome<unknown>): unknown {
  return "refused" in outcome
    ? { refused: true, haltClass: outcome.haltClass, code: outcome.code }
    : outcome;
}

/** The reference `Subject` — this repository's own implementation, driven through the same request/
 *  response protocol a foreign subject would use. It runs in-process with no transport, which makes it the
 *  fast path for development and the wrong instrument for certifying anything else: a corpus run against
 *  this subject proves the corpus agrees with the code it was written beside. */
export class InProcessSubject implements Subject {
  async handle(req: SubjectRequest): Promise<SubjectResponse> {
    try {
      switch (req.class) {
        case "byteInput": {
          const bytes = decodeInput(
            req.input as { encoding: string; data: unknown },
          );
          let hex = "";
          for (const b of bytes) hex += b.toString(16).padStart(2, "0");
          return { output: hex };
        }
        case "hashAtr":
          return {
            output: await hashAtr(
              decodeInput(req.input as { encoding: string; data: unknown }),
            ),
          };
        case "termsNormalize":
          return { output: normalizeTerms(req.input as string) };
        case "schema": {
          // Validate against the canonical JSON Schema itself (passed inline by the runner) —
          // the tree is the source of truth; there is no package-level schema to drift.
          if (req.schema === undefined)
            throw Object.assign(new Error("schema class without schema"), {
              code: "schema/missing",
            });
          const validator = new Validator(
            req.schema as ConstructorParameters<typeof Validator>[0],
            "2020-12",
            false,
          );
          return { output: validator.validate(req.input).valid };
        }
        case "assemble": {
          const { atrBytes, atrHash } = await assemble(req.input as Slot[]);
          return {
            output: { file: new TextDecoder().decode(atrBytes), hash: atrHash },
          };
        }
        case "carrier":
          // LCP §8.1/§8.2 carrier codec (binding-core). A CarrierError thrown here is surfaced as its
          // .code by the catch below (the codes the carrier vectors assert).
          return { output: carrierOp(req.input as CarrierOp) };
        case "legalContext":
          // LCP §2.4/§2.5 discovery-document validation (discovery). Boolean valid/invalid per the vector.
          return { output: isLegalContextJson(req.input) };
        case "carEncode": {
          // Deterministic CARv1 (evidence). Ordered raw blocks + a root → the exact CAR bytes (hex).
          const { blocks, rootIndex } = req.input as {
            blocks: { encoding: string; data: unknown }[];
            rootIndex: number;
          };
          return {
            output: await encodeCarBlocksHex(
              blocks.map(decodeInput),
              rootIndex,
            ),
          };
        }
        case "cidForAtrHash":
          // LCP §7.2 CID == atrHash (evidence). A CidError's .code is surfaced by the catch below.
          return { output: cidForAtrHash(req.input as string) };
        case "isWithin": {
          // ATA-2 bounds attenuation (authority). child within parent? — the meet-semilattice predicate.
          const { child, parent } = req.input as {
            child: Bounds;
            parent: Bounds;
          };
          return { output: isWithin(child, parent) };
        }
        case "linkAttenuates": {
          // ATA-3 at ISSUANCE (authority). The delegation half `isWithin` says nothing about: did the
          // parent permit delegation, did depth remain below it, did the link state a depth that fits.
          const { link, parent } = req.input as {
            link: AtaGrant;
            parent: AtaGrant;
          };
          return { output: linkAttenuates(link, parent) };
        }
        case "authorityWalk": {
          // ATA-3 at VERIFICATION time (verify) — the same gates the producer applies, so a conformant
          // implementation cannot permit at issuance what it refuses on the walk, or the reverse.
          const { chain } = req.input as { chain?: AuthorityLink[] };
          return { output: authorityStep(chain) };
        }
        case "chainWalk": {
          // ATA chain CUSTODY (authority) — continuity, leaf binding, per-hop attenuation, lifecycle
          // as-of settlement, over presented VC grants. The corpus certifies the STRUCTURAL walk (the
          // walk is total over untyped input by design); the cryptographic proof gate is port-injected
          // and out of the corpus, like the acceptance signature gate. Refusal `detail` prose is
          // deliberately unpinned — the vectors assert the code, not the sentence.
          const walk = await walkChainStructure(req.input as ChainWalkInput);
          return {
            output:
              walk.status === "refused"
                ? {
                    status: "refused",
                    haltClass: walk.haltClass,
                    code: walk.code,
                  }
                : walk,
          };
        }
        case "acceptance": {
          // TRM-6 acceptance STRUCTURE (authority) — atrHash-binding + ATA-4 commitment-vs-leaf. The
          // cryptographic signature gate is binding-evm-common's (not deterministic/portable) and is
          // out of this corpus by design. Normalized outcome: { ok } | { refused, haltClass, code }.
          const { acceptance, expectedAtrHash, ata4 } = req.input as {
            acceptance: SignedAcceptance;
            expectedAtrHash: string;
            ata4?: { commitment: Bounds; leafBounds: Bounds };
          };
          const outcome = verifyAcceptanceStructure(
            acceptance,
            expectedAtrHash,
            ata4,
          );
          return {
            output:
              "refused" in outcome
                ? {
                    refused: true,
                    haltClass: outcome.haltClass,
                    code: outcome.code,
                  }
                : { ok: true },
          };
        }
        case "jcs":
          // VerificationReport serialization (verify) — RFC 8785 canonical JSON, byte-for-byte.
          return { output: jcsCanonicalize(req.input) };
        case "verifyClass": {
          // The class ladder (verify) — does this walk mechanically support the claimed class?
          // The ladder is the standard's own semantics, so it is certified cross-implementation here rather
          // than in one package's private tests.
          const { depth, claimedClass, steps } = req.input as {
            depth: VerifyDepth;
            claimedClass: TransactionClass;
            steps: { name: StepName; status: string }[];
          };
          return {
            output: computeVerified(
              steps.map((s) => ({
                name: s.name,
                outcome: { status: s.status },
              })),
              claimedClass,
              depth,
            ),
          };
        }
        case "verifyStep": {
          // Run ONE named verify step over its slot input and read out the StepOutcome. The step name
          // rides the case input rather than the area, so a later step registers an area without another
          // adapter change — and so a case is self-describing when read on its own.
          const { step } = req.input as { step?: string };
          // IDN-1/IDN-3 — the attribution rung every class from TC-1 up carries. Normative because the
          // question it answers ("did this record state WHO the parties are and HOW they were resolved?")
          // is a spec requirement, not an implementation detail: an implementation that proves attribution
          // from a blank identity would otherwise pass conformance while recording an attribution nobody
          // supplied. Ours did, until verify 0.11.0.
          if (step === "resolve-party") {
            const { identity } = req.input as { identity?: RecordIdentity };
            // Handed over as-is: the step is TOTAL over untyped input by contract, and re-checking the
            // shape here would duplicate that contract where the two could later disagree.
            return { output: resolvePartyStep(identity) };
          }
          if (step !== "reference-placement")
            return { error: `unknown-verify-step:${String(step)}` };
          const { extracted, atrHash } = req.input as {
            extracted?: unknown;
            atrHash?: string | undefined;
          };
          // `atrHash` is handed over as-is. The step is TOTAL over untyped input and already rules on a
          // non-string fingerprint (`no-record-fingerprint`); re-checking it here would duplicate that
          // contract in a second place, where the two could later disagree about the same value.
          return {
            output: referencePlacementStep(
              "extracted" in (req.input as object) ? { extracted } : undefined,
              atrHash,
            ),
          };
        }
        case "placement": {
          // Reference placement (P8) — where an lcp: reference rides in a protocol document that never
          // settles. The PROTOCOL id rides the case input, like the verify step name: the runner passes
          // only `c.input`, so an area cannot parameterize its class, and a new placement registers an
          // area by landing in `@integraledger/lcp-placements` rather than by touching this dispatch arm.
          const { protocol, op, ref, termsUrl, doc } = req.input as {
            protocol?: string;
            op?: string;
            ref?: LegalContextRef;
            termsUrl?: string;
            doc?: unknown;
          };
          // The wire token is checked against the CLOSED protocol set before the registry sees it, so an
          // arbitrary string is classified rather than merely missed. Both misses answer the same port error:
          // a token that is not a protocol id and a protocol id with no placement are equally undispatchable,
          // and neither is a refusal — a refusal would mean some placement ruled on the document.
          const adapter = isKnownProtocolId(protocol)
            ? placementFor(protocol, SUBJECT_DEPLOYMENT)
            : undefined;
          if (adapter === undefined)
            return { error: `unknown-placement-protocol:${String(protocol)}` };
          if (op === "extract")
            return { output: normalizeRefusal(adapter.extract(doc)) };
          if (ref === undefined) return { error: "placement/missing-ref" };
          // The vector states the advertisement flat (`ref` + optional `termsUrl`) so a foreign subject
          // reads two JSON members rather than one nested object; the adapter contract takes them as one.
          const ad =
            termsUrl === undefined ? { ref } : ({ ref, termsUrl } as const);
          if (op === "place")
            return { output: normalizeRefusal(adapter.place(ad, doc)) };
          if (op === "place-purity") {
            // Purity is a property of the CALL, not of its result, so it cannot be expressed as an
            // expected output the way every other case is. The subject re-serializes the document either
            // side of `place` and answers the question the vector actually asks: did the input survive?
            const before = JSON.stringify(doc);
            adapter.place(ad, doc);
            return { output: JSON.stringify(doc) === before };
          }
          if (op === "roundtrip") {
            // The composition certification the corpus lacked, and the shape of the defect that proved it
            // was missing: every place case certified the write, every extract case the read, and no case
            // fed one to the other — so a writer and a reader could each pass while the written document
            // was unreadable (integra-protocol#8). place then extract, ONE outcome out: a refusal from
            // either half is the answer, because a challenge that cannot be written has nothing to read
            // and a written challenge that cannot be read is precisely the defect.
            const placed = adapter.place(ad, doc);
            if ("refused" in placed)
              return { output: normalizeRefusal(placed) };
            return { output: normalizeRefusal(adapter.extract(placed.value)) };
          }
          return { error: `unknown-placement-op:${String(op)}` };
        }
        case "capability": {
          // LCP §4.5 capability declaration (discovery) — what an agent REQUIRES of a counterparty, in the
          // two host shapes that carry it. The OP rides the case input, like the placement protocol id and
          // the verify step name: the runner passes only `c.input`, so an area cannot parameterize its class.
          //
          // Every arm is deliberately untyped at this door. The emitters' TypeScript signatures forbid a
          // malformed declaration at a typed call site, so their refusal arms are reachable only from a
          // foreign subject — which is precisely the door this corpus exists to certify. The casts hand the
          // raw vector value to the validator rather than pre-narrowing it.
          const { op, declaration, options, doc } = req.input as {
            op?: string;
            declaration?: unknown;
            options?: unknown;
            doc?: unknown;
          };
          if (op === "emit-a2a")
            return {
              output: emitAgentCardExtension(
                declaration as LcpCapabilityDeclaration,
                options as AgentCardExtensionOptions | undefined,
              ),
            };
          if (op === "emit-ucp")
            return {
              output: emitUcpCapability(
                declaration as LcpCapabilityDeclaration,
              ),
            };
          if (op === "read-a2a") return { output: readAgentCard(doc) };
          if (op === "read-ucp") return { output: readUcpProfile(doc) };
          return { error: `unknown-capability-op:${String(op)}` };
        }
        case "recourse": {
          // RCS-1/2/4 (verify) — the elections read from the hashed record + the retained package's roles.
          const { atr, evidenceRoles } = req.input as {
            atr?: { encoding: string; data: unknown };
            evidenceRoles?: string[];
          };
          return {
            output: recourseStep(
              atr === undefined ? undefined : decodeInput(atr),
              evidenceRoles,
            ),
          };
        }
        default:
          return { error: `unknown-class:${req.class}` };
      }
    } catch (e) {
      // Surface the typed error CODE (what the vectors assert), duck-typed so the kernel keeps its surface.
      return {
        error:
          (e as { code?: string }).code ??
          (e instanceof Error ? e.message : String(e)),
      };
    }
  }
}
