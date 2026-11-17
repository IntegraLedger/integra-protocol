// Runs the transactionVersions sections of x402-exact-solana.json, x402-upto-solana.json and
// x402-batch-settlement.json: each Solana build under an option whose extra.transactionVersions is each row's value, or
// absent. A row that holds 1 is built as version 1, one that holds 0 alone or none as version 0, and any other is
// refused by the option filter before anything is signed, by advertise as by build. The version-1 opening is the stock
// client's (transactionV1.messageSha256), and the version-1 request_close the message @solana/kit writes alone
// (test/kit-v1.ts). A version-1 request_close, completed, is the wire @solana/kit writes for that message and the
// payer's signature (kitWire). Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/index.js";
import { batchSvm } from "../src/x402-batch-settlement.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { base58 } from "@scure/base";
import { kitV1Message, kitWire } from "./kit-v1.js";
import { rowsOf } from "./rows.js";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
const E = load("x402-exact-solana.json");
const U = load("x402-upto-solana.json");
const B = load("x402-batch-settlement.json");
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const H: AtrHash = E.fixed.H;

interface Row {
  transactionVersions?: unknown;
  expect: { messageFirstByte: number; buildMessageSha256: string } | { refused: true; code: string };
}
type Built = { request: { message: Uint8Array } } | { requests: readonly { kind: string; message: Uint8Array }[] };
type Answer = Built | { refused: true; code: string };

/** The option with `extra.transactionVersions` as the row has it, and a document that offers it alone. */
function offered(option: PaymentRequirements, row: Row): { required: PaymentRequired; accepted: PaymentRequirements } {
  const { transactionVersions: _, ...extra } = option.extra ?? {};
  const versions = "transactionVersions" in row ? { transactionVersions: row.transactionVersions } : {};
  const accepted = { ...option, extra: { ...extra, ...versions } } as PaymentRequirements;
  return { required: { x402Version: 2, resource: E.fixed.resource, accepts: [accepted] } as PaymentRequired, accepted };
}

/** What a build answered, as the rows write it: the refusal, or the first byte and SHA-256 of its Solana message. */
function shown(a: Answer): unknown {
  if ("refused" in a) return { refused: a.refused, code: a.code };
  const message = "request" in a ? a.request.message : a.requests.find((r) => r.kind === "solana-message")!.message;
  return { messageFirstByte: message[0], buildMessageSha256: sha256(message) };
}

const advertisedExact = (exactSvm.advertise({ x402Version: 2, resource: E.fixed.resource, accepts: [E.fixed.option] }, H, E.fixed.link, E.fixed.option) as PaymentRequired).accepts[0]!;
const advertisedUpto = (uptoSvm.advertise({ x402Version: 2, resource: U.fixed.resource, accepts: [U.fixed.option] }, H, U.fixed.link, U.fixed.option) as PaymentRequired).accepts[0]!;
const S = B.fixed.svm;

const cases: { file: string; rows: Row[]; build: (row: Row) => Promise<Answer>; v1: string; advertise: (row: Row) => unknown }[] = [
  {
    file: "x402-exact-solana.json rows",
    rows: E.transactionVersions.rows,
    build: async (row) =>
      (await exactSvm.build(
        {
          ...offered(advertisedExact, row),
          payer: E.fixed.payer,
          decimals: E.fixed.decimals,
          tokenProgram: E.fixed.tokenProgram,
          recentBlockhash: E.fixed.blockhash,
          computeUnitLimit: E.fixed.computeUnitLimit,
          computeUnitPrice: BigInt(E.fixed.computeUnitPrice),
        },
        H,
      )) as Answer,
    v1: E.transactionV1.messageSha256.slice(2),
    advertise: (row) => {
      const { required, accepted } = offered(E.fixed.option, row);
      return exactSvm.advertise(required, H, E.fixed.link, accepted);
    },
  },
  {
    file: "x402-upto-solana.json rows",
    rows: U.transactionVersions.rows,
    build: async (row) =>
      (await uptoSvm.build(
        {
          ...offered(advertisedUpto, row),
          payer: U.fixed.payer,
          nonce: BigInt(U.fixed.nonce),
          openSlot: BigInt(U.fixed.openSlot),
          now: U.fixed.now,
          tokenProgram: U.fixed.tokenProgram,
          recentBlockhash: U.fixed.blockhash,
        },
        H,
      )) as Answer,
    v1: U.transactionV1.messageSha256.slice(2),
    advertise: (row) => {
      const { required, accepted } = offered(U.fixed.option, row);
      return uptoSvm.advertise(required, H, U.fixed.link, accepted);
    },
  },
  {
    file: "x402-batch-settlement.json rows",
    rows: B.transactionVersions.rows,
    build: async (row) =>
      (await batchSvm.build(
        {
          ...offered(B.ES4.accepted, row),
          payer: S.payer,
          payerAuthorizer: S.payer,
          deposit: BigInt(S.deposit),
          salt: 42n,
          openSlot: BigInt(S.openSlot),
          tokenProgram: S.tokenProgram,
          recentBlockhash: S.blockhash,
        },
        H,
      )) as Answer,
    v1: B.transactionV1.messageSha256.slice(2),
    advertise: (row) => {
      const { required, accepted } = offered(B.ES4.accepted, row);
      return batchSvm.advertise(required, H, E.fixed.link, accepted);
    },
  },
  {
    file: "x402-batch-settlement.json refundRows",
    rows: B.transactionVersions.refundRows,
    build: async (row) =>
      (await batchSvm.buildWithin(
        {
          ...offered(B.ES4.accepted, row),
          channelConfig: B.ES4.config,
          maxClaimableAmount: 1000n,
          refund: {},
          recentBlockhash: S.blockhash,
        },
        H,
      )) as Answer,
    v1: sha256(kitV1Message(B.ES4.closeWireBase64, { computeUnitLimit: 200_000, priorityFeeLamports: 1n, loadedAccountsDataSizeLimit: 4_194_304 })),
    advertise: (row) => {
      const { required, accepted } = offered(B.ES4.accepted, row);
      return batchSvm.advertise(required, H, E.fixed.link, accepted);
    },
  },
];

describe.each(cases)("$file", ({ rows, build, v1, advertise }) => {
  it("each row is built as version 1, as the file's version-0 message, or refused x402/option-malformed", async () => {
    const all = rowsOf(rows, "transactionVersions rows", { exact: 11 });
    expect(all.filter((row) => !("transactionVersions" in row))).toHaveLength(1);
    for (const row of all) {
      expect(shown(await build(row)), JSON.stringify(row.transactionVersions)).toEqual(row.expect);
    }
  });

  it("the version-1 rows' message is the oracle's: the stock client's, or @solana/kit's alone", () => {
    const ones = rows.filter((row) => (row.expect as { messageFirstByte?: number }).messageFirstByte === 129);
    expect(ones).toHaveLength(3);
    for (const row of ones) expect((row.expect as { buildMessageSha256: string }).buildMessageSha256).toBe(v1);
  });

  it("advertise refuses each row build refuses, with the same code", () => {
    for (const row of rows) {
      const placed = advertise(row) as { refused?: true; code?: string };
      if ("refused" in row.expect) expect({ refused: placed.refused, code: placed.code }, JSON.stringify(row)).toEqual(row.expect);
      else expect(placed.refused, JSON.stringify(row)).toBeUndefined();
    }
  });
});

describe("x402-batch-settlement.json transactionVersions", () => {
  it("a refund without recentBlockhash builds no transaction, and carries the voucher alone under every field the filter admits", async () => {
    for (const row of rowsOf(B.transactionVersions.refundRows as Row[], "refundRows", { exact: 11 })) {
      const u = await batchSvm.buildWithin(
        { ...offered(B.ES4.accepted, row), channelConfig: B.ES4.config, maxClaimableAmount: 1000n, refund: {} },
        H,
      );
      if ("refused" in row.expect) {
        expect(u, JSON.stringify(row)).toEqual(row.expect);
        continue;
      }
      if ("refused" in u) throw new Error(u.code);
      expect(u.requests.map((r) => r.kind)).toEqual(["ed25519-raw"]);
    }
  });

  it("a version-1 refund, completed with the payer's signature, carries the wire @solana/kit writes for its message and that signature", async () => {
    const txSig = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
    const voucherSig = Uint8Array.from({ length: 64 }, (_, i) => 64 - i);
    const ones = (B.transactionVersions.refundRows as Row[]).filter((row) => (row.expect as { messageFirstByte?: number }).messageFirstByte === 129);
    expect(ones.length).toBeGreaterThan(0);
    for (const row of ones) {
      const u = await batchSvm.buildWithin(
        { ...offered(B.ES4.accepted, row), channelConfig: B.ES4.config, maxClaimableAmount: 1000n, refund: {}, recentBlockhash: S.blockhash },
        H,
      );
      if ("refused" in u) throw new Error(u.code);
      const message = u.requests.find((r) => r.kind === "solana-message")!.message;
      const out = u.complete([base58.encode(txSig), base58.encode(voucherSig)]);
      if ("refused" in out) throw new Error(out.code);
      const wire = Buffer.from(out.payload["transaction"] as string, "base64");
      expect(wire.equals(Buffer.from(kitWire(message, B.ES4.config.payer, txSig))), JSON.stringify(row.transactionVersions)).toBe(true);
    }
  });
});
