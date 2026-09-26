/** A refusal returned as a value. `code` is `<entry point>/<reason>`. */
export type Refusal = { refused: true; code: string };

export function refusal(code: string): Refusal {
  return { refused: true, code };
}

export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && (v as { refused?: unknown }).refused === true;
}
