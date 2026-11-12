// mpp-x402-mapping.json: an MPP evm authorization or usdc EVM credential mapped to x402's exact EIP-3009 payment.
// Each row's mapped payment is the file's, and the EIP-712 digest x402's verification builds from it (its
// TransferWithAuthorization over {name, version, chainId, verifyingContract: asset}, as @x402/evm's verifyEIP3009
// builds it) is the digest the payer signed, which recovers the payer. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashTypedData, recoverTypedDataAddress } from "viem";
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

describe("mpp-x402-mapping.json", () => {
  for (const row of rowsOf(V.rows, "mpp-x402-mapping.json rows", { exact: 2 })) {
    it(`${row.case}: the mapped payment, and the digest x402's verification signs over is the payer's`, async () => {
      const m = toX402(row.credential, row.token);
      expect(m).toEqual(row.expect);
      if (isRefusal(m)) return;
      const td = x402TypedData(m);
      expect(hashTypedData(td)).toBe(row.signedDigest);
      const signature = (m.paymentPayload.payload as { signature: `0x${string}` }).signature;
      expect(await recoverTypedDataAddress({ ...td, signature })).toBe(row.credential.payload.from);
    });
  }
  for (const row of rowsOf(V.refusals, "mpp-x402-mapping.json refusals", { exact: 11 })) {
    it(`refuses ${row.case}`, () => {
      expect(toX402(row.credential, row.token)).toEqual(row.expect);
    });
  }
});
