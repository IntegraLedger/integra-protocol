// A credential's size as the credential size bound measures it, and a challenge padded to bring a credential to a
// given size: the helpers the credentialSize, completeOrder, voucherSize, inChannelSize and buildChallenge rows
// (mpp-challenge.json) share, and the buildChallenge rows' faults.
import type { Json } from "../src/index.js";
import type { MppChallenge } from "../src/mpp.js";

/** A credential's size as credentialSize's about measures it, and as `bound` does. */
export function sizeOf(v: unknown): number {
  if (typeof v === "string") return v.length + 2;
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean" || v === null) return 8;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + sizeOf(x), 2);
  if (typeof v === "object") return Object.entries(v).reduce((n, [k, x]) => n + k.length + 3 + sizeOf(x), 2);
  throw new Error(`a credential holds ${typeof v}, which is not JSON`);
}

/** The challenge with a description of `n` characters, a member no pairing reads or hashes. */
export const described = <C extends MppChallenge>(c: C, n: number): C => ({ ...c, description: "d".repeat(n) });

/** The description length that brings `credential`, made under a challenge with none, to `size`. */
export const descriptionFor = (credential: unknown, size: number) => size - sizeOf(credential) - ("description".length + 3) - 2;

/** A buildChallenge row (mpp-challenge.json): one fault in the chosen challenge, and the code it gives. */
export type ChallengeRow = {
  case: string;
  opaque?: string | null;
  legalContext?: string;
  leastSize?: number;
  id?: null;
  digest?: Json;
  challenge?: Json;
  expect: string;
};

/** A placed challenge with a buildChallenge row's fault, as the section's about states it. */
export function withFault<C extends MppChallenge & { id: string }>(placed: C, row: ChallengeRow): C {
  if (row.challenge !== undefined) return row.challenge as unknown as C;
  if (row.id === null) {
    const { id: _, ...rest } = placed;
    return rest as unknown as C;
  }
  if (row.digest !== undefined) return { ...placed, digest: row.digest as string };
  if (row.opaque === null) {
    const { opaque: _, ...rest } = placed;
    return rest as C;
  }
  if (row.opaque !== undefined) return { ...placed, opaque: row.opaque };
  if (row.legalContext !== undefined) {
    const map = JSON.parse(Buffer.from(placed.opaque!, "base64url").toString("utf8")) as Record<string, string>;
    return { ...placed, opaque: Buffer.from(JSON.stringify({ ...map, legalContext: row.legalContext })).toString("base64url") };
  }
  return described(placed, descriptionFor({ challenge: placed, payload: {} }, row.leastSize!));
}
