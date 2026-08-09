/**
 * Live Solana devnet integration for the SPL-Memo binding. OPT-IN — it runs ONLY when a funded devnet
 * keypair is supplied via `SOLANA_DEVNET_SECRET_KEY` (a JSON array of the 64 secret-key bytes, e.g.
 * `solana-keygen` output); otherwise it is skipped LOUD (never faked). It welds a real atrHash into a
 * memo transaction on devnet and recovers it through the live `Connection` — proving buildAtrMemoInstruction
 * → real tx → makeSolanaReader → recover end-to-end. The SPL `transferChecked` payment leg (needs a devnet
 * USDC token account) is operational-pending, off the binding's critical path — the memo IS the LCP weld.
 */
import { hashAtr } from "@integraledger/lcp-kernel";
import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildAtrMemoInstruction,
  createSolanaAdapter,
  makeSolanaReader,
} from "../src/adapter.js";
import { getSolanaConfig } from "../src/constants.js";
import { SOLANA_MANIFEST } from "../src/manifest.js";

const SECRET = process.env["SOLANA_DEVNET_SECRET_KEY"];
const suite = SECRET ? describe : describe.skip;

suite("binding-solana — live devnet (SOLANA_DEVNET_SECRET_KEY set)", () => {
  it("welds an atrHash into a devnet memo tx and recovers it", async () => {
    const cfg = getSolanaConfig("devnet");
    const connection = new Connection(
      process.env["SOLANA_DEVNET_RPC_URL"] ?? cfg.rpcUrl,
      "confirmed",
    );
    const payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(SECRET ?? "[]") as number[]),
    );
    const atrHash = await hashAtr(
      new TextEncoder().encode("# Terms\nid: 0xsolana-devnet\n"),
    );

    const tx = new Transaction().add(buildAtrMemoInstruction(atrHash, "hex"));
    const signature = await sendAndConfirmTransaction(connection, tx, [payer]);

    const adapter = createSolanaAdapter(SOLANA_MANIFEST);
    const recovered = await adapter.recover(
      { signature },
      makeSolanaReader(connection),
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);
  }, 60_000);
});
