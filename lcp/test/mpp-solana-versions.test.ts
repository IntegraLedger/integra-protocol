// Runs the transactionVersions sections of mpp-charge-solana.json and mpp-charge-usdc-solana.json: each Solana charge
// build on a challenge whose Solana details hold transactionVersions as each row's value, or none for a row without the
// member. A row that admits version 0 is built as mpp-charge-solana.json's build message; any other is refused before
// anything is signed. Every expected value is the files'.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, type AtrHash, type Json } from "../src/index.js";
import { chargeSolana, chargeUsdcSolana, type MppChallenge } from "../src/mpp.js";
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

/** The challenge of `request`, placed by `pairing` under H and the link. */
function placed(pairing: Pairing, base: MppChallenge, request: unknown, h: AtrHash, link: string): MppChallenge & { id: string } {
  const c = { ...base, request: b64u(canonicalJson(request as Json) as string) };
  const doc = pairing.advertise([c], h, link, c, 0);
  if (!Array.isArray(doc)) throw new Error(doc.code);
  return doc[0] as MppChallenge & { id: string };
}

/** What a build answered, as the rows write it: the refusal, or the first byte and SHA-256 of its message. */
function shown(u: Awaited<ReturnType<Pairing["build"]>>): unknown {
  if ("refused" in u) return { refused: u.refused, code: u.code };
  return { messageFirstByte: u.request.message[0], buildMessageSha256: sha256(u.request.message) };
}

const choice = { payer: SO.fixed.payer, computeUnitLimit: SO.build.computeUnitLimit, computeUnitPrice: BigInt(SO.build.computeUnitPrice) };

const cases: { file: string; rows: Row[]; build: (row: Row) => ReturnType<Pairing["build"]> }[] = [
  {
    file: "mpp-charge-solana.json",
    rows: SO.transactionVersions.rows,
    build: (row) => {
      const r = SO.fixed.request;
      const request = { ...r, methodDetails: withVersions(r.methodDetails, row) };
      const challenge = placed(chargeSolana, SO.challenge, request, SO.fixed.H, SO.fixed.link);
      return chargeSolana.build({ ...choice, challenge }, SO.fixed.H);
    },
  },
  {
    file: "mpp-charge-usdc-solana.json",
    rows: US.transactionVersions.rows,
    build: (row) => {
      const r = US.fixed.request;
      const request = { ...r, methodDetails: { ...r.methodDetails, solana: withVersions(r.methodDetails.solana, row) } };
      const base: MppChallenge = { realm: US.fixed.realm, method: "usdc", intent: "charge", request: "", expires: US.fixed.expires };
      const challenge = placed(chargeUsdcSolana, base, request, US.fixed.H, US.fixed.link);
      return chargeUsdcSolana.build({ ...choice, challenge }, US.fixed.H);
    },
  },
];

describe.each(cases)("$file transactionVersions", ({ file, rows, build }) => {
  it("each row is built as mpp-charge-solana.json's build message, or refused svm/version-not-built", async () => {
    const all = rowsOf(rows, `${file} transactionVersions.rows`, { exact: 11 });
    expect(all.filter((row) => !("transactionVersions" in row))).toHaveLength(1);
    for (const row of all) {
      expect(shown(await build(row)), JSON.stringify(row.transactionVersions)).toEqual(row.expect);
    }
  });
});
