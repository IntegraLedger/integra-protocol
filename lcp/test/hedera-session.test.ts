// Runs mpp/session/hedera/stock through its codec: the challenge check, the resume, bound, reference, broadcaster and
// the read of HS7's rows (mpp-session-hedera-solana-xrpl.json). Every expected value is the file's or names its source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pairingsOf, sessionHederaStock, sessionResume, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { hederaStockStatus, type HederaStockReader, type HederaStockRef } from "../src/hedera-session.js";
import type { EvmReceipt } from "../src/internal/evm.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const request = (r: object): string => b64(r);

/** SS1's hedera challenge as issued, and as placed. */
const ISSUED: MppChallenge = V.SS1.hedera.challenge;
const PLACED: MppChallenge = V.SS1.hedera.placed;

interface Row {
  case: string;
  reference: HederaStockRef;
  query?: { after?: string };
  relay: {
    receipt: (Omit<EvmReceipt, "blockNumber"> & { blockNumber: string }) | null | "reader-error";
    transaction?: { to: string | null; input: string } | null;
  };
  mirror: { accounts: Record<string, string>; contractResult?: { result: string } | null; oldestBlock: string };
  expect: unknown;
}

/**
 * A reader answering a row: the relay's receipt, the mirror's accounts by address, the `result` of its contract result
 * for the hash (null for its 404; a row that gives none fails its read), and its oldest block.
 */
function readerOf(row: Row, network = "hedera:testnet"): HederaStockReader {
  return {
    network: network as HederaStockReader["network"],
    receipt: async () => {
      const r = row.relay.receipt;
      if (r === "reader-error") throw new Error("transport");
      return r === null ? null : { ...r, blockNumber: BigInt(r.blockNumber) };
    },
    transaction: async () => (row.relay.transaction ?? null) as never,
    account: async (address) => row.mirror.accounts[address.toLowerCase()] ?? null,
    contractResult: async () => {
      const c = row.mirror.contractResult;
      if (c === undefined) throw new Error("the row gives no contract result");
      return c === null ? null : c.result;
    },
    oldestBlock: async () => (row.mirror.oldestBlock === "archival" ? "archival" : BigInt(row.mirror.oldestBlock)),
  };
}

/** The answer with its block numbers in decimal, as the file writes them. */
const plain = (a: unknown): unknown => JSON.parse(JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

const asked = (row: Row) => ({
  act: "payment" as const,
  finality: "finalized" as const,
  ...(row.query?.after === undefined ? {} : { after: BigInt(row.query.after) }),
});

describe("mpp/session/hedera/stock", () => {
  it("pairingsOf names the stock session for a Hedera session challenge, and refuses one that names a channel", () => {
    expect(pairingsOf(ISSUED)).toEqual(["mpp/session/hedera/stock"]);
    const named = { ...ISSUED, request: request({ ...JSON.parse(Buffer.from(ISSUED.request, "base64url").toString()), methodDetails: { chainId: 296, escrowContract: V.fixed.escrow, channelId: V.HS1.expectChannelId } }) };
    expect(pairingsOf(named)).toEqual({ refused: true, code: "mpp/channel-named" });
    const chain = { ...ISSUED, request: request({ ...JSON.parse(Buffer.from(ISSUED.request, "base64url").toString()), methodDetails: { chainId: 297, escrowContract: V.fixed.escrow } }) };
    expect(pairingsOf(chain)).toEqual({ refused: true, code: "mpp/request-malformed" });
  });

  it("sessionResume reads methodDetails.channelId, lowercase, and null where none is named", () => {
    expect(sessionResume(ISSUED)).toBeNull();
    const r = JSON.parse(Buffer.from(ISSUED.request, "base64url").toString());
    const named = { ...ISSUED, request: request({ ...r, methodDetails: { ...r.methodDetails, channelId: V.HS1.expectChannelId.toUpperCase().replace("0X", "0x") } }) };
    expect(sessionResume(named)).toEqual({ network: "hedera:testnet", channel: V.HS1.expectChannelId.toLowerCase() });
    const bad = { ...ISSUED, request: request({ ...r, methodDetails: { ...r.methodDetails, channelId: "0x12" } }) };
    expect(sessionResume(bad)).toEqual({ refused: true, code: "mpp/request-malformed" });
  });

  const opening = { challenge: PLACED as MppCredential["challenge"], payload: { action: "open", channelId: V.HS3.log.topics[1], txHash: V.HS7.rows[0].reference.transaction, cumulativeAmount: "0", signature: "0x22" } };

  it("bound finds no signed place for H; reference gives the opening's read keys; broadcaster names who sends each action", async () => {
    expect(await sessionHederaStock.bound(opening)).toEqual({ refused: true, code: "mpp/no-signed-place" });
    expect(await sessionHederaStock.reference(opening, ISSUED)).toEqual(V.HS7.rows[0].reference);
    expect(await sessionHederaStock.reference({ ...opening, payload: { ...opening.payload, txHash: "0x12" } }, ISSUED)).toEqual({
      refused: true,
      code: "mpp/credential-malformed",
    });
    expect(await sessionHederaStock.broadcaster(opening)).toBe("payer");
    expect(await sessionHederaStock.broadcaster({ ...opening, payload: { ...opening.payload, action: "topUp" } })).toBe("payer");
    expect(await sessionHederaStock.broadcaster({ ...opening, payload: { ...opening.payload, action: "voucher" } })).toBe("payee");
    expect(await sessionHederaStock.broadcaster({ ...opening, payload: { ...opening.payload, action: "close" } })).toBe("payee");
    expect(await sessionHederaStock.broadcaster({ ...opening, payload: { ...opening.payload, action: "use" } })).toEqual({
      refused: true,
      code: "mpp/session-action",
    });
    expect(await sessionHederaStock.channel.ref(opening)).toEqual({ network: "hedera:testnet", channel: V.HS3.log.topics[1] });
  });

  it("reference takes the challenge the credential echoes, as issued or as placed, and refuses another as the option", async () => {
    expect(await sessionHederaStock.reference(opening, PLACED)).toEqual(V.HS7.rows[0].reference);
    const r = JSON.parse(Buffer.from(ISSUED.request, "base64url").toString());
    const other = { ...ISSUED, request: request({ ...r, recipient: "0x00000000000000000000000000000000000017cf" }) };
    expect(await sessionHederaStock.reference(opening, other)).toEqual({ refused: true, code: "mpp/challenge-not-option" });
    expect(await sessionHederaStock.reference(opening, { realm: ISSUED.realm } as never)).toEqual({
      refused: true,
      code: "mpp/challenge-malformed",
    });
  });

  for (const row of rowsOf(V.HS7.rows as Row[], "mpp-session-hedera-solana-xrpl.json HS7.rows")) {
    it(`HS7: ${row.case}`, async () => {
      expect(plain(await hederaStockStatus(row.reference, readerOf(row), asked(row)))).toEqual(row.expect);
    });
  }

  it("a reader for another network is chain-mismatch, and a query at another mark unparseable, with nothing read", async () => {
    const row = V.HS7.rows[0] as Row;
    expect(await hederaStockStatus(row.reference, readerOf(row, "hedera:mainnet"), asked(row))).toEqual({
      state: "unreadable",
      reason: "chain-mismatch",
      foreign: [],
    });
    expect(await hederaStockStatus(row.reference, readerOf(row), { act: "payment", finality: "latest" } as never)).toEqual({
      state: "unreadable",
      reason: "unparseable",
      foreign: [],
    });
  });
});
