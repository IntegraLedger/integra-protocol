// Runs the Algorand vector file through the avm entry point. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";
import { decodeSignedTransaction, encodeAddress, isValidAddress, msgpackRawDecodeAsMap } from "algosdk";
import { pairingOf, type AtrHash } from "../src/index.js";
import { avmCarrier, avmStatus, exactAvm, type AvmIndexed, type AvmParams, type AvmReader, type AvmUnsigned } from "../src/avm.js";
import { isAlgorandAddress } from "../src/internal/avm.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { wellFormedUtf8 } from "./utf8-syntax.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const params: AvmParams = {
  firstValid: BigInt(V.fixed.params.firstValid),
  genesisHash: V.fixed.params.genesisHash,
  genesisId: V.fixed.params.genesisId,
  minFee: BigInt(V.fixed.params.minFee),
  feePerByte: BigInt(V.fixed.params.feePerByte),
};
const txidOf = (toSign: Uint8Array) => base32.encode(sha512_256(toSign)).replace(/=+$/, "");
const publicKeyOf = (address: string) => base32.decode(address + "======").slice(0, 32);

/** A transaction of V4's fixtures, as the Indexer reports it; `note` is "H" for H's LCP string, else base64. */
type Fx = {
  id: string;
  round: string;
  type: string;
  sender: string;
  authAddr: string | null;
  signature: AvmIndexed["signature"];
  note: string;
  transfer: null | { assetId: string; receiver: string; amount: string; closeTo: string | null; closeAmount: string; assetSender: string | null };
  inner: Fx[];
};
type Lookup = { currentRound: string; found: Fx | null } | "reader-error";
type PageFx = { asks: { minRound: string; maxRound?: string; next?: string }; answer: "reader-error" | { currentRound: string; transactions: (Fx | { unparseable: true; id: string })[]; next?: string } };
type V4Row = { case: string; query?: QueryFx; archival?: boolean; header?: Record<string, boolean> | "reader-error"; lookup: Lookup; pages?: PageFx[]; expect: unknown };
const H_NOTE = Buffer.from(`lcp:sha256:${V.fixed.H}`, "ascii");
function indexed(t: Fx): AvmIndexed {
  return {
    id: t.id,
    confirmedRound: BigInt(t.round),
    type: t.type,
    sender: t.sender,
    authAddr: t.authAddr,
    signature: t.signature,
    note: t.note === "H" ? Uint8Array.from(H_NOTE) : Uint8Array.from(Buffer.from(t.note, "base64")),
    transfer:
      t.transfer === null
        ? null
        : { ...t.transfer, assetId: BigInt(t.transfer.assetId), amount: BigInt(t.transfer.amount), closeAmount: BigInt(t.transfer.closeAmount) },
    inner: t.inner.map(indexed),
  };
}
/**
 * A reader over one row's fixtures: the lookup for any id, the header by round, and the account's pages in the order
 * listed, each call held to the parameters the page says the read asks. `left` counts the pages not asked.
 */
function readerOf(row: Pick<V4Row, "archival" | "header" | "lookup" | "pages">, network = V.V4.readerNetwork): AvmReader & { left(): number } {
  const pages = [...(row.pages ?? [])];
  return {
    network,
    ...(row.archival === true ? { archival: true } : {}),
    transaction: async () => {
      const a = row.lookup;
      if (a === "reader-error") throw new Error("transport");
      return { currentRound: BigInt(a.currentRound), found: a.found === null ? null : indexed(a.found) };
    },
    header: async (round) => {
      if (row.header === "reader-error") throw new Error("transport");
      return row.header?.[round.toString()] === true;
    },
    accountPage: async (account, q) => {
      expect(account).toBe(V.fixed.payer);
      const p = pages.shift();
      if (p === undefined) throw new Error("no page left");
      expect(withStrings(q)).toEqual(p.asks);
      if (p.answer === "reader-error") throw new Error("transport");
      return {
        currentRound: BigInt(p.answer.currentRound),
        transactions: p.answer.transactions.map((t) => ("unparseable" in t ? t : indexed(t))),
        ...(p.answer.next === undefined ? {} : { next: p.answer.next }),
      };
    },
    left: () => pages.length,
  };
}
type QueryFx = { act?: "payment" | "agreement"; after?: string; search?: { through: string; top?: string; next?: string }; others?: unknown[] };
/** The query a row asks: the act payment at the one mark unless the row's query says otherwise, its positions rounds. */
const paymentAct = { act: "payment", finality: "final" } as const;
function queryOf(q?: QueryFx) {
  if (q === undefined) return paymentAct;
  const s = q.search;
  return {
    act: q.act ?? "payment",
    finality: "final",
    ...(q.after === undefined ? {} : { after: BigInt(q.after) }),
    ...(s === undefined
      ? {}
      : { search: { through: BigInt(s.through), ...(s.top === undefined ? {} : { top: BigInt(s.top) }), ...(s.next === undefined ? {} : { next: s.next }) } }),
    ...(q.others === undefined ? {} : { others: q.others }),
  } as const;
}
const unparseable = { state: "unreadable", reason: "unparseable", foreign: [] };
const withStrings = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/** How V3.refusals ends the case of each row that writes a string that is not UTF-8. */
const NOT_UTF8 = "a string that is not well-formed UTF-8 (RFC 3629 §4)";
const bytesOf = (h: string) => Buffer.from(h.replaceAll(" ", ""), "hex");
/**
 * V2's payment entry, the msgpack map {sig, txn}, edited by hand (msgpack specification's formats): one span of its
 * bytes replaced, or one member appended to the map or to the txn map, its last value, whose last member is xaid.
 */
const V2_ENTRY = Buffer.from(V.V2.expectPaymentGroup[1], "base64");
function replaced(from: string, to: string): Buffer {
  const at = V2_ENTRY.indexOf(bytesOf(from));
  if (at < 0 || V2_ENTRY.indexOf(bytesOf(from), at + 1) >= 0) throw new Error(`not once in V2's entry: ${from}`);
  return Buffer.concat([V2_ENTRY.subarray(0, at), bytesOf(to), V2_ENTRY.subarray(at + bytesOf(from).length)]);
}
const withMember = (keyAndValue: string) => Buffer.concat([bytesOf("83"), V2_ENTRY.subarray(1), bytesOf(keyAndValue)]);
const withTxnMember = (keyAndValue: string) =>
  Buffer.concat([replaced("a3 74786e 8b", "a3 74786e 8c"), bytesOf(keyAndValue)]);
/** `text` as one msgpack string: a fixstr up to 31 bytes, else a str 8. */
const msgpackStr = (text: string) => {
  const b = bytesOf(text);
  return Buffer.concat([Buffer.from(b.length < 32 ? [0xa0 | b.length] : [0xd9, b.length]), b]).toString("hex");
};
/** "gen": "testnet-v1.0" in V2's payment transaction. */
const GEN = "a367656e ac 746573746e65742d76312e30";
/**
 * Four places for a msgpack string in V2's payment entry, each in a member algod does not know: a last member's key and
 * a last member's value in the entry, a last member's key in the transaction, and an element of an array in the
 * transaction.
 */
const ENTRY_PLACES: Record<string, (s: string) => Buffer> = {
  "the entry's key": (s) => withMember(`${s} 05`),
  "the entry's value": (s) => withMember(`a2 7a7a ${s}`),
  "the transaction's key": (s) => withTxnMember(`${s} 05`),
  "an array in the transaction": (s) => withTxnMember(`a2 7a7a 91 ${s}`),
};

describe("x402-exact-algorand.json", () => {
  const required = (o: PaymentRequirements): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });
  const unsigned = async (o: PaymentRequirements) => {
    const u = await exactAvm.build({ required: required(o), accepted: o, payer: V.fixed.payer, params }, H);
    if ("refused" in u) throw new Error(u.code);
    return u as AvmUnsigned;
  };
  const completed = async () => {
    const payment = (await unsigned(O)).complete(Buffer.from(V.fixed.signature, "hex"));
    if ("refused" in payment) throw new Error(payment.code);
    return payment;
  };

  it("V1: standalone, the 268-byte axfer and its txid", async () => {
    const u = await unsigned(V.fixed.OStandalone);
    expect(u.request.kind).toBe("algorand-txn");
    expect(u.request.bytes.length - 2).toBe(V.V1.expectEncodedLength);
    expect(txidOf(u.request.bytes)).toBe(V.V1.expectTxid);
  });

  it("V2: with the fee payer, the payer's bytes, whose signature completes the two entries", async () => {
    const u = await unsigned(O);
    expect(hex(u.request.bytes)).toBe(V.V2.expectBytesToSign);
    expect(txidOf(u.request.bytes)).toBe(V.V2.expectPaymentTxid);
    const signature = Buffer.from(V.fixed.signature, "hex");
    expect(ed25519.verify(signature, u.request.bytes, publicKeyOf(V.fixed.payer))).toBe(true);
    const payment = u.complete(signature);
    if ("refused" in payment) throw new Error(payment.code);
    expect(payment.payload).toEqual({ paymentIndex: V.V2.expectPaymentIndex, paymentGroup: V.V2.expectPaymentGroup });
    expect(payment.accepted).toEqual(O);
    expect(u.complete(new Uint8Array(63))).toEqual({ refused: true, code: "avm/signature-malformed" });
  });

  it("V3: bound and reference, and the refusals", async () => {
    const payment = await completed();
    expect(await exactAvm.bound(payment)).toBe(V.V3.expectBound);
    const ref = await exactAvm.reference(payment, O);
    expect(ref).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    expect(await exactAvm.reference(payment, {} as PaymentRequirements)).toEqual({ refused: true, code: "x402/option-malformed" });
    for (const row of rowsOf(V.V3.refusals, "x402-exact-algorand.json V3.refusals")) {
      expect(avmCarrier({ paymentIndex: row.paymentIndex, paymentGroup: row.paymentGroup })).toEqual({
        refused: true,
        code: row.expect,
      });
      const presented = { ...payment, payload: { paymentIndex: row.paymentIndex, paymentGroup: row.paymentGroup } };
      expect(await exactAvm.bound(presented)).toEqual({ refused: true, code: row.expect });
    }
  });

  // The SignedTxn rows: V2's group with its payment entry's one member replaced, which algosdk 3.8.0, the decoder P2
  // names, refuses; the row above runs each through avmCarrier and bound.
  it("V3: each SignedTxn row is V2's payment entry with one member replaced, and algosdk refuses it", () => {
    const rows = rowsOf(
      V.V3.refusals as { case: string; paymentIndex: number; paymentGroup: string[]; expect: string }[],
      "x402-exact-algorand.json V3.refusals",
      {
        exact: 7,
        keep: ["the SignedTxn rows", (r) => r.case.startsWith("SignedTxn ")],
        leave: [
          "every other row, whose note, index, group or encoding is refused; the test above runs every row through avmCarrier and bound",
          (r) => !r.case.startsWith("SignedTxn "),
        ],
      },
    );
    expect(rows).toHaveLength(7);
    const keys = (m: Map<unknown, unknown>) => [...m.keys()].map(String).sort();
    const v2 = msgpackRawDecodeAsMap(Buffer.from(V.V2.expectPaymentGroup[1], "base64")) as Map<string, unknown>;
    for (const r of rows) {
      expect([r.paymentIndex, r.paymentGroup[0], r.expect], r.case).toEqual([1, V.V2.expectPaymentGroup[0], "avm/txn-malformed"]);
      const bytes = Buffer.from(r.paymentGroup[1]!, "base64");
      expect(() => decodeSignedTransaction(bytes), r.case).toThrow();
      const m = msgpackRawDecodeAsMap(bytes) as Map<string, unknown>;
      const txn = m.get("txn") as Map<string, unknown>;
      const v2txn = v2.get("txn") as Map<string, unknown>;
      const changed = [...new Set([...keys(m), ...keys(v2)])].filter((k) => k !== "txn" && String(m.get(k)) !== String(v2.get(k)));
      const txnChanged = [...new Set([...keys(txn), ...keys(v2txn)])].filter((k) => String(txn.get(k)) !== String(v2txn.get(k)));
      expect(changed.length + txnChanged.length, r.case).toBeGreaterThan(0);
      expect(changed.filter((k) => k !== "sig").length + txnChanged.length, r.case).toBe(1);
    }
  });

  // The rows whose case ends in NOT_UTF8: V2's payment entry with one string written by hand, spelled here from the
  // bytes each case names. RFC 3629 §4's syntax (utf8-syntax.ts) refuses each written string and takes gen's own.
  it("V3: each row with a string that is not UTF-8 is V2's payment entry with that one string written", () => {
    const rows = rowsOf(
      V.V3.refusals as { case: string; paymentIndex: number; paymentGroup: string[]; expect: string }[],
      "x402-exact-algorand.json V3.refusals",
      {
        exact: 5,
        keep: ["the rows with a string that is not UTF-8", (r) => r.case.endsWith(NOT_UTF8)],
        leave: [
          "every other row, whose note, index, group, member or encoding is refused; the test above runs every row through avmCarrier and bound",
          (r) => !r.case.endsWith(NOT_UTF8),
        ],
      },
    );
    const written: [Buffer, string][] = [
      [replaced("a3 74786e 8b", "a4 c1b4786e 8b"), "c1b4786e"],
      [replaced(GEN, "a367656e ae 746573746e65742d76312e eda080"), "746573746e65742d76312e eda080"],
      [withTxnMember("a4 f4908080 05"), "f4908080"],
      [withMember("a3 7369c1 05"), "7369c1"],
      [replaced(GEN, "a367656e ad 746573746e65742d7631 80 2e30"), "746573746e65742d7631 80 2e30"],
    ];
    expect(rows.map((r) => [r.paymentIndex, r.paymentGroup, r.expect])).toEqual(
      written.map(([entry]) => [1, [V.V2.expectPaymentGroup[0], entry.toString("base64")], "avm/txn-malformed"]),
    );
    for (const [, text] of written) expect(wellFormedUtf8(bytesOf(text)), text).toBe(false);
    expect(wellFormedUtf8(bytesOf("746573746e65742d76312e30"))).toBe(true);
  });

  // The reader keeps nothing from one entry to the next. Each pair below is V2's payment entry with one last member
  // keyed by "si" or "msi" and a two-byte lead (C1) that the key's end cuts short, its value 5 in one entry and
  // "abcdefg" in the other: a member algod does not know. The pairs are presented in opposite orders, then each pair
  // again in the other order, and every answer is avm/txn-malformed.
  it("an entry's answer does not depend on what the process decoded before it", async () => {
    const payment = await completed();
    const refused = { refused: true, code: "avm/txn-malformed" };
    const pair = (key: string) => [withMember(`${key} 05`), withMember(`${key} a7 61626364656667`)];
    const [e1, e2] = pair("a3 7369c1");
    const [f1, f2] = pair("a4 6d7369c1");
    expect([wellFormedUtf8(bytesOf("7369c1")), wellFormedUtf8(bytesOf("6d7369c1"))]).toEqual([false, false]);
    const answers: unknown[] = [];
    for (const entry of [e1, e2, f2, f1, e2, e1, f1, f2]) {
      const presented = { ...payment, payload: { paymentIndex: 1, paymentGroup: [V.V2.expectPaymentGroup[0], entry!.toString("base64")] } };
      answers.push([await exactAvm.bound(presented), await exactAvm.reference(presented, O)]);
    }
    expect(answers).toEqual(Array.from({ length: 8 }, () => [refused, refused]));
  });

  // A string's bytes are judged only where the member is a string. The x402 facilitator reads every msgpack string as
  // bytes, and a string member's bytes (gen) as UTF-8 text, a sequence that is not UTF-8 becoming U+FFFD; algod reads
  // them as bytes. One string of each form RFC 3629 §4's syntax refuses (an overlong t, the surrogate U+D800, U+110000
  // above U+10FFFF, a two-byte lead the string's end cuts short, a lone continuation byte, and a str 8 of 201 bytes
  // holding C1), each after an x, is refused as gen, where the two readers read different text, and in each of the
  // four ENTRY_PLACES, a member algod does not know. Strings of the boundary code points the syntax takes, the
  // byte-order mark among them, read as gen with the file's H. The same ill-formed bytes written as a str in place of
  // the lease, a 32-byte member, are read as bytes by both and give H.
  it("a string's bytes are judged where the member is a string, and read as bytes where it is not", async () => {
    const payment = await completed();
    const presentedWith = (entry: Buffer) => ({
      ...payment,
      payload: { paymentIndex: 1, paymentGroup: [V.V2.expectPaymentGroup[0], entry.toString("base64")] },
    });
    const illFormed = ["78 c1b4", "78 eda080", "78 f4908080", "78 c3", "78 80", `c1 ${"78".repeat(200)}`];
    const wellFormed = ["78 c280", "78 dfbf", "78 e0a080", "78 ed9fbf", "78 ee8080", "78 efbbbf", "78 f0908080", "78 f48fbfbf"];
    for (const text of illFormed) expect(wellFormedUtf8(bytesOf(text)), text).toBe(false);
    for (const text of wellFormed) expect(wellFormedUtf8(bytesOf(text)), text).toBe(true);
    const places: Record<string, (s: string) => Buffer> = { ...ENTRY_PLACES, gen: (str) => replaced(GEN, `a367656e ${str}`) };
    for (const [place, at] of Object.entries(places)) {
      for (const text of illFormed) {
        const presented = presentedWith(at(msgpackStr(text)));
        const label = `${place}: ${text.slice(0, 16)}`;
        expect(await exactAvm.bound(presented), label).toEqual({ refused: true, code: "avm/txn-malformed" });
        expect(await exactAvm.reference(presented, O), label).toEqual({ refused: true, code: "avm/txn-malformed" });
      }
    }
    for (const text of wellFormed) {
      expect(await exactAvm.bound(presentedWith(replaced(GEN, `a367656e ${msgpackStr(text)}`))), `gen: ${text}`).toBe(V.V3.expectBound);
    }
    for (const text of illFormed.slice(0, 5)) {
      const lease = Buffer.concat([bytesOf(text), Buffer.alloc(32 - bytesOf(text).length, 0x78)]);
      const entry = withTxnMember(`a26c78 ${msgpackStr(lease.toString("hex"))}`);
      expect(await exactAvm.bound(presentedWith(entry)), `lx: ${text}`).toBe(V.V3.expectBound);
    }
  });

  // bound and reference hold the echoed option to the filter read applies. Each row presents V2's payment under an
  // option whose amount or timeout no build could use (x402's PaymentRequirements: `amount` a string of atomic units,
  // `maxTimeoutSeconds` a number of seconds; build writes both into the transaction): pairingOf, advertise, read and
  // build refuse each such option, and bound and reference refuse it with the row's code, the one advertise gives. An
  // option that fails the other checks (the file's option rows) is refused by bound and reference with the row's code.
  it("V3: bound and reference refuse V2's payment under an option read does not offer", async () => {
    const payment = await completed();
    expect(await exactAvm.bound(payment)).toBe(V.V3.expectBound);
    const doc = exactAvm.advertise(required(O), H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(V.V3.presentedOptions).toHaveLength(5);
    for (const row of rowsOf(V.V3.presentedOptions, "x402-exact-algorand.json V3.presentedOptions", { exact: 5 })) {
      const accepted: PaymentRequirements = row.accepted;
      const presented = { ...payment, accepted };
      expect(await exactAvm.bound(presented)).toEqual({ refused: true, code: row.expect });
      expect(await exactAvm.reference(presented, O)).toEqual({ refused: true, code: row.expect });
      expect(pairingOf(accepted)).toBeUndefined();
      expect(exactAvm.advertise(required(accepted), H, V.fixed.link, accepted)).toEqual({ refused: true, code: row.expect });
      expect(exactAvm.read({ ...doc, accepts: [accepted] })).toEqual({ refused: true, code: "x402/no-payable-option" });
      expect(await exactAvm.build({ required: required(accepted), accepted, payer: V.fixed.payer, params }, H)).toEqual({
        refused: true,
        code: row.expect,
      });
    }
    expect(V.options).toHaveLength(3);
    for (const row of rowsOf(V.options, "x402-exact-algorand.json options", { exact: 3 })) {
      const presented = { ...payment, accepted: row.option };
      expect(await exactAvm.bound(presented)).toEqual({ refused: true, code: row.expect });
      expect(await exactAvm.reference(presented, O)).toEqual({ refused: true, code: row.expect });
    }
  });

  it("V4: status, as the read answers while the facts the search rests on are not yet shown, and recover", async () => {
    const ref = V.V4.reference;
    for (const row of rowsOf(V.V4.rows as V4Row[], "x402-exact-algorand.json V4.rows")) {
      const reader = readerOf(row);
      expect(withStrings(await avmStatus(ref, reader, queryOf(row.query) as never)), row.case).toEqual(row.expect);
      expect(reader.left(), `${row.case}: every page read`).toBe(0);
    }
    const input = { network: ref.network, tx: ref.txid, option: O };
    expect(await exactAvm.recover(input, readerOf({ lookup: V.V4.recover.answer }))).toBe(V.V4.recover.expect);
  });

  it("V4: status of a reader for another network is unreadable chain-mismatch", async () => {
    const reader = readerOf(V.V4.rows[0], "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k" as never);
    expect(await avmStatus(V.V4.reference, reader, paymentAct)).toEqual({ state: "unreadable", reason: "chain-mismatch", foreign: [] });
  });

  // An Algorand transaction id is the base32 of its SHA-512/256 hash, without padding: 52 characters (the file's
  // txids, from py-algorand-sdk). Each ref below holds V4's id or last valid round in another form, or another member
  // out of its form, beside a reader that answers V4's first row for any id; none is read.
  it("V4: a ref whose members are not in the form reference writes is unreadable unparseable, with nothing read", async () => {
    const ref = V.V4.reference;
    const row = (V.V4.rows as V4Row[])[0]!;
    const searched: unknown[] = [];
    const reader: AvmReader = {
      ...readerOf(row),
      transaction: async (txid) => {
        searched.push(txid);
        return readerOf(row).transaction(txid);
      },
    };
    expect(withStrings(await avmStatus(ref, reader, paymentAct))).toEqual(row.expect);
    expect(searched).toEqual([ref.txid]);
    searched.length = 0;
    const digest = base32.decode(ref.txid + "====");
    const txids = [
      ref.txid.toLowerCase(),
      ref.txid.slice(0, 51),
      ref.txid + "A",
      ref.txid + "====",
      ref.txid.slice(0, 51) + "B",
      Buffer.from(digest).toString("hex"),
      Buffer.from(digest).toString("base64"),
      "",
      null,
      1,
    ];
    for (const txid of txids) {
      expect(await avmStatus({ ...ref, txid }, reader, paymentAct)).toEqual(unparseable);
    }
    for (const lastValid of ["18446744073709551616", "99999999999999999999", "067634796", "-1", 67634796, null]) {
      expect(await avmStatus({ ...ref, lastValid }, reader, paymentAct)).toEqual(unparseable);
    }
    for (const member of ["h", "sender", "signer", "payee"]) {
      expect(await avmStatus({ ...ref, [member]: null }, reader, paymentAct)).toEqual(unparseable);
    }
    expect(await avmStatus({ ...ref, sender: ref.payee.slice(0, 57) + "A" }, reader, paymentAct)).toEqual(unparseable);
    expect(await avmStatus({ ...ref, payee: ref.payee.slice(0, 57) + "A" }, reader, paymentAct)).toEqual(unparseable);
    for (const query of [{ ...paymentAct, after: 5 }, { ...paymentAct, search: { through: "5" } }, null]) {
      expect(await avmStatus(ref, reader, query as never)).toEqual(unparseable);
    }
    expect(searched).toEqual([]);
  });

  // As above for recover, beside a reader that answers V4's recover fixture, whose note gives the file's H, for any id.
  it("V4: recover is avm/wrong-reader for an input whose tx is not as reference writes it, or whose option is not an object, with nothing read", async () => {
    const ref = { network: V.V4.reference.network, tx: V.V4.reference.txid, option: O };
    const searched: unknown[] = [];
    const reader: AvmReader = {
      ...readerOf({ lookup: V.V4.recover.answer }),
      transaction: async (txid) => {
        searched.push(txid);
        return readerOf({ lookup: V.V4.recover.answer }).transaction(txid);
      },
    };
    for (const tx of [ref.tx, V.V2.expectFeePayerTxid]) {
      expect(await exactAvm.recover({ ...ref, tx }, reader)).toBe(V.V4.recover.expect);
    }
    expect(searched).toEqual([ref.tx, V.V2.expectFeePayerTxid]);
    searched.length = 0;
    const digest = base32.decode(ref.tx + "====");
    const txids = [
      ref.tx.toLowerCase(),
      ref.tx.slice(0, 51),
      ref.tx + "====",
      ref.tx.slice(0, 51) + "B",
      Buffer.from(digest).toString("hex"),
      "",
      null,
      1,
    ];
    for (const tx of txids) {
      expect(await exactAvm.recover({ ...ref, tx } as never, reader)).toEqual({ refused: true, code: "avm/wrong-reader" });
    }
    expect(await exactAvm.recover({ ...ref, option: null } as never, reader)).toEqual({ refused: true, code: "avm/wrong-reader" });
    expect(searched).toEqual([]);
    // An input on another network than the reader's is avm/wrong-reader, whatever its tx.
    const otherNetwork = { network: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k", tx: null, option: O };
    expect(await exactAvm.recover(otherNetwork as never, reader)).toEqual({ refused: true, code: "avm/wrong-reader" });
  });

  // x402's Algorand scheme (x402-foundation/x402, specs/schemes/exact/scheme_exact_algo.md, "Signature Scheme") lets
  // a top-level transaction be authorized by an Ed25519 signature (sig), a k-of-n multisignature (msig) or a logic
  // signature (lsig). V3.authorities holds V2's payment transaction under each authority, written by algosdk 3.8.0: under
  // a multisignature, or rekeyed (to the fee payer's key, or to the payee's), bound gives the file's H and reference
  // V3's, with the signer the payment entry names. Under a logic signature, whatever key delegated it, no key signs the
  // transaction, and a transfer that names asnd is a clawback by the asset's clawback address: the profile's rule 4
  // refuses both before anything moves.
  type AuthorityRow = { case: string; authority: string; paymentIndex: number; paymentGroup: string[]; expectBound?: string; expectReference?: unknown; expect?: string };
  const AUTHORITIES = rowsOf(V.V3.authorities.rows as AuthorityRow[], "x402-exact-algorand.json V3.authorities.rows", { exact: 9 });
  it.each(AUTHORITIES.map((r) => [r.case, r] as const))("V3.authorities: %s", async (_, row) => {
    const presented = { ...(await completed()), payload: { paymentIndex: row.paymentIndex, paymentGroup: row.paymentGroup } };
    const refused = row.expect === undefined ? undefined : { refused: true, code: row.expect };
    expect(await exactAvm.bound(presented)).toEqual(refused ?? row.expectBound);
    expect(await exactAvm.reference(presented, O)).toEqual(refused ?? row.expectReference);
  });

  it("V3.authorities: each entry is V2's transaction under the authority its row names, as algosdk 3.8.0 reads it", () => {
    const v2 = decodeSignedTransaction(Buffer.from(V.V2.expectPaymentGroup[1], "base64"));
    const program = Uint8Array.from([0x06, 0x81, 0x01]);
    const feePayer = O.extra!["feePayer"] as string;
    const read = new Map(AUTHORITIES.map((r) => [r.authority, decodeSignedTransaction(Buffer.from(r.paymentGroup[1]!, "base64"))]));
    for (const r of AUTHORITIES) {
      expect([r.case, r.paymentIndex, r.paymentGroup[0]]).toEqual([r.case, 1, V.V2.expectPaymentGroup[0]]);
      const s = read.get(r.authority)!;
      if (r.authority !== "clawback") expect([r.case, s.txn.txID()]).toEqual([r.case, v2.txn.txID()]);
      const logic = s.lsig === undefined ? null : Buffer.from(s.lsig.logic).toString("hex");
      expect([r.case, logic]).toEqual([r.case, r.authority.startsWith("lsig") ? Buffer.from(program).toString("hex") : null]);
    }
    expect(read.get("msig")!.msig!.subsig.map((x) => encodeAddress(x.pk))).toEqual([V.fixed.payer, O.payTo]);
    expect(read.get("rekeyedFeePayer")!.sgnr!.toString()).toBe(feePayer);
    expect(read.get("rekeyedPayee")!.sgnr!.toString()).toBe(O.payTo);
    const lsigs = ["lsig", "lsigSig", "lsigMsig", "lsigLmsig", "lsigPqsig"].map((k) => read.get(k)!.lsig!);
    expect(lsigs.map((l) => [l.sig !== undefined, l.msig !== undefined, l.lmsig !== undefined, l.pqsig !== undefined])).toEqual([
      [false, false, false, false],
      [true, false, false, false],
      [false, true, false, false],
      [false, false, true, false],
      [false, false, false, true],
    ]);
    const clawback = read.get("clawback")!.txn;
    expect([clawback.sender.toString(), clawback.assetTransfer!.assetSender!.toString()]).toEqual([feePayer, V.fixed.payer]);
    expect(Buffer.from(clawback.note).toString()).toBe(Buffer.from(v2.txn.note).toString());
    expect(exactAvm.data.proves).toContain("a key's signature, a multisignature or a Falcon signature");
    expect(exactAvm.data.proves).toContain("a logic signature, or a transfer that names an asset sender, is no such act");
  });

  it("reference refuses a payment whose accepted is not the option it is given", async () => {
    const payment = await completed();
    expect(await exactAvm.reference(payment, O)).toEqual(V.V3.expectReference);
    expect(await exactAvm.reference(payment, { ...O, amount: "10001" })).toEqual({ refused: true, code: "x402/accepted-not-option" });
  });

  it("the option filter, advertise and read", () => {
    expect(pairingOf(O)).toBe("x402/exact/algorand");
    for (const row of rowsOf(V.options, "x402-exact-algorand.json options", { exact: 3 })) {
      expect(pairingOf(row.option)).toBeUndefined();
      expect(exactAvm.advertise(required(row.option), H, V.fixed.link, row.option)).toEqual({ refused: true, code: row.expect });
    }
    const doc = exactAvm.advertise(required(O), H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(O);
    const r = exactAvm.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect([r.h, r.link, r.offer.options]).toEqual([H, V.fixed.link, [O]]);
  });

  // build writes the suggested parameters' genesis id as each transaction's gen, a msgpack string. RFC 3629 §3
  // excludes U+D800 to U+DFFF from UTF-8, so a genesis id holding a lone surrogate, short or long, is refused. One
  // holding other characters outside ASCII, a surrogate pair among them, the byte-order mark and 197 or 198 x, or x,
  // the mark and 197 x, is written as given, its UTF-8 in the entry, and bound reads H.
  it("a genesis id holding a lone surrogate is refused, and other text is written as given", async () => {
    const build = (genesisId: string) =>
      exactAvm.build({ required: required(O), accepted: O, payer: V.fixed.payer, params: { ...params, genesisId } }, H);
    const refused = ["testnet-v1.\ud800", "\udc00testnet-v1.0", `testnet-v1.0${"x".repeat(60)}\ud83d`];
    for (const genesisId of refused) {
      expect(await build(genesisId), JSON.stringify(genesisId)).toEqual({ refused: true, code: "avm/option-malformed" });
    }
    const written = [
      V.fixed.params.genesisId,
      "testnet-v1.0\u00e9",
      "testnet-v1.0\ud83d\ude00",
      `\ufeff${"x".repeat(197)}`,
      `\ufeff${"x".repeat(198)}`,
      `x\ufeff${"x".repeat(197)}`,
    ];
    for (const genesisId of written) {
      const u = await build(genesisId);
      if ("refused" in u) throw new Error(u.code);
      const payment = u.complete(Buffer.from(V.fixed.signature, "hex"));
      if ("refused" in payment) throw new Error(payment.code);
      const entry = Buffer.from(payment.payload.paymentGroup[1]!, "base64");
      const gen = Buffer.from(msgpackStr(Buffer.from(genesisId, "utf8").toString("hex")), "hex");
      expect(entry.includes(Buffer.concat([Buffer.from("a367656e", "hex"), gen])), JSON.stringify(genesisId)).toBe(true);
      expect(await exactAvm.bound(payment)).toBe(H);
    }
  });

  // The build rows: the file's option, payer and parameters with the row's genesis id, and genesis hash where it
  // names one. A refused row gives its code. Row 1's group id and payment txid are the file's, derived by hand from the
  // canonical form; bytesToSign is "TX" and the payment's encoding, so its SHA-512/256 is the payment's id, and bound
  // reads the payment build writes. Rows 2 and 3 pin the order: the genesis id is checked before the genesis hash.
  it("build: the rows' genesis ids and genesis hashes, and the option at amount \"0\"", async () => {
    for (const row of rowsOf(V.build.rows, "x402-exact-algorand.json build.rows", { exact: 6 })) {
      const p = { ...params, genesisId: row.genesisId, genesisHash: row.genesisHash ?? params.genesisHash };
      const o: PaymentRequirements = row.amount === undefined ? O : { ...O, amount: row.amount };
      const u = await exactAvm.build({ required: required(o), accepted: o, payer: V.fixed.payer, params: p }, H);
      if (row.expect !== undefined) {
        expect(u, row.case).toEqual({ refused: true, code: row.expect });
        continue;
      }
      if ("refused" in u) throw new Error(`${row.case}: ${u.code}`);
      expect(txidOf(u.request.bytes), row.case).toBe(row.expectPaymentTxid);
      if (row.expectBytesToSign !== undefined) expect(hex(u.request.bytes), row.case).toBe(row.expectBytesToSign);
      const payment = u.complete(Buffer.from(V.fixed.signature, "hex"));
      if ("refused" in payment) throw new Error(payment.code);
      const entry = decodeSignedTransaction(Buffer.from(payment.payload.paymentGroup[1]!, "base64"));
      expect(Buffer.from(entry.txn.group!).toString("base64"), row.case).toBe(row.expectGroupId);
      if (row.expectFeePayerTxid !== undefined) {
        expect(decodeSignedTransaction(Buffer.from(payment.payload.paymentGroup[0]!, "base64")).txn.txID(), row.case).toBe(row.expectFeePayerTxid);
      }
      expect(await exactAvm.bound(payment), row.case).toBe(row.expectBound);
      expect(await exactAvm.reference(payment, o), row.case).toEqual({ ...V.V3.expectReference, txid: row.expectPaymentTxid });
    }
    expect([V.build.rows[0].genesisId.isWellFormed(), V.build.rows[2].genesisId.isWellFormed()]).toEqual([false, false]);
  });

  // A payment entry's length from the msgpack specification's formats: the entry with the file's genesis id,
  // testnet-v1.0, a fixstr of 13 bytes, with a genesis id of n bytes of UTF-8 in its place, written as a fixstr below 32
  // bytes, a str 8 below 256, a str 16 below 65,536 and a str 32 above. The fee payer's entry is V2's, 374 bytes; the
  // standalone entry is V1's 268-byte transaction under {sig, txn}: a fixmap, the fixstr keys sig and txn of 4 bytes
  // each, and a bin 8 of the 64-byte signature. Its base64 is 4 characters for each 3 bytes or part of 3 (RFC 4648 §4).
  // The carrier reads an entry of at most 8,192 characters, as build's docblock says: 6,144 bytes.
  const ENTRY_BYTES = new Map<PaymentRequirements, number>([
    [O, Buffer.from(V.V2.expectPaymentGroup[1], "base64").length],
    [V.fixed.OStandalone, V.V1.expectEncodedLength + 1 + 4 + 2 + 64 + 4],
  ]);
  const MAX_ENTRY = 8192;
  const strBytes = (n: number) => (n < 32 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5) + n;
  const entryLength = (o: PaymentRequirements, genesisId: string) =>
    4 * Math.ceil((ENTRY_BYTES.get(o)! - 13 + strBytes(Buffer.byteLength(genesisId, "utf8"))) / 3);
  const buildWith = (o: PaymentRequirements, genesisId: string) =>
    exactAvm.build({ required: required(o), accepted: o, payer: V.fixed.payer, params: { ...params, genesisId } }, H);

  it("build writes a payment entry of 8,192 base64 characters, and refuses a genesis id one byte longer", async () => {
    expect([...ENTRY_BYTES.values()]).toEqual([374, 343]);
    for (const o of ENTRY_BYTES.keys()) {
      // The longest genesis id of x whose entry is 6,144 bytes: a str 16, 3 bytes and the id's.
      const longest = MAX_ENTRY / 4 * 3 - (ENTRY_BYTES.get(o)! - 13 + 3);
      const u = await buildWith(o, "x".repeat(longest));
      if ("refused" in u) throw new Error(`${longest}: ${u.code}`);
      const payment = u.complete(Buffer.from(V.fixed.signature, "hex"));
      if ("refused" in payment) throw new Error(payment.code);
      expect(payment.payload.paymentGroup[payment.payload.paymentIndex]!.length, String(longest)).toBe(MAX_ENTRY);
      expect(await exactAvm.bound(payment)).toBe(H);
      expect(await buildWith(o, "x".repeat(longest + 1)), String(longest + 1)).toEqual({
        refused: true,
        code: "avm/option-malformed",
      });
    }
    expect(V.build.rows[4].genesisId).toBe("x".repeat(MAX_ENTRY / 4 * 3 - (374 - 13 + 3) + 1));
  });

  // Genesis ids of x, é (2 bytes of UTF-8) and U+1F600 (4 bytes), at each length, under the fee payer's option and the
  // standalone one. build refuses exactly those whose entry passes 8,192 characters, and every payment it completes
  // passes bound.
  it("every payment build completes passes bound", async () => {
    const lengths = [
      1, 12, 31, 32, 255, 256, 1000, 1445, 1446, 1452, 1453, 2890, 2891, 2905, 2906, 4000, 5700, 5779, 5780, 5781, 5810,
      5811, 5812, 6000, 9000, 70000,
    ];
    let built = 0;
    let refused = 0;
    for (const o of ENTRY_BYTES.keys()) {
      for (const c of ["x", "é", "\u{1f600}"]) {
        for (const n of lengths) {
          const genesisId = c.repeat(n);
          const option = o.extra?.["feePayer"] === undefined ? "standalone" : "fee payer";
          const name = `${option}, ${n} × U+${c.codePointAt(0)!.toString(16)}`;
          const u = await buildWith(o, genesisId);
          if (entryLength(o, genesisId) > MAX_ENTRY) {
            expect(u, name).toEqual({ refused: true, code: "avm/option-malformed" });
            refused++;
            continue;
          }
          if ("refused" in u) throw new Error(`${name}: ${u.code}`);
          const payment = u.complete(Buffer.from(V.fixed.signature, "hex"));
          if ("refused" in payment) throw new Error(payment.code);
          expect(payment.payload.paymentGroup[payment.payload.paymentIndex]!.length, name).toBe(entryLength(o, genesisId));
          expect(await exactAvm.bound(payment), name).toBe(H);
          built++;
        }
      }
    }
    expect([built, refused]).toEqual([85, 71]);
  });

  it("a genesis hash of another network is refused", async () => {
    const other = { ...params, genesisHash: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=" };
    expect(await exactAvm.build({ required: required(O), accepted: O, payer: V.fixed.payer, params: other }, H)).toEqual({
      refused: true,
      code: "avm/network-mismatch",
    });
  });

  // isAlgorandAddress reads an address's text without algosdk, as algosdk's isValidAddress reads it (hi-base32's
  // decode, which drops the last 2 bits of the 290, then the checksum): over generated keys, the zero key and the
  // all-ones key, and malformed text. A last character that differs only in those 2 bits reads as the same address.
  it("isAlgorandAddress is algosdk's isValidAddress, over generated keys and malformed text", () => {
    const keys = Array.from({ length: 256 }, (_, i) => sha512_256(new TextEncoder().encode(`key ${i}`)));
    keys.push(new Uint8Array(32), new Uint8Array(32).fill(0xff));
    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    for (const key of rowsOf(keys, "the keys", { exact: 258 })) {
      const a = encodeAddress(key);
      const lastBits = a.slice(0, -1) + ALPHABET[ALPHABET.indexOf(a.at(-1)!) ^ 3];
      for (const s of [a, lastBits]) expect([s, isAlgorandAddress(s), isValidAddress(s)]).toEqual([s, true, true]);
    }
    const a = encodeAddress(keys[7]!);
    const rows = [
      { case: "a checksum that does not match", s: a.slice(0, 10) + (a[10] === "A" ? "B" : "A") + a.slice(11) },
      { case: "lowercase", s: a.toLowerCase() },
      { case: "a character outside the alphabet", s: `1${a.slice(1)}` },
      { case: "padding in place of the last character", s: `${a.slice(0, -1)}=` },
      { case: "padding in place of the first character", s: `=${a.slice(1)}` },
      { case: "one character short", s: a.slice(0, -1) },
      { case: "one character more", s: `${a}A` },
      { case: "the base32 of the key alone", s: base32.encode(keys[7]!).replace(/=+$/, "") },
      { case: "an empty text", s: "" },
      { case: "a number", s: 7 },
      { case: "null", s: null },
    ];
    for (const row of rowsOf(rows, "the malformed addresses", { exact: 11 })) {
      expect([row.case, isAlgorandAddress(row.s), isValidAddress(row.s as string)]).toEqual([row.case, false, false]);
    }
  });
});
