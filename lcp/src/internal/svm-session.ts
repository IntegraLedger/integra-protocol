/**
 * MPP Solana session pieces: the channel program's `open` instruction and its 8-byte salt, the 50-byte voucher, the
 * session bearer proof, and the read of a reported close. Discriminators are the reference program's. The public names
 * are re-exported by `../svm.ts`; the read of a reported close serves `mpp/session/solana`'s `status`.
 */
import { canonicalJson, toRawBytes, type AtrHash } from "../core.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import {
  channelVoucherMessage,
  decodeLanded,
  keyBytes,
  keyString,
  landedAt,
  type SolanaNetwork,
  type SvmInstruction,
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
/**
 * A reported close's read. Pending `not-final` is an error seen only at `confirmed`, as `SvmStatus` reads one, or a
 * close whose channel account, named through an address lookup table, is not the channel, seen only at `confirmed`.
 */
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
 * data and 6 accounts: its salt (data bytes 1–8, little-endian) and its channel (account 5). Else `svm/open-not-found`,
 * as is a channel named through an address lookup table: the message holds the table's address and an index, not the
 * account, and this function reads no table. `mpp/session/solana`'s `fetchPresented` reads an opening's tables.
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

/**
 * Reads a reported close at `finalized`, then `confirmed`: a top-level instruction of `program` whose data byte 0 is
 * `settleAndSeal` (channel at account 1) or `seal` (channel at account 0) naming the channel, in a transaction that
 * executed without error, is settled. The channel account is read from the static keys or from the addresses the
 * transaction's address lookup tables loaded (`loaded`, as `getTransaction` lists them), since a table can supply it:
 * draft-solana-session-00 has a close bundled with a `distribute` of many recipients sent as a version-0 transaction
 * with an address lookup table. A landed transaction without such an instruction is failed `not-a-close` from a read at
 * either commitment, since the signature fixes its instructions, unless a `settleAndSeal` or `seal` of `program` in it
 * names its channel account through a table: the signature fixes only the table and the index, and an entry written in
 * a block that is not finalized can differ on another fork, so that transaction is failed `not-a-close` only from the
 * read at `finalized`, and pending `not-final` from the read at `confirmed`. One with such an instruction that landed
 * with an error is failed `err` only from the read at `finalized`, and pending `not-final` from the read at
 * `confirmed`, since a block that is not finalized can be replaced and the transaction can land in another block and
 * execute otherwise. Not found at either is pending `not-found`; a failed read, or an answer of neither documented
 * shape (a landed wire that does not decode, `loaded` addresses other than 32-byte keys in the numbers the message's
 * lookups name, or a loaded address that repeats a static key or another loaded address, included), is pending
 * `unreadable`. A ref whose program or channel is not the base58 of a 32-byte key is pending `unreadable`, with nothing
 * read. At most two calls.
 */
export async function svmCloseStatus(ref: SvmCloseRef, reader: SvmReader): Promise<SvmCloseStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  const programKey = keyBytes(ref.program);
  const channelKey = keyBytes(ref.channel);
  if (programKey === null || channelKey === null) return { state: "pending", why: "unreadable" };
  const read = await landedAt(reader, ref.transaction);
  if (read === undefined) return { state: "pending", why: "unreadable" };
  if ("notFound" in read) return { state: "pending", why: "not-found" };
  const decoded = decodeLanded(read.landed);
  if (decoded === null) return { state: "pending", why: "unreadable" };
  const { tx, keys } = decoded;
  const channelAt = tx.instructions.flatMap((ix) => {
    if (!sameKey(tx.keys[ix.program], programKey)) return [];
    const at = ix.data[0] === SETTLE_AND_SEAL_DISCRIMINATOR ? 1 : ix.data[0] === SEAL_DISCRIMINATOR ? 0 : -1;
    const index = at === -1 ? undefined : ix.accounts[at];
    return index === undefined ? [] : [index];
  });
  if (!channelAt.some((index) => sameKey(keys[index], channelKey))) {
    const fromTable = channelAt.some((index) => index >= tx.keys.length);
    if (fromTable && read.commitment === "confirmed") return { state: "pending", why: "not-final" };
    return { state: "failed", why: "not-a-close" };
  }
  const { err } = read.landed;
  if (err === null || err === undefined) return { state: "settled", commitment: read.commitment };
  return read.commitment === "finalized" ? { state: "failed", why: "err" } : { state: "pending", why: "not-final" };
}
