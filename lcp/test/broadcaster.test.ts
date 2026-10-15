// Every pairing's `broadcaster` against vectors/broadcaster.json: who broadcasts what a payer presents under it. The
// build path's `broadcast` member is held to the same answer where each build is tested: mpp-charge.test.ts (EVM
// `transaction` and `hash`, Tempo pull and push), mpp-hedera.test.ts (the Hedera charge's push and pull) and
// mpp-session.test.ts (the EVM session's `hash` and `authorization` openings, the Tempo session's opening).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, isRefusal, type Binding, type Broadcaster } from "../src/index.js";
import { MPP_BINDINGS, type MppPairingId } from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/broadcaster.json", import.meta.url), "utf8"));
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

type PairingRow = { pairing: string; broadcaster: Broadcaster | null; source: string };
type KindRow = { case: string; pairing: string; presented: unknown; expect: Broadcaster; source: string };
type RefusalRow = { case: string; pairing: string; presented: unknown; expectRefusal: string };

const PAIRINGS = rowsOf<PairingRow>(V.pairings, "broadcaster.json pairings", { exact: BINDINGS.length });
const KINDS = rowsOf<KindRow>(V.kinds, "broadcaster.json kinds", { exact: 30 });
const REFUSALS = rowsOf<RefusalRow>(V.refusals, "broadcaster.json refusals", { exact: 17 });
const MULTI = PAIRINGS.filter((r) => r.broadcaster === null).map((r) => r.pairing);

const byId = (id: string): Binding => {
  const b = BINDINGS.find((x) => x.id === id);
  if (b === undefined) throw new Error(`no pairing ${id}`);
  return b;
};
const codeOf = (v: unknown): string | undefined => (isRefusal(v) ? v.code : undefined);

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

  const ANY: readonly unknown[] = [undefined, null, "x", 0, {}, { challenge: {}, payload: {} }, ...KINDS.map((k) => k.presented)];
  for (const row of PAIRINGS.filter((r) => r.broadcaster !== null)) {
    it(`${row.pairing}: ${row.broadcaster}, read from nothing presented`, async () => {
      const b = byId(row.pairing);
      for (const presented of ANY) expect(await b.broadcaster(presented)).toBe(row.broadcaster);
    });
  }
});

describe("broadcaster by the kind of payment", () => {
  it("each pairing that answers by kind has a credential of each answer", () => {
    for (const id of MULTI) {
      const answers = new Set(KINDS.filter((k) => k.pairing === id).map((k) => k.expect));
      expect([id, [...answers].sort()]).toEqual([id, ["payee", "payer"]]);
    }
    expect(KINDS.every((k) => MULTI.includes(k.pairing))).toBe(true);
  });

  for (const row of KINDS) {
    it(row.case, async () => {
      expect(await byId(row.pairing).broadcaster(row.presented)).toBe(row.expect);
    });
  }
});

describe("a credential whose kind cannot be read gets bound's refusal", () => {
  for (const row of REFUSALS) {
    it(row.case, async () => {
      const b = byId(row.pairing);
      expect([codeOf(await b.bound(row.presented)), codeOf(await b.broadcaster(row.presented))]).toEqual([
        row.expectRefusal,
        row.expectRefusal,
      ]);
    });
  }

  // Each kinds row taken apart: where bound and broadcaster both refuse, they give one code.
  const mutations = (c: unknown): unknown[] => {
    if (typeof c !== "object" || c === null) return [c];
    const r = c as { challenge?: Record<string, unknown>; payload?: Record<string, unknown> };
    const p = r.payload ?? {};
    const deposit = typeof p["deposit"] === "object" && p["deposit"] !== null ? (p["deposit"] as Record<string, unknown>) : undefined;
    return [
      { ...r, payload: { ...p, type: "bogus" } },
      { ...r, payload: { ...p, action: "bogus" } },
      { ...r, payload: { ...p, type: 7, action: 7 } },
      { ...r, payload: "x" },
      { ...r, payload: undefined },
      { ...r, challenge: undefined },
      { ...r, challenge: { ...r.challenge, id: 5 } },
      { ...r, challenge: { ...r.challenge, opaque: "!" }, payload: { ...p, type: "bogus", action: "bogus" } },
      { ...r, challenge: { ...r.challenge, method: "other" }, payload: { ...p, type: "bogus", action: "bogus" } },
      ...(deposit === undefined ? [] : [{ ...r, payload: { ...p, deposit: { ...deposit, type: "bogus" } } }]),
    ];
  };

  for (const id of MULTI) {
    it(`${id}: bound and broadcaster never refuse one input with two codes`, async () => {
      const b = byId(id);
      let both = 0;
      for (const k of KINDS.filter((x) => x.pairing === id)) {
        for (const m of mutations(k.presented)) {
          const [fromBound, fromBroadcaster] = [codeOf(await b.bound(m)), codeOf(await b.broadcaster(m))];
          if (fromBound === undefined || fromBroadcaster === undefined) continue;
          both++;
          expect(fromBroadcaster, `${k.case}: ${JSON.stringify(m).slice(0, 120)}`).toBe(fromBound);
        }
      }
      expect(both).toBeGreaterThan(0);
    });
  }
});
