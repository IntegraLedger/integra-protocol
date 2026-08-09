import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it } from "vitest";
import {
  appendSettlePaymentCall,
  createSuiAdapter,
  type PaymentSettledView,
  recoverAtrHashFromEvents,
  type SettlePaymentArgs,
  type SuiReader,
} from "../src/adapter.js";
import {
  PAY402_MODULE,
  PAY402_SETTLE_FUNCTION,
  pay402SettledEventType,
} from "../src/constants.js";
import { SUI_MANIFEST } from "../src/manifest.js";
import { encodeAtrPaymentId } from "../src/payment-id.js";

const PKG =
  "0x25c4e00d9ba281c5815c29a2851be2d5ffb10b23ce7399efd57d2a29c103508c";
const EVENT_TYPE = pay402SettledEventType(PKG);
const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER =
  "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function settleArgs(atrHash: string): SettlePaymentArgs {
  return {
    packageId: PKG,
    coinType: `${PKG}::usdc::USDC`,
    buyerCoin: `0x${"1".repeat(64)}`,
    buyer: `0x${"a".repeat(64)}`,
    merchant: `0x${"b".repeat(64)}`,
    amount: 1_000_000n,
    facilitatorFee: 0n,
    atrHash,
  };
}

describe("appendSettlePaymentCall", () => {
  it("appends a Pay402 settle_payment MoveCall welding the atrHash bytes into an input", () => {
    const tx = new Transaction();
    appendSettlePaymentCall(tx, settleArgs(ATR));
    const data = tx.getData() as {
      commands: Array<{
        MoveCall?: { module: string; function: string; package: string };
      }>;
      inputs: Array<{ Pure?: { bytes: string } }>;
    };
    const move = data.commands.find((c) => c.MoveCall !== undefined)?.MoveCall;
    expect(move?.module).toBe(PAY402_MODULE);
    expect(move?.function).toBe(PAY402_SETTLE_FUNCTION);
    expect(move?.package).toBe(PKG);

    // The 32 atrHash bytes must ride as a Pure `vector<u8>` input (base64-encoded by the SDK). The BCS
    // encoding of a vector<u8> prefixes the length (ULEB128 0x20 = 32) then the raw bytes, so the atrHash
    // hex appears in the decoded tail — this proves the weld, not just that a settle call exists.
    const atrHex = ATR.slice(2);
    const rides = data.inputs.some((i) => {
      if (i.Pure?.bytes === undefined) return false;
      return Buffer.from(i.Pure.bytes, "base64")
        .toString("hex")
        .includes(atrHex);
    });
    expect(rides).toBe(true);
  });

  it("fails loud (via the codec) on a malformed atrHash", () => {
    const tx = new Transaction();
    expect(() => appendSettlePaymentCall(tx, settleArgs("0xdead"))).toThrow(
      /32-byte/,
    );
  });

  it("passes the USDC coin type as the call's single type argument", () => {
    // `settle_payment<T>` is generic over the coin. An empty type-argument list does not fail to build —
    // it produces a call the Move VM cannot resolve, or resolves against the wrong coin.
    const tx = new Transaction();
    const args = settleArgs(ATR);
    appendSettlePaymentCall(tx, args);
    const data = tx.getData() as {
      commands: Array<{ MoveCall?: { typeArguments: string[] } }>;
    };
    const move = data.commands.find((c) => c.MoveCall !== undefined)?.MoveCall;
    expect(move?.typeArguments).toEqual([args.coinType]);
  });

  it("defaults the shared Clock to 0x6 and honours an explicit override", () => {
    // The SDK records an id it has not resolved yet as `UnresolvedObject`, normalized to the padded
    // 64-hex form — so `0x6` is stored as `0x0…06`, not the literal the source passes.
    const objectIds = (tx: Transaction): string[] => {
      const data = tx.getData() as {
        inputs: Array<{ UnresolvedObject?: { objectId: string } }>;
      };
      return data.inputs.flatMap((i) =>
        i.UnresolvedObject === undefined ? [] : [i.UnresolvedObject.objectId],
      );
    };

    const withDefault = new Transaction();
    appendSettlePaymentCall(withDefault, settleArgs(ATR));
    expect(objectIds(withDefault)).toContain(`0x${"0".repeat(63)}6`);

    const override = `0x${"c".repeat(64)}`;
    const withOverride = new Transaction();
    appendSettlePaymentCall(withOverride, {
      ...settleArgs(ATR),
      clock: override,
    });
    expect(objectIds(withOverride)).toContain(override);
    expect(objectIds(withOverride)).not.toContain(`0x${"0".repeat(63)}6`);
  });

  it("adapter.propose appends the same call as the bare helper", () => {
    // `propose` had no test at all — only the helper it delegates to did, so an emptied method body
    // read as covered while silently proposing nothing.
    const viaAdapter = new Transaction();
    createSuiAdapter(SUI_MANIFEST).propose(viaAdapter, settleArgs(ATR));
    const viaHelper = new Transaction();
    appendSettlePaymentCall(viaHelper, settleArgs(ATR));
    expect(viaAdapter.getData()).toEqual(viaHelper.getData());

    const commands = (viaAdapter.getData() as { commands: unknown[] }).commands;
    expect(commands.length).toBeGreaterThan(0);
  });
});

describe("recoverAtrHashFromEvents", () => {
  it("finds the PaymentSettled event and decodes payment_id (skipping unrelated events)", () => {
    const views: PaymentSettledView[] = [
      { type: `${PKG}::payment::OtherEvent` },
      { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
    ];
    expect(recoverAtrHashFromEvents(views, EVENT_TYPE)).toBe(ATR);
  });

  it("returns null when no event carries a 32-byte payment_id", () => {
    expect(
      recoverAtrHashFromEvents(
        [
          { type: EVENT_TYPE, paymentId: [1, 2, 3] },
          { type: `${PKG}::payment::OtherEvent` },
        ],
        EVENT_TYPE,
      ),
    ).toBeNull();
  });

  it("does NOT recover a PaymentSettled event from an UNTRUSTED package (exact-type, no ::suffix spoof)", () => {
    // A same-tx event named `::payment::PaymentSettled` but emitted by a DIFFERENT package must not be
    // treated as this package's weld — a Sui PTB can compose arbitrary packages.
    const untrusted = `0x${"f".repeat(64)}::payment::PaymentSettled`;
    expect(
      recoverAtrHashFromEvents(
        [{ type: untrusted, paymentId: Array.from(encodeAtrPaymentId(ATR)) }],
        EVENT_TYPE,
      ),
    ).toBeNull();
  });
});

describe("createSuiAdapter", () => {
  const adapter = createSuiAdapter(SUI_MANIFEST);

  function reader(
    txScript: Record<string, PaymentSettledView[]>,
    query: PaymentSettledView[] = [],
  ): SuiReader {
    return {
      async settledEvents(digest: string): Promise<PaymentSettledView[]> {
        return txScript[digest] ?? [];
      },
      async querySettled(): Promise<PaymentSettledView[]> {
        return query;
      },
    };
  }

  it("recover returns the welded atrHash", async () => {
    const r = await adapter.recover(
      { digest: "dig1", packageId: PKG },
      reader({
        dig1: [
          { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
        ],
      }),
    );
    expect("refused" in r).toBe(false);
    if (!("refused" in r)) expect(r.value).toBe(ATR);
  });

  it("recover refuses (verification-failure) when no PaymentSettled binds", async () => {
    const r = await adapter.recover(
      { digest: "dig1", packageId: PKG },
      reader({ dig1: [] }),
    );
    expect("refused" in r).toBe(true);
    if ("refused" in r) {
      expect(r.haltClass).toBe("verification-failure");
      expect(r.code).toBe("sui/no-payment-id");
    }
  });

  it("recover refuses a PaymentSettled event from a DIFFERENT package (no cross-package spoof)", async () => {
    const other = `0x${"f".repeat(64)}`;
    const r = await adapter.recover(
      { digest: "dig1", packageId: PKG },
      reader({
        dig1: [
          {
            type: pay402SettledEventType(other),
            paymentId: Array.from(encodeAtrPaymentId(ATR)),
          },
        ],
      }),
    );
    expect("refused" in r).toBe(true);
  });

  it("observe reports the settled transition", async () => {
    const o = await adapter.observe(
      { digest: "dig1", packageId: PKG },
      reader({
        dig1: [
          { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
        ],
      }),
    );
    expect("refused" in o).toBe(false);
    if (!("refused" in o))
      expect(o.value).toEqual({ state: "settled", atrHash: ATR });
  });

  it("enumerate scans settle events and returns only the atrHash matches (with digests)", async () => {
    const rdr = reader({}, [
      {
        type: EVENT_TYPE,
        paymentId: Array.from(encodeAtrPaymentId(ATR)),
        digest: "dig1",
      },
      {
        type: EVENT_TYPE,
        paymentId: Array.from(encodeAtrPaymentId(OTHER)),
        digest: "dig2",
      },
      {
        type: EVENT_TYPE,
        paymentId: Array.from(encodeAtrPaymentId(ATR)),
        digest: "dig3",
      },
    ]);
    const hits = await adapter.enumerate(ATR, EVENT_TYPE, rdr);
    expect(hits.map((h) => h.digest)).toEqual(["dig1", "dig3"]);
  });

  it("enumerate skips events of a different type or without a digest", async () => {
    const rdr = reader({}, [
      {
        type: `${PKG}::payment::OtherEvent`,
        paymentId: Array.from(encodeAtrPaymentId(ATR)),
        digest: "digX",
      },
      { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
    ]);
    expect(await adapter.enumerate(ATR, EVENT_TYPE, rdr)).toEqual([]);
  });

  it("enumerate skips a trusted-type event carrying no payment_id at all", async () => {
    // The event type matches and a digest is present, but `parsedJson` had no payment_id — a scan must
    // step over it, not hand `undefined` to the codec.
    const rdr = reader({}, [
      { type: EVENT_TYPE, digest: "digY" },
      {
        type: EVENT_TYPE,
        paymentId: Array.from(encodeAtrPaymentId(ATR)),
        digest: "dig1",
      },
    ]);
    expect(
      (await adapter.enumerate(ATR, EVENT_TYPE, rdr)).map((h) => h.digest),
    ).toEqual(["dig1"]);
  });

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() => createSuiAdapter(SUI_MANIFEST)).not.toThrow();
    expect(() => createSuiAdapter({ ...SUI_MANIFEST, rail: "solana" })).toThrow(
      'manifest.rail "solana" is not "sui"',
    );
  });

  it("enumerate throws on a malformed atrHash — a silent [] is not an answer", async () => {
    await expect(
      adapter.enumerate("not-a-hash", EVENT_TYPE, reader({})),
    ).rejects.toThrow("enumerate: atrHash must be a 0x-prefixed 32-byte value");
  });

  it("enumerate stamps the trusted packageId so each hit round-trips back into recover", async () => {
    // `enumerate` takes an event type but returns refs, and `recover` re-derives the trusted type from
    // `ref.packageId`. If the stamped id is not the type's first segment the ref is un-recoverable.
    const rdr = reader({}, [
      {
        type: EVENT_TYPE,
        paymentId: Array.from(encodeAtrPaymentId(ATR)),
        digest: "dig1",
      },
    ]);
    const [hit] = await adapter.enumerate(ATR, EVENT_TYPE, rdr);
    expect(hit).toEqual({ digest: "dig1", packageId: PKG });

    const back = await adapter.recover(
      hit ?? { digest: "dig1", packageId: PKG },
      reader({
        dig1: [
          { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
        ],
      }),
    );
    expect(back).toEqual({ ok: true, value: ATR });
  });
});

/**
 * `observe` was only ever asked about a settlement that WAS there. It re-runs `recover` and forwards the
 * refusal, so with no test for the absent case a regression that drops the forward answers
 * `{state:"settled", atrHash:undefined}` — a settled verdict for a transaction that never welded
 * anything. Same shape found in canton, aptos, solana, hedera, xrpl and cardano.
 */
describe("createSuiAdapter — the settlement that ISN'T there", () => {
  const adapter = createSuiAdapter(SUI_MANIFEST);

  function emptyReader(): SuiReader {
    return {
      async settledEvents(): Promise<PaymentSettledView[]> {
        return [];
      },
      async querySettled(): Promise<PaymentSettledView[]> {
        return [];
      },
    };
  }

  it("observe refuses — it never reports settled with an undefined atrHash", async () => {
    const o = await adapter.observe(
      { digest: "dig-absent", packageId: PKG },
      emptyReader(),
    );
    expect("ok" in o).toBe(false);
    if (!("refused" in o)) throw new Error("expected a refusal");
    expect(o.refused).toBe(true);
    expect(o.haltClass).toBe("verification-failure");
    expect(o.code).toBe("sui/no-payment-id");
  });

  it("observe forwards recover's refusal verbatim, adding nothing", async () => {
    const ref = { digest: "dig-absent", packageId: PKG };
    const observed = await adapter.observe(ref, emptyReader());
    const recovered = await adapter.recover(ref, emptyReader());
    expect(observed).toEqual(recovered);
  });

  it("observe refuses a PaymentSettled event whose payment_id is not 32 bytes", async () => {
    const o = await adapter.observe(
      { digest: "dig1", packageId: PKG },
      {
        async settledEvents(): Promise<PaymentSettledView[]> {
          return [{ type: EVENT_TYPE, paymentId: [1, 2, 3] }];
        },
        async querySettled(): Promise<PaymentSettledView[]> {
          return [];
        },
      },
    );
    expect("refused" in o && o.refused).toBe(true);
  });

  it("carries the literal Outcome discriminants, not merely the key", async () => {
    // `"refused" in r` is true even when the flag is false, so the discriminant itself needs pinning:
    // a consumer branching on `if (r.refused)` would treat a refusal as a success.
    const refusal = await adapter.recover(
      { digest: "dig-absent", packageId: PKG },
      emptyReader(),
    );
    expect(refusal).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "sui/no-payment-id",
      detail: expect.stringContaining("dig-absent"),
    });

    const success = await adapter.observe(
      { digest: "dig1", packageId: PKG },
      {
        async settledEvents(): Promise<PaymentSettledView[]> {
          return [
            {
              type: EVENT_TYPE,
              paymentId: Array.from(encodeAtrPaymentId(ATR)),
            },
          ];
        },
        async querySettled(): Promise<PaymentSettledView[]> {
          return [];
        },
      },
    );
    expect(success).toEqual({
      ok: true,
      value: { state: "settled", atrHash: ATR },
    });
  });
});

describe("recoverAtrHashFromEvents keeps scanning past an unusable event", () => {
  it("steps over a trusted event with no payment_id and takes the next one", () => {
    const views: PaymentSettledView[] = [
      { type: EVENT_TYPE },
      { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
    ];
    expect(recoverAtrHashFromEvents(views, EVENT_TYPE)).toBe(ATR);
  });

  it("steps over a wrong-length payment_id and takes the next one", () => {
    // A PTB can emit several PaymentSettled events. Stopping at the first that fails to decode would
    // lose a weld that is genuinely present later in the same transaction.
    const views: PaymentSettledView[] = [
      { type: EVENT_TYPE, paymentId: [1, 2, 3] },
      { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
    ];
    expect(recoverAtrHashFromEvents(views, EVENT_TYPE)).toBe(ATR);
  });

  it("returns the FIRST decodable weld when several are present", () => {
    const views: PaymentSettledView[] = [
      { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(ATR)) },
      { type: EVENT_TYPE, paymentId: Array.from(encodeAtrPaymentId(OTHER)) },
    ];
    expect(recoverAtrHashFromEvents(views, EVENT_TYPE)).toBe(ATR);
  });
});

describe("encodeAtrPaymentId", () => {
  it("throws on a malformed atrHash — fail-fast, mirroring propose", () => {
    expect(() => encodeAtrPaymentId("not-a-hash")).toThrow(
      'encodeAtrPaymentId: atrHash must be a 0x-prefixed 32-byte value, got "not-a-hash"',
    );
  });
});
