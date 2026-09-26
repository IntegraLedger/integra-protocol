/**
 * The request checks of MPP's `card`, `stripe` and `usdc` challenges, which `pairingsOf` runs for each (intent, method)
 * and which name the pairing a challenge offers. `usdc` names its pairing by `methodDetails.type`.
 */
import type { Json } from "./core.js";
import { isAddress } from "./fields.js";
import type { MppChallenge, MppPairing } from "./mpp-challenge.js";
import { solanaChargePairings, solanaNetworkOf } from "./mpp-rail-checks.js";
import { refusal, type Refusal } from "./refusal.js";

type Obj = { [k: string]: Json };

const DECIMAL = /^[0-9]{1,78}$/;
const POSITIVE = /^[1-9][0-9]{0,77}$/;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const STACKS_CHAIN = /^(?:0|[1-9][0-9]{0,9})$/;
const STACKS_NAME = /^[a-zA-Z]([a-zA-Z0-9]|[-_])*$/;
const C32_PRINCIPAL = /^S[0-9A-HJKMNP-TV-Z]{38,40}$/;
/** Stripe metadata: at most 50 keys, key names at most 40 characters without square brackets, values at most 500. */
export const STRIPE_METADATA = Object.freeze({ keys: 50, keyLength: 40, valueLength: 500 });
/** The profiles `usdc`'s `methodDetails.type` names, and the pairing each one is. */
export const USDC_PROFILES: { readonly [type: string]: MppPairing } = Object.freeze({
  evm: "mpp/charge/usdc/evm",
  solana: "mpp/charge/usdc/solana",
  stacks: "mpp/charge/usdc/stacks",
  gateway: "mpp/charge/usdc/gateway",
});

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDecimal(v: unknown): v is string {
  return typeof v === "string" && DECIMAL.test(v) && BigInt(v) < 1n << 256n;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * A Stripe `metadata` map as Stripe bounds it, with `extra` more keys to come; absent is valid. Anything else is
 * `mpp/metadata-malformed`.
 */
export function stripeMetadataValid(m: unknown, extra = 0): true | Refusal {
  if (m === undefined) return true;
  if (!isObj(m)) return refusal("mpp/metadata-malformed");
  const entries = Object.entries(m);
  if (entries.length + extra > STRIPE_METADATA.keys) return refusal("mpp/metadata-malformed");
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > STRIPE_METADATA.keyLength || /[[\]]/.test(k)) return refusal("mpp/metadata-malformed");
    if (typeof v !== "string" || v.length > STRIPE_METADATA.valueLength) return refusal("mpp/metadata-malformed");
  }
  return true;
}

/** The charge intent's shared members: `amount` a decimal string, `currency` a string, `externalId` absent or a string. */
function chargeShape(r: Obj): true | Refusal {
  if (!isDecimal(r["amount"]) || typeof r["currency"] !== "string" || r["currency"] === "") {
    return refusal("mpp/request-malformed");
  }
  if (r["externalId"] !== undefined && typeof r["externalId"] !== "string") return refusal("mpp/request-malformed");
  return true;
}

/** `charge` on `card`: the charge intent's members. */
export function cardChargePairings(r: Obj): readonly MppPairing[] | Refusal {
  const ok = chargeShape(r);
  return ok === true ? ["mpp/charge/card"] : ok;
}

/** `charge` on `stripe`: the charge intent's members, and `methodDetails.metadata` within Stripe's bounds. */
export function stripeChargePairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  const ok = chargeShape(r);
  if (ok !== true) return ok;
  const m = stripeMetadataValid(d["metadata"]);
  return m === true ? ["mpp/charge/stripe"] : m;
}

/** `subscription` on `stripe`: `methodDetails.metadata` within Stripe's bounds. */
export function stripeSubscriptionPairings(_r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  const m = stripeMetadataValid(d["metadata"]);
  return m === true ? ["mpp/subscription/stripe"] : m;
}

/**
 * The active `usdc` profile: `methodDetails.type` names one of `evm`, `solana`, `stacks` or `gateway`, and
 * `methodDetails` holds exactly that one profile details object. Anything else is `mpp/usdc-profile`.
 */
export function usdcProfile(d: Obj): { type: string; details: Obj } | Refusal {
  const type = d["type"];
  if (typeof type !== "string" || !Object.hasOwn(USDC_PROFILES, type)) return refusal("mpp/usdc-profile");
  const details = d[type];
  if (!isObj(details)) return refusal("mpp/usdc-profile");
  for (const other of Object.keys(USDC_PROFILES)) {
    if (other !== type && d[other] !== undefined) return refusal("mpp/usdc-profile");
  }
  return { type, details };
}

/**
 * `charge` on `usdc`: the active profile, `amount` a positive integer string, `recipient` a string, and what each
 * profile's build reads: EVM `chainId` and addresses; the Solana charge's checks on the Solana details, whose `network`
 * is required; Stacks `chainId` and the token contract; Gateway's CAIP-2 networks and fee cap.
 */
export function usdcChargePairings(r: Obj, d: Obj, _c: MppChallenge): readonly MppPairing[] | Refusal {
  const profile = usdcProfile(d);
  if ("refused" in profile) return profile;
  const p = profile.details;
  if (typeof r["amount"] !== "string" || !POSITIVE.test(r["amount"]) || typeof r["recipient"] !== "string") {
    return refusal("mpp/request-malformed");
  }
  if (r["externalId"] !== undefined && typeof r["externalId"] !== "string") return refusal("mpp/request-malformed");
  switch (profile.type) {
    case "evm": {
      if (!isPositiveInt(p["chainId"]) || !isAddress(r["currency"]) || !isAddress(r["recipient"])) {
        return refusal("mpp/request-malformed");
      }
      const types = p["credentialTypes"];
      if (types !== undefined && (!Array.isArray(types) || types.length === 0 || !types.every((t) => t === "authorization"))) {
        return refusal("mpp/credential-types");
      }
      return ["mpp/charge/usdc/evm"];
    }
    case "solana": {
      const network = solanaNetworkOf(p, true);
      if (network !== null && typeof network === "object") return network;
      const solana = solanaChargePairings(r, p);
      return "refused" in solana ? solana : ["mpp/charge/usdc/solana"];
    }
    case "stacks": {
      const chainId = p["chainId"];
      if (typeof chainId !== "string" || !STACKS_CHAIN.test(chainId) || Number(chainId) > 0xffffffff) {
        return refusal("mpp/request-malformed");
      }
      if (typeof p["contractAddress"] !== "string" || !C32_PRINCIPAL.test(p["contractAddress"])) {
        return refusal("mpp/request-malformed");
      }
      if (typeof p["contractName"] !== "string" || p["contractName"].length > 128 || !STACKS_NAME.test(p["contractName"])) {
        return refusal("mpp/request-malformed");
      }
      return ["mpp/charge/usdc/stacks"];
    }
    default: {
      const sources = p["acceptedSources"];
      if (!Array.isArray(sources) || sources.length === 0 || sources.length > 32) return refusal("mpp/request-malformed");
      if (!sources.every((s) => typeof s === "string" && CAIP2.test(s))) return refusal("mpp/request-malformed");
      if (typeof p["destinationNetwork"] !== "string" || !CAIP2.test(p["destinationNetwork"])) {
        return refusal("mpp/request-malformed");
      }
      if (!isDecimal(p["maxFee"])) return refusal("mpp/request-malformed");
      const types = p["credentialTypes"];
      if (types !== undefined && (!Array.isArray(types) || types.length === 0 || !types.every((t) => t === "transfer"))) {
        return refusal("mpp/credential-types");
      }
      return ["mpp/charge/usdc/gateway"];
    }
  }
}

/** The CAIP-2 network of a `usdc` Stacks profile: `stacks:` and its `chainId`. */
export function stacksNetworkOf(details: Obj): `stacks:${string}` | undefined {
  const p = details["stacks"];
  const chainId = isObj(p) ? p["chainId"] : undefined;
  return typeof chainId === "string" && STACKS_CHAIN.test(chainId) ? `stacks:${chainId}` : undefined;
}
