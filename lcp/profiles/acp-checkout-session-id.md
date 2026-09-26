**LCP profile `acp/checkout/session-id`: the ATR hash as the ACP checkout session id.**
1. The merchant sets the checkout session's `id` to H, the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and sets `metadata.legal_context` = `{"type":"sha256","value":H,"legal_context_url":L}`, where L is an `https` URL that serves those bytes.
2. The agent fetches L, hashes the bytes received, compares the result with the session `id` as 32 decoded bytes, and does not pay on a mismatch.
3. On a handler that requires `delegate_payment`, the agent's `allowance.checkout_session_id` is that `id`, so the vault token it signs for names H.
4. One session binds one ATR. A change to the terms the ATR records needs a new session.
