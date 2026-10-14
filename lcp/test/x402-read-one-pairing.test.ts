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
// offers its `accepted`.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BINDINGS, isRefusal, pairingOf, toLegalContext } from "../src/index.js";
import { LEGAL_CONTEXT, LEGAL_CONTEXT_SCHEMA, type PaymentPayload, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import { H, LINK, railOptions } from "./option-filter-rows.js";
import { rowsOf } from "./rows.js";

const ERC7710 = "x402/exact/eip155/erc7710";
const ERC7710_SALT = "x402/exact/eip155/erc7710-salt";
const LNBTC = "x402/exact/lnbtc";
/** The lnbtc networks, Bitcoin mainnet's and testnet3's, each named by the first 16 bytes of its genesis block hash. */
const LN_NETWORKS = ["lnbtc:000000000019d6689c085ae165831e93", "lnbtc:000000000933ea01ad0ee984209779ba"];

const dir = new URL("../vectors/", import.meta.url);
const files = rowsOf(
  readdirSync(dir).filter((n) => n.startsWith("x402-") || n === "buyer.json"),
  "vectors/, the x402 vector files and buyer.json",
  { min: 20 },
);
const vector = (name: string): unknown => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

/** Every object under `v` that `pick` keeps, each with the path to it. */
function collect<T>(v: unknown, path: string, pick: (o: Record<string, unknown>) => boolean, out: [string, T][] = []): [string, T][] {
  if (typeof v !== "object" || v === null) return out;
  if (!Array.isArray(v) && pick(v as Record<string, unknown>)) out.push([path, v as T]);
  for (const [k, x] of Object.entries(v)) collect(x, `${path}.${k}`, pick, out);
  return out;
}
const isOption = (o: Record<string, unknown>) => typeof o["scheme"] === "string" && typeof o["network"] === "string";

/** Each lnbtc vector file's fixed option without `extra.invoice`, on each lnbtc network. */
const beforeInvoice: [string, PaymentRequirements][] = (
  [
    ["x402-exact-lnbtc.json", "O"],
    ["x402-exact-lnbtc-invoice-named.json", "O_N"],
  ] as const
).flatMap(([file, key]) => {
  const o = (vector(file) as { fixed: Record<string, PaymentRequirements> }).fixed[key]!;
  const { invoice: _, ...extra } = o.extra as Record<string, unknown>;
  return LN_NETWORKS.map((network) => [`${file}:fixed.${key}, no invoice, ${network}`, { ...o, network, extra }] as [string, PaymentRequirements]);
});

const OPTIONS = rowsOf(
  [...files.flatMap((f) => collect<PaymentRequirements>(vector(f), f, isOption)), ...railOptions(), ...beforeInvoice],
  "every x402 option in the vector files, the option filter rows and the lnbtc offers without an invoice",
  { min: 200 },
);
const PAYMENTS = rowsOf(
  files.flatMap((f) =>
    collect<PaymentPayload>(vector(f), f, (o) => typeof o["accepted"] === "object" && o["accepted"] !== null && isOption(o["accepted"] as Record<string, unknown>) && "payload" in o),
  ),
  "every presented x402 payment in the vector files",
  { min: 30 },
);
/** An x402 pairing, as this test calls it. */
interface X402Pairing {
  id: string;
  read(doc: unknown): unknown;
  bound(presented: unknown): unknown;
  advertiseBeforeCarrier?(doc: unknown, h: string, link: string, offer: unknown): unknown;
}
const X402 = rowsOf(
  BINDINGS.filter((b) => b.id.startsWith("x402/")) as unknown as X402Pairing[],
  "BINDINGS, the x402 pairings",
);

/** A document holding the option alone, with the legal-context extension the root pairingOf probes with. */
function docOf(option: PaymentRequirements): PaymentRequired {
  const info = toLegalContext(`0x${"00".repeat(32)}`, "https://pairing.invalid/").legalContext;
  return { x402Version: 2, resource: { url: "https://pairing.invalid/" }, accepts: [option], extensions: { [LEGAL_CONTEXT]: { info, schema: LEGAL_CONTEXT_SCHEMA } } } as PaymentRequired;
}
/** The x402 pairings whose `read` offers the option, in BINDINGS order. */
const offeredBy = (option: PaymentRequirements): string[] => X402.filter((b) => !isRefusal(b.read(docOf(option)))).map((b) => b.id);

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
      for (const b of X402) if (!isRefusal(await b.bound(p))) bound.push(b.id);
      expect([where, bound.length]).not.toEqual([where, 0]);
      expect([where, bound.filter((id) => !offering.includes(id))]).toEqual([where, []]);
    }
  });
});
