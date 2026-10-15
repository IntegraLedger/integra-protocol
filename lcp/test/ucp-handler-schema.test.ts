// The UCP x402 payment handler's schema (profiles/ucp-payment-handler-x402.schema.json) gives each x402 option's
// `amount` as the package's option filters take it. The handler's options are `exact` or `auth-capture`, and every such
// filter holds `amount` to the canonical decimal string of a positive integer (`isAmount`, src/internal/x402.ts); the
// schema's 78 digits are uint256's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isAmount } from "../src/internal/x402.js";

const read = (name: string) => readFileSync(new URL(`../profiles/${name}`, import.meta.url), "utf8");

// Every `amount` the schema defines: the response config's options, and the credential's `accepted` and
// `paymentRequirements`. Each is `exact` or `auth-capture`, whose filters take a positive amount only.
const POINTERS = [
  "$defs/response_config/properties/accepts/items/properties/amount",
  "$defs/credential/properties/paymentPayload/properties/accepted/properties/amount",
  "$defs/credential/properties/paymentRequirements/properties/amount",
];
const AMOUNT = { type: "string", pattern: "^[1-9][0-9]{0,77}$" };

describe("ucp/payment-handler/x402's schema: an option's amount", () => {
  const schema = JSON.parse(read("ucp-payment-handler-x402.schema.json")) as Record<string, unknown>;
  const at = (pointer: string) =>
    pointer.split("/").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], schema);

  it("the schema defines amount at these three places and no other", () => {
    const found: string[] = [];
    const walk = (o: unknown, path: string[]): void => {
      if (o === null || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o)) {
        if (k === "amount" && path.at(-1) === "properties") found.push([...path, k].join("/"));
        walk(v, [...path, k]);
      }
    };
    walk(schema, []);
    expect(found).toEqual(POINTERS);
  });

  it.each(POINTERS)("%s is the canonical decimal of a positive integer of at most 78 digits", (pointer) => {
    expect(at(pointer)).toEqual(AMOUNT);
  });

  it.each(POINTERS)("%s takes the amounts isAmount takes, up to 78 digits, and no other", (pointer) => {
    const pattern = new RegExp((at(pointer) as { pattern: string }).pattern);
    const taken = ["1", "10", "18000000", "9".repeat(78), "1" + "0".repeat(77)];
    const refused = ["0", "00", "010", "1.5", "-1", "+1", "", " 1", "1e3", "9".repeat(79)];
    const samples = [...taken, ...refused];
    expect(samples.map((a) => pattern.test(a))).toEqual([...taken.map(() => true), ...refused.map(() => false)]);
    for (const a of samples) expect([a, pattern.test(a)]).toEqual([a, isAmount(a) && a.length <= 78]);
  });
});
