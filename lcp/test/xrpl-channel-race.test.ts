// The read of an XRPL channel at coverage `none` (`xrplChannelStatus`, through x402/upto/xrpl's status) when the
// channel's create validates between the read's `server_info` and its `ledger_entry`. The entry then shows the channel
// at a validated ledger later than the one `server_info` stated, and a server whose latest ledger is its validated one,
// as the Binder's reader states it, put the create past the search's end. The read must search to
// the ledger the entry was read at, so it settles on the create rather than answer a final `failed`,
// `before-position`, for a channel the seller is then paid from. Its twin: a channel genuinely created at the position
// still answers `failed`, `before-position`, on the same advancing server.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRefusal } from "../src/index.js";
import { uptoXrpl } from "../src/x402-upto-xrpl.js";
import type { PaymentRequirements } from "../src/x402.js";
import type { XrplLanded } from "../src/xrpl.js";
import { xrplReader } from "./fixtures/xrpl-reader.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-upto-xrpl.json", import.meta.url), "utf8"));
const O = V.fixed.O as PaymentRequirements;
const P = V.fixed.P as Record<string, unknown>;
/** The vector's first status row: the payer's create, the channel shown. */
const ROW = V.status.rows[0] as { channel: string; entry: Record<string, string>; opener: string };
const BLOB = V.status.blobs.create as string;
const HASH = createHash("sha512").update(Buffer.from(`54584E00${BLOB}`, "hex")).digest().subarray(0, 32).toString("hex").toUpperCase();

/**
 * A server at validated ledger 1000, its latest ledger its validated one, on which the create validates in `createdAt`
 * the moment the read asks for the channel's entry: every `server_info` after that call states ledger 1001.
 */
function racing(createdAt: number) {
  let validated = 1000;
  const sent: string[] = [];
  const create: XrplLanded = { hash: HASH, validated: true, ledgerIndex: createdAt, result: "tesSUCCESS", blob: BLOB, createdChannels: [ROW.channel] };
  const reader = xrplReader({
    server: async () => {
      sent.push(`server_info@${validated}`);
      return { validated, latest: validated, completeLedgers: `1-${validated}` };
    },
    channel: async (id) => {
      validated = 1001;
      sent.push("ledger_entry");
      return id === ROW.channel ? (ROW.entry as never) : { notFound: true, ledgerIndex: validated };
    },
    accountTx: async (a, range) => {
      sent.push(`account_tx ${range.min}-${range.max}`);
      const inRange = a === ROW.opener && createdAt >= range.min && createdAt <= range.max && createdAt <= validated;
      return { transactions: inRange ? [create] : [], min: range.min, max: range.max };
    },
  });
  return { reader, sent };
}

async function read(createdAt: number) {
  const presented = { ...P, payload: { ...(P["payload"] as object), channelId: ROW.channel } };
  const ref = await uptoXrpl.reference(presented as never, O);
  if (isRefusal(ref)) throw new Error(ref.code);
  const { reader, sent } = racing(createdAt);
  const answer = await uptoXrpl.status({ ...ref, fromLedger: 951 }, reader, { act: "payment", finality: "validated", after: 950 });
  return { answer, sent };
}

describe("x402/upto/xrpl read: a channel created between server_info and ledger_entry", () => {
  it("searches to the ledger the entry was read at and settles on the create, never a final failed", async () => {
    const { answer, sent } = await read(1001);
    expect(answer).toMatchObject({ state: "settled", transaction: HASH, position: 1001, finality: "validated", presented: "yes" });
    expect(sent).toStrictEqual(["server_info@1000", "ledger_entry", "server_info@1001", "account_tx 951-1001"]);
  });

  it("twin: a channel created at the position, which no search from the ledger after it holds, is failed, before-position", async () => {
    const { answer } = await read(950);
    expect(answer).toStrictEqual({ state: "failed", reason: "before-position", finality: "validated", foreign: [] });
  });

  it("a second server_info behind the first (a balancer's other node) still searches to the first answer's latest", async () => {
    const presented = { ...P, payload: { ...(P["payload"] as object), channelId: ROW.channel } };
    const ref = await uptoXrpl.reference(presented as never, O);
    if (isRefusal(ref)) throw new Error(ref.code);
    const answers = [1001, 1000];
    const ranges: string[] = [];
    const create: XrplLanded = { hash: HASH, validated: true, ledgerIndex: 1001, result: "tesSUCCESS", blob: BLOB, createdChannels: [ROW.channel] };
    const reader = xrplReader({
      server: async () => {
        const v = answers.shift()!;
        return { validated: v, latest: v, completeLedgers: "1-1001" };
      },
      channel: async () => ROW.entry as never,
      accountTx: async (a, range) => {
        ranges.push(`${range.min}-${range.max}`);
        return { transactions: a === ROW.opener && range.max >= 1001 ? [create] : [], min: range.min, max: range.max };
      },
    });
    const answer = await uptoXrpl.status({ ...ref, fromLedger: 951 }, reader, { act: "payment", finality: "validated", after: 950 });
    expect(answer).toMatchObject({ state: "settled", transaction: HASH, position: 1001 });
    expect(ranges).toStrictEqual(["951-1001"]);
  });
});
