// The read kit's forms for the x402 pairings on eip155 chains: each case of read-status.json made on a constructed EVM
// endpoint (../../evm-chain.ts) and read by the pairing's own `status`, its answer put back in the case's terms.
//
// A case's positions are blocks: position p is block 1000·p, and where the case's search has range left at position
// `at`, every block from `at` up is moved so that the search's eight pages of 10,000 blocks end there. Its marks are the
// three heads: `final` at or below `finalized`, `safe` above it and at or below `safe`, `included` above that. A
// validity passed at a mark is a `validBefore` (or Permit2 `deadline`) that the head's block time has reached. The
// single-use value is read from the ledger: consumed from the block of the act that consumed it, or, where the case
// reads it consumed with no act found, from a block with no transaction below the final head (above it, where only the
// latest head reads it consumed). Calls, logs and signatures are encoded with viem 2.57.4 over the ABIs `@x402/evm`
// 2.31.0 publishes (`eip3009ABI`, `x402ExactPermit2ProxyABI`, `x402UptoPermit2ProxyABI`), and signed with Hardhat's
// published development keys, which hold nothing. Every fixture is constructed.
//
// A case whose facts this ledger cannot present as written is made in its own spelling where the rule that decides
// the case treats the two alike, and says so where it is made. The cases each pairing skips are those its read cannot
// meet on the ledger, each declared with the reason in the lists below (`*_DECLARED`).
import { x402ExactPermit2ProxyABI, x402UptoPermit2ProxyABI, eip3009ABI } from "@x402/evm";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, hashStruct, keccak256, parseAbi, toBytes, zeroAddress, type Hex as ViemHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agreementValue, type AtrHash } from "../../../src/core.js";
import { DELEGATION_MANAGER, ESCROW, EXACT_PERMIT2_PROXY, PAYMENT_AUTHORIZED_TOPIC, PERMIT2, REDEEMED_DELEGATION_TOPIC, ReaderError, UPTO_PERMIT2_PROXY, type Hex } from "../../../src/evm.js";
import type { Act, StatusAnswer } from "../../../src/internal/read.js";
import { BATCH_SETTLEMENT, CHANNEL_CREATED_TOPIC, DEPOSITED_TOPIC, batchChannelId, batchEvm } from "../../../src/x402-batch-settlement.js";
import { authCaptureEip3009, authCapturePermit2, exactEip3009, exactErc7710, exactErc7710Salt, exactPermit2, uptoPermit2 } from "../../../src/x402.js";
import { checkoutMandateX402 } from "../../../src/ap2.js";
import { abiStringOf, readerOf, topicOf, wordOf, type Chain, type ChainTx } from "../../evm-chain.js";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, answering, READ_STATUS } from "../harness.js";

// ── The parties, tokens and keys of every form.

const payerAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const payeeAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const otherAccount = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const lower = (a: string): Hex => a.toLowerCase() as Hex;
const PAYER = lower(payerAccount.address);
const PAYEE = lower(payeeAccount.address);
const OTHER = lower(otherAccount.address);
const ELSEWHERE = "0x00000000000000000000000000000000000e15e1" as Hex;
const NETWORK = "eip155:84532" as const;
const CHAIN_ID = 84532;
/** The asset (`A` in the cases), and another token (`B`) that publishes its own EIP-712 domain. */
const ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex;
const TOKEN_B = "0x0000000000000000000000000000000000000b0b" as Hex;
/** A token that emits EIP-3009's logs and answers no `name()`: the read cannot verify a use there. */
const TOKEN_MUTE = "0x00000000000000000000000000000000000d0d0d" as Hex;
const DOMAINS: Record<string, { name: string; version: string }> = {
  [ASSET]: { name: "USDC", version: "2" },
  [TOKEN_B]: { name: "Token B", version: "1" },
  [TOKEN_MUTE]: { name: "Mute", version: "1" },
};
const H = `0x${"5a".repeat(32)}` as AtrHash;
const AMOUNT = 10_000n;
const T0 = 1_700_000_000n;
const PAGE = 10_000;
const PAGES = 8;

const KEYS = { payer: payerAccount, payee: payeeAccount, other: otherAccount } as const;
const ADDRESS = { payer: PAYER, payee: PAYEE, other: OTHER } as const;
const ACCOUNT_OF = { payee: PAYEE, other: ELSEWHERE } as const;

/** A case's transaction names as 32-byte hashes, and back. */
const NAMES = ["t1", "t2", "a1", "c1", "u1", "u2"] as const;
const HASH: Record<string, Hex> = Object.fromEntries(NAMES.map((n, i) => [n, `0x${(i + 1).toString(16).padStart(2, "0").repeat(32)}` as Hex]));
const NAME_OF: Record<string, string> = Object.fromEntries(Object.entries(HASH).map(([n, h]) => [h, n]));
const ASSET_NAME: Record<string, string> = { [ASSET]: "A", [TOKEN_B]: "B" };
const ACCOUNT_NAME: Record<string, string> = { [PAYEE]: "payee", [ELSEWHERE]: "elsewhere" };

// ── The ledger a case is made on.

type Seen = ReadCase["facts"]["seen"][number];

/** A case laid out on blocks: its positions, heads, times and the block from which the value reads consumed. */
interface Layout {
  readonly block: (p: number) => bigint;
  readonly posOf: (b: bigint) => number | bigint;
  readonly heads: { finalized: bigint; safe: bigint; latest: bigint };
  readonly time: (b: bigint) => bigint;
  /** The signed bound: lapsed at the mark the case gives, or never. */
  readonly validBefore: (inclusive: boolean) => bigint;
  readonly start: bigint;
}

/** The block of each position of the case, the heads its marks need, and the bound its validity needs. */
function layout(c: ReadCase, lapse: CaseMark | "never"): Layout {
  const f = c.facts;
  const at = f.search.whole ? undefined : f.search.at;
  const after = c.query.after;
  const start = after === undefined ? 0n : BigInt(after) * 1000n + 1n;
  const shift = at === undefined ? 0n : start + BigInt(PAGE * PAGES) - BigInt(at) * 1000n;
  const block = (p: number): bigint => BigInt(p) * 1000n + (at !== undefined && p >= at ? shift : 0n);
  const placed = f.seen.filter((s) => s.position !== undefined);
  const of = (m: CaseMark): bigint[] => placed.filter((s) => s.mark === m).map((s) => block(s.position!));
  const max = (xs: bigint[]): bigint | undefined => (xs.length === 0 ? undefined : xs.reduce((a, b) => (a > b ? a : b)));
  const min = (xs: bigint[]): bigint | undefined => (xs.length === 0 ? undefined : xs.reduce((a, b) => (a < b ? a : b)));
  const above = [...of("safe"), ...of("included")];
  const finalized = max([...of("final"), ...(after === undefined ? [] : [BigInt(after) * 1000n])]) ?? (min(above) ?? 40_300n) - 300n;
  const safe = max(of("safe")) ?? finalized + 100n;
  const latest = max([...of("included"), safe + 100n, ...(at === undefined ? [] : [block(at) + 100n])])!;
  const time = (b: bigint): bigint => T0 + b;
  const headOf = { final: finalized, safe, included: latest } as const;
  const validBefore = (inclusive: boolean): bigint =>
    lapse === "never" ? time(latest) + 1_000_000n : time(headOf[lapse]) - (inclusive ? 0n : 1n);
  const positions = new Map<bigint, number>();
  for (const p of [...placed.map((s) => s.position!), ...(f.undecoded ?? []).flatMap((u) => (u.at === undefined ? [] : [u.at])), ...(at === undefined ? [] : [at]), ...(after === undefined ? [] : [after])]) {
    positions.set(block(p), p);
  }
  return { block, posOf: (b) => positions.get(b) ?? b, heads: { finalized, safe, latest }, time, validBefore, start };
}

/** The mark of the validity the case's value gives: lapsed at its mark, or not; lapsed at the final mark where it gives no value. */
function lapseOf(c: ReadCase): CaseMark | "never" {
  const v = c.facts.value;
  if (v === undefined) return "final";
  return v.lapsed ? v.mark : "never";
}

/** The answer in the case's terms: names for hashes, positions for blocks, the cases' marks, `A`/`B` and account names. */
function back(a: StatusAnswer<bigint, "latest" | "safe" | "finalized">, l: Layout): CaseAnswer {
  const mark = (m: string): CaseMark => (m === "finalized" ? "final" : m === "latest" ? "included" : "safe");
  const name = (h: string): string => NAME_OF[h.toLowerCase()] ?? h;
  const moved = (ms: readonly { asset: string; amount: string; to: string; transaction?: string; place?: number | string }[]) =>
    ms.map((m) => ({
      ...m,
      asset: ASSET_NAME[m.asset.toLowerCase()] ?? m.asset,
      to: ACCOUNT_NAME[m.to.toLowerCase()] ?? m.to,
      ...(m.transaction === undefined ? {} : { transaction: name(m.transaction) }),
    }));
  const out: Record<string, unknown> = { ...a };
  if ("transaction" in a && a.transaction !== undefined) out["transaction"] = name(a.transaction);
  if ("position" in a && a.position !== undefined) out["position"] = l.posOf(a.position);
  if ("finality" in a && a.finality !== undefined) out["finality"] = mark(a.finality);
  if ("moved" in a && a.moved !== undefined) out["moved"] = moved(a.moved);
  if ("search" in a && a.search !== undefined) out["search"] = l.posOf(a.search);
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(name);
  out["foreign"] = a.foreign.map((x) => ({
    ...x,
    transaction: name(x.transaction),
    ...(x.position === undefined ? {} : { position: l.posOf(x.position) }),
    ...(x.moved === undefined ? {} : { moved: moved(x.moved) }),
  }));
  return out as unknown as CaseAnswer;
}

/** The reader's fault a case gives, made through the read of the `finalized` head, which every read makes first. */
function faultedHead(c: ReadCase, chain: Chain): Chain {
  switch (c.facts.unreadable) {
    case undefined:
      return chain;
    case "transport":
      return { ...chain, headFault: () => new Error("connection reset") };
    case "unparseable":
      return { ...chain, headFault: () => "malformed" };
    case "too-large":
      return { ...chain, headFault: () => new ReaderError("too-large") };
    case "chain-mismatch":
      return { ...chain, network: "eip155:1" };
    default:
      throw new Error(`no case gives ${c.facts.unreadable} as a fault`);
  }
}

/** The reader's fault a case gives: each of the four an EVM endpoint can give. */
function faulted(c: ReadCase, chain: Chain): Chain {
  switch (c.facts.unreadable) {
    case undefined:
      return chain;
    case "transport":
      return { ...chain, call: () => Promise.reject(new Error("connection reset")) };
    case "unparseable":
      // An answer to the value's read that is not one word.
      return { ...chain, call: async () => "0x12" as Hex };
    case "too-large": {
      // The answer to the value's read exceeds the reader's bound.
      return { ...chain, call: () => Promise.reject(new ReaderError("too-large")) };
    }
    case "chain-mismatch":
      return { ...chain, network: "eip155:1" };
    default:
      throw new Error(`no case gives ${c.facts.unreadable} as a fault`);
  }
}

// ── Encoding, with the published ABIs.

/** The events, as FiatTokenV2_2 declares them (circlefin/stablecoin-evm `contracts/v2/EIP3009.sol`) and ERC-20 `Transfer`. */
const EVENTS = parseAbi([
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function topics(eventName: "AuthorizationUsed" | "AuthorizationCanceled" | "Transfer", args: Record<string, unknown>): Hex[] {
  return (encodeEventTopics({ abi: EVENTS, eventName, args } as never) as Hex[]).map((t) => t.toLowerCase() as Hex);
}

function transferLog(token: Hex, from: Hex, to: Hex, value: bigint) {
  return { address: token, topics: topics("Transfer", { from, to }), data: encodeAbiParameters([{ type: "uint256" }], [value]) as Hex };
}

/** An EIP-3009 `transferWithAuthorization` in its `v, r, s` form, signed by `signer` in `token`'s own domain. */
async function eip3009Call(signer: keyof typeof KEYS, token: Hex, to: Hex, value: bigint, validBefore: bigint, nonce: Hex): Promise<Hex> {
  const from = ADDRESS[signer];
  const message = { from, to, value, validAfter: 0n, validBefore, nonce };
  const signature = await KEYS[signer].signTypedData({
    domain: { ...DOMAINS[token]!, chainId: CHAIN_ID, verifyingContract: token },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message,
  });
  const sig = signature.slice(2);
  return encodeFunctionData({
    abi: eip3009ABI,
    functionName: "transferWithAuthorization",
    args: [from, to, value, 0n, validBefore, nonce, Number.parseInt(sig.slice(128, 130), 16), `0x${sig.slice(0, 64)}`, `0x${sig.slice(64, 128)}`],
  } as never) as Hex;
}

/** A Permit2 nonce of an owner, used from a block on. */
interface Bit {
  readonly owner: Hex;
  readonly nonce: Hex;
  readonly from: bigint;
}

/**
 * `name()` and `version()` of each token that publishes them; `authorizationState` from the ledger's value; and
 * Permit2's `nonceBitmap(owner, word)`, each bit of `bits` set from its block.
 */
function callsOf(consumedFrom: bigint | undefined, bits: readonly Bit[] = [], history = true): NonNullable<Chain["call"]> {
  return async (to, data, block) => {
    // An endpoint that does not hold the state asked for: absence without the history shown.
    if (!history) throw new ReaderError("history");
    if (data.startsWith("0xe94a0102")) return wordOf(consumedFrom !== undefined && block >= consumedFrom ? 1n : 0n);
    if (data.startsWith("0x4fe02b44")) {
      const owner = `0x${data.slice(34, 74)}`;
      const word = BigInt(`0x${data.slice(74, 138)}`);
      let set = 0n;
      for (const b of bits) {
        const n = BigInt(b.nonce);
        if (b.owner === owner && n >> 8n === word && block >= b.from) set |= 1n << (n & 0xffn);
      }
      return wordOf(set);
    }
    const domain = DOMAINS[to.toLowerCase()];
    if (domain !== undefined && to.toLowerCase() !== TOKEN_MUTE) {
      if (data === "0x06fdde03") return abiStringOf(domain.name);
      if (data === "0x54fd4d50") return abiStringOf(domain.version);
    }
    throw new Error("execution reverted");
  };
}

// ── `x402/exact/eip155/eip3009`.

/** The act's value and the other act's: H and the agreement's own value, by the act. */
async function valuesFor(act: Act): Promise<{ v: Hex; w: Hex }> {
  const d = (await agreementValue(H)) as Hex;
  return act === "agreement" ? { v: d, w: H } : { v: H, w: d };
}

/**
 * One transaction of the case on the EIP-3009 ledger. The payer's act is a use of the act's value (`kind` same) or the
 * other act's (`other`): on the asset where it consumed the payer's nonce, on token B where it consumed nothing (its
 * signature verified in B's own domain), with a `Transfer` per member of what moved, none where it names no account. An
 * act the payee or another account signed is its `AuthorizationCanceled` over the act's value on the asset, which the
 * search finds by any authorizer. A failed result is a reverted call of the payer's authorization.
 */
async function eip3009Tx(s: Seen, l: Layout, vb: bigint, values: { v: Hex; w: Hex }, assetTaken: { used: boolean }): Promise<ChainTx> {
  const hash = HASH[s.transaction]!;
  const block = l.block(s.position!);
  // A transaction that consumed the payer's nonce carries an authorization the payer signed, since the token verifies it:
  // a consumer another account signed is made as the payer's.
  const party = s.party === "other" && s.consumed && s.result === "succeeded" ? "payer" : s.party;
  const nonce = s.kind === "same" ? values.v : values.w;
  const to = s.account === "none" ? PAYEE : ACCOUNT_OF[s.account];
  const moved = s.moved ?? (s.account === "none" ? [] : [{ asset: "A", amount: AMOUNT.toString(), to: s.account === "payee" ? "payee" : "elsewhere" }]);
  const amount = BigInt(moved[0]?.amount ?? AMOUNT.toString());
  if (s.result === "failed") {
    return { hash, block, status: 0, logs: [], from: ADDRESS[party], to: ASSET, input: await eip3009Call(party, ASSET, to, amount, vb, nonce) };
  }
  if (party !== "payer") {
    return { hash, block, status: 1, from: ADDRESS[party], to: ASSET, input: "0x", logs: [{ address: ASSET, topics: topics("AuthorizationCanceled", { authorizer: ADDRESS[party], nonce: values.v }), data: "0x" }] };
  }
  const onAsset = moved[0]?.asset !== "B" && !(s.kind === "same" && (!s.consumed || assetTaken.used));
  if (onAsset && s.kind === "same") assetTaken.used = true;
  const token = onAsset ? ASSET : TOKEN_B;
  const logs = [
    { address: token, topics: topics("AuthorizationUsed", { authorizer: PAYER, nonce }), data: "0x" as Hex },
    ...moved.map((m) => transferLog(token, PAYER, m.to === "payee" ? PAYEE : ELSEWHERE, BigInt(m.amount))),
  ];
  return { hash, block, status: 1, from: PAYER, to: token, input: await eip3009Call("payer", token, to, amount, vb, nonce), logs };
}

/** An item the search cannot decode: the payer's use of the act's value on a token whose domain the read cannot read. */
async function eip3009Undecodable(name: string, block: bigint, vb: bigint, v: Hex): Promise<ChainTx> {
  return {
    hash: HASH[name]!,
    block,
    status: 1,
    from: PAYER,
    to: TOKEN_MUTE,
    input: await eip3009Call("payer", TOKEN_MUTE, PAYEE, AMOUNT, vb, v),
    logs: [{ address: TOKEN_MUTE, topics: topics("AuthorizationUsed", { authorizer: PAYER, nonce: v }), data: "0x" }, transferLog(TOKEN_MUTE, PAYER, PAYEE, AMOUNT)],
  };
}

/** The block from which the value reads consumed: the act that consumed it, else where the case reads it consumed. */
function consumedFromOf(c: ReadCase, l: Layout, txs: readonly ChainTx[], consumes: (t: ChainTx) => boolean): bigint | undefined {
  const by = txs.filter((t) => t.status === 1 && consumes(t)).map((t) => t.block);
  if (by.length > 0) return by.reduce((a, b) => (a < b ? a : b));
  const v = c.facts.value;
  if (v?.consumed === true) return l.heads.finalized - 50n;
  if (v?.head?.consumed === true) return l.heads.finalized + 50n;
  return undefined;
}

/** The read an EIP-3009 ledger's cases run through: a pairing's `status`, and the nonces of the act asked about. */
interface Eip3009Read {
  readonly status: (ref: never, reader: never, query: never) => Promise<StatusAnswer<bigint, "latest" | "safe" | "finalized">>;
  readonly values: (act: Act) => Promise<{ v: Hex; w: Hex }>;
}

const EXACT_EIP3009: Eip3009Read = { status: exactEip3009.status as never, values: valuesFor };

/**
 * `ap2/checkout-mandate/x402`'s carried payment: an EIP-3009 authorization whose nonce is keccak-256 of the payment
 * mandate chain (here of a constructed chain's text), standing in the reference where `x402/exact/eip155/eip3009`
 * has H; the other act's value another authorization's nonce.
 */
const MANDATE_NONCE = lower(keccak256(toBytes("a payment mandate chain")));
const AP2_X402: Eip3009Read = {
  status: checkoutMandateX402.status as never,
  values: async () => ({ v: MANDATE_NONCE, w: lower(keccak256(toBytes("another payment mandate chain"))) }),
};

function arrangeEip3009(c: ReadCase, act: Act, read: Eip3009Read = EXACT_EIP3009) {
  return {
    run: async (): Promise<CaseAnswer> => {
      const l = layout(c, lapseOf(c));
      const vb = l.validBefore(true);
      const values = await read.values(act);
      const taken = { used: false };
      const txs: ChainTx[] = [];
      for (const s of c.facts.seen) txs.push(await eip3009Tx(s, l, vb, values, taken));
      for (const u of c.facts.undecoded ?? []) txs.push(await eip3009Undecodable(u.transaction, l.block(u.at!), vb, values.v));
      const consumedFrom = consumedFromOf(c, l, txs, (t) =>
        t.logs.some((g) => g.address === ASSET && g.topics[1] === topics("AuthorizationUsed", { authorizer: PAYER, nonce: values.v })[1] && g.topics[2]?.toLowerCase() === values.v.toLowerCase()),
      );
      let chain: Chain = { network: NETWORK, heads: l.heads, time: l.time, txs, call: callsOf(consumedFrom, [], c.facts.history) };
      chain = faulted(c, chain);
      // The payment presented, as `reference` holds it: the act's members, its value one more where the case's differs.
      const compared = c.facts.seen.find((s) => s.presented !== undefined) ?? c.facts.seen.find((s) => s.kind === "same");
      const presentedAmount = BigInt(compared?.moved?.[0]?.amount ?? AMOUNT.toString()) + (compared?.presented === "no" ? 1n : 0n);
      const ref = {
        network: NETWORK,
        payee: PAYEE,
        h: read === EXACT_EIP3009 ? H : values.v,
        asset: ASSET,
        payer: PAYER,
        validBefore: (vb).toString(),
        presented: { token: ASSET, from: PAYER, to: PAYEE, value: presentedAmount.toString(), nonce: values.v.toLowerCase() },
      };
      return back(await read.status(ref as never, readerOf(chain) as never, queryOf(c, act, l)), l);
    },
  };
}

/** The query in the ledger's terms: its marks, and its position as a block. */
function queryOf(c: ReadCase, act: Act, l: Layout) {
  const others = (c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: HASH[o.transaction] ?? o.transaction } : o));
  return {
    act,
    finality: c.query.finality === "final" ? "finalized" : c.query.finality === "included" ? "latest" : "safe",
    ...(c.query.after === undefined ? {} : { after: l.block(c.query.after) }),
    ...(others.length === 0 ? {} : { others }),
  } as never;
}

// ── `x402/exact/eip155/permit2` and `x402/upto/eip155/permit2`.

type Proxy = "exact" | "upto";

/** A proxy's `settle`, as `x402ExactPermit2ProxyABI` and `x402UptoPermit2ProxyABI` encode it. */
function settleCall(proxy: Proxy, owner: Hex, token: Hex, amount: bigint, nonce: Hex, deadline: bigint, to: Hex): Hex {
  const permit = { permitted: { token, amount }, nonce: BigInt(nonce), deadline };
  const signature = `0x${"11".repeat(65)}` as ViemHex;
  return (
    proxy === "exact"
      ? encodeFunctionData({ abi: x402ExactPermit2ProxyABI, functionName: "settle", args: [permit, owner, { to, validAfter: 0n }, signature] } as never)
      : encodeFunctionData({
          abi: x402UptoPermit2ProxyABI,
          functionName: "settle",
          args: [permit, amount, owner, { to, facilitator: OTHER, validAfter: 0n }, signature],
        } as never)
  ) as Hex;
}

const PROXY_AT = { exact: lower(EXACT_PERMIT2_PROXY), upto: lower(UPTO_PERMIT2_PROXY) } as const;

/**
 * One transaction of the case on the Permit2 ledger, and the bit it sets. The payer's act is its own call of the
 * scheme's proxy over the act's value (`kind` same), or over the other act's value or through the other scheme's proxy
 * (`other`), with the proxy's `Transfer`; an act that names no account pays another (rule 9 treats the two alike, and
 * a proxy always transfers to its witness's `to`). An act the payee or another account signed is that owner's call over
 * the act's value in a transaction that also moves one unit of the payer's token B, by which the search for the
 * payer's transfers meets it. A failed result is the payer's reverted call.
 */
function permit2Tx(proxy: Proxy, s: Seen, l: Layout, deadline: bigint, values: { v: Hex; w: Hex | undefined }): { tx: ChainTx; bit?: Bit } {
  const hash = HASH[s.transaction]!;
  const block = l.block(s.position!);
  const party = s.party === "other" && s.consumed && s.result === "succeeded" ? "payer" : s.party;
  const owner = ADDRESS[party];
  const moved = s.moved ?? [{ asset: "A", amount: AMOUNT.toString(), to: s.account === "payee" ? "payee" : "elsewhere" }];
  const token = moved[0]!.asset === "B" ? TOKEN_B : ASSET;
  const to = s.account === "payee" ? PAYEE : ELSEWHERE;
  const amount = BigInt(moved[0]!.amount);
  // The other act: the other act's value through this proxy where the pairing has one, else this value through the other proxy.
  const callProxy: Proxy = s.kind === "same" || values.w !== undefined ? proxy : proxy === "exact" ? "upto" : "exact";
  const nonce = party !== "payer" || s.kind === "same" || values.w === undefined ? values.v : values.w;
  const input = settleCall(callProxy, owner, token, amount, nonce, deadline, to);
  if (s.result === "failed") return { tx: { hash, block, status: 0, logs: [], from: OTHER, to: PROXY_AT[callProxy], input } };
  const logs = [transferLog(token, owner, to, amount), ...(party === "payer" ? [] : [transferLog(TOKEN_B, PAYER, ELSEWHERE, 1n)])];
  return { tx: { hash, block, status: 1, logs, from: OTHER, to: PROXY_AT[callProxy], input }, bit: { owner, nonce: lower(nonce), from: block } };
}

function arrangePermit2(proxy: Proxy) {
  return (c: ReadCase, act: Act) => ({
    run: async (): Promise<CaseAnswer> => {
      const l = layout(c, lapseOf(c));
      const deadline = l.validBefore(false);
      const values = proxy === "exact" ? await valuesFor(act) : { v: H as Hex, w: undefined };
      const txs: ChainTx[] = [];
      const bits: Bit[] = [];
      for (const s of c.facts.seen) {
        const { tx, bit } = permit2Tx(proxy, s, l, deadline, values);
        txs.push(tx);
        // One use of a nonce of an owner: a later call over a used nonce sets nothing, and the read does not count it.
        if (bit !== undefined && !bits.some((b) => b.owner === bit.owner && b.nonce === bit.nonce)) bits.push(bit);
      }
      const own = bits.find((b) => b.owner === PAYER && b.nonce === values.v.toLowerCase());
      // Where the case gives no value and names an act the search must meet, the value reads consumed by an act the
      // search has not found, so that the payer's transfers are searched (rule 26: the value's reads are the search).
      const meets = c.facts.value === undefined && c.facts.seen.some((x) => x.result === "succeeded");
      const consumedFrom = own?.from ?? consumedFromOf(c, l, [], () => false) ?? (meets ? l.heads.finalized - 50n : undefined);
      if (own === undefined && consumedFrom !== undefined) bits.push({ owner: PAYER, nonce: lower(values.v), from: consumedFrom });
      let chain: Chain = { network: NETWORK, heads: l.heads, time: l.time, txs, call: callsOf(undefined, bits, c.facts.history) };
      chain = faulted(c, chain);
      const compared = c.facts.seen.find((x) => x.presented !== undefined) ?? c.facts.seen.find((x) => x.kind === "same");
      const amount = BigInt(compared?.moved?.[0]?.amount ?? AMOUNT.toString()) + (compared?.presented === "no" ? 1n : 0n);
      const ref = {
        network: NETWORK,
        payee: PAYEE,
        h: H,
        asset: ASSET,
        payer: PAYER,
        deadline: deadline.toString(),
        presented: {
          token: ASSET,
          amount: amount.toString(),
          nonce: lower(values.v),
          deadline: deadline.toString(),
          spender: PROXY_AT[proxy],
          owner: PAYER,
          to: PAYEE,
          validAfter: "0",
          ...(proxy === "upto" ? { facilitator: OTHER } : {}),
        },
      };
      const status = proxy === "exact" ? exactPermit2.status! : uptoPermit2.status!;
      return back(await status(ref as never, readerOf(chain), queryOf(c, act, l)), l);
    },
  });
}

// ── `x402/auth-capture/eip155/eip3009` and `…/permit2`: the escrow's events, by the payment hash.

/** The commerce-payments escrow's ABI, as its v1.1 deployment declares it (base/commerce-payments `AuthCaptureEscrow.sol`). */
const ESCROW_ABI = parseAbi([
  "struct PaymentInfo { address operator; address payer; address receiver; address token; uint120 maxAmount; uint48 preApprovalExpiry; uint48 authorizationExpiry; uint48 refundExpiry; uint16 minFeeBps; uint16 maxFeeBps; address feeReceiver; uint256 salt; }",
  "function authorize(PaymentInfo paymentInfo, uint256 amount, address tokenCollector, bytes collectorData)",
  "function charge(PaymentInfo paymentInfo, uint256 amount, address tokenCollector, bytes collectorData, uint256 feeAmount, address feeReceiver)",
  "event PaymentAuthorized(bytes32 indexed paymentInfoHash, PaymentInfo paymentInfo, uint256 amount, address tokenCollector)",
  "event PaymentCharged(bytes32 indexed paymentInfoHash, PaymentInfo paymentInfo, uint256 amount, address tokenCollector, uint256 feeAmount, address feeReceiver)",
]);
const DEPLOYMENT = ESCROW["v1.1"];
const AC_ESCROW = lower(DEPLOYMENT.escrow);
const AC_COLLECTOR = { eip3009: lower(DEPLOYMENT.eip3009Collector), permit2: lower(DEPLOYMENT.permit2Collector) } as const;
const AUTHORIZED = PAYMENT_AUTHORIZED_TOPIC.toLowerCase() as Hex;

type Info = {
  operator: Hex; payer: Hex; receiver: Hex; token: Hex; maxAmount: bigint; preApprovalExpiry: number; authorizationExpiry: number;
  refundExpiry: number; minFeeBps: number; maxFeeBps: number; feeReceiver: Hex; salt: bigint;
};

/** A `PaymentInfo` of the case: its operator, payer, receiver and expiry; the token the asset, the salt H. */
function infoOf(operator: Hex, payer: Hex, receiver: Hex, expiry: bigint, token: Hex = ASSET): Info {
  const e = Number(expiry);
  return { operator, payer, receiver, token, maxAmount: AMOUNT, preApprovalExpiry: e, authorizationExpiry: e + 1, refundExpiry: e + 2, minFeeBps: 0, maxFeeBps: 0, feeReceiver: zeroAddress, salt: BigInt(H) };
}

/**
 * The escrow's payment hash, as x402 2.31.0 computes it (`@x402/evm` `src/auth-capture/nonce.ts`, `hashPaymentInfo`):
 * keccak256(abi.encode(chainId, escrow, keccak256(abi.encode(PAYMENT_INFO_TYPEHASH, info)))), with payer zero the nonce
 * the payer signs.
 */
function paymentHashOf(info: Info, payer: Hex = info.payer): Hex {
  const typehash = keccak256(toBytes("PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)"));
  const inner = keccak256(
    encodeAbiParameters(
      ["bytes32", "address", "address", "address", "address", "uint120", "uint48", "uint48", "uint48", "uint16", "uint16", "address", "uint256"].map((type) => ({ type })),
      [typehash, info.operator, payer, info.receiver, info.token, info.maxAmount, info.preApprovalExpiry, info.authorizationExpiry, info.refundExpiry, info.minFeeBps, info.maxFeeBps, info.feeReceiver, info.salt],
    ),
  );
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "bytes32" }], [BigInt(CHAIN_ID), AC_ESCROW, inner])).toLowerCase() as Hex;
}

/** The escrow's event of the act's kind: `PaymentAuthorized` for the escrow flow, `PaymentCharged` the other flow. */
function escrowLog(kind: "same" | "other", id: Hex, info: Info, amount: bigint, collector: Hex) {
  const eventName = kind === "same" ? "PaymentAuthorized" : "PaymentCharged";
  const item = ESCROW_ABI.find((x) => x.type === "event" && x.name === eventName)! as { inputs: readonly { indexed?: boolean }[] };
  const values = kind === "same" ? [info, amount, collector] : [info, amount, collector, 0n, zeroAddress];
  return {
    address: AC_ESCROW,
    topics: (encodeEventTopics({ abi: ESCROW_ABI, eventName, args: { paymentInfoHash: id } } as never) as Hex[]).map(lower),
    data: encodeAbiParameters(item.inputs.filter((i) => i.indexed !== true) as never, values as never) as Hex,
  };
}

/**
 * One transaction of the case on the escrow's ledger. The act is the escrow's event over a `PaymentInfo` whose salt is
 * H: `PaymentAuthorized` (`kind` same) or the other flow's `PaymentCharged` (`other`), its `payer` the party, its
 * `receiver` the payee's account or another (rule 9 treats an act that names no account as one naming another, and a
 * `PaymentInfo` always names a receiver), its hash the presented payment's where it consumed the payer's value, and
 * another (another operator) where it did not. A transaction that consumed the payer's value carries the token
 * authorization the payer signed, which the collector redeems, so a consumer another account signed is made as the
 * payer's. A failed result is a reverted `authorize` of that `PaymentInfo`.
 */
function authCaptureTx(scheme: "eip3009" | "permit2", s: Seen, l: Layout, expiry: bigint, presented: Hex): ChainTx {
  const hash = HASH[s.transaction]!;
  const block = l.block(s.position!);
  const party = s.party === "other" && s.consumed && s.result === "succeeded" ? "payer" : s.party;
  const receiver = s.account === "payee" ? PAYEE : ELSEWHERE;
  // An act whose signed message differs from the payment presented: a second `PaymentInfo` the payer signed carrying H,
  // another `maxAmount` giving it another payment hash, through the deployment's collector and naming the receiver. It
  // consumed nothing, the payer's value being the presented payment's hash, and settles the leg all the same with
  // `presented` `no`: the case in this ledger's own spelling, which the deciding rule settles alike.
  const differs = s.presented === "no";
  const base = infoOf(s.consumed ? OTHER : ELSEWHERE, ADDRESS[party], receiver, expiry, s.moved?.[0]?.asset === "B" ? TOKEN_B : ASSET);
  const info = differs ? { ...base, maxAmount: AMOUNT + 1n } : base;
  const amount = BigInt(s.moved?.[0]?.amount ?? AMOUNT.toString());
  if (s.result === "failed") {
    const input = encodeFunctionData({ abi: ESCROW_ABI, functionName: "authorize", args: [info, amount, AC_COLLECTOR[scheme], "0x"] } as never) as Hex;
    return { hash, block, status: 0, logs: [], from: OTHER, to: AC_ESCROW, input };
  }
  const id = s.consumed && !differs ? presented : paymentHashOf(info);
  return { hash, block, status: 1, logs: [escrowLog(s.kind, id, info, amount, AC_COLLECTOR[scheme])], from: OTHER, to: AC_ESCROW, input: "0x" };
}

function arrangeAuthCapture(scheme: "eip3009" | "permit2") {
  return (c: ReadCase, act: Act) => ({
    run: async (): Promise<CaseAnswer> => {
      const l = layout(c, lapseOf(c));
      const expiry = l.validBefore(scheme === "eip3009");
      const own = infoOf(OTHER, PAYER, PAYEE, expiry);
      const paymentId = paymentHashOf(own);
      const signatureNonce = paymentHashOf(own, zeroAddress);
      const txs = c.facts.seen.map((s) => authCaptureTx(scheme, s, l, expiry, paymentId));
      // An item the search cannot decode: the escrow's `PaymentAuthorized` of another payment, with no `PaymentInfo` in its data.
      for (const u of c.facts.undecoded ?? []) {
        const other = infoOf(ELSEWHERE, PAYER, PAYEE, expiry);
        const log = { ...escrowLog("same", paymentHashOf(other), other, AMOUNT, AC_COLLECTOR[scheme]), data: "0x" as Hex };
        txs.push({ hash: HASH[u.transaction]!, block: l.block(u.at!), status: 1, logs: [log], from: OTHER, to: AC_ESCROW, input: "0x" });
      }
      const consumes = (t: ChainTx) => t.logs.some((g) => g.topics[1] === paymentId);
      const consumedFrom = consumedFromOf(c, l, txs, consumes);
      const bits = scheme === "permit2" && consumedFrom !== undefined ? [{ owner: PAYER, nonce: signatureNonce, from: consumedFrom }] : [];
      let chain: Chain = { network: NETWORK, heads: l.heads, time: l.time, txs, call: callsOf(scheme === "eip3009" ? consumedFrom : undefined, bits, c.facts.history) };
      chain = faulted(c, chain);
      const ref = {
        network: NETWORK,
        payee: PAYEE,
        h: H,
        scheme,
        asset: ASSET,
        payer: PAYER,
        escrow: AC_ESCROW,
        event: AUTHORIZED,
        paymentId,
        signatureNonce,
        salt: H.toLowerCase(),
        expiry: expiry.toString(),
      };
      const status = scheme === "eip3009" ? authCaptureEip3009.status! : authCapturePermit2.status!;
      return back(await status(ref as never, readerOf(chain), queryOf(c, act, l)), l);
    },
  });
}

// ── `x402/batch-settlement/eip155`: the channel contract's openings, by channel id and by salt.

/** The channel contract's `deposit` and events (x402 2.31.0 `src/batch-settlement/abi.ts`; `ChannelCreated`, `Deposited` by their topics). */
const BATCH_ABI = parseAbi([
  "struct ChannelConfig { address payer; address payerAuthorizer; address receiver; address receiverAuthorizer; address token; uint40 withdrawDelay; bytes32 salt; }",
  "function deposit(ChannelConfig config, uint128 amount, address collector, bytes collectorData)",
  "event ChannelCreated(bytes32 indexed channelId, ChannelConfig config)",
  "event Deposited(bytes32 indexed channelId, address indexed sender, uint128 amount, uint128 newBalance)",
]);
const CHANNEL_AT = lower(BATCH_SETTLEMENT);
/** `ChannelCreated`'s data: the config, its one non-indexed member. */
const CHANNEL_CREATED_DATA = (BATCH_ABI.find((x) => x.type === "event" && x.name === "ChannelCreated") as { inputs: readonly { indexed?: boolean }[] }).inputs.filter((i) => i.indexed !== true);
const AUTH_SALT = `0x${"a5".repeat(32)}` as Hex;

type Channel = { payer: Hex; payerAuthorizer: Hex; receiver: Hex; receiverAuthorizer: Hex; token: Hex; withdrawDelay: number; salt: Hex };

function channelOf(payer: Hex, receiver: Hex, token: Hex, withdrawDelay: number, salt: Hex = H.toLowerCase() as Hex): { config: Channel; id: Hex } {
  const config = { payer, payerAuthorizer: payer, receiver, receiverAuthorizer: OTHER, token, withdrawDelay, salt };
  return { config, id: lower(batchChannelId(CHAIN_ID, config) as Hex) };
}

/**
 * The refund authorizer of the scheme's refund-authorizer mode, and the presented channel's salt in that mode: the
 * stock client's packing of the entropy's first 12 bytes, `AUTH_SALT`'s, which are not all zero, and the refund authorizer
 * (`@x402/evm` 2.31.0 `packRefundAuthorizerSalt`, `dist/esm/chunk-7DJ4WEQ5.mjs:218-223`). H is then the deposit
 * authorization's salt, or the deposit permit's nonce.
 */
const REFUND_AUTHORIZER = lower("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Hex);
const PACKED_SALT = lower(`0x${AUTH_SALT.slice(2, 26)}${REFUND_AUTHORIZER.slice(2)}` as Hex);

/**
 * A deposit's logs: where it opens the channel, the payer's transfer of the amount to the channel contract (as Permit2's
 * deposit collector moves it) and `ChannelCreated`; then `Deposited`.
 */
function channelLogs(c: { config: Channel; id: Hex }, amount: bigint, created: boolean) {
  const topicsOf = (eventName: "ChannelCreated" | "Deposited", args: Record<string, unknown>) =>
    (encodeEventTopics({ abi: BATCH_ABI, eventName, args } as never) as Hex[]).map(lower);
  return [
    ...(created ? [transferLog(c.config.token, c.config.payer, CHANNEL_AT, amount)] : []),
    ...(created ? [{ address: CHANNEL_AT, topics: topicsOf("ChannelCreated", { channelId: c.id }), data: encodeAbiParameters(CHANNEL_CREATED_DATA as never, [c.config] as never) as Hex }] : []),
    { address: CHANNEL_AT, topics: topicsOf("Deposited", { channelId: c.id, sender: OTHER }), data: encodeAbiParameters([{ type: "uint128" }, { type: "uint128" }], [amount, amount]) as Hex },
  ];
}

/**
 * One transaction of the case on the channel contract's ledger. The act asked about, the payer's opening of the
 * presented channel to the payee that consumed the deposit authorization's nonce, is that channel's `ChannelCreated`
 * and `Deposited` beside the token's `AuthorizationUsed(payer, nonce)` (Permit2: the nonce in its input and the payer's
 * bit set from its block). An act of another kind is a later deposit into the presented channel, which consumes no
 * nonce of this authorization, where the payer's (an act of another kind another account signed is named by its signer,
 * rule 14). Any other act carrying H is the opening of another channel whose salt is H: its payer
 * the party, its receiver the payee's account or another (rule 9 treats an act that names no account as one naming
 * another, and a channel always names a receiver), its token the asset moved. A consumer another account signed is made
 * as the payer's, the collector redeeming only what the payer signed. A failed result is a reverted `deposit` of that
 * channel's config.
 */
function batchTx(scheme: "eip3009" | "permit2", s: Seen, l: Layout, own: { config: Channel; id: Hex }, nonce: Hex, k: number, taken: { used: boolean }): ChainTx {
  const hash = HASH[s.transaction]!;
  const block = l.block(s.position!);
  const party = s.party === "other" && s.consumed && s.result === "succeeded" ? "payer" : s.party;
  const amount = BigInt(s.moved?.[0]?.amount ?? AMOUNT.toString());
  // The nonce opens the presented channel once: a second such act is the payer's opening of another channel under H.
  const opening = s.kind === "same" && party === "payer" && s.consumed && (s.account === "payee") === (own.config.receiver === PAYEE) && !taken.used;
  if (opening && s.result === "succeeded") taken.used = true;
  // A later deposit into the presented channel is the payer's; an act of another kind another account signed is named by
  // its signer first (rule 14), so it is made as that account's opening of its own channel.
  const topUp = s.kind === "other" && party === "payer";
  const c = opening || topUp ? own : channelOf(ADDRESS[party], s.account === "payee" ? PAYEE : ELSEWHERE, s.moved?.[0]?.asset === "B" ? TOKEN_B : ASSET, 901 + k);
  const input = encodeFunctionData({ abi: BATCH_ABI, functionName: "deposit", args: [c.config, amount, OTHER, scheme === "permit2" ? nonce : "0x"] } as never) as Hex;
  if (s.result === "failed") return { hash, block, status: 0, logs: [], from: OTHER, to: CHANNEL_AT, input };
  const used = opening && scheme === "eip3009" ? [{ address: own.config.token, topics: topics("AuthorizationUsed", { authorizer: PAYER, nonce }), data: "0x" as Hex }] : [];
  return { hash, block, status: 1, logs: [...used, ...channelLogs(c, amount, !topUp)], from: OTHER, to: CHANNEL_AT, input: opening ? input : "0x" };
}

/**
 * The deposit method of a case on the one `x402/batch-settlement/eip155` form: ERC-3009 and Permit2 alternate by the
 * case's place in read-status.json, so the read kit runs both; `batchByMethod` runs every case under each.
 */
function methodOf(c: ReadCase): "eip3009" | "permit2" {
  return READ_STATUS.cases.findIndex((x) => x.case === c.case) % 2 === 0 ? "eip3009" : "permit2";
}

function arrangeBatch(fixed?: "eip3009" | "permit2", refundAuthorizer = false) {
  return (c: ReadCase, act: Act) => ({
    run: async (): Promise<CaseAnswer> => {
      const scheme = fixed ?? methodOf(c);
      const l = layout(c, lapseOf(c));
      const settleBy = l.validBefore(scheme === "eip3009");
      // The presented channel: to the payee in the asset, or as the payer's act that consumed its nonce names it, its
      // receiver another account (no account, rule 9) or its token another asset.
      const consumer = c.facts.seen.find((x) => x.result === "succeeded" && x.consumed && x.kind === "same" && (x.party === "payer" || x.party === "other"));
      const own = channelOf(
        PAYER,
        consumer !== undefined && consumer.account !== "payee" ? ELSEWHERE : PAYEE,
        consumer?.moved?.[0]?.asset === "B" ? TOKEN_B : ASSET,
        900,
        refundAuthorizer ? PACKED_SALT : undefined,
      );
      // The deposit authorization's nonce: keccak256(abi.encode(channelId, salt)) on ERC-3009 (x402 2.31.0
      // `src/batch-settlement/client`), the permit's nonce on Permit2; the salt, or the nonce, is H in the
      // refund-authorizer mode.
      const authSalt = refundAuthorizer ? (H.toLowerCase() as Hex) : AUTH_SALT;
      const nonce = scheme === "eip3009" ? lower(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [own.id, authSalt]))) : authSalt;
      const taken = { used: false };
      const txs = c.facts.seen.map((s, k) => batchTx(scheme, s, l, own, nonce, k, taken));
      for (const u of c.facts.undecoded ?? []) {
        const log = { address: CHANNEL_AT, topics: [lower(CHANNEL_CREATED_TOPIC), lower(`0x${"77".repeat(32)}`)], data: "0x" as Hex };
        txs.push({ hash: HASH[u.transaction]!, block: l.block(u.at!), status: 1, logs: [log], from: OTHER, to: CHANNEL_AT, input: "0x" });
      }
      const opened = (t: ChainTx) => t.input !== "0x" && t.logs.some((g) => g.topics[0] === lower(DEPOSITED_TOPIC) && g.topics[1] === own.id);
      const consumedFrom = consumedFromOf(c, l, txs, opened);
      const bits = scheme === "permit2" && consumedFrom !== undefined ? [{ owner: PAYER, nonce, from: consumedFrom }] : [];
      let chain: Chain = { network: NETWORK, heads: l.heads, time: l.time, txs, call: callsOf(scheme === "eip3009" ? consumedFrom : undefined, bits, c.facts.history) };
      chain = faulted(c, chain);
      const compared = c.facts.seen.find((x) => x.presented !== undefined) ?? c.facts.seen.find((x) => x.kind === "same");
      const amount = BigInt(compared?.moved?.[0]?.amount ?? AMOUNT.toString()) + (compared?.presented === "no" ? 1n : 0n);
      const ref = {
        network: NETWORK,
        payee: PAYEE,
        h: H,
        scheme,
        asset: own.config.token,
        payer: PAYER,
        channel: own.id,
        payerAuthorizer: own.config.payerAuthorizer,
        receiver: own.config.receiver,
        receiverAuthorizer: own.config.receiverAuthorizer,
        withdrawDelay: own.config.withdrawDelay,
        salt: own.config.salt,
        ...(refundAuthorizer ? { refundAuthorizer: REFUND_AUTHORIZER } : {}),
        nonce,
        settleBy: settleBy.toString(),
        amount: amount.toString(),
      };
      return back(await batchEvm.status(ref as never, readerOf(chain), queryOf(c, act, l)), l);
    },
  });
}

// ── `x402/exact/eip155/erc7710`, at coverage `none`: the lookup of the transaction a report names.

/**
 * The case's transaction, named in the reference: the token's `Transfer` from the payment's `delegator` to the payee's
 * account or another, as the account the act names; none where it names none; a revert for a failed result. An item
 * the lookup cannot decode is a named transaction whose `Transfer` from the delegator carries no one-word amount. The
 * position given, where the case gives none, is a block below every transaction of the case, at which the reader shows
 * the history the transaction would be in (rule 18 takes that read as the history shown): the read of this pairing is
 * always given a position, the one its agreement's settlement recorded, so a case that gives none, a coverage-`none`
 * case among them, is read at one.
 */
function arrangeErc7710(c: ReadCase, act: Act) {
  return {
    run: async (): Promise<CaseAnswer> => {
      const l = layout(c, "never");
      const txs: ChainTx[] = [];
      for (const s of c.facts.seen) {
        const to = s.account === "payee" ? PAYEE : ELSEWHERE;
        const logs = s.account === "none" ? [] : [transferLog(ASSET, PAYER, to, AMOUNT)];
        txs.push({ hash: HASH[s.transaction]!, block: l.block(s.position!), status: s.result === "failed" ? 0 : 1, logs, from: OTHER, to: OTHER });
      }
      for (const u of c.facts.undecoded ?? []) {
        txs.push({ hash: HASH[u.transaction]!, block: l.block(u.at!), status: 1, from: OTHER, to: OTHER, logs: [{ ...transferLog(ASSET, PAYER, PAYEE, AMOUNT), data: "0x" }] });
      }
      const named = c.facts.seen[0]?.transaction ?? c.facts.undecoded?.[0]?.transaction ?? "t1";
      let chain: Chain = { network: NETWORK, heads: l.heads, time: l.time, txs, call: callsOf(undefined), ...(c.facts.history ? {} : { lowest: l.heads.finalized }) };
      chain = faulted(c, chain);
      const ref = { network: NETWORK, payee: PAYEE, h: H, payer: PAYER, asset: ASSET, transaction: HASH[named]! };
      const given = c.query.after === undefined ? { ...c, query: { ...c.query, after: 1 } } : c;
      return back(await exactErc7710.status!(ref as never, readerOf(chain), queryOf(given, act, l)), l);
    },
  };
}

// ── `x402/exact/eip155/erc7710-salt`: the search for the redemptions whose root delegator is the payer.

/** `RedeemedDelegation`'s non-indexed member, MetaMask's `Delegation` struct (delegation-framework `DelegationManager.sol`). */
const DELEGATION = [
  {
    type: "tuple",
    components: [
      { name: "delegate", type: "address" },
      { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" },
      { name: "caveats", type: "tuple[]", components: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }, { name: "args", type: "bytes" }] },
      { name: "salt", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
  },
] as const;

/** The manager's EIP-712 `Delegation` type (delegation-framework `src/utils/Constants.sol`). */
const DELEGATION_TYPES = {
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
  ],
} as const;

/**
 * One transaction of the case on the delegation ledger: a redemption through the reference manager whose root is the
 * payer (another account's, where another signed, which the reference names since the search reads the payer's roots),
 * whose delegation carries H as its salt, the leaf's (`kind` same) or one further up the chain (`other`), its
 * delegator the payee where the payee signed; with a `Transfer` from the root per member of what moved. A failed
 * result is a reverted redemption, which emits nothing.
 */
function saltTx(s: Seen, l: Layout): ChainTx {
  const hash = HASH[s.transaction]!;
  const block = l.block(s.position!);
  if (s.result === "failed") return { hash, block, status: 0, logs: [], from: OTHER, to: DELEGATION_MANAGER };
  const root = s.party === "other" ? OTHER : PAYER;
  const redeemer = ELSEWHERE;
  const data = encodeAbiParameters(DELEGATION as never, [
    {
      delegate: s.kind === "same" ? redeemer : PAYEE,
      delegator: s.party === "payee" ? PAYEE : root,
      authority: `0x${"ff".repeat(32)}`,
      caveats: [],
      salt: BigInt(H),
      signature: "0x",
    },
  ] as never) as Hex;
  const moved = s.moved ?? (s.account === "none" ? [] : [{ asset: "A", amount: AMOUNT.toString(), to: s.account === "payee" ? "payee" : "elsewhere" }]);
  const logs = [
    { address: lower(DELEGATION_MANAGER), topics: [REDEEMED_DELEGATION_TOPIC.toLowerCase() as Hex, topicOf(root), topicOf(redeemer)], data },
    ...moved.map((m) => transferLog(m.asset === "B" ? TOKEN_B : ASSET, root, m.to === "payee" ? PAYEE : ELSEWHERE, BigInt(m.amount))),
  ];
  // Case 4's two transfers sit at places 1 and 4 of the receipt.
  if (moved.length === 2) logs.splice(2, 0, transferLog(TOKEN_B, OTHER, ELSEWHERE, 1n), transferLog(TOKEN_B, OTHER, ELSEWHERE, 1n));
  return { hash, block, status: 1, logs, from: redeemer, to: DELEGATION_MANAGER };
}

function arrangeErc7710Salt(c: ReadCase, act: Act) {
  return {
    run: async (): Promise<CaseAnswer> => {
      const l = layout(c, "never");
      const txs = c.facts.seen.map((s) => saltTx(s, l));
      for (const u of c.facts.undecoded ?? []) {
        txs.push({
          hash: HASH[u.transaction]!,
          block: l.block(u.at!),
          status: 1,
          from: OTHER,
          to: DELEGATION_MANAGER,
          logs: [{ address: lower(DELEGATION_MANAGER), topics: [REDEEMED_DELEGATION_TOPIC.toLowerCase() as Hex, topicOf(PAYER), topicOf(ELSEWHERE)], data: "0x" }],
        });
      }
      let chain: Chain = { network: NETWORK, heads: l.heads, time: l.time, txs, ...(c.facts.history ? {} : { lowest: l.start + 1n }) };
      chain = faultedHead(c, chain);
      const named = c.facts.seen.find((s) => s.party === "other");
      // The leaf delegation presented, whole, by its EIP-712 hash as viem's `hashStruct` gives it over the manager's
      // `Delegation` type: the leaf `saltTx` writes, its authority another where the case's differs.
      const differs = c.facts.seen.some((x) => x.presented === "no");
      const leaf = { delegate: ELSEWHERE, delegator: PAYER, authority: `0x${(differs ? "fe" : "ff").repeat(32)}` as Hex, caveats: [], salt: BigInt(H) };
      const presented = { delegation: hashStruct({ data: leaf, primaryType: "Delegation", types: DELEGATION_TYPES }).toLowerCase() };
      const ref = { network: NETWORK, payee: PAYEE, h: H, payer: PAYER, asset: ASSET, presented, ...(named === undefined ? {} : { transaction: HASH[named.transaction]! }) };
      return back(await exactErc7710Salt.status!(ref as never, readerOf(chain), queryOf(c, act, l)), l);
    },
  };
}

// ── The declarations: the cases each read cannot meet on the ledger, with the reason.

/** The cases whose text opens with `words`, on both acts. */
function opening(words: string, stated: string): Inapplicable[] {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words));
  if (found.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return found.map((c) => ({ case: c.case, stated }));
}

/** The cases whose facts give a single-use value. */
function givingValue(stated: string): Inapplicable[] {
  return READ_STATUS.cases.filter((c) => c.facts.value !== undefined).map((c) => ({ case: c.case, stated }));
}

/** One statement per case and act: a case two declarations take is stated once, by the first. */
function once(...lists: Inapplicable[][]): Inapplicable[] {
  const seen = new Set<string>();
  const out: Inapplicable[] = [];
  for (const d of lists.flat()) {
    const acts = (d.acts ?? ACTS).filter((a) => !seen.has(`${d.case}\u0000${a}`));
    for (const a of acts) seen.add(`${d.case}\u0000${a}`);
    if (acts.length > 0) out.push({ case: d.case, acts, stated: d.stated });
  }
  return out;
}

/**
 * The declarations less the cases the read meets when run, each found by running the case with its declaration
 * removed, so that a pairing skips only the cases its read cannot meet. A case is named by its opening words, on the
 * acts given.
 */
function meeting(declared: readonly Inapplicable[], met: readonly (readonly [string, readonly Act[]])[]): Inapplicable[] {
  for (const [words] of met) if (!declared.some((d) => d.case.startsWith(words))) throw new Error(`no declaration opens with "${words}"`);
  return declared.flatMap((d) => {
    const acts = (d.acts ?? ACTS).filter((a) => !met.some(([words, on]) => d.case.startsWith(words) && on.includes(a)));
    return acts.length === 0 ? [] : [{ ...d, acts }];
  });
}
const BOTH: readonly Act[] = ["payment", "agreement"];
const PAYMENT: readonly Act[] = ["payment"];

const MARKS = "Declared inapplicable to the read kit on the x402 eip155 reads";
const TX_FAILED = [
  ...answering("transaction-failed", `${MARKS}: transaction-failed on every pairing, since a reverted transaction consumes no authorization nonce, Permit2 bit or approval`),
  ...opening("a failed result that consumed the value", `${MARKS}: transaction-failed on every pairing and, for the same reason, the cases opening a failed result that consumed the value, since a reverted transaction consumes no authorization nonce, Permit2 bit or approval`),
];
const NOT_FOUND = answering("not-found", `${MARKS}: not-found on every pairing but x402/exact/eip155/erc7710, since each other read holds its single-use value or, on erc7710-salt, searches for as long as the caller asks`);
const NOPOS = [
  ...opening("an act the read cannot place against the position given", `${MARKS}: on every pairing, an act the read cannot place against the position given (its three cases), since every log and receipt the read meets names its block`),
  ...opening("an item the search could not decode that gives no position", `${MARKS}: on every pairing, an item the search could not decode that gives no position, since every log and receipt the read meets names its block`),
];
const HELD_HEAD = [
  ...opening("a read with no means to read the single-use value", `${MARKS}: on every pairing that holds its single-use value, a read with no means to read the single-use value, since it reads the value at a finalized block and at the latest block`),
  ...opening("search-incomplete is answered before not-found", `${MARKS}: on every pairing that holds its single-use value, search-incomplete is answered before not-found, since it reads the value at a finalized block and at the latest block`),
  ...opening("a read that did not read the value at the latest head", `${MARKS}: on every pairing that holds its single-use value, a read that did not read the value at the latest head, since it reads the value at a finalized block and at the latest block`),
];
const EACH_TRANSFER = opening(
  "each transfer of what moved is named by its transaction and its place",
  `${MARKS}: on eip3009 and both Permit2 pairings, each transfer of what moved is named by its transaction and its place, since a use moves one transfer and the scheme's proxy one`,
);

/** The declarations of `x402/exact/eip155/eip3009`. */
export const EIP3009_DECLARED: readonly Inapplicable[] = meeting(once(TX_FAILED, NOT_FOUND, NOPOS, HELD_HEAD, EACH_TRANSFER), [
  ["search-incomplete is answered before not-found", BOTH],
]);

function formOf(
  subject: DeclaredForm["form"]["subject"],
  declared: readonly Inapplicable[],
  arrange: (c: ReadCase, act: Act) => { run: () => Promise<CaseAnswer> },
): DeclaredForm {
  return {
    form: {
      subject,
      arrange: (c, act) => {
        const d = declared.find((x) => x.case === c.case && (x.acts === undefined || x.acts.includes(act)));
        return d !== undefined ? { inapplicable: d.stated } : arrange(c, act);
      },
    },
    inapplicable: declared,
  };
}

const UNUSED_CONSUMED_7710 = [
  ...answering("instrument-unused", `${MARKS}: instrument-unused and instrument-consumed on both ERC-7710 levels, which sign no bound and hold no single-use value`),
  ...answering("instrument-consumed", `${MARKS}: instrument-unused and instrument-consumed on both ERC-7710 levels, which sign no bound and hold no single-use value`),
];
const VALUE_7710 = givingValue(`${MARKS}: on both ERC-7710 levels every case whose facts give a single-use value, since they hold none`);

/** The declarations of `x402/exact/eip155/erc7710`. */
export const ERC7710_DECLARED: readonly Inapplicable[] = once(TX_FAILED, UNUSED_CONSUMED_7710, NOPOS, VALUE_7710);

const BELOW_POSITION_7710 = `${MARKS}: on erc7710-salt, before-position is decided before any other reason and a transaction at the position given counts as before it, whose act carrying H lies at or below the position given: its search for H starts at that position, it holds no value whose read there would show an act below it, and a leaf delegation carries H, so it is signed only after the ATR exists, and the position the caller gives is the one read before then; the cost, on a test network that restarts: a redemption landed on the restarted ledger below that position is not met, and the search runs for as long as the caller asks`;
const BELOW_POSITION_SALT = [
  ...opening("before-position is decided before any other reason", BELOW_POSITION_7710),
  ...opening("a transaction at the position given counts as before it", BELOW_POSITION_7710),
];

/** The declarations of `x402/exact/eip155/erc7710-salt`. */
export const ERC7710_SALT_DECLARED: readonly Inapplicable[] = meeting(once(TX_FAILED, NOT_FOUND, UNUSED_CONSUMED_7710, NOPOS, VALUE_7710, BELOW_POSITION_SALT), [
  ["a read that did not read the value at the latest head", PAYMENT],
  ["a search narrowed to one asset, payee or token", PAYMENT],
  ["a value read consumed whose transaction the search has not found", PAYMENT],
  ["a value unconsumed at the final mark and consumed at the latest head", PAYMENT],
  ["a value whose validity passed, unconsumed at the final mark and consumed", PAYMENT],
  ["an item the caller gave that the read cannot decode, beside one", PAYMENT],
  ["an item the search could not decode holds a failed answer", PAYMENT],
  ["at coverage full, instrument-consumed waits for the search for H", PAYMENT],
  ["below-mark is answered before instrument-live", PAYMENT],
  ["the validity passed with the value unconsumed and the search for H not", PAYMENT],
]);

const BIT_IS_CARRIER = `${MARKS}: on both Permit2 pairings, since the nonce is H, in decimal on upto, or on an agreement the agreement's own value, and Permit2 keeps one bitmap per owner for every token, so the bit is H's own carrier: its reads at a finalized block and at the latest block are the search, read whole, and meet no item the read cannot decode`;
const PERMIT2_RULE26 = [
  "a search narrowed to one asset, payee or token",
  "the validity passed with the value unconsumed and the search for H not read whole",
  "instrument-live is answered before search-incomplete",
  "a search that met an item it cannot decode",
  "the answer names every item the search could not decode",
  "an item the search could not decode holds a failed answer",
  "the search's range left to read and an item it could not decode",
  "an item the caller gave by its transaction holds no search",
  "an item the caller gave that the read cannot decode, beside one",
  "instrument-live is answered before an item the search could not decode",
].flatMap((words) => opening(words, BIT_IS_CARRIER));

/**
 * The declarations of both Permit2 pairings. The cases of an act carrying H that consumed nothing arise on them: the
 * read names as a foreign item another owner's proxy call or nonce invalidation over H, and the payer's over the other
 * act's value, in a transaction its search finds.
 */
export const PERMIT2_DECLARED: readonly Inapplicable[] = once(TX_FAILED, NOT_FOUND, NOPOS, HELD_HEAD, EACH_TRANSFER, PERMIT2_RULE26);

const ONE_EVENT = opening(
  "each transfer of what moved is named by its transaction and its place",
  `${MARKS}: on both auth-capture pairings and batch-settlement, each transfer of what moved is named by its transaction and its place, since the escrow records each act as one event naming one amount and one receiver, and the channel contract each opening as one Deposited naming one amount`,
);

const NO_SEARCH = `${MARKS}: instrument-unused and instrument-consumed on auth-capture and batch-settlement, whose single-use value is a digest over H and the offer's other members (the escrow's payment hash; a digest over the channel id), so its read is no search for H, and the read defines none: each answers search-incomplete where it would answer failed`;
/** The cases a read with no search for H answers otherwise: on auth-capture and batch-settlement, which define none. */
const NO_SEARCH_FOR_H = [...answering("instrument-unused", NO_SEARCH), ...answering("instrument-consumed", NO_SEARCH)];

/**
 * The declarations of both `auth-capture` pairings and of `x402/batch-settlement/eip155`. Each states no search for H
 * and answers no `failed` but `before-position`, so it meets the two cases of a read with no value.
 */
export const NO_SEARCH_DECLARED: readonly Inapplicable[] = meeting(once(TX_FAILED, NOT_FOUND, NO_SEARCH_FOR_H, NOPOS, HELD_HEAD, ONE_EVENT), [
  ["a read with no means to read the single-use value", BOTH],
  ["search-incomplete is answered before not-found", BOTH],
]);

const AP2_MARKS = "Declared inapplicable to the read kit on ap2/checkout-mandate/x402, whose read is the EIP-3009 read, the authorization's nonce standing where H stands, read at the final mark and at the latest head";
const AP2_HOLDS_VALUE = `${AP2_MARKS}: the read holds its single-use value and reads it at both marks, so it answers instrument-unused or instrument-consumed by that value, which no item the search could not decode changes`;

/** The declarations of `ap2/checkout-mandate/x402`. */
export const AP2_X402_DECLARED: readonly Inapplicable[] = once(
  answering("transaction-failed", `${AP2_MARKS}: transaction-failed, since a reverted transaction consumes no authorization nonce`),
  opening("a failed result that consumed the value", `${AP2_MARKS}: the cases opening a failed result that consumed the value, since a reverted transaction consumes no authorization nonce`),
  answering("not-found", AP2_HOLDS_VALUE),
  opening("at coverage none, a lookup read whole beside an item the search could not decode", AP2_HOLDS_VALUE),
);

export const forms: readonly DeclaredForm[] = [
  formOf("x402/exact/eip155/eip3009", EIP3009_DECLARED, (c, act) => arrangeEip3009(c, act)),
  formOf("x402/exact/eip155/erc7710", ERC7710_DECLARED, arrangeErc7710),
  formOf("x402/exact/eip155/erc7710-salt", ERC7710_SALT_DECLARED, arrangeErc7710Salt),
  formOf("x402/exact/eip155/permit2", PERMIT2_DECLARED, arrangePermit2("exact")),
  formOf("x402/upto/eip155/permit2", PERMIT2_DECLARED, arrangePermit2("upto")),
  formOf("x402/auth-capture/eip155/eip3009", NO_SEARCH_DECLARED, arrangeAuthCapture("eip3009")),
  formOf("x402/auth-capture/eip155/permit2", NO_SEARCH_DECLARED, arrangeAuthCapture("permit2")),
  formOf("x402/batch-settlement/eip155", NO_SEARCH_DECLARED, arrangeBatch()),
  formOf("ap2/checkout-mandate/x402", AP2_X402_DECLARED, (c, act) => arrangeEip3009(c, act, AP2_X402)),
];

/**
 * The `x402/batch-settlement/eip155` form with each deposit method fixed, every case run under it, and under each in the
 * scheme's refund-authorizer mode, where the presented channel's salt packs the refund authorizer and H is the deposit
 * authorization's salt or the permit's nonce; the other acts carrying H are other channels' openings whose salt is H.
 */
export const batchByMethod: readonly { readonly method: "eip3009" | "permit2"; readonly mode: "salt" | "refund-authorizer"; readonly declared: DeclaredForm }[] = [
  { method: "eip3009", mode: "salt", declared: formOf("x402/batch-settlement/eip155", NO_SEARCH_DECLARED, arrangeBatch("eip3009")) },
  { method: "permit2", mode: "salt", declared: formOf("x402/batch-settlement/eip155", NO_SEARCH_DECLARED, arrangeBatch("permit2")) },
  { method: "eip3009", mode: "refund-authorizer", declared: formOf("x402/batch-settlement/eip155", NO_SEARCH_DECLARED, arrangeBatch("eip3009", true)) },
  { method: "permit2", mode: "refund-authorizer", declared: formOf("x402/batch-settlement/eip155", NO_SEARCH_DECLARED, arrangeBatch("permit2", true)) },
];

void PERMIT2;
