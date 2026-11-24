// The Casper module through the settler's HTTP surface, against lcp's vectors for x402/exact/casper. A payment is what
// lcp's client builds for the vector's option and H, signed by a throwaway casper-js-sdk key through @x402/casper's own
// client signer (the vector's publicKey and signature are placeholders no verifier takes). @x402/casper 2.31.0's class
// runs unchanged with its own signer object over a throwaway relayer key, against a node stub: the class's reads of the
// token, the submission and the wait. lcp's read runs through the module's reader against a stub that serves lcp's C4
// node rows in the node's JSON-RPC answers, each transaction written by casper-js-sdk itself.
import { readFileSync } from "node:fs";
import { blake2b } from "@noble/hashes/blake2.js";
import { exactCasper } from "@integraledger/lcp/casper";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import pg from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveSettler, type FeeBudgetConfig } from "../src/core.js";
import { listed } from "../src/modules/index.js";
import { starter, type CasperConfig, type CasperSigner } from "../src/modules/casper/index.js";
import { CREDENTIAL, routes, serving, Status, type Routes, type Serving } from "./routes.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-casper.json", import.meta.url), "utf8"));
const O: PaymentRequirements = V.fixed.O;
const NETWORK = O.network as "casper:casper-test";
const H: string = V.fixed.H;
const LIST = [listed("casper", async () => ({ starter }))] as const;
/** The token's active contract in the stub, any hash but the package's. */
const CONTRACT = "c0".repeat(32);

// casper-js-sdk ships TypeScript sources beside its declarations, which the compiler refuses (see the module), so the two
// libraries are loaded by name and used untyped here.
type Any = any;
const load = (name: string): Promise<Any> => import(name);
const sdk: Any = await load("casper-js-sdk");
const x402: Any = await load("@x402/casper");

let settler: Serving | undefined;
let node: (Routes & { sent: Map<string, unknown> }) | undefined;
/** The settler's database, for the record's rows. */
let store: string | undefined;
afterEach(async () => {
  await settler?.close();
  await node?.close();
  settler = undefined;
  node = undefined;
  store = undefined;
});

const body = (p: PaymentPayload, requirements: PaymentRequirements = p.accepted) => ({ x402Version: 2, paymentPayload: p, paymentRequirements: requirements });

const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** A CLValue as the node writes it in a stored value: its type, its bytes and its parsed form. */
const stored = (cl: Any, type: string, parsed: unknown) => ({ CLValue: { cl_type: type, bytes: Buffer.from(cl.bytes()).toString("hex"), parsed } });

/** A vector call of C4's node, as the transaction casper-js-sdk writes for it, with its execution as the node shows it. */
function transactionAnswer(call: Any, sender: Any): unknown {
  const key = (h: string) => sdk.Key.fromBytes(Buffer.from(h, "hex")).result;
  const a = call.args;
  const args: Record<string, unknown> = {};
  if (a.from !== undefined) args["from"] = sdk.CLValue.newCLKey(key(a.from));
  if (a.to !== undefined) args["to"] = sdk.CLValue.newCLKey(key(a.to));
  if (a.value !== undefined) args["value"] = sdk.CLValue.newCLUInt256(a.value);
  if (a.validAfter !== undefined) args["valid_after"] = sdk.CLValue.newCLUint64(Number(a.validAfter));
  if (a.validBefore !== undefined) args["valid_before"] = sdk.CLValue.newCLUint64(Number(a.validBefore));
  if (a.nonce !== undefined) {
    args["nonce"] = sdk.CLValue.newCLList(sdk.CLTypeUInt8, [...Buffer.from(a.nonce, "hex")].map((b) => sdk.CLValue.newCLUint8(b)));
  }
  const tx = new sdk.ContractCallBuilder()
    .from(sender.publicKey)
    .byPackageHash(call.packageHash)
    .entryPoint(call.entryPoint)
    .runtimeArgs(sdk.Args.fromMap(args))
    .chainName("casper-test")
    .payment(2_500_000_000)
    .build();
  tx.sign(sender);
  return {
    api_version: "2.0.0",
    transaction: sdk.TransactionWrapper.toJSON(tx.getTransactionWrapper()),
    execution_info: call.executed ? execution(call.blockHeight, call.error, sender) : null,
  };
}

function execution(height: string | number, error: string | null, initiator: Any): unknown {
  return {
    block_hash: "bb".repeat(32),
    block_height: Number(height),
    execution_result: {
      Version2: {
        initiator: { PublicKey: initiator.publicKey.toHex() },
        error_message: error,
        current_price: 1,
        limit: "2500000000",
        consumed: "120000000",
        cost: "2500000000",
        refund: "0",
        transfers: [],
        size_estimate: 512,
        effects: [],
      },
    },
  };
}

/**
 * The key a token's `used_nonces` holds `(from, nonce)` under. CEP-3009 and its Odra reference token: the lowercase hex
 * of blake2b-256 over `from` as its tagged key (33 bytes) and the nonce as `Bytes` (a u32 little-endian length, then
 * the bytes). "base64": the base64 of the raw pair, which no CEP-3009 token holds (the settler's key before row 17).
 */
function itemKey(form: "cep3009" | "base64", fromHex: string, nonceHex: string): string {
  const from = Buffer.from(fromHex, "hex");
  const nonce = Buffer.from(nonceHex, "hex");
  if (form === "base64") return Buffer.concat([from, nonce]).toString("base64");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(nonce.length);
  return Buffer.from(blake2b(Buffer.concat([from, length, nonce]), { dkLen: 32 })).toString("hex");
}

const root = (height: bigint | string) => BigInt(height).toString(16).padStart(64, "0");

/** A block as `chain_get_block` answers it: its height, its own timestamp, its state root and its transactions. */
function block(height: bigint | string, timestamp: bigint | string, hashes: readonly string[]): unknown {
  return {
    api_version: "2.0.0",
    block_with_signatures: {
      block: {
        Version2: {
          hash: "dd".repeat(32),
          header: { height: Number(height), timestamp: new Date(Number(timestamp)).toISOString(), state_root_hash: root(height) },
          body: { transactions: { "3": hashes.map((h) => ({ Version1: h })) }, rewarded_signatures: [] },
        },
      },
      proofs: [],
    },
  };
}

interface Chain {
  /** C4's node: the head, the lowest height served, the height the item was set and that block's pages of calls. */
  readonly node?: Any;
  /** The payment's (from, nonce), whose used-nonce item C4's node sets. */
  readonly item?: { readonly from: string; readonly nonce: string };
  /** The item key the node holds that item under: CEP-3009's (the default), or the base64 of the raw pair. */
  readonly keyForm?: "cep3009" | "base64";
  /** The payer's balance the class reads. */
  readonly balance?: bigint;
  /** The node takes a submitted transaction and its answer is lost on the way back. */
  readonly dropPut?: boolean;
}

/** The node stub: the class's reads of the token and its submission, and C4's node for lcp's read. */
async function casperNode(chain: Chain): Promise<Routes & { sent: Map<string, unknown> }> {
  const sender = sdk.PrivateKey.generate(sdk.KeyAlgorithm.ED25519);
  const sent = new Map<string, unknown>();
  const n = chain.node;
  const calls: Any[] = n === undefined ? [] : n.pages.flat();
  const r = await routes((_path, b: Any) => {
    const p = b.params;
    switch (b.method) {
      case "chain_get_state_root_hash":
        return rpcOk(b.id, { api_version: "2.0.0", state_root_hash: root(4300n) });
      case "info_get_status":
        return rpcOk(b.id, { api_version: "2.0.0", available_block_range: { low: Number(n.lowest), high: Number(n.head.height) } });
      case "chain_get_block": {
        const h = p?.block_identifier?.Height;
        if (h === undefined) return rpcOk(b.id, block(n.head.height, n.head.timestamp, []));
        if (BigInt(h) < BigInt(n.lowest) || BigInt(h) > BigInt(n.head.height)) return rpcError(b.id, -32001, "No such block");
        return rpcOk(b.id, block(h, n.head.timestamp, n.setFrom !== null && BigInt(h) === BigInt(n.setFrom) ? calls.map((c) => c.transaction) : []));
      }
      case "query_global_state": {
        if (p.key === `hash-${O.asset}`) {
          return rpcOk(b.id, {
            api_version: "2.0.0",
            stored_value: {
              ContractPackage: {
                access_key: `uref-${"aa".repeat(32)}-007`,
                versions: [{ protocol_version_major: 2, contract_version: 1, contract_hash: `contract-${CONTRACT}` }],
                disabled_versions: [],
                groups: [],
                lock_status: "Unlocked",
              },
            },
            merkle_proof: "",
          });
        }
        if (p.key === `hash-${CONTRACT}`) {
          const entry = (name: string) => ({ name, args: [], ret: "Unit", access: "Public", entry_point_type: "Called", entry_point_payment: "Caller" });
          return rpcOk(b.id, {
            api_version: "2.0.0",
            stored_value: {
              Contract: {
                contract_package_hash: `contract-package-${O.asset}`,
                contract_wasm_hash: `contract-wasm-${"ee".repeat(32)}`,
                named_keys: [],
                entry_points: [entry("transfer_with_authorization"), entry("balance_of")],
                protocol_version: "2.0.0",
              },
            },
            merkle_proof: "",
          });
        }
        return rpcError(b.id, -32003, "Query failed");
      }
      case "state_get_dictionary_item": {
        const named = p.dictionary_identifier.ContractNamedKey;
        if (named.dictionary_name === "balances") {
          return rpcOk(b.id, { api_version: "2.0.0", dictionary_key: `dictionary-${"11".repeat(32)}`, stored_value: stored(sdk.CLValue.newCLUInt256(String(chain.balance ?? 0n)), "U256", String(chain.balance ?? 0n)), merkle_proof: "" });
        }
        if (named.dictionary_name === "authorization_state") {
          return rpcOk(b.id, { api_version: "2.0.0", dictionary_key: `dictionary-${"22".repeat(32)}`, stored_value: stored(sdk.CLValue.newCLValueBool(false), "Bool", false), merkle_proof: "" });
        }
        // lcp's read: the item of (from, nonce) set from C4's setFrom on, at the state root of each height.
        const height = BigInt(`0x${p.state_root_hash}`);
        const item = chain.item === undefined ? "" : itemKey(chain.keyForm ?? "cep3009", chain.item.from, chain.item.nonce);
        const set = named.dictionary_item_key === item && n.setFrom !== null && height >= BigInt(n.setFrom);
        if (!set) return rpcError(b.id, -32003, "Query failed");
        return rpcOk(b.id, { api_version: "2.0.0", dictionary_key: `dictionary-${"33".repeat(32)}`, stored_value: stored(sdk.CLValue.newCLValueBool(true), "Bool", true), merkle_proof: "" });
      }
      case "account_put_transaction": {
        const v1 = p.transaction.Version1;
        sent.set(v1.hash, p.transaction);
        if (chain.dropPut) return new Status(502, { error: "bad gateway" });
        return rpcOk(b.id, { api_version: "2.0.0", transaction_hash: { Version1: v1.hash } });
      }
      case "info_get_transaction": {
        const h = p.transaction_hash.Version1 ?? p.transaction_hash.Deploy;
        const own = sent.get(h);
        if (own !== undefined) return rpcOk(b.id, { api_version: "2.0.0", transaction: own, execution_info: execution(4300, null, sender) });
        const call = calls.find((c) => c.transaction === h);
        return call === undefined ? rpcError(b.id, -32014, "No such transaction") : rpcOk(b.id, transactionAnswer(call, sender));
      }
      default:
        return rpcError(b.id, -32601, `Method not found: ${b.method}`);
    }
  });
  return Object.assign(r, { sent });
}

async function start(casper: readonly CasperConfig[], feeBudgets?: readonly FeeBudgetConfig[]) {
  settler = await serving((port, url) => {
    store = url;
    return serveSettler(
      { listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, ...(feeBudgets ? { feeBudgets } : {}), casper },
      LIST,
    );
  });
}

/** The record's rows, in the order they were claimed: key, final, transaction. */
async function rows(): Promise<unknown[][]> {
  if (store === undefined) throw new Error("no settler is serving");
  const pool = new pg.Pool({ connectionString: store });
  pool.on("error", () => {});
  try {
    const r = await pool.query<{ key: string; final: boolean; transaction: string | null }>("SELECT key, final, transaction FROM instrument ORDER BY claimed, key");
    return r.rows.map((row) => [row.key, row.final, row.transaction]);
  } finally {
    await pool.end();
  }
}

/** The settler started with one Casper network's configuration, which the test expects it to refuse. */
const refusedStart = (entry: CasperConfig) =>
  serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, casper: [entry] }, LIST),
  );

/** x402's own signer object over a throwaway relayer key, reading `rpc`. */
async function relayer(rpc?: string): Promise<{ signer: CasperSigner; key: Any }> {
  const key = sdk.PrivateKey.generate(sdk.KeyAlgorithm.ED25519);
  const signer = await x402.toFacilitatorCasperSigner(key, rpc === undefined ? {} : { rpcUrlConfig: { [NETWORK]: rpc } });
  return { signer, key };
}

/**
 * The payment lcp's client builds for the vector's option and H, as `act` and from `required`, signed by a throwaway key
 * (or `key`) through x402's client signer.
 */
async function signedPayment(
  algorithm: Any,
  act: "payment" | "agreement" = "payment",
  key: Any = sdk.PrivateKey.generate(algorithm),
  required: unknown = { x402Version: 2, resource: V.fixed.resource, accepts: [O] },
): Promise<{ payment: PaymentPayload; from: string }> {
  const payer = x402.toClientCasperSigner(key);
  const from: string = payer.accountAddress();
  const now = Math.floor(Date.now() / 1000);
  const u = await exactCasper.build({ required: required as never, accepted: O as never, from, now }, H as never, act);
  if ("refused" in u) throw new Error(`lcp refused to build: ${JSON.stringify(u)}`);
  const m = u.request.typedData.message;
  const digest = x402.buildTransferWithAuthorizationDigest({
    name: O.extra["name"],
    version: O.extra["version"],
    network: NETWORK,
    asset: O.asset,
    authorization: { from: m.from, to: m.to, value: m.value.toString(), validAfter: m.validAfter.toString(), validBefore: m.validBefore.toString(), nonce: m.nonce },
  });
  const signature = Buffer.from(await payer.signEIP712(digest)).toString("hex");
  const payment = u.complete(payer.publicKey(), signature);
  if ("refused" in payment) throw new Error(`lcp refused the signature: ${JSON.stringify(payment)}`);
  return { payment: payment as unknown as PaymentPayload, from };
}

describe("the Casper module", () => {
  it("states the pairing it submits, its relayer key and account, and that it does not take zero", async () => {
    node = await casperNode({});
    const { signer, key } = await relayer(node.url);
    await start([{ network: NETWORK, signer, rpc: node.url }]);
    expect(await settler!.supported()).toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { key: "relayer", acceptsZero: [], pairings: ["x402/exact/casper"] } }],
      extensions: [],
      signers: { "casper:*": [key.publicKey.accountHash().toHex()] },
    });
  });

  it("does not start where x402's signer would read its public node in place of the configured one", async () => {
    const { signer } = await relayer();
    await expect(
      serving((port, url) =>
        serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, casper: [{ network: NETWORK, signer, rpc: "http://127.0.0.1:9/rpc" }] }, LIST),
      ),
    ).rejects.toThrow("the signer reads https://node.testnet.casper.network, not the configured node http://127.0.0.1:9");
  });

  it("does not start on casper:casper, where no token has yet been shown to execute transfer_with_authorization", async () => {
    const rpc = "http://127.0.0.1:9/rpc";
    const signer = await x402.toFacilitatorCasperSigner(sdk.PrivateKey.generate(sdk.KeyAlgorithm.ED25519), { rpcUrlConfig: { "casper:casper": rpc } });
    await expect(refusedStart({ network: "casper:casper", signer, rpc })).rejects.toThrow("casper on casper:casper: not served");
  });

  it("does not start where x402's signer would have the key sign a deploy for speculative execution at a node other than the configured one", async () => {
    const rpc = "http://127.0.0.1:9/rpc";
    const key = sdk.PrivateKey.generate(sdk.KeyAlgorithm.ED25519);
    const signer = await x402.toFacilitatorCasperSigner(key, { rpcUrlConfig: { [NETWORK]: rpc }, speculativeRpcUrlConfig: { [NETWORK]: "http://127.0.0.1:10/rpc" } });
    await expect(refusedStart({ network: NETWORK, signer, rpc })).rejects.toThrow(
      "the signer's speculative execution goes to http://127.0.0.1:10, not the configured node http://127.0.0.1:9",
    );
  });

  it.each([
    ["secp256k1", "SECP256K1"],
    ["ed25519", "ED25519"],
  ])("verifies and settles lcp's payment for the vector's option, signed with a %s key", async (_name, algorithm) => {
    const { payment, from } = await signedPayment(sdk.KeyAlgorithm[algorithm]);
    node = await casperNode({ balance: BigInt(O.amount) });
    const { signer } = await relayer(node.url);
    await start([{ network: NETWORK, signer, rpc: node.url }]);
    expect(await settler!.verify(body(payment))).toEqual({ isValid: true, payer: from });
    const settled = (await settler!.settle(body(payment))) as { transaction: string };
    expect(settled).toEqual({ success: true, transaction: expect.stringMatching(/^[0-9a-f]{64}$/), network: NETWORK, payer: from });
    // The relayer's one transaction, calling the token package's transfer_with_authorization with the authorization.
    expect([...node.sent.keys()]).toEqual([settled.transaction]);
    const v1 = (node.sent.get(settled.transaction) as Any).Version1;
    expect(JSON.stringify(v1.payload)).toContain("transfer_with_authorization");
    expect(JSON.stringify(v1.payload)).toContain(O.asset);
  });

  it("verifies and settles lcp's agreement for the vector's H, keyed by the agreement's value, beside the payment under that H: two submissions, two rows", async () => {
    // The payer echoes the legal context the resource server advertised, so lcp names the agreement's H from it.
    const doc = exactCasper.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] } as never, H as never, V.fixed.link, O as never);
    const key = sdk.PrivateKey.generate(sdk.KeyAlgorithm.SECP256K1);
    const agreement = await signedPayment(sdk.KeyAlgorithm.SECP256K1, "agreement", key, doc);
    const payment = await signedPayment(sdk.KeyAlgorithm.SECP256K1, "payment", key, doc);
    expect((agreement.payment.payload as Any).authorization.nonce).toBe(V.C5.expectMessageNonce);
    node = await casperNode({ balance: 2n * BigInt(O.amount) });
    const { signer } = await relayer(node.url);
    await start([{ network: NETWORK, signer, rpc: node.url }]);
    expect(await settler!.verify(body(agreement.payment))).toEqual({ isValid: true, payer: agreement.from });
    const a = (await settler!.settle(body(agreement.payment))) as { transaction: string };
    const p = (await settler!.settle(body(payment.payment))) as { transaction: string };
    expect([a, p]).toEqual([
      { success: true, transaction: expect.stringMatching(/^[0-9a-f]{64}$/), network: NETWORK, payer: agreement.from },
      { success: true, transaction: expect.stringMatching(/^[0-9a-f]{64}$/), network: NETWORK, payer: agreement.from },
    ]);
    expect([...node.sent.keys()]).toEqual([a.transaction, p.transaction]);
    const keyOf = (value: string) => JSON.stringify(["single-use", agreement.from, O.asset, value, null]);
    expect(await rows()).toEqual([
      [keyOf(V.C5.agreementValue), true, a.transaction],
      [keyOf(H), true, p.transaction],
    ]);
  });

  it("counts in the fee budget a transaction the node took whose answer was lost, which x402's class answers naming none, so the budget refuses the payment after it", async () => {
    node = await casperNode({ balance: BigInt(O.amount), dropPut: true });
    const { signer } = await relayer(node.url);
    // The budget is one transaction's bound, x402's default payment of 2.5 CSPR, which the stub's execution costs.
    await start([{ network: NETWORK, signer, rpc: node.url }], [{ network: NETWORK, amount: 2_500_000_000n, periodSeconds: 3_600 }]);
    const first = await signedPayment(sdk.KeyAlgorithm.ED25519);
    expect(await settler!.settle(body(first.payment))).toMatchObject({ success: false, transaction: "" });
    expect(node.sent.size).toBe(1);
    const second = await signedPayment(sdk.KeyAlgorithm.ED25519);
    await vi.waitFor(async () => expect(await settler!.verify(body(second.payment))).toEqual({ isValid: false, invalidReason: "fee_budget_spent" }), {
      timeout: 3_000,
      interval: 100,
    });
  });

  it("refuses lcp's refusal rows for a payment before the class reads or sends anything", async () => {
    node = await casperNode({ balance: BigInt(O.amount) });
    const { signer } = await relayer(node.url);
    await start([{ network: NETWORK, signer, rpc: node.url }]);
    const base = V.C2.expectPayload;
    const mutate = (changes: Record<string, unknown>) => {
      const copy = structuredClone(base);
      for (const [path, value] of Object.entries(changes)) {
        const keys = path.split(".");
        let at = copy;
        for (const k of keys.slice(0, -1)) at = at[k];
        if (value === null) delete at[keys.at(-1)!];
        else at[keys.at(-1)!] = value;
      }
      return copy;
    };
    const rows: [PaymentPayload, string][] = [
      ...V.refusals.rows
        .filter((r: Any) => r.fn === "bound" || r.fn === "reference")
        .map((r: Any): [PaymentPayload, string] => [mutate(r.mutate), r.expect.code]),
      ...V.boundAccepted.rows.map((r: Any): [PaymentPayload, string] => [{ ...base, accepted: r.accepted }, r.expect]),
    ];
    expect(rows.length).toBeGreaterThan(1);
    for (const [p, code] of rows) {
      const verified = await settler!.verify(body(p));
      const settled = await settler!.settle(body(p));
      // x402's own checks come before the module's: the version, and the network the kind is routed by.
      const first = (p as Any).x402Version !== 2 ? "invalid_x402_version" : p.accepted.network !== NETWORK ? "invalid_network" : undefined;
      if (first !== undefined) {
        expect([code, verified, settled]).toMatchObject([code, { isValid: false, invalidReason: first }, { success: false, errorReason: first, transaction: "" }]);
      } else {
        expect([code, verified, settled]).toMatchObject([code, { isValid: false, invalidMessage: code }, { success: false, errorMessage: code, transaction: "" }]);
      }
    }
    expect(node.calls).toEqual([]);
  });

  it("refuses an authorization the payee signed before anything is read or sent (the profile, rule 5)", async () => {
    node = await casperNode({ balance: BigInt(O.amount) });
    const { signer } = await relayer(node.url);
    await start([{ network: NETWORK, signer, rpc: node.url }]);
    const p = structuredClone(V.C2.expectPayload);
    p.payload.authorization.from = O.payTo;
    expect(await settler!.verify(body(p))).toMatchObject({ isValid: false, invalidReason: "invalid_payload" });
    expect(await settler!.settle(body(p))).toMatchObject({ success: false, errorReason: "invalid_payload", transaction: "" });
    expect(node.calls).toEqual([]);
  });

  // lcp's C2 payment (its validBefore passed, so x402's class refuses it) presented to /settle: the core then asks lcp's
  // read whether the nonce already landed, through the module's reader, against C4's node rows.
  it.each([
    ["row 0", () => V.C4.rows[0]],
    ["row 5", () => V.C4.rows[5]],
    ["row 12", () => V.C4.rows[12]],
    ["the plant", () => V.plant],
  ])("answers lcp's read of C4's %s at /settle as lcp's vector states it", async (_name, row) => {
    const r = row();
    node = await casperNode({ node: r.node, item: { from: V.C4.ref.from, nonce: V.C4.ref.nonce.slice(2) } });
    const { signer } = await relayer(node.url);
    await start([{ network: NETWORK, signer, rpc: node.url }]);
    const answer = (await settler!.settle(body(V.C2.expectPayload))) as Any;
    if (r.expectStatus.state === "settled") {
      expect(answer).toMatchObject({ success: false, errorReason: "invalid_transaction_state", transaction: r.expectStatus.transaction });
    } else {
      expect(r.expectStatus.state).toBe("pending");
      expect(answer).toMatchObject({ success: false, errorReason: "invalid_exact_casper_facilitator_expired", transaction: "" });
    }
    // The read reached the item and, where it was set, every transaction of its block.
    expect(node.calls.some((c) => (c.body as Any).method === "state_get_dictionary_item")).toBe(true);
    const read = node.calls.filter((c) => (c.body as Any).method === "info_get_transaction").map((c) => (c.body as Any).params.transaction_hash.Version1);
    expect(new Set(read)).toEqual(new Set(r.node.pages.flat().map((c: Any) => c.transaction)));
    expect(node.sent.size).toBe(0);
  });

  // Row 17. A CEP-3009 token keys used_nonces by the hex of blake2b-256 over the serialized pair. The known answer is
  // Casper testnet's: csprUSD (x402's default token, active contract a5a6f9ba…) holds the nonce its own
  // AuthorizationUsed event names under this key and holds nothing under the base64 of the raw pair (read 2026-11-24).
  it("reads a used nonce under the item key a CEP-3009 token writes, and finds nothing under the base64 of the raw pair", async () => {
    const live = {
      from: "000a2c6f9ed44a269366ac7816d8ebbc0d9ae0233f75388ca37365008bb36c9cd6",
      nonce: "1eab899eac0b98216e56fd6cb7a354e67138dcea9e8d8023c986d18f5ef0c669",
    };
    expect(itemKey("cep3009", live.from, live.nonce)).toBe("2d3bc98fae6ce10d6ec432aae90ba5ea2fd06504b2f41a7f377531478e32dad1");
    const settled = V.C4.rows.find((r: Any) => r.expectStatus.state === "settled");
    const asked = async (keyForm: "cep3009" | "base64") => {
      const n = await casperNode({ node: settled.node, item: { from: V.C4.ref.from, nonce: V.C4.ref.nonce.slice(2) }, keyForm });
      node = n;
      const { signer } = await relayer(n.url);
      await start([{ network: NETWORK, signer, rpc: n.url }]);
      const answer = (await settler!.settle(body(V.C2.expectPayload))) as Any;
      const keys = n.calls.filter((c) => (c.body as Any).method === "state_get_dictionary_item" && (c.body as Any).params.dictionary_identifier.ContractNamedKey.dictionary_name === "used_nonces");
      await settler!.close();
      await n.close();
      settler = undefined;
      node = undefined;
      return { answer, keys: keys.map((c) => (c.body as Any).params.dictionary_identifier.ContractNamedKey.dictionary_item_key) };
    };
    const cep = await asked("cep3009");
    expect(cep.answer).toMatchObject({ success: false, errorReason: "invalid_transaction_state", transaction: settled.expectStatus.transaction });
    expect(new Set(cep.keys)).toEqual(new Set([itemKey("cep3009", V.C4.ref.from, V.C4.ref.nonce.slice(2))]));
    // The twin: the same landed history held under the base64 of the raw pair is not a CEP-3009 token's, and the
    // settler's read does not find it there.
    const raw = await asked("base64");
    expect(raw.answer).toMatchObject({ success: false, errorReason: "invalid_exact_casper_facilitator_expired", transaction: "" });
  });
});
