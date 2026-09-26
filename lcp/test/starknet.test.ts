// Runs the Starknet pairing's vector file through the starknet entry point. Every expected value is the file's, which
// computes them with starknet.js, @noble/hashes 2.4.0, Python and coreutils, and SNIP-9's published type hashes. The
// SNIP-12 message hash (the vector file's S3 expectMessageHash) is computed over build's output with starknet.js's
// typedData.getMessageHash.
import { readFileSync } from "node:fs";
import { typedData as snTypedData } from "starknet";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import {
  MASK_250,
  SELECTOR_EXECUTE_FROM_OUTSIDE_V2,
  SELECTOR_TRANSFER,
  exactStarknet,
  pairingOf,
  snNonce,
  starknetLandedNonce,
  type Felt,
  type OutsideExecutionTypedData,
  type StarknetInvocation,
  type StarknetPayment,
  type StarknetReader,
  type StarknetRef,
} from "../src/starknet.js";
import type { AtrHash } from "../src/core.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-starknet.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const snKeccak = (s: string) => `0x${(BigInt(keccak256(toBytes(s))) & MASK_250).toString(16)}`;
const typeHash = (types: OutsideExecutionTypedData["types"], primary: "OutsideExecution" | "Call") => {
  const enc = (name: "OutsideExecution" | "Call") =>
    `"${name}"(${types[name].map((f) => `"${f.name}":"${f.type}"`).join(",")})`;
  return snKeccak(primary === "OutsideExecution" ? enc("OutsideExecution") + enc("Call") : enc("Call"));
};
const doc = (extensions?: PaymentRequired["extensions"]): PaymentRequired => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepts: [O],
  ...(extensions !== undefined ? { extensions } : {}),
});
const advertised = () => exactStarknet.advertise(doc(), H, V.fixed.link, O) as PaymentRequired;
const pay = async (required: PaymentRequired = advertised()) => {
  const u = await exactStarknet.build({ required, accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
  if ("refused" in u) throw new Error(u.code);
  return u.complete(V.S3.signature) as StarknetPayment;
};
type Rec = { finality: string; execution: string; blockNumber: string | null } | null | "reader-error";
function readerFor(a: { receipt?: Rec; trace?: StarknetInvocation }): StarknetReader {
  return {
    network: V.S5.ref.network,
    receipt: async () => {
      if (a.receipt === "reader-error") throw new ReaderError("transport");
      if (a.receipt === null || a.receipt === undefined) return null;
      const r = a.receipt;
      return { ...r, blockNumber: r.blockNumber === null ? null : BigInt(r.blockNumber) } as never;
    },
    trace: async () => a.trace ?? null,
  };
}
const REF: StarknetRef & { transaction: Felt } = V.S5.ref;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

describe("x402-exact-starknet.json", () => {
  it("S1: the fitting rule gives x402's published selectors", () => {
    expect(keccak256(toBytes("transfer"))).toBe(V.S1.keccakTransfer);
    expect(BigInt(snKeccak("transfer"))).toBe(BigInt(V.S1.expectSelectorTransfer));
    expect(BigInt(SELECTOR_TRANSFER)).toBe(BigInt(V.S1.expectSelectorTransfer));
    expect(snKeccak("execute_from_outside_v2")).toBe(V.S1.expectSelectorExecuteFromOutsideV2);
    expect(SELECTOR_EXECUTE_FROM_OUTSIDE_V2).toBe(V.S1.expectSelectorExecuteFromOutsideV2);
  });

  it("S2: the nonce is H's low 250 bits, for either spelling of H", () => {
    expect(snNonce(H)).toBe(V.S2.expectNonce);
    expect(snNonce(V.S2.upperCaseH)).toBe(V.S2.expectNonce);
  });

  // The interface: "No function throws"; a value that is not a hash is x402's `payload-malformed`, as in `build`.
  it("S2: a value that is not a 32-byte hash is refused, never read as the felt 0x0", () => {
    for (const bad of ["0x12", H.slice(2)] as unknown as AtrHash[]) {
      expect(snNonce(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("S3: build gives x402's typed data, whose type hashes are SNIP-9's", async () => {
    const u = await exactStarknet.build({ required: advertised(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    const td = u.request.typedData;
    expect(u.request.kind).toBe("starknet-snip12");
    expect(BigInt(u.request.account)).toBe(BigInt(V.fixed.from));
    expect(td.primaryType).toBe("OutsideExecution");
    expect(td.domain).toEqual({ name: "Account.execute_from_outside", version: 2, chainId: V.S3.expectChainId, revision: 1 });
    expect(td.message.Nonce).toBe(V.S2.expectNonce);
    expect(td.message["Execute After"]).toBe("1");
    expect(td.message["Execute Before"]).toBe(V.S3.expectExecuteBefore);
    expect(BigInt(td.message.Caller)).toBe(BigInt(O.extra!["feePayer"] as string));
    expect(td.message.Calls).toEqual([{ To: BigInt(O.asset).toString(16).replace(/^/, "0x"), Selector: SELECTOR_TRANSFER, Calldata: V.S3.expectCalldata }]);
    expect(typeHash(td.types, "OutsideExecution")).toBe(V.S3.expectTypeHashOutsideExecution);
    expect(typeHash(td.types, "Call")).toBe(V.S3.expectTypeHashCall);
  });

  it("S3: the SNIP-12 message hash of build's typed data, for the payer's account, is the vector's", async () => {
    const u = await exactStarknet.build({ required: advertised(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(snTypedData.getTypeHash(u.request.typedData.types, "OutsideExecution", "1")).toBe(V.S3.expectTypeHashOutsideExecution);
    expect(snTypedData.getMessageHash(u.request.typedData as never, u.request.account)).toBe(V.S3.expectMessageHash);
  });

  it("S4: bound and reference", async () => {
    const p = await pay();
    expect(await exactStarknet.bound(p)).toBe(V.S4.expectBound);
    const ref = await exactStarknet.reference(p);
    expect(ref).toEqual(V.S4.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const other = await pay(doc({ legalContext: { info: { type: "sha256", value: V.S4.boundWithEmptyHash.value, legalContextUrl: V.fixed.link }, schema: {} } }));
    expect(await exactStarknet.bound(other)).toEqual(V.S4.boundWithEmptyHash.expect);
    const bare = await pay(doc());
    expect(await exactStarknet.bound(bare)).toEqual(V.S4.boundWithoutExtension);
    const short = structuredClone(p);
    (short.payload.outsideExecution.typedData.domain as { chainId: string }).chainId = V.S4.chainIdShortString;
    expect(await exactStarknet.bound(short)).toBe(V.S4.expectBound);
  });

  it("S5: status on receipt and trace fixtures, and the landed nonce", async () => {
    for (const row of V.S5.status) {
      expect([row.case, plain(await exactStarknet.status(REF, readerFor(row)))]).toEqual([row.case, row.expect]);
    }
    expect(await starknetLandedNonce(REF, readerFor(V.S5.landedNonce))).toBe(V.S5.landedNonce.expect);
  });

  it("plant: a transfer on another contract with the same calldata is never the payment", async () => {
    expect(plain(await exactStarknet.status(REF, readerFor(V.plant)))).toEqual(V.plant.expect);
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of V.agreedRefusals.rows) {
      const want = { refused: true, code: row.expect };
      if (row.option !== undefined) {
        const d: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.option] };
        expect([row.case, exactStarknet.advertise(d, H, V.fixed.link, row.option)]).toEqual([row.case, want]);
        expect(pairingOf(row.option)).toBeUndefined();
      } else if (row.from !== undefined) {
        expect(await exactStarknet.build({ required: advertised(), accepted: O, from: row.from, now: V.fixed.now }, H)).toEqual(want);
      } else if (row.signatureLengths !== undefined) {
        const u = await exactStarknet.build({ required: advertised(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
        if ("refused" in u) throw new Error(u.code);
        for (const n of row.signatureLengths) expect(u.complete(Array(n).fill("0x1"))).toEqual(want);
      } else if (row.revision !== undefined) {
        const p = structuredClone(await pay());
        (p.payload.outsideExecution.typedData.domain as { revision: number }).revision = row.revision;
        expect(await exactStarknet.bound(p)).toEqual(want);
      } else if (row.chainId !== undefined) {
        const p = structuredClone(await pay());
        (p.payload.outsideExecution.typedData.domain as { chainId: string }).chainId = row.chainId;
        expect(await exactStarknet.bound(p)).toEqual(want);
      } else if (row.twoMatches) {
        const root = V.S5.status[0].trace;
        const twice = { ...root, calls: [...root.calls, ...root.calls] };
        expect(plain(await exactStarknet.status(REF, readerFor({ receipt: V.S5.status[0].receipt, trace: twice })))).toEqual(row.expect);
      } else {
        throw new Error(`no runner for ${row.case}`);
      }
    }
  });
});
