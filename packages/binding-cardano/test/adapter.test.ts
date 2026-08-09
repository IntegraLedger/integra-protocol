import { describe, expect, it } from "vitest";
import {
  type CardanoReader,
  type CardanoTxView,
  createCardanoAdapter,
  recoverAtrHashFromTx,
  recoverAtrHashFromTxView,
} from "../src/adapter.js";
import { LCP_METADATA_LABEL, LCP_SPEC_VERSION } from "../src/constants.js";
import { CARDANO_MANIFEST } from "../src/manifest.js";
import type { BlockfrostMetadataEntry } from "../src/metadata.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const ATR_BARE = ATR.slice(2);
const OTHER =
  "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const OTHER_BARE = OTHER.slice(2);

function lcpEntry(bareHash: string): BlockfrostMetadataEntry {
  return {
    label: String(LCP_METADATA_LABEL),
    json_metadata: { v: LCP_SPEC_VERSION, atrHash: bareHash },
  };
}

describe("propose", () => {
  const adapter = createCardanoAdapter(CARDANO_MANIFEST);
  it("builds the LCP metadatum (label + JSON value + canonical CBOR)", () => {
    const m = adapter.propose(ATR);
    expect(m.label).toBe(LCP_METADATA_LABEL);
    expect(m.value).toEqual({ v: LCP_SPEC_VERSION, atrHash: ATR_BARE });
    // The CBOR round-trips the atrHash back out of the value it carries.
    expect(recoverAtrHashFromTx([lcpEntry(m.value.atrHash)])).toBe(ATR);
  });
  it("stamps a caller-supplied lcp version", () => {
    expect(adapter.propose(ATR, "9.9.9").value.v).toBe("9.9.9");
  });
  it("fails loud on a malformed atrHash", () => {
    expect(() => adapter.propose("0xdead")).toThrow(/32-byte/);
  });
});

describe("recoverAtrHashFromTx", () => {
  it("finds the LCP-label entry among unrelated metadata", () => {
    const md: BlockfrostMetadataEntry[] = [
      { label: "721", json_metadata: { name: "an NFT" } },
      lcpEntry(ATR_BARE),
    ];
    expect(recoverAtrHashFromTx(md)).toBe(ATR);
  });
  it("returns null when no LCP-label metadata carries an atrHash", () => {
    expect(recoverAtrHashFromTx([])).toBeNull();
    expect(
      recoverAtrHashFromTx([{ label: "674", json_metadata: { msg: ["hi"] } }]),
    ).toBeNull();
  });
});

/**
 * ★ THE PHASE-2 GATE. A Cardano transaction that fails PHASE-2 (Plutus script) validation lands ON-CHAIN:
 * its collateral is consumed and its intended outputs are never produced — no funds reach the seller. Its
 * auxiliary data is part of the transaction body, so the LCP-label metadata stays readable and the label
 * index still lists it. Blockfrost reports the discriminator as `valid_contract: false`. Phase-1 failures
 * never enter a block, so they need no gate; phase-2 failures do.
 */
describe("recoverAtrHashFromTxView (the phase-2 gate)", () => {
  const settled: CardanoTxView = {
    metadata: [lcpEntry(ATR_BARE)],
    validContract: true,
  };

  it("recovers from a phase-2-valid transaction", () => {
    expect(recoverAtrHashFromTxView(settled)).toBe(ATR);
  });

  it("a phase-2-FAILED transaction's metadata is NOT a weld", () => {
    // Collateral consumed, outputs never produced — the seller was paid nothing, yet the metadata
    // (and the label index entry) survive on-chain. Mirrors binding-solana's err gate.
    expect(
      recoverAtrHashFromTxView({
        metadata: [lcpEntry(ATR_BARE)],
        validContract: false,
      }),
    ).toBeNull();
  });

  it("an ABSENT validContract is not evidence of success — fail closed", () => {
    expect(
      recoverAtrHashFromTxView({ metadata: [lcpEntry(ATR_BARE)] }),
    ).toBeNull();
  });

  it("a null view (unknown tx) recovers nothing", () => {
    expect(recoverAtrHashFromTxView(null)).toBeNull();
  });
});

describe("createCardanoAdapter", () => {
  const adapter = createCardanoAdapter(CARDANO_MANIFEST);

  function reader(
    viewsByTx: Record<string, CardanoTxView>,
    labelIndex: string[] = [],
  ): CardanoReader {
    return {
      async txView(txHash: string): Promise<CardanoTxView | null> {
        return viewsByTx[txHash] ?? null;
      },
      async txsWithLabel(_label: number, _limit?: number): Promise<string[]> {
        return labelIndex;
      },
    };
  }

  /** A phase-2-valid transaction carrying the given metadata entries. */
  function valid(...metadata: BlockfrostMetadataEntry[]): CardanoTxView {
    return { metadata, validContract: true };
  }

  it("recover returns the welded atrHash", async () => {
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: valid(lcpEntry(ATR_BARE)) }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("recover refuses (verification-failure) when no LCP metadata is present", async () => {
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: valid() }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "cardano/no-atr-metadata",
    });
  });

  it("recover REFUSES a phase-2-failed transaction carrying valid LCP metadata", async () => {
    // The strongest failure this binding can misreport: the weld metadata is present and well-formed,
    // but the script failed — collateral consumed, no outputs, the seller paid nothing. Reporting it
    // settled would mint a settlement record out of a failure.
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({
        tx1: { metadata: [lcpEntry(ATR_BARE)], validContract: false },
      }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "cardano/unsuccessful-transaction",
    });
  });

  it("recover refuses a transaction the indexer does not have — absence is not failure", async () => {
    const r = await adapter.recover({ txHash: "tx-absent" }, reader({}));
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "cardano/no-such-transaction",
    });
  });

  it("observe reports the settled transition", async () => {
    const o = await adapter.observe(
      { txHash: "tx1" },
      reader({ tx1: valid(lcpEntry(ATR_BARE)) }),
    );
    expect(o).toEqual({ ok: true, value: { state: "settled", atrHash: ATR } });
  });

  it("observe PROPAGATES the refusal — it never reports a settlement that is not there", async () => {
    // Without the forward, observe answers `{state: "settled", atrHash: undefined}` for a tx that
    // carries no LCP-label metadata at all.
    const o = await adapter.observe(
      { txHash: "tx1" },
      reader({ tx1: valid() }),
    );
    expect(o).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "cardano/no-atr-metadata",
    });
  });

  it("observe never reports settled off a phase-2-failed transaction", async () => {
    const o = await adapter.observe(
      { txHash: "tx1" },
      reader({ tx1: { metadata: [lcpEntry(ATR_BARE)], validContract: false } }),
    );
    expect("ok" in o).toBe(false);
    if (!("refused" in o)) throw new Error("expected a refusal");
    expect(o.refused).toBe(true);
  });

  it("enumerate uses the label index and returns only atrHash matches", async () => {
    const rdr = reader(
      {
        tx1: valid(lcpEntry(ATR_BARE)),
        tx2: valid(lcpEntry(OTHER_BARE)),
        tx3: valid(lcpEntry(ATR_BARE)),
      },
      ["tx1", "tx2", "tx3"],
    );
    const hits = await adapter.enumerate(ATR, rdr);
    expect(hits.map((h) => h.txHash)).toEqual(["tx1", "tx3"]);
  });

  it("enumerate SKIPS phase-2-failed transactions the label index still lists", async () => {
    // The metadata-label index is the manifest's declared forward index (forwardIndexable: true) — it
    // indexes the metadata, not the outcome, so failed transactions come back from it.
    const rdr = reader(
      {
        tx1: valid(lcpEntry(ATR_BARE)),
        tx2: { metadata: [lcpEntry(ATR_BARE)], validContract: false },
      },
      ["tx1", "tx2"],
    );
    const hits = await adapter.enumerate(ATR, rdr);
    expect(hits.map((h) => h.txHash)).toEqual(["tx1"]);
  });

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() =>
      createCardanoAdapter({ ...CARDANO_MANIFEST, rail: "solana" }),
    ).toThrow('manifest.rail "solana" is not "cardano"');
  });

  it("enumerate throws on a malformed atrHash — a silent [] is not an answer", async () => {
    await expect(adapter.enumerate("not-a-hash", reader({}))).rejects.toThrow(
      "enumerate: atrHash must be a 0x-prefixed 32-byte value",
    );
  });
});
