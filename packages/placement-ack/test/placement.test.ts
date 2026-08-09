import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ackPlacement } from "../src/index.js";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/ack.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    input: {
      op: "place" | "place-purity" | "extract";
      ref?: { type: string; value: string };
      doc: unknown;
    };
    expected?: unknown;
  }[];
};

const H = "0xb055edca81f6fe156fb63791e2883434236bcc605e694800d442b4d5db929294";

describe("ACK placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        ackPlacement.place(ref, doc);
        expect(JSON.stringify(doc)).toBe(before);
        return;
      }

      // The vector pins the whole `Outcome` on BOTH arms and for BOTH members — the same shape the
      // conformance area certifies, so the unit test and the corpus cannot disagree about what this package
      // returns. Refusals are matched STRUCTURALLY (refused/haltClass/code) because `detail` is human-facing
      // prose the vector deliberately omits; successes are matched EXACTLY, because the credential a
      // placement emits IS the wire contract and an extra or missing key there must fail.
      const out =
        op === "extract"
          ? ackPlacement.extract(doc)
          : ackPlacement.place(ref, doc);
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

// Same convention as placement-acp and placement-ucp: the corpus omits `detail` because the CODE is the
// cross-implementation contract, but that is no licence for this package's own messages to be useless. The
// ordering rule is the one piece of logic this package adds, and its refusal is the one a caller cannot fix by
// correcting an argument — "receipt-already-issued" with no remedy in it leaves an operator guessing whether
// the receipt or the reference is wrong, when the answer is neither: it is the ORDER.
describe("ACK placement — the ordering refusal names the remedy", () => {
  it("tells the caller to place before the issuer signs", () => {
    const out = ackPlacement.place(
      { type: "sha256", value: H },
      { proof: { type: "JwtProof2020", jwt: "eyJ0eXAiOiJKV1QifQ.e30.sig" } },
    );
    expect(out).toMatchObject({ code: "ack/receipt-already-issued" });
    expect((out as { detail: string }).detail).toContain(
      "before the issuer signs",
    );
  });
});

// The guard that proves we are a GUEST in ACK's map rather than its owner. The corpus pins it too, and it is
// repeated here because it is the one property a hand-rolled two-level write gets wrong silently: spreading
// the wrong level drops a whole set of sibling keys and every other test still passes.
describe("ACK placement — the receipt's own refs survive", () => {
  it("preserves ACK's own refs at the metadata level", () => {
    const doc = {
      credentialSubject: {
        metadata: {
          settlementReference: "0xtx",
          policyRef: "p-1",
          mandateRef: "m-1",
          executionRef: "e-1",
        },
      },
    };
    const placed = ackPlacement.place({ type: "sha256", value: H }, doc);
    if (!("ok" in placed)) throw new Error("place refused");
    const md = (
      placed.value as {
        credentialSubject: { metadata: Record<string, unknown> };
      }
    ).credentialSubject.metadata;
    expect(md["settlementReference"]).toBe("0xtx");
    expect(md["policyRef"]).toBe("p-1");
    expect(md["mandateRef"]).toBe("m-1");
    expect(md["executionRef"]).toBe("e-1");
    expect(md["legalContext"]).toEqual({ type: "sha256", value: H });
  });

  it("preserves the ATTESTATION's own claims at the credentialSubject level", () => {
    // The level above. `paymentRequestToken` and `paymentOptionId` are the receipt's only normative claims;
    // losing either would void the credential while leaving our reference intact — the worst possible
    // outcome and the one this asserts cannot happen.
    const placed = ackPlacement.place(
      { type: "sha256", value: H },
      {
        credentialSubject: {
          id: "did:web:buyer.example",
          paymentRequestToken: "eyJhbGciOiJFUzI1NksifQ.e30.sig",
          paymentOptionId: "opt-usdc-base",
        },
      },
    );
    if (!("ok" in placed)) throw new Error("place refused");
    const cs = (placed.value as { credentialSubject: Record<string, unknown> })
      .credentialSubject;
    expect(cs["id"]).toBe("did:web:buyer.example");
    expect(cs["paymentRequestToken"]).toBe("eyJhbGciOiJFUzI1NksifQ.e30.sig");
    expect(cs["paymentOptionId"]).toBe("opt-usdc-base");
    expect(cs["metadata"]).toEqual({
      legalContext: { type: "sha256", value: H },
    });
  });
});
