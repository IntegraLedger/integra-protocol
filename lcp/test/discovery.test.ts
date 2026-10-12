// The discovery entry point against vectors/discovery.json. Every expected value is the file's, which cites LCP §2.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hash } from "../src/index.js";
import {
  emit,
  MAX_DOCUMENT_BYTES,
  parse,
  WELL_KNOWN_PATH,
  type LegalContextDocument,
} from "../src/discovery.js";

interface EmitRow {
  name: string;
  input: Record<string, unknown>;
  inputRepeat?: { member: string; char: string; count: number };
  bytes?: string;
  sha256?: string;
  etag?: string;
  refused?: string;
}
interface ParseRow {
  name: string;
  bytes?: string;
  bytesHex?: string;
  padTo?: number;
  document?: Record<string, unknown>;
  ignored?: string[];
  refused?: string;
}
const V = JSON.parse(readFileSync(new URL("../vectors/discovery.json", import.meta.url), "utf8")) as {
  emit: EmitRow[];
  parse: ParseRow[];
};
const text = new TextDecoder();
const utf8 = (s: string) => new TextEncoder().encode(s);

function inputOf(r: EmitRow): LegalContextDocument {
  const o: Record<string, unknown> = { ...r.input };
  if (r.inputRepeat !== undefined) o[r.inputRepeat.member] = r.inputRepeat.char.repeat(r.inputRepeat.count);
  return o as unknown as LegalContextDocument;
}

function bytesOf(r: ParseRow): Uint8Array {
  if (r.bytesHex !== undefined) return Uint8Array.from(Buffer.from(r.bytesHex, "hex"));
  if (r.padTo !== undefined) {
    const head = '{"terms":"https://seller.example/t.md","x-pad":"';
    const tail = '"}';
    return utf8(head + "a".repeat(r.padTo - head.length - tail.length) + tail);
  }
  return utf8(r.bytes!);
}

describe("discovery · the constants", () => {
  it("the path and the bound", () => {
    expect(WELL_KNOWN_PATH).toBe("/.well-known/legal-context.json");
    expect(MAX_DOCUMENT_BYTES).toBe(65_536);
  });
});

describe("discovery · emit, the vectors", () => {
  for (const r of V.emit) {
    it(r.name, async () => {
      const out = emit(inputOf(r));
      if (r.refused !== undefined) {
        expect(out).toEqual({ refused: true, code: r.refused });
        return;
      }
      expect(out).toBeInstanceOf(Uint8Array);
      const b = out as Uint8Array;
      expect(text.decode(b)).toBe(r.bytes);
      if (r.sha256 !== undefined) expect(createHash("sha256").update(b).digest("hex")).toBe(r.sha256);
      if (r.etag !== undefined) expect(`"${(await hash(b)).slice(2)}"`).toBe(r.etag);
    });
  }

  it("the reference document is 220 bytes", () => {
    const b = emit(inputOf(V.emit[0]!)) as Uint8Array;
    expect(b.length).toBe(220);
  });
});

describe("discovery · parse, the vectors", () => {
  for (const r of V.parse) {
    it(r.name, () => {
      const out = parse(bytesOf(r));
      if (r.refused !== undefined) {
        expect(out).toEqual({ refused: true, code: r.refused });
        return;
      }
      expect(out).not.toHaveProperty("refused");
      const ok = out as { document: LegalContextDocument; ignored: string[] };
      expect(JSON.stringify(ok.document)).toBe(JSON.stringify(r.document));
      expect(ok.ignored).toEqual(r.ignored);
    });
  }
});

describe("discovery · what emit writes, parse reads back", () => {
  for (const r of V.emit.filter((x) => x.refused === undefined)) {
    it(r.name, () => {
      const b = emit(inputOf(r)) as Uint8Array;
      const back = parse(b) as { document: LegalContextDocument; ignored: string[] };
      expect(back.ignored).toEqual([]);
      expect(emit(back.document)).toEqual(b);
    });
  }
});

describe("discovery · neither function throws", () => {
  const junk: unknown[] = [undefined, null, 0, "x", [], [1], new Uint8Array(0), { terms: {} }, Object.create(null)];
  it("emit answers a refusal for anything that is not a document", () => {
    for (const j of junk) expect(emit(j as LegalContextDocument)).toHaveProperty("refused", true);
  });
  it("parse answers a refusal for anything that is not one JSON object's bytes", () => {
    for (const j of [...junk, utf8(""), utf8("null"), utf8('"x"'), utf8("1")]) {
      expect(parse(j as Uint8Array)).toHaveProperty("refused", true);
    }
  });
});

// LCP §2.4–§2.5's member tables: a member present with a value that is not of its kind answers
// `discovery/member-malformed/` and the member's dotted path, the code docs/reference/refusals.md lists for it, from
// parse and emit alike. 7 is a number, which no member of these kinds takes.
describe("discovery · a member whose value is not of its kind", () => {
  const terms = "https://seller.example/terms/v3.md";
  const paths = [
    "terms",
    "termsFormat",
    "acceptanceRequired",
    "disputeResolution",
    "disputeResolution.method",
    "disputeResolution.jurisdiction",
    "disputeResolution.contact",
    "disputeResolution.source",
    "disputeResolution.catalog",
    "returns",
    "contact",
    "contact.legal",
    "contact.technical",
    "api",
  ];
  for (const path of paths) {
    it(path, () => {
      const [outer, inner] = path.split(".") as [string, string | undefined];
      const doc: Record<string, unknown> = { terms, [outer]: inner === undefined ? 7 : { [inner]: 7 } };
      const expected = { refused: true, code: `discovery/member-malformed/${path}` };
      expect(parse(utf8(JSON.stringify(doc)))).toEqual(expected);
      expect(emit(doc as unknown as LegalContextDocument)).toEqual(expected);
    });
  }
});
