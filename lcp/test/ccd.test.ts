// Runs vectors/x402-exact-ccd.json through the ccd entry point. Every expected value is the file's (D1–D5 and the
// plant, each naming its source there); D1, D2 and the accounts are also re-derived with cborg and bs58check.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as cborg from "cborg";
import bs58check from "bs58check";
import type { AtrHash } from "../src/index.js";
import { ReaderError } from "../src/evm.js";
import { LEGAL_CONTEXT_SCHEMA, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import {
  accountBytes,
  ccdMemo,
  exactCcd,
  memoCarrier,
  pltMemo,
  type CcdItem,
  type CcdPaymentPayload,
  type CcdReader,
  type CcdUnsigned,
} from "../src/ccd.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-ccd.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const required = (o: PaymentRequirements = O): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });

function pathValue(base: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((at, k) => (at as Record<string, unknown>)[k], base);
}

function set(base: unknown, changes: Record<string, unknown>): unknown {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    at[keys[keys.length - 1]!] = value;
  }
  return copy;
}

type FixtureTransfer = { kind: "ccd" | "plt"; tokenId?: string; receiver: string; amount: string; memo: string | null };
type FixtureItem = null | "reader-error" | { state: "received" | "committed" } | {
  state: "finalized"; success: boolean; sender: string | null; transfers: FixtureTransfer[];
};
function readerFor(f: FixtureItem, network: string = V.D5.reader.network): CcdReader {
  return {
    network: network as CcdReader["network"],
    async item(): Promise<CcdItem | null> {
      if (f === "reader-error") throw new ReaderError("transport");
      if (f === null) return null;
      if (f.state !== "finalized") return { state: f.state };
      return {
        state: "finalized",
        success: f.success,
        sender: f.sender === null ? null : bytes(f.sender),
        transfers: f.transfers.map((t) => ({
          kind: t.kind,
          ...(t.tokenId !== undefined ? { tokenId: t.tokenId } : {}),
          receiver: bytes(t.receiver),
          amount: BigInt(t.amount),
          memo: t.memo === null ? null : bytes(t.memo),
        })),
      };
    },
  };
}

describe("x402/exact/ccd", () => {
  it("the fixed accounts are base58check of version byte 01 and SHA-256 of their labels", async () => {
    for (const who of ["payer", "payee", "sponsor"] as const) {
      const body = createHash("sha256").update(V.fixed[`${who}Label`]).digest();
      expect(bs58check.encode(Uint8Array.from([1, ...body]))).toBe(V.fixed[who]);
      expect(hex(accountBytes(V.fixed[who]) as Uint8Array)).toBe(body.toString("hex"));
    }
    expect(hex(accountBytes(V.fixed.payer) as Uint8Array)).toBe(V.fixed.payerBytes);
  });

  it("D1: ccdMemo and pltMemo", () => {
    expect(hex(ccdMemo(H))).toBe(V.D1.expectCcdMemo);
    expect(hex(cborg.encode(V.D1.lcpString))).toBe(V.D1.expectCcdMemo);
    expect(cborg.decode(bytes(V.D1.expectCcdMemo))).toBe(V.D1.lcpString);
    expect(hex(pltMemo(H))).toBe(V.D1.expectPltMemo);
    expect(memoCarrier(ccdMemo(H))).toBe(H);
  });

  it("D2: the PLT operations fixture decodes as the steward's encoder writes it", () => {
    const ops = bytes(V.D2.operations);
    expect(ops.length).toBe(V.D2.length);
    const tags: cborg.TagDecoder[] = [];
    tags[4] = (decode) => ({ tag: 4, v: decode() });
    tags[24] = (decode) => ({ tag: 24, v: decode() });
    tags[40307] = (decode) => ({ tag: 40307, v: decode() });
    const decoded = cborg.decode(ops, { tags, useMaps: true }) as Map<string, unknown>[];
    const transfer = decoded[0]!.get("transfer") as Map<string, { tag: number; v: unknown }>;
    const e = V.D2.expectDecoded;
    expect(transfer.get("memo")).toEqual({ tag: e.memoTag, v: bytes(e.memo) });
    expect(transfer.get("amount")).toEqual({ tag: e.amountTag, v: e.amount });
    const recipient = transfer.get("recipient")!;
    expect(recipient.tag).toBe(e.recipientTag);
    expect((recipient.v as Map<number, Uint8Array>).get(e.recipientKey)).toEqual(bytes(e.recipient));
  });

  it("D3: the CCD transaction is x402's wire form, whose memo is a 2-byte length (0x004f = 79) and then D1", () => {
    const tx = V.D3.ccd.payment.payload.signedTransaction;
    expect(tx.payload.memo).toBe(`004f${V.D1.expectCcdMemo}`);
    expect(tx.header.sponsor).toEqual({ account: V.fixed.sponsor, numSignatures: 1 });
    expect(Object.keys(tx.header)).toContain("executionEnergyAmount");
  });

  it("D3: bound gives H for a CCD and a PLT transfer", async () => {
    expect(await exactCcd.bound(V.D3.ccd.payment)).toBe(V.D3.ccd.expect);
    expect(await exactCcd.bound(V.D3.plt.payment)).toBe(V.D3.plt.expect);
  });

  describe("D3: bound's refusals", () => {
    for (const row of V.D3.rows) {
      it(row.case, async () => {
        const payment = set(V.D3[row.base].payment, row.set) as CcdPaymentPayload;
        expect(await exactCcd.bound(payment)).toEqual(row.expect);
      });
    }
  });

  describe("D3: the wire form only", () => {
    type WireRow = { case: string; base: "ccd" | "plt"; bigints?: string[]; asText?: boolean; expect: unknown };
    const presented = (row: WireRow): CcdPaymentPayload => {
      const payment = structuredClone(V.D3[row.base].payment);
      if (row.asText) payment.payload.signedTransaction = JSON.stringify(payment.payload.signedTransaction);
      const changes = Object.fromEntries((row.bigints ?? []).map((path) => [path, BigInt(pathValue(payment, path) as number)]));
      return set(payment, changes) as CcdPaymentPayload;
    };
    for (const row of V.D3.wireForm.rows as WireRow[]) {
      it(row.case, async () => {
        const payment = presented(row);
        expect(await exactCcd.bound(payment)).toEqual(row.expect);
        expect(await exactCcd.reference(payment)).toEqual(row.expect);
      });
    }
    it("complete refuses the SDK's object before serialization", async () => {
      const u = (await exactCcd.build({ required: required(), accepted: O, now: V.fixed.now }, H)) as CcdUnsigned;
      const tx = presented(V.D3.wireForm.rows[0]).payload.signedTransaction;
      expect(u.complete(tx)).toEqual(V.D3.wireForm.rows[0].expect);
    });
  });

  it("D4: reference", async () => {
    expect(await exactCcd.reference(V.D3.ccd.payment)).toEqual(V.D4.ccd.expect);
    expect(await exactCcd.reference(V.D3.plt.payment)).toEqual(V.D4.plt.expect);
  });

  describe("D5: status and recover", () => {
    for (const row of V.D5.rows) {
      it(row.case, async () => {
        const reader = readerFor(row.item);
        expect(await exactCcd.status(V.D5[row.ref], reader)).toEqual(row.expectStatus);
        expect(await exactCcd.recover({ network: V.D5.ref.network, transaction: V.D5.transaction }, reader)).toEqual(
          row.expectRecover,
        );
      });
    }
    it("a reader for another network", async () => {
      const reader = readerFor(V.D5.rows[0].item, V.D5.wrongReader.network);
      expect(await exactCcd.status(V.D5.ref, reader)).toEqual(V.D5.wrongReader.expectStatus);
      expect(await exactCcd.recover({ network: V.D5.ref.network, transaction: V.D5.transaction }, reader)).toEqual(
        V.D5.wrongReader.expectRecover,
      );
    });
  });

  it("plant: a self-transfer carrying the same memo is never the settlement", async () => {
    expect(await exactCcd.status(V.D5.ref, readerFor(V.plant.item))).toEqual(V.plant.expectStatus);
  });

  it("build: the transfer the wallet signs, and complete wraps what it returns", async () => {
    const u = (await exactCcd.build({ required: required(), accepted: O, now: V.fixed.now }, H)) as CcdUnsigned;
    expect(u.request).toEqual({
      kind: "ccd-transfer",
      network: V.fixed.network,
      sponsor: V.fixed.sponsor,
      toAddress: V.fixed.payee,
      asset: "CCD",
      amount: "1000000",
      memo: bytes(V.D1.expectCcdMemo),
      expiresBy: 1790000060,
    });
    const tx = V.D3.ccd.payment.payload.signedTransaction;
    const payment = u.complete(tx);
    expect(payment).toEqual(V.D3.ccd.payment);
    expect(await exactCcd.bound(payment as CcdPaymentPayload)).toBe(H);
    const plt = (await exactCcd.build(
      { required: required(V.fixed.OPlt), accepted: V.fixed.OPlt, now: V.fixed.now },
      H,
    )) as CcdUnsigned;
    expect(hex(plt.request.memo)).toBe(V.D1.expectPltMemo);
  });

  describe("one reading of the memo: a memo bound refuses is one status never settles, and one bound reads settles", () => {
    const blob = (m: string) => (m.length / 2).toString(16).padStart(4, "0") + m;
    const landed = (memo: string): CcdReader => ({
      network: V.D5.reader.network,
      item: async () => ({
        state: "finalized",
        success: true,
        sender: bytes(V.fixed.payerBytes),
        transfers: [{ kind: "ccd", receiver: bytes(V.fixed.payeeBytes), amount: 1000000n, memo: bytes(memo) }],
      }),
    });
    const memos: [string, string][] = V.D5.rows
      .filter((r: { item: unknown }) => typeof r.item === "object" && r.item !== null && "transfers" in r.item)
      .map((r: { case: string; item: { transfers: { memo: string | null }[] } }) => [r.case, r.item.transfers[0]?.memo])
      .filter((x: [string, string | null | undefined]) => typeof x[1] === "string");
    for (const [name, memo] of memos) {
      it(name, async () => {
        const payment = set(V.D3.ccd.payment, { "payload.signedTransaction.payload.memo": blob(memo) });
        const b = await exactCcd.bound(payment);
        const s = await exactCcd.status(V.D5.ref, landed(memo));
        expect(b === H).toBe(s.state === "settled");
      });
    }
  });

  it("the non-canonical memo rows: cborg 6.1.2's strict decode refuses the non-preferred head, and upper-case or U+FEFF text is not ccdMemo(H)", () => {
    const rows = V.D3.rows.filter((r: { expect: { code: string } }) => r.expect.code === "ccd/memo-not-lcp");
    const memos = rows.map((r: { set: Record<string, string> }) => bytes(r.set["payload.signedTransaction.payload.memo"]!.slice(4)));
    const nonPreferred = memos.find((m: Uint8Array) => hex(m).startsWith("79004d"))!;
    expect(cborg.decode(nonPreferred)).toBe(V.D1.lcpString);
    expect(() => cborg.decode(nonPreferred, { strict: true })).toThrow(/more bytes than necessary/);
    expect(memos.map((m: Uint8Array) => cborg.decode(m))).toContain(`lcp:sha256:0x${H.slice(2).toUpperCase()}`);
    const withBom = memos.find((m: Uint8Array) => hex(m).startsWith("7850efbbbf"))!;
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(withBom.subarray(2))).toBe(`﻿${V.D1.lcpString}`);
  });

  describe("advertise: payTo and extra.feePayer are base58check account addresses (the option filter)", () => {
    const payee: string = V.fixed.payee;
    const broken = payee.slice(0, -1) + (payee.endsWith("x") ? "y" : "x");
    it("the changed payee fails bs58check 4.0.0's checksum and accountBytes", () => {
      expect(() => bs58check.decode(broken)).toThrow();
      expect(accountBytes(broken)).toEqual({ refused: true, code: "ccd/address-malformed" });
    });
    for (const [name, change] of [
      ["payTo", { payTo: broken }],
      ["extra.feePayer", { extra: { feePayer: broken } }],
    ] as const) {
      it(name, () => {
        const o = { ...O, ...change } as PaymentRequirements;
        expect(exactCcd.advertise(required(o), H, V.fixed.link, o)).toMatchObject({ refused: true });
      });
    }
  });

  it("advertise and read: the legal context in extensions.legalContext, accepts untouched", () => {
    const doc = exactCcd.advertise(required(), H, V.fixed.link, O);
    expect(doc).toEqual({
      ...required(),
      extensions: {
        legalContext: { info: { type: "sha256", value: H, legalContextUrl: V.fixed.link }, schema: LEGAL_CONTEXT_SCHEMA },
      },
    });
    expect(exactCcd.read(doc as PaymentRequired)).toEqual({ h: H, link: V.fixed.link, offer: { required: doc, options: [O] } });
  });
});
