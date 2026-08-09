import { readFileSync } from "node:fs";
import type { Outcome } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import {
  bindAtrHash,
  checkCandidate,
  deriveChallengeHash,
  notRecoverableByConstruction,
} from "../src/id-reuse.js";

/**
 * The pinned oracles for MPP's own derivation rule, read from the vector tree rather than restated here.
 * Every `nonce` in that file was produced by two independent keccak-256 oracles (pycryptodome and Foundry
 * `cast keccak`) that agree byte-for-byte — neither of them viem, the implementation under test.
 */
type DeriveCase = {
  name: string;
  input: { op: "derive"; challengeId: string; realm: string };
  expected: string;
};
type BindCase = {
  name: string;
  input: { op: "bind"; atrHash: string; realm: string };
  expected: { challengeId: string; realm: string; nonce: string };
};
type CheckCase = {
  name: string;
  input: {
    op: "check";
    atrHash: string;
    realm: string;
    observedNonces: string[];
  };
  expected: unknown;
};
type RecoverCase = {
  name: string;
  input: { op: "recover" };
  expected: unknown;
};
type VectorCase = DeriveCase | BindCase | CheckCase | RecoverCase;

const { cases } = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/mpp-evm-id-reuse.json", import.meta.url),
    "utf8",
  ),
) as { cases: VectorCase[] };

/**
 * Drop a refusal's `detail` before comparing. `detail` is human-facing prose; pinning it would make every
 * wording change a vector amendment. `refused`/`haltClass`/`code` are the contract — the same normalization
 * the conformance subject applies, for the same reason. `refused` is READ from the outcome rather than
 * written as `true`: hardcoding it would hide a refusal that forgot to declare itself one.
 */
function normalize(outcome: Outcome<unknown>): unknown {
  return "refused" in outcome
    ? {
        refused: outcome.refused,
        haltClass: outcome.haltClass,
        code: outcome.code,
      }
    : outcome;
}

describe("MPP-EVM id-reuse — the pinned host derivation", () => {
  for (const c of cases) {
    it(c.name, () => {
      switch (c.input.op) {
        case "derive":
          expect(deriveChallengeHash(c.input.challengeId, c.input.realm)).toBe(
            c.expected,
          );
          break;
        case "bind":
          expect(bindAtrHash(c.input.atrHash, c.input.realm)).toEqual(
            c.expected,
          );
          break;
        case "check":
          expect(
            normalize(
              checkCandidate(
                c.input.atrHash,
                c.input.realm,
                c.input.observedNonces,
              ),
            ),
          ).toEqual(c.expected);
          break;
        case "recover":
          expect(normalize(notRecoverableByConstruction())).toEqual(c.expected);
          break;
      }
    });
  }

  it("covers all four ops — a vector file that lost an op would still read green case-by-case", () => {
    expect(new Set(cases.map((c) => c.input.op))).toEqual(
      new Set(["derive", "bind", "check", "recover"]),
    );
  });
});

describe("the derivation inputs MPP itself makes mandatory", () => {
  const ATR = `0x${"ab".repeat(32)}`;

  it("refuses to derive over an empty realm — the core scheme makes realm a MUST on every challenge", () => {
    expect(() => deriveChallengeHash(ATR, "")).toThrow(/realm/);
    expect(() => bindAtrHash(ATR, "")).toThrow(/realm/);
  });

  it("refuses to derive over an empty challenge id — there is nothing to bind", () => {
    expect(() => deriveChallengeHash("", "api.example.com")).toThrow(
      /challenge id/,
    );
  });

  it("throws on a malformed atrHash at PROPOSAL time — a seller welding a bad hash is a wiring defect, not a verification outcome", () => {
    expect(() => bindAtrHash("0xnope", "api.example.com")).toThrow();
  });

  it("says the atrHash rides challenge.id, NOT the nonce — the seller must not read the x402 rule here", () => {
    // On this rail the nonce is DERIVED and is not ours to occupy. A guard message telling an MPP-EVM seller
    // the hash must be 32 bytes "to ride as the EIP-3009 nonce" hands them the exact misreading that
    // binding-evm-x402's KNOWN-BAD note exists to stop.
    let message = "";
    try {
      bindAtrHash("0xnope", "api.example.com");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/challenge\.id/);
    expect(message).not.toMatch(/ride as the EIP-3009 nonce/);
  });

  it("checkCandidate throws on an empty realm — the realm is the auditor's configuration, not data under audit", () => {
    expect(() => checkCandidate(ATR, "", [`0x${"11".repeat(32)}`])).toThrow(
      /realm/,
    );
  });
});

describe("the fixed-length argument that makes packed concatenation unambiguous", () => {
  it("a 32-byte challenge id cannot be re-split — every ambiguous pair needs a shorter id", () => {
    // abi.encodePacked has no delimiter, so ('ab','c') and ('a','bc') collide (pinned in the vectors as a
    // property of the HOST rule). Id-Reuse is immune because `challenge.id` is exactly 66 characters: any
    // other split of the same byte string yields an id of a different length, which bindAtrHash rejects
    // before it can derive. This test pins the enforcement, which is the whole security argument.
    const canonical = `0x${"ab".repeat(32)}`;
    expect(canonical).toHaveLength(66);
    expect(() => bindAtrHash(`${canonical}00`, "api.example.com")).toThrow();
    expect(() =>
      bindAtrHash(canonical.slice(0, 64), "api.example.com"),
    ).toThrow();
  });

  it("the 0x prefix is IN the preimage — a bare-hex id derives a different nonce", () => {
    const withPrefix = deriveChallengeHash(
      `0x${"ab".repeat(32)}`,
      "api.example.com",
    );
    const bare = deriveChallengeHash("ab".repeat(32), "api.example.com");
    expect(bare).not.toBe(withPrefix);
  });
});

describe("every refusal detail names the value it is about", () => {
  // `detail` is deliberately NOT pinned by the vectors — it is human-facing prose and pinning the wording
  // would make every rewording a vector amendment. But a detail that does not carry the offending value is
  // prose with no diagnostic content, and an auditor reading it learns nothing they did not already know.
  // The wording stays free; echoing the input does not.
  const REALM = "api.example.com";
  const GOOD = `0x${"11".repeat(32)}`;
  const CANDIDATE = `0x${"ab".repeat(32)}`;

  function detailOf(o: Outcome<unknown>): string {
    if (!("refused" in o)) throw new Error("expected a refusal");
    return o.detail ?? "";
  }

  it("candidate-malformed quotes the candidate", () => {
    expect(detailOf(checkCandidate("0xnope", REALM, [GOOD]))).toContain(
      "0xnope",
    );
  });

  it("nonce-malformed quotes the offending nonce, not the candidate", () => {
    const detail = detailOf(
      checkCandidate(CANDIDATE, REALM, [GOOD, "0xbadnonce"]),
    );
    expect(detail).toContain("0xbadnonce");
  });

  it("no-settlement-event says there is nothing to verify against", () => {
    expect(detailOf(checkCandidate(CANDIDATE, REALM, []))).toContain(
      "nothing to verify",
    );
  });

  it("candidate-mismatch shows the derivation that did not match", () => {
    // The auditor's next move is to re-derive by hand, so the detail has to carry both preimage halves
    // and the resulting nonce — otherwise they cannot tell a wrong candidate from a wrong realm.
    const detail = detailOf(checkCandidate(CANDIDATE, REALM, [GOOD]));
    expect(detail).toContain(CANDIDATE);
    expect(detail).toContain(REALM);
  });

  it("not-recoverable-by-construction points at the surface that DOES work", () => {
    // A refusal that only says "no" leaves the caller with nowhere to go; this one is permanent, so it
    // must name `verifyCandidate` or the reader will keep looking for the recover path.
    expect(detailOf(notRecoverableByConstruction())).toContain(
      "verifyCandidate",
    );
  });
});
