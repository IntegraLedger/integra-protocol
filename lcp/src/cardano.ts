/**
 * Cardano, and its two pairings: `x402/exact/cardano`, x402's address-to-address method, and `x402/exact/cardano/lock`,
 * its two lock methods (`masumi` and `script`), told apart by the option's `extra.assetTransferMethod`. Each carries the
 * ATR hash as a CIP-20 message (metadata label 674) that the payer's signed body commits to through
 * `auxiliary_data_hash`. The transaction id is the Blake2b-256 of the body as received, so a payment is named by an id
 * fixed before any money moves, and its single-use value is the input `payload.nonce` names, which the body spends.
 *
 * @module
 */
import { bech32 } from "@scure/base";
import { blake2b } from "@noble/hashes/blake2.js";
import { canonicalJson, fromLcpString, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash, notFoundPoint } from "./fields.js";
import type { CardanoPaymentPayload } from "./internal/cardano.js";
import {
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  paymentWith,
  presentedWith,
  readFor,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { base64Bytes, bytesOfHexDigits, hexOf, sameBytes } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { CARDANO } from "./internal/data/cardano.js";
import { x402Payee } from "./internal/payee.js";
import {
  decide,
  type Facts,
  type Ledger,
  type Moved,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type Undecoded,
  type UnreadableReason,
} from "./internal/read.js";
import type { Entry } from "./internal/registry.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

export type CardanoNetwork = "cardano:mainnet" | "cardano:preprod" | "cardano:preview";

/** CIP-20 line 1 of the carrier; line 2 is the hash's 64 lowercase hex digits. */
export const LCP_MARKER = "lcp:sha256:0x";

/**
 * lcp's bound on a presented or read transaction: 64 KiB. The ledger's own `maxTxSize` is 16,384 bytes on mainnet
 * and the public testnets; lcp reads up to four times that, so that a parameter change does not refuse a payment the
 * ledger takes, and refuses beyond it so that a stranger's bytes cost a bounded decode.
 */
export const CARDANO_MAX_TX_BYTES = 64 * 1024;

/**
 * lcp's bound on the work of one `status` call: at most 1,000 transactions of the payer's credential read whole by the
 * search for H, the size of one page of Koios's listing. A search with more to read answers `pending`,
 * `search-incomplete`, with its position, and the next call resumes from it.
 */
export const CARDANO_SEARCH_BOUND = 1000;

export interface CardanoTx {
  txId: Hex;
  ttlSlot: bigint | null;
  h: AtrHash | Refusal;
}

export interface CardanoOnChain {
  blockHeight: bigint;
  slot: bigint;
  /** db-sync's `tx.valid_contract`. */
  valid: boolean;
  /** The transaction as included, when asked for. */
  cbor?: Uint8Array;
}

/**
 * An output an input names, as the endpoint answers it: the address that holds it, in Bech32 (a Byron address in any
 * other spelling holds no payment credential); where it is spent, `spentBy`: the transaction that spent it, or null
 * where the endpoint cannot name it; and `slot`, as `transaction`'s not-found answer names it. An unspent output is
 * read at the latest head only where that slot is at or past the tip's read first.
 */
export interface CardanoOutput {
  address: string;
  spentBy?: Hex | null;
  /** The slot of the latest block the indexer that answered held, read before the output; absent where unread. */
  slot?: bigint;
}

/**
 * One page of a payment credential's transactions: `through`, the height of the latest block the endpoint held,
 * named by it before the page; the transactions with block heights in the range asked, ordered by height and then by
 * id; and `more`, true where the range holds more after this page.
 */
export interface CardanoPage {
  through: bigint;
  transactions: readonly { txId: Hex; blockHeight: bigint }[];
  more: boolean;
}

/**
 * Bounded, read-only calls against one network's indexer. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`; any rejection reads as unreadable. `slotAt` answers the slot of the block at a height, or
 * null when the indexer holds no block at it. `transaction` answers `notFound` when the indexer does not hold the
 * transaction, with `slot`: the slot of the latest block the indexer that answered held, read from that same indexer
 * before the lookup, or null when the reader cannot read it from that indexer. A lookup naming no slot never reads
 * failed. `securityParam` is the ledger's security parameter from the endpoint's genesis, the count of confirmations
 * that is the final mark. `output` answers the output an input names (`<transaction id>#<index>`), or `notFound`
 * where the endpoint documents the transaction that created it as absent. `inputAddresses` answers the addresses that
 * hold a transaction's inputs, in its body's order. `credentialTransactions` answers one page of the transactions of a
 * payment credential (`key:` or `script:` and its 28 bytes in hex) with block heights from `from` through `to`. No run
 * has yet shown that any endpoint's listing holds every transaction that spends an output of the credential, or that
 * a page with `more` false is the last (the profile `x402-exact-cardano`), so no search through it is read whole.
 */
export interface CardanoReader {
  readonly network: CardanoNetwork;
  tip(): Promise<{ blockHeight: bigint; slot: bigint }>;
  slotAt(blockHeight: bigint): Promise<bigint | null>;
  transaction(txId: Hex, withCbor: boolean): Promise<CardanoOnChain | { notFound: true; slot: bigint | null }>;
  securityParam(): Promise<bigint>;
  output(input: string): Promise<CardanoOutput | { notFound: true }>;
  inputAddresses(txId: Hex): Promise<readonly string[]>;
  credentialTransactions(credential: string, from: bigint, to: bigint, offset: number): Promise<CardanoPage>;
}

/** x402's Cardano asset transfer methods: `default` is the address method, `masumi` and `script` the two locks. */
export type CardanoMethod = "default" | "masumi" | "script";

/**
 * The read keys of a presented payment. `txId` is the Blake2b-256 of the body the payer signed, which holds every
 * member of the payment presented, so a landed act is the payment presented exactly where its id is this one.
 * `ttlSlot` is the slot from which the body cannot land (body key 3, `invalid_hereafter`), absent for a body that sets
 * none. `input` is the input `payload.nonce` names, the single-use value. `payee` is the option's payee, the key of the
 * read's two party tests: its `payTo`, or on a Masumi lock the seller its `extra.terms.sellerAddress` names. `escrow`,
 * on a Masumi lock alone, is the option's `payTo`, the escrow every seller of the deployment shares: only a deposit
 * into it names, by its datum, the seller. `h` is the hash the body carries, the key of the search for H.
 */
export interface CardanoRef {
  network: CardanoNetwork;
  txId: Hex;
  ttlSlot?: string;
  input: string;
  payee: string;
  escrow?: string;
  method: CardanoMethod;
  h: AtrHash;
}

/**
 * The answer of `cardanoStatus`: positions and the search's position are block heights, and marks are counts of
 * confirmations, the newer blocks above the transaction's; the final mark is the ledger's security parameter. Each
 * transfer of what moved is named by its transaction's id and, as `place`, its output's index among the body's
 * outputs. A `settled` answer states `presented`: `yes` where the act is the body the reference was built from, `no`
 * where it is another.
 */
export type CardanoStatus = StatusAnswer<bigint, bigint, bigint>;

/** The payload x402's Cardano scheme defines. */
export interface CardanoPayload {
  transaction: string;
  nonce: string;
}

export interface CardanoUnsigned {
  request: { kind: "cardano-transaction"; accepted: PaymentRequirements; auxiliaryData: Uint8Array<ArrayBuffer> };
  complete(signed: CardanoPayload): Promise<CardanoPaymentPayload | Refusal>;
}

const ID = "x402/exact/cardano" as const;
const LOCK_ID = "x402/exact/cardano/lock" as const;
const MAX_TX_BYTES = CARDANO_MAX_TX_BYTES;
const MAX_DEPTH = 64;
const NETWORKS: Readonly<Record<string, CardanoNetwork>> = {
  "cardano:mainnet": "cardano:mainnet",
  "cardano:preprod": "cardano:preprod",
  "cardano:preview": "cardano:preview",
  "cip34:1-764824073": "cardano:mainnet",
  "cip34:0-1": "cardano:preprod",
  "cip34:0-2": "cardano:preview",
};
/** The methods of each pairing: the address method, also when unnamed, and the two locks. */
const ADDRESS_METHODS: readonly unknown[] = [undefined, "default"];
const LOCK_METHODS: readonly unknown[] = ["masumi", "script"];
const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]{1,78}$/;
const LABEL_MESSAGE = 674n;
const TAG_ALONZO_AUX = 259n;

/**
 * The exact auxiliary data the payer attaches: `#6.259({0: {674: {"msg": [LCP_MARKER, <64 hex>]}}})`. A value that is
 * not a 32-byte hash is `x402/payload-malformed`.
 */
export function auxiliaryData(h: AtrHash): Uint8Array<ArrayBuffer> | Refusal {
  const hex = normalHash(h);
  if (hex === null) return refusal("x402/payload-malformed");
  const enc = new TextEncoder();
  return Uint8Array.from([
    0xd9, 0x01, 0x03, // tag 259
    0xa1, 0x00, // {0:
    0xa1, 0x19, 0x02, 0xa2, // {674:
    0xa1, 0x63, ...enc.encode("msg"), // {"msg":
    0x82, // [
    0x60 + LCP_MARKER.length, ...enc.encode(LCP_MARKER),
    0x78, 0x40, ...enc.encode(hex.slice(2)),
  ]);
}

/**
 * Decodes a base64 transaction `[body, witness set, bool, auxiliary data / nil]`, keeping each item's bytes as
 * received. The id is the Blake2b-256 of the body's bytes; the auxiliary data must hash to the body's key 7.
 */
export async function decodeCardanoTx(base64: string): Promise<CardanoTx | Refusal> {
  const bytes = base64Bytes(base64, MAX_TX_BYTES);
  if (bytes === "too-large") return refusal("cardano/tx-too-large");
  if (bytes === "malformed") return refusal("cardano/tx-malformed");
  return decodeBytes(bytes);
}

type CardanoQuery = StatusQuery<CardanoRef, bigint, bigint, bigint>;

/** An answer of the reader outside its documented shape: the read is `unreadable`, `unparseable`. */
class Shape extends Error {}

/**
 * The reason of a rejected read: a `ReaderError` by its kind (`too-large`, `malformed` as `unparseable`, `timeout` and
 * `transport` as `transport`), and any other rejection `transport`.
 */
function rejected(e: unknown): UnreadableReason {
  if (e instanceof Shape) return "unparseable";
  const kind = isObject(e) && e["name"] === "ReaderError" ? e["kind"] : undefined;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

const INPUT = /^[0-9a-f]{64}#(0|[1-9][0-9]{0,9})$/;

function bigintOf(v: unknown): bigint {
  if (typeof v !== "bigint" || v < 0n) throw new Shape();
  return v;
}

/** The reference as `status` reads it, or undefined where a member is not in its form. */
function refOf(ref: unknown): CardanoRef | undefined {
  if (!isObject(ref)) return undefined;
  const txId = normalHash(ref["txId"]);
  const h = normalHash(ref["h"]);
  const ttl = ref["ttlSlot"];
  const { input, payee, method, network, escrow } = ref;
  if (txId === null || h === null || (ttl !== undefined && (typeof ttl !== "string" || !DECIMAL.test(ttl)))) return undefined;
  if (typeof input !== "string" || !INPUT.test(input) || typeof payee !== "string") return undefined;
  if (method !== "default" && method !== "masumi" && method !== "script") return undefined;
  // A Masumi lock's reference names its escrow; no other names one.
  if (method === "masumi" ? typeof escrow !== "string" : escrow !== undefined) return undefined;
  if (typeof network !== "string" || !Object.hasOwn(NETWORKS, network)) return undefined;
  return {
    network: network as CardanoNetwork,
    txId,
    ...(ttl === undefined ? {} : { ttlSlot: ttl }),
    input,
    payee,
    ...(method === "masumi" ? { escrow: escrow as string } : {}),
    method,
    h,
  };
}

/**
 * The read of the act the query asks about, as the profile `read-status` answers it. Positions are block heights and
 * marks counts of confirmations, from 0, the transaction included at the tip, to the ledger's security parameter, the
 * final mark, read from the reader. It reads, in order: the security parameter; the tip, read first; the block at the
 * position the caller gives, where the endpoint answers no such block the answer being `unreadable`, `history-gap`
 * (where the caller gives none, the genesis block shows the history the act would be in); the output the reference's
 * input names, with the payment credential that holds it, the payer's, and the transaction that spent it; the
 * transaction the reference names, by its id; the spending transaction; and the search for H: the transactions of the
 * payer's payment credential from the block after the position given, or after the position an earlier answer
 * returned, to the tip read first, each read whole, at most `CARDANO_SEARCH_BOUND` of them. Each transaction met is
 * classified from what landed: it carries H where its label 674 holds the reference's H; it consumed the input where it
 * is valid and spends it, or is invalid and takes it as collateral; its signer is the option's payee where an input of
 * the payee's payment credential is among its inputs, the payer where one of the payer's is, and another account
 * otherwise; it is of another kind where it deposits into a contract (an output to a script credential with an inline datum)
 * and the reference is the address method, or deposits into none and the reference is a Masumi lock; and it names the payee's account where an output's address has the payee's
 * payment credential, whatever its stake part, an output naming its own payment credential except, on a Masumi lock, a
 * deposit into the reference's escrow, which names the `seller` its datum names and none where the datum does not
 * decode; and no account where no output other than to the payer's credential names one, read from the body whatever
 * its result.
 * What moved is each output to another credential than the payer's, as observed, compared with nothing, and none for a
 * transaction included with `valid_contract` false, which created no output; each is named by the transaction's id and
 * its output's index. A `settled` answer states `presented`, `yes` where the act's id is the reference's and `no` where it
 * is another. The search is never read whole: no run has yet shown that a listing holds every transaction of the
 * credential (the profile `x402-exact-cardano`), so every `failed` but `before-position` answers `pending`,
 * `search-incomplete`. Every page is read to the last; the search is held at the lowest height the endpoint named
 * before a page where that is below the tip, or before the first listed transaction it did not read where the bound or
 * an absent transaction stopped it. A listed transaction that does not decode is named, and the answer holds the search
 * there, no item past the position the search is held at; a search read to the tip gives no position.
 */
export async function cardanoStatus(ref: CardanoRef, reader: CardanoReader, query: CardanoQuery): Promise<CardanoStatus> {
  const unparseable = { state: "unreadable", reason: "unparseable", foreign: [] } as const;
  const r = refOf(ref);
  if (r === undefined || !isObject(query) || typeof query.finality !== "bigint" || query.finality < 0n) return unparseable;
  if (query.after !== undefined && typeof query.after !== "bigint") return unparseable;
  if (query.search !== undefined && typeof query.search !== "bigint") return unparseable;
  if (!isObject(reader) || reader.network !== r.network) return { state: "unreadable", reason: "chain-mismatch", foreign: [] };
  try {
    return await readStatus(r, reader, query);
  } catch (e) {
    return { state: "unreadable", reason: rejected(e), foreign: [] };
  }
}

async function readStatus(r: CardanoRef, reader: CardanoReader, query: CardanoQuery): Promise<CardanoStatus> {
  const k = bigintOf(await reader.securityParam());
  if (k === 0n) throw new Shape();
  const tip: unknown = await reader.tip();
  if (!isObject(tip)) throw new Shape();
  const tipHeight = bigintOf(tip["blockHeight"]);
  const tipSlot = bigintOf(tip["slot"]);
  const slotAt = async (height: bigint): Promise<bigint | null> => {
    const slot: unknown = await reader.slotAt(height);
    return slot === null ? null : bigintOf(slot);
  };
  let history: boolean;
  if (query.after !== undefined) {
    if ((await slotAt(query.after)) === null) return { state: "unreadable", reason: "history-gap", foreign: [] };
    history = true;
  } else {
    history = (await slotAt(0n)) !== null;
  }
  const payeeCred = credentialOfText(r.payee);
  if (payeeCred === null) throw new Shape();
  const escrowCred = r.escrow === undefined ? null : credentialOfText(r.escrow);
  if (r.method === "masumi" && escrowCred === null) throw new Shape();
  const others = query.others ?? [];
  const givenIds = new Set<string>();
  const givenInputs = new Set<string>();
  for (const o of others) {
    if (!isObject(o)) throw new Shape();
    if ("transaction" in o) {
      const id = normalHash(o.transaction);
      if (id !== null) givenIds.add(id);
    } else {
      const g = refOf(o.ref);
      if (g === undefined) throw new Shape();
      givenIds.add(g.txId);
      givenInputs.add(g.input);
    }
  }

  const out: unknown = await reader.output(r.input);
  let payerCred: string | null = null;
  let spentBy: Hex | null | undefined;
  let outSlot: bigint | undefined;
  const valueRead = !(isObject(out) && out["notFound"] === true);
  if (valueRead) {
    if (!isObject(out) || typeof out["address"] !== "string") throw new Shape();
    payerCred = credentialOfText(out["address"]);
    const by = out["spentBy"];
    if (by !== undefined && by !== null && normalHash(by) === null) throw new Shape();
    spentBy = by === undefined ? undefined : by === null ? null : normalHash(by)!;
    outSlot = out["slot"] === undefined ? undefined : bigintOf(out["slot"]);
  }

  const seen = new Map<string, Seen<bigint, bigint>>();
  let reads = 0;
  /** Reads a transaction whole and classifies it; undefined where the endpoint does not hold it. */
  const undecoded: Undecoded<bigint>[] = [];
  const readTx = async (txId: Hex, asked: boolean): Promise<Seen<bigint, bigint> | "absent" | { malformed: bigint }> => {
    reads++;
    const tx: unknown = await reader.transaction(txId, true);
    if (notFoundPoint(tx, "slot") !== undefined) return "absent";
    if (!isOnChain(tx) || !(tx.cbor instanceof Uint8Array)) throw new Shape();
    const body = tx.cbor.length > MAX_TX_BYTES ? undefined : bodyOf(tx.cbor);
    if (body === undefined || body.txId !== txId) {
      if (asked) throw new Shape();
      return { malformed: bigintOf(tx.blockHeight) };
    }
    const consumed = tx.valid ? body.inputs.includes(r.input) : body.collateral.includes(r.input);
    const carries = !isRefusal(body.h) && body.h === r.h;
    const position = bigintOf(tx.blockHeight);
    const mark = tipHeight > position ? tipHeight - position : 0n;
    const s: Seen<bigint, bigint> & { moved: Moved[] } = {
      transaction: txId,
      position,
      mark,
      result: tx.valid ? "succeeded" : "failed",
      consumed,
      carries,
      party: "other",
      kind: "same",
      account: "none",
      moved: [],
      // The body the payer signed holds every member of the payment presented, and its id is that body's digest.
      presented: txId === r.txId ? "yes" : "no",
    };
    if (!carries && !consumed && !asked) return s;
    const addresses: unknown = await reader.inputAddresses(txId);
    if (!Array.isArray(addresses) || addresses.some((a) => typeof a !== "string")) throw new Shape();
    const creds = (addresses as string[]).map(credentialOfText);
    // Where the endpoint does not hold the input's output, the body the reference names shows who held it.
    const at = body.inputs.indexOf(r.input);
    if (payerCred === null && txId === r.txId && at >= 0 && addresses.length === body.inputs.length) payerCred = creds[at] ?? null;
    const party = creds.includes(payeeCred) ? "payee" : payerCred !== null && creds.includes(payerCred) ? "payer" : "other";
    const signer = party === "payee" ? payeeCred : party === "payer" ? payerCred! : (creds.find((c) => c !== null) ?? undefined);
    const locks = body.outputs.some((o) => o.lock);
    const kind = r.method === "script" || (r.method === "masumi") === locks ? "same" : "other";
    const named: string[] = [];
    const moved: Moved[] = [];
    body.outputs.forEach((o, index) => {
      const cred = credentialOf(o.address);
      if (cred !== null && cred === payerCred) return;
      // On a Masumi lock a deposit into the reference's escrow names the seller its datum names, and none where the datum
      // does not decode; every other output, on every method, names its own payment credential.
      const escrowed = r.method === "masumi" && o.lock && cred !== null && cred === escrowCred;
      const to = escrowed ? (o.seller ?? null) : cred;
      if (to !== null) named.push(to);
      // A phase-2-invalid transaction created none of its outputs: it moved nothing, and names what its body names.
      if (!tx.valid) return;
      for (const a of o.assets) {
        moved.push({ asset: a.asset, amount: a.amount.toString(), to: to ?? cred ?? hexOf(o.address), transaction: txId, place: index });
      }
    });
    // The account the act names is read from the body the payer signed, whatever its result.
    const account = named.includes(payeeCred) ? "payee" : named.length > 0 ? "other" : "none";
    const given = givenIds.has(txId) || [...givenInputs].some((i) => body.inputs.includes(i));
    return {
      ...s,
      party,
      kind,
      account,
      moved,
      ...(signer === undefined || signer === null ? {} : { signer }),
      ...(given ? { given: true } : {}),
    };
  };

  // The lookup by id: whole where it found the transaction, or where the endpoint that answered held the tip read first.
  let lookupWhole = true;
  const own = await readTx(r.txId, true);
  if (own === "absent") {
    const readTo = notFoundPoint(await reader.transaction(r.txId, false), "slot");
    lookupWhole = readTo !== null && readTo !== undefined && readTo >= tipSlot;
  } else seen.set(r.txId, own as Seen<bigint, bigint>);

  // The transaction that spent the input; one the endpoint cannot name, or does not hold, leaves the value read
  // consumed with its transaction not found.
  if (typeof spentBy === "string" && !seen.has(spentBy)) {
    const spender = await readTx(spentBy, false);
    if (spender === "absent") {
      // Named and not held: the value is read consumed and its transaction not found.
    } else if ("malformed" in spender) undecoded.push({ transaction: spentBy, at: spender.malformed - 1n });
    else seen.set(spentBy, spender);
  }

  // The search for H over the payer's payment credential, from the position given to the tip read first. It is never
  // read whole until a run shows the listing whole; it is held where it stopped before the tip.
  let at: bigint | undefined;
  if (payerCred !== null) {
    let done = (query.search ?? query.after ?? -1n) as bigint;
    let offset = 0;
    let held = false;
    let lowest: bigint | undefined;
    while (done < tipHeight && !held) {
      const page: unknown = await reader.credentialTransactions(payerCred, done + 1n, tipHeight, offset);
      if (!isObject(page) || !Array.isArray(page["transactions"]) || typeof page["more"] !== "boolean") throw new Shape();
      const through = bigintOf(page["through"]);
      const listed = page["transactions"] as unknown[];
      if (page["more"] === true && listed.length === 0) throw new Shape();
      for (const item of listed) {
        if (!isObject(item)) throw new Shape();
        const id = normalHash(item["txId"]);
        const height = bigintOf(item["blockHeight"]);
        if (id === null || height <= done || height > tipHeight) throw new Shape();
        if (seen.has(id)) continue;
        if (reads >= CARDANO_SEARCH_BOUND + 3) {
          held = true;
          done = height - 1n;
          break;
        }
        const t = await readTx(id, false);
        if (t === "absent") {
          held = true;
          done = height - 1n;
          break;
        }
        // A listed transaction that does not decode is named, and the search reads on: the answer holds it there.
        if ("malformed" in t) undecoded.push({ transaction: id, at: height - 1n });
        else if (t.carries || t.consumed) seen.set(id, t);
      }
      if (held) break;
      // The endpoint named a height before each page: every page is read to the last, and the search is held at the
      // lowest height named where it is below the tip, through which every listed transaction was read.
      lowest = lowest === undefined || through < lowest ? through : lowest;
      if (page["more"] === true) {
        offset += listed.length;
        continue;
      }
      if (lowest < tipHeight) {
        done = lowest > done ? lowest : done;
        held = true;
      } else done = tipHeight;
      break;
    }
    if (held) at = done;
  }
  // The items the search could not decode, the earliest first, none past the position the search is held at, so that
  // the next call reads every range this one did not.
  const holding = undecoded
    .map((u) => (at !== undefined && u.at !== undefined && u.at > at ? { ...u, at } : u))
    .sort((a, b) => order(a.at ?? -1n, b.at ?? -1n));

  // The input is read at the indexer's tip, the latest head; it is consumed at the final mark where the transaction that
  // spent it has the security parameter's confirmations, or cannot be read to show it has fewer.
  let value: Facts<bigint, bigint, bigint>["value"];
  if (valueRead) {
    const atHead = spentBy !== undefined;
    const spender = typeof spentBy === "string" ? seen.get(spentBy) : undefined;
    const consumed = atHead && (spender === undefined || spender.mark >= k);
    let lapsed = false;
    let mark = k;
    const ttl = r.ttlSlot === undefined ? undefined : BigInt(r.ttlSlot);
    if (!atHead && ttl !== undefined) {
      // The ledger takes a transaction only in a slot below its TTL: passed at the final mark where the block the
      // security parameter below the tip is at or past it, and below the final mark where only the tip is.
      const atFinal = tipHeight >= k ? await slotAt(tipHeight - k) : null;
      if (atFinal !== null && atFinal >= ttl) lapsed = true;
      else if (tipSlot >= ttl) {
        lapsed = true;
        mark = 0n;
      }
    }
    const headRead = atHead || (outSlot !== undefined && outSlot >= tipSlot);
    value = { consumed, lapsed, mark, ...(headRead ? { head: { consumed: atHead } } : {}) };
  }

  const facts: Facts<bigint, bigint, bigint> = {
    seen: [...seen.values()],
    ...(value === undefined ? {} : { value }),
    // Whole only where the input's output is documented absent, the value unread, so that no read answers `failed`;
    // where the value is read and no search runs (a payer whose address holds no payment credential), never whole.
    search: { whole: lookupWhole && payerCred === null && !valueRead, ...(at === undefined ? {} : { at }) },
    ...(holding.length === 0 ? {} : { undecoded: holding }),
    history,
  };
  const ledger: Ledger<bigint, bigint> = { coverage: "full", final: k, markOrder: order, positionOrder: order };
  const normalised: CardanoQuery = {
    ...query,
    ...(query.others === undefined
      ? {}
      : { others: query.others.map((o) => ("transaction" in o ? { transaction: normalHash(o.transaction) ?? String(o.transaction) } : o)) }),
  };
  return decide(facts, normalised, ledger);
}

function order(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reads the hash back from the included transaction alone, by its id, `input.tx`. An input whose `tx` is not a 32-byte
 * hash, or whose option is not an object, is `cardano/wrong-reader`, with nothing read; the option is not read further. Bytes that are not one CBOR array whose first item, the body, has the id
 * as its Blake2b-256 are not the transaction the id names, and are `cardano/unreadable`, as a failed read is, whatever
 * the decoder answers for them; its refusals answer only for bytes whose body has the id. One call.
 */
export async function cardanoRecover(
  input: RecoverInput<CardanoNetwork, PaymentRequirements | MppChallenge>,
  reader: CardanoReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("cardano/wrong-reader");
  const txId = normalHash(input.tx);
  if (txId === null || !isObject(input.option)) return refusal("cardano/wrong-reader");
  let tx: unknown;
  try {
    tx = await reader.transaction(input.tx as Hex, true);
  } catch {
    return refusal("cardano/unreadable");
  }
  if (notFoundPoint(tx, "slot") !== undefined) return refusal("cardano/not-found");
  if (!isOnChain(tx)) return refusal("cardano/unreadable");
  if (!tx.valid) return refusal("cardano/not-valid");
  if (!(tx.cbor instanceof Uint8Array) || tx.cbor.length > MAX_TX_BYTES) return refusal("cardano/unreadable");
  const top = oneItem(tx.cbor);
  const body = top?.kind === "array" ? top.items[0] : undefined;
  if (top === null || body === undefined || idOf(tx.cbor, body) !== txId) return refusal("cardano/unreadable");
  const decoded = decodeItem(tx.cbor, top);
  return isRefusal(decoded) ? decoded : decoded.h;
}

/** A pairing's filter: undefined for an option the pairing of these methods can pay, or the refusal naming why not. */
function optionCheck(option: unknown, methods: readonly unknown[]): Refusal | undefined {
  if (!isObject(option) || option["scheme"] !== "exact") return refusal("x402/option-not-this-pairing");
  const network = option["network"];
  if (typeof network !== "string" || !(network.startsWith("cardano:") || network.startsWith("cip34:"))) {
    return refusal("x402/option-not-this-pairing");
  }
  if (!Object.hasOwn(NETWORKS, network)) return refusal("cardano/network-malformed");
  const extra = option["extra"];
  if (extra !== undefined && !isObject(extra)) return refusal("x402/option-not-this-pairing");
  if (!methods.includes(extra?.["assetTransferMethod"])) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  // The published scheme sponsors no fee (`areFeesSponsored` is false): an option that says otherwise names a member
  // this pairing cannot honour.
  if (extra !== undefined && Object.hasOwn(extra, "areFeesSponsored") && extra["areFeesSponsored"] !== false) {
    return refusal("x402/option-not-this-pairing");
  }
  const amount = option["amount"];
  if (!isAmount(amount) || !DECIMAL.test(amount)) return refusal("x402/option-not-this-pairing");
  if (!isTimeoutSeconds(option["maxTimeoutSeconds"])) return refusal("x402/option-not-this-pairing");
  return undefined;
}

const addressFilter: OptionFilter = (o) => optionCheck(o, ADDRESS_METHODS) ?? true;
const lockFilter: OptionFilter = (o) => optionCheck(o, LOCK_METHODS) ?? true;

/** A pairing's codec members over its filter; `lock` is the pairing of the two lock methods. */
function codecOf(filter: OptionFilter, lock: boolean) {
  const advertise = (
    doc: PaymentRequired,
    h: AtrHash,
    link: string,
    offer: PaymentRequirements,
    agreementUrl?: string,
  ): PaymentRequired | Refusal => advertiseFor(filter)(doc, h, link, offer, agreementUrl);
  const read = (doc: PaymentRequired): X402Read | Refusal => readFor(filter)(doc);

  /** The parts of a presented payment: its network, its decoded transaction and the nonce it names. */
  const presentedTx = async (
    presented: unknown,
  ): Promise<
    { network: CardanoNetwork; tx: CardanoTx; inputs: readonly string[]; nonce: string; accepted: PaymentRequirements } | Refusal
  > => {
    const parts = presentedWith(presented, filter);
    if (isRefusal(parts)) return parts;
    const { transaction, nonce } = parts.payload;
    if (typeof transaction !== "string") return refusal("x402/payload-malformed");
    if (typeof nonce !== "string") return refusal("x402/payload-malformed");
    const tx = await decodeCardanoTx(transaction);
    if (isRefusal(tx)) return tx;
    const bytes = base64Bytes(transaction, MAX_TX_BYTES);
    const body = typeof bytes === "string" ? undefined : bodyOf(bytes);
    if (body === undefined) return refusal("cardano/tx-malformed");
    return { network: NETWORKS[parts.accepted.network]!, tx, inputs: body.inputs, nonce, accepted: parts.accepted };
  };

  /** The hash in the CIP-20 message the signed body commits to. Witnesses are not verified here. */
  const bound = async (presented: unknown): Promise<AtrHash | Refusal> => {
    const tx = await presentedTx(presented);
    return isRefusal(tx) ? tx : tx.tx.h;
  };

  /**
   * The read keys of a presented payment, given the option it answers: the network, the body's id, its TTL where it
   * has one, the input `payload.nonce` names, which must be one the body spends, the method, H, and the payee. A
   * presented `accepted` that is not the option given is `x402/accepted-not-option`. The address method admits a body
   * with no TTL, as the published verifier does; a lock refuses one, `cardano/ttl-missing`, since the scheme requires
   * it of a lock.
   */
  const reference = async (presented: unknown, option: PaymentRequirements): Promise<CardanoRef | Refusal> => {
    const tx = await presentedTx(presented);
    if (isRefusal(tx)) return tx;
    if (isRefusal(tx.tx.h)) return tx.tx.h;

    const input = inputOf(tx.nonce);
    if (input === null || !tx.inputs.includes(input)) return refusal("cardano/nonce-not-input");
    const extra = isObject(option.extra) ? option.extra : undefined;
    const method: CardanoMethod = lock ? (extra?.["assetTransferMethod"] as "masumi" | "script") : "default";
    let payee: string | Refusal;
    let escrow: string | undefined;
    if (method === "masumi") {
      // The seller is a public-key credential's address (the scheme's Facilitator Verification Rules), and `payTo`, the
      // escrow, one with a payment credential.
      const terms = extra?.["terms"];
      const seller = isObject(terms) ? terms["sellerAddress"] : undefined;
      const sellerCred = typeof seller === "string" ? credentialOfText(seller) : null;
      payee = sellerCred !== null && sellerCred.startsWith("key:") ? (seller as string) : refusal("x402/option-malformed");
      const payTo = x402Payee(option);
      if (isRefusal(payTo)) return payTo;
      if (credentialOfText(payTo) === null) return refusal("x402/option-malformed");
      escrow = payTo;
    } else payee = x402Payee(option);
    if (isRefusal(payee)) return payee;
    // The presented `accepted` is the option given, a CIP-34 alias and its canonical id being one network.
    const same = (o: unknown) => (isObject(o) && typeof o["network"] === "string" ? { ...o, network: NETWORKS[o["network"]] ?? o["network"] } : o);
    const a = canonicalJson(same(tx.accepted));
    const o = canonicalJson(same(option));
    if (typeof a !== "string" || typeof o !== "string" || a !== o) return refusal("x402/accepted-not-option");
    if (tx.tx.ttlSlot === null && lock) return refusal("cardano/ttl-missing");
    return {
      network: tx.network,
      txId: tx.tx.txId,
      ...(tx.tx.ttlSlot === null ? {} : { ttlSlot: tx.tx.ttlSlot.toString() }),
      input,
      payee,
      ...(escrow === undefined ? {} : { escrow }),
      method,
      h: tx.tx.h,
    };
  };

  /** The wallet request: the scheme's payment with a TTL, and these auxiliary data committed in the signed body. */
  const build = async (
    choice: { required: PaymentRequired; accepted: PaymentRequirements },
    h: AtrHash,
  ): Promise<CardanoUnsigned | Refusal> => {
    const expected = normalHash(h);
    if (expected === null) return refusal("x402/payload-malformed");
    const ok = chosen(choice?.required, choice?.accepted, filter);
    if (ok !== true) return ok;
    const accepted = choice.accepted;
    const aux = auxiliaryData(expected);
    if (isRefusal(aux)) return aux;
    const { required } = choice;
    return {
      request: { kind: "cardano-transaction", accepted, auxiliaryData: aux },
      async complete(signed: CardanoPayload): Promise<CardanoPaymentPayload | Refusal> {
        const payment = paymentWith(required, accepted, signed);
        const got = await bound(payment);
        const ref = await reference(payment, accepted);
        if (isRefusal(got) || got !== expected || isRefusal(ref) || ref.ttlSlot === undefined) {
          return refusal("x402/signed-not-bound");
        }
        return payment;
      },
    };
  };
  return { advertise, read, bound, reference, build };
}

/** The input a nonce names, `<64 lowercase hex>#<index>`, or null where it is not one. */
function inputOf(nonce: string): string | null {
  const m = /^([0-9a-fA-F]{64})#(0|[1-9][0-9]{0,9})$/.exec(nonce);
  return m === null ? null : `${m[1]!.toLowerCase()}#${m[2]}`;
}

/**
 * The option unchanged: the hash rides in the transaction's metadata, not in the option. An option that carries a
 * `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/** One profile, `x402-exact-cardano.md`, states both pairings. */
const lockPattern: LcpPattern = pattern;

type CardanoForms = X402Forms & {
  choice: { required: PaymentRequired; accepted: PaymentRequirements };
  unsigned: CardanoUnsigned;
  landed: unknown;
  network: CardanoNetwork;
  query: CardanoQuery;
  answer: CardanoStatus;
};

/** The address method's forms: `advertise` takes `coinsPerUtxoByte` after the offer, then the agreement URL. */
type CardanoAddressForms = Omit<CardanoForms, "rest"> & { rest: [coinsPerUtxoByte: bigint, agreementUrl?: string] };

const addressCodec = codecOf(addressFilter, false);
const lockCodec = codecOf(lockFilter, true);
const placeAddress = advertiseFor(addressFilter);

/**
 * The address method's `advertise`: the legal context placed as on every x402 pairing, then the agreement's floor, the
 * rule `cardanoFloor` evaluates, from `coinsPerUtxoByte`, the protocol parameter the caller reads when it issues the
 * offer, since governance can change it. A parameter that is not a positive bigint, or a `payTo` or an asset
 * `cardanoFloor` cannot read, is `cardano/floor-input`; a lovelace offer whose amount is below the floor is
 * `cardano/amount-below-floor`, the ledger refusing an output below it. A native-token offer's amount counts the
 * token's units, and the floor is the lovelace its output carries beside them, which the payer's transaction adds.
 */
function advertiseAddress(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  coinsPerUtxoByte: bigint,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = placeAddress(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const floor = cardanoFloor({ payTo: offer.payTo, asset: offer.asset, coinsPerUtxoByte });
  if (isRefusal(floor)) return floor;
  if (offer.asset === "lovelace" && BigInt(offer.amount) < floor) return refusal("cardano/amount-below-floor");
  return placed;
}

/**
 * `x402/exact/cardano`, the address method (`extra.assetTransferMethod` absent or `"default"`). The payee broadcasts
 * (`broadcaster` answers `"payee"`): the settler submits the transaction the payer signed; `status` reads it by the id
 * its body fixes and by the input it spends.
 */
export const exactCardano = Object.freeze({
  id: ID,
  data: CARDANO[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  ...addressCodec,
  advertise: advertiseAddress,
  broadcaster: x402Broadcaster("payee"),
  status: cardanoStatus,
  recover: cardanoRecover,
}) satisfies Entry<typeof ID, CardanoPaymentPayload, CardanoRef, CardanoReader, CardanoAddressForms>;

/**
 * `x402/exact/cardano/lock`, the two lock methods (`extra.assetTransferMethod` `"masumi"` or `"script"`): a deposit
 * into an escrow or a contract the seller defines, which is a charge and never an agreement. Its payee is the seller
 * the option's `extra.terms.sellerAddress` names on a Masumi lock, whose `payTo` is the escrow every seller of the
 * deployment shares, and `payTo` on a script lock.
 */
export const exactCardanoLock = Object.freeze({
  id: LOCK_ID,
  data: CARDANO[LOCK_ID],
  pattern: lockPattern,
  claims: true as boolean,
  unplaced,
  tie,
  ...lockCodec,
  broadcaster: x402Broadcaster("payee"),
  status: cardanoStatus,
  recover: cardanoRecover,
}) satisfies Entry<typeof LOCK_ID, CardanoPaymentPayload, CardanoRef, CardanoReader, CardanoForms>;

/**
 * The smallest lovelace an output to `payTo` can hold, the ledger's minimum (x402's Cardano scheme, *Minimum UTXO
 * Value*): `(160 + |serialized output|) × coinsPerUtxoByte`, the output being `{0: address, 1: value}` in the
 * post-Alonzo map form, its value the coin alone for a lovelace option, or the coin with one unit of the option's
 * native token (`<policy id hex>.<asset name hex>`). The coin's own encoding is part of the output, so the minimum is
 * the least coin whose output it covers. `coinsPerUtxoByte` is the protocol parameter, read live by the caller, since
 * governance can change it. An address that is not a Shelley address in Bech32, an asset not in that form, or a
 * parameter that is not a positive bigint is `cardano/floor-input`. An agreement's amount below it cannot be built.
 */
export function cardanoFloor(input: { payTo: string; asset: string; coinsPerUtxoByte: bigint }): bigint | Refusal {
  if (!isObject(input) || typeof input.coinsPerUtxoByte !== "bigint" || input.coinsPerUtxoByte <= 0n) {
    return refusal("cardano/floor-input");
  }
  const address = typeof input.payTo === "string" ? addressBytes(input.payTo) : null;
  if (address === null || credentialOf(address) === null) return refusal("cardano/floor-input");
  let token: { policy: Uint8Array; name: Uint8Array } | undefined;
  if (input.asset !== "lovelace") {
    const m = typeof input.asset === "string" ? /^([0-9a-f]{56})\.((?:[0-9a-f]{2}){0,32})$/.exec(input.asset) : null;
    if (m === null) return refusal("cardano/floor-input");
    token = { policy: bytesOfHexDigits(m[1]!)!, name: bytesOfHexDigits(m[2]!)! };
  }
  const size = (coin: bigint): number => {
    const head = (major: number, n: bigint): number => (n < 24n ? 1 : n < 256n ? 2 : n < 65536n ? 3 : n < 4294967296n ? 5 : 9);
    const bytes = (b: Uint8Array): number => head(2, BigInt(b.length)) + b.length;
    const value =
      token === undefined
        ? head(0, coin)
        : 1 + head(0, coin) + 1 + bytes(token.policy) + 1 + bytes(token.name) + head(0, 1n);
    return 1 + 1 + bytes(address) + 1 + value;
  };
  let coin = 0n;
  for (;;) {
    const need = (160n + BigInt(size(coin))) * input.coinsPerUtxoByte;
    if (need <= coin) return coin;
    coin = need;
  }
}

/** An output of a body: its address bytes, what it carries, and, where it is a deposit whose inline datum is a Masumi escrow datum, the seller's payment credential. */
interface Output {
  readonly address: Uint8Array;
  readonly assets: readonly { asset: string; amount: bigint }[];
  /** Whether it is a deposit into a contract: a script credential's address with an inline datum. */
  readonly lock: boolean;
  readonly seller?: string;
}

/** A transaction read whole: its id, the inputs and collateral it names, its outputs, and the hash its label 674 carries. */
interface Body {
  readonly txId: Hex;
  readonly inputs: readonly string[];
  readonly collateral: readonly string[];
  readonly outputs: readonly Output[];
  readonly h: AtrHash | Refusal;
}

/**
 * A transaction's bytes read whole, or undefined where they are not one transaction of the shape `decodeCardanoTx`
 * reads, or an input, an output or a value in it is not in the ledger's form. The auxiliary data decide only `h`.
 */
function bodyOf(bytes: Uint8Array): Body | undefined {
  const top = oneItem(bytes);
  if (top === null || top.kind !== "array" || top.items.length !== 4) return undefined;
  const [body, , , aux] = top.items as [Item, Item, Item, Item];
  if (body.kind !== "map") return undefined;
  const fields = new Map<bigint, Item>();
  for (const [key, v] of body.entries) {
    if (key.kind !== "uint" || fields.has(key.value)) return undefined;
    fields.set(key.value, v);
  }
  const inputs = inputsOf(fields.get(0n));
  const collateral = fields.has(13n) ? inputsOf(fields.get(13n)) : [];
  const outs = fields.get(1n);
  if (inputs === undefined || collateral === undefined || outs?.kind !== "array") return undefined;
  const outputs: Output[] = [];
  for (const o of outs.items) {
    const out = outputOf(o);
    if (out === undefined) return undefined;
    outputs.push(out);
  }
  const decoded = decodeItem(bytes, top);
  const h = isRefusal(decoded) ? decoded : decoded.h;
  void aux;
  return { txId: idOf(bytes, body), inputs, collateral, outputs, h };
}

/** A set of inputs, an array or tag 258 over one, each `[id, index]`, as `<id hex>#<index>`. */
function inputsOf(item: Item | undefined): string[] | undefined {
  const set = item?.kind === "tag" && item.tag === 258n ? item.item : item;
  if (set?.kind !== "array") return undefined;
  const out: string[] = [];
  for (const i of set.items) {
    if (i.kind !== "array" || i.items.length !== 2) return undefined;
    const [id, index] = i.items as [Item, Item];
    if (id.kind !== "bytes" || id.value.length !== 32 || index.kind !== "uint" || index.value > 0xffffffffn) return undefined;
    out.push(`${hexOf(id.value).slice(2)}#${index.value}`);
  }
  return out;
}

/** An output in either form: `[address, value, datum hash?]`, or `{0: address, 1: value, 2: datum option, 3: script}`. */
function outputOf(o: Item): Output | undefined {
  let address: Item | undefined;
  let value: Item | undefined;
  let datum: Item | undefined;
  if (o.kind === "array") {
    if (o.items.length < 2 || o.items.length > 3) return undefined;
    [address, value] = o.items;
  } else if (o.kind === "map") {
    for (const [key, v] of o.entries) {
      if (key.kind !== "uint") return undefined;
      if (key.value === 0n) address = v;
      else if (key.value === 1n) value = v;
      else if (key.value === 2n) datum = v;
    }
  } else return undefined;
  if (address?.kind !== "bytes" || value === undefined) return undefined;
  const assets = assetsOf(value);
  if (assets === undefined) return undefined;
  const inline = datum?.kind === "array" && datum.items[0]?.kind === "uint" && datum.items[0].value === 1n;
  const lock = inline && credentialOf(address.value)?.startsWith("script:") === true;
  // Only a deposit's datum is read as a Masumi escrow datum.
  const seller = lock ? masumiSeller(datum!) : undefined;
  return { address: address.value, assets, lock, ...(seller === undefined ? {} : { seller }) };
}

/** A value: a coin, or `[coin, {policy: {name: quantity}}]`, as `lovelace` and `<policy hex>.<name hex>` amounts. */
function assetsOf(v: Item): { asset: string; amount: bigint }[] | undefined {
  if (v.kind === "uint") return [{ asset: "lovelace", amount: v.value }];
  if (v.kind !== "array" || v.items.length !== 2) return undefined;
  const [coin, multi] = v.items as [Item, Item];
  if (coin.kind !== "uint" || multi.kind !== "map") return undefined;
  const out = [{ asset: "lovelace", amount: coin.value }];
  for (const [policy, names] of multi.entries) {
    if (policy.kind !== "bytes" || policy.value.length !== 28 || names.kind !== "map") return undefined;
    for (const [name, qty] of names.entries) {
      if (name.kind !== "bytes" || name.value.length > 32 || qty.kind !== "uint") return undefined;
      out.push({ asset: `${hexOf(policy.value).slice(2)}.${hexOf(name.value).slice(2)}`, amount: qty.value });
    }
  }
  return out;
}

/**
 * The seller's payment credential of a Masumi escrow datum, x402's Cardano scheme's `masumi.vested_pay.v2`: an inline
 * datum (`[1, #6.24(bytes)]`) that is Plutus `Constr 0` (tag 121) over 19 fields, field 2 the seller's address,
 * `Constr 0 [credential, stake]`, its credential `Constr 0 [key hash]` or `Constr 1 [script hash]` over 28 bytes.
 * Undefined for any other datum, or one that does not decode so.
 */
function masumiSeller(datum: Item): string | undefined {
  if (datum.kind !== "array" || datum.items.length !== 2) return undefined;
  const [kind, wrapped] = datum.items as [Item, Item];
  if (kind.kind !== "uint" || kind.value !== 1n || wrapped.kind !== "tag" || wrapped.tag !== 24n || wrapped.item.kind !== "bytes") {
    return undefined;
  }
  const inner = oneItem(wrapped.item.value);
  const fields = constrOf(inner, 0);
  const seller = fields?.length === 19 ? constrOf(fields[2]!, 0) : undefined;
  const credential = seller?.[0];
  for (const [tagged, prefix] of [[0, "key"], [1, "script"]] as const) {
    const hash = credential === undefined ? undefined : constrOf(credential, tagged);
    const bytes = hash?.length === 1 ? hash[0] : undefined;
    if (bytes?.kind === "bytes" && bytes.value.length === 28) return `${prefix}:${hexOf(bytes.value).slice(2)}`;
  }
  return undefined;
}

/** The fields of Plutus `Constr n` for n below 7 (tag 121 + n), or undefined. */
function constrOf(item: Item | null, n: number): Item[] | undefined {
  if (item === null || item.kind !== "tag" || item.tag !== BigInt(121 + n) || item.item.kind !== "array") return undefined;
  return item.item.items;
}

/**
 * The payment credential an address holds: `key:` or `script:` and its 28 bytes in hex, for a Shelley base, pointer
 * or enterprise address (header types 0 to 7, CIP-19); null for any other address, a Byron one among them.
 */
function credentialOf(address: Uint8Array): string | null {
  if (address.length < 29) return null;
  const type = address[0]! >> 4;
  if (type > 7) return null;
  return `${type % 2 === 0 ? "key" : "script"}:${hexOf(address.subarray(1, 29)).slice(2)}`;
}

/** An address in Bech32 (CIP-19's `addr` and `addr_test`) as bytes, or null. */
function addressBytes(text: string): Uint8Array | null {
  try {
    const { prefix, words } = bech32.decode(text as `${string}1${string}`, 1023);
    if (prefix !== "addr" && prefix !== "addr_test") return null;
    return bech32.fromWords(words);
  } catch {
    return null;
  }
}

/** The payment credential of an address in Bech32, or null. */
function credentialOfText(text: string): string | null {
  const bytes = addressBytes(text);
  return bytes === null ? null : credentialOf(bytes);
}

function decodeBytes(bytes: Uint8Array): CardanoTx | Refusal {
  const top = oneItem(bytes);
  return top === null ? refusal("cardano/tx-malformed") : decodeItem(bytes, top);
}

/** The one CBOR item `bytes` hold, or null when they are not exactly one well-formed item. */
function oneItem(bytes: Uint8Array): Item | null {
  try {
    const r = new CborReader(bytes);
    const top = r.item(0);
    return r.at === bytes.length ? top : null;
  } catch {
    return null;
  }
}

/** The transaction id: the Blake2b-256 of the body's bytes as received. */
function idOf(bytes: Uint8Array, body: Item): Hex {
  return hexOf(blake2b(bytes.subarray(body.start, body.end), { dkLen: 32 }));
}

/** `decodeBytes` on the item `oneItem` read from `bytes`. */
function decodeItem(bytes: Uint8Array, top: Item): CardanoTx | Refusal {
  if (top.kind !== "array" || top.items.length !== 4) return refusal("cardano/tx-malformed");
  const [body, , valid, aux] = top.items as [Item, Item, Item, Item];
  if (body.kind !== "map" || !(valid.kind === "simple" && (valid.value === 20 || valid.value === 21))) {
    return refusal("cardano/tx-malformed");
  }
  const fields = new Map<bigint, Item>();
  for (const [k, v] of body.entries) {
    if (k.kind !== "uint" || fields.has(k.value)) return refusal("cardano/tx-malformed");
    fields.set(k.value, v);
  }
  const ttl = fields.get(3n);
  if (ttl !== undefined && ttl.kind !== "uint") return refusal("cardano/tx-malformed");
  const auxHash = fields.get(7n);
  const txId = idOf(bytes, body);
  const ttlSlot = ttl === undefined ? null : ttl.value;

  if (auxHash === undefined || (aux.kind === "simple" && aux.value === 22)) return refusal("cardano/aux-missing");
  if (auxHash.kind !== "bytes" || auxHash.value.length !== 32) return refusal("cardano/tx-malformed");
  if (!sameBytes(blake2b(bytes.subarray(aux.start, aux.end), { dkLen: 32 }), auxHash.value)) {
    return refusal("cardano/aux-hash-mismatch");
  }
  return { txId, ttlSlot, h: carrier(aux) };
}

/**
 * The hash in label 674's `"msg"` lines: exactly one line equal to `LCP_MARKER`, followed by a line of 64 lowercase hex
 * digits. The metadata may hold label 674 once, and its map may not repeat a key, so every reader of the message
 * reads the same lines. Marker lines are counted ignoring case and a leading byte-order mark: more than one is
 * `cardano/ambiguous`, and one that is not exactly `LCP_MARKER` followed by lowercase hex carries no hash.
 */
function carrier(aux: Item): AtrHash | Refusal {
  const metadata = metadataOf(aux);
  const messages = (metadata?.entries ?? []).filter(([l]) => l.kind === "uint" && l.value === LABEL_MESSAGE);
  if (messages.length > 1) return refusal("cardano/ambiguous");
  const message = messages[0]?.[1];
  const candidates: [Item, Item | undefined][] = [];
  if (message?.kind === "map") {
    const keys = new Set<string>();
    for (const [key] of message.entries) {
      const k = keyOf(key);
      if (keys.has(k)) return refusal("cardano/ambiguous");
      keys.add(k);
    }
    for (const [key, lines] of message.entries) {
      if (key.kind !== "text" || key.value !== "msg" || lines.kind !== "array") continue;
      lines.items.forEach((line, i) => {
        if (line.kind === "text" && isMarkerLike(line.value)) candidates.push([line, lines.items[i + 1]]);
      });
    }
  }
  if (candidates.length > 1) return refusal("cardano/ambiguous");
  const [marker, digits] = candidates[0] ?? [];
  if (marker?.kind !== "text" || marker.value !== LCP_MARKER || digits?.kind !== "text" || !HEX64.test(digits.value)) {
    return refusal("cardano/hash-not-carried");
  }
  return fromLcpString(LCP_MARKER + digits.value) ?? refusal("cardano/hash-not-carried");
}

/** A line that reads as `LCP_MARKER` once case and a leading byte-order mark are ignored. */
function isMarkerLike(line: string): boolean {
  return line.replace(/^\uFEFF/, "").toLowerCase() === LCP_MARKER;
}

/**
 * A map key's identity as a decoded value, so that two encodings of one value are the same key. A text key is
 * compared without a leading byte-order mark, and every float is one key.
 */
function keyOf(k: Item): string {
  switch (k.kind) {
    case "uint":
      return `u${k.value}`;
    case "nint":
      return `n${k.value}`;
    case "bytes":
      return `b${hexOf(k.value)}`;
    case "text":
      return `t${JSON.stringify(k.value.replace(/^\uFEFF/, ""))}`;
    case "array":
      return `a[${k.items.map(keyOf).join(",")}]`;
    case "map":
      return `m{${k.entries.map(([a, b]) => `${keyOf(a)}:${keyOf(b)}`).join(",")}}`;
    case "tag":
      return `g${k.tag}(${keyOf(k.item)})`;
    case "simple":
      return `s${k.value}`;
    case "float":
      return "f";
  }
}

/** The metadata map of the three auxiliary data forms: a map, `[metadata, scripts]`, or tag 259 with key 0. */
function metadataOf(aux: Item): (Item & { kind: "map" }) | undefined {
  if (aux.kind === "map") return aux;
  if (aux.kind === "array") {
    const first = aux.items[0];
    return first?.kind === "map" ? first : undefined;
  }
  if (aux.kind === "tag" && aux.tag === TAG_ALONZO_AUX && aux.item.kind === "map") {
    for (const [k, v] of aux.item.entries) {
      if (k.kind === "uint" && k.value === 0n && v.kind === "map") return v;
    }
  }
  return undefined;
}

function isOnChain(t: unknown): t is CardanoOnChain {
  return (
    isObject(t) &&
    typeof t["blockHeight"] === "bigint" &&
    typeof t["slot"] === "bigint" &&
    typeof t["valid"] === "boolean" &&
    (t["cbor"] === undefined || t["cbor"] instanceof Uint8Array)
  );
}

type Item = { start: number; end: number } & (
  | { kind: "uint"; value: bigint }
  | { kind: "nint"; value: bigint }
  | { kind: "bytes"; value: Uint8Array }
  | { kind: "text"; value: string }
  | { kind: "array"; items: Item[] }
  | { kind: "map"; entries: [Item, Item][] }
  | { kind: "tag"; tag: bigint; item: Item }
  | { kind: "simple"; value: number }
  | { kind: "float" }
);

/**
 * A bounded CBOR reader (RFC 8949) that keeps each item's byte span. Definite and indefinite lengths and tags are
 * read; nesting is at most 64 deep. Text keeps a leading byte-order mark. Anything malformed throws, and the caller
 * turns that into a refusal.
 */
class CborReader {
  at = 0;
  private readonly text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  constructor(private readonly b: Uint8Array) {}

  item(depth: number): Item {
    if (depth > MAX_DEPTH) throw new RangeError("too deep");
    const start = this.at;
    const head = this.byte();
    const major = head >> 5;
    const info = head & 0x1f;
    if (info === 31) return this.indefinite(major, start, depth);
    const arg = this.argument(info);
    switch (major) {
      case 0:
        return { kind: "uint", value: arg, start, end: this.at };
      case 1:
        return { kind: "nint", value: -1n - arg, start, end: this.at };
      case 2:
        return { kind: "bytes", value: this.take(arg), start, end: this.at };
      case 3:
        return { kind: "text", value: this.text.decode(this.take(arg)), start, end: this.at };
      case 4: {
        const items: Item[] = [];
        for (let i = 0n; i < arg; i++) items.push(this.item(depth + 1));
        return { kind: "array", items, start, end: this.at };
      }
      case 5: {
        const entries: [Item, Item][] = [];
        for (let i = 0n; i < arg; i++) entries.push([this.item(depth + 1), this.item(depth + 1)]);
        return { kind: "map", entries, start, end: this.at };
      }
      case 6:
        return { kind: "tag", tag: arg, item: this.item(depth + 1), start, end: this.at };
      default:
        if (info >= 25) return { kind: "float", start, end: this.at };
        if (info === 24 && arg < 32n) throw new RangeError("simple value");
        return { kind: "simple", value: Number(arg), start, end: this.at };
    }
  }

  private indefinite(major: number, start: number, depth: number): Item {
    if (major === 2 || major === 3) {
      const chunks: Uint8Array[] = [];
      while (!this.isBreak()) {
        const head = this.byte();
        if (head >> 5 !== major || (head & 0x1f) === 31) throw new RangeError("chunk");
        chunks.push(this.take(this.argument(head & 0x1f)));
      }
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        all.set(c, o);
        o += c.length;
      }
      return major === 2
        ? { kind: "bytes", value: all, start, end: this.at }
        : { kind: "text", value: this.text.decode(all), start, end: this.at };
    }
    if (major === 4) {
      const items: Item[] = [];
      while (!this.isBreak()) items.push(this.item(depth + 1));
      return { kind: "array", items, start, end: this.at };
    }
    if (major === 5) {
      const entries: [Item, Item][] = [];
      while (!this.isBreak()) entries.push([this.item(depth + 1), this.item(depth + 1)]);
      return { kind: "map", entries, start, end: this.at };
    }
    throw new RangeError("indefinite");
  }

  /** Consumes a break byte when one is next. */
  private isBreak(): boolean {
    if (this.at >= this.b.length) throw new RangeError("short");
    if (this.b[this.at] !== 0xff) return false;
    this.at++;
    return true;
  }

  private argument(info: number): bigint {
    if (info < 24) return BigInt(info);
    if (info > 27) throw new RangeError("reserved");
    const n = 1 << (info - 24);
    let v = 0n;
    const w = this.take(BigInt(n));
    for (let i = 0; i < w.length; i++) v = (v << 8n) | BigInt(w[i]!);
    return v;
  }

  private byte(): number {
    if (this.at >= this.b.length) throw new RangeError("short");
    return this.b[this.at++]!;
  }

  private take(n: bigint): Uint8Array {
    if (n > BigInt(this.b.length - this.at)) throw new RangeError("short");
    const out = this.b.subarray(this.at, this.at + Number(n));
    this.at += Number(n);
    return out;
  }
}
