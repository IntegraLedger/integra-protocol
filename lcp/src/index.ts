/**
 * The package root of `@integraledger/lcp`: the core functions of `@integraledger/lcp/core`, the registry of every
 * pairing (`BINDINGS`, `pairingOf`) and its types, and the return after an agreement.
 *
 * The core functions assemble an ATR and hash its exact bytes, compare hashes, give the hash's string and structured
 * forms, and hold the https-link rule, `isRefusal` and `readToRepeat`. The return after an agreement is the
 * `Legal-Context` header, its check, and the charge options an agreement option serves. The root also exports MPP's
 * challenge id and its hash (`challengeId`, `challengeH`, `challengeHash`); the package's size bounds; and `FETCHED`,
 * the key under which a pairing's `fetchPresented` writes the seller's read onto a credential.
 *
 * @module
 */
import { toLegalContext, type AtrHash, type Json } from "./core.js";
import { isRefusal, type Refusal } from "./refusal.js";

export {
  agreementValue,
  assemble,
  base64Bytes,
  base64UrlBytes,
  canonicalJson,
  digestJson,
  fromBase64,
  fromBase64Url,
  fromLcpString,
  fromLegalContext,
  fromRawBytes,
  hash,
  hashEquals,
  isHttpsLink,
  isOtherSchemeLink,
  newAtrId,
  parseJson,
  toBase64,
  toBase64Url,
  toLcpString,
  toLegalContext,
  toRawBytes,
} from "./core.js";
export type { AtrHash, CoreRefusal, Json } from "./core.js";
export { domainToAscii, parseHost, readUrl } from "./core.js";
export type { UrlAuthority } from "./core.js";
export { isRefusal, readToRepeat } from "./refusal.js";
export type { Refusal } from "./refusal.js";
export { challengeH, challengeHash, challengeId, FETCHED } from "./mpp-challenge.js";
export {
  checkLegalContextReturn,
  fromLegalContextHeader,
  LEGAL_CONTEXT_HEADER,
  LEGAL_CONTEXT_META,
  LEGAL_CONTEXT_SERVES,
  RETURN_VALUE_BYTES,
  servesOf,
  toLegalContextHeader,
} from "./legal-context-return.js";
export type { LegalContextRecord, LegalContextReturn } from "./legal-context-return.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { LcpPattern } from "./x402.js";
export type {
  AgreementData,
  Carrier,
  ChannelKind,
  Codec,
  Coverage,
  DataMembers,
  EndpointKind,
  Entry,
  Family,
  FeeParty,
  FeePayer,
  IsNever,
  Life,
  NoneWhereNever,
  NonZeroDigit,
  OptionData,
  PairingData,
  ReadData,
} from "./internal/registry.js";
export type {
  Act,
  FailedReason,
  ForeignItem,
  ForeignReason,
  Moved,
  Named,
  OtherAct,
  PendingReason,
  RecoverInput,
  StatusAnswer,
  StatusQuery,
  UnreadableReason,
} from "./internal/read.js";
export {
  MAX_ATR_BYTES,
  MAX_CHALLENGE_DEPTH,
  MAX_CHALLENGES,
  MAX_CREDENTIAL_BYTES,
  MAX_HEADER_BYTES,
  MAX_JSON_DEPTH,
  MAX_LINK_LENGTH,
  MAX_OPTIONS,
  MAX_REQUEST_BYTES,
  MAX_SIGNATURE_BYTES,
  MAX_SLOT_NAME_LENGTH,
} from "./internal/bounds.js";
export type { AptosPaymentPayload } from "./internal/aptos.js";
export type { AvmPaymentPayload } from "./internal/avm.js";
export type { CardanoPaymentPayload } from "./internal/cardano.js";
export type { CasperPaymentPayload } from "./internal/casper.js";
export type { CcdPaymentPayload } from "./internal/ccd.js";
export type {
  ExecutorPayload,
  ExecutorPaymentPayload,
  HederaPayload,
  HederaPaymentPayload,
} from "./internal/hedera.js";
export type { NearPayment } from "./internal/near.js";
export type { PolkadotPayload, PolkadotPaymentPayload } from "./internal/polkadot.js";
export type { StarknetPayment } from "./internal/starknet.js";
export type { StellarPaymentPayload } from "./internal/stellar.js";
export type { SuiPaymentPayload } from "./internal/sui.js";
export type { SvmPaymentPayload, UptoSvmPaymentPayload } from "./internal/svm.js";
export type { TronPayment } from "./internal/tron.js";
export type { TvmPayment } from "./internal/tvm.js";
export type { BatchPaymentPayload, CloudflarePaymentPayload } from "./internal/x402-batch-settlement.js";
export type { X402Payment } from "./internal/x402.js";
export type { XrplPaymentPayload } from "./internal/xrpl.js";

import { paymentRequest } from "./ack.js";
import { delegated, type Presented as AcpPresented, undelegated } from "./acp.js";
import { checkoutMandate, checkoutMandateX402, type Presented as Ap2Presented, type X402Presented as Ap2X402Presented } from "./ap2.js";
import { exactAptos } from "./aptos.js";
import { exactAvm } from "./avm.js";
import { agentPay, sellerReference, type TapPresented, type VicPresented, viAutonomous, type ViAutonomous, viImmediate, type ViImmediate, visaTap, visaVic } from "./card.js";
import { exactCardano, exactCardanoLock } from "./cardano.js";
import { exactCasper } from "./casper.js";
import { exactCcd } from "./ccd.js";
import { exactHedera, exactHederaExecutor } from "./hedera.js";
import type { AptosPaymentPayload } from "./internal/aptos.js";
import type { AvmPaymentPayload } from "./internal/avm.js";
import type { CardanoPaymentPayload } from "./internal/cardano.js";
import type { CasperPaymentPayload } from "./internal/casper.js";
import type { CcdPaymentPayload } from "./internal/ccd.js";
import type { ExecutorPaymentPayload, HederaPaymentPayload } from "./internal/hedera.js";
import type { NearPayment } from "./internal/near.js";
import type { PolkadotPaymentPayload } from "./internal/polkadot.js";
import type { StarknetPayment } from "./internal/starknet.js";
import type { StellarPaymentPayload } from "./internal/stellar.js";
import type { SuiPaymentPayload } from "./internal/sui.js";
import type { SvmPaymentPayload, UptoSvmPaymentPayload } from "./internal/svm.js";
import type { TronPayment } from "./internal/tron.js";
import type { TvmPayment } from "./internal/tvm.js";
import type { BatchPaymentPayload, CloudflarePaymentPayload } from "./internal/x402-batch-settlement.js";
import type { XrplPaymentPayload } from "./internal/xrpl.js";
import { exactLnbtcPaymentHash, type LnPaymentPayload } from "./lightning.js";
import { MPP_BINDINGS, type MppCredential } from "./mpp.js";
import { exactNear } from "./near.js";
import { exactPolkadotRemark } from "./polkadot.js";
import { exactStarknet } from "./starknet.js";
import { spendPermissionsEip155, type SpendPermissionReturn } from "./spend-permissions.js";
import { exactStellarPrecondition } from "./x402-exact-stellar-precondition.js";
import { exactSui } from "./sui.js";
import { exactTronMemo } from "./tron.js";
import { exactTvm } from "./tvm.js";
import { agentSigned, ap2Mandate, bookingAp2Mandate, bookingUnsigned, unsigned, type AgentSignedPresented } from "./ucp.js";
import { authCaptureEip3009, authCapturePermit2, exactEip3009, exactErc7710, exactErc7710Salt, exactGatewayBatched, exactPermit2, LEGAL_CONTEXT, LEGAL_CONTEXT_SCHEMA, type PaymentPayload, type PaymentRequired, type PaymentRequirements, uptoPermit2 } from "./x402.js";
import { batchCloudflare, batchEvm, batchSvm } from "./x402-batch-settlement.js";
import { exactSvm } from "./x402-exact-solana.js";
import { exactXrpl } from "./x402-exact-xrpl.js";
import { uptoSvm } from "./x402-upto-solana.js";
import { uptoXrpl, type UptoXrplPaymentPayload } from "./x402-upto-xrpl.js";

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
  | typeof exactCardanoLock
  | typeof exactCasper
  | typeof exactCcd
  | typeof exactErc7710
  | typeof exactErc7710Salt
  | typeof exactPermit2
  | typeof exactHedera
  | typeof exactHederaExecutor
  | typeof exactLnbtcPaymentHash
  | typeof exactNear
  | typeof exactPolkadotRemark
  | typeof exactSvm
  | typeof exactStarknet
  | typeof exactStellarPrecondition
  | typeof exactSui
  | typeof exactTronMemo
  | typeof exactTvm
  | typeof exactXrpl
  | typeof uptoPermit2
  | typeof uptoSvm
  | typeof exactGatewayBatched
  | typeof uptoXrpl;
/** An MPP pairing of intent and method. */
export type MppBinding = (typeof MPP_BINDINGS)[number];
/** The optional member of a push-mode pairing: the transaction its credential names, or undefined. */
export interface PushMode {
  landedTx?(presented: unknown): string | undefined;
}
/**
 * The optional member of a pairing whose carrier the seller writes after H: `advertise`'s checks and placement, without
 * the checks on that carrier. It takes the arguments its pairing's `advertise` takes.
 */
export interface CarrierAfterH {
  advertiseBeforeCarrier?(doc: never, h: AtrHash, link: string, offer: never, ...rest: never[]): unknown;
}
/**
 * The optional member of a pull pairing whose payer signs an authorization that the chain executes later: the account
 * whose signature authorises the pull, from the presented payment, as lowercase hex. With a `reference` that records
 * the authorization as `authorization` (its scheme, the contract that records its use, its nonce, deadline and token),
 * as the MPP EVM `authorization` and `permit2` charges' and the `usdc` EVM charge's do, it is what `authorizationUsed`
 * (`@integraledger/lcp/evm`) needs to read the authorization's use before any transaction is named. The x402 pull
 * pairings' references record no `authorization`.
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
  | typeof agentPay
  | typeof visaVic
  | typeof bookingAp2Mandate
  | typeof bookingUnsigned
  | typeof ap2Mandate
  | typeof unsigned
  | typeof checkoutMandateX402
  | typeof agentSigned
  | typeof spendPermissionsEip155
) &
  PushMode &
  CarrierAfterH &
  Authorizer;
/** The id of a pairing this package implements: the `id` of an entry of `BINDINGS`. */
export type PairingId = Binding["id"];
export type SurfaceOf<I> = I extends `${infer S}/${string}` ? S : never;
/** The surfaces: each pairing id's first "/" segment. */
export type Surface = SurfaceOf<PairingId>;
/**
 * What the buyer presents as payment, per surface: the union of the payment types of every pairing on it. Every
 * pairing's `bound` and `reference` take `unknown` and check what they are given. `Presented` indexes it by every
 * surface, so a pairing on a surface it does not name does not compile.
 */
export interface PresentedOn {
  /** ACK defines no payer signature; its `bound` refuses whatever is presented. */
  ack: Json;
  acp: AcpPresented;
  ap2: Ap2Presented | Ap2X402Presented;
  card: TapPresented | VicPresented | ViAutonomous | ViImmediate;
  mpp: MppCredential;
  "spend-permissions": SpendPermissionReturn;
  ucp: Ap2Presented | AgentSignedPresented;
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
    | UptoXrplPaymentPayload
    | XrplPaymentPayload;
}
/** What the buyer presents as payment. */
export type Presented = PresentedOn[Surface];
/** The pairing ids of one surface. */
export type PairingOn<S extends Surface> = Extract<PairingId, `${S}/${string}`>;

// Built in a call marked pure, so a bundle that never reads BINDINGS holds none of the pairings it names.
/** Every pairing this package implements. */
export const BINDINGS: readonly Binding[] = /* @__PURE__ */ (() => Object.freeze([
  exactEip3009,
  paymentRequest,
  delegated,
  undelegated,
  checkoutMandate,
  viAutonomous,
  viImmediate,
  sellerReference,
  visaTap,
  agentPay,
  visaVic,
  ...MPP_BINDINGS,
  bookingAp2Mandate,
  bookingUnsigned,
  ap2Mandate,
  unsigned,
  checkoutMandateX402,
  agentSigned,
  authCaptureEip3009,
  authCapturePermit2,
  batchCloudflare,
  batchEvm,
  batchSvm,
  exactAvm,
  exactAptos,
  exactCardano,
  exactCardanoLock,
  exactCasper,
  exactCcd,
  exactErc7710,
  exactErc7710Salt,
  exactPermit2,
  exactHedera,
  exactHederaExecutor,
  exactLnbtcPaymentHash,
  exactNear,
  exactPolkadotRemark,
  exactSvm,
  exactStarknet,
  exactStellarPrecondition,
  exactSui,
  exactTronMemo,
  exactTvm,
  exactXrpl,
  uptoPermit2,
  uptoSvm,
  exactGatewayBatched,
  uptoXrpl,
  spendPermissionsEip155,
]))();

/** Whether a pairing is an x402 pairing. */
function isX402(b: Binding): b is Extract<Binding, { readonly id: PairingOn<"x402"> }> {
  return b.id.startsWith("x402/");
}

/**
 * The x402 pairings, in their order in `BINDINGS`, each typed by a `read` that takes the document `pairingOf` builds.
 * Built in a call marked pure, as `BINDINGS` is.
 */
const X402_BINDINGS: readonly { readonly id: PairingOn<"x402">; readonly read: (doc: PaymentRequired) => unknown }[] =
  /* @__PURE__ */ (() => Object.freeze(BINDINGS.filter(isX402)))();

/**
 * The x402 pairing that serves an option: the first x402 pairing in `BINDINGS` whose `read` offers it, on a document
 * holding that option alone. Undefined when none does. Each pairing's `read` applies the one filter its `advertise`,
 * `build`, `bound` and `reference` apply, so the pairing named takes the option at every step.
 *
 * No two x402 pairings' `read` offers one option, except the two ERC-7710 levels, which share the `erc7710` option: this
 * names `x402/exact/eip155/erc7710`, and `pairingOfPayment` names the level from a payment. A Worker that serves one
 * pairing need not import this function, which loads every pairing: the pairing's own `read`, on a document holding
 * the option, or its `bound`, on a presented payment, answers for that pairing alone.
 */
export function pairingOf(option: PaymentRequirements): PairingOn<"x402"> | undefined {
  const info = toLegalContext(`0x${"00".repeat(32)}`, "https://pairing.invalid/").legalContext;
  const doc: PaymentRequired = {
    x402Version: 2,
    resource: { url: "https://pairing.invalid/" },
    accepts: [option],
    extensions: { [LEGAL_CONTEXT]: { info, schema: LEGAL_CONTEXT_SCHEMA } },
  };
  for (const b of X402_BINDINGS) {
    if (!isRefusal(b.read(doc))) return b.id;
  }
  return undefined;
}
