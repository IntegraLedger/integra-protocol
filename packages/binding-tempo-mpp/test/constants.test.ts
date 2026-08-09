import { describe, expect, it } from "vitest";
import {
  getTempoConfig,
  isTip20Address,
  MEMO_TOPIC_INDEX,
  RECEIVE_POLICY_GUARD_ADDRESS,
  requireTip20Token,
  TIP20_ADDRESS_PREFIX,
  TIP20_FACTORY_ADDRESS,
  TRANSFER_FROM_WITH_MEMO_SELECTOR,
  TRANSFER_WITH_MEMO_SELECTOR,
  TRANSFER_WITH_MEMO_TOPIC0,
} from "../src/constants.js";
import {
  MAINNET_CALLDATA,
  MAINNET_MEMO_LOG,
  MAINNET_TOKEN,
} from "./fixtures/mainnet-transfer-with-memo.js";

describe("event topic and selectors", () => {
  // Derived independently with `cast keccak` / `cast sig` on 2026-07-30, NOT copied from any SDK:
  //   cast keccak "TransferWithMemo(address,address,uint256,bytes32)"
  //     -> 0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0
  //   cast sig "transferWithMemo(address,uint256,bytes32)"            -> 0x95777d59
  //   cast sig "transferFromWithMemo(address,address,uint256,bytes32)" -> 0x929c2539
  // The first two are then cross-checked against the live mainnet settlement below, which is the stronger
  // check: the chain itself agrees with the derivation.
  it("pins keccak256 of the TIP-20 TransferWithMemo signature", () => {
    expect(TRANSFER_WITH_MEMO_TOPIC0).toBe(
      "0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0",
    );
  });

  it("agrees with topic 0 of a REAL mainnet TransferWithMemo log", () => {
    expect(MAINNET_MEMO_LOG.topics[0]).toBe(TRANSFER_WITH_MEMO_TOPIC0);
  });

  it("pins the transferWithMemo selector and agrees with real mainnet calldata", () => {
    expect(TRANSFER_WITH_MEMO_SELECTOR).toBe("0x95777d59");
    expect(MAINNET_CALLDATA.slice(0, 10)).toBe(TRANSFER_WITH_MEMO_SELECTOR);
  });

  it("pins the transferFromWithMemo selector — a DIFFERENT call with the same event", () => {
    expect(TRANSFER_FROM_WITH_MEMO_SELECTOR).toBe("0x929c2539");
    expect(TRANSFER_FROM_WITH_MEMO_SELECTOR).not.toBe(
      TRANSFER_WITH_MEMO_SELECTOR,
    );
  });

  it("places the memo at topic index 3 (from, to, memo are the three indexed params)", () => {
    expect(MEMO_TOPIC_INDEX).toBe(3);
    expect(MAINNET_MEMO_LOG.topics).toHaveLength(4);
  });
});

describe("network configuration", () => {
  it("carries Tempo mainnet's chain id, RPC and explorer", () => {
    const cfg = getTempoConfig("mainnet");
    expect(cfg.network).toBe("mainnet");
    expect(cfg.chainId).toBe(4217);
    expect(cfg.rpcUrl).toBe("https://rpc.tempo.xyz");
    expect(cfg.caip2).toBe("eip155:4217");
    expect(cfg.explorerBase).toBe("https://explore.tempo.xyz");
  });

  it("carries the Moderato testnet's chain id and RPC", () => {
    const cfg = getTempoConfig("testnet");
    expect(cfg.network).toBe("testnet");
    expect(cfg.chainId).toBe(42431);
    expect(cfg.rpcUrl).toBe("https://rpc.moderato.tempo.xyz");
    expect(cfg.caip2).toBe("eip155:42431");
    expect(cfg.explorerBase).toBe("https://explore.testnet.tempo.xyz");
  });

  it("gives the two networks distinct chain ids (a swapped default is a silent cross-chain bug)", () => {
    expect(getTempoConfig("mainnet").chainId).not.toBe(
      getTempoConfig("testnet").chainId,
    );
  });
});

describe("TIP-20 address recognition", () => {
  it("recognizes the real mainnet token by its TIP-20 prefix, case-insensitively", () => {
    expect(TIP20_ADDRESS_PREFIX).toBe("0x20c000000000000000000000");
    expect(isTip20Address(MAINNET_TOKEN)).toBe(true);
    expect(isTip20Address(MAINNET_TOKEN.toUpperCase())).toBe(true);
  });

  it("rejects a non-TIP-20 address", () => {
    expect(isTip20Address("0x1111111111111111111111111111111111111111")).toBe(
      false,
    );
  });

  it("requireTip20Token returns the token lower-cased, for exact comparison against a log", () => {
    expect(requireTip20Token(MAINNET_TOKEN.toUpperCase(), "ctx")).toBe(
      MAINNET_TOKEN,
    );
  });

  it("requireTip20Token throws naming its context on a non-TIP-20 address", () => {
    expect(() =>
      requireTip20Token("0x1111111111111111111111111111111111111111", "ctx"),
    ).toThrow(/^ctx: expected a 20-byte TIP-20 token address/);
  });

  it("requireTip20Token rejects the bare prefix — in range, but not an address", () => {
    // `isTip20Address` alone would accept this: it is a prefix test. A 12-byte value cannot emit anything,
    // and comparing it to a log's 20-byte `address` would never match, so it must fail loud instead.
    expect(isTip20Address(TIP20_ADDRESS_PREFIX)).toBe(true);
    expect(() => requireTip20Token(TIP20_ADDRESS_PREFIX, "ctx")).toThrow(
      /20-byte/,
    );
  });

  it("names the factory and the T6 ReceivePolicyGuard precompiles", () => {
    // Both from the live TIP-20 spec. The guard matters to a reader: when a receive policy blocks
    // delivery the transfer STILL succeeds and the funds are redirected there, so a TransferWithMemo
    // event proves the memo was welded — it does not prove the recipient was paid.
    expect(TIP20_FACTORY_ADDRESS).toBe(
      "0x20Fc000000000000000000000000000000000000",
    );
    expect(RECEIVE_POLICY_GUARD_ADDRESS).toBe(
      "0xB10C000000000000000000000000000000000000",
    );
  });
});
