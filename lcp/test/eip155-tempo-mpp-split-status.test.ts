// The Tempo split-memo charge's `status` (profile `mpp/charge/tempo/split-memo`, rules 9 to 12; `read-status`) on a
// constructed ledger (test/eip155-tempo-mpp-ledger.ts). The transactions on it are stock `mppx` 0.17.6's, signed through
// the vectors' oracle (test/eip155-tempo-mpp-split-oracle.ts) with Anvil's published development keys: #0 the payer, #1
// another account, #2 the payee, under a challenge lcp's `advertise` placed. Their receipts carry the logs a TIP-20
// `transferWithMemo` call emits, `Transfer` and `TransferWithMemo`, written here. One test for each rule of the read as
// the pairing's `status` states it: the search for H, the act's own instrument and the payment presented, what moved and
// who signed it, and a reverted transaction of the payer's own.
import { describe, expect, it } from "vitest";
import type { Hex } from "../src/evm-abi.js";
import { ReaderError, type EvmLog } from "../src/evm.js";
import type { TempoSearchReader } from "../src/tempo.js";
import { tempoSplitMemo, tempoSplitMemoPush, type TempoSplitQuery, type TempoSplitRef } from "../src/mpp-tempo.js";
import { RECEIVE_POLICY_GUARD, TRANSFER_WITH_MEMO_TOPIC } from "../src/tempo.js";
import { TRANSFER_BLOCKED_TOPIC } from "../src/internal/tempo-nonce.js";
import { TRANSFER_TOPIC } from "../src/internal/evm.js";
import { privateKeyToAccount } from "viem/accounts";
import { txHashOf, type LedgerSpec, type LedgerTx } from "./eip155-tempo-mpp-ledger.js";
import { tempoLedgerReader as ledgerReader } from "./eip155-tempo-mpp-tempo-ledger.js";
import { DEV_KEY, H, mppxPays, NOW, viemRead, type WireChallenge } from "./eip155-tempo-mpp-split-oracle.js";

/** Anvil's development keys #1 and #2, published by Foundry, beside #0 (`DEV_KEY`). */
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const PAYEE_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const PAYER = privateKeyToAccount(DEV_KEY).address;
const OTHER = privateKeyToAccount(OTHER_KEY).address;
const PAYEE = privateKeyToAccount(PAYEE_KEY).address;
const lower = (a: string): Hex => a.toLowerCase() as Hex;
/** pathUSD, Tempo's TIP-20 at its fixed address, and another TIP-20 address. */
const CURRENCY = "0x20c0000000000000000000000000000000000000" as const;
const OTHER_TOKEN = "0x20c0000000000000000000000000000000000001" as const;
const NETWORK = "eip155:42431";
const LINK = "https://seller.example/atr";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const word = (a: string): Hex => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
const uint = (n: bigint): Hex => `0x${n.toString(16).padStart(64, "0")}`;

/** A Tempo charge challenge to the payee, as lcp's `advertise` places it for the form `mode` names. */
function placed(mode: "pull" | "push"): { offer: WireChallenge; placed: WireChallenge } {
  const offer = {
    realm: "api.seller.example",
    method: "tempo",
    intent: "charge",
    expires: "2026-09-21T14:18:20Z",
    request: b64({ amount: "10000", currency: CURRENCY, recipient: PAYEE, methodDetails: { chainId: 42431, feePayer: false, supportedModes: [mode] } }),
  } as WireChallenge;
  const codec = mode === "pull" ? tempoSplitMemo : tempoSplitMemoPush;
  const out = codec.advertise([offer] as never, H as never, LINK, offer as never, 0);
  if (!Array.isArray(out)) throw new Error(`advertise refused: ${JSON.stringify(out)}`);
  return { offer, placed: out[0] as unknown as WireChallenge };
}

/** The pull form: a signed transaction, signed with `key` at `now`, under the placed challenge, and its credential. */
async function pulled(key: Hex = DEV_KEY, now = NOW): Promise<{ raw: Hex; credential: unknown }> {
  const paid = await mppxPays(placed("pull").placed, "pull", now, key);
  return { raw: paid.credential.payload["signature"] as Hex, credential: paid.credential };
}

/** The logs one `transferWithMemo` call of `token` emits: `Transfer`, then `TransferWithMemo` where it has a memo. */
function transferLogs(token: Hex, from: string, to: string, amount: bigint, memo?: Hex): EvmLog[] {
  const logs: EvmLog[] = [{ address: token, topics: [TRANSFER_TOPIC, word(from), word(to)], data: uint(amount) }];
  if (memo !== undefined) logs.push({ address: token, topics: [TRANSFER_WITH_MEMO_TOPIC, word(from), word(to), memo], data: uint(amount) });
  return logs;
}

/** The logs the stock client's transaction emits on success: the primary with its attribution memo, then H's split. */
function paidLogs(raw: Hex, to: string = PAYEE): EvmLog[] {
  const primary = viemRead(raw).calls[0]!.data;
  const attribution = `0x${primary.slice(2 + 8 + 64 + 64)}` as Hex;
  return [...transferLogs(CURRENCY, PAYER, to, 9999n, attribution), ...transferLogs(CURRENCY, PAYER, to, 1n, H)];
}

function tx(name: string, block: bigint, raw: Hex, logs: readonly EvmLog[], from: Hex = PAYER, status: 0 | 1 = 1): LedgerTx {
  return { hash: txHashOf(name), block, status, from, to: CURRENCY, input: "0x", logs, raw };
}

function ledger(txs: readonly LedgerTx[], heads = { latest: 30n, safe: 30n, finalized: 30n }, logRange?: bigint): LedgerSpec {
  return { network: NETWORK, heads, txs, ...(logRange === undefined ? {} : { logRange }) };
}

const query = (extra: Partial<TempoSplitQuery> = {}): TempoSplitQuery => ({ act: "payment", finality: "finalized", ...extra });

async function pullRef(credential: unknown): Promise<TempoSplitRef> {
  const ref = await tempoSplitMemo.reference(credential as never, placed("pull").placed as never);
  if ("refused" in ref) throw new Error(`reference refused: ${ref.code}`);
  return ref;
}

describe("mpp/charge/tempo/split-memo status on a constructed ledger", () => {
  it("rule 1, the search: TransferWithMemo by payer and H on every contract and the guard's TransferBlocked, paged from the caller's position, the position returned", async () => {
    const pay = await pulled();
    const ref = await pullRef(pay.credential);
    const heads = { latest: 200_000n, safe: 200_000n, finalized: 200_000n };
    const empty = ledger([], heads, 6_000n);
    const inner = ledgerReader(empty);
    const filters: { address?: Hex; topics: readonly (Hex | null)[]; fromBlock: bigint; toBlock: bigint }[] = [];
    const reader: TempoSearchReader = { ...inner, logs: async (f) => (filters.push(f), inner.logs(f)) };

    // Pages of 10,000 blocks, halved where the endpoint refuses one; at most 8 pages a call, the position reached returned,
    // the value read unconsumed at both heads (instrument-live, answered before search-incomplete).
    // Each page reads every contract's TransferWithMemo by payer and H, and the guard's TransferBlocked by its topic alone.
    expect(await tempoSplitMemo.status(ref, reader, query())).toEqual({ state: "pending", reason: "instrument-live", search: 40_000n, foreign: [] });
    expect([filters[0]!.fromBlock, filters[0]!.toBlock, filters[1]!.fromBlock, filters[1]!.toBlock]).toEqual([0n, 9_999n, 0n, 4_999n]);
    const memo = filters.filter((f) => f.address === undefined);
    const guard = filters.filter((f) => f.address !== undefined);
    expect(new Set(memo.map((f) => JSON.stringify(f.topics)))).toEqual(new Set([JSON.stringify([TRANSFER_WITH_MEMO_TOPIC, word(PAYER), null, H])]));
    expect(new Set(guard.map((f) => JSON.stringify([f.address, f.topics])))).toEqual(new Set([JSON.stringify([RECEIVE_POLICY_GUARD, [TRANSFER_BLOCKED_TOPIC]])]));
    expect(await tempoSplitMemo.status(ref, reader, query({ search: 40_000n }))).toEqual({ state: "pending", reason: "instrument-live", search: 80_000n, foreign: [] });

    // The search finds the payment from the position given.
    const spec = ledger([tx("pay", 170_000n, pay.raw, paidLogs(pay.raw))], heads, 6_000n);
    const settled = await tempoSplitMemo.status(ref, ledgerReader(spec), query({ search: 160_000n }));
    expect(settled).toMatchObject({ state: "settled", transaction: txHashOf("pay"), position: 170_000n, finality: "finalized", presented: "yes", foreign: [] });

    // A range the endpoint refuses at one block is unreadable, transport; with nothing landed, the search read whole is
    // not-found where the read holds no value (a push whose transaction the endpoint does not return), and the value
    // unconsumed, its validity not passed, is instrument-live.
    expect(await tempoSplitMemo.status(ref, ledgerReader({ ...spec, logRange: 0n }), query())).toEqual({ state: "unreadable", reason: "transport", foreign: [] });
    expect(await tempoSplitMemo.status(ref, ledgerReader(ledger([])), query())).toEqual({ state: "pending", reason: "instrument-live", foreign: [] });
    const unnamed = { ...ref, named: txHashOf("gone") };
    expect(await tempoSplitMemoPush.status(unnamed, ledgerReader(ledger([])), query())).toEqual({ state: "pending", reason: "not-found", foreign: [] });
  });

  it("rule 10, the search's pages: a range refused at one block is transport", async () => {
    const ref = await pullRef((await pulled()).credential);
    const refused = ledgerReader({ ...ledger([]), fault: { method: "logs", error: new ReaderError("too-large", "range refused") } });
    expect(await tempoSplitMemo.status(ref, refused, query())).toEqual({ state: "unreadable", reason: "transport", foreign: [] });
  });

  it("rule 10, the search's pages: a page holding an entry that is no log is unparseable", async () => {
    const ref = await pullRef((await pulled()).credential);
    const inner = ledgerReader(ledger([]));
    const malformed: TempoSearchReader = { ...inner, logs: async () => [{ address: RECEIVE_POLICY_GUARD, topics: [TRANSFER_BLOCKED_TOPIC], data: "0x" }] as never };
    expect(await tempoSplitMemo.status(ref, malformed, query())).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
  });

  it("rule 2, the act's own instrument: the presented transaction on pull, the named one on push; presented decides no answer", async () => {
    const pay = await pulled();
    const again = await pulled(DEV_KEY, NOW + 30);
    const ref = await pullRef(pay.credential);
    const againRef = await pullRef(again.credential);
    expect(againRef.signed).not.toBe(ref.signed);

    // The landed transaction whose sender-signed fields are the presented ones is the payment presented.
    const own = ledger([tx("pay", 20n, pay.raw, paidLogs(pay.raw))]);
    expect(await tempoSplitMemo.status(ref, ledgerReader(own), query())).toMatchObject({ state: "settled", transaction: txHashOf("pay"), presented: "yes" });

    // A second act of the payer that meets every test, landed first, is the one settled on, and is not the payment presented.
    const both = ledger([tx("again", 10n, again.raw, paidLogs(again.raw)), tx("pay", 20n, pay.raw, paidLogs(pay.raw))]);
    expect(await tempoSplitMemo.status(ref, ledgerReader(both), query())).toMatchObject({ state: "settled", transaction: txHashOf("again"), presented: "no", foreign: [] });

    // Given by its reference, that act is never settled on, and is a foreign item, given.
    const given = await tempoSplitMemo.status(ref, ledgerReader(both), query({ others: [{ ref: againRef }] }));
    expect(given).toMatchObject({ state: "settled", transaction: txHashOf("pay"), presented: "yes" });
    expect(given.foreign.map((f) => [f.transaction, f.reason])).toEqual([[txHashOf("again"), "given"]]);

    // On push, the transaction the credential names, read by fetchPresented from the same ledger.
    const push = placed("push");
    const paid = await mppxPays(push.placed, "push", NOW);
    const named = paid.credential.payload["hash"] as Hex;
    const pushLedger = ledger([{ ...tx("pushed", 20n, paid.sent!, paidLogs(paid.sent!)), hash: named }]);
    const landed = await tempoSplitMemoPush.fetchPresented(paid.credential as never, ledgerReader(pushLedger));
    expect(landed).not.toHaveProperty("refused");
    const pushRef = await tempoSplitMemoPush.reference(landed as never, push.placed as never);
    expect(pushRef).toMatchObject({ payer: lower(PAYER), payee: lower(PAYEE), named });
    expect(await tempoSplitMemoPush.status(pushRef as TempoSplitRef, ledgerReader(pushLedger), query())).toMatchObject({
      state: "settled",
      transaction: named,
      presented: "yes",
    });
    // The push form's read of another act of the payer: settled on it, not the transaction the credential names.
    const pushBoth = ledger([tx("again", 10n, again.raw, paidLogs(again.raw)), ...pushLedger.txs]);
    expect(await tempoSplitMemoPush.status(pushRef as TempoSplitRef, ledgerReader(pushBoth), query())).toMatchObject({
      state: "settled",
      transaction: txHashOf("again"),
      presented: "no",
    });
  });

  it("rule 3, what moved and who signed: every transfer from the payer with its place, the payee's account, and the foreign items", async () => {
    const pay = await pulled();
    const elsewhere = await pulled(DEV_KEY, NOW + 30);
    const spender = await pulled(OTHER_KEY);
    const payee = await pulled(PAYEE_KEY);
    const ref = await pullRef(pay.credential);
    const spec = ledger([
      tx("elsewhere", 12n, elsewhere.raw, paidLogs(elsewhere.raw, OTHER)),
      tx("spender", 14n, spender.raw, transferLogs(CURRENCY, PAYER, OTHER, 1n, H), OTHER),
      tx("payee", 16n, payee.raw, transferLogs(CURRENCY, PAYER, PAYEE, 1n, H), PAYEE),
      tx("pay", 20n, pay.raw, paidLogs(pay.raw)),
    ]);
    const answer = await tempoSplitMemo.status(ref, ledgerReader(spec), query());
    const moved = (name: string, to: string, places: readonly [number, string][]) =>
      places.map(([place, amount]) => ({ asset: CURRENCY, to: lower(to), amount, transaction: txHashOf(name), place }));
    expect(answer).toEqual({
      state: "settled",
      transaction: txHashOf("pay"),
      position: 20n,
      finality: "finalized",
      moved: moved("pay", PAYEE, [[0, "9999"], [2, "1"]]),
      signer: lower(PAYER),
      presented: "yes",
      foreign: [
        { transaction: txHashOf("elsewhere"), position: 12n, signer: lower(PAYER), moved: moved("elsewhere", OTHER, [[0, "9999"], [2, "1"]]), reason: "other-account" },
        { transaction: txHashOf("spender"), position: 14n, signer: lower(OTHER), moved: moved("spender", OTHER, [[0, "1"]]), reason: "other-signer" },
        { transaction: txHashOf("payee"), position: 16n, signer: lower(PAYEE), moved: moved("payee", PAYEE, [[0, "1"]]), reason: "payee-signed" },
      ],
    });

    // A transfer to the payee's account pays, whatever its token and amount, zero included.
    const zero = ledger([tx("pay", 20n, pay.raw, [...transferLogs(OTHER_TOKEN, PAYER, PAYEE, 0n), ...transferLogs(CURRENCY, PAYER, OTHER, 1n, H)])]);
    expect(await tempoSplitMemo.status(ref, ledgerReader(zero), query())).toMatchObject({
      state: "settled",
      moved: [
        { asset: OTHER_TOKEN, to: lower(PAYEE), amount: "0", place: 0 },
        { asset: CURRENCY, to: lower(OTHER), amount: "1", place: 1 },
      ],
    });
  });

  it("rule 4, a reverted transaction of the payer's own: transaction-failed at the final mark, below it pending", async () => {
    const pay = await pulled();
    const ref = await pullRef(pay.credential);
    const landed = { ...ref, transaction: txHashOf("pay") };
    const reverted = [tx("pay", 20n, pay.raw, [], PAYER, 0)];
    expect(await tempoSplitMemo.status(landed, ledgerReader(ledger(reverted)), query())).toEqual({
      state: "failed",
      reason: "transaction-failed",
      transaction: txHashOf("pay"),
      position: 20n,
      finality: "finalized",
      moved: [],
      signer: lower(PAYER),
      foreign: [],
    });
    // Above the finalized block, the same facts answer pending, below-mark, naming it at the latest head.
    expect(await tempoSplitMemo.status(landed, ledgerReader(ledger(reverted, { latest: 30n, safe: 15n, finalized: 15n })), query())).toEqual({
      state: "pending",
      reason: "below-mark",
      transaction: txHashOf("pay"),
      position: 20n,
      finality: "latest",
      moved: [],
      signer: lower(PAYER),
      foreign: [],
    });
  });

  it("rule 5, a value read below the latest head that the endpoint fails, though it serves the block headers: history-gap", async () => {
    const pay = await pulled();
    const ref = await pullRef(pay.credential);
    const base = ledgerReader(ledger([], { latest: 40n, safe: 30n, finalized: 30n }));
    // An endpoint that prunes state: a storage read below its latest block fails with the node's own error.
    const pruned = { ...base, storageAt: async (a: Hex, slot: Hex, block: bigint) => (block < 40n ? Promise.reject(new Error("missing trie node")) : base.storageAt(a, slot, block)) };
    expect(await tempoSplitMemo.status(ref, pruned, query())).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });

  it("rule 5, the value by its nonce key: the expiring nonce's slot read at both heads, and the consumer found by halving", async () => {
    const pay = await pulled();
    const ref = await pullRef(pay.credential);
    expect(ref.nonce.key).toBe(((1n << 256n) - 1n).toString());
    const heads = { latest: 200_000n, safe: 200_000n, finalized: 200_000n };
    // The search has not reached the payment (16 pages a call), but the value reads consumed: the block that consumed it
    // is found by halving, and its transaction read whole is the act.
    const reader = ledgerReader(ledger([tx("pay", 170_000n, pay.raw, paidLogs(pay.raw))], heads, 6_000n));
    expect(await tempoSplitMemo.status(ref, reader, query())).toMatchObject({ state: "settled", transaction: txHashOf("pay"), position: 170_000n });
    expect(reader.calls.filter((c) => c === "storageAt").length).toBeGreaterThan(2);
    expect(reader.calls).toContain("blockTransactions");
    // A value read consumed whose transaction no block lists is never failed and never not-found.
    const value = { sender: lower(PAYER), key: BigInt(ref.nonce.key), nonce: 0n, signed: ref.signed, validBefore: BigInt(ref.validBefore!) };
    const lost = ledgerReader({ ...ledger([]), consumed: [{ value, from: 10n }] });
    expect(await tempoSplitMemo.status(ref, lost, query())).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });

  it("rule 6, a transfer the payee's receive policy held: found by the guard's TransferBlocked, moved to the guard", async () => {
    const pay = await pulled();
    const ref = await pullRef(pay.credential);
    const receipt = (originator: string, memo: Hex): Hex =>
      `0x${[1n, BigInt(CURRENCY), 0n, BigInt(originator), BigInt(PAYEE), 5n, 7n, 1n, 0n].map((n) => n.toString(16).padStart(64, "0")).join("")}${memo.slice(2)}`;
    const blocked = (originator: string, memo: Hex): EvmLog => ({
      address: RECEIVE_POLICY_GUARD,
      topics: [TRANSFER_BLOCKED_TOPIC, word(CURRENCY), word(PAYEE), uint(7n)],
      data: `0x${uint(1n).slice(2)}${uint(1n).slice(2)}${uint(96n).slice(2)}${uint(320n).slice(2)}${receipt(originator, memo).slice(2)}` as Hex,
    });
    const logs = [...transferLogs(CURRENCY, PAYER, PAYEE, 9999n), ...transferLogs(CURRENCY, PAYER, RECEIVE_POLICY_GUARD, 1n), blocked(PAYER, H)];
    const spec = ledger([tx("pay", 20n, pay.raw, logs)]);
    // The held split carries H by its receipt; the primary still reached the payee, so the act pays.
    expect(await tempoSplitMemo.status(ref, ledgerReader(spec), query())).toMatchObject({ state: "settled", transaction: txHashOf("pay") });
    // Every transfer held: the payer's own transaction moved its value to the guard, another account: instrument-consumed.
    const held = ledger([tx("pay", 20n, pay.raw, [...transferLogs(CURRENCY, PAYER, RECEIVE_POLICY_GUARD, 10000n), blocked(PAYER, H)])]);
    expect(await tempoSplitMemo.status(ref, ledgerReader(held), query())).toMatchObject({
      state: "failed",
      reason: "instrument-consumed",
      carries: "other-account",
      moved: [{ asset: CURRENCY, to: RECEIVE_POLICY_GUARD, amount: "10000", place: 0 }],
    });
    // An agreement so held is the payer's signed act carrying H, held to no account.
    expect(await tempoSplitMemo.status(ref, ledgerReader(held), query({ act: "agreement" }))).toMatchObject({ state: "settled", transaction: txHashOf("pay") });
    // A receipt the read cannot decode holds the search at its block, and is named.
    const odd = { ...blocked(OTHER, H), data: uint(1n) };
    const other = await pulled(OTHER_KEY);
    const undecodable = ledger([tx("odd", 12n, other.raw, [odd], OTHER)]);
    expect(await tempoSplitMemo.status(ref, ledgerReader(undecodable), query())).toEqual({
      state: "pending",
      reason: "instrument-live",
      search: 12n,
      foreign: [],
    });
  });

  it("rule 7, the lapse: the value read at the last block below validBefore; unconsumed there, with the search whole, instrument-unused", async () => {
    const pay = await pulled();
    const ref = await pullRef(pay.credential);
    const vb = BigInt(ref.validBefore!);
    // One block a second, block b at NOW + b: the last block below validBefore is vb - NOW - 1.
    const timed = (txs: readonly LedgerTx[]): LedgerSpec => ({ ...ledger(txs, { latest: 100n, safe: 100n, finalized: 100n }), timestamp: (b) => BigInt(NOW) + b });
    const reader = ledgerReader(timed([]));
    expect(await tempoSplitMemo.status(ref, reader, query())).toEqual({ state: "failed", reason: "instrument-unused", finality: "finalized", foreign: [] });
    expect(reader.calls).toContain("storageAt");
    // Landed below validBefore: settled.
    const at = vb - BigInt(NOW) - 1n;
    expect(await tempoSplitMemo.status(ref, ledgerReader(timed([tx("pay", at, pay.raw, paidLogs(pay.raw))])), query())).toMatchObject({ state: "settled" });
    // A validBefore passed at the latest head alone, its finalized block below it: below-mark.
    const above = { ...timed([]), heads: { latest: 100n, safe: 5n, finalized: 5n } };
    expect(await tempoSplitMemo.status(ref, ledgerReader(above), query())).toEqual({ state: "pending", reason: "below-mark", foreign: [] });
    // Any finality but finalized is unparseable: Tempo has one mark.
    expect(await tempoSplitMemo.status(ref, ledgerReader(timed([])), query({ finality: "latest" }))).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
  });
});
