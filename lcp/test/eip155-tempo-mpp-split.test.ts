// The Tempo split-memo charge's codecs against vectors/mpp-charge-tempo-split-memo.json, whose oracle is stock mppx
// 0.17.6 paying the challenges the profile places (test/eip155-tempo-mpp-split-oracle.ts). With WRITE_SPLIT_VECTORS=1
// the first test writes the file from the oracle instead of comparing it.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FETCHED, issuedDigest, pairingsOf, pairingsOfPlaced, placeSplit, tie } from "../src/mpp-challenge.js";
import { tempoSplitMemo, tempoSplitMemoPush } from "../src/mpp-tempo.js";
import type { TempoSearchReader as EvmSearchReader } from "../src/tempo.js";
import { heldOf } from "./mpp-fixtures.js";
import { H, splitVectors, type WireChallenge } from "./eip155-tempo-mpp-split-oracle.js";

const FILE = new URL("../vectors/mpp-charge-tempo-split-memo.json", import.meta.url);
const V = JSON.parse(readFileSync(FILE, "utf8"));
type Form = {
  pairing: string;
  offer: WireChallenge;
  placed: WireChallenge;
  authorization: string;
  credential: Record<string, unknown> & { payload: Record<string, unknown>; challenge: WireChallenge };
  fetched?: { transaction: string; blockNumber: string; logs: unknown[]; raw: string };
  expect: { bound: string; reference: Record<string, unknown> };
};
/** The credential the stock client returned, decoded from its Authorization header value. */
const credentialOf = (f: { authorization: string }) => JSON.parse(Buffer.from(f.authorization.replace(/^Payment /, ""), "base64url").toString("utf8"));
const FORMS: readonly [string, Form][] = (["pullSponsored", "pullPayerPays", "push"] as const).map((k) => [k, { ...V[k], credential: credentialOf(V[k]) } as Form]);
const codecOf = (pairing: string) => (pairing === tempoSplitMemo.id ? tempoSplitMemo : tempoSplitMemoPush);
const LINK = "https://seller.example/atr";

describe("mpp-charge-tempo-split-memo.json", () => {
  it("is the oracle's output, whole", { timeout: 60_000 }, async () => {
    const built = JSON.parse(JSON.stringify(await splitVectors()));
    if (process.env["WRITE_SPLIT_VECTORS"] === "1") writeFileSync(FILE, `${JSON.stringify(built, null, 1)}\n`);
    else expect(V).toEqual(built);
  });

  for (const [name, f] of FORMS) {
    describe(`${name} (${f.pairing})`, () => {
      const codec = codecOf(f.pairing);
      const held = () => heldOf({ presented: structuredClone(f.credential), ...(f.fetched === undefined ? {} : { fetched: f.fetched }) });

      it("advertise places the split as the profile states, and the issued digest and the binding slot read it without the split", async () => {
        const placed = codec.advertise([f.offer] as never, H as never, LINK, f.offer as never, 0);
        expect(placed).toEqual([f.placed]);
        expect(await issuedDigest(f.placed as never)).toBe(await issuedDigest(f.offer as never));
        const decoded = (r: string) => JSON.parse(Buffer.from(r, "base64url").toString("utf8"));
        expect(decoded(tie([f.placed as never])[1].challenges[0]!.request)).toEqual(decoded(f.offer.request));
        const unplaced = codec.unplaced(f.placed as never) as WireChallenge;
        expect(decoded(unplaced.request)).toEqual(decoded(f.offer.request));
      });

      it("bound gives H, and reference the payer, the nonce, the signed validBefore, the payee and the payment presented", async () => {
        expect(await codec.bound(held())).toBe(f.expect.bound);
        const ref = await codec.reference(held(), f.placed as never);
        expect(ref).toMatchObject(f.expect.reference);
        expect(ref).toHaveProperty("signed", expect.stringMatching(/^0x[0-9a-f]{64}$/));
      });

      it("reference refuses an option that is not the challenge the credential echoes", async () => {
        const other = { ...f.placed, realm: "other.seller.example" };
        expect(await codec.reference(held(), other as never)).toEqual({ refused: true, code: "mpp/challenge-not-option" });
        // Another issue of the same terms, placed at another position: every member fixed at issue equal, the id another.
        const reissued = (codec.advertise([f.offer] as never, H as never, LINK, f.offer as never, 1) as unknown as WireChallenge[])[0]!;
        expect(reissued.id).not.toBe(f.placed.id);
        expect(await issuedDigest(reissued as never)).toBe(await issuedDigest(f.placed as never));
        expect(await codec.reference(held(), reissued as never)).toEqual({ refused: true, code: "mpp/challenge-not-option" });
      });

      it("a source naming another account than the sender is refused", async () => {
        const c = { ...held(), source: "did:pkh:eip155:42431:0x0000000000000000000000000000000000000001" };
        expect(await codec.bound(c as never)).toEqual({ refused: true, code: "tempo/source-not-sender" });
      });
    });
  }

  it("the sponsored pull is the 0x78 envelope and the payer-paid pull the 0x76 one, as the stock signer sends them", () => {
    expect(V.pullSponsored.viem.type).toBe("0x78");
    expect(V.pullPayerPays.viem.type).toBe("0x76");
  });

  it("pairingsOf answers each challenge as the profile's rules 2 to 4 state", () => {
    for (const row of V.challenges as { case: string; offer: WireChallenge; expect: unknown }[]) {
      expect([row.case, pairingsOf(row.offer as never)]).toEqual([row.case, row.expect]);
    }
  });

  it("advertise refuses an offer that does not name feePayer, and on pull one whose modes are not [\"pull\"]", () => {
    const pull = V.pullSponsored as Form;
    const request = JSON.parse(Buffer.from(pull.offer.request, "base64url").toString("utf8"));
    const without = { ...pull.offer, request: Buffer.from(JSON.stringify({ ...request, methodDetails: { chainId: 42431, supportedModes: ["pull"] } })).toString("base64url") };
    expect(tempoSplitMemo.advertise([without] as never, H as never, LINK, without as never, 0)).toEqual({ refused: true, code: "mpp/fee-payer-unnamed" });
    const both = { ...pull.offer, request: Buffer.from(JSON.stringify({ ...request, methodDetails: { chainId: 42431, feePayer: true } })).toString("base64url") };
    expect(tempoSplitMemo.advertise([both] as never, H as never, LINK, both as never, 0)).toEqual({ refused: true, code: "mpp/modes-not-pull" });
    expect(placeSplit([both] as never, H as never, LINK, both as never, 0)).not.toHaveProperty("refused");
  });
});

describe("the push form", () => {
  const f = { ...V.push, credential: credentialOf(V.push) } as Form;
  const reader = (receipt: unknown, raw: string | null): EvmSearchReader =>
    ({
      network: "eip155:42431",
      receipt: async () => receipt,
      raw: async () => raw,
      blockNumber: async () => 100n,
      block: async () => ({ number: 100n, timestamp: 2_000_000_000n }),
    }) as unknown as EvmSearchReader;

  it("fetchPresented reads the named transaction's receipt and signed bytes; bound and reference take nothing before it", async () => {
    expect(await tempoSplitMemoPush.bound(structuredClone(f.credential) as never)).toEqual({ refused: true, code: "tempo/read-first" });
    const read = await tempoSplitMemoPush.fetchPresented(structuredClone(f.credential) as never, reader({ status: 1, blockNumber: 17n, logs: [] }, f.fetched!.raw));
    expect((read as unknown as { [FETCHED]: unknown })[FETCHED]).toEqual({ transaction: f.fetched!.transaction, blockNumber: 17n, logs: [], raw: f.fetched!.raw });
    expect(await tempoSplitMemoPush.bound(read as never)).toBe(H);
  });

  it("a missing receipt or signed bytes is a read to repeat, never a refusal of the payment", async () => {
    expect(await tempoSplitMemoPush.fetchPresented(structuredClone(f.credential) as never, reader(null, f.fetched!.raw))).toEqual({ refused: true, code: "tempo/not-found" });
    expect(await tempoSplitMemoPush.fetchPresented(structuredClone(f.credential) as never, reader({ status: 1, blockNumber: 17n, logs: [] }, null))).toEqual({ refused: true, code: "tempo/not-found" });
  });

  it("reads a hash credential under a challenge that names pull alone, which the pull form refuses", async () => {
    const pullOnly = (V.pullSponsored as Form).placed;
    const c = heldOf({ presented: { ...structuredClone(f.credential), challenge: pullOnly }, fetched: f.fetched });
    expect(pairingsOfPlaced(pullOnly as never)).toEqual([tempoSplitMemo.id]);
    expect(await tempoSplitMemoPush.bound(c)).toBe(H);
    expect(await tempoSplitMemo.bound(c)).toEqual({ refused: true, code: "mpp/credential-type" });
  });
});
