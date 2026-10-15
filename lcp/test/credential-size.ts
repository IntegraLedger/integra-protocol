// A credential's size as the credential size bound measures it, and a challenge padded to bring a credential to a
// given size: the helpers the credentialSize, completeOrder, voucherSize, inChannelSize and buildChallenge rows
// (mpp-challenge.json) share.
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
