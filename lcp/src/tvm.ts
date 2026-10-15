/**
 * TON: the pairing `x402/exact/tvm`. The ATR hash rides in the scheme's `extra.forwardPayload` as a TEP-74 text
 * comment holding its LCP string. The payer's W5 wallet signs a request whose one Jetton transfer carries that
 * payload; settlement is read from the W5 wallet's transaction with that request and the Jetton wallets' transactions
 * it led to, through a bounded reader.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import type * as TonCore from "@ton/core";
import type { Address, Cell, Slice } from "@ton/core";
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
import { decimalBelow, fromBase64 } from "./rail-bytes.js";
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

/**
 * A transaction as a TON Center v3 endpoint reports it. `inBody` is the inbound message body as a BoC, or null when the
 * transaction has no inbound message body (its `in_msg`, or that message's `message_content.body`, is null).
 */
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
  /** The payer's Jetton wallet, raw: the address TON sends the W5 request's one message to. */
  jettonWallet: string;
  /**
   * The representation hash of the signed W5 request: the whole body of the message to the payer's wallet, its
   * signature and any bit or reference after `has_other_actions` 0, which W5 does not read, included.
   */
  requestBodyHash: Hex;
  /** The payer's W5 wallet, raw: the address TON sends the settlement message to. */
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
  /** The 32-byte representation hash of the W5 request the wallet key signs. */
  request: { kind: "ton-w5"; hash: Uint8Array };
  /** Takes the 64-byte Ed25519 signature. */
  complete(signature: Uint8Array): TvmPayment | Refusal;
}

const ID = "x402/exact/tvm" as const;
const MAX_BOC_BYTES = 8192;
const MAX_CELLS = 512;
const MAX_DEPTH = 32;
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
 * The send modes TON's action phase sends a message with (`try_action_send_msg`): +16 is bounce-on-fail and is set
 * aside from global version 4, and the rest must be +1, +2, +32, +64 and +128 alone (`0xe3`), never +64 with +128. Any
 * other mode is refused, or skipped under +2 from global version 13: the message is not sent either way.
 */
const SEND_MODES = 0xe3;
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
 * The head read first must pass `validUntil` by more than this many seconds before a request whose Jetton transfer no
 * W5 transaction emitted reads failed. A W5 transaction runs at its shard block's time, and a masterchain block
 * references that shard block only later, so the masterchain head can pass `validUntil` before an index holds a
 * transaction that ran in time.
 */
const EXPIRY_MARGIN = 60;

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
 * The one root of a base64 BoC of at most 8 KiB, at most 512 cells and depth 32, or the refusal. The bytes are read
 * as TON deserializes a bag of cells (`deserialized`): bytes TON refuses are `tvm/boc-malformed`. An exotic cell TON
 * accepts is refused only where a read parses it: every parse here refuses one without throwing, and a cell no read
 * parses, such as a state init's library code or a Jetton transfer's custom payload, is left as it is.
 */
function rootOf(boc: unknown): Cell | Refusal {
  if (peer === undefined) return refusal("tvm/peer-missing");
  const bytes = boc === "" ? null : fromBase64(boc);
  if (bytes === null) return refusal("tvm/boc-malformed");
  if (bytes.length > MAX_BOC_BYTES) return refusal("tvm/boc-too-large");
  const root = deserialized(bytes);
  if (root === null) return refusal("tvm/boc-malformed");
  if (root.depth() > MAX_DEPTH) return refusal("tvm/boc-too-large");
  if (cellCount(root) > MAX_CELLS) return refusal("tvm/boc-too-large");
  return root;
}

/**
 * The one root of a bag of cells as TON deserializes it (ton-blockchain/ton `crypto/vm/boc.cpp`,
 * `std_boc_deserialize`), or null where TON refuses the bytes:
 * - the header (`parse_serialized_header`): one of the three magics, cache bits only with an index, a reference size
 *   of 1 to 4 bytes and an offset size of 1 to 8, at least one cell, exactly one root, no more absent cells than
 *   cells, a data size within the cell count's bounds, and the bytes holding all of it;
 * - with a CRC32C, the input's last four bytes are the CRC32C of every byte before them;
 * - each cell's bytes (`deserialize`, `deserialize_cell`): at most four references, each to a later cell, the bytes
 *   read exactly (the cells fill the data, or each index entry bounds one cell with no unused space), a partial last
 *   data byte holding a data bit before its completion tag, and with cache bits, each cell's flag set exactly when two
 *   or more references (the root's counted) name it;
 * - each cell as TON creates it (`crypto/vm/cells/DataCell.cpp`, `CellChecker`, and `create_data_cell`): at most 1,023
 *   bits; an exotic cell of type 1 to 4 with its exact bits and references (a pruned branch none, a library cell none,
 *   a Merkle proof one, a Merkle update two, each Merkle child's level-0 hash and depth as the cell stores them); a
 *   depth of at most 1,024 at every level; the level mask its first byte gives equal to the one computed; and where it
 *   stores hashes and depths, each one equal to the computed one;
 * - the root's level 0.
 */
function deserialized(b: Uint8Array): Cell | null {
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
  if (crc && !peer!.crc32c(Buffer.from(b.subarray(0, b.length - 4))).equals(Buffer.from(b.subarray(b.length - 4)))) return null;
  const rootIdx = generic ? at(rootsAt, refSize) : 0;
  if (rootIdx >= cells) return null;
  const data = b.subarray(dataAt, dataAt + dataSize);
  const spans: [number, number][] = [];
  if (indexed) {
    let start = 0;
    for (let i = 0; i < cells; i++) {
      const raw = at(indexAt + i * offSize, offSize);
      const end = cacheBits ? Math.floor(raw / 2) : raw;
      if (start > end || end > dataSize) return null;
      spans.push([start, end]);
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
  if (cacheBits) {
    for (let i = 0; i < cells; i++) if ((named[i]! > 1) !== (at(indexAt + i * offSize, offSize) % 2 === 1)) return null;
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
function messageOf(c: Cell, from: string | null, config: TonConfiguration): { dest: string; body: Cell } | null {
  const T = peer!;
  if (c.isExotic) return null;
  try {
    const s = c.beginParse();
    if (s.loadBit()) return null;
    s.skip(3);
    const src = msgAddress(s, config);
    if (src.tag !== 0 && (src.tag !== 2 || src.raw === null || (from !== null && src.raw !== from))) return null;
    const dest = msgAddress(s, config);
    if (dest.tag < 2 || dest.raw === null) return null;
    if (varUInteger(s, 4) === null) return null;
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
    return { dest: dest.raw, body };
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
 * `tvm/boc-malformed`, and the outgoing one, or a send mode TON refuses or skips, `tvm/not-jetton-transfer`. The
 * settlement message's source names the account that relays it, which the BoC cannot show: one naming another account
 * is read, and TON sends it when that account relays it. `wallet` and `jettonWallet` are the addresses TON sends to: an
 * `addr_var` of 256 bits names its `addr_std`.
 */
export function tvmCarrier(settlementBoc: string, network: TvmNetwork): {
  h: AtrHash;
  transferBodyHash: Hex;
  jettonWallet: string;
  requestBodyHash: Hex;
  wallet: string;
  validUntil: number;
  payload: TonCell;
} | Refusal {
  const config = CONFIGURATIONS.get(network);
  if (config === undefined) return refusal("tvm/network-malformed");
  return carrierIn(settlementBoc, config);
}

/** `tvmCarrier` at the network's configuration, with the payload as the peer's cell. */
function carrierIn(settlementBoc: string, config: TonConfiguration): {
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
  const message = messageOf(root, null, config);
  if (message === null) return refusal("tvm/boc-malformed");

  let validUntil: number;
  let actions: Cell;
  try {
    const body = message.body;
    const op = body.beginParse();
    if (op.remainingBits < 32 || op.loadUint(32) !== OP.internalSigned || body.bits.length < REQUEST_MIN_BITS) {
      return refusal("tvm/not-w5-signed");
    }
    const signedPart = peer!.beginCell().storeBits(body.bits.substring(0, body.bits.length - SIGNATURE_BITS));
    for (const r of body.refs) signedPart.storeRef(r);
    const s = signedPart.endCell().beginParse().skip(32);
    s.loadUint(32);
    validUntil = s.loadUint(32);
    s.loadUint(32);
    const list = s.loadMaybeRef();
    const hasOtherActions = s.loadBit();
    if (list === null || hasOtherActions) return refusal("tvm/actions");
    actions = list;
  } catch {
    return refusal("tvm/not-w5-signed");
  }

  const send = sendMessage(actions);
  if (isRefusal(send)) return send;
  if (!sendsWith(send.mode, config)) return refusal("tvm/not-jetton-transfer");
  const out = messageOf(send.message, message.dest, config);
  if (out === null) return refusal("tvm/not-jetton-transfer");
  const transfer = jettonTransfer(out.body);
  if (isRefusal(transfer)) return transfer;
  if (transfer.payload === null) return refusal("tvm/payload-not-lcp");
  const h = commentHash(transfer.payload);
  if (h === null) return refusal("tvm/payload-not-lcp");
  return {
    h,
    transferBodyHash: `0x${out.body.hash().toString("hex")}`,
    jettonWallet: out.dest,
    requestBodyHash: `0x${message.body.hash().toString("hex")}`,
    wallet: message.dest,
    validUntil,
    payload: transfer.payload,
  };
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

/** True when TON's action phase sends a message with this mode at the configuration (`SEND_MODES`). */
function sendsWith(mode: number, config: TonConfiguration): boolean {
  const m = config.globalVersion >= 4 ? mode & ~16 : mode;
  return (m & ~SEND_MODES) === 0 && (m & 0xc0) !== 0xc0;
}

// ── Settlement.

/**
 * Reads the head's time first. Then finds the signed request by its body hash on the payer's W5 wallet: only a W5
 * transaction there that did not abort and emitted the Jetton transfer counts, because W5 checks the request's
 * signature before any action runs, so a request the payer did not sign sends nothing from that wallet. It follows that
 * message to the payer's Jetton wallet, and that wallet's `internal_transfer` to whichever Jetton wallet
 * takes it, which is not compared with `payTo`: settled
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

/**
 * Recovers the hash from the payer Jetton wallet's transaction: the comment in its inbound Jetton transfer. A
 * transaction with no inbound message body, or whose body is not a Jetton `transfer`, is `tvm/not-jetton-transfer`. A
 * body that is not a bag of cells with one root is an answer out of the reader's documented form, `tvm/unreadable`. A
 * ref that names no `transaction` string is `tvm/wrong-reader`, with nothing read. One call.
 */
export async function tvmRecover(ref: { network: TvmNetwork; transaction: string }, reader: TvmReader): Promise<AtrHash | Refusal> {
  if (peer === undefined) return refusal("tvm/peer-missing");
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("tvm/wrong-reader");
  if (typeof ref.transaction !== "string" || ref.transaction === "") return refusal("tvm/wrong-reader");
  let tx: TonTx | null;
  try {
    tx = await reader.byHash(ref.transaction);
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

/**
 * A raw `workchain:hex` address, or null. Its workchain must fit TL-B's `addr_std` `workchain_id:int8`, [-128, 127]:
 * outside it, no `addr_std` can hold it, and every address this pairing writes is an `addr_std`.
 */
function rawAddress(s: unknown): Address | null {
  if (peer === undefined || typeof s !== "string" || !RAW_ADDRESS.test(s)) return null;
  const workchain = Number(s.slice(0, s.indexOf(":")));
  if (workchain < -128 || workchain > 127) return null;
  try {
    return peer.Address.parseRaw(s);
  } catch {
    return null;
  }
}

// ── The pairing.

/**
 * The pairing's option filter: the option's scheme, network, asset, `payTo` and `extra`, the amount as a Jetton amount
 * below 2^120 and `maxTimeoutSeconds` a positive safe integer, which `build` writes into the request. The network is
 * one of the two the pairing serves, `tvm:-239` (mainnet) and `tvm:-3` (testnet), whose configuration the messages are
 * read at; any other `tvm:` network is `tvm/network-malformed`. `pairingOf`, `advertise`, `read` and `build` apply it,
 * and `bound` and `reference` hold the option a presented payment echoes to it.
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
  if (peer === undefined) return refusal("tvm/peer-missing");
  if (rawAddress(o.asset) === null || rawAddress(o.payTo) === null) return refusal("tvm/option-malformed");
  if (extra?.["areFeesSponsored"] !== true) return refusal("tvm/option-malformed");
  const forwardTon = extra["forwardTonAmount"];
  if (forwardTon !== undefined && decimalBelow(forwardTon, COINS_LIMIT) === undefined) return refusal("tvm/option-malformed");
  const response = extra["responseDestination"];
  if (response !== undefined && rawAddress(response) === null) return refusal("tvm/option-malformed");
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
  const config = CONFIGURATIONS.get(accepted.network)!;
  if (!config.workchains.has(walletAddress.workChain) || !config.workchains.has(jettonAddress.workChain)) {
    return refusal("x402/option-malformed");
  }
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
  // The checks read the state init's form only: `complete` carries the cell itself.
  if (
    initCell !== undefined &&
    (!isStateInit(initCell) || merkleDepth([initCell]) > MAX_MERKLE_DEPTH || !deploysFrom(initCell, config, walletAddress))
  ) {
    return refusal("x402/option-malformed");
  }
  return {
    request: { kind: "ton-w5", hash: Uint8Array.from(request.hash()) },
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

/** The signed request's carrier, read at the option's network's configuration and checked against its forward payload. */
function carried(presented: unknown): { accepted: PaymentRequirements; c: Exclude<ReturnType<typeof carrierIn>, Refusal> } | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const boc = p.payload["settlementBoc"];
  if (typeof boc !== "string") return refusal("x402/payload-malformed");
  const c = carrierIn(boc, CONFIGURATIONS.get(p.accepted.network)!);
  if (isRefusal(c)) return c;
  if (!carries(p.accepted, c.payload)) return refusal("tvm/carrier-mismatch");
  return { accepted: p.accepted, c };
}

/**
 * The hash in the forward payload of the transfer the payer's W5 wallet signed, which must be the option's. The
 * presented option is held to the filter `read` applies, so a payment under an option `read` would not offer is
 * refused. The signature is not verified here; the facilitator verifies it, and the W5 contract checks it before any
 * action runs.
 * A state init that holds a libraries dictionary, has a fixed prefix longer than 8 bits, or does not hash to the
 * settlement message's destination is read, since whether TON deploys the wallet from it is chain state.
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
    "as a TEP-74 text comment in LCP string form. The payer's Jetton wallet executed that transfer, and the Jetton " +
    "wallet its `internal_transfer` reached accepted it. The comment is on chain in the transfer's message bodies. " +
    "This does not show that amount, payee, asset or timing match the ATR's content.",
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

