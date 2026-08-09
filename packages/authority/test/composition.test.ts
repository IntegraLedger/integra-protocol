import { describe, expect, it } from "vitest";
import { readAttestationProfile } from "../src/attestation-profile.js";
import {
  type IdentityResolution,
  isConsequentialConformant,
  terminatesInAccountableParty,
} from "../src/composition.js";

const bareKey: IdentityResolution = {
  subject: "0x00000000000000000000000000000000000000a1",
  assurance: "wallet-signature-only",
  chain: [{ via: "key" }],
};
const attested: IdentityResolution = {
  subject: "0x00000000000000000000000000000000000000a2",
  assurance: "attested",
  chain: [{ via: "key" }, { via: "attestation", ref: "lcp:sha256:0xabc" }],
};
const legalParty: IdentityResolution = {
  subject: "0x00000000000000000000000000000000000000a3",
  assurance: "legal-party",
  chain: [
    { via: "key" },
    { via: "domain-control" },
    { via: "legal-party", ref: "did:web:acme.example" },
  ],
};

describe("composition — IDN-2 resolution chain", () => {
  it("a bare key terminates in nothing accountable", () => {
    expect(terminatesInAccountableParty(bareKey)).toBe(false);
    expect(isConsequentialConformant(bareKey)).toBe(false);
  });
  it("an attested identity terminates in an accountable party", () => {
    expect(terminatesInAccountableParty(attested)).toBe(true);
    expect(isConsequentialConformant(attested)).toBe(true);
  });
  it("a legal-party terminus is consequential-conformant", () => {
    expect(isConsequentialConformant(legalParty)).toBe(true);
  });

  it("an EMPTY chain resolves to nothing accountable", () => {
    // Not the same case as a bare key: there is no terminal step at all, and reading past the end of the
    // array would otherwise hand `undefined.via` to the comparison.
    expect(
      terminatesInAccountableParty({
        subject: "0x00000000000000000000000000000000000000a4",
        assurance: "attested",
        chain: [],
      }),
    ).toBe(false);
  });

  it("a grant terminus is accountable — the third accepted via, and the only one untested", () => {
    expect(
      terminatesInAccountableParty({
        subject: "0x00000000000000000000000000000000000000a5",
        assurance: "attested",
        chain: [{ via: "key" }, { via: "grant", ref: "lcp:sha256:0xdef" }],
      }),
    ).toBe(true);
  });

  it("a domain-control TERMINUS is NOT accountable — it appears mid-chain above, never as the end", () => {
    // Controlling an origin proves who publishes a document, not who is answerable for it. The
    // legalParty fixture passes domain-control THROUGH on its way to a named entity; ending there does
    // not reach one.
    expect(
      terminatesInAccountableParty({
        subject: "0x00000000000000000000000000000000000000a6",
        assurance: "domain-controlled",
        chain: [{ via: "key" }, { via: "domain-control" }],
      }),
    ).toBe(false);
  });
});

/**
 * IDN-2 (the chain reaches an accountable party) and IDN-3 (the assurance is STATED, honestly) are two
 * independent claims, and `isConsequentialConformant` requires BOTH. Every fixture above agreed on the
 * two, so nothing distinguished the conjunction from either half — a disjunction would have passed the
 * whole suite while letting a bare-wallet identity sign a consequential transaction.
 */
describe("isConsequentialConformant needs the assurance AND the chain", () => {
  it("refuses a stated wallet-signature-only assurance even when the chain reaches a legal party", () => {
    expect(
      isConsequentialConformant({
        subject: "0x00000000000000000000000000000000000000a7",
        assurance: "wallet-signature-only",
        chain: [{ via: "key" }, { via: "legal-party", ref: "did:web:acme" }],
      }),
    ).toBe(false);
  });

  it("refuses a higher stated assurance whose chain terminates in nothing accountable", () => {
    expect(
      isConsequentialConformant({
        subject: "0x00000000000000000000000000000000000000a8",
        assurance: "legal-party",
        chain: [{ via: "key" }],
      }),
    ).toBe(false);
  });

  it("refuses when the assurance is raised but the chain only reaches domain control", () => {
    expect(
      isConsequentialConformant({
        subject: "0x00000000000000000000000000000000000000a9",
        assurance: "attested",
        chain: [{ via: "key" }, { via: "domain-control" }],
      }),
    ).toBe(false);
  });
});

describe("attestation-profile — generic interpretation (substrate-open)", () => {
  it("reads the envelope without touching substrate cryptography", () => {
    const read = readAttestationProfile({
      profile: { profile: "eas:v1", substrate: "eas" },
      subject: "0x00000000000000000000000000000000000000a2",
      assurance: "kyc-verified",
      ref: "lcp:sha256:0xabc",
    });
    expect(read).toEqual({
      substrate: "eas",
      subject: "0x00000000000000000000000000000000000000a2",
      assurance: "kyc-verified",
    });
  });
});
