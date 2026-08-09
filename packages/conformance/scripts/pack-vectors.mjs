/**
 * Copy the repo-root corpus into the package so it ships inside the tarball.
 *
 * There used to be a `REVISION` file here, stamped from `git rev-parse HEAD`. It is gone, and its removal
 * fixed two things rather than costing one. It was stamped with no clean-tree check, so it named a commit
 * the packed bytes might not correspond to — a provenance claim that was routinely false and, per the
 * repo's own instructions, routinely stale. And it made this script `throw` outside a git checkout, so a
 * consumer who extracted the tarball could not rebuild the package they had just installed.
 *
 * `vectors/conformance/corpus-seal.json` replaces it with a better answer to the same question. A commit id
 * says which tree was INTENDED; the seal's root digest says which bytes are actually here, and the runner
 * checks it against a constant compiled into this package. That identity is derived from the corpus rather
 * than asserted alongside it, so it cannot go stale.
 */
import { cpSync, rmSync } from "node:fs";

rmSync("vectors", { recursive: true, force: true });
cpSync("../../vectors", "vectors", { recursive: true });
