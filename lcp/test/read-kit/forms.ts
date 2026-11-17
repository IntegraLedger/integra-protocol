// The read kit's forms: every module of read-kit/forms/ exports `forms`, a list of declared forms, and this module
// gathers them; and the pairings with a read that no form runs the cases through.
import { readdirSync } from "node:fs";
import { BINDINGS, type PairingId } from "../../src/index.js";
import type { DeclaredForm } from "./form.js";

const FOLDER = new URL("./forms/", import.meta.url);

/** The modules of read-kit/forms/, by file name, in name order. */
export function formModules(): string[] {
  return readdirSync(FOLDER)
    .filter((f) => f.endsWith(".ts"))
    .sort();
}

/** Every declared form of every module of read-kit/forms/, with the module it comes from. */
export async function loadForms(): Promise<{ readonly module: string; readonly declared: DeclaredForm }[]> {
  const out: { module: string; declared: DeclaredForm }[] = [];
  for (const module of formModules()) {
    const loaded = (await import(new URL(module, FOLDER).href)) as { forms?: unknown };
    if (!Array.isArray(loaded.forms)) throw new Error(`read-kit/forms/${module} exports no list named forms`);
    for (const declared of loaded.forms as DeclaredForm[]) out.push({ module, declared });
  }
  return out;
}

/** The pairings with a read: those whose codec has `status`, or whose data has a `read`. */
export function pairingsWithRead(): PairingId[] {
  return BINDINGS.filter((e) => ("status" in e && e.status !== undefined) || e.data.read !== undefined).map((e) => e.id);
}

/** The faults of the forms' subjects: a pairing the registry does not hold, one with no `status`, or one named twice. */
export function subjectFaults(forms: readonly DeclaredForm[]): string[] {
  const faults: string[] = [];
  const seen = new Set<string>();
  for (const { form } of forms) {
    if (seen.has(form.subject)) faults.push(`${form.subject} has more than one form`);
    seen.add(form.subject);
    if (form.subject === "decide") continue;
    const entry = BINDINGS.find((e) => e.id === form.subject);
    if (entry === undefined) faults.push(`${form.subject} is no pairing of the registry`);
    else if (!("status" in entry) || entry.status === undefined) faults.push(`${form.subject} has no status`);
  }
  return faults;
}

/** Every pairing with a read that no form runs the read kit's cases through, in the registry's order. */
export function pairingsWithoutForm(forms: readonly DeclaredForm[]): PairingId[] {
  const formed = new Set<string>(forms.map((f) => f.form.subject));
  return pairingsWithRead().filter((id) => !formed.has(id));
}
