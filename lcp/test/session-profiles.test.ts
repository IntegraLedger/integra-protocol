import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import { sessionHedera, sessionSolana, sessionXrpl } from "../src/mpp.js";
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
    ["mpp/session/hedera", "mpp/session/solana", "mpp/session/xrpl"],
    [
      "**LCP profile `mpp/session/hedera-solana-xrpl`: the ATR hash at a session's opening.** Clauses 1–3 and 5 of `mpp/charge` apply to the opening challenge. One ATR covers the whole channel.",
      "",
      "1. `hedera`: the escrow `open`'s `salt` is H's 32 bytes; `authorizedSigner` may be zero.",
      "2. `solana`: the `open` instruction's `salt` is H's first 8 bytes read as a little-endian u64, so its encoded bytes are H's first 8 bytes. In operator mode, `authentication.sessionChallengeId` is the opening challenge's `id`.",
      "3. `xrpl`: the `PaymentChannelCreate` carries exactly one memo whose `MemoData` is the UTF-8 of `lcp:sha256:` followed by H.",
      "4. The server refuses an opening that lacks its carrier, before it broadcasts where the method lets it.",
    ],
  ],
];

describe("the session profiles", () => {
  for (const [profile, file, pairings, text] of PROFILES) {
    it(`${profile}: its pairings name it, and profiles/${file} is its published text, whole`, () => {
      const named = BINDINGS.filter((b) => (b.pattern as LcpPattern).profile === profile).map((b) => b.id);
      expect(named).toEqual(pairings);
      const url = new URL(`../profiles/${file}`, import.meta.url);
      expect(existsSync(url)).toBe(true);
      expect(readFileSync(url, "utf8")).toBe(`${text.join("\n")}\n`);
    });
  }
});

// The Hedera, Solana and XRPL session records, whole: each field of the pairing's published record, and its `proves`
// sentence as published.
const LATER = "Later requests in this channel were paid under this ATR by vouchers the seller did not meter";
const RECORDS = [
  [
    sessionHedera,
    {
      pattern: "native-field",
      canonical: false,
      profile: "mpp/session/hedera-solana-xrpl",
      buyerSigns: true,
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
      publicProof: true,
      proves:
        "The payer signed a Hedera EVM transaction that opened an MPP session channel on the escrow contract named in the challenge, with this ATR's hash as the channel's salt, and it reached consensus. The escrow's ChannelOpened event carries the salt, and the channel id is keccak256 over an encoding that includes it. The hash is also in the MPP challenge the opening answered. " +
        `${LATER}. Each voucher signs that channel id, which commits to this ATR's hash. This does not show that amount, deposit, recipient, token or timing match the ATR's content.`,
    },
  ],
  [
    sessionSolana,
    {
      pattern: "truncated-field",
      canonical: false,
      profile: "mpp/session/hedera-solana-xrpl",
      buyerSigns: false,
      onChain: true,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
      publicProof: true,
      proves:
        "The ATR was assembled, written to the seller's storage and linked in the challenge before approval, and its hash is in the MPP challenge the opening answered, protected by the server's binding of the challenge. The payer signed a Solana transaction that opened a session channel on the channel program named in the challenge, with the first 8 bytes of this ATR's hash as the channel's salt, and it executed without error. The salt binds only this hash's first 8 bytes: whoever assembles the ATR can construct a second ATR whose hash shares them. " +
        `${LATER}. Where the operator signs the vouchers, each request also carried the payer's session proof, which signs the opening challenge's id and so this ATR's hash. This does not show that amount, deposit, recipient, mint or timing match the ATR's content.`,
    },
  ],
  [
    sessionXrpl,
    {
      pattern: "native-field",
      canonical: false,
      profile: "mpp/session/hedera-solana-xrpl",
      buyerSigns: true,
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
      publicProof: true,
      proves:
        "The payer signed, with a single key, an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's hash, and it is in a validated ledger with tesSUCCESS. The memo is in the public transaction. " +
        `${LATER}; each signs the channel id and an amount, not the hash. This does not show that amount, deposit, destination, settle delay or timing match the ATR's content.`,
    },
  ],
] as const;

describe("the Hedera, Solana and XRPL session records", () => {
  for (const [binding, record] of RECORDS) {
    it(`${binding.id}: every field as published, and claims`, () => {
      expect(binding.pattern).toEqual(record);
      expect(binding.claims).toBe(true);
    });
  }
});
