import { type AtrHash, hashAtr } from "./atrHash.js";
import { KernelError } from "./errors.js";
import { isRef, type Ref } from "./ref.js";

const ATR_VERSION = "0.3"; // engine-stamped ATR format version

/** Any value expressible in JSON. The recursive definition is deliberate: a slot's `value` is
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
 *  slot carrying both, or neither, is rejected at assembly. The `slot` namespace is open — the kernel
 *  preserves slots it does not know, which is what lets a profile add fields without a new kernel — with
 *  two exclusions it enforces: reserved ATR slots, and integer-like names, which JSON serialisation
 *  would reorder to the front and so change the bytes. */
export type Slot = { slot: string; value?: Json; ref?: Ref };
/** The assembled ATR as its exact bytes. This — not the object it came from — is what `atrHash` is taken
 *  over, and the reason the type is `Uint8Array` rather than a parsed shape: any re-serialisation is a
 *  chance to produce different bytes for the same document. */
export type AtrBytes = Uint8Array;

/** Compile one canonical JSON document and hash its exact bytes. Pure: same slots in, same bytes out. */
export async function assemble(
  slots: Slot[],
): Promise<{ atrBytes: AtrBytes; atrHash: AtrHash }> {
  // Prototype-free record: a slot named "__proto__" (or any Object.prototype accessor) must
  // become a normal own key — preserved like any unknown slot and seen by the duplicate/emit paths —
  // not silently mutate the prototype and vanish from JSON.stringify (that silent data loss is the
  // exact failure mode this engine's fail-fast slot guards exist to prevent). Open-extensibility holds.
  const atr: Record<string, Json> = Object.create(null);
  atr["atr"] = ATR_VERSION;
  for (const s of slots) {
    if (s.slot === "atr")
      throw new KernelError(
        "assemble/reserved-slot",
        "atr is engine-stamped, not a caller's slot",
      );
    // JS serialization orders integer-like keys first regardless of insertion — a slot named "1"
    // would jump ahead of atr and falsify the engine-controlled emitted order. Refused, never reordered.
    if (/^(0|[1-9][0-9]*)$/.test(s.slot))
      throw new KernelError(
        "assemble/numeric-slot",
        `integer-like slot names are rejected: ${s.slot}`,
      );
    if (Object.hasOwn(atr, s.slot))
      throw new KernelError(
        "assemble/duplicate-slot",
        `duplicate slot: ${s.slot}`,
      );
    const hasValue = s.value !== undefined;
    const hasRef = s.ref !== undefined;
    if (hasValue === hasRef)
      throw new KernelError(
        "assemble/slot-shape",
        `slot must have exactly one of value|ref: ${s.slot}`,
      );
    if (hasRef && !isRef(s.ref as string))
      throw new KernelError(
        "assemble/bad-ref",
        `invalid reference at ${s.slot}: ${s.ref}`,
      );
    atr[s.slot] = hasValue ? (s.value as Json) : (s.ref as string);
  }
  // Required set = atr (stamped) + terms + id; terms/id must be present and non-empty. Fail fast.
  const nonEmpty = (v: Json | undefined): boolean =>
    typeof v === "string" && v.length > 0;
  if (!nonEmpty(atr["id"]))
    throw new KernelError(
      "assemble/missing-id",
      "id is required on every record, non-empty",
    );
  if (!nonEmpty(atr["terms"]))
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
  if (atr["caps"] !== undefined && !noRawNumber(atr["caps"]))
    throw new KernelError(
      "assemble/caps-raw-number",
      "caps values: monetary amounts are decimal-integer strings of base units — raw JSON numbers are rejected",
    );

  // Everywhere else, the narrower rule: a JSON number outside the safe-integer range is not the number the
  // caller handed us. JS resolved 9007199254740993 to ...992 before this function was entered, and
  // NaN/Infinity serialise to `null`. Both losses are silent, and neither is detectable HERE — the damaged
  // value is indistinguishable from an honest one of the same magnitude — so the RANGE is refused rather
  // than the damage found. A record is evidence, and evidence that quietly holds a different number than
  // the parties agreed is worse than a refusal. Ordinary numbers pass, which is why this is not the `caps`
  // rule extended: `caps` is machine-decided and takes decimal strings for every amount, while an open
  // slot may legitimately carry `{"version": 2}`. A quantity needing more range is a decimal string too.
  const unrepresentable = (v: Json, path: string): string | null => {
    if (typeof v === "number")
      return Number.isSafeInteger(v) ||
        (!Number.isInteger(v) && Math.abs(v) < Number.MAX_SAFE_INTEGER)
        ? null
        : path;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const hit = unrepresentable(v[i] as Json, `${path}[${i}]`);
        if (hit !== null) return hit;
      }
      return null;
    }
    if (v !== null && typeof v === "object") {
      for (const [k, nested] of Object.entries(v)) {
        const hit = unrepresentable(nested, `${path}.${k}`);
        if (hit !== null) return hit;
      }
      return null;
    }
    return null;
  };
  for (const [slot, value] of Object.entries(atr)) {
    const hit = unrepresentable(value, slot);
    if (hit !== null)
      throw new KernelError(
        "assemble/unrepresentable-number",
        `${hit}: a JSON number beyond the safe-integer range (±${Number.MAX_SAFE_INTEGER}), or NaN/Infinity, cannot be recorded faithfully — supply a decimal string`,
      );
  }

  const atrBytes = new TextEncoder().encode(JSON.stringify(atr));
  const atrHash = await hashAtr(atrBytes);
  return { atrBytes, atrHash };
}
