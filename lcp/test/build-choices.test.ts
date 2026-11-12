// Each x402 pairing with an optional peer, with that peer installed: `build` answers build-choices.ts's choices from the
// choice's document and the option's place in it. Every x402 pairing's `build` checks H first: with a malformed H, a
// choice with another fault gets H's code (peer-free-inputs.ts). Then it checks the form of each choice member the
// caller passes, before the document and the option: a malformed member under another pairing's option, or under a
// document that is not v2, gets the member's code. Each pairing's peer-missing test gives the same choices the same
// codes without the peer.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, type AtrHash } from "../src/index.js";
import { exactAvm } from "../src/avm.js";
import { exactNear } from "../src/near.js";
import { exactSui } from "../src/sui.js";
import { exactTvm } from "../src/tvm.js";
import { buildChoices } from "./build-choices.js";
import { BAD_H, choiceMembers, hCodeOf, hFirstChoices, memberFirstChoices, membersOf } from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const vector = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const SUI = vector("x402-exact-sui.json");
const TVM = vector("x402-exact-tvm.json");
const NEAR = vector("x402-exact-near.json");
const AVM = vector("x402-exact-algorand.json");

/** Each pairing's `build`, its own option and the vector file it comes from. */
const PAIRINGS: { id: string; build: (c: never, h: AtrHash) => Promise<unknown>; own: unknown; V: { fixed: { H: AtrHash; resource: unknown } } }[] = [
  { id: exactSui.id, build: exactSui.build, own: SUI.fixed.O, V: SUI },
  { id: exactTvm.id, build: exactTvm.build, own: TVM.fixed.O, V: TVM },
  { id: exactNear.id, build: exactNear.build, own: NEAR.fixed.O, V: NEAR },
  { id: exactAvm.id, build: exactAvm.build, own: AVM.fixed.O, V: AVM },
];

describe("build with each pairing's optional peer", () => {
  for (const p of rowsOf(PAIRINGS, "the x402 pairings with an optional peer", { exact: 4 })) {
    it(`${p.id}: a choice of another pairing's option, and one whose document is not v2`, async () => {
      for (const row of rowsOf(buildChoices(p.own as never, p.V.fixed.resource, membersOf(p.id)), "build-choices.ts", { exact: 2 })) {
        expect(await p.build(row.choice as never, p.V.fixed.H)).toEqual({ refused: true, code: row.expect });
      }
    });
  }
});

describe("every x402 pairing's build checks H first", () => {
  const X402 = rowsOf(
    BINDINGS.filter((b) => b.id.startsWith("x402/")) as unknown as { id: string; build: (c: unknown, h: unknown) => Promise<unknown> }[],
    "BINDINGS, the x402 pairings",
    { exact: 26 },
  );
  for (const p of X402) {
    it(`${p.id}: a malformed H with no choice, another pairing's option or a document that is not v2 is ${hCodeOf(p.id)}`, async () => {
      for (const row of rowsOf(hFirstChoices(p.id), "peer-free-inputs.ts", { exact: 3 })) {
        expect([row.case, await p.build(row.choice, BAD_H)]).toEqual([row.case, { refused: true, code: hCodeOf(p.id) }]);
      }
    });
  }

  for (const p of rowsOf(PAIRINGS, "the x402 pairings with an optional peer", { exact: 4 })) {
    it(`${p.id}: a malformed H with a choice of its own option`, async () => {
      for (const row of rowsOf(hFirstChoices(p.id, p.own), "peer-free-inputs.ts", { exact: 4 })) {
        expect([row.case, await p.build(row.choice as never, BAD_H as AtrHash)]).toEqual([row.case, { refused: true, code: "x402/payload-malformed" }]);
      }
    });
  }
});

describe("every x402 pairing's build checks its choice's members after H and before the document", () => {
  const MEMBERS = rowsOf(choiceMembers(), "peer-free-inputs.ts choiceMembers", { exact: 21 });
  const NONE = [
    "x402/exact/sui",
    "x402/exact/cardano",
    "x402/exact/aptos",
    "x402/exact/polkadot/lcp-assets-remark",
    "x402/batch-settlement/cloudflare",
  ];
  const X402 = rowsOf(
    BINDINGS.filter((b) => b.id.startsWith("x402/")) as unknown as { id: string; build: (c: unknown, h: unknown) => Promise<unknown> }[],
    "BINDINGS, the x402 pairings",
    {
      exact: 21,
      keep: ["each pairing whose build reads choice members beyond the document and the option", (b) => MEMBERS.some((m) => m.id === b.id)],
      leave: [
        "the pairings whose build reads only the document and the option",
        (b) => NONE.includes(b.id),
      ],
    },
  );
  const H = `0x${"ab".repeat(32)}`;
  for (const p of X402) {
    const bad = MEMBERS.find((m) => m.id === p.id)!.bad.length;
    it(`${p.id}: a malformed member with another pairing's option or a document that is not v2 is the member's code`, async () => {
      for (const row of rowsOf(memberFirstChoices(p.id), "peer-free-inputs.ts memberFirstChoices", { exact: 2 * bad })) {
        expect([row.case, await p.build(row.choice, H)]).toEqual([row.case, { refused: true, code: row.expect }]);
      }
    });
  }

  for (const p of rowsOf(PAIRINGS, "the x402 pairings with an optional peer", {
    exact: 3,
    keep: ["each whose build reads choice members", (q) => q.id !== exactSui.id],
    leave: ["x402/exact/sui, whose build reads none", (q) => q.id === exactSui.id],
  })) {
    it(`${p.id}: a malformed member with a choice of its own option is the member's code`, async () => {
      const bad = MEMBERS.find((m) => m.id === p.id)!.bad.length;
      for (const row of rowsOf(memberFirstChoices(p.id, p.own), "peer-free-inputs.ts memberFirstChoices", { exact: 3 * bad })) {
        expect([row.case, await p.build(row.choice as never, p.V.fixed.H)]).toEqual([row.case, { refused: true, code: row.expect }]);
      }
    });
  }
});
