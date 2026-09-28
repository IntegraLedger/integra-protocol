/**
 * The `x402/upto/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the
 * payer as the one Memo instruction of the transaction that opens a one-request payment channel escrowing the signed
 * maximum; read back from that transaction, and settlement read from the opening.
 */
import { toLcpString, type AtrHash } from "./core.js";
import {
  buildChannelMessage,
  channelInstruction,
  channelPda,
  decodeSvmTx,
  isKey,
  isSolanaNetwork,
  staticNonce,
  svmCarrier,
  svmChannelStatus,
  svmRecover,
  svmReference,
  svmSigning,
  toBase64,
  wireOf,
  TOKEN,
  TOKEN_2022,
  type SvmRef,
} from "./internal/svm.js";
import { isObject } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import type { SvmUnsigned } from "./x402-exact-solana.js";
import {
  advertiseFor,
  chosen,
  filterOf,
  offeredAt,
  paymentWith,
  readFor,
  tie,
  withExtra,
  withOption,
  withoutExtra,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

const ID = "x402/upto/solana" as const;
const MAX_MEMO = 256;
const U64_LIMIT = 1n << 64n;
const U64_DECIMAL = /^[0-9]{1,20}$/;

export interface UptoSvmPayload {
  from: string;
  maxAmount: string;
  expiresAt: number;
  validAfter: number;
  nonce: string;
  openSlot: number;
  channelId: string;
  deposit: string;
  authorizedSigner: string;
  /** Base64 of the partially signed `open` transaction. */
  openTransaction: string;
}

export interface UptoSvmPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: UptoSvmPayload;
  extensions?: PaymentRequired["extensions"];
}

export interface UptoSvmChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  payer: string;
  nonce: bigint;
  openSlot: bigint;
  now: number;
  tokenProgram: string;
  recentBlockhash: string;
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
}

/** This pairing's id for an option it can pay, or undefined. */
export function pairingOf(option: PaymentRequirements): typeof ID | undefined {
  if (!isObject(option) || option.scheme !== "upto" || !isSolanaNetwork(option.network)) return undefined;
  if (!isKey(option.asset) || !isKey(option.payTo)) return undefined;
  const extra: unknown = option.extra;
  if (!isObject(extra) || !isKey(extra["feePayer"]) || !isKey(extra["receiverAuthorizer"])) return undefined;
  const delay = extra["withdrawDelay"];
  if (!Number.isSafeInteger(delay) || (delay as number) <= 0) return undefined;
  if (extra["tokenProgram"] !== TOKEN && extra["tokenProgram"] !== TOKEN_2022) return undefined;
  const memo = extra["memo"];
  if (memo !== undefined && (typeof memo !== "string" || new TextEncoder().encode(memo).length > MAX_MEMO)) return undefined;
  const flow = extra["paymentFlow"];
  if (flow !== undefined && flow !== "escrow") return undefined;
  return ID;
}

const isThis = (o: PaymentRequirements): boolean => pairingOf(o) !== undefined;

/** True when the amount is a u64 in decimal and the timeout a positive safe integer. */
function payable(o: PaymentRequirements): boolean {
  return (
    typeof o.amount === "string" &&
    U64_DECIMAL.test(o.amount) &&
    BigInt(o.amount) < U64_LIMIT &&
    Number.isSafeInteger(o.maxTimeoutSeconds) &&
    o.maxTimeoutSeconds > 0
  );
}

function unplaced(option: PaymentRequirements): PaymentRequirements {
  return withoutExtra(option, "memo");
}

/**
 * The challenge's `extensions.legalContext` set and the option's `extra.memo` set to the hash's LCP string. The option
 * must name its flow, `escrow`.
 */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(filterOf(isThis, payable))(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  if (offer.extra?.["paymentFlow"] !== "escrow") return refusal("x402/flow-missing");
  const memo = toLcpString(h);
  const current = offer.extra["memo"];
  if (current !== undefined && current !== memo) return refusal("svm/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), withExtra(offer, "memo", memo));
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filterOf(isThis))(doc);
}

/** The `open` message the payer signs: the channel escrows the option's amount, and its one memo is `extra.memo`. */
async function build(c: UptoSvmChoice, h: AtrHash): Promise<SvmUnsigned<UptoSvmPaymentPayload> | Refusal> {
  const ok = chosen(c.required, c.accepted, filterOf(isThis));
  if (ok !== true) return ok;
  const { accepted, required } = c;
  if (!payable(accepted)) return refusal("x402/option-malformed");
  const extra = accepted.extra!;
  const memo = extra["memo"];
  if (memo !== toLcpString(h)) return refusal("svm/carrier-mismatch");
  if (c.tokenProgram !== extra["tokenProgram"] || !Number.isSafeInteger(c.now) || c.now < 0) {
    return refusal("svm/input-malformed");
  }
  const feePayer = extra["feePayer"] as string;
  const signer = extra["receiverAuthorizer"] as string;
  const channel = channelPda({ payer: c.payer, payee: feePayer, mint: accepted.asset, signer, salt: c.nonce, openSlot: c.openSlot });
  if (typeof channel !== "string") return channel;
  const amount = BigInt(accepted.amount);
  const message = await buildChannelMessage({
    feePayer,
    payer: c.payer,
    mint: accepted.asset,
    tokenProgram: c.tokenProgram,
    recentBlockhash: c.recentBlockhash,
    memo,
    computeUnitLimit: c.computeUnitLimit ?? 200_000,
    computeUnitPrice: c.computeUnitPrice ?? 1n,
    instruction: {
      kind: "open",
      channel,
      signer,
      salt: c.nonce,
      deposit: amount,
      gracePeriod: extra["withdrawDelay"] as number,
      openSlot: c.openSlot,
      recipient: accepted.payTo,
    },
  });
  if (isRefusal(message)) return message;
  const validAfter = extra["validAfter"];
  const signing = svmSigning(message, c.payer);
  return {
    request: signing.request,
    complete(signature: Uint8Array): UptoSvmPaymentPayload | Refusal {
      const wire = signing.wire(signature);
      if (isRefusal(wire)) return wire;
      return paymentWith(required, accepted, {
        from: c.payer,
        maxAmount: accepted.amount,
        expiresAt: c.now + accepted.maxTimeoutSeconds,
        validAfter: Number.isSafeInteger(validAfter) ? (validAfter as number) : c.now,
        nonce: c.nonce.toString(),
        openSlot: Number(c.openSlot),
        channelId: channel,
        deposit: accepted.amount,
        authorizedSigner: signer,
        openTransaction: toBase64(wire),
      });
    },
  };
}

/** The payment's option and decoded opening, with its memo checked, or the refusal that names what is wrong. */
function openingOf(presented: unknown) {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"] as PaymentRequirements;
  if (!isObject(accepted) || !isThis(accepted)) return refusal("x402/option-not-this-pairing");
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const wire = wireOf(payload["openTransaction"]);
  if (isRefusal(wire)) return wire;
  const tx = decodeSvmTx(wire);
  if (isRefusal(tx)) return tx;
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const carrier = svmCarrier(tx);
  if (isRefusal(carrier)) return carrier;
  if (carrier.memo !== accepted.extra?.["memo"]) return refusal("svm/carrier-mismatch");
  const ix = channelInstruction(tx);
  if (isRefusal(ix) || ix.kind !== "open") return refusal("x402/not-an-opening");
  return { accepted, tx, h: carrier.h };
}

/**
 * The hash in the one memo of the `open` transaction the payer signed, which must equal the option's `extra.memo`. No
 * signature is verified here; the chain verifies the payer's.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = openingOf(presented);
  return isRefusal(p) ? p : p.h;
}

/** The opening's read keys: digest, fee payer, blockhash, and the transaction id once the fee payer has signed. */
async function reference(presented: unknown): Promise<Omit<SvmRef, "fromSlot"> | Refusal> {
  const p = openingOf(presented);
  if (isRefusal(p)) return p;
  return svmReference(p.accepted.network as SvmRef["network"], p.tx);
}

const pattern: LcpPattern = Object.freeze({
  pattern: "native-field",
  canonical: true,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and " +
    "which opened a one-request payment channel escrowing the signed maximum; it executed without error. The memo is " +
    "in the transaction's instruction data on chain. The amount charged from the escrow, which may be zero, is the " +
    "seller's metering, settled by the facilitator in a later transaction that does not carry the hash, and the rest " +
    "returns to the payer. This does not show that amount, recipient, mint or timing match the ATR's content.",
});

export const uptoSvm = Object.freeze({
  id: ID,
  pattern,
  claims: true as const,
  carrier: "extra.memo" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: svmChannelStatus,
  recover: svmRecover,
});
