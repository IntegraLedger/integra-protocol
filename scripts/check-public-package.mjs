#!/usr/bin/env node
// Checks that no file git lists in the repository names an item on a held list: names and phrases that have no place
// in this public repository, and refusal-code namespaces that no code here may use. It reads every file's content
// (code, prose, vectors, tests, profiles, the site's sources, workflows and package metadata alike) and its path.
//
// The list is held as HMAC-SHA-256 digests under a 32-byte key that this repository does not hold, so neither this
// file nor anything else here spells an item or lets one be tested by a guess. The key is given at run time, in hex,
// in the environment variable PUBLIC_CHECK_KEY or in a file named by --key-file. KEY_CHECK is the digest of a fixed
// tag under the key the list was made with; a key whose digest of that tag differs is refused. With no key, or a key
// that is refused, the check does not run: it says so and exits 2.
//
// Each text is scanned as it stands, and again after each round of percent-decoding while a round changes it, each
// decoded line break read as a space. A text is read as Unicode NFKC, with every default
// ignorable code point (the zero-width characters, the soft hyphen, the variation selectors) removed. An apostrophe
// and "s" that end a word are removed ("a's b" reads as "a b"), and an apostrophe after a final "s" is removed. The text
// is then split into words two ways, both in lowercase: on every character that is not a letter a-z or a digit 0-9;
// and the same after a lower-case letter or digit followed by a capital is split apart ("aB" is the two words "a" and
// "b"). Words run on across line breaks. A word is read as itself, as itself less a final "s", and as itself less a
// final "es", so a plural form matches. Each sequence of one, two and three consecutive words, joined by one space, is
// compared by its digest with the forms of the items: an item's words, each split as a text is, joined by one space, and,
// for an item of more than one word, its words run together with no joiner. So "a-b", "a b", "aB", "a_b", "a b's",
// "a bs", "ab", "abs" and "a%20b" all match an item "a b". The digest of each word an item holds, and of each item's
// words run together, is held too (WORDS), and a sequence is hashed only when each of its words is one of them. A
// namespace item matches a word, whole and with its hyphens, that is followed at once by "/", as a refusal code
// `<namespace>/<reason>` is written; its digest is taken over the word and the "/". A namespace takes no plural form.
//
// Not matched: base64 or hex encodings of an item, an item written in letters of another script that look alike, and
// an item of three words written as two (two run together and one apart).
//
// A finding is printed as `<file>:<line>: item <n>`, where n is the number HELD gives the item; a finding in a file's
// path is printed as `<file>: item <n> in its path`. The matched text is never printed.
//
// Usage, from the repository root:
//   node scripts/check-public-package.mjs                  check every file `git ls-files` lists
//   node scripts/check-public-package.mjs --root <dir>     check the files git lists in another work tree
//   node scripts/check-public-package.mjs --dir <dir>      check every file under a directory git need not hold, such
//                                                          as an unpacked package
//   node scripts/check-public-package.mjs --file <path>    also read this file, which git need not list (repeatable)
//   node scripts/check-public-package.mjs --key-file <p>   read the key, in hex, from this file, not PUBLIC_CHECK_KEY
// It exits 0 when it finds nothing, 1 when it finds an item, and 2 when it did not run: no key, a refused key or a
// usage error.
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The held items: each its number, its kind ("words": one to three words; "namespace": a refusal-code namespace) and
 * the digest of each of its forms.
 */
export const HELD = [
  [1,"words","91c9cff7585ed5cab0dccc30eeb9dc9e6b7218f0742c3c95663aa67f37411ded"],
  [2,"words","af3cefa45208d6ce81ad344192e714a5130f1b962d1ebbc4be4163e431e95142"],
  [3,"words","859989d538e1307110c0961c260141445daf9296f608bd040166e5b884981ec0","1759d1e1abb20bef6f80c7817460f949772b9a1b4589ecd2f8e46d572370ffd2"],
  [4,"words","b20415634caa63ca197f47533db3f5d8346c672a0386c7f7071723ead48b25ee","f0058fc0eb501add7ffc8fc2aefe3b0ebe37c412cc5bf366b1c8c2902aecb11d"],
  [5,"words","ef6caa3c08ae8d11f57b3c430a6532863f0d1e853417eaa7b3c0c6fafd15631a","bb8b468f4a088a5e50f33d5ba5d21170be510dd22e9c6a7f6667da2880d20e0c"],
  [6,"words","048d44e7eecbe112049d92967197ca9856bd5ed79bc03abaaa25e553834ae560","421e74a1461b9fa1906532df4ad14ed1e7dbcd0320f4387dbea472f783f6230d"],
  [7,"words","9e3aa947bdb7d0a8424f7935da31e1ddb9159927befe71c90cd089ee6f3d25dd","78d0ca3207aea84f2a6465b0a45e8c5e8bbda718027c92b474a37282940d9ecc"],
  [9,"words","b0a8efcdc7289e9886f07da00ae5b38d6dcab74d5b2bea3a348f3abae22b3a00","5a141c4872bc9941b87c48540e18e9bea88de703b0d9e6a648aaa2d8200d1be2"],
  [10,"words","d9654d1d85d45c27b78f7b66095bec677232b9b43aed3dc1785d9adf511bd985","aabf3af0af2e2370e6c9884c9dcc85acaad093fd37f75f2efe80f321632712fb"],
  [11,"words","2ccffa59644bfd53f89be0702030c996a3a44557f56214bb24044c672180c4ea","6c55a0e396e63b28b3a77e5855c807aa49e680a74900a6f4126861392bb9fd86"],
  [12,"words","ff82bd02a80f68c530582ace0f8e9f15faea7f221565687ae92814d33bac875f","546890fafc2f726e25a02e7108bf2685289727f5a67436f6d2ab16a3da55be41"],
  [13,"words","42b27977471ea4fcd5b77a921789fe4cb666232166668dcd3f1e6f837b526e51","4dc8fe5af44d798c6ab252b867b544c04cf49d6c65e1e6221ada188d78b09996"],
  [14,"words","e6a4a420fb3364708087107dcbba499140a64c9014b473366e41118bdfe96ff6","95c5a1da0ace921f6cfa72ad004c0f35faeaffe93c56a7777c0ca60e56dd3705"],
  [15,"words","ab203639bbc2cc625db6ee9d53396981e79f90a60364e7a4d61e31d9ecc3fe9b","b33d30d7a3878aa20846206323ea857728c2958661f52dd23cefee5e3288cb3c"],
  [16,"namespace","98b8f07414cd34a89ed9114a500c5d9af9afb451661e02524441d863e7657b1c"],
  [17,"namespace","fbc30690c4f1b780013b73420ebcde8b8789c11a9ab8f184501ab72a8755fa3d"],
];

/** The digest of each word an item of the kind "words" holds, and of each such item's words run together. */
export const WORDS = [
  "0f881d03cba00f280e14865fc0bf1bf9d1cfd35183902b8cb8828357e426dff1",
  "1759d1e1abb20bef6f80c7817460f949772b9a1b4589ecd2f8e46d572370ffd2",
  "22098946a35a95a38e99a03962ad10e49e39cab9e9f101ed9a85d536e40bf2a3",
  "27ae662219d3084fbfd36d70152074ea11696a5f66cd7d34998f822de00d9c08",
  "29a3d54256de3bb08691b605ba16981b14c8f3acef974612dd4921bfe284d547",
  "2d195c2c4ea1642db93755f4ab757c14562b3412ea5fb0dfd70b5c47b0be5d4b",
  "2f3cfa738e05122b6f59a7e9904145db28b18bd58255f680242cd0dfcfadb26d",
  "33c10d963b4062b8586d946f89d380fbd90ba83b15bbbeaac27e07d2ae6995f3",
  "3c104414aa2cb5dc3966cd7d72442ce48fc47e07b69ee74cb60833aae1933f15",
  "421e74a1461b9fa1906532df4ad14ed1e7dbcd0320f4387dbea472f783f6230d",
  "44d152d83fa6cc43491c940ad57f356bee289b377b0629192f0eec5b8b829560",
  "4dc8fe5af44d798c6ab252b867b544c04cf49d6c65e1e6221ada188d78b09996",
  "546890fafc2f726e25a02e7108bf2685289727f5a67436f6d2ab16a3da55be41",
  "5a141c4872bc9941b87c48540e18e9bea88de703b0d9e6a648aaa2d8200d1be2",
  "5c42232a70a6771010abf45381ee2f2d8ae3d7e8f93573652f0d6420c110604b",
  "6c55a0e396e63b28b3a77e5855c807aa49e680a74900a6f4126861392bb9fd86",
  "76444f74f805595a06985868e608594caca4101174f2b31fa7b5255fc747edd1",
  "78d0ca3207aea84f2a6465b0a45e8c5e8bbda718027c92b474a37282940d9ecc",
  "860fe5a81284f77b0490333658c3c5ff8d017e32f9be3d46839989f0d4340438",
  "87851af92e518b224602e3cdd0b61b3f115d55eb436c7584ce0259906753328f",
  "91c9cff7585ed5cab0dccc30eeb9dc9e6b7218f0742c3c95663aa67f37411ded",
  "95c5a1da0ace921f6cfa72ad004c0f35faeaffe93c56a7777c0ca60e56dd3705",
  "a1485c747efaa01a6376f275f27cb448f6498eb4c6da998f55284a0186645c6e",
  "a88bc8b5f8a4f1b1d5a9f04505d79d2b8585da4a0c9d5c15b395502ffb59fd6f",
  "aabf3af0af2e2370e6c9884c9dcc85acaad093fd37f75f2efe80f321632712fb",
  "af3cefa45208d6ce81ad344192e714a5130f1b962d1ebbc4be4163e431e95142",
  "b0643094ecd457a9acf60df6b404e43a3967ea4e7f2dbc200b0c7cacf1dcf373",
  "b33d30d7a3878aa20846206323ea857728c2958661f52dd23cefee5e3288cb3c",
  "b368b3fce87cc7c65a72d2fa30d44a8654539a08119453b0093dc06b41aa5120",
  "bb8b468f4a088a5e50f33d5ba5d21170be510dd22e9c6a7f6667da2880d20e0c",
  "da87b77d502c4875c3c8cf8362008db6754fac3e5e58c7e34a382709d4f1e2ab",
  "dd58917589a36eb546e35f64dc5157d2974a869bc2c63889359eb22c042b7bec",
  "f0058fc0eb501add7ffc8fc2aefe3b0ebe37c412cc5bf366b1c8c2902aecb11d",
  "f417ffa468099b8ec0b09af8413e8f5bed9fe1b49ebb1c400960a345fff9fcd8",
];

/** The digest of KEY_TAG under the key the list was made with. */
export const KEY_CHECK = "4ea550a282df1737edb534dc0a219cc87275f70dbb79790b029c1560eddc1d6b";

/** The tag whose digest tells the key the list was made with from any other. */
export const KEY_TAG = "check-public-package key";

const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/** A text as Unicode NFKC with every default ignorable code point removed. */
const normal = (text) => text.normalize("NFKC").replace(IGNORABLE, "");

/** The HMAC-SHA-256 of a string under a key, in hex. */
export const mac = (key, s) => createHmac("sha256", key).update(s).digest("hex");

/** The words of an item of the kind "words": in lowercase, split on every character that is not a-z or 0-9. */
const itemWords = (text) =>
  normal(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");

/**
 * The digests of a list of items under a key: `held`, each item's `[number, kind, ...form digests]`, numbered by its
 * place in the list from 1; `words`, sorted; and `check`, the digest of KEY_TAG. An item whose forms are all an earlier
 * item's is left out, and its number with it.
 */
export function digests(key, items) {
  const held = [];
  const words = new Set();
  const seen = new Set();
  items.forEach(([kind, text], i) => {
    let forms;
    if (kind === "namespace") {
      const name = normal(text).toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(name)) throw new Error(`item ${i + 1}: a namespace is a word and "/"`);
      forms = [name];
    } else if (kind === "words") {
      const ws = itemWords(text);
      if (ws.length < 1 || ws.length > 3) throw new Error(`item ${i + 1}: an item of the kind "words" holds one to three`);
      forms = ws.length > 1 ? [ws.join(" "), ws.join("")] : [ws[0]];
      for (const w of ws) words.add(mac(key, w));
      if (ws.length > 1) words.add(mac(key, ws.join("")));
    } else {
      throw new Error(`item ${i + 1}: no kind ${kind}`);
    }
    const ds = forms.map((f) => `${kind} ${mac(key, f)}`);
    if (ds.every((d) => seen.has(d))) return;
    for (const d of ds) seen.add(d);
    held.push([i + 1, kind, ...forms.map((f) => mac(key, f))]);
  });
  return { held, words: [...words].sort(), check: mac(key, KEY_TAG) };
}

/** The key: `{ key }`, or `{ reason }` when none is given or the one given is not 32 bytes in hex. */
export function keyOf(keyFile, env) {
  let hex;
  if (keyFile !== undefined) {
    if (!existsSync(keyFile)) return { reason: `no key file ${keyFile}` };
    hex = readFileSync(keyFile, "utf8").trim();
  } else if (env.PUBLIC_CHECK_KEY !== undefined && env.PUBLIC_CHECK_KEY !== "") {
    hex = env.PUBLIC_CHECK_KEY.trim();
  } else {
    return { reason: "no key: set PUBLIC_CHECK_KEY to the key in hex, or pass --key-file <path>" };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return { reason: "the key is not 32 bytes in hex" };
  return { key: Buffer.from(hex, "hex") };
}

/** The forms a word is read as: itself, less a final "s", and less a final "es". */
function readings(w) {
  const out = [w];
  if (w.length > 1 && w.endsWith("s")) out.push(w.slice(0, -1));
  if (w.length > 2 && w.endsWith("es")) out.push(w.slice(0, -2));
  return out;
}

/** The text after one round of percent-decoding, each decoded line break read as a space. */
function percentDecoded(text) {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = Uint8Array.from(run.slice(1).split("%"), (h) => parseInt(h, 16));
    return new TextDecoder().decode(bytes).replace(/\r\n|\r|\n/g, " ");
  });
}

/** The texts a text is scanned as: itself, and each round of percent-decoding while a round changes it. */
function variants(text) {
  const out = [normal(text)];
  for (let t = text, i = 0; i < 8; i++) {
    const next = percentDecoded(t);
    if (next === t) break;
    out.push(normal(next));
    t = next;
  }
  return out;
}

/** The words of lines, each `[readings that are held words, line]`, split on what is not a-z or 0-9. */
function wordsOf(lines, held) {
  const out = [];
  lines.forEach((line, i) => {
    for (const w of line.split(/[^a-z0-9]+/)) if (w !== "") out.push([w.length <= 100 ? held(w) : [], i + 1]);
  });
  return out;
}

/**
 * A scan under a key and a table (`held`, `words` and `check`, as `digests` gives them; HELD, WORDS and KEY_CHECK when
 * none is given): a function from a text to its findings, each `{ line, item }`, a line from 1 and an item's number,
 * sorted by line and then by item, each pair once. It throws when the key's digest of KEY_TAG is not the table's.
 */
export function scanner(key, table = { held: HELD, words: WORDS, check: KEY_CHECK }) {
  if (mac(key, KEY_TAG) !== table.check) throw new Error("the key is not the one the list was made with");
  const items = new Map();
  const namespaces = new Map();
  for (const [n, kind, ...forms] of table.held) for (const d of forms) (kind === "namespace" ? namespaces : items).set(d, n);
  const parts = new Set(table.words);
  const macs = new Map();
  const digest = (s) => {
    let d = macs.get(s);
    if (d === undefined) macs.set(s, (d = mac(key, s)));
    return d;
  };
  const held = (w) => readings(w).filter((r) => parts.has(digest(r)));

  /** Adds a finding for each sequence of one to three held words whose digest, joined by a space, is an item's. */
  function sequences(list, found) {
    for (let i = 0; i < list.length; i++) {
      let runs = [""];
      for (let n = 0; n < 3 && i + n < list.length; n++) {
        const rs = list[i + n][0];
        if (rs.length === 0) break;
        runs = runs.flatMap((run) => rs.map((r) => (run === "" ? r : `${run} ${r}`)));
        for (const run of runs) {
          const item = items.get(digest(run));
          if (item !== undefined) found.add(`${list[i][1]}\0${item}`);
        }
      }
    }
  }

  return function scan(text) {
    const found = new Set();
    for (const v of variants(text)) {
      const plain = v.replace(/['’ʼ]s(?![\p{L}\p{N}])/giu, "").replace(/(s)['’ʼ](?![\p{L}\p{N}])/giu, "$1");
      const lower = plain.toLowerCase().split(/\r\n|\r|\n/);
      const camel = plain
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/\r\n|\r|\n/);
      sequences(wordsOf(lower, held), found);
      sequences(wordsOf(camel, held), found);
      v.toLowerCase()
        .split(/\r\n|\r|\n/)
        .forEach((line, i) => {
          for (const m of line.matchAll(/(?<![a-z0-9-])([a-z0-9]+(?:-[a-z0-9]+)*)\//g)) {
            const item = namespaces.get(digest(`${m[1]}/`));
            if (item !== undefined) found.add(`${i + 1}\0${item}`);
          }
        });
    }
    return [...found]
      .map((k) => k.split("\0").map(Number))
      .map(([line, item]) => ({ line, item }))
      .sort((a, b) => a.line - b.line || a.item - b.item);
  };
}

/** The text of a file, or undefined when it holds a NUL byte in its first 8,000 bytes, as git tells a binary file. */
function textOf(path) {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8000).includes(0)) return undefined;
  return bytes.toString("utf8");
}

/**
 * Every file under `dir`, each `[path, path in dir, is a symbolic link]`, its path relative to `dir` with "/" between
 * names, sorted. A symbolic link is not followed: it is read as the path it points to.
 */
function walk(dir) {
  const files = [];
  const visit = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) visit(path);
      else if (e.isFile() || e.isSymbolicLink()) files.push([path, join(dir, path), e.isSymbolicLink()]);
    }
  };
  visit("");
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Checks the files git lists in `root`, or with `{ dir: true }` every file under `root`, and each path in `extra`, with
 * a scan. It returns the exit code and the lines to print.
 */
export function check(root, extra, scan, { dir = false } = {}) {
  const files = [];
  if (dir) {
    if (!existsSync(root)) return { code: 2, lines: [`check-public-package: no directory ${root}`] };
    files.push(...walk(root));
  } else {
    // Each entry is `<mode> <object> <stage>\t<path>`; a submodule (160000) is not read, a symbolic link (120000) is
    // read as the path it points to, and a file git lists but the work tree no longer holds is not read.
    const ls = ["-C", root, "ls-files", "-z", "--stage"];
    let out;
    try {
      out = execFileSync("git", ls, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const why = String(e.stderr ?? e.message).trim().split("\n")[0];
      return { code: 2, lines: [`check-public-package: git lists no files in ${root} (${why}); --dir reads a directory`] };
    }
    const listed = out
      .split("\0")
      .filter((e) => e !== "")
      .map((e) => [e.slice(0, 6), e.slice(e.indexOf("\t") + 1)]);
    for (const [mode, path] of listed) if (mode !== "160000") files.push([path, join(root, path), mode === "120000"]);
  }
  for (const path of extra) {
    if (!existsSync(path)) return { code: 2, lines: [`check-public-package: no file ${path}`] };
    files.push([path, path, false]);
  }

  let read = 0;
  let binary = 0;
  const out = [];
  for (const [name, path, link] of files) {
    for (const { item } of scan(name)) out.push(`${name}: item ${item} in its path`);
    let text;
    try {
      text = link ? readlinkSync(path, "utf8") : textOf(path);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    if (text === undefined) {
      binary++;
      continue;
    }
    read++;
    for (const { line, item } of scan(text)) out.push(`${name}:${line}: item ${item}`);
  }
  if (out.length > 0) return { code: 1, lines: [...out, `check-public-package: read ${read} files; ${out.length} findings`] };
  return {
    code: 0,
    lines: [`check-public-package: read ${read} files (${binary} binary files not read) and found no held item`],
  };
}

function main(argv, env) {
  let root = process.cwd();
  let dir = false;
  let given = 0;
  let keyFile;
  const extra = [];
  const usage = "usage: [--root <dir> | --dir <dir>] [--file <path>]... [--key-file <path>]";
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (["--root", "--dir", "--file", "--key-file"].includes(flag) && i + 1 < argv.length) {
      if (flag === "--root" || flag === "--dir") {
        root = resolve(argv[++i]);
        dir = flag === "--dir";
        given++;
      } else if (flag === "--file") extra.push(resolve(argv[++i]));
      else keyFile = resolve(argv[++i]);
    } else {
      console.error(`check-public-package: unknown argument ${flag}; ${usage}`);
      return 2;
    }
  }
  if (given > 1) {
    console.error(`check-public-package: one --root or --dir; ${usage}`);
    return 2;
  }
  const { key, reason } = keyOf(keyFile, env);
  let scan;
  try {
    if (key === undefined) throw new Error(reason);
    scan = scanner(key);
  } catch (e) {
    console.error(`check-public-package: did not run: ${e.message}`);
    return 2;
  }
  const { code, lines } = check(root, extra, scan, { dir });
  for (const line of lines) (code === 2 ? console.error : console.log)(line);
  return code;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2), process.env);
