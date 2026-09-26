**LCP profile `x402/exact/tron/lcp-trc20-memo`: the ATR hash in a payer-signed TRC-20 transfer's memo.**

*Scope.* x402 v2, `scheme` `"exact"`, `network` `tron:<chain id in decimal>` (CAIP-2), `extra.assetTransferMethod` `"lcp-trc20-memo"` (required). It defines this transfer method until x402 or MPP defines Tron. The default flow is `authorization`, and `upfront` is allowed.

1. The resource server's option gives `amount` in the token's atomic units, `asset` (the TRC-20 contract) and `payTo` in base58check, and `maxTimeoutSeconds` of at most 86,340. `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`, where H is the SHA-256 of the ATR's exact bytes as `0x` lowercase hex and L is an `https` URL that serves them.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client signs one transaction and sends it as `payload.transaction`, the serialized `Transaction` in lowercase hex. It echoes `extensions` unchanged. The transaction's `raw_data` holds:
   - exactly one `TriggerSmartContract`, from the payer to `asset`, calling `transfer(payTo, amount)` with no call value;
   - `data` = the 77 ASCII bytes `lcp:sha256:` followed by H;
   - `timestamp` = now and `expiration` = now + `maxTimeoutSeconds` × 1000, in milliseconds;
   - a recent reference block, and the client's own `fee_limit`.

   The signature is the payer's secp256k1 signature over SHA-256 of the serialized `raw_data`.
4. The payer pays every fee: energy, bandwidth and the network's memo fee. Nothing in this profile sponsors them.
5. A facilitator's `/verify` MUST:
   - decode the transaction, and require rule 3's shape on `asset`, for `transfer(payTo, amount)` exactly;
   - require `data` to be an LCP `sha256` string;
   - require signatures that the owner's permission accepts;
   - require `expiration` to be in the future and no later than now + `maxTimeoutSeconds`.

   It SHOULD simulate with `/wallet/triggerconstantcontract`. Its `/settle` MUST:
   - repeat `/verify`;
   - broadcast with `/wallet/broadcasthex`;
   - deduplicate settlements by transaction id, atomically, until `expiration` passes;
   - answer `success: true`, with `transaction` = the id in hex and `payer` = the owner, only when a node reports the transaction in a block with receipt result `SUCCESS`.
6. The resource server refuses a payment whose `data` does not decode to an H that it issued for that request and has not seen claimed.
7. Declarations for x402's facilitator-submitted family:
   - fee payer: the payer, self-funded;
   - replay primitive: the transaction id, exclusive to this payment;
   - validity window: bounded by `expiration`, at most 24 hours by the node;
   - duplicate submission: a node rejects a duplicate, and settlements are still deduplicated as rule 5 requires.
8. H is on chain as `raw_data.data`, inside the bytes whose SHA-256 is the transaction id the payer signed. It is read by transaction id from a Solidity node. No index searches memos.
