// The registry's type test. Every pairing in BINDINGS is a registry entry: its data, plain values under PairingData,
// read here with no cast, and its codec, typed per family. The compile-time half is the `satisfies` lines below, which
// `tsc -p tsconfig.test.json` checks: each codec satisfies Entry with its own family's reader, no codec satisfies it
// with another family's reader, and no removed id is a PairingId. The run-time half holds each datum to its member's
// values, the data to its own rules, CARRIER to the entries' carrier datum, `broadcasts` to the broadcaster vectors,
// and the root's bounds to their values.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paymentRequest } from "../src/ack.js";
import { delegated, undelegated, type Presented as AcpPresented } from "../src/acp.js";
import { checkoutMandate, type Presented as Ap2Presented } from "../src/ap2.js";
import { exactAptos, type AptosReader, type AptosRef } from "../src/aptos.js";
import { exactAvm, type AvmReader, type AvmRef } from "../src/avm.js";
import { sellerReference, viAutonomous, viImmediate, visaTap, type TapPresented, type ViAutonomous, type ViImmediate } from "../src/card.js";
import { exactCardano, type CardanoReader, type CardanoRef } from "../src/cardano.js";
import { exactCasper, type CasperReader, type CasperRef } from "../src/casper.js";
import { exactCcd, type CcdReader, type CcdRef } from "../src/ccd.js";
import type { AtrHash, Json } from "../src/core.js";
import type { EvmReader, EvmRef, Hex } from "../src/evm.js";
import { exactHedera, exactHederaExecutor, type ExecutorRef, type HederaReader, type HederaRef } from "../src/hedera.js";
import * as root from "../src/index.js";
import { BINDINGS, type Coverage, type EndpointKind, type Entry, type PairingData, type PairingId } from "../src/index.js";
import type { AptosPaymentPayload } from "../src/internal/aptos.js";
import type { AvmPaymentPayload } from "../src/internal/avm.js";
import type { CardanoPaymentPayload } from "../src/internal/cardano.js";
import type { CasperPaymentPayload } from "../src/internal/casper.js";
import type { CcdPaymentPayload } from "../src/internal/ccd.js";
import type { eip3009Status } from "../src/internal/evm.js";
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
import type { XrplPaymentPayload, XrplReader, XrplRef } from "../src/internal/xrpl.js";
import { chargeLightning, sessionLightning, type LnRef } from "../src/lightning.js";
import {
  CARRIER,
  chargeCard,
  chargeNearIntents,
  chargeSolana,
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
  subscriptionStripe,
  subscriptionTempo,
  type MppCredential,
} from "../src/mpp.js";
import { carrierOf } from "../src/mpp-challenge.js";
import type { SessionRef } from "../src/mpp-session.js";
import { exactNear, type NearReader, type NearRef } from "../src/near.js";
import { exactPolkadotRemark, type PolkadotReader, type PolkadotRef } from "../src/polkadot.js";
import { exactStarknet, type Felt, type StarknetReader, type StarknetRef } from "../src/starknet.js";
import { exactSui, type SuiReader, type SuiRef } from "../src/sui.js";
import { exactTronMemo, type TronReader, type TronRef } from "../src/tron.js";
import { exactTvm, type TvmReader, type TvmRef } from "../src/tvm.js";
import { ap2Mandate, bookingAp2Mandate, bookingUnsigned, unsigned } from "../src/ucp.js";
import { authCaptureEip3009, authCapturePermit2, exactEip3009, exactErc7710, exactErc7710Salt, exactPermit2, uptoPermit2, type Eip3009Payment, type PaymentPayload } from "../src/x402.js";
import { batchCloudflare, batchEvm, batchSvm } from "../src/x402-batch-settlement.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import type { StacksReader, StacksRef } from "../src/stacks.js";
import { rowsOf } from "./rows.js";

// ── Compile time: each codec satisfies Entry with its own family's types.

type BreadthRef = EvmRef & { transaction: Hex };
void (exactEip3009 satisfies Entry<"x402/exact/eip155/eip3009", Eip3009Payment, Parameters<typeof eip3009Status>[0], EvmReader>);
void (exactPermit2 satisfies Entry<"x402/exact/eip155/permit2", PaymentPayload, BreadthRef, EvmReader>);
void (uptoPermit2 satisfies Entry<"x402/upto/eip155/permit2", PaymentPayload, BreadthRef, EvmReader>);
void (exactErc7710 satisfies Entry<"x402/exact/eip155/erc7710", PaymentPayload, EvmRef, never>);
void (exactErc7710Salt satisfies Entry<"x402/exact/eip155/erc7710-salt", PaymentPayload, BreadthRef, EvmReader>);
void (authCaptureEip3009 satisfies Entry<"x402/auth-capture/eip155/eip3009", PaymentPayload, BreadthRef, EvmReader>);
void (authCapturePermit2 satisfies Entry<"x402/auth-capture/eip155/permit2", PaymentPayload, BreadthRef, EvmReader>);
void (batchEvm satisfies Entry<"x402/batch-settlement/eip155", BatchPaymentPayload, BreadthRef, EvmReader>);
void (batchSvm satisfies Entry<"x402/batch-settlement/solana", BatchPaymentPayload, SvmRef & { transaction: string }, SvmReader>);
void (batchCloudflare satisfies Entry<"x402/batch-settlement/cloudflare", CloudflarePaymentPayload, never, never>);
void (exactAvm satisfies Entry<"x402/exact/algorand", AvmPaymentPayload, AvmRef, AvmReader>);
void (exactAptos satisfies Entry<"x402/exact/aptos", AptosPaymentPayload, AptosRef, AptosReader>);
void (exactCardano satisfies Entry<"x402/exact/cardano", CardanoPaymentPayload, CardanoRef, CardanoReader>);
void (exactCasper satisfies Entry<"x402/exact/casper", CasperPaymentPayload, CasperRef & { transaction: string; h: AtrHash }, CasperReader>);
void (exactCcd satisfies Entry<"x402/exact/ccd", CcdPaymentPayload, CcdRef & { transaction: string; h: AtrHash }, CcdReader>);
void (exactHedera satisfies Entry<"x402/exact/hedera", HederaPaymentPayload, HederaRef, HederaReader>);
void (exactHederaExecutor satisfies Entry<"x402/exact/hedera/transfer-executor", ExecutorPaymentPayload, ExecutorRef & { transaction: string }, HederaReader>);
void (exactNear satisfies Entry<"x402/exact/near", NearPayment, NearRef & { transaction: string }, NearReader>);
void (exactPolkadotRemark satisfies Entry<"x402/exact/polkadot/lcp-assets-remark", PolkadotPaymentPayload, PolkadotRef & { h: AtrHash; transaction: string }, PolkadotReader>);
void (exactSvm satisfies Entry<"x402/exact/solana", SvmPaymentPayload, SvmRef & { transaction: string }, SvmReader>);
void (uptoSvm satisfies Entry<"x402/upto/solana", UptoSvmPaymentPayload, SvmRef & { transaction: string }, SvmReader>);
void (exactStarknet satisfies Entry<"x402/exact/starknet", StarknetPayment, StarknetRef & { transaction: Felt }, StarknetReader>);
void (exactSui satisfies Entry<"x402/exact/sui", SuiPaymentPayload, SuiRef & { h: AtrHash }, SuiReader>);
void (exactTronMemo satisfies Entry<"x402/exact/tron/lcp-trc20-memo", TronPayment, TronRef, TronReader>);
void (exactTvm satisfies Entry<"x402/exact/tvm", TvmPayment, TvmRef, TvmReader>);
void (exactXrpl satisfies Entry<"x402/exact/xrpl", XrplPaymentPayload, XrplRef, XrplReader>);
void (evmAuthorization satisfies Entry<"mpp/charge/evm/authorization", MppCredential, BreadthRef, EvmReader>);
void (evmPermit2 satisfies Entry<"mpp/charge/evm/permit2", MppCredential, BreadthRef, EvmReader>);
void (evmTransaction satisfies Entry<"mpp/charge/evm/transaction", MppCredential, EvmRef & { transaction: Hex; asset: Hex }, EvmReader>);
void (evmHash satisfies Entry<"mpp/charge/evm/hash", MppCredential, EvmRef & { transaction: Hex; asset: Hex }, EvmReader>);
void (sessionEvm satisfies Entry<"mpp/session/evm", MppCredential, SessionRef & { transaction: Hex }, EvmReader>);
void (sessionTempo satisfies Entry<"mpp/session/tempo", MppCredential, SessionRef & { transaction: Hex }, EvmReader>);
void (subscriptionTempo satisfies Entry<"mpp/subscription/tempo", MppCredential, SessionRef & { transaction: Hex }, EvmReader>);
void (chargeLightning satisfies Entry<"mpp/charge/lightning", MppCredential, LnRef, never>);
void (sessionLightning satisfies Entry<"mpp/session/lightning", MppCredential, LnRef, never>);
void (chargeSolana satisfies Entry<"mpp/charge/solana", MppCredential, SvmRef & { transaction: string }, SvmReader>);
void (chargeXrpl satisfies Entry<"mpp/charge/xrpl", MppCredential, XrplRef, XrplReader>);
void (chargeNearIntents satisfies Entry<"mpp/charge/nearintents", MppCredential, never, never>);
void (sessionXrpl satisfies Entry<"mpp/session/xrpl", MppCredential, Omit<XrplRef, "expect"> | XrplCloseRef, XrplReader>);
void (chargeCard satisfies Entry<"mpp/charge/card", MppCredential, never, never>);
void (chargeStripe satisfies Entry<"mpp/charge/stripe", MppCredential, never, never>);
void (subscriptionStripe satisfies Entry<"mpp/subscription/stripe", MppCredential, never, never>);
void (chargeUsdcEvm satisfies Entry<"mpp/charge/usdc/evm", MppCredential, BreadthRef, EvmReader>);
void (chargeUsdcSolana satisfies Entry<"mpp/charge/usdc/solana", MppCredential, SvmRef & { transaction: string }, SvmReader>);
void (chargeUsdcStacks satisfies Entry<"mpp/charge/usdc/stacks", MppCredential, StacksRef & { transaction: Hex; h: AtrHash }, StacksReader>);
void (chargeUsdcGateway satisfies Entry<"mpp/charge/usdc/gateway", MppCredential, never, never>);
void (paymentRequest satisfies Entry<"ack/payment-request", Json, never, never>);
void (delegated satisfies Entry<"acp/checkout/delegated", AcpPresented, never, never>);
void (undelegated satisfies Entry<"acp/checkout/undelegated", AcpPresented, never, never>);
void (checkoutMandate satisfies Entry<"ap2/checkout-mandate", Ap2Presented, never, never>);
void (visaTap satisfies Entry<"card/visa-tap", TapPresented, never, never>);
void (viImmediate satisfies Entry<"card/mastercard-vi/immediate", ViImmediate, never, never>);
void (viAutonomous satisfies Entry<"card/mastercard-vi/autonomous", ViAutonomous, never, never>);
void (sellerReference satisfies Entry<"card/seller-reference", never, never, never>);
void (ap2Mandate satisfies Entry<"ucp/checkout/ap2-mandate", Ap2Presented, never, never>);
void (unsigned satisfies Entry<"ucp/checkout/unsigned", Ap2Presented, never, never>);
void (bookingAp2Mandate satisfies Entry<"ucp/booking/ap2-mandate", Ap2Presented, never, never>);
void (bookingUnsigned satisfies Entry<"ucp/booking/unsigned", Ap2Presented, never, never>);

// ── Compile time: no codec satisfies Entry with another family's reader.

// @ts-expect-error -- an Algorand codec's `status` and `recover` take an Algorand reader, not a Sui one.
void (exactAvm satisfies Entry<"x402/exact/algorand", AvmPaymentPayload, AvmRef, SuiReader>);
// @ts-expect-error -- a Solana codec's `status` and `recover` take a Solana reader, not an XRPL one.
void (exactSvm satisfies Entry<"x402/exact/solana", SvmPaymentPayload, SvmRef & { transaction: string }, XrplReader>);
// @ts-expect-error -- an EVM codec's `status` takes an EVM reader, not a Stacks one.
void (chargeUsdcEvm satisfies Entry<"mpp/charge/usdc/evm", MppCredential, BreadthRef, StacksReader>);
// @ts-expect-error -- a TRON codec's `status` takes a TRON reader, not a TON one.
void (exactTronMemo satisfies Entry<"x402/exact/tron/lcp-trc20-memo", TronPayment, TronRef, TvmReader>);

// ── Compile time: a removed id is no PairingId.

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

// ── Run time.

const ENTRIES = rowsOf(BINDINGS, "BINDINGS", { exact: 58 });
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
    const named = ENTRIES.map((b) => b.data.agreementOn).filter((a) => a !== undefined && a !== "any" && a !== "same-network");
    for (const a of named) expect(IDS.has(a!), a).toBe(true);
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
    const mpp = rowsOf(ENTRIES.filter((b) => b.id.startsWith("mpp/")), "the MPP entries", { exact: 20 });
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
