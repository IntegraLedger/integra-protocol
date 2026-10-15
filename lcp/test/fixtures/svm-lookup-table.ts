// Composes, with @solana/kit, version-0 messages whose channel-program accounts come from an address lookup table:
// compressTransactionMessageUsingAddressLookupTables moves every non-signer account one table holds past the static
// keys. The table's address is the one kit's documentation of that function uses; nothing reads the table itself.
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransactionMessage,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  decompileTransactionMessage,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
} from "@solana/kit";

export const TABLE = "4QwSwNriKPrz8DLW4ju5uxC2TN5cksJx6tPUPj7DGLAW";
const PROGRAM = "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/**
 * A `settleAndSeal` close (data 04; accounts the payee as fee payer and signer, the channel, the Rent sysvar) with the
 * channel taken from the table, behind one zero signature slot, as base64.
 */
export function tableClose(payee: string, channel: string, recentBlockhash: string): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(payee), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(recentBlockhash), lastValidBlockHeight: 0n }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: address(PROGRAM),
            accounts: [
              { address: address(payee), role: AccountRole.WRITABLE_SIGNER },
              { address: address(channel), role: AccountRole.WRITABLE },
              { address: address("SysvarRent111111111111111111111111111111111"), role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(4),
          },
        ],
        m,
      ),
  );
  const compressed = compressTransactionMessageUsingAddressLookupTables(message, { [address(TABLE)]: [address(channel)] });
  const bytes = new Uint8Array(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(compressed)));
  const wire = new Uint8Array(1 + 64 + bytes.length);
  wire[0] = 1;
  wire.set(bytes, 65);
  return Buffer.from(wire).toString("base64");
}

/**
 * An opening written from `openingBase64` (an opening of two signers whose third instruction is the channel program's
 * `open`): the open's account 4 set to `signer`, read-only, and accounts 5 and 7 to the channel and escrow derived for
 * it (the channel over the seeds "channel", payer, payee, mint, signer, salt and openSlot; the escrow the channel's
 * associated token account for the mint), with `tabled` (account 4 or account 5) taken from the table, or none. The
 * payer, Ed25519 seed `payerSeed`, signs the message in the second signature slot; the fee payer's slot is zero.
 */
export async function tableOpening(
  openingBase64: string,
  signer: string,
  tabled: "signer" | "channel" | null,
  payerSeed: Uint8Array,
): Promise<{ wireBase64: string; channel: string; staticKeys: number }> {
  const opening = Buffer.from(openingBase64, "base64");
  const plain = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(opening.subarray(1 + 64 * opening[0]!)));
  if (plain.version !== 0) throw new Error("the opening is a v0 message");
  const ix = plain.instructions[2]!;
  const metas = ix.accounts as readonly { address: Address; role: AccountRole }[];
  const enc = getAddressEncoder();
  const at = (i: number) => enc.encode(metas[i]!.address);
  const data = ix.data!;
  const [channel] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM),
    seeds: ["channel", at(0), at(2), at(3), enc.encode(address(signer)), data.subarray(1, 9), data.subarray(21, 29)],
  });
  const [escrow] = await getProgramDerivedAddress({ programAddress: address(ATA_PROGRAM), seeds: [enc.encode(channel), at(8), at(3)] });
  const accounts = metas.map((a, i) =>
    i === 4 ? { address: address(signer), role: AccountRole.READONLY } : i === 5 ? { ...a, address: channel } : i === 7 ? { ...a, address: escrow } : a,
  );
  const changed = { ...plain, instructions: [plain.instructions[0]!, plain.instructions[1]!, { ...ix, accounts }] } as typeof plain;
  const inTable: Address[] = tabled === "signer" ? [address(signer)] : tabled === "channel" ? [channel] : [];
  const compressed = compressTransactionMessageUsingAddressLookupTables(changed, { [address(TABLE)]: inTable });
  const compiled = compileTransactionMessage(compressed);
  const bytes = new Uint8Array(getCompiledTransactionMessageEncoder().encode(compiled));
  const wire = new Uint8Array(1 + 128 + bytes.length);
  wire[0] = 2;
  wire.set(ed25519.sign(bytes, payerSeed), 65);
  wire.set(bytes, 129);
  return { wireBase64: Buffer.from(wire).toString("base64"), channel, staticKeys: compiled.staticAccounts.length };
}
