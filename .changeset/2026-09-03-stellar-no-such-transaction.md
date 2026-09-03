---
"@integraledger/lcp-binding-stellar": minor
---

A transaction Horizon does not have is no longer reported as a transaction with no muxed destination.

`StellarReader.settlementView` returned `Promise<StellarSettlementView>` with no `null` in it, so a reader
asked about a hash Horizon has never seen had to invent a view — and the only view it could invent,
`{ muxedDestination: null }`, is exactly what a real transaction paying an unmuxed address looks like. All
four surfaces then refused `stellar/no-muxed-destination` about a transaction that does not exist: a claim
about a settlement, made where there was nothing to make a claim about. Four sibling rails — solana,
cardano, xrpl, hedera — carry a `no-such-transaction` reading for precisely this distinction and cite this
rail as the model for it.

The port now returns `StellarSettlementView | null`, and `null` refuses `stellar/no-such-transaction`
across `verify`, `recover` and `observe`; `enumerate` skips it, as it skips a failed transaction, because a
scan reports what it found and never what it could not look at.

**This changes published behaviour and the port's type.** A `StellarReader` implementation keeps
compiling — a narrower return type still satisfies the wider one — but a caller matching on
`stellar/no-muxed-destination` for an unknown hash now sees `stellar/no-such-transaction`.
