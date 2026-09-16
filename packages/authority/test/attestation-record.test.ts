import { describe, expect, it } from "vitest";
import {
  ATTESTATION_SUBSTRATE_NOT_CHECKED,
  type ProfiledAttestation,
  recordAttestation,
} from "../src/attestation-profile.js";
import type { Bounds } from "../src/bounds.js";
import {
  type IdentityResolution,
  recordResolutionAttestations,
  terminatesInAccountableParty,
} from "../src/composition.js";
import type { AtaGrant } from "../src/grant.js";
import { walkChainStructure } from "../src/walk.js";

/**
 * A profiled attestation is a FIRST-CLASS INSPECTABLE INPUT to the authority walk, and it is never a
 * refusal and never an opaque blob. Both halves are load-bearing and they fail in opposite directions.
 *
 * ★ THE REFUSAL HALF IS THE ONE THAT LOOKS FINE WHEN IT IS WRONG. A build that keeps a set of substrates
 * it accepts passes every test ever written about the substrates it accepts; the failure only appears when
 * a vendor nobody here has heard of presents an attestation, which is the case no fixture written from the
 * inside contains. So the fixtures below deliberately name a substrate and a profile that exist nowhere —
 * `bureau-of-seals:2031` on `wax-and-ribbon` — and assert the walk carries them through unexamined. A
 * membership test anywhere on this path turns every one of these green tests red, which is the point.
 *
 * ★ THE BLOB HALF IS WHAT MAKES THE RECORD HONEST. `{via: "attestation", ref: "lcp:sha256:…"}` is a hop
 * that says an attestation happened and gives a reader nothing to inspect. A readout that carried the
 * presented value through untyped would be the same defect one layer down: present, unrefused, and
 * useless. The assertions below pin the ENVELOPE — profile, substrate, subject, assurance, ref — and the
 * standing statement beside it that no substrate cryptography was checked here.
 */

const PRINCIPAL = "did:web:acme.example";
const AGENT_DID =
  "did:pkh:eip155:84532:0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const AGENT = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const AS_OF = "2026-07-20T00:00:00Z";
const CAPS: Bounds = { caps: { USDC: "5000" } };

/** An attestation on a substrate and profile no implementation anywhere has ever heard of. */
const STRANGER: ProfiledAttestation = {
  profile: { profile: "bureau-of-seals:2031", substrate: "wax-and-ribbon" },
  subject: AGENT_DID,
  assurance: "seal-of-the-bureau",
  ref: "lcp:sha256:0xfeed",
};

function grant(
  issuer: string,
  subjectId: string,
  bounds: Bounds,
  subjectExtras: { delegable?: boolean; maxDepth?: number } = {},
): AtaGrant {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    issuer,
    credentialSubject: { id: subjectId, bounds, ...subjectExtras },
    proof: {
      type: "DataIntegrityProof",
      verificationMethod: `${issuer}#k`,
      proofPurpose: "assertionMethod",
      proofValue: "z-unchecked-structurally",
    },
  };
}

function directChain(attestations?: Record<string, unknown>) {
  return {
    principal: PRINCIPAL,
    chain: [grant(PRINCIPAL, AGENT_DID, CAPS)],
    acceptanceSigner: AGENT,
    asOf: AS_OF,
    ...(attestations !== undefined ? { attestations } : {}),
  } as Parameters<typeof walkChainStructure>[0];
}

describe("the walk records an attestation it has never heard of, and refuses nothing", () => {
  it("carries the stranger's envelope onto the link readout", async () => {
    const walk = await walkChainStructure(
      directChain({ [AGENT_DID]: [STRANGER] }),
    );
    expect(walk.status).toBe("walked");
    if (walk.status !== "walked") return;
    expect(walk.links[0]?.attestations).toEqual([
      {
        status: "envelope-read",
        envelope: {
          profile: "bureau-of-seals:2031",
          substrate: "wax-and-ribbon",
          subject: AGENT_DID,
          assurance: "seal-of-the-bureau",
          ref: "lcp:sha256:0xfeed",
        },
        substrateCheck: {
          status: "not-attempted",
          depth: ATTESTATION_SUBSTRATE_NOT_CHECKED,
        },
      },
    ]);
  });

  it("states, in the readout itself, that nobody here checked the substrate", async () => {
    // The honest answer is not in a comment and not in the absence of a field: a reader's code asks the
    // value. There is no arm of the type in which this reads anything else.
    const walk = await walkChainStructure(
      directChain({ [AGENT_DID]: [STRANGER] }),
    );
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    const recorded = walk.links[0]?.attestations?.[0];
    if (recorded?.status !== "envelope-read")
      throw new Error("expected an envelope");
    expect(recorded.substrateCheck.status).toBe("not-attempted");
    expect(recorded.substrateCheck.depth).toBe("substrate-not-checked-here");
    // And the artifact is REACHABLE, which is the whole of what this walk contributes: the reader who
    // wants a verdict has the reference to go and get one.
    expect(recorded.envelope.ref).toBe("lcp:sha256:0xfeed");
  });

  it("an attestation cannot rescue a chain the documents contradict", async () => {
    // The mirror of "never refuses": recording is not a second door. A spliced chain is spliced whatever
    // is addressed to its subjects.
    const root = grant(PRINCIPAL, "did:web:org.example", CAPS, {
      delegable: true,
    });
    const spliced = grant("did:web:someone-else.example", AGENT_DID, CAPS);
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [root, spliced],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
      attestations: { [AGENT_DID]: [STRANGER] },
    });
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/spliced-link",
    });
  });
});

describe("addressed, empty and absent are three different facts", () => {
  it("omits the field entirely where the presenter addressed this subject nothing", async () => {
    const walk = await walkChainStructure(directChain());
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect(walk.links[0] && "attestations" in walk.links[0]).toBe(false);
    // And the readout is byte-identical to the one the corpus pins, which is why every existing vector
    // still passes: an absent slot adds no key.
    expect(JSON.parse(JSON.stringify(walk.links[0]))).toEqual({
      bounds: { caps: { USDC: "5000" } },
      parentBounds: {},
      parentDelegable: true,
      active: true,
    });
  });

  it("keeps an addressed-but-empty list as an empty list", async () => {
    const walk = await walkChainStructure(directChain({ [AGENT_DID]: [] }));
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect(walk.links[0]?.attestations).toEqual([]);
  });

  it("records a slot addressed to this subject that is not a list at all", async () => {
    const walk = await walkChainStructure(
      directChain({ [AGENT_DID]: "a seal, honest" }),
    );
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect(walk.links[0]?.attestations).toEqual([
      { status: "not-attempted", depth: "attestations-not-a-list" },
    ]);
  });

  it("reads an attestations slot that is not an object as absent, never as a refusal", async () => {
    const walk = await walkChainStructure(
      directChain(["not keyed to anyone"] as unknown as Record<
        string,
        unknown
      >),
    );
    expect(walk.status).toBe("walked");
    if (walk.status !== "walked") return;
    expect(walk.links[0] && "attestations" in walk.links[0]).toBe(false);
  });
});

describe("the readout shows a disagreement rather than ruling on it", () => {
  it("records an attestation addressed to one subject that declares another", async () => {
    // The presenter addressed this to the agent; the attestation says it vouches for somebody else.
    // Refusing would be this walk adjudicating evidence it has not checked. Recording both puts the
    // contradiction in front of the reader, who is the one who can act on it.
    const elsewhere: ProfiledAttestation = {
      ...STRANGER,
      subject: "did:web:not-the-agent.example",
    };
    const walk = await walkChainStructure(
      directChain({ [AGENT_DID]: [elsewhere] }),
    );
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    const recorded = walk.links[0]?.attestations?.[0];
    if (recorded?.status !== "envelope-read")
      throw new Error("expected an envelope");
    expect(recorded.envelope.subject).toBe("did:web:not-the-agent.example");
  });
});

describe("recordAttestation — total over wire input, and never a refusal", () => {
  it.each([
    ["not an object", 42, "attestation-not-an-object"],
    ["null", null, "attestation-not-an-object"],
    ["an array", [], "attestation-not-an-object"],
    [
      "no profile object",
      { subject: "s", ref: "r" },
      "attestation-profile-not-stated",
    ],
    [
      "a profile naming no profile id",
      { profile: { substrate: "wax-and-ribbon" }, subject: "s", ref: "r" },
      "attestation-profile-not-stated",
    ],
    [
      "a profile naming no substrate",
      { profile: { profile: "p" }, subject: "s", ref: "r" },
      "attestation-substrate-not-stated",
    ],
    [
      "no subject",
      { profile: { profile: "p", substrate: "s" }, ref: "r" },
      "attestation-subject-not-stated",
    ],
    [
      "no ref — nothing a reader could fetch",
      { profile: { profile: "p", substrate: "s" }, subject: "x" },
      "attestation-ref-not-stated",
    ],
    [
      "an assurance nobody can read",
      {
        profile: { profile: "p", substrate: "s" },
        subject: "x",
        ref: "r",
        assurance: { level: 3 },
      },
      "attestation-assurance-unreadable",
    ],
  ])("records %s as a stated gap", (_name, presented, depth) => {
    expect(recordAttestation(presented)).toEqual({
      status: "not-attempted",
      depth,
    });
  });

  it("omits assurance where none was stated, and never invents one", () => {
    const recorded = recordAttestation({
      profile: { profile: "bureau-of-seals:2031", substrate: "wax-and-ribbon" },
      subject: "x",
      ref: "lcp:sha256:0x01",
    });
    if (recorded.status !== "envelope-read")
      throw new Error("expected an envelope");
    expect("assurance" in recorded.envelope).toBe(false);
  });

  it("compares the substrate with nothing — any non-empty string is a substrate", () => {
    // Three substrates, no two alike, none of them known to anything in this repository. All three read
    // back identically. A roster would have to refuse at least two.
    for (const substrate of ["wax-and-ribbon", "carrier-pigeon", "eas"]) {
      const recorded = recordAttestation({
        profile: { profile: "p", substrate },
        subject: "x",
        ref: "lcp:sha256:0x01",
      });
      if (recorded.status !== "envelope-read")
        throw new Error(`refused the substrate ${substrate}`);
      expect(recorded.envelope.substrate).toBe(substrate);
    }
  });
});

describe("a resolution chain's attestation hops are inspectable, and stay substrate-blind", () => {
  const resolution: IdentityResolution = {
    subject: AGENT,
    assurance: "attested",
    chain: [
      { via: "key" },
      { via: "attestation", ref: "lcp:sha256:0xabc" },
      { via: "attestation", ref: "lcp:sha256:0xfeed", attestation: STRANGER },
    ],
  };

  it("reads out one entry per attestation hop, in chain order, and none for other hops", () => {
    const recorded = recordResolutionAttestations(resolution);
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toEqual({
      status: "not-attempted",
      depth: "attestation-hop-carries-no-profile",
    });
    expect(recorded[1]).toMatchObject({
      status: "envelope-read",
      envelope: { substrate: "wax-and-ribbon" },
    });
  });

  it("names the hop that states nothing a reader can fetch", () => {
    // This is the pre-existing opaque blob, made visible rather than repaired: the hop below still counts
    // as an accountable terminus, and now the record says it rests on a reference with no profile.
    const bare: IdentityResolution = {
      subject: AGENT,
      assurance: "attested",
      chain: [{ via: "key" }, { via: "attestation", ref: "lcp:sha256:0xabc" }],
    };
    expect(terminatesInAccountableParty(bare)).toBe(true);
    expect(recordResolutionAttestations(bare)).toEqual([
      { status: "not-attempted", depth: "attestation-hop-carries-no-profile" },
    ]);
  });

  it("an accountable terminus on an unheard-of substrate is still accountable", () => {
    // IDN-2 asks whether the chain reaches more than a key. Which substrate carried it is not that
    // question, and making it that question is the roster failure on the composition side.
    expect(
      terminatesInAccountableParty({
        subject: AGENT,
        assurance: "attested",
        chain: [
          { via: "key" },
          {
            via: "attestation",
            ref: "lcp:sha256:0xfeed",
            attestation: STRANGER,
          },
        ],
      }),
    ).toBe(true);
  });

  it("is total over a resolution carrying no chain", () => {
    expect(
      recordResolutionAttestations({
        subject: AGENT,
        assurance: "attested",
      } as unknown as IdentityResolution),
    ).toEqual([]);
  });

  it("is total over hops that are not objects", () => {
    expect(
      recordResolutionAttestations({
        subject: AGENT,
        assurance: "attested",
        chain: [null, 7, "key"] as unknown as IdentityResolution["chain"],
      }),
    ).toEqual([]);
  });
});
