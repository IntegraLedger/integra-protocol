/**
 * Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one
 * extrinsic whose call is `utility.batch_all([assets.transfer_keep_alive, system.remark_with_event])` with the ATR
 * hash's LCP string as the remark; the settlement is read by block and index through Sidecar. SCALE is encoded and
 * decoded here for these shapes only.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { base58 } from "@scure/base";
import { fromLcpString, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import type { PolkadotPaymentPayload } from "./internal/polkadot.js";
import { advertiseFor, chosen, isAmount, isTimeoutSeconds, paymentWith, presentedWith, readFor, x402Broadcaster, type X402Read, type X402Forms } from "./internal/x402.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { POLKADOT } from "./internal/data/polkadot.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import { decide, type Facts, type RecoverInput, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import { actSeen, bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

export type PolkadotNetwork = "polkadot:68d56f15f85d3136970ec16946040bc1" | "polkadot:67f9723393ef76214df0118c34bbbd3d";
const POLKADOT_NETWORKS: readonly PolkadotNetwork[] = Object.freeze([
  "polkadot:68d56f15f85d3136970ec16946040bc1",
  "polkadot:67f9723393ef76214df0118c34bbbd3d",
]);

/** The profile's `assetTransferMethod`. */
export const LCP_ASSETS_REMARK = "lcp-assets-remark";

/** Pallet and call indices, the same on both networks. */
export const CALL = Object.freeze({
  batchAll: Object.freeze([40, 2]),
  transferKeepAlive: Object.freeze([50, 9]),
  remarkWithEvent: Object.freeze([0, 7]),
} as const);

/**
 * The profile's call. `B` is what its bytes are backed by: `decodeProfileCall` gives `ProfileCall<ArrayBuffer>`, each
 * byte field in its own fresh `ArrayBuffer`, and `encodeProfileCall` takes any backing.
 */
export interface ProfileCall<B extends ArrayBufferLike = ArrayBufferLike> {
  assetId: number;
  dest: Uint8Array<B>;
  amount: bigint;
  remark: Uint8Array<B>;
}

export interface PolkadotExtrinsic {
  at: { height: bigint; hash: Hex };
  hash: Hex;
  success: boolean;
  events: readonly { pallet: string; method: string; data: readonly Json[] }[];
}

/** Bounded, read-only calls against one network's Sidecar. Every failure rejects. */
export interface PolkadotReader {
  readonly network: PolkadotNetwork;
  /** `GET /blocks/{block}/extrinsics/{index}`; null when the block or extrinsic does not exist. */
  extrinsic(block: Hex | bigint, index: number): Promise<PolkadotExtrinsic | null>;
  /** `GET /blocks/{block}/extrinsics-raw`; null when the block does not exist. */
  rawExtrinsics(block: Hex | bigint): Promise<readonly Hex[] | null>;
  /** `GET /blocks/head/header` → number: the most recently finalized height. */
  finalizedHeight(): Promise<bigint>;
}

/**
 * The read keys: the accepted option's network, the extrinsic's hash and the call's asset from the signed bytes, and
 * the payee, the `payTo` of the option the payment answers.
 */
export interface PolkadotRef {
  network: PolkadotNetwork;
  payee: string;
  extrinsicHash: Hex;
  assetId: number;
}

/**
 * The answer of `polkadotStatus`, as the profile `read-status` gives it. Its marks are `head` and `finalized`, in that
 * order, and its position the block height. An answer that names a transaction names the timepoint it read,
 * `<block hash>-<index>`: the one given, or the canonical one when the given block left the chain and the canonical
 * block at that height holds the same extrinsic at that index.
 */
export type PolkadotStatus = StatusAnswer<bigint, PolkadotMark>;

type PolkadotMark = "head" | "finalized";
const MARKS: readonly PolkadotMark[] = ["head", "finalized"];

/**
 * What the read of the extrinsic at its timepoint found. `not-located`: no timepoint was given, or the block it names
 * left the chain with no copy of the extrinsic at that index of the canonical block.
 */
type PolkadotRead =
  | { state: "settled"; finality: PolkadotMark; height: bigint; transaction: string }
  | { state: "pending"; why: "not-located" | "not-found" }
  | {
      state: "failed";
      why: "not-this-extrinsic" | "dispatch-failed" | "no-remark" | "no-transfer";
      finality: PolkadotMark;
      height: bigint;
      transaction: string;
    }
  | { state: "unreadable"; reason: UnreadableReason };

/** The call the payer's signer wraps in an extrinsic, and how that extrinsic completes the payment. */
export interface PolkadotUnsigned {
  request: { kind: "substrate-call"; network: PolkadotNetwork; call: Uint8Array<ArrayBuffer> };
  complete(extrinsic: Uint8Array): PolkadotPaymentPayload | Refusal;
}

const ID = "x402/exact/polkadot/lcp-assets-remark" as const;
const MAX_EXTRINSIC = 4096;
const REMARK_LENGTH = 77;
/** The longest profile call: both compacts in their widest form, a `u32` asset id and a `u128` amount. */
const MAX_CALL = 141;
const MAX_RANGE = 255n;
const U32_LIMIT = 1n << 32n;
const U128_LIMIT = 1n << 128n;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const LOWER_HEX = /^0x(?:[0-9a-f]{2})*$/;
const TIMEPOINT = /^(0x[0-9a-fA-F]{64})-(0|[1-9][0-9]{0,9})$/;
const BARE_HASH = /^0x[0-9a-fA-F]{64}$/;
const SS58_PREFIX = new TextEncoder().encode("SS58PRE");
const ENCODER = new TextEncoder();
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ── bytes ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function toHex(b: Uint8Array): Hex {
  let s = "0x";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s as Hex;
}

function fromHex(h: string): Uint8Array {
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

function concat(...parts: readonly (Uint8Array | readonly number[])[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** SCALE `Compact<uN>`, in its shortest mode. */
function compact(v: bigint): Uint8Array {
  if (v < 1n << 6n) return Uint8Array.of(Number(v << 2n));
  if (v < 1n << 14n) {
    const x = Number((v << 2n) | 1n);
    return Uint8Array.of(x & 0xff, x >> 8);
  }
  if (v < 1n << 30n) {
    const x = (v << 2n) | 2n;
    return Uint8Array.from([0, 1, 2, 3].map((i) => Number((x >> BigInt(8 * i)) & 0xffn)));
  }
  const bytes: number[] = [];
  for (let x = v; x > 0n; x >>= 8n) bytes.push(Number(x & 0xffn));
  return Uint8Array.from([((bytes.length - 4) << 2) | 3, ...bytes]);
}

/** A canonical `Compact<uN>` at `at`: the value and the index after it, or null. */
function compactAt(b: Uint8Array, at: number): { value: bigint; next: number } | null {
  const first = b[at];
  if (first === undefined) return null;
  const mode = first & 3;
  let value: bigint;
  let next: number;
  if (mode === 0) {
    value = BigInt(first >> 2);
    next = at + 1;
  } else if (mode === 1 || mode === 2) {
    const size = mode === 1 ? 2 : 4;
    if (at + size > b.length) return null;
    let x = 0n;
    for (let i = size - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[at + i]!);
    value = x >> 2n;
    next = at + size;
  } else {
    const size = (first >> 2) + 4;
    if (size > 17 || at + 1 + size > b.length) return null;
    let x = 0n;
    for (let i = size; i >= 1; i--) x = (x << 8n) | BigInt(b[at + i]!);
    value = x;
    next = at + 1 + size;
  }
  return equalBytes(compact(value), b.subarray(at, next)) ? { value, next } : null;
}

function blake256(b: Uint8Array): Uint8Array {
  return blake2b(b, { dkLen: 32 });
}

// ── SS58, SCALE and the extrinsic ────────────────────────────────────────────────────────────────────────────────────

/** A simple-format SS58 address: one prefix byte 0–63, a 32-byte account, and a two-byte checksum. */
export function ss58Decode(address: string): Uint8Array<ArrayBuffer> | Refusal {
  if (typeof address !== "string" || address.length > 64) return refusal("polkadot/address-malformed");
  let raw: Uint8Array;
  try {
    raw = base58.decode(address);
  } catch {
    return refusal("polkadot/address-malformed");
  }
  if (raw.length !== 35 || raw[0]! > 63) return refusal("polkadot/address-malformed");
  const sum = blake2b(concat(SS58_PREFIX, raw.subarray(0, 33)), { dkLen: 64 });
  if (sum[0] !== raw[33] || sum[1] !== raw[34]) return refusal("polkadot/address-malformed");
  return Uint8Array.from(raw.subarray(1, 33));
}

/**
 * `batch_all([transfer_keep_alive(assetId, Id(dest), amount), remark_with_event(remark)])`, the inverse of
 * `decodeProfileCall`. Throws TypeError on a call that `decodeProfileCall` never gives: `assetId` must be an integer
 * from 0 to 2^32 − 1, `dest` 32 bytes, `amount` a bigint from 0 to 2^128 − 1, and `remark` 77 bytes.
 */
export function encodeProfileCall(c: ProfileCall): Uint8Array<ArrayBuffer> {
  if (!isObject(c)) throw new TypeError("not a profile call");
  // Each member is read once, so what is checked is what is encoded.
  const { assetId, dest, amount, remark } = c;
  if (
    !isAssetId(assetId) ||
    !(dest instanceof Uint8Array) ||
    dest.length !== 32 ||
    typeof amount !== "bigint" ||
    amount < 0n ||
    amount >= U128_LIMIT ||
    !(remark instanceof Uint8Array) ||
    remark.length !== REMARK_LENGTH
  ) {
    throw new TypeError("not a profile call");
  }
  return concat(
    CALL.batchAll,
    [0x08],
    CALL.transferKeepAlive,
    compact(BigInt(assetId)),
    [0x00],
    dest,
    compact(amount),
    CALL.remarkWithEvent,
    compact(BigInt(remark.length)),
    remark,
  );
}

/** The profile's call, exactly, with canonical compacts and no trailing byte. Its bytes are copies of `call`'s. */
export function decodeProfileCall(call: Uint8Array): ProfileCall<ArrayBuffer> | Refusal {
  const no = refusal("polkadot/call-not-profile");
  if (!(call instanceof Uint8Array)) return no;
  const head = concat(CALL.batchAll, [0x08], CALL.transferKeepAlive);
  if (!equalBytes(call.subarray(0, head.length), head)) return no;
  const asset = compactAt(call, head.length);
  if (asset === null || asset.value >= U32_LIMIT || call[asset.next] !== 0x00) return no;
  const destAt = asset.next + 1;
  const dest = call.subarray(destAt, destAt + 32);
  if (dest.length !== 32) return no;
  const amount = compactAt(call, destAt + 32);
  if (amount === null || amount.value >= U128_LIMIT) return no;
  const r = amount.next;
  if (call[r] !== CALL.remarkWithEvent[0] || call[r + 1] !== CALL.remarkWithEvent[1]) return no;
  const length = compactAt(call, r + 2);
  if (length === null || length.value !== BigInt(REMARK_LENGTH) || length.next + REMARK_LENGTH !== call.length) return no;
  return {
    assetId: Number(asset.value),
    dest: new Uint8Array(dest),
    amount: amount.value,
    remark: new Uint8Array(call.subarray(length.next)),
  };
}

/**
 * The preamble of a signed v4 extrinsic: the length prefix, `0x84`, `MultiAddress::Id` and a `MultiSignature`. Gives
 * the signer, a copy, and the index after the signature; the extension bytes that follow are not decoded.
 */
export function splitSigned(xt: Uint8Array): { signer: Uint8Array<ArrayBuffer>; end: number } | Refusal {
  if (!(xt instanceof Uint8Array)) return refusal("polkadot/extrinsic-malformed");
  if (xt.length > MAX_EXTRINSIC) return refusal("polkadot/extrinsic-too-large");
  const length = compactAt(xt, 0);
  if (length === null || length.value !== BigInt(xt.length - length.next)) return refusal("polkadot/extrinsic-malformed");
  let at = length.next;
  if (xt[at] !== 0x84) return refusal("polkadot/not-signed-v4");
  at += 1;
  if (xt[at] !== 0x00 || at + 33 > xt.length) return refusal("polkadot/address-not-id");
  const signer = new Uint8Array(xt.subarray(at + 1, at + 33));
  at += 33;
  const variant = xt[at];
  const size = variant === 0 || variant === 1 ? 64 : variant === 2 || variant === 3 ? 65 : -1;
  if (size < 0 || at + 1 + size > xt.length) return refusal("polkadot/signature-malformed");
  return { signer, end: at + 1 + size };
}

/**
 * BLAKE2b-256 of the extrinsic's bytes, its length prefix included. Throws TypeError when `xt` is not a
 * `Uint8Array`.
 */
export function extrinsicHash(xt: Uint8Array): Hex {
  return toHex(blake256(xt));
}

// ── the options ──────────────────────────────────────────────────────────────────────────────────────────────────────

function isNetwork(s: unknown): s is PolkadotNetwork {
  return typeof s === "string" && (POLKADOT_NETWORKS as readonly string[]).includes(s);
}

function check(o: PaymentRequirements): true | Refusal | undefined {
  if (!isObject(o) || typeof o.network !== "string" || !o.network.startsWith("polkadot:")) return undefined;
  if (o.scheme !== "exact") return undefined;
  if (!isNetwork(o.network)) return refusal("polkadot/network-unsupported");
  const extra = o.extra;
  if (!isObject(extra) || extra["assetTransferMethod"] !== LCP_ASSETS_REMARK) return refusal("polkadot/option-malformed");
  const flow = extra["paymentFlow"];
  if (flow !== undefined && flow !== "authorization" && flow !== "upfront") return refusal("polkadot/option-malformed");
  if (typeof o.asset !== "string" || !DECIMAL.test(o.asset) || BigInt(o.asset) >= U32_LIMIT) {
    return refusal("polkadot/option-malformed");
  }
  if (!isAmount(o.amount) || BigInt(o.amount) >= U128_LIMIT) return refusal("polkadot/option-malformed");
  if (!isTimeoutSeconds(o.maxTimeoutSeconds) || o.maxTimeoutSeconds > 3600) {
    return refusal("polkadot/option-malformed");
  }
  const dest = ss58Decode(o.payTo);
  return isRefusal(dest) ? dest : true;
}

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(check)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(check)(doc);
}

/** The extrinsic ends with the call, which starts at or after the signature's end. */
function withSuffix(xt: Uint8Array, call: Uint8Array): true | Refusal {
  const split = splitSigned(xt);
  if (isRefusal(split)) return split;
  const start = xt.length - call.length;
  if (start < split.end || !equalBytes(xt.subarray(start), call)) return refusal("polkadot/call-not-suffix");
  return true;
}

/** The profile call for the chosen option, the hash's LCP string as its remark. */
async function build(
  c: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<PolkadotUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("polkadot/option-malformed");
  const ok = chosen(c.required, c.accepted, check);
  if (ok !== true) return ok;
  const { required, accepted } = c;
  const call = encodeProfileCall({
    assetId: Number(accepted.asset),
    dest: ss58Decode(accepted.payTo) as Uint8Array,
    amount: BigInt(accepted.amount),
    remark: ENCODER.encode(toLcpString(nh)),
  });
  return {
    request: { kind: "substrate-call", network: accepted.network as PolkadotNetwork, call: call.slice() },
    complete(extrinsic: Uint8Array): PolkadotPaymentPayload | Refusal {
      const ok = withSuffix(extrinsic, call);
      if (ok !== true) return ok;
      return paymentWith(required, accepted, { extrinsic: toHex(extrinsic), call: toHex(call) });
    },
  };
}

/**
 * The hash a remark carries: the remark must be exactly `utf8(toLcpString(h))`, LCP's string form with lowercase hex,
 * because the chain's `Remarked` event hashes the remark's bytes as signed.
 */
function remarkCarrier(remark: Uint8Array): AtrHash | null {
  let h: AtrHash | null;
  try {
    h = fromLcpString(UTF8.decode(remark));
  } catch {
    return null;
  }
  return h !== null && equalBytes(remark, ENCODER.encode(toLcpString(h))) ? h : null;
}

function carriedOf(
  presented: unknown,
): { network: PolkadotNetwork; xt: Uint8Array; call: ProfileCall; h: AtrHash } | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const { extrinsic, call } = p.payload;
  if (typeof extrinsic !== "string" || !LOWER_HEX.test(extrinsic)) return refusal("polkadot/extrinsic-malformed");
  if (extrinsic.length > 2 * MAX_EXTRINSIC + 2) return refusal("polkadot/extrinsic-too-large");
  if (typeof call !== "string" || !LOWER_HEX.test(call)) return refusal("polkadot/call-not-profile");
  const xt = fromHex(extrinsic);
  const callBytes = fromHex(call);
  const ok = withSuffix(xt, callBytes);
  if (ok !== true) return ok;
  const decoded = decodeProfileCall(callBytes);
  if (isRefusal(decoded)) return decoded;
  const h = remarkCarrier(decoded.remark);
  if (h === null) return refusal("polkadot/remark-not-lcp");
  return { network: p.accepted.network as PolkadotNetwork, xt, call: decoded, h };
}

/**
 * The hash inside what the payer signed: the remark of the profile call the extrinsic ends with, which must be the
 * hash's LCP string form with lowercase hex, byte for byte. Amount, payee, asset, signer and timing are not read, and
 * no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const c = carriedOf(presented);
  return isRefusal(c) ? c : c.h;
}

/**
 * The accepted option's network, the extrinsic's hash and the call's asset from the signed bytes, and the payee, the
 * `payTo` of the option the payment answers.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<PolkadotRef | Refusal> {
  const c = carriedOf(presented);
  if (isRefusal(c)) return c;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  return { network: c.network, payee, extrinsicHash: extrinsicHash(c.xt), assetId: c.call.assetId };
}

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────────

function isExtrinsic(x: unknown): x is PolkadotExtrinsic {
  if (!isObject(x) || !isObject(x["at"]) || typeof x["hash"] !== "string" || typeof x["success"] !== "boolean") {
    return false;
  }
  const at = x["at"];
  return typeof at["height"] === "bigint" && typeof at["hash"] === "string" && Array.isArray(x["events"]);
}

/** A read's answer, or `unreadable` where the read rejected. */
type Read<T> = { ok: T } | { unreadable: true };

async function readSafely<T>(f: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: await f() };
  } catch {
    return { unreadable: true };
  }
}

function hasEvent(x: PolkadotExtrinsic, pallet: string, method: string, test: (data: readonly Json[]) => boolean): boolean {
  return x.events.some(
    (e) => isObject(e) && e.pallet === pallet && e.method === method && Array.isArray(e.data) && test(e.data),
  );
}

/** The `Remarked` event for this remark: its `data[1]` is the BLAKE2b-256 of the remark's bytes. */
function remarked(x: PolkadotExtrinsic, remark: Uint8Array): boolean {
  const remarkHash = toHex(blake256(remark));
  return hasEvent(x, "system", "Remarked", (d) => typeof d[1] === "string" && hashEquals(d[1], remarkHash));
}

/** An asset id as the call encodes it and `reference` writes it: an integer from 0 below 2^32. */
function isAssetId(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) >= 0 && BigInt(n as number) < U32_LIMIT;
}

/** A `Transferred` event of the asset: its `data[0]` is the asset id, in decimal. */
function transferred(x: PolkadotExtrinsic, assetId: number): boolean {
  const asset = String(assetId);
  return hasEvent(x, "assets", "Transferred", (d) => (typeof d[0] === "string" || typeof d[0] === "number") && String(d[0]) === asset);
}

/** Why the extrinsic at the timepoint is not this payment, or undefined when it is. */
function failureOf(
  found: PolkadotExtrinsic,
  ref: PolkadotRef,
  h: AtrHash,
): "not-this-extrinsic" | "dispatch-failed" | "no-remark" | "no-transfer" | undefined {
  if (!hashEquals(found.hash, ref.extrinsicHash)) return "not-this-extrinsic";
  if (!found.success) return "dispatch-failed";
  if (!remarked(found, ENCODER.encode(toLcpString(h)))) return "no-remark";
  return transferred(found, ref.assetId) ? undefined : "no-transfer";
}

/**
 * The record a read answers from, by the finality of the extrinsic found at `block`-`index`. While the finalized
 * height is below its block's, it is the record found, at `head`. Once the finalized chain holds that height, it is the
 * record found when the canonical block there is `block`, or the canonical block's record when that block holds the
 * extrinsic with hash `xtHash` at the same index; either is `finalized`. Otherwise it is `not-located`. A failed read
 * is `transport`, and an answer that is not a height or a record `unparseable`.
 */
async function finalRecord(
  reader: PolkadotReader,
  found: PolkadotExtrinsic,
  block: Hex,
  index: number,
  xtHash: string,
): Promise<{ read: PolkadotExtrinsic; finality: PolkadotMark } | "not-located" | "transport" | "unparseable"> {
  const height = found.at.height;
  const finalized = await readSafely(() => reader.finalizedHeight());
  if ("unreadable" in finalized) return "transport";
  if (typeof finalized.ok !== "bigint") return "unparseable";
  if (finalized.ok < height) return { read: found, finality: "head" };
  const canonical = await readSafely(() => reader.extrinsic(height, index));
  if ("unreadable" in canonical) return "transport";
  if (canonical.ok === null) return "not-located";
  if (!isExtrinsic(canonical.ok)) return "unparseable";
  if (hashEquals(canonical.ok.at.hash, block)) return { read: found, finality: "finalized" };
  if (canonical.ok.at.height === height && hashEquals(canonical.ok.hash, xtHash)) {
    return { read: canonical.ok, finality: "finalized" };
  }
  return "not-located";
}

/**
 * Answers the read of the extrinsic at its timepoint `<block hash>-<index>` as the profile `read-status` gives it. The
 * extrinsic is the payer's act when it has the recorded hash, dispatched, and carries the `Remarked` event for this
 * hash's remark and a `Transferred` event of the recorded asset, at the mark of the read: `finalized` when the
 * finalized chain holds that block, `head` when it is above the finalized height; its position is the block's height.
 * When the finalized chain holds another block at that height, the extrinsic at the same index of the canonical block
 * is read instead if its hash is the recorded one. An extrinsic with the recorded hash that did not dispatch is the
 * payer's act included with a failed result, which took the account's nonce. An extrinsic with another hash, or with
 * no `Remarked` or `Transferred` event of the payment, carries no act of the payer's that binds H; a bare broadcast
 * hash, a block the reader does not have, and a block that left the chain with no copy of the extrinsic name no
 * included act. The read holds no search for H and does not read the account's nonce, so none of these answers
 * `failed`. A read that rejects is unreadable `transport`, an answer that is not a record or a height `unparseable`,
 * and a reader for another network than the ref's `chain-mismatch`. A ref, a reader or a query that is not one, a
 * reader that names no network, or a ref whose network is not a Polkadot network, whose `extrinsicHash` is not `0x`
 * and 64 hex digits, whose `assetId` is not an integer from 0 below 2^32, whose `h` is not a hash or whose
 * `transaction` is neither a timepoint nor a bare hash, is unreadable `unparseable`, with nothing read.
 */
export async function polkadotStatus(
  ref: PolkadotRef & { h: AtrHash; transaction: string },
  reader: PolkadotReader,
  query: StatusQuery<PolkadotRef & { h: AtrHash; transaction: string }, bigint, PolkadotMark>,
): Promise<PolkadotStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint")) return UNPARSEABLE;
  return decide(factsOf(await readPolkadot(ref, reader)), query, LEDGER);
}

const LEDGER = ledgerOf<bigint, PolkadotMark>(POLKADOT[ID].coverage, MARKS, bigintOrder);

async function readPolkadot(ref: PolkadotRef & { h: AtrHash; transaction: string }, reader: PolkadotReader): Promise<PolkadotRead> {
  const unparseable = { state: "unreadable", reason: "unparseable" } as const;
  if (!isObject(ref) || !isObject(reader) || typeof reader.network !== "string") return unparseable;
  if (!isNetwork(ref.network) || normalHash(ref.extrinsicHash) === null || !isAssetId(ref.assetId)) return unparseable;
  if (typeof ref.transaction !== "string" || normalHash(ref.h) === null) return unparseable;
  const tp = TIMEPOINT.exec(ref.transaction);
  if (tp === null && !BARE_HASH.test(ref.transaction)) return unparseable;
  if (reader.network !== ref.network) return { state: "unreadable", reason: "chain-mismatch" };
  if (tp === null) return { state: "pending", why: "not-located" };
  const block = tp[1]! as Hex;
  const index = Number(tp[2]);
  const nh = normalHash(ref.h)!;

  const x = await readSafely(() => reader.extrinsic(block, index));
  if ("unreadable" in x) return { state: "unreadable", reason: "transport" };
  if (x.ok === null) return { state: "pending", why: "not-found" };
  if (!isExtrinsic(x.ok)) return unparseable;
  const at = await finalRecord(reader, x.ok, block, index, ref.extrinsicHash);
  if (at === "transport" || at === "unparseable") return { state: "unreadable", reason: at };
  if (at === "not-located") return { state: "pending", why: at };
  const why = failureOf(at.read, ref, nh);
  const transaction = `${at.read.at.hash}-${index}`;
  return why === undefined
    ? { state: "settled", finality: at.finality, height: at.read.at.height, transaction }
    : { state: "failed", why, finality: at.finality, height: at.read.at.height, transaction };
}

/**
 * The read's facts: the act at its mark and height where it settled, or where it did not dispatch, a failed result
 * that took the nonce; nothing for an extrinsic that is not the act, nor for one not located. The read by timepoint is
 * never a search read whole.
 */
function factsOf(read: PolkadotRead): Facts<bigint, PolkadotMark> {
  const none = { seen: [], search: { whole: false }, history: false } as const;
  switch (read.state) {
    case "unreadable":
      return { ...none, unreadable: read.reason };
    case "pending":
      return none;
    case "settled":
      return { ...none, seen: [actSeen(read.transaction, read.finality, read.height)] };
    case "failed":
      return read.why === "dispatch-failed"
        ? { ...none, seen: [actSeen(read.transaction, read.finality, read.height, "failed")] }
        : none;
  }
}

/** The profile call an extrinsic ends with, starting at or after `from`: the longest such suffix, or null. */
function endingProfileCall(xt: Uint8Array, from: number): ProfileCall | null {
  for (let start = Math.max(from, xt.length - MAX_CALL); start < xt.length; start++) {
    const call = decodeProfileCall(xt.subarray(start));
    if (!isRefusal(call)) return call;
  }
  return null;
}

/**
 * The hash from the landed extrinsic alone, for anyone holding its timepoint. It reads the block's raw extrinsics, then
 * the chain's record of the extrinsic at the index, and ties the two before anything else: the raw bytes' BLAKE2b-256
 * must be the record's hash. A block or a record the reader does not have is `polkadot/not-found`, and a block whose
 * extrinsics hold no entry at the index is `polkadot/not-located`. Extrinsics that are not an array, an entry that is
 * not a hex string, a record that is not an extrinsic's, or raw bytes whose hash is not the record's are
 * `polkadot/unreadable`. The bytes so tied must end with the profile call, after the signature, whose remark is the
 * hash's LCP string with lowercase hex. The record read is then chosen as `polkadotStatus` chooses it, and a named
 * block that the finalized chain does not hold, with no copy of the extrinsic at that index of the canonical block at
 * its height, is `polkadot/not-located`. That record must show the extrinsic dispatched with the `Remarked` event for
 * the remark and a `Transferred` event of the call's asset: one that does not is `polkadot/no-remark` or
 * `polkadot/no-transfer` once the finalized chain holds its block, and `polkadot/not-final` while the block is above the
 * finalized height, since that block can be replaced. The input's `tx` is the timepoint, and its `option` the option
 * the payment answers, an object, of which the read needs no member. An input whose `tx` is not a
 * `<block hash>-<index>` timepoint, or whose option is not an object, is `polkadot/wrong-reader`, with nothing read. At
 * most four calls.
 */
export async function polkadotRecover(
  input: RecoverInput<PolkadotNetwork, PaymentRequirements | MppChallenge>,
  reader: PolkadotReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("polkadot/wrong-reader");
  const tp = typeof input.tx === "string" ? TIMEPOINT.exec(input.tx) : null;
  if (tp === null || !isObject(input.option)) return refusal("polkadot/wrong-reader");
  const block = tp[1]! as Hex;
  const index = Number(tp[2]);
  const raws = await readSafely(() => reader.rawExtrinsics(block));
  if ("unreadable" in raws) return refusal("polkadot/unreadable");
  if (raws.ok === null) return refusal("polkadot/not-found");
  if (!Array.isArray(raws.ok)) return refusal("polkadot/unreadable");
  const raw: unknown = raws.ok[index];
  if (raw === undefined) return refusal("polkadot/not-located");
  if (typeof raw !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) return refusal("polkadot/unreadable");
  const x = await readSafely(() => reader.extrinsic(block, index));
  if ("unreadable" in x) return refusal("polkadot/unreadable");
  if (x.ok === null) return refusal("polkadot/not-found");
  if (!isExtrinsic(x.ok)) return refusal("polkadot/unreadable");
  const xt = fromHex(raw);
  const xtHash = extrinsicHash(xt);
  if (!hashEquals(x.ok.hash, xtHash)) return refusal("polkadot/unreadable");
  const split = splitSigned(xt);
  if (isRefusal(split)) return split;
  const call = endingProfileCall(xt, split.end);
  if (call === null) return refusal("polkadot/call-not-profile");
  const h = remarkCarrier(call.remark);
  if (h === null) return refusal("polkadot/remark-not-lcp");
  const at = await finalRecord(reader, x.ok, block, index, xtHash);
  if (at === "transport" || at === "unparseable") return refusal("polkadot/unreadable");
  if (at === "not-located") return refusal("polkadot/not-located");
  const noRemark = !at.read.success || !remarked(at.read, call.remark);
  if (!noRemark && transferred(at.read, call.assetId)) return h;
  if (at.finality !== "finalized") return refusal("polkadot/not-final");
  return noRemark ? refusal("polkadot/no-remark") : refusal("polkadot/no-transfer");
}

/**
 * Finds a payment nobody named, by hashing every extrinsic of each block from `from` to `to` (at most 256 blocks).
 * The first match gives its timepoint, once the block's record at that index has the recorded extrinsic hash. A block
 * that does not exist, or a record at the matched index with another hash (the block at that height changed between
 * the two reads), ends the scan with null. A ref or reader that is not an object, a reader for another network, or a
 * ref whose `extrinsicHash` is not `0x` and 64 hex digits is `polkadot/wrong-reader`, with nothing read.
 */
export async function polkadotLocate(
  ref: PolkadotRef,
  reader: PolkadotReader,
  from: bigint,
  to: bigint,
): Promise<string | null | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network || normalHash(ref.extrinsicHash) === null) {
    return refusal("polkadot/wrong-reader");
  }
  if (typeof from !== "bigint" || typeof to !== "bigint" || from < 0n || to < from || to - from > MAX_RANGE) {
    return refusal("polkadot/range");
  }
  for (let n = from; n <= to; n++) {
    const raws = await readSafely(() => reader.rawExtrinsics(n));
    if ("unreadable" in raws) return refusal("polkadot/unreadable");
    if (raws.ok === null) return null;
    if (!Array.isArray(raws.ok)) return refusal("polkadot/unreadable");
    for (let i = 0; i < raws.ok.length; i++) {
      const raw = raws.ok[i];
      if (typeof raw !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw) || raw.length > 2 * MAX_EXTRINSIC + 2) continue;
      if (!hashEquals(extrinsicHash(fromHex(raw)), ref.extrinsicHash)) continue;
      const x = await readSafely(() => reader.extrinsic(n, i));
      if ("unreadable" in x) return refusal("polkadot/unreadable");
      if (x.ok === null || !isExtrinsic(x.ok) || !hashEquals(x.ok.hash, ref.extrinsicHash)) return null;
      return `${x.ok.at.hash}-${i}`;
    }
  }
  return null;
}

/**
 * The option unchanged: the hash rides in the signed call, not in the option. An option that carries a `refused` member
 * is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/polkadot/lcp-assets-remark`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
 * facilitator submits the extrinsic the payer signed and names where it landed; `status` reads it by block and index.
 */
export const exactPolkadotRemark = Object.freeze({
  id: ID,
  data: POLKADOT[ID],
  pattern,
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: polkadotStatus,
  recover: polkadotRecover,
}) satisfies Entry<
  typeof ID,
  PolkadotPaymentPayload,
  PolkadotRef,
  PolkadotReader,
  X402Forms & {
    choice: { required: PaymentRequired; accepted: PaymentRequirements };
    unsigned: PolkadotUnsigned;
    landed: { h: AtrHash; transaction: string };
    network: PolkadotNetwork;
    query: StatusQuery<PolkadotRef & { h: AtrHash; transaction: string }, bigint, PolkadotMark>;
    answer: PolkadotStatus;
  }
>;
