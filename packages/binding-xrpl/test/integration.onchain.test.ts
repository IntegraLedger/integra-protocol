/**
 * Live XRPL testnet integration for the `Payment.InvoiceID` binding. OPT-IN — it runs ONLY when a funded
 * testnet family seed is supplied via `XRPL_TESTNET_SEED` (an `s...` seed for an account already funded by
 * the XRPL testnet faucet — https://faucet.altnet.rippletest.net/accounts) AND a funded counterparty via
 * `XRPL_TESTNET_DESTINATION`; otherwise it is skipped LOUD (never faked). It signs a real native XRP
 * `Payment` carrying the atrHash in `InvoiceID`, submits it via rippled JSON-RPC, waits for validation,
 * then recovers the atrHash through the live `tx` RPC — proving propose → real Payment → recover
 * end-to-end.
 *
 * **Two things this suite got wrong for as long as it had never been run**, both fixed on 2026-08-14 when
 * the standing live-proofs gate executed it for the first time:
 *
 *   1. It welded into `Memos`, the LEGACY carrier. The weld moved to `InvoiceID` on 2026-08-08 because
 *      x402's exact-XRPL scheme requires a facilitator to REJECT any memo-bearing transaction, so the
 *      suite was proving a carrier the binding declares "read and never written" while leaving the one it
 *      actually writes unexercised.
 *   2. It paid ITSELF (`Destination` == `Account`). XRPL rejects an XRP-to-XRP self-payment outright with
 *      `temREDUNDANT`, so the transaction could never have been submitted at all. A distinct funded
 *      counterparty is required, and it is a declared credential rather than a default: an address nobody
 *      chose is not a counterparty.
 *
 * The payment leg stays incidental — 1 drop — because the weld is the `InvoiceID`, not the value moved.
 *
 * The XRPL signing SDK (ripple-keypairs / ripple-binary-codec) is a DEV dependency. The package's
 * PUBLISHED dependency surface stays pure-TS with no chain SDK — the runtime adapter reads through an
 * injected `XrplReader` — and a devDependency never reaches a consumer, so the discipline holds while the
 * proof stays runnable.
 *
 * ⛔ **An incomplete install REFUSES.** Until 2026-09-03 the dynamic import returned `null` on failure and
 * this test `console.warn`ed and RETURNED, under a comment calling that a "skip LOUD". Vitest has no such
 * outcome: a returning body is recorded as PASSED, so `scripts/live-proof-gate.mjs` — which adjudicates on
 * `failed === 0 && pending === 0 && passed > 0` precisely because an exit code certifies nothing — would
 * have printed "Rail proven live" over a run that signed, submitted and read nothing. This was the only
 * one of the eleven harnesses with a path to a credentialed pass that touches no chain. A missing
 * dependency is a refusal, not a skip and not a pass, so the loader throws and `check:harness-proof` now
 * refuses the shape in any harness.
 */
import { hashAtr, isAtrHash } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import {
  createXrplAdapter,
  type XrplPaymentView,
  type XrplReader,
} from "../src/adapter.js";
import { getXrplConfig } from "../src/constants.js";
import { XRPL_MANIFEST } from "../src/manifest.js";
import type { XrplMemo } from "../src/memo.js";

const SEED = process.env.XRPL_TESTNET_SEED;
const DESTINATION = process.env.XRPL_TESTNET_DESTINATION;

// Load the signing SDK, REFUSING an incomplete install. The import is dynamic because the dependency is
// dev-only, not because its absence is tolerable: this suite exists to sign and submit, and it cannot do
// either without these two.
async function loadXrplSdk(): Promise<{
  deriveKeypair: (seed: string) => { publicKey: string; privateKey: string };
  deriveAddress: (pub: string) => string;
  sign: (blob: string, priv: string) => string;
  encode: (tx: unknown) => string;
  encodeForSigning: (tx: unknown) => string;
}> {
  try {
    const kp = (await import("ripple-keypairs")) as unknown as {
      deriveKeypair: (seed: string) => {
        publicKey: string;
        privateKey: string;
      };
      deriveAddress: (pub: string) => string;
      sign: (blob: string, priv: string) => string;
    };
    const codec = (await import("ripple-binary-codec")) as unknown as {
      encode: (tx: unknown) => string;
      encodeForSigning: (tx: unknown) => string;
    };
    return { ...kp, ...codec };
  } catch (cause) {
    throw new Error(
      "binding-xrpl live proof: XRPL_TESTNET_SEED and XRPL_TESTNET_DESTINATION are set, but the signing " +
        "SDK (ripple-keypairs / ripple-binary-codec) could not be imported. The rail is NOT proven — " +
        "install the dev dependencies and run again. This is a refusal rather than a skip: a returning " +
        "test body is recorded as a PASS, and a pass here would certify a weld that never happened.",
      { cause },
    );
  }
}

const suite = SEED && DESTINATION ? describe : describe.skip;

suite(
  "binding-xrpl — live testnet (XRPL_TESTNET_SEED + DESTINATION set)",
  () => {
    it("welds an atrHash into a testnet Payment InvoiceID and recovers it", async () => {
      const sdk = await loadXrplSdk(); // throws, loudly, on an incomplete install
      if (SEED === undefined || DESTINATION === undefined)
        throw new Error("unreachable: SEED/DESTINATION gate");
      const cfg = getXrplConfig("testnet");
      const rpcUrl = process.env.XRPL_TESTNET_RPC_URL ?? cfg.rpcUrl;

      const keypair = sdk.deriveKeypair(SEED);
      const account = sdk.deriveAddress(keypair.publicKey);

      const atrHash = await hashAtr(
        new TextEncoder().encode("# Terms\nid: 0xxrpl-testnet\n"),
      );
      expect(isAtrHash(atrHash)).toBe(true);

      // Minimal rippled JSON-RPC client.
      async function rpc<T>(
        method: string,
        params: Record<string, unknown>,
      ): Promise<T> {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ method, params: [params] }),
        });
        if (!res.ok) throw new Error(`XRPL RPC ${method} HTTP ${res.status}`);
        const body = (await res.json()) as {
          result: T & {
            status?: string;
            error_message?: string;
            error?: string;
          };
        };
        if (body.result.status === "error")
          throw new Error(
            `XRPL RPC ${method}: ${body.result.error_message ?? body.result.error}`,
          );
        return body.result;
      }

      const acct = await rpc<{
        account_data: { Sequence: number };
        ledger_current_index: number;
      }>("account_info", { account, ledger_index: "current" });

      // 1 drop to a real counterparty carrying the atrHash in `InvoiceID` — the InvoiceID IS the weld; the
      // payment leg is incidental, but it must be a payment XRPL will actually accept.
      const adapter = createXrplAdapter(XRPL_MANIFEST);
      const invoiceId = adapter.propose({ atrHash });
      const tx = {
        TransactionType: "Payment",
        Account: account,
        Destination: DESTINATION,
        Amount: "1",
        Fee: "12",
        Sequence: acct.account_data.Sequence,
        LastLedgerSequence: acct.ledger_current_index + 75,
        SigningPubKey: keypair.publicKey,
        InvoiceID: invoiceId,
      };
      const signingBlob = sdk.encodeForSigning(tx);
      const signature = sdk.sign(signingBlob, keypair.privateKey);
      const txBlob = sdk.encode({ ...tx, TxnSignature: signature });

      const submit = await rpc<{
        engine_result: string;
        tx_json: { hash: string };
      }>("submit", { tx_blob: txBlob });
      expect(["tesSUCCESS", "terQUEUED"]).toContain(submit.engine_result);
      const txHash = submit.tx_json.hash;

      // Poll `tx` until validated, then recover through the adapter's reader port.
      const reader: XrplReader = {
        async paymentView(hash: string): Promise<XrplPaymentView | null> {
          const r = await rpc<{
            InvoiceID?: string;
            Memos?: ReadonlyArray<XrplMemo>;
            validated: boolean;
            meta?: { TransactionResult?: string } | string;
          }>("tx", { transaction: hash, binary: false });
          const engineResult =
            typeof r.meta === "object" && r.meta !== null
              ? r.meta.TransactionResult
              : undefined;
          return {
            invoiceId: r.InvoiceID,
            memos: r.Memos,
            validated: r.validated,
            engineResult,
          };
        },
        async paymentHashesFor(): Promise<string[]> {
          return [];
        },
      };

      let recovered: Awaited<
        ReturnType<ReturnType<typeof createXrplAdapter>["recover"]>
      > | null = null;
      for (let i = 0; i < 20; i++) {
        const view = await reader.paymentView(txHash);
        if (view?.validated) {
          recovered = await adapter.recover({ txHash }, reader);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }

      expect(recovered).not.toBeNull();
      if (recovered !== null) {
        expect("refused" in recovered).toBe(false);
        if (!("refused" in recovered)) expect(recovered.value).toBe(atrHash);
      }
    }, 60_000);
  },
);
