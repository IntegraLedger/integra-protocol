/**
 * The settler's core: x402's facilitator class (`x402Facilitator` of `@x402/core/facilitator`) holding one wrapper per
 * configured scheme and network, for `/verify` and for `/settle` each, the record, the fee budget, the caller's
 * credential and the operator log, behind `GET /supported`, `POST /verify` and `POST /settle` over `node:http`. The core
 * holds no chain's rule and no key: each module's facilitator verifies and settles, and the core decides only what its
 * record, its budget and lcp's read of the chain tell it.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { x402Facilitator } from "@x402/core/facilitator";
import type { Network, PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";
import {
  failed,
  guarded,
  invalid,
  isObject,
  operatorLine,
  pending,
  readShape,
  type FacilitatorRequest,
  type OperatorEntry,
  type OperatorLog,
  type SettleAnswer,
  type VerifyAnswer,
} from "./answers.js";
import { NODE_TIMEOUT_MS, readRequestJson, sendJson, sleep, X402_REQUEST_MAX_BYTES } from "./http.js";
import type {
  ChainRead,
  Core,
  Instrumented,
  Module,
  ModuleName,
  OfferedHandoff,
  Registration,
  X402Payment,
} from "./module.js";
import type { Listed, ModulesConfig } from "./modules/index.js";
import {
  answerReserve,
  feesOn,
  inTime,
  keepUntil,
  keyOf,
  moduleState,
  openPool,
  openRecord,
  sweeping,
  type FeeBudget,
  type Row,
} from "./record.js";
import { settleReason, unexpectedSettle, unexpectedVerify } from "./unexpected.js";
import { declared, kindOf, modulesOf, route, unsound, Wrapper, type Kind } from "./wrapper.js";

/** One network's fee budget as the operator configures it: an amount of its fee asset over a period of seconds. */
export interface FeeBudgetConfig {
  readonly network: Network;
  /** In the smallest unit of the network's fee asset: a `bigint`, or its decimal digits. */
  readonly amount: bigint | string;
  readonly periodSeconds: number;
}

/** The members of the configuration the core reads; each listed module's own member is with them. */
export interface SettlerConfig {
  /** "host:port" */
  listen: string;
  /** Postgres: the record, the fee count and the modules' durable state. */
  store: { url: string };
  /** How long `/settle` waits for inclusion before answering `settlement_pending`; default 30 000. */
  settleWaitMs: number;
  /**
   * The credential every call must present as `Authorization: Bearer <credential>`. A deployment with a module that
   * holds a key does not start without one, since the caller names the payee and the amount and the key pays a fee
   * for whatever is submitted. Its characters are those RFC 6750 admits in a bearer token.
   */
  credential?: string;
  /** The fee budgets, at most one per network, each on a network a configured module serves. */
  feeBudgets?: readonly FeeBudgetConfig[];
  /**
   * Receives every entry for the operator: what the facilitator saw that its answer does not carry, with `network`,
   * `payer` and `transaction` naming the payment where they are known. `cause` is the error that caused the entry,
   * when there is one; the answer to the client is the same either way, and carries nothing from it. Called once per
   * entry; what it throws, or a promise it returns that rejects, goes to the default with an `operator-log-failed`
   * entry. Default: one JSON line per entry on standard error, the cause as its `cause` (name, message, stack and its
   * own `cause` chain).
   */
  operatorLog?: (
    entry: { event: string; network?: string; payer?: string; transaction?: string; [field: string]: unknown },
    cause?: unknown,
  ) => void;
}

const DEFAULT_SETTLE_WAIT_MS = 30_000;
/** How often a settle that finds another settle holding the claim reads the record again. */
const WATCH_MS = 1_000;
/** RFC 6750's `b64token`, the characters a bearer credential may hold. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;

/** The body's `paymentRequirements.network` when it is a string, else "". */
function networkOf(body: unknown): string {
  const requirements = isObject(body) ? body["paymentRequirements"] : undefined;
  const network = isObject(requirements) ? requirements["network"] : undefined;
  return typeof network === "string" ? network : "";
}

function hostPort(listen: string): { host: string; port: number } {
  const m = /^\[?([^\]]*)\]?:(\d{1,5})$/.exec(listen);
  const port = m === null ? NaN : Number(m[2]);
  if (m === null || !(port >= 0 && port <= 65_535)) throw new TypeError(`listen must be "host:port": ${listen}`);
  return { host: m[1]!, port };
}

/** The budgets as configured, each checked: a positive amount, a positive whole number of seconds, one per network. */
function budgetsOf(configured: readonly FeeBudgetConfig[]): FeeBudget[] {
  const seen = new Set<string>();
  return configured.map((b) => {
    const amount = typeof b.amount === "bigint" ? b.amount : /^[0-9]+$/.test(b.amount) ? BigInt(b.amount) : -1n;
    if (amount <= 0n) throw new TypeError(`the fee budget of ${b.network}: its amount is not a positive integer`);
    if (!Number.isSafeInteger(b.periodSeconds) || b.periodSeconds <= 0) {
      throw new TypeError(`the fee budget of ${b.network}: its period is not a positive number of seconds`);
    }
    if (seen.has(b.network)) throw new TypeError(`${b.network} has two fee budgets`);
    seen.add(b.network);
    return { network: b.network, amount, periodSeconds: b.periodSeconds };
  });
}

/** Whether `req` presents the credential whose SHA-256 is `expected`, compared in constant time. */
function presents(req: IncomingMessage, expected: Buffer): boolean {
  const header = req.headers["authorization"];
  const m = typeof header === "string" ? /^Bearer +(\S+) *$/i.exec(header) : null;
  const given = createHash("sha256")
    .update(m?.[1] ?? "")
    .digest();
  return timingSafeEqual(given, expected) && m !== null;
}

/** Whether two spellings of a transaction id name one transaction: the same digits, with or without `0x`, in any case. */
function sameTransaction(a: string, b: string): boolean {
  const plain = (t: string) => t.replace(/^0x/i, "").toLowerCase();
  return plain(a) === plain(b);
}

/** A JSON value with each object's members in the order of their names, so that one value has one spelling. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v !== "object" || v === null) return v;
  const o = v as Record<string, unknown>;
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonical(o[k])]));
}

/** The digest of a payment's body as presented: its payload and its requirements, whatever order their members came in. */
function bodyOf(p: X402Payment): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ payload: p.payload, requirements: p.requirements })))
    .digest("hex");
}

/** A read the core could not make: nothing is known of the instrument. */
const UNREAD: ChainRead = { outcome: "live", answer: { state: "unreadable", reason: "transport", foreign: [] } };

/** One settle of one instrument, as the core carries it through its steps. */
interface Attempt {
  readonly network: Network;
  readonly key: string;
  readonly kind: Kind;
  readonly module: Module;
  readonly payment: X402Payment;
  readonly instrumented: Instrumented;
  /** `settleWaitMs` after the request, a `performance.now()` time. */
  readonly deadline: number;
  /** The deadline less the time kept for storing the answer: the reads and the submission end by it. */
  readonly waitUntil: number;
}

/**
 * Starts the settler with the modules of `list` that `c` names. The public start function passes the settler's own
 * list; a test passes one of its own.
 */
export async function serveSettler<List extends readonly Listed<ModuleName, never>[]>(
  c: SettlerConfig & ModulesConfig<List>,
  list: List,
): Promise<{ close(): Promise<void> }> {
  const { host, port } = hostPort(c.listen);
  const settleWaitMs = Number.isFinite(c.settleWaitMs) && c.settleWaitMs > 0 ? c.settleWaitMs : DEFAULT_SETTLE_WAIT_MS;
  const log = guarded(c.operatorLog ?? operatorLine);
  if (c.credential !== undefined && !B64TOKEN.test(c.credential)) {
    throw new TypeError("credential must be a bearer token: letters, digits and -._~+/, then any =");
  }
  const credential = c.credential === undefined ? undefined : createHash("sha256").update(c.credential).digest();
  const budgets = budgetsOf(c.feeBudgets ?? []);
  const pool = await openPool(c.store.url, log);
  // If the settler does not start, what it opened is closed before its error goes to the caller unchanged: the
  // modules, the sweep and the pool.
  const closers: (() => Promise<void>)[] = [];
  let stopSweep = (): void => {};
  try {
    const record = await openRecord(pool);
    const fees = feesOn(pool, budgets);
    stopSweep = sweeping(record, fees, log);

    // The modules the configuration names, each started from its own member alone.
    const configured = c as unknown as Record<string, unknown>;
    const registrations: Registration[] = [];
    const offered: OfferedHandoff[] = [];
    // The modules started with the fee meter of their network: their keys' fees are counted as they send.
    const metered = new Set<Module>();
    for (const listed of list) {
      const own = configured[listed.name];
      if (own === undefined) continue;
      const starter = await listed.load();
      const meters = new Set<string>();
      const core: Core = {
        log,
        settleWaitMs,
        state: moduleState(pool, listed.name),
        meter: (network) => {
          meters.add(network);
          return fees.meter(network, () => Date.now(), log);
        },
      };
      const started = await starter.start(own as never, core);
      if (started.close !== undefined) closers.push(started.close);
      registrations.push(...started.registrations);
      offered.push(...(started.handoffs ?? []));
      for (const r of started.registrations) for (const m of modulesOf(r)) if (meters.has(m.network)) metered.add(m);
      for (const o of started.handoffs ?? []) if (meters.has(o.network)) metered.add(o.handoff.module);
    }
    // Each own module offered to another module's registration goes behind that registration's own modules.
    for (const o of offered) {
      const at = registrations.findIndex((r) => r.network === o.network && r.module.facilitator.scheme === o.scheme);
      if (at < 0) throw new TypeError(`an own module is offered to ${o.scheme} on ${o.network}, which no module registers`);
      const r = registrations[at]!;
      registrations[at] = { ...r, own: [...r.own, o.handoff] };
    }
    const kinds = new Map<string, Kind>();
    const networks = new Set<string>();
    for (const r of registrations) {
      const why = unsound(r);
      if (why !== undefined) throw new TypeError(why);
      const at = `${r.module.facilitator.scheme} ${r.network}`;
      if (kinds.has(at)) throw new TypeError(`two registrations of ${at}`);
      kinds.set(at, kindOf(r, fees.budgeted(r.network)));
      networks.add(r.network);
    }
    for (const b of budgets) {
      if (!networks.has(b.network)) throw new TypeError(`the fee budget of ${b.network}: no module serves it`);
    }
    // A budget holds only where it counts every fee a key pays: each module with a key meters its sends or shows
    // the fee of what its facilitator sent.
    for (const r of registrations) {
      if (!fees.budgeted(r.network)) continue;
      for (const m of modulesOf(r)) {
        if (m.descriptor.key === "none" || m.fees.charged !== undefined || metered.has(m)) continue;
        throw new TypeError(`the fee budget of ${r.network}: the ${m.descriptor.name} module's key pays fees it neither meters nor shows`);
      }
    }
    const keyed = [...kinds.values()].filter((k) => k.key !== "none");
    if (credential === undefined && keyed.length > 0) {
      throw new TypeError(`a module holds a key (${keyed.map((k) => `${k.scheme} on ${k.network}`).join(", ")}): credential is required`);
    }
    // x402's class twice, one wrapper per kind in each: `facilitator`'s wrappers verify in `/verify`'s phase, and give
    // `/supported`; `settling`'s verify in `/settle`'s, for the check `/settle` makes before it submits, and submit.
    const facilitator = new x402Facilitator();
    const settling = new x402Facilitator();
    for (const kind of kinds.values()) {
      facilitator.register(kind.network as Network, new Wrapper(kind, "verify"));
      settling.register(kind.network as Network, new Wrapper(kind, "settle"));
    }

    function supported() {
      const s = facilitator.getSupported();
      return { kinds: s.kinds, extensions: s.extensions, signers: s.signers };
    }

    /** The kind that serves the request's scheme and network, or why none does. */
    function kindAt(r: FacilitatorRequest): Kind | "invalid_network" | "unsupported_scheme" {
      const { scheme, network } = r.paymentRequirements;
      if (!networks.has(network)) return "invalid_network";
      return kinds.get(`${scheme} ${network}`) ?? "unsupported_scheme";
    }

    function paymentOf(r: FacilitatorRequest): X402Payment {
      return {
        payload: r.paymentPayload as unknown as PaymentPayload,
        requirements: r.paymentRequirements as unknown as PaymentRequirements,
      };
    }

    /** Whether a spent budget refuses the payment: the module's key pays its fee, and its payer did not broadcast it. */
    function gated(m: Module, p: X402Payment): boolean {
      return m.fees.paysFee(p) && !m.fees.payerBroadcast(p);
    }

    /** The fields that name an attempt's payment in an operator entry. */
    function about(a: Attempt, more: { payer?: string; transaction?: string } = {}): OperatorEntry & { network: string } {
      const entry: OperatorEntry & { network: string } = { event: "", network: a.network };
      if (more.payer !== undefined) entry.payer = more.payer;
      const transaction =
        more.transaction ?? (a.instrumented.instrument.by === "transaction" ? a.instrumented.instrument.transaction : undefined);
      if (transaction !== undefined) entry.transaction = transaction;
      return entry;
    }

    /**
     * lcp's read of the attempt's instrument through its module, ending by the attempt's `waitUntil`, resuming from
     * `search`. A read the deadline leaves no time for is not made, and one that fails is given to the operator log:
     * either leaves the instrument live, as an unreadable answer does.
     */
    async function readChain(
      a: Attempt,
      held: { search?: unknown; since?: unknown; transaction?: string | undefined },
    ): Promise<ChainRead> {
      if (a.waitUntil - performance.now() <= 0) return UNREAD;
      try {
        return await a.module.record.read(a.payment, {
          deadline: a.waitUntil,
          ...(held.search === undefined ? {} : { search: held.search }),
          ...(held.since === undefined ? {} : { from: held.since }),
          ...(held.transaction === undefined ? {} : { transaction: held.transaction }),
        });
      } catch (e) {
        log({ ...about(a), event: "read-failed" }, e);
        return UNREAD;
      }
    }

    /**
     * Counts the fee of a transaction the attempt's published class sent, where its network has a budget. It is asked
     * once the answer is stored, on its own bounds, since the class's settle runs on its own and can outlast the
     * request.
     */
    async function countFee(a: Attempt, transaction: string): Promise<void> {
      const charged = a.module.fees.charged;
      if (!fees.budgeted(a.network) || charged === undefined || !gated(a.module, a.payment)) return;
      try {
        const deadline = performance.now() + NODE_TIMEOUT_MS;
        const shown = await charged.call(a.module.fees, a.payment, { transaction, deadline });
        await inTime(fees.count(a.network, transaction, shown.fee, shown.included, Date.now()), Infinity);
      } catch (e) {
        log({ ...about(a, { transaction }), event: "fee-not-counted" }, e);
      }
    }

    /**
     * Keeps a transaction the attempt's submission named in its row, before anything else is asked, so that a read
     * or a repeat knows it; a failure goes to the log. The store call has its own bound, the request's being spent.
     */
    async function note(a: Attempt, transaction: string): Promise<void> {
      try {
        await inTime(record.sent(a.network, a.key, transaction), Infinity);
      } catch (e) {
        log({ ...about(a, { transaction }), event: "store-call-failed", call: "sent" }, e);
      }
    }

    /** Ends the attempt's hold of its claim, keeping what it learnt; a failure goes to the log, and the hold lapses. */
    async function release(a: Attempt, learnt: { search?: unknown }): Promise<void> {
      try {
        await inTime(record.release(a.network, a.key, learnt), Infinity);
      } catch (e) {
        log({ ...about(a), event: "store-call-failed", call: "release" }, e);
      }
    }

    /**
     * Makes the attempt's row final. True where this call made it final, false where another call had; undefined
     * where the store did not answer, which goes to the log.
     */
    async function finish(
      a: Attempt,
      f: { outcome: string; answer: object; transaction?: string; payer?: string; claimed?: number },
    ): Promise<boolean | undefined> {
      const now = Date.now();
      try {
        return await inTime(
          record.finish(a.network, a.key, {
            pairing: a.instrumented.pairing,
            outcome: f.outcome,
            answer: f.answer as Record<string, unknown>,
            ...(f.transaction === undefined ? {} : { transaction: f.transaction }),
            ...(f.payer === undefined ? {} : { payer: f.payer }),
            keepUntil: keepUntil(a.instrumented.keep, a.instrumented.nonce, f.claimed ?? now),
            now,
          }),
          // Its own bound: what the chain showed is stored even where the request's deadline has passed.
          Infinity,
        );
      } catch (e) {
        log({ ...about(a, f), event: "answer-not-stored" }, e);
        return undefined;
      }
    }

    /** `/settle`'s answer to a row that is final: never a second success, and the transaction it names. */
    function answerFinal(a: Attempt, row: Row): SettleAnswer {
      return failed("invalid_transaction_state", row.transaction ?? "", a.network);
    }

    /**
     * The answer, once lcp's read shows the instrument final, and the row made final. A success is this settler's only
     * where it sent the payment (`sent`, every transaction its submissions for the claim named) and the read shows
     * settled one of those transactions, or the payment presented itself, which lcp's read can name otherwise than the
     * submission did (a Polkadot extrinsic by its timepoint, not its hash); and only to the call that made the row
     * final. A landed act that is another body than the one presented is never that call's success. One that landed by
     * another route is `invalid_transaction_state` naming it. A failed instrument is `invalid_transaction_state` naming
     * the transaction the read found, or the last one the settler sent, or the class's own failure where it named the
     * transaction it sent.
     */
    async function byFinalRead(
      a: Attempt,
      read: Extract<ChainRead, { outcome: "final" }>,
      sent: readonly string[],
      payer: string | undefined,
      claimed: number | undefined,
      classAnswer?: SettleResponse,
    ): Promise<SettleAnswer | SettleResponse> {
      const answer = read.answer;
      const kept = { ...(payer === undefined ? {} : { payer }), ...(claimed === undefined ? {} : { claimed }) };
      if (answer.state === "settled") {
        const mine = sent.find((t) => sameTransaction(answer.transaction, t));
        if (mine !== undefined && answer.presented === "no") {
          // The settler's transaction, of another body under this instrument than this call presents: not this call's
          // success, and the row stays the claim's.
          await release(a, {});
          return failed("invalid_transaction_state", answer.transaction, a.network);
        }
        if (mine !== undefined || (sent.length > 0 && answer.presented === "yes")) {
          const transaction = mine ?? answer.transaction;
          const success = { success: true as const, transaction, network: a.network, payer: payer ?? "" };
          const wrote = await finish(a, { outcome: "settled", answer: success, transaction, ...kept });
          void countFee(a, transaction);
          if (wrote === undefined) return pending(transaction, a.network);
          return wrote ? success : failed("invalid_transaction_state", transaction, a.network);
        }
        const refused = failed("invalid_transaction_state", answer.transaction, a.network);
        await finish(a, { outcome: "settled", answer: refused, transaction: answer.transaction, ...kept });
        return refused;
      }
      const last = sent.at(-1);
      if (last !== undefined) void countFee(a, last);
      const own = classAnswer !== undefined && classAnswer.transaction !== "" ? classAnswer : undefined;
      const named = answer.transaction ?? own?.transaction ?? last;
      const refused = own ?? failed("invalid_transaction_state", named ?? "", a.network);
      await finish(a, { outcome: answer.reason, answer: refused, ...(named === undefined ? {} : { transaction: named }), ...kept });
      return refused;
    }

    /**
     * For a claim this attempt holds: the fee budget, just before anything is sent; the submission of what
     * the payer signed, through x402's class and the kind's wrapper; then the answer: a success the class gives once
     * it is stored final, else by lcp's read. `sent` is every transaction earlier submissions for the claim named.
     */
    async function submit(
      a: Attempt,
      payer: string | undefined,
      sent: readonly string[],
      claimed: number,
      since: unknown,
    ): Promise<SettleAnswer | SettleResponse> {
      if (gated(a.module, a.payment)) {
        let spent: boolean;
        try {
          spent = await inTime(fees.spent(a.network, Date.now()), a.deadline);
        } catch (e) {
          await release(a, {});
          return unexpectedSettle(log, { ...about(a, { ...(payer === undefined ? {} : { payer }) }), event: "store-call-failed", call: "fee" }, e);
        }
        if (spent) {
          await release(a, {});
          return failed("fee_budget_spent", "", a.network);
        }
      }
      if (a.waitUntil - performance.now() <= 0) {
        await release(a, {});
        return unexpectedSettle(log, { ...about(a), event: "settle-deadline-passed", before: "submission", settleWaitMs });
      }
      let s: SettleResponse | undefined;
      let thrown: { cause: unknown } | undefined;
      try {
        s = await settling.settle(a.payment.payload, a.payment.requirements);
      } catch (e) {
        thrown = { cause: e };
      }
      const failure = { ...about(a, { ...(payer === undefined ? {} : { payer }) }), event: "settle-error" };
      const named = s !== undefined && s.transaction !== "" ? s.transaction : undefined;
      if (s?.success === true) {
        // A success is given only once the row holds it final, with the transaction it names where it names one (a
        // published class's settle of a zero amount names none): a repeat is then answered from the record.
        const answerPayer = s.payer ?? payer;
        const wrote = await finish(a, {
          outcome: "settled",
          answer: s,
          ...(named === undefined ? {} : { transaction: named }),
          ...(answerPayer === undefined ? {} : { payer: answerPayer }),
          claimed,
        });
        if (named !== undefined) void countFee(a, named);
        if (wrote === true) return s;
        if (wrote === false) return failed("invalid_transaction_state", named ?? "", a.network);
        // A success that names no transaction and could not be stored: no pending answer can name it.
        if (named === undefined) return unexpectedSettle(log, { ...about(a), event: "success-not-stored" });
        return pending(named, a.network);
      }
      const all = named === undefined || sent.some((t) => sameTransaction(t, named)) ? sent : [...sent, named];
      if (named !== undefined) {
        await note(a, named);
        void countFee(a, named);
      }
      const read = await readChain(a, { since, transaction: all.at(-1) });
      if (thrown !== undefined && (read.outcome === "final" || all.length > 0)) log(failure, thrown.cause);
      if (read.outcome === "final") return byFinalRead(a, read, all, s?.payer ?? payer, claimed, s);
      const live = read.answer;
      await release(a, live.state === "pending" && live.search !== undefined ? { search: live.search } : {});
      if (s !== undefined && named !== undefined) {
        // A failed result that consumed nothing is the class's own answer; anything else sent is not yet shown.
        const consumedNothing = live.state === "pending" && live.reason === "instrument-live" && live.transaction !== undefined;
        return consumedNothing ? s : pending(named, a.network);
      }
      if (s !== undefined) return s;
      const last = all.at(-1);
      return last === undefined ? unexpectedSettle(log, failure, thrown?.cause) : pending(last, a.network);
    }

    /**
     * A claim another settle holds and may be sending: the row is read until that settle answers or its hold ends,
     * and the chain then, and nothing is sent.
     */
    async function watch(a: Attempt, row: Row): Promise<SettleAnswer | SettleResponse> {
      let current = row;
      for (;;) {
        if (current.final) return answerFinal(a, current);
        if (current.heldUntil <= Date.now()) {
          const read = await readChain(a, current);
          if (read.outcome === "final") return byFinalRead(a, read, current.sent, current.payer, current.claimed);
          if (read.answer.state === "pending" && read.answer.reason === "below-mark" && read.answer.transaction !== undefined) {
            return pending(read.answer.transaction, a.network);
          }
          if (current.transaction !== undefined) return pending(current.transaction, a.network);
          return unexpectedSettle(log, { ...about(a), event: "claim-unread", reason: read.answer.reason });
        }
        if (performance.now() + WATCH_MS > a.waitUntil) {
          if (current.transaction !== undefined) return pending(current.transaction, a.network);
          return unexpectedSettle(log, { ...about(a), event: "settle-deadline-passed", before: "claim-held", settleWaitMs });
        }
        await sleep(WATCH_MS);
        let next: Row | undefined;
        try {
          next = await inTime(record.read(a.network, a.key), a.deadline);
        } catch (e) {
          log({ ...about(a), event: "store-call-failed", call: "read" }, e);
          next = undefined;
        }
        if (next !== undefined) current = next;
      }
    }

    /**
     * A claim the record holds that is not final. Where another settle holds it, this one watches. Otherwise it takes
     * the claim, reads the chain, and submits the identical signed payment again only where the form's nonce is
     * single-use, the read shows the value unconsumed and its validity open (`instrument-live`), the body is the one
     * that claimed the row, and `/verify`'s checks pass for it again.
     */
    async function held(a: Attempt, row: Row): Promise<SettleAnswer | SettleResponse> {
      if (row.heldUntil > Date.now()) return watch(a, row);
      let took: Row | undefined;
      try {
        took = await inTime(record.retake(a.network, a.key, Date.now(), settleWaitMs), a.deadline);
      } catch (e) {
        return unread(a, e, "retake");
      }
      if (took === undefined) {
        const again = await inTime(record.read(a.network, a.key), a.deadline).catch(() => undefined);
        return watch(a, again ?? { ...row, heldUntil: Date.now() + settleWaitMs });
      }
      const read = await readChain(a, took);
      if (read.outcome === "final") return byFinalRead(a, read, took.sent, took.payer, took.claimed);
      const live = read.answer;
      const search = live.state === "pending" && live.search !== undefined ? { search: live.search } : {};
      if (live.state === "pending" && live.reason === "instrument-live" && resendable(a.instrumented)) {
        if (took.body !== bodyOf(a.payment)) {
          // Another body under the claimed instrument (a copy signed again): never sent in place of the one claimed.
          await release(a, search);
          return failed("invalid_transaction_state", took.transaction ?? "", a.network);
        }
        const v = await settling.verify(a.payment.payload, a.payment.requirements);
        if (!v.isValid) {
          await release(a, search);
          return failed(settleReason(v.invalidReason ?? "invalid_payload"), "", a.network);
        }
        return submit(a, took.payer, took.sent, took.claimed, took.since);
      }
      await release(a, search);
      if (live.state === "pending" && live.reason === "below-mark" && live.transaction !== undefined) {
        return pending(live.transaction, a.network);
      }
      if (took.transaction !== undefined) return pending(took.transaction, a.network);
      return unexpectedSettle(log, { ...about(a), event: "claim-unread", reason: live.reason });
    }

    /**
     * Whether a held claim may be sent again: only where the form's nonce is single-use, and never for an instrument
     * named by the digest of its signed payment, which one settler submits once.
     */
    function resendable(i: Instrumented): boolean {
      return i.nonce === "single-use" && i.instrument.by !== "digest";
    }

    /** The transaction an instrument keyed by its transaction id names, which is known before it is sent. */
    function known(i: Instrumented): string | undefined {
      return i.instrument.by === "transaction" ? i.instrument.transaction : undefined;
    }

    /**
     * The answer where the record could not be read or written: the settler cannot know whether the payment was sent,
     * so it is pending where its transaction is known before it is sent, and the settler's own failure otherwise.
     */
    function unread(a: Attempt, e: unknown, call: string): SettleAnswer {
      const transaction = known(a.instrumented);
      if (transaction !== undefined) {
        log({ ...about(a), event: "store-call-failed", call }, e);
        return pending(transaction, a.network);
      }
      return unexpectedSettle(log, { ...about(a), event: "store-call-failed", call }, e);
    }

    async function verify(body: unknown): Promise<VerifyAnswer | VerifyResponse> {
      const r = readShape(body);
      if (typeof r === "string") return invalid(r);
      const network = r.paymentRequirements.network;
      const kind = kindAt(r);
      if (typeof kind === "string") return invalid(kind);
      const p = paymentOf(r);
      try {
        const m = route(kind.registration, p.payload, p.requirements);
        if (m.descriptor.verifyForbidden === true) return invalid("unsupported_scheme");
        const i = await m.record.instrument(p);
        if ("refused" in i) return { isValid: false, invalidReason: i.refused, ...(i.message === undefined ? {} : { invalidMessage: i.message }) };
        const landed = m.descriptor.verifiesLanded === true;
        if (!landed) {
          let row: Row | undefined;
          try {
            row = await inTime(record.read(network, keyOf(i.instrument)), Infinity);
          } catch (e) {
            return invalid(unexpectedVerify(log, { event: "store-call-failed", network, call: "read" }, e));
          }
          if (row !== undefined) return invalid("invalid_transaction_state", row.payer);
        }
        const excluded = declared(kind, m, p, i, "verify");
        if (excluded !== undefined) return { isValid: false, invalidReason: excluded };
        if (gated(m, p)) {
          let spent: boolean;
          try {
            spent = await inTime(fees.spent(network, Date.now()), Infinity);
          } catch (e) {
            return invalid(unexpectedVerify(log, { event: "store-call-failed", network, call: "fee" }, e));
          }
          if (spent) return invalid("fee_budget_spent");
        }
        const v = await facilitator.verify(p.payload, p.requirements);
        if (!v.isValid || landed) return v;
        let read: ChainRead;
        try {
          read = await m.record.read(p, { deadline: performance.now() + settleWaitMs });
        } catch (e) {
          log({ event: "read-failed", network, ...(v.payer === undefined ? {} : { payer: v.payer }) }, e);
          return v;
        }
        return read.outcome === "final" ? invalid("invalid_transaction_state", v.payer) : v;
      } catch (e) {
        return invalid(unexpectedVerify(log, { event: "verify-error", network }, e));
      }
    }

    async function settle(body: unknown): Promise<SettleAnswer | SettleResponse> {
      const deadline = performance.now() + settleWaitMs;
      const r = readShape(body);
      if (typeof r === "string") return failed(r, "", networkOf(body));
      const network = r.paymentRequirements.network as Network;
      const kind = kindAt(r);
      if (typeof kind === "string") return failed(kind, "", network);
      const payment = paymentOf(r);
      try {
        const module = route(kind.registration, payment.payload, payment.requirements);
        // The form's pure checks and the instrument, then the record, before anything reads the chain
        // or the clock, a published class's checks among them.
        const i = await module.record.instrument(payment);
        if ("refused" in i) return { ...failed(i.refused, "", network), ...(i.message === undefined ? {} : { errorMessage: i.message }) };
        const a: Attempt = {
          network,
          key: keyOf(i.instrument),
          kind,
          module,
          payment,
          instrumented: i,
          deadline,
          waitUntil: deadline - answerReserve(settleWaitMs),
        };
        let row: Row | undefined;
        try {
          row = await inTime(record.read(network, a.key), deadline);
        } catch (e) {
          return unread(a, e, "read");
        }
        if (row?.final === true) return answerFinal(a, row);
        // What the kind declares.
        const excluded = declared(kind, module, payment, i, "settle");
        if (excluded !== undefined) return failed(excluded, "", network);
        if (row !== undefined) return held(a, row);
        // The checks of /verify; where they refuse, the chain's read of the instrument. Only what the chain shows of
        // the signer's value is final here, never a lapse, which the read takes from the payload's own validity, and
        // the payload is not one the checks passed.
        const v = await settling.verify(payment.payload, payment.requirements);
        if (!v.isValid) {
          const read = await readChain(a, {});
          const lapsed = read.answer.state === "failed" && read.answer.reason === "instrument-unused";
          if (read.outcome === "final" && !lapsed) return byFinalRead(a, read, [], v.payer, undefined);
          return failed(settleReason(v.invalidReason ?? "invalid_payload"), "", network);
        }
        // The claim, with the chain's position the module reads for it, where its read searches from one.
        let since: unknown;
        if (module.record.position !== undefined && a.waitUntil - performance.now() > 0) {
          try {
            since = await module.record.position(payment, { deadline: a.waitUntil });
          } catch (e) {
            log({ ...about(a, { ...(v.payer === undefined ? {} : { payer: v.payer }) }), event: "position-unread" }, e);
          }
        }
        const claimed = Date.now();
        const transaction = known(i);
        let won: boolean;
        try {
          won = await inTime(
            record.claim(network, a.key, {
                pairing: i.pairing,
              ...(v.payer === undefined ? {} : { payer: v.payer }),
              ...(transaction === undefined ? {} : { transaction }),
              body: bodyOf(payment),
              ...(since === undefined ? {} : { since }),
              now: claimed,
              holdMs: settleWaitMs,
            }),
            deadline,
          );
        } catch (e) {
          return unread(a, e, "claim");
        }
        if (!won) {
          const now = await inTime(record.read(network, a.key), deadline).catch(() => undefined);
          return watch(a, now ?? { pairing: i.pairing, claimed, heldUntil: claimed + settleWaitMs, final: false, sent: [] });
        }
        // The fee budget, the submission and the answer.
        return await submit(a, v.payer, transaction === undefined ? [] : [transaction], claimed, since);
      } catch (e) {
        return unexpectedSettle(log, { event: "settle-error", network }, e);
      }
    }

    /** Answers before the body is read, and closes the connection, so that nothing more of the body is read. */
    function refuseUnread(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, headers: object = {}): void {
      res.setHeader("connection", "close");
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v as string);
      sendJson(res, status, body);
      req.destroy();
    }

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (credential !== undefined && !presents(req, credential)) {
        return refuseUnread(req, res, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
      }
      const path = (req.url ?? "").split("?")[0];
      if (path === "/supported") {
        if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
        return sendJson(res, 200, supported());
      }
      if (path !== "/verify" && path !== "/settle") return sendJson(res, 404, { error: "not found" });
      if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
      const read = await readRequestJson(req, X402_REQUEST_MAX_BYTES);
      if (read !== undefined && "tooLarge" in read) {
        return refuseUnread(req, res, 413, { error: `the body is larger than ${X402_REQUEST_MAX_BYTES} bytes` });
      }
      if (read !== undefined && "left" in read) {
        // The client left before its body was complete: there is no one to answer, and nothing failed here to log.
        res.destroy();
        return;
      }
      if (path === "/verify") {
        if (read === undefined) return sendJson(res, 400, { isValid: false, invalidReason: "invalid_payload" });
        return sendJson(res, 200, await verify(read.json));
      }
      if (read === undefined) return sendJson(res, 400, failed("invalid_payload", "", ""));
      return sendJson(res, 200, await settle(read.json));
    }

    const server = createServer((req, res) => {
      handle(req, res).catch((e: unknown) => {
        log({ event: "request-error", path: (req.url ?? "").split("?")[0] }, e);
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
        else res.destroy();
      });
    });
    server.requestTimeout = settleWaitMs + 60_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    return {
      async close() {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
        for (const close of closers.reverse()) await close();
        stopSweep();
        await pool.end();
      },
    };
  } catch (e) {
    for (const close of closers.reverse()) await close().catch(() => {});
    stopSweep();
    await pool.end();
    throw e;
  }
}
