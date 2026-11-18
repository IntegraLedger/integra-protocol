/**
 * The Hedera request checks an MPP charge challenge must pass, which `../hedera.ts`'s `advertise` and MPP's
 * `pairingsOf` run, and the readers they share with `../hedera.ts`: entity ids, decimal amounts and MPP's chain ids.
 * Also the x402 payments a Hedera payer presents, which the root names among the payments `Presented` covers and
 * exports, as `../hedera.ts` exports the executor payment, which its `build` completes. No entry point exports the other
 * names.
 */
import type { Hex } from "../evm.js";
import type { X402Payment } from "./x402.js";

/** The x402 `exact` payload on Hedera: the partially signed transaction, base64. */
export type HederaPayload = { transaction: string };
export type HederaPaymentPayload = X402Payment<HederaPayload>;

/** The x402 `transferExecutor` payload. */
export type ExecutorPayload = { payer: string; executor: string; authorization: Hex };
export type ExecutorPaymentPayload = X402Payment<ExecutorPayload>;

const ENTITY = /^(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})$/;
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
export const INT64_LIMIT = 1n << 63n;

/** A Hedera entity id, `shard.realm.num`. */
export function isEntity(s: unknown): s is string {
  return typeof s === "string" && ENTITY.test(s);
}

/**
 * A decimal below 2^63, zero included: the width of an x402 Hedera option's amount, which the option filter also holds
 * positive.
 */
export function amountOf(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !DECIMAL.test(s)) return undefined;
  const v = BigInt(s);
  return v < INT64_LIMIT ? v : undefined;
}
