// mpp-charge-nearintents.json, for what mpp-charge-nearintents.md adds: the ATR names the NEAR Intents charge by the
// seller's fixed members alone, so `unplaced`, `tie` and `issuedDigest` read a challenge without the quote's members,
// `refundTo` and `expires`, and two quotes for one H give one digest; `advertiseBeforeCarrier` places H at issue with no
// quote present; `advertise` holds each quote's fixed members to the challenge the ATR names; and `reference` names the
// deposit by its origin network and its hash in that network's spelling. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, type Json } from "../src/index.js";
import { chargeNearIntents, issuedDigest, pairingsOf, tie, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-charge-nearintents.json", import.meta.url), "utf8"));
const H = V.fixed.H;
const link = V.fixed.link;
const refused = (code: string) => ({ refused: true, code });
const encode = (r: Json) => Buffer.from(canonicalJson(r) as string, "utf8").toString("base64url");
/** The quoted challenge the seller's server issues for `request`, before H is placed. */
const quoted = (request: Json, expires: string): MppChallenge => ({
  realm: V.fixed.realm,
  method: "nearintents",
  intent: "charge",
  request: encode(request),
  expires,
});
/** The example request with the member at `path` set to `value`, or removed where `value` is undefined. */
const edited = (path: readonly string[], value: Json | undefined): { [k: string]: Json } => {
  const r = structuredClone(V.fixed.request) as { [k: string]: Json };
  let at = r as { [k: string]: Json };
  for (const k of path.slice(0, -1)) at = at[k] as { [k: string]: Json };
  if (value === undefined) delete at[path.at(-1)!];
  else at[path.at(-1)!] = value;
  return r;
};
const first = quoted(V.fixed.request, V.fixed.expires);
/** The challenge as the ATR names it: the binding slot's entry. */
const named: MppChallenge = V.unplaced.expect;
const { advertise, advertiseBeforeCarrier, reference } = chargeNearIntents;

describe("mpp-charge-nearintents.json: unplaced, tie and issuedDigest read a challenge without its quote", () => {
  it("the challenge as issued and as placed give unplaced.expect, one slot entry and unplaced.expectDigest", async () => {
    expect(first).toEqual(V.challenge);
    expect(chargeNearIntents.unplaced(V.challenge)).toEqual(V.unplaced.expect);
    const { id, opaque } = V.place.expect;
    expect(chargeNearIntents.unplaced(V.place.expect)).toEqual({ ...V.unplaced.expect, id, opaque });
    for (const c of [V.challenge, V.place.expect, V.unplaced.expect]) expect(await issuedDigest(c)).toBe(V.unplaced.expectDigest);
    expect(tie([V.challenge, V.unplaced.expect])).toEqual(["mpp", { challenges: [V.unplaced.expect] }]);
  });

  it("a second quote for H: advertise places it held to the slot entry, and it gives the first quote's digest and entry", async () => {
    const second = quoted(V.secondQuote.request, V.secondQuote.expires);
    expect(advertise([second], H, link, second, 0, undefined, named)).toEqual([V.secondQuote.expect]);
    expect(await issuedDigest(V.secondQuote.expect)).toBe(V.secondQuote.expectDigest);
    expect(V.secondQuote.expectDigest).toBe(V.unplaced.expectDigest);
    expect(tie([second])).toEqual(tie([first]));
  });
});

describe("mpp-charge-nearintents.json: advertise holds a quote's fixed members to the challenge the ATR names", () => {
  it("the first quote is placed held to the slot entry, to advertiseBeforeCarrier's challenge, or to itself", () => {
    for (const to of [named, V.beforeCarrier.expect, first]) {
      expect(advertise([first], H, link, first, 0, undefined, to)).toEqual([V.place.expect]);
    }
  });

  it("each fixed member changed in turn is refused, and gives the row's digest, never the slot entry's", async () => {
    for (const row of rowsOf(V.fixedChanged.rows, "mpp-charge-nearintents.json fixedChanged.rows", { exact: 10 })) {
      const c = quoted(edited(row.path, row.value), V.fixed.expires);
      expect(pairingsOf(c), row.member).toEqual(["mpp/charge/nearintents"]);
      expect(advertise([c], H, link, c, 0, undefined, named), row.member).toEqual(refused(V.fixedChanged.expect));
      expect(await issuedDigest(c), row.member).toBe(row.expectDigest);
      expect(row.expectDigest, row.member).not.toBe(V.unplaced.expectDigest);
    }
  });

  it("with no challenge the ATR names, or one that is not a challenge, nothing is held: refused", () => {
    for (const to of [undefined, null, "challenge", {}, { ...named, request: 5 }]) {
      expect(advertise([first], H, link, first, 0, undefined, to as MppChallenge)).toEqual(refused(V.fixedChanged.expect));
    }
  });

  it("a quote without a member the draft requires, as a string, is mpp/request-malformed", () => {
    const paths = [["recipient"], ["amount"], ["methodDetails", "minAmountIn"], ["methodDetails", "refundTo"], ["currency"]];
    for (const path of paths) {
      for (const value of [undefined, 5]) {
        const c = quoted(edited(path, value), V.fixed.expires);
        expect(advertise([c], H, link, c, 0, undefined, named), `${path.join(".")} ${value}`).toEqual(refused("mpp/request-malformed"));
      }
    }
  });

  it("an occupied externalId stays refused", () => {
    const c = quoted(V.occupied.request, V.fixed.expires);
    expect(advertise([c], H, link, c, 0, undefined, named)).toEqual(refused(V.occupied.expect));
  });
});

describe("mpp-charge-nearintents.json: advertiseBeforeCarrier places H at issue with no quote present", () => {
  it("places the slot entry as beforeCarrier.expect, with no expires, and its digest is the slot entry's", async () => {
    const c: MppChallenge = V.beforeCarrier.challenge;
    expect(c).toEqual(named);
    const placed = advertiseBeforeCarrier([c], H, link, c, 0);
    expect(placed).toEqual([V.beforeCarrier.expect]);
    expect(Object.hasOwn((placed as MppChallenge[])[0]!, "expires")).toBe(false);
    expect(await issuedDigest(V.beforeCarrier.expect)).toBe(V.beforeCarrier.expectDigest);
  });

  it("places a challenge that carries expires with it, and leaves the document's other challenges as they were", () => {
    const other = { ...named, realm: "other.seller.example" };
    const placed = advertiseBeforeCarrier([other, first], H, link, first, 0) as MppChallenge[];
    expect(placed).toEqual([other, V.place.expect]);
  });

  it("a fixed member the draft requires removed is mpp/request-malformed; an occupied externalId is near/carrier-occupied", () => {
    const R = V.beforeCarrier.refusals;
    for (const path of rowsOf(R.rows as string[][], "mpp-charge-nearintents.json beforeCarrier.refusals.rows", { exact: 5 })) {
      const r = structuredClone(V.unplaced.request) as { [k: string]: Json };
      if (path.length === 1) delete r[path[0]!];
      else delete (r[path[0]!] as { [k: string]: Json })[path[1]!];
      const c = { ...named, request: encode(r) };
      expect(advertiseBeforeCarrier([c], H, link, c, 0), path.join(".")).toEqual(refused(R.expect));
    }
    const occupied = { ...named, request: encode({ ...V.unplaced.request, externalId: "order_12345" }) };
    expect(advertiseBeforeCarrier([occupied], H, link, occupied, 0)).toEqual(refused("near/carrier-occupied"));
  });
});

describe("mpp-charge-nearintents.json: reference names the deposit by its origin network and hash", () => {
  /** A hash credential for `hash` under the first quote on `originNetwork`, placed, and the challenge it answers. */
  const on = (originNetwork: string, hash: Json) => {
    const c = quoted(edited(["methodDetails", "originNetwork"], originNetwork), V.fixed.expires);
    const [placed] = advertise([c], H, link, c, 0, undefined, c) as (MppChallenge & { id: string })[];
    const credential: MppCredential = { challenge: placed!, payload: { type: "hash", hash } };
    return { credential, option: structuredClone(placed!) };
  };

  it("each row: the network and the hash in its spelling", async () => {
    for (const row of rowsOf(V.reference.rows, "mpp-charge-nearintents.json reference.rows", { exact: 7 })) {
      const { credential, option } = on(row.originNetwork, row.hash);
      expect(await reference(credential, option), row.case).toEqual(row.expect);
    }
  });

  it("each refusal row: a hash not in its network's spelling is mpp/credential-malformed", async () => {
    for (const row of rowsOf(V.reference.refusals, "mpp-charge-nearintents.json reference.refusals", { exact: 7 })) {
      const { credential, option } = on(row.originNetwork, row.hash);
      expect(await reference(credential, option), row.case).toEqual(refused(row.expect));
    }
  });

  it("a credential whose echoed challenge is not the challenge given is mpp/challenge-not-option", async () => {
    const credential: MppCredential = { challenge: V.place.expect, payload: V.bound.payload };
    expect(await reference(credential, V.place.expect)).toEqual({ network: "eip155:42161", transaction: V.bound.payload.hash });
    expect(await reference(credential, V.secondQuote.expect)).toEqual(refused(V.reference.notTheOption.expect));
    expect(await reference(credential, { ...V.place.expect, description: "Premium data" })).toEqual(refused(V.reference.notTheOption.expect));
    for (const option of [undefined, "challenge", { realm: V.fixed.realm }]) {
      expect(await reference(credential, option as MppChallenge)).toEqual(refused(V.reference.notTheOption.expect));
    }
  });

  it("an echoed opaque that is the object of its members is the challenge given", async () => {
    const opaque = JSON.parse(Buffer.from(V.place.expect.opaque, "base64url").toString("utf8"));
    const credential = { challenge: { ...V.place.expect, opaque }, payload: V.bound.payload } as unknown as MppCredential;
    expect(await reference(credential, V.place.expect)).toEqual({ network: "eip155:42161", transaction: V.bound.payload.hash });
  });

  it("the credential is held as bound holds it, first: a transaction credential is near/not-hash-credential", async () => {
    const credential: MppCredential = { challenge: V.place.expect, payload: V.plant.payload };
    expect(await reference(credential, V.place.expect)).toEqual(refused(V.plant.expect));
  });
});
