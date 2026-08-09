/**
 * Live Stellar testnet integration for the CAP-67 muxed-address binding. OPT-IN — it runs ONLY when a
 * funded testnet secret seed is supplied via `STELLAR_TESTNET_SECRET` (an S... StrKey); otherwise it is
 * skipped LOUD (never faked). If the seed's account is unfunded, the test funds it via friendbot first.
 *
 * It welds a real atrHash into a CAP-67 muxed M-address destination (`propose`), submits a real signed
 * classic payment to that destination on testnet, confirms the tx on Horizon, and then CONFIRMS the
 * prefix-8 match through the live `StellarReader` (`verify`) — proving buildMuxedDestination → real signed
 * tx → Horizon decode → verify end-to-end.
 *
 * ★ Deliberately a native-XLM classic payment, not a Soroban USDC SAC transfer. The binding weld is the
 * buyer's signature over a tx paying to the muxed destination; the USDC SAC leg needs a funded token
 * balance (operational-pending, off the binding's critical path — same posture as binding-solana's memo).
 * The atrHash[:8] rides in the destination either way. And — the whole honesty point — only 8 bytes are
 * on-chain: the test asserts `verify` CONFIRMS the known atrHash but never reconstructs the full hash.
 */
import { hashAtr } from "@integraledger/lcp-kernel";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  createStellarAdapter,
  type StellarReader,
  type StellarSettlementView,
} from "../src/adapter.js";
import { getStellarConfig } from "../src/constants.js";
import { STELLAR_MANIFEST } from "../src/manifest.js";

const SECRET = process.env["STELLAR_TESTNET_SECRET"];
const suite = SECRET ? describe : describe.skip;

async function ensureFunded(
  server: Horizon.Server,
  pubkey: string,
): Promise<void> {
  try {
    await server.loadAccount(pubkey);
  } catch {
    const res = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(pubkey)}`,
    );
    if (!res.ok)
      throw new Error(`friendbot funding failed: HTTP ${res.status}`);
  }
}

/**
 * A live reader over Horizon: decodes the classic payment's `to` (a muxed M-address) from the tx's ops,
 * and carries the transaction's `successful` flag. Both halves are load-bearing — `/transactions/{hash}`
 * returns FAILED transactions too, and a failed transaction's envelope still names the M-address, so the
 * destination alone cannot tell a settlement from a fee-charged failure.
 */
function horizonReader(server: Horizon.Server): StellarReader {
  return {
    async settlementView(txHash: string): Promise<StellarSettlementView> {
      const { successful } = await server
        .transactions()
        .transaction(txHash)
        .call();
      const ops = await server.operations().forTransaction(txHash).call();
      for (const op of ops.records) {
        if (op.type === "payment" && typeof op.to_muxed === "string")
          return { muxedDestination: op.to_muxed, successful };
      }
      return { muxedDestination: null, successful };
    },
    async transactionsFor(): Promise<string[]> {
      return [];
    },
  };
}

suite("binding-stellar — live testnet (STELLAR_TESTNET_SECRET set)", () => {
  it("welds an atrHash into a muxed destination on testnet and CONFIRMS the prefix-8 match", async () => {
    const cfg = getStellarConfig("testnet");
    const server = new Horizon.Server(cfg.horizonUrl);
    const payer = Keypair.fromSecret(SECRET ?? "");
    await ensureFunded(server, payer.publicKey());

    const atrHash = await hashAtr(
      new TextEncoder().encode("# Terms\nid: 0xstellar-testnet\n"),
    );

    const adapter = createStellarAdapter(STELLAR_MANIFEST);
    // Weld: destination = seller base G-pubkey + mux_id = atrHash[:8]. Here payer == seller base for a
    // self-payment; only the muxed destination binding matters for the test.
    const muxedDest = adapter.propose(atrHash, payer.publicKey());

    const account = await server.loadAccount(payer.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: cfg.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: muxedDest,
          asset: Asset.native(),
          amount: "0.0000001",
        }),
      )
      .setTimeout(120)
      .build();
    tx.sign(payer);
    const submitted = await server.submitTransaction(tx);
    const txHash = submitted.hash;

    const confirmed = await adapter.verify(
      atrHash,
      { txHash },
      horizonReader(server),
    );
    expect("refused" in confirmed).toBe(false);
    if (!("refused" in confirmed)) {
      expect(confirmed.value.confirmed).toBe(true);
      // Only 8 bytes on-chain — the confirmed prefix is 0x + 16 hex, never the full 64-hex atrHash.
      expect(confirmed.value.muxIdPrefix8Hex.length).toBe(18);
      expect(confirmed.value.muxIdPrefix8Hex).toBe(atrHash.slice(0, 18));
    }
  }, 60_000);
});
