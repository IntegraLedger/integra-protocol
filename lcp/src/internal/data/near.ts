/** The data of the NEAR pairings. */
import { freeze } from "./freeze.js";

export const NEAR = /* @__PURE__ */ freeze({
  "x402/exact/near": {
    coverage: "full",
    carrier: {
      signed: "the `memo` argument of the one `ft_transfer`, H's LCP string, inside the NEP-366 delegate action the payer signs; all of H",
    },
    source: "lcp's client; the stock `@x402/near` client writes no memo, so no stock client pays this form",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      fallback: "json-rpc",
      note: "the archival fallback for history below the node's floor",
      search:
        "The payer's access key (account and public key): the change that carried its nonce to or past the signed one, " +
        "from the position recorded at issue to the delegate's `max_block_height`, and, where the nonce is read at or " +
        "past the signed one, to the block it was read so at. The search for H reads the changes of every access key of " +
        "the payer's account from the issue position to the latest head at the read. A hash a settler names is a hint. " +
        "Not yet shown on a live relayed delegate; until a run shows it whole, no read answers a `failed` but " +
        "`before-position`.",
      history: "from the position recorded at issue (the final block height); below the node's floor, the declared archival fallback",
      contracts: [],
      lapse:
        "the access key's nonce still below the signed nonce at a final block past `max_block_height`, and the changes of " +
        "every access key of the payer's account from the issue position to the latest head at the read, read whole, " +
        "holding no delegate of the act asked about; a nonce at or past the signed one whose change is not found, and a " +
        "key deleted before that block, are never a lapse",
    },
    destination:
      "the `receiver_id` of the executed `ft_transfer`, recorded as observed; on a charge the delegate pays only where it " +
      "is the payee's account",
    asset: "the token the delegate's `ft_transfer` executes on, recorded as observed and compared with nothing",
    payer: "the delegate's sender and its key",
    confirmed: "yes",
    agreement: {
      floor: "1",
      fee: "the relayer, always",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "the relayer's transaction at the mark, the delegate's `ft_transfer` receipt with outcome success and its memo H; " +
        "its token and `receiver_id` recorded as observed",
    },
    proves:
      "Paid: the payer's account signed a NEP-366 delegate action whose one ft_transfer carries this ATR's hash in its " +
      "memo, in LCP string form, so the payer's own signed act carries the hash. The runtime verified that signature " +
      "and ran the delegate, and the transfer succeeded on the token contract the delegate names, reaching the account " +
      "its receiver_id names, both as read. The signer is the delegate's sender, named apart from any other act's. This " +
      "states nothing of the amount, nor that the token, the account reached or the time meet a term of the ATR.",
  },
  "mpp/charge/nearintents": {
    coverage: "none",
    carrier: { signed: null, member: ["externalId"] },
    link: "h",
    source:
      "the seller writes H's LCP string in the challenge request's `externalId`; the stock " +
      "`@defuse-protocol/nearintents-mpp-sdk` 0.4.0 client presents the `hash` credential, and no one writes H into a payment",
    nonce: "unshown",
    broadcasts: "payer",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment was reported, an agreement transaction carrying this ATR's hash was signed on " +
      "<network>, recorded in <transaction>; this shows neither that its signer is the payer nor when the " +
      "deposit was made. The seller's MPP challenge carried the hash in its externalId. The deposit carries no " +
      "hash, and its payer signed nothing that does. The seller reported it paid.",
  },
});
