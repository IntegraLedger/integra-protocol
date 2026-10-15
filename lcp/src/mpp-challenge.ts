/**
 * MPP's `Payment` challenge, shared by every MPP pairing: parsing the `WWW-Authenticate` field, the challenge `id`
 * derived from the ATR hash, the LCP reference in `opaque`, the binding slot, the digest of what was issued, the
 * buyer's reading, the check on an echoed challenge, the attribution memo and the problem types.
 */
import {
  canonicalJson,
  digestJson,
  fromLcpString,
  fromRawBytes,
  hashEquals,
  isHttpsLink,
  isOtherSchemeLink,
  parseJson,
  toLcpString,
  toRawBytes,
  type AtrHash,
  type Json,
} from "./core.js";
import { bytesOf, hexOf, keccak, keccakHex, type Hex } from "./evm-abi.js";
import { isAddress, normalHash } from "./fields.js";
import { agreementFault, agreementUrlFault } from "./internal/agreement.js";
import { b64uDecode, b64uEncode } from "./internal/base64url.js";
import { REFUSAL_CODES } from "./internal/codes.js";
import type { unmux as StellarUnmux } from "./internal/stellar.js";
import {
  USDC_PROFILES,
  cardChargePairings,
  stripeChargePairings,
  stripeSubscriptionPairings,
  usdcChargePairings,
  usdcProfile,
} from "./mpp-method-checks.js";
import {
  hederaChargePairings,
  hederaSessionPairings,
  nearIntentsChargePairings,
  solanaChargePairings,
  solanaSessionPairings,
  stellarChargePairings,
  xrplChargePairings,
  xrplSessionPairings,
} from "./mpp-rail-checks.js";
import { carriesRefused, isRefusal, readToRepeat, refusal, type Refusal } from "./refusal.js";

/** A challenge's auth-params after quoted-string unescaping. `request` and `opaque` are base64url-nopad JSON. */
export interface MppChallenge {
  id?: string;
  realm: string;
  method: string;
  intent: string;
  request: string;
  expires?: string;
  digest?: string;
  description?: string;
  header?: string;
  opaque?: string;
}

export interface MppCredential {
  challenge: MppChallenge & { id: string };
  source?: string;
  payload: { [k: string]: Json };
}

export type MppMethod =
  | "evm"
  | "tempo"
  | "solana"
  | "lightning"
  | "card"
  | "stripe"
  | "usdc"
  | "nearintents"
  | "stellar"
  | "xrpl"
  | "hedera";
export type MppIntent = "charge" | "session" | "subscription";

/**
 * The request member a pairing writes H into, by intent and method; null where no request member carries it. `usdc`
 * carries H in a request member only on its Solana profile. A Stellar charge's `recipient` carries H's first 8 bytes as
 * its muxed id only: its base account stays a member of what was issued.
 */
export const CARRIER: { readonly [i in MppIntent]: { readonly [m in MppMethod]?: readonly string[] | null } } =
  deepFreeze({
    charge: {
      card: ["externalId"],
      stripe: ["methodDetails", "metadata", "legal_context"],
      usdc: null,
      evm: null,
      tempo: null,
      solana: ["externalId"],
      stellar: ["recipient"],
      xrpl: ["methodDetails", "invoiceId"],
      hedera: null,
      lightning: ["methodDetails", "invoice"],
      nearintents: ["externalId"],
    },
    session: {
      lightning: ["depositInvoice"],
      hedera: null,
      solana: null,
      xrpl: null,
      evm: null,
      tempo: null,
    },
    subscription: { tempo: null, stripe: ["methodDetails", "metadata", "legal_context"] },
  });

/** The request member `usdc` writes H into, by `methodDetails.type`; null where no request member carries it. */
const USDC_CARRIER: { readonly [profile: string]: readonly string[] | null } = deepFreeze({
  evm: null,
  solana: ["externalId"],
  stacks: null,
  gateway: null,
});

/** The id of each MPP pairing `pairingsOf` can name. */
export type MppPairingId =
  | "mpp/charge/evm/permit2"
  | "mpp/charge/evm/authorization"
  | "mpp/charge/evm/transaction"
  | "mpp/charge/evm/hash"
  | "mpp/charge/tempo/memo"
  | "mpp/charge/tempo/push"
  | "mpp/session/evm"
  | "mpp/session/tempo"
  | "mpp/subscription/tempo"
  | "mpp/charge/lightning"
  | "mpp/session/lightning"
  | "mpp/charge/hedera"
  | "mpp/charge/solana"
  | "mpp/charge/stellar"
  | "mpp/charge/xrpl"
  | "mpp/charge/nearintents"
  | "mpp/session/hedera"
  | "mpp/session/solana"
  | "mpp/session/xrpl"
  | "mpp/charge/card"
  | "mpp/charge/stripe"
  | "mpp/subscription/stripe"
  | "mpp/charge/usdc/evm"
  | "mpp/charge/usdc/solana"
  | "mpp/charge/usdc/stacks"
  | "mpp/charge/usdc/gateway";

/**
 * The buyer's inputs to `build`. `build` checks their form and that the chosen challenge's id carries H; it compares no
 * deal value.
 */
export interface MppChoice {
  challenge: MppChallenge & { id: string };
  from: Hex;
  now: number;
  /** authorization only: the token's EIP-712 name and version. */
  tokenDomain?: { name: string; version: string };
  /** permit2 only: the seller server's submitting address. */
  spender?: Hex;
  /** tempo only: the payer's label in the attribution memo, a well-formed string. */
  clientId?: string;
}

const PROBLEM_BASE = "https://paymentauth.org/problems/";
const MAX_FIELD = 8192;
const MAX_CHALLENGES = 32;
const MAX_DECODED = 8192;
const MAX_JSON_DEPTH = 16;
const MAX_CREDENTIAL = 65_536;
const MAX_LINK = 2048;
const LCP_KEYS = ["legalContext", "legalContextUrl", "legalContextAgreementUrl"] as const;
const PARAMS = ["id", "realm", "method", "intent", "request", "expires", "digest", "description", "header", "opaque"];
const BOUND = ["realm", "method", "intent", "request", "expires", "digest", "header", "opaque"] as const;
const REQUIRED = ["id", "realm", "method", "intent", "request"];
const EVM_CREDENTIAL_TYPES: { readonly [t: string]: MppPairingId } = {
  permit2: "mpp/charge/evm/permit2",
  authorization: "mpp/charge/evm/authorization",
  transaction: "mpp/charge/evm/transaction",
  hash: "mpp/charge/evm/hash",
};
const DECIMAL = /^[0-9]{1,78}$/;
const MPP_TAG = keccak("mpp").subarray(0, 4);

// ── Attribution memo.

/**
 * MPP's 32-byte attribution memo: keccak256("mpp")[0..3], `0x01`, keccak256(realm)[0..9], keccak256(clientId)[0..9]
 * or ten zero bytes, then keccak256(challengeId)[0..6], each over the string's UTF-8. A string that is not well-formed
 * is written as `TextEncoder` writes it, with U+FFFD for each lone surrogate; the pairings refuse such a realm,
 * challenge id or client id before they call it.
 */
export function attributionMemo(realm: string, challengeId: string, clientId?: string): Hex {
  const out = new Uint8Array(32);
  out.set(MPP_TAG, 0);
  out[4] = 0x01;
  out.set(keccak(String(realm)).subarray(0, 10), 5);
  if (clientId !== undefined) out.set(keccak(String(clientId)).subarray(0, 10), 15);
  out.set(keccak(String(challengeId)).subarray(0, 7), 25);
  return hexOf(out);
}

/**
 * Checks a memo's tag, version, server id for `realm` and nonce for `challengeId`. The client id is not read. A `realm`
 * or `challengeId` that is not well-formed is hashed as `attributionMemo` hashes it, with U+FFFD for each lone
 * surrogate; the pairings refuse such a challenge before they call it.
 */
export function checkAttribution(memo: string, realm: string, challengeId: string): true | Refusal {
  const m = normalHash(memo);
  if (m === null) return refusal("mpp/attribution-malformed");
  const b = bytesOf(m)!;
  const expect = bytesOf(attributionMemo(realm, challengeId))!;
  for (let i = 0; i < 15; i++) if (b[i] !== expect[i]) return refusal("mpp/attribution-mismatch");
  for (let i = 25; i < 32; i++) if (b[i] !== expect[i]) return refusal("mpp/attribution-mismatch");
  return true;
}

// ── The WWW-Authenticate field.

/**
 * Reads `WWW-Authenticate` field values by RFC 9110's challenge grammar and keeps the `Payment` challenges, with
 * quoted-strings unescaped and unknown parameters dropped. At most 8 KiB per value and 32 `Payment` challenges.
 */
export function parseChallenges(fieldValues: readonly string[]): MppChallenge[] | Refusal {
  if (!Array.isArray(fieldValues)) return refusal("mpp/header-malformed");
  const out: MppChallenge[] = [];
  for (const value of fieldValues) {
    if (typeof value !== "string" || value.length > MAX_FIELD) return refusal("mpp/header-malformed");
    const parsed = parseField(value);
    if (parsed === undefined) return refusal("mpp/header-malformed");
    for (const c of parsed) {
      if (c.scheme.toLowerCase() !== "payment") continue;
      if (c.duplicate) return refusal("mpp/challenge-malformed");
      for (const k of REQUIRED) if (c.params[k] === undefined || c.params[k] === "") return refusal("mpp/challenge-malformed");
      out.push(c.params as unknown as MppChallenge);
      if (out.length > MAX_CHALLENGES) return refusal("mpp/header-malformed");
    }
  }
  return out;
}

type Parsed = { scheme: string; params: { [k: string]: string }; duplicate: boolean };

/** One field value as a list of challenges, or undefined when it does not follow the grammar. */
function parseField(s: string): Parsed[] | undefined {
  const out: Parsed[] = [];
  let i = 0;
  const n = s.length;
  const ows = () => {
    while (i < n && (s[i] === " " || s[i] === "\t")) i++;
  };
  const token = (): string | undefined => {
    const start = i;
    while (i < n && isTchar(s.charCodeAt(i))) i++;
    return i > start ? s.slice(start, i) : undefined;
  };
  const quoted = (): string | undefined => {
    i++;
    let v = "";
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return v;
      }
      if (c === 0x5c) {
        const e = s.charCodeAt(i + 1);
        if (!(e === 0x09 || e === 0x20 || (e >= 0x21 && e <= 0x7e) || (e >= 0x80 && e <= 0xff))) return undefined;
        v += s[i + 1];
        i += 2;
        continue;
      }
      if (!(c === 0x09 || c === 0x20 || c === 0x21 || (c >= 0x23 && c <= 0x7e) || (c >= 0x80 && c <= 0xff))) {
        return undefined;
      }
      v += s[i];
      i++;
    }
    return undefined;
  };
  /** After `name BWS "="`: a token or quoted-string value, or undefined. */
  const value = (): string | undefined => {
    ows();
    if (s[i] === '"') return quoted();
    return token();
  };
  /** Looks ahead from i for `BWS "=" BWS (token / quoted-string)`, without consuming. */
  const paramFollows = (): boolean => {
    let j = i;
    while (j < n && (s[j] === " " || s[j] === "\t")) j++;
    if (s[j] !== "=") return false;
    j++;
    while (j < n && (s[j] === " " || s[j] === "\t")) j++;
    return j < n && (s[j] === '"' || isTchar(s.charCodeAt(j)));
  };
  const addParam = (c: Parsed, name: string, v: string) => {
    const k = name.toLowerCase();
    if (!PARAMS.includes(k)) return;
    if (Object.hasOwn(c.params, k)) c.duplicate = true;
    else c.params[k] = v;
  };
  /** The end of a list element: OWS, then a comma or the end. */
  const elementEnd = (): boolean => {
    ows();
    if (i === n) return true;
    if (s[i] !== ",") return false;
    return true;
  };

  let current: Parsed | undefined;
  for (;;) {
    while (i < n && (s[i] === " " || s[i] === "\t" || s[i] === ",")) i++;
    if (i === n) return out;
    const t = token();
    if (t === undefined) return undefined;
    if (paramFollows()) {
      if (current === undefined) return undefined;
      ows();
      i++;
      const v = value();
      if (v === undefined) return undefined;
      addParam(current, t, v);
      if (!elementEnd()) return undefined;
      continue;
    }
    current = { scheme: t, params: {}, duplicate: false };
    out.push(current);
    if (i === n || s[i] === ",") continue;
    if (s[i] !== " ") return undefined;
    while (i < n && s[i] === " ") i++;
    if (i === n || s[i] === ",") continue;
    const start = i;
    const first = token();
    if (first !== undefined && paramFollows()) {
      ows();
      i++;
      const v = value();
      if (v === undefined) return undefined;
      addParam(current, first, v);
      if (!elementEnd()) return undefined;
      continue;
    }
    i = start;
    while (i < n && isToken68Char(s.charCodeAt(i))) i++;
    while (i < n && s[i] === "=") i++;
    if (i === start || !elementEnd()) return undefined;
  }
}

function isTchar(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    "!#$%&'*+-.^_`|~".includes(String.fromCharCode(c))
  );
}

function isToken68Char(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || "-._~+/".includes(String.fromCharCode(c));
}

// ── The id.

/** base64url, without padding, of H's 32 bytes, then `.` and the challenge's position (0 to 31). */
export function challengeId(h: AtrHash, index: number): string | Refusal {
  const b = normalHash(h);
  if (b === null || !Number.isSafeInteger(index) || index < 0 || index >= MAX_CHALLENGES) {
    return refusal("mpp/challenge-malformed");
  }
  return `${b64uEncode(toRawBytes(b))}.${index}`;
}

/** H from an id `challengeId` wrote, or from the bare base64url of H; anything else is `mpp/id-not-ours`. */
export function challengeH(id: string): AtrHash | Refusal {
  if (typeof id !== "string") return refusal("mpp/id-not-ours");
  const dot = id.indexOf(".");
  const body = dot === -1 ? id : id.slice(0, dot);
  if (dot !== -1) {
    const pos = id.slice(dot + 1);
    if (!/^(?:0|[1-9][0-9]?)$/.test(pos) || Number(pos) >= MAX_CHALLENGES) return refusal("mpp/id-not-ours");
  }
  if (body.length !== 43) return refusal("mpp/id-not-ours");
  const raw = b64uDecode(body, 32);
  const h = raw === undefined ? null : fromRawBytes(raw);
  return h === null ? refusal("mpp/id-not-ours") : h;
}

/**
 * H from a challenge's id in the form its intent and method take: the bare base64url of H for a Tempo `subscription`
 * challenge, and `challengeId`'s form with a position for every other challenge. Any other id is `mpp/id-not-ours`.
 */
export function challengeIdH(c: { id?: unknown; intent: unknown; method: unknown }): AtrHash | Refusal {
  if (!isObject(c) || typeof c.id !== "string") return refusal("mpp/id-not-ours");
  const subscription = c.intent === "subscription" && c.method === "tempo";
  if (c.id.includes(".") === subscription) return refusal("mpp/id-not-ours");
  return challengeH(c.id);
}

/**
 * keccak256(UTF-8(id) ‖ UTF-8(realm)), lowercase: Solidity's `abi.encodePacked(string, string)`. A string that is not
 * well-formed is written as `TextEncoder` writes it, with U+FFFD for each lone surrogate; the pairings refuse such an id
 * or realm before they call it.
 */
export function challengeHash(id: string, realm: string): Hex {
  return keccakHex(`${String(id)}${String(realm)}`);
}

// ── The challenge, checked.

/** A challenge as this module has checked it. */
export interface Checked {
  challenge: MppChallenge;
  intent: MppIntent;
  method: MppMethod;
  request: { [k: string]: Json };
  details: { [k: string]: Json };
  /** unix seconds of `expires`; undefined when the challenge carries none, and then `pairings` holds none that needs it. */
  expires: number | undefined;
  pairings: readonly MppPairingId[];
}

/**
 * The pairings that need the challenge's `expires`: each one's `build` writes it into what the payer signs (the
 * EIP-3009 `validBefore`, the Permit2 `deadline`, the Tempo transaction's `validBefore`, the Stellar entry's expiration
 * ledger, the session opening's deadline), or, on NEAR Intents and the XRP Ledger charge, the method's draft requires
 * it. Without `expires` a challenge offers none of them.
 */
const NEEDS_EXPIRES: ReadonlySet<MppPairingId> = new Set<MppPairingId>([
  "mpp/charge/evm/authorization",
  "mpp/charge/evm/permit2",
  "mpp/charge/tempo/memo",
  "mpp/charge/tempo/push",
  "mpp/charge/usdc/evm",
  "mpp/charge/stellar",
  "mpp/charge/nearintents",
  "mpp/charge/xrpl",
  "mpp/session/evm",
  "mpp/session/tempo",
]);

/**
 * Unix seconds of a checked challenge's `expires`, for a `build` whose pairing writes it; none is
 * `mpp/expires-required`, as `pairingsOf` gives it.
 */
export function expiresOf(checked: Checked): number | Refusal {
  return checked.expires ?? refusal("mpp/expires-required");
}

/**
 * Checks a challenge as issued (no LCP member in `opaque`) and names its pairings, in the order they are offered. A
 * Tempo charge whose `amount` is 0 names none: MPP pays it with a `proof` credential, which moves no money. An
 * `expires` that is present must be an RFC 3339 date-time, else `mpp/expires-required`. Without `expires`, the pairings
 * whose `build` writes it into what the payer signs, and the NEAR Intents and XRP Ledger charges, whose drafts require
 * it, are left out, and a challenge left with no pairing is `mpp/expires-required`.
 */
export function pairingsOf(c: MppChallenge): readonly MppPairingId[] | Refusal {
  const checked = checkChallenge(c, false);
  return isRefusal(checked) ? checked : checked.pairings;
}

/**
 * The pairings a placed challenge offers: `pairingsOf` over the challenge with its `opaque` removed, so the LCP members
 * `place` wrote are not read as an occupied carrier. None when the challenge does not read.
 */
export function pairingsOfPlaced(c: MppChallenge): readonly MppPairingId[] {
  if (!isObject(c)) return [];
  const { opaque: _placed, ...issued } = c;
  const p = pairingsOf(issued as MppChallenge);
  return Array.isArray(p) ? p : [];
}

/**
 * The checks of `pairingsOf`. With `placed`, `opaque` may carry the LCP members `place` writes.
 */
export function checkChallenge(c: unknown, placed: boolean): Checked | Refusal {
  if (!isChallengeShape(c) || !hasHashableRealm(c)) return refusal("mpp/challenge-malformed");
  const key = `${c.intent}/${c.method}`;
  const check = Object.hasOwn(PAIRING_CHECKS, key) ? PAIRING_CHECKS[key] : undefined;
  if (check === undefined) return refusal("mpp/not-this-pairing");
  const expires = c.expires === undefined ? undefined : unixOf(c.expires);
  if (c.expires !== undefined && expires === undefined) return refusal("mpp/expires-required");
  const request = decodeObject(c.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  if (c.opaque !== undefined) {
    const map = decodeStringMap(c.opaque);
    if (map === undefined) return refusal("mpp/opaque-malformed");
    if (!placed && LCP_KEYS.some((k) => Object.hasOwn(map, k))) return refusal("mpp/carrier-taken");
  }
  const md = request["methodDetails"];
  const details = md === undefined ? {} : isObject(md) ? (md as { [k: string]: Json }) : undefined;
  if (details === undefined) return refusal("mpp/request-malformed");
  const named = check(request, details, c);
  if (isRefusal(named)) return named;
  const pairings = expires === undefined ? named.filter((p) => !NEEDS_EXPIRES.has(p)) : named;
  if (pairings.length === 0 && named.length > 0) return refusal("mpp/expires-required");
  return { challenge: c, request, details, expires, intent: c.intent as MppIntent, method: c.method as MppMethod, pairings };
}

export type PairingCheck = (
  request: { [k: string]: Json },
  details: { [k: string]: Json },
  challenge: MppChallenge,
) => readonly MppPairingId[] | Refusal;

/**
 * `charge` on `evm`: `chainId` a positive safe integer, `currency` and `recipient` addresses, `amount` a decimal, and
 * `permit2Address` and `externalId`, when present, an address and a string; then the pairings `credentialTypes` names
 * (absent: `transaction` and `hash`). `splits`, when present, holds 1 to 10 entries, each an address `recipient` and a
 * decimal `amount`, zero included, and leaves only `permit2`.
 */
function evmChargePairings(r: { [k: string]: Json }, d: { [k: string]: Json }, c: MppChallenge): readonly MppPairingId[] | Refusal {
  if (!isPositiveInt(d["chainId"]) || !isAddress(r["currency"]) || !isAddress(r["recipient"]) || !isDecimal(r["amount"])) {
    return refusal("mpp/request-malformed");
  }
  let listed: MppPairingId[];
  const types = d["credentialTypes"];
  if (types === undefined) listed = ["mpp/charge/evm/transaction", "mpp/charge/evm/hash"];
  else {
    if (!Array.isArray(types) || types.length === 0) return refusal("mpp/credential-types");
    listed = [];
    for (const t of types) {
      const p = typeof t === "string" && Object.hasOwn(EVM_CREDENTIAL_TYPES, t) ? EVM_CREDENTIAL_TYPES[t] : undefined;
      if (p === undefined) return refusal("mpp/credential-types");
      if (!listed.includes(p)) listed.push(p);
    }
  }
  const splits = d["splits"];
  if (splits !== undefined) {
    if (!Array.isArray(splits) || splits.length < 1 || splits.length > 10) return refusal("mpp/splits-malformed");
    for (const s of splits) {
      if (!isObject(s) || !isAddress(s["recipient"]) || !isDecimal(s["amount"])) return refusal("mpp/splits-malformed");
    }
    listed = listed.filter((p) => p === "mpp/charge/evm/permit2");
  }
  if (listed.length === 0) return refusal("mpp/credential-types");
  // The Permit2 build writes `permit2Address` as the verifying contract and `externalId` into the signed witness;
  // without `expires` no Permit2 pairing is offered.
  if (listed.includes("mpp/charge/evm/permit2") && c.expires !== undefined) {
    if (d["permit2Address"] !== undefined && !isAddress(d["permit2Address"])) return refusal("mpp/request-malformed");
    if (r["externalId"] !== undefined && typeof r["externalId"] !== "string") return refusal("mpp/request-malformed");
  }
  return listed;
}

function tempoChargePairings(r: { [k: string]: Json }, d: { [k: string]: Json }): readonly MppPairingId[] | Refusal {
  if (!isAddress(r["currency"]) || !isAddress(r["recipient"]) || !isDecimal(r["amount"])) {
    return refusal("mpp/request-malformed");
  }
  if (d["chainId"] !== undefined && !isPositiveInt(d["chainId"])) return refusal("mpp/request-malformed");
  // A zero charge is paid with a `proof` credential, which moves no money, so no pairing binds it; `supportedModes`
  // does not apply to it.
  if (BigInt(r["amount"] as string) === 0n) return [];
  if (d["memo"] !== undefined) return refusal("mpp/carrier-taken");
  const modes = d["supportedModes"];
  let pull = true;
  let push = true;
  if (modes !== undefined) {
    if (!Array.isArray(modes) || !modes.every((m) => m === "pull" || m === "push")) return refusal("mpp/request-malformed");
    pull = modes.includes("pull");
    push = modes.includes("push");
  }
  if (d["feePayer"] === true) push = false;
  const out: MppPairingId[] = [];
  if (pull) out.push("mpp/charge/tempo/memo");
  if (push) out.push("mpp/charge/tempo/push");
  return out.length === 0 ? refusal("mpp/modes-pull-only") : out;
}

function evmSessionPairings(r: { [k: string]: Json }, d: { [k: string]: Json }): readonly MppPairingId[] | Refusal {
  if (d["channelId"] !== undefined || d["sessionSnapshot"] !== undefined) return refusal("mpp/channel-named");
  if (!isAddress(d["escrowContract"])) return refusal("mpp/escrow-malformed");
  if (!isPositiveInt(d["chainId"])) return refusal("mpp/chain-id-required");
  if (!isAddress(r["currency"]) || !isAddress(r["recipient"])) return refusal("mpp/request-malformed");
  const types = d["credentialTypes"];
  if (types !== undefined) {
    if (!Array.isArray(types) || types.length === 0) return refusal("mpp/credential-types");
    if (!types.every((t) => t === "permit2" || t === "authorization" || t === "hash")) {
      return refusal("mpp/credential-types");
    }
  }
  // The Permit2 opening signs `permit2Contract` as the verifying contract; an absent `credentialTypes` is `["hash"]`.
  if (Array.isArray(types) && types.includes("permit2") && d["permit2Contract"] !== undefined && !isAddress(d["permit2Contract"])) {
    return refusal("mpp/request-malformed");
  }
  return ["mpp/session/evm"];
}

function tempoSessionPairings(r: { [k: string]: Json }, d: { [k: string]: Json }): readonly MppPairingId[] | Refusal {
  if (d["channelId"] !== undefined || d["sessionSnapshot"] !== undefined) return refusal("mpp/channel-named");
  const v = d["sessionProtocol"];
  if (v !== undefined && v !== "v1" && v !== "v2") return refusal("mpp/session-protocol");
  if (v === "v2" && (d["chainId"] === undefined || d["escrowContract"] === undefined)) {
    return refusal("mpp/chain-id-required");
  }
  if (d["chainId"] !== undefined && !isPositiveInt(d["chainId"])) return refusal("mpp/chain-id-required");
  if (!isAddress(d["escrowContract"])) return refusal("mpp/escrow-malformed");
  if (d["operator"] !== undefined && !isAddress(d["operator"])) return refusal("mpp/request-malformed");
  if (!isAddress(r["currency"]) || !isAddress(r["recipient"])) return refusal("mpp/request-malformed");
  return ["mpp/session/tempo"];
}

function subscriptionPairings(r: { [k: string]: Json }, d: { [k: string]: Json }): readonly MppPairingId[] | Refusal {
  const key = d["accessKey"];
  if (!isObject(key) || !isAddress(key["accessKeyAddress"])) return refusal("mpp/access-key-malformed");
  if (key["keyType"] !== "p256" && key["keyType"] !== "secp256k1" && key["keyType"] !== "webAuthn") {
    return refusal("mpp/access-key-malformed");
  }
  if (typeof r["subscriptionExpires"] !== "string" || unixOf(r["subscriptionExpires"]) === undefined) {
    return refusal("mpp/request-malformed");
  }
  if (!isPositiveInt(d["chainId"])) return refusal("mpp/chain-id-required");
  if (!isAddress(r["currency"]) || !isAddress(r["recipient"]) || !isDecimal(r["amount"])) {
    return refusal("mpp/request-malformed");
  }
  if (r["periodUnit"] !== "day" && r["periodUnit"] !== "week") return refusal("mpp/request-malformed");
  if (typeof r["periodCount"] !== "string" || !/^[1-9][0-9]{0,15}$/.test(r["periodCount"])) {
    return refusal("mpp/request-malformed");
  }
  return ["mpp/subscription/tempo"];
}

/**
 * Lightning: the payment hash as 64 lowercase hex digits, in `methodDetails` (charge) or in `request` (session), and
 * the invoice, when present, a string. The invoice is made after the hash, so it may be absent here. `amount` and
 * `currency` are not read.
 */
function lightningPairings(pairing: "mpp/charge/lightning" | "mpp/session/lightning"): PairingCheck {
  const charge = pairing === "mpp/charge/lightning";
  return (r, d) => {
    const hash = charge ? d["paymentHash"] : r["paymentHash"];
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return refusal("ln/payment-hash-required");
    const invoice = charge ? d["invoice"] : r["depositInvoice"];
    if (invoice !== undefined && typeof invoice !== "string") return refusal("mpp/request-malformed");
    return [pairing];
  };
}

/** Each (intent, method) this entry point serves, and the check that names its pairings. */
const PAIRING_CHECKS: { readonly [intentAndMethod: string]: PairingCheck } = Object.freeze({
  "charge/evm": evmChargePairings,
  "charge/tempo": tempoChargePairings,
  "session/evm": evmSessionPairings,
  "session/tempo": tempoSessionPairings,
  "subscription/tempo": subscriptionPairings,
  "charge/lightning": lightningPairings("mpp/charge/lightning"),
  "session/lightning": lightningPairings("mpp/session/lightning"),
  "charge/hedera": hederaChargePairings,
  "charge/solana": solanaChargePairings,
  "charge/stellar": stellarChargePairings,
  "charge/xrpl": xrplChargePairings,
  "charge/nearintents": nearIntentsChargePairings,
  "session/hedera": hederaSessionPairings,
  "session/solana": solanaSessionPairings,
  "session/xrpl": xrplSessionPairings,
  "charge/card": cardChargePairings,
  "charge/stripe": stripeChargePairings,
  "subscription/stripe": stripeSubscriptionPairings,
  "charge/usdc": usdcChargePairings,
});

// ── The binding slot and the digest of what was issued.

/** The binding slot: the distinct challenges among `options`, each with exactly MPP's bound members, as issued. */
export function tie(options: readonly MppChallenge[]): ["mpp", { challenges: MppChallenge[] }] {
  const seen = new Set<string>();
  const challenges: MppChallenge[] = [];
  for (const o of Array.isArray(options) ? options : []) {
    if (!isObject(o)) continue;
    const rebuilt: { [k: string]: string } = {};
    for (const k of BOUND) {
      const v = (o as { [k: string]: unknown })[k];
      if (typeof v === "string") rebuilt[k] = v;
    }
    const key = JSON.stringify(rebuilt);
    if (seen.has(key)) continue;
    seen.add(key);
    challenges.push(rebuilt as unknown as MppChallenge);
  }
  return ["mpp", { challenges }];
}

/**
 * the core's `digestJson` over the bound members, with `request` decoded and its carrier removed (`asIssued`), and
 * `opaque` decoded without the LCP members (omitted when that leaves it empty). A value that does not decode is its
 * string.
 */
export async function issuedDigest(c: MppChallenge): Promise<Hex | Refusal> {
  if (!isChallengeShape(c)) return refusal("mpp/challenge-malformed");
  const out: { [k: string]: Json } = { realm: c.realm, method: c.method, intent: c.intent };
  const request = decodeObject(c.request);
  // The Stellar module is imported when a Stellar charge is digested, so loading this module never waits on its peer.
  const unmux = isStellarCharge(c) ? (await import("./internal/stellar.js")).unmux : undefined;
  out["request"] = request === undefined ? c.request : asIssued(c, request, unmux);
  if (c.expires !== undefined) out["expires"] = c.expires;
  if (c.digest !== undefined) out["digest"] = c.digest;
  if (c.header !== undefined) out["header"] = c.header;
  if (c.opaque !== undefined) {
    const map = decodeStringMap(c.opaque);
    if (map === undefined) out["opaque"] = c.opaque;
    else {
      const seller = sellerMap(map);
      if (Object.keys(seller).length > 0) out["opaque"] = seller;
    }
  }
  return digestJson(out);
}

// ── The seller's placement and the buyer's reading.

/**
 * A copy of `doc` in which the challenge whose bound members equal `option` carries the id derived from H and an
 * `opaque` holding the seller's map plus `legalContext`, `legalContextUrl` and, when given, `legalContextAgreementUrl`.
 * A Tempo subscription challenge's id is the bare base64url of H. A `doc` holding a challenge that carries a `refused`
 * member is `mpp/challenge-malformed`, as one holding a challenge without the required members is.
 */
export function place(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  option: MppChallenge,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  if (
    !Array.isArray(doc) ||
    doc.length > MAX_CHALLENGES ||
    !doc.every(isChallengeShape) ||
    doc.some((c) => isObject(c) && carriesRefused(c))
  ) {
    return refusal("mpp/challenge-malformed");
  }
  const hash = normalHash(h);
  if (hash === null) return refusal("mpp/challenge-malformed");
  if (!isHttpsLink(link)) return refusal("mpp/link-not-https");
  if (link.length > MAX_LINK) return refusal("mpp/legal-context-malformed");
  const agreementFaulted = agreementUrlFault(agreementUrl);
  if (agreementFaulted?.fault === "link-not-https") return refusal("mpp/link-not-https");
  if (agreementFaulted !== undefined) return refusal("mpp/legal-context-malformed");
  const checked = checkChallenge(option, false);
  if (isRefusal(checked)) return checked;
  const i = doc.findIndex((c) => sameBound(c, option));
  if (i === -1) return refusal("mpp/not-this-pairing");
  const target = doc[i]!;
  const subscription = option.intent === "subscription" && option.method === "tempo";
  if (subscription && doc.some((c, j) => j !== i && c.intent === "subscription" && c.method === "tempo")) {
    return refusal("mpp/witness-taken");
  }
  const present = target.opaque === undefined ? {} : decodeStringMap(target.opaque);
  if (present === undefined) return refusal("mpp/opaque-malformed");
  const lcp: { [k: string]: string } = { legalContext: toLcpString(hash), legalContextUrl: link };
  if (agreementUrl !== undefined) lcp["legalContextAgreementUrl"] = agreementUrl;
  for (const k of LCP_KEYS) {
    const had = present[k];
    if (had === undefined) continue;
    const same = k === "legalContext" ? fromLcpString(had) === hash : had === lcp[k];
    if (!same) return refusal("mpp/legal-context-conflict");
  }
  const text = canonicalJson({ ...sellerMap(present), ...lcp });
  if (typeof text !== "string") return refusal("mpp/opaque-malformed");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_DECODED) return refusal("mpp/opaque-malformed");
  const id = subscription ? b64uEncode(toRawBytes(hash)) : `${b64uEncode(toRawBytes(hash))}.${i}`;
  const out = doc.map((c) => ({ ...c }));
  out[i] = { ...target, id, opaque: b64uEncode(bytes) };
  return out;
}

/**
 * `place`, then the request member `CARRIER` names for the option's intent and method set to the value `carrier`
 * computes from the member as issued (undefined when absent). The request is re-encoded as base64url of the core's
 * `canonicalJson`, at most 8 KiB.
 */
export function placeCarrier(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  option: MppChallenge,
  carrier: (issued: Json | undefined) => string | Refusal,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  const placed = place(doc, h, link, option, agreementUrl);
  if (isRefusal(placed)) return placed;
  const i = doc.findIndex((c) => sameBound(c, option));
  const request = decodeObject(placed[i]!.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const path = carrierOf(option, request);
  if (path === null) return refusal("mpp/not-this-pairing");
  const value = carrier(memberAt(request, path));
  if (typeof value !== "string") return value;
  const text = canonicalJson(withMember(request, path, value));
  if (typeof text !== "string") return refusal("mpp/request-malformed");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_DECODED) return refusal("mpp/request-malformed");
  placed[i] = { ...placed[i]!, request: b64uEncode(bytes) };
  return placed;
}

/**
 * The request member a challenge's intent and method carry H in, or null where none does; for `usdc`, the member its
 * decoded request's `methodDetails.type` names.
 */
export function carrierOf(c: MppChallenge, request: { [k: string]: Json }): readonly string[] | null {
  if (c.intent === "charge" && c.method === "usdc") {
    const md = request["methodDetails"];
    const type = isObject(md) ? md["type"] : undefined;
    return typeof type === "string" && Object.hasOwn(USDC_CARRIER, type) ? (USDC_CARRIER[type] ?? null) : null;
  }
  const byMethod = Object.hasOwn(CARRIER, c.intent) ? CARRIER[c.intent as MppIntent] : undefined;
  const path = byMethod !== undefined && Object.hasOwn(byMethod, c.method) ? byMethod[c.method as MppMethod] : null;
  return path ?? null;
}

/**
 * The challenge with its carrier removed from `request` (`asIssued`, with `unmux` for a Stellar charge), re-encoded as
 * base64url of the core's `canonicalJson`. A challenge whose request holds no carrier is returned unchanged.
 */
export function withoutCarrier(c: MppChallenge, unmux?: typeof StellarUnmux): MppChallenge {
  if (!isChallengeShape(c)) return c;
  const request = decodeObject(c.request);
  if (request === undefined) return c;
  const issued = asIssued(c, request, unmux);
  if (issued === request) return c;
  const text = canonicalJson(issued);
  if (typeof text !== "string") return c;
  return { ...c, request: b64uEncode(new TextEncoder().encode(text)) };
}

/**
 * A decoded request as the seller issued it: the carrier member `carrierOf` names removed, with a `metadata` object that
 * removal empties removed too. A Stellar charge's muxed `recipient` is replaced by its base `G…` account through
 * `unmux`, so only the muxed id leaves; a `recipient` that is not a muxed address, or any `recipient` when `unmux` is
 * not given, stays as it is. The request itself is returned when it holds no carrier.
 */
function asIssued(
  c: MppChallenge,
  request: { [k: string]: Json },
  unmux: typeof StellarUnmux | undefined,
): { [k: string]: Json } {
  const path = carrierOf(c, request);
  if (path === null || memberAt(request, path) === undefined) return request;
  if (isStellarCharge(c)) {
    const m = unmux?.(request["recipient"]) ?? null;
    return m === null ? request : { ...request, recipient: m.base };
  }
  return without(request, path);
}

/** A Stellar charge, whose carrier is the muxed id of `recipient`. */
function isStellarCharge(c: MppChallenge): boolean {
  return c.intent === "charge" && c.method === "stellar";
}

/** The value at `path` in a decoded request, or undefined. */
export function memberAt(o: { [k: string]: Json }, path: readonly string[]): Json | undefined {
  let at: Json | undefined = o;
  for (const k of path) {
    if (!isObject(at) || !Object.hasOwn(at, k)) return undefined;
    at = (at as { [k: string]: Json })[k];
  }
  return at;
}

function withMember(o: { [k: string]: Json }, path: readonly string[], value: string): { [k: string]: Json } {
  const [head, ...rest] = path;
  if (head === undefined) return o;
  if (rest.length === 0) return { ...o, [head]: value };
  const inner = isObject(o[head]) ? (o[head] as { [k: string]: Json }) : {};
  return { ...o, [head]: withMember(inner, rest, value) };
}

/**
 * The buyer's reading: the challenges whose `opaque` carries an LCP hash and an `https` link and whose id derives from
 * that hash, in document order. `agreement` is their agreement URL when one is present. A link or agreement URL of at
 * most 2048 characters that parses as an absolute URL with a scheme other than `https` is `mpp/link-not-https`, and
 * any other value that is not a link is `mpp/legal-context-malformed`; with no challenge read, a link of another scheme
 * in any challenge gives `mpp/link-not-https`, else a malformed link gives `mpp/legal-context-malformed`.
 */
export function read(
  doc: readonly MppChallenge[],
): { h: AtrHash; link: string; agreement?: string; offer: { challenges: MppChallenge[] } } | Refusal {
  if (!Array.isArray(doc) || doc.length > MAX_CHALLENGES) return refusal("mpp/challenge-malformed");
  let h: AtrHash | undefined;
  let link: string | undefined;
  let agreement: string | undefined;
  const challenges: MppChallenge[] = [];
  let notHttps = false;
  let malformedLink = false;
  for (const c of doc) {
    if (!isChallengeShape(c) || c.opaque === undefined) continue;
    const map = decodeStringMap(c.opaque);
    if (map === undefined) continue;
    const lc = map["legalContext"] === undefined ? null : fromLcpString(map["legalContext"]);
    const url = map["legalContextUrl"];
    if (lc === null) continue;
    const fromId = challengeIdH(c);
    if (typeof fromId !== "string" || !hashEquals(fromId, lc)) continue;
    if (!isLink(url)) {
      if (isOtherSchemeLink(url)) notHttps = true;
      else malformedLink = true;
      continue;
    }
    if (h !== undefined && !hashEquals(h, lc)) return refusal("mpp/legal-context-conflict");
    if (link !== undefined && link !== url) return refusal("mpp/legal-context-conflict");
    const a = map["legalContextAgreementUrl"];
    if (a !== undefined) {
      if (!isLink(a)) {
        if (agreementFault(a).fault === "link-not-https") return refusal("mpp/link-not-https");
        return refusal("mpp/legal-context-malformed");
      }
      if (agreement !== undefined && agreement !== a) return refusal("mpp/legal-context-conflict");
      agreement = a;
    }
    h = lc;
    link = url;
    challenges.push(c);
  }
  if (h === undefined || link === undefined) {
    if (notHttps) return refusal("mpp/link-not-https");
    if (malformedLink) return refusal("mpp/legal-context-malformed");
    return refusal("mpp/no-legal-context");
  }
  return agreement === undefined ? { h, link, offer: { challenges } } : { h, link, agreement, offer: { challenges } };
}

// ── The echoed challenge.

/** A credential's shape: an echoed challenge with an id, an optional string `source`, and a payload object. */
export function credentialOf(c: unknown): MppCredential | Refusal {
  if (!isObject(c) || carriesRefused(c) || !isObject(c.challenge) || !isObject(c.payload)) {
    return refusal("mpp/credential-malformed");
  }
  if (!isChallengeShape(c.challenge) || typeof c.challenge.id !== "string") return refusal("mpp/credential-malformed");
  if (c.source !== undefined && typeof c.source !== "string") return refusal("mpp/credential-malformed");
  return c as unknown as MppCredential;
}

/** The string member `field` of a credential whose payload `type` is `type`, or undefined for any other value. */
export function pushedField(presented: unknown, type: string, field: string): string | undefined {
  const c = credentialOf(presented);
  if (isRefusal(c) || c.payload["type"] !== type) return undefined;
  const v = c.payload[field];
  return typeof v === "string" ? v : undefined;
}

/**
 * H from an echoed challenge: its id derives from H in the form its intent and method take, its `opaque` names H, and
 * its `request` decodes.
 */
export function challengeBound(c: unknown): { h: AtrHash; request: { [k: string]: Json } } | Refusal {
  if (!isObject(c) || carriesRefused(c) || !isObject(c.challenge) || !isObject(c.payload)) {
    return refusal("mpp/credential-malformed");
  }
  if (!isChallengeShape(c.challenge) || typeof c.challenge.id !== "string") return refusal("mpp/credential-malformed");
  if (c.source !== undefined && typeof c.source !== "string") return refusal("mpp/credential-malformed");
  if (!jsonWithin(c, MAX_CREDENTIAL)) return refusal("mpp/credential-malformed");
  if (!hasHashableRealm(c.challenge)) return refusal("mpp/challenge-malformed");
  const h = challengeIdH(c.challenge);
  if (typeof h !== "string") return h;
  if (c.challenge.opaque === undefined) return refusal("mpp/opaque-not-this-hash");
  const map = decodeStringMap(c.challenge.opaque);
  if (map === undefined) return refusal("mpp/opaque-malformed");
  const lc = map["legalContext"] === undefined ? null : fromLcpString(map["legalContext"]);
  if (lc === null || !hashEquals(lc, h)) return refusal("mpp/opaque-not-this-hash");
  const request = decodeObject(c.challenge.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  return { h, request };
}

/**
 * An echoed challenge as a credential presents it: the request decoded, with no member of it checked. Each pairing
 * reads, and checks, only the request members its own read keys or derivation use.
 */
export interface Echoed {
  challenge: MppChallenge & { id: string };
  request: { [k: string]: Json };
  /** `methodDetails`; empty when the request has none. */
  details: { [k: string]: Json };
  /**
   * Unix seconds of `expires`; undefined when the challenge carries none; `mpp/expires-required`, the code `advertise`
   * gives, when it carries one that does not read as a date. A member that reads `expires` refuses with that code.
   */
  expires: number | undefined | Refusal;
}

/**
 * The echoed challenge of a credential for `pairing`: H from `challengeBound`, and the challenge's intent and method,
 * which must be `pairing`'s, with, on `usdc`, the profile `methodDetails.type` names. The request's checks are not run
 * again here: they are `advertise`'s and `build`'s.
 */
export function echoedFor(
  c: unknown,
  pairing: MppPairingId,
): { h: AtrHash; checked: Echoed; payload: { [k: string]: Json } } | Refusal {
  const b = challengeBound(c);
  if (isRefusal(b)) return b;
  const credential = c as MppCredential;
  const [, intent, method] = pairing.split("/");
  if (credential.challenge.intent !== intent || credential.challenge.method !== method) return refusal("mpp/not-this-pairing");
  const echoed = echoedOf(credential.challenge as MppChallenge & { id: string }, b.request);
  if (isRefusal(echoed)) return echoed;
  if (method === "usdc") {
    const profile = usdcProfile(echoed.details);
    if (isRefusal(profile)) return profile;
    if (USDC_PROFILES[profile.type] !== pairing) return refusal("mpp/not-this-pairing");
  }
  return { h: b.h, checked: echoed, payload: credential.payload };
}

/**
 * The `Echoed` of a challenge and its decoded request. A `methodDetails` that is present and not an object is
 * `mpp/request-malformed`, the code `advertise` gives it; it is never read as empty.
 */
export function echoedOf(challenge: MppChallenge & { id: string }, request: { [k: string]: Json }): Echoed | Refusal {
  const md = request["methodDetails"];
  if (md !== undefined && !isObject(md)) return refusal("mpp/request-malformed");
  const details = (md ?? {}) as { [k: string]: Json };
  const at = typeof challenge.expires === "string" ? unixOf(challenge.expires) : undefined;
  const expires = challenge.expires === undefined ? undefined : (at ?? refusal("mpp/expires-required"));
  return { challenge, request, details, expires };
}

/** The request member `key` as an address, else `mpp/request-malformed`. */
export function requestAddress(e: Echoed, key: string): Hex | Refusal {
  const v = e.request[key];
  return isAddress(v) ? v : refusal("mpp/request-malformed");
}

/** The buyer's chosen challenge for `pairing`, checked as placed, whose id derives from `h`. */
export function chosenFor(challenge: unknown, h: AtrHash, pairing: MppPairingId): Checked | Refusal {
  if (!isChallengeShape(challenge) || typeof challenge.id !== "string") return refusal("mpp/input-malformed");
  const checked = checkChallenge(challenge, true);
  if (isRefusal(checked)) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  const fromId = challengeIdH(challenge);
  if (typeof fromId !== "string" || typeof h !== "string" || !hashEquals(fromId, h)) return refusal("mpp/id-not-ours");
  return checked;
}

// ── Problem types.

const MALFORMED = ["mpp/credential-malformed", "mpp/request-malformed", "mpp/opaque-malformed"];
const INVALID_CHALLENGE = ["mpp/id-not-ours"];
/**
 * The codes of a call that cannot read the payment: a reader that is not for the network the challenge or reference
 * names, or a ref `recover` cannot read, and `bound` or `reference` on a push credential before `fetchPresented` has
 * read it.
 */
const CANNOT_READ = [
  "tempo/wrong-reader",
  "svm/wrong-reader",
  "stellar/wrong-reader",
  "xrpl/wrong-reader",
  "hedera/wrong-reader",
  "tempo/read-first",
  "svm/read-first",
  "stellar/read-first",
  "xrpl/read-first",
  "hedera/read-first",
];

/**
 * The Payment scheme's problem type and HTTP status for a refusal code this package returns, from the scheme's Status
 * Codes and Error Codes tables, under `https://paymentauth.org/problems/`:
 * - 402 `malformed-credential`: `mpp/credential-malformed`, `mpp/request-malformed` and `mpp/opaque-malformed`;
 * - 402 `invalid-challenge`: `mpp/id-not-ours`;
 * - 500 `internal-payment-error`: a read to repeat, a code `readToRepeat` answers true for, so the seller asks again
 *   later: a reader that failed or answered out of its form (`<rail>/unreadable`), no landed transaction yet
 *   (`<rail>/not-found`), or a transaction not final yet, such as a revert above the reader's `finalized` mark
 *   (`tempo/not-final`, `hedera/not-final`) or one not in a validated ledger (`xrpl/not-validated`);
 * - 500 `internal-payment-error`: a call that cannot read the payment, which gives the same code until the seller
 *   changes the call: a reader that is not for the network the challenge or reference names, or a ref `recover`
 *   cannot read (`tempo/wrong-reader`, `svm/wrong-reader`, `stellar/wrong-reader`, `xrpl/wrong-reader` and
 *   `hedera/wrong-reader`), and `bound` or `reference` on a push credential before `fetchPresented` has read it
 *   (`tempo/read-first`, `svm/read-first`, `stellar/read-first`, `xrpl/read-first` and `hedera/read-first`);
 * - 402 `verification-failed`: every other code this package returns;
 * - 500 `internal-payment-error`: a code this package does not return. The caller answers its own codes itself.
 *
 * The seller answers a 402 with a fresh challenge and a 500 with no challenge: a challenge goes out only with a 402.
 * Neither carries `Payment-Receipt`.
 */
export function problem(code: string): { status: 402 | 500; type: string } {
  if (!REFUSAL_CODES.has(code) || readToRepeat(code) || CANNOT_READ.includes(code)) {
    return { status: 500, type: `${PROBLEM_BASE}internal-payment-error` };
  }
  if (MALFORMED.includes(code)) return { status: 402, type: `${PROBLEM_BASE}malformed-credential` };
  if (INVALID_CHALLENGE.includes(code)) return { status: 402, type: `${PROBLEM_BASE}invalid-challenge` };
  return { status: 402, type: `${PROBLEM_BASE}verification-failed` };
}

// ── Helpers the pairings share.

/** The address of a `did:pkh:eip155:<chain>:<address>` source, lowercase, or undefined. */
export function didPkhAddress(source: unknown): Hex | undefined {
  if (typeof source !== "string") return undefined;
  const m = /^did:pkh:eip155:[1-9][0-9]{0,15}:(0x[0-9a-fA-F]{40})$/.exec(source);
  return m === null ? undefined : (m[1]!.toLowerCase() as Hex);
}

/** `0x` and an even number of hex digits, from `min` to `max` bytes. */
export function isHexBytes(s: unknown, min: number, max: number): s is Hex {
  if (typeof s !== "string" || s.length % 2 !== 0 || s.length > 2 + 2 * max || !/^0x[0-9a-fA-F]*$/.test(s)) return false;
  return (s.length - 2) / 2 >= min;
}

export function isObject(v: unknown): v is { [k: string]: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** RFC 3339 date-time to unix seconds, the fraction dropped. Seconds 60 and out-of-range fields are refused. */
export function unixOf(s: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/.exec(s);
  if (m === null) return undefined;
  const [y, mo, d, hh, mm, ss] = [1, 2, 3, 4, 5, 6].map((k) => Number(m[k]));
  if (mo! < 1 || mo! > 12 || hh! > 23 || mm! > 59 || ss! > 59) return undefined;
  const leap = (y! % 4 === 0 && y! % 100 !== 0) || y! % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo! - 1]!;
  if (d! < 1 || d! > days) return undefined;
  let offset = 0;
  if (m[7] === undefined) {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 23 || om > 59) return undefined;
    offset = (m[8] === "-" ? -1 : 1) * (oh * 3600 + om * 60);
  }
  return civilDays(y!, mo!, d!) * 86400 + hh! * 3600 + mm! * 60 + ss! - offset;
}

/** Days from 1970-01-01 to the given civil date (proleptic Gregorian). */
function civilDays(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The decoded JSON object of a base64url-nopad value: at most 8 KiB, UTF-8, depth 16, serialisable. */
export function decodeObject(s: string): { [k: string]: Json } | undefined {
  const bytes = b64uDecode(s, MAX_DECODED);
  if (bytes === undefined) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const v = parseJson(text);
  if (!isObject(v) || depthOf(v, 0) > MAX_JSON_DEPTH) return undefined;
  if (typeof canonicalJson(v as Json) !== "string") return undefined;
  return v as { [k: string]: Json };
}

/** A decoded `opaque`: a flat string-to-string map. */
export function decodeStringMap(s: string): { [k: string]: string } | undefined {
  const o = decodeObject(s);
  if (o === undefined || !Object.values(o).every((v) => typeof v === "string")) return undefined;
  return o as { [k: string]: string };
}

/** A challenge's shape: string `realm`, `method`, `intent` and `request`, and each other known member a string when present. */
export function isChallengeShape(c: unknown): c is MppChallenge {
  if (!isObject(c)) return false;
  for (const k of ["realm", "method", "intent", "request"]) if (typeof c[k] !== "string") return false;
  for (const k of ["id", "expires", "digest", "description", "header", "opaque"]) {
    if (c[k] !== undefined && typeof c[k] !== "string") return false;
  }
  return true;
}

/**
 * True when the challenge's `realm` is a well-formed string: the attribution memo, the challenge hash and `usdc`'s
 * derivations hash its UTF-8, which a string holding a lone surrogate does not have.
 */
function hasHashableRealm(c: MppChallenge): boolean {
  return c.realm.isWellFormed();
}

/** True when `a` and `b` agree on every bound member, comparing `opaque` by its seller map. */
function sameBound(a: MppChallenge, b: MppChallenge): boolean {
  for (const k of BOUND) {
    if (k === "opaque") continue;
    if (a[k] !== b[k]) return false;
  }
  if (a.opaque === undefined && b.opaque === undefined) return true;
  const x = a.opaque === undefined ? {} : decodeStringMap(a.opaque);
  const y = b.opaque === undefined ? {} : decodeStringMap(b.opaque);
  if (x === undefined || y === undefined) return false;
  return canonicalJson(sellerMap(x)) === canonicalJson(sellerMap(y));
}

function sellerMap(m: { [k: string]: string }): { [k: string]: string } {
  return Object.fromEntries(Object.entries(m).filter(([k]) => !(LCP_KEYS as readonly string[]).includes(k)));
}

/** `o` without the member at `path`; a `metadata` object that removal leaves empty is removed too. */
function without(o: { [k: string]: Json }, path: readonly string[]): { [k: string]: Json } {
  const [head, ...rest] = path;
  if (head === undefined || !Object.hasOwn(o, head)) return o;
  if (rest.length === 0) return Object.fromEntries(Object.entries(o).filter(([k]) => k !== head));
  const inner = o[head];
  if (!isObject(inner)) return o;
  const reduced = without(inner as { [k: string]: Json }, rest);
  if (head === "metadata" && Object.keys(reduced).length === 0 && Object.keys(inner).length > 0) {
    return Object.fromEntries(Object.entries(o).filter(([k]) => k !== head));
  }
  return { ...o, [head]: reduced };
}

function depthOf(v: unknown, d: number): number {
  if (d > MAX_JSON_DEPTH || typeof v !== "object" || v === null) return d;
  let max = d + 1;
  for (const x of Object.values(v)) max = Math.max(max, depthOf(x, d + 1));
  return max;
}

/**
 * True when `v` is a JSON-like value (bigints allowed) of at most `max` bytes as JSON with at most 16 arrays and objects
 * nested, the outermost counting 1, whatever the innermost holds: the depth `depthOf` counts.
 */
function jsonWithin(v: unknown, max: number): boolean {
  let budget = max;
  // `d` is the number of arrays and objects around `x`.
  const walk = (x: unknown, d: number): boolean => {
    if (typeof x === "string") budget -= x.length + 2;
    else if (typeof x === "number" || typeof x === "bigint" || typeof x === "boolean" || x === null) budget -= 8;
    else if (typeof x === "object" && d + 1 > MAX_JSON_DEPTH) return false;
    else if (Array.isArray(x)) {
      budget -= 2;
      for (const y of x) if (!walk(y, d + 1)) return false;
    } else if (typeof x === "object") {
      budget -= 2;
      for (const [k, y] of Object.entries(x as object)) {
        budget -= k.length + 3;
        if (!walk(y, d + 1)) return false;
      }
    } else if (x !== undefined) return false;
    return budget >= 0;
  };
  return walk(v, 0);
}

function isLink(s: unknown): s is string {
  return typeof s === "string" && s.length <= MAX_LINK && isHttpsLink(s);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

function isDecimal(v: unknown): v is string {
  return typeof v === "string" && DECIMAL.test(v) && BigInt(v) < 1n << 256n;
}
