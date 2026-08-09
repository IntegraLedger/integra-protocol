/**
 * `assetWasTransferred` decides whether an absent weld event means "this settled nothing of this asset" or
 * "this settled and I cannot read it". Two rails refuse on the strength of it — x402 for the Permit2
 * fallback, MPP for its three non-`authorization` credential types — so a wrong answer here becomes a wrong
 * verification result on both.
 *
 * It arrived in this package by promotion from `binding-evm-mpp`, and its tests did not come with it: the
 * mutation ratchet caught fifteen NoCoverage mutants on a module that had been fully exercised the day
 * before. Every arm below is one of them.
 */

import type { Log } from "viem";
import { describe, expect, it } from "vitest";
import { assetWasTransferred, ERC20_TRANSFER_TOPIC0 } from "../src/erc20.js";

const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const OTHER = "0x1111111111111111111111111111111111111111";
const NOT_TRANSFER =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"; // Approval

const log = (address: string, topic0?: string): Log =>
  ({
    address,
    topics: topic0 === undefined ? [] : [topic0],
    data: "0x",
  }) as unknown as Log;

describe("ERC20_TRANSFER_TOPIC0", () => {
  it("is keccak256('Transfer(address,address,uint256)')", () => {
    // Pinned as a literal, not recomputed: the value is the module's whole external dependency, and a test
    // that derives it with the same library the code uses would agree with that library's mistake.
    expect(ERC20_TRANSFER_TOPIC0).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });
});

describe("assetWasTransferred", () => {
  it("is true when the configured token emitted Transfer", () => {
    expect(
      assetWasTransferred([log(TOKEN, ERC20_TRANSFER_TOPIC0)], TOKEN),
    ).toBe(true);
  });

  it("is false for an empty log set — nothing moved", () => {
    expect(assetWasTransferred([], TOKEN)).toBe(false);
  });

  it("is false when ANOTHER token emitted Transfer — the address half of the test", () => {
    // Without this, a foreign token's transfer would turn "we settled none of this asset" into a refusal.
    expect(
      assetWasTransferred([log(OTHER, ERC20_TRANSFER_TOPIC0)], TOKEN),
    ).toBe(false);
  });

  it("is false when the configured token emitted a DIFFERENT event — the topic half", () => {
    // And without this, any log at all from the token would count as a transfer.
    expect(assetWasTransferred([log(TOKEN, NOT_TRANSFER)], TOKEN)).toBe(false);
  });

  it("requires BOTH halves on the SAME log, not one each across two logs", () => {
    // The `some` predicate is a conjunction per log. Split across logs it must still answer false, which is
    // what distinguishes it from two independent `.some` scans.
    expect(
      assetWasTransferred(
        [log(TOKEN, NOT_TRANSFER), log(OTHER, ERC20_TRANSFER_TOPIC0)],
        TOKEN,
      ),
    ).toBe(false);
  });

  it("finds the transfer among unrelated logs rather than only at position zero", () => {
    expect(
      assetWasTransferred(
        [
          log(OTHER, NOT_TRANSFER),
          log(TOKEN, NOT_TRANSFER),
          log(TOKEN, ERC20_TRANSFER_TOPIC0),
        ],
        TOKEN,
      ),
    ).toBe(true);
  });

  it("compares addresses case-insensitively — EIP-55 checksums are not a different token", () => {
    // The `toLowerCase` on both sides. A caller configured with a checksummed address and a node returning
    // lowercase (or the reverse) must not read as a different asset.
    expect(
      assetWasTransferred(
        [log(TOKEN.toLowerCase(), ERC20_TRANSFER_TOPIC0)],
        TOKEN.toUpperCase(),
      ),
    ).toBe(true);
  });

  it("compares the topic case-insensitively too", () => {
    expect(
      assetWasTransferred(
        [log(TOKEN, ERC20_TRANSFER_TOPIC0.toUpperCase())],
        TOKEN,
      ),
    ).toBe(true);
  });

  it("does not throw on a log with NO topics — the optional chain is load-bearing", () => {
    // An anonymous event has an empty `topics` array. `topics[0].toLowerCase()` would throw here, out of a
    // predicate whose callers treat it as total.
    expect(assetWasTransferred([log(TOKEN)], TOKEN)).toBe(false);
  });
});
