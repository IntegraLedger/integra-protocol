// The decoder caps: vectors/decoder-caps.json. XRPL binary, msgpack and ScVal each have a nesting cap, and each row
// says whether the caps admit its input.
import { readFileSync } from "node:fs";
import { xdr } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { MSGPACK_MAX_DEPTH } from "../src/avm.js";
import { msgpackWithinCaps } from "../src/internal/avm.js";
import { scValsWithinCaps, type StellarPaymentPayload } from "../src/internal/stellar.js";
import {
  XdrString,
  type InvokeHostFunctionOpWire,
  type ScValWire,
  type SorobanAuthorizedInvocationWire,
} from "@stellar/stellar-sdk/xdr";
import {
  decodeStellarTx,
  SCVAL_MAX_DEPTH,
  stellarLocate,
  stellarStatus,
  type StellarReader,
  type StellarRef,
} from "../src/stellar.js";
import { exactStellar } from "../src/x402-exact-stellar.js";
import { decodeBlob, XRPL_MAX_DEPTH } from "../src/xrpl.js";

const V = JSON.parse(readFileSync(new URL("../vectors/decoder-caps.json", import.meta.url), "utf8"));
type Row = { name: string; case: string; accept: boolean };

describe("XRPL binary: STObject and STArray nesting", () => {
  it("the cap is the vectors'", () => {
    expect(XRPL_MAX_DEPTH).toBe(V.xrpl.maxDepth);
  });
  for (const r of V.xrpl.rows as (Row & { blob: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept ? "decoded" : "xrpl/blob-malformed"}`, async () => {
      const d = await decodeBlob(r.blob);
      if (r.accept) expect("refused" in d).toBe(false);
      else expect(d).toEqual({ refused: true, code: "xrpl/blob-malformed" });
    });
  }
});

describe("msgpack: array and map nesting, declared lengths, one value", () => {
  it("the cap is the vectors'", () => {
    expect(MSGPACK_MAX_DEPTH).toBe(V.msgpack.maxDepth);
  });
  for (const r of V.msgpack.rows as (Row & { hex: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept}`, () => {
      expect(msgpackWithinCaps(Uint8Array.from(Buffer.from(r.hex, "hex")), MSGPACK_MAX_DEPTH)).toBe(r.accept);
    });
  }
  it("every signed transaction in the Algorand vectors is within the caps", () => {
    const A = readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8");
    const entries = [...A.matchAll(/"(g[A-Za-z0-9+/]{40,}={0,2})"/g)].map((m) => m[1]!);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(msgpackWithinCaps(Uint8Array.from(Buffer.from(e, "base64")), MSGPACK_MAX_DEPTH)).toBe(true);
    }
  });
});

describe("ScVal: vector and map nesting, and invocation nesting, in what decodeStellarTx reads", () => {
  it("the cap is the vectors'", () => {
    expect(SCVAL_MAX_DEPTH).toBe(V.scval.maxDepth);
  });
  for (const r of V.scval.rows as (Row & { xdr: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept}`, () => {
      expect(scValsWithinCaps(xdr.ScVal.fromXdr(Buffer.from(r.xdr, "base64")).toXdrObject())).toBe(r.accept);
    });
  }
  // The cap bounds nesting only: a value holding more vector elements than an 8 KiB envelope could carry is within it.
  // The value is written with @stellar/stellar-sdk 17.2.1's XDR types: one vector of 1537 voids.
  it("one vector of 1537 voids is within the cap", () => {
    const voids: ScValWire = { type: 16, vec: Array.from({ length: 1537 }, (): ScValWire => ({ type: 1 })) };
    expect(scValsWithinCaps(xdr.ScVal.fromXdr(xdr.ScVal.fromXdrObject(voids).toXdr()).toXdrObject())).toBe(true);
  });
  for (const r of V.scval.envelopes as (Row & { xdr: string })[]) {
    it(`${r.name}: ${r.case} → ${r.accept ? "decoded" : "stellar/tx-malformed"}`, () => {
      const d = decodeStellarTx(r.xdr, "stellar:testnet");
      if (r.accept) expect("refused" in d).toBe(false);
      else expect(d).toEqual({ refused: true, code: "stellar/tx-malformed" });
    });
  }

  // The envelope rows as the file's `about` gives them: x402-exact-stellar.json V2's signed envelope, edited with
  // @stellar/stellar-sdk 17.2.1's XDR types. Each nesting is counted by construction, the outermost level being 1.
  const X = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
  const vectors = (levels: number, inner: ScValWire): ScValWire => {
    let v = inner;
    for (let i = 0; i < levels; i++) v = { type: 16, vec: [v] };
    return v;
  };
  const call = (args: ScValWire[]): SorobanAuthorizedInvocationWire["function"] => ({
    type: 0,
    contractFn: {
      contractAddress: { type: 1, contractId: new Uint8Array(32).fill(6) },
      functionName: new XdrString("x"),
      args,
    },
  });
  /** `levels` invocations of `x(void)`, each the one sub-invocation of the one above it. */
  const chain = (levels: number): SorobanAuthorizedInvocationWire => {
    let n: SorobanAuthorizedInvocationWire = { function: call([{ type: 1 }]), subInvocations: [] };
    for (let i = 1; i < levels; i++) n = { function: call([{ type: 1 }]), subInvocations: [n] };
    return n;
  };
  function edited(edit: (op: InvokeHostFunctionOpWire) => void): string {
    const env = xdr.TransactionEnvelope.fromXdr(X.V2.expectEnvelope, "base64").toXdrObject();
    if (env.type !== 2) throw new Error("not V2's envelope");
    const body = env.v1.tx.operations[0]!.body;
    if (body.type !== 24) throw new Error("not V2's invocation");
    edit(body.invokeHostFunctionOp);
    return xdr.TransactionEnvelope.fromXdrObject(env).toXdr("base64");
  }
  const payerSignature = (levels: number) =>
    edited((op) => {
      const c = op.auth[0]!.credentials;
      if (c.type !== 1) throw new Error("not an address entry");
      c.address.signature = vectors(levels - 2, c.address.signature);
    });
  const secondEntry = (argLevels: number, invocations: number) =>
    edited((op) => {
      const root = chain(invocations);
      if (argLevels > 0) root.function = call([vectors(argLevels, { type: 1 })]);
      op.auth.push({ credentials: { type: 0 }, rootInvocation: root });
    });
  const payerInvocations = (levels: number) =>
    edited((op) => {
      op.auth[0]!.rootInvocation.subInvocations = [chain(levels - 1)];
    });
  const operationArgument = (levels: number) =>
    edited((op) => {
      const f = op.hostFunction;
      if (f.type !== 0) throw new Error("not a contract call");
      f.invokeContract.args.push(vectors(levels, { type: 1 }));
    });

  it("@stellar/stellar-sdk 17.2.1 writes each envelope row from V2's", () => {
    const built = [
      payerSignature(64),
      payerSignature(65),
      secondEntry(65, 1),
      secondEntry(0, 65),
      payerInvocations(65),
      operationArgument(65),
    ];
    expect(built).toEqual((V.scval.envelopes as { xdr: string }[]).map((r) => r.xdr));
  });

  it("one level less than SE5 and SE6 is within the cap, and refused only as no single transfer", () => {
    const notOne = { refused: true, code: "stellar/not-one-transfer" };
    expect(decodeStellarTx(payerInvocations(64), "stellar:testnet")).toEqual(notOne);
    expect(decodeStellarTx(operationArgument(64), "stellar:testnet")).toEqual(notOne);
  });

  // x402-exact-stellar.json V5: its ref is V2's (V3's) payer entry, and its first row is that envelope landed.
  it("a landed payment whose envelope carries an unused entry nested past the cap settles, and is found", async () => {
    const ref = X.V5.ref as StellarRef & { transaction: string };
    const landed = X.V5.rows[0];
    const unused = (V.scval.envelopes as (Row & { xdr: string })[]).filter((e) => e.name === "SE3" || e.name === "SE4");
    expect(unused.length).toBe(2);
    for (const r of unused) {
      const reader: StellarReader = {
        network: "stellar:testnet",
        transaction: async (hash) =>
          hash === ref.transaction
            ? { status: "SUCCESS", envelopeXdr: r.xdr, ledger: landed.ledger, oldestLedger: 1 }
            : { status: "NOT_FOUND", oldestLedger: 1 },
        transfers: async (f) => ({
          events: [{ txHash: ref.transaction, toMuxedId: BigInt(ref.toId) }],
          complete: true,
          oldestLedger: f.fromLedger,
          latestLedger: landed.latestLedger,
        }),
        latestLedger: async () => landed.latestLedger,
      };
      expect(await stellarStatus(ref, reader), r.name).toEqual(landed.expect);
      expect(await stellarLocate(ref, reader), r.name).toEqual({ found: ref.transaction, complete: true });
      const p: StellarPaymentPayload = {
        x402Version: 2,
        accepted: X.V3.accepted,
        payload: { transaction: r.xdr },
        extensions: X.V3.extensions,
      };
      expect(await exactStellar.bound(p), r.name).toBe(X.V3.expectBound);
    }
  });
});
