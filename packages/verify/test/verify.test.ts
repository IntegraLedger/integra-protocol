import { readFileSync } from "node:fs";
import { hashAtr } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import { type RecordIdentity, type VerifyInput, verify } from "../src/index.js";

type Case = {
  name: string;
  input: Omit<VerifyInput, "atrBytes" | "acceptanceVerifier"> & {
    atrBytes?: { encoding: string; data: string };
    acceptanceVerifier?: "accepts" | "rejects";
  };
  expected: {
    verified: boolean;
    claimedClass: string;
    supportedClass: string;
    assurance: string;
    multiplySettled: boolean;
    statuses: Record<string, string>;
  };
};
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/report/cases.json", import.meta.url),
    "utf8",
  ),
) as { cases: Case[] };

/** The two deterministic signature-verifier ports the fixtures name. A port implementation, not a mock of
 *  one: `verify` is pure over this port by design, and the cryptography itself is proven in
 *  binding-evm-common (EOA offline + smart-account on-chain). */
const VERIFIERS = {
  accepts: { verify: (): Promise<boolean> => Promise.resolve(true) },
  rejects: { verify: (): Promise<boolean> => Promise.resolve(false) },
};

function toInput(c: Case): VerifyInput {
  const { atrBytes, acceptanceVerifier, ...rest } = c.input;
  return {
    ...rest,
    ...(atrBytes !== undefined
      ? { atrBytes: new TextEncoder().encode(atrBytes.data) }
      : {}),
    ...(acceptanceVerifier !== undefined
      ? { acceptanceVerifier: VERIFIERS[acceptanceVerifier] }
      : {}),
  };
}

describe("verify — structural walk (honest class readout)", () => {
  it.each(V.cases)("$name", async (c) => {
    const report = await verify(toInput(c));
    expect(report.verified).toBe(c.expected.verified);
    expect(report.claimedClass).toBe(c.expected.claimedClass);
    expect(report.supportedClass).toBe(c.expected.supportedClass);
    expect(report.assurance).toBe(c.expected.assurance);
    expect(report.settlements.multiplySettled).toBe(c.expected.multiplySettled);
    const statuses = Object.fromEntries(
      report.steps.map((s) => [s.name, s.outcome.status]),
    );
    expect(statuses).toEqual(c.expected.statuses);
  });

  it("a contradicted rung impeaches to TC-0 whatever the caller claimed", async () => {
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      claimedClass: "TC-3",
      authorityChain: [
        {
          bounds: { caps: { USD: "999" } },
          parentBounds: { caps: { USD: "1" } },
          parentDelegable: true, // the parent DID permit delegation — the bounds are what is forged
          revoked: false, // stated, never defaulted: the type requires it, and that IS the gate
          active: true,
        },
      ],
    });
    expect(report.supportedClass).toBe("TC-0");
    expect(report.claimedClass).toBe("TC-3");
  });

  it("a claim cannot lift the class — a record that proves nothing supports TC-0", async () => {
    // The defect this pins: `supportedClass` once echoed `claimedClass` unless a step FAILED, so this
    // walk — no settlement, no identity, no acceptance, nothing proved — reported TC-1 on the caller's
    // say-so. The claim is reported, and it is reported as the claim.
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      claimedClass: "TC-1",
    });
    expect(report.supportedClass).toBe("TC-0");
    expect(report.claimedClass).toBe("TC-1");
    expect(report.steps.some((s) => s.outcome.status === "proved")).toBe(false);
  });

  it("a claim cannot cap the class either — proved rungs reach past what was claimed", async () => {
    // The mirror of the case above, and the reason the claim is not a ceiling: White paper #4 §5 defines
    // the class as "the highest class whose criteria it fully meets", which a caller aiming low cannot lower.
    const atrBytes = new TextEncoder().encode('{"lcp":"0.3","terms":"x"}');
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: ["evm"], bindings: ["evm:x402"] },
      claimedClass: "TC-1",
      atrBytes,
      settledAtrHash: await hashAtr(atrBytes),
      settlements: [{ chainId: 84532, txHash: "0x1" }],
      identity: {
        seller: {
          subject: "did:web:seller.example",
          assurance: "legal-party",
          chain: [{ via: "legal-party" }],
        },
        buyer: {
          subject: "0xb15d",
          assurance: "wallet-signature-only",
          chain: [{ via: "key" }],
        },
      },
    });
    expect(report.claimedClass).toBe("TC-1");
    expect(report.supportedClass).toBe("TC-2");
  });

  it("a HALF-SHAPED identity reads out, it does not crash the walk", async () => {
    // The untyped-caller case `resolvePartyStep` is already total over (a foreign conformance subject, an
    // unvalidated intake). `verify()`'s own assurance readout must be total over exactly the same input —
    // a TypeError here means the walk cannot report on the record it was handed, which is the one job it has.
    const halfShaped = {
      seller: {
        subject: "s",
        assurance: "attested",
        chain: [{ via: "grant" }],
      },
    };
    const report = await verify({
      asOf: "2026-07-16T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      identity: halfShaped as unknown as RecordIdentity,
    });
    const statuses = Object.fromEntries(
      report.steps.map((s) => [s.name, s.outcome.status]),
    );
    expect(statuses["resolve-party"]).toBe("not-attempted");
    expect(report.verified).toBe(false);
  });

  it("mechanical depth raises verified when the required steps are proved", async () => {
    const atrBytes = new TextEncoder().encode(
      '# T\nlcp: "0.3"\nterms: t\nid: x\n',
    );
    const settled = await hashAtr(atrBytes); // the fingerprint proves
    const report = await verify({
      asOf: "2025-10-09T00:00:00Z",
      depth: "mechanical",
      coverage: { ports: ["chain"], bindings: ["evm:x402"] },
      atrBytes,
      settledAtrHash: settled,
      // TC-2 is TC-1 + the weld: the attribution rungs (PAY + IDN) come with it.
      settlements: [{ chainId: 84532, txHash: "0xabc" }],
      identity: {
        seller: {
          subject: "did:web:seller.example",
          assurance: "legal-party",
          chain: [{ via: "legal-party" }],
        },
        buyer: {
          subject: "0xb15d",
          assurance: "wallet-signature-only",
          chain: [{ via: "key" }],
        },
      },
      claimedClass: "TC-2",
    });
    expect(report.verified).toBe(true);
  });
  it("structural depth keeps verified false even with a proved fingerprint", async () => {
    const atrBytes = new TextEncoder().encode("x");
    const settled = await hashAtr(atrBytes);
    const report = await verify({
      asOf: "2025-10-09T00:00:00Z",
      coverage: { ports: [], bindings: [] },
      atrBytes,
      settledAtrHash: settled,
      claimedClass: "TC-2",
    });
    expect(report.verified).toBe(false);
  });
});

type CompCase = {
  name: string;
  input: Omit<
    VerifyInput,
    "atrBytes" | "settledAtrHash" | "acceptanceVerifier"
  > & {
    atrBytes_utf8?: string;
    acceptanceVerifier?: "accepts" | "rejects";
  };
  verified: boolean;
  claimedClass: string;
  supportedClass: string;
  stepCount?: number;
};
const C = JSON.parse(
  readFileSync(
    new URL("../../../vectors/verify/composition.json", import.meta.url),
    "utf8",
  ),
) as { cases: CompCase[] };

describe("verify — TC-4 composition readout (wired walk)", () => {
  it.each(C.cases)("$name", async (c) => {
    const { atrBytes_utf8, acceptanceVerifier, ...rest } = c.input;
    // The fingerprint proves BY CONSTRUCTION here (the settled hash is the hash of the case's own ATR
    // bytes) so each case isolates the composition logic rather than re-testing the weld.
    const atrBytes = new TextEncoder().encode(atrBytes_utf8 ?? "");
    const input: VerifyInput = {
      ...rest,
      atrBytes,
      settledAtrHash: await hashAtr(atrBytes),
      ...(acceptanceVerifier !== undefined
        ? { acceptanceVerifier: VERIFIERS[acceptanceVerifier] }
        : {}),
    };
    const report = await verify(input);
    expect(report.verified).toBe(c.verified);
    expect(report.claimedClass).toBe(c.claimedClass);
    expect(report.supportedClass).toBe(c.supportedClass);
    if (c.stepCount !== undefined) {
      expect(report.steps.length).toBe(c.stepCount);
    }
  });
});
