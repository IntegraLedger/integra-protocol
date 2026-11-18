/** The data of the Algorand pairing. */
import { freeze } from "./freeze.js";

export const ALGORAND = /* @__PURE__ */ freeze({
  "x402/exact/algorand": {
    coverage: "full",
    carrier: {
      signed: "the asset transfer's `note`: H's LCP string, the 77 ASCII bytes `lcp:sha256:` and H in 0x lowercase hex, all of H",
    },
    source: "lcp's client; the stock `@x402/avm` client writes its own note, and its payment is refused before anything moves",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["indexer-rest"],
      search:
        "Found by the transaction id. At a lapse or a consumed id, the search for H over the payer's (`snd`) transactions " +
        "from one past the issue position to the Indexer's latest round, each note compared with H, bounded and resumed at " +
        "the position its answer carries.",
      history: "from the position recorded at issue (the Indexer's last round; every round is final)",
      contracts: [],
      lapse:
        "the transaction id absent past `lastValid` at a round the Indexer holds, with the search for H read whole and no " +
        "payer act for H found",
      life: {
        value: 1000,
        unit: "rounds",
        rule: "a signed payment is payable through its `lastValid` round, which lcp's client sets at most 1,000 rounds after its `firstValid`; no fixed rule turns rounds into seconds",
      },
    },
    destination: "`arcv` (the Indexer's `receiver`), recorded as observed and compared with the option's payee",
    asset: "`xaid` (the Indexer's `asset-id`), recorded as observed and compared with nothing",
    payer: "`snd` (the Indexer's `sender`); the signer is `sgnr` (the Indexer's `auth-addr`) where set, else `snd`",
    confirmed: "yes",
    agreement: {
      floor: "0",
      fee: "the settler, by fee pooling, where the option names `extra.feePayer`, fixed in what the buyer signs; else the buyer",
      succeeded:
        "the transaction id is confirmed in a round, its note H and its signer not the payee; on a charge `arcv` is the " +
        "payee; on an agreement `arcv` is recorded and held to no account",
    },
    proves:
      "The payer's account authorized an Algorand asset transfer whose note is this ATR's hash in LCP string " +
      "form, with a key's signature, a multisignature or a Falcon signature, by the account's own key or the key " +
      "it is rekeyed to; a logic signature, or a transfer that names an asset sender, is no such act. The ledger " +
      "verified that authorization when it confirmed the transaction, which is final on confirmation, and the note " +
      "is on chain in it. Where the transfer moved an amount, zero included, the payer paid it to the account the " +
      "transfer names (`arcv`). As an agreement, it shows that this account signed the transfer carrying the hash. " +
      "It does not show that amount, asset or timing match the ATR's content.",
  },
});
