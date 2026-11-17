// The NEAR module through the settler's HTTP surface, against lcp's vectors for x402/exact/near: V2's signed delegate
// action, built and signed from the vector's seed, and its refusals. @x402/near 2.31.0's class runs unchanged and checks
// the delegate's signature itself; its signer object, the node boundary it takes, answers the node's state as the
// vector fixes it: the payer's access key at nonce `accessKeyNonce` and the final height `finalHeight`.
import { readFileSync } from "node:fs";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { FacilitatorNearSigner } from "@x402/near";
import { afterEach, describe, expect, it } from "vitest";
import { serveSettler } from "../src/core.js";
import { listed } from "../src/modules/index.js";
import { starter, type NearConfig } from "../src/modules/near/index.js";
import { CREDENTIAL, serving, type Serving } from "./routes.js";

const V = JSON.parse(readFileSync(new URL("../../lcp/vectors/x402-exact-near.json", import.meta.url), "utf8"));
const NETWORK = V.fixed.O.network as "near:testnet";
const O: PaymentRequirements = V.fixed.O;
/** The seller's relayer account in this test; any account but the payer's. */
const RELAYER = "relayer.testnet";
/** The relayer's transaction, as the node would name it once submitted. */
const RELAYED = "9h7gq1tCuBVTp1tZ8bQ6fnA6jEZXdQ3JDKnQ6Wq3dXn5";
const LIST = [listed("near", async () => ({ starter }))] as const;

let settler: Serving | undefined;
afterEach(async () => {
  await settler?.close();
  settler = undefined;
});

const payment = (signedDelegateAction: string, accepted: PaymentRequirements = O): PaymentPayload => ({
  x402Version: 2,
  accepted,
  payload: { signedDelegateAction },
});
const body = (p: PaymentPayload) => ({ x402Version: 2, paymentPayload: p, paymentRequirements: p.accepted });

/** The class's signer object: the node's state as the vector fixes it, each call recorded. */
function signerStub(calls: string[]): FacilitatorNearSigner {
  return {
    getRelayerIds: () => [RELAYER],
    async getCurrentBlockHeight() {
      calls.push("height");
      return BigInt(V.fixed.finalHeight);
    },
    async viewAccessKey() {
      calls.push("accessKey");
      return { nonce: BigInt(V.fixed.accessKeyNonce), permissionKind: "FullAccess" };
    },
    async viewAccount() {
      calls.push("account");
      return { codeHash: "E8jZ1giWcVrps8PcV75ATauu6gFRkcwjNtKp7NKmipZG" };
    },
    async ftBalanceOf() {
      calls.push("balance");
      return BigInt(O.amount);
    },
    async storageBalanceOf() {
      calls.push("storage");
      return { supported: true, registered: true };
    },
    async submitSignedDelegateAction() {
      calls.push("submit");
      return { transaction: RELAYED, innerReceipt: { kind: "success", value: "" } };
    },
  };
}

async function start(near: readonly NearConfig[]) {
  settler = await serving((port, url) =>
    serveSettler({ listen: `127.0.0.1:${port}`, store: { url }, settleWaitMs: 3_000, credential: CREDENTIAL, operatorLog: () => {}, near }, LIST),
  );
}

describe("the NEAR module", () => {
  it("states the pairing it submits, its relayer key and account, and that it does not take zero", async () => {
    await start([{ network: NETWORK, signer: signerStub([]), rpc: "http://127.0.0.1:9" }]);
    expect(await settler!.supported()).toEqual({
      kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { key: "relayer", acceptsZero: false, pairings: ["x402/exact/near"] } }],
      extensions: [],
      signers: { "near:*": [RELAYER] },
    });
  });

  it("verifies V2's signed delegate action and settles it through the relayer", async () => {
    const calls: string[] = [];
    await start([{ network: NETWORK, signer: signerStub(calls), rpc: "http://127.0.0.1:9" }]);
    const p = payment(V.V2.expectSignedDelegateAction);
    expect(await settler!.verify(body(p))).toEqual({ isValid: true, payer: V.fixed.payer });
    expect(await settler!.settle(body(p))).toEqual({ success: true, transaction: RELAYED, network: NETWORK, payer: V.fixed.payer });
    expect(calls.filter((c) => c === "submit")).toHaveLength(1);
  });

  it("refuses lcp's refusal vectors before the class reads or submits anything", async () => {
    const calls: string[] = [];
    await start([{ network: NETWORK, signer: signerStub(calls), rpc: "http://127.0.0.1:9" }]);
    const rows: [PaymentPayload, string][] = [
      ...V.V2.refusals.map((r: { signedDelegateAction: string }): [PaymentPayload, string] => [payment(r.signedDelegateAction), "invalid_payload"]),
      ...V.V2.presentedOptions
        .filter((r: { expect?: string }) => r.expect !== undefined)
        .map((r: { accepted: PaymentRequirements }): [PaymentPayload, string] => [payment(V.V2.expectSignedDelegateAction, r.accepted), "invalid_payment_requirements"]),
    ];
    expect(rows.length).toBeGreaterThan(1);
    for (const [p, reason] of rows) {
      expect(await settler!.verify(body(p))).toMatchObject({ isValid: false, invalidReason: reason });
      expect(await settler!.settle(body(p))).toMatchObject({ success: false, errorReason: reason, transaction: "" });
    }
    expect(calls).toEqual([]);
  });
});
