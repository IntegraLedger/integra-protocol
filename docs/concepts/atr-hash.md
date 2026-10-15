---
title: The ATR hash
description: SHA-256 over the ATR's exact bytes, the forms it is written in, and how two hashes are compared.
---

# The ATR hash

The **ATR hash (H)** is SHA-256 over the ATR's exact bytes: the bytes the seller serves, as they arrive. Nothing is
parsed, trimmed or re-encoded before hashing. `hash(bytes)` computes it, and `assemble` returns it beside the bytes it
wrote. `hash` takes the bytes as a `Uint8Array` and rejects with a `TypeError` for any other value, a string included.

With an `id` from `newAtrId()`, two ATRs with the same terms have different hashes, and H is unpredictable before the
seller issues it.

## The forms of H

The same 32 bytes are written in four forms. The package writes H in lowercase, except on MPP XRPL, whose
`methodDetails.invoiceId` and Payment `InvoiceID` hold H's 64 hex digits in upper case (`mppInvoiceId`). It reads
either case, except in five carriers that must hold H's LCP string with lowercase hex exactly; the same hash in another
spelling is refused:

- a Solana memo (`svm/carrier-not-canonical`), with an x402 option's `extra.memo` and an MPP request's `externalId`
  (`svm/carrier-mismatch`);
- a Cardano CIP-20 message, whose two lines are the string's `lcp:sha256:0x` and its digits
  (`cardano/hash-not-carried`);
- a Polkadot remark (`polkadot/remark-not-lcp`);
- the x402 XRPL option's `extra.invoiceId`, whose SHA-256 is the Payment's `InvoiceID` (`xrpl/carrier-mismatch`);
- a Concordium memo, which must equal `ccdMemo(h)` (`ccd/memo-not-lcp`).

| Form | Example | Written by | Read by |
|---|---|---|---|
| Hex | `0xba7816bf…f20015ad` | `hash`, `assemble`, every `bound` | `hashEquals` |
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

A pairing's `advertise`, and MPP's and A2A's `place`, refuse any link that fails the rule as
`<surface>/link-not-https`: the link MUST be `https://` (LCP §8.1). A pairing's `read` refuses a link of another
scheme, at most 2048 characters long, as `<surface>/link-not-https`, and any other link that fails the rule as
`<surface>/legal-context-malformed`; card's, ACK's and AP2's `read` refuse every link that fails the rule as
`<surface>/legal-context-malformed`. The pairings also cap a link at 2048 characters: an `https` link over that is
`<surface>/legal-context-malformed`, or `<surface>/too-large` on ACP, AP2 and UCP. `isHttpsLink`, `toLegalContext` and
`fromLegalContext` set no length.

## The core alone

A Worker that needs only the core imports `@integraledger/lcp/core`. It exports the core functions the package root
exports, each the root's own function: `assemble`, `newAtrId`, `hash`, `hashEquals`, the forms of H and their readers,
`isHttpsLink`, `isOtherSchemeLink`, `canonicalJson`, `digestJson`, `parseJson`, `fromBase64`, `base64Bytes`,
`toBase64`, `fromBase64Url`, `base64UrlBytes`, `toBase64Url`, `isRefusal` and `readToRepeat`. It imports no pairing,
no rail and no optional peer, so the Worker's bundle holds the core alone.

```ts
import { hash, hashEquals, toLcpString } from "@integraledger/lcp/core";

// SHA-256("abc"), the FIPS 180-2 example.
const h = await hash(new TextEncoder().encode("abc"));
console.log(toLcpString(h));
console.log(hashEquals(h, "0xBA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"));
```

```text
lcp:sha256:0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
true
```

## Next

- [Binding](./binding.md): where H rides in each payment.
- [The buyer gate](./buyer-gate.md): comparing the served bytes with H before signing.
