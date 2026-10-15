// The x402 options and presented payments the vector files hold, and the x402 pairings, as x402-read-one-pairing.test.ts
// and x402-bound-accepted.test.ts read them. The options: every object with a string `scheme` and `network` in each x402
// vector file and in buyer.json, every option filter row (option-filter-rows.ts), and each lnbtc vector file's fixed
// option without its `extra.invoice`, on both lnbtc networks: the offer the seller sends before its node writes the
// invoice. The payments: every object in those files with such an option as its `accepted` and a `payload`.
import { readdirSync, readFileSync } from "node:fs";
import { BINDINGS, isRefusal, toLegalContext } from "../src/index.js";
import { LEGAL_CONTEXT, LEGAL_CONTEXT_SCHEMA, type PaymentPayload, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import { railOptions } from "./option-filter-rows.js";
import { rowsOf } from "./rows.js";

/** The lnbtc networks, Bitcoin mainnet's and testnet3's, each named by the first 16 bytes of its genesis block hash. */
export const LN_NETWORKS = ["lnbtc:000000000019d6689c085ae165831e93", "lnbtc:000000000933ea01ad0ee984209779ba"];

const dir = new URL("../vectors/", import.meta.url);
export const FILES = rowsOf(
  readdirSync(dir).filter((n) => n.startsWith("x402-") || n === "buyer.json"),
  "vectors/, the x402 vector files and buyer.json",
  { min: 20 },
);
export const vector = (name: string): unknown => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

/** Every object under `v` that `pick` keeps, each with the path to it. */
export function collect<T>(v: unknown, path: string, pick: (o: Record<string, unknown>) => boolean, out: [string, T][] = []): [string, T][] {
  if (typeof v !== "object" || v === null) return out;
  if (!Array.isArray(v) && pick(v as Record<string, unknown>)) out.push([path, v as T]);
  for (const [k, x] of Object.entries(v)) collect(x, `${path}.${k}`, pick, out);
  return out;
}
export const isOption = (o: Record<string, unknown>) => typeof o["scheme"] === "string" && typeof o["network"] === "string";

/** Each lnbtc vector file's fixed option without `extra.invoice`, on each lnbtc network. */
export const BEFORE_INVOICE: [string, PaymentRequirements][] = (
  [
    ["x402-exact-lnbtc.json", "O"],
    ["x402-exact-lnbtc-invoice-named.json", "O_N"],
  ] as const
).flatMap(([file, key]) => {
  const o = (vector(file) as { fixed: Record<string, PaymentRequirements> }).fixed[key]!;
  const { invoice: _, ...extra } = o.extra as Record<string, unknown>;
  return LN_NETWORKS.map((network) => [`${file}:fixed.${key}, no invoice, ${network}`, { ...o, network, extra }] as [string, PaymentRequirements]);
});

export const OPTIONS = rowsOf(
  [...FILES.flatMap((f) => collect<PaymentRequirements>(vector(f), f, isOption)), ...railOptions(), ...BEFORE_INVOICE],
  "every x402 option in the vector files, the option filter rows and the lnbtc offers without an invoice",
  { min: 200 },
);
export const PAYMENTS = rowsOf(
  FILES.flatMap((f) =>
    collect<PaymentPayload>(vector(f), f, (o) => typeof o["accepted"] === "object" && o["accepted"] !== null && isOption(o["accepted"] as Record<string, unknown>) && "payload" in o),
  ),
  "every presented x402 payment in the vector files",
  { min: 30 },
);

/** An x402 pairing, as these tests call it. */
export interface X402Pairing {
  id: string;
  read(doc: unknown): unknown;
  bound(presented: unknown): Promise<unknown>;
  reference?(presented: unknown): Promise<unknown>;
  advertise(doc: unknown, h: string, link: string, offer: unknown): unknown;
  advertiseBeforeCarrier?(doc: unknown, h: string, link: string, offer: unknown): unknown;
}
export const X402 = rowsOf(
  BINDINGS.filter((b) => b.id.startsWith("x402/")) as unknown as X402Pairing[],
  "BINDINGS, the x402 pairings",
);

/** A document holding the option alone, with the legal-context extension the root pairingOf probes with. */
export function docOf(option: PaymentRequirements): PaymentRequired {
  const info = toLegalContext(`0x${"00".repeat(32)}`, "https://pairing.invalid/").legalContext;
  return { x402Version: 2, resource: { url: "https://pairing.invalid/" }, accepts: [option], extensions: { [LEGAL_CONTEXT]: { info, schema: LEGAL_CONTEXT_SCHEMA } } } as PaymentRequired;
}
/** The x402 pairings whose `read` offers the option, in BINDINGS order. */
export const offeredBy = (option: PaymentRequirements): string[] => X402.filter((b) => !isRefusal(b.read(docOf(option)))).map((b) => b.id);
