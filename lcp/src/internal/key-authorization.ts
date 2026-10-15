/**
 * The read of a signed Tempo key authorization and its bounds. `../tempo.ts`'s `decodeKeyAuthorization` gives this read
 * without the key type, and `../mpp-session.ts`'s subscription reads the key type with the key id; no entry point
 * exports these names.
 */
import { bytesOf, hexOf, keccakHex, type Hex } from "../evm-abi.js";
import { refusal, type Refusal } from "../refusal.js";
import { rlpDecode, rlpUint, type RlpItem } from "../rlp.js";
import type { TempoKeyAuthorization } from "../tempo.js";

export const MAX_KEY_AUTHORIZATION_BYTES = 8192;
const MAX_KEY_AUTHORIZATION_DEPTH = 6;
export const MAX_SCOPES = 16;

/** A signed key authorization as `readKeyAuthorization` reads it. */
export interface KeyAuthorizationRead {
  witness?: Hex;
  digest: Hex;
  keyId: Hex;
  limits: TempoKeyAuthorization["limits"];
  allowedCalls: TempoKeyAuthorization["allowedCalls"];
  /** Item 1, the key type, as Tempo numbers it: secp256k1 0, P256 1, WebAuthn 2; any other value as given. */
  keyType: bigint;
}

/**
 * `decodeKeyAuthorization`'s read, with the key type: an RLP list of the authorization (3 to 9 items) and a
 * byte-string signature, else `tempo/key-authorization-malformed`.
 */
export function readKeyAuthorization(signed: Hex): KeyAuthorizationRead | Refusal {
  const bad = refusal("tempo/key-authorization-malformed");
  const b = bytesOf(signed, MAX_KEY_AUTHORIZATION_BYTES);
  if (b === undefined) return bad;
  const top = rlpDecode(b, MAX_KEY_AUTHORIZATION_DEPTH);
  if (top === undefined || top.kind !== "list" || top.items.length !== 2) return bad;
  const [auth, sig] = top.items as [RlpItem, RlpItem];
  if (auth.kind !== "list" || sig.kind !== "bytes" || auth.items.length < 3 || auth.items.length > 9) return bad;
  const keyId = auth.items[2]!;
  if (keyId.kind !== "bytes" || keyId.bytes.length !== 20) return bad;
  const keyType = rlpUint(auth.items[1]);
  if (rlpUint(auth.items[0]) === undefined || keyType === undefined) return bad;
  for (const i of [4, 5]) {
    const l = auth.items[i];
    if (l !== undefined && !withinScopes(l, i === 5)) return bad;
  }
  const limits = limitsOf(auth.items[4]);
  const allowedCalls = allowedCallsOf(auth.items[5]);
  if (limits === undefined || allowedCalls === undefined) return bad;
  const w = auth.items[6];
  let witness: Hex | undefined;
  if (w !== undefined) {
    if (w.kind !== "bytes" || (w.bytes.length !== 0 && w.bytes.length !== 32)) return bad;
    if (w.bytes.length === 32) witness = hexOf(w.bytes);
  }
  const digest = keccakHex(auth.raw);
  const read = { digest, keyId: hexOf(keyId.bytes), limits, allowedCalls, keyType };
  return witness === undefined ? read : { witness, ...read };
}

/** The items of an RLP list, or none for an absent item or an empty byte string. */
function itemsOf(l: RlpItem | undefined): RlpItem[] {
  return l === undefined || l.kind !== "list" ? [] : l.items;
}

/** A byte string of `n` bytes, as hex. */
function fixedBytes(i: RlpItem | undefined, n: number): Hex | undefined {
  return i !== undefined && i.kind === "bytes" && i.bytes.length === n ? hexOf(i.bytes) : undefined;
}

/** The limits: `[token, limit, period]` each, or `[token, limit]` for a limit whose period is 0. */
function limitsOf(l: RlpItem | undefined): TempoKeyAuthorization["limits"] | undefined {
  const out: TempoKeyAuthorization["limits"] = [];
  for (const item of itemsOf(l)) {
    if (item.kind !== "list" || (item.items.length !== 2 && item.items.length !== 3)) return undefined;
    const token = fixedBytes(item.items[0], 20);
    const limit = rlpUint(item.items[1]);
    const period = item.items.length === 3 ? rlpUint(item.items[2]) : 0n;
    if (token === undefined || limit === undefined || period === undefined) return undefined;
    out.push({ token, limit, period });
  }
  return out;
}

/** The allowed calls: `[target, [[selector, [recipient, …]], …]]` each. */
function allowedCallsOf(l: RlpItem | undefined): TempoKeyAuthorization["allowedCalls"] | undefined {
  const out: TempoKeyAuthorization["allowedCalls"] = [];
  for (const scope of itemsOf(l)) {
    if (scope.kind !== "list") return undefined;
    const target = fixedBytes(scope.items[0], 20);
    if (target === undefined) return undefined;
    const selectorRules: TempoKeyAuthorization["allowedCalls"][number]["selectorRules"] = [];
    for (const rule of itemsOf(scope.items[1])) {
      if (rule.kind !== "list") return undefined;
      const selector = fixedBytes(rule.items[0], 4);
      const recipients = itemsOf(rule.items[1]).map((r) => fixedBytes(r, 20));
      if (selector === undefined || !recipients.every((r) => r !== undefined)) return undefined;
      selectorRules.push({ selector, recipients: recipients as Hex[] });
    }
    out.push({ target, selectorRules });
  }
  return out;
}

/** True for a list of at most 16 entries; for `allowed_calls`, also at most 16 rules per scope and 16 recipients per rule. */
function withinScopes(l: RlpItem, calls: boolean): boolean {
  if (l.kind !== "list") return l.bytes.length === 0;
  if (l.items.length > MAX_SCOPES) return false;
  if (!calls) return true;
  for (const scope of l.items) {
    if (scope.kind !== "list" || scope.items.length !== 2) return false;
    const rules = scope.items[1]!;
    if (rules.kind !== "list" || rules.items.length > MAX_SCOPES) return false;
    for (const rule of rules.items) {
      if (rule.kind !== "list" || rule.items.length !== 2) return false;
      const recipients = rule.items[1]!;
      if (recipients.kind !== "list" || recipients.items.length > MAX_SCOPES) return false;
    }
  }
  return true;
}
