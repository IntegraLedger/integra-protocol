/**
 * The Tempo split-memo charge (profile `mpp/charge/tempo/split-memo`): `mpp/charge/tempo/split-memo`, the pull form,
 * whose signed transaction the resource server's settler broadcasts, and `mpp/charge/tempo/split-memo/push`, whose
 * transaction the payer broadcasts and names by its hash. H rides as the memo of a one-unit split the resource server
 * places in the challenge (`placeSplit`), which the stock client copies into a `transferWithMemo` call of the
 * transaction the payer signs. lcp builds nothing for this form: the payer's own client builds it.
 */
import type { AtrHash, Json } from "./core.js";
import { addressWord, bytesOf, hexOf, keccakHex, sameBytes, uintOf, type Hex } from "./evm-abi.js";
import type { EvmLog, EvmReceipt } from "./evm.js";
import { isAddress, normalHash } from "./fields.js";
import {
  byType,
  credentialOf,
  decodeObject,
  didPkhAddress,
  echoedFor,
  FETCHED,
  isObject,
  mppBroadcaster,
  pairingsOf,
  placeSplit,
  pushedField,
  read,
  requestAddress,
  tie,
  unplacedChallenge,
  type Echoed,
  type MppChallenge,
  type MppCredential,
  type MppForms,
  type MppPairingId,
} from "./mpp-challenge.js";
import { readReceiptAtMark } from "./receipt.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { decodeTempoTx, expiringNonceHash, RECEIVE_POLICY_GUARD, TRANSFER_WITH_MEMO_SELECTOR, TRANSFER_WITH_MEMO_TOPIC } from "./tempo.js";
import { EIP155_TEMPO_MPP } from "./internal/data/eip155-tempo-mpp.js";
import { ReaderError, rejected, TRANSFER_TOPIC, type EvmMark, type EvmQuery } from "./internal/evm.js";
import { decide, type Act, type Facts, type Moved, type Seen, type StatusAnswer, type Undecoded, type UnreadableReason } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";
import { deepFreeze } from "./mpp-challenge.js";
import type { LcpPattern } from "./x402.js";
import { decodeEnvelope, tempoSender } from "./internal/tempo-envelope.js";
import { echoesOption } from "./internal/mpp-evm-read.js";
import { search } from "./internal/evm-x402.js";
import {
  consumerOf,
  heldTransferOf,
  readValue,
  sameValue,
  takesProtocolNonce,
  tempoValueOf,
  TRANSFER_BLOCKED_TOPIC,
  type Head,
  type TempoSearchReader,
  type TempoValue,
} from "./internal/tempo-nonce.js";
import { rlpUint } from "./rlp.js";

const PULL = "mpp/charge/tempo/split-memo" as const;
const PUSH = "mpp/charge/tempo/split-memo/push" as const;
type SplitId = typeof PULL | typeof PUSH;

/** `transfer(address,uint256)`. */
const TRANSFER_SELECTOR = "0xa9059cbb";
/** Envelope positions of the nonce key and the nonce. */
const NONCE_KEY = 6;
const NONCE = 7;
/**
 * The read keys of a split-memo payment: the network, the payer (the transaction's sender), the option's payee (the
 * request's `recipient`), the token the split names (`currency`), H, the signed `validBefore` in decimal Unix seconds
 * (absent where the transaction signs none), the transaction's own nonce, its key and value in decimal, and the payment
 * presented: `signed`, the hash over the fields the sender signed, in the `0x76` form whatever envelope carried them,
 * as `expiringNonceHash` computes it; on push also `named`, the transaction the credential names.
 */
export interface TempoSplitRef {
  network: `eip155:${number}`;
  payer: Hex;
  payee: Hex;
  currency: Hex;
  h: Hex;
  validBefore?: string;
  nonce: { key: string; value: string };
  signed: Hex;
  named?: Hex;
}

/** What the caller adds to the reference: the act's own transaction where it knows it, on pull the one it broadcast. */
export interface TempoSplitLanded {
  transaction?: Hex;
}

/** What `status` takes beside the reference and the reader: its search position is a block number. */
export type TempoSplitQuery = EvmQuery<TempoSplitRef>;

/** What `status` answers: block numbers, EVM marks, the search position a block number. */
export type TempoSplitStatus = StatusAnswer<bigint, EvmMark>;

/** A push credential with the named transaction's receipt and signed bytes under `FETCHED`. */
export interface TempoLandedCredential extends MppCredential {
  [FETCHED]: { transaction: Hex; blockNumber: bigint; logs: readonly EvmLog[]; raw: Hex };
}

// ── What the payer signed.

/** A signed Tempo transaction as the codec reads it: its sender, H's call, its nonce, its window and its signed hash. */
interface SignedSplit {
  sender: Hex;
  chainId: bigint;
  nonce: { key: bigint; value: bigint };
  validBefore: bigint | null;
  signed: Hex;
}

/**
 * The signed transaction `wire` read for H: at most 65,536 bytes of a `0x76` or `0x78` envelope (`tempo/tx-too-large`,
 * `tempo/tx-malformed`), signed for `chainId` (else `tempo/tx-malformed`), whose sender Tempo recovers from the `0x76`
 * form, a `0x78` envelope naming that sender in item 11; and exactly one `transferWithMemo` call to `currency` whose
 * memo is `h`: none is `tempo/memo-not-bound`, several `tempo/ambiguous`. Nothing it pays is compared with the request.
 */
function signedSplit(wire: Uint8Array, chainId: number, currency: Hex, h: Hex): SignedSplit | Refusal {
  const tx = decodeTempoTx(wire);
  if (isRefusal(tx)) return tx;
  if (tx.chainId !== BigInt(chainId)) return refusal("tempo/tx-malformed");
  const sender = tempoSender(wire);
  if (isRefusal(sender)) return sender;
  const calls = tx.calls.filter(
    (c) => c.to !== null && sameBytes(c.to, currency) && memoOf(c.input) !== undefined && sameBytes(memoOf(c.input), h),
  );
  if (calls.length === 0) return refusal("tempo/memo-not-bound");
  if (calls.length > 1) return refusal("tempo/ambiguous");
  const items = decodeEnvelope(wire) as Exclude<ReturnType<typeof decodeEnvelope>, Refusal>;
  const signed = expiringNonceHash(wire, sender);
  if (isRefusal(signed)) return signed;
  return {
    sender: sender.toLowerCase() as Hex,
    chainId: tx.chainId,
    nonce: { key: rlpUint(items[NONCE_KEY])!, value: rlpUint(items[NONCE])! },
    validBefore: tx.validBefore,
    signed,
  };
}

/** The memo of `transferWithMemo(address,uint256,bytes32)` calldata, or undefined for any other input. */
function memoOf(input: Uint8Array): Hex | undefined {
  if (input.length !== 100 || hexOf(input.subarray(0, 4)) !== TRANSFER_WITH_MEMO_SELECTOR) return undefined;
  if (input.subarray(4, 16).some((x) => x !== 0)) return undefined;
  return hexOf(input.subarray(68, 100));
}

/** The echoed challenge's chain, `methodDetails.chainId`, which the pairings' filter requires. */
function chainOf(e: Echoed): number {
  return e.details["chainId"] as number;
}

/**
 * The echoed challenge of a credential for `pairing`, held to its filter (`echoedFor`). On push the challenge may also
 * be one that names pull alone, held to the pull form's filter: a payment that already moved under it is the push
 * form's (profile `mpp/charge/tempo/split-memo`, rule 3).
 */
function echoedSplit(presented: unknown, pairing: SplitId): ReturnType<typeof echoedFor> {
  const e = echoedFor(presented, pairing);
  if (pairing === PUSH && isRefusal(e) && e.code === "mpp/not-this-pairing") {
    const pull = echoedFor(presented, PULL);
    if (!isRefusal(pull)) return pull;
  }
  return e;
}

/** A `source` the credential carries names `sender`; one that names another account is `tempo/source-not-sender`. */
function sourceNames(presented: MppCredential, sender: Hex): Refusal | undefined {
  if (presented.source === undefined) return undefined;
  const named = didPkhAddress(presented.source);
  return named !== undefined && sameBytes(named, sender) ? undefined : refusal("tempo/source-not-sender");
}

/** The pull credential read: H, the echoed challenge and the signed transaction it carries. */
function pullRead(input: unknown): { h: AtrHash; checked: Echoed; split: SignedSplit } | Refusal {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const e = echoedSplit(presented, PULL);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "transaction") return refusal("mpp/credential-type");
  const currency = requestAddress(e.checked, "currency");
  if (isRefusal(currency)) return currency;
  const wire = bytesOf(e.payload["signature"]);
  if (wire === undefined || wire.length === 0) return refusal("mpp/credential-malformed");
  const split = signedSplit(wire, chainOf(e.checked), currency, normalHash(e.h)!);
  if (isRefusal(split)) return split;
  const named = sourceNames(presented, split.sender);
  return named ?? { h: e.h, checked: e.checked, split };
}

/**
 * The push credential read: H, the echoed challenge, the named transaction and its signed bytes as `fetchPresented`
 * wrote them under `FETCHED`. A credential without them is `tempo/read-first`.
 */
function pushRead(input: unknown): { h: AtrHash; checked: Echoed; split: SignedSplit; transaction: Hex } | Refusal {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const e = echoedSplit(presented, PUSH);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "hash") return refusal("mpp/credential-type");
  const landed = (presented as Partial<TempoLandedCredential>)[FETCHED];
  const hash = normalHash(e.payload["hash"]);
  if (!isObject(landed) || typeof landed["raw"] !== "string" || hash === null || landed["transaction"] !== hash) {
    return refusal("tempo/read-first");
  }
  const currency = requestAddress(e.checked, "currency");
  if (isRefusal(currency)) return currency;
  const wire = bytesOf(landed["raw"]);
  if (wire === undefined) return refusal("tempo/read-first");
  const split = signedSplit(wire, chainOf(e.checked), currency, normalHash(e.h)!);
  if (isRefusal(split)) return split;
  const named = sourceNames(presented, split.sender);
  return named ?? { h: e.h, checked: e.checked, split, transaction: hash as Hex };
}

async function pullBound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = pullRead(presented);
  return isRefusal(r) ? r : r.h;
}

async function pushBound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = pushRead(presented);
  return isRefusal(r) ? r : r.h;
}

/**
 * The read keys (`TempoSplitRef`) of what was presented, with the payee of `option`, the issued challenge the payment
 * answers: its request's `recipient`. An option that is not the echoed challenge, by its `id` and the members fixed at
 * issue (`echoesOption`), is `mpp/challenge-not-option`; its refusal comes after the payment's.
 */
async function referenceOf(
  r: { checked: Echoed; split: SignedSplit; transaction?: Hex; h: AtrHash } | Refusal,
  option: MppChallenge,
): Promise<TempoSplitRef | Refusal> {
  if (isRefusal(r)) return r;
  const held = await echoesOption(r.checked.challenge, option);
  if (held !== true) return held;
  const payee = requestAddress(r.checked, "recipient");
  const currency = requestAddress(r.checked, "currency");
  if (isRefusal(payee)) return payee;
  if (isRefusal(currency)) return currency;
  const { split } = r;
  return {
    network: `eip155:${chainOf(r.checked)}`,
    payer: split.sender,
    payee: payee.toLowerCase() as Hex,
    currency: currency.toLowerCase() as Hex,
    h: normalHash(r.h)! as Hex,
    ...(split.validBefore === null ? {} : { validBefore: split.validBefore.toString() }),
    nonce: { key: split.nonce.key.toString(), value: split.nonce.value.toString() },
    signed: split.signed,
    ...(r.transaction === undefined ? {} : { named: r.transaction }),
  };
}

/**
 * Reads the pushed transaction's receipt and its signed bytes and returns the credential with them under `FETCHED`.
 * The credential's payload `type` must be `hash` (`mpp/credential-type`) with a 32-byte hash (`mpp/credential-malformed`),
 * under a challenge the push form takes (`echoedSplit`). No receipt, or no signed bytes, is `tempo/not-found`, a reader
 * that throws or answers ill-formed `tempo/unreadable`: reads to repeat, not a refusal of the payment. A revert at or
 * below the reader's `finalized` mark is `tempo/reverted`, above it `tempo/not-final`. A reader for another network is
 * `tempo/wrong-reader`. At most three calls.
 */
async function pushFetchPresented(presented: unknown, reader: TempoSearchReader): Promise<TempoLandedCredential | Refusal> {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  if (c.payload["type"] !== "hash") return refusal("mpp/credential-type");
  const hash = normalHash(c.payload["hash"]);
  if (hash === null) return refusal("mpp/credential-malformed");
  const e = echoedSplit(c, PUSH);
  if (isRefusal(e)) return e;
  const receipt = await readReceiptAtMark(`eip155:${chainOf(e.checked)}`, hash as Hex, reader);
  if (isRefusal(receipt)) return receipt;
  let raw: Hex | null;
  try {
    raw = await reader.raw(hash as Hex);
  } catch {
    return refusal("tempo/unreadable");
  }
  if (raw === null) return refusal("tempo/not-found");
  const wire = bytesOf(raw);
  if (wire === undefined || !sameBytes(keccakHex(wire), hash)) return refusal("tempo/unreadable");
  const { [FETCHED]: _, ...rest } = c as MppCredential & { [FETCHED]?: unknown };
  return { ...rest, [FETCHED]: { transaction: hash as Hex, blockNumber: receipt.blockNumber, logs: receipt.logs, raw } };
}

/**
 * `advertise` for `pairing`: the offer must name it (`pairingsOf`, else `mpp/not-this-pairing`), and on pull name
 * `supportedModes: ["pull"]` (else `mpp/modes-not-pull`); every offer names `feePayer`, `true` or `false` (else
 * `mpp/fee-payer-unnamed`): the challenge as issued, which the ATR's binding slot holds, fixes who pays the fee, the
 * payer signing with the fee payer's slot open. Then `placeSplit` at the challenge's position.
 */
function advertiseAs(pairing: SplitId) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    position: number | null,
    act?: Act,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const pairings = pairingsOf(offer);
    if (isRefusal(pairings)) return pairings;
    if (!pairings.includes(pairing as MppPairingId) || position === null) return refusal("mpp/not-this-pairing");
    const details = detailsOf(offer);
    if (typeof details["feePayer"] !== "boolean") return refusal("mpp/fee-payer-unnamed");
    const modes = details["supportedModes"];
    if (pairing === PULL && !(Array.isArray(modes) && modes.length === 1 && modes[0] === "pull")) {
      return refusal("mpp/modes-not-pull");
    }
    return placeSplit(doc, h, link, offer, position, act, agreementUrl);
  };
}

function detailsOf(offer: MppChallenge): { [k: string]: Json } {
  const md = decodeObject(offer.request)?.["methodDetails"];
  return isObject(md) ? (md as { [k: string]: Json }) : {};
}

// ── The read.

/**
 * Whether a landed transaction is the payment presented (`read-status`, `presented`): `yes` where the fields
 * its sender signed, hashed as `expiringNonceHash` hashes them, equal the presented transaction's (on push, where it is
 * the transaction the credential names), `no` where they differ, and `unshown` where its signed bytes could not be read.
 */
export function presentedOf(ref: TempoSplitRef, landed: { transaction: Hex; signed: Hex | undefined }): "yes" | "no" | "unshown" {
  if (ref.named !== undefined) return sameBytes(landed.transaction, ref.named) ? "yes" : "no";
  if (landed.signed === undefined) return "unshown";
  return sameBytes(landed.signed, ref.signed) ? "yes" : "no";
}

function isRef(r: unknown): r is TempoSplitRef & TempoSplitLanded {
  if (!isObject(r)) return false;
  const nonce = r["nonce"];
  return (
    typeof r["network"] === "string" &&
    /^eip155:[1-9][0-9]*$/.test(r["network"]) &&
    isAddress(r["payer"]) &&
    isAddress(r["payee"]) &&
    isAddress(r["currency"]) &&
    normalHash(r["h"]) !== null &&
    normalHash(r["signed"]) !== null &&
    (r["validBefore"] === undefined || (typeof r["validBefore"] === "string" && /^[0-9]{1,20}$/.test(r["validBefore"]))) &&
    isObject(nonce) &&
    typeof nonce["key"] === "string" &&
    /^[0-9]{1,78}$/.test(nonce["key"]) &&
    typeof nonce["value"] === "string" &&
    /^[0-9]{1,78}$/.test(nonce["value"]) &&
    (r["named"] === undefined || normalHash(r["named"]) !== null) &&
    (r["transaction"] === undefined || normalHash(r["transaction"]) !== null)
  );
}

const isBlock = (v: unknown): v is bigint => typeof v === "bigint" && v >= 0n;

/**
 * The `status` of both forms (profile `mpp/charge/tempo/split-memo`, rules 9 to 15; `read-status`), at the one mark
 * `finalized`: a query asking any other finality is `unreadable`, `unparseable`.
 *
 * The value: the transaction's nonce, read by its nonce key (`readValue`) at the `finalized` block and at the latest,
 * each at the last block below the signed `validBefore` where the head is at or past it. On pull the reference holds
 * it; on push it is read from the signed bytes the endpoint returns for the named transaction
 * (`eth_getRawTransactionByHash`), which must hash to that name (else `unparseable`), and where the endpoint returns
 * none the read holds no value.
 *
 * The search for H reads, from the caller's search position, else the position it must come after, else block 0, to the
 * latest head, in pages of at most 10,000 blocks halved for a range the endpoint refuses (a range refused at one block
 * answering `transport`), at most 8 pages a call (`search`): every contract's `TransferWithMemo` logs with the payer as sender and H
 * as memo, and the receive-policy guard's `TransferBlocked` logs, each receipt decoded (`heldTransferOf`) and kept where
 * its originator is the payer and its memo H, one that does not decode holding the search at its block. Each transaction
 * found, the act's own where the caller gives it or the credential names it, and, where the value reads consumed and no
 * transaction read takes it, the one found in the first block it reads consumed at (`consumerOf`, a read there that
 * fails being unreadable by its reason, `history-gap` where the reader names none), is read whole: an
 * item whose receipt or signed bytes the reader does not hold, or that does not decode, is named among the undecoded
 * items. Each is classed against the reference: its sender against the payer and the payee; whether it carries H (a
 * succeeded one by a `TransferWithMemo` from the payer with memo H or a guard receipt naming the payer and H, a failed
 * one by a call whose memo is H); the transfers it made from the payer, each by its `Transfer` log with its token,
 * recipient, amount and the log's place, a held transfer recorded as moved to the guard; the account it names (a failed
 * one's by the recipients of the transfers it signed, since it moved nothing); whether it took the act's value; whether
 * it is the payment presented; whether it is an act the caller gave by its reference. A transaction of another type than
 * Tempo's is of another kind. The answer is `decide`'s.
 */
async function splitStatus(
  ref: TempoSplitRef & TempoSplitLanded,
  reader: TempoSearchReader,
  query: TempoSplitQuery,
): Promise<TempoSplitStatus> {
  return decide(await splitFacts(ref, reader, query), query, LEDGER);
}

const MARKS: readonly EvmMark[] = ["latest", "safe", "finalized"];
const LEDGER = {
  coverage: "full" as const,
  final: "finalized" as EvmMark,
  markOrder: (a: EvmMark, b: EvmMark) => MARKS.indexOf(a) - MARKS.indexOf(b),
  positionOrder: (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0),
};

const isHead = (h: unknown): h is Head => isObject(h) && isBlock(h["number"]) && isBlock(h["timestamp"]);

async function splitFacts(
  ref: TempoSplitRef & TempoSplitLanded,
  reader: TempoSearchReader,
  query: TempoSplitQuery,
): Promise<Facts<bigint, EvmMark>> {
  const nothing = (unreadable: UnreadableReason): Facts<bigint, EvmMark> => ({
    unreadable,
    seen: [],
    search: { whole: false },
    history: false,
  });
  if (!isRef(ref) || !isObject(query) || (query.after !== undefined && !isBlock(query.after))) return nothing("unparseable");
  if (query.search !== undefined && !isBlock(query.search)) return nothing("unparseable");
  if (query.finality !== "finalized") return nothing("unparseable");
  if (!isObject(reader)) return nothing("transport");
  if (reader.network !== ref.network) return nothing("chain-mismatch");
  try {
    const final = await reader.block("finalized");
    const latest = await reader.block("latest");
    if (!isHead(final) || !isHead(latest)) return nothing("unparseable");
    const lo = query.after ?? 0n;
    const start = query.search ?? lo;
    let history = true;
    try {
      await reader.block(start < latest.number ? start : latest.number);
    } catch {
      history = false;
    }
    // The value.
    let v: TempoValue | undefined;
    if (ref.named !== undefined) {
      const raw = await reader.raw(ref.named);
      if (raw !== null) {
        const wire = bytesOf(raw);
        if (wire === undefined || !sameBytes(keccakHex(wire), ref.named)) return nothing("unparseable");
        v = tempoValueOf(wire);
        if (v === undefined) return nothing("unparseable");
      }
    } else {
      v = {
        sender: ref.payer,
        key: BigInt(ref.nonce.key),
        nonce: BigInt(ref.nonce.value),
        signed: ref.signed,
        validBefore: ref.validBefore === undefined ? null : BigInt(ref.validBefore),
      };
    }
    // A value read below the latest head needs the endpoint to hold that block's state, which a header it serves does
    // not show: a failed read there answers history-gap, unless the reader names the failure another reason.
    let read: Awaited<ReturnType<typeof readValue>> | undefined;
    try {
      read = v === undefined ? undefined : await readValue(v, reader, final, latest, lo);
    } catch (e) {
      if (!history || (!(e instanceof ReaderError) && final.number < latest.number)) return nothing("history-gap");
      throw e;
    }
    // The search, in the pages the EVM reads share (`search`): a page halved only for a range the endpoint refuses.
    const h = normalHash(ref.h)! as Hex;
    const memoTopics = [TRANSFER_WITH_MEMO_TOPIC, hexOf(addressWord(ref.payer)), null, h] as const;
    const hits: { transaction: Hex; block: bigint }[] = [];
    const undecoded: Undecoded<bigint>[] = [];
    const hit = (tx: Hex, block: bigint): void => {
      if (!hits.some((x) => sameBytes(x.transaction, tx))) hits.push({ transaction: tx, block });
    };
    const found = await search(reader, [{ topics: memoTopics }, { address: RECEIVE_POLICY_GUARD, topics: [TRANSFER_BLOCKED_TOPIC] }], start, latest.number);
    if ("unreadable" in found) return nothing(found.unreadable);
    for (const l of found.entries) {
      const tx = normalHash(l.transactionHash)!;
      if (sameBytes(l.topics[0], TRANSFER_WITH_MEMO_TOPIC)) {
        hit(tx as Hex, l.blockNumber);
        continue;
      }
      const r = heldTransferOf(l.data);
      if (r === undefined) {
        if (!undecoded.some((u) => sameBytes(u.transaction, tx))) undecoded.push({ transaction: tx, at: l.blockNumber });
      } else if (sameBytes(r.originator, ref.payer) && sameBytes(r.memo, h)) hit(tx as Hex, l.blockNumber);
    }
    const whole = found.whole;
    const from = found.at;
    hits.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
    // The act's own transaction, where the caller gives it or the credential names it, read whether or not it was found.
    const own = [ref.named, ref.transaction].flatMap((t) => (t === undefined ? [] : [normalHash(t)! as Hex]));
    const reads = hits.map((x) => ({ transaction: x.transaction, at: x.block as bigint | undefined }));
    for (const t of own) if (!reads.some((x) => sameBytes(x.transaction, t))) reads.push({ transaction: t, at: undefined });
    const seen: Seen<bigint, EvmMark>[] = [];
    const readOne = async (item: { transaction: Hex; at: bigint | undefined }): Promise<void> => {
      if (seen.some((s) => sameBytes(s.transaction, item.transaction))) return;
      const r = await readWhole(ref, v, reader, query, item.transaction, final.number);
      if (r !== undefined) seen.push(r);
      else if (item.at !== undefined && !undecoded.some((u) => sameBytes(u.transaction, item.transaction))) {
        undecoded.push({ transaction: item.transaction, at: item.at });
      }
    };
    for (const item of reads) await readOne(item);
    // The transaction that consumed the value, where none read takes it.
    if (v !== undefined && read?.consumedAt !== undefined && !seen.some((s) => s.consumed)) {
      // A read of a block's state or transactions that fails is unreadable by its reason (`consumerOf`).
      const c = await consumerOf(v, reader, lo, read.consumedAt);
      if (typeof c === "object") return nothing(c.unreadable);
      if (c !== undefined) await readOne({ transaction: c, at: undefined });
    }
    undecoded.sort((a, b) => (a.at! < b.at! ? -1 : a.at! > b.at! ? 1 : 0));
    return {
      seen,
      ...(read === undefined ? {} : { value: read.value }),
      search: whole || from === undefined ? { whole } : { whole: false, at: from },
      ...(undecoded.length === 0 ? {} : { undecoded }),
      history,
    };
  } catch (e) {
    return nothing(rejected(e));
  }
}

/** The recipient of a `transfer` or `transferWithMemo` call, or undefined for any other input. */
function recipientOf(input: Uint8Array): Hex | undefined {
  const selector = input.length >= 4 ? hexOf(input.subarray(0, 4)) : undefined;
  const ok = (selector === TRANSFER_SELECTOR && input.length === 68) || (selector === TRANSFER_WITH_MEMO_SELECTOR && input.length === 100);
  if (!ok || input.subarray(4, 16).some((x) => x !== 0)) return undefined;
  return hexOf(input.subarray(16, 36));
}

/** One transaction read whole and classed against the reference, or undefined where the reader cannot show it whole. */
async function readWhole(
  ref: TempoSplitRef,
  v: TempoValue | undefined,
  reader: TempoSearchReader,
  query: TempoSplitQuery,
  transaction: Hex,
  finalHead: bigint,
): Promise<Seen<bigint, EvmMark> | undefined> {
  const receipt: EvmReceipt | null = await reader.receipt(transaction);
  const raw = await reader.raw(transaction);
  const wire = raw === null ? undefined : bytesOf(raw);
  if (receipt === null || (raw !== null && (wire === undefined || wire.length === 0)) || !isBlock(receipt.blockNumber) || !Array.isArray(receipt.logs)) {
    return undefined;
  }
  const moved = movedFrom(receipt.logs, ref.payer, transaction);
  if (moved === undefined) return undefined;
  const succeeded = receipt.status === 1;
  const heldH = (l: EvmLog): boolean => {
    if (!sameBytes(l.address, RECEIVE_POLICY_GUARD) || !sameBytes(l.topics[0], TRANSFER_BLOCKED_TOPIC)) return false;
    const r = heldTransferOf(l.data);
    return r !== undefined && sameBytes(r.originator, ref.payer) && sameBytes(r.memo, ref.h);
  };
  const loggedH = receipt.logs.some(
    (l) => (sameBytes(l.topics[0], TRANSFER_WITH_MEMO_TOPIC) && sameBytes(l.topics[3], ref.h) && sameBytes(l.topics[1], hexOf(addressWord(ref.payer)))) || heldH(l),
  );
  // A transaction whose signed bytes the node does not hold is read by its receipt and its sender, what it signed unshown.
  const tempo = wire === undefined || wire[0] === 0x76 || wire[0] === 0x78;
  let sender: Hex;
  let calls: readonly { input: Uint8Array }[] = [];
  let value: TempoValue | undefined;
  if (tempo && wire !== undefined) {
    const tx = decodeTempoTx(wire);
    value = tempoValueOf(wire);
    if (isRefusal(tx) || value === undefined) return undefined;
    sender = value.sender;
    calls = tx.calls;
  } else {
    // Another type than Tempo's, an act of another kind, or one whose bytes the node does not hold: its sender as the
    // node reads it.
    const t = await reader.transaction(transaction);
    if (t === null || !isAddress(t.from)) return undefined;
    sender = t.from.toLowerCase() as Hex;
  }
  const party = sameBytes(sender, ref.payee) ? "payee" : sameBytes(sender, ref.payer) ? "payer" : "other";
  const carries = succeeded ? loggedH : calls.some((c) => memoOf(c.input) !== undefined && sameBytes(memoOf(c.input), ref.h));
  // The account it names: what moved where it succeeded, the recipients of the transfers it signed where it failed.
  const named = succeeded ? moved.map((m) => m.to) : calls.flatMap((c) => (recipientOf(c.input) === undefined ? [] : [recipientOf(c.input)!]));
  const account = named.length === 0 ? "none" : named.some((to) => sameBytes(to, ref.payee)) ? "payee" : "other";
  const consumed =
    v !== undefined
      ? value !== undefined
        ? sameValue(v, value)
        : !tempo && wire !== undefined && (await takesProtocolNonce(v, wire, transaction, reader))
      : ref.named !== undefined && sameBytes(transaction, ref.named);
  const presented = presentedOf(ref, { transaction, signed: value?.signed });
  const given = (query.others ?? []).some(
    (o) =>
      "ref" in o &&
      isObject(o.ref) &&
      ((value !== undefined && sameBytes(o.ref.signed, value.signed)) || (o.ref.named !== undefined && sameBytes(o.ref.named, transaction))),
  );
  return {
    transaction,
    position: receipt.blockNumber,
    mark: receipt.blockNumber <= finalHead ? "finalized" : "latest",
    result: succeeded ? "succeeded" : "failed",
    consumed,
    carries,
    party,
    kind: tempo ? "same" : "other",
    account,
    ...(given ? { given } : {}),
    presented,
    moved,
    signer: sender,
  };
}

/**
 * Every token transfer from `payer` the receipt shows, each by its `Transfer(from, to, value)` log: its token (the log's
 * address), its recipient, its amount in decimal, the transaction and the log's place among the receipt's logs. A
 * `Transfer` log from the payer that is not of the event's form leaves the transaction unread (undefined).
 */
export function movedFrom(logs: readonly EvmLog[], payer: Hex, transaction: Hex): Moved[] | undefined {
  const out: Moved[] = [];
  for (const [place, l] of logs.entries()) {
    if (!isObject(l) || !Array.isArray(l.topics) || !sameBytes(l.topics[0], TRANSFER_TOPIC)) continue;
    if (!sameBytes(l.topics[1], hexOf(addressWord(payer)))) continue;
    const to = bytesOf(l.topics[2]);
    const data = bytesOf(l.data);
    if (l.topics.length !== 3 || to === undefined || to.length !== 32 || data === undefined || data.length !== 32) return undefined;
    out.push({
      asset: String(l.address).toLowerCase(),
      to: hexOf(to.subarray(12)),
      amount: uintOf(data).toString(),
      transaction,
      place,
    });
  }
  return out;
}

// ── The records.

/** The record's pattern: H is a field the payer signs, written by the stock client from the challenge. */
const PATTERN: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: "mpp/charge/tempo/split-memo",
  onChain: true,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/**
 * The challenge as issued: without the split that carries H (`unplacedChallenge`). A challenge that carries a `refused`
 * member is `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return unplacedChallenge(option);
}

/**
 * `mpp/charge/tempo/split-memo`, the pull form. The payee broadcasts (`broadcaster` answers `"payee"` for a credential
 * of `type` `transaction`): the resource server's settler broadcasts the signed transaction the credential carries. A
 * credential of any other type gets `mpp/credential-type`, as `bound` refuses it.
 */
export const tempoSplitMemo = Object.freeze({
  id: PULL,
  data: EIP155_TEMPO_MPP[PULL],
  pattern: PATTERN,
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(PULL),
  read,
  bound: pullBound,
  broadcaster: mppBroadcaster(byType({ transaction: "payee" })),
  reference: (presented: unknown, option: MppChallenge) => referenceOf(pullRead(presented), option),
  status: splitStatus,
}) satisfies Entry<
  typeof PULL,
  MppCredential,
  TempoSplitRef,
  TempoSearchReader,
  MppForms & { choice: never; unsigned: never; landed: TempoSplitLanded; network: never; query: TempoSplitQuery; answer: TempoSplitStatus }
>;

/**
 * `mpp/charge/tempo/split-memo/push`. The payer broadcasts (`broadcaster` answers `"payer"` for a credential of `type`
 * `hash`) and names the transaction by its hash: `fetchPresented` reads it, then `bound` reads H in its signed bytes.
 * A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.
 */
export const tempoSplitMemoPush = Object.freeze({
  id: PUSH,
  data: EIP155_TEMPO_MPP[PUSH],
  pattern: PATTERN,
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(PUSH),
  read,
  bound: pushBound,
  broadcaster: mppBroadcaster(byType({ hash: "payer" })),
  reference: (presented: unknown, option: MppChallenge) => referenceOf(pushRead(presented), option),
  landedTx: (presented: unknown): string | undefined => {
    const hash = pushedField(presented, "hash", "hash");
    return hash === undefined ? undefined : (normalHash(hash) ?? undefined);
  },
  fetchPresented: pushFetchPresented,
  status: splitStatus,
}) satisfies Entry<
  typeof PUSH,
  MppCredential,
  TempoSplitRef,
  TempoSearchReader,
  MppForms & { choice: never; unsigned: never; landed: TempoSplitLanded; network: never; query: TempoSplitQuery; answer: TempoSplitStatus }
>;
