// The Solana module against lcp's vectors for x402/exact/solana, x402/upto/solana and x402/batch-settlement/solana:
// @x402/svm 2.31.0's classes run unchanged against a local JSON-RPC node, the fee payer's key made in the test from the
// vectors' published seed, through the settler's HTTP surface and, for the record's keys, the module itself. Every
// expected answer is the vector's: a refusal's code, a landed transaction's id, H, the fee its compute budget bounds.
import { readFileSync } from "node:fs";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder, getTransactionDecoder } from "@solana/kit";
import { InMemoryPendingSettlementStore } from "@x402/core/facilitator";
import type { Network, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { toFacilitatorSvmSigner } from "@x402/svm";
import { UptoSvmScheme as UptoSvmServer } from "@x402/svm/upto/server";
import { InMemoryBatchPendingSettlementStore, InMemoryPaymentChannelStorage } from "@x402/svm/batch-settlement/facilitator";
import { exactSvm } from "@integraledger/lcp/x402-exact-solana";
import { uptoSvm } from "@integraledger/lcp/x402-upto-solana";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveSettler, type FeeBudgetConfig } from "../src/core.js";
import type { Module, X402Payment } from "../src/module.js";
import { listed } from "../src/modules/index.js";
import { SOLANA_MAINNET, solanaModules, starter, type SolanaConfig } from "../src/modules/solana/index.js";
import { CREDENTIAL, serving, type Serving } from "./routes.js";
import { stub, type Stub } from "./support.js";

const vectors = (name: string) => JSON.parse(readFileSync(new URL(`../../lcp/vectors/${name}`, import.meta.url), "utf8"));
const EXACT = vectors("x402-exact-solana.json");
const UPTO = vectors("x402-upto-solana.json");
const BATCH = vectors("x402-batch-settlement.json");
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;
const H = EXACT.fixed.H as string;

const hex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const signerOf = (seed: string) => createKeyPairSignerFromPrivateKeyBytes(hex(seed));

/** The fee payer's signature of a base64 wire, base58, as @solana/kit decodes it: the transaction id. */
function txidOf(wireBase64: string): string {
  const tx = getTransactionDecoder().decode(Buffer.from(wireBase64, "base64"));
  const first = Object.values(tx.signatures)[0];
  return first ? getBase58Decoder().decode(first) : "";
}

/** A Solana JSON-RPC node: every call recorded; simulation clean; a sent transaction finalized with no error. */
function rpcAnswer(method: string, params: unknown[]): unknown {
  switch (method) {
    case "simulateTransaction":
      return { context: { slot: 1000 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 1000, returnData: null } };
    case "sendTransaction":
      return txidOf(params[0] as string);
    case "getSignatureStatuses":
      return { context: { slot: 1001 }, value: [{ slot: 1000, confirmations: null, err: null, confirmationStatus: "finalized" }] };
    case "getAccountInfo":
      return { context: { slot: 1000 }, value: null };
    case "getSlot":
      return 990;
    case "getTransaction":
      // Not yet shown at `confirmed`: the fee count holds the transaction's bound.
      return null;
    default:
      return undefined;
  }
}

let node: Stub | undefined;
let settler: Serving | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await settler?.close();
  await node?.close();
  settler = node = undefined;
});

const methods = () => node!.calls.map((c) => (c.body as { method: string }).method);

async function nodeOn(answer = rpcAnswer): Promise<Stub> {
  return stub((_path, body) => {
    const { id, method, params } = body as { id: number; method: string; params: unknown[] };
    const result = answer(method, params);
    return result === undefined ? { jsonrpc: "2.0", id, error: { code: -32601, message: method } } : { jsonrpc: "2.0", id, result };
  });
}

async function configOn(network: SolanaConfig["network"], url: string): Promise<SolanaConfig> {
  const key = await signerOf(EXACT.fixed.feePayerSeed);
  return { network, node: url, signer: toFacilitatorSvmSigner(key, { defaultRpcUrl: url }) };
}

async function modulesOn(network: SolanaConfig["network"] = DEVNET, withState = true): Promise<Module[]> {
  node = await nodeOn();
  const state = {
    channels: new InMemoryPaymentChannelStorage(),
    pending: new InMemoryPendingSettlementStore(),
    batchPending: new InMemoryBatchPendingSettlementStore(),
  };
  return solanaModules(await configOn(network, node.url), withState ? state : undefined);
}

/** The settler with the Solana module on one network, through its core, over a fresh database. */
async function serve(network: SolanaConfig["network"] = DEVNET, feeBudgets?: FeeBudgetConfig[], answer = rpcAnswer): Promise<Serving> {
  node = await nodeOn(answer);
  const solana = [await configOn(network, node.url)];
  const LIST = [listed("solana", async () => ({ starter }))] as const;
  settler = await serving((port, url) =>
    serveSettler(
      { listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 5_000, credential: CREDENTIAL, operatorLog: () => {}, ...(feeBudgets ? { feeBudgets } : {}), solana },
      LIST,
    ),
  );
  return settler;
}

const body = (p: PaymentPayload) => ({ x402Version: 2, paymentPayload: p, paymentRequirements: p.accepted });
const sentWires = () =>
  node!.calls.filter((c) => (c.body as { method: string }).method === "sendTransaction").map((c) => (c.body as { params: string[] }).params[0]);

const exactOf = (ms: Module[]) => ms.find((m) => m.facilitator.scheme === "exact")!;

function payment(transaction: string, accepted: PaymentRequirements): X402Payment {
  const payload: PaymentPayload = { x402Version: 2, accepted, payload: { transaction } };
  return { payload, requirements: accepted };
}

describe("the Solana module's kinds", () => {
  it("states each pairing it submits, the fee-payer key, its signer and whether it takes zero", async () => {
    const ms = await modulesOn();
    expect(ms.map((m) => [m.facilitator.scheme, m.network, m.descriptor])).toEqual([
      ["exact", DEVNET, { name: "solana", key: "fee-payer", pairings: ["x402/exact/solana"], acceptsZero: true }],
      ["upto", DEVNET, { name: "solana", key: "fee-payer", pairings: ["x402/upto/solana"], acceptsZero: false }],
      ["batch-settlement", DEVNET, { name: "solana", key: "fee-payer", pairings: ["x402/batch-settlement/solana"], acceptsZero: false }],
    ]);
    for (const m of ms) {
      expect(m.facilitator.getSigners(DEVNET)).toEqual([EXACT.fixed.feePayer]);
      expect(m.facilitator.getExtra(DEVNET)?.["feePayer"]).toBe(EXACT.fixed.feePayer);
      expect(m.fees.paysFee(payment("", EXACT.fixed.option))).toBe(true);
    }
    // Whether each kind takes zero, as lcp's own option filter answers it for the pairing's option at "0".
    const atZero = (pairing: typeof exactSvm | typeof uptoSvm, option: PaymentRequirements) =>
      pairing.read({ x402Version: 2, resource: EXACT.fixed.resource, accepts: [{ ...option, amount: "0" }], extensions: { legalContext: { info: { type: "sha256", value: H, legalContextUrl: EXACT.fixed.link } } } } as never);
    expect("refused" in (atZero(exactSvm, { ...EXACT.fixed.option, extra: { ...EXACT.fixed.option.extra, memo: EXACT.fixed.L } }) as object)).toBe(false);
    expect((atZero(uptoSvm, { ...UPTO.fixed.option, extra: { ...UPTO.fixed.option.extra, memo: UPTO.fixed.L } }) as { refused?: boolean }).refused).toBe(true);
  });

  it("makes exact alone on mainnet, whose payment-channels program is not deployed, and without durable state", async () => {
    expect((await modulesOn(SOLANA_MAINNET)).map((m) => m.facilitator.scheme)).toEqual(["exact"]);
    await node!.close();
    expect((await modulesOn(DEVNET, false)).map((m) => m.facilitator.scheme)).toEqual(["exact"]);
  });
});

describe("the Solana module through the settler's HTTP surface", () => {
  it("states the three kinds it submits, the fee-payer key and its signer, and which take zero", async () => {
    const s = await serve();
    const supported = (await s.supported()) as { kinds: { scheme: string; extra: Record<string, unknown> }[]; signers: unknown };
    expect(supported.kinds.map((k) => [k.scheme, k.extra["key"], k.extra["pairings"], k.extra["acceptsZero"], k.extra["feePayer"]])).toEqual([
      ["exact", "fee-payer", ["x402/exact/solana"], true, EXACT.fixed.feePayer],
      ["upto", "fee-payer", ["x402/upto/solana"], false, EXACT.fixed.feePayer],
      ["batch-settlement", "fee-payer", ["x402/batch-settlement/solana"], false, EXACT.fixed.feePayer],
    ]);
    expect(supported.signers).toEqual({ "solana:*": [EXACT.fixed.feePayer] });
  });

  it("verifies V2's payment and settles it under V4's transaction id, sending V4's landed wire, and its landed copy is that one row", async () => {
    const s = await serve();
    const p: PaymentPayload = { x402Version: 2, accepted: EXACT.V2.accepted, payload: { transaction: EXACT.V2.wireBase64 } };
    expect(await s.verify(body(p))).toEqual({ isValid: true, payer: EXACT.fixed.payer });
    expect(await s.settle(body(p))).toEqual({ success: true, transaction: EXACT.V4.txid, network: DEVNET, payer: EXACT.fixed.payer });
    expect(sentWires()).toEqual([EXACT.V4.landedWireBase64]);
    // The copy the fee payer signed names the message the payer signed: the record's row, never a second submission.
    const landed: PaymentPayload = { ...p, payload: { transaction: EXACT.V4.landedWireBase64 } };
    expect(await s.settle(body(landed))).toEqual({ success: false, errorReason: "invalid_transaction_state", transaction: EXACT.V4.txid, network: DEVNET });
    expect(sentWires()).toHaveLength(1);
  });

  it("counts each payment's fee at its compute budget's bound, so the network's budget refuses the payment after it", async () => {
    // V2's bound: two signatures at 5 000 lamports, and computeUnitLimit 20 000 at computeUnitPrice 1 micro-lamport.
    const bound = 2n * 5_000n + (BigInt(EXACT.fixed.computeUnitLimit) * BigInt(EXACT.fixed.computeUnitPrice) + 999_999n) / 1_000_000n;
    const s = await serve(DEVNET, [{ network: DEVNET, amount: bound + 1n, periodSeconds: 3_600 }]);
    const v2: PaymentPayload = { x402Version: 2, accepted: EXACT.V2.accepted, payload: { transaction: EXACT.V2.wireBase64 } };
    expect(await s.settle(body(v2))).toMatchObject({ success: true, transaction: EXACT.V4.txid });
    const v1 = EXACT.transactionV1.presented as PaymentPayload;
    expect(await s.settle(body(v1))).toMatchObject({ success: true, transaction: EXACT.transactionV1.txid });
    const zero = EXACT.zeroAmount.presented as PaymentPayload;
    expect(await s.settle(body(zero))).toEqual({ success: false, errorReason: "fee_budget_spent", transaction: "", network: DEVNET });
    expect(sentWires()).toEqual([EXACT.V4.landedWireBase64, EXACT.transactionV1.landedWireBase64]);
  });

  it("counts the transaction whose send failed at the node, which x402's class answers naming none, so the network's budget refuses the payment after it", async () => {
    const bound = 2n * 5_000n + (BigInt(EXACT.fixed.computeUnitLimit) * BigInt(EXACT.fixed.computeUnitPrice) + 999_999n) / 1_000_000n;
    // The node answers sendTransaction with an error: the transaction may have reached it all the same.
    const s = await serve(DEVNET, [{ network: DEVNET, amount: bound, periodSeconds: 3_600 }], (method, params) =>
      method === "sendTransaction" ? undefined : rpcAnswer(method, params),
    );
    const v2: PaymentPayload = { x402Version: 2, accepted: EXACT.V2.accepted, payload: { transaction: EXACT.V2.wireBase64 } };
    expect(await s.settle(body(v2))).toMatchObject({ success: false, transaction: "" });
    expect(sentWires()).toEqual([EXACT.V4.landedWireBase64]);
    const v1 = EXACT.transactionV1.presented as PaymentPayload;
    await vi.waitFor(async () => expect(await s.verify(body(v1))).toEqual({ isValid: false, invalidReason: "fee_budget_spent" }), { timeout: 3_000, interval: 100 });
  });

  it("verifies the stock client's payment of amount zero, the pairing's floor", async () => {
    const s = await serve();
    const v = EXACT.zeroAmount.presented as PaymentPayload;
    expect(await s.verify(body(v))).toEqual({ isValid: true, payer: EXACT.fixed.payer });
  });

  it("refuses every refusal vector of the pairing before the class, and the node sees none", async () => {
    const s = await serve();
    const rows: { case: string; wire: string; accepted: PaymentRequirements; code: string }[] = [];
    for (const r of EXACT.V3) if (r.wireBase64) rows.push({ case: r.case, wire: r.wireBase64, accepted: r.accepted, code: r.expect });
    const refused = (e: unknown): e is { code: string } => typeof e === "object" && e !== null && "code" in e;
    for (const r of EXACT.transactionV1.changed) {
      if (refused(r.expect)) rows.push({ case: r.case, wire: r.wireBase64, accepted: EXACT.transactionV1.presented.accepted, code: r.expect.code });
    }
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const p: PaymentPayload = { x402Version: 2, accepted: r.accepted, payload: { transaction: r.wire } };
      expect([r.case, await s.verify(body(p))]).toEqual([r.case, { isValid: false, invalidReason: "invalid_payload", invalidMessage: r.code }]);
      expect([r.case, await s.settle(body(p))]).toEqual([r.case, { success: false, errorReason: "invalid_payload", errorMessage: r.code, transaction: "", network: DEVNET }]);
    }
    expect(node!.calls).toEqual([]);
  });
});

describe("x402/exact/solana through the module", () => {
  it("refuses every refusal vector of the pairing with lcp's code, and the class and the node see none", async () => {
    const m = exactOf(await modulesOn());
    const rows: { case: string; wire: string; accepted: PaymentRequirements; code: string }[] = [];
    for (const r of EXACT.V3) if (r.wireBase64) rows.push({ case: r.case, wire: r.wireBase64, accepted: r.accepted, code: r.expect });
    const refused = (e: unknown): e is { code: string } => typeof e === "object" && e !== null && "code" in e;
    for (const r of EXACT.transactionV1.changed) {
      if (refused(r.expect)) rows.push({ case: r.case, wire: r.wireBase64, accepted: EXACT.transactionV1.presented.accepted, code: r.expect.code });
    }
    for (const r of EXACT.instructionLayout.rows) {
      const base = r.base === "zeroAmount" ? EXACT.zeroAmount.presented : EXACT.transactionV1.presented;
      if (refused(r.expect)) rows.push({ case: r.case, wire: r.wireBase64, accepted: base.accepted, code: r.expect.code });
    }
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const p = payment(r.wire, r.accepted);
      const verify = await m.facilitator.verify(p.payload, p.requirements);
      expect([r.case, verify]).toEqual([r.case, { isValid: false, invalidReason: "invalid_payload", invalidMessage: r.code }]);
      const settle = await m.facilitator.settle(p.payload, p.requirements);
      expect([r.case, settle]).toEqual([
        r.case,
        { success: false, errorReason: "invalid_payload", errorMessage: r.code, transaction: "", network: DEVNET },
      ]);
      expect(await m.record.instrument(p)).toEqual({ refused: "invalid_payload", message: r.code });
    }
    for (const r of EXACT.boundAccepted.rows.filter((x: { pairing: string }) => x.pairing === "x402/exact/solana")) {
      const p = payment(EXACT.V2.wireBase64, r.accepted);
      const refusedAs = r.expect === "x402/not-v2" ? "invalid_x402_version" : r.expect.startsWith("x402/option") ? "invalid_payment_requirements" : "invalid_payload";
      expect([r.case, await m.record.instrument(p)]).toEqual([r.case, { refused: refusedAs, message: r.expect }]);
    }
    expect(node!.calls).toEqual([]);
  });

  it("refuses a payment of another network before lcp or the class, and reads a node that fails as live", async () => {
    const m = exactOf(await modulesOn());
    const other = { ...EXACT.V2.accepted, network: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z" as Network };
    expect(await m.facilitator.verify({ x402Version: 2, accepted: other, payload: { transaction: EXACT.V2.wireBase64 } }, other)).toEqual({
      isValid: false,
      invalidReason: "invalid_network",
    });
    const read = await m.record.read(payment(EXACT.V2.wireBase64, EXACT.V2.accepted), { deadline: performance.now() + 5_000 });
    expect(read.outcome).toBe("live");
    expect(read.answer.state).toBe("unreadable");
  });
});

describe("x402/upto/solana in the stock resource server's order, through the settler's HTTP surface", () => {
  it("verifies the opening as the buyer sent it, then settles the deposit and the claim x402's upto server stamps with their type", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: UPTO.fixed.now * 1000 });
    // The node's slot is the one the opening was signed at.
    const s = await serve(DEVNET, undefined, (method, params) => (method === "getSlot" ? Number(UPTO.fixed.openSlot) : rpcAnswer(method, params)));
    const row = UPTO.buyer.rows.find((x: { input?: { presented?: unknown } }) => x.input?.presented !== undefined);
    const opening: PaymentPayload = row.input.presented;
    expect(await s.verify(body(opening))).toEqual({ isValid: true, payer: UPTO.fixed.payer });
    // @x402/svm 2.31.0's upto server, holding no receiver authorizer key: what it adds to each settle it sends.
    const server = new UptoSvmServer();
    const before = await server.enrichSettlementPayload({ phase: "before-handler", paymentPayload: opening, requirements: opening.accepted } as never);
    expect(before).toEqual({ type: "deposit" });
    const deposit = await s.settle(body({ ...opening, payload: { ...opening.payload, ...before } }));
    // The class co-signed and sent the opening; the node never shows the channel account, so it answers pending.
    expect(deposit).toMatchObject({ success: false, errorReason: "settlement_pending", network: DEVNET });
    expect(sentWires()).toHaveLength(1);
    expect((deposit as { transaction: string }).transaction).toBe(txidOf(sentWires()[0]!));
    const charge = { ...opening.accepted, amount: "4000" };
    const after = await server.enrichSettlementPayload({ phase: "after-handler", paymentPayload: opening, requirements: charge } as never);
    expect(after).toEqual({ type: "claim" });
    const claim = await s.settle({ x402Version: 2, paymentPayload: { ...opening, payload: { ...opening.payload, ...after } }, paymentRequirements: charge });
    // The class's settle takes the claim, and refuses it for want of the voucher no configured key signs.
    expect(claim).toMatchObject({ success: false, errorReason: "invalid_upto_svm_authorizer_not_configured", transaction: "" });
    expect(sentWires()).toHaveLength(1);
  });
});

describe("the channel forms through the module", () => {
  const uptoOf = (ms: Module[]) => ms.find((m) => m.facilitator.scheme === "upto")!;
  const batchOf = (ms: Module[]) => ms.find((m) => m.facilitator.scheme === "batch-settlement")!;

  it("keys an upto opening by the open the payer signed, single-use, and a claim by its own digest", async () => {
    const m = uptoOf(await modulesOn());
    const row = UPTO.buyer.rows.find((r: { input?: { presented?: unknown } }) => r.input?.presented !== undefined);
    const opening: X402Payment = { payload: row.input.presented, requirements: row.input.presented.accepted };
    const at = await m.record.instrument(opening);
    expect(at).toMatchObject({ pairing: "x402/upto/solana", nonce: "single-use", instrument: { by: "single-use", network: DEVNET, signer: UPTO.fixed.payer } });
    const claim: X402Payment = {
      payload: { ...opening.payload, payload: { ...opening.payload.payload, type: "claim" } },
      requirements: { ...opening.requirements, amount: "1" },
    };
    const claimed = await m.record.instrument(claim);
    expect(claimed).toMatchObject({ pairing: "x402/upto/solana", nonce: "unshown", instrument: { by: "digest", network: DEVNET } });
    expect(await m.record.instrument({ ...claim, requirements: { ...claim.requirements, amount: "2" } })).not.toEqual(claimed);
    expect(node!.calls).toEqual([]);
  });

  it("refuses the upto plant rows with lcp's code before the class", async () => {
    const m = uptoOf(await modulesOn());
    const row = UPTO.buyer.rows.find((x: { input?: { presented?: unknown } }) => x.input?.presented !== undefined);
    for (const r of UPTO.plant) {
      const presented = row.input.presented;
      const payload = { ...presented, accepted: r.accepted, payload: { ...presented.payload, openTransaction: r.wireBase64 } };
      expect([r.case, await m.facilitator.verify(payload, r.accepted)]).toEqual([
        r.case,
        { isValid: false, invalidReason: "invalid_payload", invalidMessage: r.expect },
      ]);
    }
    expect(node!.calls).toEqual([]);
  });

  it("runs lcp's checks on an upto opening whose maxAmount is spelt with a leading zero, which the class reads as a deposit, so the fee payer co-signs nothing lcp refuses", async () => {
    // At the vector's time, within the opening's validity.
    vi.useFakeTimers({ toFake: ["Date"], now: UPTO.fixed.now * 1000 });
    const m = uptoOf(await modulesOn());
    const row = UPTO.buyer.rows.find((x: { input?: { presented?: unknown } }) => x.input?.presented !== undefined);
    const r = UPTO.plant[0];
    const presented = row.input.presented;
    const respelt = { ...presented, accepted: r.accepted, payload: { ...presented.payload, openTransaction: r.wireBase64, maxAmount: `0${presented.payload.maxAmount}` } };
    expect(BigInt(respelt.payload.maxAmount)).toBe(BigInt(r.accepted.amount));
    expect(await m.facilitator.settle(respelt, r.accepted)).toMatchObject({ success: false, errorReason: "invalid_payload", errorMessage: r.expect, transaction: "" });
    expect(node!.calls).toEqual([]);
  });

  it("keys a batch opening by its signed message's digest, its pairing's nonce being unshown", async () => {
    const m = batchOf(await modulesOn());
    const row = BATCH.buyer.rows.find((r: { pairing: string; input?: { presented?: unknown } }) => r.pairing === "x402/batch-settlement/solana" && r.input?.presented !== undefined);
    const opening: X402Payment = { payload: row.input.presented, requirements: row.input.presented.accepted };
    expect(await m.record.instrument(opening)).toMatchObject({ pairing: "x402/batch-settlement/solana", nonce: "unshown", instrument: { by: "digest", network: DEVNET } });
    expect(node!.calls).toEqual([]);
  });
});

describe("the plant", () => {
  it("fails when one member of V2's payment changes: the memo's hash moves off the option's", async () => {
    const m = exactOf(await modulesOn());
    const wire = Buffer.from(EXACT.V2.wireBase64, "base64");
    const at = wire.indexOf(Buffer.from(EXACT.fixed.L.slice(-8)));
    wire[at] = wire[at]! ^ 1;
    const p = payment(wire.toString("base64"), EXACT.V2.accepted);
    expect(await m.facilitator.verify(p.payload, p.requirements)).toMatchObject({ isValid: false });
    expect(methods()).not.toContain("sendTransaction");
  });
});
