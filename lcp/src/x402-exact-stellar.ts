/**
 * The `x402/exact/stellar` pairing: the ATR hash advertised in the challenge's `extensions.legalContext`, and its first
 * 8 bytes carried as the muxed id of the option's `payTo`, which the payer signs as the Soroban `transfer`'s `to`.
 */
import type { AtrHash } from "./core.js";
import {
  isAccount,
  isContract,
  isMuxed,
  isStellarNetwork,
  muxedFor,
  muxedId,
  readSignedTransfer,
  signingFor,
  stellarStatus,
  unmux,
  type StellarRef,
  type StellarUnsigned,
} from "./internal/stellar.js";
import { isObject } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  filterOf,
  legalContextOf,
  offeredAt,
  readFor,
  tie,
  withOption,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

const ID = "x402/exact/stellar" as const;
const AMOUNT = /^[1-9][0-9]{0,37}$/;
const I128_LIMIT = 1n << 127n;

/** A payment on this pairing: the base64 XDR of the transaction with the payer's entry signed. */
export interface StellarPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string };
  extensions?: PaymentRequired["extensions"];
}

/**
 * The buyer's inputs to `build`: the chosen option, the buyer's simulated transaction, the current ledger, and the
 * payer's account (`G…`), which must be the simulated transfer's `from`.
 */
export interface StellarChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  simulatedXdr: string;
  currentLedger: number;
  payer: string;
}

/** This pairing's id for an option it can pay, or undefined. */
export function pairingOf(option: PaymentRequirements): typeof ID | undefined {
  if (!isObject(option) || option.scheme !== "exact" || !isStellarNetwork(option.network)) return undefined;
  if (!isContract(option.asset) || !(isAccount(option.payTo) || isMuxed(option.payTo))) return undefined;
  if (!isObject(option.extra) || option.extra["areFeesSponsored"] !== true) return undefined;
  return ID;
}

const isThis = (o: PaymentRequirements): boolean => pairingOf(o) !== undefined;

/** True when the amount is a positive i128 in decimal and the timeout a positive safe integer. */
function payable(o: PaymentRequirements): boolean {
  return (
    typeof o.amount === "string" &&
    AMOUNT.test(o.amount) &&
    BigInt(o.amount) < I128_LIMIT &&
    Number.isSafeInteger(o.maxTimeoutSeconds) &&
    o.maxTimeoutSeconds > 0
  );
}

/** The option with `payTo` back to its base `G…` account: the option as the seller issued it. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  const m = unmux(option?.payTo);
  return m === null ? option : { ...option, payTo: m.base };
}

/** The challenge's `extensions.legalContext` set, and the chosen option's `payTo` set to `muxedFor(payTo, h)`. */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(filterOf(isThis, payable))(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  if (!isAccount(offer.payTo)) return refusal("stellar/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), { ...offer, payTo: muxedFor(offer.payTo, h) });
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filterOf(isThis))(doc);
}

/**
 * The authorization preimage for the payer to sign, from the buyer's simulated transaction, with the entry's expiration at
 * `currentLedger + ceil(maxTimeoutSeconds / 5)`. The option's `payTo` must carry `muxedId(h)` and equal the `to` of
 * the invocation the payer's entry signs, and the operation must invoke exactly that. That invocation's token contract
 * must then be the option's `asset`, its amount the option's `amount` exactly, and its `from` the choice's `payer`.
 * Nothing reaches the signer unless every one holds.
 */
async function build(c: StellarChoice, h: AtrHash): Promise<StellarUnsigned | Refusal> {
  const ok = chosen(c.required, c.accepted, filterOf(isThis));
  if (ok !== true) return ok;
  const { accepted } = c;
  if (!payable(accepted)) return refusal("x402/option-malformed");
  if (!Number.isSafeInteger(c.currentLedger) || c.currentLedger < 0) return refusal("stellar/tx-malformed");
  const m = unmux(accepted.payTo);
  if (m === null || m.id !== muxedId(h)) return refusal("stellar/carrier-mismatch");
  const expiration = c.currentLedger + Math.ceil(accepted.maxTimeoutSeconds / 5);
  const s = signingFor(c.simulatedXdr, accepted.network as "stellar:pubnet", expiration, false);
  if (isRefusal(s)) return s;
  if (s.payment.to !== accepted.payTo) return refusal("stellar/carrier-mismatch");
  if (!s.agrees) return refusal("stellar/not-one-transfer");
  if (s.payment.asset !== accepted.asset) return refusal("stellar/asset-mismatch");
  if (s.payment.amount !== BigInt(accepted.amount)) return refusal("stellar/amount-mismatch");
  if (s.payment.from !== c.payer) return refusal("stellar/payer-mismatch");
  return s.unsigned;
}

/** The option, the echoed hash and the decoded transfer of a payment, or the refusal that names what is wrong. */
function presentedOf(presented: unknown) {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"] as PaymentRequirements;
  if (!isObject(accepted) || !isThis(accepted)) return refusal("x402/option-not-this-pairing");
  const lc = legalContextOf(presented["extensions"]);
  if (isRefusal(lc)) return lc;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const signed = readSignedTransfer(payload["transaction"] as string, accepted.network as "stellar:pubnet");
  if (isRefusal(signed)) return signed;
  const { payment } = signed;
  if (payment.toId === null) return refusal("stellar/no-carrier");
  if (payment.to !== accepted.payTo || payment.toId !== muxedId(lc.h)) return refusal("stellar/carrier-mismatch");
  if (!signed.agrees) return refusal("stellar/not-one-transfer");
  return { accepted, h: lc.h, payment };
}

/**
 * The echoed challenge's hash, when the `to` of the invocation the payer's entry signs is the option's muxed `payTo`
 * whose id is the hash's first 8 bytes, and the operation invokes exactly that.
 * The authorization's signature is not verified here; the network verifies it when the entry is used.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = presentedOf(presented);
  return isRefusal(p) ? p : p.h;
}

/** The read keys for finding this payment later, from the signed entry. `fromLedger` is 0 until the caller sets it. */
async function reference(presented: unknown): Promise<StellarRef | Refusal> {
  const p = presentedOf(presented);
  if (isRefusal(p)) return p;
  return {
    network: p.accepted.network as StellarRef["network"],
    authDigest: p.payment.auth.preimageHash,
    asset: p.payment.asset,
    toBase: p.payment.toBase,
    toId: p.payment.toId!.toString(),
    expiration: p.payment.auth.expiration,
    fromLedger: 0,
  };
}

const pattern: LcpPattern = Object.freeze({
  pattern: "truncated-field",
  canonical: true,
  buyerSigns: false,
  onChain: true,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The ATR was assembled, written to the seller's storage and linked in the challenge before approval, " +
    "and its hash is in the payment challenge, which the payer " +
    "did not sign. The payer signed a transfer to the seller's muxed address whose 8-byte id is the first 8 bytes of " +
    "this ATR's hash, and the transaction succeeded. The id binds this hash only through its first 8 bytes: whoever " +
    "assembles the ATR can construct a second ATR whose hash begins with the same 8 bytes. This does not show that " +
    "amount, asset or timing match the ATR's content.",
});

export const exactStellar = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: "payTo" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: stellarStatus,
});
