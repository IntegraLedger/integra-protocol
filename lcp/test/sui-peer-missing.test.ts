// @mysten/sui is an optional peer. With it absent, the sui module and the package root still
// import, and each function refuses `sui/peer-missing` (the vectors' refusal) only where it decodes a transaction's
// bytes, never throwing; `status` reads as it does with the peer, pending `unreadable` only once it must decode a
// transaction's bytes. build checks H, then reads the choice's document and the option's place in it, and writes its
// request as it does with the peer; its complete decodes the signed transaction as bound does. recover reads the ref,
// the reader and the transaction before it decodes the transaction, and decodeSuiTx reads the bytes' form, size and two
// leading tags before it decodes them, without the peer, as they do with it.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildChoices } from "./build-choices.js";
import { BAD_H, hFirstChoices, SUI_STATUS_POSITION, suiDecodeInputs, suiPeerStepRows, suiRecoverDecodes, suiRecoverReads, suiStatusRows } from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-sui.json", import.meta.url), "utf8"));
const CODE = V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === "sui/peer-missing").expect as string;

vi.mock("@mysten/sui/bcs", () => {
  throw new Error("Cannot find package '@mysten/sui'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without @mysten/sui", () => {
  let root: typeof import("../src/index.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
  }, IMPORT_MS);

  it("the root imports, and every function that decodes a transaction's bytes refuses peer-missing there", { timeout: IMPORT_MS }, async () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/sui");
    const { decodeSuiTx, exactSui } = await import("../src/sui.js");
    const b64 = V.V2.tx.transactionBase64 as string;
    const p = { x402Version: 2, accepted: V.fixed.O, payload: { signature: "AAAA", transaction: b64 } };
    const refused = { refused: true, code: CODE };
    expect(decodeSuiTx(b64)).toEqual(refused);
    expect(await exactSui.bound(p)).toEqual(refused);
    expect(await exactSui.reference(p)).toEqual(refused);
  });

  // peer-free-inputs.test.ts gives every row its answer with the peer: build writes its request without it, and only
  // complete of a transaction that passes decodeSuiTx's form, size and tags reaches the decode.
  it("build and complete answer as with the peer, up to the decode of the signed transaction", { timeout: IMPORT_MS }, async () => {
    const { exactSui } = await import("../src/sui.js");
    const rows = rowsOf(suiPeerStepRows(), "peer-free-inputs.ts", { exact: 6 });
    for (const row of rows) {
      expect([row.case, await row.call(exactSui as never)]).toEqual([row.case, row.without ?? row.expect]);
    }
    expect(rows.filter((row) => row.without !== undefined).map((row) => row.without)).toEqual([CODE]);
  });

  // peer-free-inputs.test.ts gives the same reads with the peer. Only bytes that hash to the digest and pass
  // decodeSuiTx's tags are decoded: without the peer those are pending unreadable after the one read.
  it("status reads as it does with the peer, pending unreadable only where it must decode the bytes", { timeout: IMPORT_MS }, async () => {
    const { exactSui } = await import("../src/sui.js");
    for (const row of rowsOf(suiStatusRows(), "peer-free-inputs.ts", { exact: 13 })) {
      const c = row.reader();
      const got = await exactSui.status(row.ref as never, c.reader as never, SUI_STATUS_POSITION);
      const want = row.without ?? { expect: row.expect, reads: row.reads };
      expect([row.case, got, c.reads()]).toEqual([row.case, want.expect, want.reads]);
    }
  });

  // Each case peer-free-inputs.ts lists gets the code it gets with the peer, after the same reads
  // (peer-free-inputs.test.ts). The vector file's recover rows hold transactions recover cannot decode without the peer.
  it("recover refuses sui/peer-missing only for a transaction it decodes", { timeout: IMPORT_MS }, async () => {
    const { exactSui } = await import("../src/sui.js");
    for (const row of rowsOf(suiRecoverReads(), "peer-free-inputs.ts", { exact: 11 })) {
      const c = row.reader();
      const got = await exactSui.recover(row.ref as never, c.reader as never);
      expect([row.case, got, c.reads()]).toEqual([row.case, { refused: true, code: row.expect }, row.reads]);
    }
    for (const row of rowsOf(suiRecoverDecodes(), "x402-exact-sui.json V4.recover", { exact: 2 })) {
      const c = row.reader();
      expect([row.case, await exactSui.recover(row.ref as never, c.reader as never), c.reads()]).toEqual([row.case, { refused: true, code: CODE }, 1]);
    }
  });

  it("build answers a choice of another pairing's option, or of a document that is not v2, as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { exactSui } = await import("../src/sui.js");
    for (const row of rowsOf(buildChoices(V.fixed.O, V.fixed.resource), "build-choices.ts", { exact: 2 })) {
      expect(await exactSui.build(row.choice as never, V.fixed.H)).toEqual({ refused: true, code: row.expect });
    }
  });

  it("decodeSuiTx answers a form, size or tag it refuses as it does with the peer", { timeout: IMPORT_MS }, async () => {
    const { decodeSuiTx } = await import("../src/sui.js");
    for (const row of rowsOf(suiDecodeInputs(), "peer-free-inputs.ts", { exact: 8 })) {
      expect([row.case, decodeSuiTx(row.base64 as never)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  it("build answers a malformed H as it does with the peer, whatever the choice", { timeout: IMPORT_MS }, async () => {
    const { exactSui } = await import("../src/sui.js");
    for (const row of rowsOf(hFirstChoices(exactSui.id, V.fixed.O), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, await exactSui.build(row.choice as never, BAD_H as never)]).toEqual([row.case, { refused: true, code: "x402/payload-malformed" }]);
    }
  });
});
