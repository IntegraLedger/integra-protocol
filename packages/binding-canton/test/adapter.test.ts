import { describe, expect, it } from "vitest";
import {
  type CantonParticipantReader,
  createCantonAdapter,
  type LcpAnchorContract,
  recoverAtrHashFromAnchors,
} from "../src/adapter.js";
import type { LcpAnchorPayload } from "../src/anchor.js";
import { CANTON_MANIFEST } from "../src/manifest.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const ATR_TEXT =
  "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER_TEXT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const PKG = "1220deadbeef";

function payload(atrHashText: string): LcpAnchorPayload {
  return {
    buyer: "Buyer::1220abc",
    seller: "Seller::1220def",
    atrHash: atrHashText,
    paymentRef: "",
  };
}

function contract(contractId: string, atrHashText: string): LcpAnchorContract {
  return {
    contractId,
    templateId: `${PKG}:Main:LcpAnchor`,
    payload: payload(atrHashText),
  };
}

describe("propose", () => {
  const adapter = createCantonAdapter(CANTON_MANIFEST);

  it("builds a create-LcpAnchor command with the fully-qualified templateId and the atrHash Text field", () => {
    const cmd = adapter.propose({
      packageId: PKG,
      buyer: "Buyer::1220abc",
      seller: "Seller::1220def",
      atrHash: ATR,
    });
    expect(cmd.templateId).toBe(`${PKG}:Main:LcpAnchor`);
    expect(cmd.payload.atrHash).toBe(ATR_TEXT);
    expect(cmd.payload.buyer).toBe("Buyer::1220abc");
    expect(cmd.payload.seller).toBe("Seller::1220def");
    // An absent paymentRef becomes "", never `undefined` — the Daml Text field has no null.
    expect(cmd.payload.paymentRef).toBe("");
  });

  it("carries a supplied paymentRef onto the contract payload", () => {
    const cmd = adapter.propose({
      packageId: PKG,
      buyer: "Buyer::1220abc",
      seller: "Seller::1220def",
      atrHash: ATR,
      paymentRef: "invoice-42",
    });
    expect(cmd.payload.paymentRef).toBe("invoice-42");
  });

  it("fails loud when no package id is given (the DAR hash is deployment-specific)", () => {
    expect(() =>
      adapter.propose({
        packageId: "",
        buyer: "B",
        seller: "S",
        atrHash: ATR,
      }),
    ).toThrow(/packageId is empty/);
  });

  it("fails loud on a malformed atrHash (never mint a rejectable anchor)", () => {
    expect(() =>
      adapter.propose({
        packageId: PKG,
        buyer: "B",
        seller: "S",
        atrHash: "0xdead",
      }),
    ).toThrow(/32-byte/);
  });
});

describe("recoverAtrHashFromAnchors", () => {
  it("finds the first anchor carrying a well-formed atrHash", () => {
    expect(
      recoverAtrHashFromAnchors([
        contract("c-bad", "not-an-atr"),
        contract("c-good", ATR_TEXT),
      ]),
    ).toBe(ATR);
  });
  it("returns null when no anchor carries an atrHash", () => {
    expect(recoverAtrHashFromAnchors([contract("c1", "garbage")])).toBeNull();
  });
});

describe("createCantonAdapter", () => {
  const adapter = createCantonAdapter(CANTON_MANIFEST);

  function reader(
    byId: Record<string, LcpAnchorContract>,
    byAtr: Record<string, LcpAnchorContract[]> = {},
  ): CantonParticipantReader {
    return {
      async fetchByContractId(
        contractId: string,
      ): Promise<LcpAnchorContract | null> {
        return byId[contractId] ?? null;
      },
      async queryByAtrHash(atrHashText: string): Promise<LcpAnchorContract[]> {
        return byAtr[atrHashText] ?? [];
      },
    };
  }

  it("recover returns the anchored atrHash", async () => {
    const r = await adapter.recover(
      { contractId: "c1" },
      reader({ c1: contract("c1", ATR_TEXT) }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("recover refuses (verification-failure) when the contract is absent", async () => {
    const r = await adapter.recover({ contractId: "missing" }, reader({}));
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "canton/no-lcp-anchor",
      detail: expect.stringContaining(
        "no active LcpAnchor carrying an atrHash",
      ),
    });
  });

  it("recover refuses when the contract carries no well-formed atrHash", async () => {
    const r = await adapter.recover(
      { contractId: "c1" },
      reader({ c1: contract("c1", "garbage") }),
    );
    expect(r).toMatchObject({ refused: true, code: "canton/no-lcp-anchor" });
  });

  it("observe reports the anchored transition", async () => {
    const o = await adapter.observe(
      { contractId: "c1" },
      reader({ c1: contract("c1", ATR_TEXT) }),
    );
    expect(o).toEqual({
      ok: true,
      value: { state: "anchored", atrHash: ATR },
    });
  });

  it.each([
    ["the contract is absent", {}, "missing"],
    [
      "the contract carries no atrHash",
      { c1: contract("c1", "garbage") },
      "c1",
    ],
  ])(
    "observe PROPAGATES the refusal when %s — it never reports an anchor that is not there",
    async (_why, byId, contractId) => {
      const o = await adapter.observe(
        { contractId },
        reader(byId as Record<string, LcpAnchorContract>),
      );
      // Passing the refusal through is the whole guard: without it observe answers
      // `{state: "anchored", atrHash: undefined}` — a settled-looking transition for a
      // contract the participant does not hold.
      expect(o).toMatchObject({
        refused: true,
        haltClass: "verification-failure",
        code: "canton/no-lcp-anchor",
      });
    },
  );

  it("enumerate queries the participant and returns only the atrHash matches", async () => {
    const rdr = reader(
      {},
      {
        [ATR_TEXT]: [
          contract("c1", ATR_TEXT),
          contract("c3", ATR_TEXT),
          // A participant that over-returns (e.g. a broad query) must still be filtered by the field.
          contract("c-other", OTHER_TEXT),
        ],
      },
    );
    const hits = await adapter.enumerate(ATR, rdr);
    expect(hits.map((h) => h.contractId)).toEqual(["c1", "c3"]);
  });

  it("enumerate accepts a 0x-prefixed atrHash and normalizes to the ledger Text form", async () => {
    const rdr = reader({}, { [ATR_TEXT]: [contract("c1", ATR_TEXT)] });
    const hits = await adapter.enumerate(
      ATR.toUpperCase().replace("0X", "0x"),
      rdr,
    );
    expect(hits.map((h) => h.contractId)).toEqual(["c1"]);
  });

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() => createCantonAdapter(CANTON_MANIFEST)).not.toThrow();
    expect(() =>
      createCantonAdapter({ ...CANTON_MANIFEST, rail: "solana" }),
    ).toThrow('manifest.rail "solana" is not "canton"');
  });
});
