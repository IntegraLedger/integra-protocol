// A transfer of a Token-2022 mint whose TransferHook extension names a program, built by x402/exact/solana's build with
// a reader of the accounts fixtures/svm-transfer-hook.json records. Every expected value is the fixture's landed
// transaction's, as devnet read it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCompiledTransactionMessageDecoder } from "@solana/kit";
import type { AtrHash } from "../src/core.js";
import { TOKEN_2022, type SvmReader } from "../src/svm.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import type { PaymentRequirements } from "../src/x402.js";

const F = JSON.parse(readFileSync(new URL("./fixtures/svm-transfer-hook.json", import.meta.url), "utf8"));
const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-solana.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;

/** A reader of the fixture's network that answers the fixture's accounts and no other. */
const reader: Pick<SvmReader, "network" | "account"> = {
  network: F.network,
  account: async (address) => {
    const a = F.accounts[address];
    return { slot: 0n, value: a === undefined ? null : { owner: a.owner, data: Uint8Array.from(Buffer.from(a.data, "hex")) } };
  },
};

describe("svm-transfer-hook.json", () => {
  it("build with a reader appends the hook's accounts to TransferChecked as the landed transfer carries them", async () => {
    const t = F.transfer;
    const option: PaymentRequirements = {
      scheme: "exact",
      network: F.network,
      amount: t.amount,
      asset: t.mint,
      payTo: t.payTo,
      maxTimeoutSeconds: 60,
      extra: { feePayer: V.fixed.feePayer },
    };
    const doc = exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [option] }, H, V.fixed.link, option);
    if ("refused" in doc) throw new Error(doc.code);
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: t.payer,
      decimals: t.decimals,
      tokenProgram: TOKEN_2022,
      recentBlockhash: V.fixed.blockhash,
      reader,
    };
    const u = await exactSvm.build(choice, H);
    if ("refused" in u) throw new Error(u.code);
    const m = getCompiledTransactionMessageDecoder().decode(u.request.message);
    // The option lists no transactionVersions, so build writes a version-0 message.
    if (m.version !== 0) throw new Error(`version ${String(m.version)}`);
    const keys = m.staticAccounts.map(String);
    const instructions = m.instructions;
    const transfer = instructions.filter((ix) => keys[ix.programAddressIndex] === TOKEN_2022 && ix.data?.[0] === 12);
    expect(transfer).toHaveLength(1);
    const accounts = (transfer[0]!.accountIndices ?? []).map((i) => keys[i]);
    // The four of TransferChecked and the five extra accounts in the order the validation account lists them; then the
    // hook's program and its validation account, which Token-2022 finds by key.
    expect(accounts.slice(0, 9)).toEqual(F.landed.slice(0, 9));
    expect([...accounts.slice(9)].sort()).toEqual([...F.landed.slice(9)].sort());
    // No account the hook adds signs: the payer and the fee payer are the message's only signers.
    expect(m.header.numSignerAccounts).toBe(2);
    // Where the caller names no compute unit limit, the hook's transfer is built at 400,000.
    const limit = instructions.filter((ix) => keys[ix.programAddressIndex] === "ComputeBudget111111111111111111111111111111" && ix.data?.[0] === 2);
    expect(limit).toHaveLength(1);
    expect(Buffer.from(limit[0]!.data!.subarray(1, 5)).readUInt32LE()).toBe(400_000);
  });
});
