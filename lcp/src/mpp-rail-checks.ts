/**
 * The request checks of MPP's charge and session challenges on Hedera, Solana, Stellar, XRPL and NEAR Intents, which
 * `pairingsOf` runs for each (intent, method) and which name the pairing a challenge offers. The network names each
 * method uses are mapped to CAIP-2 here.
 */
import type { Json } from "./core.js";
import { isAddress } from "./fields.js";
import { hederaChargeRequest, type HederaNetwork } from "./hedera.js";
import { keyBytes, type SolanaNetwork } from "./internal/svm.js";
import type { XrplNetwork } from "./internal/xrpl.js";
import type { MppChallenge, MppPairing } from "./mpp-challenge.js";
import { refusal, type Refusal } from "./refusal.js";

type Obj = { [k: string]: Json };

const U64_LIMIT = 1n << 64n;
const DECIMAL = /^[0-9]{1,78}$/;
const XRPL_AMOUNT = /^(?:0|[1-9][0-9]{0,39})(?:\.[0-9]{1,40})?$/;
const XRPL_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const XRPL_CURRENCY = /^(?:[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3}|[0-9A-Fa-f]{40})$/;
const XRPL_MPT = /^[0-9A-Fa-f]{48}$/;
const HEX64 = /^[0-9A-Fa-f]{64}$/;
const STELLAR_ACCOUNT = /^G[A-Z2-7]{55}$/;
const STELLAR_MUXED = /^M[A-Z2-7]{68}$/;
const STELLAR_CONTRACT = /^C[A-Z2-7]{55}$/;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const MAX_MEMO_BYTES = 566;

/** MPP Solana's network names and their CAIP-2 identifiers; `localnet` has none. */
export const SOLANA_NETWORKS: { readonly [name: string]: SolanaNetwork | null } = Object.freeze({
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  localnet: null,
});

/** MPP XRPL's network names and their CAIP-2 identifiers. */
export const XRPL_NETWORKS: { readonly [name: string]: XrplNetwork } = Object.freeze({
  mainnet: "xrpl:0",
  testnet: "xrpl:1",
  devnet: "xrpl:2",
});

/** MPP Hedera's chain ids and their networks. */
const HEDERA_SESSION_CHAINS: { readonly [id: number]: HederaNetwork } = Object.freeze({
  295: "hedera:mainnet",
  296: "hedera:testnet",
});

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isU64Positive(v: unknown): v is string {
  return typeof v === "string" && DECIMAL.test(v) && BigInt(v) > 0n && BigInt(v) < U64_LIMIT;
}

function isDecimal(v: unknown): v is string {
  return typeof v === "string" && DECIMAL.test(v) && BigInt(v) < 1n << 256n;
}

function isKey(v: unknown): v is string {
  return keyBytes(v) !== null;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** The CAIP-2 network of MPP Solana's `methodDetails.network` (absent: mainnet), null for `localnet`. */
export function solanaNetworkOf(details: Obj, required: boolean): SolanaNetwork | null | Refusal {
  const n = details["network"];
  if (n === undefined && !required) return SOLANA_NETWORKS["mainnet"]!;
  if (typeof n !== "string" || !Object.hasOwn(SOLANA_NETWORKS, n)) return refusal("svm/network-malformed");
  return SOLANA_NETWORKS[n]!;
}

/** The CAIP-2 network of MPP XRPL's `methodDetails.network`, which has no default. */
export function xrplNetworkOf(details: Obj): XrplNetwork | Refusal {
  const n = details["network"];
  if (n === undefined) return refusal("xrpl/network-missing");
  if (typeof n !== "string" || !Object.hasOwn(XRPL_NETWORKS, n)) return refusal("xrpl/network-malformed");
  return XRPL_NETWORKS[n]!;
}

/** The network of an MPP Hedera session's `methodDetails.chainId` (absent: 295). */
export function hederaSessionNetworkOf(details: Obj): HederaNetwork | Refusal {
  const id = details["chainId"] ?? 295;
  if (typeof id !== "number" || !Object.hasOwn(HEDERA_SESSION_CHAINS, id)) return refusal("hedera/chain-id-unnamed");
  return HEDERA_SESSION_CHAINS[id]!;
}

/** True for an XRPL `currency`: `"XRP"`, an issued currency `{currency, issuer}`, or an MPT `{mpt_issuance_id}`. */
export function isXrplCurrency(v: unknown): boolean {
  if (v === "XRP") return true;
  if (!isObj(v)) return false;
  const keys = Object.keys(v).sort().join(",");
  if (keys === "currency,issuer") {
    return typeof v["currency"] === "string" && XRPL_CURRENCY.test(v["currency"]) && v["currency"] !== "XRP" &&
      typeof v["issuer"] === "string" && XRPL_ADDRESS.test(v["issuer"]);
  }
  return keys === "mpt_issuance_id" && typeof v["mpt_issuance_id"] === "string" && XRPL_MPT.test(v["mpt_issuance_id"]);
}

export function isXrplAddress(v: unknown): v is string {
  return typeof v === "string" && XRPL_ADDRESS.test(v);
}

function isUint32(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

// ── charge ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** `charge` on `hedera`: the Hedera charge request's checks. */
export function hederaChargePairings(_r: Obj, _d: Obj, c: MppChallenge): readonly MppPairing[] | Refusal {
  const ok = hederaChargeRequest(c);
  return ok === true ? ["mpp/charge/hedera"] : ok;
}

/**
 * `charge` on `solana`: `amount` a positive u64, `currency` `"sol"` or a mint, `recipient` a key, `externalId` absent
 * or a string of at most 566 bytes, and `methodDetails.network` one of MPP's three names (absent: mainnet).
 */
export function solanaChargePairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  const network = solanaNetworkOf(d, false);
  if (network !== null && typeof network === "object") return network;
  if (!isU64Positive(r["amount"]) || !(r["currency"] === "sol" || isKey(r["currency"])) || !isKey(r["recipient"])) {
    return refusal("mpp/request-malformed");
  }
  const ext = r["externalId"];
  if (ext !== undefined && (typeof ext !== "string" || utf8Length(ext) > MAX_MEMO_BYTES)) {
    return refusal("mpp/request-malformed");
  }
  if (d["feePayer"] !== undefined && typeof d["feePayer"] !== "boolean") return refusal("mpp/request-malformed");
  if (d["feePayer"] === true && !isKey(d["feePayerKey"])) return refusal("mpp/request-malformed");
  return ["mpp/charge/solana"];
}

/**
 * `charge` on `stellar`: `methodDetails.network` `stellar:pubnet` or `stellar:testnet`, `currency` a contract, and
 * `recipient` an account, or its muxed form once placed.
 */
export function stellarChargePairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  const n = d["network"];
  if (n !== "stellar:pubnet" && n !== "stellar:testnet") return refusal("stellar/option-malformed");
  const to = r["recipient"];
  if (
    !isDecimal(r["amount"]) ||
    typeof r["currency"] !== "string" ||
    !STELLAR_CONTRACT.test(r["currency"]) ||
    typeof to !== "string" ||
    !(STELLAR_ACCOUNT.test(to) || STELLAR_MUXED.test(to))
  ) {
    return refusal("stellar/option-malformed");
  }
  if (d["feePayer"] !== undefined && typeof d["feePayer"] !== "boolean") return refusal("stellar/option-malformed");
  return ["mpp/charge/stellar"];
}

/**
 * `charge` on `xrpl`: `methodDetails.network` present, `recipient` a classic address, `currency` XRP, an issued
 * currency or an MPT, `amount` a positive decimal (whole drops for XRP), and the optional `invoiceId` 64 hex digits and
 * tags uint32.
 */
export function xrplChargePairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  const network = xrplNetworkOf(d);
  if (typeof network !== "string") return network;
  const amount = r["amount"];
  if (
    !isXrplAddress(r["recipient"]) ||
    !isXrplCurrency(r["currency"]) ||
    typeof amount !== "string" ||
    !XRPL_AMOUNT.test(amount) ||
    /^[0.]+$/.test(amount) ||
    (r["currency"] === "XRP" && !isU64Positive(amount))
  ) {
    return refusal("mpp/request-malformed");
  }
  const inv = d["invoiceId"];
  if (inv !== undefined && (typeof inv !== "string" || !HEX64.test(inv))) return refusal("mpp/request-malformed");
  for (const k of ["destinationTag", "sourceTag"]) {
    if (d[k] !== undefined && !isUint32(d[k])) return refusal("mpp/request-malformed");
  }
  return ["mpp/charge/xrpl"];
}

/**
 * `charge` on `nearintents`: the shared fields and the required `methodDetails` members present as strings, the
 * networks CAIP-2, and `credentialTypes`, when present, exactly `["hash"]`.
 */
export function nearIntentsChargePairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  const types = d["credentialTypes"];
  if (types !== undefined && !(Array.isArray(types) && types.length === 1 && types[0] === "hash")) {
    return refusal("mpp/credential-types");
  }
  const strings = [r["currency"], r["recipient"], d["destinationAsset"], d["destinationRecipient"], d["refundTo"]];
  if (
    !isDecimal(r["amount"]) ||
    !isDecimal(d["amountOut"]) ||
    !isDecimal(d["minAmountIn"]) ||
    !strings.every((s) => typeof s === "string" && s.length > 0 && s.length <= 256) ||
    typeof d["originNetwork"] !== "string" ||
    !CAIP2.test(d["originNetwork"]) ||
    typeof d["destinationNetwork"] !== "string" ||
    !CAIP2.test(d["destinationNetwork"]) ||
    (r["externalId"] !== undefined && typeof r["externalId"] !== "string") ||
    (d["depositMemo"] !== undefined && d["depositMemo"] !== null && typeof d["depositMemo"] !== "string")
  ) {
    return refusal("mpp/request-malformed");
  }
  return ["mpp/charge/nearintents"];
}

// ── session ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `session` on `hedera`: no `channelId`; `currency`, `recipient` and `escrowContract` addresses; `chainId` absent,
 * 295 or 296.
 */
export function hederaSessionPairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  if (d["channelId"] !== undefined) return refusal("mpp/channel-named");
  const network = hederaSessionNetworkOf(d);
  if (typeof network !== "string") return network;
  if (!isAddress(r["currency"]) || !isAddress(r["recipient"]) || !isAddress(d["escrowContract"])) {
    return refusal("mpp/request-malformed");
  }
  return ["mpp/session/hedera"];
}

/**
 * `session` on `solana`: no `channelId`; `network` named (MPP Solana's session has no default); `channelProgram`,
 * `currency` and `recipient` keys; `recentBlockhash` and `recentSlot` present; `voucherSigner` absent, `"client"`, or
 * `"operator"` with `operator` a key.
 */
export function solanaSessionPairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  if (d["channelId"] !== undefined) return refusal("mpp/channel-named");
  const network = solanaNetworkOf(d, true);
  if (network !== null && typeof network === "object") return network;
  const signer = d["voucherSigner"];
  if (
    !isKey(d["channelProgram"]) ||
    !isKey(r["currency"]) ||
    !isKey(r["recipient"]) ||
    !isKey(d["recentBlockhash"]) ||
    typeof d["recentSlot"] !== "string" ||
    !isDecimal(d["recentSlot"]) ||
    !(signer === undefined || signer === "client" || (signer === "operator" && isKey(d["operator"])))
  ) {
    return refusal("svm/input-malformed");
  }
  return ["mpp/session/solana"];
}

/** `session` on `xrpl`: `channelId` absent or `""`; `network` named; `currency` absent or `"XRP"`; a classic recipient. */
export function xrplSessionPairings(r: Obj, d: Obj): readonly MppPairing[] | Refusal {
  const channel = r["channelId"] ?? d["channelId"];
  if (channel !== undefined && channel !== "") return refusal("mpp/channel-named");
  const network = xrplNetworkOf(d);
  if (typeof network !== "string") return network;
  if (r["currency"] !== undefined && r["currency"] !== "XRP") return refusal("xrpl/currency-not-xrp");
  if (!isXrplAddress(r["recipient"])) return refusal("mpp/request-malformed");
  return ["mpp/session/xrpl"];
}
