// @stellar/stellar-sdk is an optional peer, with which the stellar entry point reads and writes a transaction's XDR. With
// it absent, the stellar entry point and the package root still import, and each function whose type carries a refusal
// and needs the XDR refuses `stellar/peer-missing` (the vectors' refusal), never throwing, after every check that needs
// none, each of which gives the code it gives with the peer. Strkeys (`G…`, `C…` and `M…`) are read and written
// without the SDK, so isAccount, isContract, issuedDigest and muxedFor give every input the answer they give with it;
// stellarStatus and stellarLocate read as they do with the SDK, pending unreadable or incomplete only where they must
// decode a transaction.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  muxedForArgs,
  stellarDigestRows,
  stellarEnvelopeInputs,
  stellarEventInputs,
  stellarLocateRows,
  stellarStatusRows,
  stellarStrkeyAnswers,
  stellarStrkeyRows,
} from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
const CODE = V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === "stellar/peer-missing").expect as string;

vi.mock("@stellar/stellar-sdk/base", () => {
  throw new Error("Cannot find package '@stellar/stellar-sdk'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without @stellar/stellar-sdk", () => {
  beforeAll(async () => {
    await import("../src/index.js");
  }, IMPORT_MS);

  it("issuedDigest of the vectors' challenges is the vectors' digest, muxed recipients included", { timeout: IMPORT_MS }, async () => {
    const { issuedDigest } = await import("../src/mpp.js");
    for (const row of rowsOf(stellarDigestRows(), "peer-free-inputs.ts", { exact: 3 })) {
      expect([row.case, await issuedDigest(row.challenge as never)]).toEqual([row.case, row.expect]);
    }
  });

  // The decoders and transferEventTopics read or write XDR, after the strkey; muxedFor writes a strkey alone.
  it("the stellar entry point's decoders refuse peer-missing, and muxedFor answers as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const st = await import("../src/stellar.js");
    const refused = { refused: true, code: CODE };
    expect(st.decodeStellarTx(V.V3.envelope, V.fixed.network)).toEqual(refused);
    expect(st.transferEventTopics(V.fixed.seller)).toEqual(refused);
    expect(st.transferEventTopics(V.fixed.asset)).toEqual(refused);
    expect(st.transferEventOf(V.events.rows[0].topic, V.events.rows[0].value)).toEqual(refused);
    expect(st.muxedFor(V.fixed.seller, V.fixed.H)).toBe(V.V1.M);
  });

  // A base that is not a string and an H that is not a 32-byte hash get the code they get with the SDK
  // (failures-are-values.test.ts).
  it("muxedFor answers a base or H it refuses as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { muxedFor } = await import("../src/stellar.js");
    for (const row of rowsOf(muxedForArgs(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, muxedFor(row.base as never, row.h as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // Each input's network, size, base64, union tags or form is refused before the SDK is needed, with the code it gets
  // with the SDK (peer-free-inputs.test.ts).
  it("the stellar entry point's decoders answer an input they refuse before the SDK as they do with the peer", { timeout: IMPORT_MS }, async () => {
    const st = await import("../src/stellar.js");
    for (const row of rowsOf(stellarEnvelopeInputs(), "peer-free-inputs.ts", { exact: 11 })) {
      expect([row.case, st.decodeStellarTx(row.xdr as never, row.network as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
    expect(st.transferEventTopics(7 as never)).toEqual({ refused: true, code: "stellar/option-malformed" });
    for (const row of rowsOf(stellarStrkeyRows(), "peer-free-inputs.ts", {
      exact: 16,
      keep: ["each strkey that is neither an account nor a contract", (r) => !r.isAccount && !r.isContract],
      leave: ["each account or contract", (r) => r.isAccount || r.isContract],
    })) {
      expect([row.case, st.transferEventTopics(row.s as never)]).toEqual([row.case, { refused: true, code: "stellar/option-malformed" }]);
    }
    for (const row of rowsOf(stellarEventInputs(), "peer-free-inputs.ts", { exact: 5 })) {
      expect([row.case, st.transferEventOf(row.topic as never, row.value as never)]).toEqual([row.case, { refused: true, code: "stellar/event-malformed" }]);
    }
  });

  // peer-free-inputs.test.ts gives the same rows the same answers with the SDK, held to its StrKey.
  it("each strkey through isAccount, isContract and muxedFor, as with the peer", { timeout: IMPORT_MS }, async () => {
    const { isAccount, isContract } = await import("../src/internal/stellar.js");
    const { muxedFor } = await import("../src/stellar.js");
    const f = { isAccount, isContract, muxedFor };
    for (const row of rowsOf(stellarStrkeyRows(), "peer-free-inputs.ts", { exact: 20 })) {
      const { s: _s, member: _member, ...expected } = row;
      expect(await stellarStrkeyAnswers(row, f as never)).toEqual(expected);
    }
  });

  // peer-free-inputs.test.ts gives V5's reads with the SDK. Only a transaction that succeeded is decoded: a named one is
  // pending unreadable after its one read, and a search's candidate leaves the search incomplete, pending with the
  // named transaction's reason, after the same reads.
  it("stellarStatus reads as it does with the peer, pending only where it must decode a transaction", { timeout: IMPORT_MS }, async () => {
    const { stellarStatus } = await import("../src/stellar.js");
    for (const row of rowsOf(stellarStatusRows(), "peer-free-inputs.ts", { exact: 13 })) {
      const c = row.reader();
      const got = await stellarStatus(row.ref as never, c.reader as never);
      const want = row.without ?? { expect: row.expect, reads: row.reads };
      expect([row.case, got, c.reads()]).toEqual([row.case, want.expect, want.reads]);
    }
  });

  // peer-free-inputs.test.ts gives the same searches with the SDK. Only a candidate's transaction that succeeded is
  // decoded: without the SDK that decode refuses stellar/peer-missing, and the search is incomplete after the same calls.
  it("stellarLocate searches as it does with the peer, incomplete only where it must decode a candidate's transaction", { timeout: IMPORT_MS }, async () => {
    const { stellarLocate } = await import("../src/stellar.js");
    for (const row of rowsOf(stellarLocateRows(), "peer-free-inputs.ts", { exact: 13 })) {
      const { reader, calls } = row.reader();
      const got = await stellarLocate(V.V5.ref, reader as never);
      expect([row.case, got, calls()]).toEqual([row.case, row.decodes ? { complete: false } : row.expect, row.calls]);
    }
  });
});
