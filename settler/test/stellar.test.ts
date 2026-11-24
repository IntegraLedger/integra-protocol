// The Stellar module (x402/exact/stellar/precondition): lcp's vectors (lcp/vectors/x402-exact-stellar-precondition.json)
// through the settler's /supported, /verify and /settle over HTTP, against a local Stellar RPC stub answering in Stellar
// RPC's schema. Expected answers come from lcp's vectors (the payment, the envelope the buyer presents, the payload's
// signature and its hint, each refusal's code), from lcp's read of what the settler submitted, from lcp's profile
// x402-exact-stellar-precondition.md and from x402's Stellar scheme (scheme_exact_stellar.md) and its facilitator's
// reasons; none is taken from the module's own output. The source account's key is a throwaway key made here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PASSPHRASE } from "@integraledger/lcp/stellar";
import { exactStellarPrecondition } from "@integraledger/lcp/x402-exact-stellar";
import { Keypair, StrKey, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk/base";
import type { ScValWire, TransactionEnvelopeWire } from "@stellar/stellar-sdk/xdr";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveSettler } from "../src/core.js";
import type { Core } from "../src/module.js";
import { listed } from "../src/modules/index.js";
import { starter, stellarModule, type StellarSigner } from "../src/modules/stellar/index.js";
import { freshDatabase, onLockedPort, stub, until, type Stub } from "./support.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-stellar-precondition.json", import.meta.url), "utf8"));
const NETWORK = "stellar:testnet" as const;
const PASS = PASSPHRASE[NETWORK];
const OPTION: PaymentRequirements = V.fixed.option;
const PAYMENT: PaymentPayload = V.build.expectPayment;
const PRESENTED: string = V.build.expectEnvelope;
const CREDENTIAL = "settler-test-credential";
/** The vectors' buyer, from the Ed25519 seed 05×32 the file's `about` names. */
const BUYER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));

const source = Keypair.random();
const signer: StellarSigner = {
  address: source.publicKey(),
  async signTransaction(envelope, opts) {
    const tx = TransactionBuilder.fromXDR(envelope, opts?.networkPassphrase ?? PASS);
    tx.sign(source);
    return { signedTxXdr: tx.toXDR() };
  },
};

/** What the core gives the module where a test reads it directly: no log, a fee meter that allows every send. */
const bareCore = (): Core => ({
  log: () => {},
  settleWaitMs: 5_000,
  state: undefined as never,
  meter: () => ({ sending: async () => true, included: () => {}, sent: () => {} }),
  naming: async () => async () => {},
});

const envelopeWire = (b64: string): TransactionEnvelopeWire => xdr.TransactionEnvelope.fromXdr(b64, "base64").toXdrObject();
const envelopeB64 = (w: TransactionEnvelopeWire): string => xdr.TransactionEnvelope.fromXdrObject(w).toXdr("base64");
const scval = (v: ScValWire): string => xdr.ScVal.fromXdrObject(v).toXdr("base64");
const account = (g: string): ScValWire => ({ type: 18, address: { type: 0, accountId: { type: 0, ed25519: StrKey.decodeEd25519PublicKey(g) } } });
const hashOf = (envelope: string): string => Buffer.from(new Transaction(envelope, PASS).hash()).toString("hex");
const withTransaction = (p: PaymentPayload, transaction: string): PaymentPayload => ({ ...structuredClone(p), payload: { transaction } });

// ── The node stub: Stellar RPC's JSON-RPC methods, its answers in that schema. A transaction sent lands at the next
// ledger, at application order 1, and its transfer emits the Stellar Asset Contract's `transfer` event (CAP-67).

interface Landed {
  envelope: string;
  ledger: number;
  status: "SUCCESS" | "FAILED";
  /** The transfer its event shows: from, to, amount. */
  transfer: { from: string; to: string; amount: bigint };
}
interface Chain {
  latest: number;
  sourceSeq: bigint;
  /** The simulation: its error where it fails, else the transfer its event shows. */
  simulation: { error: string } | { transfer: { from: string; to: string; amount: bigint } };
  minResourceFee: bigint;
  feeCharged: bigint;
  landed: Map<string, Landed>;
}

let chain: Chain;
let node: Stub;
let sent: string[];

/** A Stellar Asset Contract's `transfer` event: topics `transfer`, from, to and the asset's name, data the `i128` amount. */
function transferEvent(t: { from: string; to: string; amount: bigint }) {
  return {
    topics: [{ type: 15, sym: new xdr.XdrString("transfer") }, account(t.from), account(t.to), { type: 14, str: new xdr.XdrString("native") }] as ScValWire[],
    data: { type: 10, i128: { hi: 0n, lo: t.amount } } as ScValWire,
  };
}

function rpc(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "getNetwork":
      return { passphrase: PASS, protocolVersion: 23 };
    case "getLatestLedger":
      return { id: "0".repeat(64), protocolVersion: 23, sequence: chain.latest };
    case "getLedgerEntries": {
      const data = xdr.LedgerEntryData.fromXdrObject({
        type: 0,
        account: {
          accountId: { type: 0, ed25519: source.rawPublicKey() },
          balance: 100_000_000n,
          seqNum: chain.sourceSeq,
          numSubEntries: 0,
          inflationDest: null,
          flags: 0,
          homeDomain: new xdr.XdrString(""),
          thresholds: Uint8Array.from([1, 0, 0, 0]),
          signers: [],
          ext: { v: 0 },
        },
      });
      return { entries: [{ key: (params["keys"] as string[])[0], xdr: data.toXdr("base64"), lastModifiedLedgerSeq: chain.latest }], latestLedger: chain.latest };
    }
    case "simulateTransaction": {
      const s = chain.simulation;
      if ("error" in s) return { latestLedger: chain.latest, error: s.error };
      const ev = transferEvent(s.transfer);
      const event = xdr.DiagnosticEvent.fromXdrObject({
        inSuccessfulContractCall: true,
        event: { ext: { v: 0 }, contractId: StrKey.decodeContract(OPTION.asset), type: 1, body: { v: 0, v0: { topics: ev.topics, data: ev.data } } },
      });
      const data = xdr.SorobanTransactionData.fromXdrObject({
        ext: { v: 0 },
        resources: { footprint: { readOnly: [], readWrite: [] }, instructions: 1_000_000, diskReadBytes: 0, writeBytes: 0 },
        resourceFee: chain.minResourceFee,
      });
      return {
        latestLedger: chain.latest,
        minResourceFee: chain.minResourceFee.toString(),
        transactionData: data.toXdr("base64"),
        events: [event.toXdr("base64")],
        results: [{ auth: [], xdr: scval({ type: 1 }) }],
      };
    }
    case "sendTransaction": {
      const envelope = params["transaction"] as string;
      sent.push(envelope);
      const hash = hashOf(envelope);
      const op = envelopeWire(envelope);
      if (op.type !== 2) throw new Error("not a v1 envelope");
      const body = op.v1.tx.operations[0]!.body;
      if (body.type !== 24 || body.invokeHostFunctionOp.hostFunction.type !== 0) throw new Error("not an invocation");
      const [from, to, amount] = body.invokeHostFunctionOp.hostFunction.invokeContract.args as [ScValWire, ScValWire, ScValWire];
      const g = (v: ScValWire) => (v.type === 18 && v.address.type === 0 && v.address.accountId.type === 0 ? StrKey.encodeEd25519PublicKey(Buffer.from(v.address.accountId.ed25519)) : "");
      const lo = amount.type === 10 ? amount.i128.lo : -1n;
      chain.landed.set(hash, { envelope, ledger: chain.latest + 1, status: "SUCCESS", transfer: { from: g(from), to: g(to), amount: lo } });
      return { status: "PENDING", hash, latestLedger: chain.latest, latestLedgerCloseTime: "0" };
    }
    case "getTransaction": {
      const t = chain.landed.get(params["hash"] as string);
      const range = { oldestLedger: 1, latestLedger: Math.max(chain.latest, t?.ledger ?? 0) };
      if (t === undefined) return { status: "NOT_FOUND", ...range };
      const result = xdr.TransactionResult.fromXdrObject({
        feeCharged: chain.feeCharged,
        result: { code: 0, results: [{ code: 0, tr: { type: 24, invokeHostFunctionResult: { code: 0, success: new Uint8Array(32) } } }] },
        ext: { v: 0 },
      });
      return { status: t.status, ledger: t.ledger, applicationOrder: 1, envelopeXdr: t.envelope, resultXdr: result.toXdr("base64"), createdAt: "0", ...range };
    }
    case "getEvents": {
      const start = params["startLedger"] as number;
      const end = (params["endLedger"] as number) - 1;
      const events = [...chain.landed.entries()]
        .filter(([, t]) => t.status === "SUCCESS" && t.ledger >= start && t.ledger <= end)
        .map(([hash, t]) => {
          const ev = transferEvent(t.transfer);
          const toid = (BigInt(t.ledger) << 32n) | (1n << 12n) | 1n;
          return {
            type: "contract",
            ledger: t.ledger,
            ledgerClosedAt: "1970-01-01T00:00:00Z",
            contractId: OPTION.asset,
            id: `${toid.toString().padStart(19, "0")}-0000000000`,
            inSuccessfulContractCall: true,
            txHash: hash,
            topic: ev.topics.map(scval),
            value: scval(ev.data),
          };
        });
      return { events, latestLedger: chain.latest, oldestLedger: 1, cursor: "" };
    }
  }
  throw new Error(`no stub answer for ${method}`);
}

function methods(): string[] {
  return node.calls.map((c) => (c.body as { method: string }).method);
}

// ── The settler, started with the Stellar module alone.

let settler: { close(): Promise<void> } | undefined;
let db: Awaited<ReturnType<typeof freshDatabase>>;
let base = "";

async function call(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${CREDENTIAL}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(res.status).toBe(200);
  return res.json();
}
const verify = (paymentPayload: unknown, paymentRequirements: unknown = OPTION) => call("/verify", { x402Version: 2, paymentPayload, paymentRequirements });
const settle = (paymentPayload: unknown, paymentRequirements: unknown = OPTION) => call("/settle", { x402Version: 2, paymentPayload, paymentRequirements });

beforeEach(async () => {
  chain = {
    latest: 990,
    sourceSeq: 4_000_000_000n,
    simulation: { transfer: { from: V.fixed.buyer, to: OPTION.payTo, amount: BigInt(OPTION.amount) } },
    minResourceFee: 41_000n,
    feeCharged: 38_250n,
    landed: new Map(),
  };
  sent = [];
  node = await stub((_path, body) => {
    const b = body as { id: number; method: string; params: Record<string, unknown> };
    return { jsonrpc: "2.0", id: b.id, result: rpc(b.method, b.params ?? {}) };
  });
  db = await freshDatabase();
  const started = await onLockedPort((port) =>
    serveSettler(
      {
        listen: `127.0.0.1:${port}`,
        store: { url: db.url },
        settleWaitMs: 5_000,
        credential: CREDENTIAL,
        feeBudgets: [{ network: NETWORK, amount: 10_000_000n, periodSeconds: 3_600 }],
        operatorLog: () => {},
        stellar: { networks: [{ network: NETWORK, rpc: node.url, source: signer }] },
      },
      [listed("stellar", async () => ({ starter }))] as const,
    ),
  );
  settler = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

afterEach(async () => {
  await settler?.close();
  await node.close();
  await db.drop();
});

describe("the Stellar module through the settler's HTTP surface", () => {
  it("/supported states the kind: the pairing it submits, a relayer key, zero taken, and the source account as signer", async () => {
    const s = (await call("/supported")) as { kinds: { network: string; extra: Record<string, unknown> }[]; signers: Record<string, string[]> };
    expect(s.kinds).toContainEqual({
      x402Version: 2,
      scheme: "exact",
      network: NETWORK,
      extra: { areFeesSponsored: true, key: "relayer", acceptsZero: [exactStellarPrecondition.id], pairings: [exactStellarPrecondition.id], feeBudget: true },
    });
    expect(s.signers["stellar:*"]).toEqual([source.publicKey()]);
  });

  it("verifies lcp's payment: the presented transaction simulated as presented, its buyer named", async () => {
    expect(await verify(PAYMENT)).toEqual({ isValid: true, payer: V.fixed.buyer });
    const simulated = node.calls.find((c) => (c.body as { method: string }).method === "simulateTransaction");
    expect((simulated?.body as { params: { transaction: string } }).params.transaction).toBe(PRESENTED);
    expect(methods()).not.toContain("sendTransaction");
  });

  it("settles lcp's payment as the transaction's source, the buyer's preconditions, operation and payload signature carried, and lcp's read holds it", async () => {
    const answer = (await settle(PAYMENT)) as { success: boolean; transaction: string };
    expect(sent).toHaveLength(1);
    const hash = hashOf(sent[0]!);
    expect(answer).toEqual({ success: true, transaction: hash, network: NETWORK, payer: V.fixed.buyer });

    const out = envelopeWire(sent[0]!);
    const was = envelopeWire(PRESENTED);
    if (out.type !== 2 || was.type !== 2) throw new Error("not v1 envelopes");
    const bytes = (v: unknown, t: { fromXdrObject(w: never): { toXdr(f: "base64"): string } }) => t.fromXdrObject(v as never).toXdr("base64");
    // The source, its next sequence number and the fee are the settler's; the rest is the buyer's, byte for byte.
    expect(StrKey.encodeEd25519PublicKey(Buffer.from((out.v1.tx.sourceAccount as { ed25519: Uint8Array }).ed25519))).toBe(source.publicKey());
    expect(out.v1.tx.seqNum).toBe(chain.sourceSeq + 1n);
    expect(out.v1.tx.fee).toBe(Number(chain.minResourceFee) + 100);
    expect(bytes(out.v1.tx.cond, xdr.Preconditions)).toBe(bytes(was.v1.tx.cond, xdr.Preconditions));
    expect(bytes(out.v1.tx.memo, xdr.Memo)).toBe(bytes(was.v1.tx.memo, xdr.Memo));
    expect(bytes(out.v1.tx.operations[0], xdr.Operation)).toBe(bytes(was.v1.tx.operations[0], xdr.Operation));
    // Two signatures: the source account's over the transaction, and the buyer's of the 40-byte payload, as lcp's
    // vectors give it (its hint the key's last 4 bytes XOR the payload's last 4).
    const sigs = out.v1.signatures.map((s) => ({ hint: Buffer.from(s.hint).toString("hex"), signature: Buffer.from(s.signature).toString("hex") }));
    expect(sigs).toHaveLength(2);
    expect(sigs).toContainEqual({ hint: V.payload[0].hint.slice(2), signature: V.build.payloadSignature });
    const own = sigs.find((s) => s.signature !== V.build.payloadSignature)!;
    expect(source.verify(Buffer.from(new Transaction(sent[0]!, PASS).hash()), Buffer.from(own.signature, "hex"))).toBe(true);

    // Once its ledger closes, lcp's read of the instrument finds the landed transaction and holds it to the profile's five checks.
    chain.latest += 1;
    const module = stellarModule({ network: NETWORK, rpc: node.url, source: signer }, bareCore());
    const read = await module.record.read({ payload: PAYMENT, requirements: OPTION }, { deadline: performance.now() + 5_000 });
    expect(read).toMatchObject({ outcome: "final", answer: { state: "settled", transaction: hash, presented: "yes" } });

    // The fee went to the network's count: the transaction's bound before it was sent, the fee charged once included.
    await until(async () => (await db.pool.query("SELECT 1 FROM fee WHERE included")).rowCount === 1);
    const fees = await db.pool.query<{ transaction: string; fee: string }>("SELECT transaction, fee::text FROM fee");
    expect(fees.rows).toEqual([{ transaction: hash, fee: chain.feeCharged.toString() }]);
  });

  it("settles lcp's zero amount, the agreement's floor, built by lcp's client from the vectors' simulated transaction", async () => {
    const zero = { ...OPTION, amount: "0" };
    const sim = envelopeWire(V.build.simulatedXdr);
    if (sim.type !== 2) throw new Error("not a v1 envelope");
    const body = sim.v1.tx.operations[0]!.body;
    if (body.type !== 24 || body.invokeHostFunctionOp.hostFunction.type !== 0) throw new Error("not an invocation");
    const fn = body.invokeHostFunctionOp.auth[0]!.rootInvocation.function;
    if (fn.type !== 0) throw new Error("not a contract call");
    for (const args of [body.invokeHostFunctionOp.hostFunction.invokeContract.args, fn.contractFn.args]) args[2] = { type: 10, i128: { hi: 0n, lo: 0n } };
    const required = exactStellarPrecondition.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [zero as never] }, V.fixed.H, V.fixed.link, zero as never);
    if ("refused" in required) throw new Error(required.code);
    const u = await exactStellarPrecondition.build({ required, accepted: zero as never, simulatedXdr: envelopeB64(sim), currentLedger: V.build.currentLedger, payer: V.fixed.buyer }, V.fixed.H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ entry: BUYER.sign(createHash("sha256").update(u.request.preimage).digest()), payload: BUYER.sign(Buffer.from(u.request.payload)) });
    if ("refused" in p) throw new Error(p.code);
    chain.simulation = { transfer: { from: V.fixed.buyer, to: OPTION.payTo, amount: 0n } };
    const answer = await settle(p, zero);
    expect(sent).toHaveLength(1);
    expect(answer).toEqual({ success: true, transaction: hashOf(sent[0]!), network: NETWORK, payer: V.fixed.buyer });
  });

  it("refuses each of lcp's refusal vectors before anything is read, with lcp's code", async () => {
    const module = stellarModule({ network: NETWORK, rpc: node.url, source: signer }, bareCore());
    const rows: { payment: PaymentPayload; requirements: PaymentRequirements; reason: string; code: string }[] = [
      // The envelope with one member changed: the payload's fault.
      ...V.refusedBound.map((r: { envelope: string; expect: string }) => ({ payment: withTransaction(PAYMENT, r.envelope), requirements: OPTION, reason: "invalid_payload", code: r.expect })),
      // The option with one member changed, the payment echoing it: the requirements' fault.
      ...V.boundAccepted.rows.map((r: { accepted: PaymentRequirements; expect: string }) => ({ payment: { ...PAYMENT, accepted: r.accepted }, requirements: r.accepted, reason: "invalid_payment_requirements", code: r.expect })),
      // Requirements other than the option the payment answers: the payload's fault.
      ...V.refusedReference.map((r: { change: Partial<PaymentRequirements>; expect: string }) => ({ payment: PAYMENT, requirements: { ...OPTION, ...r.change }, reason: "invalid_payload", code: r.expect })),
    ];
    for (const r of rows) {
      expect(await verify(r.payment, r.requirements), r.code).toEqual({ isValid: false, invalidReason: r.reason });
      expect(await settle(r.payment, r.requirements), r.code).toMatchObject({ success: false, errorReason: r.reason, transaction: "" });
      expect(await module.facilitator.verify(r.payment, r.requirements), r.code).toEqual({ isValid: false, invalidReason: r.reason, invalidMessage: r.code });
    }
    expect(node.calls).toEqual([]);
  });

  it("refuses an entry with source-account credentials, which the settler's signature would authorise, and an envelope without the payload's signature, before anything is read", async () => {
    // x402's Stellar scheme: entries MUST NOT use sorobanCredentialsSourceAccount (the facilitator's safety).
    const withSourceEntry = envelopeWire(PRESENTED);
    if (withSourceEntry.type !== 2) throw new Error("not a v1 envelope");
    const body = withSourceEntry.v1.tx.operations[0]!.body;
    if (body.type !== 24) throw new Error("not an invocation");
    body.invokeHostFunctionOp.auth.push({ credentials: { type: 0 }, rootInvocation: body.invokeHostFunctionOp.auth[0]!.rootInvocation });
    // The profile, rule 11: a transaction submitted without the payload's signature is refused (txBAD_AUTH).
    const unsigned = envelopeWire(PRESENTED);
    if (unsigned.type !== 2) throw new Error("not a v1 envelope");
    unsigned.v1.signatures = [];
    for (const [envelope, reason] of [
      [envelopeB64(withSourceEntry), "invalid_exact_stellar_payload_unsupported_credential_type"],
      [envelopeB64(unsigned), "invalid_payload"],
    ] as const) {
      expect(await verify(withTransaction(PAYMENT, envelope))).toEqual({ isValid: false, invalidReason: reason });
      expect(await settle(withTransaction(PAYMENT, envelope))).toMatchObject({ success: false, errorReason: reason, transaction: "" });
    }
    expect(node.calls).toEqual([]);
  });

  it("answers a payment whose entry already landed invalid_transaction_state naming the transaction lcp's read finds", async () => {
    // The buyer's presented transaction landed through another submitter: its nonce is used, so the simulation fails.
    const landedHash = "9d".repeat(32);
    chain.landed.set(landedHash, { envelope: PRESENTED, ledger: 989, status: "SUCCESS", transfer: { from: V.fixed.buyer, to: OPTION.payTo, amount: BigInt(OPTION.amount) } });
    chain.simulation = { error: "HostError: Error(Auth, ExistingValue)" };
    expect(await settle(PAYMENT)).toEqual({ success: false, errorReason: "invalid_transaction_state", transaction: landedHash, network: NETWORK });
    expect(sent).toEqual([]);
  });
});
