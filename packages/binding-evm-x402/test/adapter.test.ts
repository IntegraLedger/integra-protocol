import type {
  ChainReader,
  SettlementRef,
  VerifierPorts,
} from "@integraledger/lcp-binding-core";
import {
  AUTHORIZATION_USED_ABI,
  ERC20_TRANSFER_TOPIC0,
} from "@integraledger/lcp-binding-evm-common";
import { encodeEventTopics, type Hex, hashTypedData, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { createX402Adapter, type X402Proposal } from "../src/adapter.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const OTHER_TOKEN = "0x1111111111111111111111111111111111111111" as const;
const AUTHORIZER = "0x2222222222222222222222222222222222222222" as const;
const ATR = `0x${"ab".repeat(32)}` as const;
const CHAIN_ID = 84532;

const adapter = createX402Adapter({
  chainId: CHAIN_ID,
  asset: USDC,
  tokenName: "USDC",
  tokenVersion: "2",
});

/** A synthetic `AuthorizationUsed(authorizer, indexed nonce)` log. */
function authUsedLog(
  nonce: Hex,
  asset: string,
  txHash: Hex,
  logIndex: number,
): Log {
  const topics = encodeEventTopics({
    abi: AUTHORIZATION_USED_ABI,
    eventName: "AuthorizationUsed",
    args: { authorizer: AUTHORIZER, nonce },
  });
  return {
    address: asset,
    topics,
    data: "0x",
    transactionHash: txHash,
    logIndex,
  } as unknown as Log;
}

/** A synthetic ERC-20 `Transfer` log — topic-0 identity is all `assetWasTransferred` reads. */
function erc20TransferLog(asset: string, txHash: Hex, logIndex: number): Log {
  return {
    address: asset,
    topics: [ERC20_TRANSFER_TOPIC0],
    data: "0x",
    transactionHash: txHash,
    logIndex,
  } as unknown as Log;
}

/** A ChainReader that serves fixed logs — one set for the settlement tx, one for range queries. */
function fakeChain(opts: {
  txLogs?: Log[];
  queryLogs?: Log[];
  blockTime?: bigint;
}): ChainReader {
  return {
    getLogs: async () => opts.queryLogs ?? [],
    getTransactionLogs: async () => opts.txLogs ?? [],
    readContract: async () => {
      throw new Error("unused in these tests");
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

describe("createX402Adapter — manifest", () => {
  it("carries the x402 native-field manifest", () => {
    expect(adapter.manifest.rail).toBe("evm:x402");
    expect(adapter.manifest.pattern).toBe("native-field");
  });
});

describe("propose", () => {
  const ctx = {
    from: "0x3333333333333333333333333333333333333333",
    payTo: "0x4444444444444444444444444444444444444444",
    amount: "1000",
    validAfter: "0",
    validBefore: "4102444800",
  };

  it("builds an EIP-3009 authorization whose nonce IS the atrHash, over the configured domain", async () => {
    const out = await adapter.propose(ATR, ctx);
    expect("refused" in out).toBe(false);
    if ("refused" in out) return;
    // WeldAdapter.propose is typed Outcome<unknown> (rail-agnostic); the x402 caller knows the shape.
    const proposal = out.value as X402Proposal;
    expect(proposal.authorization.nonce).toBe(ATR);
    expect(proposal.authorization.from).toBe(ctx.from);
    expect(proposal.authorization.to).toBe(ctx.payTo);
    expect(proposal.typedData.domain.chainId).toBe(CHAIN_ID);
    expect(proposal.typedData.domain.verifyingContract).toBe(USDC);
    // The typed-data digest is stable (what the payer signs over).
    expect(hashTypedData(proposal.typedData)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("refuses a permit2 offer (policy-rejection) instead of settling unwelded", async () => {
    const out = await adapter.propose(ATR, {
      ...ctx,
      assetTransferMethod: "permit2",
    });
    expect("refused" in out).toBe(true);
    if ("refused" in out)
      expect(out.code).toBe("x402/asset-transfer-method-unsupported");
  });

  it("fails fast on a malformed atrHash (a programming error, not a policy refusal)", async () => {
    await expect(
      adapter.propose("0xdead" as `0x${string}`, ctx),
    ).rejects.toThrow(/32-byte/);
  });
});

describe("recover", () => {
  it("reads the committed nonce (= atrHash) back out of the settlement's AuthorizationUsed log", async () => {
    const chain = fakeChain({
      txLogs: [authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR);
  });

  it("ignores an AuthorizationUsed from a different token", async () => {
    const chain = fakeChain({
      txLogs: [authUsedLog(ATR, OTHER_TOKEN, SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(true);
    if ("refused" in out) expect(out.code).toBe("x402/no-settlement-event");
  });

  it("REFUSES two different nonces with no logIndex pinned — it must not choose a settlement for the caller", async () => {
    // This is the case the function's own comment named as a fail-fast violation ("could recover a
    // DIFFERENT settlement's atrHash") while the unpinned branch went on committing it. Two welds in one
    // transaction is a real shape; answering either one is a coin flip presented as a recovery.
    const other = `0x${"cd".repeat(32)}` as Hex;
    const chain = fakeChain({
      txLogs: [
        authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 0),
        authUsedLog(other, USDC, SETTLEMENT.txHash as Hex, 1),
      ],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(true);
    if ("refused" in out) {
      expect(out.code).toBe("x402/ambiguous-settlement");
      expect(out.haltClass).toBe("verification-failure");
    }
  });

  it("does NOT refuse repeats of the SAME nonce — one weld observed twice is not an ambiguity", async () => {
    // Distinctness is the test, not count. Refusing on count alone would break a legitimate settlement
    // that emits the same authorization more than once.
    const chain = fakeChain({
      txLogs: [
        authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 0),
        authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 1),
      ],
    });
    const out = await adapter.recover(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR);
  });

  it("disambiguates by logIndex when the ref pins one", async () => {
    const other = `0x${"cd".repeat(32)}` as Hex;
    const chain = fakeChain({
      txLogs: [
        authUsedLog(other, USDC, SETTLEMENT.txHash as Hex, 0),
        authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 1),
      ],
    });
    const out = await adapter.recover(
      { ...SETTLEMENT, logIndex: 1 },
      portsWith(chain),
    );
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR);
  });

  it("refuses (never falls back) when a pinned logIndex matches no event", async () => {
    const chain = fakeChain({
      txLogs: [authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 0)],
    });
    const out = await adapter.recover(
      { ...SETTLEMENT, logIndex: 7 }, // no event at index 7
      portsWith(chain),
    );
    expect("refused" in out).toBe(true);
    if ("refused" in out) expect(out.code).toBe("x402/log-index-not-found");
  });
});

describe("observe", () => {
  it("maps the settlement event to a welded-settled transition at block time", async () => {
    const chain = fakeChain({
      txLogs: [authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 3)],
      blockTime: 1_700_000_000n,
    });
    const out = await adapter.observe(SETTLEMENT, portsWith(chain));
    expect("refused" in out).toBe(false);
    if ("refused" in out) return;
    expect(out.value).toHaveLength(1);
    expect(out.value[0]?.state).toBe("welded-settled");
    expect(out.value[0]?.at).toBe(1_700_000_000n);
    expect(out.value[0]?.ref.logIndex).toBe(3);
  });

  it("returns no transitions when the tx carries no settlement event", async () => {
    const out = await adapter.observe(SETTLEMENT, portsWith(fakeChain({})));
    expect(out).toEqual({ ok: true, value: [] });
  });

  it("REFUSES when the token moved but no AuthorizationUsed accompanied it — an empty list would assert the opposite", async () => {
    // The Permit2 fallback settles through `x402ExactPermit2Proxy`, which exposes no payer-controlled
    // nonce: an ERC-20 Transfer fires and AuthorizationUsed does not. `[]` would report that this
    // transaction settled nothing of this asset, which is false — it settled, unwelded. The propose side
    // already refuses this path (`filterAssetTransferMethod`); the observe side used to contradict it.
    const chain = fakeChain({
      txLogs: [erc20TransferLog(USDC, SETTLEMENT.txHash as Hex, 1)],
    });
    const out = await adapter.observe(SETTLEMENT, portsWith(chain));
    expect(out).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "x402/not-eip3009-settlement",
      detail: expect.stringContaining("no EIP-3009 AuthorizationUsed"),
    });
  });

  it("still reports an empty list when a DIFFERENT token moved — the refusal is scoped to the configured asset", async () => {
    // Scoping matters both ways: a foreign token's Transfer must not grief a settlement that genuinely
    // carries none of this asset into a refusal.
    const chain = fakeChain({
      txLogs: [
        erc20TransferLog(`0x${"cc".repeat(20)}`, SETTLEMENT.txHash as Hex, 1),
      ],
    });
    expect(await adapter.observe(SETTLEMENT, portsWith(chain))).toEqual({
      ok: true,
      value: [],
    });
  });

  it("does not ask the chain for a block time when there is no settlement to time", async () => {
    // The empty-events early return produces the same `[]` either way, so only the RPC call it avoids
    // distinguishes it. That matters against the live reader, which fail-fasts rather than inventing a
    // timestamp: without the early return, observing a tx that never settled throws instead of
    // answering the honest empty list.
    let blockTimeCalls = 0;
    const chain: ChainReader = {
      ...fakeChain({}),
      blockTime: async () => {
        blockTimeCalls++;
        throw new Error("blockTime: no settlement in this transaction");
      },
    };
    const out = await adapter.observe(SETTLEMENT, portsWith(chain));
    expect(out).toEqual({ ok: true, value: [] });
    expect(blockTimeCalls).toBe(0);
  });

  it("omits txHash and logIndex from a transition ref rather than setting them undefined", async () => {
    // A log the node has not yet mined carries `transactionHash: null` / `logIndex: null`. The ref must
    // leave those keys ABSENT rather than present-and-undefined: `SettlementRef` declares them optional
    // under `exactOptionalPropertyTypes`, where the two are distinct types. (`makeChainReader` guards on
    // the VALUE — `ref.txHash === undefined` — so it fails the same way either way; what breaks on the
    // present-and-undefined form is the type contract, and any consumer keying off `in`/`hasOwn`.)
    const pending = {
      ...authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 0),
      transactionHash: null,
      logIndex: null,
    } as unknown as Log;
    const out = await adapter.observe(
      { chainId: CHAIN_ID },
      portsWith(fakeChain({ txLogs: [pending], blockTime: 1n })),
    );
    if ("refused" in out) throw new Error("expected transitions");
    expect(out.value[0]?.ref).toStrictEqual({ chainId: CHAIN_ID });
  });
});

describe("enumerate", () => {
  it("forward-indexes settlements by the AuthorizationUsed nonce topic", async () => {
    const t1 = `0x${"aa".repeat(32)}` as Hex;
    const t2 = `0x${"bb".repeat(32)}` as Hex;
    const chain = fakeChain({
      queryLogs: [authUsedLog(ATR, USDC, t1, 0), authUsedLog(ATR, USDC, t2, 5)],
    });
    const refs = await adapter.enumerate?.(ATR, portsWith(chain));
    expect(refs).toHaveLength(2);
    expect(refs?.[0]).toEqual({ chainId: CHAIN_ID, txHash: t1, logIndex: 0 });
    expect(refs?.[1]).toEqual({ chainId: CHAIN_ID, txHash: t2, logIndex: 5 });
  });

  it("omits txHash for a log that has none rather than carrying it as undefined", async () => {
    const pending = {
      ...authUsedLog(ATR, USDC, `0x${"aa".repeat(32)}`, 0),
      transactionHash: null,
    } as unknown as Log;
    const refs = await adapter.enumerate?.(
      ATR,
      portsWith(fakeChain({ queryLogs: [pending] })),
    );
    expect(refs?.[0]).toStrictEqual({ chainId: CHAIN_ID, logIndex: 0 });
  });
});

/**
 * `"refused" in out` is true even when the flag underneath is false, and `haltClass` was never asserted
 * on the recover refusals — so both discriminants could be blanked without a test noticing. The `code`
 * is the contract and was already pinned; these add the two fields beside it. The `detail` prose is
 * deliberately NOT pinned.
 */
describe("Outcome discriminants", () => {
  it("propose carries ok:true around the proposal", async () => {
    const out = await adapter.propose(ATR, {
      from: "0x3333333333333333333333333333333333333333",
      payTo: "0x4444444444444444444444444444444444444444",
      amount: 1_000_000n,
      validAfter: 0n,
      validBefore: 2n ** 48n,
    });
    if ("refused" in out) throw new Error("expected a proposal");
    expect(out.ok).toBe(true);
    const value = out.value as X402Proposal;
    expect(value.authorization.nonce).toBe(ATR);
  });

  it("recover carries ok:true around the recovered nonce", async () => {
    const chain = fakeChain({
      txLogs: [authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 0)],
    });
    expect(await adapter.recover(SETTLEMENT, portsWith(chain))).toEqual({
      ok: true,
      value: ATR,
    });
  });

  it("recover carries ok:true on the logIndex-disambiguated branch too", async () => {
    // A separate return from the unpinned-ref one above, and separately unpinned.
    const chain = fakeChain({
      txLogs: [
        authUsedLog(`0x${"cd".repeat(32)}`, USDC, SETTLEMENT.txHash as Hex, 1),
        authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 4),
      ],
    });
    expect(
      await adapter.recover({ ...SETTLEMENT, logIndex: 4 }, portsWith(chain)),
    ).toEqual({ ok: true, value: ATR });
  });

  it("recover's no-event refusal carries refused:true and the verification-failure class", async () => {
    const out = await adapter.recover(SETTLEMENT, portsWith(fakeChain({})));
    if (!("refused" in out)) throw new Error("expected a refusal");
    expect(out.refused).toBe(true);
    expect(out.haltClass).toBe("verification-failure");
    expect(out.code).toBe("x402/no-settlement-event");
    expect(out.detail).toContain("no AuthorizationUsed for asset");
  });

  it("recover's pinned-logIndex refusal carries refused:true and the verification-failure class", async () => {
    const chain = fakeChain({
      txLogs: [authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 2)],
    });
    const out = await adapter.recover(
      { ...SETTLEMENT, logIndex: 9 },
      portsWith(chain),
    );
    if (!("refused" in out)) throw new Error("expected a refusal");
    expect(out.refused).toBe(true);
    expect(out.haltClass).toBe("verification-failure");
    expect(out.code).toBe("x402/log-index-not-found");
    expect(out.detail).toContain("no AuthorizationUsed at logIndex 9");
  });

  it("observe carries ok:true around the transitions", async () => {
    const chain = fakeChain({
      txLogs: [authUsedLog(ATR, USDC, SETTLEMENT.txHash as Hex, 3)],
      blockTime: 1_700_000_000n,
    });
    const out = await adapter.observe(SETTLEMENT, portsWith(chain));
    if ("refused" in out) throw new Error("expected transitions");
    expect(out.ok).toBe(true);
  });
});
