/**
 * The Hedera Mirror Node's REST interface, bounded: lcp's `HederaReader` over it, and the reads the modules make beside
 * lcp's read (a transaction's charged fee, an account's EVM address, a contract call simulated). Every call ends by the
 * deadline it is given, a `performance.now()` time, and every failure rejects.
 */
import type { HederaNetwork, HederaReader, MirrorEntry, MirrorPage } from "@integraledger/lcp/hedera";
import { isObject } from "../../answers.js";
import { NODE_MAX_BYTES, NODE_TIMEOUT_MS, NodeError, site } from "../../http.js";

/** One bounded HTTP call of the mirror: the JSON answer, or `null` for a 404, the mirror's answer for what it does not hold. */
export async function mirrorCall(url: string, deadline: number, body?: unknown): Promise<unknown> {
  const ms = Math.min(NODE_TIMEOUT_MS, deadline - performance.now());
  if (ms <= 0) throw new NodeError("spent", false, site(url));
  let res: Response;
  try {
    res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(Math.ceil(ms)),
    });
  } catch (e) {
    throw new NodeError("transport", true, e instanceof Error ? e.message : String(e), { cause: e });
  }
  const text = await res.text();
  if (text.length > NODE_MAX_BYTES) throw new NodeError("too-large", true, site(url));
  if (res.status === 404) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new NodeError("malformed", true, "the answer is not JSON", { cause: e });
  }
  // A contract call the EVM reverted is answered 400 with the revert's messages: the caller reads them.
  if (res.status === 400 && body !== undefined) return { reverted: json };
  if (res.status < 200 || res.status > 299) throw new NodeError("http-status", true, `status ${res.status}`);
  return json;
}

/** The mirror at `base` for `network`, its calls ending by `deadline`. */
export interface Mirror {
  readonly network: HederaNetwork;
  readonly base: string;
  readonly archival: boolean;
}

function blockEdge(answer: unknown, edge: "from" | "to"): string {
  const blocks = isObject(answer) ? answer["blocks"] : undefined;
  const first = Array.isArray(blocks) ? blocks[0] : undefined;
  const timestamp = isObject(first) ? first["timestamp"] : undefined;
  const t = isObject(timestamp) ? timestamp[edge] : undefined;
  if (typeof t !== "string") throw new NodeError("malformed", true, "a block's timestamp");
  return t;
}

/** lcp's reader over the mirror, as `HederaReader` names each call. */
export function mirrorReader(m: Mirror, deadline: number): HederaReader {
  const base = m.base.replace(/\/+$/, "");
  const get = (path: string) => mirrorCall(`${base}${path}`, deadline);
  return {
    network: m.network,
    async transactions(mirrorId) {
      const a = await get(`/api/v1/transactions/${encodeURIComponent(mirrorId)}`);
      if (a === null) return null;
      if (!isObject(a) || !Array.isArray(a["transactions"])) throw new NodeError("malformed", true, "a transaction lookup");
      return a["transactions"] as MirrorEntry[];
    },
    async latest() {
      return blockEdge(await get("/api/v1/blocks?order=desc&limit=1"), "to");
    },
    async oldest() {
      if (m.archival) return "archival";
      return blockEdge(await get("/api/v1/blocks?order=asc&limit=1"), "from");
    },
    async accountTransactions(q): Promise<MirrorPage> {
      const query = new URLSearchParams({ "account.id": q.account, order: "asc", limit: "100" });
      query.append("timestamp", `gt:${q.after}`);
      query.append("timestamp", `lte:${q.until}`);
      const a = await get(`/api/v1/transactions?${query}`);
      if (!isObject(a) || !Array.isArray(a["transactions"])) throw new NodeError("malformed", true, "an account page");
      const links = a["links"];
      const next = isObject(links) && typeof links["next"] === "string" ? links["next"] : null;
      return { transactions: a["transactions"] as MirrorEntry[], next };
    },
  };
}

/** A transaction id as the SDK writes it, `0.0.n@seconds.nanos`, in the mirror's form `0.0.n-seconds-nanos`. */
export function mirrorId(sdkId: string): string | undefined {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(sdkId);
  return m === null ? undefined : `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * The fee the mirror shows the transaction `id` (mirror form) charged its fee payer: the `charged_tx_fee` of its own
 * entry, the one that is no child (`nonce` 0) and not scheduled; undefined where the mirror holds none yet.
 */
export async function chargedFee(m: Mirror, id: string, deadline: number): Promise<bigint | undefined> {
  const entries = await mirrorReader(m, deadline).transactions(id);
  const own = entries?.find((e) => e.nonce === 0 && e.scheduled === false);
  const fee = own?.charged_tx_fee;
  return typeof fee === "number" && Number.isSafeInteger(fee) && fee >= 0 ? BigInt(fee) : undefined;
}

/** A transaction id in the mirror's form, `0.0.n-seconds-nanos`, as the SDK writes it, `0.0.n@seconds.nanos`. */
export function sdkId(mirror: string): string | undefined {
  const m = /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(mirror);
  return m === null ? undefined : `${m[1]}@${m[2]}.${m[3]!.padStart(9, "0")}`;
}

/**
 * lcp's answer with the transaction it names spelled as the module's settle names it, the SDK's form, so that the
 * settler tells the transaction it sent from another by its id alone.
 */
export function spelledAsSent<A extends { readonly state: string }>(answer: A): A {
  const named = (answer as { transaction?: unknown }).transaction;
  const sdk = typeof named === "string" ? sdkId(named) : undefined;
  return sdk === undefined ? answer : { ...answer, transaction: sdk };
}
