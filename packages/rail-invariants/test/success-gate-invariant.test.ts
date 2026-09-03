/**
 * THE CROSS-RAIL SUCCESS-GATE INVARIANT.
 *
 * One rule, asserted for every rail at once: **a weld that is present and well-formed, on a transaction
 * that did not succeed, must never be recoverable.** A rail that breaks it mints a settlement record out
 * of a failure — the transaction is confirmed, its fee is charged, nothing moved — which costs an attacker
 * no payment at all and is the strongest misreport a binding can make.
 *
 * ★ WHY THIS FILE EXISTS. The 2026-08-03 sweep found that failure live on stellar (`verify` returned
 * `confirmed: true`, `observe` returned `state: "settled"`) and cardano (a phase-2-failed transaction
 * recovered its atrHash and stayed in the label index), and found the aptos gate sitting in the SDK mapper
 * where a custom reader bypassed it. All three were found by hand-reading eight adapters. Nothing in the
 * repo would have caught them, and nothing stopped rail #13 from shipping the same defect. This suite is
 * that missing machinery: the sweep fixed the instances, this keeps the CLASS fixed.
 *
 * ★ HOW IT BINDS A NEW RAIL. `BindingManifest.successGate` is required, so a new rail must declare how it
 * knows a settlement happened. If it declares `"raw-field"` it MUST appear in `PROBES` below — the two
 * membership assertions compare the declared set against the registered set in BOTH directions, so a
 * missing probe fails and a stale one does too. A rail cannot quietly opt out.
 *
 * ★ WHAT THIS CANNOT DO. `"structural"` is a claim about the RAIL (a reverted EVM tx emits no logs, an
 * aborted Sui PTB discards its events, a Daml command that did not commit leaves no contract), so there is
 * no failed view to construct and no runtime probe that could falsify it. Declaring `"structural"` falsely
 * would dodge the probe requirement, and only review catches that — but the claim is now PUBLISHED in the
 * profile vector rather than living in one package's head comment, which is where it lived until today.
 *
 * The ports are deliberately heterogeneous (`SolanaTxView`, `XrplPaymentView`, `CardanoTxView` share no
 * shape — forcing one port across EVM and non-EVM rails would misrepresent the rails), so each probe does
 * rail-native work behind a uniform `() => Promise<boolean>`. The registry is the point, not the shape.
 */
import {
  APTOS_MANIFEST,
  type AptosReader,
  type AptosTxView,
  createAptosAdapter,
  getAptosConfig,
  paymentSettledEventType,
} from "@integraledger/lcp-binding-aptos";
import { CANTON_MANIFEST } from "@integraledger/lcp-binding-canton";
import { CANTON_X402_MANIFEST } from "@integraledger/lcp-binding-canton-x402";
import {
  CARDANO_MANIFEST,
  type CardanoReader,
  type CardanoTxView,
  createCardanoAdapter,
  LCP_METADATA_LABEL,
  LCP_SPEC_VERSION,
} from "@integraledger/lcp-binding-cardano";
import type { BindingManifest } from "@integraledger/lcp-binding-core";
import { ESCROW_MANIFEST } from "@integraledger/lcp-binding-evm-escrow";
import { MPP_EVM_MANIFEST } from "@integraledger/lcp-binding-evm-mpp";
import { X402_MANIFEST } from "@integraledger/lcp-binding-evm-x402";
import {
  createHederaAdapter,
  HEDERA_MANIFEST,
  type HederaReader,
  type HederaTxView,
} from "@integraledger/lcp-binding-hedera";
import {
  createSolanaAdapter,
  MEMO_PROGRAM_ID,
  SOLANA_MANIFEST,
  type SolanaReader,
  type SolanaTxView,
} from "@integraledger/lcp-binding-solana";
import {
  buildMuxedDestination,
  createStellarAdapter,
  STELLAR_MANIFEST,
  type StellarReader,
  type StellarSettlementView,
} from "@integraledger/lcp-binding-stellar";
import { SUI_MANIFEST } from "@integraledger/lcp-binding-sui";
import { TEMPO_MPP_MANIFEST } from "@integraledger/lcp-binding-tempo-mpp";
import {
  createXrplAdapter,
  encodeInvoiceId,
  XRPL_MANIFEST,
  type XrplPaymentView,
  type XrplReader,
} from "@integraledger/lcp-binding-xrpl";
import { describe, expect, it } from "vitest";

/** A real 32-byte atrHash. Every probe welds THIS — the point is that a VALID weld is still refused. */
const ATR = `0x${"ab".repeat(32)}`;
const G_PUBKEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

/**
 * Every shipped binding manifest. A new rail that is not listed here fails `every rail is registered`
 * below — the manifest count is pinned so adding a package without adding it here cannot pass.
 */
const MANIFESTS: ReadonlyArray<readonly [string, BindingManifest]> = [
  ["aptos", APTOS_MANIFEST],
  ["canton", CANTON_MANIFEST],
  ["canton:x402", CANTON_X402_MANIFEST],
  ["cardano", CARDANO_MANIFEST],
  ["evm:escrow", ESCROW_MANIFEST],
  ["evm:mpp", MPP_EVM_MANIFEST],
  ["evm:x402", X402_MANIFEST],
  ["hedera", HEDERA_MANIFEST],
  ["solana", SOLANA_MANIFEST],
  ["stellar", STELLAR_MANIFEST],
  ["sui", SUI_MANIFEST],
  ["tempo:mpp", TEMPO_MPP_MANIFEST],
  ["xrpl", XRPL_MANIFEST],
];

/**
 * A probe attempts recovery through the rail's REAL adapter surface (not just its pure helper) against a
 * transaction carrying a valid weld, and answers whether the rail refused.
 *
 * `failed` — the chain reported an explicit failure.
 * `absent` — the reader reported NO outcome at all. Absent is not evidence of success, and this arm is the
 *   one that catches a gate written as `if (x === false) refuse` instead of `if (x !== true) refuse`.
 */
type GateProbe = {
  failed: () => Promise<boolean>;
  absent: () => Promise<boolean>;
};

/** A port implementation returning one scripted view — the real behaviour is proven in each package. */
const solanaReader = (view: SolanaTxView): SolanaReader => ({
  async txView() {
    return view;
  },
  async signaturesFor() {
    return [];
  },
});
const xrplReader = (view: XrplPaymentView): XrplReader => ({
  async paymentView() {
    return view;
  },
  async paymentHashesFor() {
    return [];
  },
});
const hederaReader = (view: HederaTxView): HederaReader => ({
  async txView() {
    return view;
  },
  async transactionsFor() {
    return [];
  },
});
const aptosReader = (view: AptosTxView): AptosReader => ({
  async txView() {
    return view;
  },
});
const cardanoReader = (view: CardanoTxView): CardanoReader => ({
  async txView() {
    return view;
  },
  async txsWithLabel() {
    return [];
  },
});
const stellarReader = (view: StellarSettlementView): StellarReader => ({
  async settlementView() {
    return view;
  },
  async transactionsFor() {
    return [];
  },
});

const refused = (o: object): boolean => "refused" in o;

const SOLANA_MEMO = { programId: MEMO_PROGRAM_ID, memoUtf8: ATR };
const APTOS_MODULE = getAptosConfig("testnet").lcpModuleAddress;
const APTOS_EVENT = {
  eventType: paymentSettledEventType(APTOS_MODULE),
  paymentId: ATR,
};
const CARDANO_ENTRY = {
  label: String(LCP_METADATA_LABEL),
  json_metadata: { v: LCP_SPEC_VERSION, atrHash: ATR.slice(2) },
};
const MUXED = buildMuxedDestination(ATR, G_PUBKEY);

/** Every rail whose manifest declares `successGate: "raw-field"` must appear here. */
const PROBES: Readonly<Record<string, GateProbe>> = {
  solana: {
    failed: async () =>
      refused(
        await createSolanaAdapter(SOLANA_MANIFEST).recover(
          { signature: "sig" },
          solanaReader({
            memos: [SOLANA_MEMO],
            err: { InstructionError: [0, { Custom: 1 }] },
          }),
        ),
      ),
    absent: async () =>
      refused(
        await createSolanaAdapter(SOLANA_MANIFEST).recover(
          { signature: "sig" },
          solanaReader({ memos: [SOLANA_MEMO] }),
        ),
      ),
  },
  xrpl: {
    // Probes the CURRENT carrier. The weld moved from Memos to InvoiceID on 2026-08-08 — x402's
    // exact-XRPL scheme makes a facilitator reject any memo-bearing transaction — so a probe still built
    // on a memo would be testing the read-only legacy branch and would pass even if the live path broke.
    failed: async () =>
      refused(
        await createXrplAdapter(XRPL_MANIFEST).recover(
          { txHash: "tx" },
          xrplReader({
            invoiceId: encodeInvoiceId(ATR),
            memos: undefined,
            validated: true,
            engineResult: "tecPATH_DRY",
          }),
        ),
      ),
    absent: async () =>
      refused(
        await createXrplAdapter(XRPL_MANIFEST).recover(
          { txHash: "tx" },
          xrplReader({
            invoiceId: encodeInvoiceId(ATR),
            memos: undefined,
            validated: true,
            engineResult: undefined,
          }),
        ),
      ),
  },
  hedera: {
    failed: async () =>
      refused(
        await createHederaAdapter(HEDERA_MANIFEST).recover(
          { transactionId: "tx" },
          hederaReader({
            memo: createHederaAdapter(HEDERA_MANIFEST).propose(ATR),
            result: "INSUFFICIENT_ACCOUNT_BALANCE",
          }),
        ),
      ),
    absent: async () =>
      refused(
        await createHederaAdapter(HEDERA_MANIFEST).recover(
          { transactionId: "tx" },
          hederaReader({
            memo: createHederaAdapter(HEDERA_MANIFEST).propose(ATR),
          }),
        ),
      ),
  },
  aptos: {
    failed: async () =>
      refused(
        await createAptosAdapter(APTOS_MANIFEST, "testnet").recover(
          { hash: "tx" },
          aptosReader({
            events: [APTOS_EVENT],
            success: false,
            vmStatus: "Move abort",
          }),
        ),
      ),
    absent: async () =>
      refused(
        await createAptosAdapter(APTOS_MANIFEST, "testnet").recover(
          { hash: "tx" },
          aptosReader({ events: [APTOS_EVENT] }),
        ),
      ),
  },
  cardano: {
    failed: async () =>
      refused(
        await createCardanoAdapter(CARDANO_MANIFEST).recover(
          { txHash: "tx" },
          cardanoReader({ metadata: [CARDANO_ENTRY], validContract: false }),
        ),
      ),
    absent: async () =>
      refused(
        await createCardanoAdapter(CARDANO_MANIFEST).recover(
          { txHash: "tx" },
          cardanoReader({ metadata: [CARDANO_ENTRY] }),
        ),
      ),
  },
  // Stellar is confirm-not-recover, so the probe drives `verify` with the CORRECT atrHash — the prefix-8
  // match succeeds and only the success gate stands between a failed transaction and `confirmed: true`.
  stellar: {
    failed: async () =>
      refused(
        await createStellarAdapter(STELLAR_MANIFEST).verify(
          ATR,
          { txHash: "tx" },
          stellarReader({ muxedDestination: MUXED, successful: false }),
        ),
      ),
    absent: async () =>
      refused(
        await createStellarAdapter(STELLAR_MANIFEST).verify(
          ATR,
          { txHash: "tx" },
          stellarReader({ muxedDestination: MUXED }),
        ),
      ),
  },
};

describe("the success-gate invariant, across every rail", () => {
  it("every shipped binding manifest is registered here", () => {
    // Pinned so a new binding package cannot be added without being brought under this invariant.
    // 12 -> 13 on 2026-08-08: the second Canton rail (see recovery-triple-invariant).
    expect(MANIFESTS.length).toBe(13);
    expect(MANIFESTS.map(([r]) => r)).toEqual(
      MANIFESTS.map(([, m]) => m.rail).sort(),
    );
  });

  it("every rail DECLARES how it knows a settlement happened", () => {
    for (const [name, m] of MANIFESTS)
      expect(
        ["raw-field", "structural"].includes(m.successGate),
        `${name} declares successGate`,
      ).toBe(true);
  });

  it("the declared raw-field rails and the registered probes are the SAME set", () => {
    // Both directions. A rail that declares raw-field without a probe fails; a probe left behind for a
    // rail that moved to structural fails too. This is the assertion that binds rail #13.
    const declared = MANIFESTS.filter(
      ([, m]) => m.successGate === "raw-field",
    ).map(([r]) => r);
    expect(declared.sort()).toEqual(Object.keys(PROBES).sort());
  });

  for (const [rail, probe] of Object.entries(PROBES)) {
    it(`${rail}: a valid weld on a FAILED transaction is refused`, async () => {
      expect(await probe.failed()).toBe(true);
    });

    it(`${rail}: a valid weld with the outcome ABSENT is refused`, async () => {
      expect(await probe.absent()).toBe(true);
    });
  }

  it("the structural rails carry no outcome field BY the rail's nature — declared, not probed", () => {
    // Recorded so the list is reviewable in one place: the rails below cannot produce a failed transaction
    // that still carries a weld, which is why no probe exists. The count is not restated — it is the length
    // of the array the assertion pins, and this comment said "six" over seven entries. See each package's
    // header for the mechanism.
    const structural = MANIFESTS.filter(
      ([, m]) => m.successGate === "structural",
    ).map(([r]) => r);
    expect(structural.sort()).toEqual([
      "canton",
      "canton:x402",
      "evm:escrow",
      "evm:mpp",
      "evm:x402",
      "sui",
      "tempo:mpp",
    ]);
  });
});
