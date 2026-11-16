// Runs the transactionVersions sections of x402-exact-solana.json, x402-upto-solana.json and
// x402-batch-settlement.json: each Solana build under an option whose extra.transactionVersions is each row's value.
// A row that admits version 0 is built as the file's version-0 message; any other is refused before anything is signed.
// Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/index.js";
import { batchSvm } from "../src/x402-batch-settlement.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
const E = load("x402-exact-solana.json");
const U = load("x402-upto-solana.json");
const B = load("x402-batch-settlement.json");
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const H: AtrHash = E.fixed.H;

interface Row {
  transactionVersions: unknown;
  expect: { messageFirstByte: number; buildMessageSha256: string } | { refused: true; code: string };
}
type Built = { request: { message: Uint8Array } } | { requests: readonly { kind: string; message: Uint8Array }[] };
type Answer = Built | { refused: true; code: string };

/** The option with `extra.transactionVersions` set to `versions`, and a document that offers it alone. */
function offered(option: PaymentRequirements, versions: unknown): { required: PaymentRequired; accepted: PaymentRequirements } {
  const accepted = { ...option, extra: { ...option.extra, transactionVersions: versions } } as PaymentRequirements;
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

const cases: { file: string; rows: Row[]; build: (versions: unknown) => Promise<Answer> }[] = [
  {
    file: "x402-exact-solana.json rows",
    rows: E.transactionVersions.rows,
    build: async (versions) =>
      (await exactSvm.build(
        {
          ...offered(advertisedExact, versions),
          payer: E.fixed.payer,
          decimals: E.fixed.decimals,
          tokenProgram: E.fixed.tokenProgram,
          recentBlockhash: E.fixed.blockhash,
          computeUnitLimit: E.fixed.computeUnitLimit,
          computeUnitPrice: BigInt(E.fixed.computeUnitPrice),
        },
        H,
      )) as Answer,
  },
  {
    file: "x402-upto-solana.json rows",
    rows: U.transactionVersions.rows,
    build: async (versions) =>
      (await uptoSvm.build(
        {
          ...offered(advertisedUpto, versions),
          payer: U.fixed.payer,
          nonce: BigInt(U.fixed.nonce),
          openSlot: BigInt(U.fixed.openSlot),
          now: U.fixed.now,
          tokenProgram: U.fixed.tokenProgram,
          recentBlockhash: U.fixed.blockhash,
        },
        H,
      )) as Answer,
  },
  {
    file: "x402-batch-settlement.json rows",
    rows: B.transactionVersions.rows,
    build: async (versions) =>
      (await batchSvm.build(
        {
          ...offered(B.ES4.accepted, versions),
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
  },
  {
    file: "x402-batch-settlement.json refundRows",
    rows: B.transactionVersions.refundRows,
    build: async (versions) =>
      (await batchSvm.buildWithin(
        {
          ...offered(B.ES4.accepted, versions),
          channelConfig: B.ES4.config,
          maxClaimableAmount: 1000n,
          refund: {},
          recentBlockhash: S.blockhash,
        },
        H,
      )) as Answer,
  },
];

describe.each(cases)("$file", ({ rows, build }) => {
  it("each row is built as the file's version-0 message, or refused svm/version-not-built", async () => {
    for (const row of rowsOf(rows, "transactionVersions rows", { exact: 10 })) {
      expect(shown(await build(row.transactionVersions)), JSON.stringify(row.transactionVersions)).toEqual(row.expect);
    }
  });
});

describe("x402-batch-settlement.json transactionVersions", () => {
  it("a refund without recentBlockhash builds no transaction, and carries the voucher alone under any field", async () => {
    for (const row of rowsOf(B.transactionVersions.refundRows as Row[], "refundRows", { exact: 10 })) {
      const u = await batchSvm.buildWithin(
        { ...offered(B.ES4.accepted, row.transactionVersions), channelConfig: B.ES4.config, maxClaimableAmount: 1000n, refund: {} },
        H,
      );
      if ("refused" in u) throw new Error(u.code);
      expect(u.requests.map((r) => r.kind)).toEqual(["ed25519-raw"]);
    }
  });
});
