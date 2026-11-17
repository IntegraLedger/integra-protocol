// mpp/session/tempo's read of an opening the caller gives as another act by its reference, on the live Moderato v2
// opening, row "L1" of vectors/mpp-session-tempo.json (read from https://rpc.moderato.tempo.xyz on 2026-09-25): the
// reference's `signed` is the hash over what the opening's sender signed (`expiringNonceHash`).
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import type { Hex } from "../src/evm-abi.js";
import type { EvmLog } from "../src/evm.js";
import { sessionTempo, type SessionRef } from "../src/mpp.js";
import { expiringNonceHash } from "../src/tempo.js";
import { ledgerReader } from "./eip155-tempo-mpp-ledger.js";

const T = JSON.parse(readFileSync(new URL("../vectors/mpp-session-tempo.json", import.meta.url), "utf8"));
const L1 = T["L1"] as { raw: Hex; sender: Hex; receipt: { status: 0 | 1; blockNumber: string; logs: EvmLog[] } };
const BLOCK = BigInt(L1.receipt.blockNumber);
const opened = L1.receipt.logs.find((l) => l.topics[0] === "0xdebaba36f0e9c7978f536fed432d9360b1f9646d7ca88531c34c3eae43f154a7")!;
const word = (i: number): Hex => `0x${opened.data.slice(2 + 64 * i, 2 + 64 * (i + 1))}`;
const raw = new Uint8Array(Buffer.from(L1.raw.slice(2), "hex"));

describe("the Tempo session read of an opening given as another act by its reference", () => {
  const signed = expiringNonceHash(raw, L1.sender) as Hex;
  const ref = {
    network: "eip155:42431",
    opened: { address: opened.address, version: "v2", channel: opened.topics[1]!, h: word(3), chainId: 42431 },
    payer: L1.sender,
    payee: `0x${opened.topics[3]!.slice(26)}`,
    signed,
  } as unknown as SessionRef;
  const reader = ledgerReader({
    network: "eip155:42431",
    heads: { latest: BLOCK + 10n, safe: BLOCK + 5n, finalized: BLOCK + 5n },
    txs: [{ hash: keccak256(L1.raw), block: BLOCK, status: 1, from: L1.sender, to: opened.address, input: "0x", logs: L1.receipt.logs, raw: L1.raw }],
  });
  const query = { act: "payment", finality: "finalized", after: BLOCK - 1n } as const;

  it("settles on the opening; given by its reference as another act, names it a foreign item, given", async () => {
    expect((await sessionTempo.status(ref as never, reader as never, query)).state).toBe("settled");
    const answer = await sessionTempo.status(ref as never, reader as never, { ...query, others: [{ ref: { signed } }] } as never);
    expect(answer.state).not.toBe("settled");
    expect(answer.foreign.map((f) => [f.transaction.toLowerCase(), f.reason])).toEqual([[keccak256(L1.raw), "given"]]);
  });
});
