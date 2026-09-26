/**
 * `mpp/charge/nearintents`: the ATR hash in LCP string form as the request's `externalId`, inside the challenge the
 * seller's server binds. The buyer's deposit carries nothing of this pairing, so its record says the agreement
 * transaction came first. Settlement is the seller's report.
 */
import { fromLcpString, hashEquals, toLcpString, type AtrHash } from "./core.js";
import { deepFreeze, echoedFor, placeCarrier, read, tie, type MppChallenge, type MppCredential } from "./mpp-challenge.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

const ID = "mpp/charge/nearintents" as const;

/** H from the echoed challenge's `externalId`, for a push credential (`type="hash"`) whose challenge names that H. */
async function bound(credential: unknown): Promise<AtrHash | Refusal> {
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "hash") return refusal("near/not-hash-credential");
  const ext = e.checked.request["externalId"];
  const h = typeof ext === "string" ? fromLcpString(ext) : null;
  if (h === null) return refusal("near/memo-not-lcp");
  if (!hashEquals(h, e.h)) return refusal("mpp/carrier-not-challenge");
  return e.h;
}

/** The placement: MPP's `place`, then `externalId` set to H's LCP string. */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  const value = toLcpString(h);
  return placeCarrier(
    doc,
    h,
    link,
    offer,
    (issued) => (issued === undefined || issued === value ? value : refusal("near/carrier-occupied")),
    agreementUrl,
  );
}

/** The challenge as issued: `externalId` is left out of the digest of what was issued. */
function unplaced(option: MppChallenge): MppChallenge {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "opaque-challenge",
  canonical: true,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
    "recorded in <transaction>. The seller's MPP challenge carried this ATR's hash in its externalId, bound by the " +
    "seller's own key to a deposit address issued for that challenge only, and the seller reported delivery. The " +
    "buyer's deposit does not carry the hash, and the buyer did not sign it. The NEAR Intents backend, not a contract " +
    "the buyer signed, links the deposit to the seller.",
});

export const chargeNearIntents = Object.freeze({
  id: ID,
  pattern,
  claims: false as boolean,
  carrier: "request.externalId" as const,
  unplaced,
  tie,
  advertise,
  read,
  bound,
});
