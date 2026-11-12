/**
 * An MPP payment that is an x402 payment: the `evm` method's `authorization` credential and the `usdc` method's EVM
 * credential, mapped to x402's `exact` scheme with EIP-3009, so that an x402 facilitator settles them. The payer's
 * signed act is the same on both protocols; only the nonce's derivation differs, which x402's facilitator does not
 * check.
 */
import { isAddress, isObject, uint256Of } from "./fields.js";
import { MAX_SIGNATURE_BYTES } from "./internal/bounds.js";
import { issuedFor, type MppCredential, type MppPairingId } from "./mpp-challenge.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import type { PaymentPayload, PaymentRequirements } from "./x402.js";

/** The token's EIP-712 domain `name` and `version`, which x402's verification reads from `extra` and no MPP challenge carries. */
export interface TokenDomain {
  name: string;
  version: string;
}

/** x402's `exact` EIP-3009 payment and the requirements it answers, from one MPP credential. */
export interface X402Mapped {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

const MAX_DOMAIN_MEMBER = 256;
const NONCE = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x(?:[0-9a-fA-F]{2})+$/;

/** The pairing whose credential has an x402 twin, from the echoed challenge's method, or undefined. */
function twinOf(c: MppCredential): MppPairingId | undefined {
  if (c.challenge.intent !== "charge" || c.payload["type"] !== "authorization") return undefined;
  if (c.challenge.method === "evm") return "mpp/charge/evm/authorization";
  if (c.challenge.method === "usdc") return "mpp/charge/usdc/evm";
  return undefined;
}

/**
 * The x402 `exact` EIP-3009 payment and requirements of an MPP `evm` `authorization` credential or `usdc` EVM
 * credential: `scheme` `exact`, `network` `eip155:<chainId>`, `amount`, `asset` and `payTo` the request's `amount`,
 * `currency` and `recipient`, `extra` the token's EIP-712 `name` and `version` the caller gives, and
 * `maxTimeoutSeconds` the window the payer signed, `validBefore` less `validAfter`; the payload's `authorization` is the
 * credential's `from`, `to`, `value`, `validAfter`, `validBefore` and `nonce`, with its `signature`. The echoed challenge
 * is held to the pairing's filter as an issued one is, so it need not carry H. A credential of any other form, a Permit2
 * witness, a Gateway burn intent, a challenge with splits and every non-EVM form among them, is `mpp/no-x402-twin`; a
 * payload member out of its form, or a `validBefore` not after `validAfter`, is `mpp/credential-malformed`; a token
 * domain that is not two strings of 1 to 256 characters is `mpp/input-malformed`. It compares nothing the payment pays
 * with the challenge: the facilitator's verification does.
 */
export function toX402(credential: unknown, token: TokenDomain): X402Mapped | Refusal {
  if (
    !isObject(credential) ||
    !isObject(credential["challenge"]) ||
    !isObject(credential["payload"])
  ) {
    return refusal("mpp/credential-malformed");
  }
  const c = credential as unknown as MppCredential;
  const pairing = twinOf(c);
  if (pairing === undefined) return refusal("mpp/no-x402-twin");
  const checked = issuedFor(c.challenge, pairing);
  if (isRefusal(checked)) return checked.code === "mpp/not-this-pairing" ? refusal("mpp/no-x402-twin") : checked;
  if (!isDomainMember(token?.name) || !isDomainMember(token?.version)) return refusal("mpp/input-malformed");
  const p = c.payload;
  const validAfter = uint256Of(p["validAfter"]);
  const validBefore = uint256Of(p["validBefore"]);
  if (
    !isAddress(p["from"]) ||
    !isAddress(p["to"]) ||
    uint256Of(p["value"]) === undefined ||
    validAfter === undefined ||
    validBefore === undefined ||
    typeof p["nonce"] !== "string" ||
    !NONCE.test(p["nonce"]) ||
    !isSignature(p["signature"])
  ) {
    return refusal("mpp/credential-malformed");
  }
  if (validBefore <= validAfter || validBefore - validAfter > BigInt(Number.MAX_SAFE_INTEGER)) {
    return refusal("mpp/credential-malformed");
  }
  const details = pairing === "mpp/charge/usdc/evm" ? (checked.details["evm"] as { [k: string]: unknown }) : checked.details;
  const r = checked.request;
  const paymentRequirements: PaymentRequirements = {
    scheme: "exact",
    network: `eip155:${details["chainId"] as number}`,
    amount: r["amount"] as string,
    asset: r["currency"] as string,
    payTo: r["recipient"] as string,
    maxTimeoutSeconds: Number(validBefore - validAfter),
    extra: { name: token.name, version: token.version },
  };
  const authorization = {
    from: p["from"],
    to: p["to"],
    value: p["value"] as string,
    validAfter: p["validAfter"] as string,
    validBefore: p["validBefore"] as string,
    nonce: p["nonce"],
  };
  return {
    paymentPayload: {
      x402Version: 2,
      accepted: paymentRequirements,
      payload: { signature: p["signature"] as `0x${string}`, authorization },
    },
    paymentRequirements,
  };
}

function isDomainMember(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= MAX_DOMAIN_MEMBER;
}

function isSignature(v: unknown): v is string {
  return typeof v === "string" && SIGNATURE.test(v) && (v.length - 2) / 2 <= MAX_SIGNATURE_BYTES;
}
