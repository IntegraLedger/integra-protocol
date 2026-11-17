// An EVM node stub for the `evm` and `erc7710` modules' tests: a JSON-RPC endpoint over test/support.ts's `stub` that
// answers what each form's profile says the chain holds. Contracts have code, a token's `allowance` and `balanceOf` are
// ample, every simulated call succeeds, and a sent transaction is decoded and given the receipt its profile names
// (`logsOf`): what moved, as the token's `Transfer`, and EIP-3009's `AuthorizationUsed`. Nothing reaches a network.
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { eip3009ABI, x402ExactPermit2ProxyABI, x402UptoPermit2ProxyABI } from "@x402/evm";
import { stub, type Stub } from "./support.js";

export { TRANSFER_TOPIC, AUTHORIZATION_USED_TOPIC } from "@integraledger/lcp/evm";
import { AUTHORIZATION_STATE_SELECTOR, AUTHORIZATION_USED_TOPIC, NONCE_BITMAP_SELECTOR, TRANSFER_TOPIC } from "@integraledger/lcp/evm";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const TRY_AGGREGATE = "0xbce38bd7";
const ALLOWANCE = "0xdd62ed3e";
const BALANCE_OF = "0x70a08231";
const MAX = (1n << 256n) - 1n;
const CODE = "0x6080604052";
const GAS_USED = 65_000n;
const EFFECTIVE_GAS_PRICE = 1_500_000_000n;

export interface EvmLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
}

export interface Sent {
  hash: Hex;
  from: Hex;
  to: Hex;
  input: Hex;
  gas: bigint;
  maxFeePerGas: bigint;
}

export interface EvmChain {
  readonly chainId: number;
  /** The head's timestamp, Unix seconds. */
  readonly now: number;
  /** Addresses with code, lowercase. */
  readonly code: Set<string>;
  /** Every transaction the node received, in order. */
  readonly sent: Sent[];
  /** Every JSON-RPC method the node was asked, in order. */
  readonly methods: string[];
  /** Each Permit2 owner's nonces a sent proxy call spent, by the owner's lowercase address. */
  readonly spent: Map<string, bigint[]>;
  /** Whether a sent transaction's receipt is withheld: the node shows it unmined. */
  withhold: boolean;
  /** Members every receipt carries beside Ethereum's, as an OP Stack node's carry the L1 data fee (`l1Fee`). */
  receiptMore?: Record<string, Hex> | undefined;
  /** What a call or a sent transaction's input emits, by the profile of the form it is; undefined for no logs. */
  logsOf: (to: Hex, input: Hex) => EvmLog[] | undefined;
  /** A contract's own answer to an `eth_call`, where the form's profile names one; the defaults below where undefined. */
  answers?: ((to: Hex, input: Hex) => Hex | undefined) | undefined;
  /** What a simulated call emits (`eth_simulateV1`); `logsOf` where absent. */
  simulate?: ((to: Hex, input: Hex) => { ok: boolean; logs: EvmLog[] }) | undefined;
}

function hex(v: bigint | number): Hex {
  return `0x${v.toString(16)}`;
}

function word(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** A token's `Transfer` log. */
export function transferLog(token: string, from: string, to: string, value: bigint): EvmLog {
  return { address: token.toLowerCase() as Hex, topics: [TRANSFER_TOPIC, word(from), word(to)], data: encodeAbiParameters([{ type: "uint256" }], [value]) };
}

/**
 * The logs each x402 EVM settling call emits by its contract's code: EIP-3009's `transferWithAuthorization`, the use
 * of the authorization and the transfer it makes; the x402 Permit2 proxies' `settle`, the token's transfer of the
 * permit's amount (`exact`) or the amount settled (`upto`) to the witness's `to`.
 */
export function profileLogs(to: Hex, input: Hex): EvmLog[] | undefined {
  try {
    const d = decodeFunctionData({ abi: eip3009ABI, data: input });
    if (d.functionName === "transferWithAuthorization") {
      const [from, payee, value, , , nonce] = d.args as unknown as [Hex, Hex, bigint, bigint, bigint, Hex];
      return [
        { address: to.toLowerCase() as Hex, topics: [AUTHORIZATION_USED_TOPIC, word(from), nonce.toLowerCase() as Hex], data: "0x" },
        transferLog(to, from, payee, value),
      ];
    }
  } catch {
    // another contract's call
  }
  for (const abi of [x402ExactPermit2ProxyABI, x402UptoPermit2ProxyABI]) {
    try {
      const d = decodeFunctionData({ abi, data: input });
      if (d.functionName !== "settle") continue;
      const args = d.args as unknown as readonly unknown[];
      const permit = args[0] as { permitted: { token: Hex; amount: bigint } };
      const upto = args.length === 5;
      const amount = upto ? (args[1] as bigint) : permit.permitted.amount;
      const owner = (upto ? args[2] : args[1]) as Hex;
      const witness = (upto ? args[3] : args[2]) as { to: Hex };
      return [transferLog(permit.permitted.token, owner, witness.to, amount)];
    } catch {
      // another proxy's call
    }
  }
  return undefined;
}

/** The owner and nonce of the permit an x402 Permit2 proxy's `settle` spends, or undefined for another call. */
function permitOf(input: Hex): { owner: string; nonce: bigint } | undefined {
  for (const abi of [x402ExactPermit2ProxyABI, x402UptoPermit2ProxyABI]) {
    try {
      const d = decodeFunctionData({ abi, data: input });
      if (d.functionName !== "settle") continue;
      const args = d.args as unknown as readonly unknown[];
      const owner = (args.length === 5 ? args[2] : args[1]) as Hex;
      return { owner: owner.toLowerCase(), nonce: (args[0] as { nonce: bigint }).nonce };
    } catch {
      // another proxy's call
    }
  }
  return undefined;
}

/** `eth_call`'s answer to one call: a token's allowance and balance are ample, and every other call returns zeros. */
function callAnswer(to: string, input: string, own?: (to: Hex, input: Hex) => Hex | undefined): Hex {
  const answered = own?.(to.toLowerCase() as Hex, input.toLowerCase() as Hex);
  if (answered !== undefined) return answered;
  const selector = input.slice(0, 10).toLowerCase();
  if (selector === ALLOWANCE || selector === BALANCE_OF) return encodeAbiParameters([{ type: "uint256" }], [selector === ALLOWANCE ? MAX : 10n ** 24n]);
  if (to.toLowerCase() === MULTICALL3 && selector === TRY_AGGREGATE) {
    const d = decodeFunctionData({ abi: TRY_AGGREGATE_ABI, data: input as Hex });
    const calls = d.args[1] as readonly { target: Hex; callData: Hex }[];
    return encodeFunctionResult({
      abi: TRY_AGGREGATE_ABI,
      functionName: "tryAggregate",
      result: calls.map((c) => ({ success: true, returnData: callAnswer(c.target, c.callData, own) })),
    });
  }
  return `0x${"00".repeat(128)}`;
}

/** Multicall3's `tryAggregate`, through which x402's classes batch their reads. */
const TRY_AGGREGATE_ABI = [
  {
    type: "function",
    name: "tryAggregate",
    stateMutability: "payable",
    inputs: [
      { name: "requireSuccess", type: "bool" },
      { name: "calls", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "callData", type: "bytes" }] },
    ],
    outputs: [{ name: "returnData", type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }],
  },
] as const;

/** The node: a JSON-RPC stub over `chain`. */
export async function evmNode(chain: EvmChain): Promise<Stub> {
  const receipts = new Map<string, { status: 0 | 1; logs: EvmLog[]; sent: Sent; block: bigint }>();
  const mined = () => (chain.withhold ? [] : [...receipts.values()].filter((r) => r.status === 1).flatMap((r) => r.logs));
  const head = () => 1000n + BigInt(chain.sent.length);
  const block = (n: bigint) => ({
    number: hex(n),
    hash: keccak256(word(hex(n))),
    parentHash: `0x${"00".repeat(32)}`,
    timestamp: hex(chain.now),
    baseFeePerGas: hex(1_000_000_000n),
    gasLimit: hex(30_000_000n),
    gasUsed: "0x0",
    miner: `0x${"00".repeat(20)}`,
    extraData: "0x",
    logsBloom: `0x${"00".repeat(256)}`,
    transactions: [],
    uncles: [],
    difficulty: "0x0",
    nonce: "0x0000000000000000",
    size: "0x0",
    stateRoot: `0x${"00".repeat(32)}`,
    receiptsRoot: `0x${"00".repeat(32)}`,
    transactionsRoot: `0x${"00".repeat(32)}`,
    sha3Uncles: `0x${"00".repeat(32)}`,
    mixHash: `0x${"00".repeat(32)}`,
  });
  const logFields = (l: EvmLog, i: number, hash: Hex, n: bigint) => ({
    ...l,
    blockNumber: hex(n),
    blockHash: keccak256(word(hex(n))),
    transactionHash: hash,
    transactionIndex: "0x0",
    logIndex: hex(i),
    removed: false,
  });
  const answer = async (method: string, params: unknown[]): Promise<unknown> => {
    chain.methods.push(method);
    switch (method) {
      case "eth_chainId":
        return hex(chain.chainId);
      case "eth_blockNumber":
        return hex(head());
      case "eth_getBlockByNumber":
        return block(head());
      case "eth_maxPriorityFeePerGas":
        return hex(500_000_000n);
      case "eth_gasPrice":
        return hex(EFFECTIVE_GAS_PRICE);
      case "eth_estimateGas":
        return hex(GAS_USED * 2n);
      case "eth_getTransactionCount":
        return hex(chain.sent.length);
      case "eth_getCode":
        return chain.code.has(String(params[0]).toLowerCase()) ? CODE : "0x";
      case "eth_call": {
        const c = params[0] as { to: Hex; data?: Hex; input?: Hex };
        const input = (c.data ?? c.input ?? "0x").toLowerCase();
        // The single-use value's state, as the transactions mined so far leave it: EIP-3009's `authorizationState`
        // is true once the token emitted `AuthorizationUsed` for it; Permit2's `nonceBitmap` word has the bit of each
        // nonce a mined proxy call spent.
        if (input.startsWith(AUTHORIZATION_STATE_SELECTOR)) {
          const [from, nonce] = [`0x${input.slice(34, 74)}`, `0x${input.slice(74, 138)}`];
          const used = mined().some((l) => l.address === c.to.toLowerCase() && l.topics[0] === AUTHORIZATION_USED_TOPIC && l.topics[1] === word(from) && l.topics[2] === nonce);
          return encodeAbiParameters([{ type: "bool" }], [used]);
        }
        if (input.startsWith(NONCE_BITMAP_SELECTOR)) {
          const [owner, position] = [`0x${input.slice(34, 74)}`, BigInt(`0x${input.slice(74, 138)}`)];
          let bits = 0n;
          for (const n of chain.spent.get(owner) ?? []) if (n >> 8n === position) bits |= 1n << (n & 0xffn);
          return encodeAbiParameters([{ type: "uint256" }], [bits]);
        }
        return callAnswer(c.to, input, chain.answers);
      }
      case "eth_simulateV1": {
        const req = params[0] as { blockStateCalls: { calls: { to: Hex; data?: Hex; input?: Hex }[] }[] };
        const calls = req.blockStateCalls[0]!.calls.map((c) => {
          const input = c.data ?? c.input ?? "0x";
          const s = chain.simulate?.(c.to, input) ?? { ok: true, logs: chain.logsOf(c.to, input) ?? [] };
          return {
            status: s.ok ? "0x1" : "0x0",
            returnData: "0x",
            gasUsed: hex(GAS_USED),
            logs: s.logs.map((l, i) => logFields(l, i, `0x${"00".repeat(32)}`, head() + 1n)),
            ...(s.ok ? {} : { error: { code: 3, message: "execution reverted", data: "0x" } }),
          };
        });
        return [{ ...block(head() + 1n), calls }];
      }
      case "eth_sendRawTransaction": {
        const raw = params[0] as TransactionSerialized;
        const tx = parseTransaction(raw);
        const from = (await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() as Hex;
        const sent: Sent = {
          hash: keccak256(raw),
          from,
          to: (tx.to ?? "0x").toLowerCase() as Hex,
          input: (tx.data ?? "0x") as Hex,
          gas: tx.gas ?? 0n,
          maxFeePerGas: tx.maxFeePerGas ?? tx.gasPrice ?? 0n,
        };
        chain.sent.push(sent);
        const logs = chain.logsOf(sent.to, sent.input);
        const permit = logs === undefined ? undefined : permitOf(sent.input);
        if (permit !== undefined) chain.spent.set(permit.owner, [...(chain.spent.get(permit.owner) ?? []), permit.nonce]);
        receipts.set(sent.hash, { status: logs === undefined ? 0 : 1, logs: logs ?? [], sent, block: head() });
        return sent.hash;
      }
      case "eth_getTransactionReceipt": {
        const r = receipts.get(String(params[0]).toLowerCase());
        if (r === undefined || chain.withhold) return null;
        return {
          transactionHash: r.sent.hash,
          transactionIndex: "0x0",
          blockHash: keccak256(word(hex(r.block))),
          blockNumber: hex(r.block),
          from: r.sent.from,
          to: r.sent.to,
          cumulativeGasUsed: hex(GAS_USED),
          gasUsed: hex(GAS_USED),
          effectiveGasPrice: hex(EFFECTIVE_GAS_PRICE),
          contractAddress: null,
          logs: r.logs.map((l, i) => logFields(l, i, r.sent.hash, r.block)),
          logsBloom: `0x${"00".repeat(256)}`,
          status: hex(r.status),
          type: "0x2",
          ...chain.receiptMore,
        };
      }
      case "eth_getTransactionByHash": {
        const r = receipts.get(String(params[0]).toLowerCase());
        if (r === undefined) return null;
        return {
          hash: r.sent.hash,
          from: r.sent.from,
          to: r.sent.to,
          input: r.sent.input,
          gas: hex(r.sent.gas),
          maxFeePerGas: hex(r.sent.maxFeePerGas),
          maxPriorityFeePerGas: hex(500_000_000n),
          nonce: "0x0",
          value: "0x0",
          type: "0x2",
          chainId: hex(chain.chainId),
          blockNumber: chain.withhold ? null : hex(r.block),
          blockHash: null,
          transactionIndex: null,
          v: "0x0",
          r: `0x${"00".repeat(32)}`,
          s: `0x${"00".repeat(32)}`,
          yParity: "0x0",
          accessList: [],
        };
      }
      case "eth_getLogs": {
        const f = params[0] as { address?: string; topics: (string | null)[] };
        const out: unknown[] = [];
        if (chain.withhold) return out;
        for (const r of receipts.values()) {
          r.logs.forEach((l, i) => {
            if (r.status !== 1) return;
            if (f.address !== undefined && f.address.toLowerCase() !== l.address) return;
            if (f.topics.some((t, k) => t !== null && t.toLowerCase() !== l.topics[k]?.toLowerCase())) return;
            out.push(logFields(l, i, r.sent.hash, r.block));
          });
        }
        return out;
      }
      default:
        throw new Error(`the stub answers no ${method}`);
    }
  };
  return stub(async (_path, body) => {
    const b = body as { id: number; method: string; params?: unknown[] };
    try {
      return { jsonrpc: "2.0", id: b.id, result: await answer(b.method, b.params ?? []) };
    } catch (e) {
      return { jsonrpc: "2.0", id: b.id, error: { code: -32601, message: e instanceof Error ? e.message : String(e) } };
    }
  });
}

/** A chain on Base Sepolia's id, at `now`, whose code is `contracts`, every call answered by the profiles' logs. */
export function chainOf(now: number, contracts: readonly string[]): EvmChain {
  return {
    chainId: 84532,
    now,
    code: new Set(contracts.map((c) => c.toLowerCase())),
    sent: [],
    methods: [],
    spent: new Map(),
    withhold: false,
    logsOf: profileLogs,
  };
}
