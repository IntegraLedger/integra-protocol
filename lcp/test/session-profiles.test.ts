import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import { XRPL_NETWORKS } from "../src/mpp-rail-checks.js";
import { sessionXrpl } from "../src/mpp.js";
import type { LcpPattern } from "../src/x402.js";

// Each session profile's published text, whole: its heading names its id, then its rules, each as published.
const PROFILES: readonly [profile: string, file: string, pairings: readonly string[], text: readonly string[]][] = [
  [
    "mpp/session/evm-tempo",
    "mpp-session-evm-tempo.md",
    ["mpp/session/evm", "mpp/session/tempo"],
    [
      "**LCP profile `mpp/session/evm-tempo`: the ATR hash in an MPP session or subscription opening.**",
      "",
      "1. The challenge carries H as `mpp/charge` rules 1, 3 and 5 say. The id is rule 2's, except that a Tempo `subscription` challenge's id is exactly the base64url (no padding) of H.",
      "2. Session (`evm`, `tempo`): the client opens a new channel whose `salt` is H's 32 bytes. EVM `authorization`: the EIP-3009 nonce is keccak256(abi.encode(from, recipient, currency, H, authorizedSigner)), as MPP requires. EVM `permit2`: the witness `salt` is H. EVM `hash` and Tempo: the signed `open` call's salt is H, and a Tempo v2 descriptor carries it.",
      "3. A session challenge naming `channelId` resumes a channel. The client pays it with a voucher only for a channel it opened for an ATR it compared.",
      "4. Subscription (`tempo`): the key authorization's `witness` is the id's 32 bytes, which is H.",
      "5. One ATR covers the whole session or subscription. Vouchers, top-ups and renewals carry no new ATR.",
    ],
  ],
  [
    "mpp/session/hedera-solana-xrpl",
    "mpp-session-hedera-solana-xrpl.md",
    ["mpp/session/solana/memo", "mpp/session/solana/stock", "mpp/session/xrpl", "mpp/session/hedera/stock"],
    [
      "**LCP profile `mpp/session/hedera-solana-xrpl`: the ATR hash at a session's opening, or, on the Hedera and Solana stock sessions, an agreement recorded before it.** Clauses 1–3 and 5 of `mpp/charge` apply to the opening challenge. One ATR covers the whole channel.",
      "",
      "1. `hedera`: the stock session, `mpp/session/hedera/stock`, at coverage `none`. The stock client sends `approve` and the escrow's `open` itself, with a random `salt`, so nothing the payer signs carries H: the session is served only after an agreement on its own network is recorded, and its opening counts for the sale only where it comes after that agreement and the account that opened it signed the agreement, which the server compares. `pairingsOf` names it for a `session` challenge on `hedera` that names no `channelId`, whose `chainId` is absent, 295 or 296, and whose `currency`, `recipient` and `escrowContract` are addresses; `bound` finds no signed place for H. `reference` takes the read keys from the opening's credential and the payee from the `recipient` of the challenge it is given, and refuses one that is not, by the members fixed at issue, the challenge the credential echoes, `mpp/challenge-not-option`. The read (`status`, under the profile `read-status`) takes the opening by the `txHash` its credential names, through the network's JSON-RPC relay, at one mark, `finalized`, every block the relay serves being final; a network that declares no relay is not served. A revert is `transaction-failed` where the call its sender signed is the escrow's `open` to the challenge's `recipient`, and `instrument-consumed` otherwise, a revert moving nothing. A receipt holding exactly one `ChannelOpened` from the escrow naming the channel, whose members give the channel id it names, is the opening: its signer is the account id the mirror resolves the log's `payer` to (`GET /api/v1/accounts/{address}`), an address it resolves to no account being another account; it is the payee's own act where that is the account the `recipient` resolves to; it names the payee where the log's `payee` is the `recipient` or resolves to the same account; and what moved is the deposit, named by the transaction and the log's place among the receipt's logs, its token and amount compared with nothing. Any other receipt that succeeded is no opening of the channel, `instrument-consumed`. No receipt is `pending`, `not-found`, where the mirror holds the blocks after the position given, by the number of its oldest block or an archival declaration, and `unreadable`, `history-gap`, otherwise. Declared inapplicable to the read kit: `below-mark`, every block the relay serves being final; `instrument-live`, `instrument-unused` and `search-incomplete`, the read reading no nonce state, making no search and stating no lapse.",
      "2. `solana`, `@solana/mpp` 0.7.0's session, its members in the request itself (`src/Methods.ts:258-301`), as two pairings. A challenge whose `modes` is exactly `[\"pull\"]` and whose `pullVoucherStrategy` is `clientVoucher` is `mpp/session/solana/memo`: the stock client opens in the first mode listed and under it composes an `open` whose fee payer and rent payer is the challenge's `operator`, the seller's key (`src/client/Session.ts:767`; `src/client/PaymentChannels.ts:104-173`, `:198-215`), so the buyer's client cannot broadcast it alone, and the seller's server, set to `openTxSubmitter: \"server\"`, co-signs and submits it (`src/server/Session.ts:110`, `:472-485`). lcp's client composes that stock `open` and adds one Memo Program instruction whose data is H's LCP string, `lcp:sha256:0x` and 64 lowercase hex digits; it states the composed transaction's size, its two signatures included, and refuses one past the 1,232-byte packet before signing (`svm/tx-too-large`). Before the server submits anything it refuses an open action that carries no `transaction`, which the stock server-opened opener writes (`src/client/PaymentChannels.ts:254-263`), and an `open` without the memo, a stock `open` among them (`svm/no-carrier`); an `open` whose fee payer or rent payer is not the `operator`, or whose payer is (`svm/open-not-operator`); and a memo spelled otherwise (`svm/carrier-not-canonical`), more than one (`svm/memo-count`), or one naming another H than the challenge's id (`mpp/carrier-not-challenge`). The stock server's check of the `open` finds the payment-channels instruction among the transaction's instructions and refuses no other (`src/server/session/on-chain.ts:569-581`). A challenge whose `pullVoucherStrategy` is `operatedVoucher` is refused at `pairingsOf`, `svm/operated-voucher`: its stock opening is a token delegation, which deposits nothing and may broadcast nothing (`src/client/Session.ts:769-777`; `src/server/Session.ts:524-548`). Under any other challenge the buyer's client broadcasts the stock `open`, whose salt is a random number, and the pairing is `mpp/session/solana/stock`, at coverage `none` with no link: the agreement is made first, on the session's network, and the opening counts only where it comes after the agreement was recorded and the account that opened it signed the agreement, that account being the `open`'s `payer`, account 0, whose token account funds the deposit (`src/client/Session.ts:795`; `src/client/PaymentChannels.ts:153`), never its `authorizedSigner`, the session key that signs vouchers. Its `bound` answers `mpp/no-signed-place`, and the read names the opening by its signature. Where a client writes the session bearer proof of draft-solana-session-00 (`sessionProof`), its `sessionChallengeId` is the opening challenge's `id`; `@solana/mpp` 0.7.0 writes none. Their read: `mpp/session/solana/memo`'s is the one `x402/upto/solana`'s profile states, its act the opening, its deposit counting where the distribution its `open` names holds the option's payee; `mpp/session/solana/stock`'s, at coverage `none`, looks up the opening named by its signature at `finalized` and at the latest head, `confirmed`, which is no mark, and makes no search, the opening being the act whether or not it carries H. Declared inapplicable to the read kit, cases the read cannot meet on Solana: on both, the case settled at a finality asked for below the final mark, since a seller names `finalized` alone; on the memo session, while the search proves no absence, every case at coverage `full` whose answer is `instrument-unused`, `instrument-consumed` or `transaction-failed`, and each transfer of what moved is named by its transaction and its place in it, since its act is an opening that holds exactly one `open`, whose one deposit into the channel's token account is what moved, a transaction holding more being no act of this pairing; and, both reads holding the signed message, a read that did not read the value at the latest head and a value whose validity passed, unconsumed at the final mark and consumed at the latest head.",
      "3. `xrpl`: the `PaymentChannelCreate`, which the payer signs with a single key (a blob that carries `Signers` is refused `xrpl/multisigned`), carries exactly one memo whose `MemoData` is the UTF-8 of `lcp:sha256:` followed by H. It carries no `NetworkID`, as rippled's `preflight0` requires on each network the challenge names, whose ids are at most 1024 (a blob that carries one is refused `xrpl/network-mismatch`).",
      "4. On `solana`'s memo session and on `xrpl`, the server refuses an opening that lacks its carrier, before it broadcasts where the method lets it.",
    ],
  ],
];

describe("the session profiles", () => {
  for (const [profile, file, pairings, text] of PROFILES) {
    it(`${profile}: its pairings name it, and profiles/${file} is its published text, whole`, () => {
      const named = BINDINGS.filter((b) => "pattern" in b && (b.pattern as LcpPattern).profile === profile).map((b) => b.id);
      expect(named).toEqual(pairings);
      const url = new URL(`../profiles/${file}`, import.meta.url);
      expect(existsSync(url)).toBe(true);
      expect(readFileSync(url, "utf8")).toBe(`${text.join("\n")}\n`);
    });
  }

  // Clause 3's `NetworkID` sentence holds for the networks the XRPL session reads from `methodDetails.network`: rippled
  // takes a transaction without `NetworkID` only on a network whose id is at most 1024 (`networkIdHeld`).
  it("mpp/session/hedera-solana-xrpl: each network an xrpl challenge names has an id of at most 1024", () => {
    const ids = Object.values(XRPL_NETWORKS).map((n) => Number(n.slice("xrpl:".length)));
    expect(ids).toEqual([0, 1, 2]);
    expect(ids.every((id) => Number.isSafeInteger(id) && id <= 1024)).toBe(true);
  });
});

// The XRPL session record, whole: each field of the pairing's published record, and its `proves`
// sentence as published.
const RECORDS = [
  [
    sessionXrpl,
    {
      pattern: "native-field",
      profile: "mpp/session/hedera-solana-xrpl",
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
      proves:
        "The payer signed, with a single key, an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's hash, and it is in a validated ledger with tesSUCCESS. The memo is in the public transaction. Vouchers in this channel sign the channel id and an amount, not the hash. This does not show that amount, deposit, destination, settle delay or timing match the ATR's content.",
    },
  ],
] as const;

describe("the XRPL session record", () => {
  for (const [binding, record] of RECORDS) {
    it(`${binding.id}: every field as published, and claims`, () => {
      expect({ ...binding.pattern, proves: binding.data.proves }).toEqual(record);
      expect(binding.data.coverage).toBe("full");
      expect(binding.claims).toBe(true);
    });
  }
});
