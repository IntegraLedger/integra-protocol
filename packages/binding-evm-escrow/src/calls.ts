/**
 * The escrow KEY derivations — the off-chain `getHash` (== the event's indexed `paymentInfoHash`) and
 * the payer-agnostic nonce, so a settlement can be keyed and joined without importing viem
 * downstream — viem stays here. There are no calldata encoders in this module and none anywhere in
 * this package: escrow is not our product, so this binding reads the mechanism and never drives it.
 * (This module has no calldata encoders: they were removed
 * with the escrow-operation retirement and the headline was not.) `encodeAbiParameters` below is
 * hashing input, not transaction input.
 *
 * Every struct field and signature is transcribed from the DEPLOYED `AuthCaptureEscrow` at
 * base/commerce-payments @ 98b592b (the pinned deployment, NOT repo HEAD — the charge/capture event ABI
 * drift that shipped a bug earlier came from reading HEAD).
 *
 * `getHashOffchain` replicates the on-chain `getHash` byte-identically, so the settlement key is
 * derivable BEFORE the authorizing tx confirms rather than only from the event. Call it with the real
 * `payer` for the settlement key; call it with `payer = 0` for the ERC-3009 `ReceiveWithAuthorization`
 * nonce the buyer signs (the "payer-agnostic" nonce).
 */
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import type { PaymentInfo } from "./adapter.js";
import { AUTH_CAPTURE_ESCROW } from "./collectors.js";

/** The PaymentInfo tuple components, in the DEPLOYED struct's field order (98b592b). */
const PI_COMPONENTS = {
  type: "tuple",
  components: [
    { name: "operator", type: "address" },
    { name: "payer", type: "address" },
    { name: "receiver", type: "address" },
    { name: "token", type: "address" },
    { name: "maxAmount", type: "uint120" },
    { name: "preApprovalExpiry", type: "uint48" },
    { name: "authorizationExpiry", type: "uint48" },
    { name: "refundExpiry", type: "uint48" },
    { name: "minFeeBps", type: "uint16" },
    { name: "maxFeeBps", type: "uint16" },
    { name: "feeReceiver", type: "address" },
    { name: "salt", type: "uint256" },
  ],
} as const;

/** keccak256 of the PaymentInfo typehash STRING (== the deployed PAYMENT_INFO_TYPEHASH, 0xae68…6591). */
export const PAYMENT_INFO_TYPEHASH: `0x${string}` = keccak256(
  stringToHex(
    "PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)",
  ),
);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/**
 * The off-chain `getHash(paymentInfo)` — `keccak256(abi.encode(chainId, escrow, keccak256(abi.encode(
 * TYPEHASH, paymentInfo))))`. Equals the event's indexed `paymentInfoHash` (the deployed `authorize`/
 * `charge` emit `getHash(paymentInfo)` as that topic) and the settlement key. This matches
 * the on-chain view byte-for-byte (incl. the fee-bearing case).
 */
export function getHashOffchain(params: {
  chainId: number;
  escrow?: `0x${string}`;
  paymentInfo: PaymentInfo;
}): `0x${string}` {
  const escrow = params.escrow ?? AUTH_CAPTURE_ESCROW;
  const inner = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, PI_COMPONENTS],
      [PAYMENT_INFO_TYPEHASH, params.paymentInfo],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }],
      [BigInt(params.chainId), escrow, inner],
    ),
  );
}

/** The settlement key / event `paymentInfoHash` for a PaymentInfo (alias of `getHashOffchain`). */
export function paymentInfoHash(params: {
  chainId: number;
  escrow?: `0x${string}`;
  paymentInfo: PaymentInfo;
}): `0x${string}` {
  return getHashOffchain(params);
}

/**
 * The ERC-3009 `ReceiveWithAuthorization` nonce the buyer signs — `getHash(paymentInfo with payer = 0)`
 * (the "payer-agnostic" hash; the collector fills the real payer from the recovered signature).
 */
export function payerAgnosticNonce(params: {
  chainId: number;
  escrow?: `0x${string}`;
  paymentInfo: PaymentInfo;
}): `0x${string}` {
  return getHashOffchain({
    ...params,
    paymentInfo: { ...params.paymentInfo, payer: ZERO_ADDRESS },
  });
}
