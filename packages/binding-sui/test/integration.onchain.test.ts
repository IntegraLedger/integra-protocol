/**
 * Live Sui testnet integration for the Pay402 `payment_id` binding. OPT-IN — it runs ONLY when a funded
 * testnet Ed25519 secret key is supplied via `SUI_TESTNET_SECRET_KEY` (a Bech32 `suiprivkey1…` string or
 * a 0x/base64 32-byte secret) AND the deployed Pay402 fork package id via `SUI_PAY402_PACKAGE_ID` and the
 * buyer's USDC `Coin<T>` object id via `SUI_USDC_COIN_ID` (+ its type via `SUI_USDC_COIN_TYPE`); otherwise
 * it is skipped LOUD (never faked). It requests faucet gas, welds a real atrHash into a Pay402
 * `settle_payment` transaction on testnet, and recovers it through the live JSON-RPC client — proving
 * appendSettlePaymentCall → real tx → makeSuiReader → recover end-to-end. The atrHash IS the LCP weld; the
 * USDC coin plumbing is operational setup, off the binding's critical path.
 *
 * ⛔ A fifth variable, `SUI_TESTNET_RPC_URL`, is REQUIRED once the other four are set, and it has no
 * default — see the refusal at the top of the body.
 *
 * ⚠️ One leg is attempted rather than required, and only one: the `suix_queryEvents` forward scan behind
 * `enumerate`, which a node can refuse to serve for reasons that are not about this repo. The measurement
 * and the exact error class tolerated are stated at the assertion; everything else here is unconditional.
 */

import { hashAtr } from "@integraledger/lcp-kernel";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it } from "vitest";
import { appendSettlePaymentCall, createSuiAdapter } from "../src/adapter.js";
import { pay402SettledEventType } from "../src/constants.js";
import { SUI_MANIFEST } from "../src/manifest.js";
import { makeSuiReader } from "../src/reader.js";

const SECRET = process.env["SUI_TESTNET_SECRET_KEY"];
const PKG = process.env["SUI_PAY402_PACKAGE_ID"];
const COIN_ID = process.env["SUI_USDC_COIN_ID"];
const COIN_TYPE = process.env["SUI_USDC_COIN_TYPE"];
const RPC_URL = process.env["SUI_TESTNET_RPC_URL"];
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
      // ⛔⛔ NO FALLBACK, AND THAT IS THE FIX. This read was
      // `process.env["SUI_TESTNET_RPC_URL"] ?? getSuiConfig("testnet").rpcUrl`, and the default it reached
      // for is dead: measured 2026-09-10, `https://fullnode.testnet.sui.io` answers EVERY method with
      // `-32601 "JSON-RPC on public fullnodes has been deprecated"`. A fallback to a public default is a
      // degraded path only while the default works; once it is gone the `??` is not a convenience, it is
      // the missing refusal — and it fails as a method-not-found deep inside the SDK, which reads as a
      // code fault rather than as the missing credential it is.
      //
      // ⭐ It is deliberately NOT part of `ready`. `ready` answers "is this machine meant to run the live
      // rail at all", and a machine carrying the other four credentials has already answered yes; skipping
      // there would report the rail unrun for a reason nobody would go looking for. A misconfiguration is
      // a refusal, thrown before a key is loaded or a faucet is called.
      if (RPC_URL === undefined)
        throw new Error(
          "binding-sui live rail: REFUSING to run. SUI_TESTNET_RPC_URL is unset and there is no default " +
            "to fall back to — Sui's public fullnode JSON-RPC is deprecated and answers -32601 to every " +
            "method. Supply a provider JSON-RPC endpoint for this rail.",
        );
      const client = new SuiJsonRpcClient({
        url: RPC_URL,
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
        // `showEffects` is REQUIRED for the assertion below: Sui returns only the response sections a
        // caller opts into, so requesting events alone left `effects` undefined and the status assertion
        // compared undefined to "success". The suite had never run, so the omission never surfaced.
        options: { showEffects: true, showEvents: true },
      });
      expect(result.effects?.status.status).toBe("success");

      // Executed is not the same as READABLE. `signAndExecuteTransaction` returns once the transaction is
      // executed, but reading it back can 404 with "Could not find the referenced transaction" until the
      // fullnode has indexed it — and a provider endpoint may answer the read from a different node than
      // the one that took the write. This suite passed on its first live run and failed on the next with
      // exactly that error; the difference was timing, not code, which is the signature of a race rather
      // than a flake to retry away. `waitForTransaction` is the SDK's own answer and makes the read
      // deterministic.
      await client.waitForTransaction({ digest: result.digest });

      const adapter = createSuiAdapter(SUI_MANIFEST);
      const recovered = await adapter.recover(
        { digest: result.digest, packageId: PKG as string },
        makeSuiReader(client),
      );
      expect("refused" in recovered).toBe(false);
      if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);

      // ⭐ THE EVENT TYPE, ASSERTED AGAINST THE CHAIN — and by a TARGETED read rather than a scan.
      //
      // This is the half of the old `enumerate` assertion that was ever about this package: that the
      // settlement really emitted `<packageId>::payment::PaymentSettled`, so `recover`'s exact-type match
      // is a name the chain answers to rather than one this repo believes in. `settledEvents` resolves one
      // digest — no index, no history window — and it is therefore the leg a live run can always owe.
      const eventType = pay402SettledEventType(PKG as string);
      const emitted = await makeSuiReader(client).settledEvents(result.digest);
      expect(emitted.map((e) => e.type)).toContain(eventType);

      // ⛔⛔ THE FORWARD SCAN IS ATTEMPTED, NOT REQUIRED — and the reason is MEASURED, not assumed.
      //
      // `enumerate` calls `suix_queryEvents`, a DESCENDING page over every event of this type on the whole
      // network which the node then dereferences to each transaction's stored events. If ANY entry in the
      // page is one the answering node has no events for, the WHOLE page fails with a JSON-RPC error and
      // no partial result. That is a node-storage property, and none of the ways it could be our problem
      // survive measurement (2026-09-09, testnet):
      //
      //   • It is NOT indexing latency. The digest this errored on in CI is eight days old and still
      //     unreadable through the scan; a second endpoint errored on one from 2026-05-12. Waiting cannot
      //     clear either, and both read back SUCCESS with their `PaymentSettled` event intact over the
      //     testnet GraphQL endpoint — so nothing is wrong with the chain, the settlement, or this binding.
      //   • It is NOT one provider's index. Two unrelated endpoints fail the same way and name DIFFERENT
      //     blocking digests, so it is a property of whichever node answers rather than of one vendor.
      //   • It is NOT a retry away in general, though it can be behind a pool: against a multi-node
      //     endpoint the identical request succeeded 3 times in 8; against a single-backend one it failed
      //     ~30 times in 60s with an unchanging message. Hence a small budget below rather than a loop —
      //     a loop against a single backend is only a slower failure.
      //
      // ⚠️ So this leg is MARKED rather than pretended: the manifest already declares
      // `recovery.forwardIndexable: false` and calls the scan "best-effort … O(history) … NOT an O(1)
      // forward index", and a live proof cannot owe more than the manifest claims. What it must not do is
      // go quiet, so an unproven scan prints a greppable line naming the blocking digest. `enumerate`'s own
      // filtering, type discipline, digest stamping and fail-fast are proven exhaustively against ports in
      // `adapter.test.ts`; what is not proven live is the network's ability to serve the scan at all.
      //
      // ⛔ The tolerance is ONE error class, matched on the node's own words. Every other failure — a
      // wrong event type, a hit that never surfaces, a transport error — still fails this test, because a
      // catch wide enough to swallow those would turn this leg into a green over nothing.
      const UNSERVABLE = "Could not find the referenced transaction events";
      let scanned: { digest: string }[] | null = null;
      let blocked = "";
      for (let attempt = 0; attempt < 3 && scanned === null; attempt += 1) {
        try {
          scanned = await adapter.enumerate(
            atrHash,
            eventType,
            makeSuiReader(client),
            50,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes(UNSERVABLE)) throw err;
          blocked = message;
        }
      }
      if (scanned === null)
        console.warn(
          `binding-sui — the forward event-type scan was NOT proven live: the node cannot serve a page of ${eventType} (${blocked}). recover, the settled event type and this settlement's weld were all proven; SUI_MANIFEST declares recovery.forwardIndexable false, so the scan is best-effort by this rail's own claim.`,
        );
      else expect(scanned.some((h) => h.digest === result.digest)).toBe(true);
    }, 120_000);
  },
);
