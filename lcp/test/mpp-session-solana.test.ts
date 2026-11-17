// Runs mpp-session-solana.json through the mpp entry point. Every expected value is the vector file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { AtrHash } from "../src/index.js";
import { FETCHED, pairingsOf, sessionResume, sessionSolanaMemo, sessionSolanaStock, type MppChallenge, type MppCredential } from "../src/mpp.js";
import type { SvmReader } from "../src/svm.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-session-solana.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const at = (pointer: string): unknown =>
  pointer.split("/").slice(1).reduce((v: unknown, k: string) => (v as Record<string, unknown>)[k], V as unknown);
const memoCredential = at(V.memo.credential) as MppCredential;
const placedMemo = memoCredential.challenge;
const refused = (code: string) => ({ refused: true, code });
const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

describe("mpp-session-solana.json", () => {
  it("readings: pairingsOf names the memo session only under the server-submits challenge", () => {
    for (const row of rowsOf(V.readings.rows, "mpp-session-solana.json readings", { exact: 9 })) {
      expect(pairingsOf(row.challenge), row.case).toEqual(row.expect);
    }
  });

  it("memo: build composes the stock open and the Memo, states its size, and complete gives the credential", async () => {
    const c = V.memo.choice;
    const u = await sessionSolanaMemo.build({ challenge: placedMemo, payer: c.payer, authorizedSigner: c.authorizedSigner, salt: BigInt(c.salt), gracePeriod: c.gracePeriod }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.message).toString("base64")).toBe(V.memo.expectMessageBase64);
    expect([u.request.size, u.request.channel]).toEqual([V.memo.expectSize, V.memo.expectChannel]);
    const signature = ed25519.sign(u.request.message, new Uint8Array(32).fill(1));
    expect(u.complete(signature)).toEqual(memoCredential);
    expect(memoCredential.payload["transaction"]).toBe(V.memo.expectWireBase64);
    expect(await sessionSolanaMemo.build({ challenge: placedMemo, payer: V.fixed.operator, authorizedSigner: c.authorizedSigner, salt: 1n }, H)).toEqual(
      refused("svm/open-not-operator"),
    );
    expect(V.memo.eightSplitsSize).toBeLessThanOrEqual(1232);
  });

  it("memo: bound, reference, broadcaster and the channel read the opening", async () => {
    expect(await sessionSolanaMemo.bound(memoCredential)).toBe(V.memo.expectBound);
    const ref = await sessionSolanaMemo.reference(memoCredential, placedMemo);
    if ("refused" in ref) throw new Error(ref.code);
    expect([ref.feePayer, ref.payer, ref.payee]).toEqual([V.memo.expectReferenceFeePayer, V.memo.expectPayer, V.memo.expectReferencePayee]);
    expect(await sessionSolanaMemo.broadcaster(memoCredential)).toBe("payee");
    expect(sessionSolanaMemo.channel.kind(memoCredential)).toBe("open");
    expect(await sessionSolanaMemo.channel.ref(memoCredential)).toEqual({ network: DEVNET, channel: V.memo.expectChannel });
    expect(sessionResume(placedMemo)).toBeNull();
  });

  it("memo refusals: no transaction, no memo, not an opening", async () => {
    for (const row of rowsOf(V.memoRefusals, "mpp-session-solana.json memoRefusals", { exact: 3 })) {
      const payload: Record<string, unknown> = row.payload ?? { ...memoCredential.payload, ...(row.transaction ? { transaction: row.transaction } : {}) };
      if (row.drop) delete payload[row.drop];
      expect(await sessionSolanaMemo.bound({ ...memoCredential, payload } as MppCredential), row.case).toEqual(refused(row.expect));
    }
  });

  it("stock: the opening the payer broadcast, read by its signature", async () => {
    const S = V.stock;
    const reader = {
      network: DEVNET,
      transaction: async (signature: string, commitment: string) =>
        signature === S.expectTransaction && commitment === "finalized" ? { slot: "1", err: null, wire: Uint8Array.from(Buffer.from(S.landedWireBase64, "base64")) } : null,
    } as unknown as SvmReader;
    expect(await sessionSolanaStock.bound(S.credential)).toEqual(refused("mpp/no-signed-place"));
    expect(await sessionSolanaStock.reference(S.credential, S.credential.challenge)).toEqual(refused("svm/read-first"));
    const held = await sessionSolanaStock.fetchPresented(S.credential, reader);
    if ("refused" in held) throw new Error(held.code);
    expect((held as unknown as Record<PropertyKey, unknown>)[FETCHED]).toEqual({ transaction: S.landedWireBase64 });
    const ref = await sessionSolanaStock.reference(held, S.credential.challenge as MppChallenge);
    if ("refused" in ref) throw new Error(ref.code);
    expect([ref.transaction, ref.payer, ref.payee]).toEqual([S.expectTransaction, S.expectPayer, S.expectReferencePayee]);
    expect(await sessionSolanaStock.channel.ref(held)).toEqual({ network: DEVNET, channel: S.expectChannel });
    expect(await sessionSolanaStock.broadcaster(S.credential)).toBe("payer");
    expect(sessionSolanaStock.landedTx(S.credential)).toBe(S.expectTransaction);
  });
});
