// `sessionResume` on the XRPL session: the network and channel a challenge names for the client to resume, spelled as
// the pairing's `channel.ref` spells the opened channel. The session draft names the channel in the request's
// `channelId`, "64-hex channel ID, or `""` on an open" (draft-xrpl-session-00 L265); "`channelId` is empty when the
// server names no channel" (L291); "two spellings of one channel are one channel" (L254-258). The channel and challenge
// are the vector file's SS1 and XS2.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionResume, sessionXrpl, type MppChallenge, type MppCredential } from "../src/mpp.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
const refused = (code: string) => ({ refused: true, code });

function edited(issued: MppChallenge, edit: (request: Record<string, any>) => void): MppChallenge {
  const request = JSON.parse(Buffer.from(issued.request as string, "base64url").toString("utf8")) as Record<string, any>;
  edit(request);
  return { ...issued, request: Buffer.from(JSON.stringify(request), "utf8").toString("base64url"), id: "sellerOwnChallengeId" } as MppChallenge;
}

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
