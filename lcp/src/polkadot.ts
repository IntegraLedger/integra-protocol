/**
 * Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one
 * extrinsic whose call is `utility.batch_all([assets.transfer_keep_alive, system.remark_with_event])` with the ATR
 * hash's LCP string as the remark; the settlement is read by the signer's account nonce through polkadot-rest-api. SCALE is encoded and
 * decoded here for these shapes only.
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { base58 } from "@scure/base";
import { fromLcpString, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import type { PolkadotPaymentPayload } from "./internal/polkadot.js";
import { advertiseFor, chosen, isAmount, isTimeoutSeconds, paymentWith, presentedWith, readFor, sameJson, x402Broadcaster, type X402Read, type X402Forms } from "./internal/x402.js";
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
import { decide, type Facts, type Moved, type RecoverInput, type Seen, type StatusAnswer, type StatusQuery, type Undecoded, type UnreadableReason } from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
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

/**
 * Bounded, read-only calls against one network's `polkadot-rest-api`, and its declared `json-rpc` side endpoint for the
 * validation of a presented extrinsic. Every failure rejects.
 */
export interface PolkadotReader {
  readonly network: PolkadotNetwork;
  /** `GET /blocks/{block}/extrinsics/{index}`; null when the block or extrinsic does not exist. */
  extrinsic(block: Hex | bigint, index: number): Promise<PolkadotExtrinsic | null>;
  /** `GET /blocks/{block}/extrinsics-raw`; null when the block does not exist. */
  rawExtrinsics(block: Hex | bigint): Promise<readonly Hex[] | null>;
  /** `GET /blocks/head/header` → number: the most recently finalized height. */
  finalizedHeight(): Promise<bigint>;
  /** `GET /blocks/head/header?finalized=false` → number: the latest head the endpoint serves. */
  headHeight(): Promise<bigint>;
  /** `GET /accounts/{account}/balance-info?at=` → nonce: the account's nonce at the finalized block, or at the head. */
  accountNonce(account: Hex, at: "finalized" | "head"): Promise<bigint>;
  /**
   * `TaggedTransactionQueue_validate_transaction` of the extrinsic at the best block, through the `json-rpc` endpoint:
   * whether it answered valid, and the height of the block the call ran at, `state_call`'s `at`, pinned before the call,
   * never a head read apart from it.
   */
  validate(extrinsic: Hex): Promise<{ valid: boolean; head: bigint }>;
}

/** A signed extrinsic's era: mortal, with its period and phase, or immortal. */
export type PolkadotEra = { readonly period: number; readonly phase: number } | "immortal";

/**
 * The read keys of the presented extrinsic, from its signed bytes: the signer's 32-byte account, the account nonce and
 * the era it signed, and the extrinsic itself, which the read validates and compares with what landed; with the
 * accepted option's network and the payee, the `payTo` of the option the payment answers, the key of the two party
 * tests and no search key.
 */
export interface PolkadotRef {
  network: PolkadotNetwork;
  payee: string;
  signer: Hex;
  nonce: string;
  era: PolkadotEra;
  extrinsic: Hex;
}

/**
 * The search's position, which a `pending` answer returns while the search has range left and the next call takes:
 * the next block to read, never above the finalized height's next, and the timepoints the search met at or below the
 * finalized height, which the next call reads again.
 */
export interface PolkadotCursor {
  readonly next: bigint;
  readonly hits: readonly string[];
  /**
   * The head at which the chain's validation of the presented extrinsic answered valid, which proves the era's last
   * block; kept in the position so that the next call takes it back.
   */
  readonly validated?: bigint;
}

/** What `polkadotStatus` takes beside the reference and the reader: the profile `read-status`'s query. */
export type PolkadotQuery = StatusQuery<PolkadotLanded, bigint, PolkadotMark, PolkadotCursor>;

/** The reference with what the caller adds: H, and the timepoint a settler named, a hint. */
export type PolkadotLanded = PolkadotRef & { h: AtrHash; transaction?: string };

/**
 * The answer of `polkadotStatus`, as the profile `read-status` gives it. Its marks are `head` and `finalized`, in that
 * order, and its position the block height. A transaction is named by its timepoint, `<block hash>-<index>`. A
 * `settled` answer states `presented`: `yes` where the landed extrinsic's signed body, its signature apart, is the
 * presented one's, `no` where it is not. Each transfer of what moved is named by the timepoint and its place: the
 * event's index among the extrinsic's events, or `call 0` for a transfer of zero, the first call of the profile's
 * batch, which emits no event, after a `0` for each wrapper that leads to it. Its `signer` is the extrinsic's signer,
 * and its `authority` the wrapper it acted through for the payer, `proxy.proxy` or `multisig.as_multi_threshold_1`,
 * absent where it signed as the payer. A `pending` answer that holds the head at which the chain's validation of the presented
 * extrinsic answered valid keeps it in its search position, `validated`, for the next call.
 */
export type PolkadotStatus = StatusAnswer<bigint, PolkadotMark, PolkadotCursor>;

type PolkadotMark = "head" | "finalized";
const MARKS: readonly PolkadotMark[] = ["head", "finalized"];

/** The call the payer's signer wraps in an extrinsic, and how that extrinsic completes the payment. */
export interface PolkadotUnsigned {
  request: { kind: "substrate-call"; network: PolkadotNetwork; call: Uint8Array<ArrayBuffer> };
  complete(extrinsic: Uint8Array): PolkadotPaymentPayload | Refusal;
}

const ID = "x402/exact/polkadot/lcp-assets-remark" as const;

/**
 * The pairing's bounds, each lcp's own or the chain's, with its reason. `extrinsic`: lcp's bound on a signed extrinsic's
 * bytes, length prefix included, which the profile's extrinsic fits many times over and which bounds what is decoded.
 * `remark`: the 77 ASCII bytes `lcp:sha256:` and H. `call`: the longest profile call, both compacts in their widest
 * form, a `u32` asset id and a `u128` amount. `blockHashCount`: the chain's `BlockHashCount`, the number of block hashes
 * an extrinsic's era can name (the profile's rule 7). `searchBlocks`: lcp's resource bound, the blocks one call of
 * `polkadotStatus` reads of its search, so that each call's reads are bounded; the next call takes the search's
 * position. The search holds the signer's own items alone to `extrinsic`.
 */
export const POLKADOT_BOUNDS = Object.freeze({
  extrinsic: 4096,
  remark: 77,
  call: 141,
  blockHashCount: 4096,
  searchBlocks: 64,
} as const);
const MAX_EXTRINSIC = POLKADOT_BOUNDS.extrinsic;
const REMARK_LENGTH = POLKADOT_BOUNDS.remark;
const MAX_CALL = POLKADOT_BOUNDS.call;
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
): { network: PolkadotNetwork; accepted: PaymentRequirements; xt: Uint8Array; call: ProfileCall; h: AtrHash } | Refusal {
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
  return { network: p.accepted.network as PolkadotNetwork, accepted: p.accepted, xt, call: decoded, h };
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
 * The read keys from the signed bytes: the signer, the account nonce and the era it signed, and the extrinsic; with the
 * accepted option's network and the payee, the `payTo` of the option the payment answers. A presented `accepted` that
 * is not `option` is `x402/accepted-not-option`, and an extrinsic whose era or nonce does not decode
 * `polkadot/extrinsic-malformed`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<PolkadotRef | Refusal> {
  const c = carriedOf(presented);
  if (isRefusal(c)) return c;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameJson(c.accepted, option)) return refusal("x402/accepted-not-option");
  const signed = signedOf(c.xt);
  if (isRefusal(signed)) return signed;
  return {
    network: c.network,
    payee,
    signer: toHex(signed.signer),
    nonce: signed.nonce.toString(),
    era: signed.era,
    extrinsic: toHex(c.xt),
  };
}

/** A mortal era's two bytes, or the one zero byte of an immortal era, as polkadot-sdk's `Era` decodes them. */
function eraAt(xt: Uint8Array, at: number): { era: PolkadotEra; next: number } | null {
  const first = xt[at];
  if (first === undefined) return null;
  if (first === 0) return { era: "immortal", next: at + 1 };
  const second = xt[at + 1];
  if (second === undefined) return null;
  const encoded = first + (second << 8);
  const period = 2 << encoded % 16;
  const quantize = Math.max(period >> 12, 1);
  const phase = (encoded >> 4) * quantize;
  return period >= 4 && phase < period ? { era: { period, phase }, next: at + 2 } : null;
}

/**
 * A signed v4 extrinsic's signer, and the era and the account nonce that follow its signature, the first two of its
 * extensions' explicit bytes: the era (`CheckMortality`) and the compact nonce (`CheckNonce`). An extrinsic whose era or
 * nonce does not decode is `polkadot/extrinsic-malformed`.
 */
function signedOf(xt: Uint8Array): { signer: Uint8Array; era: PolkadotEra; nonce: bigint; sigStart: number; sigEnd: number } | Refusal {
  const split = splitSigned(xt);
  if (isRefusal(split)) return split;
  const era = eraAt(xt, split.end);
  const nonce = era === null ? null : compactAt(xt, era.next);
  if (era === null || nonce === null) return refusal("polkadot/extrinsic-malformed");
  // The length prefix, the version byte and the 33 bytes of `MultiAddress::Id` come before the signature's variant.
  const sigStart = compactAt(xt, 0)!.next + 34;
  return { signer: split.signer, era: era.era, nonce: nonce.value, sigStart, sigEnd: split.end };
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

/** An account in an event's data or a call: SS58 in any simple format, or `0x` and 32 bytes; null otherwise. */
function accountOf(v: unknown): Uint8Array | null {
  if (typeof v !== "string") return null;
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return fromHex(v.toLowerCase());
  const a = ss58Decode(v);
  return isRefusal(a) ? null : a;
}

const ASSET_INSTANCES = ["assets", "foreignAssets", "poolAssets"] as const;
/**
 * The place of a transfer of zero, which emits no event: the index of each call that leads to it from the extrinsic's
 * own call, one `0` for each wrapper's one call, then the first call of the profile's `batch_all`.
 */
function zeroCallPlace(wrappers: number): string {
  return `call ${"0 ".repeat(wrappers)}0`;
}

/**
 * What the extrinsic moved from the payer, as observed: every `balances.Transfer` and every `Transferred` of the assets
 * pallet's instances whose `from` is the payer (polkadot-sdk at 23b84ba4, `substrate/frame/balances/src/lib.rs:349`,
 * `substrate/frame/assets/src/lib.rs:701-706`), each with its asset, amount and recipient (`0x` and its 32 bytes),
 * named by the extrinsic's timepoint and the event's index among its events, no sender recorded; and, where the
 * extrinsic ends with the profile call of zero, which emits no event, and that call runs as the payer, a transfer of
 * zero to the account it names, named by its call's place.
 */
function movedOf(
  x: PolkadotExtrinsic,
  payer: Uint8Array,
  zero: { call: ProfileCall; wrappers: number } | null,
  transaction: string,
): Moved[] {
  const moved: Moved[] = [];
  for (const [place, e] of x.events.entries()) {
    if (!isObject(e) || !Array.isArray(e.data)) continue;
    const d = e.data;
    let asset: string | undefined;
    let from: unknown;
    let to: unknown;
    let amount: unknown;
    if (e.pallet === "balances" && e.method === "Transfer") [asset, from, to, amount] = ["native", d[0], d[1], d[2]];
    else if ((ASSET_INSTANCES as readonly string[]).includes(e.pallet) && e.method === "Transferred") {
      const id = d[0];
      [asset, from, to, amount] = [`${e.pallet}:${typeof id === "string" || typeof id === "number" ? String(id) : JSON.stringify(id)}`, d[1], d[2], d[3]];
    }
    const sender = accountOf(from);
    const account = accountOf(to);
    if (asset === undefined || account === null || sender === null || !equalBytes(sender, payer)) continue;
    if (typeof amount !== "string" && typeof amount !== "number") continue;
    moved.push({ asset, amount: String(amount), to: toHex(account), transaction, place });
  }
  if (zero !== null && zero.call.amount === 0n) {
    moved.push({ asset: `assets:${zero.call.assetId}`, amount: "0", to: toHex(zero.call.dest), transaction, place: zeroCallPlace(zero.wrappers) });
  }
  return moved;
}

/**
 * The account a signed call runs as, and the wrappers it runs through: from the signer, each `proxy.proxy` (42; 0) runs
 * its call as its `real`, and each `multisig.as_multi_threshold_1` (41; 0) as the multisig account of its
 * `other_signatories` with the sender, threshold 1: BLAKE2b-256 of `modlpy/utilisuba`, the sorted accounts and the
 * threshold, SCALE-encoded (polkadot-sdk at 23b84ba4, `substrate/frame/multisig/src/lib.rs:311-337`, `:645-648`,
 * `:789-808`; Multisig is pallet 41 of Polkadot Asset Hub, polkadot-fellows/runtimes at 30696143,
 * `system-parachains/asset-hubs/asset-hub-polkadot/src/lib.rs:1767`). `start` is where the call begins, `inner` where
 * the call the wrappers lead to begins.
 */
function originOf(xt: Uint8Array, start: number, signer: Uint8Array): { origin: Uint8Array; wrappers: string[]; inner: number } {
  let origin = signer;
  let at = start;
  const wrappers: string[] = [];
  for (let depth = 0; depth <= 4; depth++) {
    const pallet = xt[at];
    const index = xt[at + 1];
    const args = at + 2;
    if (pallet === 42 && index === 0 && xt[args] === 0x00 && args + 34 <= xt.length) {
      const kind = xt[args + 33];
      if (kind !== 0x00 && kind !== 0x01) break;
      origin = xt.subarray(args + 1, args + 33);
      wrappers.push("proxy.proxy");
      at = args + 34 + kind;
    } else if (pallet === 41 && index === 0) {
      const count = compactAt(xt, args);
      if (count === null || count.value > 100n || count.next + 32 * Number(count.value) > xt.length) break;
      const others: Uint8Array[] = [];
      for (let i = 0; i < Number(count.value); i++) others.push(xt.subarray(count.next + 32 * i, count.next + 32 * (i + 1)));
      const all = [...others, origin].sort(compareBytes);
      origin = blake256(concat(MULTISIG_SEED, compact(BigInt(all.length)), ...all, [1, 0]));
      wrappers.push("multisig.as_multi_threshold_1");
      at = count.next + 32 * Number(count.value);
    } else break;
  }
  return { origin, wrappers, inner: at };
}

const MULTISIG_SEED = new TextEncoder().encode("modlpy/utilisuba");

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/** Where the call an extrinsic ends with begins, at or after `from`: the longest suffix `transfersAt` decodes whole. */
function callStart(xt: Uint8Array, from: number): number | null {
  for (let start = from; start < xt.length; start++) {
    const call = transfersAt(xt, start, 0);
    if (call !== null && call.next === xt.length) return start;
  }
  return null;
}

/** Whether `needle` occurs in `bytes`. */
function holds(bytes: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * What the search reads of an item: `bare`, an unsigned or v5 bare item; `signed`, a signed v4 extrinsic with its signer
 * where its address is a 32-byte account, its era and its nonce; `undecoded`, any other, which could be the signer's.
 */
type Item =
  | { kind: "bare" }
  | { kind: "signed"; signer: Uint8Array | null; era: PolkadotEra | null; nonce: bigint | null }
  | { kind: "undecoded" };

function itemOf(xt: Uint8Array): Item {
  const length = compactAt(xt, 0);
  if (length === null || length.value !== BigInt(xt.length - length.next)) return { kind: "undecoded" };
  const version = xt[length.next];
  if (version === 0x04 || version === 0x05) return { kind: "bare" };
  if (version !== 0x84) return { kind: "undecoded" };
  if (xt.length > MAX_EXTRINSIC && xt[length.next + 1] === 0x00 && xt.length >= length.next + 34) {
    // Over the bound: only its signer is read, so that an item of the signer's is held to the bound.
    return { kind: "signed", signer: xt.subarray(length.next + 2, length.next + 34), era: null, nonce: null };
  }
  const signed = signedOf(xt);
  if (!isRefusal(signed)) return { kind: "signed", signer: signed.signer, era: signed.era, nonce: signed.nonce };
  const address = xt[length.next + 1];
  // An address that is not a 32-byte account (an index, raw bytes, a 20-byte address) is not the signer's `Id`.
  return address === 0x00 || address === 0x03 ? { kind: "undecoded" } : { kind: "signed", signer: null, era: null, nonce: null };
}

/** The signed body of a signed v4 extrinsic, its signature apart, or null. */
function bodyOf(xt: Uint8Array): Uint8Array | null {
  const s = signedOf(xt);
  return isRefusal(s) ? null : concat(xt.subarray(compactAt(xt, 0)!.next, s.sigStart), xt.subarray(s.sigEnd));
}

/** The last block that can include an extrinsic of `era` that the chain validated at `head`, as the settler takes it. */
function lastBlock(era: { period: number; phase: number }, head: bigint): bigint {
  const period = BigInt(era.period);
  const phase = BigInt(era.phase);
  const birth = ((head > phase ? head : phase) - phase) / period * period + phase;
  const death = birth + period;
  const capped = birth + BigInt(POLKADOT_BOUNDS.blockHashCount) + 1n;
  return death - 1n < capped ? death - 1n : capped;
}

type Found = { seen: Seen<bigint, PolkadotMark>; raw: Uint8Array };

/** A read that established nothing, or one that stopped where the search can resume. */
class Stop {
  constructor(readonly reason: UnreadableReason) {}
}

/**
 * Answers the read of the act the query asks about as the profile `read-status` gives it, by the pairing's profile, rule
 * 8: the payment is read by the signer's account nonce, never by the extrinsic's hash. The read takes the finalized
 * height, the latest head, and the account's nonce at each; then reads the timepoint a settler named, the hint, and the
 * search's earlier finds; then searches every block after the position the caller gave up to the latest head, at most
 * `POLKADOT_BOUNDS.searchBlocks` blocks a call, decoding each item's preamble: the signer's extrinsic at the signed nonce
 * is the instrument's, and every extrinsic whose bytes hold the remark of H is read for the search for H. An extrinsic
 * meets the profile's success where it dispatched (`success`) with `Remarked` for the remark; on the act `payment` it
 * names the payee's account where a transfer it made reaches `payTo`'s 32-byte account. The era's last block is proven
 * only by the chain's validation of the presented extrinsic answering valid, at the head it names (the search
 * position's `validated`), and
 * the lapse is the finalized height past it with the account nonce not past the signed one. A ref, a reader or a query
 * that is not one is unreadable `unparseable`, with nothing read; a reader for another network `chain-mismatch`; a read
 * that rejects `transport`; a block of the range at or below the finalized height that the endpoint does not hold
 * `history-gap`; an item of the signer's over `POLKADOT_BOUNDS.extrinsic` bytes `too-large`.
 */
export async function polkadotStatus(ref: PolkadotLanded, reader: PolkadotReader, query: PolkadotQuery): Promise<PolkadotStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint")) return UNPARSEABLE;
  const read = await readPolkadot(ref, reader, query).catch((e: unknown) => {
    if (e instanceof Stop) return e;
    throw e;
  });
  if (read instanceof Stop) return { state: "unreadable", reason: read.reason, foreign: [] };
  return decide(read.facts, query, LEDGER);
}

const LEDGER = ledgerOf<bigint, PolkadotMark>(POLKADOT[ID].coverage, MARKS, bigintOrder);
const NONCE = /^(0|[1-9][0-9]{0,19})$/;

function isEra(e: unknown): e is PolkadotEra {
  if (e === "immortal") return true;
  if (!isObject(e) || !Number.isSafeInteger(e["period"]) || !Number.isSafeInteger(e["phase"])) return false;
  const period = e["period"] as number;
  return period >= 4 && period <= 65536 && (period & (period - 1)) === 0 && (e["phase"] as number) >= 0 && (e["phase"] as number) < period;
}

function isCursor(c: unknown): c is PolkadotCursor {
  return (
    isObject(c) &&
    typeof c["next"] === "bigint" &&
    c["next"] >= 0n &&
    Array.isArray(c["hits"]) &&
    c["hits"].length <= 16 &&
    c["hits"].every((t: unknown) => typeof t === "string" && TIMEPOINT.test(t)) &&
    (c["validated"] === undefined || (typeof c["validated"] === "bigint" && c["validated"] >= 0n))
  );
}

async function call<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch {
    throw new Stop("transport");
  }
}

async function readPolkadot(
  ref: PolkadotLanded,
  reader: PolkadotReader,
  query: PolkadotQuery,
): Promise<{ facts: Facts<bigint, PolkadotMark, PolkadotCursor> }> {
  if (!isObject(ref) || !isObject(reader) || typeof reader.network !== "string") throw new Stop("unparseable");
  const payee = typeof ref.payee === "string" ? ss58Decode(ref.payee) : refusal("polkadot/address-malformed");
  const h = normalHash(ref.h);
  if (!isNetwork(ref.network) || isRefusal(payee) || h === null) throw new Stop("unparseable");
  if (typeof ref.signer !== "string" || !/^0x[0-9a-f]{64}$/.test(ref.signer) || typeof ref.nonce !== "string" || !NONCE.test(ref.nonce)) {
    throw new Stop("unparseable");
  }
  if (!isEra(ref.era) || typeof ref.extrinsic !== "string" || !LOWER_HEX.test(ref.extrinsic)) throw new Stop("unparseable");
  if (ref.transaction !== undefined && (typeof ref.transaction !== "string" || !TIMEPOINT.test(ref.transaction))) throw new Stop("unparseable");
  if (query.search !== undefined && !isCursor(query.search)) throw new Stop("unparseable");
  if (reader.network !== ref.network) throw new Stop("chain-mismatch");

  const signer = fromHex(ref.signer);
  const signedNonce = BigInt(ref.nonce);
  const remark = ENCODER.encode(toLcpString(h));
  const remarkHash = toHex(blake256(remark));
  const big = (v: unknown): bigint => {
    if (typeof v !== "bigint" || v < 0n) throw new Stop("unparseable");
    return v;
  };
  const finalized = big(await call(() => reader.finalizedHeight()));
  const headRead = big(await call(() => reader.headHeight()));
  const head = headRead > finalized ? headRead : finalized;
  const nonceFinal = big(await call(() => reader.accountNonce(ref.signer, "finalized")));
  const nonceHead = big(await call(() => reader.accountNonce(ref.signer, "head")));
  let validated = query.search?.validated;
  if (validated === undefined && ref.era !== "immortal") {
    const v = await call(() => reader.validate(ref.extrinsic));
    if (!isObject(v) || typeof v.valid !== "boolean") throw new Stop("unparseable");
    if (v.valid) validated = big(v.head);
  }
  const bound = ref.era === "immortal" || validated === undefined ? undefined : lastBlock(ref.era, validated);
  const others = (query.others ?? []).flatMap((o) =>
    "ref" in o && isObject(o.ref) && typeof o.ref.signer === "string" && typeof o.ref.nonce === "string" ? [o.ref] : [],
  );

  const found = new Map<string, Found>();
  const presentedBody = bodyOf(fromHex(ref.extrinsic));
  /** Classifies the item at `index` of a block, read whole, where it is the instrument's or holds the remark. */
  const classify = async (block: Hex | bigint, index: number, xt: Uint8Array): Promise<"ok" | "undecoded" | "again"> => {
    const item = itemOf(xt);
    if (item.kind === "undecoded") return "undecoded";
    const mine = item.kind === "signed" && item.signer !== null && equalBytes(item.signer, signer);
    if (mine && xt.length > MAX_EXTRINSIC) throw new Stop("too-large");
    const instrument = mine && item.kind === "signed" && item.nonce === signedNonce;
    const carries = holds(xt, remark);
    if (!instrument && !carries) return "ok";
    const record = await call(() => reader.extrinsic(block, index));
    if (record === null) return "again";
    if (!isExtrinsic(record)) throw new Stop("unparseable");
    if (!hashEquals(record.hash, extrinsicHash(xt))) return "again";
    const at = await finalRecord(reader, record, record.at.hash, index, record.hash);
    if (at === "transport") throw new Stop("transport");
    if (at === "unparseable") throw new Stop("unparseable");
    if (at === "not-located") return "again";
    const x = at.read;
    const succeeded = x.success && hasEvent(x, "system", "Remarked", (d) => typeof d[1] === "string" && hashEquals(d[1], remarkHash));
    if (!succeeded && !instrument) return "ok";
    const split = splitSigned(xt);
    const start = isRefusal(split) ? null : callStart(xt, split.end);
    // The account the call runs as, the payer where the signer signed as the payer or acted for it through a wrapper.
    const runs = item.kind === "signed" && item.signer !== null && start !== null ? originOf(xt, start, item.signer) : null;
    const forPayer = runs !== null && equalBytes(runs.origin, signer);
    // The profile call the wrappers lead to, which a transfer of zero is read from.
    const call0 = runs === null || !forPayer ? null : decodeProfileCall(xt.subarray(runs.inner));
    const zero = call0 === null || isRefusal(call0) ? null : { call: call0, wrappers: runs!.wrappers.length };
    const signedTo = isRefusal(split) || succeeded ? null : signedTransfers(xt, split.end);
    const transaction = `${x.at.hash.toLowerCase()}-${index}`;
    // What it moved where it dispatched: an extrinsic that did not meet the profile's success keeps what its events show.
    const moved = succeeded ? movedOf(x, signer, zero, transaction) : x.success ? movedOf(x, signer, null, transaction) : [];
    const signerHex = item.kind === "signed" && item.signer !== null ? toHex(item.signer) : undefined;
    const party = item.kind === "signed" && item.signer !== null && equalBytes(item.signer, payee) ? "payee" : mine || forPayer ? "payer" : "other";
    // The wrapper the signer acted through for the payer; none where it signed as the payer.
    const authority = forPayer && !mine && runs.wrappers.length > 0 ? runs.wrappers.join(", ") : undefined;
    const given = item.kind === "signed" && signerHex !== undefined && others.some((o) => o.signer === signerHex && o.nonce === String(item.nonce));
    // The payment presented: the payer's extrinsic compared with the presented one by its signed body, its signature
    // apart, the members the payer signed that its bytes hold.
    const body = party === "payer" ? bodyOf(xt) : null;
    const presented = party !== "payer" ? undefined : body === null || presentedBody === null ? "unshown" : equalBytes(body, presentedBody) ? "yes" : "no";
    const seen: Seen<bigint, PolkadotMark> = {
      transaction,
      position: x.at.height,
      mark: at.finality,
      // It succeeded where it dispatched and, holding R, with `Remarked` for it: a failure that took the remark with it
      // is a failed result.
      result: (carries ? succeeded : x.success) ? "succeeded" : "failed",
      consumed: instrument,
      carries: carries && (succeeded || instrument),
      party,
      kind: "same",
      // A failed extrinsic's transfers are rolled back with it: the account it names is the one a transfer its signed
      // call makes names, under a batch or a proxy as well.
      account: !succeeded
        ? signedTo === null || signedTo.length === 0 ? "none" : signedTo.some((to) => equalBytes(to, payee)) ? "payee" : "other"
        : moved.length === 0 ? "none" : moved.some((m) => equalBytes(fromHex(m.to), payee)) ? "payee" : "other",
      ...(given ? { given: true } : {}),
      ...(x.success ? { moved } : {}),
      ...(signerHex === undefined ? {} : { signer: signerHex }),
      ...(authority === undefined ? {} : { authority }),
      ...(presented === undefined ? {} : { presented }),
    };
    found.set(transaction, { seen, raw: xt });
    return "ok";
  };
  /** The item a timepoint names: the block's raw extrinsics, then its record. */
  const readAt = async (timepoint: string): Promise<void> => {
    const tp = TIMEPOINT.exec(timepoint);
    if (tp === null) return;
    const list = await call(() => reader.rawExtrinsics(tp[1]! as Hex));
    if (list === null) return;
    if (!Array.isArray(list)) throw new Stop("unparseable");
    const raw: unknown = list[Number(tp[2])];
    if (raw === undefined) return;
    if (typeof raw !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) throw new Stop("unparseable");
    const height = await classify(tp[1]! as Hex, Number(tp[2]), fromHex(raw.toLowerCase()));
    if (height === "undecoded") undecodedAt.push({ transaction: timepoint.toLowerCase(), block: undefined });
  };

  const undecodedAt: { transaction: string; block: bigint | undefined }[] = [];
  for (const t of [...(ref.transaction === undefined ? [] : [ref.transaction]), ...(query.search?.hits ?? [])]) await readAt(t);

  const start = query.search?.next ?? (query.after === undefined ? undefined : query.after + 1n);
  let whole = start !== undefined;
  let held: bigint | undefined;
  let next = start;
  if (start !== undefined) {
    for (let n = start; n <= head; n++) {
      if (n - start >= BigInt(POLKADOT_BOUNDS.searchBlocks)) {
        whole = false;
        break;
      }
      next = n + 1n;
      const list = await call(() => reader.rawExtrinsics(n));
      if (list === null) {
        if (n <= finalized) throw new Stop("history-gap");
        whole = false;
        held ??= n;
        break;
      }
      if (!Array.isArray(list)) throw new Stop("unparseable");
      for (let i = 0; i < list.length; i++) {
        const raw: unknown = list[i];
        if (typeof raw !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) throw new Stop("unparseable");
        const got = await classify(n, i, fromHex(raw.toLowerCase()));
        if (got === "undecoded") {
          // The block's hash names the item: the block read by height is the one the endpoint holds at it now.
          const record = await call(() => reader.extrinsic(n, i));
          const named = isExtrinsic(record) ? `${record.at.hash.toLowerCase()}-${i}` : `${n}-${i}`;
          undecodedAt.push({ transaction: named, block: n });
        } else if (got === "again") {
          whole = false;
          held ??= n;
        }
      }
    }
  }
  const seen = [...found.values()].map((f) => f.seen).sort((a, b) => bigintOrder(a.position!, b.position!) || a.transaction.localeCompare(b.transaction));
  const hits = seen.filter((s) => s.position! <= finalized).map((s) => s.transaction).slice(0, 16);
  const cursorAt = (n: bigint): PolkadotCursor => ({
    next: n < finalized + 1n ? n : finalized + 1n,
    hits,
    ...(validated === undefined ? {} : { validated }),
  });
  const resume = held ?? next;
  // The position is given while the search has range left, and wherever it keeps the head the validation proved.
  const at = resume === undefined || (whole && validated === undefined) ? undefined : cursorAt(resume);
  const undecoded: Undecoded<PolkadotCursor>[] = undecodedAt.map((u) =>
    u.block === undefined ? { transaction: u.transaction } : { transaction: u.transaction, at: cursorAt(u.block) },
  );
  // The era's end is compared with finalized alone: ended at the head and not at finalized, the extrinsic can still
  // land in a block the finalized chain takes.
  const value = {
    consumed: nonceFinal > signedNonce,
    lapsed: bound !== undefined && finalized > bound,
    mark: "finalized" as const,
    head: { consumed: nonceHead > signedNonce },
  };
  return {
    facts: {
      seen,
      value,
      search: at === undefined ? { whole } : { whole, at },
      history: query.after !== undefined,
      ...(undecoded.length === 0 ? {} : { undecoded }),
    },
  };
}

/**
 * The accounts a signed call transfers to, decoded from its bytes: `assets.transfer` and `transfer_keep_alive` (pallet
 * 50, calls 8 and 9), `balances.transfer_allow_death` and `transfer_keep_alive` (10; 0 and 3), each to a
 * `MultiAddress::Id`; `system.remark` and `remark_with_event` (0; 0 and 7), which transfer nothing; and, holding these,
 * `utility.batch`, `batch_all` and `force_batch` (40; 0, 2 and 4), `proxy.proxy` (42; 0) over a `MultiAddress::Id`, and
 * `multisig.as_multi_threshold_1` (41; 0).
 * Pallet and call indices are Polkadot Asset Hub's (polkadot-fellows/runtimes at 30696143, asset-hub-polkadot's
 * `construct_runtime`; polkadot-sdk at 23b84ba4, each pallet's `call_index`). Null where the bytes at `at` are no such
 * call.
 */
function transfersAt(b: Uint8Array, at: number, depth: number): { to: Uint8Array[]; next: number } | null {
  const pallet = b[at];
  const index = b[at + 1];
  if (pallet === undefined || index === undefined || depth > 4) return null;
  const args = at + 2;
  const account = (i: number): Uint8Array | null => (b[i] === 0x00 && i + 33 <= b.length ? b.subarray(i + 1, i + 33) : null);
  if (pallet === 40 && (index === 0 || index === 2 || index === 4)) {
    const count = compactAt(b, args);
    if (count === null || count.value > 64n) return null;
    const to: Uint8Array[] = [];
    let next = count.next;
    for (let i = 0n; i < count.value; i++) {
      const inner = transfersAt(b, next, depth + 1);
      if (inner === null) return null;
      to.push(...inner.to);
      next = inner.next;
    }
    return { to, next };
  }
  if (pallet === 42 && index === 0) {
    if (account(args) === null) return null;
    const kind = b[args + 33];
    if (kind !== 0x00 && kind !== 0x01) return null;
    return transfersAt(b, args + 34 + kind, depth + 1);
  }
  if (pallet === 41 && index === 0) {
    const count = compactAt(b, args);
    if (count === null || count.value > 100n || count.next + 32 * Number(count.value) > b.length) return null;
    return transfersAt(b, count.next + 32 * Number(count.value), depth + 1);
  }
  if (pallet === 50 && (index === 8 || index === 9)) {
    const asset = compactAt(b, args);
    const dest = asset === null ? null : account(asset.next);
    const amount = asset === null || dest === null ? null : compactAt(b, asset.next + 33);
    return dest === null || amount === null ? null : { to: [dest], next: amount.next };
  }
  if (pallet === 10 && (index === 0 || index === 3)) {
    const dest = account(args);
    const amount = dest === null ? null : compactAt(b, args + 33);
    return dest === null || amount === null ? null : { to: [dest], next: amount.next };
  }
  if (pallet === 0 && (index === 0 || index === 7)) {
    const length = compactAt(b, args);
    if (length === null || length.value > BigInt(b.length - length.next)) return null;
    return { to: [], next: length.next + Number(length.value) };
  }
  return null;
}

/**
 * The accounts the call an extrinsic ends with transfers to, that call starting at or after `from`, the longest suffix
 * `transfersAt` decodes whole; null where none does.
 */
function signedTransfers(xt: Uint8Array, from: number): Uint8Array[] | null {
  for (let start = from; start < xt.length; start++) {
    const call = transfersAt(xt, start, 0);
    if (call !== null && call.next === xt.length) return call.to;
  }
  return null;
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
 * the remark, whatever it moved: one that does not is `polkadot/no-remark` once the finalized chain holds its block, and
 * `polkadot/not-final` while the block is above the finalized height, since that block can be replaced. The input's `tx` is the timepoint, and its `option` the option
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
  if (at.read.success && remarked(at.read, call.remark)) return h;
  return at.finality === "finalized" ? refusal("polkadot/no-remark") : refusal("polkadot/not-final");
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
 * facilitator submits the extrinsic the payer signed and names where it landed; `status` reads it by the signer's
 * account nonce, the timepoint the facilitator named being a hint.
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
    landed: { h: AtrHash; transaction?: string };
    network: PolkadotNetwork;
    query: PolkadotQuery;
    answer: PolkadotStatus;
  }
>;
