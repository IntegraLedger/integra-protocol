/**
 * The `VerificationReport` and its **deterministic serialization — RFC 8785 (JCS) canonical JSON**.
 * The protocol promises byte-identical reports across independent implementations: the report is RECOMPUTED by
 * every verifier, and JCS is exactly the multi-producer-convergence case it exists for. This is NOT the
 * ATR rule and the two must never be conflated — canonicalization is banned for the *ATR* because it has
 * one producer and the exact received bytes are the fingerprint; the *report* has many producers.
 *
 * All monetary values in reports are decimal-integer base-unit STRINGS, so JCS's
 * ECMAScript number serialization never touches money. JCS = recursively sort object keys by UTF-16 code
 * units (JS default string sort), then serialize with JSON's escaping + ECMAScript number formatting
 * (which already match RFC 8785 §3.2.2). Confirmed byte-for-byte against an independent JCS implementation.
 */
import type { HaltClass } from "@integraledger/lcp-binding-core";

/** Verification depth: structural (presence/absence readout, verified always false) vs mechanical
 *  (inputs gathered over live ports; verified is an honest function of the walk). */
export type VerifyDepth = "structural" | "mechanical";

/** A step outcome — aligned to `report.schema.json`. */
export type StepOutcome =
  | { status: "proved" }
  | { status: "failed"; haltClass: HaltClass }
  | { status: "indeterminate" } // unretrievable ATR — not a failure
  | { status: "not-attempted"; depth: string };

/** One named step of the walk and how it came out. The `name` is a {@link StepName} in this
 *  implementation but is typed as `string` here so a foreign implementation's report is representable —
 *  a report type that cannot hold another engine's step cannot be used to compare against it. */
export interface VerificationStep {
  name: string;
  outcome: StepOutcome;
}

/** The output of a verification walk — the artifact a stranger reads instead of re-running it.
 *
 *  Read `steps` before `verified`. `verified` is a summary that is FALSE at structural depth by
 *  construction, so a `false` may mean "impeached" or merely "not attempted mechanically", and only the
 *  step list distinguishes them. `claimedClass` and `supportedClass` are the report's two halves and must
 *  never be read as one: the first is the caller's input, echoed so the walk can be interpreted; the second
 *  is the walk's own finding. Where they differ, the record did not reach what it was shaped for. Several
 *  fields are `string` rather than a union on purpose: this type has to be able to hold another
 *  implementation's answer, including a wrong one. */
export interface VerificationReport {
  /** Honest function of depth: `false` at structural (presence/absence → class); at mechanical, raised by
   *  `computeVerified` iff every class-required step is `proved` and none `failed`. */
  verified: boolean;
  /** The stated assurance level — never a bare boolean. One of the four ladder values
   *  (`wallet-signature-only` | `domain-controlled` | `attested` | `legal-party`), or
   *  `no-assurance-stated` where the record states none. Left as `string` rather than a union for the same
   *  reason `supportedClass` is: a foreign implementation's report must be representable before it can be
   *  compared, and a type that refuses to hold a wrong value cannot report one. */
  assurance: string;
  /** The class the record was shaped for, as the caller stated it — the walk's INPUT, echoed so `verified`
   *  can be read at all (it answers "did the record reach THIS class?"). A caller that states none is
   *  verified against `TC-2`, and that effective value is what appears here. Never a finding: nothing in
   *  the walk can change it. */
  claimedClass: string;
  /** The class the walk reached — the highest one whose every required step is `proved`, `TC-0` if any step
   *  failed. A FINDING, computed from the steps alone: it is not capped by `claimedClass` and not lifted by
   *  it. Compare the two to learn whether the record met its own shape. */
  supportedClass: string;
  /** The settlement's chain-anchored time every validity check is evaluated against. */
  asOf: string;
  steps: VerificationStep[];
  /** Supplied ports/bindings — coverage is part of honest depth. */
  coverage: { ports: string[]; bindings: string[] };
  settlements: { found: unknown[]; multiplySettled: boolean };
}

/**
 * Emit the canonical text DIRECTLY from the sorted key list — never by re-assigning sorted keys onto an
 * object and handing it to `JSON.stringify`. JS object property order puts integer-like keys FIRST, in
 * ascending numeric order, whatever the insertion order (the same engine behaviour `kernel.assemble`
 * refuses integer-like slot names over), so the object round-trip silently re-sorts `{"10":…,"9":…}` to
 * `9,10` while RFC 8785 §3.2.3 requires UTF-16 code-unit order — `"1" (0x31) < "9" (0x39)`. Two conformant
 * implementations would then disagree byte-for-byte on the same report, which is the one thing this buys.
 * Reachable through `settlements.found` (caller-supplied objects). Pinned by `vectors/report/serialization.json`.
 */
function serializeCanonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(serializeCanonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    // Default Array#sort compares by UTF-16 code units — exactly RFC 8785's ordering.
    const parts = Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${serializeCanonical(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  // Primitives: JSON's own escaping + ECMAScript number formatting already match RFC 8785 §3.2.2.
  return JSON.stringify(v) as string;
}

/** RFC 8785 JCS canonical JSON string for any JSON value (keys sorted by UTF-16 code units, no whitespace). */
export function jcsCanonicalize(value: unknown): string {
  // Round-trip through JSON first so `toJSON`, dropped `undefined`/function members, and non-finite
  // numbers resolve EXACTLY as JSON.stringify defines them; `serializeCanonical` then sees pure JSON
  // and owns only the ordering rule.
  const json = JSON.stringify(value);
  if (json === undefined)
    throw new Error(
      "value is not JSON-serializable (JCS is defined only over JSON values)",
    );
  return serializeCanonical(JSON.parse(json));
}

/** The report's canonical bytes (UTF-8 of its JCS form) — the byte-for-byte target. */
export function serializeReport(report: VerificationReport): Uint8Array {
  return new TextEncoder().encode(jcsCanonicalize(report));
}
