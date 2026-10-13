// The EVM session's `hash` and `permit2` opening reads, from mpp-session-evm.json's ES9. draft-evm-session-00
// (tempoxyz/mpp-specs at 08e7dd87) defines the escrow's `open(address payee, address token, uint128 deposit, bytes32
// salt, address authorizedSigner)` and `openWithPermit2(..., address from, ...)`, and no opening event; the channel id is
// keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)), where the payer is the account
// that calls `open`, or `openWithPermit2`'s `from`. A hash opening is sent "either directly or through an ERC-4337
// EntryPoint-mediated UserOperation" (the draft's open verification); the account's calldata does not show which contract
// the account called, so one sent through an EntryPoint reads as pending, never failed. Every expected value is the
// file's; viem 2.57.4 encodes the calldata independently here.
import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError, type EvmLog, type EvmReader, type EvmTransaction } from "../src/evm.js";
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

type Receipt = { status: 0 | 1; blockNumber: string; logs: EvmLog[] };

function reader(tx: EvmTransaction | null | "error", receipt: Receipt = R.receipt): EvmReader {
  return {
    network: `eip155:${f.chainId}`,
    receipt: async (hash) =>
      hash === R.hash ? { status: receipt.status, blockNumber: BigInt(receipt.blockNumber), logs: receipt.logs } : null,
    blockNumber: async () => BigInt(R.finalized),
    transaction: async (hash) => {
      if (tx === "error") throw new ReaderError("transport");
      return hash === R.hash ? tx : null;
    },
    call: async () => {
      throw new Error("the hash opening's read makes no eth_call");
    },
  };
}

/** The hash opening of a channel for `h` and `from`: the challenge placed with `h`, then `build`, completed with ES9's hash. */
async function opening(h: Hex, from: Hex = f.payer): Promise<MppCredential> {
  const ch = (place([challenge("evm", "session", f.request)], h, link, challenge("evm", "session", f.request)) as (MppChallenge & { id: string })[])[0]!;
  const u = await sessionEvm.build({ challenge: ch, from, now: f.now, deposit: BigInt(f.deposit), credentialType: "hash" }, h);
  if ("refused" in u) throw new Error(u.code);
  const c = u.complete(R.hash, SIGNATURE);
  if ("refused" in c) throw new Error(c.code);
  return c;
}

/** The authorization or Permit2 opening of the channel for H, signed off by fixed bytes; no check reads a signature. */
async function signedOpening(credentialType: "authorization" | "permit2"): Promise<MppCredential> {
  const ch = (place([challenge("evm", "session", f.request)], H, link, challenge("evm", "session", f.request)) as (MppChallenge & { id: string })[])[0]!;
  const u = await sessionEvm.build(
    { challenge: ch, from: f.payer, now: f.now, deposit: BigInt(f.deposit), credentialType, tokenDomain: f.tokenDomain },
    H,
  );
  if ("refused" in u || u.funding.kind !== "eip712") throw new Error("not eip712");
  const c = u.complete(SIGNATURE, SIGNATURE);
  if ("refused" in c) throw new Error(c.code);
  return c;
}

async function statusOf(cred: MppCredential, tx: EvmTransaction | null | "error", receipt?: Receipt) {
  const ref = (await sessionEvm.reference(cred)) as SessionRef;
  const transaction = (sessionEvm.landedTx(cred) ?? R.hash) as Hex;
  return withBigints(await sessionEvm.status({ ...ref, transaction }, reader(tx, receipt)));
}

describe("ES9: the hash opening's settlement read", () => {
  it("the open calls are viem's encoding of the draft's open", () => {
    const open = (payee: Hex, salt: Hex) =>
      encodeFunctionData({ abi: OPEN, functionName: "open", args: [payee, f.usdc, BigInt(f.deposit), salt, ZERO] });
    expect(R.cases[0].transaction.input).toBe(open(f.recipient, H));
    expect(R.cases[2].transaction.input).toBe(open(f.recipient, H2));
    expect(R.cases[4].transaction.input).toBe(open("0x7777777777777777777777777777777777777777", H));
    // ERC-8021's data suffix ends in this 16-byte marker (ox 0.14.45, erc8021 `ercSuffix`).
    expect(R.cases[7].transaction.input).toBe(`${open(f.recipient, H)}80218021802180218021802180218021`);
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

  // The Ethereum JSON-RPC block tags (ethereum/execution-apis, `BlockTag`): `safe` is safe from reorganization only under
  // honest-majority and synchrony assumptions, and `finalized` cannot be reorganized without manual intervention. A
  // block above `finalized` can still be replaced, so a failed answer, which names no mark, needs the receipt's block at
  // or below it; above it the read is pending. The failed rows and their expectation at the finalized mark are ES9's.
  it("a call that opens another channel is failed only once its block is at or below the finalized mark", async () => {
    const failed = R.cases.filter((row: { expect: { state: string } }) => row.expect.state === "failed");
    expect(failed.length).toBeGreaterThan(0);
    const block = BigInt(R.receipt.blockNumber);
    const pending = { state: "pending", why: "open-call-not-found" };
    for (const row of failed) {
      for (const [finalized, safe, expected] of [
        [block, block, row.expect],
        [block - 1n, block, pending],
        [block - 1n, block - 1n, pending],
      ] as const) {
        const marked: EvmReader = { ...reader(row.transaction), blockNumber: async (tag) => (tag === "finalized" ? finalized : safe) };
        const ref = (await sessionEvm.reference(await opening(H))) as SessionRef;
        const read = withBigints(await sessionEvm.status({ ...ref, transaction: R.hash as Hex }, marked));
        expect(read, `${row.case}; finalized ${finalized}, safe ${safe}`).toEqual(expected);
      }
    }
  });

  it("an unreadable transaction read is pending", async () => {
    expect(await statusOf(await opening(H), "error")).toEqual({ state: "pending", why: "unreadable" });
    const noSender = { ...R.cases[0].transaction, from: "0x1234" };
    expect(await statusOf(await opening(H), noSender)).toEqual({ state: "pending", why: "unreadable" });
  });

  // CONTRIBUTING.md, "Failures are values": status answers a ref member it cannot read as pending unreadable and makes
  // no reader call for it. A readable opens is the form reference writes, asserted above: the escrow's address, the
  // channel, H and the chain id.
  it("an opens that is not of the form reference writes reads as pending unreadable, with no call made", async () => {
    const ref = (await sessionEvm.reference(await opening(H))) as SessionRef;
    const calls = { n: 0 };
    const settled = reader(R.cases[0].transaction);
    const counting: EvmReader = {
      network: settled.network,
      receipt: async (tx) => (calls.n++, settled.receipt(tx)),
      blockNumber: async (tag) => (calls.n++, settled.blockNumber(tag)),
      transaction: async (tx) => (calls.n++, settled.transaction(tx)),
      call: async (to, data, block) => (calls.n++, settled.call(to, data, block)),
    };
    for (const opens of [null, {}, { ...ref.opens, escrow: 5 }, { ...ref.opens, chainId: 0 }, "x"]) {
      const malformed = { ...ref, opens, transaction: R.hash } as unknown as SessionRef & { transaction: Hex };
      expect(await sessionEvm.status(malformed, counting), JSON.stringify(opens)).toEqual({ state: "pending", why: "unreadable" });
    }
    expect(calls.n).toBe(0);
    expect(withBigints(await sessionEvm.status({ ...ref, transaction: R.hash as Hex }, counting))).toEqual(R.cases[0].expect);
  });

  it("the authorization opening's reference names no open call; its AuthorizationUsed nonce commits to H", async () => {
    const ref = (await sessionEvm.reference(await signedOpening("authorization"))) as SessionRef;
    expect(ref.opens).toBeUndefined();
    expect(ref.bindingLog?.value).toBe(E.ES3.expectNonce);
  });
});

describe("ES9 entryPoint: the hash opening sent through an ERC-4337 EntryPoint reads as pending", () => {
  const P = R.entryPoint;

  it("the reference names the account's channel", async () => {
    const ref = (await sessionEvm.reference(await opening(H, P.account))) as SessionRef;
    expect(ref.opens).toEqual({ escrow: f.escrow, channel: P.expectChannelId, h: H, chainId: f.chainId });
  });

  for (const row of P.cases) {
    it(row.case, async () => {
      expect(await statusOf(await opening(H, P.account), row.transaction, row.receipt)).toEqual(row.expect);
    });
  }
});

describe("ES9 permit2: the Permit2 opening reads the escrow's openWithPermit2", () => {
  const P = R.permit2;
  const OPEN_WITH_PERMIT2 = parseAbi([
    "function openWithPermit2(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner, address from, uint256 nonce, uint256 deadline, bytes signature)",
  ]);

  it("the reference names the escrow, the channel, H and the chain, beside the deadline and the transfer", async () => {
    const ref = (await sessionEvm.reference(await signedOpening("permit2"))) as SessionRef;
    expect(ref.opens).toEqual({ escrow: f.escrow, channel: E.ES1.expectChannelId, h: H, chainId: f.chainId });
    expect(ref.settleBy).toBe("1790000060");
    expect(ref.transferLog?.digest).toBe(E.ES7.expectIdentity);
  });

  it("the first case's input is viem's encoding of the draft's openWithPermit2 with the payer as from", () => {
    const { args } = decodeFunctionData({ abi: OPEN_WITH_PERMIT2, data: P.cases[0].transaction.input });
    expect([args[0], args[1], args[3], args[4], args[5]]).toEqual([f.recipient, f.usdc, H, ZERO, f.payer]);
  });

  /** A row's transaction; a row with `signatureBytes` takes the first case's call with a signature of that many bytes. */
  const transactionOf = (row: { transaction: EvmTransaction; signatureBytes?: number }): EvmTransaction => {
    if (row.signatureBytes === undefined) return row.transaction;
    const { args } = decodeFunctionData({ abi: OPEN_WITH_PERMIT2, data: P.cases[0].transaction.input });
    const signature = `0x${"11".repeat(row.signatureBytes)}` as Hex;
    const [payee, token, deposit, salt, signer, from, nonce, deadline] = args;
    const input = encodeFunctionData({
      abi: OPEN_WITH_PERMIT2,
      functionName: "openWithPermit2",
      args: [payee, token, deposit, salt, signer, from, nonce, deadline, signature],
    });
    return { ...row.transaction, input };
  };

  // go-ethereum's transaction pool admits a transaction of at most 128 KiB (core/txpool/legacypool/legacypool.go,
  // txMaxSize = 4 * txSlotSize); the read decodes at most that much calldata.
  it("the padded case's calldata is longer than 131,072 bytes", () => {
    const padded = P.cases.find((row: { signatureBytes?: number }) => row.signatureBytes !== undefined);
    expect((transactionOf(padded).input.length - 2) / 2).toBeGreaterThan(131_072);
  });

  for (const row of P.cases) {
    it(row.case, async () => {
      expect(await statusOf(await signedOpening("permit2"), transactionOf(row), row.receipt)).toEqual(row.expect);
    });
  }
});

// `recover` reads the same transactions with no reference: the salt of the transaction's own open call, whichever of
// the draft's three open functions it calls, where the receipt shows the escrow pulling the deposit from the call's
// payer. The calldata is the file's, or viem's encoding of the draft's `openWithAuthorization`.
describe("ES9 recover: the salt of the opening's own open call", () => {
  const refused = (code: string) => ({ refused: true, code });
  const recoverOf = (tx: EvmTransaction | null | "error", receipt?: Receipt) =>
    sessionEvm.recover({ network: `eip155:${f.chainId}`, transaction: R.hash }, reader(tx, receipt));

  it("the hash opening's cases: the open call's salt where the escrow pulled the payer's deposit, else evm/no-open-call", async () => {
    const expected = [
      H, // the payer's open call to the escrow, salt H
      refused("evm/no-open-call"), // a plain transfer
      H2, // the payer's open call whose salt is H2
      refused("evm/no-open-call"), // sent by another account: the deposit pulled is the payer's, not its sender's
      H, // another payee
      refused("evm/no-open-call"), // sent to the token: the deposit went to the escrow, not the called contract
      refused("evm/no-open-call"), // one byte short of the five words
      H, // a data suffix after the arguments
      refused("evm/not-found"), // no transaction
    ];
    expect(R.cases.length).toBe(expected.length);
    for (const [i, row] of R.cases.entries()) expect(await recoverOf(row.transaction), row.case).toEqual(expected[i]);
  });

  it("an opening sent through an ERC-4337 EntryPoint is refused evm/no-open-call, where status leaves it pending", async () => {
    for (const row of R.entryPoint.cases) {
      expect(await recoverOf(row.transaction, row.receipt), row.case).toEqual(refused("evm/no-open-call"));
      expect(row.expect, row.case).toEqual({ state: "pending", why: "open-call-not-found" });
    }
  });

  it("the Permit2 opening: the salt of openWithPermit2, whose payer is its from", async () => {
    const P = R.permit2;
    const OPEN_WITH_PERMIT2 = parseAbi([
      "function openWithPermit2(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner, address from, uint256 nonce, uint256 deadline, bytes signature)",
    ]);
    const first = P.cases[0];
    expect(await recoverOf(first.transaction, first.receipt), first.case).toBe(H);
    const { args } = decodeFunctionData({ abi: OPEN_WITH_PERMIT2, data: first.transaction.input });
    const other = encodeFunctionData({
      abi: OPEN_WITH_PERMIT2,
      functionName: "openWithPermit2",
      args: [args[0], args[1], args[2], args[3], args[4], "0x7777777777777777777777777777777777777777", args[6], args[7], args[8]],
    });
    const fromOther = { ...first.transaction, input: other };
    expect(await recoverOf(fromOther, first.receipt)).toEqual(refused("evm/no-open-call"));
    const plain = P.cases.find((row: { transaction?: EvmTransaction }) => row.transaction?.input.startsWith("0xa9059cbb"));
    expect(await recoverOf(plain.transaction, plain.receipt), plain.case).toEqual(refused("evm/no-open-call"));
    const padded = P.cases.find((row: { signatureBytes?: number }) => row.signatureBytes !== undefined);
    const { args: a } = decodeFunctionData({ abi: OPEN_WITH_PERMIT2, data: first.transaction.input });
    const long = encodeFunctionData({
      abi: OPEN_WITH_PERMIT2,
      functionName: "openWithPermit2",
      args: [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], `0x${"11".repeat(padded.signatureBytes)}`],
    });
    expect(await recoverOf({ ...first.transaction, input: long }, first.receipt), padded.case).toEqual(refused("evm/unreadable"));
  });

  it("the authorization opening: the salt of openWithAuthorization, whose payer is its from", async () => {
    const OPEN_WITH_AUTHORIZATION = parseAbi([
      "function openWithAuthorization(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner, address from, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
    ]);
    const input = encodeFunctionData({
      abi: OPEN_WITH_AUTHORIZATION,
      functionName: "openWithAuthorization",
      args: [f.recipient, f.usdc, BigInt(f.deposit), H, ZERO, f.payer, 0n, 1790000060n, E.ES3.expectNonce, SIGNATURE],
    });
    const relayer = "0x6666666666666666666666666666666666666666" as Hex;
    expect(await recoverOf({ from: relayer, to: f.escrow, input })).toBe(H);
    expect(await recoverOf({ from: relayer, to: f.usdc, input })).toEqual(refused("evm/no-open-call"));
  });

  it("reads the receipt and the transaction: at most two calls, one where the receipt is a revert", async () => {
    const counted = (r: EvmReader) => {
      const seen: string[] = [];
      const c: EvmReader = {
        network: r.network,
        receipt: async (h) => (seen.push("receipt"), r.receipt(h)),
        blockNumber: async (tag) => (seen.push("blockNumber"), r.blockNumber(tag)),
        transaction: async (h) => (seen.push("transaction"), r.transaction(h)),
        call: async (to, data, block) => (seen.push("call"), r.call(to, data, block)),
      };
      return { c, seen };
    };
    const ref = { network: `eip155:${f.chainId}`, transaction: R.hash as Hex };
    const opened = counted(reader(R.cases[0].transaction));
    expect(await sessionEvm.recover(ref, opened.c)).toBe(H);
    expect(opened.seen).toEqual(["receipt", "transaction"]);
    const reverted = counted(reader(R.cases[0].transaction, { ...R.receipt, status: 0 }));
    expect(await sessionEvm.recover(ref, reverted.c)).toEqual(refused("evm/reverted"));
    expect(reverted.seen).toEqual(["receipt"]);
  });

  it("a revert, no receipt, a failed read and a reader for another network", async () => {
    const tx = R.cases[0].transaction;
    expect(await recoverOf(tx, { ...R.receipt, status: 0 })).toEqual(refused("evm/reverted"));
    expect(await recoverOf("error")).toEqual(refused("evm/unreadable"));
    expect(await sessionEvm.recover({ network: `eip155:${f.chainId}`, transaction: `0x${"99".repeat(32)}` }, reader(tx))).toEqual(
      refused("evm/not-found"),
    );
    expect(await sessionEvm.recover({ network: "eip155:1", transaction: R.hash }, reader(tx))).toEqual(refused("evm/wrong-reader"));
    expect(await sessionEvm.recover(null as never, reader(tx))).toEqual(refused("evm/wrong-reader"));
    expect(await recoverOf({ ...tx, to: null })).toEqual(refused("evm/no-open-call"));
  });
});
