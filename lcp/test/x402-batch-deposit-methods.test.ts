// The x402/batch-settlement/eip155 form under each deposit method, in each of the scheme's two modes. The read kit's one
// form of the pairing alternates ERC-3009 and Permit2 deposits by case (read-kit/forms/eip155-x402.ts); here every case
// of read-status.json runs on both acts under each method and mode, skipped only as the form declares, and none fails.
import { describe, expect, it } from "vitest";
import { batchByMethod } from "./read-kit/forms/eip155-x402.js";
import { ACTS, READ_STATUS, runCase } from "./read-kit/harness.js";

describe("x402/batch-settlement/eip155 under each deposit method", () => {
  for (const { method, mode, declared } of batchByMethod) {
    it(`${method}, ${mode} mode: every case runs or is skipped as the form declares, and none fails`, async () => {
      let ran = 0;
      for (const c of READ_STATUS.cases) {
        for (const act of ACTS) {
          const outcome = await runCase(declared, c, act);
          expect(outcome, `${c.case} (act ${act})`).not.toBe("ran-stated");
          if (outcome === "ran") ran++;
        }
      }
      expect(ran).toBeGreaterThan(0);
    });
  }
});
