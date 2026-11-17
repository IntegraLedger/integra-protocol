/**
 * The Hedera wire form written and read by hand (protobuf), and the Mirror Node entry pieces, that the Hedera charges
 * `../hedera.ts` and `../mpp-lcp-hedera.ts` share. No entry point exports these names.
 */
import type { HederaNetwork, HederaReader, MirrorEntry, MirrorRow } from "../hedera.js";
import { isObject } from "../fields.js";
import { fromBase64, toBase64 } from "../rail-bytes.js";
import { refusal, type Refusal } from "../refusal.js";
import { INT64_LIMIT, isEntity } from "./hedera.js";
import type { Moved, UnreadableReason } from "./read.js";

/** The `transactionValidDuration` lcp's client writes, in seconds. */
export const VALID_DURATION = 120;
/** The most entries one read under a transaction id takes. */
export const MAX_ENTRIES = 64;
/** The most transfer rows one read takes. */
export const MAX_ROWS = 256;

/**
 * The accounts a transaction's fee is spread over, besides the node it names: the network's fee account `0.0.98`, the
 * staking and node reward accounts `0.0.800` and `0.0.801`, and the fee collection account `0.0.802` (HIP-1259), which
 * the testnet entry of `0.0.3229-1791145265-469000038` (2026-10-04) shows taking the whole charged fee, with no row of
 * its node. Their rows are no transfer of the payment's.
 */
export const FEE_ACCOUNTS: ReadonlySet<string> = new Set(["0.0.98", "0.0.800", "0.0.801", "0.0.802"]);

/**
 * Results that do not use up the transaction id: a rejected duplicate, and the node due-diligence failures after
 * which a valid transaction with the same id still reaches consensus (hiero `RecordCache.NODE_FAILURES`).
 */
export const NOT_COUNTED: ReadonlySet<string> = new Set([
  "DUPLICATE_TRANSACTION",
  "INVALID_NODE_ACCOUNT",
  "INVALID_PAYER_SIGNATURE",
]);

/** The account that pays HIP-406 staking rewards. */
export const STAKING_REWARD_ACCOUNT = "0.0.800";

export const UINT64_LIMIT = 1n << 64n;
export const ENCODER = new TextEncoder();

export type Field = { n: number; wt: 0 | 1 | 2 | 5; varint: bigint; bytes: Uint8Array };

/** Every field of one message, in wire order; null when the bytes are not a well-formed message. */
export function fieldsOf(buf: Uint8Array): Field[] | null {
  const out: Field[] = [];
  let i = 0;
  while (i < buf.length) {
    const key = varintAt(buf, i);
    if (key === null) return null;
    i = key.next;
    const n = Number(key.value >> 3n);
    const wt = Number(key.value & 7n);
    if (n < 1 || n > 536_870_911) return null;
    if (wt === 0) {
      const v = varintAt(buf, i);
      if (v === null) return null;
      out.push({ n, wt, varint: v.value, bytes: new Uint8Array(0) });
      i = v.next;
    } else if (wt === 1 || wt === 5) {
      const size = wt === 1 ? 8 : 4;
      if (i + size > buf.length) return null;
      out.push({ n, wt, varint: 0n, bytes: buf.subarray(i, i + size) });
      i += size;
    } else if (wt === 2) {
      const len = varintAt(buf, i);
      if (len === null || len.value > BigInt(buf.length - len.next)) return null;
      const end = len.next + Number(len.value);
      out.push({ n, wt, varint: 0n, bytes: buf.subarray(len.next, end) });
      i = end;
    } else {
      return null;
    }
  }
  return out;
}

export function varintAt(buf: Uint8Array, at: number): { value: bigint; next: number } | null {
  let value = 0n;
  for (let k = 0; k < 10; k++) {
    const b = buf[at + k];
    if (b === undefined) return null;
    value |= BigInt(b & 0x7f) << BigInt(7 * k);
    if ((b & 0x80) === 0) return value < UINT64_LIMIT ? { value, next: at + k + 1 } : null;
  }
  return null;
}

/** The one field numbered `n`, which must have wire type `wt`; undefined when absent, null when repeated or mistyped. */
export function single(fields: readonly Field[], n: number, wt: Field["wt"]): Field | undefined | null {
  let found: Field | undefined;
  for (const f of fields) {
    if (f.n !== n) continue;
    if (f.wt !== wt || found !== undefined) return null;
    found = f;
  }
  return found;
}

export function int64Of(v: bigint): bigint {
  return v >= INT64_LIMIT ? v - UINT64_LIMIT : v;
}

export function varint(v: bigint): number[] {
  const out: number[] = [];
  let x = v < 0n ? v + UINT64_LIMIT : v;
  do {
    const b = Number(x & 0x7fn);
    x >>= 7n;
    out.push(x === 0n ? b : b | 0x80);
  } while (x !== 0n);
  return out;
}

/** A varint field; a zero value is not written. */
export function vField(n: number, v: bigint): number[] {
  return v === 0n ? [] : [...varint(BigInt(n << 3)), ...varint(v)];
}

/** A length-delimited field, written even when empty. */
export function lenField(n: number, bytes: readonly number[] | Uint8Array): number[] {
  const out = [...varint(BigInt((n << 3) | 2)), ...varint(BigInt(bytes.length))];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
  return out;
}

/** A length-delimited field; an empty value is not written. */
export function lenFieldNonEmpty(n: number, bytes: readonly number[] | Uint8Array): number[] {
  return bytes.length === 0 ? [] : lenField(n, bytes);
}

export function zigzag(v: bigint): bigint {
  return v >= 0n ? v << 1n : (-v << 1n) - 1n;
}

export function entity(id: string): number[] {
  const [shard, realm, num] = id.split(".").map((p) => BigInt(p)) as [bigint, bigint, bigint];
  return [...vField(1, shard), ...vField(2, realm), ...vField(3, num)];
}

export function accountAmount(account: string, amount: bigint): number[] {
  return [...lenField(1, entity(account)), ...vField(2, zigzag(amount))];
}

/** The two transfer rows, the payer's debit first. */
export function transferRows(payer: string, payTo: string, amount: bigint): number[] {
  return [...lenField(1, accountAmount(payer, -amount)), ...lenField(1, accountAmount(payTo, amount))];
}

export function writeBody(b: {
  feePayer: string;
  seconds: bigint;
  nanos: number;
  node: string;
  maxFee: bigint;
  memo: string;
  asset: string;
  payer: string;
  payTo: string;
  amount: bigint;
  decimals?: number;
}): Uint8Array<ArrayBuffer> {
  const txId = [
    ...lenField(1, [...vField(1, b.seconds), ...vField(2, BigInt(b.nanos))]),
    ...lenField(2, entity(b.feePayer)),
  ];
  let transfer: number[];
  if (b.asset === "0.0.0") {
    transfer = lenField(1, transferRows(b.payer, b.payTo, b.amount));
  } else {
    const tokenList = [
      ...lenField(1, entity(b.asset)),
      ...lenField(2, accountAmount(b.payer, -b.amount)),
      ...lenField(2, accountAmount(b.payTo, b.amount)),
      ...(b.decimals === undefined ? [] : lenField(4, vField(1, BigInt(b.decimals)))),
    ];
    transfer = lenField(2, tokenList);
  }
  return Uint8Array.from([
    ...lenField(1, txId),
    ...lenField(2, entity(b.node)),
    ...vField(3, b.maxFee),
    ...lenField(4, vField(1, BigInt(VALID_DURATION))),
    ...lenFieldNonEmpty(6, ENCODER.encode(b.memo)),
    ...lenField(14, transfer),
  ]);
}

/** `Transaction` {5: `SignedTransaction` {1: bodyBytes, 2: `SignatureMap` {1: `SignaturePair`}}}, base64. */
export function completeWith(
  bodyBytes: Uint8Array,
  s: { publicKey: Uint8Array; signature: Uint8Array; type: "ed25519" | "ecdsa-secp256k1" },
): string | Refusal {
  if (!isObject(s) || !(s.publicKey instanceof Uint8Array) || !(s.signature instanceof Uint8Array)) {
    return refusal("hedera/tx-malformed");
  }
  const keyLength = s.type === "ed25519" ? 32 : s.type === "ecdsa-secp256k1" ? 33 : -1;
  if (s.publicKey.length !== keyLength || s.signature.length !== 64) return refusal("hedera/tx-malformed");
  const pair = [...lenField(1, s.publicKey), ...lenField(s.type === "ed25519" ? 3 : 6, s.signature)];
  const signed = [...lenField(1, bodyBytes), ...lenField(2, lenField(1, pair))];
  return toBase64(Uint8Array.from(lenField(5, signed)));
}

/**
 * Every Mirror Node entry for the transaction id. A reader for another network is `chain-mismatch`, a rejected read
 * `transport`, and an answer that is not a list of entries `unparseable`.
 */
export async function entriesOf(
  network: HederaNetwork,
  transaction: string,
  reader: HederaReader,
): Promise<readonly MirrorEntry[] | "not-found" | UnreadableReason> {
  if (!isObject(reader) || reader.network !== network) return "chain-mismatch";
  let entries: readonly MirrorEntry[] | null;
  try {
    entries = await reader.transactions(transaction);
  } catch {
    return "transport";
  }
  if (entries === null) return "not-found";
  if (!Array.isArray(entries) || !entries.every(isEntry)) return "unparseable";
  if (entries.length > MAX_ENTRIES) return "too-large";
  return entries;
}

/** A consensus timestamp, `seconds.nanos`, as nanoseconds; -1 for one that is not that form. */
export function consensusKey(t: unknown): bigint {
  const m = typeof t === "string" ? /^(\d{1,19})\.(\d{1,9})$/.exec(t) : null;
  return m === null ? -1n : BigInt(m[1]!) * 1_000_000_000n + BigInt(m[2]!.padEnd(9, "0"));
}

export function isEntry(e: unknown): e is MirrorEntry {
  if (!isObject(e)) return false;
  return (
    typeof e["result"] === "string" &&
    (e["memo_base64"] === null || typeof e["memo_base64"] === "string") &&
    Number.isSafeInteger(e["nonce"]) &&
    typeof e["scheduled"] === "boolean" &&
    consensusKey(e["consensus_timestamp"]) >= 0n
  );
}

/**
 * Whether an entry decides for its transaction id: the user transaction's own entry, nonce 0 and not scheduled, and not
 * a rejected duplicate or a node due-diligence failure, after which a valid transaction under the id is still handled.
 */
export function decides(e: MirrorEntry): boolean {
  return e.nonce === 0 && e.scheduled === false && !NOT_COUNTED.has(e.result);
}

/** The user transaction's own entries under an id: those that decide. */
export function counted(entries: readonly MirrorEntry[]): MirrorEntry[] {
  return entries.filter(decides);
}

export function memoOf(e: MirrorEntry): Uint8Array | null {
  return e.memo_base64 === null ? new Uint8Array(0) : fromBase64(e.memo_base64);
}

/** One account's change in one asset, and whether a debit of it spent an allowance. */
export type Change = { amount: bigint; approval: boolean };

/** What an entry moved, per asset (`0.0.0` for HBAR, else the token id), per account. */
export type Net = Map<string, Map<string, Change>>;

/**
 * The entries' net change per asset and account. The HBAR rows are each account's total change, so each account's
 * staking reward row is taken back out of it and returned to `0.0.800`, which paid it, and each entry's
 * `charged_tx_fee` is added back to the fee payer, the account its transaction id names; a row whose `is_approval` is
 * true spends an allowance. Null where a row is not an object with an entity `account`, a safe-integer `amount` and an
 * `is_approval` that is a boolean where present, a token row has no entity `token_id`, the user entry has no fee, or
 * the rows pass the bound.
 */
export function netOf(entries: readonly MirrorEntry[], feePayer: string): Net | null {
  const net: Net = new Map();
  let rows = 0;
  const add = (asset: string, account: string, amount: bigint, approval: boolean): void => {
    const byAccount = net.get(asset) ?? new Map<string, Change>();
    const was = byAccount.get(account) ?? { amount: 0n, approval: false };
    byAccount.set(account, { amount: was.amount + amount, approval: was.approval || (approval && amount < 0n) });
    net.set(asset, byAccount);
  };
  const rowsOf = (list: unknown, token: boolean): MirrorRow[] | null => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) return null;
    for (const r of list as readonly unknown[]) {
      if (++rows > MAX_ROWS) return null;
      if (!isObject(r) || !isEntity(r["account"]) || !Number.isSafeInteger(r["amount"])) return null;
      if (r["is_approval"] !== undefined && typeof r["is_approval"] !== "boolean") return null;
      if (token && !isEntity(r["token_id"])) return null;
    }
    return list as MirrorRow[];
  };
  for (const e of entries) {
    const fee = e.charged_tx_fee;
    if (e.nonce === 0 ? !Number.isSafeInteger(fee) || (fee as number) < 0 : fee !== undefined && !Number.isSafeInteger(fee)) return null;
    const hbar = rowsOf(e.transfers, false);
    const tokens = rowsOf(e.token_transfers, true);
    const rewards = rowsOf(e.staking_reward_transfers, false);
    if (hbar === null || tokens === null || rewards === null) return null;
    for (const r of hbar) add("0.0.0", r.account, BigInt(r.amount), r.is_approval === true);
    for (const r of tokens) add(r.token_id!, r.account, BigInt(r.amount), r.is_approval === true);
    for (const r of rewards) {
      add("0.0.0", r.account, -BigInt(r.amount), false);
      add("0.0.0", STAKING_REWARD_ACCOUNT, BigInt(r.amount), false);
    }
    if (e.nonce === 0) add("0.0.0", feePayer, BigInt(fee as number), false);
  }
  return net;
}

/**
 * The accounts an entry's net change debits, and those it credits other than the node's and the fee accounts', each
 * credit named by the transaction id and its place, the asset and the credited account, `<asset>/<account>`: the
 * mirror holds each account's total change in an asset as one row.
 */
export function partiesOf(
  net: Net,
  node: string | null | undefined,
  transaction: string,
): { debited: Set<string>; approved: boolean; credited: Moved[] } {
  const debited = new Set<string>();
  let approved = false;
  const credited: Moved[] = [];
  for (const [asset, byAccount] of net) {
    for (const [account, c] of byAccount) {
      if (c.amount < 0n) {
        debited.add(account);
        approved ||= c.approval;
      } else if (c.amount > 0n && account !== node && !FEE_ACCOUNTS.has(account)) {
        credited.push({ asset, amount: c.amount.toString(), to: account, transaction, place: `${asset}/${account}` });
      }
    }
  }
  return { debited, approved, credited };
}
