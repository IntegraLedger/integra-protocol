**LCP profile `mpp/charge`: the ATR hash in an MPP challenge.**

1. The challenge's `opaque` map carries `legalContext` = `lcp:sha256:` + H and `legalContextUrl`, an `https` URL that serves the ATR's exact bytes.
2. The challenge `id` is the base64url (no padding) of H's 32 bytes, then `.` and the challenge's position in the 402, except that a Tempo `subscription` challenge's id is exactly the base64url (no padding) of H.
3. The client fetches the URL, computes SHA-256 over the bytes received, and compares it with H as 32 bytes. On a mismatch it does not sign.
4. EVM `authorization` and `permit2`: the signed nonce, or the witness `challengeHash`, is keccak256(UTF-8(id) ‖ UTF-8(realm)), as MPP requires. Tempo, pull or push: the client signs MPP's attribution memo as its primary `transferWithMemo` memo, whose last 7 bytes are keccak256(UTF-8(id))[0..6] and whose bytes 5–14 are keccak256(UTF-8(realm))[0..9], as MPP's SDKs write it. The memo binds H only through those 7 bytes: whoever assembles the ATR can construct a second ATR whose id gives the same 7 bytes.
5. The ATR's `mpp` slot holds the challenge's bound parameters as issued, so the id is bound to them through H.
6. EVM `transaction` and `hash` carry H in no signed or landed value. When `opaque` carries `legalContextAgreementUrl`, the client first pays that URL, whose payment carries H, and pays the challenge only after its 200 receipt.
7. **Lightning** (`method="lightning"`): the challenge's BOLT11 invoice (`methodDetails.invoice`, or `depositInvoice` for a session) has exactly one `h` field, equal to H, and no `d`; the request carries `paymentHash` equal to the invoice's. The client checks, as BOLT11 requires, that `h` is the SHA-256 of the ATR it fetched before paying.
8. **`usdc`, EVM and Gateway:** the signed nonce, or the TransferSpec salt, is usdc's derivation over the challenge `id`, so it commits to H. **Stacks:** the SIP-010 `transfer` memo is `some` of H's 32 bytes.
9. **`card` and `stripe`:** the request's `externalId`, or `methodDetails.metadata.legal_context`, is `lcp:sha256:` + H. The buyer's card or Stripe token does not carry H; the challenge and the seller's reference do.
