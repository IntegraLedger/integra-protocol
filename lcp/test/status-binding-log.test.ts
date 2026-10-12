// The EVM pairings whose reference always names the log carrying H or its commitment, given a ref without that log.
// A read that cannot check H is pending `unreadable`, never failed (docs/guides/rails.md, "Reading settlement": failed
// means the rail itself says so). The transfer digest is SHA-256 over from, to and the uint256 value, by node:crypto.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import {
  AUTHORIZATION_USED_TOPIC,
  DELEGATION_MANAGER,
  ESCROW,
  PAYMENT_AUTHORIZED_TOPIC,
  REDEEMED_DELEGATION_TOPIC,
  TRANSFER_TOPIC,
  type EvmReader,
  type EvmRef,
  type Hex,
} from "../src/evm.js";
import { TRANSFER_WITH_MEMO_TOPIC } from "../src/tempo.js";
import { BATCH_SETTLEMENT, DEPOSITED_TOPIC } from "../src/x402-batch-settlement.js";

const NET = "eip155:84532" as const;
const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex;
// The published Anvil development accounts 0 and 1.
const PAYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const PAYEE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as Hex; // SHA-256("abc"), FIPS 180-2
const word = (hex: string) => hex.slice(2).toLowerCase().padStart(64, "0");
const digest = ("0x" +
  createHash("sha256")
    .update(Buffer.from(PAYER.slice(2) + PAYEE.slice(2) + word("0x2710"), "hex"))
    .digest("hex")) as Hex;
const transferLog = { address: TOKEN, topic0: TRANSFER_TOPIC, identity: "from,to,value" as const, digest };
const paid = { address: TOKEN, topics: ["0x" + word(TRANSFER_TOPIC), "0x" + word(PAYER), "0x" + word(PAYEE)] as Hex[], data: ("0x" + word("0x2710")) as Hex };

/** Each pairing, with the binding log its own reference names. */
const PAIRINGS: [string, NonNullable<EvmRef["bindingLog"]>][] = [
  ["x402/exact/eip155/erc7710-salt", { address: DELEGATION_MANAGER, topic0: REDEEMED_DELEGATION_TOPIC, dataWord: 5, value: H }],
  ["x402/auth-capture/eip155/eip3009", { address: ESCROW["v1.1"].escrow, topic0: PAYMENT_AUTHORIZED_TOPIC, index: 1, value: H }],
  ["x402/auth-capture/eip155/permit2", { address: ESCROW["v1.0"].escrow, topic0: ESCROW["v1.0"].chargedTopic, index: 1, value: H }],
  ["x402/batch-settlement/eip155", { address: BATCH_SETTLEMENT, topic0: DEPOSITED_TOPIC, index: 1, value: H }],
  ["mpp/charge/evm/authorization", { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: H }],
  ["mpp/charge/tempo/memo", { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: H }],
  ["mpp/charge/tempo/push", { address: TOKEN, topic0: TRANSFER_WITH_MEMO_TOPIC, index: 3, value: H }],
  ["mpp/charge/usdc/evm", { address: TOKEN, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: H }],
];

/** A reader holding one successful receipt with the payer's transfer and no other log; it counts its calls. */
function reader(calls: string[]): EvmReader {
  return {
    network: NET,
    receipt: async () => (calls.push("receipt"), { status: 1, blockNumber: 100n, logs: [paid] }),
    blockNumber: async () => (calls.push("blockNumber"), 100n),
    transaction: async () => (calls.push("transaction"), null),
    call: async () => (calls.push("call"), "0x"),
  };
}

describe("a ref without its pairing's binding log", () => {
  const unreadable = { state: "pending", why: "unreadable" };
  for (const [id, own] of PAIRINGS) {
    it(`${id}: pending unreadable, with nothing read; its own binding log is read`, async () => {
      const b = BINDINGS.find((x) => x.id === id) as unknown as {
        status: (ref: EvmRef & { transaction: Hex }, reader: EvmReader) => Promise<unknown>;
      };
      const tx = ("0x" + "ab".repeat(32)) as Hex;
      const refs = [
        { network: NET, transaction: tx, transferLog },
        { network: NET, transaction: tx, transferLog, bindingLog: { ...own, topic0: ("0x" + "22".repeat(32)) as Hex } },
        { network: NET, transaction: tx, transferLog, bindingLog: { ...own, value: "0x12" as Hex } },
        { network: NET, transaction: tx, transferLog, bindingLog: { address: own.address, topic0: own.topic0, value: H } },
      ];
      for (const ref of refs) {
        const calls: string[] = [];
        expect(await b.status(ref as EvmRef & { transaction: Hex }, reader(calls))).toEqual(unreadable);
        expect(calls).toEqual([]);
      }
      const calls: string[] = [];
      const read = await b.status({ network: NET, transaction: tx, transferLog, bindingLog: own }, reader(calls));
      expect(read).toEqual({ state: "failed", why: "binding-log-not-found" });
      expect(calls).toEqual(["receipt"]);
    });
  }
  it("covers each of the eight pairings", () => {
    expect(PAIRINGS.map(([id]) => BINDINGS.some((b) => b.id === id))).toEqual(Array(8).fill(true));
  });
});
