/**
 * Each x402 eip155 pairing's read, over `statusOf`: `exact` over EIP-3009, `exact` and `upto` over Permit2, both
 * `auth-capture` forms, `exact` over ERC-7710 at its salt level and at the level that signs no H. Each classifies a
 * transaction from what landed: who signed what carries H, against the reference's payer and the option's payee; which
 * account the act names, against the payee; what moved, each transfer by its log; and what the payer signed, for
 * `presented`. The profiles of the pairings state each read in the protocol's words.
 */
import type { AtrHash } from "./core.js";
import type { Moved } from "./read.js";
import { addressWord, bytesOf, concat, hexOf, keccak, uintOf, uintWord, wordAt, type Hex } from "../evm-abi.js";
import { chainIdOf, isAddress, isObject, normalHash, uint256Of } from "../fields.js";
import {
  DELEGATION_MANAGER,
  ESCROW,
  EXACT_PERMIT2_PROXY,
  PAYMENT_AUTHORIZED_TOPIC,
  PERMIT2,
  REDEEMED_DELEGATION_TOPIC,
  TRANSFER_TOPIC,
  UPTO_PERMIT2_PROXY,
  decodePermissionContext,
  type Delegation,
  type EvmLog,
} from "./evm.js";
import {
  UNORDERED_NONCE_INVALIDATION_TOPIC,
  addressTopic,
  callsIn,
  inputCarries,
  movedOf,
  nonceUsed,
  partyOf,
  same,
  statusOf,
  topicAddress,
  SYSTEM_TRANSFER_EMITTER,
  transfersIn,
  type Classified,
  type ReadSpec,
  type SeenEvm,
  type Signed,
  type TransferAt,
  type Values,
  type X402EvmRefBase,
} from "./evm-x402.js";
import { EIP3009_PRESENTED, eip3009Spec, isSigned } from "./evm-eip3009.js";

type Acts = Omit<SeenEvm, "transaction" | "position" | "mark">[];

export function hexOfWord(w: Uint8Array): Hex {
  let s = "0x";
  for (const b of w) s += b.toString(16).padStart(2, "0");
  return s as Hex;
}

function lower(h: string): string {
  return h.toLowerCase();
}

// ── `exact` over EIP-3009.

/** The reference the `exact` EIP-3009 read takes. */
export interface Eip3009Ref extends X402EvmRefBase {
  /** The token under whose domain the authorization is signed, the option's `asset`. */
  readonly asset: Hex;
  /** The authorization's `from`, the signer of H. */
  readonly payer: Hex;
  /** The authorization's `validBefore`, in decimal: the lapse's deadline, no member compared. */
  readonly validBefore: string;
  /** The members of the payment presented: the token, `from`, `to`, `value` and `nonce`, lowercase, value in decimal. */
  readonly presented: Signed;
}

/** An `eip155:<chain id>` network, the chain id a positive safe integer, as a reference must name one. */
function isEip155(n: unknown): boolean {
  return typeof n === "string" && n.startsWith("eip155:") && chainIdOf(n) !== undefined;
}

function isEip3009Ref(r: unknown): r is Eip3009Ref {
  return (
    isObject(r) &&
    isEip155(r["network"]) &&
    isAddress(r["asset"]) &&
    isAddress(r["payer"]) &&
    typeof r["payee"] === "string" &&
    uint256Of(r["validBefore"]) !== undefined &&
    isSigned(r["presented"], EIP3009_PRESENTED)
  );
}


/** The read of `x402/exact/eip155/eip3009`. */
export const EIP3009_READ: ReadSpec<Eip3009Ref> = eip3009Spec({
  coverage: "full",
  agreementValue: true,
  check: isEip3009Ref,
  token: (ref) => ref.asset,
  payer: (ref) => ref.payer,
  validBefore: (ref) => BigInt(ref.validBefore),
});

/** `status` of `x402/exact/eip155/eip3009`. */
export const eip3009Read = statusOf(EIP3009_READ);

/**
 * The read of an EIP-3009 payment carried at coverage `none`, whose nonce is no agreement's value and carries no H:
 * `x402/exact/eip155/eip3009`'s read, the authorization's own nonce standing in the reference where that pairing has H.
 */
export const CARRIED_EIP3009_READ: ReadSpec<Eip3009Ref> = { ...EIP3009_READ, coverage: "none", agreementValue: false };

/** `status` of an EIP-3009 payment carried at coverage `none` (`CARRIED_EIP3009_READ`). */
export const carriedEip3009Read = statusOf(CARRIED_EIP3009_READ);

// ── `exact` and `upto` over Permit2.

/** The reference the Permit2 reads take. */
export interface Permit2Ref extends X402EvmRefBase {
  readonly asset: Hex;
  /** The permit's owner, the signer of H. */
  readonly payer: Hex;
  /** The permit's `deadline`, in decimal. */
  readonly deadline: string;
  /**
   * The members of the payment presented: the permit's `token`, `amount`, `nonce` and `deadline`, its `spender`, the
   * `owner`, and the witness's `to` and `validAfter`, with `facilitator` on `upto`.
   */
  readonly presented: Signed;
}

function isPermit2Ref(r: unknown): r is Permit2Ref {
  return (
    isObject(r) &&
    isEip155(r["network"]) &&
    isAddress(r["asset"]) &&
    isAddress(r["payer"]) &&
    typeof r["payee"] === "string" &&
    uint256Of(r["deadline"]) !== undefined &&
    isSigned(r["presented"], ["token", "amount", "nonce", "deadline", "spender", "owner", "to", "validAfter"])
  );
}

/** A proxy's settling call: which proxy, its selector, and the argument word where its permit starts. */
interface ProxyCall {
  readonly proxy: "exact" | "upto";
  readonly selector: Hex;
  readonly p: number;
}

/**
 * The calls through which x402's Permit2 proxies spend a permit. `exact`: the permit's `token`, `amount`, `nonce` and
 * `deadline`, then the owner, the witness's `to` and `validAfter`. `upto`: the permit, the settled amount, the owner,
 * the witness's `to`, `facilitator` and `validAfter`. `settleWithPermit` puts an EIP-2612 permit's five words first.
 */
export const PROXY_CALLS: readonly ProxyCall[] = Object.freeze([
  { proxy: "exact", selector: "0x13cd3b53", p: 0 },
  { proxy: "exact", selector: "0xfa340378", p: 5 },
  { proxy: "upto", selector: "0xff11e7b4", p: 0 },
  { proxy: "upto", selector: "0x016c1748", p: 5 },
] as const);

/** A Permit2 proxy call decoded from a transaction's input. */
interface Permit2Call {
  readonly proxy: "exact" | "upto";
  readonly own: boolean;
  readonly token: Hex;
  readonly amount: bigint;
  readonly nonce: Hex;
  readonly deadline: bigint;
  readonly owner: Hex;
  readonly to: Hex;
  readonly validAfter: bigint;
  readonly facilitator?: Hex;
  /** The amount the proxy transfers: the permit's on `exact`, the settled amount on `upto`. */
  readonly moves: bigint;
}

function permit2CallsIn(input: Uint8Array, txTo: Hex | null): Permit2Call[] {
  const out: Permit2Call[] = [];
  for (const c of callsIn(input, PROXY_CALLS.map((x) => x.selector))) {
    const spec = PROXY_CALLS.find((x) => x.selector === c.selector)!;
    const upto = spec.proxy === "upto";
    const word = (i: number) => wordAt(c.args, spec.p + i);
    const idx = upto ? [0, 1, 2, 3, 5, 6, 8, 4, 7] : [0, 1, 2, 3, 4, 5, 6];
    const w = idx.map(word);
    if (w.some((x) => x === undefined)) continue;
    const token = topicAddress(hexOfWord(w[0]!));
    const owner = topicAddress(hexOfWord(w[4]!));
    const to = topicAddress(hexOfWord(w[5]!));
    const facilitator = upto ? topicAddress(hexOfWord(w[8]!)) : undefined;
    if (token === undefined || owner === undefined || to === undefined || (upto && facilitator === undefined)) continue;
    const proxyAddress = upto ? UPTO_PERMIT2_PROXY : EXACT_PERMIT2_PROXY;
    out.push({
      proxy: spec.proxy,
      own: c.at === 0 && same(txTo, proxyAddress),
      token,
      amount: uintOf(w[1]!),
      nonce: hexOfWord(w[2]!),
      deadline: uintOf(w[3]!),
      owner,
      to,
      validAfter: uintOf(w[6]!),
      ...(upto ? { facilitator: facilitator! } : {}),
      moves: upto ? uintOf(w[7]!) : uintOf(w[1]!),
    });
  }
  return out;
}

/** The members of a decoded proxy call that its form names, as `presented` compares them. */
function permit2Signed(c: Permit2Call): Signed {
  return {
    token: c.token,
    amount: c.amount.toString(),
    nonce: lower(c.nonce),
    deadline: c.deadline.toString(),
    spender: lower(c.proxy === "upto" ? UPTO_PERMIT2_PROXY : EXACT_PERMIT2_PROXY),
    owner: c.owner,
    to: c.to,
    validAfter: c.validAfter.toString(),
    ...(c.facilitator === undefined ? {} : { facilitator: c.facilitator }),
  };
}

/**
 * The acts a transaction holds over Permit2 that carry the act's value or the other act's: each proxy call, found at
 * any byte offset of the input, whose nonce is one of them, counted only where the receipt holds that proxy's
 * `Transfer` of the call's token from its owner to its witness's `to` of the amount it moves, and the owner's bit for
 * the nonce is set at the receipt's block and unset at the block before; each `UnorderedNonceInvalidation` of an owner
 * that covers one of them; and in a reverted transaction each such call.
 */
function permit2Classify(proxy: "exact" | "upto"): ReadSpec<Permit2Ref>["classify"] {
  return async (ref, values, view, reader) => {
    const carried = [values.v, values.w].filter((x): x is Hex => x !== undefined).map(lower);
    const acts: Acts = [];
    const { receipt } = view;
    for (const l of receipt.logs) {
      const inv = invalidation(l);
      if (inv === undefined) continue;
      for (const n of carried) {
        const v = BigInt(n);
        if (inv.word !== v >> 8n || ((inv.mask >> (v & 0xffn)) & 1n) === 0n) continue;
        acts.push({
          result: "succeeded",
          consumed: same(inv.owner, ref.payer) && same(n, values.v),
          carries: true,
          party: partyOf(inv.owner, ref.payer, ref.payee),
          kind: "other",
          account: "none",
          moved: [],
          signer: inv.owner,
        });
      }
    }
    const tx = await view.tx();
    if (tx === null) return { seen: acts };
    if ("unreadable" in tx) return tx;
    const input = bytesOf(tx.input);
    if (input === undefined) return { unreadable: "unparseable" };
    if (!carried.some((n) => inputCarries(input, n as Hex))) return { seen: acts };
    // One call by owner and nonce: copies of one call are that call, and two calls of one owner over one nonce that
    // differ leave the transaction undecided, so the search holds on it, as the Permit2 `recover` refuses them.
    const byOwnerNonce = new Map<string, Permit2Call>();
    for (const c of permit2CallsIn(input, tx.to).filter((x) => carried.includes(lower(x.nonce)))) {
      const key = `${c.owner} ${lower(c.nonce)}`;
      const had = byOwnerNonce.get(key);
      if (had === undefined) byOwnerNonce.set(key, c);
      else if (!sameCall(had, c)) return { undecodable: true };
      else if (c.own) byOwnerNonce.set(key, c);
    }
    const calls = [...byOwnerNonce.values()];
    const transfers = transfersIn(receipt.logs);
    const taken = new Set<number>();
    for (const c of calls) {
      const kind = c.proxy === proxy && same(c.nonce, values.v) ? "same" : "other";
      const party = partyOf(c.owner, ref.payer, ref.payee);
      if (receipt.status === 0) {
        acts.push({ result: "failed", consumed: false, carries: true, party, kind, account: same(c.to, ref.payee) ? "payee" : "other", signer: c.owner });
        continue;
      }
      const t = transfers.find((x) => !taken.has(x.log) && same(x.token, c.token) && same(x.from, c.owner) && same(x.to, c.to) && x.value === c.moves);
      if (t === undefined) continue;
      const after = await nonceUsed("permit2", PERMIT2, c.owner, c.nonce, receipt.blockNumber, reader);
      if (typeof after !== "boolean") return after;
      if (!after) continue;
      const before = receipt.blockNumber === 0n ? false : await nonceUsed("permit2", PERMIT2, c.owner, c.nonce, receipt.blockNumber - 1n, reader);
      if (typeof before !== "boolean") return before;
      if (before) continue;
      taken.add(t.log);
      // What the payer signed: the decoded call where it is the transaction's own; on `exact`, a wrapped call's members
      // that its transfer and the owner's bit show, where the transaction holds one transfer and one proxy call of the
      // owner's on that token; otherwise none, and `presented` is `unshown`.
      let signed: Signed | undefined;
      if (c.own) signed = permit2Signed(c);
      else if (c.proxy === "exact") {
        const fromOwner = transfers.filter((x) => same(x.token, c.token) && same(x.from, c.owner));
        const ofOwner = permit2CallsIn(input, tx.to).filter((x) => same(x.owner, c.owner));
        if (fromOwner.length === 1 && ofOwner.length === 1) {
          signed = { token: c.token, owner: c.owner, to: t.to, amount: t.value.toString(), nonce: lower(c.nonce) };
        }
      }
      acts.push({
        result: "succeeded",
        consumed: same(c.owner, ref.payer) && same(c.nonce, values.v),
        carries: true,
        party,
        kind,
        account: same(t.to, ref.payee) ? "payee" : "other",
        moved: [movedOf(t, view.hash)],
        signer: c.owner,
        ...(signed === undefined ? {} : { signed }),
      });
    }
    return { seen: acts };
  };
}

/** Two decoded proxy calls of one proxy that sign and move the same, wherever each sits in the input. */
function sameCall(a: Permit2Call, b: Permit2Call): boolean {
  return a.proxy === b.proxy && a.moves === b.moves && JSON.stringify(permit2Signed(a)) === JSON.stringify(permit2Signed(b));
}

/** A Permit2 `UnorderedNonceInvalidation(owner, word, mask)` log, or undefined. */
function invalidation(l: EvmLog): { owner: Hex; word: bigint; mask: bigint } | undefined {
  if (!same(l.address, PERMIT2) || l.topics.length !== 2 || !same(l.topics[0], UNORDERED_NONCE_INVALIDATION_TOPIC)) return undefined;
  const owner = topicAddress(l.topics[1]);
  const data = bytesOf(l.data);
  const word = data === undefined ? undefined : wordAt(data, 0);
  const mask = data === undefined ? undefined : wordAt(data, 1);
  if (owner === undefined || word === undefined || mask === undefined) return undefined;
  return { owner, word: uintOf(word), mask: uintOf(mask) };
}

function permit2Spec(proxy: "exact" | "upto"): ReadSpec<Permit2Ref> {
  return {
    coverage: "full",
    agreementValue: proxy === "exact",
    check: isPermit2Ref,
    value: async (ref, v, reader, block) => nonceUsed("permit2", PERMIT2, ref.payer, v, block, reader),
    deadline: (ref) => ({ at: BigInt(ref.deadline), inclusive: false }),
    search: "value",
    filters: (ref) => [
      { topics: [TRANSFER_TOPIC_HEX, addressTopic(ref.payer)] },
      { address: PERMIT2, topics: [UNORDERED_NONCE_INVALIDATION_TOPIC, addressTopic(ref.payer)] },
    ],
    // Every contract's `Transfer` from the payer, counted where its transaction carries the nonce in a proxy call of the
    // payer's, and Permit2's invalidation of a word of the payer's nonces.
    consumers: (ref) => [
      { topics: [TRANSFER_TOPIC_HEX, addressTopic(ref.payer)] },
      { address: PERMIT2, topics: [UNORDERED_NONCE_INVALIDATION_TOPIC, addressTopic(ref.payer)] },
    ],
    classify: permit2Classify(proxy),
    presented: (ref) => (isObject(ref) && isSigned(ref["presented"]) ? ref["presented"] : undefined),
    payer: (ref) => ref.payer,
  };
}

const TRANSFER_TOPIC_HEX: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const PERMIT2_EXACT_READ = permit2Spec("exact");
export const PERMIT2_UPTO_READ = permit2Spec("upto");
/** `status` of `x402/exact/eip155/permit2`. */
export const permit2ExactRead = statusOf(PERMIT2_EXACT_READ);
/** `status` of `x402/upto/eip155/permit2`. */
export const permit2UptoRead = statusOf(PERMIT2_UPTO_READ);

// ── `auth-capture` on the commerce-payments escrow.

/** The reference the `auth-capture` reads take. */
export interface AuthCaptureRef extends X402EvmRefBase {
  readonly scheme: "eip3009" | "permit2";
  readonly asset: Hex;
  /** The escrow's `PaymentInfo.payer`, the token authorization's signer. */
  readonly payer: Hex;
  /** The escrow deployment and the event of the option's flow. */
  readonly escrow: Hex;
  readonly event: Hex;
  /** The escrow's payment hash of the presented `PaymentInfo`, and that hash with payer zero, the signed nonce. */
  readonly paymentId: Hex;
  readonly signatureNonce: Hex;
  /** `PaymentInfo.salt`: H, or the commitment to the receiver authorizer, the policy and H. */
  readonly salt: Hex;
  /** `preApprovalExpiry`, in decimal. */
  readonly expiry: string;
}

/** The escrow deployment a reference names, by its escrow's address: v1.1 or v1.0. */
function deploymentOf(escrow: unknown): (typeof ESCROW)["v1.1"] | undefined {
  return [ESCROW["v1.1"], ESCROW["v1.0"]].find((d) => same(d.escrow, escrow));
}

function isAuthCaptureRef(r: unknown): r is AuthCaptureRef {
  return (
    isObject(r) &&
    isEip155(r["network"]) &&
    (r["scheme"] === "eip3009" || r["scheme"] === "permit2") &&
    [r["asset"], r["payer"], r["escrow"]].every(isAddress) &&
    deploymentOf(r["escrow"]) !== undefined &&
    [r["event"], r["paymentId"], r["signatureNonce"], r["salt"]].every((x) => normalHash(x) !== null) &&
    typeof r["payee"] === "string" &&
    uint256Of(r["expiry"]) !== undefined
  );
}

/** The two events of a deployment's escrow: `PaymentAuthorized`, and its `PaymentCharged`. */
function escrowEvents(ref: AuthCaptureRef): readonly Hex[] {
  return [PAYMENT_AUTHORIZED_TOPIC, deploymentOf(ref.escrow)!.chargedTopic];
}

/**
 * The escrow's events in a transaction, `PaymentAuthorized` and `PaymentCharged`, whose `PaymentInfo.salt` is the
 * reference's: the payment hash in topic 1, then `PaymentInfo`'s twelve words (operator, payer, receiver, token,
 * maxAmount, the three expiries, the two fee bounds, the fee receiver, salt), the amount and the token collector. The
 * act is the option's flow's event through the deployment's collector for the pairing's scheme, which alone redeems
 * the token authorization the payer signed, its `to` on EIP-3009 and its spender on Permit2 (`@x402/evm` 2.31.0
 * `src/auth-capture/constants.ts`, the deployments' collectors); an event through that collector whose payment hash is the presented one consumed the payer's value, the
 * nonce being that hash with payer zero. Another event, or one through another collector, is an act of another kind. The deposit counts where the `receiver` it names is the option's payee;
 * the signer of H is its `payer`. An event of the escrow whose words the read cannot decode holds the search: it may
 * carry H, and absence is never inferred from a log the read could not read.
 */
async function authCaptureClassify(ref: AuthCaptureRef, values: Values, view: Parameters<ReadSpec<never>["classify"]>[2]): Promise<Classified> {
  const acts: Acts = [];
  const { receipt } = view;
  if (receipt.status === 0) {
    const tx = await view.tx();
    if (tx === null) return { seen: [] };
    if ("unreadable" in tx) return tx;
    const input = bytesOf(tx.input);
    if (input === undefined) return { unreadable: "unparseable" };
    // The escrow's call takes `PaymentInfo` inline, twelve words ending in `salt`: the act names the account its
    // `receiver` names, and its signer is its `payer`, since a failed result moved nothing.
    const info = paymentInfoBefore(input, ref.salt);
    if (info !== undefined) {
      acts.push({
        result: "failed",
        consumed: false,
        carries: true,
        party: partyOf(info.payer, ref.payer, ref.payee),
        kind: "same",
        account: same(info.receiver, ref.payee) ? "payee" : "other",
        signer: info.payer,
      });
    }
    return { seen: acts };
  }
  const events = escrowEvents(ref);
  const collector = ref.scheme === "eip3009" ? deploymentOf(ref.escrow)!.eip3009Collector : deploymentOf(ref.escrow)!.permit2Collector;
  for (const [i, l] of receipt.logs.entries()) {
    if (!same(l.address, ref.escrow) || !events.some((e) => same(l.topics[0], e))) continue;
    const data = bytesOf(l.data);
    const w = (k: number) => (data === undefined ? undefined : wordAt(data, k));
    const [payerW, receiverW, tokenW, saltW, amountW, collectorW] = [w(1), w(2), w(3), w(11), w(12), w(13)];
    const id = l.topics.length === 2 ? normalHash(l.topics[1]) : null;
    if (!payerW || !receiverW || !tokenW || !saltW || !amountW || !collectorW || id === null) return { undecodable: true };
    const payer = topicAddress(hexOfWord(payerW));
    const receiver = topicAddress(hexOfWord(receiverW));
    const token = topicAddress(hexOfWord(tokenW));
    const through = topicAddress(hexOfWord(collectorW));
    if (payer === undefined || receiver === undefined || token === undefined || through === undefined) return { undecodable: true };
    if (!same(hexOfWord(saltW), ref.salt)) continue;
    const own = same(l.topics[0], ref.event) && same(through, collector);
    const paymentId = lower(id);
    acts.push({
      result: "succeeded",
      // The collector redeemed the payer's authorization over the presented payment's nonce, whichever flow it served.
      consumed: same(through, collector) && same(paymentId, ref.paymentId),
      carries: true,
      party: partyOf(payer, ref.payer, ref.payee),
      kind: own ? "same" : "other",
      account: same(receiver, ref.payee) ? "payee" : "other",
      moved: [movedAt(token, uintOf(amountW), receiver, view.hash, i)],
      signer: payer,
      signed: { paymentId },
    });
  }
  void values;
  return { seen: acts };
}

/**
 * Whether an escrow event's `PaymentInfo.salt`, data word 11, is `salt`; true also for an event whose data holds no
 * such word, which the classification then holds the search on.
 */
function saltIs(entry: EvmLog, salt: Hex): boolean {
  const data = bytesOf(entry.data);
  const w = data === undefined ? undefined : wordAt(data, 11);
  return w === undefined || same(hexOfWord(w), salt);
}

/** The `payer` and `receiver` of the inline `PaymentInfo` whose last word, `salt`, is `salt`, in a call's input. */
function paymentInfoBefore(input: Uint8Array, salt: Hex): { payer: Hex; receiver: Hex } | undefined {
  const w = bytesOf(salt);
  if (w === undefined || w.length !== 32) return undefined;
  next: for (let i = 11 * 32; i + 32 <= input.length; i++) {
    for (let j = 0; j < 32; j++) if (input[i + j] !== w[j]) continue next;
    const start = i - 11 * 32;
    const payer = topicAddress(hexOfWord(input.subarray(start + 32, start + 64)));
    const receiver = topicAddress(hexOfWord(input.subarray(start + 64, start + 96)));
    if (payer !== undefined && receiver !== undefined) return { payer, receiver };
  }
  return undefined;
}

/**
 * The read of both `auth-capture` forms: the value is the signed nonce, a digest over H and the offer's members, so
 * its read is no search for H. The escrow's two events are read whole by the search, each
 * tested by its salt, so the acts carrying H that the escrow recorded are named; the search is never whole, since no
 * search for H is defined.
 */
export const AUTH_CAPTURE_READ: ReadSpec<AuthCaptureRef> = {
  coverage: "full",
  agreementValue: false,
  check: isAuthCaptureRef,
  paymentValue: (ref) => ref.signatureNonce,
  value: async (ref, v, reader, block) => nonceUsed(ref.scheme, ref.asset, ref.payer, v, block, reader),
  deadline: (ref) => ({ at: BigInt(ref.expiry), inclusive: ref.scheme === "eip3009" }),
  search: "open",
  filters: (ref) => escrowEvents(ref).map((e) => ({ address: ref.escrow, topics: [e] })),
  entry: (ref, _values, e) => saltIs(e, ref.salt),
  // The escrow's `PaymentAuthorized` or `PaymentCharged` whose topic 1 is the presented payment's hash.
  consumers: (ref) => escrowEvents(ref).map((e) => ({ address: ref.escrow, topics: [e, ref.paymentId] })),
  classify: (ref, values, view) => authCaptureClassify(ref, values, view),
  presented: (ref) => (isObject(ref) && normalHash(ref["paymentId"]) !== null ? { paymentId: lower(ref["paymentId"] as string) } : undefined),
  payer: (ref) => ref.payer,
};

/** `status` of both `auth-capture` pairings. */
export const authCaptureRead = statusOf(AUTH_CAPTURE_READ);

/**
 * The reference the read of `x402/batch-settlement/eip155` takes: the channel the opening deposits into, by its id and
 * its config whole (the payer, who signs the deposit authorization; the payer authorizer; the receiver; the receiver
 * authorizer; the token; the withdrawal delay; the salt), which the id commits to, and the deposit authorization's
 * nonce, its bound and the amount it moves.
 */
export interface BatchEvmRef extends X402EvmRefBase {
  readonly scheme: "eip3009" | "permit2";
  /** The channel's token. */
  readonly asset: Hex;
  /** The channel's payer, the deposit authorization's signer. */
  readonly payer: Hex;
  /** The channel id, and the config's other members. */
  readonly channel: Hex;
  readonly payerAuthorizer: Hex;
  readonly receiver: Hex;
  readonly receiverAuthorizer: Hex;
  readonly withdrawDelay: number;
  readonly salt: Hex;
  /**
   * The deposit authorization's nonce, a 32-byte word: keccak256(abi.encode(channelId, authSalt)) on ERC-3009, the
   * permit's nonce on Permit2.
   */
  readonly nonce: Hex;
  /**
   * In the scheme's refund-authorizer mode, the option's refund authorizer, whose 20 bytes end the channel salt: H is
   * then the deposit authorization's salt, or the permit's nonce, and not the channel salt.
   */
  readonly refundAuthorizer?: Hex;
  /** The deposit authorization's `validBefore` or `deadline`, and the deposit's amount, in decimal. */
  readonly settleBy: string;
  readonly amount: string;
}

/** What a deposit moved: the token, the amount and the beneficiary it names, by its log. */
export function movedAt(asset: Hex, amount: bigint, to: Hex, transaction: Hex, place: number): Moved {
  return { asset, amount: amount.toString(), to, transaction, place };
}

// ── `exact` over ERC-7710: the salt level and the level that signs no H.

/** The reference the ERC-7710 reads take. */
export interface Erc7710Ref extends X402EvmRefBase {
  /** The payment's `delegator`: at the salt level the root delegator, whose account the transfer comes from. */
  readonly payer: Hex;
  readonly asset: Hex;
  /**
   * The payment presented: `delegation`, the EIP-712 hash of the leaf delegation its permission context encodes
   * (`delegationHash`), which covers the leaf's caveats and, through its `authority`, every delegation above it, and
   * which `status` compares with the leaf a `RedeemedDelegation` log carries. Absent where the context does not decode
   * as the reference manager's: the read then shows no member, and `presented` is `unshown`.
   */
  readonly presented?: Signed;
}

function isErc7710Ref(r: unknown): r is Erc7710Ref {
  return isObject(r) && isEip155(r["network"]) && isAddress(r["payer"]) && isAddress(r["asset"]) && typeof r["payee"] === "string";
}

/** A `RedeemedDelegation` log's root delegator (topic 1), redeemer (topic 2), and delegation's delegate, delegator and salt. */
function redemption(l: EvmLog): { root: Hex; redeemer: Hex; delegate: Hex; delegator: Hex; authority: Hex; salt: Hex } | undefined {
  if (!same(l.address, DELEGATION_MANAGER) || l.topics.length !== 3 || !same(l.topics[0], REDEEMED_DELEGATION_TOPIC)) return undefined;
  const root = topicAddress(l.topics[1]);
  const redeemer = topicAddress(l.topics[2]);
  const data = bytesOf(l.data);
  const w = (k: number) => (data === undefined ? undefined : wordAt(data, k));
  const [d1, d2, d3, d5] = [w(1), w(2), w(3), w(5)];
  if (root === undefined || redeemer === undefined || !d1 || !d2 || !d3 || !d5) return undefined;
  const delegate = topicAddress(hexOfWord(d1));
  const delegator = topicAddress(hexOfWord(d2));
  if (delegate === undefined || delegator === undefined) return undefined;
  return { root, redeemer, delegate, delegator, authority: hexOfWord(d3), salt: hexOfWord(d5) };
}

/**
 * The DelegationManager's EIP-712 types (MetaMask delegation-framework v1.3.0, `src/utils/Constants.sol`): a caveat's
 * `args` are the redeemer's and no member of what the delegator signed.
 */
const DELEGATION_TYPEHASH = keccak(
  "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)",
);
const CAVEAT_TYPEHASH = keccak("Caveat(address enforcer,bytes terms)");

/**
 * A delegation's EIP-712 struct hash, as the DelegationManager's `getDelegationHash` computes it (`EncoderLib`): the
 * delegate, the delegator, the authority, the hash of its caveats' packed hashes, each over the caveat's enforcer and
 * the hash of its terms, and the salt. A delegation's `authority` is its parent's hash, so a leaf's hash covers the
 * chain above it. Lowercase.
 */
export function delegationHash(d: Pick<Delegation, "delegate" | "delegator" | "authority" | "caveats" | "salt">): Hex {
  const caveats = d.caveats.map((c) => keccak(concat([CAVEAT_TYPEHASH, addressWord(c.enforcer), keccak(bytesOf(c.terms)!)])));
  return hexOf(
    keccak(
      concat([
        DELEGATION_TYPEHASH,
        addressWord(d.delegate),
        addressWord(d.delegator),
        bytesOf(d.authority)!,
        keccak(concat(caveats)),
        uintWord(BigInt(d.salt)),
      ]),
    ),
  );
}

/**
 * The delegation a `RedeemedDelegation` log carries whole: its data is `abi.encode(Delegation)`, read as the one-member
 * array a permission context is, under the same bounds (`decodePermissionContext`). Undefined where it does not decode.
 */
function redeemedDelegation(l: EvmLog): Delegation | undefined {
  const data = bytesOf(l.data);
  const at = data === undefined ? undefined : wordAt(data, 0);
  if (data === undefined || at === undefined || uintOf(at) !== 32n) return undefined;
  const d = decodePermissionContext(hexOf(concat([uintWord(32n), uintWord(1n), uintWord(32n), data.subarray(32)])));
  return Array.isArray(d) && d.length === 1 ? d[0] : undefined;
}

/** The leaf delegations, as `delegationHash` gives them, of the reference manager's redemptions under `root` in `logs`. */
function leafHashes(logs: readonly EvmLog[], root: Hex): { hashes: Set<string>; unread: boolean } {
  const hashes = new Set<string>();
  let unread = false;
  for (const l of logs) {
    const r = redemption(l);
    if (r === undefined || !same(r.root, root) || !(same(r.delegate, r.redeemer) || same(r.delegate, ANY_DELEGATE))) continue;
    const d = redeemedDelegation(l);
    if (d === undefined) unread = true;
    else hashes.add(delegationHash(d));
  }
  return { hashes, unread };
}

const ANY_DELEGATE = "0x0000000000000000000000000000000000000a11";
/** ERC-20 `transfer(address,uint256)`. */
const ERC20_TRANSFER: Hex = "0xa9059cbb";

/**
 * At the salt level: each redemption through the reference manager whose leaf (its delegate the redeemer or the
 * wildcard) carries H as its salt. Every delegator of that root's redemptions in the transaction is tested as the signer
 * of H; the account it names is a `Transfer` from the root delegator to the option's payee. A redemption is reusable and
 * consumes no single-use value.
 */
async function erc7710SaltClassify(ref: Erc7710Ref, values: Values, view: Parameters<ReadSpec<never>["classify"]>[2]): Promise<Classified> {
  const { receipt } = view;
  if (receipt.status === 0) return { seen: [] };
  // A redemption of the reference manager under the payer as root that the read cannot decode holds the search.
  const undecodable = receipt.logs.some(
    (l) =>
      same(l.address, DELEGATION_MANAGER) &&
      l.topics.length === 3 &&
      same(l.topics[0], REDEEMED_DELEGATION_TOPIC) &&
      same(topicAddress(l.topics[1]), ref.payer) &&
      redemption(l) === undefined,
  );
  if (undecodable) return { undecodable: true };
  const all = receipt.logs.flatMap((l) => {
    const r = redemption(l);
    return r === undefined ? [] : [[r, l] as const];
  });
  const acts: Acts = [];
  // Each root's redemptions, and each account's transfers, gathered once, so the read is linear in the logs.
  const delegators = new Map<string, Hex[]>();
  for (const [x] of all) {
    const ds = delegators.get(x.root);
    if (ds === undefined) delegators.set(x.root, [x.delegator]);
    else ds.push(x.delegator);
  }
  const payeeSigned = new Map<string, boolean>();
  for (const [root, ds] of delegators) payeeSigned.set(root, same(root, ref.payee) || ds.some((d) => same(d, ref.payee)));
  const transfersFrom = new Map<string, TransferAt[]>();
  for (const t of transfersIn(receipt.logs)) {
    const ts = transfersFrom.get(t.from);
    if (ts === undefined) transfersFrom.set(t.from, [t]);
    else ts.push(t);
  }
  for (const [r, l] of all) {
    const leafDelegation = redeemedDelegation(l);
    // Only the leaf's salt makes the salt level; a delegation further up the chain salted with H carries H in what a
    // delegator signed, and is an act of another kind.
    const leaf = same(r.delegate, r.redeemer) || same(r.delegate, ANY_DELEGATE);
    if (!same(r.salt, values.h)) continue;
    const party = payeeSigned.get(r.root) ? "payee" : same(r.root, ref.payer) ? "payer" : "other";
    const fromRoot = transfersFrom.get(r.root) ?? [];
    const paid = fromRoot.some((t) => same(t.to, ref.payee));
    acts.push({
      result: "succeeded",
      consumed: false,
      carries: true,
      party,
      kind: leaf ? "same" : "other",
      account: paid ? "payee" : fromRoot.length > 0 ? "other" : "none",
      moved: fromRoot.map((t) => movedOf(t, view.hash)),
      signer: r.delegator,
      authority: r.root,
      // The leaf delegation as the log carries it, whole, compared with the one presented; one the read cannot decode
      // whole shows no member.
      ...(leaf && leafDelegation !== undefined ? { signed: { delegation: delegationHash(leafDelegation) } } : {}),
    });
  }
  return { seen: acts };
}

/** The read of `x402/exact/eip155/erc7710-salt`: no single-use value, a search by root delegator for as long as the caller asks. */
export const ERC7710_SALT_READ: ReadSpec<Erc7710Ref> = {
  coverage: "full",
  agreementValue: false,
  check: isErc7710Ref,
  search: "open",
  filters: (ref) => [{ address: DELEGATION_MANAGER, topics: [REDEEMED_DELEGATION_TOPIC, addressTopic(ref.payer)] }],
  classify: (ref, values, view) => erc7710SaltClassify(ref, values, view),
  presented: erc7710Presented,
  payer: (ref) => ref.payer,
};

/** The members of an ERC-7710 payment presented: the leaf delegation's hash. */
function erc7710Presented(ref: unknown): Signed | undefined {
  return isObject(ref) && isSigned(ref["presented"], ["delegation"]) ? { delegation: lower(ref["presented"]["delegation"]!) } : undefined;
}

/** `status` of `x402/exact/eip155/erc7710-salt`. */
export const erc7710SaltRead = statusOf(ERC7710_SALT_READ);

/**
 * At the level that signs no H: the transaction the reference names, which is the act where it succeeded and holds a
 * `Transfer` from the payment's `delegator` to the option's payee, whatever its amount; one that reverted, or holds no
 * such transfer, leaves the delegation usable. Nothing the delegator signed carries H.
 */
async function erc7710Classify(ref: Erc7710Ref, _values: Values, view: Parameters<ReadSpec<never>["classify"]>[2]): Promise<Classified> {
  const { receipt } = view;
  const party = partyOf(ref.payer, ref.payer, ref.payee);
  if (receipt.status === 0) {
    // A failed result moved nothing: the act names the account of the ERC-20 `transfer(to, amount)` its redemption
    // carries, found at any byte offset of the input, and none where it carries none (read-status rules 9 and 20).
    const tx = await view.tx();
    if (tx !== null && "unreadable" in tx) return tx;
    const input = tx === null ? undefined : bytesOf(tx.input);
    const tos = input === undefined ? [] : callsIn(input, [ERC20_TRANSFER]).flatMap((c) => {
      const w = wordAt(c.args, 0);
      const to = w === undefined ? undefined : topicAddress(hexOfWord(w));
      return to === undefined ? [] : [to];
    });
    const account = tos.some((t) => same(t, ref.payee)) ? "payee" : tos.length > 0 ? "other" : "none";
    return { seen: [{ result: "failed", consumed: false, carries: false, party, kind: "same", account }] };
  }
  // A `Transfer` from the delegator whose amount is not one word: the read cannot tell what it moved, and holds on it.
  const unreadTransfer = receipt.logs.some(
    (l) =>
      l.topics.length === 3 &&
      same(l.topics[0], TRANSFER_TOPIC) &&
      !same(l.address, SYSTEM_TRANSFER_EMITTER) &&
      same(topicAddress(l.topics[1]), ref.payer) &&
      bytesOf(l.data)?.length !== 32,
  );
  if (unreadTransfer) return { undecodable: true };
  const fromDelegator = transfersIn(receipt.logs).filter((t) => same(t.from, ref.payer));
  const paid = fromDelegator.find((t) => same(t.to, ref.payee));
  // What the delegator signed: the one leaf the reference manager redeemed under the delegator as root, decoded whole;
  // none where the transaction holds no such redemption (another manager's), several, or one the read cannot decode.
  const leaves = leafHashes(receipt.logs, ref.payer);
  const signed = leaves.hashes.size === 1 && !leaves.unread ? { signed: { delegation: [...leaves.hashes][0]! } } : {};
  return {
    seen: [
      {
        result: "succeeded",
        consumed: false,
        carries: false,
        party,
        kind: "same",
        account: paid !== undefined ? "payee" : fromDelegator.length > 0 ? "other" : "none",
        moved: fromDelegator.map((t) => movedOf(t, view.hash)),
        signer: ref.payer,
        ...signed,
      },
    ],
  };
}

/** The read of `x402/exact/eip155/erc7710`: the lookup of the named transaction, at coverage `none`. */
export const ERC7710_READ: ReadSpec<Erc7710Ref> = {
  coverage: "none",
  agreementValue: false,
  check: isErc7710Ref,
  search: "open",
  filters: () => [],
  classify: (ref, values, view) => erc7710Classify(ref, values, view),
  presented: erc7710Presented,
  payer: (ref) => ref.payer,
};

/** `status` of `x402/exact/eip155/erc7710`. */
export const erc7710Read = statusOf(ERC7710_READ);

export type { AtrHash };
