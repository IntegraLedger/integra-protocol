// Every function that reads an XRPL signed blob, given vectors/decoder-caps.json's pairing rows: a blob whose deepest
// field sits at level 10, rippled's limit (rippled 3.4.1, src/libxrpl/protocol/STVar.cpp L104-108), is read as the
// pairing reads the blob it extends, and one whose deepest field sits at level 11 is refused. Each row is a pairing
// vector's blob with a Memo field added, which no pairing reads, so H is the source row's; each row's hash is Python
// 3.12.3 hashlib's SHA-512Half over 54584E00 and the blob. XC16 and XC17 hold an end marker in a container it does
// not close, which rippled refuses at any level (src/libxrpl/protocol/STObject.cpp L240-244, STArray.cpp L54-58).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chargeXrpl, sessionXrpl, type MppChallenge, type MppCredential, type SessionWithin } from "../src/mpp.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import { decodeBlob, type XrplLanded, type XrplReader } from "../src/xrpl.js";
import { rowsOf } from "./rows.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`../vectors/${n}`, import.meta.url), "utf8"));
const CAPS = load("decoder-caps.json");
const X = load("x402-exact-xrpl.json");
const M = load("mpp-charge-xrpl.json");
const S = load("mpp-session-hedera-solana-xrpl.json");
type Row = { name: string; case: string; depth: number; blob: string; accept: boolean; hash: string; stray?: string };
const rows = rowsOf(CAPS.xrpl.rows as Row[], "decoder-caps.json xrpl.rows", {
  keep: ["the rows that extend a pairing's blob to a level", (r) => typeof r.hash === "string" && r.stray === undefined],
  leave: ["the rows that hold only the nesting, and the rows with a stray end marker", (r) => r.hash === undefined || r.stray !== undefined],
});
const strays = rowsOf(CAPS.xrpl.rows as Row[], "decoder-caps.json xrpl.rows", {
  exact: 2,
  keep: ["the rows with a stray end marker", (r) => r.stray !== undefined],
  leave: ["the rows whose end markers each close their own container", (r) => r.stray === undefined],
});
const row = (name: string): Row => {
  const r = [...rows, ...strays].find((x) => x.name === name);
  if (r === undefined) throw new Error(`decoder-caps.json xrpl.rows: no ${name}`);
  return r;
};
const refused = (code: string) => ({ refused: true, code });
const malformed = refused("xrpl/blob-malformed");

describe("the pairing rows: rippled's limit and one level past it", () => {
  it("six rows, at level 10 and at level 11 in turn", () => {
    expect(rows.map((r) => [r.name, r.depth, r.accept])).toEqual([
      ["XC10", 10, true],
      ["XC11", 11, false],
      ["XC12", 10, true],
      ["XC13", 11, false],
      ["XC14", 10, true],
      ["XC15", 11, false],
    ]);
  });

  it("decodeBlob reads XC10, XC12 and XC14 with the row's hash, and refuses XC11, XC13 and XC15", async () => {
    for (const r of rows) {
      const d = await decodeBlob(r.blob);
      if (r.accept) expect(d, r.name).toMatchObject({ hash: r.hash });
      else expect(d, r.name).toEqual(malformed);
    }
  });
});

describe("x402/exact/xrpl: bound and reference", () => {
  const paid = (blob: string) => ({ x402Version: 2, accepted: X.V2.accepted, payload: { signedTxBlob: blob } });

  it("XC10: x402-exact-xrpl.json V2's H, and the reference by XC10's hash", async () => {
    const r = row("XC10");
    expect(await exactXrpl.bound(paid(r.blob))).toBe(X.V2.expectBound);
    expect(await exactXrpl.reference(paid(r.blob))).toEqual({ ...X.V2.expectReference, transaction: r.hash });
  });

  it("XC11: refused", async () => {
    const r = row("XC11");
    expect(await exactXrpl.bound(paid(r.blob))).toEqual(malformed);
    expect(await exactXrpl.reference(paid(r.blob))).toEqual(malformed);
  });

  it("XC16, V2's blob with an array end marker in the transaction's object: refused", async () => {
    const r = row("XC16");
    expect(r.blob).toBe(`${X.V2.blob}F1F1`);
    expect(await exactXrpl.bound(paid(r.blob))).toEqual(malformed);
    expect(await exactXrpl.reference(paid(r.blob))).toEqual(malformed);
  });
});

describe("stray end markers: rippled refuses each at any level", () => {
  it("decodeBlob refuses XC16 and XC17", async () => {
    expect(strays.map((r) => [r.name, r.stray, r.depth, r.accept])).toEqual([
      ["XC16", "ArrayEndMarker", 1, false],
      ["XC17", "ObjectEndMarker", 2, false],
    ]);
    for (const r of strays) expect(await decodeBlob(r.blob), r.name).toEqual(malformed);
  });
});

describe("mpp/charge/xrpl: bound and reference", () => {
  const challenge = M.place.expect as MppChallenge & { id: string };
  const presented = (blob: string): MppCredential => ({ challenge, payload: { type: "transaction", blob } });

  it("XC12: mpp-charge-xrpl.json V3's H, and the reference by XC12's hash", async () => {
    const r = row("XC12");
    expect(await chargeXrpl.bound(presented(r.blob))).toBe(M.V3.expectBound);
    expect(await chargeXrpl.reference(presented(r.blob))).toEqual({ ...M.V3.expectReference, transaction: r.hash });
  });

  it("XC13: refused", async () => {
    const r = row("XC13");
    expect(await chargeXrpl.bound(presented(r.blob))).toEqual(malformed);
    expect(await chargeXrpl.reference(presented(r.blob))).toEqual(malformed);
  });
});

describe("mpp/session/xrpl: bound, reference, channel.ref, recover, build's complete and buildWithin", () => {
  const challenge = S.SS1.xrpl.placed as MppChallenge & { id: string };
  const H = S.fixed.H;
  const open = (transaction: string): MppCredential => ({ challenge, payload: { action: "open", transaction, amount: "100", signature: "00" } });
  const landed: XrplLanded = S.XS4.rows[0].landed;
  const reader = (r: Row): XrplReader => ({
    network: "xrpl:1",
    tx: async (hash) => (hash === r.hash ? landed : { notFound: true, searchedAll: true }),
    txBlob: async (hash) => (hash === r.hash ? r.blob : null),
    validatedLedger: async () => 1000,
  });
  const choice = {
    challenge,
    from: S.XS2.account,
    now: 1790000000,
    deposit: BigInt(S.XS2.deposit),
    xrpl: { publicKey: `ED${"11".repeat(32)}`, settleDelay: S.XS2.settleDelay, fee: S.XS2.fee, sequence: S.XS2.sequence, lastLedgerSequence: S.XS2.lastLedgerSequence },
  };
  const completed = async (blob: string) => {
    const u = await sessionXrpl.build(choice, H);
    if ("refused" in u) throw new Error(u.code);
    return u.complete({ signedBlob: blob, claimSignature: "00" });
  };
  const within = (blob: string) =>
    sessionXrpl.buildWithin({ challenge, opening: open(blob), cumulativeAmount: 100n, action: "voucher" } as SessionWithin, H);

  it("XC14: XS2's H and channel, the reference by XC14's hash, and the credential", async () => {
    const r = row("XC14");
    expect(landed).toMatchObject({ validated: true, result: "tesSUCCESS", transactionType: "PaymentChannelCreate" });
    expect(await sessionXrpl.bound(open(r.blob))).toBe(S.XS2.expectBound);
    expect(await sessionXrpl.reference(open(r.blob))).toEqual({ network: "xrpl:1", transaction: r.hash, lastLedgerSequence: S.XS2.lastLedgerSequence });
    expect(await sessionXrpl.channel.ref(open(r.blob))).toEqual({ network: "xrpl:1", channel: S.XS2.expectChannel });
    expect(await sessionXrpl.recover({ network: "xrpl:1", transaction: r.hash }, reader(r))).toBe(S.XS2.expectBound);
    expect(await completed(r.blob)).toMatchObject({ payload: { action: "open", transaction: r.blob } });
    expect(await within(r.blob)).toMatchObject({ requests: [{ kind: "xrpl-claim", channelId: S.XS2.expectChannel, drops: 100n }] });
  });

  it("XC15: refused, and recover reads the blob as unreadable", async () => {
    const r = row("XC15");
    expect(await sessionXrpl.bound(open(r.blob))).toEqual(malformed);
    expect(await sessionXrpl.reference(open(r.blob))).toEqual(malformed);
    expect(await sessionXrpl.channel.ref(open(r.blob))).toEqual(malformed);
    expect(await sessionXrpl.recover({ network: "xrpl:1", transaction: r.hash }, reader(r))).toEqual(refused("xrpl/unreadable"));
    expect(await completed(r.blob)).toEqual(malformed);
    expect(await within(r.blob)).toEqual(malformed);
  });
});
