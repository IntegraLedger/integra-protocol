// @mysten/sui is an optional peer. With it absent, the sui module and the package root still
// import, and each function that needs the peer refuses `sui/peer-missing` (the vectors' refusal), never
// throwing; `status` reads as pending `unreadable`.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-sui.json", import.meta.url), "utf8"));
const CODE = V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === "sui/peer-missing").expect as string;

vi.mock("@mysten/sui/bcs", () => {
  throw new Error("Cannot find package '@mysten/sui'");
});
vi.mock("@mysten/sui/utils", () => {
  throw new Error("Cannot find package '@mysten/sui'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without @mysten/sui", () => {
  let root: typeof import("../src/index.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
  }, IMPORT_MS);

  it("the root imports, and every function that needs the peer refuses peer-missing", { timeout: IMPORT_MS }, async () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/sui");
    const { decodeSuiTx, exactSui } = await import("../src/sui.js");
    const b64 = V.V2.tx.transactionBase64 as string;
    const p = { x402Version: 2, accepted: V.fixed.O, payload: { signature: "AAAA", transaction: b64 } };
    const refused = { refused: true, code: CODE };
    expect(decodeSuiTx(b64)).toEqual(refused);
    expect(await exactSui.bound(p)).toEqual(refused);
    expect(await exactSui.reference(p)).toEqual(refused);
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.O] };
    expect(await exactSui.build({ required, accepted: V.fixed.O }, V.fixed.H)).toEqual(refused);
    let calls = 0;
    const reader = {
      network: "sui:testnet" as const,
      async read() {
        calls++;
        return { tx: null, epoch: 1n };
      },
    };
    expect(await exactSui.recover({ network: "sui:testnet", digest: V.V2.tx.digest }, reader)).toEqual(refused);
    expect(await exactSui.status({ ...V.V4.ref }, reader)).toEqual({ state: "pending", why: "unreadable" });
    expect(calls).toBe(0);
  });
});
