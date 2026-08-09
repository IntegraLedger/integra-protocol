import { describe, expect, it } from "vitest";
import { createTempoMppAdapter, type TempoReader } from "../src/adapter.js";
import type { TempoLogView } from "../src/log.js";
import { TEMPO_MPP_MANIFEST } from "../src/manifest.js";
import {
  MAINNET_AMOUNT,
  MAINNET_CALLDATA,
  MAINNET_MEMO,
  MAINNET_PAYER,
  MAINNET_PLAIN_TRANSFER_LOG,
  MAINNET_RECEIPT_LOGS,
  MAINNET_RECIPIENT,
  MAINNET_TOKEN,
  MAINNET_TX_HASH,
} from "./fixtures/mainnet-transfer-with-memo.js";

const TOPIC0 =
  "0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0";
const ZERO_WORD = `0x${"00".repeat(32)}`;
const ATR = `0x${"ab".repeat(32)}`;
const OTHER_ATR = `0x${"cd".repeat(32)}`;
const RANGE = { fromBlock: "0x0", toBlock: "latest" } as const;

/**
 * An attacker's OWN TIP-20 token — inside the reserved `0x20c0…` range, because the range is exactly what
 * is permissionless: any address can create a token through the `TIP20Factory` precompile. So a prefix
 * check would pass this address, and only scoping to the token the seller advertised refuses it.
 */
const FORGED_TOKEN = "0x20c0000000000000000000000000000000000bad";

/** Anything outside the TIP-20 range cannot emit this event at all. */
const NOT_A_TIP20 = "0x1111111111111111111111111111111111111111";

/** The adapter under test, scoped to the token the pinned mainnet settlement actually used. */
function adapter() {
  return createTempoMppAdapter(TEMPO_MPP_MANIFEST, { token: MAINNET_TOKEN });
}

/** A `TransferWithMemo` log in `eth_getLogs` shape, for the cases mainnet has not produced. */
function memoLog(over: {
  from?: string;
  to?: string;
  memo?: string;
  logIndex?: string;
  txHash?: string;
}): TempoLogView {
  return {
    address: MAINNET_TOKEN,
    topics: [
      TOPIC0,
      over.from ?? `0x${"00".repeat(12)}${MAINNET_PAYER.slice(2)}`,
      over.to ?? `0x${"00".repeat(12)}${MAINNET_RECIPIENT.slice(2)}`,
      over.memo ?? ATR,
    ],
    data: `0x${"00".repeat(31)}01`,
    transactionHash: over.txHash ?? MAINNET_TX_HASH,
    logIndex: over.logIndex ?? "0x0",
  };
}

/**
 * A `TempoReader` serving fixed logs. This is a named port implementation, not a mock of chain behaviour:
 * the real transport is exercised against live Tempo mainnet in `integration.onchain.test.ts`, which
 * fetches these very logs over public JSON-RPC. Here the logs are the constant, so the adapter's rules
 * are what is under test.
 */
function reader(opts: {
  settlement?: TempoLogView[];
  byMemo?: TempoLogView[];
}): TempoReader {
  return {
    settlementLogs: async () => opts.settlement ?? [],
    logsByMemo: async () => opts.byMemo ?? [],
  };
}

describe("createTempoMppAdapter", () => {
  it("carries the Tempo MPP manifest it was constructed with", () => {
    expect(adapter().manifest).toBe(TEMPO_MPP_MANIFEST);
  });

  it("THROWS when the token is not a TIP-20 address — an unscoped verifier is worse than none", () => {
    expect(() =>
      createTempoMppAdapter(TEMPO_MPP_MANIFEST, { token: NOT_A_TIP20 }),
    ).toThrow(/TIP-20/);
  });

  it("THROWS when the token is not a 20-byte address, prefix alone is not enough", () => {
    expect(() =>
      createTempoMppAdapter(TEMPO_MPP_MANIFEST, {
        token: "0x20c000000000000000000000",
      }),
    ).toThrow(/TIP-20/);
  });

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() =>
      createTempoMppAdapter(
        { ...TEMPO_MPP_MANIFEST, rail: "solana" },
        { token: MAINNET_TOKEN },
      ),
    ).toThrow('manifest.rail "solana" is not "tempo:mpp"');
  });
});

describe("propose", () => {
  it("returns the methodDetails the seller advertises AND the call the buyer makes", () => {
    const proposal = adapter().propose(ATR, {
      to: MAINNET_RECIPIENT,
      amount: 1n,
    });
    expect(proposal.methodDetails).toEqual({ memo: ATR });
    expect(proposal.call.to).toBe(MAINNET_RECIPIENT);
    expect(proposal.call.amount).toBe(1n);
    expect(proposal.call.memo).toBe(ATR);
    expect(proposal.call.calldata.slice(0, 10)).toBe("0x95777d59");
  });

  it("names the TIP-20 token the calldata is sent TO — the same token the verifier scopes to", () => {
    // `call.to` is the RECIPIENT; the transaction's destination is the token contract, and without it the
    // buyer cannot make the call at all. It comes from the adapter's config, never from the context, so
    // the token the seller advertises and the token `recover` accepts are one value.
    expect(
      adapter().propose(ATR, { to: MAINNET_RECIPIENT, amount: 1n }).call.token,
    ).toBe(MAINNET_TOKEN);
  });

  it("advertises and encodes the SAME memo — a mismatch would fail MPP's own on-chain check", () => {
    // mpp-rs verifies TransferWithMemo logs instead of Transfer whenever methodDetails.memo is present,
    // so the advertised value and the calldata value must be one value, computed once.
    const proposal = adapter().propose(ATR, {
      to: MAINNET_RECIPIENT,
      amount: MAINNET_AMOUNT,
    });
    expect(
      proposal.call.calldata.endsWith(proposal.methodDetails.memo.slice(2)),
    ).toBe(true);
  });

  it("throws on a malformed atrHash — fail-fast, never a Refusal value", () => {
    expect(() =>
      adapter().propose("0x1234", {
        to: MAINNET_RECIPIENT,
        amount: 1n,
      }),
    ).toThrow(/32-byte/);
  });
});

describe("recover", () => {
  it("recovers the atrHash from a settlement carrying it, ignoring the plain Transfer logs", async () => {
    const logs = [MAINNET_PLAIN_TRANSFER_LOG, memoLog({ memo: ATR })];
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: logs }),
    );
    expect(out).toEqual({ ok: true, value: ATR });
  });

  it("REFUSES the real mainnet settlement: its memo is MPP attribution, not a reference", async () => {
    // The honest outcome for the settlement this package was proven against. Returning attribution bytes
    // as an atrHash would manufacture a weld that no seller ever advertised.
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: MAINNET_RECEIPT_LOGS }),
    );
    expect(out).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "tempo-mpp/memo-is-mpp-attribution",
      detail: expect.stringContaining(MAINNET_MEMO),
    });
  });

  it("REFUSES a TransferWithMemo emitted by a DIFFERENT TIP-20 token — the forgeable weld", async () => {
    // TIP-20 tokens are permissionlessly creatable through the `TIP20Factory` precompile, so anyone can
    // mint a worthless token and call `transferWithMemo(anyone, 1, atrHash)` on it. Such a log is a real
    // transfer, of a single memo, that is not MPP attribution — it passes every other refusal here. Only
    // the token scope catches it, and a `0x20c0…` prefix check would NOT: the forgery is in the range too.
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({
        settlement: [{ ...memoLog({ memo: ATR }), address: FORGED_TOKEN }],
      }),
    );
    expect(out).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "tempo-mpp/no-memo-event",
      detail: expect.stringContaining(MAINNET_TOKEN),
    });
  });

  it("reads only the expected token when one transaction moves two tokens", async () => {
    // Scoping happens BEFORE the ambiguity check, so a foreign token cannot grief a settlement into
    // `ambiguous-memos` either — it is simply not part of this rail's settlement.
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({
        settlement: [
          {
            ...memoLog({ memo: OTHER_ATR, logIndex: "0x1" }),
            address: FORGED_TOKEN,
          },
          memoLog({ memo: ATR, logIndex: "0x2" }),
        ],
      }),
    );
    expect(out).toEqual({ ok: true, value: ATR });
  });

  it("refuses when the settlement emitted no TransferWithMemo at all", async () => {
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: [MAINNET_PLAIN_TRANSFER_LOG] }),
    );
    expect("refused" in out && out.code).toBe("tempo-mpp/no-memo-event");
  });

  it("refuses when the reader returns no logs for the transaction", async () => {
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({}),
    );
    expect("refused" in out && out.code).toBe("tempo-mpp/no-memo-event");
  });

  it("refuses when the only memo-bearing movement was a MINT, not a transfer", async () => {
    // A token issuer can emit TransferWithMemo with any 32 bytes via mintWithMemo. That is not a payment,
    // so it is not a settlement, so its memo is not a weld.
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: [memoLog({ from: ZERO_WORD })] }),
    );
    expect("refused" in out && out.code).toBe("tempo-mpp/memo-not-a-transfer");
    // States the DISTINCTION, not just the refusal: an issuance carrying a memo is the exact thing a
    // reader would otherwise mistake for a settlement.
    expect("refused" in out ? (out.detail ?? "") : "").toContain(
      MAINNET_TX_HASH,
    );
  });

  it("refuses when the only memo-bearing movement was a BURN", async () => {
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: [memoLog({ to: ZERO_WORD })] }),
    );
    expect("refused" in out && out.code).toBe("tempo-mpp/memo-not-a-transfer");
  });

  it("skips a mint and recovers from the transfer when both are present", async () => {
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({
        settlement: [
          memoLog({ from: ZERO_WORD, memo: OTHER_ATR, logIndex: "0x0" }),
          memoLog({ memo: ATR, logIndex: "0x1" }),
        ],
      }),
    );
    expect(out).toEqual({ ok: true, value: ATR });
  });

  it("REFUSES two different memos in one settlement — a split payment is not resolved by preference", async () => {
    // MPP splits emit up to 11 transfers, the primary inheriting the top-level memo and each split
    // carrying its own. Two distinct references in one settlement is a contradiction, and picking one
    // would let a seller show different terms to different readers of the same transaction.
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({
        settlement: [
          memoLog({ memo: ATR, logIndex: "0x1" }),
          memoLog({ memo: OTHER_ATR, logIndex: "0x2" }),
        ],
      }),
    );
    expect("refused" in out && out.code).toBe("tempo-mpp/ambiguous-memos");
    // The refusal's whole purpose is to hand the choice back, so the detail has to show WHICH memos are
    // in play and how many. A bare "ambiguous" leaves the caller with no way to pick a logIndex.
    const detail = "refused" in out ? (out.detail ?? "") : "";
    expect(detail).toContain(ATR);
    expect(detail).toContain(OTHER_ATR);
    expect(detail).toContain("2");
  });

  it("accepts the SAME memo repeated across a split's transfers", async () => {
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH },
      reader({
        settlement: [
          memoLog({ memo: ATR, logIndex: "0x1" }),
          memoLog({ memo: ATR, logIndex: "0x2" }),
        ],
      }),
    );
    expect(out).toEqual({ ok: true, value: ATR });
  });

  it("resolves an ambiguous settlement when the ref pins one logIndex", async () => {
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH, logIndex: 2 },
      reader({
        settlement: [
          memoLog({ memo: ATR, logIndex: "0x1" }),
          memoLog({ memo: OTHER_ATR, logIndex: "0x2" }),
        ],
      }),
    );
    expect(out).toEqual({ ok: true, value: OTHER_ATR });
  });

  it("refuses a pinned logIndex that matches no memo event — never falls back to the first", async () => {
    const out = await adapter().recover(
      { txHash: MAINNET_TX_HASH, logIndex: 9 },
      reader({ settlement: [memoLog({ memo: ATR, logIndex: "0x1" })] }),
    );
    expect("refused" in out && out.code).toBe("tempo-mpp/log-index-mismatch");
    // Names the transaction AND the index that missed — the two facts needed to re-pin it.
    const detail = "refused" in out ? (out.detail ?? "") : "";
    expect(detail).toContain(MAINNET_TX_HASH);
    expect(detail).toContain("9");
  });
});

describe("observe", () => {
  it("reports the settled transition with the recovered atrHash", async () => {
    const out = await adapter().observe(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: [memoLog({ memo: ATR })] }),
    );
    expect(out).toEqual({
      ok: true,
      value: { state: "settled", atrHash: ATR },
    });
  });

  it("passes a recovery refusal straight through, unchanged", async () => {
    const out = await adapter().observe(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: MAINNET_RECEIPT_LOGS }),
    );
    expect("refused" in out && out.code).toBe(
      "tempo-mpp/memo-is-mpp-attribution",
    );
  });

  it("only ever reports a state the manifest declares", async () => {
    const out = await adapter().observe(
      { txHash: MAINNET_TX_HASH },
      reader({ settlement: [memoLog({ memo: ATR })] }),
    );
    if ("refused" in out) throw new Error("expected a settled observation");
    expect(TEMPO_MPP_MANIFEST.lifecycleStates).toContain(out.value.state);
  });
});

describe("enumerate", () => {
  it("returns a ref per settlement the memo topic filter found", async () => {
    const refs = await adapter().enumerate(
      ATR,
      RANGE,
      reader({
        byMemo: [
          memoLog({
            memo: ATR,
            txHash: `0x${"11".repeat(32)}`,
            logIndex: "0x1",
          }),
          memoLog({
            memo: ATR,
            txHash: `0x${"22".repeat(32)}`,
            logIndex: "0x5",
          }),
        ],
      }),
    );
    expect(refs).toEqual([
      { txHash: `0x${"11".repeat(32)}`, logIndex: 1 },
      { txHash: `0x${"22".repeat(32)}`, logIndex: 5 },
    ]);
  });

  it("drops a log the node returned that does NOT carry the requested memo", async () => {
    // eth_getLogs should never do this, but a relaxed or buggy provider that widens the filter must not
    // be able to attribute a settlement to the wrong atrHash.
    const refs = await adapter().enumerate(
      ATR,
      RANGE,
      reader({ byMemo: [memoLog({ memo: OTHER_ATR })] }),
    );
    expect(refs).toEqual([]);
  });

  it("drops a foreign token's log even though it carries the requested memo", async () => {
    // The `address` filter is in the request, so a conforming node never returns this. The post-filter is
    // what makes the guarantee independent of the provider.
    const refs = await adapter().enumerate(
      ATR,
      RANGE,
      reader({
        byMemo: [{ ...memoLog({ memo: ATR }), address: FORGED_TOKEN }],
      }),
    );
    expect(refs).toEqual([]);
  });

  it("drops a log that is not a TransferWithMemo at all", async () => {
    // A provider that widens or mis-filters must not crash the enumeration or attribute a plain transfer.
    const refs = await adapter().enumerate(
      ATR,
      RANGE,
      reader({ byMemo: [MAINNET_PLAIN_TRANSFER_LOG] }),
    );
    expect(refs).toEqual([]);
  });

  it("drops mints and burns — enumeration returns settlements, not issuance", async () => {
    const refs = await adapter().enumerate(
      ATR,
      RANGE,
      reader({
        byMemo: [memoLog({ from: ZERO_WORD }), memoLog({ to: ZERO_WORD })],
      }),
    );
    expect(refs).toEqual([]);
  });

  it("matches case-insensitively (the chain's topic is lower case, the caller's may not be)", async () => {
    const refs = await adapter().enumerate(
      `0x${"AB".repeat(32)}`,
      RANGE,
      reader({ byMemo: [memoLog({ memo: ATR, logIndex: "0x0" })] }),
    );
    expect(refs).toEqual([{ txHash: MAINNET_TX_HASH, logIndex: 0 }]);
  });

  it("returns an empty list when nothing was ever bound to the atrHash", async () => {
    const refs = await adapter().enumerate(ATR, RANGE, reader({}));
    expect(refs).toEqual([]);
  });

  it("throws on a malformed atrHash rather than querying a topic that matches nothing", async () => {
    await expect(
      adapter().enumerate("0x1234", RANGE, reader({})),
    ).rejects.toThrow(/32-byte/);
  });

  it("asks the reader for the memo topic filter PINNED to the token, not for a recipient scan", async () => {
    // The caller supplies a block window; the adapter supplies the token. A chain-wide memo query would
    // return any token's log for that memo, which is exactly the shape a forged token exploits.
    let asked: { memo: string; range: unknown } | null = null;
    const spy: TempoReader = {
      settlementLogs: async () => [],
      logsByMemo: async (memo, range) => {
        asked = { memo, range };
        return [];
      },
    };
    await adapter().enumerate(ATR, RANGE, spy);
    expect(asked).toEqual({
      memo: ATR,
      range: { address: MAINNET_TOKEN, ...RANGE },
    });
  });
});

describe("the weld grade of the observed call", () => {
  it("grades the real mainnet settlement's own calldata as signature-grade", () => {
    // Closes the loop between the manifest's claim and an actual transaction: this is the calldata the
    // payer signed, and it is the transferWithMemo path.
    expect(adapter().weldGradeForCall(MAINNET_CALLDATA)).toBe(
      TEMPO_MPP_MANIFEST.weldGrades["tip20-transferWithMemo"],
    );
  });

  it("grades a transferFromWithMemo call as the manifest's other, weaker entry", () => {
    expect(adapter().weldGradeForCall(`0x929c2539${"00".repeat(128)}`)).toBe(
      TEMPO_MPP_MANIFEST.weldGrades["tip20-transferFromWithMemo"],
    );
  });
});
