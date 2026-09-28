/**
 * The `mpp` entry point: MPP's challenge pieces and its pairings. The charge pairings here are EVM `authorization`
 * (the signed nonce is keccak256(id ‖ realm)), EVM `permit2` (the signed witness carries that value), EVM
 * `transaction` and `hash` (nothing signed carries H), and Tempo pull and push (the signed `transferWithMemo` carries
 * MPP's attribution memo, whose nonce is keccak256 of the id). The session and subscription pairings are re-exported
 * from their module.
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import { addressWord, bytesOf, concat, hexOf, sameBytes, uintOf, uintWord, type Hex } from "./evm-abi.js";
import {
  AUTHORIZATION_USED_TOPIC,
  TRANSFER_TOPIC,
  eip3009TypedData,
  evmStatus,
  isGuardTransfer,
  permit2TypedData,
  transferDigest,
  transferParts,
  PERMIT2,
  type EvmBreadthStatus,
  type EvmLog,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type Eip3009TypedData,
  type Permit2TypedData,
} from "./evm.js";
import { isAddress, normalHash, uint256Of } from "./fields.js";
import {
  attributionMemo,
  challengeBound,
  challengeIdH,
  challengeHash,
  checkAttribution,
  checkChallenge,
  credentialOf,
  deepFreeze,
  didPkhAddress,
  isHexBytes,
  isObject,
  pairingsOf,
  place,
  pushedField,
  read,
  tie,
  type Checked,
  type MppChallenge,
  type MppChoice,
  type MppCredential,
} from "./mpp-challenge.js";
import { chargeHedera } from "./hedera.js";
import { chargeCard, chargeStripe, subscriptionStripe } from "./mpp-card-stripe.js";
import { stacksNetworkOf, usdcProfile } from "./mpp-method-checks.js";
import { chargeNearIntents } from "./mpp-nearintents.js";
import { chargeUsdcEvm, chargeUsdcGateway, chargeUsdcSolana, chargeUsdcStacks } from "./mpp-usdc.js";
import { evmSessionResume, sessionEvm, sessionNetwork, sessionTempo, subscriptionTempo } from "./mpp-session.js";
import { hederaSessionNetworkOf, solanaNetworkOf, xrplNetworkOf } from "./mpp-rail-checks.js";
import { chargeLightning, sessionLightning } from "./lightning.js";
import { railSessionResume, sessionHedera, sessionSolana, sessionXrpl } from "./mpp-session-rails.js";
import { chargeSolana } from "./mpp-solana.js";
import { chargeStellar } from "./mpp-stellar.js";
import { chargeXrpl } from "./mpp-xrpl.js";
import { readReceipt } from "./receipt.js";
import { refusal, type Refusal } from "./refusal.js";
import { TRANSFER_WITH_MEMO_SELECTOR, TRANSFER_WITH_MEMO_TOPIC, decodeTempoTx, memoCalldata } from "./tempo.js";
import type { LcpPattern } from "./x402.js";

export {
  CARRIER,
  USDC_CARRIER,
  attributionMemo,
  challengeBound,
  challengeH,
  challengeHash,
  challengeId,
  checkAttribution,
  issuedDigest,
  pairingsOf,
  pairingsOfPlaced,
  parseChallenges,
  place,
  problem,
  read,
  tie,
} from "./mpp-challenge.js";
export type { MppChallenge, MppChoice, MppCredential, MppIntent, MppMethod, MppPairing } from "./mpp-challenge.js";
export { chargeHedera } from "./hedera.js";
export { LEGAL_CONTEXT_METADATA_KEY, chargeCard, chargeStripe, subscriptionStripe } from "./mpp-card-stripe.js";
export type { StripeSubscriptionReceipt } from "./mpp-card-stripe.js";
export {
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  chargeUsdcStacks,
  gatewayAccount,
  usdcGatewaySalt,
  usdcNonce,
  usdcRequestHash,
  type GatewayPreimage,
  type GatewaySaltInput,
  type StacksChargeChoice,
  type UsdcUnsigned,
} from "./mpp-usdc.js";
export { chargeNearIntents } from "./mpp-nearintents.js";
export { chargeSolana, mppSvmCarrier, type SolanaChargeChoice, type SolanaChargeUnsigned } from "./mpp-solana.js";
export { chargeStellar, type StellarChargeChoice, type StellarChargeUnsigned } from "./mpp-stellar.js";
export { chargeXrpl, type XrplChargeChoice, type XrplChargeUnsigned } from "./mpp-xrpl.js";
export {
  sessionHedera,
  sessionSolana,
  sessionXrpl,
  type HederaLandedCredential,
  type HederaSessionUnsigned,
  type RailSessionChoice,
  type RailSessionUnsigned,
  type SolanaSessionUnsigned,
  type XrplSessionUnsigned,
} from "./mpp-session-rails.js";
export {
  EVM_CLOSE_SELECTORS,
  evmChannelId,
  keySearch,
  sessionEvm,
  sessionStatus,
  sessionTempo,
  subscriptionTempo,
} from "./mpp-session.js";
export type {
  ReceiveTypedData,
  SessionChoice,
  SessionRef,
  SessionStatus,
  SessionUnsigned,
  SessionWithin,
  SessionWithinUnsigned,
  VoucherTypedData,
  WithinSigningRequest,
} from "./mpp-session.js";
export type MppUnsigned =
  | {
      request: { kind: "eip712"; typedData: Eip3009TypedData | Permit2TypedData };
      complete(signature: Hex): MppCredential | Refusal;
    }
  | {
      /** push: the buyer's signer broadcasts, and `complete` takes the transaction hash. */
      request: {
        kind: "tempo-call";
        chainId: number;
        call: { to: Hex; data: Hex };
        validBefore: number;
        broadcast: boolean;
      };
      complete(signedTxOrHash: Hex): MppCredential | Refusal;
    }
  | {
      /** An EIP-1559 transaction of the call, or its hash once broadcast. */
      request: { kind: "evm-call"; chainId: number; call: { to: Hex; data: Hex }; broadcast: boolean };
      complete(signedTxOrHash: Hex): MppCredential | Refusal;
    };

/** A push credential with the landed receipt's logs from the currency. */
export interface LandedCredential extends MppCredential {
  landed: { transaction: Hex; blockNumber: bigint; logs: readonly EvmLog[] };
}

const AUTHORIZATION = "mpp/charge/evm/authorization" as const;
const PERMIT2_ID = "mpp/charge/evm/permit2" as const;
const TRANSACTION = "mpp/charge/evm/transaction" as const;
const HASH = "mpp/charge/evm/hash" as const;
const MEMO = "mpp/charge/tempo/memo" as const;
const PUSH = "mpp/charge/tempo/push" as const;
type ChargeId = typeof AUTHORIZATION | typeof PERMIT2_ID | typeof TRANSACTION | typeof HASH | typeof MEMO | typeof PUSH;

const TEMPO_DEFAULT_CHAIN = 42431;
const MAX_SIGNATURE = 8192;
const MAX_WIRE = 65_536;
const TRANSFER_SELECTOR = "0xa9059cbb";
const PAYMENT_WITNESS = [
  { name: "challengeHash", type: "bytes32" },
  { name: "externalId", type: "string" },
] as const;

// ── Settlement for the pairings whose payment carries nothing signed.

/**
 * `evmStatus` on the reported transaction with no named log; settled also requires one log from `ref.asset` with three
 * topics and `topics[0]` = `Transfer` whose recipient is not `RECEIVE_POLICY_GUARD`. Without one, a `Transfer` from
 * `ref.asset` to the guard is failed `receive-policy-blocked`, and anything else failed `transfer-not-found`. At most
 * three calls.
 */
export async function transferPresent(
  ref: EvmRef & { transaction: Hex; asset: Hex },
  reader: EvmReader,
): Promise<EvmBreadthStatus> {
  if (typeof reader !== "object" || reader === null || typeof ref !== "object" || ref === null) {
    return { state: "pending", why: "unreadable" };
  }
  let seen: EvmReceipt | null = null;
  const watching: EvmReader = {
    network: reader.network,
    receipt: async (tx) => (seen = await reader.receipt(tx)),
    blockNumber: (tag) => reader.blockNumber(tag),
    transaction: (tx) => reader.transaction(tx),
  };
  const s = await evmStatus({ network: ref.network, transaction: ref.transaction }, watching);
  if (s.state !== "settled") return s;
  const logs = (seen as EvmReceipt | null)?.logs ?? [];
  if (!isAddress(ref.asset)) return { state: "failed", why: "transfer-not-found" };
  const moved = logs.some(
    (l) => transferParts(l, ref.asset, TRANSFER_TOPIC) !== undefined && !isGuardTransfer(l, ref.asset),
  );
  if (moved) return s;
  if (logs.some((l) => isGuardTransfer(l, ref.asset))) return { state: "failed", why: "receive-policy-blocked" };
  return { state: "failed", why: "transfer-not-found" };
}

// ── Shared steps.

/** The checked challenge `build` answers: its id carries `h`, it offers `pairing`, and `from` is an address. */
function offerFor(choice: MppChoice, h: AtrHash, pairing: ChargeId): Checked | Refusal {
  if (!isObject(choice) || !isObject(choice.challenge)) return refusal("mpp/input-malformed");
  const checked = checkChallenge(choice.challenge, true);
  if ("refused" in checked) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  const fromId = challengeIdH(choice.challenge);
  if (typeof fromId !== "string" || typeof h !== "string" || !hashEquals(fromId, h)) return refusal("mpp/id-not-ours");
  if (!isAddress(choice.from)) return refusal("mpp/input-malformed");
  return checked;
}

/** H from an echoed challenge that offers `pairing`, with the checked challenge and the payload. */
function echoed(
  presented: MppCredential,
  pairing: ChargeId,
): { h: AtrHash; checked: Checked; payload: { [k: string]: Json } } | Refusal {
  const b = challengeBound(presented);
  if ("refused" in b) return b;
  const checked = checkChallenge(presented.challenge, true);
  if ("refused" in checked) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  return { h: b.h, checked, payload: presented.payload };
}

/** MPP's `place` for `pairing`, with the agreement URL in `opaque` when one is given. */
function advertiseAs(pairing: ChargeId) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const pairings = pairingsOf(offer);
    if ("refused" in pairings) return pairings;
    if (!pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
    return place(doc, h, link, offer, agreementUrl);
  };
}

function unplaced(option: MppChallenge): Json {
  return option as unknown as Json;
}

function chainOf(c: Checked): number {
  const id = c.details["chainId"];
  return typeof id === "number" ? id : TEMPO_DEFAULT_CHAIN;
}

/**
 * The network and channel a session challenge names for the client to resume, spelled as the pairing's `channel.ref`
 * spells it: EVM, Tempo and Hedera in `methodDetails.channelId` (a bytes32, lowercase), Solana in
 * `methodDetails.channelId` (a base58 address), XRPL in the request's `channelId` (64 hex characters, upper case). Null
 * when the challenge names no channel; refused for a challenge of no session pairing, or a channel or network that
 * cannot be read.
 */
export function sessionResume(c: MppChallenge): { network: string; channel: string } | null | Refusal {
  const method = typeof c === "object" && c !== null ? c.method : undefined;
  return method === "hedera" || method === "solana" || method === "xrpl" ? railSessionResume(c) : evmSessionResume(c);
}

/**
 * The CAIP-2 network an MPP challenge pays on, read from its method, intent and `methodDetails` as each method defines
 * it, with that method's default where it names one. A method whose challenge names no network is refused.
 */
export function network(challenge: MppChallenge): string | Refusal {
  const c = checkChallenge(challenge, true);
  if ("refused" in c) return c;
  const d = c.details;
  switch (`${c.intent}/${c.method}`) {
    case "charge/evm":
    case "charge/tempo":
      return `eip155:${chainOf(c)}`;
    case "session/evm":
    case "session/tempo":
    case "subscription/tempo":
      return sessionNetwork(challenge);
    case "charge/solana":
    case "session/solana": {
      const n = solanaNetworkOf(d, c.intent === "session");
      return n === null ? refusal("svm/network-undeclared") : n;
    }
    case "charge/xrpl":
    case "session/xrpl":
      return xrplNetworkOf(d);
    case "charge/hedera":
      return chargeHedera.network(c.request as never);
    case "session/hedera":
      return hederaSessionNetworkOf(d);
    case "charge/stellar":
      return d["network"] as string;
    case "charge/nearintents":
      return d["originNetwork"] as string;
    case "charge/usdc": {
      const profile = usdcProfile(d);
      if ("refused" in profile) return profile;
      if (profile.type === "evm") return `eip155:${profile.details["chainId"] as number}`;
      if (profile.type === "stacks") return stacksNetworkOf(d) ?? refusal("mpp/request-malformed");
      if (profile.type === "solana") {
        const n = solanaNetworkOf(profile.details, true);
        return n === null ? refusal("svm/network-undeclared") : n;
      }
      return refusal("mpp/network-unnamed");
    }
    default:
      return refusal("mpp/network-unnamed");
  }
}

function did(chainId: number, from: Hex): string {
  return `did:pkh:eip155:${chainId}:${from}`;
}

function str(v: Json | undefined): string {
  return typeof v === "string" ? v : "";
}

// ── mpp/charge/evm/authorization.

async function authorizationBuild(choice: MppChoice, h: AtrHash): Promise<MppUnsigned | Refusal> {
  const o = offerFor(choice, h, AUTHORIZATION);
  if ("refused" in o) return o;
  const td = choice.tokenDomain;
  if (!isObject(td) || typeof td.name !== "string" || td.name === "" || typeof td.version !== "string" || td.version === "") {
    return refusal("mpp/input-malformed");
  }
  const chainId = chainOf(o);
  const nonce = challengeHash(choice.challenge.id, choice.challenge.realm);
  const validBefore = BigInt(o.expires);
  const typedData = eip3009TypedData({
    network: `eip155:${chainId}`,
    asset: str(o.request["currency"]) as Hex,
    name: td.name,
    version: td.version,
    from: choice.from,
    to: str(o.request["recipient"]) as Hex,
    value: str(o.request["amount"]),
    validAfter: 0n,
    validBefore,
    nonce,
  });
  if ("refused" in typedData) return typedData;
  const challenge = { ...choice.challenge };
  const from = choice.from;
  return {
    request: { kind: "eip712", typedData },
    complete(signature: Hex): MppCredential | Refusal {
      if (!isHexBytes(signature, 65, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      return {
        challenge,
        source: did(chainId, from),
        payload: {
          type: "authorization",
          from,
          to: str(o.request["recipient"]),
          value: str(o.request["amount"]),
          validAfter: "0",
          validBefore: validBefore.toString(),
          nonce,
          signature,
        },
      };
    },
  };
}

async function authorizationBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const e = echoed(presented, AUTHORIZATION);
  if ("refused" in e) return e;
  if (e.payload["type"] !== "authorization") return refusal("mpp/credential-type");
  if (normalHash(e.payload["nonce"]) === null) return refusal("mpp/credential-malformed");
  const expect = challengeHash(presented.challenge.id, presented.challenge.realm);
  if (!sameBytes(e.payload["nonce"], expect)) return refusal("mpp/nonce-not-challenge-hash");
  return e.h;
}

async function authorizationReference(input: unknown): Promise<EvmRef | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const h = await authorizationBound(presented);
  if (typeof h !== "string") return h;
  const c = checkChallenge(presented.challenge, true) as Checked;
  const p = presented.payload;
  const value = uint256Of(p["value"]);
  const validBefore = uint256Of(p["validBefore"]);
  if (!isAddress(p["from"]) || !isAddress(p["to"]) || value === undefined || validBefore === undefined) {
    return refusal("mpp/credential-malformed");
  }
  const digest = await transferDigest({ from: p["from"], to: p["to"], value });
  if (typeof digest !== "string") return digest;
  const currency = str(c.request["currency"]) as Hex;
  const nonce = challengeHash(presented.challenge.id, presented.challenge.realm);
  return {
    network: `eip155:${chainOf(c)}`,
    settleBy: validBefore.toString(),
    bindingLog: { address: currency, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: nonce },
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
    search: { address: currency, topics: [AUTHORIZATION_USED_TOPIC, null, nonce] },
  };
}

// ── mpp/charge/evm/permit2.

async function permit2Build(choice: MppChoice, h: AtrHash): Promise<MppUnsigned | Refusal> {
  const o = offerFor(choice, h, PERMIT2_ID);
  if ("refused" in o) return o;
  if (!isAddress(choice.spender)) return refusal("mpp/input-malformed");
  const chainId = chainOf(o);
  const currency = str(o.request["currency"]) as Hex;
  const recipient = str(o.request["recipient"]) as Hex;
  const amount = BigInt(str(o.request["amount"]));
  const splits = Array.isArray(o.details["splits"])
    ? (o.details["splits"] as { recipient: Hex; amount: string }[]).map((s) => ({ to: s.recipient, amount: BigInt(s.amount) }))
    : undefined;
  const primary = amount - (splits ?? []).reduce((sum, s) => sum + s.amount, 0n);
  if (primary <= 0n) return refusal("mpp/input-malformed");
  const challengeHashValue = challengeHash(choice.challenge.id, choice.challenge.realm);
  const externalId = str(o.request["externalId"]);
  const deadline = BigInt(o.expires);
  const nonce = BigInt(challengeHashValue);
  const transfers = [{ to: recipient, amount: primary }, ...(splits ?? [])];
  const permitted = transfers.map((t) => ({ token: currency, amount: t.amount }));
  const typedData = permit2TypedData({
    chainId,
    permitted: splits === undefined ? permitted[0]! : permitted,
    spender: choice.spender,
    nonce,
    deadline,
    verifyingContract: (o.details["permit2Address"] as Hex | undefined) ?? PERMIT2,
    witness: {
      type: "PaymentWitness",
      fields: PAYMENT_WITNESS,
      value: { challengeHash: challengeHashValue, externalId },
    },
  });
  if ("refused" in typedData) return typedData;
  const challenge = { ...choice.challenge };
  const from = choice.from;
  return {
    request: { kind: "eip712", typedData },
    complete(signature: Hex): MppCredential | Refusal {
      if (!isHexBytes(signature, 65, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      return {
        challenge,
        source: did(chainId, from),
        payload: {
          type: "permit2",
          permit: {
            permitted: permitted.map((p) => ({ token: p.token, amount: p.amount.toString() })),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          transferDetails: transfers.map((t) => ({ to: t.to, requestedAmount: t.amount.toString() })),
          witness: { challengeHash: challengeHashValue, externalId },
          signature,
        },
      };
    },
  };
}

async function permit2Bound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const e = echoed(presented, PERMIT2_ID);
  if ("refused" in e) return e;
  if (e.payload["type"] !== "permit2") return refusal("mpp/credential-type");
  const w = e.payload["witness"];
  if (!isObject(w) || normalHash(w["challengeHash"]) === null) return refusal("mpp/credential-malformed");
  const expect = challengeHash(presented.challenge.id, presented.challenge.realm);
  if (!sameBytes(w["challengeHash"], expect)) return refusal("mpp/witness-not-challenge-hash");
  return e.h;
}

async function permit2Reference(input: unknown): Promise<EvmRef | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const h = await permit2Bound(presented);
  if (typeof h !== "string") return h;
  const c = checkChallenge(presented.challenge, true) as Checked;
  const from = didPkhAddress(presented.source);
  if (from === undefined) return refusal("mpp/source-required");
  const p = presented.payload;
  const permit = p["permit"];
  const details = p["transferDetails"];
  const deadline = isObject(permit) ? uint256Of(permit["deadline"]) : undefined;
  const first = Array.isArray(details) && details.length > 0 && isObject(details[0]) ? details[0] : undefined;
  const value = first === undefined ? undefined : uint256Of(first["requestedAmount"]);
  if (deadline === undefined || first === undefined || !isAddress(first["to"]) || value === undefined) {
    return refusal("mpp/credential-malformed");
  }
  const digest = await transferDigest({ from, to: first["to"], value });
  if (typeof digest !== "string") return digest;
  const currency = str(c.request["currency"]) as Hex;
  return {
    network: `eip155:${chainOf(c)}`,
    settleBy: deadline.toString(),
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
  };
}

// ── mpp/charge/evm/transaction and mpp/charge/evm/hash.

function evmCallBuild(pairing: typeof TRANSACTION | typeof HASH) {
  return async (choice: MppChoice, h: AtrHash): Promise<MppUnsigned | Refusal> => {
    const o = offerFor(choice, h, pairing);
    if ("refused" in o) return o;
    const chainId = chainOf(o);
    const data = hexOf(
      concat([
        bytesOf(TRANSFER_SELECTOR)!,
        addressWord(str(o.request["recipient"]) as Hex),
        uintWord(BigInt(str(o.request["amount"]))),
      ]),
    );
    const challenge = { ...choice.challenge };
    const source = did(chainId, choice.from);
    const broadcast = pairing === HASH;
    return {
      request: { kind: "evm-call", chainId, call: { to: str(o.request["currency"]) as Hex, data }, broadcast },
      complete(signedTxOrHash: Hex): MppCredential | Refusal {
        if (broadcast) {
          const hash = normalHash(signedTxOrHash);
          if (hash === null) return refusal("mpp/credential-malformed");
          return { challenge, source, payload: { type: "hash", hash: signedTxOrHash } };
        }
        if (!isHexBytes(signedTxOrHash, 1, MAX_WIRE)) return refusal("mpp/credential-malformed");
        return { challenge, source, payload: { type: "transaction", signature: signedTxOrHash } };
      },
    };
  };
}

async function noSignedPlace(presented: unknown): Promise<AtrHash | Refusal> {
  const b = challengeBound(presented);
  if ("refused" in b) return b;
  return refusal("mpp/no-signed-place");
}

/**
 * The read keys of a payment with no claim, from the challenge alone: the network, and `asset` = the challenge's
 * `currency`, the token whose transfer `transferPresent` reads. Nothing signed was presented.
 */
async function networkReference(presented: unknown): Promise<(EvmRef & { asset: Hex }) | Refusal> {
  const challenge = isObject(presented) ? presented["challenge"] : undefined;
  if (!isObject(challenge)) return refusal("mpp/credential-malformed");
  const c = checkChallenge(challenge, true);
  if ("refused" in c) return c;
  if (c.method !== "evm" || c.intent !== "charge") return refusal("mpp/not-this-pairing");
  return { network: `eip155:${chainOf(c)}`, asset: str(c.request["currency"]) as Hex };
}

// ── mpp/charge/tempo/memo and mpp/charge/tempo/push.

function tempoBuild(pairing: typeof MEMO | typeof PUSH) {
  return async (choice: MppChoice, h: AtrHash): Promise<MppUnsigned | Refusal> => {
    const o = offerFor(choice, h, pairing);
    if ("refused" in o) return o;
    if (choice.clientId !== undefined && typeof choice.clientId !== "string") return refusal("mpp/input-malformed");
    const chainId = chainOf(o);
    const memo = attributionMemo(choice.challenge.realm, choice.challenge.id, choice.clientId);
    const data = memoCalldata(str(o.request["recipient"]) as Hex, BigInt(str(o.request["amount"])), memo);
    if (typeof data !== "string") return data;
    const challenge = { ...choice.challenge };
    const source = did(chainId, choice.from);
    const broadcast = pairing === PUSH;
    return {
      request: {
        kind: "tempo-call",
        chainId,
        call: { to: str(o.request["currency"]) as Hex, data },
        validBefore: o.expires,
        broadcast,
      },
      complete(signedTxOrHash: Hex): MppCredential | Refusal {
        if (broadcast) {
          if (normalHash(signedTxOrHash) === null) return refusal("mpp/credential-malformed");
          return { challenge, source, payload: { type: "hash", hash: signedTxOrHash } };
        }
        if (!isHexBytes(signedTxOrHash, 1, MAX_WIRE)) return refusal("mpp/credential-malformed");
        return { challenge, source, payload: { type: "transaction", signature: signedTxOrHash } };
      },
    };
  };
}

/** The one signed `transferWithMemo` call to `currency` whose memo is this challenge's attribution memo. */
function signedMemoCall(
  presented: MppCredential,
): { h: AtrHash; checked: Checked; memo: Hex; to: Hex; value: bigint; validBefore: bigint | null } | Refusal {
  const e = echoed(presented, MEMO);
  if ("refused" in e) return e;
  if (e.payload["type"] !== "transaction") return refusal("mpp/credential-type");
  const sig = e.payload["signature"];
  if (typeof sig !== "string" || sig.length % 2 !== 0 || !/^0x[0-9a-fA-F]*$/.test(sig)) {
    return refusal("mpp/credential-malformed");
  }
  if ((sig.length - 2) / 2 > MAX_WIRE) return refusal("tempo/tx-too-large");
  const tx = decodeTempoTx(bytesOf(sig)!);
  if ("refused" in tx) return tx;
  const currency = str(e.checked.request["currency"]);
  const { realm, id } = presented.challenge;
  const found: { memo: Hex; to: Hex; value: bigint }[] = [];
  for (const call of tx.calls) {
    if (call.to === null || !sameBytes(call.to, currency) || call.input.length !== 100) continue;
    if (hexOf(call.input.subarray(0, 4)) !== TRANSFER_WITH_MEMO_SELECTOR) continue;
    if (call.input.subarray(4, 16).some((x) => x !== 0)) continue;
    const memo = hexOf(call.input.subarray(68, 100));
    if (checkAttribution(memo, realm, id) !== true) continue;
    found.push({ memo, to: hexOf(call.input.subarray(16, 36)), value: uintOf(call.input.subarray(36, 68)) });
  }
  if (found.length === 0) return refusal("tempo/memo-not-bound");
  if (found.length > 1) return refusal("tempo/ambiguous");
  return { h: e.h, checked: e.checked, ...found[0]!, validBefore: tx.validBefore };
}

async function memoBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const m = signedMemoCall(presented);
  return "refused" in m ? m : m.h;
}

async function memoReference(input: unknown): Promise<EvmRef | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const m = signedMemoCall(presented);
  if ("refused" in m) return m;
  return memoRef(m.checked, m.memo, m.to, m.value, m.validBefore ?? BigInt(m.checked.expires));
}

async function memoRef(c: Checked, memo: Hex, to: Hex, value: bigint, settleBy?: bigint): Promise<EvmRef | Refusal> {
  const digest = await transferDigest({ to, value });
  if (typeof digest !== "string") return digest;
  const currency = str(c.request["currency"]) as Hex;
  return {
    network: `eip155:${chainOf(c)}`,
    ...(settleBy === undefined ? {} : { settleBy: settleBy.toString() }),
    bindingLog: { address: currency, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: memo },
    transferLog: { address: currency, topic0: TRANSFER_WITH_MEMO_TOPIC, identity: "to,value", digest },
    search: { address: currency, topics: [TRANSFER_WITH_MEMO_TOPIC, null, null, memo] },
  };
}

/**
 * Reads the pushed transaction's receipt and returns the credential with `landed`: the transaction, its block and
 * the receipt's logs from `currency`. No receipt is `tempo/not-found`, a failed read `tempo/unreadable`, and a revert
 * `tempo/reverted`; each is a read to repeat, not a refusal of the payment.
 */
async function pushFetchPresented(presented: MppCredential, reader: EvmReader): Promise<LandedCredential | Refusal> {
  if (!isObject(presented) || !isObject(presented.payload) || !isObject(presented.challenge)) {
    return refusal("mpp/credential-malformed");
  }
  if (presented.payload["type"] !== "hash") return refusal("mpp/credential-type");
  const hash = normalHash(presented.payload["hash"]);
  if (hash === null) return refusal("mpp/credential-malformed");
  const c = checkChallenge(presented.challenge, true);
  if ("refused" in c) return c;
  const receipt = await readReceipt(`eip155:${chainOf(c)}`, hash, reader);
  if ("refused" in receipt) return receipt;
  const currency = str(c.request["currency"]);
  const logs = receipt.logs.filter((l) => sameBytes(l.address, currency));
  return { ...presented, landed: { transaction: hash, blockNumber: receipt.blockNumber, logs } };
}

/** The one landed `TransferWithMemo` from `currency` whose memo topic is this challenge's attribution memo. */
function landedMemoLog(presented: MppCredential): { h: AtrHash; checked: Checked; log: EvmLog } | Refusal {
  const e = echoed(presented, PUSH);
  if ("refused" in e) return e;
  if (e.payload["type"] !== "hash") return refusal("mpp/credential-type");
  const landed = (presented as Partial<LandedCredential>).landed;
  if (!isObject(landed) || !Array.isArray(landed.logs)) return refusal("mpp/credential-malformed");
  const currency = str(e.checked.request["currency"]) as Hex;
  const { realm, id } = presented.challenge;
  const found = landed.logs.filter(
    (l) =>
      isObject(l) &&
      Array.isArray(l.topics) &&
      l.topics.length === 4 &&
      sameBytes(l.address, currency) &&
      sameBytes(l.topics[0], TRANSFER_WITH_MEMO_TOPIC) &&
      typeof l.topics[3] === "string" &&
      checkAttribution(l.topics[3], realm, id) === true,
  );
  if (found.length === 0) return refusal("tempo/memo-not-bound");
  if (found.length > 1) return refusal("tempo/ambiguous");
  return { h: e.h, checked: e.checked, log: found[0]! };
}

async function pushBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const m = landedMemoLog(presented);
  return "refused" in m ? m : m.h;
}

async function pushReference(input: unknown): Promise<EvmRef | Refusal> {
  const presented = credentialOf(input);
  if ("refused" in presented) return presented;
  const m = landedMemoLog(presented);
  if ("refused" in m) return m;
  const currency = str(m.checked.request["currency"]) as Hex;
  const parts = transferParts(m.log, currency, TRANSFER_WITH_MEMO_TOPIC);
  if (parts === undefined) return refusal("mpp/credential-malformed");
  return memoRef(m.checked, normalHash(m.log.topics[3])!, parts.to, parts.value);
}

// ── The records.

const LIMIT = "This does not show that amount, payee, asset or timing match the ATR's content.";

function pattern(p: Omit<LcpPattern, "canonical" | "zeroPartyRecoverable" | "forwardIndexable">): LcpPattern {
  return deepFreeze({ ...p, canonical: true, zeroPartyRecoverable: false, forwardIndexable: false });
}

const MEMO_PROVES =
  "The ATR's hash is in the MPP challenge this payment answered: its id is the hash in base64url with the " +
  "challenge's position, protected by the server's binding of the challenge. The payer signed a Tempo transaction " +
  "whose transferWithMemo call carries MPP's attribution memo, whose 7-byte nonce is keccak256 of that id. The chain " +
  "verified the signature when it executed the call, and the memo is on chain as the memo topic of the token's " +
  "TransferWithMemo event. It ties the payment to the challenge instance, and binds this ATR's hash only through those " +
  "7 bytes: whoever assembles the ATR can construct a second ATR whose challenge id gives the same 7 bytes. " +
  LIMIT;

const PUSH_PROVES =
  "The ATR's hash is in the MPP challenge this payment answered: its id is the hash in base64url with the " +
  "challenge's position, protected by the server's binding of the challenge. The payer signed and broadcast a Tempo " +
  "transaction whose transferWithMemo call carries MPP's attribution memo, whose 7-byte nonce is keccak256 of that " +
  "id. The chain verified the signature when it executed the call, and the memo is on chain as the memo topic of " +
  "the token's TransferWithMemo event, read after the money had moved. It ties the payment to the challenge " +
  "instance, and binds this ATR's hash only through those 7 bytes: whoever assembles the ATR can construct a second " +
  "ATR whose challenge id gives the same 7 bytes. " +
  LIMIT;

const CALL_PROVES =
  "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
  "recorded in <transaction>. The payment is an ERC-20 transfer the buyer signed as a whole transaction " +
  "(`transaction`), or broadcast itself and named by its hash (`hash`), answering a challenge whose id and opaque " +
  "carry this ATR's hash. The payment transaction does not carry the hash; the seller's server bound the challenge, " +
  "and the settlement transaction it reported succeeded and moved the token. " +
  LIMIT;

export const evmAuthorization = Object.freeze({
  id: AUTHORIZATION,
  pattern: pattern({
    pattern: "id-reuse",
    buyerSigns: true,
    onChain: true,
    publicProof: true,
    proves:
      "The payer signed an EIP-3009 transfer authorization whose nonce is keccak256 of this challenge's id and " +
      "realm, and the id is this ATR's hash in base64url with the challenge's position. The token contract verified " +
      "the signature when it executed the transfer, and the nonce is on chain as the nonce topic of its " +
      "AuthorizationUsed event. A holder of the ATR and the realm can confirm the hash from that nonce; the chain " +
      "alone does not reveal it. " +
      LIMIT,
  }),
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(AUTHORIZATION),
  read,
  build: authorizationBuild,
  bound: authorizationBound,
  reference: authorizationReference,
  status: evmStatus,
});

export const evmPermit2 = Object.freeze({
  id: PERMIT2_ID,
  pattern: pattern({
    pattern: "id-reuse",
    buyerSigns: true,
    onChain: true,
    publicProof: true,
    proves:
      "The payer signed a Permit2 transfer, single or batch, whose witness carries keccak256 of this challenge's id " +
      "and realm, and the id is this ATR's hash in base64url with the challenge's position. Permit2 verified the " +
      "signature when it executed the transfer; a batch's transfers all executed in that one call. The witness is in " +
      "the settlement transaction's calldata only as a hash, and no event carries it. This does not show that " +
      "amount, payee, asset, splits or timing match the ATR's content.",
  }),
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(PERMIT2_ID),
  read,
  build: permit2Build,
  bound: permit2Bound,
  reference: permit2Reference,
  status: evmStatus,
});

export const evmTransaction = Object.freeze({
  id: TRANSACTION,
  pattern: pattern({
    pattern: "opaque-challenge",
    buyerSigns: false,
    onChain: false,
    publicProof: false,
    proves: CALL_PROVES,
  }),
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(TRANSACTION),
  read,
  build: evmCallBuild(TRANSACTION),
  bound: noSignedPlace,
  reference: networkReference,
  status: transferPresent,
});

export const evmHash = Object.freeze({
  id: HASH,
  pattern: pattern({
    pattern: "opaque-challenge",
    buyerSigns: false,
    onChain: false,
    publicProof: false,
    proves: CALL_PROVES,
  }),
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(HASH),
  read,
  build: evmCallBuild(HASH),
  bound: noSignedPlace,
  reference: networkReference,
  status: transferPresent,
});

export const tempoMemo = Object.freeze({
  id: MEMO,
  pattern: pattern({
    pattern: "opaque-challenge",
    buyerSigns: false,
    onChain: false,
    publicProof: true,
    proves: MEMO_PROVES,
  }),
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(MEMO),
  read,
  build: tempoBuild(MEMO),
  bound: memoBound,
  reference: memoReference,
  status: evmStatus,
});

export const tempoPush = Object.freeze({
  id: PUSH,
  pattern: pattern({
    pattern: "opaque-challenge",
    buyerSigns: false,
    onChain: false,
    publicProof: true,
    proves: PUSH_PROVES,
  }),
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(PUSH),
  read,
  build: tempoBuild(PUSH),
  bound: pushBound,
  reference: pushReference,
  landedTx: (presented: unknown): string | undefined => {
    const hash = pushedField(presented, "hash", "hash");
    return hash === undefined ? undefined : (normalHash(hash) ?? undefined);
  },
  status: evmStatus,
  fetchPresented: pushFetchPresented,
});

/** Every MPP pairing this entry point implements. */
export const MPP_BINDINGS = Object.freeze([
  evmAuthorization,
  evmPermit2,
  evmTransaction,
  evmHash,
  tempoMemo,
  tempoPush,
  sessionEvm,
  sessionTempo,
  subscriptionTempo,
  chargeLightning,
  sessionLightning,
  chargeHedera,
  chargeSolana,
  chargeStellar,
  chargeXrpl,
  chargeNearIntents,
  sessionHedera,
  sessionSolana,
  sessionXrpl,
  chargeCard,
  chargeStripe,
  subscriptionStripe,
  chargeUsdcEvm,
  chargeUsdcSolana,
  chargeUsdcStacks,
  chargeUsdcGateway,
] as const);
