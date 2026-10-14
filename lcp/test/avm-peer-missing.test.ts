// algosdk is an optional peer. With it absent, the avm entry point and the package root still import, the pairing
// serves no option, and avmCarrier and build refuse `avm/peer-missing`, the code the package states for a rail
// without its peer (`<rail>/peer-missing`, docs/guides/rails.md "Peer dependencies", with the entry point's namespace
// `avm`), never a malformed-input code. The payment and the choice are the vector file's own: with algosdk loaded,
// the payment reads as H and the choice builds the unsigned transfer (avm.test.ts).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
const PRESENTED = V.buyer.rows[1].input.presented;
const REFUSED = { refused: true, code: "avm/peer-missing" };
/** The vector's chain parameters as `AvmParams` takes them: the rounds and fees as bigints. */
const PARAMS = {
  firstValid: BigInt(V.fixed.params.firstValid),
  genesisHash: V.fixed.params.genesisHash,
  genesisId: V.fixed.params.genesisId,
  minFee: BigInt(V.fixed.params.minFee),
  feePerByte: BigInt(V.fixed.params.feePerByte),
};

vi.mock("algosdk", () => {
  throw new Error("Cannot find package 'algosdk'");
});

/** The root import loads every module of the package, which takes longest on a loaded machine. */
const IMPORT_MS = 30_000;

describe("without algosdk", () => {
  let root: typeof import("../src/index.js");
  let avm: typeof import("../src/avm.js");
  beforeAll(async () => {
    root = await import("../src/index.js");
    avm = await import("../src/avm.js");
  }, IMPORT_MS);

  it("the root imports with the pairing in BINDINGS, and no option is served", { timeout: IMPORT_MS }, () => {
    expect(root.BINDINGS.map((b) => b.id)).toContain("x402/exact/algorand");
    expect(root.pairingOf(V.fixed.O)).toBeUndefined();
  });

  it("avmCarrier refuses avm/peer-missing for a well-formed payment", () => {
    expect(avm.avmCarrier(PRESENTED.payload)).toEqual(REFUSED);
  });

  it("build refuses avm/peer-missing for a well-formed choice, and for no choice", async () => {
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [V.fixed.O] };
    const choice = { required, accepted: V.fixed.O, payer: V.fixed.payer, params: PARAMS };
    expect(await avm.exactAvm.build(choice, V.fixed.H)).toEqual(REFUSED);
    expect(await avm.exactAvm.build(null as never, V.fixed.H)).toEqual(REFUSED);
  });
});
