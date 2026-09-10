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
 * Everything else fails LOUD — a non-2xx, a GraphQL `errors[]` inside a 200 (which is how this endpoint
 * reports a rejected query), a `null` `data`, a digest the endpoint does not know, and an event node
 * missing the type this package matches on. A read transport that answered "no events" for any of those
 * would be indistinguishable from a settlement that never carried a weld.
 */
import type { RawSuiEvent, SuiRpcLike } from "./reader.js";

/**
 * The event page size this wrapper asks for when a caller names none — the endpoint's own
 * `defaultPageSize(type: "Query", field: "events")`, measured 20 on 2026-09-10 (its `maxPageSize` is 50).
 *
 * ⛔ It is STATED rather than omitted, and that is the point. A GraphQL connection given neither `first`
 * nor `last` pages from the OLDEST end, so leaving the page size off would quietly invert a
 * `order: "descending"` scan and hand back the first settlements ever made instead of the most recent
 * ones — a wrong answer that looks exactly like a right one. An over-large page is refused loudly by the
 * endpoint (`Page size is too large: 5000 > 50`), so this is the only silent failure the page argument had.
 */
export const SUI_GRAPHQL_DEFAULT_EVENT_PAGE = 20;

/** One event node as both queries below select it (`MoveValue` contents plus the emitting transaction). */
interface GraphqlEventNode {
  contents?: { type?: { repr?: string } | null; json?: unknown } | null;
  transaction?: { digest?: string } | null;
}

/** The event selection both queries share — the type this package matches on, its fields, and the digest. */
const EVENT_FIELDS = "contents { type { repr } json } transaction { digest }";

/** One transaction's effects: the status gate and the events it emitted. */
const TRANSACTION_QUERY = `query($digest: String!) {
  transaction(digest: $digest) {
    effects { status events { nodes { ${EVENT_FIELDS} } } }
  }
}`;

/** The NEWEST page of one event type — `last:` on a connection, which is what descending order means here. */
const EVENTS_NEWEST_QUERY = `query($type: String!, $limit: Int!) {
  events(last: $limit, filter: { type: $type }) { nodes { ${EVENT_FIELDS} } }
}`;

/** The OLDEST page of one event type — `first:`, the ascending arm and the JSON-RPC method's own default. */
const EVENTS_OLDEST_QUERY = `query($type: String!, $limit: Int!) {
  events(first: $limit, filter: { type: $type }) { nodes { ${EVENT_FIELDS} } }
}`;

/** Decode a base64 `vector<u8>` into the byte array `parseSuiEvents` reads. Throws on malformed base64. */
function base64Bytes(value: string): number[] {
  const binary = atob(value);
  const out = new Array<number>(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Bring a `MoveValue.json` object into the `parsedJson` shape the port promises — see the base64 note at
 * the top of this file. Only `payment_id` is converted, because it is the only field this binding reads
 * and a blanket "every string might be bytes" rewrite would corrupt the addresses and amounts beside it.
 */
function parsedJsonOf(json: unknown): unknown {
  if (typeof json !== "object" || json === null) return json;
  const paymentId = (json as { payment_id?: unknown }).payment_id;
  if (typeof paymentId !== "string") return json;
  return { ...json, payment_id: base64Bytes(paymentId) };
}

/** Map one GraphQL event node onto the port's raw event. Throws when the node carries no Move type. */
function rawEventOf(node: GraphqlEventNode, where: string): RawSuiEvent {
  const type = node.contents?.type?.repr;
  // The queries above SELECT `contents.type.repr`, so its absence means the endpoint's shape moved under
  // this file. `recover` matches the fully-qualified type exactly, and an event with no type matches
  // nothing — which would read as a settlement carrying no weld rather than as a broken read.
  if (type === undefined || type === null)
    throw new Error(
      `${where}: a GraphQL event node carried no contents.type.repr`,
    );
  const json = node.contents?.json;
  const digest = node.transaction?.digest;
  return {
    type,
    ...(json !== undefined && json !== null
      ? { parsedJson: parsedJsonOf(json) }
      : {}),
    ...(digest !== undefined ? { id: { txDigest: digest } } : {}),
  };
}

/** POST one query and return its `data`, refusing every shape that is not an answer. */
async function graphqlCall<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sui GraphQL HTTP ${res.status}: ${text}`);
  }
  const envelope = (await res.json()) as {
    data?: T | null;
    errors?: { message?: string }[];
  };
  // A rejected query is a 200 carrying `{"data": null, "errors": [...]}` — reading `data` without checking
  // `errors` would turn a bad filter or an over-large page into an empty result set.
  if (envelope.errors !== undefined && envelope.errors.length > 0)
    throw new Error(
      `Sui GraphQL errors: ${envelope.errors
        .map((e) => e.message ?? "(no message)")
        .join("; ")}`,
    );
  if (envelope.data === undefined || envelope.data === null)
    throw new Error("Sui GraphQL returned no data");
  return envelope.data;
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
 * an aborted transaction does over JSON-RPC.
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
      const data = await graphqlCall<{
        transaction: {
          effects: {
            status?: string | null;
            events?: { nodes: GraphqlEventNode[] } | null;
          } | null;
        } | null;
      }>(url, TRANSACTION_QUERY, { digest: input.digest });
      const where = `getTransactionBlock(${input.digest})`;
      // An unknown digest is a THROW, not an empty read — the JSON-RPC method it stands in for throws, and
      // "this transaction does not exist" must never arrive at `recover` as "it exists and carries no weld".
      if (data.transaction === null)
        throw new Error(`Sui GraphQL: no transaction ${input.digest}`);
      const effects = data.transaction.effects;
      if (effects === undefined || effects === null)
        throw new Error(
          `Sui GraphQL: transaction ${input.digest} has no effects`,
        );
      // ⛔ An ABSENT status is not a failed transaction, it is an unanswered question — and answering it
      // with `[]` would be the same silent wrong answer as swallowing an unknown digest: recovery would
      // refuse, and a real weld would read as never-anchored. Only the endpoint's own `FAILURE` is a
      // failure. `ExecutionStatus` has exactly two values, so anything else is a shape that moved.
      if (effects.status === undefined || effects.status === null)
        throw new Error(
          `Sui GraphQL: transaction ${input.digest} reports no execution status`,
        );
      if (effects.status !== "SUCCESS") return { events: [] };
      const nodes = effects.events?.nodes ?? [];
      return { events: nodes.map((n) => rawEventOf(n, where)) };
    },

    async queryEvents(input: {
      query: { MoveEventType: string };
      limit?: number;
      order?: "descending" | "ascending";
    }): Promise<{ data: RawSuiEvent[] }> {
      const eventType = input.query.MoveEventType;
      const limit = input.limit ?? SUI_GRAPHQL_DEFAULT_EVENT_PAGE;
      const descending = input.order === "descending";
      const data = await graphqlCall<{ events: { nodes: GraphqlEventNode[] } }>(
        url,
        descending ? EVENTS_NEWEST_QUERY : EVENTS_OLDEST_QUERY,
        { type: eventType, limit },
      );
      // Both arms come back oldest-first WITHIN the page — `last:` selects the newest page, it does not
      // reverse it. So descending is the page reversed; ascending is the page as served, which is also
      // what the JSON-RPC method does when no order is named.
      const nodes = descending
        ? [...data.events.nodes].reverse()
        : data.events.nodes;
      return {
        data: nodes.map((n) => rawEventOf(n, `queryEvents(${eventType})`)),
      };
    },
  };
}
