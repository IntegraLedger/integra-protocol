/**
 * Tempo rail pieces: the `0x76` transaction's calls, the TIP-20 `transferWithMemo` calldata, the TIP-20 channel
 * reserve's descriptor and ids, and the account keychain's key authorizations. Tempo serves eip155 JSON-RPC, so the
 * reader is `EvmReader`. Nothing here throws on a caller's value; refusals are values.
 */
import {
  addressWord,
  bytes32Word,
  bytesOf,
  concat,
  hexOf,
  keccakHex,
  uintWord,
  type Hex,
} from "./evm-abi.js";
import type { EvmReader, EvmReceipt } from "./evm.js";
import { readReceipt } from "./receipt.js";
import { isAddress, normalHash } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import { rlpBytes, rlpDecode, rlpList, rlpUint, rlpUintBytes, type RlpItem } from "./rlp.js";
import type { AtrHash } from "./core.js";
import type { MppCredential } from "./mpp-challenge.js";

export { RECEIVE_POLICY_GUARD } from "./evm.js";

/** The first four bytes of keccak256("transferWithMemo(address,uint256,bytes32)"). */
export const TRANSFER_WITH_MEMO_SELECTOR = "0x95777d59" as const;
/** keccak256("TransferWithMemo(address,address,uint256,bytes32)") */
export const TRANSFER_WITH_MEMO_TOPIC = "0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0" as const;
/** The TIP-20 channel reserve precompile. */
export const TIP20_CHANNEL_RESERVE = "0x4d50500000000000000000000000000000000000" as const;
/** The account keychain precompile. */
export const ACCOUNT_KEYCHAIN = "0xaaaaaaaa00000000000000000000000000000000" as const;
/** open(address,address,address,uint96,bytes32,address) */
export const OPEN_V2_SELECTOR = "0xedc53b00" as const;
/** open(address,address,uint128,bytes32,address) */
export const OPEN_V1_SELECTOR = "0xc79ea485" as const;
/** ChannelOpened(bytes32,address,address,address,address,address,bytes32,bytes32,uint96) */
export const CHANNEL_OPENED_V2_TOPIC = "0xdebaba36f0e9c7978f536fed432d9360b1f9646d7ca88531c34c3eae43f154a7" as const;
/** ChannelOpened(bytes32,address,address,address,address,uint256) */
export const CHANNEL_OPENED_V1_TOPIC = "0x4516edb7b2ea29d92a0dbb5ff857203558b677157f4115d582b66e07b90ac8a8" as const;
/** ChannelClosed(bytes32,address,address,uint96,uint96) */
export const CHANNEL_CLOSED_V2_TOPIC = "0x5613aed96d5bf39f928408dbe1d4143490b9bb5957eac2dd8e69b5dc4b2206e6" as const;
/** ChannelClosed(bytes32,address,address,uint256,uint256), the v1 escrow's event. */
export const CHANNEL_CLOSED_V1_TOPIC = "0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51" as const;
/** KeyAuthorizationWitness(address,bytes32) */
export const KEY_AUTHORIZATION_WITNESS_TOPIC =
  "0x1f09d8956d18ea185372a3f7f40aca24bb45f303920c37c5f0605f4871da41f6" as const;
/** KeyRevoked(address,address) */
export const KEY_REVOKED_TOPIC = "0x14ce4f0c8c12936436b733974fb13d10fc13e8c41c06dc8e19d82001c93d7989" as const;
/** KeyAuthorized(address,address,uint8,uint64): the account and the key id are topics 1 and 2. */
export const KEY_AUTHORIZED_TOPIC = "0x7c46af0758d3eca5e8195833bff1e5153f6249fc0f2968a878fd28544315a03c" as const;
/**
 * AccessKeySpend(address,address,address,uint256,uint256): the account, the key id and the token are topics 1 to 3; the
 * keychain emits it for each spend an access key with enforced limits makes against its limit.
 */
export const ACCESS_KEY_SPEND_TOPIC = "0xe0815e3aaadddf4dd75bde97fc060f0c38afe18e87a169be86a3f5c28247f192" as const;

/** The type byte of a Tempo transaction. */
const TEMPO_TX_TYPE = 0x76;
const MAX_WIRE_BYTES = 65_536;
const MAX_WIRE_DEPTH = 8;
const MAX_CALLS = 64;
const MAX_KEY_AUTHORIZATION_BYTES = 8192;
const MAX_KEY_AUTHORIZATION_DEPTH = 6;
const MAX_SCOPES = 16;
/** Envelope positions: calls, valid_before, fee_token and fee_payer_signature. */
const CALLS = 4;
const VALID_BEFORE = 8;
const FEE_TOKEN = 10;
const FEE_PAYER_SIGNATURE = 11;
const UINT_FIELDS = [0, 1, 2, 3, 6, 7, 8, 9] as const;

export interface TempoCall {
  to: Hex | null;
  value: bigint;
  input: Uint8Array;
}

/**
 * The envelope's items: `0x76`, then an RLP list of 14 items (13 fields and the sender's signature), or 15 when a
 * key authorization precedes the signature. At most 64 KiB, RLP depth 8 and 64 calls.
 */
function decodeEnvelope(wire: unknown): RlpItem[] | Refusal {
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
 * The chain id, the calls and `valid_before` of a signed `0x76` transaction. Each call is `rlp([to, value, input])`,
 * with an empty `to` read as null. `valid_before` written empty is null.
 */
export function decodeTempoTx(
  wire: Uint8Array,
): { chainId: bigint; calls: TempoCall[]; validBefore: bigint | null } | Refusal {
  const items = decodeEnvelope(wire);
  if (isRefusal(items)) return items;
  const callList = items[CALLS] as Extract<RlpItem, { kind: "list" }>;
  if (callList.items.length > MAX_CALLS) return refusal("tempo/tx-malformed");
  const calls: TempoCall[] = [];
  for (const c of callList.items) {
    if (c.kind !== "list" || c.items.length !== 3) return refusal("tempo/tx-malformed");
    const [to, value, input] = c.items as [RlpItem, RlpItem, RlpItem];
    const v = rlpUint(value);
    if (to.kind !== "bytes" || input.kind !== "bytes" || v === undefined) return refusal("tempo/tx-malformed");
    if (to.bytes.length !== 0 && to.bytes.length !== 20) return refusal("tempo/tx-malformed");
    calls.push({ to: to.bytes.length === 0 ? null : hexOf(to.bytes), value: v, input: input.bytes.slice() });
  }
  const validBeforeItem = items[VALID_BEFORE] as Extract<RlpItem, { kind: "bytes" }>;
  return {
    chainId: rlpUint(items[0])!,
    calls,
    validBefore: validBeforeItem.bytes.length === 0 ? null : rlpUint(validBeforeItem)!,
  };
}

/** `transferWithMemo(to, amount, memo)` calldata: the selector, then the three 32-byte words. */
export function memoCalldata(to: Hex, amount: bigint, memo: Hex): Hex | Refusal {
  const m = normalHash(memo);
  if (!isAddress(to) || !isUint(amount, 256n) || m === null) return refusal("tempo/tx-malformed");
  return hexOf(concat([bytesOf(TRANSFER_WITH_MEMO_SELECTOR)!, addressWord(to), uintWord(amount), bytes32Word(m)]));
}

export interface TempoDescriptor {
  payer: Hex;
  payee: Hex;
  operator: Hex;
  token: Hex;
  salt: Hex;
  authorizedSigner: Hex;
  expiringNonceHash: Hex;
}

/**
 * The TIP-20 channel reserve's channel id: keccak256(abi.encode(payer, payee, operator, token, salt,
 * authorizedSigner, expiringNonceHash, escrow, chainId)).
 */
export function tempoChannelId(d: TempoDescriptor & { escrow: Hex; chainId: number }): Hex | Refusal {
  if (typeof d !== "object" || d === null) return refusal("tempo/descriptor-mismatch");
  const salt = normalHash(d.salt);
  const nonceHash = normalHash(d.expiringNonceHash);
  for (const a of [d.payer, d.payee, d.operator, d.token, d.authorizedSigner, d.escrow]) {
    if (!isAddress(a)) return refusal("tempo/descriptor-mismatch");
  }
  if (salt === null || nonceHash === null || !Number.isSafeInteger(d.chainId) || d.chainId <= 0) {
    return refusal("tempo/descriptor-mismatch");
  }
  return keccakHex(
    concat([
      addressWord(d.payer),
      addressWord(d.payee),
      addressWord(d.operator),
      addressWord(d.token),
      bytes32Word(salt),
      addressWord(d.authorizedSigner),
      bytes32Word(nonceHash),
      addressWord(d.escrow),
      uintWord(BigInt(d.chainId)),
    ]),
  );
}

/**
 * keccak256(`0x76` ‖ rlp(every envelope field before the sender's signature) ‖ sender). When a fee payer has signed,
 * `fee_token` is written as `0x80` and the fee payer's signature as `0x00`, as the sender signed them.
 */
export function expiringNonceHash(signedTx: Uint8Array, sender: Hex): Hex | Refusal {
  const items = decodeEnvelope(signedTx);
  if (isRefusal(items)) return items;
  if (!isAddress(sender)) return refusal("tempo/tx-malformed");
  const fields = items.slice(0, -1).map((i) => i.raw);
  const feePayerSigned = !(items[FEE_PAYER_SIGNATURE]!.kind === "bytes" && items[FEE_PAYER_SIGNATURE]!.raw.length === 1 &&
    items[FEE_PAYER_SIGNATURE]!.raw[0] === 0x80);
  if (feePayerSigned) {
    fields[FEE_TOKEN] = Uint8Array.of(0x80);
    fields[FEE_PAYER_SIGNATURE] = Uint8Array.of(0x00);
  }
  return keccakHex(concat([Uint8Array.of(TEMPO_TX_TYPE), rlpList(fields), bytesOf(sender)!]));
}

export interface TempoKeyAuthorization {
  chainId: bigint;
  keyType: 0 | 1 | 2;
  keyId: Hex;
  expiry: bigint;
  limits: { token: Hex; limit: bigint; period: bigint }[];
  allowedCalls: { target: Hex; selectorRules: { selector: Hex; recipients: Hex[] }[] }[];
  witness: Hex;
}

export interface KeyAuthorizationUnsigned {
  /** `digest` is keccak256(rlp(authorization)); the root key signs it. */
  request: { kind: "tempo-key-authorization"; authorization: TempoKeyAuthorization; digest: Hex };
  complete(rootSignature: Hex): MppCredential | Refusal;
}

/**
 * rlp([chain_id, key_type, key_id, expiry, limits, allowed_calls, witness]); with a signature,
 * rlp([that list, signature]). At most 16 limits and 16 scopes, 16 selector rules each and 16 recipients each.
 */
export function encodeKeyAuthorization(a: TempoKeyAuthorization, signature?: Hex): Uint8Array | Refusal {
  const bad = refusal("tempo/key-authorization-malformed");
  if (typeof a !== "object" || a === null) return bad;
  const witness = normalHash(a.witness);
  if (!isUint(a.chainId, 64n) || !isUint(a.expiry, 64n) || witness === null || !isAddress(a.keyId)) return bad;
  if (a.keyType !== 0 && a.keyType !== 1 && a.keyType !== 2) return bad;
  if (!Array.isArray(a.limits) || a.limits.length > MAX_SCOPES) return bad;
  if (!Array.isArray(a.allowedCalls) || a.allowedCalls.length > MAX_SCOPES) return bad;
  const limits: Uint8Array[] = [];
  for (const l of a.limits) {
    if (!isAddress(l.token) || !isUint(l.limit, 256n) || !isUint(l.period, 64n)) return bad;
    limits.push(rlpList([rlpBytes(bytesOf(l.token)!), rlpUintBytes(l.limit), rlpUintBytes(l.period)]));
  }
  const scopes: Uint8Array[] = [];
  for (const s of a.allowedCalls) {
    if (!isAddress(s.target) || !Array.isArray(s.selectorRules) || s.selectorRules.length > MAX_SCOPES) return bad;
    const rules: Uint8Array[] = [];
    for (const r of s.selectorRules) {
      const selector = bytesOf(r.selector, 4);
      if (selector === undefined || selector.length !== 4) return bad;
      if (!Array.isArray(r.recipients) || r.recipients.length > MAX_SCOPES || !r.recipients.every(isAddress)) return bad;
      rules.push(rlpList([rlpBytes(selector), rlpList(r.recipients.map((x) => rlpBytes(bytesOf(x)!)))]));
    }
    scopes.push(rlpList([rlpBytes(bytesOf(s.target)!), rlpList(rules)]));
  }
  const authorization = rlpList([
    rlpUintBytes(a.chainId),
    rlpUintBytes(BigInt(a.keyType)),
    rlpBytes(bytesOf(a.keyId)!),
    rlpUintBytes(a.expiry),
    rlpList(limits),
    rlpList(scopes),
    rlpBytes(bytesOf(witness)!),
  ]);
  if (authorization.length > MAX_KEY_AUTHORIZATION_BYTES) return bad;
  if (signature === undefined) return authorization;
  const sig = bytesOf(signature, MAX_KEY_AUTHORIZATION_BYTES);
  if (sig === undefined || sig.length === 0) return bad;
  const signed = rlpList([authorization, rlpBytes(sig)]);
  return signed.length > MAX_KEY_AUTHORIZATION_BYTES ? bad : signed;
}

/**
 * Reads a signed key authorization: an RLP list of the authorization (3 to 9 items) and a byte-string signature. The
 * digest is keccak256 over the authorization's bytes as received. The witness is item 6, 32 bytes, when present.
 */
export function decodeKeyAuthorization(signed: Hex): { witness?: Hex; digest: Hex; keyId: Hex } | Refusal {
  const bad = refusal("tempo/key-authorization-malformed");
  const b = bytesOf(signed, MAX_KEY_AUTHORIZATION_BYTES);
  if (b === undefined) return bad;
  const top = rlpDecode(b, MAX_KEY_AUTHORIZATION_DEPTH);
  if (top === undefined || top.kind !== "list" || top.items.length !== 2) return bad;
  const [auth, sig] = top.items as [RlpItem, RlpItem];
  if (auth.kind !== "list" || sig.kind !== "bytes" || auth.items.length < 3 || auth.items.length > 9) return bad;
  const keyId = auth.items[2]!;
  if (keyId.kind !== "bytes" || keyId.bytes.length !== 20) return bad;
  if (rlpUint(auth.items[0]) === undefined || rlpUint(auth.items[1]) === undefined) return bad;
  for (const i of [4, 5]) {
    const l = auth.items[i];
    if (l !== undefined && !withinScopes(l, i === 5)) return bad;
  }
  const w = auth.items[6];
  let witness: Hex | undefined;
  if (w !== undefined) {
    if (w.kind !== "bytes" || (w.bytes.length !== 0 && w.bytes.length !== 32)) return bad;
    if (w.bytes.length === 32) witness = hexOf(w.bytes);
  }
  const digest = keccakHex(auth.raw);
  return witness === undefined ? { digest, keyId: hexOf(keyId.bytes) } : { witness, digest, keyId: hexOf(keyId.bytes) };
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

/**
 * Reads the transaction's receipt and returns topic 2 of its one `KeyAuthorizationWitness` log from the account
 * keychain. One call.
 */
export async function witnessRecover(
  ref: { network: string; transaction: Hex },
  reader: EvmReader,
): Promise<AtrHash | Refusal> {
  const receipt = await readReceipt(ref.network, ref.transaction, reader);
  if (isRefusal(receipt)) return receipt;
  const witnesses: Hex[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ACCOUNT_KEYCHAIN.toLowerCase()) continue;
    if (log.topics.length !== 3 || normalHash(log.topics[0]) !== KEY_AUTHORIZATION_WITNESS_TOPIC) continue;
    const w = normalHash(log.topics[2]);
    if (w === null) return refusal("tempo/unreadable");
    witnesses.push(w);
  }
  if (witnesses.length === 0) return refusal("tempo/no-witness");
  if (witnesses.length > 1) return refusal("tempo/ambiguous");
  return witnesses[0]!;
}

/**
 * The account for which a receipt's key authorization carried witness `h` and registered `keyId`: topic 1 of the
 * account keychain's `KeyAuthorizationWitness` logs whose topic 2 is `h`, when the keychain's `KeyAuthorized` log in
 * the same receipt names that account and `keyId`. The receipt's status is not read: the authorization is applied
 * before the transaction's calls run.
 */
export function keyAccount(receipt: EvmReceipt, h: AtrHash, keyId: Hex): Hex | Refusal {
  const witness = normalHash(h);
  if (witness === null || !isAddress(keyId) || typeof receipt !== "object" || receipt === null || !Array.isArray(receipt.logs)) {
    return refusal("tempo/unreadable");
  }
  const fromKeychain = receipt.logs.filter(
    (l) => typeof l === "object" && l !== null && typeof l.address === "string" && l.address.toLowerCase() === ACCOUNT_KEYCHAIN &&
      Array.isArray(l.topics) && l.topics.length === 3,
  );
  const accounts = new Set<string>();
  for (const l of fromKeychain) {
    if (normalHash(l.topics[0]) === KEY_AUTHORIZATION_WITNESS_TOPIC && normalHash(l.topics[2]) === witness) {
      const a = normalHash(l.topics[1]);
      if (a === null || !a.startsWith(`0x${"0".repeat(24)}`)) return refusal("tempo/unreadable");
      accounts.add(a);
    }
  }
  if (accounts.size === 0) return refusal("tempo/no-witness");
  if (accounts.size > 1) return refusal("tempo/ambiguous");
  const account = [...accounts][0]!;
  const key = hexOf(addressWord(keyId));
  const registered = fromKeychain.some(
    (l) => normalHash(l.topics[0]) === KEY_AUTHORIZED_TOPIC && normalHash(l.topics[1]) === account && normalHash(l.topics[2]) === key,
  );
  return registered ? (`0x${account.slice(26)}` as Hex) : refusal("tempo/key-not-authorized");
}

function isUint(v: unknown, bits: bigint): v is bigint {
  return typeof v === "bigint" && v >= 0n && v < 1n << bits;
}

