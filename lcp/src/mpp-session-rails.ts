/**
 * MPP's `session` intent on XRPL. One ATR covers a whole channel; its hash is bound where the channel opens, in what the
 * payer signs: the `PaymentChannelCreate`'s one LCP memo (H in full). Later requests in the channel are the seller's
 * and are never claimed.
 */
import { fromLcpString, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm-abi.js";
import type { HederaVoucherTypedData } from "./internal/hedera-session.js";
import type { SolanaNetwork } from "./internal/svm.js";
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
import {
  decodeBlob,
  decodePresented,
  networkIdHeld,
  type XrplNetwork,
  type XrplReader,
  type XrplRef,
  type XrplStatus,
  type XrplTxJson,
} from "./internal/xrpl.js";
import {
  chosenFor,
  credentialOf,
  decodeObject,
  deepFreeze,
  echoedFor,
  FETCHED,
  isObject,
  issuedFor,
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
} from "./mpp-challenge.js";
import { xrplNetworkOf } from "./mpp-rail-checks.js";
import { withinChecks, type SessionWithin, type SessionWithinUnsigned, type WithinChallenge } from "./mpp-session.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";
import { XRPL as XRPL_DATA } from "./internal/data/xrpl.js";
import type { Entry } from "./internal/registry.js";

const XRPL = "mpp/session/xrpl" as const;
const MAX_MEMOS = 8;
const HASH256 = /^[0-9A-Fa-f]{64}$/;
const HEX = /^(?:[0-9A-Fa-f]{2})+$/;
const U64 = 1n << 64n;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

type Kind = "open" | "within" | "close";

/**
 * A Solana channel opening with its message's address lookup tables under `FETCHED`. No pairing in this package writes
 * or reads it.
 */
export interface SolanaTablesCredential extends MppCredential {
  [FETCHED]: {
    /**
     * For each address table lookup of the opening's message, in order: the table's address, and the table's entries
     * at the lookup's writable and read-only indexes, in order, each a base58 key. Empty for a message without lookups.
     */
    tables: readonly { address: string; writable: readonly string[]; readonly: readonly string[] }[];
  };
}

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

/**
 * A Hedera escrow channel opening for the payer's signer: two calls broadcast in order, and the zero voucher to sign.
 * No pairing's `build` in this package answers this kind.
 */
export interface HederaSessionUnsigned {
  request: {
    kind: "hedera-session-open";
    chainId: 295 | 296;
    calls: { to: Hex; data: Hex; gas: bigint }[];
    voucher: HederaVoucherTypedData;
  };
  /**
   * The opening's credential for the broadcast transaction's hash and the zero voucher's signature. A credential over
   * the credential size bound, 64 KiB, its echoed challenge included, is `mpp/credential-malformed`, as `bound` refuses
   * it.
   */
  complete(signed: { openTx: Hex; signature: Hex }): MppCredential | Refusal;
}

/**
 * The values a Solana channel client composes the `open` from, and a `complete` that takes the composed open payload.
 * No pairing's `build` in this package answers this kind.
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
    claim: { channelId: string; drops: bigint; bytes: Uint8Array<ArrayBuffer> };
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

function opening(presented: MppCredential, pairing: typeof XRPL) {
  const e = echoedFor(presented, pairing);
  if (isRefusal(e)) return e;
  if (e.payload["action"] !== "open") return refusal("mpp/session-action");
  return e;
}

/**
 * The `methodDetails` of a within or close payment's echoed challenge, read from its request without the opening's
 * checks: the seller issues those challenges itself, with its own id and the channel named.
 */
function echoedDetails(presented: MppCredential, method: "xrpl"): { [k: string]: Json } | Refusal {
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
 * A within challenge as the pairing's `channel.kind`, `channel.ref` and `channel.boundWithin` read the payment that
 * carries it, with their codes: its `methodDetails` (`echoedDetails`), then the network they name, as `channel.ref`
 * reads it.
 */
function withinDetails(
  challenge: WithinChallenge,
  method: "xrpl",
): { details: { [k: string]: Json }; network: string } | Refusal {
  const details = echoedDetails({ challenge, payload: {} }, method);
  if (isRefusal(details)) return details;
  const network = xrplNetworkOf(details);
  return isRefusal(network) ? network : { details, network };
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
function advertise(doc: readonly MppChallenge[], h: AtrHash, link: string, offer: MppChallenge, position: number | null, agreementUrl?: string) {
  return place(doc, h, link, offer, position, agreementUrl);
}

async function notBoundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

// ── mpp/session/xrpl.

function xrplKind(presented: MppCredential): Kind | Refusal {
  return actionKind(presented, ["voucher"]);
}

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
 * carries `Signers` is refused `xrpl/multisigned`), whose `NetworkID` a node of the challenge's network takes, as
 * rippled reads it (`networkIdHeld`, else `xrpl/network-mismatch`), and whose one LCP memo is the echoed challenge's H.
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
  const network = xrplNetworkOf(e.checked.details);
  if (isRefusal(network)) return network;
  if (!networkIdHeld(decoded.tx, network)) return refusal("xrpl/network-mismatch");
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
 * The channel: on `open` its id from the signed blob (`xrplOpeningChannel`), once the opening reads as `bound` reads it
 * (`xrplOpening`), with `bound`'s codes: a single-signed `PaymentChannelCreate` whose `NetworkID` a node of the
 * challenge's network takes (`networkIdHeld`, else `xrpl/network-mismatch`) and whose one LCP memo is the echoed
 * challenge's H (else `xrpl/no-memo`, `xrpl/memo-count` or `mpp/carrier-not-challenge`); on `voucher` and `close` the
 * payload's, in upper case.
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
  const o = await xrplOpening(presented);
  if (isRefusal(o)) return o;
  const network = xrplNetworkOf(o.checked.details);
  if (isRefusal(network)) return network;
  const id = xrplOpeningChannel(o.tx);
  return isRefusal(id) ? id : { network, channel: id };
}

/**
 * `CancelAfter` in Unix seconds when the opening's blob sets one, read from the opening as `channel.ref` reads it: none
 * for a payment that is not an opening, and none for an opening whose echoed challenge `bound` refuses, held as `bound`
 * holds it (`echoedFor`): the credential's shape, H from the echoed challenge's id, the challenge's intent and method,
 * which must be the pairing's, and the pairing's filter.
 */
function xrplUntil(presented: MppCredential): number | undefined {
  if (actionKind(presented, ["voucher"]) !== "open") return undefined;
  const e = echoedFor(presented, XRPL);
  if (isRefusal(e)) return undefined;
  const blob = e.payload["transaction"];
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

/**
 * The read keys of a close, from the issued challenge and the channel: the network and the channel, in upper case. The
 * issued challenge is held as `bound` holds an echoed one (`issuedFor`), with its code for each fault: the challenge's
 * shape and size, its intent and method, which must be the pairing's, and the pairing's filter.
 */
function xrplCloseRef(chosen: MppChallenge, channel: string): Omit<XrplCloseRef, "transaction"> | Refusal {
  const checked = issuedFor(chosen, XRPL);
  if (isRefusal(checked)) return checked;
  const network = xrplNetworkOf(checked.details);
  if (isRefusal(network)) return network;
  return typeof channel === "string" && HASH256.test(channel)
    ? { phase: "close", network, channel: channel.toUpperCase() }
    : refusal("mpp/credential-malformed");
}

/**
 * The `PaymentChannelCreate` for the wallet to sign, with one LCP memo carrying H and no `NetworkID` (each network the
 * challenge can name has an id of at most 1024), and the first claim's bytes on the resulting channel. `complete` checks
 * the signed blob as `bound` does before returning the credential, in `bound`'s order: `bound`'s read of the opening
 * (`xrplOpening`), the credential's size, the blob's type (`xrpl/blob-malformed`) and its `NetworkID` among the checks;
 * then the claim signature, which `bound` does not read: hex, else `mpp/credential-malformed`.
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
  const challenge = checked.challenge;
  const source = `did:pkh:xrpl:${network.slice("xrpl:".length)}:${choice.from}`;
  const amount = checked.request["amount"] as string;
  return {
    request: { kind: "xrpl-session-open", txJson, claim: { channelId, drops, bytes: claimBytes } },
    async complete(signed: { signedBlob: string; claimSignature: string }): Promise<MppCredential | Refusal> {
      if (!isObject(signed)) return refusal("mpp/credential-malformed");
      const credential: MppCredential = {
        challenge,
        source,
        payload: { action: "open", transaction: signed.signedBlob, amount, signature: signed.claimSignature },
      };
      const o = await xrplOpening(credential);
      if (isRefusal(o)) return o;
      return typeof signed.claimSignature === "string" && HEX.test(signed.claimSignature) ? credential : refusal("mpp/credential-malformed");
    },
  };
}

/**
 * A claim, or a close's final claim, on the channel the held opening created: one `xrpl-claim` request over
 * `xrplClaim(channelId, drops)`, for the channel's key, with the channel id derived from the opening's signed blob
 * (`xrplOpeningChannel`). draft-xrpl-session-00 defines no other action within a channel: any other, such as `topUp`,
 * is `mpp/session-action`.
 */
async function xrplBuildWithin(w: SessionWithin, h: AtrHash): Promise<SessionWithinUnsigned | Refusal> {
  const held = await withinChecks(w, h, "session/xrpl", (c) => withinDetails(c, "xrpl"), (p) => xrplOpening(p), U64, []);
  if (isRefusal(held)) return held;
  const o = held.opening;
  const channelId = xrplOpeningChannel(o.tx);
  if (isRefusal(channelId)) return channelId;
  const drops = w.cumulativeAmount;
  const bytes = xrplClaim(channelId, drops);
  if (isRefusal(bytes)) return bytes;
  const challenge = held.challenge;
  const { action } = w;
  return {
    requests: [{ kind: "xrpl-claim", channelId, drops, bytes }],
    complete(signatures: readonly string[]): MppCredential | Refusal {
      const signature = Array.isArray(signatures) && signatures.length === 1 ? signatures[0] : undefined;
      if (typeof signature !== "string" || !HEX.test(signature)) return refusal("mpp/credential-malformed");
      return measured({ challenge, payload: { action, channelId, amount: drops.toString(), signature } });
    },
  };
}

// ── Resume.

/**
 * The network and channel an XRPL session challenge names for the client to resume, spelled as the pairing's
 * `channel.ref` spells it: the request's `channelId`, 64 hex characters, upper case. Null when the challenge names no
 * channel: the member absent, or `""`. Refused for any other challenge, or a channel or network that cannot be read.
 */
export function railSessionResume(c: MppChallenge): { network: string; channel: string } | null | Refusal {
  if (!isObject(c) || c.intent !== "session" || typeof c.request !== "string") return refusal("mpp/not-this-pairing");
  if (c.method !== "xrpl") return refusal("mpp/not-this-pairing");
  const request = decodeObject(c.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const md = request["methodDetails"];
  if (md !== undefined && !isObject(md)) return refusal("mpp/request-malformed");
  const details = (md ?? {}) as { [k: string]: Json };
  const named = request["channelId"];
  if (named === undefined || named === "") return null;
  if (typeof named !== "string" || !HASH256.test(named)) return refusal("mpp/request-malformed");
  const network = xrplNetworkOf(details);
  return isRefusal(network) ? network : { network, channel: named.toUpperCase() };
}

// ── The records.

function sessionPattern(p: Pick<LcpPattern, "pattern" | "zeroPartyRecoverable">, profile: string): LcpPattern {
  return deepFreeze({
    ...p,
    profile,
    onChain: true,
    forwardIndexable: false,
  });
}

/**
 * `mpp/session/xrpl`. The payee broadcasts every payment the session takes (`broadcaster` answers `"payee"` for the
 * actions `channel.kind` takes: the opening, a voucher and the close): the seller's server submits the signed
 * `PaymentChannelCreate` the opening carries, which `status` reads, redeems claims when it closes, and sends the close,
 * which `closeRef` and `status` read. Any other action, a top-up among them, gets `mpp/session-action`, as `bound`
 * refuses it.
 */
export const sessionXrpl = Object.freeze({
  id: XRPL,
  data: XRPL_DATA[XRPL],
  pattern: sessionPattern(
    {
      pattern: "native-field",
      zeroPartyRecoverable: true,
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
  broadcaster: sessionBroadcaster(xrplKind, () => "payee", () => refusal("mpp/session-action")),
  reference: xrplReference,
  status: xrplStatusOf,
  recover: xrplRecover,
  closeRef: xrplCloseRef,
  channel: Object.freeze({
    kind: measuring((p: MppCredential) => xrplKind(p)),
    ref: measuringAsync(xrplRef),
    boundWithin: measuringAsync(notBoundWithin),
    until: xrplUntil,
  }),
}) satisfies Entry<typeof XRPL, MppCredential, Omit<XrplRef, "expect"> | XrplCloseRef, XrplReader>;
