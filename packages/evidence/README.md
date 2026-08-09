# @integraledger/lcp-evidence

Content-addressed evidence bundles, and a hardened resolver for fetching the artifacts they reference.

A bundle is a CARv1 file whose root block is a manifest listing every artifact by role and content hash.
Because addressing is by hash, "is this the evidence that was retained?" is a computation rather than a
matter of trust.

```bash
npm install @integraledger/lcp-evidence
```

Built on [`@integraledger/lcp-kernel`](../kernel#readme) and [`@integraledger/lcp-binding-core`](../binding-core#readme) — the `ArtifactResolver` implemented here is the port
`binding-core` declares.

## Bundles

```ts
import { buildBundle, verifyBundle } from "@integraledger/lcp-evidence";

declare const atrBytes: Uint8Array;        // the exact ATR bytes
declare const acceptanceBytes: Uint8Array;  // the signed acceptance, as received

const bundle = await buildBundle([
  { role: "atr", bytes: atrBytes },
  { role: "signed acceptance", bytes: acceptanceBytes },
]);

bundle.root;                        // "bafkreieup3nyv2mzsihypun2jbrzmrc4jx4kmdnaphzqnrjgaaojgnjmza"
const result = await verifyBundle(bundle.car);
result.ok;                          // true
```

`verifyBundle` checks both halves of the question: **integrity** (every block hashes to the CID that
claims it) and **completeness** (every manifest reference resolves to a block that is present). Flip one
byte anywhere in the CAR and it returns `{ ok: false, reason }` naming the block.

It returns a value; it does not throw. A verification routine whose contract is "tell me what you found"
must not turn an unreadable bundle into an exception the caller has to catch to learn anything.

## CID == ATR hash

```ts
import { cidForAtrHash, atrHashFromCid } from "@integraledger/lcp-evidence";

cidForAtrHash("0x7f7f…"); // a raw-leaf CIDv1 framing that exact digest — nothing is re-hashed
```

A raw-leaf CIDv1 frames the ATR hash's own 32 bytes, so the CID's digest *is* the ATR hash rather than a
hash of it. That equivalence holds only below the 1 MiB raw-block ceiling: above it, an IPFS importer
chunks the file into a dag-pb tree whose root hashes the tree, not the content. Oversize input therefore
fails loudly at CID-derivation time instead of silently minting a CID that nothing matches.

## The artifact resolver

Evidence references artifacts by URL, and on the buyer's side that URL was chosen by the counterparty.
`createHardenedResolver` treats it accordingly:

- HTTPS only.
- **Per-hop re-validation** with manual redirects, so a same-origin first hop cannot redirect into the
  private range.
- A **unicast-only IP filter**: every resolved address must be public. Loopback, RFC 1918, link-local,
  CGNAT, ULA and multicast are refused, over both address families — including an IPv6 literal host in its
  bracketed form, and IPv4-mapped addresses in either dotted or hex spelling.
- Byte and time caps, the byte cap enforced **while streaming**. Reading a whole body and measuring
  afterwards protects the check but not the memory.

```ts
import { isUnicastPublic } from "@integraledger/lcp-evidence";

isUnicastPublic("93.184.216.34");    // true
isUnicastPublic("[::1]");            // false
isUnicastPublic("169.254.169.254");  // false — cloud metadata
```

### An honest limitation

The unicast filter validates the addresses the injected `lookup` returns, but `fetch` performs its **own**
DNS resolution and nothing pins the connection to the validated address. An attacker-controlled name with
a sub-second TTL can therefore pass a public IP to the check and serve a private one to the connection —
a classic check-then-connect race.

This filter is real defense-in-depth: it blocks the naive name-to-private-IP case outright. It is **not**
a complete guarantee, and closing the gap requires connection-level IP pinning inside the injected fetch.
Stated here rather than left for a reader to discover.

On runtimes without socket-level access the IP check is unavailable; such a deployment relies on the
platform's own private-range egress blocking and still gets the per-hop re-check and the caps.

## Requirement ids

This package's source and its messages cite short ids — `ATA-3`, `RCS-5`, `CMP-6` and their kin.
**They are not LCP clause numbers.** LCP is cited by section (`§8.3.1`, `§C.2`); anything shaped `XXX-n`
comes from Integra's functional specification of what a complete agent transaction requires, the fourteen
families below. Nothing in this package's behaviour depends on them, and where an id and an LCP section
disagree the section governs.

| | | | |
|---|---|---|---|
| `IDN` identity | `ASP` authority to spend | `ATA` authority to accept terms | `TRM` the terms record |
| `RCS` recourse | `PAY` payment and settlement | `WLD` the transactional weld | `OFR` offer integrity |
| `FRC` fraud, risk, and compliance | `OPS` commercial operations | `DSC` discovery and reputation | `ORC` orchestration |
| `CMP` composition | `PRS` persistence and verification infrastructure | | |

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
