// Rewrites a vector's Solana wire with @solana/kit as a durable-nonce message: kit's
// setTransactionMessageLifetimeUsingDurableNonce puts AdvanceNonceAccount (the nonce account, the RecentBlockhashes
// sysvar, the nonce authority as a signer) first and the nonce value in the blockhash field, then
// compressTransactionMessageUsingAddressLookupTables moves the accounts one lookup table holds past the static keys.
// Every signature slot is zero. The nonce account, authority and value are x402-exact-solana.json's durableNonce.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  address,
  compileTransactionMessage,
  compressTransactionMessageUsingAddressLookupTables,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  setTransactionMessageLifetimeUsingDurableNonce,
  type Nonce,
} from "@solana/kit";

const D = JSON.parse(readFileSync(new URL("../../vectors/x402-exact-solana.json", import.meta.url), "utf8")).durableNonce;

export const DURABLE = {
  nonceAccount: D.nonceAccount as string,
  nonceAuthority: D.nonceAuthority as string,
  value: D.value as string,
  table: D.lookupTable.sysvarTable as string,
  sysvar: "SysvarRecentB1ockHashes11111111111111111111",
};

/**
 * `wireBase64`'s message made durable with the nonce authority as its signer, with `inTable` (the sysvar, or the
 * nonce account and the sysvar) loaded from one lookup table: the wire, the static key count, AdvanceNonceAccount's
 * account indexes and the message's SHA-256 as `0x` hex.
 */
export function durableWire(
  wireBase64: string,
  inTable: readonly string[],
): { wireBase64: string; staticKeys: number; instruction0Accounts: number[]; digest: string } {
  const signed = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(wireBase64, "base64")));
  const plain = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(signed.messageBytes));
  if (plain.version !== 0) throw new Error("the vector's wire is a v0 message");
  const durable = setTransactionMessageLifetimeUsingDurableNonce(
    {
      nonce: DURABLE.value as Nonce,
      nonceAccountAddress: address(DURABLE.nonceAccount),
      nonceAuthorityAddress: address(DURABLE.nonceAuthority),
    },
    plain,
  );
  const compressed = compressTransactionMessageUsingAddressLookupTables(durable, {
    [address(DURABLE.table)]: inTable.map((a) => address(a)),
  });
  const compiled = compileTransactionMessage(compressed);
  const message = new Uint8Array(getCompiledTransactionMessageEncoder().encode(compiled));
  const signers = compiled.header.numSignerAccounts;
  const wire = new Uint8Array(1 + 64 * signers + message.length);
  wire[0] = signers;
  wire.set(message, 1 + 64 * signers);
  return {
    wireBase64: Buffer.from(wire).toString("base64"),
    staticKeys: compiled.staticAccounts.length,
    instruction0Accounts: [...(compiled.instructions[0]!.accountIndices ?? [])],
    digest: `0x${createHash("sha256").update(message).digest("hex")}`,
  };
}
