/**
 * MPP's `session` on EVM and Tempo, and `subscription` on Tempo: channel pairings, each bound where its channel or
 * subscription opens. On the sessions the payer-signed channel salt is H; on the subscription the payer's root key
 * signs a key authorization whose witness is H. Nothing here reads a voucher's amount, a top-up or a renewal; a later
 * request is classified by `channel.kind`, and on Tempo v2 `channel.boundWithin` reads its descriptor's salt.
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import {
  addressOfWord,
  addressWord,
  bytes32Word,
  bytesOf,
  concat,
  hexOf,
  keccakHex,
  sameBytes,
  uintWord,
  wordAt,
  type Hex,
} from "./evm-abi.js";
import {
  AUTHORIZATION_USED_TOPIC,
  PERMIT2,
  TRANSFER_TOPIC,
  evmStatus,
  permit2TypedData,
  transferDigest,
  type EvmBreadthStatus,
  type EvmLog,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type Permit2TypedData,
} from "./evm.js";
import { isAddress, normalHash, uint256Of } from "./fields.js";
import {
  chosenHeld,
  credentialOf,
  decodeObject,
  deepFreeze,
  didPkhAddress,
  echoedFor,
  expiresOf,
  isChallengeShape,
  isHexBytes,
  isObject,
  issuedFor,
  measured,
  measuring,
  measuringAsync,
  place,
  read,
  requestAddress,
  subscriptionPeriod,
  tie,
  unixOf,
  type Checked,
  type Echoed,
  type MppChallenge,
  type MppChoice,
  type MppCredential,
} from "./mpp-challenge.js";
import {
  failedAt,
  failedIfFinal,
  finalAt,
  isLog,
  isReceipt,
  receiveTypedData,
  transferParts,
  type ReceiveTypedData,
} from "./internal/evm.js";
import type { HederaVoucherTypedData } from "./internal/hedera-session.js";
import { readKeyAuthorization, type KeyAuthorizationRead } from "./internal/key-authorization.js";
import { keyAccount } from "./internal/tempo.js";
import { authorizationSignatures, tempoSender } from "./internal/tempo-envelope.js";
import { readReceiptAtMark } from "./receipt.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { rlpBytes, rlpList } from "./rlp.js";
import {
  ACCESS_KEY_SPEND_TOPIC,
  ACCOUNT_KEYCHAIN,
  CHANNEL_CLOSED_V1_TOPIC,
  CHANNEL_CLOSED_V2_TOPIC,
  CHANNEL_OPENED_V1_TOPIC,
  CHANNEL_OPENED_V2_TOPIC,
  KEY_AUTHORIZATION_WITNESS_TOPIC,
  KEY_REVOKED_TOPIC,
  OPEN_V1_SELECTOR,
  OPEN_V2_SELECTOR,
  TIP20_CHANNEL_RESERVE,
  TRANSFER_WITH_MEMO_SELECTOR,
  decodeTempoTx,
  encodeKeyAuthorization,
  expiringNonceHash,
  tempoChannelId,
  witnessRecover,
  type KeyAuthorizationUnsigned,
  type TempoKeyAuthorization,
} from "./tempo.js";
import type { LcpPattern } from "./x402.js";

export type { ReceiveTypedData } from "./internal/evm.js";

/**
 * The buyer's inputs to `build`. `build` checks their form and that the chosen challenge's id carries H; it compares no
 * deal value.
 */
export interface SessionChoice extends MppChoice {
  /** sessions: the buyer's deposit; `suggestedDeposit` is advice. */
  deposit?: bigint;
  /** sessions: default the zero address, which means the payer. */
  authorizedSigner?: Hex;
  /** EVM: default the first listed type. */
  credentialType?: "authorization" | "permit2" | "hash";
}

export interface VoucherTypedData {
  domain: {
    name: "EVM Payment Channel" | "Tempo Stream Channel" | "TIP20 Channel Reserve";
    version: "1";
    chainId: number;
    verifyingContract: Hex;
  };
  primaryType: "Voucher";
  types: { Voucher: [{ name: "channelId"; type: "bytes32" }, { name: "cumulativeAmount"; type: "uint128" | "uint96" }] };
  message: { channelId: Hex; cumulativeAmount: bigint };
}

export type SessionUnsigned = {
  funding:
    | { kind: "eip712"; typedData: ReceiveTypedData | Permit2TypedData }
    | { kind: "evm-calls"; chainId: number; calls: { to: Hex; data: Hex }[]; broadcast: true }
    | { kind: "tempo-call"; chainId: number; call: { to: Hex; data: Hex }; validBefore: number; broadcast: false };
  /**
   * `funded`: the funding signature, transaction hash or signed `0x76` transaction. A `tempo-call` funding's `complete`
   * returns no credential `bound` refuses: it gives the code `bound` gives the credential it would give for the signed
   * transaction, and `voucher` refuses the same transactions, with the shortest voucher signature `complete` takes, one
   * byte. So both refuse a transaction that does not decode, an empty one among them, is signed for a chain other than
   * `funding.chainId`, whose signature gives no sender (a keychain signature of type `0x03` among them), or whose
   * `aa_authorization_list` holds an entry that is not a list of four items ending in a signature or one signed with
   * a keychain signature of type `0x03` (`tempo/tx-malformed`); one without the `open` call `funding.call` describes,
   * to its escrow with H as its salt; one whose sender is not the build's `from`, or whose `open` call names another
   * payee, operator, token or authorizedSigner, which the credential's descriptor or channel id names; and one whose
   * credential is over the credential size bound (`mpp/credential-malformed`). On an `eip712` or `evm-calls` funding,
   * `voucher` likewise gives what `complete` gives `funded` with a one-byte voucher signature where that is a refusal:
   * a funding signature or hash not in the form `complete` takes, or a credential over the credential size bound,
   * each `mpp/credential-malformed`.
   */
  voucher(funded: Hex): VoucherTypedData | Refusal;
  /**
   * The opening's credential for `funded` and the voucher signature. On every funding it is measured as `bound`
   * measures every credential, its echoed challenge included: one over the credential size bound, 64 KiB, is
   * `mpp/credential-malformed`, the code `bound` gives it.
   */
  complete(funded: Hex, voucherSignature: Hex): MppCredential | Refusal;
};

/** The settlement read keys of these pairings. */
export interface SessionRef extends EvmRef {
  /** The transaction the credential presents, where the payer broadcast the opening before the claim. */
  transaction?: Hex;
  opened?: { address: Hex; version: "v1" | "v2"; channel: Hex; h: AtrHash; chainId: number };
  /**
   * The opening of an EVM session of type `hash` or `permit2`: the escrow's open call whose salt is `h`, and whose
   * payer, payee, token and authorized signer, with `h`, the escrow and `chainId`, give `channel`.
   */
  opens?: { escrow: Hex; channel: Hex; h: AtrHash; chainId: number };
  /** The close of an EVM session: a call to `escrow` of one of `EVM_CLOSE_SELECTORS` naming `channel`. */
  closes?: { escrow: Hex; channel: Hex };
  /**
   * The subscription's access key: its id, the token it spends, and `transferDigest({to: recipient})`. With `account`,
   * the read keys of a transfer made under the key for that account.
   */
  accessKey?: { keyId: Hex; token: Hex; to: Hex; account?: Hex };
  /** The close of a subscription: the account keychain's `KeyRevoked` whose topic 1 is `account` and topic 2 `keyId`. */
  revokes?: { account: Hex; keyId: Hex };
}

export type SessionStatus =
  | EvmBreadthStatus
  | { state: "pending"; why: "not-a-close" | "open-call-not-found" }
  | { state: "failed"; why: "open-call-not-found" };

/**
 * The buyer's inputs to an in-channel payment: the within 402's challenge, echoed as given; the held opening, exactly
 * as signed; the cumulative amount to sign; and the action. On `mpp/session/solana`, the held opening is the credential
 * `fetchPresented` returned, with its tables under `FETCHED`, or a spread or `Object.assign` copy of it, kept for the
 * life of the channel: a later read gives each address lookup table as it stands then, and once the table's authority
 * deactivates or closes it no tables can be read.
 */
export interface SessionWithin {
  challenge: MppChallenge & { id: string };
  opening: MppCredential;
  cumulativeAmount: bigint;
  action: "voucher" | "close";
}

/** A request to the buyer's signer for an in-channel payment. */
export type WithinSigningRequest =
  | { kind: "eip712"; typedData: VoucherTypedData | HederaVoucherTypedData }
  | { kind: "ed25519-raw"; message: Uint8Array<ArrayBuffer>; signer: string }
  | { kind: "xrpl-claim"; channelId: string; drops: bigint; bytes: Uint8Array<ArrayBuffer> };

/**
 * One signing request; `complete` takes its one signature and returns the in-channel credential, measured as `bound`
 * measures every credential: one over the credential size bound, 64 KiB, its challenge included, is
 * `mpp/credential-malformed`, as each session pairing's `channel.kind`, `channel.ref` and `channel.boundWithin`
 * refuse it.
 */
export interface SessionWithinUnsigned {
  requests: readonly WithinSigningRequest[];
  complete(signatures: readonly string[]): MppCredential | Refusal;
}

/**
 * The checks `buildWithin` makes on its input before any channel value is read, in the input's member order: the
 * within challenge's shape and its intent and method; the opening, by `opened`, bound to `h`; the cumulative amount
 * below `limit`; and the action, `voucher` or `close`. `notBuilt` lists the actions the pairing's draft defines within
 * a channel that `buildWithin` does not build: each is `mpp/within-action-not-built`, and an action neither built nor
 * listed is `mpp/session-action`, as the pairing's `channel.kind` answers an action its draft does not define.
 */
export async function withinChecks<O>(
  w: SessionWithin,
  h: AtrHash,
  intentAndMethod: string,
  opened: (opening: MppCredential) => Promise<(O & { h: AtrHash }) | Refusal>,
  limit: bigint,
  notBuilt: readonly string[],
): Promise<O | Refusal> {
  if (!isObject(w)) return refusal("mpp/input-malformed");
  const c = w.challenge;
  if (!isChallengeShape(c) || typeof c.id !== "string") return refusal("mpp/input-malformed");
  if (`${c.intent}/${c.method}` !== intentAndMethod) return refusal("mpp/not-this-pairing");
  const o = await opened(w.opening);
  if (isRefusal(o)) return o;
  if (typeof h !== "string" || normalHash(h) === null || !hashEquals(o.h, h)) return refusal("mpp/id-not-ours");
  if (typeof w.cumulativeAmount !== "bigint" || w.cumulativeAmount < 0n || w.cumulativeAmount >= limit) {
    return refusal("mpp/input-malformed");
  }
  if (notBuilt.includes(w.action as string)) return refusal("mpp/within-action-not-built");
  if (w.action !== "voucher" && w.action !== "close") return refusal("mpp/session-action");
  return o;
}

/** The one signature of a within `complete`: `0x` and 1 to 8192 bytes of hex. */
function oneHexSignature(signatures: readonly string[]): Hex | Refusal {
  if (!Array.isArray(signatures) || signatures.length !== 1) return refusal("mpp/credential-malformed");
  const [s] = signatures;
  return isHexBytes(s, 1, MAX_SIGNATURE) ? s : refusal("mpp/credential-malformed");
}

const SESSION_EVM = "mpp/session/evm" as const;
const SESSION_TEMPO = "mpp/session/tempo" as const;
const SUBSCRIPTION = "mpp/subscription/tempo" as const;
type ChannelId = typeof SESSION_EVM | typeof SESSION_TEMPO | typeof SUBSCRIPTION;

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const APPROVE_SELECTOR = "0x095ea7b3";
/**
 * The calls whose rule names a subscription's recipient: `transfer(address,uint256)` and `transferWithMemo(address,
 * uint256,bytes32)`, the selectors Tempo's subscription draft lets the access key call.
 */
const TRANSFER_SELECTORS: readonly Hex[] = ["0xa9059cbb", TRANSFER_WITH_MEMO_SELECTOR];
/**
 * The EVM session escrow's functions that finalize a channel, each taking the channel id as its first argument:
 * `close(bytes32,uint128,bytes)`, `closeWithAuthorization(bytes32,uint128,uint256,uint256,bytes,bytes)` and
 * `withdraw(bytes32)`.
 */
export const EVM_CLOSE_SELECTORS = Object.freeze(["0x0d65c51d", "0x79d35ded", "0x8e19899e"] as const);
const TEMPO_V1_DEFAULT_CHAIN = 4217;
const MAX_SIGNATURE = 8192;
/** The shortest voucher signature `complete` takes: one byte. */
const SHORTEST_SIGNATURE = "0x00";
const MAX_WIRE = 65_536;
/** `open(address,address,uint128,bytes32,address)`: the selector and five words. */
const OPEN_CALL_BYTES = 164;
/** keccak256("openWithPermit2(address,address,uint128,bytes32,address,address,uint256,uint256,bytes)")[0..4]. */
const OPEN_WITH_PERMIT2_SELECTOR = "0x70981fe5";
/**
 * keccak256("openWithAuthorization(address,address,uint128,bytes32,address,address,uint256,uint256,bytes32,bytes)")[0..4].
 */
const OPEN_WITH_AUTHORIZATION_SELECTOR = "0xb82a39ba";
/**
 * The calldata an opening's read decodes, at most 128 KiB, go-ethereum's transaction pool maximum for a whole
 * transaction (`core/txpool/legacypool/legacypool.go`, `txMaxSize = 4 * txSlotSize // 128KB`). A transaction with
 * longer calldata is not an opening the read decodes: `status` answers it pending `open-call-not-found`, as any other
 * transaction, and `recover` refuses it `evm/no-open-call`, since the calldata is the transaction's own and every read
 * gives the same.
 */
const MAX_CALLDATA = 131_072;
const U96 = 1n << 96n;
const U128 = 1n << 128n;
/** The access key types a subscription challenge names, as Tempo's account keychain numbers them (`SignatureType`). */
const KEY_TYPES = { secp256k1: 0, p256: 1, webAuthn: 2 } as const;

// ── Channel ids.

/** keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)); also Tempo v1's. */
export function evmChannelId(c: {
  payer: Hex;
  payee: Hex;
  token: Hex;
  salt: Hex;
  authorizedSigner: Hex;
  escrow: Hex;
  chainId: number;
}): Hex | Refusal {
  if (!isObject(c)) return refusal("mpp/input-malformed");
  const salt = normalHash(c.salt);
  for (const a of [c.payer, c.payee, c.token, c.authorizedSigner, c.escrow]) {
    if (!isAddress(a)) return refusal("mpp/input-malformed");
  }
  if (salt === null || !Number.isSafeInteger(c.chainId) || c.chainId <= 0) return refusal("mpp/input-malformed");
  return keccakHex(
    concat([
      addressWord(c.payer),
      addressWord(c.payee),
      addressWord(c.token),
      bytes32Word(salt),
      addressWord(c.authorizedSigner),
      addressWord(c.escrow),
      uintWord(BigInt(c.chainId)),
    ]),
  );
}

// ── The session parameters of a challenge, read without the offer checks (for later requests too).

interface Params {
  method: "evm" | "tempo";
  intent: "session" | "subscription";
  chainId: number;
  network: `eip155:${number}`;
  escrow: Hex;
  version: "v1" | "v2";
  request: { [k: string]: Json };
  details: { [k: string]: Json };
}

/**
 * The chain, escrow and protocol version an EVM or Tempo session or subscription challenge names. A `methodDetails`
 * that is present and not an object is `mpp/request-malformed`, never read as empty. On a Tempo session,
 * `sessionProtocol` is absent, `v1` or `v2`, else `mpp/session-protocol`, and a missing `chainId` reads as Tempo's
 * default chain on v1 only: a v2 session without `chainId` or `escrowContract` is `mpp/chain-id-required`, the codes
 * `advertise` gives.
 */
function paramsOf(c: unknown): Params | Refusal {
  if (!isObject(c) || typeof c["request"] !== "string") return refusal("mpp/credential-malformed");
  const method = c["method"];
  const intent = c["intent"];
  if (!((intent === "session" && (method === "evm" || method === "tempo")) || (intent === "subscription" && method === "tempo"))) {
    return refusal("mpp/not-this-pairing");
  }
  const request = decodeObject(c["request"]);
  if (request === undefined) return refusal("mpp/request-malformed");
  const md = request["methodDetails"];
  if (md !== undefined && !isObject(md)) return refusal("mpp/request-malformed");
  const details = (md ?? {}) as { [k: string]: Json };
  const tempoSession = method === "tempo" && intent === "session";
  const protocol = details["sessionProtocol"];
  if (tempoSession && protocol !== undefined && protocol !== "v1" && protocol !== "v2") return refusal("mpp/session-protocol");
  if (tempoSession && protocol === "v2" && (details["chainId"] === undefined || details["escrowContract"] === undefined)) {
    return refusal("mpp/chain-id-required");
  }
  const rawChain = details["chainId"];
  const chainId =
    typeof rawChain === "number" && Number.isSafeInteger(rawChain) && rawChain > 0
      ? rawChain
      : tempoSession && protocol !== "v2" && rawChain === undefined
        ? TEMPO_V1_DEFAULT_CHAIN
        : undefined;
  if (chainId === undefined) return refusal("mpp/chain-id-required");
  const version = protocol === "v2" ? "v2" : "v1";
  const escrow = details["escrowContract"];
  if (intent === "session" && !isAddress(escrow)) return refusal("mpp/escrow-malformed");
  return {
    method,
    intent,
    chainId,
    network: `eip155:${chainId}`,
    escrow: (isAddress(escrow) ? escrow : ZERO) as Hex,
    version,
    request,
    details,
  };
}

/** The CAIP-2 network of an EVM or Tempo session or subscription challenge. */
export function sessionNetwork(c: MppChallenge): `eip155:${number}` | Refusal {
  const p = paramsOf(c);
  return isRefusal(p) ? p : p.network;
}

// ── Shared steps.

/**
 * The checked challenge `build` answers: a challenge (else `mpp/challenge-malformed`) with a string id (else
 * `mpp/id-not-ours`), held as `bound` holds an echoed one (`chosenHeld`), whose id carries `h`, and `from` an address.
 */
function offerFor(choice: MppChoice, h: AtrHash, pairing: ChannelId): Checked | Refusal {
  if (!isObject(choice) || !isObject(choice.challenge)) return refusal("mpp/input-malformed");
  const c = choice.challenge;
  if (!isChallengeShape(c)) return refusal("mpp/challenge-malformed");
  if (typeof c.id !== "string") return refusal("mpp/id-not-ours");
  const held = chosenHeld(c, pairing);
  if (isRefusal(held)) return held;
  if (typeof h !== "string" || !hashEquals(held.h, h)) return refusal("mpp/id-not-ours");
  if (!isAddress(choice.from)) return refusal("mpp/input-malformed");
  return held.checked;
}

/** H from an echoed challenge of `pairing`'s intent and method, with the echoed challenge and the payload. */
function echoed(
  presented: MppCredential,
  pairing: ChannelId,
): { h: AtrHash; checked: Echoed; payload: { [k: string]: Json } } | Refusal {
  return echoedFor(presented, pairing);
}

/** MPP's `place`, with the agreement URL in `opaque` when one is given. */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  return place(doc, h, link, offer, agreementUrl);
}

/**
 * The challenge as given: no member of `request` carries H on these pairings. A challenge that carries a `refused`
 * member is `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): Json | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return option as unknown as Json;
}

function payloadOf(presented: MppCredential): { [k: string]: Json } | Refusal {
  if (!isObject(presented) || !isObject(presented.payload)) return refusal("mpp/credential-malformed");
  return presented.payload;
}

function channelOf(payload: { [k: string]: Json }): Hex | Refusal {
  const c = normalHash(payload["channelId"]);
  return c === null ? refusal("mpp/credential-malformed") : c;
}

function str(v: Json | undefined): string {
  return typeof v === "string" ? v : "";
}

function voucherData(
  name: VoucherTypedData["domain"]["name"],
  width: "uint128" | "uint96",
  chainId: number,
  escrow: Hex,
  channelId: Hex,
  cumulativeAmount = 0n,
): VoucherTypedData {
  return {
    domain: { name, version: "1", chainId, verifyingContract: escrow },
    primaryType: "Voucher",
    types: { Voucher: [{ name: "channelId", type: "bytes32" }, { name: "cumulativeAmount", type: width }] },
    message: { channelId, cumulativeAmount },
  };
}

function words(selector: string, parts: readonly Uint8Array[]): Hex {
  return hexOf(concat([bytesOf(selector)!, ...parts]));
}

/**
 * `evmStatus` on the named logs, then, where `ref.opened` is present, one `ChannelOpened` log from `opened.address`
 * naming the channel: on v2 its data word 3 (the salt) is `h`; on v1 the channel id recomputed from the event with
 * salt `h` is the channel. Where `ref.opens` is present, the succeeded transaction, read by `eth_getTransactionByHash`,
 * must be sent to the escrow and hold its open call for the channel: `open` from the payer, or `openWithPermit2` with
 * the payer as its `from`. An open call sent to the escrow that opens another channel is failed `open-call-not-found`
 * where `ref.settleBy` is absent and the receipt's block is at or below the `finalized` mark, and pending otherwise;
 * any other transaction, one sent through an ERC-4337 EntryPoint included, is pending `open-call-not-found`. Where
 * `ref.closes` is present, the
 * succeeded transaction must be a call to that escrow whose calldata starts with one of `EVM_CLOSE_SELECTORS` and
 * whose first argument is that channel, else pending `not-a-close`. Where `ref.accessKey.account` is present, the
 * succeeded receipt must also hold the account keychain's `AccessKeySpend` log naming that account, key and token, else
 * failed `binding-log-not-found`. Where `ref.revokes` is present, the succeeded receipt must hold the account keychain's
 * `KeyRevoked` log naming that account and key, else failed `binding-log-not-found`. Each failed answer, `evmStatus`'s
 * and these, is given only where the receipt's block is at or below the reader's `finalized` mark; above it, or where
 * that mark cannot be read, the same reason is pending. An `opens` that is not an object
 * whose `escrow` is an address, `channel` and `h` 32-byte hashes and `chainId` a positive integer, an `opened` that is
 * not one whose `address` is an address, `version` `v1` or `v2`, `channel` and `h` 32-byte hashes and `chainId` a
 * positive integer, a `closes` that is not an object whose `escrow` is an address and `channel` a 32-byte hash, an
 * `accessKey` that is not an object whose `keyId` and `token` are addresses, `to` a 32-byte hash and `account`, when
 * present, an address, or a `revokes` that is not an object whose `account` and `keyId` are addresses, is pending
 * `unreadable`, with no call made; so is a ref that names none of the keys the three pairings' `reference`, `closeRef`
 * and `keySearch` write for the opening or the close (`opens`, `opened`, `closes`, `revokes`, an `accessKey` with
 * `account`, or a binding log under `AuthorizationUsed`, `ChannelClosed` or `KeyAuthorizationWitness`), and what
 * `evmStatus` reads as `unreadable`. At most four calls.
 *
 * This function accepts a key of any of the three pairings. Each pairing's own `status` reads a ref only when it names
 * one of the keys that pairing writes and none of the other two pairings' keys: on `mpp/session/evm` `opens`, `closes`
 * or a binding log under `AuthorizationUsed`; on `mpp/session/tempo` `opened` or a binding log under `ChannelClosed`;
 * on `mpp/subscription/tempo` `revokes`, an `accessKey` with `account` or a binding log under
 * `KeyAuthorizationWitness`. Any other ref is pending `unreadable` there, with no call made.
 */
export async function sessionStatus(ref: SessionRef & { transaction: Hex }, reader: EvmReader): Promise<SessionStatus> {
  if (typeof reader !== "object" || reader === null || typeof ref !== "object" || ref === null) {
    return { state: "pending", why: "unreadable" };
  }
  if (!names(ref, ALL_READ_KEYS)) return { state: "pending", why: "unreadable" };
  if (ref.revokes !== undefined && !readableRevokes(ref.revokes)) return { state: "pending", why: "unreadable" };
  if (ref.opens !== undefined && !readableOpens(ref.opens)) return { state: "pending", why: "unreadable" };
  if (ref.opened !== undefined && !readableOpened(ref.opened)) return { state: "pending", why: "unreadable" };
  if (ref.closes !== undefined && !readableCloses(ref.closes)) return { state: "pending", why: "unreadable" };
  if (ref.accessKey !== undefined && !readableAccessKey(ref.accessKey)) return { state: "pending", why: "unreadable" };
  let seen: EvmReceipt | null = null;
  const watching: EvmReader = {
    network: reader.network,
    receipt: async (tx) => (seen = await reader.receipt(tx)),
    blockNumber: (tag) => reader.blockNumber(tag),
    transaction: (tx) => reader.transaction(tx),
    call: (to, data, block) => reader.call(to, data, block),
  };
  const s = await evmStatus(ref, watching);
  if (s.state === "settled" && ref.opens !== undefined) return openRead(s, ref, ref.opens, reader);
  if (s.state === "settled" && ref.closes !== undefined) return closeRead(s, ref.transaction, ref.closes, reader);
  if (s.state === "settled" && ref.accessKey?.account !== undefined) {
    return spentUnder((seen as EvmReceipt | null)?.logs ?? [], ref.accessKey) ? s : failedIfFinal(s, "binding-log-not-found");
  }
  if (s.state === "settled" && ref.revokes !== undefined) {
    const { account, keyId } = ref.revokes;
    const revoked = keychainLog((seen as EvmReceipt | null)?.logs ?? [], KEY_REVOKED_TOPIC, [account, keyId]);
    return revoked ? s : failedIfFinal(s, "binding-log-not-found");
  }
  if (s.state !== "settled" || ref.opened === undefined) return s;
  const o = ref.opened;
  const logs = (seen as EvmReceipt | null)?.logs ?? [];
  const opened = logs.some((l) => {
    if (!sameBytes(l.address, o.address) || !sameBytes(l.topics[1], o.channel) || l.topics.length !== 4) return false;
    const data = bytesOf(l.data);
    if (data === undefined) return false;
    const word = (i: number) => (32 * (i + 1) <= data.length ? data.subarray(32 * i, 32 * (i + 1)) : undefined);
    if (o.version === "v2") {
      const salt = word(3);
      return sameBytes(l.topics[0], CHANNEL_OPENED_V2_TOPIC) && salt !== undefined && sameBytes(hexOf(salt), o.h);
    }
    if (!sameBytes(l.topics[0], CHANNEL_OPENED_V1_TOPIC)) return false;
    const token = word(0);
    const signer = word(1);
    const payer = bytesOf(l.topics[2]);
    const payee = bytesOf(l.topics[3]);
    if (token === undefined || signer === undefined || payer?.length !== 32 || payee?.length !== 32) return false;
    const id = evmChannelId({
      payer: hexOf(payer.subarray(12)),
      payee: hexOf(payee.subarray(12)),
      token: hexOf(token.subarray(12)),
      salt: o.h,
      authorizedSigner: hexOf(signer.subarray(12)),
      escrow: o.address,
      chainId: o.chainId,
    });
    return typeof id === "string" && sameBytes(id, o.channel);
  });
  return opened ? s : failedIfFinal(s, "binding-log-not-found");
}

/** A key that ties a status read to the opening or the close, as a writer of these pairings gives it. */
type ReadKey = (ref: SessionRef) => boolean;

/** A `bindingLog` that is an object whose `topic0` is one of `events`. */
function bindingUnder(...events: Hex[]): ReadKey {
  return (ref) => {
    const b: unknown = ref.bindingLog;
    return isObject(b) && events.some((e) => sameBytes(e, b["topic0"]));
  };
}

/**
 * The keys each pairing's `reference`, `closeRef` and `keySearch` write for the opening or the close.
 * `mpp/session/evm`: `opens` (a `hash` or `permit2` opening), the binding log under `AuthorizationUsed` (an EIP-3009
 * opening) and `closes`. `mpp/session/tempo`: `opened` and the binding log under `ChannelClosed`, v1 or v2 (the close).
 * `mpp/subscription/tempo`: the binding log under `KeyAuthorizationWitness` (the activation), an `accessKey` with
 * `account` (`keySearch`) and `revokes` (the close). Without one, no read checks H or the close.
 */
const READ_KEYS: Readonly<Record<typeof SESSION_EVM | typeof SESSION_TEMPO | typeof SUBSCRIPTION, readonly ReadKey[]>> = {
  [SESSION_EVM]: [(ref) => ref.opens !== undefined, bindingUnder(AUTHORIZATION_USED_TOPIC), (ref) => ref.closes !== undefined],
  [SESSION_TEMPO]: [(ref) => ref.opened !== undefined, bindingUnder(CHANNEL_CLOSED_V1_TOPIC, CHANNEL_CLOSED_V2_TOPIC)],
  [SUBSCRIPTION]: [
    bindingUnder(KEY_AUTHORIZATION_WITNESS_TOPIC),
    (ref) => isObject(ref.accessKey) && ref.accessKey["account"] !== undefined,
    (ref) => ref.revokes !== undefined,
  ],
};
const ALL_READ_KEYS: readonly ReadKey[] = Object.values(READ_KEYS).flat();

/** Whether the ref names one of `keys`. */
function names(ref: SessionRef, keys: readonly ReadKey[]): boolean {
  return keys.some((k) => k(ref));
}

/**
 * `status` of one pairing: `sessionStatus` on a ref that names one of the keys the pairing writes (`READ_KEYS`) and
 * none of the other two pairings' keys, since `sessionStatus` reads by whichever key the ref names; any other ref is
 * pending `unreadable`, with no call made.
 */
function pairingStatus(pairing: keyof typeof READ_KEYS): typeof sessionStatus {
  const own = READ_KEYS[pairing];
  const others = Object.entries(READ_KEYS).flatMap(([p, keys]) => (p === pairing ? [] : keys));
  return async (ref, reader) =>
    isObject(ref) && names(ref, own) && !names(ref, others) ? sessionStatus(ref, reader) : { state: "pending", why: "unreadable" };
}

/**
 * Whether `opens` is an object whose `escrow` is an address, `channel` and `h` are 32-byte hashes and `chainId` is a
 * positive safe integer, as `reference` writes it.
 */
function readableOpens(opens: unknown): boolean {
  if (!isObject(opens)) return false;
  const chainId = opens["chainId"];
  return (
    isAddress(opens["escrow"]) &&
    normalHash(opens["channel"]) !== null &&
    normalHash(opens["h"]) !== null &&
    typeof chainId === "number" &&
    Number.isSafeInteger(chainId) &&
    chainId > 0
  );
}

/** Whether `revokes` is an object whose `account` and `keyId` are addresses, as `closeRef` writes it. */
function readableRevokes(revokes: unknown): boolean {
  return isObject(revokes) && isAddress(revokes["account"]) && isAddress(revokes["keyId"]);
}

/**
 * Whether `opened` is an object whose `address` is an address, `version` is `v1` or `v2`, `channel` and `h` are 32-byte
 * hashes and `chainId` is a positive safe integer, as `reference` writes it.
 */
function readableOpened(opened: unknown): boolean {
  if (!isObject(opened)) return false;
  const chainId = opened["chainId"];
  return (
    isAddress(opened["address"]) &&
    (opened["version"] === "v1" || opened["version"] === "v2") &&
    normalHash(opened["channel"]) !== null &&
    normalHash(opened["h"]) !== null &&
    typeof chainId === "number" &&
    Number.isSafeInteger(chainId) &&
    chainId > 0
  );
}

/** Whether `closes` is an object whose `escrow` is an address and `channel` a 32-byte hash, as `closeRef` writes it. */
function readableCloses(closes: unknown): boolean {
  return isObject(closes) && isAddress(closes["escrow"]) && normalHash(closes["channel"]) !== null;
}

/**
 * Whether `accessKey` is an object whose `keyId` and `token` are addresses, `to` a 32-byte hash and `account`, when
 * present, an address, as `reference` and `keySearch` write it.
 */
function readableAccessKey(k: unknown): boolean {
  if (!isObject(k)) return false;
  const account = k["account"];
  const to = normalHash(k["to"]);
  return isAddress(k["keyId"]) && isAddress(k["token"]) && to !== null && (account === undefined || isAddress(account));
}

/** Whether the logs hold the account keychain's `AccessKeySpend` naming the key's account, key id and token. */
function spentUnder(logs: readonly EvmLog[], k: NonNullable<SessionRef["accessKey"]>): boolean {
  return keychainLog(logs, ACCESS_KEY_SPEND_TOPIC, [k.account, k.keyId, k.token]);
}

/** Whether the logs hold an account keychain log whose topics are exactly `topic0` and these addresses, padded. */
function keychainLog(logs: readonly EvmLog[], topic0: Hex, addresses: readonly unknown[]): boolean {
  if (!addresses.every(isAddress)) return false;
  const topics = [topic0, ...addresses.map((a) => hexOf(addressWord(a as Hex)))];
  return logs.some(
    (l) =>
      sameBytes(l.address, ACCOUNT_KEYCHAIN) && l.topics.length === topics.length && topics.every((t, i) => sameBytes(l.topics[i], t)),
  );
}

/**
 * The read keys of a transfer made under the subscription's access key, from a receipt of the key's registration: the
 * account whose key authorization carried `h` and registered the key, then `accessKey` with that account, the token's
 * `Transfer` to the recipient's digest, and the keychain's `AccessKeySpend` filter for the account, the key and the
 * token. Refused when `ref` carries no access key (`tempo/no-access-key`), when `h` is not a 32-byte hash
 * (`mpp/input-malformed`), or when the receipt did not register the key under `h`.
 */
export function keySearch(ref: SessionRef, receipt: EvmReceipt, h: AtrHash): SessionRef | Refusal {
  const k = isObject(ref) ? ref.accessKey : undefined;
  if (!isObject(k) || !isAddress(k.keyId) || !isAddress(k.token) || normalHash(k.to) === null) return refusal("tempo/no-access-key");
  if (normalHash(h) === null) return refusal("mpp/input-malformed");
  const account = keyAccount(receipt, h, k.keyId);
  if (isRefusal(account)) return account;
  const word = (a: Hex) => hexOf(addressWord(a));
  return {
    network: ref.network,
    accessKey: { keyId: k.keyId, token: k.token, to: k.to, account },
    transferLog: { address: k.token, topic0: TRANSFER_TOPIC, identity: "to", digest: k.to },
    search: { address: ACCOUNT_KEYCHAIN, topics: [ACCESS_KEY_SPEND_TOPIC, word(account), word(k.keyId), word(k.token)] },
  };
}

/**
 * The network and channel an EVM or Tempo session challenge names in `methodDetails.channelId`, lowercase as `ref`
 * gives it; null when it names none.
 */
export function evmSessionResume(c: MppChallenge): { network: string; channel: Hex } | null | Refusal {
  const p = paramsOf(c);
  if (isRefusal(p)) return p;
  if (p.intent !== "session") return refusal("mpp/not-this-pairing");
  const named = p.details["channelId"];
  if (named === undefined) return null;
  const channel = normalHash(named);
  return channel === null ? refusal("mpp/request-malformed") : { network: p.network, channel };
}

// ── mpp/session/evm.

type Opening = { type: string; o: { [k: string]: Json } };

/** The opening of an EVM session payload: the `open` payload, or a voucher's `deposit` whose action is `open`. */
function evmOpening(payload: { [k: string]: Json }): Opening | Refusal {
  if (payload["action"] === "open") return { type: str(payload["type"]), o: payload };
  const deposit = payload["deposit"];
  if (payload["action"] === "voucher" && isObject(deposit) && deposit["action"] === "open") {
    return { type: str(deposit["type"]), o: deposit as { [k: string]: Json } };
  }
  return refusal("mpp/not-an-opening");
}

function evmKind(presented: MppCredential): "open" | "within" | "close" | Refusal {
  const p = payloadOf(presented);
  if (isRefusal(p)) return p;
  const action = p["action"];
  if (action === "open") return "open";
  if (action === "voucher") return isObject(p["deposit"]) && p["deposit"]["action"] === "open" ? "open" : "within";
  if (action === "topUp") return "within";
  if (action === "close") return "close";
  return refusal("mpp/session-action");
}

/**
 * The EVM opening's checked values: payer, salt H, signer and the channel id's agreement with them. Of the request it
 * reads the chain, the escrow, the recipient and the currency, which give the channel id.
 */
function evmOpened(
  presented: MppCredential,
): { h: AtrHash; params: Params; payee: Hex; token: Hex; opening: Opening; payer: Hex; escrow: Hex; auth: { [k: string]: Json } } | Refusal {
  const e = echoed(presented, SESSION_EVM);
  if (isRefusal(e)) return e;
  const params = paramsOf(presented.challenge);
  if (isRefusal(params)) return params;
  const payee = requestAddress(e.checked, "recipient");
  if (isRefusal(payee)) return payee;
  const token = requestAddress(e.checked, "currency");
  if (isRefusal(token)) return token;
  const opening = evmOpening(e.payload);
  if (isRefusal(opening)) return opening;
  const { type, o } = opening;
  if (type !== "hash" && type !== "authorization" && type !== "permit2") return refusal("mpp/credential-type");
  const salt = normalHash(o["salt"]);
  if (salt === null) return refusal("mpp/credential-malformed");
  if (!hashEquals(salt, e.h)) return refusal("mpp/salt-not-this-hash");
  const signer = o["authorizedSigner"] ?? ZERO;
  if (!isAddress(signer)) return refusal("mpp/credential-malformed");
  const auth = isObject(o["authorization"]) ? (o["authorization"] as { [k: string]: Json }) : {};
  let payer: Hex | undefined;
  if (type === "hash") {
    payer = didPkhAddress(presented.source);
    if (payer === undefined) return refusal("mpp/source-required");
  } else {
    if (!isAddress(auth["from"])) return refusal("mpp/credential-malformed");
    payer = auth["from"];
  }
  const escrow = params.escrow;
  const expect = evmChannelId({ payer, payee, token, salt: e.h, authorizedSigner: signer, escrow, chainId: params.chainId });
  const channel = normalHash(e.payload["channelId"]);
  if (typeof expect !== "string" || channel === null || !sameBytes(channel, expect)) {
    return refusal("mpp/channel-not-bound");
  }
  if (type === "authorization") {
    const nonce = keccakHex(
      concat([
        addressWord(payer),
        addressWord(payee),
        addressWord(token),
        bytes32Word(e.h),
        addressWord(signer),
      ]),
    );
    if (!sameBytes(auth["nonce"], nonce)) return refusal("mpp/nonce-not-channel");
  }
  if (type === "permit2") {
    const w = auth["witness"];
    const wSalt = isObject(w) ? normalHash(w["salt"]) : null;
    if (wSalt === null || !hashEquals(wSalt, e.h)) return refusal("mpp/salt-not-this-hash");
  }
  return { h: e.h, params, payee, token, opening, payer, escrow, auth };
}

async function evmBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = evmOpened(presented);
  return isRefusal(o) ? o : o.h;
}

async function evmReference(input: unknown): Promise<SessionRef | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = evmOpened(presented);
  if (isRefusal(o)) return o;
  const currency = o.token;
  const network = o.params.network;
  if (o.opening.type === "hash") {
    const transaction = normalHash(o.opening.o["hash"]);
    if (transaction === null) return refusal("mpp/credential-malformed");
    const digest = await transferDigest({ from: o.payer, to: o.escrow });
    if (typeof digest !== "string") return digest;
    const opens = opensOf(o, presented);
    if (isRefusal(opens)) return opens;
    return {
      network,
      transaction: transaction as Hex,
      transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to", digest },
      opens,
    };
  }
  if (o.opening.type === "authorization") {
    const value = uint256Of(o.auth["value"]);
    const validBefore = uint256Of(o.auth["validBefore"]);
    const nonce = normalHash(o.auth["nonce"]);
    if (value === undefined || validBefore === undefined || nonce === null) return refusal("mpp/credential-malformed");
    const digest = await transferDigest({ from: o.payer, to: o.escrow, value });
    if (typeof digest !== "string") return digest;
    return {
      network,
      settleBy: validBefore.toString(),
      bindingLog: { address: currency, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: nonce },
      transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
      search: { address: currency, topics: [AUTHORIZATION_USED_TOPIC, null, nonce] },
    };
  }
  const permitted = o.auth["permitted"];
  const value = isObject(permitted) ? uint256Of(permitted["amount"]) : undefined;
  const deadline = uint256Of(o.auth["deadline"]);
  if (value === undefined || deadline === undefined) return refusal("mpp/credential-malformed");
  const digest = await transferDigest({ from: o.payer, to: o.escrow, value });
  if (typeof digest !== "string") return digest;
  const opens = opensOf(o, presented);
  if (isRefusal(opens)) return opens;
  return {
    network,
    settleBy: deadline.toString(),
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
    opens,
  };
}

/** The open call an opening's reference names: the escrow, the payload's channel, H and the chain. */
function opensOf(o: { h: AtrHash; params: Params; escrow: Hex }, presented: MppCredential): NonNullable<SessionRef["opens"]> | Refusal {
  const channel = normalHash(presented.payload["channelId"]);
  if (channel === null) return refusal("mpp/credential-malformed");
  return { escrow: o.escrow, channel: channel as Hex, h: o.h, chainId: o.params.chainId };
}

async function evmBuild(choice: SessionChoice, h: AtrHash): Promise<SessionUnsigned | Refusal> {
  const o = offerFor(choice, h, SESSION_EVM);
  if (isRefusal(o)) return o;
  const deposit = choice.deposit;
  if (typeof deposit !== "bigint" || deposit <= 0n || deposit >= U128) return refusal("mpp/input-malformed");
  const signer = choice.authorizedSigner ?? ZERO;
  if (!isAddress(signer)) return refusal("mpp/input-malformed");
  const listed = (o.details["credentialTypes"] as string[] | undefined) ?? ["hash"];
  const type = choice.credentialType ?? listed[0];
  if (type === undefined || !listed.includes(type)) return refusal("mpp/credential-types");
  const chainId = o.details["chainId"] as number;
  const escrow = str(o.details["escrowContract"]) as Hex;
  const currency = str(o.request["currency"]) as Hex;
  const recipient = str(o.request["recipient"]) as Hex;
  const from = choice.from;
  const salt = normalHash(h)!;
  const channelId = evmChannelId({ payer: from, payee: recipient, token: currency, salt, authorizedSigner: signer, escrow, chainId });
  if (typeof channelId !== "string") return channelId;
  const expires = expiresOf(o);
  if (isRefusal(expires)) return expires;
  const deadline = BigInt(expires);
  const challenge = { ...choice.challenge };
  const source = `did:pkh:eip155:${chainId}:${from}`;
  /**
   * The voucher's typed data for `funded`, once `complete` takes `funded` with the shortest voucher signature it takes,
   * one byte; else what `complete` refuses. So `voucher` measures the credential as `complete` does, and refuses one
   * over the credential size bound with `mpp/credential-malformed` before the voucher is signed, as the Tempo
   * session's `voucher` does.
   */
  const voucherFor =
    (complete: (funded: Hex, voucherSignature: Hex) => MppCredential | Refusal) =>
    (funded: Hex): VoucherTypedData | Refusal => {
      const c = complete(funded, "0x00");
      return isRefusal(c) ? c : voucherData("EVM Payment Channel", "uint128", chainId, escrow, channelId);
    };
  const base = { action: "open", channelId, cumulativeAmount: "0", authorizedSigner: signer, salt };

  if (type === "hash") {
    const calls = [
      { to: currency, data: words(APPROVE_SELECTOR, [addressWord(escrow), uintWord(deposit)]) },
      {
        to: escrow,
        data: words(OPEN_V1_SELECTOR, [addressWord(recipient), addressWord(currency), uintWord(deposit), bytes32Word(salt), addressWord(signer)]),
      },
    ];
    const complete = (funded: Hex, voucherSignature: Hex): MppCredential | Refusal => {
      if (normalHash(funded) === null || !isHexBytes(voucherSignature, 1, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      const payload = { ...base, type: "hash", hash: funded, signature: voucherSignature };
      return measured({ challenge, source, payload });
    };
    return { funding: { kind: "evm-calls", chainId, calls, broadcast: true }, voucher: voucherFor(complete), complete };
  }

  let typedData: ReceiveTypedData | Permit2TypedData | Refusal;
  let authorization: { [k: string]: Json };
  if (type === "authorization") {
    const td = choice.tokenDomain;
    if (!isObject(td) || typeof td.name !== "string" || td.name === "" || typeof td.version !== "string" || td.version === "") {
      return refusal("mpp/input-malformed");
    }
    const nonce = keccakHex(concat([addressWord(from), addressWord(recipient), addressWord(currency), bytes32Word(salt), addressWord(signer)]));
    typedData = receiveTypedData({
      network: `eip155:${chainId}`,
      asset: currency,
      name: td.name,
      version: td.version,
      from,
      to: escrow,
      value: deposit.toString(),
      validAfter: 0n,
      validBefore: deadline,
      nonce,
    });
    authorization = { from, to: escrow, value: deposit.toString(), validAfter: "0", validBefore: deadline.toString(), nonce };
  } else {
    typedData = permit2TypedData({
      chainId,
      permitted: { token: currency, amount: deposit },
      spender: escrow,
      nonce: BigInt(salt),
      deadline,
      verifyingContract: (o.details["permit2Contract"] as Hex | undefined) ?? PERMIT2,
      witness: {
        type: "ChannelOpenWitness",
        fields: [
          { name: "payee", type: "address" },
          { name: "salt", type: "bytes32" },
          { name: "authorizedSigner", type: "address" },
        ],
        value: { payee: recipient, salt, authorizedSigner: signer },
      },
    });
    authorization = {
      from,
      permitted: { token: currency, amount: deposit.toString() },
      nonce: BigInt(salt).toString(),
      deadline: deadline.toString(),
      witness: { payee: recipient, salt, authorizedSigner: signer },
    };
  }
  if (isRefusal(typedData)) return typedData;
  const complete = (funded: Hex, voucherSignature: Hex): MppCredential | Refusal => {
    if (!isHexBytes(funded, 1, MAX_SIGNATURE) || !isHexBytes(voucherSignature, 1, MAX_SIGNATURE)) {
      return refusal("mpp/credential-malformed");
    }
    return measured({
      challenge,
      source,
      payload: { ...base, type, authorization, signature: funded, voucherSignature },
    });
  };
  return { funding: { kind: "eip712", typedData }, voucher: voucherFor(complete), complete };
}

/** The transaction a `hash` opening presents, which the payer broadcast before the claim; undefined for any other. */
function evmLandedTx(presented: unknown): string | undefined {
  const c = credentialOf(presented);
  if (isRefusal(c)) return undefined;
  const opening = evmOpening(c.payload);
  if (isRefusal(opening) || opening.type !== "hash") return undefined;
  return normalHash(opening.o["hash"]) ?? undefined;
}

/**
 * The close keys of an EVM session: the network, and the escrow the issued challenge names with the channel. The
 * issued challenge is held as `bound` holds an echoed one (`issuedFor`), with its code for each fault: the challenge's
 * shape and size, its intent and method, which must be the pairing's, and the pairing's filter.
 */
function evmCloseRef(chosen: MppChallenge, channel: string): SessionRef | Refusal {
  const held = issuedFor(chosen, SESSION_EVM);
  if (isRefusal(held)) return held;
  const p = paramsOf(chosen);
  if (isRefusal(p)) return p;
  const c = normalHash(channel);
  if (c === null) return refusal("mpp/credential-malformed");
  return { network: p.network, closes: { escrow: p.escrow.toLowerCase() as Hex, channel: c as Hex } };
}

/** A succeeded transaction read as an EVM session's close: its recipient and calldata, by `eth_getTransactionByHash`. */
async function closeRead(
  settled: SessionStatus,
  transaction: Hex,
  closes: { escrow: Hex; channel: Hex },
  reader: EvmReader,
): Promise<SessionStatus> {
  let tx: Awaited<ReturnType<EvmReader["transaction"]>>;
  try {
    tx = await reader.transaction(transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (tx === null) return { state: "pending", why: "not-found" };
  const input = isObject(tx) && typeof tx.input === "string" ? bytesOf(tx.input) : undefined;
  if (input === undefined) return { state: "pending", why: "unreadable" };
  const selector = input.length >= 36 ? hexOf(input.subarray(0, 4)) : undefined;
  const closing =
    tx.to !== null &&
    sameBytes(tx.to, closes.escrow) &&
    (EVM_CLOSE_SELECTORS as readonly string[]).includes(selector ?? "") &&
    sameBytes(hexOf(input.subarray(4, 36)), closes.channel);
  return closing ? settled : { state: "pending", why: "not-a-close" };
}

/**
 * Whether `eth_getTransactionByHash`'s answer is well formed: an object whose `from` is an address, whose `to` is an
 * address or null (a contract creation), and whose `input` is `0x` and an even number of hex digits, of any length.
 */
function isTransactionRead(tx: unknown): boolean {
  return isObject(tx) && isAddress(tx.from) && (tx.to === null || isAddress(tx.to)) && isHexBytes(tx.input, 0, Number.MAX_SAFE_INTEGER);
}

/**
 * A succeeded transaction read as an EVM session's opening, by `eth_getTransactionByHash`: sent to the escrow, it holds
 * the escrow's open call for the channel. The call is `open(address payee, address token, uint128 deposit, bytes32
 * salt, address authorizedSigner)` in its first 164 bytes of calldata, whose payer is the transaction's sender, or
 * `openWithPermit2(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner, address from,
 * uint256 nonce, uint256 deadline, bytes signature)`, whose payer is its `from`. Calldata past the arguments is not
 * read: the escrow's function does not read it, and a wallet may append a data suffix there. Its salt is `h`, and `evmChannelId`
 * over the payer, the call's payee, token and authorized signer, `h`, the escrow and the chain is the channel. Such a
 * call that does not open the channel is failed `open-call-not-found` where `settleBy` is absent (the named transaction
 * is the payment) and the receipt's block is at or below the `finalized` mark, and pending `open-call-not-found` where
 * the opening can land until `settleBy` or the block is above that mark: a block above it can still be replaced, and a
 * failed answer names no mark, so it is given only at the highest the reader names.
 *
 * Any other transaction is pending `open-call-not-found`, never failed. A transaction sent through an ERC-4337
 * EntryPoint is one of them: the account's calldata does not show which contract the account called; so is one whose
 * calldata is longer than `MAX_CALLDATA`, which the read does not decode. A failed read, or a transaction that is not
 * well formed (`isTransactionRead`), is pending `unreadable`. The deposit is not read.
 */
async function openRead(
  settled: EvmBreadthStatus & { state: "settled" },
  ref: SessionRef & { transaction: Hex },
  opens: NonNullable<SessionRef["opens"]>,
  reader: EvmReader,
): Promise<SessionStatus> {
  let tx: Awaited<ReturnType<EvmReader["transaction"]>>;
  try {
    tx = await reader.transaction(ref.transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (tx === null) return { state: "pending", why: "not-found" };
  if (!isTransactionRead(tx)) return { state: "pending", why: "unreadable" };
  if (!isHexBytes(tx.input, 0, MAX_CALLDATA)) return { state: "pending", why: "open-call-not-found" };
  const input = bytesOf(tx.input)!;
  const selector = input.length >= 4 ? hexOf(input.subarray(0, 4)) : undefined;
  const args = input.subarray(4);
  const to = tx.to?.toLowerCase();
  if (to === opens.escrow.toLowerCase() && (selector === OPEN_V1_SELECTOR || selector === OPEN_WITH_PERMIT2_SELECTOR)) {
    const payer = selector === OPEN_V1_SELECTOR ? (input.length >= OPEN_CALL_BYTES ? tx.from : undefined) : addressAt(args, 5);
    if (payer !== undefined && opensChannel(args, payer, opens)) return settled;
    return ref.settleBy === undefined ? failedIfFinal(settled, "open-call-not-found") : { state: "pending", why: "open-call-not-found" };
  }
  return { state: "pending", why: "open-call-not-found" };
}

/**
 * Recovers H from an EVM session's opening transaction alone: the salt, argument word 3, of the escrow's open call the
 * transaction makes, whichever of `open`, `openWithAuthorization` and `openWithPermit2` it calls; each takes `payee,
 * token, deposit, salt, authorizedSigner` first, and the two relayed ones the payer as `from` next. The transaction is
 * read as `status` reads an opening (`eth_getTransactionByHash`): its own call must be the open call, with a recipient
 * and calldata that starts with one of the three selectors and holds those words, and the receipt must hold a
 * `Transfer` of the call's token, of any value, from its payer (the transaction's sender for `open`, else `from`) into
 * the called contract; else `evm/no-open-call`. A transaction sent through an ERC-4337 EntryPoint is refused so: the
 * account's calldata does not show which contract the account called. A reader for another network, a ref or reader
 * that is not an object, or a ref whose `transaction` is not a 32-byte hash (with nothing read), is `evm/wrong-reader`;
 * no receipt or no transaction is `evm/not-found`; a reverted one is `evm/reverted`; a failed read, or a malformed
 * receipt or transaction (`isTransactionRead`), is `evm/unreadable`. A transaction whose own call is not the open call,
 * or whose calldata is longer than `MAX_CALLDATA`, is `evm/no-open-call` on every read, since its calldata is its own:
 * an opening the read does not decode is refused so, as an ERC-4337 one is. A revert, and a receipt without the
 * payer's `Transfer`, are given only where the receipt's block is at or below the reader's `finalized` mark: above it,
 * or where that mark cannot be read, each is `evm/not-final`, a read to repeat, since a block above the mark can be
 * replaced by one in which the transaction succeeds or holds other logs. The mark is read only for those. At most three
 * calls.
 */
async function evmRecover(ref: { network: string; transaction: Hex }, reader: EvmReader): Promise<AtrHash | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("evm/wrong-reader");
  if (normalHash(ref.transaction) === null) return refusal("evm/wrong-reader");
  let receipt: EvmReceipt | null;
  let tx: Awaited<ReturnType<EvmReader["transaction"]>>;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return refusal("evm/unreadable");
  }
  if (receipt === null) return refusal("evm/not-found");
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return refusal("evm/unreadable");
  if (receipt.status === 0) {
    const read = await failedAt(receipt.blockNumber, "reverted", reader);
    return read.state === "failed" ? refusal("evm/reverted") : refusal("evm/not-final");
  }
  try {
    tx = await reader.transaction(ref.transaction);
  } catch {
    return refusal("evm/unreadable");
  }
  if (tx === null) return refusal("evm/not-found");
  if (!isTransactionRead(tx)) return refusal("evm/unreadable");
  if (!isHexBytes(tx.input, 0, MAX_CALLDATA)) return refusal("evm/no-open-call");
  const input = bytesOf(tx.input)!;
  const selector = input.length >= OPEN_CALL_BYTES ? hexOf(input.subarray(0, 4)) : undefined;
  if (tx.to === null || selector === undefined) return refusal("evm/no-open-call");
  const args = input.subarray(4);
  const relayed = selector === OPEN_WITH_AUTHORIZATION_SELECTOR || selector === OPEN_WITH_PERMIT2_SELECTOR;
  if (selector !== OPEN_V1_SELECTOR && !relayed) return refusal("evm/no-open-call");
  const payer = relayed ? addressAt(args, 5) : (tx.from.toLowerCase() as Hex);
  const token = addressAt(args, 1);
  const escrow = tx.to;
  if (payer === undefined || token === undefined) return refusal("evm/no-open-call");
  const pulled = receipt.logs.some((l) => {
    const t = transferParts(l, token, TRANSFER_TOPIC);
    return t !== undefined && sameBytes(t.from, payer) && sameBytes(t.to, escrow);
  });
  if (pulled) return hexOf(wordAt(args, 3)!) as AtrHash;
  return (await finalAt(receipt.blockNumber, reader)) ? refusal("evm/no-open-call") : refusal("evm/not-final");
}

/**
 * Recovers H from a Tempo session's opening transaction alone: the salt, data word 3, of the `ChannelOpened` log that
 * the TIP-20 channel reserve (TIP-1034, `TIP20_CHANNEL_RESERVE`) emits in the receipt. A v1 escrow's `ChannelOpened`
 * carries no salt, and its open call sits among the Tempo transaction's calls, which the reader does not show: a v1
 * opening, like a receipt with no such log, is `tempo/open-not-found`. Logs giving more than one salt are
 * `tempo/ambiguous`. A ref or reader that is not an object, a ref whose `transaction` is not a 32-byte hash (with
 * nothing read), or a reader for another network than the ref names, is `tempo/wrong-reader`; a failed read is
 * `tempo/unreadable`, no receipt `tempo/not-found` and a revert `tempo/reverted`, as `readReceiptAtMark` answers. A
 * revert, `tempo/open-not-found` and `tempo/ambiguous` are given only where the receipt's block is at or below the
 * reader's `finalized` mark: above it, or where that mark cannot be read, each is `tempo/not-final`, a read to repeat,
 * since a block above the mark can be replaced by one in which the transaction succeeds or holds other logs. The mark
 * is read only for those. At most two calls.
 */
async function tempoRecover(ref: { network: string; transaction: Hex }, reader: EvmReader): Promise<AtrHash | Refusal> {
  if (!isObject(ref) || normalHash(ref.transaction) === null) return refusal("tempo/wrong-reader");
  const receipt = await readReceiptAtMark(ref.network, ref.transaction, reader);
  if (isRefusal(receipt)) return receipt;
  const salts = new Set<string>();
  for (const l of receipt.logs) {
    if (!sameBytes(l.address, TIP20_CHANNEL_RESERVE) || l.topics.length !== 4 || !sameBytes(l.topics[0], CHANNEL_OPENED_V2_TOPIC)) {
      continue;
    }
    const data = bytesOf(l.data);
    const salt = data === undefined ? undefined : wordAt(data, 3);
    if (salt !== undefined) salts.add(hexOf(salt));
  }
  if (salts.size !== 1 && !(await finalAt(receipt.blockNumber, reader))) return refusal("tempo/not-final");
  if (salts.size === 0) return refusal("tempo/open-not-found");
  if (salts.size > 1) return refusal("tempo/ambiguous");
  return [...salts][0]! as AtrHash;
}

/** The address in word `i` of `args`, or undefined. */
function addressAt(args: Uint8Array, i: number): Hex | undefined {
  const w = wordAt(args, i);
  return w === undefined ? undefined : addressOfWord(w);
}

/**
 * Whether the arguments of an escrow open call, whose first five words are `payee, token, deposit, salt,
 * authorizedSigner`, open `opens.channel` for `payer`: the salt word is `opens.h`, and `evmChannelId` over them gives the
 * channel.
 */
function opensChannel(args: Uint8Array, payer: Hex, opens: NonNullable<SessionRef["opens"]>): boolean {
  const salt = wordAt(args, 3);
  const payee = addressAt(args, 0);
  const token = addressAt(args, 1);
  const signer = addressAt(args, 4);
  if (salt === undefined || payee === undefined || token === undefined || signer === undefined || !sameBytes(hexOf(salt), opens.h)) {
    return false;
  }
  const { escrow, chainId, channel, h } = opens;
  return sameBytes(evmChannelId({ payer, payee, token, salt: h, authorizedSigner: signer, escrow, chainId }), channel);
}

/**
 * A voucher, or a close's final voucher, on the channel the held opening opened: `Voucher(bytes32 channelId,uint128
 * cumulativeAmount)` under "EVM Payment Channel", with the channel id, the escrow and the chain from the opening. A
 * `topUp` is not built; an action draft-evm-session-00 does not define, such as `use`, is `mpp/session-action`.
 */
async function evmBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const o = await withinChecks(w, h, "session/evm", async (opening) => evmOpened(opening), U128, ["topUp"]);
  if (isRefusal(o)) return o;
  const channelId = normalHash(w.opening.payload["channelId"]);
  if (channelId === null) return refusal("mpp/credential-malformed");
  const chainId = o.params.chainId;
  const typedData = voucherData("EVM Payment Channel", "uint128", chainId, o.escrow, channelId as Hex, w.cumulativeAmount);
  return withinUnsigned(w, typedData, channelId as Hex);
}

/** The one `eip712` voucher request, and the credential of the draft's members: action, channel, amount, signature. */
function withinUnsigned(
  w: SessionWithin,
  typedData: VoucherTypedData,
  channelId: Hex,
  descriptor?: Json,
): SessionWithinUnsigned {
  const challenge = { ...w.challenge };
  const action = w.action;
  const cumulativeAmount = w.cumulativeAmount.toString();
  return {
    requests: [{ kind: "eip712", typedData }],
    complete(signatures: readonly string[]): MppCredential | Refusal {
      const signature = oneHexSignature(signatures);
      if (isRefusal(signature)) return signature;
      return measured({
        challenge,
        payload: { action, channelId, cumulativeAmount, signature, ...(descriptor === undefined ? {} : { descriptor }) },
      });
    },
  };
}

// ── mpp/session/tempo.

function tempoKind(presented: MppCredential): "open" | "within" | "close" | Refusal {
  const p = payloadOf(presented);
  if (isRefusal(p)) return p;
  const action = p["action"];
  if (action === "open") return "open";
  if (action === "voucher" || action === "topUp") return "within";
  if (action === "close") return "close";
  return refusal("mpp/session-action");
}

/** A v2 descriptor from a payload, as `tempoChannelId` takes it. */
function descriptorOf(v: Json | undefined): Parameters<typeof tempoChannelId>[0] | undefined {
  if (!isObject(v)) return undefined;
  const keys = ["payer", "payee", "operator", "token", "salt", "authorizedSigner", "expiringNonceHash"] as const;
  const d: { [k: string]: string } = {};
  for (const k of keys) {
    if (typeof v[k] !== "string") return undefined;
    d[k] = v[k] as string;
  }
  return d as unknown as Parameters<typeof tempoChannelId>[0];
}

/**
 * The v2 descriptor's salt, when the descriptor's channel id is the payload's channel and its operator is the
 * challenge's `methodDetails.operator`, or the zero address where the challenge names none: draft-tempo-session-00
 * requires both of a v2 credential's descriptor. Else `tempo/descriptor-mismatch`.
 */
function descriptorSalt(payload: { [k: string]: Json }, p: Params): AtrHash | Refusal {
  const d = descriptorOf(payload["descriptor"]);
  if (d === undefined) return refusal("tempo/descriptor-mismatch");
  const id = tempoChannelId({ ...d, escrow: p.escrow, chainId: p.chainId });
  const channel = normalHash(payload["channelId"]);
  const salt = normalHash(d.salt);
  if (typeof id !== "string" || channel === null || salt === null || !sameBytes(id, channel)) {
    return refusal("tempo/descriptor-mismatch");
  }
  if (!sameBytes(d.operator, p.details["operator"] ?? ZERO)) return refusal("tempo/descriptor-mismatch");
  return salt;
}

async function tempoBoundWithin(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const payload = payloadOf(presented);
  if (isRefusal(payload)) return payload;
  const p = paramsOf(isObject(presented) ? presented.challenge : undefined);
  if (isRefusal(p)) return p;
  if (p.version !== "v2") return refusal("mpp/not-bound-within");
  return descriptorSalt(payload, p);
}

/**
 * The opening's signed transaction, checked in the order of draft-tempo-session-00's open verification: the transaction
 * first ("Decode the signed transaction from `transaction`, verify it calls `open()` on the expected escrow contract with
 * correct parameters. Recover the `payer` address from the transaction"), then the channel id, and on v2 the descriptor
 * ("For v2, servers MUST also verify the payload `descriptor`"). So of a fault in the transaction and another in the
 * payload's channel id or descriptor, the transaction's is named.
 *
 * The transaction is signed for the challenge's chain, `methodDetails.chainId` (4217 where a v1 challenge names none):
 * the draft binds the channel to the escrow and the chain, and the server broadcasts this transaction there. A
 * transaction whose chain id is another is `tempo/tx-malformed`. It holds one `open` call to the escrow, whose input has
 * the version's length and whose salt word is H. The call's payee, token and authorizedSigner words, and on v2 its
 * operator word, are addresses (words 0, 1 and 4 of `open(payee, token, deposit, salt, authorizedSigner)`; on v2, words
 * 0, 1, 2 and 5 of `open(payee, operator, token, deposit, salt, authorizedSigner)`), the signature gives the sender
 * (`tempoSender`), the payer the draft recovers from the transaction, and each entry of its `aa_authorization_list` is
 * a list of four items ending in a signature that is not a keychain signature of type `0x03`, which Tempo's node
 * refuses there as in the sender's signature (`authorizationSignatures`); else `tempo/tx-malformed`.
 *
 * Then the payload's `channelId` is read, where the draft compares the channel id: one that is not a 32-byte hash is
 * `mpp/credential-malformed`. On v1, it is the channel this transaction opens: `evmChannelId` over the sender, the
 * call's payee, token and authorizedSigner, H, the escrow and the chain, as the draft computes it from the payer it
 * recovers from the transaction. Else `mpp/channel-not-bound`. On v2, the payload's descriptor matches that
 * transaction, as the draft requires: it carries H as its salt and gives the payload's channel id (`descriptorSalt`),
 * and it names the call's payee, operator, token and authorizedSigner, the sender as its `payer`, and the expiring nonce
 * hash of this transaction under that sender (`expiringNonceHash`). A descriptor naming another party or another hash
 * gives a channel id this transaction does not open: `tempo/descriptor-mismatch`.
 */
function tempoOpened(
  presented: MppCredential,
): { h: AtrHash; checked: Echoed; params: Params; validBefore: bigint | null; channel: Hex } | Refusal {
  const e = echoed(presented, SESSION_TEMPO);
  if (isRefusal(e)) return e;
  if (e.payload["action"] !== "open" || e.payload["type"] !== "transaction") return refusal("mpp/not-an-opening");
  const p = paramsOf(presented.challenge);
  if (isRefusal(p)) return p;
  const wire = e.payload["transaction"];
  if (typeof wire !== "string" || wire.length % 2 !== 0 || !/^0x[0-9a-fA-F]*$/.test(wire)) return refusal("mpp/credential-malformed");
  if ((wire.length - 2) / 2 > MAX_WIRE) return refusal("tempo/tx-too-large");
  const raw = bytesOf(wire)!;
  const tx = decodeTempoTx(raw);
  if (isRefusal(tx)) return tx;
  if (tx.chainId !== BigInt(p.chainId)) return refusal("tempo/tx-malformed");
  const selector = p.version === "v2" ? OPEN_V2_SELECTOR : OPEN_V1_SELECTOR;
  const opens = tx.calls.filter(
    (c) => c.to !== null && sameBytes(c.to, p.escrow) && c.input.length >= 4 && hexOf(c.input.subarray(0, 4)) === selector,
  );
  if (opens.length === 0) return refusal("tempo/open-not-found");
  if (opens.length > 1) return refusal("tempo/open-ambiguous");
  const input = opens[0]!.input;
  if (input.length !== (p.version === "v2" ? 196 : 164)) return refusal("tempo/tx-malformed");
  const saltAt = 4 + 32 * (p.version === "v2" ? 4 : 3);
  if (!sameBytes(hexOf(input.subarray(saltAt, saltAt + 32)), e.h)) return refusal("tempo/salt-not-bound");
  const args = input.subarray(4);
  const called = (p.version === "v2" ? [0, 1, 2, 5] : [0, 1, 4]).map((i) => addressAt(args, i));
  if (called.includes(undefined)) return refusal("tempo/tx-malformed");
  const sender = tempoSender(raw);
  if (isRefusal(sender)) return sender;
  const authorizations = authorizationSignatures(raw);
  if (isRefusal(authorizations)) return authorizations;
  const channel = normalHash(e.payload["channelId"]);
  if (channel === null) return refusal("mpp/credential-malformed");
  if (p.version === "v2") {
    const salt = descriptorSalt(e.payload, p);
    if (typeof salt !== "string" || !hashEquals(salt, e.h)) return refusal("tempo/descriptor-mismatch");
    const d = descriptorOf(e.payload["descriptor"])!;
    const named = [d.payee, d.operator, d.token, d.authorizedSigner];
    if (!named.every((a, i) => sameBytes(a, called[i]))) return refusal("tempo/descriptor-mismatch");
    if (!sameBytes(d.payer, sender)) return refusal("tempo/descriptor-mismatch");
    const nonceHash = expiringNonceHash(raw, sender);
    if (typeof nonceHash !== "string" || !sameBytes(nonceHash, d.expiringNonceHash)) return refusal("tempo/descriptor-mismatch");
  } else {
    const [payee, token, signer] = called as [Hex, Hex, Hex];
    const opened = evmChannelId({ payer: sender, payee, token, salt: e.h, authorizedSigner: signer, escrow: p.escrow, chainId: p.chainId });
    if (typeof opened !== "string" || !sameBytes(opened, channel)) return refusal("mpp/channel-not-bound");
  }
  return { h: e.h, checked: e.checked, params: p, validBefore: tx.validBefore, channel };
}

async function tempoBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = tempoOpened(presented);
  return isRefusal(o) ? o : o.h;
}

/**
 * The read keys of the session's opening: the escrow's `ChannelOpened` naming the channel. `settleBy` is the opening
 * transaction's `validBefore`, else the challenge's `expires`, a date the pairing's filter requires.
 */
async function tempoReference(input: unknown): Promise<SessionRef | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = tempoOpened(presented);
  if (isRefusal(o)) return o;
  const topic0 = o.params.version === "v2" ? CHANNEL_OPENED_V2_TOPIC : CHANNEL_OPENED_V1_TOPIC;
  const settleBy = o.validBefore ?? BigInt(o.checked.expires as number);
  return {
    network: o.params.network,
    settleBy: settleBy.toString(),
    search: { address: o.params.escrow, topics: [topic0, o.channel] },
    opened: { address: o.params.escrow, version: o.params.version, channel: o.channel, h: o.h, chainId: o.params.chainId },
  };
}

/**
 * The open call for the buyer's signer, and the voucher and credential of the signed transaction. `complete` returns
 * the credential only once `bound`'s checks (`tempoOpened`) take it, and otherwise gives their refusal, in their order,
 * so it returns no credential `bound` refuses; `voucher` refuses the same transactions, with the shortest voucher
 * signature `complete` takes, one byte, in the credential. The credential names the build's `from` (on v2 as the
 * descriptor's payer, with the transaction's expiring nonce hash under it; on v1 in its channel id) and the open call's
 * payee, operator, token and authorizedSigner. So, as `bound` refuses its credential: a transaction that is not hex
 * bytes, or whose credential is over the credential size bound, 64 KiB, is `mpp/credential-malformed`; one that does
 * not decode, an empty one among them, is signed for a chain other than the challenge's, `methodDetails.chainId`, has a
 * signature that gives no sender (`tempoSender`: a keychain signature of type `0x03` among them), or holds an
 * `aa_authorization_list` entry that is not a list of four items ending in a signature or one signed with a keychain
 * signature of type `0x03` (`authorizationSignatures`), is `tempo/tx-malformed`; one without exactly one `open` call to
 * the escrow with H as its salt is `tempo/open-not-found`, `tempo/open-ambiguous` or `tempo/salt-not-bound`; and one
 * whose sender is not `from`, or whose `open` call names another payee, operator, token or authorizedSigner, is
 * `tempo/descriptor-mismatch` on v2 and `mpp/channel-not-bound` on v1. Nothing else in the transaction is compared with
 * what `build` made, its deposit among them: `bound` does not read it.
 */
async function tempoBuild(choice: SessionChoice, h: AtrHash): Promise<SessionUnsigned | Refusal> {
  const o = offerFor(choice, h, SESSION_TEMPO);
  if (isRefusal(o)) return o;
  const validBefore = expiresOf(o);
  if (isRefusal(validBefore)) return validBefore;
  const p = paramsOf(choice.challenge);
  if (isRefusal(p)) return p;
  const deposit = choice.deposit;
  if (typeof deposit !== "bigint" || deposit <= 0n || deposit >= (p.version === "v2" ? U96 : U128)) {
    return refusal("mpp/input-malformed");
  }
  const signer = choice.authorizedSigner ?? ZERO;
  if (!isAddress(signer)) return refusal("mpp/input-malformed");
  const operator = (p.details["operator"] as Hex | undefined) ?? ZERO;
  const currency = str(o.request["currency"]) as Hex;
  const recipient = str(o.request["recipient"]) as Hex;
  const salt = normalHash(h)!;
  const from = choice.from;
  const data =
    p.version === "v2"
      ? words(OPEN_V2_SELECTOR, [addressWord(recipient), addressWord(operator), addressWord(currency), uintWord(deposit), bytes32Word(salt), addressWord(signer)])
      : words(OPEN_V1_SELECTOR, [addressWord(recipient), addressWord(currency), uintWord(deposit), bytes32Word(salt), addressWord(signer)]);
  const challenge = { ...choice.challenge };
  const source = `did:pkh:eip155:${p.chainId}:${from}`;

  /**
   * The channel id, and on v2 the descriptor, that `complete` writes for `signedTx`: on v1 the channel `from` opens
   * with the open call's values; on v2 the descriptor of those values whose expiring nonce hash is the transaction's
   * under `from`, and its channel id. On v2 a transaction that is not hex bytes of at most 64 KiB, or does not decode,
   * gives neither: `bound` refuses it before it reads them.
   */
  const channelFor = (signedTx: Hex) => {
    if (p.version === "v1") {
      const channelId = evmChannelId({ payer: from, payee: recipient, token: currency, salt, authorizedSigner: signer, escrow: p.escrow, chainId: p.chainId });
      return typeof channelId === "string" ? { channelId } : channelId;
    }
    if (!isHexBytes(signedTx, 0, MAX_WIRE)) return refusal("mpp/credential-malformed");
    const nonceHash = expiringNonceHash(bytesOf(signedTx)!, from);
    if (typeof nonceHash !== "string") return nonceHash;
    const descriptor = { payer: from, payee: recipient, operator, token: currency, salt, authorizedSigner: signer, expiringNonceHash: nonceHash };
    const channelId = tempoChannelId({ ...descriptor, escrow: p.escrow, chainId: p.chainId });
    return typeof channelId === "string" ? { channelId, descriptor } : channelId;
  };
  /**
   * The credential for `signedTx` and `voucherSignature`, once `bound`'s checks (`tempoOpened`) take it; else their
   * refusal, so `complete` returns no credential `bound` refuses.
   */
  const held = (signedTx: Hex, voucherSignature: Hex): MppCredential | Refusal => {
    const c = channelFor(signedTx);
    const credential: MppCredential = {
      challenge,
      source,
      payload: {
        action: "open",
        type: "transaction",
        ...(isRefusal(c) ? {} : { channelId: c.channelId }),
        transaction: signedTx,
        authorizedSigner: signer,
        ...(!isRefusal(c) && "descriptor" in c && c.descriptor !== undefined ? { descriptor: c.descriptor } : {}),
        cumulativeAmount: "0",
        signature: voucherSignature,
      },
    };
    const opened = tempoOpened(credential);
    if (isRefusal(opened)) return opened;
    return isRefusal(c) ? c : credential;
  };
  return {
    funding: { kind: "tempo-call", chainId: p.chainId, call: { to: p.escrow, data }, validBefore, broadcast: false },
    voucher(signedTx: Hex): VoucherTypedData | Refusal {
      const c = held(signedTx, SHORTEST_SIGNATURE);
      if (isRefusal(c)) return c;
      const channelId = c.payload["channelId"] as Hex;
      return p.version === "v2"
        ? voucherData("TIP20 Channel Reserve", "uint96", p.chainId, p.escrow, channelId)
        : voucherData("Tempo Stream Channel", "uint128", p.chainId, p.escrow, channelId);
    },
    complete(signedTx: Hex, voucherSignature: Hex): MppCredential | Refusal {
      const c = held(signedTx, voucherSignature);
      if (isRefusal(c)) return c;
      if (!isHexBytes(voucherSignature, 1, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      return c;
    },
  };
}

/**
 * The close's read keys: the escrow's `ChannelClosed` naming the channel, as the binding log and as the search filter.
 * The issued challenge is held as `bound` holds an echoed one (`issuedFor`), with its code for each fault: the
 * challenge's shape and size, its intent and method, which must be the pairing's, and the pairing's filter.
 */
function tempoCloseRef(chosen: MppChallenge, channel: string): SessionRef | Refusal {
  const held = issuedFor(chosen, SESSION_TEMPO);
  if (isRefusal(held)) return held;
  const p = paramsOf(chosen);
  if (isRefusal(p)) return p;
  const c = normalHash(channel);
  if (c === null) return refusal("mpp/credential-malformed");
  const topic0 = p.version === "v2" ? CHANNEL_CLOSED_V2_TOPIC : CHANNEL_CLOSED_V1_TOPIC;
  return {
    network: p.network,
    bindingLog: { address: p.escrow, topic0, index: 1, value: c },
    search: { address: p.escrow, topics: [topic0, c] },
  };
}

/**
 * A voucher, or a close's final voucher, on the channel the held opening opened: under "Tempo Stream Channel" with
 * `uint128` on v1, and under "TIP20 Channel Reserve" with `uint96` on v2, whose credential also carries the opening's
 * descriptor. The channel id, the escrow, the chain and the descriptor come from the opening. A `topUp` is not built;
 * an action draft-tempo-session-00 does not define, such as `use`, is `mpp/session-action`.
 */
async function tempoBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const version = isObject(w) && isObject(w.opening) ? paramsOf(w.opening.challenge) : refusal("mpp/input-malformed");
  const limit = !isRefusal(version) && version.version === "v2" ? U96 : U128;
  const o = await withinChecks(w, h, "session/tempo", async (opening) => tempoOpened(opening), limit, ["topUp"]);
  if (isRefusal(o)) return o;
  const p = o.params;
  if (p.version === "v2") {
    const typedData = voucherData("TIP20 Channel Reserve", "uint96", p.chainId, p.escrow, o.channel, w.cumulativeAmount);
    return withinUnsigned(w, typedData, o.channel, w.opening.payload["descriptor"]);
  }
  const typedData = voucherData("Tempo Stream Channel", "uint128", p.chainId, p.escrow, o.channel, w.cumulativeAmount);
  return withinUnsigned(w, typedData, o.channel);
}

// ── mpp/subscription/tempo.

function subscriptionKind(presented: MppCredential): "open" | "within" | "close" | Refusal {
  const p = payloadOf(presented);
  if (isRefusal(p)) return p;
  return p["type"] === "keyAuthorization" ? "open" : refusal("mpp/session-action");
}

/**
 * The access key the subscription challenge issued, `methodDetails.accessKey`: its address, lowercase, and its key type
 * as Tempo numbers it (`KEY_TYPES`); else `mpp/access-key-malformed`, the code the pairing's filter gives.
 */
function issuedKey(details: { [k: string]: Json }): { keyId: Hex; keyType: bigint } | Refusal {
  const key = details["accessKey"];
  const address = isObject(key) ? key["accessKeyAddress"] : undefined;
  const type = isObject(key) ? key["keyType"] : undefined;
  if (!isAddress(address) || (type !== "secp256k1" && type !== "p256" && type !== "webAuthn")) {
    return refusal("mpp/access-key-malformed");
  }
  return { keyId: address.toLowerCase() as Hex, keyType: BigInt(KEY_TYPES[type]) };
}

/**
 * The key id of the challenge's issued key (`issuedKey`), when the payer's key authorization authorizes that key on the
 * challenge's chain: its key id and its key type are the challenge's, and then its chain id is `methodDetails.chainId`.
 * Tempo's subscription draft requires the authorization to name "the exact access key described by
 * `methodDetails.accessKey`, including both `accessKeyAddress` and `keyType`", and its chain ID to equal
 * `methodDetails.chainId`. A key authorization for another key id, key type or chain is `tempo/key-not-authorized`,
 * so the activation, the payments under the key and the close are read under the one key the challenge issued.
 */
function authorizedKey(k: Pick<KeyAuthorizationRead, "keyId" | "keyType" | "chainId">, details: { [k: string]: Json }): Hex | Refusal {
  const issued = issuedKey(details);
  if (isRefusal(issued)) return issued;
  if (!sameBytes(k.keyId, issued.keyId) || k.keyType !== issued.keyType) return refusal("tempo/key-not-authorized");
  const chain = details["chainId"];
  const sameChain = typeof chain === "number" && Number.isSafeInteger(chain) && BigInt(chain) === k.chainId;
  return sameChain ? issued.keyId : refusal("tempo/key-not-authorized");
}

/**
 * The opening's checked values: the key authorization the payload's `signature` carries, whose witness is H and whose
 * key is the challenge's issued key (`authorizedKey`), and that key's id.
 */
function subscriptionWitness(
  presented: MppCredential,
): { h: AtrHash; checked: Echoed; keyId: Hex; key: KeyAuthorizationRead } | Refusal {
  const e = echoed(presented, SUBSCRIPTION);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "keyAuthorization") return refusal("mpp/not-an-opening");
  const signed = e.payload["signature"];
  if (typeof signed !== "string") return refusal("tempo/key-authorization-malformed");
  const k = readKeyAuthorization(signed as Hex);
  if (isRefusal(k)) return k;
  if (k.witness === undefined) return refusal("tempo/no-witness");
  if (!hashEquals(k.witness, e.h)) return refusal("tempo/witness-not-bound");
  const keyId = authorizedKey(k, e.checked.details);
  if (isRefusal(keyId)) return keyId;
  return { h: e.h, checked: e.checked, keyId, key: k };
}

/**
 * The token and the recipient the payer signed in the key authorization: its one limit token, which is also the one
 * target of its allowed calls, and the one recipient across its `transfer` and `transferWithMemo` rules, lowercase.
 * Tempo's subscription draft lets the key make only those calls and forbids `approve` and every other selector, so no
 * other rule names the recipient: an `approve` rule's spender is not one. A `transfer` or `transferWithMemo` rule with
 * no recipients allows any recipient, so the authorization does not name exactly one. Any other scope, one with no
 * `transfer` or `transferWithMemo` rule included, is `tempo/key-authorization-malformed`.
 */
function signedScope(k: Pick<TempoKeyAuthorization, "limits" | "allowedCalls">): { token: Hex; recipient: Hex } | Refusal {
  const transfers = k.allowedCalls.flatMap((c) =>
    c.selectorRules.filter((r) => TRANSFER_SELECTORS.some((t) => sameBytes(t, r.selector))),
  );
  if (transfers.some((r) => r.recipients.length === 0)) return refusal("tempo/key-authorization-malformed");
  const tokens = new Set(k.limits.map((l) => l.token.toLowerCase()));
  const targets = new Set(k.allowedCalls.map((c) => c.target.toLowerCase()));
  const recipients = new Set(transfers.flatMap((r) => r.recipients.map((x) => x.toLowerCase())));
  const [token] = tokens;
  const [recipient] = recipients;
  if (tokens.size !== 1 || targets.size !== 1 || recipients.size !== 1 || !targets.has(token!)) {
    return refusal("tempo/key-authorization-malformed");
  }
  return { token: token as Hex, recipient: recipient as Hex };
}

async function subscriptionBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const w = subscriptionWitness(presented);
  return isRefusal(w) ? w : w.h;
}

/**
 * The activation's read keys, from what the payer signed: the keychain's `KeyAuthorizationWitness` carrying H, and the
 * `Transfer` of the key authorization's token to its recipient (`signedScope`), identified by the recipient alone.
 * `accessKey` records the key, the challenge's issued key that the key authorization authorizes (`authorizedKey`), with
 * that token and recipient for `keySearch`. Of the request it reads only the chain.
 */
async function subscriptionReference(input: unknown): Promise<SessionRef | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const w = subscriptionWitness(presented);
  if (isRefusal(w)) return w;
  const p = paramsOf(presented.challenge);
  if (isRefusal(p)) return p;
  const scope = signedScope(w.key);
  if (isRefusal(scope)) return scope;
  const to = await transferDigest({ to: scope.recipient });
  if (typeof to !== "string") return to;
  return {
    network: p.network,
    bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: w.h },
    transferLog: { address: scope.token, topic0: TRANSFER_TOPIC, identity: "to", digest: to },
    search: { address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, null, w.h] },
    accessKey: { keyId: w.keyId, token: scope.token, to },
  };
}

/**
 * The network and the key authorization's digest, for a key authorization that authorizes the challenge's issued key
 * (`authorizedKey`). A payment `channel.kind` refuses, one whose payload `type` is not `keyAuthorization`, is refused
 * with its code, as every session pairing's `channel.ref` refuses one. The key authorization is the opening, and it is
 * held as `bound` holds it (`echoedFor`), whose refusal it gives: the credential's shape, H from the echoed challenge's
 * id, the challenge's intent and method, which must be the pairing's, and the pairing's filter.
 */
async function subscriptionRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const kind = subscriptionKind(presented);
  if (isRefusal(kind)) return kind;
  const held = echoedFor(presented, SUBSCRIPTION);
  if (isRefusal(held)) return held;
  const p = paramsOf(presented.challenge);
  if (isRefusal(p)) return p;
  const signature = presented.payload["signature"];
  if (typeof signature !== "string") return refusal("tempo/key-authorization-malformed");
  const k = readKeyAuthorization(signature as Hex);
  if (isRefusal(k)) return k;
  const key = authorizedKey(k, p.details);
  return isRefusal(key) ? key : { network: p.network, channel: k.digest };
}

/**
 * The request's `subscriptionExpires` in Unix seconds, read from the opening as `channel.ref` reads it: none for a
 * payment `channel.kind` refuses, and none for an opening `bound` refuses, held as `bound` holds it (`echoedFor`): the
 * credential's shape, H from the echoed challenge's id, the challenge's intent and method, which must be the
 * pairing's, and the pairing's filter, which reads `subscriptionExpires` as a date.
 */
function subscriptionUntil(presented: MppCredential): number | undefined {
  if (isRefusal(subscriptionKind(presented))) return undefined;
  const held = echoedFor(presented, SUBSCRIPTION);
  if (isRefusal(held)) return undefined;
  const e = held.checked.request["subscriptionExpires"];
  return typeof e === "string" ? unixOf(e) : undefined;
}

async function subscriptionBuild(choice: SessionChoice, h: AtrHash): Promise<KeyAuthorizationUnsigned | Refusal> {
  const o = offerFor(choice, h, SUBSCRIPTION);
  if (isRefusal(o)) return o;
  const r = o.request;
  const key = o.details["accessKey"] as { accessKeyAddress: Hex; keyType: keyof typeof KEY_TYPES };
  const chainId = o.details["chainId"] as number;
  const currency = str(r["currency"]) as Hex;
  const authorization: TempoKeyAuthorization = {
    chainId: BigInt(chainId),
    keyType: KEY_TYPES[key.keyType],
    keyId: key.accessKeyAddress,
    expiry: BigInt(unixOf(str(r["subscriptionExpires"]))!),
    limits: [{ token: currency, limit: BigInt(str(r["amount"])), period: subscriptionPeriod(r) }],
    allowedCalls: [{ target: currency, selectorRules: [{ selector: TRANSFER_WITH_MEMO_SELECTOR, recipients: [str(r["recipient"]) as Hex] }] }],
    witness: normalHash(h)!,
  };
  const unsigned = encodeKeyAuthorization(authorization);
  if (!(unsigned instanceof Uint8Array)) return unsigned;
  const challenge = { ...choice.challenge };
  const source = `did:pkh:eip155:${chainId}:${choice.from}`;
  return {
    request: { kind: "tempo-key-authorization", authorization, digest: keccakHex(unsigned) },
    complete(rootSignature: Hex): MppCredential | Refusal {
      if (!isHexBytes(rootSignature, 1, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      const signed = encodeKeyAuthorization(authorization, rootSignature);
      // A key authorization over its own bound is still measured in its credential first, as `bound` reads them: the
      // same RLP list, rlp([authorization, signature]), that `encodeKeyAuthorization` writes within the bound.
      const carried = signed instanceof Uint8Array ? signed : rlpList([unsigned, rlpBytes(bytesOf(rootSignature)!)]);
      const credential = measured({ challenge, source, payload: { type: "keyAuthorization", signature: hexOf(carried) } });
      if (isRefusal(credential)) return credential;
      return signed instanceof Uint8Array ? credential : signed;
    },
  };
}

/**
 * The close keys of a subscription: the account keychain's `KeyRevoked` naming `account`, the payer's account, and the
 * issued challenge's access key (`issuedKey`), the key `reference` records. The account is the one the activation
 * registered the key for, which `keySearch` reads from the activation's receipt as `accessKey.account`; without an
 * address it is refused `mpp/input-malformed`. The issued challenge is held as `bound` holds an echoed one
 * (`issuedFor`), with its code for each fault: the challenge's shape and size, its intent and method, which must be the
 * pairing's, and the pairing's filter.
 */
function subscriptionCloseRef(chosen: MppChallenge, _channel: string, account?: Hex): SessionRef | Refusal {
  const held = issuedFor(chosen, SUBSCRIPTION);
  if (isRefusal(held)) return held;
  const p = paramsOf(chosen);
  if (isRefusal(p)) return p;
  const key = issuedKey(p.details);
  if (isRefusal(key)) return key;
  if (!isAddress(account)) return refusal("mpp/input-malformed");
  return { network: p.network, revokes: { account: account.toLowerCase() as Hex, keyId: key.keyId } };
}

// ── The records.

/** Each voucher signs the channel id, which commits to the salt, H. */
const VOUCHERS_COMMIT = "Each voucher in this channel signs a commitment to this ATR's hash.";

function sessionPattern(proves: string): LcpPattern {
  return deepFreeze({
    pattern: "native-field",
    canonical: false,
    profile: "mpp/session/evm-tempo",
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
    publicProof: true,
    proves,
  });
}

async function notBoundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

/**
 * The network and the payload's `channelId`, lowercase. A payment `kind` refuses is refused with its code, an action
 * the pairing's draft does not define, such as `use`, among them, as the Hedera, Solana, XRP Ledger and Lightning
 * sessions' `channel.ref` refuse it. An opening is held as `bound` holds it (`echoedFor`), whose refusal it gives: the
 * credential's shape, H from the echoed challenge's id, the challenge's intent and method, which must be `pairing`'s,
 * and `pairing`'s filter. A within or close payment's challenge, which the seller issues naming the channel, is read
 * without them.
 */
function refFrom(pairing: typeof SESSION_EVM | typeof SESSION_TEMPO, kind: (presented: MppCredential) => "open" | "within" | "close" | Refusal) {
  return async (presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> => {
    const k = kind(presented);
    if (isRefusal(k)) return k;
    if (k === "open") {
      const held = echoedFor(presented, pairing);
      if (isRefusal(held)) return held;
    }
    const p = paramsOf(presented.challenge);
    if (isRefusal(p)) return p;
    const channel = channelOf(presented.payload);
    return typeof channel === "string" ? { network: p.network, channel } : channel;
  };
}

const noEnd = (_presented: MppCredential): number | undefined => undefined;

export const sessionEvm = Object.freeze({
  id: SESSION_EVM,
  pattern: sessionPattern(
    "The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with " +
      "the challenge's position. The payer opened a payment channel whose salt is this ATR's hash, so the channel id, " +
      "keccak256 over the payer, payee, token, salt, authorized signer, escrow and chain, commits to it. The payer " +
      "signed that opening as an open call carrying the salt, an EIP-3009 authorization whose nonce is MPP's hash over " +
      "the channel parameters and the salt, or a Permit2 transfer whose witness carries the salt, and the escrow and " +
      "the token verified it on chain. The seller read that the opening transaction succeeded and moved the payer's " +
      "deposit to the escrow. Where the payer sent the open call, or a relayer sent the escrow's Permit2 opening, the " +
      "seller read that call: it is to the escrow, its salt is this ATR's hash, and its payer, payee, token and " +
      "authorized signer give this channel id, so the payer is the account that signed the call or, on Permit2, the " +
      "transfer. This does not show that amount, payee, asset or timing match the ATR's content. " +
      VOUCHERS_COMMIT,
  ),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: evmBuild,
  buildWithin: evmBuildWithin,
  bound: evmBound,
  reference: evmReference,
  status: pairingStatus(SESSION_EVM),
  recover: evmRecover,
  landedTx: evmLandedTx,
  closeRef: evmCloseRef,
  channel: Object.freeze({
    kind: measuring(evmKind),
    ref: measuringAsync(refFrom(SESSION_EVM, evmKind)),
    boundWithin: measuringAsync(notBoundWithin),
    until: noEnd,
  }),
});

export const sessionTempo = Object.freeze({
  id: SESSION_TEMPO,
  pattern: sessionPattern(
    "The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with " +
      "the challenge's position. The payer signed a Tempo transaction whose one call to the channel escrow opens a " +
      "channel with this ATR's hash as its salt, and the chain verified that signature when it executed the call. The " +
      "escrow's ChannelOpened event names the channel, whose id commits to the salt; on the TIP-1034 escrow the event " +
      "also carries the salt itself. This does not show that amount, payee, asset or timing match the ATR's content. " +
      VOUCHERS_COMMIT,
  ),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: tempoBuild,
  buildWithin: tempoBuildWithin,
  bound: tempoBound,
  reference: tempoReference,
  status: pairingStatus(SESSION_TEMPO),
  recover: tempoRecover,
  closeRef: tempoCloseRef,
  channel: Object.freeze({
    kind: measuring(tempoKind),
    ref: measuringAsync(refFrom(SESSION_TEMPO, tempoKind)),
    boundWithin: measuringAsync(tempoBoundWithin),
    until: noEnd,
  }),
});

export const subscriptionTempo = Object.freeze({
  id: SUBSCRIPTION,
  pattern: deepFreeze({
    pattern: "native-field",
    canonical: true,
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: true,
    publicProof: true,
    proves:
      "The ATR's hash is the MPP subscription challenge's id, in base64url. The payer's root key signed a Tempo key " +
      "authorization whose witness is this ATR's hash, granting the seller's access key a per-period limit. The chain " +
      "verified that signature when the activation transaction registered the key, and the account keychain's " +
      "KeyAuthorizationWitness event carries the payer's account and this hash as topics. The same transaction " +
      "transferred the token the payer's key authorization limits to the recipient it allows. This does not show that " +
      "amount, period, payee, asset or timing match the ATR's content.",
  } satisfies LcpPattern),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: subscriptionBuild,
  bound: subscriptionBound,
  reference: subscriptionReference,
  status: pairingStatus(SUBSCRIPTION),
  closeRef: subscriptionCloseRef,
  channel: Object.freeze({
    kind: measuring(subscriptionKind),
    ref: measuringAsync(subscriptionRef),
    boundWithin: measuringAsync(notBoundWithin),
    until: subscriptionUntil,
  }),
  recover: witnessRecover,
  keySearch,
  /**
   * What the record proves when its payment is a transfer found through `keySearch`: `<opening>` is the activation
   * transaction that registered the key, and `<transaction>` the transfer.
   */
  keyProves:
    "The ATR's hash is the MPP subscription challenge's id, in base64url. The payer's root key signed a Tempo key " +
    "authorization whose witness is this ATR's hash, granting the seller's access key a per-period limit. The chain " +
    "verified that signature when the activation transaction <opening> registered the key, and the account keychain's " +
    "KeyAuthorizationWitness event carries the payer's account and this hash as topics. The payment is a later " +
    "transfer, <transaction>, made under that key: the account keychain's AccessKeySpend event in it names the payer's " +
    "account, the key and the token. This does not show that amount, period, payee, asset or timing match the ATR's " +
    "content.",
});
