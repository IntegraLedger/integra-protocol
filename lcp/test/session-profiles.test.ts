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
    ["mpp/session/xrpl"],
    [
      "**LCP profile `mpp/session/hedera-solana-xrpl`: the ATR hash at a session's opening.** Clauses 1–3 and 5 of `mpp/charge` apply to the opening challenge. One ATR covers the whole channel.",
      "",
      "1. `hedera`: the escrow `open`'s `salt` is H's 32 bytes; `authorizedSigner` may be zero.",
      "2. `solana`: the `open` instruction's `salt` is H's first 8 bytes read as a little-endian u64, so its encoded bytes are H's first 8 bytes. In operator mode, `authentication.challengeId` is the opening challenge's `id`.",
      "3. `xrpl`: the `PaymentChannelCreate`, which the payer signs with a single key (a blob that carries `Signers` is refused `xrpl/multisigned`), carries exactly one memo whose `MemoData` is the UTF-8 of `lcp:sha256:` followed by H. It carries no `NetworkID`, as rippled's `preflight0` requires on each network the challenge names, whose ids are at most 1024 (a blob that carries one is refused `xrpl/network-mismatch`).",
      "4. The server refuses an opening that lacks its carrier, before it broadcasts where the method lets it.",
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
