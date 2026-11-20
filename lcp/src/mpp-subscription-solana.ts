/**
 * `mpp/subscription/solana`: MPP's `subscription` intent under the stock `solana` method, as `@solana/pay-kit` 0.13.1
 * defines it. The sale is the activation, the transaction that subscribes the payer to the plan and collects the first
 * period. The stock client writes the request's `externalId` as the activation's Memo instruction, after
 * `transfer_subscription` (`dist/chunk-SSATEZ72.js:2444-2447`, `:2534-2544`), and the pairing places H's LCP string
 * there. The stock server never reads the Memo, so `bound` checks it before the stock verify.
 */
import { hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import { normalHash } from "./fields.js";
import {
  decodeSvmTx,
  keyBytes,
  keyString,
  staticNonce,
  wireOf,
  type SolanaNetwork,
  type SvmTx,
} from "./internal/svm.js";
import { mppSvmReference, svmStatus, type SvmQuery, type SvmReader, type SvmRef, type SvmStatus } from "./internal/svm-read.js";
import {
  byType,
  credentialOf,
  deepFreeze,
  echoedFor,
  isObject,
  measuring,
  measuringAsync,
  mppBroadcaster,
  offeredFor,
  placeCarrier,
  read,
  tie,
  unixOf,
  withoutCarrier,
  type Echoed,
  type MppChallenge,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import { solanaNetworkOf } from "./mpp-rail-checks.js";
import { mppSvmCarrier, recover } from "./mpp-solana.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";
import { SOLANA as SOLANA_DATA } from "./internal/data/solana.js";
import { mppPayee } from "./internal/payee.js";
import type { Act } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";

const ID = "mpp/subscription/solana" as const;

/** The subscriptions program deployed on Solana, the one `@solana/pay-kit` 0.13.1 names (`dist/chunk-SSATEZ72.js:14`). */
export const SUBSCRIPTIONS_PROGRAM = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
/**
 * The `subscribe` instruction's discriminator, the first byte of its data, which `SubscribeData` follows
 * (`@solana/subscriptions` 0.5.0, which `@solana/pay-kit` 0.13.1 bundles: `dist/index.js:2254-2265`).
 */
const SUBSCRIBE = 11;
/**
 * The accounts of `subscribe`: the subscriber, a writable signer, first, then the merchant and the plan, and the
 * subscription fourth (`@solana/subscriptions` 0.5.0 `dist/index.js:2276-2325`).
 */
const SUBSCRIBE_SUBSCRIBER_ACCOUNT = 0;
const SUBSCRIBE_SUBSCRIPTION_ACCOUNT = 3;
/** The activation a `type="transaction"` credential presents; any other type is `mpp/credential-type`. */
function activationTx(payload: { [k: string]: Json }): SvmTx | Refusal {
  if (payload["type"] !== "transaction") return refusal("mpp/credential-type");
  const wire = wireOf(payload["transaction"]);
  return isRefusal(wire) ? wire : decodeSvmTx(wire);
}

/**
 * The echoed challenge's binding: the request's `externalId`, and the activation's one LCP memo, which must be spelled
 * exactly as H's LCP string, equal `externalId` and name the challenge's H.
 */
function bindingOf(credential: MppCredential): { h: AtrHash; checked: Echoed; tx: SvmTx } | Refusal {
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const tx = activationTx(e.payload);
  if (isRefusal(tx)) return tx;
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const carrier = mppSvmCarrier(tx);
  if (isRefusal(carrier)) return carrier;
  if (carrier.memo !== e.checked.request["externalId"]) return refusal("svm/carrier-mismatch");
  if (!hashEquals(carrier.h, e.h)) return refusal("mpp/carrier-not-challenge");
  return { h: e.h, checked: e.checked, tx };
}

/** H from the echoed challenge, once the activation's LCP memo equals the request's `externalId` and names that H. */
async function bound(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(credential);
  return isRefusal(b) ? b : b.h;
}

/** The network of a held challenge's `methodDetails.network`; `localnet` is `svm/network-undeclared`. */
function networkOf(checked: Echoed): SolanaNetwork | Refusal {
  const n = solanaNetworkOf(checked.details, false);
  return n === null ? refusal("svm/network-undeclared") : n;
}

/**
 * The activation's one `subscribe` instruction of the request's subscriptions program, `methodDetails.subscriptionProgram`,
 * the account at `at` it names: the subscriber (account 0) or the subscription (account 3). An activation with no such
 * instruction, or more than one, is `svm/open-not-found`.
 */
function subscribeAccount(b: { checked: Echoed; tx: SvmTx }, at: number): string | Refusal {
  const program = keyBytes(b.checked.details["subscriptionProgram"])!;
  const subscribes = b.tx.instructions.filter((ix) => {
    const p = b.tx.keys[ix.program];
    return p !== undefined && p.every((x, i) => x === program[i]) && ix.data[0] === SUBSCRIBE;
  });
  const account = subscribes.length === 1 ? subscribes[0]!.accounts[at] : undefined;
  const key = account === undefined ? undefined : b.tx.keys[account];
  return key === undefined ? refusal("svm/open-not-found") : keyString(key);
}

/**
 * The activation's read keys on the request's network (`mppSvmReference`): H, the fee payer and what bounds the
 * message's life, and the payee of `option`, the challenge it answers; a credential whose echoed challenge is not
 * `option` is `mpp/challenge-not-option`. The buyer is the subscriber `subscribe` names (account 0), whose token account
 * the activation's transfer debits, never a signer taken by its place: the activation is signed by the subscriber and by
 * the challenge's `puller`, the seller's key, `transfer_subscription`'s caller (`@solana/pay-kit` 0.13.1
 * `dist/chunk-SSATEZ72.js:2431-2443`), and past the fee payer `@solana/kit` orders the signers by address. An
 * activation with no one `subscribe` is `svm/open-not-found`.
 */
async function reference(input: unknown, option: MppChallenge): Promise<SvmRef | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(credential);
  if (isRefusal(b)) return b;
  const network = networkOf(b.checked);
  if (isRefusal(network)) return network;
  const subscriber = subscribeAccount(b, SUBSCRIBE_SUBSCRIBER_ACCOUNT);
  if (isRefusal(subscriber)) return subscriber;
  const ref = await mppSvmReference(credential.challenge, network, b.tx, b.h, option);
  return isRefusal(ref) ? ref : { ...ref, payer: subscriber };
}

/**
 * The placement, once the offer names this pairing (`offeredFor`, else its refusal or `mpp/not-this-pairing`): MPP's
 * `place`, then `externalId` set to H's LCP string; another value is `svm/carrier-occupied`.
 */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  position: number | null,
  act?: Act,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  if (normalHash(h) === null) return refusal("mpp/challenge-malformed");
  const offered = offeredFor(offer, ID);
  if (isRefusal(offered)) return offered;
  const memo = toLcpString(h);
  return placeCarrier(
    doc,
    h,
    link,
    offer,
    position,
    act,
    (issued) => (issued === undefined || issued === memo ? memo : refusal("svm/carrier-occupied")),
    agreementUrl,
  );
}

/** The challenge as issued: its request without `externalId`. A challenge carrying a `refused` member is malformed. */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return withoutCarrier(option);
}

/**
 * A `type="transaction"` credential is the activation, which opens the subscription; a `type="proof"` credential, the
 * payer's reusable proof of the subscription (`@solana/pay-kit` 0.13.1 `dist/chunk-SSATEZ72.js:2008-2014`), is within
 * it. Renewals are the seller's pulls, and no other credential is the pairing's (`mpp/session-action`).
 */
function kind(presented: MppCredential): "open" | "within" | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  if (c.payload["type"] === "transaction") return "open";
  return c.payload["type"] === "proof" ? "within" : refusal("mpp/session-action");
}

/**
 * The subscription the activation opens: the account `subscribe` names as the subscription (account 3) in the
 * activation `bound` reads, on the request's network. An activation with no `subscribe` instruction of the request's
 * subscriptions program, or more than one, is `svm/open-not-found`. A proof names the same account as its
 * `subscriptionDelegation`, a key, else `mpp/credential-malformed`.
 */
async function ref(presented: MppCredential): Promise<{ network: string; channel: string } | Refusal> {
  const credential = credentialOf(presented);
  if (isRefusal(credential)) return credential;
  if (credential.payload["type"] === "proof") {
    const e = echoedFor(credential, ID);
    if (isRefusal(e)) return e;
    const network = networkOf(e.checked);
    if (isRefusal(network)) return network;
    const delegation = credential.payload["subscriptionDelegation"];
    return typeof delegation === "string" && keyBytes(delegation) !== null ? { network, channel: delegation } : refusal("mpp/credential-malformed");
  }
  const b = bindingOf(credential);
  if (isRefusal(b)) return b;
  const network = networkOf(b.checked);
  if (isRefusal(network)) return network;
  const channel = subscribeAccount(b, SUBSCRIBE_SUBSCRIPTION_ACCOUNT);
  return isRefusal(channel) ? channel : { network, channel };
}

/** Renewals are the seller's pulls: none carries H. */
async function boundWithin(_presented: MppCredential): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

/** The request's `subscriptionExpires` in Unix seconds, read from an activation `bound` takes; none otherwise. */
function until(presented: MppCredential): number | undefined {
  const e = echoedFor(presented, ID);
  if (isRefusal(e) || isRefusal(kind(presented))) return undefined;
  const at = e.checked.request["subscriptionExpires"];
  return typeof at === "string" ? unixOf(at) : undefined;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: "mpp/subscription/solana",
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `mpp/subscription/solana`. The payee broadcasts (`broadcaster` answers `"payee"` for a `type="transaction"`
 * credential): the activation's `transfer_subscription` needs the signature of the challenge's `puller`, the seller's
 * key, which the payer's client does not hold (`@solana/pay-kit` 0.13.1 `dist/chunk-SSATEZ72.js:2393-2394`,
 * `:2431-2443`), so the seller's server co-signs and submits it. A credential of any other type is
 * `mpp/credential-type`, as `bound` refuses it.
 */
export const subscriptionSolana = Object.freeze({
  id: ID,
  data: SOLANA_DATA[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  bound,
  broadcaster: mppBroadcaster(byType({ transaction: "payee" })),
  reference,
  status: svmStatus,
  recover,
  channel: Object.freeze({
    kind: measuring(kind),
    ref: measuringAsync(ref),
    boundWithin: measuringAsync(boundWithin),
    until,
  }),
}) satisfies Entry<
  typeof ID,
  MppCredential,
  SvmRef,
  SvmReader,
  MppForms & {
    choice: never;
    unsigned: never;
    landed: object;
    network: SolanaNetwork;
    query: SvmQuery;
    answer: SvmStatus;
  }
>;
