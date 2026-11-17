// Which x402 pairings' `read` offers an option, against the root `pairingOf`, which names the first x402 pairing in
// BINDINGS whose `read` offers it on a document holding that option alone. The options: every object with a string
// `scheme` and `network` in each x402 vector file and in buyer.json, and every option filter row
// (option-filter-rows.ts). A pairing's own `read` answers whether an option is that pairing's wherever no other
// pairing's `read` offers it. One case differs, and the test states it: both ERC-7710 levels offer an `erc7710` option,
// which they share (the root pairingOf names `x402/exact/eip155/erc7710`; `pairingOfPayment` names the level from the
// payment). Each presented payment in those vector files is bound only by pairings whose `read`
// offers its `accepted`: an opening by `bound`, and a channel's within payment by `channel.boundWithin`; a payment of a
// pairing whose profile states that nothing the payer signs carries H (NO_SIGNED_PLACE in x402-presentations.ts) is
// taken by its `bound` refusing it `x402/no-signed-place`.
import { describe, expect, it } from "vitest";
import { pairingOf } from "../src/index.js";
import { OPTIONS, PAYMENTS, X402, offeredBy, takes } from "./x402-presentations.js";

const ERC7710 = "x402/exact/eip155/erc7710";
const ERC7710_SALT = "x402/exact/eip155/erc7710-salt";

const answers = OPTIONS.map(([where, option]) => ({ where, option, by: offeredBy(option), named: pairingOf(option) }));

describe("each x402 option is offered by one pairing's read, the one the root pairingOf names", () => {
  it("every x402 pairing's read offers at least one option", () => {
    const offered = new Set(answers.flatMap((a) => a.by));
    expect(X402.map((b) => b.id).filter((id) => !offered.has(id))).toEqual([]);
  });

  it("no option is offered by two pairings' reads, except an erc7710 option, which both ERC-7710 levels offer", () => {
    const shared = answers.filter((a) => a.by.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const a of shared) {
      expect([a.where, a.by]).toEqual([a.where, [ERC7710, ERC7710_SALT]]);
      expect([a.where, (a.option.extra as Record<string, unknown>)["assetTransferMethod"], a.named]).toEqual([a.where, "erc7710", ERC7710]);
    }
  });

  it.each(X402.map((b) => b.id))("%s: its read offers an option exactly when the root pairingOf names it", (id) => {
    // The salt level offers the option it shares with the unsigned level, which pairingOf names.
    const names = id === ERC7710_SALT ? ERC7710 : id;
    for (const a of answers) {
      expect([a.where, a.by.includes(id)]).toEqual([a.where, a.named === names]);
    }
  });

  it("each presented payment is bound only by pairings whose read offers its accepted", async () => {
    for (const [where, p] of PAYMENTS) {
      const offering = offeredBy(p.accepted);
      const bound: string[] = [];
      for (const b of X402) {
        const within = b.channel !== undefined && b.channel.kind(p) === "within";
        const answer = await (within ? b.channel!.boundWithin(p) : b.bound(p));
        if (takes(b.id, answer)) bound.push(b.id);
      }
      expect([where, bound.length]).not.toEqual([where, 0]);
      expect([where, bound.filter((id) => !offering.includes(id))]).toEqual([where, []]);
    }
  });
});
