import { describe, expect, it } from "vitest";
import {
  filterAssetTransferMethod,
  filterPaymentFlow,
  verifyInboundNonce,
  X402_PAYMENT_FLOWS,
  X402_TRANSFER_METHODS,
} from "../src/asset-transfer-method-filter.js";

const ATR = `0x${"ab".repeat(32)}`;

describe("filterAssetTransferMethod", () => {
  it("passes eip3009 (the welded method) — returns null", () => {
    expect(filterAssetTransferMethod("eip3009")).toBeNull();
  });
  it("passes an absent method (the offer did not pin one) — returns null", () => {
    expect(filterAssetTransferMethod(undefined)).toBeNull();
  });
  it("refuses permit2 with a typed policy-rejection (never a silent unwelded settlement)", () => {
    const r = filterAssetTransferMethod("permit2");
    expect(r).not.toBeNull();
    expect(r?.refused).toBe(true);
    expect(r?.haltClass).toBe("policy-rejection");
    expect(r?.code).toBe("x402/asset-transfer-method-unsupported");
    expect(r?.detail).toContain("Refusing rather than settling unwelded");
  });

  it("refuses ERC-7710 too, and says it is a method x402 DEFINES", () => {
    // The third method, and the reason this file is no longer called permit2-filter: an erc7710 offer
    // used to be refused with a message about Permit2 — a correct decision reported as the wrong reason.
    const r = filterAssetTransferMethod("erc7710");
    expect(r?.code).toBe("x402/asset-transfer-method-unsupported");
    expect(r?.detail).toContain("erc7710");
    expect(r?.detail).toContain("a method x402 defines");
  });

  it("the method vocabulary is x402's own three, in the scheme's order", () => {
    // Same reason: the refusal names them, so an emptied entry misinforms whoever is debugging an offer.
    expect(X402_TRANSFER_METHODS).toEqual(["eip3009", "permit2", "erc7710"]);
  });

  it("distinguishes an unknown method from a defined-but-unusable one", () => {
    // A typo and a real method x402 supports are different problems for whoever reads the message.
    const unknown = filterAssetTransferMethod("spend-permission");
    expect(unknown?.code).toBe("x402/asset-transfer-method-unsupported");
    expect(unknown?.detail).toContain(
      "not a method x402's exact-EVM scheme defines",
    );
    expect(unknown?.detail).toContain("eip3009, permit2, erc7710");
  });
});

describe("filterPaymentFlow (x402 §6.1)", () => {
  it("passes an absent flow — §6.1 resolves the default to authorization", () => {
    expect(filterPaymentFlow(undefined)).toBeNull();
    expect(filterPaymentFlow("authorization")).toBeNull();
  });

  it("passes upfront — one settlement, one nonce, the weld is untouched", () => {
    // settle -> resource. The ordering changes when funds move relative to the handler; it does not
    // change that there is exactly one EIP-3009 authorization carrying exactly one nonce.
    expect(filterPaymentFlow("upfront")).toBeNull();
  });

  it("ROUTES escrow to the two-phase binding rather than vetoing the flow", () => {
    // Two settles cannot share a one-time-use nonce — a fact about THIS carrier. A two-phase settlement is
    // exactly the case the record is meant to survive, and binding-evm-escrow's PaymentInfo.salt is
    // recoverable from both artifacts. Which settlement shape a party uses is not this project's call.
    const r = filterPaymentFlow("escrow");
    expect(r?.code).toBe("x402/weld-not-carried-by-this-binding");
    expect(r?.detail).toContain("One-time use");
    expect(r?.detail).toContain("lcp-binding-evm-escrow");
    expect(r?.detail).toContain("your choice");
  });

  it("refuses a flow it does not recognize, per §6.1's own client rule", () => {
    const r = filterPaymentFlow("deferred");
    expect(r?.code).toBe("x402/payment-flow-unrecognized");
    expect(r?.detail).toContain("authorization, upfront, escrow");
    // A refusal that forgot to declare itself one reads as a success to `"refused" in outcome`.
    expect(r?.refused).toBe(true);
  });

  it("the flow vocabulary is x402's own three, in the spec's order", () => {
    // Pinned because the refusal message enumerates them to the operator: an emptied entry would print a
    // list that silently omits a flow the host defines.
    expect(X402_PAYMENT_FLOWS).toEqual(["authorization", "upfront", "escrow"]);
  });
});

describe("verifyInboundNonce (the inbound re-challenge primitive)", () => {
  it("accepts an exact-match nonce and returns it lowercased", () => {
    const out = verifyInboundNonce(ATR, ATR);
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR.toLowerCase());
  });
  it("accepts a case-differing nonce (ATR canon is case-insensitive)", () => {
    const out = verifyInboundNonce(ATR.toUpperCase().replace("0X", "0x"), ATR);
    expect("refused" in out).toBe(false);
    if (!("refused" in out)) expect(out.value).toBe(ATR.toLowerCase());
  });
  it("refuses a mismatched nonce with verification-failure", () => {
    const out = verifyInboundNonce(`0x${"cd".repeat(32)}`, ATR);
    // The literal flag, not just the key: `"refused" in out` holds even when it is false, so a caller
    // branching on `if (out.refused)` would settle an unwelded payment.
    expect("ok" in out).toBe(false);
    if (!("refused" in out)) throw new Error("expected a refusal");
    expect(out.refused).toBe(true);
    expect(out.haltClass).toBe("verification-failure");
    expect(out.code).toBe("x402/nonce-mismatch");
    expect(out.detail).toContain("does not equal the advertised atrHash");
  });

  it("carries ok:true on the accepted nonce", () => {
    expect(verifyInboundNonce(ATR, ATR)).toEqual({
      ok: true,
      value: ATR.toLowerCase(),
    });
  });
});
