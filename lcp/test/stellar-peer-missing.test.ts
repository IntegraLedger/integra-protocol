// @stellar/stellar-sdk is an optional peer. With it absent, the stellar entry points and the package root still import,
// the root pairingOf names no Stellar option, and each function whose type carries a refusal and needs the peer refuses
// `stellar/peer-missing` (the vectors' refusal), never throwing. muxedFor, a writer whose type carries no refusal,
// throws TypeError.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
const M = JSON.parse(readFileSync(new URL("../vectors/mpp-charge-stellar.json", import.meta.url), "utf8"));
const CODE = V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === "stellar/peer-missing").expect as string;

vi.mock("@stellar/stellar-sdk/base", () => {
  throw new Error("Cannot find package '@stellar/stellar-sdk'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without @stellar/stellar-sdk", () => {
  let root: typeof import("../src/index.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
  }, IMPORT_MS);

  it("the root imports, names no option, and x402 advertise refuses", { timeout: IMPORT_MS }, async () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/stellar");
    expect(root.pairingOf(V.fixed.option)).toBeUndefined();
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.option] };
    expect(exactStellar.advertise(required, V.fixed.H, V.fixed.link, V.fixed.option)).toEqual({
      refused: true,
      code: CODE,
    });
  });

  // The choice is V2's simulated transaction for V3's option and the payment is V3's, which the pairing builds, binds and
  // references with the peer (x402-exact-stellar.json).
  it("x402/exact/stellar's build, bound and reference refuse peer-missing, as its advertise does", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const refused = { refused: true, code: CODE };
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.V3.accepted] };
    const choice = { required, accepted: V.V3.accepted, simulatedXdr: V.V2.simulatedXdr, currentLedger: V.V2.currentLedger, payer: V.fixed.payer };
    expect(await exactStellar.build(choice, V.fixed.H)).toEqual(refused);
    const presented = { x402Version: 2, accepted: V.V3.accepted, payload: { transaction: V.V3.envelope }, extensions: V.V3.extensions };
    expect(await exactStellar.bound(presented)).toEqual(refused);
    expect(await exactStellar.reference(presented)).toEqual(refused);
  });

  // The document is V3's challenge, which the pairing reads with the peer: its hash, link and V3's option.
  it("x402/exact/stellar's read refuses peer-missing, as its advertise does", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.V3.accepted], extensions: V.V3.extensions };
    expect(exactStellar.read(required)).toEqual({ refused: true, code: CODE });
  });

  // V3's option is placed: with the peer, unplaced sets its muxed payTo back to the base account, which is the fixed
  // option's payTo. Without the peer no payTo can be read, so no option comes back as issued.
  it("x402/exact/stellar's unplaced refuses peer-missing for an option, after a refused member", { timeout: IMPORT_MS }, async () => {
    const { exactStellar } = await import("../src/x402-exact-stellar.js");
    const refused = { refused: true, code: CODE };
    expect(exactStellar.unplaced(V.V3.accepted)).toEqual(refused);
    expect(exactStellar.unplaced(V.fixed.option)).toEqual(refused);
    expect(exactStellar.unplaced({ ...V.V3.accepted, refused: true })).toEqual({ refused: true, code: "x402/option-malformed" });
    expect(exactStellar.unplaced(V.fixed.network)).toBe(V.fixed.network);
  });

  it("mpp/charge/stellar's advertise refuses peer-missing, as its bound and reference do", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const refused = { refused: true, code: CODE };
    expect(chargeStellar.advertise([M.challenge], M.fixed.H, M.fixed.link, M.challenge)).toEqual(refused);
    const credential = { challenge: M.place.expect, payload: { type: "transaction", transaction: M.V3.envelope } };
    expect(await chargeStellar.bound(credential)).toEqual(refused);
    expect(await chargeStellar.reference(credential)).toEqual(refused);
  });

  // The placed challenge is the vectors' placement: with the peer, unplaced sets its muxed recipient back to the base
  // account, the issued challenge's recipient. Without the peer no recipient can be read, so no challenge comes back.
  it("mpp/charge/stellar's unplaced refuses peer-missing for a challenge, after a refused member", { timeout: IMPORT_MS }, async () => {
    const { chargeStellar } = await import("../src/mpp.js");
    const refused = { refused: true, code: CODE };
    expect(chargeStellar.unplaced(M.place.expect)).toEqual(refused);
    expect(chargeStellar.unplaced(M.challenge)).toEqual(refused);
    expect(chargeStellar.unplaced({ ...M.place.expect, refused: true })).toEqual({ refused: true, code: "mpp/challenge-malformed" });
    expect(chargeStellar.unplaced(M.fixed.H)).toBe(M.fixed.H);
  });

  it("the stellar entry point's decoders refuse peer-missing, and muxedFor throws TypeError", { timeout: IMPORT_MS }, async () => {
    const st = await import("../src/stellar.js");
    const refused = { refused: true, code: CODE };
    expect(st.decodeStellarTx(V.V3.envelope, V.fixed.network)).toEqual(refused);
    expect(st.transferEventTopics(V.fixed.seller)).toEqual(refused);
    expect(st.transferEventOf(V.events.rows[0].topic, V.events.rows[0].value)).toEqual(refused);
    expect(() => st.muxedFor(V.fixed.seller, V.fixed.H)).toThrow(TypeError);
    expect(() => st.muxedFor(V.fixed.seller, V.fixed.H)).toThrow("@stellar/stellar-sdk is not installed");
  });
});
