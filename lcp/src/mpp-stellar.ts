/**
 * `mpp/charge/stellar`: the request's `recipient` placed as the seller's muxed address whose 8-byte id is the ATR
 * hash's first 8 bytes, which the payer signs as the Soroban `transfer`'s `to`. The full hash rides in the challenge.
 */
import type { AtrHash, Json } from "./core.js";
import {
  muxedFor,
  muxedId,
  readSignedTransfer,
  signingFor,
  stellarStatus,
  unmux,
  type StellarNetwork,
  type StellarPayment,
  type StellarReader,
  type StellarRef,
} from "./internal/stellar.js";
import {
  chosenFor,
  credentialOf,
  deepFreeze,
  echoedFor,
  isObject,
  placeCarrier,
  pushedField,
  read,
  tie,
  withoutCarrier,
  type Checked,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

const ID = "mpp/charge/stellar" as const;
const HASH = /^[0-9a-fA-F]{64}$/;

/**
 * The buyer's inputs to `build`: the chosen challenge, the buyer's simulated transaction, its ledger and clock readings,
 * and the payer's account (`G…`), which must be the simulated transfer's `from`.
 */
export interface StellarChargeChoice {
  challenge: MppChallenge & { id: string };
  simulatedXdr: string;
  currentLedger: number;
  now: number;
  payer: string;
}

export interface StellarChargeUnsigned {
  request: { kind: "stellar-auth"; preimage: Uint8Array };
  /** The payer's Ed25519 signature over SHA-256 of `preimage`. */
  complete(signature: Uint8Array): MppCredential | Refusal;
}

/** The signed transfer a credential presents: its `transaction`, or for `type="hash"` the one fetched by that hash. */
function presentedXdr(payload: { [k: string]: Json }): string | Refusal {
  const type = payload["type"];
  if (type !== "transaction" && type !== "hash") return refusal("mpp/credential-type");
  const xdr = payload["transaction"];
  if (xdr === undefined) return type === "hash" ? refusal("stellar/read-first") : refusal("stellar/tx-malformed");
  return typeof xdr === "string" ? xdr : refusal("stellar/tx-malformed");
}

function bindingOf(credential: MppCredential): { h: AtrHash; checked: Checked; payment: StellarPayment } | Refusal {
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const xdr = presentedXdr(e.payload);
  if (isRefusal(xdr)) return xdr;
  const signed = readSignedTransfer(xdr, e.checked.details["network"] as StellarNetwork);
  if (isRefusal(signed)) return signed;
  const { payment } = signed;
  if (payment.toId === null) return refusal("stellar/no-carrier");
  if (payment.to !== e.checked.request["recipient"] || payment.toId !== muxedId(e.h)) {
    return refusal("stellar/carrier-mismatch");
  }
  if (!signed.agrees) return refusal("stellar/not-one-transfer");
  return { h: e.h, checked: e.checked, payment };
}

/**
 * H from the echoed challenge, once the `to` of the invocation the payer's entry signs is the request's muxed
 * `recipient` whose id is H's first 8 bytes, and the operation invokes exactly that.
 * The authorization's signature is not verified here; the network verifies it when the entry is used.
 */
async function bound(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(credential);
  return isRefusal(b) ? b : b.h;
}

/** The read keys from the signed entry; `transaction` only for a credential the client submitted itself. */
async function reference(input: unknown): Promise<StellarRef | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(credential);
  if (isRefusal(b)) return b;
  const hash = credential.payload["hash"];
  return {
    network: b.checked.details["network"] as StellarNetwork,
    ...(credential.payload["type"] === "hash" && typeof hash === "string" ? { transaction: hash.toLowerCase() } : {}),
    authDigest: b.payment.auth.preimageHash,
    asset: b.payment.asset,
    toBase: b.payment.toBase,
    toId: b.payment.toId!.toString(),
    expiration: b.payment.auth.expiration,
    fromLedger: 0,
  };
}

/**
 * A push credential (`type="hash"`) with the landed envelope added as `transaction`. Other credentials are returned
 * unchanged. A read that fails, or finds nothing, is a refusal the seller retries; a transaction the ledger records as
 * `FAILED` is refused `stellar/tx-failed`.
 */
async function fetchPresented(credential: MppCredential, reader: StellarReader): Promise<MppCredential | Refusal> {
  if (!isObject(credential) || carriesRefused(credential) || !isObject(credential.payload)) {
    return refusal("mpp/credential-malformed");
  }
  if (credential.payload["type"] !== "hash") return credential;
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  if (reader.network !== e.checked.details["network"]) return refusal("stellar/wrong-reader");
  const hash = credential.payload["hash"];
  if (typeof hash !== "string" || !HASH.test(hash)) return refusal("mpp/credential-malformed");
  let r: Awaited<ReturnType<StellarReader["transaction"]>>;
  try {
    r = await reader.transaction(hash.toLowerCase());
  } catch {
    return refusal("stellar/unreadable");
  }
  if (!isObject(r)) return refusal("stellar/unreadable");
  if (r.status === "FAILED") return refusal("stellar/tx-failed");
  if (r.status === "NOT_FOUND" || typeof r.envelopeXdr !== "string") return refusal("stellar/not-found");
  if (r.status !== "SUCCESS") return refusal("stellar/unreadable");
  return { ...credential, payload: { ...credential.payload, transaction: r.envelopeXdr } };
}

/**
 * The authorization preimage for the payer to sign, from the buyer's simulated transaction, with the entry's expiration at
 * `currentLedger + ceil((expires − now) / 5)`. The request's `recipient` must carry `muxedId(h)` and equal the `to` of
 * the invocation the payer's entry signs, and the operation must invoke exactly that. That invocation's token contract
 * must then be the request's `currency`, its amount the request's `amount` exactly, and its `from` the choice's
 * `payer`. Nothing reaches the signer unless every one holds. With `feePayer` true the source is the all-zeros account.
 */
async function build(choice: StellarChargeChoice, h: AtrHash): Promise<StellarChargeUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("stellar/tx-malformed");
  const checked = chosenFor(choice.challenge, h, ID);
  if (isRefusal(checked)) return checked;
  const recipient = checked.request["recipient"];
  const m = unmux(recipient);
  if (m === null || m.id !== muxedId(h)) return refusal("stellar/carrier-mismatch");
  if (!Number.isSafeInteger(choice.currentLedger) || choice.currentLedger < 0 || !Number.isSafeInteger(choice.now)) {
    return refusal("stellar/tx-malformed");
  }
  const expiration = choice.currentLedger + Math.max(0, Math.ceil((checked.expires - choice.now) / 5));
  const s = signingFor(
    choice.simulatedXdr,
    checked.details["network"] as StellarNetwork,
    expiration,
    checked.details["feePayer"] === true,
  );
  if (isRefusal(s)) return s;
  if (s.payment.to !== recipient) return refusal("stellar/carrier-mismatch");
  if (!s.agrees) return refusal("stellar/not-one-transfer");
  if (s.payment.asset !== checked.request["currency"]) return refusal("stellar/asset-mismatch");
  if (s.payment.amount !== BigInt(checked.request["amount"] as string)) return refusal("stellar/amount-mismatch");
  if (s.payment.from !== choice.payer) return refusal("stellar/payer-mismatch");
  const challenge = choice.challenge;
  return {
    request: s.unsigned.request,
    complete(signature: Uint8Array): MppCredential | Refusal {
      const xdr = s.unsigned.complete(signature);
      if (isRefusal(xdr)) return xdr;
      return { challenge, payload: { type: "transaction", transaction: xdr } };
    },
  };
}

/** The challenge as issued: a muxed `recipient` back to its base `G…` account, the member that stays in the digest. */
function unplaced(option: MppChallenge): MppChallenge {
  return withoutCarrier(option, unmux);
}

/** The placement: MPP's `place`, then `recipient` set to the seller's muxed address carrying H's first 8 bytes. */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  return placeCarrier(
    doc,
    h,
    link,
    offer,
    (issued) => {
      if (unmux(issued) !== null) return refusal("stellar/carrier-occupied");
      try {
        return muxedFor(issued as string, h);
      } catch {
        return refusal("stellar/option-malformed");
      }
    },
    agreementUrl,
  );
}

const pattern: LcpPattern = deepFreeze({
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

export const chargeStellar = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: "request.recipient" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: stellarStatus,
  fetchPresented,
  landedTx: (presented: unknown): string | undefined => {
    const hash = pushedField(presented, "hash", "hash");
    return hash !== undefined && HASH.test(hash) ? hash.toLowerCase() : undefined;
  },
});
