import { toLegalContext, type AtrHash, type Json } from "./core.js";
import { isRefusal, type Refusal } from "./refusal.js";

export {
  assemble,
  canonicalJson,
  digestJson,
  fromLcpString,
  fromLegalContext,
  fromRawBytes,
  hash,
  hashEquals,
  isHttpsLink,
  isOtherSchemeLink,
  newAtrId,
  parseJson,
  toLcpString,
  toLegalContext,
  toRawBytes,
} from "./core.js";
export type { AtrHash, CoreRefusal, Json } from "./core.js";
export { isRefusal } from "./refusal.js";
export type { Refusal } from "./refusal.js";
export type { LcpPattern } from "./x402.js";
export { pairingsOfPlaced } from "./mpp.js";

import { paymentRequest } from "./ack.js";
import { delegated, type Presented as AcpPresented, undelegated } from "./acp.js";
import { checkoutMandate, type Presented as Ap2Presented } from "./ap2.js";
import { exactAptos } from "./aptos.js";
import { type AvmPaymentPayload, exactAvm } from "./avm.js";
import { sellerReference, type TapPresented, viAutonomous, type ViAutonomous, viImmediate, type ViImmediate, visaTap } from "./card.js";
import { exactCardano } from "./cardano.js";
import { exactCasper } from "./casper.js";
import { exactCcd } from "./ccd.js";
import { exactHedera, exactHederaExecutor, type ExecutorPaymentPayload } from "./hedera.js";
import type { AptosPaymentPayload } from "./internal/aptos.js";
import type { CardanoPaymentPayload } from "./internal/cardano.js";
import type { CasperPaymentPayload } from "./internal/casper.js";
import type { CcdPaymentPayload } from "./internal/ccd.js";
import type { HederaPaymentPayload } from "./internal/hedera.js";
import type { NearPayment } from "./internal/near.js";
import type { PolkadotPaymentPayload } from "./internal/polkadot.js";
import type { StarknetPayment } from "./internal/starknet.js";
import type { SuiPaymentPayload } from "./internal/sui.js";
import type { TronPayment } from "./internal/tron.js";
import type { BatchPaymentPayload, CloudflarePaymentPayload } from "./internal/x402-batch-settlement.js";
import type { XrplPaymentPayload } from "./internal/xrpl.js";
import { exactLnbtc, exactLnbtcNamed, lnbtcPairingOf, type LnPaymentPayload } from "./lightning.js";
import { MPP_BINDINGS, type MppCredential } from "./mpp.js";
import { exactNear } from "./near.js";
import { exactPolkadotRemark } from "./polkadot.js";
import { exactStarknet } from "./starknet.js";
import { exactSui } from "./sui.js";
import { exactTronMemo } from "./tron.js";
import { exactTvm, type TvmPayment } from "./tvm.js";
import { ap2Mandate, bookingAp2Mandate, bookingUnsigned, unsigned } from "./ucp.js";
import { authCaptureEip3009, authCapturePermit2, exactEip3009, exactErc7710, exactErc7710Salt, exactPermit2, LEGAL_CONTEXT, LEGAL_CONTEXT_SCHEMA, type PaymentPayload, type PaymentRequired, type PaymentRequirements, uptoPermit2 } from "./x402.js";
import { batchCloudflare, batchEvm, batchSvm } from "./x402-batch-settlement.js";
import { exactSvm, type SvmPaymentPayload } from "./x402-exact-solana.js";
import { exactStellar, type StellarPaymentPayload } from "./x402-exact-stellar.js";
import { exactXrpl } from "./x402-exact-xrpl.js";
import { type UptoSvmPaymentPayload, uptoSvm } from "./x402-upto-solana.js";

/** An x402 pairing of scheme and rail. */
export type X402Binding =
  | typeof exactEip3009
  | typeof authCaptureEip3009
  | typeof authCapturePermit2
  | typeof batchCloudflare
  | typeof batchEvm
  | typeof batchSvm
  | typeof exactAvm
  | typeof exactAptos
  | typeof exactCardano
  | typeof exactCasper
  | typeof exactCcd
  | typeof exactErc7710
  | typeof exactErc7710Salt
  | typeof exactPermit2
  | typeof exactHedera
  | typeof exactHederaExecutor
  | typeof exactLnbtc
  | typeof exactLnbtcNamed
  | typeof exactNear
  | typeof exactPolkadotRemark
  | typeof exactSvm
  | typeof exactStarknet
  | typeof exactStellar
  | typeof exactSui
  | typeof exactTronMemo
  | typeof exactTvm
  | typeof exactXrpl
  | typeof uptoPermit2
  | typeof uptoSvm;
/** An MPP pairing of intent and method. */
export type MppBinding = (typeof MPP_BINDINGS)[number];
/** The optional member of a push-mode pairing: the transaction its credential names, or undefined. */
export interface PushMode {
  landedTx?(presented: unknown): string | undefined;
}
/**
 * The optional member of a pairing whose carrier the seller writes after H: `advertise`'s checks and placement, without
 * the checks on that carrier.
 */
export interface CarrierAfterH {
  advertiseBeforeCarrier?(doc: never, h: AtrHash, link: string, offer: never, agreementUrl?: string): unknown;
}
/**
 * The optional member of a pull pairing whose payer signs an authorization that the chain executes later: the account
 * whose signature authorises the pull, from the presented payment, as lowercase hex. With the pairing's `reference`,
 * whose `authorization` names the nonce, the deadline and the token, it is what a settlement reader needs to read the
 * authorization's use before any transaction is named.
 */
export interface Authorizer {
  authorizer?(presented: unknown): Promise<string | Refusal>;
}
/** A pairing of protocol, scheme and rail. */
export type Binding = (
  | X402Binding
  | MppBinding
  | typeof paymentRequest
  | typeof delegated
  | typeof undelegated
  | typeof checkoutMandate
  | typeof viAutonomous
  | typeof viImmediate
  | typeof sellerReference
  | typeof visaTap
  | typeof bookingAp2Mandate
  | typeof bookingUnsigned
  | typeof ap2Mandate
  | typeof unsigned
) &
  PushMode &
  CarrierAfterH &
  Authorizer;
export type PairingId = Binding["id"];
type SurfaceOf<I> = I extends `${infer S}/${string}` ? S : never;
/** The surfaces: each pairing id's first "/" segment. */
type Surface = SurfaceOf<PairingId>;
/**
 * What the buyer presents as payment, per surface: the union of the payment types of every pairing on it. Every
 * pairing's `bound` and `reference` take `unknown` and check what they are given. `Presented` indexes it by every
 * surface, so a pairing on a surface it does not name does not compile.
 */
interface PresentedOn {
  /** ACK defines no payer signature; its `bound` refuses whatever is presented. */
  ack: Json;
  acp: AcpPresented;
  ap2: Ap2Presented;
  card: TapPresented | ViAutonomous | ViImmediate;
  mpp: MppCredential;
  ucp: Ap2Presented;
  x402:
    | PaymentPayload
    | AptosPaymentPayload
    | AvmPaymentPayload
    | BatchPaymentPayload
    | CardanoPaymentPayload
    | CasperPaymentPayload
    | CcdPaymentPayload
    | CloudflarePaymentPayload
    | ExecutorPaymentPayload
    | HederaPaymentPayload
    | LnPaymentPayload
    | NearPayment
    | PolkadotPaymentPayload
    | StarknetPayment
    | StellarPaymentPayload
    | SuiPaymentPayload
    | SvmPaymentPayload
    | TronPayment
    | TvmPayment
    | UptoSvmPaymentPayload
    | XrplPaymentPayload;
}
/** What the buyer presents as payment. */
export type Presented = PresentedOn[Surface];
/** The pairing ids of one surface. */
type PairingOn<S extends Surface> = Extract<PairingId, `${S}/${string}`>;

/** Every pairing this package implements. */
export const BINDINGS: readonly Binding[] = Object.freeze([
  exactEip3009,
  paymentRequest,
  delegated,
  undelegated,
  checkoutMandate,
  viAutonomous,
  viImmediate,
  sellerReference,
  visaTap,
  ...MPP_BINDINGS,
  bookingAp2Mandate,
  bookingUnsigned,
  ap2Mandate,
  unsigned,
  authCaptureEip3009,
  authCapturePermit2,
  batchCloudflare,
  batchEvm,
  batchSvm,
  exactAvm,
  exactAptos,
  exactCardano,
  exactCasper,
  exactCcd,
  exactErc7710,
  exactErc7710Salt,
  exactPermit2,
  exactHedera,
  exactHederaExecutor,
  exactLnbtc,
  exactLnbtcNamed,
  exactNear,
  exactPolkadotRemark,
  exactSvm,
  exactStarknet,
  exactStellar,
  exactSui,
  exactTronMemo,
  exactTvm,
  exactXrpl,
  uptoPermit2,
  uptoSvm,
]);

const PROBE_CONTEXT = { info: toLegalContext(`0x${"00".repeat(32)}`, "https://pairing.invalid/").legalContext, schema: LEGAL_CONTEXT_SCHEMA };

/**
 * The x402 pairing that serves an option: a Lightning option's by `lnbtcPairingOf`, which names `x402/exact/lnbtc` for
 * an option whose invoice is not yet written; else the first x402 pairing in `BINDINGS` whose `read` offers it, on a
 * document holding that option alone. Undefined when none does.
 */
export function pairingOf(option: PaymentRequirements): PairingOn<"x402"> | undefined {
  const ln = lnbtcPairingOf(option);
  if (ln !== undefined) return ln;
  const doc = { x402Version: 2, resource: { url: "https://pairing.invalid/" }, accepts: [option], extensions: { [LEGAL_CONTEXT]: PROBE_CONTEXT } };
  for (const b of BINDINGS) {
    if (!b.id.startsWith("x402/")) continue;
    if (!isRefusal((b as X402Binding).read(doc as PaymentRequired))) return b.id as PairingOn<"x402">;
  }
  return undefined;
}
