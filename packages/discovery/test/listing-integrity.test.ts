import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hashAtr } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import { checkListingIntegrity } from "../src/listing-integrity.js";
import { parseLegalContextJson } from "../src/schema.js";

type Case = {
  name: string;
  servedTerms_utf8: string;
  termsFormat?: string;
  advertisedAtrHash: string;
  status: "ok" | "mismatch" | "listing-format-not-machine-readable";
  ok: boolean;
  hashesMatch: boolean;
  machineReadable: boolean;
};

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../vectors/discovery/listing-integrity.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
) as { cases: Case[] };

describe("discovery checkListingIntegrity (DSC-1/2)", () => {
  for (const c of vectors.cases) {
    it(c.name, async () => {
      const servedBytes = new TextEncoder().encode(c.servedTerms_utf8);
      const advertisedAtrHash =
        c.advertisedAtrHash === "__HASH_OF_SERVED__"
          ? await hashAtr(servedBytes)
          : (c.advertisedAtrHash as `0x${string}`);
      const listing = parseLegalContextJson({
        terms: "https://example.com/.well-known/terms.md",
        // termsFormat is optional in LCP §2.5 — omitted entirely when the vector states none, rather
        // than passed as undefined, so the absent case is genuinely absent.
        ...(c.termsFormat === undefined ? {} : { termsFormat: c.termsFormat }),
        atrHash: advertisedAtrHash,
      });
      const result = await checkListingIntegrity(
        listing,
        servedBytes,
        advertisedAtrHash,
      );
      expect(result.status).toBe(c.status);
      expect(result.ok).toBe(c.ok);
      // The two facts, pinned SEPARATELY — this is the whole point of the pair. A pdf listing whose terms
      // hash correctly must report `hashesMatch: true` even while it refuses on format, because a consumer
      // folding every non-ok status into one bucket otherwise records a hash mismatch that did not happen.
      expect(result.hashesMatch).toBe(c.hashesMatch);
      expect(result.machineReadable).toBe(c.machineReadable);
      // `ok` is the conservative composite of the two, never a third independent verdict.
      expect(result.ok).toBe(c.hashesMatch && c.machineReadable);
      expect(result.servedAtrHash).toBe(await hashAtr(servedBytes));
      expect(result.advertisedAtrHash).toBe(advertisedAtrHash);
    });
  }
});
