// The option's payee, which every pairing's reference takes from the option the payment answers.
import { describe, expect, it } from "vitest";
import { toBase64Url } from "../src/index.js";
import { mppPayee, x402Payee } from "../src/internal/payee.js";

const request = (o: object): string => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));
const challenge = (req: string) => ({ id: "x", realm: "r", method: "evm", intent: "charge", request: req });

describe("the option's payee", () => {
  it("is an x402 option's payTo", () => {
    expect(x402Payee({ payTo: "0xabc", asset: "0xdef" })).toBe("0xabc");
    for (const bad of [null, "0xabc", {}, { payTo: "" }, { payTo: 5 }]) {
      expect(x402Payee(bad)).toEqual({ refused: true, code: "x402/option-malformed" });
    }
  });
  it("is an MPP challenge's decoded request's recipient", () => {
    expect(mppPayee(challenge(request({ amount: "1", currency: "c", recipient: "0xabc" })))).toBe("0xabc");
    expect(mppPayee({ realm: "r" })).toEqual({ refused: true, code: "mpp/challenge-malformed" });
    expect(mppPayee(challenge(request({ amount: "1" })))).toEqual({ refused: true, code: "mpp/request-malformed" });
    expect(mppPayee(challenge("!!"))).toEqual({ refused: true, code: "mpp/request-malformed" });
  });
});
