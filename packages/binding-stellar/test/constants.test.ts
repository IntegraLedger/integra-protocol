/**
 * `constants.ts` measured 0% — nothing in the suite referenced `getStellarConfig` or either network
 * table. On Stellar the table is more load-bearing than most: the passphrase is not just addressing,
 * it is hashed into the network id that every transaction signature commits to, so the wrong one
 * yields a signature that is invalid where it was meant to apply. The endpoints fail quieter still —
 * Horizon answers 404 for a settlement that exists on the other network, which reads as never-anchored.
 */
import { describe, expect, it } from "vitest";
import {
  getStellarConfig,
  MUX_ID_BYTES,
  MUX_SCHEME,
  PUBNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  USDC_DECIMALS,
} from "../src/constants.js";

describe("getStellarConfig", () => {
  it("selects the testnet passphrase, endpoints and USDC SAC id", () => {
    expect(getStellarConfig("testnet")).toEqual({
      network: "testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanRpcUrl: "https://soroban-testnet.stellar.org",
      usdcSacContractId:
        "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
    });
  });

  it("selects the pubnet passphrase, endpoints and USDC SAC id", () => {
    expect(getStellarConfig("pubnet")).toEqual({
      network: "pubnet",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      horizonUrl: "https://horizon.stellar.org",
      sorobanRpcUrl: "https://mainnet.sorobanrpc.com",
      usdcSacContractId:
        "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    });
  });

  it("never answers one network with any of the other's four fields", () => {
    const testnet = getStellarConfig("testnet");
    const pubnet = getStellarConfig("pubnet");
    expect(testnet.network).not.toBe(pubnet.network);
    expect(testnet.networkPassphrase).not.toBe(pubnet.networkPassphrase);
    expect(testnet.horizonUrl).not.toBe(pubnet.horizonUrl);
    expect(testnet.sorobanRpcUrl).not.toBe(pubnet.sorobanRpcUrl);
    expect(testnet.usdcSacContractId).not.toBe(pubnet.usdcSacContractId);
  });

  it("exports the same passphrases the config table serves", () => {
    // The two constants are exported separately for envelope decoding; a drift between them and the
    // table would sign against one network while reading from the other.
    expect(getStellarConfig("testnet").networkPassphrase).toBe(
      TESTNET_PASSPHRASE,
    );
    expect(getStellarConfig("pubnet").networkPassphrase).toBe(
      PUBNET_PASSPHRASE,
    );
    expect(TESTNET_PASSPHRASE).not.toBe(PUBNET_PASSPHRASE);
  });

  it("serves https endpoints only", () => {
    for (const network of ["testnet", "pubnet"] as const) {
      const config = getStellarConfig(network);
      expect(config.horizonUrl.startsWith("https://")).toBe(true);
      expect(config.sorobanRpcUrl.startsWith("https://")).toBe(true);
    }
  });

  it("serves valid StrKey contract ids (C-prefixed, 56 chars)", () => {
    for (const network of ["testnet", "pubnet"] as const) {
      const id = getStellarConfig(network).usdcSacContractId;
      expect(id).toMatch(/^C[A-Z2-7]{55}$/);
    }
  });
});

describe("the prefix-8 scheme constants", () => {
  it("commits to atrHash-prefix-8 — the single canonical derivation, no HMAC variant", () => {
    expect(MUX_SCHEME).toBe("atrHash-prefix-8");
  });

  it("is 8 bytes — a quarter of the 32-byte atrHash, which is why this rail confirms and cannot recover", () => {
    expect(MUX_ID_BYTES).toBe(8);
    expect(MUX_ID_BYTES).toBeLessThan(32);
  });
});

describe("USDC_DECIMALS", () => {
  it("is 7 on Stellar — not the 6 every other rail in this repo uses", () => {
    expect(USDC_DECIMALS).toBe(7);
    expect(10 ** USDC_DECIMALS).toBe(10_000_000);
  });
});
