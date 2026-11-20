// The core through its HTTP surface, against the test module of ./core-module.ts and a node stub that holds the chain's
// state, fed lcp's x402/exact/eip155/eip3009 vectors: V2's payment as x402's specification writes it, signed by the
// published Anvil key; the agreement's own value for V2's H (AG), signed over the vector's EIP-712 digest; and the same
// authorization from a second payer, its EIP-712 digest computed from V1's type hash and domain separator (the
// computation reproduces V1's digest and signature first). The cases are the settler's record cases (two payers with one
// nonce value; an agreement and a payment of one payer under one H; a repeat of a stored success; a submission that
// never reached the node, then a repeat; an instrument that landed by another route; a spent fee budget and what it
// never refuses), what /supported states of each kind, and the caller's credential, which the settler had none of.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveSettler, type SettlerConfig } from "../src/core.js";
import { listed } from "../src/modules/index.js";
import { nonceOf, offering, OTHER_PAIRING, PAIRING, starter, type TestModuleConfig } from "./core-module.js";
import { freshDatabase, onLockedPort, stub, type Stub } from "./support.js";

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}
const VECTORS = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-eip155-eip3009.json", import.meta.url), "utf8")) as {
  fixed: { H: string; O: PaymentRequirements };
  V1: { expectMessage: Authorization; expectTypeHash: string; expectDomainSeparator: string; expectDigest: string; expectSignature: string };
  V2: { expectPayload: PaymentPayload };
  AG: { expectValue: string; expectDigest: string };
};
const O = VECTORS.fixed.O;
const NETWORK = O.network;
/** The published Anvil development keys #0 and #1. */
const KEY_0 = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY_1 = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const FEE_PAYER = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const OWN_FEE_PAYER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const CREDENTIAL = "c2V0dGxlci10ZXN0LWNyZWRlbnRpYWw";
const LIST = [listed("erc7710", async () => ({ starter: offering })), listed("evm", async () => ({ starter }))] as const;

const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;
const bytes = (h: string) => Buffer.from(h.replace(/^0x/, ""), "hex");
const word = (n: bigint) => bytes(n.toString(16).padStart(64, "0"));

/** The EIP-712 digest of a TransferWithAuthorization under V1's domain. */
function digestOf(a: Authorization): string {
  const struct = keccak_256(
    Buffer.concat([
      bytes(VECTORS.V1.expectTypeHash),
      word(BigInt(a.from)),
      word(BigInt(a.to)),
      word(BigInt(a.value)),
      word(BigInt(a.validAfter)),
      word(BigInt(a.validBefore)),
      bytes(a.nonce),
    ]),
  );
  return hex(keccak_256(Buffer.concat([Buffer.from([0x19, 0x01]), bytes(VECTORS.V1.expectDomainSeparator), struct])));
}

/** r ‖ s ‖ v over a digest, v 27 or 28, as an EVM signature is written. */
function sign(digest: string, key: string): string {
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(bytes(digest), bytes(key), { prehash: false, format: "recovered" }), "recovered");
  return `${hex(sig.toBytes("compact"))}${(27 + sig.recovery!).toString(16)}`;
}

/** The address of a key: the last 20 bytes of the Keccak-256 of its public key. */
function addressOf(key: string): string {
  return hex(keccak_256(secp256k1.getPublicKey(bytes(key), false).subarray(1)).subarray(12));
}

/** V2's payment, its authorization changed by `change` and signed again by `key`. */
function payment(change: Partial<Authorization> = {}, key = KEY_0): PaymentPayload {
  const v2 = VECTORS.V2.expectPayload;
  const authorization = { ...(v2.payload["authorization"] as Authorization), ...change };
  return { ...v2, payload: { signature: sign(digestOf(authorization), key), authorization } };
}

/** V2's payment as the vectors give it. */
const V2 = VECTORS.V2.expectPayload;
/** The agreement of V2's payer under V2's H: its nonce the agreement's own value. */
const AGREEMENT = payment({ nonce: VECTORS.AG.expectValue });
/** V2's authorization from a second payer: the same nonce value. */
const PAYER_B = payment({ from: addressOf(KEY_1) }, KEY_1);
/** A nonce for a further payment of V2's payer. */
const nonce = (label: string) => hex(createHash("sha256").update(label).digest());

/** The ledger's clock, in Unix seconds: V2's authorization is valid at it. */
const LEDGER_NOW = Number((V2.payload["authorization"] as Authorization).validBefore) - 30;

/**
 * The chain the node stub serves: which nonces are consumed and by which transaction. `/send` consumes the nonce it is
 * sent and answers the transaction included, unless `sending` answers otherwise; `/read` answers a nonce whose
 * presented validity has passed at `LEDGER_NOW` unused, as lcp's read computes it from that validity.
 */
class Ledger {
  readonly consumed = new Map<string, string>();
  readonly sends: unknown[] = [];
  /** What `/send` answers instead, given the send's number from 1: nothing is consumed. */
  sending?: (n: number) => { transaction: string; included: boolean };
  /** How long `/send` takes. */
  sendMs = 0;
  /** What `/send` does once it has taken `sendMs`, before it answers. */
  sent?: () => Promise<void>;
  /** What a settled read states of the landed act against the payment presented. */
  presented = "yes";
  static key(b: { signer: string; token: string; value: string }): string {
    return `${b.signer}|${b.token}|${b.value}`;
  }
  async answer(path: string, body: unknown): Promise<unknown> {
    const b = body as { signer: string; token: string; value: string; validBefore?: string };
    if (path === "/check") return { used: this.consumed.has(Ledger.key(b)) };
    if (path === "/send") {
      this.sends.push(body);
      if (this.sendMs > 0) await new Promise((resolve) => setTimeout(resolve, this.sendMs));
      await this.sent?.();
      if (this.sending !== undefined) return this.sending(this.sends.length);
      const transaction = sentFor(b);
      this.consumed.set(Ledger.key(b), transaction);
      return { transaction, included: true };
    }
    if (path === "/read") {
      const transaction = this.consumed.get(Ledger.key(b));
      if (transaction !== undefined) {
        return { state: "settled", transaction, finality: "finalized", presented: this.presented, foreign: [] };
      }
      return Number(b.validBefore) <= LEDGER_NOW
        ? { state: "failed", reason: "instrument-unused", finality: "finalized", foreign: [] }
        : { state: "pending", reason: "instrument-live", foreign: [] };
    }
    if (path === "/head") return { block: "9007199254740993" };
    if (path === "/fee") return { fee: "100", included: true };
    return {};
  }
  /** Marks the payment's nonce consumed by `transaction`, sent by someone else. */
  landed(p: PaymentPayload, transaction: string): void {
    this.consumed.set(Ledger.key(nonceOf(p, O)), transaction);
  }
}

/** The transaction the ledger's `/send` names for a nonce. */
function sentFor(b: { signer: string; token: string; value: string }): string {
  return hex(createHash("sha256").update(`sent:${Ledger.key(b)}`).digest());
}

let db: Awaited<ReturnType<typeof freshDatabase>>;
let ledger: Ledger;
let node: Stub | undefined;
let sender: Stub | undefined;
let closeSettler: (() => Promise<void>) | undefined;
let base: string;

beforeEach(async () => {
  db = await freshDatabase();
  ledger = new Ledger();
});

afterEach(async () => {
  await closeSettler?.();
  closeSettler = undefined;
  await node?.close();
  await sender?.close();
  node = sender = undefined;
  await db.drop();
}, 60_000);

function startWith(module: Partial<TestModuleConfig>, core: Partial<SettlerConfig> & { erc7710?: TestModuleConfig } = {}) {
  return onLockedPort((p) =>
    serveSettler(
      {
        listen: `127.0.0.1:${p}`,
        store: { url: db.url },
        settleWaitMs: 3_000,
        operatorLog: () => {},
        evm: [{ network: NETWORK, node: node!.url, ...module }],
        ...core,
      },
      LIST,
    ),
  );
}

async function start(module: Partial<TestModuleConfig> = {}, core: Parameters<typeof startWith>[1] = {}): Promise<void> {
  node ??= await stub((path, body) => ledger.answer(path, body));
  const { port, server } = await startWith(module, core);
  closeSettler = server.close;
  base = `http://127.0.0.1:${port}`;
}

/** The facilitator request for a payment under O, or under O changed as `requirements` says. */
function body(payload: PaymentPayload = V2, requirements: Partial<PaymentRequirements> = {}) {
  const r = { ...O, ...requirements };
  return { x402Version: 2, paymentPayload: { ...payload, accepted: r }, paymentRequirements: r };
}

async function call(path: string, b: unknown, credential?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credential !== undefined) headers["authorization"] = `Bearer ${credential}`;
  const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(b) });
  return { status: res.status, json: await res.json() };
}

const settle = async (b: unknown, credential?: string) => (await call("/settle", b, credential)).json;
const verify = async (b: unknown, credential?: string) => (await call("/verify", b, credential)).json;
const success = (p: PaymentPayload = V2) => {
  const n = nonceOf(p, O);
  return { success: true, transaction: sentFor(n), network: NETWORK, payer: n.signer };
};
const held = (transaction: string) => ({ success: false, errorReason: "invalid_transaction_state", transaction, network: NETWORK });
const pendingAt = (transaction: string) => ({ success: false, errorReason: "settlement_pending", transaction, network: NETWORK });
const fees = async () => (await db.pool.query("SELECT fee::text, included FROM fee")).rows;
const rows = async () => Number((await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM instrument")).rows[0]!.n);
const nodePaths = () => node!.calls.map((c) => c.path);

describe("GET /supported", () => {
  it("states each kind's pairings, its key, whether it takes zero, its fee budget and its fee payer, and keeps the class's members", async () => {
    node = await stub((path, b) => ledger.answer(path, b));
    await start(
      { key: "fee-payer", acceptsZero: [PAIRING], signers: [FEE_PAYER], extra: { feePayer: FEE_PAYER } },
      {
        credential: CREDENTIAL,
        feeBudgets: [{ network: NETWORK, amount: "1000000", periodSeconds: 3600 }],
        // An own module another starter offers to the same kind.
        erc7710: { network: NETWORK, node: node.url, key: "fee-payer", acceptsZero: [], signers: [OWN_FEE_PAYER] },
      },
    );
    const res = await fetch(`${base}/supported`, { headers: { authorization: `Bearer ${CREDENTIAL}` } });
    expect(await res.json()).toEqual({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: NETWORK,
          extra: {
            form: "offered",
            feePayer: FEE_PAYER,
            key: "fee-payer",
            // The published module's pairing takes zero; the offered module's does not.
            acceptsZero: [PAIRING],
            pairings: [OTHER_PAIRING, PAIRING],
            feeBudget: true,
          },
        },
      ],
      extensions: [],
      signers: { "eip155:*": [OWN_FEE_PAYER, FEE_PAYER] },
    });
  });
});

describe("the caller's credential", () => {
  it("refuses a call that does not present it, 401 before its body is read, and serves one that does", async () => {
    await start({ key: "relayer" }, { credential: CREDENTIAL });
    for (const credential of [undefined, "another"]) {
      expect(await call("/settle", body(), credential)).toEqual({ status: 401, json: { error: "unauthorized" } });
    }
    const supported = await fetch(`${base}/supported`);
    expect([supported.status, supported.headers.get("www-authenticate")]).toEqual([401, "Bearer"]);
    expect(node!.calls).toEqual([]);
    expect(await rows()).toBe(0);
    expect(await settle(body(), CREDENTIAL)).toEqual(success());
  });

  it("is required where a module holds a key: such a deployment does not start without one", async () => {
    node = await stub((path, b) => ledger.answer(path, b));
    await expect(startWith({ key: "relayer" })).rejects.toThrow(/credential is required/);
  });
});

describe("the record", () => {
  it("keys two payers who signed one nonce value as two instruments: two submissions", async () => {
    // The inputs are the vectors': the digest and signature computed here for V2's payer are V1's.
    expect(digestOf(VECTORS.V1.expectMessage)).toBe(VECTORS.V1.expectDigest);
    expect(sign(VECTORS.V1.expectDigest, KEY_0)).toBe(VECTORS.V1.expectSignature);
    expect(addressOf(KEY_0)).toBe(VECTORS.V1.expectMessage.from.toLowerCase());
    await start();
    expect(await settle(body(V2))).toEqual(success(V2));
    expect(await settle(body(PAYER_B))).toEqual(success(PAYER_B));
    expect(ledger.sends).toHaveLength(2);
    expect(await rows()).toBe(2);
  });

  it("keys one payer's agreement and payment under one H as two instruments: two rows", async () => {
    expect(digestOf(AGREEMENT.payload["authorization"] as Authorization)).toBe(VECTORS.AG.expectDigest);
    await start();
    expect(await settle(body(AGREEMENT))).toEqual(success(AGREEMENT));
    expect(await settle(body(V2))).toEqual(success(V2));
    expect(ledger.sends).toHaveLength(2);
    expect(await rows()).toBe(2);
  });

  it("answers a repeat of a stored success invalid_transaction_state naming the transaction, and sends nothing", async () => {
    await start();
    expect(await settle(body())).toEqual(success());
    const before = node!.calls.length;
    expect(await settle(body())).toEqual(held(success().transaction));
    expect(ledger.sends).toHaveLength(1);
    // The record answered: neither the class's checks nor the chain were asked.
    expect(node!.calls.length).toBe(before);
  });

  it("keeps a submission that never reached the node as a claim, not final, and a repeat that reads it unconsumed submits", async () => {
    // The module sends to its own endpoint, which is down for the first settle: the request cannot reach it.
    sender = await stub((path, b) => ledger.answer(path, b), () => false);
    await sender.close();
    await start({ sender: sender.url });
    expect(await settle(body())).toEqual({ success: false, errorReason: "node_unreachable", transaction: "", network: NETWORK });
    // That answer is the class's own, after a read of the chain, and never pending.
    expect(nodePaths()).toEqual(["/check", "/head", "/read"]);
    expect((await db.pool.query("SELECT final, held_until FROM instrument")).rows).toEqual([{ final: false, held_until: "0" }]);
    await sender.listen();
    expect(await settle(body())).toEqual(success());
    expect(sender.calls.map((c) => c.path)).toEqual(["/send"]);
    expect((await db.pool.query("SELECT final, outcome FROM instrument")).rows).toEqual([{ final: true, outcome: "settled" }]);
    // Each read searched from the block read at the claim, a height past 2^53 kept whole in the row.
    const reads = node!.calls.filter((c) => c.path === "/read").map((c) => (c.body as { from: unknown }).from);
    expect(reads).toEqual(["9007199254740993", "9007199254740993"]);
  });

  it("answers a success that names no transaction, as x402's upto class answers a settle of zero, only once it is stored final: a repeat sends nothing", async () => {
    await start({ acceptsZero: [PAIRING] });
    // @x402/evm's upto Permit2 settle of a zero amount: a success naming no transaction, nothing sent to the chain.
    ledger.sending = () => ({ transaction: "", included: true });
    const zero = body(V2, { amount: "0" });
    expect(await settle(zero)).toEqual({ success: true, transaction: "", network: NETWORK, payer: nonceOf(V2, O).signer });
    expect(await settle(zero)).toEqual(held(""));
    expect(ledger.sends).toHaveLength(1);
  });

  it("stores and answers a success the class gives after the request's deadline, the store answering in its own time: a repeat is answered from the record", async () => {
    await start({}, { settleWaitMs: 1_000 });
    ledger.sendMs = 1_300;
    // The claim's row is locked as the class answers and for 200 ms after, as a busy store answers late.
    const lock = await db.pool.connect();
    ledger.sent = async () => {
      await lock.query("BEGIN");
      await lock.query("SELECT 1 FROM instrument FOR UPDATE");
      setTimeout(() => void lock.query("COMMIT").finally(() => lock.release()), 200);
    };
    expect(await settle(body())).toEqual(success());
    expect(await settle(body())).toEqual(held(success().transaction));
  });

  it("answers success where an earlier transaction the settler sent for the claim lands after a repeat sent another", async () => {
    await start();
    ledger.sending = (n) => ({ transaction: nonce(`T${n}`), included: false });
    ledger.presented = "unshown";
    expect(await settle(body())).toEqual(pendingAt(nonce("T1")));
    expect(await settle(body())).toEqual(pendingAt(nonce("T2")));
    ledger.landed(V2, nonce("T1"));
    expect(await settle(body())).toEqual({ ...success(), transaction: nonce("T1") });
    expect(ledger.sends).toHaveLength(2);
  });

  it("sends a held claim again only as the body that claimed it: a copy re-signed under its nonce is sent nothing", async () => {
    sender = await stub((path, b) => ledger.answer(path, b), () => false);
    await sender.close();
    await start({ sender: sender.url });
    expect(await settle(body())).toEqual({ success: false, errorReason: "node_unreachable", transaction: "", network: NETWORK });
    await sender.listen();
    const copy = payment({ validBefore: String(LEDGER_NOW + 60) });
    expect(await settle(body(copy))).toEqual(held(""));
    expect(sender.calls).toEqual([]);
    expect(await settle(body())).toEqual(success());
    expect(sender.calls.map((c) => c.path)).toEqual(["/send"]);
  });

  it("stores no final row for a refused payload by its own validity: the payer's valid payment under that nonce then settles", async () => {
    await start();
    // A body under V2's payer and nonce that no key signed, its validity already passed.
    const auth = V2.payload["authorization"] as Authorization;
    const forged = { ...V2, payload: { signature: "0xdead", authorization: { ...auth, validBefore: String(LEDGER_NOW - 1) } } };
    expect(await settle(body(forged))).toEqual({ success: false, errorReason: "invalid_exact_evm_payload_signature", transaction: "", network: NETWORK });
    expect(await rows()).toBe(0);
    expect(await settle(body())).toEqual(success());
  });

  it("answers an instrument that landed by another route invalid_transaction_state naming that transaction, never a success", async () => {
    await start();
    const landed = nonce("landed elsewhere");
    ledger.landed(V2, landed);
    expect(await settle(body())).toEqual(held(landed));
    expect(ledger.sends).toEqual([]);
    expect(nodePaths()).toEqual(["/check", "/read"]);
    // The row is final: a repeat is answered from it alone.
    expect(await settle(body())).toEqual(held(landed));
    expect(nodePaths()).toEqual(["/check", "/read"]);
  });
});

describe("the fee budget", () => {
  it("counts the fee of a transaction whose class settle outlasts the request's deadline", async () => {
    await start(
      { key: "relayer", paysFee: true },
      { credential: CREDENTIAL, settleWaitMs: 1_000, feeBudgets: [{ network: NETWORK, amount: 1_000n, periodSeconds: 3600 }] },
    );
    ledger.sendMs = 1_300;
    await settle(body(), CREDENTIAL);
    await vi.waitFor(async () => expect(await fees()).toEqual([{ fee: "100", included: true }]), { timeout: 3_000 });
  });

  it("is refused at start where it would count none of the fees a module's key pays: the module neither meters nor shows them", async () => {
    node = await stub((path, b) => ledger.answer(path, b));
    const budget = { credential: CREDENTIAL, feeBudgets: [{ network: NETWORK, amount: 1_000n, periodSeconds: 3600 }] };
    await expect(startWith({ key: "relayer", paysFee: true, charged: false }, budget)).rejects.toThrow(/fee budget of eip155:84532/);
  });

  it("refuses a fresh submission once spent, sending nothing, and never a final row, a value already used or a held claim that landed", async () => {
    await start(
      { key: "relayer", paysFee: true },
      { credential: CREDENTIAL, feeBudgets: [{ network: NETWORK, amount: 100n, periodSeconds: 3600 }] },
    );
    const s = (b: unknown) => settle(b, CREDENTIAL);
    // The first submission's fee, as the chain shows it, reaches the budget. The core counts it once the answer is
    // stored, on its own bounds, so the count can land after the answer: it is awaited, as the deadline case awaits it.
    expect(await s(body())).toEqual(success());
    await vi.waitFor(async () => expect(await fees()).toEqual([{ fee: "100", included: true }]), { timeout: 3_000 });
    const spent = { success: false, errorReason: "fee_budget_spent", transaction: "", network: NETWORK };
    // A fresh submission: refused, with nothing sent; its claim stays, not final.
    const fresh = payment({ nonce: nonce("H2") });
    expect(await s(body(fresh))).toEqual(spent);
    expect(ledger.sends).toHaveLength(1);
    expect((await db.pool.query("SELECT final FROM instrument ORDER BY claimed")).rows).toEqual([{ final: true }, { final: false }]);
    // /verify refuses a payment the settler would submit.
    expect(await verify(body(payment({ nonce: nonce("H3") })), CREDENTIAL)).toEqual({ isValid: false, invalidReason: "fee_budget_spent" });
    // A repeat of the final answer is answered from the record.
    expect(await s(body())).toEqual(held(success().transaction));
    // A value already used is read and answered.
    const used = payment({ nonce: nonce("H4") });
    ledger.landed(used, nonce("used elsewhere"));
    expect(await s(body(used))).toEqual(held(nonce("used elsewhere")));
    // The held claim, once the chain shows its payment landed, is read and answered.
    ledger.landed(fresh, nonce("H2 landed"));
    expect(await s(body(fresh))).toEqual(held(nonce("H2 landed")));
    expect(ledger.sends).toHaveLength(1);
  });
});
