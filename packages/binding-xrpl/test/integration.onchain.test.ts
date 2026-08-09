/**
 * Live XRPL testnet integration for the tx-memo binding. OPT-IN — it runs ONLY when a funded testnet
 * family seed is supplied via `XRPL_TESTNET_SEED` (an `s...` seed for an account already funded by the
 * XRPL testnet faucet — https://faucet.altnet.rippletest.net/accounts); otherwise it is skipped LOUD
 * (never faked). It signs a real native XRP `Payment` carrying the LCP atrHash memo, submits it via
 * rippled JSON-RPC, waits for validation, then recovers the atrHash through the live `tx` RPC — proving
 * buildLcpMemo → real Payment → recover end-to-end.
 *
 * The XRPL signing SDK (ripple-keypairs / ripple-binary-codec) is a DEV dependency. The package's
 * PUBLISHED dependency surface stays pure-TS with no chain SDK — the runtime adapter reads through an
 * injected `XrplReader` — and a devDependency never reaches a consumer, so the discipline holds while the
 * proof stays runnable. The dynamic import and its loud skip remain the honest report for an incomplete
 * install.
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
import { buildLcpMemo, type XrplMemo } from "../src/memo.js";

const SEED = process.env.XRPL_TESTNET_SEED;

// Probe for the optional signing SDK so a run with a seed but no SDK skips LOUD rather than throwing.
async function loadXrplSdk(): Promise<{
  deriveKeypair: (seed: string) => { publicKey: string; privateKey: string };
  deriveAddress: (pub: string) => string;
  sign: (blob: string, priv: string) => string;
  encode: (tx: unknown) => string;
  encodeForSigning: (tx: unknown) => string;
} | null> {
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
  } catch {
    return null;
  }
}

const suite = SEED ? describe : describe.skip;

suite("binding-xrpl — live testnet (XRPL_TESTNET_SEED set)", () => {
  it("welds an atrHash into a testnet Payment memo and recovers it", async () => {
    const sdk = await loadXrplSdk();
    if (sdk === null) {
      // Skip LOUD: the cred is present but the optional signing SDK is not installed. Never fake it.
      console.warn(
        "binding-xrpl integration: XRPL_TESTNET_SEED is set but ripple-keypairs / ripple-binary-codec " +
          "are not installed — skipping the live weld (install them to run this test).",
      );
      return;
    }
    if (SEED === undefined) throw new Error("unreachable: SEED gate");
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
        result: T & { status?: string; error_message?: string; error?: string };
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

    // Self-payment of 1 drop carrying the LCP memo — the memo IS the weld; the payment leg is incidental.
    const memo: XrplMemo = buildLcpMemo(atrHash);
    const tx = {
      TransactionType: "Payment",
      Account: account,
      Destination: account,
      Amount: "1",
      Fee: "12",
      Sequence: acct.account_data.Sequence,
      LastLedgerSequence: acct.ledger_current_index + 75,
      SigningPubKey: keypair.publicKey,
      Memos: [memo],
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
          Memos?: ReadonlyArray<XrplMemo>;
          validated: boolean;
          meta?: { TransactionResult?: string } | string;
        }>("tx", { transaction: hash, binary: false });
        const engineResult =
          typeof r.meta === "object" && r.meta !== null
            ? r.meta.TransactionResult
            : undefined;
        return { memos: r.Memos, validated: r.validated, engineResult };
      },
      async paymentHashesFor(): Promise<string[]> {
        return [];
      },
    };

    let recovered: Awaited<
      ReturnType<ReturnType<typeof createXrplAdapter>["recover"]>
    > | null = null;
    const adapter = createXrplAdapter(XRPL_MANIFEST);
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
});
