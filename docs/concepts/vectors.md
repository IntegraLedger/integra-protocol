---
title: Vectors
description: The shared test cases that fix the rules byte for byte across languages.
---

# Vectors

**Vectors** are the shared test cases that fix the rules byte for byte across languages. The package ships them in
`vectors/`, one JSON file per entry point or pairing. Any implementation of the Legal Context Protocol, in any
language, that passes them assembles the same bytes, computes the same hashes, and places and reads H in the same
fields as this package.

Every expected value in a vector file comes from outside this package: a specification's published example, a
standard's test value such as SHA-256 of `"abc"` from FIPS 180-2, a transaction read from a live network, or an
independent tool (Python's `json` and `hashlib`, `sha256sum`, `openssl`, viem, eth-account, a rail's own SDK). Each
file's `about` names its sources.

## What they fix

| Area | Files | What the rows fix |
|---|---|---|
| The core | `core-vectors.json` | The ATR's exact bytes and hash for given inputs, each `assemble` refusal, the https-link rule, and the JSON nesting cap. |
| The buyer gate | `buyer.json` | What a buyer does with an advertised challenge: when it signs, and each decline. |
| Each pairing | `x402-*.json`, `mpp-*.json`, `acp-checkout.json`, `ucp.json`, `ap2-checkout-mandate.json`, `ack-payment-request.json`, `card.json` | The placed challenge, what the payer signs with H in it, H read back from the payment, and the settlement read. |
| Shared readers | `sd-jwt.json`, `decoder-caps.json`, `discovery.json`, `a2a-legal-context.json` | The SD-JWT reader, the decoders' limits, the discovery document and the A2A extension. |

The [vector files reference](../reference/vectors.md) lists every file with its `about`.

## Running them

The files ship inside the package, beside `dist/`. This example runs the core rows of `core-vectors.json` through
`assemble` and checks each expected hash:

```ts
import { readFile } from "node:fs/promises";
import { assemble, isRefusal, type Json } from "@integraledger/lcp";

const url = new URL("../vectors/core-vectors.json", import.meta.resolve("@integraledger/lcp"));
const core = JSON.parse(await readFile(url, "utf8")) as {
  vectors: { name: string; id?: string; binding?: [string, Json]; content?: [string, string][]; expectHash: string }[];
};

for (const v of core.vectors) {
  if (v.id === undefined || v.binding === undefined || v.content === undefined) continue;
  const content = v.content.map(([slot, hex]) => [slot, Uint8Array.from(Buffer.from(hex, "hex"))] as const);
  const atr = await assemble(v.id, v.binding, content);
  console.log(v.name, !isRefusal(atr) && atr.atrHash === v.expectHash);
}
```

```text
V1 true
V2 true
V3 true
```

The package's own test suite runs every file this way, in full. The buyer packages in
[`integra-agentic-terms`](https://github.com/IntegraLedger/integra-agentic-terms) run the same files from TypeScript
and from Python, so the rules hold in both languages.

## Plants

A row marked `plant` is a deliberate wrong input with a known outcome: bytes one changed byte away from the ATR, a
receipt with the hash in the wrong topic, an agreement resource advertising another ATR's hash. A check that accepts
a plant is broken, whatever else it passes.
