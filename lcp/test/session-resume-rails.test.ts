// `sessionResume` on the Hedera, Solana and XRPL sessions: the network and channel a challenge names for the client to
// resume, spelled as the pairing's `channel.ref` spells the opened channel. Where each session draft names the channel
// in the challenge:
// - Hedera: `methodDetails.channelId`, "Channel ID if resuming" (draft-hedera-session-00 L669), a bytes32 in hex
//   (L730-733); "New channel (no `channelId`)" (L681);
// - Solana: `methodDetails.channelId`, "OPTIONAL. Existing channel identifier to resume" (draft-solana-session-00
//   L994-997), "Base58 channel account address" (L1185);
// - XRPL: the request's `channelId`, "64-hex channel ID, or `""` on an open" (draft-xrpl-session-00 L265); "`channelId`
//   is empty when the server names no channel" (L291); "two spellings of one channel are one channel" (L254-258).
// The channels and challenges are the vector file's SS1, HS1, SV2 and XS2.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionHedera, sessionResume, sessionSolana, sessionXrpl, type MppChallenge, type MppCredential } from "../src/mpp.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
const refused = (code: string) => ({ refused: true, code });

function edited(issued: MppChallenge, edit: (request: Record<string, any>) => void): MppChallenge {
  const request = JSON.parse(Buffer.from(issued.request as string, "base64url").toString("utf8")) as Record<string, any>;
  edit(request);
  return { ...issued, request: Buffer.from(JSON.stringify(request), "utf8").toString("base64url"), id: "sellerOwnChallengeId" } as MppChallenge;
}

describe("sessionResume: Hedera's methodDetails.channelId", () => {
  const named = (v: unknown) => edited(V.SS1.hedera.challenge, (r) => void (r.methodDetails.channelId = v));

  it("names the channel as the opening's ref spells it, in either case of hex", async () => {
    const opening: MppCredential = {
      challenge: V.SS1.hedera.placed,
      payload: { action: "open", channelId: V.HS1.expectChannelId, txHash: V.HS3.txHash, cumulativeAmount: "0", signature: "0x00" },
    };
    const ref = await sessionHedera.channel.ref(opening);
    expect(ref).toEqual(V.HS3.expectRef);
    expect(sessionResume(named(V.HS1.expectChannelId))).toEqual(ref);
    expect(sessionResume(named(`0x${(V.HS1.expectChannelId as string).slice(2).toUpperCase()}`))).toEqual(ref);
  });

  it("no channelId names none; one that is not a bytes32 is refused", () => {
    expect(sessionResume(V.SS1.hedera.challenge)).toBeNull();
    expect(sessionResume(named("0x1234"))).toEqual(refused("mpp/request-malformed"));
    expect(sessionResume(named(7))).toEqual(refused("mpp/request-malformed"));
  });
});

describe("sessionResume: Solana's methodDetails.channelId", () => {
  const named = (v: unknown) =>
    edited(V.SS1.solana.challenge, (r) => {
      r.methodDetails.channelId = v;
      delete r.methodDetails.recentBlockhash;
      delete r.methodDetails.recentSlot;
    });

  it("names the channel as the opening's ref spells it", async () => {
    const opening: MppCredential = { challenge: V.SS1.solana.placed, payload: { action: "open", channelId: V.SV2.channel, transaction: V.SV2.wireBase64 } };
    const ref = await sessionSolana.channel.ref(opening);
    expect(ref).toEqual({ network: V.SV2.expectReference.network, channel: V.SV2.channel });
    expect(sessionResume(named(V.SV2.channel))).toEqual(ref);
  });

  it("no channelId names none; an address that is not 32 bytes of base58, or a lower-cased one, is refused or another channel", () => {
    expect(sessionResume(V.SS1.solana.challenge)).toBeNull();
    expect(sessionResume(named("0OIl"))).toEqual(refused("mpp/request-malformed"));
    const lowered = sessionResume(named((V.SV2.channel as string).toLowerCase()));
    expect(lowered !== null && !("refused" in lowered) && lowered.channel === V.SV2.channel).toBe(false);
  });
});

describe("sessionResume: XRPL's request channelId", () => {
  const named = (v: unknown) => edited(V.SS1.xrpl.challenge, (r) => void (r.channelId = v));

  it("names the channel as the opening's ref spells it, from either spelling of the hex", async () => {
    const opening: MppCredential = { challenge: V.SS1.xrpl.placed, payload: { action: "open", transaction: V.XS2.blob, amount: "100", signature: "00" } };
    const ref = await sessionXrpl.channel.ref(opening);
    expect(ref).toEqual({ network: "xrpl:1", channel: V.XS2.expectChannel });
    expect(sessionResume(named(V.XS2.expectChannel))).toEqual(ref);
    expect(sessionResume(named((V.XS2.expectChannel as string).toLowerCase()))).toEqual(ref);
  });

  it("an empty channelId names none, as does the issued open challenge; one that is not 64 hex is refused", () => {
    expect(sessionResume(V.SS1.xrpl.challenge)).toBeNull();
    expect(sessionResume(named(""))).toBeNull();
    expect(sessionResume(named(`0x${V.XS2.expectChannel}`))).toEqual(refused("mpp/request-malformed"));
    expect(sessionResume(named(12))).toEqual(refused("mpp/request-malformed"));
  });

  it("the channel named in methodDetails is not XRPL's field, and names none", () => {
    expect(sessionResume(edited(V.SS1.xrpl.challenge, (r) => void (r.methodDetails.channelId = V.XS2.expectChannel)))).toBeNull();
  });
});
