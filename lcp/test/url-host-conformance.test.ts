// The host parser this package carries, against the conformance files of the standards it implements, each fetched from
// its pinned address and checked against its SHA-256 before it is read (scripts/idna/fetch-pinned.mjs), and kept in
// node_modules/.cache/url-conformance/:
// - Unicode's IdnaTestV2.txt 17.0.0, every row: UTS #46 ToASCII with the file's own flags (domainToAscii strict), and
//   with the URL Standard's flags (domainToAscii), where the file's status codes for the flags the Standard sets false
//   (A4_1 and A4_2 for VerifyDnsLength, U1 for UseSTD3ASCIIRules, V2 and V3 for CheckHyphens) are not failures; and
//   the Punycode encoder and decoder against RFC 3492's own procedures (rfc3492.ts) on every label of every row;
// - Unicode's NormalizationTest.txt 17.0.0, every row and every code point part 1 does not list (normalization form C);
// - the web-platform-tests url suite at 42cbc75a: toascii.json, IdnaTestV2.json and urltestdata.json's rows with no
//   base, each as its harness reads it, through the URL https://<input>/x or the input itself.
// Each set asserts its row count and no difference. The same rows run against the runtime's own URL and their
// differences are printed as data, never failed: the runtime's host step is its own, and may read another Unicode
// version or rule.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { domainToAscii, parseHost, readUrl } from "../src/core.js";
import { nfc, punycodeDecode, punycodeEncode } from "../src/internal/url-host.js";
import { rfc3492Decode, rfc3492Encode } from "./rfc3492.js";
import { rowsOf } from "./rows.js";

const WPT_PIN = "42cbc75a89c64ce896ad20736f2393dba7ba2e91";
const WPT = `https://raw.githubusercontent.com/web-platform-tests/wpt/${WPT_PIN}/url/resources`;
const UCD = "https://www.unicode.org/Public/17.0.0";
const FILES = {
  idnaTest: [`${UCD}/idna/IdnaTestV2.txt`, "beb5d0be20e896189b03209a82fdc34f06351502bbd4b8e2523583fc2954d9cf"],
  normalizationTest: [
    `${UCD}/ucd/NormalizationTest.txt`,
    "5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db",
  ],
  derivedAge: [`${UCD}/ucd/DerivedAge.txt`, "f8ecdf768bdc210f201abd271d9bc587825618a86a7046a8146cc816393f1998"],
  toascii: [`${WPT}/toascii.json`, "644eba9d5b593df8095cfa307222f3014542ff9cc02d555f8e5660059d80470f"],
  wptIdnaTest: [`${WPT}/IdnaTestV2.json`, "84de621e5239676e59e5a3e68ef3e2b1acde9da5480a633d2ef446ef03238b76"],
  urltestdata: [`${WPT}/urltestdata.json`, "81e85fd3c199c08ef9c34cf651b3580eeedd080316493bfaf277a6b5ff8cf652"],
} as const;
const CACHE = new URL("../node_modules/.cache/url-conformance/", import.meta.url);
const text: Partial<Record<keyof typeof FILES, string>> = {};

beforeAll(async () => {
  const { fetchPinned } = (await import(new URL("../../scripts/idna/fetch-pinned.mjs", import.meta.url).href)) as {
    fetchPinned: (url: string, sha256: string) => Promise<Uint8Array>;
  };
  mkdirSync(CACHE, { recursive: true });
  for (const [key, [url, sha256]] of Object.entries(FILES) as [keyof typeof FILES, readonly [string, string]][]) {
    const file = new URL(sha256, CACHE);
    const held = existsSync(file) ? readFileSync(file) : undefined;
    const fresh = held !== undefined && createHash("sha256").update(held).digest("hex") === sha256;
    const bytes = fresh ? held : await fetchPinned(url, sha256);
    if (bytes !== held) writeFileSync(file, bytes);
    text[key] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }
}, 0);

const read = (key: keyof typeof FILES): string => {
  const t = text[key];
  if (t === undefined) throw new Error(`${FILES[key][0]} is not loaded: the setup fetches it`);
  return t;
};
/** The data lines of a Unicode text file, comments dropped, with their line numbers. */
const dataLines = (t: string): [number, string[]][] =>
  t.split("\n").flatMap((line, i): [number, string[]][] => {
    const body = line.split("#")[0]!.trim();
    return body === "" || body.startsWith("@") ? [] : [[i + 1, body.split(";").map((c) => c.trim())]];
  });
/** IdnaTestV2.txt's escapes, \uXXXX and \x{X…}. */
const unescape = (s: string): string =>
  s
    .replace(/\\x\{([0-9A-Fa-f]+)\}/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));
const codePoints = (s: string): number[] => s.split(" ").map((h) => Number.parseInt(h, 16));
const str = (cps: readonly number[]): string => String.fromCodePoint(...cps);
/** The rows of a web-platform-tests JSON file: its objects, the strings between them being comments. */
const wptRows = <T>(key: keyof typeof FILES): T[] =>
  (JSON.parse(read(key)) as unknown[]).filter((r): r is T => typeof r === "object" && r !== null);
/** This package's parser, the host of https://<input>/x as WPT's harness reads it. */
const harness = (input: string): string | null => readUrl(`https://${input}/x`)?.host ?? null;
/** The runtime's own URL parser, the host as WPT's harness reads it. */
const runtimeHost = (input: string): string | null => {
  try {
    return new URL(`https://${input}/x`).hostname;
  } catch {
    return null;
  }
};
const runtime = `node ${process.versions.node} (ada ${process.versions.ada}, Unicode ${process.versions.unicode})`;
/** Prints the runtime's differences from a file's expected values, as data. */
function report(set: string, compared: number, differing: string[]): void {
  const which = differing.length > 0 ? `: ${differing.join(", ")}` : "";
  console.log(`${runtime} differs from ${set} in ${differing.length} of ${compared} rows${which}`);
}

type IdnaRow = { line: number; source: string; toUnicode: string; toAsciiN: string; statuses: string[] };
const idnaRows = (): IdnaRow[] =>
  rowsOf(
    dataLines(read("idnaTest")).map(([line, c]) => {
      const source = c[0] === '""' ? "" : unescape(c[0]!);
      const toUnicode = c[1] === "" ? source : c[1] === '""' ? "" : unescape(c[1]!);
      const toAsciiN = c[3] === "" ? toUnicode : c[3] === '""' ? "" : unescape(c[3]!);
      const status = c[4] || c[2] || "[]";
      const statuses = status.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      return { line, source, toUnicode, toAsciiN, statuses };
    }),
    "IdnaTestV2.txt 17.0.0",
    { exact: 6391 },
  );
/** The status codes of the flags the URL Standard's domain parser sets false. */
const OFF_IN_URLS = new Set(["A4_1", "A4_2", "U1", "V2", "V3"]);
const FORBIDDEN_DOMAIN = /[\u0000-\u0020#%/:<>?@[\\\]^|\u007f]/;
const ASCII = /^[\u0000-\u007f]*$/;

describe("Unicode IdnaTestV2.txt 17.0.0", () => {
  it("every row: domainToAscii strict is UTS #46 ToASCII with the file's flags (toAsciiN, failing on a status)", () => {
    const expected = (r: IdnaRow): string | null => (r.statuses.length > 0 ? null : r.toAsciiN);
    const differ = idnaRows().filter((r) => domainToAscii(r.source, true) !== expected(r));
    expect(differ.map((r) => r.line)).toEqual([]);
  }, 0);
  it("every row: domainToAscii is the URL Standard's domain parser", () => {
    const rows = idnaRows();
    const expected = (r: IdnaRow): string | null => {
      const failed = r.statuses.some((s) => !OFF_IN_URLS.has(s));
      const result = ASCII.test(r.source) ? r.source.toLowerCase() : failed ? null : r.toAsciiN;
      return result === null || result === "" || FORBIDDEN_DOMAIN.test(result) ? null : result;
    };
    expect(rows.filter((r) => domainToAscii(r.source) !== expected(r)).map((r) => r.line)).toEqual([]);
    // The runtime, through the URL https://<source>/x, on the rows whose source holds no code point the URL parser
    // splits a URL at, and whose result does not end in a number (the IPv4 parser reads that).
    const whole = (r: IdnaRow) => r.source !== "" && !/[\t\n\r #%/:?@[\\\]]/.test(r.source);
    const fit = rows.filter((r) => whole(r) && !/(^|\.)(\d+|0x[0-9a-f]*)\.?$/i.test(expected(r) ?? ""));
    const differing = fit.filter((r) => runtimeHost(r.source) !== expected(r));
    report("IdnaTestV2.txt under the URL Standard's flags", fit.length, differing.map((r) => `line ${r.line}`));
  }, 0);
  it("every row: the Punycode encoder and decoder give RFC 3492's answers for each label of its three columns", () => {
    // Each label of source, toUnicode and toAsciiN is encoded as code points, and each ASCII label is decoded, after
    // xn-- where it begins with that prefix in any case.
    const labels = idnaRows().flatMap((r) => [r.source, r.toUnicode, r.toAsciiN].flatMap((s) => s.split(".")));
    const ascii = labels.filter((l) => ASCII.test(l)).map((l) => (/^xn--/i.test(l) ? l.slice(4) : l));
    const cps = labels.map((l) => Array.from(l, (c) => c.codePointAt(0)!));
    const encodeDiffer = cps.filter((l) => punycodeEncode(l) !== rfc3492Encode(l));
    const decodeDiffer = ascii.filter((l) => JSON.stringify(punycodeDecode(l)) !== JSON.stringify(rfc3492Decode(l)));
    expect([encodeDiffer.map((l) => str(l)), decodeDiffer]).toEqual([[], []]);
    // The file's counts: 37,680 labels, 20,400 of them ASCII, of which 16,496 decode to a code point past U+007F.
    const decoded = ascii.filter((l) => rfc3492Decode(l)?.some((c) => c >= 0x80));
    expect([labels.length, ascii.length, decoded.length]).toEqual([37_680, 20_400, 16_496]);
  }, 0);
});

describe("Unicode NormalizationTest.txt 17.0.0: normalization form C", () => {
  it("every row: c2 = NFC(c1) = NFC(c2) = NFC(c3), and c4 = NFC(c4) = NFC(c5)", () => {
    const rows = rowsOf(dataLines(read("normalizationTest")), "NormalizationTest.txt 17.0.0", { exact: 20034 });
    const differ = rows.filter(([, c]) => {
      const [c1, c2, c3, c4, c5] = c.slice(0, 5).map(codePoints) as [number[], number[], number[], number[], number[]];
      return [c1, c2, c3].some((x) => str(nfc(x)) !== str(c2)) || [c4, c5].some((x) => str(nfc(x)) !== str(c4));
    });
    expect(differ.map(([line]) => line)).toEqual([]);
  }, 0);
  it("every code point that part 1 does not list is its own NFC", () => {
    const t = read("normalizationTest");
    const part1 = t.slice(t.indexOf("@Part1"), t.indexOf("@Part2"));
    const listed = new Set(dataLines(part1).map(([, c]) => codePoints(c[0]!)[0]!));
    expect(listed.size).toBeGreaterThan(0);
    const differ: number[] = [];
    let checked = 0;
    for (let cp = 0; cp < 0x110000; cp++) {
      if (listed.has(cp) || (cp >= 0xd800 && cp < 0xe000)) continue;
      checked++;
      const out = nfc([cp]);
      if (out.length !== 1 || out[0] !== cp) differ.push(cp);
    }
    expect(checked).toBe(0x110000 - 0x800 - listed.size);
    expect(differ).toEqual([]);
  }, 0);
});

describe("web-platform-tests url at 42cbc75a", () => {
  it("toascii.json: every row through https://<input>/x, and through parseHost where the input is a whole host", () => {
    const rows = rowsOf(wptRows<{ input: string; output: string | null }>("toascii"), "toascii.json", { exact: 87 });
    expect(rows.filter((r) => harness(r.input) !== r.output).map((r) => r.input)).toEqual([]);
    const whole = rows.filter((r) => !/[\t\n\r/\\?#@:]|^[\u0000-\u0020]|[\u0000-\u0020]$/.test(r.input));
    expect(whole.length).toBeGreaterThan(0);
    expect(whole.filter((r) => parseHost(r.input) !== r.output).map((r) => r.input)).toEqual([]);
    const differing = rows.filter((r) => runtimeHost(r.input) !== r.output);
    report("toascii.json", rows.length, differing.map((r) => JSON.stringify(r.input)));
  }, 0);

  it("IdnaTestV2.json: every row but the empty input, which the harness skips, and those of a later Unicode", () => {
    const assigned = dataLines(read("derivedAge")).map(([, c]) => c[0]!.split("..").map((h) => Number.parseInt(h, 16)));
    const isAssigned = (cp: number) => assigned.some(([a, z]) => cp >= a! && cp <= (z ?? a!));
    // IdnaTestV2.json is generated from Unicode's latest IdnaTestV2.txt. A row that expects a host while it holds a
    // code point Unicode 17.0.0 leaves unassigned, which every 17.0.0 domain parse refuses, reads a later version's
    // data.
    const later = (r: { input: string; output: string | null }) =>
      r.output !== null && [...r.input].some((c) => !isAssigned(c.codePointAt(0)!));
    const all = rowsOf(wptRows<{ input: string; output: string | null }>("wptIdnaTest"), "IdnaTestV2.json", {
      exact: 2676,
    });
    const rows = rowsOf(all, "IdnaTestV2.json", {
      keep: ["rows of a non-empty input that read Unicode 17.0.0", (r) => r.input !== "" && !later(r)],
      leave: [
        "the empty input, and rows that expect a host of a code point Unicode 17.0.0 leaves unassigned",
        (r) => r.input === "" || later(r),
      ],
      exact: 2668,
    });
    expect(rows.filter((r) => harness(r.input) !== r.output).map((r) => r.input)).toEqual([]);
    const differing = rows.filter((r) => runtimeHost(r.input) !== r.output);
    report("IdnaTestV2.json", rows.length, differing.map((r) => JSON.stringify(r.input)));
  }, 0);

  it("urltestdata.json: each row with no base parses or fails as the file says: scheme, host, port, userinfo", () => {
    type Row = { input: string; base?: string | null; failure?: boolean } & Partial<
      Record<"protocol" | "hostname" | "port" | "username" | "password", string>
    >;
    const all = rowsOf(wptRows<Row>("urltestdata"), "urltestdata.json", { exact: 896 });
    const rows = rowsOf(all, "urltestdata.json", {
      keep: ["rows with no base", (r) => r.base == null],
      leave: ["rows with a base, which a relative reference resolves against", (r) => r.base != null],
      exact: 560,
    });
    const userinfo = (r: Row) => (r.username ?? "") + (r.password ?? "") !== "";
    const want = (r: Row) => (r.failure ? null : [r.protocol, r.hostname, r.port, userinfo(r)]);
    const ours = (r: Row) => {
      const u = readUrl(r.input);
      if (u === null) return null;
      return [`${u.scheme}:`, u.host ?? "", u.port === null ? "" : String(u.port), u.credentials];
    };
    expect(rows.filter((r) => r.failure).length).toBe(207);
    expect(rows.filter((r) => JSON.stringify(ours(r)) !== JSON.stringify(want(r))).map((r) => r.input)).toEqual([]);
    const theirs = (r: Row) => {
      const u = URL.parse(r.input);
      return u === null ? null : [u.protocol, u.hostname, u.port, u.username !== "" || u.password !== ""];
    };
    const differing = rows.filter((r) => JSON.stringify(theirs(r)) !== JSON.stringify(want(r)));
    report("urltestdata.json", rows.length, differing.map((r) => JSON.stringify(r.input)));
  }, 0);
});
