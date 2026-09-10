/**
 * A {@link SuiRpcLike} over Sui's GraphQL RPC — the read transport Sui still serves.
 *
 * MEASURED 2026-09-10 on BOTH networks: `https://fullnode.testnet.sui.io` and
 * `https://fullnode.mainnet.sui.io` answer EVERY JSON-RPC method with
 * `-32601 "JSON-RPC on public fullnodes has been deprecated. Please migrate to gRPC or GraphQL
 * endpoints."`, while `https://graphql.testnet.sui.io/graphql` and its mainnet twin served every query in
 * this file. `reader.ts` anticipated exactly this — `SuiRpcLike` is a NARROW structural port of two
 * methods, and its docblock says a gRPC/GraphQL wrapper satisfies it — so this is a second TRANSPORT under
 * the one reader rather than a second reader: `makeSuiReader(makeSuiGraphqlRpc(url))` is the whole
 * migration for a caller, and `recover`, `observe` and `enumerate` are untouched by it.
 *
 * ⛔⛔ THE ONE THING A HAND-ROLLED WRAPPER GETS SILENTLY WRONG: A `vector<u8>` ARRIVES BASE64, NOT number[].
 * JSON-RPC renders `payment_id` as a JSON array of byte values; GraphQL renders the same field as a base64
 * STRING (measured on testnet: `"S5IrGxOa93IPiIrN30QHrEZ5Mr5DCWeTF/hQz6L6KOY="`, 32 bytes). `parseSuiEvents`
 * reads a byte array and answers `undefined` for anything else — and an absent `payment_id` is not an error
 * on this rail, it is `recover` returning `sui/no-payment-id`. Passing `contents.json` through unchanged
 * would therefore report every real weld as never-anchored, on every settlement, with nothing going red.
 * So the base64 is decoded HERE, at the boundary that produced it, and `payment_id` keeps one meaning
 * everywhere above this file.
 *
 * ⛔⛔⛔ WHICH FIELDS ARE BYTES IS ASKED, NEVER GUESSED — and 0.17.0 guessed. It converted the field NAMED
 * `payment_id` on every node, and a Sui PTB is composed and signed by the BUYER: one co-located event from
 * an untrusted package carrying a Move `String` field of that name (`"order-1"`) made `atob` throw
 * `DOMException: Invalid character`, so a buyer could deny a seller recovery of a settlement that is on
 * chain and signed. Worse silently, a name that happens to be base64-shaped (`"abcd"`) decoded to three
 * garbage bytes inside `RawSuiEvent.parsedJson`, an EXPORTED type. The endpoint publishes the answer:
 * `MoveType.layout` names each field's Move type, and it is selected beside `repr` on every node.
 * A field is decoded IFF that layout says `{"vector": "u8"}`. Measured 2026-09-10 over 600 live testnet
 * events across 21 event types: a `0x1::string::String` field renders as the plain string and its layout
 * is a `struct`, never `{"vector":"u8"}`, so an untrusted `payment_id: String` is now left exactly as
 * served. The only way `atob` can still fail is the endpoint contradicting its own layout, which no
 * counterparty can arrange — the throw stopped being reachable from the wire and stayed loud.
 *
 * ⛔⛔⛔ EVERY EVENT CONNECTION IS PAGED, AND AN UNPAGED ONE TRUNCATES IN SILENCE. `TransactionEffects.events`
 * is a connection with the same `defaultPageSize` 20 / `maxPageSize` 50 as `Query.events` (both measured
 * off `serviceConfig` on 2026-09-10). 0.17.0 selected it with NO page argument, so a transaction emitting
 * more than 20 events answered with the OLDEST 20 and `hasNextPage: true`, and the rest were dropped with
 * nothing going red — measured on live testnet digest `9ieBL7opCRsyEySsUFtDNdUCQZJjAvbZMWrzrRfVbZfR`,
 * which emits 21 events and returned 20. Sui's `max_num_event_emit` is 1024 (measured), and the buyer
 * chooses how many calls precede the settle call, so the weld could be buried past position 20 and
 * `recover` would answer `sui/no-payment-id` for a valid settlement. Both connections are therefore walked
 * to exhaustion (or to the caller's `limit`), a page at a time, and a page the endpoint says exists but
 * hands no cursor to reach is a THROW rather than a short answer.
 *
 * Everything else fails LOUD — a non-2xx, a GraphQL `errors[]` inside a 200 (which is how this endpoint
 * reports a rejected query), a `null` `data`, a request that never completes, a digest the endpoint does
 * not know, and an event node missing any field these queries SELECT. A read transport that answered
 * "no events" for any of those would be indistinguishable from a settlement that never carried a weld.
 */
import type { RawSuiEvent, SuiRpcLike } from "./reader.js";

/**
 * The event page size this wrapper asks for, and the scan depth it uses when a caller names no `limit` —
 * the endpoint's own `maxPageSize(type: "Query", field: "events")`, measured 50 on 2026-09-10. The same 50
 * caps `TransactionEffects.events`, so one number covers both connections.
 *
 * ⛔ It was 20 — the endpoint's `defaultPageSize` — and that HALVED a defaulted scan against no error.
 * Driven live on 2026-09-10 against `<pkg>::payment::PaymentSettled` on testnet: 33 settlements exist,
 * 16 of them carry one particular atrHash, and `enumerate` with no `limit` found **10** while `limit: 50`
 * found **16**. Six real settlements were invisible, and a missed hit on a best-effort scan is an empty
 * array rather than an error. Asking for the largest page the endpoint will serve is the only default that
 * costs a caller nothing and hides nothing; a deeper scan is still a `limit`, now paged rather than
 * refused.
 *
 * ⛔ It is STATED rather than omitted, and that is separately load-bearing. A GraphQL connection given
 * neither `first` nor `last` pages from the OLDEST end, so leaving the page size off would quietly invert
 * a `order: "descending"` scan and hand back the first settlements ever made instead of the most recent
 * ones — a wrong answer that looks exactly like a right one. An over-large page is refused loudly by the
 * endpoint (`Page size is too large: 51 > 50`), so this is the only silent failure the page argument had.
 */
export const SUI_GRAPHQL_DEFAULT_EVENT_PAGE = 50;

/**
 * The deadline on one GraphQL request. `fetch` has no timeout of its own, so 0.17.0 could hang `recover`
 * forever on an endpoint that accepted a connection and never answered — the SDK transport this stands in
 * for carries one, and dropping it was a capability lost in the migration rather than a choice.
 *
 * It sits ABOVE the endpoint's own `queryTimeoutMs`, measured 40_000 on 2026-09-10, deliberately: a client
 * deadline under the server's would abort queries the endpoint is still legitimately working on and
 * report them as transport faults.
 */
export const SUI_GRAPHQL_TIMEOUT_MS = 60_000;

/**
 * The ceiling on how many pages one connection walk will take before it refuses. At the page size above
 * that is 3_200 events — comfortably past Sui's `max_num_event_emit` of 1024 per transaction (measured
 * 2026-09-10), so it can only be reached by a scan `limit` larger than any this rail's best-effort
 * enumerate is meant to serve, or by an endpoint that pages without ever advancing. Both are refusals.
 */
const SUI_GRAPHQL_MAX_EVENT_PAGES = 64;

/** One event node as both queries below select it (`MoveValue` contents plus the emitting transaction). */
interface GraphqlEventNode {
  contents?: {
    type?: { repr?: string; layout?: unknown } | null;
    json?: unknown;
  } | null;
  transaction?: { digest?: string } | null;
}

/** One page of an event connection — the nodes plus the cursors needed to walk to the next one. */
interface GraphqlEventConnection {
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor?: string | null;
    endCursor?: string | null;
  };
  nodes: GraphqlEventNode[];
}

/** The event selection both queries share — the type, the LAYOUT that says which fields are bytes, the
 *  rendered value, and the emitting transaction's digest. */
const EVENT_FIELDS =
  "contents { type { repr layout } json } transaction { digest }";

/** The cursors both walks need: forward (`hasNextPage`/`endCursor`) and backward (`hasPreviousPage`/`startCursor`). */
const PAGE_FIELDS =
  "pageInfo { hasNextPage hasPreviousPage startCursor endCursor }";

/** One transaction's effects: the status gate and a PAGED walk over the events it emitted. */
const TRANSACTION_QUERY = `query($digest: String!, $first: Int!, $after: String) {
  transaction(digest: $digest) {
    effects {
      status
      events(first: $first, after: $after) { ${PAGE_FIELDS} nodes { ${EVENT_FIELDS} } }
    }
  }
}`;

/** The NEWEST page of one event type — `last:` on a connection, which is what descending order means here. */
const EVENTS_NEWEST_QUERY = `query($type: String!, $limit: Int!, $cursor: String) {
  events(last: $limit, before: $cursor, filter: { type: $type }) {
    ${PAGE_FIELDS} nodes { ${EVENT_FIELDS} }
  }
}`;

/** The OLDEST page of one event type — `first:`, the ascending arm and the JSON-RPC method's own default. */
const EVENTS_OLDEST_QUERY = `query($type: String!, $limit: Int!, $cursor: String) {
  events(first: $limit, after: $cursor, filter: { type: $type }) {
    ${PAGE_FIELDS} nodes { ${EVENT_FIELDS} }
  }
}`;

/** Decode a base64 `vector<u8>` into the byte array `parseSuiEvents` reads. A failure here means the
 *  endpoint served a value its own layout says is bytes and that is not base64, so it names both. */
function base64Bytes(value: string, field: string, where: string): number[] {
  let binary: string;
  try {
    binary = atob(value);
  } catch (cause) {
    throw new Error(
      `${where}: the endpoint's type layout declares "${field}" a vector<u8>, which GraphQL renders as a ` +
        `base64 string, but the value it served for that field is not base64`,
      { cause },
    );
  }
  return Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * The field names the endpoint's OWN type layout declares `vector<u8>` — the fields, and only the fields,
 * that GraphQL renders as base64 and JSON-RPC renders as a byte array.
 *
 * ⛔ An ABSENT layout is a THROW and a non-struct layout is not. They are different facts: the queries
 * SELECT `contents.type.layout`, so its absence leaves "which of this value's fields are bytes" unanswered,
 * and guessing would put us back where 0.17.0 was. A layout that IS present and is not a struct has
 * answered completely — a Move value's named top-level fields live under `struct.fields` and nowhere else,
 * so a primitive, a vector or an enum has no field to convert. Measured 2026-09-10: 600 live testnet events
 * across 21 types, every one a `struct` layout, none absent.
 *
 * ⚠️ TOP-LEVEL FIELDS ONLY, stated rather than silently scoped. `payment_id` is a top-level `vector<u8>` of
 * the Pay402 `PaymentSettled` struct, and recursing into arbitrary counterparty-authored nesting would be
 * unbounded work over bytes a buyer chose.
 */
function byteVectorFields(layout: unknown, where: string): ReadonlySet<string> {
  if (layout === undefined || layout === null)
    throw new Error(
      `${where}: a GraphQL event node carried no contents.type.layout, so which of its fields are ` +
        `vector<u8> — the ones GraphQL renders base64 — is unanswered`,
    );
  const fields = (layout as { struct?: { fields?: unknown } }).struct?.fields;
  if (!Array.isArray(fields)) return new Set<string>();
  const names = new Set<string>();
  for (const field of fields) {
    const name = (field as { name?: unknown }).name;
    const fieldLayout = (field as { layout?: unknown }).layout;
    if (typeof name !== "string") continue;
    if ((fieldLayout as { vector?: unknown } | null)?.vector === "u8")
      names.add(name);
  }
  return names;
}

/**
 * Bring a `MoveValue.json` object into the `parsedJson` shape the port promises — see the base64 note at
 * the top of this file. Every field the layout declares `vector<u8>` is converted and nothing else is,
 * so the addresses and amounts beside them arrive exactly as served.
 *
 * ⛔ `coin_type` is the second such field on Pay402's `PaymentSettled` (measured: it decodes to the UTF-8
 * `…::usdc::USDC` type tag) and 0.17.0 left it base64 while converting `payment_id`. Nothing in this
 * package reads it — but `RawSuiEvent.parsedJson` is EXPORTED, so one field of one published type meant
 * "bytes" over JSON-RPC and "base64 text" over GraphQL depending on which transport a consumer bound. A
 * port whose value depends on which implementation produced it is not a port.
 */
function parsedJsonOf(
  json: NonNullable<unknown>,
  byteFields: ReadonlySet<string>,
  where: string,
): unknown {
  // Only a JSON OBJECT has named fields to convert. A scalar or an array is returned exactly as served —
  // spreading either into an object destroys it (`{..."42"}` is `{0:"4",1:"2"}`). `null` is absent from
  // this test because it cannot arrive: `rawEventOf` throws on a null `contents.json` before this runs,
  // and the parameter type is what says so rather than a second guard nothing could exercise.
  if (typeof json !== "object" || Array.isArray(json)) return json;
  const out: Record<string, unknown> = { ...(json as Record<string, unknown>) };
  for (const name of byteFields) {
    const value = out[name];
    if (typeof value !== "string")
      throw new Error(
        `${where}: the endpoint's type layout declares "${name}" a vector<u8>, which GraphQL renders as a ` +
          `base64 string, but the value it served for that field is ${value === null ? "null" : typeof value}`,
      );
    out[name] = base64Bytes(value, name, where);
  }
  return out;
}

/**
 * Map one GraphQL event node onto the port's raw event.
 *
 * ⛔ EVERY FIELD THE QUERIES SELECT IS REQUIRED HERE, and the four throws below are one rule rather than
 * four guards. `Event.contents`, `MoveValue.json` and `Event.transaction` are all nullable in the schema,
 * exactly as `contents.type` is; 0.17.0 threw for the type and SILENTLY OMITTED for the other three. An
 * omitted `parsedJson` reads as `sui/no-payment-id` and an omitted `id.txDigest` makes `enumerate` drop a
 * settlement it in fact found (`adapter.ts` cannot reference a match it cannot name) — both of which say
 * "the chain has no weld" for a question this transport failed to ask. Measured 2026-09-10 across 600 live
 * testnet events: none of the four is ever absent, so their absence is the endpoint's shape moving.
 */
function rawEventOf(node: GraphqlEventNode, where: string): RawSuiEvent {
  const contents = node.contents;
  if (contents === undefined || contents === null)
    throw new Error(`${where}: a GraphQL event node carried no contents`);
  const moveType = contents.type;
  if (moveType === undefined || moveType === null)
    throw new Error(`${where}: a GraphQL event node carried no contents.type`);
  const type = moveType.repr;
  // `recover` matches the fully-qualified type exactly, and an event with no type matches nothing —
  // which would read as a settlement carrying no weld rather than as a broken read.
  if (typeof type !== "string")
    throw new Error(
      `${where}: a GraphQL event node carried no contents.type.repr`,
    );
  const digest = node.transaction?.digest;
  if (typeof digest !== "string")
    throw new Error(
      `${where}: the ${type} event node carried no transaction.digest, so the settlement it proves ` +
        `could not be referenced`,
    );
  const json = contents.json;
  if (json === undefined || json === null)
    throw new Error(
      `${where}: the ${type} event node carried no contents.json, so its payment_id could not be read`,
    );
  return {
    type,
    parsedJson: parsedJsonOf(
      json,
      byteVectorFields(moveType.layout, where),
      where,
    ),
    id: { txDigest: digest },
  };
}

/** POST one query and return its `data`, refusing every shape that is not an answer. `where` names the
 *  port call on every refusal, so a transport fault says which read it broke. */
async function graphqlCall<T>(
  url: string,
  where: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      // ⛔ `fetch` waits forever by default, and a read that never returns is worse than one that fails:
      // nothing above this file is watching a clock, so a hung endpoint hangs `recover` for good.
      signal: AbortSignal.timeout(SUI_GRAPHQL_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(
      `${where}: Sui GraphQL request to ${url} did not complete within ${SUI_GRAPHQL_TIMEOUT_MS}ms`,
      { cause },
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${where}: Sui GraphQL HTTP ${res.status}: ${text}`);
  }
  const envelope = (await res.json()) as {
    data?: T | null;
    errors?: { message?: string }[];
  };
  // A rejected query is a 200 carrying `{"data": null, "errors": [...]}` — reading `data` without checking
  // `errors` would turn a bad filter or an over-large page into an empty result set.
  if (envelope.errors !== undefined && envelope.errors.length > 0)
    throw new Error(
      `${where}: Sui GraphQL errors: ${envelope.errors
        .map((e) => e.message ?? "(no message)")
        .join("; ")}`,
    );
  if (envelope.data === undefined || envelope.data === null)
    throw new Error(`${where}: Sui GraphQL returned no data`);
  return envelope.data;
}

/**
 * The cursor that reaches the next page, refusing a connection that claims one and hands no way to it.
 *
 * ⛔ A cursor that does not ADVANCE is refused with the same words. It is the one shape that turns a walk
 * into an unbounded loop against a live endpoint, and it is indistinguishable from progress at the call
 * site — the pages keep arriving, the answer never completes.
 */
function nextCursor(
  cursor: string | null | undefined,
  previous: string | null,
  where: string,
): string {
  if (cursor === undefined || cursor === null || cursor === previous)
    throw new Error(
      `${where}: the endpoint reports another page of events but returned no cursor that advances past ` +
        `the one already read, so the answer cannot be completed`,
    );
  return cursor;
}

/**
 * Wrap a Sui GraphQL endpoint as the {@link SuiRpcLike} port `makeSuiReader` takes — the migration off the
 * deprecated public JSON-RPC, in the shape `reader.ts` already declared. Read-only; the write half of a
 * settlement still goes through a JSON-RPC or gRPC client you supply. Refuses an empty url at CONSTRUCTION
 * rather than POSTing to a relative path on the first read.
 *
 * `getTransactionBlock` gates on `effects.status` EXPLICITLY, which is what `reader.ts` requires of any
 * source other than the JSON-RPC one it was written against: the Sui rail has no `success` field in its
 * event view because a PTB abort discards every effect including the events, and that structural gate is a
 * property of the JSON-RPC response rather than a promise this transport inherits. GraphQL publishes the
 * status directly, so it is read directly — a `FAILURE` yields no events and recovery refuses, exactly as
 * an aborted transaction does over JSON-RPC, and anything that is neither of `ExecutionStatus`'s two
 * values is a shape that moved and throws.
 */
export function makeSuiGraphqlRpc(url: string): SuiRpcLike {
  if (url.length === 0)
    throw new Error(
      'makeSuiGraphqlRpc: url is empty — pass a Sui GraphQL endpoint, e.g. getSuiConfig("testnet").graphqlUrl',
    );
  return {
    async getTransactionBlock(input: {
      digest: string;
      // `showEvents` is the port's only option and this query always selects them, so there is nothing to
      // branch on — the field stays in the signature because the port declares it.
      options: { showEvents: true };
    }): Promise<{ events?: RawSuiEvent[] | null }> {
      const where = `getTransactionBlock(${input.digest})`;
      const nodes: GraphqlEventNode[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < SUI_GRAPHQL_MAX_EVENT_PAGES; page += 1) {
        const data = await graphqlCall<{
          transaction: {
            effects: {
              status?: string | null;
              events?: GraphqlEventConnection | null;
            } | null;
          } | null;
        }>(url, where, TRANSACTION_QUERY, {
          digest: input.digest,
          first: SUI_GRAPHQL_DEFAULT_EVENT_PAGE,
          after: cursor,
        });
        // An unknown digest is a THROW, not an empty read — the JSON-RPC method it stands in for throws,
        // and "this transaction does not exist" must never arrive at `recover` as "it exists and carries
        // no weld".
        if (data.transaction === undefined || data.transaction === null)
          throw new Error(`${where}: Sui GraphQL: no transaction`);
        const effects = data.transaction.effects;
        if (effects === undefined || effects === null)
          throw new Error(`${where}: the transaction has no effects`);
        // ⛔ An ABSENT status is not a failed transaction, it is an unanswered question — and answering it
        // with `[]` would be the same silent wrong answer as swallowing an unknown digest: recovery would
        // refuse, and a real weld would read as never-anchored. Only the endpoint's own `FAILURE` is a
        // failure. `ExecutionStatus` has exactly two values, so anything else is a shape that moved.
        if (effects.status === undefined || effects.status === null)
          throw new Error(
            `${where}: the transaction reports no execution status`,
          );
        if (effects.status === "FAILURE") return { events: [] };
        if (effects.status !== "SUCCESS")
          throw new Error(
            `${where}: the transaction reports execution status "${effects.status}", which is neither ` +
              `SUCCESS nor FAILURE — ExecutionStatus has exactly those two values`,
          );
        const events = effects.events;
        // ⛔ `TransactionEffects.events` is NULLABLE in the schema, exactly as `status` is, and 0.17.0
        // read it as `?? []` one field short of the guard chain above. A SUCCESS whose event connection
        // the endpoint could not serve would have reported a real weld as never-anchored.
        if (events === undefined || events === null)
          throw new Error(
            `${where}: the transaction succeeded but the endpoint served no events connection, which is ` +
              `not the same as a transaction that emitted none`,
          );
        nodes.push(...events.nodes);
        if (!events.pageInfo.hasNextPage)
          return { events: nodes.map((n) => rawEventOf(n, where)) };
        cursor = nextCursor(events.pageInfo.endCursor, cursor, where);
      }
      throw new Error(
        `${where}: the endpoint is still paging events after ${SUI_GRAPHQL_MAX_EVENT_PAGES} pages of ` +
          `${SUI_GRAPHQL_DEFAULT_EVENT_PAGE}, which is past Sui's own cap of 1024 events per transaction`,
      );
    },

    async queryEvents(input: {
      query: { MoveEventType: string };
      limit?: number;
      order?: "descending" | "ascending";
    }): Promise<{ data: RawSuiEvent[] }> {
      const eventType = input.query.MoveEventType;
      const where = `queryEvents(${eventType})`;
      const limit = input.limit ?? SUI_GRAPHQL_DEFAULT_EVENT_PAGE;
      // A scan depth that is not a positive whole number cannot be honoured, and the `[]` it would
      // otherwise produce is exactly what "no settlements bear this atrHash" looks like.
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error(
          `${where}: limit must be a positive integer, got ${limit}`,
        );
      const descending = input.order === "descending";
      // Each page arrives OLDEST-FIRST within itself on both arms — `last:` selects the newest page, it
      // does not reverse it. Walking descending therefore steps BACKWARDS, so each page read is older
      // than the last and belongs in front of it; the accumulation is ascending either way and is
      // reversed once at the end.
      const pages: GraphqlEventNode[][] = [];
      let taken = 0;
      let cursor: string | null = null;
      for (let page = 0; taken < limit; page += 1) {
        if (page >= SUI_GRAPHQL_MAX_EVENT_PAGES)
          throw new Error(
            `${where}: the endpoint is still paging after ${SUI_GRAPHQL_MAX_EVENT_PAGES} pages of ` +
              `${SUI_GRAPHQL_DEFAULT_EVENT_PAGE} and the scan of ${limit} is not satisfied, so the ` +
              `depth this answer represents is unknown`,
          );
        const data = await graphqlCall<{
          events?: GraphqlEventConnection | null;
        }>(url, where, descending ? EVENTS_NEWEST_QUERY : EVENTS_OLDEST_QUERY, {
          type: eventType,
          limit: Math.min(limit - taken, SUI_GRAPHQL_DEFAULT_EVENT_PAGE),
          cursor,
        });
        // ⛔ `Query.events` is NULLABLE too. Dereferencing it unguarded — which is what 0.17.0's response
        // type asserted — turns a connection the endpoint declined to serve into a bare TypeError naming
        // no read, one line after `graphqlCall` proved the envelope was an answer.
        const events = data.events;
        if (events === undefined || events === null)
          throw new Error(
            `${where}: the endpoint served no events connection, which is not the same as an event type ` +
              `with no settlements`,
          );
        if (descending) pages.unshift(events.nodes);
        else pages.push(events.nodes);
        taken += events.nodes.length;
        const more = descending
          ? events.pageInfo.hasPreviousPage
          : events.pageInfo.hasNextPage;
        if (!more) break;
        cursor = nextCursor(
          descending ? events.pageInfo.startCursor : events.pageInfo.endCursor,
          cursor,
          where,
        );
      }
      const ascending = pages.flat();
      const ordered = descending ? ascending.reverse() : ascending;
      return { data: ordered.map((n) => rawEventOf(n, where)) };
    },
  };
}
