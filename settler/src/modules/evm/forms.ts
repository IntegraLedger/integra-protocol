/**
 * The EVM forms x402's published classes settle, as lcp's codecs read them: which pairing a payment is, the pure checks
 * of its profile, the instrument the record keys it by, how long a final row is kept, and lcp's read of it. Nothing here
 * reads the chain or the clock but the read itself.
 */
import { canonicalJson, digestJson, isRefusal, pairingOf, type PairingId, type Refusal } from "@integraledger/lcp";
import { PERMIT2, type EvmReader } from "@integraledger/lcp/evm";
import {
  authCaptureEip3009,
  authCapturePermit2,
  exactEip3009,
  exactErc7710,
  exactErc7710Salt,
  exactPermit2,
  pairingOfPayment,
  uptoPermit2,
  type PaymentRequirements as LcpRequirements,
} from "@integraledger/lcp/x402";
import { batchEvm } from "@integraledger/lcp/x402-batch-settlement";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { outcomeOf, type ChainRead, type Instrument, type Instrumented, type Keep, type ReadAnswer, type Refused, type X402Payment } from "../../module.js";

/** The forms of one scheme on EVM, by the lcp pairing ids the scheme's class submits. */
export type EvmScheme = "exact" | "upto" | "auth-capture" | "batch-settlement";

/** The pairings each scheme's class submits on an `eip155` network. */
export const PAIRINGS = {
  exact: [exactEip3009.id, exactPermit2.id],
  upto: [uptoPermit2.id],
  "auth-capture": [authCaptureEip3009.id, authCapturePermit2.id],
  "batch-settlement": [batchEvm.id],
} as const satisfies Record<EvmScheme, readonly PairingId[]>;

/** Both ERC-7710 levels, which share the `erc7710` option of `exact`. */
export const ERC7710_PAIRINGS = [exactErc7710.id, exactErc7710Salt.id] as const;

type EvmPairing = (typeof PAIRINGS)[EvmScheme][number] | (typeof ERC7710_PAIRINGS)[number];

/** A presented payment's read keys, as the pairing's `reference` gives them: an object lcp checks again at `status`. */
type Ref = Record<string, unknown>;
type Status = (ref: never, reader: EvmReader, query: { act: "payment"; finality: "finalized"; search?: unknown }) => Promise<ReadAnswer>;
type Reference = (presented: unknown, option: LcpRequirements) => Promise<object | Refusal>;

/** Each pairing's lcp members the module calls. */
const CODEC: Record<EvmPairing, { readonly reference: Reference; readonly status: Status; readonly nonce: Instrumented["nonce"] }> = {
  [exactEip3009.id]: codec(exactEip3009),
  [exactPermit2.id]: codec(exactPermit2),
  [uptoPermit2.id]: codec(uptoPermit2),
  [authCaptureEip3009.id]: codec(authCaptureEip3009),
  [authCapturePermit2.id]: codec(authCapturePermit2),
  [batchEvm.id]: codec(batchEvm),
  [exactErc7710.id]: codec(exactErc7710),
  [exactErc7710Salt.id]: codec(exactErc7710Salt),
};

function codec(b: { reference: unknown; status: unknown; data: { nonce: Instrumented["nonce"] } }) {
  return { reference: b.reference as Reference, status: b.status as Status, nonce: b.data.nonce };
}

/** What the pure checks found: the payment's pairing and the read keys lcp gives it, where its form has them. */
export interface Admitted {
  readonly pairing: EvmPairing;
  readonly ref?: Ref;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The options of `exact` on EVM that no published EVM class may settle: one that pays several payees (a non-empty
 * `extra.splits`, which `exact` does not carry), and Circle's batched option, which signs under the Gateway Wallet's
 * EIP-712 domain and not the token's (`extra.name` `GatewayWalletBatched`, or an `extra.verifyingContract` other than
 * the asset). Each is refused before x402's class is asked, which reads none of these members.
 */
export function exactOptionRefused(requirements: { readonly asset: string; readonly extra?: Record<string, unknown> }): boolean {
  const extra = requirements.extra;
  if (extra === undefined) return false;
  const splits = extra["splits"];
  if (splits !== undefined && !(Array.isArray(splits) && splits.length === 0)) return true;
  if (extra["name"] === "GatewayWalletBatched") return true;
  const verifying = extra["verifyingContract"];
  return (
    verifying !== undefined &&
    !(typeof verifying === "string" && typeof requirements.asset === "string" && verifying.toLowerCase() === requirements.asset.toLowerCase())
  );
}

const DECIMAL = /^[0-9]+$/;

/**
 * The option an `upto` payment is held to. x402's `upto` settles the amount its requirements state, at most the maximum
 * the payment accepted: requirements that are the option the payment accepted in every member but an `amount` at or
 * below the accepted one, as RFC 8785 forms compare them, are held as that option. Any other requirements are the
 * option as given.
 */
function uptoOption(p: X402Payment): PaymentRequirements {
  const { requirements } = p;
  const accepted = p.payload.accepted as PaymentRequirements | undefined;
  if (!isObject(accepted)) return requirements;
  const charge: unknown = requirements.amount;
  const max: unknown = accepted.amount;
  if (typeof charge !== "string" || typeof max !== "string" || !DECIMAL.test(charge) || !DECIMAL.test(max)) return requirements;
  if (BigInt(charge) > BigInt(max)) return requirements;
  const asAccepted = canonicalJson({ ...requirements, amount: max });
  return typeof asAccepted === "string" && asAccepted === canonicalJson(accepted) ? accepted : requirements;
}

/**
 * The profile's pure checks of a payment answering an option of `scheme`: the option is one of the pairings `pairings`
 * names, as lcp's option filter reads it alone (`invalid_payment_requirements` otherwise), and the payment is that
 * pairing's as lcp's `reference` reads it against the option (`invalid_payload` otherwise), an `upto` option being
 * the one `uptoOption` holds it to. A batch settlement's payment that is no opening has no reference: lcp's channel
 * read holds its configuration to its voucher's channel, and the claim, settle and refund calls a resource server
 * makes of the channel, which lcp does not decode, are x402's class's to check.
 */
export async function admit(scheme: EvmScheme | "erc7710", p: X402Payment, pairings: readonly PairingId[]): Promise<Admitted | Refused> {
  const { payload, requirements } = p;
  if (requirements.scheme !== (scheme === "erc7710" ? "exact" : scheme)) return { refused: "invalid_payment_requirements" };
  if (requirements.scheme === "exact" && exactOptionRefused(requirements)) return { refused: "invalid_payment_requirements" };
  const option = pairingOf(requirements as LcpRequirements);
  if (option === undefined) return { refused: "invalid_payment_requirements" };
  const level = option === exactErc7710.id ? pairingOfPayment(payload as never) : option;
  if (level === undefined || !(pairings as readonly string[]).includes(level) || !(level in CODEC)) {
    return { refused: "invalid_payment_requirements" };
  }
  const pairing = level as EvmPairing;
  if (pairing === batchEvm.id) {
    const kind = isObject(payload.payload) ? payload.payload["type"] : undefined;
    if (kind === "claim" || kind === "settle") return { pairing };
    const k = batchEvm.channel.kind(payload as never);
    if (isRefusal(k)) return { refused: "invalid_payload" };
    if (k !== "open") {
      const channel = await batchEvm.channel.ref(payload as never);
      return isRefusal(channel) ? { refused: "invalid_payload" } : { pairing };
    }
  }
  const held = requirements.scheme === "upto" ? uptoOption(p) : requirements;
  const ref = await CODEC[pairing].reference(payload, held as LcpRequirements);
  if (isRefusal(ref)) return { refused: "invalid_payload" };
  return { pairing, ref: ref as Ref };
}

function lower(v: unknown): string {
  return String(v).toLowerCase();
}

/** A Permit2 nonce in decimal, one spelling for every pairing that signs one, so that one nonce of one owner is one row. */
function permit2Nonce(v: unknown): string {
  return BigInt(String(v)).toString(10);
}

/** Unix seconds, as a decimal the reference gives, in Unix milliseconds. */
function lapse(seconds: unknown): Keep {
  return { until: "lapse", at: Number(BigInt(String(seconds))) * 1000 };
}

/**
 * The record's key and keep for an admitted payment. EIP-3009: the network, the token, the authorization's `from` and
 * its nonce, kept to `validBefore`; the auth-capture escrow's ERC-3009 collector signs its nonce in the token's one
 * nonce space, so it is keyed alike. Permit2: the network, the owner and the permit's nonce in Permit2's one bitmap per
 * owner, kept to the deadline. Neither is the nonce alone, and for an agreement the nonce signed is the agreement's own
 * value, so one payer's agreement and payment under one H are two rows. A batch settlement's call and an ERC-7710
 * redemption hold no single-use value: each is keyed by a digest, for the settler's life. A batch call's is the digest
 * of its signed payload. A redemption's is the digest of the delegation it redeems as signed, whatever its spelling: the
 * manager and the delegator in lowercase, and the leaf delegation's EIP-712 hash where the context decodes as the
 * reference manager's encoding (the hash commits to its caveats, its salt and, through its authority, the chain above
 * it; not to the signatures or the encoding's padding), else the context's bytes in lowercase hex. So one delegation is
 * one row, presented in any letter case or re-encoded.
 */
export async function instrumentOf(network: Network, p: X402Payment, a: Admitted): Promise<Instrumented | Refused> {
  const nonce = CODEC[a.pairing].nonce;
  const ref = a.ref;
  const digestOf = async (signed: unknown): Promise<Instrumented | Refused> => {
    const d = await digestJson(signed as never);
    if (isRefusal(d)) return { refused: "invalid_payload" };
    return { pairing: a.pairing, instrument: { by: "digest", network, digest: d }, nonce, keep: { until: "settler" } };
  };
  const digest = () => digestOf(p.payload.payload);
  if (a.pairing === exactErc7710.id || a.pairing === exactErc7710Salt.id) {
    const r = isObject(p.payload.payload) ? p.payload.payload : {};
    const leaf = isObject(ref?.["presented"]) ? ref["presented"]["delegation"] : undefined;
    return digestOf({
      delegationManager: lower(r["delegationManager"]),
      delegator: lower(r["delegator"]),
      ...(typeof leaf === "string" ? { delegation: lower(leaf) } : { permissionContext: lower(r["permissionContext"]) }),
    });
  }
  if (ref === undefined) return digest();
  const presented = isObject(ref["presented"]) ? ref["presented"] : {};
  let instrument: Instrument;
  let keep: Keep;
  switch (a.pairing) {
    case exactEip3009.id:
      instrument = { by: "single-use", network, signer: lower(ref["payer"]), value: lower(presented["nonce"]), scope: lower(ref["asset"]) };
      keep = lapse(ref["validBefore"]);
      break;
    case exactPermit2.id:
    case uptoPermit2.id:
      instrument = { by: "single-use", network, signer: lower(ref["payer"]), value: permit2Nonce(presented["nonce"]), scope: PERMIT2.toLowerCase() };
      keep = lapse(ref["deadline"]);
      break;
    case authCaptureEip3009.id:
      instrument = { by: "single-use", network, signer: lower(ref["payer"]), value: lower(ref["signatureNonce"]), scope: lower(ref["asset"]) };
      keep = lapse(ref["expiry"]);
      break;
    case authCapturePermit2.id:
      instrument = { by: "single-use", network, signer: lower(ref["payer"]), value: permit2Nonce(ref["signatureNonce"]), scope: PERMIT2.toLowerCase() };
      keep = lapse(ref["expiry"]);
      break;
    default:
      return digest();
  }
  return { pairing: a.pairing, instrument, nonce, keep };
}

/**
 * lcp's read of an admitted payment, by the pairing's search, at the final mark `finalized`, as the act `payment`: the
 * value an agreement signs stands in H's place in its reference, so the search for it is the search for that value.
 * `at.search` resumes an earlier search. `at.transaction` is the transaction the settler's record holds for the
 * payment, which the reference names as the transaction a settler names: read beside the search, and on a level that
 * signs no H (`x402/exact/eip155/erc7710`) the only way the read finds the payment. A batch settlement's payment that
 * is no opening has no reference and no read of its own: `pending`, `search-incomplete`, live.
 */
export async function readOf(
  reader: EvmReader,
  a: Admitted,
  at: { readonly search?: unknown; readonly transaction?: string },
): Promise<ChainRead> {
  if (a.ref === undefined) return outcomeOf({ state: "pending", reason: "search-incomplete", foreign: [] });
  const ref = at.transaction === undefined ? a.ref : { ...a.ref, transaction: at.transaction.toLowerCase() };
  const query =
    at.search === undefined
      ? { act: "payment" as const, finality: "finalized" as const }
      : { act: "payment" as const, finality: "finalized" as const, search: at.search };
  return outcomeOf(await CODEC[a.pairing].status(ref as never, reader, query));
}
