// Runs x402-exact-stellar.json through the stellar entry point. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { ScVal, TransactionEnvelope } from "@stellar/stellar-sdk/xdr";
import { decodeStellarTx, transferEventOf } from "../src/stellar.js";
import { account, muxed, signed, simulated, type Case } from "./fixtures/stellar-signed-invocation.js";
import { rowsOf } from "./rows.js";
import type { TransactionEnvelopeWire } from "@stellar/stellar-sdk/xdr";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
const refused = (code: string) => ({ refused: true, code });
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
describe("x402-exact-stellar.json", () => {









  // SEP-41 names the event's first topic the symbol `transfer`, and CAP-67 the data map's key `to_muxed_id`; a symbol
  // led by EF BB BF (U+FEFF's UTF-8, Unicode §23.8) is another symbol. The two rows that hold one are row 0's event,
  // re-encoded with @stellar/stellar-sdk 17.2.1 with the one symbol changed.
  it("events: the rows whose symbol begins with a byte-order mark are row 0's event with that symbol changed", () => {
    const BOM = [0xef, 0xbb, 0xbf];
    const symbol = (b64: string) => {
      const v = xdr.ScVal.fromXdr(b64, "base64").toXdrObject();
      if (v.type !== 15) throw new Error("not a symbol");
      return [...v.sym.bytes];
    };
    const byCase = (prefix: string) => V.events.rows.find((r: { case?: string }) => r.case?.startsWith(prefix));
    const led = byCase("not a transfer event: the first topic is the symbol transfer led by a byte-order mark");
    const keyed = byCase("row 0's event with its data's key to_muxed_id led by a byte-order mark");
    const row0 = V.events.rows[0];
    expect(symbol(led.topic[0])).toEqual([...BOM, ...Buffer.from("transfer")]);
    expect([led.topic.slice(1), led.value]).toEqual([row0.topic.slice(1), row0.value]);
    expect(keyed.topic).toEqual(row0.topic);
    const data = (b64: string) => {
      const v = xdr.ScVal.fromXdr(b64, "base64").toXdrObject();
      if (v.type !== 17) throw new Error("not a map");
      return v.map!.map((e) => (e.key.type === 15 ? [...e.key.sym.bytes] : []));
    };
    expect(data(keyed.value)).toEqual(data(row0.value).map((k) => (Buffer.from(k).toString() === "to_muxed_id" ? [...BOM, ...k] : k)));
  });

  it("events: each transfer event's recipient and muxed id", () => {
    for (const row of rowsOf(V.events.rows, "x402-exact-stellar.json events.rows")) {
      const got = transferEventOf(row.topic, row.value);
      // The row's symbol is `mint`, an event transferEventOf reads beside `transfer` and `burn`.
      if (row.case === "not a transfer event: the first topic is another symbol") {
        expect(got, row.case).toMatchObject({ kind: "mint", from: null });
        continue;
      }
      if (typeof row.expect === "string") {
        expect(got, row.case).toEqual(refused(row.expect));
        continue;
      }
      if ("refused" in got) throw new Error(got.code);
      expect({ kind: got.kind, toBase: got.toBase, toMuxedId: got.toMuxedId === null ? null : got.toMuxedId.toString() }).toEqual({
        kind: "transfer",
        ...row.expect,
      });
    }
  });


});

describe("x402-exact-stellar.json: what the payer signs is the entry's rootInvocation", () => {
  const seller = fromHex("ca93ac1705187071d67b83c7ff0efe8108e8ec4530575d7726879333dbdabe7c");
  const other = Keypair.fromRawEd25519Seed(Buffer.from("07".repeat(32), "hex"));
  const M = muxed(seller, BigInt(V.V1.muxedId));
  const G = account(seller);
  const O = account(other.rawPublicKey());
  const A = 10_000_000n;
  const seed = fromHex(V.fixed.payerSeed);
  const agree: Case = { operation: { to: M, amount: A }, signed: { to: M, amount: A } };
  const rows: readonly (readonly [string, Case])[] = [
    ["the operation pays V1's M; the invocation the payer's entry signs pays the plain seller G", { operation: { to: M, amount: A }, signed: { to: G, amount: A } }],
    ["the invocation the payer's entry signs pays V1's M; the operation pays the plain seller G", { operation: { to: G, amount: A }, signed: { to: M, amount: A } }],
    ["the invocation the payer's entry signs has amount 10000001; the operation has 10000000", { operation: { to: M, amount: A }, signed: { to: M, amount: A + 1n } }],
    ["the invocation the payer's entry signs carries a sub-invocation", { ...agree, subInvocation: true }],
    [
      "the operation and the invocation the payer's entry signs call transfer led by a byte-order mark (EF BB BF), another function",
      { ...agree, functionName: Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("transfer")]) },
    ],
  ];
  const otherAsset = new Uint8Array(32).fill(7);
  const otherPayer = Keypair.fromRawEd25519Seed(Buffer.from("08".repeat(32), "hex"));
  const moved = (amount: bigint, x: Partial<Case> = {}): Case => ({ operation: { to: M, amount }, signed: { to: M, amount }, ...x });
  const buildRows: readonly Case[] = [
    { operation: { to: M, amount: A }, signed: { to: O, amount: A } },
    { operation: { to: M, amount: A }, signed: { to: M, amount: A + 1n } },
    { ...agree, subInvocation: true },
    moved(1_000_000_000_000n),
    moved(A, { asset: otherAsset }),
    moved(1_000_000_000_000n, { asset: otherAsset }),
    moved(A, { from: otherPayer.rawPublicKey() }),
  ];

  it("@stellar/stellar-sdk 17.2.1 reproduces V2's simulated envelope, V3's and V4's plain-G envelope, and every row built with it", async () => {
    expect(simulated(V.V2.simulatedXdr, agree)).toBe(V.V2.simulatedXdr);
    expect(await signed(V.V2.simulatedXdr, agree, seed, 1000)).toBe(V.V3.envelope);
    const plain: Case = { operation: { to: G, amount: A }, signed: { to: G, amount: A } };
    expect(await signed(V.V2.simulatedXdr, plain, seed, 1000)).toBe(V.V4[0].envelope);
    for (const [name, c] of rows) {
      const row = V.V4.find((r: { case: string }) => r.case === name);
      expect(row, name).toBeDefined();
      expect(await signed(V.V2.simulatedXdr, c, seed, 1000), name).toBe(row.envelope);
    }
    expect(other.publicKey()).toBe(V.V4build.other);
    expect(StrKey.encodeContract(Buffer.from(otherAsset))).toBe(V.V4build.otherAsset);
    expect(otherPayer.publicKey()).toBe(V.V4build.otherPayer);
    expect(buildRows.length).toBe(V.V4build.rows.length);
    buildRows.forEach((c, i) => expect(simulated(V.V2.simulatedXdr, c)).toBe(V.V4build.rows[i].simulatedXdr));
  });

});

// An envelope's length is counted in UTF-16 code units, as JavaScript's String length counts it: the rows' strings end
// in U+10000, one code point of two code units.
describe("x402-exact-stellar.json agreedRefusals: an envelope string beyond the BMP at the 8192 bound", () => {
  const rows = rowsOf(V.agreedRefusals.rows as { case: string; transaction?: string; expect: string }[], "x402-exact-stellar.json agreedRefusals.rows", {
    exact: 2,
    keep: ["the rows with a transaction string", (r) => typeof r.transaction === "string"],
    leave: [
      "the rows without one, which state the refusal in words: the agreedRefusals runner at the end of this file runs them, but for the peer-missing row, which stellar-peer-missing.test.ts runs, and row 3, which the V5 two-entry test runs",
      (r) => r.transaction === undefined,
    ],
  });
  it("the rows are 8193 and 8192 UTF-16 code units", () => {
    expect(rows.map((r) => [r.transaction!.length, [...r.transaction!].length])).toEqual([[8193, 8192], [8192, 8191]]);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      expect(decodeStellarTx(r.transaction!, "stellar:testnet")).toEqual(refused(r.expect));
    });
  }
});

// The agreedRefusals rows without a transaction string state a refusal in words. The peer-missing row runs in
// stellar-peer-missing.test.ts and row 3 in the V5 two-entry test above; each case below calls the decoder its row
// names, once for each condition the row lists, with inputs built from the file's V2 simulated envelope, V3's envelope
// and the first events row, and every result is the row's code.
describe("x402-exact-stellar.json agreedRefusals: every row that states its refusal in words runs", () => {
  const seller = StrKey.decodeEd25519PublicKey(V.fixed.seller);
  const M = muxed(seller, BigInt(V.V1.muxedId));
  const A = BigInt(V.fixed.option.amount);
  const agree: Case = { operation: { to: M, amount: A }, signed: { to: M, amount: A } };
  const seed = fromHex(V.fixed.payerSeed);

  /** decodeStellarTx of `envelope`. */
  const read = async (envelope: string) => [decodeStellarTx(envelope, "stellar:testnet")];
  /** The envelope decoded, changed, and encoded again. */
  const edited = (xdrB64: string, change: (e: TransactionEnvelopeWire) => TransactionEnvelopeWire | void): string => {
    const e = xdr.TransactionEnvelope.fromXdr(xdrB64, "base64").toXdrObject();
    return xdr.TransactionEnvelope.fromXdrObject(change(e) ?? e).toXdr("base64");
  };
  const v1Of = (e: TransactionEnvelopeWire) => {
    if (e.type !== 2) throw new Error("not a v1 envelope");
    return e.v1;
  };
  /** The envelope with Soroban data whose footprint lists `n` accounts read-only, a part the decoders do not read. */
  const withFootprint = (xdrB64: string, n: number) =>
    edited(xdrB64, (e) => {
      const readOnly = Array.from({ length: n }, (_, i) => ({ type: 0 as const, account: { accountId: { type: 0 as const, ed25519: new Uint8Array(32).fill(i) } } }));
      v1Of(e).tx.ext = {
        v: 1,
        sorobanData: {
          ext: { v: 0 },
          resources: { footprint: { readOnly, readWrite: [] }, instructions: 0, diskReadBytes: 0, writeBytes: 0 },
          resourceFee: 0n,
        },
      };
    });
  const symbol = (s: string) => nativeToScVal(s, { type: "symbol" }).toXdr("base64");

  const cases: Record<string, () => Promise<unknown[]>> = {
    "an envelope that is not strict base64 (RFC 4648 section 4's alphabet, padded to a multiple of 4, zero padding bits) of exactly one XDR v1 transaction or fee bump of one with no bytes after it, or a signature that is not 64 bytes":
      async () => {
        const envelope: string = V.V3.envelope;
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        // V3's envelope ends in one "=", so the base64 character before it carries two padding bits.
        expect(envelope.endsWith("=") && !envelope.endsWith("==")).toBe(true);
        const padBit = `${envelope.slice(0, -2)}${alphabet[alphabet.indexOf(envelope.at(-2)!) | 1]}=`;
        const trailing = Buffer.concat([Buffer.from(envelope, "base64"), Buffer.alloc(4)]).toString("base64");
        // V3's transaction as a v0 envelope: its source account's key, fee, sequence, memo, operation and signatures.
        const v0 = edited(envelope, (e) => {
          const { tx, signatures } = v1Of(e);
          if (tx.sourceAccount.type !== 0) throw new Error("not a plain source account");
          const body = { sourceAccountEd25519: tx.sourceAccount.ed25519, fee: tx.fee, seqNum: tx.seqNum, timeBounds: null, memo: tx.memo };
          return { type: 0, v0: { tx: { ...body, operations: tx.operations, ext: { v: 0 } }, signatures } };
        });
        return [
          ...(await read(`-${envelope.slice(1)}`)),
          ...(await read(envelope.slice(0, -1))),
          ...(await read(padBit)),
          ...(await read(v0)),
          ...(await read(trailing)),
        ];
      },
    "an envelope over 8192 base64 characters": async () => {
      // One account fewer, the envelope is within the bound: decodeStellarTx reads it.
      expect(withFootprint(V.V3.envelope, 136).length).toBe(8172);
      expect("refused" in decodeStellarTx(withFootprint(V.V3.envelope, 136), "stellar:testnet")).toBe(false);
      const envelope = withFootprint(V.V3.envelope, 137);
      expect(envelope.length).toBe(8224);
      return read(envelope);
    },
    "an operation that is not one transfer(from, to, amount), or an entry whose rootInvocation is not that same invocation byte for byte with no sub-invocations, checked after the carrier":
      async () => {
        const twoOperations = edited(V.V3.envelope, (e) => {
          const { tx } = v1Of(e);
          tx.operations = [tx.operations[0]!, tx.operations[0]!];
        });
        const approve = edited(V.V3.envelope, (e) => {
          const body = v1Of(e).tx.operations[0]!.body;
          if (body.type !== 24 || body.invokeHostFunctionOp.hostFunction.type !== 0) throw new Error("not an invocation");
          body.invokeHostFunctionOp.hostFunction.invokeContract.functionName = new xdr.XdrString("approve");
        });
        const otherAmount: Case = { operation: { to: M, amount: A }, signed: { to: M, amount: A + 1n } };
        const subInvocation: Case = { ...agree, subInvocation: true };
        return [
          ...(await read(twoOperations)),
          ...(await read(approve)),
          ...(await read(await signed(V.V2.simulatedXdr, otherAmount, seed, 1000))),
          ...(await read(await signed(V.V2.simulatedXdr, subInvocation, seed, 1000))),
        ];
      },
    "a transfer event whose topics or data are not a SEP-41 transfer (symbol transfer, an address to, and an i128 or a map for data), or over 1024 base64 characters":
      async () => {
        const { topic, value } = V.events.rows[0] as { topic: string[]; value: string };
        const [name, from, to, asset] = topic as [string, string, string, string];
        expect(name).toBe(symbol("transfer"));
        return [
          transferEventOf([symbol("approve"), from, to, asset], value),
          transferEventOf([nativeToScVal("transfer", { type: "string" }).toXdr("base64"), from, to, asset], value),
          transferEventOf([name, from, symbol("to"), asset], value),
          transferEventOf([name, from], value),
          transferEventOf([name, from, to, asset, asset], value),
          transferEventOf(topic, nativeToScVal(7n, { type: "u64" }).toXdr("base64")),
          transferEventOf(topic, "A".repeat(1028)),
          transferEventOf([name, from, to, "A".repeat(1028)], value),
        ];
      },
  };

  const rows = rowsOf(V.agreedRefusals.rows as { case: string; transaction?: string; expect: string }[], "x402-exact-stellar.json agreedRefusals.rows", {
    exact: Object.keys(cases).length,
    keep: [
      "the rows that state the refusal in words, which the cases above run",
      (r, i) => r.transaction === undefined && r.expect !== "stellar/peer-missing" && i !== 3,
    ],
    leave: [
      "the peer-missing row, which stellar-peer-missing.test.ts runs; row 3, which the V5 two-entry test runs by its index; and the rows with a transaction string, which the 8192-bound test above runs",
      (r, i) => r.expect === "stellar/peer-missing" || i === 3 || typeof r.transaction === "string",
    ],
  });

  it("names a case for every row, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }
});
