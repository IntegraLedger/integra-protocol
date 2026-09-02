# Evidence

A verification walk reports on the inputs it was handed. Evidence is the question of where those inputs
come from a year later, when the transaction is disputed and nobody involved is available.

An **evidence bundle** is one file that answers it: a CARv1 whose root block is a manifest listing every
artifact by **role** and **content hash**, with the artifacts themselves as the remaining blocks. Because
addressing is by hash, *"is this the evidence that was retained?"* is a computation rather than a matter of
trust.

[`@integraledger/lcp-evidence`](../../../packages/evidence/README.md) builds and checks bundles, derives their
content addresses, and — separately — resolves artifacts referenced by URL through a hardened fetcher.

## The bundle

```text
CARv1
├── root block — the manifest:  { "entries": [ { role, ref }, … ] }
├── block — the ATR bytes
├── block — the signed acceptance
└── block — …
```

Every block's CID is the raw CIDv1 of its own content, and every manifest `ref` is the `lcp:sha256:` form of
that same digest. The manifest and the blocks are therefore two spellings of one set of hashes, which is
what makes the bundle self-describing: nothing outside it has to be consulted to check it.

`verifyBundle` checks both halves of the question:

- **Integrity** — every block hashes to the CID that claims it.
- **Completeness** — every manifest reference resolves to a block that is actually present.

It **returns a value; it does not throw**. An undecodable CAR, a malformed manifest, a block that does not
hash to its CID, a reference with no block — each comes back as `{ ok: false, reason }` naming what was
wrong. A verification routine whose contract is "tell me what you found" must not turn an unreadable bundle
into an exception the caller has to catch to learn anything.

Bundles are deterministic by construction: the manifest is serialized as compact JSON with entries in
artifact order and a fixed key order, and blocks are written manifest-first followed by the artifacts in
input order. CARv1 leaves block order unspecified, so determinism is this package's to supply.

## Content addressing: the CID *is* the hash

This is the property worth stating precisely, because "content-addressed" is often looser than this.

`cidForAtrHash` takes a 32-byte SHA-256 digest and **frames** it as a raw-leaf CIDv1 — CID version `0x01`,
raw codec `0x55`, sha2-256 multihash code `0x12`, digest length `0x20`, then the digest itself. **Nothing is
re-hashed.** The CID's multihash digest *is* the ATR hash, and `atrHashFromCid` recovers it byte for byte.

The CID string and the hash string are not the same text — a CID is a multibase encoding of that whole
`01 55 12 20 <digest>` structure — but they carry the same 32 bytes, and the round trip is exact. Equally,
hashing the ATR bytes to a CID directly (`cidForBytes`) lands on the same CID, because both paths end at the
same digest.

The equivalence holds **below the 1 MiB raw-block ceiling** and not above it. Past that size an IPFS importer
chunks a file into a dag-pb tree whose root hashes *the tree*, not the content — so the CID would no longer
be the hash. Oversize input therefore fails loudly at CID-derivation time rather than silently minting a CID
that nothing matches — and the ceiling is enforced on the build path and on each block during verification,
never only at the end. The status-list decoder in [`authority`](../../../packages/authority/README.md)
mirrors the same number, so the two size gates in this codebase read alike.

## Roles

A manifest entry names *what an artifact is*, from a closed vocabulary. Eighteen roles, verbatim:

```text
atr                    referenced terms document   signed acceptance
authority chain        spend artifact              attestation
settlement             settlement-response         weld
terminal-state         witnessed-transition        timestamp
orc4-log               fulfillment                 order-state
reconciliation-id      status-list-snapshot        issuer-key-state
```

An entry may also carry an `assurance` string, which rides along for attestation entries so the readout
matches what was written.

Roles are not decoration: they are what the walk's `recourse-elections` step reads. That step asks whether
the retained package is *complete*, and completeness is defined as the presence of eight of these roles —

```text
atr   signed acceptance   authority chain   spend artifact
attestation   settlement   weld   timestamp
```

— the terms artifact and fingerprint, the acceptance and its authority chain, the spend-authorization
artifact, the identity attestations relied on, the settlement reference and its weld, and timestamps.
`fulfillment` and `order-state` are conditional on performance being disputed and are therefore not in the
required set. A package missing a required role reads as `not-attempted` with the reason
`evidence-package-incomplete` — a gap, not a contradiction. See
[verification-walk.md](verification-walk.md).

One role carries a duty the walk cannot discharge itself. Spend-authority bounds live inside the rail's own
settlement authorization, and `verify` has no rail decoder — so `recourse-elections` insists the **`spend
artifact`** is present in the package rather than re-deriving its bounds. The artifact is kept and
referenced even though its bounds are not re-checked there.

## Building and checking a bundle

```ts
import { assemble } from "@integraledger/lcp-kernel";
import {
  atrHashFromCid,
  buildBundle,
  cidForAtrHash,
  cidForBytes,
  verifyBundle,
} from "@integraledger/lcp-evidence";

const { atrBytes, atrHash } = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" },
]);

// The CID FRAMES the digest — no content is re-hashed, and the round trip is exact.
const cid = cidForAtrHash(atrHash);
console.log(cid);
console.log(atrHashFromCid(cid) === atrHash);
console.log((await cidForBytes(atrBytes)) === cid); // hashing the bytes lands on the same CID

const acceptance = new TextEncoder().encode(`{"atrHash":"${atrHash}"}`);
const bundle = await buildBundle([
  { role: "atr", bytes: atrBytes },
  { role: "signed acceptance", bytes: acceptance },
]);

console.log(bundle.root); // the MANIFEST's own CID — the CAR root
for (const e of bundle.entries) console.log(e.role.padEnd(20), e.ref);

const good = await verifyBundle(bundle.car);
console.log(good.ok);

// Flip one byte anywhere in the CAR and the block that no longer hashes to its CID is named.
const tampered = Uint8Array.from(bundle.car);
tampered.set([(tampered.at(-1) ?? 0) ^ 0x01], tampered.length - 1);
const bad = await verifyBundle(tampered);
console.log(bad.ok, "|", bad.reason);
```

```text
bafkreicdpjdnxbefwgzvkjjt2qk3uyuqutt5d72mwape43vx55r5cb2iuu
true
true
bafkreicojue6wbww2m4kfw5l5fwmnalfmswcs6vtxnmngzcrmqkz623vdu
atr                  lcp:sha256:0x437a46db8485b1b3552533d415ba6290a4e7d1ff4cb01e4e6eb7ef63d10748a5
signed acceptance    lcp:sha256:0x3d651900c509584f241e3e43084c373e7014689993915ea07b42d20a395f0b83
true
false | block bafkreib5mumqbrijlbhsihr6imeeynz6oakgrgmtsfpka62c2ifdsxylqm does not hash to its content (tamper)
```

The `atr` entry's ref is the ATR hash — the same value a settlement carries and the same value
`atr-fingerprint` recomputes. Nothing translated it; the bundle simply addresses the record by the name it
already had.

## Time, and the gate's own log

Two smaller surfaces round out what a retained package holds.

**The primary temporal anchor is the settlement's own chain inclusion.** The block that includes the welded
settlement fixes *when* without a separate timestamping authority: the same chain that carries the weld
carries the time. `settlementAnchor` builds that anchor from a settlement reference and its chain-anchored
block time. A record may additionally carry a secondary anchor, but never in place of the inclusion.

**The `orc4-log` role holds a structured, append-only record of what a gate verified** — the artifacts it
checked, the named rules that fired, any halt and its halt class, and any record-quality flags raised at the
weld boundary. `appendOrc4` returns a new log rather than mutating one; persisting it is the caller's job.
The halt class is [`binding-core`](../../../packages/binding-core/README.md)'s own three-value vocabulary,
so a gate's refusal and a walk's failed step speak the same words.

## The artifact resolver, and one honest limitation

Evidence references artifacts by URL, and on the buyer's side that URL was chosen by the counterparty.
`createHardenedResolver` treats it accordingly:

- HTTPS only.
- **Per-hop re-validation** with manual redirects, so a same-origin first hop cannot redirect into the
  private range.
- A **unicast-only IP filter**: every resolved address must be public. Loopback, RFC 1918, link-local,
  CGNAT, ULA and multicast are refused over both address families — including an IPv6 literal in its
  bracketed form and IPv4-mapped addresses in either spelling.
- Byte and time caps, the byte cap enforced **while streaming**. Reading a whole body and measuring
  afterwards protects the check but not the memory.

The limitation, stated here rather than left for a reader to find: the filter validates the addresses the
injected `lookup` returns, but `fetch` performs its **own** DNS resolution and nothing pins the connection
to the validated address. A name with a sub-second TTL can pass a public IP to the check and serve a private
one to the connection — a check-then-connect race. The filter is real defence in depth and blocks the naive
name-to-private-IP case outright; it is **not** a complete guarantee, and closing the gap requires
connection-level IP pinning inside the injected fetch. On runtimes without socket-level access the IP check
is unavailable, and such a deployment relies on the platform's own egress blocking while still getting the
per-hop re-check and the caps.

## What a bundle is not

- **Not a verdict.** A complete, intact bundle says the artifacts were retained and are unaltered. What
  they establish is the walk's readout and, past that, the elected forum's question.
- **Not a storage service.** These are bytes a party retains. Nothing in this repository operates a
  repository of them.
- **Not encrypted.** A bundle stores plaintext artifacts and addresses them by hash. Integrity is the
  property on offer here, not secrecy.

## Where next

- [verification-walk.md](verification-walk.md) — where `evidenceRoles` reaches the `recourse-elections`
  step, and what an incomplete package reads as.
- [atr.md](atr.md) — the record the `atr` role holds, and the hash the bundle addresses it by.
- [authority.md](authority.md) — the `authority chain` and `status-list-snapshot` roles, and why a snapshot
  has to be pinned rather than dereferenced.
- [evidence README](../../../packages/evidence/README.md) — the API, the CARv1 framing, and the resolver's
  options.
