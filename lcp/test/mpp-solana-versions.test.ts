// Runs the transactionVersions sections of mpp-charge-solana.json and mpp-charge-usdc-solana.json: each Solana charge
// build on a challenge whose Solana details hold transactionVersions as each row's value, or none for a row without the
// member. A row that holds 1 is built as version 1, the message @solana/kit writes alone from build's instructions with
// pay-kit's header (test/kit-v1.ts); one that holds 0 alone or none as mpp-charge-solana.json's build message; any other
// is refused by the challenge's checks, pairingsOf and advertise, before the challenge is placed. A version-1 build,
// completed, carries the wire @solana/kit writes for its message and the payer's signature (kitWire). Every expected
// value is the files'.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, type AtrHash, type Json } from "../src/index.js";
import { chargeSolana, chargeUsdcSolana, pairingsOf, type MppChallenge } from "../src/mpp.js";
import { kitV1Message, kitWire } from "./kit-v1.js";
import { b64u, load } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

const SO = load("mpp-charge-solana.json");
const US = load("mpp-charge-usdc-solana.json");
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

interface Row {
  transactionVersions?: unknown;
  expect: { messageFirstByte: number; buildMessageSha256: string } | { refused: true; code: string };
}
type Pairing = typeof chargeSolana | typeof chargeUsdcSolana;

/** The row's Solana details: `details` with `transactionVersions` set to the row's value, or without it. */
function withVersions(details: { [k: string]: Json }, row: Row): { [k: string]: Json } {
  const { transactionVersions: _, ...rest } = details;
  return "transactionVersions" in row ? { ...rest, transactionVersions: row.transactionVersions as Json } : rest;
}

/** The challenge of `request` as issued. */
function issued(base: MppChallenge, request: unknown): MppChallenge {
  return { ...base, request: b64u(canonicalJson(request as Json) as string) };
}

/**
 * The build of `choice` on the challenge of `request`, placed by `pairing` under H and the link; or, where `pairingsOf`
 * refuses the issued challenge, that refusal, which `advertise` must give too.
 */
function built(pairing: Pairing, base: MppChallenge, request: unknown, h: AtrHash, link: string): ReturnType<Pairing["build"]> | { refused: true; code: string } {
  const c = issued(base, request);
  const doc = pairing.advertise([c], h, link, c, 0);
  const named = pairingsOf(c);
  if (!Array.isArray(named)) {
    expect(doc).toEqual(named);
    return { refused: true, code: (named as { code: string }).code };
  }
  if (!Array.isArray(doc)) throw new Error(doc.code);
  return pairing.build({ ...choice, challenge: doc[0] as MppChallenge & { id: string } }, h);
}

/** What a build answered, as the rows write it: the refusal, or the first byte and SHA-256 of its message. */
function shown(u: Awaited<ReturnType<Pairing["build"]>> | { refused: true; code: string }): unknown {
  if ("refused" in u) return { refused: u.refused, code: u.code };
  return { messageFirstByte: u.request.message[0], buildMessageSha256: sha256(u.request.message) };
}

const choice = { payer: SO.fixed.payer, computeUnitLimit: SO.build.computeUnitLimit, computeUnitPrice: BigInt(SO.build.computeUnitPrice) };

/** The version-1 message: build's instructions under pay-kit 86400da's header for build's budget, by @solana/kit alone. */
const V1 = sha256(
  kitV1Message(SO.V2.wireBase64, { computeUnitLimit: 20_000, priorityFeeLamports: 1n, loadedAccountsDataSizeLimit: 67_108_864 }),
);

const cases: { file: string; rows: Row[]; build: (row: Row) => unknown }[] = [
  {
    file: "mpp-charge-solana.json",
    rows: SO.transactionVersions.rows,
    build: (row) => {
      const r = SO.fixed.request;
      const request = { ...r, methodDetails: withVersions(r.methodDetails, row) };
      return built(chargeSolana, SO.challenge, request, SO.fixed.H, SO.fixed.link);
    },
  },
  {
    file: "mpp-charge-usdc-solana.json",
    rows: US.transactionVersions.rows,
    build: (row) => {
      const r = US.fixed.request;
      const request = { ...r, methodDetails: { ...r.methodDetails, solana: withVersions(r.methodDetails.solana, row) } };
      const base: MppChallenge = { realm: US.fixed.realm, method: "usdc", intent: "charge", request: "", expires: US.fixed.expires };
      return built(chargeUsdcSolana, base, request, US.fixed.H, US.fixed.link);
    },
  },
];

describe.each(cases)("$file transactionVersions", ({ file, rows, build }) => {
  it("each row is built as version 1, as build's message, or refused svm/input-malformed before it is placed", async () => {
    const all = rowsOf(rows, `${file} transactionVersions.rows`, { exact: 11 });
    expect(all.filter((row) => !("transactionVersions" in row))).toHaveLength(1);
    for (const row of all) {
      expect(shown(await (build(row) as ReturnType<Pairing["build"]>)), JSON.stringify(row.transactionVersions)).toEqual(row.expect);
    }
  });

  it("the version-1 rows' message is the one @solana/kit writes alone", () => {
    const ones = rows.filter((row) => (row.expect as { messageFirstByte?: number }).messageFirstByte === 129);
    expect(ones).toHaveLength(3);
    for (const row of ones) expect((row.expect as { buildMessageSha256: string }).buildMessageSha256).toBe(V1);
  });

  it("a version-1 build, completed with the payer's signature, carries the wire @solana/kit writes for its message and that signature", async () => {
    const signature = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
    const ones = rows.filter((row) => (row.expect as { messageFirstByte?: number }).messageFirstByte === 129);
    expect(ones.length).toBeGreaterThan(0);
    for (const row of ones) {
      const u = await (build(row) as ReturnType<Pairing["build"]>);
      if ("refused" in u) throw new Error(u.code);
      const out = u.complete(signature);
      if ("refused" in out) throw new Error(out.code);
      const wire = Buffer.from((out.payload as { transaction: string }).transaction, "base64");
      expect(wire.equals(Buffer.from(kitWire(u.request.message, choice.payer, signature))), JSON.stringify(row.transactionVersions)).toBe(true);
    }
  });
});
