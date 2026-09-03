/**
 * The live participant reader — pure `fetch` over the Daml JSON Ledger API, no Daml SDK.
 *
 * The transport contract is the whole subject here: a non-2xx, a Daml `errors[]` envelope, and a missing
 * `result` are all LOUD, because a reader that swallowed them would report "this party has no settlements"
 * for what is actually a broken participant, an expired JWT or a wrong URL. An ABSENT update is the one
 * quiet case, and it is quiet deliberately: a reference the participant cannot see is a value the caller
 * must classify, not a transport failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCantonX402Reader } from "../src/adapter.js";

const CFG = {
  jsonLedgerUrl: "https://participant.example",
  bearerJwt: "jwt-token",
  // ⛔ Supplied by the caller, not by this package. These are NOT the paths it once shipped as constants
  // (`/v1/updates/transfer`, `/v1/updates/transfers`), and that is deliberate: those named no endpoint of
  // any published Daml JSON API version, and the only thing that ever asserted them was a stub in this
  // file compared against the URL the code itself built — a test and a code path restating one guess to
  // each other. A fixture that reuses the shipped default cannot notice the default is wrong.
  transferPath: "/deployment-specific/transfer",
  transfersPath: "/deployment-specific/transfers",
};
const ATR = `0x${"ab".repeat(32)}`;

/** Stub `fetch` with one canned response, returning the recorded call for assertion. */
function stubFetch(res: Partial<Response> & { json?: () => Promise<unknown> }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, ...res } as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeCantonX402Reader — construction", () => {
  it("refuses an empty jsonLedgerUrl", () => {
    expect(() => makeCantonX402Reader({ ...CFG, jsonLedgerUrl: "" })).toThrow(
      /jsonLedgerUrl is empty/,
    );
  });

  it("refuses an empty bearerJwt", () => {
    // Every Daml read is party-scoped, so an unauthenticated reader sees nothing and would report an
    // empty ledger rather than a configuration error.
    expect(() => makeCantonX402Reader({ ...CFG, bearerJwt: "" })).toThrow(
      /bearerJwt is empty/,
    );
  });

  it.each(["transferPath", "transfersPath"] as const)(
    "refuses an empty %s rather than POSTing to the base URL",
    (field) => {
      // An empty path resolves to `jsonLedgerUrl` itself, and a participant that answers anything at `/`
      // would have that read as a transfer view. The refusal is at CONSTRUCTION, not at the first read.
      expect(() => makeCantonX402Reader({ ...CFG, [field]: "" })).toThrow(
        /does not guess your participant/,
      );
    },
  );

  it("needs NO package id — the memo rides the token-standard transfer", () => {
    // The overlay this replaced required the deployed lcp-anchor DAR's package id, which is the hash of
    // a Daml package this repository does not ship. No DAR is configured now; the two endpoint paths are,
    // because how a deployment exposes a token-standard transfer over HTTP is a fact about that
    // deployment and not about Canton.
    expect(() => makeCantonX402Reader(CFG)).not.toThrow();
  });
});

describe("transferView", () => {
  it("POSTs the update id and returns the transfer view", async () => {
    const view = {
      meta: { "x402.memo": ATR },
      receiver: "merchant::1220abc",
      amount: "1000000000",
      instrumentId: { admin: "DSO::1220", id: "Amulet" },
    };
    const calls = stubFetch({ json: async () => ({ result: view }) });
    const reader = makeCantonX402Reader(CFG);
    expect(await reader.transferView("update-1")).toEqual(view);
    expect(calls[0]?.url).toBe(`${CFG.jsonLedgerUrl}${CFG.transferPath}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      updateId: "update-1",
    });
    expect(calls[0]?.init.method).toBe("POST");
    const ct = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(ct?.["content-type"]).toBe("application/json");
    const headers = calls[0]?.init.headers as
      | Record<string, string>
      | undefined;
    expect(headers?.["authorization"]).toBe("Bearer jwt-token");
  });

  it("maps a null result to null — an absent update is not an error", async () => {
    stubFetch({ json: async () => ({ result: null }) });
    const reader = makeCantonX402Reader(CFG);
    expect(await reader.transferView("nope")).toBeNull();
  });
});

describe("transfersFor", () => {
  it("POSTs the party and returns the update ids", async () => {
    const calls = stubFetch({ json: async () => ({ result: ["u1", "u2"] }) });
    const reader = makeCantonX402Reader(CFG);
    expect(await reader.transfersFor("merchant::1220abc")).toEqual([
      "u1",
      "u2",
    ]);
    expect(calls[0]?.url).toBe(`${CFG.jsonLedgerUrl}${CFG.transfersPath}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      party: "merchant::1220abc",
    });
  });

  it("omits `limit` entirely when unset, rather than sending null", async () => {
    // A participant reading `limit: null` may treat it as zero. Absent means absent.
    const calls = stubFetch({ json: async () => ({ result: [] }) });
    await makeCantonX402Reader(CFG).transfersFor("p");
    expect("limit" in JSON.parse(String(calls[0]?.init.body))).toBe(false);
  });

  it("passes `limit` through when given", async () => {
    const calls = stubFetch({ json: async () => ({ result: [] }) });
    await makeCantonX402Reader(CFG).transfersFor("p", 25);
    expect(JSON.parse(String(calls[0]?.init.body)).limit).toBe(25);
  });
});

describe("the transport fails LOUD", () => {
  it("throws on a non-2xx, naming the path, the status and the body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 503,
      text: async () => "participant down",
      json: async () => ({}),
    }));
    await expect(makeCantonX402Reader(CFG).transferView("u")).rejects.toThrow(
      new RegExp(`${CFG.transferPath} HTTP 503: participant down`),
    );
  });

  it("survives a non-2xx whose body cannot be read, still naming the status", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("stream closed");
      },
      json: async () => ({}),
    }));
    await expect(makeCantonX402Reader(CFG).transferView("u")).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("throws on a Daml errors[] envelope even when the HTTP status is 200", async () => {
    // The JSON API reports application errors inside a 200. Reading `result` without checking `errors`
    // would turn an authorization failure into an empty ledger.
    stubFetch({ json: async () => ({ errors: ["party not authorized"] }) });
    await expect(makeCantonX402Reader(CFG).transfersFor("p")).rejects.toThrow(
      /party not authorized/,
    );
  });

  it("joins EVERY error, not just the first — a partial report hides the cause", async () => {
    stubFetch({ json: async () => ({ errors: ["first", "second"] }) });
    await expect(makeCantonX402Reader(CFG).transfersFor("p")).rejects.toThrow(
      /first; second/,
    );
  });

  it("an unreadable error body yields an EMPTY body, not the string 'undefined'", async () => {
    // `.catch(() => "")` — the fallback has to be a string, or the thrown message reads
    // "HTTP 500: undefined" and sends the reader looking for a body that was never there.
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("stream closed");
      },
      json: async () => ({}),
    }));
    await expect(makeCantonX402Reader(CFG).transferView("u")).rejects.toThrow(
      /HTTP 500: $/,
    );
  });

  it("throws when the envelope carries neither result nor errors", async () => {
    stubFetch({ json: async () => ({}) });
    await expect(makeCantonX402Reader(CFG).transfersFor("p")).rejects.toThrow(
      /returned no result/,
    );
  });

  it("an EMPTY errors[] is not an error — the result still stands", async () => {
    stubFetch({ json: async () => ({ result: ["u1"], errors: [] }) });
    expect(await makeCantonX402Reader(CFG).transfersFor("p")).toEqual(["u1"]);
  });
});
