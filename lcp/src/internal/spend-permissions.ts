/**
 * The Spend Permission exchange's pieces, as the profile `spend-permissions/eip155` states them: the permission's wire
 * form and its checks, the manager's own refusals, the permission's hash as the SpendPermissionManager's `getHash`
 * computes it, the ABI encodings of its calls and events, and the read of the approval by the permission's hash over
 * `statusOf`. Pure but for the read, which goes through the reader the caller supplies.
 */
import type { AtrHash } from "./core.js";
import { addressWord, bytesOf, concat, hexOf, keccak, keccakHex, uintOf, uintWord, wordAt, type Hex } from "../evm-abi.js";
import { chainIdOf, isAddress, isObject, normalHash } from "../fields.js";
import { MAX_SIGNATURE_BYTES } from "./bounds.js";
import { isLog, isReceipt, rejected, readerFault, type Eip155, type EvmReader } from "./evm.js";
import {
  callsIn,
  partyOf,
  same,
  statusOf,
  type Classified,
  type EvmReadRefBase,
  type ReadSpec,
  type SeenEvm,
  type Signed,
  type TxView,
} from "./evm-x402.js";
import type { UnreadableReason } from "./read.js";

// ── The permission.

/**
 * A Spend Permission as the exchange writes it: its nine members, each integer a string of decimal digits with no sign
 * and no leading zero, each address `0x` and 40 hex digits, `extraData` `0x` and an even number of hex digits.
 */
export interface SpendPermission {
  readonly account: Hex;
  readonly spender: Hex;
  readonly token: Hex;
  /** A uint160. */
  readonly allowance: string;
  /** A uint48, in seconds. */
  readonly period: string;
  /** A uint48, a Unix time in seconds. */
  readonly start: string;
  /** A uint48, a Unix time in seconds. */
  readonly end: string;
  /** A uint256: H, as a decimal. */
  readonly salt: string;
  readonly extraData: Hex;
}

/** The permission as the offer writes it: every member but `account`. */
export type OfferedPermission = Omit<SpendPermission, "account">;

/** A permission read: addresses lowercase, integers as bigints, `extraData` as bytes. */
export interface Permission {
  readonly account?: Hex;
  readonly spender: Hex;
  readonly token: Hex;
  readonly allowance: bigint;
  readonly period: bigint;
  readonly start: bigint;
  readonly end: bigint;
  readonly salt: bigint;
  readonly extraData: Uint8Array;
}

/** A permission read with its `account`. */
export type WholePermission = Permission & { readonly account: Hex };

const MEMBERS = ["spender", "token", "allowance", "period", "start", "end", "salt", "extraData"] as const;
const DECIMAL = /^(0|[1-9][0-9]{0,77})$/;
const UINT48 = (1n << 48n) - 1n;
const UINT160 = (1n << 160n) - 1n;
const UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS: Hex = `0x${"00".repeat(20)}`;

/** A decimal string with no sign and no leading zero, at most `max`, as a bigint; undefined for anything else. */
function decimalOf(v: unknown, max: bigint): bigint | undefined {
  if (typeof v !== "string" || !DECIMAL.test(v)) return undefined;
  const n = BigInt(v);
  return n <= max ? n : undefined;
}

/**
 * A permission in the exchange's wire form, with `account` where `withAccount` is true and without it otherwise, and
 * no other member; undefined for anything else.
 */
export function permissionOf(v: unknown, withAccount: true): WholePermission | undefined;
export function permissionOf(v: unknown, withAccount: false): Permission | undefined;
export function permissionOf(v: unknown, withAccount: boolean): Permission | undefined {
  if (!isObject(v)) return undefined;
  const names: readonly string[] = withAccount ? ["account", ...MEMBERS] : MEMBERS;
  const keys = Object.keys(v);
  if (keys.length !== names.length || !keys.every((k) => names.includes(k))) return undefined;
  const { account, spender, token, allowance, period, start, end, salt, extraData } = v;
  if ((withAccount && !isAddress(account)) || !isAddress(spender) || !isAddress(token)) return undefined;
  const a = decimalOf(allowance, UINT160);
  const p = decimalOf(period, UINT48);
  const s = decimalOf(start, UINT48);
  const e = decimalOf(end, UINT48);
  const n = decimalOf(salt, UINT256);
  const x = bytesOf(extraData);
  if (a === undefined || p === undefined || s === undefined || e === undefined || n === undefined || x === undefined) return undefined;
  return {
    ...(withAccount ? { account: (account as string).toLowerCase() as Hex } : {}),
    spender: spender.toLowerCase() as Hex,
    token: token.toLowerCase() as Hex,
    allowance: a,
    period: p,
    start: s,
    end: e,
    salt: n,
    extraData: x,
  };
}

/** The permission in the exchange's wire form, `account` first where it has one. */
export function wirePermission(p: WholePermission): SpendPermission;
export function wirePermission(p: Permission): OfferedPermission;
export function wirePermission(p: Permission): OfferedPermission | SpendPermission {
  return {
    ...(p.account === undefined ? {} : { account: p.account }),
    spender: p.spender,
    token: p.token,
    allowance: p.allowance.toString(),
    period: p.period.toString(),
    start: p.start.toString(),
    end: p.end.toString(),
    salt: p.salt.toString(),
    extraData: hexOf(p.extraData),
  };
}

/**
 * Whether the manager refuses the permission, so that every approval of it reverts (`_approve`): a zero `token` or
 * `spender`, a zero `period` or `allowance`, or a `start` not before `end`. Whether `token` is an ERC-721 contract is
 * not read.
 */
export function managerRefuses(p: Permission): boolean {
  return (
    p.token === ZERO_ADDRESS || p.spender === ZERO_ADDRESS || p.period === 0n || p.allowance === 0n || p.start >= p.end
  );
}

/** The salt as a 32-byte hash, the way H is written. */
export function saltHash(p: Permission): AtrHash {
  return hexOf(uintWord(p.salt)) as AtrHash;
}

// ── The manager's hash, calls and events.

/** keccak256 of the manager's `SpendPermission` type (`SPEND_PERMISSION_TYPEHASH`). */
export const SPEND_PERMISSION_TYPEHASH = keccakHex(
  "SpendPermission(address account,address spender,address token,uint160 allowance,uint48 period,uint48 start,uint48 end,uint256 salt,bytes extraData)",
);
/** The manager's EIP-712 domain name and version. */
export const SPEND_PERMISSION_DOMAIN = Object.freeze({ name: "Spend Permission Manager", version: "1" } as const);
const DOMAIN_TYPEHASH = keccak("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

const TUPLE = "(address,address,address,uint160,uint48,uint48,uint48,uint256,bytes)";
const selector = (signature: string): Hex => hexOf(keccak(signature).subarray(0, 4));
/** `approve(SpendPermission)`. */
export const APPROVE_SELECTOR = selector(`approve(${TUPLE})`);
/** `approveWithSignature(SpendPermission,bytes)`. */
export const APPROVE_WITH_SIGNATURE_SELECTOR = selector(`approveWithSignature(${TUPLE},bytes)`);
/** `isApproved(SpendPermission)`. */
export const IS_APPROVED_SELECTOR = selector(`isApproved(${TUPLE})`);
/** `isRevoked(SpendPermission)`. */
export const IS_REVOKED_SELECTOR = selector(`isRevoked(${TUPLE})`);
const REVOKE_SELECTOR = selector(`revoke(${TUPLE})`);
const REVOKE_AS_SPENDER_SELECTOR = selector(`revokeAsSpender(${TUPLE})`);
const APPROVE_WITH_REVOKE_SELECTOR = selector(`approveWithRevoke(${TUPLE},${TUPLE},(uint48,uint48,uint160))`);
/** `SpendPermissionApproved(bytes32,SpendPermission)`'s topic. */
export const SPEND_PERMISSION_APPROVED_TOPIC = keccakHex(`SpendPermissionApproved(bytes32,${TUPLE})`);
/** `SpendPermissionRevoked(bytes32,SpendPermission)`'s topic. */
export const SPEND_PERMISSION_REVOKED_TOPIC = keccakHex(`SpendPermissionRevoked(bytes32,${TUPLE})`);

/** The manager's EIP-712 domain separator on `chainId` at `manager`. */
function domainSeparator(chainId: number, manager: Hex): Uint8Array {
  return keccak(
    concat([
      DOMAIN_TYPEHASH,
      keccak(SPEND_PERMISSION_DOMAIN.name),
      keccak(SPEND_PERMISSION_DOMAIN.version),
      uintWord(BigInt(chainId)),
      addressWord(manager),
    ]),
  );
}

/** The permission's hash, as the manager's `getHash` computes it on `chainId` at `manager`: the digest the account signs. */
export function hashOf(p: WholePermission, chainId: number, manager: Hex): Hex {
  const struct = keccak(
    concat([
      bytesOf(SPEND_PERMISSION_TYPEHASH)!,
      addressWord(p.account),
      addressWord(p.spender),
      addressWord(p.token),
      uintWord(p.allowance),
      uintWord(p.period),
      uintWord(p.start),
      uintWord(p.end),
      uintWord(p.salt),
      keccak(p.extraData),
    ]),
  );
  return keccakHex(concat([new Uint8Array([0x19, 0x01]), domainSeparator(chainId, manager), struct]));
}

/** The ABI encoding of the permission as a tuple: its nine head words, then `extraData`'s length and padded bytes. */
function tupleOf(p: WholePermission): Uint8Array {
  const pad = (32 - (p.extraData.length % 32)) % 32;
  return concat([
    addressWord(p.account),
    addressWord(p.spender),
    addressWord(p.token),
    uintWord(p.allowance),
    uintWord(p.period),
    uintWord(p.start),
    uintWord(p.end),
    uintWord(p.salt),
    uintWord(9n * 32n),
    uintWord(BigInt(p.extraData.length)),
    p.extraData,
    new Uint8Array(pad),
  ]);
}

/** A call of the manager whose one argument is the permission: `approve`, `isApproved` or `isRevoked`. */
export function permissionCall(selectorHex: Hex, p: WholePermission): Hex {
  return hexOf(concat([bytesOf(selectorHex)!, uintWord(32n), tupleOf(p)]));
}

/** Whether every byte of `b` from `from` to `to` is zero. */
function zeros(b: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (b[i] !== 0) return false;
  return true;
}

/**
 * The permission whose tuple starts at byte `at` of `b`, its `extraData` at the offset its ninth word gives from `at`,
 * each word within its type's width; with where its encoding ends. Undefined where it does not decode.
 */
function tupleAt(b: Uint8Array, at: number): { p: WholePermission; end: number } | undefined {
  if (!Number.isSafeInteger(at) || at < 0 || at + 9 * 32 > b.length) return undefined;
  const t = b.subarray(at);
  const w = Array.from({ length: 9 }, (_, i) => wordAt(t, i)!);
  const address = (x: Uint8Array): Hex | undefined => (zeros(x, 0, 12) ? hexOf(x.subarray(12)) : undefined);
  const account = address(w[0]!);
  const spender = address(w[1]!);
  const token = address(w[2]!);
  if (account === undefined || spender === undefined || token === undefined) return undefined;
  if (!zeros(w[3]!, 0, 12) || !zeros(w[4]!, 0, 26) || !zeros(w[5]!, 0, 26) || !zeros(w[6]!, 0, 26)) return undefined;
  const off = uintOf(w[8]!);
  if (off > BigInt(t.length - 32)) return undefined;
  const lenAt = Number(off);
  const len = uintOf(t.subarray(lenAt, lenAt + 32));
  const dataAt = lenAt + 32;
  if (len > BigInt(t.length - dataAt)) return undefined;
  const n = Number(len);
  const padded = n + ((32 - (n % 32)) % 32);
  if (dataAt + padded > t.length || !zeros(t, dataAt + n, dataAt + padded)) return undefined;
  return {
    p: {
      account,
      spender,
      token,
      allowance: uintOf(w[3]!),
      period: uintOf(w[4]!),
      start: uintOf(w[5]!),
      end: uintOf(w[6]!),
      salt: uintOf(w[7]!),
      extraData: t.slice(dataAt, dataAt + n),
    },
    end: at + dataAt + padded,
  };
}

/**
 * The permission an approval or revocation event's data holds, `abi.encode` of the struct: one offset word of 32, the
 * tuple with `extraData` right after its head, and nothing after it. Undefined for anything else.
 */
export function eventPermission(data: unknown): WholePermission | undefined {
  const b = bytesOf(data);
  if (b === undefined || b.length < 32 || uintOf(b.subarray(0, 32)) !== 32n) return undefined;
  const t = tupleAt(b, 32);
  if (t === undefined || t.end !== b.length || uintOf(b.subarray(32 + 8 * 32, 32 + 9 * 32)) !== 9n * 32n) return undefined;
  return t.p;
}

/** True where two permissions with their accounts are member by member equal. */
function samePermission(a: WholePermission, b: WholePermission): boolean {
  return (
    a.account === b.account &&
    a.spender === b.spender &&
    a.token === b.token &&
    a.allowance === b.allowance &&
    a.period === b.period &&
    a.start === b.start &&
    a.end === b.end &&
    a.salt === b.salt &&
    hexOf(a.extraData) === hexOf(b.extraData)
  );
}

// ── The return, as presented.

/** The route the account's act took: its signature, or its own transaction. */
export type SpendPermissionRoute = "signature" | "transaction";

/** The return a `Spend-Permission` header carries, read: the network, the manager, the whole permission, and the route. */
export interface ReturnRead {
  readonly network: Eip155;
  readonly chainId: number;
  readonly manager: Hex;
  readonly permission: WholePermission;
  readonly route: SpendPermissionRoute;
  /** On `signature`, the signature's bytes in hex, lowercase. */
  readonly signature?: Hex;
  /** On `transaction`, the transaction's hash, lowercase. */
  readonly transaction?: Hex;
}

/**
 * A return as rule 8 of the profile states it: `network`, `manager`, the whole `permission`, and exactly one of
 * `signature` (1 to `MAX_SIGNATURE_BYTES` bytes of hex) and `transaction` (a 32-byte hash), and no other member.
 * Undefined where its shape is not that; `signature` where only its signature is malformed.
 */
export function returnOf(v: unknown): ReturnRead | undefined | "signature" {
  if (!isObject(v)) return undefined;
  const keys = Object.keys(v);
  const route: SpendPermissionRoute | undefined =
    keys.includes("signature") && !keys.includes("transaction")
      ? "signature"
      : keys.includes("transaction") && !keys.includes("signature")
        ? "transaction"
        : undefined;
  if (route === undefined || keys.length !== 4 || !["network", "manager", "permission", route].every((k) => keys.includes(k))) {
    return undefined;
  }
  const chainId = chainIdOf(v["network"]);
  if (chainId === undefined || !isAddress(v["manager"])) return undefined;
  const permission = permissionOf(v["permission"], true);
  if (permission === undefined) return undefined;
  const base = { network: v["network"] as Eip155, chainId, manager: (v["manager"] as string).toLowerCase() as Hex, permission, route };
  if (route === "transaction") {
    const t = normalHash(v["transaction"]);
    return t === null ? undefined : { ...base, transaction: t as Hex };
  }
  const s = bytesOf(v["signature"], MAX_SIGNATURE_BYTES);
  if (s === undefined || s.length === 0) return "signature";
  return { ...base, signature: hexOf(s) };
}

// ── The read.

/** The reference the read takes: the option's payee is the permission's `spender`. */
export interface SpendPermissionRef extends EvmReadRefBase {
  readonly network: Eip155;
  /** H, the permission's `salt`. */
  readonly h: AtrHash;
  /** The SpendPermissionManager the permission is approved on. */
  readonly manager: Hex;
  /** The permission's hash, the search key. */
  readonly hash: Hex;
  /** The permission whole, as presented: the members `presented` compares, and the argument of the value's two reads. */
  readonly permission: SpendPermission;
}

function isRef(r: unknown): r is SpendPermissionRef {
  return (
    isObject(r) &&
    chainIdOf(r["network"]) !== undefined &&
    isAddress(r["payee"]) &&
    isAddress(r["manager"]) &&
    normalHash(r["h"]) !== null &&
    normalHash(r["hash"]) !== null &&
    permissionOf(r["permission"], true) !== undefined
  );
}

/** The permission's members as the read compares them: the wire form, lowercase. */
function signedOf(p: WholePermission): Signed {
  return { ...wirePermission(p) };
}

/** The reference's permission, read; the reference has passed `isRef`. */
function refPermission(ref: SpendPermissionRef): WholePermission {
  return permissionOf(ref.permission, true)!;
}

/** A boolean an `eth_call` answers: one word of 0 or 1. */
async function callBool(reader: EvmReader, to: Hex, data: Hex, block: bigint): Promise<boolean | { unreadable: UnreadableReason }> {
  let answer: unknown;
  try {
    answer = await reader.call(to, data, block);
  } catch (e) {
    return { unreadable: rejected(e) };
  }
  const w = bytesOf(answer, 32);
  if (w === undefined || w.length !== 32) return { unreadable: "unparseable" };
  const v = uintOf(w);
  return v <= 1n ? v === 1n : { unreadable: "unparseable" };
}

/** Whether the manager reads the permission approved or revoked in the state after `block`: the value consumed. */
async function consumedAt(ref: SpendPermissionRef, reader: EvmReader, block: bigint): Promise<boolean | { unreadable: UnreadableReason }> {
  const p = refPermission(ref);
  const approved = await callBool(reader, ref.manager, permissionCall(IS_APPROVED_SELECTOR, p), block);
  if (typeof approved !== "boolean" || approved) return approved;
  return callBool(reader, ref.manager, permissionCall(IS_REVOKED_SELECTOR, p), block);
}

/**
 * Who revoked the permission in a transaction: the account where its input holds the manager's `revoke` or
 * `approveWithRevoke` revoking it, the spender where it holds `revokeAsSpender`'s; undefined where it holds neither, or
 * both, or where the transaction's body is not held.
 */
async function revokerIn(view: TxView, p: WholePermission, chainId: number, manager: Hex, hash: Hex): Promise<Hex | undefined | { unreadable: UnreadableReason }> {
  const body = await view.tx();
  if (body !== null && "unreadable" in body) return body;
  const input = body === null ? undefined : bytesOf(body.input);
  if (input === undefined) return undefined;
  const signers = new Set<Hex>();
  for (const c of callsIn(input, [REVOKE_SELECTOR, REVOKE_AS_SPENDER_SELECTOR, APPROVE_WITH_REVOKE_SELECTOR])) {
    const word = c.selector === APPROVE_WITH_REVOKE_SELECTOR ? 1 : 0;
    const off = wordAt(c.args, word);
    if (off === undefined || uintOf(off) > BigInt(c.args.length)) continue;
    const t = tupleAt(c.args, Number(uintOf(off)));
    if (t === undefined || hashOf(t.p, chainId, manager) !== hash) continue;
    signers.add(c.selector === REVOKE_AS_SPENDER_SELECTOR ? p.spender : p.account);
  }
  return signers.size === 1 ? [...signers][0] : undefined;
}

type Acts = Omit<SeenEvm, "transaction" | "position" | "mark" | "presented">[];

/**
 * The acts a transaction holds for the permission: each `SpendPermissionApproved` and `SpendPermissionRevoked` of the
 * manager whose topic is the permission's hash, its permission decoding whole and hashing to it. An approval consumed
 * the value and is the account's act carrying H where `salt` is H; a revocation consumed it too, an act of another
 * kind, signed by whom its call shows. An event that does not decode, or decodes to another hash, is an item the read
 * cannot decode.
 */
async function classify(ref: SpendPermissionRef, h: AtrHash, view: TxView): Promise<Classified> {
  const chainId = chainIdOf(ref.network)!;
  const manager = ref.manager.toLowerCase() as Hex;
  const hash = ref.hash.toLowerCase() as Hex;
  const payer = refPermission(ref).account;
  const out: Acts = [];
  for (const log of view.receipt.logs) {
    if (!same(log.address, manager) || log.topics.length !== 2 || !same(log.topics[1], hash)) continue;
    const approval = same(log.topics[0], SPEND_PERMISSION_APPROVED_TOPIC);
    if (!approval && !same(log.topics[0], SPEND_PERMISSION_REVOKED_TOPIC)) continue;
    const p = eventPermission(log.data);
    if (p === undefined || hashOf(p, chainId, manager) !== hash) return { undecodable: true };
    const carries = same(saltHash(p), h);
    const result = view.receipt.status === 1 ? ("succeeded" as const) : ("failed" as const);
    if (approval) {
      out.push({
        result,
        consumed: true,
        carries,
        party: partyOf(p.account, payer, ref.payee),
        kind: "same",
        account: same(p.spender, ref.payee) ? "payee" : "other",
        signer: p.account,
        signed: signedOf(p),
      });
    } else {
      const signer = await revokerIn(view, p, chainId, manager, hash);
      if (signer !== undefined && typeof signer === "object") return signer;
      out.push({
        result,
        consumed: true,
        carries,
        party: partyOf(signer, payer, ref.payee),
        kind: "other",
        account: "none",
        ...(signer === undefined ? {} : { signer }),
      });
    }
  }
  return { seen: out };
}

/** The read of `spend-permissions/eip155`. */
export const SPEND_PERMISSION_READ: ReadSpec<SpendPermissionRef> = {
  coverage: "full",
  agreementValue: false,
  check: isRef,
  paymentValue: (ref) => ref.hash.toLowerCase() as Hex,
  value: (ref, _v, reader, block) => consumedAt(ref, reader, block),
  search: "logs",
  filters: (ref) => [
    { address: ref.manager, topics: [SPEND_PERMISSION_APPROVED_TOPIC, ref.hash.toLowerCase() as Hex] },
    { address: ref.manager, topics: [SPEND_PERMISSION_REVOKED_TOPIC, ref.hash.toLowerCase() as Hex] },
  ],
  consumers: (ref) => [
    { address: ref.manager, topics: [SPEND_PERMISSION_APPROVED_TOPIC, ref.hash.toLowerCase() as Hex] },
    { address: ref.manager, topics: [SPEND_PERMISSION_REVOKED_TOPIC, ref.hash.toLowerCase() as Hex] },
  ],
  classify: (ref, values, view) => classify(ref, values.h!, view),
  presented: (ref) => {
    if (!isObject(ref)) return undefined;
    const p = permissionOf(ref["permission"], true);
    return p === undefined ? undefined : signedOf(p);
  },
  payer: (ref) => refPermission(ref).account,
};

/** The read of the approval over `statusOf`. */
export const spendPermissionRead = statusOf(SPEND_PERMISSION_READ);

/**
 * What a transaction shows of the permission's approval: `approved` where its receipt's `status` is 1 and it holds the
 * manager's `SpendPermissionApproved` for the permission's hash with the permission whole; otherwise `revoked` where the
 * manager reads the permission revoked in the state after its block, and `none`. `missing` where the reader holds no
 * receipt for it; `wrong-reader` for a reader of another network; `unreadable` where a read failed or answered out of
 * its form.
 */
export async function approvalIn(
  r: ReturnRead,
  transaction: Hex,
  reader: EvmReader,
): Promise<{ approved: bigint } | "revoked" | "none" | "missing" | "wrong-reader" | "unreadable"> {
  if (readerFault({ network: r.network }, reader) !== undefined) return "wrong-reader";
  let receipt: unknown;
  try {
    receipt = await reader.receipt(transaction);
  } catch {
    return "unreadable";
  }
  if (receipt === null) return "missing";
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return "unreadable";
  const hash = hashOf(r.permission, r.chainId, r.manager);
  if (receipt.status === 1) {
    for (const log of receipt.logs) {
      if (!same(log.address, r.manager) || log.topics.length !== 2) continue;
      if (!same(log.topics[0], SPEND_PERMISSION_APPROVED_TOPIC) || !same(log.topics[1], hash)) continue;
      const p = eventPermission(log.data);
      if (p !== undefined && samePermission(p, r.permission)) return { approved: receipt.blockNumber };
    }
  }
  const revoked = await callBool(reader, r.manager, permissionCall(IS_REVOKED_SELECTOR, r.permission), receipt.blockNumber);
  if (typeof revoked !== "boolean") return "unreadable";
  return revoked ? "revoked" : "none";
}
