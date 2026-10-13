/**
 * TON: the pairing `x402/exact/tvm`. The ATR hash rides in the scheme's `extra.forwardPayload` as a TEP-74 text
 * comment holding its LCP string. The payer's W5 wallet signs a request whose one Jetton transfer carries that
 * payload; settlement is read from the W5 wallet's transaction with that request and the Jetton wallets' transactions
 * it led to, through a bounded reader.
 */
import type * as TonCore from "@ton/core";
import type { Address, Cell, MessageRelaxed } from "@ton/core";
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import type { TvmPayment } from "./internal/tvm.js";
import {
  advertiseFor,
  chosen,
  offeredAt,
  paymentWith,
  presentedWith,
  readFor,
  type OptionFilter,
  type X402Read,
} from "./internal/x402.js";
import { decimalBelow } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";

/**
 * A TON cell, as `@ton/core`'s `Cell` gives one: its data bits, its references and its representation hash. The entry
 * point's public types name this shape rather than the optional peer's class, and a `Cell` is one.
 */
export interface TonCell {
  readonly bits: { readonly length: number };
  readonly refs: readonly TonCell[];
  hash(level?: number): Uint8Array;
}
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";

/** The optional peer, loaded once; undefined when it is not installed, and every function needing it refuses. */
const peer: typeof TonCore | undefined = await import("@ton/core").then(
  (m) => m,
  () => undefined,
);

/** tvm:<global_id>: tvm:-239 mainnet, tvm:-3 testnet. */
export type TvmNetwork = `tvm:${number}`;
export const OP = {
  jettonTransfer: 0x0f8a7ea5,
  internalTransfer: 0x178d4519,
  internalSigned: 0x73696e74,
  sendMsg: 0x0ec3c86d,
} as const;

/** A transaction as a TON Center v3 endpoint reports it. `inBody` is the inbound message body as a BoC. */
export interface TonTx {
  hash: string;
  account: string;
  aborted: boolean;
  /** TON Center v3's `FinalityState`: 0 pending, 1 confirmed, 2 finalized. */
  finality: 0 | 1 | 2;
  inBody: Uint8Array | null;
  outMsgs: readonly { hash: string; opcode: number | null }[];
}

/**
 * Bounded, read-only calls against one network's TON Center v3 endpoint. Every failure rejects, for example with
 * `ReaderError` from `@integraledger/lcp/evm`; any rejection reads as unreadable.
 */
export interface TvmReader {
  readonly network: TvmNetwork;
  /**
   * GET /api/v3/transactionsByMessage?body_hash=…&direction=in, with `headUtime`: the `gen_utime` of a masterchain
   * block through which the index that answered holds every block, read from that same index before the lookup, or null
   * when the reader cannot read it from that index. `masterchainInfo`'s `last` can be ahead of an earlier block the
   * index has not finished writing, so on its own it does not name such a block. A lookup naming no time never reads
   * `expired`, nor `no-transfer` or `aborted` from the W5 wallet's transactions.
   */
  byInBody(bodyHash: Hex): Promise<{ transactions: readonly TonTx[]; headUtime: number | null }>;
  /** GET /api/v3/transactionsByMessage?msg_hash=…&direction=in */
  byInMessage(msgHash: string): Promise<readonly TonTx[]>;
  /** GET /api/v3/transactions?hash=… */
  byHash(txHash: string): Promise<TonTx | null>;
  /** GET /api/v3/masterchainInfo: the last indexed block's gen_utime. */
  headUtime(): Promise<number>;
}

/** The read keys a payment's settlement is read by. */
export interface TvmRef {
  network: TvmNetwork;
  /** The representation hash of the Jetton transfer body the W5 request sends. */
  transferBodyHash: Hex;
  /** The payer's Jetton wallet, raw: the destination of the W5 request's one message. */
  jettonWallet: string;
  /** The representation hash of the signed W5 request: the body of the message to the payer's wallet. */
  requestBodyHash: Hex;
  /** The payer's W5 wallet, raw: the destination of the settlement message. */
  wallet: string;
  validUntil: number;
}

export type TvmStatus =
  | { state: "settled"; finality: "confirmed" | "finalized" }
  | { state: "pending"; why: "not-found" | "in-flight" | "not-final" | "unreadable" }
  | { state: "failed"; why: "aborted" | "no-transfer" | "bounced" | "expired" };

interface TvmChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  /** The payer's W5 wallet, raw. */
  wallet: string;
  /** `get_subwallet_id`. */
  walletId: number;
  seqno: number;
  /** The payer's Jetton wallet for `asset`, raw (`get_wallet_address` on the master). */
  jettonWallet: string;
  /** The value attached to the outgoing message, above `forwardTonAmount`. */
  attachNanotons: bigint;
  /** Seconds since the epoch. */
  now: number;
  /** The wallet's state init, for a wallet not yet deployed: a cell, or a base64 BoC of one root cell. */
  stateInit?: TonCell | string;
}

export interface TvmUnsigned {
  /** The 32-byte representation hash of the W5 request the wallet key signs. */
  request: { kind: "ton-w5"; hash: Uint8Array };
  /** Takes the 64-byte Ed25519 signature. */
  complete(signature: Uint8Array): TvmPayment | Refusal;
}

const ID = "x402/exact/tvm" as const;
const MAX_BOC_BYTES = 8192;
const MAX_CELLS = 512;
const MAX_DEPTH = 32;
const COINS_LIMIT = 1n << 120n;
const UINT32_LIMIT = 2 ** 32;
const NETWORK = /^tvm:(-?(?:0|[1-9][0-9]{0,15}))$/;
const RAW_ADDRESS = /^-?[0-9]{1,10}:[0-9a-fA-F]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SIGNATURE_BITS = 512;
const SEND_MODE = 3;
/**
 * The head read first must pass `validUntil` by more than this many seconds before a request whose Jetton transfer no
 * W5 transaction emitted reads failed. A W5 transaction runs at its shard block's time, and a masterchain block
 * references that shard block only later, so the masterchain head can pass `validUntil` before an index holds a
 * transaction that ran in time.
 */
const EXPIRY_MARGIN = 60;

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** The comment cell of `lcpComment`. */
function comment(h: AtrHash): Cell | Refusal {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (peer === undefined) return refusal("tvm/peer-missing");
  return peer.beginCell().storeUint(0, 32).storeBuffer(Buffer.from(utf8.encode(toLcpString(nh)))).endCell();
}

/**
 * TEP-74's text comment: 32 zero bits, then the UTF-8 of the hash's LCP string. A value that is not a 32-byte hash is
 * `x402/payload-malformed`.
 */
export function lcpComment(h: AtrHash): TonCell | Refusal {
  return comment(h);
}

/** One root cell as a BoC with a CRC32C and no index, in base64. */
function bocOf(c: Cell): string {
  return c.toBoc({ idx: false, crc32: true }).toString("base64");
}

/**
 * The one root of a base64 BoC of at most 8 KiB, at most 512 cells and depth 32, or the refusal. An exotic cell is
 * refused only where a read parses it: every parse here refuses one without throwing, and a cell no read parses,
 * such as a state init's library code, is left as it is.
 */
function rootOf(boc: unknown): Cell | Refusal {
  if (peer === undefined) return refusal("tvm/peer-missing");
  if (typeof boc !== "string" || boc.length === 0 || !BASE64.test(boc)) return refusal("tvm/boc-malformed");
  const bytes = Buffer.from(boc, "base64");
  if (bytes.length > MAX_BOC_BYTES) return refusal("tvm/boc-too-large");
  let roots: Cell[];
  try {
    roots = peer.Cell.fromBoc(bytes);
  } catch {
    return refusal("tvm/boc-malformed");
  }
  if (roots.length !== 1) return refusal("tvm/boc-malformed");
  const root = roots[0]!;
  if (root.depth() > MAX_DEPTH) return refusal("tvm/boc-too-large");
  if (cellCount(root) > MAX_CELLS) return refusal("tvm/boc-too-large");
  return root;
}

/** The distinct cells under `root`, counted up to one past the bound. */
function cellCount(root: Cell): number {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0 && seen.size <= MAX_CELLS) {
    const c = stack.pop()!;
    const k = c.hash().toString("hex");
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(...c.refs);
  }
  return seen.size;
}

/** The hash in a text comment cell holding an LCP string and no references, or null. */
function commentHash(c: Cell): AtrHash | null {
  if (c.isExotic || c.refs.length !== 0 || c.bits.length < 32 || (c.bits.length - 32) % 8 !== 0) return null;
  const s = c.beginParse();
  if (s.loadUint(32) !== 0) return null;
  let text: string;
  try {
    text = strictUtf8.decode(s.loadBuffer((c.bits.length - 32) / 8));
  } catch {
    return null;
  }
  return fromLcpString(text);
}

/** The Jetton transfer body's fields up to and including its forward payload, which must be a reference. */
function jettonTransfer(body: Cell): { payload: Cell | null } | Refusal {
  try {
    const s = body.beginParse();
    if (s.remainingBits < 32 || s.loadUint(32) !== OP.jettonTransfer) return refusal("tvm/not-jetton-transfer");
    s.loadUintBig(64);
    s.loadCoins();
    s.loadAddress();
    s.loadMaybeAddress();
    s.loadMaybeRef();
    s.loadCoins();
    return { payload: s.loadBit() ? s.loadRef() : null };
  } catch {
    return refusal("tvm/not-jetton-transfer");
  }
}

function relaxed(c: Cell): MessageRelaxed | null {
  if (peer === undefined) return null;
  try {
    return peer.loadMessageRelaxed(c.beginParse());
  } catch {
    return null;
  }
}

/**
 * Reads the signed request in a settlement BoC: an internal message whose body is a W5 `internal_signed` request with
 * exactly one `action_send_msg` behind an empty list, carrying a Jetton transfer whose forward payload is a reference
 * to a text comment holding an LCP string.
 */
export function tvmCarrier(settlementBoc: string): {
  h: AtrHash;
  transferBodyHash: Hex;
  jettonWallet: string;
  requestBodyHash: Hex;
  wallet: string;
  validUntil: number;
  payload: TonCell;
} | Refusal {
  return carrierIn(settlementBoc);
}

/** `tvmCarrier`, with the payload as the peer's cell. */
function carrierIn(settlementBoc: string): {
  h: AtrHash;
  transferBodyHash: Hex;
  jettonWallet: string;
  requestBodyHash: Hex;
  wallet: string;
  validUntil: number;
  payload: Cell;
} | Refusal {
  const root = rootOf(settlementBoc);
  if (isRefusal(root)) return root;
  const message = relaxed(root);
  if (message === null || message.info.type !== "internal") return refusal("tvm/boc-malformed");

  let validUntil: number;
  let actions: Cell;
  try {
    const s = message.body.beginParse();
    if (s.remainingBits < 32 || s.loadUint(32) !== OP.internalSigned) return refusal("tvm/not-w5-signed");
    s.loadUint(32);
    validUntil = s.loadUint(32);
    s.loadUint(32);
    const list = s.loadMaybeRef();
    if (list === null || s.loadBit()) return refusal("tvm/actions");
    if (s.remainingBits !== SIGNATURE_BITS || s.remainingRefs !== 0) return refusal("tvm/not-w5-signed");
    actions = list;
  } catch {
    return refusal("tvm/not-w5-signed");
  }

  const send = sendMessage(actions);
  if (isRefusal(send)) return send;
  const out = relaxed(send);
  if (out === null || out.info.type !== "internal") return refusal("tvm/not-jetton-transfer");
  const transfer = jettonTransfer(out.body);
  if (isRefusal(transfer)) return transfer;
  if (transfer.payload === null) return refusal("tvm/payload-not-lcp");
  const h = commentHash(transfer.payload);
  if (h === null) return refusal("tvm/payload-not-lcp");
  return {
    h,
    transferBodyHash: `0x${out.body.hash().toString("hex")}`,
    jettonWallet: out.info.dest.toRawString(),
    requestBodyHash: `0x${message.body.hash().toString("hex")}`,
    wallet: message.info.dest.toRawString(),
    validUntil,
    payload: transfer.payload,
  };
}

/** The outgoing message of an action list holding exactly one `action_send_msg` behind an empty `prev`. */
function sendMessage(actions: Cell): Cell | Refusal {
  if (actions.isExotic) return refusal("tvm/boc-malformed");
  if (actions.bits.length !== 40 || actions.refs.length !== 2) return refusal("tvm/actions");
  const prev = actions.refs[0]!;
  if (prev.bits.length !== 0 || prev.refs.length !== 0) return refusal("tvm/actions");
  const s = actions.beginParse();
  if (s.loadUint(32) !== OP.sendMsg) return refusal("tvm/actions");
  return actions.refs[1]!;
}

// ── Settlement.

/**
 * Reads the head's time first. Then finds the signed request by its body hash on the payer's W5 wallet: only a W5
 * transaction there that did not abort and emitted the Jetton transfer counts, because W5 checks the request's
 * signature before any action runs, so a request the payer did not sign sends nothing from that wallet. It follows that
 * message to the payer's Jetton wallet, and that wallet's `internal_transfer` to the payee's Jetton wallet: settled
 * when both Jetton wallets executed without aborting, at the lower finality of the two. An equal Jetton body executed
 * any other way is never counted. A W5 transaction that emitted the Jetton transfer is pending `in-flight` until the
 * Jetton wallet takes it, because an internal message carries no expiry. When no W5 transaction with the request
 * emitted the Jetton transfer, the head read first decides, because W5 refuses the request once `valid_until <= now()`:
 * pending `not-found` up to 60 seconds past `validUntil`, since a W5 transaction runs at its shard block's time, which
 * a masterchain block references only later; past that, failed `expired` when the W5 wallet holds no transaction with
 * the request, `no-transfer` when one executed and emitted nothing, and `aborted` when every one aborted, each only
 * when the lookup names an indexed time at or past the head read first. The lookup shows the W5 wallet's transactions
 * only through the blocks its index holds, and an internal request that aborts leaves its seqno unused (wallet_v5.fc
 * commits the seqno only for an external request), so the request can run again before `validUntil`: a lookup whose
 * index lags that head, or that names no time, is pending `not-found`. The payer's Jetton wallet's transaction aborted
 * is failed `aborted`, one with no `internal_transfer` failed `no-transfer`, and an aborted delivery failed `bounced`,
 * at any head and at any finality. A transaction on any other account is ignored. A failed or malformed read, a
 * malformed reference (a `requestBodyHash` that is not `0x` and 64 hex digits included), or a reader for another
 * network is pending `unreadable`, a malformed reference with nothing read; the request's body hash is looked up in
 * lowercase. At most four calls.
 */
export async function tvmStatus(ref: TvmRef, reader: TvmReader): Promise<TvmStatus> {
  const unreadable = { state: "pending", why: "unreadable" } as const;
  if (peer === undefined || !isObject(ref) || !isObject(reader) || reader.network !== ref.network) return unreadable;
  const request = normalHash(ref.requestBodyHash);
  if (request === null || rawAddress(ref.jettonWallet) === null || rawAddress(ref.wallet) === null || !isUint32(ref.validUntil)) {
    return unreadable;
  }
  const head = await headTime(reader);
  const w5 = await transactionsOn(reader, request, ref.wallet);
  if (w5 === null) return unreadable;
  const transfer = w5.transactions
    .filter((t) => !t.aborted)
    .flatMap((t) => t.outMsgs)
    .find((m) => m.opcode === OP.jettonTransfer);
  if (transfer === undefined) return unsent(ref, w5, head);
  const taken = await transactionsTaking(reader, transfer.hash);
  if (taken === null) return unreadable;
  const mine = taken.filter((t) => sameAccount(t.account, ref.jettonWallet));
  if (mine.length === 0) return { state: "pending", why: "in-flight" };
  const first = mine.find((t) => !t.aborted);
  if (first === undefined) return { state: "failed", why: "aborted" };
  const internal = first.outMsgs.find((m) => m.opcode === OP.internalTransfer);
  if (internal === undefined) return { state: "failed", why: "no-transfer" };
  const delivered = await transactionsTaking(reader, internal.hash);
  if (delivered === null) return unreadable;
  const second = delivered[0];
  if (second === undefined) return { state: "pending", why: "in-flight" };
  if (second.aborted) return { state: "failed", why: "bounced" };
  const finality = Math.min(first.finality, second.finality);
  if (finality >= 2) return { state: "settled", finality: "finalized" };
  if (finality >= 1) return { state: "settled", finality: "confirmed" };
  return { state: "pending", why: "not-final" };
}

/**
 * The status while no W5 transaction with the request has emitted the Jetton transfer: the earlier head decides, and
 * the lookup counts only when its index holds every block through that head.
 */
function unsent(ref: TvmRef, w5: OnAccount, head: number | null): TvmStatus {
  if (head === null) return { state: "pending", why: "unreadable" };
  if (head <= ref.validUntil + EXPIRY_MARGIN) return { state: "pending", why: "not-found" };
  const covered = w5.headUtime !== null && w5.headUtime >= head;
  if (!covered) return { state: "pending", why: "not-found" };
  if (w5.transactions.length === 0) return { state: "failed", why: "expired" };
  return w5.transactions.some((t) => !t.aborted) ? { state: "failed", why: "no-transfer" } : { state: "failed", why: "aborted" };
}

/** The transactions that took this message, or null when the read fails or its answer is malformed. */
async function transactionsTaking(reader: TvmReader, msgHash: string): Promise<readonly TonTx[] | null> {
  let found: readonly TonTx[];
  try {
    found = await reader.byInMessage(msgHash);
  } catch {
    return null;
  }
  return Array.isArray(found) && found.every(isTonTx) ? found : null;
}

/** The head's `gen_utime`, or null when the read fails or its answer is not a safe integer. */
async function headTime(reader: TvmReader): Promise<number | null> {
  let head: unknown;
  try {
    head = await reader.headUtime();
  } catch {
    return null;
  }
  return Number.isSafeInteger(head) ? (head as number) : null;
}

/** A lookup's transactions on one account, with the time through which its index holds every block (null: none). */
interface OnAccount {
  transactions: TonTx[];
  headUtime: number | null;
}

/** The transactions with this inbound body on `account`, or null when the read fails or its answer is malformed. */
async function transactionsOn(reader: TvmReader, bodyHash: Hex, account: string): Promise<OnAccount | null> {
  let found: unknown;
  try {
    found = await reader.byInBody(bodyHash);
  } catch {
    return null;
  }
  if (!isObject(found)) return null;
  const { transactions, headUtime } = found;
  if (!Array.isArray(transactions) || !transactions.every(isTonTx)) return null;
  return {
    transactions: transactions.filter((t) => sameAccount(t.account, account)),
    headUtime: Number.isSafeInteger(headUtime) ? (headUtime as number) : null,
  };
}

/** Recovers the hash from the payer Jetton wallet's transaction: the comment in its inbound Jetton transfer. One call. */
export async function tvmRecover(ref: { network: TvmNetwork; transaction: string }, reader: TvmReader): Promise<AtrHash | Refusal> {
  if (peer === undefined) return refusal("tvm/peer-missing");
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("tvm/wrong-reader");
  let tx: TonTx | null;
  try {
    tx = await reader.byHash(ref.transaction);
  } catch {
    return refusal("tvm/unreadable");
  }
  if (tx === null) return refusal("tvm/not-found");
  if (!isTonTx(tx) || tx.inBody === null) return refusal("tvm/unreadable");
  const body = rootOf(Buffer.from(tx.inBody).toString("base64"));
  if (isRefusal(body)) return body;
  const transfer = jettonTransfer(body);
  if (isRefusal(transfer)) return transfer;
  const h = transfer.payload === null ? null : commentHash(transfer.payload);
  return h ?? refusal("tvm/payload-not-lcp");
}

function isTonTx(t: unknown): t is TonTx {
  if (!isObject(t)) return false;
  const { hash, account, aborted, finality, inBody, outMsgs } = t;
  return (
    typeof hash === "string" &&
    typeof account === "string" &&
    typeof aborted === "boolean" &&
    (finality === 0 || finality === 1 || finality === 2) &&
    (inBody === null || inBody instanceof Uint8Array) &&
    Array.isArray(outMsgs) &&
    outMsgs.every((m) => isObject(m) && typeof m["hash"] === "string" && (m["opcode"] === null || typeof m["opcode"] === "number"))
  );
}

function sameAccount(a: string, b: string): boolean {
  const x = rawAddress(a);
  const y = rawAddress(b);
  return x !== null && y !== null && x.equals(y);
}

function rawAddress(s: unknown): Address | null {
  if (peer === undefined || typeof s !== "string" || !RAW_ADDRESS.test(s)) return null;
  try {
    return peer.Address.parseRaw(s);
  } catch {
    return null;
  }
}

// ── The pairing.

/**
 * The option's scheme, network, asset, `payTo` and `extra`: what `bound` and `reference` require of the option a
 * presented payment echoes. They read no amount and no timeout, so neither is checked here.
 */
const presentable: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact") return refusal("x402/option-not-this-pairing");
  if (typeof o.network !== "string" || !o.network.startsWith("tvm:")) return refusal("x402/option-not-this-pairing");
  const extra: unknown = o.extra;
  if (extra !== undefined && !isObject(extra)) return refusal("tvm/option-malformed");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  const m = NETWORK.exec(o.network);
  if (m === null || !Number.isSafeInteger(Number(m[1]))) return refusal("tvm/network-malformed");
  if (peer === undefined) return refusal("tvm/peer-missing");
  if (rawAddress(o.asset) === null || rawAddress(o.payTo) === null) return refusal("tvm/option-malformed");
  if (extra?.["areFeesSponsored"] !== true) return refusal("tvm/option-malformed");
  const forwardTon = extra["forwardTonAmount"];
  if (forwardTon !== undefined && decimalBelow(forwardTon, COINS_LIMIT) === undefined) return refusal("tvm/option-malformed");
  const response = extra["responseDestination"];
  if (response !== undefined && rawAddress(response) === null) return refusal("tvm/option-malformed");
  return true;
};

/**
 * `presentable`, then the amount as a Jetton amount below 2^120 and `maxTimeoutSeconds` a positive safe integer, which
 * `build` writes into the request: what `pairingOf`, `advertise`, `read` and `build` require.
 */
const check: OptionFilter = (o) => {
  const p = presentable(o);
  if (p !== true) return p;
  if (decimalBelow(o.amount, COINS_LIMIT) === undefined) return refusal("tvm/option-malformed");
  if (!Number.isSafeInteger(o.maxTimeoutSeconds) || o.maxTimeoutSeconds < 1) return refusal("tvm/option-malformed");
  return true;
};

/**
 * The option without `extra.forwardPayload`, where the hash rides. An option that carries a `refused` member is
 * `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  if (!isObject(option) || !isObject(option.extra) || !("forwardPayload" in option.extra)) return option;
  const { forwardPayload: _placed, ...extra } = option.extra;
  return { ...option, extra };
}

/** x402's legal context placed in the document, then `extra.forwardPayload` on the offered option set to the hash's comment. */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(check)(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const carrier = comment(normalHash(h)!);
  if (isRefusal(carrier)) return carrier;
  const present = offer.extra?.["forwardPayload"];
  if (present !== undefined) {
    const cell = rootOf(present);
    if (isRefusal(cell) || !cell.equals(carrier)) return refusal("tvm/carrier-occupied");
  }
  const i = offeredAt(placed.accepts, offer);
  const accepts = [...placed.accepts];
  accepts[i] = { ...offer, extra: { ...offer.extra, forwardPayload: bocOf(carrier) } };
  return { ...placed, accepts };
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(check)(doc);
}

/** True when the option's `extra.forwardPayload` is one cell whose hash is the payload's. */
function carries(option: PaymentRequirements, payload: Cell): boolean {
  const cell = rootOf(option.extra?.["forwardPayload"]);
  return !isRefusal(cell) && cell.equals(payload);
}

/** The W5 request for the chosen option: one Jetton transfer whose forward payload is the hash's comment. */
async function build(c: TvmChoice, h: AtrHash): Promise<TvmUnsigned | Refusal> {
  if (peer === undefined) return refusal("tvm/peer-missing");
  if (!isObject(c)) return refusal("x402/option-malformed");
  const { required, accepted, wallet, walletId, seqno, jettonWallet, attachNanotons, now, stateInit } = c;
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  const carrier = comment(nh);
  if (isRefusal(carrier)) return carrier;
  if (!carries(accepted, carrier)) return refusal("tvm/carrier-mismatch");
  const walletAddress = rawAddress(wallet);
  const jettonAddress = rawAddress(jettonWallet);
  if (walletAddress === null || jettonAddress === null) return refusal("x402/option-malformed");
  if (!isUint32(walletId) || !isUint32(seqno) || !Number.isSafeInteger(now) || now < 0) {
    return refusal("x402/option-malformed");
  }
  const validUntil = now + accepted.maxTimeoutSeconds;
  if (!isUint32(validUntil)) return refusal("x402/option-malformed");
  const initCell = stateInit === undefined || stateInit instanceof peer.Cell ? stateInit : rootOf(stateInit);
  if (isRefusal(initCell)) return initCell;
  const extra = accepted.extra!;
  const forwardTon = extra["forwardTonAmount"] === undefined ? 0n : BigInt(extra["forwardTonAmount"] as string);
  if (typeof attachNanotons !== "bigint" || attachNanotons >= COINS_LIMIT) return refusal("x402/option-malformed");
  if (attachNanotons <= forwardTon) return refusal("tvm/value-too-low");
  const response = extra["responseDestination"] === undefined ? null : rawAddress(extra["responseDestination"]);

  const body = peer.beginCell()
    .storeUint(OP.jettonTransfer, 32)
    .storeUint(0, 64)
    .storeCoins(BigInt(accepted.amount))
    .storeAddress(rawAddress(accepted.payTo))
    .storeAddress(response)
    .storeBit(0)
    .storeCoins(forwardTon)
    .storeBit(1)
    .storeRef(carrier)
    .endCell();
  const out = peer.beginCell()
    .store(
      peer.storeMessageRelaxed(
        {
          info: {
            type: "internal",
            ihrDisabled: true,
            bounce: true,
            bounced: false,
            dest: jettonAddress,
            value: { coins: attachNanotons },
            ihrFee: 0n,
            forwardFee: 0n,
            createdLt: 0n,
            createdAt: 0,
          },
          body,
        },
        { forceRef: true },
      ),
    )
    .endCell();
  const actions = peer.beginCell().storeRef(peer.beginCell().endCell()).storeUint(OP.sendMsg, 32).storeUint(SEND_MODE, 8).storeRef(out).endCell();
  const request = peer.beginCell()
    .storeUint(OP.internalSigned, 32)
    .storeUint(walletId, 32)
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32)
    .storeBit(1)
    .storeRef(actions)
    .storeBit(0)
    .endCell();
  let init: MessageRelaxed["init"];
  if (initCell !== undefined) {
    try {
      init = peer.loadStateInit(initCell.beginParse());
    } catch {
      return refusal("x402/option-malformed");
    }
  }
  return {
    request: { kind: "ton-w5", hash: Uint8Array.from(request.hash()) },
    complete(signature: Uint8Array): TvmPayment | Refusal {
      if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_BITS / 8) {
        return refusal("x402/signature-malformed");
      }
      const signed = peer.beginCell().storeSlice(request.beginParse()).storeBuffer(Buffer.from(signature)).endCell();
      const message: MessageRelaxed = {
        info: {
          type: "internal",
          ihrDisabled: true,
          bounce: false,
          bounced: false,
          dest: walletAddress,
          value: { coins: 0n },
          ihrFee: 0n,
          forwardFee: 0n,
          createdLt: 0n,
          createdAt: 0,
        },
        ...(init !== undefined ? { init } : {}),
        body: signed,
      };
      const root = peer.beginCell().store(peer.storeMessageRelaxed(message, { forceRef: true })).endCell();
      return paymentWith(required, accepted, { settlementBoc: bocOf(root), asset: accepted.asset });
    },
  };
}

/** The signed request's carrier, checked against the option's forward payload. */
function carried(presented: unknown): { accepted: PaymentRequirements; c: Exclude<ReturnType<typeof carrierIn>, Refusal> } | Refusal {
  const p = presentedWith(presented, presentable);
  if (isRefusal(p)) return p;
  const boc = p.payload["settlementBoc"];
  if (typeof boc !== "string") return refusal("x402/payload-malformed");
  const c = carrierIn(boc);
  if (isRefusal(c)) return c;
  if (!carries(p.accepted, c.payload)) return refusal("tvm/carrier-mismatch");
  return { accepted: p.accepted, c };
}

/**
 * The hash in the forward payload of the transfer the payer's W5 wallet signed, which must be the option's. The
 * signature is not verified here; the facilitator verifies it, and the W5 contract checks it before any action runs.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = carried(presented);
  return isRefusal(r) ? r : r.c.h;
}

/** The read keys, computed from the signed BoC. */
async function reference(presented: unknown): Promise<TvmRef | Refusal> {
  const r = carried(presented);
  if (isRefusal(r)) return r;
  return {
    network: r.accepted.network as TvmNetwork,
    transferBodyHash: r.c.transferBodyHash,
    jettonWallet: r.c.jettonWallet,
    requestBodyHash: r.c.requestBodyHash,
    wallet: r.c.wallet,
    validUntil: r.c.validUntil,
  };
}

function isUint32(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n < UINT32_LIMIT;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: true,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer's W5 wallet signed a request whose one Jetton transfer carries this ATR's hash in its forward payload, " +
    "as a TEP-74 text comment in LCP string form. The payer's Jetton wallet executed that transfer, and the payee's " +
    "Jetton wallet accepted it. The comment is on chain in the transfer's message bodies. This does not show that " +
    "amount, payee, asset or timing match the ATR's content.",
});

export const exactTvm = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: "extra.forwardPayload" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: tvmStatus,
  recover: tvmRecover,
});

