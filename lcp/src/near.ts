/**
 * NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose
 * `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it. Settlement is read from the
 * relayed transaction's receipts through a bounded reader.
 */
import type * as NearCrypto from "@near-js/crypto";
import type * as NearTransactions from "@near-js/transactions";
import type * as Borsh from "borsh";
import { fromLcpString, hash, parseJson, toLcpString, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { bytesOfHexDigits, decimalBelow } from "./rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  paymentWith,
  presentedWith,
  readFor,
  tie,
  type LcpPattern,
  type OptionFilter,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
  type X402Payment,
} from "./x402.js";

/** The optional peers, loaded once; undefined when any is not installed, and every function needing them refuses. */
const peer: { crypto: typeof NearCrypto; tx: typeof NearTransactions; borsh: typeof Borsh } | undefined = await Promise.all([
  import("@near-js/crypto"),
  import("@near-js/transactions"),
  import("borsh"),
]).then(
  ([crypto, tx, borsh]) => ({ crypto, tx, borsh }),
  () => undefined,
);
const PEER_MISSING = "near/peer-missing";

/** x402's NEAR network identifiers. */
export type NearNetwork = "near:mainnet" | "near:testnet";
/** The NEP-461 prefix for a delegate action: (1 << 30) + 366. */
export const NEP461_DELEGATE = 1073742190;
export const FT_TRANSFER_GAS = 30_000_000_000_000n;

export interface NearOutcome {
  /** `final_execution_status`. */
  status: "FINAL" | "EXECUTED" | string;
  delegate: null | { senderId: string; publicKey: string; nonce: bigint; argsBase64: string };
  receipts: readonly { executor: string; outcome: "success" | "failure" | "pending" }[];
}

/** Bounded, read-only calls against one network's RPC. Every failure rejects with `ReaderError`. */
export interface NearReader {
  readonly network: NearNetwork;
  /** The facilitator's `/supported` `signers["near:*"]`. */
  readonly relayers: readonly string[];
  /** `EXPERIMENTAL_tx_status` with `wait_until` "NONE"; null: unknown. */
  txStatus(txHash: string, sender: string): Promise<NearOutcome | null>;
  /** `block` at finality "final": its header's height. */
  finalHeight(): Promise<bigint>;
  /** `view_access_key` at "final": the key's nonce; null: no such key. */
  accessKeyNonce(account: string, publicKey: string): Promise<bigint | null>;
}

/** The read keys recorded at claim, JSON-serialisable: `nonce` and `maxBlockHeight` are decimal strings. `transaction` is
 * added when the facilitator names it. */
export interface NearRef {
  network: NearNetwork;
  asset: string;
  payer: string;
  publicKey: string;
  nonce: string;
  maxBlockHeight: string;
  transaction?: string;
}

export type NearStatus =
  | { state: "settled"; finality: "final" | "optimistic" }
  | { state: "pending"; why: "not-found" | "in-flight" | "unreadable" }
  | { state: "failed"; why: "not-this-instrument" | "transfer-failed" };

export type NearPayment = X402Payment<{ signedDelegateAction: string }>;

export interface NearChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  payer: string;
  /** `ed25519:…` or `secp256k1:…`. */
  publicKey: string;
  /** `view_access_key`'s nonce for the key. */
  accessKeyNonce: bigint;
  /** `block` at finality "final": its height. */
  finalHeight: bigint;
}

export interface NearUnsigned {
  /** SHA-256 of the NEP-461-prefixed delegate action: what the key signs. */
  request: { kind: "near-delegate"; hash: Uint8Array };
  /** Takes the key type (0 Ed25519, 1 secp256k1) and its 64- or 65-byte signature. */
  complete(signature: { keyType: 0 | 1; bytes: Uint8Array }): NearPayment | Refusal;
}

const ID = "x402/exact/near" as const;
const MAX_SDA_BASE64 = 8192;
const MAX_ARGS_BYTES = 4096;
const MAX_RELAYERS = 4;
const U128_LIMIT = 1n << 128n;
const U64_LIMIT = 1n << 64n;
const ACCOUNT = /^[a-z0-9._-]{2,64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * `ft_transfer`'s arguments: `receiver_id`, `amount` and `memo`, in that order, as `JSON.stringify` writes them. A value
 * that is not a 32-byte hash is `x402/payload-malformed`.
 */
export function ftTransferArgs(payTo: string, amount: string, h: AtrHash): Uint8Array | Refusal {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  return utf8.encode(JSON.stringify({ receiver_id: payTo, amount, memo: toLcpString(nh) }));
}

type Decoded = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: { [kind: string]: unknown }[];
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: { [kind: string]: { data: number[] | Uint8Array } };
  };
  signature: unknown;
};

/**
 * Reads a base64 `SignedDelegateAction` whose one action is a `FunctionCall` of `ft_transfer` with a JSON object of
 * arguments whose `memo` is an LCP string. The bytes must be exactly the borsh encoding of what is read.
 */
export function nearCarrier(signedDelegateAction: string): {
  h: AtrHash;
  payer: string;
  publicKey: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  asset: string;
} | Refusal {
  if (peer === undefined) return refusal(PEER_MISSING);
  if (typeof signedDelegateAction !== "string") return refusal("near/sda-malformed");
  if (signedDelegateAction.length > MAX_SDA_BASE64) return refusal("near/sda-too-large");
  if (signedDelegateAction.length === 0 || !BASE64.test(signedDelegateAction)) return refusal("near/sda-malformed");
  const bytes = Uint8Array.from(Buffer.from(signedDelegateAction, "base64"));
  let d: Decoded;
  try {
    d = peer.borsh.deserialize(peer.tx.SCHEMA.SignedDelegate, bytes) as Decoded;
    if (!sameBytes(peer.borsh.serialize(peer.tx.SCHEMA.SignedDelegate, d), bytes)) return refusal("near/sda-malformed");
  } catch {
    return refusal("near/sda-malformed");
  }
  const da = d.delegateAction;
  if (da.actions.length !== 1) return refusal("near/actions");
  const call = da.actions[0]!["functionCall"] as { methodName: string; args: number[] | Uint8Array } | undefined;
  if (call === undefined || call.methodName !== "ft_transfer") return refusal("near/not-ft-transfer");
  const memo = memoOf(Uint8Array.from(call.args));
  if (isRefusal(memo)) return memo;
  const publicKey = publicKeyString(da.publicKey);
  if (publicKey === null) return refusal("near/sda-malformed");
  return { h: memo, payer: da.senderId, publicKey, nonce: da.nonce, maxBlockHeight: da.maxBlockHeight, asset: da.receiverId };
}

/** The hash in the `memo` of a JSON object of `ft_transfer` arguments. */
function memoOf(args: Uint8Array): AtrHash | Refusal {
  if (args.length > MAX_ARGS_BYTES) return refusal("near/args-malformed");
  let parsed: unknown;
  try {
    parsed = parseJson(strictUtf8.decode(args));
  } catch {
    return refusal("near/args-malformed");
  }
  if (!isObject(parsed)) return refusal("near/args-malformed");
  const memo = parsed["memo"];
  if (typeof memo !== "string") return refusal("near/memo-missing");
  return fromLcpString(memo) ?? refusal("near/memo-not-lcp");
}

function publicKeyString(k: Decoded["delegateAction"]["publicKey"]): string | null {
  if (peer === undefined) return null;
  const { PublicKey } = peer.crypto;
  const ed = k["ed25519Key"];
  const secp = k["secp256k1Key"];
  try {
    if (ed !== undefined) return new PublicKey({ keyType: 0, data: Uint8Array.from(ed.data) }).toString();
    if (secp !== undefined) return new PublicKey({ keyType: 1, data: Uint8Array.from(secp.data) }).toString();
  } catch {
    return null;
  }
  return null;
}

// ── Settlement.

/**
 * Finds the relayed transaction under each published relayer (at most four), then requires its delegate to be this
 * instrument and reads the receipts the token contract executed: a failure is failed, a success is settled. A
 * failed read, an empty relayer list, or a reader for another network is pending.
 */
export async function nearStatus(ref: NearRef & { transaction: string }, reader: NearReader): Promise<NearStatus> {
  if (reader.network !== ref.network || !Array.isArray(reader.relayers) || reader.relayers.length === 0) {
    return { state: "pending", why: "unreadable" };
  }
  const outcome = await findOutcome(ref.transaction, reader);
  if (outcome === "unreadable") return { state: "pending", why: "unreadable" };
  if (outcome === null) return { state: "pending", why: "not-found" };
  const dg = outcome.delegate;
  const nonce = u64Of(ref.nonce);
  if (nonce === null) return { state: "pending", why: "unreadable" };
  if (dg === null || dg.senderId !== ref.payer || dg.publicKey !== ref.publicKey || dg.nonce !== nonce) {
    return { state: "failed", why: "not-this-instrument" };
  }
  const byToken = outcome.receipts.filter((r) => r.executor === ref.asset);
  if (byToken.some((r) => r.outcome === "failure")) return { state: "failed", why: "transfer-failed" };
  if (!byToken.some((r) => r.outcome === "success")) return { state: "pending", why: "in-flight" };
  const final = outcome.status === "EXECUTED" || outcome.status === "FINAL";
  return { state: "settled", finality: final ? "final" : "optimistic" };
}

/**
 * True only when the delegate action can never execute: the final height is past `maxBlockHeight` and the key's
 * nonce is below the action's, or the key is gone. Two calls; a failed read is false.
 */
export async function nearLapsed(ref: NearRef, reader: NearReader): Promise<boolean> {
  const maxBlockHeight = u64Of(ref.maxBlockHeight);
  const signed = u64Of(ref.nonce);
  if (reader.network !== ref.network || maxBlockHeight === null || signed === null) return false;
  try {
    const height = await reader.finalHeight();
    if (typeof height !== "bigint" || height <= maxBlockHeight) return false;
    const nonce = await reader.accessKeyNonce(ref.payer, ref.publicKey);
    return nonce === null || (typeof nonce === "bigint" && nonce < signed);
  } catch {
    return false;
  }
}

/** Recovers the hash from the settlement transaction: the `memo` in its delegated `ft_transfer` arguments. */
export async function nearRecover(ref: { network: NearNetwork; transaction: string }, reader: NearReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("near/wrong-reader");
  if (!Array.isArray(reader.relayers) || reader.relayers.length === 0) return refusal("near/no-relayer");
  const outcome = await findOutcome(ref.transaction, reader);
  if (outcome === "unreadable") return refusal("near/unreadable");
  if (outcome === null || outcome.delegate === null) return refusal("near/not-found");
  const args = outcome.delegate.argsBase64;
  if (typeof args !== "string" || !BASE64.test(args)) return refusal("near/args-malformed");
  return memoOf(Uint8Array.from(Buffer.from(args, "base64")));
}

async function findOutcome(txHash: string, reader: NearReader): Promise<NearOutcome | null | "unreadable"> {
  for (const relayer of reader.relayers.slice(0, MAX_RELAYERS)) {
    let o: NearOutcome | null;
    try {
      o = await reader.txStatus(txHash, relayer);
    } catch {
      return "unreadable";
    }
    if (o === null) continue;
    return isOutcome(o) ? o : "unreadable";
  }
  return null;
}

function isOutcome(o: unknown): o is NearOutcome {
  if (!isObject(o) || typeof o["status"] !== "string" || !Array.isArray(o["receipts"])) return false;
  const d = o["delegate"];
  if (d !== null) {
    if (!isObject(d)) return false;
    if (typeof d["senderId"] !== "string" || typeof d["publicKey"] !== "string" || typeof d["nonce"] !== "bigint") {
      return false;
    }
    if (typeof d["argsBase64"] !== "string") return false;
  }
  return o["receipts"].every((r) => isObject(r) && typeof r["executor"] === "string" && typeof r["outcome"] === "string");
}

// ── The pairing.

const check: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact") return refusal("x402/option-not-this-pairing");
  if (typeof o.network !== "string" || !o.network.startsWith("near:")) return refusal("x402/option-not-this-pairing");
  const extra: unknown = o.extra;
  if (extra !== undefined && !isObject(extra)) return refusal("near/option-malformed");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  if (o.network !== "near:mainnet" && o.network !== "near:testnet") return refusal("near/network-malformed");
  if (typeof o.asset !== "string" || !ACCOUNT.test(o.asset)) return refusal("near/option-malformed");
  if (typeof o.payTo !== "string" || !ACCOUNT.test(o.payTo)) return refusal("near/option-malformed");
  if (decimalBelow(o.amount, U128_LIMIT) === undefined) return refusal("near/option-malformed");
  if (!Number.isSafeInteger(o.maxTimeoutSeconds) || o.maxTimeoutSeconds < 1) return refusal("near/option-malformed");
  return true;
};

/** This pairing's id for an option it can pay, or undefined. */
export function pairingOf(option: PaymentRequirements): typeof ID | undefined {
  return check(option) === true ? ID : undefined;
}

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(check)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(check)(doc);
}

/** The delegate action for the chosen option: one `ft_transfer` whose memo is the hash's LCP string. */
async function build(c: NearChoice, h: AtrHash): Promise<NearUnsigned | Refusal> {
  if (peer === undefined) return refusal(PEER_MISSING);
  const { PublicKey } = peer.crypto;
  const { SignedDelegate, Signature, actionCreators, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate } = peer.tx;
  if (!isObject(c)) return refusal("x402/option-malformed");
  const { required, accepted, payer, publicKey, accessKeyNonce, finalHeight } = c;
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (typeof payer !== "string" || !ACCOUNT.test(payer)) return refusal("x402/option-malformed");
  let key: NearCrypto.PublicKey;
  try {
    key = PublicKey.fromString(publicKey);
  } catch {
    return refusal("x402/option-malformed");
  }
  if (typeof accessKeyNonce !== "bigint" || accessKeyNonce < 0n || accessKeyNonce + 1n >= U64_LIMIT) {
    return refusal("x402/option-malformed");
  }
  const window = BigInt(Math.max(1, accepted.maxTimeoutSeconds));
  if (typeof finalHeight !== "bigint" || finalHeight < 0n || finalHeight + window >= U64_LIMIT) {
    return refusal("x402/option-malformed");
  }
  const args = ftTransferArgs(accepted.payTo, accepted.amount, nh);
  if (isRefusal(args)) return args;
  const delegateAction = buildDelegateAction({
    senderId: payer,
    receiverId: accepted.asset,
    actions: [actionCreators.functionCall("ft_transfer", args, FT_TRANSFER_GAS, 1n)],
    nonce: accessKeyNonce + 1n,
    maxBlockHeight: finalHeight + window,
    publicKey: key,
  });
  const digest = await hash(encodeDelegateAction(delegateAction));
  return {
    request: { kind: "near-delegate", hash: bytesOfHexDigits(digest.slice(2))! },
    complete(signature: { keyType: 0 | 1; bytes: Uint8Array }): NearPayment | Refusal {
      if (!isObject(signature) || !(signature.bytes instanceof Uint8Array)) return refusal("x402/signature-malformed");
      const { keyType, bytes } = signature;
      if (!((keyType === 0 && bytes.length === 64) || (keyType === 1 && bytes.length === 65))) {
        return refusal("x402/signature-malformed");
      }
      const signed = new SignedDelegate({
        delegateAction,
        signature: new Signature({ keyType, data: Uint8Array.from(bytes) }),
      });
      const signedDelegateAction = Buffer.from(encodeSignedDelegate(signed)).toString("base64");
      return paymentWith(required, accepted, { signedDelegateAction });
    },
  };
}

function carried(presented: unknown): { accepted: PaymentRequirements; c: Exclude<ReturnType<typeof nearCarrier>, Refusal> } | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const sda = p.payload["signedDelegateAction"];
  if (typeof sda !== "string") return refusal("x402/payload-malformed");
  const c = nearCarrier(sda);
  return isRefusal(c) ? c : { accepted: p.accepted, c };
}

/**
 * The hash in the memo of the `ft_transfer` the payer's delegate action signs. The signature is not verified here;
 * the facilitator verifies it, and the runtime checks it against the account's key before executing.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = carried(presented);
  return isRefusal(r) ? r : r.c.h;
}

/** The read keys, from the signed delegate action: the token, the payer, its key and the nonce, and the window. */
async function reference(presented: unknown): Promise<NearRef | Refusal> {
  const r = carried(presented);
  if (isRefusal(r)) return r;
  const { asset, payer, publicKey, nonce, maxBlockHeight } = r.c;
  return {
    network: r.accepted.network as NearNetwork,
    asset,
    payer,
    publicKey,
    nonce: nonce.toString(),
    maxBlockHeight: maxBlockHeight.toString(),
  };
}

/** The option unchanged: on this pairing the hash rides in the signed arguments, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

/** A decimal string below 2^64 as a bigint, or null. */
function u64Of(s: unknown): bigint | null {
  if (typeof s !== "string" || !/^[0-9]{1,20}$/.test(s)) return null;
  const v = BigInt(s);
  return v < U64_LIMIT ? v : null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: "x402/exact/near/memo",
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a NEP-366 delegate action whose one ft_transfer carries this ATR's hash in its memo, in LCP " +
    "string form. The runtime verified that signature and executed the transfer on the token contract, and the memo " +
    "is on chain in the delegated call's arguments. This does not show that amount, receiver, token or timing match " +
    "the ATR's content.",
});

export const exactNear = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: nearStatus,
  recover: nearRecover,
});


