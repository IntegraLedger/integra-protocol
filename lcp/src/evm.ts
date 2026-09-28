/**
 * EIP-3009 on eip155 chains: the typed data a payer signs, the identity digest of a transfer, the settlement read from
 * the token's `AuthorizationUsed` event and the transfer it produced, and the read of a signed pull authorization's use
 * before any transaction is named. Nothing here knows x402.
 */
import { hash, hashEquals, type AtrHash, type Json } from "./core.js";
import {
  addressOfWord,
  addressWord,
  bytes32Word,
  bytesOf,
  concat,
  hexOf,
  keccak,
  keccakHex,
  sameBytes,
  uintOf,
  uintWord,
  wordAt,
  type Hex,
} from "./evm-abi.js";
import { chainIdOf, isAddress, isUint256, normalHash, uint256Of } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";

export type { Hex } from "./evm-abi.js";
/** CAIP-2 for EVM chains; the reference is the decimal chain id. */
export type Eip155 = `eip155:${string}`;

/** keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)") */
export const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267" as const;
/** keccak256("AuthorizationUsed(address,bytes32)") */
export const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5" as const;

export interface Field {
  name: string;
  type: string;
}

export interface Eip3009TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: Hex };
  types: { EIP712Domain: Field[]; TransferWithAuthorization: Field[] };
  primaryType: "TransferWithAuthorization";
  message: { from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: AtrHash };
}

/**
 * The EIP-712 typed data for `TransferWithAuthorization`, with the field lists in ERC-3009's order. The domain's
 * `verifyingContract` is the token.
 */
export function eip3009TypedData(a: {
  network: Eip155;
  asset: Hex;
  name: string;
  version: string;
  from: Hex;
  to: Hex;
  value: string;
  validAfter: bigint;
  validBefore: bigint;
  nonce: AtrHash;
}): Eip3009TypedData | Refusal {
  const chainId = chainIdOf(a.network);
  if (chainId === undefined) return refusal("evm/network-malformed");
  const value = uint256Of(a.value);
  if (value === undefined) return refusal("evm/amount-malformed");
  if (!isAddress(a.asset) || !isAddress(a.from) || !isAddress(a.to)) return refusal("evm/field-malformed");
  if (!isUint256(a.validAfter) || !isUint256(a.validBefore)) return refusal("evm/field-malformed");
  const nonce = normalHash(a.nonce);
  if (nonce === null) return refusal("evm/field-malformed");
  return {
    domain: { name: a.name, version: a.version, chainId, verifyingContract: a.asset },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { from: a.from, to: a.to, value, validAfter: a.validAfter, validBefore: a.validBefore, nonce },
  };
}

/** EIP-3009's `ReceiveWithAuthorization`: the same fields as `TransferWithAuthorization`, for a payee contract. */
export type ReceiveTypedData = Omit<Eip3009TypedData, "primaryType" | "types"> & {
  primaryType: "ReceiveWithAuthorization";
  types: { EIP712Domain: Field[]; ReceiveWithAuthorization: Field[] };
};

/** The EIP-712 typed data for `ReceiveWithAuthorization`, built as `eip3009TypedData` builds its transfer form. */
export function receiveTypedData(a: Parameters<typeof eip3009TypedData>[0]): ReceiveTypedData | Refusal {
  const t = eip3009TypedData(a);
  if ("refused" in t) return t;
  return {
    domain: t.domain,
    types: { EIP712Domain: t.types.EIP712Domain, ReceiveWithAuthorization: t.types.TransferWithAuthorization },
    primaryType: "ReceiveWithAuthorization",
    message: t.message,
  };
}

/**
 * SHA-256 over the 72 bytes of `abi.encodePacked(address from, address to, uint256 value)`: the identity of one
 * transfer, which a `Transfer(from, to, value)` log in the settlement transaction reproduces.
 */
export async function authorizationIdDigest(from: Hex, to: Hex, value: string | bigint): Promise<Hex | Refusal> {
  if (!isAddress(from) || !isAddress(to)) return refusal("evm/field-malformed");
  const v = typeof value === "bigint" ? value : uint256Of(value);
  if (v === undefined || !isUint256(v)) return refusal("evm/amount-malformed");
  const packed = new Uint8Array(72);
  packed.set(addressBytes(from), 0);
  packed.set(addressBytes(to), 20);
  let rest = v;
  for (let i = 71; i >= 40; i--) {
    packed[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return hash(packed);
}

/**
 * What a settlement reference holds for an EIP-3009 payment: read keys only. It is an `EvmRef` naming the
 * `AuthorizationUsed` log, the transfer's identity and the authorization as the token records its use, with the
 * token, `validBefore` and the transfer digest.
 */
export type Eip3009Ref = EvmRef & {
  network: Eip155;
  asset: Hex;
  validBefore: string;
  /** The option's `maxTimeoutSeconds`: the authorization was signed no earlier than `validBefore` less this. */
  maxTimeoutSeconds: number;
  idDigest: Hex;
  transferLog: TransferLog;
  authorization: PullAuthorization;
};

/** One receipt log: the emitter, its topics and its data. */
export interface EvmLog {
  address: Hex;
  topics: readonly Hex[];
  data: Hex;
}

export interface EvmReceipt {
  status: 0 | 1;
  blockNumber: bigint;
  logs: readonly EvmLog[];
}

/** Hedera's CAIP-2 networks, read through their JSON-RPC relay with the same reader shape. */
type HederaNetwork = "hedera:mainnet" | "hedera:testnet" | "hedera:previewnet" | "hedera:devnet";

/** Bounded, read-only calls against one network's endpoint. Every failure rejects with `ReaderError`. */
export interface EvmReader {
  readonly network: Eip155 | HederaNetwork;
  /** `eth_getTransactionReceipt`; null when the node holds none. */
  receipt(tx: Hex): Promise<EvmReceipt | null>;
  /** `eth_getBlockByNumber(tag, false).number`. */
  blockNumber(tag: "safe" | "finalized"): Promise<bigint>;
  /**
   * `eth_getTransactionByHash`: the sender, the recipient (null for a contract creation) and the calldata; null when
   * none.
   */
  transaction(tx: Hex): Promise<EvmTransaction | null>;
  /** `eth_call` of `data` to the contract `to`, in the state after block `block`: the return data. */
  call(to: Hex, data: Hex, block: bigint): Promise<Hex>;
}

/** A transaction as `eth_getTransactionByHash` gives it: `from`, the address that signed it; `to`; and `input`. */
export interface EvmTransaction {
  from: Hex;
  to: Hex | null;
  input: Hex;
}

export class ReaderError extends Error {
  readonly kind: "timeout" | "too-large" | "transport" | "malformed";
  constructor(kind: "timeout" | "too-large" | "transport" | "malformed", message?: string) {
    super(message ?? kind);
    this.name = "ReaderError";
    this.kind = kind;
  }
}

export interface EvmTxRef {
  network: Eip155;
  asset: Hex;
  transaction: Hex;
}

export type EvmStatus =
  | { state: "settled"; finality: "latest" | "safe" | "finalized"; blockNumber: bigint }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "reverted" | "authorization-not-used" | "transfer-not-found" };

/**
 * Reads the named transaction as this payment's EIP-3009 settlement. Settled when its receipt succeeded and holds the
 * pair one authorization produces: a log from `asset` with exactly three topics, the first `AuthorizationUsed` and the
 * third equal to `h`, and the `Transfer` that `transferLog` identifies, whose `from` is that log's authorizer (topic
 * 1). No such `AuthorizationUsed` log is failed `authorization-not-used`; no such `Transfer` is failed
 * `transfer-not-found`. The finality is the highest block mark at or above the receipt's block. A failed read, a reader
 * for another network, or a `transferLog` that is not one is pending `unreadable`, never failed. At most three calls.
 */
export async function eip3009Status(
  ref: EvmTxRef & { h: AtrHash; transferLog: TransferLog },
  reader: EvmReader,
): Promise<EvmStatus> {
  if (reader.network !== ref.network || !isTransferLog(ref.transferLog)) return { state: "pending", why: "unreadable" };
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (receipt === null) return { state: "pending", why: "not-found" };
  if (!isReceipt(receipt)) return { state: "pending", why: "unreadable" };
  if (receipt.status === 0) return { state: "failed", why: "reverted" };

  const binding = { address: ref.asset, topic0: AUTHORIZATION_USED_TOPIC, index: 2 as const, value: ref.h };
  const authorizers = authorizersOf(receipt.logs, binding);
  if (authorizers.length === 0) return { state: "failed", why: "authorization-not-used" };
  const transfers = await transfersOf(receipt.logs, ref.transferLog);
  if (!transfers.some((t) => authorizers.includes(t.from))) return { state: "failed", why: "transfer-not-found" };

  const at = receipt.blockNumber;
  return settledAt(at, reader);
}

/**
 * Recovers the hash from a settlement transaction alone: the one distinct nonce among the `AuthorizationUsed` logs
 * that `asset` emitted in it. One call.
 */
export async function eip3009Recover(ref: EvmTxRef, reader: EvmReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("evm/wrong-reader");
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return refusal("evm/unreadable");
  }
  if (receipt === null) return refusal("evm/not-found");
  if (!isReceipt(receipt)) return refusal("evm/unreadable");
  if (receipt.status === 0) return refusal("evm/reverted");

  const found = new Set<AtrHash>();
  for (const log of receipt.logs) {
    const nonce = authorizationUse(log, ref.asset);
    if (nonce === undefined) continue;
    const h = normalHash(nonce);
    if (h === null) return refusal("evm/unreadable");
    found.add(h);
  }
  if (found.size === 0) return refusal("evm/no-authorization-use");
  if (found.size > 1) return refusal("evm/ambiguous");
  return [...found][0]!;
}

/**
 * The authorizers (topic 1, lowercase) of the logs that carry `binding` with exactly three topics: for an
 * `AuthorizationUsed` binding, the accounts whose authorization with that nonce the transaction used.
 */
function authorizersOf(logs: readonly EvmLog[], binding: NonNullable<EvmRef["bindingLog"]>): Hex[] {
  const out: Hex[] = [];
  for (const log of logs) {
    if (typeof log !== "object" || log === null || !Array.isArray(log.topics) || log.topics.length !== 3) continue;
    if (!carriesBinding(log, binding)) continue;
    const a = topicAddress(log.topics[1]);
    if (a !== undefined) out.push(a);
  }
  return out;
}

/** The nonce topic of an `AuthorizationUsed` log emitted by `asset`, or undefined for any other log. */
function authorizationUse(log: { address: Hex; topics: readonly Hex[] }, asset: Hex): Hex | undefined {
  if (typeof log !== "object" || log === null) return undefined;
  if (typeof log.address !== "string" || typeof asset !== "string") return undefined;
  if (log.address.toLowerCase() !== asset.toLowerCase()) return undefined;
  if (!Array.isArray(log.topics) || log.topics.length !== 3) return undefined;
  if (!hashEquals(log.topics[0]!, AUTHORIZATION_USED_TOPIC)) return undefined;
  return log.topics[2];
}

/** True for a receipt with a 0 or 1 status, a bigint block number and a list of logs. */
export function isReceipt(r: unknown): r is EvmReceipt {
  if (typeof r !== "object" || r === null) return false;
  const { status, blockNumber, logs } = r as Record<string, unknown>;
  return (status === 0 || status === 1) && typeof blockNumber === "bigint" && Array.isArray(logs);
}

async function mark(reader: EvmReader, tag: "safe" | "finalized"): Promise<bigint | null> {
  try {
    const n = await reader.blockNumber(tag);
    return typeof n === "bigint" ? n : null;
  } catch {
    return null;
  }
}

function addressBytes(a: Hex): Uint8Array {
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = Number.parseInt(a.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

// ── EVM breadth: Permit2, the commerce-payments escrow, MetaMask's DelegationManager, and the generic settlement read.

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
export const EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" as const;
export const UPTO_PERMIT2_PROXY = "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002" as const;
/** The commerce-payments escrow's two deployments: the escrow, its two token collectors, and `PaymentCharged`'s topic. */
export const ESCROW: {
  readonly [d in "v1.1" | "v1.0"]: { escrow: Hex; eip3009Collector: Hex; permit2Collector: Hex; chargedTopic: Hex };
} = Object.freeze({
  "v1.1": Object.freeze({
    escrow: "0xf96815976523E00e65Be8f34cA5e64b4f41EB19c",
    eip3009Collector: "0x8612dfdc421f80336cd14E8EF9cb1E765dB5ab88",
    permit2Collector: "0xD69831Aed5bfe262067ec4c751f4F830EcdD446e",
    chargedTopic: "0x137b0e73e4453f43c2e1ad2552980a0e0c7e988764619974ca26d37a7159940c",
  }),
  "v1.0": Object.freeze({
    escrow: "0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff",
    eip3009Collector: "0x0E3dF9510de65469C4518D7843919c0b8C7A7757",
    permit2Collector: "0x992476B9Ee81d52a5BdA0622C333938D0Af0aB26",
    chargedTopic: "0x943ae4341dd799d7aeedc501f616cd26b134639e0bc2ec059581ba3ebbf1e7d0",
  }),
});
export const PAYMENT_AUTHORIZED_TOPIC = "0x1c81fb2e3bab27f6bb09bee9a0dddf61600b7cbaf2c12683e4864e0cbdb9d284" as const;
export const PAYMENT_INFO_TYPEHASH = "0xae68ac7ce30c86ece8196b61a7c486d8f0061f575037fbd34e7fe4e2820c6591" as const;
export const SALT_BINDING_TYPEHASH = "0x8a2a7e41a0bda000ded071ff38b79401d2603e1826516ff2635b11fe9e30877f" as const;
/** MetaMask's reference DelegationManager, v1.3.0, at one CREATE2 address. */
export const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3" as const;
/** The chain ids whose deployment record holds a DelegationManager at `DELEGATION_MANAGER`. */
export const DELEGATION_MANAGER_CHAINS: readonly number[] = Object.freeze([
  1, 10, 56, 97, 100, 130, 137, 143, 146, 1155, 1301, 1328, 1329, 2020, 2021, 4114, 4217, 4663, 5000, 5003, 5042, 5115,
  6342, 6343, 8453, 10143, 10200, 13579, 14601, 42161, 42170, 42220, 42431, 46630, 50312, 57073, 59141, 59144, 80002,
  80069, 80094, 84532, 421614, 560048, 737373, 747474, 763373, 5042002, 11142220, 11155111, 11155420,
]);
export const REDEEMED_DELEGATION_TOPIC = "0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873" as const;
/** Where a Tempo receive policy sends a blocked transfer. */
export const RECEIVE_POLICY_GUARD = "0xb10c000000000000000000000000000000000000" as const;
/** The DelegationManager's wildcard delegate. */
const ANY_DELEGATE = "0x0000000000000000000000000000000000000a11";

const MAX_CONTEXT_BYTES = 32_768;
const MAX_DELEGATIONS = 8;
const MAX_CAVEATS = 16;
const MAX_ABI_BYTES = 8192;

export interface Delegation {
  delegate: Hex;
  delegator: Hex;
  authority: Hex;
  caveats: { enforcer: Hex; terms: Hex; args: Hex }[];
  salt: Hex;
  signature: Hex;
}

/**
 * Decodes `abi.encode(Delegation[])`, strictly: every offset and length lies inside the input and is 32-byte aligned,
 * address words carry 12 zero bytes, and there are at most 8 delegations, 16 caveats each, and 8 KiB per `bytes`. The
 * array is returned in the input's order, leaf first. An empty array decodes to `[]`.
 */
export function decodePermissionContext(ctx: Hex): Delegation[] | Refusal {
  const b = bytesOf(ctx, MAX_CONTEXT_BYTES);
  if (b === undefined || b.length === 0 || b.length % 32 !== 0) return refusal("evm/field-malformed");
  const out = readDelegations(b);
  return out ?? refusal("evm/field-malformed");
}

function readDelegations(b: Uint8Array): Delegation[] | undefined {
  const word = (pos: number): Uint8Array | undefined =>
    pos % 32 === 0 && pos >= 0 && pos + 32 <= b.length ? b.subarray(pos, pos + 32) : undefined;
  const num = (pos: number): number | undefined => {
    const w = word(pos);
    if (w === undefined) return undefined;
    const v = uintOf(w);
    return v < BigInt(b.length) ? Number(v) : undefined;
  };
  const offset = (base: number, pos: number): number | undefined => {
    const o = num(pos);
    if (o === undefined || o % 32 !== 0) return undefined;
    const at = base + o;
    return at < b.length ? at : undefined;
  };
  const address = (pos: number): Hex | undefined => {
    const w = word(pos);
    return w === undefined ? undefined : addressOfWord(w);
  };
  const bytesAt = (at: number | undefined): Hex | undefined => {
    if (at === undefined) return undefined;
    const len = num(at);
    if (len === undefined || len > MAX_ABI_BYTES) return undefined;
    const end = at + 32 + len;
    if (end > b.length) return undefined;
    return hexOf(b.subarray(at + 32, end));
  };

  const arr = offset(0, 0);
  if (arr === undefined) return undefined;
  const count = num(arr);
  if (count === undefined || count > MAX_DELEGATIONS) return undefined;
  const heads = arr + 32;
  const out: Delegation[] = [];
  for (let i = 0; i < count; i++) {
    const t = offset(heads, heads + 32 * i);
    if (t === undefined) return undefined;
    const delegate = address(t);
    const delegator = address(t + 32);
    const authority = word(t + 64);
    const caveatsAt = offset(t, t + 96);
    const salt = word(t + 128);
    const signature = bytesAt(offset(t, t + 160));
    if (delegate === undefined || delegator === undefined || authority === undefined) return undefined;
    if (caveatsAt === undefined || salt === undefined || signature === undefined) return undefined;
    const n = num(caveatsAt);
    if (n === undefined || n > MAX_CAVEATS) return undefined;
    const caveats: Delegation["caveats"] = [];
    for (let j = 0; j < n; j++) {
      const c = offset(caveatsAt + 32, caveatsAt + 32 + 32 * j);
      if (c === undefined) return undefined;
      const enforcer = address(c);
      const terms = bytesAt(offset(c, c + 32));
      const args = bytesAt(offset(c, c + 64));
      if (enforcer === undefined || terms === undefined || args === undefined) return undefined;
      caveats.push({ enforcer, terms, args });
    }
    out.push({ delegate, delegator, authority: hexOf(authority), caveats, salt: hexOf(salt), signature });
  }
  return out;
}

/**
 * the core's `hash` over the fields present, in the order `from`, `to`, `value`: 20, 20 and 32 bytes, the value as a
 * big-endian uint256. `authorizationIdDigest(from, to, value)` equals `transferDigest({from, to, value})`.
 */
export async function transferDigest(v: { from?: Hex; to?: Hex; value?: bigint }): Promise<Hex | Refusal> {
  const parts: Uint8Array[] = [];
  if (v.from !== undefined) {
    if (!isAddress(v.from)) return refusal("evm/field-malformed");
    parts.push(bytesOf(v.from)!);
  }
  if (v.to !== undefined) {
    if (!isAddress(v.to)) return refusal("evm/field-malformed");
    parts.push(bytesOf(v.to)!);
  }
  if (v.value !== undefined) {
    if (!isUint256(v.value)) return refusal("evm/amount-malformed");
    parts.push(uintWord(v.value));
  }
  return hash(concat(parts));
}

export type TransferIdentity = "from,to,value" | "from,to" | "from" | "to,value" | "to";

/** A token transfer, identified by the core's `hash` over the fields `identity` names (see `transferDigest`). */
export interface TransferLog {
  address: Hex;
  topic0: Hex;
  identity: TransferIdentity;
  digest: Hex;
}

/**
 * The signed pull authorization of a payment that has not landed, as the chain records its use: what a settlement
 * reader needs to decide, with `authorizationUsed` and the payment's authorizer, whether it executed or can still
 * execute.
 * - `eip3009`: the token `at` answers `authorizationState(authorizer, nonce)`, true once the authorization is used. It
 *   executes only in a block whose timestamp is below `deadline` (ERC-3009's `validBefore`).
 * - `permit2`: the Permit2 deployment `at` answers `nonceBitmap(authorizer, nonce >> 8)`, whose bit `nonce & 0xff` is
 *   set once the nonce is used. The permit executes only in a block whose timestamp is at most `deadline`.
 */
export interface PullAuthorization {
  scheme: "eip3009" | "permit2";
  /** The contract that records the nonce's use: the token for `eip3009`, the Permit2 deployment for `permit2`. */
  at: Hex;
  /** The nonce the payer signed, as that contract records it: `0x` and 64 lowercase hex digits. */
  nonce: Hex;
  /** The signed time bound, in decimal Unix seconds. */
  deadline: string;
  /** The token the authorization moves. */
  asset: Hex;
}

/** What the issuer records at claim for an EVM payment: read keys only. */
export interface EvmRef {
  network: Eip155 | HederaNetwork;
  /** Decimal Unix seconds after which the payment can no longer execute. */
  settleBy?: string;
  /** The log carrying H or its commitment: in topic `index`, or in 32-byte data word `dataWord`. */
  bindingLog?: { address: Hex; topic0: Hex; value: Hex } & ({ index: 1 | 2 | 3 } | { dataWord: number });
  /** The token transfer this payment made, identified by the digest of the named fields. */
  transferLog?: TransferLog;
  /** The log filter that finds the transaction when none is named; absent, only a named transaction is read. */
  search?: { address: Hex; topics: readonly (Hex | null)[] };
  /** The signed pull authorization and where the chain records its use; present on every pull pairing that has one. */
  authorization?: PullAuthorization;
}

export type EvmBreadthStatus =
  | EvmStatus
  | {
      state: "failed";
      why: "binding-log-not-found" | "transfer-not-found" | "receive-policy-blocked" | "nonce-not-used";
    };

/**
 * Reads the named transaction. A reader for another network, or a failed read, is pending; no receipt is pending
 * `not-found`; a revert is failed. On success each log the ref names must be present, emitted by the named contract:
 * the binding log with `value` in its topic or data word, and the transfer log whose named fields hash to the digest.
 * Where the binding log is ERC-3009's `AuthorizationUsed` and the transfer log names `from`, the two are one
 * authorization's: the transfer's `from` is the binding log's authorizer (topic 1), else failed `transfer-not-found`.
 * Settled carries the highest finality mark reached. At most three calls.
 */
export async function evmStatus(ref: EvmRef & { transaction: Hex }, reader: EvmReader): Promise<EvmBreadthStatus> {
  const read = await matchedTransfers(ref, reader);
  if (!("receipt" in read)) return read;
  return settledAt(read.receipt.blockNumber, reader);
}

/**
 * Reads the named transaction as a Permit2 payment: `evmStatus`'s checks, then Permit2's record of the nonce. The ref's
 * `authorization` must be a `permit2` one and its `transferLog` must name `from`, else pending `unreadable`. At the
 * receipt's block, `nonceBitmap(from, nonce >> 8)` on `authorization.at` must have bit `nonce & 0xff` set, where
 * `from` is the matched transfer's; else failed `nonce-not-used`. A failed call is pending `unreadable`. At most four
 * calls.
 */
export async function permit2Status(ref: EvmRef & { transaction: Hex }, reader: EvmReader): Promise<EvmBreadthStatus> {
  const auth = ref.authorization;
  if (!isPullAuthorization(auth) || auth.scheme !== "permit2" || !isTransferLog(ref.transferLog)) {
    return { state: "pending", why: "unreadable" };
  }
  if (!ref.transferLog.identity.split(",").includes("from")) return { state: "pending", why: "unreadable" };
  const read = await matchedTransfers(ref, reader);
  if (!("receipt" in read)) return read;
  const owners = [...new Set(read.transfers.map((t) => t.from))];
  let used = false;
  for (const owner of owners) {
    const u = await authorizationUsed(ref, owner, read.receipt.blockNumber, reader);
    if (isRefusal(u)) return { state: "pending", why: "unreadable" };
    used ||= u;
  }
  if (!used) return { state: "failed", why: "nonce-not-used" };
  return settledAt(read.receipt.blockNumber, reader);
}

/**
 * The receipt of the named transaction and the transfers in it that the ref's `transferLog` identifies, once the
 * checks `evmStatus` makes before its finality marks hold; otherwise the status those checks give.
 */
async function matchedTransfers(
  ref: EvmRef & { transaction: Hex },
  reader: EvmReader,
): Promise<{ receipt: EvmReceipt; transfers: { from: Hex; to: Hex; value: bigint }[] } | EvmBreadthStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (receipt === null) return { state: "pending", why: "not-found" };
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return { state: "pending", why: "unreadable" };
  if (receipt.status === 0) return { state: "failed", why: "reverted" };

  let missing: "binding-log-not-found" | "transfer-not-found" | undefined;
  let transfers: { from: Hex; to: Hex; value: bigint }[] = [];
  if (ref.bindingLog !== undefined && !receipt.logs.some((l) => carriesBinding(l, ref.bindingLog!))) {
    missing = "binding-log-not-found";
  } else if (ref.transferLog !== undefined) {
    transfers = await transfersOf(receipt.logs, ref.transferLog);
    if (ref.bindingLog !== undefined && pairsAuthorization(ref.bindingLog, ref.transferLog)) {
      const authorizers = authorizersOf(receipt.logs, ref.bindingLog);
      transfers = transfers.filter((t) => authorizers.includes(t.from));
    }
    if (transfers.length === 0) missing = "transfer-not-found";
  }
  if (missing !== undefined) {
    const token = ref.transferLog?.address ?? ref.bindingLog?.address;
    if (token !== undefined && receipt.logs.some((l) => isGuardTransfer(l, token))) {
      return { state: "failed", why: "receive-policy-blocked" };
    }
    return { state: "failed", why: missing };
  }
  return { receipt, transfers };
}

/** True where the binding log is `AuthorizationUsed` with its nonce in topic 2 and the transfer log names `from`. */
function pairsAuthorization(b: NonNullable<EvmRef["bindingLog"]>, t: TransferLog): boolean {
  return sameBytes(b.topic0, AUTHORIZATION_USED_TOPIC) && "index" in b && b.index === 2 &&
    t.identity.split(",").includes("from");
}

/** keccak256("authorizationState(address,bytes32)")[0..4] */
export const AUTHORIZATION_STATE_SELECTOR = "0xe94a0102" as const;
/** keccak256("nonceBitmap(address,uint256)")[0..4] */
export const NONCE_BITMAP_SELECTOR = "0x4fe02b44" as const;

/**
 * Whether `authorizer` had used the payment's pull authorization, `ref.authorization`, in the state after block
 * `block`: one `eth_call` to `authorization.at`, of `authorizationState(authorizer, nonce)` for `eip3009`, or of
 * `nonceBitmap(authorizer, nonce >> 8)` for `permit2`, whose bit `nonce & 0xff` is then read. A reader for another
 * network than `ref.network` is `evm/wrong-reader`. A failed call, or an answer that is not one 32-byte word (for
 * `eip3009`, one holding 0 or 1), is `evm/unreadable`. A ref with no well-formed `authorization`, an authorizer that
 * is not an address, or a block that is not a non-negative bigint is `evm/field-malformed`.
 */
export async function authorizationUsed(
  ref: Pick<EvmRef, "network" | "authorization">,
  authorizer: Hex,
  block: bigint,
  reader: EvmReader,
): Promise<boolean | Refusal> {
  if (typeof ref !== "object" || ref === null) return refusal("evm/field-malformed");
  const auth = ref.authorization;
  if (!isPullAuthorization(auth) || !isAddress(authorizer) || typeof block !== "bigint" || block < 0n) {
    return refusal("evm/field-malformed");
  }
  if (typeof reader !== "object" || reader === null || reader.network !== ref.network) return refusal("evm/wrong-reader");
  const nonce = BigInt(auth.nonce);
  const data =
    auth.scheme === "eip3009"
      ? hexOf(concat([bytesOf(AUTHORIZATION_STATE_SELECTOR)!, addressWord(authorizer), uintWord(nonce)]))
      : hexOf(concat([bytesOf(NONCE_BITMAP_SELECTOR)!, addressWord(authorizer), uintWord(nonce >> 8n)]));
  let answer: unknown;
  try {
    answer = await reader.call(auth.at, data, block);
  } catch {
    return refusal("evm/unreadable");
  }
  const word = bytesOf(answer, 32);
  if (word === undefined || word.length !== 32) return refusal("evm/unreadable");
  const v = uintOf(word);
  if (auth.scheme === "eip3009") return v <= 1n ? v === 1n : refusal("evm/unreadable");
  return ((v >> (nonce & 0xffn)) & 1n) === 1n;
}

/** True for a `PullAuthorization` whose members are well formed. */
function isPullAuthorization(a: unknown): a is PullAuthorization {
  if (typeof a !== "object" || a === null) return false;
  const { scheme, at, nonce, deadline, asset } = a as Record<string, unknown>;
  return (
    (scheme === "eip3009" || scheme === "permit2") &&
    isAddress(at) &&
    isAddress(asset) &&
    typeof nonce === "string" &&
    /^0x[0-9a-f]{64}$/.test(nonce) &&
    uint256Of(deadline) !== undefined
  );
}

/** True for a `TransferLog` whose members are well formed. */
function isTransferLog(t: unknown): t is TransferLog {
  if (typeof t !== "object" || t === null) return false;
  const { address, topic0, identity, digest } = t as Record<string, unknown>;
  return (
    isAddress(address) &&
    bytesOf(topic0)?.length === 32 &&
    ["from,to,value", "from,to", "from", "to,value", "to"].includes(identity as string) &&
    bytesOf(digest)?.length === 32
  );
}

/** Settled at the highest finality mark whose block is at or above `at`; a failed mark read counts as not reached. */
export async function settledAt(at: bigint, reader: EvmReader): Promise<EvmStatus & { state: "settled" }> {
  const finalized = await mark(reader, "finalized");
  if (finalized !== null && finalized >= at) return { state: "settled", finality: "finalized", blockNumber: at };
  const safe = await mark(reader, "safe");
  if (safe !== null && safe >= at) return { state: "settled", finality: "safe", blockNumber: at };
  return { state: "settled", finality: "latest", blockNumber: at };
}

/** A log from `address` whose topic `index`, or data word `dataWord`, equals `value` by bytes, under `topic0`. */
export function carriesBinding(log: EvmLog, b: NonNullable<EvmRef["bindingLog"]>): boolean {
  if (!sameAddress(log.address, b.address) || !sameBytes(log.topics[0], b.topic0)) return false;
  if ("index" in b) return sameBytes(log.topics[b.index], b.value);
  const data = bytesOf(log.data);
  const w = data === undefined ? undefined : wordAt(data, b.dataWord);
  return w !== undefined && sameBytes(hexOf(w), b.value);
}

/** The transfers among `logs` that `t` identifies: from its emitter, under its topic, whose named fields hash to its digest. */
async function transfersOf(logs: readonly EvmLog[], t: TransferLog): Promise<{ from: Hex; to: Hex; value: bigint }[]> {
  const out: { from: Hex; to: Hex; value: bigint }[] = [];
  for (const log of logs) {
    const parts = transferParts(log, t.address, t.topic0);
    if (parts === undefined) continue;
    const fields = t.identity.split(",");
    const digest = await transferDigest({
      ...(fields.includes("from") ? { from: parts.from } : {}),
      ...(fields.includes("to") ? { to: parts.to } : {}),
      ...(fields.includes("value") ? { value: parts.value } : {}),
    });
    if (typeof digest === "string" && sameBytes(digest, t.digest)) out.push(parts);
  }
  return out;
}

/**
 * `from` and `to` from topics 1 and 2 (their low 20 bytes) and `value` from data word 0, for a log from `address`
 * under `topic0`. An ERC-20 `Transfer` has exactly three topics; an event that also indexes a memo has four.
 */
export function transferParts(log: EvmLog, address: Hex, topic0: Hex): { from: Hex; to: Hex; value: bigint } | undefined {
  if (!sameAddress(log.address, address) || !sameBytes(log.topics[0], topic0)) return undefined;
  const expected = sameBytes(topic0, TRANSFER_TOPIC) ? 3 : 4;
  if (log.topics.length !== expected) return undefined;
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  const data = bytesOf(log.data);
  const w = data === undefined ? undefined : wordAt(data, 0);
  if (from === undefined || to === undefined || w === undefined) return undefined;
  return { from, to, value: uintOf(w) };
}

/** A `Transfer` log from `token` whose recipient is `RECEIVE_POLICY_GUARD`: a transfer a Tempo receive policy blocked. */
export function isGuardTransfer(log: EvmLog, token: Hex): boolean {
  const p = transferParts(log, token, TRANSFER_TOPIC);
  return p !== undefined && sameAddress(p.to, RECEIVE_POLICY_GUARD);
}

function topicAddress(t: unknown): Hex | undefined {
  const b = bytesOf(t);
  return b === undefined || b.length !== 32 ? undefined : hexOf(b.subarray(12));
}

function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && isAddress(a) && a.toLowerCase() === b.toLowerCase();
}

/** True for a log with a string address, string topics and string data. */
export function isLog(l: unknown): l is EvmLog {
  if (typeof l !== "object" || l === null) return false;
  const { address, topics, data } = l as Record<string, unknown>;
  return typeof address === "string" && Array.isArray(topics) && topics.every((t) => typeof t === "string") &&
    typeof data === "string";
}

/**
 * Recovers H from a settlement transaction through MetaMask's DelegationManager: among its `RedeemedDelegation` logs,
 * the leaves are those whose data word 1 (the delegate) is the redeemer in topic 2 or the wildcard delegate; exactly
 * one distinct leaf salt (data word 5) is H. One call.
 */
export async function redeemedLeafRecover(
  ref: { network: Eip155; transaction: Hex },
  reader: EvmReader,
): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("evm/wrong-reader");
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return refusal("evm/unreadable");
  }
  if (receipt === null) return refusal("evm/not-found");
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return refusal("evm/unreadable");
  if (receipt.status === 0) return refusal("evm/reverted");
  const salts = new Set<AtrHash>();
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, DELEGATION_MANAGER) || !sameBytes(log.topics[0], REDEEMED_DELEGATION_TOPIC)) continue;
    const redeemer = topicAddress(log.topics[2]);
    const data = bytesOf(log.data);
    const delegateWord = data === undefined ? undefined : wordAt(data, 1);
    const saltWord = data === undefined ? undefined : wordAt(data, 5);
    const delegate = delegateWord === undefined ? undefined : addressOfWord(delegateWord);
    if (redeemer === undefined || delegate === undefined || saltWord === undefined) continue;
    if (delegate !== redeemer && delegate !== ANY_DELEGATE) continue;
    salts.add(hexOf(saltWord));
  }
  if (salts.size === 0) return refusal("evm/no-leaf");
  if (salts.size > 1) return refusal("evm/ambiguous");
  return [...salts][0]!;
}

// ── Permit2 typed data.

export interface Permit2TypedData {
  domain: { name: "Permit2"; chainId: number; verifyingContract: Hex };
  types: { EIP712Domain: Field[]; TokenPermissions: Field[]; [witness: string]: Field[] };
  primaryType: "PermitTransferFrom" | "PermitWitnessTransferFrom" | "PermitBatchWitnessTransferFrom";
  message: {
    permitted: { token: Hex; amount: bigint } | { token: Hex; amount: bigint }[];
    spender: Hex;
    nonce: bigint;
    deadline: bigint;
    witness?: { [k: string]: Json };
  };
}

const WITNESS_TYPE_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

/**
 * Permit2's typed data under its domain (`name` "Permit2", no version). No witness gives `PermitTransferFrom`; a
 * witness gives `PermitWitnessTransferFrom`, or `PermitBatchWitnessTransferFrom` when `permitted` is an array.
 */
export function permit2TypedData(a: {
  chainId: number;
  permitted: { token: Hex; amount: bigint } | readonly { token: Hex; amount: bigint }[];
  spender: Hex;
  nonce: bigint;
  deadline: bigint;
  verifyingContract?: Hex;
  witness?: { type: string; fields: readonly Field[]; value: { [k: string]: Json } };
}): Permit2TypedData | Refusal {
  if (!Number.isSafeInteger(a.chainId) || a.chainId <= 0) return refusal("evm/network-malformed");
  const verifyingContract = a.verifyingContract ?? PERMIT2;
  if (!isAddress(verifyingContract) || !isAddress(a.spender)) return refusal("evm/field-malformed");
  if (!isUint256(a.nonce) || !isUint256(a.deadline)) return refusal("evm/field-malformed");
  const list = Array.isArray(a.permitted) ? (a.permitted as readonly { token: Hex; amount: bigint }[]) : undefined;
  const entries = list ?? [a.permitted as { token: Hex; amount: bigint }];
  if (entries.length === 0 || entries.length > 32) return refusal("evm/field-malformed");
  for (const p of entries) {
    if (!isAddress(p.token)) return refusal("evm/field-malformed");
    if (!isUint256(p.amount)) return refusal("evm/amount-malformed");
  }
  const tokenPermissions: Field[] = [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ];
  const domain = { name: "Permit2" as const, chainId: a.chainId, verifyingContract };
  const EIP712Domain: Field[] = [
    { name: "name", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ];
  const permitted = list ? entries.map((p) => ({ token: p.token, amount: p.amount })) : { ...entries[0]! };
  if (a.witness === undefined) {
    if (list) return refusal("evm/field-malformed");
    return {
      domain,
      types: {
        EIP712Domain,
        TokenPermissions: tokenPermissions,
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "PermitTransferFrom",
      message: { permitted, spender: a.spender, nonce: a.nonce, deadline: a.deadline },
    };
  }
  const w = a.witness;
  if (!WITNESS_TYPE_NAME.test(w.type) || w.type === "TokenPermissions" || w.type.startsWith("Permit")) {
    return refusal("evm/field-malformed");
  }
  const primaryType = list ? "PermitBatchWitnessTransferFrom" : "PermitWitnessTransferFrom";
  return {
    domain,
    types: {
      EIP712Domain,
      TokenPermissions: tokenPermissions,
      [primaryType]: [
        { name: "permitted", type: list ? "TokenPermissions[]" : "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "witness", type: w.type },
      ],
      [w.type]: w.fields.map((f) => ({ name: f.name, type: f.type })),
    },
    primaryType,
    message: { permitted, spender: a.spender, nonce: a.nonce, deadline: a.deadline, witness: { ...w.value } },
  };
}

// ── The commerce-payments escrow.

export interface PaymentInfo {
  operator: Hex;
  payer: Hex;
  receiver: Hex;
  token: Hex;
  maxAmount: bigint;
  preApprovalExpiry: bigint;
  authorizationExpiry: bigint;
  refundExpiry: bigint;
  minFeeBps: number;
  maxFeeBps: number;
  feeReceiver: Hex;
  salt: Hex;
}

/** keccak256(abi.encode(SALT_BINDING_TYPEHASH, receiverAuthorizer, policy, h)). */
export function bindSalt(receiverAuthorizer: Hex, policy: Hex, h: AtrHash): Hex | Refusal {
  const salt = normalHash(h);
  if (!isAddress(receiverAuthorizer) || !isAddress(policy) || salt === null) return refusal("evm/field-malformed");
  return keccakHex(
    concat([bytes32Word(SALT_BINDING_TYPEHASH), addressWord(receiverAuthorizer), addressWord(policy), bytes32Word(salt)]),
  );
}

/**
 * The escrow's `getHash`: keccak256(abi.encode(chainId, escrow, keccak256(abi.encode(PAYMENT_INFO_TYPEHASH, p)))).
 * With `payer` zero it is x402's `signatureNonce`.
 */
export function paymentHash(chainId: number, escrow: Hex, p: PaymentInfo): Hex | Refusal {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !isAddress(escrow)) return refusal("evm/field-malformed");
  for (const a of [p.operator, p.payer, p.receiver, p.token, p.feeReceiver]) {
    if (!isAddress(a)) return refusal("evm/field-malformed");
  }
  const within = (v: unknown, bits: bigint) => typeof v === "bigint" && v >= 0n && v < 1n << bits;
  if (!within(p.maxAmount, 120n)) return refusal("evm/amount-malformed");
  for (const t of [p.preApprovalExpiry, p.authorizationExpiry, p.refundExpiry]) {
    if (!within(t, 48n)) return refusal("evm/field-malformed");
  }
  for (const f of [p.minFeeBps, p.maxFeeBps]) {
    if (!Number.isSafeInteger(f) || f < 0 || f >= 65536) return refusal("evm/field-malformed");
  }
  const salt = normalHash(p.salt);
  if (salt === null) return refusal("evm/field-malformed");
  const info = keccak(
    concat([
      bytes32Word(PAYMENT_INFO_TYPEHASH),
      addressWord(p.operator),
      addressWord(p.payer),
      addressWord(p.receiver),
      addressWord(p.token),
      uintWord(p.maxAmount),
      uintWord(p.preApprovalExpiry),
      uintWord(p.authorizationExpiry),
      uintWord(p.refundExpiry),
      uintWord(BigInt(p.minFeeBps)),
      uintWord(BigInt(p.maxFeeBps)),
      addressWord(p.feeReceiver),
      bytes32Word(salt),
    ]),
  );
  return keccakHex(concat([uintWord(BigInt(chainId)), addressWord(escrow), info]));
}
