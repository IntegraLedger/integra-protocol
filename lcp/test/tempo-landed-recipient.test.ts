// `landedRecipient`: the one account a landed key authorization lets its key pay. Tempo reads a call scope with no
// selector rules as allowing any selector on its target (tempoxyz/tempo@c8b89f9b
// `crates/primitives/src/transaction/key_authorization.rs:41-44`).
import { describe, expect, it } from "vitest";
import type { Hex } from "../src/evm-abi.js";
import { landedRecipient } from "../src/mpp-session.js";

const TOKEN = "0x20c0000000000000000000000000000000000000" as Hex;
const OTHER_TOKEN = "0x20c0000000000000000000000000000000000001" as Hex;
const PAYEE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Hex;
const transferTo = { selector: "0xa9059cbb" as Hex, recipients: [PAYEE] };

describe("landedRecipient", () => {
  it("names the one recipient of the transfer rules", () => {
    expect(landedRecipient({ allowedCalls: [{ target: TOKEN, selectorRules: [transferTo] }] })).toBe(PAYEE);
  });

  it("names no account where a scope, of the same target or another, has no selector rules", () => {
    expect(landedRecipient({ allowedCalls: [{ target: TOKEN, selectorRules: [transferTo] }, { target: OTHER_TOKEN, selectorRules: [] }] })).toBeUndefined();
    expect(landedRecipient({ allowedCalls: [{ target: TOKEN, selectorRules: [] }] })).toBeUndefined();
  });
});
