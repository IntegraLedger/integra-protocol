/**
 * Authoring-time terms normalization: CRLF/CR → LF, trailing
 * newlines collapsed to exactly one, NFC. It does NOT touch interior whitespace, case,
 * or ordering — those can be legally significant in terms prose, and silently rewriting
 * them would change the meaning of the document, not just its byte layout.
 *
 * OFFERED to authoring surfaces (a template authoring tool at creation, a seller at
 * instantiation slot-fill — idempotent, so re-applying is safe); NEVER invoked by
 * assemble()/hashAtr(): the kernel hashes exact bytes as handed.
 */
export function normalizeTerms(text: string): string {
  const lf = text.replace(/\r\n?/g, "\n");
  // Scanning back beats `/\n+$/`: that pattern retries the greedy run from every position in a trailing
  // newline run, which is quadratic — 200k trailing newlines took ~16s. Authoring input is the seller's
  // own prose, so this is byte-stability hygiene rather than a hostile-input path, but the kernel is the
  // most-depended-on package here and a linear scan is the same three lines.
  // No `end > 0` guard: `charCodeAt(-1)` is NaN, which fails the `=== 10` test, so an all-newline string
  // stops at 0 on its own. Adding the bound would be a branch no input can take either way.
  let end = lf.length;
  while (lf.charCodeAt(end - 1) === 10) end--;
  return `${lf.slice(0, end)}\n`.normalize("NFC");
}
