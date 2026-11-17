// The read kit's harness: runs every case of read-status.json, on both acts, through a form. A form skips only the
// cases its pairing's profile states cannot arise on its ledger; a skip it does not state fails, a stated case it runs
// is reported, and each form's count of cases run and skipped is printed.
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { BINDINGS } from "../../src/index.js";
import type { Act, ForeignItem } from "../../src/internal/read.js";
import { rowsOf } from "../rows.js";
import type { CaseAnswer, DeclaredForm, Inapplicable, ReadCase, ReadKitForm } from "./form.js";

/** The cases of read-status.json and their marks, in their order. */
export const READ_STATUS = JSON.parse(
  readFileSync(new URL("../../vectors/read-status.json", import.meta.url), "utf8"),
) as { readonly marks: readonly string[]; readonly cases: readonly ReadCase[] };

export const ACTS: readonly Act[] = ["payment", "agreement"];

function foreignOf(a: CaseAnswer): string[] {
  return a.foreign.map((f: ForeignItem<number>) => `${f.transaction}:${f.reason}`).sort();
}

/**
 * The cases whose expected answer on an act carries `reason`, as the statement that they cannot arise on a ledger
 * where that reason cannot be answered: one entry per case, naming the acts on which the case answers it.
 */
export function answering(reason: string, stated: string): Inapplicable[] {
  return READ_STATUS.cases.flatMap((c) => {
    const acts = ACTS.filter((act) => {
      const want = c.expect[act];
      return "reason" in want && want.reason === reason;
    });
    return acts.length === 0 ? [] : [{ case: c.case, acts, stated }];
  });
}

/**
 * Why a case does not run through a pairing's `status` by the pairing's own data, or undefined where it runs: a case at
 * another coverage than the pairing's, or the act `agreement` on a pairing whose payment cannot be an agreement (its
 * data has no `agreement`). The machinery, `decide`, takes every case.
 */
export function leftOutByData(form: ReadKitForm, c: ReadCase, act: Act): string | undefined {
  if (form.subject === "decide") return undefined;
  const entry = BINDINGS.find((e) => e.id === form.subject);
  if (entry === undefined) throw new Error(`${form.subject}: no pairing of the registry has this id`);
  if (c.coverage !== entry.data.coverage) return `the case is at coverage ${c.coverage}, the pairing at ${entry.data.coverage}`;
  if (act === "agreement" && entry.data.agreement === undefined) return "the pairing's data has no agreement";
  return undefined;
}

/** Whether the declaration states that the case cannot arise on the act. */
function declares(inapplicable: readonly Inapplicable[], c: ReadCase, act: Act): Inapplicable | undefined {
  return inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
}

/** What a case did through a form: ran, ran though its pairing states it cannot arise, was skipped, or was left out by the pairing's data. */
export type Outcome = "ran" | "ran-stated" | "skipped" | "left-out";

/**
 * One case on one act through a form: left out where the pairing's data leaves it out; otherwise arranged, and skipped
 * only where the form states why and the declaration names the case on that act, which fails otherwise; or run, its
 * answer held to the case's expected answer for the act.
 */
export async function runCase(declared: DeclaredForm, c: ReadCase, act: Act): Promise<Outcome> {
  const { form, inapplicable } = declared;
  if (leftOutByData(form, c, act) !== undefined) return "left-out";
  const stated = declares(inapplicable, c, act);
  const arranged = form.arrange(c, act);
  if ("inapplicable" in arranged) {
    expect(arranged.inapplicable.length, "the form's statement of why the case cannot arise").toBeGreaterThan(0);
    expect(stated, `${form.subject} skips "${c.case}" on the act ${act}, which its profile does not state cannot arise`).toBeDefined();
    return "skipped";
  }
  const answer = await arranged.run();
  const want = c.expect[act];
  expect(answer).toMatchObject(want);
  expect(foreignOf(answer)).toEqual(foreignOf(want));
  for (const key of ["transaction", "carries", "search", "undecoded"] as const) {
    expect(key in answer, `${key} in the answer`).toBe(key in want);
  }
  return stated === undefined ? "ran" : "ran-stated";
}

/**
 * The faults of a declaration: a case read-status.json does not hold, an act that is not one, a statement that is
 * empty, or one case and act stated twice.
 */
export function declarationFaults(inapplicable: readonly Inapplicable[]): string[] {
  const names = new Set(READ_STATUS.cases.map((c) => c.case));
  const seen = new Set<string>();
  const faults: string[] = [];
  for (const d of inapplicable) {
    if (!names.has(d.case)) faults.push(`"${d.case}" is no case of read-status.json`);
    if (d.stated.length === 0) faults.push(`"${d.case}" is stated with no text`);
    for (const act of d.acts ?? ACTS) {
      if (!ACTS.includes(act)) faults.push(`"${d.case}" names the act ${String(act)}`);
      const key = `${d.case}\u0000${act}`;
      if (seen.has(key)) faults.push(`"${d.case}" is stated twice on the act ${act}`);
      seen.add(key);
    }
  }
  return faults;
}

/** Registers one test per case and act through the form, a test of its declaration, and the print of its counts. */
export function readKit(declared: DeclaredForm): void {
  const { form, inapplicable } = declared;
  describe(`the read kit's common cases through ${form.subject}`, () => {
    const cases = rowsOf(READ_STATUS.cases, "read-status.json cases");
    const outcomes = new Map<string, Outcome>();
    it("states only cases of read-status.json, each once on each act, with its text", () => {
      expect(declarationFaults(inapplicable)).toEqual([]);
    });
    for (const c of cases) {
      for (const act of ACTS) {
        it(`${c.case} (act ${act}; rules ${c.rules})`, async () => {
          outcomes.set(`${c.case} (act ${act})`, await runCase(declared, c, act));
        });
      }
    }
    afterAll(() => {
      const count = (o: Outcome): number => [...outcomes.values()].filter((v) => v === o).length;
      const ranStated = [...outcomes].filter(([, o]) => o === "ran-stated").map(([k]) => k);
      const lines = [
        `read kit, ${form.subject}: ${count("ran") + count("ran-stated")} cases run, ${count("skipped")} skipped as its profile states, ` +
          `${count("left-out")} left out by its data, ${cases.length * ACTS.length - outcomes.size} failed, of ${cases.length * ACTS.length}`,
        ...ranStated.map((k) => `read kit, ${form.subject}: ran a case its profile states cannot arise: ${k}`),
      ];
      console.log(lines.join("\n"));
    });
  });
}
