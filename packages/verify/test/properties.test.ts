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

/** The closed taxonomy, in ladder order — index comparison IS the "never raises" relation. */
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

  it("never RAISES the claimed class — the walk confirms or impeaches, it does not promote", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInput,
        fc.constantFrom(...LADDER),
        async (input, claimed) => {
          const report = await verify({
            ...(input as unknown as VerifyInput),
            claimedClass: claimed,
          });
          // supportedClass is either the claim (confirmed) or strictly below it (impeached to TC-0).
          // A report that ever outranked its own claim would be the walk flattering the record.
          expect(
            LADDER.indexOf(report.supportedClass as TransactionClass),
          ).toBeLessThanOrEqual(LADDER.indexOf(claimed));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("PINS the pass-through: an out-of-taxonomy claimedClass is echoed, not clamped", async () => {
    // Documented behaviour, recorded here so it is a decision rather than an accident. `VerifyInput`
    // states the taxonomy is closed and that callers validate at the trust boundary, so the walk does not
    // re-check it — and a nonsense class flows into `supportedClass`, producing a report that its own
    // the report schema would reject. Clamping to TC-0 instead would be defensible and is a cross-party semantic
    // change, so it is raised for ratification rather than made here. Note the report declares
    // `supportedClass: string`, not `TransactionClass` — which is why nothing catches this at compile
    // time either; tightening that field is part of the same decision.
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      claimedClass: "NOT-A-CLASS" as unknown as TransactionClass,
    });
    expect(report.supportedClass).toBe("NOT-A-CLASS");
    // The impeachment path still floors it correctly — a failing step wins over the bogus claim.
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
