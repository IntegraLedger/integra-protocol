import {
  assertManifestHygiene,
  KNOWN_PROTOCOL_IDS,
  type ProtocolId,
} from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import {
  PLACEMENTS,
  placementFor,
  placementsByTier,
  supportedProtocols,
} from "../src/index.js";

/**
 * A deployment namespace that is deliberately NOT ours.
 *
 * `com.integraledger` is the value ruled for this deployment (2026-07-29) and the value the
 * conformance vectors ride, so a registry that silently defaulted the namespace would pass every assertion
 * below if the tests used it. Using a foreign namespace here is what makes "never defaults" checkable.
 */
const DEPLOYMENT = { reverseDomain: "com.example" } as const;

/** A second, different namespace — two deployments must get two different carriers, never a shared one. */
const OTHER_DEPLOYMENT = { reverseDomain: "net.other" } as const;

describe("the placement registry", () => {
  it("returns an adapter for a protocol that has one", () => {
    expect(placementFor("acp")?.manifest.protocol).toBe("acp");
  });

  it("returns undefined for a known protocol with no placement — never throws, never guesses", () => {
    // The plan's example was `x402`, which HAS a placement since P7 landed. `mcp` is now the only member of
    // the closed `ProtocolId` set with no placement package, so it is the only honest way to state this rule
    // — and re-deriving it here is the point: an absence asserted against a protocol that has since been
    // built would read green while certifying nothing.
    expect(placementFor("mcp")).toBeUndefined();
    expect(KNOWN_PROTOCOL_IDS).toContain("mcp");
  });

  it("lists exactly the protocols it can actually place", () => {
    for (const id of supportedProtocols())
      expect(placementFor(id, DEPLOYMENT)).toBeDefined();
  });

  it("every registered adapter's key matches its own manifest — no mis-filing", () => {
    // The failure this catches is the one the conformance corpus hit head-on: a key that does not equal the
    // manifest's own `protocol` answers `unknown-placement-protocol` for the id on the wire while serving a
    // foreign adapter to anyone who spells the key. Both registration kinds are checked, because a factory
    // is exactly as mis-fileable as a singleton.
    for (const id of supportedProtocols())
      expect(placementFor(id, DEPLOYMENT)?.manifest.protocol).toBe(id);
  });

  it("every registered protocol id is a known protocol id", () => {
    for (const id of supportedProtocols())
      expect(KNOWN_PROTOCOL_IDS).toContain(id);
  });

  it("enumerates in the closed set's own order, so two implementations agree on more than membership", () => {
    // `KNOWN_PROTOCOL_IDS` preserves the schema enum's order by contract. Registering in that order means
    // `supportedProtocols()` is a filter of it rather than an accident of who landed first, so a caller
    // rendering the list gets a stable answer and a new placement cannot be appended out of order unnoticed.
    expect(supportedProtocols()).toEqual(
      KNOWN_PROTOCOL_IDS.filter((id) => PLACEMENTS[id] !== undefined),
    );
    expect(supportedProtocols()).toEqual([
      "x402",
      "mpp",
      "ap2",
      "ack",
      "acp",
      "ucp",
      "visa-tap",
      "mastercard-vi",
      "a2a",
    ]);
  });

  it("every adapter reachable through the registry carries a coherent manifest", () => {
    // Each package already asserts its own hygiene. What only the aggregate can check is that the manifest
    // the REGISTRY hands out is the coherent one — for the built member, that is a manifest no package test
    // ever sees, because it does not exist until a namespace is supplied.
    for (const id of supportedProtocols()) {
      const adapter = placementFor(id, DEPLOYMENT);
      expect(adapter).toBeDefined();
      if (adapter === undefined) continue;
      expect(() => assertManifestHygiene(adapter.manifest)).not.toThrow();
    }
  });

  it("partitions by tier so a deployment can select only what works today", () => {
    const a = placementsByTier("A", DEPLOYMENT);
    expect(a.adapters.length).toBeGreaterThan(0);
    for (const p of a.adapters) expect(p.manifest.tier).toBe("A");
    expect(a.adapters.map((p) => p.manifest.protocol)).toEqual([
      "x402",
      "mpp",
      "ap2",
      "ack",
      "acp",
      "ucp",
      "visa-tap",
      "a2a",
    ]);
    expect(a.unconfigured).toEqual([]);
  });

  it("the two tiers partition the whole registry — no adapter falls outside both", () => {
    const a = placementsByTier("A", DEPLOYMENT);
    const b = placementsByTier("B", DEPLOYMENT);
    for (const p of b.adapters) expect(p.manifest.tier).toBe("B");
    expect(b.adapters.map((p) => p.manifest.protocol)).toEqual([
      "mastercard-vi",
    ]);
    expect(
      [...a.adapters, ...b.adapters].map((p) => p.manifest.protocol).sort(),
    ).toEqual([...supportedProtocols()].sort());
  });

  it("mastercard-vi is a FACTORY: no namespace, no adapter — and never a default", () => {
    // The registry may not invent the namespace. LCP §8 canonizes no per-protocol profile, and a default
    // would put OUR reverse domain inside a consumer's signed Layer-2 mandate in every deployment that
    // forgot to pass one. So the absence of a namespace is a caller defect, thrown loudly, and never an
    // `undefined` that reads as "mastercard-vi has no placement".
    expect(() => placementFor("mastercard-vi")).toThrow(/mastercard-vi/);
    expect(() => placementFor("mastercard-vi")).toThrow(/no default/);
    expect(PLACEMENTS["mastercard-vi"]?.kind).toBe("namespaced");
  });

  it("the namespace the deployment supplies is the namespace that lands", () => {
    const mine = placementFor("mastercard-vi", DEPLOYMENT);
    const theirs = placementFor("mastercard-vi", OTHER_DEPLOYMENT);
    expect(mine?.manifest.field).toBe(
      "constraints[type=com.example.lcp_terms_hash].value",
    );
    expect(theirs?.manifest.field).toBe(
      "constraints[type=net.other.lcp_terms_hash].value",
    );
    // Two deployments, two carriers. Reading one deployment's constraint as another's would attribute one
    // party's terms to another party's credential, which is why the tag is matched exactly on read.
    expect(mine?.manifest.field).not.toBe(theirs?.manifest.field);
    expect(JSON.stringify(mine?.manifest)).not.toContain("integraledger");
  });

  it("the factory's own guards are not bypassed by registration", () => {
    // A registry that pre-built and cached an adapter would answer for a namespace the factory refuses.
    // `org.legalcontextprotocol` is reserved for a TSC-ratified capability (ruled 2026-07-29) and must not
    // reach a consumer credential; the empty and malformed cases are the factory's other two guards.
    expect(() =>
      placementFor("mastercard-vi", {
        reverseDomain: "org.legalcontextprotocol",
      }),
    ).toThrow(/reserved/);
    expect(() =>
      placementFor("mastercard-vi", { reverseDomain: "" }),
    ).toThrow();
    expect(() =>
      placementFor("mastercard-vi", { reverseDomain: "com.Example" }),
    ).toThrow();
  });

  it("a tier query with no namespace REPORTS the member it cannot build, never drops it", () => {
    // The silent version of this is the defect: "every Tier B placement" answered with an empty array, while
    // a Tier B placement sits registered one namespace away, is a hole read as a fact. The A query is
    // unaffected in its adapters and still names what it could not classify.
    const b = placementsByTier("B");
    expect(b.adapters).toEqual([]);
    expect(b.unconfigured).toEqual(["mastercard-vi"]);

    const a = placementsByTier("A");
    expect(a.unconfigured).toEqual(["mastercard-vi"]);
    expect(a.adapters.map((p) => p.manifest.protocol)).toEqual(
      placementsByTier("A", DEPLOYMENT).adapters.map(
        (p) => p.manifest.protocol,
      ),
    );
  });

  it("resolves the placement half of MPP, which is not either MPP binding", () => {
    // Owed by P8 step 6: the assertion was written against this registry before it existed, and it cannot
    // live in `placement-mpp`'s own tests — this package depends on that one, so the reverse edge is a cycle
    // that `depcruise`'s no-circular rule refuses. `http-advisory` is the pattern that says only the two MPP
    // bindings may claim a settlement weld.
    expect(placementFor("mpp")?.manifest.pattern).toBe("http-advisory");
    expect(placementFor("mpp")?.manifest.protocol).toBe("mpp");
  });

  it("hands back live adapters, not manifests — the reference round-trips through the registry", () => {
    // The registry's whole purpose is that a caller stops importing placement packages by hand. That only
    // holds if what comes back can actually place and extract; a registry of manifests would type-check
    // identically at the call site and be useless at it.
    const adapter = placementFor("a2a");
    expect(adapter).toBeDefined();
    if (adapter === undefined) return;
    const ref = {
      type: "sha256" as const,
      value:
        "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
    };
    const placed = adapter.place({ ref }, { id: "task-1" });
    expect("ok" in placed).toBe(true);
    if (!("ok" in placed)) return;
    expect(adapter.extract(placed.value)).toEqual({
      ok: true,
      value: { ref, termsUrl: { kind: "no-field-declared" } },
    });
  });

  it("holds one entry per protocol — a second registration of the same id is unrepresentable", () => {
    // Stated as a test because the alternative design (a singleton map plus a separate factory map) admits
    // an id in both, where two callers reach two different adapters for one protocol. One keyed union makes
    // that shape impossible, and this pins the count that proves the union carries both kinds.
    const kinds = supportedProtocols().map((id) => PLACEMENTS[id]?.kind);
    expect(kinds.filter((k) => k === "singleton").length).toBe(8);
    expect(kinds.filter((k) => k === "namespaced").length).toBe(1);
    expect(Object.keys(PLACEMENTS).length).toBe(supportedProtocols().length);
  });

  it("does not walk prototype keys — this is the dispatch point wire tokens arrive at", () => {
    // `PLACEMENTS` is an object, so a bare index reads the prototype chain. Without the own-property guard
    // `PLACEMENTS["toString"]` is `Object.prototype.toString`: not `undefined`, not `kind: "singleton"`, so
    // control reaches the `namespaced` arm and the registry either asserts a namespace requirement about a
    // protocol that does not exist or throws a raw `TypeError` on `registration.build`. Every one of these
    // must be an ordinary absence instead. The casts are the point: `ProtocolId` is a compile-time closed
    // set, and U1 (counterparty wire documents) and U5 (an MCP tool argument) hand this function a token a
    // remote party chose.
    for (const hostile of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
      "isPrototypeOf",
    ]) {
      const key = hostile as unknown as ProtocolId;
      expect(placementFor(key)).toBeUndefined();
      expect(placementFor(key, DEPLOYMENT)).toBeUndefined();
      expect(supportedProtocols()).not.toContain(key);
    }
  });

  it("is frozen — the one place a protocol is registered stays the one place", () => {
    // The keyed union makes a SECOND registration of an id unrepresentable in the source. It says nothing
    // about a consumer mutating the export after import, which would change what `placementFor` and
    // `supportedProtocols` answer for every caller in the process. Both statements below are compile errors
    // under the `Readonly` type (TS2540 and TS2704), so the runtime check is what this test can still make:
    // a published package is consumed as JavaScript, where the type is gone and only the freeze remains.
    expect(Object.isFrozen(PLACEMENTS)).toBe(true);
    const mutable = PLACEMENTS as Record<string, unknown>;
    // THE THROW IS STRICT-MODE ONLY, and the distinction is not pedantry — a probe of the built `dist` from
    // `node -e` (CommonJS, sloppy mode) showed the same assignment failing SILENTLY. This file is ESM, where
    // strict mode is not optional, so the throw is the correct assertion here; the invariant that holds in
    // both modes is the one asserted after it. Claiming "it throws" without qualification would be a claim
    // about the caller's module system rather than about this package.
    expect(() => {
      mutable["mcp"] = PLACEMENTS.acp;
    }).toThrow(TypeError);
    expect(() => {
      delete mutable["acp"];
    }).toThrow(TypeError);
    // What the freeze guarantees regardless of the caller's strictness: the write does not land.
    expect(placementFor("mcp")).toBeUndefined();
    expect(placementFor("acp")?.manifest.protocol).toBe("acp");
    expect(supportedProtocols()).toHaveLength(9);
  });

  it("is not a second place a protocol id is spelled", () => {
    // A registry keyed by anything other than `ProtocolId` would be a parallel vocabulary. The keys are the
    // closed set's own tokens — hyphens included, which is the mistake the conformance map's comment records.
    const ids: readonly string[] = KNOWN_PROTOCOL_IDS;
    for (const key of Object.keys(PLACEMENTS)) expect(ids).toContain(key);
    expect(Object.keys(PLACEMENTS)).toContain("visa-tap");
    expect(Object.keys(PLACEMENTS)).not.toContain("visaTap");
  });
});
