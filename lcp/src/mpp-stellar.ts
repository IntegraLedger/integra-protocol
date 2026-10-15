/**
 * `mpp/charge/stellar`: the request's `recipient` placed as the seller's muxed address whose 8-byte id is the ATR
 * hash's first 8 bytes, which the payer signs as the Soroban `transfer`'s `to`. The full hash rides in the challenge.
 */
import type { AtrHash, Json } from "./core.js";
import {
  hasPeer,
  isAccount,
  muxedFor,
  muxedId,
  readSignedTransfer,
  readSourceTransfer,
  signingFor,
  stellarStatus,
  unmux,
  type StellarNetwork,
  type StellarPayment,
  type StellarReader,
  type StellarRef,
  type SourcePayment,
} from "./internal/stellar.js";
import {
  chosenFor,
  credentialOf,
  deepFreeze,
  echoedFor,
  expiresOf,
  FETCHED,
  fetchedOf,
  isObject,
  placeCarrier,
  pushedField,
  read,
  tie,
  withoutCarrier,
  type Echoed,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { isFeePayer, isStellarRecipient } from "./mpp-rail-checks.js";
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
  request: { kind: "stellar-auth"; preimage: Uint8Array<ArrayBuffer> };
  /** The payer's Ed25519 signature over SHA-256 of `preimage`. */
  complete(signature: Uint8Array): MppCredential | Refusal;
}

/**
 * The signed transfer a credential presents: its `transaction` for `type="transaction"`, or for `type="hash"` the
 * envelope `fetchPresented` wrote under `FETCHED`, read by that hash, else `stellar/read-first`. A `hash` credential's
 * own `transaction` member is not read.
 */
function presentedXdr(credential: MppCredential, payload: { [k: string]: Json }): string | Refusal {
  const type = payload["type"];
  if (type !== "transaction" && type !== "hash") return refusal("mpp/credential-type");
  if (type === "hash") {
    const read = fetchedOf(credential);
    const landed = isObject(read) ? read["transaction"] : undefined;
    return typeof landed === "string" ? landed : refusal("stellar/read-first");
  }
  const xdr = payload["transaction"];
  return typeof xdr === "string" ? xdr : refusal("stellar/tx-malformed");
}

/** `methodDetails.network`, one of the two Stellar networks MPP names, else `stellar/option-malformed`. */
function networkOf(e: Echoed): StellarNetwork | Refusal {
  const n = e.details["network"];
  return n === "stellar:pubnet" || n === "stellar:testnet" ? n : refusal("stellar/option-malformed");
}

/**
 * The echoed challenge's binding: its `network` and its request's `recipient`, an account or its muxed form, read as
 * `advertise` reads them (else `stellar/option-malformed`), and the payment read from its transaction. A `hash`
 * credential under a request with `feePayer` true is `mpp/credential-type`: MPP's Stellar charge forbids push mode
 * when the server sponsors the fee. A `hash` credential whose transaction carries no address entry of the payer, under
 * a request with `feePayer` false or absent, is read as a payer that authorized the transfer as the transaction's
 * source account; that transaction is the instrument, so the credential's `hash` must name it. There `feePayer` is read
 * as `advertise` reads it: one that is present and not a boolean is `stellar/option-malformed`.
 */
function bindingOf(
  credential: MppCredential,
): { h: AtrHash; checked: Echoed; network: StellarNetwork; payment: StellarPayment | SourcePayment } | Refusal {
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const network = networkOf(e.checked);
  if (isRefusal(network)) return network;
  if (!isStellarRecipient(e.checked.request["recipient"])) return refusal("stellar/option-malformed");
  const feePayer = e.checked.details["feePayer"];
  if (e.payload["type"] === "hash" && feePayer === true) return refusal("mpp/credential-type");
  const xdr = presentedXdr(credential, e.payload);
  if (isRefusal(xdr)) return xdr;
  const landed = e.payload["type"] === "hash";
  let signed: { payment: StellarPayment | SourcePayment; agrees: boolean } | Refusal = readSignedTransfer(xdr, network, landed);
  if (isRefusal(signed) && signed.code === "stellar/no-address-auth" && landed) {
    if (!isFeePayer(feePayer)) return refusal("stellar/option-malformed");
    const source = readSourceTransfer(xdr, network);
    if (!isRefusal(source)) {
      const hash = e.payload["hash"];
      if (typeof hash !== "string" || !HASH.test(hash)) return refusal("mpp/credential-malformed");
      signed = { payment: source, agrees: true };
    }
  }
  if (isRefusal(signed)) return signed;
  const { payment } = signed;
  if (payment.toId === null) return refusal("stellar/no-carrier");
  if (payment.to !== e.checked.request["recipient"] || payment.toId !== muxedId(e.h)) {
    return refusal("stellar/carrier-mismatch");
  }
  if (!signed.agrees) return refusal("stellar/not-one-transfer");
  return { h: e.h, checked: e.checked, network, payment };
}

/**
 * H from the echoed challenge, once the `to` of the invocation the payer's entry signs is the request's muxed
 * `recipient` whose id is H's first 8 bytes, and the operation invokes exactly that. For a `transaction` credential,
 * not yet submitted, the operation carries exactly one address-credential entry of the payer. For a `hash` credential,
 * whose transaction landed, the entry is the payer's first address-credential entry whose `rootInvocation` is the
 * operation's `transfer`, byte for byte; other entries of the payer are not read. A `hash` credential whose transaction
 * carries no address entry of the payer, under a request with `feePayer` false or absent, binds H when the payer is the
 * source account of the transaction and of its operation and an entry with source-account credentials is that
 * `transfer`: the payer signed the whole transaction, `to` included. For a `transaction` credential such a payment is
 * `stellar/no-address-auth`; with a `feePayer` that is not a boolean, it is `stellar/option-malformed`. Under a request
 * with `feePayer` true, a `hash` credential is `mpp/credential-type`, fetched or not, whatever its entries.
 * The authorization's signature is not verified here; the network verifies it when the entry is used.
 */
async function bound(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(credential);
  return isRefusal(b) ? b : b.h;
}

/**
 * The read keys from the signed entry, the one `bound` reads; `transaction` only for a credential the client submitted
 * itself. For a payer that authorized the transfer as the transaction's source account there is no entry: the keys
 * are `transaction`, `asset`, `toBase` and `toId`, without `authDigest` or `expiration`.
 */
async function reference(input: unknown): Promise<StellarRef | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(credential);
  if (isRefusal(b)) return b;
  const hash = credential.payload["hash"];
  const auth = b.payment.auth;
  return {
    network: b.network,
    ...(credential.payload["type"] === "hash" && typeof hash === "string" ? { transaction: hash.toLowerCase() } : {}),
    ...(auth !== null ? { authDigest: auth.preimageHash } : {}),
    asset: b.payment.asset,
    toBase: b.payment.toBase,
    toId: b.payment.toId!.toString(),
    ...(auth !== null ? { expiration: auth.expiration } : {}),
    fromLedger: 0,
  };
}

/**
 * A push credential (`type="hash"`) with the landed envelope written under `FETCHED`, as `transaction`. Every other
 * member of the credential is copied unchanged and not read; a `FETCHED` member it carries is replaced by this read.
 * Other credentials are returned unchanged. Under a request with `feePayer` true a push credential is
 * `mpp/credential-type`, and nothing is read: MPP's Stellar charge forbids push mode when the server sponsors the fee.
 * A read that fails, or finds nothing, is a refusal the seller retries; a transaction the ledger records as `FAILED` is
 * refused `stellar/tx-failed`.
 */
async function fetchPresented(
  credential: MppCredential,
  reader: StellarReader,
): Promise<(MppCredential & { [FETCHED]?: { transaction: string } }) | Refusal> {
  if (!isObject(credential) || carriesRefused(credential) || !isObject(credential.payload)) {
    return refusal("mpp/credential-malformed");
  }
  if (credential.payload["type"] !== "hash") return credential;
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  if (e.checked.details["feePayer"] === true) return refusal("mpp/credential-type");
  const network = networkOf(e.checked);
  if (isRefusal(network)) return network;
  if (!isObject(reader) || reader.network !== network) return refusal("stellar/wrong-reader");
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
  return { ...credential, [FETCHED]: { transaction: r.envelopeXdr } };
}

/**
 * The authorization preimage for the payer to sign, from the buyer's simulated transaction, with the entry's expiration at
 * `currentLedger + ceil((expires − now) / 5)`. The request's `recipient` must carry `muxedId(h)` and equal the `to` of
 * the invocation the payer's entry signs, and the operation must invoke exactly that. That invocation's token contract
 * must then be the request's `currency`, its amount the request's `amount` exactly, and its `from` the choice's
 * `payer`. Nothing reaches the signer unless every one holds. With `feePayer` true the source is the all-zeros account.
 * Without @stellar/stellar-sdk the recipient and the transaction cannot be read: `stellar/peer-missing`.
 */
async function build(choice: StellarChargeChoice, h: AtrHash): Promise<StellarChargeUnsigned | Refusal> {
  if (!hasPeer()) return refusal("stellar/peer-missing");
  if (!isObject(choice)) return refusal("stellar/tx-malformed");
  const checked = chosenFor(choice.challenge, h, ID);
  if (isRefusal(checked)) return checked;
  const recipient = checked.request["recipient"];
  const m = unmux(recipient);
  if (m === null || m.id !== muxedId(h)) return refusal("stellar/carrier-mismatch");
  if (!Number.isSafeInteger(choice.currentLedger) || choice.currentLedger < 0 || !Number.isSafeInteger(choice.now)) {
    return refusal("stellar/tx-malformed");
  }
  const expires = expiresOf(checked);
  if (isRefusal(expires)) return expires;
  const expiration = choice.currentLedger + Math.max(0, Math.ceil((expires - choice.now) / 5));
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

/**
 * The placed challenge with only the muxed id taken out: `request`'s muxed `recipient` back to its base `G…`
 * account, the member that stays in the digest, and `request` re-encoded as base64url of the core's `canonicalJson`.
 * `id`, `opaque` and every other member stay as placed. A challenge that carries a `refused` member is
 * `mpp/challenge-malformed`. Without @stellar/stellar-sdk no `recipient` can be read, so any other challenge is
 * `stellar/peer-missing`. A value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  if (isObject(option) && !hasPeer()) return refusal("stellar/peer-missing");
  return withoutCarrier(option, unmux);
}

/**
 * The placement: MPP's `place`, then `recipient` set to the seller's muxed address carrying H's first 8 bytes. Without
 * @stellar/stellar-sdk the recipient cannot be placed: `stellar/peer-missing`.
 */
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
      if (!hasPeer()) return refusal("stellar/peer-missing");
      if (unmux(issued) !== null) return refusal("stellar/carrier-occupied");
      return isAccount(issued) ? muxedFor(issued, h) : refusal("stellar/option-malformed");
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
    "The ATR was assembled and delivered before approval, and its hash is in the payment challenge, which the payer " +
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
