/**
 * The `x402/exact/stellar` pairing: the ATR hash advertised in the challenge's `extensions.legalContext`, and its first
 * 8 bytes carried as the muxed id of the option's `payTo`, which the payer signs as the Soroban `transfer`'s `to`.
 */
import type { AtrHash } from "./core.js";
import {
  hasPeer,
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
import { isObject, normalHash } from "./fields.js";
import {
  acceptedBy,
  advertiseFor,
  chosen,
  filterOf,
  isAmount,
  isTimeoutSeconds,
  legalContextOf,
  offeredAt,
  readFor,
  withOption,
  x402Broadcaster,
  type OptionFilter,
  type X402Read,
} from "./internal/x402.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
export type { Broadcaster } from "./internal/broadcaster.js";

const ID = "x402/exact/stellar" as const;
const AMOUNT = /^(0|[1-9][0-9]{0,38})$/;
const I128_LIMIT = 1n << 127n;
const UINT32_MAX = 0xffffffff;

/**
 * The buyer's inputs to `build`: the chosen option, the buyer's simulated transaction, the current ledger, and the
 * payer's account (`G…`), which must be the simulated transfer's `from`.
 */
interface StellarChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  simulatedXdr: string;
  currentLedger: number;
  payer: string;
}

/**
 * True for an option of this pairing as far as it is read without @stellar/stellar-sdk: `exact` on a Stellar network,
 * with fees sponsored.
 */
function isStellarExact(option: PaymentRequirements): boolean {
  if (!isObject(option) || option.scheme !== "exact" || !isStellarNetwork(option.network)) return false;
  return isObject(option.extra) && option.extra["areFeesSponsored"] === true;
}

/** True for an option this pairing can pay: `isStellarExact`, with a contract `asset` and a `G…` or `M…` `payTo`. */
function isThis(option: PaymentRequirements): boolean {
  return isStellarExact(option) && isContract(option.asset) && (isAccount(option.payTo) || isMuxed(option.payTo));
}

const served = filterOf(isThis, payable);

/**
 * The pairing's option filter, which `advertise`, `read`, `build`, `bound` and `reference` apply: an option of this
 * pairing that `build` can pay (`payable`), else `x402/option-malformed`. Without @stellar/stellar-sdk the asset and
 * `payTo` strkeys cannot be read, so an option `isStellarExact` takes is `stellar/peer-missing`, and any other option
 * gets the answer it gets with the SDK: it is not this pairing's.
 */
const filter: OptionFilter = (o) => (isStellarExact(o) && !hasPeer() ? refusal("stellar/peer-missing") : served(o));

/**
 * True when the amount is a positive i128 in decimal (`isAmount`) and the timeout a positive safe integer of at most
 * 5 × (2^32 − 1) seconds: `build` sets the authorization entry's expiration ledger, a `uint32`, to the current ledger
 * plus `ceil(maxTimeoutSeconds / 5)`.
 */
function payable(o: PaymentRequirements): boolean {
  return (
    isAmount(o.amount) &&
    AMOUNT.test(o.amount) &&
    BigInt(o.amount) < I128_LIMIT &&
    isTimeoutSeconds(o.maxTimeoutSeconds) &&
    Math.ceil(o.maxTimeoutSeconds / 5) <= UINT32_MAX
  );
}

/**
 * The option with `payTo` back to its base `G…` account: the option as the seller issued it. An option that carries a
 * `refused` member is `x402/option-malformed`. The `payTo` is read without @stellar/stellar-sdk, so every answer is the
 * same with the SDK and without it: an option whose `payTo` is not a muxed address comes back as it is, as does a value
 * that is not an object.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  const m = unmux(option?.payTo);
  return m === null ? option : { ...option, payTo: m.base };
}

/**
 * The challenge's `extensions.legalContext` set, and the chosen option's `payTo` set to `muxedFor(payTo, h)`. A
 * challenge, or an option in its `accepts`, that carries a `refused` member is `x402/option-malformed`. Without
 * @stellar/stellar-sdk a Stellar offer cannot be read or placed: the filter refuses it `stellar/peer-missing`, after the
 * document's version and `accepts` and the offer's place in them are checked.
 */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(filter)(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  if (!isAccount(offer.payTo)) return refusal("stellar/carrier-occupied");
  const payTo = muxedFor(offer.payTo, h);
  if (isRefusal(payTo)) return payTo;
  return withOption(placed, offeredAt(placed.accepts, offer), { ...offer, payTo });
}

/**
 * The buyer's reading of the challenge: its hash, its link and the options this pairing can pay. Without
 * @stellar/stellar-sdk the filter refuses each Stellar option `stellar/peer-missing`, so a challenge holding one is
 * `stellar/peer-missing` (`readFor`), and a challenge holding none gets the answer it gets with the SDK.
 */
function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filter)(doc);
}

/**
 * The authorization preimage for the payer to sign, from the buyer's simulated transaction, with the entry's expiration at
 * `currentLedger + ceil(maxTimeoutSeconds / 5)`. The option's `payTo` must carry `muxedId(h)` and equal the `to` of
 * the invocation the payer's entry signs, and the operation must invoke exactly that. That invocation's token contract
 * must then be the option's `asset`, its amount the option's `amount` exactly, and its `from` the choice's `payer`.
 * Nothing reaches the signer unless every one holds. H is checked first, then the current ledger, the choice member
 * whose form needs neither the document nor the SDK (`stellar/tx-malformed`), then the document and the option, so
 * without @stellar/stellar-sdk the filter refuses a Stellar option `stellar/peer-missing` only after those.
 */
async function build(c: StellarChoice, h: AtrHash): Promise<StellarUnsigned | Refusal> {
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/not-v2");
  if (!Number.isSafeInteger(c.currentLedger) || c.currentLedger < 0) return refusal("stellar/tx-malformed");
  const ok = chosen(c.required, c.accepted, filter);
  if (ok !== true) return ok;
  const { accepted } = c;
  const m = unmux(accepted.payTo);
  if (m === null || m.id !== muxedId(h)) return refusal("stellar/carrier-mismatch");
  if (!hasPeer()) return refusal("stellar/peer-missing");
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
  const accepted = acceptedBy(presented["accepted"], filter);
  if (isRefusal(accepted)) return accepted;
  const lc = legalContextOf(presented["extensions"]);
  if (isRefusal(lc)) return lc;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const signed = readSignedTransfer(payload["transaction"] as string, accepted.network as "stellar:pubnet", false);
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
    "The ATR was assembled and delivered before approval, and its hash is in the payment challenge, which the payer " +
    "did not sign. The payer signed a transfer to the seller's muxed address whose 8-byte id is the first 8 bytes of " +
    "this ATR's hash, and the transaction succeeded. The id binds this hash only through its first 8 bytes: whoever " +
    "assembles the ATR can construct a second ATR whose hash begins with the same 8 bytes. This does not show that " +
    "amount, asset or timing match the ATR's content.",
});

/**
 * `x402/exact/stellar`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
 * Soroban `transfer` the payer authorized; `status` reads it.
 */
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
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: stellarStatus,
});
