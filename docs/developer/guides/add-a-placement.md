# Add a placement

## What you will have at the end

A carrier for an LCP reference inside a host protocol's own document — declared as data, readable by a
stranger holding nothing but the manifest, registered so every caller reaches it through one lookup, and
pinned by vectors that landed before the code. Most placements need no adapter body at all.

A **placement** puts a reference into a protocol document that never settles; a **binding** welds one into a
settlement that moves value. If the artifact you are writing into moves value by itself, you want
[implement-a-binding.md](implement-a-binding.md).
[concepts/bindings-vs-placements.md](../concepts/bindings-vs-placements.md) is the distinction in full,
including what each one licenses a verifier to say, and this page does not restate it.

## Step 1 — Check which of two jobs you actually have

`PlacementManifest.protocol` draws from `ProtocolId`, and unlike a binding's `rail` that set is **closed** —
ten ids, no more:

```text
x402   mpp   ap2   ack   acp   ucp   visa-tap   mastercard-vi   a2a   mcp
```

Nine of the ten have a registered placement. `mcp` does not, and that is a terminal state rather than a gap:
the specification puts MCP's surface in the delivery layer — tools, resources, prompts and a capability
negotiation map — and names no document field for a reference to ride in. A delivery surface is not a
placement.

Because the set is closed, "add a placement" is one of two very different jobs, and it is nearly always the
first.

**Adding a carrier to a protocol already in the set.** A host protocol grows a new extension point, or its
ecosystem turns out to spell an existing one two ways. That is a manifest edit plus vectors, and it is the
job this page is about.

**Adding an eleventh protocol.** That moves the closed `ProtocolId` union, the schema enum the corpus
validates against, and the corpus itself. Under [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) that is a
tier-two change: **nothing enters the standard until it is battle-tested in production use, and
standard-affecting changes require steering-committee sign-off.** A change to this repository cannot ratify
a change to the [specification](https://legalcontextprotocol.org/standard), which is published separately;
the Legal Context Protocol is co-stewarded by **Integra Ledger** and **AAA-ICDR**, and contributions and
proposals reach the maintainers through them. What helps in that case is evidence — a production deployment
that exercised the carrier, and the record of what it did.

## Step 2 — Read the host protocol's live specification, not ours

**The host protocol's own specification is binding, and LCP's appendix is an illustration.** Where the two
disagree, the host wins and the divergence is written down rather than absorbed. Every shipped placement
package records its own drift from the appendix in its README for exactly this reason: a divergence written
down is governed, and the same divergence unwritten is the defect the package exists to close.

Three consequences you will hit immediately, all of them visible in the shipped manifests:

- **The host's existing field decides the encoding.** Writing a canonical `lcp:sha256:0x…` string into a
  slot whose ecosystem holds a bare hash produces a field no counterparty parses. It is not a style choice.
- **The key is spelled the way the host spells keys.** Where a host requires a reverse-domain namespace,
  the carrier uses one; where the host imposes no namespace rule, inventing one puts a spelling on the wire
  that nobody reads.
- **Read what the ecosystem emits, write only where the protocol invited you.** An object that belongs to
  another party's namespace can be a declared read path and still never be written to.

Discharge that reading before you write a manifest, cite it in `specRef`, and record the date you read it.
A manifest asserting a shape whose owner has not defined it is the thing this discipline forbids.

## Step 3 — Declare the manifest

`PlacementManifest` is deliberately **not** a `BindingManifest`: `rail`, the recovery triple, `indexing`,
`finality`, `weldGrades` and `lifecycleStates` are all statements about a settlement, and a manifest
carrying them with hollow values would advertise properties nobody can check. What it declares instead is
where the reference sits and what a stock counterparty will do with it.

Seven required fields and four optional ones:

| Field | Required | What it states |
|---|---|---|
| `protocol` | yes | the `ProtocolId` this carrier belongs to |
| `pattern` | yes | one of `protocol-extension`, `sidecar-attestation`, `http-advisory`, `opaque-challenge` |
| `tier` | yes | `A` works against stock implementations today; `B` needs a coordinated upstream change |
| `encoding` | yes | how the reference **sits**: `lcp-string`, `reference-object`, or `bare-value` |
| `container` | yes | how the field is **reached**: `object-path`, `tagged-array`, or `header-map` |
| `field` | yes | the locator of the protocol-native field the reference occupies |
| `carrierTypes` | yes | which carrier types the field may legally hold |
| `readAlso` | no | additional shapes `extract` also accepts, and — where an entry sets `write` — also writes |
| `writeCondition` | no | the condition under which writing `field` is valid at all |
| `termsUrlFields` | no | every path carrying the human-readable terms URL, where the protocol has room for one — all written by `place`, all reconciled by `extract` |
| `specRef` | no | the citation for the host spec section that owns this field |

Four points about those fields are worth dwelling on, because each exists to stop a specific dishonesty.

**`tier` is coarse on purpose, and it is not the strength axis.** Several protocols offer more than one
Tier A carrier — a strong one that is declared and negotiated but activates only where the counterparty has
adopted it, and a weak one that is undeclared and works against every conformant implementation on day one.
Neither `tier` nor `pattern` separates those. `pattern: "protocol-extension"` is Tier B **by definition**,
and the hygiene check rejects the combination with Tier A rather than letting it ship.

**`carrierClass` is declared per carrier, on `readAlso`, and never on the manifest.** `integrity` means the
value commits to the terms document's *content*; `discovery` means it only *locates* one. A URL says where
to look and commits to nothing about what is found there. `readDeclaredPaths` labels every hit with its
class and never silently promotes a `discovery` hit; `requireIntegrity` is how a caller that cannot accept
one says so — and it checks the **value**, not only the label, so a `url` sitting in a canonical reference
field is refused rather than passed through on the strength of the slot it was found in.

**`container` is required, so `field` is always a locator rather than a name.** Three kinds, derived from
the shipped protocols rather than imagined: `object-path` for a slot addressable directly, `tagged-array`
for a reference living in an entry of a typed array, `header-map` for keys that compare case-insensitively
per RFC 9110. That two protocols with nothing else in common reduce to the same `tagged-array` rule is the
evidence the abstraction was discovered rather than invented.

**`writeCondition` is the axis none of the others expresses.** The three above describe a carrier in the
abstract; this one describes a single host **document** — the case where an otherwise-conformant write is
non-conformant depending on what the document in hand says. A gate is a conjunction of terms, each naming
an independent fact that must be true; `permits` is an allow-list because the values a gate must refuse
cannot be enumerated. And the rule when one is unmet is stated once: **a carrier whose condition is unmet is
not written.** Where that carrier is the reference field itself, nothing was placed and `place` refuses
`<protocol>/write-condition-unmet`; where it is an alias, the placement stands without it and `place`
succeeds.

## Step 4 — Build it: the manifest is the implementation

A protocol whose container is one of the three declared kinds needs **no adapter code at all**.
`makePlacement(manifest)` returns a `ReferencePlacementAdapter` — three members, no ports, no chain:

```text
interface ReferencePlacementAdapter {
  manifest: PlacementManifest;
  place(ref: LegalContextRef, doc: unknown): Outcome<unknown>;
  extract(doc: unknown): Outcome<LegalContextRef>;
}
```

There is no `observe` (no lifecycle without a settlement), no `recover` (no `SettlementRef` exists) and no
`enumerate` (nothing to forward-index). Those members are **absent rather than present-and-throwing** — a
throwing body would be an implementation in name only. Both members that exist are total and return an
`Outcome`, so a refusal is a value carrying a code and a halt class rather than an exception, and refusal
codes are namespaced from `manifest.protocol` so `a2a/reference-absent` falls out of the data.

The shipped `placement-a2a` is a manifest literal, one `makePlacement` call, and a two-line index. Here it
is doing its whole job, alongside the assertion every placement package runs from its manifest test:

```ts
import {
  assertManifestHygiene,
  type LegalContextRef,
  makePlacement,
  type PlacementManifest,
} from "@integraledger/lcp-binding-core";

const A2A: PlacementManifest = {
  protocol: "a2a",
  pattern: "http-advisory",
  tier: "A",
  encoding: "reference-object",
  container: { kind: "object-path" },
  field: "metadata.legalContext",
  readAlso: [{ path: "metadata.legal_context" }],
  carrierTypes: ["sha256", "url", "ipfs", "ar"],
  specRef:
    "A2A Task.metadata, a free-form google.protobuf.Struct with no reserved keys",
};

assertManifestHygiene(A2A);
const a2a = makePlacement(A2A);

const ref: LegalContextRef = {
  type: "sha256",
  value: "0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356",
};

// `place` is PURE — it returns a new document and never mutates the one it was handed. Sibling fields
// are preserved, because a placement writes one declared field and changes nothing else.
const placed = a2a.place({ ref }, { id: "task-1", metadata: { traceId: "abc" } });
if (!("ok" in placed)) throw new Error(placed.code);
console.log(JSON.stringify(placed.value));
console.log(JSON.stringify(a2a.extract(placed.value)));

// Hygiene is a BUILD-TIME assertion about our own manifest, so it THROWS. A refusal value would let a
// broken manifest ship as a handled case.
const attempt = (label: string, m: PlacementManifest): void => {
  try {
    assertManifestHygiene(m);
    console.log(`${label}: accepted`);
  } catch (e) {
    console.log(`${label}: ${(e as Error).message}`);
  }
};

attempt("url-only", { ...A2A, carrierTypes: ["url"] });
attempt("extension-tier-A", { ...A2A, pattern: "protocol-extension" });
attempt("alias-repeats-field", {
  ...A2A,
  readAlso: [{ path: "metadata.legalContext" }],
});
```

```text
{"id":"task-1","metadata":{"traceId":"abc","legalContext":{"type":"sha256","value":"0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356"}}}
{"ok":true,"value":{"ref":{"type":"sha256","value":"0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356"},"termsUrl":{"kind":"no-field-declared"}}}
url-only: the reference field metadata.legalContext permits no integrity-bearing carrier type (sha256/ipfs/ar) — that is discovery, not a placement
extension-tier-A: protocol-extension is Tier B by definition (LCP §8.3.6) — a Tier A claim is incoherent
alias-repeats-field: readAlso repeats the canonical field metadata.legalContext — that is a duplicate, not an alias
```

**Only paths the manifest declares are read.** There is no heuristic and no "try camelCase too": an accepted
shape that is not in `readAlso` does not exist, which is what keeps tolerance auditable. The canonical field
always wins when both it and an alias are present, so a document carrying two spellings is answered with
ours rather than with whichever happened to be enumerated first.

**Overriding a member is composition, not an escape hatch.** A protocol whose write shape is genuinely not
one of the three kinds overrides `place` and keeps the generic `extract`; the override is a named export in
that package, reviewed like any other code. A *third* override across the set would mean a container kind is
missing, not that a package is special.

## Step 5 — The exemplar

[`placement-x402`](../../../packages/placement-x402/README.md) is the one package in the set that overrides
a member, and it is the clearest example of the host protocol deciding everything. x402's extension slot
does not hold the reference: it holds `{ info, schema }`, a **wrapper** that no container kind models.
Inventing an `x402-extension` container kind would put one protocol's name inside a generic enum, so the
write half is overridden in that package instead — and its tests assert that `place` refuses exactly what a
kit adapter built from the same manifest refuses, over the same inputs and with the same codes.

x402 is also the proof that one protocol can need a binding **and** a placement: `binding-evm-x402` answers
*what did the money commit to?* and this answers *where does the reference ride on the wire?* Both are true
at the same time and neither substitutes for the other.

```ts
import type { LegalContextRef } from "@integraledger/lcp-binding-core";
import { placementFor } from "@integraledger/lcp-placements";

// Import the REGISTRY, not the package — one lookup, and adding a protocol stays a data edit.
const x402 = placementFor("x402");
if (x402 === undefined) throw new Error("x402 has no registered placement");

const m = x402.manifest;
console.log(`${m.protocol} ${m.pattern} tier-${m.tier}`);
console.log(`${m.encoding} in a ${m.container.kind} at ${m.field}`);
console.log(`readAlso: ${m.readAlso?.[0]?.path} as ${m.readAlso?.[0]?.encoding}`);
console.log(`termsUrlFields: ${m.termsUrlFields?.join(", ")}`);
console.log(`carrierTypes: ${m.carrierTypes.join(", ")}`);

const ref: LegalContextRef = {
  type: "sha256",
  value: "0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356",
};

const challenge = {
  x402Version: 2,
  accepts: [
    { scheme: "exact", network: "base-sepolia", maxAmountRequired: "25000000" },
  ],
};

const placed = x402.place(
  { ref, termsUrl: "https://seller.example/.well-known/legal-context.json" },
  challenge,
);
if (!("ok" in placed)) throw new Error(`${placed.code}: ${placed.detail}`);
console.log(JSON.stringify(placed.value));
console.log(JSON.stringify(x402.extract(placed.value)));

// A challenge carrying only the ALIAS — a bare hash, in its own declared encoding.
console.log(
  JSON.stringify(
    x402.extract({
      x402Version: 2,
      accepts: [{ scheme: "exact", extra: { atrHash: ref.value } }],
    }),
  ),
);

// Both carriers present and DISAGREEING: the declared field wins and the placement says nothing about the
// other. `readDeclaredPaths` returns the first hit, not the set — a caller that must not tolerate
// disagreement compares both itself.
console.log(
  JSON.stringify(
    x402.extract({
      extensions: { legalContext: { info: ref } },
      accepts: [{ extra: { atrHash: `0x${"bb".repeat(32)}` } }],
    }),
  ),
);

// No carrier at all: a refusal value, never a placeholder and never a throw.
console.log(JSON.stringify(x402.extract({ x402Version: 2, accepts: [] })));
```

```text
x402 http-advisory tier-A
reference-object in a object-path at extensions.legalContext.info
readAlso: accepts.0.extra.atrHash as bare-value
termsUrlFields: extensions.legalContext.info.legalContextUrl, accepts.0.extra.legalContextUrl
carrierTypes: sha256
{"x402Version":2,"accepts":[{"scheme":"exact","network":"base-sepolia","maxAmountRequired":"25000000","extra":{"atrHash":"0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356","legalContextUrl":"https://seller.example/.well-known/legal-context.json"}}],"extensions":{"legalContext":{"info":{"type":"sha256","value":"0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356","legalContextUrl":"https://seller.example/.well-known/legal-context.json"},"schema":{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"legalContext — x402 extension info","description":"The `info` payload of the `legalContext` x402 extension at challenge time: a Legal Context Protocol reference to the terms governing this transaction, plus the URL the terms document can be fetched from. The reference identifies the exact terms document; it is not the terms. This describes a technology harness and asserts nothing about whether any agreement is lawful, sound or enforceable.","type":"object","additionalProperties":false,"required":["type","value","legalContextUrl"],"properties":{"type":{"description":"The digest algorithm over the terms document. `sha256` is the only value this version defines.","type":"string","const":"sha256"},"value":{"description":"The atrHash — SHA-256 of the terms document, lowercase hex with an 0x prefix.","type":"string","pattern":"^0x[0-9a-f]{64}$"},"legalContextUrl":{"description":"Where the terms document this hash covers can be fetched. A reader verifies the document against `value`; the URL is a locator and never the authority.","type":"string","format":"uri"}}}}}}
{"ok":true,"value":{"ref":{"type":"sha256","value":"0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356"},"termsUrl":{"kind":"read","url":"https://seller.example/.well-known/legal-context.json"}}}
{"ok":true,"value":{"ref":{"type":"sha256","value":"0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356"},"termsUrl":{"kind":"declared-fields-empty","fields":["extensions.legalContext.info.legalContextUrl","accepts.0.extra.legalContextUrl"]}}}
{"ok":true,"value":{"ref":{"type":"sha256","value":"0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356"},"termsUrl":{"kind":"declared-fields-empty","fields":["extensions.legalContext.info.legalContextUrl","accepts.0.extra.legalContextUrl"]}}}
{"refused":true,"haltClass":"verification-failure","code":"x402/reference-absent","detail":"no extensions.legalContext.info on this document"}
```

Look at the two middle `extract` results — the alias-only document and the disagreeing one. The alias is
read in **its own** encoding, a bare hash where the canonical slot holds an object, which is the whole
reason a `readAlso` entry may declare an `encoding` of its own. And the canonical field wins over a
disagreeing alias without comment, because a placement is structural and does not adjudicate the host's
document.

## Step 6 — Register it

Add the registration to `PLACEMENTS` in [`placements`](../../../packages/placements/README.md). That is the
one place a protocol is registered, and it is what makes a placement reachable everywhere at once — the
conformance harness resolves the `placement` operation class through `placementFor`, so a placement
registered here is reachable on every conformance door by construction, and one that is not is unreachable
everywhere.

There are two registration shapes because the shipped placements genuinely have two. Most are
`{ kind: "singleton", adapter }` — the host protocol fixes the carrier completely. One is
`{ kind: "namespaced", build }`, because its carrier is named under the **deployment's own** reverse-DNS
namespace, which has no default. `placementFor` with no deployment then **throws**, naming what the caller
owes; it does not answer `undefined`, because `undefined` means "this protocol has no placement" and would
turn a caller's omission into a fact about the protocol.

`placementsByTier("A")` is what makes the tier operational: a deployment that will only ship what works
against stock implementations asks for `"A"` and gets exactly that, rather than reading tiers out of
documentation and hoping. It returns both `adapters` and `unconfigured`, so a namespaced registration
awaiting its namespace is reported rather than silently dropped.

## Step 7 — Vectors first, then the code

Same definition of done as a binding, and the same three non-negotiable rules from
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md):

1. **Land the failing vector first.** Add it, confirm it fails, and confirm it fails *for the reason you
   expect* — then implement. A vector written after the code merely records that the code agrees with
   itself.
2. **Re-derive pinned oracle values independently** — with something that is not this implementation — and
   show the derivation in the changeset.
3. **Record the superseded pin**: what it used to be, and why it moved.

A placement owes vectors in three corpus areas:

- **`placement.manifestSchema`** validates your manifest document against
  `vectors/placement/placement.schema.json` — the shape half, including the rules `assertManifestHygiene`
  cannot express in JSON Schema and vice versa. Neither substitutes for the other.
- **`placement.<protocol>`** is the behaviour half: one file per protocol, a case per accept-and-refuse
  path, each stating the `op` (`place` or `extract`), the input document, and the exact expected `Outcome`.
- **`placement.dispatch`** pins that a known protocol id with no placement answers the same port error as a
  token that is not a protocol id at all — never a throw.

Add a case for the carrier you are about to add, and run the corpus before writing anything:

```bash
npx @integraledger/lcp-conformance
```

```text
conformance: 844 passed, 1 failed, 0 skipped (none)
FAIL placement.a2a / extract reads the camelCase-Ref spelling some agents emit: expected {"ok":true,"value":{"ref":{"type":"sha256","value":"0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"},"termsUrl":{"kind":"no-field-declared"}}} got {"refused":true,"haltClass":"verification-failure","code":"a2a/reference-absent"}
```

That is the right failure for the right reason — the manifest declares no such path, so the read reports the
reference absent. Now add the `readAlso` entry, and the case turns green because the *manifest* changed,
not because a parser learned a new guess.

Two things to know before you run any of this. **`lcp-conformance` cannot be pointed at a third party** — it
always drives the in-process implementation, and driving a foreign one is the library API,
`runCorpus(subject, opts)` with a `CliSubject`; see [run-conformance.md](run-conformance.md). And
**`runCorpus` defaults `phase` to `"P1"`** where the CLI defaults to the wired floor. P1 is 95 cases —
roughly an eighth of the corpus — and it contains **no placement area at all**, so a library caller who
omits `phase` certifies none of the work above. State the phase, and check `report.skipped` is empty rather
than trusting a string.

Then the repository's own gates, which a new package passes like every other:

```bash
pnpm verify          # check:versions → check:docblocks → check:live-rails → corpus-seal → audit → build
                     #   → check:dist → lint → depcruise → typecheck → check:docs → test
pnpm mutation <pkg>  # the package's mutation ratchet, which only ever moves up
```

`depcruise` holds a placement package to the chain-free invariant: no placement, and not the registry
either, may import a chain library. A document that never settles rides no rail.

## What a placement is not

- **Not a weld.** It rides a document, not a movement of value. Whatever authenticated the document
  authenticated the reference; nothing authenticated a payment, because there was none.
- **Not a negotiation.** Placing a reference states which record this interaction is under. It commits
  nothing on the counterparty's behalf.
- **Not a host-protocol validator.** A placement writes and reads one declared field. Whether the rest of
  the document is conformant is the host protocol's own question — it declines to corrupt, it does not
  adjudicate.

## Where next

- [concepts/bindings-vs-placements.md](../concepts/bindings-vs-placements.md) — the two ports side by side,
  and what a placement licenses a verifier to say.
- [binding-core README](../../../packages/binding-core/README.md) — the carrier codec and the placement kit
  both halves are built from.
- [placements README](../../../packages/placements/README.md) — the registry, the two registration shapes,
  and the tier selector.
- [implement-a-binding.md](implement-a-binding.md) — the other half, for artifacts that move value.
