import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The MPP-EVM Id-Reuse binding manifest (published as `mpp-evm-derived-v1`).
 *
 * **pattern = "id-reuse"** (LCP §8.3.5), and this is the one member of the family that differs *at the
 * weld*. On MPP's EVM charge method the EIP-3009 nonce is not ours to occupy: `draft-evm-charge-00` §5.3.1
 * REQUIRES `nonce = keccak256(abi.encodePacked(challenge.id, challenge.realm))`, and §5.2.3 fixes the
 * Permit2 witness type string with a MUST ("Implementations MUST use the exact type string above"). There is
 * no free field on this path. What remains available is Id-Reuse: the seller sets `challenge.id = atrHash`,
 * so the host's own derivation carries the record into the settlement transaction.
 *
 * **Do NOT reconcile this manifest against `binding-evm-x402`'s.** That package's docblock records an
 * archived declaration marked KNOWN-BAD for reading MPP-EVM's derivation-MUST onto the x402 path, where no
 * derivation exists. This is where that reading is correct, and the two manifests legitimately differ: x402
 * is off-canonical Native Field on the same nonce field, MPP-EVM is Id-Reuse over a derivation. "Fixing" one
 * to look like the other reintroduces the bug the archive comment exists to stop.
 *
 * **`nativeField` is absent, and its absence is substantive** — not merely the schema's `iff`. Nothing of
 * ours occupies a protocol field here; the atrHash rides an identifier the host protocol already requires.
 *
 * **SCOPE — this manifest declares ONE of MPP's four credential types, and the scope is load-bearing.**
 * `draft-evm-charge-00` defines four ways a client may present payment, and the derived `challengeHash`
 * reaches the chain in exactly one of them:
 * - **§5.3 `authorization`** — the derived value IS the EIP-3009 nonce, so it is committed on-chain. Opt-in
 *   and token-conditional: §4.2.2 "Servers MUST only include `"authorization"` when the `currency` token is
 *   known to implement EIP-3009", and §5.3.2 the same rule as a prohibition ("Servers MUST NOT advertise
 *   `"authorization"` in `credentialTypes` unless the `currency` token is known to implement EIP-3009").
 *   **This is the credential type this binding covers, and the only one it can.**
 * - **§5.2 `permit2`** — "The RECOMMENDED credential type", and it carries the SAME derived `challengeHash`
 *   inside the EIP-712 `PaymentWitness` struct, which the client signs but which never appears in calldata or
 *   an event log; §10.4 places it "in the EIP-712 witness data (Permit2)". Signature-committed, off-chain,
 *   unreadable from a settlement.
 * - **§5.4 `transaction`** and **§5.5 `hash`** — plain ERC-20 transfers. No challengeHash anywhere; §10.4
 *   says so outright ("weaker challenge binding than Permit2 credentials").
 *
 * So `weldGrades` is keyed by MPP's own credential-type name rather than by a coinage like `derived`: the key
 * IS the scope, machine-readably, and `finality.note` repeats it in prose for whoever reads only the published
 * profile JSON. A grade for `permit2` would be declared from the specification rather than from this binding —
 * the package constructs no witness — and `transaction`/`hash` have no weld to grade. Generalizing the
 * strongest leg to the whole rail is the failure this scoping exists to prevent, and the adapter enforces the
 * same scope at runtime: a settlement that moved the token without an `AuthorizationUsed` beside it is refused
 * by credential type, never reported as an absence of settlement.
 *
 * **The WLD-3 triple, under that scope:**
 * - `onChain: true` — the derived value is the EIP-3009 nonce, emitted as an indexed topic of
 *   `AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)` and consumed on-chain by the
 *   token contract (§8: "The nonce is consumed on-chain by the token contract itself"). **Read from the host
 *   specification and from the adapter's own behaviour on synthetic logs; NOT yet from a live MPP-EVM
 *   settlement** — the repository's opt-in on-chain integration suite discharges that against a real transaction, and until
 *   it runs, this member is the one still owed a live proof.
 * - `zeroPartyRecoverable: false` — keccak-256 has no inverse. An auditor holding only the transaction hash
 *   reads the nonce and cannot obtain the atrHash from it. Verification of a *candidate* is the whole of
 *   what this rail offers, which is why the adapter exposes `verifyCandidate` and why `recover` refuses.
 *   Observed of the code: no member maps a settlement to an atrHash, and `recover` takes no arguments.
 * - `forwardIndexable: false` — §8.3's criterion is enumeration "bound to a given `atrHash`", and §8.3.5
 *   states it directly: "Not forward-indexable by `atrHash` alone — the on-chain value is a hash over
 *   `atrHash` and other inputs." Knowing the realm as well, one *could* derive the nonce and topic-filter it,
 *   but that is realm-scoped, and it is degenerate besides: §8.3.5's uniqueness satisfaction makes each ATR
 *   unique per transaction, so there is at most one settlement per atrHash to enumerate. Hence `indexing:
 *   "none"` and no `enumerate` member. Observed of the code: no `enumerate` exists to call.
 *
 * `weldGrades.authorization = "signature"`: the payer's EIP-3009 typed-data message covers the `nonce` field,
 * so the buyer's signature — not merely an inclusion in a transaction — commits the derived value.
 */
export const MPP_EVM_MANIFEST: BindingManifest = {
  rail: "evm:mpp",
  protocol: "mpp",
  pattern: "id-reuse",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  },
  assetBinding: "filtered", // candidate verification filters the configured token's own log (AuthorizationUsed / assetWasTransferred)
  successGate: "structural", // a reverted tx emits no logs, so the weld event cannot exist
  indexing: "none",
  finality: {
    reversible: false,
    note: "scoped to MPP's `authorization` credential type (§5.3), the only one of the four whose challengeHash reaches the chain — under the RECOMMENDED `permit2` type (§5.2) the same derived value is signature-committed in an off-chain EIP-712 witness, and `transaction`/`hash` (§5.4/§5.5) bind no challenge at all. Within that scope: final on settlement — the EIP-3009 authorization is consumed on-chain and there is no on-rail reversal; the weld is derivation-bound (nonce = keccak256(abi.encodePacked(challenge.id, challenge.realm)), draft-evm-charge-00 §5.3.1), so a candidate atrHash is VERIFIED against the on-chain nonce and never recovered from it; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution. The §8.3.5 discharge rests on the ATR STATING the transaction parameters (LCP §6.1), not on ATR uniqueness: MPP binds the challenge id to the challenge parameters, and uniqueness alone does not satisfy that (§C.1). The tree checks it as OFR — `offerBoundStep`, required at TC-4 — so this weld is only as strong as the record's class. Zero-party-recoverable on-chain binding on this rail still requires an Overlay Contract per §8.3.2",
  },
  weldGrades: { authorization: "signature" },
  lifecycleStates: ["proposed", "settled"],
};
