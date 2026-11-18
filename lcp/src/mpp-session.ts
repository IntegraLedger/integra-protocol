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
  uintOf,
  uintWord,
  wordAt,
  type Hex,
} from "./evm-abi.js";
import {
  PERMIT2,
  TRANSFER_TOPIC,
  permit2TypedData,
  transferDigest,
  type EvmBreadthStatus,
  type EvmLog,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type EvmTransaction,
  type Permit2TypedData,
} from "./evm.js";
import { isAddress, normalHash, uint256Of } from "./fields.js";
import {
  byType,
  challengeSnapshot,
  chosenHeld,
  credentialOf,
  decodeObject,
  deepFreeze,
  echoedFor,
  expiresOf,
  isChallengeShape,
  isHexBytes,
  isObject,
  issuedFor,
  measured,
  measuring,
  measuringAsync,
  offeredFor,
  place,
  read,
  requestAddress,
  sessionBroadcaster,
  subscriptionPeriod,
  tie,
  unixOf,
  type Checked,
  type Chosen,
  type Echoed,
  type MppChallenge,
  type MppChoice,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import {
  evmAnswer,
  failedAt,
  failedIfFinal,
  finalAt,
  evmLedger,
  isEvmQuery,
  isLog,
  isReceipt,
  ReaderError,
  readerFault,
  readEvm,
  receiveTypedData,
  rejected,
  transferParts,
  unreadable,
  withPayee,
  type EvmMark,
  type EvmQuery,
  type EvmRead,
  type EvmWhy,
  type ReceiveTypedData,
} from "./internal/evm.js";
import { mppPayee } from "./internal/payee.js";
import { decide, type Act, type Facts, type Moved, type Presented, type RecoverInput, type Seen, type UnreadableReason } from "./internal/read.js";
import type { EvmSearchReader } from "./internal/evm-search.js";
import { search } from "./internal/evm-x402.js";
import type { Broadcaster } from "./internal/broadcaster.js";
import type { HederaVoucherTypedData } from "./internal/hedera-session.js";
import { readKeyAuthorization, type KeyAuthorizationRead } from "./internal/key-authorization.js";
import { keyAccount } from "./internal/tempo.js";
import { consumerOf, readValue, sameValue, takesProtocolNonce, tempoValueOf, type TempoSearchReader, type TempoValue } from "./internal/tempo-nonce.js";
import { KEY_AUTHORIZATION_WITNESS_BURNED_TOPIC, burnConsumer, readSlot, slotConsumer, type KeySlot, type SlotRead } from "./internal/tempo-key-slot.js";
import { authorizationSignatures, carriedKeyAuthorization, keyAuthorizationSigner, tempoSender } from "./internal/tempo-envelope.js";
import { movedFrom } from "./mpp-tempo.js";
import { readReceiptAtMark } from "./receipt.js";
import {
  OPEN_WITH_AUTHORIZATION_SELECTOR,
  OPEN_WITH_PERMIT2_SELECTOR,
  echoesOption,
  mppSessionOpeningStatus,
  type MppSessionOpeningRef,
  type Signed,
} from "./internal/mpp-evm-read.js";
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
import { MAX_SIGNATURE_BYTES } from "./internal/bounds.js";
import { EIP155_TEMPO_MPP } from "./internal/data/eip155-tempo-mpp.js";
import type { Entry } from "./internal/registry.js";

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
  credentialType?: "authorization" | "permit2";
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
    | {
        kind: "eip712";
        typedData: ReceiveTypedData | Permit2TypedData;
        /**
         * On an `authorization` funding, what its nonce commits to besides the typed data's `from` and token (the
         * domain's `verifyingContract`): `evmSessionAuthorizationNonce({from, payee, token, salt, authorizedSigner})` is
         * the nonce, so a client can show the payee and the authorized signer and hold the nonce to them. A Permit2
         * funding names them in its witness and gives none.
         */
        opening?: { payee: Hex; salt: Hex; authorizedSigner: Hex };
      }
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
   * credential is over the credential size bound (`mpp/credential-malformed`). On an `eip712` funding,
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
  /** The transaction the credential presents, where the payer broadcast the opening before presenting it. */
  transaction?: Hex;
  opened?: { address: Hex; version: "v1" | "v2"; channel: Hex; h: AtrHash; chainId: number };
  /**
   * The opening of an EVM session: the escrow's open call whose salt is `h`, and whose payer, payee, token and
   * authorized signer, with `h`, the escrow and `chainId`, give `channel`. With `payer`, `funding` and `presented`,
   * `status` reads the opening by its funding (`mppSessionOpeningStatus`).
   */
  opens?: { escrow: Hex; channel: Hex; h: AtrHash; chainId: number };
  /** The EVM opening's funding, as `MppSessionOpeningRef` names it: its type, token, value's keeper, nonce and bound. */
  funding?: MppSessionOpeningRef["funding"];
  /** The members of the EVM opening's payment presented, as `MppSessionOpeningRef` names them. */
  presented?: Signed;
  /** The close of an EVM session: a call to `escrow` of one of `EVM_CLOSE_SELECTORS` naming `channel`. */
  closes?: { escrow: Hex; channel: Hex };
  /**
   * The subscription's access key: its id, the token it spends, and `transferDigest({to: recipient})`; `expiry`, the
   * key authorization's signed expiry in decimal Unix seconds, absent where it signs none. With `account`, the read keys
   * of a transfer made under the key for that account.
   */
  accessKey?: { keyId: Hex; token: Hex; to: Hex; account?: Hex; expiry?: string };
  /** The close of a subscription: the account keychain's `KeyRevoked` whose topic 1 is `account` and topic 2 `keyId`. */
  revokes?: { account: Hex; keyId: Hex };
  /**
   * The payer: on a Tempo session the sender of the opening's transaction, recovered from its `0x76` form, on an EVM
   * session the account its authorization or permit is signed by, and on a subscription the account whose root key
   * signed the key authorization (`keyAuthorizationSigner`). With `opened`, `status` reads the Tempo opening by the
   * search for its `ChannelOpened` (`tempoOpeningStatus`); with a binding log under `KeyAuthorizationWitness`, the
   * activation by the search for that log (`activationStatus`).
   */
  payer?: Hex;
  /**
   * What the payer signed, as presented: on a Tempo session `expiringNonceHash` over the opening transaction's
   * sender-signed fields, in the `0x76` form whatever envelope carried it, under its sender; on a subscription
   * keccak-256 over the signed key authorization's bytes, the authorization and its root signature whole. A reference
   * that `status` reads by the search, with `payer`, holds it, and one without it is `unparseable`.
   */
  signed?: Hex;
  /**
   * On a Tempo session, the opening transaction's single-use value: its nonce key and nonce, in decimal, and its signed
   * `validBefore` in decimal Unix seconds, absent where it signs none. `status` reads the value by its key at the final
   * mark and at the latest head, through a reader that reads a block's state (`TempoSearchReader`).
   */
  nonce?: { key: string; value: string };
  validBefore?: string;
}

/** What these pairings' `status` answers, in the terms of `EvmBreadthStatus`. */
export type SessionStatus = EvmBreadthStatus;

/** What a read of an opening or a close observed, before the profile's rules choose the answer. */
type SessionRead = EvmRead<EvmWhy | "not-a-close" | "open-call-not-found">;

/**
 * The buyer's inputs to an in-channel payment: the within 402's challenge, which the in-channel credential echoes as
 * `buildWithin` reads it, a snapshot of its own members (`withinChecks`); the held opening, exactly as signed; the
 * cumulative amount to sign; and the action.
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

/** A within challenge as `buildWithin` holds it: the snapshot `challengeSnapshot` takes, with a string id. */
export type WithinChallenge = MppChallenge & { id: string };

/**
 * The checks `buildWithin` makes on its input before any channel value is read, in this order. First the within
 * challenge, read as the pairing's `channel.kind`, `channel.ref` and `channel.boundWithin` read the payment that carries
 * it, with their code for each fault: the snapshot `challengeSnapshot` takes of it, its own members only, which is the
 * challenge the credential carries; a value that is not an object, a snapshot that is not challenge-shaped or has no
 * string id, and one whose least credential, `{ challenge, payload: {} }`, is over the credential size bound,
 * `mpp/credential-malformed`; another intent or method, `mpp/not-this-pairing`; then `read`, the readers' read of its
 * request, with their codes. The seller issues the within challenge with its own id and the channel named, so it is
 * not held to the pairing's filter, which refuses a challenge naming a channel, and its id is not read. Then `h`, a
 * valid ATR hash (else `mpp/id-not-ours`); the cumulative amount below `limit`; the action, `voucher` or `close`; and
 * last the opening, by `opened`, bound to `h`. Every check before the opening reads only the input and `h`, so a rail
 * whose opening needs an optional peer (the XRPL session's blob codec) gives each the same code with the peer and
 * without it. `notBuilt` lists the actions the pairing's draft defines within a channel that `buildWithin` does not
 * build: each is `mpp/within-action-not-built`, and an action neither built nor listed is `mpp/session-action`, as the
 * pairing's `channel.kind` answers an action its draft does not define. Each `buildWithin` then compares the within
 * challenge's channel parameters with the opening's where a reader refuses a payment whose challenge names others,
 * with that reader's code.
 */
export async function withinChecks<O, R>(
  w: SessionWithin,
  h: AtrHash,
  intentAndMethod: string,
  read: (challenge: WithinChallenge) => R | Refusal,
  opened: (opening: MppCredential) => Promise<(O & { h: AtrHash }) | Refusal>,
  limit: bigint,
  notBuilt: readonly string[],
): Promise<{ opening: O; within: R; challenge: WithinChallenge } | Refusal> {
  if (!isObject(w)) return refusal("mpp/input-malformed");
  const c = challengeSnapshot(w.challenge);
  if (c === undefined || !isChallengeShape(c) || typeof c.id !== "string") return refusal("mpp/credential-malformed");
  const challenge = c as WithinChallenge;
  const least = measured({ challenge, payload: {} });
  if (isRefusal(least)) return least;
  if (`${c.intent}/${c.method}` !== intentAndMethod) return refusal("mpp/not-this-pairing");
  const within = read(challenge);
  if (isRefusal(within)) return within;
  if (typeof h !== "string" || normalHash(h) === null) return refusal("mpp/id-not-ours");
  if (typeof w.cumulativeAmount !== "bigint" || w.cumulativeAmount < 0n || w.cumulativeAmount >= limit) {
    return refusal("mpp/input-malformed");
  }
  if (notBuilt.includes(w.action as string)) return refusal("mpp/within-action-not-built");
  if (w.action !== "voucher" && w.action !== "close") return refusal("mpp/session-action");
  const o = await opened(w.opening);
  if (isRefusal(o)) return o;
  if (!hashEquals(o.h, h)) return refusal("mpp/id-not-ours");
  return { opening: o, within, challenge };
}

/** The one signature of a within `complete`: `0x` and 1 to 8192 bytes of hex. */
function oneHexSignature(signatures: readonly string[]): Hex | Refusal {
  if (!Array.isArray(signatures) || signatures.length !== 1) return refusal("mpp/credential-malformed");
  const [s] = signatures;
  return isHexBytes(s, 1, MAX_SIGNATURE_BYTES) ? s : refusal("mpp/credential-malformed");
}

const SESSION_EVM = "mpp/session/evm" as const;
const SESSION_TEMPO = "mpp/session/tempo" as const;
const SUBSCRIPTION = "mpp/subscription/tempo" as const;
type ChannelId = typeof SESSION_EVM | typeof SESSION_TEMPO | typeof SUBSCRIPTION;

const ZERO = "0x0000000000000000000000000000000000000000" as const;
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
/** The shortest voucher signature `complete` takes: one byte. */
const SHORTEST_SIGNATURE = "0x00";
const MAX_WIRE = 65_536;
/** `open(address,address,uint128,bytes32,address)`: the selector and five words. */
const OPEN_CALL_BYTES = 164;
/**
 * The calldata the EVM session's `recover` decodes, at most 128 KiB, go-ethereum's transaction pool maximum for a whole
 * transaction (`core/txpool/legacypool/legacypool.go`, `txMaxSize = 4 * txSlotSize // 128KB`). `recover` refuses a
 * transaction with longer calldata `evm/no-open-call`, since the calldata is the transaction's own and every read gives
 * the same. `status` reads the opening by its funding and takes no bound from this one.
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

/**
 * The nonce an `mpp/session/evm` opening funded by an EIP-3009 `authorization` signs:
 * keccak256(abi.encode(address from, address payee, address token, bytes32 salt, address authorizedSigner)), which the
 * escrow recomputes in `openWithAuthorization` before it receives the deposit. Any value that is not an address, or a
 * salt that is not a 32-byte hash, is `mpp/input-malformed`.
 */
export function evmSessionAuthorizationNonce(c: {
  from: Hex;
  payee: Hex;
  token: Hex;
  salt: Hex;
  authorizedSigner: Hex;
}): Hex | Refusal {
  if (!isObject(c)) return refusal("mpp/input-malformed");
  const salt = normalHash(c.salt);
  for (const a of [c.from, c.payee, c.token, c.authorizedSigner]) {
    if (!isAddress(a)) return refusal("mpp/input-malformed");
  }
  if (salt === null) return refusal("mpp/input-malformed");
  return keccakHex(
    concat([addressWord(c.from), addressWord(c.payee), addressWord(c.token), bytes32Word(salt), addressWord(c.authorizedSigner)]),
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
 * The checked challenge `build` answers: a choice that is an object (else `mpp/input-malformed`), whose challenge is
 * held as `bound` holds an echoed one (`chosenHeld`), with `bound`'s code for each fault in it, and whose id carries
 * `h`; then `from` an address. `build` reads the challenge from the snapshot `chosenHeld` returns, and its credential
 * carries that snapshot.
 */
function offerFor(choice: MppChoice, h: AtrHash, pairing: ChannelId): Chosen | Refusal {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const held = chosenHeld(choice.challenge, pairing);
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

/**
 * MPP's `place` for `pairing`, with the agreement URL in `opaque` when one is given, and the act, once the offer names
 * `pairing` (`offeredFor`, else its refusal or `mpp/not-this-pairing`).
 */
function advertiseAs(pairing: ChannelId) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    position: number | null,
    act?: Act,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const offered = offeredFor(offer, pairing);
    if (isRefusal(offered)) return offered;
    return place(doc, h, link, offer, position, act, agreementUrl);
  };
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
 * The status of an opening or a close of any of the three pairings, answered as the profile `read-status` does at the
 * coverage of the pairing whose keys the ref names. The read is `evmStatus`'s on the named logs, then, where
 * `ref.opened` is present, one `ChannelOpened` log from `opened.address` naming the channel: on v2 its data word 3 (the
 * salt) is `h`; on v1 the channel id recomputed from the event with salt `h` is the channel. A ref with `opens` is the
 * EVM session's opening, read by its funding (`mppSessionOpeningStatus`), not by the named transaction. Where `ref.closes`
 * is present, the succeeded transaction must be a call to that escrow whose calldata starts with one of
 * `EVM_CLOSE_SELECTORS` and whose first argument is that channel. Where `ref.accessKey.account` is present, the
 * succeeded receipt must also hold the account keychain's `AccessKeySpend` log naming that account, key and token.
 * Where `ref.revokes` is present, the succeeded receipt must hold the account keychain's `KeyRevoked` log naming that
 * account and key. A transaction that fails one of these checks (an open call for another channel, any other
 * transaction, one sent through an ERC-4337 EntryPoint included, a call that is not the close, a missing log) is no
 * act, and with no search for H yet answers `pending` `search-incomplete`, as `evmStatus`'s reasons do. Settled carries
 * the highest mark reached and the receipt's block. An `opened` that is not one whose `address` is an
 * address, `version` `v1` or `v2`, `channel` and `h` 32-byte hashes and `chainId` a positive integer, a `closes` that
 * is not an object whose `escrow` is an address and `channel` a 32-byte hash, an `accessKey` that is not an object
 * whose `keyId` and `token` are addresses, `to` a 32-byte hash and `account`, when present, an address, or a `revokes`
 * that is not an object whose `account` and `keyId` are addresses, is unreadable `unparseable`, with no call made; so
 * is a ref that names none of the keys the three pairings' `reference`, `closeRef` and `keySearch` write for the
 * opening or the close (`opens`, `opened`, `closes`, `revokes`, an `accessKey` with `account`, or a binding log under
 * `ChannelClosed` or `KeyAuthorizationWitness`), and a query that is not one `status` takes. A
 * reader that is not an object is unreadable `transport`; what `evmStatus` reads as unreadable is unreadable for the
 * same reason. At most four calls.
 *
 * This function accepts a key of any of the three pairings. Each pairing's own `status` reads a ref only when it names
 * one of the keys that pairing writes and none of the other two pairings' keys: on `mpp/session/evm` `opens` or
 * `closes`; on `mpp/session/tempo` `opened` or a binding log under `ChannelClosed`;
 * on `mpp/subscription/tempo` `revokes`, an `accessKey` with `account` or a binding log under
 * `KeyAuthorizationWitness`. Any other ref is unreadable `unparseable` there, with no call made.
 */
export async function sessionStatus(
  ref: SessionRef & { transaction: Hex },
  reader: EvmReader,
  query: EvmQuery<SessionRef & { transaction: Hex }>,
): Promise<SessionStatus> {
  if (!isEvmQuery(query)) return { state: "unreadable", reason: "unparseable", foreign: [] };
  const pairing = isObject(ref) ? PAIRINGS.find((p) => names(ref, READ_KEYS[p])) : undefined;
  if (pairing === SESSION_EVM && ref.opens !== undefined && !names(ref, [...READ_KEYS[SESSION_TEMPO], ...READ_KEYS[SUBSCRIPTION]])) {
    return pairingStatus(SESSION_EVM)(ref, reader, query);
  }
  const coverage = EIP155_TEMPO_MPP[pairing ?? SESSION_EVM].coverage;
  return evmAnswer(await readSession(ref, reader), ref, query, coverage);
}

/** What `sessionStatus` reads of the named transaction. */
async function readSession(ref: SessionRef & { transaction: Hex }, reader: EvmReader): Promise<SessionRead> {
  if (typeof ref !== "object" || ref === null) return unreadable("unparseable");
  if (typeof reader !== "object" || reader === null) return unreadable("transport");
  if (!names(ref, ALL_READ_KEYS)) return unreadable("unparseable");
  if (ref.revokes !== undefined && !readableRevokes(ref.revokes)) return unreadable("unparseable");
  if (ref.opened !== undefined && !readableOpened(ref.opened)) return unreadable("unparseable");
  if (ref.closes !== undefined && !readableCloses(ref.closes)) return unreadable("unparseable");
  if (ref.accessKey !== undefined && !readableAccessKey(ref.accessKey)) return unreadable("unparseable");
  let seen: EvmReceipt | null = null;
  const watching: EvmReader = {
    network: reader.network,
    receipt: async (tx) => (seen = await reader.receipt(tx)),
    blockNumber: (tag) => reader.blockNumber(tag),
    transaction: (tx) => reader.transaction(tx),
    call: (to, data, block) => reader.call(to, data, block),
  };
  const s = await readEvm(ref, watching);
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
    const salt = word(2);
    const payer = bytesOf(l.topics[2]);
    const payee = bytesOf(l.topics[3]);
    if (token === undefined || signer === undefined || payer?.length !== 32 || payee?.length !== 32) return false;
    if (salt === undefined || !sameBytes(hexOf(salt), o.h)) return false;
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

// ── The read of an opening by its search (read-status; mpp-session-evm-tempo.md rule 6).

/** One deposit an opening made: the channel's token, the deposit, and the channel's payee as the beneficiary. */
type OpeningMoved = Moved & { readonly transaction: Hex; readonly place: number };

/** The final, `safe` and latest blocks, with their times; a network that serves no `safe` reads it as the final one. */
async function headsOf(reader: EvmSearchReader): Promise<{ final: bigint; safe: bigint; latest: bigint } | { unreadable: UnreadableReason }> {
  try {
    const final = await reader.block("finalized");
    let safe = final;
    try {
      safe = await reader.block("safe");
    } catch {
      // As above.
    }
    const latest = await reader.block("latest");
    for (const b of [final, safe, latest]) if (!isObject(b) || typeof b.number !== "bigint") return { unreadable: "unparseable" };
    const s = safe.number < final.number ? final.number : safe.number;
    return { final: final.number, safe: s, latest: latest.number < s ? s : latest.number };
  } catch (e) {
    return { unreadable: rejected(e) };
  }
}


/** The address in a 32-byte topic or word, lowercase, or undefined. */
function addressIn(w: unknown): Hex | undefined {
  const b = typeof w === "string" ? bytesOf(w) : w instanceof Uint8Array ? w : undefined;
  return b === undefined || b.length !== 32 ? undefined : (addressOfWord(b)?.toLowerCase() as Hex | undefined);
}

/** The party a signer is against the reference's payer and the option's payee. */
function partyOf(signer: string | undefined, payer: string, payee: string): "payer" | "payee" | "other" {
  if (signer === undefined) return "other";
  if (sameBytes(signer, payee)) return "payee";
  return sameBytes(signer, payer) ? "payer" : "other";
}

/**
 * The Tempo transaction a hit names, read by its signed bytes (`eth_getRawTransactionByHash`): its sender, recovered
 * from its `0x76` form whatever envelope carried it, the open calls it makes to `escrow` under `selector`, and what its
 * sender signed (`expiringNonceHash`). A transaction of another type is no Tempo transaction, its sender read from
 * `eth_getTransactionByHash`; one the node holds no bytes for is read so too, its type and what it signed not shown
 * (`tempo` unknown); a `0x76` or `0x78` transaction that does not decode is an item the read cannot decode.
 */
async function tempoTxOf(
  hash: Hex,
  reader: EvmSearchReader,
  escrow: Hex,
  selector: Hex,
): Promise<{ tempo: boolean | "unknown"; sender?: Hex; opens: Uint8Array[]; signed?: Hex; value?: TempoValue; wire?: Uint8Array } | "undecodable" | { unreadable: UnreadableReason }> {
  let raw: unknown;
  try {
    raw = await reader.raw(hash);
  } catch (e) {
    return { unreadable: rejected(e) };
  }
  const bytes = typeof raw === "string" ? bytesOf(raw) : undefined;
  if (raw !== null && bytes === undefined) return { unreadable: "unparseable" };
  if (bytes !== undefined && (bytes[0] === 0x76 || bytes[0] === 0x78)) {
    const tx = decodeTempoTx(bytes);
    const sender = tempoSender(bytes);
    if (isRefusal(tx) || isRefusal(sender)) return "undecodable";
    const signed = expiringNonceHash(bytes, sender);
    const value = tempoValueOf(bytes);
    const opens = tx.calls.filter((c) => c.to !== null && sameBytes(c.to, escrow) && c.input.length >= 4 && sameBytes(hexOf(c.input.subarray(0, 4)), selector));
    return {
      tempo: true,
      sender: sender.toLowerCase() as Hex,
      opens: opens.map((c) => c.input),
      ...(typeof signed === "string" ? { signed } : {}),
      ...(value === undefined ? {} : { value }),
    };
  }
  let t: EvmTransaction | null;
  try {
    t = await reader.transaction(hash);
  } catch (e) {
    return { unreadable: rejected(e) };
  }
  if (t !== null && !isTransactionRead(t)) return { unreadable: "unparseable" };
  return {
    tempo: raw === null ? "unknown" : false,
    opens: [],
    ...(t === null ? {} : { sender: t.from.toLowerCase() as Hex }),
    ...(bytes === undefined ? {} : { wire: bytes }),
  };
}

/**
 * The `status` of a Tempo session's opening (mpp-session-evm-tempo.md rule 6), as the profile `read-status` answers it,
 * at Tempo's one mark, `finalized`: a query asking any other finality is `unreadable`, `unparseable`.
 * The search reads the escrow's `ChannelOpened` naming the channel, under the session version's event, from the
 * position the caller gives (or the one an earlier answer returned) to the latest head, and reads each transaction it
 * met, and the one the reference names, whole. Each `ChannelOpened` naming the channel is an act: it carries H where its
 * salt (v1 data word 2, v2 data word 3) is H; its signer is the sender of the Tempo transaction, against the reference's
 * payer and the option's payee; it is of the pairing's kind where that transaction is a Tempo transaction holding an
 * open call to the escrow, or one whose signed bytes the node does not hold, and of another where the channel was opened
 * otherwise; it names the payee's account where the event's `payee` is the option's payee, and moved the deposit,
 * recorded with the channel's token and its `payee` as the beneficiary, the token compared with nothing. `presented` is
 * `yes` where the hash the transaction's sender-signed fields give (`expiringNonceHash`) is the reference's `signed`,
 * `no` where it is another, and `unshown` where the node holds no signed bytes for it; a reference without `signed` is
 * unparseable. A reverted transaction the reference names is the payer's failed opening.
 *
 * The value: the opening transaction's nonce, read by its key at the final mark and at the latest head (`readValue`),
 * where the reference holds it (`nonce`) and the reader reads a block's state (`TempoSearchReader`); a value read
 * consumed whose transaction the search did not meet is looked for in the first block it reads consumed at
 * (`consumerOf`), a read there that fails being unreadable by its reason. A transaction met that took the value is
 * the consumer. The channel id is a digest over the payee and
 * the token as well as H, so the search is no search for H, and none is made for an opening: it is never read
 * whole, and the answer is never `failed` but `before-position`. The history is shown where the reader serves the block
 * the search starts at; a value read below the latest head that fails without it is `history-gap`. A ref that is not of
 * this form, or a reader for another network, is unreadable.
 */
async function tempoOpeningStatus(
  ref: SessionRef,
  reader: EvmSearchReader,
  query: EvmQuery<unknown>,
): Promise<SessionStatus> {
  if (query.finality !== "finalized") return { state: "unreadable", reason: "unparseable", foreign: [] };
  const facts = await tempoOpeningFacts(ref, reader, query);
  if ("unreadable" in facts) return { state: "unreadable", reason: facts.unreadable, foreign: [] };
  return decide(facts.facts, query, evmLedger(EIP155_TEMPO_MPP[SESSION_TEMPO].coverage));
}

/** Whether the reader reads a block's state and transactions, as the read of a Tempo nonce needs. */
function readsState(reader: EvmSearchReader): reader is TempoSearchReader {
  const r = reader as Partial<TempoSearchReader>;
  return typeof r.storageAt === "function" && typeof r.nonceAt === "function" && typeof r.blockTransactions === "function";
}

async function tempoOpeningFacts(
  ref: SessionRef,
  reader: EvmSearchReader,
  query: EvmQuery<unknown>,
): Promise<{ facts: Facts<bigint, EvmMark> } | { unreadable: UnreadableReason }> {
  if (!isObject(ref)) return { unreadable: "unparseable" };
  const fault = readerFault(ref, reader);
  if (fault !== undefined) return { unreadable: fault };
  if (!readableOpened(ref.opened) || !isAddress(ref.payer) || typeof ref.payee !== "string") return { unreadable: "unparseable" };
  if (normalHash(ref.signed) === null || (ref.transaction !== undefined && normalHash(ref.transaction) === null)) {
    return { unreadable: "unparseable" };
  }
  const signed = ref.signed!;
  const nonce: unknown = ref.nonce;
  const decimal = (x: unknown, digits: number): boolean => typeof x === "string" && new RegExp(`^[0-9]{1,${digits}}$`).test(x);
  if (nonce !== undefined && (!isObject(nonce) || !decimal(nonce["key"], 78) || !decimal(nonce["value"], 78))) {
    return { unreadable: "unparseable" };
  }
  if (ref.validBefore !== undefined && !decimal(ref.validBefore, 20)) return { unreadable: "unparseable" };
  if (typeof reader.logs !== "function" || typeof reader.block !== "function" || typeof reader.raw !== "function") return { unreadable: "transport" };
  const o = ref.opened!;
  const v2 = o.version === "v2";
  const topic0 = v2 ? CHANNEL_OPENED_V2_TOPIC : CHANNEL_OPENED_V1_TOPIC;
  const selector = v2 ? OPEN_V2_SELECTOR : OPEN_V1_SELECTOR;
  const heads = await headsOf(reader);
  if ("unreadable" in heads) return heads;
  // Tempo's one mark: a block above `finalized` is read at the latest head.
  const markOf = (b: bigint): EvmMark => (b <= heads.final ? "finalized" : "latest");
  const lo = query.after ?? 0n;
  const start = query.search ?? (query.after !== undefined ? query.after + 1n : 0n);
  const s = await search(reader, [{ address: o.address, topics: [topic0, o.channel] }], start, heads.latest);
  if ("unreadable" in s) return s;
  let history = true;
  try {
    const b = await reader.block(start);
    history = isObject(b) && typeof b.number === "bigint";
  } catch {
    history = false;
  }
  // The value, by its nonce key.
  const value: TempoValue | undefined =
    ref.nonce === undefined || !readsState(reader)
      ? undefined
      : {
          sender: ref.payer!,
          key: BigInt(ref.nonce.key),
          nonce: BigInt(ref.nonce.value),
          signed,
          validBefore: ref.validBefore === undefined ? null : BigInt(ref.validBefore),
        };
  let read: Awaited<ReturnType<typeof readValue>> | undefined;
  if (value !== undefined) {
    try {
      const final = await reader.block("finalized");
      const latest = await reader.block("latest");
      read = await readValue(value, reader as TempoSearchReader, final, latest, lo);
    } catch (e) {
      // A failed read of a block's state below the latest head is history-gap unless the reader names another reason.
      return { unreadable: !history || (!(e instanceof ReaderError) && heads.final < heads.latest) ? "history-gap" : rejected(e) };
    }
  }
  const hashes = new Map<string, Hex>();
  if (ref.transaction !== undefined) hashes.set(ref.transaction.toLowerCase(), ref.transaction);
  for (const e of s.entries) hashes.set(e.transactionHash.toLowerCase(), e.transactionHash);
  const seen: Seen<bigint, EvmMark>[] = [];
  const undecoded: { transaction: Hex; at: bigint }[] = [];
  const givenSigned = (query.others ?? []).flatMap((o) => ("ref" in o && isObject(o.ref) && typeof o.ref["signed"] === "string" ? [o.ref["signed"]] : []));
  const readOne = async (hash: Hex): Promise<{ unreadable: UnreadableReason } | undefined> => {
    let receipt: EvmReceipt | null;
    try {
      receipt = await reader.receipt(hash);
    } catch (e) {
      return { unreadable: rejected(e) };
    }
    if (receipt === null) return undefined;
    if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return { unreadable: "unparseable" };
    const tx = await tempoTxOf(hash, reader, o.address, selector);
    if (typeof tx === "object" && "unreadable" in tx) return tx;
    if (tx === "undecodable") {
      undecoded.push({ transaction: hash, at: receipt.blockNumber });
      return undefined;
    }
    const party = partyOf(tx.sender, ref.payer!, ref.payee);
    const presented: Presented = tx.signed === undefined ? "unshown" : sameBytes(tx.signed, signed) ? "yes" : "no";
    const took =
      value !== undefined && tx.value !== undefined
        ? sameValue(value, tx.value)
        : value !== undefined && tx.wire !== undefined
          ? await takesProtocolNonce(value, tx.wire, hash, reader)
          : presented === "yes";
    const place = { transaction: hash, position: receipt.blockNumber, mark: markOf(receipt.blockNumber) };
    // An act the caller gave by its reference: the fields its sender signed are those the given reference holds.
    const given = tx.signed !== undefined && givenSigned.some((g) => sameBytes(g, tx.signed!));
    const common = {
      party,
      consumed: took,
      ...(tx.sender === undefined ? {} : { signer: tx.sender }),
      presented,
      ...(given ? { given } : {}),
    };
    const before = seen.length;
    if (receipt.status === 0) {
      // A reverted opening emits no event: its call's salt and payee are read from what its sender signed.
      const call = tx.opens[0];
      const salt = call === undefined ? undefined : wordAt(call.subarray(4), v2 ? 4 : 3);
      const payee = call === undefined ? undefined : addressIn(wordAt(call.subarray(4), 0));
      seen.push({
        ...place,
        ...common,
        result: "failed",
        carries: salt !== undefined && sameBytes(hexOf(salt), o.h),
        kind: tx.tempo === true && call !== undefined ? "same" : "other",
        account: payee === undefined ? "none" : sameBytes(payee, ref.payee) ? "payee" : "other",
      });
      return undefined;
    }
    receipt.logs.forEach((l, i) => {
      if (l.topics.length !== 4 || !sameBytes(l.address, o.address) || !sameBytes(l.topics[0], topic0) || !sameBytes(l.topics[1], o.channel)) return;
      const data = bytesOf(l.data);
      const word = (n: number) => (data === undefined ? undefined : wordAt(data, n));
      const salt = word(v2 ? 3 : 2);
      const token = addressIn(word(v2 ? 1 : 0));
      const deposit = word(v2 ? 5 : 3);
      const payee = addressIn(l.topics[3]);
      const moved: OpeningMoved[] =
        token === undefined || deposit === undefined || payee === undefined
          ? []
          : [{ asset: token, amount: uintOf(deposit).toString(), to: payee, transaction: hash, place: i }];
      seen.push({
        ...place,
        ...common,
        result: "succeeded",
        carries: salt !== undefined && sameBytes(hexOf(salt), o.h),
        kind: tx.tempo === "unknown" || (tx.tempo && tx.opens.length > 0) ? "same" : "other",
        account: payee === undefined ? "none" : sameBytes(payee, ref.payee) ? "payee" : "other",
        moved,
      });
    });
    // A transaction that took the value and opened no channel: the consumer, of another kind, naming no account.
    if (took && seen.length === before) {
      seen.push({ ...place, ...common, result: "succeeded", carries: false, kind: "other", account: "none", moved: [] });
    }
    return undefined;
  };
  for (const hash of hashes.values()) {
    const r = await readOne(hash);
    if (r !== undefined) return r;
  }
  if (value !== undefined && read?.consumedAt !== undefined && !seen.some((x) => x.consumed)) {
    // A read of a block's state or transactions that fails is unreadable by its reason (`consumerOf`).
    const c = await consumerOf(value, reader as TempoSearchReader, lo, read.consumedAt);
    if (typeof c === "object") return c;
    if (c !== undefined && !hashes.has(c.toLowerCase())) {
      const r = await readOne(c);
      if (r !== undefined) return r;
    }
  }
  seen.sort((a, b) => (a.position! < b.position! ? -1 : a.position! > b.position! ? 1 : 0));
  undecoded.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    facts: {
      seen,
      ...(read === undefined ? {} : { value: read.value }),
      // No search for H: the opening's search is never read whole; its position is returned where it has range left.
      search: { whole: false, ...(s.at === undefined ? {} : { at: s.at }) },
      ...(undecoded.length === 0 ? {} : { undecoded }),
      history,
    },
  };
}

// ── The read of a subscription's activation by its key slot and its search (read-status; mpp-session-evm-tempo.md rule 7).

/**
 * The `status` of a subscription's activation (mpp-session-evm-tempo.md rule 7), as the profile `read-status` answers
 * it, at Tempo's one mark, `finalized`: a query asking any other finality is `unreadable`, `unparseable`.
 *
 * The value: the key slot the presented key authorization names in the payer's keychain, `getKey(payer, keyId)` read at
 * the final head and at the latest head (`readSlot`), consumed where it names the key or reads it revoked. The keychain
 * registers a key id for an account once, before the transaction's calls run and outside their checkpoint, so a
 * reverted activation registers it too (tempoxyz/tempo@c8b89f9b `crates/evm/src/handler.rs:831-834`). Its bound is the
 * key authorization's `expiry` (the reference's `accessKey.expiry`), where it signs one: the keychain registers no key
 * whose expiry is not after the block's timestamp and never clears a slot, so a slot unconsumed at a head past it is
 * never consumed by the presented key authorization. Beside the slot the read holds H's burn mark for the payer,
 * `isKeyAuthorizationWitnessBurned(payer, H)` at the same two heads (`readSlot`): a burned witness makes every key
 * authorization of the payer carrying it unlandable, so the value is consumed where either reads consumed. A mark read
 * burned whose transaction the search did not meet is found by its `KeyAuthorizationWitnessBurned` log in the first
 * block it reads burned at (`burnConsumer`), an act of another kind carrying H that consumed the value. A slot read consumed whose transaction the search did not meet is found in the first block at which
 * it reads consumed, by halving, as the payer's transaction there whose key authorization names the key id or whose own
 * call to the keychain authorizes it (`slotConsumer`); a transaction of that block the read cannot decode, where none is
 * found, holds the search. A read of the slot, the mark or that block's transactions there that fails is unreadable by
 * its reason, `history-gap` where the endpoint does not hold that block's state. The transaction so found is read as the search's are, its receipt deciding: a reverted
 * activation carrying H is the act asked about but for its result, any other the consumer of the value.
 *
 * The search: the account keychain's `KeyAuthorizationWitness` logs whose witness topic is H, from the position the
 * caller gives (or the one an earlier answer returned) to the latest head, the account topic left open so that a log
 * under another account is met, and the transaction the reference names, each read whole: its receipt and its signed
 * bytes (`eth_getRawTransactionByHash`). It needs to meet only the acts carrying H that succeeded, whose receipts keep
 * their logs; a failed one under another key consumed none of this value. Each such transaction is an act carrying H.
 * Its signer is the log's account, the account whose root key signed the key authorization, against the reference's
 * payer and the option's payee. It is of the pairing's kind where the transaction carries a key authorization
 * (`carriedKeyAuthorization`) for the key the reference names, and of another where it carries one for another key, or
 * none. It names the one account the key authorization it carries lets the key pay, its one recipient across its
 * `transfer` and `transferWithMemo` rules, compared with the option's payee; one that names none or several, or allows
 * any recipient, names no account. It moved every token transfer from its account the receipt shows (`movedFrom`), a
 * held transfer recorded as moved to the guard, nothing where there is none. `presented` is `yes` where the key
 * authorization the transaction carries is the one presented, byte for byte (the reference's `signed`, keccak-256 over
 * its bytes), and `no` where it is another; a reference without `signed` is unparseable. A transaction whose signed
 * bytes the node does not hold, or that do not decode, is an item the search could not decode, held at its block.
 *
 * The history is shown where the reader serves the block the search starts at; a read of the slot that fails without
 * it is `history-gap`. A ref that is not of this form, or a reader for another network or without the state reads of
 * `TempoSearchReader`, is unreadable.
 */
async function activationStatus(ref: SessionRef, reader: EvmSearchReader, query: EvmQuery<unknown>): Promise<SessionStatus> {
  if (query.finality !== "finalized") return { state: "unreadable", reason: "unparseable", foreign: [] };
  const facts = await activationFacts(ref, reader, query);
  if ("unreadable" in facts) return { state: "unreadable", reason: facts.unreadable, foreign: [] };
  return decide(facts.facts, query, evmLedger(EIP155_TEMPO_MPP[SUBSCRIPTION].coverage));
}

/**
 * The one recipient a key authorization lets its key pay, lowercase, or none where it names none or several. A scope
 * with no selector rules lets the key make any call to its target (tempoxyz/tempo@c8b89f9b
 * `crates/primitives/src/transaction/key_authorization.rs:41-44`), so it names no account.
 */
export function landedRecipient(k: Pick<KeyAuthorizationRead, "allowedCalls">): Hex | undefined {
  if (k.allowedCalls.some((c) => c.selectorRules.length === 0)) return undefined;
  const rules = k.allowedCalls.flatMap((c) => c.selectorRules.filter((r) => TRANSFER_SELECTORS.some((t) => sameBytes(t, r.selector))));
  if (rules.some((r) => r.recipients.length === 0)) return undefined;
  const recipients = new Set(rules.flatMap((r) => r.recipients.map((x) => x.toLowerCase())));
  return recipients.size === 1 ? ([...recipients][0] as Hex) : undefined;
}

async function activationFacts(
  ref: SessionRef,
  reader: EvmSearchReader,
  query: EvmQuery<unknown>,
): Promise<{ facts: Facts<bigint, EvmMark> } | { unreadable: UnreadableReason }> {
  if (!isObject(ref)) return { unreadable: "unparseable" };
  const fault = readerFault(ref, reader);
  if (fault !== undefined) return { unreadable: fault };
  const binding: unknown = ref.bindingLog;
  const h = isObject(binding) ? normalHash(binding["value"]) : null;
  const keyId = isObject(ref.accessKey) ? ref.accessKey.keyId : undefined;
  const expiry: unknown = isObject(ref.accessKey) ? ref.accessKey.expiry : undefined;
  if (h === null || !isAddress(ref.payer) || typeof ref.payee !== "string" || !isAddress(keyId)) return { unreadable: "unparseable" };
  if (expiry !== undefined && (typeof expiry !== "string" || !/^[1-9][0-9]{0,19}$/.test(expiry) || BigInt(expiry) >= 1n << 64n)) {
    return { unreadable: "unparseable" };
  }
  if (normalHash(ref.signed) === null || (ref.transaction !== undefined && normalHash(ref.transaction) === null)) {
    return { unreadable: "unparseable" };
  }
  const signed = ref.signed!;
  if (typeof reader.logs !== "function" || typeof reader.block !== "function" || typeof reader.raw !== "function" || !readsState(reader)) {
    return { unreadable: "transport" };
  }
  const heads = await headsOf(reader);
  if ("unreadable" in heads) return heads;
  const markOf = (b: bigint): EvmMark => (b <= heads.final ? "finalized" : "latest");
  const lo = query.after ?? 0n;
  const start = query.search ?? query.after ?? 0n;
  const s = await search(reader, [{ address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, null, h] }], start, heads.latest);
  if ("unreadable" in s) return s;
  let history = true;
  try {
    const b = await reader.block(start);
    history = isObject(b) && typeof b.number === "bigint";
  } catch {
    history = false;
  }
  const slot: KeySlot = { account: ref.payer!, keyId, expiry: expiry === undefined ? null : BigInt(expiry), witness: h };
  let read: SlotRead;
  try {
    read = await readSlot(slot, reader, await reader.block("finalized"), await reader.block("latest"));
  } catch (e) {
    return { unreadable: e instanceof ReaderError && e.kind === "malformed" ? "unparseable" : !history ? "history-gap" : rejected(e) };
  }
  const hashes = new Map<string, Hex>();
  if (ref.transaction !== undefined) hashes.set(ref.transaction.toLowerCase(), ref.transaction);
  for (const e of s.entries) hashes.set(e.transactionHash.toLowerCase(), e.transactionHash);
  const givenSigned = (query.others ?? []).flatMap((o) => ("ref" in o && isObject(o.ref) && typeof o.ref["signed"] === "string" ? [o.ref["signed"]] : []));
  const seen: Seen<bigint, EvmMark>[] = [];
  const undecoded: { transaction: Hex; at: bigint }[] = [];
  // One transaction, read whole; `sender` where the slot's read found it as the payer's, with no witness log needed.
  const readOne = async (hash: Hex, sender?: Hex): Promise<{ unreadable: UnreadableReason } | undefined> => {
    let receipt: EvmReceipt | null;
    let raw: unknown;
    try {
      receipt = await reader.receipt(hash);
      raw = receipt === null ? null : await reader.raw(hash);
    } catch (e) {
      return { unreadable: rejected(e) };
    }
    if (receipt === null) return undefined;
    if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return { unreadable: "unparseable" };
    const witness = receipt.logs.find(
      (l) => l.topics.length === 3 && sameBytes(l.address, ACCOUNT_KEYCHAIN) && sameBytes(l.topics[0], KEY_AUTHORIZATION_WITNESS_TOPIC) && sameBytes(l.topics[2], h),
    );
    const account = witness === undefined ? sender : addressIn(witness.topics[1]);
    if (account === undefined) return undefined;
    const wire = typeof raw === "string" ? bytesOf(raw) : undefined;
    const carried = wire === undefined ? undefined : carriedKeyAuthorization(wire);
    const landed = typeof carried === "string" ? readKeyAuthorization(carried) : undefined;
    if (wire === undefined || isRefusal(carried) || isRefusal(landed)) {
      undecoded.push({ transaction: hash, at: receipt.blockNumber });
      return undefined;
    }
    const moved = movedFrom(receipt.logs, account, hash);
    if (moved === undefined) {
      undecoded.push({ transaction: hash, at: receipt.blockNumber });
      return undefined;
    }
    const recipient = landed === undefined ? undefined : landedRecipient(landed);
    const own = landed !== undefined && sameBytes(landed.keyId, keyId);
    const landedSigned = typeof carried === "string" ? keccakHex(bytesOf(carried)!) : undefined;
    seen.push({
      transaction: hash,
      position: receipt.blockNumber,
      mark: markOf(receipt.blockNumber),
      result: receipt.status === 1 ? "succeeded" : "failed",
      // The payer's key authorization for the key registers the slot whatever the result; so does the payer's own
      // keychain call the slot's read found, which counts only where it succeeded.
      consumed: sameBytes(account, ref.payer) && (own || sender !== undefined),
      carries: witness !== undefined || (landed?.witness !== undefined && sameBytes(landed.witness, h)),
      party: partyOf(account, ref.payer!, ref.payee),
      signer: account,
      kind: own ? "same" : "other",
      account: recipient === undefined ? "none" : sameBytes(recipient, ref.payee) ? "payee" : "other",
      moved,
      ...(landedSigned !== undefined && givenSigned.some((g) => sameBytes(g, landedSigned)) ? { given: true } : {}),
      presented: landedSigned !== undefined && sameBytes(landedSigned, signed) ? "yes" : "no",
    });
    return undefined;
  };
  // The burn's transaction, read by its receipt: the keychain's `KeyAuthorizationWitnessBurned` of the payer and H.
  const readBurn = async (hash: Hex): Promise<{ unreadable: UnreadableReason } | undefined> => {
    let receipt: EvmReceipt | null;
    try {
      receipt = await reader.receipt(hash);
    } catch (e) {
      return { unreadable: rejected(e) };
    }
    if (receipt === null) return undefined;
    if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return { unreadable: "unparseable" };
    const burned = receipt.logs.some(
      (l) =>
        l.topics.length === 3 &&
        sameBytes(l.address, ACCOUNT_KEYCHAIN) &&
        sameBytes(l.topics[0], KEY_AUTHORIZATION_WITNESS_BURNED_TOPIC) &&
        sameBytes(addressIn(l.topics[1]) ?? "0x", ref.payer!) &&
        sameBytes(l.topics[2], h),
    );
    const moved = movedFrom(receipt.logs, ref.payer!, hash);
    if (receipt.status !== 1 || !burned || moved === undefined) {
      undecoded.push({ transaction: hash, at: receipt.blockNumber });
      return undefined;
    }
    seen.push({
      transaction: hash,
      position: receipt.blockNumber,
      mark: markOf(receipt.blockNumber),
      result: "succeeded",
      consumed: true,
      carries: true,
      party: "payer",
      signer: ref.payer!.toLowerCase() as Hex,
      kind: "other",
      account: "none",
      moved,
      presented: "no",
    });
    return undefined;
  };
  for (const hash of hashes.values()) {
    const r = await readOne(hash);
    if (r !== undefined) return r;
  }
  if (read.consumedAt !== undefined && !seen.some((x) => x.consumed)) {
    // A read of a block's state or transactions that fails is unreadable by its reason (`slotConsumer`).
    const c = await slotConsumer(slot, reader, lo, read.consumedAt);
    if (c !== undefined && "unreadable" in c) return c;
    if (c !== undefined && "transaction" in c) {
      const met = seen.findIndex((x) => sameBytes(x.transaction, c.transaction));
      if (met !== -1) seen[met] = { ...seen[met]!, consumed: true };
      else {
        const r = await readOne(c.transaction, c.sender);
        if (r !== undefined) return r;
      }
    } else if (c !== undefined) {
      // Held at the position the search started from, so that the next call reads every item again.
      for (const u of c.undecoded) undecoded.push({ transaction: u, at: start });
    }
  }
  if (read.burnedAt !== undefined && !seen.some((x) => x.consumed)) {
    // The payer's burn of H as a key authorization witness: an act of another kind carrying H that consumed the value.
    const c = await burnConsumer(slot, reader, lo, read.burnedAt);
    if ("unreadable" in c) return c;
    if (c.transaction !== undefined) {
      const met = seen.findIndex((x) => sameBytes(x.transaction, c.transaction!));
      if (met !== -1) seen[met] = { ...seen[met]!, consumed: true };
      else {
        const r = await readBurn(c.transaction);
        if (r !== undefined) return r;
      }
    }
  }
  seen.sort((a, b) => (a.position! < b.position! ? -1 : a.position! > b.position! ? 1 : 0));
  undecoded.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    facts: {
      seen,
      value: read.value,
      search: { whole: s.whole, ...(s.at === undefined ? {} : { at: s.at }) },
      ...(undecoded.length === 0 ? {} : { undecoded }),
      history,
    },
  };
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
 * `mpp/session/evm`: `opens` (an opening, by either funding) and `closes`. `mpp/session/tempo`: `opened` and the binding log under `ChannelClosed`, v1 or v2 (the close).
 * `mpp/subscription/tempo`: the binding log under `KeyAuthorizationWitness` (the activation), an `accessKey` with
 * `account` (`keySearch`) and `revokes` (the close). Without one, no read checks H or the close.
 */
const READ_KEYS: Readonly<Record<typeof SESSION_EVM | typeof SESSION_TEMPO | typeof SUBSCRIPTION, readonly ReadKey[]>> = {
  [SESSION_EVM]: [(ref) => ref.opens !== undefined, (ref) => ref.closes !== undefined],
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

/** The three pairings, in the order `sessionStatus` tries their keys. */
const PAIRINGS: readonly (keyof typeof READ_KEYS)[] = [SESSION_EVM, SESSION_TEMPO, SUBSCRIPTION];

/**
 * `status` of one pairing: `sessionStatus`'s read of a ref that names one of the keys the pairing writes (`READ_KEYS`)
 * and none of the other two pairings' keys, since `sessionStatus` reads by whichever key the ref names, answered at the
 * pairing's coverage; any other ref, and a query that is not one `status` takes, is unreadable `unparseable`, with no
 * call made.
 */
function pairingStatus(pairing: keyof typeof READ_KEYS): typeof sessionStatus {
  const own = READ_KEYS[pairing];
  const others = Object.entries(READ_KEYS).flatMap(([p, keys]) => (p === pairing ? [] : keys));
  const coverage = EIP155_TEMPO_MPP[pairing].coverage;
  return async (ref, reader, query) => {
    if (!isEvmQuery(query)) return { state: "unreadable", reason: "unparseable", foreign: [] };
    if (pairing === SESSION_TEMPO && isObject(ref) && ref.opened !== undefined && ref.payer !== undefined && !names(ref, others)) {
      return tempoOpeningStatus(ref, reader as EvmSearchReader, query);
    }
    if (pairing === SESSION_EVM && isObject(ref) && ref.opens !== undefined && !names(ref, others)) {
      return mppSessionOpeningStatus(ref as unknown as MppSessionOpeningRef, reader as EvmSearchReader, query);
    }
    if (pairing === SUBSCRIPTION && isObject(ref) && bindingUnder(KEY_AUTHORIZATION_WITNESS_TOPIC)(ref) && ref.payer !== undefined && !names(ref, others)) {
      return activationStatus(ref, reader as EvmSearchReader, query);
    }
    const read = isObject(ref) && names(ref, own) && !names(ref, others) ? await readSession(ref, reader) : unreadable("unparseable");
    return evmAnswer(read, ref, query, coverage);
  };
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
    payee: ref.payee,
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

/**
 * The payload `type`s an EVM session opening takes, which `evmOpened` reads, each with who broadcasts the funding it
 * carries: the seller's server an `authorization` or a `permit2`. A top-up takes the same types. An opening funded by a
 * `hash`, a transaction the buyer's client broadcasts, is no part of the pairing (`mpp/credential-type`).
 */
const EVM_FUNDING: { readonly [type: string]: Broadcaster } = { authorization: "payee", permit2: "payee" };

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
  if (!Object.hasOwn(EVM_FUNDING, type)) return refusal("mpp/credential-type");
  const salt = normalHash(o["salt"]);
  if (salt === null) return refusal("mpp/credential-malformed");
  if (!hashEquals(salt, e.h)) return refusal("mpp/salt-not-this-hash");
  const signer = o["authorizedSigner"] ?? ZERO;
  if (!isAddress(signer)) return refusal("mpp/credential-malformed");
  const auth = isObject(o["authorization"]) ? (o["authorization"] as { [k: string]: Json }) : {};
  if (!isAddress(auth["from"])) return refusal("mpp/credential-malformed");
  const payer: Hex = auth["from"];
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

/**
 * Who broadcasts an EVM session payment, by its action, as draft-evm-session-00 has it: an opening by its `type`
 * (`EVM_FUNDING`), else `mpp/credential-type`; a top-up by its `type` likewise, else `mpp/not-an-opening`; a voucher,
 * which the seller's server redeems when it settles or closes, `"payee"`, or, carrying an opening `deposit`, by that
 * deposit's `type`, else `mpp/credential-type`; a close, the escrow call the seller's server sends, `"payee"`. Each
 * refusal is the one `bound` gives the credential. Any other action is `mpp/not-an-opening`, as `bound` refuses it.
 */
function evmBroadcasts(credential: MppCredential): Broadcaster | Refusal {
  const p = credential.payload;
  const action = p["action"];
  const funding = byType(EVM_FUNDING);
  if (action === "open") return funding(credential);
  if (action === "topUp") return byType(EVM_FUNDING, () => refusal("mpp/not-an-opening"))(credential);
  if (action === "voucher") {
    const deposit = p["deposit"];
    if (!isObject(deposit) || deposit["action"] !== "open") return "payee";
    return funding({ ...credential, payload: deposit as { [k: string]: Json } });
  }
  return action === "close" ? "payee" : refusal("mpp/not-an-opening");
}

async function evmBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = evmOpened(presented);
  return isRefusal(o) ? o : o.h;
}

/**
 * The opening's read keys, with the payee of `option`, the issued challenge the payment answers (`mppPayee`), whose
 * refusal comes after the payment's.
 */
/**
 * `ref` where `option` is the challenge the presented credential echoes (`echoesOption`: its `id` and the members fixed
 * at issue), else the refusal of `ref`, then `mpp/challenge-not-option`: the payee the read tests is the option's.
 */
async function optionHeld(input: unknown, option: MppChallenge, ref: SessionRef | Refusal): Promise<SessionRef | Refusal> {
  if (isRefusal(ref)) return ref;
  const held = await echoesOption((input as MppCredential).challenge, option);
  return held === true ? ref : held;
}

async function evmReference(input: unknown, option: MppChallenge): Promise<SessionRef | Refusal> {
  return optionHeld(input, option, withPayee(await evmKeys(input), mppPayee(option)));
}

/**
 * The opening's read keys (`mppSessionOpeningStatus`): the payer, the account the authorization or permit is signed by;
 * `opens`, the escrow, the channel, H and the chain; the funding, its type, the challenge's `currency`, the contract that
 * keeps its single-use value (the token, or the challenge's `permit2Contract`, else the canonical Permit2), its nonce
 * and its signed bound; and the members of the payment presented.
 */
async function evmKeys(input: unknown): Promise<Omit<SessionRef, "payee"> | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = evmOpened(presented);
  if (isRefusal(o)) return o;
  const token = o.token.toLowerCase() as Hex;
  const payer = o.payer.toLowerCase() as Hex;
  const escrow = o.escrow.toLowerCase() as Hex;
  const opens = opensOf(o, presented);
  if (isRefusal(opens)) return opens;
  const base = { network: o.params.network, payer, opens };
  if (o.opening.type === "authorization") {
    const value = uint256Of(o.auth["value"]);
    const validBefore = uint256Of(o.auth["validBefore"]);
    const nonce = normalHash(o.auth["nonce"]);
    if (value === undefined || validBefore === undefined || nonce === null) return refusal("mpp/credential-malformed");
    return {
      ...base,
      funding: { type: "authorization", token, at: token, nonce: nonce as Hex, deadline: validBefore.toString() },
      presented: { funding: "authorization", token, from: payer, to: escrow, value: value.toString(), nonce },
    };
  }
  const permitted = o.auth["permitted"];
  const amount = isObject(permitted) ? uint256Of(permitted["amount"]) : undefined;
  const permittedToken = isObject(permitted) && isAddress(permitted["token"]) ? (permitted["token"].toLowerCase() as Hex) : undefined;
  const nonce = uint256Of(o.auth["nonce"]);
  const deadline = uint256Of(o.auth["deadline"]);
  const w = o.auth["witness"];
  const signer = isObject(w) && isAddress(w["authorizedSigner"]) ? w["authorizedSigner"].toLowerCase() : undefined;
  const witnessPayee = isObject(w) && isAddress(w["payee"]) ? w["payee"].toLowerCase() : undefined;
  if (amount === undefined || permittedToken === undefined || nonce === undefined || deadline === undefined || signer === undefined || witnessPayee === undefined) {
    return refusal("mpp/credential-malformed");
  }
  const contract = o.params.details["permit2Contract"];
  const at = (isAddress(contract) ? contract : PERMIT2).toLowerCase() as Hex;
  const word = hexOf(uintWord(nonce));
  return {
    ...base,
    funding: { type: "permit2", token, at, nonce: word, deadline: deadline.toString() },
    presented: {
      funding: "permit2",
      token: permittedToken,
      amount: amount.toString(),
      nonce: word,
      deadline: deadline.toString(),
      spender: escrow,
      owner: payer,
      witness: `${witnessPayee}:${o.h.toLowerCase()}:${signer}`,
    },
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
  const listed = o.details["credentialTypes"] as string[];
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
  const challenge = o.challenge;
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

  let typedData: ReceiveTypedData | Permit2TypedData | Refusal;
  let authorization: { [k: string]: Json };
  if (type === "authorization") {
    const td = choice.tokenDomain;
    if (!isObject(td) || typeof td.name !== "string" || td.name === "" || typeof td.version !== "string" || td.version === "") {
      return refusal("mpp/input-malformed");
    }
    const nonce = evmSessionAuthorizationNonce({ from, payee: recipient, token: currency, salt, authorizedSigner: signer });
    if (isRefusal(nonce)) return nonce;
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
    if (!isHexBytes(funded, 1, MAX_SIGNATURE_BYTES) || !isHexBytes(voucherSignature, 1, MAX_SIGNATURE_BYTES)) {
      return refusal("mpp/credential-malformed");
    }
    return measured({
      challenge,
      source,
      payload: { ...base, type, authorization, signature: funded, voucherSignature },
    });
  };
  const opening = type === "authorization" ? { opening: { payee: recipient, salt, authorizedSigner: signer } } : {};
  return { funding: { kind: "eip712", typedData, ...opening }, voucher: voucherFor(complete), complete };
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
  return withPayee({ network: p.network, closes: { escrow: p.escrow.toLowerCase() as Hex, channel: c as Hex } }, mppPayee(chosen));
}

/** A succeeded transaction read as an EVM session's close: its recipient and calldata, by `eth_getTransactionByHash`. */
async function closeRead(
  settled: SessionRead,
  transaction: Hex,
  closes: { escrow: Hex; channel: Hex },
  reader: EvmReader,
): Promise<SessionRead> {
  let tx: Awaited<ReturnType<EvmReader["transaction"]>>;
  try {
    tx = await reader.transaction(transaction);
  } catch (e) {
    return unreadable(rejected(e));
  }
  if (tx === null) return { state: "pending", why: "not-found" };
  const input = isObject(tx) && typeof tx.input === "string" ? bytesOf(tx.input) : undefined;
  if (input === undefined) return unreadable("unparseable");
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
 * Recovers H from an EVM session's opening transaction alone: the salt, argument word 3, of the escrow's open call the
 * transaction makes, whichever of `open`, `openWithAuthorization` and `openWithPermit2` it calls; each takes `payee,
 * token, deposit, salt, authorizedSigner` first, and the two relayed ones the payer as `from` next. The transaction is
 * read as `status` reads an opening (`eth_getTransactionByHash`): its own call must be the open call, with a recipient
 * and calldata that starts with one of the three selectors and holds those words, and the receipt must hold a
 * `Transfer` of the call's token, of any value, from its payer (the transaction's sender for `open`, else `from`) into
 * the called contract; else `evm/no-open-call`. A transaction sent through an ERC-4337 EntryPoint is refused so: the
 * account's calldata does not show which contract the account called. A reader for another network, a ref or reader
 * that is not an object, or an input whose `tx` is not a 32-byte hash (with nothing read), is `evm/wrong-reader`;
 * no receipt or no transaction is `evm/not-found`; a reverted one is `evm/reverted`; a failed read, or a malformed
 * receipt or transaction (`isTransactionRead`), is `evm/unreadable`. A transaction whose own call is not the open call,
 * or whose calldata is longer than `MAX_CALLDATA`, is `evm/no-open-call` on every read, since its calldata is its own:
 * an opening the read does not decode is refused so, as an ERC-4337 one is. A revert, and a receipt without the
 * payer's `Transfer`, are given only where the receipt's block is at or below the reader's `finalized` mark: above it,
 * or where that mark cannot be read, each is `evm/not-final`, a read to repeat, since a block above the mark can be
 * replaced by one in which the transaction succeeds or holds other logs. The mark is read only for those. The challenge
 * is not read. At most three calls.
 */
async function evmRecover(input: RecoverInput<string, MppChallenge>, reader: EvmReader): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("evm/wrong-reader");
  if (normalHash(input.tx) === null) return refusal("evm/wrong-reader");
  const ref = { network: input.network, transaction: input.tx as Hex };
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
  const calldata = bytesOf(tx.input)!;
  const selector = calldata.length >= OPEN_CALL_BYTES ? hexOf(calldata.subarray(0, 4)) : undefined;
  if (tx.to === null || selector === undefined) return refusal("evm/no-open-call");
  const args = calldata.subarray(4);
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
 * Recovers H from a Tempo session's opening transaction alone: the salt of the `ChannelOpened` log that the TIP-20
 * channel reserve (TIP-1034, `TIP20_CHANNEL_RESERVE`) emits in the receipt, data word 3, or, where the option names a
 * v1 session (`sessionProtocol` absent or `v1`) and an `escrowContract`, of the v1 escrow's `ChannelOpened` that escrow
 * emits, data word 2 (`CHANNEL_OPENED_V1_TOPIC`). A receipt with no such log is `tempo/open-not-found`. Logs giving more than one salt are
 * `tempo/ambiguous`. An input or reader that is not an object, an input whose `tx` is not a 32-byte hash (with
 * nothing read), or a reader for another network than the input names, is `tempo/wrong-reader`; a failed read is
 * `tempo/unreadable`, no receipt `tempo/not-found` and a revert `tempo/reverted`, as `readReceiptAtMark` answers. A
 * revert, `tempo/open-not-found` and `tempo/ambiguous` are given only where the receipt's block is at or below the
 * reader's `finalized` mark: above it, or where that mark cannot be read, each is `tempo/not-final`, a read to repeat,
 * since a block above the mark can be replaced by one in which the transaction succeeds or holds other logs. The mark
 * is read only for those. Of the challenge only `sessionProtocol` and `escrowContract` are read. At most two calls.
 */
async function tempoRecover(input: RecoverInput<string, MppChallenge>, reader: EvmReader): Promise<AtrHash | Refusal> {
  if (!isObject(input) || normalHash(input.tx) === null) return refusal("tempo/wrong-reader");
  const receipt = await readReceiptAtMark(input.network, input.tx as Hex, reader);
  if (isRefusal(receipt)) return receipt;
  const salts = new Set<string>();
  const params = isObject(input.option) ? paramsOf(input.option) : undefined;
  const v1 = params !== undefined && !isRefusal(params) && params.version === "v1" ? params.escrow : undefined;
  for (const l of receipt.logs) {
    if (l.topics.length !== 4) continue;
    const word = sameBytes(l.address, TIP20_CHANNEL_RESERVE) && sameBytes(l.topics[0], CHANNEL_OPENED_V2_TOPIC)
      ? 3
      : v1 !== undefined && sameBytes(l.address, v1) && sameBytes(l.topics[0], CHANNEL_OPENED_V1_TOPIC)
        ? 2
        : undefined;
    if (word === undefined) continue;
    const data = bytesOf(l.data);
    const salt = data === undefined ? undefined : wordAt(data, word);
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
 * A voucher, or a close's final voucher, on the channel the held opening opened: `Voucher(bytes32 channelId,uint128
 * cumulativeAmount)` under "EVM Payment Channel", with the channel id, the escrow and the chain from the opening. A
 * `topUp` is not built; an action draft-evm-session-00 does not define, such as `use`, is `mpp/session-action`.
 */
async function evmBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const held = await withinChecks(w, h, "session/evm", paramsOf, async (opening) => evmOpened(opening), U128, ["topUp"]);
  if (isRefusal(held)) return held;
  const o = held.opening;
  const channelId = normalHash(w.opening.payload["channelId"]);
  if (channelId === null) return refusal("mpp/credential-malformed");
  const chainId = o.params.chainId;
  const typedData = voucherData("EVM Payment Channel", "uint128", chainId, o.escrow, channelId as Hex, w.cumulativeAmount);
  return withinUnsigned(held.challenge, w, typedData, channelId as Hex);
}

/**
 * The one `eip712` voucher request, and the credential of the draft's members: action, channel, amount, signature;
 * its challenge is the snapshot `withinChecks` holds.
 */
function withinUnsigned(
  challenge: WithinChallenge,
  w: SessionWithin,
  typedData: VoucherTypedData,
  channelId: Hex,
  descriptor?: Json,
): SessionWithinUnsigned {
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
): {
  h: AtrHash;
  checked: Echoed;
  params: Params;
  validBefore: bigint | null;
  channel: Hex;
  sender: Hex;
  signed: Hex;
  nonce: { key: string; value: string };
} | Refusal {
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
  const signed = expiringNonceHash(raw, sender);
  if (isRefusal(signed)) return signed;
  const value = tempoValueOf(raw);
  if (value === undefined) return refusal("tempo/tx-malformed");
  const nonce = { key: value.key.toString(), value: value.nonce.toString() };
  return { h: e.h, checked: e.checked, params: p, validBefore: tx.validBefore, channel, sender: sender.toLowerCase() as Hex, signed, nonce };
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
async function tempoReference(input: unknown, option: MppChallenge): Promise<SessionRef | Refusal> {
  return optionHeld(input, option, withPayee(await tempoKeys(input), mppPayee(option)));
}

async function tempoKeys(input: unknown): Promise<Omit<SessionRef, "payee"> | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = tempoOpened(presented);
  if (isRefusal(o)) return o;
  const topic0 = o.params.version === "v2" ? CHANNEL_OPENED_V2_TOPIC : CHANNEL_OPENED_V1_TOPIC;
  // The signed `validBefore` alone bounds the opening; the challenge's `expires` is not signed.
  return {
    network: o.params.network,
    ...(o.validBefore === null ? {} : { settleBy: o.validBefore.toString() }),
    search: { address: o.params.escrow, topics: [topic0, o.channel] },
    opened: { address: o.params.escrow, version: o.params.version, channel: o.channel, h: o.h, chainId: o.params.chainId },
    payer: o.sender,
    signed: o.signed,
    nonce: o.nonce,
    ...(o.validBefore === null ? {} : { validBefore: o.validBefore.toString() }),
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
  const p = paramsOf(o.challenge);
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
  const challenge = o.challenge;
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
      if (!isHexBytes(voucherSignature, 1, MAX_SIGNATURE_BYTES)) return refusal("mpp/credential-malformed");
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
  const keys = {
    network: p.network,
    bindingLog: { address: p.escrow, topic0, index: 1 as const, value: c },
    search: { address: p.escrow, topics: [topic0, c] },
  };
  return withPayee(keys, mppPayee(chosen));
}

/**
 * A voucher, or a close's final voucher, on the channel the held opening opened: under "Tempo Stream Channel" with
 * `uint128` on v1, and under "TIP20 Channel Reserve" with `uint96` on v2, whose credential also carries the opening's
 * descriptor. The channel id, the escrow, the chain and the descriptor come from the opening. The within challenge is
 * read as `channel.boundWithin` reads it beside that payload: under `v2`, its escrow, chain and operator must give the
 * opening's channel id with the opening's descriptor, else `tempo/descriptor-mismatch` (so a v2 within challenge over a
 * v1 opening, whose payment carries no descriptor, too); under `v1` over a v2 opening, `mpp/not-bound-within`. A
 * `topUp` is not built; an action draft-tempo-session-00 does not define, such as `use`, is `mpp/session-action`.
 */
async function tempoBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const version = isObject(w) && isObject(w.opening) ? paramsOf(w.opening.challenge) : refusal("mpp/input-malformed");
  const limit = !isRefusal(version) && version.version === "v2" ? U96 : U128;
  const held = await withinChecks(w, h, "session/tempo", paramsOf, async (opening) => tempoOpened(opening), limit, ["topUp"]);
  if (isRefusal(held)) return held;
  const o = held.opening;
  const p = o.params;
  const descriptor = p.version === "v2" ? w.opening.payload["descriptor"] : undefined;
  // The within challenge's channel parameters, as `channel.boundWithin` reads them beside the payload the credential
  // carries: a v2 challenge's escrow, chain and operator give the descriptor's channel id (`descriptorSalt`), and a v1
  // challenge carries no hash, which a v2 channel's payment must.
  const pw = held.within;
  if (pw.version === "v2") {
    const salt = descriptorSalt(descriptor === undefined ? { channelId: o.channel } : { channelId: o.channel, descriptor }, pw);
    if (isRefusal(salt)) return salt;
  } else if (p.version === "v2") return refusal("mpp/not-bound-within");
  if (p.version === "v2") {
    const typedData = voucherData("TIP20 Channel Reserve", "uint96", p.chainId, p.escrow, o.channel, w.cumulativeAmount);
    return withinUnsigned(held.challenge, w, typedData, o.channel, descriptor);
  }
  const typedData = voucherData("Tempo Stream Channel", "uint128", p.chainId, p.escrow, o.channel, w.cumulativeAmount);
  return withinUnsigned(held.challenge, w, typedData, o.channel);
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
 * that token and recipient for `keySearch`, and the key authorization's `expiry`, the bound of the key's slot. `payer` is the account whose root key signed the key authorization
 * (`keyAuthorizationSigner`), and `signed` the payment presented, keccak-256 over the signed key authorization's bytes
 * whole; with them `status` reads the activation by its search (`activationStatus`). Of the request it reads only the
 * chain.
 */
async function subscriptionReference(input: unknown, option: MppChallenge): Promise<SessionRef | Refusal> {
  return optionHeld(input, option, withPayee(await subscriptionKeys(input), mppPayee(option)));
}

async function subscriptionKeys(input: unknown): Promise<Omit<SessionRef, "payee"> | Refusal> {
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
  const signed = bytesOf(presented.payload["signature"] as string)!;
  const payer = keyAuthorizationSigner(signed);
  if (isRefusal(payer)) return payer;
  return {
    network: p.network,
    bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: w.h },
    transferLog: { address: scope.token, topic0: TRANSFER_TOPIC, identity: "to", digest: to },
    search: { address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, null, w.h] },
    accessKey: { keyId: w.keyId, token: scope.token, to, ...(w.key.expiry === undefined ? {} : { expiry: w.key.expiry.toString() }) },
    payer,
    signed: keccakHex(signed),
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
  const challenge = o.challenge;
  const source = `did:pkh:eip155:${chainId}:${choice.from}`;
  return {
    request: { kind: "tempo-key-authorization", authorization, digest: keccakHex(unsigned) },
    complete(rootSignature: Hex): MppCredential | Refusal {
      if (!isHexBytes(rootSignature, 1, MAX_SIGNATURE_BYTES)) return refusal("mpp/credential-malformed");
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
  return withPayee({ network: p.network, revokes: { account: account.toLowerCase() as Hex, keyId: key.keyId } }, mppPayee(chosen));
}

// ── The records.

const SESSION_PATTERN: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: "mpp/session/evm-tempo",
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

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

/**
 * `mpp/session/evm`. `broadcaster` answers by the payment's action and type (`evmBroadcasts`), for the actions
 * `channel.kind` takes, and every answer is `"payee"`: an opening or a top-up of type `authorization` or `permit2`,
 * which the seller's server submits to the escrow; a voucher, which it redeems when it settles or closes; and the
 * close, the escrow call it sends, which `closeRef` and `status` read. An opening funded by a `hash`, a transaction
 * the buyer's client broadcasts, is no part of the pairing: it gets the refusal `bound` gives it, `mpp/credential-type`,
 * as an opening of any other type does, and `mpp/not-an-opening` for a top-up of another type or any other action.
 */
export const sessionEvm = Object.freeze({
  id: SESSION_EVM,
  data: EIP155_TEMPO_MPP[SESSION_EVM],
  pattern: SESSION_PATTERN,
  claims: true as const,
  unplaced,
  tie,
  advertise: advertiseAs(SESSION_EVM),
  read,
  build: evmBuild,
  buildWithin: evmBuildWithin,
  bound: evmBound,
  broadcaster: sessionBroadcaster(evmKind, evmBroadcasts, () => refusal("mpp/not-an-opening")),
  reference: evmReference,
  status: pairingStatus(SESSION_EVM),
  recover: evmRecover,
  closeRef: evmCloseRef,
  channel: Object.freeze({
    kind: measuring(evmKind),
    ref: measuringAsync(refFrom(SESSION_EVM, evmKind)),
    boundWithin: measuringAsync(notBoundWithin),
    until: noEnd,
  }),
}) satisfies Entry<
  typeof SESSION_EVM,
  MppCredential,
  SessionRef,
  EvmReader,
  MppForms & {
    choice: SessionChoice;
    unsigned: SessionUnsigned;
    landed: { transaction: Hex };
    network: string;
    query: EvmQuery<SessionRef & { transaction: Hex }>;
    answer: EvmBreadthStatus;
  }
>;

/**
 * Who broadcasts a Tempo session payment: the seller's server, every payment the session takes, as
 * draft-tempo-session-00 has it. An opening of a `type` other than `transaction`, the one `bound` takes, is
 * `mpp/not-an-opening`, as `bound` refuses it.
 */
function tempoBroadcasts(credential: MppCredential): Broadcaster | Refusal {
  const p = credential.payload;
  return p["action"] === "open" && p["type"] !== "transaction" ? refusal("mpp/not-an-opening") : "payee";
}

/**
 * `mpp/session/tempo`, whose `build` writes `broadcast: false`. The payee broadcasts every payment the session takes
 * (`broadcaster` answers `"payee"` for the actions `channel.kind` takes, and an opening of `type` `transaction`), as
 * draft-tempo-session-00 has it: the seller's server broadcasts the signed transaction of an opening or a top-up, which
 * `status` reads, redeems vouchers when it settles or closes, and sends the close, which `closeRef` and `status` read.
 * Any other credential gets `mpp/not-an-opening`, as `bound` refuses it.
 */
export const sessionTempo = Object.freeze({
  id: SESSION_TEMPO,
  data: EIP155_TEMPO_MPP[SESSION_TEMPO],
  pattern: SESSION_PATTERN,
  claims: true as const,
  unplaced,
  tie,
  advertise: advertiseAs(SESSION_TEMPO),
  read,
  build: tempoBuild,
  buildWithin: tempoBuildWithin,
  bound: tempoBound,
  broadcaster: sessionBroadcaster(tempoKind, tempoBroadcasts, () => refusal("mpp/not-an-opening")),
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
}) satisfies Entry<
  typeof SESSION_TEMPO,
  MppCredential,
  SessionRef,
  EvmReader,
  MppForms & {
    choice: SessionChoice;
    unsigned: SessionUnsigned;
    landed: { transaction: Hex };
    network: string;
    query: EvmQuery<SessionRef & { transaction: Hex }>;
    answer: EvmBreadthStatus;
  }
>;

/**
 * `mpp/subscription/tempo`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type`
 * `keyAuthorization`, the one `channel.kind` takes): the payer's root key signs a key authorization, and the seller's
 * server sends the activation transaction that registers its access key, and each later transfer under that key;
 * `status` reads the activation, and `keySearch` the transfers. A credential of any other type gets
 * `mpp/not-an-opening`, as `bound` refuses it.
 */
export const subscriptionTempo = Object.freeze({
  id: SUBSCRIPTION,
  data: EIP155_TEMPO_MPP[SUBSCRIPTION],
  pattern: deepFreeze({
    pattern: "native-field",
    profile: "mpp/session/evm-tempo",
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: true,
  } satisfies LcpPattern),
  claims: true as const,
  unplaced,
  tie,
  advertise: advertiseAs(SUBSCRIPTION),
  read,
  build: subscriptionBuild,
  bound: subscriptionBound,
  broadcaster: sessionBroadcaster(subscriptionKind, () => "payee", () => refusal("mpp/not-an-opening")),
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
}) satisfies Entry<
  typeof SUBSCRIPTION,
  MppCredential,
  SessionRef,
  EvmReader,
  MppForms & {
    choice: SessionChoice;
    unsigned: KeyAuthorizationUnsigned;
    landed: { transaction: Hex };
    network: string;
    query: EvmQuery<SessionRef & { transaction: Hex }>;
    answer: EvmBreadthStatus;
    receipt: EvmReceipt;
  }
>;
