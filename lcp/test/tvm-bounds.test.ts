// The TON pairing's BoC bounds: at most 512 cells and a depth of at most 32, so a settlement that carries an undeployed
// W5 wallet's state init is read. x402's TON scheme supports payers in the `uninit` and `nonexist` states, whose first
// payment carries the wallet's state init. The W5 code is the published build (fixtures/w5r1-code.json); its data cell
// is the layout in the W5 specification: is_signature_allowed:(## 1) seqno:# wallet_id:(## 32) public_key:(## 256)
// extensions_dict:(HashmapE 256 int1).
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { beginCell, Cell, storeStateInit } from "@ton/core";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/core.js";
import { exactTvm, type TvmPayment } from "../src/tvm.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-tvm.json", import.meta.url), "utf8"));
const W5 = JSON.parse(readFileSync(new URL("./fixtures/w5r1-code.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const placed: PaymentRequirements = V.fixed.placed;
const seed = Uint8Array.from(Buffer.from(V.fixed.seedHex, "hex"));
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [placed] };
const payment = (settlementBoc: string): TvmPayment => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted: placed,
  payload: { settlementBoc, asset: placed.asset },
});
const b64 = (c: Cell) => c.toBoc({ idx: false, crc32: true }).toString("base64");

function distinctCells(root: Cell): number {
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const c = stack.pop()!;
    const k = c.hash().toString("hex");
    if (seen.has(k)) continue;
    seen.add(k);
    stack.push(...c.refs);
  }
  return seen.size;
}

/** `n` distinct cells as a tree of at most four references per cell; each cell's 16 data bits are its own number. */
function treeOf(n: number, next = { i: 0 }): Cell {
  const b = beginCell().storeUint(next.i++, 16);
  let rest = n - 1;
  for (let k = Math.min(4, rest); k > 0; k--) {
    const share = Math.ceil(rest / k);
    b.storeRef(treeOf(share, next));
    rest -= share;
  }
  return b.endCell();
}

/** A chain of cells whose root has depth `d`. */
function chainOf(d: number): Cell {
  let c = beginCell().storeUint(0, 8).endCell();
  for (let i = 1; i <= d; i++) c = beginCell().storeUint(i, 8).storeRef(c).endCell();
  return c;
}

describe("the TON BoC bounds: 512 cells, depth 32", () => {
  const code = Cell.fromHex(W5.hex);
  const publicKey = Buffer.from(V.fixed.publicKey, "hex");
  const data = beginCell().storeBit(1).storeUint(0, 32).storeUint(V.fixed.walletId, 32).storeBuffer(publicKey).storeBit(0).endCell();
  const stateInit = beginCell().store(storeStateInit({ code, data })).endCell();

  it("the fixture is the published W5 code", () => {
    expect(code.hash().toString("hex")).toBe(W5.hash);
  });

  it("an undeployed W5 wallet's first payment is built, and bound reads H from it", async () => {
    const u = await exactTvm.build(
      {
        required,
        accepted: placed,
        wallet: V.fixed.wallet,
        walletId: V.fixed.walletId,
        seqno: 0,
        jettonWallet: V.fixed.jettonWallet,
        attachNanotons: BigInt(V.fixed.attachNanotons),
        now: V.fixed.now,
        stateInit: b64(stateInit),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete(ed25519.sign(u.request.hash, seed)) as TvmPayment;
    const root = Cell.fromBase64(p.payload.settlementBoc);
    expect(distinctCells(root)).toBeGreaterThan(16);
    expect(distinctCells(root)).toBeLessThanOrEqual(512);
    expect(await exactTvm.bound(p)).toBe(H);
  });

  it("513 cells is tvm/boc-too-large; 512 cells is within the bound", async () => {
    const at = treeOf(512);
    const over = treeOf(513);
    expect([distinctCells(at), distinctCells(over)]).toEqual([512, 513]);
    expect(await exactTvm.bound(payment(b64(over)))).toEqual({ refused: true, code: "tvm/boc-too-large" });
    expect(await exactTvm.bound(payment(b64(at)))).not.toEqual({ refused: true, code: "tvm/boc-too-large" });
  });

  it("depth 33 is tvm/boc-too-large; depth 32 is within the bound", async () => {
    expect([chainOf(32).depth(), chainOf(33).depth()]).toEqual([32, 33]);
    expect(await exactTvm.bound(payment(b64(chainOf(33))))).toEqual({ refused: true, code: "tvm/boc-too-large" });
    expect(await exactTvm.bound(payment(b64(chainOf(32))))).not.toEqual({ refused: true, code: "tvm/boc-too-large" });
  });
});
