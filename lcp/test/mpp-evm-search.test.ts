// The paging and the look-back below the position that the MPP Permit2 charge's read and the EVM session opening's read
// share with the EIP-3009 read (evm-x402.ts `search` and `firstConsumed`), run on a constructed ledger
// (eip155-tempo-mpp-ledger.ts): a page of the search the endpoint answers with a malformed reply, the state below the
// position given that the endpoint does not hold, and a transaction in the block the value was first used at that
// carries the nonce but did not use it. The EIP-3009 call and its events are encoded by viem 2.57.4, an outside encoder,
// over the functions and events FiatTokenV2_2 publishes (circlefin/stablecoin-evm, contracts/v2/EIP3009.sol); Permit2's
// `UnorderedNonceInvalidation(address indexed owner, uint256 word, uint256 mask)` and `nonceBitmap(address, uint256)` as
// Uniswap/permit2 publishes them (src/SignatureTransfer.sol, src/interfaces/ISignatureTransfer.sol).
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError, type Hex } from "../src/evm.js";
import { mppPermit2Status, mppSessionOpeningStatus, type MppEvmStatus } from "../src/internal/mpp-evm-read.js";
import type { EvmQuery } from "../src/internal/evm.js";
import { ledgerReader, type LedgerSpec, type LedgerTx } from "./eip155-tempo-mpp-ledger.js";

const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const PERMIT2_ABI = parseAbi(["event UnorderedNonceInvalidation(address indexed owner, uint256 word, uint256 mask)"]);

const NETWORK = "eip155:84532" as const;
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3" as Hex;
const CURRENCY = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex;
const PAYER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as Hex;
const PAYEE = "0x209693bc6afc0c5328ba36faf03c514ef312287c" as Hex;
const ESCROW = "0x1234567890abcdef1234567890abcdef12345678" as Hex;
const NONCE = `0x${"ab".repeat(31)}05` as Hex;
const DEADLINE = "99999999999";
/** The position given: the search reads from the block after it. */
const AFTER = 10n;
/** The block at which the payer's Permit2 bit for the nonce first reads set. */
const USED_AT = 5n;
const HEADS = { finalized: 40n, safe: 45n, latest: 50n };

const permit2Ref = {
  network: NETWORK,
  payee: PAYEE,
  payer: PAYER,
  authorization: { at: PERMIT2, nonce: NONCE, deadline: DEADLINE },
  presented: { permitted: `${CURRENCY}:1000`, nonce: NONCE, deadline: DEADLINE, owner: PAYER, transfers: `${PAYEE}:1000`, witness: `0x${"77".repeat(32)}` },
};
const openingRef = {
  network: NETWORK,
  payee: PAYEE,
  payer: PAYER,
  opens: { escrow: ESCROW, channel: `0x${"c1".repeat(32)}`, h: `0x${"e1".repeat(32)}`, chainId: 84532 },
  funding: { type: "permit2", token: CURRENCY, at: PERMIT2, nonce: NONCE, deadline: DEADLINE },
  presented: {
    funding: "permit2",
    token: CURRENCY,
    amount: "1000",
    nonce: NONCE,
    deadline: DEADLINE,
    spender: ESCROW,
    owner: PAYER,
    witness: `${PAYEE}:0x${"e1".repeat(32)}:0x0000000000000000000000000000000000000000`,
  },
};

const READS = [
  { id: "mpp/charge/evm/permit2", status: (spec: LedgerSpec, q: EvmQuery<unknown>) => mppPermit2Status(permit2Ref as never, ledgerReader(spec), q) },
  { id: "mpp/session/evm", status: (spec: LedgerSpec, q: EvmQuery<unknown>) => mppSessionOpeningStatus(openingRef as never, ledgerReader(spec), q) },
] as const;

const query: EvmQuery<unknown> = { act: "payment", finality: "finalized", after: AFTER };

/** `nonceBitmap(payer, nonce >> 8)`: the nonce's bit set from block `from`, else no bit. */
function bitmap(from: bigint | undefined): NonNullable<LedgerSpec["call"]> {
  return (_to, data, block) => {
    if (!data.startsWith("0x4fe02b44")) throw new ReaderError("transport", "no such call");
    const set = from !== undefined && block >= from;
    return `0x${(set ? 1n << (BigInt(NONCE) & 0xffn) : 0n).toString(16).padStart(64, "0")}` as Hex;
  };
}

describe.each(READS)("$id: the shared paging and look-back", (r) => {
  it("halves a page only for a range the endpoint refuses: a malformed answer to a page is unparseable", async () => {
    const spec: LedgerSpec = { network: NETWORK, heads: HEADS, txs: [], call: bitmap(undefined), fault: { method: "logs", error: new ReaderError("malformed") } };
    expect(await r.status(spec, query)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
  });

  it("answers history-gap where the endpoint does not hold the state below the position given that the nonce's first use needs", async () => {
    const held = bitmap(USED_AT);
    const call: LedgerSpec["call"] = (to, data, block) => {
      if (block < AFTER) throw new ReaderError("history", "state pruned");
      return held(to, data, block);
    };
    expect(await r.status({ network: NETWORK, heads: HEADS, txs: [], call }, query)).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });
});

describe("mpp/charge/evm/permit2: the look-back below the position", () => {
  // In the block the bit first reads set: the payer's invalidation of the nonce's bit, which used it, and the payer's
  // EIP-3009 use of the same word on the currency, which carries it and used no Permit2 bit.
  const invalidation: LedgerTx = {
    hash: `0x${"a1".repeat(32)}`,
    block: USED_AT,
    status: 1,
    from: PAYER,
    to: PERMIT2,
    input: "0x",
    logs: [
      {
        address: PERMIT2,
        topics: encodeEventTopics({ abi: PERMIT2_ABI, eventName: "UnorderedNonceInvalidation", args: { owner: PAYER } }) as Hex[],
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(NONCE) >> 8n, 1n << (BigInt(NONCE) & 0xffn)]) as Hex,
      },
    ],
  };
  const use: LedgerTx = {
    hash: `0x${"b2".repeat(32)}`,
    block: USED_AT,
    status: 1,
    from: PAYEE,
    to: CURRENCY,
    input: encodeFunctionData({
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [PAYER, PAYEE, 1000n, 0n, BigInt(DEADLINE), NONCE, 27, `0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`],
    }) as Hex,
    logs: [
      { address: CURRENCY, topics: encodeEventTopics({ abi: EIP3009_ABI, eventName: "AuthorizationUsed", args: { authorizer: PAYER, nonce: NONCE } }) as Hex[], data: "0x" },
      {
        address: CURRENCY,
        topics: encodeEventTopics({ abi: EIP3009_ABI, eventName: "Transfer", args: { from: PAYER, to: PAYEE } }) as Hex[],
        data: encodeAbiParameters([{ type: "uint256" }], [1000n]) as Hex,
      },
    ],
  };

  it("keeps only the act that used the value: another act in that block is not read into the answer", async () => {
    const answer: MppEvmStatus = await READS[0].status({ network: NETWORK, heads: HEADS, txs: [invalidation, use], call: bitmap(USED_AT) }, query);
    expect(answer).toEqual({
      state: "failed",
      reason: "before-position",
      transaction: invalidation.hash,
      position: USED_AT,
      finality: "finalized",
      signer: PAYER,
      moved: [],
      foreign: [],
    });
  });
});
