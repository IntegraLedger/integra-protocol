import { isAtrHash } from "./atrHash.js";
import { KernelError } from "./errors.js";

/** A content-addressed reference to an ATR or artifact by its SHA-256. */
export type Ref = `lcp:sha256:${string}`;

const REF_RE = /^lcp:sha256:0x[0-9a-fA-F]{64}$/; // no whitespace; reference hardening

/** Is this a well-formed `lcp:sha256:0x…` reference? Shape only — it says nothing about whether the
 *  referenced artifact exists or resolves. Whitespace is not tolerated anywhere; use {@link parseRef} when
 *  you want the malformation named rather than a bare `false`. */
export function isRef(v: string): v is Ref {
  return REF_RE.test(v);
}

/** Validate and normalize a reference; fail-fast on any malformation (no-whitespace discipline). */
export function parseRef(v: string): { hash: string } {
  if (/\s/.test(v))
    throw new KernelError(
      "ref/whitespace",
      `reference contains whitespace: ${v}`,
    );
  if (!isRef(v))
    throw new KernelError(
      "ref/malformed",
      `not an lcp:sha256: reference: ${v}`,
    );
  const hash = v.slice("lcp:sha256:".length);
  if (!isAtrHash(hash))
    throw new KernelError("ref/hash", `reference hash invalid: ${hash}`);
  return { hash };
}
