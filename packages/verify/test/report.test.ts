import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  jcsCanonicalize,
  serializeReport,
  type VerificationReport,
} from "../src/report.js";

const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/report/serialization.json", import.meta.url),
    "utf8",
  ),
) as { cases: { name: string; input: unknown; expected: string }[] };

describe("RFC 8785 (JCS) report serialization — the net-new byte vector", () => {
  it.each(V.cases)("$name", ({ input, expected }) => {
    expect(jcsCanonicalize(input)).toBe(expected);
  });

  it("serializeReport emits the UTF-8 bytes of the JCS form", () => {
    const report: VerificationReport = {
      verified: false,
      assurance: "wallet-signature-only",
      claimedClass: "TC-2",
      supportedClass: "TC-2",
      asOf: "2026-07-16T00:00:00Z",
      steps: [{ name: "atr-fingerprint", outcome: { status: "proved" } }],
      coverage: { ports: [], bindings: [] },
      settlements: { found: [], multiplySettled: false },
    };
    const bytes = serializeReport(report);
    expect(new TextDecoder().decode(bytes)).toBe(jcsCanonicalize(report));
    // keys are sorted: asOf < assurance < coverage < settlements < steps < supportedClass < verified
    expect(new TextDecoder().decode(bytes).startsWith('{"asOf":')).toBe(true);
  });
});
