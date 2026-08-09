import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeVerified,
  type StepName,
  type TransactionClass,
  type VerifyDepth,
} from "../src/required.js";

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../vectors/verify/mechanical.json", import.meta.url),
    ),
    "utf-8",
  ),
) as {
  cases: {
    name: string;
    input: {
      depth: VerifyDepth;
      claimedClass: TransactionClass;
      steps: { name: StepName; status: string }[];
    };
    expected: boolean;
  }[];
};

describe("computeVerified — honest verified over the class→required-steps map", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const steps = c.input.steps.map((s) => ({
        name: s.name,
        outcome: { status: s.status },
      }));
      expect(computeVerified(steps, c.input.claimedClass, c.input.depth)).toBe(
        c.expected,
      );
    });
  }
});
