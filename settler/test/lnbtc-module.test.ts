// The lnbtc module through the settler's HTTP surface, against lcp's vectors for x402/exact/lnbtc/payment-hash
// (lcp/vectors/x402-exact-lnbtc.json): x402's published option, invoice, preimage and payment hash, with invoices written
// by bolt11 1.4.1. Every expected answer is the vector's: its validation verdict and reason, its payment hash and
// network, which x402's scheme answers as the settlement's transaction and network with no payer. The settler's clock is
// set to each row's validation time; Lightning has no node to stub.
import { readFileSync } from "node:fs";
import type { LnNetwork } from "@integraledger/lcp/lightning";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveSettler } from "../src/core.js";
import { listed } from "../src/modules/index.js";
import { starter } from "../src/modules/lnbtc/index.js";
import { freshDatabase, onLockedPort, post } from "./support.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-lnbtc.json", import.meta.url), "utf8"));
const P = V.fixed.P as PaymentPayload;
const O = V.fixed.O as PaymentRequirements;
const VALID = V.validate.valid as { valid: true; network: LnNetwork; paymentHash: string };
const TESTNET: LnNetwork = "lnbtc:000000000933ea01ad0ee984209779ba";
const LIST = [listed("lnbtc", async () => ({ starter }))] as const;

type Row = { case: string; payload?: Record<string, unknown>; requirements?: Record<string, unknown>; at?: { now: number; skew?: number }; expect: string };

/** A copy of `base` with each dotted path of `changes` set, or removed where its value is null: the vector file's rows. */
function set<T>(base: T, changes: Record<string, unknown>): T {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    if (value === null) delete at[keys[keys.length - 1]!];
    else at[keys[keys.length - 1]!] = structuredClone(value);
  }
  return copy as T;
}

let db: Awaited<ReturnType<typeof freshDatabase>>;
let close: (() => Promise<void>) | undefined;
let base: string;

beforeEach(async () => {
  db = await freshDatabase();
  const { port, server } = await onLockedPort((p) =>
    serveSettler(
      {
        listen: `127.0.0.1:${p}`,
        store: { url: db.url },
        settleWaitMs: 3_000,
        operatorLog: () => {},
        lnbtc: [{ network: VALID.network }, { network: TESTNET }],
      },
      LIST,
    ),
  );
  close = server.close;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  vi.useRealTimers();
  await close?.();
  close = undefined;
  await db.drop();
}, 60_000);

/** `/settle` of `payload` against `requirements`, with the settler's clock at `now`, in Unix seconds. */
async function settle(payload: PaymentPayload, requirements: PaymentRequirements, now: number): Promise<unknown> {
  vi.useFakeTimers({ toFake: ["Date"], now: now * 1000 });
  const res = await post(`${base}/settle`, { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
  expect(res.status).toBe(200);
  return res.json;
}

const success = { success: true, transaction: VALID.paymentHash, network: VALID.network };

describe("lcp's validation vectors through /settle", () => {
  it("settles fixed.P against fixed.O at fixed.now, naming the payment hash and no payer", async () => {
    expect(await settle(P, O, V.fixed.now)).toEqual(success);
  });

  // The settler validates at its own clock with x402's 60 s allowance, so a row that sets the allowance is lcp's call alone.
  const rows = (V.validate.rows as Row[]).filter((r) => r.at?.skew === undefined);
  it.each(rows.map((r) => [r.case, r] as const))("%s", async (_, r) => {
    const requirements = set(O, r.requirements ?? {});
    const answer = await settle(set(P, r.payload ?? {}), requirements, r.at?.now ?? V.fixed.now);
    expect(answer).toEqual(
      r.expect === "valid" ? success : { success: false, errorReason: r.expect, transaction: "", network: requirements.network },
    );
  });
});

describe("the record", () => {
  it("takes one payment hash once: a second settle of the proof names the hash, never a second success", async () => {
    expect(await settle(P, O, V.fixed.now)).toEqual(success);
    expect(await settle(P, O, V.fixed.now + 1)).toEqual({
      success: false,
      errorReason: "invalid_transaction_state",
      transaction: VALID.paymentHash,
      network: VALID.network,
    });
  });
});

describe("POST /verify", () => {
  it("answers unsupported_scheme, since x402's lnbtc scheme forbids a verify, and records nothing", async () => {
    const res = await post(`${base}/verify`, { x402Version: 2, paymentPayload: P, paymentRequirements: O });
    expect(res).toEqual({ status: 200, json: { isValid: false, invalidReason: "unsupported_scheme" } });
    expect((await db.pool.query("SELECT count(*)::int AS n FROM instrument")).rows).toEqual([{ n: 0 }]);
  });
});

describe("GET /supported", () => {
  it("states each network's kind: lcp's pairing, no key, no zero, no signer", async () => {
    const extra = { key: "none", acceptsZero: false, pairings: ["x402/exact/lnbtc/payment-hash"] };
    expect(await (await fetch(`${base}/supported`)).json()).toEqual({
      kinds: [
        { x402Version: 2, scheme: "exact", network: VALID.network, extra },
        { x402Version: 2, scheme: "exact", network: TESTNET, extra },
      ],
      extensions: [],
      signers: { "lnbtc:*": [] },
    });
  });
});
