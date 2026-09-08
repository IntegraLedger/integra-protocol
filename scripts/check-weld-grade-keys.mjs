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
 * THE SUBJECT SET IS DERIVED AND REFUSES TO BE EMPTY: every binding package manifest under packages.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = "packages";
const problems = [];
let manifests = 0;
let keys = 0;
let derived = 0;

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

  const KEY =
    /(\[[A-Za-z_][A-Za-z0-9_]*\]|"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  for (const key of (block[1] ?? "").matchAll(KEY)) {
    const raw = key[1] ?? "";
    keys += 1;
    if (!raw.startsWith("["))
      problems.push(
        dir +
          ": weldGrades key " +
          raw +
          " is a string literal. Export the collection-path token as a constant and key the map with it, so a consumer's lookup and this map are the same value.",
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
      " literal weldGrades key(s).\n",
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
    " key(s) keyed off an exported constant, " +
    String(derived) +
    " map(s) derived from a declaration that carries the grades.",
);
