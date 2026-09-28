---
title: The ATR hash
description: SHA-256 over the ATR's exact bytes, the forms it is written in, and how two hashes are compared.
---

# The ATR hash

The **ATR hash (H)** is SHA-256 over the ATR's exact bytes: the bytes the seller serves, as they arrive. Nothing is
parsed, trimmed or re-encoded before hashing. `hash(bytes)` computes it, and `assemble` returns it beside the bytes it
wrote.

Every ATR carries its own random `id`, so two ATRs with the same terms still have different hashes. H is unpredictable
before the seller issues it and unique to one transaction.

## The forms of H

The same 32 bytes are written in four forms. The package writes every hash in lowercase and reads either case, with
one exception: a Solana memo, which the payer signs and the chain keeps, must be `toLcpString(h)` exactly, and the same
hash in another spelling is refused `svm/carrier-not-canonical`.

| Form | Example | Written by | Read by |
|---|---|---|---|
| Hex | `0xba7816bf…f20015ad` | `hash`, `assemble` | `hashEquals`, every `bound` |
| LCP string (`LCP §8.1`) | `lcp:sha256:0xba7816bf…f20015ad` | `toLcpString` | `fromLcpString` |
| Structured (`LCP §8.1`) | `{"legalContext":{"type":"sha256","value":"0x…","legalContextUrl":"https://…"}}` | `toLegalContext` | `fromLegalContext` |
| Raw bytes | 32 bytes | `toRawBytes` | `fromRawBytes` |

The structured form puts the link to the seller's copy beside the hash. `toLegalContext(h, url, "snake")` writes the
link as `legal_context_url` for protocols that use snake case, and `fromLegalContext` reads either spelling.

```ts
import { fromLcpString, hash, hashEquals, toLcpString, toLegalContext, toRawBytes } from "@integraledger/lcp";

const h = await hash(new TextEncoder().encode("abc"));
console.log(h);
console.log(toLcpString(h));
console.log(JSON.stringify(toLegalContext(h, "https://atr.seller.example/abc")));
console.log(toRawBytes(h).length);

const upper = `0x${h.slice(2).toUpperCase()}`;
console.log(hashEquals(h, upper), fromLcpString(toLcpString(h)) === h);
```

```text
0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
lcp:sha256:0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
{"legalContext":{"type":"sha256","value":"0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","legalContextUrl":"https://atr.seller.example/abc"}}
32
true true
```

## Comparing two hashes

`hashEquals(a, b)` is the one comparison (`LCP §2.5`). It is true only when both strings are `0x` followed by 64 hex
digits, in either case, and they decode to the same 32 bytes. Anything else, including a hash in another form, is
false. It compares every byte, whatever the first difference.

Compare with `hashEquals`, never with `===`: a hash that arrives in upper case is the same hash.

## The link

The link beside H is an `https` URL that serves the ATR's exact bytes. `isHttpsLink` is the one rule every pairing
applies to it:

- the string holds no whitespace, control character or backslash;
- it parses as an absolute URL whose scheme is `https`, in either case;
- its authority has a host, a DNS name or an IP literal, and no user information.

A pairing refuses a link of another scheme as `<surface>/link-not-https`, and any other link that fails the rule as
`<surface>/legal-context-malformed`. A link is at most 2048 characters.

## Next

- [Binding](./binding.md): where H rides in each payment.
- [The buyer gate](./buyer-gate.md): comparing the served bytes with H before signing.
