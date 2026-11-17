// mpp-x402-mapping.json: an MPP evm authorization or usdc EVM credential mapped to x402's exact EIP-3009 payment.
// Each row's mapped payment is the file's, and the EIP-712 digest x402's verification builds from it (its
// TransferWithAuthorization over {name, version, chainId, verifyingContract: asset}, as @x402/evm's verifyEIP3009
// builds it) is the digest the payer signed, which recovers the payer; and x402's own verification, @x402/evm's
// ExactEvmScheme, answers each row's `verifyAt` over the mapped payment at each second the row names, its `maxTimeoutSeconds`
// being the challenge's `expires` less `issued`. Its facilitator signer reads no chain. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress, hashTypedData, recoverTypedDataAddress } from "viem";
import { toX402, type X402Mapped } from "../src/mpp.js";
import { isRefusal } from "../src/index.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-x402-mapping.json", import.meta.url), "utf8"));

/** x402's typed data for an exact EIP-3009 payment, from its requirements and payload alone. */
function x402TypedData(m: X402Mapped) {
  const req = m.paymentRequirements;
  const a = (m.paymentPayload.payload as { authorization: Record<string, string> }).authorization;
  return {
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization" as const,
    domain: {
      name: req.extra!["name"] as string,
      version: req.extra!["version"] as string,
      chainId: Number(req.network.split(":")[1]),
      verifyingContract: req.asset as `0x${string}`,
    },
    message: {
      from: a["from"] as `0x${string}`,
      to: a["to"] as `0x${string}`,
      value: BigInt(a["value"]!),
      validAfter: BigInt(a["validAfter"]!),
      validBefore: BigInt(a["validBefore"]!),
      nonce: a["nonce"] as `0x${string}`,
    },
  };
}

/**
 * A facilitator signer that reads no chain: code at `asset` and none elsewhere, and every contract read, the transfer's
 * simulation, answered without a revert.
 */
function signerWithAsset(asset: string) {
  return {
    getAddresses: () => [] as `0x${string}`[],
    getCode: async ({ address }: { address: string }) => (getAddress(address) === getAddress(asset) ? "0x6080" : "0x"),
    readContract: async () => undefined,
  } as unknown as ConstructorParameters<typeof ExactEvmScheme>[0];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mpp-x402-mapping.json", () => {
  for (const row of rowsOf(V.rows, "mpp-x402-mapping.json rows", { exact: 2 })) {
    it(`${row.case}: x402's verification at each second of verifyAt`, async () => {
      const m = toX402(row.credential, row.token, row.issued) as X402Mapped;
      expect(m).toEqual(row.expect);
      const scheme = new ExactEvmScheme(signerWithAsset(m.paymentRequirements.asset));
      for (const at of rowsOf(row.verifyAt, `${row.case} verifyAt`, { exact: 3 })) {
        vi.useFakeTimers({ now: at.now * 1000, toFake: ["Date"] });
        expect(await scheme.verify(m.paymentPayload as never, m.paymentRequirements as never)).toEqual(at.expect);
        vi.useRealTimers();
      }
    });
    it(`${row.case}: the mapped payment, and the digest x402's verification signs over is the payer's`, async () => {
      const m = toX402(row.credential, row.token, row.issued);
      expect(m).toEqual(row.expect);
      if (isRefusal(m)) return;
      const td = x402TypedData(m);
      expect(hashTypedData(td)).toBe(row.signedDigest);
      const signature = (m.paymentPayload.payload as { signature: `0x${string}` }).signature;
      expect(await recoverTypedDataAddress({ ...td, signature })).toBe(row.credential.payload.from);
    });
  }
  for (const row of rowsOf(V.refusals, "mpp-x402-mapping.json refusals", { exact: 17 })) {
    it(`refuses ${row.case}`, () => {
      expect(toX402(row.credential, row.token, row.issued)).toEqual(row.expect);
    });
  }
  it("refuses a challenge with no expires that still offers transaction, mpp/expires-required", () => {
    const row = V.refusals.find((r: { case: string }) => r.case === "a challenge with no expires, which offers no pairing");
    const credential = structuredClone(row.credential);
    const request = JSON.parse(Buffer.from(credential.challenge.request, "base64url").toString("utf8"));
    request.methodDetails.credentialTypes = ["authorization", "transaction"];
    credential.challenge.request = Buffer.from(JSON.stringify(request)).toString("base64url");
    expect(toX402(credential, row.token, row.issued)).toEqual(row.expect);
  });
});
