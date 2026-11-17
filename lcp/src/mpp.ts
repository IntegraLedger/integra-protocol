/**
 * The `mpp` entry point: MPP's challenge pieces and its pairings. The charge pairings here are EVM `authorization` (the
 * signed nonce is keccak256 of the JSON array [id, realm]), EVM `permit2` (the signed witness carries that value), and
 * EVM `transaction` and `hash` (nothing signed carries H). The card, Stripe, Solana, XRP Ledger, NEAR Intents and
 * `usdc` charges, and the session and subscription pairings other than Lightning's, are re-exported from their
 * modules. `FETCHED` is the key under which a pairing's `fetchPresented` writes the seller's read onto a credential.
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import { addressWord, bytesOf, concat, hexOf, sameBytes, uintWord, type Hex } from "./evm-abi.js";
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
  challengeHash,
  checkChallenge,
  checkedFor,
  chosenHeld,
  credentialOf,
  decodeObject,
  deepFreeze,
  didPkhAddress,
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
import { railSessionResume, sessionXrpl } from "./mpp-session-rails.js";
import { hederaSessionResume, sessionHederaStock } from "./hedera-session.js";
import { chargeSolana, chargeSolanaUnsponsored } from "./mpp-solana.js";
import { subscriptionSolana } from "./mpp-subscription-solana.js";
import { sessionSolanaMemo, sessionSolanaStock, solanaSessionResume } from "./mpp-session-solana.js";
import { chargeXrpl } from "./mpp-xrpl.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { rlpDecode, rlpUint } from "./rlp.js";
import {
  evmStatusOf,
  failedIfFinal,
  isGuardTransfer,
  permit2Status,
  readEvm,
  transferParts,
  unreadable,
  withPayee,
  type EvmQuery,
  type EvmRead,
} from "./internal/evm.js";
import { boundStatus } from "./internal/evm-status.js";
import { mppPayee } from "./internal/payee.js";
import type { LcpPattern } from "./x402.js";
import { MAX_SIGNATURE_BYTES } from "./internal/bounds.js";
import { EIP155_TEMPO_MPP } from "./internal/data/eip155-tempo-mpp.js";
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
export { chargeSolana, chargeSolanaUnsponsored } from "./mpp-solana.js";
export { subscriptionSolana } from "./mpp-subscription-solana.js";
export { sessionSolanaMemo, sessionSolanaStock, type SolanaSessionChoice, type SolanaSessionUnsigned } from "./mpp-session-solana.js";
export { chargeXrpl, type XrplChargeChoice, type XrplChargeUnsigned } from "./mpp-xrpl.js";
export {
  sessionXrpl,
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
 * The `status` of the EVM `transaction` and `hash` charges, whose data both give coverage `none`: `evmStatus`'s read of
 * the reported transaction with no named log, answered as the profile `read-status` does at that coverage, where the
 * act is the transaction the reference names. The read is settled where the receipt also holds one log from
 * `ref.asset` with three topics and `topics[0]` = `Transfer` whose sender `ref.transferLog` identifies and whose
 * recipient is not `RECEIVE_POLICY_GUARD`. `ref.asset` and `ref.transferLog.address` must be addresses naming the same
 * token, and `ref.transferLog` must identify a `Transfer` from it by its sender alone (identity `from`), as the
 * pairing's `reference` records it; any other ref is unreadable `unparseable`, with nothing read. Without such a log,
 * a `Transfer` from that sender to the guard, or none (another account's `Transfer` in the same transaction is not this
 * payment), the transaction is no act. A receipt the reader does not hold is a lookup read whole that found nothing,
 * which with no history shown answers unreadable `history-gap`. A reader that is not an object is unreadable
 * `transport`, and a query that is not one `status` takes unreadable `unparseable`, with nothing read. At most three
 * calls.
 */
export async function transferPresent(
  ref: EvmRef & { transaction: Hex; asset: Hex },
  reader: EvmReader,
  query: EvmQuery<EvmRef & { transaction: Hex; asset: Hex }>,
): Promise<EvmBreadthStatus> {
  return transferAnswer(ref, reader, query);
}

const transferAnswer = evmStatusOf(readTransfer, EIP155_TEMPO_MPP["mpp/charge/evm/transaction"].coverage);

async function readTransfer(ref: EvmRef & { transaction: Hex; asset: Hex }, reader: EvmReader): Promise<EvmRead> {
  if (typeof ref !== "object" || ref === null) return unreadable("unparseable");
  if (typeof reader !== "object" || reader === null) return unreadable("transport");
  const sender = ref.transferLog;
  if (!identifiesSender(sender, ref.asset)) return unreadable("unparseable");
  let seen: EvmReceipt | null = null;
  const watching: EvmReader = {
    network: reader.network,
    receipt: async (tx) => (seen = await reader.receipt(tx)),
    blockNumber: (tag) => reader.blockNumber(tag),
    transaction: (tx) => reader.transaction(tx),
    call: (to, data, block) => reader.call(to, data, block),
  };
  const s = await readEvm({ network: ref.network, transaction: ref.transaction, payee: ref.payee }, watching);
  if (s.state !== "settled") return s;
  const logs = (seen as EvmReceipt | null)?.logs ?? [];
  const sent: EvmLog[] = [];
  for (const l of logs) {
    const parts = transferParts(l, ref.asset, TRANSFER_TOPIC);
    if (parts === undefined) continue;
    const digest = await transferDigest({ from: parts.from });
    if (typeof digest === "string" && sameBytes(digest, sender.digest)) sent.push(l);
  }
  if (sent.some((l) => !isGuardTransfer(l, ref.asset))) return s;
  if (sent.length > 0) return failedIfFinal(s, "receive-policy-blocked");
  return failedIfFinal(s, "transfer-not-found");
}

/**
 * True for a `TransferLog` that identifies a `Transfer` from `asset` by its sender alone (identity `from`), where
 * `asset` and the log's `address` are both addresses and name the same token.
 */
function identifiesSender(t: unknown, asset: unknown): t is TransferLog {
  if (!isObject(t) || t["identity"] !== "from" || !sameBytes(t["topic0"], TRANSFER_TOPIC)) return false;
  const address = t["address"];
  return (
    isAddress(address) &&
    isAddress(asset) &&
    address.toLowerCase() === asset.toLowerCase() &&
    bytesOf(t["digest"])?.length === 32
  );
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

/** MPP's `place` for `pairing`, with the agreement URL in `opaque` when one is given. */
function advertiseAs(pairing: ChargeId) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    position: number | null,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const pairings = pairingsOf(offer);
    if (isRefusal(pairings)) return pairings;
    if (!pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
    return place(doc, h, link, offer, position, agreementUrl);
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
 * (`mppPayee`): a refusal of the payment first, then the challenge's.
 */
async function authorizationReference(input: unknown, option: MppChallenge): Promise<EvmRef | Refusal> {
  return withPayee(await authorizationKeys(input), mppPayee(option));
}

async function authorizationKeys(input: unknown): Promise<Omit<EvmRef, "payee"> | Refusal> {
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
 * (`mppPayee`): a refusal of the payment first, then the challenge's.
 */
async function permit2Reference(input: unknown, option: MppChallenge): Promise<EvmRef | Refusal> {
  return withPayee(await permit2Keys(input), mppPayee(option));
}

async function permit2Keys(input: unknown): Promise<Omit<EvmRef, "payee"> | Refusal> {
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
  return {
    network: `eip155:${chainId}`,
    settleBy: deadline.toString(),
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
    authorization: {
      scheme: "permit2",
      at: permit2 ?? PERMIT2,
      nonce: challengeHash(presented.challenge.id, presented.challenge.realm),
      deadline: deadline.toString(),
      asset: currency,
    },
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

/** The echoed challenge, held to `pairing`'s filter (`echoedFor`); then `mpp/no-signed-place`. */
function noSignedPlace(pairing: typeof TRANSACTION | typeof HASH) {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    const e = echoedFor(presented, pairing);
    if (isRefusal(e)) return e;
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
  return async (presented: unknown, option: MppChallenge): Promise<(EvmRef & { asset: Hex }) | Refusal> =>
    withPayee(await referenceFor(presented, pairing), mppPayee(option));
}

async function referenceFor(
  presented: unknown,
  pairing: typeof TRANSACTION | typeof HASH,
): Promise<(Omit<EvmRef, "payee"> & { asset: Hex }) | Refusal> {
  if (!isObject(presented) || !isChallengeShape(presented["challenge"])) return refusal("mpp/credential-malformed");
  const c = presented["challenge"];
  if (c.method !== "evm" || c.intent !== "charge") return refusal("mpp/not-this-pairing");
  const held = checkedFor(c, pairing);
  if (isRefusal(held)) return held;
  const request = decodeObject(c.request);
  if (request === undefined) return refusal("mpp/request-malformed");
  const e = echoedOf(c as MppChallenge & { id: string }, request);
  if (isRefusal(e)) return e;
  const asset = requestAddress(e, "currency");
  if (isRefusal(asset)) return asset;
  const chainId = echoedChain(e);
  if (isRefusal(chainId)) return chainId;
  const from = didPkhAddress(presented["source"]);
  if (from === undefined) return refusal("mpp/source-required");
  const digest = await transferDigest({ from });
  if (typeof digest !== "string") return digest;
  return {
    network: `eip155:${chainId}`,
    asset,
    transferLog: { address: asset, topic0: TRANSFER_TOPIC, identity: "from", digest },
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
  status: boundStatus([AUTHORIZATION_USED_TOPIC], EIP155_TEMPO_MPP[AUTHORIZATION].coverage),
}) satisfies Entry<
  typeof AUTHORIZATION,
  MppCredential,
  EvmRef,
  EvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: { transaction: Hex };
    network: never;
    query: EvmQuery<EvmRef & { transaction: Hex }>;
    answer: EvmBreadthStatus;
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
  status: permit2Status(EIP155_TEMPO_MPP[PERMIT2_ID].coverage),
}) satisfies Entry<
  typeof PERMIT2_ID,
  MppCredential,
  EvmRef,
  EvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: { transaction: Hex };
    network: never;
    query: EvmQuery<EvmRef & { transaction: Hex }>;
    answer: EvmBreadthStatus;
  }
>;

/**
 * `mpp/charge/evm/transaction`, whose `build` writes `broadcast: false`. `broadcaster` answers by the credential's
 * `type`, as `reference` and `status` take either: `transaction`, `"payee"`, a signed transaction the seller's server
 * broadcasts, naming its hash to `status`; `hash`, `"payer"`, a transaction the payer broadcast, which `status` reads
 * by that hash. A credential of any other type gets `mpp/no-signed-place`, the code `bound` gives every credential
 * within its shape gate.
 */
export const evmTransaction = Object.freeze({
  id: TRANSACTION,
  data: EIP155_TEMPO_MPP[TRANSACTION],
  pattern: pattern({
    pattern: "opaque-challenge",
    onChain: false,
  }),
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(TRANSACTION),
  read,
  build: evmCallBuild(TRANSACTION),
  bound: noSignedPlace(TRANSACTION),
  broadcaster: mppBroadcaster(byType(EVM_CALL_TYPES, () => refusal("mpp/no-signed-place"))),
  reference: networkReference(TRANSACTION),
  status: transferPresent,
}) satisfies Entry<
  typeof TRANSACTION,
  MppCredential,
  EvmRef & { asset: Hex },
  EvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: { transaction: Hex };
    network: never;
    query: EvmQuery<EvmRef & { transaction: Hex; asset: Hex }>;
    answer: EvmBreadthStatus;
  }
>;

/**
 * `mpp/charge/evm/hash`, whose `build` writes `broadcast: true`. `broadcaster` answers by the credential's `type`, as
 * `reference` and `status` take either: `hash`, `"payer"`, a transaction the payer broadcast, which `status` reads by
 * that hash; `transaction`, `"payee"`, a signed transaction the seller's server broadcasts, naming its hash to
 * `status`. A credential of any other type gets `mpp/no-signed-place`, the code `bound` gives every credential within
 * its shape gate.
 */
export const evmHash = Object.freeze({
  id: HASH,
  data: EIP155_TEMPO_MPP[HASH],
  pattern: pattern({
    pattern: "opaque-challenge",
    onChain: false,
  }),
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseAs(HASH),
  read,
  build: evmCallBuild(HASH),
  bound: noSignedPlace(HASH),
  broadcaster: mppBroadcaster(byType(EVM_CALL_TYPES, () => refusal("mpp/no-signed-place"))),
  reference: networkReference(HASH),
  status: transferPresent,
}) satisfies Entry<
  typeof HASH,
  MppCredential,
  EvmRef & { asset: Hex },
  EvmReader,
  MppForms & {
    choice: MppChoice;
    unsigned: MppUnsigned;
    landed: { transaction: Hex };
    network: never;
    query: EvmQuery<EvmRef & { transaction: Hex; asset: Hex }>;
    answer: EvmBreadthStatus;
  }
>;

/** Every MPP pairing this entry point implements. */
export const MPP_BINDINGS = Object.freeze([
  evmAuthorization,
  evmPermit2,
  evmTransaction,
  evmHash,
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
  sessionHederaStock,
  chargeCard,
  chargeStripe,
  subscriptionStripe,
  chargeUsdcEvm,
  chargeUsdcSolana,
  chargeUsdcStacks,
  chargeUsdcGateway,
] as const);
