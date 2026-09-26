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

Test for `refused` before using a result. Where a result is a string, such as the hash `bound` returns, test its type:

```ts
import { assemble, newAtrId } from "@integraledger/lcp";

const result = await assemble(newAtrId(), ["bind", {}], [["id", new TextEncoder().encode("{}")]]);
if ("refused" in result) {
  console.log(result.code);
} else {
  console.log(result.atrHash);
}
```

```text
core/slot-reserved
```

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
