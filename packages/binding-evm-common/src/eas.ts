/**
 * EAS (Ethereum Attestation Service) read — the EVM substrate adapter for a profiled attestation
 * (`authority`'s attestation-profile.ts interprets attestations generically; the per-substrate on-chain
 * read lives here, pure over the injected viem client). This reads `getAttestation(uid)` and
 * normalizes the on-chain `Attestation` struct into a typed, as-of-checkable value. It verifies nothing
 * cryptographically beyond the chain's own state — EAS attestations are on-chain records, so their
 * validity is a state read (attester, expiration, revocation), evaluated AS OF a settlement time exactly
 * like `authority`'s status-list discipline (never "is it valid now" — "was it valid at settlement").
 */
import type { Hex, PublicClient } from "viem";

/** EAS `getAttestation(bytes32) returns (Attestation)` — the canonical struct (EAS v0.26+ field order). */
export const EAS_GET_ATTESTATION_ABI = [
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        name: "",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
] as const;

/** The raw shape viem decodes an EAS `Attestation` tuple into (named components → object). */
export interface RawEasAttestation {
  uid: Hex;
  schema: Hex;
  time: bigint;
  expirationTime: bigint;
  revocationTime: bigint;
  refUID: Hex;
  recipient: Hex;
  attester: Hex;
  revocable: boolean;
  data: Hex;
}

/** A normalized EAS attestation (addresses lowercased; times as bigints; `exists` = a non-zero uid). */
export interface EasAttestation {
  uid: Hex;
  schema: Hex;
  time: bigint;
  expirationTime: bigint;
  revocationTime: bigint;
  refUID: Hex;
  recipient: Hex;
  attester: Hex;
  revocable: boolean;
  data: Hex;
  /** EAS returns a zero-filled struct for an unknown uid — this flags that non-existence explicitly. */
  exists: boolean;
}

const ZERO_UID =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Normalize viem's decoded tuple into an `EasAttestation` (idempotent field mapping; addresses lowercased). */
export function decodeEasAttestation(raw: RawEasAttestation): EasAttestation {
  return {
    uid: raw.uid.toLowerCase() as Hex,
    schema: raw.schema.toLowerCase() as Hex,
    time: raw.time,
    expirationTime: raw.expirationTime,
    revocationTime: raw.revocationTime,
    refUID: raw.refUID.toLowerCase() as Hex,
    recipient: raw.recipient.toLowerCase() as Hex,
    attester: raw.attester.toLowerCase() as Hex,
    revocable: raw.revocable,
    data: raw.data.toLowerCase() as Hex,
    exists: raw.uid.toLowerCase() !== ZERO_UID,
  };
}

/**
 * Was this attestation valid AS OF `asOfUnixSeconds`? — it must exist, not have been revoked at/before the
 * as-of time (revocationTime 0 = never revoked), and not have expired by then (expirationTime 0 = no expiry).
 * EAS has no historical query, so a live read yields today's revocationTime; a settlement-time snapshot of the
 * uid is the authority (same as the Bitstring status-list as-of rule) — this predicate states the semantics.
 */
export function isEasValidAsOf(
  att: EasAttestation,
  asOfUnixSeconds: bigint,
): boolean {
  if (!att.exists) return false;
  if (att.revocationTime !== 0n && att.revocationTime <= asOfUnixSeconds)
    return false;
  if (att.expirationTime !== 0n && att.expirationTime <= asOfUnixSeconds)
    return false;
  return true;
}

/** Read + normalize an EAS attestation by uid, over the injected viem client (imperative shell). */
export async function readEasAttestation(
  client: PublicClient,
  params: { eas: string; uid: string },
): Promise<EasAttestation> {
  const raw = (await client.readContract({
    address: params.eas as Hex,
    abi: EAS_GET_ATTESTATION_ABI,
    functionName: "getAttestation",
    args: [params.uid as Hex],
  })) as RawEasAttestation;
  return decodeEasAttestation(raw);
}
