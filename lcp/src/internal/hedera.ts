/**
 * The Hedera request checks an MPP charge challenge must pass, which `../hedera.ts`'s `advertise` and MPP's
 * `pairingsOf` run, and the readers they share with `../hedera.ts`: entity ids, decimal amounts, base64 and MPP's chain
 * ids. Also the x402 payments a Hedera payer presents, which the root names among the payments `Presented` covers. No
 * entry point exports these names.
 */
import { parseJson } from "../core.js";
import type { Hex } from "../evm.js";
import { isObject } from "../fields.js";
import type { HederaNetwork } from "../hedera.js";
import type { MppChallenge } from "../mpp-challenge.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { X402Payment } from "../x402.js";

/** The x402 `exact` payload on Hedera: the partially signed transaction, base64. */
type HederaPayload = { transaction: string };
export type HederaPaymentPayload = X402Payment<HederaPayload>;

/** The x402 `transferExecutor` payload. */
export type ExecutorPayload = { payer: string; executor: string; authorization: Hex };
export type ExecutorPaymentPayload = X402Payment<ExecutorPayload>;

const ENTITY = /^(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})$/;
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const INT64_LIMIT = 1n << 63n;
/**
 * The most splits a charge carries: the payer's debit, the recipient's remainder and eight splits are ten token
 * transfer entries, the most a Hedera transaction may carry (the network's `tokenTransfers.maxLen`, 10).
 */
const MAX_SPLITS = 8;

/** MPP's EIP-155 chain ids for Hedera, mapped to their CAIP-2 networks. */
const HEDERA_CHAIN_IDS: Readonly<Record<number, HederaNetwork>> = Object.freeze({
  295: "hedera:mainnet",
  296: "hedera:testnet",
});

/** The CAIP-2 network of an MPP `methodDetails.chainId`: 295 and 296 only. */
export function hederaNetworkOfChainId(chainId: unknown): HederaNetwork | Refusal {
  if (typeof chainId !== "number" || !Object.hasOwn(HEDERA_CHAIN_IDS, chainId)) return refusal("hedera/chain-id-unnamed");
  return HEDERA_CHAIN_IDS[chainId]!;
}

/** A Hedera entity id, `shard.realm.num`. */
export function isEntity(s: unknown): s is string {
  return typeof s === "string" && ENTITY.test(s);
}

/** A decimal below 2^63, zero included: an x402 Hedera option's amount, and each MPP Hedera charge split's amount. */
export function amountOf(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !DECIMAL.test(s)) return undefined;
  const v = BigInt(s);
  return v < INT64_LIMIT ? v : undefined;
}

/** A positive decimal below 2^63: an MPP Hedera charge request's amount. */
function positiveAmountOf(s: unknown): bigint | undefined {
  const v = amountOf(s);
  return v !== undefined && v > 0n ? v : undefined;
}

/** Padded standard base64 to bytes, or null. */
export function fromBase64(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || s.length % 4 !== 0 || !BASE64.test(s)) return null;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The request's legs: the payer's debit of `amount`, the recipient's remainder, and each split, in `currency`. `amount`
 * is positive and each split's amount a decimal below 2^63, zero included; the splits sum to less than `amount`.
 */
export function chargeLegs(
  request: unknown,
): { currency: string; amount: bigint; legs: readonly { account: string; amount: bigint }[] } | Refusal {
  if (!isObject(request)) return refusal("hedera/option-malformed");
  const amount = positiveAmountOf(request["amount"]);
  const currency = request["currency"];
  const recipient = request["recipient"];
  if (amount === undefined || !isEntity(currency) || !isEntity(recipient)) return refusal("hedera/option-malformed");
  const splits = request["splits"] ?? [];
  if (!Array.isArray(splits) || splits.length > MAX_SPLITS) return refusal("hedera/option-malformed");
  const legs: { account: string; amount: bigint }[] = [];
  let splitTotal = 0n;
  for (const sp of splits) {
    const a = isObject(sp) ? amountOf(sp["amount"]) : undefined;
    if (!isObject(sp) || !isEntity(sp["recipient"]) || a === undefined) return refusal("hedera/option-malformed");
    legs.push({ account: sp["recipient"], amount: a });
    splitTotal += a;
  }
  if (splitTotal >= amount) return refusal("hedera/option-malformed");
  const all = [{ account: recipient, amount: amount - splitTotal }, ...legs];
  const accounts = new Set(all.map((l) => l.account));
  if (accounts.size !== all.length) return refusal("hedera/option-malformed");
  return { currency, amount, legs: all };
}

/** The Hedera request checks a charge challenge must pass before it is placed. */
export function hederaChargeRequest(c: MppChallenge): true | Refusal {
  if (!isObject(c) || c.method !== "hedera" || c.intent !== "charge") return refusal("mpp/not-this-pairing");
  let request: unknown;
  try {
    request = parseJson(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(c.request)));
  } catch {
    return refusal("mpp/request-malformed");
  }
  if (!isObject(request)) return refusal("mpp/request-malformed");
  const legs = chargeLegs(request);
  if (isRefusal(legs)) return legs;
  const md = request["methodDetails"];
  if (md !== undefined && !isObject(md)) return refusal("mpp/request-malformed");
  const chainId = isObject(md) ? md["chainId"] : undefined;
  if (chainId !== undefined) {
    const n = hederaNetworkOfChainId(chainId);
    if (isRefusal(n)) return n;
  }
  return true;
}

function fromBase64Url(s: unknown): Uint8Array {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error("not base64url");
  const plain = s.replace(/=+$/, "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = plain + "=".repeat((4 - (plain.length % 4)) % 4);
  const bytes = fromBase64(padded);
  if (bytes === null) throw new Error("not base64url");
  return bytes;
}
