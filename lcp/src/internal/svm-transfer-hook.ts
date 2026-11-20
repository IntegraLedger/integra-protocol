/**
 * The accounts a Token-2022 `TransferChecked` carries where its mint's `TransferHook` extension names a program, resolved
 * as the spl-transfer-hook interface states them (solana-program/transfer-hook at 155d8212, `interface/src/offchain.rs`;
 * solana-program/libraries at 07b9b49e, `tlv-account-resolution/src/{account,seeds,pubkey_data}.rs`): the program's
 * extra accounts for `Execute`, then the program, then its validation account. Token-2022 invokes the hook with the
 * transfer's accounts and these, and the transfer fails where one is missing.
 */
import { base58 } from "@scure/base";
import { isObject } from "../fields.js";
import { refusal, type Refusal } from "../refusal.js";
import { ATA_PROGRAM, TOKEN_2022, isKey } from "./svm.js";
import type { SvmReader } from "./svm-read.js";

/** An account a transaction instruction names, with its `AccountRole` number. */
export interface HookAccount {
  readonly address: string;
  readonly role: number;
}

/** The transfer a hook's accounts are resolved for: from the payer's associated token account to the payee's. */
export interface HookTransfer {
  readonly mint: string;
  readonly payer: string;
  readonly payTo: string;
  readonly amount: bigint;
}

/** `Execute`'s instruction discriminator, the first 8 bytes of SHA-256 of `spl-transfer-hook-interface:execute`. */
const EXECUTE = Uint8Array.of(105, 37, 101, 197, 75, 251, 102, 26);
/** Token-2022's `ExtensionType::TransferHook`. */
const TRANSFER_HOOK = 14;
/** A Token-2022 mint's base state, padded to a token account's 165 bytes, then its `AccountType` byte, `Mint` = 1. */
const ACCOUNT_TYPE_AT = 165;
/** One packed `ExtraAccountMeta`: a discriminator, a 32-byte address config, `is_signer` and `is_writable`. */
const META_SIZE = 35;
const READONLY = 0;
const WRITABLE = 1;
const SIGNER = 2;

type Kit = typeof import("@solana/kit");

/** A resolution that stopped: where the reader failed, `unreadable`, else the accounts do not resolve. */
class Unresolved {
  constructor(readonly unreadable = false) {}
}

/**
 * The program a Token-2022 mint's `TransferHook` extension names, or null where the mint carries none or names none:
 * its extensions are type-length-value entries after the `AccountType` byte, each a u16 type and a u16 length, and
 * `TransferHook`'s value is its authority and its program, 32 bytes each, all zero for none.
 */
export function hookProgramOf(mint: Uint8Array): string | null {
  if (mint.length <= ACCOUNT_TYPE_AT || mint[ACCOUNT_TYPE_AT] !== 1) return null;
  const view = new DataView(mint.buffer, mint.byteOffset, mint.byteLength);
  for (let at = ACCOUNT_TYPE_AT + 1; at + 4 <= mint.length; ) {
    const type = view.getUint16(at, true);
    const length = view.getUint16(at + 2, true);
    if (type === 0 || at + 4 + length > mint.length) return null;
    if (type === TRANSFER_HOOK) {
      if (length !== 64) return null;
      const program = mint.subarray(at + 36, at + 68);
      return program.every((b) => b === 0) ? null : base58.encode(program);
    }
    at += 4 + length;
  }
  return null;
}

/** The `ExtraAccountMeta` list a validation account holds under `Execute`'s discriminator, or null where it holds none. */
function executeMetasOf(data: Uint8Array): Uint8Array[] | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = 0; at + 12 <= data.length; ) {
    const length = view.getUint32(at + 8, true);
    const value = at + 12;
    if (value + length > data.length) return null;
    if (EXECUTE.every((b, i) => data[at + i] === b)) {
      if (length < 4) return null;
      const count = view.getUint32(value, true);
      if (length !== 4 + count * META_SIZE) return null;
      return Array.from({ length: count }, (_, i) => data.subarray(value + 4 + i * META_SIZE, value + 4 + (i + 1) * META_SIZE));
    }
    at = value + length;
  }
  return null;
}

/**
 * The extra accounts, the hook's program and its validation account for a transfer of `t`'s mint, read through
 * `reader` at `confirmed`, in the order the interface's `add_extra_account_metas_for_execute` appends them; none where
 * the mint is not a Token-2022 mint or names no hook program. The validation account is the hook program's PDA of
 * `extra-account-metas` and the mint; each extra account is resolved in order against the accounts of `Execute`
 * (the payer's associated token account, the mint, the payee's, the payer and the validation account) and those
 * resolved before it, from its literal address, a PDA of the hook program or of an account named before it, or a key
 * read from `Execute`'s data or an account's data, with its seeds' literals, `Execute`'s data (its discriminator and the
 * amount, a u64 little-endian), an account's key or a slice of an account's data. An account that repeats one before it
 * takes no role that one lacks, those of `Execute` being read-only. `svm/transfer-hook-unresolved` where the validation
 * account does not exist or holds no list for `Execute`, an entry or a seed does not decode or names what is not
 * there, or an account resolved still signs, a signature beyond the payer's and the fee payer's; `svm/unreadable`
 * where the reader rejects or answers out of its form; `svm/peer-missing` where `@solana/kit` cannot be loaded.
 */
export async function transferHookAccounts(
  reader: Pick<SvmReader, "account">,
  t: HookTransfer,
): Promise<readonly HookAccount[] | Refusal> {
  let kit: Kit;
  try {
    kit = await import("@solana/kit");
  } catch {
    return refusal("svm/peer-missing");
  }
  try {
    return await resolve(kit, reader, t);
  } catch (e) {
    if (e instanceof Unresolved) return e.unreadable ? refusal("svm/unreadable") : refusal("svm/transfer-hook-unresolved");
    throw e;
  }
}

async function resolve(kit: Kit, reader: Pick<SvmReader, "account">, t: HookTransfer): Promise<readonly HookAccount[]> {
  const read = readerOf(reader);
  const mint = await read(t.mint);
  if (mint === null || mint.owner !== TOKEN_2022) return [];
  const program = hookProgramOf(mint.data);
  if (program === null) return [];
  const pda = async (programAddress: string, seeds: readonly Uint8Array[]): Promise<string> => {
    try {
      const [found] = await kit.getProgramDerivedAddress({ programAddress: kit.address(programAddress), seeds: [...seeds] });
      return found;
    } catch {
      throw new Unresolved();
    }
  };
  const ata = (owner: string) => pda(ATA_PROGRAM, [base58.decode(owner), base58.decode(TOKEN_2022), base58.decode(t.mint)]);
  const validation = await pda(program, [new TextEncoder().encode("extra-account-metas"), base58.decode(t.mint)]);
  const state = await read(validation);
  const metas = state === null ? null : executeMetasOf(state.data);
  if (metas === null) throw new Unresolved();

  const data = new Uint8Array(16);
  data.set(EXECUTE, 0);
  new DataView(data.buffer).setBigUint64(8, t.amount, true);
  const accounts: HookAccount[] = [await ata(t.payer), t.mint, await ata(t.payTo), t.payer, validation].map((address) => ({ address, role: READONLY }));
  for (const meta of metas) {
    const address = await addressOf(meta, accounts, data, program, read, pda);
    const flags = [meta[33], meta[34]];
    if (flags.some((f) => f !== 0 && f !== 1)) throw new Unresolved();
    const asked = (flags[0] === 1 ? SIGNER : 0) | (flags[1] === 1 ? WRITABLE : 0);
    const before = accounts.filter((a) => a.address === address).reduce<number | null>((r, a) => (r === null ? a.role : r | a.role), null);
    const role = before === null ? asked : asked & before;
    if ((role & SIGNER) !== 0) throw new Unresolved();
    accounts.push({ address, role });
  }
  return [...accounts.slice(5), { address: program, role: READONLY }, { address: validation, role: READONLY }];
}

type Read = (address: string) => Promise<{ owner: string; data: Uint8Array } | null>;

/** Reads an account at `confirmed` once, its answer kept for every later read of the same address. */
function readerOf(reader: Pick<SvmReader, "account">): Read {
  const seen = new Map<string, Promise<{ owner: string; data: Uint8Array } | null>>();
  return (address) => {
    let got = seen.get(address);
    if (got === undefined) {
      got = (async () => {
        let answer: unknown;
        try {
          answer = await reader.account(address, "confirmed");
        } catch {
          throw new Unresolved(true);
        }
        if (!isObject(answer) || typeof answer["slot"] !== "bigint") throw new Unresolved(true);
        const value = answer["value"];
        if (value === null) return null;
        if (!isObject(value) || typeof value["owner"] !== "string" || !(value["data"] instanceof Uint8Array)) throw new Unresolved(true);
        return { owner: value["owner"], data: value["data"] };
      })();
      seen.set(address, got);
    }
    return got;
  };
}

/**
 * The address one `ExtraAccountMeta` resolves to: discriminator 0, the literal 32 bytes; 1, a PDA of the hook program
 * from its seeds; 2, a key read from `Execute`'s data (`1`, an index) or from an account's data (`2`, the account's
 * index and an offset); 128 and up, a PDA of the program at account index `discriminator - 128` from its seeds.
 */
async function addressOf(
  meta: Uint8Array,
  accounts: readonly HookAccount[],
  data: Uint8Array,
  program: string,
  read: Read,
  pda: (program: string, seeds: readonly Uint8Array[]) => Promise<string>,
): Promise<string> {
  const kind = meta[0]!;
  const config = meta.subarray(1, 33);
  if (kind === 0) return base58.encode(config);
  if (kind === 1) return pda(program, await seedsOf(config, accounts, data, read));
  if (kind >= 128) {
    const owner = accounts[kind - 128];
    if (owner === undefined) throw new Unresolved();
    return pda(owner.address, await seedsOf(config, accounts, data, read));
  }
  if (kind === 2) {
    const key =
      config[0] === 1
        ? data.subarray(config[1]!, config[1]! + 32)
        : config[0] === 2
          ? await accountSlice(accounts, config[1]!, config[2]!, 32, read)
          : null;
    if (key === null || key.length !== 32) throw new Unresolved();
    return base58.encode(key);
  }
  throw new Unresolved();
}

/**
 * The seeds a 32-byte address config packs, each its discriminator and its fields, up to the first zero discriminator:
 * 1, a literal (its length, then its bytes); 2, a slice of `Execute`'s data (index, length); 3, an account's key (its
 * index); 4, a slice of an account's data (its index, the offset, the length).
 */
async function seedsOf(config: Uint8Array, accounts: readonly HookAccount[], data: Uint8Array, read: Read): Promise<Uint8Array[]> {
  const seeds: Uint8Array[] = [];
  let at = 0;
  while (at < config.length && config[at] !== 0) {
    const kind = config[at]!;
    if (kind === 1) {
      const length = config[at + 1] ?? 0;
      if (at + 2 + length > config.length) throw new Unresolved();
      seeds.push(config.slice(at + 2, at + 2 + length));
      at += 2 + length;
    } else if (kind === 2) {
      const [index, length] = [config[at + 1], config[at + 2]];
      if (index === undefined || length === undefined || index + length > data.length) throw new Unresolved();
      seeds.push(data.slice(index, index + length));
      at += 3;
    } else if (kind === 3) {
      const account = accounts[config[at + 1] ?? accounts.length];
      if (account === undefined) throw new Unresolved();
      seeds.push(base58.decode(account.address));
      at += 2;
    } else if (kind === 4) {
      const [index, offset, length] = [config[at + 1], config[at + 2], config[at + 3]];
      if (index === undefined || offset === undefined || length === undefined) throw new Unresolved();
      seeds.push(await accountSlice(accounts, index, offset, length, read));
      at += 4;
    } else {
      throw new Unresolved();
    }
  }
  return seeds;
}

/** `length` bytes at `offset` of the data of the account at `index`, which must exist and hold them. */
async function accountSlice(accounts: readonly HookAccount[], index: number, offset: number, length: number, read: Read): Promise<Uint8Array> {
  const account = accounts[index];
  if (account === undefined || !isKey(account.address)) throw new Unresolved();
  const got = await read(account.address);
  if (got === null || offset + length > got.data.length) throw new Unresolved();
  return got.data.slice(offset, offset + length);
}

