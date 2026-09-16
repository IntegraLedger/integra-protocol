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
/** {@link STRANGER} as the walk records it — the envelope half, stated by the presenter. */
const STRANGER_ENVELOPE = {
  profile: "bureau-of-seals:2031",
  substrate: "wax-and-ribbon",
  subject: AGENT_DID,
  assurance: "seal-of-the-bureau",
  ref: "lcp:sha256:0xfeed",
};
/** The standing statement beside every envelope: nobody here checked the substrate. */
const NOT_CHECKED = {
  status: "not-attempted",
  depth: ATTESTATION_SUBSTRATE_NOT_CHECKED,
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

  it("an attestations slot that is not keyed hangs on no link — and is not therefore absent", async () => {
    // It used to read as absent, which made a presented flat list indistinguishable from an empty input.
    const walk = await walkChainStructure(
      directChain([STRANGER] as unknown as Record<string, unknown>),
    );
    expect(walk.status).toBe("walked");
    if (walk.status !== "walked") return;
    expect(walk.links[0] && "attestations" in walk.links[0]).toBe(false);
    expect(walk.unwalkedAttestations).toEqual([
      {
        depth: "attestations-slot-not-keyed",
        recorded: {
          status: "envelope-read",
          envelope: STRANGER_ENVELOPE,
          substrateCheck: NOT_CHECKED,
        },
      },
    ]);
  });
});

/**
 * ⛔⛔ A READOUT QUIETER THAN ITS INPUT IS THE DEFECT THIS ROW EXISTS TO REMOVE, and three presenter
 * inputs used to be exactly that — identical, byte for byte, to a walk that was handed no attestations at
 * all. Each of the three is ordinary wire input and none of them is a reason to refuse anything.
 *
 * ★ THE PRINCIPAL IS THE ONE THAT MATTERS AND THE ONE THAT LOOKS LIKE A MISTAKE. A link is keyed on
 * `credentialSubject.id` — who a grant was issued TO. The principal is the root's `issuer`, the party the
 * chain hangs FROM, whose own authority is synthesized as the root's parent rather than walked. So an
 * attestation about the organisation at the top of the chain — the single most obvious thing a
 * counterparty would present — addressed the one identifier with no readout to land on.
 *
 * ★ Each case below asserts BOTH halves: the entry is present and says what it is, and the result is
 * NOT equal to the same walk with no attestations. The second half is the plant — restore the old
 * behaviour and it is the assertion that goes red, because the first half would still find nothing.
 */
describe("nothing a presenter supplies vanishes from the record", () => {
  /** The same walk, given nothing. Every case below must differ from this. */
  const baseline = async () =>
    JSON.stringify(await walkChainStructure(directChain()));

  it("an attestation about the DECLARED PRINCIPAL is recorded, keyed as such", async () => {
    const aboutPrincipal: ProfiledAttestation = {
      ...STRANGER,
      subject: PRINCIPAL,
    };
    const walk = await walkChainStructure(
      directChain({ [PRINCIPAL]: [aboutPrincipal] }),
    );
    expect(walk.status).toBe("walked");
    if (walk.status !== "walked") return;
    expect(walk.unwalkedAttestations).toEqual([
      {
        depth: "addressed-to-the-declared-principal",
        addressedTo: PRINCIPAL,
        recorded: {
          status: "envelope-read",
          envelope: { ...STRANGER_ENVELOPE, subject: PRINCIPAL },
          substrateCheck: NOT_CHECKED,
        },
      },
    ]);
    expect(JSON.stringify(walk)).not.toBe(await baseline());
  });

  it("an attestation addressed to an identifier the chain never reached is recorded", async () => {
    const walk = await walkChainStructure(
      directChain({ "did:web:nobody.example": [STRANGER] }),
    );
    expect(walk.status).toBe("walked");
    if (walk.status !== "walked") return;
    expect(walk.unwalkedAttestations).toEqual([
      {
        depth: "addressed-to-no-walked-link",
        addressedTo: "did:web:nobody.example",
        recorded: {
          status: "envelope-read",
          envelope: STRANGER_ENVELOPE,
          substrateCheck: NOT_CHECKED,
        },
      },
    ]);
    expect(JSON.stringify(walk)).not.toBe(await baseline());
  });

  it("a flat list is recorded element by element, not as one opaque refusal to read", async () => {
    const walk = await walkChainStructure(
      directChain([STRANGER, 42] as unknown as Record<string, unknown>),
    );
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect(walk.unwalkedAttestations?.map((u) => u.recorded.status)).toEqual([
      "envelope-read",
      "not-attempted",
    ]);
    expect(JSON.stringify(walk)).not.toBe(await baseline());
  });

  it("a scalar slot is a stated gap, read through the same reader", async () => {
    const walk = await walkChainStructure(
      directChain("a seal, honest" as unknown as Record<string, unknown>),
    );
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect(walk.unwalkedAttestations).toEqual([
      {
        depth: "attestations-slot-not-keyed",
        recorded: {
          status: "not-attempted",
          depth: "attestation-not-an-object",
        },
      },
    ]);
    expect(JSON.stringify(walk)).not.toBe(await baseline());
  });

  it("a non-list addressed to an unwalked identifier is a stated gap, not silence", async () => {
    const walk = await walkChainStructure(
      directChain({ "did:web:nobody.example": "a seal" }),
    );
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect(walk.unwalkedAttestations).toEqual([
      {
        depth: "addressed-to-no-walked-link",
        addressedTo: "did:web:nobody.example",
        recorded: {
          status: "not-attempted",
          depth: "attestations-not-a-list",
        },
      },
    ]);
    expect(JSON.stringify(walk)).not.toBe(await baseline());
  });

  it("the leaf's SCHEME-CANONICAL SIGNER is not the leaf's subject, and is not matched as one", async () => {
    // ⛔ The exact-identifier rule, pinned so the behaviour is intended rather than incidental. The leaf
    // subject is `did:pkh:…:0x3c44…` and the acceptance signer is `0x3c44…`; `bindsSigner` binds that pair
    // one gate earlier, and the address match deliberately does NOT reuse the bridge. It is recorded, and
    // `addressedTo` names the form the presenter used.
    const walk = await walkChainStructure(directChain({ [AGENT]: [STRANGER] }));
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect(walk.links[0] && "attestations" in walk.links[0]).toBe(false);
    expect(walk.unwalkedAttestations?.[0]).toMatchObject({
      depth: "addressed-to-no-walked-link",
      addressedTo: AGENT,
    });
  });

  it("omits the field entirely where every presented key found a link", async () => {
    // ⛔ THE COMPATIBILITY HALF. An empty array here would add a key to every readout the conformance
    // corpus compares, and the corpus compares the whole object.
    const walk = await walkChainStructure(
      directChain({ [AGENT_DID]: [STRANGER] }),
    );
    if (walk.status !== "walked") throw new Error("expected a walked chain");
    expect("unwalkedAttestations" in walk).toBe(false);
  });

  it("a HALT carries none of it — the halt is the whole answer", async () => {
    // Stated rather than left to be found: a refused walk has no readout to be quieter than.
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [grant("did:web:someone-else.example", AGENT_DID, CAPS)],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
      attestations: { [PRINCIPAL]: [STRANGER] },
    });
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/root-not-principal",
    });
    expect("unwalkedAttestations" in walk).toBe(false);
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
    // ⛔ `profile: null` REACHES A DIFFERENT ARM FROM `profile` ABSENT, and nothing held it: `typeof null`
    // is "object", so with the null half of the guard mutated away this input dereferences null and
    // THROWS — which would make "never throws" false for an input a presenter can trivially send.
    [
      'a null profile — `typeof null` is "object", so it reaches the guard the absent case never does',
      { profile: null, subject: "s", ref: "r" },
      "attestation-profile-not-stated",
    ],
    // ⛔ THE EMPTY STRING IS PRESENT AND STATES NOTHING, and no case above distinguished it from a value.
    // Four fields, four arms: each is `typeof v === "string"` AND `v.length > 0`, and only the second half
    // of that conjunction refuses these.
    [
      "an empty profile id",
      { profile: { profile: "", substrate: "s" }, subject: "x", ref: "r" },
      "attestation-profile-not-stated",
    ],
    [
      "an empty substrate",
      { profile: { profile: "p", substrate: "" }, subject: "x", ref: "r" },
      "attestation-substrate-not-stated",
    ],
    [
      "an empty subject",
      { profile: { profile: "p", substrate: "s" }, subject: "", ref: "r" },
      "attestation-subject-not-stated",
    ],
    [
      "an empty ref — a handle that fetches nothing",
      { profile: { profile: "p", substrate: "s" }, subject: "x", ref: "" },
      "attestation-ref-not-stated",
    ],
    [
      "an empty assurance — stated, and saying nothing",
      {
        profile: { profile: "p", substrate: "s" },
        subject: "x",
        ref: "r",
        assurance: "",
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
