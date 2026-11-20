// ap2/checkout-mandate/x402 against vectors/ap2-checkout-mandate-x402.json: H read from the checkout mandate as on
// ap2/checkout-mandate, once AP2's x402 credential's authorization nonce is keccak-256 of its payment mandate chain and
// that chain's closed Payment Mandate names this checkout; the reference giving x402/exact/eip155/eip3009's keys by the
// authorization's nonce, so that pairing's status reads the route; the payee broadcasting.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVM_NETWORK_CHAIN_ID_MAP } from "@x402/evm/v1";
import { checkoutMandateX402, x402MethodNetwork } from "../src/ap2.js";
import type { Hex } from "../src/evm-abi.js";
import type { EvmReader } from "../src/internal/evm.js";
import { exactEip3009 } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/ap2-checkout-mandate-x402.json", import.meta.url), "utf8"));
const A = JSON.parse(readFileSync(new URL("../vectors/ap2-checkout-mandate.json", import.meta.url), "utf8"));
const presented = (payment: unknown) => ({ checkout_mandate: A.built.M, checkout_jwt: A.built.J, payment });

describe("ap2/checkout-mandate/x402", () => {
  for (const row of rowsOf<{ case: string; payment: unknown; expect?: string; expectRefusal?: string }>(V.bound, "bound rows", { min: 7 })) {
    it(`bound: ${row.case}`, async () => {
      const r = await checkoutMandateX402.bound(presented(row.payment));
      if (row.expectRefusal !== undefined) expect(r).toEqual({ refused: true, code: row.expectRefusal });
      else expect(r).toBe(row.expect);
    });
  }

  it("bound reads the mandate first: a checkout JWT the mandate does not commit to", async () => {
    const r = await checkoutMandateX402.bound({ ...presented(V.fixed.bundle), checkout_jwt: A.built.J.slice(0, -1) + (A.built.J.endsWith("A") ? "B" : "A") });
    expect(r).toEqual({ refused: true, code: "ap2/checkout-not-latest" });
  });

  for (const row of rowsOf<{ case: string; option: unknown; expect?: unknown; expectRefusal?: string }>(V.reference, "reference rows", { min: 2 })) {
    it(`reference: ${row.case}`, async () => {
      const r = await checkoutMandateX402.reference(presented(V.fixed.bundle), row.option as never);
      expect(r).toEqual(row.expectRefusal !== undefined ? { refused: true, code: row.expectRefusal } : row.expect);
    });
  }

  it("names each x402 v1 EVM network of @x402/evm 2.31.0's map in CAIP-2 by its chain id, as x402MethodNetwork does", async () => {
    const names = rowsOf(Object.entries(EVM_NETWORK_CHAIN_ID_MAP), "@x402/evm/v1's EVM_NETWORK_CHAIN_ID_MAP", { min: 20 });
    for (const [network, id] of names) {
      const r = await checkoutMandateX402.reference(presented(V.fixed.bundle), { ...V.fixed.method, network });
      expect([(r as { network: string }).network, x402MethodNetwork(network)], network).toEqual([`eip155:${id}`, `eip155:${id}`]);
    }
  });

  it("the reference holds x402/exact/eip155/eip3009's for the same authorization, the nonce in H's place", async () => {
    const a = V.fixed.bundle.eip_3009_payload.authorization;
    const option = {
      scheme: "exact",
      network: "eip155:84532",
      asset: V.fixed.method.asset,
      amount: a.value,
      payTo: V.fixed.method.address,
      maxTimeoutSeconds: 3600,
      extra: { name: "USDC", version: "2" },
    };
    const x402 = { x402Version: 2, accepted: option, payload: { signature: "0x" + "ab".repeat(65), authorization: { ...a, nonce: "0x" + a.nonce } } };
    const carried = await exactEip3009.reference(x402 as never, option as never);
    expect(carried).not.toHaveProperty("refused");
    const route = await checkoutMandateX402.reference(presented(V.fixed.bundle), V.fixed.method);
    expect(route).toMatchObject(carried as object);
  });

  it("x402/exact/eip155/eip3009's status reads the route by its reference: settled on the token's two logs", async () => {
    const ref = (await checkoutMandateX402.reference(presented(V.fixed.bundle), V.fixed.method)) as never as {
      bindingLog: { value: Hex };
      asset: Hex;
    };
    const a = V.fixed.bundle.eip_3009_payload.authorization;
    const word = (x: string) => ("0x" + "00".repeat(12) + x.slice(2).toLowerCase()) as Hex;
    const used: Hex = V.reference[0].expect.bindingLog.topic0;
    const transfer: Hex = V.reference[0].expect.transferLog.topic0;
    const logs = [
      { address: ref.asset, topics: [used, word(a.from), ref.bindingLog.value], data: "0x" as Hex },
      { address: ref.asset, topics: [transfer, word(a.from), word(a.to)], data: ("0x" + BigInt(a.value).toString(16).padStart(64, "0")) as Hex },
    ];
    const TX = ("0x" + "11".repeat(32)) as Hex;
    const reader: EvmReader = {
      network: "eip155:84532",
      receipt: async () => ({ status: 1, blockNumber: 100n, logs }),
      blockNumber: async () => 100n,
      transaction: async () => null,
      // authorizationState: the nonce read unused, as the read reads it before it classifies what landed.
      call: async () => ("0x" + "00".repeat(32)) as Hex,
    };
    const answer = await exactEip3009.status({ ...ref, transaction: TX, h: ref.bindingLog.value } as never, reader, {
      act: "payment",
      finality: "finalized",
    });
    expect(answer).toMatchObject({ state: "settled", transaction: TX, position: 100n, finality: "finalized" });
  });

  it("the payee broadcasts", async () => {
    expect(await checkoutMandateX402.broadcaster(presented(V.fixed.bundle))).toBe("payee");
    expect(await checkoutMandateX402.broadcaster("not an object")).toEqual({ refused: true, code: "ap2/mandate-malformed" });
  });
});
