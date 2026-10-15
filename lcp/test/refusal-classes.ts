// Each refusal code the package returns, and whether it is a read to repeat. Each class is decided from the code's
// meaning in docs/reference/refusals.md and from the code that returns it, never read from `readToRepeat`. A read to
// repeat rests on a read of the rail that may answer differently later, with nothing the caller must change: a reader
// that failed or answered out of its documented form, no landed transaction yet, or a transaction not final yet. Every
// other code is a verdict that a later read answers the same way, or a call the caller must change before it can
// succeed: a reader for another network or a ref it cannot read, a push credential read before `fetchPresented`, a
// missing peer dependency, or malformed input.

/** The reads to repeat. */
export const READS_TO_REPEAT: readonly string[] = [
  "avm/not-found",
  "avm/unreadable",
  "cardano/not-found",
  "cardano/unreadable",
  "casper/not-executed",
  "casper/not-found",
  "casper/unreadable",
  "ccd/not-finalized",
  "ccd/not-found",
  "ccd/unreadable",
  "evm/not-final",
  "evm/not-found",
  "evm/unreadable",
  "hedera/not-final",
  "hedera/not-found",
  "hedera/unreadable",
  "near/not-found",
  "near/unreadable",
  "polkadot/not-final",
  "polkadot/not-found",
  "polkadot/unreadable",
  "stacks/not-final",
  "stacks/not-found",
  "stacks/unreadable",
  "starknet/not-final",
  "starknet/not-found",
  "starknet/unreadable",
  "stellar/not-found",
  "stellar/unreadable",
  "sui/not-found",
  "sui/unreadable",
  "svm/not-final",
  "svm/not-found",
  "svm/unreadable",
  "tempo/not-final",
  "tempo/not-found",
  "tempo/unreadable",
  "tron/not-found",
  "tron/unreadable",
  "tvm/not-found",
  "tvm/unreadable",
  "xrpl/not-found",
  "xrpl/not-validated",
  "xrpl/unreadable",
];

/** Every other code the package returns, by namespace. */
export const NOT_READS_TO_REPEAT: Readonly<Record<string, readonly string[]>> = {
  a2a: [
    "legal-context-conflict", "legal-context-malformed", "link-not-https", "no-legal-context", "no-signed-place",
    "too-large",
  ],
  ack: [
    "id-not-lcp", "legal-context-conflict", "legal-context-malformed", "link-not-https", "no-legal-context",
    "no-signed-place", "option-malformed", "receipt-malformed", "token-malformed", "too-large",
  ],
  acp: [
    "allowance-changed", "allowance-malformed", "choice-malformed", "hash-not-session", "id-conflict", "id-not-hash",
    "legal-context-conflict", "legal-context-malformed", "link-not-https", "no-legal-context", "not-buyer-signed",
    "nothing-to-sign", "option-malformed", "session-malformed", "too-large",
  ],
  ap2: [
    "checkout-hash-mismatch", "checkout-id-missing", "checkout-not-latest", "disclosure-unreferenced",
    "hash-not-in-checkout", "jws-malformed", "legal-context-conflict", "legal-context-malformed", "link-not-https",
    "mandate-ambiguous", "mandate-malformed", "no-checkout-mandate", "no-legal-context", "option-malformed",
    "option-not-this-checkout", "sd-alg-unsupported", "too-large",
  ],
  aptos: [
    "chain-mismatch", "network-malformed", "not-an-x402-transfer", "not-entry-function", "tx-malformed", "tx-too-large",
  ],
  avm: [
    "group-too-large", "index-out-of-range", "network-malformed", "network-mismatch", "not-axfer", "note-not-lcp",
    "option-malformed", "peer-missing", "signature-malformed", "txn-malformed", "wrong-reader",
  ],
  card: [
    "legal-context-malformed", "link-not-https", "no-legal-context", "no-signed-place", "option-malformed",
    "tap-field-malformed", "tap-field-missing", "tap-field-repeated", "tap-hash-not-covered", "tap-no-payer-signature",
    "tap-signature-input-malformed", "tap-signature-malformed", "tap-signature-missing", "too-large",
    "vi-checkout-hash-mismatch", "vi-disclosure-unreferenced", "vi-key-malformed", "vi-kid-mismatch",
    "vi-legal-context-conflict", "vi-malformed", "vi-no-checkout-mandate", "vi-sd-hash-mismatch",
    "vi-signature-invalid", "vi-transaction-id-mismatch", "vi-typ",
  ],
  cardano: [
    "ambiguous", "aux-hash-mismatch", "aux-missing", "hash-not-carried", "network-malformed", "not-valid",
    "ttl-missing", "tx-malformed", "tx-too-large", "wrong-reader",
  ],
  casper: [
    "address-malformed", "amount-malformed", "key-tag-mismatch", "network-malformed", "no-authorization-call",
    "option-malformed", "payload-malformed", "reverted", "signature-malformed", "wrong-reader",
  ],
  ccd: [
    "address-malformed", "memo-not-cbor-text", "memo-not-lcp", "no-carrier", "no-memo", "not-v1", "operation-count",
    "operations-malformed", "option-malformed", "payload-kind", "rejected", "too-large", "transaction-malformed",
    "wrong-reader",
  ],
  core: ["binding-not-json", "content-not-json", "slot-duplicate", "slot-name", "slot-reserved", "too-large"],
  discovery: [
    "atr-hash-malformed", "clause-id-malformed", "member-malformed/acceptanceRequired", "member-malformed/api",
    "member-malformed/contact", "member-malformed/contact.legal", "member-malformed/contact.technical",
    "member-malformed/disputeResolution", "member-malformed/disputeResolution.catalog",
    "member-malformed/disputeResolution.contact", "member-malformed/disputeResolution.jurisdiction",
    "member-malformed/disputeResolution.method", "member-malformed/disputeResolution.source",
    "member-malformed/returns", "member-malformed/terms", "member-malformed/termsFormat", "not-json-object",
    "terms-missing", "terms-not-https", "too-large",
  ],
  evm: [
    "ambiguous", "amount-malformed", "channel-id-mismatch", "field-malformed", "network-malformed",
    "no-authorization-use", "no-channel-created", "no-leaf", "no-open-call", "no-permit2-settle", "nonce-not-used",
    "reverted", "wrong-reader",
  ],
  hedera: [
    "chain-id-unnamed", "channel-id-mismatch", "channel-log-not-found", "deprecated-fields", "executor-malformed",
    "executor-not-offered", "list-inconsistent", "memo-not-lcp", "network-malformed", "no-legal-context", "no-memo",
    "not-success", "option-malformed", "read-first", "reverted", "tx-malformed", "tx-too-large", "wrong-reader",
  ],
  ln: [
    "currency-network", "description-inline", "description-present", "expires-after-invoice", "field-length",
    "field-repeated", "invoice-malformed", "invoice-not-named", "invoice-too-large", "no-description-hash",
    "no-legal-context", "no-metadata", "no-payment-in-action", "not-this-pairing", "payment-hash-mismatch",
    "payment-hash-required", "preimage-malformed", "request-hash-mismatch", "return-invoice-malformed",
  ],
  mpp: [
    "access-key-malformed", "attribution-malformed", "attribution-mismatch", "carrier-not-challenge",
    "carrier-occupied", "carrier-taken", "chain-id-required", "challenge-malformed", "channel-named",
    "channel-not-bound", "credential-malformed", "credential-type", "credential-types", "escrow-malformed",
    "expires-required", "gateway-unread", "header-malformed", "id-not-ours", "input-malformed",
    "legal-context-conflict", "legal-context-malformed", "link-not-https", "metadata-malformed", "modes-pull-only",
    "network-unnamed", "no-legal-context", "no-signed-place", "nonce-not-challenge-hash", "nonce-not-channel",
    "nonce-not-usdc-derivation", "not-an-opening", "not-bound-within", "not-this-pairing", "opaque-malformed",
    "opaque-not-this-hash", "receipt-malformed", "receipt-missing", "request-malformed", "request-not-jcs",
    "salt-not-this-hash", "salt-not-usdc-derivation", "session-action", "session-protocol", "source-required",
    "splits-malformed", "stacks-memo-not-h", "stacks-tx-malformed", "usdc-profile", "within-action-not-built",
    "witness-not-challenge-hash", "witness-taken",
  ],
  near: [
    "actions", "args-malformed", "carrier-occupied", "memo-missing", "memo-not-lcp", "network-malformed", "no-relayer",
    "not-ft-transfer", "not-hash-credential", "option-malformed", "peer-missing", "sda-malformed", "sda-too-large",
    "wrong-reader",
  ],
  polkadot: [
    "address-malformed", "address-not-id", "call-not-profile", "call-not-suffix", "extrinsic-malformed",
    "extrinsic-too-large", "network-unsupported", "no-remark", "no-transfer", "not-located", "not-signed-v4",
    "option-malformed", "range", "remark-not-lcp", "signature-malformed", "wrong-reader",
  ],
  stacks: ["no-memo", "not-success", "wrong-reader"],
  starknet: [
    "ambiguous", "caller-forbidden", "felt-malformed", "network-malformed", "no-legal-context", "no-transfer",
    "nonce-not-bound", "option-malformed", "reverted", "signature-malformed", "typed-data-malformed", "wrong-reader",
  ],
  stellar: [
    "amount-mismatch", "asset-mismatch", "carrier-mismatch", "carrier-occupied", "event-malformed", "network-malformed",
    "no-address-auth", "no-carrier", "not-one-transfer", "option-malformed", "payer-mismatch", "peer-missing",
    "read-first", "tx-failed", "tx-malformed", "tx-too-large", "wrong-reader",
  ],
  sui: [
    "aborted", "ambiguous", "hash-not-carried", "network-malformed", "not-programmable", "peer-missing", "tx-malformed",
    "tx-too-large", "wrong-reader",
  ],
  svm: [
    "bundle-empty", "carrier-mismatch", "carrier-not-canonical", "carrier-occupied", "channel-id-mismatch",
    "channel-instruction", "channel-mismatch", "err", "input-malformed", "memo-count", "memo-not-lcp", "memo-not-utf8",
    "network-malformed", "network-undeclared", "no-carrier", "no-channel-instruction", "nonce-account-not-static",
    "open-not-found", "pda-not-found", "peer-missing", "proof-not-challenge", "read-first", "signer-not-operator",
    "tx-malformed", "tx-too-large", "wrong-reader",
  ],
  tempo: [
    "ambiguous", "descriptor-mismatch", "key-authorization-malformed", "key-not-authorized", "memo-not-bound",
    "no-access-key", "no-witness", "open-ambiguous", "open-not-found", "read-first", "reverted", "salt-not-bound",
    "tx-malformed", "tx-too-large", "witness-not-bound", "wrong-reader",
  ],
  tron: [
    "address-malformed", "contracts", "fee-limit", "memo-not-lcp", "network-malformed", "not-transfer", "not-trigger",
    "option-malformed", "raw-not-canonical", "signature-malformed", "tx-malformed", "tx-too-large", "wrong-reader",
  ],
  tvm: [
    "actions", "boc-malformed", "boc-too-large", "carrier-mismatch", "carrier-occupied", "network-malformed",
    "not-jetton-transfer", "not-w5-signed", "option-malformed", "payload-not-lcp", "peer-missing", "value-too-low",
    "wrong-reader",
  ],
  ucp: [
    "already-signed", "ap2-not-active", "checkout-malformed", "hash-not-in-checkout", "legal-context-conflict",
    "legal-context-malformed", "link-not-https", "no-legal-context", "not-buyer-signed", "nothing-to-sign",
    "option-malformed", "option-not-this-checkout", "too-large",
  ],
  x402: [
    "channel-id-mismatch", "channel-kind-unknown", "delegation-empty", "deposit-authorization", "escrow-not-canonical",
    "facilitator-missing", "flow-missing", "flow-not-carried", "legal-context-conflict", "legal-context-malformed",
    "link-not-https", "manager-not-reference", "no-legal-context", "no-payable-option", "nonce-malformed",
    "nonce-not-payment", "not-an-opening", "not-bound-within", "not-v2", "option-malformed", "option-not-in-document",
    "option-not-this-pairing", "payload-malformed", "permission-context-malformed", "request-target-invalid",
    "request-too-large", "salt-malformed", "salt-not-bound", "signature-malformed", "signed-not-bound",
    "spender-not-proxy",
  ],
  xrpl: [
    "blob-malformed", "blob-too-large", "carrier-mismatch", "carrier-not-lcp", "carrier-occupied", "currency-not-xrp",
    "memo-count", "memos-not-carried", "multisigned", "network-malformed", "network-missing", "no-invoice-id",
    "no-memo", "not-channel-create", "not-payment", "not-success", "peer-missing", "read-first", "wrong-reader",
  ],
};
