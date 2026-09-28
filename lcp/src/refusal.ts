/** A refusal returned as a value. `code` is `<entry point>/<reason>`. */
export type Refusal = { refused: true; code: string };

/** Every refusal this package makes. Membership, not shape, is what makes a value a refusal. */
const made = new WeakSet<object>();

/** A refusal with `code`, recognised by `isRefusal`. */
export function refusal<C extends string>(code: C): { refused: true; code: C } {
  const r = { refused: true as const, code };
  made.add(r);
  return r;
}

/**
 * True only for a value `refusal` made. A caller's value shaped `{ refused: true, … }` is not a refusal, so no input is
 * ever passed on as one.
 */
export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && made.has(v);
}

/** True when an object handed in as a payment or credential carries a `refused` member, the member refusals use. */
export function carriesRefused(v: Record<string, unknown>): boolean {
  return Object.hasOwn(v, "refused");
}
