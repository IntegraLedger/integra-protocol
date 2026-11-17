// Expected values come from vectors/x402-exact-cardano.json: cbor2 and pycardano encodings, a real preprod
// transaction read through Koios, Python's hashlib Blake2b digests, x402's Cardano scheme for the TTL and the
// confirmation depth, and cardano-ledger's validity interval for the TTL slot. Nothing here is a snapshot of this code.
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/core.js";
import { readFileSync } from "node:fs";
import { ReaderError } from "../src/evm.js";
import {
  LCP_MARKER,
  auxiliaryData,
  cardanoFloor,
  decodeCardanoTx,
  exactCardano,
  exactCardanoLock,
  type CardanoReader,
  type CardanoRef,
} from "../src/cardano.js";
import { CRED, REF_INPUT, addressOf, bech, credOf, inputN, masumiDatum, readerOf, refFor, txOf, type World } from "./cardano-world.js";
import { pairingOf } from "../src/index.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { UNSHOWN, SCRIPT_RAN, arrangeOn, declaredFor, forms as cardanoForms, runsOnScript } from "./read-kit/forms/cardano.js";
import { READ_STATUS, leftOutByData, runCase } from "./read-kit/harness.js";
import { blake2b } from "@noble/hashes/blake2.js";
import * as cborg from "cborg";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-cardano.json", import.meta.url), "utf8"));
/** V8's protocol parameter, the one `advertise` takes on the address method. */
const COINS_PER_UTXO_BYTE = BigInt(V.V8.coinsPerUtxoByte);
const H: `0x${string}` = V.fixed.H;
const O = V.fixed.O;
const LINK: string = V.fixed.link;
const TX: Record<string, string> = { V2: V.V2.transactionBase64, V3: V.V3.transactionBase64 };
function payment(transaction: string, accepted = O) {
  return { x402Version: 2, accepted, payload: { transaction, nonce: V.fixed.nonce } };
}

function bytesOf(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

type Tip = { blockHeight: string; slot: string };
type OnChain = { blockHeight: string; slot: string; valid: boolean } | { notFound: true; slot: string } | null;

/**
 * A scripted reader. `slotAt` answers `deep`'s slot at `deep`'s height, and null (no block held) at any other. A `tx`
 * of null is a lookup that finds nothing from an indexer at the tip's slot.
 */
function reader(
  tip: Tip,
  tx: OnChain | "error",
  cbor?: string,
  network = "cardano:preprod",
  deep?: Tip,
): CardanoReader & { calls: number; heights: bigint[] } {
  const unread = async (): Promise<never> => {
    throw new Error("recover reads the transaction alone");
  };
  const r = {
    network: network as CardanoReader["network"],
    securityParam: unread,
    output: unread,
    inputAddresses: unread,
    credentialTransactions: unread,
    calls: 0,
    heights: [] as bigint[],
    async tip() {
      r.calls++;
      if (tx === "error") throw new ReaderError("timeout");
      return { blockHeight: BigInt(tip.blockHeight), slot: BigInt(tip.slot) };
    },
    async slotAt(blockHeight: bigint) {
      r.calls++;
      r.heights.push(blockHeight);
      return deep !== undefined && BigInt(deep.blockHeight) === blockHeight ? BigInt(deep.slot) : null;
    },
    async transaction(_id: `0x${string}`, withCbor: boolean) {
      r.calls++;
      if (tx === "error") throw new ReaderError("timeout");
      if (tx === null) return { notFound: true as const, slot: BigInt(tip.slot) };
      if ("notFound" in tx) return { notFound: true as const, slot: BigInt(tx.slot) };
      return {
        blockHeight: BigInt(tx.blockHeight),
        slot: BigInt(tx.slot),
        valid: tx.valid,
        ...(withCbor && cbor !== undefined ? { cbor: bytesOf(cbor) } : {}),
      };
    },
  };
  return r;
}

/** recover's input for the transaction id, under the vector's option. */
function input(txId: string, network = "cardano:preprod") {
  return { network: network as CardanoRef["network"], tx: txId, option: O };
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

function refused(code: string) {
  return { refused: true, code };
}

describe("V1 · the auxiliary data", () => {
  it("is cbor2's and pycardano's 95 bytes", () => {
    const a = auxiliaryData(H);
    if ("refused" in a) throw new Error(a.code);
    expect(a.length).toBe(V.V1.bytes);
    expect(Buffer.from(a).toString("hex")).toBe(V.V1.auxiliaryDataHex);
    expect(LCP_MARKER).toBe("lcp:sha256:0x");
  });

  // The interface: "No function throws"; a value that is not a hash is x402's `payload-malformed`, as in `build`.
  it("a value that is not a 32-byte hash is refused, not thrown", () => {
    for (const bad of ["0x12", H.slice(2)] as unknown as AtrHash[]) {
      expect(auxiliaryData(bad)).toEqual(refused("x402/payload-malformed"));
    }
  });
});

describe("V2 · bound and reference", () => {
  it("bound gives H; reference gives the id and the TTL", async () => {
    const tx = await decodeCardanoTx(V.V2.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.txId).toBe(V.V2.expectReference.txId);
    expect(await exactCardano.bound(payment(V.V2.transactionBase64))).toBe(V.V2.expectBound);
    expect(throughJson(await exactCardano.reference(payment(V.V2.transactionBase64), O))).toEqual(V.V2.expectReference);
  });
  it("a CIP-34 alias is normalised", async () => {
    const r = await exactCardano.reference(payment(V.V2.transactionBase64, { ...O, network: "cip34:0-1" }), O);
    expect(throughJson(r)).toEqual(V.V2.expectReference);
  });
  it("reference refuses an option with no payTo as x402/option-malformed", async () => {
    expect(await exactCardano.reference(payment(V.V2.transactionBase64), {} as PaymentRequirements)).toEqual(
      refused("x402/option-malformed"),
    );
  });
  // x402's Cardano scheme: the nonce is "a UTXO reference (`txHash#index`) that is also one of the transaction's
  // inputs", which the facilitator checks (verification rule 5). bound reads the signed body and its metadata only.
  it("bound takes a string nonce of any length; reference takes only an input the body spends; a nonce that is not a string is refused", async () => {
    const withNonce = (nonce: unknown) => ({
      ...payment(V.V2.transactionBase64),
      payload: { transaction: V.V2.transactionBase64, nonce },
    });
    for (const nonce of ["n".repeat(257), "n".repeat(4096), `${"11".repeat(32)}#1`, `${"22".repeat(32)}#0`]) {
      expect(await exactCardano.bound(withNonce(nonce))).toBe(V.V2.expectBound);
      expect(await exactCardano.reference(withNonce(nonce), O)).toEqual(refused("cardano/nonce-not-input"));
    }
    expect(throughJson(await exactCardano.reference(withNonce(`${"11".repeat(32).toUpperCase()}#0`), O))).toEqual(V.V2.expectReference);
    for (const nonce of [7, null, undefined]) {
      expect(await exactCardano.bound(withNonce(nonce))).toEqual(refused("x402/payload-malformed"));
    }
  });
});

describe("V3 · the real rail", () => {
  it("the id is the body's hash; the message carries no hash; no TTL", async () => {
    const tx = await decodeCardanoTx(V.V3.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.txId).toBe(V.V3.txId);
    expect(tx.ttlSlot).toBeNull();
    expect(await exactCardano.bound(payment(V.V3.transactionBase64))).toEqual(refused(V.V3.expectBound));
    expect(await exactCardano.reference(payment(V.V3.transactionBase64), O)).toEqual(refused(V.V3.expectReference));
  });
});

describe("V4 · refusals", () => {
  for (const row of rowsOf(V.V4, "x402-exact-cardano.json V4")) {
    it(row.case, async () => {
      const accepted = row.network !== undefined ? { ...O, network: row.network } : O;
      expect(await exactCardano.bound(payment(row.transactionBase64, accepted))).toEqual(refused(row.expectBound));
    });
  }
  it("a transaction over 64 KiB", async () => {
    expect(await decodeCardanoTx(Buffer.alloc(64 * 1024 + 1).toString("base64"))).toEqual(refused("cardano/tx-too-large"));
  });
  it("nesting deeper than 64", async () => {
    const deep = Buffer.concat([Buffer.alloc(70, 0x81), Buffer.from([0x00])]).toString("base64");
    expect(await decodeCardanoTx(deep)).toEqual(refused("cardano/tx-malformed"));
  });
});

// The read over a constructed ledger (test/cardano-world.ts, every answer constructed and marked so): security
// parameter 10, the tip at height 1100, 20 slots a block, the position given 1000. The read kit's common cases run
// through the same read in test/read-kit/forms/cardano.ts; these are the cases particular to Cardano's read.
describe("status over a constructed ledger", () => {
  const TTL = 1200n * 20n;
  const pay = (over: Partial<Parameters<typeof txOf>[0]> = {}) =>
    txOf({ inputs: [REF_INPUT], outputs: [{ to: "payee", coin: 2000000n }, { to: "payer", coin: 5n }], h: H, ttl: TTL, ...over });
  const P = pay();
  const at = (t: { bytes: Uint8Array }, height: bigint, valid = true, holders: ("payer" | "payee" | "other")[] = ["payer"]) => ({
    bytes: t.bytes,
    height,
    valid,
    holders,
  });
  const world = (over: Partial<World> = {}): World => ({
    k: 10n,
    tip: 1100n,
    held: 900n,
    genesis: true,
    txs: new Map(),
    output: { address: bech(addressOf("payer")), slot: 1100n * 20n },
    listed: [],
    through: 1100n,
    ...over,
  });
  const q = (act: "payment" | "agreement" = "payment", more: object = {}) => ({ act, finality: 10n, after: 1000n, ...more });
  const read = async (w: World, ref: CardanoRef = refFor(P.id, H, "default", TTL), query: object = q()) =>
    plain(await (ref.method === "default" ? exactCardano : exactCardanoLock).status(ref, readerOf(w), query as never));

  it("settles on the presented body, presented yes, each output named by its index; a payee address with a stake part is the payee's", async () => {
    const S = pay({ outputs: [{ to: "payer", coin: 5n }, { to: addressOf("payee", 0x55), coin: 7n }] });
    for (const [body, output, amount] of [[P, 0, "2000000"], [S, 1, "7"]] as const) {
      const w = world({ txs: new Map([[body.id, at(body, 1050n)]]), output: { address: bech(addressOf("payer")), spentBy: body.id } });
      expect(await read(w, refFor(body.id, H, "default", TTL))).toMatchObject({
        state: "settled",
        transaction: body.id,
        presented: "yes",
        position: "1050",
        finality: "50",
        signer: credOf("payer"),
        moved: [{ asset: "lovelace", amount, to: credOf("payee"), transaction: body.id, place: output }],
      });
    }
  });
  it("a body the payer rebuilt from the same input settles, presented no; one paying another account settles an agreement, and holds a payment search-incomplete until the search is shown whole", async () => {
    const R = pay({ outputs: [{ to: "payee", coin: 1n }] });
    const X = pay({ outputs: [{ to: "other", coin: 1n }] });
    const spent = (b: { id: `0x${string}`; bytes: Uint8Array }) =>
      world({ txs: new Map([[b.id, at(b, 1050n)]]), output: { address: bech(addressOf("payer")), spentBy: b.id } });
    expect(await read(spent(R))).toMatchObject({ state: "settled", transaction: R.id, presented: "no" });
    expect(await read(spent(X))).toMatchObject({ state: "pending", reason: "search-incomplete", foreign: [{ transaction: X.id, reason: "other-account" }] });
    expect(await read(spent(X), undefined, q("agreement"))).toMatchObject({ state: "settled", transaction: X.id, presented: "no" });
  });
  it("an absent body past its TTL with the input unspent: search-incomplete, never instrument-unused, until a run shows a listing whole", async () => {
    const past = refFor(P.id, H, "default", 1090n * 20n);
    // Read to the tip, the search gives no position; stopped below it, it is held there.
    expect(await read(world(), past)).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
    expect(await read(world({ through: 1095n }), past)).toEqual({ state: "pending", reason: "search-incomplete", search: "1095", foreign: [] });
    // Past the tip's slot and not the final block's: below the final mark.
    expect(await read(world(), refFor(P.id, H, "default", 1095n * 20n))).toMatchObject({ state: "pending", reason: "below-mark" });
  });
  it("a body with no TTL is never instrument-unused: instrument-live while its input is unspent at the latest head", async () => {
    expect(await read(world(), refFor(P.id, H, "default"))).toMatchObject({ state: "pending", reason: "instrument-live" });
    // An indexer behind the tip read first has not read the input at the latest head.
    const behind = world({ output: { address: bech(addressOf("payer")), slot: 1099n * 20n } });
    expect(await read(behind, refFor(P.id, H, "default"))).toMatchObject({ state: "pending", reason: "search-incomplete" });
  });
  it("the presented body included with valid_contract false and its input unspent: instrument-live before the TTL, search-incomplete after", async () => {
    const F = pay({ valid: false, collateral: [inputN(9)] });
    const w = world({ txs: new Map([[F.id, at(F, 1050n, false)]]) });
    expect(await read(w, refFor(F.id, H, "default", TTL))).toMatchObject({ state: "pending", reason: "instrument-live" });
    expect(await read(w, refFor(F.id, H, "default", 1000n * 20n))).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });
  it("the presented body included with valid_contract false, its input taken as collateral, below the final mark: below-mark, naming it, having moved nothing", async () => {
    const F = pay({ valid: false, collateral: [REF_INPUT] });
    const w = world({ txs: new Map([[F.id, at(F, 1095n, false)]]), output: { address: bech(addressOf("payer")), spentBy: F.id } });
    expect(await read(w, refFor(F.id, H, "default", TTL))).toMatchObject({ state: "pending", reason: "below-mark", transaction: F.id, moved: [] });
  });
  it("a body from another input of the payer carrying H, found by the search, settles; above the final head it is below-mark", async () => {
    const A = pay({ inputs: [inputN(1)] });
    const past = refFor(P.id, H, "default", 1000n * 20n);
    for (const [height, want] of [[1080n, { state: "settled", transaction: A.id, presented: "no" }], [1095n, { state: "pending", reason: "below-mark", transaction: A.id }]] as const) {
      const w = world({ txs: new Map([[A.id, at(A, height)]]), listed: [{ txId: A.id, blockHeight: height }] });
      expect(await read(w, past)).toMatchObject(want);
    }
  });
  it("a listed transaction that does not decode is named and holds the search at it; the search resumes from the position given", async () => {
    const bad = `0x${"9a".repeat(32)}` as const;
    const A = pay({ inputs: [inputN(1)] });
    const past = refFor(P.id, H, "default", 1000n * 20n);
    const w = world({
      txs: new Map([[bad, { bytes: Uint8Array.from([0x80]), height: 1060n, valid: true, holders: [] }], [A.id, at(A, 1070n)]]),
      listed: [{ txId: bad, blockHeight: 1060n }, { txId: A.id, blockHeight: 1070n }],
    });
    // The search reads on past the item: an act found after it settles; with none, the answer holds at the item.
    expect(await read(w, past)).toMatchObject({ state: "settled", transaction: A.id });
    const alone = world({ txs: new Map([[bad, w.txs.get(bad)!]]), listed: [w.listed[0]!] });
    expect(await read(alone, past)).toMatchObject({ state: "pending", reason: "search-incomplete", search: "1059", undecoded: [bad] });
    expect(await read(w, past, q("payment", { search: 1060n }))).toMatchObject({ state: "settled", transaction: A.id });
    expect(await read(w, past, q("payment", { search: 1070n }))).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });
  it("history-gap where the endpoint holds no block at the position given", async () => {
    expect(await read(world({ held: 1001n }))).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });
  it("a Masumi lock pays where its escrow datum's seller (V7, the scheme's own vector) has the payee's payment credential", async () => {
    const datumBytes = Uint8Array.from(Buffer.from(V.V7.datumHex, "hex"));
    const L = pay({ outputs: [{ to: "escrow", coin: 3000000n, datumBytes }] });
    const w = world({ txs: new Map([[L.id, at(L, 1050n)]]), output: { address: bech(addressOf("payer")), spentBy: L.id } });
    const seller = new Uint8Array(28).fill(0x22);
    expect(V.V7.expectSeller).toBe(credOf(seller));
    expect(await read(w, { ...refFor(L.id, H, "masumi", TTL), payee: bech(addressOf(seller)) })).toMatchObject({
      state: "settled",
      moved: [{ asset: "lovelace", amount: "3000000", to: V.V7.expectSeller, transaction: L.id, place: 0 }],
    });
    const held = { state: "pending", reason: "search-incomplete" } as const;
    expect(await read(w, refFor(L.id, H, "masumi", TTL))).toMatchObject({ ...held, foreign: [{ transaction: L.id, reason: "other-account" }] });
    // On the address method the same transaction is a deposit, another pairing's act.
    expect(await read(w, refFor(L.id, H, "default", TTL))).toMatchObject({ ...held, foreign: [{ transaction: L.id, reason: "other-kind" }] });
  });
  // A script's address the payer controls, not the escrow, and another key of the payer's.
  const MINE = Uint8Array.from([0x70, ...new Uint8Array(28).fill(0x99)]);
  const OTHER_KEY = Uint8Array.from([0x60, ...new Uint8Array(28).fill(0x98)]);
  const spentBy = (b: { id: `0x${string}`; bytes: Uint8Array }, height = 1050n) =>
    world({ txs: new Map([[b.id, at(b, height)]]), output: { address: bech(addressOf("payer")), spentBy: b.id } });
  it("a Masumi lock's seller is read only from a deposit into the reference's escrow: a datum naming the seller anywhere else pays no one", async () => {
    const seller = masumiDatum(CRED.payee);
    const ref = (id: `0x${string}`) => refFor(id, H, "masumi", TTL);
    // A deposit into another script, its datum naming the seller; a key output carrying that datum beside one.
    const A = pay({ outputs: [{ to: MINE, coin: 1500000n, datum: seller }] });
    const B = pay({ outputs: [{ to: OTHER_KEY, coin: 1500000n, datum: seller }, { to: MINE, coin: 1500000n, datum: masumiDatum(CRED.other) }] });
    for (const b of [A, B]) {
      expect(await read(spentBy(b), ref(b.id))).toMatchObject({
        state: "pending",
        reason: "search-incomplete",
        foreign: [{ transaction: b.id, reason: "other-account" }],
      });
    }
    // Into the escrow it pays the seller; and a plain output to the seller's own credential is a transfer to the payee.
    const E = pay({ outputs: [{ to: "escrow", coin: 1500000n, datum: seller }] });
    const D = pay({ outputs: [{ to: "escrow", coin: 1500000n, datum: masumiDatum(CRED.other) }, { to: "payee", coin: 1500000n }] });
    expect(await read(spentBy(E), ref(E.id))).toMatchObject({ state: "settled", moved: [{ to: credOf("payee"), place: 0 }] });
    expect(await read(spentBy(D), ref(D.id))).toMatchObject({ state: "settled", moved: [{ to: credOf("other") }, { to: credOf("payee"), place: 1 }] });
  });
  it("the script lock: every act is of its kind, and item 3 tests it by payTo", async () => {
    const ref = (id: `0x${string}`) => ({ ...refFor(id, H, "script", TTL), payee: bech(addressOf("escrow")) });
    // To payTo, a script's address, with no datum and with one; and to a key-address payTo, a plain output.
    const S = pay({ outputs: [{ to: "escrow", coin: 1500000n }] });
    const T = pay({ outputs: [{ to: "escrow", coin: 1500000n, datum: [42] }] });
    const K = pay({ outputs: [{ to: "payee", coin: 1500000n }] });
    for (const [b, r] of [[S, ref(S.id)], [T, ref(T.id)], [K, refFor(K.id, H, "script", TTL)]] as const) {
      expect(await read(spentBy(b), r)).toMatchObject({ state: "settled", transaction: b.id, moved: [{ place: 0 }] });
    }
    // A deposit into another script pays another account.
    const O2 = pay({ outputs: [{ to: MINE, coin: 1500000n, datum: [42] }] });
    expect(await read(spentBy(O2), ref(O2.id))).toMatchObject({ state: "pending", reason: "search-incomplete", foreign: [{ transaction: O2.id, reason: "other-account" }] });
  });
  it("a payer whose address holds no payment credential (a Byron address) gives no search, so the read never answers failed", async () => {
    // A Byron address in base58, which holds no payment credential (the reader's contract).
    const BYRON = "Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi";
    const past = refFor(P.id, H, "default", 1000n * 20n);
    // The own id absent from a lookup that covers the tip, the TTL passed at the final mark, the input unspent.
    expect(await read(world({ output: { address: BYRON, slot: 1100n * 20n } }), past)).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
    // The input spent by a transaction that carries no H.
    const X = pay({ h: `0x${"cd".repeat(32)}` as AtrHash, outputs: [{ to: "other", coin: 1n }] });
    const spent = world({ txs: new Map([[X.id, at(X, 1050n)]]), output: { address: BYRON, spentBy: X.id } });
    expect(await read(spent, past)).toMatchObject({ state: "pending", reason: "search-incomplete" });
  });
  it("a listing a block behind the tip is read to its last page, and the search is held below the tip only after it", async () => {
    const past = refFor(P.id, H, "default", 1000n * 20n);
    const other = `0x${"cd".repeat(32)}` as AtrHash;
    const [N1, N2, N3] = [1, 2, 3].map((n) => pay({ inputs: [inputN(n)], h: other }));
    const A = pay({ inputs: [inputN(4)] });
    // Pages of two: the payer's act carrying H and paying the payee is on the second.
    const ledger = (third: { id: `0x${string}`; bytes: Uint8Array }) =>
      world({
        through: 1099n,
        txs: new Map([[N1!.id, at(N1!, 1060n)], [N2!.id, at(N2!, 1061n)], [third.id, at(third, 1062n)]]),
        listed: [{ txId: N1!.id, blockHeight: 1060n }, { txId: N2!.id, blockHeight: 1061n }, { txId: third.id, blockHeight: 1062n }],
      });
    expect(await read(ledger(A), past)).toMatchObject({ state: "settled", transaction: A.id, presented: "no" });
    expect(await read(ledger(N3!), past)).toEqual({ state: "pending", reason: "search-incomplete", search: "1099", foreign: [] });
  });
  it("an item the search could not decode never carries the search position past a range it did not read", async () => {
    const bad = `0x${"9b".repeat(32)}` as const;
    const past = refFor(P.id, H, "default", 1000n * 20n);
    // The input spent by a transaction that does not decode, at 1080; the listing named 1050 before its page.
    const w = world({
      txs: new Map([[bad, { bytes: Uint8Array.from([0x80]), height: 1080n, valid: true, holders: [] }]]),
      output: { address: bech(addressOf("payer")), spentBy: bad },
      through: 1050n,
    });
    expect(await read(w, past)).toMatchObject({ state: "pending", reason: "search-incomplete", search: "1050", undecoded: [bad] });
  });
});

describe("V6, V8 · the reference's members, a body with no TTL, the floor", () => {
  it("the address method names no TTL for a body that sets none; a lock refuses it", async () => {
    expect(throughJson(await exactCardano.reference(payment(V.V6.transactionBase64), O))).toEqual(V.V6.expectReference);
    const lock = { ...O, extra: { assetTransferMethod: "script" } };
    expect(await exactCardanoLock.reference(payment(V.V6.transactionBase64, lock), lock)).toEqual(refused(V.V6.expectLock));
  });
  it("reference refuses a presented accepted that is not the option it is given", async () => {
    expect(await exactCardano.reference(payment(V.V2.transactionBase64), { ...O, amount: "1" })).toEqual(refused("x402/accepted-not-option"));
  });
  it("a Masumi lock's payee is the seller extra.terms.sellerAddress names", async () => {
    const seller = bech(addressOf("payee"));
    const lock = { ...O, extra: { assetTransferMethod: "masumi", terms: { sellerAddress: seller } } };
    expect(await exactCardanoLock.reference(payment(V.V2.transactionBase64, lock), lock)).toMatchObject({ method: "masumi", payee: seller });
    const bare = { ...O, extra: { assetTransferMethod: "masumi" } };
    expect(await exactCardanoLock.reference(payment(V.V2.transactionBase64, bare), bare)).toEqual(refused("x402/option-malformed"));
  });
  it("the floor is the formula over the output's encoding, at the least coin that covers it", () => {
    for (const row of rowsOf(V.V8.rows, "x402-exact-cardano.json V8.rows")) {
      const asset = row.asset.endsWith(".") ? row.asset.slice(0, -1) + "." : row.asset;
      expect(cardanoFloor({ payTo: V.V8.payTo, asset, coinsPerUtxoByte: BigInt(V.V8.coinsPerUtxoByte) })).toBe(BigInt(row.expect));
    }
    for (const bad of [{ payTo: "addr1", asset: "lovelace", coinsPerUtxoByte: 4310n }, { payTo: V.V8.payTo, asset: "ada", coinsPerUtxoByte: 4310n }, { payTo: V.V8.payTo, asset: "lovelace", coinsPerUtxoByte: 0n }]) {
      expect(cardanoFloor(bad)).toEqual(refused("cardano/floor-input"));
    }
  });
  it("advertise on the address method evaluates the floor from coinsPerUtxoByte, given after the offer, and refuses a lovelace amount below it", () => {
    const floor = V.V8.rows.find((r: { asset: string }) => r.asset === "lovelace").expect as string;
    const at = (amount: string, cpub: bigint) => {
      const o = { ...O, amount };
      return exactCardano.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, LINK, o, cpub);
    };
    expect(at(floor, COINS_PER_UTXO_BYTE)).not.toHaveProperty("refused");
    expect(at((BigInt(floor) - 1n).toString(), COINS_PER_UTXO_BYTE)).toEqual(refused("cardano/amount-below-floor"));
    expect(at(floor, 0n)).toEqual(refused("cardano/floor-input"));
    expect(at(floor, undefined as unknown as bigint)).toEqual(refused("cardano/floor-input"));
  });
});

describe("V5 · recover", () => {
  it("recover: wrong reader, failed read, absent, an answer of no documented shape, invalid, no cbor, and bytes for another id", async () => {
    const ref = input(V.V2.expectReference.txId);
    const ok0 = { blockHeight: "1", slot: "1", valid: true };
    for (const bad of [{ ...ref, tx: "0x12" }, { ...ref, option: null }, null]) {
      expect(await exactCardano.recover(bad as never, reader(V.V5.tip, ok0, TX["V2"]))).toEqual(refused("cardano/wrong-reader"));
    }
    const ok = { blockHeight: "1", slot: "1", valid: true };
    expect(await exactCardano.recover(ref, reader(V.V5.tip, ok, TX["V2"], "cardano:preview"))).toEqual(
      refused("cardano/wrong-reader"),
    );
    expect(await exactCardano.recover(ref, reader(V.V5.tip, "error"))).toEqual(refused("cardano/unreadable"));
    expect(await exactCardano.recover(ref, reader(V.V5.tip, null))).toEqual(refused("cardano/not-found"));
    const bare = { ...reader(V.V5.tip, null), transaction: async () => null as never };
    expect(await exactCardano.recover(ref, bare)).toEqual(refused("cardano/unreadable"));
    expect(await exactCardano.recover(ref, reader(V.V5.tip, { ...ok, valid: false }, TX["V2"]))).toEqual(
      refused("cardano/not-valid"),
    );
    expect(await exactCardano.recover(ref, reader(V.V5.tip, ok))).toEqual(refused("cardano/unreadable"));
    expect(await exactCardano.recover(ref, reader(V.V5.tip, ok, TX["V3"]))).toEqual(refused("cardano/unreadable"));
  });
});

describe("plant", () => {
  it("metadata the signed body does not commit to is refused, never read", async () => {
    const got = await exactCardano.bound(payment(V.plant.transactionBase64));
    expect(got).toEqual(refused(V.plant.expectBound));
    expect(got).not.toBe(H);
  });
});

describe("the pairing's filter, advertise, read, build and complete", () => {
  // x402's Cardano scheme (x402-foundation/x402 specs/schemes/exact/scheme_exact_cardano.md, blob c53d0185) lists
  // `"assetTransferMethods": ["default", "masumi", "script"]`, and its SDK's facilitator reads an option that names no
  // method as "default" (typescript/packages/mechanisms/cardano, exact/facilitator/scheme.ts).
  it("takes the named networks and their CIP-34 aliases; the address method and the two locks are two pairings", async () => {
    const pays = (o: PaymentRequirements) => pairingOf(o) === "x402/exact/cardano";
    for (const network of ["cardano:mainnet", "cardano:preview", "cip34:1-764824073", "cip34:0-2"]) {
      expect(pays({ ...O, network })).toBe(true);
    }
    for (const [m, id, codec] of [
      [undefined, "x402/exact/cardano", exactCardano],
      ["default", "x402/exact/cardano", exactCardano],
      ["script", "x402/exact/cardano/lock", exactCardanoLock],
      ["masumi", "x402/exact/cardano/lock", exactCardanoLock],
    ] as const) {
      const o = m === undefined ? O : { ...O, extra: { assetTransferMethod: m } };
      expect(pairingOf(o)).toBe(id);
      expect(await codec.bound(payment(V.V2.transactionBase64, o))).toBe(V.V2.expectBound);
    }
    // The published scheme sponsors no fee: an option that says it does names a member the pairing cannot honour.
    expect(pays({ ...O, extra: { areFeesSponsored: false } })).toBe(true);
    expect(pays({ ...O, extra: { areFeesSponsored: true } })).toBe(false);
    expect(pays({ ...O, extra: { assetTransferMethod: "eip3009" } })).toBe(false);
    expect(pays({ ...O, extra: { paymentFlow: "upfront" } })).toBe(false);
    expect(pays({ ...O, network: "cip34:0-4" })).toBe(false);
  });
  it("advertise and read; build asks for the auxiliary data; complete accepts only a payment bound to H", async () => {
    const required = exactCardano.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, LINK, O, COINS_PER_UTXO_BYTE);
    if ("refused" in required) throw new Error(required.code);
    const r = exactCardano.read(required as PaymentRequired);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: LINK, options: [O] });
    const u = await exactCardano.build({ required, accepted: O }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("cardano-transaction");
    expect(Buffer.from(u.request.auxiliaryData).toString("hex")).toBe(V.V1.auxiliaryDataHex);
    const signed = await u.complete({ transaction: V.V2.transactionBase64, nonce: V.fixed.nonce });
    if ("refused" in signed) throw new Error(signed.code);
    expect(signed).toEqual({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: O,
      payload: { transaction: V.V2.transactionBase64, nonce: V.fixed.nonce },
      extensions: required.extensions,
    });
    expect(await u.complete({ transaction: V.V3.transactionBase64, nonce: V.fixed.nonce })).toEqual(
      refused("x402/signed-not-bound"),
    );
  });
  it("the pattern states what the record proves", () => {
    expect(exactCardano.pattern).toMatchObject({
      pattern: "native-field",
      profile: "x402/exact/cardano",
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
    });
    expect(exactCardano.data.carrier.signed).not.toBeNull();
    expect(exactCardano.data.coverage).toBe("full");
    expect(exactCardano.claims).toBe(true);
  });
});

// The agreedRefusals row whose transaction is written {"$repeat": [s, n]}: s repeated n times, each s four UTF-16 code
// units and three code points. Its length is counted in UTF-16 code units, as the about states.
describe("x402-exact-cardano.json agreedRefusals: a transaction beyond the BMP over the decoded bound", () => {
  const rows = rowsOf(
    V.agreedRefusals.rows as { case: string; transaction?: { $repeat: [string, number] }; expect: string }[],
    "x402-exact-cardano.json agreedRefusals.rows",
    {
      exact: 1,
      keep: ["the row whose transaction is an object with $repeat", (r) => r.transaction !== undefined],
      leave: [
        "the rows that give no transaction, run by base64.test.ts and the runner at the end of this file",
        (r) => r.transaction === undefined,
      ],
    },
  );
  it("one row, whose text is 87384 UTF-16 code units and 65538 code points", () => {
    expect(rows).toHaveLength(1);
    const [s, n] = rows[0]!.transaction!.$repeat;
    const text = s.repeat(n);
    expect([text.length, [...text].length]).toEqual([87384, 65538]);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      const [s, n] = r.transaction!.$repeat;
      expect(await decodeCardanoTx(s.repeat(n))).toEqual({ refused: true, code: r.expect });
    });
  }
});

// Each agreedRefusals row that gives no transaction, run from the vector's own data: V2's transaction with one item
// changed (the items split and encoded again with cborg 6.1.3, each key 7 the Blake2b-256 of the auxiliary data it
// names), V1's auxiliary data, V4's rows that repeat a key or a label, V3's transaction, and V5's reference, tip and
// inclusion. The row whose transaction is an object with $repeat runs in the describe block above, and the row for text
// that is not padded standard base64 in base64.test.ts.
describe("x402-exact-cardano.json agreedRefusals: every row that gives no transaction runs", () => {
  type RefusalRow = { case: string; transaction?: { $repeat: [string, number] }; expect: string };
  const elsewhere = (r: RefusalRow) => r.case.startsWith("a transaction that is not padded standard base64");
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-cardano.json agreedRefusals.rows", {
    keep: ["the rows that give no transaction, run below", (r) => r.transaction === undefined && !elsewhere(r)],
    leave: [
      "the row whose transaction is an object with $repeat, run by the describe block above, and the row for text that is not padded standard base64, run by base64.test.ts",
      (r) => (typeof r.transaction === "object" && "$repeat" in r.transaction) || elsewhere(r),
    ],
  });
  const TAGS: cborg.TagDecoder[] = [];
  TAGS[259] = (decode) => decode();
  /** V2's four items as their bytes: the body, the witness set, the validity bool and the auxiliary data (V1's). */
  const v2Items = (): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] => {
    const all = bytesOf(V.V2.transactionBase64);
    expect(all[0]).toBe(0x84);
    const out: Uint8Array[] = [];
    let rest = all.subarray(1);
    while (rest.length > 0) {
      const [, after] = cborg.decodeFirst(rest, { useMaps: true, tags: TAGS });
      out.push(rest.subarray(0, rest.length - after.length));
      rest = after;
    }
    expect([out.length, out[0]![0], Buffer.from(out[3]!).toString("hex")]).toEqual([4, 0xa5, V.V1.auxiliaryDataHex]);
    return out as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  };
  const bodyOf = (b: Uint8Array) => cborg.decode(b, { useMaps: true }) as Map<number, unknown>;
  /** The transaction `[body, witnesses, valid, aux]`, base64. */
  const tx = (...four: Uint8Array[]) => Buffer.from([0x84, ...four.flatMap((i) => [...i])]).toString("base64");
  /** `body` with key 7 the Blake2b-256 of `aux`. */
  const committing = (body: Uint8Array, aux: Uint8Array) =>
    cborg.encode(new Map([...bodyOf(body), [7, blake2b(aux, { dkLen: 32 })]]));
  /** The SHA-256 of the empty string (FIPS 180-2): a hash other than H. */
  const OTHER = "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as const;
  /** What a row's expect states: a refusal code, or, for the status row, a read below the mark at no confirmations. */
  const wanted = (code: string) =>
    code === "below-mark with 0 confirmations"
      ? expect.objectContaining({ state: "pending", reason: "below-mark", finality: 0n })
      : refused(code);
  /** decodeCardanoTx's answer: its refusal, or the hash or refusal it reads from the metadata. */
  const decoded = async (t: string) => {
    const d = await decodeCardanoTx(t);
    return "refused" in d ? d : d.h;
  };

  const cases: Record<string, () => Promise<unknown[]>> = {
    // The body as an array of its entries; key 3 twice; a text key; key 3 as text; key 7 of 31 and 33 bytes and an
    // integer; and the third item null, then the integer 1.
    "a body that is not a map, duplicate or non-integer body keys, a non-integer key 3, key 7 not 32 bytes, or the third item not a bool":
      async () => {
        const [body, witnesses, valid, aux] = v2Items();
        const map = bodyOf(body);
        const entries = body.subarray(1);
        const key7 = map.get(7) as Uint8Array;
        const ttl = cborg.encode(map.get(3));
        const txs = [
          cborg.encode([...map.entries()]),
          Uint8Array.from([0xa6, ...entries, ...cborg.encode(3), ...ttl]),
          Uint8Array.from([0xa6, ...entries, ...cborg.encode("3"), ...ttl]),
          cborg.encode(new Map([...map, [3, String(map.get(3))]])),
          cborg.encode(new Map([...map, [7, key7.subarray(0, 31)]])),
          cborg.encode(new Map([...map, [7, Uint8Array.from([...key7, 0])]])),
          cborg.encode(new Map([...map, [7, 0]])),
        ].map((b) => tx(b, witnesses, valid, aux));
        txs.push(tx(body, witnesses, Uint8Array.of(0xf6), aux), tx(body, witnesses, Uint8Array.of(0x01), aux));
        const out: unknown[] = [];
        for (const t of txs) out.push(await decoded(t), await exactCardano.bound(payment(t)));
        return out;
      },
    "key 7 present with nil auxiliary data": async () => {
      const [body, witnesses, valid] = v2Items();
      expect(bodyOf(body).get(7)).toHaveLength(32);
      const t = tx(body, witnesses, valid, Uint8Array.of(0xf6));
      return [await decoded(t), await exactCardano.bound(payment(t))];
    },
    // V1's auxiliary data, #6.259({0: {674: …}}), as a byte string and under tag 258; and with label 675 for 674.
    "auxiliary data in none of the three metadata forms, or without label 674": async () => {
      const [body, witnesses, valid, aux] = v2Items();
      const hex = Buffer.from(aux).toString("hex");
      expect(hex.slice(0, 18)).toBe("d90103a100a11902a2");
      const out: unknown[] = [];
      const label675 = Buffer.from(`${hex.slice(0, 16)}a3${hex.slice(18)}`, "hex");
      for (const a of [cborg.encode(aux), Buffer.from(`d90102${hex.slice(6)}`, "hex"), label675]) {
        const t = tx(committing(body, a), witnesses, valid, a);
        out.push(await decoded(t), await exactCardano.bound(payment(t)));
      }
      return out;
    },
    "a label-674 map that repeats a key, or metadata that holds label 674 more than once": async () => {
      const out: unknown[] = [];
      for (const name of [
        "label 674 repeats the msg key, the carrier first",
        "label 674 repeats a key other than msg",
        "the metadata repeats label 674",
      ]) {
        const t: string = V.V4.find((r: { case: string }) => r.case === name).transactionBase64;
        out.push(await decoded(t), await exactCardano.bound(payment(t)));
      }
      return out;
    },
    "an option with scheme exact and a cardano: or cip34: network outside the named set": async () => {
      const out: unknown[] = [];
      for (const network of ["cardano:sanchonet", "cardano:testnet", "cip34:0-4", "cip34:1-1"]) {
        const o = { ...O, network };
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [o] };
        out.push(
          await exactCardano.bound(payment(V.V2.transactionBase64, o)),
          await exactCardano.reference(payment(V.V2.transactionBase64, o), o),
          await exactCardano.build({ required: doc, accepted: o }, H),
          exactCardano.advertise(doc, H, LINK, o, COINS_PER_UTXO_BYTE),
        );
      }
      return out;
    },
    "payload.transaction or payload.nonce not a string": async () => {
      const out: unknown[] = [];
      for (const transaction of [7, null, undefined]) {
        const p = { ...payment(""), payload: { transaction, nonce: V.fixed.nonce } };
        out.push(await exactCardano.bound(p), await exactCardano.reference(p, O));
      }
      for (const nonce of [7, null, undefined]) {
        const p = { ...payment(""), payload: { transaction: V.V2.transactionBase64, nonce } };
        out.push(await exactCardano.bound(p), await exactCardano.reference(p, O));
      }
      return out;
    },
    // V2's id, included in V5's block. The id is Python's hashlib.blake2b(digest_size=32) over V2's body (this file's
    // about); the same digest over the first item of the plant and of V4's "a trailing byte after the array" gives
    // V2's id, and over V3's and V4's "no auxiliary data and no key 7" another. Refused: V3's bytes; V4's row with no
    // key 7, which the decoder refuses aux-missing; the plant under V3's id, which it refuses aux-hash-mismatch; V2's
    // bytes with a byte after the array; a break byte, the integer 0 and an empty array; and no cbor. V2's bytes give
    // H, and the plant under V2's id gives the decoder's refusal.
    "recover on included bytes that are not one CBOR array whose first item, the body, hashes to the id, whatever the decoder answers for them, or with no cbor":
      async () => {
        const ref = input(V.V2.expectReference.txId);
        const v3 = { ...ref, tx: V.V3.txId };
        const included = { blockHeight: "5216518", slot: "134617000", valid: true };
        const recovered = (r: typeof ref, cbor?: string) => exactCardano.recover(r, reader(V.V5.tip, included, cbor));
        const row = (name: string): string => V.V4.find((r: { case: string }) => r.case === name).transactionBase64;
        const b64 = (...b: number[]) => Buffer.from(b).toString("base64");
        expect(await recovered(ref, TX["V2"])).toBe(H);
        expect(await recovered(ref, V.plant.transactionBase64)).toEqual(refused(V.plant.expectBound));
        return [
          await recovered(ref, TX["V3"]),
          await recovered(ref, row("no auxiliary data and no key 7")),
          await recovered(v3, V.plant.transactionBase64),
          await recovered(ref, row("a trailing byte after the array")),
          await recovered(ref, b64(0xff)),
          await recovered(ref, b64(0x00)),
          await recovered(ref, b64(0x80)),
          await recovered(ref),
        ];
      },
    // A constructed ledger (test/cardano-world.ts) whose presented body is read 1 and 1,000 blocks above the tip.
    "status: an inclusion read above the tip read before it": async () => {
      const out: unknown[] = [];
      const body = txOf({ inputs: [REF_INPUT], outputs: [{ to: "payee", coin: 1n }], h: H, ttl: 1n << 40n });
      for (const above of [1n, 1000n]) {
        const w: World = {
          k: 10n, tip: 1100n, held: 0n, genesis: true,
          txs: new Map([[body.id, { bytes: body.bytes, height: 1100n + above, valid: true, holders: ["payer"] }]]),
          output: { address: bech(addressOf("payer")), spentBy: body.id },
          listed: [], through: 1100n,
        };
        out.push(await exactCardano.status(refFor(body.id, H, "default", 1n << 40n), readerOf(w), { act: "payment", finality: 10n }));
      }
      return out;
    },
    // Built for H: V3's transaction, whose bound refuses, and V2's body without key 3, whose bound is H and whose
    // reference names no TTL, which lcp's client always writes. Built for another hash: V2's transaction, whose bound is H.
    "complete with a payload whose bound is not the built hash, or whose reference refuses": async () => {
      const required = exactCardano.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, LINK, O, COINS_PER_UTXO_BYTE);
      if ("refused" in required) throw new Error(required.code);
      const forH = await exactCardano.build({ required, accepted: O }, H);
      const forOther = await exactCardano.build({ required, accepted: O }, OTHER);
      if ("refused" in forH) throw new Error(forH.code);
      if ("refused" in forOther) throw new Error(forOther.code);
      const [body, witnesses, valid, aux] = v2Items();
      const map = bodyOf(body);
      expect(map.delete(3)).toBe(true);
      const noTtl = tx(cborg.encode(map), witnesses, valid, aux);
      expect(await exactCardano.bound(payment(noTtl))).toBe(H);
      expect(await exactCardano.reference(payment(noTtl), O)).not.toHaveProperty("ttlSlot");
      const nonce: string = V.fixed.nonce;
      return [
        await forH.complete({ transaction: V.V3.transactionBase64, nonce }),
        await forH.complete({ transaction: noTtl, nonce }),
        await forOther.complete({ transaction: V.V2.transactionBase64, nonce }),
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
      for (const r of results) expect(r).toEqual(wanted(row.expect));
    });
  }
});

describe("the read kit's cases that rest on the credential search, through Cardano's read", () => {
  // The forms skip them while no run shows a listing whole; through the read each answers what the read gives.
  for (const [method, subject] of [["default", "x402/exact/cardano"], ["masumi", "x402/exact/cardano/lock"]] as const) {
    it(`${subject}: every case skipped while the search is unshown answers pending, search-incomplete`, async () => {
      const resting = rowsOf(
        READ_STATUS.cases.flatMap((c) =>
          (["payment", "agreement"] as const).flatMap((act) => {
            const d = declaredFor(c, act);
            return d?.stated === UNSHOWN && leftOutByData(cardanoForms.find((f) => f.form.subject === subject)!.form, c, act) === undefined
              ? [{ c, act }]
              : [];
          }),
        ),
        "the cases resting on the search",
        { exact: method === "default" ? 15 : 8 },
      );
      for (const { c, act } of resting) {
        for (const m of method === "masumi" && runsOnScript(c) ? (["masumi", "script"] as const) : [method]) {
          const a = await arrangeOn(m, c, act).run();
          expect([c.case, act, m, a.state, "reason" in a ? a.reason : undefined]).toEqual([c.case, act, m, "pending", "search-incomplete"]);
        }
      }
    });
  }
});

describe("the read kit's lock form runs the script lock's read", () => {
  // Every case the lock pairing runs whose acts are each of their kind runs on the script lock as well, its answer
  // held to the case's; one holding an act of another kind runs on the Masumi lock alone.
  it("runs on the script lock every case it runs whose acts are each of their kind", async () => {
    const lock = cardanoForms.find((f) => f.form.subject === "x402/exact/cardano/lock")!;
    const ran: string[] = [];
    for (const c of READ_STATUS.cases) {
      for (const act of ["payment", "agreement"] as const) {
        const outcome = await runCase(lock, c, act);
        if (outcome === "ran" && runsOnScript(c)) ran.push(`${c.case} (act ${act})`);
      }
    }
    rowsOf(ran, "the lock's cases on the script lock", { exact: 48 });
    expect([...SCRIPT_RAN].sort()).toEqual(ran.sort());
  });
});
