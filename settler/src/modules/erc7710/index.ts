/**
 * The `erc7710` module: x402's `exact` scheme with the `erc7710` asset transfer method, at both of lcp's levels (the
 * leaf delegation's salt H, through the reference DelegationManager; and every other delegation, which signs no H).
 * x402 specifies the method and leaves the `permissionContext` opaque, and no published facilitator class settles it,
 * so the module is the settler's own: it simulates the redemption the payment names, and then sends it, calling
 * `redeemDelegations` on the delegation manager the payload names with one single-call execution that transfers the
 * option's amount of its asset to `payTo`. Its key is the seller's gas key, which must be the delegate the leaf
 * delegation names (or the reference implementation's wildcard delegate); it sends the transaction and pays its gas.
 * It registers nothing of its own: it is offered to the `exact` registration the `evm` module makes on each of its
 * networks, which hands it every payment whose option names `erc7710`, and the settler does not start where the `evm`
 * module does not register `exact` on such a network.
 */
import { decodePermissionContext, type Eip155, type Hex } from "@integraledger/lcp/evm";
import { isRefusal } from "@integraledger/lcp";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator, SettleResponse, VerifyResponse } from "@x402/core/types";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { encodeFunctionData, encodePacked, getAddress, isAddress, isHex, type Log } from "viem";
import type { Handoff, ModuleStarter, RecordNeeds } from "../../module.js";
import { admit, ERC7710_PAIRINGS, instrumentOf, readOf } from "../evm/forms.js";
import { chargedFrom, evmReader } from "../evm/node.js";
import type { EvmModule } from "../evm/index.js";

/** One `eip155` network the `erc7710` module serves. */
export interface Erc7710Config {
  readonly network: `eip155:${number}`;
  /** The seller's node, an EVM JSON-RPC endpoint, which lcp's reads and the fee's read go through. */
  readonly rpc: string;
  /**
   * The seller's gas key, the delegate the leaf delegations it redeems name, as x402's EVM classes take a signer; it must
   * simulate calls (`eth_simulateV1`), since the simulation's logs show the transfer the redemption would make.
   */
  readonly signer: FacilitatorEvmSigner;
}

/** The reference implementation's wildcard delegate, which any redeemer may redeem as. */
const ANY_DELEGATE = "0x0000000000000000000000000000000000000a11";
/** keccak256("Transfer(address,address,uint256)"). */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** ERC-7579's mode for one call that reverts on failure: call type single (0x00), exec type default (0x00). */
const SINGLE_DEFAULT_MODE = `0x${"00".repeat(32)}` as Hex;

const REDEEM_ABI = [
  {
    type: "function",
    name: "redeemDelegations",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_permissionContexts", type: "bytes[]" },
      { name: "_modes", type: "bytes32[]" },
      { name: "_executionCallDatas", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;

const TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

/** The members of x402's ERC-7710 payload, once lcp's checks have admitted it. */
interface Redemption {
  readonly manager: Hex;
  readonly context: Hex;
  readonly delegator: Hex;
  readonly token: Hex;
  readonly payTo: Hex;
  readonly amount: bigint;
}

function redemptionOf(payload: PaymentPayload, requirements: PaymentRequirements): Redemption | undefined {
  const p = payload.payload as Record<string, unknown>;
  const manager = p["delegationManager"];
  const context = p["permissionContext"];
  const delegator = p["delegator"];
  if (typeof manager !== "string" || !isAddress(manager) || typeof delegator !== "string" || !isAddress(delegator)) return undefined;
  if (typeof context !== "string" || !isHex(context) || !isAddress(requirements.asset) || !isAddress(requirements.payTo)) return undefined;
  return {
    manager: getAddress(manager) as Hex,
    context: context as Hex,
    delegator: getAddress(delegator) as Hex,
    token: getAddress(requirements.asset) as Hex,
    payTo: getAddress(requirements.payTo) as Hex,
    amount: BigInt(requirements.amount),
  };
}

/** The `redeemDelegations` call the redemption is: one context, one single-call execution of the token's `transfer`. */
function redeemCall(r: Redemption): readonly [readonly Hex[], readonly Hex[], readonly Hex[]] {
  const transfer = encodeFunctionData({ abi: TRANSFER_ABI, functionName: "transfer", args: [r.payTo, r.amount] });
  const execution = encodePacked(["address", "uint256", "bytes"], [r.token, 0n, transfer]);
  return [[r.context], [SINGLE_DEFAULT_MODE], [execution]];
}

function same(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/** Whether `logs` hold the token's `Transfer` of exactly the option's amount from the delegator to `payTo`. */
function transfers(logs: readonly Pick<Log, "address" | "topics" | "data">[] | undefined, r: Redemption): boolean {
  const word = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
  return (logs ?? []).some(
    (l) =>
      same(l.address, r.token) &&
      l.topics.length === 3 &&
      same(l.topics[0], TRANSFER_TOPIC) &&
      same(l.topics[1], word(r.delegator)) &&
      same(l.topics[2], word(r.payTo)) &&
      isHex(l.data) &&
      l.data.length === 66 &&
      BigInt(l.data) === r.amount,
  );
}

/** The module's own facilitator for x402's `erc7710` method. */
function facilitatorOf(c: Erc7710Config): SchemeNetworkFacilitator {
  const signer = c.signer;

  /** lcp's checks, the leaf's delegate, the manager's code and the simulation, in that order; nothing is sent. */
  async function check(payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ redemption: Redemption; from: Hex } | VerifyResponse> {
    const a = await admit("erc7710", { payload, requirements }, ERC7710_PAIRINGS);
    if ("refused" in a) return { isValid: false, invalidReason: a.refused };
    const r = redemptionOf(payload, requirements);
    if (r === undefined) return { isValid: false, invalidReason: "invalid_payload" };
    const payer = r.delegator;
    // A context the reference manager's encoding reads names its leaf's delegate, which alone may redeem it; another
    // manager's context is opaque, and its simulation shows whether the module's key may redeem it. The key sends from
    // its first address, `writeContract` taking no account, so that is the delegate the leaf must name, and the account
    // the simulation runs from.
    const delegations = decodePermissionContext(r.context);
    const from = signer.getAddresses()[0];
    if (from === undefined) return { isValid: false, invalidReason: "invalid_payload", payer };
    if (!isRefusal(delegations) && delegations.length > 0) {
      const delegate = delegations[0]!.delegate.toLowerCase();
      if (delegate !== ANY_DELEGATE && delegate !== from.toLowerCase()) return { isValid: false, invalidReason: "invalid_payload", payer };
    }
    const code = await signer.getCode({ address: r.manager });
    if (code === undefined || code === "0x") return { isValid: false, invalidReason: "invalid_transaction", payer };
    if (signer.simulateCalls === undefined) return { isValid: false, invalidReason: "invalid_transaction", payer };
    const [contexts, modes, executions] = redeemCall(r);
    const data = encodeFunctionData({ abi: REDEEM_ABI, functionName: "redeemDelegations", args: [contexts, modes, executions] });
    const simulated = await signer.simulateCalls({ account: from, calls: [{ to: r.manager, data }] });
    const result = simulated.results[0];
    if (result === undefined || result.status !== "success" || !transfers(result.logs, r)) {
      return { isValid: false, invalidReason: "invalid_transaction", payer };
    }
    return { redemption: r, from };
  }

  return {
    scheme: "exact",
    caipFamily: "eip155:*",
    getExtra: () => undefined,
    getSigners: () => [...signer.getAddresses()],
    async verify(payload, requirements): Promise<VerifyResponse> {
      const checked = await check(payload, requirements);
      return "redemption" in checked ? { isValid: true, payer: checked.redemption.delegator } : checked;
    },
    async settle(payload, requirements): Promise<SettleResponse> {
      const network = requirements.network;
      const checked = await check(payload, requirements);
      if (!("redemption" in checked)) {
        return { success: false, errorReason: checked.invalidReason ?? "invalid_payload", transaction: "", network, ...(checked.payer === undefined ? {} : { payer: checked.payer }) };
      }
      const r = checked.redemption;
      const payer = r.delegator;
      let transaction: Hex;
      try {
        transaction = (await signer.writeContract({
          address: r.manager,
          abi: REDEEM_ABI,
          functionName: "redeemDelegations",
          args: redeemCall(r),
        })) as Hex;
      } catch {
        return { success: false, errorReason: "invalid_transaction", transaction: "", network, payer };
      }
      let receipt: Awaited<ReturnType<FacilitatorEvmSigner["waitForTransactionReceipt"]>>;
      try {
        receipt = await signer.waitForTransactionReceipt({ hash: transaction });
      } catch {
        return { success: false, errorReason: "settlement_pending", transaction, network, payer };
      }
      if (receipt.status !== "success" || !transfers(receipt.logs, r)) {
        return { success: false, errorReason: "invalid_transaction", transaction, network, payer };
      }
      return { success: true, transaction, network, payer };
    },
  };
}

/**
 * The `erc7710` module on one network, as the hand-off the `exact` registration there takes: every payment whose option
 * names the `erc7710` method, by the option's own member, before x402's `exact` class sees it.
 */
export function erc7710Handoff(c: Erc7710Config): Handoff & { readonly module: EvmModule } {
  const network = c.network as Network;
  const record: RecordNeeds = {
    async instrument(p) {
      const a = await admit("erc7710", p, ERC7710_PAIRINGS);
      return "refused" in a ? a : instrumentOf(network, p, a);
    },
    // The level that signs no H is found only by the transaction the record holds, the one this module's settle named.
    async read(p, at) {
      const a = await admit("erc7710", p, ERC7710_PAIRINGS);
      if ("refused" in a) return { outcome: "live", answer: { state: "unreadable", reason: "unparseable", foreign: [] } };
      return readOf(evmReader(c.network as Eip155, c.rpc, at.deadline), a, at);
    },
  };
  const module: EvmModule = {
    descriptor: { name: "erc7710", key: "relayer", pairings: ERC7710_PAIRINGS, acceptsZero: [] },
    network,
    facilitator: facilitatorOf(c),
    record,
    fees: {
      paysFee: () => true,
      payerBroadcast: () => false,
      charged: chargedFrom(c.rpc),
    },
  };
  return {
    claim: {
      by: "option",
      claims: (requirements) => requirements.scheme === "exact" && requirements.extra?.["assetTransferMethod"] === "erc7710",
    },
    module,
  };
}

/**
 * How the core starts the module: the configuration's `erc7710` member lists the networks, one entry each, and on each
 * the module is offered to the `exact` registration there, behind which it takes every option naming `erc7710`.
 */
export const starter: ModuleStarter<readonly Erc7710Config[]> = {
  name: "erc7710",
  async start(networks) {
    return {
      registrations: [],
      handoffs: networks.map((c) => ({ scheme: "exact", network: c.network as Network, handoff: erc7710Handoff(c) })),
    };
  },
};
