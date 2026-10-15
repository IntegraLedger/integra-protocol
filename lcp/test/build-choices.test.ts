// Each x402 pairing with an optional peer, with that peer installed: `build` answers build-choices.ts's choices from the
// choice's document and the option's place in it. Every x402 pairing's `build` checks H first: with a malformed H, a
// choice with another fault gets H's code (peer-free-inputs.ts). Each pairing's peer-missing test gives the same
// choices the same codes without the peer.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, type AtrHash } from "../src/index.js";
import { exactAvm } from "../src/avm.js";
import { exactLnbtc } from "../src/lightning.js";
import { exactNear } from "../src/near.js";
import { exactSui } from "../src/sui.js";
import { exactTvm } from "../src/tvm.js";
import { exactStellar } from "../src/x402-exact-stellar.js";
import { buildChoices } from "./build-choices.js";
import { BAD_H, hCodeOf, hFirstChoices } from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const vector = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const STELLAR = vector("x402-exact-stellar.json");
const SUI = vector("x402-exact-sui.json");
const TVM = vector("x402-exact-tvm.json");
const NEAR = vector("x402-exact-near.json");
const AVM = vector("x402-exact-algorand.json");
const LNBTC = vector("x402-exact-lnbtc.json");

/** Each pairing's `build`, its own option and the vector file it comes from. */
const PAIRINGS: { id: string; build: (c: never, h: AtrHash) => Promise<unknown>; own: unknown; V: { fixed: { H: AtrHash; resource: unknown } } }[] = [
  { id: exactStellar.id, build: exactStellar.build, own: STELLAR.fixed.option, V: STELLAR },
  { id: exactSui.id, build: exactSui.build, own: SUI.fixed.O, V: SUI },
  { id: exactTvm.id, build: exactTvm.build, own: TVM.fixed.O, V: TVM },
  { id: exactNear.id, build: exactNear.build, own: NEAR.fixed.O, V: NEAR },
  { id: exactAvm.id, build: exactAvm.build, own: AVM.fixed.O, V: AVM },
];

describe("build with each pairing's optional peer", () => {
  for (const p of rowsOf(PAIRINGS, "the x402 pairings with an optional peer", { exact: 5 })) {
    it(`${p.id}: a choice of another pairing's option, and one whose document is not v2`, async () => {
      for (const row of rowsOf(buildChoices(p.own as never, p.V.fixed.resource), "build-choices.ts", { exact: 2 })) {
        expect(await p.build(row.choice as never, p.V.fixed.H)).toEqual({ refused: true, code: row.expect });
      }
    });
  }
});

describe("every x402 pairing's build checks H first", () => {
  const X402 = rowsOf(
    BINDINGS.filter((b) => b.id.startsWith("x402/")) as unknown as { id: string; build: (c: unknown, h: unknown) => Promise<unknown> }[],
    "BINDINGS, the x402 pairings",
    {
      exact: 28,
      keep: ["each pairing whose build reads H", (b) => b.id !== "x402/exact/lnbtc/invoice-named"],
      leave: ["x402/exact/lnbtc/invoice-named, whose build does not read H", (b) => b.id === "x402/exact/lnbtc/invoice-named"],
    },
  );
  for (const p of X402) {
    it(`${p.id}: a malformed H with no choice, another pairing's option or a document that is not v2 is ${hCodeOf(p.id)}`, async () => {
      for (const row of rowsOf(hFirstChoices(p.id), "peer-free-inputs.ts", { exact: 3 })) {
        expect([row.case, await p.build(row.choice, BAD_H)]).toEqual([row.case, { refused: true, code: hCodeOf(p.id) }]);
      }
    });
  }

  for (const p of rowsOf(PAIRINGS, "the x402 pairings with an optional peer", { exact: 5 })) {
    it(`${p.id}: a malformed H with a choice of its own option`, async () => {
      for (const row of rowsOf(hFirstChoices(p.id, p.own), "peer-free-inputs.ts", { exact: 4 })) {
        expect([row.case, await p.build(row.choice as never, BAD_H as AtrHash)]).toEqual([row.case, { refused: true, code: "x402/payload-malformed" }]);
      }
    });
  }

  // optionChecks compares the invoice's m field with H unless H is "any", and reads a null H as the invoice-named
  // pairing's (no m field): neither is a valid ATR hash, so build refuses each before it reads the option.
  it("x402/exact/lnbtc: an H of \"any\" or null with its own option, which it builds for the file's H, is ln/no-metadata", async () => {
    const O = LNBTC.fixed.O;
    const choice = { required: { x402Version: 2 as const, resource: LNBTC.fixed.resource, accepts: [O] }, accepted: O };
    expect("refused" in (await exactLnbtc.build(choice, LNBTC.fixed.H))).toBe(false);
    for (const h of ["any", null]) {
      expect([h, await exactLnbtc.build(choice, h as never)]).toEqual([h, { refused: true, code: "ln/no-metadata" }]);
    }
  });
});
