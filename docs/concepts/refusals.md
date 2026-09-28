---
title: Refusals
description: Every failure is a value with a code.
---

# Refusals

Failures are values. A function in this package returns its result, or a **refusal**: a plain object that names what
is wrong with its input.

```ts no-check
type Refusal = { refused: true; code: string };
```

A code is `<namespace>/<reason>`, such as `core/slot-name`, `x402/link-not-https` or `svm/memo-not-lcp`. The namespace
is the entry point or rail that refused. The same reason means the same thing on every surface: `link-not-https` is
always a link of another scheme, and `legal-context-malformed` is always a hash, link or agreement URL that does not
read.

The [refusal code reference](../reference/refusals.md) lists every code with its meaning.

## Checking a result

`isRefusal(result)` is how a caller tells a refusal from a result: it is true only for a refusal this package made, and
false for every result, the hashes `bound` returns included. Test it before using a result:

```ts
import { assemble, isRefusal, newAtrId } from "@integraledger/lcp";

const result = await assemble(newAtrId(), ["bind", {}], [["id", new TextEncoder().encode("{}")]]);
if (isRefusal(result)) {
  console.log(result.code);
} else {
  console.log(result.atrHash);
}
```

```text
core/slot-reserved
```

## Where a refusal comes from

Only the package makes refusals. `isRefusal`, which the package's own entry points use as well, recognises a refusal by
where it was made, not by its members, so a value you pass in is never returned to you as a refusal, whatever it
holds. A presented payment or credential that the
package would otherwise hand back to you unchanged is refused as malformed when it carries a `refused` member:
`mpp/credential-malformed` for an MPP credential, `x402/payload-malformed` for an x402 EIP-3009 payment and
`casper/payload-malformed` for a Casper payment. Every other entry point reads a presented value only for the members
its pairing defines, and returns either a value it built or its own refusal.

## Where the core throws

Three core functions take a value the caller controls completely, and throw a `TypeError` when it is wrong:
`toLcpString`, `toLegalContext` and `toRawBytes` throw when the hash is not 32 bytes, and `toLegalContext` also when
the link is not an `https` URL. Their `from…` counterparts return `null` instead of throwing.

## Readers

The functions that read a rail (`status`, `recover`, `fetchPresented`) take a reader you supply, so the network calls
are yours. A reader that fails, times out or answers for another network is never a failed payment: `status` returns
a pending state with the reason `unreadable`, and a later read can settle it.

## Next

- [Refusal codes](../reference/refusals.md): every code, with its meaning.
