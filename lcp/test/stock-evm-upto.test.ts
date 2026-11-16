// The stock x402 upto facilitator's payload check over the payment lcp builds for x402/upto/eip155/permit2:
// @x402/evm 2.31.0 (npm, a devDependency this package pins), UptoEvmScheme's verify, whose first step reads the payload
// and refuses a Permit2 nonce that is not a uint256 in decimal digits with "permit2Authorization.nonce must be a uint256
// decimal string". The payment is EV2's, built from the file's fixed input and signed with its key. Nothing here reads a
// chain: the facilitator's signer answers its one address, the option's facilitatorAddress, and every read it would make
// fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UptoEvmScheme } from "@x402/evm/upto/facilitator";
import type { TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LEGAL_CONTEXT_SCHEMA, uptoPermit2, type PaymentPayload, type PaymentRequired } from "../src/x402.js";
import type { Hex } from "../src/evm.js";

const UP = JSON.parse(readFileSync(new URL("../vectors/x402-upto-eip155-permit2.json", import.meta.url), "utf8"));
const f = UP.fixed;
const NONCE_MESSAGE = "permit2Authorization.nonce must be a uint256 decimal string";

async function built(): Promise<PaymentPayload> {
  const required: PaymentRequired = {
    x402Version: 2,
    resource: f.resource,
    accepts: [f.option],
    extensions: { legalContext: { info: { type: "sha256", value: f.H, legalContextUrl: f.link }, schema: LEGAL_CONTEXT_SCHEMA } },
  };
  const u = await uptoPermit2.build({ required, accepted: f.option, from: f.payer, now: f.now }, f.H);
  if ("refused" in u || u.request.kind !== "eip712") throw new Error("not an eip712 request");
  const signature = await privateKeyToAccount(f.payerKey as Hex).signTypedData(u.request.typedData as TypedDataDefinition);
  const p = (u.complete as (s: Hex) => PaymentPayload | { refused: true })(signature);
  if ("refused" in p) throw new Error("complete refused");
  return p;
}

/** A facilitator signer that answers its one address and fails every read. */
function offline(): ConstructorParameters<typeof UptoEvmScheme>[0] {
  const fail = async () => {
    throw new Error("offline");
  };
  return new Proxy({ getAddresses: () => [f.option.extra.facilitatorAddress] } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : fail),
  }) as unknown as ConstructorParameters<typeof UptoEvmScheme>[0];
}

/** The stock facilitator's verify of `p` under the file's option, with any rejection as its message. */
async function verified(p: PaymentPayload): Promise<{ isValid: boolean; invalidReason?: string; invalidMessage?: string } | string> {
  try {
    return await new UptoEvmScheme(offline()).verify(p as never, f.option as never);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("x402-upto-eip155-permit2.json EV2 under the stock facilitator", () => {
  it("lcp's built payload, its nonce EV2.expectNonceDecimal, passes the payload check the 0x + 64 hex spelling fails", async () => {
    const p = await built();
    const a = (p.payload as { permit2Authorization: { nonce: string } }).permit2Authorization;
    expect(a.nonce).toBe(UP.EV2.expectNonceDecimal);
    const hex = structuredClone(p) as PaymentPayload & { payload: { permit2Authorization: { nonce: string } } };
    hex.payload.permit2Authorization.nonce = f.H;
    const refused = await verified(hex);
    if (typeof refused === "string") throw new Error(refused);
    expect(refused).toMatchObject({ isValid: false, invalidMessage: NONCE_MESSAGE });
    const out = await verified(p);
    if (typeof out === "string") throw new Error(out);
    // Past the payload check, verify reads the deadline against the clock, and EV2's has passed: its own reason,
    // after the payload check.
    expect(out.invalidReason).not.toBe(refused.invalidReason);
    expect(out.invalidMessage).toBeUndefined();
    expect(out).toMatchObject({ isValid: false, invalidReason: "permit2_deadline_expired" });
  });
});
