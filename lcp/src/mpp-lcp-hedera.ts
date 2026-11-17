/**
 * `mpp/charge/lcp/hedera`, the `lcp` method's Hedera rail (profile `mpp/method/lcp`, rules 12 to 25): one
 * `TransferTransaction` the buyer signs whose body memo is H's LCP string, submitted unchanged by the party that
 * broadcasts, or a payment its payer broadcast, read as landed; read back through the Mirror Node as
 * `x402/exact/hedera` is.
 */
import { hash, toLcpString, type AtrHash, type Json } from "./core.js";
import { deepFreeze } from "./fields.js";
import {
  decodeHederaTx,
  exactHedera,
  hederaStatus,
  txIdMirror,
  type HederaBody,
  type HederaNetwork,
  type HederaReader,
  type HederaRef,
  type HederaRow,
  type HederaStatus,
  type HederaTransfer,
  type MirrorEntry,
} from "./hedera.js";
import { HEDERA } from "./internal/data/hedera.js";
import { amountOf, INT64_LIMIT, isEntity } from "./internal/hedera.js";
import {
  completeWith,
  counted,
  FEE_ACCOUNTS,
  ENCODER,
  entriesOf,
  fieldsOf,
  memoOf,
  netOf,
  partiesOf,
  single,
  UINT64_LIMIT,
  writeBody,
} from "./internal/hedera-wire.js";
import { echoesOption } from "./internal/mpp-evm-read.js";
import { mppPayee } from "./internal/payee.js";
import type { Act, StatusQuery } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";
import {
  byType,
  chosenFor,
  credentialOf,
  echoedFor,
  FETCHED,
  fetchedOf,
  isObject,
  mppBroadcaster,
  offeredFor,
  place,
  pushedField,
  read,
  tie,
  type MppChallenge,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import { clockOf, lcpCredential, lcpPayloadType, type LcpValidation } from "./mpp-lcp.js";
import { fromBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

const ID = "mpp/charge/lcp/hedera" as const;
const SUCCESS = "SUCCESS";
/** A transaction id as the SDK spells it, `shard.realm.num@seconds.nanos`, the nanoseconds in nine digits. */
const TX_TEXT = /^((?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18}))@(0|[1-9][0-9]{0,18})\.([0-9]{9})$/;
/** A transaction id as the Mirror Node spells it, `shard.realm.num-seconds-nanos`. */
const MIRROR_ID = /^((?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18}))-(\d{1,19})-(\d{1,9})$/;
const TIMESTAMP = /^(\d{1,19})\.(\d{9})$/;

type Obj = { [k: string]: Json };
type HederaQuery = StatusQuery<LcpHederaRef, string, "consensus", string>;

/** The buyer's inputs to `build`: the paying account, the node, the valid start, the maximum fee and, for a token, its decimals. */
export interface LcpHederaChoice {
  challenge: MppChallenge & { id: string };
  /** The buyer's account, `shard.realm.num`: the one account the body debits. */
  payer: string;
  /** The node the body is for, `shard.realm.num`. */
  node: string;
  validStart: { seconds: bigint; nanos: number };
  /** The most the fee payer pays, in tinybars. */
  maxFee: bigint;
  /** A token's decimals, written as the token list's `expected_decimals`. */
  decimals?: number;
}

/** The body the buyer signs, and how its signature completes the credential. */
export interface LcpHederaUnsigned {
  request: { kind: "hedera-body"; bodyBytes: Uint8Array<ArrayBuffer> };
  /**
   * The credential `{type: "transaction", transaction}`, `transaction` the base64 of the wire `Transaction` the one
   * signature completes, measured against the credential bound (`mpp/credential-malformed`); a signature pair of the
   * wrong key or signature length is `hedera/tx-malformed`.
   */
  complete(s: { publicKey: Uint8Array; signature: Uint8Array; type: "ed25519" | "ecdsa-secp256k1" }): MppCredential | Refusal;
}

/**
 * The read keys of a presented payment: `HederaRef`; for a `transaction` credential `bodyDigest`, the SHA-256 of the
 * signed body's bytes, which with the network, the debited account and the transaction id names the instrument; and
 * `named` where the credential is a `hash` one, which presents the transaction its payer broadcast and nothing beside it.
 */
export type LcpHederaRef = HederaRef & { bodyDigest?: AtrHash; named?: true };

/** What `fetchPresented` writes under `FETCHED` for a `hash` credential: the landed `SUCCESS` entry. */
export interface LcpHederaLanded {
  entry: MirrorEntry;
}

/** The echoed challenge held to the pairing's filter, and the payload's type. */
function heldCredential(
  input: unknown,
): { credential: MppCredential; h: AtrHash; request: Obj; details: Obj; type: "transaction" | "hash" } | Refusal {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const type = lcpPayloadType(e.payload);
  if (isRefusal(type)) return type;
  return { credential, h: e.h, request: e.checked.request, details: e.checked.details, type };
}

/** The bodies a `transaction` payload carries: base64 of a wire `Transaction` or `TransactionList`, decoded. */
function signedBodies(payload: { [k: string]: Json }): readonly HederaBody[] | Refusal {
  const wire = typeof payload["transaction"] === "string" ? fromBase64(payload["transaction"]) : null;
  if (wire === null) return refusal("hedera/tx-malformed");
  const decoded = decodeHederaTx(wire);
  return isRefusal(decoded) ? decoded : decoded.bodies;
}

/** The landed entry `fetchPresented` wrote under `FETCHED`, in the form it writes it, else `hedera/read-first`. */
function landedOf(credential: MppCredential): MirrorEntry | Refusal {
  const read = fetchedOf(credential);
  const entry = isObject(read) ? (read as Partial<LcpHederaLanded>).entry : undefined;
  return isObject(entry) && isLanded(entry) ? entry : refusal("hedera/read-first");
}

/** H where `memo` is byte for byte H's LCP string: an empty memo is `hedera/no-memo`, any other `hedera/memo-not-lcp`. */
function memoCarries(memo: Uint8Array, h: AtrHash): AtrHash | Refusal {
  if (memo.length === 0) return refusal("hedera/no-memo");
  const expect = ENCODER.encode(toLcpString(h));
  return memo.length === expect.length && memo.every((b, i) => b === expect[i]) ? h : refusal("hedera/memo-not-lcp");
}

/**
 * The payment, read as `bound` reads it: the echoed challenge held to the filter, the payload's type, and H where the
 * memo of the body the payer signed, or of the landed entry for a `hash` credential, is H's LCP string byte for byte.
 */
function carried(
  input: unknown,
): { h: AtrHash; request: Obj; details: Obj; body?: HederaBody; bodies?: readonly HederaBody[]; entry?: MirrorEntry } | Refusal {
  const held = heldCredential(input);
  if (isRefusal(held)) return held;
  const { h, request, details } = held;
  if (held.type === "hash") {
    const entry = landedOf(held.credential);
    if (isRefusal(entry)) return entry;
    const memo = memoOf(entry);
    if (memo === null) return refusal("hedera/unreadable");
    const ok = memoCarries(memo, h);
    return isRefusal(ok) ? ok : { h, request, details, entry };
  }
  const bodies = signedBodies(held.credential.payload);
  if (isRefusal(bodies)) return bodies;
  const body = bodies[0]!;
  const ok = memoCarries(ENCODER.encode(body.memo), h);
  return isRefusal(ok) ? ok : { h, request, details, body, bodies };
}

/**
 * H from the echoed challenge, once the memo of the body the payer signed, or of the landed entry `fetchPresented`
 * wrote for a `hash` credential (else `hedera/read-first`), is byte for byte H's LCP string in lowercase hex (profile
 * `mpp/method/lcp`, rule 14). No transfer, amount, payer or signature is read. The act changes nothing: the single-use
 * value is the transaction id, never H.
 */
async function bound(input: unknown, _given?: { act: Act; h: AtrHash }): Promise<AtrHash | Refusal> {
  const c = carried(input);
  return isRefusal(c) ? c : c.h;
}

/**
 * The buyer's debit and the payee's credit in the body's transfer: exactly two rows in the request's `currency`, HBAR
 * rows for `0.0.0` and one token list otherwise, one debiting an account other than the `recipient` by the request's
 * `amount` and one crediting the `recipient` by it, neither spending an allowance; else `hedera/transfer-mismatch`.
 * Gives the debited account.
 */
function bodyPayer(t: HederaTransfer | undefined, r: Obj): string | Refusal {
  const mismatch = refusal("hedera/transfer-mismatch");
  if (t === undefined) return mismatch;
  let rows: readonly HederaRow[];
  if (r["currency"] === "0.0.0") {
    if (t.tokens.length !== 0) return mismatch;
    rows = t.hbar;
  } else {
    if (t.hbar.length !== 0 || t.tokens.length !== 1 || t.tokens[0]!.token !== r["currency"]) return mismatch;
    rows = t.tokens[0]!.rows;
  }
  const amount = BigInt(r["amount"] as string);
  const debit = rows.find((x) => BigInt(x.amount) < 0n);
  const credit = rows.find((x) => BigInt(x.amount) > 0n);
  if (rows.length !== 2 || rows.some((x) => x.isApproval) || debit === undefined || credit === undefined) return mismatch;
  if (credit.account !== r["recipient"] || BigInt(credit.amount) !== amount || BigInt(debit.amount) !== -amount) return mismatch;
  return debit.account === r["recipient"] ? mismatch : debit.account;
}

/**
 * The landed entry's buyer: its net change, read as `x402/exact/hedera` reads it, the node's and the fee accounts' rows
 * set aside, debits exactly one account, spending no allowance, and credits only the `recipient`, by the request's
 * `amount` in its `currency`; else `hedera/transfer-mismatch`. An entry whose rows do not read is `hedera/unreadable`.
 */
function landedPayer(entry: MirrorEntry, idAccount: string, r: Obj): string | Refusal {
  const net = netOf([entry], idAccount);
  if (net === null) return refusal("hedera/unreadable");
  const { debited, approved, credited } = partiesOf(net, entry.node, entry.transaction_id as string);
  const mismatch = refusal("hedera/transfer-mismatch");
  if (debited.size !== 1 || approved || credited.length !== 1) return mismatch;
  const c = credited[0]!;
  if (c.to !== r["recipient"] || c.asset !== r["currency"] || c.amount !== r["amount"]) return mismatch;
  const payer = [...debited][0]!;
  return payer === r["recipient"] ? mismatch : payer;
}

/**
 * The debited account against the account the transaction id names (profile `mpp/method/lcp`, rule 13): where
 * `feePayer` is `true` they differ, and where it is not they are one account; else `hedera/payer-not-buyer`.
 */
function payerHeld(payer: string, idAccount: string, d: Obj): true | Refusal {
  return (d["feePayer"] === true) === (payer !== idAccount) ? true : refusal("hedera/payer-not-buyer");
}

/**
 * The body's transaction id: where `feePayer` is `true` it names `feePayerAccountId`, and it is neither scheduled nor
 * a child's (`scheduled` and `nonce` of the `TransactionID` absent or zero); else `hedera/transaction-id-mismatch`.
 */
function bodyIdHeld(body: HederaBody, d: Obj): true | Refusal {
  const mismatch = refusal("hedera/transaction-id-mismatch");
  if (d["feePayer"] === true && body.id.account !== d["feePayerAccountId"]) return mismatch;
  const id = single(fieldsOf(body.bodyBytes) ?? [], 1, 2);
  const fields = id ? fieldsOf(id.bytes) : null;
  if (fields === null) return mismatch;
  const scheduled = single(fields, 3, 0);
  const nonce = single(fields, 4, 0);
  if (scheduled === null || nonce === null) return mismatch;
  return (scheduled?.varint ?? 0n) === 0n && (nonce?.varint ?? 0n) === 0n ? true : mismatch;
}

/** The payer of a body presented, by `bodyPayer` and `payerHeld`. */
function presentedPayer(body: HederaBody, r: Obj, d: Obj): string | Refusal {
  const payer = bodyPayer(body.transfer, r);
  if (isRefusal(payer)) return payer;
  const held = payerHeld(payer, body.id.account, d);
  return isRefusal(held) ? held : payer;
}

/**
 * The one account a body's rows debit, in every asset, held to the transaction id's account by `payerHeld`; a body
 * that is no crypto transfer, or whose rows debit no account or more than one, is `hedera/transfer-mismatch`. What it
 * credits, in which asset and for what amount, is not compared.
 */
function debitedPayer(t: HederaTransfer | undefined, idAccount: string, d: Obj): string | Refusal {
  if (t === undefined) return refusal("hedera/transfer-mismatch");
  const debited = new Set([...t.hbar, ...t.tokens.flatMap((x) => x.rows)].filter((x) => BigInt(x.amount) < 0n).map((x) => x.account));
  if (debited.size !== 1) return refusal("hedera/transfer-mismatch");
  const payer = [...debited][0]!;
  const held = payerHeld(payer, idAccount, d);
  return isRefusal(held) ? held : payer;
}

/**
 * A landed entry's one debited account, held as `debitedPayer` holds a body's, and its transfer rows: its net change,
 * read as `x402/exact/hedera` reads it, the node's and the fee accounts' rows and every row that nets to zero set
 * aside. An entry whose rows do not read is `hedera/unreadable`.
 */
function landedRows(entry: MirrorEntry, idAccount: string, d: Obj): { payer: string; transfer: HederaTransfer } | Refusal {
  const net = netOf([entry], idAccount);
  if (net === null) return refusal("hedera/unreadable");
  const hbar: HederaRow[] = [];
  const tokens: { token: string; rows: HederaRow[] }[] = [];
  for (const [asset, byAccount] of net) {
    const rows: HederaRow[] = [];
    for (const [account, c] of byAccount) {
      if (c.amount === 0n || (asset === "0.0.0" && (account === entry.node || FEE_ACCOUNTS.has(account)))) continue;
      rows.push({ account, amount: c.amount.toString(), isApproval: c.approval });
    }
    if (asset === "0.0.0") hbar.push(...rows);
    else if (rows.length > 0) tokens.push({ token: asset, rows });
  }
  const transfer = { hbar, tokens };
  const payer = debitedPayer(transfer, idAccount, d);
  return isRefusal(payer) ? payer : { payer, transfer };
}

/**
 * Validation that moves nothing (profile `mpp/method/lcp`, rules 7 and 15), after `bound`'s checks, with the first of
 * these codes that holds: `hedera/transfer-mismatch`, `hedera/payer-not-buyer`, `hedera/transaction-id-mismatch`, and,
 * for the bytes the payer signed, `hedera/valid-start-future` where the valid start is later than `now` and
 * `hedera/expired` where the valid start plus the valid duration is earlier than it. `now` is the caller's clock
 * reading in Unix seconds, a non-negative safe integer, else `mpp/input-malformed`. For a `hash` credential the first
 * three checks are made on the landed entry, its transaction id read from `transaction_id`, and the clock checks are
 * not made. Nothing is read from the ledger, so the answer names no check not made; `reader` is not read.
 */
async function validate(input: unknown, now: number, _reader?: HederaReader): Promise<LcpValidation | Refusal> {
  const clock = clockOf(now);
  if (isRefusal(clock)) return clock;
  const c = carried(input);
  if (isRefusal(c)) return c;
  const { h, request: r, details: d } = c;
  if (c.entry !== undefined) {
    const id = MIRROR_ID.exec(c.entry.transaction_id as string)!;
    const payer = landedPayer(c.entry, id[1]!, r);
    if (isRefusal(payer)) return payer;
    const held = payerHeld(payer, id[1]!, d);
    if (isRefusal(held)) return held;
    if (d["feePayer"] === true && id[1] !== d["feePayerAccountId"]) return refusal("hedera/transaction-id-mismatch");
    return { h, notMade: [] };
  }
  const body = c.body!;
  const payer = presentedPayer(body, r, d);
  if (isRefusal(payer)) return payer;
  const idHeld = bodyIdHeld(body, d);
  if (isRefusal(idHeld)) return idHeld;
  const start = body.id.seconds * 1_000_000_000n + BigInt(body.id.nanos);
  const at = BigInt(clock) * 1_000_000_000n;
  if (start > at) return refusal("hedera/valid-start-future");
  if (start + BigInt(body.validDuration) * 1_000_000_000n < at) return refusal("hedera/expired");
  return { h, notMade: [] };
}

/**
 * The read keys (profile `mpp/method/lcp`, rule 18), once `bound` gives H: from the body presented, the challenge's
 * network, the transaction id in the Mirror Node's spelling, the valid start to the nanosecond, the valid duration, the
 * memo, the SHA-256 of the signed body's bytes, the one account the rows debit, which is the payer (rows that debit no account or more than one are
 * `hedera/transfer-mismatch`, and a payer that does not stand to the transaction id's account as `feePayer` states
 * `hedera/payer-not-buyer`), and each body's node, the maximum fee and the transfer rows; and the payee, the `recipient` of `option`,
 * the challenge the payment answers. A credential whose echoed challenge is not `option`, by its `id` whole or by the
 * members fixed at issue, is `mpp/challenge-not-option`. For a `hash` credential the same members come from the landed
 * entry `fetchPresented` wrote, its rows read as `x402/exact/hedera` reads them, and the reference is `named`. No
 * amount, asset or credited account is compared with the challenge.
 */
async function reference(input: unknown, option: MppChallenge, _given?: { act: Act; h: AtrHash }): Promise<LcpHederaRef | Refusal> {
  const c = carried(input);
  if (isRefusal(c)) return c;
  const held = await echoesOption((input as MppCredential).challenge, option);
  if (held !== true) return held;
  const payee = mppPayee(option);
  if (isRefusal(payee)) return payee;
  const d = c.details;
  const network = d["network"] as HederaNetwork;
  const expectMemo = toLcpString(c.h);
  if (c.entry !== undefined) {
    const e = c.entry;
    const id = MIRROR_ID.exec(e.transaction_id as string)!;
    const landed = landedRows(e, id[1]!, d);
    if (isRefusal(landed)) return landed;
    const { payer, transfer } = landed;
    return {
      network,
      transactionId: e.transaction_id as string,
      validStart: e.valid_start_timestamp as string,
      validDuration: Number(e.valid_duration_seconds),
      expectMemo,
      payer,
      payee,
      presented: { nodes: [e.node as string], maxFee: e.max_fee as string, transfer },
      named: true,
    };
  }
  const body = c.body!;
  const payer = debitedPayer(body.transfer, body.id.account, d);
  if (isRefusal(payer)) return payer;
  return {
    network,
    transactionId: txIdMirror(body.id),
    validStart: `${body.id.seconds}.${String(body.id.nanos).padStart(9, "0")}`,
    validDuration: body.validDuration,
    expectMemo,
    payer,
    payee,
    presented: { nodes: c.bodies!.map((b) => b.node), maxFee: body.maxFee, transfer: body.transfer! },
    bodyDigest: await hash(body.bodyBytes),
  };
}

/**
 * The read (profile `mpp/method/lcp`, rule 21): `hederaStatus`, the read of `x402/exact/hedera`, over the reference.
 * On a `named` reference a `settled` answer's `presented` is `yes` where the act is the transaction the credential
 * names and `no` where it is another.
 */
async function status(ref: LcpHederaRef, reader: HederaReader, query: HederaQuery): Promise<HederaStatus> {
  const answer = await hederaStatus(ref, reader, query as never);
  if (!isObject(ref) || ref.named !== true || answer.state !== "settled") return answer;
  return { ...answer, presented: answer.transaction === ref.transactionId ? "yes" : "no" };
}

/** A `hash` credential's `transactionId`, `shard.realm.num@seconds.nanos`, in the Mirror Node's spelling; else undefined. */
function namedTx(id: unknown): string | undefined {
  const m = typeof id === "string" ? TX_TEXT.exec(id) : null;
  return m === null || BigInt(m[2]!) >= INT64_LIMIT ? undefined : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Whether a landed entry holds, in their forms, the members `bound`, `validate` and the reference read. */
function isLanded(e: MirrorEntry): boolean {
  return (
    e.result === SUCCESS &&
    e.nonce === 0 &&
    e.scheduled === false &&
    (e.memo_base64 === null || typeof e.memo_base64 === "string") &&
    typeof e.transaction_id === "string" &&
    MIRROR_ID.test(e.transaction_id) &&
    typeof e.valid_start_timestamp === "string" &&
    TIMESTAMP.test(e.valid_start_timestamp) &&
    typeof e.valid_duration_seconds === "string" &&
    /^(0|[1-9][0-9]{0,2})$/.test(e.valid_duration_seconds) &&
    typeof e.max_fee === "string" &&
    /^(0|[1-9][0-9]{0,19})$/.test(e.max_fee) &&
    isEntity(e.node)
  );
}

/**
 * For a `hash` credential (profile `mpp/method/lcp`, rule 16): the echoed challenge held to the filter, its
 * `transactionId` (`hedera/tx-malformed`), read through a reader for the challenge's `network` (`hedera/wrong-reader`)
 * by `GET /api/v1/transactions/{id}`; a read that fails or answers out of its form is `hedera/unreadable` and an id
 * with no entry that decides `hedera/not-found`, each a read to repeat; entries that decide with no `SUCCESS` among
 * them are `hedera/not-success`. It returns the credential with the `SUCCESS` entry under `FETCHED`, a `FETCHED`
 * member it carries replaced. A `transaction` credential comes back unchanged. One call.
 */
async function fetchPresented(input: MppCredential, reader: HederaReader): Promise<(MppCredential & { [FETCHED]?: LcpHederaLanded }) | Refusal> {
  const held = heldCredential(input);
  if (isRefusal(held)) return held;
  if (held.type === "transaction") return held.credential;
  const network = held.details["network"];
  if (!isObject(reader) || reader.network !== network) return refusal("hedera/wrong-reader");
  const id = namedTx(held.credential.payload["transactionId"]);
  if (id === undefined) return refusal("hedera/tx-malformed");
  const entries = await entriesOf(network as HederaNetwork, id, reader);
  if (entries === "not-found") return refusal("hedera/not-found");
  if (typeof entries === "string") return refusal("hedera/unreadable");
  const own = counted(entries);
  const success = own.find((e) => e.result === SUCCESS);
  if (success === undefined) return own.length === 0 ? refusal("hedera/not-found") : refusal("hedera/not-success");
  if (success.transaction_id !== id || !isLanded(success)) return refusal("hedera/unreadable");
  return { ...held.credential, [FETCHED]: { entry: success } };
}

/**
 * The body the buyer signs (profile `mpp/method/lcp`, rule 12), from the chosen challenge held as `bound` holds an
 * echoed one, whose id must derive from `h` (`mpp/id-not-ours`): the transaction id naming `feePayerAccountId` where
 * `feePayer` is `true`, else the buyer; the node; the maximum fee; a valid duration of 120 seconds; H's LCP string as
 * the memo; and the buyer's debit and the `recipient`'s credit of `amount` in `currency`. A choice that is not an
 * object, or whose payer, node, valid start, maximum fee or decimals is not of its form, is `mpp/input-malformed`; a
 * payer that is `feePayerAccountId` is `hedera/payer-not-buyer`, and one that is the `recipient`
 * `hedera/transfer-mismatch`. It reads no clock and calls no network; `complete` writes the credential.
 */
async function build(choice: LcpHederaChoice, h: AtrHash, _act?: Act): Promise<LcpHederaUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const checked = chosenFor(choice.challenge, h, ID);
  if (isRefusal(checked)) return checked;
  const vs = choice.validStart;
  if (
    !isEntity(choice.payer) ||
    !isEntity(choice.node) ||
    !isObject(vs) ||
    typeof vs.seconds !== "bigint" ||
    vs.seconds < 0n ||
    vs.seconds >= INT64_LIMIT ||
    !Number.isInteger(vs.nanos) ||
    vs.nanos < 0 ||
    vs.nanos > 999_999_999 ||
    typeof choice.maxFee !== "bigint" ||
    choice.maxFee < 0n ||
    choice.maxFee >= UINT64_LIMIT ||
    (choice.decimals !== undefined && (!Number.isInteger(choice.decimals) || choice.decimals < 0 || choice.decimals > 0xffffffff))
  ) {
    return refusal("mpp/input-malformed");
  }
  const r = checked.request;
  const d = checked.details;
  const feePayer = d["feePayer"] === true ? (d["feePayerAccountId"] as string) : choice.payer;
  if (d["feePayer"] === true && choice.payer === feePayer) return refusal("hedera/payer-not-buyer");
  if (choice.payer === r["recipient"]) return refusal("hedera/transfer-mismatch");
  const bodyBytes = writeBody({
    feePayer,
    seconds: vs.seconds,
    nanos: vs.nanos,
    node: choice.node,
    maxFee: choice.maxFee,
    memo: toLcpString(h),
    asset: r["currency"] as string,
    payer: choice.payer,
    payTo: r["recipient"] as string,
    amount: amountOf(r["amount"])!,
    ...(choice.decimals === undefined ? {} : { decimals: choice.decimals }),
  });
  const challenge = checked.challenge;
  return {
    request: { kind: "hedera-body", bodyBytes },
    complete: (s) => {
      const transaction = completeWith(bodyBytes, s);
      return isRefusal(transaction) ? transaction : lcpCredential(challenge, transaction);
    },
  };
}

/**
 * MPP's `place`, with the act the challenge is for, once the offer names this pairing (`offeredFor`, else its refusal or
 * `mpp/not-this-pairing`): the method carries H in the challenge's `id` and `opaque` and in what the payer signs, in no
 * request member.
 */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  position: number | null,
  act?: Act,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  const offered = offeredFor(offer, ID);
  if (isRefusal(offered)) return offered;
  return place(doc, h, link, offer, position, act, agreementUrl);
}

/**
 * The challenge as given: H rides in the challenge's `id` and `opaque`, never in `request`. A challenge that carries a
 * `refused` member is `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: "mpp/method/lcp",
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `mpp/charge/lcp/hedera`. `broadcaster` answers by the credential's `type`: `transaction`, `"payee"`, the party that
 * submits sends the buyer's bytes unchanged, and `status` reads them; `hash`, `"payer"`, the payer broadcast the body,
 * which `fetchPresented` reads. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.
 * `validate` is the method's validation that moves nothing.
 */
export const chargeLcpHedera = Object.freeze({
  id: ID,
  data: HEDERA[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  validate,
  broadcaster: mppBroadcaster(byType({ transaction: "payee", hash: "payer" })),
  reference,
  status,
  recover: exactHedera.recover,
  fetchPresented,
  landedTx: (presented: unknown): string | undefined => namedTx(pushedField(presented, "hash", "transactionId")),
}) satisfies Entry<
  typeof ID,
  MppCredential,
  LcpHederaRef,
  HederaReader,
  MppForms & {
    choice: LcpHederaChoice;
    unsigned: LcpHederaUnsigned;
    landed: unknown;
    network: HederaNetwork;
    query: HederaQuery;
    answer: HederaStatus;
  }
>;
