/**
 * The settler's record, in Postgres: one row per instrument, keyed by the network
 * and the instrument as the form's profile names it (never the single-use value alone, never a hash a re-signed copy
 * changes). A row is claimed by one conditional insert, so two settles of one instrument submit once, and a claim is
 * never removed. A row is final only once its answer can never change: a success, a failed result that consumed the
 * value, a value another act consumed, or a validity that passed with the value unconsumed. A refused submission, one
 * that cannot have reached the node, and a failed result that consumed nothing leave the row a claim, which a repeat
 * reads again. A final row is kept at least `KEEP_AFTER_MS` past the form's lapse or life, and for the settler's life
 * where the form has neither or its nonce is not single-use.
 *
 * The same database holds the fees the settler's keys paid on each network, by which a fee budget is counted, and the
 * modules' durable state.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PendingSettlementStore } from "@x402/core/facilitator";
import type { Network } from "@x402/core/types";
import { operatorLine, type OperatorLog } from "./answers.js";
import { within } from "./http.js";
import type { FeeMeter, Instrument, Keep, ModuleState } from "./module.js";

/** The bound on acquiring a connection, on each query as the client waits for it, and on each statement in the server. */
export const STORE_TIMEOUT_MS = 5_000;

/** Opens the pool of the settler's database. `log` receives an error the pool reports for an idle connection. */
export async function openPool(url: string, log: OperatorLog = operatorLine): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: STORE_TIMEOUT_MS,
    query_timeout: STORE_TIMEOUT_MS,
    statement_timeout: STORE_TIMEOUT_MS,
  });
  pool.on("error", (e) => log({ event: "store-connection-error" }, e));
  return pool;
}

/**
 * The part of `settleWaitMs` kept for writing the answer once the wait for the chain ends: a second, or a quarter of a
 * shorter wait. The node calls and the waits end that much before the deadline, so the answer is stored, then given.
 */
export function answerReserve(settleWaitMs: number): number {
  return Math.min(1_000, settleWaitMs / 4);
}

/** A store call bounded by `STORE_TIMEOUT_MS` and by what is left before `deadline` (a `performance.now()` time). */
export function inTime<T>(p: Promise<T>, deadline: number): Promise<T> {
  return within(p, Math.min(STORE_TIMEOUT_MS, deadline - performance.now()));
}

/** How long a final row is kept past its form's lapse or life: a day, as the settler has kept one since its first release. */
export const KEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60_000;

export const RECORD_SCHEMA = `CREATE TABLE IF NOT EXISTS instrument (
  network text NOT NULL,
  key text NOT NULL,
  pairing text NOT NULL,
  claimed bigint NOT NULL,
  held_until bigint NOT NULL,
  final boolean NOT NULL DEFAULT false,
  outcome text,
  answer jsonb,
  transaction text,
  sent text[] NOT NULL DEFAULT '{}',
  body text,
  payer text,
  search jsonb,
  since jsonb,
  keep_until bigint,
  submitted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (network, key)
);
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS submitted boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS instrument_final_keep ON instrument (keep_until) WHERE final AND keep_until IS NOT NULL;
CREATE TABLE IF NOT EXISTS fee (
  network text NOT NULL,
  transaction text NOT NULL,
  at bigint NOT NULL,
  fee numeric(78, 0) NOT NULL,
  included boolean NOT NULL,
  PRIMARY KEY (network, transaction)
);
CREATE INDEX IF NOT EXISTS fee_at ON fee (network, at);
CREATE TABLE IF NOT EXISTS module_state (
  module text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (module, key)
)`;

/** A JSON value with each `bigint` written as `{"$bigint": "<decimal>"}`, so that it survives the store. */
export function toStored(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? { $bigint: v.toString() } : v)),
  ) as unknown;
}

/** A stored JSON value, with each `{"$bigint": "<decimal>"}` read back as a `bigint`. */
export function fromStored(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromStored);
  if (typeof value !== "object" || value === null) return value;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1 && keys[0] === "$bigint" && typeof o["$bigint"] === "string") return BigInt(o["$bigint"]);
  return Object.fromEntries(keys.map((k) => [k, fromStored(o[k])]));
}

/**
 * The record's key for an instrument, within its network: its kind and its parts as a JSON array, so that no two
 * instruments share one.
 */
export function keyOf(i: Instrument): string {
  switch (i.by) {
    case "single-use":
      return JSON.stringify(["single-use", i.signer, i.scope ?? null, i.value, i.signed ?? null]);
    case "transaction":
      return JSON.stringify(["transaction", i.transaction]);
    case "digest":
      return JSON.stringify(["digest", i.digest]);
  }
}

/**
 * The earliest time, in Unix milliseconds, at which a final row may be dropped, before `KEEP_AFTER_MS`: the form's
 * lapse, or its life counted from the claim; null for the settler's life, where the form has neither or its nonce is
 * not single-use.
 */
export function keepUntil(keep: Keep, nonce: string, claimed: number): number | null {
  if (nonce !== "single-use") return null;
  if (keep.until === "lapse") return keep.at;
  if (keep.until === "life") return claimed + keep.ms;
  return null;
}

/** A row of the record. Times are Unix milliseconds. */
export interface Row {
  readonly pairing: string;
  readonly claimed: number;
  /** Until when the settle that holds the claim may send; a repeat sends nothing before it. 0 once that settle answered. */
  readonly heldUntil: number;
  readonly final: boolean;
  /** For a final row: `settled`, or the reason of lcp's `failed` answer that made it final. */
  readonly outcome?: string;
  /** For a final row: the answer as first given. */
  readonly answer?: Record<string, unknown>;
  /** The transaction the row names: the last one the settler's submissions named, or the one a read found. */
  readonly transaction?: string;
  /**
   * Every transaction the settler's submissions for the claim named, first to last, the instrument's own id among them
   * where it names one: any of them can be the one that lands.
   */
  readonly sent: readonly string[];
  /** The digest of the body that claimed the row, the only body a repeat sends again. */
  readonly body?: string;
  readonly payer?: string;
  /** The search position of the last live read that gave one, which the next read resumes from. */
  readonly search?: unknown;
  /** The chain's position the module read just before the claim, from which its reads search. */
  readonly since?: unknown;
  /**
   * Whether a settle holding the claim gave the payment to the class's settle, which may have sent it although no
   * answer naming a transaction came back (the answer lost, or the settler stopped before it).
   */
  readonly submitted: boolean;
}

/** What makes a row final. */
export interface Finish {
  readonly pairing: string;
  readonly outcome: string;
  readonly answer: Record<string, unknown>;
  readonly transaction?: string;
  readonly payer?: string;
  /** As `keepUntil` gives it. */
  readonly keepUntil: number | null;
  readonly now: number;
}

export interface InstrumentRecord {
  read(network: string, key: string): Promise<Row | undefined>;
  /** Inserts the claim, held by this call until `now + holdMs`. True where this call inserted it. */
  claim(
    network: string,
    key: string,
    c: { pairing: string; payer?: string; transaction?: string; body: string; since?: unknown; now: number; holdMs: number },
  ): Promise<boolean>;
  /**
   * Takes a claim that is not final and whose hold has ended, until `now + holdMs`: the row as this call took it, or
   * undefined where it did not take it.
   */
  retake(network: string, key: string, now: number, holdMs: number): Promise<Row | undefined>;
  /** Adds a transaction the settler's submission named to a claim that is not final, as the one the row names. */
  sent(network: string, key: string, transaction: string): Promise<void>;
  /**
   * Takes back from a claim that is not final a transaction a module named before it sent it and then did not send:
   * out of `sent`, and, where the row names it, the row names the last one left, or none.
   */
  unsent(network: string, key: string, transaction: string): Promise<void>;
  /** Marks a claim that is not final as given to the class's settle; it stays marked. */
  submitting(network: string, key: string): Promise<void>;
  /** Ends this call's hold of a claim that is not final, keeping the search position of its read. */
  release(network: string, key: string, learnt: { search?: unknown }): Promise<void>;
  /**
   * Makes the row final with `f.answer`, unless it is final already; a row the record does not hold is inserted final.
   * True where this call made it final: the one call whose answer is the row's.
   */
  finish(network: string, key: string, f: Finish): Promise<boolean>;
  /** Drops the final rows kept past `KEEP_AFTER_MS` after their keep, and the fees older than `feesBefore`. */
  sweep(now: number, feesBefore: number): Promise<void>;
}

function rowOf(r: {
  pairing: string;
  claimed: string;
  held_until: string;
  final: boolean;
  outcome: string | null;
  answer: Record<string, unknown> | null;
  transaction: string | null;
  sent: string[] | null;
  body: string | null;
  payer: string | null;
  search: unknown;
  since: unknown;
  submitted: boolean;
}): Row {
  return {
    pairing: r.pairing,
    claimed: Number(r.claimed),
    heldUntil: Number(r.held_until),
    final: r.final,
    ...(r.outcome === null ? {} : { outcome: r.outcome }),
    ...(r.answer === null ? {} : { answer: r.answer }),
    ...(r.transaction === null ? {} : { transaction: r.transaction }),
    sent: r.sent ?? [],
    ...(r.body === null ? {} : { body: r.body }),
    ...(r.payer === null ? {} : { payer: r.payer }),
    ...(r.search === null || r.search === undefined ? {} : { search: fromStored(r.search) }),
    ...(r.since === null || r.since === undefined ? {} : { since: fromStored(r.since) }),
    submitted: r.submitted,
  };
}

/** The columns of a row, as `rowOf` reads them. */
const COLUMNS = "pairing, claimed, held_until, final, outcome, answer, transaction, sent, body, payer, search, since, submitted";

/** The record over `pool`, its tables created. */
export async function openRecord(pool: pg.Pool): Promise<InstrumentRecord> {
  await pool.query(RECORD_SCHEMA);
  return {
    async read(network, key) {
      const r = await pool.query<Parameters<typeof rowOf>[0]>(
        `SELECT ${COLUMNS} FROM instrument WHERE network = $1 AND key = $2`,
        [network, key],
      );
      return r.rows[0] === undefined ? undefined : rowOf(r.rows[0]);
    },
    async claim(network, key, c) {
      const r = await pool.query(
        `INSERT INTO instrument (network, key, pairing, claimed, held_until, payer, transaction, sent, body, since)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN '{}'::text[] ELSE ARRAY[$7::text] END, $8, $9)
           ON CONFLICT DO NOTHING`,
        [
          network,
          key,
          c.pairing,
          c.now,
          c.now + c.holdMs,
          c.payer ?? null,
          c.transaction ?? null,
          c.body,
          c.since === undefined ? null : JSON.stringify(toStored(c.since)),
        ],
      );
      return r.rowCount === 1;
    },
    async retake(network, key, now, holdMs) {
      const r = await pool.query<Parameters<typeof rowOf>[0]>(
        `UPDATE instrument SET held_until = $4 WHERE network = $1 AND key = $2 AND NOT final AND held_until <= $3
           RETURNING ${COLUMNS}`,
        [network, key, now, now + holdMs],
      );
      return r.rows[0] === undefined ? undefined : rowOf(r.rows[0]);
    },
    async sent(network, key, transaction) {
      await pool.query(
        `UPDATE instrument SET transaction = $3,
             sent = CASE WHEN $3 = ANY(sent) THEN sent ELSE array_append(sent, $3::text) END
           WHERE network = $1 AND key = $2 AND NOT final`,
        [network, key, transaction],
      );
    },
    async unsent(network, key, transaction) {
      await pool.query(
        `UPDATE instrument SET sent = array_remove(sent, $3::text),
             transaction = CASE WHEN transaction = $3 THEN (array_remove(sent, $3::text))[cardinality(array_remove(sent, $3::text))]
               ELSE transaction END
           WHERE network = $1 AND key = $2 AND NOT final`,
        [network, key, transaction],
      );
    },
    async submitting(network, key) {
      await pool.query(`UPDATE instrument SET submitted = true WHERE network = $1 AND key = $2 AND NOT final`, [network, key]);
    },
    async release(network, key, learnt) {
      await pool.query(
        `UPDATE instrument SET held_until = 0, search = COALESCE($3, search) WHERE network = $1 AND key = $2 AND NOT final`,
        [network, key, learnt.search === undefined ? null : JSON.stringify(toStored(learnt.search))],
      );
    },
    async finish(network, key, f) {
      const r = await pool.query(
        `INSERT INTO instrument (network, key, pairing, claimed, held_until, final, outcome, answer, transaction, payer,
             keep_until)
           VALUES ($1, $2, $3, $4, 0, true, $5, $6, $7, $8, $9)
           ON CONFLICT (network, key) DO UPDATE SET final = true, held_until = 0, outcome = EXCLUDED.outcome,
             answer = EXCLUDED.answer, transaction = COALESCE(EXCLUDED.transaction, instrument.transaction),
             payer = COALESCE(instrument.payer, EXCLUDED.payer), keep_until = EXCLUDED.keep_until
           WHERE NOT instrument.final`,
        [
          network,
          key,
          f.pairing,
          f.now,
          f.outcome,
          JSON.stringify(f.answer),
          f.transaction ?? null,
          f.payer ?? null,
          f.keepUntil,
        ],
      );
      return r.rowCount === 1;
    },
    async sweep(now, feesBefore) {
      await pool.query(`DELETE FROM instrument WHERE final AND keep_until IS NOT NULL AND keep_until < $1`, [
        now - KEEP_AFTER_MS,
      ]);
      await pool.query(`DELETE FROM fee WHERE at < $1`, [feesBefore]);
    },
  };
}

/** One network's fee budget: an amount of its fee asset, in its smallest unit, over a period of seconds. */
export interface FeeBudget {
  readonly network: Network;
  readonly amount: bigint;
  readonly periodSeconds: number;
}

/** The fee count of the networks that have a budget. */
export interface Fees {
  /** Whether `network` has a budget. */
  budgeted(network: string): boolean;
  /** Whether `network`'s budget is spent: its count over the last period has reached its amount. */
  spent(network: string, now: number): Promise<boolean>;
  /**
   * Counts a transaction the settler submitted on `network`: `fee` is its bound until `included`, then what it paid. A
   * paid fee is never replaced by a bound, and the transaction keeps the time it was first counted at.
   */
  count(network: string, transaction: string, fee: bigint, included: boolean, now: number): Promise<void>;
  /** The meter an own module whose key pays fees on `network` is given. */
  meter(network: Network, now: () => number, log: OperatorLog): FeeMeter;
  /** The oldest time any budget's period still counts. */
  oldest(now: number): number;
}

/** The fee count over `pool`, for `budgets`, at most one per network. */
export function feesOn(pool: pg.Pool, budgets: readonly FeeBudget[]): Fees {
  const byNetwork = new Map(budgets.map((b) => [b.network as string, b]));
  const longest = Math.max(0, ...budgets.map((b) => b.periodSeconds * 1000));
  async function counted(q: Pick<pg.Pool, "query">, b: FeeBudget, now: number): Promise<bigint> {
    const r = await q.query<{ n: string }>(
      "SELECT COALESCE(sum(fee), 0)::text AS n FROM fee WHERE network = $1 AND at > $2",
      [b.network, now - b.periodSeconds * 1000],
    );
    return BigInt(r.rows[0]!.n);
  }
  const fees: Fees = {
    budgeted: (network) => byNetwork.has(network),
    async spent(network, now) {
      const b = byNetwork.get(network);
      return b !== undefined && (await counted(pool, b, now)) >= b.amount;
    },
    async count(network, transaction, fee, included, now) {
      if (!byNetwork.has(network)) return;
      await pool.query(
        `INSERT INTO fee (network, transaction, at, fee, included) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (network, transaction) DO UPDATE SET fee = EXCLUDED.fee, included = EXCLUDED.included
           WHERE NOT fee.included`,
        [network, transaction, now, fee.toString(), included],
      );
    },
    meter(network, now, log) {
      return {
        async sending(s) {
          const b = byNetwork.get(network);
          if (b === undefined) return true;
          // One sender at a time per network, so that two never both pass a count that has room for one.
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`fee:${network}`]);
            const at = now();
            if ((await counted(client, b, at)) >= b.amount) {
              await client.query("ROLLBACK");
              return false;
            }
            // A transaction whose id is not known before it is sent is counted at its bound for the whole period.
            const id = s.transaction ?? `unnamed:${randomUUID()}`;
            await client.query(
              `INSERT INTO fee (network, transaction, at, fee, included) VALUES ($1, $2, $3, $4, false)
                 ON CONFLICT (network, transaction) DO NOTHING`,
              [network, id, at, s.bound.toString()],
            );
            await client.query("COMMIT");
            return true;
          } catch (e) {
            await client.query("ROLLBACK").catch(() => {});
            throw e;
          } finally {
            client.release();
          }
        },
        included(i) {
          fees.count(network, i.transaction, i.fee, true, now()).catch((e: unknown) =>
            log({ event: "store-call-failed", network, transaction: i.transaction, call: "fee" }, e),
          );
        },
        sent(transaction, shown) {
          if (!byNetwork.has(network)) return;
          shown()
            .then((c) => {
              if (c === undefined) return log({ event: "fee-not-counted", network, transaction, reason: "not-shown" });
              return fees.count(network, transaction, c.fee, c.included, now());
            })
            .catch((e: unknown) => log({ event: "fee-not-counted", network, transaction }, e));
        },
      };
    },
    oldest: (now) => now - longest,
  };
  return fees;
}

/** `module`'s durable state over `pool`. */
export function moduleState(pool: pg.Pool, module: string): ModuleState {
  const state: ModuleState = {
    async get(key) {
      const r = await pool.query<{ value: unknown }>("SELECT value FROM module_state WHERE module = $1 AND key = $2", [
        module,
        key,
      ]);
      return r.rows[0] === undefined ? undefined : fromStored(r.rows[0].value);
    },
    async set(key, value) {
      await pool.query(
        `INSERT INTO module_state (module, key, value) VALUES ($1, $2, $3)
           ON CONFLICT (module, key) DO UPDATE SET value = EXCLUDED.value`,
        [module, key, JSON.stringify(toStored(value))],
      );
    },
    async swap(key, expected, value) {
      const stored = JSON.stringify(toStored(value));
      const r =
        expected === undefined
          ? await pool.query(
              "INSERT INTO module_state (module, key, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [module, key, stored],
            )
          : await pool.query("UPDATE module_state SET value = $3 WHERE module = $1 AND key = $2 AND value = $4::jsonb", [
              module,
              key,
              stored,
              JSON.stringify(toStored(expected)),
            ]);
      return r.rowCount === 1;
    },
    async delete(key) {
      await pool.query("DELETE FROM module_state WHERE module = $1 AND key = $2", [module, key]);
    },
    pendingSettlements(): PendingSettlementStore {
      const named = (key: string) => `pending-settlement:${key}`;
      return {
        async get(key) {
          const v = await state.get(named(key));
          return typeof v === "string" ? v : undefined;
        },
        set: (key, txHash) => state.set(named(key), txHash),
        delete: (key) => state.delete(named(key)),
      };
    },
  };
  return state;
}

/** Runs `record.sweep` every minute until the returned function is called; a sweep that fails goes to `log`. */
export function sweeping(record: InstrumentRecord, fees: Fees, log: OperatorLog = operatorLine): () => void {
  const timer = setInterval(() => {
    const now = Date.now();
    record.sweep(now, fees.oldest(now)).catch((e: unknown) => log({ event: "store-call-failed", call: "sweep" }, e));
  }, SWEEP_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
