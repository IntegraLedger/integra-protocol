// Runs vectors/x402-exact-casper.json through the casper entry point. Every expected value is the file's (C1–C4 and
// the plant, each naming its source there); the digest is also recomputed with the toolkit CEP-3009 names.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CASPER_DOMAIN_TYPES,
  hashDomainSeparator,
  hashStruct,
  hashTypedData,
  computeTypeHash,
  buildCanonicalTypeString,
  toHex,
} from "@casper-ecosystem/casper-eip-712";
import type { AtrHash } from "../src/index.js";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";
import { LEGAL_CONTEXT_SCHEMA, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import {
  CASPER_DOMAIN_TYPEHASH,
  CASPER_MAX_PAGE_CALLS,
  exactCasper,
  type CasperBlockCall,
  type CasperBlockPage,
  type CasperReader,
  type CasperUnsigned,
} from "../src/casper.js";
import { agreementValue } from "../src/core.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-casper.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const required = (o: PaymentRequirements = O): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

async function unsigned(): Promise<CasperUnsigned> {
  const u = await exactCasper.build({ required: required(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
  if ("refused" in u) throw new Error(u.code);
  return u;
}

function completed(u: CasperUnsigned) {
  const p = u.complete(V.fixed.publicKey, V.fixed.signature);
  if ("refused" in p) throw new Error(p.code);
  return p;
}

type FixtureCall = {
  transaction: string; executed: boolean; blockHeight: string | null; error: string | null; packageHash: string | null;
  entryPoint: string | null;
  args: { from?: string; to?: string; value?: string; validAfter?: string; validBefore?: string; nonce?: string };
};
type FixtureNode = {
  network: string; head: { height: string; timestamp: string }; lowest: string; setFrom: string | null;
  pages: FixtureCall[][]; fail?: boolean;
};
type Query = { act: "payment" | "agreement"; finality: "finalized"; after?: string; search?: Record<string, string | number>; others?: unknown[] };

function callOf(c: FixtureCall): CasperBlockCall {
  const a = c.args;
  return {
    ...c,
    blockHeight: c.blockHeight === null ? null : BigInt(c.blockHeight),
    args: {
      ...(a.from !== undefined ? { from: a.from } : {}),
      ...(a.to !== undefined ? { to: a.to } : {}),
      ...(a.value !== undefined ? { value: BigInt(a.value) } : {}),
      ...(a.validAfter !== undefined ? { validAfter: BigInt(a.validAfter) } : {}),
      ...(a.validBefore !== undefined ? { validBefore: BigInt(a.validBefore) } : {}),
      ...(a.nonce !== undefined ? { nonce: fromHex(a.nonce) } : {}),
    },
  };
}

/**
 * A constructed node (C4's about): the item of the reference's `(from, nonce)` on its asset set from `setFrom`, unset
 * below it and for every other item; null below `lowest` and above the head; the block `setFrom`'s pages.
 */
function nodeReader(n: FixtureNode, ref: { asset: string; from: string; nonce: string }, network: string = n.network): CasperReader {
  const fail = async (): Promise<void> => {
    if (n.fail === true) throw new ReaderError("transport");
  };
  const head = BigInt(n.head.height);
  const lowest = BigInt(n.lowest);
  const calls = n.pages.flat();
  return {
    network: network as CasperReader["network"],
    async transaction(hash) {
      await fail();
      const c = calls.find((x) => x.transaction === hash.toLowerCase());
      return c === undefined ? null : callOf(c);
    },
    async head() {
      await fail();
      return { height: head, timestamp: BigInt(n.head.timestamp) };
    },
    async lowest() {
      await fail();
      return lowest;
    },
    async nonceUsed(asset, from, nonce, height) {
      await fail();
      if (height < lowest || height > head) return null;
      const item = asset === ref.asset.toLowerCase() && from === ref.from.toLowerCase() && Buffer.from(nonce).toString("hex") === ref.nonce.slice(2);
      return item && n.setFrom !== null && height >= BigInt(n.setFrom);
    },
    async blockCalls(height, start): Promise<CasperBlockPage | null> {
      await fail();
      if (height < lowest || height > head) return null;
      if (n.setFrom === null || height !== BigInt(n.setFrom)) return { calls: [], next: null };
      const page = n.pages[start] ?? [];
      return { calls: page.map(callOf), next: start + 1 < n.pages.length ? start + 1 : null };
    },
  };
}
/** A vector row's query, its positions bigints. */
const queryOf = (q: Query) => ({
  ...q,
  ...(q.after === undefined ? {} : { after: BigInt(q.after) }),
  ...(q.search === undefined
    ? {}
    : {
        search: Object.fromEntries(
          Object.entries(q.search).map(([k, v]) => [k, k === "unset" || k === "block" ? BigInt(v as string) : v]),
        ),
      }),
});
/** recover's input for a transaction, under the vector's option. */
const recoverInput = { network: V.C4.ref.network, tx: "ab".repeat(32), option: O };
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

function mutate(base: unknown, changes: Record<string, unknown>): unknown {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    if (value === null) delete at[keys[keys.length - 1]!];
    else at[keys[keys.length - 1]!] = value;
  }
  return copy;
}

describe("x402/exact/casper", () => {
  it("C1: build's typed data hashes to CEP-3009's digest under the toolkit", async () => {
    const { request } = await unsigned();
    expect(request.kind).toBe("casper-eip712");
    const td = request.typedData;
    expect(td.domain).toEqual(V.C1.expectDomain);
    expect(plain(td.message)).toEqual(V.C1.expectMessage);
    expect(td.types.EIP712Domain).toEqual(CASPER_DOMAIN_TYPES);
    const types = { TransferWithAuthorization: td.types.TransferWithAuthorization };
    const typeString = buildCanonicalTypeString("TransferWithAuthorization", types);
    expect(toHex(computeTypeHash(typeString))).toBe(V.C1.expectTypeHash);
    const domainTypeString = `EIP712Domain(${CASPER_DOMAIN_TYPES.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(toHex(computeTypeHash(domainTypeString))).toBe(V.C1.expectDomainTypeHash);
    expect(CASPER_DOMAIN_TYPEHASH).toBe(V.C1.expectDomainTypeHash);
    expect(toHex(hashDomainSeparator(td.domain, CASPER_DOMAIN_TYPES))).toBe(V.C1.expectDomainSeparator);
    const message = { ...td.message, nonce: `0x${td.message.nonce}` };
    expect(toHex(hashStruct("TransferWithAuthorization", types, message))).toBe(V.C1.expectStructHash);
    const digest = hashTypedData(td.domain, types, td.primaryType, message, { domainTypes: CASPER_DOMAIN_TYPES });
    expect(toHex(digest)).toBe(V.C1.expectDigest);
  });

  // C2's payload is x402 v2's PaymentPayload written by hand (x402 751590a2, specs/x402-specification-v2.md §5.2.1 and
  // specs/schemes/exact/scheme_exact_casper.md L13-17, L39-50): the authorization is C1's message, and the public key
  // and signature the fixed placeholders. complete's payment is held to it whole, as JSON text.
  it("C2: complete gives x402's PaymentPayload as the Casper scheme writes it, then bound gives H", async () => {
    const byHand = {
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: O,
      payload: {
        authorization: {
          from: V.C1.expectMessage.from,
          to: V.C1.expectMessage.to,
          value: V.C1.expectMessage.value,
          validAfter: V.C1.expectMessage.validAfter,
          validBefore: V.C1.expectMessage.validBefore,
          nonce: V.C1.expectMessage.nonce,
        },
        publicKey: V.fixed.publicKey,
        signature: V.fixed.signature,
      },
    };
    expect(JSON.stringify(V.C2.expectPayload)).toBe(JSON.stringify(byHand));
    const payment = completed(await unsigned());
    expect(JSON.stringify(payment)).toBe(JSON.stringify(V.C2.expectPayload));
    expect(payment).toEqual(V.C2.expectPayload);
    expect(await exactCasper.bound(payment)).toBe(V.C2.expectBound);
    const prefixed = mutate(payment, { "payload.authorization.nonce": H });
    expect(await exactCasper.bound(prefixed)).toBe(V.C2.boundOfPrefixedNonce);
    const upper = mutate(payment, { "payload.authorization.nonce": H.slice(2).toUpperCase() });
    expect(await exactCasper.bound(upper)).toBe(V.C2.boundOfUpperCaseNonce);
    expect((await unsigned()).complete(V.C2.tagMismatch.publicKey, V.C2.tagMismatch.signature)).toEqual(
      V.C2.tagMismatch.expect,
    );
  });

  it("C3: reference names the read keys, the payee and the authorization as presented", async () => {
    const payment = completed(await unsigned());
    expect(await exactCasper.reference(payment, O)).toEqual(V.C3.expect);
    expect(await exactCasper.reference(payment, {} as PaymentRequirements)).toEqual({ refused: true, code: "x402/option-malformed" });
    const other = { ...O, ...V.C3.acceptedNotOption.optionMutate };
    expect(await exactCasper.reference(payment, other)).toEqual(V.C3.acceptedNotOption.expect);
  });

  describe("C3: settleBy for a validBefore past Number.MAX_SAFE_INTEGER", () => {
    type Row = { case: string; mutate: Record<string, string>; expect: { settleBy?: number } };
    for (const row of rowsOf(V.C3.rows as Row[], "x402-exact-casper.json C3.rows", { exact: 4 })) {
      it(row.case, async () => {
        const payment = mutate(V.C2.expectPayload, row.mutate);
        expect(await exactCasper.reference(payment, O)).toEqual(row.expect);
      });
    }

    it("the rows' values: 2^53-1 is ECMAScript's Number.MAX_SAFE_INTEGER, and 2^64-1 and 2^64 bracket a u64", () => {
      const rows = V.C3.rows as Row[];
      const before = rows.map((r) => BigInt(r.mutate["payload.authorization.validBefore"]!));
      expect(before).toEqual([2n ** 53n - 1n, 2n ** 53n, 2n ** 64n - 1n, 2n ** 64n]);
      for (const r of rowsOf(rows, "x402-exact-casper.json C3.rows", {
        keep: ["the rows whose reference records a settleBy", (r) => r.expect.settleBy !== undefined],
        leave: ["the row past a u64, whose reference is refused; the C3 rows above run it", (r) => "refused" in r.expect],
      })) expect(r.expect.settleBy).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("build signs a validBefore past 2^53-1 for the largest maxTimeoutSeconds the filter admits, and reference records it", async () => {
      const o = { ...O, maxTimeoutSeconds: Number.MAX_SAFE_INTEGER };
      const u = await exactCasper.build({ required: required(o), accepted: o, from: V.fixed.from, now: V.fixed.now }, H);
      const payment = completed(u as CasperUnsigned);
      expect(BigInt(payment.payload.authorization.validBefore)).toBe(BigInt(V.fixed.now) + BigInt(Number.MAX_SAFE_INTEGER));
      const validBefore = payment.payload.authorization.validBefore;
      expect(await exactCasper.reference(payment, o)).toEqual({
        ...V.C3.expect,
        settleBy: Number.MAX_SAFE_INTEGER,
        presented: { ...V.C3.expect.presented, validBefore },
      });
    });
  });

  describe("C4: status over a constructed node", () => {
    for (const row of rowsOf(V.C4.rows, "x402-exact-casper.json C4.rows")) {
      it(row.case, async () => {
        const reader = nodeReader(row.node, V.C4.ref);
        expect(plain(await exactCasper.status(V.C4.ref, reader, queryOf(row.query) as never))).toEqual(row.expectStatus);
      });
    }
    it("a reader for another network", async () => {
      const row = V.C4.rows[0];
      const reader = nodeReader(row.node, V.C4.ref, V.C4.wrongReader.network);
      expect(await exactCasper.status(V.C4.ref, reader, queryOf(row.query) as never)).toEqual(V.C4.wrongReader.expectStatus);
    });
    it("a reference, a query or a search position that is not one is unreadable unparseable, with nothing read", async () => {
      const ref = V.C4.ref;
      const row = V.C4.rows[0];
      const q = queryOf(row.query);
      const unparseable = { state: "unreadable", reason: "unparseable", foreign: [] };
      const refs = [
        { ...ref, h: undefined }, { ...ref, h: "0x12" }, { ...ref, nonce: `0x${"00".repeat(32)}` }, { ...ref, from: "0x12" },
        { ...ref, asset: `0x${ref.asset}` }, { ...ref, payee: "" }, { ...ref, presented: 7 },
        { ...ref, presented: { ...ref.presented, validBefore: "18446744073709551616" } },
        { ...ref, presented: undefined },
      ];
      for (const r of refs) {
        const { reader, calls } = counting(nodeReader(row.node, ref));
        expect(await exactCasper.status(r, reader, q as never)).toEqual(unparseable);
        expect(calls).toEqual([]);
      }
      for (const query of [{ ...q, finality: "final" }, { ...q, search: { block: 4242n } }, { ...q, search: { unset: 5 } }, { ...q, after: "4000" }]) {
        const { reader, calls } = counting(nodeReader(row.node, ref));
        expect(await exactCasper.status(ref, reader, query as never)).toEqual(unparseable);
        expect(calls).toEqual([]);
      }
      const upper = (s: string) => `0x${s.slice(2).toUpperCase()}`;
      for (const r of [{ ...ref, h: upper(ref.h) }, { ...ref, nonce: upper(ref.nonce) }, { ...ref, asset: ref.asset.toUpperCase() }]) {
        expect(plain(await exactCasper.status(r, nodeReader(row.node, ref), q as never))).toEqual(row.expectStatus);
      }
    });
  });

  describe("C4: a reference that is not one", () => {
    for (const row of rowsOf(V.C4.refRows, "x402-exact-casper.json C4.refRows")) {
      it(row.case, async () => {
        const ref = { ...V.C4.ref, presented: { ...V.C4.ref.presented, ...row.presented } };
        const { reader, calls } = counting(nodeReader(V.C4.rows[0].node, V.C4.ref));
        expect(plain(await exactCasper.status(ref, reader, queryOf(V.C4.rows[0].query) as never))).toEqual(row.expectStatus);
        expect(calls).toEqual([]);
      });
    }
  });

  // lcp's bound on the calls of one page: a page that gives more is beyond the read's bound, too-large.
  it(`C4: a page of more than CASPER_MAX_PAGE_CALLS (${CASPER_MAX_PAGE_CALLS}) calls is too-large`, async () => {
    const row = V.C4.rows[0];
    const filler = { ...row.node.pages[0][0], transaction: "99".repeat(32), args: { ...row.node.pages[0][0].args, nonce: "11".repeat(32) } };
    const at = (n: number) => ({ ...row.node, pages: [[...Array(n).fill(filler), row.node.pages[0][0]]] });
    expect(plain(await exactCasper.status(V.C4.ref, nodeReader(at(CASPER_MAX_PAGE_CALLS - 1), V.C4.ref), queryOf(row.query) as never))).toEqual(row.expectStatus);
    expect(await exactCasper.status(V.C4.ref, nodeReader(at(CASPER_MAX_PAGE_CALLS), V.C4.ref), queryOf(row.query) as never)).toEqual({
      state: "unreadable",
      reason: "too-large",
      foreign: [],
    });
  });

  describe("C4: recover", () => {
    for (const row of rowsOf(V.C4.recover, "x402-exact-casper.json C4.recover")) {
      it(row.case, async () => {
        const node = { ...V.C4.rows[0].node, pages: row.call === null ? [] : [[row.call]] };
        expect(await exactCasper.recover(recoverInput, nodeReader(node, V.C4.ref))).toEqual(row.expect);
      });
    }
    it("a reader for another network, or a reader that fails", async () => {
      const node = V.C4.rows[0].node;
      expect(await exactCasper.recover(recoverInput, nodeReader(node, V.C4.ref, "casper:casper"))).toEqual({ refused: true, code: "casper/wrong-reader" });
      expect(await exactCasper.recover(recoverInput, nodeReader({ ...node, fail: true }, V.C4.ref))).toEqual({ refused: true, code: "casper/unreadable" });
    });
    // A contract package hash is 32 bytes (casper-types' PackageHash), which the option writes as 64 hex digits.
    // recover reads the authorization call on the option's package, so an option naming no package hash is one the
    // rail cannot read: casper/wrong-reader, with nothing read, as for a tx that is not 64 hex digits
    // (docs/reference/refusals.md). A hash in either case is the same 32 bytes.
    it("recover refuses an option whose asset is not a package hash as casper/wrong-reader, with nothing read", async () => {
      const node = V.C4.rows[0].node;
      for (const asset of [undefined, null, 7, `0x${O.asset}`, O.asset.slice(2), `hash-${O.asset}`]) {
        const { reader, calls } = counting(nodeReader(node, V.C4.ref));
        const input = { ...recoverInput, option: { ...O, asset } };
        expect([asset, await exactCasper.recover(input as never, reader)]).toEqual([
          asset,
          { refused: true, code: "casper/wrong-reader" },
        ]);
        expect([asset, calls]).toEqual([asset, []]);
      }
      for (const input of [{ ...recoverInput, option: null }, { ...recoverInput, tx: "0x12" }, null]) {
        const { reader, calls } = counting(nodeReader(node, V.C4.ref));
        expect(await exactCasper.recover(input as never, reader)).toEqual({ refused: true, code: "casper/wrong-reader" });
        expect(calls).toEqual([]);
      }
      const upper = { ...recoverInput, option: { ...O, asset: O.asset.toUpperCase() } };
      expect(await exactCasper.recover(upper, nodeReader(node, V.C4.ref))).toEqual(V.C4.recover[0].expect);
    });
  });

  describe("C5: the act agreement", () => {
    const agreed = async () => {
      const u = await exactCasper.build({ required: required(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H, "agreement");
      if ("refused" in u) throw new Error(u.code);
      return u;
    };
    it("build signs the agreement's value as the nonce, its digest the toolkit's", async () => {
      expect(await agreementValue(H)).toBe(V.C5.agreementValue);
      const { request } = await agreed();
      const td = request.typedData;
      expect(td.message.nonce).toBe(V.C5.expectMessageNonce);
      const types = { TransferWithAuthorization: td.types.TransferWithAuthorization };
      const message = { ...td.message, nonce: `0x${td.message.nonce}` };
      expect(toHex(hashStruct("TransferWithAuthorization", types, message))).toBe(V.C5.expectStructHash);
      const digest = hashTypedData(td.domain, types, td.primaryType, message, { domainTypes: CASPER_DOMAIN_TYPES });
      expect(toHex(digest)).toBe(V.C5.expectDigest);
      const payment = completed(await unsigned());
      expect(completed(await agreed()).payload.authorization).toEqual({ ...payment.payload.authorization, nonce: V.C5.expectMessageNonce });
    });
    for (const row of rowsOf(V.C5.bound, "x402-exact-casper.json C5.bound")) {
      it(`bound: ${row.case}`, async () => {
        const p = completed(row.payload === "agreement" ? await agreed() : await unsigned());
        expect(await exactCasper.bound(p, row.given)).toEqual(row.expect);
      });
    }
    it("reference, given the act agreement and H, names the agreement's value; given the payment's, refuses", async () => {
      const p = completed(await agreed());
      expect(await exactCasper.reference(p, O, { act: "agreement", h: H })).toEqual(V.C5.reference);
      expect(await exactCasper.reference(p, O, { act: "payment", h: H })).toEqual({ refused: true, code: "casper/nonce-not-bound" });
    });
    it(`reference: ${V.C5.referenceEchoed.case}`, async () => {
      const doc = exactCasper.advertise(required(), H, V.fixed.link, O) as PaymentRequired;
      const echoed = async (act: "payment" | "agreement") => {
        const u = await exactCasper.build({ required: doc, accepted: O, from: V.fixed.from, now: V.fixed.now }, H, act);
        if ("refused" in u) throw new Error(u.code);
        return completed(u);
      };
      expect(await exactCasper.reference(await echoed("payment"), O)).toEqual(V.C5.referenceEchoed.payment);
      expect(await exactCasper.reference(await echoed("agreement"), O)).toEqual(V.C5.referenceEchoed.agreement);
    });
    it(V.C5.status.case, async () => {
      const ref = { ...V.C5.reference, h: H };
      const reader = nodeReader(V.C5.status.node, ref);
      expect(plain(await exactCasper.status(ref, reader, queryOf(V.C5.status.query) as never))).toEqual(V.C5.status.expectStatus);
    });
  });

  it(`plant: ${V.plant.case}`, async () => {
    const reader = nodeReader(V.plant.node, V.C4.ref);
    expect(plain(await exactCasper.status(V.C4.ref, reader, queryOf(V.C4.rows[0].query) as never))).toEqual(V.plant.expectStatus);
  });

  describe("refusal codes left to the implementation", () => {
    for (const row of rowsOf(V.refusals.rows, "x402-exact-casper.json refusals.rows")) {
      it(row.case, async () => {
        if (row.fn === "bound" || row.fn === "reference") {
          const payment = mutate(V.C2.expectPayload, row.mutate);
          expect(await (row.fn === "bound" ? exactCasper.bound(payment) : exactCasper.reference(payment, O))).toEqual(row.expect);
        } else if (row.fn === "build" && "choice" in row) {
          expect(await exactCasper.build(row.choice, H)).toEqual(row.expect);
        } else if (row.fn === "build") {
          const option = { ...O, ...(row.optionMutate ?? {}) } as PaymentRequirements;
          const from = row.from ?? V.fixed.from;
          expect(await exactCasper.build({ required: required(option), accepted: option, from, now: V.fixed.now }, H)).toEqual(
            row.expect,
          );
        } else {
          expect((await unsigned()).complete(row.publicKey, row.signature)).toEqual(row.expect);
        }
      });
    }
  });

  it("advertise and read: the legal context in extensions.legalContext, accepts untouched", () => {
    const doc = exactCasper.advertise(required(), H, V.fixed.link, O);
    expect(doc).toEqual({
      ...required(),
      extensions: {
        legalContext: { info: { type: "sha256", value: H, legalContextUrl: V.fixed.link }, schema: LEGAL_CONTEXT_SCHEMA },
      },
    });
    const read = exactCasper.read(doc as PaymentRequired);
    expect(read).toEqual({ h: H, link: V.fixed.link, offer: { required: doc, options: [O] } });
    expect(exactCasper.advertise(required(), H, "http://atr.seller.example/x", O)).toEqual({
      refused: true,
      code: "x402/link-not-https",
    });
    const evm = { ...O, network: "eip155:84532" };
    expect(exactCasper.advertise(required(evm), H, V.fixed.link, evm)).toEqual({
      refused: true,
      code: "x402/option-not-this-pairing",
    });
  });

  it("unplaced hands a plain option back as the same object", () => {
    expect(exactCasper.unplaced(O)).toBe(O);
  });
});
