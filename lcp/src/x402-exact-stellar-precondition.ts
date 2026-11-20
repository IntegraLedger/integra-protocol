/**
 * Stellar: the pairing `x402/exact/stellar/precondition`, the agreement on x402. The buyer signs a Soroban authorization
 * of `transfer(buyer, payTo, amount)` and the 40-byte payload of H and that authorization's nonce, which the
 * transaction carries as a signed-payload precondition; the settler submits the transaction as its source. The form is
 * an agreement and never a charge. The read finds the agreement by the buyer's events on every contract.
 */
import type { AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash, sameJson } from "./fields.js";
import { STELLAR } from "./internal/data/stellar.js";
import { x402Payee } from "./internal/payee.js";
import type { Entry } from "./internal/registry.js";
import {
  isStellarNetwork,
  preconditionSigningFor,
  readPrecondition,
  stellarRecover,
  stellarStatus,
  type PreconditionEnvelope,
  type StellarLanded,
  type StellarNetwork,
  type StellarPaymentPayload,
  type StellarQuery,
  type StellarReader,
  type StellarRef,
  type StellarStatus,
  type StellarUnsigned,
} from "./internal/stellar.js";
import { isLedgerSequence, readSignedPayload, signedPayload } from "./internal/stellar-position.js";
import { isAccount, isContract, unmux } from "./internal/stellar-strkey.js";
import {
  advertiseFor,
  chosen,
  isTimeoutSeconds,
  paymentWith,
  presentedWith,
  readFor,
  x402Broadcaster,
  type OptionFilter,
  type X402Forms,
  type X402Read,
} from "./internal/x402.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { tie, type LcpPattern, type PaymentRequired, type PaymentRequirements } from "./x402.js";
export type { Broadcaster } from "./internal/broadcaster.js";

const ID = "x402/exact/stellar/precondition" as const;
/** The profile's `assetTransferMethod`, which tells this form's option from every other Stellar option. */
export const LCP_PRECONDITION = "lcp-precondition";
/** The option's `amount`: zero, or a decimal integer with no sign and no leading zero, below 2^127 (a `transfer`'s `i128`). */
const AMOUNT = /^(0|[1-9][0-9]{0,38})$/;
const I128_LIMIT = 1n << 127n;
const UINT32_MAX = 0xffffffff;

/**
 * The buyer's inputs to `build`: the chosen option, the buyer's simulated transaction, the current ledger, and the
 * buyer's account (`G…`), which must be the simulated transfer's `from`.
 */
export interface StellarPreconditionChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  simulatedXdr: string;
  currentLedger: number;
  payer: string;
}

/**
 * The option filter, which `advertise`, `read`, `build`, `bound` and `reference` apply. An option is this pairing's
 * where it is `exact` on a Stellar network with `extra.assetTransferMethod` `"lcp-precondition"`. It is served where
 * `extra.areFeesSponsored` is `true`, `asset` is a contract strkey, `payTo` an account strkey, `amount` zero or a
 * positive decimal below 2^127, and `maxTimeoutSeconds` a positive integer whose fifth, rounded up, is a ledger count
 * (`build` sets the entry's expiration ledger, a `uint32`, to the current ledger plus that count); a muxed `payTo` is
 * `stellar/option-malformed`, and any other failure `x402/option-malformed`. The strkeys are read without
 * @stellar/stellar-sdk, so every answer is the same with the SDK and without it.
 */
const filter: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact" || !isStellarNetwork(o.network)) return undefined;
  const extra: unknown = o.extra;
  if (!isObject(extra) || extra["assetTransferMethod"] !== LCP_PRECONDITION) return undefined;
  if (extra["areFeesSponsored"] !== true) return refusal("x402/option-malformed");
  if (unmux(o.payTo) !== null) return refusal("stellar/option-malformed");
  if (!isContract(o.asset) || !isAccount(o.payTo)) return refusal("x402/option-malformed");
  if (typeof o.amount !== "string" || !AMOUNT.test(o.amount) || BigInt(o.amount) >= I128_LIMIT) {
    return refusal("x402/option-malformed");
  }
  if (!isTimeoutSeconds(o.maxTimeoutSeconds) || Math.ceil(o.maxTimeoutSeconds / 5) > UINT32_MAX) {
    return refusal("x402/option-malformed");
  }
  return true;
};

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(filter)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filter)(doc);
}

/** The `0x` lowercase hex of bytes. */
function hex0x(b: Uint8Array): string {
  let out = "0x";
  for (const x of b) out += x.toString(16).padStart(2, "0");
  return out;
}

/**
 * What the buyer signs, from its simulated transaction: the entry's expiration ledger set to the current ledger plus
 * `ceil(maxTimeoutSeconds / 5)`, and the preconditions set to one signed-payload signer, the buyer's key with the
 * payload of H and the entry's nonce. Nothing reaches the signer unless the operation invokes exactly the transfer the
 * entry signs, on the option's `asset`, for its `amount` exactly, from the choice's `payer`, to the option's `payTo`,
 * which is not the `payer`. H is checked first, then the choice members whose form needs neither the document nor the
 * SDK (the current ledger, `stellar/tx-malformed`; the payer, an account strkey, else `stellar/payer-mismatch`), then the
 * document and the option, then the simulated transaction, which the SDK reads: without it the choice is
 * `stellar/peer-missing` only then.
 */
async function build(c: StellarPreconditionChoice, h: AtrHash): Promise<StellarUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/not-v2");
  if (!isLedgerSequence(c.currentLedger)) return refusal("stellar/tx-malformed");
  if (!isAccount(c.payer)) return refusal("stellar/payer-mismatch");
  const ok = chosen(c.required, c.accepted, filter);
  if (ok !== true) return ok;
  const { required, accepted } = c;
  const expiration = c.currentLedger + Math.ceil(accepted.maxTimeoutSeconds / 5);
  const s = preconditionSigningFor(c.simulatedXdr, accepted.network as StellarNetwork, expiration, (nonce) =>
    signedPayload(nh, nonce),
  );
  if (isRefusal(s)) return s;
  const { payment } = s;
  if (!s.agrees) return refusal("stellar/not-one-transfer");
  if (payment.asset !== accepted.asset) return refusal("stellar/asset-mismatch");
  if (payment.amount !== BigInt(accepted.amount)) return refusal("stellar/amount-mismatch");
  if (payment.from !== c.payer) return refusal("stellar/payer-mismatch");
  if (payment.to !== accepted.payTo || payment.from === accepted.payTo) return refusal("stellar/payee-mismatch");
  return {
    request: { kind: "stellar-precondition", preimage: s.preimage, payload: s.payload },
    complete(signatures: { entry: Uint8Array; payload: Uint8Array }): StellarPaymentPayload | Refusal {
      const transaction = s.written(signatures);
      return isRefusal(transaction) ? transaction : paymentWith(required, accepted, { transaction });
    },
  };
}

/**
 * The option a payment answers, its envelope and H, or the refusal that names what is wrong: the option through the
 * filter, then the envelope (`readPrecondition`: its size, form, one `transfer` and the buyer's address entry), then the
 * operation invoking exactly the transfer the entry signs (`stellar/not-one-transfer`), a buyer that is an account
 * (`stellar/no-address-auth`), exactly one signed-payload signer (`stellar/no-carrier`), its payload 40 bytes whose
 * last 8 are the entry's nonce and its key one whose signature the entry carries (`stellar/carrier-mismatch`), and a
 * transfer whose `from` is not the option's `payTo` (`stellar/payee-mismatch`).
 */
function carried(presented: unknown): { accepted: PaymentRequirements; p: PreconditionEnvelope; h: AtrHash; payload: Uint8Array } | Refusal {
  const pw = presentedWith(presented, filter);
  if (isRefusal(pw)) return pw;
  const { accepted, payload } = pw;
  const tx = payload["transaction"];
  if (typeof tx !== "string") return refusal("x402/payload-malformed");
  const p = readPrecondition(tx, accepted.network as StellarNetwork, false);
  if (isRefusal(p)) return p;
  if (!p.agrees) return refusal("stellar/not-one-transfer");
  if (!isAccount(p.payment.from)) return refusal("stellar/no-address-auth");
  if (p.signers.length !== 1) return refusal("stellar/no-carrier");
  const signer = p.signers[0]!;
  const read = readSignedPayload(signer.payload);
  if (isRefusal(read)) return read;
  if (read.value !== p.payment.auth.nonce || !p.entryKeys.includes(signer.key)) return refusal("stellar/carrier-mismatch");
  if (p.payment.from === accepted.payTo) return refusal("stellar/payee-mismatch");
  return { accepted, p, h: read.h, payload: signer.payload };
}

/**
 * H, the first 32 bytes of the presented transaction's signed-payload precondition, once `carried`'s checks hold. The
 * signatures are not verified here: the network verifies the entry's when it is used and the payload's at submission.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = carried(presented);
  return isRefusal(r) ? r : r.h;
}

/**
 * The read keys, from the presented transaction and the option it answers: the option's payee (`payTo`); the network;
 * the buyer; the transfer's asset and `to` base account; the entry's nonce, expiration ledger and `HashIDPreimage`
 * digest; and the 40-byte payload as presented. A presented `accepted` that is not the option given, compared as RFC
 * 8785 JSON, is `x402/accepted-not-option`; an option with no `payTo` string is `x402/option-malformed`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<StellarRef | Refusal> {
  const r = carried(presented);
  if (isRefusal(r)) return r;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameJson(r.accepted, option)) return refusal("x402/accepted-not-option");
  const { payment } = r.p;
  return {
    network: r.accepted.network as StellarNetwork,
    payee,
    buyer: payment.from,
    asset: payment.asset,
    toBase: payment.toBase,
    nonce: payment.auth.nonce.toString(),
    expiration: payment.auth.expiration,
    authDigest: payment.auth.preimageHash,
    payload: hex0x(r.payload),
  };
}

/**
 * The option unchanged: H rides in the signed transaction, not in the option. An option that carries a `refused`
 * member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/stellar/precondition`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's settler
 * submits the transaction as its source; `status` finds it by the buyer's events and holds it to the five checks.
 */
export const exactStellarPrecondition = Object.freeze({
  id: ID,
  data: STELLAR[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: stellarStatus,
  recover: stellarRecover,
}) satisfies Entry<
  typeof ID,
  StellarPaymentPayload,
  StellarRef,
  StellarReader,
  X402Forms & {
    choice: StellarPreconditionChoice;
    unsigned: StellarUnsigned;
    landed: StellarLanded;
    network: StellarNetwork;
    query: StellarQuery;
    answer: StellarStatus;
  }
>;
