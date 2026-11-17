/**
 * `mpp/charge/nearintents`: the ATR hash in LCP string form as the request's `externalId`, inside the challenge the
 * resource server issues once the agreement is recorded and it holds a NEAR Intents quote. The ATR is assembled before
 * any quote, so it names the option by the seller's fixed members alone. The buyer's deposit carries nothing of this
 * pairing, so its record says an agreement transaction came first. Settlement is the resource server's report.
 */
import { base58 } from "@scure/base";
import { canonicalJson, fromLcpString, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import { isObject, normalHash } from "./fields.js";
import {
  byType,
  challengeSnapshot,
  decodeObject,
  deepFreeze,
  echoedFor,
  isChallengeShape,
  memberAt,
  mppBroadcaster,
  opaqueMembers,
  placeCarrier,
  read,
  sameBound,
  tie,
  unplacedChallenge,
  type MppChallenge,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import { isExternalId } from "./mpp-rail-checks.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";
import { NEAR } from "./internal/data/near.js";
import type { Entry, NoRead } from "./internal/registry.js";

const ID = "mpp/charge/nearintents" as const;

/**
 * The read keys of a NEAR Intents deposit: the origin network the challenge names, `methodDetails.originNetwork`, and
 * the deposit's transaction hash as the credential presents it, in that network's spelling. The pairing has no
 * `status`, so the reference names no payee.
 */
export interface NearIntentsRef {
  network: string;
  transaction: string;
}

/**
 * The request members the draft requires that the seller fixes before any quote (draft-nearintents-charge-01, Shared
 * Fields and Method Details), each a string: the ATR names the option by them.
 */
const FIXED: readonly (readonly string[])[] = [
  ["currency"],
  ["methodDetails", "originNetwork"],
  ["methodDetails", "destinationNetwork"],
  ["methodDetails", "destinationAsset"],
  ["methodDetails", "destinationRecipient"],
  ["methodDetails", "amountOut"],
];

/** The request members the draft requires that are written at the quote, each a string. */
const QUOTED: readonly (readonly string[])[] = [
  ["recipient"],
  ["amount"],
  ["methodDetails", "minAmountIn"],
  ["methodDetails", "refundTo"],
];

/**
 * The `expires` a challenge without one is placed under at issue, and which is then removed. The filter holds every
 * challenge of this pairing to an `expires`, which the draft requires of a challenge sent; the challenge the ATR names
 * is never sent and has none, its `expires` being the quote's deadline.
 */
const LENT_EXPIRES = "1970-01-01T00:00:00Z";

/**
 * H from the echoed challenge's `externalId`, for a push credential (`type="hash"`) whose challenge names that H. An
 * `externalId` that is neither absent nor a string is `mpp/request-malformed`, the code `advertise` gives it.
 */
async function bound(credential: unknown): Promise<AtrHash | Refusal> {
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  const ext = e.checked.request["externalId"];
  if (!isExternalId(ext)) return refusal("mpp/request-malformed");
  if (e.payload["type"] !== "hash") return refusal("near/not-hash-credential");
  const h = typeof ext === "string" ? fromLcpString(ext) : null;
  if (h === null) return refusal("near/memo-not-lcp");
  if (!hashEquals(h, e.h)) return refusal("mpp/carrier-not-challenge");
  return e.h;
}

/** `externalId` as issued: absent, or already H's LCP string, else `near/carrier-occupied`. */
function carrierFor(h: AtrHash): (issued: Json | undefined) => string | Refusal {
  const value = toLcpString(h);
  return (issued) => (issued === undefined || issued === value ? value : refusal("near/carrier-occupied"));
}

/** Whether the challenge's request holds each member `paths` names as a string. */
function holdsStrings(c: MppChallenge, paths: readonly (readonly string[])[]): boolean {
  const request = decodeObject(c.request);
  return request !== undefined && paths.every((p) => typeof memberAt(request, p) === "string");
}

/**
 * The placement of a quoted challenge: MPP's `place`, then `externalId` set to H's LCP string, once the challenge
 * carries every member the draft requires as a string (else `mpp/request-malformed`) and its fixed members are those of
 * `named`, the challenge as the ATR names it: the ATR's binding slot entry, the challenge `advertiseBeforeCarrier`
 * placed at issue, or the seller's challenge before any quote. The two are compared as `unplaced` gives them, every
 * bound member, `opaque` by its seller map: a quoted challenge that differs, or one given no `named`, is
 * `near/fixed-members-differ`. An `externalId` already holding another value is `near/carrier-occupied`.
 */
function advertise(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  position: number | null,
  agreementUrl?: string,
  named?: MppChallenge,
): MppChallenge[] | Refusal {
  if (normalHash(h) === null) return refusal("mpp/challenge-malformed");
  const placed = placeCarrier(doc, h, link, offer, position, carrierFor(h), agreementUrl);
  if (isRefusal(placed)) return placed;
  if (!holdsStrings(offer, [...FIXED, ...QUOTED])) return refusal("mpp/request-malformed");
  if (!isChallengeShape(named) || !sameBound(unplacedChallenge(offer), unplacedChallenge(named))) {
    return refusal("near/fixed-members-differ");
  }
  return placed;
}

/**
 * The placement at issue, before any quote: MPP's `place`, then `externalId` set to H's LCP string, once the challenge
 * carries every fixed member the draft requires as a string (else `mpp/request-malformed`). The quote's members are not
 * read, and a challenge without `expires` is placed and given back without one.
 */
function advertiseBeforeCarrier(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  position: number | null,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  if (normalHash(h) === null) return refusal("mpp/challenge-malformed");
  const lend = isChallengeShape(offer) && offer.expires === undefined;
  const lent = (c: MppChallenge): MppChallenge =>
    lend && isChallengeShape(c) && sameBound(c, offer) ? { ...c, expires: LENT_EXPIRES } : c;
  const given = Array.isArray(doc) ? doc.map(lent) : doc;
  const placed = placeCarrier(given, h, link, lent(offer), position, carrierFor(h), agreementUrl);
  if (isRefusal(placed)) return placed;
  if (!holdsStrings(offer, FIXED)) return refusal("mpp/request-malformed");
  return placed.map((c, i) => {
    if (given[i] === doc[i]) return c;
    const out = { ...c };
    delete out.expires;
    return out;
  });
}

/**
 * The challenge as issued, as `unplacedChallenge` gives it: its request without `externalId`, the quote's members and
 * `refundTo`, and without `expires`. A challenge that carries a `refused` member is `mpp/challenge-malformed`; a value
 * that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): MppChallenge | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return unplacedChallenge(option);
}

/** Two challenges with the same members, MPP's own, each equal: `request` and `opaque` by their decoded members. */
function sameChallenge(a: unknown, b: unknown): boolean {
  const x = challengeSnapshot(a);
  const y = challengeSnapshot(b);
  if (x === undefined || y === undefined) return false;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  return keys.every((k) => {
    const u = (x as unknown as { [k: string]: unknown })[k];
    const v = (y as unknown as { [k: string]: unknown })[k];
    if (!Object.hasOwn(y, k)) return false;
    if (k === "request") return typeof u === "string" && typeof v === "string" && sameJson(decodeObject(u), decodeObject(v));
    if (k === "opaque") return sameJson(opaqueMembers(u), opaqueMembers(v));
    return u === v;
  });
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false;
  const x = canonicalJson(a);
  return typeof x === "string" && x === canonicalJson(b);
}

/** 32 bytes of hex, with or without a `0x` prefix. */
const HEX32 = /^(?:0x)?([0-9a-fA-F]{64})$/;
/** Visible ASCII, at least one character. */
const VISIBLE = /^[\x21-\x7e]+$/;

/** The length in bytes of base58 text in Bitcoin's alphabet, or undefined. */
function base58Length(s: string): number | undefined {
  try {
    return base58.decode(s).length;
  } catch {
    return undefined;
  }
}

/**
 * A deposit's transaction hash in its origin network's spelling, from the draft's canonical transaction identifier
 * rules (draft-nearintents-charge-01, Replay Protection): on `eip155` and `bip122`, 32 bytes of hex compared
 * case-insensitively with an optional `0x` prefix, written lowercase, with `0x` on `eip155` and without on `bip122`; on
 * `near`, base58 of a 32-byte hash, and on `solana`, base58 of a 64-byte signature, each compared exactly and kept as
 * presented; on any other namespace, visible ASCII kept as presented. Undefined where the hash is not so spelled.
 */
function spelled(network: string, hash: unknown): string | undefined {
  if (typeof hash !== "string" || !VISIBLE.test(hash)) return undefined;
  const namespace = network.includes(":") ? network.slice(0, network.indexOf(":")) : network;
  const hex = HEX32.exec(hash)?.[1]?.toLowerCase();
  if (namespace === "eip155") return hex === undefined ? undefined : `0x${hex}`;
  if (namespace === "bip122") return hex;
  if (namespace === "near") return base58Length(hash) === 32 ? hash : undefined;
  if (namespace === "solana") return base58Length(hash) === 64 ? hash : undefined;
  return hash;
}

/**
 * The read keys of a presented deposit: the origin network and the deposit's hash in its spelling (`spelled`). The
 * credential is held as `bound` holds it, with `bound`'s code for each fault; then its echoed challenge must be
 * `option`, the challenge the payment answers, member by member, `request` and `opaque` by their decoded members, else
 * `mpp/challenge-not-option`, an `option` that is not a challenge among them; then a hash not so spelled is
 * `mpp/credential-malformed`.
 */
async function reference(credential: unknown, option: MppChallenge): Promise<NearIntentsRef | Refusal> {
  const h = await bound(credential);
  if (isRefusal(h)) return h;
  const e = echoedFor(credential, ID);
  if (isRefusal(e)) return e;
  if (!isChallengeShape(option) || !sameChallenge((credential as MppCredential).challenge, option)) {
    return refusal("mpp/challenge-not-option");
  }
  const network = e.checked.details["originNetwork"] as string;
  const transaction = spelled(network, e.payload["hash"]);
  return transaction === undefined ? refusal("mpp/credential-malformed") : { network, transaction };
}

const pattern: LcpPattern = deepFreeze({
  pattern: "opaque-challenge",
  profile: "mpp/charge/nearintents",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/** This pairing's family descriptor: MPP's, with `advertise` taking the challenge as the ATR names it. */
type NearIntentsForms = Omit<MppForms, "rest"> & {
  readonly rest: [position: number | null, agreementUrl?: string, named?: MppChallenge];
} & NoRead & { choice: never; unsigned: never };

/**
 * `mpp/charge/nearintents`. The payer broadcasts (`broadcaster` answers `"payer"` for a credential of `type` `hash`):
 * it sends its deposit before presenting the deposit's hash. Settlement is the resource server's report: no
 * `fetchPresented`, `status` or `recover` reads it, and `reference` names the deposit by its origin network and hash. A
 * credential of any other type gets `near/not-hash-credential`, as `bound` refuses it.
 */
export const chargeNearIntents = Object.freeze({
  id: ID,
  data: NEAR[ID],
  pattern,
  claims: false as boolean,
  unplaced,
  tie,
  advertise,
  advertiseBeforeCarrier,
  read,
  bound,
  reference,
  broadcaster: mppBroadcaster(byType({ hash: "payer" }, () => refusal("near/not-hash-credential"))),
}) satisfies Entry<typeof ID, MppCredential, NearIntentsRef, never, NearIntentsForms>;
