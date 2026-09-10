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
/** A scan depth. `enumerate` requires one — this package will not choose the bound for a caller, because
 *  it does not even know which endpoint the reader is pointed at. */
const SCAN = 50;

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
      return Object.keys(updates).slice(0, limit);
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
      SCAN,
    );
    expect(refs).toEqual([{ updateId: "u1" }, { updateId: "u4" }]);
  });

  it("matches either spelling of the same atrHash (LCP §2.5)", async () => {
    const refs = await adapter().enumerate(
      `0x${"AB".repeat(32)}`,
      MERCHANT,
      reader({ u1: view() }),
      SCAN,
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
    expect(await adapter().enumerate(ATR, MERCHANT, r, SCAN)).toEqual([
      { updateId: "u1" },
    ]);
  });

  it("passes the scan depth through to the participant", async () => {
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
      SCAN,
    );
    expect(refs).toEqual([]);
  });

  it("THROWS on a malformed atrHash rather than returning an empty list", async () => {
    // The silent [] would be indistinguishable from "this party has no settlements", which is the
    // reading a caller is least able to challenge.
    await expect(
      adapter().enumerate("0xdead", MERCHANT, reader({}), SCAN),
    ).rejects.toThrow(/32-byte/);
  });

  it("returns [] for a party with no matching transfers — a value, not an error", async () => {
    expect(await adapter().enumerate(ATR, MERCHANT, reader({}), SCAN)).toEqual(
      [],
    );
  });
});

/**
 * ⛔⛔ **THE MEMO WAS CHECKED AND THE ASSET WAS NOT, UNDER TYPES THAT SAID BOTH WERE THERE.**
 *
 * `CantonX402TransferView` declares `receiver`, `amount` and `instrumentId` REQUIRED — and the view comes
 * off a counterparty's HTTP endpoint through `JSON.parse`, which checks no type at runtime. A reader that
 * omitted them handed back `undefined`, and `readSettlement` copied it into a `CantonX402Settlement` whose
 * own declared types promise strings. The caller received `{ state: "settled", receiver: undefined }`:
 * an authoritative settled verdict about an asset nobody could name.
 *
 * ⭐ Two lines above, an absent memo refuses loudly and by name. This manifest declares
 * `assetBinding: "carried"`, which is the claim that a consumer can reach the asset the weld is attached
 * to — so the asset fields are the other half of the same promise, and one half was a refusal while the
 * other was a success.
 */
describe("the asset half of `assetBinding: carried` is checked too", () => {
  /** A view with one asset field knocked out, the way a reader that skipped it would hand one over. */
  const without = (field: keyof CantonX402TransferView) => {
    const v = { ...view() } as Record<string, unknown>;
    delete v[field];
    return v as unknown as CantonX402TransferView;
  };

  it.each(["receiver", "amount", "instrumentId"] as const)(
    "⛔ REFUSES a transfer whose %s is missing, rather than settling with undefined",
    async (field) => {
      const out = await adapter().observe(
        { updateId: "u1" },
        reader({ u1: without(field) }),
      );
      expect(out).toMatchObject({
        refused: true,
        haltClass: "verification-failure",
        code: "canton/incomplete-transfer-view",
      });
      expect("refused" in out ? (out.detail ?? "") : "").toContain(field);
    },
  );

  it("⛔ and an EMPTY string is missing too — a blank receiver names no party", async () => {
    const out = await adapter().observe(
      { updateId: "u1" },
      reader({ u1: view({ receiver: "" }) }),
    );
    expect("refused" in out && out.code).toBe(
      "canton/incomplete-transfer-view",
    );
  });

  it('⛔ a NULL instrumentId refuses rather than throwing — `typeof null` is "object"', async () => {
    // The null arm is not decoration: without it `text(view.instrumentId.admin)` dereferences null and
    // this refuse-don't-throw surface raises a TypeError instead of naming the missing field.
    const out = await adapter().observe(
      { updateId: "u1" },
      reader({
        u1: view({
          instrumentId:
            null as unknown as CantonX402TransferView["instrumentId"],
        }),
      }),
    );
    expect("refused" in out && out.code).toBe(
      "canton/incomplete-transfer-view",
    );
  });

  it("⛔ a half-filled instrumentId is not an instrument", async () => {
    const out = await adapter().observe(
      { updateId: "u1" },
      reader({ u1: view({ instrumentId: { admin: "DSO::1220", id: "" } }) }),
    );
    expect("refused" in out && out.code).toBe(
      "canton/incomplete-transfer-view",
    );
    expect("refused" in out ? (out.detail ?? "") : "").toContain(
      "instrumentId",
    );
  });

  it("the refusal NAMES every missing field, not just the first", async () => {
    // An operator handed "incomplete-transfer-view" with one field named fixes one field and comes back.
    const out = await adapter().observe(
      { updateId: "u1" },
      reader({ u1: view({ receiver: "", amount: "" }) }),
    );
    const detail = "refused" in out ? (out.detail ?? "") : "";
    expect(detail).toContain("receiver");
    expect(detail).toContain("amount");
  });

  it("⛔ the memo is still read FIRST — a transfer that is not ours is not ours", async () => {
    // Ordering matters: an ordinary Canton Coin payment with no LCP memo must read `no-lcp-memo`, which
    // is a statement about relevance, and never as a complaint about an asset we had no business reading.
    const out = await adapter().observe(
      { updateId: "u1" },
      reader({ u1: view({ meta: {}, receiver: "" }) }),
    );
    expect("refused" in out && out.code).toBe("canton/no-lcp-memo");
  });

  it("⛔ recover refuses it too — one reading, not two", async () => {
    // `recover` and `observe` both go through `readSettlement`, so a settlement the asset check refuses
    // cannot come back as a bare atrHash through the other door.
    const out = await adapter().recover(
      { updateId: "u1" },
      reader({ u1: without("receiver") }),
    );
    expect("refused" in out && out.code).toBe(
      "canton/incomplete-transfer-view",
    );
  });

  it("⭐ and enumerate is UNAFFECTED — it matches on the memo, which is all it reads", async () => {
    // The scan's job is to find candidate update ids; it never claims to report the asset, so refusing
    // an incomplete view there would drop a real settlement from a list that never promised one.
    const refs = await adapter().enumerate(
      ATR,
      MERCHANT,
      reader({ u1: without("receiver") }),
      SCAN,
    );
    expect(refs).toEqual([{ updateId: "u1" }]);
  });
});

/**
 * ⛔ **THE SCAN DEPTH IS THE CALLER'S, AND IT IS REQUIRED.** It was optional and forwarded verbatim, so an
 * absent one handed the depth to whatever the deployment's endpoint defaults to — and a settlement past
 * that default came back as `[]`, indistinguishable from "this party has no settlements". This package
 * refuses to guess the endpoint's PATH; guessing its page size is the same guess one field over.
 */
describe("the party scan states its own bound", () => {
  it("a depth of 1 is a legitimate bound — the floor is 1, not 2", async () => {
    // `< 1` and `<= 1` differ by exactly the smallest scan a caller can ask for.
    expect(
      await adapter().enumerate(ATR, MERCHANT, reader({ u1: view() }), 1),
    ).toEqual([{ updateId: "u1" }]);
  });

  it("⛔ refuses a depth that is not a positive integer rather than passing it on", async () => {
    for (const bad of [0, -1, 1.5]) {
      await expect(
        adapter().enumerate(ATR, MERCHANT, reader({ u1: view() }), bad),
      ).rejects.toThrow(/limit must be a positive integer/);
    }
  });
});
