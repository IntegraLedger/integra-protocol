import type { Aptos, TransactionResponse } from "@aptos-labs/ts-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  type AptosReader,
  type AptosSettleView,
  type AptosTxView,
  buildSettlePaymentCall,
  createAptosAdapter,
  makeAptosReader,
  normalizeAptosType,
  parseSettleViews,
  parseTxView,
  recoverAtrHashFromSettleViews,
  recoverAtrHashFromTxView,
} from "../src/adapter.js";
import { getAptosConfig, paymentSettledEventType } from "../src/constants.js";
import { APTOS_MANIFEST } from "../src/manifest.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER =
  "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const TESTNET_MODULE = getAptosConfig("testnet").lcpModuleAddress;
const SETTLED_TYPE = paymentSettledEventType(TESTNET_MODULE);

describe("buildSettlePaymentCall", () => {
  it("targets settle_payment under the module and carries the atrHash as payment_id", () => {
    const call = buildSettlePaymentCall({
      atrHash: ATR,
      lcpModuleAddress: TESTNET_MODULE,
      coinType: "0x1::aptos_coin::AptosCoin",
      recipient: "0xseller",
      amount: 1_000_000n,
    });
    expect(call.function).toBe(`${TESTNET_MODULE}::payment::settle_payment`);
    expect(call.typeArguments).toEqual(["0x1::aptos_coin::AptosCoin"]);
    const [recipient, amount, paymentId] = call.functionArguments;
    expect(recipient).toBe("0xseller");
    expect(amount).toBe(1_000_000n);
    expect(paymentId.length).toBe(32);
    expect(
      recoverAtrHashFromSettleViews(
        [{ eventType: SETTLED_TYPE, paymentId: Uint8Array.from(paymentId) }],
        TESTNET_MODULE,
      ),
    ).toBe(ATR);
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() =>
      buildSettlePaymentCall({
        atrHash: "0xdead",
        lcpModuleAddress: TESTNET_MODULE,
        coinType: "0x1::aptos_coin::AptosCoin",
        recipient: "0xseller",
        amount: 1n,
      }),
    ).toThrow(/32-byte/);
  });
});

describe("recoverAtrHashFromSettleViews", () => {
  it("finds the module's PaymentSettled event and decodes payment_id (skipping others)", () => {
    const views: AptosSettleView[] = [
      { eventType: "0x1::coin::WithdrawEvent", paymentId: "0xirrelevant" },
      { eventType: SETTLED_TYPE, paymentId: ATR },
    ];
    expect(recoverAtrHashFromSettleViews(views, TESTNET_MODULE)).toBe(ATR);
  });

  it("honors ONLY the pinned module's event (a DIFFERENT module's PaymentSettled is ignored)", () => {
    const otherModule = "0xbadc0de::payment::PaymentSettled";
    expect(
      recoverAtrHashFromSettleViews(
        [{ eventType: otherModule, paymentId: ATR }],
        TESTNET_MODULE,
      ),
    ).toBeNull();
  });

  it("returns null when no PaymentSettled event carries an atrHash", () => {
    expect(
      recoverAtrHashFromSettleViews(
        [{ eventType: SETTLED_TYPE, paymentId: "not-a-hash" }],
        TESTNET_MODULE,
      ),
    ).toBeNull();
  });

  it("tolerates leading-zero-padded module addresses (normalizeAptosType)", () => {
    // The fullnode may emit `0x01ad…` vs the config's `0x1ad…` — both must match.
    const padded = SETTLED_TYPE.replace(/^0x/, "0x0");
    expect(normalizeAptosType(padded)).toBe(normalizeAptosType(SETTLED_TYPE));
    expect(
      recoverAtrHashFromSettleViews(
        [{ eventType: padded, paymentId: ATR }],
        TESTNET_MODULE,
      ),
    ).toBe(ATR);
  });
});

describe("parseSettleViews (SDK→pure boundary)", () => {
  function userTx(over: Record<string, unknown>): TransactionResponse {
    return {
      type: "user_transaction",
      success: true,
      vm_status: "Executed successfully",
      hash: "0xtx",
      version: "1",
      events: [],
      ...over,
    } as unknown as TransactionResponse;
  }

  it("extracts a PaymentSettled event's payment_id from a successful user tx", () => {
    const tx = userTx({
      events: [
        {
          guid: {},
          sequence_number: "0",
          type: "0x1::coin::WithdrawEvent",
          data: {},
        },
        {
          guid: {},
          sequence_number: "1",
          type: SETTLED_TYPE,
          data: { payment_id: ATR, merchant: "0xseller", amount: "1000000" },
        },
      ],
    });
    const views = parseSettleViews(tx);
    expect(recoverAtrHashFromSettleViews(views, TESTNET_MODULE)).toBe(ATR);
  });

  it("yields no views for a pending/non-user tx (no events field)", () => {
    const pending = {
      type: "pending_transaction",
      hash: "0xtx",
    } as unknown as TransactionResponse;
    expect(parseSettleViews(pending)).toEqual([]);
  });

  it("skips an event whose payment_id is neither a string nor bytes", () => {
    const tx = userTx({
      events: [
        { guid: {}, type: SETTLED_TYPE, data: { payment_id: 42 } },
        { guid: {}, type: SETTLED_TYPE, data: {} },
        { guid: {}, type: SETTLED_TYPE, data: { payment_id: ATR } },
      ],
    });
    // Only the well-formed one becomes a view — a numeric or absent payment_id is skipped, never
    // coerced into something readPaymentId would try to interpret.
    expect(parseSettleViews(tx)).toEqual([
      { eventType: SETTLED_TYPE, paymentId: ATR },
    ]);
  });

  it("accepts a raw-bytes payment_id as well as the fullnode's 0x-hex form", () => {
    const bytes = Uint8Array.from(
      (ATR.slice(2).match(/../g) ?? []).map((b) => Number.parseInt(b, 16)),
    );
    const tx = userTx({
      events: [{ guid: {}, type: SETTLED_TYPE, data: { payment_id: bytes } }],
    });
    expect(
      recoverAtrHashFromSettleViews(parseSettleViews(tx), TESTNET_MODULE),
    ).toBe(ATR);
  });
});

/**
 * ★ THE SUCCESS GATE LIVES HERE, NOT IN THE MAPPER. `AptosReader` is a public, injectable port — any
 * implementation other than `makeAptosReader` reaches the pure recovery path directly, so a gate that only
 * ran inside the SDK→pure mapper would not bind them. The raw fields ride the view and the pure function
 * is fail-closed, matching binding-solana (`err`), binding-xrpl (`validated`/`engineResult`) and
 * binding-hedera (`result`).
 */
describe("recoverAtrHashFromTxView (the success gate)", () => {
  const events = [{ eventType: SETTLED_TYPE, paymentId: ATR }];
  const executed = { success: true, vmStatus: "Executed successfully" };

  it("recovers from an executed transaction's view", () => {
    expect(
      recoverAtrHashFromTxView({ events, ...executed }, TESTNET_MODULE),
    ).toBe(ATR);
  });

  it("a FAILED transaction's event is NOT a weld", () => {
    expect(
      recoverAtrHashFromTxView(
        { events, success: false, vmStatus: "Move abort" },
        TESTNET_MODULE,
      ),
    ).toBeNull();
  });

  it("success:true with a non-executed VM status is refused — both facts are checked", () => {
    expect(
      recoverAtrHashFromTxView(
        { events, success: true, vmStatus: "Out of gas" },
        TESTNET_MODULE,
      ),
    ).toBeNull();
  });

  it("an ABSENT success flag is not evidence of success — fail closed", () => {
    expect(
      recoverAtrHashFromTxView(
        { events, vmStatus: "Executed successfully" },
        TESTNET_MODULE,
      ),
    ).toBeNull();
  });

  it("an ABSENT vm status is not evidence of success — fail closed", () => {
    expect(
      recoverAtrHashFromTxView({ events, success: true }, TESTNET_MODULE),
    ).toBeNull();
  });

  it("a null view (unknown hash) recovers nothing", () => {
    expect(recoverAtrHashFromTxView(null, TESTNET_MODULE)).toBeNull();
  });

  it("the module scope still applies on top of the success gate", () => {
    expect(
      recoverAtrHashFromTxView({ events, ...executed }, `0x${"9".repeat(64)}`),
    ).toBeNull();
  });
});

describe("parseTxView (SDK→pure boundary, with the success fields)", () => {
  function userTx(over: Record<string, unknown>): TransactionResponse {
    return {
      type: "user_transaction",
      success: true,
      vm_status: "Executed successfully",
      hash: "0xtx",
      version: "1",
      events: [],
      ...over,
    } as unknown as TransactionResponse;
  }

  it("carries success and vm_status through to the view", () => {
    const v = parseTxView(userTx({}));
    expect(v.success).toBe(true);
    expect(v.vmStatus).toBe("Executed successfully");
  });

  it("carries a failure through to the view rather than dropping the events", () => {
    const v = parseTxView(
      userTx({
        success: false,
        vm_status: "Move abort",
        events: [{ guid: {}, type: SETTLED_TYPE, data: { payment_id: ATR } }],
      }),
    );
    // The mapper carries data; the pure gate decides. The event is present AND the failure is visible.
    expect(v.events).toEqual([{ eventType: SETTLED_TYPE, paymentId: ATR }]);
    expect(v.success).toBe(false);
    expect(recoverAtrHashFromTxView(v, TESTNET_MODULE)).toBeNull();
  });

  it("OMITS the fields a pending tx does not carry — absence, not a fabricated success", () => {
    const pending = {
      type: "pending_transaction",
      hash: "0xtx",
    } as unknown as TransactionResponse;
    const v = parseTxView(pending);
    expect("success" in v).toBe(false);
    expect("vmStatus" in v).toBe(false);
    expect(recoverAtrHashFromTxView(v, TESTNET_MODULE)).toBeNull();
  });
});

describe("recoverAtrHashFromSettleViews is scoped to ITS OWN module", () => {
  const OTHER_MODULE = `0x${"9".repeat(64)}`;

  it("ignores a PaymentSettled event emitted by a different module", () => {
    // An overlay binding honours only the module it deployed. Any address can publish a module named
    // `payment` emitting `PaymentSettled`; honouring those would let a stranger's transaction pass as
    // this binding's settlement.
    const views = [
      { eventType: paymentSettledEventType(OTHER_MODULE), paymentId: ATR },
    ];
    expect(recoverAtrHashFromSettleViews(views, TESTNET_MODULE)).toBeNull();
    expect(recoverAtrHashFromSettleViews(views, OTHER_MODULE)).toBe(ATR);
  });

  it("skips its own module's events that carry no readable payment_id, and keeps looking", () => {
    const views = [
      { eventType: SETTLED_TYPE, paymentId: "not-an-atr" },
      { eventType: SETTLED_TYPE, paymentId: ATR },
    ];
    expect(recoverAtrHashFromSettleViews(views, TESTNET_MODULE)).toBe(ATR);
  });
});

describe("createAptosAdapter", () => {
  const adapter = createAptosAdapter(APTOS_MANIFEST, "testnet");

  function reader(script: Record<string, AptosTxView>): AptosReader {
    return {
      async txView(hash: string): Promise<AptosTxView | null> {
        return script[hash] ?? null;
      },
    };
  }

  /** An executed transaction carrying the given settle-event views. */
  function executed(...events: AptosSettleView[]): AptosTxView {
    return { events, success: true, vmStatus: "Executed successfully" };
  }

  it("propose builds the settle_payment call for the configured testnet module + coin", () => {
    const call = adapter.propose({
      atrHash: ATR,
      recipient: "0xseller",
      amount: 5n,
    });
    expect(call.function).toBe(`${TESTNET_MODULE}::payment::settle_payment`);
    expect(call.typeArguments).toEqual(["0x1::aptos_coin::AptosCoin"]);
  });

  it("recover returns the welded atrHash", async () => {
    const r = await adapter.recover(
      { hash: "tx1" },
      reader({ tx1: executed({ eventType: SETTLED_TYPE, paymentId: ATR }) }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("recover refuses (verification-failure) when no settle event is present", async () => {
    const r = await adapter.recover(
      { hash: "tx1" },
      reader({ tx1: executed() }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "aptos/no-settle-payment-id",
    });
  });

  it("observe reports the settled transition", async () => {
    const o = await adapter.observe(
      { hash: "tx1" },
      reader({ tx1: executed({ eventType: SETTLED_TYPE, paymentId: ATR }) }),
    );
    expect(o).toEqual({ ok: true, value: { state: "settled", atrHash: ATR } });
  });

  it("observe PROPAGATES the refusal — it never reports a settlement that is not there", async () => {
    // Without the forward, observe answers `{state: "settled", atrHash: undefined}` for a transaction
    // that carries no PaymentSettled event at all.
    const o = await adapter.observe(
      { hash: "tx1" },
      reader({ tx1: executed() }),
    );
    expect(o).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "aptos/no-settle-payment-id",
    });
  });

  it("recover REFUSES a failed transaction carrying a valid PaymentSettled event", async () => {
    // Reached through the PORT, not the shipped reader — this is the path a custom AptosReader takes,
    // and before the gate moved into the pure function nothing on it refused a failure.
    const r = await adapter.recover(
      { hash: "tx1" },
      reader({
        tx1: {
          events: [{ eventType: SETTLED_TYPE, paymentId: ATR }],
          success: false,
          vmStatus: "Move abort",
        },
      }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "aptos/no-settle-payment-id",
    });
  });

  it("enumerate SKIPS failed transactions among the candidate hashes", async () => {
    const rdr = reader({
      tx1: executed({ eventType: SETTLED_TYPE, paymentId: ATR }),
      tx2: {
        events: [{ eventType: SETTLED_TYPE, paymentId: ATR }],
        success: false,
        vmStatus: "Move abort",
      },
    });
    const hits = await adapter.enumerate(ATR, ["tx1", "tx2"], rdr);
    expect(hits.map((h) => h.hash)).toEqual(["tx1"]);
  });

  it("enumerate scans candidate hashes and returns only the atrHash matches", async () => {
    const rdr = reader({
      tx1: executed({ eventType: SETTLED_TYPE, paymentId: ATR }),
      tx2: executed({ eventType: SETTLED_TYPE, paymentId: OTHER }),
      tx3: executed({ eventType: SETTLED_TYPE, paymentId: ATR }),
    });
    const hits = await adapter.enumerate(ATR, ["tx1", "tx2", "tx3"], rdr);
    expect(hits.map((h) => h.hash)).toEqual(["tx1", "tx3"]);
  });

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() =>
      createAptosAdapter({ ...APTOS_MANIFEST, rail: "solana" }, "testnet"),
    ).toThrow('manifest.rail "solana" is not "aptos"');
  });

  it("enumerate throws on a malformed atrHash — a silent [] is not an answer", async () => {
    await expect(
      adapter.enumerate("not-a-hash", ["tx1"], reader({})),
    ).rejects.toThrow("enumerate: atrHash must be a 0x-prefixed 32-byte value");
  });
});

/**
 * The SDK→port adapter over an `@aptos-labs/ts-sdk` client. Thin, but it is where the fullnode's
 * TransactionResponse becomes the pure view — so it owns that the hash is passed through unchanged and
 * that the raw outcome fields reach the view the pure gate reads.
 */
describe("makeAptosReader", () => {
  it("fetches the transaction by hash and maps it through parseTxView", async () => {
    const getTransactionByHash = vi.fn(async () => ({
      type: "user_transaction",
      success: true,
      vm_status: "Executed successfully",
      events: [{ guid: {}, type: SETTLED_TYPE, data: { payment_id: ATR } }],
    }));
    const reader = makeAptosReader({
      getTransactionByHash,
    } as unknown as Aptos);
    const view = await reader.txView("0xtx");
    expect(getTransactionByHash).toHaveBeenCalledWith({
      transactionHash: "0xtx",
    });
    expect(recoverAtrHashFromTxView(view, TESTNET_MODULE)).toBe(ATR);
  });

  it("carries a failed transaction's outcome through so the pure gate refuses it", async () => {
    const reader = makeAptosReader({
      getTransactionByHash: async () => ({
        type: "user_transaction",
        success: false,
        vm_status: "Move abort",
        events: [{ guid: {}, type: SETTLED_TYPE, data: { payment_id: ATR } }],
      }),
    } as unknown as Aptos);
    const view = await reader.txView("0xtx");
    expect(view?.success).toBe(false);
    expect(recoverAtrHashFromTxView(view, TESTNET_MODULE)).toBeNull();
  });
});
