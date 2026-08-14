/**
 * Live Sui testnet integration for the Pay402 `payment_id` binding. OPT-IN — it runs ONLY when a funded
 * testnet Ed25519 secret key is supplied via `SUI_TESTNET_SECRET_KEY` (a Bech32 `suiprivkey1…` string or
 * a 0x/base64 32-byte secret) AND the deployed Pay402 fork package id via `SUI_PAY402_PACKAGE_ID` and the
 * buyer's USDC `Coin<T>` object id via `SUI_USDC_COIN_ID` (+ its type via `SUI_USDC_COIN_TYPE`); otherwise
 * it is skipped LOUD (never faked). It requests faucet gas, welds a real atrHash into a Pay402
 * `settle_payment` transaction on testnet, and recovers it through the live JSON-RPC client — proving
 * appendSettlePaymentCall → real tx → makeSuiReader → recover end-to-end. The atrHash IS the LCP weld; the
 * USDC coin plumbing is operational setup, off the binding's critical path.
 */

import { hashAtr } from "@integraledger/lcp-kernel";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it } from "vitest";
import { appendSettlePaymentCall, createSuiAdapter } from "../src/adapter.js";
import { getSuiConfig, pay402SettledEventType } from "../src/constants.js";
import { SUI_MANIFEST } from "../src/manifest.js";
import { makeSuiReader } from "../src/reader.js";

const SECRET = process.env["SUI_TESTNET_SECRET_KEY"];
const PKG = process.env["SUI_PAY402_PACKAGE_ID"];
const COIN_ID = process.env["SUI_USDC_COIN_ID"];
const COIN_TYPE = process.env["SUI_USDC_COIN_TYPE"];
const ready =
  SECRET !== undefined &&
  PKG !== undefined &&
  COIN_ID !== undefined &&
  COIN_TYPE !== undefined;
const suite = ready ? describe : describe.skip;

suite(
  "binding-sui — live testnet (SUI_TESTNET_SECRET_KEY + SUI_PAY402_PACKAGE_ID set)",
  () => {
    it("welds an atrHash into a Pay402 settle tx and recovers it", async () => {
      const cfg = getSuiConfig("testnet");
      const client = new SuiJsonRpcClient({
        url: process.env["SUI_TESTNET_RPC_URL"] ?? cfg.rpcUrl,
        network: "testnet",
      });
      const keypair = Ed25519Keypair.fromSecretKey(SECRET as string);
      const buyer = keypair.getPublicKey().toSuiAddress();

      // Faucet ONLY when the buyer cannot pay for gas. The faucet is a per-CLIENT quota, and calling it
      // unconditionally on every run is what turned this suite red the first time it ever executed:
      // "Too many requests from this client have been sent to the faucet." A pre-funded account is the
      // supported way to run this repeatedly, so the faucet is a fallback for a drained account rather
      // than a step. A faucet refusal is only fatal if the balance is ALSO insufficient — otherwise the
      // rail is fundable and the run proceeds.
      const gasBudget = 50_000_000n; // 0.05 SUI — comfortably above the settle_payment call's cost.
      const balance = BigInt(
        (await client.getBalance({ owner: buyer })).totalBalance,
      );
      if (balance < gasBudget) {
        await requestSuiFromFaucetV2({
          host: getFaucetHost("testnet"),
          recipient: buyer,
        });
      }

      const atrHash = await hashAtr(
        new TextEncoder().encode("# Terms\nid: 0xsui-testnet\n"),
      );

      const tx = new Transaction();
      appendSettlePaymentCall(tx, {
        packageId: PKG as string,
        coinType: COIN_TYPE as string,
        buyerCoin: COIN_ID as string,
        buyer,
        merchant: buyer,
        amount: 1n,
        facilitatorFee: 0n,
        atrHash,
      });
      tx.setSender(buyer);

      const result = await client.signAndExecuteTransaction({
        transaction: tx,
        signer: keypair,
        options: { showEvents: true },
      });
      expect(result.effects?.status.status).toBe("success");

      const adapter = createSuiAdapter(SUI_MANIFEST);
      const recovered = await adapter.recover(
        { digest: result.digest, packageId: PKG as string },
        makeSuiReader(client),
      );
      expect("refused" in recovered).toBe(false);
      if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);

      // enumerate the settle event type and confirm the same digest surfaces.
      const hits = await adapter.enumerate(
        atrHash,
        pay402SettledEventType(PKG as string),
        makeSuiReader(client),
        50,
      );
      expect(hits.some((h) => h.digest === result.digest)).toBe(true);
    }, 120_000);
  },
);
