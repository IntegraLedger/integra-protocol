import { describe, expect, it } from "vitest";
import {
  parseTransferWithMemoLog,
  readTransferWithMemoEvents,
  settlementRefOf,
  type TempoLogView,
  tempoMemoLogFilter,
} from "../src/log.js";
import {
  MAINNET_AMOUNT,
  MAINNET_MEMO,
  MAINNET_MEMO_LOG,
  MAINNET_PAYER,
  MAINNET_PLAIN_TRANSFER_LOG,
  MAINNET_RECEIPT_LOGS,
  MAINNET_RECIPIENT,
  MAINNET_TOKEN,
  MAINNET_TX_HASH,
} from "./fixtures/mainnet-transfer-with-memo.js";

const TOPIC0 =
  "0x57bc7354aa85aed339e000bccffabbc529466af35f0772c8f8ee1145927de7f0";
const ZERO_WORD = `0x${"00".repeat(32)}`;
const ATR = `0x${"ab".repeat(32)}`;

/** A `TransferWithMemo` log in the shape `eth_getLogs` returns, for the cases mainnet has not produced. */
function memoLog(over: {
  from?: string;
  to?: string;
  memo?: string;
  amount?: string;
  logIndex?: string;
  txHash?: string;
}): TempoLogView {
  return {
    address: MAINNET_TOKEN,
    topics: [
      TOPIC0,
      over.from ?? `0x${"00".repeat(12)}${MAINNET_PAYER.slice(2)}`,
      over.to ?? `0x${"00".repeat(12)}${MAINNET_RECIPIENT.slice(2)}`,
      over.memo ?? ATR,
    ],
    data: over.amount ?? `0x${"00".repeat(31)}01`,
    transactionHash: over.txHash ?? MAINNET_TX_HASH,
    logIndex: over.logIndex ?? "0x0",
  };
}

describe("parseTransferWithMemoLog", () => {
  it("decodes a REAL mainnet log: from, to, amount, memo, movement", () => {
    const event = parseTransferWithMemoLog(MAINNET_MEMO_LOG);
    expect(event).toEqual({
      address: MAINNET_TOKEN,
      from: MAINNET_PAYER,
      to: MAINNET_RECIPIENT,
      amount: MAINNET_AMOUNT,
      memo: MAINNET_MEMO,
      movement: "transfer",
    });
  });

  it("returns null for the plain ERC-20 Transfer log of the SAME transfer", () => {
    // TIP-20 emits BOTH events for one memo transfer. A reader that matched `Transfer` would find no
    // memo and conclude the settlement carried none.
    expect(parseTransferWithMemoLog(MAINNET_PLAIN_TRANSFER_LOG)).toBeNull();
  });

  it("classifies a zero `from` as a MINT, not a transfer", () => {
    // The live spec says this event is "Emitted when a transfer, mint, or burn is performed with an
    // attached memo" — from = address(0) for mints, to = address(0) for burns. An issuer can therefore
    // put any 32 bytes on this topic without anyone paying anyone.
    expect(
      parseTransferWithMemoLog(memoLog({ from: ZERO_WORD }))?.movement,
    ).toBe("mint");
  });

  it("classifies a zero `to` as a BURN, not a transfer", () => {
    expect(parseTransferWithMemoLog(memoLog({ to: ZERO_WORD }))?.movement).toBe(
      "burn",
    );
  });

  it("returns null when topic 0 is a different event, even with all four topics present", () => {
    // Four topics and a valid memo in slot 3 — only the signature says this is not our event.
    const log = memoLog({});
    expect(
      parseTransferWithMemoLog({
        ...log,
        topics: [`0x${"11".repeat(32)}`, ...log.topics.slice(1)],
      }),
    ).toBeNull();
  });

  it("returns null for a log with NO topics at all", () => {
    expect(parseTransferWithMemoLog({ ...memoLog({}), topics: [] })).toBeNull();
  });

  it("returns null when the `from` topic is not a 32-byte word", () => {
    // Without this guard the event would carry `from: null` and still be handed to a caller.
    expect(
      parseTransferWithMemoLog({
        ...memoLog({}),
        topics: [
          TOPIC0,
          "0xdead",
          `0x${"00".repeat(12)}${"11".repeat(20)}`,
          ATR,
        ],
      }),
    ).toBeNull();
  });

  it("returns null when the `to` topic is not a 32-byte word", () => {
    expect(
      parseTransferWithMemoLog({
        ...memoLog({}),
        topics: [
          TOPIC0,
          `0x${"00".repeat(12)}${"11".repeat(20)}`,
          "0xdead",
          ATR,
        ],
      }),
    ).toBeNull();
  });

  it("returns null when the memo topic is not a 32-byte value", () => {
    expect(parseTransferWithMemoLog(memoLog({ memo: "0xdead" }))).toBeNull();
  });

  it("returns null when the log carries fewer than four topics (no memo to read)", () => {
    const log = memoLog({});
    expect(
      parseTransferWithMemoLog({ ...log, topics: log.topics.slice(0, 3) }),
    ).toBeNull();
  });

  it("returns null when `data` is too short to hold a uint256 amount", () => {
    expect(parseTransferWithMemoLog(memoLog({ amount: "0x00" }))).toBeNull();
  });

  it("lower-cases addresses and the memo so comparisons are exact", () => {
    const event = parseTransferWithMemoLog({
      ...MAINNET_MEMO_LOG,
      address: MAINNET_TOKEN.toUpperCase(),
      topics: MAINNET_MEMO_LOG.topics.map((t) => t.toUpperCase()) as string[],
    });
    expect(event?.address).toBe(MAINNET_TOKEN);
    expect(event?.memo).toBe(MAINNET_MEMO);
    expect(event?.from).toBe(MAINNET_PAYER);
  });
});

describe("readTransferWithMemoEvents", () => {
  it("finds the one memo event among a real settlement's three logs", () => {
    const events = readTransferWithMemoEvents(MAINNET_RECEIPT_LOGS);
    expect(events).toHaveLength(1);
    expect(events[0]?.memo).toBe(MAINNET_MEMO);
  });

  it("returns every memo event in order — a split payment emits one per recipient", () => {
    const events = readTransferWithMemoEvents([
      memoLog({ memo: ATR, logIndex: "0x1" }),
      MAINNET_PLAIN_TRANSFER_LOG,
      memoLog({ memo: `0x${"cd".repeat(32)}`, logIndex: "0x2" }),
    ]);
    expect(events.map((e) => e.memo)).toEqual([ATR, `0x${"cd".repeat(32)}`]);
  });

  it("returns an empty list for logs with no memo event", () => {
    expect(readTransferWithMemoEvents([MAINNET_PLAIN_TRANSFER_LOG])).toEqual(
      [],
    );
  });
});

describe("settlementRefOf", () => {
  it("builds a settlement ref from a real log's identity", () => {
    expect(settlementRefOf(MAINNET_MEMO_LOG)).toEqual({
      txHash: MAINNET_TX_HASH,
      logIndex: 3,
    });
  });

  it("omits logIndex when the transport did not supply one (exactOptionalPropertyTypes)", () => {
    const full = memoLog({});
    const noIndex: TempoLogView = {
      address: full.address,
      topics: full.topics,
      data: full.data,
      transactionHash: MAINNET_TX_HASH,
    };
    expect(settlementRefOf(noIndex)).toEqual({ txHash: MAINNET_TX_HASH });
  });

  it("THROWS when the log carries no transaction hash — a broken transport, not a policy outcome", () => {
    const full = memoLog({});
    const noTx: TempoLogView = {
      address: full.address,
      topics: full.topics,
      data: full.data,
      logIndex: "0x0",
    };
    expect(() => settlementRefOf(noTx)).toThrow(/transactionHash/);
  });
});

describe("tempoMemoLogFilter", () => {
  it("builds the eth_getLogs filter that makes this binding forward-indexable", () => {
    // from and to are left null so the query is by memo ALONE: every settlement ever bound to one
    // atrHash, in one call. Filtering by recipient would be wrong as well as narrower — TIP-20 resolves
    // a virtual-address recipient to its master wallet and emits the event against THAT address.
    expect(
      tempoMemoLogFilter(ATR, {
        fromBlock: "0x0",
        toBlock: "latest",
        address: MAINNET_TOKEN,
      }),
    ).toEqual({
      address: MAINNET_TOKEN,
      topics: [TOPIC0, null, null, ATR],
      fromBlock: "0x0",
      toBlock: "latest",
    });
  });

  it("normalizes the memo AND the token to the lower-case forms the RPC matches", () => {
    const filter = tempoMemoLogFilter("AB".repeat(32), {
      fromBlock: 0,
      toBlock: 1,
      address: MAINNET_TOKEN.toUpperCase(),
    });
    expect(filter.topics[3]).toBe(ATR);
    expect(filter.address).toBe(MAINNET_TOKEN);
    expect(filter.fromBlock).toBe(0);
  });

  it("throws on a memo that is not 32 bytes — a short topic silently matches nothing", () => {
    expect(() =>
      tempoMemoLogFilter("0x1234", {
        fromBlock: "0x0",
        toBlock: "latest",
        address: MAINNET_TOKEN,
      }),
    ).toThrow(/32-byte/);
  });

  it("THROWS on a token outside the TIP-20 range — there is no every-token spelling", () => {
    // The memo topic identifies a reference; it does not authenticate an emitter. A filter that cannot
    // name its token would return an attacker's own token's logs for the same memo.
    expect(() =>
      tempoMemoLogFilter(ATR, {
        fromBlock: "0x0",
        toBlock: "latest",
        address: "0x1111111111111111111111111111111111111111",
      }),
    ).toThrow(/TIP-20/);
  });
});
