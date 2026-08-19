import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTH_CAPTURE_ESCROW,
  assertSignatureGrade,
  COLLECTORS,
  getCollector,
} from "../src/collectors.js";
import { EVENT_TO_STATE, stateFor } from "../src/lifecycle.js";
import { ESCROW_MANIFEST } from "../src/manifest.js";

const PROFILE = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/escrow-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("ESCROW_MANIFEST ↔ published escrow profile", () => {
  it("the profile equals the manifest plus its named-profile id", () => {
    const { profile, ...manifest } = PROFILE;
    expect(manifest).toEqual(ESCROW_MANIFEST);
    expect(profile).toBe("integra-escrow-salt-v1");
  });
  it("declares native-field on PaymentInfo.salt with an event-data-scan recovery", () => {
    expect(ESCROW_MANIFEST.pattern).toBe("native-field");
    expect(ESCROW_MANIFEST.nativeField).toBe("PaymentInfo.salt");
    // Bound by CARRIAGE, not by filter — PaymentInfo.token is in the record itself.
    expect(ESCROW_MANIFEST.assetBinding).toBe("carried");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail cannot produce a failed transaction that still carries a weld.
    expect(ESCROW_MANIFEST.successGate).toBe("structural");
    expect(ESCROW_MANIFEST.indexing).toBe("event-data-scan:paymentInfoHash");
    // forwardIndexable is FALSE and the reason is the criterion, not the mechanism: enumeration must be
    // bound to a GIVEN atrHash. paymentInfoHash is the only indexed topic and is not derivable from an
    // atrHash alone, so `enumerate` scans a range and filters client-side on the decoded salt.
    expect(ESCROW_MANIFEST.recovery).toEqual({
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
    });
  });

  it("carries NO offCanonical profile — neither §8.3.1 disjunct is met", () => {
    // §8.3.1 admits the marker only where the field is "specified as client-chosen or as a deterministic
    // derivation that excludes atrHash". `salt` is neither: charge/authorize are
    // onlySender(paymentInfo.operator), so the service constructs the struct and no cooperating client is
    // required, and the welded value IS uint256(atrHash). The x402 sibling declares it over the
    // payer-chosen EIP-3009 nonce; declaring it here would publish a caveat this rail does not carry.
    expect(ESCROW_MANIFEST.offCanonical).toBeUndefined();
  });
});

describe("lifecycle", () => {
  // All six, not a sample: `observe` labels every transition through this map, so a wrong entry
  // mislabels a real settlement's state — the one thing a lifecycle readout is for.
  it.each([
    ["PaymentAuthorized", "authorized"],
    ["PaymentCaptured", "captured"],
    ["PaymentCharged", "charged"],
    ["PaymentVoided", "voided"],
    ["PaymentReclaimed", "reclaimed"],
    ["PaymentRefunded", "refunded"],
  ] as const)(
    "EVENT_TO_STATE maps %s to its lifecycle state",
    (event, state) => {
      expect(EVENT_TO_STATE[event]).toBe(state);
    },
  );

  it.each([
    ["PaymentAuthorized", { s: "authorized", amount: 500n }],
    ["PaymentCaptured", { s: "captured", amount: 500n }],
    ["PaymentCharged", { s: "charged", amount: 500n }],
    ["PaymentVoided", { s: "voided" }],
    ["PaymentReclaimed", { s: "reclaimed" }],
    ["PaymentRefunded", { s: "refunded", amount: 500n }],
  ] as const)(
    "stateFor(%s) carries an amount only where one is meaningful",
    (event, expected) => {
      expect(stateFor(event, 500n)).toEqual(expected);
    },
  );
});

describe("collectors", () => {
  // The deterministic base/commerce-payments deployments, identical on Base Mainnet and Base Sepolia.
  // These addresses are where the escrow pulls funds THROUGH — a wrong one is a payment sent nowhere
  // recoverable, so the registry is pinned entry-by-entry rather than spot-checked.
  const EXPECTED = {
    ERC3009: {
      address: "0x0E3dF9510de65469C4518D7843919c0b8C7A7757",
      grade: "signature",
      proven: true,
    },
    Permit2: {
      address: "0x992476B9Ee81d52a5BdA0622C333938D0Af0aB26",
      grade: "signature",
      proven: false,
    },
    SpendPermission: {
      address: "0x8d9F34934dc9619e5DC3Df27D0A40b4A744E7eAa",
      grade: "signature",
      proven: false,
    },
    PreApproval: {
      address: "0x1b77ABd71FCD21fbe2398AE821Aa27D1E6B94bC6",
      grade: "tx",
      proven: false,
    },
  } as const;

  it.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])(
    "%s: address, grade and proven-ness are pinned, and the entry names itself",
    (name) => {
      const c = getCollector(name);
      expect(c).toEqual({ name, ...EXPECTED[name] });
      // The registry is keyed by name; an entry whose `name` disagrees with its key would put the
      // wrong collector in every refusal message the policy emits.
      expect(COLLECTORS[name].name).toBe(name);
    },
  );

  it("ERC3009 alone is on-chain-proven, so it alone passes the policy", () => {
    expect(assertSignatureGrade("ERC3009")).toBeNull();
  });

  it("refuses PreApproval (tx-grade) — no silent tx fallback", () => {
    expect(assertSignatureGrade("PreApproval")).toMatchObject({
      refused: true,
      haltClass: "policy-rejection",
      code: "escrow/tx-grade-collector",
    });
  });

  it.each(["Permit2", "SpendPermission"] as const)(
    "refuses %s — signature-grade but not yet on-chain-proven",
    (name) => {
      expect(assertSignatureGrade(name)).toMatchObject({
        refused: true,
        haltClass: "policy-rejection",
        code: "escrow/unproven-collector",
      });
    },
  );

  it("pins the canonical escrow address", () => {
    expect(AUTH_CAPTURE_ESCROW).toBe(
      "0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff",
    );
  });
});
