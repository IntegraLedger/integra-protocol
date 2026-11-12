#!/usr/bin/env node
// Checks that no file git lists in the repository names an item on a held list: names and phrases that have no place
// in this public repository, and refusal-code namespaces that no code here may use. It reads every file's content
// (code, prose, vectors, tests, profiles, the site's sources, workflows and package metadata alike) and its path.
//
// The list is held as SHA-256 digests, so this file does not spell any item on it. Text is read as Unicode NFKC, in
// lowercase. It is split into words three ways: on every character that is not a letter a-z or a digit 0-9, keeping a
// hyphen inside a word ("a-b" is one word); on the same characters and the hyphen ("a-b" is the two words "a" and
// "b"); and as the second way after a lower-case letter or digit followed by a capital is split apart ("aB" is the two
// words "a" and "b"). Words run on across line breaks. Each sequence of one, two and three consecutive words, joined
// by one space, and each sequence of the second and third ways also joined by a hyphen, is hashed and compared with
// the held digests of the items, each normalised the same way, so "a-b", "a b" and "aB" all match an item "a-b" or
// "a b". The digest of each word an item holds is held too (WORDS), and a sequence is hashed only when each of its
// words is one of them. A namespace item matches a word, whole and with its hyphens, that is followed at once by "/",
// as a refusal code `<namespace>/<reason>` is written; its digest is taken over the word and the "/".
//
// A finding is printed as `<file>:<line>: item <n>`, where n is the item's position in HELD, counting from 1; a
// finding in a file's path is printed as `<file>: item <n> in its path`. The matched text is never printed.
//
// Usage, from the repository root:
//   node scripts/check-public-package.mjs                  check every file `git ls-files` lists
//   node scripts/check-public-package.mjs --root <dir>     check the files git lists in another work tree
//   node scripts/check-public-package.mjs --file <path>    also read this file, which git need not list (repeatable)
// It exits 0 when it finds nothing, 1 when it finds an item, and 2 on a usage error.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";

/** The held items: each a kind ("words": one to three words; "namespace": a refusal-code namespace) and a digest. */
export const HELD = [
  ["words", "b5e5dd909a2330cdff273c344a438825c22da1acc18a3a1880f5b86a7bda97c2"],
  ["words", "e87bdd39792a988e195511f38552bee6ab3bab8a557988a512b25f53580b82fc"],
  ["words", "dcbbb65b0f974e77b1db643996c9c063e468c2d075068f70b5e020c9d07380e8"],
  ["words", "700df345f83a3cfa6db52d9b634a4f079d7a8a50aa132be2fd97ef84387b3010"],
  ["words", "74660eb72329fbd8e7c89c411c938110cc4971b9ae8a636531fda80a24b93d90"],
  ["words", "29748f9c17b53b11feeba45ef71e67bd2f0b1213ec80891817cf29e060e96445"],
  ["words", "cb4a7e63b7a36850851233177d448370c0261469c93e6e1e878dfabbd38e83bb"],
  ["words", "7fac797188d2d886ee1f6ba135101ac1963677d675936b5433a737efb03dced9"],
  ["words", "afd344dbe70f5133de3b9a1093ef11529ca1f56d6632ea1aa7290f13dcbc1c03"],
  ["words", "c9346cc4bd54e4b42387d6cedafbd3f7ff937658b8bdc303b81ca8bf82fd270b"],
  ["words", "25904b3ad5cd3b704378066b8d1142816415b5711ca659458edb0a994750aa25"],
  ["words", "696f4797ac3d5a57725bbd596d0dc4b86bf64f45ff0475aeb235617f15200ac2"],
  ["words", "eba39a6b139652f94053b348d25d3c4f980b5e834667e0a0bd4689f759f3f435"],
  ["words", "8371deeacac01c19a1dea1d0c59fc92003172c7bcba90e3b2cc3ff0fb69c7447"],
  ["words", "ebf18ef435844bc691456112f5e76c1660efd7bcb4b9a9495e541fb5024d37f4"],
  ["namespace", "d07993d7bd4337409e642ac625dd970338b138b05e3fed70b7737812d3857f03"],
  ["namespace", "a7b0c0d7eed3f766abe4ac6334a42298648bdbce9acc0727a3b4ed7f85a825bb"],
];

/** The digest of each word an item of the kind "words" holds, whole and, where it holds a hyphen, split at it. */
export const WORDS = [
  "120970d812836f19888625587a4606a5ad23cef31c8684e601771552548fc6b9",
  "247610f4dedd4ab7247d07dbda19c81ca9817f85820742cad49d407ffae9e4ed",
  "2534e2de1dec24fedab4c00266b55ba9ba60dde03a349c5b5662189dd561ba9e",
  "29748f9c17b53b11feeba45ef71e67bd2f0b1213ec80891817cf29e060e96445",
  "2d8d693177ac44895fc02c009ec3f6af32e51eb00783c17000d7051d1662b93a",
  "5694d08a2e53ffcae0c3103e5ad6f6076abd960eb1f8a56577040bc1028f702b",
  "64879f7d6b960a01909762d911a32d4582c20010c5641ee90278b644a9e3b525",
  "660f5656e3e8f13ca2bfec97802c34e9b665e2360e27f572edf04431aca1be5e",
  "700df345f83a3cfa6db52d9b634a4f079d7a8a50aa132be2fd97ef84387b3010",
  "74660eb72329fbd8e7c89c411c938110cc4971b9ae8a636531fda80a24b93d90",
  "7fac797188d2d886ee1f6ba135101ac1963677d675936b5433a737efb03dced9",
  "7fbf6e75133d6612157fae6ee80b0d3d780399b6101b40d090fd3fcbd2b011a6",
  "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
  "a4279eae47aaa7417da62434795a011ccb0ec870f7f56646d181b5500a892a9a",
  "b5e5dd909a2330cdff273c344a438825c22da1acc18a3a1880f5b86a7bda97c2",
  "bc020a35b7f9cb1382e7b534c68e3c531d849b119bf14f75ddead6cc45c3ccc1",
  "c0d2856b74d0df05b9d4456b177950351bd88e98b77f12574dfb7a911acee0d0",
  "c247e9808f5e81b86fef7da1aeb81d92b8e7adc18c46ee83b946efa3cb8df673",
  "c7c8fc91abb8ed76c29a883381b92612dcd8235d6e7ddca8d81f6e87d5fab417",
  "cfb240efa8670bfe5c76d860adc3e87d3555dff0b987cef02bbcc44a9f80e62f",
  "d4f0bc5a29de06b510f9aa428f1eedba926012b591fef7a518e776a7c9bd1824",
  "dcbbb65b0f974e77b1db643996c9c063e468c2d075068f70b5e020c9d07380e8",
  "dd1b3c312cf7d816130354452e9629ce39355b0c534129dd26a08cd9a4502ede",
  "e2764810dbaf95bdab555ca038cb58e176e0920df73009fbdae2090fe43774db",
  "e87bdd39792a988e195511f38552bee6ab3bab8a557988a512b25f53580b82fc",
  "eb1e33e8a81b697b75855af6bfcdbcbf7cbbde9f94962ceaec1ed8af21f5a50f",
  "f9f5cf73e6038b91418b0f090fdaf9df1e9a40dc00799e42f837cc533864aeac",
];

const words = new Map();
const namespaces = new Map();
HELD.forEach(([kind, digest], i) => (kind === "namespace" ? namespaces : words).set(digest, i + 1));
const parts = new Set(WORDS);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const seenWords = new Map();
const seenItems = new Map();

/** Whether a word is one an item holds; each word is hashed once per run. */
function heldWord(w) {
  let held = seenWords.get(w);
  if (held === undefined) {
    held = w.length <= 100 && parts.has(sha256(w));
    seenWords.set(w, held);
  }
  return held;
}

/** The held item a string's digest equals, by its position from 1, or 0; each string is hashed once per run. */
function itemOf(table, s) {
  let n = seenItems.get(s);
  if (n === undefined) {
    n = table.get(sha256(s)) ?? 0;
    seenItems.set(s, n);
  }
  return n;
}

/** The words of a text, each with its line (from 1), split on the characters `split` matches. */
function wordsOf(lines, split, trimHyphens) {
  const out = [];
  lines.forEach((line, i) => {
    for (let w of line.split(split)) {
      if (trimHyphens) w = w.replace(/^-+|-+$/g, "");
      if (w !== "") out.push([w, i + 1]);
    }
  });
  return out;
}

/**
 * Adds a finding for each sequence of one to three words, joined by each joiner, whose digest is a held item's. A
 * sequence is hashed only when each of its words is one an item holds.
 */
function sequences(list, joiners, found) {
  for (let i = 0; i < list.length; i++) {
    const run = [];
    for (let n = 0; n < 3 && i + n < list.length; n++) {
      if (!heldWord(list[i + n][0])) break;
      run.push(list[i + n][0]);
      for (const joiner of joiners) {
        const item = itemOf(words, run.join(joiner));
        if (item !== 0) found.add(`${list[i][1]}\0${item}`);
      }
    }
  }
}

/**
 * The findings in a text: each `{ line, item }`, a line from 1 and a held item's position from 1, sorted by line and
 * then by item, each pair once.
 */
export function scan(text) {
  const nfkc = text.normalize("NFKC");
  const lower = nfkc.toLowerCase().split(/\r\n|\r|\n/);
  const camel = nfkc
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/\r\n|\r|\n/);
  const found = new Set();
  sequences(wordsOf(lower, /[^a-z0-9-]+/, true), [" "], found);
  sequences(wordsOf(lower, /[^a-z0-9]+/, false), [" ", "-"], found);
  sequences(wordsOf(camel, /[^a-z0-9]+/, false), [" ", "-"], found);
  lower.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![a-z0-9-])([a-z0-9]+(?:-[a-z0-9]+)*)\//g)) {
      const item = namespaces.get(sha256(`${m[1]}/`)) ?? 0;
      if (item !== 0) found.add(`${i + 1}\0${item}`);
    }
  });
  return [...found]
    .map((k) => k.split("\0").map(Number))
    .map(([line, item]) => ({ line, item }))
    .sort((a, b) => a.line - b.line || a.item - b.item);
}

/** The text of a file, or undefined when it holds a NUL byte in its first 8,000 bytes, as git tells a binary file. */
function textOf(path) {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8000).includes(0)) return undefined;
  return bytes.toString("utf8");
}

function main(argv) {
  let root = process.cwd();
  const extra = [];
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--root" || argv[i] === "--file") && i + 1 < argv.length) {
      if (argv[i] === "--root") root = resolve(argv[++i]);
      else extra.push(resolve(argv[++i]));
    } else {
      console.error(`check-public-package: unknown argument ${argv[i]}; usage: [--root <dir>] [--file <path>]...`);
      return 2;
    }
  }
  // Each entry is `<mode> <object> <stage>\t<path>`; a submodule (160000) is not read, a symbolic link (120000) is read
  // as the path it points to, and a file git lists but the work tree no longer holds is not read.
  const ls = ["-C", root, "ls-files", "-z", "--stage"];
  const listed = execFileSync("git", ls, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter((e) => e !== "")
    .map((e) => [e.slice(0, 6), e.slice(e.indexOf("\t") + 1)]);
  const files = [];
  for (const [mode, path] of listed) if (mode !== "160000") files.push([path, join(root, path), mode === "120000"]);
  for (const path of extra) {
    if (!existsSync(path)) {
      console.error(`check-public-package: no file ${path}`);
      return 2;
    }
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
  if (out.length > 0) {
    for (const line of out) console.log(line);
    console.log(`check-public-package: read ${read} files; ${out.length} findings`);
    return 1;
  }
  console.log(
    `check-public-package: read ${read} files (${binary} binary files not read) ` +
      `and found none of the ${HELD.length} held items`,
  );
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
