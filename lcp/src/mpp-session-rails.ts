/**
 * MPP's `session` intent on Hedera, Solana and XRPL. One ATR covers a whole channel; its hash is bound where the
 * channel opens, in what the payer signs: the Hedera escrow's `salt` (H in full), the Solana channel's `salt` (H's first
 * 8 bytes), and the XRPL `PaymentChannelCreate`'s one LCP memo (H in full). Later requests in the channel are the
 * seller's and are never claimed.
 */
import { base58 } from "@scure/base";
import { fromLcpString, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import { addressOfWord, bytesOf, hexOf, sameBytes, wordAt, type Hex } from "./evm-abi.js";
import { evmStatus, isLog, type EvmBreadthStatus, type EvmLog, type EvmReader, type EvmRef } from "./evm.js";
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
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { hederaSessionNetworkOf, solanaNetworkOf, xrplNetworkOf } from "./mpp-rail-checks.js";
import type { LandedCredential } from "./mpp.js";
import { withinChecks, type SessionWithin, type SessionWithinUnsigned } from "./mpp-session.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
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

/** The values a Solana channel client composes the `open` from; `complete` takes the composed open payload. */
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

/** The challenge as issued: no request member carries H on these pairings. */
function unplaced(option: MppChallenge): MppChallenge {
  return option;
}

/** MPP's `place`: the id derived from H and `opaque`; `request` is left unchanged. */
function advertise(doc: readonly MppChallenge[], h: AtrHash, link: string, offer: MppChallenge, agreementUrl?: string) {
  return place(doc, h, link, offer, agreementUrl);
}

async function notBoundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

const LATER =
  "Later requests in this channel were paid under this ATR by vouchers the seller did not meter";

// ── mpp/session/hedera.

function hederaEscrow(checked: Checked): Hex {
  return (checked.details["escrowContract"] as string).toLowerCase() as Hex;
}

function hederaChain(network: string): 295 | 296 {
  return network === "hedera:mainnet" ? 295 : 296;
}

/**
 * The opening's receipt, read by `payload.txHash`, with its logs from the escrow added as `landed`. No receipt is
 * `hedera/not-found`, a failed read `hedera/unreadable`, and a revert `hedera/reverted`: reads to repeat.
 */
async function hederaFetchPresented(presented: MppCredential, reader: HederaEvmReader): Promise<HederaLandedCredential | Refusal> {
  const e = opening(presented, HEDERA);
  if (isRefusal(e)) return e;
  const network = hederaSessionNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  if (reader.network !== network) return refusal("hedera/unreadable");
  const tx = normalHash(e.payload["txHash"]);
  if (tx === null) return refusal("mpp/credential-malformed");
  let receipt: Awaited<ReturnType<EvmReader["receipt"]>>;
  try {
    receipt = await reader.receipt(tx as Hex);
  } catch {
    return refusal("hedera/unreadable");
  }
  if (receipt === null) return refusal("hedera/not-found");
  if (!isObject(receipt) || !Array.isArray(receipt.logs) || !receipt.logs.every(isLog)) return refusal("hedera/unreadable");
  if (receipt.status === 0) return refusal("hedera/reverted");
  const escrow = hederaEscrow(e.checked);
  const logs = receipt.logs.filter((l) => sameBytes(l.address.toLowerCase(), escrow)).slice(0, MAX_LANDED_LOGS);
  return { ...presented, landed: { transaction: tx as Hex, blockNumber: receipt.blockNumber, logs } };
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
  const opened = landed.logs.filter(
    (l) =>
      isLog(l) &&
      l.address.toLowerCase() === escrow &&
      l.topics.length === 4 &&
      l.topics[0]!.toLowerCase() === CHANNEL_OPENED_TOPIC &&
      l.topics[1]!.toLowerCase() === channel &&
      bytesOf(l.data)?.length === 128,
  );
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

/** The opening's read keys: the reported open transaction and its `ChannelOpened` log naming the channel. */
async function hederaReference(input: unknown): Promise<HederaSessionRef | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const e = opening(presented, HEDERA);
  if (isRefusal(e)) return e;
  const network = hederaSessionNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  const tx = normalHash(e.payload["txHash"]);
  const channel = normalHash(e.payload["channelId"]);
  if (tx === null || channel === null) return refusal("mpp/credential-malformed");
  return {
    network,
    transaction: tx as Hex,
    bindingLog: { address: hederaEscrow(e.checked), topic0: CHANNEL_OPENED_TOPIC, index: 1, value: channel as Hex },
  };
}

/** The opening, read like any EVM payment through the relay; or a reported close, whose `ChannelClosed` names the channel. */
async function hederaStatus(ref: HederaSessionRef | HederaCloseRef, reader: HederaEvmReader): Promise<EvmBreadthStatus> {
  const evmRef: EvmRef & { transaction: Hex } =
    "phase" in ref
      ? {
          network: ref.network,
          transaction: ref.transaction,
          bindingLog: { address: ref.escrow, topic0: CHANNEL_CLOSED_TOPIC, index: 1, value: ref.channel },
        }
      : ref;
  return evmStatus(evmRef, reader as EvmReader);
}

/** Zero-party: the salt (data word 2) of the opening's `ChannelOpened` log naming the channel. */
async function hederaRecover(ref: HederaSessionRef, reader: HederaEvmReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("hedera/unreadable");
  let receipt: Awaited<ReturnType<EvmReader["receipt"]>>;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return refusal("hedera/unreadable");
  }
  if (receipt === null) return refusal("hedera/not-found");
  if (!isObject(receipt) || !Array.isArray(receipt.logs)) return refusal("hedera/unreadable");
  const b = ref.bindingLog;
  if (b === undefined) return refusal("hedera/channel-log-not-found");
  const log = receipt.logs.find(
    (l) =>
      isLog(l) &&
      l.address.toLowerCase() === b.address.toLowerCase() &&
      l.topics.length === 4 &&
      l.topics[0]!.toLowerCase() === CHANNEL_OPENED_TOPIC &&
      l.topics[1]!.toLowerCase() === b.value.toLowerCase(),
  );
  const data = log === undefined ? undefined : bytesOf(log.data);
  if (data === undefined || data.length !== 128) return refusal("hedera/channel-log-not-found");
  return hexOf(wordAt(data, 2)!) as AtrHash;
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
  const typedData = hederaVoucher({ channelId: channelId as Hex, escrow: hederaEscrow(o.checked), chainId: hederaChain(network) }, w.cumulativeAmount);
  const challenge = { ...w.challenge };
  const { action } = w;
  const cumulativeAmount = w.cumulativeAmount.toString();
  return {
    requests: [{ kind: "eip712", typedData }],
    complete(signatures: readonly string[]): MppCredential | Refusal {
      const signature = Array.isArray(signatures) && signatures.length === 1 ? signatures[0] : undefined;
      if (typeof signature !== "string" || (bytesOf(signature)?.length ?? 0) < 65) return refusal("mpp/credential-malformed");
      return { challenge, payload: { action, channelId, cumulativeAmount, signature } };
    },
  };
}

// ── mpp/session/solana.

function solanaOpenTx(payload: { [k: string]: Json }): SvmTx | Refusal {
  const wire = wireOf(payload["transaction"]);
  return isRefusal(wire) ? wire : decodeSvmTx(wire);
}

/** The opening's checks: the one `open` of the challenge's program, its salt H's first 8 bytes, its channel the payload's. */
function solanaOpening(presented: MppCredential): { h: AtrHash; checked: Checked; tx: SvmTx } | Refusal {
  const e = opening(presented, SOLANA);
  if (isRefusal(e)) return e;
  const tx = solanaOpenTx(e.payload);
  if (isRefusal(tx)) return tx;
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const open = openOf(tx, e.checked.details["channelProgram"] as string);
  if (isRefusal(open)) return open;
  if (open.salt !== sessionSalt(e.h)) return refusal("mpp/carrier-not-challenge");
  const declared = keyBytes(e.payload["channelId"]);
  if (declared === null || keyString(declared) !== open.channel) return refusal("svm/channel-mismatch");
  const auth = e.payload["authentication"];
  if (auth !== undefined && (!isObject(auth) || auth["challengeId"] !== presented.challenge.id)) {
    return refusal("svm/proof-not-challenge");
  }
  return { h: e.h, checked: e.checked, tx };
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
  const open = openOf(o.tx, o.checked.details["channelProgram"] as string);
  if (isRefusal(open)) return open;
  const ref = await svmReference(network, o.tx);
  return isRefusal(ref) ? ref : { ...ref, channel: open.channel };
}

/** A `use` credential echoing the opening challenge whose bearer proof names that challenge's id gives its H. */
async function solanaBoundWithin(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const k = actionKind(presented, ["voucher", "topUp", "use"]);
  if (isRefusal(k)) return k;
  if (presented.payload["action"] !== "use") return refusal("mpp/not-bound-within");
  const e = echoedFor(presented, SOLANA);
  if (isRefusal(e)) return e;
  const auth = e.payload["authentication"];
  if (!isObject(auth) || auth["challengeId"] !== presented.challenge.id) return refusal("svm/proof-not-challenge");
  return e.h;
}

/** The network and the payload's `channelId`, re-encoded; on a within or close payment, read from the payment itself. */
async function solanaRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const k = actionKind(presented, ["voucher", "topUp", "use"]);
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
  return "phase" in ref ? svmCloseStatus(ref, reader) : svmStatus(ref, reader);
}

function solanaCloseRef(chosen: MppChallenge, channel: string): Omit<SvmCloseRef, "transaction"> | Refusal {
  const checked = chosenChallenge(chosen, SOLANA);
  if (isRefusal(checked)) return checked;
  const network = solanaNetworkOf(checked.details, true);
  if (network === null) return refusal("svm/network-undeclared");
  if (isRefusal(network)) return network;
  const c = keyBytes(channel);
  if (c === null) return refusal("mpp/credential-malformed");
  return { phase: "close", network, program: checked.details["channelProgram"] as string, channel: keyString(c) };
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
  const signer = openSigner(o.tx, o.checked.details["channelProgram"] as string);
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
): Promise<{ h: AtrHash; checked: Checked; tx: XrplTxJson; hash: string; blob: string } | Refusal> {
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

/** The channel: on `open` its id from the signed blob; on `voucher` and `close` the payload's, in upper case. */
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
  const { tx } = decoded;
  const seq = tx["Sequence"] === 0 ? tx["TicketSequence"] : tx["Sequence"];
  const id = xrplChannelId(tx.Account, tx["Destination"] as string, seq as number);
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
  return "phase" in ref ? xrplCloseStatus(ref, reader) : xrplOpenStatus(ref, reader);
}

/** Zero-party: the one LCP memo of the landed opening, read by its signed blob. */
async function xrplRecover(ref: { network: XrplNetwork; transaction: string }, reader: XrplReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("xrpl/wrong-reader");
  let blob: string | null;
  try {
    blob = await reader.txBlob(ref.transaction);
  } catch {
    return refusal("xrpl/unreadable");
  }
  if (blob === null) return refusal("xrpl/not-found");
  const decoded = await decodeBlob(blob);
  if (isRefusal(decoded)) return decoded;
  if (decoded.tx.TransactionType !== "PaymentChannelCreate") return refusal("xrpl/not-channel-create");
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
 * `xrplClaim(channelId, drops)`, for the channel's key, with the channel id derived from the opening's signed blob.
 */
async function xrplBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const o = await withinChecks(w, h, "session/xrpl", (p) => xrplOpening(p), U64);
  if (isRefusal(o)) return o;
  const seq = o.tx["Sequence"] === 0 ? o.tx["TicketSequence"] : o.tx["Sequence"];
  const channelId = xrplChannelId(o.tx.Account, o.tx["Destination"] as string, seq as number);
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
        "The payer signed a Hedera EVM transaction that opened an MPP session channel on the escrow contract named " +
        "in the challenge, with this ATR's hash as the channel's salt, and it reached consensus. The escrow's " +
        "ChannelOpened event carries the salt, and the channel id is keccak256 over an encoding that includes it. The " +
        "hash is also in the MPP challenge the opening answered. " +
        LATER +
        ". Each voucher signs that channel id, which commits to this ATR's hash. This does not show that amount, " +
        "deposit, recipient, token or timing match the ATR's content.",
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
        "The ATR was assembled, written to the seller's storage and linked in the challenge before approval, " +
        "and its hash is in the MPP challenge the opening " +
        "answered, protected by the server's binding of the challenge. The payer signed a Solana transaction that " +
        "opened a session channel on the channel program named in the challenge, with the first 8 bytes of this ATR's " +
        "hash as the channel's salt, and it executed without error. The salt binds only this hash's first 8 bytes: " +
        "whoever assembles the ATR can construct a second ATR whose hash shares them. " +
        LATER +
        ". Where the operator signs the vouchers, each request also carried the payer's session proof, which signs the " +
        "opening challenge's id and so this ATR's hash. This does not show that amount, deposit, recipient, mint or " +
        "timing match the ATR's content.",
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
    kind: (p: MppCredential) => actionKind(p, ["voucher", "topUp", "use"]),
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
        "hash, and it is in a validated ledger with tesSUCCESS. The memo is in the public transaction. " +
        LATER +
        "; each signs the channel id and an amount, not the hash. This does not show that amount, deposit, " +
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
