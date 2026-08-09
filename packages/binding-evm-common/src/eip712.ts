import { hashTypedData } from "viem";
import type { Eip3009TypedData } from "./eip3009.js";

/**
 * The EIP-712 digest of an EIP-3009 typed-data message — viem's reference EIP-712 hashing
 * (keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(message))). This is what the signer signs over
 * and what pins the typed-data structure in the vector fixtures.
 */
export function hashEip712(typedData: Eip3009TypedData): `0x${string}` {
  return hashTypedData(typedData);
}
