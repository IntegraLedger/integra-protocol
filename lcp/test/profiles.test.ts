// Every profile a registered pairing names is published: `profiles/` holds a file named by the profile id, its `/`
// written as `-`, whose first line is headed by that id.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import type { LcpPattern } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const named = [
  ...new Set(
    rowsOf(BINDINGS.map((b) => (b.pattern as LcpPattern).profile), "BINDINGS, each pairing's profile", {
      keep: ["the profiles the pairings name", (p) => typeof p === "string"],
      leave: ["the pairings that name no profile", (p) => p === undefined],
    }) as string[],
  ),
].sort();

describe("the published profiles", () => {
  it("the pairings name profiles", () => {
    expect(named).toContain("mpp/charge/solana");
  });

  it.each(named)("%s is published under its id", (profile) => {
    const url = new URL(`../profiles/${profile.replaceAll("/", "-")}.md`, import.meta.url);
    expect(existsSync(url)).toBe(true);
    expect(readFileSync(url, "utf8").split("\n")[0]).toContain(`**LCP profile \`${profile}\``);
  });
});
