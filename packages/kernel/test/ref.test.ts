import { describe, expect, it } from "vitest";
import { KernelError } from "../src/errors.js";
import { isRef, parseRef } from "../src/ref.js";

const VALID =
  "lcp:sha256:0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("lcp:sha256 reference grammar", () => {
  it("parses a well-formed reference (ported carrier sha256-simple)", () => {
    expect(isRef(VALID)).toBe(true);
    expect(parseRef(VALID)).toEqual({
      hash: "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
    });
  });

  // ported carrier/string-parse.json `malformed` cases + a net-new non-hex-digest kernel case
  const malformed: [string, string][] = [
    ["prefix-only", "lcp:"],
    ["type-but-no-value-separator", "lcp:sha256"],
    ["empty-type-segment", "lcp::0xdead"],
    ["empty-value-segment", "lcp:sha256:"],
    [
      "non-hex-digest",
      "lcp:sha256:0xzz83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
    ],
  ];
  it.each(malformed)("rejects malformed %s", (_name, input) => {
    expect(isRef(input)).toBe(false);
    expect(() => parseRef(input)).toThrow(KernelError);
  });

  // net-new kernel cases: the no-whitespace reference-hardening discipline
  const whitespace: [string, string][] = [
    ["trailing space", `${VALID} `],
    [
      "embedded space",
      "lcp:sha256:0x7f83 b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d906",
    ],
  ];
  it.each(whitespace)("rejects %s with ref/whitespace", (_name, input) => {
    expect(() => parseRef(input)).toThrow(/whitespace/);
  });
});
