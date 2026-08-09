import { describe, expect, it } from "vitest";
import {
  createHederaAdapter,
  type HederaReader,
  type HederaTxView,
  recoverAtrHashFromTxView,
} from "../src/adapter.js";
import { HEDERA_MANIFEST } from "../src/manifest.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER =
  "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Encode a memo string to the Mirror Node `memo_base64` form (UTF-8 → base64). */
function toMemoBase64(memo: string): string {
  const bytes = new TextEncoder().encode(memo);
  let bin = "";
  for (let i = 0; i < bytes.length; i++)
    bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
}

describe("recoverAtrHashFromTxView", () => {
  it("recovers from a decoded memo on a SUCCESS transaction", () => {
    expect(recoverAtrHashFromTxView({ memo: ATR, result: "SUCCESS" })).toBe(
      ATR,
    );
  });

  it("recovers from the raw Mirror Node memo_base64 form", () => {
    expect(
      recoverAtrHashFromTxView({
        memoBase64: toMemoBase64(ATR),
        result: "SUCCESS",
      }),
    ).toBe(ATR);
  });

  it("prefers the decoded memo when both forms are present", () => {
    expect(
      recoverAtrHashFromTxView({
        memo: ATR,
        memoBase64: toMemoBase64(OTHER),
        result: "SUCCESS",
      }),
    ).toBe(ATR);
  });

  it("returns null when no memo carries an atrHash", () => {
    expect(
      recoverAtrHashFromTxView({ memo: "just a note", result: "SUCCESS" }),
    ).toBeNull();
    expect(recoverAtrHashFromTxView({ result: "SUCCESS" })).toBeNull();
  });

  it("fails closed on a non-SUCCESS transaction (funds never moved — not a weld)", () => {
    // A Hedera tx can reach consensus (and carry a memo) yet fail post-consensus and move no funds.
    expect(
      recoverAtrHashFromTxView({
        memo: ATR,
        result: "INSUFFICIENT_ACCOUNT_BALANCE",
      }),
    ).toBeNull();
    // Absent result is also not a settlement (fail-closed; a faithful Mirror reader always supplies it).
    expect(recoverAtrHashFromTxView({ memo: ATR })).toBeNull();
  });
});

describe("createHederaAdapter", () => {
  const adapter = createHederaAdapter(HEDERA_MANIFEST);

  function reader(
    views: Record<string, HederaTxView | null>,
    ids: string[] = [],
  ): HederaReader {
    return {
      async txView(transactionId: string): Promise<HederaTxView | null> {
        return views[transactionId] ?? null;
      },
      async transactionsFor(_accountId: string): Promise<string[]> {
        return ids;
      },
    };
  }

  it("propose returns the transactionMemo string carrying the atrHash", () => {
    expect(adapter.propose(ATR)).toBe(ATR);
    expect(() => adapter.propose("0xdead")).toThrow(/32-byte/);
  });

  it("recover returns the welded atrHash", async () => {
    const r = await adapter.recover(
      { transactionId: "0.0.1001@1700000000.000000000" },
      reader({
        "0.0.1001@1700000000.000000000": { memo: ATR, result: "SUCCESS" },
      }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("recover works off the raw memo_base64 form too", async () => {
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memoBase64: toMemoBase64(ATR), result: "SUCCESS" } }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("prefers the DECODED memo when the view carries both forms", async () => {
    // The Mirror Node returns memo_base64; some callers pre-decode it. When both are present the
    // decoded text wins, so a caller cannot get a different answer than the raw bytes would give.
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({
        tx1: { memo: ATR, memoBase64: toMemoBase64(OTHER), result: "SUCCESS" },
      }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("refuses a SUCCESS transaction that carries NO memo at all", async () => {
    // Neither form present — memoTextOf returns null, and that is a different fact from "the memo is
    // there but says something else". Both refuse; neither may throw.
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { result: "SUCCESS" } }),
    );
    expect(r).toMatchObject({ refused: true, code: "hedera/no-atr-memo" });
  });

  it("recover refuses (verification-failure) when no atr memo is present", async () => {
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: "not an atr", result: "SUCCESS" } }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "hedera/no-atr-memo",
      detail: expect.stringContaining("no atrHash transactionMemo on SUCCESS"),
    });
  });

  it("recover refuses a non-SUCCESS transaction even when its memo carries a valid atrHash", async () => {
    const r = await adapter.recover(
      { transactionId: "tx-failed" },
      reader({
        "tx-failed": { memo: ATR, result: "INSUFFICIENT_ACCOUNT_BALANCE" },
      }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "hedera/unsuccessful-transaction",
      detail: expect.stringContaining("its memo is not a weld"),
    });
  });

  it("recover refuses a transaction the Mirror Node does not have — absence is not failure", async () => {
    const r = await adapter.recover({ transactionId: "missing" }, reader({}));
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "hedera/no-such-transaction",
      detail: expect.stringContaining("nothing settled there"),
    });
  });

  it("observe reports the settled transition", async () => {
    const o = await adapter.observe(
      { transactionId: "tx1" },
      reader({ tx1: { memo: ATR, result: "SUCCESS" } }),
    );
    expect(o).toEqual({ ok: true, value: { state: "settled", atrHash: ATR } });
  });

  it.each([
    [
      "the Mirror Node has no such transaction",
      {},
      "missing",
      "hedera/no-such-transaction",
    ],
    [
      "the transaction did not succeed",
      { tx1: { memo: ATR, result: "INSUFFICIENT_ACCOUNT_BALANCE" } },
      "tx1",
      "hedera/unsuccessful-transaction",
    ],
  ])(
    "observe PROPAGATES the refusal when %s — it never reports a settlement that is not there",
    async (_why, script, id, code) => {
      const o = await adapter.observe(
        { transactionId: id },
        reader(script as Parameters<typeof reader>[0]),
      );
      expect(o).toMatchObject({
        refused: true,
        haltClass: "verification-failure",
        code,
      });
    },
  );

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() => createHederaAdapter(HEDERA_MANIFEST)).not.toThrow();
    expect(() =>
      createHederaAdapter({ ...HEDERA_MANIFEST, rail: "solana" }),
    ).toThrow('manifest.rail "solana" is not "hedera"');
  });

  it("enumerate throws on a malformed atrHash — a silent [] is not an answer", async () => {
    await expect(
      adapter.enumerate("not-a-hash", "0.0.5001", reader({})),
    ).rejects.toThrow("enumerate: atrHash must be a 0x-prefixed 32-byte value");
  });

  it("enumerate scans an account's transactions and returns only the SUCCESS atrHash matches", async () => {
    const rdr = reader(
      {
        tx1: { memo: ATR, result: "SUCCESS" },
        tx2: { memo: OTHER, result: "SUCCESS" },
        tx3: { memo: ATR, result: "SUCCESS" },
        // A failed tx whose memo carries the wanted atrHash must NOT be enumerated as a settlement.
        tx4: { memo: ATR, result: "CONTRACT_REVERT_EXECUTED" },
      },
      ["tx1", "tx2", "tx3", "tx4"],
    );
    const hits = await adapter.enumerate(ATR, "0.0.5001", rdr);
    expect(hits.map((h) => h.transactionId)).toEqual(["tx1", "tx3"]);
  });

  it("enumerate skips an id the mirror listed but cannot return a view for", async () => {
    // The account listing and the per-transaction fetch are two separate Mirror Node reads, so a id
    // can be listed and then come back empty (pruned, or a window boundary). That must skip, not throw
    // — one missing detail read cannot abort the whole scan.
    const rdr = reader({ tx1: { memo: ATR, result: "SUCCESS" } }, [
      "tx-gone",
      "tx1",
    ]);
    const hits = await adapter.enumerate(ATR, "0.0.5001", rdr);
    expect(hits.map((h) => h.transactionId)).toEqual(["tx1"]);
  });
});
