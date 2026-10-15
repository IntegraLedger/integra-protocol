// Writes the Unicode data the URL Standard's host parser reads (lcp/src/internal/url-host.ts):
// lcp/src/internal/idna-data.ts, and the same tables as a Python module, scripts/idna/_idna_data.py. It fetches each
// Unicode 17.0.0 file that scripts/idna/sources.tsv names, from its URL, and checks the file's SHA-256 against the one
// listed there before it reads it, so the same bytes always give the same two files. Source files are read in memory
// and never written.
//
//   node scripts/idna/idna-data.mjs           writes both files
//   node scripts/idna/idna-data.mjs --check   writes nothing, and exits 1 unless both files on disk equal what it
//                                             writes, byte for byte
//
// Each file carries the Unicode License v3, lcp/LICENSE-UNICODE, under which the source files are distributed.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchPinned } from "./fetch-pinned.mjs";

const HERE = new URL("./", import.meta.url);
const ROOT = new URL("../../", import.meta.url);
const OUTPUTS = {
  ts: new URL("lcp/src/internal/idna-data.ts", ROOT),
  py: new URL("_idna_data.py", HERE),
};
const LICENSE = new URL("lcp/LICENSE-UNICODE", ROOT);
const UNICODE_VERSION = "17.0.0";
const LIMIT = 0x110000;

/** Bidi_Class, as RFC 5893 section 2 reads it: one letter per class it names, and X for every other class. */
const BIDI_LETTER = {
  L: "L", R: "R", AL: "A", AN: "N", EN: "E", ES: "S", CS: "C", ET: "T", ON: "O", BN: "B", NSM: "M",
};
/** The long Bidi_Class names the @missing lines of DerivedBidiClass.txt give. */
const BIDI_LONG = {
  Left_To_Right: "L", Right_To_Left: "R", Arabic_Letter: "AL", European_Terminator: "ET", Boundary_Neutral: "BN",
};

/** The rows of sources.tsv after its header: the file name, its URL and its SHA-256. */
function sources() {
  const lines = readFileSync(new URL("sources.tsv", HERE), "utf8").split("\n").filter((l) => l !== "");
  if (lines[0] !== "file\turl\tsha256") throw new Error("sources.tsv: the header is not file, url, sha256");
  return lines.slice(1).map((l) => {
    const [name, url, sha256, ...rest] = l.split("\t");
    if (rest.length > 0 || !/^[0-9a-f]{64}$/.test(sha256 ?? "") || !url?.startsWith("https://")) {
      throw new Error(`sources.tsv: not a file, an https URL and a SHA-256: ${l}`);
    }
    return { name, url, sha256 };
  });
}

/** The lines of a text, with no empty last line for a text that ends in a line feed. */
function linesOf(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Each data line's code point range and its other fields, comments dropped. */
function* dataRows(text) {
  for (const line of linesOf(text)) {
    const hash = line.indexOf("#");
    const body = (hash < 0 ? line : line.slice(0, hash)).trim();
    if (body === "") continue;
    const fields = body.split(";").map((f) => f.trim());
    const [first, last] = fields[0].split("..");
    yield [Number.parseInt(first, 16), Number.parseInt(last ?? first, 16), fields.slice(1)];
  }
}

/** The file's @missing lines: the default value of each range. */
function* missing(text) {
  for (const line of linesOf(text)) {
    if (!line.startsWith("# @missing:")) continue;
    const [span, value, ...rest] = line.slice("# @missing:".length).split(";").map((f) => f.trim());
    if (rest.length > 0 || value === undefined) throw new Error(`an @missing line of other than two fields: ${line}`);
    const [first, last] = span.split("..");
    yield [Number.parseInt(first, 16), Number.parseInt(last ?? first, 16), value];
  }
}

/** The starts and values of the runs of equal values. */
function runs(values) {
  const starts = [];
  const out = [];
  values.forEach((value, cp) => {
    if (out.length === 0 || out.at(-1) !== value) {
      starts.push(cp);
      out.push(value);
    }
  });
  return [starts, out];
}

/** The string of the code points a field of space-separated hex code points names. */
const codePoints = (field) =>
  String.fromCodePoint(...field.split(" ").filter((h) => h !== "").map((h) => Number.parseInt(h, 16)));

/** The tables, read from the source files' text. */
function tables(text) {
  // The mapping table. Each code point's value: a number d when it is valid as the code point c + d (0 for a valid or
  // deviation code point, which nontransitional processing keeps), a string when it maps to that string ("" for an
  // ignored one), null when it is disallowed.
  const mapping = new Array(LIMIT).fill(null);
  for (const [first, last, fields] of dataRows(text["IdnaMappingTable.txt"])) {
    const status = fields[0];
    const target = fields.length > 1 && fields[1] ? codePoints(fields[1]) : "";
    for (let cp = first; cp <= last; cp++) {
      if (status === "valid" || status === "deviation") mapping[cp] = 0;
      else if (status === "ignored") mapping[cp] = "";
      else if (status === "mapped") mapping[cp] = [...target].length === 1 ? target.codePointAt(0) - cp : target;
      else if (status === "disallowed") mapping[cp] = null;
      else throw new Error(`IdnaMappingTable.txt: the status ${status} is not one this generator reads`);
    }
  }
  const valid = mapping.map((m) => m === 0);

  // The properties the validity criteria read, kept only where a code point is valid: elsewhere a code point takes the
  // value before it, which shortens the ranges and changes no answer, since a label holding it is refused.
  const onlyValid = (values) => {
    let held = values[0];
    return values.map((value, cp) => {
      if (valid[cp]) held = value;
      return held;
    });
  };

  const bidiText = text["DerivedBidiClass.txt"];
  const bidi = new Array(LIMIT).fill("L");
  for (const [first, last, value] of missing(bidiText)) {
    const short = BIDI_LONG[value];
    if (short === undefined) {
      throw new Error(`DerivedBidiClass.txt: the @missing value ${value} is not one this generator reads`);
    }
    for (let cp = first; cp <= last; cp++) bidi[cp] = short;
  }
  for (const [first, last, fields] of dataRows(bidiText)) for (let cp = first; cp <= last; cp++) bidi[cp] = fields[0];

  const joining = new Array(LIMIT).fill("U");
  for (const [first, last, fields] of dataRows(text["DerivedJoiningType.txt"])) {
    for (let cp = first; cp <= last; cp++) joining[cp] = ["L", "D", "R", "T"].includes(fields[0]) ? fields[0] : "U";
  }

  const mark = new Array(LIMIT).fill(false);
  for (const [first, last, fields] of dataRows(text["DerivedGeneralCategory.txt"])) {
    for (let cp = first; cp <= last; cp++) mark[cp] = ["Mn", "Mc", "Me"].includes(fields[0]);
  }
  const [markStarts, markRuns] = runs(onlyValid(mark));
  if (markRuns[0] !== false) throw new Error("DerivedGeneralCategory.txt: U+0000 is a mark");

  // Normalization: each code point's canonical combining class, its canonical decomposition (one level, Hangul
  // syllables left to the algorithm), and the code points excluded from composition.
  const ccc = new Array(LIMIT).fill(0);
  const decompositions = new Map();
  const lines = linesOf(text["UnicodeData.txt"]);
  lines.forEach((line, i) => {
    const fields = line.split(";");
    const cp = Number.parseInt(fields[0], 16);
    const end = fields[1].endsWith(", First>") ? Number.parseInt(lines[i + 1].split(";")[0], 16) : cp;
    for (let c = cp; c <= end; c++) ccc[c] = Number.parseInt(fields[3], 10);
    if (fields[5] && !fields[5].startsWith("<")) decompositions.set(cp, codePoints(fields[5]));
  });
  const excluded = [];
  for (const [first, last, fields] of dataRows(text["DerivedNormalizationProps.txt"])) {
    if (fields[0] === "Full_Composition_Exclusion") for (let cp = first; cp <= last; cp++) excluded.push(cp);
  }
  excluded.sort((a, b) => a - b);

  return {
    mapping: runs(mapping),
    bidi: runs(onlyValid(bidi.map((b) => BIDI_LETTER[b] ?? "X"))),
    joining: runs(onlyValid(joining)),
    markStarts,
    ccc: runs(ccc),
    decompositions: [...decompositions].sort((a, b) => a[0] - b[0]),
    excluded,
  };
}

/** A string literal with every code point past U+007E, and `"` and `\`, written as an escape: `\u{…}` in TypeScript. */
function literal(value, astral) {
  let out = '"';
  for (const c of value) {
    const o = c.codePointAt(0);
    if (o >= 0x20 && o < 0x7f && c !== '"' && c !== "\\") out += c;
    else if (o <= 0xffff) out += `\\u${o.toString(16).padStart(4, "0")}`;
    else out += astral(o);
  }
  return `${out}"`;
}
const tsString = (s) => literal(s, (o) => `\\u{${o.toString(16)}}`);
const pyString = (s) => literal(s, (o) => `\\U${o.toString(16).padStart(8, "0")}`);
const hex = (n) => `0x${n.toString(16).toUpperCase()}`;

/** The cells, comma-separated, filled into lines of at most 120 columns. */
function packed(cells, indent) {
  const lines = [];
  let line = "";
  for (const cell of cells) {
    if (line && indent.length + line.length + cell.length + 2 > 120) {
      lines.push(indent + line.trimEnd());
      line = "";
    }
    line += `${cell}, `;
  }
  lines.push(indent + line.trimEnd());
  return lines.join("\n");
}

/** A string in chunks of 100 characters, one per line. */
const chunks = (s) => s.match(/.{1,100}/g);

/** The notice the Unicode License v3 asks to appear with every copy, from lcp/LICENSE-UNICODE. */
const notice = () => linesOf(readFileSync(LICENSE, "utf8"));

/** The table descriptions both files share, one line per entry. */
const DESCRIPTIONS = (none) => [
  "Each table is a sorted list of range starts and the value of each range, found by binary search:",
  `- MAPPING: the IDNA Mapping Table. A number d: the code point c maps to c + d, and d is 0 for a valid or`,
  `  deviation code point, which nontransitional processing keeps. A string: the code point maps to it ("" for`,
  `  an ignored one). ${none}: the code point is disallowed.`,
  "- BIDI: Bidi_Class, one letter for each class RFC 5893 section 2 names (L, R, A for AL, N for AN, E for",
  "  EN, S for ES, C for CS, T for ET, O for ON, B for BN, M for NSM) and X for any other.",
  "- JOINING: Joining_Type L, D, R or T, and U for any other.",
  "- MARK_STARTS: runs that alternate, starting with U+0000: a code point in an odd-numbered run has",
  "  General_Category Mark (Mn, Mc or Me).",
  "  BIDI, JOINING and MARK_STARTS hold each valid or deviation code point's value. Any other code point takes",
  "  the value of the code point before it, since a label that holds it is refused before they are read.",
  "- CCC: Canonical_Combining_Class.",
  "- DECOMPOSITIONS: each canonical decomposition mapping, one level (Hangul syllables are algorithmic).",
  "- COMPOSITION_EXCLUSIONS: the code points with Full_Composition_Exclusion.",
];

/** The lines naming each source file and its SHA-256. */
const sourceLines = (list) => list.flatMap(({ url, sha256 }) => [`- ${url}`, `  SHA-256 ${sha256}`]);

function typescript(t, list) {
  const comment = (lines) => lines.map((l) => (l === "" ? "//" : `// ${l}`)).join("\n");
  const head = [
    `Unicode ${UNICODE_VERSION} data for the URL Standard's host parser in url-host.ts. Written by`,
    "scripts/idna/idna-data.mjs from:",
    "",
    ...sourceLines(list),
    "",
    "Run the generator rather than editing this file.",
    "",
    ...DESCRIPTIONS("null"),
    "",
    "The tables are derived from the Unicode data files above, which are distributed under this license:",
    "",
    ...notice(),
  ];
  const array = (name, type, cells) => `export const ${name}: ${type} = [\n${packed(cells, "  ")}\n];\n`;
  const string = (name, letters) => `export const ${name} =\n${chunks(letters).map((c) => `  "${c}"`).join(" +\n")};\n`;
  return [
    `${comment(head)}\n`,
    `export const UNICODE_VERSION = "${UNICODE_VERSION}";\n`,
    array("MAPPING_STARTS", "readonly number[]", t.mapping[0].map(hex)),
    array(
      "MAPPING",
      "readonly (number | string | null)[]",
      t.mapping[1].map((v) => (typeof v === "string" ? tsString(v) : `${v}`)),
    ),
    array("BIDI_STARTS", "readonly number[]", t.bidi[0].map(hex)),
    string("BIDI", t.bidi[1].join("")),
    array("JOINING_STARTS", "readonly number[]", t.joining[0].map(hex)),
    string("JOINING", t.joining[1].join("")),
    array("MARK_STARTS", "readonly number[]", t.markStarts.map(hex)),
    array("CCC_STARTS", "readonly number[]", t.ccc[0].map(hex)),
    array("CCC", "readonly number[]", t.ccc[1].map(String)),
    array(
      "DECOMPOSITIONS",
      "readonly (readonly [number, string])[]",
      t.decompositions.map(([cp, d]) => `[${hex(cp)}, ${tsString(d)}]`),
    ),
    array("COMPOSITION_EXCLUSIONS", "readonly number[]", t.excluded.map(hex)),
  ].join("\n");
}

function python(t, list) {
  const head = [
    ...notice().map((l) => (l === "" ? "#" : `# ${l}`)),
    "",
    `"""Unicode ${UNICODE_VERSION} data for the URL host rule in _url.py. Written by scripts/idna/idna-data.mjs from:`,
    "",
    ...sourceLines(list),
    "",
    "Run the generator rather than editing this file.",
    "",
    ...DESCRIPTIONS("None"),
  ];
  const tuple = (name, annotation, cells) => `${name}: ${annotation} = (\n${packed(cells, "    ")}\n)\n`;
  const string = (name, letters) => `${name} = (\n${chunks(letters).map((c) => `    "${c}"`).join("\n")}\n)\n`;
  const map = (v) => (typeof v === "string" ? pyString(v) : v === null ? "None" : String(v));
  const decompositions = t.decompositions.map(([cp, d]) => `${hex(cp)}: ${pyString(d)}`);
  return (
    `${head.join("\n")}"""\n\n` +
    `UNICODE_VERSION = "${UNICODE_VERSION}"\n\n` +
    tuple("MAPPING_STARTS", "tuple[int, ...]", t.mapping[0].map(hex)) +
    tuple("MAPPING", "tuple[int | str | None, ...]", t.mapping[1].map(map)) +
    tuple("BIDI_STARTS", "tuple[int, ...]", t.bidi[0].map(hex)) +
    string("BIDI", t.bidi[1].join("")) +
    tuple("JOINING_STARTS", "tuple[int, ...]", t.joining[0].map(hex)) +
    string("JOINING", t.joining[1].join("")) +
    tuple("MARK_STARTS", "tuple[int, ...]", t.markStarts.map(hex)) +
    tuple("CCC_STARTS", "tuple[int, ...]", t.ccc[0].map(hex)) +
    tuple("CCC", "tuple[int, ...]", t.ccc[1].map(String)) +
    `DECOMPOSITIONS: dict[int, str] = {\n${packed(decompositions, "    ")}\n}\n` +
    `COMPOSITION_EXCLUSIONS: frozenset[int] = frozenset(\n    (\n${packed(t.excluded.map(hex), "        ")}\n    )\n)\n`
  );
}

const check = process.argv.includes("--check");
if (process.argv.length > 2 + Number(check)) {
  console.error("usage: node scripts/idna/idna-data.mjs [--check]");
  process.exit(2);
}
const list = sources();
const text = {};
for (const { name, url, sha256 } of list) {
  text[name] = new TextDecoder("utf-8", { fatal: true }).decode(await fetchPinned(url, sha256));
}
const t = tables(text);
const written = { ts: typescript(t, list), py: python(t, list) };
let differ = 0;
for (const [kind, url] of Object.entries(OUTPUTS)) {
  const path = fileURLToPath(url);
  if (!check) {
    writeFileSync(path, written[kind]);
    console.log(`wrote ${path}`);
    continue;
  }
  let held;
  try {
    held = readFileSync(path, "utf8");
  } catch {
    held = undefined;
  }
  if (held === written[kind]) console.log(`${path} equals what the generator writes from the ${list.length} sources`);
  else {
    const state = held === undefined ? "is missing" : "differs from what the generator writes";
    console.log(`${path} ${state}: run node scripts/idna/idna-data.mjs`);
    differ++;
  }
}
if (differ > 0) process.exit(1);
