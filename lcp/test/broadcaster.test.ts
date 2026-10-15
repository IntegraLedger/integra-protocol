// Every pairing's `broadcaster` against vectors/broadcaster.json: who broadcasts what a payer presents under it. The
// build path's `broadcast` member is held to the same answer where each build is tested: mpp-charge.test.ts (EVM
// `transaction` and `hash`, Tempo pull and push), mpp-hedera.test.ts (the Hedera charge's push and pull) and
// mpp-session.test.ts (the EVM session's `hash` and `authorization` openings, the Tempo session's opening).
//
// `broadcaster` answers only for a payment of a type and kind the pairing takes, within the shape gate its `bound`
// applies first, and gives any other payment the refusal `bound` gives that fault. A session's or batch channel's
// action other than the opening, which `bound` does not read, is read by `channel.kind`: one it refuses for the
// payment's own content gets its refusal. The fuzz below holds that over every pairing: from each payment a pairing
// takes, it changes one thing (the payload's `type`, its `action`, an opening `deposit`'s `type`, the members a
// hand-built table names, or the payment's shape) and asks `bound`, `channel.kind` and `broadcaster`.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, isRefusal, type Binding, type Broadcaster } from "../src/index.js";
import { MPP_BINDINGS, type MppPairingId } from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/broadcaster.json", import.meta.url), "utf8"));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

type PairingRow = { pairing: string; broadcaster: Broadcaster | null; source: string };
type KindRow = { case: string; pairing: string; presented: unknown; expect: Broadcaster; source: string };
type RefusalRow = { case: string; pairing: string; presented: unknown; expectRefusal: string; bound?: string };

const PAIRINGS = rowsOf<PairingRow>(V.pairings, "broadcaster.json pairings", { exact: 67 });
const KINDS = rowsOf<KindRow>(V.kinds, "broadcaster.json kinds", { exact: 35 });
const REFUSALS = rowsOf<RefusalRow>(V.refusals, "broadcaster.json refusals", { exact: 37 });
const MULTI = PAIRINGS.filter((r) => r.broadcaster === null).map((r) => r.pairing);
const answerOf = (id: string): Broadcaster | null => PAIRINGS.find((r) => r.pairing === id)!.broadcaster;

const byId = (id: string): Binding => {
  const b = BINDINGS.find((x) => x.id === id);
  if (b === undefined) throw new Error(`no pairing ${id}`);
  return b;
};
const codeOf = (v: unknown): string | undefined => (isRefusal(v) ? v.code : undefined);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A row's value with each {"$repeat": [s, n]} replaced by s repeated n times. */
function expand(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expand);
  if (!isObj(v)) return v;
  const r = v["$repeat"];
  if (Array.isArray(r)) return (r[0] as string).repeat(r[1] as number);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
}

// Every id `pairingsOf` can name. A key this object lacks, or one that is not an `MppPairingId`, does not compile.
const MPP_IDS: { readonly [id in MppPairingId]: true } = {
  "mpp/charge/evm/permit2": true,
  "mpp/charge/evm/authorization": true,
  "mpp/charge/evm/transaction": true,
  "mpp/charge/evm/hash": true,
  "mpp/charge/tempo/memo": true,
  "mpp/charge/tempo/push": true,
  "mpp/session/evm": true,
  "mpp/session/tempo": true,
  "mpp/subscription/tempo": true,
  "mpp/charge/lightning": true,
  "mpp/session/lightning": true,
  "mpp/charge/hedera": true,
  "mpp/charge/solana": true,
  "mpp/charge/stellar": true,
  "mpp/charge/xrpl": true,
  "mpp/charge/nearintents": true,
  "mpp/session/hedera": true,
  "mpp/session/solana": true,
  "mpp/session/xrpl": true,
  "mpp/charge/card": true,
  "mpp/charge/stripe": true,
  "mpp/subscription/stripe": true,
  "mpp/charge/usdc/evm": true,
  "mpp/charge/usdc/solana": true,
  "mpp/charge/usdc/stacks": true,
  "mpp/charge/usdc/gateway": true,
};

/** Each export of an entry point that is a pairing: an object with a string `id` and a function `bound`. */
async function exportedPairings(): Promise<{ entry: string; name: string; value: Record<string, unknown> }[]> {
  const out: { entry: string; name: string; value: Record<string, unknown> }[] = [];
  for (const key of Object.keys(PKG.exports)) {
    const file = key === "." ? "index" : key.slice(2);
    const path = new URL(`../src/${file}.ts`, import.meta.url).pathname;
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ path);
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      if (typeof v["id"] === "string" && typeof v["bound"] === "function") out.push({ entry: key, name, value: v });
    }
  }
  return out;
}

// ── The payments each pairing takes: the seeds the fuzz changes.

/**
 * The pairings whose `bound` binds nothing, each with the code it gives every payment within its gates. A payment
 * that reaches this code is one the pairing takes.
 */
const BINDS_NOTHING: Readonly<Record<string, string>> = {
  "mpp/charge/evm/transaction": "mpp/no-signed-place",
  "mpp/charge/evm/hash": "mpp/no-signed-place",
  "mpp/charge/card": "mpp/no-signed-place",
  "mpp/charge/stripe": "mpp/no-signed-place",
  "mpp/subscription/stripe": "mpp/no-signed-place",
  "ack/payment-request": "ack/no-signed-place",
  "acp/checkout/undelegated": "acp/not-buyer-signed",
  "ucp/checkout/unsigned": "ucp/not-buyer-signed",
  "ucp/booking/unsigned": "ucp/not-buyer-signed",
  "card/seller-reference": "card/no-signed-place",
};
/** The pairings whose `bound` applies no shape gate: `broadcaster` answers whatever is presented. */
const UNGATED = ["ack/payment-request", "acp/checkout/undelegated", "ucp/checkout/unsigned", "ucp/booking/unsigned", "card/seller-reference"];

/** Every object in the vector files a pairing can be presented, and every kinds row's credential. */
function candidates(): unknown[] {
  const out: unknown[] = [];
  const walk = (x: unknown, depth: number): void => {
    if (depth > 14 || typeof x !== "object" || x === null) return;
    if (!Array.isArray(x) && ["payload", "allowance", "checkout_mandate", "signatureInput", "l2"].some((k) => k in x)) out.push(x);
    for (const v of Array.isArray(x) ? x : Object.values(x)) walk(v, depth + 1);
  };
  for (const f of readdirSync(new URL("../vectors/", import.meta.url)).sort()) {
    if (f.endsWith(".json") && f !== "broadcaster.json") {
      walk(JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8")), 0);
    }
  }
  for (const k of KINDS) out.push(k.presented);
  return out;
}

/**
 * Up to four payments the pairing takes: `bound` binds each, gives it the code it gives every payment, or gives it a
 * `…/read-first` code, which `bound` gives a payment the payer broadcast until the seller's read is held under
 * `FETCHED`, a member no vector file can carry.
 */
async function seedsOf(b: Binding, all: readonly unknown[]): Promise<unknown[]> {
  const seeds: unknown[] = [];
  for (const c of all) {
    if (seeds.length === 4) break;
    const code = codeOf(await b.bound(c));
    if (code === undefined || code === BINDS_NOTHING[b.id] || code.endsWith("/read-first")) seeds.push(c);
  }
  return seeds;
}

// ── The changes the fuzz makes.

const ABSENT = Symbol("absent");
const TYPES: readonly unknown[] = [
  "transaction", "hash", "signature", "bundle", "authorization", "permit2", "keyAuthorization", "transfer", "token",
  "deposit", "voucher", "refund", "bogus", 7, ABSENT,
];
const ACTIONS: readonly unknown[] = ["open", "topUp", "voucher", "close", "bearer", "use", "bogus", 7, ABSENT];
const set = (o: Obj, k: string, v: unknown): Obj => {
  const c = { ...o };
  if (v === ABSENT) delete c[k];
  else c[k] = v;
  return c;
};
const nested = (n: number): Obj => {
  let v: Obj = {};
  for (let i = 1; i < n; i++) v = { d: v };
  return v;
};

/** The seed with its payload's `type`, `action`, or an opening `deposit`'s `type` changed. */
function kindChanges(seed: unknown): unknown[] {
  if (!isObj(seed) || !isObj(seed["payload"])) return [];
  const p = seed["payload"];
  const out: unknown[] = [];
  for (const t of TYPES) out.push({ ...seed, payload: set(p, "type", t) });
  for (const a of ACTIONS) out.push({ ...seed, payload: set(p, "action", a) });
  for (const a of ["open", "topUp"]) for (const t of TYPES) out.push({ ...seed, payload: set(set(p, "action", a), "type", t) });
  const deposit = isObj(p["deposit"]) ? p["deposit"] : {};
  for (const t of TYPES) {
    out.push({ ...seed, payload: { ...set(p, "action", "voucher"), deposit: set({ ...deposit, action: "open" }, "type", t) } });
  }
  return out;
}

/**
 * The seed outside the shape gate of its protocol. Every pairing: a value that is not an object. An MPP credential:
 * one `credentialOf` refuses, one over 64 KiB as JSON, and one 17 objects deep. An x402 payment: one that is not
 * x402 v2, whose `accepted` or `payload` is not an object, or that carries a `refused` member. A checkout or card
 * payment, a signed object, is held to the object gate alone; `acp/checkout/delegated`'s allowance shape is in the
 * refusal rows.
 */
function shapeChanges(seed: unknown): unknown[] {
  const out: unknown[] = [undefined, null, "x", 0, []];
  if (!isObj(seed)) return out;
  if (isObj(seed["challenge"]) && isObj(seed["payload"])) {
    const p = seed["payload"];
    out.push(
      {},
      set(seed, "payload", "x"),
      set(seed, "payload", ABSENT),
      set(seed, "challenge", "x"),
      { ...seed, challenge: { ...seed["challenge"], id: 5 } },
      { ...seed, source: 7 },
      { ...seed, refused: true },
      { ...seed, payload: { ...p, pad: "a".repeat(65_536) } },
      { ...seed, pad: "a".repeat(65_536) },
      { ...seed, payload: { ...p, deep: nested(15) } },
    );
  } else if (seed["x402Version"] === 2) {
    out.push(
      {},
      { ...seed, x402Version: 1 },
      set(seed, "x402Version", ABSENT),
      { ...seed, accepted: "x" },
      set(seed, "accepted", ABSENT),
      { ...seed, payload: "x" },
      set(seed, "payload", ABSENT),
      { ...seed, refused: true },
    );
  }
  return out;
}

/**
 * Payments the changes above do not make, per family, each the seed with members changed by hand. MPP charges:
 * payload `type`s that are not plain strings, or not the spelling a draft gives. MPP sessions: each action that is not
 * the opening, with and without the members a close or a voucher carries (`voucher`, `authentication`), and actions
 * that are not plain strings. Batch-settlement channels: refunds of each `amount` the channel contract does and does
 * not take, a voucher with an `amount`, a deposit with no `deposit` or no transaction, and types that are not plain
 * strings. Other x402 pairings: a payload object that carries nothing.
 */
function byHand(b: Binding, seed: unknown): unknown[] {
  if (!isObj(seed) || !isObj(seed["payload"])) return [];
  const p = seed["payload"];
  const odd: readonly unknown[] = ["__proto__", "toString", "", null, true, [], {}];
  const out: unknown[] = [];
  if (b.id.startsWith("mpp/session/") || b.id.startsWith("mpp/subscription/")) {
    for (const a of ["voucher", "topUp", "close", "use", "bearer"]) {
      const bare = set(set(set(p, "action", a), "voucher", ABSENT), "authentication", ABSENT);
      out.push(
        { ...seed, payload: bare },
        { ...seed, payload: { ...bare, voucher: {} } },
        { ...seed, payload: { ...bare, authentication: {} } },
        { ...seed, payload: { ...bare, voucher: {}, authentication: {} } },
      );
    }
    for (const a of [...odd, "OPEN", ["open"]]) out.push({ ...seed, payload: set(p, "action", a) });
  } else if (b.id.startsWith("mpp/")) {
    for (const t of [...odd, "HASH", ["hash"], ["transaction"]]) out.push({ ...seed, payload: set(p, "type", t) });
  } else if (b.id.startsWith("x402/batch-settlement/")) {
    const amounts: readonly unknown[] = [
      "0", "x", "-1", "1.5", " 1", "0x10", "1e3", "340282366920938463463374607431768211456",
      "340282366920938463463374607431768211455", "1", "01", 1, null, ABSENT,
    ];
    for (const amount of amounts) out.push({ ...seed, payload: set(set(p, "type", "refund"), "amount", amount) });
    out.push({ ...seed, payload: { ...p, type: "voucher", amount: "0" } });
    out.push({ ...seed, payload: set(p, "deposit", ABSENT) });
    const deposit = p["deposit"];
    if (isObj(deposit)) {
      out.push({ ...seed, payload: { ...p, deposit: set(deposit, "transaction", ABSENT) } });
      out.push({ ...seed, payload: { ...p, deposit: { ...deposit, transaction: "x" } } });
    }
    for (const t of [...odd, "DEPOSIT", ["deposit"]]) out.push({ ...seed, payload: set(p, "type", t) });
  } else if (seed["x402Version"] === 2) {
    out.push({ ...seed, payload: {} });
  }
  return out;
}

// ── What `broadcaster` gives each change, read from `bound` and `channel.kind`, not from `broadcaster`.

/** The codes an MPP charge's `bound` gives a credential of a type it does not take. */
const TYPE_CODES = new Set(["mpp/credential-type", "near/not-hash-credential"]);
/** The codes an MPP session's `bound` gives an opening of a type it does not take. */
const OPENING_TYPE_CODES = new Set(["mpp/credential-type", "mpp/not-an-opening"]);
/** The codes a session's or batch channel's `channel.kind` gives a payment of an action or type it does not take. */
const KIND_CODES = new Set(["mpp/session-action", "x402/channel-kind-unknown"]);
/** The codes a session's or batch channel's `bound` gives every payment that is not an opening: it reads none. */
const NOT_OPENING_CODES = new Set([
  "mpp/not-an-opening",
  "mpp/session-action",
  "ln/no-payment-in-action",
  "x402/not-an-opening",
]);

/**
 * The refusal `broadcaster` gives a payment whose type, action or members are changed, or undefined where it answers.
 * An MPP charge: `bound`'s code where `bound` refuses its type. The EVM `transaction` and `hash` charges, whose `bound`
 * binds nothing: `bound`'s code for a type other than the two their pairings name. A session or a batch-settlement
 * channel, by its `channel.kind`, called here:
 * - `channel.kind` refuses its action or type: `bound`'s code;
 * - `channel.kind` refuses it for anything else, and `bound` refuses it as not an opening, so does not read it:
 *   `channel.kind`'s code; where `bound` reads it (a deposit), its faults beyond the gate do not change the answer;
 * - `channel.kind` takes it: an opening of a type `bound` refuses gets `bound`'s code; on the EVM session also a
 *   voucher's opening `deposit` of a type `bound` refuses, and a top-up of a type `bound` would refuse in an opening.
 * Each payment changed here carries its seed's challenge, so `channel.kind` refuses none for the challenge.
 */
async function expected(b: Binding, m: unknown): Promise<string | undefined> {
  if (!isObj(m) || !isObj(m["payload"])) return undefined;
  const p = m["payload"];
  const code = codeOf(await b.bound(m));
  const kind = (b as { channel?: { kind: (x: never) => unknown } }).channel?.kind;
  if (kind !== undefined) {
    const k = kind(m as never);
    if (isRefusal(k)) {
      if (KIND_CODES.has(k.code)) return code;
      return code !== undefined && NOT_OPENING_CODES.has(code) ? k.code : undefined;
    }
    if (!b.id.startsWith("mpp/")) return undefined;
    if (p["action"] === "open") return code !== undefined && OPENING_TYPE_CODES.has(code) ? code : undefined;
    if (b.id !== "mpp/session/evm") return undefined;
    if (p["action"] === "voucher" && isObj(p["deposit"]) && p["deposit"]["action"] === "open") {
      return code === "mpp/credential-type" ? code : undefined;
    }
    if (p["action"] !== "topUp") return undefined;
    const asOpening = codeOf(await b.bound({ ...m, payload: { ...p, action: "open" } }));
    return asOpening === "mpp/credential-type" ? code : undefined;
  }
  if (!b.id.startsWith("mpp/")) return undefined;
  if (b.id === "mpp/charge/evm/transaction" || b.id === "mpp/charge/evm/hash") {
    return p["type"] !== "transaction" && p["type"] !== "hash" ? code : undefined;
  }
  return code !== undefined && TYPE_CODES.has(code) ? code : undefined;
}

describe("broadcaster on every pairing", () => {
  it("is on every pairing pairingsOf can name, every pairing in BINDINGS, and every pairing an entry point exports", async () => {
    expect(MPP_BINDINGS.map((b) => b.id).sort()).toEqual(Object.keys(MPP_IDS).sort());
    const missing = BINDINGS.filter((b) => typeof (b as { broadcaster?: unknown }).broadcaster !== "function").map((b) => b.id);
    expect(missing).toEqual([]);
    const exported = rowsOf(await exportedPairings(), "the entry points' exported pairings", { min: BINDINGS.length });
    const without = exported.filter((e) => typeof e.value["broadcaster"] !== "function").map((e) => `${e.entry} ${e.name}`);
    expect(without).toEqual([]);
    for (const e of exported) expect((BINDINGS as readonly unknown[]).includes(e.value), `${e.entry} ${e.name}`).toBe(true);
  });

  it("broadcaster.json names every pairing once", () => {
    expect(PAIRINGS.map((r) => r.pairing).sort()).toEqual(BINDINGS.map((b) => b.id).sort());
  });
});

describe("broadcaster by the kind of payment", () => {
  it("each pairing that answers by kind has a credential of each answer", () => {
    for (const id of MULTI) {
      const answers = new Set(KINDS.filter((k) => k.pairing === id).map((k) => k.expect));
      expect([id, [...answers].sort()]).toEqual([id, ["payee", "payer"]]);
    }
  });

  for (const row of KINDS) {
    it(row.case, async () => {
      const answer = answerOf(row.pairing);
      if (answer !== null) expect(row.expect).toBe(answer);
      expect(await byId(row.pairing).broadcaster(row.presented)).toBe(row.expect);
    });
  }
});

describe("a payment of a type, kind or shape the pairing does not take gets the refusal of what reads it", () => {
  for (const row of REFUSALS) {
    it(row.case, async () => {
      const b = byId(row.pairing);
      const presented = expand(row.presented);
      expect([codeOf(await b.bound(presented)), codeOf(await b.broadcaster(presented))]).toEqual([
        row.bound ?? row.expectRefusal,
        row.expectRefusal,
      ]);
      // A row whose `bound` names `bound`'s code is an action `bound` does not read: `channel.kind` reads it.
      if (row.bound !== undefined) {
        expect(NOT_OPENING_CODES.has(row.bound)).toBe(true);
        const kind = (b as { channel: { kind: (x: never) => unknown } }).channel.kind;
        expect(codeOf(kind(presented as never))).toBe(row.expectRefusal);
      }
    });
  }
});

describe("the fuzz: broadcaster refuses where bound or channel.kind refuses type, kind or shape, with its code", () => {
  const all = candidates();
  for (const b of BINDINGS) {
    it(`${b.id}`, { timeout: 300_000 }, async () => {
      const seeds = await seedsOf(b, all);
      expect(seeds.length, `${b.id}: a payment the pairing takes`).toBeGreaterThan(0);
      let answered = 0;
      let refused = 0;
      let handMade = 0;
      for (const seed of seeds) {
        const atSeed = codeOf(await b.bound(seed));
        const seedAnswer = await b.broadcaster(seed);
        expect(isRefusal(seedAnswer), `${b.id}: the seed is taken`).toBe(false);
        if (answerOf(b.id) !== null) expect(seedAnswer).toBe(answerOf(b.id));
        answered++;
        const changes: [unknown, "shape" | "kind" | "by hand"][] = [
          ...shapeChanges(seed).map((m): [unknown, "shape"] => [m, "shape"]),
          ...kindChanges(seed).map((m): [unknown, "kind"] => [m, "kind"]),
          ...byHand(b, seed).map((m): [unknown, "by hand"] => [m, "by hand"]),
        ];
        handMade += byHand(b, seed).length;
        for (const [m, what] of changes) {
          const fromBound = codeOf(await b.bound(m));
          const fromBroadcaster = await b.broadcaster(m);
          const label = `${b.id}, ${what}: ${JSON.stringify(m)?.slice(0, 160)}`;
          const want = what === "shape" ? (fromBound !== atSeed ? fromBound : undefined) : await expected(b, m);
          expect(codeOf(fromBroadcaster) ?? "an answer", label).toBe(want ?? "an answer");
          if (isRefusal(fromBroadcaster)) {
            refused++;
          } else {
            expect(fromBroadcaster === "payer" || fromBroadcaster === "payee", label).toBe(true);
            answered++;
          }
        }
      }
      expect(answered, `${b.id}: answers`).toBeGreaterThan(0);
      const family = b.id.startsWith("mpp/") || b.id.startsWith("x402/");
      if (family) expect(handMade, `${b.id}: payments by hand`).toBeGreaterThan(0);
      if (UNGATED.includes(b.id)) expect(refused, `${b.id}: refuses nothing`).toBe(0);
      else expect(refused, `${b.id}: refusals`).toBeGreaterThan(0);
    });
  }
});

// ── Under another challenge than the seed's, written by hand: what `bound`, `channel.kind` and `broadcaster` give.

/** The credential with its echoed request changed by `change`. */
function withRequest(c: Obj, change: (request: Obj) => unknown): Obj {
  const challenge = c["challenge"] as Obj;
  const request = JSON.parse(Buffer.from(challenge["request"] as string, "base64url").toString("utf8")) as Obj;
  const encoded = Buffer.from(JSON.stringify(change(request)), "utf8").toString("base64url");
  return { ...c, challenge: { ...challenge, request: encoded } };
}
/** The credential under its challenge in operator mode, with the request's `recipient` as the operator key. */
const operator = (c: Obj): Obj =>
  withRequest(c, (r) => {
    const details = { ...(r["methodDetails"] as Obj), voucherSigner: "operator", operator: r["recipient"] };
    return { ...r, methodDetails: details };
  });
const withPayload = (c: Obj, payload: Obj): Obj => ({ ...c, payload: { ...(c["payload"] as Obj), ...payload } });
const closeWith = (c: Obj, members: Obj): Obj => {
  const bare = set(set(c["payload"] as Obj, "voucher", ABSENT), "authentication", ABSENT);
  return { ...c, payload: { ...bare, action: "close", ...members } };
};
const otherScheme = (c: Obj): Obj => ({ ...c, accepted: { ...(c["accepted"] as Obj), scheme: "exact" } });

type ChallengeRow = {
  case: string;
  pairing: string;
  change: (seed: Obj) => unknown;
  bound: string;
  kind: string;
  broadcaster: string;
};
const SOLANA = "mpp/session/solana";
const BATCH_EVM = "x402/batch-settlement/eip155";
const BATCH_SVM = "x402/batch-settlement/solana";
const CHALLENGE_ROWS = rowsOf<ChallengeRow>(
  [
    {
      case: "operator mode: a close with authentication and no voucher is taken",
      pairing: SOLANA,
      change: (c) => closeWith(operator(c), { authentication: {} }),
      bound: "mpp/session-action",
      kind: "close",
      broadcaster: "payee",
    },
    {
      case: "operator mode: a close with neither member gets channel.kind's code",
      pairing: SOLANA,
      change: (c) => closeWith(operator(c), {}),
      bound: "mpp/session-action",
      kind: "mpp/credential-malformed",
      broadcaster: "mpp/credential-malformed",
    },
    {
      case: "operator mode: a close with a voucher gets channel.kind's code",
      pairing: SOLANA,
      change: (c) => closeWith(operator(c), { voucher: {} }),
      bound: "mpp/session-action",
      kind: "mpp/credential-malformed",
      broadcaster: "mpp/credential-malformed",
    },
    {
      case: "operator mode: a use is taken",
      pairing: SOLANA,
      change: (c) => withPayload(operator(c), { action: "use" }),
      bound: "mpp/session-action",
      kind: "within",
      broadcaster: "payee",
    },
    {
      case: "operator mode: a voucher is an action the session does not take",
      pairing: SOLANA,
      change: (c) => withPayload(operator(c), { action: "voucher" }),
      bound: "mpp/session-action",
      kind: "mpp/session-action",
      broadcaster: "mpp/session-action",
    },
    {
      case: "a close with neither member, under a challenge of another method: the challenge decides",
      pairing: SOLANA,
      change: (c) => closeWith({ ...c, challenge: { ...(c["challenge"] as Obj), method: "evm" } }, {}),
      bound: "mpp/not-this-pairing",
      kind: "mpp/not-this-pairing",
      broadcaster: "payee",
    },
    {
      case: "a close with neither member, under a request that does not decode: the challenge decides",
      pairing: SOLANA,
      change: (c) => closeWith({ ...c, challenge: { ...(c["challenge"] as Obj), request: "!" } }, {}),
      bound: "mpp/request-malformed",
      kind: "mpp/request-malformed",
      broadcaster: "payee",
    },
    {
      case: "a close with neither member, under a request whose methodDetails is not an object: the challenge decides",
      pairing: SOLANA,
      change: (c) => closeWith(withRequest(c, (r) => ({ ...r, methodDetails: "x" })), {}),
      bound: "mpp/request-malformed",
      kind: "mpp/request-malformed",
      broadcaster: "payee",
    },
    {
      case: "a refund of amount 0 whose accepted names another scheme gets channel.kind's code for the payload",
      pairing: BATCH_EVM,
      change: (c) => withPayload(otherScheme(c), { type: "refund", amount: "0" }),
      bound: "x402/option-not-this-pairing",
      kind: "x402/option-not-this-pairing",
      broadcaster: "x402/payload-malformed",
    },
    {
      case: "a payment of type transfer whose accepted names another scheme gets bound's code for the type",
      pairing: BATCH_EVM,
      change: (c) => withPayload(otherScheme(c), { type: "transfer" }),
      bound: "x402/option-not-this-pairing",
      kind: "x402/option-not-this-pairing",
      broadcaster: "x402/not-an-opening",
    },
    {
      case: "a refund whose accepted names another scheme is taken",
      pairing: BATCH_EVM,
      change: (c) => withPayload(otherScheme(c), { type: "refund" }),
      bound: "x402/option-not-this-pairing",
      kind: "x402/option-not-this-pairing",
      broadcaster: "payee",
    },
    {
      case: "a refund whose accepted names another scheme is taken",
      pairing: BATCH_SVM,
      change: (c) => withPayload(otherScheme(c), { type: "refund" }),
      bound: "x402/option-not-this-pairing",
      kind: "x402/option-not-this-pairing",
      broadcaster: "payee",
    },
    {
      case: "a payment of type transfer whose accepted names another scheme gets bound's code for the type",
      pairing: BATCH_SVM,
      change: (c) => withPayload(otherScheme(c), { type: "transfer" }),
      bound: "x402/option-not-this-pairing",
      kind: "x402/option-not-this-pairing",
      broadcaster: "x402/not-an-opening",
    },
  ],
  "the payments under another challenge",
  { exact: 13 },
);

describe("under another challenge: the challenge decides only where channel.kind reads it", () => {
  const all = candidates();
  for (const row of CHALLENGE_ROWS) {
    it(`${row.pairing}: ${row.case}`, async () => {
      const b = byId(row.pairing);
      const [seed] = await seedsOf(b, all);
      const m = row.change(seed as Obj);
      const kind = (b as { channel: { kind: (x: never) => unknown } }).channel.kind(m as never);
      const answer = await b.broadcaster(m);
      expect([codeOf(await b.bound(m)), codeOf(kind) ?? kind, codeOf(answer) ?? answer]).toEqual([
        row.bound,
        row.kind,
        row.broadcaster,
      ]);
    });
  }
});
