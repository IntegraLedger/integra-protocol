/**
 * The `x402/upto/xrpl` pairing: x402's `upto` scheme on the XRP Ledger, at coverage `none`, its payment following an
 * agreement on the same network.
 *
 * The payer opens a payment channel to the option's `payTo` itself and presents the channel and its own account, so
 * nothing it signs carries the ATR hash. Settlement is read from the channel's create.
 *
 * @module
 */
import { canonicalJson, type AtrHash } from "./core.js";
import { isObject } from "./fields.js";
import {
  acceptedBy,
  advertiseFor,
  isTimeoutSeconds,
  readFor,
  x402Broadcaster,
  type OptionFilter,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { isXrplNetwork, type XrplNetwork, type XrplQuery, type XrplReader, type XrplStatus } from "./internal/xrpl.js";
import { xrplChannelStatus, type XrplChannelRef } from "./internal/xrpl-read.js";
import { accountIdOf } from "./internal/xrpl-session.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { tie, type LcpPattern, type PaymentRequired, type PaymentRequirements } from "./x402.js";
import { XRPL } from "./internal/data/xrpl.js";
import { x402Payee } from "./internal/payee.js";
import type { Entry } from "./internal/registry.js";
import type { Act } from "./internal/read.js";
export type { Broadcaster } from "./internal/broadcaster.js";

const ID = "x402/upto/xrpl" as const;
/** Drops of XRP: a positive integer in canonical decimal below 10^17, the most an XRP amount holds. */
const DROPS = /^[1-9][0-9]{0,16}$/;
const HASH256 = /^[0-9A-Fa-f]{64}$/;
/** The largest `SettleDelay` a `PaymentChannelCreate` carries, a UInt32 field. */
const MAX_SETTLE_DELAY = 0xffffffff;

/**
 * What the payer presents: the channel's id, the maximum its claim signs, the claim's signature, the channel's
 * `PublicKey` and the channel's `Account` (`specs/schemes/upto/scheme_upto_xrpl.md:172-188` at x402 `88b66dd4`).
 */
export interface UptoXrplPayload {
  channelId: string;
  maxAmount: string;
  signature: string;
  publicKey: string;
  payer: string;
}

/** A payment on `x402/upto/xrpl`. */
export interface UptoXrplPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: UptoXrplPayload;
  extensions?: PaymentRequired["extensions"];
}

/** Absent, `null`, or a non-negative safe integer no greater than `max`: the scheme's optional `extra` integers. */
function optionalCount(v: unknown, max: number): boolean {
  return v === undefined || v === null || (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max);
}

/**
 * True when the option can be paid as the scheme defines it: `amount` drops of XRP, `payTo` a classic address whose
 * checksum holds (`accountIdOf`), a positive safe-integer `maxTimeoutSeconds`, `extra.areFeesSponsored` `false`, and
 * `extra.minSettleDelay` and `extra.validAfter` each absent, `null`, or a non-negative integer, `minSettleDelay` within
 * a UInt32 (`scheme_upto_xrpl.md:144-150`, `:236-243`).
 */
function payable(o: PaymentRequirements): boolean {
  if (typeof o.amount !== "string" || !DROPS.test(o.amount)) return false;
  if (typeof o.payTo !== "string" || accountIdOf(o.payTo) === null) return false;
  if (!isTimeoutSeconds(o.maxTimeoutSeconds)) return false;
  const extra: unknown = o.extra;
  if (!isObject(extra) || extra["areFeesSponsored"] !== false) return false;
  return optionalCount(extra["minSettleDelay"], MAX_SETTLE_DELAY) && optionalCount(extra["validAfter"], Number.MAX_SAFE_INTEGER);
}

/**
 * The pairing's option filter, which `advertise`, `read`, `bound` and `reference` apply: an `upto` option on an XRPL
 * network is this pairing's. One whose `asset` is not `XRP` is `xrpl/currency-not-xrp`, a payment channel holding XRP
 * alone (`scheme_upto_xrpl.md:62-66`); one `payable` refuses is `x402/option-malformed`; any other option is not this
 * pairing's.
 */
const filter: OptionFilter = (o) => {
  if (o.scheme !== "upto" || !isXrplNetwork(o.network)) return undefined;
  if (o.asset !== "XRP") return refusal("xrpl/currency-not-xrp");
  return payable(o) ? true : refusal("x402/option-malformed");
};

/**
 * The option unchanged: nothing of the hash rides in it. An option that carries a `refused` member is
 * `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/** The challenge's `extensions.legalContext` set; the option carries no H and is left as it is. */
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

/**
 * The presented payment's option, held to the filter, and the channel and payer its payload names: the channel 64 hex
 * digits, in upper case, and the payer a classic address whose checksum holds, else `x402/payload-malformed`.
 */
function presentedOf(presented: unknown): { accepted: PaymentRequirements; channel: string; payer: string } | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = acceptedBy(presented["accepted"], filter);
  if (isRefusal(accepted)) return accepted;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const channel = payload["channelId"];
  const payer = payload["payer"];
  if (typeof channel !== "string" || !HASH256.test(channel)) return refusal("x402/payload-malformed");
  if (typeof payer !== "string" || accountIdOf(payer) === null) return refusal("x402/payload-malformed");
  return { accepted, channel: channel.toUpperCase(), payer };
}

/**
 * Nothing the payer signs carries H at coverage `none`, neither the channel's create nor its claim: once the payment
 * passes the filter and names a channel and a payer (`presentedOf`), whose refusal it gives, `x402/no-signed-place`.
 * The act changes nothing.
 */
async function bound(presented: unknown, _given?: { act: Act; h: AtrHash }): Promise<AtrHash | Refusal> {
  const p = presentedOf(presented);
  return isRefusal(p) ? p : refusal("x402/no-signed-place");
}

/**
 * The read keys of a payment: the network, the channel and the payer its payload names (`presentedOf`), and the payee
 * of `option`, the option the payment answers (`x402Payee`). The presented `accepted` must be `option`, compared as
 * canonical JSON; another is `x402/accepted-not-option`. The ledger index the channel's create must come after is the
 * caller's.
 */
async function reference(
  presented: unknown,
  option: PaymentRequirements,
  _given?: { act: Act; h: AtrHash },
): Promise<Omit<XrplChannelRef, "fromLedger"> | Refusal> {
  const p = presentedOf(presented);
  if (isRefusal(p)) return p;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const issued = unplaced(option);
  const accepted = unplaced(p.accepted);
  if (isRefusal(issued) || isRefusal(accepted)) return refusal("x402/option-malformed");
  const a = canonicalJson(accepted);
  if (isRefusal(a) || a !== canonicalJson(issued)) return refusal("x402/accepted-not-option");
  return { network: p.accepted.network as XrplNetwork, channel: p.channel, payer: p.payer, payee };
}

const pattern: LcpPattern = Object.freeze({
  pattern: "http-advisory",
  profile: ID,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/**
 * `x402/upto/xrpl`. The payer broadcasts (`broadcaster` answers `"payer"`): its client submits the channel's create
 * before it presents the payment, and the payment names that channel. `status` reads the create
 * (`xrplChannelStatus`). It has no `build`, the payer's own client opening the channel, and no `recover`, nothing on
 * the ledger carrying H.
 */
export const uptoXrpl = Object.freeze({
  id: ID,
  data: XRPL[ID],
  pattern,
  claims: false as boolean,
  unplaced,
  tie,
  advertise,
  read,
  bound,
  broadcaster: x402Broadcaster("payer"),
  reference,
  status: xrplChannelStatus,
}) satisfies Entry<
  typeof ID,
  UptoXrplPaymentPayload,
  Omit<XrplChannelRef, "fromLedger">,
  XrplReader,
  X402Forms & {
    choice: never;
    unsigned: never;
    landed: Pick<XrplChannelRef, "fromLedger">;
    network: never;
    query: XrplQuery<XrplChannelRef>;
    answer: XrplStatus;
  }
>;
