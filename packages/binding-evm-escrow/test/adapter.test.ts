import type {
  ChainReader,
  SettlementRef,
  VerifierPorts,
} from "@integraledger/lcp-binding-core";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type Log,
  parseAbiParameters,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  atrHashFromSalt,
  createEscrowAdapter,
  ESCROW_EVENTS_ABI,
  type EscrowProposal,
  type PaymentInfo,
  saltFromAtrHash,
} from "../src/adapter.js";
import { AUTH_CAPTURE_ESCROW } from "../src/collectors.js";

const CHAIN_ID = 84532;
const ATR = `0x${"ab".repeat(32)}` as const;
const COLLECTOR = "0x0E3dF9510de65469C4518D7843919c0b8C7A7757" as const;
const adapter = createEscrowAdapter({ chainId: CHAIN_ID });

const PI: PaymentInfo = {
  operator: "0x1111111111111111111111111111111111111111",
  payer: "0x2222222222222222222222222222222222222222",
  receiver: "0x3333333333333333333333333333333333333333",
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  maxAmount: 1000n,
  preApprovalExpiry: 4102444800,
  authorizationExpiry: 4102448400,
  refundExpiry: 4102531200,
  minFeeBps: 0,
  maxFeeBps: 0,
  feeReceiver: "0x0000000000000000000000000000000000000000",
  salt: saltFromAtrHash(ATR),
};

const PI_TUPLE =
  "(address operator, address payer, address receiver, address token, uint120 maxAmount, uint48 preApprovalExpiry, uint48 authorizationExpiry, uint48 refundExpiry, uint16 minFeeBps, uint16 maxFeeBps, address feeReceiver, uint256 salt)";

/** A synthetic PaymentAuthorized log (PaymentInfo tuple in data; paymentInfoHash indexed). */
function authorizedLog(pi: PaymentInfo, txHash: Hex, logIndex: number): Log {
  const topics = encodeEventTopics({
    abi: ESCROW_EVENTS_ABI,
    eventName: "PaymentAuthorized",
    args: { paymentInfoHash: `0x${"cc".repeat(32)}` as Hex },
  });
  const data = encodeAbiParameters(
    parseAbiParameters(
      `${PI_TUPLE} paymentInfo, uint256 amount, address tokenCollector`,
    ),
    [pi, pi.maxAmount, COLLECTOR],
  );
  return {
    address: AUTH_CAPTURE_ESCROW,
    topics,
    data,
    transactionHash: txHash,
    logIndex,
  } as unknown as Log;
}

/** A synthetic PaymentCaptured log (only paymentInfoHash + amount — no PaymentInfo). */
function capturedLog(txHash: Hex, logIndex: number): Log {
  const topics = encodeEventTopics({
    abi: ESCROW_EVENTS_ABI,
    eventName: "PaymentCaptured",
    args: { paymentInfoHash: `0x${"cc".repeat(32)}` as Hex },
  });
  const data = encodeAbiParameters(
    parseAbiParameters("uint256 amount, uint16 feeBps, address feeReceiver"),
    [1000n, 0, "0x0000000000000000000000000000000000000000"],
  );
  return {
    address: AUTH_CAPTURE_ESCROW,
    topics,
    data,
    transactionHash: txHash,
    logIndex,
  } as unknown as Log;
}

/** The same log re-emitted from a DIFFERENT contract — a look-alike, byte-identical but for `address`. */
function fromContract(log: Log, address: `0x${string}`): Log {
  return { ...log, address } as unknown as Log;
}

function fakeChain(opts: {
  txLogs?: Log[];
  queryLogs?: Log[];
  blockTime?: bigint;
}): ChainReader {
  return {
    getLogs: async () => opts.queryLogs ?? [],
    getTransactionLogs: async () => opts.txLogs ?? [],
    readContract: async () => {
      throw new Error("unused");
    },
    blockTime: async () => opts.blockTime ?? 0n,
  };
}
const portsWith = (chain: ChainReader): VerifierPorts => ({
  chain,
  artifacts: { resolve: async () => null },
});
const SETTLEMENT: SettlementRef = {
  chainId: CHAIN_ID,
  txHash: `0x${"11".repeat(32)}`,
};

describe("salt codec", () => {
  it("salt = uint256(atrHash) round-trips", () => {
    expect(atrHashFromSalt(saltFromAtrHash(ATR))).toBe(ATR);
  });
  it.each([
    ["a leading-zero atrHash", `0x${"00".repeat(31)}01`],
    ["the zero atrHash", `0x${"00".repeat(32)}`],
    ["a half-length-looking value", `0x${"00".repeat(16)}${"ff".repeat(16)}`],
  ])("zero-pads back to a full 32 bytes: %s", (_why, atr) => {
    // uint256 drops leading zeroes, so the reverse must restore them. Without the pad this returns a
    // SHORT hex string that is no longer the atrHash it recovered — and every downstream comparison
    // (recovered === advertised) then reads as a mismatch on a perfectly good settlement.
    const back = atrHashFromSalt(saltFromAtrHash(atr as `0x${string}`));
    expect(back).toBe(atr);
    expect(back).toHaveLength(66);
  });
});

describe("propose", () => {
  it("fills PaymentInfo.salt from the atrHash (never re-derived)", async () => {
    const { salt, ...ctx } = PI;
    const out = await adapter.propose(ATR, ctx);
    expect("refused" in out).toBe(false);
    if ("refused" in out) return;
    expect(out.ok).toBe(true);
    const proposal = out.value as EscrowProposal;
    expect(proposal.paymentInfo.salt).toBe(saltFromAtrHash(ATR));
    expect(atrHashFromSalt(proposal.paymentInfo.salt)).toBe(ATR);
    expect(proposal.paymentInfo.payer).toBe(PI.payer);
  });
});

describe("recover", () => {
  it("reads the atrHash back from PaymentInfo.salt in the PaymentAuthorized event (WLD-3)", async () => {
    const chain = fakeChain({
      txLogs: [authorizedLog(PI, SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if ("refused" in out) return;
    expect(out.ok).toBe(true);
    expect(out.value).toBe(ATR);
  });

  it("finds the salt-bearing event even when it is not the first log in the tx", async () => {
    // A charge tx emits PaymentCharged after other escrow logs. Taking the first escrow event rather
    // than the first event WITH a cleartext PaymentInfo would refuse a settlement that is recoverable.
    const chain = fakeChain({
      txLogs: [
        capturedLog(SETTLEMENT.txHash as Hex, 0),
        authorizedLog(PI, SETTLEMENT.txHash as Hex, 1),
      ],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR);
  });

  it("refuses when no salt-bearing event is present (only PaymentCaptured)", async () => {
    const chain = fakeChain({
      txLogs: [capturedLog(SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect(out).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "escrow/no-recoverable-event",
    });
  });

  it("REFUSES two payments with different salts and no logIndex pinned", async () => {
    // AuthCaptureEscrow can authorize several independent payments in one transaction, each with its own
    // PaymentInfo and therefore its own atrHash. Taking the first salt-bearing event answered one
    // payment's weld for a settlement that carried several — a wrong atrHash returned as a confident
    // recovery, which is worse than a refusal at a verification boundary.
    const other = `0x${"ee".repeat(32)}` as const;
    const chain = fakeChain({
      txLogs: [
        authorizedLog(PI, SETTLEMENT.txHash as Hex, 0),
        authorizedLog(
          { ...PI, salt: saltFromAtrHash(other) },
          SETTLEMENT.txHash as Hex,
          1,
        ),
      ],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect(out).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "escrow/ambiguous-settlement",
    });
  });

  it("does NOT refuse the SAME payment seen twice — authorize and charge carry one salt", async () => {
    // The authorize→capture shape means one payment legitimately appears in two salt-bearing events.
    // Refusing on count rather than on distinctness would break the rail's own happy path.
    const chain = fakeChain({
      txLogs: [
        authorizedLog(PI, SETTLEMENT.txHash as Hex, 0),
        authorizedLog(PI, SETTLEMENT.txHash as Hex, 1),
      ],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR);
  });

  it("disambiguates by logIndex when the ref pins one", async () => {
    const other = `0x${"ee".repeat(32)}` as const;
    const chain = fakeChain({
      txLogs: [
        authorizedLog(
          { ...PI, salt: saltFromAtrHash(other) },
          SETTLEMENT.txHash as Hex,
          0,
        ),
        authorizedLog(PI, SETTLEMENT.txHash as Hex, 1),
      ],
    });
    const out = await adapter.recover(
      { ...SETTLEMENT, logIndex: 1 },
      portsWith(chain),
    );
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR);
  });

  it("refuses a pinned logIndex that matches no salt-bearing event — never a fall-through to the first", async () => {
    const chain = fakeChain({
      txLogs: [authorizedLog(PI, SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(
      { ...SETTLEMENT, logIndex: 9 },
      portsWith(chain),
    );
    expect(out).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "escrow/log-index-not-found",
    });
  });
});

describe("observe", () => {
  it("maps escrow events to lifecycle transitions at block time", async () => {
    const chain = fakeChain({
      txLogs: [
        authorizedLog(PI, SETTLEMENT.txHash as Hex, 0),
        capturedLog(SETTLEMENT.txHash as Hex, 1),
      ],
      blockTime: 1_700_000_000n,
    });
    const out = await adapter.observe(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if ("refused" in out) return;
    expect(out.ok).toBe(true);
    expect(out.value.map((t) => t.state)).toEqual(["authorized", "captured"]);
    expect(out.value[0]?.at).toBe(1_700_000_000n);
  });

  it("returns [] for a tx with no escrow events, without reaching for block time", async () => {
    // Nothing to timestamp means no reason to spend an RPC round-trip on one; a blockTime that fails
    // must not turn "this settlement has no escrow events" into an error.
    const chain: ChainReader = {
      ...fakeChain({ txLogs: [] }),
      blockTime: async () => {
        throw new Error(
          "blockTime must not be called when there is nothing to observe",
        );
      },
    };
    const out = await adapter.observe(SETTLEMENT, portsWith(chain));
    expect(out).toEqual({ ok: true, value: [] });
  });
});

describe("enumerate", () => {
  it("event-data scan: finds settlements whose PaymentInfo.salt == uint256(atrHash)", async () => {
    const other: PaymentInfo = {
      ...PI,
      salt: saltFromAtrHash(`0x${"cd".repeat(32)}`),
    };
    const t1 = `0x${"aa".repeat(32)}` as Hex;
    const chain = fakeChain({
      queryLogs: [
        authorizedLog(PI, t1, 0),
        authorizedLog(other, `0x${"bb".repeat(32)}`, 1),
      ],
    });
    const refs = await adapter.enumerate?.(ATR, portsWith(chain));
    expect(refs).toHaveLength(1);
    expect(refs?.[0]).toEqual({ chainId: CHAIN_ID, txHash: t1, logIndex: 0 });
  });

  it("omits txHash/logIndex from the ref rather than carrying them as undefined", async () => {
    // A pending-block log has neither. `{chainId, txHash: undefined}` is a different value from
    // `{chainId}` under exactOptionalPropertyTypes, and it is what a consumer would then hand to
    // getTransactionLogs — where the absent-txHash guard reads a present key and fails differently.
    const pending = {
      ...authorizedLog(PI, `0x${"aa".repeat(32)}`, 0),
      transactionHash: null,
      logIndex: null,
    } as unknown as Log;
    const refs = await adapter.enumerate?.(
      ATR,
      portsWith(fakeChain({ queryLogs: [pending] })),
    );
    expect(refs?.[0]).toStrictEqual({ chainId: CHAIN_ID });
  });
});

describe("only the escrow's own logs count (a look-alike event is not a weld)", () => {
  const IMPOSTOR = "0x6666666666666666666666666666666666666666" as const;

  it("recover refuses a byte-identical PaymentAuthorized emitted by another contract", async () => {
    const chain = fakeChain({
      txLogs: [
        fromContract(authorizedLog(PI, SETTLEMENT.txHash as Hex, 0), IMPOSTOR),
      ],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect(out).toMatchObject({ code: "escrow/no-recoverable-event" });
  });

  it("observe ignores it, and enumerate does not return it", async () => {
    const spoof = fromContract(
      authorizedLog(PI, `0x${"aa".repeat(32)}`, 0),
      IMPOSTOR,
    );
    const observed = await adapter.observe(
      SETTLEMENT,
      portsWith(fakeChain({ txLogs: [spoof] })),
    );
    expect(observed).toEqual({ ok: true, value: [] });
    const refs = await adapter.enumerate?.(
      ATR,
      portsWith(fakeChain({ queryLogs: [spoof] })),
    );
    expect(refs).toEqual([]);
  });

  it("but the same log from the configured escrow IS recovered (the filter is the address, not luck)", async () => {
    const custom = createEscrowAdapter({ chainId: CHAIN_ID, escrow: IMPOSTOR });
    const chain = fakeChain({
      txLogs: [
        fromContract(authorizedLog(PI, SETTLEMENT.txHash as Hex, 0), IMPOSTOR),
      ],
    });
    const out = await custom.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR);
  });
});
