# @integraledger/lcp-binding-sui

## 0.17.0

### Minor Changes

- Add `makeSuiGraphqlRpc`, a GraphQL implementation of the `SuiRpcLike` port.
  
  Sui's public fullnode JSON-RPC is deprecated and answers `-32601` to every method, so a reader built on it
  cannot resolve against a public endpoint. `makeSuiReader(makeSuiGraphqlRpc(url))` is the whole migration —
  `recover`, `observe` and `enumerate` are unchanged.
  
  ⛔ The transports disagree about byte encoding, and the disagreement is silent: GraphQL renders a Move
  `vector<u8>` as base64 where JSON-RPC renders it as `number[]`. `parseSuiEvents` answers `undefined` for
  anything that is not an array, and an absent `payment_id` makes `recover` return `sui/no-payment-id` — a
  refusal rather than an error. A wrapper that did not decode at the transport boundary would therefore report
  every real weld as never-anchored with nothing going red, so the decode is done there and asserted end to
  end.
  
  Also: the live rail no longer falls back to a default endpoint when `SUI_TESTNET_RPC_URL` is unset. It
  refuses loudly, because the endpoint it used to fall back to is the deprecated one.

### Patch Changes

- @integraledger/lcp-binding-core@0.17.0
  - @integraledger/lcp-kernel@0.17.0

## 0.16.1

### Patch Changes

- @integraledger/lcp-binding-core@0.16.1
  - @integraledger/lcp-kernel@0.16.1

## 0.16.0

### Patch Changes

- 9d0a5d6: The Sui manifest's opening paragraph named the wrong Move module, and now a test resolves the name.
  
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
- @integraledger/lcp-binding-core@0.16.0
  - @integraledger/lcp-kernel@0.16.0

## 0.15.1

### Patch Changes

- Updated dependencies [83ae16e]
- Updated dependencies [431b8ec]
- Updated dependencies [9c42f73]
  - @integraledger/lcp-kernel@0.15.1
  - @integraledger/lcp-binding-core@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [42fb196]
  - @integraledger/lcp-kernel@0.15.0
  - @integraledger/lcp-binding-core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [aca5978]
  - @integraledger/lcp-kernel@0.14.0
  - @integraledger/lcp-binding-core@0.14.0

## 0.13.0

### Patch Changes

- @integraledger/lcp-binding-core@0.13.0
- @integraledger/lcp-kernel@0.13.0

## 0.12.3

### Patch Changes

- @integraledger/lcp-binding-core@0.12.3
- @integraledger/lcp-kernel@0.12.3

## 0.12.2

### Patch Changes

- @integraledger/lcp-binding-core@0.12.2
- @integraledger/lcp-kernel@0.12.2

## 0.12.1

### Patch Changes

- @integraledger/lcp-binding-core@0.12.1
- @integraledger/lcp-kernel@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - @integraledger/lcp-kernel@0.12.0
  - @integraledger/lcp-binding-core@0.12.0

## 0.10.2

### Patch Changes

- Updated dependencies [b2ffecc]
- Updated dependencies [822190a]
  - @integraledger/lcp-binding-core@0.11.0
  - @integraledger/lcp-kernel@0.11.0

## 0.10.1

**0.10.0 was staged and withdrawn before approval; this is that release, re-cut.** The conformance corpus
was re-sealed after 0.10.0 was staged — its root moved `32fa90a6…` → `28bbf4ef…` when the vector tree was
brought inside the prose gates — so the staged `lcp-conformance` tarball carried a seal that no longer
matched the repository. The seal is what proves corpus authenticity to an independent implementer, and a
published version cannot be replaced, so the whole set was rejected and re-cut rather than shipping one
package that disagreed with its own source. No version 0.10.0 exists on the registry.

### Minor Changes

- f1c531c: **Breaking:** `USDC_DECIMALS` is renamed to `HEDERA_USDC_DECIMALS`, `SOLANA_USDC_DECIMALS`,
  `STELLAR_USDC_DECIMALS` and `SUI_USDC_DECIMALS`.

  All four packages exported the same name and they did not all mean the same number — Stellar assets carry
  seven decimals where the other three carry six. Each value was correct for its own chain, so no package had
  a defect and every package's own test passed; the hazard lived only in importing one rail's constant and
  applying it on another, which is a ten-fold error in an amount and surfaces at settlement rather than at
  compile time. The rail prefix makes that import impossible to make by accident.

  `minor` rather than `major` because every package here is pre-1.0, where a minor is the breaking increment
  under semver. Migration is a rename at the import site; the values are unchanged.

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against the published LCP specification and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
