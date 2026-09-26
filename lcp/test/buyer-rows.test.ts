// Runs every vector file's buyer rows B2 and B6 through the core's hash and each pairing's read and bound. Every
// expected value is the file's.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, hash, hashEquals, type AtrHash } from "../src/index.js";

interface Row {
  name: string;
  pairing: string;
  input: {
    doc?: unknown;
    servesHex?: string;
    presented?: unknown;
    check?: { bytesHex: string }[];
  };
  advertised?: string;
  servedHash?: string;
  expect: unknown;
}
interface Group {
  rows: Row[];
  noSignedPayment?: Record<string, string>;
}
interface Pairing {
  id: string;
  read(doc: unknown): { h: AtrHash } | { refused: true; code: string };
  bound(presented: unknown): Promise<AtrHash | { refused: true; code: string }>;
}

const dir = new URL("../vectors/", import.meta.url);
const groups: { file: string; group: Group }[] = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .sort()
  .map((file) => ({ file, data: JSON.parse(readFileSync(new URL(file, dir), "utf8")) as { buyer?: Group } }))
  .filter((f) => f.data.buyer !== undefined)
  .map((f) => ({ file: f.file, group: f.data.buyer! }));
const rows = groups.flatMap(({ file, group }) => group.rows.map((row) => ({ file, row })));
const fromHex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));
const pairing = (id: string): Pairing => {
  const b = BINDINGS.find((x) => x.id === id);
  if (b === undefined) throw new Error(`no pairing ${id}`);
  return b as unknown as Pairing;
};

/** The buyer's check of a payment against ATR bytes: the bytes' hash when the payment's bound hash equals it. */
async function check(bytes: Uint8Array, presented: unknown, p: Pairing): Promise<{ h: AtrHash } | { decline: string }> {
  const h = await hash(bytes);
  const b = await p.bound(structuredClone(presented));
  return typeof b === "string" && hashEquals(b, h) ? { h } : { decline: "signed-not-bound" };
}

describe("the buyer rows B2 and B6 of every pairing's vector file", () => {
  it("every pairing has one B2 row, and one B6 row unless its file says why it holds no signed payment", () => {
    for (const { row } of rows) expect(["B2", "B6"]).toContain(row.name);
    for (const b of BINDINGS) {
      const own = rows.filter(({ row }) => row.pairing === b.id);
      const b2 = own.filter(({ row }) => row.name === "B2");
      const b6 = own.filter(({ row }) => row.name === "B6");
      expect(b2.length, b.id).toBe(1);
      const file = b2[0]!.file;
      const none = groups.find((g) => g.file === file)!.group.noSignedPayment ?? {};
      if (b.id in none) {
        expect(b6.length, b.id).toBe(0);
        expect(none[b.id], b.id).toMatch(/\S/);
      } else {
        expect(b6.map((x) => x.file), b.id).toEqual([file]);
      }
    }
    const ids = new Set(BINDINGS.map((b) => b.id as string));
    for (const { row } of rows) expect(ids.has(row.pairing), row.pairing).toBe(true);
    for (const { group } of groups) for (const id of Object.keys(group.noSignedPayment ?? {})) expect(ids.has(id), id).toBe(true);
  });

  it("the pairings without a B6 row are those whose files hold no payment signed by the buyer with a place for H, and x402/exact/aptos, whose key is made at each run", () => {
    const none = groups.flatMap(({ group }) => Object.keys(group.noSignedPayment ?? {})).sort();
    expect(none).toEqual([
      "ack/payment-request",
      "acp/checkout/undelegated",
      "card/seller-reference",
      "mpp/charge/card",
      "mpp/charge/evm/hash",
      "mpp/charge/evm/transaction",
      "mpp/charge/stripe",
      "mpp/subscription/stripe",
      "ucp/booking/unsigned",
      "ucp/checkout/unsigned",
      "x402/exact/aptos",
    ]);
  });

  for (const { file, row } of rows.filter(({ row }) => row.name === "B2")) {
    it(`${file} B2 ${row.pairing}: the document advertises H, and the served bytes hash to another value`, async () => {
      const read = pairing(row.pairing).read(structuredClone(row.input.doc));
      if ("refused" in read) throw new Error(read.code);
      expect(hashEquals(read.h, row.advertised!)).toBe(true);
      const served = await hash(fromHex(row.input.servesHex!));
      expect(served).toBe(row.servedHash);
      expect(hashEquals(read.h, served)).toBe(false);
      expect(row.expect).toEqual({ decline: "hash-mismatch", signCalls: 0 });
      const b6 = rows.find((x) => x.file === file && x.row.name === "B6" && x.row.pairing === row.pairing);
      if (b6 !== undefined) {
        expect(await hash(fromHex(b6.row.input.check![0]!.bytesHex))).toBe(row.advertised);
        expect(b6.row.input.check![1]!.bytesHex).toBe(row.input.servesHex);
      }
    });
  }

  for (const { file, row } of rows.filter(({ row }) => row.name === "B6")) {
    it(`${file} B6 ${row.pairing}: the payment is bound to the ATR's hash and not to the planted ATR's`, async () => {
      const p = pairing(row.pairing);
      const got = [];
      for (const c of row.input.check!) got.push(await check(fromHex(c.bytesHex), row.input.presented, p));
      expect(got).toEqual(row.expect);
    });
  }
});

// x402's lnbtc buyer recomputes the request hash from its own request, so each lnbtc B2 row's inputs carry that
// request: x402's published example, GET of the row's resource with an empty body. Its `http:1` canonical description,
// written out here from x402's scheme_exact_lnbtc.md (members in RFC 8785 order, bodyHash the SHA-256 of no bytes),
// hashes to the option's requestHash.
describe("the lnbtc B2 rows carry the buyer's own request", () => {
  const DESCRIPTION =
    '{"bodyHash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","domain":"x402:exact:lnbtc:bolt11:http:1",' +
    '"headers":[],"method":"GET","url":"https://api.example.com/article/A"}';
  const lnbtc = rows.filter(({ row }) => row.name === "B2" && row.pairing.startsWith("x402/exact/lnbtc"));

  it("both lnbtc pairings have a B2 row", () => {
    expect(lnbtc.map(({ row }) => row.pairing).sort()).toEqual(["x402/exact/lnbtc", "x402/exact/lnbtc/invoice-named"]);
  });

  for (const { file, row } of lnbtc) {
    it(`${file} B2: inputs.request is GET of the resource, whose description hashes to the option's requestHash`, async () => {
      const doc = row.input.doc as { resource: { url: string }; accepts: { extra: { requestHash: string } }[] };
      const inputs = (row.input as { inputs?: { request?: unknown } }).inputs;
      expect(inputs?.request).toEqual({ method: "GET", url: doc.resource.url });
      expect(doc.resource.url).toBe("https://api.example.com/article/A");
      expect(await hash(new TextEncoder().encode(DESCRIPTION))).toBe(`0x${doc.accepts[0]!.extra.requestHash}`);
    });
  }
});
