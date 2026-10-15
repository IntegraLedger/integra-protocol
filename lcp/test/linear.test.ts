// Functions whose work is linear in their input, held without a clock: each shape is read at two sizes, and the work
// test/work.ts counts at the larger size is at most two and a half times the work at the smaller, where work quadratic
// in the input would be about four times.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import { DELEGATION_MANAGER, REDEEMED_DELEGATION_TOPIC, TRANSFER_TOPIC, type EvmLog, type EvmReader, type Hex } from "../src/evm.js";
import { readEntry } from "../src/internal/avm.js";
import { workOf, workOfAsync } from "./work.js";

describe("readEntry: an Algorand payment entry is decoded in time linear in its bytes", () => {
  // V2's payment entry of x402-exact-algorand.json, {sig, txn}, and its transaction id (py-algorand-sdk).
  const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
  const V2 = Uint8Array.from(Buffer.from(V.V2.expectPaymentGroup[1] as string, "base64"));
  const V2_TXID: string = V.V2.expectPaymentTxid;
  // The msgpack specification's formats.
  const str = (t: string) => [0xa0 | t.length, ...Buffer.from(t)];
  const mapHead = (n: number) => (n < 16 ? [0x80 | n] : [0xde, n >> 8, n & 0xff]);
  const arrayHead = (n: number) => (n < 16 ? [0x90 | n] : [0xdc, n >> 8, n & 0xff]);
  const uint = (v: number) => (v < 0x80 ? [v] : v < 0x100 ? [0xcc, v] : [0xcd, v >> 8, v & 0xff]);
  const NIL = 0xc0;
  // V2 is a map of two members, `sig` (a bin of 64 bytes) and `txn` (a map of eleven).
  const SIG_MEMBER = [...V2.subarray(1, 1 + 4 + 2 + 64)];
  const TXN_MEMBERS = [...V2.subarray(1 + 4 + 2 + 64 + 4 + 1)];

  /**
   * V2's members and `msig: {subsig: [nil × long], subsig: [] × repeats}`: the last list is empty, so the multisignature
   * is at its default, both readers read V2's transaction, and the entry reads with V2's id.
   */
  function repeatedList(long: number, repeats: number): Uint8Array {
    const msig = [...mapHead(1 + repeats), ...str("subsig"), ...arrayHead(long), ...new Array<number>(long).fill(NIL)];
    for (let k = 0; k < repeats; k++) msig.push(...str("subsig"), ...arrayHead(0));
    return Uint8Array.from([...mapHead(3), ...V2.subarray(1), ...str("msig"), ...msig]);
  }

  /**
   * V2 with `sp: {r: {0 … long-1: nil}, r: {} × repeats, r: nil}` added to its transaction: the last `r` is nil, so the
   * state proof is at its default and the entry reads with V2's id.
   */
  function repeatedMap(long: number, repeats: number): Uint8Array {
    const r = [...str("r"), ...mapHead(long)];
    for (let k = 0; k < long; k++) r.push(...uint(k), NIL);
    for (let k = 0; k < repeats; k++) r.push(...str("r"), ...mapHead(0));
    r.push(...str("r"), NIL);
    const txn = [...mapHead(12), ...TXN_MEMBERS, ...str("sp"), ...mapHead(repeats + 2), ...r];
    return Uint8Array.from([0x82, ...SIG_MEMBER, ...str("txn"), ...txn]);
  }

  const cases: [string, (n: number) => Uint8Array, number][] = [
    ["a list member written long, then empty many times", (n) => repeatedList(n, n / 8), 768],
    ["a map member written long, then empty many times", (n) => repeatedMap(n, (2 * n) / 3), 384],
  ];
  for (const [name, shape, n] of cases) {
    it(`${name}: the work at twice the size is at most two and a half times the work`, () => {
      const small = shape(n);
      const large = shape(2 * n);
      // Both sizes within the 6,144 bytes an 8,192-character entry decodes to.
      expect(large.length).toBeLessThanOrEqual(6144);
      for (const b of [small, large]) expect(readEntry(b, 32)).toMatchObject({ txid: V2_TXID });
      const atSmall = workOf(() => readEntry(small, 32));
      const atLarge = workOf(() => readEntry(large, 32));
      expect(atSmall).toBeGreaterThan(n);
      expect(atLarge).toBeLessThanOrEqual(2.5 * atSmall);
    });
  }
});

describe("evmStatus: a delegation payment's receipt is read in time linear in its logs", () => {
  // x402/exact/eip155/erc7710-salt: the binding is data word 5 of a leaf's RedeemedDelegation log from the
  // DelegationManager, and a transfer counts when its `from` is a leaf's root delegator (topic 1).
  const PAYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Hex;
  const PAYEE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as Hex;
  const REDEEMER = "0x00000000000000000000000000000000000000ee" as Hex;
  const TOKEN = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex;
  const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as Hex;
  const word = (h: string) => h.slice(2).toLowerCase().padStart(64, "0");
  const topic = (a: string) => `0x${word(a)}` as Hex;
  // A leaf: its delegate (data word 1) is its redeemer (topic 2).
  const leaf = (root: string): EvmLog => ({
    address: DELEGATION_MANAGER,
    topics: [REDEEMED_DELEGATION_TOPIC, topic(root), topic(REDEEMER)],
    data: `0x${[root, REDEEMER, "0x0", "0x0", "0x0", H].map(word).join("")}` as Hex,
  });
  const transfer: EvmLog = { address: TOKEN, topics: [TRANSFER_TOPIC, topic(PAYER), topic(PAYEE)], data: topic("0x2710") };
  const ref = {
    network: "eip155:84532",
    transaction: `0x${"11".repeat(32)}`,
    bindingLog: { address: DELEGATION_MANAGER, topic0: REDEEMED_DELEGATION_TOPIC, dataWord: 5, value: H },
    // SHA-256 of the transfer's `from`, the one field the transfer log names.
    transferLog: { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from", digest: `0x${createHash("sha256").update(Buffer.from(PAYER.slice(2), "hex")).digest("hex")}` },
  };
  const status = (BINDINGS.find((b) => b.id === "x402/exact/eip155/erc7710-salt") as unknown as {
    status: (ref: object, reader: EvmReader) => Promise<{ state: string }>;
  }).status;
  /** A receipt of `k` leaves, of `k` root delegators the payer last, and `k` transfers from the payer. */
  const readerOf = (k: number): EvmReader => {
    const logs = [...Array.from({ length: k - 1 }, (_, j) => leaf(`0x${(j + 1).toString(16)}`)), leaf(PAYER), ...new Array<EvmLog>(k).fill(transfer)];
    return {
      network: "eip155:84532",
      receipt: async () => ({ status: 1, blockNumber: 100n, logs }),
      blockNumber: async () => 200n,
      transaction: async () => null,
      call: async () => topic("0x0"),
    };
  };

  it("many leaves and many transfers: the work at twice the logs is at most two and a half times the work", async () => {
    const [small, large] = [readerOf(500), readerOf(1000)];
    for (const reader of [small, large]) expect(await status(ref, reader)).toMatchObject({ state: "settled" });
    const atSmall = await workOfAsync(() => status(ref, small));
    const atLarge = await workOfAsync(() => status(ref, large));
    expect(atSmall).toBeGreaterThan(1000);
    expect(atLarge).toBeLessThanOrEqual(2.5 * atSmall);
  });
});
