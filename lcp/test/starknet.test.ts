// Runs the Starknet pairing's vector file through the starknet entry point. Every expected value is the file's, which
// computes them with starknet.js, @noble/hashes 2.4.0, Python and coreutils, and SNIP-9's published type hashes. The
// SNIP-12 message hash (the vector file's S3 expectMessageHash) is computed over build's output with starknet.js's
// typedData.getMessageHash.
import { readFileSync } from "node:fs";
import { typedData as snTypedData } from "starknet";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { pairingOf } from "../src/index.js";
import { counting } from "./fixtures/counting-reader.js";
import {
  EVENT_TRANSFER,
  MASK_250,
  SELECTOR_EXECUTE_FROM_OUTSIDE_V2,
  SELECTOR_TRANSFER,
  exactStarknet,
  snNonce,
  starknetLandedNonce,
  type Felt,
  type OutsideExecutionTypedData,
  type StarknetInvocation,
  type StarknetReader,
  type StarknetReceipt,
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
  const p = u.complete(V.S3.signature);
  if ("refused" in p) throw new Error(p.code);
  return p;
};
type Rec =
  | { finality: string; execution: string; blockNumber: string | null; events: StarknetReceipt["events"] }
  | null
  | "reader-error";
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
    const underReverted = V.S5.status.find((r: { case: string }) => r.case.endsWith("the receipt still listing the transfer"));
    expect(await starknetLandedNonce(REF, readerFor(underReverted))).toEqual({ refused: true, code: "starknet/not-found" });
    const below = V.S5.status.filter((r: { case: string }) => r.case.startsWith("the payer's transfer one call below the execute"));
    expect(below.map((r: { expect: unknown }) => r.expect)).toEqual([
      { state: "settled", finality: "ACCEPTED_ON_L2", blockNumber: "900" },
      { state: "failed", why: "not-this-instrument" },
    ]);
    expect(await starknetLandedNonce(REF, readerFor(below[0]))).toBe(V.S5.landedNonce.expect);
    expect(await starknetLandedNonce(REF, readerFor(below[1]))).toEqual({ refused: true, code: "starknet/not-found" });
  });

  // A missing or malformed idDigest cannot name the landed transfer, so the read is pending, never failed
  // (docs/guides/rails.md, "Reading settlement"); the digest is a 32-byte hash, the same in either case.
  it("S5: a ref whose idDigest is malformed is pending unreadable, with nothing read", async () => {
    const landed = V.S5.status[0];
    for (const idDigest of [undefined, REF.idDigest.slice(2), `0X${REF.idDigest.slice(2)}`, `0x${REF.idDigest.slice(4)}`]) {
      const { reader, calls } = counting(readerFor(landed));
      expect(await exactStarknet.status({ ...REF, idDigest } as typeof REF, reader)).toEqual({ state: "pending", why: "unreadable" });
      expect(calls).toEqual([]);
    }
    const upper = { ...REF, idDigest: `0x${REF.idDigest.slice(2).toUpperCase()}` } as typeof REF;
    expect(plain(await exactStarknet.status(upper, readerFor(landed)))).toEqual(landed.expect);
    expect(await starknetLandedNonce(upper, readerFor(V.S5.landedNonce))).toBe(V.S5.landedNonce.expect);
  });

  // A felt is an element of the field of the STARK prime 2^251 + 17·2^192 + 1 (Starknet's felt252, docs.starknet.io
  // "Cryptography"), written as reference writes it, 0x and hex digits. A from, asset or nonce outside that form cannot
  // name the payer, the token or the signed nonce, so the read is pending, never settled or failed
  // (docs/guides/rails.md, "Reading settlement"); a felt reads the same in either case.
  it("S5: a ref whose from, asset or nonce is not a felt is pending unreadable, with nothing read", async () => {
    const landed = V.S5.status[0];
    const prime = "0x800000000000011000000000000000000000000000000000000000000000001";
    for (const key of ["from", "asset", "nonce"] as const) {
      for (const value of [undefined, REF[key].slice(2), prime]) {
        const { reader, calls } = counting(readerFor(landed));
        expect([key, value, await exactStarknet.status({ ...REF, [key]: value } as typeof REF, reader)]).toEqual([
          key,
          value,
          { state: "pending", why: "unreadable" },
        ]);
        expect(calls).toEqual([]);
      }
      const upper = { ...REF, [key]: `0x${REF[key].slice(2).toUpperCase()}` } as typeof REF;
      expect(plain(await exactStarknet.status(upper, readerFor(landed)))).toEqual(landed.expect);
    }
  });

  // x402's settlement step 4 (scheme_exact_starknet.md at 0cb1a1f0) counts the one Transfer the payer's account emits,
  // wherever in the execution the account makes the call; the trace walk reads every call below the execute.
  it("S5: a transfer nested below the execute is read through each intermediate call, once", async () => {
    const row = V.S5.status[0];
    const execute: StarknetInvocation = row.trace.calls[0];
    const transfer: StarknetInvocation = execute.calls[0]!;
    const under = (calls: StarknetInvocation[]) => ({ ...row.trace, calls: [{ ...execute, calls }] });
    const frame = (contract: Felt, selector: Felt, calls: StarknetInvocation[]): StarknetInvocation => ({
      contract,
      selector,
      calldata: execute.calldata,
      reverted: false,
      calls,
    });
    // An account that runs its outside execution as a library call into its implementation class (a proxy account): two
    // frames, both on the payer's account, carry the selector and the nonce, and the transfer below them is one payment.
    const twoFrames = under([frame(REF.from, SELECTOR_EXECUTE_FROM_OUTSIDE_V2, [transfer])]);
    expect(plain(await exactStarknet.status(REF, readerFor({ receipt: row.receipt, trace: twoFrames })))).toEqual(row.expect);
    expect(await starknetLandedNonce(REF, readerFor({ receipt: row.receipt, trace: twoFrames }))).toBe(V.S5.landedNonce.expect);
    // A proxy token: its transfer runs as a library call into its implementation, a frame below the transfer with the
    // same contract, selector and calldata (blockifier's library_call keeps the caller's storage address; Pathfinder's
    // from_call_info lists the frame in the caller's calls). It is the token's own execution of the one transfer.
    const proxyToken = under([{ ...transfer, calls: [{ ...transfer, calls: [] }] }]);
    expect(plain(await exactStarknet.status(REF, readerFor({ receipt: row.receipt, trace: proxyToken })))).toEqual(row.expect);
    expect(await starknetLandedNonce(REF, readerFor({ receipt: row.receipt, trace: proxyToken }))).toBe(V.S5.landedNonce.expect);
    const proxyTokenBelow = under([frame(REF.from, row.trace.selector, [{ ...transfer, calls: [{ ...transfer, calls: [] }] }])]);
    expect(plain(await exactStarknet.status(REF, readerFor({ receipt: row.receipt, trace: proxyTokenBelow })))).toEqual(row.expect);
    // Two levels down, through two intermediate calls on the payer's account.
    const deeper = under([frame(REF.from, row.trace.selector, [frame(REF.from, row.trace.selector, [transfer])])]);
    expect(plain(await exactStarknet.status(REF, readerFor({ receipt: row.receipt, trace: deeper })))).toEqual(row.expect);
    // The plant one call down: the nested transfer is on another contract.
    const elsewhere = under([frame(REF.from, row.trace.selector, [{ ...transfer, contract: V.plant.trace.calls[0].calls[0].contract }])]);
    expect(plain(await exactStarknet.status(REF, readerFor({ receipt: row.receipt, trace: elsewhere })))).toEqual(V.plant.expect);
    // Another contract in the middle makes the transfer from its own balance: the receipt's Transfer is not the payer's.
    const stranger: Felt = "0x777";
    const fromStranger = under([frame(stranger, row.trace.selector, [transfer])]);
    const event = row.receipt.events[0];
    const receipt = { ...row.receipt, events: [{ ...event, keys: [event.keys[0], stranger, event.keys[2]] }] };
    expect(plain(await exactStarknet.status(REF, readerFor({ receipt, trace: fromStranger })))).toEqual({
      state: "failed",
      why: "not-this-instrument",
    });
  });

  it("S1: the Transfer event's first key is sn_keccak(\"Transfer\")", () => {
    expect(snKeccak("Transfer")).toBe(V.S1.expectSelectorTransferEvent);
    expect(EVENT_TRANSFER).toBe(V.S1.expectSelectorTransferEvent);
  });

  it("plant: a transfer on another contract with the same calldata is never the payment", async () => {
    expect(plain(await exactStarknet.status(REF, readerFor(V.plant)))).toEqual(V.plant.expect);
  });

  // The typed data is measured as JSON within the package's one nesting bound, 64 levels (vectors/core-vectors.json
  // `jsonDepth`), the typedData object counting 1. Objects with numeric member names, as JSON.parse builds them, are
  // what V8 writes by recursion, so the deepest are answered by the bound and not by the host's stack. A value JSON
  // cannot write (a bigint, a cycle) is malformed typed data.
  it("bound measures the typed data within the JSON nesting bound, and refuses what JSON cannot write", async () => {
    const p = await pay();
    const oe = p.payload.outsideExecution;
    const withX = (x: unknown) => ({ ...p, payload: { ...p.payload, outsideExecution: { ...oe, typedData: { ...oe.typedData, x } } } }) as never;
    const levels = (n: number) => JSON.parse('{"1":'.repeat(n - 1) + "[]" + "}".repeat(n - 1));
    const malformed = { refused: true, code: "starknet/typed-data-malformed" };
    expect(await exactStarknet.bound(withX(levels(63)))).toBe(V.S4.expectBound);
    for (const n of [64, 1000, 100_000]) expect(await exactStarknet.bound(withX(levels(n)))).toEqual(malformed);
    const cycle: { [k: string]: unknown } = {};
    cycle["self"] = cycle;
    for (const x of [1n, cycle]) expect(await exactStarknet.bound(withX(x))).toEqual(malformed);
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
