/**
 * The SDK→pure boundary — maps a @mysten/sui JSON-RPC client's `getTransactionBlock` / `queryEvents`
 * responses into this package's hand-written `PaymentSettledView[]`. It is typed against a NARROW
 * structural port (`SuiRpcLike`), not the SDK's `SuiJsonRpcClient` class: the class's response types are
 * giant (and its JSON-RPC methods are @deprecated in 2.22.0 in favour of gRPC/GraphQL), so binding this
 * package to the concrete class would (a) leak those types across the isolatedDeclarations surface and
 * (b) hard-pin a deprecated transport. A caller passes the real `SuiJsonRpcClient` (it satisfies the port
 * structurally) or any equivalent gRPC/GraphQL wrapper. `parseSuiEvents` is the pure mapping and is
 * exported for testing — it handles a `parsedJson.payment_id` that is either a byte array or absent.
 */
import type { PaymentSettledView } from "./adapter.js";

/** One raw Sui event as the RPC surfaces it (the fields this binding reads; `parsedJson` is untyped). */
export interface RawSuiEvent {
  type: string;
  parsedJson?: unknown;
  id?: { txDigest?: string };
}

/** The narrow client surface this reader needs — the JSON-RPC `SuiJsonRpcClient` satisfies it structurally. */
export interface SuiRpcLike {
  getTransactionBlock(input: {
    digest: string;
    options: { showEvents: true };
  }): Promise<{ events?: RawSuiEvent[] | null }>;
  queryEvents(input: {
    query: { MoveEventType: string };
    limit?: number;
    order?: "descending" | "ascending";
  }): Promise<{ data: RawSuiEvent[] }>;
}

/** Pull `payment_id` (a byte array) out of a Pay402 event's `parsedJson`, or undefined if not present. */
function paymentIdOf(parsedJson: unknown): readonly number[] | undefined {
  if (typeof parsedJson !== "object" || parsedJson === null) return undefined;
  const pid = (parsedJson as { payment_id?: unknown }).payment_id;
  if (!Array.isArray(pid)) return undefined;
  if (!pid.every((b): b is number => typeof b === "number")) return undefined;
  return pid;
}

/** Map raw RPC events into the pure `PaymentSettledView[]` (drops nothing; the adapter filters by type). */
export function parseSuiEvents(events: RawSuiEvent[]): PaymentSettledView[] {
  return events.map((e) => {
    const paymentId = paymentIdOf(e.parsedJson);
    const digest = e.id?.txDigest;
    return {
      type: e.type,
      ...(paymentId !== undefined ? { paymentId } : {}),
      ...(digest !== undefined ? { digest } : {}),
    };
  });
}

/** Reads settled transactions / queries settle events — wraps a @mysten/sui JSON-RPC client. */
export interface SuiReaderImpl {
  settledEvents(digest: string): Promise<PaymentSettledView[]>;
  querySettled(
    eventType: string,
    limit?: number,
  ): Promise<PaymentSettledView[]>;
}

/** Wrap a Sui JSON-RPC client as a reader. It takes the STRUCTURAL {@link SuiRpcLike} port, not the SDK
 *  class, so `@mysten/sui`'s `SuiJsonRpcClient` works by shape and so does a gRPC/GraphQL wrapper you
 *  write — which matters, because those JSON-RPC methods are deprecated upstream. Read-only, and the
 *  `showEvents` request it issues is load-bearing: an aborted PTB emits no events, which is how this rail
 *  tells a failed transaction from a settled one. */
export function makeSuiReader(client: SuiRpcLike): SuiReaderImpl {
  return {
    async settledEvents(digest: string): Promise<PaymentSettledView[]> {
      // `showEvents` is the whole success gate on this rail, structurally: an aborted PTB discards every
      // effect including its events, so a failed transaction answers with none and recovery refuses. Do
      // NOT swap this for a source that survives an abort (devInspect/dryRun, a mempool feed) without
      // adding an explicit `effects.status` gate — see the reliance recorded in adapter.ts.
      const res = await client.getTransactionBlock({
        digest,
        options: { showEvents: true },
      });
      const events = res.events ?? [];
      // getTransactionBlock does not populate event.id.txDigest per-event; stamp the caller's digest so
      // `enumerate`-style consumers of a single-tx read still have the ref (zeroPartyRecoverable holds).
      return parseSuiEvents(events).map((v) => ({ ...v, digest }));
    },
    async querySettled(
      eventType: string,
      limit?: number,
    ): Promise<PaymentSettledView[]> {
      const res = await client.queryEvents({
        query: { MoveEventType: eventType },
        ...(limit !== undefined ? { limit } : {}),
        order: "descending",
      });
      return parseSuiEvents(res.data);
    },
  };
}
