# Getting started

## What you will have at the end

An assembled **ATR** — one canonical JSON document naming the terms, the parties, and the commercial slots
of a transaction — the **ATR hash** over its exact bytes, and a verification walk over that record which
reports, step by step, what it could establish and what it could not. About thirty minutes.

Nothing here touches a chain or a network. `assemble` is pure over its slots, and the walk is pure
over the inputs it is handed; both run locally, offline, and deterministically. The same slots in
produce the same bytes out, which is what makes the hash recomputable by anyone holding those bytes.

You need Node 24 or newer. Every package in this repository is ESM-only.

## Install

Packages publish to **npmjs.com** under the `@integraledger` scope at `access: public`. Nothing needs
configuring — no `.npmrc`, no registry line, no token:

```bash
npm install @integraledger/lcp-kernel @integraledger/lcp-verify
```

`kernel` assembles and hashes the record and carries zero runtime dependencies. `verify` runs the walk and
emits its canonical report.

## Assemble and hash

The record below names its terms document by content hash rather than embedding it, which is what lets the
terms be any bytes at all — prose, a PDF, a signed template. Write one:

```bash
cat > terms.txt <<'EOF'
Example Seller supplies Example Buyer with 1000 API calls for 25.00 USDC,
payable on delivery. These are the complete terms of that transaction.
EOF
```

Hash it into an `lcp:sha256:` content reference. The form is exact — `lcp:sha256:0x` followed by 64 hex
characters — and `assemble` refuses anything else rather than guessing:

```bash
node -e 'const {createHash}=require("node:crypto");const {readFileSync}=require("node:fs");console.log("lcp:sha256:0x"+createHash("sha256").update(readFileSync("terms.txt")).digest("hex"))'
# lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30
```

The record also needs an `id`. Any non-empty string is accepted; 16 random bytes is a reasonable choice:

```bash
node -e 'console.log("0x"+require("node:crypto").randomBytes(16).toString("hex"))'
# 0xcfd11a6df93dae9b9ff76196eadf0939
```

Keep both values verbatim if you want the ATR hash printed below to be the one you compute. A freshly
generated `id` is a different record, and therefore a different hash — which is the property working.

Now assemble. A slot carries **exactly one** of `value` (inline) or `ref` (a content reference), and
`terms` and `id` are required and non-empty. The `atrVersion` field is engine-stamped, so supplying it as
a slot is a typed refusal rather than an override:

```ts
import { assemble, hashAtr, isAtrHash } from "@integraledger/lcp-kernel";

const { atrBytes, atrHash } = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" },
  {
    slot: "parties",
    value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" },
  },
]);

console.log(new TextDecoder().decode(atrBytes)); // the canonical document, as hashed
console.log(atrHash); // the fingerprint a settlement will carry
console.log(isAtrHash(atrHash)); // true
console.log((await hashAtr(atrBytes)) === atrHash); // true — recomputable by anyone holding the bytes
```

<!-- SUPERSEDED PINS (2026-09-02): the record hash below was
     0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356 over a record whose first member was
     "lcp":"0.3", and then 0xe86225e8541075b52506b25d1d7de54677931857862754d8d14db7080fde1f99 over "atr":"0.3";
     the format-version member was renamed twice before any release carried it, and the new hash was
     re-derived independently each time (python hashlib over the printed one-line bytes). -->
```text
{"atrVersion":"0.3","terms":"lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30","id":"0xcfd11a6df93dae9b9ff76196eadf0939","parties":{"seller":"did:web:seller.example","buyer":"did:web:buyer.example"}}
0x9cf831839b0cf901b1f5a26c1be80acab3f624875bb0edf74c63dd99adda6f3b
true
true
```

`hashAtr` hashes the bytes it is handed, exactly as handed — it does not re-assemble, re-order, or
canonicalize them. That is why the last line holds: the received bytes *are* the fingerprint, and a
verifier that canonicalized them would be hashing something the payer never signed.

## Verify

`verify` takes the pieces of a record and reports what it was able to establish. It opens no sockets and
fetches nothing: gathering the inputs over live ports is the caller's job, which is what leaves the walk
deterministic. This fence repeats the assembly so it runs on its own:

```ts
import { assemble } from "@integraledger/lcp-kernel";
import { verify } from "@integraledger/lcp-verify";

const { atrBytes, atrHash } = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" },
  {
    slot: "parties",
    value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" },
  },
]);

const report = await verify({
  asOf: "2026-08-03T00:00:00Z",
  coverage: { ports: [], bindings: ["evm-x402"] },
  atrBytes,
  // In a real check this is the hash RECOVERED from the settlement's carrier field, not one you computed.
  settledAtrHash: atrHash,
  settlements: [
    { txHash: "0xf1a4d0e2c3b5978664fa2b1c0d9e8f7a6b5c4d3e2f10112233445566778899aa" },
  ],
});

console.log(
  `verified: ${report.verified} | claimed: ${report.claimedClass} | supported: ${report.supportedClass}`,
);
for (const step of report.steps) {
  const why = step.outcome.status === "not-attempted" ? step.outcome.depth : "";
  console.log(`   ${step.name.padEnd(24)} ${step.outcome.status} ${why}`);
}
```

```text
verified: false | claimed: TC-2 | supported: TC-0
   atr-fingerprint          proved
   settlement-enumeration   proved
   buyer-acceptance         not-attempted no-acceptance
   authority-attenuation    not-attempted no-authority-chain
   commitment-vs-leaf       not-attempted no-commitment
   recourse-elections       not-attempted no-elections-recorded
   resolve-party            not-attempted no-identity
```

That is the expected output, and reading it is the point of this page. (`coverage` states what this caller
was equipped with; the walk records it in the report rather than acting on it, so a report always says how
much of the world its producer could see.)

`verified` is `false`, and **that is the correct answer**. The default depth is `"structural"`, where the
walk is a presence-and-absence readout over supplied inputs and cannot raise a verdict at all. Raising it
requires `depth: "mechanical"`, where the caller has gathered the inputs over live ports and `verified`
becomes an honest function of what those ports returned.

Two steps are `proved`. `atr-fingerprint` recomputed the hash over `atrBytes` and it matched
`settledAtrHash`; had it not matched, the step would be `failed` and the record impeached. And
`settlement-enumeration` was handed a settlement — the step reports that one was supplied and flags
multiple settlements, not that a chain was consulted.

The other five are `not-attempted`, each carrying the reason it could not run: this record carried no
acceptance, no authority chain, no commitment against a leaf grant, no recourse elections, and no
identity slot. **An absent input never becomes a pass.** A verifier that reported a bare failure for all
five would be telling you the record is wrong; what it actually says is that five rungs were never
reached for.

The two class fields say different things, and the gap between them here is the lesson. `claimedClass`
reads `TC-2` — what this record is shaped for, which is what `claimedClass` defaults to when a caller
states none. `supportedClass` reads `TC-0`, because it is computed from the steps: it is the highest class
every one of whose required rungs is `proved`, and `TC-1` already requires `resolve-party`, which was never
attempted. Two proved rungs do not make a class if they are not that class's own.

That is not the walk being harsh. Supply an identity and this record reads `TC-2`; supply nothing and it
reads what it can support, which is nothing. The claim cannot lift the finding, and — for the same reason —
cannot cap it either: a record whose rungs reach `TC-3` reads `TC-3` even where the caller claimed less.

## Where next

- [concepts/atr.md](concepts/atr.md) — the ATR in full: its slots, its canonical bytes, and why the hash
  is taken over the file exactly as received.
- [guides/verify-a-settlement.md](guides/verify-a-settlement.md) — the same walk against a real
  settlement, where `settledAtrHash` is recovered from the carrier field rather than computed by you.
- [reference.md](reference.md) — every shipped package with its role and a link to its README.
