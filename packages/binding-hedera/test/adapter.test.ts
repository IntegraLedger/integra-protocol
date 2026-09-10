import { describe, expect, it } from "vitest";
import {
  createHederaAdapter,
  type HederaMemo,
  type HederaReader,
  type HederaTxView,
  recoverAtrHashFromTxView,
} from "../src/adapter.js";
import { HEDERA_MIRROR_MAX_PAGE } from "../src/constants.js";
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

/** The two spellings a reader may hold the memo in — one field, so it cannot hold both. */
const text = (value: string): HederaMemo => ({ encoding: "text", value });
const b64 = (value: string): HederaMemo => ({ encoding: "base64", value });

describe("recoverAtrHashFromTxView", () => {
  it("recovers from a decoded memo on a SUCCESS transaction", () => {
    expect(
      recoverAtrHashFromTxView({ memo: text(ATR), result: "SUCCESS" }),
    ).toBe(ATR);
  });

  it("recovers from the raw Mirror Node memo_base64 form", () => {
    expect(
      recoverAtrHashFromTxView({
        memo: b64(toMemoBase64(ATR)),
        result: "SUCCESS",
      }),
    ).toBe(ATR);
  });

  it("returns null when no memo carries an atrHash", () => {
    expect(
      recoverAtrHashFromTxView({
        memo: text("just a note"),
        result: "SUCCESS",
      }),
    ).toBeNull();
    expect(recoverAtrHashFromTxView({ result: "SUCCESS" })).toBeNull();
  });

  it("fails closed on a non-SUCCESS transaction (funds never moved — not a weld)", () => {
    // A Hedera tx can reach consensus (and carry a memo) yet fail post-consensus and move no funds.
    expect(
      recoverAtrHashFromTxView({
        memo: text(ATR),
        result: "INSUFFICIENT_ACCOUNT_BALANCE",
      }),
    ).toBeNull();
    // Absent result is also not a settlement (fail-closed; a faithful Mirror reader always supplies it).
    expect(recoverAtrHashFromTxView({ memo: text(ATR) })).toBeNull();
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
      async transactionsFor(
        _accountId: string,
        limit?: number,
      ): Promise<string[]> {
        // A faithful Mirror Node honours `limit` as a CAP, so the stub does too — a stub that ignored it
        // would make the truncation the adapter now guards against untestable.
        return limit === undefined ? ids : ids.slice(0, limit);
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
        "0.0.1001@1700000000.000000000": { memo: text(ATR), result: "SUCCESS" },
      }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("recover works off the raw memo_base64 form too", async () => {
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: b64(toMemoBase64(ATR)), result: "SUCCESS" } }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  /**
   * ⛔⛔ **THE VIEW COULD SAY TWO THINGS AT ONCE, AND THE TEST THAT PINNED IT WAS WRONG ON ITS FACE.**
   *
   * `HederaTxView` carried `memo?: string` AND `memoBase64?: string`, and this suite asserted that when
   * both were present the decoded one won — under a comment reading "a caller cannot get a different
   * answer than the raw bytes would give", while comparing `ATR` against `toMemoBase64(OTHER)`. A
   * different answer is precisely what it got, and precisely what it certified.
   *
   * The harm is not the exotic case. It is `memo: tx.memo ?? ""` beside the raw field: an EMPTY decoded
   * memo beat a `memoBase64` carrying the real weld, and a welded settlement refused `no-atr-memo`.
   *
   * ⭐ Both are unrepresentable now — one field, one encoding — so the tests that pinned the arbitration
   * are gone rather than inverted. What survives is the property that made arbitration look necessary:
   * either spelling of the same bytes reads the same weld.
   */
  it("⭐ either spelling of the SAME memo recovers the same atrHash", async () => {
    const asText = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: text(ATR), result: "SUCCESS" } }),
    );
    const asBase64 = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: b64(toMemoBase64(ATR)), result: "SUCCESS" } }),
    );
    expect(asText).toEqual({ ok: true, value: ATR });
    expect(asBase64).toEqual(asText);
  });

  it("⛔ an EMPTY text memo is a memo that says nothing, not a reader with nothing to say", async () => {
    // `memo: ""` was the shape that silently beat a real `memoBase64`. It can no longer coexist with one,
    // and on its own it means exactly what it says: this transaction's memo carries no atrHash.
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: text(""), result: "SUCCESS" } }),
    );
    expect(r).toMatchObject({ refused: true, code: "hedera/no-atr-memo" });
  });

  it("⛔ and an empty BASE64 memo reads the same way — an empty memo, not an unreadable one", async () => {
    // The discriminant is read on both arms: `""` decodes cleanly to `""` through atob, so this is
    // `no-atr-memo` and not `malformed-memo-encoding`.
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: b64(""), result: "SUCCESS" } }),
    );
    expect(r).toMatchObject({ refused: true, code: "hedera/no-atr-memo" });
  });

  it("⛔ the SAME bytes spelled `text` are not base64-decoded — the encoding decides, not the shape", async () => {
    // `toMemoBase64(ATR)` is a perfectly good base64 string. Spelled `text`, it is a memo whose content
    // happens to look like base64 and carries no atrHash — the arm the discriminant exists to separate.
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: text(toMemoBase64(ATR)), result: "SUCCESS" } }),
    );
    expect(r).toMatchObject({ refused: true, code: "hedera/no-atr-memo" });
  });

  it("refuses a SUCCESS transaction that carries NO memo at all", async () => {
    // No memo field at all, which is a different fact from "the memo is there but says something else".
    // Both refuse; neither may throw.
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { result: "SUCCESS" } }),
    );
    expect(r).toMatchObject({ refused: true, code: "hedera/no-atr-memo" });
  });

  it("recover refuses (verification-failure) when no atr memo is present", async () => {
    const r = await adapter.recover(
      { transactionId: "tx1" },
      reader({ tx1: { memo: text("not an atr"), result: "SUCCESS" } }),
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
        "tx-failed": {
          memo: text(ATR),
          result: "INSUFFICIENT_ACCOUNT_BALANCE",
        },
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
      reader({ tx1: { memo: text(ATR), result: "SUCCESS" } }),
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
      { tx1: { memo: text(ATR), result: "INSUFFICIENT_ACCOUNT_BALANCE" } },
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
        tx1: { memo: text(ATR), result: "SUCCESS" },
        tx2: { memo: text(OTHER), result: "SUCCESS" },
        tx3: { memo: text(ATR), result: "SUCCESS" },
        // A failed tx whose memo carries the wanted atrHash must NOT be enumerated as a settlement.
        tx4: { memo: text(ATR), result: "CONTRACT_REVERT_EXECUTED" },
      },
      ["tx1", "tx2", "tx3", "tx4"],
    );
    const hits = await adapter.enumerate(ATR, "0.0.5001", rdr);
    expect(hits.map((h) => h.transactionId)).toEqual(["tx1", "tx3"]);
  });

  /**
   * ⛔⛔ THE BUYER CHOOSES THE MEMO BYTES, SO THEY MUST NOT BE ABLE TO DENY THE READING.
   *
   * `atob` throws a `DOMException` on anything outside the standard base64 alphabet, and nothing on this
   * rail caught it — so the throw escaped `readTxView` → `recover`/`observe`/`enumerate`, surfaces whose
   * whole contract is a Refusal naming WHICH reading applies. On `enumerate` it was worst: the scan reads
   * every transaction on the account in one loop, so a single unreadable memo threw away the whole result
   * set, the settlements that genuinely welded included.
   *
   * The reachable path is a normalising hop, not a dishonest node. A faithful Mirror Node emits standard
   * base64, and the buyer decides whether their 100 memo bytes encode to one containing `+` or `/`; any
   * transport that base64url-normalises turns that choice into `-`/`_`, which `atob` rejects. So the buyer
   * picks, byte by byte, whether the account scan survives.
   */
  it("enumerate survives a buyer-authored memo the reader cannot base64-decode", async () => {
    const rdr = reader(
      {
        // `_` and `-` are base64URL, not base64: what a normalising hop makes of memo bytes the buyer
        // chose so their standard-base64 form contains `+` or `/`.
        "tx-hostile": { memo: b64("_---Pj_7774"), result: "SUCCESS" },
        "tx-good": { memo: b64(toMemoBase64(ATR)), result: "SUCCESS" },
      },
      ["tx-hostile", "tx-good"],
    );
    const hits = await adapter.enumerate(ATR, "0.0.5001", rdr);
    expect(hits.map((h) => h.transactionId)).toEqual(["tx-good"]);
  });

  /** And the single-reference read reports the transport fault AS one — never as a verdict about the
   *  settlement. `no-atr-memo` would claim the memo was read and found wanting; it was never read. */
  it("recover refuses an undecodable base64 memo as a reader fault, not as a missing atrHash", async () => {
    const r = await adapter.recover(
      { transactionId: "tx-hostile" },
      reader({ "tx-hostile": { memo: b64("!!!!"), result: "SUCCESS" } }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "hedera/malformed-memo-encoding",
    });
  });

  it("enumerate skips an id the mirror listed but cannot return a view for", async () => {
    // The account listing and the per-transaction fetch are two separate Mirror Node reads, so a id
    // can be listed and then come back empty (pruned, or a window boundary). That must skip, not throw
    // — one missing detail read cannot abort the whole scan.
    const rdr = reader({ tx1: { memo: text(ATR), result: "SUCCESS" } }, [
      "tx-gone",
      "tx1",
    ]);
    const hits = await adapter.enumerate(ATR, "0.0.5001", rdr);
    expect(hits.map((h) => h.transactionId)).toEqual(["tx1"]);
  });
});

/**
 * ⛔⛔ **THE SERVER'S DEFAULT GOVERNED THE SCAN, AND IT IS 25.**
 *
 * `enumerate` forwarded `limit` verbatim, so an absent one meant the Mirror Node chose the depth. Measured
 * live on 2026-09-10 against `mainnet-public.mirrornode.hedera.com`: no `limit` returns 25, `limit=100`
 * returns 100, and `limit=101` and `limit=200` both return 100 — over-asking is reduced in silence. So a
 * settlement twenty-six transactions back came out as `[]`, which on a best-effort scan is
 * indistinguishable from "this account never settled that atrHash". Nobody chose 25 and nobody was told.
 *
 * ⭐ This rail cannot do what Sui's does and page to exhaustion — `HederaReader.transactionsFor` returns
 * ids and no cursor. So the bound is stated (the endpoint's largest page) and a FULL page with no `limit`
 * named is a throw, because that is exactly the case where the scan cannot tell complete from truncated.
 */
describe("the account scan states its own bound", () => {
  const adapter = createHederaAdapter(HEDERA_MANIFEST);
  const ids = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `tx${i}`);

  function scanReader(all: string[]): HederaReader & {
    asked: (number | undefined)[];
  } {
    const asked: (number | undefined)[] = [];
    return {
      asked,
      async txView(): Promise<HederaTxView | null> {
        return { memo: text(OTHER), result: "SUCCESS" };
      },
      async transactionsFor(
        _accountId: string,
        limit?: number,
      ): Promise<string[]> {
        asked.push(limit);
        return limit === undefined ? all : all.slice(0, limit);
      },
    };
  }

  it("⛔ asks for the endpoint's largest page rather than letting the server pick", async () => {
    const rdr = scanReader(ids(3));
    await adapter.enumerate(ATR, "0.0.5001", rdr);
    expect(rdr.asked).toEqual([HEDERA_MIRROR_MAX_PAGE]);
  });

  it("⛔⛔ THROWS when the defaulted scan comes back full — truncation it cannot rule out", async () => {
    await expect(
      adapter.enumerate(
        ATR,
        "0.0.5001",
        scanReader(ids(HEDERA_MIRROR_MAX_PAGE + 40)),
      ),
    ).rejects.toThrow(/came back full/);
  });

  it("an explicit limit is the CALLER's bound — a full page there is the answer they asked for", async () => {
    // The throw is about an unasked-for truncation, not about fullness. A caller who names a depth has
    // said what they want and a short scan is what they chose.
    const hits = await adapter.enumerate(
      ATR,
      "0.0.5001",
      scanReader(ids(50)),
      10,
    );
    expect(hits).toEqual([]);
  });

  it("and it is passed through untouched", async () => {
    const rdr = scanReader(ids(50));
    await adapter.enumerate(ATR, "0.0.5001", rdr, 7);
    expect(rdr.asked).toEqual([7]);
  });

  it("⛔ refuses a limit that is not a positive integer rather than passing it to the node", async () => {
    for (const bad of [0, -1, 2.5]) {
      await expect(
        adapter.enumerate(ATR, "0.0.5001", scanReader(ids(3)), bad),
      ).rejects.toThrow(/limit must be a positive integer/);
    }
  });

  it("a limit of 1 is a legitimate bound — the floor is 1, not 2", async () => {
    // `< 1` and `<= 1` differ by exactly the smallest scan a caller can ask for, and asking for one
    // transaction is a perfectly ordinary thing to want.
    const rdr = scanReader(ids(5));
    await adapter.enumerate(ATR, "0.0.5001", rdr, 1);
    expect(rdr.asked).toEqual([1]);
  });

  it("a defaulted scan one short of full is an answer, not a throw", async () => {
    // The boundary matters: `>=` and `>` differ by exactly the case where the page is exactly full, which
    // is the case that cannot be distinguished from truncation.
    const hits = await adapter.enumerate(
      ATR,
      "0.0.5001",
      scanReader(ids(HEDERA_MIRROR_MAX_PAGE - 1)),
    );
    expect(hits).toEqual([]);
  });
});
