// The lcp MPP method's challenge, filter, credential and receipt (mpp-method-lcp.json). Every expected value is the
// file's; mppx 0.17.6 and canonicalize 5.1.0 are its oracles, run again here.
import { readFileSync } from "node:fs";
import canonicalize from "canonicalize";
import { Challenge, Credential, Receipt } from "mppx";
import { describe, expect, it } from "vitest";
import { decodeHederaTx, txIdText } from "../src/hedera.js";
import {
  chargeLcpHedera,
  decodeCredential,
  encodeChallenge,
  encodeReceipt,
  network,
  pairingsOf,
  pairingsOfPlaced,
  parseChallenges,
  problem,
  type MppChallenge,
  type MppCredential,
  type MppReceipt,
} from "../src/mpp.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/mpp-method-lcp.json", import.meta.url), "utf8"));
const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");

describe("mpp-method-lcp.json: the challenges", () => {
  for (const [name, c] of Object.entries(V.challenges as Record<string, { header: string; wire: MppChallenge; requestJcs: string }>)) {
    it(`${name}: lcp parses the header mppx wrote into the members mppx parses, its request the RFC 8785 bytes`, () => {
      const parsed = parseChallenges([c.header]);
      expect(parsed).toEqual([c.wire]);
      expect(Buffer.from(c.wire.request, "base64url").toString("utf8")).toBe(c.requestJcs);
      expect(canonicalize(JSON.parse(c.requestJcs))).toBe(c.requestJcs);
      expect(pairingsOfPlaced(c.wire)).toEqual(["mpp/charge/lcp/hedera"]);
      expect(network(c.wire)).toBe("hedera:testnet");
    });

    it(`${name}: encodeChallenge writes the members mppx parsed as the header mppx wrote`, () => {
      expect(encodeChallenge(c.wire)).toBe(c.header);
    });
  }

  // A challenge's `header`, "When present, the value MUST be `Payment-Authorization`" (draft-httpauth-payment-01 at
  // 08e7dd87, lines 332-333): encodeChallenge writes that value and refuses any other.
  it("encodeChallenge writes the one header value MPP allows, Payment-Authorization, and refuses another", () => {
    const wire = (V.challenges.hedera as { wire: MppChallenge }).wire;
    const written = encodeChallenge({ ...wire, header: "Payment-Authorization" }) as string;
    expect(parseChallenges([written])).toEqual([{ ...wire, header: "Payment-Authorization" }]);
    expect(encodeChallenge({ ...wire, header: "Authorization" })).toEqual({ refused: true, code: "mpp/challenge-malformed" });
  });
});

describe("mpp-method-lcp.json: the filter", () => {
  const rows = rowsOf(V.filter as { case: string; challenge: MppChallenge; requestJcs: string; expect: unknown }[], "mpp-method-lcp.json filter", { exact: 43 });
  it.each(rows.map((r) => [r.case, r] as const))("%s", (_, r) => {
    expect(r.challenge.request).toBe(b64url(r.requestJcs));
    const got = pairingsOf(r.challenge);
    expect(Array.isArray(got) ? got : (got as { code: string }).code).toEqual(r.expect);
  });
});

describe("mpp-method-lcp.json: the credential and the receipt", () => {
  /** The wire credential an Authorization value carries: the base64url JSON after `Payment `. */
  const wireOf = (header: string): MppCredential => JSON.parse(Buffer.from(header.replace(/^Payment /, ""), "base64url").toString("utf8"));
  const tx = { header: V.credentials.transaction.header as string, wire: wireOf(V.credentials.transaction.header) };
  const hash = { header: V.credentials.hash.header as string, wire: wireOf(V.credentials.hash.header) };

  it("mppx reads each credential header back as the wire credential it carries", () => {
    for (const c of [tx, hash]) {
      const read = Credential.deserialize(c.header) as unknown as { challenge: { request: unknown }; payload: unknown };
      expect(read.payload).toEqual(c.wire.payload);
      expect(canonicalize(read.challenge.request)).toBe(Buffer.from(c.wire.challenge.request, "base64url").toString("utf8"));
    }
  });

  it("decodeCredential reads each header mppx wrote, and the one mppx writes answering encodeChallenge's, as the wire credential", () => {
    for (const c of [tx, hash]) expect(decodeCredential(c.header)).toEqual(c.wire);
    const issued = V.challenges.hedera as { header: string; wire: MppChallenge };
    const written = encodeChallenge(issued.wire) as string;
    const answer = Credential.serialize(Credential.from({ challenge: Challenge.deserialize(written), payload: hash.wire.payload }));
    expect(decodeCredential(answer)).toEqual({ challenge: issued.wire, payload: hash.wire.payload });
  });

  it("the transaction credential carries H and takes the payee as broadcaster; the hash credential the payer, read first", async () => {
    expect(await chargeLcpHedera.bound(tx.wire)).toBe(V.fixed.H);
    expect(await chargeLcpHedera.broadcaster(tx.wire)).toBe("payee");
    expect(await chargeLcpHedera.broadcaster(hash.wire)).toBe("payer");
    expect(await chargeLcpHedera.bound(hash.wire)).toEqual({ refused: true, code: "hedera/read-first" });
    expect(chargeLcpHedera.landedTx(hash.wire)).toBe("0.0.5555-1700000000-000000000");
    expect(chargeLcpHedera.landedTx(tx.wire)).toBeUndefined();
  });

  it("a payload of another type is refused mpp/credential-type", async () => {
    const other = { ...tx.wire, payload: { type: "authorization", transaction: tx.wire.payload["transaction"] } };
    expect(await chargeLcpHedera.bound(other)).toEqual({ refused: true, code: "mpp/credential-type" });
    expect(await chargeLcpHedera.broadcaster(other)).toEqual({ refused: true, code: "mpp/credential-type" });
  });

  it("the receipt mppx writes, which encodeReceipt writes alike, names the transaction id as the SDK spells it, from the credential's signed body", () => {
    const r = V.receipts.hedera as { encoded: string; decoded: MppReceipt };
    expect(Receipt.deserialize(r.encoded)).toEqual(r.decoded);
    expect(encodeReceipt(r.decoded)).toBe(r.encoded);
    expect(r.decoded.method).toBe("lcp");
    const body = decodeHederaTx(Buffer.from(tx.wire.payload["transaction"] as string, "base64")) as unknown as { bodies: { id: Parameters<typeof txIdText>[0] }[] };
    expect(r.decoded.reference).toBe(txIdText(body.bodies[0]!.id));
  });

  it("the problem types: read-first and wrong-reader 500, the method's own refusals verification-failed", () => {
    const internal = { status: 500, type: "https://paymentauth.org/problems/internal-payment-error" };
    const failed = { status: 402, type: "https://paymentauth.org/problems/verification-failed" };
    expect(problem("hedera/read-first")).toEqual(internal);
    expect(problem("hedera/wrong-reader")).toEqual(internal);
    for (const code of ["hedera/expired", "hedera/transfer-mismatch", "hedera/transaction-id-mismatch", "hedera/network-malformed", "mpp/modes-not-pull"]) {
      expect(problem(code)).toEqual(failed);
    }
  });
});
