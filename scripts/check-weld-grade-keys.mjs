/**
 * A RAIL'S weldGrades KEYS ARE CONSTANTS IT EXPORTS, NEVER STRING LITERALS.
 *
 * binding-evm-x402 published 0.15.1 with weldGrades keyed ERC3009. That is the binding-evm-escrow
 * sibling's COLLECTOR name, where it is correct and where it came from. On the x402 rail the value a
 * consumer computes is the offer's assetTransferMethod, which x402 spells eip3009 and which that very
 * package exports as EIP3009_TRANSFER_METHOD. So weldGrades[assetTransferMethod] answered undefined --
 * the grade ABSENT rather than wrong, which a caller reads as a rail that declares no weld grade at all.
 *
 * NOTHING COULD HAVE CAUGHT IT. vectors/binding/profile.schema.json constrains weldGrades VALUES, with
 * additionalProperties enum [signature, tx], and places no constraint whatever on the keys. A key naming
 * nothing is as valid to that schema as the right one. It was found by a person reading, which is not a
 * control.
 *
 * THE RULE. Every key in a binding manifest's weldGrades is either a computed reference to a constant,
 * written [SOME_CONSTANT]:, or the whole map is derived from a declaration that already carries the
 * grades -- binding-evm-escrow builds it from COLLECTORS, whose entries hold both the name and the grade.
 * A literal is refused. The point is not tidiness: a constant is the thing a CONSUMER imports to do the
 * lookup, so keying the map with it makes the map and the lookup incapable of disagreeing.
 *
 * It does NOT check that the token is the RIGHT one -- nothing mechanical can know what x402 spells its
 * method. What it guarantees is that the key and the exported token are one value, so a rail that gets
 * the token wrong gets it wrong in one place instead of two, and fixing it fixes both.
 *
 * ⛔⛔ AND THE CONSTANT MUST REACH THE BARREL, which is the half this check was missing. "A constant is
 * the thing a CONSUMER imports to do the lookup" is the whole argument for keying the map with it -- and
 * on eleven of the twelve rails that constant was declared, docblocked "exported so a consumer looks the
 * grade up with the SAME token this manifest declares it under", and then left out of src/index.ts. A
 * consumer cannot import what the barrel does not carry, so every one of them had to spell the collection
 * path as a literal at the lookup site: exactly the two-copies-that-drift condition the computed key was
 * introduced to make impossible, reintroduced one module out. The rule held the map and broke the lookup.
 *
 * Naming did not save it either. A grep for *_COLLECTION_PATH finds eight of the eleven; binding-xrpl
 * spells its two XRPL_INVOICE_ID_PATH / XRPL_TX_MEMO_PATH and binding-tempo-mpp spells its two
 * TEMPO_TRANSFER_WITH_MEMO_PATH / TEMPO_TRANSFER_FROM_WITH_MEMO_PATH, because those rails declare a grade
 * per call path rather than one per rail. So the subject set is derived from the manifest's own keys, not
 * from a name shape -- a rail that invents a twelfth spelling is still caught.
 *
 * A map DERIVED from a grade-carrying declaration (Object.fromEntries over binding-evm-escrow's
 * COLLECTORS) is exempt from the reachability half as well as the literal half: its keys are not tokens
 * this file can name, and the declaration they come from is the thing a consumer imports instead.
 *
 * THE SUBJECT SET IS DERIVED AND REFUSES TO BE EMPTY: every binding package manifest under packages.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = "packages";
const problems = [];
let manifests = 0;
let keys = 0;
let derived = 0;
let reachable = 0;

/**
 * Is `name` re-exported from this package's barrel? Reads the NAMES the barrel lists, never the module
 * that declares them: the question is what a consumer can import from the package root, and a symbol
 * exported from src/constants.ts but absent from src/index.ts is not that. Comments are stripped first so
 * a token named only in prose cannot answer for a token that is actually exported -- the collection-path
 * docblocks name their own constants, and matching one of those would make this check pass on the exact
 * condition it exists to catch.
 */
function barrelExports(dir) {
  const barrel = join(PACKAGES, dir, "src", "index.ts");
  const text = readFileSync(barrel, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const names = new Set();
  for (const block of text.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of (block[1] ?? "").split(","))
      names.add(
        part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop(),
      );
  return names;
}

for (const dir of readdirSync(PACKAGES)) {
  if (!dir.startsWith("binding-")) continue;
  const path = join(PACKAGES, dir, "src", "manifest.ts");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  const block = /weldGrades:\s*(\{[\s\S]*?\}|Object\.fromEntries\()/.exec(text);
  if (block === null) continue;
  manifests += 1;

  // A map built from a declaration that carries the grades cannot drift from it by construction.
  if ((block[1] ?? "").startsWith("Object.fromEntries")) {
    derived += 1;
    continue;
  }

  const exported = barrelExports(dir);
  const KEY =
    /(\[[A-Za-z_][A-Za-z0-9_]*\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  for (const key of (block[1] ?? "").matchAll(KEY)) {
    const raw = key[1] ?? "";
    keys += 1;
    if (!raw.startsWith("[")) {
      problems.push(
        dir +
          ": weldGrades key " +
          raw +
          " is a string literal. Export the collection-path token as a constant and key the map with it, so a consumer's lookup and this map are the same value.",
      );
      continue;
    }
    // The constant exists and keys the map. The remaining question is whether a consumer can reach it.
    const token = raw.slice(1, -1);
    if (exported.has(token)) reachable += 1;
    else
      problems.push(
        dir +
          ": weldGrades is keyed by " +
          token +
          ", which src/index.ts does not export. A consumer cannot import it, so the lookup has to spell the collection path as a literal -- the two copies the computed key exists to prevent, one module out. Add it to the barrel.",
      );
  }
}

if (manifests === 0) {
  console.error(
    "\nRefusing to verify: check:weld-grade-keys measured NO binding manifests. The subject set is\na manifest in every binding package; an empty one means the derivation broke, not a clean tree.\n",
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error(
    "\nRefusing to verify: check:weld-grade-keys -- " +
      String(problems.length) +
      " weldGrades key(s) a consumer cannot do the lookup with.\n",
  );
  for (const problem of problems) console.error("  " + problem);
  console.error("");
  process.exit(1);
}

console.log(
  "check:weld-grade-keys -- " +
    String(manifests) +
    " binding manifest(s): " +
    String(keys) +
    " key(s) keyed off a constant, " +
    String(reachable) +
    " of them reachable from the package barrel, " +
    String(derived) +
    " map(s) derived from a declaration that carries the grades.",
);
