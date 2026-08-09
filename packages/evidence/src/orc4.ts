/**
 * The ORC-4 gate/middleware log. A structured, append-only record of what the gate verified, which
 * rules fired, and any halt — carrying `binding-core`'s `HaltClass` union (one definition, four surfaces).
 * The schema is `vectors/evidence/orc4-log.schema.json`; this is its TS shape + the append
 * primitive. `recordQualityFlags` is the evidence-log half of the low-entropy-uniqueness duty:
 * flagged at the weld boundary AND here; the seller engine's uniqueness check writes it.
 */
import type { HaltClass } from "@integraledger/lcp-binding-core";

/** One escalation on an ORC-4 entry. `approver` is required; the index signature is open because an
 *  escalation's other fields are the deployment's own policy vocabulary, which LCP does not define. */
export interface Orc4Escalation {
  approver: string;
  [k: string]: unknown;
}

/** One append to the gate log: what was verified, which rules fired, and whether it halted. `haltClass`
 *  is present IFF the gate halted — its absence is the record of a clean pass, not a missing field. */
export interface Orc4Entry {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** The artifacts the gate verified (by `lcp:sha256:` ref or role). */
  artifactsVerified: string[];
  /** The named rules the gate fired. */
  rulesFired: string[];
  /** Present iff the gate halted — the FRC-3 class of the halt. */
  haltClass?: HaltClass;
  escalations?: Orc4Escalation[];
  /** Low-entropy-uniqueness flags raised at the weld boundary. */
  recordQualityFlags?: string[];
}

/** The append-only gate log. Append-only by CONVENTION and by the functional API — `appendOrc4` returns
 *  a new log rather than mutating — not by any storage guarantee; persisting it immutably is the caller's. */
export interface Orc4Log {
  entries: Orc4Entry[];
}

/** Start an empty ORC-4 log. */
export function emptyOrc4Log(): Orc4Log {
  return { entries: [] };
}

/** Append an entry, returning a new log (functional core — the caller persists it). */
export function appendOrc4(log: Orc4Log, entry: Orc4Entry): Orc4Log {
  return { entries: [...log.entries, entry] };
}
