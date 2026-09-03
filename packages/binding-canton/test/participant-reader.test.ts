import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type LcpAnchorContract,
  makeCantonParticipantReader,
} from "../src/adapter.js";

/**
 * The LIVE Daml JSON Ledger API reader — `fetch` against a participant, so a stubbed global `fetch` is
 * the whole seam. It is the one part of this package that talks to a real ledger, and every branch in it
 * is a fail-loud one: a non-2xx, a Daml `errors[]` envelope, or a response with no `result` must all
 * throw rather than resolve to "no anchor found", because those two answers are not the same fact.
 * An adapter that reported a 500 as an absent anchor would report an unreachable participant as proof
 * that a settlement was never made.
 */
const PKG = "1220deadbeef";
const CFG = {
  jsonLedgerUrl: "https://participant.example",
  lcpAnchorPackageId: PKG,
  bearerJwt: "a.jwt.token",
};
const ATR_TEXT =
  "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

function anchor(contractId: string): LcpAnchorContract {
  return {
    contractId,
    templateId: `${PKG}:Main:LcpAnchor`,
    payload: {
      buyer: "Buyer::1220abc",
      seller: "Seller::1220def",
      atrHash: ATR_TEXT,
      paymentRef: "",
      createdAt: "2026-09-03T00:00:00Z",
    },
  };
}

/** A minimal stand-in for the Response shape `ledgerCall` reads (ok/status/json/text). */
function response(init: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  text?: string;
}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => init.body,
    text: async () => init.text ?? "",
  } as unknown as Response;
}

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const spy = vi.fn(async (url: string, init: RequestInit) =>
    handler(url, init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeCantonParticipantReader — construction", () => {
  it.each([
    ["jsonLedgerUrl", { ...CFG, jsonLedgerUrl: "" }],
    ["lcpAnchorPackageId", { ...CFG, lcpAnchorPackageId: "" }],
    ["bearerJwt", { ...CFG, bearerJwt: "" }],
  ])("refuses to build with an empty %s", (field, cfg) => {
    // Each of the three would otherwise fail much later and much less clearly: an empty URL posts to a
    // relative path, an empty package id builds the template id `:Main:LcpAnchor`, and an empty JWT
    // sends `Bearer ` — a 401 the caller would have to work backwards from.
    expect(() => makeCantonParticipantReader(cfg)).toThrow(new RegExp(field));
  });
});

describe("queryByAtrHash", () => {
  it("POSTs /v1/query for the deployed template, filtered on the atrHash Text field", async () => {
    const spy = stubFetch(() => response({ body: { result: [anchor("c1")] } }));
    const out = await makeCantonParticipantReader(CFG).queryByAtrHash(ATR_TEXT);
    expect(out).toEqual([anchor("c1")]);

    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe("https://participant.example/v1/query");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer a.jwt.token",
    });
    // The query names the FULLY-QUALIFIED template of the deployed DAR: a participant hosts many
    // templates, and querying the wrong one returns [] — indistinguishable from "never anchored".
    expect(JSON.parse(String(init?.body))).toEqual({
      templateIds: [`${PKG}:Main:LcpAnchor`],
      query: { atrHash: ATR_TEXT },
    });
  });

  it("returns [] when the participant holds no matching anchor (a value, not an error)", async () => {
    stubFetch(() => response({ body: { result: [] } }));
    await expect(
      makeCantonParticipantReader(CFG).queryByAtrHash(ATR_TEXT),
    ).resolves.toEqual([]);
  });
});

describe("fetchByContractId", () => {
  it("POSTs /v1/fetch with the template id and the contract id", async () => {
    const spy = stubFetch(() => response({ body: { result: anchor("c1") } }));
    const out = await makeCantonParticipantReader(CFG).fetchByContractId("c1");
    expect(out).toEqual(anchor("c1"));
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe("https://participant.example/v1/fetch");
    expect(JSON.parse(String(init?.body))).toEqual({
      templateId: `${PKG}:Main:LcpAnchor`,
      contractId: "c1",
    });
  });

  it("maps a null result to null — an archived or absent contract is not an error", async () => {
    stubFetch(() => response({ body: { result: null } }));
    await expect(
      makeCantonParticipantReader(CFG).fetchByContractId("gone"),
    ).resolves.toBeNull();
  });
});

describe("the participant's failures stay LOUD", () => {
  it("throws on a non-2xx, naming the path, the status and the body", async () => {
    stubFetch(() =>
      response({ ok: false, status: 503, text: "participant restarting" }),
    );
    await expect(
      makeCantonParticipantReader(CFG).queryByAtrHash(ATR_TEXT),
    ).rejects.toThrow(/\/v1\/query HTTP 503: participant restarting/);
  });

  it("throws on a Daml errors[] envelope even when the HTTP status is 200", async () => {
    // The JSON API answers 200 with `{errors: [...]}` for a rejected query. Reading `result` off that
    // envelope yields undefined, which would otherwise become an empty anchor set.
    stubFetch(() =>
      response({ body: { errors: ["JsonError: unknown template id"] } }),
    );
    await expect(
      makeCantonParticipantReader(CFG).queryByAtrHash(ATR_TEXT),
    ).rejects.toThrow(/errors: JsonError: unknown template id/);
  });

  it("throws when the envelope carries neither result nor errors", async () => {
    stubFetch(() => response({ body: {} }));
    await expect(
      makeCantonParticipantReader(CFG).fetchByContractId("c1"),
    ).rejects.toThrow(/returned no result/);
  });

  it("an EMPTY errors[] is not an error — the result still stands", async () => {
    stubFetch(() => response({ body: { errors: [], result: [anchor("c1")] } }));
    await expect(
      makeCantonParticipantReader(CFG).queryByAtrHash(ATR_TEXT),
    ).resolves.toEqual([anchor("c1")]);
  });

  it("survives a non-2xx whose body cannot be read, still naming the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        text: async () => {
          throw new Error("socket hang up");
        },
      })),
    );
    await expect(
      makeCantonParticipantReader(CFG).queryByAtrHash(ATR_TEXT),
    ).rejects.toThrow(/HTTP 502/);
  });
});
