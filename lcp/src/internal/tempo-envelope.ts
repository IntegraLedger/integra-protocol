/**
 * The signed Tempo `0x76` envelope, and the `0x78` form a sender's client sends a fee payer: its items, the bytes its
 * sender signed, its sender, and the signatures of its authorization list. `../tempo.ts` reads the calls and the expiring nonce hash through these, and `../mpp-session.ts`
 * reads the sender and the authorization list's signatures of a session's opening; no entry point exports these names.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { concat, hexOf, keccak, type Hex } from "../evm-abi.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import { rlpDecode, rlpList, rlpUint, type RlpItem } from "../rlp.js";

/** The type byte of a Tempo transaction. */
export const TEMPO_TX_TYPE = 0x76;
/**
 * The type byte of the form a sender's client sends a fee payer: the `0x76` list with the sender's 20-byte address in
 * the fee payer's slot, item 11 (ox 0.14.54 `tempo/TxEnvelopeTempo.js:15`, `feePayerMagic`, and `serialize` with
 * `format: "feePayer"`, `:374-448`), which a stock signer sends where the challenge has the fee paid for the sender.
 */
export const TEMPO_FEE_PAYER_TX_TYPE = 0x78;
const MAX_WIRE_BYTES = 65_536;
const MAX_WIRE_DEPTH = 8;
/** Envelope positions: calls, valid_before, fee_token and fee_payer_signature. */
export const CALLS = 4;
export const VALID_BEFORE = 8;
const FEE_TOKEN = 10;
const FEE_PAYER_SIGNATURE = 11;
const AUTHORIZATION_LIST = 12;
const UINT_FIELDS = [0, 1, 2, 3, 6, 7, 8, 9] as const;

/** Tempo's signature lengths and type bytes (tempoxyz/tempo, `tt_signature.rs`). */
const SECP256K1_LENGTH = 65;
const P256_LENGTH = 129;
const WEBAUTHN_MIN = 128;
const WEBAUTHN_MAX = 2048;
const P256 = 0x01;
const WEBAUTHN = 0x02;
const KEYCHAIN_V1 = 0x03;
const KEYCHAIN_V2 = 0x04;
/** A configurable account's signature (Tempo T14): `0x05` ‖ rlp([account, config, approvals]). */
const CONFIGURABLE = 0x05;
/** The most owner approvals a configurable account signature carries, as read here. */
const MAX_OWNER_APPROVALS = 8;

/**
 * The envelope's items: `0x76` or `0x78`, then an RLP list of 14 items (13 fields and the sender's signature), or 15
 * when a key authorization precedes the signature. A `0x78` envelope's item 11 is a 20-byte address, the sender's. At
 * most 64 KiB and RLP depth 8.
 */
export function decodeEnvelope(wire: unknown): RlpItem[] | Refusal {
  if (!(wire instanceof Uint8Array)) return refusal("tempo/tx-malformed");
  if (wire.length > MAX_WIRE_BYTES) return refusal("tempo/tx-too-large");
  if (wire.length < 2 || (wire[0] !== TEMPO_TX_TYPE && wire[0] !== TEMPO_FEE_PAYER_TX_TYPE)) return refusal("tempo/tx-malformed");
  const top = rlpDecode(wire.subarray(1), MAX_WIRE_DEPTH);
  if (top === undefined || top.kind !== "list") return refusal("tempo/tx-malformed");
  const items = top.items;
  if (items.length !== 14 && items.length !== 15) return refusal("tempo/tx-malformed");
  for (const i of UINT_FIELDS) if (rlpUint(items[i]) === undefined) return refusal("tempo/tx-malformed");
  for (const i of [CALLS, 5, AUTHORIZATION_LIST]) if (items[i]!.kind !== "list") return refusal("tempo/tx-malformed");
  if (items[FEE_TOKEN]!.kind !== "bytes") return refusal("tempo/tx-malformed");
  if (items.length === 15 && items[13]!.kind !== "list") return refusal("tempo/tx-malformed");
  if (items[items.length - 1]!.kind !== "bytes") return refusal("tempo/tx-malformed");
  if (wire[0] === TEMPO_FEE_PAYER_TX_TYPE) {
    const slot = items[FEE_PAYER_SIGNATURE]!;
    if (slot.kind !== "bytes" || slot.bytes.length !== 20) return refusal("tempo/tx-malformed");
  }
  return items;
}

/**
 * What the sender signed: `0x76` ‖ rlp(every envelope field before the sender's signature). When a fee payer has
 * signed, or a `0x78` envelope names the sender in the fee payer's slot, `fee_token` is written as `0x80` and that slot
 * as `0x00`, as the sender signed them (ox 0.14.54 `tempo/TxEnvelopeTempo.js:479-489`, `encodeForSigning`).
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
 * The account a configurable account signature names: `0x05` ‖ rlp([account, config, approvals]), the account 20 bytes
 * not all zero, the config a list, the approvals one to eight byte strings, each a primitive signature by its form (65
 * bytes; `0x01` and 129 bytes; `0x02` and 128 to 2,048 bytes). Any other form is `tempo/tx-malformed`. Tempo's node
 * returns that account as the signer once the owners' approvals reach the embedded config's threshold and the config
 * matches the account's stored commitment (tempoxyz/tempo `f80ab3c7`,
 * `crates/primitives/src/transaction/configurable_account/mod.rs`: `ConfigurableAccountSignature`, `recover_account`,
 * `validate_account_commitment`). Neither the approvals nor the commitment is checked here, as a keychain signature's
 * key is not checked against the account's keychain: the account is the one the signature names, and the node decides
 * whether its owners approved.
 */
function configurableAccount(sig: Uint8Array): Hex | Refusal {
  const bad = refusal("tempo/tx-malformed");
  const top = rlpDecode(sig.subarray(1), MAX_WIRE_DEPTH);
  if (top === undefined || top.kind !== "list" || top.items.length !== 3) return bad;
  const [account, config, approvals] = top.items as [RlpItem, RlpItem, RlpItem];
  if (account.kind !== "bytes" || account.bytes.length !== 20 || account.bytes.every((b) => b === 0)) return bad;
  if (config.kind !== "list" || approvals.kind !== "list") return bad;
  if (approvals.items.length === 0 || approvals.items.length > MAX_OWNER_APPROVALS) return bad;
  for (const a of approvals.items) {
    if (a.kind !== "bytes") return bad;
    const n = a.bytes.length;
    const primitive =
      n === SECP256K1_LENGTH ||
      (a.bytes[0] === P256 && n === 1 + P256_LENGTH) ||
      (a.bytes[0] === WEBAUTHN && n >= 1 + WEBAUTHN_MIN && n <= 1 + WEBAUTHN_MAX);
    if (!primitive) return bad;
  }
  return hexOf(account.bytes);
}

/** The signer of an account signature over `hash`: a primitive signature's signer, or the account a `0x05` names. */
function accountSigner(sig: Uint8Array, hash: Uint8Array): Hex | Refusal {
  return sig.length !== SECP256K1_LENGTH && sig[0] === CONFIGURABLE ? configurableAccount(sig) : primitiveSigner(sig, hash);
}

/**
 * The sender of a signed `0x76` transaction, or of the `0x78` form, as Tempo recovers it from the sender's signature
 * over what the sender signed (`senderSigned`), a `0x78` envelope whose item 11 names another account being
 * `tempo/tx-malformed`: a primitive signature's signer, or for a keychain signature (`0x04`, a 20-byte account and a
 * primitive signature over keccak256(`0x04` ‖ that hash ‖ the account)) that account, or for a configurable account
 * signature (`0x05`, Tempo T14) the account it names (`configurableAccount`). A keychain signature of type
 * `0x03` is `tempo/tx-malformed`: Tempo's transaction specification rejects that format from T1C onward ("Keychain";
 * "Transaction Validation", step 1), and Tempo's node refuses it once T1C is active (tempoxyz/tempo `7d4fd03`,
 * `crates/revm/src/handler.rs`: `validate_version(cfg.spec().is_t1c())`, which answers `LegacyKeychainSignature`), from
 * timestamp 1773327600 on chain 4217 and 1773068400 on chain 42431 (`crates/hardfork/src/constants.rs`,
 * `MAINNET_T1C_TIMESTAMP` and `MODERATO_T1C_TIMESTAMP`). Any other signature is `tempo/tx-malformed`. The `0x05` type
 * is read because Tempo's node includes it once T14 is active ("accounts with multiple signers sign with the `0x05`
 * multisig signature… If you parse or verify Tempo transaction signatures yourself, handle this type", Tempo's T14
 * upgrade notes; scheduled on chain 42431 from 2026-11-24 15:00 UTC and on chain 4217 from 2026-12-08 15:00 UTC); before
 * T14 the node answers it "Unknown signature type identifier", so no such transaction lands.
 */
export function tempoSender(wire: Uint8Array): Hex | Refusal {
  const items = decodeEnvelope(wire);
  if (isRefusal(items)) return items;
  const sender = signerOf(items);
  if (isRefusal(sender) || wire[0] !== TEMPO_FEE_PAYER_TX_TYPE) return sender;
  const named = hexOf((items[FEE_PAYER_SIGNATURE] as Extract<RlpItem, { kind: "bytes" }>).bytes);
  return named.toLowerCase() === sender.toLowerCase() ? sender : refusal("tempo/tx-malformed");
}

/** The sender recovered from the envelope's last item over the bytes the sender signed. */
function signerOf(items: readonly RlpItem[]): Hex | Refusal {
  const sig = (items[items.length - 1] as Extract<RlpItem, { kind: "bytes" }>).bytes;
  const hash = keccak(senderSigned(items));
  if (sig.length !== SECP256K1_LENGTH && sig[0] === KEYCHAIN_V2) {
    const account = sig.subarray(1, 21);
    if (account.length !== 20) return refusal("tempo/tx-malformed");
    const inner = primitiveSigner(sig.subarray(21), keccak(concat([Uint8Array.of(KEYCHAIN_V2), hash, account])));
    return isRefusal(inner) ? inner : hexOf(account);
  }
  return accountSigner(sig, hash);
}

/**
 * The signatures of the envelope's `aa_authorization_list` (item 12), one per entry. Tempo writes each entry as
 * rlp([chain_id, address, nonce, signature]), its signature a Tempo signature as the sender's is (tempoxyz/tempo
 * `7d4fd03`, `crates/primitives/src/transaction/tt_authorization.rs`: `TempoSignedAuthorization`, whose `decode_fields`
 * reads `chain_id`, `address`, `nonce` and `signature` in that order). An entry that is not a list of four items whose
 * fourth is a byte string is `tempo/tx-malformed`, since it holds no signature to read. So is an entry whose signature
 * is a keychain signature of type `0x03`, a length other than 65 bytes and the first byte `0x03`
 * (`crates/primitives/src/transaction/tt_signature.rs`, `TempoSignature::from_bytes`): Tempo's node validates the
 * keychain version of each entry's signature as it validates the sender's, and refuses `0x03` once T1C is active
 * (`crates/revm/src/handler.rs`: "Validate keychain signature version (outer + authorization list)", then
 * `auth.signature().validate_version(cfg.spec().is_t1c())` for each entry, which answers `LegacyKeychainSignature`), as
 * it is on chains 4217 and 42431 (`tempoSender`). No other part of an entry is read.
 */
export function authorizationSignatures(wire: Uint8Array): Uint8Array[] | Refusal {
  const items = decodeEnvelope(wire);
  if (isRefusal(items)) return items;
  const signatures: Uint8Array[] = [];
  for (const entry of (items[AUTHORIZATION_LIST] as Extract<RlpItem, { kind: "list" }>).items) {
    const sig = entry.kind === "list" && entry.items.length === 4 ? entry.items[3]! : undefined;
    if (sig === undefined || sig.kind !== "bytes") return refusal("tempo/tx-malformed");
    if (sig.bytes.length !== SECP256K1_LENGTH && sig.bytes[0] === KEYCHAIN_V1) return refusal("tempo/tx-malformed");
    signatures.push(sig.bytes);
  }
  return signatures;
}

/**
 * The signed key authorization a transaction carries, item 13 of a 15-item envelope, its RLP bytes whole: the
 * authorization and the root key's signature, as `readKeyAuthorization` reads them. None where the envelope holds 14
 * items, and `tempo/tx-malformed` where it does not decode.
 */
export function carriedKeyAuthorization(wire: Uint8Array): Hex | undefined | Refusal {
  const items = decodeEnvelope(wire);
  if (isRefusal(items)) return items;
  return items.length === 15 ? hexOf(items[13]!.raw) : undefined;
}

/**
 * The account whose root key signed a key authorization, rlp([authorization, signature]): the signature's signer over
 * keccak256 of the authorization's bytes as received (`primitiveSigner`), or the account a configurable account
 * signature (`0x05`) names (`configurableAccount`), the digest the root key signs
 * (`KeyAuthorizationUnsigned`). Any other form is `tempo/key-authorization-malformed`.
 */
export function keyAuthorizationSigner(signed: Uint8Array): Hex | Refusal {
  const bad = refusal("tempo/key-authorization-malformed");
  const top = rlpDecode(signed, MAX_WIRE_DEPTH);
  if (top === undefined || top.kind !== "list" || top.items.length !== 2) return bad;
  const [auth, sig] = top.items as [RlpItem, RlpItem];
  if (auth.kind !== "list" || sig.kind !== "bytes") return bad;
  const signer = accountSigner(sig.bytes, keccak(auth.raw));
  return isRefusal(signer) ? bad : (signer.toLowerCase() as Hex);
}
