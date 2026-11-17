/**
 * MPP's `session` intent under the stock `solana` method of `@solana/mpp` 0.7.0. Under the challenge that makes the
 * server submit the opening (`modes` exactly `["pull"]`, `pullVoucherStrategy` `clientVoucher`), the pairing is
 * `mpp/session/solana/memo`: lcp's client composes the stock `open`, whose fee payer and rent payer is the challenge's
 * `operator`, and adds one Memo instruction with H's LCP string; an opening without it, and an open action that carries
 * no transaction, are refused before the server submits anything. Under any other challenge the buyer's client
 * broadcasts the opening, and the pairing is `mpp/session/solana/stock`, at coverage `none`: the stock `open` carries
 * no H, and the agreement comes first.
 */
import { hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import { notFoundPoint } from "./fields.js";
import {
  compileV0,
  decodeSvmTx,
  keyBytes,
  keyString,
  MEMO_V3,
  signedWire,
  TOKEN,
  wireOf,
  type SolanaNetwork,
  type SvmTx,
} from "./internal/svm.js";
import {
  mppSvmReference,
  svmChannelStatus,
  svmOpeningStatus,
  type SvmQuery,
  type SvmReader,
  type SvmRef,
  type SvmStatus,
} from "./internal/svm-read.js";
import { openInstruction, openInstructionFor, PAYMENT_CHANNELS_PROGRAM } from "./internal/svm-session.js";
import {
  chosenFor,
  credentialOf,
  decodeObject,
  deepFreeze,
  echoedFor,
  FETCHED,
  fetchedOf,
  isObject,
  measured,
  measuring,
  measuringAsync,
  place,
  read,
  sessionBroadcaster,
  tie,
  type Echoed,
  type MppChallenge,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import { solanaNetworkOf } from "./mpp-rail-checks.js";
import { isSignatureText, mppSvmCarrier, recover } from "./mpp-solana.js";
import { toBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";
import { SOLANA as SOLANA_DATA } from "./internal/data/solana.js";
import { mppPayee } from "./internal/payee.js";
import type { Act } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";

const MEMO = "mpp/session/solana/memo" as const;
const STOCK = "mpp/session/solana/stock" as const;
type SessionId = typeof MEMO | typeof STOCK;

/** The largest packet a Solana transaction travels in, its signatures included. */
export const SOLANA_PACKET_BYTES = 1232;
/** The signature the stock client writes while the server has yet to submit the opening (`src/client/PaymentChannels.ts:47`). */
const PENDING_SERVER_SIGNATURE = "1".repeat(64);
/** The grace period the stock client opens with when the caller gives none (`src/client/PaymentChannels.ts:45`). */
const DEFAULT_GRACE_PERIOD = 900;
const U64 = 1n << 64n;

/** The kind of a session credential by its action: `open`, `voucher` and `commit` within, `close`. */
function kindOf(presented: MppCredential): "open" | "within" | "close" | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  const a = c.payload["action"];
  if (a === "open") return "open";
  if (a === "voucher" || a === "commit") return "within";
  if (a === "close") return "close";
  return refusal("mpp/session-action");
}

/** The network the held challenge's `network` names; `localnet` is `svm/network-undeclared`. */
function networkOf(request: { [k: string]: Json }): SolanaNetwork | Refusal {
  const n = solanaNetworkOf(request, false);
  return n === null ? refusal("svm/network-undeclared") : n;
}

/** The opening a credential presents: an `open` action, else `mpp/not-an-opening`. */
function openingOf(credential: MppCredential, pairing: SessionId): { h: AtrHash; checked: Echoed; payload: { [k: string]: Json } } | Refusal {
  const e = echoedFor(credential, pairing);
  if (isRefusal(e)) return e;
  return e.payload["action"] === "open" ? e : refusal("mpp/not-an-opening");
}

// ── mpp/session/solana/memo.

/**
 * The opening's checks, in order: an `open` action of the echoed challenge; its `transaction`, without which no
 * payer-signed opening carries H (`svm/no-carrier`); the transaction decodes (`svm/tx-malformed`, `svm/tx-too-large`
 * past the 1,232-byte packet) and holds one `open` of the request's payment-channels program (`svm/open-not-found`);
 * its fee payer and rent payer are the challenge's `operator`, and its payer is not (`svm/open-not-operator`); and its
 * one LCP memo (`svm/no-carrier`, `svm/memo-count`, `svm/carrier-not-canonical`) names the challenge's H
 * (`mpp/carrier-not-challenge`).
 */
function memoOpening(credential: MppCredential): { h: AtrHash; checked: Echoed; tx: SvmTx } | Refusal {
  const e = openingOf(credential, MEMO);
  if (isRefusal(e)) return e;
  if (e.payload["transaction"] === undefined) return refusal("svm/no-carrier");
  const wire = wireOf(e.payload["transaction"]);
  if (isRefusal(wire)) return wire;
  const tx = decodeSvmTx(wire);
  if (isRefusal(tx)) return tx;
  const program = typeof e.checked.request["programId"] === "string" ? e.checked.request["programId"] : PAYMENT_CHANNELS_PROGRAM;
  const open = openInstruction(tx, program);
  if (isRefusal(open)) return open;
  const operator = keyBytes(e.checked.request["operator"]);
  const same = (i: number | undefined) => i !== undefined && tx.keys[i] !== undefined && operator !== null && tx.keys[i]!.every((x, j) => x === operator[j]);
  if (!same(0) || !same(open.ix.accounts[1]) || same(open.ix.accounts[0])) return refusal("svm/open-not-operator");
  const carrier = mppSvmCarrier(tx);
  if (isRefusal(carrier)) return carrier;
  if (!hashEquals(carrier.h, e.h)) return refusal("mpp/carrier-not-challenge");
  return { h: e.h, checked: e.checked, tx };
}

async function memoBound(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const o = memoOpening(credential);
  return isRefusal(o) ? o : o.h;
}

/**
 * The opening's read keys on the request's network (`mppSvmReference`): H, the buyer, the `open`'s payer, which funds
 * the deposit, the fee payer and what bounds the message's life, and the payee of `option`; a credential whose echoed
 * challenge is not `option` is `mpp/challenge-not-option`.
 */
async function memoReference(input: unknown, option: MppChallenge): Promise<SvmRef | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const o = memoOpening(credential);
  if (isRefusal(o)) return o;
  const network = networkOf(o.checked.request);
  if (isRefusal(network)) return network;
  return mppSvmReference(credential.challenge, network, o.tx, o.h, option);
}

/** The buyer's inputs to the memo session's `build`. */
export interface SolanaSessionChoice {
  challenge: MppChallenge & { id: string };
  /** The payer, whose token account funds the deposit. */
  payer: string;
  /** The session key that signs vouchers. */
  authorizedSigner: string;
  /** The PDA salt; lcp draws nothing. */
  salt: bigint;
  /** The deposit; the request's `cap` where absent. */
  deposit?: bigint;
  /** The close's grace period in seconds; 900 where absent, as the stock client opens. */
  gracePeriod?: number;
  /** The channel's `openSlot`; the request's `recentSlot` wins when present. */
  openSlot?: bigint;
  /** The request's `recentBlockhash` wins when present. */
  recentBlockhash?: string;
  /** The mint the request's `currency` names: the currency itself where it is a key, else the caller's resolution. */
  mint?: string;
  /** Token where absent. */
  tokenProgram?: string;
}

export interface SolanaSessionUnsigned {
  request: {
    kind: "solana-session-open";
    /** The message the payer signs: the stock `open` with one Memo instruction carrying H's LCP string. */
    message: Uint8Array<ArrayBuffer>;
    /** The composed transaction's size in bytes, its two signatures included, at most 1,232. */
    size: number;
    channel: string;
  };
  /** The open credential for the payer's 64-byte Ed25519 signature over `message`, the operator's slot left zero. */
  complete(signature: Uint8Array): MppCredential | Refusal;
}

/**
 * The opening for the payer to sign: the stock `open` (`openInstructionFor`) with the challenge's `operator` as fee
 * payer and rent payer, the request's `recipient` as payee and its `splits` as the distribution, then one Memo
 * instruction carrying H's LCP string. Its composed size, its two signatures included, is stated, and one past the
 * 1,232-byte packet is `svm/tx-too-large`, with no message to sign. A payer that is the operator is
 * `svm/open-not-operator`.
 */
async function memoBuild(choice: SolanaSessionChoice, h: AtrHash): Promise<SolanaSessionUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("svm/input-malformed");
  const checked = chosenFor(choice.challenge, h, MEMO);
  if (isRefusal(checked)) return checked;
  const r = checked.request;
  const operator = r["operator"] as string;
  if (choice.payer === operator) return refusal("svm/open-not-operator");
  const currency = r["currency"] as string;
  const mint = keyBytes(currency) !== null ? currency : choice.mint;
  const deposit = choice.deposit ?? BigInt(r["cap"] as string);
  const slot = r["recentSlot"] ?? (choice.openSlot === undefined ? undefined : choice.openSlot.toString());
  const blockhash = typeof r["recentBlockhash"] === "string" ? r["recentBlockhash"] : choice.recentBlockhash;
  const gracePeriod = choice.gracePeriod ?? DEFAULT_GRACE_PERIOD;
  if (
    typeof mint !== "string" ||
    typeof blockhash !== "string" ||
    slot === undefined ||
    typeof choice.salt !== "bigint" ||
    choice.salt < 0n ||
    choice.salt >= U64 ||
    typeof deposit !== "bigint" ||
    deposit <= 0n ||
    deposit >= U64 ||
    !Number.isInteger(gracePeriod) ||
    gracePeriod < 0 ||
    gracePeriod > 0xffffffff
  ) {
    return refusal("svm/input-malformed");
  }
  const splits = Array.isArray(r["splits"]) ? (r["splits"] as { recipient: string; bps: number }[]) : [];
  const open = openInstructionFor({
    program: typeof r["programId"] === "string" ? r["programId"] : PAYMENT_CHANNELS_PROGRAM,
    payer: choice.payer,
    operator,
    payee: r["recipient"] as string,
    mint,
    tokenProgram: choice.tokenProgram ?? TOKEN,
    authorizedSigner: choice.authorizedSigner,
    salt: choice.salt,
    deposit,
    gracePeriod,
    openSlot: BigInt(slot as string | number),
    recipients: splits.map((s) => ({ recipient: s.recipient, bps: s.bps })),
  });
  if (isRefusal(open)) return open;
  const memo = { programAddress: MEMO_V3, data: new TextEncoder().encode(toLcpString(h)) };
  const message = await compileV0(operator, blockhash, [open.instruction, memo]);
  if (isRefusal(message)) return message;
  const size = 1 + 64 * 2 + message.length;
  if (size > SOLANA_PACKET_BYTES) return refusal("svm/tx-too-large");
  const challenge = checked.challenge;
  const payload = {
    action: "open",
    authorizedSigner: choice.authorizedSigner,
    channelId: open.channel,
    deposit: deposit.toString(),
    gracePeriod,
    mint,
    mode: "pull",
    payee: r["recipient"] as string,
    payer: choice.payer,
    recentSlot: String(slot),
    salt: choice.salt.toString(),
    signature: PENDING_SERVER_SIGNATURE,
  };
  return {
    request: { kind: "solana-session-open", message, size, channel: open.channel },
    complete(signature: Uint8Array): MppCredential | Refusal {
      const wire = signedWire(message, choice.payer, signature);
      if (isRefusal(wire)) return wire;
      return measured({ challenge, payload: { ...payload, transaction: toBase64(wire) } });
    },
  };
}

/**
 * The channel a credential names: on `open`, the `open`'s channel (account 5) once the opening reads as `bound` reads
 * it; on a voucher or commit, its voucher's `channelId`; on a close, its `channelId`. Each on the request's network.
 */
async function memoRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const k = kindOf(presented);
  if (isRefusal(k)) return k;
  if (k === "open") {
    const o = memoOpening(presented);
    if (isRefusal(o)) return o;
    const network = networkOf(o.checked.request);
    if (isRefusal(network)) return network;
    const program = typeof o.checked.request["programId"] === "string" ? o.checked.request["programId"] : PAYMENT_CHANNELS_PROGRAM;
    const open = openInstruction(o.tx, program);
    if (isRefusal(open)) return open;
    return { network, channel: keyString(o.tx.keys[open.ix.accounts[5]!]!) };
  }
  return namedChannel(presented);
}

/** The channel a later credential names, on its echoed challenge's network, read without the opening's checks. */
function namedChannel(presented: MppCredential): { network: string; channel: string } | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  if (c.challenge.intent !== "session" || c.challenge.method !== "solana") return refusal("mpp/not-this-pairing");
  const request = decodeObject(c.challenge.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const network = networkOf(request as { [k: string]: Json });
  if (isRefusal(network)) return network;
  const voucher = c.payload["voucher"];
  const data = isObject(voucher) ? (voucher as { [k: string]: Json })["data"] : undefined;
  const channel = c.payload["action"] === "close" ? c.payload["channelId"] : isObject(data) ? (data as { [k: string]: Json })["channelId"] : undefined;
  return keyBytes(channel) === null ? refusal("mpp/credential-malformed") : { network, channel: channel as string };
}

async function notBoundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

/**
 * The challenge as issued: no request member carries H on the sessions. A challenge that carries a `refused` member is
 * `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return option;
}

/** MPP's `place`: the id derived from H and `opaque`; `request` is left unchanged. */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  position: number | null,
  act?: Act,
  agreementUrl?: string,
) {
  return place(doc, h, link, offer, position, act, agreementUrl);
}

function sessionPattern(profile: string, onChain: boolean): LcpPattern {
  return deepFreeze({ pattern: "native-field", profile, onChain, zeroPartyRecoverable: onChain, forwardIndexable: false });
}

/** The family types of the two Solana sessions. */
type SessionForms<Choice, Unsigned> = MppForms & {
  choice: Choice;
  unsigned: Unsigned;
  landed: object;
  network: SolanaNetwork;
  query: SvmQuery;
  answer: SvmStatus;
};

/**
 * `mpp/session/solana/memo`. The payee broadcasts every payment the session takes (`broadcaster` answers `"payee"`
 * for the actions `channel.kind` takes: the opening, which the seller's server co-signs as the operator and submits,
 * a voucher, a commit and the close). A top-up, which the payer's client broadcasts, and any other action get
 * `mpp/not-an-opening`, as `bound` refuses them.
 */
export const sessionSolanaMemo = Object.freeze({
  id: MEMO,
  data: SOLANA_DATA[MEMO],
  pattern: sessionPattern("mpp/session/hedera-solana-xrpl", true),
  claims: true as const,
  unplaced,
  tie,
  advertise,
  read,
  build: memoBuild,
  bound: memoBound,
  broadcaster: sessionBroadcaster(kindOf, () => "payee", () => refusal("mpp/not-an-opening")),
  reference: memoReference,
  status: svmChannelStatus,
  recover,
  channel: Object.freeze({
    kind: measuring(kindOf),
    ref: measuringAsync(memoRef),
    boundWithin: measuringAsync(notBoundWithin),
    until: (_presented: MppCredential): number | undefined => undefined,
  }),
}) satisfies Entry<typeof MEMO, MppCredential, SvmRef, SvmReader, SessionForms<SolanaSessionChoice, SolanaSessionUnsigned>>;

// ── mpp/session/solana/stock.

/** A stock opening's kind: the opening alone is this pairing's; every later credential is `mpp/session-action`. */
function stockKind(presented: MppCredential): "open" | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  return c.payload["action"] === "open" ? "open" : refusal("mpp/session-action");
}

/** Nothing the payer signs carries H: an opening of the echoed challenge is `mpp/no-signed-place`. */
async function stockBound(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const e = openingOf(credential, STOCK);
  return isRefusal(e) ? e : refusal("mpp/no-signed-place");
}

/**
 * The opening the payer broadcast, as `fetchPresented` read it under `FETCHED` (else `svm/read-first`): its one
 * `open` of the request's payment-channels program (`svm/open-not-found`), whose payer (account 0) funds the deposit
 * and is the account the agreement is held to, never its `authorizedSigner`.
 */
function stockOpening(
  credential: MppCredential,
): { h: AtrHash; checked: Echoed; tx: SvmTx; signature: string; channel: string } | Refusal {
  const e = openingOf(credential, STOCK);
  if (isRefusal(e)) return e;
  const read = fetchedOf(credential);
  const landed = isObject(read) ? read["transaction"] : undefined;
  if (typeof landed !== "string") return refusal("svm/read-first");
  const wire = wireOf(landed);
  if (isRefusal(wire)) return wire;
  const tx = decodeSvmTx(wire);
  if (isRefusal(tx)) return tx;
  const program = typeof e.checked.request["programId"] === "string" ? e.checked.request["programId"] : PAYMENT_CHANNELS_PROGRAM;
  const open = openInstruction(tx, program);
  if (isRefusal(open)) return open;
  return { h: e.h, checked: e.checked, tx, signature: e.payload["signature"] as string, channel: keyString(tx.keys[open.ix.accounts[5]!]!) };
}

/**
 * The named opening's read keys: its transaction, the `open`'s payer (account 0), the account the agreement is held to,
 * the challenge's H, which the opening does not carry, and the payee of `option`; a credential whose echoed challenge
 * is not `option` is `mpp/challenge-not-option`.
 */
async function stockReference(input: unknown, option: MppChallenge): Promise<SvmRef | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const o = stockOpening(credential);
  if (isRefusal(o)) return o;
  const network = networkOf(o.checked.request);
  if (isRefusal(network)) return network;
  const ref = await mppSvmReference(credential.challenge, network, o.tx, o.h, option);
  return isRefusal(ref) ? ref : { ...ref, transaction: o.signature };
}

/**
 * An opening the payer broadcast, with the landed wire read at `finalized` under `FETCHED` as `transaction`; a read
 * that fails, finds nothing or holds the transaction with an error is a refusal (`svm/unreadable`, `svm/not-found`,
 * `svm/err`). Every other credential is returned unchanged.
 */
async function stockFetchPresented(
  credential: MppCredential,
  reader: SvmReader,
): Promise<(MppCredential & { [FETCHED]?: { transaction: string } }) | Refusal> {
  if (!isObject(credential) || carriesRefused(credential) || !isObject(credential.payload)) return refusal("mpp/credential-malformed");
  if (credential.payload["action"] !== "open") return credential;
  const e = openingOf(credential, STOCK);
  if (isRefusal(e)) return e;
  const network = networkOf(e.checked.request);
  if (isRefusal(network)) return network;
  if (!isObject(reader) || reader.network !== network) return refusal("svm/wrong-reader");
  const signature = e.payload["signature"];
  if (!isSignatureText(signature)) return refusal("mpp/credential-malformed");
  let landed: unknown;
  try {
    landed = await reader.transaction(signature, "finalized");
  } catch {
    return refusal("svm/unreadable");
  }
  if (notFoundPoint(landed, "slot") !== undefined) return refusal("svm/not-found");
  if (!isObject(landed)) return refusal("svm/unreadable");
  const wire = landed["wire"];
  if (!(wire instanceof Uint8Array)) return refusal("svm/unreadable");
  if (landed["err"] !== null && landed["err"] !== undefined) return refusal("svm/err");
  return { ...credential, [FETCHED]: { transaction: toBase64(wire) } };
}

/** The stock opening's channel: the `open`'s channel (account 5), read from the opening `fetchPresented` read. */
async function stockRef(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const k = stockKind(presented);
  if (isRefusal(k)) return k;
  const o = stockOpening(presented);
  if (isRefusal(o)) return o;
  const network = networkOf(o.checked.request);
  return isRefusal(network) ? network : { network, channel: o.channel };
}

/**
 * `mpp/session/solana/stock`, at coverage `none`: the buyer's client broadcasts the stock opening, which carries no
 * H, after the agreement is recorded. `broadcaster` answers `"payer"` for the opening; every later credential is
 * `mpp/not-an-opening`. The opening's account is the `open`'s payer (account 0), never its `authorizedSigner`.
 */
export const sessionSolanaStock = Object.freeze({
  id: STOCK,
  data: SOLANA_DATA[STOCK],
  pattern: sessionPattern("mpp/session/hedera-solana-xrpl", false),
  claims: false as const,
  unplaced,
  tie,
  advertise,
  read,
  bound: stockBound,
  broadcaster: sessionBroadcaster(stockKind, () => "payer", () => refusal("mpp/not-an-opening")),
  reference: stockReference,
  status: svmOpeningStatus,
  fetchPresented: stockFetchPresented,
  landedTx: (presented: unknown): string | undefined => {
    const payload = isObject(presented) ? (presented as { payload?: unknown }).payload : undefined;
    if (!isObject(payload)) return undefined;
    const p = payload as { [k: string]: unknown };
    return p["action"] === "open" && isSignatureText(p["signature"]) ? (p["signature"] as string) : undefined;
  },
  channel: Object.freeze({
    kind: measuring(stockKind),
    ref: measuringAsync(stockRef),
    boundWithin: measuringAsync(notBoundWithin),
    until: (_presented: MppCredential): number | undefined => undefined,
  }),
}) satisfies Entry<typeof STOCK, MppCredential, SvmRef, SvmReader, SessionForms<never, never>>;

/**
 * The network and channel a Solana session challenge names for the client to resume. `@solana/mpp` 0.7.0's session
 * request names no channel (`src/Methods.ts:258-301`), so a challenge whose request decodes and whose network reads
 * gives null. Refused for any other challenge.
 */
export function solanaSessionResume(c: MppChallenge): { network: string; channel: string } | null | Refusal {
  if (!isObject(c) || c.intent !== "session" || c.method !== "solana" || typeof c.request !== "string") return refusal("mpp/not-this-pairing");
  const request = decodeObject(c.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const network = solanaNetworkOf(request as { [k: string]: Json }, false);
  return network !== null && typeof network === "object" ? network : null;
}
