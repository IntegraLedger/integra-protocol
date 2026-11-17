// A constructed Tempo ledger: eip155-tempo-mpp-ledger.ts's EVM ledger, with the nonce precompile's state derived from
// the ledger's own transactions (each Tempo transaction takes its value in its block, whatever its result: the chain
// consumes it before the calls run), the protocol nonce, and each block's transactions. `consumed` adds values taken by
// no transaction the ledger holds, as a ledger whose consumer the read cannot find. The account keychain's `getKey`
// answers from the key authorizations the ledger's Tempo transactions carry (each registers its key for its sender in
// its block, whatever its result) and from `keys`, slots registered or revoked by no transaction the ledger holds.
// Constructed, not recorded.
import { addressWord, bytesOf, concat, hexOf, keccakHex, uintOf, uintWord, type Hex } from "../src/evm-abi.js";
import { ReaderError } from "../src/evm.js";
import { readKeyAuthorization } from "../src/internal/key-authorization.js";
import { GET_KEY_SELECTOR } from "../src/internal/tempo-key-slot.js";
import { carriedKeyAuthorization, tempoSender } from "../src/internal/tempo-envelope.js";
import { isRefusal } from "../src/refusal.js";
import { ACCOUNT_KEYCHAIN } from "../src/tempo.js";
import { EXPIRING_NONCE_KEY, GET_NONCE_SELECTOR, NONCE_PRECOMPILE, tempoValueOf, type TempoSearchReader, type TempoValue } from "../src/internal/tempo-nonce.js";
import { ledgerReader, type LedgerSpec } from "./eip155-tempo-mpp-ledger.js";

export interface TempoLedgerSpec extends LedgerSpec {
  /** Values a transaction the ledger does not hold took, each from its block on. */
  readonly consumed?: readonly { readonly value: TempoValue; readonly from: bigint }[];
  /** The blocks whose transactions the reader does not list (`eth_getBlockByNumber` rejects). */
  readonly unlisted?: readonly bigint[];
  /** Key slots registered from block `from` on, and revoked from `revoked` on, by no transaction the ledger holds. */
  readonly keys?: readonly { readonly account: Hex; readonly keyId: Hex; readonly from: bigint; readonly revoked?: bigint }[];
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The reader of a constructed Tempo ledger. */
export function tempoLedgerReader(spec: TempoLedgerSpec): TempoSearchReader & { readonly calls: string[] } {
  const base = ledgerReader(spec);
  const taken = (block: bigint): { value: TempoValue; validBefore: bigint }[] => [
    ...spec.txs.flatMap((t) => {
      const wire = t.raw === undefined ? undefined : bytesOf(t.raw);
      const v = wire === undefined || t.block > block || t.block > spec.heads.latest ? undefined : tempoValueOf(wire);
      return v === undefined ? [] : [{ value: v, validBefore: v.validBefore ?? 1n }];
    }),
    ...(spec.consumed ?? []).filter((c) => c.from <= block).map((c) => ({ value: c.value, validBefore: c.value.validBefore ?? 1n })),
  ];
  const next = (sender: string, key: bigint, block: bigint): bigint =>
    taken(block)
      .filter((t) => same(t.value.sender, sender) && t.value.key === key)
      .reduce((n, t) => (t.value.nonce + 1n > n ? t.value.nonce + 1n : n), 0n);
  const visible = (block: bigint): void => {
    if (block > spec.heads.latest) throw new ReaderError("transport", "no such block");
  };
  return {
    ...base,
    calls: base.calls,
    network: base.network,
    async storageAt(address: Hex, slot: Hex, block: bigint): Promise<Hex> {
      base.calls.push("storageAt");
      visible(block);
      if (!same(address, NONCE_PRECOMPILE)) return hexOf(uintWord(0n));
      const hit = taken(block).find(
        (t) => t.value.key === EXPIRING_NONCE_KEY && same(keccakHex(concat([bytesOf(t.value.signed)!, uintWord(1n)])), slot),
      );
      return hexOf(uintWord(hit === undefined ? 0n : hit.validBefore));
    },
    async nonceAt(account: Hex, block: bigint): Promise<bigint> {
      base.calls.push("nonceAt");
      visible(block);
      return next(account, 0n, block);
    },
    async call(to: Hex, data: Hex, block: bigint): Promise<Hex> {
      if (same(to, ACCOUNT_KEYCHAIN) && data.toLowerCase().startsWith(GET_KEY_SELECTOR)) {
        base.calls.push("call");
        visible(block);
        const d = bytesOf(data)!;
        const account = hexOf(d.subarray(16, 36));
        const keyId = hexOf(d.subarray(48, 68));
        const carried = spec.txs.some((t) => {
          const wire = t.raw === undefined || t.block > block ? undefined : bytesOf(t.raw);
          if (wire === undefined || (wire[0] !== 0x76 && wire[0] !== 0x78)) return false;
          const sender = tempoSender(wire);
          const k = carriedKeyAuthorization(wire);
          const read = typeof k === "string" ? readKeyAuthorization(k) : undefined;
          return !isRefusal(sender) && same(sender, account) && read !== undefined && !isRefusal(read) && same(read.keyId, keyId);
        });
        const extra = (spec.keys ?? []).find((k) => same(k.account, account) && same(k.keyId, keyId) && k.from <= block);
        const revoked = extra?.revoked !== undefined && extra.revoked <= block;
        const held = (carried || extra !== undefined) && !revoked;
        // KeyInfo: signatureType, keyId, expiry, enforceLimits, isRevoked; a blank entry where none is held.
        return hexOf(concat([uintWord(0n), held ? addressWord(keyId) : uintWord(0n), uintWord(held ? 1n << 40n : 0n), uintWord(0n), uintWord(revoked ? 1n : 0n)]));
      }
      if (same(to, NONCE_PRECOMPILE) && data.toLowerCase().startsWith(GET_NONCE_SELECTOR)) {
        base.calls.push("call");
        visible(block);
        const d = bytesOf(data)!;
        return hexOf(uintWord(next(hexOf(d.subarray(16, 36)), uintOf(d.subarray(36, 68)), block)));
      }
      return base.call(to, data, block);
    },
    async blockTransactions(block: bigint): Promise<readonly Hex[]> {
      base.calls.push("blockTransactions");
      visible(block);
      if ((spec.unlisted ?? []).includes(block)) throw new ReaderError("transport", "block not served");
      return spec.txs.filter((t) => t.block === block).map((t) => t.hash);
    },
  };
}
