// The Hedera module through the settler's HTTP surface, against lcp's vectors: x402/exact/hedera's payment and its
// refusals, and lcp's Mirror Node answers for its read (x402-exact-hedera.json); and the transfer-executor, given its
// one executor here as only a harness gives it, against x402's own example payment and record
// (x402-exact-hedera-transfer-executor.json) and the call x402's specification fixes. @x402/hedera 2.31.0's class runs
// unchanged; its signer object, the node boundary it takes, is a stub that records each call.
import { readFileSync } from "node:fs";
import { AccountId, Hbar, PrivateKey, Timestamp, TransactionId, TransferTransaction, type ContractExecuteTransaction } from "@hiero-ledger/sdk";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { FacilitatorHederaSigner } from "@x402/hedera";
import { afterEach, describe, expect, it } from "vitest";
import { serveSettler } from "../src/core.js";
import type { ModuleStarter } from "../src/module.js";
import { NODE_MAX_BYTES } from "../src/http.js";
import { transferExecutorModule } from "../src/modules/hedera/executor.js";
import { hederaModule, starter, type HederaConfig } from "../src/modules/hedera/index.js";
import { mirrorCall } from "../src/modules/hedera/mirror.js";
import { listed, type Listed } from "../src/modules/index.js";
import { CREDENTIAL, routes, serving, Status, type Routes, type Serving } from "./routes.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../lcp/vectors/${name}`, import.meta.url), "utf8"));
const V = read("x402-exact-hedera.json");
const E = read("x402-exact-hedera-transfer-executor.json");
const NETWORK = "hedera:testnet";
const O: PaymentRequirements = V.fixed.O;
const FEE_PAYER: string = V.fixed.O.extra.feePayer;
/** x402's example record names 0.0.9000 as the account that paid the executor transaction's fee. */
const EXECUTOR_FEE_PAYER = "0.0.9000";

let node: Routes | undefined;
let settler: Serving | undefined;
afterEach(async () => {
  await settler?.close();
  await node?.close();
  settler = node = undefined;
});

function body(payload: PaymentPayload) {
  return { x402Version: 2, paymentPayload: payload, paymentRequirements: payload.accepted };
}

const v2 = (accepted: PaymentRequirements = O): PaymentPayload => ({
  x402Version: 2,
  accepted,
  payload: { transaction: V.V2.expectTransactionBase64 },
});

/** The class's signer object for the vector's fee payer, each call recorded; the payer's key and funds as the node shows them. */
function signerStub(calls: string[]): FacilitatorHederaSigner {
  return {
    getAddresses: () => [FEE_PAYER],
    async verifyPayerSignature() {
      calls.push("verifyPayerSignature");
      return { ok: true };
    },
    async preflightTransfer() {
      calls.push("preflightTransfer");
      return { ok: true };
    },
    async signAndSubmitTransaction() {
      calls.push("signAndSubmitTransaction");
      return { transactionId: V.V2.expectTxIdText };
    },
  };
}

/** A Mirror Node answering one of lcp's V5 rows: its latest timestamp, its oldest block, and the entries under the id. */
function mirrorOfRow(row: { mirror: { latest: string; oldest?: string; byId: unknown } }) {
  return (path: string) => {
    if (path.startsWith("/api/v1/blocks?order=desc")) return { blocks: [{ timestamp: { from: row.mirror.latest, to: row.mirror.latest } }] };
    if (path.startsWith("/api/v1/blocks?order=asc")) return { blocks: [{ timestamp: { from: row.mirror.oldest ?? "0.000000000", to: "0.000000001" } }] };
    if (path.startsWith("/api/v1/transactions/")) return row.mirror.byId === null ? new Status(404, { _status: { messages: [{ message: "Not found" }] } }) : { transactions: row.mirror.byId };
    return new Status(404, {});
  };
}

async function start(list: readonly [Listed<"hedera", readonly HederaConfig[]>], hedera: readonly HederaConfig[]) {
  settler = await serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, hedera }, list),
  );
}

describe("the Hedera module, x402/exact/hedera", () => {
  const LIST = [listed("hedera", async () => ({ starter }))] as const;

  it("states the pairing it submits, its fee-payer key and account, and that it does not take zero", async () => {
    node = await routes(() => new Status(404, {}));
    await start(LIST, [{ network: NETWORK, signer: signerStub([]), mirror: node.url }]);
    expect(await settler!.supported()).toEqual({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: NETWORK,
          extra: { feePayer: FEE_PAYER, key: "fee-payer", acceptsZero: [], pairings: ["x402/exact/hedera"] },
        },
      ],
      extensions: [],
      signers: { "hedera:*": [FEE_PAYER] },
    });
  });

  it("verifies V2 and settles it under the vector's transaction id, the mirror holding nothing under it yet", async () => {
    const row = V.V5.rows.find((r: { expect: { reason?: string }; mirror: { byId: unknown } }) => r.expect.reason === "instrument-live" && r.mirror.byId === null);
    node = await routes(mirrorOfRow(row));
    const calls: string[] = [];
    await start(LIST, [{ network: NETWORK, signer: signerStub(calls), mirror: node.url }]);
    expect(await settler!.verify(body(v2()))).toEqual({ isValid: true, payer: V.V2.expectReference.payer });
    expect(await settler!.settle(body(v2()))).toEqual({ success: true, transaction: V.V2.expectTxIdText, network: NETWORK, payer: V.V2.expectReference.payer });
    expect(calls.filter((c) => c === "signAndSubmitTransaction")).toHaveLength(1);
  });

  it("keys a payment by its transaction id and payer, so a list the SDK froze for two nodes, settled, and the same list trimmed to one body are one row, signed and submitted once (profile rules 6 and 9)", async () => {
    // As x402's client freezes it with an SDK client: one body per node, each signed by the buyer, here a key made for
    // the test; the vector's id, memo, fee and transfer.
    const buyer = PrivateKey.generateED25519();
    const frozen = async (nodes: number[]) => {
      const tx = new TransferTransaction()
        .setTransactionId(TransactionId.withValidStart(AccountId.fromString(FEE_PAYER), new Timestamp(Number(V.fixed.validStart.seconds), 0)))
        .setNodeAccountIds(nodes.map((n) => new AccountId(n)))
        .setTransactionMemo(V.fixed.L)
        .setTransactionValidDuration(120)
        .setMaxTransactionFee(Hbar.fromTinybars(V.fixed.maxFee))
        .addHbarTransfer(V.fixed.payer, Hbar.fromTinybars(`-${O.amount}`))
        .addHbarTransfer(O.payTo, Hbar.fromTinybars(O.amount))
        .freeze();
      await tx.sign(buyer);
      return { x402Version: 2, accepted: O, payload: { transaction: Buffer.from(tx.toBytes()).toString("base64") } } as PaymentPayload;
    };
    const row = V.V5.rows.find((r: { expect: { reason?: string }; mirror: { byId: unknown } }) => r.expect.reason === "instrument-live" && r.mirror.byId === null);
    node = await routes(mirrorOfRow(row));
    const calls: string[] = [];
    await start(LIST, [{ network: NETWORK, signer: signerStub(calls), mirror: node.url }]);
    expect(await settler!.settle(body(await frozen([3, 4])))).toMatchObject({ success: true, transaction: V.V2.expectTxIdText });
    expect(await settler!.settle(body(await frozen([3])))).toEqual({
      success: false,
      errorReason: "invalid_transaction_state",
      transaction: V.V2.expectTxIdText,
      network: NETWORK,
    });
    expect(calls.filter((c) => c === "signAndSubmitTransaction")).toHaveLength(1);
  });

  it("counts the fee the mirror shows once it holds the transaction, a few reads after the class's receipt, not the buyer's maxFee (lcp's V5 entry)", async () => {
    // The mirror ingests a transaction seconds after consensus: it answers 404 under the id twice, then V5's entry.
    const row = V.V5.rows[0];
    const entry = row.mirror.byId.find((e: { nonce: number; scheduled: boolean }) => e.nonce === 0 && !e.scheduled);
    let lookups = 0;
    node = await routes((path) => (path.startsWith("/api/v1/transactions/") && ++lookups <= 2 ? new Status(404, {}) : mirrorOfRow(row)(path)));
    const m = hederaModule({ network: NETWORK, signer: signerStub([]), mirror: node.url });
    const charged = await m.fees.charged!({ payload: v2(), requirements: O }, { transaction: V.V2.expectTxIdText, deadline: performance.now() + 5_000 });
    expect(charged).toEqual({ fee: BigInt(entry.charged_tx_fee), included: true });
    expect(entry.charged_tx_fee).not.toBe(Number(V.fixed.maxFee));
  });

  it("names V2's transaction id where the submission threw, which x402's class answers naming none, so the record holds it and the fee budget counts it", async () => {
    const row = V.V5.rows.find((r: { expect: { reason?: string }; mirror: { byId: unknown } }) => r.expect.reason === "instrument-live" && r.mirror.byId === null);
    node = await routes(mirrorOfRow(row));
    const calls: string[] = [];
    const signer: FacilitatorHederaSigner = {
      ...signerStub(calls),
      async signAndSubmitTransaction() {
        calls.push("signAndSubmitTransaction");
        // The SDK's execute reached a node, and its receipt query failed.
        throw new Error("receipt query failed");
      },
    };
    await start(LIST, [{ network: NETWORK, signer, mirror: node.url }]);
    expect(await settler!.settle(body(v2()))).toMatchObject({ success: false, transaction: V.V2.expectTxIdText, network: NETWORK });
    expect(calls.filter((c) => c === "signAndSubmitTransaction")).toHaveLength(1);
  });

  it("refuses at /verify V2 once the mirror shows its entry settled under the id (lcp's V5 row)", async () => {
    node = await routes(mirrorOfRow(V.V5.rows[0]));
    expect(V.V5.rows[0].expect.state).toBe("settled");
    await start(LIST, [{ network: NETWORK, signer: signerStub([]), mirror: node.url }]);
    expect(await settler!.verify(body(v2()))).toMatchObject({ isValid: false, invalidReason: "invalid_transaction_state" });
  });

  it("refuses lcp's refusal vectors before the class reads or signs anything", async () => {
    node = await routes(() => new Status(404, {}));
    const calls: string[] = [];
    await start(LIST, [{ network: NETWORK, signer: signerStub(calls), mirror: node.url }]);
    // V4x: a memo that is not H's LCP string; presentedOptions: V2 under options lcp's filter refuses.
    const rows: [PaymentPayload, string][] = [
      [{ x402Version: 2, accepted: O, payload: { transaction: V.V4x.transactionBase64 } }, "invalid_payload"],
      ...V.V2.presentedOptions
        .filter((r: { expect?: string }) => r.expect !== undefined)
        .map((r: { accepted: PaymentRequirements }): [PaymentPayload, string] => [v2(r.accepted), "invalid_payment_requirements"]),
    ];
    expect(rows.length).toBeGreaterThan(1);
    for (const [payload, reason] of rows) {
      expect(await settler!.verify(body(payload))).toMatchObject({ isValid: false, invalidReason: reason });
      expect(await settler!.settle(body(payload))).toMatchObject({ success: false, errorReason: reason, transaction: "" });
    }
    expect(calls).toEqual([]);
  });

  it("names the mirror by its origin alone in a failed call's error, which reaches the operator log", async () => {
    node = await routes(() => "x".repeat(NODE_MAX_BYTES));
    // A hosted mirror's path or query can hold the operator's API key.
    const keyed = `${node.url}/key-in-path/api/v1/blocks?apikey=key-in-query`;
    await expect(mirrorCall(keyed, performance.now() + 5_000)).rejects.toMatchObject({ message: `too-large: ${node.url}` });
    await expect(mirrorCall(keyed, performance.now() - 1)).rejects.toMatchObject({ message: `spent: ${node.url}` });
  });
});

describe("the Hedera module, x402/exact/hedera/transfer-executor, given one executor", () => {
  const PRESENTED: PaymentPayload = E.buyer.rows.find((r: { name: string }) => r.name === "B6").input.presented;
  const EXECUTOR: string = E.fixed.O.extra.executors[0];

  /** The executor signer: records the transaction it is given and answers its id. */
  function executorSigner(sent: ContractExecuteTransaction[]) {
    return {
      accountId: EXECUTOR_FEE_PAYER,
      async execute(tx: ContractExecuteTransaction) {
        sent.push(tx);
        return { transactionId: tx.transactionId!.toString() };
      },
    };
  }

  function startExecutor(sent: ContractExecuteTransaction[]) {
    const harness: ModuleStarter<readonly HederaConfig[]> = {
      name: "hedera",
      async start(config, core) {
        return {
          registrations: config.map((c) => ({
            network: NETWORK,
            module: transferExecutorModule(c, {
              executors: [EXECUTOR],
              signer: executorSigner(sent),
              gas: 400_000,
              maxFee: 1_000_000_000n,
              meter: core.meter(NETWORK),
              settleWaitMs: core.settleWaitMs,
            }),
            own: [],
          })),
        };
      },
    };
    return start([listed("hedera", async () => ({ starter: harness }))] as const, [{ network: NETWORK, signer: signerStub([]), mirror: node!.url }]);
  }

  /** A Mirror Node holding x402's example accounts (no alias, so each is its long-zero address) and the record `entries`. */
  function exampleMirror(entries: unknown) {
    return (path: string, _body: unknown, method: string) => {
      const account = /^\/api\/v1\/accounts\/0\.0\.(\d+)$/.exec(path);
      if (account) return { evm_address: `0x${BigInt(account[1]!).toString(16).padStart(40, "0")}` };
      if (path === "/api/v1/contracts/call" && method === "POST") return { result: "0x" };
      if (path.startsWith("/api/v1/transactions/")) return { transactions: entries };
      if (path.startsWith("/api/v1/contracts/results/")) return { logs: [] };
      if (path.startsWith("/api/v1/blocks")) return { blocks: [{ timestamp: { from: E.status.mirror.latest, to: E.status.mirror.latest } }] };
      return new Status(404, {});
    };
  }

  it("states the executor it is given, its relayer key and its fee payer", async () => {
    node = await routes(exampleMirror(null));
    await startExecutor([]);
    expect(await settler!.supported()).toMatchObject({
      kinds: [{ network: NETWORK, extra: { assetTransferMethod: "transferExecutor", executors: [EXECUTOR], key: "relayer", acceptsZero: [], pairings: ["x402/exact/hedera/transfer-executor"] } }],
      signers: { "hedera:*": [EXECUTOR_FEE_PAYER] },
    });
  });

  it("settles x402's example payment by executeTransfer on the executor, judged by x402's example record", async () => {
    node = await routes(exampleMirror(E.status.rows[0].entries));
    const sent: ContractExecuteTransaction[] = [];
    await startExecutor(sent);
    expect(await settler!.verify(body(PRESENTED))).toEqual({ isValid: true, payer: "0.0.5001" });
    const answer = (await settler!.settle(body(PRESENTED))) as { transaction: string };
    expect(sent).toHaveLength(1);
    expect(answer).toEqual({ success: true, transaction: sent[0]!.transactionId!.toString(), network: NETWORK, payer: "0.0.5001" });
    expect(sent[0]!.contractId!.toString()).toBe(EXECUTOR);
    // executeTransfer(from 0.0.5001, asset HBAR = address(0), to 0.0.4001, 100000000 tinybars, 0x0f2c9d1a): the selector
    // x402's specification states, then the ABI's head of five words and the bytes' length and content.
    expect(Buffer.from(sent[0]!.functionParameters!).toString("hex")).toBe(
      "ea8f19fd" +
        "0000000000000000000000000000000000000000000000000000000000001389" +
        "0000000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000fa1" +
        "0000000000000000000000000000000000000000000000000000000005f5e100" +
        "00000000000000000000000000000000000000000000000000000000000000a0" +
        "0000000000000000000000000000000000000000000000000000000000000004" +
        "0f2c9d1a00000000000000000000000000000000000000000000000000000000",
    );
    // The simulation ran from the fee payer's address, at the gas the transaction carries.
    const simulated = node.calls.find((c) => c.path === "/api/v1/contracts/call");
    expect(simulated?.body).toMatchObject({ from: `0x${(9000).toString(16).padStart(40, "0")}`, gas: sent[0]!.gas!.toNumber() });
  });

  it("refuses an executor it was not given before anything is simulated or sent", async () => {
    node = await routes(exampleMirror(E.status.rows[0].entries));
    const sent: ContractExecuteTransaction[] = [];
    await startExecutor(sent);
    // lcp's vector row: the payment names 0.0.7001, which the option does not list.
    const other = E.complete.find((r: { executor?: string }) => r.executor !== undefined).executor;
    const payload = { ...PRESENTED, payload: { ...(PRESENTED.payload as object), executor: other } };
    expect(await settler!.verify(body(payload))).toMatchObject({ isValid: false, invalidReason: "invalid_exact_hedera_executor_not_admitted" });
    expect(await settler!.settle(body(payload))).toMatchObject({ success: false, errorReason: "invalid_exact_hedera_executor_not_admitted" });
    expect([sent.length, node.calls.some((c) => c.path === "/api/v1/contracts/call")]).toEqual([0, false]);
  });

  it("answers a record that credits another account than the payee a failed settlement naming the transaction", async () => {
    const row = E.status.rows.find((r: { case: string }) => r.case.startsWith("the child credits 0.0.4002"));
    node = await routes(exampleMirror(row.entries));
    const sent: ContractExecuteTransaction[] = [];
    await startExecutor(sent);
    expect(await settler!.settle(body(PRESENTED))).toMatchObject({ success: false, transaction: sent[0]!.transactionId!.toString() });
  });
});
