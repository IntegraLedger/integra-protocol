// The profile read-status's vectors, the read kit's common cases, run on both acts through every form of
// read-kit/forms/: the shared machinery every pairing's `status` answers with, and each pairing's own read.
import { describe, expect, it } from "vitest";
import type { CaseAnswer, DeclaredForm, ReadCase, ReadKitForm } from "./read-kit/form.js";
import { formModules, loadForms, pairingsWithRead, pairingsWithoutForm, subjectFaults } from "./read-kit/forms.js";
import { ACTS, READ_STATUS, answering, declarationFaults, giving, opening, readKit, runCase } from "./read-kit/harness.js";
import { rowsOf } from "./rows.js";

const loaded = await loadForms();
const FORMS: DeclaredForm[] = loaded.map((l) => l.declared);

for (const declared of FORMS) readKit(declared);

describe("the read kit's forms", () => {
  it("come from every module of read-kit/forms/, the machinery's among them", () => {
    const modules = rowsOf(formModules(), "read-kit/forms/");
    expect([...new Set(loaded.map((l) => l.module))].sort()).toEqual(modules);
    expect(FORMS.filter((f) => f.form.subject === "decide")).toHaveLength(1);
  });

  it("each run one pairing of the registry that has status, and no pairing has two", () => {
    expect(subjectFaults(FORMS)).toEqual([]);
  });

  it("list the pairings with a read that have no form yet", () => {
    const without = pairingsWithoutForm(FORMS);
    const withRead = rowsOf(pairingsWithRead(), "BINDINGS with a read");
    const formed = FORMS.map((f) => f.form.subject).filter((s) => s !== "decide");
    expect([...without, ...formed].sort()).toEqual([...withRead].sort());
    console.log(
      [`read kit: ${without.length} of ${withRead.length} pairings with a read have no form yet`, ...without.map((id) => `  ${id}`)].join(
        "\n",
      ),
    );
  });
});

describe("the read kit's cases", () => {
  it("name the marks in their order, and cover every state and reason of the profile", () => {
    expect(READ_STATUS.marks).toEqual(["included", "safe", "final"]);
    const named = new Set<string>(
      READ_STATUS.cases.flatMap((c) =>
        [c.expect.payment, c.expect.agreement].flatMap((a) => [
          a.state,
          ...("reason" in a ? [a.reason] : []),
          ...a.foreign.map((f) => f.reason),
          ...("carries" in a && a.carries !== undefined ? [a.carries] : []),
        ]),
      ),
    );
    const every = [
      "settled", "pending", "failed", "unreadable",
      "below-mark", "instrument-live", "search-incomplete", "not-found",
      "instrument-unused", "instrument-consumed", "transaction-failed", "before-position",
      "history-gap", "transport", "unparseable", "too-large", "chain-mismatch",
      "payee-signed", "other-signer", "given", "other-kind", "other-account",
    ];
    expect(every.filter((r) => !named.has(r))).toEqual([]);
  });
});

describe("the read kit's failed transactions", () => {
  it("move nothing: the account each names is the destination in what the payer signed (rule 9)", () => {
    const failed = READ_STATUS.cases.flatMap((c) => c.facts.seen.filter((s) => s.result === "failed").map((s) => ({ c: c.case, s })));
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.filter(({ s }) => (s.moved ?? []).length > 0).map(({ c }) => c)).toEqual([]);
  });
});

describe("the read kit's settled cases", () => {
  const settled = READ_STATUS.cases.flatMap((c) =>
    ACTS.flatMap((act) => {
      const want = c.expect[act];
      if (want.state !== "settled") return [];
      const seen = c.facts.seen.find((s) => s.transaction === want.transaction);
      return [{ c, act, want: want.presented, given: seen?.presented }];
    }),
  );

  it("state presented yes and no as the act's facts give it, only in the cases about it, and none elsewhere", () => {
    for (const p of ["yes", "no"] as const) expect(settled.some((s) => s.want === p && s.given === p), p).toBe(true);
    expect(settled.some((s) => s.given === undefined && s.want === undefined), "absent, none").toBe(true);
    expect(settled.filter((s) => s.want !== s.given).map((s) => s.c.case)).toEqual([]);
  });

  it("through the machinery, state presented as the act's facts give it, unshown included, and none where they give none", async () => {
    const decideForm = (FORMS.find((f) => f.form.subject === "decide") as DeclaredForm).form;
    const no = settled.find((s) => s.given === "no") as (typeof settled)[number];
    const unshown: ReadCase = {
      ...no.c,
      facts: { ...no.c.facts, seen: no.c.facts.seen.map((s) => ({ ...s, presented: "unshown" as const })) },
    };
    const runs = [...settled.map((s) => ({ c: s.c, act: s.act })), ...ACTS.map((act) => ({ c: unshown, act }))];
    for (const { c, act } of runs) {
      const arranged = decideForm.arrange(c, act);
      if ("inapplicable" in arranged) throw new Error("the machinery skips no case");
      const answer = await arranged.run();
      const given = c.facts.seen.find((s) => answer.state === "settled" && s.transaction === answer.transaction)?.presented;
      expect("presented" in answer, `${c.case} (act ${act})`).toBe(given !== undefined);
      if (given !== undefined) expect(answer).toMatchObject({ state: "settled", presented: given });
    }
  });
});

describe("the read kit's harness", () => {
  const cases = rowsOf(READ_STATUS.cases, "read-status.json cases");
  const belowMark = cases.find((c) => c.case === "an act found above the final head answers below-mark") as ReadCase;
  const settledZero = cases[0] as ReadCase;
  const skipping: ReadKitForm = { subject: "decide", arrange: () => ({ inapplicable: "the ledger has one mark" }) };
  const decideForm = (FORMS.find((f) => f.form.subject === "decide") as DeclaredForm).form;

  it("fails a case a form skips that its declaration does not state", async () => {
    await expect(runCase({ form: skipping, inapplicable: [] }, belowMark, "payment")).rejects.toThrow(
      /does not state cannot arise/,
    );
    const otherAct = [{ case: belowMark.case, acts: ["agreement" as const], stated: "the profile, one mark" }];
    await expect(runCase({ form: skipping, inapplicable: otherAct }, belowMark, "payment")).rejects.toThrow(
      /does not state cannot arise/,
    );
  });

  it("counts a skip its declaration states as skipped", async () => {
    const stated = [{ case: belowMark.case, stated: "the profile, one mark" }];
    for (const act of ACTS) expect(await runCase({ form: skipping, inapplicable: stated }, belowMark, act)).toBe("skipped");
  });

  it("reports a case its declaration states that the form runs", async () => {
    const stated = [{ case: settledZero.case, stated: "the profile" }];
    expect(await runCase({ form: decideForm, inapplicable: stated }, settledZero, "payment")).toBe("ran-stated");
    expect(await runCase({ form: decideForm, inapplicable: [] }, settledZero, "payment")).toBe("ran");
  });

  it("holds presented only in a case that states it", async () => {
    const stating = cases.find((c) => c.expect.payment.state === "settled" && c.expect.payment.presented === "no") as ReadCase;
    const silent = cases.find((c) => c.case === "a read that made no comparison with the payment presented states no presented, never yes") as ReadCase;
    const answering = (c: ReadCase, presented: "yes" | "no" | undefined): DeclaredForm => ({
      form: {
        subject: "decide",
        arrange: (_c, act) => ({
          run: async () => {
            const { presented: _, ...want } = c.expect[act] as CaseAnswer & { presented?: string };
            return (presented === undefined ? want : { ...want, presented }) as CaseAnswer;
          },
        }),
      },
      inapplicable: [],
    });
    expect(await runCase(answering(silent, "yes"), silent, "payment")).toBe("ran");
    expect(await runCase(answering(stating, "no"), stating, "payment")).toBe("ran");
    await expect(runCase(answering(stating, "yes"), stating, "payment")).rejects.toThrow();
    await expect(runCase(answering(stating, undefined), stating, "payment")).rejects.toThrow();
  });

  it("fails a case whose answer differs from the case's", async () => {
    const wrong: ReadKitForm = {
      subject: "decide",
      arrange: () => ({ run: async () => ({ state: "pending", reason: "not-found", foreign: [] }) }),
    };
    await expect(runCase({ form: wrong, inapplicable: [] }, settledZero, "payment")).rejects.toThrow();
  });

  it("leaves out by a pairing's data a case at another coverage, and the act agreement where the data has none", async () => {
    const none = cases.find((c) => c.coverage === "none") as ReadCase;
    const never: ReadKitForm = { subject: "x402/exact/eip155/eip3009", arrange: () => ({ inapplicable: "" }) };
    expect(await runCase({ form: never, inapplicable: [] }, none, "payment")).toBe("left-out");
    const session: ReadKitForm = { subject: "mpp/session/evm", arrange: () => ({ inapplicable: "" }) };
    expect(await runCase({ form: session, inapplicable: [] }, settledZero, "agreement")).toBe("left-out");
    await expect(runCase({ form: session, inapplicable: [] }, settledZero, "payment")).rejects.toThrow();
  });

  it("finds the faults of a declaration", () => {
    expect(
      declarationFaults([
        { case: "no such case", stated: "x" },
        { case: settledZero.case, stated: "" },
        { case: belowMark.case, stated: "x" },
        { case: belowMark.case, acts: ["payment"], stated: "y" },
      ]),
    ).toEqual([
      `"no such case" is no case of read-status.json`,
      `"${settledZero.case}" is stated with no text`,
      `"${belowMark.case}" is stated twice on the act payment`,
    ]);
  });

  it("states by a reason the cases whose answer carries it, on the acts that do", () => {
    const stated = answering("instrument-consumed", "the profile");
    expect(stated.length).toBeGreaterThan(0);
    for (const d of stated) {
      const c = cases.find((x) => x.case === d.case) as ReadCase;
      for (const act of ACTS) {
        const want = c.expect[act];
        expect(d.acts?.includes(act)).toBe("reason" in want && want.reason === "instrument-consumed");
      }
    }
  });

  it("states by the opening words of its text every case they open, on the acts named, and refuses words that open none", () => {
    const stated = opening("a failed result that", "the profile", ["payment"]);
    expect(stated.map((d) => d.case)).toEqual(cases.filter((c) => c.case.startsWith("a failed result that")).map((c) => c.case));
    expect(stated.length).toBeGreaterThan(1);
    expect(stated.every((d) => d.acts?.join() === "payment")).toBe(true);
    expect(() => opening("no case opens so", "the profile")).toThrow(/no case of read-status.json opens with/);
  });

  it("states by a fact every case whose facts give it: a single-use value, or a validity passed", () => {
    const value = giving("a single-use value", "the profile").map((d) => d.case);
    const lapsed = giving("a validity passed", "the profile").map((d) => d.case);
    expect(value).toEqual(cases.filter((c) => c.facts.value !== undefined).map((c) => c.case));
    expect(lapsed).toEqual(cases.filter((c) => c.facts.value?.lapsed === true).map((c) => c.case));
    expect(lapsed.length).toBeGreaterThan(0);
    expect(lapsed.every((c) => value.includes(c))).toBe(true);
    expect(value.length).toBeGreaterThan(lapsed.length);
  });

  it("finds a form's subject that is no pairing, has no status, or is named twice", () => {
    const f = (subject: string): DeclaredForm => ({ form: { subject: subject as never, arrange: () => ({ inapplicable: "x" }) }, inapplicable: [] });
    expect(subjectFaults([f("decide"), f("decide"), f("x402/no-such"), f("mpp/charge/lightning")])).toEqual([
      "decide has more than one form",
      "x402/no-such is no pairing of the registry",
      "mpp/charge/lightning has no status",
    ]);
  });
});

describe("decide on items the search could not decode", () => {
  const ledger = { coverage: "full" as const, final: 1, markOrder: (a: number, b: number) => a - b, positionOrder: (a: number, b: number) => a - b };

  it("names an item met twice once", async () => {
    const { decide } = await import("../src/internal/read.js");
    const facts = { seen: [], search: { whole: true }, undecoded: [{ transaction: "u1", at: 5 }, { transaction: "u1", at: 5 }], history: true };
    expect(decide(facts, { act: "payment", finality: 1 }, ledger)).toMatchObject({ reason: "search-incomplete", search: 5, undecoded: ["u1"] });
  });

  it("names a given item the read also decoded once, from what it read", async () => {
    const { decide } = await import("../src/internal/read.js");
    const g = { transaction: "g", position: 3, mark: 1, result: "succeeded" as const, consumed: false, carries: true, party: "payer" as const, kind: "same" as const, account: "payee" as const };
    const facts = { seen: [g], search: { whole: true }, undecoded: [{ transaction: "g", at: 3 }], history: true };
    const answer = decide(facts, { act: "payment", finality: 1, others: [{ transaction: "g" }] }, ledger);
    expect(answer.foreign).toEqual([{ transaction: "g", position: 3, reason: "given" }]);
  });
});

describe("decide on a query it cannot read", () => {
  it("answers unreadable, unparseable, for a query that is not an object naming the act", async () => {
    const { decide } = await import("../src/internal/read.js");
    const ledger = { coverage: "full" as const, final: 1, markOrder: (a: number, b: number) => a - b, positionOrder: (a: number, b: number) => a - b };
    const facts = { seen: [], search: { whole: true }, history: true };
    for (const q of [null, 5, {}, { act: "charge", finality: 1 }]) {
      expect(decide(facts, q as never, ledger)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
    }
  });
});

describe("decide on a foreign item", () => {
  it("names it with its signer, the authority the read records for it, and what it moved", async () => {
    const { decide } = await import("../src/internal/read.js");
    const ledger = { coverage: "full" as const, final: 1, markOrder: (a: number, b: number) => a - b, positionOrder: (a: number, b: number) => a - b };
    const moved = [{ asset: "A", amount: "1", to: "other", transaction: "f", place: 0 }];
    const f = { transaction: "f", position: 3, mark: 1, result: "succeeded" as const, consumed: false, carries: true, party: "other" as const, kind: "same" as const, account: "other" as const, signer: "s", authority: "lsig", moved };
    const facts = { seen: [f], search: { whole: true }, history: true };
    const answer = decide(facts, { act: "payment", finality: 1 }, ledger);
    expect(answer.foreign).toEqual([{ transaction: "f", position: 3, signer: "s", authority: "lsig", moved, reason: "other-signer" }]);
  });
});
