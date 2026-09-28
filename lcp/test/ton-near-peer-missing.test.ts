// The TON and NEAR SDKs are optional peers. With them absent, the entry points and the package root still
// import, and each function that needs a peer refuses `<rail>/peer-missing` (the vectors' refusal), never
// throwing; a status that needs one reads as pending `unreadable`, and nothing is read.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

const TVM = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tvm.json", import.meta.url), "utf8"));
const NEAR = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));
const code = (v: { agreedRefusals: { rows: { expect: string }[] } }) =>
  v.agreedRefusals.rows.find((r) => r.expect.endsWith("/peer-missing"))!.expect;

vi.mock("@ton/core", () => {
  throw new Error("Cannot find package '@ton/core'");
});
vi.mock("@near-js/crypto", () => {
  throw new Error("Cannot find package '@near-js/crypto'");
});
vi.mock("@near-js/transactions", () => {
  throw new Error("Cannot find package '@near-js/transactions'");
});
vi.mock("borsh", () => {
  throw new Error("Cannot find package 'borsh'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without the TON and NEAR peers", () => {
  let root: typeof import("../src/index.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
  }, IMPORT_MS);

  it("the root imports with both pairings in BINDINGS", { timeout: IMPORT_MS }, () => {
    const ids = root.BINDINGS.map((b) => b.id);
    expect(ids).toContain("x402/exact/tvm");
    expect(ids).toContain("x402/exact/near");
  });

  it("TON: every function that needs @ton/core refuses tvm/peer-missing", { timeout: IMPORT_MS }, async () => {
    const { exactTvm, lcpComment, pairingOf, tvmCarrier } = await import("../src/tvm.js");
    const refused = { refused: true, code: code(TVM) };
    const O = TVM.fixed.O;
    const doc = { x402Version: 2 as const, resource: TVM.fixed.resource, accepts: [O] };
    expect(lcpComment(TVM.fixed.H)).toEqual(refused);
    expect(tvmCarrier("te6ccgEBAQEAAgAAAA==")).toEqual(refused);
    expect(pairingOf(O)).toBeUndefined();
    expect(exactTvm.advertise(doc, TVM.fixed.H, TVM.fixed.link, O)).toEqual(refused);
    const payment = { x402Version: 2, accepted: O, payload: { settlementBoc: "te6ccgEBAQEAAgAAAA==", asset: O.asset } };
    expect(await exactTvm.bound(payment)).toEqual(refused);
    expect(await exactTvm.reference(payment)).toEqual(refused);
    expect(await exactTvm.build({ required: doc, accepted: O } as never, TVM.fixed.H)).toEqual(refused);
    let calls = 0;
    const reader = new Proxy({ network: "tvm:-3" }, { get: (t, k) => (k in t ? t[k as "network"] : async () => (calls++, null)) });
    expect(await exactTvm.recover({ network: "tvm:-3", transaction: "x" }, reader as never)).toEqual(refused);
    expect(await exactTvm.status({ network: "tvm:-3" } as never, reader as never)).toEqual({ state: "pending", why: "unreadable" });
    expect(calls).toBe(0);
  });

  it("NEAR: every function that needs the NEAR SDK or borsh refuses near/peer-missing", { timeout: IMPORT_MS }, async () => {
    const { exactNear, nearCarrier } = await import("../src/near.js");
    const refused = { refused: true, code: code(NEAR) };
    const O = NEAR.fixed.O;
    const doc = { x402Version: 2 as const, resource: NEAR.fixed.resource, accepts: [O] };
    const sda = NEAR.V2.expectSignedDelegateAction as string;
    expect(nearCarrier(sda)).toEqual(refused);
    const payment = { x402Version: 2, accepted: O, payload: { signedDelegateAction: sda } };
    expect(await exactNear.bound(payment)).toEqual(refused);
    expect(await exactNear.reference(payment)).toEqual(refused);
    expect(await exactNear.build({ required: doc, accepted: O } as never, NEAR.fixed.H)).toEqual(refused);
  });
});
