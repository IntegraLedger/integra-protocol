// The URL Standard's host parser and domain parser as this package carries them, and the link rules that read a URL
// with them. Expected values come from the URL Standard (url.spec.whatwg.org): the table of host parser results in §3
// and the registrable-domain table in §3.2, which shows إختبار as the host xn--kgbechtv; RFC 3492's own encoder
// (rfc3492.ts) for a long label. The conformance files are run in url-host-conformance.test.ts.
import { describe, expect, it } from "vitest";
import { domainToAscii, isHttpsLink, isOtherSchemeLink, parseHost } from "../src/core.js";
import * as root from "../src/index.js";
import { readUrl } from "../src/internal/url-host.js";
import { rfc3492Encode } from "./rfc3492.js";
import { rowsOf } from "./rows.js";
import { readFileSync } from "node:fs";

describe("parseHost: the URL Standard's table of host parser results (§3)", () => {
  const table = rowsOf(
    [
      ["EXAMPLE.COM", "example.com", "EXAMPLE.COM"],
      ["example%2Ecom", "example.com", "example%2Ecom"],
      ["faß.example", "xn--fa-hia.example", "fa%C3%9F.example"],
      ["0", "0.0.0.0", "0"],
      ["%30", "0.0.0.0", "%30"],
      ["0x", "0.0.0.0", "0x"],
      ["0xffffffff", "255.255.255.255", "0xffffffff"],
      ["[0:0::1]", "[::1]", "[::1]"],
      ["[0:0::1%5D", null, null],
      ["[0:0::%31]", null, null],
      ["09", null, "09"],
      ["example.255", null, "example.255"],
      ["example^example", null, null],
    ] as const,
    "the URL Standard's host parser examples",
    { exact: 13 },
  );
  for (const [input, domain, opaque] of table) {
    it(`${input} → ${domain ?? "failure"} (isOpaque false), ${opaque ?? "failure"} (isOpaque true)`, () => {
      expect(parseHost(input)).toBe(domain);
      expect(parseHost(input, false)).toBe(domain);
      expect(parseHost(input, true)).toBe(opaque);
    });
  }
  it("إختبار is the host xn--kgbechtv (§3.2's registrable-domain table)", () => {
    expect(parseHost("إختبار")).toBe("xn--kgbechtv");
    expect(parseHost("example.إختبار")).toBe("example.xn--kgbechtv");
  });
  it("the empty string is an opaque host, and a failure otherwise", () => {
    expect(parseHost("", true)).toBe("");
    expect(parseHost("")).toBeNull();
  });
  it("percent-encoded bytes that are not UTF-8 decode to U+FFFD, which IdnaMappingTable.txt 17.0.0 disallows", () => {
    // fa%C3%9F.example is the table's faß.example, percent-encoded: its bytes are UTF-8 and decode to it.
    expect(parseHost("fa%C3%9F.example")).toBe("xn--fa-hia.example");
    expect(parseHost("%EF%BF%BD.example")).toBeNull();
    expect(parseHost("%FF.example")).toBeNull();
    expect(parseHost("fa%C3.example")).toBeNull();
    expect(parseHost("%FF.example", true)).toBe("%FF.example");
  });
});

describe("domainToAscii: the URL Standard's domain parser (§3.3)", () => {
  it("lowercases an ASCII domain whatever ToASCII gives, when not strict", () => {
    // §3.3's note: xn--8i7caa decodes to ｗｗｗ, whose code points are mapped, so ToASCII fails on it.
    expect(domainToAscii("XN--8I7CAA.Example")).toBe("xn--8i7caa.example");
    expect(domainToAscii("xn--8i7caa", true)).toBeNull();
  });
  it("reads ☕.example as UTS #46 does (§3.3's note: xn--53h.example, not failure)", () => {
    expect(domainToAscii("☕.example")).toBe("xn--53h.example");
    expect(domainToAscii("☕.example", true)).toBe("xn--53h.example");
  });
  it("fails on an empty result or a forbidden domain code point; when strict, gives ToASCII's result", () => {
    expect(domainToAscii("")).toBeNull();
    expect(domainToAscii("a%b")).toBeNull();
    expect(domainToAscii("a b")).toBeNull();
    // U+00AD SOFT HYPHEN is ignored by the mapping: the result is empty.
    expect(domainToAscii("\u00ad")).toBeNull();
    // UseSTD3ASCIIRules refuses "_"; CheckHyphens refuses a hyphen at the label's start; VerifyDnsLength the root
    // label.
    expect([domainToAscii("a_b.example"), domainToAscii("a_b.example", true)]).toEqual(["a_b.example", null]);
    expect([domainToAscii("-a.example"), domainToAscii("-a.example", true)]).toEqual(["-a.example", null]);
    expect([domainToAscii("a.example."), domainToAscii("a.example.", true)]).toEqual(["a.example.", null]);
  });
  it("reads a lone surrogate as U+FFFD, which no domain parse accepts", () => {
    expect(domainToAscii("a\ud800.example")).toBeNull();
    expect(parseHost("a\ud800.example", true)).toBe("a%EF%BF%BD.example");
  });
  it("reads a label of any length: a letter and 300,000 combining acute accents", () => {
    // UAX #15: a and the first U+0301 compose to U+00E1, and each later U+0301 is blocked by the one before it, of the
    // same combining class (230). The label is valid in UTS #46, and RFC 3492 encodes it (rfc3492.ts). A label that
    // begins with a combining mark is refused (UTS #46 section 4.1).
    const marks = "\u0301".repeat(300_000);
    const label = `xn--${rfc3492Encode([0xe1, ...Array<number>(299_999).fill(0x301)])}`;
    expect(domainToAscii(`a${marks}`)).toBe(label);
    expect(parseHost(`a${marks}.example`)).toBe(`${label}.example`);
    expect(domainToAscii(marks)).toBeNull();
  });
});

describe("the link rules read a URL with this package's parser, on every runtime", () => {
  const rows = rowsOf(
    JSON.parse(readFileSync(new URL("../vectors/core-vectors.json", import.meta.url), "utf8")).links.rows,
    "core-vectors.json links.rows",
    { exact: 32 },
  ) as { name: string; link: string; accept: boolean; refusedAs: string }[];
  it("give every links row's answer with the runtime's URL removed", () => {
    const saved = globalThis.URL;
    let answers: [boolean, boolean][];
    try {
      Reflect.deleteProperty(globalThis, "URL");
      expect(typeof globalThis.URL).toBe("undefined");
      answers = rows.map((r) => [isHttpsLink(r.link), isOtherSchemeLink(r.link)]);
    } finally {
      globalThis.URL = saved;
    }
    expect(answers).toEqual(rows.map((r) => [r.accept, r.refusedAs === "link-not-https"]));
  });
  it("the root exports the same functions", () => {
    expect(root.domainToAscii).toBe(domainToAscii);
    expect(root.parseHost).toBe(parseHost);
  });
});

describe("readUrl: the scheme and authority of an absolute URL (URL Standard §4.4)", () => {
  it("reads the scheme, host, port and credentials", () => {
    const https = { scheme: "https", host: "example.com" };
    expect(readUrl("HTTPS://User:Pw@EXAMPLE.com:0444/p?q#f")).toEqual({ ...https, credentials: true, port: 444 });
    expect(readUrl("https://:@example.com/")).toEqual({ ...https, credentials: false, port: null });
    const v6 = { scheme: "http", host: "[::ffff:c000:201]", credentials: false, port: null };
    expect(readUrl("http://[::FFFF:192.0.2.1]:/")).toEqual(v6);
    expect(readUrl("foo://ex%41mple:7/")).toEqual({ scheme: "foo", host: "ex%41mple", credentials: false, port: 7 });
    expect(readUrl("mailto:a b@c")).toEqual({ scheme: "mailto", host: null, credentials: false, port: null });
    expect(readUrl("file://localhost/x")).toEqual({ scheme: "file", host: "", credentials: false, port: null });
    // Leading and trailing C0 controls and spaces are removed, then every tab and newline.
    const http = { scheme: "http", host: "h", credentials: false, port: null };
    expect(readUrl(" \u0000\u001fhttp://\th\n/x \u001f")).toEqual(http);
  });
  it("gives a null port for the scheme's default port, as the URL record holds it (§4.2's special schemes)", () => {
    const ports = [
      ["http://h:80/", null],
      ["http://h:0080/", null],
      ["http://h:443/", 443],
      ["HTTPS://h:443/", null],
      ["https://h:80/", 80],
      ["ws://h:80/", null],
      ["wss://h:443/", null],
      ["ftp://h:21/", null],
      ["ftp://h:22/", 22],
      ["foo://h:80/", 80],
      ["https://h:/", null],
    ] as const;
    for (const [url, port] of ports) expect([url, readUrl(url)?.port]).toEqual([url, port]);
  });
  it("fails where the authority fails, and never on a path, query or fragment", () => {
    const failing = ["https://", "https://u@/x", "https://h:65536/", "https://h:1x/", "foo://a b/", "foo://:1/"];
    for (const s of [...failing, "1http://x/", "http://a^b/"]) {
      expect(readUrl(s)).toBeNull();
    }
    for (const s of ["http://h/ %zz^`{}|\\", "http://h?\u0000 \ud800", "http://h#\u{1f600} ", "foo:/%zz ^", "foo: x"]) {
      expect(readUrl(s)).not.toBeNull();
    }
  });
});
