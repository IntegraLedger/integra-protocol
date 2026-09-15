/**
 * THE PUBLISHED ARTIFACT MATCHES THE SOURCE IT WAS CUT FROM — AND THE GATE THAT SAYS SO HAS BEEN DRIVEN.
 *
 * ★ WHY IT EXISTS. Every other gate in this repository reads the working tree. A version already on the
 * registry can disagree with the source that carries its number, and nothing in a tree can see that: the
 * build is correct, the tests pass over correct source, and the tarball a consumer installs is a different
 * object. Measured in the sibling repository, that shipped six defects across two packages while every gate
 * there stayed green.
 *
 * ★ WHAT THIS FILE IS FOR. `scripts/check-published-parity.mjs` is the gate; this is its DRIVE. A gate is
 * not finished when it is green — it is finished when the defect it names has been planted and it went red.
 * ⛔ And this one is installed while the tree is CLEAN, so its green is the only thing standing between a
 * future stale publish and nobody noticing. A drive is what makes that green worth anything.
 *
 * ★ It lives here rather than beside the script for the reason `runner-patch-invariant.test.ts` records:
 * `pnpm test` runs the workspace, and a drive nothing executes is a drive that rots.
 *
 * ★ EVERY REGISTRY ANSWER IS INJECTED. The gate's seam takes a registry, so the verdict logic is exercised
 * with no network at all; the seam's REAL half is then exercised separately against a local HTTP server
 * serving a real gzipped tarball, because a seam whose real half is never executed is unmeasured.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  COMPARABLE_FLOOR,
  comparableSubjects,
  declaredSourceFiles,
  floorRefusal,
  hashTarEntries,
  NetworkRegistry,
  parityReport,
  publishableManifests,
  readManifests,
  verdict,
  // @ts-expect-error — the gate is plain ESM JavaScript with JSDoc types, not part of a package's build
} from "../../../scripts/check-published-parity.mjs";

const GATE = fileURLToPath(
  new URL("../../../scripts/check-published-parity.mjs", import.meta.url),
);

const NAME = "@integraledger/lcp-kernel";
const VERSION = "0.18.1";
const SRC: Record<string, string> = {
  "index.ts": "export * from './hash.js';\n",
  "hash.ts": "export const hashAtr = () => '';\n",
  "spec-version.ts": "export const LCP_SPEC_VERSION = '1.0';\n",
};

const sha = (s: string) =>
  createHash("sha256").update(Buffer.from(s)).digest("hex");

function fixture({
  files = ["dist", "src"],
  version = VERSION,
  extra = 0,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "parity-fixture-"));
  const mk = (dir: string, pkg: unknown) => {
    const d = join(root, "packages", dir);
    mkdirSync(join(d, "src"), { recursive: true });
    for (const [f, body] of Object.entries(SRC))
      writeFileSync(join(d, "src", f), body);
    const path = join(d, "package.json");
    writeFileSync(path, JSON.stringify(pkg, null, 2));
    return { name: dir, path, pkg };
  };
  const manifests = [
    mk("kernel", {
      name: NAME,
      version,
      files,
      publishConfig: { access: "public" },
    }),
  ];
  for (let i = 0; i < extra; i += 1)
    manifests.push(
      mk(`extra-${i}`, {
        name: `@integraledger/extra-${i}`,
        version,
        files: ["src"],
        publishConfig: { access: "public" },
      }),
    );
  return { root, manifests };
}

function FakeRegistry({
  versions = { [VERSION]: { dist: { tarball: "http://x/t.tgz" } } },
  contents,
  throws,
}: {
  versions?: Record<string, unknown>;
  contents?: Map<string, string>;
  throws?: "metadata" | "contents";
} = {}) {
  const asked: string[] = [];
  const fetched: string[] = [];
  return {
    asked,
    fetched,
    async metadata(name: string) {
      asked.push(name);
      if (throws === "metadata")
        throw new Error("ENOTFOUND registry.npmjs.org");
      return { versions };
    },
    async contents(name: string, version: string) {
      // Recorded, never discarded: a fake that ignores its arguments cannot catch a gate comparing two
      // unrelated artifacts and calling the result parity.
      fetched.push(`${name}@${version}`);
      if (throws === "contents") throw new Error("tarball answered 503");
      return contents ?? new Map<string, string>();
    },
  };
}

const parityContents = () =>
  new Map(Object.entries(SRC).map(([f, body]) => [`src/${f}`, sha(body)]));

describe("check:published-parity — the verdict logic, on injected answers", () => {
  it("is parity when every declared source file matches byte for byte", async () => {
    const { root, manifests } = fixture();
    try {
      const r = await parityReport({
        manifests,
        registry: FakeRegistry({ contents: parityContents() }),
      });
      expect(r.drift).toEqual([]);
      expect(r.faults).toEqual([]);
      expect(r.checked).toBe(1);
      expect(verdict({ ...r, floor: 1 }).code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("⛔ DRIFT, ABSENT — a declared file missing from the tarball is named", async () => {
    const { root, manifests } = fixture();
    try {
      const c = parityContents();
      c.delete("src/spec-version.ts");
      const r = await parityReport({
        manifests,
        registry: FakeRegistry({ contents: c }),
      });
      expect(r.drift).toHaveLength(1);
      expect(r.drift[0]).toMatch(/ABSENT {4}src\/spec-version\.ts/);
      expect(r.drift[0]).toMatch(
        /Control: 2 file\(s\) were read from that tarball and 3 from this tree/,
      );
      expect(verdict({ ...r, floor: 1 }).code).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("⛔⛔ DRIFT, DIFFERENT BYTES — the shape a filename check cannot see", async () => {
    const { root, manifests } = fixture();
    try {
      const c = parityContents();
      c.set("src/index.ts", sha("export * from './something-else.js';\n"));
      const r = await parityReport({
        manifests,
        registry: FakeRegistry({ contents: c }),
      });
      expect(r.drift[0]).toMatch(/DIFFERENT src\/index\.ts/);
      expect(r.drift[0]).toMatch(
        /0 file\(s\) absent, 1 present with different bytes/,
      );
      expect(verdict({ ...r, floor: 1 }).code).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("⛔ THE FLOOR — a package leaving the comparable set must not leave a green behind", async () => {
    const { root, manifests } = fixture({ files: ["dist"], extra: 1 });
    try {
      const r = await parityReport({
        manifests,
        registry: FakeRegistry({ contents: parityContents() }),
      });
      expect(r.checked).toBe(1);
      expect(r.drift).toEqual([]);
      expect(r.notes[0]).toMatch(/NOT COMPARABLE/);
      expect(verdict({ ...r, floor: 2 }).code).toBe(2);
      expect(verdict({ ...r, floor: 2 }).message).toMatch(
        /LEAVES the comparable set/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * ⛔⛔ THE FLOOR IS A DECLARATION HELD EQUAL TO THE TREE, AND THE `>` DIRECTION WAS SILENT.
   *
   * The case above proves a package LEAVING the comparable set cannot leave a green behind. ⭐ Nothing
   * proved the other direction, and it is the one that makes the first possible: a package that JOINS and
   * is not counted leaves exactly one package's worth of slack, so the NEXT departure is absorbed and the
   * run prints a tick over a subject that walked away.
   *
   * ⚠️ The subject is derived from the TREE, not from what a run compared. `checked` legitimately drops
   * between a version bump and the publish that follows it, so a declaration held equal to THAT would
   * refuse on every healthy tree somebody was preparing a release in.
   */
  describe("⛔⛔ the floor and the tree must agree, in BOTH directions", () => {
    it("⭐ THE CONTROL — a tree whose comparable count equals the floor is silent", () => {
      const { root, manifests } = fixture({ extra: 2 });
      try {
        expect(comparableSubjects(manifests)).toHaveLength(3);
        expect(floorRefusal({ manifests, floor: 3 })).toBeNull();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("⛔ a package JOINS and the floor is not raised: REFUSED, naming the subjects", () => {
      const { root, manifests } = fixture({ extra: 2 });
      try {
        const refusal = floorRefusal({ manifests, floor: 2 });
        expect(refusal).not.toBeNull();
        expect(refusal).toMatch(/JOINED the comparable set/);
        // ⛔ It names them, so the reader raising the number can see WHAT they are raising it over.
        expect(refusal).toMatch(/@integraledger\/extra-0/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("⛔ a package LEAVES by dropping `src` from `files`: REFUSED, and told not to lower the number", () => {
      // `dist` only — the ordinary "stop shipping source" cleanup, which takes the package out of the
      // comparable set without any other visible change.
      const { root, manifests } = fixture({ files: ["dist"], extra: 2 });
      try {
        expect(comparableSubjects(manifests)).toHaveLength(2);
        const refusal = floorRefusal({ manifests, floor: 3 });
        expect(refusal).toMatch(/LEFT the comparable set/);
        expect(refusal).toMatch(/Do not lower this number/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("⛔ a package going `private` also LEAVES — publishing is half the predicate", () => {
      const { root, manifests } = fixture({ extra: 2 });
      try {
        // ⛔ Asserted rather than indexed blindly: a fixture that stopped producing three manifests would
        // otherwise make this case pass over the wrong subject, which is the shape it exists to catch.
        expect(manifests).toHaveLength(3);
        const leaving = manifests[1];
        if (leaving === undefined)
          throw new Error("fixture produced no second manifest");
        (leaving.pkg as { private?: boolean }).private = true;
        expect(comparableSubjects(manifests)).toHaveLength(2);
        expect(floorRefusal({ manifests, floor: 3 })).toMatch(
          /LEFT the comparable set/,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("⭐⭐ and THIS repository's own declaration still describes THIS tree", () => {
      // ⛔ The case that makes the four above worth having. They are driven over fixtures; this one is
      // driven over the tree that ships, and it is what goes red on the next publish that forgets.
      const root = fileURLToPath(new URL("../../..", import.meta.url));
      const manifests = readManifests(root);
      expect(comparableSubjects(manifests)).toHaveLength(COMPARABLE_FLOOR);
      expect(floorRefusal({ manifests })).toBeNull();
    });
  });

  it("a version not yet published is a note, and leaves the run unmeasured rather than green", async () => {
    const { root, manifests } = fixture({ version: "0.19.0" });
    try {
      const r = await parityReport({
        manifests,
        registry: FakeRegistry({ contents: parityContents() }),
      });
      expect(r.drift).toEqual([]);
      expect(r.notes[0]).toMatch(/not on the registry yet/);
      expect(verdict({ ...r, floor: 1 }).code).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check:published-parity — a fault is never reported as drift", () => {
  it("⛔⛔ an unreachable registry is a FAULT, not drift and never parity", async () => {
    const { root, manifests } = fixture();
    try {
      const r = await parityReport({
        manifests,
        registry: FakeRegistry({ throws: "metadata" }),
      });
      expect(r.drift).toEqual([]);
      expect(r.faults[0]).toMatch(/An unreachable registry is NOT parity/);
      expect(verdict({ ...r, floor: 1 }).code).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("⛔ an unfetchable tarball, an empty one, and an empty subject set are all faults", async () => {
    for (const [opts, re] of [
      [{ throws: "contents" as const }, /could not be read/],
      [{ contents: new Map<string, string>() }, /yielded no files/],
    ] as const) {
      const { root, manifests } = fixture();
      try {
        const r = await parityReport({
          manifests,
          registry: FakeRegistry(opts),
        });
        expect(r.drift).toEqual([]);
        expect(r.faults[0]).toMatch(re);
        expect(verdict({ ...r, floor: 1 }).code).toBe(3);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    const empty = await parityReport({
      manifests: [],
      registry: FakeRegistry(),
    });
    expect(empty.faults[0]).toMatch(/subject set of zero, not a clean run/);
    expect(verdict(empty).code).toBe(3);
  });

  it("⛔ a symlink under src is a NAMED fault, and does not empty its own directory", async () => {
    const { root, manifests } = fixture();
    try {
      symlinkSync(
        join(root, "nowhere.ts"),
        join(root, "packages", "kernel", "src", "broken.ts"),
      );
      const r = await parityReport({
        manifests,
        registry: FakeRegistry({ contents: parityContents() }),
      });
      expect(r.faults[0]).toMatch(/broken\.ts/);
      expect(r.faults[0]).toMatch(/symbolic link/);
      expect(r.faults[0]).not.toMatch(/holds no files/);
      expect(verdict(r).code).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the four verdicts are distinguishable, and drift outranks a fault", () => {
    expect(verdict({ drift: [], faults: [], checked: 2, floor: 2 }).code).toBe(
      0,
    );
    expect(
      verdict({ drift: ["d"], faults: [], checked: 2, floor: 2 }).code,
    ).toBe(1);
    expect(verdict({ drift: [], faults: [], checked: 1, floor: 2 }).code).toBe(
      2,
    );
    expect(
      verdict({ drift: [], faults: ["f"], checked: 2, floor: 2 }).code,
    ).toBe(3);
    expect(
      verdict({ drift: ["d"], faults: ["f"], checked: 2, floor: 2 }).code,
    ).toBe(1);
    expect(COMPARABLE_FLOOR).toBe(31);
  });
});

describe("check:published-parity — the subject set and the path shapes", () => {
  it("the publishable predicate is the one a PUBLISH uses, and it discriminates", () => {
    const mk = (pkg: unknown) => ({ name: "x", path: "/x/package.json", pkg });
    const subjects = publishableManifests([
      mk({ name: "a", version: "1.0.0", publishConfig: { access: "public" } }),
      mk({
        name: "b",
        version: "1.0.0",
        private: true,
        publishConfig: { access: "public" },
      }),
      mk({ name: "c", version: "1.0.0" }),
      mk({
        name: "d",
        version: "1.0.0",
        publishConfig: { access: "restricted" },
      }),
    ]);
    expect(subjects.map((s: { pkg: { name: string } }) => s.pkg.name)).toEqual([
      "a",
    ]);
  });

  it("⛔ all three legal spellings of one directory read the same — `src`, `src/`, `./src`", () => {
    const { root, manifests } = fixture();
    try {
      const dir = join(manifests[0]!.path, "..");
      const expected = Object.keys(SRC)
        .map((f) => `src/${f}`)
        .sort();
      for (const spelling of ["src", "src/", "./src"]) {
        const got = declaredSourceFiles(dir, ["dist", spelling]);
        expect(got.comparable).toBe(true);
        expect([...got.files.keys()].sort()).toEqual(expected);
      }
      expect(declaredSourceFiles(dir, ["dist"]).comparable).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ---------------------------------------------------------------- the archive is never extracted */

function tarEntry(name: string, body: string, type = "0"): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, "utf8");
  header.write("000644 \0", 100);
  header.write("0000000 \0", 108);
  header.write("0000000 \0", 116);
  header.write(`${body.length.toString(8).padStart(11, "0")} `, 124);
  header.write("00000000000 ", 136);
  header.write(type, 156);
  header.write("ustar\0" + "00", 257);
  header.fill(" ", 148, 156);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const content = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  Buffer.from(body).copy(content);
  return Buffer.concat([header, content]);
}

describe("check:published-parity — a downloaded archive is walked, never extracted", () => {
  it("⛔⛔ a hostile entry name is INERT — traversal and absolute paths become keys, never files", async () => {
    const { existsSync } = await import("node:fs");
    const canary = join(tmpdir(), "lcp-parity-traversal-canary.txt");
    rmSync(canary, { force: true });
    const tar = Buffer.concat([
      tarEntry("package/src/ok.ts", "export const ok = 1;\n"),
      tarEntry(
        "../../../../../../../../tmp/lcp-parity-traversal-canary.txt",
        "OWNED\n",
      ),
      tarEntry("/tmp/lcp-parity-traversal-canary.txt", "OWNED\n"),
      Buffer.alloc(1024),
    ]);
    const out = hashTarEntries(tar);
    expect(out.has("package/src/ok.ts")).toBe(true);
    expect(
      out.has("../../../../../../../../tmp/lcp-parity-traversal-canary.txt"),
    ).toBe(true);
    expect(existsSync(canary)).toBe(false);
  });

  it("⛔ symlink and directory entries are skipped — a link cannot be followed if it is never created", () => {
    const tar = Buffer.concat([
      tarEntry("package/src/real.ts", "export const a = 1;\n"),
      tarEntry("package/src/link.ts", "", "2"),
      tarEntry("package/src/nested/", "", "5"),
      Buffer.alloc(1024),
    ]);
    expect([...hashTarEntries(tar).keys()]).toEqual(["package/src/real.ts"]);
  });

  it("⛔ an unreadable size field is refused rather than silently truncating the archive", () => {
    const bad = tarEntry("package/x.ts", "hi");
    bad.write("XXXXXXXXXXX ", 124);
    expect(() =>
      hashTarEntries(Buffer.concat([bad, Buffer.alloc(1024)])),
    ).toThrow(/unreadable size field/);
  });
});

/* ---------------------------------------------------------------- the real seam, and the process */

function startRegistry({
  srcFiles,
  status = 200,
}: {
  srcFiles: Record<string, string>;
  status?: number;
}) {
  const dir = mkdtempSync(join(tmpdir(), "parity-reg-"));
  mkdirSync(join(dir, "package", "src"), { recursive: true });
  for (const [f, body] of Object.entries(srcFiles))
    writeFileSync(join(dir, "package", "src", f), body);
  writeFileSync(
    join(dir, "package", "package.json"),
    JSON.stringify({ name: NAME, version: VERSION }),
  );
  execFileSync("tar", ["czf", join(dir, "t.tgz"), "-C", dir, "package"]);
  const tgz = execFileSync("cat", [join(dir, "t.tgz")], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });

  const server = createServer((req, res) => {
    if (status !== 200) {
      res.writeHead(status);
      res.end("nope");
      return;
    }
    if (req.url?.endsWith("/t.tgz")) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(tgz);
      return;
    }
    const addr = server.address() as { port: number };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        versions: {
          [VERSION]: {
            dist: { tarball: `http://127.0.0.1:${addr.port}/t.tgz` },
          },
        },
      }),
    );
  });
  return new Promise<{ origin: string; stop: () => void }>((ok) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      ok({
        origin: `http://127.0.0.1:${addr.port}`,
        stop: () => {
          server.close();
          rmSync(dir, { recursive: true, force: true });
        },
      });
    }),
  );
}

/** ⛔ async `spawn`, never `spawnSync`: the fixture registry is a server in THIS process, and a synchronous
 * spawn blocks the event loop that would answer the child — both sides then wait for each other. */
/**
 * ⛔ `floor` defaults to 1 because a fixture holds one publishable package, and the gate now refuses when
 * its declared floor disagrees with the tree it is pointed at. Without this every spawned case would exit
 * 3 saying the floor does not describe the tree — which would be TRUE of the fixture and useless as a
 * drive of anything else.
 */
function runGate({
  root,
  origin,
  floor = 1,
}: {
  root: string;
  origin: string;
  floor?: number;
}) {
  return new Promise<{
    status: number | null;
    stderr: string;
    stdout: string;
  }>((resolve) => {
    const child = spawn(process.execPath, [GATE], {
      env: {
        ...process.env,
        INTEGRA_PARITY_ROOT: root,
        INTEGRA_PARITY_ORIGIN: origin,
        INTEGRA_PARITY_FLOOR: String(floor),
      },
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    // ⛔ STDOUT IS CAPTURED because the exit code is only half the question. A non-zero exit printed
    // BESIDE the success tick is how a red gate gets reported green by a human reading a log.
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.on("close", (status) => resolve({ status, stderr, stdout }));
  });
}

describe("check:published-parity — the real seam and the process exit codes", () => {
  it("★ the REAL NetworkRegistry parses a REAL gzipped tarball, prefix stripped and hashed", async () => {
    const reg = await startRegistry({ srcFiles: SRC });
    try {
      const r = NetworkRegistry({ origin: reg.origin });
      const meta = await r.metadata(NAME);
      const contents = await r.contents(
        NAME,
        VERSION,
        meta.versions[VERSION].dist.tarball,
      );
      expect([...contents.keys()].sort()).toEqual(
        ["package.json", ...Object.keys(SRC).map((f) => `src/${f}`)].sort(),
      );
      expect(contents.get("src/index.ts")).toBe(sha(SRC["index.ts"]!));
    } finally {
      reg.stop();
    }
  });

  it("⛔ 404 maps to `never published`; any other non-OK throws", async () => {
    const gone = await startRegistry({ srcFiles: SRC, status: 404 });
    try {
      expect(
        await NetworkRegistry({ origin: gone.origin }).metadata(NAME),
      ).toEqual({ versions: {} });
    } finally {
      gone.stop();
    }
    const broken = await startRegistry({ srcFiles: SRC, status: 503 });
    try {
      await expect(
        NetworkRegistry({ origin: broken.origin }).metadata(NAME),
      ).rejects.toThrow(/answered 503/);
    } finally {
      broken.stop();
    }
  });

  /**
   * ⛔⛔ THE TICK IS PRINTED ONLY ON PARITY — DRIVEN AS A PROCESS, WHICH IS THE ONLY PLACE IT IS VISIBLE.
   *
   * `main()` tested three verdict kinds by name and fell through to the success line. The function was
   * correct; the process that reads it was blind, and nothing that drives `verdict()` can see that. ⭐ The
   * guard is now inverted — anything that is not `parity` refuses — so a kind nobody wrote an arm for
   * cannot reach the tick. These cases hold that at the boundary a workflow actually reads.
   */
  it("⭐ THE CONTROL — a parity run DOES print the tick, so the refusals above are not vacuous", async () => {
    // Without this, every "no tick" assertion beside it would pass on a gate that never printed one.
    const f = fixture();
    const reg = await startRegistry({ srcFiles: SRC });
    try {
      const out = await runGate({ root: f.root, origin: reg.origin });
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout).toMatch(/every published version matches/);
    } finally {
      reg.stop();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("⛔⛔ a refused run prints NO success tick, on stdout, whatever its kind", async () => {
    // A version not on the registry leaves the run UNMEASURED — a refusal that is not drift and not a
    // fault, and the one whose arm is least likely to be written for a future sibling.
    const f = fixture({ version: "9.9.9" });
    const reg = await startRegistry({ srcFiles: SRC });
    try {
      const out = await runGate({ root: f.root, origin: reg.origin });
      expect(out.status, out.stderr).toBe(2);
      // ⛔ THE HALF THE EXIT CODE DOES NOT CARRY.
      expect(out.stdout).not.toMatch(/every published version matches/);
      expect(out.stdout).not.toMatch(/✓/);
    } finally {
      reg.stop();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("⛔ and a stale FLOOR refuses as a process too, with no tick beside it", async () => {
    const f = fixture({ extra: 2 });
    const reg = await startRegistry({ srcFiles: SRC });
    try {
      // Three comparable packages, a floor that still says one: the declaration is behind the tree.
      const out = await runGate({ root: f.root, origin: reg.origin, floor: 1 });
      expect(out.status, out.stderr).toBe(3);
      expect(out.stderr).toMatch(/JOINED the comparable set/);
      expect(out.stdout).not.toMatch(/every published version matches/);
    } finally {
      reg.stop();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("⛔ an INJECTED floor that is not a whole number is refused, never coerced", async () => {
    // `Number("x")` is NaN, every comparison against it is false, and the floor refusal would then report
    // a direction with complete confidence. A port that can be handed nonsense must say so.
    const f = fixture();
    const reg = await startRegistry({ srcFiles: SRC });
    try {
      const out = await new Promise<{ status: number | null; stderr: string }>(
        (resolve) => {
          const child = spawn(process.execPath, [GATE], {
            env: {
              ...process.env,
              INTEGRA_PARITY_ROOT: f.root,
              INTEGRA_PARITY_ORIGIN: reg.origin,
              INTEGRA_PARITY_FLOOR: "not-a-number",
            },
          });
          let stderr = "";
          child.stderr.on("data", (d) => {
            stderr += d;
          });
          child.on("close", (status) => resolve({ status, stderr }));
        },
      );
      expect(out.status, out.stderr).toBe(3);
      expect(out.stderr).toMatch(/is not a whole number/);
    } finally {
      reg.stop();
      rmSync(f.root, { recursive: true, force: true });
    }
  });

  it("⛔⛔ THE PROCESS EXITS THE CODE — the workflow reads that, not a return value", async () => {
    const drift = fixture();
    const short = { ...SRC };
    delete short["spec-version.ts"];
    const driftReg = await startRegistry({ srcFiles: short });
    try {
      const out = await runGate({ root: drift.root, origin: driftReg.origin });
      expect(out.status, out.stderr).toBe(1);
      expect(out.stderr).toMatch(/IS PUBLISHED AND IS BEHIND ITS OWN SOURCE/);
    } finally {
      driftReg.stop();
      rmSync(drift.root, { recursive: true, force: true });
    }

    const fault = fixture();
    try {
      const out = await runGate({
        root: fault.root,
        origin: "http://127.0.0.1:1",
      });
      expect(out.status, out.stderr).toBe(3);
      expect(out.stderr).toMatch(/THE INSTRUMENT FAILED/);
    } finally {
      rmSync(fault.root, { recursive: true, force: true });
    }
  });
});
