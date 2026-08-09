import type {
  PlacementTier,
  ProtocolId,
  ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { a2aPlacement } from "@integraledger/lcp-placement-a2a";
import { ackPlacement } from "@integraledger/lcp-placement-ack";
import { acpPlacement } from "@integraledger/lcp-placement-acp";
import { ap2Placement } from "@integraledger/lcp-placement-ap2";
import { makeMastercardViPlacement } from "@integraledger/lcp-placement-mastercard-vi";
import { mppPlacement } from "@integraledger/lcp-placement-mpp";
import { ucpPlacement } from "@integraledger/lcp-placement-ucp";
import { visaTapPlacement } from "@integraledger/lcp-placement-visa-tap";
import { x402Placement } from "@integraledger/lcp-placement-x402";

/**
 * What a deployment supplies before the parameterized placements can be built.
 *
 * Config a deployment OWNS, never a constructed adapter: the moment a caller hands the registry an adapter,
 * the registry has stopped being the one place a protocol is registered.
 */
export type PlacementDeployment = {
  /**
   * The deployment's own reverse-domain namespace.
   *
   * REQUIRED by every `namespaced` registration and defaulted by none. LCP §8 canonizes no per-protocol
   * integration profile, so a default would write OUR domain into a counterparty's signed document in every
   * deployment that forgot to pass one. The receiving factory validates it; the registry does not
   * pre-validate, so its guards are never bypassed or duplicated here.
   */
  readonly reverseDomain: string;
};

/**
 * How one protocol's placement is obtained.
 *
 * TWO shapes because the registered placements genuinely have two shapes, and flattening them would cost
 * either correctness or honesty. Eight are singletons whose carrier the host protocol fixes completely.
 * Mastercard VI's carrier is a custom Layer-2 constraint type under the deployment's own reverse-DNS
 * namespace, which has no default — so it ships as a factory, and a map of adapters could only hold it by
 * inventing the namespace.
 *
 * ONE keyed union rather than a singleton map beside a factory map: two maps admit an id in both, where two
 * callers reach two different adapters for one protocol and neither is wrong. A single key cannot.
 */
export type PlacementRegistration =
  | { readonly kind: "singleton"; readonly adapter: ReferencePlacementAdapter }
  | {
      readonly kind: "namespaced";
      readonly build: (reverseDomain: string) => ReferencePlacementAdapter;
    };

/**
 * Every reference placement this build can perform, keyed by `ProtocolId`.
 *
 * THE registry — the one place a protocol is registered, so that adding one is a data edit plus an import and
 * never a change to a caller. The conformance subject, the universal buyer parser and the universal seller
 * surface all dispatch through here rather than each keeping a map that can drift.
 *
 * A `Partial` record on purpose: `mcp` is a known protocol id that is **not a field placement at all**. LCP
 * v1.38 §C.9 and §10 describe an LCP-aware MCP *server* — tools, resources and prompts, plus a
 * `capabilities.extensions` negotiation map — with no document field for a reference to ride in. So its
 * absence is the correct terminal state, not a gap awaiting a `placement-mcp`, and certainly not a hole to
 * fill with a stub that throws. Note that a protocol can be registered here AND carry a settlement binding
 * elsewhere — x402 does both, and the two registrations answer different questions (where the reference
 * rides vs. how the settlement is welded).
 *
 * ORDERED as `KNOWN_PROTOCOL_IDS` orders the closed set, which is the schema enum's order. Registration
 * order is enumeration order, so keeping the two aligned makes `supportedProtocols()` a filter of the closed
 * set rather than an accident of which unit landed first.
 *
 * `Readonly` AND `Object.freeze`, because "the one place a protocol is registered" is the whole argument for
 * the keyed union and an exported mutable object does not make it true. The keyed union rules out a *second*
 * registration in the source; only immutability rules out a consumer adding, replacing or deleting one at
 * runtime and changing what `placementFor` and `supportedProtocols` answer thereafter. The type stops it in
 * TypeScript (assignment TS2540, `delete` TS2704); the freeze stops it in plain JavaScript, which is what a
 * published package is consumed as. Stated precisely, because it was measured both ways: the freeze
 * guarantees the write does not LAND. Whether it throws is the caller's strict-mode setting — ESM importers
 * get a `TypeError`, a sloppy-mode CommonJS caller gets a silent no-op — so the registry the next lookup
 * reads is unchanged either way, which is the property that matters.
 */
export const PLACEMENTS: Readonly<
  Partial<Record<ProtocolId, PlacementRegistration>>
> = Object.freeze({
  x402: { kind: "singleton", adapter: x402Placement },
  mpp: { kind: "singleton", adapter: mppPlacement },
  ap2: { kind: "singleton", adapter: ap2Placement },
  ack: { kind: "singleton", adapter: ackPlacement },
  acp: { kind: "singleton", adapter: acpPlacement },
  ucp: { kind: "singleton", adapter: ucpPlacement },
  // The key is the LCP protocol id, hyphen included — a camelCased key would be a second spelling of a
  // protocol whose id is closed, and every wire that says `visa-tap` would miss it.
  "visa-tap": { kind: "singleton", adapter: visaTapPlacement },
  // BUILT, not imported: the constraint namespace is the deployment's and has no default. The factory
  // validates it (empty, non-reverse-DNS and the reserved `org.legalcontextprotocol` are all refused), so it
  // is passed through unexamined — a second copy of those rules here could disagree with the first.
  "mastercard-vi": { kind: "namespaced", build: makeMastercardViPlacement },
  a2a: { kind: "singleton", adapter: a2aPlacement },
});

/**
 * The registrations as entries, with the key and value narrowed once.
 *
 * `Object.entries` widens the key to `string` and, over an optional-property record, the value to
 * `PlacementRegistration | undefined`. Both are artefacts of the index type rather than shapes that can
 * occur: every key present in `PLACEMENTS` was written with a value. Narrowed here, with the reason, instead
 * of at each use — and never with a `!`, which would say nothing about why.
 */
function registrations(): readonly (readonly [
  ProtocolId,
  PlacementRegistration,
])[] {
  return Object.entries(PLACEMENTS) as readonly (readonly [
    ProtocolId,
    PlacementRegistration,
  ])[];
}

/**
 * Turn one registration into an adapter, or THROW naming what the caller owes.
 *
 * A namespaced registration with no deployment is a caller defect, not an absence: the placement exists and
 * is reachable the moment a namespace is supplied. Answering `undefined` would report it as "this protocol
 * has no placement", which is the silent hole this package exists to close, and defaulting the namespace
 * would be worse — a signed document carrying a domain nobody chose.
 */
function buildRegistration(
  protocol: ProtocolId,
  registration: PlacementRegistration,
  deployment: PlacementDeployment | undefined,
): ReferencePlacementAdapter {
  if (registration.kind === "singleton") return registration.adapter;
  if (deployment === undefined)
    throw new Error(
      `${protocol} is a namespaced placement: its carrier sits under the deployment's own reverse-domain namespace, which has no default — supply { reverseDomain }`,
    );
  return registration.build(deployment.reverseDomain);
}

/**
 * The adapter for a protocol, or `undefined` when this build has no placement for it.
 *
 * TOTAL over the closed protocol set — a caller decides what an absence means, and gets an absence only for a
 * protocol that genuinely has no placement. `deployment` is optional because most protocols need nothing from
 * it; omitting it against a `namespaced` registration throws rather than silently answering `undefined`.
 *
 * OWN properties only. `PLACEMENTS` is an object, so a bare index reads through the prototype chain and
 * `PLACEMENTS["toString"]` answers `Object.prototype.toString` — a value that is not `undefined`, is not
 * `kind: "singleton"`, and therefore reaches the `namespaced` arm, where the registry either asserts a
 * namespace requirement about a protocol that does not exist or throws a raw `TypeError` on
 * `registration.build`. `protocol` is typed `ProtocolId`, but this is the dispatch point a wire token and an
 * MCP tool argument arrive at, and a cast at one caller would be enough. Same guard, same reason, as
 * `binding-core`'s `readAtPath` (the repository's read-path tests — "does not walk prototype keys").
 *
 * ONE guard, not two. `Object.hasOwn` as a separate early return would leave the `=== undefined` check that
 * follows it unreachable — `Partial` admits `undefined` in the value type, but no key here is written with
 * one, so an own key always has a registration. Mutation testing is what says so out loud: with two guards,
 * neutering the second to `if (false)` SURVIVES, which is the instrument reporting a branch no input can take.
 * Folding the own-property test into the lookup leaves exactly one reachable absence and both mutants die.
 */
export function placementFor(
  protocol: ProtocolId,
  deployment?: PlacementDeployment,
): ReferencePlacementAdapter | undefined {
  const registration = Object.hasOwn(PLACEMENTS, protocol)
    ? PLACEMENTS[protocol]
    : undefined;
  if (registration === undefined) return undefined;
  return buildRegistration(protocol, registration, deployment);
}

/** Every protocol this build can place a reference into, in the closed set's own order. */
export function supportedProtocols(): readonly ProtocolId[] {
  return registrations().map(([protocol]) => protocol);
}

/**
 * The answer to a tier query: what this deployment can build at that tier, and what it could not classify.
 *
 * `unconfigured` is the load-bearing half. A tier query is a question about a WHOLE set ("everything I can
 * ship against stock implementations"), and a namespaced registration cannot be classified at all until its
 * namespace arrives — the tier is a property of the built manifest. Dropping it would answer "no Tier B
 * placements exist" while one sits registered a namespace away, which is a hole read as a fact. Reporting it
 * instead of throwing keeps the caller from inventing a namespace to satisfy a signature, which is the one
 * outcome worse than the hole.
 */
export type TierSelection = {
  /** The placements at the requested tier, in registration order. */
  readonly adapters: readonly ReferencePlacementAdapter[];
  /** Registered protocols whose tier is unknown because the deployment supplied nothing they require. */
  readonly unconfigured: readonly ProtocolId[];
};

/**
 * The placements at one §8.3 wire-compatibility tier.
 *
 * The selector that makes the host-governs rule operational: a deployment that will only ship what works against stock
 * implementations asks for `"A"` and gets exactly that, rather than reading tiers out of documentation and
 * hoping. Tier B adapters remain constructible — they are simply never returned to a Tier-A caller.
 */
export function placementsByTier(
  tier: PlacementTier,
  deployment?: PlacementDeployment,
): TierSelection {
  const adapters: ReferencePlacementAdapter[] = [];
  const unconfigured: ProtocolId[] = [];
  for (const [protocol, registration] of registrations()) {
    if (registration.kind === "namespaced" && deployment === undefined) {
      unconfigured.push(protocol);
      continue;
    }
    const adapter = buildRegistration(protocol, registration, deployment);
    if (adapter.manifest.tier === tier) adapters.push(adapter);
  }
  return { adapters, unconfigured };
}
