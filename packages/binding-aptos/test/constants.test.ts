import { describe, expect, it } from "vitest";
import {
  explorerTxUrl,
  getAptosConfig,
  PAYMENT_SETTLED_EVENT,
  paymentSettledEventType,
  SETTLE_PAYMENT_FUNCTION,
  settlePaymentFunction,
} from "../src/constants.js";

const MODULE =
  "0x1ad2769f4ba8f340368395e6706a42e686a33c90bff7c8e48de7bae39f935be9";

describe("getAptosConfig", () => {
  it("testnet resolves to the published lcp_payment module and its fullnode", () => {
    expect(getAptosConfig("testnet")).toEqual({
      network: "testnet",
      fullnodeUrl: "https://fullnode.testnet.aptoslabs.com/v1",
      settlementCoin: "0x1::aptos_coin::AptosCoin",
      decimals: 8,
      lcpModuleAddress: MODULE,
      explorerBase: "https://explorer.aptoslabs.com",
    });
  });

  it("MAINNET FAILS LOUD — the lcp_payment module is unpublished there", () => {
    // The `0x0` sentinel is the whole point of this branch: without the throw, a mainnet caller builds
    // `0x0::payment::settle_payment` and submits a Move call to an address that holds no module. The
    // failure would surface as an opaque VM abort at settlement time rather than at configuration time.
    expect(() => getAptosConfig("mainnet")).toThrow(
      /unpublished on Aptos mainnet/,
    );
  });

  it("a network outside the union is refused rather than defaulting to testnet", () => {
    expect(() =>
      getAptosConfig("devnet" as Parameters<typeof getAptosConfig>[0]),
    ).toThrow(/unsupported network/);
  });
});

describe("module-qualified Move identifiers", () => {
  it("builds the entry function and the event type under the given module address", () => {
    expect(settlePaymentFunction(MODULE)).toBe(
      `${MODULE}::payment::settle_payment`,
    );
    expect(paymentSettledEventType(MODULE)).toBe(
      `${MODULE}::payment::PaymentSettled`,
    );
    expect(SETTLE_PAYMENT_FUNCTION).toBe("payment::settle_payment");
    expect(PAYMENT_SETTLED_EVENT).toBe("payment::PaymentSettled");
  });

  it("the two are DIFFERENT identifiers — an overlay binding scopes both to its own module", () => {
    // recoverAtrHashFromSettleViews honours only its own module's event; swapping these two strings
    // would make it look for an event named after the entry function and find nothing, on every tx.
    expect(settlePaymentFunction(MODULE)).not.toBe(
      paymentSettledEventType(MODULE),
    );
  });
});

describe("explorerTxUrl", () => {
  it("points at the testnet explorer for a testnet hash", () => {
    expect(explorerTxUrl("testnet", "0xabc")).toBe(
      "https://explorer.aptoslabs.com/txn/0xabc?network=testnet",
    );
  });

  it("cannot build a mainnet link while the module is unpublished (it reads the same config)", () => {
    expect(() => explorerTxUrl("mainnet", "0xabc")).toThrow(
      /unpublished on Aptos mainnet/,
    );
  });
});
