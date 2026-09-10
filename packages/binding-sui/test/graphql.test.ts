/**
 * The GraphQL transport under the one reader — Sui's public JSON-RPC is deprecated and answers `-32601`
 * to every method, so this is the read path that still works, bound to the same `SuiRpcLike` port.
 *
 * ⭐ THE FIXTURES ARE REAL. Every digest, event type and `payment_id` below was read off Sui testnet
 * through `https://graphql.testnet.sui.io/graphql` on 2026-09-10, so the shape these tests assert against
 * is the shape the endpoint actually serves rather than one invented here — including the detail the whole
 * file exists for: GraphQL renders a Move `vector<u8>` as a base64 STRING where JSON-RPC renders it as a
 * JSON array of byte values. `reader.test.ts` pins the consequence of getting that wrong from the other
 * side: a `payment_id` that is not an array yields `paymentId: undefined`, which is a refusal rather than
 * an error, so a live weld would read as never-anchored with nothing going red.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSuiAdapter } from "../src/adapter.js";
import { pay402SettledEventType } from "../src/constants.js";
import {
  makeSuiGraphqlRpc,
  SUI_GRAPHQL_DEFAULT_EVENT_PAGE,
} from "../src/graphql.js";
import { SUI_MANIFEST } from "../src/manifest.js";
import { makeSuiReader } from "../src/reader.js";

const URL_ = "https://graphql.testnet.sui.io/graphql";
const PKG =
  "0x25c4e00d9ba281c5815c29a2851be2d5ffb10b23ce7399efd57d2a29c103508c";
const EVENT_TYPE = pay402SettledEventType(PKG);
const DIGEST = "4M9xCDH5ug4KUUg6h2DACgCFkfxz2tJ54TgGkmvEoUEh";
/** The live `payment_id` for {@link DIGEST}, exactly as GraphQL renders a `vector<u8>`. */
const PAYMENT_ID_B64 = "S5IrGxOa93IPiIrN30QHrEZ5Mr5DCWeTF/hQz6L6KOY=";

/** One event node in the shape both queries select it, with the live field set beside `payment_id`. */
function eventNode(overrides: Record<string, unknown> = {}) {
  return {
    contents: {
      type: { repr: EVENT_TYPE },
      json: {
        payment_id: PAYMENT_ID_B64,
        buyer:
          "0xd817e5a1fde8a566bda2dcc53a9fe74e8cc7c31c90a774a84512a14e414bd5c1",
        amount: "1",
        ...overrides,
      },
    },
    transaction: { digest: DIGEST },
  };
}

/** Stub `fetch` with one canned envelope, returning the recorded calls for assertion. */
function stubGraphql(envelope: unknown) {
  const calls: { url: string; body: { query: string; variables: unknown } }[] =
    [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return { ok: true, status: 200, json: async () => envelope } as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeSuiGraphqlRpc — construction", () => {
  it("refuses an empty url rather than POSTing to a relative path on the first read", () => {
    expect(() => makeSuiGraphqlRpc("")).toThrow(/url is empty/);
  });
});

describe("getTransactionBlock", () => {
  it("asks the endpoint for the digest it was given", async () => {
    const calls = stubGraphql({
      data: {
        transaction: { effects: { status: "SUCCESS", events: { nodes: [] } } },
      },
    });
    await makeSuiGraphqlRpc(URL_).getTransactionBlock({
      digest: DIGEST,
      options: { showEvents: true },
    });
    expect(calls[0]?.url).toBe("https://graphql.testnet.sui.io/graphql");
    expect(calls[0]?.body.variables).toEqual({ digest: DIGEST });
  });

  /**
   * ⛔⛔ THE DEFECT THIS TRANSPORT EXISTS TO NOT HAVE. A wrapper that handed `contents.json` straight
   * through would put the base64 STRING where `parseSuiEvents` expects bytes; the view's `paymentId` would
   * be `undefined`, `recover` would answer `sui/no-payment-id`, and a real settlement would report as
   * carrying no weld. So the assertion is the WHOLE PATH — endpoint bytes to atrHash — not the decoder
   * alone, and the expected hash is written out rather than re-derived from the base64 the code decodes.
   */
  it("decodes a base64 payment_id all the way back to the atrHash", async () => {
    stubGraphql({
      data: {
        transaction: {
          effects: { status: "SUCCESS", events: { nodes: [eventNode()] } },
        },
      },
    });
    const recovered = await createSuiAdapter(SUI_MANIFEST).recover(
      { digest: DIGEST, packageId: PKG },
      makeSuiReader(makeSuiGraphqlRpc(URL_)),
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered))
      expect(recovered.value).toBe(
        "0x4b922b1b139af7720f888acddf4407ac467932be4309679317f850cfa2fa28e6",
      );
  });

  it("leaves every field beside payment_id exactly as served", async () => {
    // Only `payment_id` is converted. A blanket "any string might be bytes" rewrite would turn the buyer
    // address and the amount into byte arrays, and nothing downstream reads them to notice.
    stubGraphql({
      data: {
        transaction: {
          effects: { status: "SUCCESS", events: { nodes: [eventNode()] } },
        },
      },
    });
    const res = await makeSuiGraphqlRpc(URL_).getTransactionBlock({
      digest: DIGEST,
      options: { showEvents: true },
    });
    const parsed = res.events?.[0]?.parsedJson as {
      buyer: unknown;
      amount: unknown;
      payment_id: unknown;
    };
    expect(parsed.buyer).toBe(
      "0xd817e5a1fde8a566bda2dcc53a9fe74e8cc7c31c90a774a84512a14e414bd5c1",
    );
    expect(parsed.amount).toBe("1");
    expect(Array.isArray(parsed.payment_id)).toBe(true);
    expect((parsed.payment_id as number[]).length).toBe(32);
  });

  it("carries the emitting transaction's digest through as the port's id.txDigest", async () => {
    stubGraphql({
      data: {
        transaction: {
          effects: { status: "SUCCESS", events: { nodes: [eventNode()] } },
        },
      },
    });
    const res = await makeSuiGraphqlRpc(URL_).getTransactionBlock({
      digest: DIGEST,
      options: { showEvents: true },
    });
    expect(res.events?.[0]?.id?.txDigest).toBe(
      "4M9xCDH5ug4KUUg6h2DACgCFkfxz2tJ54TgGkmvEoUEh",
    );
  });

  it("yields NO events for a FAILURE, the explicit gate the JSON-RPC path gets structurally", async () => {
    // Sui discards every effect of an aborted PTB, including its events, and `adapter.ts` relies on that
    // instead of carrying a success field. `reader.ts` requires any other source to gate explicitly, and
    // GraphQL publishes the status, so it is read rather than assumed.
    stubGraphql({
      data: {
        transaction: {
          effects: { status: "FAILURE", events: { nodes: [eventNode()] } },
        },
      },
    });
    const res = await makeSuiGraphqlRpc(URL_).getTransactionBlock({
      digest: DIGEST,
      options: { showEvents: true },
    });
    expect(res.events).toEqual([]);
  });

  it("THROWS on a digest the endpoint does not know, rather than reading it as no events", async () => {
    // The JSON-RPC method this stands in for throws. "This transaction does not exist" must never reach
    // `recover` as "it exists and carries no weld" — those are different answers to a verifier.
    stubGraphql({ data: { transaction: null } });
    await expect(
      makeSuiGraphqlRpc(URL_).getTransactionBlock({
        digest: DIGEST,
        options: { showEvents: true },
      }),
    ).rejects.toThrow(
      /no transaction 4M9xCDH5ug4KUUg6h2DACgCFkfxz2tJ54TgGkmvEoUEh/,
    );
  });

  it("throws when the effects report no execution status at all", async () => {
    // An absent status is an unanswered question, not a failed transaction. Reading it as a failure would
    // hand back no events, and `recover` would refuse — a real weld reported as never-anchored.
    stubGraphql({
      data: {
        transaction: {
          effects: { status: null, events: { nodes: [eventNode()] } },
        },
      },
    });
    await expect(
      makeSuiGraphqlRpc(URL_).getTransactionBlock({
        digest: DIGEST,
        options: { showEvents: true },
      }),
    ).rejects.toThrow(/reports no execution status/);
  });

  it("throws when a known transaction carries no effects", async () => {
    stubGraphql({ data: { transaction: { effects: null } } });
    await expect(
      makeSuiGraphqlRpc(URL_).getTransactionBlock({
        digest: DIGEST,
        options: { showEvents: true },
      }),
    ).rejects.toThrow(/has no effects/);
  });

  it("throws on an event node carrying no Move type", async () => {
    // `recover` matches the fully-qualified type exactly, so a typeless event matches nothing — which
    // would read as a settlement with no weld rather than as an endpoint whose shape moved.
    stubGraphql({
      data: {
        transaction: {
          effects: {
            status: "SUCCESS",
            events: {
              nodes: [
                { contents: { json: {} }, transaction: { digest: DIGEST } },
              ],
            },
          },
        },
      },
    });
    await expect(
      makeSuiGraphqlRpc(URL_).getTransactionBlock({
        digest: DIGEST,
        options: { showEvents: true },
      }),
    ).rejects.toThrow(/carried no contents.type.repr/);
  });

  it("throws on a payment_id that is not base64", async () => {
    stubGraphql({
      data: {
        transaction: {
          effects: {
            status: "SUCCESS",
            events: { nodes: [eventNode({ payment_id: "not base64 ~~~" })] },
          },
        },
      },
    });
    await expect(
      makeSuiGraphqlRpc(URL_).getTransactionBlock({
        digest: DIGEST,
        options: { showEvents: true },
      }),
    ).rejects.toThrow();
  });
});

describe("queryEvents — the page and its direction", () => {
  it("takes the NEWEST page for descending order and hands it back newest-first", async () => {
    // `last:` selects the newest page; it does NOT reverse it — both arms arrive oldest-first within the
    // page, measured against the live endpoint. Descending is therefore the page reversed.
    const oldest = eventNode();
    const newest = { ...eventNode(), transaction: { digest: "NEWEST" } };
    const calls = stubGraphql({
      data: { events: { nodes: [oldest, newest] } },
    });
    const res = await makeSuiGraphqlRpc(URL_).queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      limit: 50,
      order: "descending",
    });
    expect(calls[0]?.body.query).toContain("last: $limit");
    expect(calls[0]?.body.variables).toEqual({ type: EVENT_TYPE, limit: 50 });
    expect(res.data.map((e) => e.id?.txDigest)).toEqual([
      "NEWEST",
      "4M9xCDH5ug4KUUg6h2DACgCFkfxz2tJ54TgGkmvEoUEh",
    ]);
  });

  it("takes the OLDEST page for ascending order, unreversed", async () => {
    const calls = stubGraphql({ data: { events: { nodes: [] } } });
    await makeSuiGraphqlRpc(URL_).queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      order: "ascending",
    });
    expect(calls[0]?.body.query).toContain("first: $limit");
  });

  it("defaults to ascending when no order is named — the JSON-RPC method's own default", async () => {
    const calls = stubGraphql({ data: { events: { nodes: [] } } });
    await makeSuiGraphqlRpc(URL_).queryEvents({
      query: { MoveEventType: EVENT_TYPE },
    });
    expect(calls[0]?.body.query).toContain("first: $limit");
  });

  it("always names a page size — an unpaged connection would silently serve the OLDEST events", async () => {
    const calls = stubGraphql({ data: { events: { nodes: [] } } });
    await makeSuiGraphqlRpc(URL_).queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      order: "descending",
    });
    const variables = calls[0]?.body.variables as
      | { limit?: number }
      | undefined;
    expect(variables?.limit).toBe(20);
  });

  it("pins the default page size to the endpoint's own defaultPageSize for Query.events", () => {
    expect(SUI_GRAPHQL_DEFAULT_EVENT_PAGE).toBe(20);
  });

  it("decodes every node's payment_id, not only the first", async () => {
    stubGraphql({ data: { events: { nodes: [eventNode(), eventNode()] } } });
    const views = await makeSuiReader(makeSuiGraphqlRpc(URL_)).querySettled(
      EVENT_TYPE,
      2,
    );
    expect(views).toHaveLength(2);
    for (const v of views) expect(v.paymentId).toHaveLength(32);
  });
});

describe("the transport fails LOUD", () => {
  it("throws on a non-2xx, naming the status and the body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
      json: async () => ({}),
    }));
    await expect(
      makeSuiGraphqlRpc(URL_).queryEvents({
        query: { MoveEventType: EVENT_TYPE },
      }),
    ).rejects.toThrow(/Sui GraphQL HTTP 502: bad gateway/);
  });

  it("an unreadable error body yields an EMPTY body, not the string 'undefined'", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("stream closed");
      },
      json: async () => ({}),
    }));
    await expect(
      makeSuiGraphqlRpc(URL_).queryEvents({
        query: { MoveEventType: EVENT_TYPE },
      }),
    ).rejects.toThrow(/HTTP 500: $/);
  });

  it("throws on a GraphQL errors[] inside a 200 — how this endpoint refuses a query", async () => {
    // Measured verbatim against the live endpoint: an over-large page answers HTTP 200 with
    // `{"data": null, "errors": [{"message": "Page size is too large: 5000 > 50"}]}`. Reading `data`
    // without checking `errors` would turn that into an empty result set.
    stubGraphql({
      data: null,
      errors: [{ message: "Page size is too large: 5000 > 50" }],
    });
    await expect(
      makeSuiGraphqlRpc(URL_).queryEvents({
        query: { MoveEventType: EVENT_TYPE },
      }),
    ).rejects.toThrow(/Page size is too large: 5000 > 50/);
  });

  it("joins EVERY error, not just the first — a partial report hides the cause", async () => {
    stubGraphql({
      data: null,
      errors: [{ message: "first" }, { message: "second" }],
    });
    await expect(
      makeSuiGraphqlRpc(URL_).queryEvents({
        query: { MoveEventType: EVENT_TYPE },
      }),
    ).rejects.toThrow(/first; second/);
  });

  it("names a message-less error rather than printing 'undefined'", async () => {
    stubGraphql({ data: null, errors: [{}] });
    await expect(
      makeSuiGraphqlRpc(URL_).queryEvents({
        query: { MoveEventType: EVENT_TYPE },
      }),
    ).rejects.toThrow(/\(no message\)/);
  });

  it("throws on a 200 carrying neither data nor errors", async () => {
    stubGraphql({});
    await expect(
      makeSuiGraphqlRpc(URL_).queryEvents({
        query: { MoveEventType: EVENT_TYPE },
      }),
    ).rejects.toThrow(/returned no data/);
  });

  it("an EMPTY errors[] is not an error — the data still stands", async () => {
    stubGraphql({ data: { events: { nodes: [] } }, errors: [] });
    await expect(
      makeSuiGraphqlRpc(URL_).queryEvents({
        query: { MoveEventType: EVENT_TYPE },
      }),
    ).resolves.toEqual({ data: [] });
  });
});
