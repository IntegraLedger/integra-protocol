import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emit,
  isKnownTermsFormat,
  isLegalContextJson,
  isMachineReadableTermsFormat,
  LEGAL_CONTEXT_JSON_SCHEMA,
  type LegalContextJson,
} from "../src/index.js";

type Case = { name: string; input: unknown; expected: boolean };
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/legal-context/documents.json", import.meta.url),
    "utf8",
  ),
) as { cases: Case[] };

describe("isLegalContextJson (trust-boundary validation)", () => {
  it.each(V.cases)("$name → $expected", ({ input, expected }) => {
    expect(isLegalContextJson(input)).toBe(expected);
  });
});

describe("emit", () => {
  it("drops undefined fields and validates", () => {
    const profile: Record<string, unknown> = {
      terms: "https://example.com/terms/v3.md",
      atrHash: undefined,
    };
    const doc = emit(profile as LegalContextJson);
    expect(doc).toEqual({ terms: "https://example.com/terms/v3.md" });
    expect("atrHash" in doc).toBe(false);
  });
  it("throws on an invalid profile (non-HTTPS terms)", () => {
    expect(() => emit({ terms: "http://example.com/terms.md" })).toThrow();
  });
});

describe("termsFormat classification", () => {
  it.each(["markdown", "json", "plain", "html", "pdf"])(
    "%s is a known format",
    (f) => {
      expect(isKnownTermsFormat(f)).toBe(true);
    },
  );
  it.each(["markdown", "json", "plain"])("%s is machine-readable", (f) => {
    expect(isMachineReadableTermsFormat(f)).toBe(true);
  });
  it.each(["html", "pdf"])(
    "%s is NOT machine-readable (page layout / markup)",
    (f) => {
      expect(isMachineReadableTermsFormat(f)).toBe(false);
    },
  );
  it("rejects an unknown format token", () => {
    expect(isKnownTermsFormat("xml")).toBe(false);
  });
});

describe("canonical JSON Schema artifact", () => {
  it("exports a draft-2020-12 schema with terms required", () => {
    expect(String(LEGAL_CONTEXT_JSON_SCHEMA["$id"])).toContain(
      "legal-context.json",
    );
    expect(LEGAL_CONTEXT_JSON_SCHEMA["required"] as string[]).toContain(
      "terms",
    );
  });

  /**
   * ⛔ `vectors/legal-context/schema.json` IS RENDERED, NEVER WRITTEN.
   *
   * That file is what a third party validates their discovery document against, and it is generated from
   * the Zod schema in `src/schema.ts` — so the only honest relationship between them is equality. It was
   * guarded by the two `toContain` assertions above and nothing else, which pin one substring of `$id` and
   * one member of `required`: `properties`, every `pattern`, and `required` itself could each have
   * diverged in silence. Measured 2026-09-03, one already had — the vector's `description` was missing a
   * word the generator emits, which is small and is exactly the size of drift a substring test is built to
   * miss.
   *
   * Compared as PARSED values rather than bytes: the file's on-disk formatting is biome's, and a byte
   * comparison would be a test of the formatter.
   */
  it("the published schema vector is the schema this package generates", () => {
    const vector = JSON.parse(
      readFileSync(
        new URL("../../../vectors/legal-context/schema.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(vector).toEqual(LEGAL_CONTEXT_JSON_SCHEMA);
  });
});

describe("emit normalizes the atrHash's case, and nothing else's (LCP §2.5)", () => {
  const H =
    "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
  const UP = `0x${H.slice(2).toUpperCase()}`;

  it("emits an uppercase-digit atrHash as lowercase", () => {
    // §2.5 gained a RECOMMENDED in v0.1.38: emit lowercase, so a served document has exactly one spelling
    // however the profile was authored.
    const doc = emit({
      terms: "https://seller.example/terms.md",
      atrHash: UP,
    } as LegalContextJson);
    expect(doc.atrHash).toBe(H);
  });

  it("leaves an already-lowercase atrHash untouched", () => {
    const doc = emit({
      terms: "https://seller.example/terms.md",
      atrHash: H,
    } as LegalContextJson);
    expect(doc.atrHash).toBe(H);
  });

  it("does NOT fold the terms URL — its path and query are case-sensitive", () => {
    // The scoping is the substance. Lowercasing a URL would point the document at a different resource,
    // which is a rewrite of the reference rather than a normalization of it.
    const terms = "https://Seller.Example/Terms/AbC.md";
    const doc = emit({ terms, atrHash: UP } as LegalContextJson);
    expect(doc.terms).toBe(terms);
    expect(doc.atrHash).toBe(H);
  });

  it("emits a profile with no atrHash unchanged", () => {
    // The field is optional; the guard must not invent one or throw on its absence.
    const doc = emit({
      terms: "https://seller.example/terms.md",
    } as LegalContextJson);
    expect(doc.atrHash).toBeUndefined();
    expect(doc.terms).toBe("https://seller.example/terms.md");
  });
});
