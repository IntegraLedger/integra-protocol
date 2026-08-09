/**
 * Live Cardano (Blockfrost) integration for the LCP-metadata binding. OPT-IN — it runs ONLY when a
 * Blockfrost project id is supplied via `BLOCKFROST_PROJECT_ID` AND a `CARDANO_LCP_TX_HASH`
 * that points at a confirmed transaction already carrying the LCP metadata label; otherwise it is skipped
 * LOUD (never faked). It proves the recover path end-to-end against a REAL indexer: build a `CardanoReader`
 * over Blockfrost's HTTP API → `adapter.recover` reads the label-8847 metadata back → the recovered atrHash
 * matches `CARDANO_LCP_ATR_HASH`.
 *
 * The propose/submit leg (signing + submitting an ADA transfer that CARRIES the label) needs the full
 * chain-cardano tx-builder (CBOR tx body + Ed25519 + UTxO selection) — integration-only, off this
 * protocol package's critical path. The recover leg IS the LCP weld's verification, so that is what a
 * keyless-until-provided integration proves. `BLOCKFROST_PROJECT_ID` is env-network-prefixed by Blockfrost
 * itself (`preprod...`/`mainnet...`); this test derives the network from `CARDANO_NETWORK` (default preprod).
 */
import { describe, expect, it } from "vitest";
import {
  type CardanoReader,
  type CardanoTxView,
  createCardanoAdapter,
} from "../src/adapter.js";
import {
  type CardanoNetwork,
  getCardanoConfig,
  LCP_METADATA_LABEL,
} from "../src/constants.js";
import { CARDANO_MANIFEST } from "../src/manifest.js";
import type { BlockfrostMetadataEntry } from "../src/metadata.js";

const PROJECT_ID = process.env["BLOCKFROST_PROJECT_ID"];
const TX_HASH = process.env["CARDANO_LCP_TX_HASH"];
const EXPECTED_ATR = process.env["CARDANO_LCP_ATR_HASH"];
const NETWORK = (process.env["CARDANO_NETWORK"] ?? "preprod") as CardanoNetwork;

const enabled = Boolean(PROJECT_ID && TX_HASH && EXPECTED_ATR);
const suite = enabled ? describe : describe.skip;

/** A minimal Blockfrost-backed CardanoReader (HTTP only, no SDK) — integration-only. */
function makeBlockfrostReader(
  projectId: string,
  network: CardanoNetwork,
): CardanoReader {
  const base = getCardanoConfig(network).blockfrostUrl;
  const headers = { project_id: projectId };
  return {
    async txView(txHash: string): Promise<CardanoTxView | null> {
      // Two calls: the metadata, and `/txs/{hash}` for `valid_contract` — a phase-2-failed transaction
      // keeps its metadata on-chain, so validity is the fact that decides whether this is a settlement.
      const [mdRes, txRes] = await Promise.all([
        fetch(`${base}/txs/${txHash}/metadata`, { headers }),
        fetch(`${base}/txs/${txHash}`, { headers }),
      ]);
      if (mdRes.status === 404 || txRes.status === 404) return null;
      if (!mdRes.ok)
        throw new Error(`Blockfrost /txs/${txHash}/metadata → ${mdRes.status}`);
      if (!txRes.ok)
        throw new Error(`Blockfrost /txs/${txHash} → ${txRes.status}`);
      const { valid_contract } = (await txRes.json()) as {
        valid_contract: boolean;
      };
      return {
        metadata: (await mdRes.json()) as BlockfrostMetadataEntry[],
        validContract: valid_contract,
      };
    },
    async txsWithLabel(label: number, limit?: number): Promise<string[]> {
      const count = limit ?? 100;
      const res = await fetch(
        `${base}/metadata/txs/labels/${label}?count=${count}&order=desc`,
        { headers },
      );
      if (!res.ok)
        throw new Error(
          `Blockfrost /metadata/txs/labels/${label} → ${res.status}`,
        );
      const rows = (await res.json()) as { tx_hash: string }[];
      return rows.map((r) => r.tx_hash);
    },
  };
}

suite(
  "binding-cardano — live Blockfrost (BLOCKFROST_PROJECT_ID + CARDANO_LCP_TX_HASH set)",
  () => {
    it(`recovers the atrHash from label-${LCP_METADATA_LABEL} metadata on a real tx`, async () => {
      const reader = makeBlockfrostReader(PROJECT_ID ?? "", NETWORK);
      const adapter = createCardanoAdapter(CARDANO_MANIFEST);
      const recovered = await adapter.recover(
        { txHash: TX_HASH ?? "" },
        reader,
      );
      expect("refused" in recovered).toBe(false);
      if (!("refused" in recovered))
        expect(recovered.value).toBe((EXPECTED_ATR ?? "").toLowerCase());
    }, 60_000);
  },
);
