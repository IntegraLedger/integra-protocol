/**
 * The kernel's fail-fast guards, one case per refusal.
 *
 * The kernel is the narrow engine every other package sits on, and
 * the one the whole record rests on. The survivors were not stylistic: every slot guard in `assemble` could
 * be deleted without a single test noticing, `atrHashEquals` had NO coverage at all, and the `caps` raw-
 * number validator, and its decimal-string discipline, is exercised past its top level here.
 *
 * These are mandatory-tier under the project's own testing doctrine (hashing and record minting are
 * irreversible), so they get real cases rather than a smoke test.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assemble, type Component } from "../src/assemble.js";
import { atrHashEquals, canonicalAtrHash, isAtrHash } from "../src/atrHash.js";
import { bytesToHex, hexToBytes } from "../src/hex.js";
import { isRef, parseRef } from "../src/ref.js";
import { normalizeTerms } from "../src/terms.js";

/** The minimum a record needs to mint: id + terms, both non-empty. */
const MINIMAL: Component[] = [
  { slot: "id", value: "01J000000000000000000000" },
  { slot: "terms", value: "lcp:sha256:0x" + "ab".repeat(32) },
];

async function refuses(components: Component[], code: string): Promise<void> {
  await expect(assemble(components)).rejects.toMatchObject({ code });
}

describe("assemble — the slot guards each refuse for their OWN reason", () => {
  it("mints a minimal record", async () => {
    const { atrFile, atrHash } = await assemble(MINIMAL);
    const env = JSON.parse(new TextDecoder().decode(atrFile));
    expect(env.lcp).toBeDefined();
    expect(Object.keys(env)[0]).toBe("lcp"); // engine-stamped, always first
    expect(isAtrHash(atrHash)).toBe(true);
  });

  it("refuses a component claiming the ENGINE-STAMPED lcp slot", async () => {
    // `lcp` is stamped by the engine, never supplied. Letting a component set it would let a caller
    // forge the version the record claims conformance to.
    await refuses(
      [...MINIMAL, { slot: "lcp", value: "9.9" }],
      "assemble/reserved-slot",
    );
  });

  it("refuses integer-like slot names — they would jump ahead of lcp in emitted order", async () => {
    for (const slot of ["0", "1", "42", "4294967294"]) {
      await refuses(
        [...MINIMAL, { slot, value: "x" }],
        "assemble/numeric-slot",
      );
    }
  });

  it("ACCEPTS slot names that only look numeric — the rule is integer-like, not digit-containing", async () => {
    // The regex is anchored and rejects leading zeros/signs/decimals, so these are ordinary string keys
    // and must survive. A looser guard would refuse legitimate slots.
    for (const slot of ["01", "1.0", "-1", "1e3", "v1", "1a"]) {
      const { atrFile } = await assemble([...MINIMAL, { slot, value: "x" }]);
      expect(JSON.parse(new TextDecoder().decode(atrFile))[slot]).toBe("x");
    }
  });

  it("refuses a duplicate slot", async () => {
    await refuses(
      [
        ...MINIMAL,
        { slot: "extra", value: "a" },
        { slot: "extra", value: "b" },
      ],
      "assemble/duplicate-slot",
    );
  });

  it("refuses a component with BOTH value and ref, and one with NEITHER", async () => {
    await refuses(
      [
        ...MINIMAL,
        { slot: "x", value: "a", ref: `lcp:sha256:0x${"11".repeat(32)}` },
      ],
      "assemble/component-shape",
    );
    await refuses([...MINIMAL, { slot: "x" }], "assemble/component-shape");
  });

  it("refuses a malformed ref", async () => {
    await refuses(
      [...MINIMAL, { slot: "x", ref: "lcp:sha256:0xnothex" }],
      "assemble/bad-ref",
    );
  });

  it("requires a non-empty id and a non-empty terms", async () => {
    await refuses([{ slot: "terms", value: "t" }], "assemble/missing-id");
    await refuses(
      [
        { slot: "id", value: "" },
        { slot: "terms", value: "t" },
      ],
      "assemble/missing-id",
    );
    await refuses([{ slot: "id", value: "i" }], "assemble/missing-terms");
    await refuses(
      [
        { slot: "id", value: "i" },
        { slot: "terms", value: "" },
      ],
      "assemble/missing-terms",
    );
  });

  it("keeps __proto__ as an ORDINARY own key rather than mutating the prototype", async () => {
    const { atrFile } = await assemble([
      ...MINIMAL,
      { slot: "__proto__", value: "x" },
    ]);
    const text = new TextDecoder().decode(atrFile);
    expect(text).toContain("__proto__");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("assemble — caps carries decimal strings, never raw JSON numbers", () => {
  it("refuses a raw number at the TOP level of caps", async () => {
    await refuses(
      [...MINIMAL, { slot: "caps", value: { USD: 100 } }],
      "assemble/caps-raw-number",
    );
  });

  it("refuses a raw number NESTED in an object, and inside an array", async () => {
    // The validator recurses; without these the `Object.values(...).every` and `v.every(...)` arms are
    // never the reason anything is refused, and could be deleted unnoticed.
    await refuses(
      [...MINIMAL, { slot: "caps", value: { limits: { USD: 100 } } }],
      "assemble/caps-raw-number",
    );
    await refuses(
      [...MINIMAL, { slot: "caps", value: { tiers: ["1", 2] } }],
      "assemble/caps-raw-number",
    );
    await refuses(
      [...MINIMAL, { slot: "caps", value: { deep: [{ USD: 5 }] } }],
      "assemble/caps-raw-number",
    );
  });

  it("refuses a raw number MIXED IN beside valid decimal strings", async () => {
    // Every case above has a single value at each object level, so `Object.values(...).every` and
    // `.some` agree on all of them. Only a multi-key object with one good value and one bad one tells
    // them apart — and that is the realistic shape: a caps table where most currencies are correct
    // strings and one slipped through as a JSON number. Under `.some` the good sibling vouches for the
    // bad one and the raw number is minted into the record.
    await refuses(
      [...MINIMAL, { slot: "caps", value: { USD: "100", EUR: 5 } }],
      "assemble/caps-raw-number",
    );
    await refuses(
      [
        ...MINIMAL,
        { slot: "caps", value: { limits: { USD: "100", GBP: 250 } } },
      ],
      "assemble/caps-raw-number",
    );
  });

  it("ACCEPTS decimal strings, null, booleans and empty containers", async () => {
    const { atrFile } = await assemble([
      ...MINIMAL,
      {
        slot: "caps",
        value: {
          USD: "100",
          nested: { EUR: "250" },
          list: ["1", "2"],
          nothing: null,
          flag: true,
          empty: {},
          none: [],
        },
      },
    ]);
    expect(JSON.parse(new TextDecoder().decode(atrFile)).caps.USD).toBe("100");
  });

  it("leaves a REPRESENTABLE raw number alone outside caps — the decimal-string rule is caps-specific", async () => {
    const { atrFile } = await assemble([
      ...MINIMAL,
      { slot: "other", value: { n: 1 } },
    ]);
    expect(JSON.parse(new TextDecoder().decode(atrFile)).other.n).toBe(1);
  });
});

describe("assemble — a number it cannot record faithfully is refused, in ANY slot", () => {
  const MAX = Number.MAX_SAFE_INTEGER; // 9007199254740991

  it("refuses the value that silently LOSES A DIGIT", async () => {
    // The motivating case, taken the way it actually arrives — parsed from an external document —
    // rather than as a source literal, which the linter refuses outright (noPrecisionLoss) and which
    // would anyway be resolved by the engine before this file ran. That is the whole difficulty: the
    // loss happens before assemble() is entered, so the guard can only refuse the range, never
    // recover what the caller meant. Without it the ATR records a number nobody agreed to.
    const parsed: number = JSON.parse('{"amount":9007199254740993}').amount;
    expect(parsed).toBe(MAX + 1); // the loss, pinned: ...993 arrives as ...992
    await refuses(
      [...MINIMAL, { slot: "price", value: { amount: parsed } }],
      "assemble/unrepresentable-number",
    );
  });

  it("refuses NaN and both infinities — JSON.stringify turns each into null", async () => {
    expect(JSON.stringify({ x: NaN })).toBe('{"x":null}'); // the loss, pinned
    for (const bad of [NaN, Infinity, -Infinity])
      await refuses(
        [...MINIMAL, { slot: "s", value: { x: bad } }],
        "assemble/unrepresentable-number",
      );
  });

  it("refuses at the exact boundary, and accepts the last good value", async () => {
    await refuses(
      [...MINIMAL, { slot: "s", value: MAX + 1 }],
      "assemble/unrepresentable-number",
    );
    const { atrFile } = await assemble([...MINIMAL, { slot: "s", value: MAX }]);
    expect(JSON.parse(new TextDecoder().decode(atrFile)).s).toBe(MAX);
  });

  it("finds one NESTED in an object, an array, and a mixed table of honest values", async () => {
    for (const value of [
      { deep: { amount: 1e21 } },
      { tiers: [1, 2, 1e21] },
      { USD: 100, EUR: 1e21 }, // the realistic shape: one bad cell among correct ones
    ])
      await refuses(
        [...MINIMAL, { slot: "s", value }],
        "assemble/unrepresentable-number",
      );
  });

  it("names the path, so the refusal is actionable rather than 'malformed'", async () => {
    await expect(
      assemble([...MINIMAL, { slot: "caps2", value: { a: [{ b: 1e21 }] } }]),
    ).rejects.toThrow(/caps2\.a\[0\]\.b/);
  });

  it("ACCEPTS ordinary numbers — this is not the caps rule extended", async () => {
    const { atrFile } = await assemble([
      ...MINIMAL,
      {
        slot: "s",
        value: { version: 2, ratio: 1.5, tiny: 0.1, neg: -7, z: 0 },
      },
    ]);
    const s = JSON.parse(new TextDecoder().decode(atrFile)).s;
    expect(s).toEqual({ version: 2, ratio: 1.5, tiny: 0.1, neg: -7, z: 0 });
  });

  it("still reports the CAPS reason for a caps number, which is the more specific rule", async () => {
    await refuses(
      [...MINIMAL, { slot: "caps", value: { USD: 1e21 } }],
      "assemble/caps-raw-number",
    );
  });
});

/** 32 random bytes as lowercase hex — the shape every atrHash takes. */
const hex32 = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));

describe("canonicalAtrHash — the emission half of LCP §2.5", () => {
  const H = `0x${"ab".repeat(32)}`;

  it("returns the lowercase spelling of a well-formed value", () => {
    expect(canonicalAtrHash(H, "ctx")).toBe(H);
    expect(canonicalAtrHash(`0x${"AB".repeat(32)}`, "ctx")).toBe(H);
  });

  it("THROWS rather than refusing — an emit path holding a non-hash has a wiring defect", () => {
    // The asymmetry with `atrHashEquals` is deliberate and is the reason both exist. A READ path meets
    // malformed data as a matter of course and answers false; an EMIT path that canonicalized a non-hash
    // would put a fabricated reference on a wire.
    for (const bad of [
      "",
      "hello",
      "ab".repeat(32),
      `0x${"ab".repeat(31)}`,
      H.toUpperCase(),
    ])
      expect(
        () => canonicalAtrHash(bad, "ctx"),
        `should throw: ${bad}`,
      ).toThrow();
  });

  it("names the caller and quotes the offending value", () => {
    // Every rail's guard message used to be hand-written here; the context argument is what keeps them
    // reading the way they did, so a mutant that empties it must fail.
    expect(() => canonicalAtrHash("0xnope", "encodePaymentId")).toThrow(
      'encodePaymentId: atrHash must be a 0x-prefixed 32-byte value, got "0xnope"',
    );
  });

  it("appends the rider when one is given, and nothing when it is not", () => {
    let withRider = "";
    try {
      canonicalAtrHash("0xnope", "bindAtrHash", "it rides challenge.id");
    } catch (e) {
      withRider = (e as Error).message;
    }
    expect(withRider).toContain("— it rides challenge.id");

    let without = "";
    try {
      canonicalAtrHash("0xnope", "bindAtrHash");
    } catch (e) {
      without = (e as Error).message;
    }
    expect(without).not.toContain("—");
    expect(without.endsWith('got "0xnope"')).toBe(true);
  });
});

describe("atrHashEquals — decoded-byte comparison (LCP §2.5)", () => {
  const H = `0x${"ab".repeat(32)}`;
  /** The same 32 bytes, spelled with uppercase DIGITS. The `0x` prefix stays lowercase: that is not a
   *  spelling of the value, it is part of what makes the string an atrHash at all. */
  const H_UPPER_DIGITS = `0x${"AB".repeat(32)}`;

  it("matches the same 32 bytes however the digits are spelled", () => {
    expect(atrHashEquals(H, H_UPPER_DIGITS)).toBe(true);
    expect(atrHashEquals(H_UPPER_DIGITS, H)).toBe(true);
    expect(atrHashEquals(H, H)).toBe(true);
  });

  it("does NOT match a different hash", () => {
    expect(atrHashEquals(H, `0x${"cd".repeat(32)}`)).toBe(false);
  });

  it("answers false for inputs that are not atrHashes at all", () => {
    // THE DEFECT THIS CLOSES. The prior implementation was `a.toLowerCase() === b.toLowerCase()`, so it
    // answered `true` for any two equal strings — and it had zero production callers to keep it honest.
    // A predicate that reports two non-hashes equal is a string comparison wearing a hash comparison's
    // name, and §2.5 makes the decoded-byte comparison a MUST.
    expect(atrHashEquals("hello", "HELLO")).toBe(false);
    expect(atrHashEquals("", "")).toBe(false);
    expect(atrHashEquals(H, "")).toBe(false);
    // Right bytes, wrong length — 31 bytes is not an atrHash.
    expect(atrHashEquals(`0x${"ab".repeat(31)}`, `0x${"ab".repeat(31)}`)).toBe(
      false,
    );
    // Missing the prefix entirely.
    expect(atrHashEquals("ab".repeat(32), "ab".repeat(32))).toBe(false);
  });

  it("answers false for an uppercase 0X prefix rather than throwing", () => {
    // `hexToBytes` requires the lowercase `0x` exactly and THROWS otherwise; an equality predicate that
    // throws is a worse contract than one that answers false, which is why `isAtrHash` gates both inputs
    // before either is decoded. `0X…` is not a second legal spelling — `ATR_HASH_RE` never admitted it.
    expect(atrHashEquals(H, H.toUpperCase())).toBe(false);
    expect(() => atrHashEquals(H, H.toUpperCase())).not.toThrow();
  });

  it("agrees on any hex pair spelled two ways", () => {
    fc.assert(
      fc.property(hex32, (h: string) => {
        expect(atrHashEquals(`0x${h}`, `0x${h.toUpperCase()}`)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe("parseRef — and the invariant that makes its hash check unreachable", () => {
  const H = `0x${"ab".repeat(32)}`;

  /** The KernelError `code` a thrower carries — the contract, as distinct from its message prose. */
  function codeOf(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      return (e as { code?: string }).code ?? "<no code>";
    }
    return "<did not throw>";
  }

  it("rejects whitespace before shape, so the reason is the actual defect", () => {
    expect(() => parseRef(`lcp:sha256:${H} `)).toThrow(/whitespace/);
    expect(() => parseRef(`lcp:sha256: ${H}`)).toThrow(/whitespace/);
    // Both assertions above match the MESSAGE, so the code beside it could be blanked unnoticed —
    // and the code is what callers branch on.
    expect(codeOf(() => parseRef(`lcp:sha256:${H} `))).toBe("ref/whitespace");
  });

  it("rejects a non-reference and a wrong-length hash as malformed", () => {
    expect(() => parseRef(`sha256:${H}`)).toThrow(/not an lcp:sha256/);
    expect(() => parseRef("lcp:sha256:0xabc")).toThrow(/not an lcp:sha256/);
    expect(codeOf(() => parseRef(`sha256:${H}`))).toBe("ref/malformed");
  });

  it("PINS the coupling that makes parseRef's `ref/hash` branch dead code", () => {
    // `REF_RE` already requires exactly `0x` + 64 hex, which is precisely `ATR_HASH_RE`. So once `isRef`
    // passes, `isAtrHash` cannot fail, and the `ref/hash` throw is unreachable BY CONSTRUCTION — which is
    // why it reports as permanently uncovered. It is kept as defence against the two
    // regexes drifting apart; this property is what makes that defence checkable rather than decorative.
    // If it ever fails, the branch has become live and needs a real test — not a deletion.
    fc.assert(
      fc.property(fc.string(), (s: string) => {
        const v = `lcp:sha256:${s}`;
        if (!isRef(v)) return;
        expect(isAtrHash(v.slice("lcp:sha256:".length))).toBe(true);
      }),
      { numRuns: 500 },
    );
    expect(parseRef(`lcp:sha256:${H}`)).toEqual({ hash: H });
  });
});

describe("normalizeTerms — line-ending normalization", () => {
  it("folds CRLF and lone CR to LF", () => {
    expect(normalizeTerms("a\r\nb")).toBe(normalizeTerms("a\nb"));
    expect(normalizeTerms("a\rb")).toBe(normalizeTerms("a\nb"));
    expect(normalizeTerms("a\r\n\r\nb")).toBe(normalizeTerms("a\n\nb"));
  });

  it("is idempotent — normalizing normalized text changes nothing", () => {
    fc.assert(
      fc.property(fc.string(), (s: string) => {
        const once = normalizeTerms(s);
        expect(normalizeTerms(once)).toBe(once);
      }),
      { numRuns: 300 },
    );
  });

  it("collapses ANY run of trailing newlines to exactly one", () => {
    // The trailing-newline scan is what makes two authorings of the same prose hash alike. It was pinned
    // only through idempotence, which holds for a scan that stops in the wrong place too.
    expect(normalizeTerms("a")).toBe("a\n");
    expect(normalizeTerms("a\n")).toBe("a\n");
    expect(normalizeTerms("a\n\n\n\n")).toBe("a\n");
    expect(normalizeTerms(`a${"\n".repeat(500)}`)).toBe("a\n");
  });

  it("handles a string that is NOTHING BUT newlines, and the empty string", () => {
    // The scan walks to index 0 here. Stopping one short would leave a stray newline and split the
    // byte-stability property; running past it would be an out-of-range read.
    expect(normalizeTerms("")).toBe("\n");
    expect(normalizeTerms("\n")).toBe("\n");
    expect(normalizeTerms("\n\n\n")).toBe("\n");
    expect(normalizeTerms("\r\n\r\n")).toBe("\n");
    expect(normalizeTerms("\n".repeat(500))).toBe("\n");
  });

  it("leaves INTERIOR blank lines alone — only the trailing run collapses", () => {
    // Interior whitespace can be legally significant in terms prose; only the tail is normalized.
    expect(normalizeTerms("a\n\n\nb\n\n")).toBe("a\n\n\nb\n");
  });
});

/**
 * What this file deliberately does not chase is `StringLiteral` variation on error
 * MESSAGE text. Those are left alive deliberately: the `code` is the contract — asserted here and in the
 * vectors — while the message is a diagnostic for humans. Pinning prose would buy a higher score and a
 * brittler suite. What follows are the survivors that are not prose: an error's identity, the hex loop
 * bound, and the reference regex.
 */
describe("kernel — identity, loop bounds, and the reference grammar", () => {
  it("KernelError announces itself as a KernelError", async () => {
    // `name` is how a caller distinguishes a kernel refusal from an arbitrary throw before reading `code`.
    await expect(assemble([{ slot: "id", value: "i" }])).rejects.toMatchObject({
      name: "KernelError",
      code: "assemble/missing-terms",
    });
  });

  it("hexToBytes round-trips every byte value — the loop covers the whole buffer", () => {
    // An off-by-one in `i < out.length` would drop or over-read the final byte; a round-trip over all 256
    // values plus the empty and single-byte edges is what makes that bound observable.
    // NOTE the asymmetry, which is the documented contract rather than an oversight: `bytesToHex` emits
    // BARE hex while `hexToBytes` requires the `0x` prefix, so they are not direct inverses.
    const round = (b: Uint8Array): Uint8Array =>
      hexToBytes(`0x${bytesToHex(b)}`);
    const all = new Uint8Array(256).map((_, i) => i);
    expect(round(all)).toEqual(all);
    expect(round(new Uint8Array())).toEqual(new Uint8Array());
    expect(round(new Uint8Array([0xff]))).toEqual(new Uint8Array([0xff]));
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (b: Uint8Array) => {
        expect(round(b)).toEqual(b);
      }),
      { numRuns: 300 },
    );
  });

  it("hexToBytes refuses malformed input rather than guessing", () => {
    expect(() => hexToBytes("abcd")).toThrow(/0x-prefixed/); // bare hex is refused
    expect(() => hexToBytes("0xabc")).toThrow(/odd-length/);
    expect(() => hexToBytes("0xzz")).toThrow(/non-hex/);
  });

  it("the reference grammar is exact — prefix, 0x, and exactly 64 hex digits", () => {
    const h = "ab".repeat(32);
    expect(isRef(`lcp:sha256:0x${h}`)).toBe(true);
    expect(isRef(`lcp:sha256:0x${h.toUpperCase()}`)).toBe(true); // any-case, decision A
    expect(isRef(`lcp:sha256:0x${h}a`)).toBe(false); // 65 digits
    expect(isRef(`lcp:sha256:0x${h.slice(0, -1)}`)).toBe(false); // 63 digits
    expect(isRef(`lcp:sha256:${h}`)).toBe(false); // missing 0x
    expect(isRef(`lcp:sha1:0x${h}`)).toBe(false); // wrong algorithm
    expect(isRef(`xlcp:sha256:0x${h}`)).toBe(false); // unanchored prefix
    expect(isRef(`lcp:sha256:0x${h}\n`)).toBe(false); // trailing newline
  });
});
