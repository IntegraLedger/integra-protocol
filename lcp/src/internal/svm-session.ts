/**
 * MPP Solana session pieces: the channel program's `open` instruction, the 50-byte voucher and the session bearer
 * proof. Discriminators are the reference program's. The public names are re-exported by `../svm.ts`.
 */
import { canonicalJson } from "../core.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import {
  channelVoucherMessage,
  keyBytes,
  keyString,
  type SolanaNetwork,
  type SvmInstruction,
  type SvmTx,
} from "./svm.js";

export const OPEN_DISCRIMINATOR = 1;
export const SETTLE_AND_SEAL_DISCRIMINATOR = 4;
export const SEAL_DISCRIMINATOR = 6;
const OPEN_MIN_DATA = 33;
const OPEN_MIN_ACCOUNTS = 6;
const OPEN_SIGNER_ACCOUNT = 4;
const OPEN_CHANNEL_ACCOUNT = 5;

export type SvmCloseRef = { phase: "close"; network: SolanaNetwork; program: string; channel: string; transaction: string };
/**
 * A reported close's read. Pending `not-final` is an error seen only at `confirmed`, as `SvmStatus` reads one, or a
 * close whose channel account, named through an address lookup table, is not the channel, seen only at `confirmed`.
 */
export type SvmCloseStatus =
  | { state: "settled"; commitment: "confirmed" | "finalized" }
  | { state: "pending"; why: "not-found" | "unreadable" | "not-final" }
  | { state: "failed"; why: "err" | "not-a-close" };

function sameKey(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The one top-level instruction of `program` whose data starts with `OPEN_DISCRIMINATOR`, with at least 33 bytes of
 * data and 6 accounts: its salt (data bytes 1–8, little-endian) and its channel (account 5). Else `svm/open-not-found`,
 * as is a channel named through an address lookup table: the message holds the table's address and an index, not the
 * account, and this function reads no table.
 */
export function openOf(tx: SvmTx, program: string): { salt: bigint; channel: string } | Refusal {
  const ix = openInstruction(tx, program);
  if (isRefusal(ix)) return ix;
  const open = openAccounts(ix, tx.keys);
  return isRefusal(open) ? open : { salt: open.salt, channel: open.channel };
}

/** The `open` instruction `openInstruction` selects, and its salt. */
export interface OpenInstruction {
  ix: SvmInstruction;
  salt: bigint;
}

/**
 * The one top-level instruction of `program` whose data starts with `OPEN_DISCRIMINATOR`, with at least 33 bytes of
 * data and 6 accounts, and its salt, read from the message alone: an invalid program key, no such instruction or more
 * than one, or a channel (account 5) index past `keyCount`, the number of keys the message's instructions may index
 * (its static keys, by default, and as many as its address table lookups load), is `svm/open-not-found`.
 */
export function openInstruction(tx: SvmTx, program: string, keyCount: number = tx.keys.length): OpenInstruction | Refusal {
  const programKey = keyBytes(program);
  if (programKey === null) return refusal("svm/open-not-found");
  const opens = tx.instructions.filter(
    (ix) =>
      sameKey(tx.keys[ix.program], programKey) &&
      ix.data[0] === OPEN_DISCRIMINATOR &&
      ix.data.length >= OPEN_MIN_DATA &&
      ix.accounts.length >= OPEN_MIN_ACCOUNTS,
  );
  if (opens.length !== 1) return refusal("svm/open-not-found");
  const ix = opens[0]!;
  if (ix.accounts[OPEN_CHANNEL_ACCOUNT]! >= keyCount) return refusal("svm/open-not-found");
  let salt = 0n;
  for (let i = 8; i >= 1; i--) salt = (salt << 8n) | BigInt(ix.data[i]!);
  return { ix, salt };
}

/**
 * The selected `open`'s salt, `authorizedSigner` (account 4) and channel (account 5), each account read from `keys`:
 * the message's static keys, or every key its instructions may index once its address table lookups are resolved
 * (`loadedKeys`). The signer is undefined for an index past `keys`; a channel index past them is `svm/open-not-found`.
 */
export function openAccounts(
  open: OpenInstruction,
  keys: readonly Uint8Array[],
): { salt: bigint; signer: string | undefined; channel: string } | Refusal {
  const channel = keys[open.ix.accounts[OPEN_CHANNEL_ACCOUNT]!];
  if (channel === undefined) return refusal("svm/open-not-found");
  const signer = keys[open.ix.accounts[OPEN_SIGNER_ACCOUNT]!];
  return { salt: open.salt, signer: signer === undefined ? undefined : keyString(signer), channel: keyString(channel) };
}

/**
 * The 50 bytes a voucher signs: `56 01` ‖ channel id ‖ cumulative u64 LE ‖ expiresAt i64 LE (0 when absent). A
 * malformed channel id or an out-of-range number is `svm/input-malformed`.
 */
export function solanaVoucher(
  channelId: string,
  cumulative: bigint,
  expiresAt?: bigint,
): Uint8Array<ArrayBuffer> | Refusal {
  try {
    return channelVoucherMessage(channelId, cumulative, expiresAt ?? 0n);
  } catch {
    return refusal("svm/input-malformed");
  }
}

/**
 * The UTF-8 of the core's `canonicalJson` of `{channelId, domain: "mpp-session-auth-v1", payer, sessionChallengeId}`.
 * Throws TypeError when `p` is not an object, or when its `channelId`, `payer` or `challengeId` is not a well-formed
 * string (one holding a lone surrogate has no UTF-8 form): it never returns a message the caller did not write.
 */
export function sessionProof(p: { channelId: string; payer: string; challengeId: string }): Uint8Array<ArrayBuffer> {
  const { channelId, payer, challengeId }: { channelId: unknown; payer: unknown; challengeId: unknown } = p;
  if (!isWellFormed(channelId) || !isWellFormed(payer) || !isWellFormed(challengeId)) {
    throw new TypeError("sessionProof: channelId, payer and challengeId must be well-formed strings");
  }
  const text = canonicalJson({ channelId, domain: "mpp-session-auth-v1", payer, sessionChallengeId: challengeId });
  if (typeof text !== "string") throw new TypeError("sessionProof: the proof has no canonical JSON form");
  return new TextEncoder().encode(text);
}

function isWellFormed(s: unknown): s is string {
  return typeof s === "string" && s.isWellFormed();
}
