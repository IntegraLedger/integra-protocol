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
  decodeEscrowLogs,
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

  /**
   * ⛔ THE SALT IS AN EMIT PATH AND IT VALIDATED NOTHING. `saltFromAtrHash` was `BigInt(h)` under a
   * comment claiming "a malformed atrHash is a programming error surfaced by BigInt() (fail-fast)".
   * `BigInt` accepts ANY parseable numeral, so it fails fast on almost nothing: a decimal string, a
   * binary or octal literal, a whitespace-padded value, a hash of the wrong length.
   *
   * The harm is a SILENT ROUND TRIP rather than a crash. `0x` + `ab`×31 welds as a salt and recovers as
   * `0x00abab…` — a DIFFERENT hash — so a verifier reports a mismatch against a settlement that welded
   * exactly what it was handed, and the party least able to explain it is the one that did nothing
   * wrong. `"12345"` welds as `0x…3039`. A 33-byte value recovers as 68 characters, not a bytes32.
   *
   * This was the only EVM rail with no atrHash validation at all: `binding-evm-x402` calls
   * `canonicalAtrHash` twice, `binding-evm-mpp` six times, `binding-tempo-mpp` three, this package zero.
   * THROWING is that function's stated contract for an emit path — "writing a canonical form of a
   * non-hash would put a fabricated reference on a wire" — and it is what the original comment intended.
   */
  it.each([
    [
      "31 bytes — welds, then recovers as a DIFFERENT hash",
      `0x${"ab".repeat(31)}`,
    ],
    [
      "33 bytes — recovers as 68 characters, not a bytes32",
      `0x${"ab".repeat(33)}`,
    ],
    ["a decimal numeral", "12345"],
    ["the empty string", ""],
    ["a binary literal", "0b1010"],
    ["an octal literal", "0o777"],
    ["a hash with surrounding whitespace", `  0x${"ab".repeat(32)}  `],
    ["an uppercase 0X prefix — not the ATR canon", `0X${"AB".repeat(32)}`],
    ["non-hex digits", `0x${"zz".repeat(32)}`],
  ])("⛔ REFUSES %s rather than welding it", (_why, bad) => {
    expect(() => saltFromAtrHash(bad as `0x${string}`)).toThrow(/32-byte/);
  });

  it("⭐ still accepts uppercase HEX DIGITS — the ATR canon is case-insensitive on the digits", () => {
    // The one case that must NOT be refused, and the reason the screen is `isAtrHash` rather than a
    // lowercase-only regex: an uppercase hash is the same hash and the counterparty spelling it that way
    // is conformant. Recovery emits the canonical lowercase.
    const upper = `0x${"AB".repeat(32)}` as `0x${string}`;
    expect(atrHashFromSalt(saltFromAtrHash(upper))).toBe(
      `0x${"ab".repeat(32)}`,
    );
  });

  it("⛔ atrHashFromSalt refuses a salt no uint256 could hold — the mirror of the same rule", () => {
    // The reverse is a decode path fed by viem's uint256, so this is unreachable through the adapter. It
    // is exported, and `padStart(64)` does not truncate: an out-of-range salt returns a string LONGER
    // than 66 characters, which then compares unequal to every real atrHash instead of being refused.
    expect(() => atrHashFromSalt(1n << 256n)).toThrow(/uint256/);
    expect(() => atrHashFromSalt(-1n)).toThrow(/uint256/);
    // Both ends of the range are in — a `<`/`<=` slip either way is otherwise invisible.
    expect(atrHashFromSalt((1n << 256n) - 1n)).toBe(`0x${"ff".repeat(32)}`);
    expect(atrHashFromSalt(0n)).toBe(`0x${"00".repeat(32)}`);
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

/**
 * ⛔⛔ **THE JOIN KEY, SURFACED — the field a two-phase observer cannot do without (C-31).**
 *
 * `paymentInfoHash` is the indexed topic on every one of the six escrow events, and it is the key the
 * whole two-phase flow joins on: `conditional-weld`'s durable log is keyed by it, and its `ports.ts` states
 * the claim the package exists to prove — *"the atrHash has to be recoverable from the authorization
 * artifact AND the capture artifact, joining on the rail's own key (`paymentInfoHash` on Base)."*
 *
 * ⚠️ **IT WAS DECODED AND THEN NOT READ.** `decodeEventLog` returns it — it is an indexed parameter — but
 * the `args` cast picked out `paymentInfo` and `amount` and nothing else, so it never reached
 * {@link DecodedEscrowLog}. A consumer that needed the key had no way to get it from the chain and could
 * only take the caller's word for it, which is not a join at all.
 *
 * ⭐ Surfaced HERE rather than on `LifecycleTransition`, because `binding-core` fixes that shape for
 * fifteen bindings and this is one rail's own key. `decodeEscrowLogs`' own docblock already names this as
 * the sanctioned route: *"the only way a consumer reaches the asset behind the weld… a caller checking
 * that a settlement moved the asset its record names calls this directly."*
 */
describe("decodeEscrowLogs surfaces the indexed paymentInfoHash", () => {
  const KEY = `0x${"cc".repeat(32)}` as const;

  it("⭐ carries it on a salt-BEARING event", () => {
    const [decoded] = decodeEscrowLogs(
      [authorizedLog(PI, SETTLEMENT.txHash as Hex, 0)],
      AUTH_CAPTURE_ESCROW,
    );
    expect(decoded?.paymentInfoHash).toBe(KEY);
    // The salt is still there — this adds a field, it does not move one.
    expect(decoded?.salt).toBe(saltFromAtrHash(ATR));
  });

  it("⛔⛔ carries it on a SALT-LESS event — the case the whole item turns on", () => {
    // `PaymentCaptured` has no cleartext `PaymentInfo`, so `recover` can never answer for it and the
    // capture leg cannot re-prove the atrHash by itself. Its indexed key is the ONLY thing tying it to the
    // authorization, and until now that key was unreachable.
    const [decoded] = decodeEscrowLogs(
      [capturedLog(SETTLEMENT.txHash as Hex, 1)],
      AUTH_CAPTURE_ESCROW,
    );
    expect(decoded?.name).toBe("PaymentCaptured");
    expect(decoded?.salt).toBeUndefined();
    expect(decoded?.paymentInfoHash).toBe(KEY);
  });

  it("⛔ the key is READ FROM THE TOPIC, not defaulted — a different payment decodes differently", () => {
    // ⭐ The assertion a constant would satisfy. If `paymentInfoHash` were hard-coded, or taken from the
    // caller, both logs would report the same key and a capture from ANOTHER payment would join to this
    // one's log. Vary the one input that is not shared and watch the output move with it.
    const other = `0x${"dd".repeat(32)}` as const;
    const topics = encodeEventTopics({
      abi: ESCROW_EVENTS_ABI,
      eventName: "PaymentCaptured",
      args: { paymentInfoHash: other },
    });
    const log = {
      ...(capturedLog(SETTLEMENT.txHash as Hex, 2) as unknown as Record<
        string,
        unknown
      >),
      topics,
    } as unknown as Log;
    const [decoded] = decodeEscrowLogs([log], AUTH_CAPTURE_ESCROW);
    expect(decoded?.paymentInfoHash).toBe(other);
    expect(decoded?.paymentInfoHash).not.toBe(KEY);
  });
});

describe("a recovery that SUCCEEDED says so, and one that refused says why", () => {
  /**
   * ⛔ `expect("refused" in out).toBe(false)` is not an assertion that the call succeeded. `Outcome` is a
   * union, and an object carrying `ok: false` alongside a value has no `refused` key either — so it passes
   * that check while telling a caller who narrows on `ok` that a recovery which found its atrHash failed.
   * At a verification boundary that is a weld reported as unrecoverable. The success flag is asserted here.
   */
  it("the logIndex-pinned success carries ok: true, not merely the absence of a refusal", async () => {
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
    expect(out).toEqual({ ok: true, value: ATR });
  });

  it("the unpinned single-payment success carries ok: true", async () => {
    const chain = fakeChain({
      txLogs: [authorizedLog(PI, SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect(out).toEqual({ ok: true, value: ATR });
  });

  /**
   * ⛔ The `detail` is the half a human reads. A refusal whose code is right and whose detail is empty tells
   * an operator that recovery failed and nothing about which settlement, which log index, or how many
   * payments were in play — and every one of these three details was free to delete without a test noticing.
   */
  it("no-recoverable-event names WHAT it looked for", async () => {
    const chain = fakeChain({
      txLogs: [capturedLog(SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect(out).toMatchObject({ code: "escrow/no-recoverable-event" });
    if ("refused" in out)
      expect(out.detail).toMatch(/PaymentAuthorized\/PaymentCharged/);
  });

  it("log-index-not-found names the index it was pinned to AND the settlement", async () => {
    const chain = fakeChain({
      txLogs: [authorizedLog(PI, SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(
      { ...SETTLEMENT, logIndex: 9 },
      portsWith(chain),
    );
    expect(out).toMatchObject({ code: "escrow/log-index-not-found" });
    if ("refused" in out) {
      expect(out.detail).toContain("9");
      expect(out.detail).toContain(SETTLEMENT.txHash);
    }
  });

  it("ambiguous-settlement names HOW MANY payments disagreed, which is what tells the caller to pin one", async () => {
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
    expect(out).toMatchObject({ code: "escrow/ambiguous-settlement" });
    if ("refused" in out) {
      expect(out.detail).toContain("2");
      expect(out.detail).toContain(SETTLEMENT.txHash);
      expect(out.detail).toMatch(/logIndex/);
    }
  });

  it("saltFromAtrHash names ITSELF when handed a malformed hash, so the throw is attributed", () => {
    expect(() => saltFromAtrHash("0xdead" as `0x${string}`)).toThrow(
      /saltFromAtrHash/,
    );
  });
});
