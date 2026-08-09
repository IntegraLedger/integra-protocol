/**
 * Acceptance-signature verification (TRM-6) — the EVM implementation of `authority`'s `SignatureVerifier`
 * port. viem lives here. It verifies the LCP acceptance envelope: a stock
 * Coinbase Smart Wallet (CDP Server Wallet v2) exposes only `signTypedData`, so raw-`atrHash` signing is
 * refused and the acceptance rides an EIP-712 envelope `Acceptance{ bytes32 atrHash, uint256 signedAt }`
 * under domain `{ name: "LCP Acceptance", version: "1", chainId }` (no verifyingContract). Note:
 * `verifyTypedData` returns true for the stock-SDK signature — counterfactual accounts wrap it ERC-6492,
 * deployed accounts return a plain ERC-1271 sig; both verify through viem's universal validator.
 *
 * Two verification paths, split by scheme:
 *  - EOA (`evm:eip191`/`evm:eip712`) — recovered OFFLINE (no chain), so these are the schemes the
 *    deterministic conformance corpus and this package's tests exercise;
 *  - smart account (`evm:erc1271`/`evm:erc6492`) — verified on-chain through the injected `PublicClient`
 *    (viem's universal `verifyTypedData`/`verifyMessage` handle ERC-1271 and the ERC-6492 counterfactual
 *    wrapper). No client → fail-loud (never a silent false — that would impeach a valid smart-account
 *    signature).
 *
 * `AcceptanceScheme` is an OPEN namespaced set and `signer` is scheme-canonical (rail-neutral core); THIS
 * adapter is where the narrowing happens: it accepts exactly the four `evm:*` schemes and the 0x-address
 * signer form, and throws — never a silent false — on a record that belongs to a different family.
 */
import type {
  SignatureVerifier,
  SignedAcceptance,
} from "@integraledger/lcp-authority";
import {
  type Hex,
  isAddress,
  type PublicClient,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertBytes32, type LcpEvmSigner } from "./eip3009.js";

/** The EIP-712 acceptance-envelope struct. */
export const ACCEPTANCE_ENVELOPE_TYPE = {
  Acceptance: [
    { name: "atrHash", type: "bytes32" },
    { name: "signedAt", type: "uint256" },
  ],
} as const;

/** The acceptance envelope's EIP-712 domain — name/version pinned, chainId per network, no verifyingContract. */
export const ACCEPTANCE_DOMAIN_NAME = "LCP Acceptance";
/** The acceptance envelope's EIP-712 domain `version`. Pinned, and part of what every acceptance
 *  signature commits to — changing it invalidates every signature made under the old value, so it moves
 *  only alongside a deliberate envelope revision. */
export const ACCEPTANCE_DOMAIN_VERSION = "1";

/** The typed-data object the accepting party signs (message.signedAt is unix seconds — the on-chain uint256). */
export type AcceptanceTypedData = {
  domain: { name: string; version: string; chainId: number };
  types: typeof ACCEPTANCE_ENVELOPE_TYPE;
  primaryType: "Acceptance";
  message: { atrHash: Hex; signedAt: bigint };
};

/**
 * Convert TRM-6's RFC 3339 `signedAt` (the acceptance record's timestamp) into the uint256 unix seconds the
 * EIP-712 envelope commits to. Fail-loud on anything Date cannot parse — a mis-parsed timestamp would build
 * a different envelope and silently fail verification, hiding a malformed record behind a bad-signature error.
 */
export function rfc3339ToUnixSeconds(signedAt: string): bigint {
  const ms = Date.parse(signedAt);
  if (Number.isNaN(ms))
    throw new Error(
      `acceptance signedAt is not a parseable RFC 3339 timestamp: "${signedAt}"`,
    );
  return BigInt(Math.floor(ms / 1000));
}

/** Build the acceptance envelope typed-data for a fixed atrHash + unix-seconds signedAt + chainId. */
export function buildAcceptanceTypedData(i: {
  atrHash: string;
  signedAt: bigint;
  chainId: number;
}): AcceptanceTypedData {
  return {
    domain: {
      name: ACCEPTANCE_DOMAIN_NAME,
      version: ACCEPTANCE_DOMAIN_VERSION,
      chainId: i.chainId,
    },
    types: ACCEPTANCE_ENVELOPE_TYPE,
    primaryType: "Acceptance",
    message: { atrHash: assertBytes32(i.atrHash), signedAt: i.signedAt },
  };
}

/** The four schemes this port implements — the EVM half of the open `AcceptanceScheme` set. */
export const EVM_ACCEPTANCE_SCHEMES = [
  "evm:eip191",
  "evm:eip712",
  "evm:erc1271",
  "evm:erc6492",
] as const;
/** How an acceptance was signed. Two are EOA schemes (`eip191`, `eip712`) and verify offline; two are
 *  smart-account schemes (`erc1271`, `erc6492`) and REQUIRE a chain read, which is why
 *  {@link AcceptanceVerifyOpts.client} is conditionally required. */
export type EvmAcceptanceScheme = (typeof EVM_ACCEPTANCE_SCHEMES)[number];

/** Narrow a string to an {@link EvmAcceptanceScheme}. The set is closed — an unrecognised scheme is not a
 *  scheme this port can verify, and treating it as one would mean reporting an unchecked signature. */
export function isEvmAcceptanceScheme(v: string): v is EvmAcceptanceScheme {
  return (EVM_ACCEPTANCE_SCHEMES as readonly string[]).includes(v);
}

/** The two payload formats this port can reconstruct for recovery. */
export const EVM_PAYLOAD_TYPES = [
  "atrHash",
  "eip712-acceptance-envelope",
] as const;
/** WHAT was signed, as distinct from HOW. `atrHash` means the bare hash was signed;
 *  `eip712-acceptance-envelope` means the structured envelope was, and that form additionally needs a
 *  `chainId` to reconstruct its domain. The two are not interchangeable — verifying under the wrong one
 *  reconstructs a different payload and fails. */
export type EvmPayloadType = (typeof EVM_PAYLOAD_TYPES)[number];

/** Narrow a string to an {@link EvmPayloadType}. Closed set, same reason as the scheme guard. */
export function isEvmPayloadType(v: string): v is EvmPayloadType {
  return (EVM_PAYLOAD_TYPES as readonly string[]).includes(v);
}

/** The fields the EVM verifier reads off an acceptance record (a structural subset of `SignedAcceptance`). */
export interface AcceptanceSignatureInput {
  atrHash: string;
  signer: string;
  scheme: EvmAcceptanceScheme;
  signature: string;
  /** RFC 3339 — converted to the envelope's uint256 signedAt. */
  signedAt: string;
  payloadType: EvmPayloadType;
}

/** The context an acceptance check may need. Both fields are optional in the TYPE and conditionally
 *  REQUIRED in fact: `chainId` for the `eip712-acceptance-envelope` payload, `client` for the
 *  smart-account schemes. Omitting a required one is refused rather than defaulted — a signature verified
 *  against a guessed domain, or not verified at all, must never read as verified. */
export interface AcceptanceVerifyOpts {
  /** The EIP-155 chain id binding the envelope domain — REQUIRED for the eip712-acceptance-envelope payload. */
  chainId?: number;
  /** A viem public client — REQUIRED for smart-account (erc1271/erc6492) schemes; unused for EOA schemes. */
  client?: PublicClient;
}

/**
 * Verify an acceptance signature. EOA schemes recover offline; smart-account schemes verify on-chain through
 * `opts.client`. Returns a boolean (the port contract).
 *
 * THREE OUTCOMES, and keeping them distinct is the whole point:
 *
 *  - **A malformed CONFIGURATION throws** (absent `chainId` for the envelope, absent client for a smart
 *    account) — an integration error the caller must fix, not a fact about the record.
 *  - **A malformed RECORD throws** (an unparseable `signedAt`, a non-32-byte `atrHash`) — a garbled
 *    timestamp is a different fact from a forged signature, and `rfc3339ToUnixSeconds` exists precisely to
 *    stop a malformed record hiding behind a bad-signature verdict. These are normalized BEFORE the guard
 *    below, so they stay loud.
 *  - **A malformed SIGNATURE returns `false`.** Recovery over forged or corrupted bytes fails deep in the
 *    curve math ("Point is not on curve"), and a verifier that crashes on a forgery cannot report the
 *    forgery — the adversarial case is exactly the one verification exists for. An unrecoverable signature
 *    is definitively not a valid signature, so the walk records an honest `failed(verification-failure)`.
 *
 * The guard therefore wraps ONLY the recovery/verification calls. Widening it to cover the normalization
 * above would collapse the second outcome into the third.
 */
export async function verifyAcceptanceSignature(
  input: AcceptanceSignatureInput,
  opts?: AcceptanceVerifyOpts,
): Promise<boolean> {
  // Normalization + configuration: OUTSIDE the guard, so both stay loud.
  const recover = prepareRecovery(input, opts);
  try {
    return await recover();
  } catch {
    return false; // the signature itself did not recover — not a valid signature
  }
}

/** Raised for integration errors (absent chainId/client). */
class ConfigurationError extends Error {}

/**
 * Normalize the record's fields and bind the scheme-appropriate recovery call, returning it UNEXECUTED so
 * the caller can guard the recovery alone. Anything wrong with the configuration or the record's own fields
 * throws from here, before the guard exists.
 */
function prepareRecovery(
  input: AcceptanceSignatureInput,
  opts?: AcceptanceVerifyOpts,
): () => Promise<boolean> {
  // A signer that is not an address is a malformed RECORD, not a forgery — thrown here, before the guard,
  // for the same reason rfc3339ToUnixSeconds throws: recovery over it would fail deep in viem and read as
  // a bad-signature verdict about a signature nobody could have examined.
  if (!isAddress(input.signer, { strict: false }))
    throw new Error(
      `evm:* acceptance signer must be a 0x-address (the scheme's canonical form); got "${input.signer}"`,
    );
  const signer = input.signer as Hex;
  const isContract =
    input.scheme === "evm:erc1271" || input.scheme === "evm:erc6492";
  const signature = input.signature as Hex;

  if (input.payloadType === "eip712-acceptance-envelope") {
    if (opts?.chainId === undefined)
      throw new ConfigurationError(
        "eip712-acceptance-envelope verification requires opts.chainId to bind the envelope domain",
      );
    // Throws loud on an unparseable signedAt or a malformed atrHash — a malformed RECORD, not a forgery.
    const typedData = buildAcceptanceTypedData({
      atrHash: input.atrHash,
      signedAt: rfc3339ToUnixSeconds(input.signedAt),
      chainId: opts.chainId,
    });
    if (isContract) {
      // `opts` (not `opts?.`): the chainId gate above already proved it defined — an optional chain here
      // would be dead syntax guarding an impossible state, and the mutation run flags it as equivalent.
      const client = requireClient(opts.client, input.scheme);
      return () =>
        client.verifyTypedData({ address: signer, ...typedData, signature });
    }
    return async () => {
      const recovered = await recoverTypedDataAddress({
        ...typedData,
        signature,
      });
      return recovered.toLowerCase() === signer.toLowerCase();
    };
  }

  // payloadType === "atrHash": the raw 32-byte atrHash signed as a personal_sign message.
  const raw = assertBytes32(input.atrHash); // throws loud on a malformed atrHash
  if (isContract) {
    const client = requireClient(opts?.client, input.scheme);
    return () =>
      client.verifyMessage({ address: signer, message: { raw }, signature });
  }
  return async () => {
    const recovered = await recoverMessageAddress({
      message: { raw },
      signature,
    });
    return recovered.toLowerCase() === signer.toLowerCase();
  };
}

function requireClient(
  client: PublicClient | undefined,
  scheme: string,
): PublicClient {
  if (client === undefined)
    throw new ConfigurationError(
      `${scheme} verification requires a chain client (opts.client) — smart-account signatures verify on-chain (ERC-1271/6492)`,
    );
  return client;
}

/**
 * Adapt the EVM verifier to `authority`'s `SignatureVerifier` port (hexagonal: the adapter depends on the
 * domain's port). `authority`'s pure `verifyAcceptance` composes this to check the cryptographic gate.
 *
 * This is where the OPEN acceptance surface narrows to the closed set this port implements. A scheme or
 * payload type outside that set is a ROUTING error — the caller wired the wrong port for the record — and
 * throws loud (the configuration outcome of the three-outcomes doctrine above). Returning `false` instead
 * would report "forged signature" about a signature this port never examined, collapsing "we cannot check
 * this family" into "checked, and it failed" — the exact distinction fail-closed verification exists to keep.
 */
export function makeEvmAcceptanceVerifier(
  opts?: AcceptanceVerifyOpts,
): SignatureVerifier {
  return {
    // async so the routing throws below surface as REJECTIONS — the same channel the
    // configuration/record throws inside `verifyAcceptanceSignature` already use.
    verify: async (acceptance: SignedAcceptance): Promise<boolean> => {
      if (!isEvmAcceptanceScheme(acceptance.scheme))
        throw new ConfigurationError(
          `scheme "${acceptance.scheme}" is not an EVM acceptance scheme (${EVM_ACCEPTANCE_SCHEMES.join(", ")}) — route the record to the port that implements its family`,
        );
      if (!isEvmPayloadType(acceptance.payloadType))
        throw new ConfigurationError(
          `payloadType "${acceptance.payloadType}" is not one this port reconstructs (${EVM_PAYLOAD_TYPES.join(", ")})`,
        );
      return verifyAcceptanceSignature(
        {
          atrHash: acceptance.atrHash,
          signer: acceptance.signer,
          scheme: acceptance.scheme,
          signature: acceptance.signature,
          signedAt: acceptance.signedAt,
          payloadType: acceptance.payloadType,
        },
        opts,
      );
    },
  };
}

/**
 * A local EOA `LcpEvmSigner` over a raw private key (viem's `privateKeyToAccount`). The producer-side
 * counterpart to `makeEvmAcceptanceVerifier`: it keeps viem isolated in this package so a producer
 * can sign the acceptance envelope through the injected `LcpEvmSigner` port without importing viem. The
 * returned signer's `signTypedData` is viem's `LocalAccount.signTypedData`, which produces the exact
 * EIP-712 signature `verifyAcceptanceSignature` recovers offline (eip191/eip712) — producer and verifier
 * agree by construction. This is a reference/test signer: production buyer wallets inject their own
 * `LcpEvmSigner` (a viem account, a CDP server account, or any wallet exposing address + signTypedData).
 */
export function makeLocalEvmSigner(privateKey: Hex): LcpEvmSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    signTypedData: (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex> =>
      account.signTypedData(
        message as Parameters<typeof account.signTypedData>[0],
      ),
  };
}
