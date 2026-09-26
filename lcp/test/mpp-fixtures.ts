// Fixtures shared by the MPP tests: the vector files, their fixed challenges, and a fixture reader.
import { readFileSync } from "node:fs";
import { ReaderError, type EvmLog, type EvmReader } from "../src/evm.js";
import type { MppChallenge } from "../src/mpp.js";

export const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
export const V = load("mpp-challenge.json");
export const H = V.fixed.H as `0x${string}`;
export const realm = V.fixed.realm as string;
export const link = V.fixed.link as string;
export const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
export const fromB64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");
export const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
export const withBigints = (v: unknown) =>
  JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/** An issued challenge: realm, method, intent, the request's JSON as base64url, and the vectors' expiry. */
export function challenge(method: string, intent: string, requestJson: string): MppChallenge {
  return { realm, method, intent, request: b64u(requestJson), expires: V.fixed.expires };
}
export const C_E = challenge("evm", "charge", V.fixed.R_E);
export const C_T = challenge("tempo", "charge", V.fixed.R_T);

export type FixtureReceipt = { status: 0 | 1; blockNumber: string; logs: EvmLog[] } | null | "reader-error";

/** A reader for `network` that answers one receipt and finalized and safe marks. */
export function readerFor(network: string, r: FixtureReceipt, finalized = 100n, safe = 100n): EvmReader {
  return {
    network: network as EvmReader["network"],
    receipt: async () => {
      if (r === "reader-error") throw new ReaderError("transport");
      return r === null ? null : { status: r.status, blockNumber: BigInt(r.blockNumber), logs: r.logs };
    },
    blockNumber: async (tag) => (tag === "finalized" ? finalized : safe),
    transaction: async () => null,
  };
}

/** A 32-byte topic holding an address. */
export const topicOf = (a: string) => `0x${"0".repeat(24)}${a.replace(/^0x/, "").toLowerCase()}` as `0x${string}`;
/** A 32-byte word holding an unsigned integer. */
export const wordOf = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}` as `0x${string}`;
