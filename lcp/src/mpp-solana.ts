/**
 * `mpp/charge/solana`: the ATR hash in LCP string form as the request's `externalId`, which the payer signs as the one
 * Memo instruction of the transaction whose data parses as an LCP string. Other Memo instructions, such as split
 * labels, are not read.
 */
import { fromLcpString, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import {
  COMPUTE_BUDGET,
  MEMO_V3,
  MEMO_V4,
  SYSTEM,
  buildSvmMessage,
  canonicalCarrier,
  compileV0,
  decodeSvmTx,
  keyBytes,
  svmReference,
  svmStatus,
  toBase64,
  signedWire,
  staticNonce,
  wireOf,
  type SolanaNetwork,
  type SvmLanded,
  type SvmReader,
  type SvmRef,
  type SvmTx,
} from "./internal/svm.js";
import {
  chosenFor,
  credentialOf,
  deepFreeze,
  echoedFor,
  isObject,
  placeCarrier,
  pushedField,
  read,
  tie,
  type Checked,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { solanaNetworkOf } from "./mpp-rail-checks.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

const ID = "mpp/charge/solana" as const;

/** What differs between the Solana charges of MPP's `solana` method and of `usdc`'s Solana profile. */
export interface SolanaCharge<Id extends "mpp/charge/solana" | "mpp/charge/usdc/solana"> {
  id: Id;
  /** The Solana details object of a checked challenge. */
  details(c: Checked): { [k: string]: Json };
  /** Whether the details must name `network`. */
  networkRequired: boolean;
  /** The refusal for an issued `externalId` that holds another value. */
  occupied: string;
  /** Whether the only credential accepted is `type="transaction"` (pull mode); `bundle` and `signature` are refused. */
  transactionOnly: boolean;
}

const SOLANA: SolanaCharge<typeof ID> = {
  id: ID,
  details: (c) => c.details,
  networkRequired: false,
  occupied: "svm/carrier-occupied",
  transactionOnly: false,
};
const MAX_BUNDLE = 8;
const MEMO_V3_KEY = keyBytes(MEMO_V3)!;
const MEMO_V4_KEY = keyBytes(MEMO_V4)!;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The buyer's inputs to `build`. The request's `decimals`, `tokenProgram` and `recentBlockhash` win when present. */
export interface SolanaChargeChoice {
  challenge: MppChallenge & { id: string };
  payer: string;
  decimals?: number;
  tokenProgram?: string;
  recentBlockhash?: string;
  computeUnitLimit?: number;
  computeUnitPrice?: bigint;
}

export interface SolanaChargeUnsigned {
  request: { kind: "solana-message"; message: Uint8Array };
  /** The payer's 64-byte Ed25519 signature over `message`. */
  complete(signature: Uint8Array): MppCredential | Refusal;
}

function sameKey(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The one top-level Memo instruction (v3 or v4) whose UTF-8 data parses as an LCP string, and its hash. Memo
 * instructions whose data is not an LCP string are not read. None is `svm/no-carrier`; more than one `svm/memo-count`.
 * The one found must be `toLcpString(h)` exactly, in lowercase hex, else `svm/carrier-not-canonical`.
 */
export function mppSvmCarrier(tx: SvmTx): { h: AtrHash; memo: string } | Refusal {
  const found: { h: AtrHash; memo: string }[] = [];
  for (const ix of tx.instructions) {
    const program = tx.keys[ix.program];
    if (!sameKey(program, MEMO_V3_KEY) && !sameKey(program, MEMO_V4_KEY)) continue;
    let memo: string;
    try {
      memo = UTF8.decode(ix.data);
    } catch {
      continue;
    }
    const h = fromLcpString(memo);
    if (h !== null) found.push({ h, memo });
  }
  if (found.length === 0) return refusal("svm/no-carrier");
  if (found.length > 1) return refusal("svm/memo-count");
  return canonicalCarrier(found[0]!.h, found[0]!.memo);
}

/**
 * The signed transaction a credential presents: the one of `transaction`, the last of a `bundle`, or a fetched one.
 * Under `transactionOnly`, any type but `transaction` is `mpp/credential-type`.
 */
function presentedTx(payload: { [k: string]: Json }, transactionOnly: boolean): SvmTx | Refusal {
  const type = payload["type"];
  let b64: Json | undefined;
  if (type === "transaction") b64 = payload["transaction"];
  else if (transactionOnly) return refusal("mpp/credential-type");
  else if (type === "bundle") {
    const list = payload["transactions"];
    if (!Array.isArray(list) || list.length > MAX_BUNDLE) return refusal("svm/tx-malformed");
    if (list.length === 0) return refusal("svm/bundle-empty");
    b64 = list[list.length - 1];
  } else if (type === "signature") {
    if (payload["transaction"] === undefined) return refusal("svm/read-first");
    b64 = payload["transaction"];
  } else return refusal("mpp/credential-type");
  const wire = wireOf(b64);
  return isRefusal(wire) ? wire : decodeSvmTx(wire);
}

function bindingOf(
  spec: SolanaCharge<typeof ID | "mpp/charge/usdc/solana">,
  credential: MppCredential,
): { h: AtrHash; checked: Checked; tx: SvmTx } | Refusal {
  const e = echoedFor(credential, spec.id);
  if (isRefusal(e)) return e;
  const tx = presentedTx(e.payload, spec.transactionOnly);
  if (isRefusal(tx)) return tx;
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const carrier = mppSvmCarrier(tx);
  if (isRefusal(carrier)) return carrier;
  if (carrier.memo !== e.checked.request["externalId"]) return refusal("svm/carrier-mismatch");
  if (!hashEquals(carrier.h, e.h)) return refusal("mpp/carrier-not-challenge");
  return { h: e.h, checked: e.checked, tx };
}

/** H from the echoed challenge, once the signed LCP memo equals the request's `externalId` and names that H. */
async function bound(spec: SolanaCharge<typeof ID | "mpp/charge/usdc/solana">, input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(spec, credential);
  return isRefusal(b) ? b : b.h;
}

/** The read keys of the signed transaction (for a bundle, its last), on the request's network. */
async function reference(
  spec: SolanaCharge<typeof ID | "mpp/charge/usdc/solana">,
  input: unknown,
): Promise<Omit<SvmRef, "fromSlot"> | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const b = bindingOf(spec, credential);
  if (isRefusal(b)) return b;
  const network = solanaNetworkOf(spec.details(b.checked), spec.networkRequired);
  if (network === null) return refusal("svm/network-undeclared");
  if (typeof network !== "string") return network;
  const ref = await svmReference(network, b.tx);
  if (isRefusal(ref)) return ref;
  const signature = credential.payload["signature"];
  return credential.payload["type"] === "signature" && typeof signature === "string" ? { ...ref, transaction: signature } : ref;
}

/**
 * A push credential (`type="signature"`) with the landed wire added as `transaction`, read at `confirmed`. Other
 * credentials are returned unchanged. A read that fails, or finds nothing, is a refusal the seller retries; a landed
 * transaction that failed with an error is refused `svm/err`.
 */
async function fetchPresented(
  spec: SolanaCharge<typeof ID | "mpp/charge/usdc/solana">,
  credential: MppCredential,
  reader: SvmReader,
): Promise<MppCredential | Refusal> {
  if (!isObject(credential) || carriesRefused(credential) || !isObject(credential.payload)) {
    return refusal("mpp/credential-malformed");
  }
  if (credential.payload["type"] !== "signature") return credential;
  const e = echoedFor(credential, spec.id);
  if (isRefusal(e)) return e;
  const network = solanaNetworkOf(spec.details(e.checked), spec.networkRequired);
  if (network === null) return refusal("svm/network-undeclared");
  if (typeof network !== "string") return network;
  if (reader.network !== network) return refusal("svm/wrong-reader");
  const signature = credential.payload["signature"];
  if (!isSignatureText(signature)) return refusal("mpp/credential-malformed");
  let landed: SvmLanded | null;
  try {
    landed = await reader.transaction(signature, "confirmed");
  } catch {
    return refusal("svm/unreadable");
  }
  if (landed === null) return refusal("svm/not-found");
  if (!isObject(landed) || !(landed.wire instanceof Uint8Array)) return refusal("svm/unreadable");
  if (landed.err !== null && landed.err !== undefined) return refusal("svm/err");
  return { ...credential, payload: { ...credential.payload, transaction: toBase64(landed.wire) } };
}

/** A base58 Ed25519 signature's text: 64 to 88 base58 characters. */
function isSignatureText(s: unknown): s is string {
  return typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(s);
}

/** Zero-party: the one LCP memo of the landed transaction, read at `finalized`, then `confirmed`. */
async function recover(ref: { network: SolanaNetwork; transaction: string }, reader: SvmReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("svm/wrong-reader");
  let landed: SvmLanded | null = null;
  try {
    landed = (await reader.transaction(ref.transaction, "finalized")) ?? (await reader.transaction(ref.transaction, "confirmed"));
  } catch {
    return refusal("svm/unreadable");
  }
  if (landed === null) return refusal("svm/not-found");
  if (!isObject(landed) || !(landed.wire instanceof Uint8Array)) return refusal("svm/unreadable");
  if (landed.err !== null && landed.err !== undefined) return refusal("svm/err");
  const tx = decodeSvmTx(landed.wire);
  if (isRefusal(tx)) return tx;
  const c = mppSvmCarrier(tx);
  return isRefusal(c) ? c : c.h;
}

function u64le(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

function u32le(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v, true);
  return out;
}

/**
 * The versioned message for a native SOL charge: `SetComputeUnitLimit`, `SetComputeUnitPrice`, System `transfer` of
 * `lamports` from the payer to the recipient, then one v3 Memo instruction carrying `memo`.
 */
async function buildSolMessage(i: {
  feePayer: string;
  payer: string;
  payTo: string;
  lamports: bigint;
  recentBlockhash: string;
  memo: string;
  computeUnitLimit: number;
  computeUnitPrice: bigint;
}): Promise<Uint8Array | Refusal> {
  let kit: typeof import("@solana/kit");
  try {
    kit = await import("@solana/kit");
  } catch {
    return refusal("svm/peer-missing");
  }
  const { AccountRole, address } = kit;
  const data = new Uint8Array(12);
  data.set(u32le(2), 0);
  data.set(u64le(i.lamports), 4);
  return compileV0(i.feePayer, i.recentBlockhash, [
    { programAddress: address(COMPUTE_BUDGET), data: Uint8Array.of(2, ...u32le(i.computeUnitLimit)) },
    { programAddress: address(COMPUTE_BUDGET), data: Uint8Array.of(3, ...u64le(i.computeUnitPrice)) },
    {
      programAddress: address(SYSTEM),
      accounts: [
        { address: address(i.payer), role: AccountRole.WRITABLE_SIGNER },
        { address: address(i.payTo), role: AccountRole.WRITABLE },
      ],
      data,
    },
    { programAddress: address(MEMO_V3), data: new TextEncoder().encode(i.memo) },
  ]);
}

/**
 * The message for the payer to sign: the request's transfer (a token `TransferChecked`, or a System `transfer` for
 * `"sol"`) with the memo the request's `externalId` carries, which must be this H's LCP string. Splits and confidential
 * transfers are not built.
 */
async function build(
  spec: SolanaCharge<typeof ID | "mpp/charge/usdc/solana">,
  choice: SolanaChargeChoice,
  h: AtrHash,
): Promise<SolanaChargeUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("svm/input-malformed");
  const checked = chosenFor(choice.challenge, h, spec.id);
  if (isRefusal(checked)) return checked;
  const r = checked.request;
  const d = spec.details(checked);
  const memo = toLcpString(h);
  if (r["externalId"] !== memo) return refusal("svm/carrier-mismatch");
  if (d["splits"] !== undefined || d["confidential"] === true) return refusal("svm/input-malformed");
  if (keyBytes(choice.payer) === null) return refusal("svm/input-malformed");
  const feePayer = d["feePayer"] === true ? (d["feePayerKey"] as string) : choice.payer;
  const recentBlockhash = typeof d["recentBlockhash"] === "string" ? d["recentBlockhash"] : choice.recentBlockhash;
  if (typeof recentBlockhash !== "string") return refusal("svm/input-malformed");
  const computeUnitLimit = choice.computeUnitLimit ?? 40_000;
  const computeUnitPrice = choice.computeUnitPrice ?? 1n;
  if (!Number.isInteger(computeUnitLimit) || computeUnitLimit < 0 || computeUnitLimit > 0xffffffff) {
    return refusal("svm/input-malformed");
  }
  if (typeof computeUnitPrice !== "bigint" || computeUnitPrice < 0n || computeUnitPrice >= 1n << 64n) {
    return refusal("svm/input-malformed");
  }
  const amount = BigInt(r["amount"] as string);
  let message: Uint8Array | Refusal;
  if (r["currency"] === "sol") {
    message = await buildSolMessage({
      feePayer,
      payer: choice.payer,
      payTo: r["recipient"] as string,
      lamports: amount,
      recentBlockhash,
      memo,
      computeUnitLimit,
      computeUnitPrice,
    });
  } else {
    const decimals = typeof d["decimals"] === "number" ? d["decimals"] : choice.decimals;
    const tokenProgram = typeof d["tokenProgram"] === "string" ? d["tokenProgram"] : choice.tokenProgram;
    if (typeof decimals !== "number" || typeof tokenProgram !== "string") return refusal("svm/input-malformed");
    message = await buildSvmMessage({
      feePayer,
      payer: choice.payer,
      mint: r["currency"] as string,
      tokenProgram,
      decimals,
      payTo: r["recipient"] as string,
      amount,
      recentBlockhash,
      memo,
      computeUnitLimit,
      computeUnitPrice,
    });
  }
  if (isRefusal(message)) return message;
  const signedMessage = message;
  const challenge = choice.challenge;
  return {
    request: { kind: "solana-message", message: signedMessage },
    complete(signature: Uint8Array): MppCredential | Refusal {
      const wire = signedWire(signedMessage, choice.payer, signature);
      if (isRefusal(wire)) return wire;
      return { challenge, payload: { type: "transaction", transaction: toBase64(wire) } };
    },
  };
}

/** The placement: MPP's `place`, then `externalId` set to H's LCP string. */
function advertise(
  spec: SolanaCharge<typeof ID | "mpp/charge/usdc/solana">,
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  const memo = toLcpString(h);
  return placeCarrier(
    doc,
    h,
    link,
    offer,
    (issued) => (issued === undefined || issued === memo ? memo : refusal(spec.occupied)),
    agreementUrl,
  );
}

/** The challenge as issued: H rides in `externalId`, which the digest of what was issued leaves out. */
function unplaced(option: MppChallenge): MppChallenge {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: "mpp/charge/solana",
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, " +
    "and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's " +
    "instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.",
});

/** The members of the Solana charge pairing `spec` describes, pull mode only. */
function pullPairing<Id extends typeof ID | "mpp/charge/usdc/solana">(spec: SolanaCharge<Id>) {
  return {
    id: spec.id,
    pattern,
    claims: true as boolean,
    carrier: "request.externalId" as const,
    unplaced,
    tie,
    advertise: (doc: readonly MppChallenge[], h: AtrHash, link: string, offer: MppChallenge, agreementUrl?: string) =>
      advertise(spec, doc, h, link, offer, agreementUrl),
    read,
    build: (choice: SolanaChargeChoice, h: AtrHash) => build(spec, choice, h),
    bound: (input: unknown) => bound(spec, input),
    reference: (input: unknown) => reference(spec, input),
    status: svmStatus,
    recover,
  };
}

/** A Solana charge pairing that accepts only `type="transaction"` credentials, so it reads no landed payment. */
export function solanaChargePairing<Id extends typeof ID | "mpp/charge/usdc/solana">(spec: Omit<SolanaCharge<Id>, "transactionOnly">) {
  return Object.freeze(pullPairing({ ...spec, transactionOnly: true }));
}

export const chargeSolana = Object.freeze({
  ...pullPairing(SOLANA),
  fetchPresented: (credential: MppCredential, reader: SvmReader) => fetchPresented(SOLANA, credential, reader),
  landedTx: (presented: unknown): string | undefined => {
    const signature = pushedField(presented, "signature", "signature");
    return isSignatureText(signature) ? signature : undefined;
  },
});
