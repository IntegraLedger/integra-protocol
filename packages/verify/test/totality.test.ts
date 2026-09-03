/**
 * The walk must be TOTAL over a malformed record, not merely over an absent one.
 *
 * Several steps guarded with `=== undefined` and then dereferenced. That covers the typed caller, who cannot
 * express the malformed case at all, but not the caller these steps exist to survive: a foreign conformance
 * subject, an unvalidated intake, a hand-written fixture — where a slot is present and explicitly `null`.
 * `typeof null === "object"` makes this worse than it looks, because a `typeof x !== "object"` guard waves
 * `null` straight through to the dereference.
 *
 * A walk that throws on a malformed record cannot report the malformation, which is the one job it has. Every
 * case here must read out as `not-attempted` — a gap, never a `failed`, because a caller's shape error is not
 * the record contradicting itself.
 *
 * The casts are the point: they reproduce exactly what an untyped caller hands in.
 *
 * SCOPE: null/undefined totality only. The ATA-3 delegation gates this file once also covered now live in
 * `vectors/{authority/link-attenuates,verify/authority-walk}.json`, where they are checked cross-party
 * against both the producer and the verifier — a second hand-written copy here would only invite drift.
 */
import { describe, expect, it } from "vitest";
import { type RecordIdentity, verify } from "../src/index.js";
import {
  type AuthorityLink,
  authorityStep,
  commitmentStep,
  recourseStep,
  resolvePartyStep,
  settlementStep,
} from "../src/steps.js";

const nul = null as never;

/**
 * `authorityStep` reads both bounds slots into `isWithin`, which walks them with `Object.keys` — so an
 * absent, null, non-object or ARRAY slot throws out of a module whose contract is totality. Each case below
 * isolates one term of the shape guard, because only an input that distinguishes a term proves the term is
 * load-bearing: a guard written on `typeof` alone admits `null`, and one written on `typeof` plus a null
 * check admits `[]` — where `Object.keys([])` answers `[]` rather than throwing, so an array would read as
 * a bounds with NO dimensions, i.e. unbounded, and the forged-widening check would answer on nonsense.
 *
 * Both ARGUMENT positions appear for the same reason. The call site is `!shaped(bounds) || !shaped(parent)`,
 * and a case that corrupts only one side is what proves the disjunction is a disjunction.
 *
 * Cross-checked against the corpus at `vectors/verify/authority-walk.json`, which pins the same four shapes
 * cross-implementation; these are the in-package half.
 */
describe("authorityStep is total over an unwalkable bounds slot", () => {
  const gap = {
    status: "not-attempted",
    depth: "malformed-authority-chain",
  } as const;
  const link = (over: Record<string, unknown>) =>
    [{ parentDelegable: true, ...over }] as unknown as AuthorityLink[];

  it("reads out when bounds is absent", () => {
    expect(authorityStep(link({ parentBounds: {} }))).toEqual(gap);
  });

  it("reads out when parentBounds is absent — the other side of the disjunction", () => {
    expect(authorityStep(link({ bounds: {} }))).toEqual(gap);
  });

  it("reads out when bounds is null", () => {
    expect(authorityStep(link({ bounds: null, parentBounds: {} }))).toEqual(
      gap,
    );
  });

  it("reads out when parentBounds is null", () => {
    expect(authorityStep(link({ bounds: {}, parentBounds: null }))).toEqual(
      gap,
    );
  });

  it('reads out when bounds is a non-object — Object.keys("") does not throw, so this would answer on nonsense', () => {
    expect(
      authorityStep(link({ bounds: "unbounded", parentBounds: {} })),
    ).toEqual(gap);
  });

  it('reads out when bounds is an ARRAY — typeof [] === "object" and [] !== null', () => {
    expect(authorityStep(link({ bounds: [], parentBounds: {} }))).toEqual(gap);
  });

  it("reads out when parentBounds is an ARRAY", () => {
    expect(authorityStep(link({ bounds: {}, parentBounds: [] }))).toEqual(gap);
  });
});

describe("steps are total over an explicit null, not only over undefined", () => {
  it("settlementStep reads out on a null settlements slot", () => {
    expect(settlementStep(nul)).toEqual({
      status: "not-attempted",
      depth: "no-enumeration-port",
    });
  });

  it("authorityStep reads out on a null chain", () => {
    expect(authorityStep(nul)).toEqual({
      status: "not-attempted",
      depth: "no-authority-chain",
    });
  });

  it("commitmentStep reads out on a null commitment slot", () => {
    expect(commitmentStep(nul)).toEqual({
      status: "not-attempted",
      depth: "no-commitment",
    });
  });

  it("recourseStep reads out on a null recourse block", () => {
    // `typeof null === "object"` slips past a `typeof !== "object"` guard, then `.forum` throws.
    const bytes = new TextEncoder().encode(
      JSON.stringify({ atrVersion: "0.3", recourse: null }),
    );
    expect(recourseStep(bytes, undefined)).toEqual({
      status: "not-attempted",
      depth: "no-elections-recorded",
    });
  });

  it("resolvePartyStep reads out on a null identity", () => {
    expect(resolvePartyStep(nul)).toEqual({
      status: "not-attempted",
      depth: "no-identity",
    });
  });

  it("resolvePartyStep reads out when ONE party is null", () => {
    const half = {
      seller: {
        subject: "s",
        assurance: "attested",
        chain: [{ via: "grant" }],
      },
      buyer: null,
    };
    expect(resolvePartyStep(half as unknown as RecordIdentity)).toEqual({
      status: "not-attempted",
      depth: "no-resolution",
    });
  });

  /**
   * IDN-1/IDN-3 are statements of WHO and HOW. Presence is not the claim — the VALUE is — so a party
   * resolved to "" names nobody and a chain entry with a blank `via` records no method. Both used to
   * report `proved`, because the step read the chain array's LENGTH and never its contents: `[{}]` is a
   * non-empty array of nothing. A record could therefore carry a full attribution rung while stating
   * neither party nor method, which is the shape of a resolution without the substance.
   */
  describe("resolve-party refuses an identity that states nothing", () => {
    const party = (over: Record<string, unknown>) => ({
      subject: "s",
      assurance: "attested",
      chain: [{ via: "grant" }],
      ...over,
    });
    const idn = (over: Record<string, unknown>) =>
      ({ seller: party(over), buyer: party({}) }) as unknown as RecordIdentity;

    it("proves a well-formed identity (the control)", () => {
      expect(resolvePartyStep(idn({}))).toEqual({ status: "proved" });
    });

    it("refuses a party resolved to the empty string", () => {
      expect(resolvePartyStep(idn({ subject: "" }))).toEqual({
        status: "not-attempted",
        depth: "no-subject",
      });
    });

    it("refuses a subject that is only whitespace — blank is not a name", () => {
      expect(resolvePartyStep(idn({ subject: "   " }))).toEqual({
        status: "not-attempted",
        depth: "no-subject",
      });
    });

    it("refuses an EMPTY chain entry — length is not evidence", () => {
      expect(resolvePartyStep(idn({ chain: [{}] }))).toEqual({
        status: "not-attempted",
        depth: "no-resolution-method",
      });
    });

    it("refuses a chain entry whose method is blank", () => {
      expect(resolvePartyStep(idn({ chain: [{ via: "" }] }))).toEqual({
        status: "not-attempted",
        depth: "no-resolution-method",
      });
    });

    it("refuses when ANY entry is blank, not merely the first", () => {
      // A chain is a sequence of resolutions; one link that records nothing breaks the sequence.
      expect(
        resolvePartyStep(idn({ chain: [{ via: "key" }, { via: "" }] })),
      ).toEqual({ status: "not-attempted", depth: "no-resolution-method" });
    });

    it("refuses a null chain entry without throwing — the step stays total", () => {
      expect(resolvePartyStep(idn({ chain: [null] }))).toEqual({
        status: "not-attempted",
        depth: "no-resolution-method",
      });
    });

    it("refuses a party stating NO assurance level — presence is not statement", () => {
      expect(resolvePartyStep(idn({ assurance: undefined }))).toEqual({
        status: "not-attempted",
        depth: "no-assurance-stated",
      });
    });

    it("refuses an assurance of only whitespace — blank states no level", () => {
      expect(resolvePartyStep(idn({ assurance: "  " }))).toEqual({
        status: "not-attempted",
        depth: "no-assurance-stated",
      });
    });

    it("reads the assurance gate on the BUYER too", () => {
      const buyerUnstated = {
        seller: party({}),
        buyer: party({ assurance: "" }),
      } as unknown as RecordIdentity;
      expect(resolvePartyStep(buyerUnstated)).toEqual({
        status: "not-attempted",
        depth: "no-assurance-stated",
      });
    });

    it("applies to the BUYER as well as the seller", () => {
      const buyerBlank = {
        seller: party({}),
        buyer: party({ subject: "" }),
      } as unknown as RecordIdentity;
      expect(resolvePartyStep(buyerBlank)).toEqual({
        status: "not-attempted",
        depth: "no-subject",
      });
    });
  });

  it("verify() survives a null party end-to-end — the whole walk, not just the step", async () => {
    // `resolvePartyStep` runs early in the step table, so a crash here pre-empts every later readout,
    // including the report's own `assurance` field. The optional-chain fix on that field is worthless if
    // the walk never reaches it.
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      identity: {
        seller: {
          subject: "s",
          assurance: "attested",
          chain: [{ via: "grant" }],
        },
        buyer: null,
      } as unknown as RecordIdentity,
    });
    const statuses = Object.fromEntries(
      report.steps.map((s) => [s.name, s.outcome.status]),
    );
    expect(statuses["resolve-party"]).toBe("not-attempted");
    expect(report.verified).toBe(false);
    // A null buyer states no level, so the report must not elect one for it.
    expect(report.assurance).toBe("no-assurance-stated");
  });

  it("reports no-assurance-stated when the identity slot is absent entirely — never a ladder value", async () => {
    // The report used to answer `wallet-signature-only` here: conservative in direction, but still a
    // stated level for a record that stated nothing, and the floor of a ladder reads as a finding rather
    // than as silence. It also contradicted `resolve-party`, which refuses the same condition in the same
    // run — the step said "no assurance stated" while the report header named a level.
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
    });
    expect(report.assurance).toBe("no-assurance-stated");
    const resolveParty = report.steps.find((s) => s.name === "resolve-party");
    expect(resolveParty?.outcome.status).toBe("not-attempted");
  });

  it("a STATED level is still read out verbatim — the fallback never overwrites a statement", async () => {
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      identity: {
        seller: {
          subject: "s",
          assurance: "attested",
          chain: [{ via: "grant" }],
        },
        buyer: {
          subject: "b",
          assurance: "wallet-signature-only",
          chain: [{ via: "key" }],
        },
      },
    });
    expect(report.assurance).toBe("wallet-signature-only");
  });

  // ── The shape guards specifically. Every
  // `typeof x !== "object"` half below surviving: the null cases above reach the `present` half and stop,
  // so the second half was never the reason anything returned. A guard no test can distinguish from its
  // absence is not a guard.

  it("authorityStep refuses a PRIMITIVE element in the chain, not just a null one", () => {
    expect(authorityStep(["nope"] as unknown as AuthorityLink[])).toEqual({
      status: "not-attempted",
      depth: "malformed-authority-chain",
    });
  });

  it("authorityStep refuses a non-array in the chain slot", () => {
    expect(authorityStep(42 as unknown as AuthorityLink[])).toEqual({
      status: "not-attempted",
      depth: "no-authority-chain",
    });
  });

  // The revocation and liveness arms. The corpus pins these too, but the corpus is driven by the
  // conformance package and this suite is what the mutation ratchet measures — pinning them only there
  // left every guard below killable without a test noticing, which is how the ratchet caught them.
  describe("authorityStep — the revocation and liveness slots", () => {
    const link = (extra: Record<string, unknown>) =>
      [
        {
          bounds: { caps: { USD: "100" } },
          parentBounds: { caps: { USD: "1000" } },
          parentDelegable: true,
          ...extra,
        },
      ] as unknown as AuthorityLink[];

    it("an absent `revoked` is a gap under its own name, never a pass", () => {
      expect(authorityStep(link({ active: true }))).toEqual({
        status: "not-attempted",
        depth: "no-revocation-stated",
      });
    });

    it("an absent `active` is a gap under ITS own name — the two slots are distinct rungs", () => {
      // A single shared token would make the report say "something about revocation" for an expiry gap.
      expect(authorityStep(link({ revoked: false }))).toEqual({
        status: "not-attempted",
        depth: "no-liveness-stated",
      });
    });

    it.each([
      ["revoked", { revoked: "false", active: true }],
      ["active", { revoked: false, active: 1 }],
    ])(
      "a non-boolean `%s` is the caller's shape error, not the record's contradiction",
      (_slot, extra) => {
        // `malformed-authority-chain`, matching how the depth gate reads a non-finite number: a caller's
        // type corruption says nothing about whether the RECORD contradicts itself, and answering `failed`
        // would impeach it to TC-0 over someone else's mistake.
        expect(authorityStep(link(extra))).toEqual({
          status: "not-attempted",
          depth: "malformed-authority-chain",
        });
      },
    );

    it("a stated, unrevoked, live link still proves — the gates are not simply always-refuse", () => {
      expect(authorityStep(link({ revoked: false, active: true }))).toEqual({
        status: "proved",
      });
    });

    it("`revoked: true` and `active: false` still FAIL — a contradiction is not a gap", () => {
      expect(authorityStep(link({ revoked: true, active: true }))).toEqual({
        status: "failed",
        haltClass: "verification-failure",
      });
      expect(authorityStep(link({ revoked: false, active: false }))).toEqual({
        status: "failed",
        haltClass: "verification-failure",
      });
    });
  });

  /**
   * ATA-3 gate one, the THIRD boolean on a link and the one that had no type screen. `revoked` and
   * `active` are both `typeof`-checked above; `authority.walkableGrant` refuses a non-boolean `delegable`
   * on the producing side. This slot was read for truthiness alone, so every non-boolean but `0` and `""`
   * cleared the rung that asks whether the parent was permitted to delegate at all — the string `"false"`,
   * the string `"0"`, an empty array and an empty object each PROVED it.
   *
   * ABSENCE is where this slot parts company with its two siblings, and deliberately: an unstated
   * delegability is ATA-3's restrictive default (non-delegable ⇒ `failed`, the ruling
   * `authority.linkAttenuates` makes at issuance), not a gap with a name of its own. Both halves are
   * asserted, because a screen written as "non-boolean ⇒ malformed" without the `present` guard would
   * silently convert that ruling into a gap.
   */
  describe("authorityStep — the delegability slot", () => {
    const link = (over: Record<string, unknown>) =>
      [
        {
          bounds: { caps: { USD: "100" } },
          parentBounds: { caps: { USD: "1000" } },
          revoked: false,
          active: true,
          ...over,
        },
      ] as unknown as AuthorityLink[];

    it.each([
      ['the string "false"', "false"],
      ['the string "no"', "no"],
      ['the string "0"', "0"],
      ["an empty array", []],
      ["an empty object", {}],
      ["the number 1", 1],
      ['the string "true"', "true"],
    ])(
      "a parentDelegable of %s is the caller's shape error, never a proof",
      (_label, value) => {
        expect(authorityStep(link({ parentDelegable: value }))).toEqual({
          status: "not-attempted",
          depth: "malformed-authority-chain",
        });
      },
    );

    it("an ABSENT parentDelegable still FAILS — the restrictive default is a ruling, not a gap", () => {
      expect(authorityStep(link({}))).toEqual({
        status: "failed",
        haltClass: "verification-failure",
      });
    });

    it("a null parentDelegable reads as absent, for the same reason a null `revoked` does", () => {
      expect(authorityStep(link({ parentDelegable: null }))).toEqual({
        status: "failed",
        haltClass: "verification-failure",
      });
    });

    it("`false` still FAILS and `true` still proves — the screen is not simply always-refuse", () => {
      expect(authorityStep(link({ parentDelegable: false }))).toEqual({
        status: "failed",
        haltClass: "verification-failure",
      });
      expect(authorityStep(link({ parentDelegable: true }))).toEqual({
        status: "proved",
      });
    });
  });

  /**
   * `settlementStep` proves the TC-1 payment rung, and it read `.length` on whatever the slot held.
   * `.length` is `undefined` on an object, a number and a boolean, `undefined === 0` is false, so every
   * one of them fell through to `proved` — a settlement rung cleared with ZERO settlements enumerated,
   * which is the module's own capitalised rule ("ABSENT INPUTS NEVER PROVE") read backwards.
   * `{ length: 5 }` is the sharpest case: a duck-typed object that answers the only question the step
   * asked. `authorityStep` added exactly this `Array.isArray` screen for exactly this reason.
   *
   * The slot's own token is `no-enumeration-port` — the caller supplied no readable enumeration — which is
   * the same token an absent slot gets, and distinct from `no-settlement-found`, which says a real port
   * was consulted and answered nothing.
   */
  describe("settlementStep is total over a non-array settlements slot", () => {
    const gap = {
      status: "not-attempted",
      depth: "no-enumeration-port",
    } as const;

    it.each([
      ["an object", {}],
      ["a duck-typed object carrying a length", { length: 5 }],
      ["a number", 42],
      ["the number 0", 0],
      ["a boolean", true],
      ["a string", "abc"],
      ["an empty string", ""],
    ])("reads out on %s rather than proving over it", (_label, value) => {
      expect(settlementStep(value as unknown as unknown[])).toEqual(gap);
    });

    it("a real EMPTY array is still `no-settlement-found` — a consulted port that found nothing", () => {
      expect(settlementStep([])).toEqual({
        status: "not-attempted",
        depth: "no-settlement-found",
      });
    });

    it("a real non-empty array still proves — the screen is not simply always-refuse", () => {
      expect(settlementStep([{ txHash: "0xabc" }])).toEqual({
        status: "proved",
      });
    });

    it("verify() reports the gap end-to-end and never reaches TC-1 on it", async () => {
      const report = await verify({
        asOf: "2026-07-16T00:00:00Z",
        coverage: { ports: [], bindings: [] },
        settlements: { length: 5 } as unknown as unknown[],
      });
      const settlement = report.steps.find(
        (s) => s.name === "settlement-enumeration",
      );
      expect(settlement?.outcome).toEqual(gap);
      expect(report.supportedClass).toBe("TC-0");
    });
  });

  /**
   * ATA-4 containment, and the one place `boundsShaped` was not carried. `commitmentStep` screened its
   * two halves with `typeof !== "object"`, which admits `[]` — and `Object.keys([])` answers `[]`, so
   * `isWithin` reads an array as a bounds with NO dimensions, i.e. unbounded, and skips all four gates.
   * A $50M commitment therefore cleared the rung against a leaf grant that was never readable.
   *
   * `leafBounds: {}` proving is CORRECT and is asserted below as the control: an absent dimension is
   * unbounded by ATA-2's own rule, so `{}` is a leaf that bounds nothing. Only the ARRAY is the defect,
   * which is why the two cases sit beside each other — a screen that refused both would break the rule
   * it is supposed to enforce.
   */
  describe("commitmentStep is total over an ARRAY-shaped bounds half", () => {
    const gap = {
      status: "not-attempted",
      depth: "no-commitment",
    } as const;
    const big = { caps: { USD: "50000000" } };

    it("refuses an array leafBounds — a $50M commitment must not clear an unreadable leaf", () => {
      expect(
        commitmentStep({ commitment: big, leafBounds: [] } as never),
      ).toEqual(gap);
    });

    it("refuses an array commitment — the other side of the disjunction", () => {
      expect(
        commitmentStep({ commitment: [], leafBounds: big } as never),
      ).toEqual(gap);
    });

    it("still PROVES against an empty-object leaf — an absent dimension is unbounded (ATA-2)", () => {
      expect(commitmentStep({ commitment: big, leafBounds: {} })).toEqual({
        status: "proved",
      });
    });

    it("still FAILS a real overrun — the screen has not disengaged the containment gate", () => {
      expect(
        commitmentStep({ commitment: big, leafBounds: { caps: { USD: "1" } } }),
      ).toEqual({ status: "failed", haltClass: "verification-failure" });
    });

    it("matches authorityStep on the same value — one shape rule, two steps", () => {
      // `authorityStep` has always answered `malformed-authority-chain` for an array bounds slot. The two
      // depth tokens differ because the slots do, but the RULING must not: an array is a shape gap on
      // both, never a proof on one and a gap on the other.
      expect(
        authorityStep([
          {
            bounds: {},
            parentBounds: [],
            parentDelegable: true,
            revoked: false,
            active: true,
          },
        ] as unknown as AuthorityLink[]).status,
      ).toBe("not-attempted");
      expect(
        commitmentStep({ commitment: big, leafBounds: [] } as never).status,
      ).toBe("not-attempted");
    });
  });

  it("commitmentStep refuses a primitive commitment half", () => {
    const bad = { commitment: "USD", leafBounds: { caps: { USD: "1" } } };
    expect(commitmentStep(bad as never)).toEqual({
      status: "not-attempted",
      depth: "no-commitment",
    });
  });

  it("commitmentStep refuses a primitive leafBounds half", () => {
    const bad = { commitment: { caps: { USD: "1" } }, leafBounds: 7 };
    expect(commitmentStep(bad as never)).toEqual({
      status: "not-attempted",
      depth: "no-commitment",
    });
  });

  it("commitmentStep refuses a primitive in the slot itself", () => {
    expect(commitmentStep("x" as never)).toEqual({
      status: "not-attempted",
      depth: "no-commitment",
    });
  });

  it("recourseStep refuses a PRIMITIVE recourse block", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ atrVersion: "0.3", recourse: "arbitration" }),
    );
    expect(recourseStep(bytes, undefined)).toEqual({
      status: "not-attempted",
      depth: "no-elections-recorded",
    });
  });

  it("a JSON `null` document is not a kernel-assembled ATR", () => {
    // `typeof null === "object"` again — parseAtr's own null guard, distinct from its array guard.
    const bytes = new TextEncoder().encode("null");
    expect(recourseStep(bytes, undefined)).toEqual({
      status: "not-attempted",
      depth: "atr-not-machine-readable",
    });
  });
});
