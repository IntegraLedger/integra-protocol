// Every pairing's `broadcaster` against vectors/broadcaster.json: who broadcasts what a payer presents under it. The
// build path's `broadcast` member is held to the same answer where each build is tested: mpp-charge.test.ts (EVM
// `transaction` and `hash`, Tempo pull and push), mpp-hedera.test.ts (the Hedera charge's push and pull) and
// mpp-session.test.ts (the EVM session's `hash` and `authorization` openings, the Tempo session's opening).
//
// `broadcaster` answers only for a payment of a type and kind the pairing takes, within the shape gate its `bound`
// applies first, and gives any other payment the refusal `bound` gives it. The fuzz below holds that over every pairing:
// from each payment a pairing takes, it changes one thing (the payload's `type`, its `action`, an opening `deposit`'s
// `type`, or the payment's shape) and asks both functions.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, isRefusal, type Binding, type Broadcaster } from "../src/index.js";
import { MPP_BINDINGS, type MppPairingId } from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/broadcaster.json", import.meta.url), "utf8"));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

type PairingRow = { pairing: string; broadcaster: Broadcaster | null; source: string };
type KindRow = { case: string; pairing: string; presented: unknown; expect: Broadcaster; source: string };
type RefusalRow = { case: string; pairing: string; presented: unknown; expectRefusal: string };

const PAIRINGS = rowsOf<PairingRow>(V.pairings, "broadcaster.json pairings", { exact: 67 });
const KINDS = rowsOf<KindRow>(V.kinds, "broadcaster.json kinds", { exact: 35 });
const REFUSALS = rowsOf<RefusalRow>(V.refusals, "broadcaster.json refusals", { exact: 35 });
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

// ── What `bound` says each change is, read from `bound` and `channel.kind`, not from `broadcaster`.

/** The codes an MPP charge's `bound` gives a credential of a type it does not take. */
const TYPE_CODES = new Set(["mpp/credential-type", "near/not-hash-credential"]);
/** The codes an MPP session's `bound` gives an opening of a type it does not take. */
const OPENING_TYPE_CODES = new Set(["mpp/credential-type", "mpp/not-an-opening"]);

/**
 * True when `bound` (or, for an action, the session's `channel.kind`) shows the changed payment is of a type or kind
 * the pairing does not take. An MPP charge: `bound` refuses its type. The EVM `transaction` and `hash` charges, whose
 * `bound` binds nothing: a type other than the two their pairings name. An MPP session: `channel.kind` refuses its
 * action, or `bound` refuses an opening's type; on the EVM session also a voucher's opening `deposit` of a type `bound`
 * refuses, and a top-up of a type `bound` would refuse in an opening. A batch-settlement channel: `channel.kind`
 * refuses its payload type.
 */
async function notTaken(b: Binding, m: unknown): Promise<boolean> {
  if (!isObj(m) || !isObj(m["payload"])) return false;
  const p = m["payload"];
  const kind = (b as { channel?: { kind: (x: never) => unknown } }).channel?.kind;
  if (b.id.startsWith("x402/batch-settlement/") && kind !== undefined) {
    const k = kind(m as never);
    return isRefusal(k) && k.code === "x402/channel-kind-unknown";
  }
  if (!b.id.startsWith("mpp/")) return false;
  if (b.id === "mpp/charge/evm/transaction" || b.id === "mpp/charge/evm/hash") return p["type"] !== "transaction" && p["type"] !== "hash";
  const code = codeOf(await b.bound(m));
  if (kind === undefined) return code !== undefined && TYPE_CODES.has(code);
  const k = kind(m as never);
  if (isRefusal(k) && k.code === "mpp/session-action") return true;
  if (p["action"] === "open") return code !== undefined && OPENING_TYPE_CODES.has(code);
  if (b.id !== "mpp/session/evm") return false;
  if (p["action"] === "voucher" && isObj(p["deposit"]) && p["deposit"]["action"] === "open") return code === "mpp/credential-type";
  if (p["action"] === "topUp") return codeOf(await b.bound({ ...m, payload: { ...p, action: "open" } })) === "mpp/credential-type";
  return false;
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

describe("a payment of a type, kind or shape the pairing does not take gets bound's refusal", () => {
  for (const row of REFUSALS) {
    it(row.case, async () => {
      const b = byId(row.pairing);
      const presented = expand(row.presented);
      expect([codeOf(await b.bound(presented)), codeOf(await b.broadcaster(presented))]).toEqual([
        row.expectRefusal,
        row.expectRefusal,
      ]);
    });
  }
});

describe("the fuzz: broadcaster refuses exactly where bound refuses the type, kind or shape, with bound's code", () => {
  const all = candidates();
  for (const b of BINDINGS) {
    it(`${b.id}`, { timeout: 300_000 }, async () => {
      const seeds = await seedsOf(b, all);
      expect(seeds.length, `${b.id}: a payment the pairing takes`).toBeGreaterThan(0);
      let answered = 0;
      let refused = 0;
      for (const seed of seeds) {
        const atSeed = codeOf(await b.bound(seed));
        const seedAnswer = await b.broadcaster(seed);
        expect(isRefusal(seedAnswer), `${b.id}: the seed is taken`).toBe(false);
        if (answerOf(b.id) !== null) expect(seedAnswer).toBe(answerOf(b.id));
        answered++;
        const changes: [unknown, "shape" | "kind"][] = [
          ...shapeChanges(seed).map((m): [unknown, "shape"] => [m, "shape"]),
          ...kindChanges(seed).map((m): [unknown, "kind"] => [m, "kind"]),
        ];
        for (const [m, what] of changes) {
          const fromBound = codeOf(await b.bound(m));
          const fromBroadcaster = await b.broadcaster(m);
          const label = `${b.id}, ${what}: ${JSON.stringify(m)?.slice(0, 160)}`;
          const refuses = what === "shape" ? fromBound !== atSeed : await notTaken(b, m);
          expect(isRefusal(fromBroadcaster), label).toBe(refuses);
          if (isRefusal(fromBroadcaster)) {
            expect(fromBroadcaster.code, label).toBe(fromBound);
            refused++;
          } else {
            expect(fromBroadcaster === "payer" || fromBroadcaster === "payee", label).toBe(true);
            answered++;
          }
        }
      }
      expect(answered, `${b.id}: answers`).toBeGreaterThan(0);
      if (UNGATED.includes(b.id)) expect(refused, `${b.id}: refuses nothing`).toBe(0);
      else expect(refused, `${b.id}: refusals`).toBeGreaterThan(0);
    });
  }
});
