import { describe, expect, it } from "vitest";
import { pay402SettledEventType } from "../src/constants.js";
import { encodeAtrPaymentId } from "../src/payment-id.js";
import {
  makeSuiReader,
  parseSuiEvents,
  type RawSuiEvent,
  type SuiRpcLike,
} from "../src/reader.js";

const PKG =
  "0x25c4e00d9ba281c5815c29a2851be2d5ffb10b23ce7399efd57d2a29c103508c";
const EVENT_TYPE = pay402SettledEventType(PKG);
const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
/**
 * Built inside `it`, never at module scope: `encodeAtrPaymentId` throws by design, and a regression that
 * makes it throw during module evaluation fails the whole FILE before any test runs — which vitest
 * reports as zero failures — a whole-file failure, not a test failure.
 */
const paymentId = (): number[] => Array.from(encodeAtrPaymentId(ATR));

describe("parseSuiEvents (SDK→pure boundary)", () => {
  it("maps a PaymentSettled event's parsedJson.payment_id number[] into a view", () => {
    const events: RawSuiEvent[] = [
      { type: EVENT_TYPE, parsedJson: { payment_id: paymentId() } },
    ];
    const views = parseSuiEvents(events);
    expect(views).toHaveLength(1);
    expect(views[0]?.type).toBe(EVENT_TYPE);
    expect(views[0]?.paymentId).toEqual(paymentId());
  });

  it("leaves paymentId undefined when parsedJson lacks a byte-array payment_id", () => {
    const events: RawSuiEvent[] = [
      { type: EVENT_TYPE, parsedJson: { merchant: "0xabc" } },
      { type: EVENT_TYPE, parsedJson: null },
      { type: EVENT_TYPE, parsedJson: { payment_id: "not-an-array" } },
    ];
    for (const v of parseSuiEvents(events)) expect(v.paymentId).toBeUndefined();
  });

  it("carries a per-event txDigest through when present", () => {
    const views = parseSuiEvents([
      {
        type: EVENT_TYPE,
        parsedJson: { payment_id: paymentId() },
        id: { txDigest: "DiGeSt1" },
      },
    ]);
    expect(views[0]?.digest).toBe("DiGeSt1");
  });
});

describe("makeSuiReader over a narrow SuiRpcLike", () => {
  function rpc(script: {
    tx?: Record<string, RawSuiEvent[]>;
    query?: RawSuiEvent[];
  }): SuiRpcLike {
    return {
      async getTransactionBlock(input: {
        digest: string;
      }): Promise<{ events?: RawSuiEvent[] | null }> {
        return { events: script.tx?.[input.digest] ?? [] };
      },
      async queryEvents(): Promise<{ data: RawSuiEvent[] }> {
        return { data: script.query ?? [] };
      },
    };
  }

  it("settledEvents reads a tx's events and stamps the caller's digest", async () => {
    const reader = makeSuiReader(
      rpc({
        tx: {
          dig1: [{ type: EVENT_TYPE, parsedJson: { payment_id: paymentId() } }],
        },
      }),
    );
    const views = await reader.settledEvents("dig1");
    expect(views[0]?.paymentId).toEqual(paymentId());
    expect(views[0]?.digest).toBe("dig1");
  });

  it("settledEvents tolerates a null events field (returns empty)", async () => {
    const reader = makeSuiReader({
      async getTransactionBlock(): Promise<{ events?: RawSuiEvent[] | null }> {
        return { events: null };
      },
      async queryEvents(): Promise<{ data: RawSuiEvent[] }> {
        return { data: [] };
      },
    });
    expect(await reader.settledEvents("dig1")).toEqual([]);
  });

  it("querySettled maps the queryEvents page (with per-event digests)", async () => {
    const reader = makeSuiReader(
      rpc({
        query: [
          {
            type: EVENT_TYPE,
            parsedJson: { payment_id: paymentId() },
            id: { txDigest: "dig2" },
          },
        ],
      }),
    );
    const views = await reader.querySettled(EVENT_TYPE, 10);
    expect(views[0]?.digest).toBe("dig2");
    expect(views[0]?.paymentId).toEqual(paymentId());
  });
});

/**
 * The fake above answers every call the same way, so nothing constrained the REQUEST the reader builds —
 * and the request is what decides whether a settlement is found at all. Each of these four fields fails
 * silently when wrong: the RPC returns a well-formed empty (or wrong) page, never an error, so the weld
 * reads as never-anchored.
 */
describe("makeSuiReader builds the request the RPC actually needs", () => {
  interface TxCall {
    digest: string;
    options: { showEvents: true };
  }
  interface QueryCall {
    query: { MoveEventType: string };
    limit?: number;
    order?: "descending" | "ascending";
  }

  function recording(): {
    client: SuiRpcLike;
    txCalls: TxCall[];
    queryCalls: QueryCall[];
  } {
    const txCalls: TxCall[] = [];
    const queryCalls: QueryCall[] = [];
    return {
      txCalls,
      queryCalls,
      client: {
        async getTransactionBlock(
          input: TxCall,
        ): Promise<{ events?: RawSuiEvent[] | null }> {
          txCalls.push(input);
          return { events: [] };
        },
        async queryEvents(input: QueryCall): Promise<{ data: RawSuiEvent[] }> {
          queryCalls.push(input);
          return { data: [] };
        },
      },
    };
  }

  it("asks for the queried digest with showEvents — without it the RPC omits events entirely", async () => {
    const { client, txCalls } = recording();
    await makeSuiReader(client).settledEvents("dig1");
    expect(txCalls).toEqual([
      { digest: "dig1", options: { showEvents: true } },
    ]);
  });

  it("filters queryEvents by the fully-qualified MoveEventType, not the whole event firehose", async () => {
    const { client, queryCalls } = recording();
    await makeSuiReader(client).querySettled(EVENT_TYPE, 25);
    expect(queryCalls[0]?.query).toEqual({ MoveEventType: EVENT_TYPE });
  });

  it("scans newest-first — ascending would page off the oldest settlements ever made", async () => {
    const { client, queryCalls } = recording();
    await makeSuiReader(client).querySettled(EVENT_TYPE, 25);
    expect(queryCalls[0]?.order).toBe("descending");
  });

  it("passes limit through when given, and omits the key entirely when not", async () => {
    const { client, queryCalls } = recording();
    const reader = makeSuiReader(client);
    await reader.querySettled(EVENT_TYPE, 25);
    await reader.querySettled(EVENT_TYPE);
    expect(queryCalls[0]?.limit).toBe(25);
    // Absent, not present-and-undefined. The wire form is the same either way (JSON.stringify drops an
    // undefined value), so what this pins is the type contract: under `exactOptionalPropertyTypes`,
    // `{ limit?: number }` does not admit `{ limit: undefined }`, and the conditional spread is what
    // keeps the built request matching its declared shape.
    expect(Object.hasOwn(queryCalls[1] ?? {}, "limit")).toBe(false);
  });
});

describe("parseSuiEvents rejects a malformed payment_id rather than half-decoding it", () => {
  it("drops a payment_id array holding a non-number element", () => {
    // An RPC (or a hostile package) can put anything in `parsedJson`. A mixed array must not reach
    // `decodeAtrPaymentId`, where `Uint8Array.from` would coerce the string element to 0 and mint a
    // 32-byte atrHash that was never welded.
    const views = parseSuiEvents([
      {
        type: EVENT_TYPE,
        parsedJson: { payment_id: [...paymentId().slice(0, 31), "7f"] },
      },
    ]);
    expect(views[0]?.paymentId).toBeUndefined();
  });

  it("omits the paymentId and digest keys rather than setting them undefined", () => {
    const views = parseSuiEvents([{ type: EVENT_TYPE }]);
    expect(views[0]).toStrictEqual({ type: EVENT_TYPE });
  });
});
