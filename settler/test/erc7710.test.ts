// The `erc7710` module, the settler's own, through the settler's /verify and /settle over HTTP, offered to the `exact`
// registration the `evm` module makes on the network: lcp's vectors for x402/exact/eip155/erc7710-salt (the reference
// DelegationManager, leaf salt H) and x402/exact/eip155/erc7710 (another manager, which signs no H) against the node
// stub. The stub executes a redemption as ERC-7710 and ERC-7579 define it: the manager runs the single-call execution
// the redeemer gives as the root delegator, so the token's `Transfer` is from that delegator. Each vector's leaf
// delegate is Anvil's published development account 2, which alone may redeem it, so the module is given that
// account's published key; it signs only for the stub.
import { digestJson } from "@integraledger/lcp";
import { decodePermissionContext } from "@integraledger/lcp/evm";
import { exactErc7710, exactErc7710Salt } from "@integraledger/lcp/x402";
import type { PaymentPayload } from "@x402/core/types";
import { decodeFunctionData, getAddress, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainOf, evmNode, transferLog, type EvmChain, type EvmLog } from "./evm-node.js";
import { gasKey, lcpVector, pointer, settlerOf, type Settler } from "./evm-support.js";
import type { Stub } from "./support.js";

const ANVIL_2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const NOW = 1790000000;
const NETWORK = "eip155:84532";
const SALT = lcpVector("x402-exact-eip155-erc7710-salt");
const UNSALTED = lcpVector("x402-exact-eip155-erc7710");
const REFUSED = ["invalid_payment_requirements", "invalid_payload", "invalid_network", "unsupported_scheme"];

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
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** What a manager's `redeemDelegations` emits: each execution's token `Transfer`, from the context's root delegator. */
function redemptionLogs(_to: Hex, input: Hex): EvmLog[] | undefined {
  try {
    const d = decodeFunctionData({ abi: REDEEM_ABI, data: input });
    const [contexts, , executions] = d.args;
    return executions.map((e, i) => {
      const target = `0x${e.slice(2, 42)}` as Hex;
      const call = decodeFunctionData({ abi: TRANSFER_ABI, data: `0x${e.slice(106)}` as Hex });
      const chainOfDelegations = decodePermissionContext(contexts[i]!);
      if (!Array.isArray(chainOfDelegations)) throw new Error("context");
      const root = chainOfDelegations.at(-1)!.delegator;
      return transferLog(target, root, call.args[0], call.args[1]);
    });
  } catch {
    return undefined;
  }
}

/**
 * The digest the record keys a redemption by: its manager and delegator in lowercase, and the leaf delegation's EIP-712
 * hash as lcp's reference gives it.
 */
async function leafKey(level: string, payment: PaymentPayload): Promise<string> {
  const binding = level === exactErc7710Salt.id ? exactErc7710Salt : exactErc7710;
  const ref = (await binding.reference(payment as never, payment.accepted as never)) as unknown as { presented: { delegation: string } };
  const p = payment.payload as { delegationManager: string; delegator: string };
  return (await digestJson({
    delegationManager: p.delegationManager.toLowerCase(),
    delegator: p.delegator.toLowerCase(),
    delegation: ref.presented.delegation.toLowerCase(),
  })) as string;
}

let node: Stub | undefined;
let settler: Settler | undefined;
let chain: EvmChain;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW * 1000 });
});
afterEach(async () => {
  vi.useRealTimers();
  await settler?.close();
  await node?.close();
  settler = node = undefined;
}, 60_000);

/** The settler with the evm module's `exact` and the erc7710 module on the network, both with the gas key `key`. */
async function erc7710On(payment: PaymentPayload, key: Hex = ANVIL_2): Promise<{ settler: Settler; signer: { address: Hex } }> {
  const manager = (payment.payload as { delegationManager: string }).delegationManager;
  chain = chainOf(NOW, [payment.accepted.asset, manager]);
  chain.logsOf = redemptionLogs;
  node = await evmNode(chain);
  const signer = gasKey(node.url, key);
  settler = await settlerOf({
    evm: [{ network: NETWORK, rpc: node.url, signer, schemes: ["exact"] }],
    erc7710: [{ network: NETWORK, rpc: node.url, signer }],
  });
  return { settler, signer };
}

for (const [level, V] of [
  ["x402/exact/eip155/erc7710-salt", SALT],
  ["x402/exact/eip155/erc7710", UNSALTED],
] as const) {
  describe(`${level} through the erc7710 module`, () => {
    const payment = pointer<PaymentPayload>(V, "/buyer/rows/1/input/presented");
    const delegator = (payment.payload as { delegator: Hex }).delegator;
    const manager = (payment.payload as { delegationManager: Hex }).delegationManager;

    it("verifies the vector's delegation as its delegator's, simulating the redemption, settles it by calling redeemDelegations on its manager, and records it by the digest of the delegation it redeems (lcp's leaf hash) for the settler's life", async () => {
      const { settler, signer } = await erc7710On(payment);
      expect(await settler.verify(payment)).toEqual({ isValid: true, payer: getAddress(delegator) });
      expect(chain.methods).toContain("eth_simulateV1");
      expect(chain.sent).toHaveLength(0);

      const settled = await settler.settle(payment);
      const tx = chain.sent.at(-1)!;
      expect(settled).toEqual({ success: true, transaction: tx.hash, network: NETWORK, payer: getAddress(delegator) });
      expect(tx.from).toBe(signer.address.toLowerCase());
      expect(tx.to).toBe(manager.toLowerCase());
      const call = decodeFunctionData({ abi: REDEEM_ABI, data: tx.input });
      // The vector's permission context, unchanged, with one single-call execution of the option's transfer.
      expect(call.args[0]).toEqual([(payment.payload as { permissionContext: Hex }).permissionContext]);
      expect(call.args[1]).toEqual([`0x${"00".repeat(32)}`]);
      expect(call.args[2][0]!.slice(0, 42).toLowerCase()).toBe(payment.accepted.asset.toLowerCase());
      expect(await settler.rows()).toEqual([
        {
          network: NETWORK,
          key: JSON.stringify(["digest", await leafKey(level, payment)]),
          pairing: level,
          final: true,
          transaction: tx.hash,
          keep_until: null,
        },
      ]);
    });

    it("refuses a delegation whose leaf names another delegate, one whose simulation shows no transfer to payTo, and the vector's refused options, sending nothing", async () => {
      const other = await erc7710On(payment, generatePrivateKey());
      expect(await other.settler.verify(payment)).toMatchObject({ isValid: false, invalidReason: "invalid_payload" });
      await other.settler.close();
      await node?.close();
      const { settler } = await erc7710On(payment);
      chain.simulate = () => ({ ok: true, logs: [] });
      expect(await settler.verify(payment)).toMatchObject({ isValid: false, invalidReason: "invalid_transaction" });
      expect(await settler.settle(payment)).toMatchObject({ success: false, errorReason: "invalid_transaction", transaction: "" });
      chain.simulate = undefined;
      for (const r of pointer<{ case: string; accepted: PaymentPayload["accepted"]; payment: string }[]>(V, "/boundAccepted/rows")) {
        const v = await settler.verify({ ...pointer<PaymentPayload>(V, r.payment), accepted: r.accepted });
        expect(v.isValid, r.case).toBe(false);
        expect(REFUSED, r.case).toContain(v.invalidReason);
      }
      expect(await settler.rows()).toEqual([]);
      expect(chain.sent).toHaveLength(0);
    });
  });
}

describe("x402/exact/eip155/erc7710-salt presented again in another spelling", () => {
  it("keys a redemption by the delegation it redeems, so the vector's delegation spelt in lowercase addresses and an uppercase context is the first row's repeat and is not redeemed again", async () => {
    const payment = pointer<PaymentPayload>(SALT, "/buyer/rows/1/input/presented");
    const p = payment.payload as { delegationManager: string; delegator: string; permissionContext: string };
    const respelt: PaymentPayload = {
      ...payment,
      payload: {
        delegationManager: p.delegationManager.toLowerCase(),
        delegator: p.delegator.toLowerCase(),
        permissionContext: `0x${p.permissionContext.slice(2).toUpperCase()}`,
      },
    };
    const { settler } = await erc7710On(payment);
    const first = await settler.settle(payment);
    expect(first).toMatchObject({ success: true });
    expect(await settler.settle(respelt)).toEqual({ success: false, errorReason: "invalid_transaction_state", transaction: first.transaction, network: NETWORK });
    expect(chain.sent).toHaveLength(1);
    expect(await settler.rows()).toHaveLength(1);
  });
});

describe("x402/exact/eip155/erc7710 read by the transaction the record holds", () => {
  it("answers a redemption whose receipt the node withholds pending, and a repeat once the node shows it success, by lcp's lookup of that transaction, sending nothing again", async () => {
    const payment = pointer<PaymentPayload>(UNSALTED, "/buyer/rows/1/input/presented");
    const delegator = getAddress((payment.payload as { delegator: Hex }).delegator);
    const { settler } = await erc7710On(payment);
    chain.withhold = true;
    const pending = await settler.settle(payment);
    const tx = chain.sent[0]!;
    expect(pending).toEqual({ success: false, errorReason: "settlement_pending", transaction: tx.hash, network: NETWORK });
    // The level signs no H: nothing but the transaction the record holds finds the payment (its profile, rule 6).
    chain.withhold = false;
    expect(await settler.settle(payment)).toEqual({ success: true, transaction: tx.hash, network: NETWORK, payer: delegator });
    expect(chain.sent).toHaveLength(1);
    expect((await settler.rows()).map((r) => [r.final, r.transaction])).toEqual([[true, tx.hash]]);
  });
});
