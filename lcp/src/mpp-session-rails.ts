/**
 * MPP's `session` intent on Hedera, Solana and XRPL. One ATR covers a whole channel; its hash is bound where the
 * channel opens, in what the payer signs: the Hedera escrow's `salt` (H in full), the Solana channel's `salt` (H's first
 * 8 bytes), and the XRPL `PaymentChannelCreate`'s one LCP memo (H in full). Later requests in the channel are the
 * seller's and are never claimed.
 */
import { base58 } from "@scure/base";
import { fromLcpString, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import { addressOfWord, bytesOf, hexOf, sameBytes, wordAt, type Hex } from "./evm-abi.js";
import { evmStatus, type EvmBreadthStatus, type EvmLog, type EvmReader, type EvmReceipt, type EvmRef } from "./evm.js";
import { failedAt, finalAt, isLog, isReceipt, settledAt } from "./internal/evm.js";
import { isAddress, normalHash } from "./fields.js";
import {
  CHANNEL_CLOSED_TOPIC,
  CHANNEL_OPENED_TOPIC,
  ZERO_ADDRESS,
  approveCalldata,
  hederaChannelId,
  hederaVoucher,
  openCalldata,
  type HederaCloseRef,
  type HederaEvmReader,
  type HederaSessionRef,
  type HederaVoucherTypedData,
} from "./internal/hedera-session.js";
import {
  OPEN_DISCRIMINATOR,
  openOf,
  sessionSalt,
  solanaVoucher,
  svmCloseStatus,
  type SvmCloseRef,
  type SvmCloseStatus,
} from "./internal/svm-session.js";
import {
  decodeSvmTx,
  keyBytes,
  keyString,
  staticNonce,
  svmReference,
  svmStatus,
  wireOf,
  type SolanaNetwork,
  type SvmReader,
  type SvmRef,
  type SvmStatus,
  type SvmTx,
} from "./internal/svm.js";
import {
  cancelAfterOf,
  RIPPLE_EPOCH,
  xrplChannelId,
  xrplClaim,
  xrplCloseStatus,
  xrplOpenStatus,
  type XrplCloseRef,
  type XrplCloseStatus,
} from "./internal/xrpl-session.js";
import { decodeBlob, decodePresented, type XrplNetwork, type XrplReader, type XrplRef, type XrplStatus, type XrplTxJson } from "./internal/xrpl.js";
import {
  checkChallenge,
  chosenFor,
  credentialOf,
  decodeObject,
  deepFreeze,
  echoedFor,
  isObject,
  place,
  read,
  tie,
  type Checked,
  type Echoed,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { hederaSessionNetworkOf, solanaNetworkOf, xrplNetworkOf } from "./mpp-rail-checks.js";
import type { LandedCredential } from "./mpp.js";
import { withinChecks, type SessionWithin, type SessionWithinUnsigned } from "./mpp-session.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

const HEDERA = "mpp/session/hedera" as const;
const SOLANA = "mpp/session/solana" as const;
const XRPL = "mpp/session/xrpl" as const;
const MAX_LANDED_LOGS = 64;
const MAX_MEMOS = 8;
const HASH256 = /^[0-9A-Fa-f]{64}$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const U64 = 1n << 64n;
const U128 = 1n << 128n;
/** The open instruction's `authorizedSigner` account. */
const OPEN_SIGNER_ACCOUNT = 4;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

type Kind = "open" | "within" | "close";

/** A Hedera session opening with the landed receipt's logs from the escrow. */
export type HederaLandedCredential = LandedCredential;

/** The buyer's inputs to a session opening's `build`. The deposit and the XRPL channel terms are the funder's. */
export interface RailSessionChoice {
  challenge: MppChallenge & { id: string };
  from: string;
  now: number;
  deposit: bigint;
  xrpl?: {
    publicKey: string;
    settleDelay: number;
    fee: string;
    sequence: number;
    lastLedgerSequence: number;
    cancelAfter?: number;
  };
}

/** A Hedera session opening for the payer's signer: two calls broadcast in order, and the zero voucher to sign. */
export interface HederaSessionUnsigned {
  request: {
    kind: "hedera-session-open";
    chainId: 295 | 296;
    calls: { to: Hex; data: Hex; gas: bigint }[];
    voucher: HederaVoucherTypedData;
  };
  complete(signed: { openTx: Hex; signature: Hex }): MppCredential | Refusal;
}

/**
 * The values a Solana channel client composes the `open` from; `complete` takes the composed open payload, which carries
 * `authentication` when the challenge's `voucherSigner` is `operator` and none otherwise, and checks it as `bound` does.
 */
export interface SolanaSessionUnsigned {
  request: {
    kind: "solana-session-open";
    salt: bigint;
    channelProgram: string;
    network: SolanaNetwork;
    recentBlockhash: string;
    recentSlot: bigint;
  };
  complete(open: { [k: string]: Json }): MppCredential | Refusal;
}

/** An XRPL `PaymentChannelCreate` for the wallet to sign, and the first claim's bytes. */
export interface XrplSessionUnsigned {
  request: {
    kind: "xrpl-session-open";
    txJson: XrplTxJson;
    claim: { channelId: string; drops: bigint; bytes: Uint8Array };
  };
  complete(signed: { signedBlob: string; claimSignature: string }): Promise<MppCredential | Refusal>;
}

export type RailSessionUnsigned = HederaSessionUnsigned | SolanaSessionUnsigned | XrplSessionUnsigned;

// ── Shared.

function actionKind(presented: MppCredential, within: readonly string[]): Kind | Refusal {
  if (!isObject(presented) || !isObject(presented.payload)) return refusal("mpp/credential-malformed");
  const a = presented.payload["action"];
  if (a === "open") return "open";
  if (a === "close") return "close";
  if (typeof a === "string" && within.includes(a)) return "within";
  return refusal("mpp/session-action");
}

function opening(presented: MppCredential, pairing: typeof HEDERA | typeof SOLANA | typeof XRPL) {
  const e = echoedFor(presented, pairing);
  if (isRefusal(e)) return e;
  if (e.payload["action"] !== "open") return refusal("mpp/session-action");
  return e;
}

/**
 * The `methodDetails` of a within or close payment's echoed challenge, read from its request without the opening's
 * checks: the seller issues those challenges itself, with its own id and the channel named.
 */
function echoedDetails(presented: MppCredential, method: "hedera" | "solana" | "xrpl"): { [k: string]: Json } | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  if (c.challenge.intent !== "session" || c.challenge.method !== method) return refusal("mpp/not-this-pairing");
  const request = decodeObject(c.challenge.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const md = request["methodDetails"];
  if (md === undefined) return {};
  return isObject(md) ? (md as { [k: string]: Json }) : refusal("mpp/request-malformed");
}

/**
 * The challenge as issued: no request member carries H on these pairings. A challenge that carries a `refused` member
 * is `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return option;
}

/** MPP's `place`: the id derived from H and `opaque`; `request` is left unchanged. */
function advertise(doc: readonly MppChallenge[], h: AtrHash, link: string, offer: MppChallenge, agreementUrl?: string) {
  return place(doc, h, link, offer, agreementUrl);
}

async function notBoundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

// ── mpp/session/hedera.

/** `methodDetails.escrowContract`, lowercase, else `mpp/request-malformed`. */
function hederaEscrow(checked: Checked | Echoed): Hex | Refusal {
  const escrow = checked.details["escrowContract"];
  return isAddress(escrow) ? (escrow.toLowerCase() as Hex) : refusal("mpp/request-malformed");
}

/** `methodDetails.channelProgram` of a Solana session challenge, else `svm/input-malformed`. */
function channelProgram(checked: Checked | Echoed): string | Refusal {
  const program = checked.details["channelProgram"];
  return typeof program === "string" && keyBytes(program) !== null ? program : refusal("svm/input-malformed");
}

function hederaChain(network: string): 295 | 296 {
  return network === "hedera:mainnet" ? 295 : 296;
}

/**
 * The opening's receipt, read by `payload.txHash`, with its logs from the escrow added as `landed`. A reader that is
 * missing or for another network than the challenge's is `hedera/wrong-reader`. No receipt is `hedera/not-found`, and a
 * failed read, or a reader answer that is not a receipt (a `status` of 0 or 1, a bigint `blockNumber` and a list of
 * logs) or holds a log that is not an object with a string `address`, an array of string `topics` and a string `data`,
 * is `hedera/unreadable`: reads to repeat, not a refusal of the payment. A revert whose block is at or below the
 * reader's `finalized` mark is `hedera/reverted`: nothing moved. A revert above that mark, or where the mark cannot be
 * read, is `hedera/not-final`, a read to repeat: the block can be replaced by one in which the transaction succeeds.
 * A receipt that succeeded whose logs kept as `landed` do not hold exactly one `ChannelOpened` from the escrow naming
 * `payload.channelId`, the log `bound` reads, is read at the same mark: above it, or where it cannot be read, it is
 * `hedera/not-final`, since a block that replaces it can hold other logs; at or below it the credential is returned
 * with `landed`, and `bound` gives the verdict. The mark is read only for a revert or such a receipt, and not for a
 * `channelId` that is not a 32-byte hash, which `bound` refuses whatever the chain holds. At most two calls.
 */
async function hederaFetchPresented(presented: MppCredential, reader: HederaEvmReader): Promise<HederaLandedCredential | Refusal> {
  const e = opening(presented, HEDERA);
  if (isRefusal(e)) return e;
  const network = hederaSessionNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  const escrow = hederaEscrow(e.checked);
  if (isRefusal(escrow)) return escrow;
  if (!isObject(reader) || reader.network !== network) return refusal("hedera/wrong-reader");
  const tx = normalHash(e.payload["txHash"]);
  if (tx === null) return refusal("mpp/credential-malformed");
  let receipt: Awaited<ReturnType<EvmReader["receipt"]>>;
  try {
    receipt = await reader.receipt(tx as Hex);
  } catch {
    return refusal("hedera/unreadable");
  }
  if (receipt === null) return refusal("hedera/not-found");
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return refusal("hedera/unreadable");
  if (receipt.status === 0) {
    const read = await failedAt(receipt.blockNumber, "reverted", reader as EvmReader);
    return read.state === "failed" ? refusal("hedera/reverted") : refusal("hedera/not-final");
  }
  const logs = receipt.logs.filter((l) => sameBytes(l.address.toLowerCase(), escrow)).slice(0, MAX_LANDED_LOGS);
  const channel = normalHash(e.payload["channelId"]);
  const opened = channel === null || channelOpened(logs, escrow, channel).length === 1;
  if (!opened && !(await finalAt(receipt.blockNumber, reader as EvmReader))) return refusal("hedera/not-final");
  return { ...presented, landed: { transaction: tx as Hex, blockNumber: receipt.blockNumber, logs } };
}

/**
 * The `ChannelOpened` logs from `escrow` among `logs` with four topics and four words of data that name `channel`, or
 * name any channel where `channel` is null. `escrow` and `channel` are lowercase.
 */
function channelOpened(logs: readonly unknown[], escrow: Hex, channel: string | null): EvmLog[] {
  return logs.filter(
    (l): l is EvmLog =>
      isLog(l) &&
      l.address.toLowerCase() === escrow &&
      l.topics.length === 4 &&
      l.topics[0]!.toLowerCase() === CHANNEL_OPENED_TOPIC &&
      (channel === null || l.topics[1]!.toLowerCase() === channel) &&
      bytesOf(l.data)?.length === 128,
  );
}

/**
 * H from the echoed challenge, once exactly one landed `ChannelOpened` from the escrow names `payload.channelId`, its
 * salt is H, and the channel id recomputed from the event (payer, payee, token, signer, salt, escrow, chain) is that id.
 */
async function hederaBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const e = opening(presented, HEDERA);
  if (isRefusal(e)) return e;
  const landed = (presented as Partial<HederaLandedCredential>).landed;
  if (!isObject(landed) || !Array.isArray(landed.logs)) return refusal("hedera/read-first");
  const channel = normalHash(e.payload["channelId"]);
  if (channel === null) return refusal("mpp/credential-malformed");
  const escrow = hederaEscrow(e.checked);
  if (isRefusal(escrow)) return escrow;
  const opened = channelOpened(landed.logs, escrow, channel);
  if (opened.length !== 1) return refusal("hedera/channel-log-not-found");
  const log = opened[0]!;
  const data = bytesOf(log.data)!;
  const salt = hexOf(wordAt(data, 2)!);
  if (!hashEquals(salt as AtrHash, e.h)) return refusal("mpp/carrier-not-challenge");
  const network = hederaSessionNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  const payerWord = bytesOf(log.topics[2]);
  const payeeWord = bytesOf(log.topics[3]);
  const payer = payerWord === undefined ? undefined : addressOfWord(payerWord);
  const payee = payeeWord === undefined ? undefined : addressOfWord(payeeWord);
  const token = addressOfWord(wordAt(data, 0)!);
  const signer = addressOfWord(wordAt(data, 1)!);
  if (payer === undefined || payee === undefined || token === undefined || signer === undefined) {
    return refusal("hedera/channel-log-not-found");
  }
  const recomputed = hederaChannelId({ payer, payee, token, salt, authorizedSigner: signer, escrow, chainId: hederaChain(network) });
  if (recomputed !== channel) return refusal("hedera/channel-id-mismatch");
  return e.h;
}

/**
 * The opening's read keys: the reported open transaction and its `ChannelOpened` log from the escrow naming the
 * channel. Where the opening names no channel (`payload.channelId` absent), as a transaction and its challenge reported
 * without the credential do not, they are the transaction and the escrow alone, the challenge's
 * `methodDetails.escrowContract`, lowercase: `recover` and `status` read the escrow's one `ChannelOpened` log there. A
 * `txHash`, or a `channelId` that is present, that is not a 32-byte hash is `mpp/credential-malformed`.
 */
async function hederaReference(input: unknown): Promise<HederaSessionRef | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const e = opening(presented, HEDERA);
  if (isRefusal(e)) return e;
  const network = hederaSessionNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  const escrow = hederaEscrow(e.checked);
  if (isRefusal(escrow)) return escrow;
  const tx = normalHash(e.payload["txHash"]);
  if (tx === null) return refusal("mpp/credential-malformed");
  if (e.payload["channelId"] === undefined) return { network, transaction: tx as Hex, escrow };
  const channel = normalHash(e.payload["channelId"]);
  if (channel === null) return refusal("mpp/credential-malformed");
  return {
    network,
    transaction: tx as Hex,
    bindingLog: { address: escrow, topic0: CHANNEL_OPENED_TOPIC, index: 1, value: channel as Hex },
  };
}

/**
 * The escrow and the channel an opening ref names, lowercase: its binding log's address and value, or its escrow and no
 * channel. Null for a ref that names neither or both, a binding log that is not an object with an address `address` and
 * a 32-byte `value`, or an escrow that is not an address.
 */
function openingKeys(ref: HederaSessionRef): { escrow: Hex; channel: string | null } | null {
  const b: unknown = ref.bindingLog;
  const escrow: unknown = ref.escrow;
  if (b !== undefined && escrow === undefined) {
    if (!isObject(b) || !isAddress(b["address"])) return null;
    const channel = normalHash(b["value"]);
    return channel === null ? null : { escrow: (b["address"] as string).toLowerCase() as Hex, channel };
  }
  if (escrow === undefined || b !== undefined || !isAddress(escrow)) return null;
  return { escrow: escrow.toLowerCase() as Hex, channel: null };
}

/**
 * The opening's receipt, read by `transaction`, and its `ChannelOpened` logs from the escrow naming the channel, or
 * naming any channel where `keys` names none (`channelOpened`): `recover` and `status` read an opening alike. A failed
 * read, or a reader answer that is not a receipt or holds a log that is not an object with a string `address`, an
 * array of string `topics` and a string `data`, is `"unreadable"`; no receipt is `"not-found"`. One call.
 */
async function openingRead(
  transaction: Hex,
  keys: { escrow: Hex; channel: string | null },
  reader: HederaEvmReader,
): Promise<{ receipt: EvmReceipt; opened: EvmLog[] } | "not-found" | "unreadable"> {
  let receipt: Awaited<ReturnType<EvmReader["receipt"]>>;
  try {
    receipt = await reader.receipt(transaction);
  } catch {
    return "unreadable";
  }
  if (receipt === null) return "not-found";
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return "unreadable";
  return { receipt, opened: channelOpened(receipt.logs, keys.escrow, keys.channel) };
}

/**
 * The opening, read like any EVM payment through the relay by its `ChannelOpened` log naming the channel; or a reported
 * close, whose `ChannelClosed` names the channel. An opening ref that names the escrow alone is read as `recover` reads
 * it: the receipt's one `ChannelOpened` log from the escrow with four topics and four 32-byte words of data settles the
 * opening, at the highest finality mark its block reached. None, or more than one, is failed `binding-log-not-found`,
 * and a revert failed `reverted`, each where the receipt's block is at or below the reader's `finalized` mark, and
 * pending above it or where that mark cannot be read. No receipt is pending `not-found`, and a failed read or a reader
 * answer that is not a receipt pending `unreadable`. A ref that names neither a binding log nor an escrow, or both, an
 * escrow that is not an address, a `transaction` that is not a 32-byte hash, or a reader for another network than the
 * ref's, is pending `unreadable`, with nothing read.
 */
async function hederaStatus(ref: HederaSessionRef | HederaCloseRef, reader: HederaEvmReader): Promise<EvmBreadthStatus> {
  if (isObject(ref) && "phase" in ref) {
    const close: EvmRef & { transaction: Hex } = {
      network: ref.network,
      transaction: ref.transaction,
      bindingLog: { address: ref.escrow, topic0: CHANNEL_CLOSED_TOPIC, index: 1, value: ref.channel },
    };
    return evmStatus(close, reader as EvmReader);
  }
  if (!isObject(ref) || (ref.bindingLog !== undefined && ref.escrow === undefined)) {
    return evmStatus(ref as EvmRef & { transaction: Hex }, reader as EvmReader);
  }
  const keys = openingKeys(ref);
  if (keys === null || normalHash(ref.transaction) === null || !isObject(reader) || reader.network !== ref.network) {
    return { state: "pending", why: "unreadable" };
  }
  const read = await openingRead(ref.transaction, keys, reader);
  if (typeof read === "string") return { state: "pending", why: read };
  const { receipt, opened } = read;
  if (receipt.status === 0) return failedAt(receipt.blockNumber, "reverted", reader as EvmReader);
  if (opened.length !== 1) return failedAt(receipt.blockNumber, "binding-log-not-found", reader as EvmReader);
  return settledAt(receipt.blockNumber, reader as EvmReader);
}

/**
 * Zero-party: the salt (data word 2) of the opening's `ChannelOpened` log, from what a transaction and its challenge
 * identify. The ref names the log by its binding log's address and value (the escrow and the channel, as `reference`
 * writes them from an opening that names the channel), or by `escrow` alone, the challenge's
 * `methodDetails.escrowContract`, where the channel is not known. The log read is the one log in the receipt from that
 * address with four topics, `topics[0]` `CHANNEL_OPENED_TOPIC` and, where the binding log names a channel, `topics[1]`
 * that value (hex in either case), and four 32-byte words of data. A ref or reader that is not an object, or a reader
 * for another network than the ref's, is `hedera/wrong-reader`, as on the Hedera charge, and so is a ref whose
 * `transaction` is not a 32-byte hash, that names neither a `bindingLog` nor an `escrow`, or both, whose `bindingLog` is
 * not an object with an address `address` and a 32-byte `value`, or whose `escrow` is not an address; nothing is read
 * for any of them. A failed read, or a reader answer that is not a receipt or holds a log that is not an object with a
 * string `address`, an array of string `topics` and a string `data`, is `hedera/unreadable`. No receipt is
 * `hedera/not-found`. A reverted one is `hedera/reverted`, whether or not it holds the opening's log, and a receipt that
 * holds no such log, or more than one, is `hedera/channel-log-not-found`. Both are given only where the receipt's block
 * is at or below the reader's `finalized` mark: above it, or where that mark cannot be read, each is `hedera/not-final`,
 * a read to repeat, as the EVM and Tempo recovers answer, since a block above the mark can be replaced by one in which
 * the transaction succeeds or holds other logs. The mark is read only for those. At most two calls.
 */
async function hederaRecover(ref: HederaSessionRef, reader: HederaEvmReader): Promise<AtrHash | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("hedera/wrong-reader");
  const keys = openingKeys(ref);
  if (normalHash(ref.transaction) === null || keys === null) return refusal("hedera/wrong-reader");
  const read = await openingRead(ref.transaction, keys, reader);
  if (read === "not-found") return refusal("hedera/not-found");
  if (read === "unreadable") return refusal("hedera/unreadable");
  const { receipt, opened } = read;
  if (receipt.status === 0) {
    const reverted = await failedAt(receipt.blockNumber, "reverted", reader as EvmReader);
    return reverted.state === "failed" ? refusal("hedera/reverted") : refusal("hedera/not-final");
  }
  if (opened.length === 1) return hexOf(wordAt(bytesOf(opened[0]!.data)!, 2)!) as AtrHash;
  return (await finalAt(receipt.blockNumber, reader as EvmReader))
    ? refusal("hedera/channel-log-not-found")
    : refusal("hedera/not-final");
}

/** The read keys of a close, from the issued challenge and the channel: a reported transaction, or the log search. */
function hederaCloseRef(chosen: MppChallenge, channel: string): Omit<HederaCloseRef, "transaction"> | Refusal {
  const checked = chosenChallenge(chosen, HEDERA);
  if (isRefusal(checked)) return checked;
  const network = hederaSessionNetworkOf(checked.details);
  if (isRefusal(network)) return network;
  const c = normalHash(channel);
  if (c === null) return refusal("mpp/credential-malformed");
  const escrow = hederaEscrow(checked);
  if (isRefusal(escrow)) return escrow;
  return {
    phase: "close",
    network,
    escrow,
    channel: c as Hex,
    search: { address: escrow, topics: [CHANNEL_CLOSED_TOPIC, c as Hex] },
  };
}

/**
 * The two calls the payer's signer broadcasts in order, `approve` then the escrow's `open` with H as the salt and a
 * zero authorized signer, and the zero voucher on the resulting channel.
 */
async function hederaBuild(choice: RailSessionChoice, h: AtrHash): Promise<HederaSessionUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const checked = chosenFor(choice.challenge, h, HEDERA);
  if (isRefusal(checked)) return checked;
  if (!isAddress(choice.from) || typeof choice.deposit !== "bigint" || choice.deposit <= 0n || choice.deposit >= 1n << 128n) {
    return refusal("mpp/input-malformed");
  }
  const network = hederaSessionNetworkOf(checked.details);
  if (isRefusal(network)) return network;
  const chainId = hederaChain(network);
  const escrow = hederaEscrow(checked);
  if (isRefusal(escrow)) return escrow;
  const currency = (checked.request["currency"] as string).toLowerCase() as Hex;
  const recipient = (checked.request["recipient"] as string).toLowerCase() as Hex;
  const channelId = hederaChannelId({
    payer: choice.from.toLowerCase() as Hex,
    payee: recipient,
    token: currency,
    salt: h as Hex,
    authorizedSigner: ZERO_ADDRESS,
    escrow,
    chainId,
  });
  const challenge = choice.challenge;
  return {
    request: {
      kind: "hedera-session-open",
      chainId,
      calls: [
        { to: currency, data: approveCalldata(escrow, choice.deposit), gas: 1_000_000n },
        { to: escrow, data: openCalldata(recipient, currency, choice.deposit, h, ZERO_ADDRESS), gas: 1_500_000n },
      ],
      voucher: hederaVoucher({ channelId, escrow, chainId }, 0n),
    },
    complete(signed: { openTx: Hex; signature: Hex }): MppCredential | Refusal {
      if (!isObject(signed) || normalHash(signed.openTx) === null || typeof signed.signature !== "string" || bytesOf(signed.signature) === undefined) {
        return refusal("mpp/credential-malformed");
      }
      return {
        challenge,
        payload: { action: "open", channelId, txHash: signed.openTx, cumulativeAmount: "0", signature: signed.signature },
      };
    },
  };
}

/** The network and the payload's `channelId`, lowercase; on a within or close payment, read from the payment itself. */
async function hederaRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const k = actionKind(presented, ["voucher", "topUp", "use"]);
  if (isRefusal(k)) return k;
  let details: { [k: string]: Json };
  if (k === "open") {
    const e = echoedFor(presented, HEDERA);
    if (isRefusal(e)) return e;
    details = e.checked.details;
  } else {
    const d = echoedDetails(presented, "hedera");
    if (isRefusal(d)) return d;
    details = d;
  }
  const network = hederaSessionNetworkOf(details);
  if (isRefusal(network)) return network;
  const channel = normalHash(presented.payload["channelId"]);
  return channel === null ? refusal("mpp/credential-malformed") : { network, channel };
}

/**
 * A voucher, or a close's final voucher, on the channel the held opening opened: `hederaVoucher` with the channel id,
 * the escrow and the chain from the opening, signed as EIP-712.
 */
async function hederaBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const o = await withinChecks(w, h, "session/hedera", async (p) => opening(p, HEDERA), U128);
  if (isRefusal(o)) return o;
  const network = hederaSessionNetworkOf(o.checked.details);
  if (isRefusal(network)) return network;
  const channelId = normalHash(o.payload["channelId"]);
  if (channelId === null) return refusal("mpp/credential-malformed");
  const escrow = hederaEscrow(o.checked);
  if (isRefusal(escrow)) return escrow;
  const typedData = hederaVoucher({ channelId: channelId as Hex, escrow, chainId: hederaChain(network) }, w.cumulativeAmount);
  const challenge = { ...w.challenge };
  const { action } = w;
  const cumulativeAmount = w.cumulativeAmount.toString();
  return {
    requests: [{ kind: "eip712", typedData }],
    complete(signatures: readonly string[]): MppCredential | Refusal {
      const signature = Array.isArray(signatures) && signatures.length === 1 ? signatures[0] : undefined;
      if (typeof signature !== "string" || (bytesOf(signature)?.length ?? 0) < 1) return refusal("mpp/credential-malformed");
      return { challenge, payload: { action, channelId, cumulativeAmount, signature } };
    },
  };
}

// ── mpp/session/solana.

function solanaOpenTx(payload: { [k: string]: Json }): SvmTx | Refusal {
  const wire = wireOf(payload["transaction"]);
  return isRefusal(wire) ? wire : decodeSvmTx(wire);
}

/**
 * The opening's checks: the one `open` of the challenge's program, its salt H's first 8 bytes, its channel the payload's;
 * then `authentication`, which draft-solana-session-00's open action requires for an `operator` voucher signer and
 * forbids for `client`, the default: missing for `operator`, or present for `client`, is `mpp/credential-malformed`;
 * present, it names the echoed challenge's id, else `svm/proof-not-challenge`.
 */
function solanaOpening(presented: MppCredential): { h: AtrHash; checked: Echoed; tx: SvmTx; program: string } | Refusal {
  const e = opening(presented, SOLANA);
  if (isRefusal(e)) return e;
  const program = channelProgram(e.checked);
  if (isRefusal(program)) return program;
  const tx = solanaOpenTx(e.payload);
  if (isRefusal(tx)) return tx;
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const open = openOf(tx, program);
  if (isRefusal(open)) return open;
  if (open.salt !== sessionSalt(e.h)) return refusal("mpp/carrier-not-challenge");
  const declared = keyBytes(e.payload["channelId"]);
  if (declared === null || keyString(declared) !== open.channel) return refusal("svm/channel-mismatch");
  const auth = e.payload["authentication"];
  if ((e.checked.details["voucherSigner"] === "operator") !== (auth !== undefined)) return refusal("mpp/credential-malformed");
  if (auth !== undefined && (!isObject(auth) || auth["challengeId"] !== presented.challenge.id)) {
    return refusal("svm/proof-not-challenge");
  }
  return { h: e.h, checked: e.checked, tx, program };
}

async function solanaBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = solanaOpening(presented);
  return isRefusal(o) ? o : o.h;
}

/**
 * The read keys of the signed opening: the transaction's digest, fee payer and blockhash, and the channel account it
 * opens, whose address is derived from a salt of H's first 8 bytes. The opening carries no memo, so a search for it
 * pages the channel account's signatures.
 */
async function solanaReference(input: unknown): Promise<Omit<SvmRef, "fromSlot"> | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = solanaOpening(presented);
  if (isRefusal(o)) return o;
  const network = solanaNetworkOf(o.checked.details, true);
  if (network === null) return refusal("svm/network-undeclared");
  if (isRefusal(network)) return network;
  const open = openOf(o.tx, o.program);
  if (isRefusal(open)) return open;
  const ref = await svmReference(network, o.tx);
  return isRefusal(ref) ? ref : { ...ref, channel: open.channel };
}

/**
 * The kind of a Solana session payment by its action, read against the echoed challenge's `voucherSigner` (`client`
 * when absent), as draft-solana-session-00 says: a `voucher` authorizes service only for `client`, and in `operator`
 * mode does not authenticate the caller; a `use` is valid only for `operator`. A `voucher` whose challenge names
 * `operator`, or a `use` whose challenge names `client` or no `voucherSigner`, is `mpp/session-action`.
 */
function solanaKind(presented: MppCredential): Kind | Refusal {
  const k = actionKind(presented, ["voucher", "topUp", "use"]);
  if (isRefusal(k)) return k;
  const action = presented.payload["action"];
  if (action !== "voucher" && action !== "use") return k;
  const details = echoedDetails(presented, "solana");
  if (isRefusal(details)) return details;
  return (details["voucherSigner"] === "operator") === (action === "use") ? k : refusal("mpp/session-action");
}

/**
 * A `use` credential echoing the opening challenge whose bearer proof names that challenge's id gives its H. A `voucher`
 * whose challenge's `voucherSigner` is `operator`, or a `use` whose challenge's is not, is `mpp/session-action`, as
 * `channel.kind` answers it.
 */
async function solanaBoundWithin(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const k = solanaKind(presented);
  if (isRefusal(k)) return k;
  if (presented.payload["action"] !== "use") return refusal("mpp/not-bound-within");
  const e = echoedFor(presented, SOLANA);
  if (isRefusal(e)) return e;
  const auth = e.payload["authentication"];
  if (!isObject(auth) || auth["challengeId"] !== presented.challenge.id) return refusal("svm/proof-not-challenge");
  return e.h;
}

/**
 * The network and the payload's `channelId`, re-encoded; on a within or close payment, read from the payment itself. A
 * `voucher` whose challenge's `voucherSigner` is `operator`, or a `use` whose challenge's is not, is
 * `mpp/session-action`, as `channel.kind` answers it.
 */
async function solanaRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const k = solanaKind(presented);
  if (isRefusal(k)) return k;
  let details: { [k: string]: Json };
  if (k === "open") {
    const e = echoedFor(presented, SOLANA);
    if (isRefusal(e)) return e;
    details = e.checked.details;
  } else {
    const d = echoedDetails(presented, "solana");
    if (isRefusal(d)) return d;
    details = d;
  }
  const network = solanaNetworkOf(details, true);
  if (network === null) return refusal("svm/network-undeclared");
  if (isRefusal(network)) return network;
  const channel = keyBytes(presented.payload["channelId"]);
  return channel === null ? refusal("mpp/credential-malformed") : { network, channel: keyString(channel) };
}

async function solanaStatus(ref: (SvmRef & { transaction: string }) | SvmCloseRef, reader: SvmReader): Promise<SvmStatus | SvmCloseStatus> {
  if (!isObject(reader)) return { state: "pending", why: "unreadable" };
  return isObject(ref) && "phase" in ref ? svmCloseStatus(ref, reader) : svmStatus(ref, reader);
}

function solanaCloseRef(chosen: MppChallenge, channel: string): Omit<SvmCloseRef, "transaction"> | Refusal {
  const checked = chosenChallenge(chosen, SOLANA);
  if (isRefusal(checked)) return checked;
  const network = solanaNetworkOf(checked.details, true);
  if (network === null) return refusal("svm/network-undeclared");
  if (isRefusal(network)) return network;
  const c = keyBytes(channel);
  if (c === null) return refusal("mpp/credential-malformed");
  const program = channelProgram(checked);
  if (isRefusal(program)) return program;
  return { phase: "close", network, program, channel: keyString(c) };
}

/**
 * The values the buyer's channel client composes the `open` from: the salt (H's first 8 bytes), the program, the
 * network and the request's blockhash and slot. `complete` checks the composed open before returning the credential.
 */
async function solanaBuild(choice: RailSessionChoice, h: AtrHash): Promise<SolanaSessionUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("svm/input-malformed");
  const checked = chosenFor(choice.challenge, h, SOLANA);
  if (isRefusal(checked)) return checked;
  const network = solanaNetworkOf(checked.details, true);
  if (network === null) return refusal("svm/network-undeclared");
  if (isRefusal(network)) return network;
  const challenge = choice.challenge;
  return {
    request: {
      kind: "solana-session-open",
      salt: sessionSalt(h),
      channelProgram: checked.details["channelProgram"] as string,
      network,
      recentBlockhash: checked.details["recentBlockhash"] as string,
      recentSlot: BigInt(checked.details["recentSlot"] as string),
    },
    complete(open: { [k: string]: Json }): MppCredential | Refusal {
      if (!isObject(open) || open["action"] !== "open") return refusal("mpp/session-action");
      const credential: MppCredential = { challenge, payload: open };
      const o = solanaOpening(credential);
      return isRefusal(o) ? o : credential;
    },
  };
}

/** The `authorizedSigner` account of the opening's one `open` instruction of `program`. */
function openSigner(tx: SvmTx, program: string): string | Refusal {
  const programKey = keyBytes(program);
  const ix = tx.instructions.find(
    (i) => programKey !== null && sameKeyBytes(tx.keys[i.program], programKey) && i.data[0] === OPEN_DISCRIMINATOR,
  );
  const key = ix === undefined ? undefined : tx.keys[ix.accounts[OPEN_SIGNER_ACCOUNT]!];
  return key === undefined ? refusal("svm/open-not-found") : keyString(key);
}

function sameKeyBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * A voucher, or a close's voucher, on the channel the held opening opened, for its `client` voucher signer: one
 * `ed25519-raw` request over `solanaVoucher(channelId, cumulativeAmount)`, for the signer the opening's `open`
 * instruction named. An `operator` channel's vouchers are the operator's, and are not built.
 */
async function solanaBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const o = await withinChecks(w, h, "session/solana", async (p) => solanaOpening(p), U64);
  if (isRefusal(o)) return o;
  if (o.checked.details["voucherSigner"] === "operator") return refusal("mpp/within-action-not-built");
  const signer = openSigner(o.tx, o.program);
  if (isRefusal(signer)) return signer;
  const channel = keyBytes(w.opening.payload["channelId"]);
  if (channel === null) return refusal("mpp/credential-malformed");
  const channelId = keyString(channel);
  const message = solanaVoucher(channelId, w.cumulativeAmount);
  if (isRefusal(message)) return message;
  const challenge = { ...w.challenge };
  const { action } = w;
  const cumulativeAmount = w.cumulativeAmount.toString();
  return {
    requests: [{ kind: "ed25519-raw", message, signer }],
    complete(signatures: readonly string[]): MppCredential | Refusal {
      const signature = Array.isArray(signatures) && signatures.length === 1 ? signatures[0] : undefined;
      if (typeof signature !== "string" || !isBase58Signature(signature)) return refusal("mpp/credential-malformed");
      return {
        challenge,
        payload: {
          action,
          channelId,
          voucher: { voucher: { channelId, cumulativeAmount }, signer, signature, signatureType: "ed25519" },
        },
      };
    },
  };
}

/** A base58 string of a 64-byte Ed25519 signature. */
function isBase58Signature(s: string): boolean {
  if (s.length < 64 || s.length > 88) return false;
  try {
    return base58.decode(s).length === 64;
  } catch {
    return false;
  }
}

// ── mpp/session/xrpl.

/** The exactly one memo among at most 8 whose `MemoData` is UTF-8 parsing as an LCP string, and its hash. */
function xrplLcpMemo(tx: XrplTxJson): AtrHash | Refusal {
  const memos = Array.isArray(tx.Memos) ? (tx.Memos as unknown[]) : [];
  if (memos.length > MAX_MEMOS) return refusal("xrpl/memo-count");
  const found: AtrHash[] = [];
  for (const m of memos) {
    const data = isObject(m) && isObject(m["Memo"]) ? (m["Memo"] as { [k: string]: unknown })["MemoData"] : undefined;
    if (typeof data !== "string" || !HEX.test(data)) continue;
    let text: string;
    try {
      text = UTF8.decode(Uint8Array.from(data.match(/../g)!.map((x) => Number.parseInt(x, 16))));
    } catch {
      continue;
    }
    const h = fromLcpString(text);
    if (h !== null) found.push(h);
  }
  if (found.length === 0) return refusal("xrpl/no-memo");
  if (found.length > 1) return refusal("xrpl/memo-count");
  return found[0]!;
}

/**
 * The opening's blob, decoded once per payload: a `PaymentChannelCreate` the payer signed with a single key (a blob that
 * carries `Signers` is refused `xrpl/multisigned`), whose one LCP memo is the echoed challenge's H.
 */
async function xrplOpening(
  presented: MppCredential,
): Promise<{ h: AtrHash; checked: Echoed; tx: XrplTxJson; hash: string; blob: string } | Refusal> {
  const e = opening(presented, XRPL);
  if (isRefusal(e)) return e;
  const blob = e.payload["transaction"];
  if (typeof blob !== "string") return refusal("xrpl/blob-malformed");
  const decoded = await decodePresented(e.payload, blob);
  if (isRefusal(decoded)) return decoded;
  if (decoded.tx.TransactionType !== "PaymentChannelCreate") return refusal("xrpl/not-channel-create");
  const h = xrplLcpMemo(decoded.tx);
  if (isRefusal(h)) return h;
  if (!hashEquals(h, e.h)) return refusal("mpp/carrier-not-challenge");
  return { h: e.h, checked: e.checked, tx: decoded.tx, hash: decoded.hash, blob };
}

async function xrplBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = await xrplOpening(presented);
  return isRefusal(o) ? o : o.h;
}

async function xrplReference(input: unknown): Promise<Omit<XrplRef, "fromLedger" | "expect"> | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const o = await xrplOpening(presented);
  if (isRefusal(o)) return o;
  const network = xrplNetworkOf(o.checked.details);
  if (isRefusal(network)) return network;
  const last = o.tx.LastLedgerSequence;
  return { network, transaction: o.hash, lastLedgerSequence: typeof last === "number" ? last : null };
}

/**
 * The channel id of an opening's signed blob: `xrplChannelId(Account, Destination, Sequence, or TicketSequence when
 * Sequence is 0)`; `xrpl/not-channel-create` when the blob lacks the source, destination or sequence.
 */
function xrplOpeningChannel(tx: XrplTxJson): string | Refusal {
  const seq = tx["Sequence"] === 0 ? tx["TicketSequence"] : tx["Sequence"];
  const id = xrplChannelId(tx.Account, tx["Destination"] as string, seq as number);
  return isRefusal(id) ? refusal("xrpl/not-channel-create") : id;
}

/**
 * The channel: on `open` its id from the signed blob (`xrplOpeningChannel`); on `voucher` and `close` the payload's, in
 * upper case.
 */
async function xrplRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const k = actionKind(presented, ["voucher"]);
  if (isRefusal(k)) return k;
  if (k !== "open") {
    const d = echoedDetails(presented, "xrpl");
    if (isRefusal(d)) return d;
    const network = xrplNetworkOf(d);
    if (isRefusal(network)) return network;
    const c = presented.payload["channelId"];
    return typeof c === "string" && HASH256.test(c) ? { network, channel: c.toUpperCase() } : refusal("mpp/credential-malformed");
  }
  const e = echoedFor(presented, XRPL);
  if (isRefusal(e)) return e;
  const network = xrplNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  const blob = e.payload["transaction"];
  if (typeof blob !== "string") return refusal("xrpl/blob-malformed");
  const decoded = await decodePresented(e.payload, blob);
  if (isRefusal(decoded)) return decoded;
  const id = xrplOpeningChannel(decoded.tx);
  return isRefusal(id) ? id : { network, channel: id };
}

/** `CancelAfter` in Unix seconds when the opening's blob sets one. */
function xrplUntil(presented: MppCredential): number | undefined {
  if (!isObject(presented) || !isObject(presented.payload) || presented.payload["action"] !== "open") return undefined;
  const blob = presented.payload["transaction"];
  if (typeof blob !== "string") return undefined;
  const c = cancelAfterOf(blob);
  return c === undefined ? undefined : c + RIPPLE_EPOCH;
}

async function xrplStatusOf(
  ref: Omit<XrplRef, "expect"> | XrplCloseRef,
  reader: XrplReader,
): Promise<XrplStatus | XrplCloseStatus> {
  return isObject(ref) && "phase" in ref ? xrplCloseStatus(ref, reader) : xrplOpenStatus(ref, reader);
}

/**
 * Zero-party: the one LCP memo of the opening, read by its signed blob, when a validated ledger holds the transaction
 * with `tesSUCCESS` as a `PaymentChannelCreate`, as `status` settles it. Not found is `xrpl/not-found`; not yet
 * validated is `xrpl/not-validated`; another result is `xrpl/not-success`; another type is `xrpl/not-channel-create`.
 * The blob must be that transaction's: a blob that does not decode, whose hash is not the transaction's, or whose
 * `TransactionType` is not the one the validated answer gives is `xrpl/unreadable`, an answer out of the reader's
 * documented form; a codec that cannot be loaded is `xrpl/peer-missing`. A ref whose `transaction` is not 64 hex digits is `xrpl/wrong-reader`, with nothing read; the
 * transaction and its blob are looked up in upper case, as `status` looks the transaction up. Two calls.
 */
async function xrplRecover(ref: { network: XrplNetwork; transaction: string }, reader: XrplReader): Promise<AtrHash | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("xrpl/wrong-reader");
  if (typeof ref.transaction !== "string" || !HASH256.test(ref.transaction)) return refusal("xrpl/wrong-reader");
  const transaction = ref.transaction.toUpperCase();
  let landed: Awaited<ReturnType<XrplReader["tx"]>>;
  try {
    landed = await reader.tx(transaction, null);
  } catch {
    return refusal("xrpl/unreadable");
  }
  if (typeof landed !== "object" || landed === null) return refusal("xrpl/unreadable");
  if ("notFound" in landed) return refusal("xrpl/not-found");
  if (landed.validated !== true) return refusal("xrpl/not-validated");
  if (landed.result !== "tesSUCCESS") return refusal("xrpl/not-success");
  if (landed.transactionType !== "PaymentChannelCreate") return refusal("xrpl/not-channel-create");
  let blob: string | null;
  try {
    blob = await reader.txBlob(transaction);
  } catch {
    return refusal("xrpl/unreadable");
  }
  if (blob === null) return refusal("xrpl/not-found");
  const decoded = await decodeBlob(blob);
  if (isRefusal(decoded)) return decoded.code === "xrpl/peer-missing" ? decoded : refusal("xrpl/unreadable");
  if (decoded.hash !== transaction || decoded.tx.TransactionType !== landed.transactionType) return refusal("xrpl/unreadable");
  return xrplLcpMemo(decoded.tx);
}

function xrplCloseRef(chosen: MppChallenge, channel: string): Omit<XrplCloseRef, "transaction"> | Refusal {
  const checked = chosenChallenge(chosen, XRPL);
  if (isRefusal(checked)) return checked;
  const network = xrplNetworkOf(checked.details);
  if (isRefusal(network)) return network;
  return typeof channel === "string" && HASH256.test(channel)
    ? { phase: "close", network, channel: channel.toUpperCase() }
    : refusal("mpp/credential-malformed");
}

/**
 * The `PaymentChannelCreate` for the wallet to sign, with one LCP memo carrying H, and the first claim's bytes on the
 * resulting channel. `complete` checks the signed blob before returning the credential.
 */
async function xrplBuild(choice: RailSessionChoice, h: AtrHash): Promise<XrplSessionUnsigned | Refusal> {
  if (!isObject(choice) || !isObject(choice.xrpl)) return refusal("mpp/input-malformed");
  const checked = chosenFor(choice.challenge, h, XRPL);
  if (isRefusal(checked)) return checked;
  const x = choice.xrpl;
  const u32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
  if (
    typeof choice.from !== "string" ||
    typeof choice.deposit !== "bigint" ||
    choice.deposit <= 0n ||
    choice.deposit >= U64 ||
    typeof x.publicKey !== "string" ||
    !HEX.test(x.publicKey) ||
    typeof x.fee !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(x.fee) ||
    !u32(x.settleDelay) ||
    !u32(x.sequence) ||
    !u32(x.lastLedgerSequence) ||
    (x.cancelAfter !== undefined && !u32(x.cancelAfter))
  ) {
    return refusal("mpp/input-malformed");
  }
  const network = xrplNetworkOf(checked.details);
  if (isRefusal(network)) return network;
  const destination = checked.request["recipient"] as string;
  const channelId = xrplChannelId(choice.from, destination, x.sequence);
  if (isRefusal(channelId)) return channelId;
  const drops = BigInt(checked.request["amount"] as string);
  const claimBytes = xrplClaim(channelId, drops);
  if (isRefusal(claimBytes)) return claimBytes;
  const memo = Array.from(new TextEncoder().encode(toLcpString(h)), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  const txJson: XrplTxJson = {
    TransactionType: "PaymentChannelCreate",
    Flags: 0,
    Account: choice.from,
    Amount: choice.deposit.toString(),
    Destination: destination,
    SettleDelay: x.settleDelay,
    PublicKey: x.publicKey.toUpperCase(),
    ...(x.cancelAfter !== undefined ? { CancelAfter: x.cancelAfter } : {}),
    Memos: [{ Memo: { MemoData: memo } }],
    Fee: x.fee,
    Sequence: x.sequence,
    LastLedgerSequence: x.lastLedgerSequence,
  };
  const challenge = choice.challenge;
  const source = `did:pkh:xrpl:${network.slice("xrpl:".length)}:${choice.from}`;
  const amount = checked.request["amount"] as string;
  return {
    request: { kind: "xrpl-session-open", txJson, claim: { channelId, drops, bytes: claimBytes } },
    async complete(signed: { signedBlob: string; claimSignature: string }): Promise<MppCredential | Refusal> {
      if (!isObject(signed) || typeof signed.signedBlob !== "string" || typeof signed.claimSignature !== "string" || !HEX.test(signed.claimSignature)) {
        return refusal("mpp/credential-malformed");
      }
      const credential: MppCredential = {
        challenge,
        source,
        payload: { action: "open", transaction: signed.signedBlob, amount, signature: signed.claimSignature },
      };
      const o = await xrplOpening(credential);
      return isRefusal(o) ? o : credential;
    },
  };
}

/**
 * A claim, or a close's final claim, on the channel the held opening created: one `xrpl-claim` request over
 * `xrplClaim(channelId, drops)`, for the channel's key, with the channel id derived from the opening's signed blob
 * (`xrplOpeningChannel`).
 */
async function xrplBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const o = await withinChecks(w, h, "session/xrpl", (p) => xrplOpening(p), U64);
  if (isRefusal(o)) return o;
  const channelId = xrplOpeningChannel(o.tx);
  if (isRefusal(channelId)) return channelId;
  const drops = w.cumulativeAmount;
  const bytes = xrplClaim(channelId, drops);
  if (isRefusal(bytes)) return bytes;
  const challenge = { ...w.challenge };
  const { action } = w;
  return {
    requests: [{ kind: "xrpl-claim", channelId, drops, bytes }],
    complete(signatures: readonly string[]): MppCredential | Refusal {
      const signature = Array.isArray(signatures) && signatures.length === 1 ? signatures[0] : undefined;
      if (typeof signature !== "string" || !HEX.test(signature)) return refusal("mpp/credential-malformed");
      return { challenge, payload: { action, channelId, amount: drops.toString(), signature } };
    },
  };
}

// ── The seller's side of a reported close.

/** The issued challenge, checked, naming `pairing`. */
function chosenChallenge(chosen: MppChallenge, pairing: typeof HEDERA | typeof SOLANA | typeof XRPL): Checked | Refusal {
  const checked = checkChallenge(chosen, true);
  if (isRefusal(checked)) return checked;
  return checked.pairings.includes(pairing) ? checked : refusal("mpp/not-this-pairing");
}

// ── Resume.

/**
 * The network and channel a Hedera, Solana or XRPL session challenge names for the client to resume, spelled as the
 * pairing's `channel.ref` spells it: Hedera's `methodDetails.channelId` (a bytes32, lowercase), Solana's
 * `methodDetails.channelId` (a base58 address, re-encoded), XRPL's request `channelId` (64 hex characters, upper case).
 * Null when the challenge names no channel: the member absent, or XRPL's `""`. Refused for any other challenge, or a
 * channel or network that cannot be read.
 */
export function railSessionResume(c: MppChallenge): { network: string; channel: string } | null | Refusal {
  if (!isObject(c) || c.intent !== "session" || typeof c.request !== "string") return refusal("mpp/not-this-pairing");
  const method = c.method;
  if (method !== "hedera" && method !== "solana" && method !== "xrpl") return refusal("mpp/not-this-pairing");
  const request = decodeObject(c.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const md = request["methodDetails"];
  if (md !== undefined && !isObject(md)) return refusal("mpp/request-malformed");
  const details = (md ?? {}) as { [k: string]: Json };
  if (method === "xrpl") {
    const named = request["channelId"];
    if (named === undefined || named === "") return null;
    if (typeof named !== "string" || !HASH256.test(named)) return refusal("mpp/request-malformed");
    const network = xrplNetworkOf(details);
    return isRefusal(network) ? network : { network, channel: named.toUpperCase() };
  }
  const named = details["channelId"];
  if (named === undefined) return null;
  if (method === "hedera") {
    const channel = normalHash(named);
    if (channel === null) return refusal("mpp/request-malformed");
    const network = hederaSessionNetworkOf(details);
    return isRefusal(network) ? network : { network, channel };
  }
  const key = keyBytes(named);
  if (key === null) return refusal("mpp/request-malformed");
  const network = solanaNetworkOf(details, true);
  if (network === null) return refusal("svm/network-undeclared");
  return isRefusal(network) ? network : { network, channel: keyString(key) };
}

// ── The records.

function sessionPattern(p: Pick<LcpPattern, "pattern" | "buyerSigns" | "zeroPartyRecoverable" | "proves">, profile: string): LcpPattern {
  return deepFreeze({
    ...p,
    canonical: false,
    profile,
    onChain: true,
    forwardIndexable: false,
    publicProof: true,
  } as LcpPattern);
}

export const sessionHedera = Object.freeze({
  id: HEDERA,
  pattern: sessionPattern(
    {
      pattern: "native-field",
      buyerSigns: true,
      zeroPartyRecoverable: true,
      proves:
        "The payer signed a Hedera EVM transaction that opened an MPP session channel on the escrow contract named in " +
        "the challenge, with this ATR's hash as the channel's salt, and it reached consensus. The escrow's " +
        "ChannelOpened event carries the salt, and the channel id is keccak256 over an encoding that includes it. The " +
        "hash is also in the MPP challenge the opening answered. Each voucher signs that channel id, which commits to " +
        "this ATR's hash. This does not show that amount, deposit, recipient, token or timing match the ATR's " +
        "content.",
    },
    "mpp/session/hedera-solana-xrpl",
  ),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: hederaBuild,
  buildWithin: hederaBuildWithin,
  bound: hederaBound,
  reference: hederaReference,
  status: hederaStatus,
  recover: hederaRecover,
  fetchPresented: hederaFetchPresented,
  landedTx: (presented: unknown): string | undefined => {
    const c = credentialOf(presented);
    if (isRefusal(c) || c.payload["action"] !== "open") return undefined;
    return normalHash(c.payload["txHash"]) ?? undefined;
  },
  closeRef: hederaCloseRef,
  channel: Object.freeze({
    kind: (p: MppCredential) => actionKind(p, ["voucher", "topUp", "use"]),
    ref: hederaRef,
    boundWithin: notBoundWithin,
    until: (_p: MppCredential): number | undefined => undefined,
  }),
});

export const sessionSolana = Object.freeze({
  id: SOLANA,
  pattern: sessionPattern(
    {
      pattern: "truncated-field",
      buyerSigns: false,
      zeroPartyRecoverable: false,
      proves:
        "The ATR was assembled and delivered before approval, and its hash is in the MPP challenge the opening " +
        "answered, protected by the server's binding of the challenge. The payer signed a Solana transaction that " +
        "opened a session channel on the channel program named in the challenge, with the first 8 bytes of this ATR's " +
        "hash as the channel's salt, and it executed without error. The salt binds only this hash's first 8 bytes: " +
        "whoever assembles the ATR can construct a second ATR whose hash shares them. This does not show that amount, " +
        "deposit, recipient, mint or timing match the ATR's content.",
    },
    "mpp/session/hedera-solana-xrpl",
  ),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: solanaBuild,
  buildWithin: solanaBuildWithin,
  bound: solanaBound,
  reference: solanaReference,
  status: solanaStatus,
  closeRef: solanaCloseRef,
  channel: Object.freeze({
    kind: (p: MppCredential) => solanaKind(p),
    ref: solanaRef,
    boundWithin: solanaBoundWithin,
    until: (_p: MppCredential): number | undefined => undefined,
  }),
});

export const sessionXrpl = Object.freeze({
  id: XRPL,
  pattern: sessionPattern(
    {
      pattern: "native-field",
      buyerSigns: true,
      zeroPartyRecoverable: true,
      proves:
        "The payer signed, with a single key, an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's " +
        "hash, and it is in a validated ledger with tesSUCCESS. The memo is in the public transaction. Vouchers in " +
        "this channel sign the channel id and an amount, not the hash. This does not show that amount, deposit, " +
        "destination, settle delay or timing match the ATR's content.",
    },
    "mpp/session/hedera-solana-xrpl",
  ),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: xrplBuild,
  buildWithin: xrplBuildWithin,
  bound: xrplBound,
  reference: xrplReference,
  status: xrplStatusOf,
  recover: xrplRecover,
  closeRef: xrplCloseRef,
  channel: Object.freeze({
    kind: (p: MppCredential) => actionKind(p, ["voucher"]),
    ref: xrplRef,
    boundWithin: notBoundWithin,
    until: xrplUntil,
  }),
});
