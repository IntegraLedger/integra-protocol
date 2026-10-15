// @solana/kit is an optional peer, with which the Solana pairings write a message. With it absent, the mpp entry point
// still imports, and mpp/charge/solana's build refuses `svm/peer-missing` only where the kit writes the message, after
// every input's form is checked, each of which gives the code it gives with the kit (peer-free-inputs.test.ts): a
// blockhash the choice gives, for a native SOL request as for a token one, is read as a key without the kit.
import { describe, expect, it, vi } from "vitest";
import { solanaChargeBlockhashRows } from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

vi.mock("@solana/kit", () => {
  throw new Error("Cannot find package '@solana/kit'");
});

/** An entry point's first import loads its modules, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without @solana/kit", () => {
  it("mpp/charge/solana's build answers a blockhash that is not a key as it does with the kit", { timeout: IMPORT_MS }, async () => {
    const { chargeSolana } = await import("../src/mpp.js");
    const rows = rowsOf(solanaChargeBlockhashRows(), "peer-free-inputs.ts", { exact: 4 });
    for (const row of rows) {
      expect([row.case, await row.call(chargeSolana as never)]).toEqual([row.case, row.without ?? row.expect]);
    }
    expect(rows.filter((row) => row.without !== undefined).map((row) => row.without)).toEqual(["svm/peer-missing"]);
  });
});
