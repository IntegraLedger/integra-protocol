/**
 * The request checks of MPP's charge and session challenges on Solana, XRPL and NEAR Intents, which
 * `pairingsOf` runs for each (intent, method) and which name the pairing a challenge offers. The network names each
 * method uses are mapped to CAIP-2 here.
 */
import type { Json } from "./core.js";
import { builtVersion, keyBytes, TOKEN, TOKEN_2022, type SolanaNetwork } from "./internal/svm.js";
import { accountIdOf } from "./internal/xrpl-session.js";
import type { XrplNetwork } from "./internal/xrpl.js";
import { unixOf, type MppPairingId } from "./mpp-challenge.js";
import { refusal, type Refusal } from "./refusal.js";

type Obj = { [k: string]: Json };
type HederaSessionNetwork = "hedera:mainnet" | "hedera:testnet";

/** The chain ids of draft-hedera-session-00's `methodDetails.chainId`, absent being 295. */
const HEDERA_SESSION_CHAINS: { readonly [id: number]: HederaSessionNetwork } = Object.freeze({
  295: "hedera:mainnet",
  296: "hedera:testnet",
});
const EVM_ADDRESS = /^0x[0-9A-Fa-f]{40}$/;

const U64_LIMIT = 1n << 64n;
const DECIMAL = /^[0-9]{1,78}$/;
const XRPL_AMOUNT = /^(?:0|[1-9][0-9]{0,39})(?:\.[0-9]{1,40})?$/;
const XRPL_DROPS = /^(?:0|[1-9][0-9]{0,19})$/;
const XRPL_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const XRPL_CURRENCY = /^(?:[A-Za-z0-9?!@#$%^&*<>(){}[\]|]{3}|[0-9A-Fa-f]{40})$/;
const XRPL_MPT = /^[0-9A-Fa-f]{48}$/;
const HEX64 = /^[0-9A-Fa-f]{64}$/;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const MAX_MEMO_BYTES = 566;
/** The longest period the Solana subscriptions program takes, in hours (`@solana/mpp` 0.7.0 `src/shared/subscription.ts:4`). */
const MAX_PERIOD_HOURS = 8760;

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

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isU64Positive(v: unknown): v is string {
  return typeof v === "string" && DECIMAL.test(v) && BigInt(v) > 0n && BigInt(v) < U64_LIMIT;
}

/** A u64 in decimal, as an XRP amount in drops is written: no sign, point or leading zero. */
function isDrops(v: unknown): v is string {
  return typeof v === "string" && XRPL_DROPS.test(v) && BigInt(v) < U64_LIMIT;
}

function isKey(v: unknown): v is string {
  return keyBytes(v) !== null;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** A charge request's `externalId` as NEAR Intents carries it: absent or a string. */
export function isExternalId(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

/** MPP Solana's `externalId`, which the payer signs as a memo: absent, or a string of at most 566 bytes. */
export function isSolanaExternalId(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && utf8Length(v) <= MAX_MEMO_BYTES);
}

/** MPP XRPL's `methodDetails.invoiceId`: absent, or 64 hex digits. */
export function isXrplInvoiceId(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && HEX64.test(v));
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

/** An XRPL asset as a charge request's `currency` names it: XRP, an issued currency, or an MPT. */
export type XrplCurrency = "XRP" | { readonly currency: string; readonly issuer: string } | { readonly mpt_issuance_id: string };

/** An issued currency `{currency, issuer}` or an MPT `{mpt_issuance_id}`, each part held to its form, exactly those members. */
function issuedOrMpt(v: unknown): XrplCurrency | undefined {
  if (!isObj(v)) return undefined;
  const keys = Object.keys(v).sort().join(",");
  if (keys === "currency,issuer") {
    const c = v["currency"];
    const issuer = v["issuer"];
    return typeof c === "string" && XRPL_CURRENCY.test(c) && c !== "XRP" && typeof issuer === "string" && XRPL_ADDRESS.test(issuer)
      ? { currency: c, issuer }
      : undefined;
  }
  const id = v["mpt_issuance_id"];
  return keys === "mpt_issuance_id" && typeof id === "string" && XRPL_MPT.test(id) ? { mpt_issuance_id: id } : undefined;
}

/**
 * A charge request's `currency`, a string as MPP's XRPL schema has it (`xrpl-mpp-sdk` 0.1.0-beta.4,
 * `dist/chunk-L6LVAN2P.js:17-90`, `currency: z.string()`), in the forms its `parseCurrency` reads
 * (`dist/chunk-JQG7ATQA.js:170-183`): `"XRP"`; a JSON text of an issued currency `{currency, issuer}` or an MPT
 * `{mpt_issuance_id}`; or `CUR:issuer`, one colon. Each part is held to its form. Undefined for any other value, an
 * object among them, which the stock schema refuses.
 */
export function xrplCurrencyOf(v: unknown): XrplCurrency | undefined {
  if (typeof v !== "string") return undefined;
  if (v === "XRP") return "XRP";
  if (v.startsWith("{")) {
    try {
      return issuedOrMpt(JSON.parse(v));
    } catch {
      return undefined;
    }
  }
  const parts = v.split(":");
  return parts.length === 2 ? issuedOrMpt({ currency: parts[0], issuer: parts[1] }) : undefined;
}

/**
 * A charge request's `methodDetails.memos`, as MPP's XRPL schema has it (`dist/chunk-L6LVAN2P.js:17-90`): absent, or an
 * array of objects whose only members are the optional strings `type`, `format` and `data`.
 */
export function isXrplMemos(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  return v.every(
    (m) => isObj(m) && Object.keys(m).every((k) => (k === "type" || k === "format" || k === "data") && typeof m[k] === "string"),
  );
}

export function isXrplAddress(v: unknown): v is string {
  return typeof v === "string" && XRPL_ADDRESS.test(v);
}

function isUint32(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

// ── charge ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `charge` on `solana`: `amount` a positive u64, `currency` `"sol"` or a mint, `recipient` a key, `externalId` absent
 * or a string of at most 566 bytes, and `methodDetails.network` one of MPP's three names (absent: mainnet). Then what
 * `build` reads of `methodDetails` in place of its own inputs, in the form it builds with, else `svm/input-malformed`:
 * no `splits` and no `confidential` transfer, which it does not build; a `transactionVersions` that admits a version
 * (`builtVersion`: absent, or a non-empty array of the integers 0 and 1); a `recentBlockhash` that is a string is a
 * key; and, for a mint, a `decimals` that is a number is an integer from 0 to 255, and a `tokenProgram` that is a
 * string is Token or Token-2022. A challenge whose `methodDetails.feePayer` is `true` names `mpp/charge/solana`: the
 * stock client refuses to broadcast under it from `@solana/mpp` 0.6.0 (`src/client/Charge.ts:79-83` at 0.7.0). Any
 * other names `mpp/charge/solana/unsponsored`, whose payer can broadcast.
 */
export function solanaChargePairings(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  const network = solanaNetworkOf(d, false);
  if (network !== null && typeof network === "object") return network;
  if (!isU64Positive(r["amount"]) || !(r["currency"] === "sol" || isKey(r["currency"])) || !isKey(r["recipient"])) {
    return refusal("mpp/request-malformed");
  }
  if (!isSolanaExternalId(r["externalId"])) return refusal("mpp/request-malformed");
  if (d["feePayer"] !== undefined && typeof d["feePayer"] !== "boolean") return refusal("mpp/request-malformed");
  if (d["feePayer"] === true && !isKey(d["feePayerKey"])) return refusal("mpp/request-malformed");
  if (d["splits"] !== undefined || d["confidential"] === true) return refusal("svm/input-malformed");
  if (builtVersion(d) === null) return refusal("svm/input-malformed");
  if (typeof d["recentBlockhash"] === "string" && !isKey(d["recentBlockhash"])) return refusal("svm/input-malformed");
  if (r["currency"] !== "sol") {
    const decimals = d["decimals"];
    if (typeof decimals === "number" && !(Number.isInteger(decimals) && decimals >= 0 && decimals <= 255)) {
      return refusal("svm/input-malformed");
    }
    const program = d["tokenProgram"];
    if (typeof program === "string" && program !== TOKEN && program !== TOKEN_2022) return refusal("svm/input-malformed");
  }
  return d["feePayer"] === true ? ["mpp/charge/solana"] : ["mpp/charge/solana/unsponsored"];
}

/**
 * `charge` on `xrpl`: `methodDetails.network` present, `recipient` a classic address, `currency` a string naming XRP,
 * an issued currency or an MPT (`xrplCurrencyOf`), `amount` a positive decimal (whole drops for XRP), the optional
 * `invoiceId` 64 hex digits, tags uint32, and `memos` as the stock schema has them (`isXrplMemos`), which `build` writes.
 */
export function xrplChargePairings(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  const network = xrplNetworkOf(d);
  if (typeof network !== "string") return network;
  const amount = r["amount"];
  const currency = xrplCurrencyOf(r["currency"]);
  if (
    !isXrplAddress(r["recipient"]) ||
    currency === undefined ||
    typeof amount !== "string" ||
    !XRPL_AMOUNT.test(amount) ||
    /^[0.]+$/.test(amount) ||
    (currency === "XRP" && !isU64Positive(amount))
  ) {
    return refusal("mpp/request-malformed");
  }
  if (!isXrplInvoiceId(d["invoiceId"])) return refusal("mpp/request-malformed");
  for (const k of ["destinationTag", "sourceTag"]) {
    if (d[k] !== undefined && !isUint32(d[k])) return refusal("mpp/request-malformed");
  }
  if (!isXrplMemos(d["memos"])) return refusal("mpp/request-malformed");
  return ["mpp/charge/xrpl"];
}

/**
 * `charge` on `nearintents`: `methodDetails.originNetwork` CAIP-2, which `network` returns, and `externalId`, where H
 * rides, absent or a string. No other request member is read.
 */
export function nearIntentsChargePairings(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  if (typeof d["originNetwork"] !== "string" || !CAIP2.test(d["originNetwork"]) || !isExternalId(r["externalId"])) {
    return refusal("mpp/request-malformed");
  }
  return ["mpp/charge/nearintents"];
}

// ── subscription ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The period in hours, as `@solana/mpp` 0.7.0 maps it (`src/shared/subscription.ts:14-31`): `periodCount` a positive
 * integer, at most 365 days or 52 weeks; null otherwise.
 */
function periodHours(r: Obj): number | null {
  const count = r["periodCount"];
  if (typeof count !== "string" || !/^[1-9][0-9]{0,2}$/.test(count)) return null;
  const n = Number(count);
  if (r["periodUnit"] === "day") return n <= 365 ? n * 24 : null;
  if (r["periodUnit"] === "week") return n <= 52 ? n * 168 : null;
  return null;
}

/**
 * `subscription` on `solana`: `amount` a positive u64; `currency` and `recipient` keys; `periodUnit` `day` or `week`
 * and `periodCount` a decimal integer that maps to 1 to 8,760 hours as the stock client maps it; `externalId` absent
 * or a string of at most 566 bytes; `subscriptionExpires`, when present, an RFC 3339 date-time; and in
 * `methodDetails`: `decimals` an integer from 0 to 255, `mint`, `planId` and `puller` keys, `tokenProgram` Token or
 * Token-2022, `programId` and `recentBlockhash` keys where present, `network` one of MPP Solana's names (absent:
 * mainnet), and `feePayer` a boolean, `true` only with a `feePayerKey` key. Else `mpp/request-malformed`.
 */
export function solanaSubscriptionPairings(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  const network = solanaNetworkOf(d, false);
  if (network !== null && typeof network === "object") return network;
  const amount = r["amount"];
  if (typeof amount !== "string" || !/^[0-9]{1,20}$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) >= 1n << 64n) {
    return refusal("mpp/request-malformed");
  }
  if (!isKey(r["currency"]) || !isKey(r["recipient"]) || !isSolanaExternalId(r["externalId"])) {
    return refusal("mpp/request-malformed");
  }
  const hours = periodHours(r);
  if (hours === null || hours < 1 || hours > MAX_PERIOD_HOURS) return refusal("mpp/request-malformed");
  const expires = r["subscriptionExpires"];
  if (expires !== undefined && (typeof expires !== "string" || unixOf(expires) === undefined)) {
    return refusal("mpp/request-malformed");
  }
  const decimals = d["decimals"];
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return refusal("mpp/request-malformed");
  }
  if (!isKey(d["mint"]) || !isKey(d["planId"]) || !isKey(d["puller"])) return refusal("mpp/request-malformed");
  if (d["tokenProgram"] !== TOKEN && d["tokenProgram"] !== TOKEN_2022) return refusal("mpp/request-malformed");
  if (d["programId"] !== undefined && !isKey(d["programId"])) return refusal("mpp/request-malformed");
  if (d["recentBlockhash"] !== undefined && !isKey(d["recentBlockhash"])) return refusal("mpp/request-malformed");
  if (d["feePayer"] !== undefined && typeof d["feePayer"] !== "boolean") return refusal("mpp/request-malformed");
  if (d["feePayer"] === true && !isKey(d["feePayerKey"])) return refusal("mpp/request-malformed");
  return ["mpp/subscription/solana"];
}

// ── session ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The stablecoin symbols `@solana/mpp` 0.7.0 resolves to a mint per network (`src/constants.ts:113-131`). */
const SOLANA_SYMBOLS = ["USDC", "USDT", "USDG", "PYUSD", "CASH"];

/** A u64 written as a decimal string or a safe integer, as the stock session request's `recentSlot` is. */
function isU64Like(v: unknown): boolean {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0;
  return typeof v === "string" && DECIMAL.test(v) && BigInt(v) < U64_LIMIT;
}

/**
 * `session` on `solana`, as `@solana/mpp` 0.7.0's session request holds it, its members in the request itself
 * (`src/Methods.ts:258-301`): `cap` a positive u64; `currency` a mint or a stablecoin symbol the stock client resolves,
 * never `sol`, which a payment channel cannot hold (`src/client/PaymentChannels.ts:409-412`); `recipient` and
 * `operator` keys; `network` one of MPP Solana's names (absent: mainnet); `programId` and `recentBlockhash` keys,
 * `recentSlot` a u64, `decimals` an integer from 0 to 255, `minVoucherDelta` a u64 and `externalId` a string of at most
 * 566 bytes, each where present; `splits` at most 8 entries, each a key and an integer of basis points from 0 to
 * 10,000; `modes` a non-empty list of `push` and `pull`; and `pullVoucherStrategy` `clientVoucher` or
 * `operatedVoucher`. Else `mpp/request-malformed`. A challenge whose `pullVoucherStrategy` is `operatedVoucher` is
 * `svm/operated-voucher`: its stock opening is a token delegation, which deposits nothing. A challenge whose `modes` is
 * exactly `["pull"]` and whose `pullVoucherStrategy` is `clientVoucher` names `mpp/session/solana/memo`: the stock client
 * opens in the first mode listed, and under it composes an `open` whose fee payer is the operator
 * (`src/client/Session.ts:767`; `src/client/PaymentChannels.ts:104-173`, `:198-215`). Any other names
 * `mpp/session/solana/stock`, whose opening the buyer's client broadcasts.
 */
export function solanaSessionPairings(r: Obj, _d: Obj): readonly MppPairingId[] | Refusal {
  const network = solanaNetworkOf(r, false);
  if (network !== null && typeof network === "object") return network;
  const currency = r["currency"];
  const symbol = typeof currency === "string" && SOLANA_SYMBOLS.includes(currency.toUpperCase());
  if (!isU64Positive(r["cap"]) || !(symbol || isKey(currency)) || !isKey(r["recipient"]) || !isKey(r["operator"])) {
    return refusal("mpp/request-malformed");
  }
  if (!isSolanaExternalId(r["externalId"])) return refusal("mpp/request-malformed");
  for (const k of ["programId", "recentBlockhash"]) if (r[k] !== undefined && !isKey(r[k])) return refusal("mpp/request-malformed");
  if (r["recentSlot"] !== undefined && !isU64Like(r["recentSlot"])) return refusal("mpp/request-malformed");
  if (r["minVoucherDelta"] !== undefined && !(typeof r["minVoucherDelta"] === "string" && isU64Like(r["minVoucherDelta"]))) {
    return refusal("mpp/request-malformed");
  }
  const decimals = r["decimals"];
  if (decimals !== undefined && !(typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255)) {
    return refusal("mpp/request-malformed");
  }
  const splits = r["splits"];
  if (splits !== undefined) {
    if (!Array.isArray(splits) || splits.length > 8) return refusal("mpp/request-malformed");
    for (const x of splits) {
      const bps = isObj(x) ? x["bps"] : undefined;
      if (!isObj(x) || !isKey(x["recipient"]) || typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > 10_000) {
        return refusal("mpp/request-malformed");
      }
    }
  }
  const modes = r["modes"];
  if (modes !== undefined && (!Array.isArray(modes) || modes.length === 0 || !modes.every((m) => m === "push" || m === "pull"))) {
    return refusal("mpp/request-malformed");
  }
  const strategy = r["pullVoucherStrategy"];
  if (strategy !== undefined && strategy !== "clientVoucher" && strategy !== "operatedVoucher") return refusal("mpp/request-malformed");
  if (strategy === "operatedVoucher") return refusal("svm/operated-voucher");
  const serverSubmits = Array.isArray(modes) && modes.length === 1 && modes[0] === "pull" && strategy === "clientVoucher";
  return [serverSubmits ? "mpp/session/solana/memo" : "mpp/session/solana/stock"];
}

/**
 * `session` on `xrpl`: `channelId` absent or `""`; `network` named; `currency` absent or `"XRP"`; a classic recipient
 * whose checksum holds, as the channel id `build` derives reads it; `amount` a u64 in drops, written in decimal with no
 * sign, point or leading zero. It names both XRPL sessions, which no member of the challenge tells apart: the in-band
 * opening lcp's client writes, and the stock client's session, which opens its channel out of band.
 */
export function xrplSessionPairings(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  const channel = r["channelId"] ?? d["channelId"];
  if (channel !== undefined && channel !== "") return refusal("mpp/channel-named");
  const network = xrplNetworkOf(d);
  if (typeof network !== "string") return network;
  if (r["currency"] !== undefined && r["currency"] !== "XRP") return refusal("xrpl/currency-not-xrp");
  if (!isXrplAddress(r["recipient"]) || accountIdOf(r["recipient"]) === null || !isDrops(r["amount"])) {
    return refusal("mpp/request-malformed");
  }
  return ["mpp/session/xrpl", "mpp/session/xrpl/stock"];
}

// ── session on hedera ──────────────────────────────────────────────────────────────────────────────────────────

/** The network of a Hedera session's `methodDetails.chainId`, absent being 295; another is `mpp/request-malformed`. */
export function hederaSessionNetworkOf(details: Obj): HederaSessionNetwork | Refusal {
  const id = details["chainId"] ?? 295;
  return typeof id === "number" && Object.hasOwn(HEDERA_SESSION_CHAINS, id) ? HEDERA_SESSION_CHAINS[id]! : refusal("mpp/request-malformed");
}

/**
 * `session` on `hedera`: the stock session. No `channelId` (`mpp/channel-named`); `chainId` absent, 295 or 296;
 * `currency`, `recipient` and `escrowContract` addresses (draft-hedera-session-00), else `mpp/request-malformed`.
 */
export function hederaSessionPairings(r: Obj, d: Obj): readonly MppPairingId[] | Refusal {
  if (d["channelId"] !== undefined) return refusal("mpp/channel-named");
  const network = hederaSessionNetworkOf(d);
  if (typeof network !== "string") return network;
  if (!isEvmAddress(r["currency"]) || !isEvmAddress(r["recipient"]) || !isEvmAddress(d["escrowContract"])) {
    return refusal("mpp/request-malformed");
  }
  return ["mpp/session/hedera/stock"];
}

function isEvmAddress(v: unknown): boolean {
  return typeof v === "string" && EVM_ADDRESS.test(v);
}
