import { type AtrHash, hashAtr } from "./atrHash.js";
import { KernelError } from "./errors.js";
import { isRef, type Ref } from "./ref.js";

const LCP_VERSION = "0.3"; // engine-stamped envelope format version

/** Any value expressible in JSON. The recursive definition is deliberate: a component's `value` is
 *  serialised into the ATR file byte-for-byte, so a type permitting `undefined` or a `Date` would permit
 *  an ATR whose hash nobody else can reproduce. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };
/** One named piece of an ATR. Exactly one of `value` (inline) or `ref` (content-addressed) is used — a
 *  component carrying both, or neither, is rejected at assembly. The `slot` namespace is open — the kernel
 *  preserves slots it does not know, which is what lets a profile add fields without a new kernel — with
 *  two exclusions it enforces: reserved envelope slots, and integer-like names, which JSON serialisation
 *  would reorder to the front and so change the bytes. */
export type Component = { slot: string; value?: Json; ref?: Ref };
/** The assembled ATR as its exact bytes. This — not the object it came from — is what `atrHash` is taken
 *  over, and the reason the type is `Uint8Array` rather than a parsed shape: any re-serialisation is a
 *  chance to produce different bytes for the same document. */
export type AtrFile = Uint8Array;

/** Compile one canonical JSON document and hash its exact bytes. Pure: same components in, same bytes out. */
export async function assemble(
  components: Component[],
): Promise<{ atrFile: AtrFile; atrHash: AtrHash }> {
  // Prototype-free record: a component named "__proto__" (or any Object.prototype accessor) must
  // become a normal own key — preserved like any unknown slot and seen by the duplicate/emit paths —
  // not silently mutate the prototype and vanish from JSON.stringify (that silent data loss is the
  // exact failure mode this engine's fail-fast slot guards exist to prevent). Open-extensibility holds.
  const envelope: Record<string, Json> = Object.create(null);
  envelope["lcp"] = LCP_VERSION;
  for (const c of components) {
    if (c.slot === "lcp")
      throw new KernelError(
        "assemble/reserved-slot",
        "lcp is engine-stamped, not a component",
      );
    // JS serialization orders integer-like keys first regardless of insertion — a slot named "1"
    // would jump ahead of lcp and falsify the engine-controlled emitted order. Refused, never reordered.
    if (/^(0|[1-9][0-9]*)$/.test(c.slot))
      throw new KernelError(
        "assemble/numeric-slot",
        `integer-like slot names are rejected: ${c.slot}`,
      );
    if (Object.hasOwn(envelope, c.slot))
      throw new KernelError(
        "assemble/duplicate-slot",
        `duplicate slot: ${c.slot}`,
      );
    const hasValue = c.value !== undefined;
    const hasRef = c.ref !== undefined;
    if (hasValue === hasRef)
      throw new KernelError(
        "assemble/component-shape",
        `component must have exactly one of value|ref: ${c.slot}`,
      );
    if (hasRef && !isRef(c.ref as string))
      throw new KernelError(
        "assemble/bad-ref",
        `invalid reference at ${c.slot}: ${c.ref}`,
      );
    envelope[c.slot] = hasValue ? (c.value as Json) : (c.ref as string);
  }
  // Required set = lcp (stamped) + terms + id; terms/id must be present and non-empty. Fail fast.
  const nonEmpty = (v: Json | undefined): boolean =>
    typeof v === "string" && v.length > 0;
  if (!nonEmpty(envelope["id"]))
    throw new KernelError(
      "assemble/missing-id",
      "id is required on every record, non-empty",
    );
  if (!nonEmpty(envelope["terms"]))
    throw new KernelError(
      "assemble/missing-terms",
      "terms is required, non-empty",
    );
  // caps is the machine-decided slot: raw JSON numbers are byte-unstable (1e+21) and precision-lossy
  // past 2^53 — rejected here, where the record is minted; the tree schema guards only the conformance runner.
  const noRawNumber = (v: Json): boolean =>
    typeof v === "number"
      ? false
      : Array.isArray(v)
        ? v.every(noRawNumber)
        : v !== null && typeof v === "object"
          ? Object.values(v).every(noRawNumber)
          : true;
  if (envelope["caps"] !== undefined && !noRawNumber(envelope["caps"]))
    throw new KernelError(
      "assemble/caps-raw-number",
      "caps values: monetary amounts are decimal-integer strings of base units — raw JSON numbers are rejected",
    );

  const atrFile = new TextEncoder().encode(JSON.stringify(envelope));
  const atrHash = await hashAtr(atrFile);
  return { atrFile, atrHash };
}
