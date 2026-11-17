// The `0x78` envelope a stock signer sends where the fee is paid for the sender: lcp reads it as the `0x76` envelope the
// sender signed, recovers the sender from that form, and requires the address in item 11 to be that sender. The vector
// is viem/tempo's output (vectors/mpp-session-tempo.json, `feePayerEnvelope`).
import { describe, expect, it } from "vitest";
import { decodeEnvelope, senderSigned, tempoSender } from "../src/internal/tempo-envelope.js";
import { decodeTempoTx, expiringNonceHash } from "../src/tempo.js";
import T from "../vectors/mpp-session-tempo.json" with { type: "json" };

const V = T.feePayerEnvelope;
const bytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

describe("mpp-session-tempo.json feePayerEnvelope: the 0x78 envelope", () => {
  it("gives the sender the signature recovers over the 0x76 form, which item 11 names", () => {
    expect(tempoSender(bytes(V.wire))).toBe(V.sender.toLowerCase());
    const items = decodeEnvelope(bytes(V.wire));
    if ("refused" in items) throw new Error(items.code);
    expect(`0x${Buffer.from(senderSigned(items)).toString("hex")}`).toBe(V.signedBytes);
  });

  it("reads the calls and the expiring nonce hash of the bytes the sender signed", () => {
    const tx = decodeTempoTx(bytes(V.wire));
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.calls).toHaveLength(1);
    expect(tx.calls[0]!.to).toBe(V.call.to);
    expect(expiringNonceHash(bytes(V.wire), V.sender as `0x${string}`)).toBe(V.expiringNonceHash);
  });

  it("refuses a 0x78 envelope whose item 11 names another account than the sender", () => {
    expect(tempoSender(bytes(V.otherSenderWire))).toEqual({ refused: true, code: V.otherSenderCode });
  });
});
