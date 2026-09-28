/**
 * The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the
 * payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement.
 */
import { toLcpString, type AtrHash } from "./core.js";
import {
  buildSvmMessage,
  decodeSvmTx,
  isKey,
  isSolanaNetwork,
  svmCarrier,
  svmRecover,
  svmReference,
  staticNonce,
  svmSigning,
  svmStatus,
  toBase64,
  wireOf,
  TOKEN,
  TOKEN_2022,
  type SvmRef,
  type SvmTx,
} from "./internal/svm.js";
import { isObject } from "./fields.js";
import { refusal, type Refusal } from "./refusal.js";
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

const ID = "x402/exact/solana" as const;
const MAX_MEMO = 256;
const U64_LIMIT = 1n << 64n;
const DECIMAL = /^[0-9]{1,20}$/;

/** A payment on this pairing: the base64 partially signed versioned transaction. */
export interface SvmPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string };
  extensions?: PaymentRequired["extensions"];
}

/** What the payer signs, and how its signature completes the payment. */
export interface SvmUnsigned<P = SvmPaymentPayload> {
  request: { kind: "solana-message"; message: Uint8Array };
  /** A 64-byte Ed25519 signature by the payer. */
  complete(signature: Uint8Array): P | Refusal;
}

export interface SvmChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  payer: string;
  decimals: number;
  tokenProgram: string;
  recentBlockhash: string;
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** This pairing's id for an option it can pay, or undefined. */
export function pairingOf(option: PaymentRequirements): typeof ID | undefined {
  if (!isObject(option) || option.scheme !== "exact") return undefined;
  if (!isSolanaNetwork(option.network) || !isKey(option.asset) || !isKey(option.payTo)) return undefined;
  const extra: unknown = option.extra;
  if (!isObject(extra) || !isKey(extra["feePayer"])) return undefined;
  const memo = extra["memo"];
  if (memo !== undefined && (typeof memo !== "string" || utf8Length(memo) > MAX_MEMO)) return undefined;
  return ID;
}

const isThis = (o: PaymentRequirements): boolean => pairingOf(o) !== undefined;

/** True when the amount is a u64 in decimal. */
function payable(o: PaymentRequirements): boolean {
  return typeof o.amount === "string" && DECIMAL.test(o.amount) && BigInt(o.amount) < U64_LIMIT;
}

/** The option without `extra.memo`: the option as the seller issued it, before the carrier was placed. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return withoutExtra(option, "memo");
}

/** The challenge's `extensions.legalContext` set, and the chosen option's `extra.memo` set to the hash's LCP string. */
function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = advertiseFor(filterOf(isThis, payable))(doc, h, link, offer, agreementUrl);
  if ("refused" in placed) return placed;
  const memo = toLcpString(h);
  const current = offer.extra?.["memo"];
  if (current !== undefined && current !== memo) return refusal("svm/carrier-occupied");
  return withOption(placed, offeredAt(placed.accepts, offer), withExtra(offer, "memo", memo));
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(filterOf(isThis))(doc);
}

/** The v0 message the payer signs for the chosen option, whose one memo is the option's `extra.memo`. */
async function build(c: SvmChoice, h: AtrHash): Promise<SvmUnsigned | Refusal> {
  const ok = chosen(c.required, c.accepted, filterOf(isThis));
  if (ok !== true) return ok;
  const { accepted, required } = c;
  if (!payable(accepted)) return refusal("x402/option-malformed");
  const memo = accepted.extra!["memo"];
  if (memo !== toLcpString(h)) return refusal("svm/carrier-mismatch");
  if (c.tokenProgram !== TOKEN && c.tokenProgram !== TOKEN_2022) return refusal("svm/input-malformed");
  const message = await buildSvmMessage({
    feePayer: accepted.extra!["feePayer"] as string,
    payer: c.payer,
    mint: accepted.asset,
    tokenProgram: c.tokenProgram,
    decimals: c.decimals,
    payTo: accepted.payTo,
    amount: BigInt(accepted.amount),
    recentBlockhash: c.recentBlockhash,
    memo,
    computeUnitLimit: c.computeUnitLimit ?? 40_000,
    computeUnitPrice: c.computeUnitPrice ?? 1n,
  });
  if ("refused" in message) return message;
  const signing = svmSigning(message, c.payer);
  return {
    request: signing.request,
    complete(signature: Uint8Array): SvmPaymentPayload | Refusal {
      const wire = signing.wire(signature);
      if ("refused" in wire) return wire;
      return paymentWith(required, accepted, { transaction: toBase64(wire) });
    },
  };
}

/** The payment's option and decoded transaction, or the refusal that names what is wrong. */
function presentedTx(presented: unknown) {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isObject(accepted) || !isThis(accepted as PaymentRequirements)) return refusal("x402/option-not-this-pairing");
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const wire = wireOf(payload["transaction"]);
  if ("refused" in wire) return wire;
  const tx = decodeSvmTx(wire);
  if ("refused" in tx) return tx;
  return { accepted: accepted as PaymentRequirements, tx };
}

/**
 * The hash in the one memo of the transaction the payer signed, which must equal the option's `extra.memo`. Neither
 * signature is verified here; the chain verifies every signer's signature over the message it executes.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = presentedTx(presented);
  return "refused" in p ? p : boundOf(p.accepted, p.tx);
}

function boundOf(accepted: PaymentRequirements, tx: SvmTx): AtrHash | Refusal {
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const carrier = svmCarrier(tx);
  if ("refused" in carrier) return carrier;
  if (carrier.memo !== accepted.extra?.["memo"]) return refusal("svm/carrier-mismatch");
  return carrier.h;
}

/** The read keys for finding this payment later: digest, fee payer, blockhash, and the transaction id once signed. */
async function reference(presented: unknown): Promise<Omit<SvmRef, "fromSlot"> | Refusal> {
  const p = presentedTx(presented);
  if ("refused" in p) return p;
  const h = boundOf(p.accepted, p.tx);
  if (typeof h !== "string") return h;
  if (!isSolanaNetwork(p.accepted.network)) return refusal("svm/network-malformed");
  return svmReference(p.accepted.network, p.tx);
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
    "The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, " +
    "and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's " +
    "instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.",
});

export const exactSvm = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: "extra.memo" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: svmStatus,
  recover: svmRecover,
});
