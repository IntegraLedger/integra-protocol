// What the core gives a module at its start (src/module.ts, `Core`), for the own modules' tests: the operator log the
// test reads, the settle wait the test names, a module state kept in memory, and a fee meter the test reads.
import type { Core, FeeMeter, Included, ModuleState, Sending } from "../src/module.js";
import type { OperatorEntry } from "../src/answers.js";

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}n` : x));

/** A module state in memory, its values compared as JSON as the core's are. */
export function memoryState(): ModuleState & { readonly values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      values.set(key, value);
    },
    async swap(key, expected, value) {
      if (json(values.get(key)) !== json(expected)) return false;
      values.set(key, value);
      return true;
    },
    async delete(key) {
      values.delete(key);
    },
    pendingSettlements() {
      throw new Error("no own module takes x402's pending settlement store");
    },
  };
}

/** A fee meter that records what the module tells it, and allows each send while `allow` holds. */
export class Meter implements FeeMeter {
  sendings: Sending[] = [];
  inclusions: Included[] = [];
  constructor(public allow = true) {}
  async sending(s: Sending) {
    this.sendings.push(s);
    return this.allow;
  }
  included(i: Included) {
    this.inclusions.push(i);
  }
  sent() {
    throw new Error("no own module counts a transaction it sent without asking first");
  }
}

/** A core for one test: its log entries (with the cause's text), its wait, its state and its meter. */
export function testCore(o: { settleWaitMs?: number; meter?: Meter; state?: ModuleState } = {}): Core & {
  entries: OperatorEntry[];
  meterOf: Meter;
} {
  const entries: OperatorEntry[] = [];
  const meter = o.meter ?? new Meter();
  return {
    entries,
    meterOf: meter,
    log: (e, cause) => void entries.push(cause === undefined ? e : { ...e, cause: String(cause) }),
    settleWaitMs: o.settleWaitMs ?? 5_000,
    state: o.state ?? memoryState(),
    meter: () => meter,
  };
}
