import type {
  ChainReader,
  Outcome,
  SettlementRef,
  VerifierPorts,
  WeldAdapter,
} from "@integraledger/lcp-binding-core";
import { AUTHORIZATION_USED_ABI } from "@integraledger/lcp-binding-evm-common";
import { encodeEventTopics, type Hex, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { createMppEvmAdapter } from "../src/adapter.js";
import { deriveChallengeHash } from "../src/id-reuse.js";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const OTHER_TOKEN = "0x1111111111111111111111111111111111111111" as const;
const AUTHORIZER = "0x2222222222222222222222222222222222222222" as const;
const CHAIN_ID = 84532;
const REALM = "api.example.com";
const ATR = `0x${"ab".repeat(32)}` as const;
const OTHER_ATR = `0x${"cd".repeat(32)}` as const;

/**
 * Adapters and nonces are built INSIDE an `it`, never at module scope. Work at module scope is invisible to
 * the mutation instrument and reads as the opposite of what happened: a mutant that made construction or the
 * derivation throw would break the file before any test ran, and be recorded as SURVIVED rather than killed.
 */
const makeAdapter = (realm: string = REALM) =>
  createMppEvmAdapter({ chainId: CHAIN_ID, asset: USDC, realm });
const nonceFor = (atr: string, realm: string = REALM): `0x${string}` =>
  deriveChallengeHash(atr, realm);

/** A synthetic `AuthorizationUsed(authorizer, indexed nonce)` log — the on-chain artifact of settlement. */
function authUsedLog(nonce: Hex, asset: string, logIndex: number | null): Log {
  return {
    address: asset,
    topics: encodeEventTopics({
      abi: AUTHORIZATION_USED_ABI,
      eventName: "AuthorizationUsed",
      args: { authorizer: AUTHORIZER, nonce },
    }),
    data: "0x",
    transactionHash: `0x${"11".repeat(32)}`,
    logIndex,
  } as unknown as Log;
}

/**
 * `keccak256("Transfer(address,address,uint256)")` — the ERC-20 `Transfer` topic0, written out HERE rather
 * than imported from the module under test, so it is an independent oracle: a mutant that edits the source's
 * copy is killed instead of matching a mutated expectation. Derived twice, agreeing byte-for-byte —
 * `cast keccak 'Transfer(address,address,uint256)'` and pycryptodome `keccak(digest_bits=256)`.
 */
const ERC20_TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * A plain ERC-20 `Transfer` and nothing else — what the token emits under MPP's `permit2` credential type
 * (draft-evm-charge-00 §5.2, the RECOMMENDED one), and under `transaction` (§5.4) and `hash` (§5.5). None of
 * those three emits `AuthorizationUsed`, because none of them calls `transferWithAuthorization`.
 */
function transferLog(asset: string, logIndex: number | null): Log {
  return {
    address: asset,
    topics: [
      ERC20_TRANSFER_TOPIC0,
      `0x000000000000000000000000${"33".repeat(20)}`,
      `0x000000000000000000000000${"44".repeat(20)}`,
    ],
    data: `0x${"00".repeat(31)}0a`,
    transactionHash: `0x${"11".repeat(32)}`,
    logIndex,
  } as unknown as Log;
}

/**
 * A log from the configured token that is NEITHER `AuthorizationUsed` NOR `Transfer`. `keccak256(
 * "Approval(address,address,uint256)")`, derived by the same two independent oracles as the topic above.
 * Every ERC-20 emits these constantly; the asset having emitted *something* is not the asset having moved.
 */
function approvalLog(asset: string, logIndex: number | null): Log {
  return {
    address: asset,
    topics: [
      "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
      `0x000000000000000000000000${"33".repeat(20)}`,
      `0x000000000000000000000000${"55".repeat(20)}`,
    ],
    data: `0x${"ff".repeat(32)}`,
    transactionHash: `0x${"11".repeat(32)}`,
    logIndex,
  } as unknown as Log;
}

/**
 * A log from the configured token with NO topics at all — what an anonymous Solidity event produces, and a
 * shape a verifier walking arbitrary transactions will meet. It must classify as "not a Transfer", never crash
 * the classifier.
 */
function untopicedLog(asset: string, logIndex: number | null): Log {
  return {
    address: asset,
    topics: [],
    data: `0x${"ab".repeat(32)}`,
    transactionHash: `0x${"11".repeat(32)}`,
    logIndex,
  } as unknown as Log;
}

/** A ChainReader serving one settlement's logs. Range queries throw: this binding never forward-indexes. */
function chainWith(txLogs: Log[], blockTime = 7n): ChainReader {
  return {
    getLogs: async () => {
      throw new Error(
        "getLogs must not be reached — forwardIndexable is false",
      );
    },
    getTransactionLogs: async () => txLogs,
    readContract: async () => {
      throw new Error("readContract is unused on this rail");
    },
    blockTime: async () => blockTime,
  };
}
/** The same reader with `blockTime` armed to throw — for asserting a path reads no block at all. */
function chainWithNoBlockTime(txLogs: Log[]): ChainReader {
  return {
    ...chainWith(txLogs),
    blockTime: async () => {
      throw new Error("blockTime must not be reached when nothing settled");
    },
  };
}
const portsWith = (chain: ChainReader): VerifierPorts => ({
  chain,
  artifacts: { resolve: async () => null },
});
/** Ports that throw on EVERY access — the honest way to prove a member reads no chain at all. */
const trapPorts = (): VerifierPorts =>
  portsWith({
    getLogs: async () => {
      throw new Error("trap: no chain access expected");
    },
    getTransactionLogs: async () => {
      throw new Error("trap: no chain access expected");
    },
    readContract: async () => {
      throw new Error("trap: no chain access expected");
    },
    blockTime: async () => {
      throw new Error("trap: no chain access expected");
    },
  });

const SETTLEMENT: SettlementRef = {
  chainId: CHAIN_ID,
  txHash: `0x${"11".repeat(32)}`,
};

/** Strip a refusal's prose `detail`, so the assertion pins the contract (`refused`/`haltClass`/`code`) and
 *  the whole discriminant — including `refused` itself, which a hardcoded `true` would hide. */
function normalize(outcome: Outcome<unknown>): unknown {
  return "refused" in outcome
    ? {
        refused: outcome.refused,
        haltClass: outcome.haltClass,
        code: outcome.code,
      }
    : outcome;
}
const refusal = (code: string) => ({
  refused: true,
  haltClass: "verification-failure",
  code,
});

describe("createMppEvmAdapter — construction", () => {
  it("carries the id-reuse manifest", () => {
    const adapter = makeAdapter();
    expect(adapter.manifest.rail).toBe("evm:mpp");
    expect(adapter.manifest.pattern).toBe("id-reuse");
  });

  it("constructs on a non-empty realm", () => {
    expect(() => makeAdapter()).not.toThrow();
  });

  it("REFUSES to construct without a realm — the realm is half the derivation preimage", () => {
    expect(() => makeAdapter("")).toThrow(/realm/);
  });

  it("exposes no enumerate — absence is the declaration, matching forwardIndexable: false", () => {
    expect("enumerate" in makeAdapter()).toBe(false);
  });
});

describe("propose — the seller sets challenge.id = atrHash", () => {
  it("returns the challenge id and the nonce it derives, over the configured realm", async () => {
    // The whole Outcome is pinned, `ok` included: asserting only `value` would leave the discriminant
    // uncertified, and a refusal-shaped answer would read green.
    expect(await makeAdapter().propose(ATR)).toEqual({
      ok: true,
      value: { challengeId: ATR, realm: REALM, nonce: nonceFor(ATR) },
    });
  });

  it("does not occupy the nonce — the nonce it reports is DERIVED from the id, never chosen", async () => {
    const out = await makeAdapter().propose(ATR);
    if ("refused" in out) throw new Error("unexpected refusal");
    expect(out.value.nonce).not.toBe(ATR);
    expect(out.value.nonce).toBe(nonceFor(ATR));
  });

  it("derives under the adapter's OWN realm — two sellers welding the same ATR sign different nonces", async () => {
    const mine = await makeAdapter().propose(ATR);
    const theirs = await makeAdapter("other.example").propose(ATR);
    if ("refused" in mine || "refused" in theirs)
      throw new Error("unexpected refusal");
    expect(mine.value.nonce).not.toBe(theirs.value.nonce);
    expect(theirs.value.nonce).toBe(nonceFor(ATR, "other.example"));
  });
});

describe("verifyCandidate — confirmation against one settlement", () => {
  it("confirms the candidate whose derived nonce is the one on chain", async () => {
    const ports = portsWith(chainWith([authUsedLog(nonceFor(ATR), USDC, 3)]));
    expect(await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports)).toEqual(
      {
        ok: true,
        value: {
          confirmed: true,
          atrHash: ATR,
          realm: REALM,
          nonce: nonceFor(ATR),
        },
      },
    );
  });

  it("refuses when the transaction emitted nothing at all — no event AND no transfer of the asset", async () => {
    const ports = portsWith(chainWith([]));
    const out = await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports);
    expect(normalize(out)).toEqual(refusal("mpp-evm/no-settlement-event"));
  });

  it("an EMPTY settlement reports nothing-settled even when the ref pins a logIndex — not a bad index", async () => {
    // The two findings differ to whoever reads the refusal: "this transaction settled nothing" and "your
    // index does not exist in it" are different claims, and only the first is true here.
    const ports = portsWith(chainWith([]));
    const out = await makeAdapter().verifyCandidate(
      ATR,
      { ...SETTLEMENT, logIndex: 0 },
      ports,
    );
    expect(normalize(out)).toEqual(refusal("mpp-evm/no-settlement-event"));
  });

  it("ignores another token's AuthorizationUsed — the configured asset is the only emitter that counts", async () => {
    const ports = portsWith(
      chainWith([authUsedLog(nonceFor(ATR), OTHER_TOKEN, 0)]),
    );
    const out = await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports);
    expect(normalize(out)).toEqual(refusal("mpp-evm/no-settlement-event"));
  });

  it("refuses a candidate whose derivation does not match the on-chain nonce", async () => {
    const ports = portsWith(chainWith([authUsedLog(nonceFor(ATR), USDC, 0)]));
    const out = await makeAdapter().verifyCandidate(
      OTHER_ATR,
      SETTLEMENT,
      ports,
    );
    expect(normalize(out)).toEqual(refusal("mpp-evm/candidate-mismatch"));
  });

  it("honours a logIndex-pinned ref, confirming against THAT event", async () => {
    const ports = portsWith(
      chainWith([
        authUsedLog(nonceFor(OTHER_ATR), USDC, 0),
        authUsedLog(nonceFor(ATR), USDC, 4),
      ]),
    );
    const out = await makeAdapter().verifyCandidate(
      ATR,
      { ...SETTLEMENT, logIndex: 4 },
      ports,
    );
    expect(out).toMatchObject({ ok: true });
  });

  it("a pinned logIndex matching NO event refuses — never a silent fall back to another event", async () => {
    // Falling back would confirm a candidate against a DIFFERENT settlement leg in the same transaction.
    const ports = portsWith(chainWith([authUsedLog(nonceFor(ATR), USDC, 4)]));
    const out = await makeAdapter().verifyCandidate(
      ATR,
      { ...SETTLEMENT, logIndex: 9 },
      ports,
    );
    expect(normalize(out)).toEqual(refusal("mpp-evm/log-index-not-found"));
  });

  it("a pinned logIndex on an event that does NOT match refuses as a mismatch, not a missing index", async () => {
    const ports = portsWith(
      chainWith([authUsedLog(nonceFor(OTHER_ATR), USDC, 2)]),
    );
    const out = await makeAdapter().verifyCandidate(
      ATR,
      { ...SETTLEMENT, logIndex: 2 },
      ports,
    );
    expect(normalize(out)).toEqual(refusal("mpp-evm/candidate-mismatch"));
  });

  it("confirms against a realm-matched nonce only — the same atrHash under another realm does not verify", async () => {
    const ports = portsWith(chainWith([authUsedLog(nonceFor(ATR), USDC, 0)]));
    const out = await makeAdapter("other.example").verifyCandidate(
      ATR,
      SETTLEMENT,
      ports,
    );
    expect(normalize(out)).toEqual(refusal("mpp-evm/candidate-mismatch"));
  });
});

/**
 * MPP's EVM method defines FOUR credential types and only ONE of them puts the challengeHash on-chain
 * (`authorization`, §5.3, and it is the token-conditional opt-in). `permit2` — §5.2, the RECOMMENDED one —
 * signs the same derived challengeHash inside the EIP-712 witness and puts it nowhere on-chain; `transaction`
 * (§5.4) and `hash` (§5.5) bind no challenge at all (§10.4). A settlement in any of those three moved the
 * asset and emitted no `AuthorizationUsed`, and the binding must say THAT, not "nothing settled".
 */
describe("a settlement whose credential type this binding cannot read", () => {
  it("verifyCandidate names the credential type instead of reporting an absence", async () => {
    const ports = portsWith(chainWith([transferLog(USDC, 3)]));
    const out = await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports);
    expect(normalize(out)).toEqual(
      refusal("mpp-evm/not-authorization-credential-type"),
    );
  });

  it("the refusal detail states what WAS observed, and never that nothing settled", async () => {
    // Pinned deliberately, unlike every other refusal in this file: this detail exists precisely because the
    // previous wording ("there is nothing to verify against") was the false claim.
    const ports = portsWith(chainWith([transferLog(USDC, 3)]));
    const out = await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports);
    if (!("refused" in out)) throw new Error("expected a refusal");
    expect(out.detail).toMatch(/transferred/);
    expect(out.detail).toMatch(/permit2/);
    expect(out.detail).toMatch(/§5\.3/);
    expect(out.detail).not.toMatch(/nothing/);
  });

  it("observe REFUSES rather than reporting no transitions, and reads no block to do it", async () => {
    // `{ ok: true, value: [] }` here would be a wrong answer about a transaction that really did settle.
    const ports = portsWith(chainWithNoBlockTime([transferLog(USDC, 3)]));
    const out = await makeAdapter().observe(SETTLEMENT, ports);
    expect(normalize(out)).toEqual(
      refusal("mpp-evm/not-authorization-credential-type"),
    );
  });

  it("a transfer of a DIFFERENT token is not this settlement — nothing-settled still stands", async () => {
    const ports = portsWith(chainWith([transferLog(OTHER_TOKEN, 0)]));
    expect(
      normalize(await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports)),
    ).toEqual(refusal("mpp-evm/no-settlement-event"));
    expect(await makeAdapter().observe(SETTLEMENT, ports)).toEqual({
      ok: true,
      value: [],
    });
  });

  it("an authorization-mode settlement emits a Transfer TOO, and still confirms", async () => {
    // EIP-3009's `transferWithAuthorization` emits both events. The credential-type check must not fire on
    // the presence of a Transfer — only on a Transfer with no AuthorizationUsed beside it.
    const ports = portsWith(
      chainWith([transferLog(USDC, 2), authUsedLog(nonceFor(ATR), USDC, 3)]),
    );
    expect(await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports)).toEqual(
      {
        ok: true,
        value: {
          confirmed: true,
          atrHash: ATR,
          realm: REALM,
          nonce: nonceFor(ATR),
        },
      },
    );
    const observed = await makeAdapter().observe(SETTLEMENT, ports);
    if ("refused" in observed) throw new Error("unexpected refusal");
    expect(observed.value).toHaveLength(1);
  });

  it("the asset merely EMITTING something is not the asset moving — an Approval is nothing-settled", async () => {
    // The classifier reads topic-0 identity, not the emitter. A token emits `Approval` on every allowance
    // change, including the one Permit2 requires; treating any log from the asset as a transfer would report
    // an unrelated approval as an unreadable settlement.
    const ports = portsWith(chainWith([approvalLog(USDC, 1)]));
    expect(
      normalize(await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports)),
    ).toEqual(refusal("mpp-evm/no-settlement-event"));
    expect(await makeAdapter().observe(SETTLEMENT, ports)).toEqual({
      ok: true,
      value: [],
    });
  });

  it("a topic-less log from the asset classifies, it does not crash the verifier", async () => {
    // Anonymous Solidity events produce logs with an empty `topics` array, and a verifier walking arbitrary
    // transactions will meet them. Indexing topic 0 unguarded would throw here instead of answering.
    const ports = portsWith(chainWith([untopicedLog(USDC, 0)]));
    expect(
      normalize(await makeAdapter().verifyCandidate(ATR, SETTLEMENT, ports)),
    ).toEqual(refusal("mpp-evm/no-settlement-event"));
    expect(await makeAdapter().observe(SETTLEMENT, ports)).toEqual({
      ok: true,
      value: [],
    });
  });

  it("a logIndex-pinned ref on such a settlement gets the credential-type answer, not a bad index", async () => {
    // The pinned index exists in the transaction; what is absent is the event class this binding reads.
    const ports = portsWith(chainWith([transferLog(USDC, 3)]));
    const out = await makeAdapter().verifyCandidate(
      ATR,
      { ...SETTLEMENT, logIndex: 3 },
      ports,
    );
    expect(normalize(out)).toEqual(
      refusal("mpp-evm/not-authorization-credential-type"),
    );
  });
});

describe("observe — the only on-chain state this rail exposes", () => {
  it("maps each AuthorizationUsed to a settled transition at the block's time", async () => {
    const ports = portsWith(
      chainWith([authUsedLog(nonceFor(ATR), USDC, 5)], 42n),
    );
    expect(await makeAdapter().observe(SETTLEMENT, ports)).toEqual({
      ok: true,
      value: [
        {
          state: "settled",
          at: 42n,
          ref: { chainId: CHAIN_ID, txHash: SETTLEMENT.txHash, logIndex: 5 },
        },
      ],
    });
  });

  it("reports NO transitions for a transaction that settled nothing, and reads no block to say so", async () => {
    // The block read is skipped, not merely unused: asking a node for a block time in order to report an
    // empty list is a wasted round trip on every non-settling transaction a verifier walks past.
    const ports = portsWith(chainWithNoBlockTime([]));
    expect(await makeAdapter().observe(SETTLEMENT, ports)).toEqual({
      ok: true,
      value: [],
    });
  });

  it("omits txHash from the emitted ref when the settlement ref carried none — never a key set to undefined", async () => {
    const ports = portsWith(chainWith([authUsedLog(nonceFor(ATR), USDC, 1)]));
    const out = await makeAdapter().observe({ chainId: CHAIN_ID }, ports);
    if ("refused" in out) throw new Error("unexpected refusal");
    expect(Object.keys(out.value[0]?.ref ?? {})).toEqual([
      "chainId",
      "logIndex",
    ]);
  });

  it("omits logIndex when the source log carried none — a null index is not an index", async () => {
    const ports = portsWith(
      chainWith([authUsedLog(nonceFor(ATR), USDC, null)]),
    );
    const out = await makeAdapter().observe(SETTLEMENT, ports);
    if ("refused" in out) throw new Error("unexpected refusal");
    expect(Object.keys(out.value[0]?.ref ?? {})).toEqual(["chainId", "txHash"]);
  });

  it("declares only states the manifest names", async () => {
    const adapter = makeAdapter();
    const ports = portsWith(chainWith([authUsedLog(nonceFor(ATR), USDC, 0)]));
    const out = await adapter.observe(SETTLEMENT, ports);
    if ("refused" in out) throw new Error("unexpected refusal");
    expect(out.value).toHaveLength(1);
    for (const t of out.value)
      expect(adapter.manifest.lifecycleStates).toContain(t.state);
  });
});

describe("recover — refuses BY CONSTRUCTION", () => {
  it("returns the not-recoverable refusal", async () => {
    expect(normalize(await makeAdapter().recover())).toEqual(
      refusal("mpp-evm/not-recoverable-by-construction"),
    );
  });

  it("a generic WeldAdapter consumer gets that refusal, and no chain read happens on the way", async () => {
    // The trap ports throw on every access, so reaching the chain would fail this test rather than pass it
    // quietly. This is the code half of `zeroPartyRecoverable: false`: there is no stored-challenge lookup
    // to re-derive from, which would be service-record recovery wearing the name of zero-party recovery.
    const generic: WeldAdapter = makeAdapter();
    expect(normalize(await generic.recover(SETTLEMENT, trapPorts()))).toEqual(
      refusal("mpp-evm/not-recoverable-by-construction"),
    );
  });

  it("the generic port sees no enumerate either", () => {
    const generic: WeldAdapter = makeAdapter();
    expect(generic.enumerate).toBeUndefined();
  });
});
