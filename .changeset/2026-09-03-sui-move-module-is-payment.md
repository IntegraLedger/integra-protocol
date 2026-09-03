---
"@integraledger/lcp-binding-sui": patch
---

The Sui manifest's opening paragraph named the wrong Move module, and now a test resolves the name.

It said Pay402's "Move module is `x402_payment`" while contradicting itself twenty-seven lines below, where
the same docblock gives the `MoveEventType` filter as `<pkg>::payment::PaymentSettled`. `constants.ts`
composes every fully-qualified name — the settle target and the settled-event type — from
`PAY402_MODULE = "payment"`, and that is the spelling that is right: the live testnet harness appends a
real `settle_payment` call built from `pay402SettleTarget` and then filters real events with
`pay402SettledEventType`, and a `moveCall` naming a module the deployed package does not contain never
executes.

No behaviour changes. What changes is that the sentence is now checked: `test/constants.test.ts` reads
`src/manifest.ts` and requires every "Move module `x`" it states to be `PAY402_MODULE`, refusing an empty
match set so a reworded sentence fails rather than silently stopping being checked. A name that appears
only in prose is a name no test resolves, which is how one wrong module name survived beside eight right
ones. `binding-core`'s protocol-neutrality comment carried the same wrong name and no longer states one.
