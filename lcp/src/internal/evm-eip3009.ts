/**
 * The EIP-3009 read that `x402/exact/eip155/eip3009` and the MPP EIP-3009 charges (`mpp/charge/evm/authorization`,
 * `mpp/charge/usdc/evm`) share, over `statusOf`: the value, `authorizationState(payer, nonce)` on the token, read at the
 * final mark and at the latest head and lapsed at `validBefore`; the search for the payer's `AuthorizationUsed` over the
 * value on every contract and the token's `AuthorizationCanceled` over it; each use paired with its `Transfer`; a use on
 * another contract counted only where the payer's signature verifies in that contract's domain; and, below the position
 * given, the token's own use or cancellation of the payer's nonce in the first block the value reads used at.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { addressWord, bytes32Word, bytesOf, concat, hexOf, keccak, keccakHex, uintOf, uintWord, wordAt, type Hex } from "../evm-abi.js";
import { chainIdOf, isObject } from "../fields.js";
import { AUTHORIZATION_USED_TOPIC, ReaderError, TRANSFER_WITH_AUTHORIZATION_TYPEHASH, rejected, type EvmReader } from "./evm.js";
import type { UnreadableReason } from "./read.js";
import type { Coverage } from "./registry.js";
import {
  AUTHORIZATION_CANCELED_TOPIC,
  addressTopic,
  callsIn,
  movedOf,
  nonceUsed,
  partyOf,
  same,
  topicAddress,
  transfersIn,
  type Classified,
  type EvmReadRefBase,
  type ReadSpec,
  type SeenEvm,
  type Signed,
  type TransferAt,
  type TxView,
  type Values,
} from "./evm-x402.js";

type Acts = Omit<SeenEvm, "transaction" | "position" | "mark" | "presented">[];

function lower(h: string): string {
  return h.toLowerCase();
}

/** The calls through which a token consumes an EIP-3009 authorization, in their `v, r, s` and `bytes` forms. */
export const EIP3009_CALLS: readonly Hex[] = Object.freeze([
  "0xe3ee160e", // transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
  "0xcf092995", // transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)
  "0xef55bec6", // receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
  "0x88b7ab63", // receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)
]);

/**
 * An EIP-3009 call decoded from a transaction's input: which of the two calls, its signed words (`from`, `to`, `value`,
 * `validAfter`, `validBefore`, `nonce`), its signature's bytes as the token passes them to a contract account's
 * ERC-1271 check (`r ‖ s ‖ v` in the `v, r, s` form, the `bytes` argument in the other), and its `r`, `s` and `v` where
 * those bytes are 65.
 */
export interface Eip3009Call {
  readonly receive: boolean;
  readonly from: Hex;
  readonly to: Hex;
  readonly value: bigint;
  readonly validAfter: bigint;
  readonly validBefore: bigint;
  readonly nonce: Hex;
  readonly signature?: Uint8Array;
  readonly sig?: { readonly r: Uint8Array; readonly s: Uint8Array; readonly v: number };
}

/** The longest signature the read passes to an ERC-1271 check: lcp's resource bound on one `eth_call`'s input. */
const MAX_ERC1271_SIGNATURE = 4096;

export function eip3009CallsIn(input: Uint8Array): Eip3009Call[] {
  const out: Eip3009Call[] = [];
  for (const c of callsIn(input, EIP3009_CALLS)) {
    const w = [0, 1, 2, 3, 4, 5].map((i) => wordAt(c.args, i));
    if (w.some((x) => x === undefined)) continue;
    const from = topicAddress(hexOf(w[0]!));
    const to = topicAddress(hexOf(w[1]!));
    if (from === undefined || to === undefined) continue;
    const receive = c.selector === "0xef55bec6" || c.selector === "0x88b7ab63";
    const packed = c.selector === "0xcf092995" || c.selector === "0x88b7ab63";
    let sig: Eip3009Call["sig"];
    let signature: Uint8Array | undefined;
    if (!packed) {
      const [v, r, s] = [6, 7, 8].map((i) => wordAt(c.args, i));
      if (v !== undefined && r !== undefined && s !== undefined && uintOf(v) < 256n) {
        sig = { r, s, v: Number(uintOf(v)) };
        signature = concat([r, s, new Uint8Array([sig.v])]);
      }
    } else {
      // The `bytes` form: an offset word, then at that offset the length and the bytes; 65 bytes are `r ‖ s ‖ v`.
      const off = wordAt(c.args, 6);
      const o = off === undefined ? undefined : uintOf(off);
      const len = o === undefined || o > BigInt(c.args.length) ? undefined : wordAt(c.args.subarray(Number(o)), 0);
      const n = len === undefined ? undefined : uintOf(len);
      if (o !== undefined && n !== undefined && n <= BigInt(MAX_ERC1271_SIGNATURE) && Number(o) + 32 + Number(n) <= c.args.length) {
        signature = c.args.slice(Number(o) + 32, Number(o) + 32 + Number(n));
        if (n === 65n) sig = { r: signature.subarray(0, 32), s: signature.subarray(32, 64), v: signature[64]! };
      }
    }
    out.push({
      receive,
      from,
      to,
      value: uintOf(w[2]!),
      validAfter: uintOf(w[3]!),
      validBefore: uintOf(w[4]!),
      nonce: hexOf(w[5]!),
      ...(signature === undefined ? {} : { signature }),
      ...(sig === undefined ? {} : { sig }),
    });
  }
  return out;
}

/** keccak256 of EIP-3009's `ReceiveWithAuthorization` type. */
const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccakHex(
  "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
);
/** keccak256 of EIP-712's domain type with the four members an EIP-3009 token's domain holds. */
const EIP712_DOMAIN_TYPEHASH = keccakHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
/** `name()` and `version()`, read from a contract other than the asset to verify an authorization in its own domain. */
const NAME_SELECTOR: Hex = "0x06fdde03";
const VERSION_SELECTOR: Hex = "0x54fd4d50";
/** EIP-5267's `eip712Domain()`, the domain a contract states it signs under. */
const EIP712_DOMAIN_SELECTOR: Hex = "0x84b0196e";
/** `DOMAIN_SEPARATOR()`, the separator an EIP-3009 token publishes (FiatTokenV2_2 among them). */
const DOMAIN_SEPARATOR_SELECTOR: Hex = "0x3644e515";
/** ERC-1271's `isValidSignature(bytes32,bytes)`, which is also the magic value a valid signature returns. */
const IS_VALID_SIGNATURE_SELECTOR: Hex = "0x1626ba7e";
/** EIP-712's domain members, in their order, with EIP-5267's bit for each. */
const DOMAIN_MEMBERS = ["string name", "string version", "uint256 chainId", "address verifyingContract", "bytes32 salt"] as const;

/** The `string` whose offset is word `head` of `b`, or undefined. */
function abiStringAt(b: Uint8Array, head: number): Uint8Array | undefined {
  const w = wordAt(b, head);
  if (w === undefined) return undefined;
  const off = uintOf(w);
  if (off > BigInt(b.length - 32)) return undefined;
  const len = uintOf(b.subarray(Number(off), Number(off) + 32));
  const start = Number(off) + 32;
  if (len > BigInt(b.length - start)) return undefined;
  return b.subarray(start, start + Number(len));
}

/** A contract call answered: its return data; `reverted` where the call reverted; unreadable for the endpoint's failure. */
async function tryCall(reader: EvmReader, to: Hex, data: Hex, block: bigint): Promise<Uint8Array | "reverted" | { readonly unreadable: UnreadableReason }> {
  try {
    const b = bytesOf(await reader.call(to, data, block), 8192);
    return b ?? { unreadable: "unparseable" };
  } catch (e) {
    // A `ReaderError` is the endpoint's failure, unreadable by its kind. Any other rejection is the call's revert, as a
    // call to a contract with no such function reverts.
    return e instanceof ReaderError ? { unreadable: rejected(e) } : "reverted";
  }
}

/**
 * The domain separator of an EIP-5267 `eip712Domain()` answer, where it names this contract as its verifying contract
 * and this chain's id, and no extension: the domain the contract states it signs under, `salt` included where its
 * `fields` hold one. Undefined for any other answer.
 */
function domainOf5267(b: Uint8Array, contract: Hex, chainId: bigint): Uint8Array | undefined {
  const fields = b[0];
  const words = [3, 4, 5, 6].map((i) => wordAt(b, i));
  if (fields === undefined || (fields & 0xe0) !== 0 || (fields & 0x0c) !== 0x0c || words.some((w) => w === undefined)) return undefined;
  const [chain, verifying, salt, ext] = words as Uint8Array[];
  if (uintOf(chain!) !== chainId || !same(topicAddress(hexOf(verifying!)), contract)) return undefined;
  const extensions = Number(uintOf(ext!)) <= b.length - 32 ? wordAt(b.subarray(Number(uintOf(ext!))), 0) : undefined;
  if (extensions === undefined || uintOf(extensions) !== 0n) return undefined;
  const name = fields & 0x01 ? abiStringAt(b, 1) : new Uint8Array();
  const version = fields & 0x02 ? abiStringAt(b, 2) : new Uint8Array();
  if (name === undefined || version === undefined) return undefined;
  const type = `EIP712Domain(${DOMAIN_MEMBERS.filter((_, i) => fields & (1 << i)).join(",")})`;
  const values = [keccak(name), keccak(version), chain!, verifying!, salt!].filter((_, i) => fields & (1 << i));
  return keccak(concat([keccak(type), ...values]));
}

/**
 * Whether a 65-byte signature recovers to `from` over `digest`: `true` or `false`, or `undefined` where it is not one
 * with a low `s` and a `v` of 27, 28, 0 or 1, from which no account is read.
 */
function recoversTo(sig: Eip3009Call["sig"], digest: Uint8Array, from: Hex): boolean | undefined {
  if (sig === undefined) return undefined;
  const parity = sig.v === 27 || sig.v === 28 ? sig.v - 27 : sig.v === 0 || sig.v === 1 ? sig.v : -1;
  if (parity < 0) return undefined;
  try {
    const s = secp256k1.Signature.fromBytes(concat([sig.r, sig.s]), "compact");
    if (s.hasHighS()) return undefined;
    const key = s.addRecoveryBit(parity).recoverPublicKey(digest).toBytes(false).subarray(1);
    return same(hexOf(keccak(key).subarray(12)), from);
  } catch {
    return undefined;
  }
}

/**
 * `from`'s ERC-1271 answer to `isValidSignature(digest, signature)` in the state after `block`: `true` for the magic
 * value; `false` for any other answer, an empty one (an account with no code), or a revert; unreadable for the
 * endpoint's failure.
 */
async function erc1271Accepts(from: Hex, digest: Uint8Array, signature: Uint8Array, block: bigint, reader: EvmReader): Promise<boolean | { readonly unreadable: UnreadableReason }> {
  const padded = new Uint8Array(Math.ceil(signature.length / 32) * 32);
  padded.set(signature);
  const data = hexOf(concat([bytesOf(IS_VALID_SIGNATURE_SELECTOR)!, digest, uintWord(64n), uintWord(BigInt(signature.length)), padded]));
  const a = await tryCall(reader, from, data, block);
  if (a === "reverted") return false;
  if (!(a instanceof Uint8Array)) return a;
  const magic = bytesOf(IS_VALID_SIGNATURE_SELECTOR)!;
  return a.length >= 32 && magic.every((x, i) => a[i] === x) && a.subarray(4, 32).every((x) => x === 0);
}

/**
 * Whether `call`'s authorization is the payer's, signed in the EIP-712 domain of `contract`, as a token verifies it: by
 * ecrecover for an account with no code, and by the account's ERC-1271 `isValidSignature` for a contract account
 * (FiatTokenV2_2's `SignatureChecker`). The domains tried are the four-member one, from the `name()` and `version()`
 * `contract` answers with the network's chain id and `contract` as the verifying contract, and the one its EIP-5267
 * `eip712Domain()` states, where that names `contract` and the chain, `salt` included. `yes` where the signature
 * recovers to `from` in either, or `from` accepts it by ERC-1271 over either digest. `no` only where it is shown not to
 * be the payer's: the contract's domain is known (stated by `eip712Domain()`, or `DOMAIN_SEPARATOR()` answering the
 * four-member one), the signature is 65 bytes with a low `s` and recovers to another account there, and `from`
 * accepts it by no ERC-1271 answer. `held` otherwise: the read cannot verify it, and the hit holds the search. A
 * `ReaderError` is unreadable by its kind. Each state is read after the use's block.
 */
async function verifies(
  call: Eip3009Call,
  contract: Hex,
  chainId: bigint,
  block: bigint,
  reader: EvmReader,
): Promise<"yes" | "no" | "held" | { readonly unreadable: UnreadableReason }> {
  const struct = keccak(
    concat([
      bytesOf(call.receive ? RECEIVE_WITH_AUTHORIZATION_TYPEHASH : TRANSFER_WITH_AUTHORIZATION_TYPEHASH)!,
      addressWord(call.from),
      addressWord(call.to),
      uintWord(call.value),
      uintWord(call.validAfter),
      uintWord(call.validBefore),
      bytes32Word(call.nonce),
    ]),
  );
  const digestOf = (domain: Uint8Array) => keccak(concat([new Uint8Array([0x19, 0x01]), domain, struct]));

  // The four-member domain, from the contract's name and version.
  const nameAnswer = await tryCall(reader, contract, NAME_SELECTOR, block);
  if (!(nameAnswer instanceof Uint8Array) && nameAnswer !== "reverted") return nameAnswer;
  const versionAnswer = await tryCall(reader, contract, VERSION_SELECTOR, block);
  if (!(versionAnswer instanceof Uint8Array) && versionAnswer !== "reverted") return versionAnswer;
  const name = nameAnswer instanceof Uint8Array ? abiStringAt(nameAnswer, 0) : undefined;
  const version = versionAnswer instanceof Uint8Array ? abiStringAt(versionAnswer, 0) : undefined;
  const fourMember =
    name === undefined || version === undefined
      ? undefined
      : keccak(concat([bytesOf(EIP712_DOMAIN_TYPEHASH)!, keccak(name), keccak(version), uintWord(chainId), addressWord(contract)]));
  if (fourMember !== undefined && recoversTo(call.sig, digestOf(fourMember), call.from) === true) return "yes";

  // The domain the contract states, by EIP-5267.
  const stated = await tryCall(reader, contract, EIP712_DOMAIN_SELECTOR, block);
  if (!(stated instanceof Uint8Array) && stated !== "reverted") return stated;
  const domain5267 = stated instanceof Uint8Array ? domainOf5267(stated, contract, chainId) : undefined;
  const sameDomain = domain5267 !== undefined && fourMember !== undefined && domain5267.every((x, i) => x === fourMember[i]);
  if (domain5267 !== undefined && !sameDomain && recoversTo(call.sig, digestOf(domain5267), call.from) === true) return "yes";
  const domains = [fourMember, sameDomain ? undefined : domain5267].filter((d): d is Uint8Array => d !== undefined);
  if (domains.length === 0) return "held";

  // The domain the read knows the contract verifies under: the one it states, else the four-member one where its
  // published separator is that one.
  let known = domain5267;
  if (known === undefined && fourMember !== undefined) {
    const separator = await tryCall(reader, contract, DOMAIN_SEPARATOR_SELECTOR, block);
    if (!(separator instanceof Uint8Array) && separator !== "reverted") return separator;
    if (separator instanceof Uint8Array && separator.length === 32 && separator.every((x, i) => x === fourMember[i])) known = fourMember;
  }

  // A contract account's ERC-1271 check, over each domain's digest.
  if (call.signature === undefined) return "held";
  for (const d of domains) {
    const accepted = await erc1271Accepts(call.from, digestOf(d), call.signature, block, reader);
    if (typeof accepted !== "boolean") return accepted;
    if (accepted) return "yes";
  }
  return known !== undefined && recoversTo(call.sig, digestOf(known), call.from) === false ? "no" : "held";
}

/** The members of a payment presented, each a string, holding every member its form names. */
export function isSigned(s: unknown, names: readonly string[] = []): s is Signed {
  return isObject(s) && Object.values(s).every((v) => typeof v === "string") && names.every((n) => typeof s[n] === "string");
}

/**
 * The acts a transaction holds under EIP-3009 that carry the act's value or the other act's: each `AuthorizationUsed`
 * whose nonce is one of them, paired with its `Transfer` by the token's two logs where the transaction holds one use and
 * at most one transfer of that authorizer on that contract, and otherwise by the one call that consumed it, decoded;
 * each of the asset's `AuthorizationCanceled` over one of them; and in a reverted transaction each call that would have
 * consumed one. A use on another contract than the asset counts only where the one call that consumed it, decoded from
 * the transaction's input, carries the payer's signature in that contract's own EIP-712 domain, by ecrecover or by the
 * payer's ERC-1271 check (`verifies`); one shown not to be the payer's counts for nothing, and one the read cannot
 * decode or verify holds the search.
 */
export async function eip3009Acts(
  ref: { asset: Hex; payee: string; network: string },
  payer: Hex,
  values: Values,
  view: TxView,
  reader: EvmReader,
): Promise<Classified> {
  const carried = [values.v, values.w].filter((x): x is Hex => x !== undefined).map(lower);
  const { receipt } = view;
  const acts: Acts = [];
  if (receipt.status === 0) {
    const tx = await view.tx();
    if (tx === null) return { seen: [] };
    if ("unreadable" in tx) return tx;
    const input = bytesOf(tx.input);
    if (input === undefined) return { unreadable: "unparseable" };
    for (const c of eip3009CallsIn(input)) {
      if (!carried.includes(lower(c.nonce))) continue;
      acts.push({
        result: "failed",
        consumed: false,
        carries: true,
        party: partyOf(c.from, payer, ref.payee),
        kind: same(c.nonce, values.v) ? "same" : "other",
        account: same(c.to, ref.payee) ? "payee" : "other",
        signer: c.from,
      });
    }
    return { seen: acts };
  }
  const logs = receipt.logs;
  const transfers = transfersIn(logs);
  const uses = logs
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.topics.length === 3 && same(l.topics[0], AUTHORIZATION_USED_TOPIC) && carried.includes(lower(l.topics[2]!)));
  const taken = new Set<number>();
  for (const { l } of uses) {
    const contract = lower(l.address) as Hex;
    const authorizer = topicAddress(l.topics[1]);
    const nonce = lower(l.topics[2]!) as Hex;
    if (authorizer === undefined) return { undecodable: true };
    const onAsset = same(contract, ref.asset);
    // Every use of each authorizer on each contract emits AuthorizationUsed, so the count is over all of them.
    const mine = logs.filter(
      (u) =>
        u.topics.length === 3 && same(u.topics[0], AUTHORIZATION_USED_TOPIC) && same(u.address, contract) && same(topicAddress(u.topics[1]), authorizer),
    );
    const from = transfers.filter((t) => same(t.token, contract) && same(t.from, authorizer));
    let call: Eip3009Call | undefined;
    if (!onAsset || mine.length !== 1 || from.length > 1) {
      const tx = await view.tx();
      if (tx === null) return { undecodable: true };
      if ("unreadable" in tx) return tx;
      const input = bytesOf(tx.input);
      if (input === undefined) return { unreadable: "unparseable" };
      const calls = eip3009CallsIn(input).filter((c) => same(c.from, authorizer) && same(c.nonce, nonce));
      if (calls.length !== 1) return { undecodable: true };
      call = calls[0]!;
    }
    if (!onAsset) {
      const chainId = chainIdOf(ref.network);
      if (chainId === undefined) return { unreadable: "unparseable" };
      const ok = await verifies(call!, contract, BigInt(chainId), receipt.blockNumber, reader);
      if (ok === "held") return { undecodable: true };
      if (typeof ok !== "string") return ok;
      if (ok === "no") continue;
    }
    let transfer: TransferAt | undefined;
    if (mine.length === 1 && from.length <= 1) {
      transfer = from[0];
    } else {
      transfer = from.find((t) => !taken.has(t.log) && same(t.to, call!.to) && t.value === call!.value);
      if (transfer === undefined) return { undecodable: true };
    }
    if (transfer !== undefined) taken.add(transfer.log);
    acts.push({
      result: "succeeded",
      consumed: onAsset && same(authorizer, payer) && same(nonce, values.v),
      carries: true,
      party: partyOf(authorizer, payer, ref.payee),
      kind: same(nonce, values.v) ? "same" : "other",
      account: transfer === undefined ? "none" : same(transfer.to, ref.payee) ? "payee" : "other",
      moved: transfer === undefined ? [] : [movedOf(transfer, view.hash)],
      signer: authorizer,
      ...(transfer === undefined
        ? {}
        : {
            signed: {
              token: contract,
              from: authorizer,
              to: transfer.to,
              value: transfer.value.toString(),
              nonce,
            },
          }),
    });
  }
  for (const l of logs) {
    if (l.topics.length !== 3 || !same(l.topics[0], AUTHORIZATION_CANCELED_TOPIC) || !same(l.address, ref.asset)) continue;
    if (!carried.includes(lower(l.topics[2]!))) continue;
    const authorizer = topicAddress(l.topics[1]);
    acts.push({
      result: "succeeded",
      consumed: same(authorizer, payer) && same(l.topics[2], values.v),
      carries: true,
      party: partyOf(authorizer, payer, ref.payee),
      kind: "other",
      account: "none",
      moved: [],
      ...(authorizer === undefined ? {} : { signer: authorizer }),
    });
  }
  return { seen: acts };
}

/** The members of an EIP-3009 payment presented: the token, `from`, `to`, `value` and `nonce`. */
export const EIP3009_PRESENTED = ["token", "from", "to", "value", "nonce"] as const;

/** What a pairing's reference gives the EIP-3009 read. */
export interface Eip3009Parts<R> {
  readonly coverage: Coverage;
  /** True for a reference of the pairing's form. */
  readonly check: (ref: unknown) => ref is R;
  /** Whether the pairing's agreement has its own value, the agreement's digest over H, beside the payment's H. */
  readonly agreementValue: boolean;
  /** The nonce the payment consumes, where the reference holds it rather than H. */
  readonly nonce?: (ref: R) => Hex;
  /** The token that records the nonce's use: the asset. */
  readonly token: (ref: R) => Hex;
  /** The authorization's `from`. */
  readonly payer: (ref: R) => Hex;
  /** The authorization's `validBefore`. */
  readonly validBefore: (ref: R) => bigint;
}

/** The EIP-3009 read of a pairing, as `statusOf` takes it. */
export function eip3009Spec<R extends EvmReadRefBase>(p: Eip3009Parts<R>): ReadSpec<R> {
  return {
    coverage: p.coverage,
    agreementValue: p.agreementValue,
    check: p.check,
    ...(p.nonce === undefined ? {} : { paymentValue: p.nonce, holdsH: false as const }),
    value: async (ref, v, reader, block) => nonceUsed("eip3009", p.token(ref), p.payer(ref), v, block, reader),
    deadline: (ref) => ({ at: p.validBefore(ref), inclusive: true }),
    search: "logs",
    filters: (ref, values) => [
      { topics: [AUTHORIZATION_USED_TOPIC, addressTopic(p.payer(ref)), values.v] },
      ...(values.w === undefined ? [] : [{ topics: [AUTHORIZATION_USED_TOPIC, addressTopic(p.payer(ref)), values.w] }]),
      { address: p.token(ref), topics: [AUTHORIZATION_CANCELED_TOPIC, null, values.v] },
    ],
    // The token's own use or cancellation of the payer's nonce.
    consumers: (ref, values) => [
      { address: p.token(ref), topics: [AUTHORIZATION_USED_TOPIC, addressTopic(p.payer(ref)), values.v] },
      { address: p.token(ref), topics: [AUTHORIZATION_CANCELED_TOPIC, addressTopic(p.payer(ref)), values.v] },
    ],
    classify: (ref, values, view, reader) => eip3009Acts({ asset: p.token(ref), payee: ref.payee, network: ref.network }, p.payer(ref), values, view, reader),
    presented: (ref) => (isObject(ref) && isSigned(ref["presented"], EIP3009_PRESENTED) ? ref["presented"] : undefined),
    payer: p.payer,
  };
}
