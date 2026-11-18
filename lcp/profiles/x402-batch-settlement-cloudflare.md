**LCP profile `x402/batch-settlement/cloudflare`: Cloudflare's Pay Per Crawl, a 402 written by a third party, carrying no H.**

This pairing is the codec of Cloudflare's Pay Per Crawl as x402 describes it: an option on the network `cloudflare:402` whose `payTo` is `merchant`, whose `asset` is a three-letter currency code and whose `extra` names a `version`. Cloudflare, not the resource server, writes the 402 and bills the crawler's registered identity off chain, so the seller's H never reaches the buyer through it, and no public ledger records the payment. The pairing is at coverage `none` (`link` `none`), has no `status`, and is no agreement.

1. The codec reads and writes the payment as x402 v2 frames it: `build` gives `{x402Version: 2, payload: {amount, asset}, accepted, extensions}` for an option the filter takes, where the document's `extensions.legalContext` names the H it is given (`x402/legal-context-conflict` otherwise); `bound` returns the H the payment's echoed `extensions.legalContext` names, which only locates the sale and is no proof.
2. The filter takes an option whose amount is a positive amount and whose `maxTimeoutSeconds` is a positive safe integer, and refuses another (`x402/option-malformed`).
3. Cloudflare verifies the agent's HTTP message signature over the request, with the key the agent registered with it, and bills that identity; lcp reads no such signature and no ledger.
4. Because Cloudflare writes the 402, a resource server behind it cannot put its own `extensions.legalContext` in it, so a payment through it carries no H the seller issued; lcp keeps the codec for a resource server that writes the option itself.

5. **What a record proves**, as the pairing's `data.proves` states it:
    - `x402/batch-settlement/cloudflare`: The request whose payment echoed this ATR's hash in the legalContext entry of x402's extensions was signed with an HTTP message signature key registered with Cloudflare, which Cloudflare verifies, billing that key's registered identity off chain. The echoed hash only locates the sale: the pairing follows no agreement, and no public ledger records the payment. This does not show that amount, asset or timing match the ATR's content.

**The read kit**

6. The pairing has no read, so no form runs the read kit through it.
