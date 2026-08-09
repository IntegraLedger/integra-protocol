/**
 * The Cardano LCP-metadata adapter — thin I/O, PURE-TS (no chain SDK, no CBOR library). It intentionally
 * does NOT implement binding-core's `WeldAdapter`: that port is EVM-shaped (`SettlementRef.txHash` is a
 * `0x`-hex value, `ChainReader` speaks `eth_getLogs`), and Cardano speaks 64-hex tx hashes + transaction
 * metadata queried by label. Rather than lie through those types, this exposes a Cardano-native surface
 * (a tx-hash `CardanoSettlementRef`, a `CardanoReader` port over metadata + a label index) alongside the
 * shared, chain-agnostic `BindingManifest`. Unifying the port shape across EVM and non-EVM rails is future
 * work; forcing it here would misrepresent the rail.
 *
 * `propose` builds the LCP metadatum (JSON value + canonical-CBOR bytes) the buyer attaches under the
 * dedicated LCP label to their ADA-transfer transaction; `recover` reads the atrHash back from a confirmed
 * transaction's metadata; `observe` reports the settled transition; `enumerate` uses the metadata-label
 * index the manifest declares (`forwardIndexable: true`) to list settlements bearing a given atrHash.
 *
 * ★ RECOVERY GATES ON PHASE-2 VALIDITY (`CardanoTxView.validContract`). A transaction that fails phase-2
 * (Plutus script) validation lands ON-CHAIN — collateral consumed, intended outputs never produced, the
 * seller paid nothing — while its auxiliary data, being part of the transaction body, keeps the LCP
 * metadata readable AND keeps it in the label index. Phase-1 failures never enter a block, so the gate is
 * specifically about phase 2. The documented `propose` path is a script-free ADA transfer, which cannot
 * reach phase 2; the adapter cannot constrain what transaction a buyer attaches the metadatum to, so it
 * refuses rather than assumes.
 */
import type { BindingManifest, Outcome } from "@integraledger/lcp-binding-core";
import { atrHashEquals, isAtrHash } from "@integraledger/lcp-kernel";
import { LCP_METADATA_LABEL, LCP_SPEC_VERSION } from "./constants.js";
import {
  type BlockfrostMetadataEntry,
  buildLcpMetadataValue,
  encodeLcpMetadatum,
  type LcpMetadataValue,
  recoverAtrHashFromMetadata,
} from "./metadata.js";

/** A Cardano settlement reference — a 64-hex transaction hash. */
export interface CardanoSettlementRef {
  txHash: string;
}

/** The LCP metadatum a buyer attaches to their transaction: the JSON value + its canonical-CBOR bytes. */
export interface ProposedMetadatum {
  /** The dedicated LCP metadata label to place the value under. */
  label: number;
  /** The Blockfrost-shaped JSON value `{ v, atrHash }`. */
  value: LcpMetadataValue;
  /** The canonical-CBOR bytes of `value` (the on-chain `transaction_metadatum`). */
  cbor: Uint8Array;
}

/**
 * The minimal view of one confirmed transaction this binding cares about — its metadata plus whether the
 * transaction's scripts actually validated.
 */
export interface CardanoTxView {
  /** The tx-metadata array for a confirmed transaction (`GET /txs/{hash}/metadata`), or [] if none. */
  metadata: readonly BlockfrostMetadataEntry[];
  /**
   * Blockfrost's `valid_contract` (`GET /txs/{hash}`). ONLY `true` is a settlement: a transaction that
   * fails PHASE-2 (Plutus script) validation lands ON-CHAIN with its collateral consumed and its intended
   * outputs never produced — no funds reach the seller — yet its auxiliary data is part of the transaction
   * body, so the LCP metadata stays readable and the label index still lists it. Phase-1 failures never
   * enter a block and so need no gate. Fail-closed: `false` AND absent are both refused, because a reader
   * that supplied no outcome gave no evidence of success (mirrors binding-solana's `err === null` gate).
   */
  validContract?: boolean;
}

/**
 * Reads confirmed transactions and enumerates by the LCP label. An implementation wraps a Cardano indexer
 * (Blockfrost, db-sync, Koios, …) — integration-only; the protocol adapter takes it as a port so the pure
 * surface has no chain-SDK dependency.
 */
export interface CardanoReader {
  /** One confirmed transaction's view (metadata + `valid_contract`), or `null` if the indexer has none. */
  txView(txHash: string): Promise<CardanoTxView | null>;
  /** Tx hashes carrying the given metadata label (`GET /metadata/txs/labels/{label}`) — the forward index. */
  txsWithLabel(label: number, limit?: number): Promise<string[]>;
}

/** Recover the atrHash from a confirmed tx's metadata, or null if no LCP label carries a valid atrHash. */
export function recoverAtrHashFromTx(
  metadata: readonly BlockfrostMetadataEntry[],
): `0x${string}` | null {
  return recoverAtrHashFromMetadata(metadata, LCP_METADATA_LABEL);
}

/** Why a tx view yielded no settled weld — distinguished so `recover`/`observe` report WHY (mirrors
 *  binding-stellar): a transaction the indexer does not have is not a failed one, and a failed one is not
 *  missing metadata. One reading shared by every surface, so they cannot disagree about what a view means. */
export type CardanoSettlementReading =
  | { settled: true; atrHash: `0x${string}` }
  | {
      settled: false;
      reason:
        | "no-such-transaction"
        | "unsuccessful-transaction"
        | "no-atr-metadata";
    };

/**
 * Read a transaction view as a settlement. Pure. Fail-closed: a transaction whose scripts failed phase-2
 * consumed its collateral and produced no outputs — its metadata is not a weld — and a view with NO
 * `validContract` gave no evidence of success at all; both read `unsuccessful-transaction`.
 */
export function readTxView(
  view: CardanoTxView | null,
): CardanoSettlementReading {
  if (view === null) return { settled: false, reason: "no-such-transaction" };
  if (view.validContract !== true)
    return { settled: false, reason: "unsuccessful-transaction" };
  const atrHash = recoverAtrHashFromTx(view.metadata);
  if (atrHash === null) return { settled: false, reason: "no-atr-metadata" };
  return { settled: true, atrHash };
}

/** Recover the atrHash from a transaction view, or `null` if it is not a phase-2-valid settlement whose
 *  metadata carries one. The null-collapsing convenience over `readTxView` — the reasons live there. */
export function recoverAtrHashFromTxView(
  view: CardanoTxView | null,
): `0x${string}` | null {
  const reading = readTxView(view);
  return reading.settled ? reading.atrHash : null;
}

/** The Cardano rail's surface. `propose` returns a metadatum for you to attach under label 8847 — it does
 *  not build a transaction. `enumerate` is a NATIVE forward index rather than a scan — an indexer queries
 *  the label directly, which is what the manifest's `forwardIndexable: true` claims and why the label is
 *  dedicated rather than a CIP-20 piggyback. Two other rails declare it, both on a log topic. */
export interface CardanoAdapter {
  manifest: BindingManifest;
  /** Build the LCP metadatum (JSON value + canonical-CBOR) to attach under the LCP label. Throws on a malformed atrHash. */
  propose(atrHash: string, lcpVersion?: string): ProposedMetadatum;
  /** Recover the atrHash from a confirmed settlement, or a `verification-failure` Refusal if none binds. */
  recover(
    ref: CardanoSettlementRef,
    reader: CardanoReader,
  ): Promise<Outcome<`0x${string}`>>;
  /** Report the settled transition (the tx is confirmed and carries a valid LCP-label atrHash). */
  observe(
    ref: CardanoSettlementRef,
    reader: CardanoReader,
  ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>>;
  /** Metadata-label-index scan for settlements bearing `atrHash` (native forward index — see the manifest). */
  enumerate(
    atrHash: string,
    reader: CardanoReader,
    limit?: number,
  ): Promise<CardanoSettlementRef[]>;
}

/** Construct the Cardano adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `CARDANO_MANIFEST`; a manifest whose `rail` is not `"cardano"` throws, because an adapter over another
 *  rail's manifest would publish that rail's claims as its own. This is the package's entry point. */
export function createCardanoAdapter(
  manifest: BindingManifest,
): CardanoAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "cardano")
    throw new Error(
      `createCardanoAdapter: manifest.rail "${manifest.rail}" is not "cardano"`,
    );
  // Closure helper (not `this`) so the returned methods stay destructure-safe.
  /** Every refusal on this rail is a verification failure, namespaced `cardano/…` (mirrors binding-stellar,
   *  whose granularity is the model: `recover` and `observe` report WHY, because a failed transaction is
   *  not missing metadata and a transaction the indexer does not have is neither). */
  const refuse = (code: string, detail: string): Outcome<never> => ({
    refused: true,
    haltClass: "verification-failure",
    code: `cardano/${code}`,
    detail,
  });

  async function doRecover(
    ref: CardanoSettlementRef,
    reader: CardanoReader,
  ): Promise<Outcome<`0x${string}`>> {
    const reading = readTxView(await reader.txView(ref.txHash));
    if (reading.settled) return { ok: true, value: reading.atrHash };
    switch (reading.reason) {
      case "no-such-transaction":
        return refuse(
          "no-such-transaction",
          `the indexer has no confirmed transaction ${ref.txHash} — nothing settled there`,
        );
      case "unsuccessful-transaction":
        return refuse(
          "unsuccessful-transaction",
          `transaction ${ref.txHash} did not settle (phase-2-failed, or no valid_contract at all) — its metadata is not a weld`,
        );
      case "no-atr-metadata":
        return refuse(
          "no-atr-metadata",
          `no LCP-label (${LCP_METADATA_LABEL}) atrHash metadata on phase-2-valid transaction ${ref.txHash}`,
        );
    }
  }

  return {
    manifest,

    propose(
      atrHash: string,
      lcpVersion: string = LCP_SPEC_VERSION,
    ): ProposedMetadatum {
      const value = buildLcpMetadataValue(atrHash, lcpVersion);
      return {
        label: LCP_METADATA_LABEL,
        value,
        cbor: encodeLcpMetadatum(value),
      };
    },

    recover(
      ref: CardanoSettlementRef,
      reader: CardanoReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: CardanoSettlementRef,
      reader: CardanoReader,
    ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>> {
      const rec = await doRecover(ref, reader);
      if ("refused" in rec) return rec;
      return { ok: true, value: { state: "settled", atrHash: rec.value } };
    },

    async enumerate(
      atrHash: string,
      reader: CardanoReader,
      limit?: number,
    ): Promise<CardanoSettlementRef[]> {
      // Fail-fast, like propose: a malformed atrHash can never match a decoded metadatum, and the silent
      // [] it would produce is indistinguishable from "no settlements" (mirrors buildLcpMetadataValue's
      // loud refusal).
      if (!isAtrHash(atrHash))
        throw new Error(
          `enumerate: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"`,
        );
      const txHashes = await reader.txsWithLabel(LCP_METADATA_LABEL, limit);
      const out: CardanoSettlementRef[] = [];
      for (const txHash of txHashes) {
        // The label index indexes the METADATA, not the outcome — phase-2-failed transactions come back
        // from it, so the per-tx gate is what keeps them out of the result set.
        const atr = recoverAtrHashFromTxView(await reader.txView(txHash));
        if (atr !== null && atrHashEquals(atr, atrHash)) out.push({ txHash });
      }
      return out;
    },
  };
}
