/**
 * THE CROSS-RAIL RECOVERY-TRIPLE INVARIANT (WLD-3).
 *
 * `recovery` is three claims a stranger acts on: is the binding **on-chain**, is it **zero-party
 * recoverable**, is it **forward-indexable**. WP#4's WLD-3 makes the direction of an error in them
 * normative — *misrepresenting an advisory-grade binding as zero-party-recoverable is non-conformance* —
 * and `binding-core/src/vocabulary.ts` states the same discipline for the codebase: a weaker evidentiary
 * claim is declared as weaker, never flattened into equality.
 *
 * ★ WHY THIS FILE EXISTS. `binding-canton` declared `zeroPartyRecoverable: true` on a ledger where the
 * anchor contract is visible only to its two stakeholders — the buyer and the seller — and the reader needs
 * a JWT authenticating one of them. It was justified on "no party's PRIVATE MATERIAL is needed", which is
 * true and is not the question §8.3 asks; §8.3 asks whether an auditor can recover **without trusting
 * either party to produce records**. Two hand audits reached opposite conclusions on that one declaration
 * before it was settled, which is the argument for machinery rather than review.
 *
 * The sibling file makes this argument for `successGate` and was written after three live defects survived
 * hand-reading eight adapters. This is the same argument applied to the axis WP#4 makes non-conformance to
 * misstate — the one the sibling explicitly does not cover.
 *
 * ★ WHAT THIS CAN AND CANNOT DO. Recoverability is a property of a LEDGER's visibility model, not of a
 * value this suite can construct, so there is no runtime probe that falsifies a false `true` the way a
 * failed-transaction view falsifies a missing success gate. What is mechanisable is the part that actually
 * went wrong: every rail must declare the triple, the declaration must agree with the published profile
 * vector a stranger reads, and the two properties that are DERIVABLE from other declared facts must not
 * contradict them. A new rail cannot quietly skip the axis, and a changed claim cannot diverge from the
 * profile without failing here.
 */

import { readFileSync } from "node:fs";
import { APTOS_MANIFEST } from "@integraledger/lcp-binding-aptos";
import { CANTON_MANIFEST } from "@integraledger/lcp-binding-canton";
import { CANTON_X402_MANIFEST } from "@integraledger/lcp-binding-canton-x402";
import { CARDANO_MANIFEST } from "@integraledger/lcp-binding-cardano";
import type { BindingManifest } from "@integraledger/lcp-binding-core";
import { ESCROW_MANIFEST } from "@integraledger/lcp-binding-evm-escrow";
import { MPP_EVM_MANIFEST } from "@integraledger/lcp-binding-evm-mpp";
import { X402_MANIFEST } from "@integraledger/lcp-binding-evm-x402";
import { HEDERA_MANIFEST } from "@integraledger/lcp-binding-hedera";
import { SOLANA_MANIFEST } from "@integraledger/lcp-binding-solana";
import { STELLAR_MANIFEST } from "@integraledger/lcp-binding-stellar";
import { SUI_MANIFEST } from "@integraledger/lcp-binding-sui";
import { TEMPO_MPP_MANIFEST } from "@integraledger/lcp-binding-tempo-mpp";
import { XRPL_MANIFEST } from "@integraledger/lcp-binding-xrpl";
import { describe, expect, it } from "vitest";

/** Every shipped rail manifest, paired with the published profile a stranger reads. */
const RAILS: [name: string, manifest: BindingManifest, profile: string][] = [
  ["aptos", APTOS_MANIFEST, "aptos-profile.json"],
  ["canton", CANTON_MANIFEST, "canton-profile.json"],
  ["canton:x402", CANTON_X402_MANIFEST, "canton-x402-profile.json"],
  ["cardano", CARDANO_MANIFEST, "cardano-profile.json"],
  ["evm:escrow", ESCROW_MANIFEST, "escrow-profile.json"],
  ["evm:mpp", MPP_EVM_MANIFEST, "mpp-evm-profile.json"],
  ["evm:x402", X402_MANIFEST, "x402-profile.json"],
  ["hedera", HEDERA_MANIFEST, "hedera-profile.json"],
  ["solana", SOLANA_MANIFEST, "solana-profile.json"],
  ["stellar", STELLAR_MANIFEST, "stellar-profile.json"],
  ["sui", SUI_MANIFEST, "sui-profile.json"],
  ["tempo:mpp", TEMPO_MPP_MANIFEST, "tempo-mpp-profile.json"],
  ["xrpl", XRPL_MANIFEST, "xrpl-profile.json"],
];

const profileOf = (file: string): BindingManifest =>
  JSON.parse(
    readFileSync(
      new URL(`../../../vectors/binding/${file}`, import.meta.url),
      "utf8",
    ),
  ) as BindingManifest;

describe("the recovery-triple invariant, across every rail", () => {
  it("every shipped rail manifest is registered here", () => {
    // Pinned so a thirteenth rail cannot be added without being brought under this invariant.
    // 12 -> 13 on 2026-08-08: Canton gained a second rail. The overlay stays for the deployments
    // x402's exact-Canton scheme cannot reach (it settles Canton Coin only); `canton:x402` binds the
    // scheme's own `extra.memo`.
    expect(RAILS.length).toBe(13);
    expect([...new Set(RAILS.map(([n]) => n))].length).toBe(13);
  });

  it.each(RAILS)("%s declares all three members of the triple", (_n, m) => {
    // `recovery` is not optional and neither is any member. An absent claim is not a weaker claim — it is
    // no claim, and a stranger cannot act on it.
    for (const k of [
      "onChain",
      "zeroPartyRecoverable",
      "forwardIndexable",
    ] as const)
      expect(typeof m.recovery[k], `${k} is declared`).toBe("boolean");
  });

  it.each(RAILS)(
    "%s's declaration matches the published profile a stranger reads",
    (_n, m, file) => {
      // The manifest is what the code carries; the profile is what is published. They are two copies of one
      // fact, and this is the direction the drift would go unnoticed.
      expect(profileOf(file).recovery).toEqual(m.recovery);
    },
  );

  it.each(RAILS)(
    "%s: forwardIndexable implies zeroPartyRecoverable, never the reverse",
    (name, m) => {
      // A forward index keyed on the atrHash lets a stranger FIND the settlement without holding its
      // reference. Anything that can do that can also read the binding out of a reference it was handed,
      // so `forwardIndexable: true` with `zeroPartyRecoverable: false` is incoherent. The converse is
      // ordinary and true of most rails here: recoverable from a reference, not searchable without one.
      if (m.recovery.forwardIndexable)
        expect(
          m.recovery.zeroPartyRecoverable,
          `${name} claims a forward index but denies zero-party recovery`,
        ).toBe(true);
    },
  );

  it.each(RAILS)(
    "%s: an off-chain binding cannot be forward-indexable",
    (name, m) => {
      // `onChain: false` means the binding is not on a public ledger at all; there is nothing for a
      // chain-global index to key on.
      if (!m.recovery.onChain)
        expect(
          m.recovery.forwardIndexable,
          `${name} is off-chain but claims a forward index`,
        ).toBe(false);
    },
  );

  it("the rails claiming zero-party recovery are exactly the ones whose ledger allows it", () => {
    // Stated as a set rather than per-rail so that FLIPPING one is a visible diff in this list, reviewed
    // against §8.3's actual question — can an auditor reconstruct the atrHash from the settlement
    // reference alone, WITHOUT trusting either party to produce records?
    //
    // The three that answer no, and each for a DIFFERENT reason — which is why this is a reviewed list
    // rather than a rule:
    //   evm:mpp — id-reuse. The on-chain value is `keccak(challenge.id ‖ challenge.realm)`, and a hash has
    //     no inverse: a candidate atrHash can be VERIFIED against it, never recovered from it.
    //   stellar — truncation. Only atrHash[:8] rides in the CAP-67 mux id, so the settlement confirms a
    //     prefix match but cannot yield the full hash; the rest comes from an off-chain extension.
    //   canton, canton:x402 — visibility, and the SAME reason for both, which is why the carrier move
    //     did not change it. A privacy ledger: an LcpAnchor contract is visible only to its stakeholders
    //     (buyer, seller), and a transfer and its metadata only to the transaction's. Either way the
    //     reader needs a JWT authenticating one of them. No private key is needed, but a party's
    //     cooperation is, and §8.3 asks the second question. The x402 rail is stronger on every OTHER
    //     axis and identical on this one, because here the ledger's privacy model governs, not the
    //     carrier.
    //
    // Three distinct failure modes for one declaration is the reason the axis needs machinery: each is
    // arguable on its own and none generalises to the others.
    const no = RAILS.filter(([, m]) => !m.recovery.zeroPartyRecoverable).map(
      ([n]) => n,
    );
    expect(no.sort()).toEqual(["canton", "canton:x402", "evm:mpp", "stellar"]);
  });
});
