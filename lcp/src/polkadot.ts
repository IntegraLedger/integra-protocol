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
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  paymentWith,
  presentedWith,
  readFor,
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
  type X402Payment,
} from "./x402.js";

export type PolkadotNetwork = "polkadot:68d56f15f85d3136970ec16946040bc1" | "polkadot:67f9723393ef76214df0118c34bbbd3d";
export const POLKADOT_NETWORKS: readonly PolkadotNetwork[] = Object.freeze([
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

export interface ProfileCall {
  assetId: number;
  dest: Uint8Array;
  amount: bigint;
  remark: Uint8Array;
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

/** The read keys recorded at claim, computed from the signed bytes. */
export interface PolkadotRef {
  network: PolkadotNetwork;
  extrinsicHash: Hex;
  assetId: number;
}

/**
 * A settlement or failure names the timepoint it read, `<block hash>-<index>`: the one given, or the canonical one when
 * the given block left the chain and the canonical block at that height holds the same extrinsic at that index.
 * Pending `not-located` asks for the payment to be located from the claim position.
 */
export type PolkadotStatus =
  | { state: "settled"; finality: "finalized" | "head"; height: bigint; transaction: string }
  | { state: "pending"; why: "not-located" | "not-found" | "unreadable" }
  | {
      state: "failed";
      why: "not-this-extrinsic" | "dispatch-failed" | "no-remark" | "no-transfer";
      finality: "finalized" | "head";
      height: bigint;
      transaction: string;
    };

/** The x402 payload: the signed extrinsic and its call, lowercase hex. */
export type PolkadotPayload = { extrinsic: Hex; call: Hex };
export type PolkadotPaymentPayload = X402Payment<PolkadotPayload>;

/** The call the payer's signer wraps in an extrinsic, and how that extrinsic completes the payment. */
export interface PolkadotUnsigned {
  request: { kind: "substrate-call"; network: PolkadotNetwork; call: Uint8Array };
  complete(extrinsic: Uint8Array): PolkadotPaymentPayload | Refusal;
}

const ID = "x402/exact/polkadot/lcp-assets-remark" as const;
const MAX_EXTRINSIC = 4096;
const REMARK_LENGTH = 77;
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
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s as Hex;
}

function fromHex(h: string): Uint8Array {
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

function concat(...parts: readonly (Uint8Array | readonly number[])[]): Uint8Array {
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
export function ss58Decode(address: string): Uint8Array | Refusal {
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
  return raw.slice(1, 33);
}

/** `batch_all([transfer_keep_alive(assetId, Id(dest), amount), remark_with_event(remark)])` */
export function encodeProfileCall(c: ProfileCall): Uint8Array {
  return concat(
    CALL.batchAll,
    [0x08],
    CALL.transferKeepAlive,
    compact(BigInt(c.assetId)),
    [0x00],
    c.dest,
    compact(c.amount),
    CALL.remarkWithEvent,
    compact(BigInt(c.remark.length)),
    c.remark,
  );
}

/** The profile's call, exactly, with canonical compacts and no trailing byte. */
export function decodeProfileCall(call: Uint8Array): ProfileCall | Refusal {
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
    dest: dest.slice(),
    amount: amount.value,
    remark: call.slice(length.next),
  };
}

/**
 * The preamble of a signed v4 extrinsic: the length prefix, `0x84`, `MultiAddress::Id` and a `MultiSignature`. Gives
 * the signer and the index after the signature; the extension bytes that follow are not decoded.
 */
export function splitSigned(xt: Uint8Array): { signer: Uint8Array; end: number } | Refusal {
  if (!(xt instanceof Uint8Array)) return refusal("polkadot/extrinsic-malformed");
  if (xt.length > MAX_EXTRINSIC) return refusal("polkadot/extrinsic-too-large");
  const length = compactAt(xt, 0);
  if (length === null || length.value !== BigInt(xt.length - length.next)) return refusal("polkadot/extrinsic-malformed");
  let at = length.next;
  if (xt[at] !== 0x84) return refusal("polkadot/not-signed-v4");
  at += 1;
  if (xt[at] !== 0x00 || at + 33 > xt.length) return refusal("polkadot/address-not-id");
  const signer = xt.slice(at + 1, at + 33);
  at += 33;
  const variant = xt[at];
  const size = variant === 0 || variant === 1 ? 64 : variant === 2 || variant === 3 ? 65 : -1;
  if (size < 0 || at + 1 + size > xt.length) return refusal("polkadot/signature-malformed");
  return { signer, end: at + 1 + size };
}

/** BLAKE2b-256 of the extrinsic's bytes, its length prefix included. */
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
  if (typeof o.amount !== "string" || !DECIMAL.test(o.amount)) return refusal("polkadot/option-malformed");
  const amount = BigInt(o.amount);
  if (amount === 0n || amount >= U128_LIMIT) return refusal("polkadot/option-malformed");
  if (!Number.isSafeInteger(o.maxTimeoutSeconds) || o.maxTimeoutSeconds < 1 || o.maxTimeoutSeconds > 3600) {
    return refusal("polkadot/option-malformed");
  }
  const dest = ss58Decode(o.payTo);
  return isRefusal(dest) ? dest : true;
}

/** The pairing's id for an option it can pay, or undefined. */
export function polkadotPairingOf(o: PaymentRequirements): typeof ID | undefined {
  return check(o) === true ? ID : undefined;
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
  if (!isObject(c)) return refusal("polkadot/option-malformed");
  const ok = chosen(c.required, c.accepted, check);
  if (ok !== true) return ok;
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
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

function carriedOf(
  presented: unknown,
): { network: PolkadotNetwork; xt: Uint8Array; call: ProfileCall; h: AtrHash } | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const { extrinsic, call } = p.payload;
  if (typeof extrinsic !== "string" || !LOWER_HEX.test(extrinsic) || extrinsic.length > 2 * MAX_EXTRINSIC + 2) {
    return refusal("polkadot/extrinsic-malformed");
  }
  if (typeof call !== "string" || !LOWER_HEX.test(call)) return refusal("polkadot/call-not-profile");
  const xt = fromHex(extrinsic);
  const callBytes = fromHex(call);
  const ok = withSuffix(xt, callBytes);
  if (ok !== true) return ok;
  const decoded = decodeProfileCall(callBytes);
  if (isRefusal(decoded)) return decoded;
  let remark: string;
  try {
    remark = UTF8.decode(decoded.remark);
  } catch {
    return refusal("polkadot/remark-not-lcp");
  }
  const h = fromLcpString(remark);
  if (h === null) return refusal("polkadot/remark-not-lcp");
  return { network: p.accepted.network as PolkadotNetwork, xt, call: decoded, h };
}

/**
 * The hash inside what the payer signed: the remark of the profile call the extrinsic ends with. Amount, payee,
 * asset, signer and timing are not read, and no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const c = carriedOf(presented);
  return isRefusal(c) ? c : c.h;
}

/** The network, the extrinsic's hash and the call's asset, from the signed bytes. */
async function reference(presented: unknown): Promise<PolkadotRef | Refusal> {
  const c = carriedOf(presented);
  if (isRefusal(c)) return c;
  return { network: c.network, extrinsicHash: extrinsicHash(c.xt), assetId: c.call.assetId };
}

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────────

function isExtrinsic(x: unknown): x is PolkadotExtrinsic {
  if (!isObject(x) || !isObject(x["at"]) || typeof x["hash"] !== "string" || typeof x["success"] !== "boolean") {
    return false;
  }
  const at = x["at"];
  return typeof at["height"] === "bigint" && typeof at["hash"] === "string" && Array.isArray(x["events"]);
}

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

/** Why the extrinsic at the timepoint is not this payment, or undefined when it is. */
function failureOf(
  found: PolkadotExtrinsic,
  ref: PolkadotRef,
  h: AtrHash,
): "not-this-extrinsic" | "dispatch-failed" | "no-remark" | "no-transfer" | undefined {
  if (!hashEquals(found.hash, ref.extrinsicHash)) return "not-this-extrinsic";
  if (!found.success) return "dispatch-failed";
  const remarkHash = toHex(blake256(ENCODER.encode(toLcpString(h))));
  if (!hasEvent(found, "system", "Remarked", (d) => typeof d[1] === "string" && hashEquals(d[1], remarkHash))) {
    return "no-remark";
  }
  const asset = String(ref.assetId);
  const transferred = (d: readonly Json[]) => (typeof d[0] === "string" || typeof d[0] === "number") && String(d[0]) === asset;
  return hasEvent(found, "assets", "Transferred", transferred) ? undefined : "no-transfer";
}

/**
 * Reads the extrinsic at its timepoint `<block hash>-<index>`. It must have the recorded hash, have dispatched, and
 * carry the `Remarked` event for this hash's remark and a `Transferred` event of the recorded asset. A settlement and a
 * failure alike carry the finality of the read: `finalized` when the finalized chain holds that block, `head` when it
 * is above the finalized height. When the finalized chain holds another block at that height, the extrinsic at the
 * same index of the canonical block is read instead if its hash is the recorded one; otherwise the answer is pending
 * `not-located`. A block the reader does not have is pending `not-found`. A failed read, a bare broadcast hash or a
 * reader for another network is pending.
 */
export async function polkadotStatus(
  ref: PolkadotRef & { h: AtrHash; transaction: string },
  reader: PolkadotReader,
): Promise<PolkadotStatus> {
  if (!isObject(reader) || reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  if (typeof ref.transaction !== "string") return { state: "pending", why: "unreadable" };
  if (BARE_HASH.test(ref.transaction)) return { state: "pending", why: "not-located" };
  const tp = TIMEPOINT.exec(ref.transaction);
  if (tp === null) return { state: "pending", why: "unreadable" };
  const block = tp[1]! as Hex;
  const index = Number(tp[2]);
  const nh = normalHash(ref.h);
  if (nh === null) return { state: "pending", why: "unreadable" };

  const x = await readSafely(() => reader.extrinsic(block, index));
  if ("unreadable" in x) return { state: "pending", why: "unreadable" };
  if (x.ok === null) return { state: "pending", why: "not-found" };
  if (!isExtrinsic(x.ok)) return { state: "pending", why: "unreadable" };
  const found = x.ok;
  const height = found.at.height;
  const answer = (read: PolkadotExtrinsic, finality: "finalized" | "head"): PolkadotStatus => {
    const why = failureOf(read, ref, nh);
    const transaction = `${read.at.hash}-${index}`;
    return why === undefined
      ? { state: "settled", finality, height: read.at.height, transaction }
      : { state: "failed", why, finality, height: read.at.height, transaction };
  };

  const finalized = await readSafely(() => reader.finalizedHeight());
  if ("unreadable" in finalized || typeof finalized.ok !== "bigint") return { state: "pending", why: "unreadable" };
  if (finalized.ok < height) return answer(found, "head");
  const canonical = await readSafely(() => reader.extrinsic(height, index));
  if ("unreadable" in canonical) return { state: "pending", why: "unreadable" };
  if (canonical.ok === null) return { state: "pending", why: "not-located" };
  if (!isExtrinsic(canonical.ok)) return { state: "pending", why: "unreadable" };
  if (hashEquals(canonical.ok.at.hash, block)) return answer(found, "finalized");
  if (canonical.ok.at.height === height && hashEquals(canonical.ok.hash, ref.extrinsicHash)) {
    return answer(canonical.ok, "finalized");
  }
  return { state: "pending", why: "not-located" };
}

/**
 * The hash from the landed extrinsic alone, for anyone holding its timepoint: its raw bytes end with the remark call,
 * and the chain's record of it has the same hash, dispatched, with the `Remarked` event. Two calls.
 */
export async function polkadotRecover(
  ref: { network: PolkadotNetwork; transaction: string },
  reader: PolkadotReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(reader) || reader.network !== ref.network) return refusal("polkadot/wrong-reader");
  const tp = typeof ref.transaction === "string" ? TIMEPOINT.exec(ref.transaction) : null;
  if (tp === null) return refusal("polkadot/transaction-malformed");
  const block = tp[1]! as Hex;
  const index = Number(tp[2]);
  const raws = await readSafely(() => reader.rawExtrinsics(block));
  if ("unreadable" in raws) return refusal("polkadot/unreadable");
  if (raws.ok === null || !Array.isArray(raws.ok)) return refusal("polkadot/not-found");
  const raw = raws.ok[index];
  if (typeof raw !== "string") return refusal("polkadot/not-found");
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(raw) || raw.length > 2 * MAX_EXTRINSIC + 2) {
    return refusal("polkadot/extrinsic-malformed");
  }
  const xt = fromHex(raw);
  const split = splitSigned(xt);
  if (isRefusal(split)) return split;
  const tailLength = 4 + REMARK_LENGTH;
  const tail = xt.subarray(xt.length - tailLength);
  const tailHead = concat(CALL.remarkWithEvent, compact(BigInt(REMARK_LENGTH)));
  if (xt.length - tailLength < split.end || !equalBytes(tail.subarray(0, 4), tailHead)) {
    return refusal("polkadot/call-not-profile");
  }
  let h: AtrHash | null;
  try {
    h = fromLcpString(UTF8.decode(tail.subarray(4)));
  } catch {
    h = null;
  }
  if (h === null) return refusal("polkadot/remark-not-lcp");
  const x = await readSafely(() => reader.extrinsic(block, index));
  if ("unreadable" in x) return refusal("polkadot/unreadable");
  if (x.ok === null || !isExtrinsic(x.ok)) return refusal("polkadot/not-found");
  if (!hashEquals(x.ok.hash, extrinsicHash(xt))) return refusal("polkadot/hash-mismatch");
  const remarkHash = toHex(blake256(tail.subarray(4)));
  if (!x.ok.success || !hasEvent(x.ok, "system", "Remarked", (d) => typeof d[1] === "string" && hashEquals(d[1], remarkHash))) {
    return refusal("polkadot/no-remark");
  }
  return h;
}

/**
 * Finds a payment nobody named, by hashing every extrinsic of each block from `from` to `to` (at most 256 blocks).
 * The first match gives its timepoint; a block that does not exist ends the scan with null.
 */
export async function polkadotLocate(
  ref: PolkadotRef,
  reader: PolkadotReader,
  from: bigint,
  to: bigint,
): Promise<string | null | Refusal> {
  if (!isObject(reader) || reader.network !== ref.network) return refusal("polkadot/wrong-reader");
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
      if (x.ok === null || !isExtrinsic(x.ok)) return null;
      return `${x.ok.at.hash}-${i}`;
    }
  }
  return null;
}

/** The option unchanged: the hash rides in the signed call, not in the option. */
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
    "The payer signed one Polkadot Asset Hub extrinsic whose call is an atomic batch of a transfer of the asset and an " +
    "on-chain remark whose bytes are this ATR's hash in LCP string form. The chain verified the signature, which " +
    "covers the call, and executed the batch, which applies both calls or neither. Its Remarked event carries the " +
    "BLAKE2b-256 of the remark, and its Transferred event names the asset, at the finality recorded. This does not " +
    "show that amount, payee, asset or timing match the ATR's content.",
});

export const exactPolkadotRemark = Object.freeze({
  id: ID,
  pattern,
  claims: true as const,
  carrier: null,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: polkadotStatus,
  recover: polkadotRecover,
});
