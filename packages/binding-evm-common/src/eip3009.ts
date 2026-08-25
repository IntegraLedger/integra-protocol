/**
 * The EIP-3009 `TransferWithAuthorization` typed-data machinery for the LCP canonical EVM binding
 * `LCP-X402-EVM-NONCE-1`: the buyer signs an EIP-3009 authorization whose `nonce` field IS the
 * `atrHash`, so the fingerprint is committed on-chain in the token's `AuthorizationUsed(authorizer,
 * indexed nonce)` event — no overlay contract.
 *
 * The x402-client scheme class is deliberately NOT here; it lives in binding-evm-x402. This module is
 * protocol-agnostic typed-data construction, viem-only.
 */
import {
  type Address,
  getAddress,
  type Hex,
  recoverTypedDataAddress,
  type TypedDataDomain,
} from "viem";

/** EIP-3009 TransferWithAuthorization typed-data field layout (USDC FiatTokenV2). */
export const TRANSFER_WITH_AUTHORIZATION_TYPE = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Parse the EIP-155 chain id out of a CAIP-2 network string; throws on anything that is not
 *  `eip155:<digits>` (never defaults — the chain id binds the EIP-712 domain). */
export function eip155ChainId(network: string): number {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m)
    throw new Error(`expected CAIP-2 network "eip155:<id>", got "${network}"`);
  return Number(m[1]);
}

/** The atrHash rides the EIP-3009 nonce as a 0x-prefixed 32-byte value. Any-case digits accepted
 *  (ATR canon), then lowercased for the on-chain nonce (the nonce is matched lowercase on decode). */
export function assertBytes32(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(
      `atrHash must be a 0x-prefixed 32-byte (64 hex) value to ride as the EIP-3009 nonce, got "${value}"`,
    );
  return value.toLowerCase() as Hex;
}

/** The EIP-3009 authorization object (string-encoded uint fields, as the x402 wire expects). */
export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

/** Everything needed to build an EIP-3009 authorization whose `nonce` IS the atrHash. Two fields are the
 *  usual mistake: `tokenName`/`tokenVersion` are the token's own EIP-712 domain and DIFFER between USDC
 *  deployments, so copying them from one chain to another yields a signature the token rejects. Amounts
 *  and times are strings here (base units, unix seconds) and become `bigint` in the typed data. */
export interface BuildEip3009Input {
  /** The LCP carrier value — becomes the on-chain nonce. */
  atrHash: string;
  /** Payer address; checksummed via `getAddress`. */
  from: string;
  /** Recipient address; checksummed via `getAddress`. */
  to: string;
  /** Amount in token base units (string). */
  value: string;
  validAfter: string;
  validBefore: string;
  chainId: number;
  /** EIP-712 domain `name`/`version` for the token (USDC). */
  tokenName: string;
  tokenVersion: string;
  /** Token contract — the EIP-712 `verifyingContract`; checksummed via `getAddress`. */
  verifyingContract: string;
}

/** The EIP-712 payload a payer signs for an EIP-3009 transfer. Distinct from the authorization: the
 *  authorization is what goes on the wire, this is what is signed, and their numeric fields differ in type
 *  (`bigint` here, decimal strings there) because that is what each side requires. */
export type Eip3009TypedData = {
  domain: TypedDataDomain;
  types: typeof TRANSFER_WITH_AUTHORIZATION_TYPE;
  primaryType: "TransferWithAuthorization";
  message: {
    from: Address;
    to: Address;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: Hex;
  };
};

/**
 * Build the EIP-3009 authorization + the EIP-712 typed-data to sign, with `nonce = atrHash`.
 * `authorization` is the wire payload; `typedData` is what the signer signs.
 */
export function buildEip3009TypedData(i: BuildEip3009Input): {
  authorization: Eip3009Authorization;
  typedData: Eip3009TypedData;
} {
  const nonce = assertBytes32(i.atrHash);
  const from = getAddress(i.from);
  const to = getAddress(i.to);
  const authorization: Eip3009Authorization = {
    from,
    to,
    value: i.value,
    validAfter: i.validAfter,
    validBefore: i.validBefore,
    nonce,
  };
  const typedData: Eip3009TypedData = {
    domain: {
      name: i.tokenName,
      version: i.tokenVersion,
      chainId: i.chainId,
      verifyingContract: getAddress(i.verifyingContract),
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPE,
    primaryType: "TransferWithAuthorization",
    message: {
      from,
      to,
      value: BigInt(i.value),
      validAfter: BigInt(i.validAfter),
      validBefore: BigInt(i.validBefore),
      nonce,
    },
  };
  return { authorization, typedData };
}

/** Minimal EVM signer — the structural subset a scheme needs (viem LocalAccount / CDP account / injected wallet). */
export interface LcpEvmSigner {
  readonly address: Address;
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

/**
 * Whether an EIP-3009 authorization was signed by the account it says it is from.
 *
 * ⭐ **`ecrecover`, because that is what the TOKEN does.** `FiatTokenV2.transferWithAuthorization` recovers
 * the signer from the EIP-712 digest and compares it to `from`, so this recovers and compares the same way.
 * It deliberately does NOT fall back to ERC-1271: a contract wallet cannot sign an EIP-3009 authorization
 * at all — the token has no `isValidSignature` call in that path — so accepting one here would accept a
 * payment the chain will reject, which is the failure this check exists to prevent rather than to cause.
 *
 * ⛔ **Answers `false` rather than throwing, for the reason `atrHashEquals` states about itself:** a
 * predicate that throws is a worse contract than one that answers. A malformed signature, a signature of
 * the wrong length, and an `expectedSigner` that is not an address are all "no, this is not signed by
 * them" — and a caller holding an untrusted credential needs a value it can put on the wire, not an
 * exception it has to remember to catch.
 *
 * ⚠️ The domain is the caller's to get right, and it is where this goes wrong in practice: `tokenName` and
 * `tokenVersion` are the token's OWN EIP-712 domain and differ between USDC deployments, so a signature
 * verified against a domain copied from another chain fails here exactly as it would on-chain.
 * {@link buildEip3009TypedData} is what assembles it.
 */
export async function verifyEip3009Signature(
  typedData: Eip3009TypedData,
  signature: string,
  expectedSigner: string,
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(expectedSigner)) return false;
  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: signature as Hex,
    });
  } catch {
    return false;
  }
  // Compared as decoded 20-byte values, not as strings: `getAddress` checksums both sides, so a payer
  // spelling their own address in lowercase is the same payer.
  return getAddress(recovered) === getAddress(expectedSigner);
}
