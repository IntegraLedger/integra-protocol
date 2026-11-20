// The `evm` module's `upto`, `auth-capture` and `batch-settlement` schemes on @x402/evm 2.31.0's UptoEvmScheme,
// AuthCaptureEvmScheme and BatchSettlementEvmScheme, through the settler's /verify and /settle over HTTP: lcp's vectors
// for x402/upto/eip155/permit2, x402/auth-capture/eip155/{eip3009,permit2} and x402/batch-settlement/eip155 against the
// node stub, each expected answer the vector's; the vectors' refusals; the record's key of each form; and the batch
// opening found by lcp's read once the node shows the receipt lcp's vector records for it. The upto and auth-capture
// vectors name their facilitator, Anvil's published development account 2, in what the payer signed (the permit's
// witness, the escrow's capture authorizer), so those modules are given that account's published key; it signs only
// for the stub.
import { digestJson } from "@integraledger/lcp";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { x402UptoPermit2ProxyAddress, AUTH_CAPTURE_ESCROW_ADDRESS, EIP3009_TOKEN_COLLECTOR_ADDRESS, PERMIT2_TOKEN_COLLECTOR_ADDRESS, BATCH_SETTLEMENT_ADDRESS, ERC3009_DEPOSIT_COLLECTOR_ADDRESS } from "@x402/evm";
import { encodeAbiParameters, toFunctionSelector, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvmScheme } from "../src/modules/evm/forms.js";
import { chainOf, evmNode, profileLogs, transferLog, type EvmChain, type EvmLog } from "./evm-node.js";
import { gasKey, lcpVector, pointer, settlerOf, type Settler } from "./evm-support.js";
import type { Stub } from "./support.js";

/** Anvil's published development account 2, the facilitator the upto and auth-capture vectors name. */
const ANVIL_2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const NOW = 1790000000;
const NETWORK = "eip155:84532";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
/** The commerce-payments escrow's `paymentState(bytes32)`. */
const PAYMENT_STATE = toFunctionSelector("paymentState(bytes32)");
/** The batch-settlement channel contract's `channels(bytes32)`. */
const CHANNELS = toFunctionSelector("channels(bytes32)");
const REFUSED = ["invalid_payment_requirements", "invalid_payload", "invalid_network", "unsupported_scheme"];

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

async function settlerFor(scheme: EvmScheme, token: string, key?: Hex): Promise<Settler> {
  chain = chainOf(NOW, [
    token,
    PERMIT2,
    x402UptoPermit2ProxyAddress,
    AUTH_CAPTURE_ESCROW_ADDRESS,
    EIP3009_TOKEN_COLLECTOR_ADDRESS,
    PERMIT2_TOKEN_COLLECTOR_ADDRESS,
    BATCH_SETTLEMENT_ADDRESS,
    ERC3009_DEPOSIT_COLLECTOR_ADDRESS,
  ]);
  node = await evmNode(chain);
  settler = await settlerOf({ evm: [{ network: NETWORK, rpc: node.url, signer: gasKey(node.url, key), schemes: [scheme] }] });
  return settler;
}

type Row = { case: string; accepted: PaymentRequirements; payment: string };

/** Each of the vector's refused options, presented with `payment` where given, refused at /verify, nothing recorded or sent. */
async function refusesEach(settler: Settler, file: unknown, payment?: string): Promise<void> {
  const rows = pointer<Row[]>(file, "/boundAccepted/rows").filter((r) => payment === undefined || r.payment === payment);
  expect(rows).not.toHaveLength(0);
  for (const r of rows) {
    const v = await settler.verify({ ...pointer<PaymentPayload>(file, r.payment), accepted: r.accepted });
    expect(v.isValid, r.case).toBe(false);
    expect(REFUSED, r.case).toContain(v.invalidReason);
  }
  expect(await settler.rows()).toEqual([]);
  expect(chain.sent).toHaveLength(0);
}

describe("x402/upto/eip155/permit2 through the evm module", () => {
  const V = lcpVector("x402-upto-eip155-permit2");
  const payment = pointer<PaymentPayload>(V, "/buyer/rows/1/input/presented");
  const owner = pointer<Hex>(V, "/fixed/payer");

  it("verifies EV2's permit as its owner's, settles it through x402's upto proxy, and records it by owner and nonce until the deadline", async () => {
    const settler = await settlerFor("upto", payment.accepted.asset, ANVIL_2);
    expect(await settler.verify(payment)).toMatchObject({ isValid: true, payer: owner });
    const settled = await settler.settle(payment);
    const tx = chain.sent.at(-1)!;
    expect(settled).toMatchObject({ success: true, transaction: tx.hash, network: NETWORK, payer: owner });
    expect(tx.to).toBe(x402UptoPermit2ProxyAddress.toLowerCase());
    const permit = (payment.payload as { permit2Authorization: { nonce: string; deadline: string } }).permit2Authorization;
    expect(await settler.rows()).toEqual([
      {
        network: NETWORK,
        key: JSON.stringify(["single-use", owner.toLowerCase(), PERMIT2.toLowerCase(), permit.nonce, null]),
        pairing: "x402/upto/eip155/permit2",
        final: true,
        transaction: tx.hash,
        keep_until: String(BigInt(permit.deadline) * 1000n),
      },
    ]);
  });

  it("settles EV2's permit for a charge below its maximum, the requirements x402's upto resource server sends at /settle", async () => {
    const settler = await settlerFor("upto", payment.accepted.asset, ANVIL_2);
    const charge = { ...payment.accepted, amount: "1250000" };
    expect(await settler.verify(payment)).toMatchObject({ isValid: true, payer: owner });
    const settled = await settler.settle(payment, charge);
    expect(settled).toMatchObject({ success: true, network: NETWORK, payer: owner, amount: "1250000" });
    const tx = chain.sent.at(-1)!;
    expect(settled.transaction).toBe(tx.hash);
    expect(profileLogs(tx.to, tx.input)).toEqual([transferLog(payment.accepted.asset, owner, payment.accepted.payTo, 1250000n)]);
    // Above the maximum, the payment is not the option it accepted.
    expect(await settler.settle(payment, { ...payment.accepted, amount: "5000001" })).toMatchObject({ success: false, errorReason: "invalid_payload" });
  });

  it("refuses the vector's option with no facilitator address, and each option the pairing does not offer", async () => {
    const settler = await settlerFor("upto", payment.accepted.asset, ANVIL_2);
    const missing = { ...payment.accepted, extra: { ...payment.accepted.extra, facilitatorAddress: undefined } };
    expect(await settler.verify({ ...payment, accepted: missing })).toEqual({ isValid: false, invalidReason: "invalid_payment_requirements" });
    await refusesEach(settler, V);
  });
});

describe("x402/auth-capture/eip155 through the evm module", () => {
  for (const file of ["x402-auth-capture-eip155-eip3009", "x402-auth-capture-eip155-permit2"]) {
    const V = lcpVector(file);
    const payment = pointer<PaymentPayload>(V, "/buyer/rows/1/input/presented");
    const pairing = file.replace("x402-auth-capture-eip155-", "x402/auth-capture/eip155/");
    const payer = pointer<string>(V, "/fixed/payer");

    it(`verifies ${pairing}'s payment as its payer's, settles it as the escrow's authorize through x402's AuthCaptureEvmScheme, and records it by its payer until its expiry`, async () => {
      const settler = await settlerFor("auth-capture", payment.accepted.asset, ANVIL_2);
      expect(await settler.verify(payment)).toMatchObject({ isValid: true, payer });
      // The escrow's code: authorize takes the payment, which then holds the whole amount capturable and nothing
      // refundable (its paymentState), and moves the payer's tokens into its store.
      chain.logsOf = (to) => (to === AUTH_CAPTURE_ESCROW_ADDRESS.toLowerCase() ? [] : undefined);
      chain.answers = (_to, input) =>
        input.startsWith(PAYMENT_STATE) && chain.sent.length > 0
          ? encodeAbiParameters([{ type: "bool" }, { type: "uint120" }, { type: "uint120" }], [true, BigInt(payment.accepted.amount), 0n])
          : undefined;
      const settled = await settler.settle(payment);
      const tx = chain.sent.at(-1)!;
      expect(settled).toMatchObject({ success: true, transaction: tx.hash, network: NETWORK, payer });
      expect(tx.to).toBe(AUTH_CAPTURE_ESCROW_ADDRESS.toLowerCase());
      expect(tx.input.toLowerCase()).toContain((payment.payload as { signature: Hex }).signature.slice(2, 130).toLowerCase());
      const [row] = await settler.rows();
      expect(row).toMatchObject({ network: NETWORK, pairing, final: true, transaction: tx.hash });
      // The collector's signed nonce, counted in the token's nonce space (ERC-3009) or Permit2's one bitmap per owner.
      const scope = pairing.endsWith("/eip3009") ? payment.accepted.asset : PERMIT2;
      expect((JSON.parse(row!.key) as unknown[]).slice(0, 3)).toEqual(["single-use", payer.toLowerCase(), scope.toLowerCase()]);
      expect(row!.keep_until).not.toBeNull();
    });

    it(`refuses each option ${pairing} does not offer`, async () => {
      await refusesEach(await settlerFor("auth-capture", payment.accepted.asset, ANVIL_2), V);
    });
  }
});

describe("x402/batch-settlement/eip155 through the evm module", () => {
  const V = lcpVector("x402-batch-settlement");
  const DEPOSIT = "/buyer/rows/3/input/presented";
  const deposit = pointer<PaymentPayload>(V, DEPOSIT);
  const body = deposit.payload as { channelConfig: { payer: string }; voucher: { channelId: string }; deposit: { amount: string } };
  /** The receipt lcp's vector records for this opening's deposit call through the ERC-3009 collector. */
  const landed = pointer<{ logs: EvmLog[] }>(V, "/EB7/fullCall/receipt").logs.map((l) => ({
    address: l.address.toLowerCase() as Hex,
    topics: l.topics.map((t) => t.toLowerCase() as Hex),
    data: l.data,
  }));

  /** The channel contract's code: a deposit moves the payer's tokens into the channel, whose balance is then the deposit. */
  function channelContract(): void {
    chain.logsOf = (to) => (to === BATCH_SETTLEMENT_ADDRESS.toLowerCase() ? landed : undefined);
    chain.answers = (to, input) =>
      to === BATCH_SETTLEMENT_ADDRESS.toLowerCase() && input.startsWith(CHANNELS) && input.includes(body.voucher.channelId.slice(2).toLowerCase()) && chain.sent.length > 0
        ? encodeAbiParameters([{ type: "uint128" }, { type: "uint128" }], [BigInt(body.deposit.amount), 0n])
        : undefined;
  }

  it("verifies the opening's deposit as its payer's, settles it through the channel contract, and records it by the digest of the signed payload for the settler's life", async () => {
    const settler = await settlerFor("batch-settlement", deposit.accepted.asset);
    channelContract();
    expect(await settler.verify(deposit)).toMatchObject({ isValid: true, payer: body.channelConfig.payer });
    const settled = await settler.settle(deposit);
    const tx = chain.sent.at(-1)!;
    expect(settled).toMatchObject({ success: true, transaction: tx.hash, network: NETWORK, payer: body.channelConfig.payer });
    expect(tx.to).toBe(BATCH_SETTLEMENT_ADDRESS.toLowerCase());
    expect(await settler.rows()).toEqual([
      {
        network: NETWORK,
        key: JSON.stringify(["digest", await digestJson(deposit.payload as never)]),
        pairing: "x402/batch-settlement/eip155",
        final: true,
        transaction: tx.hash,
        keep_until: null,
      },
    ]);
  });

  it("answers a deposit whose receipt the node withholds pending, and a repeat once the node shows it success by lcp's read of the opening, sending nothing again", async () => {
    const settler = await settlerFor("batch-settlement", deposit.accepted.asset);
    channelContract();
    chain.withhold = true;
    const pending = await settler.settle(deposit);
    const tx = chain.sent[0]!;
    expect(pending).toMatchObject({ success: false, errorReason: "settlement_pending", transaction: tx.hash, network: NETWORK });
    chain.withhold = false;
    expect(await settler.settle(deposit)).toEqual({ success: true, transaction: tx.hash, network: NETWORK, payer: body.channelConfig.payer });
    expect(chain.sent).toHaveLength(1);
    expect((await settler.rows()).map((r) => [r.final, r.transaction])).toEqual([[true, tx.hash]]);
  });

  it("refuses each option the pairing does not offer", async () => {
    await refusesEach(await settlerFor("batch-settlement", deposit.accepted.asset), V, DEPOSIT);
  });
});
