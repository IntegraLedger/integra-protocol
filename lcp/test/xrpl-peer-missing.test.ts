// ripple-binary-codec is an optional peer. With it absent, a blob whose hex and size the package accepts cannot be
// decoded, so a payment or a within input that holds one is `xrpl/peer-missing`. A check that needs no codec comes
// first and gives the code it gives with the codec (peer-free-inputs.test.ts): x402/exact/xrpl's bound and reference
// read the option's invoiceId before the blob, and mpp/session/xrpl's buildWithin checks H, the cumulative amount and
// the action before it decodes the opening.
import { describe, expect, it, vi } from "vitest";
import { xrplPayment, xrplPayments, xrplWithinInputs, xrplWithinValid } from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

vi.mock("ripple-binary-codec", () => {
  throw new Error("Cannot find package 'ripple-binary-codec'");
});
vi.mock("ripple-binary-codec/dist/serdes/binary-parser.js", () => {
  throw new Error("Cannot find package 'ripple-binary-codec'");
});

/** An entry point's first import loads its modules, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;
const refused = (code: string) => ({ refused: true, code });

describe("without ripple-binary-codec", () => {
  it("a payment and a within input the package reads with the codec are xrpl/peer-missing", { timeout: IMPORT_MS }, async () => {
    const { exactXrpl } = await import("../src/x402-exact-xrpl.js");
    const { sessionXrpl } = await import("../src/mpp.js");
    expect(await exactXrpl.bound(xrplPayment() as never)).toEqual(refused("xrpl/peer-missing"));
    expect(await exactXrpl.reference(xrplPayment() as never)).toEqual(refused("xrpl/peer-missing"));
    const { within, h } = xrplWithinValid();
    expect(await sessionXrpl.buildWithin(within as never, h)).toEqual(refused("xrpl/peer-missing"));
  });

  it("x402/exact/xrpl's bound and reference answer an option whose invoiceId is not an LCP string as they do with the codec", { timeout: IMPORT_MS }, async () => {
    const { exactXrpl } = await import("../src/x402-exact-xrpl.js");
    for (const row of rowsOf(xrplPayments(), "peer-free-inputs.ts", { exact: 2 })) {
      expect([row.case, await exactXrpl.bound(row.payment as never), await exactXrpl.reference(row.payment as never)]).toEqual([
        row.case,
        refused("xrpl/carrier-not-lcp"),
        refused("xrpl/carrier-not-lcp"),
      ]);
    }
  });

  it("mpp/session/xrpl's buildWithin answers an H, amount or action it refuses as it does with the codec", { timeout: IMPORT_MS }, async () => {
    const { sessionXrpl } = await import("../src/mpp.js");
    for (const row of rowsOf(xrplWithinInputs(), "peer-free-inputs.ts", { exact: 6 })) {
      expect([row.case, await sessionXrpl.buildWithin(row.within as never, row.h as never)]).toEqual([row.case, refused(row.expect)]);
    }
  });
});
