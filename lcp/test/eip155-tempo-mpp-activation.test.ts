// mpp/subscription/tempo's read of an activation by its key slot and its search (profile mpp-session-evm-tempo.md
// rule 7), on the live Moderato activation, row "L2" of vectors/mpp-subscription-tempo.json (read from
// https://rpc.moderato.tempo.xyz on 2026-09-25): the account whose root key signed the key authorization it carries is
// the witness log's account, and the read settles on it only where that account is the reference's payer and the key
// authorization's one recipient the option's payee; every answer naming the activation names that recipient
// (`named`), the vector's `transferTo`. The keychain's state is constructed from the ledger's own
// transactions (test/eip155-tempo-mpp-tempo-ledger.ts), whose log search returns no reverted receipt's logs.
import { readFileSync } from "node:fs";
import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import type { Hex } from "../src/evm-abi.js";
import { ReaderError, type EvmLog } from "../src/evm.js";
import { readKeyAuthorization } from "../src/internal/key-authorization.js";
import { KEY_AUTHORIZATION_WITNESS_BURNED_TOPIC } from "../src/internal/tempo-key-slot.js";
import { carriedKeyAuthorization, keyAuthorizationSigner } from "../src/internal/tempo-envelope.js";
import { subscriptionTempo, type SessionRef } from "../src/mpp.js";
import { ACCOUNT_KEYCHAIN, KEY_AUTHORIZATION_WITNESS_TOPIC } from "../src/tempo.js";
import { tempoLedgerReader, type TempoLedgerSpec } from "./eip155-tempo-mpp-tempo-ledger.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-subscription-tempo.json", import.meta.url), "utf8"));
const LIVE = V["L2"] as { raw: Hex; receipt: { status: 0 | 1; blockNumber: string; logs: EvmLog[] }; transferTo: Hex; transferToken: Hex; expectSettled: { transaction: Hex } };
const TX = LIVE.expectSettled.transaction;
const BLOCK = BigInt(LIVE.receipt.blockNumber);
const bytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h.slice(2), "hex"));
const carried = carriedKeyAuthorization(bytes(LIVE.raw)) as Hex;
const witness = LIVE.receipt.logs[0]!;
const account = `0x${witness.topics[1]!.slice(26)}` as Hex;
const key = readKeyAuthorization(carried) as { keyId: Hex };
const OTHER = "0x4444444444444444444444444444444444444444" as Hex;
const HEADS = { latest: BLOCK + 10n, safe: BLOCK + 5n, finalized: BLOCK + 5n };
const timestamp = (b: bigint): bigint => 1_800_000_000n + b;

const ledger = (over: Partial<TempoLedgerSpec> = {}) =>
  tempoLedgerReader({
    network: "eip155:42431",
    heads: HEADS,
    timestamp,
    txs: [{ hash: TX, block: BLOCK, status: 1, from: account, to: null, input: "0x", logs: LIVE.receipt.logs, raw: LIVE.raw }],
    ...over,
  });
const ref = (over: Partial<SessionRef> = {}): SessionRef => ({
  network: "eip155:42431",
  payee: LIVE.transferTo,
  bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: witness.topics[2]! as never },
  accessKey: { keyId: key.keyId.toLowerCase() as Hex, token: LIVE.transferToken, to: `0x${"00".repeat(32)}` },
  payer: account,
  signed: keccak256(carried),
  ...over,
});
const query = { act: "payment", finality: "finalized", after: BLOCK - 100n } as const;
const MOVED = [{ asset: LIVE.transferToken, to: LIVE.transferTo, amount: "1000000", transaction: TX, place: 3 }];

describe("the activation read on the live Moderato activation", () => {
  it("recovers the witness log's account as the root key's signer, and settles with what moved from it", async () => {
    expect(witness.topics[0]).toBe(KEY_AUTHORIZATION_WITNESS_TOPIC);
    expect(keyAuthorizationSigner(bytes(carried))).toBe(account);
    expect(await subscriptionTempo.status(ref() as never, ledger() as never, query)).toEqual({
      state: "settled",
      transaction: TX,
      position: BLOCK,
      finality: "finalized",
      presented: "yes",
      signer: account,
      moved: MOVED,
      named: LIVE.transferTo,
      foreign: [],
    });
    expect(await subscriptionTempo.status(ref({ signed: `0x${"11".repeat(32)}` }) as never, ledger() as never, query)).toMatchObject({ state: "settled", presented: "no" });
  });

  it("names the payer's activation for another recipient the consumer of the key's slot, carrying H", async () => {
    expect(await subscriptionTempo.status(ref({ payee: OTHER }) as never, ledger() as never, query)).toEqual({
      state: "failed",
      reason: "instrument-consumed",
      transaction: TX,
      position: BLOCK,
      finality: "finalized",
      signer: account,
      moved: MOVED,
      named: LIVE.transferTo,
      carries: "other-account",
      foreign: [],
    });
  });

  it("names it a foreign item where the payer or the key is another, whose slot reads unconsumed: instrument-live", async () => {
    for (const [over, reason] of [
      [{ payer: OTHER }, "other-signer"],
      [{ accessKey: { keyId: OTHER, token: LIVE.transferToken, to: `0x${"00".repeat(32)}` as Hex } }, "other-kind"],
    ] as const) {
      expect(await subscriptionTempo.status(ref(over) as never, ledger() as never, query), reason).toEqual({
        state: "pending",
        reason: "instrument-live",
        foreign: [{ transaction: TX, position: BLOCK, signer: account, moved: MOVED, named: LIVE.transferTo, reason }],
      });
    }
  });
});

describe("the activation read by the key slot", () => {
  it("finds a reverted activation the log search does not list by its slot, and answers transaction-failed", async () => {
    const reader = ledger({ txs: [{ hash: TX, block: BLOCK, status: 0, from: account, to: null, input: "0x", logs: LIVE.receipt.logs, raw: LIVE.raw }] });
    expect(await reader.logs({ address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC], fromBlock: 0n, toBlock: HEADS.latest })).toEqual([]);
    expect(await subscriptionTempo.status(ref() as never, reader as never, query)).toEqual({
      state: "failed",
      reason: "transaction-failed",
      transaction: TX,
      position: BLOCK,
      finality: "finalized",
      signer: account,
      moved: MOVED,
      named: LIVE.transferTo,
      foreign: [],
    });
  });

  it("answers before-position where the slot reads consumed at the position given, naming the transaction below it", async () => {
    expect(await subscriptionTempo.status(ref() as never, ledger() as never, { ...query, after: BLOCK + 2n })).toEqual({
      state: "failed",
      reason: "before-position",
      transaction: TX,
      position: BLOCK,
      finality: "finalized",
      signer: account,
      moved: MOVED,
      named: LIVE.transferTo,
      foreign: [],
    });
  });

  it("answers the reason of a read that fails while finding the slot's consumer below the position given", async () => {
    const after = BLOCK + 2n;
    const failing = (error: ReaderError) => {
      const base = ledger();
      return {
        ...base,
        call: async (to: Hex, data: Hex, block: bigint) => {
          if (block < after) throw error;
          return base.call(to, data, block);
        },
      };
    };
    // The slot's state below the position given pruned, the slot's read refused, and the first block's transactions the
    // endpoint does not list.
    const readers = [failing(new ReaderError("history", "state pruned")), failing(new ReaderError("transport", "connection reset")), ledger({ unlisted: [BLOCK] })];
    const answers = [];
    for (const reader of readers) answers.push(await subscriptionTempo.status(ref() as never, reader as never, { ...query, after }));
    expect(answers).toEqual(["history-gap", "transport", "transport"].map((reason) => ({ state: "unreadable", reason, foreign: [] })));
  });

  it("answers instrument-live while the slot is unconsumed, and instrument-unused once its signed expiry has passed", async () => {
    const empty = ledger({ txs: [] });
    expect(await subscriptionTempo.status(ref() as never, empty as never, query)).toEqual({ state: "pending", reason: "instrument-live", foreign: [] });
    const lapsed = { ...ref().accessKey!, expiry: (timestamp(HEADS.finalized) - 1n).toString() };
    expect(await subscriptionTempo.status(ref({ accessKey: lapsed }) as never, empty as never, query)).toEqual({
      state: "failed",
      reason: "instrument-unused",
      finality: "finalized",
      foreign: [],
    });
    // Passed at the latest head alone: the read waits for the final mark.
    const above = { ...ref().accessKey!, expiry: (timestamp(HEADS.latest) - 1n).toString() };
    expect(await subscriptionTempo.status(ref({ accessKey: above }) as never, empty as never, query)).toEqual({ state: "pending", reason: "below-mark", foreign: [] });
  });

  it("answers search-incomplete where the slot reads consumed and no transaction of its block registers it", async () => {
    const reader = ledger({ txs: [], keys: [{ account, keyId: key.keyId, from: BLOCK }] });
    expect(await subscriptionTempo.status(ref() as never, reader as never, query)).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });

  it("reads a revoked slot as consumed", async () => {
    const reader = ledger({ txs: [], keys: [{ account, keyId: key.keyId, from: BLOCK, revoked: BLOCK + 1n }] });
    const lapsed = { ...ref().accessKey!, expiry: (timestamp(HEADS.finalized) - 1n).toString() };
    expect(await subscriptionTempo.status(ref({ accessKey: lapsed }) as never, reader as never, query)).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });

  it("holds the search at a transaction of the consuming block whose signed bytes the node does not return", async () => {
    const reader = ledger({ txs: [{ hash: TX, block: BLOCK, status: 0, from: account, to: null, input: "0x", logs: LIVE.receipt.logs }], keys: [{ account, keyId: key.keyId, from: BLOCK }] });
    expect(await subscriptionTempo.status(ref() as never, reader as never, query)).toEqual({
      state: "pending",
      reason: "search-incomplete",
      search: query.after,
      undecoded: [TX.toLowerCase()],
      foreign: [],
    });
  });

  it("refuses a reader without the state reads, and a reference whose expiry is not a Unix second", async () => {
    const { storageAt: _s, nonceAt: _n, blockTransactions: _b, ...plain } = ledger();
    expect(await subscriptionTempo.status(ref() as never, plain as never, query)).toEqual({ state: "unreadable", reason: "transport", foreign: [] });
    for (const expiry of ["0", "01", "-1", "18446744073709551616", 5]) {
      const bad = { ...ref().accessKey!, expiry } as never;
      expect(await subscriptionTempo.status(ref({ accessKey: bad }) as never, ledger() as never, query), String(expiry)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
    }
  });
});

describe("the activation read by the witness's burn mark", () => {
  // The payer's `burnKeyAuthorizationWitness(H)` (tempoxyz/tempo@c8b89f9b `crates/precompiles/src/account_keychain/mod.rs:457-465`),
  // with its `KeyAuthorizationWitnessBurned(account, H)` log, in a block of its own; no activation lands.
  const BURN = `0x${"b0".repeat(32)}` as Hex;
  const burnTx = (block: bigint) => ({
    hash: BURN,
    block,
    status: 1 as const,
    from: account,
    to: ACCOUNT_KEYCHAIN,
    input: "0x" as Hex,
    logs: [{ address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_BURNED_TOPIC, witness.topics[1]!, witness.topics[2]!], data: "0x" as Hex }],
  });

  it("answers instrument-consumed where the payer burned H, naming the burn, of another kind, carrying H", async () => {
    expect(await subscriptionTempo.status(ref() as never, ledger({ txs: [burnTx(BLOCK + 1n)] }) as never, query)).toEqual({
      state: "failed",
      reason: "instrument-consumed",
      transaction: BURN,
      position: BLOCK + 1n,
      finality: "finalized",
      signer: account,
      moved: [],
      carries: "other-kind",
      foreign: [],
    });
  });

  it("answers before-position where the burn lies at or before the position given", async () => {
    expect(await subscriptionTempo.status(ref() as never, ledger({ txs: [burnTx(BLOCK + 1n)] }) as never, { ...query, after: BLOCK + 2n })).toEqual({
      state: "failed",
      reason: "before-position",
      transaction: BURN,
      position: BLOCK + 1n,
      finality: "finalized",
      signer: account,
      moved: [],
      foreign: [],
    });
  });

  it("answers search-incomplete where the mark reads burned and its block holds no burn log", async () => {
    const reader = ledger({ txs: [], burns: [{ account, witness: witness.topics[2]!, from: BLOCK }] });
    expect(await subscriptionTempo.status(ref() as never, reader as never, query)).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });

  it("answers history-gap where the endpoint does not hold the state the burn's first block needs", async () => {
    const base = ledger({ txs: [], burns: [{ account, witness: witness.topics[2]!, from: query.after - 50n }] });
    const reader = {
      ...base,
      call: async (to: Hex, data: Hex, block: bigint) => {
        if (block < query.after) throw new ReaderError("history", "state pruned");
        return base.call(to, data, block);
      },
    };
    expect(await subscriptionTempo.status(ref() as never, reader as never, query)).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });
});

describe("the witness burn's vector row (vectors/mpp-subscription-tempo.json, BURN)", () => {
  const F = V["fixed"] as { payer: Hex; H: Hex; accessKey: Hex };
  const B = V["BURN"] as { expectCall: Hex; expectBurnedTopics: Hex[]; burnedAnswer: Hex; expectStatus: object };

  it("asks the keychain for the burn mark and finds the burn by its log, answering as the row states", async () => {
    const asked: Hex[] = [];
    const hash = `0x${"b1".repeat(32)}` as Hex;
    const base = ledger({ txs: [{ hash, block: BLOCK + 1n, status: 1, from: F.payer, to: ACCOUNT_KEYCHAIN, input: "0x", logs: [{ address: ACCOUNT_KEYCHAIN, topics: B.expectBurnedTopics, data: "0x" }] }] });
    const reader = {
      ...base,
      call: async (to: Hex, data: Hex, block: bigint) => {
        asked.push(data);
        const answer = await base.call(to, data, block);
        if (data === B.expectCall && block >= BLOCK + 1n) expect(answer).toBe(B.burnedAnswer);
        return answer;
      },
    };
    const r = ref({
      payer: F.payer,
      bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: F.H as never },
      accessKey: { keyId: F.accessKey.toLowerCase() as Hex, token: LIVE.transferToken, to: `0x${"00".repeat(32)}` },
    });
    const answer = await subscriptionTempo.status(r as never, reader as never, query);
    expect(asked).toContain(B.expectCall);
    expect(answer).toMatchObject({ ...B.expectStatus, transaction: hash });
  });
});

describe("the recorded reverted activation (test/fixtures/tempo-access-key.json, revertedActivation)", () => {
  const F = JSON.parse(readFileSync(new URL("./fixtures/tempo-access-key.json", import.meta.url), "utf8"));
  const r = F.revertedActivation.receipt as { transactionHash: Hex; status: 0; blockNumber: string; logs: EvmLog[] };
  const at = BigInt(r.blockNumber);
  const heads = { latest: BigInt(F.finalized), safe: BigInt(F.finalized), finalized: BigInt(F.finalized) };

  it("its receipt holds the witness log; the slot places it, and without its signed bytes the read holds the search there", async () => {
    expect(r.status).toBe(0);
    expect(r.logs[0]!.topics).toEqual([KEY_AUTHORIZATION_WITNESS_TOPIC, `0x${"00".repeat(12)}${F.account.slice(2)}`, F.revertedActivation.witness]);
    const reader = tempoLedgerReader({
      network: "eip155:42431",
      heads,
      txs: [{ hash: r.transactionHash, block: at, status: 0, from: F.account, to: null, input: "0x", logs: r.logs }],
      keys: [{ account: F.account, keyId: F.revertedActivation.keyId, from: at }],
    });
    const recorded: SessionRef = {
      network: "eip155:42431",
      payee: F.recipient,
      bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: F.revertedActivation.witness },
      accessKey: { keyId: F.revertedActivation.keyId, token: F.token, to: `0x${"00".repeat(32)}` },
      payer: F.account,
      // The recording holds no key authorization's bytes; the read compares none whose transaction it cannot decode.
      signed: `0x${"11".repeat(32)}`,
    };
    const q = { act: "payment", finality: "finalized", after: at - 1000n } as const;
    const { signed: _, ...unsigned } = recorded;
    expect(await subscriptionTempo.status(unsigned as never, reader as never, q)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
    expect(await subscriptionTempo.status(recorded as never, reader as never, q)).toEqual({
      state: "pending",
      reason: "search-incomplete",
      search: q.after,
      undecoded: [r.transactionHash.toLowerCase()],
      foreign: [],
    });
  });
});
