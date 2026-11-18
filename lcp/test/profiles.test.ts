// Every registered pairing names its profile, and every profile a pairing names is published: `profiles/` holds a
// file named by the profile id, its `/` written as `-`, whose first line is headed by that id.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import type { LcpPattern } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const profiles = rowsOf(
  BINDINGS.map((b) => ("pattern" in b ? (b.pattern as LcpPattern).profile : undefined)),
  "BINDINGS, each pairing's profile",
  { exact: BINDINGS.length },
);
const named = [...new Set(profiles.filter((p): p is string => typeof p === "string"))].sort();

describe("the published profiles", () => {
  it("every pairing names a profile", () => {
    expect(BINDINGS.filter((_, i) => typeof profiles[i] !== "string").map((b) => b.id)).toEqual([]);
    expect(named).toContain("mpp/charge/solana");
  });

  it.each(named)("%s is published under its id", (profile) => {
    const url = new URL(`../profiles/${profile.replaceAll("/", "-")}.md`, import.meta.url);
    expect(existsSync(url)).toBe(true);
    expect(readFileSync(url, "utf8").split("\n")[0]).toContain(`**LCP profile \`${profile}\``);
  });
});
