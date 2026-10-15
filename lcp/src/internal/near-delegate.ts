/**
 * NEP-366's `DelegateAction` and `SignedDelegate` in borsh, as nearcore defines them (`DelegateAction` and
 * `SignedDelegateAction`), for the one shape `../near.ts` reads and writes: a delegate action holding one
 * `FunctionCall` action, under an Ed25519 or secp256k1 key, with a signature of either type. The schemas are written
 * for the borsh package. No entry point exports any name here.
 *
 * In borsh a `Vec<Action>` is its u32 length and each action, and an `Action` is its u8 variant index and its value;
 * `FunctionCall` is variant 2. The schemas write the one-action vector as two fields, the length 1 and the variant
 * index 2, then the `FunctionCall`, which gives the same bytes.
 */
import type * as Borsh from "borsh";
import type { Schema } from "borsh";
import { base58 } from "@scure/base";
import { sameBytes } from "../rail-bytes.js";

/** The NEP-461 prefix for a delegate action: (1 << 30) + 366. */
export const NEP461_DELEGATE = 1073742190;

/** A public key: 0 Ed25519 with its 32 bytes, 1 secp256k1 with its 64 bytes (x then y). */
export interface NearKey {
  keyType: 0 | 1;
  data: Uint8Array;
}

/** A delegate action holding one `FunctionCall` action. */
export interface FunctionCallDelegate {
  senderId: string;
  receiverId: string;
  functionCall: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint };
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: NearKey;
}

/** A signed delegate action: the delegate, and a 64-byte Ed25519 or 65-byte secp256k1 signature. */
export interface SignedFunctionCallDelegate {
  delegateAction: FunctionCallDelegate;
  signature: { keyType: 0 | 1; data: Uint8Array };
}

/** Why bytes are not a `SignedFunctionCallDelegate`, in the order they are read. */
export type DelegateRefused = "malformed" | "action-count" | "not-function-call";

const KEY_SIZES = [32, 64] as const;
const SIGNATURE_SIZES = [64, 65] as const;
const FUNCTION_CALL = 2;

const PUBLIC_KEY: Schema = {
  enum: [
    { struct: { ed25519: { array: { type: "u8", len: KEY_SIZES[0] } } } },
    { struct: { secp256k1: { array: { type: "u8", len: KEY_SIZES[1] } } } },
  ],
};
const SIGNATURE: Schema = {
  enum: [
    { struct: { ed25519: { array: { type: "u8", len: SIGNATURE_SIZES[0] } } } },
    { struct: { secp256k1: { array: { type: "u8", len: SIGNATURE_SIZES[1] } } } },
  ],
};
/** The delegate action's sender, receiver and count of actions. */
const HEAD: Schema = { struct: { senderId: "string", receiverId: "string", actionCount: "u32" } };
/** The head and the first action's variant index. */
const HEAD_AND_VARIANT: Schema = {
  struct: { senderId: "string", receiverId: "string", actionCount: "u32", variant: "u8" },
};
const DELEGATE_ACTION: Schema = {
  struct: {
    senderId: "string",
    receiverId: "string",
    actionCount: "u32",
    variant: "u8",
    functionCall: { struct: { methodName: "string", args: { array: { type: "u8" } }, gas: "u64", deposit: "u128" } },
    nonce: "u64",
    maxBlockHeight: "u64",
    publicKey: PUBLIC_KEY,
  },
};
const SIGNED_DELEGATE: Schema = { struct: { delegateAction: DELEGATE_ACTION, signature: SIGNATURE } };
const PREFIX: Schema = "u32";

type KeyValue = { ed25519: number[] | Uint8Array } | { secp256k1: number[] | Uint8Array };
type DelegateValue = {
  senderId: string;
  receiverId: string;
  actionCount: number;
  variant: number;
  functionCall: { methodName: string; args: number[] | Uint8Array; gas: bigint; deposit: bigint };
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: KeyValue;
};

function keyValue(k: { keyType: 0 | 1; data: Uint8Array }): KeyValue {
  return k.keyType === 0 ? { ed25519: k.data } : { secp256k1: k.data };
}

function keyOf(v: KeyValue): { keyType: 0 | 1; data: Uint8Array } {
  return "ed25519" in v ? { keyType: 0, data: Uint8Array.from(v.ed25519) } : { keyType: 1, data: Uint8Array.from(v.secp256k1) };
}

function delegateValue(d: FunctionCallDelegate): DelegateValue {
  return {
    senderId: d.senderId,
    receiverId: d.receiverId,
    actionCount: 1,
    variant: FUNCTION_CALL,
    functionCall: d.functionCall,
    nonce: d.nonce,
    maxBlockHeight: d.maxBlockHeight,
    publicKey: keyValue(d.publicKey),
  };
}

/** The borsh of a delegate action. */
export function encodeDelegateAction(borsh: typeof Borsh, d: FunctionCallDelegate): Uint8Array {
  return borsh.serialize(DELEGATE_ACTION, delegateValue(d));
}

/** What the delegate's key signs: the NEP-461 prefix, then the borsh of the delegate action. */
export function delegateMessage(borsh: typeof Borsh, d: FunctionCallDelegate): Uint8Array {
  const prefix = borsh.serialize(PREFIX, NEP461_DELEGATE);
  const action = encodeDelegateAction(borsh, d);
  const out = new Uint8Array(prefix.length + action.length);
  out.set(prefix);
  out.set(action, prefix.length);
  return out;
}

/** The borsh of a signed delegate action. */
export function encodeSignedDelegate(borsh: typeof Borsh, s: SignedFunctionCallDelegate): Uint8Array {
  return borsh.serialize(SIGNED_DELEGATE, { delegateAction: delegateValue(s.delegateAction), signature: keyValue(s.signature) });
}

/**
 * Reads a signed delegate action in the order of its bytes. The sender and receiver are read first, then the count of
 * actions: a count other than one is "action-count", and a first action whose variant index is not `FunctionCall`'s is
 * "not-function-call", the bytes after it unread. Otherwise the bytes must be exactly the borsh of the one-action
 * delegate and its signature, each key and signature Ed25519 or secp256k1, or they are "malformed". The borsh package
 * reads a string's bytes without checking them, so bytes that are not UTF-8 read as text whose encoding differs from
 * them, and the comparison with the re-encoding refuses them.
 */
export function decodeSignedDelegate(borsh: typeof Borsh, bytes: Uint8Array): SignedFunctionCallDelegate | DelegateRefused {
  let read: { delegateAction: DelegateValue; signature: KeyValue };
  try {
    const head = borsh.deserialize(HEAD, bytes) as { actionCount: number };
    if (head.actionCount !== 1) return "action-count";
    const first = borsh.deserialize(HEAD_AND_VARIANT, bytes) as { variant: number };
    if (first.variant !== FUNCTION_CALL) return "not-function-call";
    read = borsh.deserialize(SIGNED_DELEGATE, bytes) as typeof read;
    if (!sameBytes(borsh.serialize(SIGNED_DELEGATE, read), bytes)) return "malformed";
  } catch {
    return "malformed";
  }
  const da = read.delegateAction;
  const call = da.functionCall;
  return {
    delegateAction: {
      senderId: da.senderId,
      receiverId: da.receiverId,
      functionCall: { methodName: call.methodName, args: Uint8Array.from(call.args), gas: call.gas, deposit: call.deposit },
      nonce: da.nonce,
      maxBlockHeight: da.maxBlockHeight,
      publicKey: keyOf(da.publicKey),
    },
    signature: keyOf(read.signature),
  };
}

/** A public key written `ed25519:` and the base58 of its 32 bytes, or `secp256k1:` and the base58 of its 64; else null. */
export function nearKeyOf(text: unknown): NearKey | null {
  const m = typeof text === "string" ? /^(ed25519|secp256k1):([1-9A-HJ-NP-Za-km-z]{1,88})$/.exec(text) : null;
  if (m === null) return null;
  const keyType = m[1] === "ed25519" ? 0 : 1;
  let data: Uint8Array;
  try {
    data = base58.decode(m[2]!);
  } catch {
    return null;
  }
  return data.length === KEY_SIZES[keyType] ? { keyType, data } : null;
}

/** A public key as NEAR writes it: its type's name, `:`, and the base58 of its bytes. */
export function nearKeyText(k: NearKey): string {
  return `${k.keyType === 0 ? "ed25519" : "secp256k1"}:${base58.encode(k.data)}`;
}
