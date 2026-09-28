/**
 * Cardano, and the `x402/exact/cardano` pairing: the ATR hash as a CIP-20 message (metadata label 674) that the
 * payer's signed body commits to through `auxiliary_data_hash`. The transaction id is the Blake2b-256 of the body as
 * received, so settlement is read by an id fixed before any money moves.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { fromLcpString, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { base64Bytes, hexOf, sameBytes } from "./rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  paymentWith,
  presentedWith,
  readFor,
  tie,
  type LcpPattern,
  type OptionFilter,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

export type CardanoNetwork = "cardano:mainnet" | "cardano:preprod" | "cardano:preview";

/** CIP-20 line 1 of the carrier; line 2 is the hash's 64 lowercase hex digits. */
export const LCP_MARKER = "lcp:sha256:0x";

export interface CardanoTx {
  txId: Hex;
  ttlSlot: bigint | null;
  h: AtrHash | Refusal;
}

export interface CardanoOnChain {
  blockHeight: bigint;
  slot: bigint;
  /** db-sync's `tx.valid_contract`. */
  valid: boolean;
  /** The transaction as included, when asked for. */
  cbor?: Uint8Array;
}

/** Bounded, read-only calls against one network's indexer. Every failure rejects with `ReaderError`. */
export interface CardanoReader {
  readonly network: CardanoNetwork;
  tip(): Promise<{ blockHeight: bigint; slot: bigint }>;
  transaction(txId: Hex, withCbor: boolean): Promise<CardanoOnChain | null>;
}

export interface CardanoRef {
  network: CardanoNetwork;
  txId: Hex;
  /** The last slot the transaction can land in, as a decimal string. */
  ttlSlot: string;
}

export type CardanoStatus =
  | { state: "settled"; confirmations: bigint; blockHeight: bigint }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "phase-2-invalid" | "expired" };

/** The payload x402's Cardano scheme defines. */
export interface CardanoPayload {
  transaction: string;
  nonce: string;
}

export interface CardanoPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: CardanoPayload;
  extensions?: PaymentRequired["extensions"];
}

export interface CardanoUnsigned {
  request: { kind: "cardano-transaction"; accepted: PaymentRequirements; auxiliaryData: Uint8Array };
  complete(signed: CardanoPayload): Promise<CardanoPaymentPayload | Refusal>;
}

const ID = "x402/exact/cardano" as const;
const MAX_TX_BYTES = 64 * 1024;
const MAX_DEPTH = 64;
const MAX_NONCE = 256;
const NETWORKS: Readonly<Record<string, CardanoNetwork>> = {
  "cardano:mainnet": "cardano:mainnet",
  "cardano:preprod": "cardano:preprod",
  "cardano:preview": "cardano:preview",
  "cip34:1-764824073": "cardano:mainnet",
  "cip34:0-1": "cardano:preprod",
  "cip34:0-2": "cardano:preview",
};
const METHODS: readonly unknown[] = [undefined, "script", "masumi"];
const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]{1,78}$/;
const LABEL_MESSAGE = 674n;
const TAG_ALONZO_AUX = 259n;

/**
 * The exact auxiliary data the payer attaches: `#6.259({0: {674: {"msg": [LCP_MARKER, <64 hex>]}}})`. A value that is
 * not a 32-byte hash is `x402/payload-malformed`.
 */
export function auxiliaryData(h: AtrHash): Uint8Array | Refusal {
  const hex = normalHash(h);
  if (hex === null) return refusal("x402/payload-malformed");
  const enc = new TextEncoder();
  return Uint8Array.from([
    0xd9, 0x01, 0x03, // tag 259
    0xa1, 0x00, // {0:
    0xa1, 0x19, 0x02, 0xa2, // {674:
    0xa1, 0x63, ...enc.encode("msg"), // {"msg":
    0x82, // [
    0x60 + LCP_MARKER.length, ...enc.encode(LCP_MARKER),
    0x78, 0x40, ...enc.encode(hex.slice(2)),
  ]);
}

/**
 * Decodes a base64 transaction `[body, witness set, bool, auxiliary data / nil]`, keeping each item's bytes as
 * received. The id is the Blake2b-256 of the body's bytes; the auxiliary data must hash to the body's key 7.
 */
export async function decodeCardanoTx(base64: string): Promise<CardanoTx | Refusal> {
  const bytes = base64Bytes(base64, MAX_TX_BYTES);
  if (bytes === "too-large") return refusal("cardano/tx-too-large");
  if (bytes === "malformed") return refusal("cardano/tx-malformed");
  return decodeBytes(bytes);
}

/**
 * Reads the recorded id. A failed read, or a reader for another network, is pending. An absent transaction is
 * expired once the tip's slot is past its TTL; a present one fails only when the ledger marks it invalid. Two calls.
 */
export async function cardanoStatus(ref: CardanoRef, reader: CardanoReader): Promise<CardanoStatus> {
  const unreadable = { state: "pending", why: "unreadable" } as const;
  if (reader.network !== ref.network) return unreadable;
  const ttlSlot = typeof ref.ttlSlot === "string" && DECIMAL.test(ref.ttlSlot) ? BigInt(ref.ttlSlot) : undefined;
  if (ttlSlot === undefined) return unreadable;
  try {
    const tip = await reader.tip();
    if (!isObject(tip) || typeof tip.blockHeight !== "bigint" || typeof tip.slot !== "bigint") return unreadable;
    const tx = await reader.transaction(ref.txId, false);
    if (tx === null) {
      return tip.slot > ttlSlot ? { state: "failed", why: "expired" } : { state: "pending", why: "not-found" };
    }
    if (!isOnChain(tx)) return unreadable;
    if (!tx.valid) return { state: "failed", why: "phase-2-invalid" };
    const depth = tip.blockHeight - tx.blockHeight;
    return { state: "settled", confirmations: depth > 0n ? depth : 0n, blockHeight: tx.blockHeight };
  } catch {
    return unreadable;
  }
}

/** Reads the hash back from the included transaction alone, by its id. One call. */
export async function cardanoRecover(
  ref: { network: CardanoNetwork; txId: Hex },
  reader: CardanoReader,
): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("cardano/wrong-reader");
  let tx: unknown;
  try {
    tx = await reader.transaction(ref.txId, true);
  } catch {
    return refusal("cardano/unreadable");
  }
  if (tx === null) return refusal("cardano/not-found");
  if (!isOnChain(tx)) return refusal("cardano/unreadable");
  if (!tx.valid) return refusal("cardano/not-valid");
  if (!(tx.cbor instanceof Uint8Array) || tx.cbor.length > MAX_TX_BYTES) return refusal("cardano/unreadable");
  const decoded = decodeBytes(tx.cbor);
  if (isRefusal(decoded)) return decoded;
  if (decoded.txId !== ref.txId.toLowerCase()) return refusal("cardano/unreadable");
  return decoded.h;
}

/** The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not. */
export function cardanoOptionCheck(option: unknown): Refusal | undefined {
  if (!isObject(option) || option["scheme"] !== "exact") return refusal("x402/option-not-this-pairing");
  const network = option["network"];
  if (typeof network !== "string" || !(network.startsWith("cardano:") || network.startsWith("cip34:"))) {
    return refusal("x402/option-not-this-pairing");
  }
  if (!Object.hasOwn(NETWORKS, network)) return refusal("cardano/network-malformed");
  const extra = option["extra"];
  if (extra !== undefined && !isObject(extra)) return refusal("x402/option-not-this-pairing");
  if (!METHODS.includes(extra?.["assetTransferMethod"])) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  const amount = option["amount"];
  if (typeof amount !== "string" || !DECIMAL.test(amount)) return refusal("x402/option-not-this-pairing");
  return undefined;
}

/** The filter step over `cardanoOptionCheck`. */
const cardanoFilter: OptionFilter = (o) => cardanoOptionCheck(o) ?? true;

/** This pairing's id for an option it can pay, or undefined. */
export function cardanoPairingOf(option: PaymentRequirements): typeof ID | undefined {
  return cardanoOptionCheck(option) === undefined ? ID : undefined;
}

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(cardanoFilter)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(cardanoFilter)(doc);
}

/** The wallet request: the scheme's payment with a TTL, and these auxiliary data committed in the signed body. */
async function build(
  choice: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<CardanoUnsigned | Refusal> {
  const ok = chosen(choice?.required, choice?.accepted, cardanoFilter);
  if (ok !== true) return ok;
  const accepted = choice.accepted;
  const expected = normalHash(h);
  if (expected === null) return refusal("x402/payload-malformed");
  const aux = auxiliaryData(expected);
  if (isRefusal(aux)) return aux;
  const { required } = choice;
  return {
    request: { kind: "cardano-transaction", accepted, auxiliaryData: aux },
    async complete(signed: CardanoPayload): Promise<CardanoPaymentPayload | Refusal> {
      const payment = paymentWith(required, accepted, signed);
      const got = await bound(payment);
      if (isRefusal(got) || got !== expected || isRefusal(await reference(payment))) {
        return refusal("x402/signed-not-bound");
      }
      return payment;
    },
  };
}

/** The hash in the CIP-20 message the signed body commits to. Witnesses are not verified here. */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const tx = await presentedTx(presented);
  return isRefusal(tx) ? tx : tx.tx.h;
}

/** The read keys for this payment: network, transaction id and TTL. */
async function reference(presented: unknown): Promise<CardanoRef | Refusal> {
  const tx = await presentedTx(presented);
  if (isRefusal(tx)) return tx;
  if (tx.tx.ttlSlot === null) return refusal("cardano/ttl-missing");
  return { network: tx.network, txId: tx.tx.txId, ttlSlot: tx.tx.ttlSlot.toString() };
}

async function presentedTx(presented: unknown): Promise<{ network: CardanoNetwork; tx: CardanoTx } | Refusal> {
  const parts = presentedWith(presented, cardanoFilter);
  if (isRefusal(parts)) return parts;
  const { transaction, nonce } = parts.payload;
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  if (typeof nonce !== "string" || nonce.length > MAX_NONCE) return refusal("x402/payload-malformed");
  const tx = await decodeCardanoTx(transaction);
  if (isRefusal(tx)) return tx;
  return { network: NETWORKS[parts.accepted.network]!, tx };
}

/** The option unchanged: the hash rides in the transaction's metadata, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: ID,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a Cardano transaction whose body commits, through its auxiliary_data_hash, to a CIP-20 " +
    "message (label 674) carrying this ATR's hash. The ledger included the transaction as valid, at the stated " +
    "depth; the rail allows a rollback of fewer than k blocks. The hash is in the transaction's metadata on chain. " +
    "This does not show that amount, payee, asset or timing match the ATR's content.",
});

export const exactCardano = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: cardanoStatus,
  recover: cardanoRecover,
});

function decodeBytes(bytes: Uint8Array): CardanoTx | Refusal {
  let top: Item;
  try {
    const r = new CborReader(bytes);
    top = r.item(0);
    if (r.at !== bytes.length) return refusal("cardano/tx-malformed");
  } catch {
    return refusal("cardano/tx-malformed");
  }
  if (top.kind !== "array" || top.items.length !== 4) return refusal("cardano/tx-malformed");
  const [body, , valid, aux] = top.items as [Item, Item, Item, Item];
  if (body.kind !== "map" || !(valid.kind === "simple" && (valid.value === 20 || valid.value === 21))) {
    return refusal("cardano/tx-malformed");
  }
  const fields = new Map<bigint, Item>();
  for (const [k, v] of body.entries) {
    if (k.kind !== "uint" || fields.has(k.value)) return refusal("cardano/tx-malformed");
    fields.set(k.value, v);
  }
  const ttl = fields.get(3n);
  if (ttl !== undefined && ttl.kind !== "uint") return refusal("cardano/tx-malformed");
  const auxHash = fields.get(7n);
  const txId = hexOf(blake2b(bytes.subarray(body.start, body.end), { dkLen: 32 }));
  const ttlSlot = ttl === undefined ? null : ttl.value;

  if (auxHash === undefined || (aux.kind === "simple" && aux.value === 22)) return refusal("cardano/aux-missing");
  if (auxHash.kind !== "bytes" || auxHash.value.length !== 32) return refusal("cardano/tx-malformed");
  if (!sameBytes(blake2b(bytes.subarray(aux.start, aux.end), { dkLen: 32 }), auxHash.value)) {
    return refusal("cardano/aux-hash-mismatch");
  }
  return { txId, ttlSlot, h: carrier(aux) };
}

/**
 * The hash in label 674's `"msg"` lines: exactly one line equal to `LCP_MARKER`, followed by a line of 64 lowercase hex
 * digits. The metadata may hold label 674 once, and its map may not repeat a key, so every reader of the message
 * reads the same lines. Marker lines are counted ignoring case and a leading byte-order mark: more than one is
 * `cardano/ambiguous`, and one that is not exactly `LCP_MARKER` followed by lowercase hex carries no hash.
 */
function carrier(aux: Item): AtrHash | Refusal {
  const metadata = metadataOf(aux);
  const messages = (metadata?.entries ?? []).filter(([l]) => l.kind === "uint" && l.value === LABEL_MESSAGE);
  if (messages.length > 1) return refusal("cardano/ambiguous");
  const message = messages[0]?.[1];
  const candidates: [Item, Item | undefined][] = [];
  if (message?.kind === "map") {
    const keys = new Set<string>();
    for (const [key] of message.entries) {
      const k = keyOf(key);
      if (keys.has(k)) return refusal("cardano/ambiguous");
      keys.add(k);
    }
    for (const [key, lines] of message.entries) {
      if (key.kind !== "text" || key.value !== "msg" || lines.kind !== "array") continue;
      lines.items.forEach((line, i) => {
        if (line.kind === "text" && isMarkerLike(line.value)) candidates.push([line, lines.items[i + 1]]);
      });
    }
  }
  if (candidates.length > 1) return refusal("cardano/ambiguous");
  const [marker, digits] = candidates[0] ?? [];
  if (marker?.kind !== "text" || marker.value !== LCP_MARKER || digits?.kind !== "text" || !HEX64.test(digits.value)) {
    return refusal("cardano/hash-not-carried");
  }
  return fromLcpString(LCP_MARKER + digits.value) ?? refusal("cardano/hash-not-carried");
}

/** A line that reads as `LCP_MARKER` once case and a leading byte-order mark are ignored. */
function isMarkerLike(line: string): boolean {
  return line.replace(/^\uFEFF/, "").toLowerCase() === LCP_MARKER;
}

/**
 * A map key's identity as a decoded value, so that two encodings of one value are the same key. A text key is
 * compared without a leading byte-order mark, and every float is one key.
 */
function keyOf(k: Item): string {
  switch (k.kind) {
    case "uint":
      return `u${k.value}`;
    case "nint":
      return `n${k.value}`;
    case "bytes":
      return `b${hexOf(k.value)}`;
    case "text":
      return `t${JSON.stringify(k.value.replace(/^\uFEFF/, ""))}`;
    case "array":
      return `a[${k.items.map(keyOf).join(",")}]`;
    case "map":
      return `m{${k.entries.map(([a, b]) => `${keyOf(a)}:${keyOf(b)}`).join(",")}}`;
    case "tag":
      return `g${k.tag}(${keyOf(k.item)})`;
    case "simple":
      return `s${k.value}`;
    case "float":
      return "f";
  }
}

/** The metadata map of the three auxiliary data forms: a map, `[metadata, scripts]`, or tag 259 with key 0. */
function metadataOf(aux: Item): (Item & { kind: "map" }) | undefined {
  if (aux.kind === "map") return aux;
  if (aux.kind === "array") {
    const first = aux.items[0];
    return first?.kind === "map" ? first : undefined;
  }
  if (aux.kind === "tag" && aux.tag === TAG_ALONZO_AUX && aux.item.kind === "map") {
    for (const [k, v] of aux.item.entries) {
      if (k.kind === "uint" && k.value === 0n && v.kind === "map") return v;
    }
  }
  return undefined;
}

function isOnChain(t: unknown): t is CardanoOnChain {
  return (
    isObject(t) &&
    typeof t["blockHeight"] === "bigint" &&
    typeof t["slot"] === "bigint" &&
    typeof t["valid"] === "boolean" &&
    (t["cbor"] === undefined || t["cbor"] instanceof Uint8Array)
  );
}

type Item = { start: number; end: number } & (
  | { kind: "uint"; value: bigint }
  | { kind: "nint"; value: bigint }
  | { kind: "bytes"; value: Uint8Array }
  | { kind: "text"; value: string }
  | { kind: "array"; items: Item[] }
  | { kind: "map"; entries: [Item, Item][] }
  | { kind: "tag"; tag: bigint; item: Item }
  | { kind: "simple"; value: number }
  | { kind: "float" }
);

/**
 * A bounded CBOR reader (RFC 8949) that keeps each item's byte span. Definite and indefinite lengths and tags are
 * read; nesting is at most 64 deep. Text keeps a leading byte-order mark. Anything malformed throws, and the caller
 * turns that into a refusal.
 */
class CborReader {
  at = 0;
  private readonly text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  constructor(private readonly b: Uint8Array) {}

  item(depth: number): Item {
    if (depth > MAX_DEPTH) throw new RangeError("too deep");
    const start = this.at;
    const head = this.byte();
    const major = head >> 5;
    const info = head & 0x1f;
    if (info === 31) return this.indefinite(major, start, depth);
    const arg = this.argument(info);
    switch (major) {
      case 0:
        return { kind: "uint", value: arg, start, end: this.at };
      case 1:
        return { kind: "nint", value: -1n - arg, start, end: this.at };
      case 2:
        return { kind: "bytes", value: this.take(arg), start, end: this.at };
      case 3:
        return { kind: "text", value: this.text.decode(this.take(arg)), start, end: this.at };
      case 4: {
        const items: Item[] = [];
        for (let i = 0n; i < arg; i++) items.push(this.item(depth + 1));
        return { kind: "array", items, start, end: this.at };
      }
      case 5: {
        const entries: [Item, Item][] = [];
        for (let i = 0n; i < arg; i++) entries.push([this.item(depth + 1), this.item(depth + 1)]);
        return { kind: "map", entries, start, end: this.at };
      }
      case 6:
        return { kind: "tag", tag: arg, item: this.item(depth + 1), start, end: this.at };
      default:
        if (info >= 25) return { kind: "float", start, end: this.at };
        if (info === 24 && arg < 32n) throw new RangeError("simple value");
        return { kind: "simple", value: Number(arg), start, end: this.at };
    }
  }

  private indefinite(major: number, start: number, depth: number): Item {
    if (major === 2 || major === 3) {
      const chunks: Uint8Array[] = [];
      while (!this.isBreak()) {
        const head = this.byte();
        if (head >> 5 !== major || (head & 0x1f) === 31) throw new RangeError("chunk");
        chunks.push(this.take(this.argument(head & 0x1f)));
      }
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        all.set(c, o);
        o += c.length;
      }
      return major === 2
        ? { kind: "bytes", value: all, start, end: this.at }
        : { kind: "text", value: this.text.decode(all), start, end: this.at };
    }
    if (major === 4) {
      const items: Item[] = [];
      while (!this.isBreak()) items.push(this.item(depth + 1));
      return { kind: "array", items, start, end: this.at };
    }
    if (major === 5) {
      const entries: [Item, Item][] = [];
      while (!this.isBreak()) entries.push([this.item(depth + 1), this.item(depth + 1)]);
      return { kind: "map", entries, start, end: this.at };
    }
    throw new RangeError("indefinite");
  }

  /** Consumes a break byte when one is next. */
  private isBreak(): boolean {
    if (this.at >= this.b.length) throw new RangeError("short");
    if (this.b[this.at] !== 0xff) return false;
    this.at++;
    return true;
  }

  private argument(info: number): bigint {
    if (info < 24) return BigInt(info);
    if (info > 27) throw new RangeError("reserved");
    const n = 1 << (info - 24);
    let v = 0n;
    for (const x of this.take(BigInt(n))) v = (v << 8n) | BigInt(x);
    return v;
  }

  private byte(): number {
    if (this.at >= this.b.length) throw new RangeError("short");
    return this.b[this.at++]!;
  }

  private take(n: bigint): Uint8Array {
    if (n > BigInt(this.b.length - this.at)) throw new RangeError("short");
    const out = this.b.subarray(this.at, this.at + Number(n));
    this.at += Number(n);
    return out;
  }
}
