/**
 * Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer
 * carries the ATR hash, so the hash is advertised in the challenge and tied to the payment by the seller's claim.
 *
 * The hash is read back from the echoed extension. The settlement is found by the payer's sender and sequence number,
 * and identified by a digest of the transfer the payer signed and by the expiry it signed.
 *
 * @module
 */
import { digestJson, parseJson, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash, notFoundPoint } from "./fields.js";
import type { AptosPaymentPayload } from "./internal/aptos.js";
import {
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  legalContextOf,
  paymentWith,
  presentedWith,
  readFor,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { base64Bytes, decimalBelow, hexOf, U64_LIMIT } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { APTOS } from "./internal/data/aptos.js";
import { x402Payee } from "./internal/payee.js";
import { decide, type Ledger, type Moved, type Seen, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import { isQuery } from "./internal/read-ledger.js";
import { canonicalJson } from "./internal/core.js";
import type { Entry } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { AptosPaymentPayload } from "./internal/aptos.js";
export type { X402Read } from "./internal/x402.js";

/** CAIP-2: `aptos:` and the numeric chain id. */
export type AptosNetwork = `aptos:${number}`;

/** The transfer the payer signed, in one normal form shared by the signed bytes and the chain's REST answer. */
export interface AptosInstrument {
  sender: Hex;
  sequenceNumber: bigint;
  expiresAt: bigint;
  chainId: number;
  /** The signed gas members; absent in a normal form read from a REST answer that does not show them. */
  maxGasAmount?: bigint;
  gasUnitPrice?: bigint;
  function: string;
  typeArguments: readonly string[];
  arguments: readonly string[];
}

/**
 * A committed user transaction as the REST API returns it, with every member the read needs: its `events` and its
 * `changes` whole, as the node returns them. A reader that leaves either out returns an answer out of this form, which
 * the read answers `unreadable`, `unparseable`, and never reads as a transaction that deposited nothing.
 */
export interface AptosCommitted {
  type: "user_transaction";
  hash: string;
  version: string;
  success: boolean;
  sender: string;
  sequence_number: string;
  expiration_timestamp_secs: string;
  /**
   * The payload as signed: an entry function's `function`, `type_arguments` and `arguments`, or another kind's members.
   * The read takes a transaction of any payload at the signed number for its deposits.
   */
  payload: { type: string; function?: string; type_arguments?: string[]; arguments?: unknown[] };
  max_gas_amount?: string;
  gas_unit_price?: string;
  /** Every event of the transaction, each with its type and data: a deposit is `0x1::fungible_asset::Deposit`, `{store, amount}`. */
  events: { type: string; data: unknown }[];
  /**
   * Every write-set change of the transaction: at a deposit's store address, `0x1::object::ObjectCore`'s `owner` and
   * `0x1::fungible_asset::FungibleStore`'s `metadata`, each a `write_resource` whose `data` is `{type, data}`.
   */
  changes: { type: string; address?: string; data?: unknown }[];
}

/** The account's sequence number, at the ledger of that answer: its time, and its oldest version held. */
export interface AptosAccount {
  /** The account's `sequence_number`; 0 where the node does not hold the account. */
  sequenceNumber: bigint;
  /** The answer's `X-Aptos-Ledger-TimestampUsec`. */
  timestampUsecs: bigint;
  /** The answer's `X-Aptos-Ledger-Oldest-Version`. */
  oldestVersion: bigint;
}

/**
 * Bounded, read-only calls against one network's REST endpoint. Every failure rejects, for example with `ReaderError`
 * from `@integraledger/lcp/evm`; any rejection reads as unreadable. A committed transaction is returned whole, with
 * its `events` and its `changes` (`AptosCommitted`); an answer without them is `unparseable`.
 */
export interface AptosReader {
  readonly network: AptosNetwork;
  /** `GET /v1/transactions/by_hash/{hash}`; null on 404. */
  byHash(hash: Hex): Promise<AptosCommitted | { type: "pending_transaction" } | null>;
  /**
   * `GET /v1/accounts/{sender}/transactions?start=n&limit=1`, kept only when its `sequence_number` is n. When there is
   * none, `notFound` with `timestampUsecs`, the ledger timestamp of that answer, its `X-Aptos-Ledger-TimestampUsec`
   * header, and `oldestVersion`, its `X-Aptos-Ledger-Oldest-Version` header.
   */
  bySequence(sender: Hex, n: bigint): Promise<AptosCommitted | { notFound: true; timestampUsecs: bigint; oldestVersion?: bigint }>;
  /** `GET /v1/accounts/{sender}`: the account's sequence number with the ledger time and floor of that answer. */
  account(sender: Hex): Promise<AptosAccount>;
  /** `GET /v1`. */
  ledger(): Promise<{ chainId: number; timestampUsecs: bigint }>;
}

export interface AptosRef {
  network: AptosNetwork;
  sender: Hex;
  /** Decimal strings. */
  sequenceNumber: string;
  expiresAt: string;
  idDigest: Hex;
  /** The signed gas members, decimal strings: with the members above, the payment presented. */
  maxGasAmount?: string;
  gasUnitPrice?: string;
  /** The facilitator's transaction hash, once named: a hint, since a fee payer's signature changes it. */
  transaction?: Hex;
  /** The option's `payTo`. */
  payee: string;
}

/**
 * The answer of `aptosStatus`: positions are ledger versions, and the one mark is `committed`, a transaction the REST
 * endpoint serves as committed, which is final.
 */
export type AptosStatus = StatusAnswer<bigint, "committed", bigint>;

/** What the read by hash and by sequence number observed, before the profile's rules choose the answer. */
type AptosRead =
  | { state: "settled"; version: bigint; transaction: Hex }
  | { state: "aborted"; version: bigint; transaction: Hex }
  | { state: "pending"; why: "not-found" | "in-mempool" }
  | { state: "failed"; why: "superseded" | "expired" }
  | { state: "unreadable"; why: UnreadableReason };

export interface AptosUnsigned {
  request: { kind: "aptos-transaction"; accepted: PaymentRequirements };
  /**
   * The payment of the signed transaction, once `reference` reads its keys; a transaction `reference` refuses gets the
   * code `reference` gives it, such as `aptos/chain-mismatch` for a transaction signed for a chain other than the
   * option's network.
   */
  complete(signed: { transaction: string }): AptosPaymentPayload | Refusal;
}

const ID = "x402/exact/aptos" as const;
/**
 * The largest Aptos transaction lcp decodes, in bytes: the chain's `max_transaction_size_in_bytes`, 64 KiB, beyond which
 * the chain refuses a transaction. A larger one is `aptos/tx-too-large`.
 */
export const MAX_APTOS_TX_BYTES = 64 * 1024;
const NETWORK = /^aptos:([1-9][0-9]{0,2})$/;
const ADDRESS_64 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_ANY = /^0x[0-9a-fA-F]{1,64}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,254}$/;
const ENTRY_FUNCTION = 2;
const TYPE_TAG_STRUCT = 7;
const FRAMEWORK = "0x" + "0".repeat(63) + "1";
const TRANSFERS: readonly string[] = [
  `${FRAMEWORK}::primary_fungible_store::transfer`,
  `${FRAMEWORK}::fungible_asset::transfer`,
];

/**
 * Reads the `RawTransaction` prefix of a base64 transaction, in either wire form: the scheme's BCS bytes, or x402's
 * reference form, base64 of the JSON `{"transaction": [bytes], "senderAuthenticator": [bytes]}`. Only an entry
 * function call to a framework fungible-asset transfer is accepted. Module, function and struct names are read as
 * their exact bytes, a leading U+FEFF included, and each must be an ASCII letter or underscore followed by up to 254
 * ASCII letters, digits and underscores, else `aptos/tx-malformed`.
 */
export function decodeAptosTx(transaction: string): AptosInstrument | Refusal {
  const decoded = base64Bytes(transaction, MAX_APTOS_TX_BYTES);
  if (decoded === "too-large") return refusal("aptos/tx-too-large");
  if (decoded === "malformed") return refusal("aptos/tx-malformed");
  const bytes = referenceForm(decoded) ?? decoded;
  const r = new Reader(bytes);
  try {
    const sender = hexOf(r.bytes(32));
    const sequenceNumber = r.u64();
    if (r.uleb() !== ENTRY_FUNCTION) return refusal("aptos/not-entry-function");
    const moduleAddress = hexOf(r.bytes(32));
    const module = r.ident();
    const name = r.ident();
    const fn = `${moduleAddress}::${module}::${name}`;
    const typeArgCount = r.uleb();
    if (!TRANSFERS.includes(fn) || typeArgCount !== 1) return refusal("aptos/not-an-x402-transfer");
    if (r.uleb() !== TYPE_TAG_STRUCT) return refusal("aptos/not-an-x402-transfer");
    const typeArgument = `${hexOf(r.bytes(32))}::${r.ident()}::${r.ident()}`;
    if (r.uleb() !== 0) return refusal("aptos/not-an-x402-transfer");
    if (r.uleb() !== 3) return refusal("aptos/not-an-x402-transfer");
    const first = r.bytes(r.uleb());
    const second = r.bytes(r.uleb());
    const amount = r.bytes(r.uleb());
    if (first.length !== 32 || second.length !== 32 || amount.length !== 8) return refusal("aptos/not-an-x402-transfer");
    const maxGasAmount = r.u64();
    const gasUnitPrice = r.u64();
    const expiresAt = r.u64();
    const chainId = r.u8();
    return {
      sender,
      sequenceNumber,
      expiresAt,
      chainId,
      maxGasAmount,
      gasUnitPrice,
      function: fn,
      typeArguments: [typeArgument],
      arguments: [hexOf(first), hexOf(second), leU64(amount).toString()],
    };
  } catch {
    return refusal("aptos/tx-malformed");
  }
}

/** SHA-256 over the RFC 8785 form of `{sender, sequenceNumber, function, typeArguments, arguments}`. */
export async function aptosIdDigest(i: AptosInstrument): Promise<Hex | Refusal> {
  if (!isObject(i) || typeof i.sequenceNumber !== "bigint") return refusal("aptos/tx-malformed");
  if (!Array.isArray(i.typeArguments) || !Array.isArray(i.arguments)) return refusal("aptos/tx-malformed");
  return digestJson({
    sender: i.sender,
    sequenceNumber: i.sequenceNumber.toString(),
    function: i.function,
    typeArguments: [...i.typeArguments],
    arguments: [...i.arguments],
  });
}

/**
 * The REST answer in the normal form: every address as `0x` and 64 lowercase hex, `{"inner": a}` as `a`, and the
 * amount as its decimal string. The REST answer carries no chain id, so the caller supplies the ledger's.
 */
export function committedInstrument(t: AptosCommitted, chainId: number): AptosInstrument | Refusal {
  if (!isUserTransaction(t) || t.payload.type !== "entry_function_payload") return refusal("aptos/not-an-x402-transfer");
  const sender = longAddress(t.sender);
  const sequenceNumber = decimalBelow(t.sequence_number, U64_LIMIT);
  const expiresAt = decimalBelow(t.expiration_timestamp_secs, U64_LIMIT);
  const fn = moveName(t.payload.function);
  const types = t.payload.type_arguments;
  const args = t.payload.arguments;
  if (sender === null || sequenceNumber === undefined || expiresAt === undefined || fn === null) {
    return refusal("aptos/not-an-x402-transfer");
  }
  if (!Array.isArray(types) || types.length !== 1 || !Array.isArray(args) || args.length !== 3) {
    return refusal("aptos/not-an-x402-transfer");
  }
  const typeArgument = moveName(types[0]);
  const first = longAddress(objectAddress(args[0]));
  const second = longAddress(objectAddress(args[1]));
  const amount = decimalBelow(args[2], U64_LIMIT);
  if (typeArgument === null || first === null || second === null || amount === undefined) {
    return refusal("aptos/not-an-x402-transfer");
  }
  const maxGasAmount = t.max_gas_amount === undefined ? undefined : decimalBelow(t.max_gas_amount, U64_LIMIT);
  const gasUnitPrice = t.gas_unit_price === undefined ? undefined : decimalBelow(t.gas_unit_price, U64_LIMIT);
  return {
    sender,
    sequenceNumber,
    expiresAt,
    chainId,
    ...(maxGasAmount === undefined ? {} : { maxGasAmount }),
    ...(gasUnitPrice === undefined ? {} : { gasUnitPrice }),
    function: fn,
    typeArguments: [typeArgument],
    arguments: [first, second, amount.toString()],
  };
}

/** A rejected read: a `ReaderError` by its kind, anything else `transport`. */
function rejected(e: unknown): UnreadableReason {
  const kind = e instanceof Error && e.name === "ReaderError" ? (e as { kind?: unknown }).kind : undefined;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/** The REST endpoint's ledger: one mark, and positions ordered by version. */
const APTOS_LEDGER: Ledger<bigint, "committed"> = {
  coverage: APTOS[ID].coverage,
  final: "committed",
  markOrder: () => 0,
  positionOrder: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

const FA_DEPOSIT = `${FRAMEWORK}::fungible_asset::Deposit`;
const OBJECT_CORE = `${FRAMEWORK}::object::ObjectCore`;
const FUNGIBLE_STORE = `${FRAMEWORK}::fungible_asset::FungibleStore`;
/**
 * The most events, and the most write-set changes, the read takes of one committed transaction: lcp's own bound on the
 * work one reader's answer asks of it. Aptos sets no count a REST answer is held to; an answer over it is `unparseable`.
 */
export const MAX_APTOS_READ_ITEMS = 4096;

/**
 * The read of the payment as the profile `x402/exact/aptos` states it, answered by the profile `read-status` at
 * coverage `none`. The act is the sender's committed transaction at the signed sequence number, found by the sender and
 * that number; a named hash is a hint, read first, since a fee payer's signature changes it, and a transaction the node
 * holds uncommitted ends nothing. The transaction found is classified from what landed: its signer, the sender, against
 * the option's payee; the account it names, the owner of each fungible-asset store a `Deposit` event credits, read from
 * the transaction's `ObjectCore` change at that store, against the payee; and whether it is another act the caller gave,
 * by its reference's sender and sequence number. A `settled` answer states `presented`: whether the transaction's
 * signed members, the sender, sequence number, entry function and arguments, gas members and expiry, are those the
 * reference holds. Where nothing is at the number, the account's own sequence number is read with that answer's ledger
 * time and history floor: a number the account has passed is consumed, its transaction not returned; one it has not
 * passed is live until the ledger's time in whole seconds reaches the signed expiry (aptos-core's
 * `transaction_validation.move` takes a transaction only while `timestamp::now_seconds() < txn_expiration_time`), and
 * unused after it, but only where the floor of each answer is at or below the position given, else `history-gap`. A
 * reader for another network, or a ledger for another chain, is `chain-mismatch`; a rejected read is `transport`, or by a
 * `ReaderError`'s kind `too-large` or `unparseable`; an answer of another shape, or a deposit whose store's owner the
 * answer does not show, or a committed answer without its events or its changes, is `unparseable`, never a transaction
 * that deposited nothing; a ref or query that is not one is `unparseable`, with nothing read.
 */
export async function aptosStatus(
  ref: AptosRef,
  reader: AptosReader,
  query: StatusQuery<AptosRef, bigint, "committed", bigint>,
): Promise<AptosStatus> {
  const bad: AptosStatus = { state: "unreadable", reason: "unparseable", foreign: [] };
  if (!isQuery(query, ["committed"], (p) => typeof p === "bigint" && p >= 0n && p < U64_LIMIT)) return bad;
  if (!isObject(ref)) return bad;
  const chainId = chainOf(ref.network);
  if (chainId === undefined) return bad;
  if (!isObject(reader) || reader.network !== ref.network) return { state: "unreadable", reason: "chain-mismatch", foreign: [] };
  const sequenceNumber = decimalBelow(ref.sequenceNumber, U64_LIMIT);
  const expiresAt = decimalBelow(ref.expiresAt, U64_LIMIT);
  const sender = typeof ref.sender === "string" && ADDRESS_64.test(ref.sender) ? (ref.sender.toLowerCase() as Hex) : null;
  const payee = longAddress(ref.payee);
  const idDigest = normalHash(ref.idDigest);
  const transaction = ref.transaction === undefined ? undefined : normalHash(ref.transaction);
  const gas = (v: unknown) => (v === undefined ? undefined : decimalBelow(v, U64_LIMIT) ?? null);
  const maxGas = gas(ref.maxGasAmount);
  const gasPrice = gas(ref.gasUnitPrice);
  if (sequenceNumber === undefined || expiresAt === undefined || sender === null || payee === null) return bad;
  if (idDigest === null || transaction === null || maxGas === null || gasPrice === null) return bad;
  const given = givenOf(query.others);
  try {
    const ledger = await reader.ledger();
    if (!isObject(ledger) || typeof ledger.timestampUsecs !== "bigint") return bad;
    if (ledger.chainId !== chainId) return { state: "unreadable", reason: "chain-mismatch", foreign: [] };
    let found: AptosCommitted | undefined;
    if (transaction !== undefined) {
      const named: unknown = await reader.byHash(transaction);
      if (named !== null && !isObject(named)) return bad;
      // A hint is passed over unless it names a user transaction: pending, or another kind the node commits.
      if (isObject(named) && named["type"] === "user_transaction") {
        if (!isCommitted(named)) return bad;
        if (longAddress(named.sender) === sender && named.sequence_number === sequenceNumber.toString()) found = named;
      }
    }
    if (found === undefined) {
      const looked: unknown = await reader.bySequence(sender, sequenceNumber);
      const readTo = notFoundPoint(looked, "timestampUsecs");
      if (readTo === undefined) {
        if (!isCommitted(looked)) return bad;
        if (longAddress(looked.sender) !== sender || looked.sequence_number !== sequenceNumber.toString()) return bad;
        found = looked;
      } else {
        const oldest = isObject(looked) ? looked["oldestVersion"] : undefined;
        if (oldest !== undefined && typeof oldest !== "bigint") return bad;
        const account: unknown = await reader.account(sender);
        if (!isObject(account) || typeof account["sequenceNumber"] !== "bigint" || typeof account["timestampUsecs"] !== "bigint") return bad;
        if (typeof account["oldestVersion"] !== "bigint") return bad;
        const floors = [account["oldestVersion"], ...(typeof oldest === "bigint" ? [oldest] : [])];
        const holds = query.after !== undefined && floors.every((f) => f <= query.after!);
        const consumed = account["sequenceNumber"] > sequenceNumber;
        const lapsed = !consumed && account["timestampUsecs"] / 1_000_000n >= expiresAt;
        // History is decided before instrument-unused, and before a number passed whose transaction did not come back.
        if ((consumed || lapsed) && !holds) return { state: "unreadable", reason: "history-gap", foreign: [] };
        const value = { consumed, lapsed, mark: "committed" as const, head: { consumed } };
        return decide({ seen: [], value, search: { whole: !consumed }, history: holds }, query, APTOS_LEDGER);
      }
    }
    const shown = committedInstrument(found, chainId);
    const presented = isRefusal(shown)
      ? "no"
      : await presentedOf(shown, { idDigest, expiresAt, ...(maxGas === undefined ? {} : { maxGas }), ...(gasPrice === undefined ? {} : { gasPrice }) });
    const seen = seenOf(found, sender, payee, given, presented);
    if (seen === undefined) return bad;
    const value = { consumed: true, lapsed: false, mark: "committed" as const, head: { consumed: true } };
    return decide({ seen: [seen], value, search: { whole: true }, history: true }, query, APTOS_LEDGER);
  } catch (e) {
    return { state: "unreadable", reason: rejected(e), foreign: [] };
  }
}

/** The other acts the caller gave by their references, as `sender:sequenceNumber`. */
function givenOf(others: readonly unknown[] | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  for (const o of others ?? []) {
    const r = isObject(o) ? o["ref"] : undefined;
    if (!isObject(r)) continue;
    const s = longAddress(r["sender"]);
    const n = decimalBelow(r["sequenceNumber"], U64_LIMIT);
    if (s !== null && n !== undefined) out.add(`${s}:${n}`);
  }
  return out;
}

/**
 * The committed transaction as the read met it, classified from what landed, with `presented` as the read compared it;
 * undefined where its version or hash, or one of its deposits, cannot be read.
 */
function seenOf(
  t: AptosCommitted,
  sender: Hex,
  payee: Hex,
  given: ReadonlySet<string>,
  presented: "yes" | "no" | "unshown",
): Seen<bigint, "committed"> | undefined {
  const version = decimalBelow(t.version, U64_LIMIT);
  const hash = normalHash(t.hash);
  const moved = hash === null ? undefined : depositsOf(t, hash);
  if (version === undefined || hash === null || moved === undefined) return undefined;
  const signer = longAddress(t.sender);
  // A failed result moved nothing: the account it names is the destination the payer signed (read-status rules 9, 20).
  const named = t.success ? moved.map((m) => m.to) : signedRecipients(t);
  return {
    transaction: hash,
    position: version,
    mark: "committed",
    result: t.success ? "succeeded" : "failed",
    consumed: true,
    carries: false,
    party: signer === payee ? "payee" : signer === sender ? "payer" : "other",
    kind: "same",
    account: named.some((to) => to === payee) ? "payee" : named.length > 0 ? "other" : "none",
    ...(given.has(`${sender}:${t.sequence_number}`) ? { given: true } : {}),
    presented,
    moved,
    ...(signer === null ? {} : { signer }),
  };
}

/**
 * Each fungible-asset deposit the transaction made, by its `Deposit` event: the store's owner, from the transaction's
 * `ObjectCore` change at the store, is the account it reached, and the store's `FungibleStore` change names its asset;
 * each named by the transaction and the index of its event among the transaction's `events`. Undefined where the
 * answer does not hold its events and changes, a deposit's owner is not shown, or an item is out of form: an answer
 * without its events is never read as one that deposited nothing.
 */
function depositsOf(t: AptosCommitted, transaction: Hex): Moved[] | undefined {
  const { events, changes } = t;
  if (!Array.isArray(events) || !Array.isArray(changes) || events.length > MAX_APTOS_READ_ITEMS || changes.length > MAX_APTOS_READ_ITEMS) return undefined;
  const at = (store: Hex, type: string): unknown => {
    const c = changes.find((x) => isObject(x) && x.type === "write_resource" && longAddress(x.address) === store && isObject(x.data) && moveName(x.data["type"]) === type);
    return c === undefined ? undefined : (c.data as Record<string, unknown>)["data"];
  };
  const out: Moved[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!isObject(e) || moveName(e["type"]) !== FA_DEPOSIT) continue;
    const data = e["data"];
    const store = isObject(data) ? longAddress(data["store"]) : null;
    const amount = isObject(data) ? decimalBelow(data["amount"], U64_LIMIT) : undefined;
    const core = store === null ? undefined : at(store, OBJECT_CORE);
    const owner = isObject(core) ? longAddress(core["owner"]) : null;
    if (store === null || amount === undefined || owner === null) return undefined;
    const fs = at(store, FUNGIBLE_STORE);
    const asset = isObject(fs) ? longAddress(objectAddress(fs["metadata"])) : null;
    out.push({ asset: asset ?? "", amount: amount.toString(), to: owner, transaction, place: i });
  }
  return out;
}

/**
 * The account the transaction's signed transfer names: `arguments[1]` of `0x1::primary_fungible_store::transfer`, the
 * owner whose primary store it pays. Another payload names none the read can take, `0x1::fungible_asset::transfer`
 * naming a store, whose owner only a deposit shows.
 */
function signedRecipients(t: AptosCommitted): Hex[] {
  const p = t.payload;
  if (p.type !== "entry_function_payload" || moveName(p.function) !== TRANSFERS[0] || !Array.isArray(p.arguments)) return [];
  const to = longAddress(objectAddress(p.arguments[1]));
  return to === null ? [] : [to];
}

/**
 * Whether the committed transaction is the payment the reference was built from: `yes` where every signed member the
 * reference holds equals the answer's, `no` where one differs, and `unshown` where the answer does not show one.
 */
async function presentedOf(
  shown: AptosInstrument,
  held: { idDigest: Hex; expiresAt: bigint; maxGas?: bigint; gasPrice?: bigint },
): Promise<"yes" | "no" | "unshown"> {
  const d = await aptosIdDigest(shown);
  if (isRefusal(d) || d !== held.idDigest || shown.expiresAt !== held.expiresAt) return "no";
  for (const [mine, theirs] of [[held.maxGas, shown.maxGasAmount], [held.gasPrice, shown.gasUnitPrice]] as const) {
    if (mine === undefined) continue;
    if (theirs === undefined) return "unshown";
    if (mine !== theirs) return "no";
  }
  return "yes";
}

/** The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not. */
function aptosOptionCheck(option: unknown): Refusal | undefined {
  if (!isObject(option) || option["scheme"] !== "exact") return refusal("x402/option-not-this-pairing");
  const network = option["network"];
  if (typeof network !== "string" || !network.startsWith("aptos:")) return refusal("x402/option-not-this-pairing");
  if (chainOf(network) === undefined) return refusal("aptos/network-malformed");
  const extra = option["extra"];
  if (extra !== undefined && !isObject(extra)) return refusal("x402/option-not-this-pairing");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  const asset = option["asset"];
  const payTo = option["payTo"];
  if (typeof asset !== "string" || !ADDRESS_64.test(asset)) return refusal("x402/option-not-this-pairing");
  if (typeof payTo !== "string" || !ADDRESS_64.test(payTo)) return refusal("x402/option-not-this-pairing");
  const amount = option["amount"];
  if (!isAmount(amount) || decimalBelow(amount, U64_LIMIT) === undefined) return refusal("x402/option-not-this-pairing");
  if (!isTimeoutSeconds(option["maxTimeoutSeconds"])) return refusal("x402/option-not-this-pairing");
  return undefined;
}

/** The filter step over `aptosOptionCheck`. */
const aptosFilter: OptionFilter = (o) => aptosOptionCheck(o) ?? true;

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(aptosFilter)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(aptosFilter)(doc);
}

/**
 * The wallet request: the scheme's own payment, which carries no hash. `complete` reads the signed transaction as
 * `reference` reads it, and refuses one with the code `reference` gives it: one fault, one code.
 */
async function build(
  choice: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<AptosUnsigned | Refusal> {
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  const ok = chosen(choice?.required, choice?.accepted, aptosFilter);
  if (ok !== true) return ok;
  const accepted = choice.accepted;
  const { required } = choice;
  return {
    request: { kind: "aptos-transaction", accepted },
    complete(signed: { transaction: string }): AptosPaymentPayload | Refusal {
      const payment = paymentWith(required, accepted, signed);
      const found = instrumentOf(payment);
      return isRefusal(found) ? found : payment;
    },
  };
}

/** The hash in the echoed, unsigned `extensions.legalContext`; the seller's claim ties it to this request. */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const parts = presentedWith(presented, aptosFilter);
  if (isRefusal(parts)) return parts;
  if (typeof parts.payload["transaction"] !== "string") return refusal("x402/payload-malformed");
  const lc = legalContextOf(parts.extensions);
  return isRefusal(lc) ? refusal("x402/no-legal-context") : lc.h;
}

/**
 * The read keys for this payment: sender, sequence number, expiry, the transfer's digest and the signed gas members, the
 * payment presented; and the payee, the `payTo` of the option the payment answers, which must be the option the
 * payment presents (`x402/accepted-not-option`).
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<AptosRef | Refusal> {
  const found = instrumentOf(presented);
  if (isRefusal(found)) return found;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const accepted = isObject(presented) ? canonicalJson(presented["accepted"]) : undefined;
  const offered = canonicalJson(option);
  if (typeof accepted !== "string" || typeof offered !== "string" || accepted !== offered) return refusal("x402/accepted-not-option");
  const idDigest = await aptosIdDigest(found.instrument);
  if (isRefusal(idDigest)) return idDigest;
  const i = found.instrument;
  return {
    network: found.network,
    sender: i.sender,
    sequenceNumber: i.sequenceNumber.toString(),
    expiresAt: i.expiresAt.toString(),
    idDigest,
    ...(i.maxGasAmount === undefined ? {} : { maxGasAmount: i.maxGasAmount.toString() }),
    ...(i.gasUnitPrice === undefined ? {} : { gasUnitPrice: i.gasUnitPrice.toString() }),
    payee,
  };
}

function instrumentOf(presented: unknown): { network: AptosNetwork; instrument: AptosInstrument } | Refusal {
  const parts = presentedWith(presented, aptosFilter);
  if (isRefusal(parts)) return parts;
  const transaction = parts.payload["transaction"];
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  const instrument = decodeAptosTx(transaction);
  if (isRefusal(instrument)) return instrument;
  const network = parts.accepted.network as AptosNetwork;
  if (instrument.chainId !== chainOf(network)) return refusal("aptos/chain-mismatch");
  return { network, instrument };
}

/**
 * The option unchanged: nothing of the hash rides in it. An option that carries a `refused` member is
 * `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "http-advisory",
  profile: "x402/exact/aptos",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/**
 * `x402/exact/aptos`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
 * transaction the payer signed and names its hash; `status` finds it by that hash, else by the payer's sender and
 * sequence number.
 */
export const exactAptos = Object.freeze({
  id: ID,
  data: APTOS[ID],
  pattern,
  claims: false as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: aptosStatus,
}) satisfies Entry<
  typeof ID,
  AptosPaymentPayload,
  AptosRef,
  AptosReader,
  X402Forms & {
    choice: { required: PaymentRequired; accepted: PaymentRequirements };
    unsigned: AptosUnsigned;
    landed: unknown;
    network: never;
    query: StatusQuery<AptosRef, bigint, "committed", bigint>;
    answer: AptosStatus;
  }
>;

/** A committed user transaction's members, any payload kind, without its events and changes. */
function isUserTransaction(t: unknown): t is Omit<AptosCommitted, "events" | "changes"> {
  if (!isObject(t) || t["type"] !== "user_transaction") return false;
  const p = t["payload"];
  return (
    typeof t["hash"] === "string" &&
    typeof t["version"] === "string" &&
    typeof t["success"] === "boolean" &&
    typeof t["sender"] === "string" &&
    typeof t["sequence_number"] === "string" &&
    typeof t["expiration_timestamp_secs"] === "string" &&
    isObject(p) &&
    typeof p["type"] === "string"
  );
}

/** A committed user transaction in the reader's form (`AptosCommitted`): its events and its changes held whole. */
function isCommitted(t: unknown): t is AptosCommitted {
  return isUserTransaction(t) && Array.isArray((t as Record<string, unknown>)["events"]) && Array.isArray((t as Record<string, unknown>)["changes"]);
}

function chainOf(network: string): number | undefined {
  const m = NETWORK.exec(network);
  if (m === null) return undefined;
  const id = Number(m[1]);
  return id >= 1 && id <= 255 ? id : undefined;
}

/** `0x` and 64 lowercase hex digits for an address written with 1 to 64 digits, or null. */
function longAddress(a: unknown): Hex | null {
  if (typeof a !== "string" || !ADDRESS_ANY.test(a)) return null;
  return `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** `<address>::<module>::<name>` with the address in long form, or null. */
function moveName(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const parts = s.split("::");
  if (parts.length !== 3) return null;
  const address = longAddress(parts[0]);
  if (address === null || !IDENT.test(parts[1]!) || !IDENT.test(parts[2]!)) return null;
  return `${address}::${parts[1]}::${parts[2]}`;
}

function objectAddress(v: unknown): unknown {
  return isObject(v) ? v["inner"] : v;
}

/**
 * The `transaction` byte array of x402's reference wire form, or undefined when the bytes are not that JSON: strict
 * UTF-8 JSON text whose first byte is `{`.
 */
function referenceForm(b: Uint8Array): Uint8Array | undefined {
  if (b[0] !== 0x7b) return undefined;
  let o: unknown;
  try {
    o = parseJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b));
  } catch {
    return undefined;
  }
  if (!isObject(o)) return undefined;
  const t = o["transaction"];
  if (!Array.isArray(t) || !t.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return undefined;
  return Uint8Array.from(t as number[]);
}

function leU64(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
  return v;
}

/** A bounded BCS reader; every read past the end throws, and the caller turns that into a refusal. */
class Reader {
  private at = 0;
  constructor(private readonly b: Uint8Array) {}

  bytes(n: number): Uint8Array {
    if (n < 0 || this.at + n > this.b.length) throw new RangeError("short");
    const out = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  u8(): number {
    return this.bytes(1)[0]!;
  }

  u64(): bigint {
    return leU64(this.bytes(8));
  }

  /** ULEB128 up to 2^32 - 1, in its shortest form. */
  uleb(): number {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      v += (byte & 0x7f) * 2 ** (7 * i);
      if ((byte & 0x80) === 0) {
        if (i > 0 && byte === 0) throw new RangeError("non-canonical");
        if (v > 0xffffffff) throw new RangeError("too large");
        return v;
      }
    }
    throw new RangeError("too long");
  }

  /**
   * A name of ASCII letters, digits and underscores, decoded strictly: a leading U+FEFF is kept, so the name fails the
   * identifier rule.
   */
  ident(): string {
    const s = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(this.bytes(this.uleb()));
    if (!IDENT.test(s)) throw new RangeError("identifier");
    return s;
  }
}
