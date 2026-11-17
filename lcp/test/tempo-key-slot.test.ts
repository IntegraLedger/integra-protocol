// The read of a key slot in Tempo's account keychain (src/internal/tempo-key-slot.ts) and the key authorization's
// signed expiry. Oracles: the keychain's interface at tempoxyz/tempo@c8b89f9b
// (`crates/contracts/src/precompiles/account_keychain.rs:76-82`, `:109-143`, `:180`), its selectors computed by viem
// 2.57.4's `toFunctionSelector` and its `KeyInfo` answers encoded by viem's `encodeFunctionResult` over viem's own
// keychain ABI (`viem/tempo` `Abis.accountKeychain`); the key authorization's RLP by Tempo's
// `crates/primitives/src/transaction/key_authorization.rs:177-179` (expiry absent or `0x80`: no expiry).
import { encodeEventTopics, encodeFunctionData, encodeFunctionResult, toFunctionSelector, toHex, toRlp } from "viem";
import { Abis } from "viem/tempo";
import { describe, expect, it } from "vitest";
import type { Hex } from "../src/evm-abi.js";
import { ReaderError } from "../src/evm.js";
import { readKeyAuthorization } from "../src/internal/key-authorization.js";
import {
  AUTHORIZE_SELECTORS,
  GET_KEY_SELECTOR,
  KEY_AUTHORIZATION_WITNESS_BURNED_TOPIC,
  WITNESS_BURNED_SELECTOR,
  slotConsumedAt,
  witnessBurnedAt,
} from "../src/internal/tempo-key-slot.js";

const ACCOUNT = "0x1e78ae2cc0e05a3d1f7245b89c9172a1f602e71b" as Hex;
const KEY = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Hex;
const OTHER = "0x4444444444444444444444444444444444444444" as Hex;
const WITNESS = `0x${"ab".repeat(32)}` as Hex;
const SLOT = { account: ACCOUNT, keyId: KEY, expiry: null, witness: WITNESS };

const keyInfo = (keyId: Hex, expiry: bigint, isRevoked: boolean): Hex =>
  encodeFunctionResult({
    abi: Abis.accountKeychain,
    functionName: "getKey",
    result: { signatureType: 0, keyId, expiry, enforceLimits: false, isRevoked },
  } as never);
const answering = (word: Hex) => ({ call: async () => word });

describe("the keychain's selectors", () => {
  it("are the pin's signatures", () => {
    expect(GET_KEY_SELECTOR).toBe(toFunctionSelector("getKey(address,address)"));
    const restrictions = "(uint64,bool,(address,uint256,uint64)[],bool,(address,(bytes4,address[])[])[])";
    expect(AUTHORIZE_SELECTORS).toEqual([
      toFunctionSelector("authorizeKey(address,uint8,uint64,bool,(address,uint256)[])"),
      toFunctionSelector(`authorizeKey(address,uint8,${restrictions})`),
      toFunctionSelector(`authorizeKey(address,uint8,${restrictions},bytes32)`),
      toFunctionSelector("authorizeAdminKey(address,uint8,bytes32)"),
    ]);
  });
});

describe("the witness's burn mark", () => {
  it("is the pin's view and event", () => {
    expect(WITNESS_BURNED_SELECTOR).toBe(toFunctionSelector("isKeyAuthorizationWitnessBurned(address,bytes32)"));
    expect(KEY_AUTHORIZATION_WITNESS_BURNED_TOPIC).toBe(
      encodeEventTopics({ abi: Abis.accountKeychain, eventName: "KeyAuthorizationWitnessBurned", args: {} } as never)[0],
    );
  });

  it("asks isKeyAuthorizationWitnessBurned(account, witness) at the block, and reads its bool", async () => {
    const asked: unknown[] = [];
    const answer = (v: boolean): Hex => encodeFunctionResult({ abi: Abis.accountKeychain, functionName: "isKeyAuthorizationWitnessBurned", result: v } as never) as Hex;
    expect(await witnessBurnedAt(SLOT, { call: async (to, data, block) => (asked.push([to, data, block]), answer(true)) }, 7n)).toBe(true);
    expect(await witnessBurnedAt(SLOT, answering(answer(false)), 7n)).toBe(false);
    const data = encodeFunctionData({ abi: Abis.accountKeychain, functionName: "isKeyAuthorizationWitnessBurned", args: [ACCOUNT, WITNESS] } as never);
    expect(asked).toEqual([["0xaaaaaaaa00000000000000000000000000000000", data, 7n]]);
    for (const word of ["0x", `0x${"0".repeat(63)}2`] as Hex[]) await expect(witnessBurnedAt(SLOT, answering(word), 1n), word).rejects.toBeInstanceOf(ReaderError);
  });
});

describe("slotConsumedAt", () => {
  it("reads a held key and a revoked one as consumed, a blank entry as unconsumed", async () => {
    expect(await slotConsumedAt(SLOT, answering(keyInfo(KEY, 1_900_000_000n, false)), 1n)).toBe(true);
    expect(await slotConsumedAt(SLOT, answering(keyInfo("0x0000000000000000000000000000000000000000", 0n, true)), 1n)).toBe(true);
    expect(await slotConsumedAt(SLOT, answering(keyInfo("0x0000000000000000000000000000000000000000", 0n, false)), 1n)).toBe(false);
  });

  it("asks getKey(account, keyId) of the keychain at the block", async () => {
    const asked: unknown[] = [];
    await slotConsumedAt(SLOT, { call: async (to, data, block) => (asked.push([to, data, block]), keyInfo(KEY, 1n, false)) }, 7n);
    expect(asked).toEqual([["0xaaaaaaaa00000000000000000000000000000000", `${GET_KEY_SELECTOR}${ACCOUNT.slice(2).padStart(64, "0")}${KEY.slice(2).padStart(64, "0")}`, 7n]]);
  });

  it("rejects malformed an answer that is not KeyInfo's five words, or that names another key", async () => {
    for (const word of ["0x", keyInfo(KEY, 1n, false).slice(0, -2), keyInfo(OTHER, 1n, false), `${keyInfo(KEY, 1n, false).slice(0, -64)}${"0".repeat(63)}2`]) {
      await expect(slotConsumedAt(SLOT, answering(word as Hex), 1n), word).rejects.toBeInstanceOf(ReaderError);
    }
  });
});

describe("the key authorization's signed expiry", () => {
  const signed = (expiry: Hex | undefined): Hex => {
    const items: unknown[] = ["0xa5bf", "0x", KEY];
    if (expiry !== undefined) items.push(expiry, [], [], `0x${"ab".repeat(32)}`);
    return toRlp([items, `0x${"11".repeat(65)}`] as never);
  };

  it("reads item 3 as the expiry, and an absent item or 0 as none", () => {
    expect(readKeyAuthorization(signed(toHex(1_797_724_800n)))).toMatchObject({ expiry: 1_797_724_800n });
    for (const none of [undefined, "0x" as Hex]) {
      const k = readKeyAuthorization(signed(none));
      expect("refused" in k).toBe(false);
      expect(k).not.toHaveProperty("expiry");
    }
  });

  it("refuses an expiry that is not a canonical 64-bit integer", () => {
    for (const bad of ["0x00ff", `0x01${"00".repeat(8)}`] as Hex[]) {
      expect(readKeyAuthorization(signed(bad)), bad).toEqual({ refused: true, code: "tempo/key-authorization-malformed" });
    }
  });
});
