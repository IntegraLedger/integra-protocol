/**
 * TON: the pairing `x402/exact/tvm`. The ATR hash rides in the scheme's `extra.forwardPayload` as a TEP-74 text comment
 * holding its LCP string.
 *
 * The payer's W5 wallet signs a request whose one Jetton transfer carries that payload; settlement is read from the W5
 * wallet's transaction with that request and the Jetton wallets' transactions it led to, through a bounded reader.
 *
 * @module
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type * as TonCore from "@ton/core";
import type { Address, Cell, Slice } from "@ton/core";
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash, sameJson } from "./fields.js";
import { crc32c, type TvmPayment } from "./internal/tvm.js";
import {
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  offeredAt,
  paymentWith,
  presentedWith,
  readFor,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { decimalBelow, fromBase64, sameBytes, toBase64 } from "./rail-bytes.js";
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
import { TVM } from "./internal/data/tvm.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import {
  decide,
  type Facts,
  type Moved,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type UnreadableReason,
} from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { TvmPayment } from "./internal/tvm.js";
export type { X402Payment, X402Read } from "./internal/x402.js";

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

/** An account's status as TON Center v3 states it. */
export type TonAccountStatus = "active" | "uninit" | "nonexist" | "frozen";

/** An account's status and data hash, as TON Center v3 states them before or after a transaction. */
export interface TonAccountState {
  status: TonAccountStatus;
  /** The representation hash of the account's data, in the index's spelling; null where the account holds none. */
  dataHash: string | null;
}

/** A transaction's out message: its hash, its body's opcode (null where it has none), and its body as a BoC. */
export interface TonOutMsg {
  hash: string;
  opcode: number | null;
  /** The body as a bag of cells (`message_content.body`); absent or null where the index gives none. */
  body?: Uint8Array | null;
}

/**
 * A transaction as a TON Center v3 endpoint reports it. `inBody` is the inbound message body as a BoC, or null when the
 * transaction has no inbound message body (its `in_msg`, or that message's `message_content.body`, is null). The members
 * after `outMsgs` are the ones the expiry read takes, from `/api/v3/transactions`: a transaction lacking one cannot be
 * placed, linked or classed, and the read holds its search there.
 */
export interface TonTx {
  hash: string;
  account: string;
  aborted: boolean;
  /** TON Center v3's `FinalityState`: 0 pending, 1 confirmed, 2 finalized. */
  finality: 0 | 1 | 2;
  inBody: Uint8Array | null;
  outMsgs: readonly TonOutMsg[];
  /** The inbound message's source, raw (`in_msg.source`); null for an external message. */
  inSource?: string | null;
  /** The masterchain block that holds it (`mc_block_seqno`); null while none does. */
  mcSeqno?: bigint | null;
  /** Its logical time, in decimal (`lt`). */
  lt?: string;
  /** Its predecessor on the account (`prev_trans_hash`, `prev_trans_lt`); null for the account's first. */
  prev?: { hash: string; lt: string } | null;
  /** The account's state before it (`account_state_before`, with `orig_status`). */
  before?: TonAccountState;
  /** The account's state after it (`account_state_after`, with `end_status`). */
  after?: TonAccountState;
}

/** A wallet's state as the index holds it (`walletStates`): status, code hash, sequence number, last transaction. */
export interface TonWalletState {
  status: TonAccountStatus;
  /** The representation hash of the account's code, `0x` and 64 hex digits; null where it holds none. */
  codeHash: Hex | null;
  /** The wallet's sequence number; null where the account holds no data. */
  seqno: number | null;
  /** The account's last transaction; null where it has none. */
  last: { hash: string; lt: string } | null;
}

/** The index's statement of the masterchain blocks it holds: every block from `first` through `last`, a finalized block. */
export interface TonIndexed {
  first: bigint;
  last: bigint;
  /** `last`'s `gen_utime`. */
  utime: number;
}

/**
 * Bounded, read-only calls against one network's TON Center v3 endpoint. Every failure rejects, for example with
 * `ReaderError` from `@integraledger/lcp/evm`: one of kind `too-large` reads as `too-large`, one of kind `malformed` as
 * `unparseable`, and any other rejection as `transport`.
 */
export interface TvmReader {
  readonly network: TvmNetwork;
  /** GET /api/v3/transactionsByMessage?body_hash=…&direction=in: the transactions that took a message with this body. */
  byInBody(bodyHash: Hex): Promise<readonly TonTx[]>;
  /** GET /api/v3/transactionsByMessage?msg_hash=…&direction=in */
  byInMessage(msgHash: string): Promise<readonly TonTx[]>;
  /** GET /api/v3/transactions?hash=… */
  byHash(txHash: string): Promise<TonTx | null>;
  /** GET /api/v3/masterchainInfo: the latest masterchain block's gen_utime, the latest head the endpoint serves. */
  headUtime(): Promise<number>;
  /**
   * The index's own statement of the masterchain blocks through which it holds every block, from the same index that
   * answers the other calls, or null where it states none. `masterchainInfo`'s `last` is no such statement: it can be
   * ahead of an earlier block the index has not finished writing.
   */
  indexed(): Promise<TonIndexed | null>;
  /** GET /api/v3/walletStates?address=…: the wallet's state as the index holds it. */
  walletState(account: string): Promise<TonWalletState>;
  /**
   * GET /api/v3/transactions?account=…&end_lt=…&sort=desc&limit=…: the account's transactions from `from` back, newest
   * first, at most `limit`, each with the members the expiry read takes.
   */
  transactions(account: string, from: { hash: string; lt: string }, limit: number): Promise<readonly TonTx[]>;
  /** `runGetMethod` `get_wallet_data` on a Jetton wallet: its master, raw. */
  jettonMaster(jettonWallet: string): Promise<string>;
  /** `runGetMethod` `get_wallet_address` on a Jetton master for an owner: the owner's Jetton wallet, raw. */
  jettonWallet(master: string, owner: string): Promise<string>;
}

/**
 * The read keys a payment's settlement is read by, the members of the payment presented, and the payee, the `payTo` of
 * the option the payment answers, for both party tests and no search key. It names no asset.
 */
export interface TvmRef {
  network: TvmNetwork;
  payee: string;
  /** H, which the request's Jetton transfer carries: the search for H looks for it in every run of the wallet. */
  h: AtrHash;
  /** The representation hash of the Jetton transfer body the W5 request sends. */
  transferBodyHash: Hex;
  /** The payer's Jetton wallet, raw: the address TON sends the W5 request's one message to. */
  jettonWallet: string;
  /**
   * The representation hash of the signed W5 request: the whole body of the message to the payer's wallet, its
   * signature and any bit or reference after `has_other_actions` 0, which W5 does not read, included.
   */
  requestBodyHash: Hex;
  /**
   * The representation hash of the W5 request with its signature removed, its last 512 bits: the hash the wallet's key
   * signs. It holds the members of the payment presented, the request the payer signed, whole, its signature apart.
   */
  signedHash: Hex;
  /** The payer's W5 wallet, raw: the address TON sends the settlement message to. */
  wallet: string;
  validUntil: number;
  /** The sequence number the request was signed against: the single-use value. */
  seqno: number;
  /** The representation hash of the code in the state init the payment carries; absent where it carries none. */
  codeHash?: Hex;
}


/** A transaction of the wallet's list by the two members its successor links it by: its hash and its logical time. */
export interface TonLink {
  readonly hash: string;
  /** In decimal. */
  readonly lt: string;
}

/**
 * The search position of the expiry read, from which the next read resumes: `top`, the newest transaction of the
 * wallet the search had listed, and `next`, the transaction it reads next, at or below which nothing is read yet. The
 * next read lists the wallet's transactions above `top`, which landed since, then reads on from `next`; the ones
 * between were read.
 */
export interface TvmSearch {
  readonly top: TonLink;
  readonly next: TonLink;
}

/**
 * The answer of `tvmStatus`, as the profile `read-status` gives it: each transfer of what moved named by the W5
 * transaction and, as its `place`, the hash of the Jetton `transfer` message that made it. Its marks are
 * `confirmed` and `finalized`, TON Center v3's finality states 1 and 2, in that order; a position is a masterchain
 * block's sequence number, and the search position a `TvmSearch`.
 */
export type TvmStatus = StatusAnswer<bigint, TvmMark, TvmSearch>;

export type TvmMark = "confirmed" | "finalized";
const MARKS: readonly TvmMark[] = ["confirmed", "finalized"];

export interface TvmChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  /** The payer's W5 wallet, raw, on a workchain TON's configuration holds (-1 or 0; else `x402/option-malformed`). */
  wallet: string;
  /** `get_subwallet_id`. */
  walletId: number;
  seqno: number;
  /** The payer's Jetton wallet for `asset`, raw (`get_wallet_address` on the master), on a workchain as `wallet` is. */
  jettonWallet: string;
  /** The value attached to the outgoing message, above `forwardTonAmount`. */
  attachNanotons: bigint;
  /** Seconds since the epoch. */
  now: number;
  /**
   * The wallet's state init, for a wallet not yet deployed: a cell, or a base64 BoC of one root cell. It must be exactly
   * one `StateInit`, as TON reads a message's state init: no bit or reference after its fields, at most 1,024 cells
   * read, and at most two Merkle proofs or updates nested in it. It must be one TON deploys a wallet from at the
   * configuration of the option's network: no libraries dictionary (global version 15), a fixed prefix length of at
   * most ConfigParam 43's `max_acc_fixed_prefix_length`, 8 (global version 10), and a representation hash that is
   * `wallet`'s 256-bit address, except the first fixed-prefix-length bits, which may differ, since TON deploys an
   * account only from a state init whose hash is its address (`check_in_msg_state_hash`). Else
   * `x402/option-malformed`. The settlement message carries it as its `init` exactly as given.
   */
  stateInit?: TonCell | string;
}

export interface TvmUnsigned {
  /**
   * What the wallet key signs. `signedBoc` is the W5 request, its signature not in it, as a base64 bag of cells of one
   * root; `hash` is that root cell's 32-byte representation hash. `tvmRequest` reads them.
   */
  request: { kind: "ton-w5"; hash: Uint8Array<ArrayBuffer>; signedBoc: string };
  /** Takes the 64-byte Ed25519 signature. */
  complete(signature: Uint8Array): TvmPayment | Refusal;
}

const ID = "x402/exact/tvm" as const;
/**
 * The largest bag of cells the pairing reads, in bytes: lcp's own resource bound, far above the settlement message
 * of one W5 request with a deploying state init (a few hundred bytes).
 */
export const MAX_TVM_BOC_BYTES = 8192;
/** The most distinct cells a bag of cells the pairing reads may hold: lcp's own resource bound, as above. */
export const MAX_TVM_CELLS = 512;
/** The deepest a bag of cells the pairing reads may be: lcp's own resource bound, as above. */
export const MAX_TVM_DEPTH = 32;
/**
 * The most nanotons `build` attaches above the option's forward TON amount: x402's TON facilitator (`@x402/tvm`)
 * refuses a request whose attached value is above `forwardTonAmount` plus this (`@x402/tvm` 2.30.0,
 * `src/exact/facilitator/scheme.ts:326-329`, `DEFAULT_JETTON_WALLET_MESSAGE_AMOUNT` in `src/constants.ts:14`).
 */
export const MAX_TVM_ATTACHED_ABOVE_FORWARD = 30_000_000n;
/**
 * The most transactions of the payer's wallet one read lists, back from its latest: lcp's own resource bound. Past it
 * the search is held at the last masterchain block read.
 */
export const MAX_TVM_LISTED = 256;
const MAX_BOC_BYTES = MAX_TVM_BOC_BYTES;
const MAX_CELLS = MAX_TVM_CELLS;
const MAX_DEPTH = MAX_TVM_DEPTH;
/** The three bag-of-cells magics TON reads: ton-blockchain/ton `crypto/vm/boc.h`, `boc_generic`, `boc_idx`, `boc_idx_crc32c`. */
const BOC_GENERIC = 0xb5ee9c72;
const BOC_INDEXED = 0x68ff65f3;
const BOC_INDEXED_CRC32C = 0xacc3a728;
/** The deepest a TON cell may be at any level: ton-blockchain/ton `CellTraits::max_depth`. */
const CELL_MAX_DEPTH = 1024;
/** The cells TON's validation reads of a message's state init, at most: ton-blockchain/ton `default_validate_max_cells`. */
const STATE_INIT_MAX_READS = 1024;
/** The Merkle proofs and updates a sent message may nest: ton-blockchain/ton `Transaction::max_allowed_merkle_depth`. */
const MAX_MERKLE_DEPTH = 2;
/** The network configuration TON's message rules rest on, for one network. */
interface TonConfiguration {
  /**
   * ConfigParam 8, `capabilities#c4 version:uint32`: the global version. From 4, TON's action phase takes a send mode's
   * +16 as bounce-on-fail (`bounce_on_fail_enabled`); from 10, it refuses an anycast address (`disable_anycast`),
   * deploys no account whose fixed prefix length is above `maxAccFixedPrefixLength`, and holds a message's extra
   * currencies to `maxMsgExtraCurrencies` (`extra_currency_v2`); from 12, a message's
   * `extra_flags` may set its two low bits only; from 15, no account is deployed from a state init that holds
   * libraries (`unpack_msg_state`).
   */
  readonly globalVersion: number;
  /**
   * The workchains a message may name: the masterchain (-1), and ConfigParam 12's workchains that are basic and accept
   * messages. Each takes 256-bit addresses only.
   */
  readonly workchains: ReadonlySet<number>;
  /** ConfigParam 43, `max_msg_extra_currencies`: how many extra currencies a sent message may hold. */
  readonly maxMsgExtraCurrencies: number;
  /** ConfigParam 43, `max_acc_fixed_prefix_length`: the longest fixed prefix of an account TON deploys. */
  readonly maxAccFixedPrefixLength: number;
}
/**
 * Mainnet's configuration (`tvm:-239`): the one `@ton/sandbox` 0.45.0 ships (`defaultConfig`, configuration seqno
 * 92871331, ConfigParam 19 global id -239), read offline. ConfigParam 12 holds one workchain, 0.
 */
const MAINNET: TonConfiguration = Object.freeze({
  globalVersion: 15,
  workchains: new Set([-1, 0]),
  maxMsgExtraCurrencies: 0,
  maxAccFixedPrefixLength: 8,
});
/**
 * Testnet's configuration (`tvm:-3`). Testnet's own values are not read: these are mainnet's, from `MAINNET`'s source,
 * since no offline source pinned by seqno holds testnet's ConfigParams 8, 12 and 43.
 */
const TESTNET: TonConfiguration = Object.freeze({
  globalVersion: 15,
  workchains: new Set([-1, 0]),
  maxMsgExtraCurrencies: 0,
  maxAccFixedPrefixLength: 8,
});
/** The two networks the pairing serves, by their `TvmNetwork`, each with the configuration its messages are read at. */
const CONFIGURATIONS: ReadonlyMap<string, TonConfiguration> = new Map([
  ["tvm:-239", MAINNET],
  ["tvm:-3", TESTNET],
]);
/**
 * The send modes the scheme admits for the request's one action, 1 (`PAY_FEES_SEPARATELY`) and 3 (with `IGNORE_ERRORS`)
 * (`scheme_exact_ton.md:170` at `x402-foundation/x402@88b66dd4`); x402's TON facilitator's codec admits the same two
 * (`@x402/tvm` 2.30.0 `src/exact/codec.ts:66-72`). TON's other modes include those that remove the sending account once
 * its balance reaches zero, and with it the sequence number the read rests on.
 */
const SCHEME_SEND_MODES: ReadonlySet<number> = new Set([1, 3]);
const COINS_LIMIT = 1n << 120n;
const UINT32_LIMIT = 2 ** 32;
const RAW_ADDRESS = /^-?[0-9]{1,10}:[0-9a-fA-F]{64}$/;
const SIGNATURE_BITS = 512;
/**
 * The fewest bits of a request W5 reads as signed: the op, wallet id, `valid_until` and seqno, then the signature
 * (wallet_v5.fc, `recv_internal`). W5 takes a shorter body as a plain transfer and runs no request.
 */
const REQUEST_MIN_BITS = 32 + 32 + 32 + 32 + SIGNATURE_BITS;
const SEND_MODE = 3;
/**
 * The seconds a masterchain block's time must pass `validUntil` by before the read takes the request's validity as
 * passed at that block: a W5 transaction runs at its shard block's time, and a masterchain block references that shard
 * block only later, so the masterchain head can pass `validUntil` before an index holds a transaction that ran in time.
 */
export const TVM_EXPIRY_MARGIN = 60;
const EXPIRY_MARGIN = TVM_EXPIRY_MARGIN;

const utf8 = new TextEncoder();
/** A comment's text: strict UTF-8, a leading byte-order mark kept, so a comment that begins with one holds no hash. */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
 * The BoC of `lcpComment`'s cell for H, written without @ton/core as `bocOf` writes that cell: the generic magic with
 * the CRC32C flag, no index and one-byte references, a one-byte offset size, one cell, one root, none absent, the data
 * size, root 0; then the cell's two descriptor bytes (no references, ordinary, level 0; its byte count doubled, as its
 * 32 zero bits and the LCP string's 77 bytes fill whole bytes) and its data; then the CRC32C of every byte before it.
 */
function commentBoc(nh: AtrHash): Uint8Array {
  const text = utf8.encode(toLcpString(nh));
  const n = 4 + text.length;
  const b = new Uint8Array(13 + n + 4);
  b.set([0xb5, 0xee, 0x9c, 0x72, 0x41, 1, 1, 1, 0, 2 + n, 0, 0, 2 * n]);
  b.set(text, 17);
  const crc = crc32c(b.subarray(0, b.length - 4));
  b.set([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24], b.length - 4);
  return b;
}

/**
 * The one root of a base64 BoC of at most 8 KiB, at most 512 cells and depth 32, or the refusal: its bytes as `bagOf`
 * reads them, without @ton/core, then its cells as `rootIn` reads them, with it.
 */
function rootOf(boc: unknown): Cell | Refusal {
  const bag = bagOf(boc);
  return isRefusal(bag) ? bag : rootIn(bag);
}

/**
 * A base64 BoC's bytes, read without @ton/core: the base64, the 8 KiB bound, then the bag's layout and its CRC32C
 * (`layoutOf`). Bytes TON refuses there are `tvm/boc-malformed`, and more than 8 KiB `tvm/boc-too-large`, with
 * @ton/core and without it.
 */
function bagOf(boc: unknown): Bag | Refusal {
  const bytes = boc === "" ? null : fromBase64(boc);
  if (bytes === null) return refusal("tvm/boc-malformed");
  if (bytes.length > MAX_BOC_BYTES) return refusal("tvm/boc-too-large");
  return layoutOf(bytes) ?? refusal("tvm/boc-malformed");
}

/**
 * The bag's one root, its cells read as TON deserializes them (`cellsOf`), at most 512 cells and depth 32, or the
 * refusal: cells TON refuses are `tvm/boc-malformed`. An exotic cell TON accepts is refused only where a read parses it:
 * every parse here refuses one without throwing, and a cell no read parses, such as a state init's library code or a
 * Jetton transfer's custom payload, is left as it is. The cells are @ton/core's, so without it every bag is
 * `tvm/peer-missing`: this is the one step that decodes a BoC.
 */
function rootIn(bag: Bag): Cell | Refusal {
  if (peer === undefined) return refusal("tvm/peer-missing");
  const root = cellsOf(bag);
  if (root === null) return refusal("tvm/boc-malformed");
  if (root.depth() > MAX_DEPTH) return refusal("tvm/boc-too-large");
  if (cellCount(root) > MAX_CELLS) return refusal("tvm/boc-too-large");
  return root;
}

/** A bag of cells' bytes and layout, as `layoutOf` reads them: what `cellsOf` builds the cells from. */
interface Bag {
  readonly bytes: Uint8Array;
  readonly cells: number;
  readonly rootIdx: number;
  readonly refSize: number;
  /** Each cell's span in `data`. */
  readonly spans: readonly (readonly [number, number])[];
  /** Each cell's cache bit from the index, or null for a bag without cache bits. */
  readonly cached: readonly boolean[] | null;
  readonly data: Uint8Array;
}

/**
 * A bag of cells' layout as TON deserializes it (ton-blockchain/ton `crypto/vm/boc.cpp`, `std_boc_deserialize`), read
 * without @ton/core, or null where TON refuses the bytes:
 * - the header (`parse_serialized_header`): one of the three magics, cache bits only with an index, a reference size
 *   of 1 to 4 bytes and an offset size of 1 to 8, at least one cell, exactly one root, no more absent cells than
 *   cells, a data size within the cell count's bounds, and the bytes holding all of it;
 * - each cell's span: the cells fill the data, or each index entry bounds one cell with no unused space;
 * - with a CRC32C, the input's last four bytes are the CRC32C of every byte before them (`crc32c`).
 */
function layoutOf(b: Uint8Array): Bag | null {
  const at = (o: number, n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + b[o + i]!;
    return v;
  };
  if (b.length < 6) return null;
  const magic = at(0, 4);
  if (magic !== BOC_GENERIC && magic !== BOC_INDEXED && magic !== BOC_INDEXED_CRC32C) return null;
  const generic = magic === BOC_GENERIC;
  const flags = b[4]!;
  const indexed = !generic || (flags & 0x80) !== 0;
  const crc = generic ? (flags & 0x40) !== 0 : magic === BOC_INDEXED_CRC32C;
  const cacheBits = generic && (flags & 0x20) !== 0;
  const refSize = flags & 7;
  const offSize = b[5]!;
  if ((cacheBits && !indexed) || refSize < 1 || refSize > 4 || offSize < 1 || offSize > 8) return null;
  const rootsAt = 6 + 3 * refSize + offSize;
  if (b.length < rootsAt) return null;
  // TON reads the three counts into an int, so a count of 2^31 or more is negative there.
  const cells = at(6, refSize);
  const roots = at(6 + refSize, refSize);
  const absent = at(6 + 2 * refSize, refSize);
  const dataSize = at(6 + 3 * refSize, offSize);
  if (cells < 1 || cells >= 2 ** 31 || roots !== 1 || absent > cells) return null;
  if (dataSize > cells * 1024 || dataSize < cells * (2 + refSize) - refSize) return null;
  const indexAt = rootsAt + (generic ? refSize : 0);
  const dataAt = indexAt + (indexed ? cells * offSize : 0);
  if (dataAt + dataSize + (crc ? 4 : 0) > b.length) return null;
  const rootIdx = generic ? at(rootsAt, refSize) : 0;
  if (rootIdx >= cells) return null;
  const data = b.subarray(dataAt, dataAt + dataSize);
  const spans: [number, number][] = [];
  const cached: boolean[] | null = cacheBits ? [] : null;
  if (indexed) {
    let start = 0;
    for (let i = 0; i < cells; i++) {
      const raw = at(indexAt + i * offSize, offSize);
      const end = cacheBits ? Math.floor(raw / 2) : raw;
      if (start > end || end > dataSize) return null;
      spans.push([start, end]);
      cached?.push(raw % 2 === 1);
      start = end;
    }
  } else {
    let start = 0;
    for (let i = 0; i < cells; i++) {
      if (data.length - start < 2) return null;
      const d1 = data[start]!;
      const d2 = data[start + 1]!;
      if ((d1 & 7) > 4) return null;
      const size = cellSize(d1, d2, refSize);
      if (data.length - start < size) return null;
      spans.push([start, start + size]);
      start += size;
    }
    if (start !== dataSize) return null;
  }
  if (crc && crc32c(b.subarray(0, b.length - 4)) !== littleEndian32(b, b.length - 4)) return null;
  return { bytes: b, cells, rootIdx, refSize, spans, cached, data };
}

/** Four bytes at `o`, least significant first, as an unsigned 32-bit number. */
function littleEndian32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/**
 * The one root of a bag `layoutOf` read, its cells built as TON deserializes them, or null where TON refuses them:
 * - each cell's bytes (`deserialize`, `deserialize_cell`): at most four references, each to a later cell, its bytes
 *   read exactly, a partial last data byte holding a data bit before its completion tag, and with cache bits, each
 *   cell's flag set exactly when two or more references (the root's counted) name it;
 * - each cell as TON creates it (`crypto/vm/cells/DataCell.cpp`, `CellChecker`, and `create_data_cell`): at most 1,023
 *   bits; an exotic cell of type 1 to 4 with its exact bits and references (a pruned branch none, a library cell none,
 *   a Merkle proof one, a Merkle update two, each Merkle child's level-0 hash and depth as the cell stores them); a
 *   depth of at most 1,024 at every level; the level mask its first byte gives equal to the one computed; and where it
 *   stores hashes and depths, each one equal to the computed one;
 * - the root's level 0.
 *
 * The cells are @ton/core's: `rootIn` calls this only with it.
 */
function cellsOf(bag: Bag): Cell | null {
  const { cells, rootIdx, refSize, spans, cached, data } = bag;
  const built: Cell[] = new Array<Cell>(cells);
  const named = new Uint8Array(cells);
  named[rootIdx] = 1;
  try {
    for (let i = cells - 1; i >= 0; i--) {
      const [start, end] = spans[i]!;
      const s = data.subarray(start, end);
      if (s.length < 2) return null;
      const d1 = s[0]!;
      const d2 = s[1]!;
      const refCount = d1 & 7;
      if (refCount > 4 || cellSize(d1, d2, refSize) !== s.length) return null;
      const mask = d1 >> 5;
      const stored = (d1 & 16) === 0 ? 0 : popcount(mask) + 1;
      const bytesAt = 2 + stored * 34;
      const bytes = (d2 >> 1) + (d2 & 1);
      const refsAt = bytesAt + bytes;
      const refs: Cell[] = [];
      for (let k = 0; k < refCount; k++) {
        let r = 0;
        for (let j = 0; j < refSize; j++) r = r * 256 + s[refsAt + k * refSize + j]!;
        if (r <= i || r >= cells) return null;
        refs.push(built[r]!);
        if (named[r]! < 2) named[r]!++;
      }
      let bits = bytes * 8;
      if ((d2 & 1) === 1) {
        const last = s[refsAt - 1]!;
        if ((last & 0x7f) === 0) return null;
        bits -= 1 + (31 - Math.clz32(last & -last));
      }
      const c = cellFrom((d1 & 8) !== 0, s.subarray(bytesAt, refsAt), bits, refs);
      if (c === null || c.mask.value !== mask) return null;
      for (let level = 0; level <= 3; level++) if (c.depth(level) > CELL_MAX_DEPTH) return null;
      if (stored > 0) {
        const hashAt = (k: number) => Buffer.from(s.subarray(2 + k * 32, 2 + k * 32 + 32));
        const depthAt = (k: number) => s[2 + stored * 32 + k * 2]! * 256 + s[3 + stored * 32 + k * 2]!;
        if (!hashAt(stored - 1).equals(c.hash()) || depthAt(stored - 1) !== c.depth()) return null;
        for (let level = 0, k = 0; level < c.level(); level++) {
          if (level !== 0 && ((mask >> (level - 1)) & 1) === 0) continue;
          if (!hashAt(k).equals(c.hash(level)) || depthAt(k) !== c.depth(level)) return null;
          k++;
        }
      }
      built[i] = c;
    }
  } catch {
    return null;
  }
  if (cached !== null) {
    for (let i = 0; i < cells; i++) if ((named[i]! > 1) !== cached[i]) return null;
  }
  const root = built[rootIdx]!;
  return root.level() === 0 ? root : null;
}

/** A serialized cell's byte length from its two descriptor bytes (`CellSerializationInfo::init`). */
function cellSize(d1: number, d2: number, refSize: number): number {
  const stored = (d1 & 16) === 0 ? 0 : popcount(d1 >> 5) + 1;
  return 2 + stored * 34 + (d2 >> 1) + (d2 & 1) + (d1 & 7) * refSize;
}

function popcount(n: number): number {
  let k = 0;
  for (let m = n; m !== 0; m &= m - 1) k++;
  return k;
}

/**
 * A cell from its data bits and its references as TON's `CellChecker` creates it, or null. An ordinary cell has at
 * most 1,023 bits. An exotic cell's first byte is its type: a pruned branch (1, `prunedBranch`), a library cell (2:
 * 264 bits, no references), a Merkle proof (3: 280 bits, one reference) or a Merkle update (4: 552 bits, two
 * references), where the cell stores each child's level-0 hash and depth; any other type is refused.
 */
function cellFrom(exotic: boolean, data: Uint8Array, bits: number, refs: Cell[]): Cell | null {
  const T = peer!;
  if (bits > 1023) return null;
  const cellBits = new T.BitString(Buffer.from(data), 0, bits);
  if (!exotic) return new T.Cell({ bits: cellBits, refs });
  if (bits < 8) return null;
  const type = data[0]!;
  if (type === 1) return prunedBranch(data, bits);
  const children = type === 2 ? 0 : type === 3 ? 1 : type === 4 ? 2 : -1;
  if (children < 0 || refs.length !== children || bits !== (type === 2 ? 264 : 8 + children * 272)) return null;
  for (let k = 0; k < children; k++) {
    const hash = Buffer.from(data.subarray(1 + k * 32, 33 + k * 32));
    const depth = data[1 + children * 32 + k * 2]! * 256 + data[2 + children * 32 + k * 2]!;
    if (!hash.equals(refs[k]!.hash(0)) || depth !== refs[k]!.depth(0)) return null;
  }
  return new T.Cell({ exotic: true, bits: cellBits, refs });
}

/**
 * A pruned branch as TON's `CellChecker` reads one (`check_pruned_branch`, `compute_hash`): no references, a level mask
 * from 1 to 7 in its second byte, then one stored hash and one stored depth for each bit the mask sets, and nothing
 * else. Its hash and depth at level i are the stored ones of the lowest set bit at or above i; above every set bit,
 * its own representation hash and depth 0. `@ton/core` reads only masks whose set bits run up from the lowest, so this
 * cell is made from its class's prototype with TON's hashes and depths, and `@ton/core` hashes each parent of it from
 * those as it hashes any child.
 */
function prunedBranch(data: Uint8Array, bits: number): Cell | null {
  const T = peer!;
  if (bits < 16) return null;
  const mask = data[1]!;
  if (mask < 1 || mask > 7) return null;
  const count = popcount(mask);
  if (bits !== (2 + count * 34) * 8) return null;
  const bytes = Buffer.from(data.subarray(0, bits / 8));
  const own = Buffer.from(sha256(Buffer.concat([Buffer.from([8 + (mask << 5), bits / 4]), bytes])));
  const hashes: Buffer[] = [];
  const depths: number[] = [];
  for (let level = 0; level <= 3; level++) {
    let j = level;
    while (j < 3 && ((mask >> j) & 1) === 0) j++;
    if (j === 3) {
      hashes.push(own);
      depths.push(0);
      continue;
    }
    const k = popcount(mask & ((1 << j) - 1));
    hashes.push(bytes.subarray(2 + k * 32, 34 + k * 32));
    depths.push(bytes[2 + count * 32 + k * 2]! * 256 + bytes[3 + count * 32 + k * 2]!);
  }
  const LevelMask = T.Cell.EMPTY.mask.constructor as unknown as new (mask: number) => Cell["mask"];
  const levelMask = new LevelMask(mask);
  const cellBits = new T.BitString(bytes, 0, bits);
  Object.freeze(levelMask);
  Object.freeze(cellBits);
  const cell = Object.create(T.Cell.prototype) as Cell;
  Object.defineProperties(cell, {
    type: { value: T.CellType.PrunedBranch, enumerable: true },
    bits: { value: cellBits, enumerable: true },
    refs: { value: Object.freeze([]), enumerable: true },
    mask: { value: levelMask, enumerable: true },
    beginParse: {
      value: (allowExotic = false) => {
        if (!allowExotic) throw new Error("Exotic cells cannot be parsed");
        return new T.Slice(new T.BitReader(cellBits), []);
      },
    },
    hash: { value: (level = 3) => hashes[Math.min(level, 3)]! },
    depth: { value: (level = 3) => depths[Math.min(level, 3)]! },
    level: { value: () => levelMask.level },
    equals: { value: (other: Cell) => cell.hash().equals(other.hash()) },
  });
  Object.freeze(cell);
  return cell;
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
function jettonTransfer(body: Cell): {
  queryId: bigint;
  amount: bigint;
  destination: Address;
  responseDestination: Address | null;
  customPayload: Cell | null;
  forwardTonAmount: bigint;
  payload: Cell | null;
} | Refusal {
  try {
    const s = body.beginParse();
    if (s.remainingBits < 32 || s.loadUint(32) !== OP.jettonTransfer) return refusal("tvm/not-jetton-transfer");
    const queryId = s.loadUintBig(64);
    const amount = s.loadCoins();
    const destination = s.loadAddress();
    const responseDestination = s.loadMaybeAddress();
    const customPayload = s.loadMaybeRef();
    const forwardTonAmount = s.loadCoins();
    return { queryId, amount, destination, responseDestination, customPayload, forwardTonAmount, payload: s.loadBit() ? s.loadRef() : null };
  } catch {
    return refusal("tvm/not-jetton-transfer");
  }
}

/**
 * A message as TON's action phase sends it at the network's configuration (ton-blockchain/ton
 * `crypto/block/transaction.cpp`: the action list's `t_OutListNode.validate_ref`, then `try_action_send_msg`), or null
 * where TON refuses to send it. The cell is TL-B's `MessageRelaxed Any` with `int_msg_info$0`, read to its end, every
 * field by this reader and none by a library's:
 * - `src` is `addr_none` or the sender's own address (`check_replace_src_addr`): `from` when the sender is known, else
 *   an `addr_std` with no anycast on a workchain the configuration holds. The settlement message's sender is the
 *   account that relays it, which the bytes do not name: a source naming another account is read, and TON sends it
 *   when that account relays it;
 * - `dest` is an address TON sends to (`check_rewrite_dest_addr`): an `addr_std` with no anycast, or an `addr_var` of
 *   256 bits with no anycast, which TON sends as that `addr_std`, on a workchain the configuration holds. The answer's
 *   `dest` is that `addr_std`, raw;
 * - the value's Grams is a `VarUInteger 16` in its shortest form (`VarUInteger::validate_skip`: no length whose first
 *   byte is zero), the extra currencies are a valid `HashmapE 32 (VarUIntegerPos 32)` of at most the configuration's
 *   `maxMsgExtraCurrencies` entries, and from global version 12 `extra_flags` is a `VarUInteger 16` in its shortest
 *   form that sets no bit above its two low ones;
 * - the init, when present, is a `^StateInit`, or a `StateInit` inline, taken as the cell its fields make, either of
 *   them one `isStateInit` holds;
 * - the body is the remainder, or a reference to an ordinary cell with nothing after it (TL-B validation reads the
 *   referenced cell, `TLB::validate_ref_internal`);
 * - the action list's validation reads at most 1,024 cells: its node, the message, each extra-currency dictionary
 *   cell on each path, a `^StateInit` and a referenced body;
 * - at most `MAX_MERKLE_DEPTH` Merkle proofs and updates nest under the init and the body.
 */
function messageOf(
  c: Cell,
  from: string | null,
  config: TonConfiguration,
): { dest: string; body: Cell; init: Cell | null; bounce: boolean; value: bigint; extra: Cell | null } | null {
  const T = peer!;
  if (c.isExotic) return null;
  try {
    const s = c.beginParse();
    if (s.loadBit()) return null;
    s.skip(1);
    const bounce = s.loadBit();
    s.skip(1);
    const src = msgAddress(s, config);
    if (src.tag !== 0 && (src.tag !== 2 || src.raw === null || (from !== null && src.raw !== from))) return null;
    const dest = msgAddress(s, config);
    if (dest.tag < 2 || dest.raw === null) return null;
    const value = varUInteger(s, 4);
    if (value === null) return null;
    const extra = s.loadMaybeRef();
    const flags = varUInteger(s, 4);
    if (config.globalVersion >= 12 && (flags === null || flags > 3n)) return null;
    s.loadCoins();
    s.skip(64 + 32);
    let init: Cell | null = null;
    let initRef = false;
    if (s.loadBit()) {
      initRef = s.loadBit();
      if (initRef) init = s.loadRef();
      else {
        const at = s.clone();
        if (s.loadBit()) s.skip(5);
        if (s.loadBit()) s.skip(2);
        s.loadMaybeRef();
        s.loadMaybeRef();
        s.loadMaybeRef();
        const refs = at.remainingRefs - s.remainingRefs;
        const b = T.beginCell().storeBits(at.loadBits(at.remainingBits - s.remainingBits));
        for (let k = 0; k < refs; k++) b.storeRef(at.loadRef());
        init = b.endCell();
      }
      if (!isStateInit(init)) return null;
    }
    const bodyRef = s.loadBit();
    const body = bodyRef ? s.loadRef() : s.asCell();
    if (bodyRef && (body.isExotic || s.remainingBits !== 0 || s.remainingRefs !== 0)) return null;
    if (extra !== null) {
      let count = 0;
      const { hashmap } = validation(STATE_INIT_MAX_READS - 2 - (initRef ? 1 : 0) - (bodyRef ? 1 : 0));
      const currency = (v: Slice): boolean => {
        const amount = varUInteger(v, 5);
        count++;
        return amount !== null && amount > 0n;
      };
      if (!hashmap(extra, 32, currency) || count > config.maxMsgExtraCurrencies) return null;
    }
    if (merkleDepth([...(init === null ? [] : [init]), ...(bodyRef ? [body] : body.refs)]) > MAX_MERKLE_DEPTH) return null;
    return { dest: dest.raw, body, init, bounce, value, extra };
  } catch {
    return null;
  }
}

/**
 * A TL-B `MsgAddress` read from the slice (block.tlb: `addr_none$00`, `addr_extern$01`, `addr_std$10` and
 * `addr_var$11`, an anycast's `depth:(#<= 30) { depth >= 1 }`), with `raw` the `workchain:hex` it names when it has no
 * anycast, 256 bits and a workchain the configuration holds, else null. TON refuses an anycast address from global
 * version 10; a read past the slice's end throws.
 */
function msgAddress(s: Slice, config: TonConfiguration): { tag: number; raw: string | null } {
  const tag = s.loadUint(2);
  if (tag === 0) return { tag, raw: null };
  if (tag === 1) {
    s.skip(s.loadUint(9));
    return { tag, raw: null };
  }
  const anycast = s.loadBit();
  if (anycast) {
    const depth = s.loadUint(5);
    if (depth < 1 || depth > 30) throw new RangeError("anycast depth");
    s.skip(depth);
  }
  const length = tag === 2 ? 256 : s.loadUint(9);
  const workchain = tag === 2 ? s.loadInt(8) : s.loadInt(32);
  if (length !== 256) {
    s.skip(length);
    return { tag, raw: null };
  }
  const hash = s.loadBuffer(32).toString("hex");
  return { tag, raw: anycast || !config.workchains.has(workchain) ? null : `${workchain}:${hash}` };
}

/**
 * A TL-B `VarUInteger n` read from the slice, with a length of `lengthBits` bits, as TON validates one
 * (ton-blockchain/ton `crypto/block/block-parse.cpp`, `VarUInteger::validate_skip`): null when its length is not zero
 * and its first byte is, which is not the value's shortest form. A read past the slice's end throws.
 */
function varUInteger(s: Slice, lengthBits: number): bigint | null {
  const length = s.loadUint(lengthBits);
  if (length === 0) return 0n;
  const value = s.loadUintBig(length * 8);
  return value >> BigInt(length * 8 - 8) === 0n ? null : value;
}

/**
 * The most Merkle proofs and updates on any path down from these cells, each distinct cell read once
 * (ton-blockchain/ton `crypto/vm/boc.cpp`, `CellStorageStat::add_used_storage`).
 */
function merkleDepth(cells: readonly Cell[], memo = new Map<string, number>()): number {
  const T = peer!;
  let most = 0;
  for (const c of cells) {
    const k = c.hash().toString("hex");
    let d = memo.get(k);
    if (d === undefined) {
      d = merkleDepth(c.refs, memo) + (c.type === T.CellType.MerkleProof || c.type === T.CellType.MerkleUpdate ? 1 : 0);
      memo.set(k, d);
    }
    most = Math.max(most, d);
  }
  return most;
}

/**
 * Reads the signed request in a settlement BoC: an internal message whose body is a W5 `internal_signed` request with
 * exactly one `action_send_msg` behind an empty list, carrying a Jetton transfer whose forward payload is a reference
 * to a text comment holding an LCP string. The request is read as W5's `internal_signed` path reads it
 * (ton-blockchain/wallet-contract-v5 `contracts/wallet_v5.fc`, `recv_internal`, `process_signed_request` and
 * `process_actions`): at least 640 bits, its signature the body's last 512 bits, and the signed part the rest with all
 * its references, in which the wallet id, `valid_until`, seqno, the action list's `Maybe ^Cell` and
 * `has_other_actions` are read; W5 reads nothing after `has_other_actions` 0, and neither does this, so bits and
 * references there are carried, not read. A body W5 does not run as a signed request, or whose signed part ends before
 * those fields, is `tvm/not-w5-signed`, and an empty action list or `has_other_actions` 1 is `tvm/actions`. The
 * signature is not verified. The BoC's bytes are read as TON deserializes a bag of cells, and bytes TON
 * refuses are `tvm/boc-malformed`. `requestBodyHash` and `transferBodyHash` are the representation hashes TON gives,
 * for any cell TON reads, a pruned branch of any level mask included. Each message is read as TON's action phase sends
 * it, at the configuration lcp holds for `network`, as `bound` and `reference` read the payment of an option on that
 * network: a source of `addr_none` or an `addr_std` with no anycast (the outgoing message's the W5 wallet's own), a
 * destination TON sends to, a value and an `extra_flags` of at most 3 each in its shortest form, its state init
 * validated as TON validates it, a referenced body that is an ordinary cell with nothing after it, and at most two
 * nested Merkle proofs or updates; the W5 action's send mode is one TON sends with. The network is `tvm:-239` (mainnet)
 * or `tvm:-3` (testnet), and any other is `tvm/network-malformed`. The settlement message TON would not send is
 * `tvm/boc-malformed`, and the outgoing one `tvm/not-jetton-transfer`; a send mode other than 1 or 3, the two the
 * scheme admits, is `tvm/actions`. It also gives the request's sequence number, `signedHash`, the representation hash of
 * the request less its signature, which the wallet's key signs, and, where the message carries a state init, the
 * hash of its code. The
 * settlement message's source names the account that relays it, which the BoC cannot show: one naming another account
 * is read, and TON sends it when that account relays it. `wallet` and `jettonWallet` are the addresses TON sends to: an
 * `addr_var` of 256 bits names its `addr_std`. The network, the base64, the 8 KiB bound, the bag-of-cells layout and
 * its CRC32C need no peer: without @ton/core they give the codes they give with it, and a BoC that passes them is
 * `tvm/peer-missing`.
 */
export function tvmCarrier(settlementBoc: string, network: TvmNetwork): {
  h: AtrHash;
  transferBodyHash: Hex;
  jettonWallet: string;
  requestBodyHash: Hex;
  signedHash: Hex;
  wallet: string;
  validUntil: number;
  seqno: number;
  codeHash?: Hex;
  payload: TonCell;
} | Refusal {
  const config = CONFIGURATIONS.get(network);
  if (config === undefined) return refusal("tvm/network-malformed");
  const root = rootOf(settlementBoc);
  return isRefusal(root) ? root : carrierIn(root, config);
}

/** `tvmCarrier` of the settlement message's decoded root at the network's configuration, with the payload as the peer's cell. */
function carrierIn(root: Cell, config: TonConfiguration): {
  h: AtrHash;
  transferBodyHash: Hex;
  jettonWallet: string;
  requestBodyHash: Hex;
  signedHash: Hex;
  wallet: string;
  validUntil: number;
  seqno: number;
  codeHash?: Hex;
  payload: Cell;
} | Refusal {
  const message = messageOf(root, null, config);
  if (message === null) return refusal("tvm/boc-malformed");

  let signed: Cell;
  let signedHash: Hex;
  try {
    const body = message.body;
    const op = body.beginParse();
    if (op.remainingBits < 32 || op.loadUint(32) !== OP.internalSigned || body.bits.length < REQUEST_MIN_BITS) {
      return refusal("tvm/not-w5-signed");
    }
    const signedPart = peer!.beginCell().storeBits(body.bits.substring(0, body.bits.length - SIGNATURE_BITS));
    for (const r of body.refs) signedPart.storeRef(r);
    signed = signedPart.endCell();
    signedHash = `0x${signed.hash().toString("hex")}`;
  } catch {
    return refusal("tvm/not-w5-signed");
  }
  const r = requestIn(signed, message.dest, config);
  if (isRefusal(r)) return r;
  return {
    h: r.h,
    transferBodyHash: `0x${r.out.body.hash().toString("hex")}`,
    jettonWallet: r.out.dest,
    requestBodyHash: `0x${message.body.hash().toString("hex")}`,
    signedHash,
    wallet: message.dest,
    validUntil: r.validUntil,
    seqno: r.seqno,
    ...codeOf(message.init),
    payload: r.transfer.payload,
  };
}

/**
 * A W5 request less its signature, read as `carrierIn` reads the signed part of a settlement message's body, its
 * outgoing message read as one the account `from` sends, where `from` is known.
 */
function requestIn(signed: Cell, from: string | null, config: TonConfiguration): {
  h: AtrHash;
  walletId: number;
  validUntil: number;
  seqno: number;
  mode: number;
  out: NonNullable<ReturnType<typeof messageOf>>;
  transfer: Exclude<ReturnType<typeof jettonTransfer>, Refusal> & { payload: Cell };
} | Refusal {
  let walletId: number;
  let validUntil: number;
  let seqno: number;
  let actions: Cell;
  try {
    const s = signed.beginParse().skip(32);
    walletId = s.loadUint(32);
    validUntil = s.loadUint(32);
    seqno = s.loadUint(32);
    const list = s.loadMaybeRef();
    const hasOtherActions = s.loadBit();
    if (list === null || hasOtherActions) return refusal("tvm/actions");
    actions = list;
  } catch {
    return refusal("tvm/not-w5-signed");
  }

  const send = sendMessage(actions);
  if (isRefusal(send)) return send;
  if (!SCHEME_SEND_MODES.has(send.mode)) return refusal("tvm/actions");
  const out = messageOf(send.message, from, config);
  if (out === null) return refusal("tvm/not-jetton-transfer");
  // The scheme's message to the Jetton wallet is bounceable; the stock codec refuses one that is not as it refuses a
  // wrong mode (`@x402/tvm` 2.30.0 `src/exact/codec.ts:61`).
  if (!out.bounce) return refusal("tvm/actions");
  const transfer = jettonTransfer(out.body);
  if (isRefusal(transfer)) return transfer;
  if (transfer.payload === null) return refusal("tvm/payload-not-lcp");
  const h = commentHash(transfer.payload);
  if (h === null) return refusal("tvm/payload-not-lcp");
  return { h, walletId, validUntil, seqno, mode: send.mode, out, transfer: { ...transfer, payload: transfer.payload } };
}

/**
 * Reads the W5 request a `ton-w5` request carries, `signedBoc`, as `tvmCarrier` reads the signed part of a settlement
 * message's body at the network's configuration, with its codes, and gives `hash`, the root cell's representation hash,
 * which is the request's `hash` when the text is its `signedBoc`. The root must be an ordinary cell whose op is
 * `internal_signed`, or it is `tvm/not-w5-signed`. It gives every member W5 reads: the wallet id, `validUntil`, the
 * sequence number and the one action's send mode; and of the one message that action sends, its destination
 * (`jettonWallet`), the nanotons it attaches, each extra currency it attaches by its id, and its state init, where it
 * carries one, as a base64 bag of cells; and of the Jetton `transfer` it carries, the query id, `amount`, the
 * destination (`payTo`), the response destination or null for `addr_none`, the custom payload where it carries one, as
 * a base64 bag of cells, the forward TON amount and the hash the forward payload's comment holds. Addresses are raw. A
 * request holds one action, sending one Jetton `transfer`, or it is refused, so nothing else runs under the signature;
 * W5 reads nothing after `has_other_actions`, and neither does this. The request names no wallet, so the message's
 * source is read as the settlement message's sender is, by its form alone.
 */
export function tvmRequest(signedBoc: string, network: TvmNetwork): {
  hash: Uint8Array<ArrayBuffer>;
  walletId: number;
  validUntil: number;
  seqno: number;
  mode: number;
  jettonWallet: string;
  attachNanotons: bigint;
  extraCurrencies: { id: number; amount: bigint }[];
  stateInit?: string;
  queryId: bigint;
  amount: string;
  payTo: string;
  responseDestination: string | null;
  customPayload?: string;
  forwardTonAmount: string;
  h: AtrHash;
} | Refusal {
  const config = CONFIGURATIONS.get(network);
  if (config === undefined) return refusal("tvm/network-malformed");
  const root = rootOf(signedBoc);
  if (isRefusal(root)) return root;
  if (root.isExotic || root.bits.length < 32 || root.beginParse().loadUint(32) !== OP.internalSigned) {
    return refusal("tvm/not-w5-signed");
  }
  const r = requestIn(root, null, config);
  if (isRefusal(r)) return r;
  const T = peer!;
  const t = r.transfer;
  let extraCurrencies: { id: number; amount: bigint }[] = [];
  if (r.out.extra !== null) {
    try {
      const d = T.Dictionary.loadDirect(T.Dictionary.Keys.Uint(32), T.Dictionary.Values.BigVarUint(5), r.out.extra);
      extraCurrencies = d.keys().map((id) => ({ id, amount: d.get(id)! }));
    } catch {
      return refusal("tvm/not-jetton-transfer");
    }
  }
  return {
    hash: Uint8Array.from(root.hash()),
    walletId: r.walletId,
    validUntil: r.validUntil,
    seqno: r.seqno,
    mode: r.mode,
    jettonWallet: r.out.dest,
    attachNanotons: r.out.value,
    extraCurrencies,
    ...(r.out.init === null ? {} : { stateInit: bocOf(r.out.init) }),
    queryId: t.queryId,
    amount: t.amount.toString(),
    payTo: t.destination.toRawString(),
    responseDestination: t.responseDestination === null ? null : t.responseDestination.toRawString(),
    ...(t.customPayload === null ? {} : { customPayload: bocOf(t.customPayload) }),
    forwardTonAmount: t.forwardTonAmount.toString(),
    h: r.h,
  };
}

/** The representation hash of the code a state init holds, where it holds one, as `codeHash`. */
function codeOf(init: Cell | null): { codeHash?: Hex } {
  if (init === null) return {};
  const s = init.beginParse();
  if (s.loadBit()) s.skip(5);
  if (s.loadBit()) s.skip(2);
  const code = s.loadMaybeRef();
  return code === null ? {} : { codeHash: `0x${code.hash().toString("hex")}` };
}

/**
 * The send mode and outgoing message of an action list holding exactly one `action_send_msg` behind an empty `prev`
 * (`action_send_msg#0ec3c86d mode:(## 8) out_msg:^(MessageRelaxed Any)`).
 */
function sendMessage(actions: Cell): { mode: number; message: Cell } | Refusal {
  if (actions.isExotic) return refusal("tvm/boc-malformed");
  if (actions.bits.length !== 40 || actions.refs.length !== 2) return refusal("tvm/actions");
  const prev = actions.refs[0]!;
  if (prev.bits.length !== 0 || prev.refs.length !== 0) return refusal("tvm/actions");
  const s = actions.beginParse();
  if (s.loadUint(32) !== OP.sendMsg) return refusal("tvm/actions");
  return { mode: s.loadUint(8), message: actions.refs[1]! };
}


// ── Settlement.

/** W5R1's code hash, the one entry of the scheme's list of wallets (`scheme_exact_ton.md:166` at `x402-foundation/x402@88b66dd4`). */
export const W5R1_CODE_HASH = "0x20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f";
/** W5's `external_signed` op: a request its owner sends as an external message, laid out and signed as `internal_signed` is. */
const EXTERNAL_SIGNED = 0x7369676e;
/** W5's `extn` op: an installed extension's actions, which the wallet runs with no signature and no sequence number. */
const EXTENSION_ACTION = 0x6578746e;
/** TEP-74's text comment op. */
const TEXT_COMMENT = 0;

/**
 * Answers the read of the request as the profile `read-status` gives it, from the facts the profile `x402-exact-tvm`
 * (rule 6) names, with `presented` on `settled`. The read takes, from one TON Center v3 index: the latest head's time;
 * the index's statement of the masterchain blocks it holds; the W5 wallet's transactions with the request's body; the
 * wallet's state; and, for a W5 wallet, its transactions from the latest back, each by its predecessor, to the first at
 * or before the position given (the expiry read, which is the search for H). Every run of the wallet whose Jetton
 * `transfer` carries H is followed to the payer's Jetton wallet and from its `internal_transfer` to the Jetton wallet
 * that took it, and tested by the two party tests: the W5 wallet is not the option's payee, on either act; and, on the
 * act `payment`, the delivering account is the payee's Jetton wallet of the payer's Jetton wallet's master, read by
 * `get_wallet_address` for `payTo` through the reader. Positions are masterchain block sequence numbers. The single-use
 * value is the signed sequence number: consumed where a listed run is at it, where the active wallet's number is above
 * it, or where a listed transaction removed or deployed the account; lapsed where the latest head is more than 60
 * seconds past `validUntil`, and read at the final mark only where the stated finalized block is too. The search is
 * read whole only through a reader that declares `listsWhole`. A wallet that is not W5 gets no expiry read: its value
 * is not read, and the body-hash lookup is its search, read whole where the stated block is at or past the latest head.
 * The read decodes the cells it reads itself, without @ton/core, and compares raw addresses itself, so every answer is
 * the same with it and without it. A ref, a reader or a query that is not one, or a ref whose hashes are not `0x` and
 * 64 hex digits, is unreadable `unparseable`, with nothing read; a reader for another network than the ref's is
 * `chain-mismatch`; a rejected read is `transport`, or `too-large` or `unparseable` for a `ReaderError` of that kind;
 * an answer out of the reader's form is `unparseable`. A frozen account, its code removed, runs no request until a
 * message restores the state its hash fixes, its number among it, so it reads as `uninit` and `nonexist` do: the number
 * not passed.
 */
export async function tvmStatus(ref: TvmRef, reader: TvmReader, query: StatusQuery<TvmRef, bigint, TvmMark, TvmSearch>): Promise<TvmStatus> {
  if (!isQuery(query, MARKS, isPosition) || (query.search !== undefined && !isSearch(query.search))) return UNPARSEABLE;
  return decide(await readTvm(ref, reader, query), query, LEDGER);
}

const LT = /^(?:0|[1-9][0-9]{0,19})$/;
const isSearchLink = (v: unknown): v is TonLink =>
  isObject(v) && typeof v["hash"] === "string" && v["hash"] !== "" && typeof v["lt"] === "string" && LT.test(v["lt"]);
function isSearch(v: unknown): v is TvmSearch {
  return isObject(v) && isSearchLink(v["top"]) && isSearchLink(v["next"]);
}
const linkOf = (t: { hash: string; lt?: string }): TonLink => ({ hash: t.hash, lt: t.lt ?? "" });
const sameLink = (a: { hash: string; lt?: string }, b: TonLink): boolean => a.hash === b.hash && a.lt === b.lt;

const LEDGER = ledgerOf<bigint, TvmMark>(TVM[ID].coverage, MARKS, bigintOrder);

function isPosition(p: unknown): p is bigint {
  return typeof p === "bigint" && p >= 0n;
}

type Presented = "yes" | "no" | "unshown";
type TvmSeen = Seen<bigint, TvmMark>;

/** A read that established nothing, with its reason. */
class Unread {
  constructor(readonly reason: UnreadableReason) {}
}

/**
 * The reason a rejected read gives: a `ReaderError` of kind `too-large` is `too-large`, one of kind `malformed`
 * `unparseable`, and any other rejection, a timeout among them, `transport`.
 */
function rejectedAs(e: unknown): UnreadableReason {
  if (typeof e !== "object" || e === null || (e as { name?: unknown }).name !== "ReaderError") return "transport";
  const kind = (e as { kind?: unknown }).kind;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/** One reader call: its answer where it is in the reader's form, else `unparseable`; a rejection by `rejectedAs`. */
async function call<T>(f: () => Promise<unknown>, valid: (v: unknown) => v is T): Promise<T> {
  let v: unknown;
  try {
    v = await f();
  } catch (e) {
    throw new Unread(rejectedAs(e));
  }
  if (!valid(v)) throw new Unread("unparseable");
  return v;
}

function isRef(ref: unknown): ref is TvmRef {
  if (!isObject(ref)) return false;
  return (
    typeof ref["network"] === "string" &&
    normalHash(ref["h"]) !== null &&
    normalHash(ref["requestBodyHash"]) !== null &&
    normalHash(ref["signedHash"]) !== null &&
    rawKey(ref["jettonWallet"]) !== null &&
    rawKey(ref["wallet"]) !== null &&
    rawKey(ref["payee"]) !== null &&
    isUint32(ref["validUntil"]) &&
    isUint32(ref["seqno"]) &&
    (ref["codeHash"] === undefined || normalHash(ref["codeHash"]) !== null)
  );
}

async function readTvm(
  ref: TvmRef,
  reader: TvmReader,
  query: StatusQuery<TvmRef, bigint, TvmMark, TvmSearch>,
): Promise<Facts<bigint, TvmMark, TvmSearch>> {
  const nothing = (reason: UnreadableReason): Facts<bigint, TvmMark, TvmSearch> => ({ unreadable: reason, seen: [], search: { whole: false }, history: false });
  if (!isRef(ref) || !isObject(reader) || typeof reader.network !== "string") return nothing("unparseable");
  if (reader.network !== ref.network) return nothing("chain-mismatch");
  try {
    return await factsOf(ref, reader, query);
  } catch (e) {
    if (e instanceof Unread) return nothing(e.reason);
    throw e;
  }
}

async function factsOf(
  ref: TvmRef,
  reader: TvmReader,
  query: StatusQuery<TvmRef, bigint, TvmMark, TvmSearch>,
): Promise<Facts<bigint, TvmMark, TvmSearch>> {
  const h = normalHash(ref.h)!;
  const request = normalHash(ref.requestBodyHash)!;
  // The members of the payment presented: the request the payer signed, its signature apart.
  const signedHash = normalHash(ref.signedHash);
  const head = await call(() => reader.headUtime(), isSafeInteger);
  const stated = await call(() => reader.indexed(), isIndexed);
  const own = (await call(() => reader.byInBody(request), isTxList)).filter((t) => sameAccount(t.account, ref.wallet));
  const state = await call(() => reader.walletState(ref.wallet), isWalletState);
  const w5 = isW5(state, ref);
  const listing: Listing = w5 ? await walk(reader, ref, state, query.after, query.search) : { listed: [], end: true, newer: 0 };

  const seen: TvmSeen[] = [];
  let held = !listing.end;
  /** Where the list resumes: the place in it of the first transaction read again, in the walk's order. */
  const placeOf = new Map(listing.listed.map((t, i) => [t.hash, i]));
  let resumeAt = listing.end ? Infinity : listing.listed.length;
  const holdAt = (i: number): void => {
    if (i < resumeAt) resumeAt = i;
  };
  /** A transaction the read must read again: a listed one holds the list there; one the lookup found holds no place. */
  const hold = (t: TonTx): void => {
    held = true;
    const i = placeOf.get(t.hash);
    if (i !== undefined) holdAt(i);
  };
  const undecodedAt: { transaction: string; place?: number }[] = [];
  /** An item the search met and could not decode: named, never a failure of the read. */
  const undecodable = (t: TonTx): void => {
    const i = placeOf.get(t.hash);
    undecodedAt.push({ transaction: t.hash, ...(i === undefined ? {} : { place: i }) });
  };
  const signer = rawKey(ref.wallet)!;
  const party: TvmSeen["party"] = sameAccount(ref.wallet, ref.payee) ? "payee" : "payer";
  const givenRefs = (query.others ?? []).flatMap((o) => ("ref" in o && isObject(o.ref) ? [o.ref] : []));
  const givenBy = (body: Hex | null, signed: Hex | null): boolean =>
    givenRefs.some(
      (g) => (body !== null && normalHash(g.requestBodyHash) === body) || (signed !== null && normalHash(g.signedHash) === signed),
    );
  const positionOf = (t: TonTx): { position?: bigint } => (t.mcSeqno === undefined || t.mcSeqno === null ? {} : { position: t.mcSeqno });
  const row = (
    t: TonTx,
    of: {
      result: "succeeded" | "failed";
      consumed: boolean;
      carries: boolean;
      party: TvmSeen["party"];
      kind: TvmSeen["kind"];
      given: boolean;
      signer: string;
      presented: Presented;
    },
    mark: TvmMark,
  ): TvmSeen => ({ transaction: t.hash, ...positionOf(t), mark, account: "none", ...of });

  /**
   * Follows each of a run's Jetton `transfer` messages carrying H to the payer's Jetton wallet and from its
   * `internal_transfer` to its taker. The run succeeded where every one was delivered; it names the payee's account
   * where one of them reached the payee's Jetton wallet of its master.
   */
  const follow = async (
    t: TonTx,
    msgs: readonly TonOutMsg[],
    of: { consumed: boolean; party: TvmSeen["party"]; given: boolean; signer: string; presented: Presented },
  ): Promise<void> => {
    const moved: Moved[] = [];
    const txs: TonTx[] = [t];
    let account: TvmSeen["account"] = query.act === "payment" ? "other" : "none";
    let failure = false;
    for (const msg of msgs) {
      const taken = (await call(() => reader.byInMessage(msg.hash), isTxList))[0];
      if (taken === undefined) return hold(t);
      txs.push(taken);
      const internal = taken.outMsgs.find((m) => m.opcode === OP.internalTransfer);
      if (taken.aborted || internal === undefined) {
        failure = true;
        continue;
      }
      const delivered = (await call(() => reader.byInMessage(internal.hash), isTxList))[0];
      if (delivered === undefined) return hold(t);
      txs.push(delivered);
      if (delivered.aborted) {
        failure = true;
        continue;
      }
      const amount = delivered.inBody === null ? null : internalAmount(delivered.inBody);
      if (amount === null) return undecodable(t);
      const master = await call(() => reader.jettonMaster(taken.account), isRawAddress);
      if (query.act === "payment") {
        const payeeWallet = await call(() => reader.jettonWallet(master, ref.payee), isRawAddress);
        if (sameAccount(delivered.account, payeeWallet)) account = "payee";
      }
      moved.push({ asset: rawKey(master)!, amount, to: rawKey(delivered.account)!, transaction: t.hash, place: msg.hash });
    }
    const mark = markOf(lowest(txs));
    if (mark === undefined) return hold(t);
    if (failure) {
      // A failed result moved nothing: the account it names is the destination of the transfer the payer signed.
      const named = msgs.map((m) => (m.body === undefined || m.body === null ? null : liteOf(m.body))).map((b) => (b === null ? null : jettonDestination(b)));
      const failedAccount: TvmSeen["account"] =
        query.act !== "payment" || named.every((d) => d === null) ? "none" : named.some((d) => d !== null && sameAccount(d, ref.payee)) ? "payee" : "other";
      seen.push({ ...row(t, { result: "failed", carries: true, kind: "same", ...of }, mark), account: failedAccount, moved: [] });
      return;
    }
    seen.push({
      ...row(t, { result: "succeeded", carries: true, kind: "same", ...of }, mark),
      account,
      moved,
    });
  };

  const ownHashes = new Set(own.map((t) => t.hash));
  // Oldest first, so that of two acts that meet every test the earlier is the one answered.
  const order = (t: TonTx): bigint => (t.mcSeqno === undefined || t.mcSeqno === null ? 1n << 64n : t.mcSeqno);
  const candidates = [...own, ...listing.listed.filter((t) => !ownHashes.has(t.hash))].sort((a, b) =>
    order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0,
  );
  let ran = false;
  /** Whether a run at the signed number lies at or below the stated finalized block. */
  let ranFinal = false;
  const ranAt = (t: TonTx): void => {
    ran = true;
    if (stated !== null && t.mcSeqno !== undefined && t.mcSeqno !== null && t.mcSeqno <= stated.last) ranFinal = true;
  };
  for (const t of candidates) {
    if (ownHashes.has(t.hash)) {
      // The request itself: found by its body hash, its signature included, at the signed number, so the one presented.
      const given = givenBy(request, signedHash);
      const of = { consumed: true, party, given, signer, presented: "yes" as const };
      if (t.aborted) {
        const mark = markOf(t.finality);
        if (mark === undefined) hold(t);
        else seen.push(row(t, { result: "failed", carries: true, kind: "same", ...of, consumed: false }, mark));
        continue;
      }
      const transfers = t.outMsgs.filter((m) => m.opcode === OP.jettonTransfer);
      if (transfers.length > 0) {
        ranAt(t);
        await follow(t, transfers, of);
        continue;
      }
      const changed = dataChanged(t);
      if (changed === undefined) hold(t);
      else if (changed) {
        // It ran and sent nothing: the number is consumed.
        ranAt(t);
        const mark = markOf(t.finality);
        if (mark === undefined) hold(t);
        else seen.push(row(t, { result: "failed", carries: true, kind: "same", ...of }, mark));
      }
      continue;
    }
    // A listed transaction of the wallet.
    if (t.aborted) continue;
    const body = t.inBody === null ? null : liteOf(t.inBody);
    if (t.inBody !== null && body === null) {
      undecodable(t);
      continue;
    }
    const op = body === null ? null : opOf(body);
    if (op === EXTENSION_ACTION) {
      const carrying = carrying_(t, h);
      if (carrying === "undecodable") undecodable(t);
      else if (carrying !== undefined) {
        const source = rawKey(t.inSource);
        if (source === null) hold(t);
        // An extension's action carries no request the payer signed, so it is not the one presented.
        else await follow(t, carrying, { consumed: false, party: sameAccount(source, ref.payee) ? "payee" : "other", given: false, signer: source, presented: "no" });
      }
      continue;
    }
    if (op !== OP.internalSigned && op !== EXTERNAL_SIGNED) continue;
    const req = requestOf(body!);
    if (req === null) {
      undecodable(t);
      continue;
    }
    const changed = dataChanged(t);
    if (changed === undefined) {
      hold(t);
      continue;
    }
    if (!changed) continue;
    const atNumber = req.seqno === ref.seqno;
    if (atNumber) ranAt(t);
    const bodyHash = liteHash(body!);
    const presented: Presented = req.signed === null ? "unshown" : req.signed === signedHash ? "yes" : "no";
    const of = { consumed: atNumber, party, given: givenBy(bodyHash === null ? null : (`0x${toHex(bodyHash.hash)}` as Hex), req.signed), signer, presented };
    const carrying = carrying_(t, h);
    if (carrying === "undecodable") {
      undecodable(t);
      continue;
    }
    if (carrying !== undefined) {
      await follow(t, carrying, of);
      continue;
    }
    const mark = markOf(t.finality);
    const comment = commented(t, h);
    if (comment === "undecodable") {
      undecodable(t);
      continue;
    }
    if ((comment !== undefined || atNumber) && mark === undefined) {
      hold(t);
      continue;
    }
    if (comment !== undefined) seen.push(row(t, { result: "succeeded", carries: true, kind: "other", ...of }, mark!));
    else if (atNumber) seen.push(row(t, { result: "succeeded", carries: false, kind: "same", ...of }, mark!));
  }

  const lapsed = head > ref.validUntil + EXPIRY_MARGIN;
  let value: Facts<bigint, TvmMark>["value"];
  let whole: boolean;
  if (w5) {
    // At the latest head: a run at the number, the active wallet's number above it, or the account removed or deployed.
    const above = state.status === "active" && state.seqno !== null && state.seqno > ref.seqno;
    const moved = listing.listed.some((t) => t.before!.status !== t.after!.status);
    // At the final mark: a run at the number at or below the stated block, or the number moved by a wallet whose last
    // transaction is at or below it.
    const last = listing.listed[0]?.mcSeqno ?? undefined;
    const settledBelow = stated !== null && (last === undefined || last <= stated.last);
    const final = stated !== null && (!lapsed || stated.utime > ref.validUntil + EXPIRY_MARGIN);
    // An active wallet whose state the index gives without its number is not read at the latest head, and holds the
    // search: a state missing a member is no state the read can decide on.
    const headRead = state.status !== "active" || state.seqno !== null;
    if (!headRead) held = true;
    value = {
      consumed: ranFinal || ((above || moved) && settledBelow),
      lapsed,
      mark: final ? "finalized" : "confirmed",
      ...(headRead ? { head: { consumed: ran || above || moved } } : {}),
    };
    // Until a run shows that the index lists whole (profile `x402-exact-tvm`, rule 6, *Not yet shown*), the expiry read
    // proves no absence and is never read whole, through any reader.
    whole = false;
  } else {
    whole = !held && stated !== null && stated.utime >= head;
  }
  const after = query.after;
  const history = stated !== null && (after !== undefined ? stated.first <= after : stated.first <= 1n);
  // The search position: the given one where a transaction listed above it holds the list, else the place of the first
  // transaction read again; none where the list was read to its end.
  const cursorAt = (i: number): TvmSearch | undefined => {
    if (i === Infinity) return undefined;
    if (listing.heldAbove === true || i < listing.newer) return query.search;
    const next = i < listing.listed.length ? linkOf(listing.listed[i]!) : listing.next;
    return next === undefined || state.last === null ? undefined : { top: linkOf(state.last), next };
  };
  const at = cursorAt(resumeAt);
  // In the order the list is read; an item the lookup found, which has no place in it, first.
  const undecoded = [...undecodedAt]
    .sort((a, b) => (a.place ?? -1) - (b.place ?? -1))
    .map((u) => {
      const c = u.place === undefined ? undefined : cursorAt(Math.min(u.place, resumeAt));
      return c === undefined ? { transaction: u.transaction } : { transaction: u.transaction, at: c };
    });
  return {
    seen,
    ...(value === undefined ? {} : { value }),
    search: at === undefined ? { whole } : { whole, at },
    ...(undecoded.length === 0 ? {} : { undecoded }),
    history,
  };
}

/**
 * A W5 wallet: its code hash, from its state, or, while it is `uninit`, `nonexist` or `frozen`, from its state where the
 * index gives one and else from the reference, is W5R1's.
 */
function isW5(state: TonWalletState, ref: TvmRef): boolean {
  const code = state.status === "active" ? state.codeHash : (state.codeHash ?? ref.codeHash);
  return code !== null && code !== undefined && normalHash(code) === W5R1_CODE_HASH;
}

/**
 * The wallet's list as the expiry read reads it: `listed`, newest first, the first `newer` of them those above the given
 * search position's `top`; `end`, whether it reached the first at or before the position given, or the wallet's first;
 * and, where it did not, `next`, the transaction it reads next.
 */
interface Listing {
  readonly listed: TonTx[];
  readonly end: boolean;
  readonly newer: number;
  readonly next?: TonLink;
  /** Whether it held among those above the given search position's `top`, before reading on from its `next`. */
  readonly heldAbove?: boolean;
}

/**
 * The wallet's transactions from its last back, each by its predecessor, to the first at or before `after`, or to its
 * first, at most `MAX_TVM_LISTED`. With a search position, those above its `top` are read, then the list reads on from
 * its `next`, the transactions between having been read. A link that does not hold, a transaction lacking a member the
 * read takes, or the bound reached holds the list at the transaction it reads next.
 */
async function walk(
  reader: TvmReader,
  ref: TvmRef,
  state: TonWalletState,
  after: bigint | undefined,
  search: TvmSearch | undefined,
): Promise<Listing> {
  const listed: TonTx[] = [];
  let newer = 0;
  let above = search !== undefined;
  let from = state.last;
  const held = (): Listing => ({
    listed,
    end: false,
    newer: above ? listed.length : newer,
    ...(above ? { heldAbove: true } : {}),
    ...(from === null ? {} : { next: from }),
  });
  while (from !== null) {
    if (above && sameLink(from, search!.top)) {
      newer = listed.length;
      above = false;
      from = search!.next;
      continue;
    }
    if (listed.length >= MAX_TVM_LISTED) return held();
    const at = from;
    const page = await call(() => reader.transactions(ref.wallet, at, MAX_TVM_LISTED - listed.length), isTxList);
    if (page.length === 0) return held();
    for (const t of page) {
      if (from === null || t.hash !== from.hash || t.lt !== from.lt || !sameAccount(t.account, ref.wallet)) return held();
      if (above && sameLink(t, search!.top)) break;
      if (t.mcSeqno === undefined || t.prev === undefined || t.before === undefined || t.after === undefined) return held();
      listed.push(t);
      if (after !== undefined && t.mcSeqno !== null && t.mcSeqno <= after) return { listed, end: true, newer: above ? listed.length : newer };
      from = t.prev;
      if (from === null) return { listed, end: true, newer: above ? listed.length : newer };
      if (listed.length >= MAX_TVM_LISTED) return held();
    }
  }
  return { listed, end: true, newer: above ? listed.length : newer };
}

/** Whether the account's data hash changed in the transaction; undefined where the index gave no state for it. */
function dataChanged(t: TonTx): boolean | undefined {
  if (t.before === undefined || t.after === undefined) return undefined;
  return t.before.dataHash !== t.after.dataHash;
}

/** The lowest finality of the transactions. */
function lowest(txs: readonly TonTx[]): 0 | 1 | 2 {
  return Math.min(...txs.map((t) => t.finality)) as 0 | 1 | 2;
}

/** The mark of a TON Center finality state: 1 `confirmed`, 2 `finalized`, and none for 0. */
function markOf(finality: 0 | 1 | 2): TvmMark | undefined {
  return finality >= 2 ? "finalized" : finality >= 1 ? "confirmed" : undefined;
}

/** The transaction's Jetton `transfer` out messages carrying H; `undecodable` where one of them cannot be read. */
function carrying_(t: TonTx, h: AtrHash): TonOutMsg[] | "undecodable" | undefined {
  const found: TonOutMsg[] = [];
  for (const m of t.outMsgs) {
    if (m.opcode !== OP.jettonTransfer) continue;
    const body = m.body === undefined || m.body === null ? null : liteOf(m.body);
    const payload = body === null ? null : jettonPayload(body);
    if (payload === null) return "undecodable";
    if (commentOf(payload) === h) found.push(m);
  }
  return found.length === 0 ? undefined : found;
}

/** The transaction's plain comment out message carrying H, an act of another kind; `undecodable` as `carrying_`. */
function commented(t: TonTx, h: AtrHash): TonOutMsg | "undecodable" | undefined {
  let unread = false;
  for (const m of t.outMsgs) {
    if (m.opcode !== TEXT_COMMENT) continue;
    const body = m.body === undefined || m.body === null ? null : liteOf(m.body);
    if (body === null) unread = true;
    else if (commentOf(body) === h) return m;
  }
  return unread ? "undecodable" : undefined;
}

function isSafeInteger(v: unknown): v is number {
  return Number.isSafeInteger(v);
}

function isIndexed(v: unknown): v is TonIndexed | null {
  if (v === null) return true;
  if (!isObject(v)) return false;
  return isPosition(v["first"]) && isPosition(v["last"]) && v["first"] <= v["last"] && Number.isSafeInteger(v["utime"]);
}

const STATUSES: ReadonlySet<unknown> = new Set(["active", "uninit", "nonexist", "frozen"]);

function isWalletState(v: unknown): v is TonWalletState {
  if (!isObject(v) || !STATUSES.has(v["status"])) return false;
  const { codeHash, seqno, last } = v;
  return (
    (codeHash === null || normalHash(codeHash) !== null) &&
    (seqno === null || isUint32(seqno)) &&
    (last === null || isLink(last))
  );
}

function isLink(v: unknown): v is { hash: string; lt: string } {
  return isObject(v) && typeof v["hash"] === "string" && typeof v["lt"] === "string";
}

function isTxList(v: unknown): v is readonly TonTx[] {
  return Array.isArray(v) && v.every(isTonTx);
}

// ── The cells the read decodes, without @ton/core.

/** A cell read from a bag of cells' bytes: whether it is exotic, its level mask, its data with its completion tag, its bits and its references. */
interface Lite {
  readonly exotic: boolean;
  readonly mask: number;
  readonly data: Uint8Array;
  readonly bits: number;
  readonly refs: readonly Lite[];
}

/**
 * The root of a bag of cells as `layoutOf` reads its bytes, each cell's bits and references read as `cellsOf` reads
 * them, within the pairing's bounds; null where it is not one.
 */
function liteOf(bytes: Uint8Array): Lite | null {
  if (bytes.length > MAX_BOC_BYTES) return null;
  const bag = layoutOf(bytes);
  if (bag === null || bag.cells > MAX_CELLS) return null;
  const { cells, rootIdx, refSize, spans, data } = bag;
  const built = new Array<Lite>(cells);
  for (let i = cells - 1; i >= 0; i--) {
    const [start, end] = spans[i]!;
    const s = data.subarray(start, end);
    if (s.length < 2) return null;
    const d1 = s[0]!;
    const d2 = s[1]!;
    const refCount = d1 & 7;
    if (refCount > 4 || cellSize(d1, d2, refSize) !== s.length) return null;
    const stored = (d1 & 16) === 0 ? 0 : popcount(d1 >> 5) + 1;
    const bytesAt = 2 + stored * 34;
    const n = (d2 >> 1) + (d2 & 1);
    const refsAt = bytesAt + n;
    const refs: Lite[] = [];
    for (let k = 0; k < refCount; k++) {
      let r = 0;
      for (let j = 0; j < refSize; j++) r = r * 256 + s[refsAt + k * refSize + j]!;
      if (r <= i || r >= cells) return null;
      refs.push(built[r]!);
    }
    let bits = n * 8;
    if ((d2 & 1) === 1) {
      const last = s[refsAt - 1]!;
      if ((last & 0x7f) === 0) return null;
      bits -= 1 + (31 - Math.clz32(last & -last));
    }
    if (bits > 1023) return null;
    built[i] = { exotic: (d1 & 8) !== 0, mask: d1 >> 5, data: s.subarray(bytesAt, refsAt), bits, refs };
  }
  return built[rootIdx]!;
}

/** Reads a `Lite` cell's bits in order, and its references; a read past its end throws. */
class Bits {
  private at = 0;
  private ref = 0;
  constructor(private readonly c: Lite) {}
  bit(): boolean {
    if (this.at >= this.c.bits) throw new RangeError("past the cell's bits");
    const i = this.at++;
    return ((this.c.data[i >> 3]! >> (7 - (i & 7))) & 1) === 1;
  }
  uint(n: number): number {
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 2 + (this.bit() ? 1 : 0);
    return v;
  }
  big(n: number): bigint {
    let v = 0n;
    for (let k = 0; k < n; k++) v = v * 2n + (this.bit() ? 1n : 0n);
    return v;
  }
  skip(n: number): void {
    if (this.at + n > this.c.bits) throw new RangeError("past the cell's bits");
    this.at += n;
  }
  loadRef(): Lite {
    const r = this.c.refs[this.ref++];
    if (r === undefined) throw new RangeError("past the cell's references");
    return r;
  }
  /** TL-B's `Grams`, a `VarUInteger 16`. */
  coins(): bigint {
    return this.big(this.uint(4) * 8);
  }
  /** Skips a TL-B `MsgAddress`. */
  address(): void {
    const tag = this.uint(2);
    if (tag === 0) return;
    if (tag === 1) return this.skip(this.uint(9));
    if (this.bit()) this.skip(this.uint(5));
    if (tag === 2) return this.skip(8 + 256);
    const length = this.uint(9);
    this.skip(32 + length);
  }
  /** The rest of the cell, its bits from here and its references from here, as a cell. */
  rest(): Lite {
    return bitsCell(this.c, this.at, this.c.bits, this.c.refs.slice(this.ref));
  }
}

/** The cell of `c`'s bits from `from` to `to` and the references given, with its completion tag. */
function bitsCell(c: Lite, from: number, to: number, refs: readonly Lite[]): Lite {
  const bits = to - from;
  const data = new Uint8Array(Math.ceil(bits / 8));
  for (let i = 0; i < bits; i++) {
    const j = from + i;
    if (((c.data[j >> 3]! >> (7 - (j & 7))) & 1) === 1) data[i >> 3] = data[i >> 3]! | (0x80 >> (i & 7));
  }
  if (bits % 8 !== 0) data[bits >> 3] = data[bits >> 3]! | (0x80 >> (bits & 7));
  return { exotic: false, mask: 0, data, bits, refs };
}

/**
 * The representation hash and depth of an ordinary cell of level 0 whose references are all such cells, as TON computes
 * them (the descriptor bytes, the data with its completion tag, each reference's depth, then each reference's hash);
 * null for a cell under which an exotic cell or a level lies.
 */
function liteHash(c: Lite, memo = new Map<Lite, { hash: Uint8Array; depth: number } | null>()): { hash: Uint8Array; depth: number } | null {
  const known = memo.get(c);
  if (known !== undefined) return known;
  let out: { hash: Uint8Array; depth: number } | null = null;
  if (!c.exotic && c.mask === 0) {
    const kids = c.refs.map((r) => liteHash(r, memo));
    if (kids.every((k) => k !== null)) {
      const bytes = Math.ceil(c.bits / 8);
      const repr = new Uint8Array(2 + bytes + kids.length * 34);
      repr[0] = c.refs.length;
      repr[1] = Math.floor(c.bits / 8) + bytes;
      repr.set(c.data.subarray(0, bytes), 2);
      kids.forEach((k, i) => {
        repr[2 + bytes + 2 * i] = k!.depth >> 8;
        repr[3 + bytes + 2 * i] = k!.depth & 0xff;
        repr.set(k!.hash, 2 + bytes + 2 * kids.length + 32 * i);
      });
      out = { hash: sha256(repr), depth: kids.length === 0 ? 0 : 1 + Math.max(...kids.map((k) => k!.depth)) };
    }
  }
  memo.set(c, out);
  return out;
}

/** A cell's first 32 bits, its op; null for an exotic cell or one shorter. */
function opOf(c: Lite): number | null {
  return c.exotic || c.bits < 32 ? null : new Bits(c).uint(32);
}

/**
 * A request W5 runs as signed, `internal_signed` or `external_signed`: its sequence number, and the hash of the request
 * less its last 512 bits, the signature, which the wallet's key signs (null where `liteHash` cannot hash it).
 */
function requestOf(c: Lite): { seqno: number; signed: Hex | null } | null {
  if (c.exotic || c.bits < REQUEST_MIN_BITS) return null;
  const r = new Bits(c);
  const op = r.uint(32);
  if (op !== OP.internalSigned && op !== EXTERNAL_SIGNED) return null;
  r.skip(64);
  const seqno = r.uint(32);
  const signed = liteHash(bitsCell(c, 0, c.bits - SIGNATURE_BITS, c.refs));
  return { seqno, signed: signed === null ? null : `0x${toHex(signed.hash)}` };
}

/**
 * A Jetton `transfer` body's destination, the owner the transfer names, raw; null where the body is not a transfer or
 * its destination is not a standard address with no anycast.
 */
function jettonDestination(c: Lite): string | null {
  if (c.exotic) return null;
  try {
    const r = new Bits(c);
    if (r.uint(32) !== OP.jettonTransfer) return null;
    r.skip(64);
    r.coins();
    if (r.uint(2) !== 2 || r.bit()) return null;
    const workchain = (r.uint(8) << 24) >> 24;
    return `${workchain}:${r.big(256).toString(16).padStart(64, "0")}`;
  } catch {
    return null;
  }
}

/** A Jetton `transfer` body's forward payload: its reference, or the rest of the body inline; null where it is not one. */
function jettonPayload(c: Lite): Lite | null {
  if (c.exotic) return null;
  try {
    const r = new Bits(c);
    if (r.uint(32) !== OP.jettonTransfer) return null;
    r.skip(64);
    r.coins();
    r.address();
    r.address();
    if (r.bit()) r.loadRef();
    r.coins();
    return r.bit() ? r.loadRef() : r.rest();
  } catch {
    return null;
  }
}

/** The hash in a text comment cell holding an LCP string and no references, or null. */
function commentOf(c: Lite): AtrHash | null {
  if (c.exotic || c.refs.length !== 0 || c.bits < 32 || (c.bits - 32) % 8 !== 0) return null;
  if (c.data[0] !== 0 || c.data[1] !== 0 || c.data[2] !== 0 || c.data[3] !== 0) return null;
  try {
    return fromLcpString(strictUtf8.decode(c.data.subarray(4, c.bits / 8)));
  } catch {
    return null;
  }
}

/** The amount of a Jetton `internal_transfer` body, in decimal; null where the body is not one. */
function internalAmount(bytes: Uint8Array): string | null {
  const c = liteOf(bytes);
  if (c === null || c.exotic) return null;
  try {
    const r = new Bits(c);
    if (r.uint(32) !== OP.internalTransfer) return null;
    r.skip(64);
    return r.coins().toString();
  } catch {
    return null;
  }
}

function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/**
 * Recovers the hash from the payer Jetton wallet's transaction: the comment in its inbound Jetton transfer. A
 * transaction with no inbound message body, or whose body is not a Jetton `transfer`, is `tvm/not-jetton-transfer`. A
 * body that is not a bag of cells with one root is an answer out of the reader's documented form, `tvm/unreadable`. A
 * ref that names no `transaction` string is `tvm/wrong-reader`, with nothing read. Without @ton/core the body's cells
 * cannot be read: a transaction with an inbound message body is `tvm/peer-missing`, after the ref, the reader, the read
 * and the body's size, bag-of-cells layout and CRC32C are checked, which need no peer, so an empty body is
 * `tvm/unreadable` and one over 8 KiB `tvm/boc-too-large` either way. The input's `tx` is the transaction's hash, and
 * its `option` the option the payment answers, an object, of which the read needs no member; an input whose `tx` is
 * not a non-empty string, or whose option is not an object, is `tvm/wrong-reader`, with nothing read. One call.
 */
export async function tvmRecover(
  input: RecoverInput<TvmNetwork, PaymentRequirements | MppChallenge>,
  reader: TvmReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("tvm/wrong-reader");
  if (typeof input.tx !== "string" || input.tx === "" || !isObject(input.option)) return refusal("tvm/wrong-reader");
  let tx: TonTx | null;
  try {
    tx = await reader.byHash(input.tx);
  } catch {
    return refusal("tvm/unreadable");
  }
  if (tx === null) return refusal("tvm/not-found");
  if (!isTonTx(tx)) return refusal("tvm/unreadable");
  if (tx.inBody === null) return refusal("tvm/not-jetton-transfer");
  const body = rootOf(Buffer.from(tx.inBody).toString("base64"));
  if (isRefusal(body)) return body.code === "tvm/boc-malformed" ? refusal("tvm/unreadable") : body;
  const transfer = jettonTransfer(body);
  if (isRefusal(transfer)) return transfer;
  const h = transfer.payload === null ? null : commentHash(transfer.payload);
  return h ?? refusal("tvm/payload-not-lcp");
}

function isTonTx(t: unknown): t is TonTx {
  if (!isObject(t)) return false;
  const { hash, account, aborted, finality, inBody, outMsgs, inSource, mcSeqno, lt, prev, before, after } = t;
  const bytes = (b: unknown) => b === undefined || b === null || b instanceof Uint8Array;
  return (
    typeof hash === "string" &&
    rawKey(account) !== null &&
    typeof aborted === "boolean" &&
    (finality === 0 || finality === 1 || finality === 2) &&
    (inBody === null || inBody instanceof Uint8Array) &&
    Array.isArray(outMsgs) &&
    outMsgs.every(
      (m) => isObject(m) && typeof m["hash"] === "string" && (m["opcode"] === null || typeof m["opcode"] === "number") && bytes(m["body"]),
    ) &&
    (inSource === undefined || inSource === null || typeof inSource === "string") &&
    (mcSeqno === undefined || mcSeqno === null || isPosition(mcSeqno)) &&
    (lt === undefined || typeof lt === "string") &&
    (prev === undefined || prev === null || isLink(prev)) &&
    (before === undefined || isAccountState(before)) &&
    (after === undefined || isAccountState(after))
  );
}

function isAccountState(v: unknown): v is TonAccountState {
  return isObject(v) && STATUSES.has(v["status"]) && (v["dataHash"] === null || typeof v["dataHash"] === "string");
}

function sameAccount(a: string, b: string): boolean {
  const x = rawKey(a);
  return x !== null && x === rawKey(b);
}

/**
 * The key of a raw address in the form `isRawAddress` reads, without @ton/core: the workchain as a number and the 64
 * hex digits in lowercase. Two keys are equal exactly when @ton/core's `Address.parseRaw` gives addresses that are
 * `equals`: it reads the workchain with `parseInt` and the hex as bytes. Null for any other value.
 */
function rawKey(s: unknown): string | null {
  if (!isRawAddress(s)) return null;
  const at = s.indexOf(":");
  return `${Number(s.slice(0, at))}:${s.slice(at + 1).toLowerCase()}`;
}

/**
 * A raw `workchain:hex` address, or null. Its workchain must fit TL-B's `addr_std` `workchain_id:int8`, [-128, 127]:
 * outside it, no `addr_std` can hold it, and every address this pairing writes is an `addr_std`.
 */
function rawAddress(s: unknown): Address | null {
  if (peer === undefined || !isRawAddress(s)) return null;
  try {
    return peer.Address.parseRaw(s);
  } catch {
    return null;
  }
}

/**
 * A raw address in the form `rawAddress` reads, which needs no peer: a workchain from -128 to 127, a colon, then 64 hex
 * digits.
 */
function isRawAddress(s: unknown): s is string {
  if (typeof s !== "string" || !RAW_ADDRESS.test(s)) return false;
  const workchain = Number(s.slice(0, s.indexOf(":")));
  return workchain >= -128 && workchain <= 127;
}

// ── The pairing.

/**
 * The pairing's option filter: the option's scheme, network, asset, `payTo` and `extra`, the amount as a Jetton amount
 * below 2^120, `"0"` among them (the agreement's floor is zero: the scheme asks the transfer to equal the amount with no
 * floor, and x402's TON facilitator and the standard Jetton wallet take a zero), a forward TON amount below 2^120 − 1 (`build` attaches more TON than it, and the attached value is a
 * `Grams`, below 2^120), and `maxTimeoutSeconds` a positive integer below 2^32, which `build` writes into the request
 * (the wallet message's `valid_until`, a `uint32`, is `now` plus `maxTimeoutSeconds`). The network is
 * one of the two the pairing serves, `tvm:-239` (mainnet) and `tvm:-3` (testnet), whose configuration the messages are
 * read at; any other `tvm:` network is `tvm/network-malformed`. `pairingOf`, `advertise`, `read` and `build` apply it,
 * and `bound` and `reference` hold the option a presented payment echoes to it. The asset, `payTo` and response
 * destination are raw addresses (`isRawAddress`), read without @ton/core as its `Address.parseRaw` reads them, so the
 * filter needs no peer and gives every option the same answer with @ton/core and without it.
 */
const check: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact") return refusal("x402/option-not-this-pairing");
  if (typeof o.network !== "string" || !o.network.startsWith("tvm:")) return refusal("x402/option-not-this-pairing");
  const extra: unknown = o.extra;
  if (extra !== undefined && !isObject(extra)) return refusal("tvm/option-malformed");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  if (!CONFIGURATIONS.has(o.network)) return refusal("tvm/network-malformed");
  if (extra?.["areFeesSponsored"] !== true) return refusal("tvm/option-malformed");
  const forwardTon = extra["forwardTonAmount"];
  if (forwardTon !== undefined && decimalBelow(forwardTon, COINS_LIMIT - 1n) === undefined) return refusal("tvm/option-malformed");
  if (!(o.amount === "0" || isAmount(o.amount)) || decimalBelow(o.amount, COINS_LIMIT) === undefined) return refusal("tvm/option-malformed");
  const t = o.maxTimeoutSeconds;
  if (!isTimeoutSeconds(t) || !isUint32(t)) return refusal("tvm/option-malformed");
  if (!isRawAddress(o.asset) || !isRawAddress(o.payTo)) return refusal("tvm/option-malformed");
  const response = extra["responseDestination"];
  if (response !== undefined && !isRawAddress(response)) return refusal("tvm/option-malformed");
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

/**
 * The stock server's forward payload, the cell of one zero bit, as `@x402/tvm` 2.30.0 writes it
 * (`beginCell().storeBit(0).endCell().toBoc()`, `src/utils.ts:60-62`; `src/exact/server/scheme.ts:98-99`, `:116`):
 * `te6cckEBAQEAAwAAAUD20kA0`.
 */
const STOCK_PLACEHOLDER = Uint8Array.from([
  0xb5, 0xee, 0x9c, 0x72, 0x41, 0x01, 0x01, 0x01, 0x00, 0x03, 0x00, 0x00, 0x01, 0x40, 0xf6, 0xd2, 0x40, 0x34,
]);

/** True for the cell of one zero bit and no references, which a stock server places as an empty forward payload. */
function isPlaceholder(c: Cell): boolean {
  return !c.isExotic && c.refs.length === 0 && c.bits.length === 1 && !c.bits.at(0);
}

/**
 * x402's legal context placed in the document, then `extra.forwardPayload` on the offered option set to the BoC of the
 * hash's comment, which `commentBoc` writes without @ton/core. An offer that carries a forward payload is placed only
 * when it is that comment's cell or the stock server's empty one, the cell of one zero bit (`STOCK_PLACEHOLDER`), which
 * is replaced; any other is `tvm/carrier-occupied`. Bytes equal to the comment's BoC or the stock server's are those
 * cells, and bytes `bagOf` refuses are neither, without @ton/core; any other BoC is decoded and compared by its cell,
 * the one step here that needs @ton/core, so without it that offer is `tvm/peer-missing`. Every other answer is the
 * same with @ton/core and without it.
 */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(check)(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const nh = normalHash(h)!;
  const carrier = commentBoc(nh);
  const present = offer.extra?.["forwardPayload"];
  if (present !== undefined) {
    const bag = bagOf(present);
    if (isRefusal(bag)) return refusal("tvm/carrier-occupied");
    if (!sameBytes(bag.bytes, carrier) && !sameBytes(bag.bytes, STOCK_PLACEHOLDER)) {
      const cell = rootIn(bag);
      if (isRefusal(cell) && cell.code === "tvm/peer-missing") return cell;
      if (isRefusal(cell) || !(cell.equals(comment(nh) as Cell) || isPlaceholder(cell))) return refusal("tvm/carrier-occupied");
    }
  }
  const i = offeredAt(placed.accepts, offer);
  const accepts = [...placed.accepts];
  accepts[i] = { ...offer, extra: { ...offer.extra, forwardPayload: toBase64(carrier) } };
  return { ...placed, accepts };
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(check)(doc);
}

/** The workchain of a raw address `isRawAddress` holds, as @ton/core's `Address.parseRaw` reads it (`parseInt`). */
function workchainOf(s: string): number {
  return Number(s.slice(0, s.indexOf(":")));
}

/**
 * The W5 request for the chosen option: one Jetton transfer whose forward payload is the hash's comment. Every check
 * that needs no peer comes first: H; the form of the choice's wallets, `walletId`, `seqno`, `now` and `attachNanotons`,
 * each `x402/option-malformed`, and of a state init given as a BoC, its bytes (`bagOf`); its document and option
 * (`chosen`, whose filter needs no peer); the option's forward payload's bytes (`bagOf`, else `tvm/carrier-mismatch`);
 * the wallets' workchains and `now` with the option's timeout, each `x402/option-malformed`; and the attached value
 * against the option's forward amount, which it must be above (`tvm/value-too-low`) by at most
 * `MAX_TVM_ATTACHED_ABOVE_FORWARD`, the cap of x402's TON facilitator (`tvm/value-too-high`). Then @ton/core decodes
 * the forward payload, which must be the hash's comment cell, and the state init, and writes the request's cells:
 * without it the choice is `tvm/peer-missing` only there. A state init given as an object waits for @ton/core, which
 * alone tells its `Cell`. The state init's fields and hash against the wallet come last.
 */
async function build(c: TvmChoice, h: AtrHash): Promise<TvmUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/option-malformed");
  const { required, accepted, wallet, walletId, seqno, jettonWallet, attachNanotons, now, stateInit } = c;
  if (!isRawAddress(wallet) || !isRawAddress(jettonWallet)) return refusal("x402/option-malformed");
  if (!isUint32(walletId) || !isUint32(seqno) || !Number.isSafeInteger(now) || now < 0) {
    return refusal("x402/option-malformed");
  }
  if (typeof attachNanotons !== "bigint" || attachNanotons >= COINS_LIMIT) return refusal("x402/option-malformed");
  // A state init given as an object may be @ton/core's cell, which only @ton/core tells; any other value is read as a BoC.
  const initBag = stateInit === undefined || (typeof stateInit === "object" && stateInit !== null) ? undefined : bagOf(stateInit);
  if (isRefusal(initBag)) return initBag;
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  const extra = accepted.extra!;
  const carried = bagOf(extra["forwardPayload"]);
  if (isRefusal(carried)) return refusal("tvm/carrier-mismatch");
  const config = CONFIGURATIONS.get(accepted.network)!;
  if (!config.workchains.has(workchainOf(wallet)) || !config.workchains.has(workchainOf(jettonWallet))) {
    return refusal("x402/option-malformed");
  }
  const validUntil = now + accepted.maxTimeoutSeconds;
  if (!isUint32(validUntil)) return refusal("x402/option-malformed");
  const forwardTon = extra["forwardTonAmount"] === undefined ? 0n : BigInt(extra["forwardTonAmount"] as string);
  if (attachNanotons <= forwardTon) return refusal("tvm/value-too-low");
  if (attachNanotons > forwardTon + MAX_TVM_ATTACHED_ABOVE_FORWARD) return refusal("tvm/value-too-high");
  if (peer === undefined) return refusal("tvm/peer-missing");
  const carrier = comment(nh) as Cell;
  const held = rootIn(carried);
  if (isRefusal(held) || !held.equals(carrier)) return refusal("tvm/carrier-mismatch");
  const walletAddress = rawAddress(wallet)!;
  const jettonAddress = rawAddress(jettonWallet)!;
  const initCell =
    stateInit === undefined || stateInit instanceof peer.Cell ? stateInit : initBag === undefined ? refusal("tvm/boc-malformed") : rootIn(initBag);
  if (isRefusal(initCell)) return initCell;
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
  // The checks read the state init's form only: `complete` carries the cell itself.
  if (
    initCell !== undefined &&
    (!isStateInit(initCell) || merkleDepth([initCell]) > MAX_MERKLE_DEPTH || !deploysFrom(initCell, config, walletAddress))
  ) {
    return refusal("x402/option-malformed");
  }
  return {
    request: { kind: "ton-w5", hash: Uint8Array.from(request.hash()), signedBoc: bocOf(request) },
    complete(signature: Uint8Array): TvmPayment | Refusal {
      if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_BITS / 8) {
        return refusal("x402/signature-malformed");
      }
      const signed = peer.beginCell().storeSlice(request.beginParse()).storeBuffer(Buffer.from(signature)).endCell();
      // TL-B's MessageRelaxed: the info, then `init:(Maybe (Either StateInit ^StateInit))` as a reference to the given
      // state init cell, then the body as a reference. `@ton/core`'s `storeMessageRelaxed` takes a parsed `StateInit`
      // and stores it again, which can write its libraries dictionary in another form, a cell whose hash is not the
      // wallet's address; the message is written here around the cell as given.
      const message = peer.beginCell().store(
        peer.storeCommonMessageInfoRelaxed({
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
        }),
      );
      if (initCell === undefined) message.storeBit(0);
      else message.storeBit(1).storeBit(1).storeRef(initCell);
      const root = message.storeBit(1).storeRef(signed).endCell();
      return paymentWith(required, accepted, { settlementBoc: bocOf(root), asset: accepted.asset });
    },
  };
}

/**
 * True when the cell is exactly one TL-B `StateInitWithLibs`, the type in which TON validates a message's state init,
 * in the action phase that sends it and in the transaction that receives it (ton-blockchain/ton
 * `crypto/block/transaction.cpp`, `try_action_send_msg` and `unpack_input_msg`):
 * `fixed_prefix_length:(Maybe (## 5)) special:(Maybe TickTock) code:(Maybe ^Cell) data:(Maybe ^Cell)
 * library:(HashmapE 256 SimpleLib)`. As TON's validation does (`crypto/tl/tlblib.cpp`, `TLB::validate_ref_internal`),
 * each cell this reads must be ordinary and read to its end, with no bit or reference left over, and it reads at most
 * 1,024 cells (`default_validate_max_cells`): the state init's, then each dictionary cell each time a path reaches it.
 * The code, the data and each library's root are any cells and are not read.
 */
function isStateInit(root: Cell): boolean {
  const { exact, hashmap } = validation(STATE_INIT_MAX_READS);
  const simpleLib = (s: Slice): boolean => {
    s.loadBit();
    s.loadRef();
    return true;
  };
  try {
    return exact(root, (s) => {
      if (s.loadBit()) s.skip(5);
      if (s.loadBit()) s.skip(2);
      s.loadMaybeRef();
      s.loadMaybeRef();
      const library = s.loadMaybeRef();
      return library === null || hashmap(library, 256, simpleLib);
    });
  } catch {
    return false;
  }
}

/**
 * True when TON deploys the account at `address` from a state init `isStateInit` holds, at the configuration
 * (ton-blockchain/ton `crypto/block/transaction.cpp`, `unpack_msg_state`, `prepare_compute_phase` and
 * `check_in_msg_state_hash`): from global version 15 its `library:(HashmapE 256 SimpleLib)` is `hme_empty` ("libraries
 * are not null"), from global version 10 its `fixed_prefix_length` is absent or at most the configuration's
 * `maxAccFixedPrefixLength` ("too big fixed prefix length"), and its representation hash is the address's 256 bits,
 * except the first `fixed_prefix_length` bits, which may differ ("in_msg_state hash mismatch"). The workchain is not
 * part of the hash.
 */
function deploysFrom(root: Cell, config: TonConfiguration, address: Address): boolean {
  const s = root.beginParse();
  const prefix = s.loadBit() ? s.loadUint(5) : 0;
  if (s.loadBit()) s.skip(2);
  s.loadMaybeRef();
  s.loadMaybeRef();
  const libraries = s.loadBit();
  if (config.globalVersion >= 15 && libraries) return false;
  if (config.globalVersion >= 10 && prefix > config.maxAccFixedPrefixLength) return false;
  const hash = root.hash();
  for (let i = prefix; i < 256; i++) {
    if (((hash[i >> 3]! ^ address.hash[i >> 3]!) & (0x80 >> (i & 7))) !== 0) return false;
  }
  return true;
}

/**
 * TL-B validation as TON runs it (ton-blockchain/ton `crypto/tl/tlblib.cpp`, `TLB::validate_ref_internal`): each cell
 * ordinary and read to its end, with no bit or reference left over, and at most `reads` cells read in all. `hashmap`
 * reads a TL-B `Hashmap n X` edge (`hm_edge`): a label of at most n bits (`labelLength`), then at key length 0 the
 * value, which `value` reads, else a fork of two edges, each cell counted each time a path reaches it. A read past a
 * slice's end throws.
 */
function validation(reads: number): {
  exact: (c: Cell, read: (s: Slice) => boolean) => boolean;
  hashmap: (c: Cell, n: number, value: (s: Slice) => boolean) => boolean;
} {
  let left = reads;
  const exact = (c: Cell, read: (s: Slice) => boolean): boolean => {
    if (left <= 0 || c.isExotic) return false;
    left--;
    const s = c.beginParse();
    return read(s) && s.remainingBits === 0 && s.remainingRefs === 0;
  };
  const hashmap = (c: Cell, n: number, value: (s: Slice) => boolean): boolean =>
    exact(c, (s) => {
      const l = labelLength(s, n);
      if (l === null) return false;
      if (l === n) return value(s);
      const a = s.loadRef();
      const b = s.loadRef();
      return hashmap(a, n - l - 1, value) && hashmap(b, n - l - 1, value);
    });
  return { exact, hashmap };
}

/**
 * The length of a TL-B `HmLabel ~l n` read from the slice: `hml_short$0 len:(Unary ~l) s:(l * Bit)`, `hml_long$10
 * l:(#<= n) s:(l * Bit)` or `hml_same$11 v:Bit l:(#<= n)`. Null when it is longer than `n`; a read past the slice's end
 * throws.
 */
function labelLength(s: Slice, n: number): number | null {
  const width = Math.ceil(Math.log2(n + 1));
  let l: number;
  if (!s.loadBit()) {
    l = 0;
    while (s.loadBit()) l++;
  } else if (!s.loadBit()) {
    l = width === 0 ? 0 : s.loadUint(width);
  } else {
    s.loadBit();
    l = width === 0 ? 0 : s.loadUint(width);
    return l > n ? null : l;
  }
  if (l > n) return null;
  s.skip(l);
  return l;
}

/**
 * The signed request's carrier, read at the option's network's configuration and checked against its forward payload.
 * Every check that needs no peer comes first: the payment and its option (`presentedWith`, whose filter needs no peer),
 * the settlement BoC's bytes (`bagOf`), then the forward payload's bytes (else `tvm/carrier-mismatch`). @ton/core then
 * decodes the settlement BoC's cells and the forward payload's, which must be the payment's comment cell: without it the
 * payment is `tvm/peer-missing` only there.
 */
function carried(presented: unknown): { accepted: PaymentRequirements; c: Exclude<ReturnType<typeof carrierIn>, Refusal> } | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const boc = p.payload["settlementBoc"];
  if (typeof boc !== "string") return refusal("x402/payload-malformed");
  const settlement = bagOf(boc);
  if (isRefusal(settlement)) return settlement;
  const forward = bagOf(p.accepted.extra?.["forwardPayload"]);
  if (isRefusal(forward)) return refusal("tvm/carrier-mismatch");
  const root = rootIn(settlement);
  if (isRefusal(root)) return root;
  const c = carrierIn(root, CONFIGURATIONS.get(p.accepted.network)!);
  if (isRefusal(c)) return c;
  const held = rootIn(forward);
  if (isRefusal(held) || !held.equals(c.payload)) return refusal("tvm/carrier-mismatch");
  return { accepted: p.accepted, c };
}

/**
 * The hash in the forward payload of the transfer the payer's W5 wallet signed, which must be the option's. The
 * presented option is held to the filter `read` applies, so a payment under an option `read` would not offer is
 * refused. The signature is not verified here; the facilitator verifies it, and the W5 contract checks it before any
 * action runs.
 * A state init that holds a libraries dictionary, has a fixed prefix longer than 8 bits, or does not hash to the
 * settlement message's destination is read, since whether TON deploys the wallet from it is chain state.
 * The option, the settlement BoC's bytes and the forward payload's bytes are checked without @ton/core, which then
 * decodes both BoCs' cells: without it a payment that passes those checks is `tvm/peer-missing`, as for `reference`.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = carried(presented);
  return isRefusal(r) ? r : r.c.h;
}

/**
 * The read keys, computed from the signed BoC: H, the request's body hash, its signed hash, the sequence number it was
 * signed against and, where the payment carries a state init, its code's hash; and the payee, the `payTo` of the option
 * the payment answers. A payment whose `accepted` is not that option, compared by RFC 8785 with `extra.forwardPayload`
 * dropped from both as `unplaced` drops it, is `x402/accepted-not-option`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<TvmRef | Refusal> {
  const r = carried(presented);
  if (isRefusal(r)) return r;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const given = unplaced(option);
  if (isRefusal(given) || !sameJson(unplaced(r.accepted), given)) return refusal("x402/accepted-not-option");
  return {
    network: r.accepted.network as TvmNetwork,
    payee,
    h: r.c.h,
    transferBodyHash: r.c.transferBodyHash,
    jettonWallet: r.c.jettonWallet,
    requestBodyHash: r.c.requestBodyHash,
    signedHash: r.c.signedHash,
    wallet: r.c.wallet,
    validUntil: r.c.validUntil,
    seqno: r.c.seqno,
    ...(r.c.codeHash === undefined ? {} : { codeHash: r.c.codeHash }),
  };
}

function isUint32(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n < UINT32_LIMIT;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: "x402/exact/tvm",
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/tvm`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator sends the request
 * the payer's W5 wallet signed; `status` reads the wallet's transaction and the Jetton transfers it led to.
 */
export const exactTvm = Object.freeze({
  id: ID,
  data: TVM[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: tvmStatus,
  recover: tvmRecover,
}) satisfies Entry<
  typeof ID,
  TvmPayment,
  TvmRef,
  TvmReader,
  X402Forms & {
    choice: TvmChoice;
    unsigned: TvmUnsigned;
    landed: unknown;
    network: TvmNetwork;
    query: StatusQuery<TvmRef, bigint, TvmMark, TvmSearch>;
    answer: TvmStatus;
  }
>;

