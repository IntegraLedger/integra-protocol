// The Sui module (x402/exact/sui): lcp's vectors (lcp/vectors/x402-exact-sui.json) and the profile x402-exact-sui.md's
// rules through the module's verify, settle, record and read, against a local GraphQL node stub. Expected answers come
// from lcp's vectors (each refusal's code, the digest, every read row's answer), from x402's Sui scheme
// (scheme_exact_sui.md: its verification) and from the profile (the gas paths, an executed transaction judged by its
// effects); none from the module's own output. Every key is a throwaway key made here; recipe R is lcp's (its V2), built with each test's own sender.
import { readFileSync } from "node:fs";
import { exactSui } from "@integraledger/lcp/sui";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Inputs, Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Module } from "../src/module.js";
import { serveSettler } from "../src/core.js";
import { listed } from "../src/modules/index.js";
import { starter, suiModule } from "../src/modules/sui/index.js";
import { suiNode } from "../src/modules/sui/node.js";
import { memoryState, testCore } from "./own-core.js";
import { freshDatabase, onLockedPort, RawBody, stub, type Stub } from "./support.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-sui.json", import.meta.url), "utf8"));
const H = V.fixed.H as `0x${string}`;
const O: PaymentRequirements = { ...V.fixed.O };
const NETWORK = "sui:testnet";
const SUI = "0x2::sui::SUI";
const PAY_TO: string = V.fixed.payTo;

const buyer = Ed25519Keypair.generate();
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
const digestOf = (bytes: Uint8Array) => TransactionDataBuilder.getDigestFromBytes(bytes);
const rawH = () => Uint8Array.from(Buffer.from(H.slice(2), "hex"));
/** An object reference the stub's chain holds, by the byte its id repeats. */
const ref = (b: string, version = 3) => ({ objectId: `0x${b.repeat(32)}`, version: String(version), digest: V.V2.tx.digest });

/** Recipe R (the vectors' V2) with `sender`: H unused, 10000 split from the gas coin and sent to payTo, Epoch(epoch). */
async function recipeR(sender: string = buyer.toSuiAddress(), epoch: number = 1234): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.pure(rawH());
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(10000)]);
  tx.transferObjects([coin!], tx.pure.address(PAY_TO));
  tx.setGasPrice(1000);
  tx.setGasBudget(5000000);
  tx.setGasPayment([]);
  tx.setExpiration({ Epoch: epoch });
  return tx.build();
}

/** The gasless path's payment: `send_funds` of USDC to payTo, the gas data an empty payment, price 0 and budget 0. */
async function gasless(price = 0): Promise<Uint8Array> {
  const usdc = "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";
  const tx = new Transaction();
  tx.setSender(buyer.toSuiAddress());
  tx.pure(rawH());
  const [coin] = tx.splitCoins(tx.object(Inputs.ObjectRef(ref("c1"))), [tx.pure.u64(10000)]);
  tx.moveCall({ target: "0x2::coin::send_funds", typeArguments: [usdc], arguments: [coin!, tx.pure.address(PAY_TO)] });
  tx.setGasPrice(price);
  tx.setGasBudget(0);
  tx.setGasPayment([]);
  tx.setExpiration({ Epoch: 1234 });
  return tx.build();
}

async function signedBy(key: Ed25519Keypair, bytes: Uint8Array, accepted: PaymentRequirements = O): Promise<PaymentPayload> {
  const { signature } = await key.signTransaction(bytes);
  return { x402Version: 2, accepted, payload: { signature, transaction: toBase64(bytes) } };
}

// ── The node stub: Sui's GraphQL, its answers in the schema's shapes.

type Change = { owner: string; coinType: string; amount: string };
interface Landed {
  bytes: Uint8Array;
  status: "SUCCESS" | "FAILURE";
  checkpoint: number | null;
  changes: Change[];
}
interface ReaderRow {
  answer?: { tx: string; status: string; checkpoint: string | null; balanceChanges?: Change[] } | null;
  epoch?: string;
  firstCheckpoint?: string | null;
  searchRange?: { first: string; last: string; epoch: string };
  pages?: { transactions: { tx: string; status: string; checkpoint: string | null; balanceChanges?: Change[]; digest?: string }[]; hasNextPage: boolean; endCursor: string | null }[];
  readerError?: boolean;
}
interface Chain {
  executed: Map<string, Landed>;
  /** The simulation's effects: status and balance changes; or the node's refusal. */
  simulation: { status: "SUCCESS" | "FAILURE"; changes: Change[] } | "refused";
  latest: { checkpoint: number; epoch: number; price: string };
  coins: { objectId: string; version: number; balance: string }[];
  /** What execution gives: the checkpoint of the effects, null for none yet; the status and changes are the simulation's. */
  executeAt: number | null;
  /** Where execution differs from the simulation: a failed result, or the node's refusal. */
  executeAs?: "FAILURE" | "refused";
  reader?: ReaderRow;
  /** The node's index of objects by id: the version a key names (its digest), and the latest. Absent: holds neither. */
  objects?: Record<string, { at: { version: number; digest: string } | null; now: { version: number } | null }>;
  /** Called on each objects read: the chain may change between the module's reads. */
  onObjects?: () => void;
}

const TX: Record<string, string> = {
  V1: V.V1.tx.transactionBase64,
  V2: V.V2.tx.transactionBase64,
  ...Object.fromEntries(Object.entries(V.search as Record<string, { transactionBase64: string }>).map(([k, v]) => [k, v.transactionBase64])),
};
const credit = (amount = "10000", coinType = SUI): Change[] => [
  { owner: PAY_TO, coinType, amount },
  { owner: buyer.toSuiAddress(), coinType, amount: `-${amount}` },
];
const GAS = { gasSummary: { computationCost: 1000, storageCost: 2000, storageRebate: 500 } };
const effectsJson = (status: string, checkpoint: number | null, changes: Change[]) => ({
  status,
  checkpoint: checkpoint === null ? null : { sequenceNumber: checkpoint },
  balanceChangesJson: changes.map((c) => ({ address: c.owner, coinType: c.coinType, amount: c.amount })),
  gasEffects: GAS,
});

let chain: Chain;
let node: Stub | undefined;
let queries: { text: string; variables: Record<string, unknown> }[] = [];
let executions: { bytes: string; signatures: string[] }[] = [];
let searched = 0;

function latestJson() {
  return { sequenceNumber: chain.latest.checkpoint, epoch: { epochId: chain.latest.epoch, referenceGasPrice: chain.latest.price } };
}

function answer(text: string, v: Record<string, unknown>): unknown {
  const r = chain.reader;
  if (text.includes("serviceConfig") && r === undefined) {
    // The chain the module's own calls see: the transaction by its digest, the endpoint holding every checkpoint.
    const t = chain.executed.get(v["d"] as string);
    return {
      transaction: t === undefined ? null : { transactionBcs: toBase64(t.bytes), effects: effectsJson(t.status, t.checkpoint, t.changes) },
      checkpoint: { epoch: { epochId: chain.latest.epoch } },
      serviceConfig: { availableRange: { first: { sequenceNumber: 0 } }, sender: { first: null, last: null } },
    };
  }
  if (text.includes("serviceConfig")) {
    const a = r?.answer;
    const range = r?.searchRange;
    return {
      transaction:
        a === undefined || a === null
          ? null
          : { transactionBcs: TX[a.tx], effects: { status: a.status, checkpoint: a.checkpoint === null ? null : { sequenceNumber: Number(a.checkpoint) }, balanceChangesJson: (a.balanceChanges ?? []).map((c) => ({ address: c.owner, coinType: c.coinType, amount: c.amount })) } },
      checkpoint: { epoch: { epochId: Number(r?.epoch ?? "1234") } },
      serviceConfig: {
        availableRange: { first: r?.firstCheckpoint === undefined || r.firstCheckpoint === null ? null : { sequenceNumber: Number(r.firstCheckpoint) } },
        sender: range === undefined ? { first: null, last: null } : { first: { sequenceNumber: Number(range.first) }, last: { sequenceNumber: Number(range.last), epoch: { epochId: Number(range.epoch) } } },
      },
    };
  }
  if (text.includes("transactions(first")) {
    const page = r?.pages?.[searched++];
    if (page === undefined) throw new Error("no page");
    return {
      transactions: {
        pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
        nodes: page.transactions.map((t) => ({
          digest: t.digest ?? V.search[t.tx]?.digest ?? V.V2.tx.digest,
          transactionBcs: TX[t.tx],
          effects: { status: t.status, checkpoint: t.checkpoint === null ? null : { sequenceNumber: Number(t.checkpoint) }, balanceChangesJson: (t.balanceChanges ?? []).map((c) => ({ address: c.owner, coinType: c.coinType, amount: c.amount })) },
        })),
      },
    };
  }
  if (text.includes("multiGetObjects")) {
    chain.onObjects?.();
    const at = (v["at"] as { address: string; version: number }[]).map((k) => {
      const o = chain.objects?.[k.address]?.at;
      return o === undefined || o === null || o.version !== k.version ? null : o;
    });
    const now = (v["now"] as { address: string }[]).map((k) => chain.objects?.[k.address]?.now ?? null);
    return { at, now };
  }
  if (text.includes("simulateTransaction")) {
    if (chain.simulation === "refused") return "refused";
    return { simulateTransaction: { effects: effectsJson(chain.simulation.status, null, chain.simulation.changes) } };
  }
  if (text.includes("executeTransaction")) {
    const bytes = fromBase64(v["b"] as string);
    executions.push({ bytes: v["b"] as string, signatures: v["s"] as string[] });
    if (chain.simulation === "refused" || chain.executeAs === "refused") return "refused";
    const failedHere = chain.executeAs === "FAILURE";
    const landed = { bytes, status: failedHere ? ("FAILURE" as const) : chain.simulation.status, checkpoint: chain.executeAt, changes: failedHere ? [] : chain.simulation.changes };
    chain.executed.set(digestOf(bytes), landed);
    return { executeTransaction: { effects: effectsJson(landed.status, landed.checkpoint, landed.changes) } };
  }
  if (text.includes("objects(first")) {
    return {
      address: { objects: { nodes: chain.coins.map((c) => ({ address: c.objectId, version: c.version, digest: V.V2.tx.digest, contents: { json: { id: c.objectId, balance: c.balance } } })) } },
      checkpoint: latestJson(),
    };
  }
  if (text.includes("transaction(digest")) {
    const t = chain.executed.get(v["d"] as string);
    return {
      transaction: t === undefined ? null : { transactionBcs: toBase64(t.bytes), effects: effectsJson(t.status, t.checkpoint, t.changes) },
      checkpoint: latestJson(),
    };
  }
  throw new Error(`no answer for ${text}`);
}

async function startNode(): Promise<string> {
  node = await stub((_path, body) => {
    const { query, variables } = body as { query: string; variables: Record<string, unknown> };
    queries.push({ text: query, variables });
    // Sui GraphQL's maxQueryPayloadSize, 5000 on the public testnet and mainnet endpoints, counts the whole body.
    const size = JSON.stringify(body).length;
    if (size > 5000) return { data: null, errors: [{ message: `Query payload too large: ${size}B > 5000B` }] };
    if (chain.reader?.readerError === true) return new RawBody("<html>bad gateway</html>");
    const data = answer(query, variables);
    if (data === "refused") return { data: null, errors: [{ message: "Transaction validator signing failed" }] };
    return { data };
  });
  return node.url;
}

const kinds = () => queries.map((q) => /(serviceConfig|transactions\(first|simulateTransaction|executeTransaction|multiGetObjects|objects\(first|transaction\(digest)/.exec(q.text)?.[1]);

beforeEach(() => {
  chain = {
    executed: new Map(),
    simulation: { status: "SUCCESS", changes: credit() },
    latest: { checkpoint: 5, epoch: 1234, price: "1000" },
    coins: [{ objectId: `0x${"a1".repeat(32)}`, version: 7, balance: "1000000000" }],
    executeAt: 7,
  };
  queries = [];
  executions = [];
  searched = 0;
});
afterEach(async () => {
  await node?.close();
  node = undefined;
});

async function moduleOn(o: { settleWaitMs?: number } = {}) {
  const url = await startNode();
  const core = testCore({ state: memoryState(), ...(o.settleWaitMs === undefined ? {} : { settleWaitMs: o.settleWaitMs }) });
  return { module: suiModule({ network: NETWORK, graphql: url }, core) };
}

// The settler started with this module alone, through its HTTP surface, on a fresh database.
const CREDENTIAL = "own-a-sui-test";
const LIST = [listed("sui", async () => ({ starter }))] as const;
let db: Awaited<ReturnType<typeof freshDatabase>> | undefined;
let closeSettler: (() => Promise<void>) | undefined;
let base = "";
afterEach(async () => {
  await closeSettler?.();
  closeSettler = undefined;
  await db?.drop();
  db = undefined;
}, 60_000);

async function serve(): Promise<void> {
  const url = await startNode();
  db = await freshDatabase();
  const config = { network: NETWORK, graphql: url } as const;
  const { port, server } = await onLockedPort((p) =>
    serveSettler({ listen: `127.0.0.1:${p}`, store: { url: db!.url }, settleWaitMs: 5_000, credential: CREDENTIAL, sui: { networks: [config] } }, LIST),
  );
  closeSettler = server.close;
  base = `http://127.0.0.1:${port}`;
}

async function call(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${CREDENTIAL}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return res.json();
}
const request = (p: PaymentPayload, r: PaymentRequirements = O) => ({ x402Version: 2, paymentPayload: p, paymentRequirements: r });

describe("the Sui module through the settler's HTTP surface", () => {
  it("/supported states the kind: the pairing, no key, and zero", async () => {
    await serve();
    expect(await call("/supported")).toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { key: "none", pairings: ["x402/exact/sui"], acceptsZero: ["x402/exact/sui"] } }],
      extensions: [],
      // x402's class keys signers by CAIP family, an empty list where the module holds no key.
      signers: { "sui:*": [] },
    });
  });

  it("verifies and settles recipe R where the buyer pays gas: simulated with the payee's credit, executed with the buyer's one signature", async () => {
    await serve();
    const bytes = await recipeR();
    const p = await signedBy(buyer, bytes);
    expect(await exactSui.bound(p as never)).toBe(V.V2.expectBound);
    expect(await call("/verify", request(p))).toEqual({ isValid: true, payer: buyer.toSuiAddress() });
    expect(queries.find((q) => q.text.includes("simulateTransaction"))!.variables["t"]).toEqual({ bcs: { value: toBase64(bytes) } });
    expect(await call("/settle", request(p))).toEqual({ success: true, transaction: digestOf(bytes), network: NETWORK, payer: buyer.toSuiAddress() });
    expect(executions).toEqual([{ bytes: toBase64(bytes), signatures: [(p.payload as { signature: string }).signature] }]);
  });

  it("answers a payment lcp refuses with lcp's code as x402's invalidMessage and errorMessage (lcp's V1)", async () => {
    await serve();
    const p = { x402Version: 2, accepted: O, payload: { signature: "AAAA", transaction: V.V1.tx.transactionBase64 } } as PaymentPayload;
    const code = V.V1.expectBound as string;
    expect(await call("/verify", request(p))).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: code });
    expect(await call("/settle", request(p))).toEqual({ success: false, errorReason: "invalid_payload", errorMessage: code, transaction: "", network: NETWORK });
  });

  it("judges a transaction the buyer already executed by its effects at /verify, and answers its /settle a failure naming it", async () => {
    await serve();
    const bytes = await recipeR();
    chain.executed.set(digestOf(bytes), { bytes, status: "SUCCESS", checkpoint: 4, changes: credit() });
    const p = await signedBy(buyer, bytes);
    expect(await call("/verify", request(p))).toEqual({ isValid: true, payer: buyer.toSuiAddress() });
    expect(kinds()).not.toContain("simulateTransaction");
    expect(await call("/settle", request(p))).toMatchObject({ success: false, errorReason: "invalid_transaction_state", transaction: digestOf(bytes), network: NETWORK });
    expect(executions).toEqual([]);
  });
});

describe("a zero transfer on Sui testnet", () => {
  // The transaction, its signature and its effects as Sui testnet's GraphQL endpoint gave them (the fixture names it).
  const Z = JSON.parse(readFileSync(new URL("./fixtures/sui-testnet-zero-transfer.json", import.meta.url), "utf8"));
  const SENDER = Z.effects.balanceChangesJson[0].address as string;
  const option: PaymentRequirements = {
    scheme: "exact",
    network: NETWORK,
    amount: "0",
    asset: SUI,
    payTo: "0x383ccd22e2e9effdecc30de0b6169f7ff8445e46d1fa163d6cbb3dbf4b00a140",
    maxTimeoutSeconds: 60,
    extra: {},
  };

  it("verifies, where the buyer pays gas, the transfer of 0 to the payee it executed, whose only balance change is its own gas", async () => {
    await serve();
    const bytes = fromBase64(Z.transactionBcs);
    expect(digestOf(bytes)).toBe(Z.digest);
    const changes = Z.effects.balanceChangesJson.map((c: { address: string; coinType: string; amount: string }) => ({ owner: c.address, coinType: c.coinType, amount: c.amount }));
    chain.executed.set(Z.digest, { bytes, status: Z.effects.status, checkpoint: Z.effects.checkpoint.sequenceNumber, changes });
    const p: PaymentPayload = { x402Version: 2, accepted: option, payload: { signature: Z.signatures[0], transaction: Z.transactionBcs } };
    expect(await call("/verify", request(p, option))).toEqual({ isValid: true, payer: SENDER });
  });
});

describe("lcp's vectors refused before anything is read", () => {
  it("V1, V3 and the agreed refusals' transactions: lcp's code, nothing read", async () => {
    const { module: m } = await moduleOn();
    const rows: [string, string][] = [
      [V.V1.tx.transactionBase64, V.V1.expectBound],
      ...(V.V3 as { tx?: { transactionBase64: string }; zeroBytes?: number; expectBound: string }[])
        .filter((r) => !r.expectBound.startsWith("0x"))
        .map((r): [string, string] => [r.tx?.transactionBase64 ?? toBase64(new Uint8Array(r.zeroBytes!)), r.expectBound]),
      ...(V.agreedRefusals.rows as { transaction?: unknown; expect: string }[])
        .filter((r) => typeof r.transaction === "string")
        .map((r): [string, string] => [r.transaction as string, r.expect]),
    ];
    for (const [transaction, code] of rows) {
      const p = { x402Version: 2, accepted: O, payload: { signature: "AAAA", transaction } };
      expect(await m.facilitator.verify(p, O), code).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: code });
      expect(await m.facilitator.settle(p, O), code).toEqual({ success: false, errorReason: "invalid_payload", errorMessage: code, transaction: "", network: NETWORK });
      expect(await m.record.instrument({ payload: p, requirements: O })).toEqual({ refused: "invalid_payload", message: code });
    }
    const empty = { x402Version: 2, accepted: O, payload: { signature: "", transaction: V.V2.tx.transactionBase64 } };
    expect(await m.facilitator.verify(empty, O)).toEqual({ isValid: false, invalidReason: "invalid_payload", invalidMessage: "x402/signature-malformed" });
    expect(queries).toEqual([]);
  });

  it("the filter's refused options: lcp's code, the requirements' fault", async () => {
    const { module: m } = await moduleOn();
    for (const row of (V.filter.rows as { case: string; change: { amount?: string; extra?: Record<string, unknown> }; expect: true | string }[]).filter((r) => r.expect !== true)) {
      const o = { ...O, ...(row.change.amount === undefined ? {} : { amount: row.change.amount }), ...(row.change.extra === undefined ? {} : { extra: row.change.extra }) } as PaymentRequirements;
      expect(await m.facilitator.verify(await signedBy(buyer, await recipeR(), o), o), row.case).toEqual({ isValid: false, invalidReason: "invalid_payment_requirements", invalidMessage: row.expect });
    }
    expect(queries).toEqual([]);
  });

  it("keys V2 and the validity rows by the digest the vectors give, kept for the settler's life, reading nothing", async () => {
    const { module: m } = await moduleOn();
    for (const row of [V.V2, ...V.validity.rows]) {
      const p = { x402Version: 2, accepted: O, payload: { signature: "AAAA", transaction: row.tx.transactionBase64 } };
      expect(await m.record.instrument({ payload: p, requirements: O })).toEqual({
        pairing: "x402/exact/sui",
        instrument: { by: "transaction", network: NETWORK, transaction: row.tx.digest },
        nonce: "single-use",
        keep: { until: "settler" },
      });
    }
    expect(queries).toEqual([]);
  });
});

describe("the gasless path", () => {
  const GASLESS: PaymentRequirements = { ...O, asset: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC", extra: { gasless: true } };
  it("accepts gas data of an empty payment, price 0 and budget 0", async () => {
    chain.simulation = { status: "SUCCESS", changes: credit("10000", GASLESS.asset) };
    const { module: m } = await moduleOn();
    expect(await m.facilitator.verify(await signedBy(buyer, await gasless(), GASLESS), GASLESS)).toEqual({ isValid: true, payer: buyer.toSuiAddress() });
  });
});

describe("lcp's read vectors (V4) through the module's reader", () => {
  for (const row of V.V4.status as (ReaderRow & { case: string; tx?: string; untilEpoch?: string; refNetwork?: string; readerNetwork?: string; query?: { search?: string; act?: string; others?: unknown[] }; expect: unknown })[]) {
    it(`V4: ${row.case}`, async () => {
      chain.reader = row;
      const url = await startNode();
      const own = row.tx === undefined ? {} : { digest: V.search[row.tx].digest, untilEpoch: row.untilEpoch };
      const ref = { ...V.V4.ref, payee: PAY_TO, sender: V.fixed.sender, network: row.refNetwork ?? V.V4.ref.network, ...own };
      const reader = suiNode((row.readerNetwork ?? V.V4.ref.network) as never, url).reader(performance.now() + 10_000);
      const q = { act: "payment", finality: "final", after: BigInt(V.V4.position), ...row.query, ...(row.query?.search === undefined ? {} : { search: BigInt(row.query.search) }) };
      expect(plain(await exactSui.status(ref, reader, q as never))).toEqual(row.expect);
    });
  }
});

describe("an input the buyer has spent since signing (row 12)", () => {
  // Sui's simulation takes an owned input at its latest version and answers success for a gas coin the buyer has since
  // spent; execution refuses it ("object … version 0x8 … is unavailable for consumption, current version: 0x9", a Sui
  // localnet, sui 1.84.2). The node's index (`multiGetObjects`) is the oracle the module reads instead.
  const GAS_ID = `0x${"a1".repeat(32)}`;
  const DIGEST = V.V2.tx.digest as string;
  /** Recipe R paying gas with the coin `GAS_ID` at version 7. */
  async function withGasCoin(): Promise<Uint8Array> {
    const tx = new Transaction();
    tx.setSender(buyer.toSuiAddress());
    tx.pure(rawH());
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(10000)]);
    tx.transferObjects([coin!], tx.pure.address(PAY_TO));
    tx.setGasPrice(1000);
    tx.setGasBudget(5000000);
    tx.setGasPayment([ref("a1", 7)]);
    tx.setExpiration({ Epoch: 1234 });
    return tx.build();
  }
  const refused = { isValid: false, invalidReason: "invalid_transaction", invalidMessage: "sui/object-version-unavailable" };

  it("refuses at /verify and /settle a gas coin the index shows at a later version, simulating and executing nothing", async () => {
    chain.objects = { [GAS_ID]: { at: { version: 7, digest: DIGEST }, now: { version: 8 } } };
    const { module: m } = await moduleOn();
    const p = await signedBy(buyer, await withGasCoin());
    expect(await m.facilitator.verify(p, O)).toEqual(refused);
    expect(queries.find((q) => q.text.includes("multiGetObjects"))!.variables).toEqual({ at: [{ address: GAS_ID, version: 7 }], now: [{ address: GAS_ID }] });
    expect(await m.facilitator.settle(p, O)).toEqual({ success: false, errorReason: "invalid_transaction", errorMessage: "sui/object-version-unavailable", transaction: "", network: NETWORK });
    expect(kinds()).not.toContain("simulateTransaction");
    expect(executions).toEqual([]);
  });

  it("refuses a gas coin the index no longer holds as live (merged away), though it holds the version named", async () => {
    chain.objects = { [GAS_ID]: { at: { version: 7, digest: DIGEST }, now: null } };
    const { module: m } = await moduleOn();
    expect(await m.facilitator.verify(await signedBy(buyer, await withGasCoin()), O)).toEqual(refused);
  });

  it("refuses a reference whose version the index holds under another digest", async () => {
    chain.objects = { [GAS_ID]: { at: { version: 7, digest: "11111111111111111111111111111111" }, now: { version: 7 } } };
    const { module: m } = await moduleOn();
    expect(await m.facilitator.verify(await signedBy(buyer, await withGasCoin()), O)).toEqual(refused);
  });

  it("refuses an owned input other than gas the buyer has spent (the gasless path's coin)", async () => {
    const GASLESS: PaymentRequirements = { ...O, asset: "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC", extra: { gasless: true } };
    chain.simulation = { status: "SUCCESS", changes: credit("10000", GASLESS.asset) };
    chain.objects = { [`0x${"c1".repeat(32)}`]: { at: { version: 3, digest: DIGEST }, now: { version: 4 } } };
    const { module: m } = await moduleOn();
    expect(await m.facilitator.verify(await signedBy(buyer, await gasless(), GASLESS), GASLESS)).toEqual(refused);
  });

  it("twin: verifies and settles the same payment while its gas coin is still at the version named", async () => {
    chain.objects = { [GAS_ID]: { at: { version: 7, digest: DIGEST }, now: { version: 7 } } };
    const { module: m } = await moduleOn();
    const bytes = await withGasCoin();
    const p = await signedBy(buyer, bytes);
    expect(await m.facilitator.verify(p, O)).toEqual({ isValid: true, payer: buyer.toSuiAddress() });
    expect(kinds()).toContain("simulateTransaction");
    expect(await m.facilitator.settle(p, O)).toEqual({ success: true, transaction: digestOf(bytes), network: NETWORK, payer: buyer.toSuiAddress() });
  });

  it("twin: an index that does not yet hold the version named shows nothing, and the simulation decides", async () => {
    chain.objects = { [GAS_ID]: { at: null, now: { version: 6 } } };
    const { module: m } = await moduleOn();
    expect(await m.facilitator.verify(await signedBy(buyer, await withGasCoin()), O)).toEqual({ isValid: true, payer: buyer.toSuiAddress() });
  });

  it("reads every one of 40 gas coins in requests within the endpoint's 5000-byte payload, refusing the last one spent", async () => {
    const ids = Array.from({ length: 40 }, (_, k) => `0x${(k + 1).toString(16).padStart(64, "0")}`);
    const tx = new Transaction();
    tx.setSender(buyer.toSuiAddress());
    tx.pure(rawH());
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(10000)]);
    tx.transferObjects([coin!], tx.pure.address(PAY_TO));
    tx.setGasPrice(1000);
    tx.setGasBudget(5000000);
    tx.setGasPayment(ids.map((objectId) => ({ objectId, version: "1234567890", digest: DIGEST })));
    tx.setExpiration({ Epoch: 1234 });
    const p = await signedBy(buyer, await tx.build());
    chain.objects = Object.fromEntries(ids.map((id) => [id, { at: { version: 1234567890, digest: DIGEST }, now: { version: 1234567890 } }]));
    const { module: m } = await moduleOn();
    expect(await m.facilitator.verify(p, O)).toEqual({ isValid: true, payer: buyer.toSuiAddress() });
    const reads = queries.filter((q) => q.text.includes("multiGetObjects"));
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.flatMap((q) => (q.variables["now"] as { address: string }[]).map((k) => k.address))).toEqual(ids);
    chain.objects[ids[39]!] = { at: { version: 1234567890, digest: DIGEST }, now: { version: 1234567891 } };
    expect(await m.facilitator.verify(p, O)).toEqual(refused);
  });

  it("judges by its effects a payment that itself moved the coin between the module's two reads", async () => {
    const bytes = await withGasCoin();
    chain.objects = { [GAS_ID]: { at: { version: 7, digest: DIGEST }, now: { version: 8 } } };
    chain.onObjects = () => chain.executed.set(digestOf(bytes), { bytes, status: "SUCCESS", checkpoint: 6, changes: credit() });
    const { module: m } = await moduleOn();
    expect(await m.facilitator.verify(await signedBy(buyer, bytes), O)).toEqual({ isValid: true, payer: buyer.toSuiAddress() });
    expect(kinds()).not.toContain("simulateTransaction");
  });
});
