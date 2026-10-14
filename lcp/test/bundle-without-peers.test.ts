// Each public entry point in package.json's `exports`, built, bundled by esbuild as wrangler bundles a Worker
// (conditions `workerd`, `worker` and `browser`, esbuild's browser platform, format esm), from a project whose
// node_modules holds the package and its dependencies and none of its optional peers: the install of a consumer that
// adds no peer. Each peer is absent from that tree, so esbuild's own resolver fails on it as on a real missing install;
// no peer is marked external. One build takes every entry point and writes each one's bundle, the bundle a build of
// that entry point alone writes. Every bundle builds, each optional peer stays an `import()` left to run time, and one
// Node process loads each bundle with every peer absent and gives the names Node's own loader gives for the built file.
// The `usdc` Stacks pairing, which needs no peer, answers its vectors (mpp-charge-usdc-stacks.json: M4 and every
// agreedRefusals row, each in the vector's B6 credential) from the root and the `./mpp` bundles and built files, in a
// Node process run in the consumer's project, where `@stacks/transactions` does not resolve.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type BuildOptions, type Message } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsOf } from "./rows.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, { default: string }>;
  dependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};
const PEERS = rowsOf(
  Object.keys(PKG.peerDependenciesMeta).filter((p) => PKG.peerDependenciesMeta[p]!.optional === true),
  "package.json peerDependenciesMeta, the optional peers",
  { exact: Object.keys(PKG.peerDependenciesMeta).length },
);
const KEYS = rowsOf(Object.keys(PKG.exports), "package.json exports");

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

// The Stacks pairing in the consumer's project: argv[1] is a JSON list of [the vector file, ...files]; prints whether
// @stacks/transactions resolves there, and for each file the pairing's bound and reference of M4 and of each
// agreedRefusals row.
const STACKS = `
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [vectors, ...files] = JSON.parse(process.argv[1]);
const V = JSON.parse(readFileSync(vectors, "utf8"));
const b6 = V.buyer.rows.find((r) => r.name === "B6").input.presented;
const credential = (w) => ({ ...b6, payload: { ...b6.payload, transaction: Buffer.from(w.slice(2), "hex").toString("base64") } });
const wires = [V.M4.wireHex, ...V.agreedRefusals.rows.map((r) => r.wireHex)];
const peer = await import("@stacks/transactions").then(() => "resolves", (e) => String(e.code));
const answers = {};
for (const file of files) {
  const m = await import(pathToFileURL(file).href);
  const pairing = m.chargeUsdcStacks ?? m.BINDINGS.find((b) => b.id === "mpp/charge/usdc/stacks");
  answers[file] = [];
  for (const w of wires) answers[file].push([await pairing.bound(credential(w)), await pairing.reference(credential(w))]);
}
process.stdout.write(JSON.stringify({ peer, answers }));
`;

// The hook has no time bound (0): the build returns or throws, and the loading process exits by itself, so how long
// it takes depends only on the machine.
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
}, 0);
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

  it("the usdc Stacks pairing answers its vectors from the root and ./mpp bundles and built files, with no peer", () => {
    const V = JSON.parse(readFileSync(join(ROOT, "vectors", "mpp-charge-usdc-stacks.json"), "utf8"));
    const rows = V.agreedRefusals.rows as { expect: string }[];
    expect(rows.length).toBe(42);
    const want = [
      [V.M4.expectBound, V.M4.expectReference],
      ...rows.map((r) => [{ refused: true, code: r.expect }, { refused: true, code: r.expect }]),
    ];
    const files = [".", "./mpp"].flatMap((key) => [bundleOf(KEYS.indexOf(key)), join(installed, PKG.exports[key]!.default)]);
    const run = [join(ROOT, "vectors", "mpp-charge-usdc-stacks.json"), ...files];
    const got = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", STACKS, JSON.stringify(run)], { cwd: dir, encoding: "utf8" }),
    ) as { peer: string; answers: Record<string, unknown> };
    expect(got.peer).toBe("ERR_MODULE_NOT_FOUND");
    expect(Object.keys(got.answers)).toEqual(files);
    for (const file of files) expect([file, got.answers[file]]).toEqual([file, want]);
  });

  it.each(KEYS)("%s loads from its bundle with every peer absent", (key) => {
    const got = loaded[key];
    expect(got).toHaveProperty("bundle");
    const { bundle, built } = got as { bundle: string[]; built: string[] };
    expect(built.length).toBeGreaterThan(0);
    expect(bundle).toEqual(built);
  });
});
