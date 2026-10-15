// Fixtures shared by the MPP tests: the vector files, their fixed challenges, and a fixture reader.
import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { ReaderError, type EvmLog, type EvmReader } from "../src/evm.js";
import { FETCHED, type MppChallenge, type MppCredential } from "../src/mpp.js";

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

/**
 * A vector input's credential as the seller holds it: `presented`, the credential as sent, with `fetched`, what
 * `fetchPresented` read of it, written under `FETCHED` (a `blockNumber` read as a bigint). JSON carries no symbol-keyed
 * member, so a vector file holds the read beside the credential. `presented` alone where the input holds no `fetched`.
 */
export function heldOf(input: { presented: unknown; fetched?: unknown }): MppCredential {
  const { presented, fetched } = input;
  if (fetched === undefined) return presented as MppCredential;
  const read = fetched as { blockNumber?: unknown };
  const blockNumber = typeof read.blockNumber === "string" ? { blockNumber: BigInt(read.blockNumber) } : {};
  return { ...(presented as MppCredential), [FETCHED]: { ...read, ...blockNumber } } as MppCredential;
}

/** A pairing's two reads of a credential. */
export interface Reads {
  bound(c: unknown): Promise<unknown>;
  reference?(c: unknown): Promise<unknown>;
}
const answers = async (p: Reads, c: unknown) => [await p.bound(c), p.reference === undefined ? undefined : await p.reference(c)];
const asJson = (c: unknown) => JSON.parse(JSON.stringify(c, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/**
 * The seller-read rule on one pairing: `bound` and `reference` read what `fetchPresented` wrote only from the member
 * `FETCHED` keys. `fetched` is what `fetchPresented` returned for `sent`, the credential as the buyer sent it, and
 * `bound` gives it `expected`. A spread of it and an `Object.assign` copy give its answers; a JSON round trip and a
 * `structuredClone` of it, which drop the member, give `sent`'s, `readFirst`. `forged` is a read whose contents bind:
 * `sent` with `forged` under `FETCHED` is H to `bound`. `other` is a read whose contents are not `fetched`'s.
 * `stringKeyed(c, read)` is `c` carrying `read` as the string-keyed members a wire form can hold:
 * `stringKeyed(sent, forged)` gives `sent`'s answers, and `stringKeyed(fetched, other)` gives `fetched`'s.
 */
export async function readsOnlyFetched(
  p: Reads,
  sent: unknown,
  fetched: unknown,
  expected: unknown,
  forged: unknown,
  other: unknown,
  stringKeyed: (c: unknown, read: unknown) => unknown,
  readFirst: string,
): Promise<void> {
  const held = await answers(p, fetched);
  expect(held[0]).toEqual(expected);
  expect(await answers(p, { ...(fetched as object) }), "a spread").toEqual(held);
  expect(await answers(p, Object.assign({}, fetched)), "an Object.assign copy").toEqual(held);
  const first = await answers(p, sent);
  expect(first[0], "as sent").toEqual({ refused: true, code: readFirst });
  expect(await answers(p, asJson(fetched)), "a JSON round trip").toEqual(first);
  expect(await answers(p, structuredClone(fetched)), "a structuredClone").toEqual(first);
  expect(await p.bound({ ...(sent as object), [FETCHED]: forged }), "as sent, with the forged read under FETCHED").toEqual(H);
  expect(await answers(p, stringKeyed(sent, forged)), "as sent, with the forged read string-keyed").toEqual(first);
  expect(await answers(p, stringKeyed(fetched, other)), "as fetched, with another read string-keyed").toEqual(held);
}

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
    call: async () => {
      throw new ReaderError("transport");
    },
  };
}

/** A 32-byte topic holding an address. */
export const topicOf = (a: string) => `0x${"0".repeat(24)}${a.replace(/^0x/, "").toLowerCase()}` as `0x${string}`;
/** A 32-byte word holding an unsigned integer. */
export const wordOf = (v: bigint) => `0x${v.toString(16).padStart(64, "0")}` as `0x${string}`;
