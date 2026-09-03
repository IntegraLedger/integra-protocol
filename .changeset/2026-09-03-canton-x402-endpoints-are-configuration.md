---
"@integraledger/lcp-binding-canton-x402": minor
---

The participant endpoint paths are configuration, not constants this package invents.

`makeCantonX402Reader` POSTed to `/v1/updates/transfer` and `/v1/updates/transfers`. Neither names an
endpoint of any published Daml JSON API version — v1 defines `/v1/create`, `/v1/exercise`, `/v1/query` and
`/v1/fetch` and no `updates` family, and the update endpoints that do exist live under `/v2/`. Nothing here
could have caught it: the only assertion over those paths was a stubbed `fetch` compared against the URL
the code itself builds, so the test and the code restated one guess to each other.

The fix is not a better guess. A Canton Coin `TransferFactory_Transfer` is a token-standard object, and
how a deployment exposes one over HTTP — stock JSON Ledger API version, scan proxy, or a facilitator's own
service in front of the participant — is a property of that deployment. `CantonX402ReaderConfig` therefore
requires `transferPath` and `transfersPath`, refuses an empty one at construction rather than POSTing to
the base URL, and the live harness reads them from `CANTON_X402_TRANSFER_PATH` /
`CANTON_X402_TRANSFERS_PATH` (mapped in `live-proofs.yml`, so `check:live-rails --check-env` names them
when a run cannot proceed).

**This changes published behaviour**: `makeCantonX402Reader` now needs two more fields and throws without
them.
