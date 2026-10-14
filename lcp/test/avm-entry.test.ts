// An x402 Algorand payment entry has two readers. The x402 reference facilitator (x402-foundation/x402,
// typescript/packages/mechanisms/avm, src/exact/facilitator/scheme.ts) decodes each entry with algokit-utils'
// decodeSignedTransaction and submits the entry's own bytes; algod decodes those with go-codec (go-algorand v5.0.3,
// daemon/algod/api/server/v2/handlers.go decodeTxGroup) and checks Transaction.WellFormed's type rules. bound and
// reference read an entry only when both readers accept it and read the same signed transaction, and give the id algod
// computes: SHA-512/256 of "TX" and the transaction's canonical encoding (go-algorand data/transactions/transaction.go,
// Transaction.ID). Each form below is V2's payment entry of x402-exact-algorand.json written by hand in the msgpack
// specification's formats. An accepted form's expected id is V2's (py-algorand-sdk, the vector file's), or algosdk
// 3.8.0's for the canonical entry it reads as, written by hand in sorted, shortest form, which algosdk decodes and
// encodes back unchanged; recover finds H under that id. A refused form is avm/txn-malformed from bound and reference.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";
import { decodeSignedTransaction, encodeMsgpack } from "algosdk";
import type { AtrHash } from "../src/index.js";
import { exactAvm, type AvmParams, type AvmReader } from "../src/avm.js";
import type { PaymentRequired } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const [FEE_PAYER_ENTRY, V2_BASE64] = V.V2.expectPaymentGroup as [string, string];
const V2 = Uint8Array.from(Buffer.from(V2_BASE64, "base64"));
const V2_TXID: string = V.V2.expectPaymentTxid;

// The msgpack specification's formats, in their shortest form unless a case names another.
const cat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const ascii = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));
const str = (t: string | Uint8Array) => {
  const b = typeof t === "string" ? ascii(t) : t;
  return cat(b.length < 32 ? [0xa0 | b.length] : [0xd9, b.length], b);
};
const bin = (b: Uint8Array) => cat([0xc4, b.length], b);
const uint = (v: number) => (v < 0x80 ? cat([v]) : v < 0x10000 ? cat([0xcd, v >> 8, v & 0xff]) : cat([0xce], be(v, 4)));
const be = (v: number | bigint, width: number) => Array.from({ length: width }, (_, k) => Number((BigInt(v) >> BigInt(8 * (width - 1 - k))) & 0xffn));
const map = (pairs: [Uint8Array, Uint8Array][]) => cat([0x80 | pairs.length], ...pairs.flat());
const arr = (items: Uint8Array[]) => cat([0x90 | items.length], ...items);
const NIL = cat([0xc0]);
type Members = [string, Uint8Array][];
const keyed = (members: Members): [Uint8Array, Uint8Array][] => members.map(([k, v]) => [str(k), v]);

/** V2's payment entry, {sig, txn}, its transaction's eleven members as written, in sorted order. */
const SIG = V2.subarray(7, 71);
const TXN: Members = (() => {
  const out: Members = [];
  let i = 1 + 4 + 2 + 64 + 4 + 1;
  const width = (t: number) =>
    t < 0x80 ? 1 : t >= 0xa0 && t <= 0xbf ? 1 + (t & 0x1f) : t === 0xc4 ? 2 + V2[i + 1 + (V2[i]! & 0x1f) + 1]! : t === 0xcd ? 3 : 5;
  while (i < V2.length) {
    const key = new TextDecoder().decode(V2.subarray(i + 1, i + 1 + (V2[i]! & 0x1f)));
    const at = i + 1 + (V2[i]! & 0x1f);
    const w = width(V2[at]!);
    out.push([key, V2.slice(at, at + w)]);
    i = at + w;
  }
  return out;
})();
const member = (name: string) => TXN.find(([k]) => k === name)![1];
const entryOf = (txn: Members, top: Members = []) => map(keyed([["sig", bin(SIG)], ["txn", map(keyed(txn))], ...top]));
const replaced = (name: string, value: Uint8Array): Members => TXN.map(([k, v]) => [k, k === name ? value : v]);
const withMember = (name: string, value: Uint8Array): Members => [...TXN, [name, value]];
/** The canonical entry with one member's value given (or left out, for null): sorted keys, shortest forms. */
const canonical = (name: string, value: Uint8Array | null): Uint8Array => {
  const txn = TXN.filter(([k]) => k !== name);
  if (value !== null) txn.push([name, value]);
  txn.sort(([a], [b]) => (a < b ? -1 : 1));
  return entryOf(txn);
};
/** algosdk 3.8.0's id for a canonical entry, which it must decode and encode back unchanged. */
const sdkTxid = (entry: Uint8Array) => {
  const stxn = decodeSignedTransaction(entry);
  expect(Buffer.from(encodeMsgpack(stxn)).toString("hex")).toBe(Buffer.from(entry).toString("hex"));
  return stxn.txn.txID();
};

const O = V.fixed.O;
const params: AvmParams = {
  firstValid: BigInt(V.fixed.params.firstValid),
  genesisHash: V.fixed.params.genesisHash,
  genesisId: V.fixed.params.genesisId,
  minFee: BigInt(V.fixed.params.minFee),
  feePerByte: BigInt(V.fixed.params.feePerByte),
};
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const presentedWith = (entry: Uint8Array, base: object) => ({
  ...base,
  payload: { paymentIndex: 1, paymentGroup: [FEE_PAYER_ENTRY, Buffer.from(entry).toString("base64")] },
});
/** An Indexer that holds V2's note under one id and nothing under any other. */
const readerHolding = (txid: string): AvmReader => ({
  network: V.V4.readerNetwork,
  search: async (t) => ({
    currentRound: 1n,
    found: t === txid ? { confirmedRound: 1n, note: Buffer.from(V.V4.note, "base64") } : null,
  }),
});

type Case = { case: string; entry: Uint8Array; expect: string };
const SELF_SPELLED = "JJFEMRKNKJFU4S2KIZKTIUZSJNEVUS2UJFKVUU2KJZCVMVKTGJKVMRC77Q";

/** Each case through bound, reference and recover: an id gives H, the reference and H recovered under it. */
async function check(rows: Case[], source: string) {
  const payment = await completedPayment();
  for (const row of rowsOf(rows, source)) {
    const p = presentedWith(row.entry, payment);
    if (row.expect.startsWith("avm/")) {
      const refused = { refused: true, code: row.expect };
      expect(await exactAvm.bound(p), row.case).toEqual(refused);
      expect(await exactAvm.reference(p), row.case).toEqual(refused);
      continue;
    }
    expect(await exactAvm.bound(p), row.case).toBe(H);
    const ref = await exactAvm.reference(p);
    expect(ref, row.case).toEqual({ network: O.network, txid: row.expect, lastValid: V.V3.expectReference.lastValid });
    if ("refused" in ref) continue;
    expect(await exactAvm.recover({ network: ref.network, txid: ref.txid }, readerHolding(row.expect)), row.case).toBe(H);
  }
}
async function completedPayment() {
  const u = await exactAvm.build({ required, accepted: O, payer: V.fixed.payer, params }, H);
  if ("refused" in u) throw new Error(u.code);
  const payment = u.complete(Buffer.from(V.fixed.signature, "hex"));
  if ("refused" in payment) throw new Error(payment.code);
  return payment;
}

describe("x402-exact-algorand.json V2's payment entry, each form as algod and the facilitator read it", () => {
  it("V2's entry as written is read with its own id", async () => {
    expect(entryOf(TXN)).toEqual(V2);
    await check([{ case: "V2", entry: V2, expect: V2_TXID }], "V2");
  });

  // go-codec decodes each occurrence of a key into the same member: a later scalar replaces an earlier one, a
  // repeated struct merges, and a fixed-length byte array has only the bytes written replaced. algokit reads the
  // msgpack map, whose last value for a key wins. A repeated scalar reads the same in both; the others do not.
  it("a repeated key", async () => {
    const xaid5 = canonical("xaid", uint(5));
    await check(
      [
        { case: "xaid 5, then V2's", entry: entryOf([["xaid", uint(5)], ...TXN]), expect: V2_TXID },
        { case: "V2's xaid, then 5", entry: entryOf(withMember("xaid", uint(5))), expect: sdkTxid(xaid5) },
        {
          case: "txn {fee 5}, then V2's txn: algod merges the fee in, the facilitator reads the second txn alone",
          entry: map(keyed([["sig", bin(SIG)], ["txn", map(keyed([["fee", uint(5)]]))], ["txn", map(keyed(TXN))]])),
          expect: "avm/txn-malformed",
        },
        {
          case: "gh, then gh of 31 zero bytes: algod keeps gh's last byte, the facilitator reads 31 bytes",
          entry: entryOf(withMember("gh", bin(new Uint8Array(31)))),
          expect: "avm/txn-malformed",
        },
        {
          case: "V2's txn, then V2's txn again: algod's merge and the facilitator's second txn are the same transaction",
          entry: map(keyed([["sig", bin(SIG)], ["txn", map(keyed(TXN))], ["txn", map(keyed(TXN))]])),
          expect: V2_TXID,
        },
      ],
      "a repeated key",
    );
  });

  // go-codec decodes a repeated slice into the array it already holds (kSlice, go-codec v1.1.10 decode.go): items that
  // fit its capacity decode into the elements there, those an earlier, longer list left past the slice's length
  // included. algokit reads the last list alone.
  it("a repeated list of multisignature subsignatures", async () => {
    const subsig = (pk: number, s?: number) =>
      map(keyed([["pk", bin(new Uint8Array(32).fill(pk))], ...(s === undefined ? [] : ([["s", bin(new Uint8Array(64).fill(s))]] as Members))]));
    const msig = (...lists: Uint8Array[][]) =>
      entryOf(TXN, [["msig", map(keyed([["v", uint(1)], ["thr", uint(1)], ...lists.map((l): [string, Uint8Array] => ["subsig", arr(l)])]))]]);
    await check(
      [
        { case: "subsig [X], then [X]", entry: msig([subsig(9, 9)], [subsig(9, 9)]), expect: V2_TXID },
        {
          case: "subsig [A, B, C], then [X], then [X, {}, {}]: algod reads X, B and C, the facilitator X and two empty subsignatures",
          entry: msig([subsig(1), subsig(2), subsig(3)], [subsig(9, 9)], [subsig(9, 9), map([]), map([])]),
          expect: "avm/txn-malformed",
        },
        {
          case: "subsig [A], then [X, {}]: a longer list takes a new array, and both read X and an empty subsignature",
          entry: msig([subsig(1)], [subsig(9, 9), map([])]),
          expect: V2_TXID,
        },
      ],
      "a repeated subsignature list",
    );
    const row = (V.V3.refusals as { case: string; paymentGroup: string[] }[]).find((r) =>
      r.case.startsWith("V2's group with msig {v: 1, thr: 1, subsig: [A, B, C]"),
    );
    const entry = msig([subsig(1), subsig(2), subsig(3)], [subsig(9, 9)], [subsig(9, 9), map([]), map([])]);
    expect(row?.paymentGroup).toEqual([FEE_PAYER_ENTRY, Buffer.from(entry).toString("base64")]);
  });

  it("keys out of sorted order", async () => {
    await check(
      [
        { case: "the transaction's members reversed", entry: entryOf([...TXN].reverse()), expect: V2_TXID },
        { case: "txn before sig", entry: map(keyed([["txn", map(keyed(TXN))], ["sig", bin(SIG)]])), expect: V2_TXID },
      ],
      "keys out of sorted order",
    );
  });

  // go-algorand's CodecHandle sets ErrorIfNoField, and go-codec's indexForEncName reads an empty key's first byte.
  it("an unknown member, and an empty key", async () => {
    await check(
      [
        { case: "zz 5 in the transaction", entry: entryOf(withMember("zz", uint(5))), expect: "avm/txn-malformed" },
        { case: "zz 5 in the entry", entry: entryOf(TXN, [["zz", uint(5)]]), expect: "avm/txn-malformed" },
        { case: "the empty key, 5, in the transaction", entry: entryOf(withMember("", uint(5))), expect: "avm/txn-malformed" },
      ],
      "an unknown member",
    );
  });

  // Each reader leaves a member at its default out of the canonical encoding. A member of another transaction type
  // at its default is no member for WellFormed, which compares each type's members with their zero value.
  it("a member written at its default", async () => {
    await check(
      [
        { case: "fee 0", entry: entryOf(withMember("fee", uint(0))), expect: V2_TXID },
        { case: "lx of 32 zero bytes", entry: entryOf(withMember("lx", bin(new Uint8Array(32)))), expect: V2_TXID },
        { case: "rekey of 32 zero bytes", entry: entryOf(withMember("rekey", bin(new Uint8Array(32)))), expect: V2_TXID },
        { case: "a payment's amt 0", entry: entryOf(withMember("amt", uint(0))), expect: V2_TXID },
        { case: "an asset configuration's apar {}", entry: entryOf(withMember("apar", map([]))), expect: V2_TXID },
        { case: "an asset freeze's afrz written as the fixint 0", entry: entryOf(withMember("afrz", uint(0))), expect: V2_TXID },
      ],
      "a member at its default",
    );
  });

  it("an integer, a length or a header in a longer format than it needs", async () => {
    const fv = member("fv");
    const txn = map(keyed(TXN));
    await check(
      [
        { case: "fv as a uint 64", entry: entryOf(replaced("fv", cat([0xcf], be(BigInt(`0x${Buffer.from(fv.subarray(1)).toString("hex")}`), 8)))), expect: V2_TXID },
        { case: "aamt as an int 64", entry: entryOf(replaced("aamt", cat([0xd3], be(10000, 8)))), expect: V2_TXID },
        { case: "gen as a str 8", entry: entryOf(replaced("gen", cat([0xd9, 12], ascii("testnet-v1.0")))), expect: V2_TXID },
        { case: "sig as a bin 16", entry: map(keyed([["sig", cat([0xc5, 0, 64], SIG)], ["txn", txn]])), expect: V2_TXID },
        { case: "txn as a map 16", entry: map(keyed([["sig", bin(SIG)], ["txn", cat([0xde, 0, 11], txn.subarray(1))]])), expect: V2_TXID },
        { case: "fee as the negative fixint -1", entry: entryOf(withMember("fee", cat([0xff]))), expect: "avm/txn-malformed" },
        { case: "fee as an int 8 of -1", entry: entryOf(withMember("fee", cat([0xd0, 0xff]))), expect: "avm/txn-malformed" },
        { case: "an asset configuration's dc (uint32) as 2^32", entry: entryOf(withMember("apar", map(keyed([["dc", cat([0xcf], be(2n ** 32n, 8))]])))), expect: "avm/txn-malformed" },
      ],
      "a longer format",
    );
  });

  // go-codec sets a member written as nil to its zero value; algokit reads nil as the member's default.
  it("nil where a value is expected", async () => {
    await check(
      [
        { case: "gen nil", entry: entryOf(replaced("gen", NIL)), expect: sdkTxid(canonical("gen", null)) },
        { case: "msig nil", entry: entryOf(TXN, [["msig", NIL]]), expect: V2_TXID },
        { case: "an application call's apaa nil", entry: entryOf(withMember("apaa", NIL)), expect: V2_TXID },
        { case: "hb nil", entry: entryOf(withMember("hb", NIL)), expect: V2_TXID },
        { case: "gh nil: the facilitator computes no id without a genesis hash", entry: entryOf(replaced("gh", NIL)), expect: "avm/txn-malformed" },
        { case: "txn nil", entry: map(keyed([["sig", bin(SIG)], ["txn", NIL]])), expect: "avm/txn-malformed" },
        { case: "the entry nil", entry: NIL, expect: "avm/txn-malformed" },
      ],
      "nil",
    );
  });

  // go-codec reads a bin and a str alike for a byte or string member and for a key; algokit reads every str as bytes.
  // A string member's bytes are read as UTF-8 text by algokit, so bytes that are not UTF-8 read as other text there.
  it("a bin where a str is expected, and the reverse", async () => {
    const note = member("note").subarray(2);
    const lease = new Uint8Array(32).fill(0xff);
    await check(
      [
        { case: "gen as a bin", entry: entryOf(replaced("gen", bin(ascii("testnet-v1.0")))), expect: V2_TXID },
        { case: "type as a bin", entry: entryOf(replaced("type", bin(ascii("axfer")))), expect: V2_TXID },
        { case: "note as a str", entry: entryOf(replaced("note", str(note))), expect: V2_TXID },
        { case: "snd as a str", entry: entryOf(replaced("snd", str(member("snd").subarray(2)))), expect: V2_TXID },
        { case: "the key txn as a bin", entry: map([[str("sig"), bin(SIG)], [bin(ascii("txn")), map(keyed(TXN))]]), expect: V2_TXID },
        { case: "lx as a str of 32 bytes FF, not UTF-8", entry: entryOf(withMember("lx", str(lease))), expect: sdkTxid(canonical("lx", bin(lease))) },
        { case: "gen as a str ending ED A0 80, not UTF-8", entry: entryOf(replaced("gen", str(cat(ascii("testnet-v1."), [0xed, 0xa0, 0x80])))), expect: "avm/txn-malformed" },
        { case: "the key txn as an array of its three bytes", entry: map([[str("sig"), bin(SIG)], [arr([...ascii("txn")].map(uint)), map(keyed(TXN))]]), expect: "avm/txn-malformed" },
      ],
      "a bin and a str",
    );
  });

  // go-algorand's decodeTxGroup reads a request body as a stream of values; x402's entry is one signed transaction,
  // and the facilitator's decoder refuses bytes after the value.
  it("bytes after the entry's value", async () => {
    await check(
      [
        { case: "V2's entry and nil", entry: cat(V2, NIL), expect: "avm/txn-malformed" },
        { case: "V2's entry twice", entry: cat(V2, V2), expect: "avm/txn-malformed" },
      ],
      "bytes after the value",
    );
  });

  // go-codec reads a struct written as an array member by member in source order; algokit reads an array as a struct
  // with no members, and a transaction with no type it refuses.
  it("a struct written as an array", async () => {
    await check(
      [
        { case: "msig []", entry: entryOf(TXN, [["msig", arr([])]]), expect: V2_TXID },
        { case: "msig [0, 0]", entry: entryOf(TXN, [["msig", arr([uint(0), uint(0)])]]), expect: V2_TXID },
        { case: "msig [1]: algod reads version 1", entry: entryOf(TXN, [["msig", arr([uint(1)])]]), expect: "avm/txn-malformed" },
        { case: "msig with four elements, one more than its members", entry: entryOf(TXN, [["msig", arr([NIL, NIL, NIL, NIL])]]), expect: "avm/txn-malformed" },
        { case: "txn as an array", entry: map(keyed([["sig", bin(SIG)], ["txn", arr([str("axfer")])]])), expect: "avm/txn-malformed" },
      ],
      "a struct as an array",
    );
  });

  // go-codec reads a byte member from an array of uint8 values; algokit refuses an array for a byte member.
  it("a byte member written as an array of numbers", async () => {
    const gh = member("gh").subarray(2);
    const asNumbers = cat([0xdc, 0, 32], ...[...gh].map(uint));
    await check(
      [
        { case: "gh as an array of its 32 bytes", entry: entryOf(replaced("gh", asNumbers)), expect: "avm/txn-malformed" },
        { case: "an asset configuration's am as an array of 33 zeros", entry: entryOf(withMember("apar", map(keyed([["am", cat([0xdc, 0, 33], new Uint8Array(33))]])))), expect: "avm/txn-malformed" },
        { case: "an asset configuration's am as an array of 32 zeros", entry: entryOf(withMember("apar", map(keyed([["am", cat([0xdc, 0, 32], new Uint8Array(32))]])))), expect: V2_TXID },
      ],
      "a byte member as numbers",
    );
  });

  // go-codec writes a fixed-length byte array's first bytes and cuts a longer input; algokit keeps any length, and
  // reads an address from 32 bytes or from its 58 characters (RFC 4648 base32 of the key and its 4-byte checksum, the
  // last 4 bytes of the key's SHA-512/256). SELF_SPELLED is the address whose key is the ASCII of its own first 32
  // characters, so both readers read that key from its 58 characters.
  it("a fixed-length byte member of another length", async () => {
    const key = ascii(SELF_SPELLED.slice(0, 32));
    expect(base32.encode(cat(key, sha512_256(key).subarray(28))).replace(/=+$/, "")).toBe(SELF_SPELLED);
    const gh = member("gh").subarray(2);
    await check(
      [
        { case: "gh of 33 bytes", entry: entryOf(replaced("gh", bin(cat(gh, [0])))), expect: "avm/txn-malformed" },
        { case: "gh of 31 bytes", entry: entryOf(replaced("gh", bin(gh.subarray(0, 31)))), expect: "avm/txn-malformed" },
        { case: "sig of 63 bytes", entry: map(keyed([["sig", bin(SIG.subarray(0, 63))], ["txn", map(keyed(TXN))]])), expect: "avm/txn-malformed" },
        { case: "snd as the 58 characters of the payer's address", entry: entryOf(replaced("snd", str(V.fixed.payer))), expect: "avm/txn-malformed" },
        {
          case: `snd as the 58 characters of ${SELF_SPELLED}, whose key is its own first 32 characters`,
          entry: entryOf(replaced("snd", str(SELF_SPELLED))),
          expect: sdkTxid(canonical("snd", bin(ascii(SELF_SPELLED.slice(0, 32))))),
        },
      ],
      "another length",
    );
  });

  // go-codec's DecodeBool takes true, false and the positive fixints 0 and 1.
  it("a bool written as 0 or 1", async () => {
    await check(
      [
        { case: "afrz as the fixint 0", entry: entryOf(withMember("afrz", uint(0))), expect: V2_TXID },
        { case: "afrz as the fixint 1: an asset freeze's member set", entry: entryOf(withMember("afrz", uint(1))), expect: "avm/txn-malformed" },
        { case: "afrz as a uint 8 of 0", entry: entryOf(withMember("afrz", cat([0xcc, 0]))), expect: "avm/txn-malformed" },
      ],
      "a bool",
    );
  });

  it("a float or an extension in a typed member", async () => {
    await check(
      [
        { case: "fee as a float 64 of 0", entry: entryOf(withMember("fee", cat([0xcb], new Uint8Array(8)))), expect: "avm/txn-malformed" },
        { case: "fee as a fixext 1", entry: entryOf(withMember("fee", cat([0xd4, 1, 0]))), expect: "avm/txn-malformed" },
      ],
      "a float or an extension",
    );
  });

  // WellFormed refuses a type it does not know, and a member of another type at a non-zero value. An application
  // call's slice or program is such a member once it is not nil (ApplicationCallTxnFields.Empty).
  it("WellFormed's type rules", async () => {
    await check(
      [
        { case: "type xfer", entry: entryOf(replaced("type", str("xfer"))), expect: "avm/txn-malformed" },
        { case: "a payment's amt 1", entry: entryOf(withMember("amt", uint(1))), expect: "avm/txn-malformed" },
        { case: "an application call's apaa []", entry: entryOf(withMember("apaa", arr([]))), expect: "avm/txn-malformed" },
        { case: "an application call's apap as a bin of 0 bytes", entry: entryOf(withMember("apap", bin(new Uint8Array(0)))), expect: "avm/txn-malformed" },
        { case: "hb {}", entry: entryOf(withMember("hb", map([]))), expect: "avm/txn-malformed" },
        { case: "type pay with V2's asset transfer members", entry: entryOf(replaced("type", str("pay"))), expect: "avm/txn-malformed" },
      ],
      "WellFormed",
    );
  });

  // algokit reads a multisignature's version and threshold as written: an integer in a 64-bit format is a bigint,
  // which its encoder writes back even at 0, and it has no post-quantum signature member, which algod reads.
  it("a member the facilitator reads otherwise than algod", async () => {
    await check(
      [
        { case: "msig {v: 0}", entry: entryOf(TXN, [["msig", map(keyed([["v", uint(0)]]))]]), expect: V2_TXID },
        { case: "msig {v: 0 as a uint 64}", entry: entryOf(TXN, [["msig", map(keyed([["v", cat([0xcf], new Uint8Array(8))]]))]]), expect: "avm/txn-malformed" },
        { case: "pqsig {}", entry: entryOf(TXN, [["pqsig", map([])]]), expect: V2_TXID },
        { case: "pqsig {slt: 1}", entry: entryOf(TXN, [["pqsig", map(keyed([["slt", uint(1)]]))]]), expect: "avm/txn-malformed" },
      ],
      "the facilitator's reading",
    );
  });
});

// x402-exact-algorand.json build row 1: a genesis id of the byte-order mark and 198 x. Both readers read a string
// member's bytes as written: algod as bytes, the facilitator as UTF-8 text through Node's Buffer, which keeps a leading
// mark. build writes that gen, and bound, reference and recover read the payment under the row's hand-derived id.
describe("a genesis id that begins with the byte-order mark", () => {
  it("is written by build and read by bound, reference and recover with the mark", async () => {
    const row = rowsOf(V.build.rows as { case: string; genesisId: string; expectPaymentTxid?: string }[], "x402-exact-algorand.json build.rows", {
      exact: 1,
      keep: ["row 1, the genesis id that begins with the mark", (r) => r.genesisId.startsWith("\ufeff")],
      leave: ["the rows whose genesis id holds a lone surrogate or is the file's own; avm.test.ts runs every row", (r) => !r.genesisId.startsWith("\ufeff")],
    })[0]!;
    const u = await exactAvm.build({ required, accepted: O, payer: V.fixed.payer, params: { ...params, genesisId: row.genesisId } }, H);
    if ("refused" in u) throw new Error(u.code);
    const txid = row.expectPaymentTxid!;
    expect(base32.encode(sha512_256(u.request.bytes)).replace(/=+$/, "")).toBe(txid);
    const payment = u.complete(Buffer.from(V.fixed.signature, "hex"));
    if ("refused" in payment) throw new Error(payment.code);
    const entry = Buffer.from(payment.payload.paymentGroup[1]!, "base64");
    expect(entry.includes(Buffer.from([0xd9, 201, 0xef, 0xbb, 0xbf]))).toBe(true);
    expect(await exactAvm.bound(payment)).toBe(H);
    expect(await exactAvm.reference(payment)).toEqual({ network: O.network, txid, lastValid: V.V3.expectReference.lastValid });
    expect(await exactAvm.recover({ network: O.network, txid }, readerHolding(txid))).toBe(H);
  });
});
