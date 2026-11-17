// Runs x402-exact-solana.json's zeroAmount section: an x402/exact/solana option at amount "0", the pairing's floor. The
// stock @x402/svm 2.31.0 exact client is run again and must write the recorded payment byte for byte; lcp's build of the
// same inputs must ask the payer to sign that client's message; read offers the option, and bound gives H.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decompileTransactionMessage, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { exactSvm } from "../src/x402-exact-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { stockExact } from "./stock-svm.js";

const E = JSON.parse(readFileSync(new URL("../vectors/x402-exact-solana.json", import.meta.url), "utf8"));
const Z = E.zeroAmount;
const accepted = Z.presented.accepted as PaymentRequirements;
const required = { x402Version: 2, resource: E.fixed.resource, accepts: [accepted] } as PaymentRequired;
const wire = Uint8Array.from(Buffer.from(Z.presented.payload.transaction, "base64"));
const stockMessage = Uint8Array.from(getTransactionDecoder().decode(wire).messageBytes);

describe("x402-exact-solana.json zeroAmount", () => {
  it("the stock client writes the recorded payment, a version-0 transaction whose TransferChecked moves 0", async () => {
    expect(accepted.amount).toBe("0");
    const { out, asked } = await stockExact(E.fixed.payerSeed, accepted, Z.now);
    expect(asked).toEqual(Z.expectAsked);
    expect(out.payload).toEqual(Z.presented.payload);
    expect(stockMessage[0]).toBe(0x80);
    const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(stockMessage));
    const transfer = message.instructions.find((ix) => ix.programAddress === E.fixed.tokenProgram);
    expect(Buffer.from(transfer!.data!).toString("hex")).toBe("0c000000000000000006");
  });

  it("lcp's build of the same inputs asks the payer to sign the stock client's message, byte for byte", async () => {
    const i = Z.build.input;
    const u = await exactSvm.build(
      { required, accepted, payer: i.payer, decimals: i.decimals, tokenProgram: i.tokenProgram, recentBlockhash: i.recentBlockhash, computeUnitLimit: i.computeUnitLimit, computeUnitPrice: BigInt(i.computeUnitPrice) },
      E.fixed.H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.message).equals(Buffer.from(stockMessage))).toBe(true);
  });

  it("read offers the option, and bound gives H", async () => {
    const { memo: _, ...issuedExtra } = accepted.extra!;
    const issued = { ...accepted, extra: issuedExtra } as PaymentRequirements;
    const placed = exactSvm.advertise({ ...required, accepts: [issued] }, E.fixed.H, E.fixed.link, issued);
    if ("refused" in placed) throw new Error(placed.code);
    const offered = exactSvm.read(placed);
    if ("refused" in offered) throw new Error(offered.code);
    expect(offered.offer.options.map((o) => o.amount)).toEqual(["0"]);
    expect(await exactSvm.bound(Z.presented)).toBe(Z.expectBound);
  });
});
