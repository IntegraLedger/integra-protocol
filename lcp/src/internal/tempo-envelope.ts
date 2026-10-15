/**
 * The signed Tempo `0x76` envelope: its items, the bytes its sender signed, and its sender. `../tempo.ts` reads the
 * calls and the expiring nonce hash through these, and `../mpp-session.ts` reads the sender of a session's opening; no
 * entry point exports these names.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { concat, hexOf, keccak, type Hex } from "../evm-abi.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import { rlpDecode, rlpList, rlpUint, type RlpItem } from "../rlp.js";

/** The type byte of a Tempo transaction. */
export const TEMPO_TX_TYPE = 0x76;
const MAX_WIRE_BYTES = 65_536;
const MAX_WIRE_DEPTH = 8;
/** Envelope positions: calls, valid_before, fee_token and fee_payer_signature. */
export const CALLS = 4;
export const VALID_BEFORE = 8;
const FEE_TOKEN = 10;
const FEE_PAYER_SIGNATURE = 11;
const UINT_FIELDS = [0, 1, 2, 3, 6, 7, 8, 9] as const;

/** Tempo's signature lengths and type bytes (tempoxyz/tempo, `tt_signature.rs`). */
const SECP256K1_LENGTH = 65;
const P256_LENGTH = 129;
const WEBAUTHN_MIN = 128;
const WEBAUTHN_MAX = 2048;
const P256 = 0x01;
const WEBAUTHN = 0x02;
const KEYCHAIN = 0x03;
const KEYCHAIN_V2 = 0x04;

/**
 * The envelope's items: `0x76`, then an RLP list of 14 items (13 fields and the sender's signature), or 15 when a
 * key authorization precedes the signature. At most 64 KiB and RLP depth 8.
 */
export function decodeEnvelope(wire: unknown): RlpItem[] | Refusal {
  if (!(wire instanceof Uint8Array)) return refusal("tempo/tx-malformed");
  if (wire.length > MAX_WIRE_BYTES) return refusal("tempo/tx-too-large");
  if (wire.length < 2 || wire[0] !== TEMPO_TX_TYPE) return refusal("tempo/tx-malformed");
  const top = rlpDecode(wire.subarray(1), MAX_WIRE_DEPTH);
  if (top === undefined || top.kind !== "list") return refusal("tempo/tx-malformed");
  const items = top.items;
  if (items.length !== 14 && items.length !== 15) return refusal("tempo/tx-malformed");
  for (const i of UINT_FIELDS) if (rlpUint(items[i]) === undefined) return refusal("tempo/tx-malformed");
  for (const i of [CALLS, 5, 12]) if (items[i]!.kind !== "list") return refusal("tempo/tx-malformed");
  if (items[FEE_TOKEN]!.kind !== "bytes") return refusal("tempo/tx-malformed");
  if (items.length === 15 && items[13]!.kind !== "list") return refusal("tempo/tx-malformed");
  if (items[items.length - 1]!.kind !== "bytes") return refusal("tempo/tx-malformed");
  return items;
}

/**
 * What the sender signed: `0x76` ‖ rlp(every envelope field before the sender's signature). When a fee payer has
 * signed, `fee_token` is written as `0x80` and the fee payer's signature as `0x00`.
 */
export function senderSigned(items: readonly RlpItem[]): Uint8Array {
  const fields = items.slice(0, -1).map((i) => i.raw);
  const feePayer = items[FEE_PAYER_SIGNATURE]!;
  if (!(feePayer.kind === "bytes" && feePayer.raw.length === 1 && feePayer.raw[0] === 0x80)) {
    fields[FEE_TOKEN] = Uint8Array.of(0x80);
    fields[FEE_PAYER_SIGNATURE] = Uint8Array.of(0x00);
  }
  return concat([Uint8Array.of(TEMPO_TX_TYPE), rlpList(fields)]);
}

/** The address of an uncompressed public key's 64 coordinate bytes. */
function addressOfKey(xy: Uint8Array): Hex {
  return hexOf(keccak(xy).subarray(12));
}

/**
 * The signer of a primitive Tempo signature over `hash`: secp256k1's 65 bytes (r, s, v with v 0, 1, 27, 28 or 35 and
 * above) by recovery, its s in the lower half of the order; P256's `0x01` and 129 bytes, and WebAuthn's `0x02` and 128
 * to 2,048 bytes, by the public key they carry, whose address is the signer the chain recovers once it verifies them.
 */
function primitiveSigner(sig: Uint8Array, hash: Uint8Array): Hex | Refusal {
  const bad = refusal("tempo/tx-malformed");
  if (sig.length === SECP256K1_LENGTH) {
    const v = sig[64]!;
    const parity = v === 0 || v === 1 ? v : v === 27 || v === 28 ? v - 27 : v >= 35 ? (v - 35) % 2 : -1;
    if (parity < 0) return bad;
    try {
      const s = secp256k1.Signature.fromBytes(sig.subarray(0, 64), "compact");
      if (s.hasHighS()) return bad;
      return addressOfKey(s.addRecoveryBit(parity).recoverPublicKey(hash).toBytes(false).subarray(1));
    } catch {
      return bad;
    }
  }
  const body = sig.subarray(1);
  if (sig[0] === P256 && body.length === P256_LENGTH) return addressOfKey(body.subarray(64, 128));
  if (sig[0] === WEBAUTHN && body.length >= WEBAUTHN_MIN && body.length <= WEBAUTHN_MAX) {
    return addressOfKey(body.subarray(body.length - 64));
  }
  return bad;
}

/**
 * The sender of a signed `0x76` transaction, as Tempo recovers it from the sender's signature over what the sender
 * signed (`senderSigned`): a primitive signature's signer, or for a keychain signature (`0x03`, or `0x04` whose inner
 * signature signs keccak256(`0x04` ‖ that hash ‖ the account), each a 20-byte account and a primitive signature) that
 * account. Any other signature is `tempo/tx-malformed`, a `0x05` type byte among them: Tempo's transaction
 * specification lists the secp256k1, P256, WebAuthn and keychain signature types and no other ("Signature Types"), and
 * its signature validation takes any other format as invalid ("Transaction Validation", step 1: "Otherwise invalid").
 * Tempo's node answers any other type byte "Unknown signature type identifier" (tempoxyz/tempo `7d4fd03`,
 * `crates/primitives/src/transaction/tt_signature.rs`: `TempoSignature::from_bytes` reads `0x03` and `0x04` and passes
 * every other signature to `PrimitiveSignature::from_bytes`, which reads 65 bytes, `0x01` and `0x02`).
 */
export function tempoSender(wire: Uint8Array): Hex | Refusal {
  const items = decodeEnvelope(wire);
  if (isRefusal(items)) return items;
  const sig = (items[items.length - 1] as Extract<RlpItem, { kind: "bytes" }>).bytes;
  const hash = keccak(senderSigned(items));
  if (sig.length !== SECP256K1_LENGTH && (sig[0] === KEYCHAIN || sig[0] === KEYCHAIN_V2)) {
    const account = sig.subarray(1, 21);
    if (account.length !== 20) return refusal("tempo/tx-malformed");
    const signed = sig[0] === KEYCHAIN_V2 ? keccak(concat([Uint8Array.of(KEYCHAIN_V2), hash, account])) : hash;
    const inner = primitiveSigner(sig.subarray(21), signed);
    return isRefusal(inner) ? inner : hexOf(account);
  }
  return primitiveSigner(sig, hash);
}
