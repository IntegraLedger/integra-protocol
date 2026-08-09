import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bounds } from "../src/bounds.js";
import type { AtaGrant } from "../src/grant.js";
import {
  type ChainWalkInput,
  type ChainWalkResult,
  type GrantProofVerifier,
  walkChain,
  walkChainStructure,
} from "../src/walk.js";

/**
 * The corpus vectors, run against the SOURCE. This lives here AND in the conformance corpus
 * deliberately: the corpus certifies the cross-party rule but imports authority's built dist, so a
 * corpus case can never kill a mutant in authority's source. The two are not substitutes.
 */
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/authority/chain-walk.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    input: ChainWalkInput;
    expected: Record<string, unknown>;
  }[];
};

describe("walkChainStructure — the chain-walk vectors, against the source", () => {
  it.each(V.cases)("$name", async ({ input, expected }) => {
    const walk = await walkChainStructure(input);
    const normalized =
      walk.status === "refused"
        ? { status: walk.status, haltClass: walk.haltClass, code: walk.code }
        : walk;
    expect(normalized).toEqual(expected);
    // The vectors deliberately do not pin refusal prose — but a REASONED refusal must state a reason.
    if (walk.status === "refused")
      expect(walk.detail.length).toBeGreaterThan(0);
  });
});

/** A minimal proven grant for source-only cases — the proofValue is opaque to the structural walk. */
function grant(
  issuer: string,
  subjectId: string,
  bounds: Bounds,
  subjectExtras: { delegable?: boolean; maxDepth?: number } = {},
  extras: Partial<AtaGrant> = {},
): AtaGrant {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    issuer,
    credentialSubject: { id: subjectId, bounds, ...subjectExtras },
    ...extras,
    proof: {
      type: "DataIntegrityProof",
      verificationMethod: `${issuer}#k`,
      proofPurpose: "assertionMethod",
      proofValue: "z-unchecked-structurally",
    },
  };
}

const PRINCIPAL = "did:web:acme.example";
const AGENT_DID =
  "did:pkh:eip155:84532:0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const AGENT = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const AS_OF = "2026-07-20T00:00:00Z";

describe("walkChainStructure — source-only pins beyond the vectors", () => {
  it("identifier equality is EXACT — a case-different did:pkh account is a different identifier", async () => {
    // A checksummed subject over a lowercase scheme-canonical signer. Folding case here would corrupt
    // case-sensitive identifiers (base58, URNs) to accommodate one rail; the walk refuses instead.
    const checksummed =
      "did:pkh:eip155:84532:0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [grant(PRINCIPAL, checksummed, { caps: { USDC: "5000" } })],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/leaf-not-signer",
    });
  });

  it("a non-string snapshot value is an unreadable snapshot — a gap, never a crash, never a pass", async () => {
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [
        grant(
          PRINCIPAL,
          AGENT_DID,
          {},
          {},
          {
            credentialStatus: {
              type: "BitstringStatusListEntry",
              statusListCredential: "https://acme.example/status/1",
              statusListIndex: "12",
              statusPurpose: "revocation",
            },
          },
        ),
      ],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
      statusSnapshots: {
        "https://acme.example/status/1": 42 as unknown as string,
      },
    });
    expect(walk).toEqual({
      status: "not-attempted",
      depth: "unreadable-status-snapshot",
    });
  });

  it("a wrong-typed maxDepth is a malformed element — a gap, not arithmetic over a forged string", async () => {
    const forged = grant(
      PRINCIPAL,
      AGENT_DID,
      {},
      {
        maxDepth: "0" as unknown as number,
      },
    );
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [forged],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });
    expect(walk).toEqual({
      status: "not-attempted",
      depth: "malformed-authority-chain",
    });
  });

  it("a NON-FINITE maxDepth is a malformed element — NaN disengages every depth comparison", async () => {
    // `typeof NaN === "number"`, and NaN compares false on BOTH sides of the escalation arithmetic
    // (`NaN <= 0`, `x > NaN - 1`), so a NaN parent depth would let a child state ANY onward depth and
    // walk — then re-prove under authorityStep, which shares the comparison. JSON cannot express NaN,
    // so this can never be a corpus vector: it is reachable only by constructed (SDK) callers.
    for (const maxDepth of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const forged = grant(PRINCIPAL, AGENT_DID, {}, { maxDepth });
      expect(
        await walkChainStructure({
          principal: PRINCIPAL,
          chain: [forged],
          acceptanceSigner: AGENT,
          asOf: AS_OF,
        }),
      ).toEqual({
        status: "not-attempted",
        depth: "malformed-authority-chain",
      });
    }
    // And the attack shape itself: NaN-depth parent, depth-99 child — must be a gap, never walked.
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [
        grant(
          PRINCIPAL,
          "did:example:officer",
          {},
          {
            delegable: true,
            maxDepth: Number.NaN,
          },
        ),
        grant("did:example:officer", AGENT_DID, {}, { maxDepth: 99 }),
      ],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });
    expect(walk).toEqual({
      status: "not-attempted",
      depth: "malformed-authority-chain",
    });
  });

  it("the readout echoes the grant's own bounds object — a readout, not a paraphrase", async () => {
    const bounds: Bounds = { caps: { USDC: "5000" } };
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [grant(PRINCIPAL, AGENT_DID, bounds)],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });
    if (walk.status !== "walked")
      throw new Error(`expected walked, got ${walk.status}`);
    expect(walk.links[0]?.bounds).toBe(bounds);
  });
});

const SUITE = "test:ed25519-json-2026";

/**
 * A NAMED PORT IMPLEMENTATION, not a mock (testing-strategy): a real Ed25519 verifier for the
 * test-local cryptosuite `test:ed25519-json-2026`, whose `proofValue` is base64url(Ed25519 over the
 * UTF-8 JSON of the grant minus `proof`) under the directory's key for `verificationMethod`.
 * Production cryptosuites ship with their producers/rails and are proven there; what THIS proves,
 * with real cryptography, is the walk's port CONTRACT: the proof must cover the grant AS PRESENTED,
 * and an unknown suite or key REJECTS — a routing error, never a silent false verdict, and never a
 * synchronous throw (async port methods reject).
 */
class Ed25519DirectoryProofVerifier implements GrantProofVerifier {
  readonly directory: Map<string, CryptoKey>;
  constructor(directory: Map<string, CryptoKey>) {
    this.directory = directory;
  }
  async verify(presented: AtaGrant): Promise<boolean> {
    const proof = presented.proof;
    if (proof === undefined)
      throw new Error(
        "port consulted for an unproven grant — the walk admits none",
      );
    if (proof.type !== SUITE)
      throw new Error(
        `unknown cryptosuite ${proof.type} — routing error, not a forgery verdict`,
      );
    const key = this.directory.get(proof.verificationMethod);
    if (key === undefined)
      throw new Error(`no key held for ${proof.verificationMethod}`);
    return crypto.subtle.verify(
      "Ed25519",
      key,
      new Uint8Array(Buffer.from(proof.proofValue, "base64url")),
      signableBytes(presented),
    );
  }
}

/** The bytes the suite signs and verifies: the presented grant minus its proof, as UTF-8 JSON. */
function signableBytes(presented: AtaGrant): Uint8Array<ArrayBuffer> {
  const { proof: _proof, ...unsigned } = presented;
  return new TextEncoder().encode(JSON.stringify(unsigned));
}

interface Actor {
  id: string;
  vm: string;
  keys: CryptoKeyPair;
}

async function makeActor(id: string): Promise<Actor> {
  const keys = (await crypto.subtle.generateKey("Ed25519", false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return { id, vm: `${id}#k`, keys };
}

async function sign(
  unsigned: Omit<AtaGrant, "proof">,
  by: Actor,
): Promise<AtaGrant> {
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      by.keys.privateKey,
      new TextEncoder().encode(JSON.stringify(unsigned)),
    ),
  );
  return {
    ...unsigned,
    proof: {
      type: SUITE,
      verificationMethod: by.vm,
      proofPurpose: "assertionMethod",
      proofValue: Buffer.from(signature).toString("base64url"),
    },
  };
}

/** Principal→officer→agent with real Ed25519 proofs, plus the directory that verifies them. */
async function realChain(): Promise<{
  input: ChainWalkInput;
  port: Ed25519DirectoryProofVerifier;
}> {
  const acme = await makeActor("did:web:acme.example");
  const officer = await makeActor("did:example:officer");
  const root = await sign(
    {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential", "AtaGrant"],
      issuer: acme.id,
      credentialSubject: {
        id: officer.id,
        bounds: { caps: { USDC: "5000000" } },
        delegable: true,
        maxDepth: 1,
      },
    },
    acme,
  );
  const link = await sign(
    {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential", "AtaDelegation"],
      issuer: officer.id,
      credentialSubject: {
        id: AGENT_DID,
        bounds: { caps: { USDC: "1000000" } },
        delegable: false,
        maxDepth: 0,
      },
    },
    officer,
  );
  return {
    input: {
      principal: acme.id,
      chain: [root, link],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    },
    port: new Ed25519DirectoryProofVerifier(
      new Map([
        [acme.vm, acme.keys.publicKey],
        [officer.vm, officer.keys.publicKey],
      ]),
    ),
  };
}

describe("walkChain — the cryptographic proof gate, over the real Ed25519 port", () => {
  it("proves a real two-hop chain end-to-end", async () => {
    const { input, port } = await realChain();
    const walk = await walkChain(input, port);
    if (walk.status !== "walked")
      throw new Error(`expected walked, got ${walk.status}`);
    expect(walk.links).toHaveLength(2);
    expect(walk.links[1]).toMatchObject({
      parentDelegable: true,
      parentMaxDepth: 1,
      maxDepth: 0,
    });
  });

  it("refuses a grant tampered AFTER signing — the proof must cover the grant as presented", async () => {
    const { input, port } = await realChain();
    const signed = input.chain[1] as AtaGrant;
    // NARROWER than signed, so the tamper is structurally invisible — only the proof can catch it.
    const tampered: AtaGrant = {
      ...signed,
      credentialSubject: {
        ...signed.credentialSubject,
        bounds: { caps: { USDC: "1" } },
      },
    };
    const walk = await walkChain(
      { ...input, chain: [input.chain[0] as AtaGrant, tampered] },
      port,
    );
    if (walk.status !== "refused")
      throw new Error(`expected refused, got ${walk.status}`);
    expect(walk.code).toBe("walk/proof-invalid");
    expect(walk.detail).toContain("proof"); // a reasoned refusal states its reason
  });

  it("refuses a proof transplanted from another grant", async () => {
    const { input, port } = await realChain();
    const [root, link] = input.chain as [AtaGrant, AtaGrant];
    const transplanted: AtaGrant = {
      ...link,
      proof: {
        ...(root.proof as NonNullable<AtaGrant["proof"]>),
        verificationMethod: `${link.issuer}#k`,
      },
    };
    const walk = await walkChain(
      { ...input, chain: [root, transplanted] },
      port,
    );
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/proof-invalid",
    });
  });

  it("a structural refusal wins before the port is ever consulted", async () => {
    // The empty directory REJECTS any consultation, so reaching the spliced-link refusal proves order.
    const officer = "did:example:officer";
    const spliced = grant(officer, AGENT_DID, { caps: { USDC: "1" } });
    spliced.proof = {
      ...(spliced.proof as NonNullable<AtaGrant["proof"]>),
      verificationMethod: "did:example:mallory#k",
    };
    const walk = await walkChain(
      {
        principal: PRINCIPAL,
        chain: [
          grant(
            PRINCIPAL,
            officer,
            { caps: { USDC: "5000" } },
            { delegable: true },
          ),
          spliced,
        ],
        acceptanceSigner: AGENT,
        asOf: AS_OF,
      },
      new Ed25519DirectoryProofVerifier(new Map()),
    );
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/spliced-link",
    });
  });

  it("a gap passes through untouched — an unwalkable chain never reaches the port", async () => {
    const walk = await walkChain(
      { principal: PRINCIPAL, chain: [], acceptanceSigner: AGENT, asOf: AS_OF },
      new Ed25519DirectoryProofVerifier(new Map()),
    );
    expect(walk).toEqual({
      status: "not-attempted",
      depth: "empty-authority-chain",
    });
  });

  it("an unknown cryptosuite REJECTS — asynchronously, and the rejection propagates", async () => {
    const { input, port } = await realChain();
    const root = input.chain[0] as AtaGrant;
    const foreign: AtaGrant = {
      ...root,
      proof: {
        ...(root.proof as NonNullable<AtaGrant["proof"]>),
        type: "eddsa-jcs-2022",
      },
    };
    // The port's contract first-hand: no synchronous throw, a rejected promise instead.
    const consulted = port.verify(foreign);
    expect(consulted).toBeInstanceOf(Promise);
    await expect(consulted).rejects.toThrow(/unknown cryptosuite/);
    // And the walk is transparent to it — infrastructure failure is the caller's to see, never a verdict.
    await expect(
      walkChain(
        { ...input, chain: [foreign, input.chain[1] as AtaGrant] },
        port,
      ),
    ).rejects.toThrow(/unknown cryptosuite/);
  });
});

/**
 * Totality, one malformation at a time. Every arm of the shape gates must be reached with a value that
 * would change the OUTCOME were the arm removed — a later guard that happens to catch the same input
 * proves nothing about the arm in front of it. Several of these would CRASH (a null dereference) or
 * silently WALK a malformed grant without their gate; either is exactly what the gap arms exist to
 * prevent, and each is what the corresponding mutant does.
 */
describe("walkChainStructure — totality: every gap arm earns its place", () => {
  const walkOne = (
    element: unknown,
    extras: Partial<ChainWalkInput> = {},
  ): Promise<ChainWalkResult> =>
    walkChainStructure({
      principal: PRINCIPAL,
      chain: [element as AtaGrant],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
      ...extras,
    });
  const MALFORMED = {
    status: "not-attempted",
    depth: "malformed-authority-chain",
  };

  it("a nullish INPUT is a gap, not a crash", async () => {
    expect(await walkChainStructure(null as unknown as ChainWalkInput)).toEqual(
      { status: "not-attempted", depth: "no-authority-chain" },
    );
  });
  it("an EMPTY-STRING principal is no principal — empty is not stated", async () => {
    const g = grant(PRINCIPAL, AGENT_DID, {});
    expect(await walkOne(g, { principal: "" })).toEqual({
      status: "not-attempted",
      depth: "no-principal",
    });
  });
  it("an EMPTY-STRING acceptance signer is no signer", async () => {
    const g = grant(PRINCIPAL, AGENT_DID, {});
    expect(await walkOne(g, { acceptanceSigner: "" })).toEqual({
      status: "not-attempted",
      depth: "no-acceptance-signer",
    });
  });
  it("a null chain element", async () => {
    expect(await walkOne(null)).toEqual(MALFORMED);
  });
  it("a grant with no issuer", async () => {
    const { issuer: _issuer, ...rest } = grant(PRINCIPAL, AGENT_DID, {});
    expect(await walkOne(rest)).toEqual(MALFORMED);
  });
  it("a null credentialSubject", async () => {
    expect(
      await walkOne({
        ...grant(PRINCIPAL, AGENT_DID, {}),
        credentialSubject: null,
      }),
    ).toEqual(MALFORMED);
  });
  it("a subject with no id", async () => {
    const g = grant(PRINCIPAL, AGENT_DID, {});
    const { id: _id, ...subject } = g.credentialSubject;
    expect(await walkOne({ ...g, credentialSubject: subject })).toEqual(
      MALFORMED,
    );
  });
  it("non-object bounds", async () => {
    const g = grant(PRINCIPAL, AGENT_DID, 42 as unknown as Bounds);
    expect(await walkOne(g)).toEqual(MALFORMED);
  });
  it("a non-array jurisdictions dimension", async () => {
    expect(
      await walkOne(
        grant(PRINCIPAL, AGENT_DID, {
          jurisdictions: "US",
        } as unknown as Bounds),
      ),
    ).toEqual(MALFORMED);
  });
  it("a jurisdictions array carrying a non-string", async () => {
    expect(
      await walkOne(
        grant(PRINCIPAL, AGENT_DID, {
          jurisdictions: ["ok", 42],
        } as unknown as Bounds),
      ),
    ).toEqual(MALFORMED);
  });
  it("a non-array disputeMethods dimension", async () => {
    expect(
      await walkOne(
        grant(PRINCIPAL, AGENT_DID, { disputeMethods: 7 } as unknown as Bounds),
      ),
    ).toEqual(MALFORMED);
  });
  it("a non-array forbiddenClauseCategories dimension", async () => {
    expect(
      await walkOne(
        grant(PRINCIPAL, AGENT_DID, {
          forbiddenClauseCategories: {},
        } as unknown as Bounds),
      ),
    ).toEqual(MALFORMED);
  });
  it("non-object caps", async () => {
    expect(
      await walkOne(
        grant(PRINCIPAL, AGENT_DID, { caps: "unbounded" } as unknown as Bounds),
      ),
    ).toEqual(MALFORMED);
  });
  it("a non-string cap value", async () => {
    expect(
      await walkOne(
        grant(PRINCIPAL, AGENT_DID, {
          caps: { USDC: 42 },
        } as unknown as Bounds),
      ),
    ).toEqual(MALFORMED);
  });
  it("a non-boolean delegable", async () => {
    expect(
      await walkOne(
        grant(
          PRINCIPAL,
          AGENT_DID,
          {},
          { delegable: "yes" as unknown as boolean },
        ),
      ),
    ).toEqual(MALFORMED);
  });
  it("a non-string validFrom", async () => {
    expect(
      await walkOne(
        grant(
          PRINCIPAL,
          AGENT_DID,
          {},
          {},
          { validFrom: 123 as unknown as string },
        ),
      ),
    ).toEqual(MALFORMED);
  });
  it("an unparseable validUntil", async () => {
    expect(
      await walkOne(
        grant(PRINCIPAL, AGENT_DID, {}, {}, { validUntil: "garbage" }),
      ),
    ).toEqual(MALFORMED);
  });
  it("a proof with no verificationMethod is an unproven link", async () => {
    const g = grant(PRINCIPAL, AGENT_DID, {});
    const { verificationMethod: _vm, ...proof } = g.proof as NonNullable<
      AtaGrant["proof"]
    >;
    expect(await walkOne({ ...g, proof })).toEqual({
      status: "not-attempted",
      depth: "unproven-link",
    });
  });
  it("a proof with an EMPTY verificationMethod is an unproven link", async () => {
    const g = grant(PRINCIPAL, AGENT_DID, {});
    g.proof = {
      ...(g.proof as NonNullable<AtaGrant["proof"]>),
      verificationMethod: "",
    };
    expect(await walkOne(g)).toEqual({
      status: "not-attempted",
      depth: "unproven-link",
    });
  });
});

const SNAPSHOT = "uH4sIAAAAAAACE2NgoAw0MIyCUTAKhioAAEP5zuYABAAA"; // 1024 bytes, only bit 512 set
const LIST = "https://acme.example/status/1";

describe("walkChainStructure — credentialStatus edges beyond the vectors", () => {
  const statusGrant = (credentialStatus: unknown): AtaGrant =>
    grant(
      PRINCIPAL,
      AGENT_DID,
      {},
      {},
      {
        credentialStatus: credentialStatus as NonNullable<
          AtaGrant["credentialStatus"]
        >,
      },
    );
  const walkStatus = (credentialStatus: unknown): Promise<unknown> =>
    walkChainStructure({
      principal: PRINCIPAL,
      chain: [statusGrant(credentialStatus)],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
      statusSnapshots: { [LIST]: SNAPSHOT },
    });
  const MALFORMED_STATUS = {
    status: "not-attempted",
    depth: "malformed-credential-status",
  };

  it("a null credentialStatus is malformed — a gap, not a crash", async () => {
    expect(await walkStatus(null)).toEqual(MALFORMED_STATUS);
  });
  it("a status entry with no list credential is malformed — never 'no snapshot'", async () => {
    expect(
      await walkStatus({
        type: "BitstringStatusListEntry",
        statusListIndex: "12",
      }),
    ).toEqual(MALFORMED_STATUS);
  });
  it("EACH missing field is independently fatal — every other field being valid does not rescue it", async () => {
    // The shape gate is a disjunction, so any clause could be `&&`-ed to its neighbour without a single
    // one-field-missing case noticing: each such case fails a LATER clause too and still reads malformed.
    // These are the entries where exactly one field is absent and every other is valid.
    const complete = {
      type: "BitstringStatusListEntry",
      statusListCredential: LIST,
      statusListIndex: "12",
      statusPurpose: "revocation",
    };
    const fields = [
      "statusListCredential",
      "statusListIndex",
      "statusPurpose",
    ] as const;
    for (const omit of fields) {
      const { [omit]: _dropped, ...partial } = complete;
      expect(await walkStatus(partial), omit).toEqual(MALFORMED_STATUS);
    }
  });
  it("a NUMBER index is malformed — the spec's index is a string, and coercion is forgery-friendly", async () => {
    expect(
      await walkStatus({
        type: "BitstringStatusListEntry",
        statusListCredential: LIST,
        statusListIndex: 12,
      }),
    ).toEqual(MALFORMED_STATUS);
  });
  it("a partially-numeric index is malformed, whichever end the garbage is on", async () => {
    for (const statusListIndex of ["x12", "12x"]) {
      expect(
        await walkStatus({
          type: "BitstringStatusListEntry",
          statusListCredential: LIST,
          statusListIndex,
        }),
      ).toEqual(MALFORMED_STATUS);
    }
  });
  it("the FIRST index past the snapshot is out of range — the boundary, not just the far beyond", async () => {
    // 1024 bytes hold bits 0..8191; 8192 is the first unknowable index, and `>=` vs `>` is exactly
    // one honest gap versus a crash inside statusBit.
    expect(
      await walkStatus({
        type: "BitstringStatusListEntry",
        statusListCredential: LIST,
        statusListIndex: "8192",
        statusPurpose: "revocation",
      }),
    ).toEqual({ status: "not-attempted", depth: "status-index-out-of-range" });
  });
  it("an index at 2**32 is out of range, not a read of byte 0 — the signed-shift wrap", async () => {
    // `index >> 3` is a 32-bit SIGNED op, so ToInt32(2**32) is 0. Before the range gate this walked,
    // having silently consulted the bit at index 0 instead of the one it was asked about.
    expect(
      await walkStatus({
        type: "BitstringStatusListEntry",
        statusListCredential: LIST,
        statusListIndex: String(2 ** 32),
        statusPurpose: "revocation",
      }),
    ).toEqual({ status: "not-attempted", depth: "status-index-out-of-range" });
  });
  it("an entry with no statusPurpose is malformed — v1.0 requires it and the bit means nothing without it", async () => {
    expect(
      await walkStatus({
        type: "BitstringStatusListEntry",
        statusListCredential: LIST,
        statusListIndex: "12",
      }),
    ).toEqual(MALFORMED_STATUS);
  });
  it("a purpose this walk has no semantics for is its own gap, distinct from malformed", async () => {
    // `suspension` is well-formed and meaningful — just not revocation. Reporting it as malformed would
    // blame the issuer for a shape error it did not make; reading it AS revocation would refuse a chain
    // over a state never checked. Its own depth is the only honest answer.
    for (const statusPurpose of ["suspension", "message"]) {
      expect(
        await walkStatus({
          type: "BitstringStatusListEntry",
          statusListCredential: LIST,
          statusListIndex: "12",
          statusPurpose,
        }),
      ).toEqual({
        status: "not-attempted",
        depth: "unsupported-status-purpose",
      });
    }
  });
});

describe("walkChainStructure — refusal codes name the right gate", () => {
  const officer = "did:example:officer";
  const pair = (
    parentExtras: { delegable?: boolean; maxDepth?: number },
    childBounds: Bounds,
    childExtras: { delegable?: boolean; maxDepth?: number },
  ): Promise<ChainWalkResult> =>
    walkChainStructure({
      principal: PRINCIPAL,
      chain: [
        grant(PRINCIPAL, officer, { caps: { USDC: "5000" } }, parentExtras),
        grant(officer, AGENT_DID, childBounds, childExtras),
      ],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });

  it("a depth-EXHAUSTED parent names depth-escalation, even against a nonsense negative claim", async () => {
    // The forged negative depth is the one claim that slips past the child-side arithmetic — the
    // parent-side `<= 0` gate must catch it, and must LABEL it as the depth defect it is.
    const walk = await pair(
      { delegable: true, maxDepth: 0 },
      { caps: { USDC: "5000" } },
      { maxDepth: -5 },
    );
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/depth-escalation",
    });
  });
  it("a widening under IMPECCABLE depth names widened-bounds — the labels must not blur", async () => {
    // Depth consumes exactly the hop available (1 = 2 - 1, the boundary), so only the bounds gate
    // refused — a diagnosis that re-derives the depth arithmetic wrong mislabels precisely here.
    const walk = await pair(
      { delegable: true, maxDepth: 2 },
      { caps: { USDC: "999999999" } },
      { maxDepth: 1 },
    );
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/widened-bounds",
    });
  });
});

describe("walkChainStructure — the readout, exactly", () => {
  it("a root proof key may carry no fragment — the method IS the key", async () => {
    const g = grant(PRINCIPAL, AGENT_DID, { caps: { USDC: "5" } });
    g.proof = {
      ...(g.proof as NonNullable<AtaGrant["proof"]>),
      verificationMethod: PRINCIPAL,
    };
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [g],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });
    expect(walk.status).toBe("walked");
  });
  it("the did:pkh bridge is did:pkh's alone — a matching suffix under another method is a different key", async () => {
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [grant(PRINCIPAL, `did:example:agents:${AGENT}`, {})],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });
    expect(walk).toMatchObject({
      status: "refused",
      code: "walk/leaf-not-signer",
    });
  });
  it("a single-grant readout is EXACTLY one stated link — no unstated keys riding along", async () => {
    const walk = await walkChainStructure({
      principal: PRINCIPAL,
      chain: [grant(PRINCIPAL, AGENT_DID, { caps: { USDC: "5" } })],
      acceptanceSigner: AGENT,
      asOf: AS_OF,
    });
    if (walk.status !== "walked")
      throw new Error(`expected walked, got ${walk.status}`);
    // toStrictEqual: a `parentMaxDepth: undefined` key is NOT the same readout as an absent one —
    // JSON round-trips differ, and the conformance door compares serialized bytes.
    expect(walk.links).toStrictEqual([
      {
        bounds: { caps: { USDC: "5" } },
        parentBounds: {},
        parentDelegable: true,
        revoked: false,
        active: true,
      },
    ]);
  });
});
