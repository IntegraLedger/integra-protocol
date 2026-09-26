import { describe, expect, it } from "vitest";
import type { Binding } from "../src/index.js";
import type { Refusal } from "../src/refusal.js";

// the issuer stores every reference with JSON.stringify, which throws on a bigint: no pairing's reference carries one. This
// line compiles only while that holds; each pairing's own test round-trips its reference through JSON.
type HasBigint<T> = T extends bigint
  ? true
  : T extends readonly (infer E)[]
    ? HasBigint<E>
    : T extends object
      ? true extends { [K in keyof T]-?: HasBigint<T[K]> }[keyof T]
        ? true
        : false
      : false;
type ReferenceOf<B> = B extends { reference: (presented: unknown) => Promise<infer R> } ? Exclude<R, Refusal> : never;
const noBigint: true extends HasBigint<ReferenceOf<Binding>> ? "a reference carries a bigint" : "none" = "none";

describe("references are JSON", () => {
  it("no pairing's reference type carries a bigint", () => expect(noBigint).toBe("none"));
  it("the check sees a bigint nested in a union", () => {
    const seen: true extends HasBigint<{ a: { b: bigint } | string }> ? "seen" : "missed" = "seen";
    expect(seen).toBe("seen");
  });
});
