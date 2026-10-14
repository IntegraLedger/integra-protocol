/**
 * The x402 payment an Algorand payer presents, and the reader of one payment entry. `../avm.ts` returns the payment
 * from `complete` and reads each entry with `readEntry`; the root names the payment among the payments `Presented`
 * covers. No entry point exports any name here.
 *
 * On the x402 path an entry has two readers. The x402 reference facilitator (`@x402/avm`) decodes it with
 * algokit-utils' `decodeSignedTransaction`, then submits the entry's own bytes, which algod decodes with go-codec and
 * checks with `Transaction.WellFormed`. `readEntry` follows both, from the same bytes, and gives the transaction only
 * when both readers accept the entry and both read the same signed transaction, its id being the one algod computes.
 */
import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";
import type { AvmPresented } from "../avm.js";
import type { X402Payment } from "./x402.js";

export type AvmPaymentPayload = X402Payment<AvmPresented>;

/** One msgpack value, as the msgpack specification's formats spell it. */
type Node =
  | { k: "nil" }
  | { k: "bool"; v: boolean }
  /** An integer of any format; `head` is its first byte, which tells a fixint and a 64-bit format apart. */
  | { k: "int"; v: bigint; head: number }
  | { k: "float" }
  | { k: "ext" }
  | { k: "str"; b: Uint8Array }
  | { k: "bin"; b: Uint8Array }
  | { k: "array"; items: Node[] }
  | { k: "map"; entries: [Node, Node][] };

/**
 * `b` as exactly one msgpack value whose arrays and maps nest at most `maxDepth` deep (the outermost container being
 * level 1) and whose every declared length (a string's, binary's or extension's bytes, an array's elements, a map's
 * keys and values) is no more than the bytes that remain; null for any other input, the unused byte C1 included.
 */
function parse(b: Uint8Array, maxDepth: number): Node | null {
  const n = b.length;
  let i = 0;
  const uint = (width: number): number | null => {
    if (i + width > n) return null;
    let v = 0;
    for (let k = 0; k < width; k++) v = v * 256 + b[i + k]!;
    i += width;
    return v;
  };
  const bytes = (length: number | null): Uint8Array | null => {
    if (length === null || length > n - i) return null;
    i += length;
    return b.subarray(i - length, i);
  };
  const signed = (width: number): bigint | null => {
    if (i + width > n) return null;
    let v = 0n;
    for (let k = 0; k < width; k++) v = (v << 8n) | BigInt(b[i + k]!);
    i += width;
    const bits = BigInt(8 * width);
    return v >= 1n << (bits - 1n) ? v - (1n << bits) : v;
  };
  const value = (depth: number): Node | null => {
    if (i >= n) return null;
    const t = b[i++]!;
    if (t <= 0x7f) return { k: "int", v: BigInt(t), head: t };
    if (t >= 0xe0) return { k: "int", v: BigInt(t - 0x100), head: t };
    if (t <= 0x8f) return container("map", t & 0x0f, depth);
    if (t <= 0x9f) return container("array", t & 0x0f, depth);
    if (t <= 0xbf) return text("str", t & 0x1f);
    switch (t) {
      case 0xc0:
        return { k: "nil" };
      case 0xc2:
        return { k: "bool", v: false };
      case 0xc3:
        return { k: "bool", v: true };
      case 0xc4:
        return text("bin", uint(1));
      case 0xc5:
        return text("bin", uint(2));
      case 0xc6:
        return text("bin", uint(4));
      case 0xc7:
      case 0xc8:
      case 0xc9: {
        const length = uint(1 << (t - 0xc7));
        return length !== null && bytes(length + 1) !== null ? { k: "ext" } : null;
      }
      case 0xca:
        return bytes(4) === null ? null : { k: "float" };
      case 0xcb:
        return bytes(8) === null ? null : { k: "float" };
      case 0xcc:
      case 0xcd:
      case 0xce:
      case 0xcf: {
        const v = signed(1 << (t - 0xcc));
        return v === null ? null : { k: "int", v: BigInt.asUintN(8 << (t - 0xcc), v), head: t };
      }
      case 0xd0:
      case 0xd1:
      case 0xd2:
      case 0xd3: {
        const v = signed(1 << (t - 0xd0));
        return v === null ? null : { k: "int", v, head: t };
      }
      case 0xd4:
      case 0xd5:
      case 0xd6:
      case 0xd7:
      case 0xd8:
        return bytes((1 << (t - 0xd4)) + 1) === null ? null : { k: "ext" };
      case 0xd9:
        return text("str", uint(1));
      case 0xda:
        return text("str", uint(2));
      case 0xdb:
        return text("str", uint(4));
      case 0xdc:
        return container("array", uint(2), depth);
      case 0xdd:
        return container("array", uint(4), depth);
      case 0xde:
        return container("map", uint(2), depth);
      case 0xdf:
        return container("map", uint(4), depth);
      default:
        return null;
    }
  };
  const text = (k: "str" | "bin", length: number | null): Node | null => {
    const s = bytes(length);
    return s === null ? null : { k, b: s };
  };
  const container = (k: "array" | "map", count: number | null, depth: number): Node | null => {
    if (count === null || depth + 1 > maxDepth || (k === "map" ? 2 * count : count) > n - i) return null;
    const items: Node[] = [];
    for (let j = 0; j < (k === "map" ? 2 * count : count); j++) {
      const item = value(depth + 1);
      if (item === null) return null;
      items.push(item);
    }
    if (k === "array") return { k, items };
    const entries: [Node, Node][] = [];
    for (let j = 0; j < items.length; j += 2) entries.push([items[j]!, items[j + 1]!]);
    return { k, entries };
  };
  const root = value(0);
  return root !== null && i === n ? root : null;
}

/**
 * True when `b` is exactly one msgpack value (the msgpack specification's formats) whose arrays and maps nest at most
 * `maxDepth` deep and whose every declared length is no more than the bytes that remain, so no count is trusted past
 * the input. A string's bytes are not judged here: `readEntry` reads each member as its type is read.
 */
export function msgpackWithinCaps(b: Uint8Array, maxDepth: number): boolean {
  return parse(b, maxDepth) !== null;
}

// ---------------------------------------------------------------------------------------------------------------------
// algod's reader: go-codec v1.1.10 under go-algorand's CodecHandle (ErrorIfNoField, ErrorIfNoArrayExpand), over the
// SignedTxn type tree of go-algorand v5.0.3, and the type rules of Transaction.WellFormed.

type Kind =
  | { t: "uint"; bits: 8 | 16 | 32 | 64 }
  | { t: "bool" }
  | { t: "string" }
  | { t: "bytes" }
  | { t: "fixed"; n: number }
  | { t: "slice"; of: Kind }
  | { t: "uintmap"; of: Struct }
  | { t: "ptr"; of: Struct }
  | Struct;
/** A struct: its members in source order, which is the order go-codec reads a struct written as an array. */
type Struct = { t: "struct"; fields: readonly (readonly [string, Kind])[]; fromArray: boolean };

type Value = bigint | boolean | Uint8Array | null | Value[] | Map<bigint, Value> | Fields;
type Fields = { [name: string]: Value };

const u8: Kind = { t: "uint", bits: 8 };
const u16: Kind = { t: "uint", bits: 16 };
const u32: Kind = { t: "uint", bits: 32 };
const u64: Kind = { t: "uint", bits: 64 };
const bool: Kind = { t: "bool" };
const str: Kind = { t: "string" };
const bytes: Kind = { t: "bytes" };
const fixed = (n: number): Kind => ({ t: "fixed", n });
const slice = (of: Kind): Kind => ({ t: "slice", of });
const struct = (fields: readonly (readonly [string, Kind])[], fromArray = true): Struct => ({ t: "struct", fields, fromArray });

const ADDRESS = fixed(32);
const multisig = struct([
  ["v", u8],
  ["thr", u8],
  ["subsig", slice(struct([["pk", fixed(32)], ["s", fixed(64)]]))],
]);
const pqsig = struct([["sch", fixed(2)], ["slt", u8], ["pk", bytes], ["sig", bytes]]);
const logicsig = struct([
  ["l", bytes],
  ["sig", fixed(64)],
  ["msig", multisig],
  ["lmsig", multisig],
  ["pqsig", pqsig],
  ["arg", slice(bytes)],
]);
const stateSchema = struct([["nui", u64], ["nbs", u64]]);
const boxRef = struct([["i", u64], ["n", bytes]]);
const proof = struct([["pth", slice(bytes)], ["hsh", struct([["t", u16]])], ["td", u8]]);
const reveal = struct([
  [
    "s",
    struct([
      ["s", struct([["sig", bytes], ["idx", u64], ["prf", proof], ["vkey", struct([["k", fixed(1793)]])]])],
      ["l", u64],
    ]),
  ],
  ["p", struct([["p", struct([["cmt", fixed(64)], ["lf", u64]])], ["w", u64]])],
]);
const heartbeat = struct([
  ["a", ADDRESS],
  ["prf", struct([["s", fixed(64)], ["p", fixed(32)], ["p2", fixed(32)], ["p1s", fixed(64)], ["p2s", fixed(64)]])],
  ["sd", fixed(32)],
  ["vid", fixed(32)],
  ["kd", u64],
  ["c", bool],
]);

/** Each transaction type's own members, as WellFormed groups them. */
const TYPE_FIELDS: Record<string, readonly (readonly [string, Kind])[]> = {
  keyreg: [
    ["votekey", fixed(32)],
    ["selkey", fixed(32)],
    ["sprfkey", fixed(64)],
    ["votefst", u64],
    ["votelst", u64],
    ["votekd", u64],
    ["nonpart", bool],
  ],
  pay: [["rcv", ADDRESS], ["amt", u64], ["close", ADDRESS]],
  acfg: [
    ["caid", u64],
    [
      "apar",
      struct([
        ["t", u64],
        ["dc", u32],
        ["df", bool],
        ["un", str],
        ["an", str],
        ["au", str],
        ["am", fixed(32)],
        ["m", ADDRESS],
        ["r", ADDRESS],
        ["f", ADDRESS],
        ["c", ADDRESS],
      ]),
    ],
  ],
  axfer: [["xaid", u64], ["aamt", u64], ["asnd", ADDRESS], ["arcv", ADDRESS], ["aclose", ADDRESS]],
  afrz: [["fadd", ADDRESS], ["faid", u64], ["afrz", bool]],
  appl: [
    ["apid", u64],
    ["apan", u64],
    ["apaa", slice(bytes)],
    ["apat", slice(ADDRESS)],
    ["apas", slice(u64)],
    ["apfa", slice(u64)],
    [
      "al",
      slice(
        struct([
          ["d", ADDRESS],
          ["s", u64],
          ["p", u64],
          ["h", struct([["d", u64], ["s", u64]])],
          ["l", struct([["d", u64], ["p", u64]])],
          ["b", boxRef],
        ]),
      ),
    ],
    ["apbx", slice(boxRef)],
    ["apls", stateSchema],
    ["apgs", stateSchema],
    ["apap", bytes],
    ["apsu", bytes],
    ["apep", u32],
    ["aprv", u64],
  ],
  stpf: [
    ["sptype", u64],
    [
      "sp",
      struct([
        ["c", bytes],
        ["w", u64],
        ["S", proof],
        ["P", proof],
        ["v", u8],
        ["r", { t: "uintmap", of: reveal }],
        ["pr", slice(u64)],
      ]),
    ],
    ["spmsg", struct([["b", bytes], ["v", bytes], ["P", u64], ["f", u64], ["l", u64]])],
  ],
  hb: [["hb", { t: "ptr", of: heartbeat }]],
};
const HEADER: readonly (readonly [string, Kind])[] = [
  ["type", str],
  ["snd", ADDRESS],
  ["fee", u64],
  ["fv", u64],
  ["lv", u64],
  ["note", bytes],
  ["gen", str],
  ["gh", fixed(32)],
  ["grp", fixed(32)],
  ["lx", fixed(32)],
  ["rekey", ADDRESS],
];
/**
 * The transaction, its embedded structs' members flattened into one map. Written as an array it is refused wherever
 * it occurs: the facilitator's decoder reads a last `txn` written as an array as a transaction with no type and refuses
 * it, and an earlier one, which both readers read under a later map, is refused too, so a transaction has one form.
 */
const TRANSACTION = struct([...HEADER, ...Object.values(TYPE_FIELDS).flat()], false);
/** The signed transaction. Written as an array it is refused: the facilitator's decoder reads it with no transaction. */
const SIGNED_TXN = struct(
  [["sig", fixed(64)], ["msig", multisig], ["lsig", logicsig], ["pqsig", pqsig], ["txn", TRANSACTION], ["sgnr", ADDRESS]],
  false,
);

/** Thrown inside a reader for an entry it refuses; `readEntry` turns it into its answer. */
class Refused extends Error {}
const refuse = (): never => {
  throw new Refused();
};

function zeroOf(kind: Kind): Value {
  switch (kind.t) {
    case "uint":
      return 0n;
    case "bool":
      return false;
    case "string":
      return new Uint8Array(0);
    case "fixed":
      return new Uint8Array(kind.n);
    case "bytes":
    case "slice":
    case "uintmap":
    case "ptr":
      return null;
    case "struct": {
      const v: Fields = {};
      for (const [name, k] of kind.fields) v[name] = zeroOf(k);
      return v;
    }
  }
}

/** msgp's MsgIsZero: an empty slice, map or byte string is zero whether or not it is nil. */
function isZero(kind: Kind, v: Value): boolean {
  switch (kind.t) {
    case "uint":
      return v === 0n;
    case "bool":
      return v === false;
    case "fixed":
      return (v as Uint8Array).every((x) => x === 0);
    case "string":
    case "bytes":
      return v === null || (v as Uint8Array).length === 0;
    case "slice":
      return v === null || (v as Value[]).length === 0;
    case "uintmap":
      return v === null || (v as Map<bigint, Value>).size === 0;
    case "ptr":
      return v === null;
    case "struct":
      return kind.fields.every(([name, k]) => isZero(k, (v as Fields)[name]!));
  }
}

/** A non-negative integer below 2^bits (go-codec's DecodeUint64 with its overflow check), else refused. */
function uintOf(node: Node, bits: number): bigint {
  if (node.k !== "int" || node.v < 0n || node.v >= 1n << BigInt(bits)) refuse();
  return (node as { v: bigint }).v;
}

/** Bytes from an array of uint8 values (a map's keys and values in turn), each nil being 0. */
function bytesFromItems(items: Node[]): Uint8Array {
  return Uint8Array.from(items, (x) => (x.k === "nil" ? 0 : Number(uintOf(x, 8))));
}
const itemsOf = (node: Node): Node[] | null =>
  node.k === "array" ? node.items : node.k === "map" ? node.entries.flat() : null;
/** The array behind each decoded slice, up to its capacity: the slice's elements, then any an earlier occurrence left. */
const BACKING = new WeakMap<Value[], Value[]>();

/**
 * Decodes `node` into `cur`, a value of `kind` (go-codec's decodeValue). A struct decodes into the struct it updates, so
 * a repeated member merges; a fixed-length byte array has only the bytes written replaced; a slice keeps and updates
 * the elements it already has. Refuses what go-codec refuses.
 */
function decodeInto(kind: Kind, node: Node, cur: Value): Value {
  switch (kind.t) {
    case "uint":
      return uintOf(node, kind.bits);
    case "bool":
      // DecodeBool: true, false, or the positive fixint 0 or 1.
      if (node.k === "bool") return node.v;
      if (node.k === "int" && (node.head === 0x00 || node.head === 0x01)) return node.head === 0x01;
      return refuse();
    case "string":
      // DecodeString: a str, a bin, or an array of uint8 values.
      if (node.k === "str" || node.k === "bin") return node.b.slice();
      if (node.k === "array") return bytesFromItems(node.items);
      return refuse();
    case "bytes": {
      if (node.k === "str" || node.k === "bin") return node.b.slice();
      const items = itemsOf(node);
      return items === null ? refuse() : bytesFromItems(items);
    }
    case "fixed": {
      const out = (cur as Uint8Array).slice();
      if (node.k === "str" || node.k === "bin") {
        out.set(node.b.subarray(0, kind.n));
        return out;
      }
      const items = itemsOf(node);
      if (items === null || items.length > kind.n) return refuse();
      out.set(bytesFromItems(items));
      return out;
    }
    case "slice": {
      const items = itemsOf(node);
      if (items === null) return refuse();
      // kSlice keeps the slice's array: items that fit its capacity decode into the elements already there, those an
      // earlier, longer occurrence left past the slice's length included; more items take a new array holding only
      // the slice's elements.
      const old = cur as Value[] | null;
      const kept = old === null ? [] : items.length <= (BACKING.get(old) ?? old).length ? (BACKING.get(old) ?? old) : old;
      const out = items.map((item, j) =>
        item.k === "nil" ? zeroOf(kind.of) : decodeInto(kind.of, item, j < kept.length ? kept[j]! : zeroOf(kind.of)),
      );
      BACKING.set(out, kept.length > out.length ? [...out, ...kept.slice(out.length)] : out);
      return out;
    }
    case "uintmap": {
      if (node.k !== "map") return refuse();
      const m = new Map(cur as Map<bigint, Value> | null);
      for (const [key, value] of node.entries) {
        const k = uintOf(key, 64);
        m.set(k, value.k === "nil" ? zeroOf(kind.of) : decodeInto(kind.of, value, m.get(k) ?? zeroOf(kind.of)));
      }
      return m;
    }
    case "ptr":
      return decodeInto(kind.of, node, cur ?? zeroOf(kind.of));
    case "struct": {
      const v: Fields = { ...(cur as Fields) };
      const set = (name: string, k: Kind, x: Node) => {
        v[name] = x.k === "nil" ? zeroOf(k) : decodeInto(k, x, v[name]!);
      };
      if (node.k === "map") {
        for (const [key, x] of node.entries) {
          // decStructFieldKey reads a key as DecodeStringAsBytes does; an empty key panics in indexForEncName. A key
          // that is not exactly a member's name is refused: ErrorIfNoField refuses most, and a key for which
          // indexForEncName's search of its names table finds a member is refused here too, so a member has one key.
          const name = key.k === "str" || key.k === "bin" ? key.b : key.k === "array" ? bytesFromItems(key.items) : refuse();
          const field = name.length === 0 ? undefined : kind.fields.find(([n]) => sameAscii(name, n));
          if (field === undefined) return refuse();
          set(field[0], field[1], x);
        }
        return v;
      }
      if (node.k === "array" && kind.fromArray && node.items.length <= kind.fields.length) {
        node.items.forEach((x, j) => set(kind.fields[j]![0], kind.fields[j]![1], x));
        return v;
      }
      return refuse();
    }
  }
}

function sameAscii(b: Uint8Array, name: string): boolean {
  if (b.length !== name.length) return false;
  for (let j = 0; j < b.length; j++) if (b[j] !== name.charCodeAt(j)) return false;
  return true;
}

/** WellFormed's type rules: a type algod knows, and no member of another type at a non-zero value. */
function wellTyped(txn: Fields): string {
  const type = Object.keys(TYPE_FIELDS).find((t) => sameAscii(txn["type"] as Uint8Array, t)) ?? refuse();
  for (const [t, fields] of Object.entries(TYPE_FIELDS)) {
    if (t === type) continue;
    const nonZero =
      t === "appl"
        ? // ApplicationCallTxnFields.Empty: a slice or byte string is a member once it is not nil, even when empty.
          fields.some(([name, k]) => (k.t === "slice" || k.t === "bytes" ? txn[name] !== null : !isZero(k, txn[name]!)))
        : fields.some(([name, k]) => !isZero(k, txn[name]!));
    if (nonZero) refuse();
  }
  return type;
}

// ---------------------------------------------------------------------------------------------------------------------
// The canonical encoding, as go-algorand's generated MarshalMsg writes it and algorand-msgpack writes algokit's: each
// struct a map of its non-zero members in sorted key order, integers, strings and byte strings in their shortest form.

const ENC = new TextEncoder();

function header(fix: number, fixMax: number, b8: number | null, b16: number, length: number): number[] {
  if (length <= fixMax) return [fix | length];
  if (b8 !== null && length < 0x100) return [b8, length];
  if (length < 0x10000) return [b16, length >> 8, length & 0xff];
  return [b16 + 1, length >>> 24, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff];
}
const strOf = (b: Uint8Array): number[] => [...header(0xa0, 31, 0xd9, 0xda, b.length), ...b];
const binOf = (b: Uint8Array): number[] => [...header(0xc4, -1, 0xc4, 0xc5, b.length), ...b];
const arrayHead = (n: number): number[] => header(0x90, 15, null, 0xdc, n);
const mapHead = (n: number): number[] => header(0x80, 15, null, 0xde, n);
function uintBytes(v: bigint): number[] {
  if (v < 0x80n) return [Number(v)];
  const width = v < 0x100n ? 1 : v < 0x10000n ? 2 : v < 0x100000000n ? 4 : 8;
  const out = [0xcc + Math.log2(width)];
  for (let k = width - 1; k >= 0; k--) out.push(Number((v >> BigInt(8 * k)) & 0xffn));
  return out;
}
/** A map of the members given, keys in byte order. */
function mapOf(members: [string, number[]][]): number[] {
  members.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [...mapHead(members.length), ...members.flatMap(([name, v]) => [...strOf(ENC.encode(name)), ...v])];
}

/** MarshalMsg of `v`, a value of `kind`. */
function marshal(kind: Kind, v: Value): number[] {
  switch (kind.t) {
    case "uint":
      return uintBytes(v as bigint);
    case "bool":
      return [v ? 0xc3 : 0xc2];
    case "string":
      return strOf(v as Uint8Array);
    case "bytes":
      return binOf((v as Uint8Array | null) ?? new Uint8Array(0));
    case "fixed":
      return binOf(v as Uint8Array);
    case "slice": {
      const items = (v as Value[] | null) ?? [];
      return [...arrayHead(items.length), ...items.flatMap((x) => marshal(kind.of, x))];
    }
    case "uintmap": {
      const entries = [...((v as Map<bigint, Value> | null) ?? new Map<bigint, Value>())].sort(([a], [b]) => (a < b ? -1 : 1));
      return [...mapHead(entries.length), ...entries.flatMap(([k, x]) => [...uintBytes(k), ...marshal(kind.of, x)])];
    }
    case "ptr":
      return marshal(kind.of, v as Fields);
    case "struct":
      return mapOf(kind.fields.filter(([name, k]) => !isZero(k, (v as Fields)[name]!)).map(([name, k]) => [name, marshal(k, (v as Fields)[name]!)]));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The facilitator's reader: algokit-utils 10.0.0-alpha.46's decodeSignedTransaction, then its re-encoding
// (encodeSignedTransaction). algorand-msgpack 1.1.0 decodes the entry with every str read as raw bytes, a key as
// raw bytes too, and maps as Maps; each struct is read from its members by name, the last of a repeated key winning,
// and a value that is not a map read as a struct with no members. Only an entry algod accepts reaches this reader, so
// every key here is a str or bin spelling a member's name: an unknown key, a key of another msgpack type, or a
// transaction type other than axfer is refused by algod first.

/** A struct's members by name, the last of a repeated key winning; a value that is not a map has none. */
function membersOf(node: Node | undefined): Map<string, Node> {
  const out = new Map<string, Node>();
  if (node?.k === "map") {
    for (const [key, x] of node.entries) {
      if (key.k === "str" || key.k === "bin") out.set(Array.from(key.b, (c) => String.fromCharCode(c)).join(""), x);
    }
  }
  return out;
}
const absent = (node: Node | undefined): node is undefined | { k: "nil" } => node === undefined || node.k === "nil";
const rawBytes = (node: Node): Uint8Array => (node.k === "str" || node.k === "bin" ? node.b : refuse());

/** BigIntCodec: an integer, absent or nil being 0. */
function facUint(node: Node | undefined): bigint {
  if (absent(node)) return 0n;
  return node.k === "int" ? node.v : refuse();
}
/**
 * NumberCodec, which keeps the decoded value: an integer written in a 64-bit format is a bigint, which is written back
 * even when it is 0; any other integer is a number, written back unless it is 0.
 */
function facNumber(name: string, node: Node | undefined, members: [string, number[]][]): boolean {
  if (absent(node)) return true;
  if (node.k !== "int") return refuse();
  const wide = node.head === 0xcf || node.head === 0xd3;
  if (node.v !== 0n || wide) members.push([name, uintBytes(node.v)]);
  return node.v === 0n && !wide;
}
/** FixedBytesCodec: raw bytes of any length, written back unless they are that length and all zero. */
function facFixed(name: string, n: number, node: Node | undefined, members: [string, number[]][]): boolean {
  if (absent(node)) return true;
  const b = rawBytes(node);
  if (b.length === n && b.every((x) => x === 0)) return true;
  members.push([name, binOf(b)]);
  return false;
}
/** BytesCodec: raw bytes, written back unless empty. */
function facBytes(name: string, node: Node | undefined, members: [string, number[]][]): boolean {
  if (absent(node)) return true;
  const b = rawBytes(node);
  if (b.length > 0) members.push([name, binOf(b)]);
  return b.length === 0;
}
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/**
 * AddressCodec: 32 raw bytes, or 58 bytes read as an address's text (hi-base32's decode, which takes the 290 bits of 58
 * characters as 36 bytes, then the checksum); written back unless all zero.
 */
function facAddress(name: string, node: Node | undefined, members: [string, number[]][]): boolean {
  if (absent(node)) return true;
  const b = rawBytes(node);
  let pk: Uint8Array;
  if (b.length === 32) pk = b;
  else if (b.length === 58) {
    let acc = 0n;
    for (const c of b) {
      const d = ALPHABET.indexOf(String.fromCharCode(c));
      if (d < 0) return refuse();
      acc = (acc << 5n) | BigInt(d);
    }
    acc >>= 2n;
    const decoded = Uint8Array.from({ length: 36 }, (_, j) => Number((acc >> BigInt(8 * (35 - j))) & 0xffn));
    pk = decoded.subarray(0, 32);
    if (!sha512_256(pk).subarray(28).every((x, j) => x === decoded[32 + j])) return refuse();
  } else return refuse();
  if (pk.every((x) => x === 0)) return true;
  members.push([name, binOf(pk)]);
  return false;
}
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/**
 * StringCodec: raw bytes read as text with Node's `Buffer#toString("utf-8")`, which keeps a leading mark and reads a
 * sequence that is not UTF-8 as U+FFFD, written back unless empty. Bytes that are UTF-8 are written back as they are;
 * any others the facilitator writes back as other bytes than algod reads, so the two read different transactions.
 */
function facString(name: string, node: Node | undefined, members: [string, number[]][]): boolean {
  if (absent(node)) return true;
  const b = rawBytes(node);
  if (b.length === 0) return true;
  try {
    UTF8.decode(b);
  } catch {
    return refuse();
  }
  members.push([name, strOf(b)]);
  return false;
}

/** The multisignature codec; null when every member is at its default and the struct is left out. */
function facMultisig(node: Node): number[] | null {
  const m = membersOf(node);
  const members: [string, number[]][] = [];
  const v = facNumber("v", m.get("v"), members);
  let zero = facNumber("thr", m.get("thr"), members) && v;
  const subsig = m.get("subsig");
  if (!absent(subsig)) {
    if (subsig.k !== "array") return refuse();
    if (subsig.items.length > 0) {
      zero = false;
      const items = subsig.items.map((item) => {
        const s = membersOf(absent(item) ? undefined : item);
        const fields: [string, number[]][] = [];
        facFixed("pk", 32, s.get("pk"), fields);
        facFixed("s", 64, s.get("s"), fields);
        return mapOf(fields);
      });
      members.push(["subsig", [...arrayHead(items.length), ...items.flat()]]);
    }
  }
  return zero ? null : mapOf(members);
}

/** The facilitator's re-encoding of the signed transaction it reads, or a refusal. */
function facilitatorEncoding(root: Node): number[] {
  if (root.k === "nil") return refuse();
  const m = membersOf(root);
  const members: [string, number[]][] = [];
  facFixed("sig", 64, m.get("sig"), members);
  facAddress("sgnr", m.get("sgnr"), members);
  const msig = m.get("msig");
  if (!absent(msig)) {
    const enc = facMultisig(msig);
    if (enc !== null) members.push(["msig", enc]);
  }
  const lsig = m.get("lsig");
  if (!absent(lsig)) {
    const l = membersOf(lsig);
    const fields: [string, number[]][] = [];
    const logic = facBytes("l", l.get("l"), fields);
    let zero = facFixed("sig", 64, l.get("sig"), fields) && logic;
    for (const name of ["msig", "lmsig"]) {
      const node = l.get(name);
      if (absent(node)) continue;
      const enc = facMultisig(node);
      if (enc !== null) {
        fields.push([name, enc]);
        zero = false;
      }
    }
    const arg = l.get("arg");
    if (!absent(arg)) {
      if (arg.k !== "array") return refuse();
      if (arg.items.length > 0) {
        zero = false;
        fields.push(["arg", [...arrayHead(arg.items.length), ...arg.items.flatMap((x) => binOf(absent(x) ? new Uint8Array(0) : rawBytes(x)))]]);
      }
    }
    if (!zero) members.push(["lsig", mapOf(fields)]);
  }
  // The transaction: a map holding a type key, read as an asset transfer only when its type is the bytes "axfer".
  const txnNode = m.get("txn");
  if (txnNode?.k !== "map") return refuse();
  const t = membersOf(txnNode);
  const type = t.get("type");
  if (type === undefined || (type.k !== "str" && type.k !== "bin") || !sameAscii(type.b, "axfer")) return refuse();
  const txn: [string, number[]][] = [["type", strOf(ENC.encode("axfer"))]];
  for (const name of ["fee", "fv", "lv", "xaid", "aamt"]) {
    const v = facUint(t.get(name));
    if (v !== 0n) txn.push([name, uintBytes(v)]);
  }
  for (const name of ["snd", "rekey", "arcv", "asnd", "aclose"]) facAddress(name, t.get(name), txn);
  // The facilitator computes the payment's id before it submits the group (scheme.ts settle), and algokit's txId
  // refuses a transaction without a genesis hash.
  if (absent(t.get("gh"))) return refuse();
  for (const name of ["gh", "grp", "lx"]) facFixed(name, 32, t.get(name), txn);
  facBytes("note", t.get("note"), txn);
  facString("gen", t.get("gen"), txn);
  members.push(["txn", mapOf(txn)]);
  return mapOf(members);
}

// ---------------------------------------------------------------------------------------------------------------------

/** What `readEntry` reads from a payment entry both readers accept as one asset transfer. */
export interface AvmEntry {
  /** The transaction id algod computes: base32 of SHA-512/256 of "TX" and the transaction's canonical encoding. */
  txid: string;
  note: Uint8Array;
  lastValid: bigint;
}

const TX = ENC.encode("TX");

/**
 * Reads one payment entry as the x402 path reads it. The entry must be one msgpack value nesting at most `maxDepth`
 * deep. algod's reader (go-codec under go-algorand's handle) must decode it as a signed transaction whose type algod
 * knows, with no other type's member at a non-zero value; the facilitator's reader (algokit-utils' decoder) must
 * decode it as one asset transfer; and the canonical encodings of the two signed transactions must be equal, so both
 * read the same transaction. Gives "not-axfer" for an entry algod reads as a transaction of another type, and
 * "malformed" for every other entry either reader refuses or the two read differently.
 */
export function readEntry(b: Uint8Array, maxDepth: number): AvmEntry | "malformed" | "not-axfer" {
  const root = parse(b, maxDepth);
  if (root === null) return "malformed";
  try {
    const stxn = (root.k === "nil" ? zeroOf(SIGNED_TXN) : decodeInto(SIGNED_TXN, root, zeroOf(SIGNED_TXN))) as Fields;
    const txn = stxn["txn"] as Fields;
    if (wellTyped(txn) !== "axfer") return "not-axfer";
    if (!keysReadable(root)) return "malformed";
    const algod = marshal(SIGNED_TXN, stxn);
    const facilitator = facilitatorEncoding(root);
    if (algod.length !== facilitator.length || algod.some((x, j) => x !== facilitator[j])) return "malformed";
    const hash = sha512_256(Uint8Array.from([...TX, ...marshal(TRANSACTION, txn)]));
    return {
      txid: base32.encode(hash).replace(/=+$/, ""),
      note: (txn["note"] as Uint8Array | null) ?? new Uint8Array(0),
      lastValid: txn["lv"] as bigint,
    };
  } catch (e) {
    if (e instanceof Refused) return "malformed";
    throw e;
  }
}

/**
 * algorand-msgpack 1.1.0 with `useMap` refuses a map key that is not a string, a number, a bigint or a byte string,
 * at any depth: nil, a boolean, an array, a map or an extension.
 */
function keysReadable(node: Node): boolean {
  if (node.k === "array") return node.items.every(keysReadable);
  if (node.k !== "map") return true;
  return node.entries.every(([k, v]) => ["str", "bin", "int", "float"].includes(k.k) && keysReadable(v));
}
