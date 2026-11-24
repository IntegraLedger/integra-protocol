// The later messages of the EVM multi-step schemes, as x402's own resource-server code sends them, through the
// settler's /verify and /settle over HTTP: auth-capture's capture, void and refund (x402's lifecycle manager, and the
// hold's own payload the resource server stamps after its handler), and batch settlement's claim and settle (x402's
// channel manager). Every message is built and signed by the stock @x402/evm 2.31.0 client, server scheme and manager;
// the settler is the resource server's only facilitator. Beside each accepted message, its refused twin.
//
// Chain: the stub of evm-node.ts, which runs no EVM. The escrow's `paymentState` and the channel contract's `channels`
// and `receivers` are folded from the transactions the stub received, so the classes' reads of the state move as the
// contracts' would. No contract rule is checked here: the stub shows what the settler sent, not that it would execute.
import { x402ResourceServer } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  AUTH_CAPTURE_ESCROW_ADDRESS,
  BATCH_SETTLEMENT_ADDRESS,
  EIP3009_TOKEN_COLLECTOR_ADDRESS,
  ERC3009_DEPOSIT_COLLECTOR_ADDRESS,
  PERMIT2_TOKEN_COLLECTOR_ADDRESS,
} from "@x402/evm";
import { AuthCaptureEvmScheme as AuthCaptureClient } from "@x402/evm/auth-capture/client";
import { AuthCaptureEvmScheme as AuthCaptureServer } from "@x402/evm/auth-capture/server";
import { batchSettlementABI } from "@x402/evm/batch-settlement";
import { BatchSettlementEvmScheme as BatchClient, computeChannelId } from "@x402/evm/batch-settlement/client";
import { BatchSettlementEvmScheme as BatchServer } from "@x402/evm/batch-settlement/server";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, toFunctionSelector, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { AUTHORIZATION_USED_TOPIC, chainOf, evmNode, transferLog, type EvmChain, type EvmLog } from "./evm-node.js";
import { gasKey, lcpVector, pointer, settlerOf, type Settler } from "./evm-support.js";
import type { Stub } from "./support.js";

const NETWORK = "eip155:84532";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const key = (label: string): Hex => keccak256(toHex(`evm-later:${label}`));
const GAS_KEY = key("gas");
const payer = privateKeyToAccount(key("payer"));
const authorizer = privateKeyToAccount(key("receiver-authorizer"));
const payTo = privateKeyToAccount(key("pay-to")).address;
const feeRecipient = privateKeyToAccount(key("fee-recipient")).address;

let node: Stub | undefined;
let settler: Settler | undefined;
afterEach(async () => {
  await settler?.close();
  await node?.close();
  settler = node = undefined;
}, 60_000);

/** The settler as x402's resource server takes a facilitator, each /settle it is given kept as sent. */
function facilitatorOf(s: Settler, settled: { payload: PaymentPayload; requirements: PaymentRequirements }[], keep = false) {
  return {
    getSupported: () => s.supported(),
    verify: (p: PaymentPayload, q: PaymentRequirements) => s.verify(p, q),
    settle: (p: PaymentPayload, q: PaymentRequirements) => {
      settled.push({ payload: structuredClone(p), requirements: structuredClone(q) });
      // `keep`: the message is kept, not sent, and the caller told it failed.
      return keep ? Promise.resolve({ success: false, errorReason: "kept", transaction: "", network: q.network }) : s.settle(p, q);
    },
  };
}

/** A message with a member no class reads: the same signed message, spelt otherwise. */
const respelt = (p: PaymentPayload): PaymentPayload => ({ ...p, payload: { ...(p.payload as object), note: "respelt" } }) as PaymentPayload;

describe("x402/auth-capture/eip155: the escrow's capture, void and refund after the hold", () => {
  const INFO = "(address,address,address,address,uint120,uint48,uint48,uint48,uint16,uint16,address,uint256)";
  const CALL = {
    authorize: toFunctionSelector(`authorize(${INFO},uint256,address,bytes)`),
    capture: toFunctionSelector(`capture(${INFO},uint256,uint256,address)`),
    void: toFunctionSelector(`void(${INFO})`),
    refund: toFunctionSelector(`refund(${INFO},uint256,address,bytes)`),
  };
  const PAYMENT_STATE = toFunctionSelector("paymentState(bytes32)");
  const escrow = AUTH_CAPTURE_ESCROW_ADDRESS.toLowerCase();
  let chain: EvmChain;

  /** The escrow's calls the node received, by name. */
  const calls = () => chain.sent.filter((t) => t.to === escrow).map((t) => Object.entries(CALL).find(([, s]) => t.input.startsWith(s))?.[0]);

  /** A stub chain whose escrow's `paymentState` is folded from the calls it received (the amount is the 13th word). */
  async function escrowSettler(authCapture?: Record<string, unknown>): Promise<Settler> {
    chain = chainOf(Math.floor(Date.now() / 1000), [USDC, PERMIT2, AUTH_CAPTURE_ESCROW_ADDRESS, EIP3009_TOKEN_COLLECTOR_ADDRESS, PERMIT2_TOKEN_COLLECTOR_ADDRESS]);
    const base = chain.logsOf;
    chain.logsOf = (to, input) => (to === escrow ? [] : base(to, input));
    chain.answers = (_to, input) => {
      if (!input.startsWith(PAYMENT_STATE)) return undefined;
      let [collected, capturable, refundable] = [false, 0n, 0n];
      for (const t of chain.sent) {
        if (t.to !== escrow) continue;
        const amount = t.input.length >= 10 + 13 * 64 ? BigInt(`0x${t.input.slice(10 + 12 * 64, 10 + 13 * 64)}`) : 0n;
        if (t.input.startsWith(CALL.authorize)) [collected, capturable] = [true, amount];
        else if (t.input.startsWith(CALL.capture)) [capturable, refundable] = [capturable - amount, refundable + amount];
        else if (t.input.startsWith(CALL.void)) capturable = 0n;
        else if (t.input.startsWith(CALL.refund)) refundable -= amount;
      }
      return encodeAbiParameters([{ type: "bool" }, { type: "uint120" }, { type: "uint120" }], [collected, capturable, refundable]);
    };
    node = await evmNode(chain);
    settler = await settlerOf({
      evm: [{ network: NETWORK, rpc: node.url, signer: gasKey(node.url, GAS_KEY), schemes: ["auth-capture"], ...(authCapture ? { authCapture } : {}) }],
    });
    return settler;
  }

  /** x402's auth-capture resource server on the settler, and the payer's signed hold of 1,000,000. */
  async function route(s: Settler, extra: Record<string, unknown>, settled: { payload: PaymentPayload; requirements: PaymentRequirements }[]) {
    const scheme = new AuthCaptureServer({ receiverAuthorizerSigner: authorizer } as never);
    const server = new x402ResourceServer(facilitatorOf(s, settled) as never).register(NETWORK, scheme as never);
    await server.initialize();
    const [requirements] = await server.buildPaymentRequirements({
      scheme: "auth-capture",
      payTo,
      price: { amount: "1000000", asset: USDC, extra: { name: "USDC", version: "2" } },
      network: NETWORK,
      maxTimeoutSeconds: 600,
      extra: { captureDeadlineSeconds: 3600, refundDeadlineSeconds: 7200, feeRecipient, minFeeBps: 0, maxFeeBps: 100, ...extra },
    } as never);
    const signed = await new AuthCaptureClient(payer as never).createPaymentPayload(2, requirements as never);
    const payment = { x402Version: 2, accepted: requirements!, payload: signed.payload } as PaymentPayload;
    const settle = (phase: "before-handler" | "after-handler") =>
      server.settlePayment(payment, requirements!, undefined, undefined, undefined, phase as never) as Promise<{ success: boolean }>;
    return { scheme, server, requirements: requirements!, payment, settle };
  }

  it("settles the lifecycle manager's capture, void and refund after the hold, each once, and sends nothing for a repeat or a capture its authorizer did not sign", async () => {
    const s = await escrowSettler({ refundFunding: true });
    const settled: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
    const r = await route(s, { captureMode: "deferred" }, settled);
    expect(await r.settle("before-handler")).toMatchObject({ success: true });
    const [stored] = await r.scheme.getStorage().list();
    const manager = r.scheme.createLifecycleManager(facilitatorOf(s, settled) as never);

    const captured = await manager.capture(stored!.paymentInfoHash, { amount: "400000" });
    expect(captured).toMatchObject({ success: true, transaction: chain.sent.at(-1)!.hash });
    expect(calls()).toEqual(["authorize", "capture"]);
    const capture = settled.at(-1)!;
    expect((capture.payload.payload as { type: string }).type).toBe("capture");

    // The same capture again is answered from its row, and nothing is sent.
    expect(await s.settle(capture.payload, capture.requirements)).toMatchObject({ success: false, errorReason: "invalid_transaction_state" });
    // A capture for more than its receiver authorizer signed: the class refuses it, and nothing is sent.
    const more = { ...capture.payload, payload: { ...(capture.payload.payload as object), amount: "500000" } } as PaymentPayload;
    const refused = await s.settle(more, capture.requirements);
    expect(refused).toMatchObject({ success: false, transaction: "" });
    expect(refused.errorReason).not.toMatch(/^invalid_(payload|payment_requirements|transaction_state)$/);
    expect(calls()).toEqual(["authorize", "capture"]);

    expect(await manager.voidPayment(stored!.paymentInfoHash)).toMatchObject({ success: true });
    expect(await manager.refund(stored!.paymentInfoHash, { amount: "100000" })).toMatchObject({ success: true });
    expect(calls()).toEqual(["authorize", "capture", "void", "refund"]);
    // The hold by its payer's ERC-3009 nonce; each later message by the digest of what it carries.
    const rows = await s.rows();
    expect(rows.map((x) => [JSON.parse(x.key)[0], x.final])).toEqual([
      ["single-use", true],
      ["digest", true],
      ["digest", true],
      ["digest", true],
    ]);
  });

  for (const step of ["capture", "refund"] as const) {
    it(`sends one ${step} where the same signed ${step} arrives at once spelt three ways`, async () => {
      const s = await escrowSettler({ refundFunding: true });
      const settled: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
      const r = await route(s, { captureMode: "deferred" }, settled);
      expect(await r.settle("before-handler")).toMatchObject({ success: true });
      const [stored] = await r.scheme.getStorage().list();
      if (step === "refund") {
        expect(await r.scheme.createLifecycleManager(facilitatorOf(s, settled) as never).capture(stored!.paymentInfoHash, { amount: "400000" })).toMatchObject({ success: true });
      }
      const kept = r.scheme.createLifecycleManager(facilitatorOf(s, settled, true) as never);
      await (step === "capture" ? kept.capture(stored!.paymentInfoHash, { amount: "400000" }) : kept.refund(stored!.paymentInfoHash, { amount: "100000" })).catch(() => undefined);
      const m = settled.at(-1)!;
      expect((m.payload.payload as { type: string }).type).toBe(step);
      // Spelt otherwise at its top level, and inside its `paymentInfo`, whose members the escrow's hash fixes.
      const body = m.payload.payload as { paymentInfo: Record<string, unknown> };
      const inside = { ...m.payload, payload: { ...body, paymentInfo: { ...body.paymentInfo, note: "inside" } } } as PaymentPayload;
      const answers = await Promise.all([s.settle(m.payload, m.requirements), s.settle(respelt(m.payload), m.requirements), s.settle(inside, m.requirements)]);
      expect(answers.filter((a) => a.success)).toHaveLength(1);
      expect(calls()).toEqual(step === "capture" ? ["authorize", "capture"] : ["authorize", "capture", "refund"]);
    });
  }

  it("refuses the refund the settler's own key would fund where the operator gave its class no refund funding", async () => {
    const s = await escrowSettler();
    const settled: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
    const r = await route(s, { captureMode: "deferred" }, settled);
    expect(await r.settle("before-handler")).toMatchObject({ success: true });
    const [stored] = await r.scheme.getStorage().list();
    const manager = r.scheme.createLifecycleManager(facilitatorOf(s, settled) as never);
    expect(await manager.capture(stored!.paymentInfoHash, { amount: "400000" })).toMatchObject({ success: true });
    await manager.refund(stored!.paymentInfoHash, { amount: "100000" }).catch(() => undefined);
    const refund = settled.at(-1)!;
    expect((refund.payload.payload as { type: string }).type).toBe("refund");
    expect(await s.settle(refund.payload, refund.requirements)).toMatchObject({ success: false, errorReason: "invalid_auth_capture_evm_refund_funding_unavailable" });
    expect(calls()).toEqual(["authorize", "capture"]);
  });

  it("settles the capture the resource server sends after its handler on the default route, the hold's payload stamped `capture`, as its own row", async () => {
    const s = await escrowSettler();
    const settled: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
    const r = await route(s, {}, settled);
    expect(await r.settle("before-handler")).toMatchObject({ success: true });
    expect(await r.settle("after-handler")).toMatchObject({ success: true });
    expect(calls()).toEqual(["authorize", "capture"]);
    const stamped = settled.at(-1)!.payload.payload as Record<string, unknown>;
    expect(stamped["type"]).toBe("capture");
    expect(stamped["authorization"]).toBeDefined();
    expect((await s.rows()).map((x) => [JSON.parse(x.key)[0], x.final])).toEqual([
      ["single-use", true],
      ["digest", true],
    ]);
  });

  it("still refuses the hold presented again without a type: its row, by the payer's nonce, is final", async () => {
    const s = await escrowSettler();
    const r = await route(s, {}, []);
    expect(await r.settle("before-handler")).toMatchObject({ success: true });
    expect(await s.settle(r.payment, r.requirements)).toMatchObject({ success: false, errorReason: "invalid_transaction_state" });
    expect(calls()).toEqual(["authorize"]);
  });
});

describe("x402/batch-settlement/eip155: the channel manager's claim and settle", () => {
  const BATCH = BATCH_SETTLEMENT_ADDRESS.toLowerCase() as Hex;
  const VLOGS = pointer<EvmLog[]>(lcpVector("x402-batch-settlement"), "/EB7/fullCall/receipt/logs");
  const CHANNEL_CREATED = VLOGS[3]!.topics[0]!.toLowerCase() as Hex;
  const DEPOSITED = VLOGS[4]!.topics[0]!.toLowerCase() as Hex;
  type Config = { payer: Hex; payerAuthorizer: Hex; receiver: Hex; receiverAuthorizer: Hex; token: Hex; withdrawDelay: number; salt: Hex };
  const word = (a: string): Hex => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
  const call = (input: Hex) => {
    try {
      return decodeFunctionData({ abi: batchSettlementABI, data: input });
    } catch {
      return undefined;
    }
  };
  let chain: EvmChain;
  const calls = () => chain.sent.filter((t) => t.to === BATCH).map((t) => call(t.input)?.functionName);

  /** The channel contract's state as the transactions the stub received leave it. */
  function fold() {
    const channels = new Map<string, { balance: bigint; claimed: bigint }>();
    const receivers = new Map<string, { claimed: bigint; settled: bigint }>();
    const rk = (r: string, t: string) => `${r.toLowerCase()}|${t.toLowerCase()}`;
    for (const t of chain.sent) {
      const d = t.to === BATCH ? call(t.input) : undefined;
      if (d?.functionName === "deposit") {
        const [config, amount] = d.args as unknown as [Config, bigint];
        const id = computeChannelId(config as never, NETWORK).toLowerCase();
        const c = channels.get(id) ?? { balance: 0n, claimed: 0n };
        channels.set(id, { ...c, balance: c.balance + amount });
      } else if (d?.functionName === "claimWithSignature") {
        for (const k of (d.args as unknown as [{ voucher: { channel: Config }; totalClaimed: bigint }[]])[0]) {
          const id = computeChannelId(k.voucher.channel as never, NETWORK).toLowerCase();
          const c = channels.get(id) ?? { balance: 0n, claimed: 0n };
          if (k.totalClaimed <= c.claimed) continue;
          const r = receivers.get(rk(k.voucher.channel.receiver, k.voucher.channel.token)) ?? { claimed: 0n, settled: 0n };
          receivers.set(rk(k.voucher.channel.receiver, k.voucher.channel.token), { ...r, claimed: r.claimed + (k.totalClaimed - c.claimed) });
          channels.set(id, { ...c, claimed: k.totalClaimed });
        }
      } else if (d?.functionName === "settle") {
        const [receiver, token] = d.args as unknown as [Hex, Hex];
        const r = receivers.get(rk(receiver, token));
        if (r !== undefined) receivers.set(rk(receiver, token), { ...r, settled: r.claimed });
      }
    }
    return { channels, receivers, rk };
  }

  async function channelSettler(): Promise<Settler> {
    chain = chainOf(Math.floor(Date.now() / 1000), [USDC, PERMIT2, BATCH_SETTLEMENT_ADDRESS, ERC3009_DEPOSIT_COLLECTOR_ADDRESS]);
    const base = chain.logsOf;
    chain.logsOf = (to, input) => {
      if (to.toLowerCase() !== BATCH) return base(to, input);
      const d = call(input);
      if (d?.functionName !== "deposit") return d === undefined ? undefined : [];
      const [config, amount, collector, collectorData] = d.args as unknown as [Config, bigint, Hex, Hex];
      const id = computeChannelId(config as never, NETWORK).toLowerCase() as Hex;
      const [, , salt] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes" }], collectorData);
      const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [id, salt]));
      const balance = fold().channels.get(id)?.balance ?? amount;
      const created: EvmLog[] =
        balance === amount
          ? [
              {
                address: BATCH,
                topics: [CHANNEL_CREATED, id],
                data: encodeAbiParameters(
                  [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
                  [config.payer, config.payerAuthorizer, config.receiver, config.receiverAuthorizer, config.token, BigInt(config.withdrawDelay), config.salt],
                ),
              },
            ]
          : [];
      return [
        { address: config.token.toLowerCase() as Hex, topics: [AUTHORIZATION_USED_TOPIC, word(config.payer), nonce], data: "0x" },
        transferLog(config.token, config.payer, collector, amount),
        transferLog(config.token, collector, BATCH, amount),
        ...created,
        { address: BATCH, topics: [DEPOSITED, id, word(config.payer)], data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, balance]) },
      ];
    };
    chain.answers = (to, input) => {
      const d = to.toLowerCase() === BATCH ? call(input) : undefined;
      if (d === undefined) return undefined;
      const s = fold();
      if (d.functionName === "channels") {
        const c = s.channels.get(String((d.args as readonly unknown[])[0]).toLowerCase());
        return encodeFunctionResult({ abi: batchSettlementABI, functionName: "channels", result: [c?.balance ?? 0n, c?.claimed ?? 0n] as never });
      }
      if (d.functionName === "receivers") {
        const [r, t] = d.args as unknown as [Hex, Hex];
        const v = s.receivers.get(s.rk(r, t));
        return encodeFunctionResult({ abi: batchSettlementABI, functionName: "receivers", result: [v?.claimed ?? 0n, v?.settled ?? 0n] as never });
      }
      return undefined;
    };
    node = await evmNode(chain);
    settler = await settlerOf({ evm: [{ network: NETWORK, rpc: node.url, signer: gasKey(node.url, GAS_KEY), schemes: ["batch-settlement"] }] });
    return settler;
  }

  it("settles the manager's claim of the payer's latest voucher and its settle in each round on one channel, and sends nothing for a claim no receiver authorizer signed", async () => {
    const s = await channelSettler();
    const settled: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
    const scheme = new BatchServer(payTo, { receiverAuthorizerSigner: authorizer as never });
    const server = new x402ResourceServer(facilitatorOf(s, settled) as never).register(NETWORK, scheme as never);
    await server.initialize();
    const [option] = await server.buildPaymentRequirements({
      scheme: "batch-settlement",
      payTo,
      price: { amount: "1000", asset: USDC, extra: { name: "USDC", version: "2" } },
      network: NETWORK,
      maxTimeoutSeconds: 3600,
    } as never);
    // The payer opens the channel and signs vouchers of 1000, 2000 and 3000.
    const client = new BatchClient(payer as never);
    for (let n = 0; n < 3; n++) {
      const signed = await client.createPaymentPayload(2, option as never);
      const payment = { x402Version: 2, accepted: option!, payload: signed.payload } as PaymentPayload;
      expect(await server.verifyPayment(payment, option!)).toMatchObject({ isValid: true });
      const answer = await server.settlePayment(payment, option!);
      expect(answer).toMatchObject({ success: true });
      await (client as unknown as { schemeHooks: { onPaymentResponse(c: unknown): Promise<unknown> } }).schemeHooks.onPaymentResponse({
        settleResponse: answer,
        paymentPayload: payment,
        requirements: option,
      });
    }
    expect(calls()).toEqual(["deposit"]);

    const manager = scheme.createChannelManager(facilitatorOf(s, settled) as never, NETWORK, USDC as Hex);
    await manager.claim();
    const claim = settled.at(-1)!;
    expect(claim.requirements.amount).toBe("0");
    expect((claim.payload.payload as { type: string; claims: { totalClaimed: string }[] }).claims.map((c) => c.totalClaimed)).toEqual(["3000"]);
    expect(calls()).toEqual(["deposit", "claimWithSignature"]);
    await manager.settle();
    expect(calls()).toEqual(["deposit", "claimWithSignature", "settle"]);
    expect(fold().receivers.get(`${payTo.toLowerCase()}|${USDC.toLowerCase()}`)).toEqual({ claimed: 3000n, settled: 3000n });

    // A second round on the same channel: a voucher, then the manager's claim and settle again, whose settle is the
    // same message as the first round's.
    const signed = await client.createPaymentPayload(2, option as never);
    const fourth = { x402Version: 2, accepted: option!, payload: signed.payload } as PaymentPayload;
    expect(await server.settlePayment(fourth, option!)).toMatchObject({ success: true });
    await manager.claim();
    await manager.settle();
    expect(calls()).toEqual(["deposit", "claimWithSignature", "settle", "claimWithSignature", "settle"]);
    expect(fold().receivers.get(`${payTo.toLowerCase()}|${USDC.toLowerCase()}`)).toEqual({ claimed: 4000n, settled: 4000n });
    // With nothing claimed and unsettled, the class sends nothing for a settle.
    expect(await s.settle(settled.at(-1)!.payload, settled.at(-1)!.requirements)).toMatchObject({ success: false, transaction: "" });
    // A claim with no receiver authorizer's signature: the settler holds no authorizer key, and its class refuses it.
    const { claimAuthorizerSignature: _signed, ...unsigned } = claim.payload.payload as Record<string, unknown>;
    const refused = await s.settle({ ...claim.payload, payload: unsigned }, claim.requirements);
    expect(refused).toMatchObject({ success: false, transaction: "" });
    expect(refused.errorReason).not.toMatch(/^invalid_(payload|payment_requirements|transaction_state)$/);
    // At /verify the class's own `verify` answers a claim, as it does without the settler.
    const other = { ...(claim.payload.payload as Record<string, unknown>), claimAuthorizerSignature: `0x${"11".repeat(65)}` };
    expect(await s.verify({ ...claim.payload, payload: other }, claim.requirements)).toMatchObject({ isValid: false, invalidReason: "invalid_batch_settlement_evm_payload_type" });
    expect(await s.verify(claim.payload, claim.requirements)).toMatchObject({ isValid: false, invalidReason: "invalid_batch_settlement_evm_payload_type" });
    expect(calls()).toEqual(["deposit", "claimWithSignature", "settle", "claimWithSignature", "settle"]);
  });
});
