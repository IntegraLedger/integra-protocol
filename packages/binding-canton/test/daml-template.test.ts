/**
 * THE DAR/CODEC DRIFT GATE.
 *
 * `daml/Main.daml` and `src/anchor.ts` are two copies of one fact: the shape of the `LcpAnchor` contract.
 * The Daml template declares the fields the participant will accept; `LcpAnchorPayload` declares the
 * fields this library sends. If they disagree, every create fails at the participant with a Daml type
 * error, at deployment time, on somebody else's ledger — and nothing in this repository would have said so
 * first.
 *
 * ★ WHY IT PARSES TEXT RATHER THAN BUILDING. Compiling needs the Daml SDK — a JVM toolchain `pnpm verify`
 * has no business requiring, and which CI does not install. Parsing the source is strictly weaker than
 * compiling and is honest about which half it checks: the NAMES, which is where drift actually happens. A
 * type change Daml would reject (`Text` to `Int`) passes here. A rename, an added required field, or a
 * moved module does not.
 *
 * The template IS compiled, just not by this suite. Built 2026-08-08 with SDK 2.10.4:
 *
 *     record @serializable LcpAnchor =
 *       {buyer : Party; seller : Party; atrHash : Text; paymentRef : Text; createdAt : Text}
 *
 * — which is exactly what the field assertion below derives from `buildAnchorPayload`. The resulting
 * package id is `4411f3ac…` (README carries it in full); it is the hash of the compiled package, so it is
 * deterministic for a given source and SDK and a deployment can check its own build against it.
 *
 * ★ WHY THE TEMPLATE SHIPS AS SOURCE. The package id is the hash of the compiled DAR, so it is
 * deployment-specific and is supplied per call (`lcpAnchorTemplateId(packageId)`). A prebuilt `.dar` in
 * the tarball would pin one SDK version and still yield a package id the deployment has to read off its
 * own upload, so it would add a build dependency without removing a step.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAnchorPayload } from "../src/anchor.js";
import { LCP_ANCHOR_ENTITY, LCP_ANCHOR_MODULE } from "../src/constants.js";

const daml = readFileSync(
  new URL("../daml/Main.daml", import.meta.url),
  "utf8",
);
const damlYaml = readFileSync(
  new URL("../daml/daml.yaml", import.meta.url),
  "utf8",
);

/** The field names in the template's `with` block, in declaration order. */
function templateFields(): string[] {
  const withBlock = daml.slice(daml.indexOf("  with"), daml.indexOf("  where"));
  return [...withBlock.matchAll(/^\s{4}(\w+)\s*:/gm)].map((m) => m[1] ?? "");
}

describe("the shipped Daml template matches the codec that talks to it", () => {
  it("ships at the module and entity name the template id is built from", () => {
    // `lcpAnchorTemplateId` composes `<packageId>:Main:LcpAnchor`. A module rename in the .daml file
    // would leave that string pointing at a template the participant does not have.
    expect(daml).toContain(`module ${LCP_ANCHOR_MODULE} where`);
    expect(daml).toContain(`template ${LCP_ANCHOR_ENTITY}`);
  });

  it("declares exactly the fields the codec sends, plus the client-stamped createdAt", () => {
    // `buildAnchorPayload` is the only thing that constructs a create payload, so its output IS the
    // library's side of the contract. `createdAt` is stamped by the caller at create time rather than by
    // the codec, which is why it is named here instead of being derived.
    const sent = Object.keys(
      buildAnchorPayload({
        buyer: "buyer::1220",
        seller: "seller::1220",
        atrHash: `0x${"ab".repeat(32)}`,
      }),
    );
    expect(templateFields().sort()).toEqual([...sent, "createdAt"].sort());
  });

  it("keeps the buyer signatory and the seller an observer", () => {
    // The manifest's `zeroPartyRecoverable: false` is justified BY this stakeholder set: visibility is
    // limited to the two transacting parties, so a neutral verifier sees nothing. Adding an observer
    // would widen recovery and make that declaration wrong.
    expect(daml).toMatch(/^\s*signatory buyer$/m);
    expect(daml).toMatch(/^\s*observer seller$/m);
    expect(daml).not.toMatch(/^\s*observer .*,/m);
  });

  it("refuses an empty atrHash on the ledger, not only in the codec", () => {
    // `atrHashToLedgerText` already rejects one, but the template is what a THIRD party's client talks
    // to. Without the `ensure`, an empty anchor would match every `/v1/query` filtered on "".
    expect(daml).toMatch(/ensure atrHash \/= ""/);
  });

  it("builds as the lcp-anchor package at this package's own version", () => {
    // A DAR whose name or version drifts from the npm package makes "which template does this library
    // talk to" unanswerable from either side.
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string; files: string[] };
    expect(damlYaml).toMatch(/^name: lcp-anchor$/m);
    expect(damlYaml).toMatch(new RegExp(`^version: ${pkg.version}$`, "m"));
    // …and it actually ships. A template nobody receives is the gap this whole package had until now.
    expect(pkg.files).toContain("daml");
  });
});
