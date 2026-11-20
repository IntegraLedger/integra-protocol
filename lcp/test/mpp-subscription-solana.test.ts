// Runs mpp-subscription-solana.json through the mpp entry point. Every expected value is the vector file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, getTransactionDecoder } from "@solana/kit";
import type { AtrHash } from "../src/index.js";
import { issuedDigest, network, pairingsOf, subscriptionSolana, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-subscription-solana.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const at = (pointer: string): unknown =>
  pointer.split("/").slice(1).reduce((v: unknown, k: string) => (v as Record<string, unknown>)[k], V as unknown);
const presented = at(V.activation.credential) as MppCredential;
const refused = (code: string) => ({ refused: true, code });
const LINK = JSON.parse(readFileSync(new URL("../vectors/mpp-charge-solana.json", import.meta.url), "utf8")).fixed.link as string;

/** The activation's wire with its Memo instruction removed, the rest of the message as it was. */
function withoutMemo(b64: string): string {
  const tx = getTransactionDecoder().decode(Buffer.from(b64, "base64"));
  type Message = { staticAccounts: readonly string[]; instructions: readonly { programAddressIndex: number }[] };
  const m = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as Message;
  const memo = m.staticAccounts.findIndex((a) => a === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  const instructions = m.instructions.filter((ix) => ix.programAddressIndex !== memo);
  const messageBytes = getCompiledTransactionMessageEncoder().encode({ ...m, instructions } as never);
  return getBase64EncodedWireTransaction({ ...tx, messageBytes } as never);
}

describe("mpp-subscription-solana.json", () => {
  it("readings: pairingsOf names mpp/subscription/solana for a request the stock client takes", () => {
    for (const row of rowsOf(V.readings.rows, "mpp-subscription-solana.json readings", { exact: 9 })) {
      expect(pairingsOf(row.challenge), row.case).toEqual(row.expect);
    }
  });

  it("place: advertise sets id, opaque and externalId; unplaced gives the challenge as issued", async () => {
    expect(subscriptionSolana.advertise([V.challenge], H, LINK, V.challenge, 0)).toEqual([V.place.expect]);
    const issued = subscriptionSolana.unplaced(V.place.expect) as MppChallenge;
    expect(issued).toEqual({ ...V.place.expect, request: V.challenge.request });
    expect(await issuedDigest(issued)).toBe(await issuedDigest(V.challenge));
    expect(network(V.place.expect)).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("activation: bound, reference, broadcaster and the channel read the activation", async () => {
    expect(await subscriptionSolana.bound(presented)).toBe(V.activation.expectBound);
    const ref = await subscriptionSolana.reference(presented, V.place.expect);
    if ("refused" in ref) throw new Error(ref.code);
    expect([ref.payer, ref.feePayer, ref.payee]).toEqual([
      V.activation.expectReferencePayer,
      V.activation.expectReferenceFeePayer,
      V.activation.expectReferencePayee,
    ]);
    expect(await subscriptionSolana.broadcaster(presented)).toBe("payee");
    expect(subscriptionSolana.channel.kind(presented)).toBe("open");
    expect(await subscriptionSolana.channel.ref(presented)).toEqual({ network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", channel: V.activation.expectChannel });
    expect(await subscriptionSolana.channel.boundWithin(presented)).toEqual(refused("mpp/not-bound-within"));
    expect(subscriptionSolana.channel.until(presented)).toBeUndefined();
  });

  it("live: a devnet activation in the program's layout, under @solana/pay-kit's request, read by bound, reference and the channel", async () => {
    const L = V.live;
    const advertised = subscriptionSolana.advertise([L.offer], L.expectBound, LINK, L.offer, 0);
    expect(pairingsOf(L.offer)).toEqual(["mpp/subscription/solana"]);
    const [placed] = advertised as MppChallenge[];
    const credential = { challenge: placed!, payload: { type: "transaction", transaction: L.transaction } } as MppCredential;
    expect(await subscriptionSolana.bound(credential)).toBe(L.expectBound);
    const ref = await subscriptionSolana.reference(credential, placed!);
    if ("refused" in ref) throw new Error(ref.code);
    expect([ref.payer, ref.feePayer, ref.payee]).toEqual([L.expectReferencePayer, L.expectReferenceFeePayer, L.expectReferencePayee]);
    expect(await subscriptionSolana.channel.ref(credential)).toEqual({ network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", channel: L.expectChannel });
    // A proof names the same subscription, within it.
    const proof = { challenge: placed!, payload: { type: "proof", subscriptionDelegation: L.expectChannel } } as MppCredential;
    expect(subscriptionSolana.channel.kind(proof)).toBe("within");
    expect(await subscriptionSolana.channel.ref(proof)).toEqual({ network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", channel: L.expectChannel });
  });

  it("refusals", async () => {
    for (const row of rowsOf(V.refusals, "mpp-subscription-solana.json refusals", { exact: 2 })) {
      const payload = row.dropMemo ? { ...presented.payload, transaction: withoutMemo(presented.payload["transaction"] as string) } : row.payload;
      const c = { ...presented, payload };
      expect(await subscriptionSolana.bound(c), row.case).toEqual(refused(row.expect));
      expect(await subscriptionSolana.broadcaster(c), row.case).toEqual(row.dropMemo ? "payee" : refused(row.expect));
    }
  });
});
