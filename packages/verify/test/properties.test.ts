/**
 * Properties over the walk, rather than examples of it.
 *
 * Property tests catch a class of defect mechanically that example-based
 * tests do not: an optional field OMITTED (the ATA-3 depth escalation) and an explicit `null` in a slot
 * (the totality gap). Neither had a hand-written case because nobody thought to write the case — which is
 * precisely the argument for generating them.
 *
 * The generators deliberately emit ILL-TYPED values. `verify` is documented as total over an untyped
 * caller — a foreign conformance subject, an unvalidated intake — and Zod lives at the trust boundary,
 * not here. So the casts are the contract under test, not a convenience.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  jcsCanonicalize,
  type TransactionClass,
  type VerifyInput,
  verify,
} from "../src/index.js";
import { type AuthorityLink, authorityStep } from "../src/steps.js";

/** The closed taxonomy, in ladder order. */
const LADDER: readonly TransactionClass[] = [
  "TC-0",
  "TC-1",
  "TC-2",
  "TC-3",
  "TC-4",
];

/** Anything a caller might actually put in a slot, including the shapes a typed caller cannot express. */
const anySlot = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.string(),
  fc.array(fc.anything(), { maxLength: 3 }),
  fc.object({ maxDepth: 2 }),
);

const arbInput = fc.record(
  {
    asOf: fc.oneof(fc.constant("2026-07-16T00:00:00Z"), fc.string()),
    coverage: fc.oneof(fc.constant({ ports: [], bindings: [] }), anySlot),
    settlements: anySlot,
    authorityChain: anySlot,
    commitment: anySlot,
    identity: anySlot,
    evidenceRoles: anySlot,
    acceptance: anySlot,
    // `claimedClass` stays INSIDE the closed taxonomy here, deliberately. `VerifyInput` documents the
    // taxonomy as closed and parks validation at the trust boundary ("Zod there, not here"), so the walk
    // passes an unrecognized class straight through to `supportedClass`. Generating one would assert a
    // guarantee the design does not make — see the pass-through test below, which pins that behaviour
    // rather than quietly asserting the opposite.
    claimedClass: fc.constantFrom(...LADDER),
    depth: fc.oneof(fc.constantFrom("structural", "mechanical"), anySlot),
    composition: anySlot,
  },
  { requiredKeys: ["asOf", "coverage"] },
);

/**
 * Which shape each step needs in its slot before it may prove anything over one, paired with the slot it
 * reads. This is the half the totality property was missing.
 *
 * "Never throws" is only half of totality. A step that survives a malformed slot by PROVING over it has
 * not been made total; it has been made credulous, and the report then states a rung the record never
 * carried — the module's own capitalised rule, "ABSENT INPUTS NEVER PROVE", read backwards. Asserting
 * only that the walk returns a boolean and a class inside the ladder is satisfied by exactly that walk,
 * which is what `settlement-enumeration` was: `.length` on an object is `undefined`, `undefined === 0` is
 * false, and every non-array slot the generator emitted reached `proved` with zero settlements
 * enumerated, 500 runs at a time, for as long as this file has existed.
 */
const READABLE: Record<string, (slot: unknown) => boolean> = {
  // Only a real array is an enumeration. `.length` on anything else is absent or a duck-typed lie.
  "settlement-enumeration": (slot) => Array.isArray(slot) && slot.length > 0,
  // Both halves must be objects `isWithin` can walk — and `Object.keys([])` answers `[]`, so an array
  // reads as a bounds with NO dimensions (unbounded) rather than as a refusal.
  "commitment-vs-leaf": (slot) => {
    if (!shaped(slot)) return false;
    const c = slot as { commitment?: unknown; leafBounds?: unknown };
    return shaped(c.commitment) && shaped(c.leafBounds);
  },
  // A chain is a non-empty array of link objects; anything else is unwalkable.
  "authority-attenuation": (slot) =>
    Array.isArray(slot) &&
    slot.length > 0 &&
    slot.every((l) => typeof l === "object" && l !== null),
  // Both parties must be objects carrying a resolution chain.
  "resolve-party": (slot) => {
    if (!shaped(slot)) return false;
    const i = slot as { seller?: unknown; buyer?: unknown };
    const party = (v: unknown) =>
      shaped(v) && Array.isArray((v as { chain?: unknown }).chain);
    return party(i.seller) && party(i.buyer);
  },
};

/** An object `Object.keys` can walk — not `null`, and not an array. */
function shaped(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Which generated slot each of those steps reads. */
const SLOT_OF: Record<string, string> = {
  "settlement-enumeration": "settlements",
  "commitment-vs-leaf": "commitment",
  "authority-attenuation": "authorityChain",
  "resolve-party": "identity",
};

describe("verify — totality: a malformed record is REPORTED, never thrown on", () => {
  it("never throws, whatever shape the caller supplies", async () => {
    await fc.assert(
      fc.asyncProperty(arbInput, async (input) => {
        // The one job the walk has is to report on the record it was handed. A throw here means a
        // malformed record silently becomes an exception at the callsite instead of an honest readout.
        const report = await verify(input as unknown as VerifyInput);
        expect(typeof report.verified).toBe("boolean");
        expect(LADDER).toContain(report.supportedClass);
      }),
      { numRuns: 500 },
    );
  });

  it("an UNREADABLE slot never PROVES its step — not throwing is only half of totality", async () => {
    // `failed` is deliberately permitted: a slot can be readable and still contradict itself, and this
    // property does not adjudicate that. The one outcome forbidden is `proved` over a shape the step
    // cannot read.
    await fc.assert(
      fc.asyncProperty(arbInput, async (input) => {
        const record = input as unknown as Record<string, unknown>;
        const report = await verify(input as unknown as VerifyInput);
        for (const step of report.steps) {
          const readable = READABLE[step.name];
          const slotName = SLOT_OF[step.name];
          if (readable === undefined || slotName === undefined) continue;
          if (readable(record[slotName])) continue;
          // Reported as a triple so a counterexample names the slot and its value, not just a status.
          expect({
            step: step.name,
            slot: record[slotName],
            status: step.outcome.status,
          }).not.toMatchObject({ status: "proved" });
        }
      }),
      { numRuns: 500 },
    );
  });

  it("the CLAIM cannot move the finding — supportedClass is identical at every claimed class", async () => {
    // The property the previous one asserted — `supportedClass <= claimedClass` — is FALSE by design now,
    // and it passed only because this generator never produced the record that disproves it (one whose
    // proved rungs reach past a low claim; `verify.test.ts` pins that case by hand). A property test that
    // holds because the generator is too weak to falsify it is worse than none: it reads as a guarantee.
    //
    // This is the invariant the walk actually has, and it is the one the defect violated. `supportedClass`
    // is computed from the steps, so running the SAME record against every claim in the ladder must yield
    // one answer. The old implementation returned the claim itself, and would fail this on the first pair.
    await fc.assert(
      fc.asyncProperty(arbInput, async (input) => {
        const answers = await Promise.all(
          LADDER.map(async (claimed) => {
            const report = await verify({
              ...(input as unknown as VerifyInput),
              claimedClass: claimed,
            });
            // And the claim is reported back verbatim, so nothing is lost by not encoding it in the finding.
            expect(report.claimedClass).toBe(claimed);
            return report.supportedClass;
          }),
        );
        expect(new Set(answers).size).toBe(1);
      }),
      { numRuns: 200 },
    );
  });

  it("an out-of-taxonomy claimedClass is echoed as the claim and reaches no finding", async () => {
    // `VerifyInput` states the taxonomy is closed and that callers validate at the trust boundary, so the
    // walk does not re-check it. What matters is where an unchecked value can land: `claimedClass` is the
    // caller's own input and carries it verbatim, while `supportedClass` is computed from the steps and so
    // can only ever hold a real class. A nonsense claim can no longer produce a nonsense finding.
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      claimedClass: "NOT-A-CLASS" as unknown as TransactionClass,
    });
    expect(report.claimedClass).toBe("NOT-A-CLASS");
    expect(report.supportedClass).toBe("TC-0");
    // And the impeachment path still floors it — a failing step wins over anything the caller said.
    const impeached = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      claimedClass: "NOT-A-CLASS" as unknown as TransactionClass,
      authorityChain: [
        {
          bounds: { caps: { USD: "999" } },
          parentBounds: { caps: { USD: "1" } },
          parentDelegable: true,
          revoked: false,
          active: true,
        },
      ],
    });
    expect(impeached.supportedClass).toBe("TC-0");
  });

  it("a structural walk is never `verified` — depth gates the claim, not the evidence", async () => {
    await fc.assert(
      fc.asyncProperty(arbInput, async (input) => {
        const report = await verify({
          ...(input as unknown as VerifyInput),
          depth: "structural",
        });
        expect(report.verified).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe("authorityStep — ATA-3 properties", () => {
  const arbLink = fc.record(
    {
      bounds: fc.constant({ caps: { USD: "100" } }),
      parentBounds: fc.constant({ caps: { USD: "1000" } }),
      parentDelegable: fc.boolean(),
      parentMaxDepth: fc.oneof(fc.constant(undefined), fc.nat({ max: 5 })),
      maxDepth: fc.oneof(fc.constant(undefined), fc.nat({ max: 5 })),
      revoked: fc.oneof(fc.constant(undefined), fc.boolean()),
      active: fc.oneof(fc.constant(undefined), fc.boolean()),
    },
    { requiredKeys: ["bounds", "parentBounds", "parentDelegable"] },
  );

  it("a chain proves ONLY if every gate holds on every link — no link is ever skipped", () => {
    fc.assert(
      fc.property(
        fc.array(arbLink, { minLength: 1, maxLength: 6 }),
        (chain) => {
          const outcome = authorityStep(chain as AuthorityLink[]);
          // STATED and satisfied, not merely un-contradicted. The oracle used to read `revoked !== true`
          // and `active !== false`, which admitted `undefined` — and so asserted the very leniency the
          // step has stopped granting. It is written as a biconditional on `proved` rather than as a
          // simulation of the ladder: a test that re-implements the code it checks agrees with the code's
          // bugs too.
          const everyLinkProves = chain.every(
            (l) =>
              l.parentDelegable === true &&
              l.revoked === false &&
              l.active === true &&
              (l.parentMaxDepth === undefined ||
                (l.parentMaxDepth > 0 &&
                  l.maxDepth !== undefined &&
                  l.maxDepth <= l.parentMaxDepth - 1)),
          );
          // Bounds are held constant and attenuating across the generator, so the delegation gates alone
          // decide — which is exactly the half that had no cross-party coverage before today.
          expect(outcome.status === "proved").toBe(everyLinkProves);
          // And whatever is not proved is one of the two honest non-proofs — never a fourth status, and
          // never a throw. Totality is the module's contract, so the property has to assert it.
          expect(["proved", "failed", "not-attempted"]).toContain(
            outcome.status,
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("appending a link can never turn a failing chain into a proving one", () => {
    fc.assert(
      fc.property(
        fc.array(arbLink, { minLength: 1, maxLength: 4 }),
        arbLink,
        (chain, extra) => {
          if (authorityStep(chain as AuthorityLink[]).status !== "failed")
            return;
          expect(
            authorityStep([...chain, extra] as AuthorityLink[]).status,
          ).toBe("failed");
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is total over an ill-typed chain", () => {
    fc.assert(
      fc.property(fc.array(anySlot, { maxLength: 4 }), (chain) => {
        const outcome = authorityStep(chain as unknown as AuthorityLink[]);
        expect(["proved", "failed", "not-attempted"]).toContain(outcome.status);
      }),
      { numRuns: 300 },
    );
  });
});

describe("jcsCanonicalize — RFC 8785 properties", () => {
  it("is idempotent over a re-parse — canonicalizing twice changes nothing", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const once = jcsCanonicalize(v);
        expect(jcsCanonicalize(JSON.parse(once))).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("is INSENSITIVE to input key order — the whole point of a canonical form", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.jsonValue(), { maxKeys: 8 }),
        (obj) => {
          const shuffled = Object.fromEntries(Object.entries(obj).reverse());
          expect(jcsCanonicalize(shuffled)).toBe(jcsCanonicalize(obj));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("emits keys in UTF-16 code-unit order, integer-like keys included (RFC 8785 §3.2.3)", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.oneof(fc.string(), fc.nat({ max: 200 }).map(String)),
          fc.constant(0),
          { maxKeys: 8 },
        ),
        (obj) => {
          const keys = [
            ...jcsCanonicalize(obj).matchAll(/"((?:[^"\\]|\\.)*)":/g),
          ].map((m) => JSON.parse(`"${m[1]}"`) as string);
          expect(keys).toEqual([...keys].sort());
        },
      ),
      { numRuns: 500 },
    );
  });
});
