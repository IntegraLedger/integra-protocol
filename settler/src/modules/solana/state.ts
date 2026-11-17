/**
 * The durable state `@x402/svm`'s channel classes take, kept in the settler's database through the module's state:
 * the payment channels the `upto` and batch-settlement classes open (`PaymentChannelStorage`), and the batch class's
 * pending signatures (`BatchPendingSettlementStore`). Every write that x402 requires to be atomic is one `swap`. A
 * removed value is kept as `null`, so that a later conditional write compares against it and never races a delete.
 */
import type { Network } from "@x402/core/types";
import type { BatchPendingSettlementStore, PaymentChannelStorage } from "@x402/svm/batch-settlement/facilitator";
import type { ModuleState } from "../../module.js";

type ChannelRecord = Awaited<ReturnType<PaymentChannelStorage["get"]>> & object;
type OpenWrite = Awaited<ReturnType<PaymentChannelStorage["recordOpen"]>>;
interface Stored {
  readonly record: ChannelRecord;
  readonly revertToken: string;
}

const channelKey = (network: string, channelId: string) => `channel:${network}:${channelId}`;
const indexKey = (network: string) => `channels:${network}`;

function isStored(v: unknown): v is Stored {
  return typeof v === "object" && v !== null && "record" in v && "revertToken" in v;
}

/** Writes `next(current)` under `key` once no other writer moved it in between; `current` is undefined or null when absent. */
async function update<T>(state: ModuleState, key: string, next: (current: unknown) => { value: unknown; result: T } | { result: T }): Promise<T> {
  for (;;) {
    const current = await state.get(key);
    const step = next(current);
    if (!("value" in step)) return step.result;
    if (await state.swap(key, current, step.value)) return step.result;
  }
}

/** The channel ids stored on `network`, kept as one list, each added once. */
async function index(state: ModuleState, network: string, change: (ids: string[]) => string[]): Promise<void> {
  await update(state, indexKey(network), (current) => {
    const ids = Array.isArray(current) ? (current as string[]) : [];
    const next = change(ids);
    return next.length === ids.length && next.every((id, i) => id === ids[i]) ? { result: undefined } : { value: next, result: undefined };
  });
}

/** Whether a stored channel's non-empty binding differs from a requested non-empty one, as x402's reference store asks. */
function conflicts(requested: ChannelRecord, stored: ChannelRecord): boolean {
  const differs = (a: string, b: string) => a !== "" && b !== "" && a !== b;
  return differs(requested.receiverAuthorizer, stored.receiverAuthorizer) || differs(requested.callerIdentity, stored.callerIdentity);
}

/** x402's `PaymentChannelStorage` over the module's state, with the semantics of its in-memory reference store. */
export function channelStorage(state: ModuleState): PaymentChannelStorage {
  let tokens = 0;
  const token = () => `${process.pid}.${Date.now()}.${++tokens}`;
  return {
    async recordOpen(record): Promise<OpenWrite> {
      const key = channelKey(record.network, record.channelId);
      const written = await update<OpenWrite>(state, key, (current) => {
        if (isStored(current)) {
          if (conflicts(record, current.record)) return { result: { record: { ...current.record }, revertToken: "" } };
          const moved: ChannelRecord = {
            ...current.record,
            expiresAt: Math.max(current.record.expiresAt, record.expiresAt),
            lastActivityAt: Math.max(current.record.lastActivityAt, record.lastActivityAt),
          };
          return { value: { record: moved, revertToken: token() }, result: { record: { ...moved }, revertToken: "" } };
        }
        const made = token();
        return { value: { record: { ...record }, revertToken: made }, result: { record: { ...record }, revertToken: made } };
      });
      await index(state, record.network, (ids) => (ids.includes(record.channelId) ? ids : [...ids, record.channelId]));
      return written;
    },
    async revertOpen(write) {
      if (write.revertToken === "") return;
      const key = channelKey(write.record.network, write.record.channelId);
      await update(state, key, (current) =>
        isStored(current) && current.revertToken === write.revertToken ? { value: null, result: undefined } : { result: undefined },
      );
    },
    async recordActivity(...records) {
      for (const record of records) {
        await update(state, channelKey(record.network, record.channelId), (current) =>
          isStored(current)
            ? { value: { ...current, record: { ...current.record, lastActivityAt: Math.max(current.record.lastActivityAt, record.lastActivityAt) } }, result: undefined }
            : { value: { record: { ...record }, revertToken: "" }, result: undefined },
        );
        await index(state, record.network, (ids) => (ids.includes(record.channelId) ? ids : [...ids, record.channelId]));
      }
    },
    async get(network, channelId) {
      const current = await state.get(channelKey(network, channelId));
      return isStored(current) ? { ...current.record } : undefined;
    },
    async list(network: Network) {
      const ids = await state.get(indexKey(network));
      const out: ChannelRecord[] = [];
      for (const id of Array.isArray(ids) ? (ids as string[]) : []) {
        const current = await state.get(channelKey(network, id));
        if (isStored(current)) out.push({ ...current.record });
      }
      return out;
    },
    async delete(network, channelId) {
      await update(state, channelKey(network, channelId), (current) => (current === undefined || current === null ? { result: undefined } : { value: null, result: undefined }));
      await index(state, network, (ids) => ids.filter((id) => id !== channelId));
    },
  };
}

/** The batch-settlement class's pending signatures over the module's state, its reserve and release each one swap. */
export function batchPendingStore(state: ModuleState): BatchPendingSettlementStore {
  const named = (key: string) => `batch-pending:${key}`;
  return {
    async get(key) {
      const v = await state.get(named(key));
      return typeof v === "string" ? v : undefined;
    },
    set: (key, value) => state.set(named(key), value),
    async delete(key) {
      await update(state, named(key), (current) => (typeof current === "string" ? { value: null, result: undefined } : { result: undefined }));
    },
    setIfAbsent: (key, value) =>
      update(state, named(key), (current) => (typeof current === "string" ? { result: false } : { value, result: true })),
    deleteIfEquals: (key, value) =>
      update(state, named(key), (current) => (current === value ? { value: null, result: true } : { result: false })),
  };
}
