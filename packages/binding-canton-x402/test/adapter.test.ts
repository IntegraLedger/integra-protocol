/**
 * The Canton adapter over x402's `exact` scheme.
 *
 * One transaction settles each payment, so `recover`, `observe` and `enumerate` all read the same thing:
 * a `TransferFactory_Transfer` whose metadata carries the seller's advertised memo under `x402.memo`. The
 * refusal arms are the substance — an update that is not an LCP settlement must read as "not one" rather
 * than as an error or, worse, as a weld.
 */
import { describe, expect, it } from "vitest";
import {
  type CantonX402Reader,
  type CantonX402TransferView,
  createCantonX402Adapter,
} from "../src/adapter.js";
import { CANTON_X402_MANIFEST } from "../src/manifest.js";

const ATR = `0x${"ab".repeat(32)}`;
const OTHER = `0x${"cd".repeat(32)}`;
const MERCHANT = "merchant::1220abc";

const adapter = () => createCantonX402Adapter(CANTON_X402_MANIFEST);

function view(
  over: Partial<CantonX402TransferView> = {},
): CantonX402TransferView {
  return {
    meta: { "x402.memo": ATR },
    receiver: MERCHANT,
    amount: "1000000000",
    instrumentId: { admin: "DSO::1220", id: "Amulet" },
    ...over,
  };
}

/** A participant holding `updates`, keyed by update id, in the order `transfersFor` reports them. */
function reader(
  updates: Record<string, CantonX402TransferView | null>,
): CantonX402Reader {
  return {
    async transferView(id) {
      return updates[id] ?? null;
    },
    async transfersFor(_party, limit) {
      const ids = Object.keys(updates);
      return limit === undefined ? ids : ids.slice(0, limit);
    },
  };
}

describe("createCantonX402Adapter", () => {
  it("refuses a manifest from another rail", () => {
    // An adapter built over another rail's manifest would report that rail's claims as this one's.
    expect(() =>
      createCantonX402Adapter({ ...CANTON_X402_MANIFEST, rail: "solana" }),
    ).toThrow(/is not "canton:x402"/);
  });

  it("exposes the manifest it was built with", () => {
    expect(adapter().manifest).toBe(CANTON_X402_MANIFEST);
  });
});

describe("propose", () => {
  it("returns the extra fragment the seller advertises", () => {
    expect(adapter().propose(ATR)).toEqual({ memo: ATR });
  });

  it("throws on a malformed atrHash rather than advertising one", () => {
    expect(() => adapter().propose("0xdead")).toThrow(/32-byte/);
  });
});

describe("recover", () => {
  it("returns the atrHash carried by the settled transfer", async () => {
    const out = await adapter().recover(
      { updateId: "u1" },
      reader({ u1: view() }),
    );
    expect(out).toEqual({ ok: true, value: ATR });
  });

  it("refuses when the participant has no such update", async () => {
    const out = await adapter().recover({ updateId: "missing" }, reader({}));
    expect("refused" in out && out.code).toBe("canton/no-such-update");
    expect("refused" in out && out.haltClass).toBe("verification-failure");
    expect("refused" in out ? (out.detail ?? "") : "").toContain("missing");
  });

  it("the no-memo refusal carries the full refusal shape, not just a code", async () => {
    // `refused`, `haltClass` and `code` are the contract every consumer switches on; a refusal that
    // forgot to declare itself one would be read as a success by `"refused" in outcome`.
    const out = await adapter().recover(
      { updateId: "u1" },
      reader({ u1: view({ meta: {} }) }),
    );
    expect(out).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "canton/no-lcp-memo",
    });
    expect("refused" in out ? (out.detail ?? "") : "").toContain("x402.memo");
  });

  it("refuses a real transfer that carries no LCP memo", async () => {
    // The common case on a busy party: an ordinary Canton Coin payment. It is not an error and it is not
    // a weld, and the two refusal codes are distinct so a caller can tell "no such update" from "not
    // ours".
    const out = await adapter().recover(
      { updateId: "u1" },
      reader({ u1: view({ meta: { "x402.memo": "invoice-2024-001" } }) }),
    );
    expect("refused" in out && out.code).toBe("canton/no-lcp-memo");
  });

  it("refuses a transfer whose memo sits under a key the facilitator does not check", async () => {
    const out = await adapter().recover(
      { updateId: "u1" },
      reader({ u1: view({ meta: { memo: ATR } }) }),
    );
    expect("refused" in out && out.code).toBe("canton/no-lcp-memo");
  });
});

describe("observe", () => {
  it("reports the settled transition WITH the asset the weld is attached to", async () => {
    // This is what `assetBinding: "carried"` claims, and the claim is only honest if a consumer can
    // actually reach the fields. The overlay this replaced decoded nothing about the payment at all.
    const out = await adapter().observe(
      { updateId: "u1" },
      reader({ u1: view() }),
    );
    expect(out).toEqual({
      ok: true,
      value: {
        state: "settled",
        atrHash: ATR,
        receiver: MERCHANT,
        amount: "1000000000",
        instrumentId: { admin: "DSO::1220", id: "Amulet" },
      },
    });
  });

  it("PROPAGATES the refusal — it never reports a settlement that is not there", async () => {
    for (const [id, r] of [
      ["missing", reader({})],
      ["u1", reader({ u1: view({ meta: {} }) })],
    ] as const) {
      const out = await adapter().observe({ updateId: id }, r);
      expect("refused" in out).toBe(true);
    }
  });
});

describe("enumerate", () => {
  it("returns only the transfers whose memo matches", async () => {
    const refs = await adapter().enumerate(
      ATR,
      MERCHANT,
      reader({
        u1: view(),
        u2: view({ meta: { "x402.memo": OTHER } }),
        u3: view({ meta: {} }),
        u4: view(),
      }),
    );
    expect(refs).toEqual([{ updateId: "u1" }, { updateId: "u4" }]);
  });

  it("matches either spelling of the same atrHash (LCP §2.5)", async () => {
    const refs = await adapter().enumerate(
      `0x${"AB".repeat(32)}`,
      MERCHANT,
      reader({ u1: view() }),
    );
    expect(refs).toEqual([{ updateId: "u1" }]);
  });

  it("skips an update the participant cannot show, rather than throwing", async () => {
    // `transfersFor` and `transferView` are two calls against a moving ledger; an id that vanishes
    // between them is a race, not a failure.
    const r: CantonX402Reader = {
      async transferView(id) {
        return id === "u1" ? view() : null;
      },
      async transfersFor() {
        return ["u1", "gone"];
      },
    };
    expect(await adapter().enumerate(ATR, MERCHANT, r)).toEqual([
      { updateId: "u1" },
    ]);
  });

  it("passes `limit` through to the participant", async () => {
    const refs = await adapter().enumerate(
      ATR,
      MERCHANT,
      reader({ u1: view(), u2: view() }),
      1,
    );
    expect(refs).toEqual([{ updateId: "u1" }]);
  });

  it("EXCLUDES a non-matching memo — the filter is the point, not the scan", async () => {
    // Without this, dropping the atrHashEquals term would return every transfer the party can see as an
    // LCP settlement, which is the fabricated-weld failure at enumeration scale.
    const refs = await adapter().enumerate(
      ATR,
      MERCHANT,
      reader({ u1: view({ meta: { "x402.memo": OTHER } }) }),
    );
    expect(refs).toEqual([]);
  });

  it("THROWS on a malformed atrHash rather than returning an empty list", async () => {
    // The silent [] would be indistinguishable from "this party has no settlements", which is the
    // reading a caller is least able to challenge.
    await expect(
      adapter().enumerate("0xdead", MERCHANT, reader({})),
    ).rejects.toThrow(/32-byte/);
  });

  it("returns [] for a party with no matching transfers — a value, not an error", async () => {
    expect(await adapter().enumerate(ATR, MERCHANT, reader({}))).toEqual([]);
  });
});
