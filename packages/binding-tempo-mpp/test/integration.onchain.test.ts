/**
 * Live Tempo mainnet integration for the TIP-20 memo binding. OPT-IN — it runs ONLY when an RPC endpoint
 * is supplied via `TEMPO_MAINNET_RPC_URL`; otherwise it is skipped LOUD (never faked):
 *
 *   TEMPO_MAINNET_RPC_URL=https://rpc.tempo.xyz pnpm --filter @integraledger/lcp-binding-tempo-mpp test
 *
 * It needs no funds and no credentials, and that is the point. Unlike every other rail binding here, the
 * proof of `recover` and `enumerate` does not require originating a settlement: zero-party recovery means a
 * stranger's already-settled transaction is enough. So this suite reads a REAL production settlement
 * (`0x45dfbd26…`, block 32395772, chainId 4217) and proves three things against it:
 *
 *   1. the pinned fixture still matches what the chain returns (fixture-drift guard);
 *   2. `recover` reads the 32-byte memo out of that settlement from its tx hash ALONE — and REFUSES it,
 *      because the memo is MPP's own attribution memo rather than an LCP reference;
 *   3. `enumerate` finds that settlement by a memo topic filter — the `forwardIndexable: true` leg of the
 *      manifest's recovery triple, exercised rather than asserted.
 *
 * The JSON-RPC transport lives HERE, not in `src`: Tempo is EVM, but `viem` is fenced to the
 * `binding-evm-*` packages by dependency-cruiser, and the memo needs no ABI decoding (it IS topic 3), so
 * the shipped package stays a pure port. Same posture as binding-xrpl.
 */
import { describe, expect, it } from "vitest";
import { createTempoMppAdapter, type TempoReader } from "../src/adapter.js";
import { getTempoConfig } from "../src/constants.js";
import {
  type TempoLogRange,
  type TempoLogView,
  tempoMemoLogFilter,
} from "../src/log.js";
import { TEMPO_MPP_MANIFEST } from "../src/manifest.js";
import {
  MAINNET_AMOUNT,
  MAINNET_BLOCK_NUMBER,
  MAINNET_MEMO,
  MAINNET_MEMO_LOG,
  MAINNET_PAYER,
  MAINNET_RECIPIENT,
  MAINNET_TOKEN,
  MAINNET_TX_HASH,
} from "./fixtures/mainnet-transfer-with-memo.js";

const RPC_URL = process.env["TEMPO_MAINNET_RPC_URL"];
const suite = RPC_URL ? describe : describe.skip;

/** The two JSON-RPC calls this binding needs, over `fetch`. No SDK, no ABI decoding. */
function makeLiveReader(rpcUrl: string): TempoReader {
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`Tempo RPC ${method} HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: T;
      error?: { message: string };
    };
    if (body.error !== undefined)
      throw new Error(`Tempo RPC ${method}: ${body.error.message}`);
    if (body.result === undefined)
      throw new Error(`Tempo RPC ${method}: empty result`);
    return body.result;
  }
  return {
    async settlementLogs(txHash: string): Promise<TempoLogView[]> {
      const receipt = await rpc<{ logs: TempoLogView[] } | null>(
        "eth_getTransactionReceipt",
        [txHash],
      );
      return receipt === null ? [] : receipt.logs;
    },
    async logsByMemo(
      memo: string,
      range: TempoLogRange,
    ): Promise<TempoLogView[]> {
      return rpc<TempoLogView[]>("eth_getLogs", [
        tempoMemoLogFilter(memo, range),
      ]);
    },
  };
}

suite(
  "binding-tempo-mpp — live Tempo mainnet (TEMPO_MAINNET_RPC_URL set)",
  () => {
    it("the chain still returns the pinned settlement's TransferWithMemo log byte for byte", async () => {
      if (RPC_URL === undefined) throw new Error("unreachable: RPC_URL gate");
      const logs =
        await makeLiveReader(RPC_URL).settlementLogs(MAINNET_TX_HASH);
      const memoLog = logs.find(
        (l) => l.topics[0] === MAINNET_MEMO_LOG.topics[0],
      );
      expect(memoLog?.topics).toEqual([...MAINNET_MEMO_LOG.topics]);
      expect(memoLog?.data).toBe(MAINNET_MEMO_LOG.data);
      expect(memoLog?.address.toLowerCase()).toBe(MAINNET_TOKEN);
      // TIP-20 emits the plain Transfer alongside it — the fixture's three-log shape, from the chain.
      expect(logs.length).toBeGreaterThanOrEqual(2);
    }, 60_000);

    it("recovers the 32-byte memo from the tx hash alone, then REFUSES it as MPP attribution", async () => {
      if (RPC_URL === undefined) throw new Error("unreachable: RPC_URL gate");
      const out = await createTempoMppAdapter(TEMPO_MPP_MANIFEST, {
        token: MAINNET_TOKEN,
      }).recover({ txHash: MAINNET_TX_HASH }, makeLiveReader(RPC_URL));
      expect(out).toEqual({
        refused: true,
        haltClass: "verification-failure",
        code: "tempo-mpp/memo-is-mpp-attribution",
        detail: expect.stringContaining(MAINNET_MEMO),
      });
    }, 60_000);

    it("finds that settlement by the memo topic filter — forwardIndexable, proven", async () => {
      if (RPC_URL === undefined) throw new Error("unreachable: RPC_URL gate");
      // The value queried is the settlement's real memo. It is an MPP attribution memo rather than an
      // atrHash, because that is what live mainnet contains — what is being proven is the INDEX, and a
      // 32-byte topic indexes identically whatever the 32 bytes mean.
      const refs = await createTempoMppAdapter(TEMPO_MPP_MANIFEST, {
        token: MAINNET_TOKEN,
      }).enumerate(
        MAINNET_MEMO,
        { fromBlock: MAINNET_BLOCK_NUMBER, toBlock: MAINNET_BLOCK_NUMBER },
        makeLiveReader(RPC_URL),
      );
      expect(refs).toContainEqual({ txHash: MAINNET_TX_HASH, logIndex: 3 });
    }, 60_000);

    it("decodes the live log's parties and amount as the fixture records them", async () => {
      if (RPC_URL === undefined) throw new Error("unreachable: RPC_URL gate");
      const logs = await makeLiveReader(RPC_URL).logsByMemo(MAINNET_MEMO, {
        fromBlock: MAINNET_BLOCK_NUMBER,
        toBlock: MAINNET_BLOCK_NUMBER,
        address: MAINNET_TOKEN,
      });
      expect(logs).toHaveLength(1);
      const { parseTransferWithMemoLog } = await import("../src/log.js");
      const first = logs[0];
      if (first === undefined) throw new Error("unreachable: length asserted");
      expect(parseTransferWithMemoLog(first)).toEqual({
        address: MAINNET_TOKEN,
        from: MAINNET_PAYER,
        to: MAINNET_RECIPIENT,
        amount: MAINNET_AMOUNT,
        memo: MAINNET_MEMO,
        movement: "transfer",
      });
    }, 60_000);

    it("reports the live chain id the manifest's rail claims", async () => {
      if (RPC_URL === undefined) throw new Error("unreachable: RPC_URL gate");
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      const body = (await res.json()) as { result: string };
      expect(Number.parseInt(body.result, 16)).toBe(
        getTempoConfig("mainnet").chainId,
      );
    }, 60_000);
  },
);
