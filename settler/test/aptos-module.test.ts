// The Aptos module through the settler's HTTP surface, against lcp's vectors for x402/exact/aptos. lcp's file holds no
// signed payment (its signature is made by a key generated at each of lcp's runs), and @x402/aptos 2.31.0's verify reads
// the balance and simulates through the public endpoint of the network's name, which no test may call; so what is held
// here is what the module states and lcp's refusals of the payment, each answered before the class is asked.
import { readFileSync } from "node:fs";
import { createClientSigner, ExactAptosScheme, type FacilitatorAptosSigner } from "@x402/aptos";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveSettler } from "../src/core.js";
import { NODE_MAX_BYTES } from "../src/http.js";
import { aptosReader, starter, type AptosConfig } from "../src/modules/aptos/index.js";
import { listed } from "../src/modules/index.js";
import type { FeeMeter } from "../src/module.js";
import { testCore } from "./own-core.js";
import { CREDENTIAL, routes, serving, Status, type Serving } from "./routes.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-aptos.json", import.meta.url), "utf8"));
const NETWORK = V.fixed.O.network as `aptos:${number}`;
const FEE_PAYER: string = V.fixed.fixtureF.feePayer;
const LIST = [listed("aptos", async () => ({ starter }))] as const;

let settler: Serving | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await settler?.close();
  settler = undefined;
});

/** The class's signer object: every call recorded, none expected. */
function signerStub(calls: string[]): FacilitatorAptosSigner {
  const record = (name: string) => async () => {
    calls.push(name);
    throw new Error(`${name} was called`);
  };
  return {
    getAddresses: () => [FEE_PAYER],
    signAndSubmitAsFeePayer: record("signAndSubmitAsFeePayer"),
    submitTransaction: record("submitTransaction"),
    simulateTransaction: record("simulateTransaction"),
    waitForTransaction: record("waitForTransaction"),
  };
}

async function start(aptos: readonly AptosConfig[]) {
  settler = await serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, aptos }, LIST),
  );
}

describe("the Aptos module", () => {
  it("states the pairing it submits, its fee-payer key and address where it sponsors, and that it does not take zero", async () => {
    await start([{ network: NETWORK, signer: signerStub([]), node: "http://127.0.0.1:9" }]);
    expect(await settler!.supported()).toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { feePayer: FEE_PAYER, key: "fee-payer", acceptsZero: false, pairings: ["x402/exact/aptos"] } }],
      extensions: [],
      signers: { "aptos:*": [FEE_PAYER] },
    });
  });

  it("with sponsoring off, names no signer and refuses a payment whose option names its address as extra.feePayer before the class, which would pay its gas", async () => {
    // x402's own client builds the payment against a node that answers what its SDK reads to build it: the
    // transfer's module ABI (0x1::primary_fungible_store, as published), the gas price and the sender's account.
    const node = await routes((path) => {
      if (path === "/v1/accounts/0x1/module/primary_fungible_store") {
        const transfer = { name: "transfer", visibility: "public", is_entry: true, is_view: false, generic_type_params: [{ constraints: ["key"] }], params: ["&signer", "0x1::object::Object<T0>", "address", "u64"], return: [] };
        return { bytecode: "0x", abi: { address: "0x1", name: "primary_fungible_store", friends: [], exposed_functions: [transfer], structs: [] } };
      }
      if (path === "/v1/estimate_gas_price") return { gas_estimate: Number(V.fixed.fixtureF.gasUnitPrice) };
      if (path.startsWith("/v1/accounts/")) return { sequence_number: V.fixed.fixtureF.sequenceNumber, authentication_key: `0x${"00".repeat(32)}` };
      return new Status(404, {});
    });
    const named: PaymentRequirements = { ...V.fixed.O, extra: { feePayer: FEE_PAYER } };
    // Built at the fixture's time, which the payment's expiry follows by its SDK's few seconds; checked a day later,
    // past that expiry, so that the class, if asked, refuses it before it reads the network's public endpoint.
    const builtAt = Number(V.fixed.fixtureF.expiresAt) * 1000;
    vi.useFakeTimers({ toFake: ["Date"], now: builtAt });
    let payment: PaymentPayload;
    try {
      const built = await new ExactAptosScheme(await createClientSigner(`0x${"11".repeat(32)}`), { rpcUrl: `${node.url}/v1` }).createPaymentPayload(2, named);
      payment = { ...built, accepted: named, resource: V.fixed.resource, extensions: { legalContext: { info: { type: "sha256", value: V.fixed.H, legalContextUrl: V.fixed.link } } } } as PaymentPayload;
    } finally {
      await node.close();
    }
    vi.setSystemTime(builtAt + 86_400_000);
    const calls: string[] = [];
    await start([{ network: NETWORK, signer: signerStub(calls), node: "http://127.0.0.1:9", sponsor: false }]);
    expect(await settler!.supported()).toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { key: "none", acceptsZero: false, pairings: ["x402/exact/aptos"] } }],
      extensions: [],
      signers: { "aptos:*": [] },
    });
    const b = { x402Version: 2, paymentPayload: payment, paymentRequirements: named };
    expect(await settler!.verify(b)).toEqual({ isValid: false, invalidReason: "invalid_payment_requirements" });
    expect(await settler!.settle(b)).toMatchObject({ success: false, errorReason: "invalid_payment_requirements", transaction: "" });
    expect(calls).toEqual([]);
  });

  it("refuses the payment under each option lcp's filter refuses before the class reads or signs anything", async () => {
    const calls: string[] = [];
    await start([{ network: NETWORK, signer: signerStub(calls), node: "http://127.0.0.1:9" }]);
    const payment: PaymentPayload = V.boundAccepted.payment;
    const rows = V.boundAccepted.rows as { accepted: PaymentPayload["accepted"]; expect: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const p = { ...payment, accepted: row.accepted };
      const b = { x402Version: 2, paymentPayload: p, paymentRequirements: row.accepted };
      expect(await settler!.verify(b)).toMatchObject({ isValid: false });
      expect(await settler!.settle(b)).toMatchObject({ success: false, transaction: "" });
    }
    expect(calls).toEqual([]);
  });

  it("hands x402's class its fee payer with each transaction it sponsors given to the fee meter, one whose wait threw among them, which the class answers naming none", async () => {
    // x402's class reads the network's public endpoint before it sends, so the signer object it holds is called here
    // as its settle calls it: the sponsored submission, then the wait, which throws.
    const counted: string[] = [];
    const meter: FeeMeter = { sending: async () => true, included: () => {}, sent: (transaction) => void counted.push(transaction) };
    const hash = `0x${"ab".repeat(32)}`;
    const calls: string[] = [];
    const signer: FacilitatorAptosSigner = {
      ...signerStub(calls),
      signAndSubmitAsFeePayer: async () => ({ hash }) as never,
      waitForTransaction: async () => {
        throw new Error("the wait timed out");
      },
    };
    const { registrations } = await starter.start([{ network: NETWORK, signer, node: "http://127.0.0.1:9" }], testCore({ meter: meter as never }));
    const held = (registrations[0]!.module.facilitator as unknown as { signer: FacilitatorAptosSigner }).signer;
    const transaction = { rawTransaction: { max_gas_amount: 200_000n, gas_unit_price: 100n } } as never;
    const pending = await held.signAndSubmitAsFeePayer(transaction, {} as never, NETWORK);
    await expect(held.waitForTransaction(pending.hash, NETWORK)).rejects.toThrow("the wait timed out");
    expect(counted).toEqual([hash, hash]);
  });

  it("names the node by its origin alone in a failed call's error, which reaches the operator log", async () => {
    const node = await routes(() => "x".repeat(NODE_MAX_BYTES));
    try {
      // A hosted endpoint's path can hold the operator's API key.
      const keyed = `${node.url}/key-in-path`;
      await expect(aptosReader(NETWORK, keyed, performance.now() + 5_000).ledger()).rejects.toMatchObject({ message: `too-large: ${node.url}` });
      await expect(aptosReader(NETWORK, keyed, performance.now() - 1).ledger()).rejects.toMatchObject({ message: `spent: ${node.url}` });
    } finally {
      await node.close();
    }
  });
});
