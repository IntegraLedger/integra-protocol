// The x402/upto/xrpl pairing against vectors/x402-upto-xrpl.json: its option filter, the channel's create and claim
// bytes and the channel id, bound's refusal at coverage none, the reference, the broadcaster, the registry entry, and
// the read of the channel's create through status. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { decode } from "ripple-binary-codec";
import { describe, expect, it } from "vitest";
import { isRefusal, pairingOf, type AtrHash } from "../src/index.js";
import { decodeBlob } from "../src/internal/xrpl.js";
import { xrplChannelId, xrplClaim } from "../src/xrpl.js";
import { uptoXrpl } from "../src/x402-upto-xrpl.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { xrplReader } from "./fixtures/xrpl-reader.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-upto-xrpl.json", import.meta.url), "utf8"));
const ID = "x402/upto/xrpl";
const H = V.fixed.H as AtrHash;
const O = V.fixed.O as PaymentRequirements;
const P = V.fixed.P as Record<string, unknown>;
const refused = (code: string) => ({ refused: true, code });
const docOf = (option: unknown): PaymentRequired =>
  ({ x402Version: 2, resource: V.fixed.resource, accepts: [option] }) as PaymentRequired;
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex").toUpperCase();

/** A copy of `v` with the member at the JSON Pointer `path` set to `value`, or removed. */
function changed(v: unknown, path: string, row: { value?: unknown; remove?: boolean }): unknown {
  const copy = structuredClone(v) as Record<string, unknown>;
  const keys = path.split("/").slice(1);
  let at = copy;
  for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
  const last = keys[keys.length - 1]!;
  if (row.remove === true) delete at[last];
  else at[last] = row.value;
  return copy;
}

describe("x402/upto/xrpl: the option filter", () => {
  type Row = { case: string; option: PaymentRequirements; expect: string };
  for (const row of rowsOf<Row>(V.filter.rows, "filter.rows", { exact: 32 })) {
    it(`${row.case}: ${row.expect}`, () => {
      const doc = docOf(row.option);
      const read = uptoXrpl.read({ ...doc, extensions: V.buyer.rows[0].input.doc.extensions });
      const placed = uptoXrpl.advertise(doc, H, V.fixed.link, row.option);
      if (row.expect === ID) {
        expect(isRefusal(read)).toBe(false);
        expect(placed).toEqual({ ...doc, extensions: V.buyer.rows[0].input.doc.extensions });
        expect(pairingOf(row.option)).toBe(ID);
      } else {
        expect(read).toEqual(refused("x402/no-payable-option"));
        expect(placed).toEqual(refused(row.expect));
        expect(pairingOf(row.option)).not.toBe(ID);
      }
    });
  }

  it("advertise writes nothing into the option: the B2 document is fixed.O advertised under H", () => {
    expect(uptoXrpl.advertise(docOf(O), H, V.fixed.link, O)).toEqual(V.buyer.rows[0].input.doc);
    expect(uptoXrpl.unplaced(O)).toBe(O);
  });
});

describe("x402/upto/xrpl: the channel's create, its id and its claim", () => {
  it("the create's blob decodes to its txJson, and its hash and channel are the file's", async () => {
    for (const c of [V.create, V.create.ticket]) {
      expect(decode(c.blob)).toEqual(expect.objectContaining(c.txJson));
      const d = await decodeBlob(c.blob);
      if (isRefusal(d)) throw new Error(d.code);
      expect(d.hash).toBe(c.hash);
      const tx = c.txJson as { Account: string; Destination: string; Sequence: number; TicketSequence?: number };
      expect(xrplChannelId(tx.Account, tx.Destination, tx.Sequence === 0 ? tx.TicketSequence! : tx.Sequence)).toBe(c.channel);
    }
  });

  it("the claim signs CLM\\0, the channel id and the maximum in drops, and fixed.P's signature verifies over it", () => {
    const message = xrplClaim(V.claim.channel, BigInt(V.claim.drops));
    if (isRefusal(message)) throw new Error(message.code);
    expect(hex(message)).toBe(V.claim.expect);
    const payload = P["payload"] as { signature: string; publicKey: string; channelId: string; maxAmount: string };
    expect([payload.signature, payload.channelId, payload.maxAmount]).toEqual([V.claim.signature, V.claim.channel, V.claim.drops]);
    expect(ed25519.verify(Buffer.from(payload.signature, "hex"), message, Buffer.from(payload.publicKey.slice(2), "hex"))).toBe(true);
  });
});

describe("x402/upto/xrpl: bound, reference and broadcaster", () => {
  it("bound refuses fixed.P: nothing the payer signs carries H", async () => {
    expect(await uptoXrpl.bound(P as never)).toEqual(refused(V.bound.expect));
    expect(await uptoXrpl.bound(P as never, { act: "agreement", h: H })).toEqual(refused(V.bound.expect));
  });

  type Change = { case: string; path: string; value?: unknown; remove?: boolean; expect: string };
  for (const row of rowsOf<Change>(V.bound.rows, "bound.rows", { exact: 10 })) {
    it(`bound and reference: ${row.case}: ${row.expect}`, async () => {
      const presented = changed(P, row.path, row);
      expect(await uptoXrpl.bound(presented as never)).toEqual(refused(row.expect));
      expect(await uptoXrpl.reference(presented as never, O)).toEqual(refused(row.expect));
    });
  }

  it("reference names the network, the channel, the payer and the option's payee", async () => {
    expect(await uptoXrpl.reference(P as never, O)).toEqual(V.reference.expect);
    const lower = changed(P, "/payload/channelId", { value: V.reference.lowerCase.value });
    expect(await uptoXrpl.reference(lower as never, O)).toEqual({ ...V.reference.expect, channel: V.reference.lowerCase.expect });
  });

  it(V.reference.notOption.case, async () => {
    for (const option of rowsOf<PaymentRequirements>(V.reference.notOption.options, "reference.notOption.options", { exact: 2 })) {
      expect(await uptoXrpl.reference(P as never, option)).toEqual(refused(V.reference.notOption.expect));
    }
  });

  it("the payer broadcasts: its client submits the create before it presents the payment", async () => {
    expect(await uptoXrpl.broadcaster(P as never)).toBe("payer");
  });
});

describe("x402/upto/xrpl: the registry entry", () => {
  it("is at coverage none with no link, after an agreement on the same network, single-use, confirmed no", () => {
    expect(uptoXrpl.data).toMatchObject({
      coverage: "none",
      link: "none",
      carrier: { signed: null },
      nonce: "single-use",
      broadcasts: "payer",
      agreementOn: "same-network",
      confirmed: "no",
    });
    expect(uptoXrpl.data.agreement).toBeUndefined();
    expect(uptoXrpl.claims).toBe(false);
    for (const member of ["build", "recover", "fetchPresented", "landedTx", "channel"]) expect(member in uptoXrpl, member).toBe(false);
  });

  it("proves states that an account signed the agreement, never that the buyer or the payer did", () => {
    expect(uptoXrpl.data.proves).toMatch(/an account signed an agreement/);
    expect(uptoXrpl.data.proves).not.toMatch(/(buyer|payer) signed/i);
  });
});

describe("x402/upto/xrpl: the read of the channel's create", () => {
  type Row = {
    case: string;
    channel: string;
    entry: Record<string, string> | null;
    opener: string;
    creates: { blob: string; ledgerIndex: number; validated?: boolean; metadata?: boolean }[];
    complete?: string;
    expect: unknown;
  };
  const hashOf = (blob: string): string =>
    createHash("sha512").update(Buffer.from(`54584E00${blob}`, "hex")).digest().subarray(0, 32).toString("hex").toUpperCase();
  for (const row of rowsOf<Row>(V.status.rows, "status.rows", { exact: 10 })) {
    it(row.case, async () => {
      const presented = changed(P, "/payload/channelId", { value: row.channel });
      const ref = await uptoXrpl.reference(presented as never, O);
      if (isRefusal(ref)) throw new Error(ref.code);
      const creates = row.creates.map((c) => ({
        hash: hashOf(V.status.blobs[c.blob]),
        validated: c.validated ?? true,
        ledgerIndex: c.ledgerIndex,
        result: "tesSUCCESS",
        blob: V.status.blobs[c.blob],
        ...(c.metadata === false ? {} : { createdChannels: [row.channel] }),
      }));
      const reader = xrplReader({
        ...(row.complete === undefined ? {} : { server: async () => ({ validated: 1000, latest: 1001, completeLedgers: row.complete! }) }),
        accountTx: async (a, range) => ({ transactions: a === row.opener ? creates : [], min: range.min, max: range.max }),
        channel: async (id) => (row.entry !== null && id === row.channel ? (row.entry as never) : { notFound: true, ledgerIndex: 1000 }),
      });
      const answer = await uptoXrpl.status({ ...ref, fromLedger: 950 }, reader, { act: "payment", finality: "validated", after: 950 });
      expect(answer).toStrictEqual(row.expect);
    });
  }
});
