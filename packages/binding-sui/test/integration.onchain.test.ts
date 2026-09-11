/**
 * Live Sui testnet integration for the Pay402 `payment_id` binding. OPT-IN — it runs ONLY when a funded
 * testnet Ed25519 secret key is supplied via `SUI_TESTNET_SECRET_KEY` (a Bech32 `suiprivkey1…` string or
 * a 0x/base64 32-byte secret) AND the deployed Pay402 fork package id via `SUI_PAY402_PACKAGE_ID` and the
 * buyer's USDC `Coin<T>` object id via `SUI_USDC_COIN_ID` (+ its type via `SUI_USDC_COIN_TYPE`); otherwise
 * it is skipped LOUD (never faked). It requests faucet gas, welds a real atrHash into a Pay402
 * `settle_payment` transaction on testnet, and reads it back — proving
 * appendSettlePaymentCall → real tx → makeSuiReader → recover end-to-end. The atrHash IS the LCP weld; the
 * USDC coin plumbing is operational setup, off the binding's critical path.
 *
 * ⛔ TWO ENDPOINTS ARE REQUIRED ONCE THE OTHER FOUR ARE SET, AND NEITHER HAS A DEFAULT — see the refusals
 * at the top of the body. `SUI_TESTNET_RPC_URL` is the WRITE transport (a settlement is signed and
 * submitted over JSON-RPC or gRPC, and the public fullnode's JSON-RPC is gone). `SUI_TESTNET_GRAPHQL_URL`
 * is the READ transport, and it is what makes this a proof of `makeSuiGraphqlRpc` rather than of the
 * deprecated path it replaces.
 *
 * ⭐⭐ THE READ-BACK IS PERFORMED TWICE, OVER BOTH TRANSPORTS, AND THAT IS THE POINT OF THIS FILE.
 * `SuiRpcLike` is a structural port with two implementations — `@mysten/sui`'s `SuiJsonRpcClient` and this
 * package's `makeSuiGraphqlRpc` — and until now only the first was ever driven by a scheduled run, while
 * the second was proven exclusively against a stubbed `fetch`. A port whose implementations are never
 * compared against the same chain state is two readers wearing one type: the transports disagree about
 * byte encoding (a Move `vector<u8>` arrives `number[]` over JSON-RPC and BASE64 over GraphQL), and that
 * disagreement is SILENT — an undecoded `payment_id` makes `recover` answer `sui/no-payment-id`, which is
 * a refusal, not an error. So both readers resolve the SAME digest and their answers are asserted equal to
 * each other AND to the atrHash this test welded. A transport that starts lying goes red here.
 *
 * ⭐ THE FORWARD EVENT-TYPE SCAN IS REQUIRED AGAIN, over GraphQL. It was downgraded to attempted-only
 * because `suix_queryEvents` fails a page ATOMICALLY when the answering node holds no events for any entry
 * in it — measured, durable, and a property of the JSON-RPC transport rather than of the chain, the
 * settlement or this binding. GraphQL serves the same scan, so the leg is proven rather than tolerated and
 * this harness carries no error-class exemption at all.
 */

import { hashAtr } from "@integraledger/lcp-kernel";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it } from "vitest";
import { appendSettlePaymentCall, createSuiAdapter } from "../src/adapter.js";
import { pay402SettledEventType } from "../src/constants.js";
import { makeSuiGraphqlRpc } from "../src/graphql.js";
import { SUI_MANIFEST } from "../src/manifest.js";
import { makeSuiReader, type SuiRpcLike } from "../src/reader.js";

const SECRET = process.env["SUI_TESTNET_SECRET_KEY"];
const PKG = process.env["SUI_PAY402_PACKAGE_ID"];
const COIN_ID = process.env["SUI_USDC_COIN_ID"];
const COIN_TYPE = process.env["SUI_USDC_COIN_TYPE"];
const RPC_URL = process.env["SUI_TESTNET_RPC_URL"];
const GRAPHQL_URL = process.env["SUI_TESTNET_GRAPHQL_URL"];
const ready =
  SECRET !== undefined &&
  PKG !== undefined &&
  COIN_ID !== undefined &&
  COIN_TYPE !== undefined;
const suite = ready ? describe : describe.skip;

/**
 * How long the GraphQL endpoint is given to index a settlement the WRITE endpoint has already confirmed.
 *
 * ⚠️ This is a real race and not a tolerance. `waitForTransaction` makes the read deterministic on the
 * endpoint that took the write; the GraphQL endpoint is a DIFFERENT service and has its own indexing lag,
 * so a read issued the instant the write confirms can legitimately answer "no transaction" for a digest
 * that exists. Waiting it out is correct. What is NOT correct is letting the wait end in anything other
 * than a proof: if the settlement is still unreadable when this expires, the harness THROWS, because a
 * read transport that cannot see a confirmed settlement inside a minute and a half is the failure this
 * rail exists to report — not a reason to skip the leg.
 */
const GRAPHQL_INDEX_DEADLINE_MS = 90_000;

/** The one error class worth waiting out — `makeSuiGraphqlRpc`'s own words for a digest it cannot find. */
const NOT_YET_INDEXED = "Sui GraphQL: no transaction";

suite(
  "binding-sui — live testnet (SUI_TESTNET_SECRET_KEY + SUI_PAY402_PACKAGE_ID set)",
  () => {
    it("welds an atrHash into a Pay402 settle tx and reads it back over BOTH transports", async () => {
      // ⛔⛔ NO FALLBACK ON EITHER ENDPOINT, AND THAT IS THE FIX THIS RAIL CARRIES. The write URL was read
      // as `SUI_TESTNET_RPC_URL ?? getSuiConfig("testnet").rpcUrl`, and the default it reached for is dead:
      // measured again 2026-09-11, `https://fullnode.testnet.sui.io` answers EVERY method with
      // `-32601 "JSON-RPC on public fullnodes has been deprecated"` — at HTTP 200, so a status-code health
      // check reads that endpoint as UP. A fallback to a public default is a degraded path only while the
      // default works; once it is gone the `??` is not a convenience, it is the missing refusal — and it
      // fails as a method-not-found deep inside the SDK, which reads as a code fault rather than as the
      // missing credential it is.
      //
      // ⭐ The read URL gets the SAME treatment even though the public GraphQL endpoint is currently
      // served, and deliberately so: the reason the JSON-RPC fallback became a trap is not that the URL
      // was public, it is that a standing gate was allowed to choose its own endpoint. A rail that names
      // its endpoints proves the endpoints it was pointed at.
      //
      // ⭐ Neither is part of `ready`. `ready` answers "is this machine meant to run the live rail at
      // all", and a machine carrying the other four credentials has already answered yes; skipping there
      // would report the rail unrun for a reason nobody would go looking for. A misconfiguration is a
      // refusal, thrown before a key is loaded or a faucet is called.
      if (RPC_URL === undefined)
        throw new Error(
          "binding-sui live rail: REFUSING to run. SUI_TESTNET_RPC_URL is unset and there is no default " +
            "to fall back to — Sui's public fullnode JSON-RPC is deprecated and answers -32601 to every " +
            "method. Supply a provider JSON-RPC endpoint for this rail.",
        );
      if (GRAPHQL_URL === undefined)
        throw new Error(
          "binding-sui live rail: REFUSING to run. SUI_TESTNET_GRAPHQL_URL is unset and there is no " +
            "default to fall back to. This is the READ transport the rail proves — reading back over the " +
            "deprecated JSON-RPC path instead would leave makeSuiGraphqlRpc driven by nothing on a " +
            "schedule, which is the defect this rail was wired to close.",
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
      // deterministic ON THIS ENDPOINT — the GraphQL one is a separate service and is waited for below.
      await client.waitForTransaction({ digest: result.digest });

      const adapter = createSuiAdapter(SUI_MANIFEST);
      const eventType = pay402SettledEventType(PKG as string);

      // ⭐⭐ THE TRANSPORT THIS RAIL EXISTS TO DRIVE. `makeSuiReader(makeSuiGraphqlRpc(url))` is the whole
      // migration off the deprecated JSON-RPC reads — `recover`, `observe` and `enumerate` are untouched
      // by it — and before this rail was wired, `makeSuiGraphqlRpc` was reached by no scheduled run at
      // all: exhaustively unit-proven against a stubbed `fetch`, and driven against a real chain only by
      // hand, once, in the session that wrote it. Stubs cannot tell you the endpoint's shape moved.
      const graphqlRpc = makeSuiGraphqlRpc(GRAPHQL_URL);
      const graphqlReader = makeSuiReader(graphqlRpc);
      const jsonRpcReader = makeSuiReader(client);

      // The GraphQL endpoint indexes independently of the endpoint that took the write — see the deadline
      // constant. A local helper, so its `return` is ordinary control flow rather than a test that ends
      // without asserting (`check:harness-proof` counts only returns at test-body depth, and is right to).
      async function waitForGraphqlToIndex(rpc: SuiRpcLike): Promise<number> {
        const startedAt = Date.now();
        for (;;) {
          try {
            await rpc.getTransactionBlock({
              digest: result.digest,
              options: { showEvents: true },
            });
            return Date.now() - startedAt;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // ⛔ EXACTLY ONE ERROR CLASS IS WAITED OUT, matched on this transport's own words for it.
            // Every other failure — a non-2xx, a GraphQL `errors[]`, an event node missing a field the
            // query selected, a shape that moved — is the finding this rail is for and is rethrown
            // immediately. A catch wide enough to swallow those would turn the wait into a green over
            // nothing, which is the same defect as the fallback this file's refusals close.
            if (!message.includes(NOT_YET_INDEXED)) throw err;
            const waited = Date.now() - startedAt;
            if (waited > GRAPHQL_INDEX_DEADLINE_MS)
              throw new Error(
                `binding-sui live rail: the settlement ${result.digest} was confirmed on the write ` +
                  `endpoint but is STILL unreadable over ${GRAPHQL_URL} after ${waited}ms. The read ` +
                  `transport cannot see a settlement that exists, which is a failure of the rail and ` +
                  `not a reason to pass without proving the read-back.`,
                { cause: err },
              );
            await new Promise((resolve) => setTimeout(resolve, 2_000));
          }
        }
      }
      const indexedAfterMs = await waitForGraphqlToIndex(graphqlRpc);
      console.log(
        `binding-sui — ${result.digest} became readable over GraphQL after ${indexedAfterMs}ms.`,
      );

      // ⭐ THE READ-BACK, OVER THE GRAPHQL TRANSPORT. This is the assertion the row is about: the bytes
      // this test welded, recovered from the chain through the port implementation that had no scheduled
      // driver. It is asserted against `atrHash` — the value computed above and welded into the
      // transaction — rather than against whatever the other transport happens to answer, so a run in
      // which BOTH transports broke identically still fails.
      const overGraphql = await adapter.recover(
        { digest: result.digest, packageId: PKG as string },
        graphqlReader,
      );
      expect("refused" in overGraphql).toBe(false);
      if (!("refused" in overGraphql)) expect(overGraphql.value).toBe(atrHash);

      // ⭐ AND OVER JSON-RPC, SO THE TWO IMPLEMENTATIONS OF ONE PORT ARE COMPARED ON ONE SETTLEMENT. The
      // way this port fails is not a crash, it is a disagreement: `payment_id` is a Move `vector<u8>`,
      // which GraphQL renders base64 and JSON-RPC renders as a byte array, and `parseSuiEvents` answers
      // `undefined` for anything that is not an array. An undecoded value therefore surfaces as
      // `sui/no-payment-id` — a REFUSAL, indistinguishable from a settlement that never carried a weld.
      // Comparing the transports on the same digest is what turns that silence into a red run.
      const overJsonRpc = await adapter.recover(
        { digest: result.digest, packageId: PKG as string },
        jsonRpcReader,
      );
      expect("refused" in overJsonRpc).toBe(false);
      if (!("refused" in overJsonRpc) && !("refused" in overGraphql))
        expect(overGraphql.value).toBe(overJsonRpc.value);

      // ⭐ THE EVENT TYPE, ASSERTED AGAINST THE CHAIN OVER GRAPHQL — and by a TARGETED read rather than a
      // scan. This is the half of the old `enumerate` assertion that was ever about this package: that the
      // settlement really emitted `<packageId>::payment::PaymentSettled`, so `recover`'s exact-type match
      // is a name the chain answers to rather than one this repo believes in. `settledEvents` resolves one
      // digest — no index, no history window — so it is the leg a live run can always owe.
      const emitted = await graphqlReader.settledEvents(result.digest);
      expect(emitted.map((e) => e.type)).toContain(eventType);

      // ⭐⭐ THE FORWARD SCAN IS REQUIRED AGAIN — the loosening this rail reverses, and the reason is
      // MEASURED rather than assumed.
      //
      // `enumerate` pages a DESCENDING scan over every event of this type on the network. Over JSON-RPC
      // that is `suix_queryEvents`, which dereferences each entry in a page to the transaction's stored
      // events and fails the WHOLE page — no partial result — when the answering node holds none for any
      // one of them. None of the ways that could be this repository's problem survived measurement: it is
      // not indexing latency (a digest it blocked on is months old and still blocked, and reads back
      // SUCCESS with its event intact over GraphQL), it is not one provider's index (two unrelated
      // endpoints fail naming DIFFERENT blocking digests), and it is not a retry away against a single
      // backend. So the leg was downgraded to attempted-with-a-tolerated-error-class, and a tolerated
      // error class is a hole the size of whatever else produces that message.
      //
      // ⇒ It is a property of the TRANSPORT, and this rail no longer reads over that transport. GraphQL
      // serves the scan — measured returning 50/50 events across 50 distinct digests where JSON-RPC could
      // not serve one page — so the leg is proven, unconditionally, with NO tolerated error class in this
      // file. The settlement asserted for is the one this test just made, and a descending scan finds the
      // newest settlements first, so the depth below is slack rather than a bet.
      //
      // ⚠️ `SUI_MANIFEST` still declares `recovery.forwardIndexable: false` and that stays correct: this
      // is an O(history) scan and not an O(1) forward index. What the manifest never claimed is that the
      // scan cannot be SERVED, and a live proof may owe exactly as much as the transport can answer.
      const scanned = await adapter.enumerate(
        atrHash,
        eventType,
        graphqlReader,
        50,
      );
      expect(scanned.some((h) => h.digest === result.digest)).toBe(true);
    }, 300_000);
  },
);
