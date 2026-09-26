---
title: "@integraledger/lcp/discovery"
description: "The exports of @integraledger/lcp/discovery."
---

# @integraledger/lcp/discovery

## Interfaces

### LegalContextDocument

LCP §2.4–§2.5; members in the order of their tables.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-acceptancerequired"></a> `acceptanceRequired?` | `boolean` | - |
| <a id="property-api"></a> `api?` | `string` | - |
| <a id="property-atrhash"></a> `atrHash?` | `` `0x${string}` `` | The digest of the document at `terms` (LCP §2.5). |
| <a id="property-contact"></a> `contact?` | `object` | - |
| `contact.legal?` | `string` | - |
| `contact.technical?` | `string` | - |
| <a id="property-disputeresolution"></a> `disputeResolution?` | `object` | - |
| `disputeResolution.catalog?` | `string` | - |
| `disputeResolution.clauseId?` | `string` | - |
| `disputeResolution.contact?` | `string` | - |
| `disputeResolution.jurisdiction?` | `string` | - |
| `disputeResolution.method?` | `string` | - |
| `disputeResolution.source?` | `string` | - |
| <a id="property-returns"></a> `returns?` | `string` | - |
| <a id="property-terms"></a> `terms` | `string` | Absolute https URL of the terms document. |
| <a id="property-termsformat"></a> `termsFormat?` | `string` | - |

## Variables

### MAX\_DOCUMENT\_BYTES

> `const` **MAX\_DOCUMENT\_BYTES**: `65536` = `65_536`

***

### WELL\_KNOWN\_PATH

> `const` **WELL\_KNOWN\_PATH**: `"/.well-known/legal-context.json"` = `"/.well-known/legal-context.json"`

## Functions

### emit()

> **emit**(`document`): `Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

The document's bytes: its checked members in table order, `atrHash` in lowercase, and no other member.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `document` | [`LegalContextDocument`](#legalcontextdocument) |

#### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

***

### parse()

> **parse**(`bytes`): [`Refusal`](index.md#refusal) \| \{ `document`: [`LegalContextDocument`](#legalcontextdocument); `ignored`: `string`[]; \}

One UTF-8 JSON object of at most `MAX_DOCUMENT_BYTES`, checked as LCP §2 states. Unknown members, at the top level or
inside `disputeResolution` and `contact`, are left out of `document` and named in `ignored` by dotted path.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `bytes` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `document`: [`LegalContextDocument`](#legalcontextdocument); `ignored`: `string`[]; \}
