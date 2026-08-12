/**
 * Stellar network constants for the LCP CAP-67 muxed-address binding. The binding rides
 * `mux_id = atrHash[:8]` inside a CAP-67 muxed M-address that the seller advertises as `payTo`; the buyer
 * signs a Soroban SAC `transfer(from, to, amount)` whose `to` is that M-address, so the buyer's signature
 * commits the 8-byte prefix atomically with the transfer (canonical LCP §8.3.1 Native Field per the LCP
 * per-chain binding table — the CAP-67 muxed id, not an overlay contract).
 *
 * ★ ONLY 8 bytes ride on-chain. A CAP-67 muxed id is exactly 8 bytes, so the FULL 32-byte atrHash does not
 * fit — the on-chain artifact confirms `atrHash[:8]`, it does not recover the whole hash (that comes from
 * off-chain `extensions.legalContext.info`). See `mux.ts` and the manifest for how the surface stays honest.
 */

/** The single canonical mux-id derivation scheme LCP-on-Stellar commits to: `mux_id = atrHash[:8]`. The
 *  prefix is deliberately public (project_stellar_mux_prefix8_audit) — any observer holding the atrHash can
 *  confirm the on-chain mux id matches, which IS the audit-trail property the protocol wants. No HMAC /
 *  per-seller-key variant is wired (that would trade auditability for unlinkability, which is not wanted). */
export const MUX_SCHEME = "atrHash-prefix-8" as const;

/** The mux id is the first 8 bytes of the 32-byte atrHash. */
export const MUX_ID_BYTES = 8;

/** The two networks. Stellar's mainnet is `pubnet`, not `"mainnet"` — the SDK's own name, kept. */
export type StellarNetwork = "testnet" | "pubnet";

/** Per-network constants. Two endpoints, because the write and the read use different ones: the transfer
 *  is a Soroban SAC call (`sorobanRpcUrl`, for the caller that builds and submits it) while recovery reads
 *  the transaction envelope back through Horizon (`horizonUrl`). This package itself performs no HTTP —
 *  `sorobanRpcUrl` is carried for the caller's benefit and nothing here consumes it. */
export interface StellarNetworkConfig {
  network: StellarNetwork;
  /** Network passphrase used for tx signing / envelope decoding. */
  networkPassphrase: string;
  /** Horizon REST base URL. */
  horizonUrl: string;
  /** Soroban RPC URL. */
  sorobanRpcUrl: string;
  /** Circle-issued USDC Soroban Asset Contract id on this network. */
  usdcSacContractId: string;
}

/** Stellar network passphrases (from the SDK's `Networks`; inlined here so constants stays SDK-free). */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
/** The pubnet passphrase. Note the spacing — ` ; ` with spaces either side is part of the string, and the
 *  passphrase is hashed into every signature, so a single wrong character produces a transaction that
 *  verifies against nothing. */
export const PUBNET_PASSPHRASE =
  "Public Global Stellar Network ; September 2015";

const TESTNET: StellarNetworkConfig = {
  network: "testnet",
  networkPassphrase: TESTNET_PASSPHRASE,
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  usdcSacContractId: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
};

const PUBNET: StellarNetworkConfig = {
  network: "pubnet",
  networkPassphrase: PUBNET_PASSPHRASE,
  horizonUrl: "https://horizon.stellar.org",
  sorobanRpcUrl: "https://mainnet.sorobanrpc.com",
  usdcSacContractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
};

/** The constants for one network. Both are usable — the CAP-67 muxed id is a ledger primitive, so nothing
 *  has to be deployed first. */
export function getStellarConfig(
  network: StellarNetwork,
): StellarNetworkConfig {
  return network === "testnet" ? TESTNET : PUBNET;
}

/**
 * USDC on Stellar has 7 decimals — 1 USDC = 10_000_000 base units.
 *
 * RAIL-QUALIFIED ON PURPOSE. Four bindings publish a USDC decimal count and they are NOT all the same —
 * Stellar's is 7 where Hedera's, Solana's and Sui's are 6. A bare `USDC_DECIMALS` exported four times
 * from four packages is one name with two meanings, and the way that fails is silent: a consumer who reads
 * it from one rail and applies it on another is off by a factor of ten in an amount, at settlement rather
 * than at compile time. Each value is correct for its own chain, which is why no per-package test can
 * catch the clash; the prefix is what makes it impossible to import the wrong one by accident.
 */
export const STELLAR_USDC_DECIMALS = 7;
