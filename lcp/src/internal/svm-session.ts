/**
 * MPP Solana session pieces: the channel program's `open` instruction and its 8-byte salt, the 50-byte voucher, the
 * session bearer proof, and the read of a reported close. Discriminators are the reference program's. The public names
 * are re-exported by `../svm.ts`; the read of a reported close serves `mpp/session/solana`'s `status`.
 */
import { canonicalJson, toRawBytes, type AtrHash } from "../core.js";
import { isObject, notFoundPoint } from "../fields.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import {
  channelVoucherMessage,
  decodeSvmTx,
  keyBytes,
  keyString,
  type SolanaNetwork,
  type SvmLanded,
  type SvmReader,
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
/** A reported close's read. Pending `not-final` is an error seen only at `confirmed`, as `SvmStatus` reads one. */
export type SvmCloseStatus =
  | { state: "settled"; commitment: "confirmed" | "finalized" }
  | { state: "pending"; why: "not-found" | "unreadable" | "not-final" }
  | { state: "failed"; why: "err" | "not-a-close" };

/**
 * H's first 8 bytes read as a little-endian u64, so the salt's encoded bytes are exactly those 8 bytes. Throws
 * TypeError when `h` is not a 32-byte hash.
 */
export function sessionSalt(h: AtrHash): bigint {
  const b = toRawBytes(h);
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]!);
  return v;
}

function sameKey(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The one top-level instruction of `program` whose data starts with `OPEN_DISCRIMINATOR`, with at least 33 bytes of
 * data and 6 accounts: its salt (data bytes 1–8, little-endian) and its channel (account 5). Else `svm/open-not-found`.
 */
export function openOf(tx: SvmTx, program: string): { salt: bigint; channel: string } | Refusal {
  const open = readOpen(tx, program);
  return isRefusal(open) ? open : { salt: open.salt, channel: open.channel };
}

/**
 * `openOf`'s read, with the instruction's `authorizedSigner` (account 4): its key when the message names it as a static
 * key, else undefined (an account from an address lookup table).
 */
export function readOpen(tx: SvmTx, program: string): { salt: bigint; signer: string | undefined; channel: string } | Refusal {
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
  const channel = tx.keys[ix.accounts[OPEN_CHANNEL_ACCOUNT]!];
  if (channel === undefined) return refusal("svm/open-not-found");
  let salt = 0n;
  for (let i = 8; i >= 1; i--) salt = (salt << 8n) | BigInt(ix.data[i]!);
  const signer = tx.keys[ix.accounts[OPEN_SIGNER_ACCOUNT]!];
  return { salt, signer: signer === undefined ? undefined : keyString(signer), channel: keyString(channel) };
}

/**
 * The 50 bytes a voucher signs: `56 01` ‖ channel id ‖ cumulative u64 LE ‖ expiresAt i64 LE (0 when absent). A
 * malformed channel id or an out-of-range number is `svm/input-malformed`.
 */
export function solanaVoucher(channelId: string, cumulative: bigint, expiresAt?: bigint): Uint8Array | Refusal {
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
export function sessionProof(p: { channelId: string; payer: string; challengeId: string }): Uint8Array {
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

/**
 * Reads a reported close at `finalized`, then `confirmed`: a top-level instruction of `program` whose data byte 0 is
 * `settleAndSeal` (channel at account 1) or `seal` (channel at account 0) naming the channel, in a transaction that
 * executed without error, is settled. A landed transaction without such an instruction is failed `not-a-close` from a
 * read at either commitment, since the signature fixes its instructions. One with such an instruction that landed with
 * an error is failed `err` only from the read at `finalized`, and pending `not-final` from the read at `confirmed`,
 * since a block that is not finalized can be replaced and the transaction can land in another block and execute
 * otherwise. Not found at either is pending `not-found`; a failed read, or an answer of neither documented shape, is
 * pending `unreadable`. A ref whose program or channel is not the base58 of a 32-byte key is pending `unreadable`,
 * with nothing read. At most two calls.
 */
export async function svmCloseStatus(ref: SvmCloseRef, reader: SvmReader): Promise<SvmCloseStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  const programKey = keyBytes(ref.program);
  const channelKey = keyBytes(ref.channel);
  if (programKey === null || channelKey === null) return { state: "pending", why: "unreadable" };
  let found: { landed: SvmLanded; commitment: "confirmed" | "finalized" } | null = null;
  try {
    for (const commitment of ["finalized", "confirmed"] as const) {
      const landed: unknown = await reader.transaction(ref.transaction, commitment);
      if (notFoundPoint(landed, "slot") !== undefined) continue;
      if (!isObject(landed) || !(landed["wire"] instanceof Uint8Array)) return { state: "pending", why: "unreadable" };
      found = { landed: landed as unknown as SvmLanded, commitment };
      break;
    }
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (found === null) return { state: "pending", why: "not-found" };
  const tx = decodeSvmTx(found.landed.wire);
  if (isRefusal(tx)) return { state: "pending", why: "unreadable" };
  const closes = tx.instructions.some((ix) => {
    if (!sameKey(tx.keys[ix.program], programKey)) return false;
    const at = ix.data[0] === SETTLE_AND_SEAL_DISCRIMINATOR ? 1 : ix.data[0] === SEAL_DISCRIMINATOR ? 0 : -1;
    return at !== -1 && sameKey(tx.keys[ix.accounts[at] ?? -1], channelKey);
  });
  if (!closes) return { state: "failed", why: "not-a-close" };
  const { err } = found.landed;
  if (err === null || err === undefined) return { state: "settled", commitment: found.commitment };
  return found.commitment === "finalized" ? { state: "failed", why: "err" } : { state: "pending", why: "not-final" };
}
