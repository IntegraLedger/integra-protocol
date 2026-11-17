// `consumerOf`, the lookup of the transaction that consumed a Tempo transaction's value, on a constructed Tempo ledger
// (eip155-tempo-mpp-tempo-ledger.ts): a 2D-nonce transaction signed here with Anvil's published development key #0,
// as viem 2.57.4 hashes and RLP-encodes a `0x76` envelope (ox 0.14.54 `tempo/TxEnvelopeTempo.js:374-448`), and an
// EIP-1559 transaction viem's `signTransaction` signs, which Tempo takes under the protocol nonce
// (tempoxyz/tempo@c8b89f9b `crates/primitives/src/transaction/envelope.rs:48-67`).
import { concat, keccak256, toHex, toRlp, type Hex } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { bytesOf } from "../src/evm-abi.js";
import { ReaderError } from "../src/evm.js";
import { consumerOf, tempoValueOf, type TempoValue } from "../src/internal/tempo-nonce.js";
import { tempoLedgerReader } from "./eip155-tempo-mpp-tempo-ledger.js";

const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const PAYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Hex;
const num = (n: bigint): Hex => (n === 0n ? "0x" : toHex(n));

/** A signed `0x76` transfer on chain 42431, nonce 0 of 2D lane 7, with no `validBefore`. */
async function signedTransfer(): Promise<Hex> {
  const fields = [num(42431n), num(1n), num(2n), num(200_000n), [["0x20c0000000000000000000000000000000000000", "0x", "0x"]], [], num(7n), "0x", "0x", "0x", "0x", "0x", []];
  const s = await sign({ hash: keccak256(concat(["0x76", toRlp(fields as never)])), privateKey: KEY });
  return concat(["0x76", toRlp([...fields, concat([s.r, s.s, toHex(Number(s.v), { size: 1 })])] as never)]) as Hex;
}

describe("consumerOf", () => {
  it("finds a consumer below the position given where the value reads consumed at that very block", async () => {
    const raw = await signedTransfer();
    const hash = keccak256(raw);
    const v = tempoValueOf(bytesOf(raw)!)!;
    expect([v.sender, v.key, v.nonce]).toEqual([PAYER, 7n, 0n]);
    const reader = tempoLedgerReader({
      network: "eip155:42431",
      heads: { latest: 10n, safe: 10n, finalized: 10n },
      txs: [{ hash, block: 3n, status: 1, from: PAYER, to: "0x20c0000000000000000000000000000000000000", input: "0x", logs: [], raw }],
    });
    // The value reads consumed at block 5, the position given, and the range to search above it is that block alone.
    expect(await consumerOf(v, reader, 5n, 5n)).toBe(hash.toLowerCase());
  });

  it("finds a transaction of another type than Tempo's that took a protocol-nonce value", async () => {
    const raw = await privateKeyToAccount(KEY).signTransaction({
      type: "eip1559",
      chainId: 42431,
      nonce: 4,
      to: "0x20c0000000000000000000000000000000000000",
      gas: 21_000n,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
    });
    const hash = keccak256(raw);
    const v: TempoValue = { sender: PAYER, key: 0n, nonce: 4n, signed: hash, validBefore: null };
    const reader = tempoLedgerReader({
      network: "eip155:42431",
      heads: { latest: 10n, safe: 10n, finalized: 10n },
      txs: [{ hash, block: 6n, status: 1, from: PAYER, to: "0x20c0000000000000000000000000000000000000", input: "0x", logs: [], raw }],
      consumed: [{ value: v, from: 6n }],
    });
    expect(await consumerOf(v, reader, 2n, 9n)).toBe(hash.toLowerCase());
  });

  it("answers a read below the head that fails by its reason: history-gap, transport, unparseable, and history-gap where none is named", async () => {
    const raw = await signedTransfer();
    const hash = keccak256(raw);
    const v = tempoValueOf(bytesOf(raw)!)!;
    const base = tempoLedgerReader({
      network: "eip155:42431",
      heads: { latest: 10n, safe: 10n, finalized: 10n },
      txs: [{ hash, block: 3n, status: 1, from: PAYER, to: "0x20c0000000000000000000000000000000000000", input: "0x", logs: [], raw }],
    });
    const failing = (fail: () => Promise<never>) => ({
      ...base,
      call: (to: Hex, data: Hex, block: bigint) => (block < 5n ? fail() : base.call(to, data, block)),
    });
    const cases: [() => Promise<never>, string][] = [
      [() => Promise.reject(new ReaderError("history", "state pruned")), "history-gap"],
      [() => Promise.reject(new ReaderError("transport", "connection reset")), "transport"],
      [() => Promise.resolve("0x01" as never), "unparseable"],
      [() => Promise.reject(new Error("missing trie node")), "history-gap"],
    ];
    const answers = [];
    for (const [fail] of cases) answers.push(await consumerOf(v, failing(fail), 5n, 9n));
    expect(answers).toEqual(cases.map(([, reason]) => ({ unreadable: reason })));
    // The block's transactions the endpoint does not list: transport, as the reader names it.
    const unlisted = tempoLedgerReader({
      network: "eip155:42431",
      heads: { latest: 10n, safe: 10n, finalized: 10n },
      txs: [{ hash, block: 3n, status: 1, from: PAYER, to: "0x20c0000000000000000000000000000000000000", input: "0x", logs: [], raw }],
      unlisted: [3n],
    });
    expect(await consumerOf(v, unlisted, 5n, 9n)).toEqual({ unreadable: "transport" });
  });
});
