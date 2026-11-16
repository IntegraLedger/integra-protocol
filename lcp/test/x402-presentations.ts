// The x402 options and presented payments the vector files hold, and the x402 pairings, as x402-read-one-pairing.test.ts
// and x402-bound-accepted.test.ts read them. The options: every object with a string `scheme` and `network` in each x402
// vector file and in buyer.json, and every option filter row (option-filter-rows.ts). The payments: every object in
// those files with such an option as its `accepted` and a `payload`.
import { readdirSync, readFileSync } from "node:fs";
import { BINDINGS, isRefusal, toLegalContext } from "../src/index.js";
import { LEGAL_CONTEXT, LEGAL_CONTEXT_SCHEMA, type PaymentPayload, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import { railOptions } from "./option-filter-rows.js";
import { rowsOf } from "./rows.js";

const dir = new URL("../vectors/", import.meta.url);
/** The vector files of x402's transport, not of a pairing, which their own tests hold: the headers and the request. */
const TRANSPORT = ["x402-headers.json", "x402-request-commitment.json"];
export const FILES = rowsOf(
  readdirSync(dir).filter((n) => n.startsWith("x402-") || n === "buyer.json"),
  "vectors/, the x402 vector files and buyer.json",
  {
    min: 20,
    keep: ["the x402 pairings' files and buyer.json", (n) => !TRANSPORT.includes(n)],
    leave: ["the files of x402's transport, which their own tests hold", (n) => TRANSPORT.includes(n)],
  },
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

export const OPTIONS = rowsOf(
  [...FILES.flatMap((f) => collect<PaymentRequirements>(vector(f), f, isOption)), ...railOptions()],
  "every x402 option in the vector files and the option filter rows",
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
  /** The read keys of what was presented, with the payee of `option`, the option the payment answers. */
  reference?(presented: unknown, option?: unknown): Promise<unknown>;
  channel?: { kind(presented: unknown): unknown; boundWithin(presented: unknown): unknown };
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
