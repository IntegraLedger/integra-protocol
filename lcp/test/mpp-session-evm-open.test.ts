// The EVM session's `hash` opening read, from mpp-session-evm.json's ES9. draft-evm-session-00 (tempoxyz/mpp-specs at
// 08e7dd87) defines the escrow's `open(address payee, address token, uint128 deposit, bytes32 salt, address
// authorizedSigner)` and no opening event; the channel id is keccak256(abi.encode(payer, payee, token, salt,
// authorizedSigner, escrow, chainId)), where the payer is the account that calls `open`. Every expected value is the
// file's; viem 2.56.8 encodes the calldata independently here.
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError, type EvmReader, type EvmTransaction } from "../src/evm.js";
import { place, sessionEvm, type MppChallenge, type MppCredential, type SessionRef } from "../src/mpp.js";
import { H, challenge, link, load, withBigints } from "./mpp-fixtures.js";

const E = load("mpp-session-evm.json");
const f = E.fixed;
const R = E.ES9;
const H2 = f.H2 as Hex;
/** A 65-byte signature; no check here reads a signature. */
const SIGNATURE = `0x${"11".repeat(65)}` as Hex;
const OPEN = parseAbi(["function open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

function reader(tx: EvmTransaction | null | "error"): EvmReader {
  return {
    network: `eip155:${f.chainId}`,
    receipt: async (hash) =>
      hash === R.hash ? { status: R.receipt.status, blockNumber: BigInt(R.receipt.blockNumber), logs: R.receipt.logs } : null,
    blockNumber: async () => BigInt(R.finalized),
    transaction: async (hash) => {
      if (tx === "error") throw new ReaderError("transport");
      return hash === R.hash ? tx : null;
    },
  };
}

/** The hash opening of a channel for `h`: the challenge placed with `h`, then `build`, completed with ES9's hash. */
async function opening(h: Hex): Promise<MppCredential> {
  const ch = (place([challenge("evm", "session", f.request)], h, link, challenge("evm", "session", f.request)) as (MppChallenge & { id: string })[])[0]!;
  const u = await sessionEvm.build({ challenge: ch, from: f.payer, now: f.now, deposit: BigInt(f.deposit), credentialType: "hash" }, h);
  if ("refused" in u) throw new Error(u.code);
  const c = u.complete(R.hash, SIGNATURE);
  if ("refused" in c) throw new Error(c.code);
  return c;
}

async function statusOf(cred: MppCredential, tx: EvmTransaction | null | "error") {
  const ref = (await sessionEvm.reference(cred)) as SessionRef;
  const transaction = sessionEvm.landedTx(cred) as Hex;
  return withBigints(await sessionEvm.status({ ...ref, transaction }, reader(tx)));
}

describe("ES9: the hash opening's settlement read", () => {
  it("the open calls are viem's encoding of the draft's open", () => {
    const open = (payee: Hex, salt: Hex) =>
      encodeFunctionData({ abi: OPEN, functionName: "open", args: [payee, f.usdc, BigInt(f.deposit), salt, ZERO] });
    expect(R.cases[0].transaction.input).toBe(open(f.recipient, H));
    expect(R.cases[2].transaction.input).toBe(open(f.recipient, H2));
    expect(R.cases[4].transaction.input).toBe(open("0x7777777777777777777777777777777777777777", H));
  });

  it("the reference names the escrow, the channel, H and the chain, beside the payer-to-escrow transfer", async () => {
    const cred = await opening(H);
    const ref = (await sessionEvm.reference(cred)) as SessionRef;
    expect(ref.opens).toEqual({ escrow: f.escrow, channel: E.ES1.expectChannelId, h: H, chainId: f.chainId });
    expect(ref.transferLog?.identity).toBe("from,to");
    expect(ref.transferLog?.digest).toBe(E.ES7.expectFromTo);
  });

  for (const row of R.cases) {
    it(row.case, async () => {
      expect(await statusOf(await opening(H), row.transaction)).toEqual(row.expect);
    });
  }

  it(R.presentedForH2.case, async () => {
    const cred = await opening(H2);
    expect(await sessionEvm.bound(cred)).toBe(H2);
    expect(await statusOf(cred, R.presentedForH2.transaction)).toEqual(R.presentedForH2.expect);
  });

  it("the hash opening inside a voucher's deposit is read the same way", async () => {
    const c = await opening(H);
    const { action: _action, ...deposit } = c.payload;
    const merged: MppCredential = {
      ...c,
      payload: { action: "voucher", channelId: c.payload["channelId"]!, cumulativeAmount: "0", signature: c.payload["signature"]!, deposit: { action: "open", ...deposit } },
    };
    expect(sessionEvm.channel.kind(merged)).toBe("open");
    expect(await statusOf(merged, R.cases[0].transaction)).toEqual(R.cases[0].expect);
    expect(await statusOf(merged, R.cases[1].transaction)).toEqual(R.cases[1].expect);
  });

  it("an unreadable transaction read is pending", async () => {
    expect(await statusOf(await opening(H), "error")).toEqual({ state: "pending", why: "unreadable" });
    const noSender = { ...R.cases[0].transaction, from: "0x1234" };
    expect(await statusOf(await opening(H), noSender)).toEqual({ state: "pending", why: "unreadable" });
  });

  it("an authorization or Permit2 opening's reference names no open call", async () => {
    for (const credentialType of ["authorization", "permit2"] as const) {
      const ch = (place([challenge("evm", "session", f.request)], H, link, challenge("evm", "session", f.request)) as (MppChallenge & { id: string })[])[0]!;
      const u = await sessionEvm.build(
        { challenge: ch, from: f.payer, now: f.now, deposit: BigInt(f.deposit), credentialType, tokenDomain: f.tokenDomain },
        H,
      );
      if ("refused" in u || u.funding.kind !== "eip712") throw new Error("not eip712");
      const c = u.complete(SIGNATURE, SIGNATURE);
      if ("refused" in c) throw new Error(c.code);
      const ref = (await sessionEvm.reference(c)) as SessionRef;
      expect(ref.opens, credentialType).toBeUndefined();
    }
  });
});
