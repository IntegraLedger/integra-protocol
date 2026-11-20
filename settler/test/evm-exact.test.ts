// The `evm` module's `exact` scheme on x402's `ExactEvmScheme` of @x402/evm 2.31.0, through the settler's /verify and
// /settle over HTTP: lcp's vectors for x402/exact/eip155/eip3009 and x402/exact/eip155/permit2 against a node stub
// (test/evm-node.ts), each expected answer stated by the vector (its payer, its signed members, its agreement value) or
// by the profile (the logs a landed authorization leaves, the record's key); the vectors' refusals and the options
// `exact` refuses on EVM; one payer's agreement and payment under one H as two rows; lcp's read and the fee the budget
// counts for a transaction whose receipt the node withholds; and what /supported states of the evm and erc7710 kinds.
import { exactEip3009, type PaymentPayload as LcpPayload } from "@integraledger/lcp/x402";
import { readFileSync } from "node:fs";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { decodeFunctionData, encodeAbiParameters, parseSignature, serializeErc6492Signature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eip3009ABI, x402ExactPermit2ProxyAddress } from "@x402/evm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettlerConfig } from "../src/core.js";
import type { EvmConfig } from "../src/modules/evm/index.js";
import { chainOf, evmNode, profileLogs, type EvmChain } from "./evm-node.js";
import { gasKey, lcpVector, pointer, settlerOf, type Settler } from "./evm-support.js";
import { until, type Stub } from "./support.js";

const E3009 = lcpVector("x402-exact-eip155-eip3009");
const P2 = lcpVector("x402-exact-eip155-permit2");
const GATEWAY = lcpVector("x402-exact-eip155-gateway-batched");
const NETWORK = "eip155:84532";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

interface Fixed {
  H: Hex;
  payer: Hex;
  payerKey: Hex;
  now: number;
}
const FIXED = pointer<Fixed>(E3009, "/fixed");
/** The vectors' signed payments: each file's B6 row presents the payment the file signs. */
const PAYMENT_3009 = pointer<PaymentPayload>(E3009, "/buyer/rows/1/input/presented");
const PAYMENT_P2 = pointer<PaymentPayload>(P2, "/buyer/rows/1/input/presented");
const TOKEN = PAYMENT_3009.accepted.asset;
/** The reasons x402 gives a request the settler refuses before the class: the core's and the profile's. */
const REFUSED = ["invalid_payment_requirements", "invalid_payload", "invalid_network", "unsupported_scheme"];

let node: Stub | undefined;
let settler: Settler | undefined;
let chain: EvmChain;

beforeEach(() => {
  // x402's class reads the signed window against Date.now(); the vectors sign at `now`. Only Date is moved.
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED.now * 1000 });
});
afterEach(async () => {
  vi.useRealTimers();
  await settler?.close();
  await node?.close();
  settler = node = undefined;
}, 60_000);

/** The settler with the evm module's `exact` on the vectors' network, its gas key generated here. */
async function exactOn(more: Partial<SettlerConfig> = {}): Promise<{ settler: Settler; key: Hex }> {
  chain = chainOf(FIXED.now, [TOKEN, x402ExactPermit2ProxyAddress, PERMIT2]);
  node = await evmNode(chain);
  const signer = gasKey(node.url);
  settler = await settlerOf({ evm: [{ network: NETWORK, rpc: node.url, signer, schemes: ["exact"] }] }, more);
  return { settler, key: signer.address };
}

/** The record's key of a single-use value, as the settler's record writes it. */
function singleUse(signer: string, scope: string, value: string): string {
  return JSON.stringify(["single-use", signer.toLowerCase(), scope.toLowerCase(), value, null]);
}

describe("x402/exact/eip155/eip3009 through the evm module", () => {
  it("verifies V2's payment as its payer's, settles it by sending the authorization the payer signed, every member unchanged, and records it by network, token, payer and nonce until validBefore", async () => {
    const { settler, key } = await exactOn();
    expect(await settler.verify(PAYMENT_3009)).toMatchObject({ isValid: true, payer: FIXED.payer });
    expect(chain.sent).toHaveLength(0);

    const settled = await settler.settle(PAYMENT_3009);
    expect(chain.sent).toHaveLength(1);
    const tx = chain.sent[0]!;
    expect(settled).toEqual({ success: true, transaction: tx.hash, network: NETWORK, payer: FIXED.payer });
    // The transaction is the module's key's, to the token, carrying the vector's authorization and signature.
    expect(tx.from).toBe(key.toLowerCase());
    expect(tx.to).toBe(TOKEN.toLowerCase());
    const call = decodeFunctionData({ abi: eip3009ABI, data: tx.input });
    const a = (PAYMENT_3009.payload as { authorization: Record<string, string> }).authorization;
    const sig = parseSignature((PAYMENT_3009.payload as { signature: Hex }).signature);
    expect(call.functionName).toBe("transferWithAuthorization");
    expect(call.args.map((v) => (typeof v === "string" ? v.toLowerCase() : v))).toEqual([
      a["from"]!.toLowerCase(),
      a["to"]!.toLowerCase(),
      BigInt(a["value"]!),
      BigInt(a["validAfter"]!),
      BigInt(a["validBefore"]!),
      a["nonce"]!.toLowerCase(),
      Number(sig.v),
      sig.r,
      sig.s,
    ]);
    expect(await settler.rows()).toEqual([
      {
        network: NETWORK,
        key: singleUse(FIXED.payer, TOKEN, FIXED.H),
        pairing: "x402/exact/eip155/eip3009",
        final: true,
        transaction: tx.hash,
        keep_until: String(BigInt(a["validBefore"]!) * 1000n),
      },
    ]);
  });

  it("keys one payer's agreement and payment under one H as two instruments: two submissions, two rows", async () => {
    const { settler } = await exactOn();
    // The agreement: V1's authorization with the vector's agreement value as its nonce, signed by the vector's payer.
    const ag = pointer<{ expectValue: Hex }>(E3009, "/AG");
    const required = { x402Version: 2 as const, resource: PAYMENT_3009.resource!, accepts: [PAYMENT_3009.accepted] };
    const unsigned = await exactEip3009.build({ required, accepted: PAYMENT_3009.accepted, from: FIXED.payer, now: FIXED.now } as never, FIXED.H, "agreement");
    if ("refused" in unsigned) throw new Error(String(unsigned.code));
    const signature = await privateKeyToAccount(FIXED.payerKey).signTypedData(unsigned.typedData as never);
    const agreement = unsigned.complete(signature) as LcpPayload as unknown as PaymentPayload;

    expect(await settler.settle(agreement)).toMatchObject({ success: true, payer: FIXED.payer });
    expect(await settler.settle(PAYMENT_3009)).toMatchObject({ success: true, payer: FIXED.payer });
    expect(chain.sent).toHaveLength(2);
    expect((await settler.rows()).map((r) => [r.key, r.final, r.transaction])).toEqual([
      [singleUse(FIXED.payer, TOKEN, ag.expectValue), true, chain.sent[0]!.hash],
      [singleUse(FIXED.payer, TOKEN, FIXED.H), true, chain.sent[1]!.hash],
    ]);
  });

  it("refuses each of the vector's options the pairing does not offer, records nothing and sends nothing", async () => {
    const { settler } = await exactOn();
    const rows = pointer<{ case: string; accepted: PaymentRequirements; payment: string }[]>(E3009, "/boundAccepted/rows");
    expect(rows).not.toHaveLength(0);
    for (const row of rows) {
      const payload = { ...pointer<PaymentPayload>(E3009, row.payment), accepted: row.accepted };
      const v = await settler.verify(payload);
      expect(v.isValid, row.case).toBe(false);
      expect(REFUSED, row.case).toContain(v.invalidReason);
      expect(await settler.settle(payload), row.case).toMatchObject({ success: false, transaction: "" });
    }
    expect(await settler.rows()).toEqual([]);
    expect(chain.methods).toEqual([]);
  });

  it("refuses, before the class is asked, an option with splits, Circle's batched option, and a verifyingContract that is not the asset", async () => {
    const { settler } = await exactOn();
    const o = PAYMENT_3009.accepted;
    const gateway = pointer<PaymentPayload>(GATEWAY, "/buyer/rows/1/input/presented");
    const cases: [string, PaymentPayload][] = [
      ["splits", { ...PAYMENT_3009, accepted: { ...o, extra: { ...o.extra, splits: [{ payTo: o.payTo, bps: 10000 }] } } }],
      ["GatewayWalletBatched", { ...PAYMENT_3009, accepted: { ...o, extra: { ...o.extra, name: "GatewayWalletBatched" } } }],
      ["verifyingContract", { ...PAYMENT_3009, accepted: { ...o, extra: { ...o.extra, verifyingContract: o.payTo } } }],
      ["the gateway-batched vector's payment", gateway],
    ];
    for (const [name, payload] of cases) {
      expect(await settler.verify(payload), name).toEqual({ isValid: false, invalidReason: "invalid_payment_requirements" });
      expect(await settler.settle(payload), name).toMatchObject({ success: false, errorReason: "invalid_payment_requirements", transaction: "" });
    }
    expect(await settler.rows()).toEqual([]);
    expect(chain.methods).toEqual([]);
    // An empty splits list pays one payee, and is the class's to settle.
    const empty = { ...PAYMENT_3009, accepted: { ...o, extra: { ...o.extra, splits: [] } } };
    expect(await settler.verify(empty)).toMatchObject({ isValid: true, payer: FIXED.payer });
  });

  it("answers a settle whose receipt the node withholds pending at its bound's fee, sends it once, and once the chain shows it answers success by lcp's read with the fee the receipt shows", async () => {
    const { settler } = await exactOn({ feeBudgets: [{ network: NETWORK, amount: 10n ** 18n, periodSeconds: 3600 }] });
    chain.withhold = true;
    const pending = await settler.settle(PAYMENT_3009);
    const tx = chain.sent[0]!;
    expect(pending).toMatchObject({ success: false, errorReason: "settlement_pending", transaction: tx.hash, network: NETWORK });
    // Before inclusion the budget counts the transaction's own bound: its gas limit times its fee cap.
    expect(await settler.fees()).toEqual([{ transaction: tx.hash, fee: String(tx.gas * tx.maxFeePerGas), included: false }]);
    // x402's class keeps what it sent in the settler's database, and a repeat while the receipt is withheld sends nothing.
    const signature = (PAYMENT_3009.payload as { signature: string }).signature;
    expect(await settler.state()).toEqual([{ module: "evm", key: `pending-settlement:${signature}`, value: tx.hash }]);
    expect(await settler.settle(PAYMENT_3009)).toMatchObject({ success: false, errorReason: "settlement_pending", transaction: tx.hash });
    expect(chain.sent).toHaveLength(1);
    // Included: lcp's read, given the transaction the record holds, finds the authorization's use and its transfer.
    chain.withhold = false;
    expect(await settler.settle(PAYMENT_3009)).toEqual({ success: true, transaction: tx.hash, network: NETWORK, payer: FIXED.payer });
    expect(chain.sent).toHaveLength(1);
    expect((await settler.rows()).map((r) => [r.final, r.transaction])).toEqual([[true, tx.hash]]);
    await until(async () => (await settler.fees())[0]?.included === true);
    expect(await settler.fees()).toEqual([{ transaction: tx.hash, fee: String(65_000n * 1_500_000_000n), included: true }]);
  });

  it("counts on an OP Stack network the L1 data fee its key pays beside the L2 fee: the GasPriceOracle's getL1Fee in the bound, the receipt's l1Fee once included", async () => {
    const { settler } = await exactOn({ feeBudgets: [{ network: NETWORK, amount: 10n ** 18n, periodSeconds: 3600 }] });
    // As an OP Stack node answers: the GasPriceOracle predeploy's getL1Fee(bytes), and a receipt's L1 members.
    const [estimate, paid] = [41_000_000_000n, 39_500_000_000n];
    chain.answers = (to, input) =>
      to === "0x420000000000000000000000000000000000000f" && input.startsWith("0x49948e0e") ? encodeAbiParameters([{ type: "uint256" }], [estimate]) : undefined;
    chain.receiptMore = { l1Fee: `0x${paid.toString(16)}`, l1GasUsed: "0x640", l1GasPrice: "0x3b9aca00", l1BaseFeeScalar: "0x8dd", l1BlobBaseFee: "0x1", l1BlobBaseFeeScalar: "0x101c12" };
    chain.withhold = true;
    await settler.settle(PAYMENT_3009);
    const tx = chain.sent[0]!;
    expect(await settler.fees()).toEqual([{ transaction: tx.hash, fee: String(tx.gas * tx.maxFeePerGas + estimate), included: false }]);
    chain.withhold = false;
    expect(await settler.settle(PAYMENT_3009)).toMatchObject({ success: true, transaction: tx.hash });
    await until(async () => (await settler.fees())[0]?.included === true);
    expect(await settler.fees()).toEqual([{ transaction: tx.hash, fee: String(65_000n * 1_500_000_000n + paid), included: true }]);
  });

  it("counts in the fee budget the transaction that deploys the payer's wallet before its payment, which no answer names", async () => {
    // ERC-6492: V1's signature wrapped with the factory call that deploys the payer's wallet, which has no code yet.
    const factory: Hex = "0x0000000000000000000000000000000000006492";
    chain = chainOf(FIXED.now, [TOKEN, x402ExactPermit2ProxyAddress, PERMIT2]);
    chain.logsOf = (to, input) => (to === factory ? [] : profileLogs(to, input));
    node = await evmNode(chain);
    const evm: EvmConfig[] = [{ network: NETWORK, rpc: node.url, signer: gasKey(node.url), schemes: ["exact"], eip6492AllowedFactories: [factory] }];
    settler = await settlerOf({ evm }, { feeBudgets: [{ network: NETWORK, amount: 10n ** 18n, periodSeconds: 3600 }] });
    const inner = (PAYMENT_3009.payload as { signature: Hex }).signature;
    const signature = serializeErc6492Signature({ address: factory, data: "0xdeadbeef", signature: inner });
    const answer = await settler.settle({ ...PAYMENT_3009, payload: { ...PAYMENT_3009.payload, signature } });
    const [deploy, transfer] = chain.sent;
    expect([deploy?.to, answer]).toEqual([factory, { success: true, transaction: transfer?.hash, network: NETWORK, payer: FIXED.payer }]);
    // The core counts the transaction the answer names; the deploy is counted as the gas key sends it.
    const counted = async () => (await settler!.fees()).filter((f) => f.included).length;
    const by = performance.now() + 2_000;
    await until(async () => (await counted()) === 2 || performance.now() > by);
    const paid = String(65_000n * 1_500_000_000n);
    expect((await settler.fees()).sort((a, b) => a.transaction.localeCompare(b.transaction))).toEqual(
      [deploy!.hash, transfer!.hash].sort().map((transaction) => ({ transaction, fee: paid, included: true })),
    );
  });
});

describe("x402/exact/eip155/permit2 through the evm module", () => {
  it("verifies EV1's permit as its owner's, settles it through x402's exact Permit2 proxy with the permit unchanged, and records it by owner and nonce until the deadline", async () => {
    const { settler } = await exactOn();
    const owner = pointer<Hex>(P2, "/fixed/payer");
    expect(await settler.verify(PAYMENT_P2)).toMatchObject({ isValid: true, payer: owner });
    const settled = await settler.settle(PAYMENT_P2);
    const tx = chain.sent.at(-1)!;
    expect(settled).toEqual({ success: true, transaction: tx.hash, network: NETWORK, payer: owner });
    expect(tx.to).toBe(x402ExactPermit2ProxyAddress.toLowerCase());
    expect(tx.input.toLowerCase()).toContain((PAYMENT_P2.payload as { signature: Hex }).signature.slice(2).toLowerCase());
    expect(await settler.rows()).toEqual([
      {
        network: NETWORK,
        key: singleUse(owner, PERMIT2, pointer<string>(P2, "/EV1/expectNonceDecimal")),
        pairing: "x402/exact/eip155/permit2",
        final: true,
        transaction: tx.hash,
        keep_until: String(BigInt(pointer<string>(P2, "/EV1/expectDeadline")) * 1000n),
      },
    ]);
  });

  it("refuses each of the permit2 vector's options the pairing does not offer", async () => {
    const { settler } = await exactOn();
    for (const row of pointer<{ case: string; accepted: PaymentRequirements; payment: string }[]>(P2, "/boundAccepted/rows")) {
      const payload = { ...pointer<PaymentPayload>(P2, row.payment), accepted: row.accepted };
      const v = await settler.verify(payload);
      expect(v.isValid, row.case).toBe(false);
      expect(REFUSED, row.case).toContain(v.invalidReason);
    }
    expect(await settler.rows()).toEqual([]);
    expect(chain.sent).toHaveLength(0);
  });
});

describe("x402/exact/eip155/eip3009 at zero, as Base Sepolia's USDC takes it", () => {
  // A payment of amount 0 and its transferWithAuthorization's logs, as Base Sepolia's node simulated it (the fixture names it).
  const Z = JSON.parse(readFileSync(new URL("./fixtures/base-sepolia-eip3009-zero.json", import.meta.url), "utf8")) as {
    block: { timestamp: number };
    payment: PaymentPayload;
    simulation: { logs: unknown[] };
  };

  it("verifies and settles the payment of 0, sending its authorization, which leaves the logs the chain's simulation shows", async () => {
    vi.setSystemTime(Z.block.timestamp * 1000);
    const { settler } = await exactOn();
    const payer = (Z.payment.payload as { authorization: { from: string } }).authorization.from;
    expect(await settler.verify(Z.payment)).toMatchObject({ isValid: true, payer });
    const settled = await settler.settle(Z.payment);
    expect(settled).toMatchObject({ success: true, network: NETWORK, payer });
    const tx = chain.sent.at(-1)!;
    expect(settled.transaction).toBe(tx.hash);
    expect(profileLogs(tx.to, tx.input)).toEqual(Z.simulation.logs);
  });
});

describe("what /supported states of the evm and erc7710 modules", () => {
  it("states each configured scheme on each network once, with the gas key as relayer and as its signer, its pairings, and the one that takes zero; erc7710's behind exact", async () => {
    chain = chainOf(FIXED.now, [TOKEN]);
    node = await evmNode(chain);
    const signer = gasKey(node.url);
    settler = await settlerOf({
      evm: [
        { network: NETWORK, rpc: node.url, signer },
        { network: "eip155:8453", rpc: node.url, signer, schemes: ["exact", "upto"] },
      ],
      erc7710: [{ network: NETWORK, rpc: node.url, signer }],
    });
    const supported = await settler.supported();
    const exact = ["x402/exact/eip155/eip3009", "x402/exact/eip155/permit2"];
    const erc7710 = ["x402/exact/eip155/erc7710", "x402/exact/eip155/erc7710-salt"];
    const zero = ["x402/exact/eip155/eip3009"];
    expect(supported.kinds.map((k) => [k.scheme, k.network, k.extra?.["pairings"], k.extra?.["acceptsZero"]])).toEqual([
      ["exact", NETWORK, [...erc7710, ...exact], zero],
      ["upto", NETWORK, ["x402/upto/eip155/permit2"], []],
      ["auth-capture", NETWORK, ["x402/auth-capture/eip155/eip3009", "x402/auth-capture/eip155/permit2"], []],
      ["batch-settlement", NETWORK, ["x402/batch-settlement/eip155"], []],
      ["exact", "eip155:8453", exact, zero],
      ["upto", "eip155:8453", ["x402/upto/eip155/permit2"], []],
    ]);
    for (const k of supported.kinds) expect(k.extra, `${k.scheme} ${k.network}`).toMatchObject({ key: "relayer" });
    expect(supported.signers).toEqual({ "eip155:*": [signer.address] });
  });
});
