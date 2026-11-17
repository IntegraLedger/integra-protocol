import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, pairingOf } from "../src/index.js";
import type { PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const vectors = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../vectors/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;

const at = (v: unknown, path: string): PaymentRequirements =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], v) as PaymentRequirements;

// Each pairing's fixed option from its vector file, and the pairing id that names it.
const ROWS: readonly [file: string, path: string, id: string][] = [
  ["x402-exact-eip155-eip3009", "fixed.O", "x402/exact/eip155/eip3009"],
  ["x402-exact-eip155-permit2", "fixed.option", "x402/exact/eip155/permit2"],
  ["x402-exact-eip155-erc7710", "fixed.option", "x402/exact/eip155/erc7710"],
  ["x402-exact-eip155-gateway-batched", "fixed.O2", "x402/exact/eip155/gateway-batched"],
  ["x402-upto-eip155-permit2", "fixed.option", "x402/upto/eip155/permit2"],
  ["x402-auth-capture-eip155-eip3009", "fixed.option", "x402/auth-capture/eip155/eip3009"],
  ["x402-auth-capture-eip155-permit2", "fixed.option", "x402/auth-capture/eip155/permit2"],
  ["x402-batch-settlement", "fixed.evm.option", "x402/batch-settlement/eip155"],
  ["x402-batch-settlement", "fixed.svm.option", "x402/batch-settlement/solana"],
  ["x402-batch-settlement", "EC1.payload.accepted", "x402/batch-settlement/cloudflare"],
  ["x402-exact-algorand", "fixed.O", "x402/exact/algorand"],
  ["x402-exact-aptos", "fixed.O", "x402/exact/aptos"],
  ["x402-exact-cardano", "fixed.O", "x402/exact/cardano"],
  ["x402-exact-cardano", "fixed.OLock", "x402/exact/cardano/lock"],
  ["x402-exact-casper", "fixed.O", "x402/exact/casper"],
  ["x402-exact-ccd", "fixed.O", "x402/exact/ccd"],
  ["x402-exact-hedera", "fixed.O", "x402/exact/hedera"],
  ["x402-exact-hedera-transfer-executor", "fixed.O", "x402/exact/hedera/transfer-executor"],
  ["x402-exact-lnbtc", "fixed.O", "x402/exact/lnbtc/payment-hash"],
  ["x402-exact-near", "fixed.O", "x402/exact/near"],
  ["x402-exact-polkadot-lcp-assets-remark", "fixed.O", "x402/exact/polkadot/lcp-assets-remark"],
  ["x402-exact-solana", "fixed.option", "x402/exact/solana"],
  ["x402-upto-solana", "fixed.option", "x402/upto/solana"],
  ["x402-upto-xrpl", "fixed.O", "x402/upto/xrpl"],
  ["x402-exact-starknet", "fixed.O", "x402/exact/starknet"],
  ["x402-exact-stellar-precondition", "fixed.option", "x402/exact/stellar/precondition"],
  ["x402-exact-sui", "fixed.O", "x402/exact/sui"],
  ["x402-exact-tron-lcp-trc20-memo", "fixed.O", "x402/exact/tron/lcp-trc20-memo"],
  ["x402-exact-tvm", "fixed.O", "x402/exact/tvm"],
  ["x402-exact-xrpl", "fixed.option", "x402/exact/xrpl"],
];

describe("the root pairingOf, walking BINDINGS", () => {
  for (const [file, path, id] of ROWS) {
    it(`names ${id} for ${file}'s ${path}`, () => expect(pairingOf(at(vectors(file), path))).toBe(id));
  }

  // Every option x402-batch-settlement.json holds (the fixed EVM and Solana options, ES4's and EC1's accepted options,
  // and the buyer rows' documents and payments) names its pairing by its network's CAIP-2 namespace, but the options of
  // its boundAccepted rows, which no pairing's read offers.
  it("names the batch-settlement pairing of every option in x402-batch-settlement.json", () => {
    const byNamespace: Record<string, string> = {
      eip155: "x402/batch-settlement/eip155",
      solana: "x402/batch-settlement/solana",
      cloudflare: "x402/batch-settlement/cloudflare",
    };
    const options: [string, PaymentRequirements][] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v !== "object" || v === null) return;
      if (!Array.isArray(v) && "scheme" in v && "network" in v) options.push([path, v as PaymentRequirements]);
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(vectors("x402-batch-settlement"), "x402-batch-settlement");
    // EB10's expected references hold a network and a scheme member, the deposit method: they are no option.
    const references = options.filter(([path]) => path.endsWith(".expectRef"));
    expect(references.map(([path]) => path)).toEqual(["x402-batch-settlement.EB10.eip3009.expectRef", "x402-batch-settlement.EB10.permit2.expectRef"]);
    const offered = rowsOf(
      options.filter(([path]) => !path.endsWith(".expectRef")),
      "x402-batch-settlement.json, every option it holds",
      {
        keep: ["the options outside boundAccepted", ([path]) => !path.startsWith("x402-batch-settlement.boundAccepted.")],
        leave: ["boundAccepted's options, which no read offers", ([path]) => path.startsWith("x402-batch-settlement.boundAccepted.")],
      },
    );
    for (const [path, o] of offered) {
      expect(o.scheme, path).toBe("batch-settlement");
      expect(pairingOf(o), path).toBe(byNamespace[o.network.split(":")[0]!]);
    }
    expect(new Set(offered.map(([, o]) => pairingOf(o)))).toEqual(new Set(Object.values(byNamespace)));
  });

  it("names nothing for an option no pairing serves", () => {
    const o = at(vectors("x402-exact-eip155-eip3009"), "fixed.O");
    expect(pairingOf({ ...o, scheme: "unknown" })).toBeUndefined();
    expect(pairingOf({ ...o, network: "bogus:1" })).toBeUndefined();
    expect(pairingOf(null as unknown as PaymentRequirements)).toBeUndefined();
  });
});
