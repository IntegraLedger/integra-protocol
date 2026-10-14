// Every optional peer the package declares is loaded by a module in `src/`: a static or a dynamic import of the peer
// or of one of its subpaths. Every package a module in `src/` loads is a dependency or a declared peer.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rowsOf } from "./rows.js";

interface Manifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Manifest;
const srcDir = new URL("../src/", import.meta.url);
const sources = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts"))
  .map((f) => readFileSync(new URL(f, srcDir), "utf8"));

const loaded = new Set<string>();
for (const text of sources) {
  for (const m of text.matchAll(/(?:from\s+|import\(\s*)"((?:@[^/"]+\/)?[^/".][^/"]*)(?:\/[^"]*)?"/g)) {
    loaded.add(m[1]!);
  }
}

const peers = rowsOf(Object.keys(manifest.peerDependencies ?? {}), "package.json peerDependencies");

describe("declared peers", () => {
  it("every peer is optional", () => {
    for (const name of peers) expect(manifest.peerDependenciesMeta?.[name]?.optional, name).toBe(true);
  });

  it.each(peers)("%s is loaded by a module in src", (name) => {
    expect(loaded.has(name)).toBe(true);
  });

  it("every package a module in src loads is a dependency or a declared peer", () => {
    const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...peers]);
    expect(loaded.size).toBeGreaterThan(0);
    expect([...loaded].filter((name) => !declared.has(name))).toEqual([]);
  });
});
