/**
 * A Stacks transaction read as a Stacks node reads it. stacks-core 4.0.5 (stacks-network/stacks-core d736ba0) reads a
 * transaction with `StacksTransaction::consensus_deserialize` (stacks-codec/src/transaction.rs:3065-3067, which reads
 * with `consensus_deserialize_with_len`, :3078-3165) and names it by the SHA-512/256 of its serialization
 * (:3256-3261); `readStacksTransaction` accepts exactly the bytes that decode there and serialize back to themselves,
 * rule by rule, and gives the fields `../mpp-usdc.ts` reads. No entry point exports these names.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sameBytes } from "../rail-bytes.js";

/** The fields of a Stacks transaction that the `usdc` Stacks pairing reads. */
export interface StacksTransaction {
  /** The version byte: 0x00 (mainnet) or 0x80 (testnet). */
  version: number;
  /** True for a standard authorization, false for a sponsored one. */
  standard: boolean;
  /** The origin's spending condition: its hash mode, signer hash160 and nonce. */
  origin: { hashMode: number; signer: Uint8Array; nonce: bigint };
  /** A contract call's contract (address version, hash160 and name), function and each argument's bytes; else null. */
  call: { version: number; hash160: Uint8Array; contract: string; functionName: string; args: Uint8Array[] } | null;
}

/** clarity-types/src/types/mod.rs:48, :54 and :62. */
const MAX_VALUE_SIZE = 1024 * 1024;
const MAX_UTF8_VALUE_SIZE = MAX_VALUE_SIZE / 4;
const MAX_TYPE_DEPTH = 32;
/**
 * The deepest a Clarity value in a transaction nests, the outermost value counting 1: a node reads each value
 * unsanitized and refuses one nested deeper (clarity-types/src/types/serialization.rs:71, :629-640).
 */
const MAX_CLARITY_DEPTH = 16;
/** A Clarity name (clarity-types/src/representations.rs:51-56), at most 128 bytes. */
const CLARITY_NAME = /^[a-zA-Z]([a-zA-Z0-9]|[-_!?+<>=/*])*$|^[-+=/*]$|^[<>]=?$/;
/** A contract name (clarity-types/src/representations.rs:36-43, :57-60). */
const CONTRACT_NAME = /^[a-zA-Z]([a-zA-Z0-9]|[-_]){0,127}$|^__transient$/;
const SECP256K1_N = secp256k1.Point.Fn.ORDER;
const ED25519_L = ed25519.Point.Fn.ORDER;

/** Thrown inside the reader for bytes a node does not read; `readStacksTransaction` answers undefined. */
const UNREAD = new Error("not a Stacks transaction a node reads");

function need(ok: boolean): void {
  if (!ok) throw UNREAD;
}

class Reader {
  at = 0;
  constructor(readonly wire: Uint8Array) {}
  bytes(n: number): Uint8Array {
    need(n <= this.wire.length - this.at);
    const b = this.wire.subarray(this.at, this.at + n);
    this.at += n;
    return b;
  }
  u8(): number {
    return this.bytes(1)[0]!;
  }
  u16(): number {
    const b = this.bytes(2);
    return (b[0]! << 8) | b[1]!;
  }
  u32(): number {
    const b = this.bytes(4);
    return b[0]! * 0x100_0000 + ((b[1]! << 16) | (b[2]! << 8) | b[3]!);
  }
  u64(): bigint {
    let n = 0n;
    for (const x of this.bytes(8)) n = (n << 8n) | BigInt(x);
    return n;
  }
  /** A length byte and that many bytes, from `min` to `max` of them, ASCII and matching `pattern`. */
  name(min: number, max: number, pattern: RegExp): string {
    const n = this.u8();
    need(n >= min && n <= max);
    const b = this.bytes(n);
    need(b.every((x) => x < 0x80));
    const s = String.fromCharCode(...b);
    need(pattern.test(s));
    return s;
  }
  /** A principal or an address: a version below 32 and a hash160 (stacks-common/src/types/chainstate.rs:383-395). */
  address(): { version: number; hash160: Uint8Array } {
    const version = this.u8();
    need(version < 32);
    return { version, hash160: this.bytes(20) };
  }
}

// ── Clarity types, as a node types a value it reads (clarity-types/src/types/signatures.rs).

type ClarityType =
  | { k: "none" | "int" | "uint" | "bool" | "principal" }
  | { k: "buffer" | "ascii" | "utf8"; n: number }
  | { k: "list"; max: number; item: ClarityType }
  | { k: "tuple"; fields: Map<string, ClarityType> }
  | { k: "optional"; inner: ClarityType }
  | { k: "response"; ok: ClarityType; err: ClarityType };

/** The type of `none`'s value and of an empty list's items (`NoType`). */
const NO_TYPE: ClarityType = { k: "none" };

/**
 * `f` of each type, computed once: a type does not change once made, and a list's items join into one type item by
 * item, so a join reads its parts' depth and sizes without walking them again and a value is read in time linear in
 * its bytes.
 */
function once<T>(f: (t: ClarityType) => T): (t: ClarityType) => T {
  const known = new WeakMap<ClarityType, { v: T }>();
  return (t) => {
    let hit = known.get(t);
    if (hit === undefined) known.set(t, (hit = { v: f(t) }));
    return hit.v;
  };
}

/** signatures.rs:1404-1427. */
const depth: (t: ClarityType) => number = once((t) => {
  switch (t.k) {
    case "list":
      return 1 + depth(t.item);
    case "tuple": {
      let most = 0;
      for (const f of t.fields.values()) most = Math.max(most, depth(f));
      return 1 + most;
    }
    case "optional":
      return 1 + depth(t.inner);
    case "response":
      return 1 + Math.max(depth(t.ok), depth(t.err));
    default:
      return 1;
  }
});

/** The most bytes a value of the type serializes to, or undefined past `MAX_VALUE_SIZE` (signatures.rs:1438-1469). */
const size: (t: ClarityType) => number | undefined = once((t) => {
  switch (t.k) {
    case "none":
    case "bool":
      return 1;
    case "int":
    case "uint":
      return 16;
    case "principal":
      return 148;
    case "buffer":
    case "ascii":
      return 4 + t.n;
    case "utf8":
      return 4 + 4 * t.n;
    case "list": {
      // The items' size times the length, and the type's own (signatures.rs:1553-1569).
      const [item, own] = [size(t.item), typeSize(t)];
      if (item === undefined || own === undefined) return undefined;
      const total = item * t.max + own;
      return total > MAX_VALUE_SIZE ? undefined : total;
    }
    case "tuple": {
      // Two bytes a member, the type's own size, and each member's size and name (signatures.rs:1619-1652).
      const own = typeSize(t);
      if (own === undefined) return undefined;
      let total = 2 * t.fields.size + own;
      for (const [name, f] of t.fields) {
        const s = size(f);
        if (s === undefined) return undefined;
        total += s + name.length;
      }
      return total > MAX_VALUE_SIZE ? undefined : total;
    }
    case "optional": {
      const s = size(t.inner);
      return s === undefined ? undefined : s + 1;
    }
    case "response": {
      const [a, b] = [size(t.ok), size(t.err)];
      return a === undefined || b === undefined ? undefined : Math.max(a, b) + 1;
    }
  }
});

/** The bytes the type itself takes, or undefined past `MAX_VALUE_SIZE` (signatures.rs:1477-1498, :1571-1600). */
const typeSize: (t: ClarityType) => number | undefined = once((t) => {
  switch (t.k) {
    case "buffer":
    case "ascii":
    case "utf8":
      return 5;
    case "list": {
      const item = typeSize(t.item);
      return item === undefined || item + 5 > MAX_VALUE_SIZE ? undefined : item + 5;
    }
    case "tuple": {
      let total = 2 * t.fields.size;
      for (const [name, f] of t.fields) {
        const s = typeSize(f);
        if (s === undefined) return undefined;
        total += s + name.length;
      }
      return total > MAX_VALUE_SIZE ? undefined : total;
    }
    case "optional": {
      const s = typeSize(t.inner);
      return s === undefined ? undefined : s + 1;
    }
    case "response": {
      const [a, b] = [typeSize(t.ok), typeSize(t.err)];
      return a === undefined || b === undefined ? undefined : a + b + 1;
    }
    default:
      return 1;
  }
});

function same(a: ClarityType, b: ClarityType): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "buffer":
    case "ascii":
    case "utf8":
      return a.n === (b as typeof a).n;
    case "list": {
      const o = b as typeof a;
      return a.max === o.max && same(a.item, o.item);
    }
    case "tuple": {
      const o = b as typeof a;
      if (a.fields.size !== o.fields.size) return false;
      for (const [name, f] of a.fields) {
        const g = o.fields.get(name);
        if (g === undefined || !same(f, g)) return false;
      }
      return true;
    }
    case "optional":
      return same(a.inner, (b as typeof a).inner);
    case "response": {
      const o = b as typeof a;
      return same(a.ok, o.ok) && same(a.err, o.err);
    }
    default:
      return true;
  }
}

/** `ListTypeData::new_list` (signatures.rs:357-378). */
function listOf(item: ClarityType, max: number): ClarityType {
  const t: ClarityType = { k: "list", max, item };
  need(1 + depth(item) <= MAX_TYPE_DEPTH && size(t) !== undefined);
  return t;
}

/** `TupleTypeSignature::try_from` (signatures.rs:744-768). */
function tupleOf(fields: Map<string, ClarityType>): ClarityType {
  need(fields.size > 0);
  for (const f of fields.values()) need(1 + depth(f) <= MAX_TYPE_DEPTH);
  const t: ClarityType = { k: "tuple", fields };
  need(size(t) !== undefined);
  return t;
}

/** `TypeSignature::new_option` and `Value::some` (signatures.rs:402-412; mod.rs:1002-1012). */
function optionalOf(inner: ClarityType): ClarityType {
  const s = size(inner);
  need(s !== undefined && s + 1 <= MAX_VALUE_SIZE && 1 + depth(inner) <= MAX_TYPE_DEPTH);
  return { k: "optional", inner };
}

/** `TypeSignature::new_response`, `Value::okay` and `Value::error` (signatures.rs:414-428; mod.rs:1039-1063). */
function responseOf(ok: ClarityType, err: ClarityType): ClarityType {
  const [a, b] = [size(ok), size(err)];
  need(a !== undefined && b !== undefined && Math.max(a, b) + 1 <= MAX_VALUE_SIZE);
  need(1 + Math.max(depth(ok), depth(err)) <= MAX_TYPE_DEPTH);
  return { k: "response", ok, err };
}

/**
 * The least type both admit, as a node types a list's items (`least_supertype_v2_1`, signatures.rs:1130-1281): a
 * tuple's members are the first's, each in the second too, each member joined; two lists, two optionals and two
 * responses join their parts, an empty list taking the other's items; buffers and strings the longer length; `NoType`
 * the other; any other pair only when equal.
 */
function supertype(a: ClarityType, b: ClarityType): ClarityType {
  if (a.k === "tuple" && b.k === "tuple") {
    const fields = new Map<string, ClarityType>();
    for (const [name, f] of a.fields) {
      const g = b.fields.get(name);
      need(g !== undefined);
      fields.set(name, supertype(f, g as ClarityType));
    }
    return tupleOf(fields);
  }
  if (a.k === "list" && b.k === "list") {
    const item = a.max === 0 ? b.item : b.max === 0 ? a.item : supertype(a.item, b.item);
    return listOf(item, Math.max(a.max, b.max));
  }
  if (a.k === "response" && b.k === "response") return responseOf(supertype(a.ok, b.ok), supertype(a.err, b.err));
  if (a.k === "optional" && b.k === "optional") return optionalOf(supertype(a.inner, b.inner));
  if ((a.k === "buffer" || a.k === "ascii" || a.k === "utf8") && a.k === b.k) return { k: a.k, n: Math.max(a.n, b.n) };
  if (a.k === "none") return b;
  if (b.k === "none") return a;
  need(same(a, b));
  return a;
}

/** string-ascii: alphanumeric, punctuation and whitespace bytes only (mod.rs:1202-1214, Rust's ASCII classes). */
function asciiByte(x: number): boolean {
  return (x >= 0x21 && x <= 0x7e) || x === 0x20 || x === 0x09 || x === 0x0a || x === 0x0c || x === 0x0d;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * One Clarity value at `level`, the outermost counting 1, as a node reads it unsanitized
 * (`Value::consensus_deserialize`, clarity-types/src/types/serialization.rs:1478-1483, which reads with
 * `inner_deserialize_read`, :620-1119): its type.
 */
function value(r: Reader, level: number): ClarityType {
  need(level <= MAX_CLARITY_DEPTH);
  const prefix = r.u8();
  switch (prefix) {
    case 0x00:
      r.bytes(16);
      return { k: "int" };
    case 0x01:
      r.bytes(16);
      return { k: "uint" };
    case 0x02: {
      const n = r.u32();
      need(n <= MAX_VALUE_SIZE);
      r.bytes(n);
      return { k: "buffer", n };
    }
    case 0x03:
    case 0x04:
      return { k: "bool" };
    case 0x05:
      r.address();
      return { k: "principal" };
    case 0x06:
      r.address();
      r.name(0, 128, CONTRACT_NAME);
      return { k: "principal" };
    case 0x07:
      return responseOf(value(r, level + 1), NO_TYPE);
    case 0x08:
      return responseOf(NO_TYPE, value(r, level + 1));
    case 0x09:
      return optionalOf(NO_TYPE);
    case 0x0a:
      return optionalOf(value(r, level + 1));
    case 0x0b: {
      // A list's type is its items' least supertype (mod.rs:1149-1155, signatures.rs:1336-1401).
      const n = r.u32();
      need(n <= MAX_VALUE_SIZE);
      if (n === 0) return { k: "list", max: 0, item: NO_TYPE };
      let item = value(r, level + 1);
      for (let i = 1; i < n; i++) {
        const t = value(r, level + 1);
        if (!same(item, t)) item = supertype(item, t);
      }
      return listOf(item, n);
    }
    case 0x0c: {
      // No empty tuple and no repeated name (mod.rs:1855-1870); a node writes the members in name order as bytes
      // (serialization.rs:1185-1193).
      const n = r.u32();
      need(n > 0 && n <= MAX_VALUE_SIZE);
      const fields = new Map<string, ClarityType>();
      let last = "";
      for (let i = 0; i < n; i++) {
        const name = r.name(0, 128, CLARITY_NAME);
        need(i === 0 || name > last);
        last = name;
        fields.set(name, value(r, level + 1));
      }
      return tupleOf(fields);
    }
    case 0x0d: {
      const n = r.u32();
      need(n <= MAX_VALUE_SIZE);
      need(r.bytes(n).every(asciiByte));
      return { k: "ascii", n };
    }
    case 0x0e: {
      const n = r.u32();
      need(n <= MAX_VALUE_SIZE);
      // Well-formed UTF-8, at most `MAX_UTF8_VALUE_SIZE` characters (mod.rs:1261-1279).
      let chars = 0;
      for (const _ of UTF8.decode(r.bytes(n))) chars++;
      need(chars <= MAX_UTF8_VALUE_SIZE);
      return { k: "utf8", n: chars };
    }
    default:
      throw UNREAD;
  }
}

// ── the transaction (stacks-codec/src/transaction.rs).

/**
 * A spending condition (:1321-1347): singlesig (:1186-1222), multisig (:805-871) or order-independent multisig
 * (:997-1060).
 */
function spendingCondition(r: Reader): StacksTransaction["origin"] {
  const hashMode = r.u8();
  const signer = r.bytes(20);
  const nonce = r.u64();
  r.u64(); // fee
  if (hashMode === 0x00 || hashMode === 0x02) {
    const keyEncoding = r.u8();
    need(keyEncoding === 0x00 || keyEncoding === 0x01);
    r.bytes(65);
    // P2WPKH signs with a compressed key.
    need(hashMode === 0x00 || keyEncoding === 0x00);
  } else {
    need(hashMode === 0x01 || hashMode === 0x03 || hashMode === 0x05 || hashMode === 0x07);
    const count = r.u32();
    let signatures = 0;
    let uncompressed = false;
    for (let i = 0; i < count; i++) {
      // An auth field (:713-760): a public key, a compressed secp256k1 point that parses, or a 65-byte signature.
      const id = r.u8();
      if (id === 0x00 || id === 0x01) {
        const key = r.bytes(33);
        need(key[0] === 0x02 || key[0] === 0x03);
        secp256k1.Point.fromBytes(key);
      } else {
        need(id === 0x02 || id === 0x03);
        r.bytes(65);
        signatures++;
      }
      if (id === 0x01 || id === 0x03) uncompressed = true;
    }
    const required = r.u16();
    need(signatures <= 0xffff);
    // Multisig takes exactly the required signatures, order-independent multisig at least them.
    need(hashMode === 0x01 || hashMode === 0x03 ? signatures === required : signatures >= required);
    // P2WSH takes compressed keys only.
    need(!uncompressed || hashMode === 0x01 || hashMode === 0x05);
  }
  return { hashMode, signer, nonce };
}

/** A post-condition's principal (:2345-2368): the origin, an address, or an address and a contract name. */
function postConditionPrincipal(r: Reader): void {
  const id = r.u8();
  need(id >= 0x01 && id <= 0x03);
  if (id >= 0x02) r.address();
  if (id === 0x03) r.name(1, 40, CONTRACT_NAME);
}

/** A post-condition (:2452-2540): STX, fungible, non-fungible, Staking or Pox, each with its condition codes. */
function postCondition(r: Reader): void {
  const type = r.u8();
  need(type <= 0x04);
  postConditionPrincipal(r);
  if (type === 0x01 || type === 0x02) {
    // An asset (:2177-2186): its contract's address and name, and its Clarity name.
    r.address();
    r.name(1, 40, CONTRACT_NAME);
    r.name(0, 128, CLARITY_NAME);
  }
  if (type === 0x02) {
    value(r, 1);
    const code = r.u8();
    need(code >= 0x10 && code <= 0x12);
  } else if (type === 0x04) {
    const code = r.u8();
    need(code >= 0x30 && code <= 0x32);
  } else {
    const code = r.u8();
    need(code >= 0x01 && code <= 0x05);
    r.u64();
  }
}

/** A microblock header (:2563-2584): its signature a recoverable secp256k1 signature, r and s below the group order. */
function microblockHeader(r: Reader): Uint8Array {
  const header = r.bytes(1 + 2 + 32 + 32 + 65);
  const sig = header.subarray(67);
  need(sig[0]! <= 3 && big(sig.subarray(1, 33)) < SECP256K1_N && big(sig.subarray(33)) < SECP256K1_N);
  return header;
}

/**
 * The 80-byte VRF proof of a Nakamoto coinbase (stacks-common/src/util/vrf.rs:281-316 and :330-351): Gamma the
 * canonical encoding of an Edwards25519 point not of small order, then c, then s a canonical scalar.
 */
function vrfProof(r: Reader): void {
  const proof = r.bytes(80);
  const gamma = proof.subarray(0, 32);
  const point = ed25519.Point.fromBytes(gamma);
  need(!point.isSmallOrder() && sameBytes(point.toBytes(), gamma));
  need(littleEndian(proof.subarray(48)) < ED25519_L);
}

function big(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

function littleEndian(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
  return n;
}

/** The payload (:2915-3007): its type, and a contract call's fields. */
function payload(r: Reader): { type: number; call: StacksTransaction["call"] } {
  const type = r.u8();
  switch (type) {
    case 0x00: {
      // A token transfer: the recipient is a principal (clarity-types/src/types/serialization.rs:289-311), an
      // amount and a 34-byte memo.
      const prefix = r.u8();
      need(prefix === 0x05 || prefix === 0x06);
      r.address();
      if (prefix === 0x06) r.name(0, 128, CONTRACT_NAME);
      r.bytes(8 + 34);
      return { type, call: null };
    }
    case 0x02: {
      // A contract call (:2114-2135).
      const { version, hash160 } = r.address();
      const contract = r.name(1, 40, CONTRACT_NAME);
      const functionName = r.name(0, 128, CLARITY_NAME);
      const count = r.u32();
      const args: Uint8Array[] = [];
      for (let i = 0; i < count; i++) {
        const at = r.at;
        value(r, 1);
        args.push(r.wire.subarray(at, r.at));
      }
      return { type, call: { version, hash160, contract, functionName, args } };
    }
    case 0x06:
    case 0x01: {
      // A smart contract, with a Clarity version from 1 to 7 when versioned (:2825-2842): its name and its code,
      // printable ASCII, tab and newline (stacks-codec/src/strings.rs:63-112).
      if (type === 0x06) {
        const version = r.u8();
        need(version >= 1 && version <= 7);
      }
      r.name(1, 40, CONTRACT_NAME);
      const code = r.bytes(r.u32());
      need(code.every((x) => (x >= 0x20 && x <= 0x7e) || x === 0x09 || x === 0x0a));
      return { type, call: null };
    }
    case 0x03: {
      // A poisoned microblock: two headers that differ and share a sequence number or a parent.
      const [a, b] = [microblockHeader(r), microblockHeader(r)];
      const sequence = sameBytes(a.subarray(1, 3), b.subarray(1, 3));
      const parent = sameBytes(a.subarray(3, 35), b.subarray(3, 35));
      need(!sameBytes(a, b) && (sequence || parent));
      return { type, call: null };
    }
    case 0x04:
      r.bytes(32);
      return { type, call: null };
    case 0x05: {
      // A pay-to-alt coinbase: its recipient a principal.
      r.bytes(32);
      need(value(r, 1).k === "principal");
      return { type, call: null };
    }
    case 0x08: {
      // A Nakamoto coinbase: its recipient none or (some <principal>); a node reads (some …) of anything else as no
      // recipient and writes it back as none.
      r.bytes(32);
      const recipient = value(r, 1);
      need(recipient.k === "optional" && (recipient.inner.k === "none" || recipient.inner.k === "principal"));
      vrfProof(r);
      return { type, call: null };
    }
    case 0x07: {
      // A tenure change (:300-345): three consensus hashes, a block id, a count, a cause from 0 to 6, a key hash.
      r.bytes(20 + 20 + 20 + 32 + 4);
      need(r.u8() <= 6);
      r.bytes(20);
      return { type, call: null };
    }
    default:
      throw UNREAD;
  }
}

/**
 * The transaction `wire` holds, when a Stacks node decodes it and serializes it back to the same bytes, else
 * undefined. A node reads any version byte by its top bit and writes 0x00 or 0x80; an anchor mode from 1 to 3, a
 * coinbase or poisoned microblock on chain only; a post-condition mode from 1 to 3 (:3078-3160).
 */
export function readStacksTransaction(wire: Uint8Array): StacksTransaction | undefined {
  try {
    const r = new Reader(wire);
    const version = r.u8();
    need(version === 0x00 || version === 0x80);
    r.bytes(4); // chain id
    const auth = r.u8();
    need(auth === 0x04 || auth === 0x05);
    const origin = spendingCondition(r);
    if (auth === 0x05) spendingCondition(r);
    const anchor = r.u8();
    const postConditionMode = r.u8();
    const count = r.u32();
    for (let i = 0; i < count; i++) postCondition(r);
    const { type, call } = payload(r);
    need(anchor >= 1 && anchor <= 3 && postConditionMode >= 1 && postConditionMode <= 3);
    need(anchor === 1 || ![0x03, 0x04, 0x05, 0x08].includes(type));
    need(r.at === wire.length);
    return { version, standard: auth === 0x04, origin, call };
  } catch {
    return undefined;
  }
}
