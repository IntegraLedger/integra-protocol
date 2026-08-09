import type { ProtocolId } from "./protocol-id.js";
import type {
  AssetBinding,
  BindingPattern,
  SuccessGate,
} from "./vocabulary.js";

/** How strong one collection path's weld is. `tx` means the atrHash reached the settled transaction
 *  itself; `signature` means it was bound only into something a party signed, which a party can decline
 *  to submit. Per-path, not per-binding: one rail routinely offers both. */
export type WeldGrade = "signature" | "tx";
/** The WLD-3 triple every binding declares about its own recovery path. `onChain` — the binding value is
 *  written to the ledger, not merely to an off-chain artifact. `zeroPartyRecoverable` — a stranger holding
 *  nothing but the settlement can recover the atrHash, which is the property that survives either party
 *  losing its records. `forwardIndexable` — the reverse lookup (atrHash → settlements) is possible, and
 *  it is exactly what an `enumerate` implementation requires. These are CLAIMS a consumer relies on: a
 *  binding that overstates one has misdeclared, and each is checked against the adapter, not the schema. */
export type RecoveryProps = {
  onChain: boolean;
  zeroPartyRecoverable: boolean;
  forwardIndexable: boolean;
};
/** A binding's machine-readable declaration of what it does and what it can prove — the artifact a
 *  stranger reads instead of the source. Everything here is a claim the adapter must actually honour;
 *  successive audits have found manifests their own adapter contradicts, and the schema cannot catch that
 *  class (it cannot tell you whether a declared `indexing` strategy is one the reader can perform).
 *  `rail` is the scheme id and `protocol` the commerce protocol — different fields, different jobs. */
export type BindingManifest = {
  rail: string; // "evm:x402" | "evm:escrow" | "solana" | …
  /** OPTIONAL — the commerce protocol this binding is specific to. Absent iff the binding is
   *  protocol-neutral: `evm:escrow` is a MECHANISM (several protocols settle through it) and the bare-rail
   *  bindings bind no protocol. `rail` above stays the scheme id; the two are different fields with
   *  different jobs, and conflating them is the bug this field exists to prevent. Without it the only way
   *  to answer "which commerce protocol is this?" is to string-parse a scheme id — and for `evm:escrow`
   *  there is no answer at all. */
  protocol?: ProtocolId;
  pattern: BindingPattern; // the LCP §8.3 pattern name. Without this field the classification would live
  // only in prose, and a future
  // MPP-EVM binding (genuinely id-reuse per spec C.1) had no type to say so
  nativeField?: string; // the protocol field carrying the binding value — present iff pattern = "native-field"
  recovery: RecoveryProps; // WLD-3 triple
  assetBinding: AssetBinding; // whether recovery observes the settled asset — see vocabulary.ts
  successGate: SuccessGate; // HOW recovery knows the settlement happened at all — see vocabulary.ts
  indexing: string; // "nonce-topic" | "event-data-scan:paymentInfoHash" | …
  finality: { reversible: boolean; note: string }; // PAY-3/RCS-5 declaration
  weldGrades: Record<string, WeldGrade>; // per collection path
  offCanonical?: { profile: string }; // named profile ref (LCP §8.3.1's own variant, not a hedge)
  lifecycleStates: string[]; // the lifecycle state set for this binding
};
