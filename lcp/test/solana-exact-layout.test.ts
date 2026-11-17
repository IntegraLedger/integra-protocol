// Runs x402-exact-solana.json's instructionLayout section: the stock exact client's transactions, each with one
// instruction changed by @solana/kit 8.4.0 alone (the message decoded and decompiled, the instruction list changed,
// compiled and encoded again, every signature slot zero), held to the instruction layout of @x402/svm 2.31.0's exact
// facilitator: bound refuses a Memo v4 instruction and, in a version-1 message, a Compute Budget instruction
// (svm/instruction-not-admitted), and binds the stock transactions as written.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  address,
  compileTransactionMessage,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  type Instruction,
} from "@solana/kit";
import { exactSvm } from "../src/x402-exact-solana.js";
import { rowsOf } from "./rows.js";

const E = JSON.parse(readFileSync(new URL("../vectors/x402-exact-solana.json", import.meta.url), "utf8"));
const L = E.instructionLayout;
const MEMO_V3 = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const MEMO_V4 = "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

/** The base wires the rows change: the stock version-1 payment and the stock version-0 payment. */
const BASE: Record<string, { wire: string; accepted: unknown }> = {
  transactionV1: { wire: E.transactionV1.presented.payload.transaction, accepted: E.transactionV1.presented.accepted },
  zeroAmount: { wire: E.zeroAmount.presented.payload.transaction, accepted: E.zeroAmount.presented.accepted },
};

/** What a row does to the instruction list. */
function changed(change: string, ixs: readonly Instruction[]): Instruction[] {
  if (change === "none") return [...ixs];
  if (change === "memo-v4") return ixs.map((ix) => (ix.programAddress === MEMO_V3 ? { ...ix, programAddress: address(MEMO_V4) } : ix));
  if (change === "compute-unit-limit-first") {
    return [{ programAddress: address(COMPUTE_BUDGET), data: Uint8Array.of(2, 0x20, 0x4e, 0, 0) }, ...ixs];
  }
  throw new Error(change);
}

/**
 * The base wire with the row's change, by @solana/kit alone, every signature slot zero: for a version-1 message the
 * message, then the slots (SIMD-0385); otherwise the signature count, the slots, then the message.
 */
function wireOf(base: string, change: string): string {
  const wire = Uint8Array.from(Buffer.from(base, "base64"));
  const decoded = getTransactionDecoder().decode(wire);
  const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(decoded.messageBytes));
  const next = { ...message, instructions: changed(change, message.instructions) } as typeof message;
  const bytes = Uint8Array.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(next)));
  const signers = Object.keys(decoded.signatures).length;
  if (bytes[0] === 0x81) return Buffer.from([...bytes, ...new Uint8Array(64 * signers)]).toString("base64");
  const out = new Uint8Array(1 + 64 * signers + bytes.length);
  out[0] = signers;
  out.set(bytes, 1 + 64 * signers);
  return Buffer.from(out).toString("base64");
}

describe("x402-exact-solana.json instructionLayout", () => {
  it.each(rowsOf(L.rows as { case: string; base: string; change: string; wireBase64: string; expect: unknown }[], "instructionLayout.rows", { exact: 5 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, row) => {
      expect(wireOf(BASE[row.base]!.wire, row.change)).toBe(row.wireBase64);
      const presented = { x402Version: 2, accepted: BASE[row.base]!.accepted, payload: { transaction: row.wireBase64 } };
      expect(await exactSvm.bound(presented)).toEqual(row.expect);
    },
  );
});
