---
title: "@integraledger/lcp/core"
description: "The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's forms, the https-link rule, the JSON and base64 forms they read and write, `isRefusal` and `readToRepeat`, with no pairing, rail or optional peer."
---

# @integraledger/lcp/core

The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's forms, the https-link
rule, the JSON and base64 forms they read and write, `isRefusal` and `readToRepeat`, with no pairing, rail or
optional peer.

Besides those, it holds the agreement's own value of a hash; the hash's string and structured forms; the URL
Standard's host and domain parsers the https-link rule reads a link with; the RFC 8785 form of a JSON value and its
digest; JSON reading capped at 64 levels; and padded standard base64 and unpadded base64url, each read in its
canonical form only (with or without a bound on its size) and written. It imports no pairing, no rail and no optional
peer, so a bundle of it holds these functions and nothing else. The package root exports the same functions: each is
one function, reached by either path.

## References

### agreementValue

Re-exports [agreementValue](index.md#agreementvalue)

***

### assemble

Re-exports [assemble](index.md#assemble)

***

### AtrHash

Re-exports [AtrHash](index.md#atrhash)

***

### base64Bytes

Re-exports [base64Bytes](index.md#base64bytes)

***

### base64UrlBytes

Re-exports [base64UrlBytes](index.md#base64urlbytes)

***

### canonicalJson

Re-exports [canonicalJson](index.md#canonicaljson)

***

### CoreRefusal

Re-exports [CoreRefusal](index.md#corerefusal)

***

### digestJson

Re-exports [digestJson](index.md#digestjson)

***

### domainToAscii

Re-exports [domainToAscii](index.md#domaintoascii)

***

### fromBase64

Re-exports [fromBase64](index.md#frombase64)

***

### fromBase64Url

Re-exports [fromBase64Url](index.md#frombase64url)

***

### fromLcpString

Re-exports [fromLcpString](index.md#fromlcpstring)

***

### fromLegalContext

Re-exports [fromLegalContext](index.md#fromlegalcontext)

***

### fromRawBytes

Re-exports [fromRawBytes](index.md#fromrawbytes)

***

### hash

Re-exports [hash](index.md#hash)

***

### hashEquals

Re-exports [hashEquals](index.md#hashequals)

***

### isHttpsLink

Re-exports [isHttpsLink](index.md#ishttpslink)

***

### isOtherSchemeLink

Re-exports [isOtherSchemeLink](index.md#isotherschemelink)

***

### isRefusal

Re-exports [isRefusal](index.md#isrefusal)

***

### Json

Re-exports [Json](index.md#json)

***

### newAtrId

Re-exports [newAtrId](index.md#newatrid)

***

### parseHost

Re-exports [parseHost](index.md#parsehost)

***

### parseJson

Re-exports [parseJson](index.md#parsejson)

***

### readToRepeat

Re-exports [readToRepeat](index.md#readtorepeat)

***

### readUrl

Re-exports [readUrl](index.md#readurl)

***

### Refusal

Re-exports [Refusal](index.md#refusal)

***

### toBase64

Re-exports [toBase64](index.md#tobase64)

***

### toBase64Url

Re-exports [toBase64Url](index.md#tobase64url)

***

### toLcpString

Re-exports [toLcpString](index.md#tolcpstring)

***

### toLegalContext

Re-exports [toLegalContext](index.md#tolegalcontext)

***

### toRawBytes

Re-exports [toRawBytes](index.md#torawbytes)

***

### UrlAuthority

Re-exports [UrlAuthority](index.md#urlauthority)
