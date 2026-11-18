# LCP profiles

This folder holds the normative rules of every pairing `@integraledger/lcp` serves: how a payment protocol, checkout or
transport carries an ATR's hash, what each party checks, and how a payment of that form is read back from its ledger. It
is for anyone who implements a client, a resource server or a settler of a pairing, in any language. `@integraledger/lcp`
is one implementation of these rules, and its vectors in `../vectors/` hold them as data. After this page you can find
the profile that defines any pairing and read its rules in the terms they share.

## The profiles

Each profile is one file, named by its id with `/` written as `-`, whose first line gives that id. A profile defines one
or more pairings, each a form of one protocol. Whether a pairing is confirmed, its coverage and what a record of it
proves are the package's registry data, which the [pairings reference](https://lcp.integraledger.com/reference/pairings)
lists for every pairing.

| Profile | Pairings it defines |
|---|---|
| [`ack/payment-request`](ack-payment-request.md) | `ack/payment-request` |
| [`acp/checkout/session-id`](acp-checkout-session-id.md) | `acp/checkout/delegated`, `acp/checkout/undelegated` |
| [`ap2/checkout-mandate`](ap2-checkout-mandate.md) | `ap2/checkout-mandate` |
| [`ap2/checkout-mandate/x402`](ap2-checkout-mandate-x402.md) | `ap2/checkout-mandate/x402` |
| [`card/mastercard-agent-pay`](card-mastercard-agent-pay.md) | `card/mastercard-agent-pay` |
| [`card/mastercard-vi`](card-mastercard-vi.md) | `card/mastercard-vi/autonomous`, `card/mastercard-vi/immediate` |
| [`card/seller-reference`](card-seller-reference.md) | `card/seller-reference` |
| [`card/visa-tap`](card-visa-tap.md) | `card/visa-tap` |
| [`card/visa-vic`](card-visa-vic.md) | `card/visa-vic` |
| [`mpp/charge`](mpp-charge.md) | `mpp/charge/evm/authorization`, `mpp/charge/evm/permit2`, `mpp/charge/evm/transaction`, `mpp/charge/evm/hash`, `mpp/charge/usdc/evm`, `mpp/charge/usdc/gateway`, `mpp/charge/card`, `mpp/charge/stripe`, `mpp/charge/lightning`, `mpp/session/lightning` |
| [`mpp/charge/nearintents`](mpp-charge-nearintents.md) | `mpp/charge/nearintents` |
| [`mpp/charge/solana`](mpp-charge-solana.md) | `mpp/charge/solana`, `mpp/charge/solana/unsponsored` |
| [`mpp/charge/tempo/split-memo`](mpp-charge-tempo-split-memo.md) | `mpp/charge/tempo/split-memo`, `mpp/charge/tempo/split-memo/push` |
| [`mpp/charge/usdc/solana`](mpp-charge-usdc-solana.md) | `mpp/charge/usdc/solana` |
| [`mpp/charge/usdc/stacks`](mpp-charge-usdc-stacks.md) | `mpp/charge/usdc/stacks` |
| [`mpp/charge/xrpl`](mpp-charge-xrpl.md) | `mpp/charge/xrpl` |
| [`mpp/method/lcp`](mpp-method-lcp.md) | `mpp/charge/lcp/hedera` |
| [`mpp/session/evm-tempo`](mpp-session-evm-tempo.md) | `mpp/session/evm`, `mpp/session/tempo`, `mpp/subscription/tempo` |
| [`mpp/session/hedera-solana-xrpl`](mpp-session-hedera-solana-xrpl.md) | `mpp/session/hedera/stock`, `mpp/session/solana/memo`, `mpp/session/solana/stock`, `mpp/session/xrpl`, `mpp/session/xrpl/stock` |
| [`mpp/subscription/solana`](mpp-subscription-solana.md) | `mpp/subscription/solana` |
| [`mpp/subscription/stripe`](mpp-subscription-stripe.md) | `mpp/subscription/stripe` |
| [`spend-permissions/eip155`](spend-permissions-eip155.md) | `spend-permissions/eip155` |
| [`ucp/checkout/agent-signed`](ucp-checkout-agent-signed.md) | `ucp/checkout/agent-signed` |
| [`ucp/checkout/legal-context`](ucp-checkout-legal-context.md) | `ucp/checkout/ap2-mandate`, `ucp/checkout/unsigned`, `ucp/booking/ap2-mandate`, `ucp/booking/unsigned` |
| [`x402/auth-capture/eip155`](x402-auth-capture-eip155.md) | `x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2` |
| [`x402/batch-settlement/cloudflare`](x402-batch-settlement-cloudflare.md) | `x402/batch-settlement/cloudflare` |
| [`x402/batch-settlement/eip155`](x402-batch-settlement-eip155.md) | `x402/batch-settlement/eip155` |
| [`x402/batch-settlement/solana`](x402-batch-settlement-solana.md) | `x402/batch-settlement/solana` |
| [`x402/exact/algorand/note`](x402-exact-algorand-note.md) | `x402/exact/algorand` |
| [`x402/exact/aptos`](x402-exact-aptos.md) | `x402/exact/aptos` |
| [`x402/exact/cardano`](x402-exact-cardano.md) | `x402/exact/cardano`, `x402/exact/cardano/lock` |
| [`x402/exact/casper`](x402-exact-casper.md) | `x402/exact/casper` |
| [`x402/exact/ccd`](x402-exact-ccd.md) | `x402/exact/ccd` |
| [`x402/exact/eip155/eip3009`](x402-exact-eip155-eip3009.md) | `x402/exact/eip155/eip3009` |
| [`x402/exact/eip155/erc7710`](x402-exact-eip155-erc7710.md) | `x402/exact/eip155/erc7710` |
| [`x402/exact/eip155/erc7710-salt`](x402-exact-eip155-erc7710-salt.md) | `x402/exact/eip155/erc7710-salt` |
| [`x402/exact/eip155/gateway-batched`](x402-exact-eip155-gateway-batched.md) | `x402/exact/eip155/gateway-batched` |
| [`x402/exact/eip155/permit2`](x402-exact-eip155-permit2.md) | `x402/exact/eip155/permit2` |
| [`x402/exact/hedera`](x402-exact-hedera.md) | `x402/exact/hedera`, `x402/exact/hedera/transfer-executor` |
| [`x402/exact/lnbtc/payment-hash`](x402-exact-lnbtc-payment-hash.md) | `x402/exact/lnbtc/payment-hash` |
| [`x402/exact/near/memo`](x402-exact-near-memo.md) | `x402/exact/near` |
| [`x402/exact/polkadot/lcp-assets-remark`](x402-exact-polkadot-lcp-assets-remark.md) | `x402/exact/polkadot/lcp-assets-remark` |
| [`x402/exact/solana`](x402-exact-solana.md) | `x402/exact/solana` |
| [`x402/exact/starknet`](x402-exact-starknet.md) | `x402/exact/starknet` |
| [`x402/exact/stellar/precondition`](x402-exact-stellar-precondition.md) | `x402/exact/stellar/precondition` |
| [`x402/exact/sui`](x402-exact-sui.md) | `x402/exact/sui` |
| [`x402/exact/tron/lcp-trc20-memo`](x402-exact-tron-lcp-trc20-memo.md) | `x402/exact/tron/lcp-trc20-memo` |
| [`x402/exact/tvm`](x402-exact-tvm.md) | `x402/exact/tvm` |
| [`x402/exact/xrpl`](x402-exact-xrpl.md) | `x402/exact/xrpl` |
| [`x402/upto/eip155/permit2`](x402-upto-eip155-permit2.md) | `x402/upto/eip155/permit2` |
| [`x402/upto/solana`](x402-upto-solana.md) | `x402/upto/solana` |
| [`x402/upto/xrpl`](x402-upto-xrpl.md) | `x402/upto/xrpl` |

Five documents define no pairing:

- [`read-status`](read-status.md): what the read of a landed payment or agreement answers, and the rules that choose the
  answer, for every pairing that has a read.
- [`legal-context-return`](legal-context-return.md): what a sale paid after its agreement carries, and how the buyer's
  agent returns for the charge.
- [`x402/request-commitment`](x402-request-commitment.md): the request an x402 challenge answers, committed in the ATR.
- [`ucp/payment-handler/x402`](ucp-payment-handler-x402.md), with its schema
  [`ucp-payment-handler-x402.schema.json`](ucp-payment-handler-x402.schema.json): the UCP payment handler
  `com.integraledger.lcp.x402`, published at `https://lcp.integraledger.com/ucp/x402/2026-10-02`.
- [The A2A extension](a2a-legal-context-v1.md) `https://lcp.integraledger.com/a2a/legal-context/v1`, published at
  that address.

## Terms every profile uses

- **ATR, H and L.** The ATR, the Agentic Transaction Record, is the agreement's record. H is the SHA-256 of the ATR's
  exact bytes, written `0x` and 64 lowercase hex digits, and L is an `https` URL that serves those bytes. Before it
  signs or pays, a client fetches L, hashes the bytes it receives and compares the result with H as 32 bytes.
- **H's LCP string** is `lcp:sha256:` followed by H, 77 bytes: the form H takes in a memo, a note or a text field.
- **The agreement's value** is SHA-256 over the 16 ASCII bytes `lcp-agreement-v1` followed by H's 32 bytes
  (`read-status`, rule 1). On a pairing whose single-use value is H, or H's low bits, an agreement carries this value,
  or its low bits, in H's place, so that an agreement and a payment under one H never share a single-use value.
- **Coverage.** `full`: the payer's own signed act, on a public ledger, carries all of H, a 256-bit digest over a
  preimage that holds H, or on Starknet H's low 250 bits. `none`: no public act the payer signs carries H. A payment at
  coverage `none` follows an agreement carrying H, made on a pairing at coverage `full`; what it carries of H (its
  `link`: H, a pointer to the agreement, or nothing) is a link, never a proof.
- **Confirmed.** Whether something outside lcp, a recorded run or a published sample, has shown the form as its profile
  defines it.
- **Settler.** The party that submits a payment the buyer signed and pays its fee where the form says so; an x402
  facilitator is one.
- **The parts of an implementation.** A rule names the step that makes a check by the name lcp gives it: `read` (the
  client's reading of an offer), `advertise` (the seller's placing of H and L in an offer), `pairingsOf` (the pairings
  an MPP challenge offers), `build` and `complete` (the client's payment), `bound` (the resource server's check that
  the payment carries H), `reference` (the keys of a read), `status` (the read of what the ledger shows), `recover` (the
  value a landed transaction carries in H's place) and `fetchPresented` (the read of a payment its payer broadcast).
  "`bound` refuses X" means that a resource server refuses X before anything moves. An implementation in another
  language makes the same checks, in the same order, under whatever names it uses.

## How the rules are written

- Each numbered rule is a requirement on the party it names, stated in the indicative: "the client does not sign"
  means that a client implementing the profile must not sign. "Should" marks a recommendation. The profiles use the
  keywords of BCP 14 (RFC 2119, RFC 8174) only where they quote another specification.
- A rule cites another profile's rule by that profile's id and the rule's number (`mpp/charge` rule 5), and a rule of
  its own profile by the number alone (rule 5).
- **The read kit.** The rule of a profile that names the cases of `read-status.json` that cannot arise on its
  pairing's ledger (headed *The read kit*, *Declared inapplicable to the read kit* or *Cases that cannot arise*) binds
  the conformance vectors an implementation runs, not the wire: a pairing's vectors skip a case of the kit only where
  that rule states it, each statement resting on a fact of the ledger or of the pairing's data (`read-status`,
  rule 28).
