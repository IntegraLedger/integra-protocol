// The Algorand module against lcp's vectors for x402/exact/algorand, through the settler's HTTP surface: @x402/avm
// 2.31.0's class runs unchanged, and the module's own path takes the rekeyed payer who signs with one key; the signer
// object, the node boundary both take, is a stub that records each call and answers as algod does for a group that
// simulates clean and confirms. Every expected answer is the vector's: a refusal's code, the payment's id.
import { readFileSync } from "node:fs";
import { decodeSignedTransaction, encodeSignedTransaction, generateAddressWithSigners } from "@algorandfoundation/algokit-utils/transact";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { FacilitatorAvmSigner } from "@x402/avm";
import { ExactAvmScheme } from "@x402/avm/exact/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, describe, expect, it } from "vitest";
import { serveSettler } from "../src/core.js";
import type { X402Payment } from "../src/module.js";
import { algorandRegistration, starter } from "../src/modules/algorand/index.js";
import { listed } from "../src/modules/index.js";
import { CREDENTIAL, routes, serving, Status, type Routes, type Serving } from "./routes.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
const NETWORK = V.fixed.network as `algorand:${string}`;
const OPTION: PaymentRequirements = V.fixed.O;
const FEE_PAYER = V.fixed.O.extra.feePayer as string;

/** msgpack of a signed transaction, `{sig, txn}`, over the transaction's own msgpack (`TX` prefix removed). */
function signed(raw: Uint8Array): Uint8Array {
  const txn = raw[0] === 0x54 && raw[1] === 0x58 ? raw.subarray(2) : raw;
  const head = Uint8Array.of(0x82, 0xa3, 0x73, 0x69, 0x67, 0xc4, 0x40);
  const key = Uint8Array.of(0xa3, 0x74, 0x78, 0x6e);
  return Buffer.concat([head, new Uint8Array(64), key, txn]);
}

/** The class's signer object for the vector's fee payer: each node call recorded, answered as algod answers it. */
function signerStub(calls: string[]): FacilitatorAvmSigner {
  return {
    getAddresses: () => [FEE_PAYER],
    async signTransaction(txn) {
      calls.push("sign");
      return signed(txn);
    },
    getAlgodClient: () => {
      throw new Error("the class reads no algod client of its own");
    },
    async simulateTransactions() {
      calls.push("simulate");
      return { txnGroups: [{ txnResults: [] }] } as never;
    },
    async sendTransactions() {
      calls.push("send");
      return V.V2.expectPaymentTxid;
    },
    async waitForConfirmation() {
      calls.push("wait");
      return { confirmedRound: 1000n } as never;
    },
  };
}

let indexer: Routes | undefined;
let settler: Serving | undefined;
afterEach(async () => {
  await settler?.close();
  await indexer?.close();
  settler = indexer = undefined;
});

/** The settler with the module on the vector's network; its Indexer holds nothing yet. */
async function serve(calls: string[]): Promise<Serving> {
  indexer = await routes(() => new Status(404, { message: "no transaction found" }));
  const algorand = [{ network: NETWORK, signer: signerStub(calls), indexer: indexer.url }];
  const LIST = [listed("algorand", async () => ({ starter }))] as const;
  settler = await serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, algorand }, LIST),
  );
  return settler;
}

const body = (p: PaymentPayload) => ({ x402Version: 2, paymentPayload: p, paymentRequirements: p.accepted });

function payment(paymentGroup: string[], paymentIndex: number, accepted: PaymentRequirements = OPTION): X402Payment {
  const payload: PaymentPayload = { x402Version: 2, accepted, payload: { paymentGroup, paymentIndex } };
  return { payload, requirements: accepted };
}

const group = (paymentGroup: string[], paymentIndex: number): PaymentPayload => payment(paymentGroup, paymentIndex).payload;

describe("the Algorand module through the settler's HTTP surface", () => {
  it("states the pairing it submits, the fee-payer key and its signer, and that it takes zero", async () => {
    const s = await serve([]);
    expect(await s.supported()).toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { feePayer: FEE_PAYER, key: "fee-payer", acceptsZero: true, pairings: ["x402/exact/algorand"] } }],
      extensions: [],
      signers: { "algorand:*": [FEE_PAYER] },
    });
  });

  it("verifies V2's group and settles it under the vector's payment id, sending it once", async () => {
    const calls: string[] = [];
    const s = await serve(calls);
    const p = group(V.V2.expectPaymentGroup, V.V2.expectPaymentIndex);
    expect(await s.verify(body(p))).toEqual({ isValid: true, payer: V.fixed.payer });
    expect(await s.settle(body(p))).toEqual({ success: true, transaction: V.V2.expectPaymentTxid, network: NETWORK, payer: V.fixed.payer });
    expect(await s.settle(body(p))).toEqual({ success: false, errorReason: "invalid_transaction_state", transaction: V.V2.expectPaymentTxid, network: NETWORK });
    expect(calls.filter((c) => c === "send")).toEqual(["send"]);
  });

  it("refuses V2's group, which holds the fee payer's zero payment, under the vector's option with no extra.feePayer, before the key signs anything (the profile's rule 7: with no fee payer the buyer pays its own fee)", async () => {
    const calls: string[] = [];
    const s = await serve(calls);
    const { extra: _named, ...unnamed } = OPTION;
    const p = payment(V.V2.expectPaymentGroup, V.V2.expectPaymentIndex, unnamed as PaymentRequirements).payload;
    expect(await s.verify(body(p))).toMatchObject({ isValid: false, invalidReason: "invalid_exact_avm_invalid_fee_payer" });
    expect(await s.settle(body(p))).toMatchObject({ success: false, errorReason: "invalid_exact_avm_invalid_fee_payer", transaction: "" });
    expect(calls).toEqual([]);
  });

  it("refuses every authority lcp refuses, a logic signature's entry and a clawback's among them, before anything is signed or sent", async () => {
    const calls: string[] = [];
    const s = await serve(calls);
    const rows = V.V3.authorities.rows.filter((x: { expect?: string }) => typeof x.expect === "string");
    const codes = rows.map((x: { expect: string }) => x.expect);
    expect([codes.includes("avm/logic-signature"), codes.includes("avm/clawback")]).toEqual([true, true]);
    for (const row of rows) {
      const p = group(row.paymentGroup, row.paymentIndex);
      expect([row.case, await s.verify(body(p))]).toEqual([row.case, { isValid: false, invalidReason: "invalid_payload", invalidMessage: row.expect }]);
      expect([row.case, await s.settle(body(p))]).toEqual([row.case, { success: false, errorReason: "invalid_payload", errorMessage: row.expect, transaction: "", network: NETWORK }]);
    }
    expect(calls).toEqual([]);
  });
});

describe("a rekeyed payer who signs with one key, through the own path", () => {
  // lcp's rows carry V2's signature, the payer's own key's, beside an sgnr naming another key: the class checks the
  // signature against the sender's key and so takes both; the own path checks it against the key sgnr names.
  it("refuses lcp's rekeyed rows, whose signature is not by the key sgnr names (the fee payer's, the payee's), before anything is signed or sent", async () => {
    const rows = V.V3.authorities.rows.filter((x: { authority: string }) => x.authority === "rekeyedFeePayer" || x.authority === "rekeyedPayee");
    expect(rows).toHaveLength(2);
    const before: string[] = [];
    const cls = new ExactAvmScheme(signerStub(before));
    for (const row of rows) {
      const p = group(row.paymentGroup, row.paymentIndex);
      expect([row.case, await cls.verify(p, OPTION)]).toEqual([row.case, { isValid: true, payer: V.fixed.payer }]);
    }
    const calls: string[] = [];
    const s = await serve(calls);
    for (const row of rows) {
      const p = group(row.paymentGroup, row.paymentIndex);
      expect([row.case, await s.settle(body(p))]).toMatchObject([row.case, { success: false, errorReason: "invalid_exact_avm_invalid_signature", transaction: "" }]);
    }
    expect(calls).toEqual([]);
  });

  it("settles V2's transaction signed by the key the payer's account is rekeyed to, which the class refuses", async () => {
    // algokit-utils' own signer, over a throwaway key: signing another account's transaction, it sets sgnr.
    const secret = new Uint8Array(32).fill(9);
    const key = generateAddressWithSigners({ ed25519Pubkey: ed25519.getPublicKey(secret), rawEd25519Signer: async (m) => ed25519.sign(m, secret) });
    const entry = decodeSignedTransaction(Buffer.from(V.V2.expectPaymentGroup[V.V2.expectPaymentIndex], "base64"));
    const [bytes] = await key.signer([entry.txn], [0]);
    expect(decodeSignedTransaction(bytes!).authAddress?.toString()).toBe(key.addr.toString());
    const paymentGroup = [...V.V2.expectPaymentGroup];
    paymentGroup[V.V2.expectPaymentIndex] = Buffer.from(encodeSignedTransaction(decodeSignedTransaction(bytes!))).toString("base64");
    const p = group(paymentGroup, V.V2.expectPaymentIndex);
    expect(await new ExactAvmScheme(signerStub([])).verify(p, OPTION)).toMatchObject({ isValid: false, invalidReason: "invalid_exact_avm_invalid_signature" });
    const calls: string[] = [];
    const s = await serve(calls);
    expect(await s.verify(body(p))).toEqual({ isValid: true, payer: V.fixed.payer });
    expect(await s.settle(body(p))).toEqual({ success: true, transaction: V.V2.expectPaymentTxid, network: NETWORK, payer: V.fixed.payer });
    expect(calls.filter((c) => c === "send")).toEqual(["send"]);
  });
});

describe("the Algorand module's record", () => {
  it("names each authority lcp admits by its transaction id, reading no node", async () => {
    const calls: string[] = [];
    const r = algorandRegistration({ network: NETWORK, signer: signerStub(calls), indexer: "http://127.0.0.1:9" });
    for (const row of V.V3.authorities.rows.filter((x: { expectReference?: unknown }) => x.expectReference !== undefined)) {
      const at = await r.module.record.instrument(payment(row.paymentGroup, row.paymentIndex));
      expect([row.case, at]).toMatchObject([row.case, { instrument: { by: "transaction", transaction: row.expectReference.txid } }]);
    }
    expect(calls).toEqual([]);
  });
});
