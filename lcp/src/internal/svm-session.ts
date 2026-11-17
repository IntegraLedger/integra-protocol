/**
 * MPP Solana session pieces: the channel program's `open` instruction, the 50-byte voucher and the session bearer
 * proof. Discriminators are the reference program's. The public names are re-exported by `../svm.ts`.
 */
import { canonicalJson } from "../core.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import {
  ATA_PROGRAM,
  channelVoucherMessage,
  findPda,
  keyBytes,
  keyString,
  SYSTEM,
  type KitInstruction,
  type SolanaNetwork,
  type SvmInstruction,
  type SvmStatus,
  type SvmTx,
} from "./svm.js";

export const OPEN_DISCRIMINATOR = 1;
export const SETTLE_AND_SEAL_DISCRIMINATOR = 4;
export const SEAL_DISCRIMINATOR = 6;
const OPEN_MIN_DATA = 33;
const OPEN_MIN_ACCOUNTS = 6;
const OPEN_SIGNER_ACCOUNT = 4;
const OPEN_CHANNEL_ACCOUNT = 5;

export type SvmCloseRef = {
  phase: "close";
  network: SolanaNetwork;
  program: string;
  channel: string;
  transaction: string;
  /** The option's payee. */
  payee: string;
};
/** A reported close's read, as the profile `read-status` answers it: the answer `SvmStatus` names. */
export type SvmCloseStatus = SvmStatus;

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
 * the message's static keys, or every key its instructions may index once its address table lookups are resolved.
 * The signer is undefined for an index past `keys`; a channel index past them is `svm/open-not-found`.
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

/** The payment-channels program `@solana/mpp` 0.7.0 opens channels with when the request names none. */
export const PAYMENT_CHANNELS_PROGRAM = "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111";
const ROLE = { READONLY: 0, WRITABLE: 1, READONLY_SIGNER: 2, WRITABLE_SIGNER: 3 } as const;

/** What a payment-channel `open` names, each key base58. */
export interface OpenInput {
  program: string;
  payer: string;
  /** The rent payer and fee payer: the challenge's `operator`. */
  operator: string;
  payee: string;
  mint: string;
  tokenProgram: string;
  authorizedSigner: string;
  salt: bigint;
  deposit: bigint;
  gracePeriod: number;
  openSlot: bigint;
  recipients: readonly { recipient: string; bps: number }[];
}

function u64le(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

/**
 * The `open` instruction `@solana/mpp` 0.7.0 composes (`src/client/PaymentChannels.ts:104-173`;
 * `src/generated/payment-channels/instructions/open.ts:209-273`; `types/openArgs.ts`; `types/distributionEntry.ts`):
 * its fourteen accounts in order, the payer and the rent payer writable signers; its data the discriminator 1, then
 * `salt` u64, `deposit` u64, `gracePeriod` u32, `openSlot` u64 and the recipients as a u32 count of 34-byte entries,
 * each an address and a u16 of basis points, all little-endian. The channel is the PDA of `["channel", payer, payee,
 * mint, authorizedSigner, salt, openSlot]` (`:477-491`) and the two token accounts are associated token accounts. A
 * key that does not decode, or a PDA with no bump, is `svm/input-malformed`; the channel is returned beside it.
 */
export function openInstructionFor(o: OpenInput): { instruction: KitInstruction; channel: string } | Refusal {
  const keys = [o.program, o.payer, o.operator, o.payee, o.mint, o.tokenProgram, o.authorizedSigner, ...o.recipients.map((r) => r.recipient)];
  if (keys.some((k) => keyBytes(k) === null)) return refusal("svm/input-malformed");
  const k = (a: string) => keyBytes(a)!;
  const channel = findPda([new TextEncoder().encode("channel"), k(o.payer), k(o.payee), k(o.mint), k(o.authorizedSigner), u64le(o.salt), u64le(o.openSlot)], o.program);
  if (isRefusal(channel)) return refusal("svm/input-malformed");
  const ata = (owner: string) => findPda([k(owner), k(o.tokenProgram), k(o.mint)], ATA_PROGRAM);
  const payerAta = ata(o.payer);
  const channelAta = ata(channel.address);
  const eventAuthority = findPda([new TextEncoder().encode("event_authority")], o.program);
  if (isRefusal(payerAta) || isRefusal(channelAta) || isRefusal(eventAuthority)) return refusal("svm/input-malformed");
  const data = new Uint8Array(33 + 34 * o.recipients.length);
  const view = new DataView(data.buffer);
  data[0] = OPEN_DISCRIMINATOR;
  view.setBigUint64(1, o.salt, true);
  view.setBigUint64(9, o.deposit, true);
  view.setUint32(17, o.gracePeriod, true);
  view.setBigUint64(21, o.openSlot, true);
  view.setUint32(29, o.recipients.length, true);
  o.recipients.forEach((r, i) => {
    data.set(k(r.recipient), 33 + 34 * i);
    view.setUint16(33 + 34 * i + 32, r.bps, true);
  });
  return {
    channel: channel.address,
    instruction: {
      programAddress: o.program,
      accounts: [
        { address: o.payer, role: ROLE.WRITABLE_SIGNER },
        { address: o.operator, role: ROLE.WRITABLE_SIGNER },
        { address: o.payee, role: ROLE.READONLY },
        { address: o.mint, role: ROLE.READONLY },
        { address: o.authorizedSigner, role: ROLE.READONLY },
        { address: channel.address, role: ROLE.WRITABLE },
        { address: payerAta.address, role: ROLE.WRITABLE },
        { address: channelAta.address, role: ROLE.WRITABLE },
        { address: o.tokenProgram, role: ROLE.READONLY },
        { address: SYSTEM, role: ROLE.READONLY },
        { address: RENT_SYSVAR, role: ROLE.READONLY },
        { address: ATA_PROGRAM, role: ROLE.READONLY },
        { address: eventAuthority.address, role: ROLE.READONLY },
        { address: o.program, role: ROLE.READONLY },
      ],
      data,
    },
  };
}

