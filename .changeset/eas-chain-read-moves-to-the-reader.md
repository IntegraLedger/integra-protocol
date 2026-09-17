---
"@integraledger/lcp-binding-evm-common": minor
---

The EAS chain read leaves the binding: the package ships what an attestation MEANS, and the party who verifies performs the read

`readEasAttestation` is removed from `@integraledger/lcp-binding-evm-common`. `EAS_GET_ATTESTATION_ABI`,
`RawEasAttestation`, `EasAttestation`, `decodeEasAttestation` and `isEasValidAsOf` all stay, unchanged.

⛔ **The principle, not a cleanup.** Integra records; the parties verify. `recordAttestation` emits every
envelope with `substrateCheck: { status: "not-attempted" }` and carries `substrate` and `ref` precisely so a
reader can go and check what this estate did not. A chain read is that reader's act, and it was being
shipped from inside the recorder's tree.

⭐ **Nothing about the check moved out of reach, which is why this is a split rather than a deletion.** The
ABI to call with, the struct the node returns, the normalization and the two-sided as-of predicate are all
still exported — everything needed to write the read, minus the performing of it. The replacement is four
lines over the `ChainReader` port the caller already holds, and it is a worked, compiled example in
`docs/developer/guides/verify-a-settlement.md` Step 5 rather than prose.

⚠️ **Measured before removing it: zero callers.** Across all three repositories of this estate,
`readEasAttestation` appeared in exactly three places — its own definition, its barrel export and its own
test. It also had a second distinction: of every chain read in the shipped sources, it was the only one that
took a raw viem `PublicClient` instead of going through `binding-core`'s `ChainReader` port, which every
binding's `recover` and `observe` use. The documented replacement uses the port.

⚠️ `eas.ts`'s file header is rewritten. It described a division of labour with `authority`'s
`attestation-profile.ts` — that file interpreting attestations generically, "the per-substrate on-chain
read" living here — which that file no longer states. ⛔ The port was never BUILT rather than removed, and
the distinction matters to anyone who goes looking for it: no `*Port` type exists in any package's `src/`,
nothing anywhere dispatches on a substrate identifier, and `attestation-profile.ts`'s own header records
both facts while `AttestationSubstrateCheck` has exactly one inhabitant. Nothing wired the two ends
together either. The sentence here outlived the sentence there by a release.
