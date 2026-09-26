// Runs ack-payment-request.json and a2a-legal-context.json through the ack and a2a entry points. Every expected value
// is the files'.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { digestJson, type AtrHash } from "../src/index.js";
import * as ack from "../src/ack.js";
import * as a2a from "../src/a2a.js";
import { decodeJsonSegment } from "../src/sd-jwt.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const K = load("ack-payment-request.json");
const A = load("a2a-legal-context.json");
const H: AtrHash = K.fixed.H;

/** Expands `{"$repeat": [s, n]}` into s repeated n times, and null into undefined at the top of an argument list. */
function expand(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expand);
  if (typeof v === "object" && v !== null) {
    const r = (v as { $repeat?: [string, number] }).$repeat;
    if (r !== undefined) return r[0].repeat(r[1]);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)]));
  }
  return v;
}

async function run(call: string, args: unknown[]): Promise<unknown> {
  const fns: Record<string, (...a: unknown[]) => unknown> = {
    "paymentRequest.advertise": ack.paymentRequest.advertise as (...a: unknown[]) => unknown,
    "paymentRequest.read": ack.paymentRequest.read as (...a: unknown[]) => unknown,
    fromReceipt: ack.fromReceipt,
    agentExtension: a2a.agentExtension as (...a: unknown[]) => unknown,
    requested: a2a.requested as (...a: unknown[]) => unknown,
    place: a2a.place as (...a: unknown[]) => unknown,
    read: a2a.read as (...a: unknown[]) => unknown,
  };
  return fns[call]!(...args.map((x) => (x === null ? undefined : x)));
}

describe("ack-payment-request.json", () => {
  const pr = ack.paymentRequest;

  it("K1: values, slot and digest", async () => {
    const a = K.K1.advertise;
    expect(pr.advertise(a.doc, a.h, a.link, a.offer)).toEqual(K.K1.expect);
    expect(pr.advertise(a.doc, a.h, a.link, K.K1.emptyOption.offer)).toEqual(K.K1.emptyOption.expect);
    expect(ack.tie([K.fixed.O])).toEqual(K.K1.expectSlot);
    expect(pr.tie).toBe(ack.tie);
    expect(await digestJson(K.fixed.O)).toBe(K.K1.digestOfO);
  });

  it("K2: read takes H from the signed token", () => {
    expect(pr.read(K.K2.body)).toEqual(K.K2.expect);
    const { paymentRequest: _unsigned, ...withoutCopy } = K.K2.body;
    expect(pr.read(withoutCopy)).toEqual(K.K2.expect);
    expect(pr.read({ ...K.K2.body, paymentRequestToken: K.K2.twoSegmentToken.paymentRequestToken })).toEqual(
      K.K2.twoSegmentToken.expect,
    );
  });

  // RFC 8259 §8.1 lets a JSON parser either ignore or refuse a leading byte-order mark; every compact JWS in the package
  // is read by one decoder, so the ACK token and an SD-JWT segment get one answer for the same bytes.
  it("K2: a token payload with a leading byte-order mark gets the answer every JWS reader in the package gives", () => {
    const [head, body, sig] = (K.K2.body.paymentRequestToken as string).split(".");
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body!, "base64url")]).toString("base64url");
    expect(decodeJsonSegment(bom)).toBeNull();
    expect(pr.read({ ...K.K2.body, paymentRequestToken: `${head}.${bom}.${sig}` })).toEqual({
      refused: true,
      code: "ack/token-malformed",
    });
  });

  it("K3 plant: a signed id that differs from the delivered legal context is refused", () => {
    expect(pr.read(K.K3.body)).toEqual(K.K3.expect);
  });

  it("K4: fromReceipt reads the embedded token's id", () => {
    expect(ack.fromReceipt(K.K4.credentialSubject)).toBe(K.K4.expect);
    expect(ack.fromReceipt(K.K4.badToken.credentialSubject)).toEqual(K.K4.badToken.expect);
  });

  it("K5: delivery only", async () => {
    for (const x of K.K5.inputs) {
      expect(await pr.build(x, H)).toEqual(K.K5.expect);
      expect(await pr.bound(x)).toEqual(K.K5.expect);
    }
    const { proves, ...rest } = pr.pattern;
    expect({ ...rest, claims: pr.claims }).toEqual(K.K5.pattern);
    expect(proves.startsWith("Before this payment, the buyer signed and paid an agreement transaction")).toBe(true);
    expect(pr.unplaced(K.fixed.O)).toBe(K.fixed.O);
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of K.agreedRefusals.rows) {
      expect(await run(row.call, expand(row.args) as unknown[]), row.case).toEqual(row.expect);
    }
  });
});

describe("a2a-legal-context.json", () => {
  it("the URI list and the refusal", () => {
    expect(a2a.A2A_EXTENSION_URIS).toEqual(A.fixed.uris);
    expect(a2a.binding).toEqual(A.binding);
    expect(a2a.delivery.proves).toBe(A.deliveryProves);
  });

  it("A1: extension and activation", () => {
    expect(a2a.agentExtension()).toEqual(A.A1.expectAgentExtension);
    for (const row of A.A1.requested) {
      expect(a2a.requested(row.value ?? undefined), String(row.value)).toBe(row.expect);
    }
  });

  it("A2: place and read", () => {
    const placed = a2a.place(A.A2.task, H, A.fixed.L);
    expect(placed).toEqual(A.A2.expectPlaced);
    expect(a2a.read(placed as a2a.A2aTask)).toEqual(A.A2.expectRead);
    expect(a2a.place(placed as a2a.A2aTask, A.A2.placeOther.h, A.fixed.L)).toEqual(A.A2.placeOther.expect);
    expect(a2a.place(A.A2.task, H, A.A2.httpLink.link)).toEqual(A.A2.httpLink.expect);
  });

  it("A3 plant: a bare legalContext key is never read", () => {
    expect(a2a.read(A.A3.task)).toEqual(A.A3.expect);
  });

  it("results left to the implementation", async () => {
    for (const row of A.agreedRefusals.rows) {
      expect(await run(row.call, expand(row.args) as unknown[]), row.case).toEqual(row.expect);
    }
  });
});
