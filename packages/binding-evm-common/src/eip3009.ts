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
 * secp256k1's order halved — the low-s boundary `FiatTokenV2`'s own `ECRecover.sol` enforces.
 *
 * ⛔⛔ **A SIGNATURE HAS TWO VALID ENCODINGS AND THE TOKEN ACCEPTS ONE.** For any `(r, s, v)` the pair
 * `(r, n − s, v ^ 1)` recovers the same address, so `ecrecover` alone says `true` to both. Circle's token
 * reverts on the high-s form before `ecrecover` is reached — *"ECRecover: invalid signature 's' value"* —
 * and on any `v` outside `{27, 28}`. A pre-flight check without these gates answers `true` for a
 * credential the chain refuses, and the seller has already served the resource by then.
 */
const SECP256K1_HALF_N =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/**
 * Whether the 65-byte signature is one `FiatTokenV2` will accept at all, before asking who signed it.
 *
 * Not a style check. Both rules come straight out of the token's `ECRecover.sol`, and skipping either one
 * turns {@link verifyEip3009Signature} from *"the chain will accept this"* into *"some chain might"*.
 *
 * ⭐ Exported so the boundary is reachable by a test. `s === n/2` is ACCEPTED (the token's guard is
 * `s > n/2`), and no signing run will ever produce that value — so an off-by-one there is invisible from
 * the public predicate, where such a signature simply fails to recover and answers `false` either way.
 */
export function isCanonicalSignature(signature: string): boolean {
  // ⛔ Captured, not sliced at fixed offsets. With `.slice(66, 130)` the components were read from
  // positions that only line up when the anchors hold — so dropping `^` shifted every offset and the
  // malformed input failed the `v` gate by accident, which left the anchor's mutant alive. Reading r/s/v
  // out of the match makes the shape check and the component read the same statement.
  const parts = /^0x([0-9a-fA-F]{64})([0-9a-fA-F]{64})([0-9a-fA-F]{2})$/.exec(
    signature,
  );
  if (parts === null) return false;
  if (BigInt(`0x${parts[2] as string}`) > SECP256K1_HALF_N) return false;
  const v = Number.parseInt(parts[3] as string, 16);
  return v === 27 || v === 28;
}

/**
 * Whether an EIP-3009 authorization was signed, canonically, by the account it says it is from.
 *
 * ⭐ **The token's OWN acceptance test, not merely `ecrecover`.** `FiatTokenV2.transferWithAuthorization`
 * routes an EOA signature through `ECRecover.sol`, which refuses a high-s signature and any `v` outside
 * `{27, 28}` before recovering. A check that only recovered would answer `true` to the malleated form of an
 * honest payer's own signature — measured — and the seller would serve the resource against a transfer that
 * reverts. {@link isCanonicalSignature} is those two gates.
 *
 * ⛔⛔ **EOA ONLY, AND ON `FiatTokenV2_2` THAT IS NARROWER THAN THE TOKEN.** An earlier draft of this
 * docblock said a contract wallet *"cannot sign an EIP-3009 authorization at all"*. That is false for
 * `FiatTokenV2_2` — the 2023 implementation deployed as USDC on Base, Arbitrum and Polygon among others —
 * which routes `transferWithAuthorization` through `SignatureChecker.isValidSignatureNow` and therefore
 * DOES dispatch to ERC-1271 for a contract account. Deciding that needs a chain read, and this function
 * takes no ports: **a `false` here means "not signed by that EOA", never "the chain will reject it"**. A
 * caller that must accept smart-account payers has to make the ERC-1271 call itself, and one that refuses
 * on this answer alone is choosing to accept EOA payers only. Say which, at the call site.
 *
 * ⛔ **Answers `false` rather than throwing for the two UNTRUSTED inputs,** for the reason `atrHashEquals`
 * states about itself: a predicate that throws is a worse contract than one that answers. A malformed
 * `signature` and an `expectedSigner` that is not an address are facts about the credential in hand.
 * ⚠️ A `typedData` that cannot be encoded is NOT — that is this deployment's own domain being wrong, and
 * returning `false` for it would tell an operator with a mis-copied `tokenName` that every honest payer is
 * a forger. It throws.
 */
export async function verifyEip3009Signature(
  typedData: Eip3009TypedData,
  signature: string,
  expectedSigner: string,
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(expectedSigner)) return false;
  if (!isCanonicalSignature(signature)) return false;
  // ⛔ NOT wrapped in a try. `isCanonicalSignature` has already established that the signature parses, so
  // the only way this throws now is an unencodable `typedData` — a wiring error, and one a `false` would
  // report as the counterparty's fault. See the head note.
  const recovered: Address = await recoverTypedDataAddress({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
    signature: signature as Hex,
  });
  // Compared as decoded 20-byte values, not as strings: `getAddress` checksums both sides, so a payer
  // spelling their own address in lowercase is the same payer.
  return getAddress(recovered) === getAddress(expectedSigner);
}
