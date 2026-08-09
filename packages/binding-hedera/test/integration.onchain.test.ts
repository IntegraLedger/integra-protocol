/**
 * Live Hedera testnet integration for the transaction-memo binding — the RECOVERY half, end-to-end against
 * the real Mirror Node REST surface. OPT-IN: it runs ONLY when `HEDERA_TESTNET_TX_ID` is set to the id of a
 * settled testnet transaction whose `transactionMemo` carries an LCP atrHash (canonical "0.0.NNN@sec.nanos"
 * form); otherwise it is skipped LOUD (never faked). Optionally set `HEDERA_TESTNET_ATR_HASH` to assert the
 * exact recovered value.
 *
 * Why recovery-only, and why NO @hashgraph/sdk: the binding's verification-time core is memo → atrHash,
 * which is a pure Mirror Node REST read (`fetch` only — workerd-safe, no gRPC). Submitting a *new* testnet
 * tx would require @hashgraph/sdk's gRPC client, whose published `.d.ts` is invalid under this workspace's
 * strict `nodenext` + `skipLibCheck:false` (bare `long` type refs + extensionless relative imports) — so
 * the SDK is deliberately NOT a dependency — the memo codec stays SDK-free.
 * The write path is a demo/facilitator concern outside this protocol package; the weld this binding OWNS —
 * atrHash in the memo, recovered zero-party from a settled tx — is what this test proves on live data.
 */
import { describe, expect, it } from "vitest";
import {
  createHederaAdapter,
  type HederaReader,
  type HederaTxView,
} from "../src/adapter.js";
import { getHederaConfig } from "../src/constants.js";
import { HEDERA_MANIFEST } from "../src/manifest.js";

const TX_ID = process.env["HEDERA_TESTNET_TX_ID"];
const EXPECTED = process.env["HEDERA_TESTNET_ATR_HASH"];
const suite = TX_ID ? describe : describe.skip;

/** Mirror Node REST reader — reads a settled transaction's memo (as the raw memo_base64 field). Pure fetch. */
function makeMirrorReader(mirrorBaseUrl: string): HederaReader {
  function mirrorTxIdForm(canonical: string): string {
    const m = canonical.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
    if (!m) throw new Error(`Bad transaction id: ${canonical}`);
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return {
    async txView(transactionId: string): Promise<HederaTxView | null> {
      const url = `${mirrorBaseUrl}/transactions/${mirrorTxIdForm(transactionId)}`;
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Mirror Node ${res.status}`);
      const body = (await res.json()) as {
        transactions?: Array<{ memo_base64?: string | null; result?: string }>;
      };
      const tx = body.transactions?.[0];
      if (tx === undefined) return null;
      return {
        ...(tx.memo_base64 != null ? { memoBase64: tx.memo_base64 } : {}),
        ...(tx.result !== undefined ? { result: tx.result } : {}),
      };
    },
    async transactionsFor(): Promise<string[]> {
      return [];
    },
  };
}

suite(
  "binding-hedera — live testnet recovery (HEDERA_TESTNET_TX_ID set)",
  () => {
    it("recovers the atrHash from a real testnet transactionMemo via Mirror Node REST", async () => {
      const cfg = getHederaConfig("testnet");
      const adapter = createHederaAdapter(HEDERA_MANIFEST);
      const reader = makeMirrorReader(cfg.mirrorBaseUrl);

      // Mirror Node lags consensus; poll briefly in case the tx was just submitted.
      let recovered: Awaited<ReturnType<typeof adapter.recover>> | undefined;
      for (let i = 0; i < 15; i++) {
        recovered = await adapter.recover(
          { transactionId: TX_ID ?? "" },
          reader,
        );
        if (!("refused" in recovered)) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      expect(recovered && "refused" in recovered).toBe(false);
      if (recovered && !("refused" in recovered) && EXPECTED)
        expect(recovered.value).toBe(EXPECTED.toLowerCase());
    }, 60_000);
  },
);
