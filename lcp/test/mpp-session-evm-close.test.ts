// The EVM session's close read. draft-evm-session-00 (tempoxyz/mpp-specs at 08e7dd87, blob 6b50d035) defines the
// escrow functions that finalize a channel and no close event:
//   function close(bytes32 channelId, uint128 cumulativeAmount, bytes calldata signature) external;
//   function closeWithAuthorization(bytes32 channelId, uint128 cumulativeAmount, uint256 nonce, uint256 deadline,
//     bytes calldata payeeSignature, bytes calldata voucherSignature) external;
//   function withdraw(bytes32 channelId) external;
// A reported close counts only when it succeeded and is a call to the escrow the challenge named, of one of those
// functions, naming the recorded channel. The calldata here is viem's ABI encoding of those signatures.
import { readFileSync } from "node:fs";
import { encodeFunctionData, parseAbi, toFunctionSelector, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError, type EvmReader, type EvmTransaction } from "../src/evm.js";
import { EVM_CLOSE_SELECTORS, sessionEvm, sessionStatus, type SessionRef } from "../src/mpp.js";
import { challenge } from "./mpp-fixtures.js";

const E = JSON.parse(readFileSync(new URL("../vectors/mpp-session-evm.json", import.meta.url), "utf8"));
const f = E.fixed;
const CHANNEL = E.ES1.expectChannelId as Hex;
const OTHER = `0x${"11".repeat(32)}` as Hex;
const TX = `0x${"22".repeat(32)}` as Hex;
const SIGNATURES = [
  "close(bytes32,uint128,bytes)",
  "closeWithAuthorization(bytes32,uint128,uint256,uint256,bytes,bytes)",
  "withdraw(bytes32)",
];
const ABI = parseAbi([
  "function close(bytes32 channelId, uint128 cumulativeAmount, bytes signature)",
  "function closeWithAuthorization(bytes32 channelId, uint128 cumulativeAmount, uint256 nonce, uint256 deadline, bytes payeeSignature, bytes voucherSignature)",
  "function withdraw(bytes32 channelId)",
  "function settle(bytes32 channelId, uint128 cumulativeAmount, bytes signature)",
]);
const call = {
  close: (c: Hex) => encodeFunctionData({ abi: ABI, functionName: "close", args: [c, 5n, "0x"] }),
  closeWithAuthorization: (c: Hex) =>
    encodeFunctionData({ abi: ABI, functionName: "closeWithAuthorization", args: [c, 5n, 1n, 1790000600n, `0x${"ab".repeat(65)}`, "0x"] }),
  withdraw: (c: Hex) => encodeFunctionData({ abi: ABI, functionName: "withdraw", args: [c] }),
  settle: (c: Hex) => encodeFunctionData({ abi: ABI, functionName: "settle", args: [c, 5n, "0x"] }),
};

function reader(a: { status?: 0 | 1; tx?: EvmTransaction | null | "error" }): EvmReader {
  return {
    network: "eip155:84532",
    receipt: async () => ({ status: a.status ?? 1, blockNumber: 90n, logs: [] }),
    blockNumber: async (tag) => (tag === "finalized" ? 100n : 105n),
    transaction: async () => {
      if (a.tx === "error") throw new ReaderError("transport");
      return a.tx ?? null;
    },
    call: async () => {
      throw new ReaderError("transport");
    },
  };
}

describe("the EVM session's close read", () => {
  const ES = challenge("evm", "session", f.request);
  const ref = sessionEvm.closeRef(ES, CHANNEL) as SessionRef;
  // The sender is the payer; the close read does not read it.
  const read = (tx: Omit<EvmTransaction, "from"> | null | "error", status: 0 | 1 = 1) =>
    sessionStatus({ ...ref, transaction: TX }, reader({ status, tx: tx === null || tx === "error" ? tx : { from: f.payer, ...tx } }));
  const escrow = f.escrow as Hex;

  it("the three selectors are the draft's function signatures", () => {
    expect([...EVM_CLOSE_SELECTORS]).toEqual(SIGNATURES.map((s) => toFunctionSelector(s)));
  });

  it("close, closeWithAuthorization and withdraw on the escrow naming the channel are the close, at the block's finality", async () => {
    for (const data of [call.close(CHANNEL), call.closeWithAuthorization(CHANNEL), call.withdraw(CHANNEL)]) {
      expect(await read({ to: escrow, input: data })).toEqual({ state: "settled", finality: "finalized", blockNumber: 90n });
    }
  });

  it("another channel, another contract, or another escrow function is not a close", async () => {
    expect(await read({ to: escrow, input: call.withdraw(OTHER) })).toEqual({ state: "pending", why: "not-a-close" });
    expect(await read({ to: `0x${"33".repeat(20)}`, input: call.close(CHANNEL) })).toEqual({ state: "pending", why: "not-a-close" });
    expect(await read({ to: null, input: call.close(CHANNEL) })).toEqual({ state: "pending", why: "not-a-close" });
    expect(await read({ to: escrow, input: call.settle(CHANNEL) })).toEqual({ state: "pending", why: "not-a-close" });
    expect(await read({ to: escrow, input: call.withdraw(CHANNEL).slice(0, 40) as Hex })).toEqual({ state: "pending", why: "not-a-close" });
  });

  it("a reverted close is failed; an unread or absent transaction is pending", async () => {
    expect(await read({ to: escrow, input: call.close(CHANNEL) }, 0)).toEqual({ state: "failed", why: "reverted" });
    expect(await read("error")).toEqual({ state: "pending", why: "unreadable" });
    expect(await read(null)).toEqual({ state: "pending", why: "not-found" });
  });
});
