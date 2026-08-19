/**
 * Verified per-deployment `X402AdapterConfig` values for the LCP canonical EVM binding
 * `LCP-X402-EVM-NONCE-1`.
 *
 * **Why this file exists.** `tokenName` and `tokenVersion` are the EIP-712 domain of the USDC contract the
 * authorization is signed against, and they are NOT constant across Circle's deployments: Base Sepolia and
 * Monad report `name() = "USDC"`, while Base mainnet and Avalanche report `name() = "USD Coin"`. A config
 * copied from one chain to another therefore produces a WRONG domain separator, and every authorization
 * signed under it fails verification at the token — silently, from the seller's point of view, because the
 * signature is well-formed and simply does not recover to the payer. That is the exact failure this file
 * removes: each entry below was read from its own deployed contract, never inherited from a sibling.
 *
 * Every value here is reproducible in one call, and the pinned domain separators in
 * the repository's pinned domain-separator tests are what hold them honest:
 *
 *   cast call <asset> "name()(string)"        --rpc-url <rpc>
 *   cast call <asset> "version()(string)"     --rpc-url <rpc>
 *   cast call <asset> "DOMAIN_SEPARATOR()(bytes32)" --rpc-url <rpc>
 *
 * **AN UPSTREAM MISMATCH, SINCE FIXED — recorded because it is the kind that fails silently.** x402's own
 * Go implementation disagreed with the chain about Monad. Verified 2026-08-08 at
 * `x402-foundation/x402@db9dabd0c674` — the last commit touching `go/mechanisms/evm/constants.go`, which is
 * pinned as `x402-go` in `spec-pins.json` and is NOT the specification pin: the SDK and the specification
 * are separate path sets that move on separate schedules. At that revision the `"eip155:143"` entry names
 * the SAME asset address as the `monad` entry below — `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` — and
 * gives it EIP-712 domain `Name: "USD Coin"`. The deployed contract's `name()` returns `"USDC"`, which is
 * what the entry below carries and what the pinned `DOMAIN_SEPARATOR()` assertion in this repository holds
 * it to.
 *
 * The chain is the authority: the domain separator is computed by the token contract, so a signer using
 * "USD Coin" against a contract reporting "USDC" produces an authorization that simply does not recover to
 * the payer. That is the silent failure this whole file exists to prevent, and here it is upstream.
 *
 * **REPORTED UPSTREAM 2026-08-08 and FIXED 2026-08-10:** x402-foundation/x402#3102, with the `cast call`
 * reproduction and the observation that USDC deployments are not uniform on this — Base Sepolia and Monad
 * report "USDC" while Base mainnet and Avalanche report "USD Coin", so a value copied between chains yields
 * a wrong domain separator rather than an obvious error. `76bda78ef420` (PR #3105) changed the Go entry to
 * `"USDC"`, matching the chain and matching the row below. The account is kept because the failure mode is
 * the reason this file exists at all, and because the pin above is what a reader would otherwise re-derive.
 * Our entry never depended on the outcome: the token contract computes the separator, so the chain was and
 * remains the authority.
 *
 * **What this file is not.** It is not an endorsement of a rail, an allowlist, or a supported-chain list.
 * `createX402Adapter` takes any `X402AdapterConfig`, and a deployment absent here is not thereby refused —
 * it simply has not been read off-chain by us. Adding a chain means adding a verified row, nothing more.
 */
import type { X402AdapterConfig } from "./adapter.js";

/**
 * The deployments whose EIP-712 domain values have been read from their own USDC contract.
 *
 * NOT a list of what x402 supports, in either direction. The specification names far more networks than
 * these four — `eip155:43114` and `eip155:43113` among them — so `avalanche` is a verified domain row on a
 * network x402 does define. (Re-checked at HEAD 2026-08-11: it is the Go SDK's `constants.go` that carries
 * no 43114 entry, not the specification.) Adding a chain means adding a verified row, nothing more.
 */
export type X402DeploymentName =
  | "base"
  | "base-sepolia"
  | "avalanche"
  | "monad";

/**
 * Verified 2026-07-30. `fromBlock` is deliberately absent: an enumeration lower bound is an operational
 * choice per deployment, not a property of the token, and defaulting one here would silently narrow a
 * caller's history scan.
 */
const DEPLOYMENTS: Record<X402DeploymentName, X402AdapterConfig> = {
  base: {
    chainId: 8453,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenName: "USD Coin",
    tokenVersion: "2",
  },
  // The chain the x402 weld is live-proven on. Note the name differs from Base MAINNET above — the two
  // Base deployments do not share an EIP-712 domain, which is the sharpest form of this file's hazard.
  "base-sepolia": {
    chainId: 84532,
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenName: "USDC",
    tokenVersion: "2",
  },
  avalanche: {
    chainId: 43114,
    asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    tokenName: "USD Coin",
    tokenVersion: "2",
  },
  monad: {
    chainId: 143,
    asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    tokenName: "USDC",
    tokenVersion: "2",
  },
};

/**
 * The verified config for a known deployment. Throws on an unknown name (fail-fast): there is no sane
 * default, and guessing a domain would produce signatures that verify nowhere.
 */
export function getX402Deployment(name: string): X402AdapterConfig {
  // The guard is folded INTO the lookup rather than sitting in front of it: a separate `hasOwn` early
  // return would make the `=== undefined` check below unreachable, i.e. dead code.
  const config = Object.hasOwn(DEPLOYMENTS, name)
    ? DEPLOYMENTS[name as X402DeploymentName]
    : undefined;
  if (config === undefined)
    throw new Error(
      `unknown x402 deployment "${name}" — known: ${Object.keys(DEPLOYMENTS).join(", ")}. ` +
        "A deployment's tokenName/tokenVersion must be read from its own USDC contract (name()/version()); " +
        "inheriting another chain's values yields a wrong EIP-712 domain and unverifiable signatures.",
    );
  return config;
}

/** The known deployment names, for callers that enumerate rather than look up. */
export function x402DeploymentNames(): X402DeploymentName[] {
  return Object.keys(DEPLOYMENTS) as X402DeploymentName[];
}
