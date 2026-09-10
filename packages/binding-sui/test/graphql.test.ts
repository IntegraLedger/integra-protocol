/**
 * The GraphQL transport under the one reader — Sui's public JSON-RPC is deprecated and answers `-32601`
 * to every method, so this is the read path that still works, bound to the same `SuiRpcLike` port.
 *
 * ⭐ THE FIXTURES ARE REAL. Every digest, event type, `payment_id`, page size and TYPE LAYOUT below was read
 * off Sui testnet through `https://graphql.testnet.sui.io/graphql` on 2026-09-10, so the shape these tests
 * assert against is the shape the endpoint actually serves rather than one invented here — including the
 * detail the whole file exists for: GraphQL renders a Move `vector<u8>` as a base64 STRING where JSON-RPC
 * renders it as a JSON array of byte values. `reader.test.ts` pins the consequence of getting that wrong
 * from the other side: a `payment_id` that is not an array yields `paymentId: undefined`, which is a
 * refusal rather than an error, so a live weld would read as never-anchored with nothing going red.
 *
 * ⛔ THE THREE DEFECTS THIS FILE NOW OWNS, each live in published 0.17.0 and each a silent wrong answer
 * rather than a failure:
 *
 *   • **A co-located untrusted event killed the read.** `payment_id` was decoded by NAME on every node,
 *     so one buyer-composed event carrying a Move `String` of that name threw `DOMException: Invalid
 *     character` out of `recover`. The endpoint's own type layout says which fields are `vector<u8>`;
 *     that is what is consulted now, and "decodes an untrusted string field" is the test that proves it.
 *   • **`effects.events` was read UNPAGED**, so a transaction emitting more than 20 events answered with
 *     the oldest 20 and the weld could be buried behind filler the buyer chose. Both connection walks are
 *     paged to exhaustion here.
 *   • **A nullable field the query SELECTS became a refusal instead of a throw** — `effects.events`,
 *     `contents`, `contents.json` and `transaction.digest` each silently produced "no weld". Every one of
 *     them has a throw and a test below.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSuiAdapter } from "../src/adapter.js";
import { pay402SettledEventType } from "../src/constants.js";
import {
  makeSuiGraphqlRpc,
  SUI_GRAPHQL_DEFAULT_EVENT_PAGE,
  SUI_GRAPHQL_TIMEOUT_MS,
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
/** The atrHash {@link PAYMENT_ID_B64} carries, written out rather than re-derived from the base64. */
const ATR_HASH =
  "0x4b922b1b139af7720f888acddf4407ac467932be4309679317f850cfa2fa28e6";
/** The live `coin_type` for {@link DIGEST} — the SECOND `vector<u8>` on this struct, also base64. */
const COIN_TYPE_B64 =
  "YTFlYzdmYzAwYTZmNDBkYjk2OTNhZDE0MTVkMGMxOTNhZDM5MDY0OTQ0MjhjZjI1MjYyMTAzN2JkNzExN2UyOTo6dXNkYzo6VVNEQw==";
const BUYER =
  "0xd817e5a1fde8a566bda2dcc53a9fe74e8cc7c31c90a774a84512a14e414bd5c1";

/**
 * `PaymentSettled`'s type layout, transcribed from the live endpoint. It is what says `payment_id` and
 * `coin_type` are bytes and `buyer`/`amount` are not — the discrimination this transport makes instead of
 * matching a field name.
 */
const LAYOUT = {
  struct: {
    type: EVENT_TYPE,
    fields: [
      { name: "payment_id", layout: { vector: "u8" } },
      { name: "buyer", layout: "address" },
      { name: "merchant", layout: "address" },
      { name: "facilitator", layout: "address" },
      { name: "amount", layout: "u64" },
      { name: "facilitator_fee", layout: "u64" },
      { name: "coin_type", layout: { vector: "u8" } },
      { name: "timestamp_ms", layout: "u64" },
    ],
  },
};

/** One event node in the shape both queries select it, with the live field set beside `payment_id`. */
function eventNode(
  overrides: Record<string, unknown> = {},
  digest: string = DIGEST,
) {
  return {
    contents: {
      type: { repr: EVENT_TYPE, layout: LAYOUT },
      json: {
        payment_id: PAYMENT_ID_B64,
        buyer: BUYER,
        merchant: BUYER,
        amount: "1",
        facilitator_fee: "0",
        coin_type: COIN_TYPE_B64,
        timestamp_ms: "1788841282382",
        ...overrides,
      },
    },
    transaction: { digest },
  };
}

/**
 * A co-located event from a package nobody trusts, carrying a `payment_id` that is a Move `String` rather
 * than a `vector<u8>` — the shape a buyer can put in the same PTB, and the one that used to throw.
 * Measured against the live endpoint: a `0x1::string::String` renders as the plain string and its layout
 * is a struct, never `{vector: "u8"}`.
 */
function untrustedNode(value: unknown = "order-1") {
  return {
    contents: {
      type: {
        repr: "0xbadbadbad::orders::OrderPlaced",
        layout: {
          struct: {
            type: "0xbadbadbad::orders::OrderPlaced",
            fields: [
              {
                name: "payment_id",
                layout: {
                  struct: {
                    type: "0x1::string::String",
                    fields: [{ name: "bytes", layout: { vector: "u8" } }],
                  },
                },
              },
            ],
          },
        },
      },
      json: { payment_id: value },
    },
    transaction: { digest: DIGEST },
  };
}

/** The fixture node with its type layout replaced — the endpoint's answer to "which fields are bytes". */
function nodeWithLayout(layout: unknown) {
  const node = eventNode();
  const type =
    layout === undefined ? { repr: EVENT_TYPE } : { repr: EVENT_TYPE, layout };
  return { ...node, contents: { ...node.contents, type } };
}

/** One page of an event connection, exhausted unless `more` says otherwise. */
function page(nodes: unknown[], more: Record<string, unknown> = {}) {
  return {
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
      ...more,
    },
    nodes,
  };
}

/** A `transaction(digest:)` envelope carrying one page of effects events. */
function txEnvelope(
  nodes: unknown[],
  more: Record<string, unknown> = {},
  status: unknown = "SUCCESS",
) {
  return {
    data: { transaction: { effects: { status, events: page(nodes, more) } } },
  };
}

/** A `Query.events` envelope carrying one page. */
function eventsEnvelope(nodes: unknown[], more: Record<string, unknown> = {}) {
  return { data: { events: page(nodes, more) } };
}

interface RecordedCall {
  url: string;
  init: RequestInit;
  body: { query: string; variables: Record<string, unknown> };
}

/**
 * Stub `fetch` with a QUEUE of envelopes — one per request, in order — and return the recorded calls.
 * A request past the end of the queue throws rather than replaying the last envelope: a walk that keeps
 * asking for pages is the failure these tests exist to catch, and repeating an answer would hide it.
 */
function stubGraphql(...envelopes: unknown[]): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const envelope = envelopes[calls.length];
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    if (envelope === undefined)
      throw new Error(
        `the transport made request ${calls.length} with only ${envelopes.length} envelope(s) stubbed`,
      );
    return { ok: true, status: 200, json: async () => envelope } as Response;
  });
  return calls;
}

/** The port under test, bound to the fixture endpoint. */
function rpc() {
  return makeSuiGraphqlRpc(URL_);
}

/** `getTransactionBlock` for the fixture digest — the call every guard test below makes. */
async function readTx() {
  return rpc().getTransactionBlock({
    digest: DIGEST,
    options: { showEvents: true },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeSuiGraphqlRpc — construction", () => {
  it("refuses an empty url rather than POSTing to a relative path on the first read", () => {
    expect(() => makeSuiGraphqlRpc("")).toThrow(/url is empty/);
  });
});

describe("the request this transport issues", () => {
  it("asks the endpoint for the digest it was given, at a named page size", async () => {
    const calls = stubGraphql(txEnvelope([]));
    await readTx();
    expect(calls[0]?.url).toBe("https://graphql.testnet.sui.io/graphql");
    expect(calls[0]?.body.variables).toEqual({
      digest: DIGEST,
      first: 50,
      after: null,
    });
  });

  /**
   * ⛔ THE SELECTION IS THE CONTRACT WITH THE ENDPOINT, and nothing used to hold it. Every field this
   * transport reads is one it asked for, so a selection that quietly loses `transaction { digest }` or
   * `layout` does not fail — it changes what the reader can answer, one layer up, in silence.
   */
  it("SELECTS every field it goes on to read, on both queries", async () => {
    const calls = stubGraphql(txEnvelope([]), eventsEnvelope([]));
    await readTx();
    await rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } });
    for (const call of calls) {
      const { query } = call.body;
      expect(query).toContain("contents { type { repr layout } json }");
      expect(query).toContain("transaction { digest }");
      expect(query).toContain(
        "pageInfo { hasNextPage hasPreviousPage startCursor endCursor }",
      );
    }
    expect(calls[0]?.body.query).toContain("status");
    expect(calls[0]?.body.query).toContain(
      "events(first: $first, after: $after)",
    );
    expect(calls[1]?.body.query).toContain("filter: { type: $type }");
  });

  it("POSTs JSON under a deadline, so a hung endpoint cannot hang recover forever", async () => {
    const calls = stubGraphql(txEnvelope([]));
    await readTx();
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    // The signal is present and live at the moment of the call — a request issued without one waits
    // forever, and one issued already-aborted would never reach the endpoint at all.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });

  it("pins the request deadline above the endpoint's own 40s query timeout", () => {
    expect(SUI_GRAPHQL_TIMEOUT_MS).toBe(60_000);
  });
});

describe("getTransactionBlock — reading a Move value", () => {
  /**
   * ⛔⛔ THE DEFECT THIS TRANSPORT EXISTS TO NOT HAVE. A wrapper that handed `contents.json` straight
   * through would put the base64 STRING where `parseSuiEvents` expects bytes; the view's `paymentId` would
   * be `undefined`, `recover` would answer `sui/no-payment-id`, and a real settlement would report as
   * carrying no weld. So the assertion is the WHOLE PATH — endpoint bytes to atrHash — not the decoder
   * alone, and the expected hash is written out rather than re-derived from the base64 the code decodes.
   */
  it("decodes a base64 payment_id all the way back to the atrHash", async () => {
    stubGraphql(txEnvelope([eventNode()]));
    const recovered = await createSuiAdapter(SUI_MANIFEST).recover(
      { digest: DIGEST, packageId: PKG },
      makeSuiReader(rpc()),
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered))
      expect(recovered.value).toBe(
        "0x4b922b1b139af7720f888acddf4407ac467932be4309679317f850cfa2fa28e6",
      );
  });

  /**
   * ⛔ `coin_type` IS BYTES TOO, and leaving it base64 made one field of one EXPORTED type
   * (`RawSuiEvent.parsedJson`) mean different things over the two transports. The expected text is spelled
   * out rather than decoded from the fixture here.
   */
  it("decodes EVERY vector<u8> the layout names, not only payment_id", async () => {
    stubGraphql(txEnvelope([eventNode()]));
    const res = await readTx();
    const parsed = res.events?.[0]?.parsedJson as { coin_type: number[] };
    expect(Array.isArray(parsed.coin_type)).toBe(true);
    expect(String.fromCharCode(...parsed.coin_type)).toBe(
      "a1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
    );
  });

  it("leaves every field the layout does NOT call bytes exactly as served", async () => {
    // A blanket "any string might be bytes" rewrite would turn the buyer address and the amount into byte
    // arrays, and nothing downstream reads them to notice.
    stubGraphql(txEnvelope([eventNode()]));
    const res = await readTx();
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

  /**
   * ⛔⛔⛔ THE BUYER-COMPOSED PTB. `recover` matches the fully-qualified type exactly BECAUSE a Sui PTB can
   * compose calls from arbitrary packages — and 0.17.0 decoded every node's `payment_id` before that filter
   * ran, so a co-located event carrying a Move `String` named `payment_id` threw `DOMException: Invalid
   * character` and took the whole recovery with it. The counterparty who builds and signs the transaction
   * could therefore deny recovery of a settlement that is on chain, signed, and correct.
   */
  it("does not decode a payment_id the layout calls a String — a buyer cannot break the read", async () => {
    stubGraphql(txEnvelope([untrustedNode(), eventNode()]));
    const recovered = await createSuiAdapter(SUI_MANIFEST).recover(
      { digest: DIGEST, packageId: PKG },
      makeSuiReader(rpc()),
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered)) expect(recovered.value).toBe(ATR_HASH);
  });

  it("hands the untrusted event's own payment_id back exactly as served", async () => {
    // Not merely "does not throw": a base64-SHAPED name like "abcd" used to decode to three garbage bytes
    // inside an exported type, which is the same defect answering quietly.
    stubGraphql(txEnvelope([untrustedNode("abcd")]));
    const parsed = (await readTx()).events?.[0]?.parsedJson as {
      payment_id: unknown;
    };
    expect(parsed.payment_id).toBe("abcd");
  });

  it("converts nothing when the layout is not a struct — it has no named fields to convert", async () => {
    stubGraphql(txEnvelope([nodeWithLayout("u64")]));
    const parsed = (await readTx()).events?.[0]?.parsedJson as {
      payment_id: unknown;
    };
    expect(parsed.payment_id).toBe(PAYMENT_ID_B64);
  });

  it("returns a SCALAR Move value exactly as served, rather than spreading it into an object", async () => {
    // `{..."1788841282382"}` is an object keyed by character index. A value with no named fields must
    // come back as the value, not as its own spelling taken apart.
    const node = nodeWithLayout("u64");
    stubGraphql(
      txEnvelope([
        { ...node, contents: { ...node.contents, json: "1788841282382" } },
      ]),
    );
    expect((await readTx()).events?.[0]?.parsedJson).toBe("1788841282382");
  });

  it("returns an ARRAY Move value exactly as served, rather than spreading it into an object", async () => {
    const node = nodeWithLayout({ vector: "u8" });
    stubGraphql(
      txEnvelope([
        { ...node, contents: { ...node.contents, json: [1, 2, 3] } },
      ]),
    );
    expect((await readTx()).events?.[0]?.parsedJson).toEqual([1, 2, 3]);
  });

  it("skips a layout field with no usable name or no layout of its own", async () => {
    // A field entry the endpoint renders without a string `name`, or with a null `layout`, is not a
    // byte field this transport can act on — and it must not take the fields beside it down with it.
    stubGraphql(
      txEnvelope([
        nodeWithLayout({
          struct: {
            type: EVENT_TYPE,
            fields: [
              { name: 42, layout: { vector: "u8" } },
              { name: "unknown_shape", layout: null },
              { name: "payment_id", layout: { vector: "u8" } },
            ],
          },
        }),
      ]),
    );
    const parsed = (await readTx()).events?.[0]?.parsedJson as {
      payment_id: number[];
    };
    expect(parsed.payment_id).toHaveLength(32);
  });

  it("throws when the layout is ABSENT — which of its fields are bytes is then unanswered", async () => {
    const node = eventNode();
    stubGraphql(
      txEnvelope([
        { ...node, contents: { ...node.contents, type: { repr: EVENT_TYPE } } },
      ]),
    );
    await expect(readTx()).rejects.toThrow(
      "carried no contents.type.layout, so which of its fields are vector<u8> — the ones GraphQL renders base64 — is unanswered",
    );
  });

  it("throws when the layout is explicitly NULL, not merely missing", async () => {
    stubGraphql(txEnvelope([nodeWithLayout(null)]));
    await expect(readTx()).rejects.toThrow("carried no contents.type.layout");
  });

  it("throws on a value the layout calls vector<u8> that is not base64, naming the field", async () => {
    stubGraphql(txEnvelope([eventNode({ payment_id: "not base64 ~~~" })]));
    await expect(readTx()).rejects.toThrow(
      'the endpoint\'s type layout declares "payment_id" a vector<u8>, which GraphQL renders as a base64 string, but the value it served for that field is not base64',
    );
  });

  it("keeps the decoder's own fault as the cause of that refusal", async () => {
    // The message says which field and why; the `cause` is what a reader needs to see that `atob` is
    // where it came from. Dropping it leaves a sentence with no evidence under it.
    stubGraphql(txEnvelope([eventNode({ payment_id: "not base64 ~~~" })]));
    await expect(readTx()).rejects.toThrow(
      expect.objectContaining({ cause: expect.any(Error) }),
    );
  });

  it("throws on a value the layout calls vector<u8> that is not even a string", async () => {
    stubGraphql(txEnvelope([eventNode({ coin_type: 42 })]));
    await expect(readTx()).rejects.toThrow(
      'the endpoint\'s type layout declares "coin_type" a vector<u8>, which GraphQL renders as a base64 string, but the value it served for that field is number',
    );
  });

  it("names a null where a vector<u8> was promised, rather than printing 'object'", async () => {
    stubGraphql(txEnvelope([eventNode({ coin_type: null })]));
    await expect(readTx()).rejects.toThrow(
      "the value it served for that field is null",
    );
  });

  it("carries the emitting transaction's digest through as the port's id.txDigest", async () => {
    stubGraphql(txEnvelope([eventNode()]));
    const res = await readTx();
    expect(res.events?.[0]?.id?.txDigest).toBe(
      "4M9xCDH5ug4KUUg6h2DACgCFkfxz2tJ54TgGkmvEoUEh",
    );
  });
});

describe("getTransactionBlock — every nullable field the query selects", () => {
  /** Each throw names the port call it broke, so a transport fault says which read it was. */
  it("names the read in the message, not just the fault", async () => {
    stubGraphql(
      txEnvelope([{ contents: null, transaction: { digest: DIGEST } }]),
    );
    await expect(readTx()).rejects.toThrow(
      "getTransactionBlock(4M9xCDH5ug4KUUg6h2DACgCFkfxz2tJ54TgGkmvEoUEh)",
    );
  });

  it("throws on an event node with no contents at all", async () => {
    stubGraphql(
      txEnvelope([{ contents: null, transaction: { digest: DIGEST } }]),
    );
    await expect(readTx()).rejects.toThrow("carried no contents");
  });

  it("throws on an event node that OMITS contents rather than nulling it", async () => {
    stubGraphql(txEnvelope([{ transaction: { digest: DIGEST } }]));
    await expect(readTx()).rejects.toThrow("carried no contents");
  });

  it("throws on an event node with no contents.type", async () => {
    stubGraphql(
      txEnvelope([
        { contents: { type: null, json: {} }, transaction: { digest: DIGEST } },
      ]),
    );
    await expect(readTx()).rejects.toThrow("carried no contents.type");
  });

  it("throws on an event node that OMITS contents.type rather than nulling it", async () => {
    stubGraphql(
      txEnvelope([{ contents: { json: {} }, transaction: { digest: DIGEST } }]),
    );
    await expect(readTx()).rejects.toThrow("carried no contents.type");
  });

  it("throws on an event node carrying no Move type", async () => {
    // `recover` matches the fully-qualified type exactly, so a typeless event matches nothing — which
    // would read as a settlement with no weld rather than as an endpoint whose shape moved.
    stubGraphql(
      txEnvelope([
        { contents: { type: {}, json: {} }, transaction: { digest: DIGEST } },
      ]),
    );
    await expect(readTx()).rejects.toThrow("carried no contents.type.repr");
  });

  /**
   * ⛔⛔ `Event.transaction` IS NULLABLE and used to be handled ASYMMETRICALLY with `contents.type.repr`:
   * a typeless node threw, a digest-less node was silently emitted without `id.txDigest`, and `enumerate`
   * then dropped it. Two nullable fields of one selection, one loud and one silent.
   */
  it("throws on an event node with no emitting transaction, rather than dropping its digest", async () => {
    const node = eventNode();
    stubGraphql(txEnvelope([{ ...node, transaction: null }]));
    await expect(readTx()).rejects.toThrow(
      "event node carried no transaction.digest, so the settlement it proves could not be referenced",
    );
  });

  it("throws on an event node whose contents.json is null", async () => {
    const node = eventNode();
    stubGraphql(
      txEnvelope([{ ...node, contents: { ...node.contents, json: null } }]),
    );
    await expect(readTx()).rejects.toThrow(
      "event node carried no contents.json, so its payment_id could not be read",
    );
  });

  it("throws on an event node that OMITS contents.json rather than nulling it", async () => {
    const node = eventNode();
    stubGraphql(
      txEnvelope([
        {
          ...node,
          contents: { type: { repr: EVENT_TYPE, layout: LAYOUT } },
        },
      ]),
    );
    await expect(readTx()).rejects.toThrow("carried no contents.json");
  });

  it("THROWS on a digest the endpoint does not know, rather than reading it as no events", async () => {
    // The JSON-RPC method this stands in for throws. "This transaction does not exist" must never reach
    // `recover` as "it exists and carries no weld" — those are different answers to a verifier.
    stubGraphql({ data: { transaction: null } });
    await expect(readTx()).rejects.toThrow("Sui GraphQL: no transaction");
  });

  it("THROWS when the endpoint omits the transaction field entirely", async () => {
    stubGraphql({ data: {} });
    await expect(readTx()).rejects.toThrow("Sui GraphQL: no transaction");
  });

  it("throws when a known transaction carries a null effects", async () => {
    stubGraphql({ data: { transaction: { effects: null } } });
    await expect(readTx()).rejects.toThrow("the transaction has no effects");
  });

  it("throws when a known transaction omits effects entirely", async () => {
    stubGraphql({ data: { transaction: {} } });
    await expect(readTx()).rejects.toThrow("the transaction has no effects");
  });

  it("throws when the effects report a null execution status", async () => {
    // An absent status is an unanswered question, not a failed transaction. Reading it as a failure would
    // hand back no events, and `recover` would refuse — a real weld reported as never-anchored.
    stubGraphql(txEnvelope([eventNode()], {}, null));
    await expect(readTx()).rejects.toThrow("reports no execution status");
  });

  it("throws when the effects omit the execution status entirely", async () => {
    stubGraphql({
      data: { transaction: { effects: { events: page([eventNode()]) } } },
    });
    await expect(readTx()).rejects.toThrow("reports no execution status");
  });

  it("yields NO events for a FAILURE, the explicit gate the JSON-RPC path gets structurally", async () => {
    // Sui discards every effect of an aborted PTB, including its events, and `adapter.ts` relies on that
    // instead of carrying a success field. `reader.ts` requires any other source to gate explicitly, and
    // GraphQL publishes the status, so it is read rather than assumed.
    stubGraphql(txEnvelope([eventNode()], {}, "FAILURE"));
    expect((await readTx()).events).toEqual([]);
  });

  /**
   * ⛔ THE COMMENT AND THE CODE USED TO DISAGREE. `ExecutionStatus` has exactly two values, and the file
   * said anything else was "a shape that moved" while `status !== "SUCCESS"` quietly returned `{events:
   * []}` for every one of them — a third value would have read as an aborted transaction.
   */
  it("throws on an execution status that is neither of the enum's two values", async () => {
    stubGraphql(txEnvelope([eventNode()], {}, "PENDING"));
    await expect(readTx()).rejects.toThrow(
      'reports execution status "PENDING", which is neither SUCCESS nor FAILURE',
    );
  });

  /**
   * ⛔⛔ `TransactionEffects.events` IS NULLABLE, exactly as `status` is, and the guard chain stopped one
   * field short of it: `effects.events?.nodes ?? []` turned "the endpoint could not serve this
   * transaction's events" into "this transaction emitted none", so a real weld read as never-anchored.
   */
  it("throws when a SUCCESS carries a null events connection", async () => {
    stubGraphql({
      data: { transaction: { effects: { status: "SUCCESS", events: null } } },
    });
    await expect(readTx()).rejects.toThrow(
      "succeeded but the endpoint served no events connection, which is not the same as a transaction that emitted none",
    );
  });

  it("throws when a SUCCESS omits the events connection entirely", async () => {
    stubGraphql({
      data: { transaction: { effects: { status: "SUCCESS" } } },
    });
    await expect(readTx()).rejects.toThrow(
      "succeeded but the endpoint served no events connection",
    );
  });
});

describe("getTransactionBlock — the effects.events connection is PAGED", () => {
  /**
   * ⛔⛔⛔ THE WELD CAN SIT PAST THE FIRST PAGE, AND 0.17.0 NEVER LOOKED. `TransactionEffects.events` is a
   * connection whose `defaultPageSize` is 20 and whose `maxPageSize` is 50 (both measured off
   * `serviceConfig`), and the query named neither — so a transaction emitting more than 20 events answered
   * with the OLDEST 20. Measured on live testnet digest `9ieBL7opCRsyEySsUFtDNdUCQZJjAvbZMWrzrRfVbZfR`,
   * which emits 21 events: unpaged returned 20 with `hasNextPage: true`; `first: 50` returned all 21.
   * Sui's protocol allows 1024 events per transaction and the BUYER composes the PTB, so the weld could be
   * buried behind filler and `recover` would answer `sui/no-payment-id` for a valid settlement.
   */
  it("walks past the first page to find a weld the buyer buried behind other events", async () => {
    stubGraphql(
      txEnvelope([untrustedNode(), untrustedNode()], {
        hasNextPage: true,
        endCursor: "MjA=",
      }),
      txEnvelope([eventNode()]),
    );
    const recovered = await createSuiAdapter(SUI_MANIFEST).recover(
      { digest: DIGEST, packageId: PKG },
      makeSuiReader(rpc()),
    );
    expect("refused" in recovered).toBe(false);
    if (!("refused" in recovered)) expect(recovered.value).toBe(ATR_HASH);
  });

  it("carries the cursor forward, so the second request asks for what follows the first", async () => {
    const calls = stubGraphql(
      txEnvelope([], { hasNextPage: true, endCursor: "MjA=" }),
      txEnvelope([eventNode()]),
    );
    await readTx();
    expect(calls[0]?.body.variables["after"]).toBe(null);
    expect(calls[1]?.body.variables["after"]).toBe("MjA=");
  });

  it("throws when the endpoint claims another page and hands no cursor to reach it", async () => {
    stubGraphql(txEnvelope([], { hasNextPage: true, endCursor: null }));
    await expect(readTx()).rejects.toThrow(
      "reports another page of events but returned no cursor that advances past the one already read, so the answer cannot be completed",
    );
  });

  it("throws when a LATER page nulls its cursor, not only the first", async () => {
    // The first page's cursor is null AND equal to the null it started from, so one test cannot tell the
    // "no cursor" arm from the "did not advance" arm. Here the walk has a real cursor behind it.
    stubGraphql(
      txEnvelope([], { hasNextPage: true, endCursor: "a" }),
      txEnvelope([], { hasNextPage: true, endCursor: null }),
    );
    await expect(readTx()).rejects.toThrow(
      "no cursor that advances past the one already read",
    );
  });

  it("throws when a later page OMITS its cursor rather than nulling it", async () => {
    stubGraphql(txEnvelope([], { hasNextPage: true, endCursor: "a" }), {
      data: {
        transaction: {
          effects: {
            status: "SUCCESS",
            events: {
              pageInfo: { hasNextPage: true, hasPreviousPage: false },
              nodes: [],
            },
          },
        },
      },
    });
    await expect(readTx()).rejects.toThrow(
      "no cursor that advances past the one already read",
    );
  });

  it("throws when the cursor does not ADVANCE — the one shape that never terminates", async () => {
    stubGraphql(
      txEnvelope([], { hasNextPage: true, endCursor: "MjA=" }),
      txEnvelope([], { hasNextPage: true, endCursor: "MjA=" }),
    );
    await expect(readTx()).rejects.toThrow(
      "no cursor that advances past the one already read",
    );
  });

  it("refuses an endpoint that pages further than Sui can emit events", async () => {
    // EXACTLY the cap's worth of pages is stubbed, so a bound that is one page loose asks for a page that
    // is not there — an off-by-one on a walk's ceiling is otherwise invisible.
    const forever = Array.from({ length: 64 }, (_, i) =>
      txEnvelope([], { hasNextPage: true, endCursor: `c${i}` }),
    );
    stubGraphql(...forever);
    await expect(readTx()).rejects.toThrow(
      "still paging events after 64 pages of 50",
    );
  });
});

describe("queryEvents — the page and its direction", () => {
  it("takes the NEWEST page for descending order and hands it back newest-first", async () => {
    // `last:` selects the newest page; it does NOT reverse it — both arms arrive oldest-first within the
    // page, measured against the live endpoint. Descending is therefore the page reversed.
    const calls = stubGraphql(
      eventsEnvelope([eventNode({}, "OLDEST"), eventNode({}, "NEWEST")]),
    );
    const res = await rpc().queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      limit: 50,
      order: "descending",
    });
    expect(calls[0]?.body.query).toContain("last: $limit");
    expect(calls[0]?.body.query).toContain("before: $cursor");
    expect(calls[0]?.body.variables).toEqual({
      type: EVENT_TYPE,
      limit: 50,
      cursor: null,
    });
    expect(res.data.map((e) => e.id?.txDigest)).toEqual(["NEWEST", "OLDEST"]);
  });

  it("takes the OLDEST page for ascending order, unreversed", async () => {
    const calls = stubGraphql(
      eventsEnvelope([eventNode({}, "OLDEST"), eventNode({}, "NEWEST")]),
    );
    const res = await rpc().queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      order: "ascending",
    });
    expect(calls[0]?.body.query).toContain("first: $limit");
    expect(calls[0]?.body.query).toContain("after: $cursor");
    expect(res.data.map((e) => e.id?.txDigest)).toEqual(["OLDEST", "NEWEST"]);
  });

  it("defaults to ascending when no order is named — the JSON-RPC method's own default", async () => {
    const calls = stubGraphql(eventsEnvelope([]));
    await rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } });
    expect(calls[0]?.body.query).toContain("first: $limit");
  });

  /**
   * ⛔ THE DEFAULT USED TO HALVE THE SCAN. It was the endpoint's `defaultPageSize` of 20 where its
   * `maxPageSize` is 50. Driven live on 2026-09-10 against `<pkg>::payment::PaymentSettled` on testnet:
   * 33 settlements exist and 16 carry one particular atrHash — `enumerate` defaulted found 10, `limit: 50`
   * found 16. Six real settlements invisible, and a missed hit on a best-effort scan is an empty array.
   */
  it("defaults to the DEEPEST page the endpoint will serve, not its default page", async () => {
    const calls = stubGraphql(eventsEnvelope([]));
    await rpc().queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      order: "descending",
    });
    expect(calls[0]?.body.variables["limit"]).toBe(50);
  });

  it("pins the default page size to the endpoint's own maxPageSize for Query.events", () => {
    expect(SUI_GRAPHQL_DEFAULT_EVENT_PAGE).toBe(50);
  });

  /**
   * ⛔ A `limit` LARGER THAN ONE PAGE USED TO BE A HARD ERROR. The endpoint refuses `Page size is too
   * large: 51 > 50`, so `enumerate(atr, type, reader, 100)` — an entirely reasonable deeper scan — failed
   * with the wire's own validation message. `limit` means scan depth on this port; it is paged now.
   */
  it("pages a limit deeper than one page, asking for the remainder on the last request", async () => {
    const calls = stubGraphql(
      eventsEnvelope(
        Array.from({ length: 50 }, (_, i) => eventNode({}, `p0-${i}`)),
        { hasNextPage: true, endCursor: "a" },
      ),
      eventsEnvelope(
        Array.from({ length: 50 }, (_, i) => eventNode({}, `p1-${i}`)),
        { hasNextPage: true, endCursor: "b" },
      ),
      eventsEnvelope(
        Array.from({ length: 20 }, (_, i) => eventNode({}, `p2-${i}`)),
      ),
    );
    const res = await rpc().queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      limit: 120,
      order: "ascending",
    });
    expect(calls.map((c) => c.body.variables["limit"])).toEqual([50, 50, 20]);
    expect(calls.map((c) => c.body.variables["cursor"])).toEqual([
      null,
      "a",
      "b",
    ]);
    expect(res.data).toHaveLength(120);
    // ⭐ THE PAGES KEEP THEIR ORDER. Ascending walks FORWARD, so each page follows the one before it —
    // accumulating them the descending way would hand back a run that reads newest-first inside a scan
    // the caller asked to read oldest-first, and a length assertion cannot see that.
    expect(res.data.map((e) => e.id?.txDigest).slice(0, 2)).toEqual([
      "p0-0",
      "p0-1",
    ]);
    expect(res.data[119]?.id?.txDigest).toBe("p2-19");
  });

  it("walks descending pages BACKWARDS and still answers newest-first across them", async () => {
    // Each page arrives oldest-first within itself, and `before:` steps to the page OLDER than the one
    // just read — so page two belongs in front of page one, and the whole run reverses once.
    const calls = stubGraphql(
      eventsEnvelope([eventNode({}, "C"), eventNode({}, "D")], {
        hasPreviousPage: true,
        startCursor: "s1",
      }),
      eventsEnvelope([eventNode({}, "A"), eventNode({}, "B")]),
    );
    const res = await rpc().queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      limit: 4,
      order: "descending",
    });
    expect(calls.map((c) => c.body.variables["cursor"])).toEqual([null, "s1"]);
    expect(res.data.map((e) => e.id?.txDigest)).toEqual(["D", "C", "B", "A"]);
  });

  it("stops at the caller's limit rather than draining the whole history", async () => {
    const calls = stubGraphql(
      eventsEnvelope([eventNode({}, "A"), eventNode({}, "B")], {
        hasNextPage: true,
        endCursor: "a",
      }),
    );
    const res = await rpc().queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      limit: 2,
      order: "ascending",
    });
    expect(calls).toHaveLength(1);
    expect(res.data).toHaveLength(2);
  });

  it("accepts a limit of exactly ONE — the smallest scan a caller can ask for", async () => {
    const calls = stubGraphql(eventsEnvelope([eventNode()]));
    const res = await rpc().queryEvents({
      query: { MoveEventType: EVENT_TYPE },
      limit: 1,
    });
    expect(calls[0]?.body.variables["limit"]).toBe(1);
    expect(res.data).toHaveLength(1);
  });

  it("refuses a limit that is not a positive whole number, rather than scanning nothing", async () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      stubGraphql();
      await expect(
        rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE }, limit }),
      ).rejects.toThrow("limit must be a positive integer");
      vi.unstubAllGlobals();
    }
  });

  /** ⛔ `Query.events` is nullable too — dereferencing it produced a bare TypeError naming no read. */
  it("throws when the endpoint serves no events connection at all", async () => {
    stubGraphql({ data: { events: null } });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow(
      "the endpoint served no events connection, which is not the same as an event type with no settlements",
    );
  });

  it("throws when the endpoint omits the events connection entirely", async () => {
    stubGraphql({ data: {} });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow("the endpoint served no events connection");
  });

  it("throws when a scan claims another page and hands no cursor to reach it", async () => {
    stubGraphql(
      eventsEnvelope([eventNode()], { hasNextPage: true, endCursor: null }),
    );
    await expect(
      rpc().queryEvents({
        query: { MoveEventType: EVENT_TYPE },
        limit: 5,
        order: "ascending",
      }),
    ).rejects.toThrow("no cursor that advances past the one already read");
  });

  it("refuses a scan the endpoint pages further than this transport will walk", async () => {
    // Exactly the cap's worth of pages, for the same reason as the transaction walk above.
    const forever = Array.from({ length: 64 }, (_, i) =>
      eventsEnvelope([], { hasNextPage: true, endCursor: `c${i}` }),
    );
    stubGraphql(...forever);
    await expect(
      rpc().queryEvents({
        query: { MoveEventType: EVENT_TYPE },
        limit: 5000,
        order: "ascending",
      }),
    ).rejects.toThrow(
      "still paging after 64 pages of 50 and the scan of 5000 is not satisfied, so the depth this answer represents is unknown",
    );
  });

  it("names the scanned event type in its refusals", async () => {
    stubGraphql({ data: { events: null } });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow(`queryEvents(${EVENT_TYPE})`);
  });

  it("decodes every node's payment_id, not only the first", async () => {
    stubGraphql(eventsEnvelope([eventNode(), eventNode()]));
    const views = await makeSuiReader(rpc()).querySettled(EVENT_TYPE, 2);
    expect(views).toHaveLength(2);
    for (const v of views) expect(v.paymentId).toHaveLength(32);
  });
});

describe("the transport fails LOUD", () => {
  it("throws on a non-2xx, naming the read, the status and the body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 502,
      text: async () => "bad gateway",
      json: async () => ({}),
    }));
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow(
      `queryEvents(${EVENT_TYPE}): Sui GraphQL HTTP 502: bad gateway`,
    );
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
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow(/HTTP 500: $/);
  });

  /**
   * ⛔ A REQUEST THAT NEVER COMPLETES is the failure `fetch` has no opinion about. Nothing above this file
   * watches a clock, so an endpoint that accepts a connection and never answers hung `recover` for good.
   * The rejection a deadline produces is a bare `TimeoutError` naming no read, so it is re-thrown with the
   * operation and the deadline on it.
   */
  it("rethrows a request that never completed, naming the read and the deadline", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    });
    await expect(readTx()).rejects.toThrow(
      `getTransactionBlock(${DIGEST}): Sui GraphQL request to ${URL_} did not complete within 60000ms`,
    );
  });

  it("keeps the underlying transport fault as the cause", async () => {
    const fault = new DOMException("aborted", "TimeoutError");
    vi.stubGlobal("fetch", async () => {
      throw fault;
    });
    await expect(readTx()).rejects.toThrow(
      expect.objectContaining({ cause: fault }),
    );
  });

  it("throws on a GraphQL errors[] inside a 200 — how this endpoint refuses a query", async () => {
    // Measured verbatim against the live endpoint: an over-large page answers HTTP 200 with
    // `{"data": null, "errors": [{"message": "Page size is too large: 51 > 50"}]}`. Reading `data`
    // without checking `errors` would turn that into an empty result set.
    stubGraphql({
      data: null,
      errors: [{ message: "Page size is too large: 51 > 50" }],
    });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow("Page size is too large: 51 > 50");
  });

  it("joins EVERY error, not just the first — a partial report hides the cause", async () => {
    stubGraphql({
      data: null,
      errors: [{ message: "first" }, { message: "second" }],
    });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow("first; second");
  });

  it("names a message-less error rather than printing 'undefined'", async () => {
    stubGraphql({ data: null, errors: [{}] });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow("(no message)");
  });

  it("throws on a 200 carrying neither data nor errors", async () => {
    stubGraphql({});
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow("Sui GraphQL returned no data");
  });

  it("throws on a 200 whose data is explicitly null and carries no errors", async () => {
    stubGraphql({ data: null });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).rejects.toThrow("Sui GraphQL returned no data");
  });

  it("an EMPTY errors[] is not an error — the data still stands", async () => {
    stubGraphql({ data: { events: page([]) }, errors: [] });
    await expect(
      rpc().queryEvents({ query: { MoveEventType: EVENT_TYPE } }),
    ).resolves.toEqual({ data: [] });
  });
});
