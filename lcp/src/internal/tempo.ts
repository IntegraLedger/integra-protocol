/**
 * The account keychain's key registration: the `KeyAuthorized` event's topic, and the account a receipt's key
 * authorization registered a key for. `../mpp-session.ts`'s `keySearch` reads that account; no entry point exports
 * either name.
 */
import type { AtrHash } from "../core.js";
import { addressWord, hexOf, type Hex } from "../evm-abi.js";
import type { EvmReceipt } from "../evm.js";
import { isAddress, normalHash } from "../fields.js";
import { refusal, type Refusal } from "../refusal.js";
import { ACCOUNT_KEYCHAIN, KEY_AUTHORIZATION_WITNESS_TOPIC } from "../tempo.js";

/** KeyAuthorized(address,address,uint8,uint64): the account and the key id are topics 1 and 2. */
export const KEY_AUTHORIZED_TOPIC = "0x7c46af0758d3eca5e8195833bff1e5153f6249fc0f2968a878fd28544315a03c" as const;

/**
 * The account for which a receipt's key authorization carried witness `h` and registered `keyId`: topic 1 of the
 * account keychain's `KeyAuthorizationWitness` logs whose topic 2 is `h`, when the keychain's `KeyAuthorized` log in
 * the same receipt names that account and `keyId`. The receipt's status is not read: the authorization is applied
 * before the transaction's calls run.
 */
export function keyAccount(receipt: EvmReceipt, h: AtrHash, keyId: Hex): Hex | Refusal {
  const witness = normalHash(h);
  if (witness === null || !isAddress(keyId) || typeof receipt !== "object" || receipt === null || !Array.isArray(receipt.logs)) {
    return refusal("tempo/unreadable");
  }
  const fromKeychain = receipt.logs.filter(
    (l) => typeof l === "object" && l !== null && typeof l.address === "string" && l.address.toLowerCase() === ACCOUNT_KEYCHAIN &&
      Array.isArray(l.topics) && l.topics.length === 3,
  );
  const accounts = new Set<string>();
  for (const l of fromKeychain) {
    if (normalHash(l.topics[0]) === KEY_AUTHORIZATION_WITNESS_TOPIC && normalHash(l.topics[2]) === witness) {
      const a = normalHash(l.topics[1]);
      if (a === null || !a.startsWith(`0x${"0".repeat(24)}`)) return refusal("tempo/unreadable");
      accounts.add(a);
    }
  }
  if (accounts.size === 0) return refusal("tempo/no-witness");
  if (accounts.size > 1) return refusal("tempo/ambiguous");
  const account = [...accounts][0]!;
  const key = hexOf(addressWord(keyId));
  const registered = fromKeychain.some(
    (l) => normalHash(l.topics[0]) === KEY_AUTHORIZED_TOPIC && normalHash(l.topics[1]) === account && normalHash(l.topics[2]) === key,
  );
  return registered ? (`0x${account.slice(26)}` as Hex) : refusal("tempo/key-not-authorized");
}
