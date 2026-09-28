/**
 * MPP's `usdc` method, one pairing per profile. On EVM the payer signs an EIP-3009 authorization whose nonce, and on
 * Gateway a burn intent whose TransferSpec salt, is `usdc`'s derivation over the challenge `id`, which carries the ATR
 * hash. On Solana the signed memo carries the hash's LCP string. On Stacks the signed SIP-010 `transfer` carries the
 * hash's 32 bytes as its memo argument.
 */
import { base64 } from "@scure/base";
import { canonicalJson, parseJson, type AtrHash, type Json } from "./core.js";
import { bytesOf, keccakHex, sameBytes, type Hex } from "./evm-abi.js";
import { sameBytes as equalBytes } from "./rail-bytes.js";
import {
  AUTHORIZATION_USED_TOPIC,
  TRANSFER_TOPIC,
  eip3009TypedData,
  evmStatus,
  transferDigest,
  type Eip3009TypedData,
  type EvmRef,
} from "./evm.js";
import { isAddress, normalHash, uint256Of } from "./fields.js";
import { keyString } from "./internal/svm.js";
import {
  b64uDecode,
  chosenFor,
  credentialOf,
  deepFreeze,
  echoedFor,
  isHexBytes,
  isObject,
  pairingsOf,
  place,
  read,
  tie,
  type Checked,
  type MppChallenge,
  type MppChoice,
  type MppCredential,
} from "./mpp-challenge.js";
import { stacksNetworkOf } from "./mpp-method-checks.js";
import { solanaChargePairing } from "./mpp-solana.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import { memoArgument, stacksRecover, stacksStatus, stacksTxid, type StacksRef } from "./stacks.js";
import type { LcpPattern } from "./x402.js";

const EVM = "mpp/charge/usdc/evm" as const;
const SOLANA = "mpp/charge/usdc/solana" as const;
const STACKS = "mpp/charge/usdc/stacks" as const;
const GATEWAY = "mpp/charge/usdc/gateway" as const;
type UsdcDirect = typeof EVM | typeof STACKS | typeof GATEWAY;

const MAX_REQUEST = 8192;
const MAX_SIGNATURE = 8192;
const MAX_STACKS_TX = 16_384;
const STACKS_FORMAT = "stacks_transaction_v1";
const GATEWAY_FORMAT = "circle-gateway-v1";
const UINT = /^[0-9]{1,78}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const C32_PRINCIPAL = /^S[0-9A-HJKMNP-TV-Z]{38,40}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const LIMIT = "This does not show that amount, payee, asset or timing match the ATR's content.";

// ── The derivations.

/**
 * keccak256 of the challenge's `request` parameter's decoded bytes, as `0x` and lowercase hex. The bytes must be the
 * RFC 8785 form of their own parse, else `mpp/request-not-jcs`; they are hashed as received.
 */
export async function usdcRequestHash(requestParam: string): Promise<Hex | Refusal> {
  const bytes = b64uDecode(requestParam, MAX_REQUEST);
  if (bytes === undefined) return refusal("mpp/request-malformed");
  let text: string;
  let parsed: unknown;
  try {
    text = utf8.decode(bytes);
    parsed = parseJson(text);
  } catch {
    return refusal("mpp/request-malformed");
  }
  if (parsed === undefined) return refusal("mpp/request-malformed");
  if (canonicalJson(parsed as Json) !== text) return refusal("mpp/request-not-jcs");
  return keccakHex(bytes);
}

/** keccak256 of the UTF-8 of the core's `canonicalJson` of `v`, or `mpp/challenge-malformed` where `v` has no such form. */
function keccakJcs(v: { [k: string]: string }): Hex | Refusal {
  const text = canonicalJson(v);
  return typeof text === "string" ? keccakHex(text) : refusal("mpp/challenge-malformed");
}

/**
 * `usdc`'s EIP-3009 nonce: keccak256 of the JCS of `{id, method: "usdc", realm, intent: "charge", requestHash}`, with
 * `requestHash` written as `0x` and 64 lowercase hex.
 */
export function usdcNonce(id: string, realm: string, requestHash: Hex): Hex | Refusal {
  const rh = normalHash(requestHash);
  if (rh === null) return refusal("mpp/request-malformed");
  return keccakJcs({ id: String(id), method: "usdc", realm: String(realm), intent: "charge", requestHash: rh });
}

/** The inputs of `usdc`'s Gateway salt, every one a string. */
export interface GatewaySaltInput {
  id: string;
  realm: string;
  requestHash: Hex;
  sourceNetwork: string;
  destinationNetwork: string;
  sourceDepositor: string;
  sourceSigner: string;
  recipient: string;
  destinationRecipient: string;
  amount: string;
  maxFee: string;
}

/** The salt's inputs a Gateway signing request carries from the chosen challenge. */
export type GatewayPreimage = Pick<GatewaySaltInput, "id" | "realm" | "requestHash" | "recipient">;

const SALT_KEYS = [
  "id",
  "realm",
  "requestHash",
  "sourceNetwork",
  "destinationNetwork",
  "sourceDepositor",
  "sourceSigner",
  "recipient",
  "destinationRecipient",
  "amount",
  "maxFee",
] as const;

/** `usdc`'s Gateway salt: keccak256 of the JCS of the inputs with `method` "usdc", `intent` "charge", `type` "gateway". */
export function usdcGatewaySalt(i: GatewaySaltInput): Hex | Refusal {
  if (!isObject(i)) return refusal("mpp/input-malformed");
  const out: { [k: string]: string } = { method: "usdc", intent: "charge", type: "gateway" };
  for (const k of SALT_KEYS) {
    const v = (i as unknown as { [k: string]: unknown })[k];
    if (typeof v !== "string") return refusal("mpp/input-malformed");
    out[k] = v;
  }
  return keccakJcs(out);
}

// ── Shared steps.

function profileOf(c: Checked): { [k: string]: Json } {
  const p = c.details[String(c.details["type"])];
  return isObject(p) ? (p as { [k: string]: Json }) : {};
}

function str(v: Json | undefined): string {
  return typeof v === "string" ? v : "";
}

function advertiseAs(pairing: UsdcDirect) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const pairings = pairingsOf(offer);
    if (isRefusal(pairings)) return pairings;
    if (!pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
    return place(doc, h, link, offer, agreementUrl);
  };
}

function unplaced(option: MppChallenge): MppChallenge {
  return option;
}

function pattern(p: LcpPattern): LcpPattern {
  return deepFreeze(p);
}

// ── mpp/charge/usdc/evm.

/** The EIP-3009 authorization for the payer to sign, whose nonce is `usdcNonce` over the chosen challenge. */
async function evmBuild(choice: MppChoice, h: AtrHash) {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const o = chosenFor(choice.challenge, h, EVM);
  if (isRefusal(o)) return o;
  const td = choice.tokenDomain;
  if (!isObject(td) || typeof td.name !== "string" || td.name === "" || typeof td.version !== "string" || td.version === "") {
    return refusal("mpp/input-malformed");
  }
  if (!isAddress(choice.from)) return refusal("mpp/input-malformed");
  const requestHash = await usdcRequestHash(choice.challenge.request);
  if (isRefusal(requestHash)) return requestHash;
  const nonce = usdcNonce(choice.challenge.id, choice.challenge.realm, requestHash);
  if (isRefusal(nonce)) return nonce;
  const chainId = profileOf(o)["chainId"] as number;
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
  if (isRefusal(typedData)) return typedData;
  const challenge = { ...choice.challenge };
  const from = choice.from;
  return {
    request: { kind: "eip712" as const, typedData },
    complete(signature: Hex): MppCredential | Refusal {
      if (!isHexBytes(signature, 65, MAX_SIGNATURE)) return refusal("mpp/credential-malformed");
      return {
        challenge,
        source: `did:pkh:eip155:${chainId}:${from}`,
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

/** H from the echoed challenge, once the authorization's nonce equals `usdcNonce` over it, by bytes. */
async function evmBinding(input: unknown): Promise<{ h: AtrHash; checked: Checked; nonce: Hex } | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const e = echoedFor(credential, EVM);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "authorization") return refusal("mpp/credential-type");
  if (normalHash(e.payload["nonce"]) === null) return refusal("mpp/credential-malformed");
  const requestHash = await usdcRequestHash(credential.challenge.request);
  if (isRefusal(requestHash)) return requestHash;
  const nonce = usdcNonce(credential.challenge.id, credential.challenge.realm, requestHash);
  if (isRefusal(nonce)) return nonce;
  if (!sameBytes(e.payload["nonce"], nonce)) return refusal("mpp/nonce-not-usdc-derivation");
  return { h: e.h, checked: e.checked, nonce };
}

async function evmBound(input: unknown): Promise<AtrHash | Refusal> {
  const b = await evmBinding(input);
  return isRefusal(b) ? b : b.h;
}

/**
 * The authorization's read keys: its `AuthorizationUsed` nonce, its transfer's digest, `validBefore`, and the
 * authorization as the token records its use.
 */
async function evmReference(input: unknown): Promise<EvmRef | Refusal> {
  const b = await evmBinding(input);
  if (isRefusal(b)) return b;
  const p = (input as MppCredential).payload;
  const value = uint256Of(p["value"]);
  const validBefore = uint256Of(p["validBefore"]);
  if (!isAddress(p["from"]) || !isAddress(p["to"]) || value === undefined || validBefore === undefined) {
    return refusal("mpp/credential-malformed");
  }
  const digest = await transferDigest({ from: p["from"], to: p["to"], value });
  if (isRefusal(digest)) return digest;
  const currency = str(b.checked.request["currency"]) as Hex;
  return {
    network: `eip155:${profileOf(b.checked)["chainId"] as number}`,
    settleBy: validBefore.toString(),
    bindingLog: { address: currency, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: b.nonce },
    transferLog: { address: currency, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest },
    search: { address: currency, topics: [AUTHORIZATION_USED_TOPIC, null, b.nonce] },
    authorization: { scheme: "eip3009", at: currency, nonce: b.nonce, deadline: validBefore.toString(), asset: currency },
  };
}

/** The account whose signature authorises the pull: the authorization's `from`, which its signed message holds, lowercase. */
async function evmAuthorizer(input: unknown): Promise<Hex | Refusal> {
  const b = await evmBinding(input);
  if (isRefusal(b)) return b;
  const from = (input as MppCredential).payload["from"];
  return isAddress(from) ? (from.toLowerCase() as Hex) : refusal("mpp/credential-malformed");
}

export const chargeUsdcEvm = Object.freeze({
  id: EVM,
  pattern: pattern({
    pattern: "id-reuse",
    canonical: true,
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: true,
    proves:
      "The payer signed an EIP-3009 authorization whose nonce is keccak256 of the JCS of this challenge's id, realm " +
      "and request hash, and the id is this ATR's hash in base64url with the challenge's position. The token contract " +
      "verified the signature when it executed the transfer, and the nonce is on chain in its AuthorizationUsed event. " +
      "A holder of the ATR, the realm and the request can confirm the hash; the chain alone does not reveal it. " +
      LIMIT,
  }),
  claims: true as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise: advertiseAs(EVM),
  read,
  build: evmBuild as (choice: MppChoice, h: AtrHash) => Promise<UsdcUnsigned | Refusal>,
  bound: evmBound,
  reference: evmReference,
  authorizer: evmAuthorizer,
  status: evmStatus,
});

// ── mpp/charge/usdc/solana.

export const chargeUsdcSolana = solanaChargePairing({
  id: SOLANA,
  details: (c: Checked) => profileOf(c),
  networkRequired: true,
  occupied: "mpp/carrier-occupied",
});

// ── mpp/charge/usdc/stacks.

/** The buyer's inputs to the Stacks build: the chosen challenge and the payer's c32 standard principal. */
export interface StacksChargeChoice {
  challenge: MppChallenge & { id: string };
  from: string;
}

/** What the signer is handed for each `usdc` profile, and how its answer completes the credential. */
export type UsdcUnsigned =
  | {
      request: { kind: "eip712"; typedData: Eip3009TypedData };
      complete(signature: Hex): MppCredential | Refusal;
    }
  | {
      request: {
        kind: "stacks-contract-call";
        contract: string;
        functionName: "transfer";
        args: { amount: string; sender: string; recipient: string; memo: AtrHash };
        postCondition: "SentEq";
        postConditionMode: "deny";
        anchorMode: "onChainOnly";
      };
      complete(serializedTx: Uint8Array): MppCredential | Refusal;
    }
  | {
      request: {
        kind: "gateway-burn-intent";
        preimage: GatewayPreimage;
      };
      complete(c: {
        source: string;
        sourceNetwork: string;
        destinationNetwork: string;
        maxFee: string;
        burnIntent: Json;
        signature: Hex;
      }): MppCredential | Refusal;
    };

/**
 * The SIP-010 `transfer` for the buyer's Stacks wallet to build and sign: `(amount, sender, recipient, (some H))` on
 * the profile's token contract, one `SentEq` post-condition, post-condition mode Deny and anchor mode OnChainOnly.
 */
async function stacksBuild(choice: StacksChargeChoice, h: AtrHash) {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const o = chosenFor(choice.challenge, h, STACKS);
  if (isRefusal(o)) return o;
  if (typeof choice.from !== "string" || !C32_PRINCIPAL.test(choice.from)) return refusal("mpp/input-malformed");
  const p = profileOf(o);
  const memo = normalHash(h)!;
  const chainId = str(p["chainId"]);
  const challenge = { ...choice.challenge };
  const from = choice.from;
  return {
    request: {
      kind: "stacks-contract-call" as const,
      contract: `${str(p["contractAddress"])}.${str(p["contractName"])}`,
      functionName: "transfer" as const,
      args: { amount: str(o.request["amount"]), sender: from, recipient: str(o.request["recipient"]), memo },
      postCondition: "SentEq" as const,
      postConditionMode: "deny" as const,
      anchorMode: "onChainOnly" as const,
    },
    complete(serializedTx: Uint8Array): MppCredential | Refusal {
      if (!(serializedTx instanceof Uint8Array) || serializedTx.length === 0 || serializedTx.length > MAX_STACKS_TX) {
        return refusal("mpp/credential-malformed");
      }
      return {
        challenge,
        source: `stacks:${chainId}:${from}`,
        payload: { type: "transaction", transaction: base64.encode(serializedTx), transactionFormat: STACKS_FORMAT },
      };
    },
  };
}

type StacksPeer = typeof import("@stacks/transactions");
let stacksPeerLoad: Promise<StacksPeer | undefined> | undefined;

/** `@stacks/transactions`, loaded once on first use; undefined when it is not installed. */
function stacksPeer(): Promise<StacksPeer | undefined> {
  stacksPeerLoad ??= import("@stacks/transactions").then(
    (m) => m,
    () => undefined,
  );
  return stacksPeerLoad;
}

type Decoded = ReturnType<StacksPeer["deserializeTransaction"]>;

/**
 * H from the echoed challenge, once its transaction decodes and calls `transfer` with `(some H)` as its fourth
 * argument. The transaction is decoded, never re-serialised; nothing but that argument is read.
 */
async function stacksBinding(
  input: unknown,
): Promise<{ h: AtrHash; checked: Checked; wire: Uint8Array; tx: Decoded; peer: StacksPeer } | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const e = echoedFor(credential, STACKS);
  if (isRefusal(e)) return e;
  if (e.payload["type"] !== "transaction") return refusal("mpp/credential-type");
  const format = e.payload["transactionFormat"];
  if (format !== undefined && format !== STACKS_FORMAT) return refusal("mpp/stacks-tx-malformed");
  const text = e.payload["transaction"];
  if (typeof text !== "string" || text.length > Math.ceil(MAX_STACKS_TX / 3) * 4) return refusal("mpp/stacks-tx-malformed");
  let wire: Uint8Array;
  try {
    wire = base64.decode(text);
  } catch {
    return refusal("mpp/stacks-tx-malformed");
  }
  if (wire.length === 0 || wire.length > MAX_STACKS_TX) return refusal("mpp/stacks-tx-malformed");
  const peer = await stacksPeer();
  if (peer === undefined) return refusal("stacks/peer-missing");
  let tx: Decoded;
  try {
    tx = peer.deserializeTransaction(wire);
  } catch {
    return refusal("mpp/stacks-tx-malformed");
  }
  if (!equalBytes(peer.serializeTransactionBytes(tx), wire)) return refusal("mpp/stacks-tx-malformed");
  const memo = memoArgument(e.h)!;
  const payload = tx.payload as { payloadType?: unknown; functionName?: { content?: unknown }; functionArgs?: unknown };
  if (payload.payloadType !== peer.PayloadType.ContractCall || payload.functionName?.content !== "transfer") {
    return refusal("mpp/stacks-memo-not-h");
  }
  const args = Array.isArray(payload.functionArgs) ? payload.functionArgs : [];
  let fourth: string | undefined;
  try {
    fourth = args[3] === undefined ? undefined : `0x${peer.serializeCV(args[3])}`.toLowerCase();
  } catch {
    fourth = undefined;
  }
  if (fourth !== memo) return refusal("mpp/stacks-memo-not-h");
  return { h: e.h, checked: e.checked, wire, tx, peer };
}

async function stacksBound(input: unknown): Promise<AtrHash | Refusal> {
  const b = await stacksBinding(input);
  return isRefusal(b) ? b : b.h;
}

/**
 * The read keys of the decoded transaction: the profile's network, the called contract, the origin's c32 address and
 * spending-condition nonce, and, for a standard authorization, the transaction id.
 */
async function stacksReference(input: unknown): Promise<StacksRef | Refusal> {
  const b = await stacksBinding(input);
  if (isRefusal(b)) return b;
  const network = stacksNetworkOf(b.checked.details);
  if (network === undefined) return refusal("mpp/request-malformed");
  const { peer, tx } = b;
  const payload = tx.payload as unknown as { contractAddress: Parameters<StacksPeer["addressToString"]>[0]; contractName: { content: string } };
  const condition = tx.auth.spendingCondition;
  let origin: string;
  let contract: string;
  try {
    const net = tx.transactionVersion === 0 ? "mainnet" : "testnet";
    origin = peer.addressToString(
      peer.addressFromVersionHash(peer.addressHashModeToVersion(condition.hashMode, net), condition.signer),
    );
    contract = `${peer.addressToString(payload.contractAddress)}.${payload.contractName.content}`;
  } catch {
    return refusal("mpp/stacks-tx-malformed");
  }
  const ref: StacksRef = { network, contract, origin, nonce: BigInt(condition.nonce).toString() };
  return tx.auth.authType === peer.AuthType.Standard ? { ...ref, transaction: stacksTxid(b.wire) } : ref;
}

export const chargeUsdcStacks = Object.freeze({
  id: STACKS,
  pattern: pattern({
    pattern: "native-field",
    canonical: false,
    profile: "mpp/charge/usdc/stacks",
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
    publicProof: true,
    proves:
      "The payer signed a Stacks transaction whose SIP-010 transfer carries this ATR's hash as its memo argument. The " +
      "chain verified the signature, the transaction executed with status success, and the memo is in the mined " +
      "transaction on chain. " +
      LIMIT,
  }),
  claims: true as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise: advertiseAs(STACKS),
  read,
  build: stacksBuild,
  bound: stacksBound,
  reference: stacksReference,
  status: stacksStatus,
  recover: stacksRecover,
});

// ── mpp/charge/usdc/gateway.

/**
 * CAIP-10 of a TransferSpec `bytes32` account on `network`: on `eip155:*` the last 20 bytes as `0x` lowercase hex, the
 * first 12 being zero; on `solana:*` base58 of the 32 bytes. Anything else is undefined.
 */
export function gatewayAccount(network: string, word: unknown): string | undefined {
  if (typeof word !== "string" || !BYTES32.test(word)) return undefined;
  const b = bytesOf(word)!;
  if (network.startsWith("eip155:")) {
    if (b.subarray(0, 12).some((x) => x !== 0)) return undefined;
    return `${network}:0x${word.slice(26).toLowerCase()}`;
  }
  if (network.startsWith("solana:")) return `${network}:${keyString(b)}`;
  return undefined;
}

/** A Gateway uint256 as a decimal string without leading zeros, from a decimal string or a safe integer. */
function decimalOf(v: unknown): string | undefined {
  if (typeof v === "string" && UINT.test(v)) return BigInt(v).toString();
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return undefined;
}

/**
 * H from the echoed challenge, once the signed burn intent's TransferSpec salt equals `usdcGatewaySalt` over the
 * challenge and the credential's own values, by bytes. The layout read is `authorization.format` absent or
 * `circle-gateway-v1`, and `authorization.transfer` a SignedBurnIntent `{burnIntent: {maxBlockHeight, maxFee, spec},
 * signature}`; anything else is `mpp/gateway-unread`. No signature is verified and no value is compared.
 */
async function gatewayBound(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const e = echoedFor(credential, GATEWAY);
  if (isRefusal(e)) return e;
  const p = e.payload;
  if (p["type"] !== "transfer") return refusal("mpp/credential-type");
  const source = credential.source;
  const sourceNetwork = p["sourceNetwork"];
  const destinationNetwork = p["destinationNetwork"];
  if (typeof source !== "string" || typeof sourceNetwork !== "string" || typeof destinationNetwork !== "string") {
    return refusal("mpp/credential-malformed");
  }
  const a = p["authorization"];
  if (!isObject(a) || (a["format"] !== undefined && a["format"] !== GATEWAY_FORMAT)) return refusal("mpp/gateway-unread");
  const transfer = a["transfer"];
  if (!isObject(transfer) || transfer["burnIntentSet"] !== undefined || typeof transfer["signature"] !== "string") {
    return refusal("mpp/gateway-unread");
  }
  const intent = transfer["burnIntent"];
  const spec = isObject(intent) ? intent["spec"] : undefined;
  if (!isObject(intent) || !isObject(spec)) return refusal("mpp/gateway-unread");
  const salt = spec["salt"];
  const amount = decimalOf(spec["value"]);
  const maxFee = decimalOf(intent["maxFee"]);
  const sourceSigner = gatewayAccount(sourceNetwork, spec["sourceSigner"]);
  const destinationRecipient = gatewayAccount(destinationNetwork, spec["destinationRecipient"]);
  if (
    typeof salt !== "string" ||
    !BYTES32.test(salt) ||
    amount === undefined ||
    maxFee === undefined ||
    sourceSigner === undefined ||
    destinationRecipient === undefined
  ) {
    return refusal("mpp/gateway-unread");
  }
  const requestHash = await usdcRequestHash(credential.challenge.request);
  if (isRefusal(requestHash)) return requestHash;
  const expected = usdcGatewaySalt({
    id: credential.challenge.id,
    realm: credential.challenge.realm,
    requestHash,
    sourceNetwork,
    destinationNetwork,
    sourceDepositor: source,
    sourceSigner,
    recipient: str(e.checked.request["recipient"]),
    destinationRecipient,
    amount,
    maxFee,
  });
  if (isRefusal(expected)) return expected;
  return sameBytes(salt, expected) ? e.h : refusal("mpp/salt-not-usdc-derivation");
}

/**
 * The chosen challenge's values of the salt's preimage, as data: the buyer's Gateway client adds its own values,
 * computes `usdcGatewaySalt` and sets the result as `spec.salt` before signing. `complete` wraps the signed burn intent.
 */
async function gatewayBuild(choice: MppChoice, h: AtrHash) {
  if (!isObject(choice)) return refusal("mpp/input-malformed");
  const o = chosenFor(choice.challenge, h, GATEWAY);
  if (isRefusal(o)) return o;
  const requestHash = await usdcRequestHash(choice.challenge.request);
  if (isRefusal(requestHash)) return requestHash;
  const challenge = { ...choice.challenge };
  const preimage: GatewayPreimage = { id: challenge.id, realm: challenge.realm, requestHash, recipient: str(o.request["recipient"]) };
  return {
    request: { kind: "gateway-burn-intent" as const, preimage },
    complete(c: {
      source: string;
      sourceNetwork: string;
      destinationNetwork: string;
      maxFee: string;
      burnIntent: Json;
      signature: Hex;
    }): MppCredential | Refusal {
      if (!isObject(c) || !isObject(c.burnIntent) || !isHexBytes(c.signature, 1, MAX_SIGNATURE)) {
        return refusal("mpp/credential-malformed");
      }
      for (const k of ["source", "sourceNetwork", "destinationNetwork", "maxFee"] as const) {
        if (typeof c[k] !== "string" || c[k] === "") return refusal("mpp/credential-malformed");
      }
      return {
        challenge,
        source: c.source,
        payload: {
          type: "transfer",
          sourceNetwork: c.sourceNetwork,
          destinationNetwork: c.destinationNetwork,
          maxFee: c.maxFee,
          authorization: { format: GATEWAY_FORMAT, transfer: { burnIntent: c.burnIntent, signature: c.signature } },
        },
      };
    },
  };
}

export const chargeUsdcGateway = Object.freeze({
  id: GATEWAY,
  pattern: pattern({
    pattern: "id-reuse",
    canonical: true,
    buyerSigns: true,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: true,
    proves:
      "The payer signed a Circle Gateway burn intent whose TransferSpec salt is keccak256 of the JCS of this " +
      "challenge's id and parameters, and the id is this ATR's hash in base64url with the challenge's position. " +
      "Circle Gateway validated the signature. The salt travels inside the TransferSpec that the destination mint " +
      "carries, and the Gateway Minter emits that TransferSpec's keccak256 hash; this record reads no chain, and " +
      "settlement is the seller's report. " +
      LIMIT,
  }),
  claims: true as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise: advertiseAs(GATEWAY),
  read,
  build: gatewayBuild,
  bound: gatewayBound,
});
