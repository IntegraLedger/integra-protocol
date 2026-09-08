/**
 * XRPL network constants for the LCP `InvoiceID` binding. The atrHash rides `Payment.InvoiceID`, a native
 * 256-bit XRPL field exactly the width of an atrHash (canonical LCP §8.3.1 Native Field per the LCP
 * per-chain binding table; NOT an overlay contract). The buyer signs the Payment that carries it, so the
 * weld is signature-grade — the payer's signature commits to the InvoiceID atomically with the payment.
 *
 * The memo constants below are the READ-ONLY legacy carrier, kept for payments welded before 2026-08-08.
 * Nothing emits one: x402's exact-XRPL scheme makes a facilitator reject any memo-bearing transaction.
 */

/** The legacy LCP memo discriminator, human-readable form (hex-encoded into `Memo.MemoType`). Read-only —
 *  see the module docblock; no code path writes a memo. */
export const LCP_MEMO_TYPE = "lcp/atrHash";
/** The legacy LCP memo format tag, human-readable form (hex-encoded into `Memo.MemoFormat`). Read-only. */
export const LCP_MEMO_FORMAT = "application/octet-stream";

/** The two networks this binding ships constants for. */
export type XrplNetwork = "testnet" | "mainnet";

/** Per-network constants. `faucetUrl` is OPTIONAL and present on testnet only — mainnet has no faucet, and
 *  the field's absence is the honest way to say so. */
export interface XrplNetworkConfig {
  network: XrplNetwork;
  rpcUrl: string;
  faucetUrl?: string;
  explorerBase: string;
  /** CAIP-2 chain id for XRPL (`xrpl:1` testnet, `xrpl:0` mainnet). */
  caip2: string;
}

const TESTNET: XrplNetworkConfig = {
  network: "testnet",
  rpcUrl: "https://s.altnet.rippletest.net:51234/",
  faucetUrl: "https://faucet.altnet.rippletest.net/accounts",
  explorerBase: "https://testnet.xrpl.org",
  caip2: "xrpl:1",
};

const MAINNET: XrplNetworkConfig = {
  network: "mainnet",
  rpcUrl: "https://xrplcluster.com/",
  explorerBase: "https://xrpl.org",
  caip2: "xrpl:0",
};

/** The constants for one network. The public cluster endpoints are shared infrastructure with their own
 *  rate limits, not a production choice. */
export function getXrplConfig(network: XrplNetwork): XrplNetworkConfig {
  return network === "testnet" ? TESTNET : MAINNET;
}

/** 1 XRP = 1_000_000 drops (the base unit of `Payment.Amount`). */
export const DROPS_PER_XRP = 1_000_000;

/**
 * ⛔⛔ THE COLLECTION PATH THIS RAIL'S `weldGrades` IS KEYED BY — exported so a consumer looks the grade up
 * with the SAME token this manifest declares it under.
 *
 * `binding-evm-x402` shipped `0.15.1` with `weldGrades` keyed `ERC3009` — the escrow sibling's COLLECTOR
 * name — while the value a consumer computes from an x402 offer is `eip3009`. The map and the lookup key
 * disagreed inside one published package, so `weldGrades[assetTransferMethod]` answered `undefined`: the
 * grade absent rather than wrong, which reads as a rail declaring no weld grade at all. Nothing caught it —
 * the profile schema constrains weldGrades VALUES (`signature` | `tx`) and says nothing about keys.
 *
 * ⇒ The key is a constant, not a literal, on every rail. `check:weld-grade-keys` holds it.
 */
export const XRPL_INVOICE_ID_PATH = "invoice-id";

/**
 * ⛔⛔ THE COLLECTION PATH THIS RAIL'S `weldGrades` IS KEYED BY — exported so a consumer looks the grade up
 * with the SAME token this manifest declares it under.
 *
 * `binding-evm-x402` shipped `0.15.1` with `weldGrades` keyed `ERC3009` — the escrow sibling's COLLECTOR
 * name — while the value a consumer computes from an x402 offer is `eip3009`. The map and the lookup key
 * disagreed inside one published package, so `weldGrades[assetTransferMethod]` answered `undefined`: the
 * grade absent rather than wrong, which reads as a rail declaring no weld grade at all. Nothing caught it —
 * the profile schema constrains weldGrades VALUES (`signature` | `tx`) and says nothing about keys.
 *
 * ⇒ The key is a constant, not a literal, on every rail. `check:weld-grade-keys` holds it.
 */
export const XRPL_TX_MEMO_PATH = "tx-memo";
