/**
 * The per-network config table IS the rail's identity, and nothing referenced it before this file:
 * `getSuiConfig` had no test at all. A wrong `rpcUrl` does not error — it answers "no such transaction"
 * for a settlement that exists, so a live weld reads as never-anchored. The same is true of the
 * fully-qualified Move names: `recoverAtrHashFromEvents` matches the event type EXACTLY (never a
 * `::PaymentSettled` suffix, so an untrusted package cannot spoof the weld), which means a drifted
 * module/event segment silently matches nothing rather than matching the wrong thing.
 */
import { describe, expect, it } from "vitest";
import {
  getSuiConfig,
  PAY402_MODULE,
  PAY402_SETTLE_FUNCTION,
  PAY402_SETTLED_EVENT,
  pay402SettledEventType,
  pay402SettleTarget,
  USDC_DECIMALS,
} from "../src/constants.js";

const PKG =
  "0x25c4e00d9ba281c5815c29a2851be2d5ffb10b23ce7399efd57d2a29c103508c";

describe("getSuiConfig", () => {
  it("selects the testnet endpoint and the testnet USDC coin type", () => {
    expect(getSuiConfig("testnet")).toEqual({
      network: "testnet",
      rpcUrl: "https://fullnode.testnet.sui.io",
      usdcCoinType:
        "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
    });
  });

  it("selects the mainnet endpoint and the mainnet USDC coin type", () => {
    expect(getSuiConfig("mainnet")).toEqual({
      network: "mainnet",
      rpcUrl: "https://fullnode.mainnet.sui.io",
      usdcCoinType:
        "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
    });
  });

  it("never answers one network with the other's endpoint or coin type", () => {
    // The failure this guards is silent: querying mainnet for a testnet settlement returns an empty
    // result, which is indistinguishable from "never settled" unless the selector is pinned.
    const testnet = getSuiConfig("testnet");
    const mainnet = getSuiConfig("mainnet");
    expect(testnet.rpcUrl).not.toBe(mainnet.rpcUrl);
    expect(testnet.usdcCoinType).not.toBe(mainnet.usdcCoinType);
    expect(testnet.network).not.toBe(mainnet.network);
  });

  it("serves https endpoints only", () => {
    for (const network of ["testnet", "mainnet"] as const)
      expect(getSuiConfig(network).rpcUrl.startsWith("https://")).toBe(true);
  });
});

describe("fully-qualified Pay402 Move names", () => {
  it("builds the <packageId>::payment::PaymentSettled event type recover matches exactly", () => {
    expect(pay402SettledEventType(PKG)).toBe(`${PKG}::payment::PaymentSettled`);
  });

  it("builds the <packageId>::payment::settle_payment call target propose appends", () => {
    expect(pay402SettleTarget(PKG)).toBe(`${PKG}::payment::settle_payment`);
  });

  it("pins the three Move name segments the two builders compose", () => {
    expect(PAY402_MODULE).toBe("payment");
    expect(PAY402_SETTLE_FUNCTION).toBe("settle_payment");
    expect(PAY402_SETTLED_EVENT).toBe("PaymentSettled");
  });

  it("keeps the settle target and the settled event type distinct", () => {
    // Both are `<pkg>::payment::<name>`; swapping them would make `queryEvents` filter on a function
    // name (matching nothing) or `moveCall` target a struct.
    expect(pay402SettleTarget(PKG)).not.toBe(pay402SettledEventType(PKG));
  });
});

describe("USDC_DECIMALS", () => {
  it("is 6 — the base-unit scale amounts are quoted in", () => {
    expect(USDC_DECIMALS).toBe(6);
    expect(10n ** BigInt(USDC_DECIMALS)).toBe(1_000_000n);
  });
});
