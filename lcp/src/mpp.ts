/**
 * The `mpp` entry point: MPP's challenge pieces and its pairings: the EVM charges, defined here, and every other MPP
 * charge, session and subscription pairing but Lightning's, re-exported from its module.
 *
 * The EVM charges are `authorization` (the signed nonce is keccak256 of the JSON array [id, realm]), `permit2` (the
 * signed witness carries that value), and `transaction` and `hash` (nothing signed carries H). The re-exported charges
 * are the card, Stripe, Solana, XRP Ledger, NEAR Intents, `usdc`, `lcp` and Tempo split-memo charges. `FETCHED` is the
 * key under which a pairing's `fetchPresented` writes the seller's read onto a credential.
 *
 * @module
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import { addressWord, bytes32Word, bytesOf, concat, hexOf, keccak, keccakHex, sameBytes, uintWord, type Hex } from "./evm-abi.js";
import {
  AUTHORIZATION_USED_TOPIC,
  TRANSFER_TOPIC,
  eip3009TypedData,
  permit2TypedData,
  transferDigest,
  PERMIT2,
  type EvmBreadthStatus,
  type EvmLog,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type Eip3009TypedData,
  type Permit2TypedData,
  type TransferLog,
} from "./evm.js";
import { isAddress, normalHash, uint256Of } from "./fields.js";
import {
  byType,
  mppBroadcaster,
  challengeH,
  challengeHash,
  checkChallenge,
  checkedFor,
  chosenHeld,
  credentialOf,
  decodeObject,
  deepFreeze,
  didPkhAddress,
  pairingsOfPlaced,
  echoedFor,
  echoedOf,
  expiresOf,
  FETCHED,
  isChallengeShape,
  isHexBytes,
  isObject,
  measured,
  pairingsOf,
  place,
  read,
  requestAddress,
  tie,
  type Checked,
  type Chosen,
  type Echoed,
  type MppChallenge,
  type MppChoice,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import { chargeCard, chargeStripe, subscriptionStripe } from "./mpp-card-stripe.js";
import { stacksNetworkOf, usdcProfile } from "./mpp-method-checks.js";
import { chargeNearIntents } from "./mpp-nearintents.js";
import { chargeUsdcEvm, chargeUsdcGateway, chargeUsdcSolana, chargeUsdcStacks } from "./mpp-usdc.js";
import { evmSessionResume, sessionEvm, sessionNetwork, sessionTempo, subscriptionTempo } from "./mpp-session.js";
import { solanaNetworkOf, xrplNetworkOf } from "./mpp-rail-checks.js";
import { chargeLightning, sessionLightning } from "./lightning.js";
import { railSessionResume, sessionXrpl, sessionXrplStock } from "./mpp-session-rails.js";
import { hederaSessionResume, sessionHederaStock } from "./hedera-session.js";
import { chargeSolana, chargeSolanaUnsponsored } from "./mpp-solana.js";
import { subscriptionSolana } from "./mpp-subscription-solana.js";
import { sessionSolanaMemo, sessionSolanaStock, solanaSessionResume } from "./mpp-session-solana.js";
import { tempoSplitMemo, tempoSplitMemoPush } from "./mpp-tempo.js";
import { chargeXrpl } from "./mpp-xrpl.js";
import { chargeLcpHedera } from "./mpp-lcp-hedera.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { rlpDecode, rlpUint } from "./rlp.js";
import { withPayee, type EvmQuery } from "./internal/evm.js";
import {
  echoesOption,
  eip3009Presented,
  mppEip3009Status,
  mppNamedStatus,
  mppPermit2Status,
  type MppEip3009Ref,
  type MppEvmReader,
  type MppEvmStatus,
  type MppNamedRef,
  type MppPermit2Ref,
} from "./internal/mpp-evm-read.js";
import { mppPayee } from "./internal/payee.js";
import type { LcpPattern } from "./x402.js";
import { MAX_CHALLENGES, MAX_SIGNATURE_BYTES } from "./internal/bounds.js";
import { EIP155_TEMPO_MPP } from "./internal/data/eip155-tempo-mpp.js";
import type { Act } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";

export {
  CARRIER,
  FETCHED,
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
export type { MppChallenge, MppChoice, MppCredential, MppMethod, MppPairingId } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export { LEGAL_CONTEXT_METADATA_KEY, chargeCard, chargeStripe, subscriptionStripe } from "./mpp-card-stripe.js";
export type { StripeSubscriptionReceipt } from "./mpp-card-stripe.js";
export {
  chargeUsdcEvm,
  chargeUsdcGateway,
  chargeUsdcSolana,
  chargeUsdcStacks,
  usdcGatewaySalt,
  usdcNonce,
  usdcRequestHash,
  type GatewayPreimage,
  type GatewaySaltInput,
  type UsdcUnsigned,
} from "./mpp-usdc.js";
export { chargeNearIntents } from "./mpp-nearintents.js";
export { toX402, type TokenDomain, type X402Mapped } from "./mpp-x402.js";
export type { EvmLogEntry, EvmSearchReader } from "./internal/evm-search.js";
export type {
  EvmMoved,
  MppEip3009Ref,
  MppEvmReader,
  MppEvmStatus,
  MppNamedRef,
  MppPermit2Ref,
  Presentation,
} from "./internal/mpp-evm-read.js";
export { chargeSolana, chargeSolanaUnsponsored } from "./mpp-solana.js";
export { subscriptionSolana } from "./mpp-subscription-solana.js";
export { sessionSolanaMemo, sessionSolanaStock, type SolanaSessionChoice, type SolanaSessionUnsigned } from "./mpp-session-solana.js";
export {
  tempoSplitMemo,
  tempoSplitMemoPush,
  type TempoLandedCredential,
  type TempoSplitLanded,
  type TempoSplitQuery,
  type TempoSplitRef,
  type TempoSplitStatus,
} from "./mpp-tempo.js";
export { chargeXrpl, type XrplChargeChoice, type XrplChargeUnsigned } from "./mpp-xrpl.js";
export {
  chargeLcpHedera,
  type LcpHederaChoice,
  type LcpHederaLanded,
  type LcpHederaRef,
  type LcpHederaUnsigned,
} from "./mpp-lcp-hedera.js";
export type { LcpRail, LcpValidation } from "./mpp-lcp.js";
export {
  sessionXrpl,
  sessionXrplStock,
  type RailSessionUnsigned,
  type SolanaTablesCredential,
} from "./mpp-session-rails.js";
export {
  hederaStockStatus,
  sessionHederaStock,
  type HederaStockReader,
  type HederaStockRef,
  type HederaStockStatus,
} from "./hedera-session.js";
export {
  evmChannelId,
  evmSessionAuthorizationNonce,
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
  VoucherTypedData,
  WithinSigningRequest,
} from "./mpp-session.js";
/**
 * What the buyer's signer is handed for each EVM charge, and how its answer completes the credential. Each
 * `complete` measures the credential it would return as `bound` measures every credential, its echoed challenge
 * included, and refuses one over the credential size bound, 64 KiB, with `mpp/credential-malformed`, the code `bound`
 * gives it.
 */
export type MppUnsigned =
  | {
      request: { kind: "eip712"; typedData: Eip3009TypedData | Permit2TypedData };
      complete(signature: Hex): MppCredential | Refusal;
    }
  | {
      /**
       * An EIP-1559 transaction of the call, or its hash once broadcast. Unbroadcast, `complete` takes the signed
       * transaction: one that is not 1 to 65,536 bytes of hex, or whose credential is over the credential size bound,
       * is `mpp/credential-malformed`, the code `bound` gives that credential before its verdict,
       * `mpp/no-signed-place`; then one that is not an EIP-1559 transaction (`0x02` and the RLP list of its twelve
       * fields) is `mpp/credential-malformed`, and one signed for a chain other than `chainId` is `evm/chain-mismatch`.
       */
      request: { kind: "evm-call"; chainId: number; call: { to: Hex; data: Hex }; broadcast: boolean };
      complete(signedTxOrHash: Hex): MppCredential | Refusal;
    };

/**
 * A push credential with a landed EVM transaction, its block and its receipt's logs under `FETCHED`. No pairing's
 * `fetchPresented` in this package writes it.
 */
export interface LandedCredential extends MppCredential {
  [FETCHED]: { transaction: Hex; blockNumber: bigint; logs: readonly EvmLog[] };
}

const AUTHORIZATION = "mpp/charge/evm/authorization" as const;
const PERMIT2_ID = "mpp/charge/evm/permit2" as const;
const TRANSACTION = "mpp/charge/evm/transaction" as const;
const HASH = "mpp/charge/evm/hash" as const;
type ChargeId = typeof AUTHORIZATION | typeof PERMIT2_ID | typeof TRANSACTION | typeof HASH;

const TEMPO_DEFAULT_CHAIN = 42431;
const MAX_WIRE = 65_536;
const TRANSFER_SELECTOR = "0xa9059cbb";
const PAYMENT_WITNESS = [
  { name: "challengeHash", type: "bytes32" },
  { name: "externalId", type: "string" },
] as const;

// ── Settlement for the pairings whose payment carries nothing signed.

/**
 * The `status` of the EVM `transaction` and `hash` charges, whose data both give coverage `none`: the act is the
 * transaction the reference names, which the credential carries (`transaction`, by the hash of its signed bytes) or
 * names (`hash`). Found, it is read whole: its signer, the transaction's `from`, against the reference's payer and the
 * option's payee, so that one the payee signed is no act of the payer's; what it moved, each `Transfer` from its signer
 * by its log, with its token, amount and recipient, never the system emitter's log that Arc adds beside each USDC
 * transfer; the account test, a transfer to the challenge's `recipient`, its token and amount compared with nothing,
 * and for a reverted one, which moved nothing, the recipient of the `transfer` call that is the transaction's own; and
 * its result, the payer's account nonce consumed by its inclusion. So a reverted one whose call pays the `recipient` is
 * `failed`, `transaction-failed`, any other reverted one `failed`, `instrument-consumed`, and one that succeeded with no
 * transfer to the `recipient` `failed`, `instrument-consumed`, `other-account`, each at the final mark, and `pending`,
 * `below-mark`, under it. Not
 * found, it is `pending`, `not-found`, where the reader shows it holds the history the transaction would be in: an
 * endpoint the seller declares archival (`archival`), or one that answers a read at the position the caller gives;
 * otherwise `unreadable`, `history-gap`. `settled` states `presented: "yes"`, the act being the transaction the
 * credential names.
 */
export async function transferPresent(ref: MppNamedRef, reader: MppEvmReader, query: EvmQuery<unknown>): Promise<MppEvmStatus> {
  return mppNamedStatus(ref, reader, query);
}

// ── Shared steps.

/**
 * The checked challenge `build` answers: a choice that is an object (else `mpp/input-malformed`), whose challenge is
 * held as `bound` holds an echoed one (`chosenHeld`), with `bound`'s code for each fault in it, and whose id carries
 * `h`; then `from` an address. `build` reads the challenge from the snapshot `chosenHeld` returns, and its credential
 * carries that snapshot.
 */
function offerFor(choice: MppChoice, h: AtrHash, pairing: ChargeId): Chosen | Refusal {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const held = chosenHeld(choice.challenge, pairing);
  if (isRefusal(held)) return held;
  if (typeof h !== "string" || !hashEquals(held.h, h)) return refusal("mpp/id-not-ours");
  if (!isAddress(choice.from)) return refusal("mpp/input-malformed");
  return held.checked;
}

/** H from an echoed challenge of `pairing`'s intent and method, with the echoed challenge and the payload. */
function echoed(
  presented: MppCredential,
  pairing: ChargeId,
): { h: AtrHash; checked: Echoed; payload: { [k: string]: Json } } | Refusal {
  return echoedFor(presented, pairing);
}

/** MPP's `place` for `pairing`, with the agreement URL in `opaque` when one is given, and the act. */
function advertiseAs(pairing: ChargeId) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    position: number | null,
    act?: Act,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const pairings = pairingsOf(offer);
    if (isRefusal(pairings)) return pairings;
    if (!pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
    return place(doc, h, link, offer, position, act, agreementUrl);
  };
}

/**
 * The challenge as given: the hash rides in the challenge id and `opaque`, never in `request`. A challenge that carries
 * a `refused` member is `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: MppChallenge): Json | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("mpp/challenge-malformed");
  return option as unknown as Json;
}

function chainOf(c: Checked): number {
  const id = c.details["chainId"];
  return typeof id === "number" ? id : TEMPO_DEFAULT_CHAIN;
}

/**
 * The chain an echoed EVM or Tempo charge pays on: `methodDetails.chainId`, a positive integer, or on Tempo, when it is
 * absent, Tempo's default. Anything else is `mpp/request-malformed`.
 */
function echoedChain(e: Echoed): number | Refusal {
  const id = e.details["chainId"];
  if (id === undefined && e.challenge.method === "tempo") return TEMPO_DEFAULT_CHAIN;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : refusal("mpp/request-malformed");
}

/**
 * The network and channel a session challenge names for the client to resume, spelled as the pairing's `channel.ref`
 * spells it: EVM, Tempo and Hedera in `methodDetails.channelId` (a bytes32, lowercase), XRPL in the request's
 * `channelId` (64 hex characters, upper case). Null
 * when the challenge names no channel; refused for a challenge of no session pairing, or a channel or network that
 * cannot be read.
 */
export function sessionResume(c: MppChallenge): { network: string; channel: string } | null | Refusal {
  const method = typeof c === "object" && c !== null ? c.method : undefined;
  if (method === "solana") return solanaSessionResume(c);
  if (method === "hedera") return hederaSessionResume(c);
  return method === "xrpl" ? railSessionResume(c) : evmSessionResume(c);
}

/**
 * The CAIP-2 network an MPP challenge pays on, read from its method, intent and `methodDetails` as each method defines
 * it, with that method's default where it names one. A method whose challenge names no network is refused.
 */
export function network(challenge: MppChallenge): string | Refusal {
  const c = checkChallenge(challenge, true);
  if (isRefusal(c)) return c;
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
    case "subscription/solana": {
      const n = solanaNetworkOf(d, false);
      return n === null ? refusal("svm/network-undeclared") : n;
    }
    case "session/solana": {
      const n = solanaNetworkOf(c.request, false);
      return n === null ? refusal("svm/network-undeclared") : n;
    }
    case "charge/xrpl":
    case "session/xrpl":
      return xrplNetworkOf(d);
    case "charge/nearintents":
      return d["originNetwork"] as string;
    case "charge/lcp":
      return d["network"] as string;
    case "charge/usdc": {
      const profile = usdcProfile(d);
      if (isRefusal(profile)) return profile;
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
  if (isRefusal(o)) return o;
  const td = choice.tokenDomain;
  if (!isObject(td) || typeof td.name !== "string" || td.name === "" || typeof td.version !== "string" || td.version === "") {
    return refusal("mpp/input-malformed");
  }
  const chainId = chainOf(o);
  const nonce = challengeHash(o.challenge.id, o.challenge.realm);
  const expires = expiresOf(o);
  if (isRefusal(expires)) return expires;
  const validBefore = BigInt(expires);
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
  if (isRefusal(typedData)) return typedData;
  const challenge = o.challenge;
  const from = choice.from;
  return {
    request: { kind: "eip712", typedData },
    complete(signature: Hex): MppCredential | Refusal {
      if (!isHexBytes(signature, 1, MAX_SIGNATURE_BYTES)) return refusal("mpp/credential-malformed");
      return measured({
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
      });
    },
  };
}

function authorizationBinding(presented: MppCredential): { h: AtrHash; checked: Echoed } | Refusal {
  const e = echoed(presented, AUTHORIZATION);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "authorization") return refusal("mpp/credential-type");
  if (normalHash(e.payload["nonce"]) === null) return refusal("mpp/credential-malformed");
  const expect = challengeHash(presented.challenge.id, presented.challenge.realm);
  if (!sameBytes(e.payload["nonce"], expect)) return refusal("mpp/nonce-not-challenge-hash");
  return { h: e.h, checked: e.checked };
}

async function authorizationBound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const b = authorizationBinding(presented);
  return isRefusal(b) ? b : b.h;
}

/**
 * The read keys of an EIP-3009 charge, with the payee of `option`, the issued challenge the payment answers
 * (`mppPayee`): a refusal of the payment first, then the challenge's, then `mpp/challenge-not-option` where `option`
 * is not the challenge the credential echoes (`echoesOption`).
 */
async function authorizationReference(input: unknown, option: MppChallenge): Promise<(EvmRef & MppEip3009Ref) | Refusal> {
  return optionHeld(input, option, withPayee(await authorizationKeys(input), mppPayee(option)));
}

/** `ref` where `option` is the challenge the presented credential echoes, else the refusal of `ref` or of `option`. */
async function optionHeld<R>(input: unknown, option: MppChallenge, ref: R | Refusal): Promise<R | Refusal> {
  if (isRefusal(ref)) return ref;
  const held = await echoesOption((input as MppCredential).challenge, option);
  return held === true ? ref : held;
}

async function authorizationKeys(input: unknown): Promise<(Omit<EvmRef, "payee"> & Omit<MppEip3009Ref, "payee">) | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const b = authorizationBinding(presented);
  if (isRefusal(b)) return b;
  const currency = requestAddress(b.checked, "currency");
  if (isRefusal(currency)) return currency;
  const chainId = echoedChain(b.checked);
  if (isRefusal(chainId)) return chainId;
  const p = presented.payload;
  const value = uint256Of(p["value"]);
  const validBefore = uint256Of(p["validBefore"]);
  if (!isAddress(p["from"]) || !isAddress(p["to"]) || value === undefined || validBefore === undefined) {
    return refusal("mpp/credential-malformed");
  }
  const digest = await transferDigest({ from: p["from"], to: p["to"], value });
  if (typeof digest !== "string") return digest;
  const nonce = challengeHash(presented.challenge.id, presented.challenge.realm);
  return {
    network: `eip155:${chainId}`,
    settleBy: validBefore.toString(),
    bindingLog: { address: currency, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: nonce },
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
    search: { address: currency, topics: [AUTHORIZATION_USED_TOPIC, null, nonce] },
    authorization: { scheme: "eip3009", at: currency, nonce, deadline: validBefore.toString(), asset: currency },
    payer: p["from"].toLowerCase() as Hex,
    presented: eip3009Presented(currency, p["from"], p["to"], value, nonce),
  };
}

/** The account whose signature authorises the pull: the authorization's `from`, which its signed message holds, lowercase. */
async function authorizationAuthorizer(input: unknown): Promise<Hex | Refusal> {
  const h = await authorizationBound(input);
  if (typeof h !== "string") return h;
  const from = (input as MppCredential).payload["from"];
  return isAddress(from) ? (from.toLowerCase() as Hex) : refusal("mpp/credential-malformed");
}

// ── mpp/charge/evm/permit2.

async function permit2Build(choice: MppChoice, h: AtrHash): Promise<MppUnsigned | Refusal> {
  const o = offerFor(choice, h, PERMIT2_ID);
  if (isRefusal(o)) return o;
  if (!isAddress(choice.spender)) return refusal("mpp/input-malformed");
  const chainId = chainOf(o);
  const currency = str(o.request["currency"]) as Hex;
  const recipient = str(o.request["recipient"]) as Hex;
  const amount = BigInt(str(o.request["amount"]));
  const splits = Array.isArray(o.details["splits"])
    ? (o.details["splits"] as { recipient: Hex; amount: string }[]).map((s) => ({ to: s.recipient, amount: BigInt(s.amount) }))
    : undefined;
  const primary = amount - (splits ?? []).reduce((sum, s) => sum + s.amount, 0n);
  const challengeHashValue = challengeHash(o.challenge.id, o.challenge.realm);
  const externalId = str(o.request["externalId"]);
  const expires = expiresOf(o);
  if (isRefusal(expires)) return expires;
  const deadline = BigInt(expires);
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
  if (isRefusal(typedData)) return typedData;
  const challenge = o.challenge;
  const from = choice.from;
  return {
    request: { kind: "eip712", typedData },
    complete(signature: Hex): MppCredential | Refusal {
      if (!isHexBytes(signature, 1, MAX_SIGNATURE_BYTES)) return refusal("mpp/credential-malformed");
      return measured({
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
      });
    },
  };
}

function permit2Binding(presented: MppCredential): { h: AtrHash; checked: Echoed } | Refusal {
  const e = echoed(presented, PERMIT2_ID);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "permit2") return refusal("mpp/credential-type");
  const w = e.payload["witness"];
  if (!isObject(w) || normalHash(w["challengeHash"]) === null) return refusal("mpp/credential-malformed");
  const expect = challengeHash(presented.challenge.id, presented.challenge.realm);
  if (!sameBytes(w["challengeHash"], expect)) return refusal("mpp/witness-not-challenge-hash");
  // The read keys on the Permit2 bit at the challenge hash: a permit signed under any other nonce is refused.
  const permit = e.payload["permit"];
  const nonce = isObject(permit) ? uint256Of(permit["nonce"]) : undefined;
  if (nonce === undefined) return refusal("mpp/credential-malformed");
  if (nonce !== BigInt(expect)) return refusal("mpp/nonce-not-challenge-hash");
  return { h: e.h, checked: e.checked };
}

async function permit2Bound(input: unknown): Promise<AtrHash | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const b = permit2Binding(presented);
  return isRefusal(b) ? b : b.h;
}

/**
 * The read keys of a Permit2 charge, with the payee of `option`, the issued challenge the payment answers
 * (`mppPayee`): a refusal of the payment first, then the challenge's. `issue`, which the caller gives beside the chosen
 * challenge, holds the other challenges of the sale's issue: the charge challenges as the ATR's `mpp` slots hold them
 * and the agreement challenges as the resource server issued them for H. `witnesses` names the witness word of each one
 * on this pairing and chain (`issueWitnesses`), the chosen one's first, so that the search counts a permit of the
 * payer's under any of them.
 */
async function permit2Reference(
  input: unknown,
  option: MppChallenge,
  _given?: unknown,
  issue?: readonly MppChallenge[],
): Promise<(EvmRef & MppPermit2Ref) | Refusal> {
  return optionHeld(input, option, withPayee(await permit2Keys(input, issue), mppPayee(option)));
}

/** keccak256 of MPP's Permit2 witness type, `PaymentWitness(bytes32 challengeHash,string externalId)`. */
const PAYMENT_WITNESS_TYPEHASH = keccakHex("PaymentWitness(bytes32 challengeHash,string externalId)");

/** The EIP-712 hash of `PaymentWitness{challengeHash, externalId}` (draft-evm-charge-00 at tempoxyz/mpp-specs 08e7dd87, lines 449-483). */
function witnessWord(challengeHashValue: Hex, externalId: string): Hex {
  return hexOf(keccak(concat([bytesOf(PAYMENT_WITNESS_TYPEHASH)!, bytes32Word(challengeHashValue), keccak(externalId)])));
}

/**
 * The witness words of the challenges of the issue (`issue`): every one whose method is `evm`, whose intent is `charge`,
 * whose request, as placed, admits `permit2` (`pairingsOfPlaced`), and whose `methodDetails.chainId` is `chainId`, each
 * the EIP-712 hash of `PaymentWitness` over its `challengeHash(id, realm)` and its request's `externalId` (the empty
 * string where it names none, as `build` signs it). A challenge of `issue` whose id is not of `h` is `mpp/id-not-ours`;
 * an `issue` that is not a list of at most 32 challenges, each with a string `id` and `realm`, is `mpp/input-malformed`.
 * None where no `issue` is given.
 */
function issueWitnesses(issue: unknown, h: AtrHash, chainId: number): Hex[] | Refusal {
  if (issue === undefined) return [];
  if (!Array.isArray(issue) || issue.length > MAX_CHALLENGES) return refusal("mpp/input-malformed");
  const out: Hex[] = [];
  for (const c of issue) {
    if (!isObject(c) || carriesRefused(c) || typeof c["id"] !== "string" || typeof c["realm"] !== "string") return refusal("mpp/input-malformed");
    const of = challengeH(c["id"]);
    if (isRefusal(of) || !hashEquals(of, h)) return refusal("mpp/id-not-ours");
  }
  for (const c of issue as (MppChallenge & { id: string })[]) {
    if (c.method !== "evm" || c.intent !== "charge" || !pairingsOfPlaced(c).includes(PERMIT2_ID)) continue;
    const request = typeof c.request === "string" ? decodeObject(c.request) : undefined;
    const details = request === undefined ? undefined : request["methodDetails"];
    if (!isObject(details) || details["chainId"] !== chainId) continue;
    out.push(witnessWord(challengeHash(c.id, c.realm), str(request!["externalId"])));
  }
  return out;
}

async function permit2Keys(input: unknown, issue?: unknown): Promise<(Omit<EvmRef, "payee"> & Omit<MppPermit2Ref, "payee">) | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const b = permit2Binding(presented);
  if (isRefusal(b)) return b;
  const currency = requestAddress(b.checked, "currency");
  if (isRefusal(currency)) return currency;
  const chainId = echoedChain(b.checked);
  if (isRefusal(chainId)) return chainId;
  const permit2 = b.checked.details["permit2Address"];
  if (permit2 !== undefined && !isAddress(permit2)) return refusal("mpp/request-malformed");
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
  const permitted = isObject(permit) && Array.isArray(permit["permitted"]) ? permit["permitted"] : undefined;
  const signedNonce = isObject(permit) ? uint256Of(permit["nonce"]) : undefined;
  const w = p["witness"] as { [k: string]: Json };
  const pairs = (list: readonly unknown[] | undefined, a: string, b: string): string | undefined => {
    if (list === undefined || list.length === 0) return undefined;
    const out: string[] = [];
    for (const x of list) {
      const amount = isObject(x) ? uint256Of(x[b]) : undefined;
      if (!isObject(x) || !isAddress(x[a]) || amount === undefined) return undefined;
      out.push(`${(x[a] as string).toLowerCase()}:${amount}`);
    }
    return out.join(",");
  };
  const permittedText = pairs(permitted, "token", "amount");
  const transfersText = pairs(details as unknown[], "to", "requestedAmount");
  if (permittedText === undefined || transfersText === undefined || signedNonce === undefined || typeof w["externalId"] !== "string") {
    return refusal("mpp/credential-malformed");
  }
  const witness = witnessWord(w["challengeHash"] as Hex, w["externalId"]);
  const others = issueWitnesses(issue, b.h, chainId);
  if (isRefusal(others)) return others;
  const nonce = challengeHash(presented.challenge.id, presented.challenge.realm);
  return {
    network: `eip155:${chainId}`,
    settleBy: deadline.toString(),
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
    authorization: { scheme: "permit2", at: permit2 ?? PERMIT2, nonce, deadline: deadline.toString(), asset: currency },
    payer: from.toLowerCase() as Hex,
    presented: {
      permitted: permittedText,
      nonce: hexOf(uintWord(signedNonce)),
      deadline: deadline.toString(),
      owner: from.toLowerCase(),
      transfers: transfersText,
      witness,
    },
    witnesses: [witness, ...others.filter((x, i) => !sameBytes(x, witness) && others.findIndex((y) => sameBytes(x, y)) === i)],
  };
}

/**
 * The permit's owner: the address of the credential's `did:pkh` `source`, which MPP requires the signature to recover
 * to, lowercase. Permit2's signature does not cover the owner.
 */
async function permit2Authorizer(input: unknown): Promise<Hex | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const h = await permit2Bound(presented);
  if (typeof h !== "string") return h;
  const from = didPkhAddress(presented.source);
  return from === undefined ? refusal("mpp/source-required") : (from.toLowerCase() as Hex);
}

// ── mpp/charge/evm/transaction and mpp/charge/evm/hash.

/** EIP-1559's transaction type, its EIP-2718 envelope byte. */
const EIP1559_TYPE = 0x02;
/** The places among an EIP-1559 transaction's fields of its destination and data (byte strings) and access list. */
const EIP1559_BYTES = [5, 7];
const EIP1559_ACCESS_LIST = 8;

/**
 * The chain id of a signed EIP-1559 transaction: `0x02`, then the RLP list of its twelve fields, chainId, nonce,
 * maxPriorityFeePerGas, maxFeePerGas, gasLimit, destination, amount, data, accessList, signatureYParity, signatureR and
 * signatureS (EIP-1559), each integer canonical and the access list a list. Undefined for any other bytes.
 */
function eip1559ChainId(wire: Uint8Array): bigint | undefined {
  if (wire[0] !== EIP1559_TYPE) return undefined;
  const top = rlpDecode(wire.subarray(1), 3);
  if (top === undefined || top.kind !== "list" || top.items.length !== 12) return undefined;
  for (const [i, item] of top.items.entries()) {
    if (i === EIP1559_ACCESS_LIST) {
      if (item.kind !== "list") return undefined;
    } else if (EIP1559_BYTES.includes(i)) {
      if (item.kind !== "bytes") return undefined;
    } else if (rlpUint(item) === undefined) return undefined;
  }
  return rlpUint(top.items[0]);
}

/**
 * The call's request for the buyer's signer, on the challenge's chain. On `hash`, `complete` takes the transaction hash;
 * on `transaction`, the signed transaction. It checks in `bound`'s order: first `bound`'s hold of the echoed challenge
 * (`echoedFor`), which `bound` makes before its verdict, so a credential over the credential size bound is
 * `mpp/credential-malformed`, as `bound` gives it; then the transaction, 1 to 65,536 bytes of hex, else
 * `mpp/credential-malformed`, read as draft-evm-charge-00's transaction verification reads it before it broadcasts
 * (L696-697 and L873-879 at tempoxyz/mpp-specs 08e7dd87): an EIP-1559 transaction, else `mpp/credential-malformed`,
 * whose chain id is the challenge's `methodDetails.chainId`, else `evm/chain-mismatch`. `bound` reads nothing of it
 * (`mpp/no-signed-place`).
 */
function evmCallBuild(pairing: typeof TRANSACTION | typeof HASH) {
  return async (choice: MppChoice, h: AtrHash): Promise<MppUnsigned | Refusal> => {
    const o = offerFor(choice, h, pairing);
    if (isRefusal(o)) return o;
    const chainId = chainOf(o);
    const data = transferCalldata(str(o.request["recipient"]) as Hex, BigInt(str(o.request["amount"])));
    const challenge = o.challenge;
    const source = did(chainId, choice.from);
    const broadcast = pairing === HASH;
    return {
      request: { kind: "evm-call", chainId, call: { to: str(o.request["currency"]) as Hex, data }, broadcast },
      complete(signedTxOrHash: Hex): MppCredential | Refusal {
        if (broadcast) {
          const hash = normalHash(signedTxOrHash);
          if (hash === null) return refusal("mpp/credential-malformed");
          return measured({ challenge, source, payload: { type: "hash", hash: signedTxOrHash } });
        }
        const credential: MppCredential = { challenge, source, payload: { type: "transaction", signature: signedTxOrHash } };
        const held = echoedFor(credential, pairing);
        if (isRefusal(held)) return held;
        if (!isHexBytes(signedTxOrHash, 1, MAX_WIRE)) return refusal("mpp/credential-malformed");
        const txChain = eip1559ChainId(bytesOf(signedTxOrHash)!);
        if (txChain === undefined) return refusal("mpp/credential-malformed");
        if (txChain !== BigInt(chainId)) return refusal("evm/chain-mismatch");
        return credential;
      },
    };
  };
}

/**
 * Who broadcasts a credential of each type the EVM transaction and hash charges take, as `reference` and `status`
 * take either: a `transaction`, which the seller's server broadcasts, and a `hash`, which the payer broadcast.
 */
const EVM_CALL_TYPES = { transaction: "payee", hash: "payer" } as const;

/** Whether a credential's payload `type` is one the EVM transaction and hash charges take. */
function takesCallType(payload: { [k: string]: Json }): boolean {
  const t = payload["type"];
  return typeof t === "string" && Object.hasOwn(EVM_CALL_TYPES, t);
}

/**
 * The echoed challenge, held to `pairing`'s filter (`echoedFor`); then a payload `type` other than `transaction` and
 * `hash` is `mpp/credential-type`, before anything else of the payload is read; then `mpp/no-signed-place`.
 */
function noSignedPlace(pairing: typeof TRANSACTION | typeof HASH) {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    const e = echoedFor(presented, pairing);
    if (isRefusal(e)) return e;
    if (!takesCallType(e.payload)) return refusal("mpp/credential-type");
    return refusal("mpp/no-signed-place");
  };
}

/**
 * The read keys of a payment with no claim, from the challenge and the credential's `source`: the network, `asset` =
 * the challenge's `currency`, the token whose transfer `transferPresent` reads, and `transferLog`, which identifies
 * that transfer by its sender alone (identity `from`): the payer, the address of the credential's `did:pkh` `source`,
 * else `mpp/source-required`. Nothing the payer signed carries H. The challenge is held to `pairing`'s filter
 * (`checkedFor`), whose refusal it gives; of the request it reads only `currency` and `methodDetails.chainId`. The
 * reference also takes the payee of `option`, the issued challenge the payment answers (`mppPayee`), whose refusal
 * comes after the payment's.
 */
function networkReference(pairing: typeof TRANSACTION | typeof HASH) {
  return async (presented: unknown, option: MppChallenge): Promise<(EvmRef & MppNamedRef & { asset: Hex }) | Refusal> =>
    optionHeld(presented, option, withPayee(await referenceFor(presented, pairing), mppPayee(option)));
}

/**
 * The transaction a credential of the `transaction` or `hash` charge names: a `hash` payload's `hash`, or the hash of
 * a `transaction` payload's signed bytes (`signature`), keccak256 of the EIP-2718 envelope; else
 * `mpp/credential-malformed`.
 */
function namedTransaction(payload: unknown): Hex | Refusal {
  if (!isObject(payload)) return refusal("mpp/credential-malformed");
  if (payload["type"] === "hash") {
    const h = normalHash(payload["hash"]);
    return h === null ? refusal("mpp/credential-malformed") : (h as Hex);
  }
  if (payload["type"] === "transaction" && isHexBytes(payload["signature"], 1, MAX_WIRE)) {
    return keccakHex(bytesOf(payload["signature"])!);
  }
  return refusal("mpp/credential-malformed");
}

async function referenceFor(
  presented: unknown,
  pairing: typeof TRANSACTION | typeof HASH,
): Promise<(Omit<EvmRef, "payee"> & Omit<MppNamedRef, "payee"> & { asset: Hex }) | Refusal> {
  if (!isObject(presented) || !isChallengeShape(presented["challenge"])) return refusal("mpp/credential-malformed");
  const c = presented["challenge"];
  if (c.method !== "evm" || c.intent !== "charge") return refusal("mpp/not-this-pairing");
  const held = checkedFor(c, pairing);
  if (isRefusal(held)) return held;
  const request = decodeObject(c.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const e = echoedOf(c as MppChallenge & { id: string }, request);
  if (isRefusal(e)) return e;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("mpp/credential-malformed");
  if (!takesCallType(payload as { [k: string]: Json })) return refusal("mpp/credential-type");
  const asset = requestAddress(e, "currency");
  if (isRefusal(asset)) return asset;
  const chainId = echoedChain(e);
  if (isRefusal(chainId)) return chainId;
  const from = didPkhAddress(presented["source"]);
  if (from === undefined) return refusal("mpp/source-required");
  const digest = await transferDigest({ from });
  if (typeof digest !== "string") return digest;
  const transaction = namedTransaction(presented["payload"]);
  if (isRefusal(transaction)) return transaction;
  return {
    network: `eip155:${chainId}`,
    asset,
    transferLog: { address: asset, topic0: TRANSFER_TOPIC, identity: "from", digest },
    payer: from.toLowerCase() as Hex,
    transaction,
  };
}

/** `transfer(to, amount)` calldata: the selector, then the two 32-byte words. */
function transferCalldata(to: Hex, amount: bigint): Hex {
  return hexOf(concat([bytesOf(TRANSFER_SELECTOR)!, addressWord(to), uintWord(amount)]));
}

// ── The records.

function pattern(p: Omit<LcpPattern, "zeroPartyRecoverable" | "forwardIndexable">): LcpPattern {
  return deepFreeze({ ...p, zeroPartyRecoverable: false, forwardIndexable: false });
}

/**
 * `mpp/charge/evm/authorization`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type`
 * `authorization`): the payer signs an EIP-3009 authorization, and the seller's server submits
 * `transferWithAuthorization` with it; `status` reads that transaction. A credential of any other type gets
 * `mpp/credential-type`, as `bound` refuses it.
 */
export const evmAuthorization = Object.freeze({
  id: AUTHORIZATION,
  data: EIP155_TEMPO_MPP[AUTHORIZATION],
  pattern: pattern({
    pattern: "id-reuse",
    profile: "mpp/charge",
    onChain: true,
  }),
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(AUTHORIZATION),
  read,
  build: authorizationBuild,
  bound: authorizationBound,
  broadcaster: mppBroadcaster(byType({ authorization: "payee" })),
  reference: authorizationReference,
  authorizer: authorizationAuthorizer,
  status: mppEip3009Status,
}) satisfies Entry<
  typeof AUTHORIZATION,
  MppCredential,
  EvmRef & MppEip3009Ref,
  MppEvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: { transaction?: Hex };
    network: never;
    query: EvmQuery<unknown>;
    answer: MppEvmStatus;
  }
>;

/**
 * `mpp/charge/evm/permit2`. The payee broadcasts (`broadcaster` answers `"payee"` for a credential of `type` `permit2`):
 * the payer signs a Permit2 transfer, and the seller's server, the `spender` it names, submits it to Permit2; `status`
 * reads that transaction. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it.
 */
export const evmPermit2 = Object.freeze({
  id: PERMIT2_ID,
  data: EIP155_TEMPO_MPP[PERMIT2_ID],
  pattern: pattern({
    pattern: "id-reuse",
    profile: "mpp/charge",
    onChain: true,
  }),
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(PERMIT2_ID),
  read,
  build: permit2Build,
  bound: permit2Bound,
  broadcaster: mppBroadcaster(byType({ permit2: "payee" })),
  reference: permit2Reference,
  authorizer: permit2Authorizer,
  status: mppPermit2Status,
}) satisfies Entry<
  typeof PERMIT2_ID,
  MppCredential,
  EvmRef & MppPermit2Ref,
  MppEvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: { transaction?: Hex };
    network: never;
    query: EvmQuery<unknown>;
    answer: MppEvmStatus;
  }
>;

/**
 * `mpp/charge/evm/transaction`, whose `build` writes `broadcast: false`. `broadcaster` answers by the credential's
 * `type`, as `reference` and `status` take either: `transaction`, `"payee"`, a signed transaction the seller's server
 * broadcasts, naming its hash to `status`; `hash`, `"payer"`, a transaction the payer broadcast, which `status` reads
 * by that hash. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it; `bound` gives every
 * credential of either type `mpp/no-signed-place`.
 */
export const evmTransaction = Object.freeze({
  id: TRANSACTION,
  data: EIP155_TEMPO_MPP[TRANSACTION],
  pattern: pattern({
    pattern: "opaque-challenge",
    profile: "mpp/charge",
    onChain: false,
  }),
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(TRANSACTION),
  read,
  build: evmCallBuild(TRANSACTION),
  bound: noSignedPlace(TRANSACTION),
  broadcaster: mppBroadcaster(byType(EVM_CALL_TYPES)),
  reference: networkReference(TRANSACTION),
  status: transferPresent,
}) satisfies Entry<
  typeof TRANSACTION,
  MppCredential,
  EvmRef & MppNamedRef & { asset: Hex },
  MppEvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: unknown;
    network: never;
    query: EvmQuery<unknown>;
    answer: MppEvmStatus;
  }
>;

/**
 * `mpp/charge/evm/hash`, whose `build` writes `broadcast: true`. `broadcaster` answers by the credential's `type`, as
 * `reference` and `status` take either: `hash`, `"payer"`, a transaction the payer broadcast, which `status` reads by
 * that hash; `transaction`, `"payee"`, a signed transaction the seller's server broadcasts, naming its hash to
 * `status`. A credential of any other type gets `mpp/credential-type`, as `bound` refuses it; `bound` gives every
 * credential of either type `mpp/no-signed-place`.
 */
export const evmHash = Object.freeze({
  id: HASH,
  data: EIP155_TEMPO_MPP[HASH],
  pattern: pattern({
    pattern: "opaque-challenge",
    profile: "mpp/charge",
    onChain: false,
  }),
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(HASH),
  read,
  build: evmCallBuild(HASH),
  bound: noSignedPlace(HASH),
  broadcaster: mppBroadcaster(byType(EVM_CALL_TYPES)),
  reference: networkReference(HASH),
  status: transferPresent,
}) satisfies Entry<
  typeof HASH,
  MppCredential,
  EvmRef & MppNamedRef & { asset: Hex },
  MppEvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: unknown;
    network: never;
    query: EvmQuery<unknown>;
    answer: MppEvmStatus;
  }
>;

/** Every MPP pairing this entry point implements. */
export const MPP_BINDINGS = Object.freeze([
  evmAuthorization,
  evmPermit2,
  evmTransaction,
  evmHash,
  tempoSplitMemo,
  tempoSplitMemoPush,
  sessionEvm,
  sessionTempo,
  subscriptionTempo,
  chargeLightning,
  sessionLightning,
  chargeSolana,
  chargeSolanaUnsponsored,
  subscriptionSolana,
  sessionSolanaMemo,
  sessionSolanaStock,
  chargeXrpl,
  chargeNearIntents,
  sessionXrpl,
  sessionXrplStock,
  sessionHederaStock,
  chargeLcpHedera,
  chargeCard,
  chargeStripe,
  subscriptionStripe,
  chargeUsdcEvm,
  chargeUsdcSolana,
  chargeUsdcStacks,
  chargeUsdcGateway,
] as const);
