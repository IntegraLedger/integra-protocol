import {
  type Connection,
  type ParsedTransactionWithMeta,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";
import {
  buildAtrMemoInstruction,
  createSolanaAdapter,
  type MemoView,
  makeSolanaReader,
  parseMemoViews,
  parseTxView,
  recoverAtrHashFromMemoViews,
  recoverAtrHashFromTxView,
  type SolanaReader,
  type SolanaTxView,
} from "../src/adapter.js";
import { MEMO_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/constants.js";
import { SOLANA_MANIFEST } from "../src/manifest.js";
import { decodeSplMemo, encodeSplMemo } from "../src/memo.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER =
  "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** A runtime failure as getParsedTransaction reports one — the fee was charged, no funds moved. */
const FAILED = { InstructionError: [0, { Custom: 1 }] };

/** A successful tx view carrying the given memo views. */
function settled(...memos: MemoView[]): SolanaTxView {
  return { memos, err: null };
}

/** A getParsedTransaction-shaped fixture carrying one SPL-Memo instruction with `atrHash`. */
function memoTx(
  atrHash: string,
  err: SolanaTxView["err"] = null,
): ParsedTransactionWithMeta {
  return {
    transaction: {
      message: {
        instructions: [
          {
            programId: new PublicKey(MEMO_PROGRAM_ID),
            parsed: atrHash,
            program: "spl-memo",
          },
        ],
      },
    },
    meta: { err },
  } as unknown as ParsedTransactionWithMeta;
}

describe("buildAtrMemoInstruction", () => {
  it("targets the Memo program and carries the atrHash in its data", () => {
    const ix = buildAtrMemoInstruction(ATR, "hex");
    expect(ix.programId.toBase58()).toBe(MEMO_PROGRAM_ID);
    expect(ix.keys).toEqual([]);
    expect(decodeSplMemo(Uint8Array.from(ix.data), "hex")).toBe(ATR);
  });
});

describe("recoverAtrHashFromMemoViews", () => {
  it("finds the memo instruction and decodes it (skipping non-memo instructions)", () => {
    const views: MemoView[] = [
      { programId: TOKEN_PROGRAM_ID },
      { programId: MEMO_PROGRAM_ID, memoUtf8: ATR },
    ];
    expect(recoverAtrHashFromMemoViews(views)).toBe(ATR);
  });
  it("reads a raw-data memo view too", () => {
    const views: MemoView[] = [
      { programId: MEMO_PROGRAM_ID, data: new TextEncoder().encode(ATR) },
    ];
    expect(recoverAtrHashFromMemoViews(views)).toBe(ATR);
  });
  it("returns null when no memo carries an atrHash", () => {
    expect(
      recoverAtrHashFromMemoViews([
        { programId: TOKEN_PROGRAM_ID },
        { programId: MEMO_PROGRAM_ID, memoUtf8: "just a note" },
      ]),
    ).toBeNull();
  });

  it("IGNORES an atr-shaped memo emitted by any program other than SPL-Memo", () => {
    // The canonical binding is the SPL Memo program specifically. Honouring a look-alike from another
    // program would let an instruction nobody's signature covers in the same way pass as the weld.
    expect(
      recoverAtrHashFromMemoViews([
        { programId: TOKEN_PROGRAM_ID, memoUtf8: ATR },
      ]),
    ).toBeNull();
  });

  it("skips a memo view carrying neither parsed text nor raw data, and keeps looking", () => {
    expect(
      recoverAtrHashFromMemoViews([
        { programId: MEMO_PROGRAM_ID },
        { programId: MEMO_PROGRAM_ID, memoUtf8: ATR },
      ]),
    ).toBe(ATR);
  });

  it("reads BOTH memo encodings — 0x-hex text and the 32 raw bytes", () => {
    // The recover path tries hex first and falls back to raw. A settlement written in either form must
    // be recoverable; dropping the second attempt would false-refuse every raw-encoded weld.
    expect(
      recoverAtrHashFromMemoViews([
        { programId: MEMO_PROGRAM_ID, data: encodeSplMemo(ATR, "raw") },
      ]),
    ).toBe(ATR);
    expect(
      recoverAtrHashFromMemoViews([
        { programId: MEMO_PROGRAM_ID, data: encodeSplMemo(ATR, "hex") },
      ]),
    ).toBe(ATR);
  });

  it("keeps scanning past a non-atr memo to a later one that IS the weld", () => {
    expect(
      recoverAtrHashFromMemoViews([
        { programId: MEMO_PROGRAM_ID, memoUtf8: "order #42" },
        { programId: MEMO_PROGRAM_ID, memoUtf8: ATR },
      ]),
    ).toBe(ATR);
  });
});

describe("recoverAtrHashFromTxView (the success gate)", () => {
  it("recovers from a successful transaction's view", () => {
    expect(
      recoverAtrHashFromTxView(
        settled({ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }),
      ),
    ).toBe(ATR);
  });

  it("a FAILED transaction's memo is NOT a weld — err non-null is fail-closed", () => {
    // A reverted Solana transaction is confirmed, charged its fee, and carries whatever memo the
    // submitter attached — yet moved no funds. Honouring its memo would report a settlement that
    // never happened (mirrors binding-xrpl's tesSUCCESS gate and binding-hedera's SUCCESS gate).
    expect(
      recoverAtrHashFromTxView({
        memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }],
        err: FAILED,
      }),
    ).toBeNull();
  });

  it("a view with NO err field is not evidence of success — fail closed", () => {
    // Absent meta means the reader could not see the outcome. That is not a success.
    expect(
      recoverAtrHashFromTxView({
        memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }],
      }),
    ).toBeNull();
  });

  it("a null view (unknown signature) recovers nothing", () => {
    expect(recoverAtrHashFromTxView(null)).toBeNull();
  });
});

describe("parseMemoViews (SDK→pure boundary)", () => {
  it("maps a parsed transaction's instructions into memo views", () => {
    // A fixture shaped like getParsedTransaction's output (the Memo program parses to a string).
    const tx = {
      transaction: {
        message: {
          instructions: [
            {
              programId: new PublicKey(TOKEN_PROGRAM_ID),
              parsed: { type: "transferChecked" },
              program: "spl-token",
            },
            {
              programId: new PublicKey(MEMO_PROGRAM_ID),
              parsed: ATR,
              program: "spl-memo",
            },
          ],
        },
      },
    } as unknown as ParsedTransactionWithMeta;
    const views = parseMemoViews(tx);
    // One view per instruction, in order, and the token instruction's OBJECT `parsed` value does not
    // become memo text — only a string one does, which is what the Memo program parses to.
    expect(views).toEqual([
      { programId: TOKEN_PROGRAM_ID },
      { programId: MEMO_PROGRAM_ID, memoUtf8: ATR },
    ]);
    expect(recoverAtrHashFromMemoViews(views)).toBe(ATR);
  });

  it("recovers a memo the RPC returned partially-decoded (base58 data, no `parsed`)", () => {
    // Some RPCs return the Memo instruction unparsed — its data is base58. The mapping must keep the
    // raw bytes so recover still finds the atrHash (the zeroPartyRecoverable claim, across providers).
    const memoBytes = encodeSplMemo(ATR, "hex");
    const tx = {
      transaction: {
        message: {
          instructions: [
            {
              programId: new PublicKey(MEMO_PROGRAM_ID),
              accounts: [],
              data: bs58.encode(memoBytes),
            },
          ],
        },
      },
    } as unknown as ParsedTransactionWithMeta;
    const views = parseMemoViews(tx);
    expect(recoverAtrHashFromMemoViews(views)).toBe(ATR);
  });

  /**
   * ⛔ A memo emitted through CPI is a memo.
   *
   * A program that calls the Memo program on the payer's behalf — which is how a router, a facilitator or
   * any settlement program emits one — produces an INNER instruction. `getParsedTransaction` reports those
   * under `meta.innerInstructions`, not in `transaction.message.instructions`, and this mapper read only
   * the second. So a genuinely welded settlement read as no weld at all: `recover` refused
   * `solana/no-atr-memo` about a transaction that carried the atrHash, and the manifest's
   * `zeroPartyRecoverable` claim was false for every deployment that does not emit the memo top-level.
   *
   * Inner instructions come after the top-level ones, deliberately: `recoverAtrHashFromMemoViews` takes
   * the first that decodes, so a memo the payer signed directly still wins over one a program emitted.
   */
  it("finds a memo emitted through CPI (meta.innerInstructions), not only a top-level one", () => {
    const tx = {
      transaction: {
        message: {
          instructions: [
            {
              programId: new PublicKey(TOKEN_PROGRAM_ID),
              parsed: { type: "transferChecked" },
              program: "spl-token",
            },
          ],
        },
      },
      meta: {
        err: null,
        innerInstructions: [
          {
            index: 0,
            instructions: [
              {
                programId: new PublicKey(MEMO_PROGRAM_ID),
                parsed: ATR,
                program: "spl-memo",
              },
            ],
          },
        ],
      },
    } as unknown as ParsedTransactionWithMeta;
    const views = parseMemoViews(tx);
    expect(views).toEqual([
      { programId: TOKEN_PROGRAM_ID },
      { programId: MEMO_PROGRAM_ID, memoUtf8: ATR },
    ]);
    expect(recoverAtrHashFromMemoViews(views)).toBe(ATR);
    expect(recoverAtrHashFromTxView(parseTxView(tx))).toBe(ATR);
  });

  it("keeps a top-level memo ahead of a CPI one — the payer's own weld wins", () => {
    const tx = {
      transaction: {
        message: {
          instructions: [
            {
              programId: new PublicKey(MEMO_PROGRAM_ID),
              parsed: ATR,
              program: "spl-memo",
            },
          ],
        },
      },
      meta: {
        err: null,
        innerInstructions: [
          {
            index: 0,
            instructions: [
              {
                programId: new PublicKey(MEMO_PROGRAM_ID),
                parsed: OTHER,
                program: "spl-memo",
              },
            ],
          },
        ],
      },
    } as unknown as ParsedTransactionWithMeta;
    expect(recoverAtrHashFromMemoViews(parseMemoViews(tx))).toBe(ATR);
  });

  it("tolerates an RPC that reports no innerInstructions at all", () => {
    const tx = {
      transaction: {
        message: {
          instructions: [
            {
              programId: new PublicKey(MEMO_PROGRAM_ID),
              parsed: ATR,
              program: "spl-memo",
            },
          ],
        },
      },
      meta: { err: null },
    } as unknown as ParsedTransactionWithMeta;
    expect(recoverAtrHashFromMemoViews(parseMemoViews(tx))).toBe(ATR);
  });
});

describe("parseTxView (SDK→pure boundary, with the success field)", () => {
  it("carries a success (err: null) through to the view", () => {
    expect(parseTxView(memoTx(ATR))).toEqual({
      memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }],
      err: null,
    });
  });

  it("carries a runtime failure through to the view", () => {
    expect(parseTxView(memoTx(ATR, FAILED)).err).toEqual(FAILED);
  });

  it("OMITS err when the RPC supplied no meta — absence, not a fabricated success", () => {
    const tx = {
      ...memoTx(ATR),
      meta: null,
    } as unknown as ParsedTransactionWithMeta;
    expect("err" in parseTxView(tx)).toBe(false);
  });
});

describe("createSolanaAdapter", () => {
  const adapter = createSolanaAdapter(SOLANA_MANIFEST);

  function reader(
    script: Record<string, SolanaTxView>,
    sigs: string[] = [],
  ): SolanaReader {
    return {
      async txView(signature: string): Promise<SolanaTxView | null> {
        return script[signature] ?? null;
      },
      async signaturesFor(_address: string): Promise<string[]> {
        return sigs;
      },
    };
  }

  it("recover returns the welded atrHash", async () => {
    const r = await adapter.recover(
      { signature: "sig1" },
      reader({ sig1: settled({ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }) }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("recover refuses (verification-failure) when no atr memo is present", async () => {
    const r = await adapter.recover(
      { signature: "sig1" },
      reader({ sig1: settled() }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "solana/no-atr-memo",
    });
  });

  it("recover REFUSES a failed transaction carrying a valid atr memo", async () => {
    // The strongest failure this binding can misreport: the weld memo is present and well-formed, but
    // the transaction reverted — fee charged, nothing moved. Reporting it settled would mint a
    // settlement record out of a failure, and it costs an attacker no payment at all.
    const r = await adapter.recover(
      { signature: "sig1" },
      reader({
        sig1: {
          memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }],
          err: FAILED,
        },
      }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "solana/unsuccessful-transaction",
    });
  });

  it("recover refuses a transaction the RPC does not have — absence is not failure", async () => {
    const r = await adapter.recover({ signature: "missing" }, reader({}));
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "solana/no-such-transaction",
    });
  });

  it("observe reports the settled transition", async () => {
    const o = await adapter.observe(
      { signature: "sig1" },
      reader({ sig1: settled({ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }) }),
    );
    expect(o).toEqual({ ok: true, value: { state: "settled", atrHash: ATR } });
  });

  it("observe PROPAGATES the refusal — it never reports a settlement that is not there", async () => {
    // Without the forward, observe answers `{state: "settled", atrHash: undefined}` for a signature
    // whose transaction carries no atr memo at all.
    const o = await adapter.observe(
      { signature: "sig1" },
      reader({ sig1: settled() }),
    );
    expect(o).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "solana/no-atr-memo",
    });
  });

  it("observe refuses a FAILED transaction — a reverted tx is not a settled transition", async () => {
    const o = await adapter.observe(
      { signature: "sig1" },
      reader({
        sig1: {
          memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }],
          err: FAILED,
        },
      }),
    );
    expect(o).toMatchObject({
      refused: true,
      code: "solana/unsuccessful-transaction",
    });
  });

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() =>
      createSolanaAdapter({ ...SOLANA_MANIFEST, rail: "xrpl" }),
    ).toThrow('manifest.rail "xrpl" is not "solana"');
  });

  it("enumerate throws on a malformed atrHash — a silent [] is not an answer", async () => {
    await expect(
      adapter.enumerate("not-a-hash", "addr", reader({})),
    ).rejects.toThrow("enumerate: atrHash must be a 0x-prefixed 32-byte value");
  });

  it("enumerate scans an account's signatures and returns only the atrHash matches", async () => {
    const rdr = reader(
      {
        sig1: settled({ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }),
        sig2: settled({ programId: MEMO_PROGRAM_ID, memoUtf8: OTHER }),
        sig3: settled({ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }),
      },
      ["sig1", "sig2", "sig3"],
    );
    const hits = await adapter.enumerate(ATR, "SomeAccount", rdr);
    expect(hits.map((h) => h.signature)).toEqual(["sig1", "sig3"]);
  });

  it("enumerate SKIPS a failed transaction bearing the wanted memo", async () => {
    const rdr = reader(
      {
        sig1: {
          memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }],
          err: FAILED,
        },
        sig2: settled({ programId: MEMO_PROGRAM_ID, memoUtf8: ATR }),
      },
      ["sig1", "sig2"],
    );
    const hits = await adapter.enumerate(ATR, "SomeAccount", rdr);
    expect(hits.map((h) => h.signature)).toEqual(["sig2"]);
  });
});

/**
 * The SDK→port adapter over a @solana/web3.js `Connection`. Thin, but it owns three facts nothing else
 * holds: an unknown signature resolves to a null view (not a crash), the transaction's `meta.err`
 * reaches the view, and the account scan is bounded by the caller's limit when one is given.
 */
describe("makeSolanaReader", () => {
  const SIG = "5".repeat(88);
  // A real base58 pubkey — `signaturesFor` constructs a PublicKey, so a placeholder string would fail
  // for the wrong reason. The token program's own address is as good as any account to scan.
  const ADDRESS = TOKEN_PROGRAM_ID;

  function fakeConnection(over: Record<string, unknown> = {}): Connection {
    return {
      getParsedTransaction: vi.fn(async () => memoTx(ATR)),
      getSignaturesForAddress: vi.fn(async () => [
        { signature: "sigA" },
        { signature: "sigB" },
      ]),
      ...over,
    } as unknown as Connection;
  }

  it("reads a confirmed transaction's view, asking for versioned transactions", async () => {
    const connection = fakeConnection();
    const view = await makeSolanaReader(connection).txView(SIG);
    expect(recoverAtrHashFromTxView(view)).toBe(ATR);
    // Without maxSupportedTransactionVersion the RPC refuses any v0 transaction outright.
    expect(connection.getParsedTransaction).toHaveBeenCalledWith(SIG, {
      maxSupportedTransactionVersion: 0,
    });
  });

  it("surfaces a runtime failure's err — the gate sees what the RPC saw", async () => {
    const connection = fakeConnection({
      getParsedTransaction: async () => memoTx(ATR, FAILED),
    });
    const view = await makeSolanaReader(connection).txView(SIG);
    expect(view?.err).toEqual(FAILED);
    expect(recoverAtrHashFromTxView(view)).toBeNull();
  });

  it("maps an unknown signature (null) to a null view rather than crashing the scan", async () => {
    const connection = fakeConnection({
      getParsedTransaction: async () => null,
    });
    await expect(makeSolanaReader(connection).txView(SIG)).resolves.toBeNull();
  });

  it("returns the signature strings for an address, passing a limit only when given one", async () => {
    const connection = fakeConnection();
    const reader = makeSolanaReader(connection);
    expect(await reader.signaturesFor(ADDRESS)).toEqual(["sigA", "sigB"]);
    expect(connection.getSignaturesForAddress).toHaveBeenLastCalledWith(
      expect.anything(),
      {},
    );
    await reader.signaturesFor(ADDRESS, 10);
    expect(connection.getSignaturesForAddress).toHaveBeenLastCalledWith(
      expect.anything(),
      { limit: 10 },
    );
  });
});
