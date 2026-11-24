// Runs the Starknet pairing's vector file through the starknet entry point. Every expected value is the file's, which
// computes them with starknet.js, @noble/hashes 2.4.0, Python and coreutils, and SNIP-9's published type hashes. The
// SNIP-12 message hash (the vector file's S3 and S7 expectMessageHash) is computed over build's output with
// starknet.js's typedData.getMessageHash. S5 to S7 read over the constructed nodes S5's about describes.
import { readFileSync } from "node:fs";
import { typedData as snTypedData } from "starknet";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { agreementValue } from "../src/core.js";
import { pairingOf } from "../src/index.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";
import {
  EVENT_TRANSFER,
  FELT_P,
  MASK_250,
  SELECTOR_EXECUTE_FROM_OUTSIDE_V2,
  SELECTOR_TRANSFER,
  STARKNET_MAX_CANDIDATES,
  exactStarknet,
  snNonce,
  starknetFloor,
  starknetLandedNonce,
  type Felt,
  type OutsideExecutionTypedData,
  type StarknetEmittedEvent,
  type StarknetInvocation,
  type StarknetReader,
  type StarknetReceipt,
} from "../src/starknet.js";
import type { AtrHash } from "../src/core.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-starknet.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const snKeccak = (s: string) => `0x${(BigInt(keccak256(toBytes(s))) & MASK_250).toString(16)}`;
const typeHash = (types: OutsideExecutionTypedData["types"], primary: "OutsideExecution" | "Call") => {
  const enc = (name: "OutsideExecution" | "Call") =>
    `"${name}"(${types[name].map((f) => `"${f.name}":"${f.type}"`).join(",")})`;
  return snKeccak(primary === "OutsideExecution" ? enc("OutsideExecution") + enc("Call") : enc("Call"));
};
const doc = (extensions?: PaymentRequired["extensions"]): PaymentRequired => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepts: [O],
  ...(extensions !== undefined ? { extensions } : {}),
});
const advertised = () => exactStarknet.advertise(doc(), H, V.fixed.link, O) as PaymentRequired;
const pay = async (required: PaymentRequired = advertised(), act?: "payment" | "agreement") => {
  const u = await exactStarknet.build({ required, accepted: O, from: V.fixed.from, now: V.fixed.now }, H, act);
  if ("refused" in u) throw new Error(u.code);
  const p = u.complete(V.S3.signature);
  if ("refused" in p) throw new Error(p.code);
  return p;
};
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

type Rec = { finality: string; execution: string; blockNumber: string | null; events: StarknetReceipt["events"] };
type Tx = { receipt: Rec; trace: StarknetInvocation | null };
type Emitted = Omit<StarknetEmittedEvent, "blockNumber"> & { blockNumber: string | null };
type FixtureNode = {
  network: string;
  final: { number: string; timestamp: string };
  latest: { number: string; timestamp: string };
  used: { account: string; nonce: string; at: string }[];
  stateFrom?: string;
  eventsFrom?: string;
  pageSize: number;
  events: Emitted[];
  transactions: Record<string, Tx>;
  fail?: boolean;
  nonceError?: { code: number; message: string };
};
type Query = { act: "payment" | "agreement"; finality: "ACCEPTED_ON_L1" | "ACCEPTED_ON_L2"; after?: string; search?: Record<string, string | number>; others?: unknown[] };

const receiptOf = (r: Rec): StarknetReceipt => ({ ...r, blockNumber: r.blockNumber === null ? null : BigInt(r.blockNumber) }) as StarknetReceipt;

/** A constructed node (S5's about), answering for `network`. */
function nodeReader(n: FixtureNode, network: string = n.network): StarknetReader {
  const fail = async (): Promise<void> => {
    if (n.fail === true) throw new ReaderError("transport");
  };
  const tx = (hash: string): Tx | undefined => n.transactions[hash.toLowerCase()];
  return {
    network: network as StarknetReader["network"],
    async receipt(hash) {
      await fail();
      const t = tx(hash);
      return t === undefined ? null : receiptOf(t.receipt);
    },
    async trace(hash) {
      await fail();
      return tx(hash)?.trace ?? null;
    },
    async head(mark) {
      await fail();
      const h = mark === "ACCEPTED_ON_L1" ? n.final : n.latest;
      return { number: BigInt(h.number), timestamp: BigInt(h.timestamp) };
    },
    async nonceValid(account, nonce, block) {
      await fail();
      if (n.nonceError !== undefined) throw Object.assign(new Error(n.nonceError.message), { code: n.nonceError.code });
      if (n.stateFrom !== undefined && block < BigInt(n.stateFrom)) return null;
      return !n.used.some((u) => BigInt(u.account) === BigInt(account) && BigInt(u.nonce) === BigInt(nonce) && block >= BigInt(u.at));
    },
    async events(q) {
      await fail();
      if (n.eventsFrom !== undefined && q.from < BigInt(n.eventsFrom)) return null;
      const keys = new Set((q.keys[0] ?? []).map((k) => BigInt(k)));
      const all = n.events.filter(
        (e) =>
          BigInt(e.fromAddress) === BigInt(q.address) &&
          (keys.size === 0 || keys.has(BigInt(e.keys[0]!))) &&
          e.blockNumber !== null &&
          BigInt(e.blockNumber) >= q.from &&
          BigInt(e.blockNumber) <= q.to,
      );
      const start = q.continuation === undefined ? 0 : Number(q.continuation);
      const events = all.slice(start, start + n.pageSize).map((e) => ({ ...e, blockNumber: e.blockNumber === null ? null : BigInt(e.blockNumber) }));
      return { events, continuation: start + n.pageSize < all.length ? String(start + n.pageSize) : null };
    },
  };
}

/** A vector row's query, its positions bigints. */
const queryOf = (q: Query) => ({
  ...q,
  ...(q.after === undefined ? {} : { after: BigInt(q.after) }),
  ...(q.search === undefined
    ? {}
    : { search: Object.fromEntries(Object.entries(q.search).map(([k, v]) => [k, k === "from" || k === "to" ? BigInt(v as string) : v])) }),
});
const REF = V.S5.ref;
const refOf = (row: { transaction?: string }, ref: unknown = REF) => ({ ...(ref as object), ...(row.transaction === undefined ? {} : { transaction: row.transaction }) });
const status = async (row: { node: FixtureNode; query: Query; transaction?: string }, ref: unknown = REF, network?: string) =>
  plain(await exactStarknet.status(refOf(row, ref) as never, nodeReader(row.node, network), queryOf(row.query) as never));

/** The receipts and traces starknetLandedNonce reads (the file's `landed`). */
type Fixture = { case: string; receipt?: Rec | null | "reader-error"; trace?: StarknetInvocation };
function readerFor(a: { receipt?: Rec | null | "reader-error"; trace?: StarknetInvocation }): StarknetReader {
  const none = async (): Promise<never> => {
    throw new Error("starknetLandedNonce reads no state and searches no events");
  };
  return {
    network: V.landed.ref.network,
    receipt: async () => {
      if (a.receipt === "reader-error") throw new ReaderError("transport");
      if (a.receipt === null || a.receipt === undefined) return null;
      return receiptOf(a.receipt);
    },
    trace: async () => a.trace ?? null,
    head: none,
    nonceValid: none,
    events: none,
  };
}
const LANDED = V.landed.ref;
const fixture = (c: string): Fixture => V.landed.fixtures.find((r: Fixture) => r.case === c);

describe("x402-exact-starknet.json", () => {
  it("S1: the fitting rule gives x402's published selectors", () => {
    expect(keccak256(toBytes("transfer"))).toBe(V.S1.keccakTransfer);
    expect(BigInt(snKeccak("transfer"))).toBe(BigInt(V.S1.expectSelectorTransfer));
    expect(BigInt(SELECTOR_TRANSFER)).toBe(BigInt(V.S1.expectSelectorTransfer));
    expect(snKeccak("execute_from_outside_v2")).toBe(V.S1.expectSelectorExecuteFromOutsideV2);
    expect(SELECTOR_EXECUTE_FROM_OUTSIDE_V2).toBe(V.S1.expectSelectorExecuteFromOutsideV2);
  });

  it("S2: the nonce is H's low 250 bits, for either spelling of H", () => {
    expect(snNonce(H)).toBe(V.S2.expectNonce);
    expect(snNonce(V.S2.upperCaseH)).toBe(V.S2.expectNonce);
  });

  // The interface: "No function throws"; a value that is not a hash is x402's `payload-malformed`, as in `build`.
  it("S2: a value that is not a 32-byte hash is refused, never read as the felt 0x0", () => {
    for (const bad of ["0x12", H.slice(2)] as unknown as AtrHash[]) {
      expect(snNonce(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("S3: build gives x402's typed data, whose type hashes are SNIP-9's", async () => {
    const u = await exactStarknet.build({ required: advertised(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    const td = u.request.typedData;
    expect(u.request.kind).toBe("starknet-snip12");
    expect(BigInt(u.request.account)).toBe(BigInt(V.fixed.from));
    expect(td.primaryType).toBe("OutsideExecution");
    expect(td.domain).toEqual({ name: "Account.execute_from_outside", version: 2, chainId: V.S3.expectChainId, revision: 1 });
    expect(td.message.Nonce).toBe(V.S2.expectNonce);
    expect(td.message["Execute After"]).toBe("1");
    expect(td.message["Execute Before"]).toBe(V.S3.expectExecuteBefore);
    expect(BigInt(td.message.Caller)).toBe(BigInt(O.extra!["feePayer"] as string));
    expect(td.message.Calls).toEqual([{ To: BigInt(O.asset).toString(16).replace(/^/, "0x"), Selector: SELECTOR_TRANSFER, Calldata: V.S3.expectCalldata }]);
    expect(typeHash(td.types, "OutsideExecution")).toBe(V.S3.expectTypeHashOutsideExecution);
    expect(typeHash(td.types, "Call")).toBe(V.S3.expectTypeHashCall);
  });

  it("S3: the SNIP-12 message hash of build's typed data, for the payer's account, is the vector's", async () => {
    const u = await exactStarknet.build({ required: advertised(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(snTypedData.getTypeHash(u.request.typedData.types, "OutsideExecution", "1")).toBe(V.S3.expectTypeHashOutsideExecution);
    expect(snTypedData.getMessageHash(u.request.typedData as never, u.request.account)).toBe(V.S3.expectMessageHash);
  });

  // B6's note says how its payment is written by hand from scheme_exact_starknet.md.
  it("S4: complete's payment is buyer B6's, whole", async () => {
    const presented = (V.buyer.rows as { name: string; input: { presented: unknown } }[]).find((r) => r.name === "B6")!.input.presented;
    const p = await pay();
    expect(p).toStrictEqual(presented);
    expect(JSON.stringify(p)).toBe(JSON.stringify(presented));
  });

  it("S4: bound and reference", async () => {
    const p = await pay();
    expect(await exactStarknet.bound(p)).toBe(V.S4.expectBound);
    const ref = await exactStarknet.reference(p, O);
    expect(ref).toEqual(V.S4.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const other = await pay(doc({ legalContext: { info: { type: "sha256", value: V.S4.boundWithEmptyHash.value, legalContextUrl: V.fixed.link }, schema: {} } }));
    expect(await exactStarknet.bound(other)).toEqual(V.S4.boundWithEmptyHash.expect);
    const bare = await pay(doc());
    expect(await exactStarknet.bound(bare)).toEqual(V.S4.boundWithoutExtension);
    const short = structuredClone(p);
    (short.payload.outsideExecution.typedData.domain as { chainId: string }).chainId = V.S4.chainIdShortString;
    expect(await exactStarknet.bound(short)).toBe(V.S4.expectBound);
  });

  // Row 20. starknet.js's own client writes the calldata of CallData.compile as decimal strings, and Execute After and
  // Execute Before as numbers when given numbers; SNIP-12 and the account contract hash the value, and on
  // starknet-devnet the account executed such a message, paying the payee. bound and reference read each spelling as
  // the same felt; the twin is the hex spelling build writes, read to the same reference.
  it("bound and reference read a message's felts written as starknet.js writes them: decimal strings and numbers", async () => {
    const p = await pay();
    const want = await exactStarknet.reference(p, O);
    if ("refused" in want) throw new Error(want.code);
    type Msg = { [k: string]: unknown; Calls: { [k: string]: unknown; Calldata: string[] }[] };
    const respelled = (edit: (m: Msg) => void) => {
      const q = structuredClone(p);
      edit(q.payload.outsideExecution.typedData.message as unknown as Msg);
      return q;
    };
    const dec = (felt: unknown) => BigInt(felt as string).toString(10);
    const sdk = respelled((m) => {
      const c = m.Calls[0]!;
      c.Calldata = c.Calldata.map(dec);
      m["Execute After"] = Number(m["Execute After"]);
      m["Execute Before"] = Number(m["Execute Before"]);
    });
    // starknet.js hashes the respelled message to the same SNIP-12 hash, so the payer signed the same thing.
    const hashOf = (q: typeof p) => snTypedData.getMessageHash(q.payload.outsideExecution.typedData as never, V.fixed.from);
    expect(hashOf(sdk)).toBe(hashOf(p));
    expect(await exactStarknet.bound(sdk)).toBe(V.S4.expectBound);
    expect(await exactStarknet.reference(sdk, O)).toEqual(want);
    const everyFelt = respelled((m) => {
      for (const k of ["Execute After", "Execute Before"]) m[k] = dec(m[k]);
      for (const c of m.Calls) c["To"] = dec(c["To"]);
    });
    expect(hashOf(everyFelt)).toBe(hashOf(p));
    expect(await exactStarknet.reference(everyFelt, O)).toEqual(want);
    // A decimal Selector is not the same message: SNIP-12's selector type hashes a string that is not hex as a name.
    const decSelector = respelled((m) => void (m.Calls[0]!["Selector"] = dec(m.Calls[0]!["Selector"])));
    expect(hashOf(decSelector)).not.toBe(hashOf(p));
    expect(await exactStarknet.bound(decSelector)).toEqual({ refused: true, code: "starknet/typed-data-malformed" });
    // Not felts in any spelling: refused as before.
    const malformed = { refused: true, code: "starknet/typed-data-malformed" };
    const P = (FELT_P as bigint).toString(10);
    for (const bad of [
      respelled((m) => void (m.Calls[0]!.Calldata[1] = P)),
      respelled((m) => void (m.Calls[0]!.Calldata[1] = "-1")),
      respelled((m) => void (m.Calls[0]!.Calldata[1] = "1e3")),
      respelled((m) => void (m["Execute Before"] = 1.5)),
      respelled((m) => void (m["Execute Before"] = -1)),
      respelled((m) => void (m["Execute After"] = (2n ** 64n).toString(10))),
    ]) {
      expect(await exactStarknet.reference(bad, O)).toEqual(malformed);
    }
  });

  describe("S5: status over a constructed node", () => {
    for (const row of rowsOf(V.S5.rows, "x402-exact-starknet.json S5.rows")) {
      it(row.case, async () => {
        expect(await status(row)).toEqual(row.expect);
      });
    }

    it("a reader for another network is chain-mismatch, with nothing read", async () => {
      const row = V.S5.rows[0];
      const { reader, calls } = counting(nodeReader(row.node, "starknet:SN_MAIN"));
      expect(await exactStarknet.status(REF, reader, queryOf(row.query) as never)).toEqual({ state: "unreadable", reason: "chain-mismatch", foreign: [] });
      expect(calls).toEqual([]);
    });

    // A felt is an element of the field of the STARK prime 2^251 + 17·2^192 + 1 (Starknet's felt252), written 0x and hex
    // digits. A reference whose payer, asset, payee or nonce is not one, whose nonce is neither of H's values, or with no
    // H, cannot name what the read reads: unreadable unparseable, with nothing read. A felt reads the same in either case.
    it("a reference that is not one is unreadable unparseable, with nothing read", async () => {
      const row = V.S5.rows.find((r: { transaction?: string; expect: { state: string } }) => r.transaction !== undefined && r.expect.state === "settled");
      const prime = "0x800000000000011000000000000000000000000000000000000000000000001";
      const bad: [string, unknown][] = [
        ["from", undefined],
        ["from", prime],
        ["asset", REF.asset.slice(2)],
        ["payee", "payee"],
        ["nonce", V.S2.expectNonce.replace(/d$/, "e")],
        ["h", undefined],
        ["h", "0x12"],
        ["transaction", "4c2f9a1b"],
        ["presented", { ...REF.presented, calls: [{ to: REF.asset }] }],
        ["settleBy", 1.5],
      ];
      for (const [key, value] of rowsOf(bad, "the malformed reference members", { exact: 10 })) {
        const { reader, calls } = counting(nodeReader(row.node));
        const ref = { ...refOf(row), [key]: value };
        expect([key, await exactStarknet.status(ref as never, reader, queryOf(row.query) as never)]).toEqual([
          key,
          { state: "unreadable", reason: "unparseable", foreign: [] },
        ]);
        expect(calls).toEqual([]);
      }
      const upper = { ...refOf(row), from: `0x${REF.from.slice(2).toUpperCase()}`, transaction: `0x${row.transaction.slice(2).toUpperCase()}` };
      expect(plain(await exactStarknet.status(upper as never, nodeReader(row.node), queryOf(row.query) as never))).toEqual(row.expect);
    });

    // Every settled answer states `presented` (profile rule 20), so the reference holds the outside execution as presented.
    it("a reference without the outside execution as presented is unreadable unparseable", async () => {
      const row = V.S5.rows.find((r: { transaction?: string; expect: { state: string } }) => r.transaction !== undefined && r.expect.state === "settled");
      const { presented: _, ...bare } = refOf(row) as Record<string, unknown>;
      expect(plain(await exactStarknet.status(bare as never, nodeReader(row.node), queryOf(row.query) as never))).toEqual({
        state: "unreadable",
        reason: "unparseable",
        foreign: [],
      });
    });

    // Each other act given by its transaction is read, a receipt and a trace (profile rule 13), so a query reads at most
    // STARKNET_MAX_CANDIDATES of them, and one that gives more is beyond the read's bound.
    it("a query that gives more other acts by their transaction than a call reads is too-large, with nothing read", async () => {
      const row = V.S5.rows[0];
      const given = (n: number) => Array.from({ length: n }, (_, i) => ({ transaction: `0x${(0x9000 + i).toString(16)}` }));
      const most = counting(nodeReader(row.node));
      expect(await exactStarknet.status(REF, most.reader, { ...queryOf(row.query), others: given(STARKNET_MAX_CANDIDATES) } as never)).toEqual(row.expect);
      expect(most.calls.filter((c) => c === "receipt")).toHaveLength(STARKNET_MAX_CANDIDATES);
      const more = counting(nodeReader(row.node));
      expect(await exactStarknet.status(REF, more.reader, { ...queryOf(row.query), others: given(STARKNET_MAX_CANDIDATES + 1) } as never)).toEqual({
        state: "unreadable",
        reason: "too-large",
        foreign: [],
      });
      expect(more.calls).toEqual([]);
    });

    it("a query or a search position that is not one is unreadable unparseable, with nothing read", async () => {
      const row = V.S5.rows[0];
      const queries = [
        { act: "refund", finality: "ACCEPTED_ON_L1" },
        { act: "payment", finality: "PRE_CONFIRMED" },
        { act: "payment", finality: "ACCEPTED_ON_L1", after: 800 },
        { act: "payment", finality: "ACCEPTED_ON_L1", search: { from: "800" } },
        { act: "payment", finality: "ACCEPTED_ON_L1", search: { from: 800n, continuation: "8" } },
        { act: "payment", finality: "ACCEPTED_ON_L1", search: { from: 800n, to: 1000n, continuation: "" } },
        { act: "payment", finality: "ACCEPTED_ON_L1", search: { from: 800n, to: 1000n, skip: -1 } },
      ];
      for (const q of rowsOf(queries, "the malformed queries", { exact: 7 })) {
        const { reader, calls } = counting(nodeReader(row.node));
        expect(await exactStarknet.status(REF, reader, q as never)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
        expect(calls).toEqual([]);
      }
    });

    // The read of the nonce at both blocks is the search for H (profile rule 14): a valid nonce reads no event and no
    // transaction, and a consumer once found ends the search (rule 16).
    it("reads no event where the nonce is valid at both blocks, and none after a named transaction that consumed it", async () => {
      const live = counting(nodeReader(V.S5.rows[0].node));
      await exactStarknet.status(REF, live.reader, queryOf(V.S5.rows[0].query) as never);
      expect(live.calls).toEqual(["head", "head", "nonceValid", "nonceValid"]);
      const named = V.S5.rows.find((r: { case: string }) => r.case.startsWith("the same transaction named by the settler"));
      const read = counting(nodeReader(named.node));
      await exactStarknet.status(refOf(named) as never, read.reader, queryOf(named.query) as never);
      expect(read.calls).toEqual(["receipt", "trace", "head", "head", "nonceValid", "nonceValid"]);
    });
  });

  describe("S6: recover", () => {
    const input = { network: REF.network, tx: V.S6.tx, option: O };
    const nodeOf = (t: Tx | null): FixtureNode => ({ ...V.S5.rows[0].node, transactions: t === null ? {} : { [V.S6.tx]: t } });
    for (const row of rowsOf(V.S6.rows, "x402-exact-starknet.json S6.rows")) {
      it(row.case, async () => {
        expect(await exactStarknet.recover(input, nodeReader(nodeOf(row.tx)))).toEqual(row.expect);
      });
    }
    it("a reader for another network, a tx or an asset that is not a felt: wrong-reader, with nothing read; a failing reader: unreadable", async () => {
      const node = nodeOf(V.S6.rows[0].tx);
      const inputs = [
        [input, "starknet:SN_MAIN"],
        [{ ...input, tx: "4c2f9a1b" }, undefined],
        [{ ...input, option: { ...O, asset: 7 } }, undefined],
      ] as const;
      for (const [i, network] of rowsOf(inputs, "recover's inputs it cannot read", { exact: 3 })) {
        const { reader, calls } = counting(nodeReader(node, network));
        expect(await exactStarknet.recover(i as never, reader)).toEqual({ refused: true, code: "starknet/wrong-reader" });
        expect(calls).toEqual([]);
      }
      expect(await exactStarknet.recover(input, nodeReader({ ...node, fail: true }))).toEqual({ refused: true, code: "starknet/unreadable" });
    });
  });

  describe("S7: the act agreement", () => {
    it("build signs the agreement value's low 250 bits as the Nonce, whose message hash is the vector's", async () => {
      expect(await agreementValue(H)).toBe(V.S7.agreementValue);
      expect(snNonce(V.S7.agreementValue)).toBe(V.S7.expectNonce);
      const u = await exactStarknet.build({ required: advertised(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H, "agreement");
      if ("refused" in u) throw new Error(u.code);
      expect(u.request.typedData.message.Nonce).toBe(V.S7.expectNonce);
      expect(snTypedData.getMessageHash(u.request.typedData as never, u.request.account)).toBe(V.S7.expectMessageHash);
    });
    for (const row of rowsOf(V.S7.bound, "x402-exact-starknet.json S7.bound")) {
      it(`bound: ${row.case}`, async () => {
        const p = await pay(advertised(), row.payload);
        expect(await exactStarknet.bound(p, row.given)).toEqual(row.expect);
      });
    }
    it("reference, given the act agreement and H, names the agreement value's low bits as the signed nonce", async () => {
      const p = await pay(advertised(), "agreement");
      expect(await exactStarknet.reference(p, O, { act: "agreement", h: H })).toEqual(V.S7.reference);
    });
    it(`status: ${V.S7.status.case}`, async () => {
      expect(await status(V.S7.status, { ...V.S7.reference, h: H })).toEqual(V.S7.status.expect);
    });
  });

  describe("S8: bound and reference refuse a message that is not the option's form", () => {
    for (const row of rowsOf(V.S8.rows, "x402-exact-starknet.json S8.rows")) {
      it(row.case, async () => {
        const p = structuredClone(await pay());
        const message = p.payload.outsideExecution.typedData.message as unknown as Record<string, unknown>;
        if (row.Caller !== undefined) message["Caller"] = row.Caller;
        if (row.Selector !== undefined) (message["Calls"] as Record<string, unknown>[])[0]!["Selector"] = row.Selector;
        expect(await exactStarknet.bound(p)).toEqual(row.expect);
        expect(await exactStarknet.reference(p, O)).toEqual(row.expect);
      });
    }
    it(V.S8.acceptedNotOption.case, async () => {
      expect(await exactStarknet.reference(await pay(), V.S8.acceptedNotOption.option)).toEqual(V.S8.acceptedNotOption.expect);
    });
  });

  it(`plant: ${V.plant.case}`, async () => {
    expect(await status(V.plant)).toEqual(V.plant.expect);
  });

  it("S1: the Transfer event's first key is sn_keccak(\"Transfer\")", () => {
    expect(snKeccak("Transfer")).toBe(V.S1.expectSelectorTransferEvent);
    expect(EVENT_TRANSFER).toBe(V.S1.expectSelectorTransferEvent);
  });

  it("starknetLandedNonce gives the nonce under which the transfer with the reference's identity landed", async () => {
    expect(await starknetLandedNonce(LANDED, readerFor(V.landed.landedNonce))).toBe(V.landed.landedNonce.expect);
    const underReverted = fixture("the execute and its transfer under a reverted call, the receipt still listing the transfer");
    expect(await starknetLandedNonce(LANDED, readerFor(underReverted))).toEqual({ refused: true, code: "starknet/no-transfer" });
    const below = fixture("the payer's transfer one call below the execute, through an intermediate call on the payer's account");
    expect(await starknetLandedNonce(LANDED, readerFor(below))).toBe(V.landed.landedNonce.expect);
    const belowReverted = fixture(
      "the payer's transfer one call below the execute, under a reverted intermediate call on the payer's account, its Transfer event left in the receipt",
    );
    expect(await starknetLandedNonce(LANDED, readerFor(belowReverted))).toEqual({ refused: true, code: "starknet/no-transfer" });
    expect(await starknetLandedNonce(LANDED, readerFor(fixture("receipt null")))).toEqual({ refused: true, code: "starknet/not-found" });
    expect(await starknetLandedNonce(LANDED, readerFor(fixture("a ReaderError")))).toEqual({ refused: true, code: "starknet/unreadable" });
  });

  // starknetLandedNonce reads the transaction the ref names by its felt hash and finds the transfer by the ref's asset
  // and identity digest. A ref without them in that form cannot name what the call reads, so it is refused as a ref the
  // call cannot read, with nothing read. A felt is 0x and hex digits below the STARK prime 2^251 + 17·2^192 + 1
  // (docs.starknet.io, "Cryptography"); the digest is 32 bytes.
  it("starknetLandedNonce: a ref whose transaction or asset is not a felt, or whose idDigest is not a 32-byte hash, is wrong-reader, with nothing read", async () => {
    const prime = "0x800000000000011000000000000000000000000000000000000000000000001";
    const rows: [string, unknown][] = [
      ["transaction", undefined],
      ["transaction", 5],
      ["transaction", LANDED.transaction.slice(2)],
      ["transaction", prime],
      ["asset", undefined],
      ["asset", LANDED.asset.slice(2)],
      ["asset", prime],
      ["idDigest", undefined],
      ["idDigest", LANDED.idDigest.slice(2)],
      ["idDigest", `0x${LANDED.idDigest.slice(4)}`],
    ];
    for (const [key, value] of rowsOf(rows, "the malformed transaction, asset and idDigest values", { exact: 10 })) {
      const { reader, calls } = counting(readerFor(V.landed.landedNonce));
      expect([key, value, await starknetLandedNonce({ ...LANDED, [key]: value }, reader)]).toEqual([
        key,
        value,
        { refused: true, code: "starknet/wrong-reader" },
      ]);
      expect(calls).toEqual([]);
    }
    const upper = { ...LANDED, transaction: `0x${LANDED.transaction.slice(2).toUpperCase()}` };
    expect(await starknetLandedNonce(upper, readerFor(V.landed.landedNonce))).toBe(V.landed.landedNonce.expect);
  });

  // A refusal names no finality, so a revert, no matching transfer, or transfers under two nonces read from a receipt
  // that is not accepted, or that names no block, is a read to repeat; from an accepted receipt it is the verdict.
  it("starknetLandedNonce gives a verdict only from a receipt accepted on L2 or L1, and starknet/not-final before", async () => {
    const landed = V.landed.landedNonce;
    const accepted = landed.receipt;
    const pending = [
      { ...accepted, finality: "PRE_CONFIRMED", blockNumber: null },
      { ...accepted, finality: "PRE_CONFIRMED" },
      { ...accepted, blockNumber: null },
    ];
    const none = fixture("the execute and its transfer under a reverted call, the receipt still listing the transfer").trace!;
    const execute: StarknetInvocation = landed.trace.calls[0];
    const other: StarknetInvocation = { ...execute, calldata: execute.calldata.map((c, i) => (i === 1 ? "0x1" : c)) };
    const twoNonces = { ...landed.trace, calls: [execute, other] };
    const reverted = { ...accepted, execution: "REVERTED" };
    const rows: [string, Rec, StarknetInvocation, string][] = [
      ["a reverted transaction", reverted, landed.trace, "starknet/reverted"],
      ["no matching transfer", accepted, none, "starknet/no-transfer"],
      ["transfers under two nonces", accepted, twoNonces, "starknet/ambiguous"],
    ];
    for (const [what, receipt, trace, code] of rowsOf(rows, "the verdicts starknetLandedNonce reads", { exact: 3 })) {
      expect([what, await starknetLandedNonce(LANDED, readerFor({ receipt, trace }))]).toEqual([what, { refused: true, code }]);
      for (const p of pending) {
        const r = receipt === reverted ? { ...p, execution: "REVERTED" } : p;
        expect([what, r.finality, r.blockNumber, await starknetLandedNonce(LANDED, readerFor({ receipt: r, trace }))]).toEqual([
          what,
          r.finality,
          r.blockNumber,
          { refused: true, code: "starknet/not-final" },
        ]);
      }
    }
    for (const p of pending) expect(await starknetLandedNonce(LANDED, readerFor({ receipt: p, trace: landed.trace }))).toBe(landed.expect);
  });

  // The trace walk reads 16 levels and 512 invocations. A trace beyond them is read no further: from an accepted
  // receipt it holds no transfer the call reads, and from a pre-confirmed one it is a read to repeat. An invocation that
  // is not well formed is a reader answer out of its documented form.
  it("starknetLandedNonce reads a trace within 16 levels and 512 invocations, and refuses one beyond them as no-transfer", async () => {
    const landed = V.landed.landedNonce;
    const pre = { ...landed.receipt, finality: "PRE_CONFIRMED", blockNumber: null };
    const execute: StarknetInvocation = landed.trace.calls[0];
    const transfer: StarknetInvocation = execute.calls[0]!;
    const frame = (calls: StarknetInvocation[]): StarknetInvocation => ({ contract: LANDED.asset, selector: landed.trace.selector, calldata: [], reverted: false, calls });
    // The root is level 1 and the execute level 2, so n frames between the execute and the transfer put it at n + 3.
    const deep = (n: number) => {
      let below: StarknetInvocation = transfer;
      for (let i = 0; i < n; i++) below = frame([below]);
      return { ...landed.trace, calls: [{ ...execute, calls: [below] }] };
    };
    // The root, the execute and the transfer are three invocations; n calls beside the execute make n + 3.
    const filler: StarknetInvocation = { contract: "0x777", selector: "0x1", calldata: [], reverted: false, calls: [] };
    const wide = (n: number) => ({ ...landed.trace, calls: [...Array(n).fill(filler), execute] });
    for (const trace of rowsOf([deep(13), wide(509)], "traces at the bounds", { exact: 2 })) {
      expect(await starknetLandedNonce(LANDED, readerFor({ receipt: landed.receipt, trace }))).toBe(landed.expect);
    }
    for (const trace of rowsOf([deep(14), wide(510)], "traces one past the bounds", { exact: 2 })) {
      expect(await starknetLandedNonce(LANDED, readerFor({ receipt: landed.receipt, trace }))).toEqual({ refused: true, code: "starknet/no-transfer" });
      expect(await starknetLandedNonce(LANDED, readerFor({ receipt: pre, trace }))).toEqual({ refused: true, code: "starknet/not-final" });
    }
    const malformed = { ...landed.trace, calls: [{ ...execute, calls: [{ ...transfer, calldata: "0x1" }] }] } as never;
    for (const receipt of [landed.receipt, pre]) {
      expect(await starknetLandedNonce(LANDED, readerFor({ receipt, trace: malformed }))).toEqual({ refused: true, code: "starknet/unreadable" });
    }
  });

  it("starknetLandedNonce: a ref whose idDigest is in upper case reads the same", async () => {
    const upper = { ...LANDED, idDigest: `0x${LANDED.idDigest.slice(2).toUpperCase()}` };
    expect(await starknetLandedNonce(upper, readerFor(V.landed.landedNonce))).toBe(V.landed.landedNonce.expect);
    expect(FELT_P.toString(16)).toBe("800000000000011000000000000000000000000000000000000000000000001");
    expect(SELECTOR_EXECUTE_FROM_OUTSIDE_V2).toBe(V.S1.expectSelectorExecuteFromOutsideV2);
  });

  // The typed data is measured as JSON within the package's one nesting bound, 64 levels (vectors/core-vectors.json
  // `jsonDepth`), the typedData object counting 1. Objects with numeric member names, as JSON.parse builds them, are
  // what V8 writes by recursion, so the deepest are answered by the bound and not by the host's stack. A value JSON
  // cannot write (a bigint, a cycle) is malformed typed data.
  it("bound measures the typed data within the JSON nesting bound, and refuses what JSON cannot write", async () => {
    const p = await pay();
    const oe = p.payload.outsideExecution;
    const withX = (x: unknown) => ({ ...p, payload: { ...p.payload, outsideExecution: { ...oe, typedData: { ...oe.typedData, x } } } }) as never;
    const levels = (n: number) => JSON.parse('{"1":'.repeat(n - 1) + "[]" + "}".repeat(n - 1));
    const malformed = { refused: true, code: "starknet/typed-data-malformed" };
    expect(await exactStarknet.bound(withX(levels(63)))).toBe(V.S4.expectBound);
    for (const n of [64, 1000, 100_000]) expect(await exactStarknet.bound(withX(levels(n)))).toEqual(malformed);
    const cycle: { [k: string]: unknown } = {};
    cycle["self"] = cycle;
    for (const x of [1n, cycle]) expect(await exactStarknet.bound(withX(x))).toEqual(malformed);
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of rowsOf(V.agreedRefusals.rows, "x402-exact-starknet.json agreedRefusals.rows")) {
      const want = { refused: true, code: row.expect };
      if (row.option !== undefined) {
        const d: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.option] };
        expect([row.case, exactStarknet.advertise(d, H, V.fixed.link, row.option)]).toEqual([row.case, want]);
        expect(pairingOf(row.option)).toBeUndefined();
      } else if (row.from !== undefined) {
        expect(await exactStarknet.build({ required: advertised(), accepted: O, from: row.from, now: V.fixed.now }, H)).toEqual(want);
      } else if (row.signatureLengths !== undefined) {
        const u = await exactStarknet.build({ required: advertised(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
        if ("refused" in u) throw new Error(u.code);
        for (const n of rowsOf(row.signatureLengths, "the signatureLengths row's lengths")) expect(u.complete(Array(n).fill("0x1"))).toEqual(want);
      } else if (row.revision !== undefined) {
        const p = structuredClone(await pay());
        (p.payload.outsideExecution.typedData.domain as { revision: number }).revision = row.revision;
        expect(await exactStarknet.bound(p)).toEqual(want);
      } else if (row.chainId !== undefined) {
        const p = structuredClone(await pay());
        (p.payload.outsideExecution.typedData.domain as { chainId: string }).chainId = row.chainId;
        expect(await exactStarknet.bound(p)).toEqual(want);
      } else {
        throw new Error(`no runner for ${row.case}`);
      }
    }
  });
});

describe("floor: the agreement's floor", () => {
  it("is 0 on a token shown to emit a Transfer for a transfer of zero on the network given, and 1 base unit on any other", () => {
    type Row = { case: string; asset: string; network?: "starknet:SN_MAIN" | "starknet:SN_SEPOLIA"; expect: string };
    for (const row of rowsOf<Row>(V.floor.rows, "x402-exact-starknet.json floor.rows")) {
      const expected = /^[0-9]+$/.test(row.expect) ? BigInt(row.expect) : { refused: true, code: row.expect };
      const input = row.network === undefined ? { asset: row.asset } : { asset: row.asset, network: row.network };
      expect([row.case, starknetFloor(input)]).toEqual([row.case, expected]);
    }
  });
});
