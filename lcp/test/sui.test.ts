// Expected values come from vectors/x402-exact-sui.json: its V2 bytes and recipe R, a real testnet
// transaction read over GraphQL, Python's hashlib Blake2b digests, and Sui's GraphQL schema for the endpoint's
// available range; and from @mysten/sui 2.35.0, which builds a transaction and gives its digest. Nothing here is a
// snapshot of this code.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bcs } from "@mysten/sui/bcs";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { fromBase58, toBase58, toBase64 } from "@mysten/sui/utils";
import { ReaderError } from "../src/evm.js";
import { pairingOf } from "../src/index.js";
import { decodeSuiTx, exactSui, suiCarrier, type SuiReader, type SuiRef } from "../src/sui.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-sui.json", import.meta.url), "utf8"));
const H: `0x${string}` = V.fixed.H;
const O = V.fixed.O;
const LINK: string = V.fixed.link;
const REQUIRED: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const TX: Record<string, string> = {
  V1: V.V1.tx.transactionBase64,
  V2: V.V2.tx.transactionBase64,
  ...Object.fromEntries(Object.entries(V.search as Record<string, { transactionBase64: string }>).map(([k, v]) => [k, v.transactionBase64])),
};
const POSITION = BigInt(V.V4.position);
/** The query of V4's rows: the act payment at the one mark, after V4's position. */
const Q = { act: "payment", finality: "final", after: POSITION } as const;
const UNPARSEABLE = { state: "unreadable", reason: "unparseable", foreign: [] };
/**
 * Recipe R settled with no balance change: its signed transfer, command 1, names the payee, and moved nothing the
 * effects show, so what moved is that transfer of zero (the profile, rule 9).
 */
const settledAt = (digest: string, checkpoint: string) => ({
  state: "settled",
  transaction: digest,
  position: checkpoint,
  finality: "final",
  foreign: [],
  moved: [{ asset: "0x2::sui::SUI", amount: "0", to: O.payTo, transaction: digest, place: 1 }],
  signer: V.fixed.sender,
  presented: "yes",
});
const GAP = { state: "unreadable", reason: "history-gap", foreign: [] };
const LIVE = { state: "pending", reason: "instrument-live", foreign: [] };
/** The recover input for a digest. */
const input = (network: string, digest: unknown) => ({ network, tx: digest, option: O }) as never;

function bytesOf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function payment(transaction: string, accepted = O) {
  return { x402Version: 2, accepted, payload: { signature: "AAAA", transaction } };
}

type Change = { owner: string; coinType: string; amount: string };
type Answer = { tx: string; status: "SUCCESS" | "FAILURE"; checkpoint: string | null; balanceChanges?: Change[]; digest?: string } | null;
type Page = { transactions: NonNullable<Answer>[]; hasNextPage: boolean; endCursor: string | null };

/** An executed transaction as the reader gives it, its balance changes none where the row gives none. */
function executed(a: NonNullable<Answer>) {
  return {
    transactionBcs: bytesOf(TX[a.tx]!),
    status: a.status,
    checkpoint: a.checkpoint === null ? null : BigInt(a.checkpoint),
    balanceChanges: (a.balanceChanges ?? []).map((c) => ({ ...c, amount: BigInt(c.amount) })),
  };
}

/**
 * A scripted reader. `firstCheckpoint` is the endpoint's available range's first checkpoint; null states none.
 * `searchRange` is the range it states for the sender filter, and `pages` the search's pages in order; `searches`
 * records the `afterCheckpoint` of each page asked.
 */
function reader(
  network: string,
  answer: Answer | "error",
  epoch = "1234",
  firstCheckpoint: string | null = null,
  search: { searchRange?: { first: string; last: string; epoch: string }; pages?: Page[] } = {},
): SuiReader & { calls: number; searches: bigint[]; asked: { sender: string; before: bigint }[] } {
  const r = {
    network: network as SuiReader["network"],
    calls: 0,
    searches: [] as bigint[],
    asked: [] as { sender: string; before: bigint }[],
    async read() {
      r.calls++;
      if (answer === "error") throw new ReaderError("timeout");
      const range = search.searchRange;
      return {
        tx: answer === null ? null : executed(answer),
        epoch: BigInt(epoch),
        firstCheckpoint: firstCheckpoint === null ? null : BigInt(firstCheckpoint),
        ...(range === undefined ? {} : { searchRange: { first: BigInt(range.first), last: BigInt(range.last), epoch: BigInt(range.epoch) } }),
      };
    },
    async search(sender: string, after: bigint, before: bigint) {
      const page = search.pages?.[r.searches.length];
      r.searches.push(after);
      r.asked.push({ sender, before });
      if (page === undefined) throw new ReaderError("timeout");
      return {
        transactions: page.transactions.map((t) => ({ ...executed(t), digest: t.digest ?? V.search[t.tx]?.digest ?? V.V2.tx.digest })),
        hasNextPage: page.hasNextPage,
        endCursor: page.endCursor,
      };
    },
  };
  return r;
}

function refOf(v: { network: string; digest: string; untilEpoch: string | null; h: string }): SuiRef & { h: `0x${string}` } {
  return {
    network: v.network as SuiRef["network"],
    payee: O.payTo,
    sender: V.fixed.sender,
    digest: v.digest,
    untilEpoch: v.untilEpoch,
    h: v.h as `0x${string}`,
  };
}

/** A reference as the issuer stores it: through JSON, which throws on a bigint. The round trip must change nothing. */
function throughJson<T>(v: T): T {
  const back = JSON.parse(JSON.stringify(v)) as T;
  expect(back).toEqual(v);
  return back;
}

function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/** Recipe R, with the expiration `Epoch(epoch)`. */
async function recipeR(epoch: number | string): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.setSender(V.fixed.sender);
  tx.pure(bytesOf(Buffer.from(H.slice(2), "hex").toString("base64")));
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(10000)]);
  tx.transferObjects([coin!], tx.pure.address(V.fixed.payTo));
  tx.setGasPrice(1000);
  tx.setGasBudget(5000000);
  tx.setGasPayment([]);
  tx.setExpiration({ Epoch: epoch });
  return tx.build();
}

describe("recipe R", () => {
  it("@mysten/sui 2.35.0 builds the vector's V2 bytes", async () => {
    expect(Buffer.from(await recipeR(1234)).toString("base64")).toBe(V.V2.tx.transactionBase64);
  });
});

// Sui's epoch is a u64 (`EpochId`), so `Epoch(e)` takes any value up to 2^64 - 1. @mysten/sui builds such a
// transaction, writing e as the last eight bytes, little-endian, and gives its digest.
describe("an Epoch expiration above 2^53 - 1", () => {
  for (const e of ["9007199254740993", "18446744073709551615"]) {
    it(`Epoch(${e}) decodes to that epoch, and the reference records it`, async () => {
      const bytes = await recipeR(e);
      const tail = Buffer.alloc(8);
      tail.writeBigUInt64LE(BigInt(e));
      expect(Buffer.from(bytes.subarray(bytes.length - 8)).equals(tail)).toBe(true);
      const b64 = Buffer.from(bytes).toString("base64");
      const tx = decodeSuiTx(b64);
      if ("refused" in tx) throw new Error(tx.code);
      expect(tx.untilEpoch).toBe(BigInt(e));
      expect(tx.digest).toBe(TransactionDataBuilder.getDigestFromBytes(bytes));
      expect(suiCarrier(tx)).toBe(H);
      expect(throughJson(await exactSui.reference(payment(b64), O))).toEqual({
        network: O.network,
        payee: O.payTo,
        sender: V.fixed.sender,
        digest: tx.digest,
        untilEpoch: e,
      });
    });
  }
  it("the same bytes with one byte appended are not TransactionData", async () => {
    const bytes = await recipeR("9007199254740993");
    const longer = Buffer.concat([bytes, Uint8Array.of(0)]).toString("base64");
    expect(decodeSuiTx(longer)).toEqual({ refused: true, code: "sui/tx-malformed" });
  });
});

// Sui's transaction checks refuse a type with a node at depth 16, the outermost node at depth 1: the protocol
// config's `max_type_argument_depth` is 16 in every version, and sui-types' `type_input_validity_check` requires each
// node's depth below it for a call's type arguments and a vector's element type; a funds withdrawal's `Balance<T>`
// holds at most 16 nodes (`max_accumulator_type_nodes`), so its T holds at most 15 (MystenLabs/sui 2d56d0e,
// crates/sui-protocol-config/src/lib.rs, crates/sui-types/src/transaction.rs and accumulator_root.rs). @mysten/sui
// 2.35.0 writes each transaction; its one type is then written by hand, as BCS writes a TypeTag (a
// vector is the byte 0x06 before its element type, `u8` is 0x01), so that building the deepest ones reads no stack.
describe("a type nested to Sui's type depth limit", () => {
  const ADDR = `0x${"11".repeat(32)}`;
  const pure = { Pure: { bytes: bytesOf(Buffer.from(H.slice(2), "hex").toString("base64")) } };
  const serialize = (inputs: unknown[], commands: unknown[]) =>
    Buffer.from(
      bcs.TransactionData.serialize({
        V1: {
          kind: { ProgrammableTransaction: { inputs, commands } },
          sender: ADDR,
          gasData: { payment: [], owner: ADDR, price: "1000", budget: "5000000" },
          expiration: { None: true },
        },
      } as never).toBytes(),
    );
  const shapes: Record<string, (type: string) => Buffer> = {
    "a call's type argument": (type) =>
      serialize([pure], [{ MoveCall: { package: "0x2", module: "m", function: "f", typeArguments: [type], arguments: [] } }]),
    "a vector's element type": (type) => serialize([pure], [{ MakeMoveVec: { type, elements: [] } }]),
    "a funds withdrawal's type": (type) =>
      serialize(
        [pure, { FundsWithdrawal: { reservation: { MaxAmountU64: "1" }, typeArg: { Balance: type }, withdrawFrom: { Sender: true } } }],
        [],
      ),
  };
  /**
   * The transaction with its one type replaced by `vector<…<u8>>` with `levels` nodes: the type's byte is the one byte
   * in which the transaction with a `u16` type (0x08) and with a `u32` type (0x09) differ.
   */
  const nested = (shape: (type: string) => Buffer, levels: number): string => {
    const a = shape("u16");
    const b = shape("u32");
    const at = a.findIndex((x, i) => x !== b[i]);
    expect([a.length, a[at], b[at], a.subarray(at + 1).equals(b.subarray(at + 1))]).toEqual([b.length, 0x08, 0x09, true]);
    const type = Buffer.concat([Buffer.alloc(levels - 1, 0x06), Uint8Array.of(0x01)]);
    return Buffer.concat([a.subarray(0, at), type, a.subarray(at + 1)]).toString("base64");
  };
  const vectors = (n: number, inner: string) => `${"vector<".repeat(n)}${inner}${">".repeat(n)}`;
  for (const [name, shape] of Object.entries(shapes)) {
    it(`${name}: 15 levels decode and carry H; 16, 1,000 and 20,000 are sui/tx-malformed`, async () => {
      expect(nested(shape, 15)).toBe(shape(vectors(14, "u8")).toString("base64"));
      const ok = decodeSuiTx(nested(shape, 15));
      if ("refused" in ok) throw new Error(ok.code);
      expect(suiCarrier(ok)).toBe(H);
      for (const levels of [16, 1000, 20_000]) {
        expect(decodeSuiTx(nested(shape, levels))).toEqual({ refused: true, code: "sui/tx-malformed" });
        expect(await exactSui.bound(payment(nested(shape, levels)))).toEqual({ refused: true, code: "sui/tx-malformed" });
      }
    });
  }
  // Sui's TransactionKind lists ProgrammableSystemTransaction tenth from zero, with a programmable transaction's body
  // (MystenLabs/sui 2d56d0e, crates/sui-types/src/transaction.rs): the same bytes with that tag are that kind.
  it("another kind is sui/not-programmable at every depth of its types", () => {
    const call = shapes["a call's type argument"]!;
    for (const levels of [15, 16, 1000, 20_000]) {
      const system = Buffer.from(nested(call, levels), "base64");
      expect([system[0], system[1]]).toEqual([0, 0]);
      system[1] = 10;
      expect(decodeSuiTx(system.toString("base64"))).toEqual({ refused: true, code: "sui/not-programmable" });
    }
  });
  it("a struct's type parameters sit one level below it, each counted on its own", async () => {
    const call = shapes["a call's type argument"]!;
    const S = "0x0000000000000000000000000000000000000000000000000000000000000002::m::S";
    const at15 = `${S}<u8, ${vectors(13, "u8")}>`;
    const at16 = `${S}<u8, ${vectors(14, "u8")}>`;
    const deepFirst = `${S}<${vectors(14, "u8")}, u8>`;
    expect(suiCarrier(decodeSuiTx(call(at15).toString("base64")) as never)).toBe(H);
    expect(suiCarrier(decodeSuiTx(call(`${S}<${S}<${vectors(12, "u8")}>>`).toString("base64")) as never)).toBe(H);
    for (const type of [at16, deepFirst, `${S}<${S}<${vectors(13, "u8")}>>`]) {
      expect(decodeSuiTx(call(type).toString("base64"))).toEqual({ refused: true, code: "sui/tx-malformed" });
    }
  });
  // Each `u8` type argument is one byte, so a call in a transaction of 128 KiB, `max_tx_size_bytes`, can carry more
  // than 130,000 of them. The types are read one by one, in constant stack, so the answer does not depend on this
  // host's stack. The test has no time bound (0): how long @mysten/sui takes to write the transaction depends only on
  // the machine.
  it("a call with as many u8 type arguments as 128 KiB holds decodes and carries H", async () => {
    const call = (n: number) =>
      serialize([pure], [{ MoveCall: { package: "0x2", module: "m", function: "f", typeArguments: Array(n).fill("u8"), arguments: [] } }]);
    // The count's ULEB128 takes three bytes from 16,384 type arguments on, two more than it takes for none.
    const n = 128 * 1024 - call(0).length - 2;
    const tx = call(n);
    expect([n > 130_000, tx.length]).toEqual([true, 128 * 1024]);
    const decoded = decodeSuiTx(tx.toString("base64"));
    if ("refused" in decoded) throw new Error(decoded.code);
    expect(suiCarrier(decoded)).toBe(H);
    expect(decodeSuiTx(call(n + 1).toString("base64"))).toEqual({ refused: true, code: "sui/tx-too-large" });
  }, 0);
});

describe("V1 · the real rail", () => {
  it("decodes to the chain's digest; every input is used", async () => {
    const tx = decodeSuiTx(V.V1.tx.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.bytes.length).toBe(V.V1.tx.bytes);
    expect(tx.digest).toBe(V.V1.tx.digest);
    expect(tx.digest).toBe("EV7D7z9gjzjrAQSKWSW8S1iLGdk8aEVPjn3zLA1aUSLE");
    expect(tx.untilEpoch).toBe(V.V1.expectUntilEpoch);
    expect(await exactSui.bound(payment(V.V1.tx.transactionBase64))).toEqual({ refused: true, code: V.V1.expectBound });
  });
});

describe("V2 · carried", () => {
  it("bound gives H; reference gives the digest and the epoch", async () => {
    const tx = decodeSuiTx(V.V2.tx.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.bytes.length).toBe(V.V2.tx.bytes);
    expect(tx.digest).toBe(V.V2.tx.digest);
    expect(suiCarrier(tx)).toBe(H);
    const p = payment(V.V2.tx.transactionBase64);
    expect(await exactSui.bound(p)).toBe(V.V2.expectBound);
    const ref = throughJson(await exactSui.reference(p, O));
    expect(ref).toEqual(V.V2.expectReference);
    const r = reader(V.V4.ref.network, { tx: "V2", status: "SUCCESS", checkpoint: "7" });
    expect(plain(await exactSui.status({ ...(ref as SuiRef), h: H }, r, Q))).toEqual(settledAt(V.V2.tx.digest, "7"));
  });
});

describe("the Validity expiration", () => {
  for (const row of rowsOf(V.validity.rows, "x402-exact-sui.json validity.rows")) {
    it(row.case, async () => {
      const tx = decodeSuiTx(row.tx.transactionBase64);
      if ("refused" in tx) throw new Error(tx.code);
      expect(tx.bytes.length).toBe(row.tx.bytes);
      expect(tx.digest).toBe(row.tx.digest);
      const p = payment(row.tx.transactionBase64);
      expect(await exactSui.bound(p)).toBe(row.expectBound);
      const ref = await exactSui.reference(p, O);
      if (typeof row.expectReference === "string") expect(ref).toEqual({ refused: true, code: row.expectReference });
      else expect(throughJson(ref)).toEqual(row.expectReference);
    });
  }
});

describe("V3 · refusals", () => {
  for (const row of rowsOf(V.V3, "x402-exact-sui.json V3")) {
    it(row.case, async () => {
      const b64 = row.zeroBytes !== undefined ? Buffer.alloc(row.zeroBytes).toString("base64") : row.tx.transactionBase64;
      if (row.tx !== undefined) {
        const tx = decodeSuiTx(b64);
        if ("refused" in tx) throw new Error(tx.code);
        expect(tx.bytes.length).toBe(row.tx.bytes);
        expect(tx.digest).toBe(row.tx.digest);
      }
      const bound = await exactSui.bound(payment(b64));
      expect(bound).toEqual(row.expectBound.startsWith("0x") ? row.expectBound : { refused: true, code: row.expectBound });
      if (typeof row.expectReference === "string") {
        expect(await exactSui.reference(payment(b64), O)).toEqual({ refused: true, code: row.expectReference });
      } else if (row.expectReference !== undefined) {
        expect(throughJson(await exactSui.reference(payment(b64), O))).toEqual(row.expectReference);
      }
    });
  }
});

describe("V4 · status and recover", () => {
  for (const row of rowsOf(V.V4.status, "x402-exact-sui.json V4.status")) {
    it(`status: ${row.case}`, async () => {
      const own = row.tx === undefined ? {} : { digest: V.search[row.tx].digest, untilEpoch: row.untilEpoch };
      const ref = refOf({ ...V.V4.ref, network: row.refNetwork ?? V.V4.ref.network, ...own });
      const network = row.readerNetwork ?? V.V4.ref.network;
      const r = reader(network, row.readerError ? "error" : row.answer, row.epoch, row.firstCheckpoint ?? null, row);
      const q = { ...Q, ...row.query, ...(row.query?.search === undefined ? {} : { search: BigInt(row.query.search) }) };
      expect(plain(await exactSui.status(ref, r, q))).toEqual(row.expect);
      expect(r.calls).toBeLessThanOrEqual(1);
      if (row.expectSearchFrom !== undefined) expect(r.searches[0]).toBe(BigInt(row.expectSearchFrom));
      if (row.expectSearches !== undefined) expect(r.searches).toHaveLength(row.expectSearches);
      // The search reads the reference's sender, from the position given or the search's own, to one past its head.
      if (r.searches.length > 0) expect(r.searches[0]).toBe(BigInt(row.query?.search ?? V.V4.position));
      for (const asked of r.asked) expect(asked).toEqual({ sender: V.fixed.sender, before: BigInt(row.searchRange.last) + 1n });
    });
  }
  // SuiReader: the answer's firstCheckpoint is a bigint or null; anything else is a malformed answer, and status takes
  // a non-negative bigint position as `after`. Unreadable `unparseable` is the answer to a malformed read or query; a
  // query with no position shows no history, so an absent transaction past its bound is never expired.
  it("status: a firstCheckpoint that is neither a bigint nor null, or a position that is not a non-negative bigint", async () => {
    const ref = refOf(V.V4.ref);
    for (const firstCheckpoint of [undefined, "5", 5]) {
      const r = {
        network: "sui:testnet" as const,
        async read() {
          return { tx: null, epoch: 1235n, firstCheckpoint } as never;
        },
        async search(): Promise<never> {
          throw new Error("no search");
        },
      };
      expect(await exactSui.status(ref, r, Q)).toEqual(UNPARSEABLE);
      expect(await exactSui.recover(input(ref.network, ref.digest), r)).toEqual({ refused: true, code: "sui/unreadable" });
    }
    for (const position of [undefined, 5, "5", -1n]) {
      const r = reader(V.V4.ref.network, null, "1235", "0");
      const got = await exactSui.status(ref, r, { ...Q, after: position } as never);
      expect([position, got, r.calls]).toEqual(position === undefined ? [position, GAP, 1] : [position, UNPARSEABLE, 0]);
    }
  });
  // Sui's `TransactionExpiration::None` sets no epoch after which validators refuse the transaction, so an absent one
  // can still execute: the reference records a null bound, and no epoch makes it expired.
  it("status: a reference with no epoch bound is never expired", async () => {
    const unbounded = V.V3.find((r: { case: string }) => r.case.startsWith("setExpiration"));
    const ref = refOf({ ...V.V4.ref, digest: unbounded.tx.digest, untilEpoch: null });
    for (const epoch of ["1235", "18446744073709551615"]) {
      const r = reader(V.V4.ref.network, null, epoch, "0");
      expect(await exactSui.status(ref, r, Q)).toEqual(LIVE);
      expect(r.calls).toBe(1);
    }
    // Past its bound with the history shown, the bounded one lapsed; the endpoint states no range for the sender filter,
    // so the search for H cannot be read: history-gap (read-status rule 24; the profile, rule 14).
    const bounded = reader(V.V4.ref.network, null, "1235", "0");
    expect(await exactSui.status(refOf(V.V4.ref), bounded, Q)).toEqual(GAP);
    const landed = {
      transactionBcs: bytesOf(unbounded.tx.transactionBase64),
      status: "SUCCESS" as const,
      checkpoint: 9n,
      balanceChanges: [],
    };
    const r = {
      network: "sui:testnet" as const,
      async read() {
        return { tx: landed, epoch: 99n, firstCheckpoint: 0n };
      },
      async search(): Promise<never> {
        throw new Error("no search");
      },
    };
    expect(plain(await exactSui.status(ref, r, Q))).toEqual(settledAt(unbounded.tx.digest, "9"));
  });
  it("status: an untilEpoch that is neither a decimal string below 2^64 nor null is unreadable unparseable", async () => {
    for (const untilEpoch of [undefined, "", "-1", "18446744073709551616", 1234]) {
      const r = reader(V.V4.ref.network, null, "1235", "0");
      const ref = { ...refOf(V.V4.ref), untilEpoch } as never;
      expect(await exactSui.status(ref, r, Q)).toEqual(UNPARSEABLE);
      expect(r.calls).toBe(0);
    }
  });
  // A Sui transaction digest is base58 of its 32-byte Blake2b-256 (the vector's V1 digest, read from the chain, and V2's,
  // from Python's hashlib); docs/guides/rails.md, "Reading settlement": a reference holding a field status reads the
  // payment by, or compares it with, in another form is unreadable, with nothing read. Each row's reader would
  // otherwise answer the row's expect.
  const digest: string = V.V4.ref.digest;
  const bytes = fromBase58(digest);
  const badDigests: unknown[] = [undefined, null, 1, {}, [], "", "x", `0${digest.slice(1)}`, `l${digest.slice(1)}`];
  badDigests.push(toBase58(bytes.subarray(1)), `1${digest}`, toBase58(Uint8Array.from([...bytes, 7])));
  badDigests.push(`0x${Buffer.from(bytes).toString("hex")}`, toBase64(bytes), digest.toLowerCase(), `${digest}1`.repeat(40));
  it("status: a ref whose digest is not base58 of 32 bytes, or whose h is not 0x and 64 hex digits, is unreadable", async () => {
    const badHashes: unknown[] = [undefined, null, 1, {}, [], "", "0x12", H.slice(0, 64), `${H}00`, H.slice(2), `0X${H.slice(2)}`];
    badHashes.push(`0xg${H.slice(3)}`);
    const rows = [...rowsOf(V.V4.status, "x402-exact-sui.json V4.status"), V.plant];
    for (const [key, forms] of [["digest", badDigests], ["h", badHashes]] as const) {
      for (const row of rows) {
        for (const v of forms) {
          const r = reader(V.V4.ref.network, row.readerError ? "error" : row.answer, row.epoch, row.firstCheckpoint ?? null);
          const ref = { ...refOf(V.V4.ref), [key]: v } as never;
          const got = await exactSui.status(ref, r, Q);
          expect([row.case, key, v, got, r.calls]).toEqual([row.case, key, v, UNPARSEABLE, 0]);
        }
      }
    }
  });
  it("recover: a ref whose digest is not base58 of 32 bytes is sui/wrong-reader, with nothing read", async () => {
    const answers: Answer[] = [{ tx: "V2", status: "SUCCESS", checkpoint: "7" }, { tx: "V2", status: "FAILURE", checkpoint: "7" }, null];
    for (const answer of answers) {
      for (const v of badDigests) {
        const r = reader(V.V4.ref.network, answer);
        const got = await exactSui.recover(input(V.V4.ref.network, v), r);
        expect([answer, v, got, r.calls]).toEqual([answer, v, { refused: true, code: "sui/wrong-reader" }, 0]);
      }
    }
  });
  for (const row of rowsOf(V.V4.recover, "x402-exact-sui.json V4.recover")) {
    it(`recover: ${row.case}`, async () => {
      const r = reader(V.V4.ref.network, row.answer);
      const got = await exactSui.recover(input(V.V4.ref.network, row.digest), r);
      expect(got).toEqual(row.expect.startsWith("0x") ? row.expect : { refused: true, code: row.expect });
    });
  }
  // A transaction's digest is the Blake2b-256 of its intent-prefixed bytes (@mysten/sui's
  // TransactionDataBuilder.getDigestFromBytes), so bytes under their own digest are the transaction the reference names,
  // and a later read gives the same bytes. Bytes decodeSuiTx refuses as text are refused by recover with the same code
  // (V2's bytes with one byte appended are not TransactionData; Sui's TransactionKind tag 10 is
  // ProgrammableSystemTransaction, MystenLabs/sui 2d56d0e crates/sui-types/src/transaction.rs), and status answers
  // them unreadable unparseable: a transaction found by the digest whose bytes do not decode releases nothing (the
  // profile x402-exact-sui.md, rule 10).
  it("recover: bytes under their own digest that do not decode give decodeSuiTx's refusal", async () => {
    const v2 = Buffer.from(TX["V2"]!, "base64");
    const system = Buffer.from(v2);
    expect([system[0], system[1]]).toEqual([0, 0]);
    system[1] = 10;
    const rows: [string, Uint8Array, string][] = [
      ["V2's bytes with one byte appended", Buffer.concat([v2, Uint8Array.of(0)]), "sui/tx-malformed"],
      ["V2's bytes with the kind tag of a programmable system transaction", system, "sui/not-programmable"],
    ];
    for (const [what, bytes, code] of rowsOf(rows, "bytes that do not decode", { exact: 2 })) {
      expect([what, decodeSuiTx(Buffer.from(bytes).toString("base64"))]).toEqual([what, { refused: true, code }]);
      const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
      const r: SuiReader = {
        network: V.V4.ref.network,
        read: async () => ({ tx: { transactionBcs: Uint8Array.from(bytes), status: "SUCCESS", checkpoint: 7n, balanceChanges: [] }, epoch: 1234n, firstCheckpoint: null }),
        search: async () => {
          throw new Error("no search");
        },
      };
      expect([what, await exactSui.recover(input(V.V4.ref.network, digest), r)]).toEqual([what, { refused: true, code }]);
      expect([what, await exactSui.status(refOf({ ...V.V4.ref, digest }), r, Q)]).toEqual([what, UNPARSEABLE]);
    }
  });
  it("recover: a reader for another network, a failed read, and no transaction", async () => {
    const ref = input("sui:mainnet", V.V2.tx.digest);
    expect(await exactSui.recover(ref, reader("sui:testnet", null))).toEqual({ refused: true, code: "sui/wrong-reader" });
    const t = input("sui:testnet", V.V2.tx.digest);
    expect(await exactSui.recover(t, reader("sui:testnet", "error"))).toEqual({ refused: true, code: "sui/unreadable" });
    expect(await exactSui.recover(t, reader("sui:testnet", null))).toEqual({ refused: true, code: "sui/not-found" });
    const failed = reader("sui:testnet", { tx: "V2", status: "FAILURE", checkpoint: "7" });
    expect(await exactSui.recover(t, failed)).toEqual({ refused: true, code: "sui/aborted" });
  });
});

describe("plant", () => {
  it("an aborted transaction with V2's digest and bytes is never settled", async () => {
    const r = reader(V.V4.ref.network, V.plant.answer, V.plant.epoch, V.plant.firstCheckpoint, V.plant);
    expect(plain(await exactSui.status(refOf(V.V4.ref), r, Q))).toEqual(V.plant.expect);
  });
  it("status on the act agreement, at the settled checkpoint, with no position, and recover with an option that is not an object", async () => {
    const r = () => reader(V.V4.ref.network, V.V4.status[0].answer, "1234");
    const settled = V.V4.status[0].expect;
    expect(plain(await exactSui.status(refOf(V.V4.ref), r(), { ...Q, act: "agreement" }))).toEqual(settled);
    expect(plain(await exactSui.status(refOf(V.V4.ref), r(), { act: "payment", finality: "final" }))).toEqual(settled);
    // The settled transaction at its own checkpoint is at the position given: before-position (read-status rule 16).
    expect(plain(await exactSui.status(refOf(V.V4.ref), r(), { ...Q, after: 7n }))).toEqual({
      state: "failed",
      reason: "before-position",
      transaction: V.V4.ref.digest,
      position: "7",
      finality: "final",
      foreign: [],
      moved: settled.moved,
      signer: settled.signer,
    });
    for (const option of [undefined, null, "option"]) {
      const got = await exactSui.recover({ network: V.V4.ref.network, tx: V.V4.ref.digest, option } as never, r());
      expect(got).toEqual({ refused: true, code: "sui/wrong-reader" });
    }
  });
});

describe("the pairing's filter", () => {
  it("takes the three named networks and the option's forms", () => {
    const pays = (o: PaymentRequirements) => pairingOf(o) === "x402/exact/sui";
    expect(pays(O)).toBe(true);
    for (const network of ["sui:mainnet", "sui:devnet"]) expect(pays({ ...O, network })).toBe(true);
    expect(pays({ ...O, extra: { paymentFlow: "authorization" } })).toBe(true);
    expect(pays({ ...O, extra: { paymentFlow: "upfront" } })).toBe(false);
    expect(pays({ ...O, extra: { assetTransferMethod: "eip3009" } })).toBe(false);
    expect(pays({ ...O, payTo: O.payTo.toUpperCase().replace("0X", "0x") })).toBe(false);
    expect(pays({ ...O, asset: "SUI" })).toBe(false);
    expect(pays({ ...O, amount: "18446744073709551616" })).toBe(false);
    expect(pays({ ...O, amount: "18446744073709551615" })).toBe(true);
    expect(pays({ ...O, network: "eip155:84532" })).toBe(false);
  });
  it("refuses an unnamed sui network as network-malformed", async () => {
    expect(await exactSui.bound(payment(V.V2.tx.transactionBase64, { ...O, network: "sui:localnet" }))).toEqual({
      refused: true,
      code: "sui/network-malformed",
    });
  });
});

describe("x402-exact-sui.json filter: the gas path and the agreement's zero", () => {
  for (const row of rowsOf(V.filter.rows, "x402-exact-sui.json filter.rows")) {
    it(row.case, () => {
      const extra = row.change.extra === undefined ? {} : { extra: row.change.extra };
      const o: PaymentRequirements = { ...O, ...(row.change.amount === undefined ? {} : { amount: row.change.amount }), ...extra };
      const got = exactSui.advertise({ ...REQUIRED, accepts: [o] }, H, LINK, o);
      expect([pairingOf(o) === "x402/exact/sui", "refused" in got ? got.code : true]).toEqual([row.expect === true, row.expect]);
    });
  }
});

describe("x402-exact-sui.json sponsored: complete holds the signed transaction to the one sent to the gas station", () => {
  const o: PaymentRequirements = { ...O, extra: { gasStation: V.sponsored.gasStation } };
  for (const row of rowsOf(V.sponsored.rows, "x402-exact-sui.json sponsored.rows")) {
    it(row.case, async () => {
      const required = exactSui.advertise({ ...REQUIRED, accepts: [o] }, H, LINK, o);
      if ("refused" in required) throw new Error(required.code);
      const u = await exactSui.build({ required, accepted: o }, H);
      if ("refused" in u) throw new Error(u.code);
      const got = u.complete({ signature: "AAAA", transaction: row.returned }, row.sent === null ? undefined : V.sponsored.sent);
      expect("refused" in got ? got.code : got.payload.transaction === row.returned).toEqual(row.expect);
    });
  }
});

describe("advertise, read, build and complete", () => {
  it("advertise writes only extensions.legalContext; read gives H, the link and the option", () => {
    const doc = exactSui.advertise(REQUIRED, H, LINK, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts).toEqual([O]);
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: LINK });
    const r = exactSui.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: LINK, options: [O] });
    expect(exactSui.advertise(REQUIRED, H, "http://atr.seller.example/x", O)).toEqual({
      refused: true,
      code: "x402/link-not-https",
    });
  });

  it("build asks the wallet for one unused Pure input holding H; complete accepts only a payment bound to H", async () => {
    const doc = exactSui.advertise(REQUIRED, H, LINK, O) as PaymentRequired;
    const u = await exactSui.build({ required: doc, accepted: O }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("sui-transaction");
    expect(u.request.expiration).toBe("epoch-bounded");
    expect(Buffer.from(u.request.pureInput).toString("hex")).toBe(H.slice(2));
    const signed = u.complete({ signature: "AAAA", transaction: V.V2.tx.transactionBase64 });
    if ("refused" in signed) throw new Error(signed.code);
    expect(signed).toEqual({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: O,
      payload: { signature: "AAAA", transaction: V.V2.tx.transactionBase64 },
      extensions: doc.extensions,
    });
    expect(u.complete({ signature: "AAAA", transaction: V.V1.tx.transactionBase64 })).toEqual({
      refused: true,
      code: "x402/signed-not-bound",
    });
    const unbounded = V.V3.find((r: { case: string }) => r.case.startsWith("setExpiration")).tx.transactionBase64;
    expect(u.complete({ signature: "AAAA", transaction: unbounded })).toEqual({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: O,
      payload: { signature: "AAAA", transaction: unbounded },
      extensions: doc.extensions,
    });
  });

  // x402's Sui scheme defines `payload.signature` as a string, the user's signature over the transaction, and
  // states no length; the package never verifies it.
  it("bound takes a string signature of any length, and refuses an empty or non-string one", async () => {
    const transaction = V.V2.tx.transactionBase64;
    const signed = (signature: unknown) => ({ ...payment(transaction), payload: { signature, transaction } });
    for (const signature of ["A".repeat(8193), "A".repeat(65536)]) expect(await exactSui.bound(signed(signature))).toBe(H);
    for (const signature of ["", 7, null, undefined]) {
      expect(await exactSui.bound(signed(signature))).toEqual({
        refused: true,
        code: "x402/signature-malformed",
      });
    }
  });

  it("the pattern states what the record proves", () => {
    expect(exactSui.pattern).toMatchObject({
      pattern: "native-field",
      profile: "x402/exact/sui",
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
    });
    expect(exactSui.data.carrier.signed).not.toBeNull();
    expect(exactSui.data.coverage).toBe("full");
    expect(exactSui.claims).toBe(true);
    expect(exactSui.unplaced(O)).toBe(O);
  });
});

type RefusalRow = { case: string; transaction?: { $repeat: [string, number] } | string; expect: string };

// The agreedRefusals row whose transaction is written {"$repeat": [s, n]}: s repeated n times, each s four UTF-16 code
// units and three code points. Its length is counted in UTF-16 code units, as the about states.
describe("x402-exact-sui.json agreedRefusals: a transaction beyond the BMP over the decoded bound", () => {
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-sui.json agreedRefusals.rows", {
    exact: 1,
    keep: ["the row whose transaction is an object with $repeat", (r) => typeof r.transaction === "object"],
    leave: [
      "the row whose transaction is text, run by the describe block below, and the rows that give no transaction, run by base64.test.ts, sui-peer-missing.test.ts and the runner at the end of this file",
      (r) => typeof r.transaction === "string" || r.transaction === undefined,
    ],
  }) as (RefusalRow & { transaction: { $repeat: [string, number] } })[];
  it("one row, whose text is 174764 UTF-16 code units and 131073 code points", () => {
    expect(rows).toHaveLength(1);
    const [s, n] = rows[0]!.transaction!.$repeat;
    const text = s.repeat(n);
    expect([text.length, [...text].length]).toEqual([174764, 131073]);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      const [s, n] = r.transaction!.$repeat;
      expect(await decodeSuiTx(s.repeat(n))).toEqual({ refused: true, code: r.expect });
    });
  }
});

// The agreedRefusals rows whose transaction is a string: the text as given.
describe("x402-exact-sui.json agreedRefusals: a transaction given as text", () => {
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-sui.json agreedRefusals.rows", {
    exact: 1,
    keep: ["the row whose transaction is text", (r) => typeof r.transaction === "string"],
    leave: [
      "the row whose transaction is an object with $repeat, run by the describe block above, and the rows that give no transaction, run by base64.test.ts, sui-peer-missing.test.ts and the runner at the end of this file",
      (r) => typeof r.transaction === "object" || r.transaction === undefined,
    ],
  }) as (RefusalRow & { transaction: string })[];
  it("one row", () => {
    expect(rows).toHaveLength(1);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      expect(decodeSuiTx(r.transaction)).toEqual({ refused: true, code: r.expect });
      expect(await exactSui.bound(payment(r.transaction))).toEqual({ refused: true, code: r.expect });
    });
  }
});

// Each agreedRefusals row that gives no transaction, run from the vector's own data: V2's transaction with one part
// changed, V1's transaction and answer, the option O and its document. The rows that give a transaction run in the two
// describe blocks above, the row for text that is not padded standard base64 in base64.test.ts, and the row for a
// missing @mysten/sui in sui-peer-missing.test.ts.
describe("x402-exact-sui.json agreedRefusals: every row that gives no transaction runs", () => {
  const elsewhere = (r: RefusalRow) =>
    r.case.startsWith("a transaction that is not padded standard base64") || r.expect === "sui/peer-missing";
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-sui.json agreedRefusals.rows", {
    keep: ["the rows that give no transaction, run below", (r) => r.transaction === undefined && !elsewhere(r)],
    leave: [
      "the rows that give a transaction, run by the two describe blocks above; the row for text that is not padded standard base64, run by base64.test.ts; and the row for a missing @mysten/sui, run by sui-peer-missing.test.ts",
      (r) =>
        typeof r.transaction === "string" ||
        (typeof r.transaction === "object" && "$repeat" in r.transaction) ||
        elsewhere(r),
    ],
  });
  const v2 = bytesOf(V.V2.tx.transactionBase64);
  const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
  /** V2's TransactionData, parsed: recipe R, whose first input is the unused Pure input that holds H. */
  const parsedV2 = () => {
    const data = bcs.TransactionData.parse(v2);
    if (data.$kind !== "V1" || data.V1.kind.$kind !== "ProgrammableTransaction") throw new Error("V2 is not programmable");
    const pureH = { $kind: "Pure", Pure: { bytes: b64(Buffer.from(H.slice(2), "hex")) } };
    expect(data.V1.kind.ProgrammableTransaction.inputs[0]).toEqual(pureH);
    return { data, ptb: data.V1.kind.ProgrammableTransaction };
  };
  /** V2's transaction with its first input, the unused Pure input, holding `pure` in place of H. */
  const withPure = (pure: Uint8Array): string => {
    const { data, ptb } = parsedV2();
    ptb.inputs[0] = { $kind: "Pure", Pure: { bytes: b64(pure) } };
    return b64(bcs.TransactionData.serialize(data).toBytes());
  };
  /** The SHA-256 of the empty string (FIPS 180-2): a hash other than H. */
  const OTHER = Buffer.from("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "hex");

  const cases: Record<string, () => Promise<unknown[]>> = {
    "one unused Pure input that is not exactly 32 bytes": async () => {
      const h = Buffer.from(H.slice(2), "hex");
      const out: unknown[] = [];
      for (const pure of [h.subarray(0, 31), Buffer.concat([h, Uint8Array.of(0)]), new Uint8Array(0)]) {
        const tx = decodeSuiTx(withPure(pure));
        if ("refused" in tx) throw new Error(tx.code);
        expect(tx.unusedPure.map((b) => b.length)).toEqual([pure.length]);
        out.push(suiCarrier(tx), await exactSui.bound(payment(withPure(pure))));
      }
      return out;
    },
    // Trailing: V2 with one byte appended. Non-canonical: V2 with its input count, 3, written as the two-byte ULEB128
    // 0x83 0x00, which @mysten/bcs 2.1.2 refuses as it parses; and V2 with a MoveCall appended whose type argument is a
    // struct named `S<u8>`, which parses, and which @mysten/sui writes back as the struct S with the type parameter u8.
    "bytes that parse as TransactionData but do not serialise back to themselves (trailing or non-canonical bytes)":
      async () => {
        expect(v2[2]).toBe(3);
        const { data, ptb } = parsedV2();
        ptb.commands.push({
          $kind: "MoveCall",
          MoveCall: { package: "0x2", module: "m", function: "f", typeArguments: ["0x2::m::Sabcd"], arguments: [] },
        });
        const renamed = Buffer.from(bcs.TransactionData.serialize(data).toBytes());
        const at = renamed.indexOf("Sabcd");
        expect([at > 0, renamed.indexOf("Sabcd", at + 1)]).toEqual([true, -1]);
        renamed.write("S<u8>", at);
        const trailing = Buffer.concat([v2, Uint8Array.of(0)]);
        const longCount = Buffer.concat([v2.subarray(0, 2), Uint8Array.of(0x83, 0x00), v2.subarray(3)]);
        expect(() => bcs.TransactionData.parse(trailing)).not.toThrow();
        expect(() => bcs.TransactionData.parse(longCount)).toThrow("non-canonical");
        expect(() => bcs.TransactionData.parse(renamed)).not.toThrow();
        const out: unknown[] = [];
        for (const bytes of [trailing, longCount, renamed]) {
          out.push(decodeSuiTx(b64(bytes)), await exactSui.bound(payment(b64(bytes))));
        }
        return out;
      },
    "an option with scheme exact and a sui: network other than mainnet, testnet or devnet": async () => {
      const out: unknown[] = [];
      for (const network of ["sui:localnet", "sui:Testnet", "sui:"]) {
        const o = { ...O, network };
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [o] };
        out.push(
          await exactSui.bound(payment(V.V2.tx.transactionBase64, o)),
          await exactSui.reference(payment(V.V2.tx.transactionBase64, o), o),
          await exactSui.build({ required: doc, accepted: o }, H),
          exactSui.advertise(doc, H, LINK, o),
        );
      }
      return out;
    },
    "payload.signature not a string, or empty": async () => {
      const transaction = V.V2.tx.transactionBase64;
      const out: unknown[] = [];
      for (const signature of [7, null, undefined, ["AAAA"], ""]) {
        const p = { ...payment(transaction), payload: { signature, transaction } };
        out.push(await exactSui.bound(p), await exactSui.reference(p, O));
      }
      return out;
    },
    "payload.transaction not a string": async () => {
      const out: unknown[] = [];
      for (const transaction of [7, null, undefined, Array.from(v2)]) {
        const p = { ...payment(""), payload: { signature: "AAAA", transaction } };
        out.push(await exactSui.bound(p), await exactSui.reference(p, O));
      }
      return out;
    },
    // V1's answer, read for V2's digest: its bytes hash to V1's digest.
    "recover on an answer for another digest, even one that failed": async () => {
      const answer: Exclude<Answer, null> = V.V4.recover.find((r: { answer: { tx: string } }) => r.answer.tx === "V1").answer;
      const ref = input(V.V4.ref.network, V.V2.tx.digest);
      return [
        await exactSui.recover(ref, reader(V.V4.ref.network, answer)),
        await exactSui.recover(ref, reader(V.V4.ref.network, { ...answer, status: "FAILURE" })),
      ];
    },
    // Built for H: V1's transaction, whose bound refuses, and V2's with another hash in its unused Pure input.
    "complete with a payload whose bound is not the built hash": async () => {
      const doc = exactSui.advertise(REQUIRED, H, LINK, O) as PaymentRequired;
      const u = await exactSui.build({ required: doc, accepted: O }, H);
      if ("refused" in u) throw new Error(u.code);
      const other = withPure(OTHER);
      expect(await exactSui.bound(payment(other))).toBe(`0x${OTHER.toString("hex")}`);
      return [
        u.complete({ signature: "AAAA", transaction: V.V1.tx.transactionBase64 }),
        u.complete({ signature: "AAAA", transaction: other }),
      ];
    },
  };

  it("names a case for every row it runs, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual({ refused: true, code: row.expect });
    });
  }
});
