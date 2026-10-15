// Each x402 pairing with an optional peer, with that peer installed: `build` answers build-choices.ts's choices from the
// choice's document and the option's place in it. Each pairing's peer-missing test gives the same choices the same
// codes without the peer.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/index.js";
import { exactAvm } from "../src/avm.js";
import { exactNear } from "../src/near.js";
import { exactSui } from "../src/sui.js";
import { exactTvm } from "../src/tvm.js";
import { exactStellar } from "../src/x402-exact-stellar.js";
import { buildChoices } from "./build-choices.js";
import { rowsOf } from "./rows.js";

const vector = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const STELLAR = vector("x402-exact-stellar.json");
const SUI = vector("x402-exact-sui.json");
const TVM = vector("x402-exact-tvm.json");
const NEAR = vector("x402-exact-near.json");
const AVM = vector("x402-exact-algorand.json");

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
