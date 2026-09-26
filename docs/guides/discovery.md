---
title: Discovery
description: The discovery document a seller publishes at /.well-known/legal-context.json, and how emit and parse write and read it.
---

# Discovery

A seller can publish a **discovery document** (`LCP §2`): one small JSON object, served at
`/.well-known/legal-context.json` on the seller's host, that names the seller's terms document and how to reach the
seller. Because the path is fixed, an agent finds it from the host name alone.

The discovery document is not an ATR. It describes the seller's standing terms and is the same for every request; an
ATR is the record of one transaction, and its hash rides in that transaction's payment. Nothing in a pairing reads
the discovery document.

Import the pieces from `@integraledger/lcp/discovery`:

| Export | What it is |
|---|---|
| `emit(document)` | The document's bytes: its members checked and written in a fixed order, or a refusal. |
| `parse(bytes)` | The document read from bytes, with the names of the members it ignored, or a refusal. |
| `WELL_KNOWN_PATH` | `"/.well-known/legal-context.json"` |
| `MAX_DOCUMENT_BYTES` | `65536`: the largest document either function accepts. |
| `LegalContextDocument` | The document's type. |

Neither function throws or does any I/O. Serving the bytes, and fetching them, are yours.

## The members

These are the members `LCP §2.4` and `LCP §2.5` define, in the order their tables list them. Their meanings are the
specification's; the last column is what `emit` and `parse` check.

| Member | Type | Checked |
|---|---|---|
| `terms` | string | Required. An absolute `https` URL that meets the [link rule](../concepts/atr-hash.md#the-link). |
| `termsFormat` | string | Not empty. |
| `atrHash` | string | The digest of the document at `terms` (`LCP §2.5`): `0x` and 64 hex digits, in either case. It is written in lowercase. |
| `acceptanceRequired` | boolean | A boolean. |
| `disputeResolution` | object | Its members `method`, `jurisdiction`, `contact`, `clauseId`, `source` and `catalog`, in that order, each a non-empty string. `clauseId` is `sha256:0x` and 64 hex digits. |
| `returns` | string | Not empty. |
| `contact` | object | Its members `legal` and `technical`, each a non-empty string. |
| `api` | string | Not empty. |

Every member other than `terms` is optional. An absent member is left out, never written as `null`.

## Writing the document

`emit(document)` checks each member, then writes the members in the table's order, with no whitespace, strings escaped
as `JSON.stringify` escapes them, and `atrHash` in lowercase. A member the table does not name is not written. The
result is at most `MAX_DOCUMENT_BYTES`.

This example writes the reference document from the package's vectors, whose `atrHash` is SHA-256 of `"abc"` given in
upper case:

```ts
import { hash } from "@integraledger/lcp";
import { emit, WELL_KNOWN_PATH, type LegalContextDocument } from "@integraledger/lcp/discovery";

const document: LegalContextDocument = {
  terms: "https://seller.example/terms/v3.md",
  termsFormat: "markdown",
  atrHash: "0xBA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
  acceptanceRequired: false,
  contact: { legal: "legal@seller.example" },
};

const bytes = emit(document);
if ("refused" in bytes) throw new Error(bytes.code);

console.log(WELL_KNOWN_PATH);
console.log(new TextDecoder().decode(bytes));
console.log(bytes.length, "bytes");
console.log(`ETag: "${(await hash(bytes)).slice(2)}"`);
```

```text
/.well-known/legal-context.json
{"terms":"https://seller.example/terms/v3.md","termsFormat":"markdown","atrHash":"0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","acceptanceRequired":false,"contact":{"legal":"legal@seller.example"}}
220 bytes
ETag: "027d93681365deb2f485c4c34f7b0da7de8741db90a9fa6ea2437aa70bebd31a"
```

Serve those bytes at `WELL_KNOWN_PATH`. The same input always gives the same bytes, so a strong ETag over them is
stable: [`vectors/discovery.json`](../../lcp/vectors/discovery.json) fixes it as the SHA-256 in hex, in double
quotes.

## Reading a document

`parse(bytes)` reads what a seller served. It accepts one JSON object of at most `MAX_DOCUMENT_BYTES`, in well-formed
UTF-8 without a byte-order mark, nested at most 64 levels deep, and checks each member as the table says. Where a
member appears twice, the last one is read, as `JSON.parse` reads it.

A member the table does not name, at the top level or inside `disputeResolution` or `contact`, is left out of
`document` and named in `ignored` by its dotted path, so you can see what the seller sent that the specification does
not define.

```ts
import { parse } from "@integraledger/lcp/discovery";

const served = new TextEncoder().encode(
  JSON.stringify({
    terms: "https://seller.example/terms/v3.md",
    atrHash: "0xBA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
    contact: { legal: "legal@seller.example", phone: "+1 555 0100" },
    "x-region": "eu",
  }),
);

const read = parse(served);
if ("refused" in read) throw new Error(read.code);
console.log(read.document);
console.log(read.ignored);

const overHttp = parse(new TextEncoder().encode('{"terms":"http://seller.example/terms/v3.md"}'));
console.log("refused" in overHttp ? overHttp.code : "read");
```

```text
{
  terms: 'https://seller.example/terms/v3.md',
  atrHash: '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  contact: { legal: 'legal@seller.example' }
}
[ 'contact.phone', 'x-region' ]
discovery/terms-not-https
```

`emit` over the `document` that `parse` returns writes it in the fixed order, so every reader of one document can
hold the same bytes.

## Refusals

| Code | When |
|---|---|
| `discovery/too-large` | The bytes, or the document `emit` would write, exceed `MAX_DOCUMENT_BYTES`. |
| `discovery/not-json-object` | The bytes are not one JSON object: not JSON, not UTF-8, a byte-order mark, an array, or nested more than 64 levels. `emit` gives it for an input that is not an object. |
| `discovery/terms-missing` | `terms` is absent. |
| `discovery/terms-not-https` | `terms` is not an absolute `https` URL that meets the link rule. |
| `discovery/atr-hash-malformed` | `atrHash` is not `0x` and 64 hex digits. |
| `discovery/clause-id-malformed` | `disputeResolution.clauseId` is not `sha256:0x` and 64 hex digits. |
| `discovery/member-malformed/<path>` | The member at `<path>` has the wrong type, or is an empty string: for example `discovery/member-malformed/contact.legal`. |

## Fetching it

The fetch is yours. Bound it as you bound any fetch of a seller's bytes: one `GET` to
`https://<host>/.well-known/legal-context.json`, a deadline, and a body cancelled once it passes `MAX_DOCUMENT_BYTES`.
Then pass the bytes to `parse`.

## Next

- [The ATR](../concepts/atr.md): the per-transaction record a payment is bound to.
- [Vectors](../concepts/vectors.md): `vectors/discovery.json` fixes what `emit` writes and what `parse` reads or
  refuses, including every example of `LCP §2.7`.
