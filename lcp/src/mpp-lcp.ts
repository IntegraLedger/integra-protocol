/**
 * The `lcp` MPP payment method (profile `mpp/method/lcp`): the filter `pairingsOf` applies to a `charge` challenge of
 * the method, which reads `methodDetails.rail` and holds the request to that rail's closed schema; the credential's
 * payload types; the credential each rail's client completes; and what a rail's `validate` answers.
 */
import type { AtrHash, Json } from "./core.js";
import { amountOf, isEntity } from "./internal/hedera.js";
import { isAccount, isContract } from "./internal/stellar-strkey.js";
import { measured, type MppChallenge, type MppCredential, type MppPairingId } from "./mpp-challenge.js";
import { refusal, type Refusal } from "./refusal.js";

/** The rails the method names in `methodDetails.rail`. */
export type LcpRail = "hedera" | "stellar";

/**
 * What a rail's `validate` answers for a payment that passes every check it made: H, and each check it did not make
 * for want of a reader, by name. A party submits only on an answer whose `notMade` is empty.
 */
export interface LcpValidation {
  h: AtrHash;
  notMade: readonly string[];
}

type Obj = { [k: string]: Json };

/** The request members the `charge` intent defines and the method takes. */
const REQUEST: ReadonlySet<string> = new Set(["amount", "currency", "recipient", "description", "externalId", "methodDetails"]);
const HEDERA_DETAILS: ReadonlySet<string> = new Set(["rail", "network", "supportedModes", "feePayer", "feePayerAccountId"]);
const STELLAR_DETAILS: ReadonlySet<string> = new Set(["rail", "network", "supportedModes", "feePayer"]);
const HEDERA_NETWORKS: readonly string[] = ["hedera:mainnet", "hedera:testnet", "hedera:previewnet", "hedera:devnet"];
const STELLAR_NETWORKS: readonly string[] = ["stellar:pubnet", "stellar:testnet"];
const DECIMAL = /^(0|[1-9][0-9]{0,38})$/;
/** A SEP-41 `transfer` amount is an `i128`. */
const I128_LIMIT = 1n << 127n;

/**
 * `charge` on `lcp`, the method's filter, with the first of these codes that holds: a `rail` that is neither `hedera`
 * nor `stellar` is `mpp/not-this-pairing`; a challenge with no `expires` `mpp/expires-required`; `supportedModes`
 * absent or not exactly `["pull"]` `mpp/modes-not-pull`; then the rail's network and closed request schema
 * (`hederaRequest`, `stellarRequest`).
 */
export function lcpChargePairings(r: Obj, d: Obj, c: MppChallenge): readonly MppPairingId[] | Refusal {
  const rail = d["rail"];
  if (rail !== "hedera" && rail !== "stellar") return refusal("mpp/not-this-pairing");
  if (c.expires === undefined) return refusal("mpp/expires-required");
  const modes = d["supportedModes"];
  if (!Array.isArray(modes) || modes.length !== 1 || modes[0] !== "pull") return refusal("mpp/modes-not-pull");
  return rail === "hedera" ? hederaRequest(r, d) : stellarRequest(r, d);
}

/**
 * The Hedera rail's request: `network` one of the four Hedera networks, else `hedera/network-malformed`; then, else
 * `hedera/option-malformed`: no request or `methodDetails` member the schema does not list; `amount` a decimal from 1
 * to 2^63 − 1; `currency` and `recipient` entity ids, `0.0.0` being HBAR; `description` and `externalId` strings where
 * present; and `feePayer` a boolean where present, `true` with an entity `feePayerAccountId` and `feePayerAccountId`
 * present only then.
 */
function hederaRequest(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  const network = d["network"];
  if (typeof network !== "string" || !HEDERA_NETWORKS.includes(network)) return refusal("hedera/network-malformed");
  const amount = amountOf(r["amount"]);
  const feePayer = d["feePayer"];
  const account = d["feePayerAccountId"];
  if (
    !closed(r, REQUEST) ||
    !closed(d, HEDERA_DETAILS) ||
    amount === undefined ||
    amount === 0n ||
    !isEntity(r["currency"]) ||
    !isEntity(r["recipient"]) ||
    !optionalStrings(r) ||
    (feePayer !== undefined && typeof feePayer !== "boolean") ||
    (feePayer === true ? !isEntity(account) : account !== undefined)
  ) {
    return refusal("hedera/option-malformed");
  }
  return ["mpp/charge/lcp/hedera"];
}

/**
 * The Stellar rail's request: `network` `stellar:pubnet` or `stellar:testnet`, else `stellar/network-malformed`; then,
 * else `stellar/option-malformed`: no request or `methodDetails` member the schema does not list; `amount` a decimal
 * below 2^127, zero admitted; `currency` a `C…` contract strkey; `recipient` a plain `G…` account strkey, never a muxed
 * `M…` one; `description` and `externalId` strings where present; and `feePayer` absent or `false`. A request that
 * passes names no pairing: this package serves no Stellar rail, and the challenge is `mpp/not-this-pairing`.
 */
function stellarRequest(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  const network = d["network"];
  if (typeof network !== "string" || !STELLAR_NETWORKS.includes(network)) return refusal("stellar/network-malformed");
  const amount = r["amount"];
  if (
    !closed(r, REQUEST) ||
    !closed(d, STELLAR_DETAILS) ||
    typeof amount !== "string" ||
    !DECIMAL.test(amount) ||
    BigInt(amount) >= I128_LIMIT ||
    !isContract(r["currency"]) ||
    !isAccount(r["recipient"]) ||
    !optionalStrings(r) ||
    (d["feePayer"] !== undefined && d["feePayer"] !== false)
  ) {
    return refusal("stellar/option-malformed");
  }
  return refusal("mpp/not-this-pairing");
}

/** Whether every member of `o` is one `listed` names. */
function closed(o: Obj, listed: ReadonlySet<string>): boolean {
  return Object.keys(o).every((k) => listed.has(k));
}

/** Whether the request's `description` and `externalId` are strings where present. */
function optionalStrings(r: Obj): boolean {
  return ["description", "externalId"].every((k) => r[k] === undefined || typeof r[k] === "string");
}

/**
 * The payload type of a credential of the method: `transaction`, the bytes the payer signed, or `hash`, a payment its
 * payer broadcast; any other is `mpp/credential-type`.
 */
export function lcpPayloadType(payload: { [k: string]: Json }): "transaction" | "hash" | Refusal {
  const type = payload["type"];
  return type === "transaction" || type === "hash" ? type : refusal("mpp/credential-type");
}

/**
 * The credential a rail's client completes: the chosen challenge as `build` held it and the payload
 * `{type: "transaction", transaction}`, measured against the credential bound as `bound` measures it
 * (`mpp/credential-malformed`).
 */
export function lcpCredential(challenge: MppChallenge & { id: string }, transaction: string): MppCredential | Refusal {
  return measured({ challenge, payload: { type: "transaction", transaction } });
}

/** A clock reading the caller gives `validate`, in Unix seconds: a non-negative safe integer, else `mpp/input-malformed`. */
export function clockOf(now: unknown): number | Refusal {
  return Number.isSafeInteger(now) && (now as number) >= 0 ? (now as number) : refusal("mpp/input-malformed");
}
