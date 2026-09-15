/**
 * EVERY SURFACE WHOSE PROSE IS OURS AND SHIPS TO A CONSUMER.
 *
 * Shared by `no-private-referents` and `spec-citation-invariant`, which ask different questions of the
 * same set. Keeping the set in one place is the point: both gates walked `packages/<pkg>/src` and each
 * package's README and neither walked `vectors/`, so every rule they enforce was enforced on two thirds of
 * what npm actually ships.
 *
 * ★ WHY `vectors/` BELONGS HERE. It is in `lcp-conformance`'s `files` field, so it is inside the tarball,
 * and its `$comment` fields are not incidental — they are where a vector explains what it pins and why,
 * which makes them the first prose an independent implementer reads. The 2026-08-10 staleness audit
 * excluded the tree as "data, sealed and separately gated" and the exclusion held for two months; a sweep
 * on 2026-08-12 found four private referents and fifteen superseded spec citations there, of exactly the
 * classes both gates had already cleared from `packages/`.
 *
 * ★ WHY ONLY `$comment` AND `name`. Everything else in a vector is DATA UNDER TEST, and a gate that read it
 * would be reading a host protocol's payloads as though they were our sentences. Measured: `acp.json`
 * carries `merchant_order_ref: "SO-4417"` inside a fixture document — id-shaped, and not a referent to
 * anything. Scanning whole files reports it; scanning prose does not.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** One piece of shipped prose: where it came from, and what it says. */
export type Prose = { readonly where: string; readonly text: string };

/** Does this package's `files` field put its CHANGELOG in the tarball? npm does not pack one by default. */
function packsChangelog(pkgDir: string): boolean {
  const manifest = join(pkgDir, "package.json");
  if (!existsSync(manifest)) return false;
  const files: unknown = (
    JSON.parse(readFileSync(manifest, "utf8")) as { files?: unknown }
  ).files;
  return Array.isArray(files) && files.includes("CHANGELOG.md");
}

/**
 * `src/**\/*.ts`, the README and the CHANGELOG of every package — the TypeScript half of the tarball's prose.
 *
 * ★ WHY THE CHANGELOG IS GATED ON `files` AND THE README IS NOT. npm ALWAYS packs a README, whatever `files`
 * says, so reading every one of them is right. A CHANGELOG is packed only when the package asks for it —
 * 31 of these 32 packages list it, and `rail-invariants` (`private: true`, no `files`) does not. Walking a
 * CHANGELOG that never ships would report a defect nobody can reach; skipping one that does ships the
 * defect. So the question asked here is the one that decides it: is this file in the tarball.
 *
 * ★ THE CHANGELOG WAS THE NEXT SURFACE ALONG FROM THE README, AND THE HOLE WAS THE SAME ONE TWICE. This
 * walker was `src/`-only until READMEs leaked 21 occurrences; READMEs were added and CHANGELOGs were not.
 * Eight occurrences of a private repository's name were measured across
 * eight package CHANGELOGs, every one of them already inside a published tarball.
 */
export function packageProse(packagesDir: string): Prose[] {
  const out: Prose[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${rel}/${name}`);
      else if (name.endsWith(".ts"))
        out.push({ where: `${rel}/${name}`, text: readFileSync(p, "utf8") });
    }
  };
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, "src");
    if (existsSync(src) && statSync(src).isDirectory()) walk(src, `${pkg}/src`);
    const readme = join(packagesDir, pkg, "README.md");
    if (existsSync(readme))
      out.push({
        where: `${pkg}/README.md`,
        text: readFileSync(readme, "utf8"),
      });
    const changelog = join(packagesDir, pkg, "CHANGELOG.md");
    if (existsSync(changelog) && packsChangelog(join(packagesDir, pkg)))
      out.push({
        where: `${pkg}/CHANGELOG.md`,
        text: readFileSync(changelog, "utf8"),
      });
  }
  return out;
}

/**
 * The `$comment` and `name` strings of every vector — the prose half, and nothing else.
 *
 * Each is returned as its own entry keyed by JSON path, so a failure names the field to edit rather than
 * the file to search.
 */
export function vectorProse(vectorsDir: string): Prose[] {
  const out: Prose[] = [];
  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, `${rel}/${name}`);
      else if (name.endsWith(".json")) files.push(`${rel}/${name}`);
    }
  };
  walk(vectorsDir, "vectors");
  const collect = (node: unknown, where: string, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        collect(v, where, `${path}[${i}]`);
      });
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === "$comment" || k === "name") && typeof v === "string")
        out.push({ where: `${where}${path}.${k}`, text: v });
      else collect(v, where, `${path}.${k}`);
    }
  };
  for (const rel of files)
    collect(
      JSON.parse(readFileSync(join(vectorsDir, "..", rel), "utf8")),
      rel,
      "",
    );
  return out;
}
