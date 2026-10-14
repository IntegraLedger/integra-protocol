// Each public entry point in package.json's `exports`, built, bundled by esbuild as wrangler bundles a Worker
// (conditions `workerd`, `worker` and `browser`, esbuild's browser platform, format esm), from a project whose
// node_modules holds the package and its dependencies and none of its optional peers: the install of a consumer that
// adds no peer. Each peer is absent from that tree, so esbuild's own resolver fails on it as on a real missing install;
// no peer is marked external. One build takes every entry point and writes each one's bundle, the bundle a build of
// that entry point alone writes. Every bundle builds, each optional peer stays an `import()` left to run time, and one
// Node process loads each bundle with every peer absent and gives the names Node's own loader gives for the built file.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions, type Message } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, { default: string }>;
  dependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};
const PEERS = Object.keys(PKG.peerDependenciesMeta).filter((p) => PKG.peerDependenciesMeta[p]!.optional === true);
const KEYS = Object.keys(PKG.exports);

/** wrangler's esbuild options for a module Worker: its build conditions, esbuild's default platform, format esm. */
const WORKER: BuildOptions = {
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["workerd", "worker", "browser"],
  logLevel: "silent",
};

const dir = mkdtempSync(join(tmpdir(), "bundle-without-peers-"));
const installed = join(dir, "node_modules", PKG.name);
/** The bundle of the `i`th entry point of package.json's `exports`. */
const bundleOf = (i: number) => join(dir, "out", `${i}.mjs`);

/** What the one build of every entry point reports. */
let errors: string[] = [];
/** Per entry point: the export names of its bundle and of its built file, or what loading them threw. */
let loaded: Record<string, { bundle: string[]; built: string[] } | { threw: string }> = {};

// Node's own loader: argv[1] is a JSON list of [entry point, bundle, built file]; prints each one's names, sorted.
const LOAD = `
import { pathToFileURL } from "node:url";
const names = async (file) => Object.keys(await import(pathToFileURL(file).href)).sort();
const loaded = {};
for (const [key, bundle, built] of JSON.parse(process.argv[1])) {
  try {
    loaded[key] = { bundle: await names(bundle), built: await names(built) };
  } catch (e) {
    loaded[key] = { threw: String(e) };
  }
}
process.stdout.write(JSON.stringify(loaded));
`;

beforeAll(async () => {
  // The consumer's install: the package's files, and each dependency linked to its installed copy. No peer.
  mkdirSync(installed, { recursive: true });
  cpSync(join(ROOT, "package.json"), join(installed, "package.json"));
  cpSync(join(ROOT, "dist"), join(installed, "dist"), { recursive: true });
  for (const dep of Object.keys(PKG.dependencies)) {
    const link = join(dir, "node_modules", dep);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(realpathSync(join(ROOT, "node_modules", dep)), link, "dir");
  }
  // One consumer module per entry point, each importing it as a Worker would, all bundled by one build.
  const entryPoints = KEYS.map((key, i) => {
    const file = join(dir, `${i}.mjs`);
    writeFileSync(file, `export * from ${JSON.stringify(PKG.name + key.slice(1))};\n`);
    return file;
  });
  errors = await build({ ...WORKER, entryPoints, outdir: join(dir, "out"), outExtension: { ".js": ".mjs" } }).then(
    (r) => r.errors.map((m) => m.text),
    (e: { errors: Message[] }) => e.errors.map((m) => `${m.text} (${m.location?.file ?? "no file"})`),
  );
  if (errors.length > 0) return;
  const jobs = KEYS.map((key, i) => [key, bundleOf(i), join(installed, PKG.exports[key]!.default)]);
  loaded = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", LOAD, JSON.stringify(jobs)], { encoding: "utf8" }),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("each public entry point bundled for a Worker with no optional peer installed", () => {
  it("each optional peer is unresolvable in the consumer's install", async () => {
    expect(PEERS.length).toBeGreaterThan(0);
    for (const peer of PEERS) {
      const stdin = { contents: `import ${JSON.stringify(peer)};`, resolveDir: dir };
      const failed = await build({ ...WORKER, write: false, stdin }).then(
        () => [],
        (e: { errors: Message[] }) => e.errors.map((m) => m.text),
      );
      expect(failed, peer).toEqual([`Could not resolve ${JSON.stringify(peer)}`]);
    }
  });

  it("every entry point bundles with no error, and each optional peer stays an import() in the bundles", () => {
    expect(errors).toEqual([]);
    const all = KEYS.map((_, i) => readFileSync(bundleOf(i), "utf8")).join("\n");
    for (const peer of PEERS) {
      const runtime = new RegExp(`\\bimport\\(\\s*"${peer.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?:/[^"]*)?"\\s*\\)`);
      expect(runtime.test(all), peer).toBe(true);
    }
  });

  it.each(KEYS)("%s loads from its bundle with every peer absent", (key) => {
    const got = loaded[key];
    expect(got).toHaveProperty("bundle");
    const { bundle, built } = got as { bundle: string[]; built: string[] };
    expect(built.length).toBeGreaterThan(0);
    expect(bundle).toEqual(built);
  });
});
