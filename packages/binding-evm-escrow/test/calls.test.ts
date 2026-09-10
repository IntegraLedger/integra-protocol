import { encodeAbiParameters, keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { PaymentInfo } from "../src/adapter.js";
import {
  getHashOffchain,
  PAYMENT_INFO_TYPEHASH,
  payerAgnosticNonce,
  paymentInfoHash,
} from "../src/calls.js";

const TYPEHASH_STRING =
  "PaymentInfo(address operator,address payer,address receiver,address token," +
  "uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry," +
  "uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)";

// The on-chain typehash (deployed PAYMENT_INFO_TYPEHASH @ 98b592b). Drift fails loud.
const PROVEN_TYPEHASH =
  "0xae68ac7ce30c86ece8196b61a7c486d8f0061f575037fbd34e7fe4e2820c6591";

// An INDEPENDENT PaymentInfo tuple + getHash derivation (separate code from calls.ts) — the oracle.
const PI_TUPLE = {
  type: "tuple",
  components: [
    { name: "operator", type: "address" },
    { name: "payer", type: "address" },
    { name: "receiver", type: "address" },
    { name: "token", type: "address" },
    { name: "maxAmount", type: "uint120" },
    { name: "preApprovalExpiry", type: "uint48" },
    { name: "authorizationExpiry", type: "uint48" },
    { name: "refundExpiry", type: "uint48" },
    { name: "minFeeBps", type: "uint16" },
    { name: "maxFeeBps", type: "uint16" },
    { name: "feeReceiver", type: "address" },
    { name: "salt", type: "uint256" },
  ],
} as const;

function independentGetHash(
  info: PaymentInfo,
  chainId: number,
  escrow: `0x${string}`,
): `0x${string}` {
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, PI_TUPLE],
      [keccak256(toHex(TYPEHASH_STRING)), info],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "bytes32" }],
      [BigInt(chainId), escrow, structHash],
    ),
  );
}

const ESCROW = "0xBdEA0D1bcC5966192B070Fdf62aB4EF5b4420cff" as const;

function info(
  salt: bigint,
  payer: `0x${string}` = "0x2222222222222222222222222222222222222222",
): PaymentInfo {
  return {
    operator: "0x1111111111111111111111111111111111111111",
    payer,
    receiver: "0x3333333333333333333333333333333333333333",
    token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    maxAmount: 1_000000n,
    preApprovalExpiry: 4102444800,
    authorizationExpiry: 4102444800,
    refundExpiry: 4102444800,
    minFeeBps: 0,
    maxFeeBps: 0,
    feeReceiver: "0x0000000000000000000000000000000000000000",
    salt,
  };
}

describe("PAYMENT_INFO_TYPEHASH", () => {
  it("matches the on-chain-proven deployed typehash (98b592b)", () => {
    expect(PAYMENT_INFO_TYPEHASH).toBe(PROVEN_TYPEHASH);
  });
});

describe("getHashOffchain / paymentInfoHash / payerAgnosticNonce", () => {
  const salt = BigInt(
    "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  );
  const chainId = 84532;

  it("equals an independent getHash derivation (transcription guard)", () => {
    expect(
      getHashOffchain({ chainId, escrow: ESCROW, paymentInfo: info(salt) }),
    ).toBe(independentGetHash(info(salt), chainId, ESCROW));
  });

  it("paymentInfoHash is the getHash alias", () => {
    const args = { chainId, escrow: ESCROW, paymentInfo: info(salt) };
    expect(paymentInfoHash(args)).toBe(getHashOffchain(args));
  });

  it("payerAgnosticNonce is getHash with payer zeroed (the ERC-3009 nonce)", () => {
    const nonce = payerAgnosticNonce({
      chainId,
      escrow: ESCROW,
      paymentInfo: info(salt),
    });
    const zeroed = getHashOffchain({
      chainId,
      escrow: ESCROW,
      paymentInfo: info(salt, "0x0000000000000000000000000000000000000000"),
    });
    expect(nonce).toBe(zeroed);
    // and differs from the real-payer hash
    expect(nonce).not.toBe(
      getHashOffchain({ chainId, escrow: ESCROW, paymentInfo: info(salt) }),
    );
  });

  it("⛔ REFUSES an absent escrow rather than defaulting it — the address is hashed INTO the key", () => {
    // It used to be `params.escrow ?? AUTH_CAPTURE_ESCROW`, which is the Base deployment and no other
    // chain's. Silently substituting it changed `paymentInfoHash` — the settlement key a consumer joins
    // on — and, through `payerAgnosticNonce`, the ERC-3009 nonce the buyer signs. Both come back
    // well-formed and match nothing.
    expect(() =>
      getHashOffchain({
        chainId,
        paymentInfo: info(salt),
      } as unknown as Parameters<typeof getHashOffchain>[0]),
    ).toThrow(/escrow must be a 20-byte 0x address/);
  });

  it("the throw NAMES getHashOffchain, so a caller knows which derivation refused", () => {
    // The three key derivations share one message; without the call site an operator cannot tell which
    // of them was handed the bad address.
    expect(() =>
      getHashOffchain({
        chainId,
        paymentInfo: info(salt),
      } as unknown as Parameters<typeof getHashOffchain>[0]),
    ).toThrow(/getHashOffchain/);
  });

  it("⛔ and the alias and the nonce refuse it too — three entry points, one rule", () => {
    const bad = { chainId, escrow: "0xnope", paymentInfo: info(salt) };
    expect(() =>
      paymentInfoHash(bad as unknown as Parameters<typeof paymentInfoHash>[0]),
    ).toThrow(/escrow must be a 20-byte 0x address/);
    expect(() =>
      payerAgnosticNonce(
        bad as unknown as Parameters<typeof payerAgnosticNonce>[0],
      ),
    ).toThrow(/escrow must be a 20-byte 0x address/);
  });

  it("⭐ a DIFFERENT escrow yields a different key — the address is load-bearing, not decorative", () => {
    // The assertion the default made impossible to notice: if the address did not reach the hash, these
    // two would agree and a wrong deployment would key correctly.
    const other = "0x00000000000000000000000000000000000000ff" as const;
    expect(
      getHashOffchain({ chainId, escrow: other, paymentInfo: info(salt) }),
    ).not.toBe(
      getHashOffchain({ chainId, escrow: ESCROW, paymentInfo: info(salt) }),
    );
  });
});
