/**
 * x402 `batch-settlement`: one ATR per channel. On EVM the ATR hash is the channel configuration's `salt`, which the
 * channel id commits to and every signature signs; on Solana it is the opening transaction's seller Memo instruction
 * (`extra.memo`), beside x402's receiver-authorizer binding memo; on Cloudflare it rides the echoed
 * `extensions.legalContext` of each request, with no channel.
 */
import { base58 } from "@scure/base";
import { toLcpString, type AtrHash, type Json } from "./core.js";
import {
  addressOfWord,
  addressWord,
  bytes32Word,
  bytesOf,
  concat,
  hexOf,
  keccak,
  sameBytes,
  uintOf,
  uintWord,
  wordAt,
  type Hex,
} from "./evm-abi.js";
import {
  AUTHORIZATION_USED_TOPIC,
  PERMIT2,
  permit2TypedData,
  type Eip155,
  type EvmLog,
  type EvmReader,
  type EvmReceipt,
  type EvmTransaction,
  type Field,
  type Permit2TypedData,
} from "./evm.js";
import { chainIdOf, isAddress, isObject, normalHash, sameJson } from "./fields.js";
import {
  failedAt,
  finalAt,
  isLog,
  isReceipt,
  receiveTypedData,
  unreadable,
  withPayee,
  type EvmMark,
  type EvmQuery,
  type ReceiveTypedData,
} from "./internal/evm.js";
import {
  hexOfWord,
  movedAt,
  type BatchEvmRef,
} from "./internal/evm-x402-reads.js";
import { callsIn, inputCarries, nonceUsed, partyOf, same, statusOf, topicAddress, transfersIn, type Classified, type ReadSpec, type TxView } from "./internal/evm-x402.js";
import { x402Payee } from "./internal/payee.js";
import type { RecoverInput, StatusAnswer, UnreadableReason } from "./internal/read.js";
import {
  buildChannelMessage,
  channelInstruction,
  channelMessage,
  channelPda,
  channelVoucherMessage,
  decodeSvmTx,
  isCurveKey,
  isKey,
  isPayerInput,
  isU64,
  isSolanaNetwork,
  memoCarrier,
  memoData,
  signedWire,
  staticNonce,
  versionNotAdmitted,
  builtVersion,
  svmOptionFilter,
  X402_V1,
  wireOf,
  TOKEN,
  TOKEN_2022,
  type SolanaNetwork,
  type SvmTx,
} from "./internal/svm.js";
import {
  landedTransaction,
  svmChannelStatus,
  type SvmQuery,
  type SvmReader,
  type SvmRef,
  type SvmStatus,
  x402SvmReference,
} from "./internal/svm-read.js";
import type { BatchPaymentPayload, CloudflarePaymentPayload } from "./internal/x402-batch-settlement.js";
import {
  acceptedBy,
  advertiseFor,
  chosen,
  filterOf,
  isAmount,
  isTimeoutSeconds,
  legalContextOf,
  offeredAt,
  paymentWith,
  readFor,
  withExtra,
  withOption,
  withoutExtra,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  x402Shape,
  type X402Forms,
} from "./internal/x402.js";
import { decimalBelow, toBase64 } from "./rail-bytes.js";
import { broadcastsWithin } from "./internal/broadcaster.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Choice,
} from "./x402.js";
import { MAX_SIGNATURE_BYTES } from "./internal/bounds.js";
import { EIP155_X402 } from "./internal/data/eip155-x402.js";
import { SOLANA } from "./internal/data/solana.js";
import type { Entry, NoRead } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";

// ── EVM pieces ───────────────────────────────────────────────────────────────────────────────────────────────────

export const BATCH_SETTLEMENT = "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" as const;
export const ERC3009_DEPOSIT_COLLECTOR = "0x4020806089470a89826cB9fB1f4059150b550004" as const;
export const PERMIT2_DEPOSIT_COLLECTOR = "0x4020425FAf3B746C082C2f942b4E5159887B0005" as const;
export const CHANNEL_CONFIG_TYPEHASH = "0x1c9a06ceab9b0ebbd3301dc56c9111bb6d9af421356dc9ccb3b7084c755db308" as const;
export const VOUCHER_TYPEHASH = "0x1e1bd6ff84c3e0d9029a292b212e039c0ca97ec497c55191a4a5874294609a69" as const;
export const CHANNEL_CREATED_TOPIC = "0x69d8248d5566bdb2ebc4d218970710d8378a2ff9b709a999e052b71970f808fa" as const;
export const DEPOSITED_TOPIC = "0x6c2a09353b5e75e70d0b9778b80a413809bb235d46c211811c474b3346791d89" as const;

const DOMAIN_TYPEHASH = keccak("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
const DOMAIN_NAME = "x402 Batch Settlement";
const DOMAIN_VERSION = "1";
const U128_LIMIT = 1n << 128n;
const U256_LIMIT = 1n << 256n;
const U40_LIMIT = 1n << 40n;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^[0-9]{1,39}$/;

/** A string of `0x` and 64 hex digits. The type is read first: `RegExp.test` would read `["0x…"]` as its one element. */
function isHash32(v: unknown): v is Hex {
  return typeof v === "string" && HASH32.test(v);
}

export interface ChannelConfig {
  payer: Hex;
  payerAuthorizer: Hex;
  receiver: Hex;
  receiverAuthorizer: Hex;
  token: Hex;
  withdrawDelay: number;
  /** `0x` and 64 hex digits. */
  salt: Hex;
}

/** An EIP-712 request for the buyer's signer; numbers in `message` are decimal strings. */
export interface Eip712Request {
  domain: { name: string; version?: string; chainId: number; verifyingContract: Hex };
  types: { [t: string]: Field[] };
  primaryType: string;
  message: { [k: string]: Json };
}

/**
 * The configuration's types, which the channel contract's `getChannelId` hashes whatever their values: five addresses,
 * a `uint40` withdrawal delay and a 32-byte salt.
 */
function isChannelConfig(c: unknown): c is ChannelConfig {
  if (!isObject(c)) return false;
  const delay = c["withdrawDelay"];
  return (
    ["payer", "payerAuthorizer", "receiver", "receiverAuthorizer", "token"].every((k) => isAddress(c[k])) &&
    Number.isSafeInteger(delay) &&
    (delay as number) >= 0 &&
    BigInt(delay as number) < U40_LIMIT &&
    isHash32(c["salt"])
  );
}

function domainSeparator(chainId: number): Uint8Array {
  return keccak(
    concat([
      DOMAIN_TYPEHASH,
      keccak(DOMAIN_NAME),
      keccak(DOMAIN_VERSION),
      uintWord(BigInt(chainId)),
      addressWord(BATCH_SETTLEMENT),
    ]),
  );
}

function eip712Digest(chainId: number, structHash: Uint8Array): Hex {
  return hexOf(keccak(concat([Uint8Array.of(0x19, 0x01), domainSeparator(chainId), structHash])));
}

/** The channel id: the EIP-712 digest of the configuration under the `x402 Batch Settlement` domain. */
export function batchChannelId(chainId: number, c: ChannelConfig): Hex | Refusal {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return refusal("evm/network-malformed");
  if (!isChannelConfig(c)) return refusal("evm/field-malformed");
  const structHash = keccak(
    concat([
      bytes32Word(CHANNEL_CONFIG_TYPEHASH),
      addressWord(c.payer),
      addressWord(c.payerAuthorizer),
      addressWord(c.receiver),
      addressWord(c.receiverAuthorizer),
      addressWord(c.token),
      uintWord(BigInt(c.withdrawDelay)),
      bytes32Word(c.salt),
    ]),
  );
  return eip712Digest(chainId, structHash);
}

/**
 * The EIP-3009 deposit's nonce: keccak256(abi.encode(bytes32 channelId, uint256 authSalt)). A `channelId` or
 * `authSalt` that is not a string of `0x` and 64 hex digits is `evm/field-malformed`.
 */
export function erc3009DepositNonce(channelId: Hex, authSalt: Hex): Hex | Refusal {
  if (!isHash32(channelId) || !isHash32(authSalt)) return refusal("evm/field-malformed");
  return hexOf(keccak(concat([bytes32Word(channelId), bytes32Word(authSalt)])));
}

/** The voucher the payer authorizer signs, `Voucher(bytes32 channelId, uint128 maxClaimableAmount)`. */
function voucherRequest(chainId: number, channelId: Hex, maxClaimableAmount: bigint): Eip712Request {
  return {
    domain: { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract: BATCH_SETTLEMENT },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Voucher: [
        { name: "channelId", type: "bytes32" },
        { name: "maxClaimableAmount", type: "uint128" },
      ],
    },
    primaryType: "Voucher",
    message: { channelId, maxClaimableAmount: maxClaimableAmount.toString() },
  };
}

/** The config and id of a `ChannelCreated(channelId, config)` log, the id recomputed from the 7-word data. */
export function batchChannelCreated(log: EvmLog, chainId: number): { channelId: Hex; config: ChannelConfig } | Refusal {
  const data = bytesOf(log?.data);
  if (data === undefined || data.length !== 224 || log.topics.length < 2) return refusal("evm/field-malformed");
  const addr = (i: number): Hex | undefined => {
    const w = wordAt(data, i)!;
    return w.subarray(0, 12).every((x) => x === 0) ? hexOf(w.subarray(12)) : undefined;
  };
  const delay = uintOf(wordAt(data, 5)!);
  const parts = [addr(0), addr(1), addr(2), addr(3), addr(4)];
  if (parts.some((p) => p === undefined) || delay >= U40_LIMIT) return refusal("evm/field-malformed");
  const config: ChannelConfig = {
    payer: parts[0]!,
    payerAuthorizer: parts[1]!,
    receiver: parts[2]!,
    receiverAuthorizer: parts[3]!,
    token: parts[4]!,
    withdrawDelay: Number(delay),
    salt: hexOf(wordAt(data, 6)!),
  };
  const id = batchChannelId(chainId, config);
  if (isRefusal(id)) return id;
  if (!sameBytes(id, log.topics[1])) return refusal("evm/channel-id-mismatch");
  return { channelId: id, config };
}

// ── shared types ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A request to the buyer's signer. */
export type SigningRequest =
  | { kind: "eip712"; typedData: Eip712Request | ReceiveTypedData | Permit2TypedData }
  | { kind: "solana-message"; message: Uint8Array<ArrayBuffer> }
  | { kind: "ed25519-raw"; message: Uint8Array<ArrayBuffer>; signer: string };

/**
 * Several signing requests, signed in order. `complete` takes one signature per request: `0x` hex for `eip712`,
 * base58 for `solana-message` and `ed25519-raw`.
 */
export interface BatchUnsigned {
  requests: readonly SigningRequest[];
  complete(signatures: readonly string[]): BatchPaymentPayload | Refusal;
}

export interface ChannelMembers {
  channel: {
    kind(p: BatchPaymentPayload): "open" | "within" | "close" | Refusal;
    /** The payment's channel; a payment `kind` refuses is refused with `kind`'s code, as every `channel.ref` does. */
    ref(p: BatchPaymentPayload): Promise<{ network: string; channel: string } | Refusal>;
    boundWithin(p: unknown): Promise<AtrHash | Refusal>;
    until(p: BatchPaymentPayload): number | undefined;
  };
}

export interface BatchEvmOpen extends X402Choice {
  payerAuthorizer: Hex;
  deposit: bigint;
  /**
   * 32 bytes the caller draws at random: the deposit authorization's salt (ERC-3009) or the deposit permit's nonce
   * (Permit2); under an option in the scheme's refund-authorizer mode, where H is that salt or nonce, the entropy the
   * channel salt packs.
   */
  authSalt: Hex;
}

export interface BatchSvmOpen {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  payer: string;
  payerAuthorizer: string;
  deposit: bigint;
  salt: bigint;
  openSlot: bigint;
  tokenProgram: string;
  recentBlockhash: string;
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
}

export interface BatchWithin {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  /** Exactly as sent at the opening. */
  channelConfig: Json;
  maxClaimableAmount: bigint;
  /**
   * A refund. EVM: its amount, absent for a full refund. SVM: `{}`, a full refund carrying the voucher for
   * `maxClaimableAmount`, the server's accepted cumulative amount, and, with `recentBlockhash`, a payer-signed
   * `request_close` built here.
   */
  refund?: { amount?: bigint };
  /**
   * SVM refund: the blockhash of its `request_close`. Given, the refund carries that transaction, which x402 sends
   * only on a retry after `invalid_batch_settlement_svm_receiver_binding_unavailable`.
   */
  recentBlockhash?: string;
  /** SVM refund's `request_close`: the Compute Budget values, 200 000 units and 1 microlamport when absent. */
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
}

const EVM_ID = "x402/batch-settlement/eip155" as const;
const SVM_ID = "x402/batch-settlement/solana" as const;
const CF_ID = "x402/batch-settlement/cloudflare" as const;
type BatchPairingId = typeof EVM_ID | typeof SVM_ID | typeof CF_ID;

const MIN_DELAY = 900;
const MAX_DELAY = 2_592_000;
const MAX_MEMO = 256;
const MAX_SIGNATURE_HEX = 2 + 2 * MAX_SIGNATURE_BYTES;

function isDelay(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= MIN_DELAY && (v as number) <= MAX_DELAY;
}

function nonZeroAddress(v: unknown): v is Hex {
  return isAddress(v) && !/^0x0{40}$/.test(v);
}

/**
 * The refund authorizer of an option in the scheme's refund-authorizer mode, lowercase, or undefined: the mode is an
 * option whose `extra.voucherManager` is `"facilitator"` and whose `extra.refundAuthorizer` is an address that is not the
 * zero address, as the stock client marks it (`@x402/evm` 2.31.0 `buildChannelConfig`,
 * `dist/esm/chunk-AEYKXGQA.mjs:238-239`), and the stock server announces it (`batch-settlement/server/index.mjs:2420-2421`).
 * In that mode the channel salt is packed from entropy and the refund authorizer, and H is the deposit authorization's
 * salt (ERC-3009) or the deposit permit's nonce (Permit2).
 */
function refundAuthorizerOf(option: unknown): Hex | undefined {
  if (!isObject(option) || !isObject(option["extra"])) return undefined;
  const extra = option["extra"];
  const ra = extra["refundAuthorizer"];
  return extra["voucherManager"] === "facilitator" && nonZeroAddress(ra) ? (ra.toLowerCase() as Hex) : undefined;
}

/**
 * The channel salt of the refund-authorizer mode, as the stock client packs it (`packRefundAuthorizerSalt`,
 * `@x402/evm` 2.31.0 `dist/esm/chunk-7DJ4WEQ5.mjs:218-223`): the entropy's first 12 bytes, or, where those are all
 * zero, its last 12, then the refund authorizer's 20 bytes.
 */
function packedSalt(entropy: Hex, refundAuthorizer: Hex): Hex {
  const e = bytesOf(entropy)!;
  const high = e.subarray(0, 12);
  return hexOf(concat([high.every((b) => b === 0) ? e.subarray(20, 32) : high, bytesOf(refundAuthorizer)!]));
}

/** Whether a channel salt ends in the refund authorizer's 20 bytes, as the mode packs it. */
function packs(salt: unknown, refundAuthorizer: Hex): boolean {
  return typeof salt === "string" && isHash32(salt) && same(`0x${salt.slice(26)}`, refundAuthorizer);
}

/**
 * A channel configuration the channel contract's `deposit` takes: a payer, receiver, receiver authorizer and token
 * that are not the zero address, else it reverts `InvalidChannel`, and a withdrawal delay from 900 to 2,592,000
 * seconds, else `WithdrawDelayOutOfRange`. A zero payer authorizer it takes: the payer then signs the vouchers.
 */
function isDepositConfig(c: unknown): c is ChannelConfig {
  return (
    isChannelConfig(c) &&
    [c.payer, c.receiver, c.receiverAuthorizer, c.token].every(nonZeroAddress) &&
    isDelay(c.withdrawDelay)
  );
}

/**
 * The batch-settlement pairing an option names, or undefined: each of the three pairings' option filter (`FILTER`)
 * serves the options this names for it that its `build` can pay. A Solana option names `extra.receiverAuthorizer` and
 * client voucher signing (`extra.voucherSigner` absent or `"client"`), and its `extra.withdrawDelay` is at least a
 * `maxTimeoutSeconds` that is a number. A `maxTimeoutSeconds` of any other type is never converted to compare: the
 * option is named, and the pairing's filter refuses it `x402/option-malformed`, so its `read` does not offer it and the
 * root `pairingOf` names no pairing for it.
 */
function batchIdOf(option: PaymentRequirements): BatchPairingId | undefined {
  if (!isObject(option) || option.scheme !== "batch-settlement" || !isObject(option.extra)) return undefined;
  const extra = option.extra;
  const flow = extra["paymentFlow"];
  if (chainIdOf(option.network) !== undefined) {
    const method = extra["assetTransferMethod"];
    if (!isAddress(option.asset) || !isAddress(option.payTo) || !nonZeroAddress(extra["receiverAuthorizer"])) return undefined;
    if (!isDelay(extra["withdrawDelay"])) return undefined;
    if (typeof extra["name"] !== "string" || extra["name"] === "" || typeof extra["version"] !== "string" || extra["version"] === "") {
      return undefined;
    }
    if (method !== undefined && method !== "eip3009" && method !== "permit2") return undefined;
    if (flow !== undefined && flow !== "authorization") return undefined;
    return EVM_ID;
  }
  if (isSolanaNetwork(option.network)) {
    if (!isKey(option.asset) || !isKey(option.payTo) || !isKey(extra["feePayer"]) || !isKey(extra["receiverAuthorizer"])) {
      return undefined;
    }
    const signer = extra["voucherSigner"];
    if (signer !== undefined && signer !== "client") return undefined;
    if (extra["tokenProgram"] !== TOKEN && extra["tokenProgram"] !== TOKEN_2022) return undefined;
    const delay = extra["withdrawDelay"];
    const timeout: unknown = option.maxTimeoutSeconds;
    if (!isDelay(delay) || (typeof timeout === "number" && delay < timeout)) return undefined;
    if (flow !== undefined && flow !== "authorization") return undefined;
    const memo = extra["memo"];
    if (memo !== undefined && (typeof memo !== "string" || new TextEncoder().encode(memo).length > MAX_MEMO)) return undefined;
    return SVM_ID;
  }
  if (option.network === "cloudflare:402") {
    if (option.payTo !== "merchant" || typeof option.asset !== "string" || !/^[A-Z]{3}$/.test(option.asset)) return undefined;
    if (extra["version"] === undefined) return undefined;
    return CF_ID;
  }
  return undefined;
}

/**
 * True when the amount is `"0"` or a positive amount (`isAmount`) below 2^128, and the timeout a positive safe integer.
 * The EVM and Solana batch-settlement schemes take a zero price: their facilitator validates `amount` as a
 * non-negative base-10 integer string. On EVM a zero price opens no channel: `evmBuild` refuses an opening under it.
 */
function payable(o: PaymentRequirements): boolean {
  return (
    (o.amount === "0" || isAmount(o.amount)) &&
    DECIMAL.test(o.amount) &&
    BigInt(o.amount) < U128_LIMIT &&
    isTimeoutSeconds(o.maxTimeoutSeconds)
  );
}

/**
 * What the EVM `build` can pay: `payable`, and a `payTo` and asset that are not the zero address, since the channel
 * contract's `deposit` refuses a configuration whose receiver or token is, and an `extra.refundAuthorizer` that is absent
 * or an address, which the stock client reads as one (`refundAuthorizerOf`).
 */
function evmPayable(o: PaymentRequirements): boolean {
  const ra = o.extra?.["refundAuthorizer"];
  return payable(o) && nonZeroAddress(o.payTo) && nonZeroAddress(o.asset) && (ra === undefined || isAddress(ra));
}

/** What the Solana `build` can pay: `payable`, with the amount below 2^64, the voucher's `u64`. */
function svmPayable(o: PaymentRequirements): boolean {
  return payable(o) && BigInt(o.amount) < U64_LIMIT;
}

const isId = (id: BatchPairingId) => (o: PaymentRequirements): boolean => batchIdOf(o) === id;

/**
 * What the Cloudflare pairing serves: an option whose amount is positive (`isAmount`) and whose timeout is a positive
 * safe integer.
 */
function cfPayable(o: PaymentRequirements): boolean {
  return isAmount(o.amount) && isTimeoutSeconds(o.maxTimeoutSeconds);
}

/**
 * Each pairing's option filter, which its `advertise`, `read`, `build`, `buildWithin`, `bound`, `reference` and channel
 * reads apply: an option the pairing names, refused `x402/option-malformed` where its `build` cannot pay it or, on
 * Cloudflare, where its `amount` is not a positive amount or its `maxTimeoutSeconds` not a positive safe integer. The
 * EVM filter takes amount `"0"`, which `buildWithin` pays and the opening's `build` refuses.
 */
const FILTER: Readonly<Record<BatchPairingId, OptionFilter>> = {
  [EVM_ID]: filterOf(isId(EVM_ID), evmPayable),
  [SVM_ID]: svmOptionFilter(filterOf(isId(SVM_ID), svmPayable)),
  [CF_ID]: filterOf(isId(CF_ID), cfPayable),
};

function payloadOf(p: unknown, id: BatchPairingId): { accepted: PaymentRequirements; payload: Record<string, unknown> } | Refusal {
  if (!isObject(p) || p["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = acceptedBy(p["accepted"], FILTER[id]);
  if (isRefusal(accepted)) return accepted;
  const payload = p["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  return { accepted, payload };
}

function isHexSignature(s: unknown): s is Hex {
  return typeof s === "string" && s.length <= MAX_SIGNATURE_HEX && /^0x(?:[0-9a-fA-F]{2})+$/.test(s);
}

// ── EVM pairing ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The EVM channel's id from a payment's config, which must equal its voucher's channel id. A config the channel
 * contract's `deposit` refuses is `x402/payload-malformed`.
 */
async function evmRef(p: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const x = payloadOf(p, EVM_ID);
  if (isRefusal(x)) return x;
  const config = x.payload["channelConfig"];
  if (!isDepositConfig(config)) return refusal("x402/payload-malformed");
  const voucher = x.payload["voucher"];
  if (!isObject(voucher) || typeof voucher["channelId"] !== "string") return refusal("x402/payload-malformed");
  const id = batchChannelId(chainIdOf(x.accepted.network)!, config);
  if (isRefusal(id)) return id;
  if (!sameBytes(id, voucher["channelId"])) return refusal("x402/channel-id-mismatch");
  return { network: x.accepted.network, channel: id.toLowerCase() };
}

/** `channel.ref`: what `evmKind` refuses, with its code, then the channel id (`evmRef`). */
async function evmChannelRef(p: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const k = evmKind(p as BatchPaymentPayload);
  return isRefusal(k) ? k : evmRef(p);
}

/**
 * A deposit is the opening and a voucher is within. A refund with no `amount` is the close; one with an `amount` is
 * within, where that amount is a positive decimal below 2^128, as the channel contract's `refund` and
 * `refundWithSignature` take a `uint128` and refuse 0. Any other amount is `x402/payload-malformed`. The payment is
 * held to the pairing's filter first (`payloadOf`), and its payload read by `evmPayloadKind`.
 */
function evmKind(p: BatchPaymentPayload): "open" | "within" | "close" | Refusal {
  const x = payloadOf(p, EVM_ID);
  return isRefusal(x) ? x : evmPayloadKind(x.payload);
}

/** `evmKind`'s read of the payload, which reads no option; `broadcaster` makes it too. */
function evmPayloadKind(payload: Record<string, unknown>): "open" | "within" | "close" | Refusal {
  const t = payload["type"];
  if (t === "deposit") return "open";
  if (t === "voucher") return "within";
  if (t === "refund") {
    const amount = payload["amount"];
    if (amount === undefined) return "close";
    const a = decimalBelow(amount, U128_LIMIT);
    return a === undefined || a === 0n ? refusal("x402/payload-malformed") : "within";
  }
  return refusal("x402/channel-kind-unknown");
}

/**
 * The opening's two authorizations: the deposit's token authorization, then the voucher. A `from` or `payerAuthorizer`
 * that is not an address string, an `authSalt` that is not a string of `0x` and 64 hex digits, or a `deposit` or `now`
 * out of range is `x402/option-malformed`, as is a `from` that is the zero address: the channel contract's `deposit`
 * refuses a configuration whose payer is. The option filter refuses an option whose `payTo` or asset is. H is checked
 * first, then the form of those members, then the choice's document and option, then an option amount of `"0"`, then
 * the channel configuration they make with the option.
 *
 * An option whose amount is `"0"` is `x402/option-malformed` here, though the filter takes it. On the channel a deposit
 * opens, `totalClaimed` and the server's `chargedCumulativeAmount` are 0: the scheme's server requires the opening
 * voucher's `maxClaimableAmount` to equal `chargedCumulativeAmount + amount`, which is 0, and its facilitator ("Not
 * below claimed") requires it to be strictly greater than `totalClaimed`. So a zero price is paid by a later voucher
 * (`buildWithin`), never by an opening.
 *
 * The channel salt is H, and `authSalt` the deposit authorization's salt (ERC-3009) or the permit's nonce (Permit2).
 * Under an option in the refund-authorizer mode (`refundAuthorizerOf`) H is the deposit authorization's salt, or the
 * permit's nonce, and the channel salt is packed from `authSalt` as the entropy and the option's refund authorizer
 * (`packedSalt`), as the stock client packs it; so `authSalt`, drawn at random by the caller, makes each opening a new
 * channel in either mode.
 */
async function evmBuild(c: BatchEvmOpen, h: AtrHash): Promise<BatchUnsigned | Refusal> {
  const hash = normalHash(h);
  if (hash === null) return refusal("x402/option-malformed");
  if (!isObject(c)) return refusal("x402/not-v2");
  if (!isAddress(c.from) || !isAddress(c.payerAuthorizer) || !isHash32(c.authSalt)) {
    return refusal("x402/option-malformed");
  }
  if (typeof c.deposit !== "bigint" || c.deposit <= 0n || c.deposit >= U128_LIMIT) return refusal("x402/option-malformed");
  if (!Number.isSafeInteger(c.now) || c.now < 0) return refusal("x402/option-malformed");
  const ok = chosen(c.required, c.accepted, FILTER[EVM_ID]);
  if (ok !== true) return ok;
  if (c.accepted.amount === "0") return refusal("x402/option-malformed");
  const { accepted, required } = c;
  const extra = accepted.extra!;
  const chainId = chainIdOf(accepted.network)!;
  const ra = refundAuthorizerOf(accepted);
  const salt = ra === undefined ? hash : packedSalt(c.authSalt, ra);
  const authSalt = ra === undefined ? c.authSalt : hash;
  const config: ChannelConfig = {
    payer: c.from,
    payerAuthorizer: c.payerAuthorizer,
    receiver: accepted.payTo as Hex,
    receiverAuthorizer: extra["receiverAuthorizer"] as Hex,
    token: accepted.asset as Hex,
    withdrawDelay: extra["withdrawDelay"] as number,
    salt,
  };
  if (!isDepositConfig(config)) return refusal("x402/option-malformed");
  const channelId = batchChannelId(chainId, config);
  if (isRefusal(channelId)) return channelId;
  const deadline = BigInt(c.now) + BigInt(accepted.maxTimeoutSeconds);
  const permit2 = extra["assetTransferMethod"] === "permit2";
  let tokenAuth: ReceiveTypedData | Permit2TypedData | Refusal;
  if (permit2) {
    tokenAuth = permit2TypedData({
      chainId,
      permitted: { token: config.token, amount: c.deposit },
      spender: PERMIT2_DEPOSIT_COLLECTOR,
      nonce: BigInt(authSalt),
      deadline,
      witness: { type: "DepositWitness", fields: [{ name: "channelId", type: "bytes32" }], value: { channelId } },
    });
  } else {
    const nonce = erc3009DepositNonce(channelId, authSalt);
    if (isRefusal(nonce)) return nonce;
    tokenAuth = receiveTypedData({
      network: accepted.network as Eip155,
      asset: config.token,
      name: extra["name"] as string,
      version: extra["version"] as string,
      from: c.from,
      to: ERC3009_DEPOSIT_COLLECTOR,
      value: c.deposit.toString(),
      validAfter: 0n,
      validBefore: deadline,
      nonce,
    });
  }
  if (isRefusal(tokenAuth)) return tokenAuth;
  const amount = BigInt(accepted.amount);
  const requests: SigningRequest[] = [
    { kind: "eip712", typedData: tokenAuth },
    { kind: "eip712", typedData: voucherRequest(chainId, channelId, amount) },
  ];
  const channelConfig = { ...config } as unknown as Json;
  return {
    requests,
    complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
      const [s1, s2] = signatures;
      if (signatures.length !== 2 || !isHexSignature(s1) || !isHexSignature(s2)) return refusal("x402/signature-malformed");
      const authorization = permit2
        ? {
            permit2Authorization: {
              from: c.from,
              permitted: { token: config.token, amount: c.deposit.toString() },
              spender: PERMIT2_DEPOSIT_COLLECTOR,
              nonce: BigInt(authSalt).toString(),
              deadline: deadline.toString(),
              witness: { channelId },
              signature: s1,
            },
          }
        : { erc3009Authorization: { validAfter: "0", validBefore: deadline.toString(), salt: authSalt, signature: s1 } };
      return paymentWith(required, accepted, {
          type: "deposit",
          channelConfig,
          voucher: { channelId, maxClaimableAmount: amount.toString(), signature: s2 },
          deposit: { amount: c.deposit.toString(), authorization },
        });
    },
  };
}

/**
 * A later voucher, or a refund, for a channel opened under `h`. A `channelConfig` the channel contract's `deposit`
 * refuses is `x402/payload-malformed`. Its salt must be H, else `x402/channel-id-mismatch`; under an option in the
 * refund-authorizer mode, where H is in the opening's deposit authorization and in no later payment, its salt must end
 * in the option's refund authorizer instead, else the same code.
 */
async function evmBuildWithin(w: BatchWithin, h: AtrHash): Promise<BatchUnsigned | Refusal> {
  if (!isObject(w)) return refusal("x402/not-v2");
  const ok = chosen(w.required, w.accepted, FILTER[EVM_ID]);
  if (ok !== true) return ok;
  const config = w.channelConfig;
  if (!isDepositConfig(config)) return refusal("x402/payload-malformed");
  const ra = refundAuthorizerOf(w.accepted);
  if (ra === undefined ? normalHash(config.salt) !== normalHash(h) : !packs(config.salt, ra)) return refusal("x402/channel-id-mismatch");
  if (typeof w.maxClaimableAmount !== "bigint" || w.maxClaimableAmount < 0n || w.maxClaimableAmount >= U128_LIMIT) {
    return refusal("x402/option-malformed");
  }
  const refundAmount = w.refund?.amount;
  if (refundAmount !== undefined && (typeof refundAmount !== "bigint" || refundAmount <= 0n || refundAmount >= U128_LIMIT)) {
    return refusal("x402/option-malformed");
  }
  const chainId = chainIdOf(w.accepted.network)!;
  const channelId = batchChannelId(chainId, config);
  if (isRefusal(channelId)) return channelId;
  const { accepted, required } = w;
  return {
    requests: [{ kind: "eip712", typedData: voucherRequest(chainId, channelId, w.maxClaimableAmount) }],
    complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
      const [s] = signatures;
      if (signatures.length !== 1 || !isHexSignature(s)) return refusal("x402/signature-malformed");
      const voucher = { channelId, maxClaimableAmount: w.maxClaimableAmount.toString(), signature: s };
      const payload: BatchPaymentPayload["payload"] =
        w.refund === undefined
          ? { type: "voucher", channelConfig: w.channelConfig, voucher }
          : {
              type: "refund",
              channelConfig: w.channelConfig,
              voucher,
              ...(refundAmount !== undefined ? { amount: refundAmount.toString() } : {}),
            };
      return paymentWith(required, accepted, payload);
    },
  };
}

/**
 * The opening's deposit: its amount, a positive decimal below 2^128, as the channel contract's `deposit` takes a
 * `uint128` and refuses 0, and its authorization, exactly one of the EIP-3009 and Permit2 forms. The authorization's
 * time bound, the EIP-3009 `validBefore` or the Permit2 `deadline`, is a decimal below 2^256, the `uint256` the deposit
 * collectors decode it as, and `settleBy` is its value.
 */
function depositOf(payload: Record<string, unknown>) {
  const deposit = payload["deposit"];
  if (!isObject(deposit)) return refusal("x402/payload-malformed");
  const amount = decimalBelow(deposit["amount"], U128_LIMIT);
  if (amount === undefined || amount === 0n) return refusal("x402/payload-malformed");
  const auth = deposit["authorization"];
  if (!isObject(auth)) return refusal("x402/deposit-authorization");
  const e = auth["erc3009Authorization"];
  const p = auth["permit2Authorization"];
  if ((e === undefined) === (p === undefined)) return refusal("x402/deposit-authorization");
  if (e !== undefined) {
    if (!isObject(e)) return refusal("x402/payload-malformed");
    const validBefore = decimalBelow(e["validBefore"], U256_LIMIT);
    if (validBefore === undefined || !isHash32(e["salt"])) return refusal("x402/payload-malformed");
    return { amount, method: "eip3009" as const, settleBy: validBefore, authSalt: e["salt"] as Hex };
  }
  const deadline = isObject(p) ? decimalBelow(p["deadline"], U256_LIMIT) : undefined;
  const nonce = isObject(p) ? decimalBelow(p["nonce"], U256_LIMIT) : undefined;
  if (deadline === undefined || nonce === undefined) return refusal("x402/payload-malformed");
  return { amount, method: "permit2" as const, settleBy: deadline, nonce: hexOf(uintWord(nonce)) };
}

/**
 * The opening's `salt`, once its config hashes to the voucher's channel id. No signature is verified here. A config
 * the channel contract's `deposit` refuses, or a deposit amount that is not a positive decimal below 2^128, as that
 * `deposit` takes a `uint128` and refuses 0, is `x402/payload-malformed`, as `reference` answers it. Under an accepted
 * option in the refund-authorizer mode (`refundAuthorizerOf`) H is the deposit authorization's salt, or the deposit
 * permit's nonce as a 32-byte word, and a channel salt that does not end in the option's refund authorizer is
 * `x402/channel-id-mismatch`: that channel is not the mode's.
 */
async function evmBound(presented: unknown): Promise<AtrHash | Refusal> {
  const x = payloadOf(presented, EVM_ID);
  if (isRefusal(x)) return x;
  if (x.payload["type"] !== "deposit") return refusal("x402/not-an-opening");
  if (!isDepositConfig(x.payload["channelConfig"])) return refusal("x402/payload-malformed");
  const d = depositOf(x.payload);
  if (isRefusal(d)) return d;
  const r = await evmRef(presented);
  if (isRefusal(r)) return r;
  const salt = (x.payload["channelConfig"] as ChannelConfig).salt;
  const ra = refundAuthorizerOf(x.accepted);
  if (ra === undefined) return normalHash(salt)!;
  if (!packs(salt, ra)) return refusal("x402/channel-id-mismatch");
  return normalHash(d.method === "eip3009" ? d.authSalt : d.nonce)!;
}

/**
 * A within payment's `salt`, once its config hashes to its voucher's channel id. Under an accepted option in the
 * refund-authorizer mode a later payment carries no H, which only the opening's deposit authorization carries:
 * `x402/not-bound-within`.
 */
async function evmBoundWithin(presented: unknown): Promise<AtrHash | Refusal> {
  const r = await evmRef(presented);
  if (isRefusal(r)) return r;
  const x = payloadOf(presented, EVM_ID) as { accepted: PaymentRequirements; payload: Record<string, unknown> };
  if (refundAuthorizerOf(x.accepted) !== undefined) return refusal("x402/not-bound-within");
  return normalHash((x.payload["channelConfig"] as ChannelConfig).salt)!;
}

/**
 * The opening's read keys: the channel's id, payer, receiver, token and salt, the deposit authorization's nonce
 * (keccak256(channelId, salt) on ERC-3009, the permit's nonce on Permit2), its `validBefore` or `deadline`, in decimal,
 * below 2^256, and the deposit's amount. With them, the payee of `option`, the issued option the payment answers
 * (`x402Payee`), whose refusal comes after the payment's; then a presented `accepted` that is not, by RFC 8785 form,
 * that option is `x402/accepted-not-option`.
 */
async function evmReference(presented: unknown, option: PaymentRequirements): Promise<BatchEvmRef | Refusal> {
  const ref = withPayee(await evmKeys(presented), x402Payee(option));
  if (isRefusal(ref)) return ref;
  return sameJson((presented as { accepted: unknown }).accepted, option) ? ref : refusal("x402/accepted-not-option");
}

async function evmKeys(presented: unknown): Promise<Omit<BatchEvmRef, "payee"> | Refusal> {
  const h = await evmBound(presented);
  if (isRefusal(h)) return h;
  const x = payloadOf(presented, EVM_ID) as { accepted: PaymentRequirements; payload: Record<string, unknown> };
  const config = x.payload["channelConfig"] as ChannelConfig;
  const d = depositOf(x.payload) as Exclude<ReturnType<typeof depositOf>, Refusal>;
  const id = ((await evmRef(presented)) as { channel: string }).channel.toLowerCase() as Hex;
  const nonce = d.method === "eip3009" ? erc3009DepositNonce(id, d.authSalt) : d.nonce;
  if (isRefusal(nonce)) return nonce;
  return {
    network: x.accepted.network as Eip155,
    h,
    scheme: d.method,
    asset: config.token.toLowerCase() as Hex,
    payer: config.payer.toLowerCase() as Hex,
    channel: id,
    payerAuthorizer: config.payerAuthorizer.toLowerCase() as Hex,
    receiver: config.receiver.toLowerCase() as Hex,
    receiverAuthorizer: config.receiverAuthorizer.toLowerCase() as Hex,
    withdrawDelay: config.withdrawDelay,
    salt: config.salt.toLowerCase() as Hex,
    nonce: nonce.toLowerCase() as Hex,
    settleBy: d.settleBy.toString(),
    amount: d.amount.toString(),
    ...(refundAuthorizerOf(x.accepted) === undefined ? {} : { refundAuthorizer: refundAuthorizerOf(x.accepted)! }),
  };
}

/** The channel config a batch reference holds, its token the reference's `asset`. */
function refConfig(r: BatchEvmRef): ChannelConfig {
  return {
    payer: r.payer,
    payerAuthorizer: r.payerAuthorizer,
    receiver: r.receiver,
    receiverAuthorizer: r.receiverAuthorizer,
    token: r.asset,
    withdrawDelay: r.withdrawDelay,
    salt: r.salt,
  };
}

/**
 * A batch reference: its members of their forms, on an `eip155:<chain id>` network, and its config whole, which must
 * hash to its channel id, so that the config the read compares is the one the channel id a landed log names commits to.
 * Its salt is H; in the refund-authorizer mode its salt ends in its refund authorizer, and its nonce is H's: on ERC-3009
 * keccak256(abi.encode(channelId, H)), on Permit2 H.
 */
function isBatchRef(r: unknown): r is BatchEvmRef {
  if (
    !(
      isObject(r) &&
      (r["scheme"] === "eip3009" || r["scheme"] === "permit2") &&
      [r["asset"], r["payer"], r["payerAuthorizer"], r["receiver"], r["receiverAuthorizer"]].every(isAddress) &&
      [r["channel"], r["salt"], r["nonce"]].every((x) => normalHash(x) !== null) &&
      typeof r["payee"] === "string" &&
      decimalBelow(r["settleBy"], U256_LIMIT) !== undefined &&
      decimalBelow(r["amount"], U128_LIMIT) !== undefined
    )
  ) {
    return false;
  }
  const chainId = chainIdOf(r["network"]);
  if (chainId === undefined) return false;
  const id = batchChannelId(chainId, refConfig(r as unknown as BatchEvmRef));
  if (isRefusal(id) || !same(id, r["channel"])) return false;
  const h = normalHash(r["h"]);
  if (h === null) return false;
  const ra = r["refundAuthorizer"];
  if (ra === undefined) return same(r["salt"], h);
  if (!nonZeroAddress(ra) || !packs(r["salt"], ra)) return false;
  const nonce = r["scheme"] === "eip3009" ? erc3009DepositNonce(id, h) : h;
  return !isRefusal(nonce) && same(nonce, r["nonce"]);
}

/** A `Deposited` log's amount, its first data word, below 2^128; undefined where the log holds no such word. */
function depositedAmount(l: EvmLog): bigint | undefined {
  const data = bytesOf(l.data);
  const w = data === undefined || data.length !== 64 ? undefined : wordAt(data, 0);
  const a = w === undefined ? undefined : uintOf(w);
  return a === undefined || a >= U128_LIMIT ? undefined : a;
}

/** The channel config whose last word, `salt`, is `salt`, inline in a call's input: its payer and receiver. */
function configBefore(input: Uint8Array, salt: Hex): { payer: Hex; receiver: Hex } | undefined {
  const w = bytesOf(salt);
  if (w === undefined || w.length !== 32) return undefined;
  next: for (let i = 6 * 32; i + 32 <= input.length; i++) {
    for (let j = 0; j < 32; j++) if (input[i + j] !== w[j]) continue next;
    const payer = topicAddress(hexOfWord(input.subarray(i - 6 * 32, i - 5 * 32)));
    const receiver = topicAddress(hexOfWord(input.subarray(i - 4 * 32, i - 3 * 32)));
    if (payer !== undefined && receiver !== undefined) return { payer, receiver };
  }
  return undefined;
}

/**
 * The channel contract's logs in a transaction that carry H: each `ChannelCreated` whose config's salt is H, of a
 * channel other than the reference's, an opening of another channel carrying H, with the `Deposited` of that channel
 * after it as what it moved; and each `Deposited` into the reference's channel. A deposit into the reference's channel
 * is the opening where the transaction consumed the deposit authorization's nonce, the token's
 * `AuthorizationUsed(payer, nonce)` on ERC-3009, or on Permit2 the payer's bit set at its block and unset before with
 * the nonce in its input; any other deposit into the channel is a later credential of it, an act of another kind. The
 * deposit counts where the channel's `receiver` is the option's payee; what moved is the deposit's amount to that
 * receiver, by its `Deposited` log. The opening of another channel is its payer's only with the payer's transfer of its
 * amount (`payerDeposited`), since the channel contract takes a deposit through any collector, and the two the scheme
 * names move only what the payer signed; without it the act names no signer. A log of the contract the read cannot
 * decode holds the search.
 */
async function batchClassify(ref: BatchEvmRef, view: TxView, reader: EvmReader): Promise<Classified> {
  const { receipt } = view;
  if (receipt.status === 0) {
    const tx = await view.tx();
    if (tx === null) return { seen: [] };
    if ("unreadable" in tx) return tx;
    const input = bytesOf(tx.input);
    if (input === undefined) return { unreadable: "unparseable" };
    const c = configBefore(input, ref.salt) ?? (ref.refundAuthorizer === undefined ? undefined : configBefore(input, ref.h));
    if (c === undefined) return { seen: [] };
    return {
      seen: [{ result: "failed", consumed: false, carries: true, party: partyOf(c.payer, ref.payer, ref.payee), kind: "same", account: same(c.receiver, ref.payee) ? "payee" : "other", signer: c.payer }],
    };
  }
  const chainId = chainIdOf(ref.network)!;
  const logs = receipt.logs;
  const ofContract = (l: EvmLog, topic: Hex) => same(l.address, BATCH_SETTLEMENT) && same(l.topics[0], topic);
  // The reference's channel as landed: its `ChannelCreated` in this transaction, where the deposit opened it, its data
  // hashing to the id in its topic; else the reference's config, which the reference's check holds to that id, the id
  // the landed `Deposited` names.
  let own: ChannelConfig = refConfig(ref);
  for (const l of logs) {
    if (!ofContract(l, CHANNEL_CREATED_TOPIC) || !same(l.topics[1], ref.channel)) continue;
    const c = batchChannelCreated(l, chainId);
    if (isRefusal(c)) return { undecodable: true };
    own = c.config;
  }
  const seen: Exclude<Classified, { undecodable: true } | { unreadable: UnreadableReason }>["seen"][number][] = [];
  for (const [i, l] of logs.entries()) {
    if (ofContract(l, CHANNEL_CREATED_TOPIC)) {
      const c = batchChannelCreated(l, chainId);
      if (isRefusal(c)) return { undecodable: true };
      if (!same(c.config.salt, ref.h) || same(c.channelId, ref.channel)) continue;
      const at = logs.findIndex((d, j) => j > i && ofContract(d, DEPOSITED_TOPIC) && same(d.topics[1], c.channelId));
      const amount = at < 0 ? undefined : depositedAmount(logs[at]!);
      if (amount === undefined) return { undecodable: true };
      const signer = payerDeposited(logs, c.config, amount) ? (c.config.payer.toLowerCase() as Hex) : undefined;
      seen.push({
        result: "succeeded",
        consumed: false,
        carries: true,
        party: partyOf(signer, ref.payer, ref.payee),
        kind: "same",
        account: same(c.config.receiver, ref.payee) ? "payee" : "other",
        moved: [movedAt(c.config.token.toLowerCase() as Hex, amount, c.config.receiver.toLowerCase() as Hex, view.hash, at)],
        ...(signer === undefined ? {} : { signer }),
        signed: { channel: c.channelId.toLowerCase(), amount: amount.toString() },
      });
    } else if (ofContract(l, DEPOSITED_TOPIC) && same(l.topics[1], ref.channel)) {
      const amount = depositedAmount(l);
      if (amount === undefined) return { undecodable: true };
      const consumed = await consumedIn(ref, view, reader);
      if (typeof consumed !== "boolean") return consumed;
      seen.push({
        result: "succeeded",
        consumed,
        carries: true,
        party: partyOf(own.payer, ref.payer, ref.payee),
        kind: consumed ? "same" : "other",
        account: same(own.receiver, ref.payee) ? "payee" : "other",
        moved: [movedAt(own.token.toLowerCase() as Hex, amount, own.receiver.toLowerCase() as Hex, view.hash, i)],
        signer: own.payer.toLowerCase() as Hex,
        signed: { channel: ref.channel, amount: amount.toString() },
      });
    }
  }
  return { seen };
}

/**
 * Whether a `ChannelCreated` entry the search found is read further: where its data is the seven words of a config, only
 * where its salt, the seventh, is `salt`, so that the read fetches no receipt of another channel's opening; any other
 * data is read, since a log the read cannot decode holds the search.
 */
function createdMayCarry(e: EvmLog, salt: Hex): boolean {
  const data = bytesOf(e.data);
  if (data === undefined || data.length !== 224) return true;
  return same(hexOf(wordAt(data, 6)!), salt);
}

/** Whether the transaction consumed the deposit authorization's nonce: its use logged by the token, or the payer's bit. */
async function consumedIn(ref: BatchEvmRef, view: TxView, reader: EvmReader): Promise<boolean | { unreadable: UnreadableReason }> {
  const { receipt } = view;
  if (ref.scheme === "eip3009") {
    return receipt.logs.some(
      (l) => same(l.address, ref.asset) && same(l.topics[0], AUTHORIZATION_USED_TOPIC) && same(topicAddress(l.topics[1]), ref.payer) && same(l.topics[2], ref.nonce),
    );
  }
  const tx = await view.tx();
  if (tx === null) return false;
  if ("unreadable" in tx) return tx;
  const input = bytesOf(tx.input);
  if (input === undefined) return { unreadable: "unparseable" };
  if (!inputCarries(input, ref.nonce)) return false;
  const after = await nonceUsed("permit2", PERMIT2, ref.payer, ref.nonce, receipt.blockNumber, reader);
  if (typeof after !== "boolean" || !after) return after;
  return receipt.blockNumber === 0n ? true : nonceUsed("permit2", PERMIT2, ref.payer, ref.nonce, receipt.blockNumber - 1n, reader).then((b) => (typeof b === "boolean" ? !b : b));
}

/**
 * The read of `x402/batch-settlement/eip155`: the single-use value is the deposit authorization's nonce, a digest over
 * the channel id, so its read is no search for H. The channel contract's `ChannelCreated`
 * logs are read whole, each tested by its salt, with the `Deposited` logs of the reference's channel, so every opening
 * carrying H the contract recorded is named; the search is never whole, since no search for H is defined.
 */
const BATCH_EVM_READ: ReadSpec<BatchEvmRef> = {
  coverage: EIP155_X402[EVM_ID].coverage,
  agreementValue: false,
  check: isBatchRef,
  paymentValue: (ref) => ref.nonce,
  value: async (ref, v, reader, block) => nonceUsed(ref.scheme, ref.asset, ref.payer, v, block, reader),
  deadline: (ref) => ({ at: BigInt(ref.settleBy), inclusive: ref.scheme === "eip3009" }),
  search: "open",
  filters: (ref) => [
    { address: BATCH_SETTLEMENT, topics: [CHANNEL_CREATED_TOPIC] },
    { address: BATCH_SETTLEMENT, topics: [DEPOSITED_TOPIC, ref.channel] },
  ],
  entry: (ref, _values, e) => !same(e.topics[0], CHANNEL_CREATED_TOPIC) || createdMayCarry(e, ref.h),
  // The channel contract's `ChannelCreated` or `Deposited` whose topic 1 is the reference's channel id.
  consumers: (ref) => [
    { address: BATCH_SETTLEMENT, topics: [CHANNEL_CREATED_TOPIC, ref.channel] },
    { address: BATCH_SETTLEMENT, topics: [DEPOSITED_TOPIC, ref.channel] },
  ],
  classify: (ref, _values, view, reader) => batchClassify(ref, view, reader),
  presented: (ref) =>
    isObject(ref) && normalHash(ref["channel"]) !== null && typeof ref["amount"] === "string"
      ? { channel: (ref["channel"] as string).toLowerCase(), amount: ref["amount"] }
      : undefined,
  payer: (ref) => ref.payer,
};

/** The opening's settlement, read from what landed, as `read-status` answers it (BATCH_EVM_READ). */
const evmDepositStatus = statusOf(BATCH_EVM_READ);

/**
 * Whether a receipt holds the payer's transfer of a deposit into a channel: a `Transfer` of `amount` emitted by the
 * channel's token from the channel's payer to the ERC-3009 deposit collector or, through Permit2, to the channel contract.
 */
function payerDeposited(logs: readonly EvmLog[], config: ChannelConfig, amount: bigint): boolean {
  return transfersIn(logs).some(
    (t) => same(t.token, config.token) && same(t.from, config.payer) && t.value === amount && (same(t.to, ERC3009_DEPOSIT_COLLECTOR) || same(t.to, BATCH_SETTLEMENT)),
  );
}

/** The selector of the channel contract's `deposit(ChannelConfig, uint128, address, bytes)`. */
const DEPOSIT_SELECTOR = "0x140f1e75" as Hex;

/**
 * The deposit calls in a transaction's input, found at any byte offset by their selector, whose channel config is the
 * seven words `config`, through one of the two deposit collectors: each with its collector and the value its collector
 * data carries first, the authorization's `salt` on the ERC-3009 collector (`abi.encode(validAfter, validBefore, salt,
 * signature)`) and the permit's `nonce` on the Permit2 collector (`abi.encode(nonce, deadline, signature,
 * permitData)`), distinct by the two (`@x402/evm` 2.31.0 `buildErc3009CollectorData` and `buildPermit2CollectorData`,
 * `dist/esm/chunk-W6ON4LG2.mjs:8-31`).
 */
function depositCallsIn(input: Uint8Array, config: Uint8Array): { collector: "eip3009" | "permit2"; value: Hex }[] {
  const out = new Map<string, { collector: "eip3009" | "permit2"; value: Hex }>();
  for (const { args } of callsIn(input, [DEPOSIT_SELECTOR])) {
    if (args.length < 10 * 32 || !sameBytes(hexOf(args.subarray(0, 7 * 32)), hexOf(config))) continue;
    const through = addressOfWord(wordAt(args, 8)!);
    const collector = same(through, ERC3009_DEPOSIT_COLLECTOR) ? "eip3009" : same(through, PERMIT2_DEPOSIT_COLLECTOR) ? "permit2" : undefined;
    const offset = uintOf(wordAt(args, 9)!);
    if (collector === undefined || offset + 32n > BigInt(args.length)) continue;
    const length = uintOf(args.subarray(Number(offset), Number(offset) + 32));
    const data = args.subarray(Number(offset) + 32);
    const w = length > BigInt(data.length) ? undefined : wordAt(data.subarray(0, Number(length)), collector === "eip3009" ? 2 : 0);
    if (w === undefined) continue;
    const value = hexOf(w);
    out.set(`${collector}${value}`, { collector, value });
  }
  return [...out.values()];
}

/** The refusals `recover` gives only where the receipt's block is at or below the reader's `finalized` mark. */
const FINAL_ONLY: ReadonlySet<string> = new Set([
  "evm/no-channel-created",
  "evm/ambiguous",
  "evm/no-payer-deposit",
  "evm/no-deposit-call",
  "evm/no-authorization-use",
  "evm/nonce-not-used",
]);

/**
 * Zero-party: H from the opening a transaction holds. The opening is the one `ChannelCreated` log from the channel
 * contract whose data hashes to its id, with the payer's transfer: the channel's `Deposited` and a `Transfer` of that
 * amount emitted by the channel's token from the channel's payer to the ERC-3009 deposit collector, or through Permit2
 * to the channel contract, so that the deposit is the payer's (the channel contract takes any collector; the two the
 * scheme names move only what the payer signed). H is that channel's salt; under an option in the refund-authorizer
 * mode (`refundAuthorizerOf`), whose channel salt must end in the option's refund authorizer, H is the deposit
 * authorization's salt or the deposit permit's nonce, read from the transaction's one deposit call with that channel's
 * config through a collector of the scheme (`depositCallsIn`), and counted only where the token logged the use of
 * keccak256(abi.encode(channelId, salt)) by the payer, or Permit2 set the payer's bit for that nonce at the receipt's
 * block and not at the block before.
 *
 * A failed read, a reader answer that is neither `null` nor a receipt or a transaction, a receipt holding a log that is
 * not an object with a string `address`, an array of string `topics` and a string `data`, a `ChannelCreated` log from
 * the channel contract that `batchChannelCreated` refuses (data that is not the seven words of a channel config, or
 * whose channel id is not the id in its topic), or an input that is not hex bytes, is `evm/unreadable`, a read to
 * repeat. No receipt or no transaction (`null`) is `evm/not-found`. A reverted transaction is `evm/reverted`; a receipt
 * with no such log is `evm/no-channel-created`, one with more than one `evm/ambiguous`, one without the payer's transfer
 * `evm/no-payer-deposit`; in the refund-authorizer mode, a channel salt that does not end in the refund authorizer or no
 * such deposit call is `evm/no-deposit-call`, more than one `evm/ambiguous`, and an ERC-3009 salt whose use the token did
 * not log `evm/no-authorization-use`, a Permit2 nonce whose bit is not so `evm/nonce-not-used`. Each of these is given
 * only at or below the reader's `finalized` mark, and above it, or where that mark cannot be read, is `evm/not-final`, a
 * read to repeat; the mark is read only for them. An input or reader that is not an object, a reader for another
 * network, or a `tx` that is not a 32-byte hash is `evm/wrong-reader`, with nothing read. At most two calls, and five in
 * the refund-authorizer mode.
 */
async function evmRecover(input: RecoverInput<Eip155, PaymentRequirements>, reader: EvmReader): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("evm/wrong-reader");
  if (normalHash(input.tx) === null) return refusal("evm/wrong-reader");
  const chainId = chainIdOf(input.network);
  if (chainId === undefined) return refusal("evm/network-malformed");
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(input.tx as Hex);
  } catch {
    return refusal("evm/unreadable");
  }
  if (receipt === null) return refusal("evm/not-found");
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return refusal("evm/unreadable");
  if (receipt.status === 0) {
    const read = await failedAt(receipt.blockNumber, "reverted", reader);
    return read.state === "failed" ? refusal("evm/reverted") : refusal("evm/not-final");
  }
  const found = await openingIn(input, receipt, chainId, reader);
  if (isRefusal(found) && FINAL_ONLY.has(found.code) && !(await finalAt(receipt.blockNumber, reader))) return refusal("evm/not-final");
  return found;
}

/** `evmRecover`'s read of a receipt that succeeded: H, or the refusal it is given at or below the final mark. */
async function openingIn(
  input: RecoverInput<Eip155, PaymentRequirements>,
  receipt: EvmReceipt,
  chainId: number,
  reader: EvmReader,
): Promise<AtrHash | Refusal> {
  const logs = receipt.logs;
  const created = logs.filter((l) => same(l.address, BATCH_SETTLEMENT) && sameBytes(l.topics[0], CHANNEL_CREATED_TOPIC));
  if (created.length === 0) return refusal("evm/no-channel-created");
  if (created.length > 1) return refusal("evm/ambiguous");
  const c = batchChannelCreated(created[0]!, chainId);
  if (isRefusal(c)) return refusal("evm/unreadable");
  const { config, channelId } = c;
  const deposited = logs.find((l) => same(l.address, BATCH_SETTLEMENT) && same(l.topics[0], DEPOSITED_TOPIC) && same(l.topics[1], channelId));
  const amount = deposited === undefined ? undefined : depositedAmount(deposited);
  if (amount === undefined || !payerDeposited(logs, config, amount)) return refusal("evm/no-payer-deposit");
  const ra = refundAuthorizerOf(input.option);
  if (ra === undefined) return normalHash(config.salt)!;
  if (!packs(config.salt, ra)) return refusal("evm/no-deposit-call");
  let tx: EvmTransaction | null;
  try {
    tx = await reader.transaction(input.tx as Hex);
  } catch {
    return refusal("evm/unreadable");
  }
  if (tx === null) return refusal("evm/not-found");
  const calldata = isObject(tx) ? bytesOf(tx.input) : undefined;
  if (calldata === undefined) return refusal("evm/unreadable");
  const calls = depositCallsIn(calldata, bytesOf(created[0]!.data)!);
  if (calls.length === 0) return refusal("evm/no-deposit-call");
  if (calls.length > 1) return refusal("evm/ambiguous");
  const { collector, value } = calls[0]!;
  if (collector === "eip3009") {
    const nonce = erc3009DepositNonce(channelId, value) as Hex;
    const used = logs.some(
      (l) => same(l.address, config.token) && same(l.topics[0], AUTHORIZATION_USED_TOPIC) && same(topicAddress(l.topics[1]), config.payer) && same(l.topics[2], nonce),
    );
    return used ? normalHash(value)! : refusal("evm/no-authorization-use");
  }
  const block = receipt.blockNumber;
  const after = await nonceUsed("permit2", PERMIT2, config.payer, value, block, reader);
  if (typeof after !== "boolean") return refusal("evm/unreadable");
  const before = !after || block === 0n ? false : await nonceUsed("permit2", PERMIT2, config.payer, value, block - 1n, reader);
  if (typeof before !== "boolean") return refusal("evm/unreadable");
  return after && !before ? normalHash(value)! : refusal("evm/nonce-not-used");
}

function evmAdvertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(FILTER[EVM_ID])(doc, h, link, offer, agreementUrl);
}

/**
 * The option unchanged, on the EVM and Cloudflare pairings: neither carries the hash inside the option. An option that
 * carries a `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/**
 * The `broadcaster` of a batch-settlement channel: `"payee"`, for a payment within `x402Shape`'s gate whose payload
 * `kind`, the payload read of the pairing's `channel.kind`, takes. A payment of a type `kind` refuses
 * `x402/channel-kind-unknown` gets `x402/not-an-opening`, as `bound` refuses it. `bound` reads a `deposit` alone, so
 * `kind` is the reader of every other type: a payment it refuses for its content, such as a refund whose `amount` the
 * channel contract does not take, gets `kind`'s refusal. A deposit's content is `bound`'s to read. `kind` reads no
 * option, so which option `accepted` is does not change the answer.
 */
function batchBroadcaster(kind: (payload: Record<string, unknown>) => unknown) {
  return broadcastsWithin((presented) => {
    const shape = x402Shape(presented);
    if (isRefusal(shape)) return shape;
    const payload = (presented as { payload: Record<string, unknown> }).payload;
    const k = kind(payload);
    if (!isRefusal(k)) return true;
    if (k.code === "x402/channel-kind-unknown") return refusal("x402/not-an-opening");
    return payload["type"] === "deposit" ? true : k;
  }, "payee");
}

/**
 * `x402/batch-settlement/eip155`. The payee broadcasts (`broadcaster` answers `"payee"` for each payment type
 * `channel.kind` takes): for every payment of the channel: the seller's facilitator executes the deposit's token
 * authorization, redeems vouchers when it claims, and executes a refund; `status` reads them, and `channel.kind`
 * classifies each payment. A payment of any other type gets `x402/not-an-opening`, as `bound` refuses it. `bound` reads
 * a deposit alone, so `channel.kind` reads the rest: a refund whose `amount` is not a positive decimal below 2^128 gets
 * `x402/payload-malformed`, as `channel.kind` refuses it.
 */
export const batchEvm = Object.freeze({
  id: EVM_ID,
  data: EIP155_X402[EVM_ID],
  pattern: Object.freeze({
    pattern: "native-field",
    profile: EVM_ID,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  }) as LcpPattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise: evmAdvertise,
  read: (doc: PaymentRequired): X402Read | Refusal => readFor(FILTER[EVM_ID])(doc),
  build: evmBuild,
  buildWithin: evmBuildWithin,
  bound: evmBound,
  broadcaster: batchBroadcaster(evmPayloadKind),
  reference: evmReference,
  status: evmDepositStatus,
  recover: evmRecover,
  channel: Object.freeze({
    kind: evmKind,
    ref: evmChannelRef,
    boundWithin: evmBoundWithin,
    until: (_p: BatchPaymentPayload): number | undefined => undefined,
  }),
}) satisfies Entry<
  typeof EVM_ID,
  BatchPaymentPayload,
  BatchEvmRef,
  EvmReader,
  X402Forms & {
    choice: BatchEvmOpen;
    unsigned: BatchUnsigned;
    landed: { transaction: Hex };
    network: Eip155;
    query: EvmQuery<BatchEvmRef>;
    answer: StatusAnswer<bigint, EvmMark>;
  }
>;

// ── SVM pairing ──────────────────────────────────────────────────────────────────────────────────────────────────

interface SvmChannelConfig {
  payer: string;
  payerAuthorizer: string;
  receiver: string;
  receiverAuthorizer?: string;
  token: string;
  withdrawDelay: number;
  salt: string;
  openSlot: number;
}

const U64_DECIMAL = /^[0-9]{1,20}$/;
const U64_LIMIT = 1n << 64n;
const U32_LIMIT = 2 ** 32;

/**
 * A Solana channel configuration as the payment-channels program's `open` takes it (solana-foundation/payment-channels
 * 0c07d5751c8972abf6a219570a3f39a72f46f879, the revision x402 751590a2 pins, `instructions/open.rs`): its keys, with a
 * `payerAuthorizer` that is a point on the Ed25519 curve, since `open` refuses an authorized signer off it; a decimal
 * `u64` salt; an `openSlot` that is a safe integer of at least 0; and a `withdrawDelay` that is a positive integer below
 * 2^32, since `grace_period` is a `u32` that `open` refuses as 0. It does not compare the payer with the option's
 * `extra.feePayer`, which `open` also requires to differ: that comparison is the facilitator's.
 */
function isSvmConfig(c: unknown): c is SvmChannelConfig {
  if (!isObject(c)) return false;
  const u64 = (v: unknown) => typeof v === "string" && U64_DECIMAL.test(v) && BigInt(v) < U64_LIMIT;
  const delay = c["withdrawDelay"];
  return (
    isKey(c["payer"]) &&
    isCurveKey(c["payerAuthorizer"]) &&
    isKey(c["receiver"]) &&
    (c["receiverAuthorizer"] === undefined || isKey(c["receiverAuthorizer"])) &&
    isKey(c["token"]) &&
    Number.isInteger(delay) &&
    (delay as number) >= 1 &&
    (delay as number) < U32_LIMIT &&
    u64(c["salt"]) &&
    Number.isSafeInteger(c["openSlot"]) &&
    (c["openSlot"] as number) >= 0
  );
}

/** A payment's decoded transaction, from `deposit.transaction` or a refund's `transaction`, when present. */
function svmTxOf(payload: Record<string, unknown>): SvmTx | undefined | Refusal {
  const deposit = payload["deposit"];
  const b64 = isObject(deposit) ? deposit["transaction"] : payload["transaction"];
  if (b64 === undefined) return undefined;
  const wire = wireOf(b64);
  if (isRefusal(wire)) return wire;
  return decodeSvmTx(wire);
}

/**
 * A voucher is within and a refund is the close. A deposit is the opening where its channel instruction is an `open`,
 * and within where it is a `top_up`; a deposit with no transaction that decodes is `x402/payload-malformed`, and one
 * whose channel instruction does not read gets that refusal. Any other type, and a deposit whose channel instruction is
 * a `request_close`, is `x402/channel-kind-unknown`. The payment is held to the pairing's filter first (`payloadOf`),
 * and its payload read by `svmPayloadKind`.
 */
function svmKind(p: BatchPaymentPayload): "open" | "within" | "close" | Refusal {
  const x = payloadOf(p, SVM_ID);
  return isRefusal(x) ? x : svmPayloadKind(x.payload);
}

/** `svmKind`'s read of the payload, which reads no option; `broadcaster` makes it too. */
function svmPayloadKind(payload: Record<string, unknown>): "open" | "within" | "close" | Refusal {
  const t = payload["type"];
  if (t === "voucher") return "within";
  if (t === "refund") return "close";
  if (t === "deposit") {
    const tx = svmTxOf(payload);
    if (tx === undefined || isRefusal(tx)) return refusal("x402/payload-malformed");
    const ix = channelInstruction(tx);
    if (isRefusal(ix)) return ix;
    if (ix.kind === "open") return "open";
    if (ix.kind === "top_up") return "within";
  }
  return refusal("x402/channel-kind-unknown");
}

/** `channel.ref`: what `svmKind` refuses, with its code, then the channel PDA (`svmRef`). */
async function svmChannelRef(p: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const k = svmKind(p as BatchPaymentPayload);
  return isRefusal(k) ? k : svmRef(p);
}

/**
 * The channel PDA from a payment's config, which must equal its voucher's id and its channel instruction's account. A
 * config that is not one (`isSvmConfig`), such as one whose `payerAuthorizer` is not a point on the Ed25519 curve or
 * whose `withdrawDelay` is not a positive integer below 2^32, is `x402/payload-malformed`.
 */
async function svmRef(p: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const x = payloadOf(p, SVM_ID);
  if (isRefusal(x)) return x;
  const config = x.payload["channelConfig"];
  if (!isSvmConfig(config)) return refusal("x402/payload-malformed");
  const pda = channelPda({
    payer: config.payer,
    payee: x.accepted.extra!["feePayer"] as string,
    mint: config.token,
    signer: config.payerAuthorizer,
    salt: BigInt(config.salt),
    openSlot: BigInt(config.openSlot),
  });
  if (isRefusal(pda)) return pda;
  const voucher = x.payload["voucher"];
  if (voucher !== undefined && (!isObject(voucher) || voucher["channelId"] !== pda)) return refusal("svm/channel-id-mismatch");
  const tx = svmTxOf(x.payload);
  if (isRefusal(tx)) return tx;
  if (tx !== undefined) {
    const ix = channelInstruction(tx);
    if (isRefusal(ix)) return ix;
    if (ix.channel !== pda) return refusal("svm/channel-id-mismatch");
  }
  return { network: x.accepted.network, channel: pda };
}

/** x402's receiver-authorizer binding memo: this prefix, then the base58 key. */
const BINDING_MEMO_PREFIX = "x402:batch-settlement:svm:rcvauth:v1:";
const BINDING_MEMO_PREFIX_BYTES = new TextEncoder().encode(BINDING_MEMO_PREFIX);

function isBindingMemo(data: Uint8Array): boolean {
  return data.length >= BINDING_MEMO_PREFIX_BYTES.length && BINDING_MEMO_PREFIX_BYTES.every((b, i) => data[i] === b);
}

/**
 * The opening's memos: exactly one receiver-authorizer binding memo, whose key is not read, and exactly one other
 * Memo instruction, which carries the ATR hash in LCP string form. Any other count is `svm/memo-count`.
 */
function openingCarrier(tx: SvmTx): { h: AtrHash; memo: string } | Refusal {
  const memos = memoData(tx);
  const others = memos.filter((d) => !isBindingMemo(d));
  if (others.length !== 1 || memos.length !== 2) return refusal("svm/memo-count");
  return memoCarrier(others[0]!);
}

/**
 * Zero-party recovery: the ATR hash in the landed opening's seller memo, beside its binding memo. An opening that landed
 * with an error is `svm/err` or `svm/not-final`, as `svmRecover` reads it. The option is not read; an input that is not
 * an object is `svm/wrong-reader`. One or two calls.
 */
async function svmBatchRecover(
  input: RecoverInput<SolanaNetwork, PaymentRequirements>,
  reader: SvmReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input)) return refusal("svm/wrong-reader");
  const tx = await landedTransaction({ network: input.network, transaction: input.tx }, reader);
  if (isRefusal(tx)) return tx;
  const c = openingCarrier(tx);
  return isRefusal(c) ? c : c.h;
}

/** The opening's memo hash, when its seller memo equals `extra.memo` and the channel instruction is an `open`. */
async function svmOpening(presented: unknown) {
  const x = payloadOf(presented, SVM_ID);
  if (isRefusal(x)) return x;
  if (x.payload["type"] !== "deposit") return refusal("x402/not-an-opening");
  const tx = svmTxOf(x.payload);
  if (tx === undefined) return refusal("x402/payload-malformed");
  if (isRefusal(tx)) return tx;
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const version = versionNotAdmitted(x.accepted.extra, tx, "x402");
  if (version !== null) return version;
  const ix = channelInstruction(tx);
  if (isRefusal(ix)) return ix;
  if (ix.kind !== "open") return refusal("x402/not-an-opening");
  const carrier = openingCarrier(tx);
  if (isRefusal(carrier)) return carrier;
  if (carrier.memo !== x.accepted.extra!["memo"]) return refusal("svm/carrier-mismatch");
  const r = await svmRef(presented);
  if (isRefusal(r)) return r;
  return { accepted: x.accepted, tx, h: carrier.h };
}

async function svmBound(presented: unknown): Promise<AtrHash | Refusal> {
  const o = await svmOpening(presented);
  return isRefusal(o) ? o : o.h;
}

/**
 * The opening's read keys (`svmReference`), with the payee of `option`, the issued option the payment answers
 * (`x402Payee`), whose refusal comes after the payment's.
 */
async function svmReferenceOf(presented: unknown, option: PaymentRequirements): Promise<SvmRef | Refusal> {
  const o = await svmOpening(presented);
  if (isRefusal(o)) return o;
  return x402SvmReference(o.accepted, o.tx, o.h, option);
}

/** The 64 bytes of a base58 Ed25519 signature, or undefined. */
function signatureBytes(s: unknown): Uint8Array | undefined {
  if (typeof s !== "string" || s.length > 90) return undefined;
  try {
    const b = base58.decode(s);
    return b.length === 64 ? b : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The opening: the `open` transaction, then the first voucher, each for the payer or its authorizer to sign. The
 * transaction ends with two v3 Memo instructions: `extra.memo`, then x402's binding memo for `extra.receiverAuthorizer`.
 * A `payerAuthorizer` that is not a point on the Ed25519 curve, which the program's `open` refuses as the authorized
 * signer, is `svm/input-malformed`. H is checked first, then the form of the choice's payer, token program, blockhash
 * and compute budget (`isPayerInput`), deposit, `payerAuthorizer`, salt and `openSlot`, then its document and option,
 * then the option's memo against H and its token program against the choice's. The `open` is version 1 where the
 * option's `extra.transactionVersions` holds 1, as @x402/svm 2.31.0's batch-settlement client writes it, else v0
 * (`builtVersion`).
 */
async function svmBuild(c: BatchSvmOpen, h: AtrHash): Promise<BatchUnsigned | Refusal> {
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/not-v2");
  if (
    !isPayerInput(c) ||
    typeof c.deposit !== "bigint" ||
    c.deposit <= 0n ||
    c.deposit >= U64_LIMIT ||
    !isCurveKey(c.payerAuthorizer) ||
    !isU64(c.salt) ||
    !isU64(c.openSlot) ||
    c.openSlot > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return refusal("svm/input-malformed");
  }
  const ok = chosen(c.required, c.accepted, FILTER[SVM_ID]);
  if (ok !== true) return ok;
  const { accepted, required } = c;
  const extra = accepted.extra!;
  const version = builtVersion(extra);
  if (version === null) return refusal("x402/option-malformed");
  const memo = extra["memo"];
  if (memo !== toLcpString(h)) return refusal("svm/carrier-mismatch");
  if (c.tokenProgram !== extra["tokenProgram"]) return refusal("svm/input-malformed");
  const feePayer = extra["feePayer"] as string;
  const channel = channelPda({
    payer: c.payer,
    payee: feePayer,
    mint: accepted.asset,
    signer: c.payerAuthorizer,
    salt: c.salt,
    openSlot: c.openSlot,
  });
  if (isRefusal(channel)) return channel;
  const receiverAuthorizer = extra["receiverAuthorizer"] as string;
  const message = await channelMessage(
    {
      feePayer,
      payer: c.payer,
      mint: accepted.asset,
      tokenProgram: c.tokenProgram,
      recentBlockhash: c.recentBlockhash,
      computeUnitLimit: c.computeUnitLimit ?? 200_000,
      computeUnitPrice: c.computeUnitPrice ?? 1n,
      ...(version === 1 ? { v1: X402_V1 } : {}),
      instruction: {
        kind: "open",
        channel,
        signer: c.payerAuthorizer,
        salt: c.salt,
        deposit: c.deposit,
        gracePeriod: extra["withdrawDelay"] as number,
        openSlot: c.openSlot,
        recipient: accepted.payTo,
      },
    },
    [memo, BINDING_MEMO_PREFIX + receiverAuthorizer],
  );
  if (isRefusal(message)) return message;
  const amount = BigInt(accepted.amount);
  const voucherMessage = channelVoucherMessage(channel, amount, 0n);
  const channelConfig = {
    payer: c.payer,
    payerAuthorizer: c.payerAuthorizer,
    receiver: accepted.payTo,
    receiverAuthorizer,
    token: accepted.asset,
    withdrawDelay: extra["withdrawDelay"] as number,
    salt: c.salt.toString(),
    openSlot: Number(c.openSlot),
  };
  return {
    requests: [
      { kind: "solana-message", message },
      { kind: "ed25519-raw", message: voucherMessage, signer: c.payerAuthorizer },
    ],
    complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
      const [txSig, voucherSig] = signatures.map(signatureBytes);
      if (signatures.length !== 2 || txSig === undefined || voucherSig === undefined) return refusal("svm/input-malformed");
      const wire = signedWire(message, c.payer, txSig);
      if (isRefusal(wire)) return wire;
      return paymentWith(required, accepted, {
          type: "deposit",
          channelConfig,
          voucher: { channelId: channel, maxClaimableAmount: amount.toString(), expiresAt: 0, signature: base58.encode(voucherSig) },
          deposit: { amount: c.deposit.toString(), transaction: toBase64(wire) },
        });
    },
  };
}

/**
 * A later voucher, or a full refund, for a channel this buyer opened. Each carries the voucher for
 * `maxClaimableAmount`. A refund carries no `amount`; with `recentBlockhash` it also carries a `request_close` message
 * for the payer, signed first: the Compute Budget prefix, `request_close` with the payer (read-only signer) and the
 * channel (writable), then one Memo v3 with `extra.memo` when the option carries one. That message is version 1, the
 * Compute Budget prefix carried in its header, where the option's `extra.transactionVersions` holds 1, else v0
 * (`builtVersion`).
 */
async function svmBuildWithin(w: BatchWithin, _h: AtrHash): Promise<BatchUnsigned | Refusal> {
  if (!isObject(w)) return refusal("x402/not-v2");
  const ok = chosen(w.required, w.accepted, FILTER[SVM_ID]);
  if (ok !== true) return ok;
  const config = w.channelConfig;
  if (!isSvmConfig(config)) return refusal("x402/payload-malformed");
  const { accepted, required } = w;
  const channel = channelPda({
    payer: config.payer,
    payee: accepted.extra!["feePayer"] as string,
    mint: config.token,
    signer: config.payerAuthorizer,
    salt: BigInt(config.salt),
    openSlot: BigInt(config.openSlot),
  });
  if (isRefusal(channel)) return channel;
  if (typeof w.maxClaimableAmount !== "bigint" || w.maxClaimableAmount < 0n || w.maxClaimableAmount >= U64_LIMIT) {
    return refusal("svm/input-malformed");
  }
  const voucherRequest: SigningRequest = {
    kind: "ed25519-raw",
    message: channelVoucherMessage(channel, w.maxClaimableAmount, 0n),
    signer: config.payerAuthorizer,
  };
  const voucherOf = (sig: Uint8Array) => ({
    channelId: channel,
    maxClaimableAmount: w.maxClaimableAmount.toString(),
    expiresAt: 0,
    signature: base58.encode(sig),
  });
  if (w.refund !== undefined) {
    if (!isObject(w.refund) || w.refund.amount !== undefined) return refusal("svm/input-malformed");
    if (w.recentBlockhash === undefined) {
      return {
        requests: [voucherRequest],
        complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
          const sig = signatures.length === 1 ? signatureBytes(signatures[0]) : undefined;
          if (sig === undefined) return refusal("svm/input-malformed");
          return paymentWith(required, accepted, { type: "refund", channelConfig: w.channelConfig, voucher: voucherOf(sig) });
        },
      };
    }
    const extra = accepted.extra!;
    const version = builtVersion(extra);
    if (version === null) return refusal("x402/option-malformed");
    const memo = extra["memo"];
    const message = await buildChannelMessage({
      feePayer: extra["feePayer"] as string,
      payer: config.payer,
      mint: config.token,
      tokenProgram: extra["tokenProgram"] as string,
      recentBlockhash: w.recentBlockhash,
      ...(typeof memo === "string" ? { memo } : {}),
      computeUnitLimit: w.computeUnitLimit ?? 200_000,
      computeUnitPrice: w.computeUnitPrice ?? 1n,
      ...(version === 1 ? { v1: X402_V1 } : {}),
      instruction: { kind: "request_close", channel },
    });
    if (isRefusal(message)) return message;
    return {
      requests: [{ kind: "solana-message", message }, voucherRequest],
      complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
        const [txSig, voucherSig] = signatures.map(signatureBytes);
        if (signatures.length !== 2 || txSig === undefined || voucherSig === undefined) return refusal("svm/input-malformed");
        const wire = signedWire(message, config.payer, txSig);
        if (isRefusal(wire)) return wire;
        return paymentWith(required, accepted, {
          type: "refund",
          channelConfig: w.channelConfig,
          voucher: voucherOf(voucherSig),
          transaction: toBase64(wire),
        });
      },
    };
  }
  return {
    requests: [voucherRequest],
    complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
      const sig = signatures.length === 1 ? signatureBytes(signatures[0]) : undefined;
      if (sig === undefined) return refusal("svm/input-malformed");
      return paymentWith(required, accepted, { type: "voucher", channelConfig: w.channelConfig, voucher: voucherOf(sig) });
    },
  };
}

function svmAdvertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(FILTER[SVM_ID])(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const memo = toLcpString(h);
  const current = offer.extra?.["memo"];
  if (current !== undefined && current !== memo) return refusal("svm/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), withExtra(offer, "memo", memo));
}

/**
 * The option without `extra.memo`, on the SVM pairing: the option as the seller issued it, before the carrier was
 * placed. An option that carries a `refused` member is `x402/option-malformed`; a value that is not an object comes
 * back as it is.
 */
function svmUnplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return withoutExtra(option, "memo");
}

/**
 * `x402/batch-settlement/solana`. The payee broadcasts (`broadcaster` answers `"payee"` for each payment type
 * `channel.kind` takes): for every payment of the channel: the seller's facilitator, the `feePayer`, co-signs and sends
 * the deposit and top-up transactions the payer signed, redeems vouchers when it settles, and sends the refund;
 * `status` reads them, and `channel.kind` classifies each payment. A payment of any other type gets
 * `x402/not-an-opening`, as `bound` refuses it.
 */
export const batchSvm = Object.freeze({
  id: SVM_ID,
  data: SOLANA[SVM_ID],
  pattern: Object.freeze({
    pattern: "native-field",
    profile: SVM_ID,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  }) as LcpPattern,
  claims: true as boolean,
  unplaced: svmUnplaced,
  tie,
  advertise: svmAdvertise,
  read: (doc: PaymentRequired): X402Read | Refusal => readFor(FILTER[SVM_ID])(doc),
  build: svmBuild,
  buildWithin: svmBuildWithin,
  bound: svmBound,
  broadcaster: batchBroadcaster(svmPayloadKind),
  reference: svmReferenceOf,
  status: svmChannelStatus,
  recover: svmBatchRecover,
  channel: Object.freeze({
    kind: svmKind,
    ref: svmChannelRef,
    boundWithin: async (_p: BatchPaymentPayload): Promise<AtrHash | Refusal> => refusal("x402/not-bound-within"),
    until: (_p: BatchPaymentPayload): number | undefined => undefined,
  }),
}) satisfies Entry<
  typeof SVM_ID,
  BatchPaymentPayload,
  SvmRef,
  SvmReader,
  X402Forms & {
    choice: BatchSvmOpen;
    unsigned: BatchUnsigned;
    landed: object;
    network: SolanaNetwork;
    query: SvmQuery;
    answer: SvmStatus;
  }
>;

// ── Cloudflare pairing ───────────────────────────────────────────────────────────────────────────────────────────

async function cfBuild(
  c: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<CloudflarePaymentPayload | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/legal-context-conflict");
  if (!isObject(c)) return refusal("x402/not-v2");
  const ok = chosen(c.required, c.accepted, FILTER[CF_ID]);
  if (ok !== true) return ok;
  const lc = legalContextOf(c.required.extensions);
  if (isRefusal(lc)) return lc;
  if (lc.h !== nh) return refusal("x402/legal-context-conflict");
  return {
    x402Version: 2,
    payload: { amount: c.accepted.amount, asset: c.accepted.asset },
    accepted: c.accepted,
    extensions: c.required.extensions!,
  };
}

/** The echoed `extensions.legalContext` hash. The agent's HTTP message signature is verified by Cloudflare. */
async function cfBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = acceptedBy(presented["accepted"], FILTER[CF_ID]);
  if (isRefusal(accepted)) return accepted;
  const lc = legalContextOf(presented["extensions"]);
  return isRefusal(lc) ? lc : lc.h;
}

/**
 * `x402/batch-settlement/cloudflare`. The payee broadcasts (`broadcaster` answers `"payee"`): Cloudflare, for the
 * seller, verifies the agent's signed request and bills its registered identity off chain; no `status` reads it.
 */
export const batchCloudflare = Object.freeze({
  id: CF_ID,
  data: EIP155_X402[CF_ID],
  pattern: Object.freeze({
    pattern: "protocol-extension",
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  }) as LcpPattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseFor(FILTER[CF_ID]),
  read: (doc: PaymentRequired): X402Read | Refusal => readFor(FILTER[CF_ID])(doc),
  build: cfBuild,
  bound: cfBound,
  broadcaster: x402Broadcaster("payee", { payload: null }),
}) satisfies Entry<
  typeof CF_ID,
  CloudflarePaymentPayload,
  never,
  never,
  X402Forms & NoRead & {
    choice: { required: PaymentRequired; accepted: PaymentRequirements };
    unsigned: CloudflarePaymentPayload;
  }
>;
