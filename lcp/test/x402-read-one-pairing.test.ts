// Which x402 pairings' `read` offers an option, against the root `pairingOf`, which names the first x402 pairing in
// BINDINGS whose `read` offers it on a document holding that option alone (and, for an `exact` option on a Lightning
// network, the Lightning pairing the invoice names). The options: every object with a string `scheme` and `network` in
// each x402 vector file and in buyer.json, every option filter row (option-filter-rows.ts), and each lnbtc vector file's
// fixed option without its `extra.invoice`, on both lnbtc networks: the offer the seller sends before its node writes the
// invoice. A pairing's own `read` answers whether an option is that pairing's wherever no other pairing's `read` offers
// it. Two cases differ, and the test states them: both ERC-7710 levels offer an `erc7710` option, which they share (the
// root pairingOf names `x402/exact/eip155/erc7710`; `pairingOfPayment` names the level from the payment), and no `read`
// offers the lnbtc offer without an invoice, which pairingOf names `x402/exact/lnbtc` and whose H that pairing's
// `advertiseBeforeCarrier` places. Each presented payment in those vector files is bound only by pairings whose `read`
// offers its `accepted`: an opening by `bound`, and a channel's within payment by `channel.boundWithin`.
import { describe, expect, it } from "vitest";
import { isRefusal, pairingOf } from "../src/index.js";
import type { PaymentRequired } from "../src/x402.js";
import { H, LINK } from "./option-filter-rows.js";
import { BEFORE_INVOICE as beforeInvoice, OPTIONS, PAYMENTS, X402, offeredBy } from "./x402-presentations.js";

const ERC7710 = "x402/exact/eip155/erc7710";
const ERC7710_SALT = "x402/exact/eip155/erc7710-salt";
const LNBTC = "x402/exact/lnbtc";

const answers = OPTIONS.map(([where, option]) => ({ where, option, by: offeredBy(option), named: pairingOf(option) }));
const isBeforeInvoice = (where: string) => beforeInvoice.some(([w]) => w === where);

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
    for (const a of answers.filter((x) => !isBeforeInvoice(x.where))) {
      expect([a.where, a.by.includes(id)]).toEqual([a.where, a.named === names]);
    }
  });

  it("the lnbtc offer without an invoice: no read offers it, pairingOf names x402/exact/lnbtc, whose advertiseBeforeCarrier places H", () => {
    const lnbtc = X402.find((b) => b.id === LNBTC)!;
    for (const a of answers.filter((x) => isBeforeInvoice(x.where))) {
      expect([a.where, a.by, a.named]).toEqual([a.where, [], LNBTC]);
      const doc = { x402Version: 2, resource: { url: "https://api.seller.example/v1/quote" }, accepts: [a.option] } as PaymentRequired;
      expect([a.where, isRefusal(lnbtc.advertiseBeforeCarrier!(doc, H, LINK, a.option))]).toEqual([a.where, false]);
    }
    expect(answers.filter((x) => isBeforeInvoice(x.where)).length).toBe(beforeInvoice.length);
  });

  it("each presented payment is bound only by pairings whose read offers its accepted", async () => {
    for (const [where, p] of PAYMENTS) {
      const offering = offeredBy(p.accepted);
      const bound: string[] = [];
      for (const b of X402) {
        const within = b.channel !== undefined && b.channel.kind(p) === "within";
        if (!isRefusal(await (within ? b.channel!.boundWithin(p) : b.bound(p)))) bound.push(b.id);
      }
      expect([where, bound.length]).not.toEqual([where, 0]);
      expect([where, bound.filter((id) => !offering.includes(id))]).toEqual([where, []]);
    }
  });
});
