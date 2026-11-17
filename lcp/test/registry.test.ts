// The registry's type test. Every pairing in BINDINGS is a registry entry: its data, plain values under PairingData,
// read here with no cast, and its codec, typed per family. The compile-time half is checked by
// `tsc -p tsconfig.test.json`: each codec satisfies Entry with its own family's types, and every pairing in BINDINGS
// is named once; no codec satisfies it with another family's reader; no removed id is a PairingId; a floor admits no
// negative; and a function generic over Entry calls every member with no cast. The run-time half holds OWN to
// BINDINGS, runs that function on three entries, and holds each datum to its member's values, the data to its own
// rules, CARRIER to the entries' carrier datum, `broadcasts` to the broadcaster vectors, and the root's bounds to their
// values.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paymentRequest } from "../src/ack.js";
import { delegated, undelegated, type Presented as AcpPresented } from "../src/acp.js";
import { checkoutMandate, checkoutMandateX402, type Presented as Ap2Presented, type X402Presented as Ap2X402Presented, type X402Ref as Ap2X402Ref } from "../src/ap2.js";
import { exactAptos, type AptosReader, type AptosRef } from "../src/aptos.js";
import { exactAvm, type AvmReader, type AvmRef } from "../src/avm.js";
import { agentPay, sellerReference, viAutonomous, viImmediate, visaTap, visaVic, type ChargeRef, type TapPresented, type VicPresented, type ViAutonomous, type ViImmediate } from "../src/card.js";
import { exactCardano, exactCardanoLock, type CardanoReader, type CardanoRef } from "../src/cardano.js";
import { exactCasper, type CasperReader, type CasperRef } from "../src/casper.js";
import { exactCcd, type CcdReader, type CcdRef } from "../src/ccd.js";
import type { AtrHash, Json } from "../src/core.js";
import type { Broadcaster } from "../src/internal/broadcaster.js";
import type { RecoverInput } from "../src/internal/read.js";
import type { ChannelKind } from "../src/internal/registry.js";
import type { AuthCaptureRef, Eip3009Ref, Erc7710Ref, EvmReader, EvmRef, Hex, Permit2Ref } from "../src/evm.js";
import { exactHedera, exactHederaExecutor, type ExecutorRef, type HederaReader, type HederaRef } from "../src/hedera.js";
import * as root from "../src/index.js";
import {
  BINDINGS,
  isRefusal,
  type AgreementData,
  type Coverage,
  type EndpointKind,
  type Entry,
  type Family,
  type PairingData,
  type PairingId,
  type Refusal,
} from "../src/index.js";
import type { AptosPaymentPayload } from "../src/internal/aptos.js";
import type { AvmPaymentPayload } from "../src/internal/avm.js";
import type { CardanoPaymentPayload } from "../src/internal/cardano.js";
import type { CasperPaymentPayload } from "../src/internal/casper.js";
import type { CcdPaymentPayload } from "../src/internal/ccd.js";
import type { ExecutorPaymentPayload, HederaPaymentPayload } from "../src/internal/hedera.js";
import type { NearPayment } from "../src/internal/near.js";
import type { PolkadotPaymentPayload } from "../src/internal/polkadot.js";
import type { StarknetPayment } from "../src/internal/starknet.js";
import type { SuiPaymentPayload } from "../src/internal/sui.js";
import type { SvmPaymentPayload, SvmReader, SvmRef, UptoSvmPaymentPayload } from "../src/internal/svm.js";
import type { TronPayment } from "../src/internal/tron.js";
import type { TvmPayment } from "../src/internal/tvm.js";
import type { BatchPaymentPayload, CloudflarePaymentPayload } from "../src/internal/x402-batch-settlement.js";
import type { XrplCloseRef } from "../src/internal/xrpl-session.js";
import type { XrplNetwork, XrplPaymentPayload, XrplQuery, XrplReader, XrplRef, XrplStatus } from "../src/internal/xrpl.js";
import type { XrplChannelRef } from "../src/internal/xrpl-read.js";
import { chargeLightning, sessionLightning, type LnRef } from "../src/lightning.js";
import {
  CARRIER,
  chargeCard,
  chargeNearIntents,
  chargeSolana,
  chargeSolanaUnsponsored,
  chargeStripe,
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  chargeUsdcStacks,
  chargeXrpl,
  evmAuthorization,
  evmHash,
  evmPermit2,
  evmTransaction,
  sessionEvm,
  sessionTempo,
  sessionXrpl,
  sessionXrplStock,
  sessionSolanaMemo,
  sessionSolanaStock,
  subscriptionSolana,
  sessionHederaStock,
  type HederaStockReader,
  type HederaStockRef,
  subscriptionStripe,
  subscriptionTempo,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { carrierOf, type MppForms } from "../src/mpp-challenge.js";
import type { NearIntentsRef } from "../src/mpp-nearintents.js";
import type { XrplChargeChoice, XrplChargeUnsigned } from "../src/mpp-xrpl.js";
import type { RailSessionChoice, XrplSessionUnsigned } from "../src/mpp-session-rails.js";
import type { SessionRef } from "../src/mpp-session.js";
import { exactNear, type NearReader, type NearRef } from "../src/near.js";
import { exactPolkadotRemark, type PolkadotReader, type PolkadotRef } from "../src/polkadot.js";
import { exactStarknet, type StarknetReader, type StarknetRef } from "../src/starknet.js";
import { exactSui, type SuiReader, type SuiRef } from "../src/sui.js";
import { exactTronMemo, type TronReader, type TronRef } from "../src/tron.js";
import { exactTvm, type TvmReader, type TvmRef } from "../src/tvm.js";
import { agentSigned, ap2Mandate, bookingAp2Mandate, bookingUnsigned, unsigned, type AgentSignedPresented } from "../src/ucp.js";
import { authCaptureEip3009, authCapturePermit2, exactEip3009, exactErc7710, exactErc7710Salt, exactPermit2, uptoPermit2, type Eip3009Payment, type PaymentPayload } from "../src/x402.js";
import { batchCloudflare, batchEvm, batchSvm } from "../src/x402-batch-settlement.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import type { StacksReader, StacksRef } from "../src/stacks.js";
import { rowsOf } from "./rows.js";

// ── Compile time: each codec satisfies Entry with its own family's types.

/** A member's function type, where the entry has the member. */
type Member<E, K extends string> = E extends { readonly [k in K]?: infer M } ? NonNullable<M> : never;
/** A member's parameters, where the entry has the member; never where it has none. */
type ParamsOf<E, K extends string> = Member<E, K> extends (...a: infer A) => unknown ? A : never;
/** What a member gives, awaited, with its refusal left out. */
type GivesOf<E, K extends string> = Member<E, K> extends (...a: never[]) => infer R ? Exclude<Awaited<R>, Refusal> : never;

/** The family descriptor an entry's own members state, so that each line below names only Presented, Ref and Reader. */
type Own<E> = {
  doc: ParamsOf<E, "read">[0];
  offered: GivesOf<E, "read">;
  placedIn: ParamsOf<E, "advertise">[0];
  offer: ParamsOf<E, "advertise">[3];
  rest: ParamsOf<E, "advertise"> extends [unknown, unknown, unknown, unknown, ...infer R] ? R : never;
  advertised: GivesOf<E, "advertise">;
  choice: ParamsOf<E, "build"> extends [infer C, ...unknown[]] ? C : never;
  unsigned: GivesOf<E, "build">;
  option: ParamsOf<E, "reference"> extends [unknown, infer O, ...unknown[]] ? O : never;
  landed: ParamsOf<E, "status"> extends [infer L, ...unknown[]] ? L : never;
  network: ParamsOf<E, "recover"> extends [RecoverInput<infer N, unknown>, ...unknown[]] ? N : never;
  query: ParamsOf<E, "status"> extends [unknown, unknown, infer Q] ? Q : never;
  answer: Member<E, "status"> extends (...a: never[]) => Promise<infer A> ? A : never;
  receipt: ParamsOf<E, "keySearch"> extends [unknown, infer T, ...unknown[]] ? T : never;
};

/**
 * Every pairing in BINDINGS, by its id, with the Presented, Ref and Reader of its family: `Ref` is what its `reference`
 * gives, and only a pairing with no `status` takes `never` for `Reader`, and for `Ref` where it has no `reference`. A
 * pairing missing here, or one named twice, does not compile; the run below holds these to BINDINGS.
 */
const OWN = {
  "x402/exact/eip155/eip3009": exactEip3009 satisfies Entry<"x402/exact/eip155/eip3009", Eip3009Payment, Eip3009Ref, EvmReader, Own<typeof exactEip3009>>,
  "x402/exact/eip155/permit2": exactPermit2 satisfies Entry<"x402/exact/eip155/permit2", PaymentPayload, Permit2Ref, EvmReader, Own<typeof exactPermit2>>,
  "x402/upto/eip155/permit2": uptoPermit2 satisfies Entry<"x402/upto/eip155/permit2", PaymentPayload, Permit2Ref, EvmReader, Own<typeof uptoPermit2>>,
  "x402/exact/eip155/erc7710": exactErc7710 satisfies Entry<"x402/exact/eip155/erc7710", PaymentPayload, Erc7710Ref, EvmReader, Own<typeof exactErc7710>>,
  "x402/exact/eip155/erc7710-salt": exactErc7710Salt satisfies Entry<"x402/exact/eip155/erc7710-salt", PaymentPayload, Erc7710Ref, EvmReader, Own<typeof exactErc7710Salt>>,
  "x402/auth-capture/eip155/eip3009": authCaptureEip3009 satisfies Entry<"x402/auth-capture/eip155/eip3009", PaymentPayload, AuthCaptureRef, EvmReader, Own<typeof authCaptureEip3009>>,
  "x402/auth-capture/eip155/permit2": authCapturePermit2 satisfies Entry<"x402/auth-capture/eip155/permit2", PaymentPayload, AuthCaptureRef, EvmReader, Own<typeof authCapturePermit2>>,
  "x402/batch-settlement/eip155": batchEvm satisfies Entry<"x402/batch-settlement/eip155", BatchPaymentPayload, EvmRef, EvmReader, Own<typeof batchEvm>>,
  "x402/batch-settlement/solana": batchSvm satisfies Entry<"x402/batch-settlement/solana", BatchPaymentPayload, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof batchSvm>>,
  "x402/batch-settlement/cloudflare": batchCloudflare satisfies Entry<"x402/batch-settlement/cloudflare", CloudflarePaymentPayload, never, never, Own<typeof batchCloudflare>>,
  "x402/exact/algorand": exactAvm satisfies Entry<"x402/exact/algorand", AvmPaymentPayload, AvmRef, AvmReader, Own<typeof exactAvm>>,
  "x402/exact/aptos": exactAptos satisfies Entry<"x402/exact/aptos", AptosPaymentPayload, AptosRef, AptosReader, Own<typeof exactAptos>>,
  "x402/exact/cardano": exactCardano satisfies Entry<"x402/exact/cardano", CardanoPaymentPayload, CardanoRef, CardanoReader, Own<typeof exactCardano>>,
  "x402/exact/cardano/lock": exactCardanoLock satisfies Entry<"x402/exact/cardano/lock", CardanoPaymentPayload, CardanoRef, CardanoReader, Own<typeof exactCardanoLock>>,
  "x402/exact/casper": exactCasper satisfies Entry<"x402/exact/casper", CasperPaymentPayload, CasperRef, CasperReader, Own<typeof exactCasper>>,
  "x402/exact/ccd": exactCcd satisfies Entry<"x402/exact/ccd", CcdPaymentPayload, CcdRef, CcdReader, Own<typeof exactCcd>>,
  "x402/exact/hedera": exactHedera satisfies Entry<"x402/exact/hedera", HederaPaymentPayload, HederaRef, HederaReader, Own<typeof exactHedera>>,
  "x402/exact/hedera/transfer-executor": exactHederaExecutor satisfies Entry<"x402/exact/hedera/transfer-executor", ExecutorPaymentPayload, ExecutorRef, HederaReader, Own<typeof exactHederaExecutor>>,
  "x402/exact/near": exactNear satisfies Entry<"x402/exact/near", NearPayment, NearRef, NearReader, Own<typeof exactNear>>,
  "x402/exact/polkadot/lcp-assets-remark": exactPolkadotRemark satisfies Entry<"x402/exact/polkadot/lcp-assets-remark", PolkadotPaymentPayload, PolkadotRef, PolkadotReader, Own<typeof exactPolkadotRemark>>,
  "x402/exact/solana": exactSvm satisfies Entry<"x402/exact/solana", SvmPaymentPayload, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof exactSvm>>,
  "x402/upto/solana": uptoSvm satisfies Entry<"x402/upto/solana", UptoSvmPaymentPayload, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof uptoSvm>>,
  "x402/exact/starknet": exactStarknet satisfies Entry<"x402/exact/starknet", StarknetPayment, StarknetRef, StarknetReader, Own<typeof exactStarknet>>,
  "x402/exact/sui": exactSui satisfies Entry<"x402/exact/sui", SuiPaymentPayload, SuiRef, SuiReader, Own<typeof exactSui>>,
  "x402/exact/tron/lcp-trc20-memo": exactTronMemo satisfies Entry<"x402/exact/tron/lcp-trc20-memo", TronPayment, TronRef, TronReader, Own<typeof exactTronMemo>>,
  "x402/exact/tvm": exactTvm satisfies Entry<"x402/exact/tvm", TvmPayment, TvmRef, TvmReader, Own<typeof exactTvm>>,
  "x402/exact/xrpl": exactXrpl satisfies Entry<"x402/exact/xrpl", XrplPaymentPayload, Omit<XrplRef, "fromLedger">, XrplReader, Own<typeof exactXrpl>>,
  "mpp/charge/evm/authorization": evmAuthorization satisfies Entry<"mpp/charge/evm/authorization", MppCredential, EvmRef, EvmReader, Own<typeof evmAuthorization>>,
  "mpp/charge/evm/permit2": evmPermit2 satisfies Entry<"mpp/charge/evm/permit2", MppCredential, EvmRef, EvmReader, Own<typeof evmPermit2>>,
  "mpp/charge/evm/transaction": evmTransaction satisfies Entry<"mpp/charge/evm/transaction", MppCredential, EvmRef & { asset: Hex }, EvmReader, Own<typeof evmTransaction>>,
  "mpp/charge/evm/hash": evmHash satisfies Entry<"mpp/charge/evm/hash", MppCredential, EvmRef & { asset: Hex }, EvmReader, Own<typeof evmHash>>,
  "mpp/session/evm": sessionEvm satisfies Entry<"mpp/session/evm", MppCredential, SessionRef, EvmReader, Own<typeof sessionEvm>>,
  "mpp/session/tempo": sessionTempo satisfies Entry<"mpp/session/tempo", MppCredential, SessionRef, EvmReader, Own<typeof sessionTempo>>,
  "mpp/subscription/tempo": subscriptionTempo satisfies Entry<"mpp/subscription/tempo", MppCredential, SessionRef, EvmReader, Own<typeof subscriptionTempo>>,
  "mpp/charge/lightning": chargeLightning satisfies Entry<"mpp/charge/lightning", MppCredential, LnRef, never, Own<typeof chargeLightning>>,
  "mpp/session/lightning": sessionLightning satisfies Entry<"mpp/session/lightning", MppCredential, LnRef, never, Own<typeof sessionLightning>>,
  "mpp/charge/solana": chargeSolana satisfies Entry<"mpp/charge/solana", MppCredential, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof chargeSolana>>,
  "mpp/charge/solana/unsponsored": chargeSolanaUnsponsored satisfies Entry<"mpp/charge/solana/unsponsored", MppCredential, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof chargeSolanaUnsponsored>>,
  "mpp/session/solana/memo": sessionSolanaMemo satisfies Entry<"mpp/session/solana/memo", MppCredential, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof sessionSolanaMemo>>,
  "mpp/session/solana/stock": sessionSolanaStock satisfies Entry<"mpp/session/solana/stock", MppCredential, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof sessionSolanaStock>>,
  "mpp/subscription/solana": subscriptionSolana satisfies Entry<"mpp/subscription/solana", MppCredential, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof subscriptionSolana>>,
  "mpp/charge/xrpl": chargeXrpl satisfies Entry<"mpp/charge/xrpl", MppCredential, Omit<XrplRef, "fromLedger">, XrplReader, Own<typeof chargeXrpl>>,
  "mpp/charge/nearintents": chargeNearIntents satisfies Entry<"mpp/charge/nearintents", MppCredential, NearIntentsRef, never, Own<typeof chargeNearIntents>>,
  "mpp/session/xrpl": sessionXrpl satisfies Entry<"mpp/session/xrpl", MppCredential, Omit<XrplRef, "fromLedger">, XrplReader, Own<typeof sessionXrpl>>,
  "mpp/session/xrpl/stock": sessionXrplStock satisfies Entry<"mpp/session/xrpl/stock", MppCredential, Omit<XrplChannelRef, "fromLedger">, XrplReader, Own<typeof sessionXrplStock>>,
  "mpp/session/hedera/stock": sessionHederaStock satisfies Entry<"mpp/session/hedera/stock", MppCredential, HederaStockRef, HederaStockReader, Own<typeof sessionHederaStock>>,
  "mpp/charge/card": chargeCard satisfies Entry<"mpp/charge/card", MppCredential, never, never, Own<typeof chargeCard>>,
  "mpp/charge/stripe": chargeStripe satisfies Entry<"mpp/charge/stripe", MppCredential, never, never, Own<typeof chargeStripe>>,
  "mpp/subscription/stripe": subscriptionStripe satisfies Entry<"mpp/subscription/stripe", MppCredential, never, never, Own<typeof subscriptionStripe>>,
  "mpp/charge/usdc/evm": chargeUsdcEvm satisfies Entry<"mpp/charge/usdc/evm", MppCredential, EvmRef, EvmReader, Own<typeof chargeUsdcEvm>>,
  "mpp/charge/usdc/solana": chargeUsdcSolana satisfies Entry<"mpp/charge/usdc/solana", MppCredential, Omit<SvmRef, "fromSlot">, SvmReader, Own<typeof chargeUsdcSolana>>,
  "mpp/charge/usdc/stacks": chargeUsdcStacks satisfies Entry<"mpp/charge/usdc/stacks", MppCredential, StacksRef, StacksReader, Own<typeof chargeUsdcStacks>>,
  "mpp/charge/usdc/gateway": chargeUsdcGateway satisfies Entry<"mpp/charge/usdc/gateway", MppCredential, never, never, Own<typeof chargeUsdcGateway>>,
  "ack/payment-request": paymentRequest satisfies Entry<"ack/payment-request", Json, never, never, Own<typeof paymentRequest>>,
  "acp/checkout/delegated": delegated satisfies Entry<"acp/checkout/delegated", AcpPresented, never, never, Own<typeof delegated>>,
  "acp/checkout/undelegated": undelegated satisfies Entry<"acp/checkout/undelegated", AcpPresented, ChargeRef, never, Own<typeof undelegated>>,
  "ap2/checkout-mandate": checkoutMandate satisfies Entry<"ap2/checkout-mandate", Ap2Presented, never, never, Own<typeof checkoutMandate>>,
  "card/visa-tap": visaTap satisfies Entry<"card/visa-tap", TapPresented, never, never, Own<typeof visaTap>>,
  "card/mastercard-vi/immediate": viImmediate satisfies Entry<"card/mastercard-vi/immediate", ViImmediate, never, never, Own<typeof viImmediate>>,
  "card/mastercard-vi/autonomous": viAutonomous satisfies Entry<"card/mastercard-vi/autonomous", ViAutonomous, never, never, Own<typeof viAutonomous>>,
  "card/seller-reference": sellerReference satisfies Entry<"card/seller-reference", unknown, ChargeRef, never, Own<typeof sellerReference>>,
  "card/mastercard-agent-pay": agentPay satisfies Entry<"card/mastercard-agent-pay", TapPresented, never, never, Own<typeof agentPay>>,
  "card/visa-vic": visaVic satisfies Entry<"card/visa-vic", VicPresented, never, never, Own<typeof visaVic>>,
  "ucp/checkout/ap2-mandate": ap2Mandate satisfies Entry<"ucp/checkout/ap2-mandate", Ap2Presented, never, never, Own<typeof ap2Mandate>>,
  "ucp/checkout/unsigned": unsigned satisfies Entry<"ucp/checkout/unsigned", Ap2Presented, ChargeRef, never, Own<typeof unsigned>>,
  "ucp/booking/ap2-mandate": bookingAp2Mandate satisfies Entry<"ucp/booking/ap2-mandate", Ap2Presented, never, never, Own<typeof bookingAp2Mandate>>,
  "ucp/booking/unsigned": bookingUnsigned satisfies Entry<"ucp/booking/unsigned", Ap2Presented, never, never, Own<typeof bookingUnsigned>>,
  "ap2/checkout-mandate/x402": checkoutMandateX402 satisfies Entry<"ap2/checkout-mandate/x402", Ap2X402Presented, Ap2X402Ref, never, Own<typeof checkoutMandateX402>>,
  "ucp/checkout/agent-signed": agentSigned satisfies Entry<"ucp/checkout/agent-signed", AgentSignedPresented, never, never, Own<typeof agentSigned>>,
} satisfies { readonly [I in PairingId]: { readonly id: I } };

// ── Compile time: no codec satisfies Entry with another family's reader. Each alias differs from the line above only
// in its reader, so the one statement under each `@ts-expect-error` can fail only on that reader.

type AvmWithSui = Entry<"x402/exact/algorand", AvmPaymentPayload, AvmRef, SuiReader, Own<typeof exactAvm>>;
// @ts-expect-error -- an Algorand codec's `status` and `recover` take an Algorand reader, not a Sui one.
void (exactAvm satisfies AvmWithSui);
type SvmWithXrpl = Entry<"x402/exact/solana", SvmPaymentPayload, Omit<SvmRef, "fromSlot">, XrplReader, Own<typeof exactSvm>>;
// @ts-expect-error -- a Solana codec's `status` and `recover` take a Solana reader, not an XRPL one.
void (exactSvm satisfies SvmWithXrpl);
type UsdcEvmWithStacks = Entry<"mpp/charge/usdc/evm", MppCredential, EvmRef, StacksReader, Own<typeof chargeUsdcEvm>>;
// @ts-expect-error -- an EVM codec's `status` takes an EVM reader, not a Stacks one.
void (chargeUsdcEvm satisfies UsdcEvmWithStacks);
type TronWithTvm = Entry<"x402/exact/tron/lcp-trc20-memo", TronPayment, TronRef, TvmReader, Own<typeof exactTronMemo>>;
// @ts-expect-error -- a TRON codec's `status` takes a TRON reader, not a TON one.
void (exactTronMemo satisfies TronWithTvm);

// ── Compile time: Entry takes `never` for Reader, Ref or Presented only where the codec has no member that takes it.

type AptosWithNoReader = Entry<"x402/exact/aptos", AptosPaymentPayload, AptosRef, never, Own<typeof exactAptos>>;
// @ts-expect-error -- an entry with a `status` takes its reader.
void (exactAptos satisfies AptosWithNoReader);
type AptosWithNoRef = Entry<"x402/exact/aptos", AptosPaymentPayload, never, AptosReader, Own<typeof exactAptos>>;
// @ts-expect-error -- an entry with a `reference` takes its reference type.
void (exactAptos satisfies AptosWithNoRef);
type SellerReferenceWithNothing = Entry<"card/seller-reference", never, ChargeRef, never, Own<typeof sellerReference>>;
// @ts-expect-error -- every entry's `bound` takes what is presented.
void (sellerReference satisfies SellerReferenceWithNothing);

// ── Compile time: a removed id is no PairingId. Each line is one declaration, which fails only on its id.

// @ts-expect-error -- removed
export const removed1: PairingId = "mpp/charge/tempo/memo";
// @ts-expect-error -- removed
export const removed2: PairingId = "mpp/charge/tempo/push";
// @ts-expect-error -- removed
export const removed3: PairingId = "x402/exact/stellar";
// @ts-expect-error -- removed
export const removed4: PairingId = "mpp/charge/stellar";
// @ts-expect-error -- removed
export const removed5: PairingId = "mpp/charge/hedera";
// @ts-expect-error -- removed
export const removed6: PairingId = "mpp/session/solana";
// @ts-expect-error -- removed
export const removed7: PairingId = "mpp/session/hedera";
// @ts-expect-error -- removed
export const removed8: PairingId = "x402/exact/lnbtc";
// @ts-expect-error -- removed
export const removed9: PairingId = "x402/exact/lnbtc/invoice-named";

// ── Compile time: the data's own types.

// @ts-expect-error -- a floor admits no negative.
export const negativeFloor: AgreementData["floor"] = "-1";
// @ts-expect-error -- a floor admits no leading zero.
export const zeroLedFloor: AgreementData["floor"] = "01";
// @ts-expect-error -- agreementOn names a pairing by an x402 or MPP id.
export const otherAgreement: PairingData["agreementOn"] = "card/visa-tap";

// ── Compile time and run time: a function generic over Entry calls every member, with no cast.

const H: AtrHash = `0x${"11".repeat(32)}`;
const HTTPS_LINK = "https://example.com/atr";

/** What `callEvery` passes to the members every entry has, and to `build`, each typed by the entry's own types. */
interface Forms<Presented, F extends Family> {
  readonly doc: F["doc"];
  readonly placedIn: F["placedIn"];
  readonly offer: F["offer"];
  readonly rest: F["rest"];
  readonly choice: F["choice"];
  readonly presented: Presented;
}

/** What `callEvery` passes to the members of a read: given only for an entry with one. */
interface Reads<Reader, F extends Family> {
  readonly option: F["option"];
  readonly landed: F["landed"];
  readonly reader: Reader;
  readonly query: F["query"];
  readonly network: F["network"];
  readonly tx: string;
  readonly receipt?: F extends { readonly receipt: infer T } ? T : never;
}

/** Calls each member the entry has, through Entry's type alone, and names each one it called. */
async function callEvery<Id extends string, Presented, Ref, Reader, F extends Family>(
  e: Entry<Id, Presented, Ref, Reader, F>,
  a: Forms<Presented, F>,
  r?: Reads<Reader, F>,
): Promise<string[]> {
  const called: string[] = [];
  const offered: F["offered"] | Refusal = e.read(a.doc);
  const advertised: F["advertised"] | Refusal = e.advertise(a.placedIn, H, HTTPS_LINK, a.offer, ...a.rest);
  called.push("read", "advertise");
  void [offered, advertised];
  if (e.advertiseBeforeCarrier !== undefined) {
    const before: F["advertised"] | Refusal = e.advertiseBeforeCarrier(a.placedIn, H, HTTPS_LINK, a.offer, ...a.rest);
    called.push("advertiseBeforeCarrier");
    void before;
  }
  if (e.build !== undefined) {
    const unsigned: F["unsigned"] | Refusal = await e.build(a.choice, H);
    called.push("build");
    void unsigned;
  }
  const bound: AtrHash | Refusal = await e.bound(a.presented);
  const broadcaster: Broadcaster | Refusal = await e.broadcaster(a.presented);
  called.push("bound", "broadcaster");
  void [bound, broadcaster];
  if (e.channel !== undefined) {
    const kind: ChannelKind | Refusal = e.channel.kind(a.presented);
    const channel: { network: string; channel: string } | Refusal = await e.channel.ref(a.presented);
    const within: AtrHash | Refusal = await e.channel.boundWithin(a.presented);
    const until: number | undefined = e.channel.until(a.presented);
    called.push("channel");
    void [kind, channel, within, until];
  }
  if (e.landedTx !== undefined) {
    const landed: string | undefined = e.landedTx(a.presented);
    called.push("landedTx");
    void landed;
  }
  if (r === undefined) return called;
  if (e.reference !== undefined) {
    const ref: Ref | Refusal = await e.reference(a.presented, r.option);
    called.push("reference");
    if (!isRefusal(ref)) {
      if (e.status !== undefined) {
        const answer: F["answer"] = await e.status(Object.assign({}, ref, r.landed), r.reader, r.query);
        called.push("status");
        void answer;
      }
      if (e.keySearch !== undefined && r.receipt !== undefined) {
        const keyed: Ref | Refusal = e.keySearch(ref, r.receipt, H);
        called.push("keySearch");
        void keyed;
      }
    }
  }
  if (e.recover !== undefined) {
    const recovered: AtrHash | Refusal = await e.recover({ network: r.network, tx: r.tx, option: r.option }, r.reader);
    called.push("recover");
    void recovered;
  }
  if (e.fetchPresented !== undefined) {
    const fetched: Presented | Refusal = await e.fetchPresented(a.presented, r.reader);
    called.push("fetchPresented");
    void fetched;
  }
  return called;
}

// ── Run time.

const ENTRIES = rowsOf(BINDINGS, "BINDINGS", { exact: 69 });
const IDS = new Set<string>(ENTRIES.map((b) => b.id));

// Each member's values. A key these objects lack, or one outside the member's type, does not compile.
const COVERAGE: { readonly [v in Coverage]: true } = { full: true, none: true };
const NONCE: { readonly [v in PairingData["nonce"]]: true } = { "single-use": true, reusable: true, unshown: true };
const BROADCASTS: { readonly [v in PairingData["broadcasts"]]: true } = { payee: true, payer: true, either: true };
const CONFIRMED: { readonly [v in PairingData["confirmed"]]: true } = { yes: true, no: true };
const LINK: { readonly [v in NonNullable<PairingData["link"]>]: true } = { h: true, pointer: true, none: true };
const ENDPOINT: { readonly [v in EndpointKind]: true } = {
  "fullnode-http": true,
  "fullnode-rest": true,
  graphql: true,
  "grpc-v2": true,
  "indexer-rest": true,
  "json-rpc": true,
  "mirror-rest": true,
  "rest-api": true,
  rippled: true,
  "stacks-api-rest": true,
  "toncenter-v3": true,
};

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));

/** The XRPL charge's family descriptor, as its entry states it. */
type XrplChargeFamily = MppForms & {
  choice: XrplChargeChoice;
  unsigned: XrplChargeUnsigned;
  landed: Pick<XrplRef, "fromLedger">;
  network: XrplNetwork;
  query: XrplQuery<XrplRef>;
  answer: XrplStatus;
};

/** The XRPL session's family descriptor, as its entry states it. */
type XrplSessionFamily = MppForms & {
  choice: RailSessionChoice;
  unsigned: XrplSessionUnsigned;
  landed: Pick<XrplRef, "fromLedger">;
  network: XrplNetwork;
  query: XrplQuery<XrplRef | XrplCloseRef>;
  answer: XrplStatus;
};

/** An XRPL reader that holds no transaction, at a validated ledger of 1000. */
const XRPL_READER: XrplReader = {
  network: "xrpl:0",
  server: async () => ({ validated: 1000, latest: 1001, completeLedgers: "1-1001" }),
  tx: async () => ({ notFound: true, searchedAll: true }),
  accountTx: async (_a, range) => ({ transactions: [], min: range.min, max: range.max }),
  accountInfo: async (_a, ledger) => ({ notFound: true, ledgerIndex: ledger === "validated" ? 1000 : 1001 }),
  ticket: async () => ({ present: false, ledgerIndex: 1000 }),
  channel: async () => ({ notFound: true, ledgerIndex: 1000 }),
};

describe("the registry's codec type", () => {
  it("OWN names every pairing in BINDINGS once, each under its own id", () => {
    const own = rowsOf(Object.entries(OWN), "OWN", { exact: ENTRIES.length });
    for (const [id, entry] of own) expect(entry.id).toBe(id);
    expect(new Set(own.map(([, entry]) => entry))).toEqual(new Set(ENTRIES));
  });

  it("a function generic over Entry calls each member an entry has, read keys first, with no cast", async () => {
    const M = load("mpp-charge-xrpl.json");
    const S = load("mpp-session-hedera-solana-xrpl.json");
    const query = { act: "payment", finality: "validated" } as const;
    const tx = "AB".repeat(32);

    const charge: MppChallenge & { id: string } = M.place.expect;
    const chargeForms: Forms<MppCredential, XrplChargeFamily> = {
      doc: [charge],
      placedIn: [],
      offer: charge,
      rest: [null],
      choice: { challenge: charge, account: "", fee: "", sequence: 0, lastLedgerSequence: 0 },
      presented: { challenge: charge, payload: { type: "transaction", blob: M.V3.blob } },
    };
    const xrplReads = { landed: { fromLedger: 1 }, reader: XRPL_READER, query, network: "xrpl:0", tx } as const;
    expect(await callEvery<typeof chargeXrpl.id, MppCredential, Omit<XrplRef, "fromLedger">, XrplReader, XrplChargeFamily>(chargeXrpl, chargeForms, { ...xrplReads, option: charge })).toEqual([
      "read", "advertise", "build", "bound", "broadcaster", "landedTx", "reference", "status", "recover", "fetchPresented",
    ]);

    const session: MppChallenge & { id: string } = S.SS1.xrpl.placed;
    const sessionForms: Forms<MppCredential, XrplSessionFamily> = {
      doc: [session],
      placedIn: [],
      offer: session,
      rest: [null],
      choice: S.SS1.xrpl.choice,
      presented: { challenge: session, payload: { action: "open", transaction: S.XS2.blob, amount: "100", signature: "00" } },
    };
    expect(await callEvery<typeof sessionXrpl.id, MppCredential, Omit<XrplRef, "fromLedger">, XrplReader, XrplSessionFamily>(sessionXrpl, sessionForms, { ...xrplReads, option: session })).toEqual([
      "read", "advertise", "build", "bound", "broadcaster", "channel", "reference", "status", "recover",
    ]);

    const ackForms: Forms<Json, Own<typeof paymentRequest>> = {
      doc: { paymentRequestToken: "", legalContext: {} },
      placedIn: {},
      offer: { id: "o" },
      rest: [],
      choice: {},
      presented: {},
    };
    expect(await callEvery<typeof paymentRequest.id, Json, never, never, Own<typeof paymentRequest>>(paymentRequest, ackForms)).toEqual(["read", "advertise", "build", "bound", "broadcaster"]);
  });
});

describe("the registry's type test", () => {
  it("every entry's coverage, carrier, nonce, broadcasts, confirmed and proves is one of its member's values", () => {
    for (const b of ENTRIES) {
      const coverage: Coverage = b.data.coverage;
      const signed: string | null = b.data.carrier.signed;
      const nonce: PairingData["nonce"] = b.data.nonce;
      const broadcasts: PairingData["broadcasts"] = b.data.broadcasts;
      const confirmed: PairingData["confirmed"] = b.data.confirmed;
      const proves: string = b.data.proves;
      expect(Object.hasOwn(COVERAGE, coverage), b.id).toBe(true);
      expect(signed === null || (typeof signed === "string" && signed !== ""), b.id).toBe(true);
      expect(Object.hasOwn(NONCE, nonce), b.id).toBe(true);
      expect(Object.hasOwn(BROADCASTS, broadcasts), b.id).toBe(true);
      expect(Object.hasOwn(CONFIRMED, confirmed), b.id).toBe(true);
      expect(typeof proves === "string" && proves !== "", b.id).toBe(true);
      expect(Object.isFrozen(b.data) && Object.isFrozen(b.data.carrier), b.id).toBe(true);
    }
  });

  it("the data's own rules: a link at coverage none always, agreementOn at none only, agreement at full and single-use only", () => {
    for (const d of ENTRIES.map((b) => ({ id: b.id, ...b.data }))) {
      if (d.coverage === "none") expect(Object.hasOwn(LINK, d.link), d.id).toBe(true);
      else expect(d.link, d.id).toBeUndefined();
      if (d.agreementOn !== undefined) expect(d.coverage, d.id).toBe("none");
      if (d.agreement !== undefined) expect([d.id, d.coverage, d.nonce]).toEqual([d.id, "full", "single-use"]);
    }
  });

  it("a read names one or more endpoint kinds, each once, and its fallback, where it has one, is a kind too", () => {
    const reads = rowsOf(
      ENTRIES.flatMap((b) => (b.data.read === undefined ? [] : [[b.id, b.data.read] as const])),
      "the entries with a read",
    );
    for (const [id, read] of reads) {
      expect(read.endpoint.length > 0 && new Set(read.endpoint).size === read.endpoint.length, id).toBe(true);
      for (const kind of read.endpoint) expect(Object.hasOwn(ENDPOINT, kind), id).toBe(true);
      if (read.fallback !== undefined) expect(Object.hasOwn(ENDPOINT, read.fallback), id).toBe(true);
      if (read.note !== undefined) expect(read.note !== "", id).toBe(true);
    }
  });

  it("an agreementOn naming a pairing names one in BINDINGS", () => {
    const named = ENTRIES.flatMap((b) => {
      const a = b.data.agreementOn;
      return a === undefined || a === "any" || a === "same-network" ? [] : [a];
    });
    for (const a of named) expect(IDS.has(a), a).toBe(true);
  });

  it("life is a member of read alone, a positive count with its unit and chain rule", () => {
    for (const b of ENTRIES) {
      expect(Object.hasOwn(b.data, "life"), b.id).toBe(false);
      const life = b.data.read?.life;
      if (life === undefined) continue;
      expect(Number.isSafeInteger(life.value) && life.value > 0, b.id).toBe(true);
      expect(typeof life.unit === "string" && life.unit !== "" && typeof life.rule === "string" && life.rule !== "", b.id).toBe(true);
    }
    expect(ENTRIES.filter((b) => b.data.read?.life !== undefined).length).toBeGreaterThan(0);
  });

  it("an agreement's floor is a digit string or `rule`", () => {
    const floors = rowsOf(
      ENTRIES.flatMap((b) => (b.data.agreement === undefined ? [] : [[b.id, b.data.agreement.floor] as const])),
      "the entries with an agreement",
    );
    for (const [id, floor] of floors) expect(floor === "rule" || /^(0|[1-9][0-9]*)$/.test(floor), id).toBe(true);
  });

  it("CARRIER is the table the MPP entries' carrier datum gives, and the entries of one intent and method agree", () => {
    const table: { [intent: string]: { [method: string]: readonly string[] | null } } = {};
    const mpp = rowsOf(ENTRIES.filter((b) => b.id.startsWith("mpp/")), "the MPP entries", { exact: 26 });
    for (const b of mpp) {
      const [, intent, method] = b.id.split("/") as [string, string, string];
      if (method === "usdc") continue;
      const member = b.data.carrier.member ?? null;
      const byMethod = (table[intent] ??= {});
      if (Object.hasOwn(byMethod, method)) expect(member, b.id).toEqual(byMethod[method]);
      else byMethod[method] = member;
    }
    expect(CARRIER).toEqual(table);
  });

  it("usdc's carrier is each profile's entry's carrier datum, by the request's methodDetails.type", () => {
    const usdc = rowsOf(ENTRIES.filter((b) => b.id.startsWith("mpp/charge/usdc/")), "the usdc entries", { exact: 4 });
    for (const b of usdc) {
      const type = b.id.split("/")[3]!;
      const challenge = { realm: "r", method: "usdc", intent: "charge", request: "" };
      expect(carrierOf(challenge, { methodDetails: { type } }), b.id).toEqual(b.data.carrier.member ?? null);
    }
  });

  it("broadcasts is the set of answers the broadcaster vectors show for the pairing, `either` being both", () => {
    const V = JSON.parse(readFileSync(new URL("../vectors/broadcaster.json", import.meta.url), "utf8"));
    const shown = new Map<string, Set<string>>();
    const add = (pairing: string, answer: string) => shown.set(pairing, (shown.get(pairing) ?? new Set()).add(answer));
    for (const r of rowsOf<{ pairing: string; broadcaster: string | null }>(V.pairings, "broadcaster.json pairings")) {
      if (r.broadcaster !== null) add(r.pairing, r.broadcaster);
    }
    for (const r of rowsOf<{ pairing: string; expect: string }>(V.kinds, "broadcaster.json kinds")) add(r.pairing, r.expect);
    const covered = rowsOf(ENTRIES.filter((b) => shown.has(b.id)), "the entries the broadcaster vectors cover");
    for (const b of covered) {
      const datum = b.data.broadcasts === "either" ? ["payee", "payer"] : [b.data.broadcasts];
      expect([b.id, [...shown.get(b.id)!].sort()]).toEqual([b.id, datum]);
    }
  });

  it("the root exports the seven bounds", () => {
    expect({
      MAX_SIGNATURE_BYTES: root.MAX_SIGNATURE_BYTES,
      MAX_LINK_LENGTH: root.MAX_LINK_LENGTH,
      MAX_OPTIONS: root.MAX_OPTIONS,
      MAX_CHALLENGES: root.MAX_CHALLENGES,
      MAX_CREDENTIAL_BYTES: root.MAX_CREDENTIAL_BYTES,
      MAX_JSON_DEPTH: root.MAX_JSON_DEPTH,
      MAX_CHALLENGE_DEPTH: root.MAX_CHALLENGE_DEPTH,
    }).toEqual({
      MAX_SIGNATURE_BYTES: 8192,
      MAX_LINK_LENGTH: 2048,
      MAX_OPTIONS: 32,
      MAX_CHALLENGES: 32,
      MAX_CREDENTIAL_BYTES: 65536,
      MAX_JSON_DEPTH: 64,
      MAX_CHALLENGE_DEPTH: 16,
    });
  });
});
