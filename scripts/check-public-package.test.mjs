// Runs scripts/check-public-package.mjs's scan under a test key and a list of dummy items this file holds, and sees each
// planted form found on its line and each absent one not found. Run with `node --test scripts/`.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { check, digests, keyOf, scanner } from "./check-public-package.mjs";

const SCRIPT = join(import.meta.dirname, "check-public-package.mjs");
const key = randomBytes(32);
const items = [
  ["words", "quill box"],
  ["words", "marmot"],
  ["words", "tin-lantern"],
  ["words", "quill-box"],
  ["words", "aug-7-dim"],
  ["namespace", "zephyr/"],
];
const table = digests(key, items);
const scan = scanner(key, table);
const items1 = (text) => scan(text).map(({ item }) => item);

test("the digests hold no item and no word of one, and an item with the forms of an earlier one is left out", () => {
  const text = JSON.stringify(table);
  for (const s of ["quill", "box", "marmot", "lantern", "zephyr"]) assert.ok(!text.includes(s), s);
  assert.deepEqual(
    table.held.map(([n, kind]) => [n, kind]),
    [
      [1, "words"],
      [2, "words"],
      [3, "words"],
      [5, "words"],
      [6, "namespace"],
    ],
  );
});

const found = [
  ["the item as held", "a quill box here", [1]],
  ["a hyphen", "quill-box", [1]],
  ["an underscore", "quill_box", [1]],
  ["capitals", "QUILL BOX", [1]],
  ["a capital between words", "quillBox and TinLantern", [1, 3]],
  ["a line break between words", "quill\nbox", [1]],
  ["a single word", "the marmot", [2]],
  ["three words with a digit", "aug-7-dim", [5]],
  ["a plural in s", "marmots and tin lanterns", [2, 3]],
  ["a plural in es", "quill boxes", [1]],
  ["a plural inside an item", "quills box", [1]],
  ["a possessive", "the marmot's den; the quill's box", [1, 2]],
  ["a curly possessive", "the marmot’s den", [2]],
  ["a plural possessive", "the marmots' den; the quills' box", [1, 2]],
  ["words run together", "quillbox and tinlantern and aug7dim", [1, 3, 5]],
  ["words run together, plural", "quillboxes", [1]],
  ["words run together, possessive", "the quillbox's lid", [1]],
  ["percent-encoded", "quill%20box", [1]],
  ["percent-encoded twice", "quill%2520box", [1]],
  ["percent-encoded letters", "%6D%61%72%6D%6F%74", [2]],
  ["a percent-encoded line break", "quill%0Abox", [1]],
  ["a zero-width space inside a word", "mar​mot", [2]],
  ["a zero-width joiner between words", "quill‍box", [1]],
  ["a soft hyphen", "tin­lantern", [3]],
  ["a byte order mark", "﻿marmot", [2]],
  ["full-width letters", "ｍａｒｍｏｔ", [2]],
  ["a namespace", 'refusal("zephyr/no-key")', [6]],
  ["a namespace, percent-encoded", "zephyr%2Fno-key", [6]],
  ["a namespace with a zero-width space", "zeph​yr/no-key", [6]],
];

for (const [form, text, want] of found) {
  test(`a planted item is found: ${form}`, () => assert.deepEqual([...new Set(items1(text))].sort(), want));
}

const absent = [
  ["one word of an item of two", "a quill and a box"],
  ["words that begin with an item's words", "quilted boxer"],
  ["a word that begins with an item", "marmoset"],
  ["the words in another order", "box quill; boxquill"],
  ["the words apart", "quill large box"],
  ["a namespace's word with no slash", "zephyr wind"],
  ["a namespace's plural", "zephyrs/no-key"],
  ["a namespace inside a longer word", "my-zephyr/no-key"],
  ["a percent sign that encodes nothing", "quill%zzbox"],
];

for (const [form, text] of absent) {
  test(`an absent item is not found: ${form}`, () => assert.deepEqual(scan(text), []));
}

test("a finding names its line and item", () => {
  assert.deepEqual(scan("one\ntwo marmot\nthree\nquill\nbox"), [
    { line: 2, item: 2 },
    { line: 4, item: 1 },
  ]);
});

test("a key other than the list's is refused", () => {
  assert.throws(() => scanner(randomBytes(32), table), /not the one the list was made with/);
});

test("the key is read from the environment or a file, and must be 32 bytes in hex", () => {
  const hex = key.toString("hex");
  assert.deepEqual(keyOf(undefined, { PUBLIC_CHECK_KEY: hex }).key, key);
  assert.match(keyOf(undefined, {}).reason, /^no key/);
  assert.match(keyOf(undefined, { PUBLIC_CHECK_KEY: "ab" }).reason, /not 32 bytes in hex/);
  const dir = mkdtempSync(join(tmpdir(), "check-public-package-"));
  try {
    writeFileSync(join(dir, "key.hex"), `${hex}\n`);
    assert.deepEqual(keyOf(join(dir, "key.hex"), {}).key, key);
    assert.match(keyOf(join(dir, "none.hex"), {}).reason, /^no key file/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("with no key, or a key that is not the list's, the check does not run and exits 2", () => {
  const env = { ...process.env };
  delete env.PUBLIC_CHECK_KEY;
  const none = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8" });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /did not run: no key/);
  const other = spawnSync(process.execPath, [SCRIPT], {
    env: { ...env, PUBLIC_CHECK_KEY: randomBytes(32).toString("hex") },
    encoding: "utf8",
  });
  assert.equal(other.status, 2);
  assert.match(other.stderr, /did not run: the key is not the one the list was made with/);
});

test("the check reads every file git lists, its content and its path, and finds a planted item in each", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-public-package-"));
  try {
    execFileSync("git", ["init", "-q", dir]);
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "clean.md"), "nothing held here\n");
    execFileSync("git", ["-C", dir, "add", "."]);
    assert.deepEqual(check(dir, [], scan), {
      code: 0,
      lines: ["check-public-package: read 1 files (0 binary files not read) and found no held item"],
    });
    writeFileSync(join(dir, "docs", "clean.md"), "nothing held here\nbut two quill boxes\n");
    mkdirSync(join(dir, "marmots"));
    writeFileSync(join(dir, "marmots", "notes.txt"), "text\n");
    writeFileSync(join(dir, "untracked.txt"), "a marmot\n");
    execFileSync("git", ["-C", dir, "add", "docs", "marmots"]);
    assert.deepEqual(check(dir, [], scan), {
      code: 1,
      lines: [
        "docs/clean.md:2: item 1",
        "marmots/notes.txt: item 2 in its path",
        "check-public-package: read 2 files; 2 findings",
      ],
    });
    const extra = join(dir, "untracked.txt");
    assert.equal(check(dir, [extra], scan).lines.at(-2), `${extra}:1: item 2`);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("over a directory git does not hold, such as an unpacked package, --dir reads every file and a git listing exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-public-package-"));
  try {
    mkdirSync(join(dir, "package", "marmots"), { recursive: true });
    writeFileSync(join(dir, "package", "README.md"), "nothing held here\nbut two quill boxes\n");
    writeFileSync(join(dir, "package", "marmots", "notes.txt"), "text\n");
    const root = join(dir, "package");
    assert.equal(check(root, [], scan).code, 2);
    assert.match(check(root, [], scan).lines[0], /^check-public-package: git lists no files in .*; --dir reads a directory$/);
    assert.deepEqual(check(root, [], scan, { dir: true }), {
      code: 1,
      lines: [
        "README.md:2: item 1",
        "marmots/notes.txt: item 2 in its path",
        "check-public-package: read 2 files; 2 findings",
      ],
    });
  } finally {
    rmSync(dir, { recursive: true });
  }
});
