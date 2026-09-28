/**
 * x402 `batch-settlement`: one ATR per channel. On EVM the ATR hash is the channel configuration's `salt`, which the
 * channel id commits to and every signature signs; on Solana it is the opening transaction's one memo; on Cloudflare
 * it rides the echoed `extensions.legalContext` of each request, with no channel.
 */
import { base58 } from "@scure/base";
import { toLcpString, type AtrHash, type Json } from "./core.js";
import {
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
  TRANSFER_TOPIC,
  evmStatus,
  permit2TypedData,
  receiveTypedData,
  transferDigest,
  type Eip155,
  type EvmLog,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type Field,
  type Permit2TypedData,
  type ReceiveTypedData,
} from "./evm.js";
import { chainIdOf, isAddress, isObject, normalHash } from "./fields.js";
import {
  channelInstruction,
  channelPda,
  channelVoucherMessage,
  buildChannelMessage,
  decodeSvmTx,
  isKey,
  isSolanaNetwork,
  signedWire,
  staticNonce,
  svmCarrier,
  svmChannelStatus,
  svmRecover,
  svmReference,
  toBase64,
  wireOf,
  TOKEN,
  TOKEN_2022,
  type SvmRef,
  type SvmTx,
} from "./internal/svm.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  filterOf,
  legalContextOf,
  offeredAt,
  paymentWith,
  readFor,
  tie,
  withExtra,
  withOption,
  withoutExtra,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Choice,
  type X402Read,
} from "./x402.js";

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
const U40_LIMIT = 1n << 40n;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^[0-9]{1,39}$/;

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

function isChannelConfig(c: unknown): c is ChannelConfig {
  if (!isObject(c)) return false;
  const delay = c["withdrawDelay"];
  return (
    ["payer", "payerAuthorizer", "receiver", "receiverAuthorizer", "token"].every((k) => isAddress(c[k])) &&
    Number.isSafeInteger(delay) &&
    (delay as number) >= 0 &&
    BigInt(delay as number) < U40_LIMIT &&
    typeof c["salt"] === "string" &&
    HASH32.test(c["salt"])
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

/** The ERC-3009 deposit's nonce: keccak256(abi.encode(bytes32 channelId, uint256 authSalt)). */
export function erc3009DepositNonce(channelId: Hex, authSalt: Hex): Hex | Refusal {
  if (!HASH32.test(channelId) || !HASH32.test(authSalt)) return refusal("evm/field-malformed");
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
  | { kind: "solana-message"; message: Uint8Array }
  | { kind: "ed25519-raw"; message: Uint8Array; signer: string };

export interface BatchPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { type: string; [k: string]: Json };
  extensions?: PaymentRequired["extensions"];
}

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
    ref(p: BatchPaymentPayload): Promise<{ network: string; channel: string } | Refusal>;
    boundWithin(p: unknown): Promise<AtrHash | Refusal>;
    until(p: BatchPaymentPayload): number | undefined;
  };
}

export interface BatchEvmOpen extends X402Choice {
  payerAuthorizer: Hex;
  deposit: bigint;
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
  /** A refund. EVM: its amount, absent for a full refund. SVM: `{}`, a full refund whose `request_close` is built here. */
  refund?: { amount?: bigint };
  /** SVM refund: the blockhash to use when the option carries no `extra.recentBlockhash`. */
  recentBlockhash?: string;
  /** SVM refund: the Compute Budget values, 200 000 units and 1 microlamport when absent. */
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
}

const EVM_ID = "x402/batch-settlement/eip155" as const;
const SVM_ID = "x402/batch-settlement/solana" as const;
const CF_ID = "x402/batch-settlement/cloudflare" as const;
export type BatchPairingId = typeof EVM_ID | typeof SVM_ID | typeof CF_ID;

const MIN_DELAY = 900;
const MAX_DELAY = 2_592_000;
const MAX_MEMO = 256;
const MAX_SIGNATURE_HEX = 2 + 2 * 8192;

function isDelay(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= MIN_DELAY && (v as number) <= MAX_DELAY;
}

function nonZeroAddress(v: unknown): v is Hex {
  return isAddress(v) && !/^0x0{40}$/.test(v);
}

/** The batch-settlement pairing an option names, or undefined. */
export function pairingOf(option: PaymentRequirements): BatchPairingId | undefined {
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
    if (!isKey(option.asset) || !isKey(option.payTo) || !isKey(extra["feePayer"])) return undefined;
    if (extra["tokenProgram"] !== TOKEN && extra["tokenProgram"] !== TOKEN_2022) return undefined;
    if (!isDelay(extra["withdrawDelay"]) || (extra["withdrawDelay"] as number) < option.maxTimeoutSeconds) return undefined;
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

function payable(o: PaymentRequirements): boolean {
  return (
    typeof o.amount === "string" &&
    DECIMAL.test(o.amount) &&
    BigInt(o.amount) < U128_LIMIT &&
    Number.isSafeInteger(o.maxTimeoutSeconds) &&
    o.maxTimeoutSeconds > 0
  );
}

const isId = (id: BatchPairingId) => (o: PaymentRequirements): boolean => pairingOf(o) === id;

function payloadOf(p: unknown, id: BatchPairingId): { accepted: PaymentRequirements; payload: Record<string, unknown> } | Refusal {
  if (!isObject(p) || p["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = p["accepted"] as PaymentRequirements;
  if (!isObject(accepted) || pairingOf(accepted) !== id) return refusal("x402/option-not-this-pairing");
  const payload = p["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  return { accepted, payload };
}

function isHexSignature(s: unknown): s is Hex {
  return typeof s === "string" && s.length <= MAX_SIGNATURE_HEX && /^0x(?:[0-9a-fA-F]{2})+$/.test(s);
}

// ── EVM pairing ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The EVM channel's id from a payment's config, which must equal its voucher's channel id. */
async function evmRef(p: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const x = payloadOf(p, EVM_ID);
  if (isRefusal(x)) return x;
  const config = x.payload["channelConfig"];
  if (!isChannelConfig(config)) return refusal("x402/payload-malformed");
  const voucher = x.payload["voucher"];
  if (!isObject(voucher) || typeof voucher["channelId"] !== "string") return refusal("x402/payload-malformed");
  const id = batchChannelId(chainIdOf(x.accepted.network)!, config);
  if (isRefusal(id)) return id;
  if (!sameBytes(id, voucher["channelId"])) return refusal("x402/channel-id-mismatch");
  return { network: x.accepted.network, channel: id.toLowerCase() };
}

function evmKind(p: BatchPaymentPayload): "open" | "within" | "close" | Refusal {
  const x = payloadOf(p, EVM_ID);
  if (isRefusal(x)) return x;
  const t = x.payload["type"];
  if (t === "deposit") return "open";
  if (t === "voucher") return "within";
  if (t === "refund") return x.payload["amount"] === undefined ? "close" : "within";
  return refusal("x402/channel-kind-unknown");
}

/** The opening's two authorizations: the deposit's token authorization, then the voucher. */
async function evmBuild(c: BatchEvmOpen, h: AtrHash): Promise<BatchUnsigned | Refusal> {
  const ok = chosen(c.required, c.accepted, filterOf(isId(EVM_ID)));
  if (ok !== true) return ok;
  const { accepted, required } = c;
  if (!payable(accepted)) return refusal("x402/option-malformed");
  const salt = normalHash(h);
  if (salt === null || !isAddress(c.from) || !isAddress(c.payerAuthorizer) || !HASH32.test(c.authSalt)) {
    return refusal("x402/option-malformed");
  }
  if (typeof c.deposit !== "bigint" || c.deposit <= 0n || c.deposit >= U128_LIMIT) return refusal("x402/option-malformed");
  if (!Number.isSafeInteger(c.now) || c.now < 0) return refusal("x402/option-malformed");
  const extra = accepted.extra!;
  const chainId = chainIdOf(accepted.network)!;
  const config: ChannelConfig = {
    payer: c.from,
    payerAuthorizer: c.payerAuthorizer,
    receiver: accepted.payTo as Hex,
    receiverAuthorizer: extra["receiverAuthorizer"] as Hex,
    token: accepted.asset as Hex,
    withdrawDelay: extra["withdrawDelay"] as number,
    salt,
  };
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
      nonce: BigInt(c.authSalt),
      deadline,
      witness: { type: "DepositWitness", fields: [{ name: "channelId", type: "bytes32" }], value: { channelId } },
    });
  } else {
    const nonce = erc3009DepositNonce(channelId, c.authSalt);
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
              nonce: BigInt(c.authSalt).toString(),
              deadline: deadline.toString(),
              witness: { channelId },
              signature: s1,
            },
          }
        : { erc3009Authorization: { validAfter: "0", validBefore: deadline.toString(), salt: c.authSalt, signature: s1 } };
      return paymentWith(required, accepted, {
          type: "deposit",
          channelConfig,
          voucher: { channelId, maxClaimableAmount: amount.toString(), signature: s2 },
          deposit: { amount: c.deposit.toString(), authorization },
        });
    },
  };
}

/** A later voucher, or a refund, for a channel opened under `h`. */
async function evmBuildWithin(w: BatchWithin, h: AtrHash): Promise<BatchUnsigned | Refusal> {
  const ok = chosen(w.required, w.accepted, filterOf(isId(EVM_ID)));
  if (ok !== true) return ok;
  const config = w.channelConfig;
  if (!isChannelConfig(config)) return refusal("x402/payload-malformed");
  if (normalHash(config.salt) !== normalHash(h)) return refusal("x402/channel-id-mismatch");
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

/** The opening's deposit authorization: exactly one of the ERC-3009 and Permit2 forms. */
function depositOf(payload: Record<string, unknown>) {
  const deposit = payload["deposit"];
  if (!isObject(deposit) || typeof deposit["amount"] !== "string" || !DECIMAL.test(deposit["amount"])) {
    return refusal("x402/payload-malformed");
  }
  const auth = deposit["authorization"];
  if (!isObject(auth)) return refusal("x402/deposit-authorization");
  const e = auth["erc3009Authorization"];
  const p = auth["permit2Authorization"];
  if ((e === undefined) === (p === undefined)) return refusal("x402/deposit-authorization");
  if (e !== undefined) {
    if (!isObject(e) || typeof e["validBefore"] !== "string" || !DECIMAL.test(e["validBefore"])) return refusal("x402/payload-malformed");
    if (typeof e["salt"] !== "string" || !HASH32.test(e["salt"])) return refusal("x402/payload-malformed");
    return { amount: BigInt(deposit["amount"]), method: "eip3009" as const, settleBy: BigInt(e["validBefore"]), authSalt: e["salt"] as Hex };
  }
  if (!isObject(p) || typeof p["deadline"] !== "string" || !DECIMAL.test(p["deadline"])) return refusal("x402/payload-malformed");
  return { amount: BigInt(deposit["amount"]), method: "permit2" as const, settleBy: BigInt(p["deadline"]) };
}

/** The opening's `salt`, once its config hashes to the voucher's channel id. No signature is verified here. */
async function evmBound(presented: unknown): Promise<AtrHash | Refusal> {
  const x = payloadOf(presented, EVM_ID);
  if (isRefusal(x)) return x;
  if (x.payload["type"] !== "deposit") return refusal("x402/not-an-opening");
  if (!isChannelConfig(x.payload["channelConfig"])) return refusal("x402/payload-malformed");
  const d = depositOf(x.payload);
  if (isRefusal(d)) return d;
  const r = await evmRef(presented);
  if (isRefusal(r)) return r;
  return normalHash((x.payload["channelConfig"] as ChannelConfig).salt)!;
}

/** A within payment's `salt`, once its config hashes to its voucher's channel id. */
async function evmBoundWithin(presented: unknown): Promise<AtrHash | Refusal> {
  const r = await evmRef(presented);
  if (isRefusal(r)) return r;
  const x = payloadOf(presented, EVM_ID) as { payload: Record<string, unknown> };
  return normalHash((x.payload["channelConfig"] as ChannelConfig).salt)!;
}

/** The opening's read keys: the `Deposited` log, the payer's transfer by digest, and the log filter that finds the opening. */
async function evmReference(presented: unknown): Promise<EvmRef | Refusal> {
  const h = await evmBound(presented);
  if (isRefusal(h)) return h;
  const x = payloadOf(presented, EVM_ID) as { accepted: PaymentRequirements; payload: Record<string, unknown> };
  const config = x.payload["channelConfig"] as ChannelConfig;
  const d = depositOf(x.payload) as Exclude<ReturnType<typeof depositOf>, Refusal>;
  const channelId = (await evmRef(presented)) as { channel: string };
  const id = channelId.channel as Hex;
  const to = d.method === "eip3009" ? ERC3009_DEPOSIT_COLLECTOR : BATCH_SETTLEMENT;
  const digest = await transferDigest({ from: config.payer, to, value: d.amount });
  if (isRefusal(digest)) return digest;
  let search: NonNullable<EvmRef["search"]>;
  if (d.method === "eip3009") {
    const nonce = erc3009DepositNonce(id, d.authSalt);
    if (isRefusal(nonce)) return nonce;
    search = { address: config.token, topics: [AUTHORIZATION_USED_TOPIC, null, nonce] };
  } else {
    search = { address: BATCH_SETTLEMENT, topics: [DEPOSITED_TOPIC, id] };
  }
  return {
    network: x.accepted.network as Eip155,
    settleBy: d.settleBy.toString(),
    bindingLog: { address: BATCH_SETTLEMENT, topic0: DEPOSITED_TOPIC, index: 1, value: id },
    transferLog: { address: config.token, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
    search,
  };
}

/** Zero-party: the salt of the one `ChannelCreated` log from the channel contract whose data hashes to its id. */
async function evmRecover(ref: { network: Eip155; transaction: Hex }, reader: EvmReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("evm/wrong-reader");
  const chainId = chainIdOf(ref.network);
  if (chainId === undefined) return refusal("evm/network-malformed");
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return refusal("evm/unreadable");
  }
  if (receipt === null) return refusal("evm/not-found");
  if (typeof receipt !== "object" || !Array.isArray(receipt.logs)) return refusal("evm/unreadable");
  if (receipt.status !== 1) return refusal("evm/reverted");
  const created = (receipt.logs as readonly EvmLog[]).filter(
    (l) =>
      typeof l?.address === "string" &&
      l.address.toLowerCase() === BATCH_SETTLEMENT.toLowerCase() &&
      Array.isArray(l.topics) &&
      sameBytes(l.topics[0], CHANNEL_CREATED_TOPIC),
  );
  if (created.length === 0) return refusal("evm/no-channel-created");
  if (created.length > 1) return refusal("evm/ambiguous");
  const c = batchChannelCreated(created[0]!, chainId);
  if (isRefusal(c)) return c;
  return normalHash(c.config.salt)!;
}

function evmAdvertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(filterOf(isId(EVM_ID), payable))(doc, h, link, offer, agreementUrl);
}

const identity = (option: PaymentRequirements): PaymentRequirements => option;

export const batchEvm = Object.freeze({
  id: EVM_ID,
  pattern: Object.freeze({
    pattern: "native-field",
    canonical: false,
    profile: EVM_ID,
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
    publicProof: true,
    proves:
      "The payer signed a token authorization for a deposit into an x402 batch-settlement channel whose identifier, the " +
      "EIP-712 hash of the channel's configuration, commits to this ATR's hash as the configuration's salt. The token " +
      "contract or Permit2 verified that signature when the channel contract collected the deposit, and the hash is on " +
      "chain as the salt in the channel's ChannelCreated event. Later requests in this channel were paid under this ATR " +
      "by vouchers the seller did not meter; each voucher signs a commitment to this ATR's hash. This does not show " +
      "that amount, payee, asset or timing match the ATR's content.",
  }) as LcpPattern,
  claims: true as boolean,
  unplaced: identity,
  tie,
  advertise: evmAdvertise,
  read: (doc: PaymentRequired): X402Read | Refusal => readFor(filterOf(isId(EVM_ID)))(doc),
  build: evmBuild,
  buildWithin: evmBuildWithin,
  bound: evmBound,
  reference: evmReference,
  status: evmStatus,
  recover: evmRecover,
  channel: Object.freeze({
    kind: evmKind,
    ref: evmRef,
    boundWithin: evmBoundWithin,
    until: (_p: BatchPaymentPayload): number | undefined => undefined,
  }),
});

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

function isSvmConfig(c: unknown): c is SvmChannelConfig {
  if (!isObject(c)) return false;
  const u64 = (v: unknown) => typeof v === "string" && U64_DECIMAL.test(v) && BigInt(v) < U64_LIMIT;
  return (
    isKey(c["payer"]) &&
    isKey(c["payerAuthorizer"]) &&
    isKey(c["receiver"]) &&
    (c["receiverAuthorizer"] === undefined || isKey(c["receiverAuthorizer"])) &&
    isKey(c["token"]) &&
    Number.isSafeInteger(c["withdrawDelay"]) &&
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

function svmKind(p: BatchPaymentPayload): "open" | "within" | "close" | Refusal {
  const x = payloadOf(p, SVM_ID);
  if (isRefusal(x)) return x;
  const t = x.payload["type"];
  if (t === "voucher") return "within";
  if (t === "refund") return "close";
  if (t === "deposit") {
    const tx = svmTxOf(x.payload);
    if (tx === undefined || isRefusal(tx)) return refusal("x402/payload-malformed");
    const ix = channelInstruction(tx);
    if (isRefusal(ix)) return ix;
    if (ix.kind === "open") return "open";
    if (ix.kind === "top_up") return "within";
  }
  return refusal("x402/channel-kind-unknown");
}

/** The channel PDA from a payment's config, which must equal its voucher's id and its channel instruction's account. */
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

/** The opening's memo hash, when the one memo equals `extra.memo` and the channel instruction is an `open`. */
async function svmOpening(presented: unknown) {
  const x = payloadOf(presented, SVM_ID);
  if (isRefusal(x)) return x;
  if (x.payload["type"] !== "deposit") return refusal("x402/not-an-opening");
  const tx = svmTxOf(x.payload);
  if (tx === undefined) return refusal("x402/payload-malformed");
  if (isRefusal(tx)) return tx;
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const carrier = svmCarrier(tx);
  if (isRefusal(carrier)) return carrier;
  if (carrier.memo !== x.accepted.extra!["memo"]) return refusal("svm/carrier-mismatch");
  const ix = channelInstruction(tx);
  if (isRefusal(ix)) return ix;
  if (ix.kind !== "open") return refusal("x402/not-an-opening");
  const r = await svmRef(presented);
  if (isRefusal(r)) return r;
  return { accepted: x.accepted, tx, h: carrier.h };
}

async function svmBound(presented: unknown): Promise<AtrHash | Refusal> {
  const o = await svmOpening(presented);
  return isRefusal(o) ? o : o.h;
}

async function svmReferenceOf(presented: unknown): Promise<Omit<SvmRef, "fromSlot"> | Refusal> {
  const o = await svmOpening(presented);
  if (isRefusal(o)) return o;
  return svmReference(o.accepted.network as SvmRef["network"], o.tx);
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

/** The opening: the `open` transaction, then the first voucher, each for the payer or its authorizer to sign. */
async function svmBuild(c: BatchSvmOpen, h: AtrHash): Promise<BatchUnsigned | Refusal> {
  const ok = chosen(c.required, c.accepted, filterOf(isId(SVM_ID)));
  if (ok !== true) return ok;
  const { accepted, required } = c;
  if (!payable(accepted) || BigInt(accepted.amount) >= U64_LIMIT) return refusal("x402/option-malformed");
  const extra = accepted.extra!;
  const memo = extra["memo"];
  if (memo !== toLcpString(h)) return refusal("svm/carrier-mismatch");
  if (c.tokenProgram !== extra["tokenProgram"] || typeof c.deposit !== "bigint" || c.deposit <= 0n || c.deposit >= U64_LIMIT) {
    return refusal("svm/input-malformed");
  }
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
  if (c.openSlot > BigInt(Number.MAX_SAFE_INTEGER)) return refusal("svm/input-malformed");
  const message = await buildChannelMessage({
    feePayer,
    payer: c.payer,
    mint: accepted.asset,
    tokenProgram: c.tokenProgram,
    recentBlockhash: c.recentBlockhash,
    memo,
    computeUnitLimit: c.computeUnitLimit ?? 200_000,
    computeUnitPrice: c.computeUnitPrice ?? 1n,
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
  });
  if (isRefusal(message)) return message;
  const amount = BigInt(accepted.amount);
  const voucherMessage = channelVoucherMessage(channel, amount, 0n);
  const channelConfig = {
    payer: c.payer,
    payerAuthorizer: c.payerAuthorizer,
    receiver: accepted.payTo,
    ...(typeof extra["receiverAuthorizer"] === "string" ? { receiverAuthorizer: extra["receiverAuthorizer"] } : {}),
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
 * A later voucher, or a full refund, for a channel this buyer opened. The refund is a `request_close` message for the
 * payer: the Compute Budget prefix, `request_close` with the payer (read-only signer) and the channel (writable), then
 * one Memo v3 with `extra.memo` when the option carries one. Its payload carries no `amount` and no voucher.
 */
async function svmBuildWithin(w: BatchWithin, _h: AtrHash): Promise<BatchUnsigned | Refusal> {
  const ok = chosen(w.required, w.accepted, filterOf(isId(SVM_ID)));
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
  if (w.refund !== undefined) {
    if (!isObject(w.refund) || w.refund.amount !== undefined) return refusal("svm/input-malformed");
    const extra = accepted.extra!;
    const recentBlockhash = typeof extra["recentBlockhash"] === "string" ? extra["recentBlockhash"] : w.recentBlockhash;
    if (typeof recentBlockhash !== "string") return refusal("svm/input-malformed");
    const memo = extra["memo"];
    const message = await buildChannelMessage({
      feePayer: extra["feePayer"] as string,
      payer: config.payer,
      mint: config.token,
      tokenProgram: extra["tokenProgram"] as string,
      recentBlockhash,
      ...(typeof memo === "string" ? { memo } : {}),
      computeUnitLimit: w.computeUnitLimit ?? 200_000,
      computeUnitPrice: w.computeUnitPrice ?? 1n,
      instruction: { kind: "request_close", channel },
    });
    if (isRefusal(message)) return message;
    return {
      requests: [{ kind: "solana-message", message }],
      complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
        const sig = signatures.length === 1 ? signatureBytes(signatures[0]) : undefined;
        if (sig === undefined) return refusal("svm/input-malformed");
        const wire = signedWire(message, config.payer, sig);
        if (isRefusal(wire)) return wire;
        return paymentWith(required, accepted, { type: "refund", channelConfig: w.channelConfig, transaction: toBase64(wire) });
      },
    };
  }
  if (typeof w.maxClaimableAmount !== "bigint" || w.maxClaimableAmount < 0n || w.maxClaimableAmount >= U64_LIMIT) {
    return refusal("svm/input-malformed");
  }
  const message = channelVoucherMessage(channel, w.maxClaimableAmount, 0n);
  return {
    requests: [{ kind: "ed25519-raw", message, signer: config.payerAuthorizer }],
    complete(signatures: readonly string[]): BatchPaymentPayload | Refusal {
      const sig = signatures.length === 1 ? signatureBytes(signatures[0]) : undefined;
      if (sig === undefined) return refusal("svm/input-malformed");
      return paymentWith(required, accepted, {
          type: "voucher",
          channelConfig: w.channelConfig,
          voucher: { channelId: channel, maxClaimableAmount: w.maxClaimableAmount.toString(), expiresAt: 0, signature: base58.encode(sig) },
        });
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
  const placed = advertiseFor(filterOf(isId(SVM_ID), (o) => payable(o) && BigInt(o.amount) < U64_LIMIT))(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const memo = toLcpString(h);
  const current = offer.extra?.["memo"];
  if (current !== undefined && current !== memo) return refusal("svm/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), withExtra(offer, "memo", memo));
}

export const batchSvm = Object.freeze({
  id: SVM_ID,
  pattern: Object.freeze({
    pattern: "native-field",
    canonical: true,
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
    publicProof: true,
    proves:
      "The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and " +
      "which opened an x402 batch-settlement payment channel; it executed without error. The memo is in the " +
      "transaction's instruction data on chain. Later requests in this channel were paid under this ATR by vouchers " +
      "the seller did not meter. This does not show that amount, recipient, mint or timing match the ATR's content.",
  }) as LcpPattern,
  claims: true as boolean,
  carrier: "extra.memo" as const,
  unplaced: (option: PaymentRequirements): PaymentRequirements => withoutExtra(option, "memo"),
  tie,
  advertise: svmAdvertise,
  read: (doc: PaymentRequired): X402Read | Refusal => readFor(filterOf(isId(SVM_ID)))(doc),
  build: svmBuild,
  buildWithin: svmBuildWithin,
  bound: svmBound,
  reference: svmReferenceOf,
  status: svmChannelStatus,
  recover: svmRecover,
  channel: Object.freeze({
    kind: svmKind,
    ref: svmRef,
    boundWithin: async (_p: BatchPaymentPayload): Promise<AtrHash | Refusal> => refusal("x402/not-bound-within"),
    until: (_p: BatchPaymentPayload): number | undefined => undefined,
  }),
});

// ── Cloudflare pairing ───────────────────────────────────────────────────────────────────────────────────────────

/** The request's payment document: the option's amount and asset, with the challenge's `extensions` echoed. */
export interface CloudflarePaymentPayload {
  x402Version: 2;
  payload: { amount: string; asset: string };
  accepted: PaymentRequirements;
  extensions: NonNullable<PaymentRequired["extensions"]>;
}

async function cfBuild(
  c: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<CloudflarePaymentPayload | Refusal> {
  const ok = chosen(c.required, c.accepted, filterOf(isId(CF_ID)));
  if (ok !== true) return ok;
  const lc = legalContextOf(c.required.extensions);
  if (isRefusal(lc)) return lc;
  if (lc.h !== normalHash(h)) return refusal("x402/legal-context-conflict");
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
  const accepted = presented["accepted"] as PaymentRequirements;
  if (!isObject(accepted) || pairingOf(accepted) !== CF_ID) return refusal("x402/option-not-this-pairing");
  const lc = legalContextOf(presented["extensions"]);
  return isRefusal(lc) ? lc : lc.h;
}

export const batchCloudflare = Object.freeze({
  id: CF_ID,
  pattern: Object.freeze({
    pattern: "protocol-extension",
    canonical: true,
    buyerSigns: true,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
      "recorded in <transaction>. The buyer's agent signed, with the HTTP message signature key it registered with Cloudflare, a request whose " +
      "PAYMENT-SIGNATURE header echoes this ATR's hash in the x402 legalContext extension. Cloudflare verifies that " +
      "signature and bills the agent's registered identity off chain. This does not show that amount, asset or timing " +
      "match the ATR's content.",
  }) as LcpPattern,
  claims: true as boolean,
  unplaced: identity,
  tie,
  advertise: advertiseFor(filterOf(isId(CF_ID))),
  read: (doc: PaymentRequired): X402Read | Refusal => readFor(filterOf(isId(CF_ID)))(doc),
  build: cfBuild,
  bound: cfBound,
});
