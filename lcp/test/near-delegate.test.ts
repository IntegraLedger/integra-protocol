// NEP-366's DelegateAction and SignedDelegate as the NEAR pairing writes and reads them, held byte for byte to NEAR's
// own JavaScript library, near-api-js 7.3.1 (its SCHEMA, buildDelegateAction, encodeDelegateAction,
// encodeSignedDelegate, PublicKey and Signature), both ways: near-api-js reads what the pairing writes, and the pairing
// reads what near-api-js writes. The cases are every signed delegate action in x402-exact-near.json, and two generated
// sweeps of 2,048 cases each: the delegate itself (accounts, method names, arguments, gas, deposit, nonces, heights,
// keys and signatures of both types), and the pairing's build and complete (accounts, amounts, nonces, heights,
// timeouts, and keys of both types). The sweeps draw their bytes from SHA-256 of a label and a counter.
import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import * as borsh from "borsh";
import {
  actions,
  buildDelegateAction,
  encodeDelegateAction,
  encodeSignedDelegate,
  PublicKey,
  SCHEMA,
  Signature,
} from "near-api-js";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/core.js";
import {
  decodeSignedDelegate,
  delegateMessage,
  encodeSignedDelegate as lcpEncodeSignedDelegate,
  nearKeyOf,
  nearKeyText,
  type FunctionCallDelegate,
  type SignedFunctionCallDelegate,
} from "../src/internal/near-delegate.js";
import { exactNear, FT_TRANSFER_GAS, ftTransferArgs, nearCarrier } from "../src/near.js";
import { fromBase64, toBase64 } from "../src/rail-bytes.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));
const SWEEP = 2048;
/** Each sweep's bound: its time grows with the machine's load. */
const SWEEP_MS = 300_000;

/** A byte source: SHA-256 of `${label}:${counter}`, one digest after another. */
function bytesFrom(label: string): (n: number) => Uint8Array {
  const utf8 = new TextEncoder();
  let counter = 0;
  let block = new Uint8Array(0);
  let at = 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (at === block.length) {
        block = sha256(utf8.encode(`${label}:${counter++}`));
        at = 0;
      }
      out[i] = block[at++]!;
    }
    return out;
  };
}

const unsigned = (b: Uint8Array) => b.reduceRight((v, x) => (v << 8n) | BigInt(x), 0n);

/** Random draws over a byte source. */
function draws(label: string) {
  const take = bytesFrom(label);
  const below = (n: number) => Number(unsigned(take(4)) % BigInt(n));
  const alphabet = (chars: string, n: number) => Array.from({ length: n }, () => chars[below(chars.length)]!).join("");
  const hex = (n: number) => Array.from(take(n), (x) => x.toString(16).padStart(2, "0")).join("");
  /** u64 and u128 values, a quarter of them at an edge: 0, 1, the largest, or one below it. */
  const uint = (bits: 64 | 128) => {
    const max = (1n << BigInt(bits)) - 1n;
    const edge = below(16);
    if (edge < 4) return [0n, 1n, max, max - 1n][edge]!;
    return unsigned(take(bits / 8)) >> BigInt(below(bits));
  };
  /**
   * A NEAR account id (nearcore's account id rules): an implicit account of 64 hex digits, an Ethereum-implicit `0x`
   * and 40, or one to four named parts of 1 to 12 lowercase letters and digits joined by `.`, `-` or `_`, then a
   * top-level account: 4 to 59 characters.
   */
  const account = () => {
    const form = below(4);
    if (form === 0) return hex(32);
    if (form === 1) return `0x${hex(20)}`;
    const parts = Array.from({ length: 1 + below(4) }, () => alphabet("abcdefghijklmnopqrstuvwxyz0123456789", 1 + below(12)));
    const named = parts.map((p, i) => (i === 0 ? p : `${".-_"[below(3)]}${p}`)).join("");
    return `${named}.${["near", "testnet", "tg"][below(3)]}`;
  };
  const key = (): { keyType: 0 | 1; data: Uint8Array } => (below(2) === 0 ? { keyType: 0, data: take(32) } : { keyType: 1, data: take(64) });
  return { take, below, alphabet, uint, account, key };
}

/** near-api-js's values for a delegate holding one FunctionCall. */
function nearApiDelegate(d: FunctionCallDelegate) {
  return buildDelegateAction({
    senderId: d.senderId,
    receiverId: d.receiverId,
    actions: [actions.functionCall(d.functionCall.methodName, d.functionCall.args, d.functionCall.gas, d.functionCall.deposit)],
    nonce: d.nonce,
    maxBlockHeight: d.maxBlockHeight,
    publicKey: new PublicKey({ keyType: d.publicKey.keyType, data: d.publicKey.data }),
  });
}

function nearApiSigned(s: SignedFunctionCallDelegate): Uint8Array {
  return encodeSignedDelegate({
    delegateAction: nearApiDelegate(s.delegateAction),
    signature: new Signature({ keyType: s.signature.keyType, data: s.signature.data }),
  } as never);
}

type NearApiRead = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: { functionCall?: { methodName: string; args: number[]; gas: bigint; deposit: bigint } }[];
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: { ed25519Key?: { data: number[] }; secp256k1Key?: { data: number[] } };
  };
  signature: { ed25519Signature?: { data: number[] }; secp256k1Signature?: { data: number[] } };
};

/** What near-api-js reads from bytes, in the form decodeSignedDelegate gives; null when it reads anything else. */
function nearApiRead(bytes: Uint8Array): SignedFunctionCallDelegate | null {
  let r: NearApiRead;
  try {
    r = borsh.deserialize(SCHEMA.SignedDelegate, bytes) as NearApiRead;
    if (Buffer.compare(Buffer.from(borsh.serialize(SCHEMA.SignedDelegate, r)), Buffer.from(bytes)) !== 0) return null;
  } catch {
    return null;
  }
  const da = r.delegateAction;
  const call = da.actions.length === 1 ? da.actions[0]!.functionCall : undefined;
  const k = da.publicKey;
  const s = r.signature;
  const key = k.ed25519Key ? { keyType: 0 as const, data: k.ed25519Key.data } : k.secp256k1Key ? { keyType: 1 as const, data: k.secp256k1Key.data } : null;
  const sig = s.ed25519Signature
    ? { keyType: 0 as const, data: s.ed25519Signature.data }
    : s.secp256k1Signature
      ? { keyType: 1 as const, data: s.secp256k1Signature.data }
      : null;
  if (call === undefined || key === null || sig === null) return null;
  return {
    delegateAction: {
      senderId: da.senderId,
      receiverId: da.receiverId,
      functionCall: { methodName: call.methodName, args: Uint8Array.from(call.args), gas: call.gas, deposit: call.deposit },
      nonce: da.nonce,
      maxBlockHeight: da.maxBlockHeight,
      publicKey: { keyType: key.keyType, data: Uint8Array.from(key.data) },
    },
    signature: { keyType: sig.keyType, data: Uint8Array.from(sig.data) },
  };
}

/** Every signed delegate action in a vector file: each string under a member named as one. */
function signedDelegatesIn(v: unknown, path: string, out: [string, string][]): [string, string][] {
  if (Array.isArray(v)) v.forEach((x, i) => signedDelegatesIn(x, `${path}/${i}`, out));
  else if (typeof v === "object" && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "signedDelegateAction" || k === "expectSignedDelegateAction") && typeof x === "string") out.push([`${path}/${k}`, x]);
      else signedDelegatesIn(x, `${path}/${k}`, out);
    }
  }
  return out;
}

describe("NEP-366 delegate actions against near-api-js 7.3.1", () => {
  it("every signed delegate action in x402-exact-near.json: each reader reads what the other reads, and both write its bytes", () => {
    // V2's and the secp256k1 vector's, V2's four refusals, eleven agreedRefusals rows and one buyer row.
    const all = rowsOf(signedDelegatesIn(V, "", []), "x402-exact-near.json, every signedDelegateAction", { exact: 17 });
    const read: string[] = [];
    for (const [where, text] of all) {
      const bytes = fromBase64(text);
      if (bytes === null || text === "") continue;
      const ours = decodeSignedDelegate(borsh, bytes);
      const theirs = nearApiRead(bytes);
      if (theirs === null) {
        expect([where, typeof ours]).toEqual([where, "string"]);
        continue;
      }
      expect([where, ours]).toEqual([where, theirs]);
      expect([where, lcpEncodeSignedDelegate(borsh, theirs)]).toEqual([where, bytes]);
      expect([where, nearApiSigned(theirs as SignedFunctionCallDelegate)]).toEqual([where, bytes]);
      read.push(where);
    }
    // The ones near-api-js reads as a one-action delegate. Of the others, near-api-js reads no delegate of one
    // FunctionCall from the bytes, or the text is not base64 in its canonical form.
    expect(read).toEqual([
      "/V2/expectSignedDelegateAction",
      "/V2/refusals/0/signedDelegateAction",
      "/V2/refusals/1/signedDelegateAction",
      "/V2/refusals/2/signedDelegateAction",
      "/agreedRefusals/rows/7/signedDelegateAction",
      "/agreedRefusals/rows/16/signedDelegateAction",
      "/buyer/rows/1/input/presented/payload/signedDelegateAction",
      "/secp256k1/expectSignedDelegateAction",
    ]);
  });

  it(`a sweep of ${SWEEP} delegates: the same bytes from both writers, and each reads the other's`, { timeout: SWEEP_MS }, () => {
    const r = draws("near-delegate");
    const methods = ["ft_transfer", "ft_transfer_call", "storage_deposit", ""];
    const names = ["payer-é.near", "\u{1F600}.near"];
    for (let i = 0; i < SWEEP; i++) {
      const key = r.key();
      const sig = r.below(2) === 0 ? { keyType: 0 as const, data: r.take(64) } : { keyType: 1 as const, data: r.take(65) };
      const d: FunctionCallDelegate = {
        senderId: i % 64 === 0 ? names[(i / 64) % 2]! : r.account(),
        receiverId: r.account(),
        functionCall: {
          methodName: i % 4 === 0 ? methods[r.below(methods.length)]! : "ft_transfer",
          args: r.take(r.below(512)),
          gas: r.uint(64),
          deposit: r.uint(128),
        },
        nonce: r.uint(64),
        maxBlockHeight: r.uint(64),
        publicKey: key,
      };
      const s: SignedFunctionCallDelegate = { delegateAction: d, signature: sig };
      const message = delegateMessage(borsh, d);
      expect([i, message]).toEqual([i, encodeDelegateAction(nearApiDelegate(d))]);
      const ours = lcpEncodeSignedDelegate(borsh, s);
      const theirs = nearApiSigned(s);
      expect([i, ours]).toEqual([i, theirs]);
      expect([i, decodeSignedDelegate(borsh, theirs)]).toEqual([i, s]);
      expect([i, nearApiRead(ours)]).toEqual([i, s]);
      const text = nearKeyText(key);
      expect([i, text]).toEqual([i, new PublicKey(key).toString()]);
      expect([i, nearKeyOf(text)]).toEqual([i, key]);
      expect([i, PublicKey.fromString(text).data]).toEqual([i, key.data]);
    }
  });

  it(`a sweep of ${SWEEP} payments: build and complete write near-api-js's delegate, and nearCarrier reads near-api-js's`, { timeout: SWEEP_MS }, async () => {
    const r = draws("near-payment");
    const H: AtrHash = V.fixed.H;
    for (let i = 0; i < SWEEP; i++) {
      const option: PaymentRequirements = {
        scheme: "exact",
        network: r.below(2) === 0 ? "near:mainnet" : "near:testnet",
        amount: r.uint(128).toString(),
        asset: r.account(),
        payTo: r.account(),
        maxTimeoutSeconds: 1 + r.below(3600),
      };
      const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [option] };
      const key = r.key();
      const payer = r.account();
      const accessKeyNonce = r.uint(64) >> 1n;
      const finalHeight = r.uint(64) >> 1n;
      const publicKey = new PublicKey(key).toString();
      const u = await exactNear.build({ required, accepted: option, payer, publicKey, accessKeyNonce, finalHeight }, H);
      if ("refused" in u) throw new Error(`${i}: ${u.code}`);
      const args = ftTransferArgs(option.payTo, option.amount, H) as Uint8Array;
      const delegate = buildDelegateAction({
        senderId: payer,
        receiverId: option.asset,
        actions: [actions.functionCall("ft_transfer", args, FT_TRANSFER_GAS, 1n)],
        nonce: accessKeyNonce + 1n,
        maxBlockHeight: finalHeight + BigInt(option.maxTimeoutSeconds),
        publicKey: PublicKey.fromString(publicKey),
      });
      expect([i, u.request.hash]).toEqual([i, sha256(encodeDelegateAction(delegate))]);
      const signature = r.take(key.keyType === 0 ? 64 : 65);
      const p = u.complete({ keyType: key.keyType, bytes: signature });
      if ("refused" in p) throw new Error(`${i}: ${p.code}`);
      const theirs = encodeSignedDelegate({ delegateAction: delegate, signature: new Signature({ keyType: key.keyType, data: signature }) } as never);
      expect([i, p.payload.signedDelegateAction]).toEqual([i, toBase64(theirs)]);
      const read = nearApiRead(fromBase64(p.payload.signedDelegateAction)!);
      expect([i, read?.delegateAction.publicKey]).toEqual([i, key]);
      expect([i, nearCarrier(toBase64(theirs))]).toEqual([
        i,
        { h: H, payer, publicKey, nonce: accessKeyNonce + 1n, maxBlockHeight: finalHeight + BigInt(option.maxTimeoutSeconds), asset: option.asset },
      ]);
    }
  });
});
