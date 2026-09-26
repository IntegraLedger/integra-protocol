---
title: "@integraledger/lcp/a2a"
description: "The exports of @integraledger/lcp/a2a."
---

# @integraledger/lcp/a2a

## Interfaces

### A2aAgentExtension

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-description"></a> `description` | `string` |
| <a id="property-required"></a> `required` | `boolean` |
| <a id="property-uri"></a> `uri` | `string` |

***

### A2aTask

#### Indexable

> \[`k`: `string`\]: [`Json`](index.md#json) \| `undefined`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-metadata"></a> `metadata?` | `object` |

## Variables

### A2A\_EXTENSION\_URIS

> `const` **A2A\_EXTENSION\_URIS**: readonly `string`[]

The extension's URIs, in order of preference. The first is the one written when the client activated none.

***

### binding

> `const` **binding**: [`Refusal`](index.md#refusal)

A2A binds nothing: the refusal given wherever an A2A pairing is asked for.

***

### delivery

> `const` **delivery**: `object`

What the carrier proves.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-proves"></a> `proves` | `string` |

## Functions

### agentExtension()

> **agentExtension**(`o?`): [`A2aAgentExtension`](#a2aagentextension)[]

One Agent Card `capabilities.extensions[]` entry per listed URI. `required` defaults to false.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o?` | \{ `required?`: `boolean`; \} |
| `o.required?` | `boolean` |

#### Returns

[`A2aAgentExtension`](#a2aagentextension)[]

***

### place()

> **place**(`task`, `h`, `link`, `a2aExtensions?`): [`Refusal`](index.md#refusal) \| [`A2aTask`](#a2atask)

A copy of the task whose `metadata` carries `{type, value, legalContextUrl}` under the listed URI the request's
`A2A-Extensions` value activated, or the first listed URI. Other metadata is kept.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `task` | [`A2aTask`](#a2atask) |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `a2aExtensions?` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`A2aTask`](#a2atask)

***

### read()

> **read**(`task`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `link`: `string`; \}

The hash and the link from the task's `metadata`, under a listed URI. No other key is read. Values under two listed
URIs must agree.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `task` | [`A2aTask`](#a2atask) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `link`: `string`; \}

***

### requested()

> **requested**(`a2aExtensions`): `boolean`

True when the request's `A2A-Extensions` value names a listed URI exactly: the value split on commas, each element
trimmed of SP and HTAB, compared case-sensitively.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a2aExtensions` | `string` \| `undefined` |

#### Returns

`boolean`
