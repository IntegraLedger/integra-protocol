import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RCS4_REQUIRED_ROLES,
  recourseStep,
  resolvePartyStep,
} from "../src/steps.js";

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../vectors/verify/recourse.json", import.meta.url),
    ),
    "utf-8",
  ),
) as {
  cases: {
    name: string;
    input: {
      atr?: { encoding: string; data: string };
      evidenceRoles?: string[];
    };
    expected: { status: string; depth?: string };
  }[];
};

/** The corpus byte-input convention (`{encoding,data}`) — utf8 only in this area's cases. */
function decode(
  atr: { encoding: string; data: string } | undefined,
): Uint8Array | undefined {
  if (atr === undefined) return undefined;
  if (atr.encoding !== "utf8")
    throw new Error(`recourse vectors carry utf8 only, got ${atr.encoding}`);
  return new TextEncoder().encode(atr.data);
}

describe("recourseStep — RCS-1/2/4 read from the hashed record", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      expect(recourseStep(decode(c.input.atr), c.input.evidenceRoles)).toEqual(
        c.expected,
      );
    });
  }

  it("never returns failed — a missing election is a gap, not a contradiction", () => {
    for (const c of vectors.cases)
      expect(
        recourseStep(decode(c.input.atr), c.input.evidenceRoles).status,
      ).not.toBe("failed");
  });

  it("pins RCS-4's required roles to the specification's enumeration", () => {
    // The conditional clause (fulfillment/order-state, "where performance is disputed") is deliberately out.
    expect([...RCS4_REQUIRED_ROLES].sort()).toEqual([
      "atr",
      "attestation",
      "authority chain",
      "settlement",
      "signed acceptance",
      "spend artifact",
      "timestamp",
      "weld",
    ]);
    expect(RCS4_REQUIRED_ROLES).not.toContain("fulfillment");
    expect(RCS4_REQUIRED_ROLES).not.toContain("order-state");
  });
});

describe("resolvePartyStep — total over its input (no crash on a half-shaped identity)", () => {
  it("reports an absent party as unresolved rather than throwing", () => {
    // A foreign conformance subject (or any untyped caller) can hand over a partial identity. The step
    // must read out honestly; a TypeError from a verification library is never the right answer.
    const half = {
      buyer: {
        subject: "0xb15d",
        assurance: "attested",
        chain: [{ via: "key" }],
      },
    };
    expect(
      resolvePartyStep(
        half as unknown as Parameters<typeof resolvePartyStep>[0],
      ),
    ).toEqual({ status: "not-attempted", depth: "no-resolution" });
  });

  it("reports an empty resolution chain as unresolved", () => {
    const party = { subject: "x", assurance: "attested" as const, chain: [] };
    expect(resolvePartyStep({ seller: party, buyer: party })).toEqual({
      status: "not-attempted",
      depth: "no-resolution-chain",
    });
  });
});
