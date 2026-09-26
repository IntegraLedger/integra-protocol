// Expected values come from vectors/core-vectors.json and from the fixed values written below with their sources.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assemble,
  canonicalJson,
  digestJson,
  fromLcpString,
  fromLegalContext,
  fromRawBytes,
  hash,
  hashEquals,
  isHashWithNonHttpsLink,
  newAtrId,
  toLcpString,
  toLegalContext,
  toRawBytes,
  type Json,
} from "../src/index.js";

type Vector = {
  name: string;
  id?: string;
  binding?: [string, Json];
  content?: [string, string][];
  expectBytesHex?: string;
  expectHash: string;
  bytesHex?: string;
};
const file = JSON.parse(readFileSync(new URL("../vectors/core-vectors.json", import.meta.url), "utf8")) as {
  vectors: Vector[];
  refusals: { name: string; contentHex?: string; expect: string }[];
};
const vector = (name: string): Vector => file.vectors.find((v) => v.name === name)!;
const refusalOf = (name: string) => file.refusals.find((r) => r.name === name)!;

const fromHex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, "hex"));
const toHexString = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

async function assembleVector(v: Vector) {
  return assemble(v.id!, v.binding!, v.content!.map(([slot, hex]) => [slot, fromHex(hex)] as const));
}

describe("V1-V3 assembly and hashing", () => {
  for (const [name, length] of [
    ["V1", 190],
    ["V2", 129],
    ["V3", 118],
  ] as const) {
    it(`${name} gives the expected bytes and hash`, async () => {
      const v = vector(name);
      const out = await assembleVector(v);
      if ("refused" in out) throw new Error(`refused: ${out.code}`);
      expect(toHexString(out.bytes)).toBe(v.expectBytesHex);
      expect(out.bytes.length).toBe(length);
      expect(out.atrHash).toBe(v.expectHash);
    });
    it(`${name}'s expected bytes hash to the expected hash`, async () => {
      const v = vector(name);
      expect(await hash(fromHex(v.expectBytesHex!))).toBe(v.expectHash);
    });
  }

  it("V1 written by hand from the byte order", async () => {
    const out = await assemble(
      "6f1c2b0e-8d4a-4c3b-9e2f-1a7d5c9b3e40",
      ["bind", { k: "v", n: 7, list: ["a", "b"] }],
      [
        ["terms", utf8('"Pay 10000 base units of USDC for one report."')],
        ["seller", utf8('{"name":"Acme Reports"}')],
      ],
    );
    if ("refused" in out) throw new Error(out.code);
    expect(new TextDecoder().decode(out.bytes)).toBe(
      '{"atrVersion":"1","id":"6f1c2b0e-8d4a-4c3b-9e2f-1a7d5c9b3e40","bind":{"k":"v","n":7,"list":["a","b"]},"terms":"Pay 10000 base units of USDC for one report.","seller":{"name":"Acme Reports"}}',
    );
  });

  it("V3's binding part is JSON.stringify's and json.dumps' form", async () => {
    const out = await assembleVector(vector("V3"));
    if ("refused" in out) throw new Error(out.code);
    expect(toHexString(out.bytes)).toContain(
      "7b2273223a22c3a920e2809320e280a8205c22715c22205c5c202f227d",
    );
  });
});

describe("V4 equality on decoded bytes", () => {
  const h = vector("V1").expectHash;
  const rest = h.slice(2);
  it("upper-case digits are equal", () => {
    expect(hashEquals(h, h.toUpperCase().replace("0X", "0x"))).toBe(true);
  });
  it("a 0X prefix is not a hash", () => {
    expect(hashEquals("0X" + rest, h)).toBe(false);
  });
  it("63 digits are not a hash", () => {
    expect(hashEquals(h.slice(0, 65), h)).toBe(false);
  });
  it("a non-hex digit is not a hash", () => {
    expect(hashEquals("0x" + "g" + rest.slice(1), h)).toBe(false);
  });
});

describe("V5 plants: refusals", () => {
  const v1 = vector("V1");
  const content = v1.content!.map(([slot, hex]) => [slot, fromHex(hex)] as const);

  it("V5a a party slot named id", async () => {
    const out = await assemble(v1.id!, v1.binding!, [["id", utf8("1")]]);
    expect(out).toEqual({ refused: true, code: refusalOf("V5a").expect });
  });
  it("V5b two JSON values", async () => {
    const out = await assemble(v1.id!, v1.binding!, [["offer", fromHex(refusalOf("V5b").contentHex!)]]);
    expect(out).toEqual({ refused: true, code: refusalOf("V5b").expect });
  });
  it("V5c bytes that are not UTF-8", async () => {
    const out = await assemble(v1.id!, v1.binding!, [["offer", fromHex(refusalOf("V5c").contentHex!)]]);
    expect(out).toEqual({ refused: true, code: refusalOf("V5c").expect });
    // The same two bytes inside a JSON string, where only the UTF-8 check can refuse them.
    const inString = await assemble(v1.id!, v1.binding!, [["offer", fromHex("22c32822")]]);
    expect(inString).toEqual({ refused: true, code: refusalOf("V5c").expect });
  });
  it("V5d a binding containing 1.5", async () => {
    const out = await assemble(v1.id!, ["bind", { n: 1.5 }], content);
    expect(out).toEqual({ refused: true, code: refusalOf("V5d").expect });
  });
  it("V5e an ATR over maxBytes", async () => {
    const over = await assemble(v1.id!, v1.binding!, content, { maxBytes: 189 });
    expect(over).toEqual({ refused: true, code: refusalOf("V5e").expect });
    const fits = await assemble(v1.id!, v1.binding!, content, { maxBytes: 190 });
    expect("refused" in fits).toBe(false);
  });
});

describe("V6 the one-byte plant", () => {
  it("hashes to its own value, never equal to V1's", async () => {
    const plant = vector("V6-plant");
    const h = await hash(fromHex(plant.bytesHex!));
    expect(h).toBe(plant.expectHash);
    expect(hashEquals(h, vector("V1").expectHash)).toBe(false);
  });
});

describe("slot names and content form", () => {
  const id = "6f1c2b0e-8d4a-4c3b-9e2f-1a7d5c9b3e40";
  it("refuses a slot name outside the set", async () => {
    expect(await assemble(id, ["bind", {}], [["-x", utf8("1")]])).toEqual({ refused: true, code: "core/slot-name" });
    expect(await assemble(id, ["bind", {}], [["a b", utf8("1")]])).toEqual({ refused: true, code: "core/slot-name" });
    expect(await assemble(id, ["bind", {}], [["a".repeat(65), utf8("1")]])).toEqual({
      refused: true,
      code: "core/slot-name",
    });
  });
  it("refuses atrVersion and the binding's slot as party slots", async () => {
    expect(await assemble(id, ["bind", {}], [["atrVersion", utf8("1")]])).toEqual({
      refused: true,
      code: "core/slot-reserved",
    });
    expect(await assemble(id, ["bind", {}], [["bind", utf8("1")]])).toEqual({ refused: true, code: "core/slot-reserved" });
  });
  it("refuses a duplicate slot", async () => {
    expect(await assemble(id, ["bind", {}], [["a", utf8("1")], ["a", utf8("2")]])).toEqual({
      refused: true,
      code: "core/slot-duplicate",
    });
  });
  it("refuses a byte-order mark, empty content and malformed JSON", async () => {
    for (const bad of [
      Uint8Array.of(0xef, 0xbb, 0xbf, 0x31),
      utf8(""),
      utf8("   "),
      utf8("{"),
      utf8('{"a":}'),
      utf8("[1,]"),
      utf8("01"),
      utf8("1."),
      utf8('"\\x"'),
      utf8('"a\u0001"'),
      utf8("tru"),
      Uint8Array.of(0x22, 0xed, 0xa0, 0x80, 0x22),
      Uint8Array.of(0x22, 0xc0, 0xaf, 0x22),
    ]) {
      expect(await assemble(id, ["bind", {}], [["x", bad]])).toEqual({ refused: true, code: "core/content-not-json" });
    }
  });
  it("carries escapes, numbers, duplicates and whitespace as given", async () => {
    const given = utf8(' \t{"a" : [1, -0.5e+10, true, false, null, "\\u00e9\\n"], "a": {}}\r\n');
    const out = await assemble(id, ["bind", {}], [["x", given]]);
    if ("refused" in out) throw new Error(out.code);
    const text = new TextDecoder().decode(out.bytes);
    expect(text.endsWith(`"x":${new TextDecoder().decode(given)}}`)).toBe(true);
  });
  it("refuses more than 64 party slots", async () => {
    const slots = Array.from({ length: 65 }, (_, i) => [`s${i}`, utf8("1")] as const);
    expect(await assemble(id, ["bind", {}], slots)).toEqual({ refused: true, code: "core/too-large" });
  });
});

describe("nesting is bounded", () => {
  const id = "6f1c2b0e-8d4a-4c3b-9e2f-1a7d5c9b3e40";
  it("allows 64 levels of party content and refuses 65", async () => {
    const ok = await assemble(id, ["bind", {}], [["x", utf8("[".repeat(64) + "]".repeat(64))]]);
    expect("refused" in ok).toBe(false);
    const deep = await assemble(id, ["bind", {}], [["x", utf8("[".repeat(65) + "]".repeat(65))]]);
    expect(deep).toEqual({ refused: true, code: "core/content-not-json" });
  });
  it("refuses a binding value deeper than 64 levels", async () => {
    let v: Json = 1;
    for (let i = 0; i < 65; i++) v = [v];
    expect(await assemble(id, ["bind", v], [])).toEqual({ refused: true, code: "core/binding-not-json" });
  });
  it("digestJson refuses a value 100 000 levels deep as a value", async () => {
    let v: Json = 1;
    for (let i = 0; i < 100_000; i++) v = [v];
    expect(await digestJson(v)).toEqual({ refused: true, code: "core/content-not-json" });
  });
});

describe("digestJson", () => {
  // x402's example option; the expected digest is sha256sum over the hand-sorted form.
  const O = {
    scheme: "exact",
    network: "eip155:84532",
    amount: "10000",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
  };
  it("gives the expected digest whatever the member order", async () => {
    expect(await digestJson(O)).toBe("0xcfe6c196f3349d47f51598551a066e8a9661534eb89af6ed3b359e09acd1a256");
    const reordered = {
      extra: { version: "2", name: "USDC" },
      maxTimeoutSeconds: 60,
      payTo: O.payTo,
      asset: O.asset,
      amount: "10000",
      network: "eip155:84532",
      scheme: "exact",
    };
    expect(await digestJson(reordered)).toBe("0xcfe6c196f3349d47f51598551a066e8a9661534eb89af6ed3b359e09acd1a256");
  });
  it("canonicalJson is the form digestJson hashes", async () => {
    const text = canonicalJson(O);
    expect(text).toBe(
      '{"amount":"10000","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","extra":{"name":"USDC","version":"2"},"maxTimeoutSeconds":60,"network":"eip155:84532","payTo":"0x209693Bc6afc0C5328bA36FaF03C514EF312287C","scheme":"exact"}',
    );
    expect(await hash(utf8(text as string))).toBe(await digestJson(O));
  });
});

describe("carrier forms", () => {
  const h = vector("V1").expectHash as `0x${string}`;
  it("string form round trip", () => {
    expect(toLcpString(h)).toBe("lcp:sha256:0xf693f8353bd93131403120d11e849c7646ad8976857560b9f72ac2ebe08de12f");
    expect(fromLcpString(toLcpString(h))).toBe(h);
    expect(fromLcpString("lcp:sha256:0x1234")).toBeNull();
    expect(fromLcpString("lcp:keccak:" + h)).toBeNull();
  });
  it("raw bytes round trip", () => {
    const raw = toRawBytes(h);
    expect(raw.length).toBe(32);
    expect("0x" + toHexString(raw)).toBe(h);
    expect(fromRawBytes(raw)).toBe(h);
    expect(fromRawBytes(new Uint8Array(31))).toBeNull();
  });
  it("structured form in both spellings, and an http link refused", () => {
    const url = "https://atr.seller.example/" + h;
    expect(toLegalContext(h, url)).toEqual({ legalContext: { type: "sha256", value: h, legalContextUrl: url } });
    expect(toLegalContext(h, url, "snake")).toEqual({ legalContext: { type: "sha256", value: h, legal_context_url: url } });
    expect(fromLegalContext(toLegalContext(h, url))).toEqual({ h, url });
    expect(fromLegalContext(toLegalContext(h, url, "snake"))).toEqual({ h, url });
    expect(fromLegalContext({ legalContext: { type: "sha256", value: h, legalContextUrl: "http://atr.seller.example/x" } })).toBeNull();
    expect(fromLegalContext({ legalContext: { type: "sha256", value: "0x12", legalContextUrl: url } })).toBeNull();
    expect(fromLegalContext(null)).toBeNull();
  });
  it("emits lower case from upper-case input", () => {
    const upper = ("0x" + h.slice(2).toUpperCase()) as `0x${string}`;
    expect(toLcpString(upper)).toBe(toLcpString(h));
    expect(fromLcpString("lcp:sha256:" + upper)).toBe(h);
  });
});

describe("newAtrId", () => {
  it("is a lowercase version 4 UUID, fresh each call", () => {
    const a = newAtrId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newAtrId()).not.toBe(a);
  });
});

// a link in an otherwise well-formed legal context that is at most 2048 characters and parses as an absolute URL whose
// scheme is not https is `<ns>/link-not-https`, the same case on every entry point; every other failing link is
// `<ns>/legal-context-malformed` (core-vectors.json `links`, `refusedAs`). The core owns the one test that tells them
// apart.
describe("isHashWithNonHttpsLink", () => {
  const H = `0x${"ab".repeat(32)}`;
  it("is true for a well-formed hash whose one link, in either spelling, parses with a scheme other than https", () => {
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legalContextUrl: "http://seller.example/atr" })).toBe(true);
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legal_context_url: "ftp://seller.example/atr" })).toBe(true);
  });
  it("is false for an unparseable, empty, overlong or refused https link", () => {
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legalContextUrl: "https//seller.example" })).toBe(false);
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legalContextUrl: "" })).toBe(false);
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legalContextUrl: `http://s.example/${"a".repeat(2032)}` })).toBe(false);
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legalContextUrl: "https://u@seller.example/" })).toBe(false);
  });
  it("is false for an https link, a malformed hash, another type, disagreeing spellings or no link", () => {
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legalContextUrl: "https://seller.example/atr" })).toBe(false);
    expect(isHashWithNonHttpsLink({ type: "sha256", value: "0x1234", legalContextUrl: "http://seller.example" })).toBe(false);
    expect(isHashWithNonHttpsLink({ type: "sha512", value: H, legalContextUrl: "http://seller.example" })).toBe(false);
    expect(
      isHashWithNonHttpsLink({ type: "sha256", value: H, legalContextUrl: "http://a.example", legal_context_url: "http://b.example" }),
    ).toBe(false);
    expect(isHashWithNonHttpsLink({ type: "sha256", value: H })).toBe(false);
    expect(isHashWithNonHttpsLink([{ type: "sha256", value: H, legalContextUrl: "http://seller.example" }])).toBe(false);
    expect(isHashWithNonHttpsLink(null)).toBe(false);
  });
});
