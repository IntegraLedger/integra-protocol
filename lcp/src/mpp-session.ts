/**
 * MPP's `session` on EVM and Tempo, and `subscription` on Tempo: channel pairings, each bound where its channel or
 * subscription opens. On the sessions the payer-signed channel salt is H; on the subscription the payer's root key
 * signs a key authorization whose witness is H. Nothing here reads a voucher's amount, a top-up or a renewal; a later
 * request is classified by `channel.kind`, and on Tempo v2 `channel.boundWithin` reads its descriptor's salt.
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import { addressWord, bytes32Word, bytesOf, concat, hexOf, keccakHex, sameBytes, uintWord, type Hex } from "./evm-abi.js";
import {
  AUTHORIZATION_USED_TOPIC,
  PERMIT2,
  TRANSFER_TOPIC,
  evmStatus,
  permit2TypedData,
  receiveTypedData,
  transferDigest,
  type EvmBreadthStatus,
  type EvmLog,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type Permit2TypedData,
  type ReceiveTypedData,
} from "./evm.js";
import { isAddress, normalHash, uint256Of } from "./fields.js";
import {
  challengeBound,
  challengeIdH,
  checkChallenge,
  credentialOf,
  decodeObject,
  deepFreeze,
  didPkhAddress,
  isChallengeShape,
  isHexBytes,
  isObject,
  place,
  read,
  tie,
  unixOf,
  type Checked,
  type MppChallenge,
  type MppChoice,
  type MppCredential,
} from "./mpp-challenge.js";
import type { HederaVoucherTypedData } from "./internal/hedera-session.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
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
  TRANSFER_WITH_MEMO_SELECTOR,
  decodeKeyAuthorization,
  decodeTempoTx,
  encodeKeyAuthorization,
  expiringNonceHash,
  keyAccount,
  tempoChannelId,
  witnessRecover,
  type KeyAuthorizationUnsigned,
  type TempoKeyAuthorization,
} from "./tempo.js";
import type { LcpPattern } from "./x402.js";

export type { ReceiveTypedData } from "./evm.js";

/** The buyer's inputs to `build`. No check reads them. */
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
  /** `funded`: the funding signature, transaction hash or signed `0x76` transaction. */
  voucher(funded: Hex): VoucherTypedData | Refusal;
  complete(funded: Hex, voucherSignature: Hex): MppCredential | Refusal;
};

/** The settlement read keys of these pairings. */
export interface SessionRef extends EvmRef {
  /** The transaction the credential presents, where the payer broadcast the opening before the claim. */
  transaction?: Hex;
  opened?: { address: Hex; version: "v1" | "v2"; channel: Hex; h: AtrHash; chainId: number };
  /**
   * The opening of an EVM session that the payer broadcast as a call: a call to `escrow` of `OPEN_V1_SELECTOR` whose
   * salt is `h`, and whose sender, payee, token and authorized signer, with `h`, the escrow and `chainId`, give
   * `channel`.
   */
  opens?: { escrow: Hex; channel: Hex; h: AtrHash; chainId: number };
  /** The close of an EVM session: a call to `escrow` of one of `EVM_CLOSE_SELECTORS` naming `channel`. */
  closes?: { escrow: Hex; channel: Hex };
  /**
   * The subscription's access key: its id, the token it spends, and `transferDigest({to: recipient})`. With `account`,
   * the read keys of a transfer made under the key for that account.
   */
  accessKey?: { keyId: Hex; token: Hex; to: Hex; account?: Hex };
}

export type SessionStatus =
  | EvmBreadthStatus
  | { state: "pending"; why: "not-a-close" }
  | { state: "failed"; why: "open-call-not-found" };

/**
 * The buyer's inputs to an in-channel payment: the within 402's challenge, echoed as given; the held opening, exactly
 * as signed; the cumulative amount to sign; and the action.
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
  | { kind: "ed25519-raw"; message: Uint8Array; signer: string }
  | { kind: "xrpl-claim"; channelId: string; drops: bigint; bytes: Uint8Array };

/** One signing request; `complete` takes its one signature and returns the in-channel credential. */
export interface SessionWithinUnsigned {
  requests: readonly WithinSigningRequest[];
  complete(signatures: readonly string[]): MppCredential | Refusal;
}

/** The actions `buildWithin` does not build: `topUp` (a new deposit), Solana's operator `use` and Lightning's `bearer`. */
const WITHIN_NOT_BUILT = ["topUp", "use", "bearer"];

/**
 * The checks `buildWithin` makes on its input before any channel value is read, in the input's member order: the
 * within challenge's shape and its intent and method; the opening, by `opened`, bound to `h`; the cumulative amount
 * below `limit`; and the action, `voucher` or `close`.
 */
export async function withinChecks<O>(
  w: SessionWithin,
  h: AtrHash,
  intentAndMethod: string,
  opened: (opening: MppCredential) => Promise<(O & { h: AtrHash }) | Refusal>,
  limit: bigint,
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
  if (WITHIN_NOT_BUILT.includes(w.action as string)) return refusal("mpp/within-action-not-built");
  if (w.action !== "voucher" && w.action !== "close") return refusal("mpp/session-action");
  return o;
}

/** The one signature of a within `complete`: `0x` and 65 bytes or more of hex. */
function oneHexSignature(signatures: readonly string[]): Hex | Refusal {
  if (!Array.isArray(signatures) || signatures.length !== 1) return refusal("mpp/credential-malformed");
  const [s] = signatures;
  return isHexBytes(s, 65, MAX_SIGNATURE) ? s : refusal("mpp/credential-malformed");
}

const SESSION_EVM = "mpp/session/evm" as const;
const SESSION_TEMPO = "mpp/session/tempo" as const;
const SUBSCRIPTION = "mpp/subscription/tempo" as const;
type ChannelId = typeof SESSION_EVM | typeof SESSION_TEMPO | typeof SUBSCRIPTION;

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const APPROVE_SELECTOR = "0x095ea7b3";
/**
 * The EVM session escrow's functions that finalize a channel, each taking the channel id as its first argument:
 * `close(bytes32,uint128,bytes)`, `closeWithAuthorization(bytes32,uint128,uint256,uint256,bytes,bytes)` and
 * `withdraw(bytes32)`.
 */
export const EVM_CLOSE_SELECTORS = Object.freeze(["0x0d65c51d", "0x79d35ded", "0x8e19899e"] as const);
const TEMPO_V1_DEFAULT_CHAIN = 4217;
const MAX_SIGNATURE = 8192;
const MAX_WIRE = 65_536;
/** `open(address,address,uint128,bytes32,address)`: the selector and five words. */
const OPEN_CALL_BYTES = 164;
const U96 = 1n << 96n;
const U128 = 1n << 128n;
const KEY_TYPES = { secp256k1: 0, p256: 1, webAuthn: 2 } as const;
const DAY = 86_400n;
const WEEK = 604_800n;

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
  const details = isObject(md) ? (md as { [k: string]: Json }) : {};
  const rawChain = details["chainId"];
  const chainId =
    typeof rawChain === "number" && Number.isSafeInteger(rawChain) && rawChain > 0
      ? rawChain
      : method === "tempo" && intent === "session" && rawChain === undefined
        ? TEMPO_V1_DEFAULT_CHAIN
        : undefined;
  if (chainId === undefined) return refusal("mpp/chain-id-required");
  const version = details["sessionProtocol"] === "v2" ? "v2" : "v1";
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
  return "refused" in p ? p : p.network;
}

// ── Shared steps.

function offerFor(choice: MppChoice, h: AtrHash, pairing: ChannelId): Checked | Refusal {
  if (!isObject(choice) || !isObject(choice.challenge)) return refusal("mpp/input-malformed");
  const checked = checkChallenge(choice.challenge, true);
  if ("refused" in checked) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  const fromId = challengeIdH(choice.challenge);
  if (typeof fromId !== "string" || typeof h !== "string" || !hashEquals(fromId, h)) return refusal("mpp/id-not-ours");
  if (!isAddress(choice.from)) return refusal("mpp/input-malformed");
  return checked;
}

function echoed(
  presented: MppCredential,
  pairing: ChannelId,
): { h: AtrHash; checked: Checked; payload: { [k: string]: Json } } | Refusal {
  const b = challengeBound(presented);
  if ("refused" in b) return b;
  const checked = checkChallenge(presented.challenge, true);
  if ("refused" in checked) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  return { h: b.h, checked, payload: presented.payload };
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

function unplaced(option: MppChallenge): Json {
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
 * salt `h` is the channel. Where `ref.opens` is present, the succeeded transaction must be the open call `opens`
 * describes, read by `eth_getTransactionByHash`, else failed `open-call-not-found`. Where `ref.closes` is present, the
 * succeeded transaction must be a call to that escrow whose calldata starts with one of `EVM_CLOSE_SELECTORS` and
 * whose first argument is that channel, else pending `not-a-close`. Where `ref.accessKey.account` is present, the
 * succeeded receipt must also hold the account keychain's `AccessKeySpend` log naming that account, key and token, else
 * failed `binding-log-not-found`. At most four calls.
 */
export async function sessionStatus(ref: SessionRef & { transaction: Hex }, reader: EvmReader): Promise<SessionStatus> {
  if (typeof reader !== "object" || reader === null || typeof ref !== "object" || ref === null) {
    return { state: "pending", why: "unreadable" };
  }
  let seen: EvmReceipt | null = null;
  const watching: EvmReader = {
    network: reader.network,
    receipt: async (tx) => (seen = await reader.receipt(tx)),
    blockNumber: (tag) => reader.blockNumber(tag),
    transaction: (tx) => reader.transaction(tx),
    call: (to, data, block) => reader.call(to, data, block),
  };
  const s = await evmStatus(ref, watching);
  if (s.state === "settled" && ref.opens !== undefined) return openRead(s, ref.transaction, ref.opens, reader);
  if (s.state === "settled" && ref.closes !== undefined) return closeRead(s, ref.transaction, ref.closes, reader);
  if (s.state === "settled" && ref.accessKey?.account !== undefined) {
    return spentUnder((seen as EvmReceipt | null)?.logs ?? [], ref.accessKey) ? s : { state: "failed", why: "binding-log-not-found" };
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
  return opened ? s : { state: "failed", why: "binding-log-not-found" };
}

/** Whether the logs hold the account keychain's `AccessKeySpend` naming the key's account, key id and token. */
function spentUnder(logs: readonly EvmLog[], k: NonNullable<SessionRef["accessKey"]>): boolean {
  if (!isAddress(k.account) || !isAddress(k.keyId) || !isAddress(k.token)) return false;
  const topics = [ACCESS_KEY_SPEND_TOPIC, ...[k.account, k.keyId, k.token].map((a) => hexOf(addressWord(a)))];
  return logs.some(
    (l) => sameBytes(l.address, ACCOUNT_KEYCHAIN) && l.topics.length === 4 && topics.every((t, i) => sameBytes(l.topics[i], t)),
  );
}

/**
 * The read keys of a transfer made under the subscription's access key, from a receipt of the key's registration: the
 * account whose key authorization carried `h` and registered the key (`keyAccount`), then `accessKey` with that
 * account, the token's `Transfer` to the recipient's digest, and the keychain's `AccessKeySpend` filter for the account,
 * the key and the token. Refused when `ref` carries no access key, or the receipt did not register it under `h`.
 */
export function keySearch(ref: SessionRef, receipt: EvmReceipt, h: AtrHash): SessionRef | Refusal {
  const k = isObject(ref) ? ref.accessKey : undefined;
  if (!isObject(k) || !isAddress(k.keyId) || !isAddress(k.token) || normalHash(k.to) === null) return refusal("tempo/no-access-key");
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
  if ("refused" in p) return p;
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

/** The EVM opening's checked values: payer, salt H, signer and the channel id's agreement with them. */
function evmOpened(
  presented: MppCredential,
): { h: AtrHash; checked: Checked; opening: Opening; payer: Hex; escrow: Hex; auth: { [k: string]: Json } } | Refusal {
  const e = echoed(presented, SESSION_EVM);
  if ("refused" in e) return e;
  const opening = evmOpening(e.payload);
  if ("refused" in opening) return opening;
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
  const escrow = str(e.checked.details["escrowContract"]) as Hex;
  const expect = evmChannelId({
    payer,
    payee: str(e.checked.request["recipient"]) as Hex,
    token: str(e.checked.request["currency"]) as Hex,
    salt: e.h,
    authorizedSigner: signer,
    escrow,
    chainId: e.checked.details["chainId"] as number,
  });
  const channel = normalHash(e.payload["channelId"]);
  if (typeof expect !== "string" || channel === null || !sameBytes(channel, expect)) {
    return refusal("mpp/channel-not-bound");
  }
  if (type === "authorization") {
    const nonce = keccakHex(
      concat([
        addressWord(payer),
        addressWord(str(e.checked.request["recipient"]) as Hex),
        addressWord(str(e.checked.request["currency"]) as Hex),
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
  return { h: e.h, checked: e.checked, opening, payer, escrow, auth };
}

async function evmBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const o = evmOpened(presented);
  return "refused" in o ? o : o.h;
}

async function evmReference(input: unknown): Promise<SessionRef | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const o = evmOpened(presented);
  if ("refused" in o) return o;
  const currency = str(o.checked.request["currency"]) as Hex;
  const network = `eip155:${o.checked.details["chainId"] as number}` as const;
  if (o.opening.type === "hash") {
    const transaction = normalHash(o.opening.o["hash"]);
    if (transaction === null) return refusal("mpp/credential-malformed");
    const digest = await transferDigest({ from: o.payer, to: o.escrow });
    if (typeof digest !== "string") return digest;
    const channel = normalHash(presented.payload["channelId"]);
    if (channel === null) return refusal("mpp/credential-malformed");
    return {
      network,
      transaction: transaction as Hex,
      transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to", digest },
      opens: { escrow: o.escrow, channel: channel as Hex, h: o.h, chainId: o.checked.details["chainId"] as number },
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
  return {
    network,
    settleBy: deadline.toString(),
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
  };
}

async function evmBuild(choice: SessionChoice, h: AtrHash): Promise<SessionUnsigned | Refusal> {
  const o = offerFor(choice, h, SESSION_EVM);
  if ("refused" in o) return o;
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
  const deadline = BigInt(o.expires);
  const challenge = { ...choice.challenge };
  const source = `did:pkh:eip155:${chainId}:${from}`;
  const voucher = (funded: Hex): VoucherTypedData | Refusal =>
    isHexBytes(funded, 1, MAX_WIRE) ? voucherData("EVM Payment Channel", "uint128", chainId, escrow, channelId) : refusal("mpp/credential-malformed");
  const base = { action: "open", channelId, cumulativeAmount: "0", authorizedSigner: signer, salt };

  if (type === "hash") {
    const calls = [
      { to: currency, data: words(APPROVE_SELECTOR, [addressWord(escrow), uintWord(deposit)]) },
      {
        to: escrow,
        data: words(OPEN_V1_SELECTOR, [addressWord(recipient), addressWord(currency), uintWord(deposit), bytes32Word(salt), addressWord(signer)]),
      },
    ];
    return {
      funding: { kind: "evm-calls", chainId, calls, broadcast: true },
      voucher,
      complete(funded: Hex, voucherSignature: Hex): MppCredential | Refusal {
        if (normalHash(funded) === null || !isHexBytes(voucherSignature, 65, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
        return { challenge, source, payload: { ...base, type: "hash", hash: funded, signature: voucherSignature } };
      },
    };
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
  if ("refused" in typedData) return typedData;
  return {
    funding: { kind: "eip712", typedData },
    voucher,
    complete(funded: Hex, voucherSignature: Hex): MppCredential | Refusal {
      if (!isHexBytes(funded, 65, MAX_SIGNATURE) || !isHexBytes(voucherSignature, 65, MAX_SIGNATURE)) {
        return refusal("mpp/credential-malformed");
      }
      return {
        challenge,
        source,
        payload: { ...base, type, authorization, signature: funded, voucherSignature },
      };
    },
  };
}

/** The transaction a `hash` opening presents, which the payer broadcast before the claim; undefined for any other. */
function evmLandedTx(presented: unknown): string | undefined {
  const c = credentialOf(presented);
  if ("refused" in c) return undefined;
  const opening = evmOpening(c.payload);
  if ("refused" in opening || opening.type !== "hash") return undefined;
  return normalHash(opening.o["hash"]) ?? undefined;
}

/** The close keys of an EVM session: the network, and the escrow the issued challenge names with the channel. */
function evmCloseRef(chosen: MppChallenge, channel: string): SessionRef | Refusal {
  const p = paramsOf(chosen);
  if ("refused" in p) return p;
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
 * A succeeded transaction read as an EVM session's opening, by `eth_getTransactionByHash`: sent to the escrow, with
 * 164 bytes of calldata `open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)`,
 * its salt `h`, and `evmChannelId` over the transaction's sender, the call's payee, token and authorized signer, `h`,
 * the escrow and the chain equal to the channel. The deposit is not read.
 */
async function openRead(
  settled: SessionStatus,
  transaction: Hex,
  opens: NonNullable<SessionRef["opens"]>,
  reader: EvmReader,
): Promise<SessionStatus> {
  let tx: Awaited<ReturnType<EvmReader["transaction"]>>;
  try {
    tx = await reader.transaction(transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (tx === null) return { state: "pending", why: "not-found" };
  const readable = isObject(tx) && isAddress(tx.from) && (tx.to === null || isAddress(tx.to)) && isHexBytes(tx.input, 0, Infinity);
  if (!readable) return { state: "pending", why: "unreadable" };
  const input = bytesOf(tx.input, OPEN_CALL_BYTES);
  if (input?.length !== OPEN_CALL_BYTES) return { state: "failed", why: "open-call-not-found" };
  const word = (i: number) => input.subarray(4 + 32 * i, 4 + 32 * (i + 1));
  /** An ABI address word: 12 zero bytes, then the address. */
  const address = (i: number) => (word(i).subarray(0, 12).every((b) => b === 0) ? hexOf(word(i).subarray(12)) : undefined);
  const payee = address(0);
  const token = address(1);
  const signer = address(4);
  const { escrow, chainId, channel, h } = opens;
  const opening =
    tx.to !== null &&
    sameBytes(tx.to, escrow) &&
    hexOf(input.subarray(0, 4)) === OPEN_V1_SELECTOR &&
    sameBytes(hexOf(word(3)), h) &&
    payee !== undefined &&
    token !== undefined &&
    signer !== undefined &&
    sameBytes(evmChannelId({ payer: tx.from, payee, token, salt: h, authorizedSigner: signer, escrow, chainId }), channel);
  return opening ? settled : { state: "failed", why: "open-call-not-found" };
}

/**
 * A voucher, or a close's final voucher, on the channel the held opening opened: `Voucher(bytes32 channelId,uint128
 * cumulativeAmount)` under "EVM Payment Channel", with the channel id, the escrow and the chain from the opening.
 */
async function evmBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const o = await withinChecks(w, h, "session/evm", async (opening) => evmOpened(opening), U128);
  if (isRefusal(o)) return o;
  const channelId = normalHash(w.opening.payload["channelId"]);
  if (channelId === null) return refusal("mpp/credential-malformed");
  const chainId = o.checked.details["chainId"] as number;
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
      return {
        challenge,
        payload: { action, channelId, cumulativeAmount, signature, ...(descriptor === undefined ? {} : { descriptor }) },
      };
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

/** The v2 descriptor's salt, when the descriptor's channel id is the payload's channel. */
function descriptorSalt(payload: { [k: string]: Json }, p: Params): AtrHash | Refusal {
  const d = descriptorOf(payload["descriptor"]);
  if (d === undefined) return refusal("tempo/descriptor-mismatch");
  const id = tempoChannelId({ ...d, escrow: p.escrow, chainId: p.chainId });
  const channel = normalHash(payload["channelId"]);
  const salt = normalHash(d.salt);
  if (typeof id !== "string" || channel === null || salt === null || !sameBytes(id, channel)) {
    return refusal("tempo/descriptor-mismatch");
  }
  return salt;
}

async function tempoBoundWithin(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const payload = payloadOf(presented);
  if (isRefusal(payload)) return payload;
  const p = paramsOf(isObject(presented) ? presented.challenge : undefined);
  if ("refused" in p) return p;
  if (p.version !== "v2") return refusal("mpp/not-bound-within");
  return descriptorSalt(payload, p);
}

/** The one `open` call to the escrow in the signed transaction, with its salt word equal to H. */
function tempoOpened(
  presented: MppCredential,
): { h: AtrHash; checked: Checked; params: Params; validBefore: bigint | null; channel: Hex } | Refusal {
  const e = echoed(presented, SESSION_TEMPO);
  if ("refused" in e) return e;
  if (e.payload["action"] !== "open" || e.payload["type"] !== "transaction") return refusal("mpp/not-an-opening");
  const p = paramsOf(presented.challenge);
  if ("refused" in p) return p;
  const wire = e.payload["transaction"];
  if (typeof wire !== "string" || wire.length % 2 !== 0 || !/^0x[0-9a-fA-F]*$/.test(wire)) return refusal("mpp/credential-malformed");
  if ((wire.length - 2) / 2 > MAX_WIRE) return refusal("tempo/tx-too-large");
  const tx = decodeTempoTx(bytesOf(wire)!);
  if ("refused" in tx) return tx;
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
  const channel = normalHash(e.payload["channelId"]);
  if (channel === null) return refusal("mpp/credential-malformed");
  if (p.version === "v2") {
    const salt = descriptorSalt(e.payload, p);
    if (typeof salt !== "string" || !hashEquals(salt, e.h)) return refusal("tempo/descriptor-mismatch");
  }
  return { h: e.h, checked: e.checked, params: p, validBefore: tx.validBefore, channel };
}

async function tempoBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const o = tempoOpened(presented);
  return "refused" in o ? o : o.h;
}

async function tempoReference(input: unknown): Promise<SessionRef | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const o = tempoOpened(presented);
  if ("refused" in o) return o;
  const topic0 = o.params.version === "v2" ? CHANNEL_OPENED_V2_TOPIC : CHANNEL_OPENED_V1_TOPIC;
  return {
    network: o.params.network,
    settleBy: (o.validBefore ?? BigInt(o.checked.expires)).toString(),
    search: { address: o.params.escrow, topics: [topic0, o.channel] },
    opened: { address: o.params.escrow, version: o.params.version, channel: o.channel, h: o.h, chainId: o.params.chainId },
  };
}

async function tempoBuild(choice: SessionChoice, h: AtrHash): Promise<SessionUnsigned | Refusal> {
  const o = offerFor(choice, h, SESSION_TEMPO);
  if ("refused" in o) return o;
  const p = paramsOf(choice.challenge);
  if ("refused" in p) return p;
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

  const opened = (signedTx: Hex) => {
    const wire = isHexBytes(signedTx, 1, MAX_WIRE) ? bytesOf(signedTx)! : undefined;
    if (wire === undefined) return refusal("mpp/credential-malformed");
    if (p.version === "v1") {
      const channelId = evmChannelId({ payer: from, payee: recipient, token: currency, salt, authorizedSigner: signer, escrow: p.escrow, chainId: p.chainId });
      return typeof channelId === "string" ? { channelId } : channelId;
    }
    const nonceHash = expiringNonceHash(wire, from);
    if (typeof nonceHash !== "string") return nonceHash;
    const descriptor = { payer: from, payee: recipient, operator, token: currency, salt, authorizedSigner: signer, expiringNonceHash: nonceHash };
    const channelId = tempoChannelId({ ...descriptor, escrow: p.escrow, chainId: p.chainId });
    return typeof channelId === "string" ? { channelId, descriptor } : channelId;
  };
  return {
    funding: { kind: "tempo-call", chainId: p.chainId, call: { to: p.escrow, data }, validBefore: o.expires, broadcast: false },
    voucher(signedTx: Hex): VoucherTypedData | Refusal {
      const c = opened(signedTx);
      if ("refused" in c) return c;
      return p.version === "v2"
        ? voucherData("TIP20 Channel Reserve", "uint96", p.chainId, p.escrow, c.channelId)
        : voucherData("Tempo Stream Channel", "uint128", p.chainId, p.escrow, c.channelId);
    },
    complete(signedTx: Hex, voucherSignature: Hex): MppCredential | Refusal {
      const c = opened(signedTx);
      if ("refused" in c) return c;
      if (!isHexBytes(voucherSignature, 65, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      return {
        challenge,
        source,
        payload: {
          action: "open",
          type: "transaction",
          channelId: c.channelId,
          transaction: signedTx,
          authorizedSigner: signer,
          ...("descriptor" in c && c.descriptor !== undefined ? { descriptor: c.descriptor } : {}),
          cumulativeAmount: "0",
          signature: voucherSignature,
        },
      };
    },
  };
}

/** The close's read keys: the escrow's `ChannelClosed` naming the channel, as the binding log and as the search filter. */
function tempoCloseRef(chosen: MppChallenge, channel: string): SessionRef | Refusal {
  const p = paramsOf(chosen);
  if ("refused" in p) return p;
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
 * descriptor. The channel id, the escrow, the chain and the descriptor come from the opening.
 */
async function tempoBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const version = isObject(w) && isObject(w.opening) ? paramsOf(w.opening.challenge) : refusal("mpp/input-malformed");
  const limit = !isRefusal(version) && version.version === "v2" ? U96 : U128;
  const o = await withinChecks(w, h, "session/tempo", async (opening) => tempoOpened(opening), limit);
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

function subscriptionWitness(presented: MppCredential): { h: AtrHash; checked: Checked; keyId: Hex } | Refusal {
  const e = echoed(presented, SUBSCRIPTION);
  if ("refused" in e) return e;
  if (e.payload["type"] !== "keyAuthorization") return refusal("mpp/not-an-opening");
  const signed = e.payload["signature"];
  if (typeof signed !== "string") return refusal("tempo/key-authorization-malformed");
  const k = decodeKeyAuthorization(signed as Hex);
  if ("refused" in k) return k;
  if (k.witness === undefined) return refusal("tempo/no-witness");
  if (!hashEquals(k.witness, e.h)) return refusal("tempo/witness-not-bound");
  return { h: e.h, checked: e.checked, keyId: k.keyId };
}

async function subscriptionBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const w = subscriptionWitness(presented);
  return "refused" in w ? w : w.h;
}

async function subscriptionReference(input: unknown): Promise<SessionRef | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const w = subscriptionWitness(presented);
  if ("refused" in w) return w;
  const r = w.checked.request;
  const currency = str(r["currency"]) as Hex;
  const digest = await transferDigest({ to: str(r["recipient"]) as Hex, value: BigInt(str(r["amount"])) });
  if (typeof digest !== "string") return digest;
  const to = await transferDigest({ to: str(r["recipient"]) as Hex });
  if (typeof to !== "string") return to;
  return {
    network: `eip155:${w.checked.details["chainId"] as number}`,
    bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: w.h },
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "to,value", digest },
    search: { address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, null, w.h] },
    accessKey: { keyId: w.keyId, token: currency, to },
  };
}

async function subscriptionRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const payload = payloadOf(presented);
  if (isRefusal(payload)) return payload;
  const p = paramsOf(presented.challenge);
  if ("refused" in p) return p;
  if (typeof payload["signature"] !== "string") return refusal("tempo/key-authorization-malformed");
  const k = decodeKeyAuthorization(payload["signature"] as Hex);
  return "refused" in k ? k : { network: p.network, channel: k.digest };
}

function subscriptionUntil(presented: MppCredential): number | undefined {
  const p = isObject(presented) ? paramsOf(presented.challenge) : undefined;
  if (p === undefined || "refused" in p) return undefined;
  const e = p.request["subscriptionExpires"];
  return typeof e === "string" ? unixOf(e) : undefined;
}

async function subscriptionBuild(choice: SessionChoice, h: AtrHash): Promise<KeyAuthorizationUnsigned | Refusal> {
  const o = offerFor(choice, h, SUBSCRIPTION);
  if ("refused" in o) return o;
  const r = o.request;
  const key = o.details["accessKey"] as { accessKeyAddress: Hex; keyType: keyof typeof KEY_TYPES };
  const chainId = o.details["chainId"] as number;
  const currency = str(r["currency"]) as Hex;
  const authorization: TempoKeyAuthorization = {
    chainId: BigInt(chainId),
    keyType: KEY_TYPES[key.keyType],
    keyId: key.accessKeyAddress,
    expiry: BigInt(unixOf(str(r["subscriptionExpires"]))!),
    limits: [{ token: currency, limit: BigInt(str(r["amount"])), period: BigInt(str(r["periodCount"])) * (r["periodUnit"] === "week" ? WEEK : DAY) }],
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
      if (!isHexBytes(rootSignature, 65, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      const signed = encodeKeyAuthorization(authorization, rootSignature);
      if (!(signed instanceof Uint8Array)) return signed;
      return { challenge, source, payload: { type: "keyAuthorization", signature: hexOf(signed) } };
    },
  };
}

function subscriptionCloseRef(chosen: MppChallenge, _channel: string): SessionRef | Refusal {
  const p = paramsOf(chosen);
  if ("refused" in p) return p;
  const key = p.details["accessKey"];
  const address = isObject(key) ? key["accessKeyAddress"] : undefined;
  if (!isAddress(address)) return refusal("mpp/access-key-malformed");
  return {
    network: p.network,
    bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_REVOKED_TOPIC, index: 2, value: hexOf(addressWord(address)) },
  };
}

// ── The records.

const LATER_VOUCHERS =
  "Later requests in this channel were paid under this ATR by vouchers the seller did not meter; each voucher " +
  "signs a commitment to this ATR's hash.";

function sessionPattern(proves: string): LcpPattern {
  return deepFreeze({
    pattern: "native-field",
    canonical: false,
    profile: "mpp/session/evm-tempo",
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: true,
    proves,
  });
}

async function notBoundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

/** The network and the payload's `channelId`, lowercase. */
async function refFrom(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const payload = payloadOf(presented);
  if (isRefusal(payload)) return payload;
  const p = paramsOf(presented.challenge);
  if ("refused" in p) return p;
  const channel = channelOf(payload);
  return typeof channel === "string" ? { network: p.network, channel } : channel;
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
      "deposit to the escrow. Where the payer sent the open call, the seller read that call: it is to the escrow, its " +
      "salt is this ATR's hash, and its sender, payee, token and authorized signer give this channel id, so the payer " +
      "is the account that signed it. Where the opening is an EIP-3009 authorization or a Permit2 transfer, the " +
      "seller's server verified that the transaction created this channel. This does not show that amount, payee, " +
      "asset or timing match the ATR's content. " +
      LATER_VOUCHERS,
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
  status: sessionStatus,
  landedTx: evmLandedTx,
  closeRef: evmCloseRef,
  channel: Object.freeze({ kind: evmKind, ref: refFrom, boundWithin: notBoundWithin, until: noEnd }),
});

export const sessionTempo = Object.freeze({
  id: SESSION_TEMPO,
  pattern: sessionPattern(
    "The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with " +
      "the challenge's position. The payer signed a Tempo transaction whose one call to the channel escrow opens a " +
      "channel with this ATR's hash as its salt, and the chain verified that signature when it executed the call. The " +
      "escrow's ChannelOpened event names the channel, whose id commits to the salt; on the TIP-1034 escrow the event " +
      "also carries the salt itself. This does not show that amount, payee, asset or timing match the ATR's content. " +
      LATER_VOUCHERS,
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
  status: sessionStatus,
  closeRef: tempoCloseRef,
  channel: Object.freeze({ kind: tempoKind, ref: refFrom, boundWithin: tempoBoundWithin, until: noEnd }),
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
      "transferred the first period's payment to the recipient. This does not show that amount, period, payee, asset " +
      "or timing match the ATR's content. Later billing periods were paid under this ATR by renewal transfers the " +
      "seller did not read.",
  } satisfies LcpPattern),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: subscriptionBuild,
  bound: subscriptionBound,
  reference: subscriptionReference,
  status: sessionStatus,
  closeRef: subscriptionCloseRef,
  channel: Object.freeze({ kind: subscriptionKind, ref: subscriptionRef, boundWithin: notBoundWithin, until: subscriptionUntil }),
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
    "content. Later billing periods were paid under this ATR by renewal transfers the seller did not read.",
});
