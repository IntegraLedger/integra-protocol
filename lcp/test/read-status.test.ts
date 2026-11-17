// The profile read-status's vectors, the read kit's common cases, run on both acts through every form of
// read-kit/forms/: the shared machinery every pairing's `status` answers with, and each pairing's own read.
import { describe, expect, it } from "vitest";
import type { DeclaredForm, ReadCase, ReadKitForm } from "./read-kit/form.js";
import { formModules, loadForms, pairingsWithRead, pairingsWithoutForm, subjectFaults } from "./read-kit/forms.js";
import { ACTS, READ_STATUS, answering, declarationFaults, readKit, runCase } from "./read-kit/harness.js";
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

describe("the read kit's settled cases", () => {
  it("state presented yes, no and unshown as the act's facts give it, and none where they give none", () => {
    const settled = READ_STATUS.cases.flatMap((c) =>
      ACTS.flatMap((act) => {
        const want = c.expect[act];
        if (want.state !== "settled") return [];
        const seen = c.facts.seen.find((s) => s.transaction === want.transaction);
        return [{ want: want.presented, given: seen?.presented }];
      }),
    );
    for (const p of ["yes", "no", "unshown"] as const) expect(settled.some((s) => s.want === p && s.given === p), p).toBe(true);
    expect(settled.some((s) => s.given === undefined && s.want === undefined), "absent, none").toBe(true);
    expect(settled.filter((s) => s.want !== s.given)).toEqual([]);
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

  it("finds a form's subject that is no pairing, has no status, or is named twice", () => {
    const f = (subject: string): DeclaredForm => ({ form: { subject: subject as never, arrange: () => ({ inapplicable: "x" }) }, inapplicable: [] });
    expect(subjectFaults([f("decide"), f("decide"), f("x402/no-such"), f("mpp/charge/lightning")])).toEqual([
      "decide has more than one form",
      "x402/no-such is no pairing of the registry",
      "mpp/charge/lightning has no status",
    ]);
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
