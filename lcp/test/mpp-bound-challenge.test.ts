// Each MPP pairing's `bound` and `reference` hold the echoed challenge to the pairing's filter: the checks `pairingsOf`
// makes, over the challenge as placed (`pairingsOfPlaced`). Every credential the MPP vector files hold is presented to
// the pairing whose `bound` binds it, with its echoed challenge changed: one request member (or `methodDetails` member)
// removed, set to null, "", 0, "0", "abc", 70000, true, 2^64, 2^128, 10^16 - 1, a 1900 date-time, {} or [], or changed in
// its last character; a member that another MPP vector challenge carries added, with each value it carries there; or
// `expires` removed or moved (RFC 3339 date-times, as MPP's core writes `expires`). Under a challenge `pairingsOfPlaced`
// does not name for the pairing, `bound` and `reference` refuse with the code `pairingsOf` gives the challenge as issued:
// its refusal, or `mpp/not-this-pairing` where it names other pairings, or, on Lightning, `ln/invoice-malformed` where it
// names the pairing for a challenge without the invoice the seller's node writes after `place`. Under one it names,
// `bound` gives H again, or refuses with a code that compares what the payer signed or landed with the challenge; each
// such code is listed below with what it compares, and each is seen. Then each vector file's `boundChallenge` rows.
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { BINDINGS, canonicalJson, isRefusal, type Json } from "../src/index.js";
import { pairingsOf, pairingsOfPlaced, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const DIR = new URL("../vectors/", import.meta.url);
const FILES = rowsOf(
  readdirSync(DIR).filter((n) => n.startsWith("mpp-")),
  "the MPP vector files",
  { exact: 25 },
);
const vector = (f: string) => JSON.parse(readFileSync(new URL(f, DIR), "utf8"));

type Pairing = {
  id: string;
  bound(c: unknown): Promise<unknown>;
  reference?: (c: unknown) => Promise<unknown>;
};
const MPP = rowsOf(
  BINDINGS.filter((b) => b.id.startsWith("mpp/")) as unknown as Pairing[],
  "BINDINGS, the MPP pairings",
  { exact: 26 },
);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCredential = (v: unknown): v is MppCredential =>
  isObj(v) && isObj(v["challenge"]) && typeof v["challenge"]["request"] === "string" && isObj(v["payload"]);
/** Every credential under `v`, with its JSON Pointer (RFC 6901) into the file. */
function credentials(v: unknown, at: string, out: [string, MppCredential][]): [string, MppCredential][] {
  if (!isObj(v) && !Array.isArray(v)) return out;
  if (isCredential(v)) out.push([at, v]);
  for (const [k, x] of Object.entries(v)) credentials(x, `${at}/${k}`, out);
  return out;
}
const CREDENTIALS = rowsOf(
  FILES.flatMap((f) => credentials(vector(f), "", []).map(([at, c]) => ({ file: f, at, credential: c }))),
  "every credential the MPP vector files hold",
  { exact: 21 },
);

const decoded = (c: MppChallenge): Record<string, Json> => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));
const encoded = (r: Record<string, Json>): string => Buffer.from(canonicalJson(r) as string, "utf8").toString("base64url");

/** Every request and `methodDetails` member some MPP vector challenge carries, with up to four of its values. */
function carried(): { top: Map<string, Json[]>; details: Map<string, Json[]> } {
  const top = new Map<string, Json[]>();
  const details = new Map<string, Json[]>();
  const add = (m: Map<string, Json[]>, k: string, v: Json) => {
    const values = m.get(k) ?? [];
    if (values.length < 4 && !values.some((x) => JSON.stringify(x) === JSON.stringify(v))) values.push(v);
    m.set(k, values);
  };
  const walk = (v: unknown): void => {
    if (!isObj(v) && !Array.isArray(v)) return;
    if (isObj(v) && typeof v["request"] === "string" && typeof v["method"] === "string" && typeof v["intent"] === "string") {
      let r: unknown;
      try {
        r = decoded(v as unknown as MppChallenge);
      } catch {
        r = undefined;
      }
      if (isObj(r)) {
        for (const [k, x] of Object.entries(r)) {
          if (k === "methodDetails" && isObj(x)) for (const [d, y] of Object.entries(x)) add(details, d, y as Json);
          else add(top, k, x as Json);
        }
      }
    }
    for (const x of Object.values(v)) walk(x);
  };
  for (const f of FILES) walk(vector(f));
  return { top, details };
}
const CARRIED = carried();

const ODD: [string, Json | undefined][] = [
  ["removed", undefined],
  ["null", null],
  ['""', ""],
  ["0", 0],
  ['"0"', "0"],
  ['"abc"', "abc"],
  ["70000", 70000],
  ["true", true],
  ["2^64", "18446744073709551616"],
  ["2^128", "340282366920938463463374607431768211456"],
  ["10^16 - 1", "9999999999999999"],
  ["a 1900 date-time", "1900-01-01T00:00:00Z"],
  ["{}", {}],
  ["[]", []],
];
const other = (v: Json | undefined): Json => (typeof v === "string" ? (v.length > 0 ? v.slice(0, -1) + (v.endsWith("1") ? "2" : "1") : "1") : "x");

/** The echoed challenge with one thing changed, and what. */
function changed(c: MppChallenge): [string, MppChallenge][] {
  const r = decoded(c);
  const out: [string, MppChallenge][] = [];
  const set = (path: string[], v: Json | undefined): MppChallenge => {
    const copy = structuredClone(r) as Record<string, Json>;
    let at = copy as Record<string, Json>;
    for (const k of path.slice(0, -1)) {
      if (!isObj(at[k])) at[k] = {};
      at = at[k] as Record<string, Json>;
    }
    const last = path[path.length - 1]!;
    if (v === undefined) delete at[last];
    else at[last] = v;
    return { ...c, request: encoded(copy) };
  };
  const details = isObj(r["methodDetails"]) ? (r["methodDetails"] as Record<string, Json>) : undefined;
  for (const k of Object.keys(r)) {
    if (k === "methodDetails" && details !== undefined) {
      for (const d of Object.keys(details)) {
        for (const [what, v] of ODD) out.push([`methodDetails.${d} ${what}`, set(["methodDetails", d], v)]);
        out.push([`methodDetails.${d} changed`, set(["methodDetails", d], other(details[d]))]);
      }
    }
    for (const [what, v] of ODD) out.push([`${k} ${what}`, set([k], v)]);
    out.push([`${k} changed`, set([k], other(r[k]))]);
  }
  for (const [k, values] of CARRIED.top) {
    if (!Object.hasOwn(r, k)) values.forEach((v, i) => out.push([`${k} added (${i})`, set([k], v)]));
  }
  for (const [d, values] of CARRIED.details) {
    if (details === undefined || !Object.hasOwn(details, d)) values.forEach((v, i) => out.push([`methodDetails.${d} added (${i})`, set(["methodDetails", d], v)]));
  }
  const { expires: _expires, ...noExpires } = c;
  out.push(["expires removed", noExpires as MppChallenge]);
  for (const at of ["2000-01-01T00:00:00Z", "2999-01-01T00:00:00Z", "9999-12-31T23:59:59Z"]) out.push([`expires ${at}`, { ...c, expires: at }]);
  return out;
}

/**
 * The code `pairingsOf` gives the challenge as issued (its `opaque` removed) for `pairing`, or null where it names it
 * and `pairingsOfPlaced` does too; `invoiceless` where only the invoice, which the seller's node writes after `place`,
 * is missing.
 */
function filterCode(c: MppChallenge, pairing: string): string | null | "invoiceless" {
  const { opaque: _opaque, ...issued } = c;
  const named = pairingsOf(issued as MppChallenge);
  if (isRefusal(named)) return named.code;
  if (!(named as readonly string[]).includes(pairing)) return "mpp/not-this-pairing";
  return pairingsOfPlaced(c).includes(pairing as never) ? null : "invoiceless";
}
/** The refusal of a challenge the filter refuses for `pairing`. */
const codeOf = (code: string | null | "invoiceless") => (code === "invoiceless" ? "ln/invoice-malformed" : code);
/** The MPP pairings whose `bound` never binds: nothing the payer signs carries H (`mpp/no-signed-place`). */
const NO_SIGNED_PLACE = ["mpp/charge/card", "mpp/charge/stripe", "mpp/subscription/stripe", "mpp/charge/evm/transaction", "mpp/charge/evm/hash"];
const BINDING = MPP.map((b) => b.id).filter((id) => !NO_SIGNED_PLACE.includes(id));

/** What a pairing's `bound` compares with the echoed challenge, as the refusal it gives when the two differ. */
const COMPARES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "mpp/charge/nearintents": {
    "near/memo-not-lcp": "the request's externalId, the carrier, holds an LCP string",
    "mpp/carrier-not-challenge": "the request's externalId holds the H the challenge's id derives from",
  },
  "mpp/charge/solana": { "svm/carrier-mismatch": "the signed memo is the request's externalId" },
  "mpp/charge/usdc/solana": { "svm/carrier-mismatch": "the signed memo is the request's externalId" },
  "mpp/charge/tempo/memo": {
    "tempo/memo-not-bound": "the signed transferWithMemo calls the request's currency",
    "tempo/tx-malformed": "the signed transaction is for the request's chain",
  },
  "mpp/charge/tempo/push": { "tempo/memo-not-bound": "the landed transferWithMemo is the request's currency's" },
  "mpp/charge/usdc/evm": { "mpp/nonce-not-usdc-derivation": "the signed nonce derives from the challenge's id, realm and request" },
  "mpp/charge/usdc/gateway": { "mpp/salt-not-usdc-derivation": "the burn intent's salt derives from the challenge's id, realm and request" },
  "mpp/charge/xrpl": { "xrpl/carrier-mismatch": "the signed InvoiceID is the request's methodDetails.invoiceId" },
  "mpp/session/evm": { "mpp/channel-not-bound": "the channel id derives from the request's chain, escrow, recipient and currency" },
  "mpp/session/hedera": {
    "hedera/channel-id-mismatch": "the channel id derives from the request's chain, escrow, recipient and currency",
    "hedera/channel-log-not-found": "the landed ChannelOpened is from the request's escrow",
  },
  "mpp/session/solana": { "svm/open-not-found": "the opening calls the request's channel program" },
  "mpp/subscription/tempo": { "tempo/key-not-authorized": "the key authorization names the request's chain" },
  "mpp/session/tempo": {
    "tempo/open-not-found": "the opening calls the request's escrow with its session protocol's open",
    "tempo/tx-malformed": "the opening's transaction is for the request's chain",
  },
};
/** What a pairing's `reference` reads beyond what `bound` compares, as the refusal it gives when it cannot. */
const REFERENCE_READS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "mpp/charge/hedera": { "hedera/chain-id-unnamed": "the read keys' network: the request's chainId, absent here, and no default network given" },
};

interface Answer {
  pairing: string;
  where: string;
  what: string;
  named: boolean;
  code: string | null | "invoiceless";
  bound: unknown;
  own: unknown;
  reference: unknown;
  ownReference: unknown;
}

const PRESENTED: { pairing: Pairing; where: string; credential: MppCredential; own: unknown; ownReference: unknown }[] = [];
const answers: Answer[] = [];

describe("each MPP pairing's bound and reference hold the echoed challenge to the pairing's filter", () => {
  beforeAll(async () => {
    for (const { file, at, credential } of CREDENTIALS) {
      for (const pairing of MPP) {
        const own = await pairing.bound(credential);
        if (typeof own !== "string") continue;
        const ownReference = pairing.reference === undefined ? undefined : await pairing.reference(credential);
        PRESENTED.push({ pairing, where: `${file}${at}`, credential, own, ownReference });
      }
    }
    for (const { pairing, where, credential, own, ownReference } of PRESENTED) {
      for (const [what, challenge] of changed(credential.challenge)) {
        const presented = { ...credential, challenge: challenge as MppCredential["challenge"] };
        const code = filterCode(challenge, pairing.id);
        answers.push({
          pairing: pairing.id,
          where,
          what,
          named: pairingsOfPlaced(challenge).includes(pairing.id as never),
          code,
          bound: await pairing.bound(presented),
          own,
          reference: pairing.reference === undefined ? undefined : await pairing.reference(presented),
          ownReference,
        });
      }
    }
  }, 0);

  it("each credential is bound by one pairing, each pairing that binds binds one, and each change is presented to it", () => {
    expect(PRESENTED.map((p) => p.pairing.id).sort()).toEqual([...BINDING].sort());
    rowsOf(answers, "each credential's challenge changed, presented to the pairing that binds it", { exact: 3961 });
  });

  it("pairingsOfPlaced names the pairing exactly where pairingsOf names it, with the Lightning invoice written", () => {
    expect(answers.filter((a) => a.named !== (a.code === null)).map((a) => [a.pairing, a.what, a.code])).toEqual([]);
    const invoiceless = rowsOf(answers, "every answer", {
      exact: 2,
      keep: ["the challenges pairingsOf names for a pairing whose invoice is missing", (a) => a.code === "invoiceless"],
      leave: ["the others", (a) => a.code !== "invoiceless"],
    });
    expect(invoiceless.map((a) => [a.pairing, a.what])).toEqual([
      ["mpp/charge/lightning", "methodDetails.invoice removed"],
      ["mpp/session/lightning", "depositInvoice removed"],
    ]);
  });

  it("under a challenge pairingsOfPlaced does not name, bound and reference refuse with the code pairingsOf gives", () => {
    const refused = rowsOf(answers, "every answer", {
      exact: 1719,
      keep: ["the challenges pairingsOfPlaced does not name for the pairing", (a) => !a.named],
      leave: ["the challenges it names", (a) => a.named],
    });
    const differ = refused.filter(
      (a) =>
        JSON.stringify(a.bound) !== JSON.stringify({ refused: true, code: codeOf(a.code) }) ||
        (a.ownReference !== undefined &&
          !isRefusal(a.ownReference) &&
          JSON.stringify(a.reference) !== JSON.stringify({ refused: true, code: codeOf(a.code) })),
    );
    expect(differ.map((a) => [a.pairing, a.what, a.code, a.bound, a.reference])).toEqual([]);
  }, 0);

  it("under a challenge it names, bound gives H again or a refusal naming what it compares, and reference reads", () => {
    const named = rowsOf(answers, "every answer", {
      exact: 2242,
      keep: ["the challenges pairingsOfPlaced names for the pairing", (a) => a.named],
      leave: ["the challenges it does not name", (a) => !a.named],
    });
    const seen = new Set<string>();
    let bindings = 0;
    for (const a of named) {
      if (!isRefusal(a.bound)) {
        expect([a.pairing, a.what, a.bound]).toEqual([a.pairing, a.what, a.own]);
        bindings++;
      } else {
        const code = (a.bound as { code: string }).code;
        expect([a.pairing, a.what, code in (COMPARES[a.pairing] ?? {})]).toEqual([a.pairing, a.what, true]);
        seen.add(`${a.pairing} ${code}`);
      }
      if (a.ownReference !== undefined && !isRefusal(a.ownReference) && isRefusal(a.reference)) {
        const code = (a.reference as { code: string }).code;
        const listed = code in (COMPARES[a.pairing] ?? {}) || code in (REFERENCE_READS[a.pairing] ?? {});
        expect([a.pairing, a.what, code, listed]).toEqual([a.pairing, a.what, code, true]);
        seen.add(`${a.pairing} ${code}`);
      }
    }
    expect([bindings, named.length - bindings]).toEqual([2023, 219]);
    const listed = [COMPARES, REFERENCE_READS].flatMap((m) => Object.entries(m).flatMap(([id, codes]) => Object.keys(codes).map((c) => `${id} ${c}`)));
    expect([...seen].sort()).toEqual(listed.sort());
  }, 0);
});

/** The value at a JSON Pointer (RFC 6901) into `doc`. */
function at(doc: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .reduce((o, k) => (o as Record<string, unknown>)[k.replaceAll("~1", "/").replaceAll("~0", "~")], doc);
}

interface BoundChallengeRow {
  case: string;
  pairing: string;
  credential: string;
  challenge: MppChallenge;
  expect: string;
}
const ROWS = rowsOf(
  FILES.flatMap((f) => {
    const v = vector(f) as { boundChallenge?: { rows: BoundChallengeRow[] } };
    if (v.boundChallenge === undefined) return [];
    return rowsOf(v.boundChallenge.rows, `${f} boundChallenge.rows`).map((row, i) => ({ file: f, i, row, credential: at(v, row.credential) as MppCredential }));
  }),
  "every MPP vector file's boundChallenge rows",
  { exact: 44 },
);

describe("the MPP vector files' boundChallenge rows", () => {
  it("every MPP pairing whose bound binds has a row", () => {
    expect([...new Set(ROWS.map((r) => r.row.pairing))].sort()).toEqual([...BINDING].sort());
  });

  it.each(ROWS.map((r) => [`${r.file} boundChallenge.rows[${r.i}]: ${r.row.case}`, r] as const))("%s", async (_, { row, credential }) => {
    const pairing = MPP.find((b) => b.id === row.pairing)!;
    expect(typeof (await pairing.bound(credential))).toBe("string");
    expect(pairingsOfPlaced(row.challenge).includes(row.pairing as never)).toBe(false);
    expect(codeOf(filterCode(row.challenge, row.pairing))).toBe(row.expect);
    expect(await pairing.bound({ ...credential, challenge: row.challenge })).toEqual({ refused: true, code: row.expect });
  });
});

// MPP's core: `opaque` is base64url, without padding, of a JSON object; this package reads it as a map of strings
// (`mpp/opaque-malformed`). A placed challenge whose `opaque` does not read is one `pairingsOfPlaced` names no pairing
// for, and the pairing whose `bound` binds the credential refuses it with that code.
const OPAQUES = rowsOf<[string, string]>(
  [
    ["not base64url", "!!"],
    ["base64url of a JSON array", Buffer.from("[]", "utf8").toString("base64url")],
    ["base64url of an object with a number member", Buffer.from('{"n":1}', "utf8").toString("base64url")],
  ],
  "the opaque values that do not read",
  { exact: 3 },
);

describe("a placed challenge whose opaque does not read", () => {
  it.each(OPAQUES)("opaque %s: pairingsOfPlaced names none, and bound refuses mpp/opaque-malformed", async (_, opaque) => {
    let presented = 0;
    for (const { credential } of CREDENTIALS) {
      for (const pairing of MPP) {
        if (typeof (await pairing.bound(credential)) !== "string") continue;
        const challenge = { ...credential.challenge, opaque };
        expect(pairingsOfPlaced(challenge)).toEqual([]);
        expect(await pairing.bound({ ...credential, challenge })).toEqual({ refused: true, code: "mpp/opaque-malformed" });
        presented++;
      }
    }
    expect(presented).toBe(21);
  });
});
