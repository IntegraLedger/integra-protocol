/**
 * Sui, and the `x402/exact/sui` pairing: the ATR hash as the one `Pure` input of the payer's programmable transaction
 * that no command uses.
 *
 * The payer's signature covers it, the rail executes the transaction unchanged, and the hash stays on chain in the
 * transaction's input list. Settlement is read by the transaction digest, which the signed bytes fix before any money
 * moves. BCS decoding uses @mysten/sui, loaded once when this module is, and decoding a transaction's bytes is the one
 * step that needs it: without it a function refuses `sui/peer-missing` only when it reaches that step, after the checks
 * that need no peer; `build` gives the request it gives with it; and `status` reads as it does with it until it meets a
 * transaction's bytes, where the transaction the digest names is unreadable `unparseable`, and each transaction of the
 * sender's that the search passes is an item it could not decode, at which the search is held. A digest is base58, read
 * and written with the package's own dependency @scure/base, so it is checked without the peer.
 *
 * @module
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { base58 } from "@scure/base";
import type { bcs as SuiBcs } from "@mysten/sui/bcs";
import { fromRawBytes, toRawBytes, type AtrHash } from "./core.js";
import { canonicalJson } from "./internal/core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import type { SuiPaymentPayload } from "./internal/sui.js";
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
import { base64Bytes, decimalBelow, hexOf, sameBytes, toBase64, U64_LIMIT } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { SUI } from "./internal/data/sui.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import {
  decide,
  type Facts,
  type Moved,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type Undecoded,
  type UnreadableReason,
} from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { SuiPaymentPayload } from "./internal/sui.js";
export type { X402Read } from "./internal/x402.js";

const peer: { bcs: typeof SuiBcs } | undefined = await import("@mysten/sui/bcs").then(
  (b) => ({ bcs: b.bcs }),
  () => undefined,
);

export type SuiNetwork = "sui:mainnet" | "sui:testnet" | "sui:devnet";

/**
 * A decoded `TransactionData`: the bytes as received, their digest, the unused `Pure` inputs, and the epoch bound. `B`
 * is what its bytes are backed by: `decodeSuiTx` gives `SuiTx<ArrayBuffer>`, each byte field in its own fresh
 * `ArrayBuffer`, and `suiCarrier` takes any backing.
 */
export interface SuiTx<B extends ArrayBufferLike = ArrayBufferLike> {
  bytes: Uint8Array<B>;
  /** Base58 of Blake2b-256 over `"TransactionData::"` followed by the bytes. */
  digest: string;
  unusedPure: readonly Uint8Array<B>[];
  untilEpoch: bigint | null;
  /** The sender, who signed the bytes: `0x` and 64 lowercase hex digits. */
  sender: string;
  /** The transfers the signed commands name, each with the recipient it names (`SuiTransfer`). */
  transfers: readonly SuiTransfer[];
}

/**
 * A transfer a signed command names: `TransferObjects` to an address given as a `Pure` input, or a call of
 * `0x2::coin::send_funds<T>(coin, recipient)` with the recipient given so. `command` is the command's index among the
 * transaction's commands; `coinType` is the type the command shows, `T` of `send_funds`, or `0x2::sui::SUI` where every
 * object transferred is split from the gas coin, and absent where the bytes do not show it.
 */
export interface SuiTransfer {
  command: number;
  recipient: string;
  coinType?: string;
}

/** One owner's net change in one coin type, an entry of the effects' `balanceChanges`. */
export interface SuiBalanceChange {
  owner: string;
  coinType: string;
  amount: bigint;
}

export interface SuiExecuted {
  transactionBcs: Uint8Array;
  status: "SUCCESS" | "FAILURE";
  /** The checkpoint that holds the effects, or null for a transaction executed and not yet in one. */
  checkpoint: bigint | null;
  /** The effects' balance changes, each owner's net change in each coin type (`balanceChangesJson`). */
  balanceChanges: readonly SuiBalanceChange[];
}

/** A transaction a page of the search returns: its digest as the endpoint names it, with the read's members. */
export interface SuiFound extends SuiExecuted {
  digest: string;
}

/**
 * The range of checkpoints the endpoint states it holds for the sender filter of `transactions`
 * (`serviceConfig.availableRange(type: "Query", field: "transactions", filters: ["sentAddress"])`): its first and
 * last checkpoints, and the epoch of the last.
 */
export interface SuiSearchRange {
  first: bigint;
  last: bigint;
  epoch: bigint;
}

/** One page of the sender's transactions, in checkpoint order, with the endpoint's `pageInfo`. */
export interface SuiPage {
  transactions: readonly SuiFound[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * Bounded, read-only calls against one network's GraphQL endpoint. Every failure rejects, for example with
 * `ReaderError` from `@integraledger/lcp/evm`; any rejection reads as unreadable. `read` is one request, so one
 * snapshot: `query($d:String!){transaction(digest:$d){transactionBcs effects{status checkpoint{sequenceNumber}
 * balanceChangesJson}} checkpoint{epoch{epochId}} serviceConfig{availableRange(type:"Query",field:"transaction"){first{sequenceNumber}}
 * sender:availableRange(type:"Query",field:"transactions",filters:["sentAddress"]){first{sequenceNumber}
 * last{sequenceNumber epoch{epochId}}}}}`. `epoch` is the latest checkpoint's epoch. `firstCheckpoint` is the first
 * checkpoint from which the endpoint holds transactions (the available range's inclusive lower bound), or null when the
 * endpoint states none. `searchRange` is the range it states for the sender filter, its first and last checkpoints and
 * the last one's epoch (`SuiSearchRange`). Every executed transaction carries its effects' balance changes
 * (`balanceChangesJson`), each owner's net change in each coin type, whole: an answer without them is `unparseable`.
 */
export interface SuiReader {
  readonly network: SuiNetwork;
  read(digest: string): Promise<{
    tx: SuiExecuted | null;
    epoch: bigint;
    firstCheckpoint: bigint | null;
    /** The range the endpoint states it holds for the sender filter; null, or absent, where it states none. */
    searchRange?: SuiSearchRange | null;
  }>;
  /**
   * One page of the sender's transactions: `transactions(first, after: cursor, filter: {sentAddress: sender,
   * afterCheckpoint, beforeCheckpoint}) { pageInfo { hasNextPage endCursor } nodes { digest transactionBcs effects {
   * status checkpoint { sequenceNumber } balanceChangesJson } } }`, `cursor` null for the first page.
   */
  search(sender: string, afterCheckpoint: bigint, beforeCheckpoint: bigint, cursor: string | null): Promise<SuiPage>;
}

/**
 * The read keys: the network, the digest, the epoch bound, the payee, the `payTo` of the option the payment answers,
 * and the sender, by which the search for H finds the payer's acts. The digest is over the whole transaction data the
 * payer signed, its signatures apart, so it also names the payment presented.
 */
export interface SuiRef {
  network: SuiNetwork;
  payee: string;
  sender: string;
  digest: string;
  /** The last epoch the transaction can execute in, as a decimal string, or null when it sets no maximum epoch. */
  untilEpoch: string | null;
}

/**
 * The answer of `suiStatus`, as the profile `read-status` gives it, and on `settled` whether its act is the payment
 * presented. Positions are checkpoint sequence numbers, and so is the search's position. The one mark a query can ask
 * for is `final`, certified effects in a checkpoint; `executed`, a transaction the endpoint returns with no checkpoint,
 * is the state below it that the endpoint tells apart and no query names.
 */
export type SuiStatus = StatusAnswer<bigint, SuiMark, bigint>;

export type SuiMark = "executed" | "final";
/** The marks a query can ask for. */
const QUERY_MARKS: readonly SuiMark[] = ["final"];

/** The payload x402's Sui scheme defines. */
export interface SuiPayload {
  signature: string;
  transaction: string;
}

/** What `build` hands the payer's wallet, and how it checks what comes back. */
export interface SuiUnsigned {
  request: {
    kind: "sui-transaction";
    accepted: PaymentRequirements;
    pureInput: Uint8Array<ArrayBuffer>;
    expiration: "epoch-bounded";
  };
  /**
   * The payment, once the signed transaction carries H. `sent` is the transaction the client sent to the option's gas
   * station (`extra.gasStation`), base64 of its `TransactionData`: on the sponsored path it is required, and the signed
   * transaction must equal it in everything but the gas data (its owner, payment, price and budget), else
   * `sui/not-as-sent`, since a gas station that changed the sender, an input, a command or the expiration could raise
   * the amount or remove the lapse under a valid H.
   */
  complete(signed: SuiPayload, sent?: string): SuiPaymentPayload | Refusal;
}

const ID = "x402/exact/sui" as const;
/** `max_tx_size_bytes`: 128 KiB. */
const MAX_TX_BYTES = 128 * 1024;
const NETWORKS: readonly string[] = ["sui:mainnet", "sui:testnet", "sui:devnet"];
/**
 * The most balance changes the read takes of one executed transaction: lcp's own bound on the work one reader's answer
 * asks of it. Sui sets no count a GraphQL answer is held to; a transaction with more is out of the reader's form.
 */
export const MAX_SUI_BALANCE_CHANGES = 4096;
/**
 * The longest coin type, in characters, the read takes from a balance change: lcp's own bound on a reader's answer. Sui
 * bounds a type by its nesting (16) and its identifiers, not by its text; a coin type with type parameters, such as a
 * pool's share `…::reserve::CToken<P, T>`, is a coin type all the same.
 */
export const MAX_SUI_COIN_TYPE_LENGTH = 4096;
const PAY_TO = /^0x[0-9a-f]{64}$/;
const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const COIN_TYPE = new RegExp(`^0x[0-9a-fA-F]{1,64}::${IDENT}::${IDENT}$`);
const DIGEST_PREFIX = new TextEncoder().encode("TransactionData::");
/**
 * Sui's `max_type_argument_depth`, 16: Sui's transaction checks refuse a type with a node at that depth, the outermost
 * node at depth 1.
 */
const TYPE_DEPTH_LIMIT = 16;
const PRIMITIVE_TYPES: ReadonlySet<string> = new Set(["address", "bool", "signer", "u8", "u16", "u32", "u64", "u128", "u256"]);
/** A vector type and a struct type as @mysten/sui writes them, and reads them back to serialise them. */
const VECTOR_TYPE = /^vector<(.+)>$/;
const STRUCT_TYPE = /^([^:]+)::([^:]+)::([^<]+)(<(.+)>)?/;
const MOVE_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;
const MOVE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Decodes a base64 `TransactionData` V1 with a programmable kind. A programmable transaction with a type (a call's
 * type argument, a vector's element type, a funds withdrawal's type) that has a node at depth 16, Sui's type depth
 * limit, is `sui/tx-malformed`, the code of bytes that do not decode: @mysten/sui decodes a type by recursion, and the
 * bound gives the same answer whether this host's stack would hold the type or not. A V1 `TransactionData` of another
 * kind is `sui/not-programmable`, answered from its kind's tag before its body is decoded. The base64, the size bound
 * and the two tags are read without @mysten/sui: without it, bytes they refuse get the code they get with it, and any
 * other bytes are `sui/peer-missing`.
 */
export function decodeSuiTx(base64: string): SuiTx<ArrayBuffer> | Refusal {
  const bytes = base64Bytes(base64, MAX_TX_BYTES);
  if (bytes === "too-large") return refusal("sui/tx-too-large");
  if (bytes === "malformed") return refusal("sui/tx-malformed");
  // TransactionData opens with two BCS enum tags: its version, V1 (0), and its kind, ProgrammableTransaction (0), one
  // byte each. Both are read here, without the peer. V1 is the only version @mysten/sui reads: bytes that do not open
  // with its tag and a kind's do not decode. Another kind is answered from its tag before its body is decoded: the
  // bound below reads no type of it.
  if (bytes.length < 2 || bytes[0] !== 0) return refusal("sui/tx-malformed");
  if (bytes[1] !== 0) return refusal("sui/not-programmable");
  if (peer === undefined) return refusal("sui/peer-missing");
  const { bcs } = peer;

  let data: ReturnType<typeof SuiBcs.TransactionData.parse>;
  let epoch: bigint | null = null;
  try {
    data = bcs.TransactionData.parse(bytes);
    if (!typesOf(data).every(typeWithinDepth)) return refusal("sui/tx-malformed");
    // @mysten/sui reads an `Epoch` expiration as a JavaScript number, exact only up to 2^53 - 1, where Sui's epoch is
    // a u64. The expiration is the transaction's last field, so the epoch is read as a u64 from the last eight bytes,
    // and the round trip below holds only when those bytes are that field.
    let value: Parameters<typeof SuiBcs.TransactionData.serialize>[0] = data;
    if (data.$kind === "V1" && data.V1.expiration.$kind === "Epoch") {
      epoch = BigInt(bcs.U64.parse(bytes.subarray(bytes.length - 8)));
      value = { V1: { ...data.V1, expiration: { Epoch: epoch.toString() } } };
    }
    // BCS has one encoding per value: bytes that do not serialise back to themselves carry trailing or
    // non-canonical data.
    if (!sameBytes(bcs.TransactionData.serialize(value).toBytes(), bytes)) return refusal("sui/tx-malformed");
  } catch {
    return refusal("sui/tx-malformed");
  }
  if (data.$kind !== "V1") return refusal("sui/not-programmable");
  const v1 = data.V1;
  if (v1.kind.$kind !== "ProgrammableTransaction") return refusal("sui/not-programmable");
  const { inputs, commands } = v1.kind.ProgrammableTransaction;

  const used = new Set<number>();
  for (const command of commands) {
    for (const arg of commandArguments(command)) {
      if (arg.$kind === "Input") used.add(arg.Input);
    }
  }
  const unusedPure: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (input.$kind !== "Pure" || used.has(i)) continue;
    const b = base64Bytes(input.Pure.bytes, MAX_TX_BYTES);
    if (typeof b === "string") return refusal("sui/tx-malformed");
    unusedPure.push(b);
  }

  const exp = v1.expiration;
  let untilEpoch: bigint | null = null;
  if (exp.$kind === "Epoch") untilEpoch = epoch;
  else if (exp.$kind === "ValidDuring" && exp.ValidDuring.maxEpoch !== null) untilEpoch = BigInt(exp.ValidDuring.maxEpoch);
  else if (exp.$kind === "Validity" && exp.Validity.maxEpoch !== null) untilEpoch = BigInt(exp.Validity.maxEpoch);

  return { bytes, digest: suiDigest(bytes), unusedPure, untilEpoch, sender: v1.sender, transfers: transfersOf(inputs, commands) };
}

/** `0x2`, the Sui framework's package, as @mysten/sui writes an address. */
const SUI_FRAMEWORK = "0x" + "0".repeat(63) + "2";
/** SUI's coin type, the gas coin's. */
const SUI_COIN = "0x2::sui::SUI";

type ParsedInput = ReturnType<typeof SuiBcs.CallArg.parse>;

/**
 * The transfers the commands name (`SuiTransfer`): each `TransferObjects` whose address is a `Pure` input of 32 bytes,
 * and each call of `0x2::coin::send_funds<T>(coin, recipient)` whose recipient is one, the function @mysten/sui's
 * coin intents call to send funds to an address balance (`@mysten/sui` 2.35.0
 * `src/transactions/intents/CoinWithBalance.ts:436-445`).
 */
function transfersOf(inputs: readonly ParsedInput[], commands: readonly ParsedCommand[]): SuiTransfer[] {
  const address = (arg: ParsedArgument): string | undefined => {
    if (arg.$kind !== "Input") return undefined;
    const input = inputs[arg.Input];
    if (input === undefined || input.$kind !== "Pure") return undefined;
    const b = base64Bytes(input.Pure.bytes, 64);
    return typeof b === "string" || b.length !== 32 ? undefined : hexOf(b);
  };
  const gasSplits = new Set<number>();
  commands.forEach((c, i) => {
    if (c.$kind === "SplitCoins" && c.SplitCoins.coin.$kind === "GasCoin") gasSplits.add(i);
  });
  const fromGas = (a: ParsedArgument): boolean =>
    (a.$kind === "Result" && gasSplits.has(a.Result)) || (a.$kind === "NestedResult" && gasSplits.has(a.NestedResult[0]));
  const out: SuiTransfer[] = [];
  commands.forEach((c, command) => {
    if (c.$kind === "TransferObjects") {
      const recipient = address(c.TransferObjects.address);
      if (recipient === undefined) return;
      const objects = c.TransferObjects.objects;
      out.push(objects.length > 0 && objects.every(fromGas) ? { command, recipient, coinType: SUI_COIN } : { command, recipient });
    } else if (c.$kind === "MoveCall") {
      const call = c.MoveCall;
      if (call.package !== SUI_FRAMEWORK || call.module !== "coin" || call.function !== "send_funds") return;
      const recipient = call.arguments.length === 2 ? address(call.arguments[1]!) : undefined;
      if (recipient === undefined) return;
      const coinType = call.typeArguments[0];
      out.push(coinType === undefined ? { command, recipient } : { command, recipient, coinType });
    }
  });
  return out;
}

/**
 * The hash carried by exactly one unused `Pure` input of exactly 32 bytes. A `tx` that is not a decoded transaction, an
 * object whose `unusedPure` is an array of `Uint8Array`s, is `sui/tx-malformed`.
 */
export function suiCarrier(tx: SuiTx): AtrHash | Refusal {
  if (!isObject(tx) || !Array.isArray(tx.unusedPure) || !tx.unusedPure.every((b) => b instanceof Uint8Array)) {
    return refusal("sui/tx-malformed");
  }
  if (tx.unusedPure.length === 0) return refusal("sui/hash-not-carried");
  if (tx.unusedPure.length > 1) return refusal("sui/ambiguous");
  const h = fromRawBytes(tx.unusedPure[0]!);
  return h === null ? refusal("sui/hash-not-carried") : h;
}

/**
 * Whether a run has shown the facts the search for H rests on: that a `graphql` endpoint serves `sentAddress` with both
 * checkpoint bounds, states the range it holds for that filter, returns the sender's transactions in checkpoint order
 * with their bytes, and answers the range and every page of one search from one view. Not at this release (the
 * profile `x402/exact/sui`, rule 15): a search read whole proves no absence, so where the read would answer `failed`
 * for any reason but `before-position` it answers `pending`, `search-incomplete`, the search's position at its head.
 */
const SEARCH_SHOWN = false;
/**
 * The pages one call of `status` reads of the search before it answers with the search's position: lcp's own bound on
 * the reads one call makes. The next call resumes from that position.
 */
export const MAX_SUI_SEARCH_PAGES = 8;

/**
 * Answers the read of the recorded digest as the profile `read-status` gives it, with the search for H the profile
 * `x402/exact/sui` states. The digest is the single-use value: Sui derives it from the signed bytes alone, so the
 * transaction with it, succeeded or not, consumed it. That transaction must be these bytes carrying this hash, else
 * the answer is unreadable `unparseable`. It is classified from what landed: its signer, the sender, against the
 * option's payee and the reference's sender; the account it names, a positive balance change the payee's address owns
 * or a recipient a signed transfer names, against the payee; and whether it is another act the caller gave by its
 * reference. One with no checkpoint is in the state `executed`, after every checkpoint, so after the position given,
 * and below the final mark. An absent transaction can still land while the endpoint holds transactions from the
 * position given and the epoch at the search's head is not past its bound, or it has none; past it, it lapsed. Where
 * the read would answer `failed` for any reason but `before-position`, it reads the search for H: the sender's
 * transactions after the position given, or after the search's position an earlier answer returned, to the last
 * checkpoint the endpoint states it holds for the sender filter, at most `MAX_SUI_SEARCH_PAGES` pages a call, each transaction
 * read as `bound` reads one, those that carry H classified as the digest's is. A transaction it passes that does not
 * hash to its digest or does not decode is named among the items the search could not decode, held at the checkpoint
 * before it. A rejected read is
 * unreadable `transport`; an answer out of the reader's form `unparseable`; transaction bytes over the bound
 * `too-large`; a reader for another network `chain-mismatch`; a ref, a reader or a query that is not one is
 * `unparseable`, with nothing read.
 */
export async function suiStatus(
  ref: SuiRef & { h: AtrHash },
  reader: SuiReader,
  query: StatusQuery<SuiRef & { h: AtrHash }, bigint, SuiMark, bigint>,
): Promise<SuiStatus> {
  if (!isQuery(query, QUERY_MARKS, isCheckpoint)) return UNPARSEABLE;
  if (query.search !== undefined && !isCheckpoint(query.search)) return UNPARSEABLE;
  const keys = keysOf(ref, query);
  if (keys === undefined) return UNPARSEABLE;
  if (!isObject(reader) || typeof reader.network !== "string") return UNPARSEABLE;
  if (reader.network !== keys.network) return unreadable("chain-mismatch");
  const answer = await readOnce(reader, keys.digest);
  if (typeof answer === "string") return unreadable(answer);
  const { tx, epoch, firstCheckpoint, searchRange } = answer;
  const after = query.after;
  const holds = after !== undefined && firstCheckpoint !== null && firstCheckpoint <= after;

  if (tx !== null) {
    if (suiDigest(tx.transactionBcs) !== keys.digest) return unreadable("unparseable");
    const own = seenOf(keys, keys.digest, tx, true);
    // A transaction found by the digest whose bytes do not decode, or do not carry the H asked about, releases nothing.
    if (own === undefined || !own.carries) return unreadable("unparseable");
    if (tx.checkpoint === null) {
      const below: Facts<bigint, SuiMark, bigint> = {
        seen: [own],
        value: { consumed: true, lapsed: false, mark: "executed", head: { consumed: true } },
        search: { whole: true },
        history: holds,
      };
      // Executed and in no checkpoint yet: after every checkpoint, so after the position given.
      const { after: _placed, ...unplaced } = query;
      return decide(below, unplaced, LEDGER);
    }
    // The digest is read at the latest head the endpoint serves: consumed there, as at the final mark where in a checkpoint.
    const value = { consumed: true, lapsed: false, mark: "final", head: { consumed: true } } as const;
    const first = decide({ seen: [own], value, search: { whole: true }, history: holds }, query, LEDGER);
    if (first.state === "settled" || (first.state === "failed" && first.reason === "before-position")) {
      return first;
    }
    const found = await searchFor(reader, keys, query.search ?? after, searchRange);
    if ("unreadable" in found) return unreadable(found.unreadable);
    const facts = { seen: [own, ...found.seen], value, search: found.search, undecoded: found.undecoded, history: holds };
    return decide(facts, query, LEDGER);
  }

  if (!holds) return decide({ seen: [], search: { whole: true }, history: false }, query, LEDGER);
  const head = searchRange === undefined || searchRange === null ? epoch : searchRange.epoch;
  const lapsed = keys.untilEpoch !== null && head > keys.untilEpoch;
  if (!lapsed) {
    const live = { consumed: false, lapsed: false, mark: "final", head: { consumed: false } } as const;
    return decide({ seen: [], value: live, search: { whole: true }, history: true }, query, LEDGER);
  }
  const found = await searchFor(reader, keys, query.search ?? after, searchRange);
  if ("unreadable" in found) return unreadable(found.unreadable);
  const value = { consumed: false, lapsed: true, mark: "final", head: { consumed: false } } as const;
  return decide({ seen: found.seen, value, search: found.search, undecoded: found.undecoded, history: true }, query, LEDGER);
}

const LEDGER = ledgerOf<bigint, SuiMark>(SUI[ID].coverage, ["executed", "final"], bigintOrder);

function isCheckpoint(p: unknown): p is bigint {
  return typeof p === "bigint" && p >= 0n && p < U64_LIMIT;
}

function unreadable(reason: UnreadableReason): SuiStatus {
  return { state: "unreadable", reason, foreign: [] };
}

/** The reference's keys, checked, with the digests of the other acts the caller gave by their references. */
interface Keys {
  network: SuiNetwork;
  digest: string;
  untilEpoch: bigint | null;
  h: AtrHash;
  payee: string;
  sender: string;
  given: ReadonlySet<string>;
}

function keysOf(ref: SuiRef & { h: AtrHash }, query: { others?: readonly unknown[] }): Keys | undefined {
  if (!isObject(ref)) return undefined;
  const untilEpoch = ref.untilEpoch === null ? null : decimalBelow(ref.untilEpoch, U64_LIMIT);
  const h = normalHash(ref.h);
  if (!NETWORKS.includes(ref.network) || untilEpoch === undefined || h === null || !isDigest(ref.digest)) return undefined;
  if (typeof ref.payee !== "string" || !PAY_TO.test(ref.payee)) return undefined;
  if (typeof ref.sender !== "string" || !PAY_TO.test(ref.sender)) return undefined;
  const given = new Set<string>();
  for (const o of query.others ?? []) {
    const r = isObject(o) ? o["ref"] : undefined;
    if (isObject(r) && isDigest(r["digest"])) given.add(r["digest"]);
  }
  return { network: ref.network, digest: ref.digest, untilEpoch, h, payee: ref.payee, sender: ref.sender, given };
}

/**
 * A transaction the read met, classified from what landed, or undefined where its bytes do not decode. `consumed` for
 * the transaction with the reference's digest alone, which is also the one `presented` states `yes` of: the digest is
 * over the whole data the payer signed, so any other is another message.
 */
function seenOf(keys: Keys, digest: string, tx: SuiExecuted, consumed: boolean): Seen<bigint, SuiMark> | undefined {
  const decoded = decodeSuiTx(toBase64(tx.transactionBcs));
  if (isRefusal(decoded)) return undefined;
  const carried = suiCarrier(decoded);
  const sender = decoded.sender;
  // A failed result moved nothing but gas: the account it names is the recipient the payer signed (read-status rules
  // 9, 20), and what it moved is none.
  const failed = tx.status !== "SUCCESS";
  const moved = failed ? [] : movedOf(tx.balanceChanges, decoded.transfers, digest, sender);
  const named = failed ? decoded.transfers.map((t) => t.recipient).filter((to) => to !== sender) : moved.map((m) => m.to);
  return {
    transaction: digest,
    ...(tx.checkpoint === null ? {} : { position: tx.checkpoint }),
    mark: tx.checkpoint === null ? "executed" : "final",
    result: tx.status === "SUCCESS" ? "succeeded" : "failed",
    consumed,
    carries: !isRefusal(carried) && carried === keys.h,
    party: sender === keys.payee ? "payee" : sender === keys.sender ? "payer" : "other",
    kind: "same",
    account: named.some((to) => to === keys.payee) ? "payee" : named.length > 0 ? "other" : "none",
    ...(keys.given.has(digest) ? { given: true } : {}),
    presented: digest === keys.digest ? "yes" : "no",
    moved,
    signer: sender,
  };
}

/**
 * What moved, as observed, each entry named by the transaction's digest and its place in it: each positive balance
 * change, the account it reached being its owner, its place `<owner>:<coin type>`, one owner's net change in one coin
 * type; and each transfer a signed command names whose recipient no positive change in its coin type shows, a transfer
 * of zero or one the recipient's own gas outweighs, recorded with the recipient's net change in that coin type where it
 * has one, else zero, its place the command's index. A command whose coin type the bytes do not show is recorded with
 * no asset and zero where its recipient shows no positive change. A transfer to the sender, such as the remainder of a
 * balance sent back to it, is the sender's own and is not recorded.
 */
function movedOf(changes: readonly SuiBalanceChange[], transfers: readonly SuiTransfer[], digest: string, sender: string): Moved[] {
  const moved: Moved[] = changes
    .filter((c) => c.amount > 0n)
    .map((c) => ({ asset: c.coinType, amount: c.amount.toString(), to: c.owner, transaction: digest, place: `${c.owner}:${c.coinType}` }));
  for (const t of transfers) {
    if (t.recipient === sender) continue;
    const type = t.coinType === undefined ? undefined : normalType(t.coinType);
    if (moved.some((m) => m.to === t.recipient && (type === undefined || normalType(m.asset) === type))) continue;
    const net = type === undefined ? undefined : changes.find((c) => c.owner === t.recipient && normalType(c.coinType) === type);
    const amount = net === undefined ? "0" : net.amount.toString();
    moved.push({ asset: t.coinType ?? "", amount, to: t.recipient, transaction: digest, place: t.command });
  }
  return moved;
}

/** A type with every address written as `0x` and 64 lowercase hex digits, so that two spellings of one type compare equal. */
function normalType(t: string): string {
  return t.replace(/0x[0-9a-fA-F]{1,64}/g, (a) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`);
}

/**
 * True for a coin type a balance change may carry: a struct type `address::module::name`, with type parameters where
 * the struct has them, each a type, nested below Sui's type depth limit, at most `MAX_SUI_COIN_TYPE_LENGTH` characters.
 */
function isCoinType(s: unknown): s is string {
  if (typeof s !== "string" || s.length > MAX_SUI_COIN_TYPE_LENGTH) return false;
  const todo: [string, number, boolean][] = [[s, 1, true]];
  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    const [t, depth, struct] = next;
    if (depth >= TYPE_DEPTH_LIMIT) return false;
    if (!struct && PRIMITIVE_TYPES.has(t) && t !== "signer") continue;
    const vector = struct ? null : VECTOR_TYPE.exec(t);
    if (vector !== null) {
      todo.push([vector[1]!, depth + 1, false]);
      continue;
    }
    const open = t.indexOf("<");
    if (open >= 0 && !t.endsWith(">")) return false;
    const parts = (open < 0 ? t : t.slice(0, open)).split("::");
    if (parts.length !== 3 || !MOVE_ADDRESS.test(parts[0]!) || !MOVE_IDENT.test(parts[1]!) || !MOVE_IDENT.test(parts[2]!)) return false;
    if (open >= 0) {
      for (const p of typeParameters(t.slice(open + 1, -1))) {
        if (p === "") return false;
        todo.push([p, depth + 1, false]);
      }
    }
  }
  return true;
}

/**
 * The search for H in the sender's transactions after `start`, to the last checkpoint the endpoint states it holds for
 * the sender filter. A range that is not stated, or begins after `start`, is `history-gap`; no `start` leaves the
 * search not read, with no position.
 */
async function searchFor(
  reader: SuiReader,
  keys: Keys,
  start: bigint | undefined,
  range: SuiSearchRange | null | undefined,
): Promise<
  | { seen: Seen<bigint, SuiMark>[]; search: { whole: boolean; at?: bigint }; undecoded: Undecoded<bigint>[] }
  | { unreadable: UnreadableReason }
> {
  if (start === undefined) return { seen: [], search: { whole: false }, undecoded: [] };
  if (range === undefined || range === null || range.first > start) return { unreadable: "history-gap" };
  const head = range.last;
  const seen: Seen<bigint, SuiMark>[] = [];
  const undecoded: Undecoded<bigint>[] = [];
  let last = start;
  let cursor: string | null = null;
  let done = head <= start;
  for (let pages = 0; !done && pages < MAX_SUI_SEARCH_PAGES; pages++) {
    let page: unknown;
    try {
      page = await reader.search(keys.sender, start, head + 1n, cursor);
    } catch {
      return { unreadable: "transport" };
    }
    const checked = pageOf(page, start, head);
    if (typeof checked === "string") return { unreadable: checked };
    for (const found of checked.transactions) {
      last = found.checkpoint;
      if (found.digest === keys.digest) continue;
      const decoded =
        "transactionBcs" in found && suiDigest(found.transactionBcs) === found.digest ? seenOf(keys, found.digest, found, false) : undefined;
      if (decoded === undefined) {
        // Held at the checkpoint before it, the last all of whose transactions of the sender were read before it.
        undecoded.push({ transaction: found.digest, at: found.checkpoint - 1n });
        continue;
      }
      if (decoded.carries) seen.push(decoded);
    }
    if (!checked.hasNextPage) done = true;
    else if (checked.endCursor === null) return { unreadable: "unparseable" };
    else cursor = checked.endCursor;
  }
  const at = done ? (head > start ? head : start) : last > start ? last - 1n : start;
  const whole = done && SEARCH_SHOWN;
  return { seen, search: whole ? { whole } : { whole, at }, undecoded };
}

/**
 * A page of the search, its shape checked, every transaction named by its digest in a checkpoint of the range, in
 * checkpoint order. A transaction so named whose other members are out of the reader's form is kept by its digest and
 * checkpoint alone, an item the search could not decode, and fails nothing else of the page (read-status rule 19).
 */
function pageOf(
  page: unknown,
  start: bigint,
  head: bigint,
):
  | { transactions: ((SuiFound & { checkpoint: bigint }) | { digest: string; checkpoint: bigint })[]; hasNextPage: boolean; endCursor: string | null }
  | "unparseable" {
  if (!isObject(page) || !Array.isArray(page["transactions"]) || typeof page["hasNextPage"] !== "boolean") return "unparseable";
  const endCursor = page["endCursor"];
  if (endCursor !== null && typeof endCursor !== "string") return "unparseable";
  const out: ((SuiFound & { checkpoint: bigint }) | { digest: string; checkpoint: bigint })[] = [];
  let previous = start;
  for (const t of page["transactions"] as unknown[]) {
    const digest = isObject(t) ? t["digest"] : undefined;
    const checkpoint = isObject(t) ? t["checkpoint"] : undefined;
    if (!isDigest(digest) || !isCheckpoint(checkpoint) || checkpoint <= start || checkpoint > head || checkpoint < previous) {
      return "unparseable";
    }
    previous = checkpoint;
    const executed = executedOf(t);
    out.push(typeof executed === "string" ? { digest, checkpoint } : { ...executed, digest, checkpoint });
  }
  return { transactions: out, hasNextPage: page["hasNextPage"], endCursor };
}

/**
 * Reads the hash back from the executed transaction alone, by its digest, the input's `tx`; the input's `option` is
 * the option the payment answers, an object, of which the read needs no member. An input whose `tx` is not base58 of
 * 32 bytes, or whose option is not an object, is `sui/wrong-reader`, with nothing read. Bytes that do not hash to the
 * digest are `sui/unreadable`; bytes that do, and that `decodeSuiTx` refuses, give its refusal, as `suiStatus` reads
 * no act in them. Without @mysten/sui the transaction cannot be decoded: bytes that hash to the digest, of a
 * transaction that did not abort, are `sui/peer-missing`, after the input, the reader and the read are checked, which
 * need no peer. One call.
 */
export async function suiRecover(
  input: RecoverInput<SuiNetwork, PaymentRequirements | MppChallenge>,
  reader: SuiReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("sui/wrong-reader");
  if (!isDigest(input.tx) || !isObject(input.option)) return refusal("sui/wrong-reader");
  const answer = await readOnce(reader, input.tx);
  if (typeof answer === "string") return refusal("sui/unreadable");
  const { tx } = answer;
  if (tx === null) return refusal("sui/not-found");
  if (suiDigest(tx.transactionBcs) !== input.tx) return refusal("sui/unreadable");
  if (tx.status === "FAILURE") return refusal("sui/aborted");
  const decoded = decodeSuiTx(toBase64(tx.transactionBcs));
  if (isRefusal(decoded)) return decoded;
  return suiCarrier(decoded);
}

/** The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not. */
function suiOptionCheck(option: unknown): Refusal | undefined {
  if (!isObject(option) || option["scheme"] !== "exact") return refusal("x402/option-not-this-pairing");
  const network = option["network"];
  if (typeof network !== "string" || !network.startsWith("sui:")) return refusal("x402/option-not-this-pairing");
  if (!NETWORKS.includes(network)) return refusal("sui/network-malformed");
  const extra = option["extra"];
  if (extra !== undefined && !isObject(extra)) return refusal("x402/option-not-this-pairing");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  // The gas path the option fixes (the profile, rule 7): sponsored by the gas station `extra.gasStation` names, an
  // https URL; gasless where `extra.gasless` is true; else the buyer pays. Never both.
  const station = extra?.["gasStation"];
  const gasless = extra?.["gasless"];
  if (station !== undefined && !isStation(station)) return refusal("x402/option-not-this-pairing");
  if (gasless !== undefined && (gasless !== true || station !== undefined)) return refusal("x402/option-not-this-pairing");
  const payTo = option["payTo"];
  const asset = option["asset"];
  if (typeof payTo !== "string" || !PAY_TO.test(payTo)) return refusal("x402/option-not-this-pairing");
  if (typeof asset !== "string" || !COIN_TYPE.test(asset)) return refusal("x402/option-not-this-pairing");
  // The agreement's floor by gas path (the profile, rule 16): zero where a sponsor or the buyer pays gas; on the gasless
  // path the coin type's smallest transfer on the network, a ledger parameter, so "0" is not admitted there.
  const amount = option["amount"];
  const zero = amount === "0" && gasless === undefined;
  if (!(isAmount(amount) || zero) || decimalBelow(amount, U64_LIMIT) === undefined) return refusal("x402/option-not-this-pairing");
  if (!isTimeoutSeconds(option["maxTimeoutSeconds"])) return refusal("x402/option-not-this-pairing");
  return undefined;
}

/** An https URL of at most 2048 characters, as the gas station's endpoint. */
function isStation(v: unknown): boolean {
  if (typeof v !== "string" || v.length > 2048) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** The filter step over `suiOptionCheck`. */
const suiFilter: OptionFilter = (o) => suiOptionCheck(o) ?? true;

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(suiFilter)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(suiFilter)(doc);
}

/**
 * The wallet request: the scheme's payment plus one unused `Pure` input holding the hash, bounded by epoch. H is checked
 * first, then the choice's document and option. The request is written without @mysten/sui, so `build` gives it with
 * the peer and without it. `complete` reads the signed transaction as `bound` does: one whose hash is not H, or that
 * `bound` refuses, is `x402/signed-not-bound`; without the peer, a transaction whose form, size and tags pass is
 * `sui/peer-missing`, as its decode is the one step that needs the peer.
 */
async function build(
  choice: { required: PaymentRequired; accepted: PaymentRequirements },
  h: AtrHash,
): Promise<SuiUnsigned | Refusal> {
  const expected = normalHash(h);
  if (expected === null) return refusal("x402/payload-malformed");
  const ok = chosen(choice?.required, choice?.accepted, suiFilter);
  if (ok !== true) return ok;
  const accepted = choice.accepted;
  const { required } = choice;
  return {
    request: { kind: "sui-transaction", accepted, pureInput: toRawBytes(expected), expiration: "epoch-bounded" },
    complete(signed: SuiPayload, sent?: string): SuiPaymentPayload | Refusal {
      const payment = paymentWith(required, accepted, signed);
      const got = boundNow(payment);
      if (isRefusal(got) && got.code === "sui/peer-missing") return got;
      if (isRefusal(got) || got !== expected) return refusal("x402/signed-not-bound");
      const sponsored = isObject(accepted.extra) && accepted.extra["gasStation"] !== undefined;
      if (sponsored || sent !== undefined) {
        const same = sameButGas(signed.transaction, sent);
        if (same !== true) return same;
      }
      return payment;
    },
  };
}

/**
 * True where `signed` equals `sent` in everything but the gas data: the sender, the transaction kind (its inputs and
 * commands) and the expiration, compared as their BCS bytes. `sui/not-as-sent` where they differ, or where `sent` is
 * absent or does not decode; `sui/peer-missing` without @mysten/sui.
 */
function sameButGas(signed: unknown, sent: unknown): true | Refusal {
  if (typeof signed !== "string" || typeof sent !== "string") return refusal("sui/not-as-sent");
  if (peer === undefined) return refusal("sui/peer-missing");
  const { bcs } = peer;
  const parse = (b64: string) => {
    const bytes = base64Bytes(b64, MAX_TX_BYTES);
    if (typeof bytes === "string") return undefined;
    try {
      const d = bcs.TransactionData.parse(bytes);
      return d.$kind === "V1" ? d.V1 : undefined;
    } catch {
      return undefined;
    }
  };
  const a = parse(signed);
  const b = parse(sent);
  if (a === undefined || b === undefined) return refusal("sui/not-as-sent");
  const same =
    a.sender === b.sender &&
    sameBytes(bcs.TransactionKind.serialize(a.kind).toBytes(), bcs.TransactionKind.serialize(b.kind).toBytes()) &&
    sameBytes(bcs.TransactionExpiration.serialize(a.expiration).toBytes(), bcs.TransactionExpiration.serialize(b.expiration).toBytes());
  return same ? true : refusal("sui/not-as-sent");
}

/** The hash inside the transaction the payer signed. The signature is not verified here. */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  return boundNow(presented);
}

/**
 * The read keys for this payment: network, digest and the epoch bound, null for a transaction that sets none; the
 * sender; and the payee, the `payTo` of the option the payment answers, which must be the option the payment presents.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<SuiRef | Refusal> {
  return referenceNow(presented, option);
}

function boundNow(presented: unknown): AtrHash | Refusal {
  const tx = presentedTx(presented);
  return isRefusal(tx) ? tx : suiCarrier(tx.tx);
}

function referenceNow(presented: unknown, option: PaymentRequirements): SuiRef | Refusal {
  const tx = presentedTx(presented);
  if (isRefusal(tx)) return tx;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const accepted = acceptedIs(presented, option);
  if (accepted !== undefined) return accepted;
  const { digest, untilEpoch, sender } = tx.tx;
  return { network: tx.network, payee, sender, digest, untilEpoch: untilEpoch === null ? null : untilEpoch.toString() };
}

/**
 * Undefined where the presented payment's `accepted` is the option `reference` is given, compared by RFC 8785 form;
 * else `x402/accepted-not-option`.
 */
function acceptedIs(presented: unknown, option: PaymentRequirements): Refusal | undefined {
  const accepted = isObject(presented) ? presented["accepted"] : undefined;
  const a = canonicalJson(accepted);
  const b = canonicalJson(option);
  return typeof a === "string" && typeof b === "string" && a === b ? undefined : refusal("x402/accepted-not-option");
}

function presentedTx(presented: unknown): { network: SuiNetwork; tx: SuiTx } | Refusal {
  const parts = presentedWith(presented, suiFilter);
  if (isRefusal(parts)) return parts;
  const { signature, transaction } = parts.payload;
  if (typeof signature !== "string" || signature.length === 0) return refusal("x402/signature-malformed");
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  const tx = decodeSuiTx(transaction);
  if (isRefusal(tx)) return tx;
  return { network: parts.accepted.network as SuiNetwork, tx };
}

/**
 * The option unchanged: the hash rides in the transaction, not in the option. An option that carries a `refused` member
 * is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/**
 * The agreement's floor, the smallest amount an agreement option can name, in the coin type's base units, by the gas
 * path the option fixes (the profile `x402-exact-sui`, rules 7 and 16): 0 where the buyer pays gas (`buyer`, the option
 * carrying neither `extra.gasStation` nor `extra.gasless`) or a sponsor does (`sponsored`, `extra.gasStation`); on the
 * gasless path (`gasless`, `extra.gasless` true) the coin type's smallest transfer on the network, `smallestTransfer`:
 * the minimum Sui's protocol configuration lists beside the coin type among the tokens a gasless transaction may move
 * (`gasless_allowed_token_types`), which the caller reads for the option's network, since a protocol upgrade can change
 * it. A gas path not one of the three, or on the gasless path a `smallestTransfer` that is not a non-negative bigint, is
 * `sui/floor-input`. The option filter refuses an amount of `"0"` on the gasless path whatever the floor (rule 16).
 */
export function suiFloor(input: { gasPath: "buyer" | "sponsored" | "gasless"; smallestTransfer?: bigint }): bigint | Refusal {
  if (!isObject(input)) return refusal("sui/floor-input");
  const { gasPath, smallestTransfer } = input;
  if (gasPath === "buyer" || gasPath === "sponsored") return 0n;
  if (gasPath !== "gasless" || typeof smallestTransfer !== "bigint" || smallestTransfer < 0n) return refusal("sui/floor-input");
  return smallestTransfer;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/sui`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator executes the
 * transaction the payer signed; `status` reads it by the digest the signed bytes fix.
 */
export const exactSui = Object.freeze({
  id: ID,
  data: SUI[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: suiStatus,
  recover: suiRecover,
}) satisfies Entry<
  typeof ID,
  SuiPaymentPayload,
  SuiRef,
  SuiReader,
  X402Forms & {
    choice: { required: PaymentRequired; accepted: PaymentRequirements };
    unsigned: SuiUnsigned;
    landed: { h: AtrHash };
    network: SuiNetwork;
    query: StatusQuery<SuiRef & { h: AtrHash }, bigint, SuiMark, bigint>;
    answer: SuiStatus;
  }
>;

type ParsedCommand = ReturnType<typeof SuiBcs.Command.parse>;
type ParsedArgument = ReturnType<typeof SuiBcs.Argument.parse>;

/** Every argument a command names: the definition of "used" that Sui's own gasless check applies. */
function commandArguments(c: ParsedCommand): readonly ParsedArgument[] {
  switch (c.$kind) {
    case "MoveCall":
      return c.MoveCall.arguments;
    case "TransferObjects":
      return [...c.TransferObjects.objects, c.TransferObjects.address];
    case "SplitCoins":
      return [c.SplitCoins.coin, ...c.SplitCoins.amounts];
    case "MergeCoins":
      return [c.MergeCoins.destination, ...c.MergeCoins.sources];
    case "MakeMoveVec":
      return c.MakeMoveVec.elements;
    case "Upgrade":
      return [c.Upgrade.ticket];
    case "Publish":
      return [];
  }
}

/**
 * The types a programmable transaction carries: each call's type arguments, each vector's element type, and each funds
 * withdrawal's type. None for any other kind. Each is listed on its own, so the list takes constant stack however many
 * types a call carries.
 */
function typesOf(data: ReturnType<typeof SuiBcs.TransactionData.parse>): readonly string[] {
  if (data.$kind !== "V1" || data.V1.kind.$kind !== "ProgrammableTransaction") return [];
  const { inputs, commands } = data.V1.kind.ProgrammableTransaction;
  const out: string[] = [];
  for (const input of inputs) {
    if (input.$kind === "FundsWithdrawal") out.push(input.FundsWithdrawal.typeArg.Balance);
  }
  for (const command of commands) {
    if (command.$kind === "MoveCall") for (const type of command.MoveCall.typeArguments) out.push(type);
    else if (command.$kind === "MakeMoveVec" && command.MakeMoveVec.type !== null) out.push(command.MakeMoveVec.type);
  }
  return out;
}

/**
 * True when every node of `type`, as @mysten/sui writes a type, sits at a depth below `TYPE_DEPTH_LIMIT`. The walk
 * reads the text one level at a time the way @mysten/sui reads it back, keeps its own list and stops at the limit: a
 * primitive, `vector<T>`, or `address::module::name` followed by `<T, U, …>` when the struct has type parameters, split
 * on the commas outside angle brackets. Text that reads as no type is not within the limit.
 */
function typeWithinDepth(type: string): boolean {
  const todo: [string, number][] = [[type, 1]];
  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    const [t, depth] = next;
    if (depth >= TYPE_DEPTH_LIMIT) return false;
    if (PRIMITIVE_TYPES.has(t)) continue;
    const vector = VECTOR_TYPE.exec(t);
    if (vector !== null) {
      todo.push([vector[1]!, depth + 1]);
      continue;
    }
    const struct = STRUCT_TYPE.exec(t);
    if (struct === null) return false;
    if (struct[5] !== undefined) for (const p of typeParameters(struct[5])) todo.push([p, depth + 1]);
  }
  return true;
}

/** `a, b<c, d>` split on the commas outside angle brackets, each part trimmed. */
function typeParameters(s: string): string[] {
  const out: string[] = [];
  let level = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<") level++;
    else if (c === ">") level--;
    else if (c === "," && level === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/**
 * True for a transaction digest as `suiDigest` writes one: base58 of 32 bytes, at most 44 characters, as @mysten/sui's
 * `isValidTransactionDigest` reads it with the same base58.
 */
function isDigest(d: unknown): d is string {
  if (typeof d !== "string" || d.length > 44) return false;
  try {
    return base58.decode(d).length === 32;
  } catch {
    return false;
  }
}

/** The digest: base58 of the BLAKE2b-256 of `TransactionData::` and the bytes. */
function suiDigest(bytes: Uint8Array): string {
  const m = new Uint8Array(DIGEST_PREFIX.length + bytes.length);
  m.set(DIGEST_PREFIX, 0);
  m.set(bytes, DIGEST_PREFIX.length);
  return base58.encode(blake2b(m, { dkLen: 32 }));
}

/**
 * One read, with its answer's shape checked; `transport` for a failed read, `too-large` for transaction bytes over the
 * bound, and `unparseable` for any other malformed answer.
 */
async function readOnce(
  reader: SuiReader,
  digest: string,
): Promise<
  | { tx: SuiExecuted | null; epoch: bigint; firstCheckpoint: bigint | null; searchRange: SuiSearchRange | null }
  | "transport"
  | "unparseable"
  | "too-large"
> {
  let answer: unknown;
  try {
    answer = await reader.read(digest);
  } catch {
    return "transport";
  }
  if (!isObject(answer) || typeof answer["epoch"] !== "bigint") return "unparseable";
  const epoch = answer["epoch"];
  const firstCheckpoint = answer["firstCheckpoint"];
  if (firstCheckpoint !== null && typeof firstCheckpoint !== "bigint") return "unparseable";
  const range = answer["searchRange"];
  let searchRange: SuiSearchRange | null = null;
  if (range !== undefined && range !== null) {
    if (!isObject(range) || !isCheckpoint(range["first"]) || !isCheckpoint(range["last"]) || typeof range["epoch"] !== "bigint") {
      return "unparseable";
    }
    searchRange = { first: range["first"], last: range["last"], epoch: range["epoch"] };
  }
  const tx = answer["tx"];
  if (tx === null) return { tx: null, epoch, firstCheckpoint, searchRange };
  const executed = executedOf(tx);
  return typeof executed === "string" ? executed : { tx: executed, epoch, firstCheckpoint, searchRange };
}

/** An executed transaction as a reader gives it, its shape checked; its owners' addresses read in lowercase. */
function executedOf(tx: unknown): SuiExecuted | "unparseable" | "too-large" {
  if (!isObject(tx) || !(tx["transactionBcs"] instanceof Uint8Array)) return "unparseable";
  if (tx["status"] !== "SUCCESS" && tx["status"] !== "FAILURE") return "unparseable";
  if (tx["checkpoint"] !== null && !isCheckpoint(tx["checkpoint"])) return "unparseable";
  if (tx["transactionBcs"].length > MAX_TX_BYTES) return "too-large";
  const changes = tx["balanceChanges"];
  if (!Array.isArray(changes) || changes.length > MAX_SUI_BALANCE_CHANGES) return "unparseable";
  const balanceChanges: SuiBalanceChange[] = [];
  for (const c of changes as unknown[]) {
    if (!isObject(c) || typeof c["owner"] !== "string" || !PAY_TO.test(c["owner"].toLowerCase())) return "unparseable";
    if (!isCoinType(c["coinType"]) || typeof c["amount"] !== "bigint") return "unparseable";
    balanceChanges.push({ owner: c["owner"].toLowerCase(), coinType: c["coinType"], amount: c["amount"] });
  }
  return {
    transactionBcs: tx["transactionBcs"],
    status: tx["status"],
    checkpoint: tx["checkpoint"] as bigint | null,
    balanceChanges,
  };
}
