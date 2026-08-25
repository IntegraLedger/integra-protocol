---
"@integraledger/lcp-binding-evm-escrow": patch
---

`decodeEscrowLogs` surfaces the indexed `paymentInfoHash` — the escrow's join key.

**⛔⛔ IT WAS DECODED AND THEN NOT READ.** `paymentInfoHash` is an indexed parameter on all six escrow
events, so `decodeEventLog` has always returned it — but the `args` cast picked out `paymentInfo` and
`amount` and nothing else, so it never reached `DecodedEscrowLog`. A consumer that needed the key had no
way to read it off the chain and could only take a caller's word for which payment a transition belonged
to, which is not a join.

**⭐ WHY IT MATTERS: FOUR OF THE SIX EVENTS CANNOT RE-PROVE THEIR OWN atrHash.** Only `PaymentAuthorized`
and `PaymentCharged` carry the cleartext `PaymentInfo` whose `salt` IS the atrHash, so `recover` can never
answer for a `PaymentCaptured`, `PaymentVoided`, `PaymentReclaimed` or `PaymentRefunded`. What those carry
is this indexed hash — and it is exactly what `conditional-weld` keys its durable log by, and what its
`ports.ts` names as the thing the package exists to prove: *"the atrHash has to be recoverable from the
authorization artifact AND the capture artifact, joining on the rail's own key (`paymentInfoHash` on
Base)."* The join was designed; the key was simply unreachable through the port.

**⭐ SURFACED HERE RATHER THAN ON `LifecycleTransition`.** `binding-core` fixes that shape for fifteen
bindings and this is one rail's own key — and `decodeEscrowLogs`' own docblock already names itself as the
sanctioned route for exactly this: *"the only way a consumer reaches the asset behind the weld… a caller
checking that a settlement moved the asset its record names calls this directly."* Additive: the field is
added, `salt` is unmoved, and nothing outside this adapter constructs a `DecodedEscrowLog`.

Driven three ways: dropping the field, hard-coding it to a constant, and taking it from the salt (right on
an authorize, zeroed on a capture — the shape a naive implementation takes) each turn tests red. The
constant case is the one that matters: two logs from different payments must decode to different keys, or a
capture from another payment would join to this one's log.
