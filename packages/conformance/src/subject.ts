/**
 * A conformance request: a vector class + a single case's input, as plain JSON.
 * For `class: "schema"` areas the runner resolves the canonical JSON Schema from the
 * manifest and passes it INLINE — subjects stay tree-independent and language-neutral.
 */
export type SubjectRequest = {
  class: string;
  input: unknown;
  schema?: unknown;
};
/** A subject's answer: either a produced output or a declared error code. */
export type SubjectResponse = { output?: unknown; error?: string };
/**
 * Any implementation under test — TS in-process, or a foreign CLI over stdio.
 *
 * OBLIGATION ON A FOREIGN SUBJECT THAT NO VECTOR CAN STATE: a subject parsing this request from
 * text MUST apply JS object semantics — a repeated key collapses to one property, keeping the
 * FIRST occurrence's position and the LAST occurrence's value, and array-index keys enumerate
 * ahead of string keys at every depth. The corpus cannot certify the first half: the runner reads
 * vector files with `JSON.parse` and `CliSubject` re-serializes with `JSON.stringify`, so a
 * duplicate key is collapsed before any subject sees it. A subject that keeps both entries re-emits
 * a duplicate key into the hashed bytes and reads back the wrong one — an atrHash divergence the
 * corpus will report as green. (Ordering IS certified — see the atr.assemble vectors.)
 */
export interface Subject {
  handle(req: SubjectRequest): Promise<SubjectResponse>;
}
