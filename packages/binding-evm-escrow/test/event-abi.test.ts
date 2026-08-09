import { type Abi, type AbiEvent, type Hex, toEventSelector } from "viem";
import { describe, expect, it } from "vitest";

/**
 * The escrow event ABI, pinned against the DEPLOYED contract (base/commerce-payments @ 98b592b).
 *
 * This lives in its own file, and imports `adapter.ts` DYNAMICALLY inside the test, for a reason worth
 * keeping: `ESCROW_EVENTS_ABI` is built by `parseAbi` at module scope, so a malformed signature throws
 * on IMPORT. A static import would fail the whole test file before any test ran — loud enough for
 * `pnpm verify`, but it means this guard never actually executes on the input it exists to guard, and
 * the failure says "could not import" instead of naming the event that drifted.
 */
describe("event selectors match the DEPLOYED contract (base/commerce-payments @ 98b592b)", () => {
  // topic0 = keccak256(canonical signature) — hardcoded from the pinned/deployed source, NOT derived
  // from ESCROW_EVENTS_ABI, so a wrong param type (e.g. uint256 vs the real uint16 feeBps) is caught.
  const EXPECTED: Record<string, Hex> = {
    PaymentAuthorized:
      "0x1c81fb2e3bab27f6bb09bee9a0dddf61600b7cbaf2c12683e4864e0cbdb9d284",
    PaymentCharged:
      "0x943ae4341dd799d7aeedc501f616cd26b134639e0bc2ec059581ba3ebbf1e7d0",
    PaymentCaptured:
      "0xe749f7bbd01b49bb05abf26ca492cb4dfdea6bedeada8a40fdccd478c73a74e2",
    PaymentVoided:
      "0xcadce8c3acb008e3e1c64ca7f60d22a3c87069183182b7dbb9e4d8cfb3a15842",
    PaymentReclaimed:
      "0x78e1d723d17e13b7f40eeab9bf6dd9148a630bafde4203ab7bb5fca983516d17",
    PaymentRefunded:
      "0x1bf415371b303ca6b8bbb4ce479b177cba5ad15dbe0c9a7750a588aa6bcd25b2",
  };

  it("all six event signatures parse, and their selectors match the on-chain topic0", async () => {
    const { ESCROW_EVENTS_ABI } = (await import("../src/adapter.js")) as {
      ESCROW_EVENTS_ABI: Abi;
    };
    const events = ESCROW_EVENTS_ABI.filter(
      (i): i is AbiEvent => i.type === "event",
    );
    expect(events).toHaveLength(6);
    expect(
      Object.fromEntries(events.map((e) => [e.name, toEventSelector(e)])),
    ).toEqual(EXPECTED);
  });
});
