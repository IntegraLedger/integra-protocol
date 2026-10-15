// The decoder caps: vectors/decoder-caps.json. XRPL binary, msgpack and ScVal each have a nesting cap, and each row
// says whether the caps admit its input.
import { readFileSync } from "node:fs";
import { xdr } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { MSGPACK_MAX_DEPTH } from "../src/avm.js";
import { msgpackWithinCaps } from "../src/internal/avm.js";
import { scValsWithinCaps, XDR_MAX_DEPTH, type StellarPaymentPayload } from "../src/internal/stellar.js";
import {
  XdrString,
  type InvokeHostFunctionOpWire,
  type ScValWire,
  type SorobanAuthorizedInvocationWire,
  type TransactionEnvelopeWire,
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
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { decodeBlob, XRPL_MAX_DEPTH } from "../src/xrpl.js";
import { rowsOf } from "./rows.js";
import { wellFormedUtf8 } from "./utf8-syntax.js";

const V = JSON.parse(readFileSync(new URL("../vectors/decoder-caps.json", import.meta.url), "utf8"));
type Row = { name: string; case: string; accept: boolean };
/** How x402-exact-algorand.json V3.refusals ends the case of the row whose entry has bytes after its value. */
const AFTER_THE_VALUE = "bytes after its one value";

describe("XRPL binary: STObject and STArray nesting", () => {
  it("the cap is the vectors'", () => {
    expect(XRPL_MAX_DEPTH).toBe(V.xrpl.maxDepth);
  });
  for (const r of rowsOf(V.xrpl.rows as (Row & { blob: string })[], "decoder-caps.json xrpl.rows")) {
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
  for (const r of rowsOf(V.msgpack.rows as (Row & { hex: string })[], "decoder-caps.json msgpack.rows")) {
    it(`${r.name}: ${r.case} → ${r.accept}`, () => {
      expect(msgpackWithinCaps(Uint8Array.from(Buffer.from(r.hex, "hex")), MSGPACK_MAX_DEPTH)).toBe(r.accept);
    });
  }
  // The payment entry of x402-exact-algorand.json V3.refusals whose case ends in AFTER_THE_VALUE has a byte after its
  // value; every other signed transaction in the file is within the caps.
  it("every signed transaction in the Algorand vectors is within the caps, but the one with a byte after its value", () => {
    const A = readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8");
    const after = (r: { case: string }) => r.case.endsWith(AFTER_THE_VALUE);
    const refused = new Set(
      rowsOf(JSON.parse(A).V3.refusals as { case: string; paymentIndex: number; paymentGroup: string[] }[], "x402-exact-algorand.json V3.refusals", {
        exact: 1,
        keep: ["the row with a byte after its entry's value", after],
        leave: ["every other row, whose entry the loop below finds within the caps", (r) => !after(r)],
      }).map((r) => r.paymentGroup[r.paymentIndex]!),
    );
    expect(refused.size).toBe(1);
    const entries = rowsOf([...A.matchAll(/"(g[A-Za-z0-9+/]{40,}={0,2})"/g)].map((m) => m[1]!), "x402-exact-algorand.json signed transactions in base64", {
      min: refused.size + 1,
    });
    for (const e of entries) {
      expect(msgpackWithinCaps(Uint8Array.from(Buffer.from(e, "base64")), MSGPACK_MAX_DEPTH)).toBe(!refused.has(e));
    }
  });
});

// The msgpack specification's type system: "String extending Raw type represents a UTF-8 string", and a decoder's
// behaviour on "invalid byte sequence" in one "depends on the actual implementation". On the x402 path the facilitator
// reads every msgpack string as bytes and algod reads it as bytes, so the scan admits a string whatever its bytes;
// the Algorand reader judges a string member's text where the two readers read it differently (avm-entry.test.ts).
type StrFormat = "fixstr" | "str 8" | "str 16" | "str 32";
/** `s` as one msgpack string of the format (msgpack specification, "str format family"). */
function str(s: Uint8Array, format: StrFormat): number[] {
  const n = s.length;
  if (format === "fixstr" && n > 31) throw new Error("a fixstr holds at most 31 bytes");
  const head = { fixstr: [0xa0 | n], "str 8": [0xd9, n], "str 16": [0xda, n >> 8, n & 0xff], "str 32": [0xdb, 0, 0, n >> 8, n & 0xff] };
  return [...head[format], ...s];
}
/** Where a string sits: alone, as a fixmap's key or value, after an array's first element, or as a key at level 32. */
const PLACES: Record<string, (s: number[]) => number[]> = {
  "the value": (s) => s,
  "a map key": (s) => [0x81, ...s, 0x01],
  "a map value": (s) => [0x81, 0xa1, 0x61, ...s],
  "an array's second element": (s) => [0x92, 0x01, ...s],
  "a key of a map at level 32": (s) => [...Array<number>(31).fill(0x91), 0x81, ...s, 0x01],
};
const scans = (bytes: number[]) => msgpackWithinCaps(Uint8Array.from(bytes), MSGPACK_MAX_DEPTH);

describe("msgpack: the scan admits a string whatever its bytes", () => {
  const hex = (h: string) => Uint8Array.from(Buffer.from(h.replaceAll(" ", ""), "hex"));
  // Boundary code points of RFC 3629 §4's syntax, and one string of each form outside it.
  const wellFormed = {
    empty: "",
    "U+0061": "61",
    "U+0080": "c2 80",
    "U+07FF": "df bf",
    "U+0800": "e0 a0 80",
    "U+D7FF": "ed 9f bf",
    "the first code point after the surrogates": "ee 80 80",
    "U+FEFF, the byte-order mark": "ef bb bf",
    "U+FFFF": "ef bf bf",
    "U+10000": "f0 90 80 80",
    "U+10FFFF": "f4 8f bf bf",
  };
  const illFormed = {
    "overlong t, two bytes": "c1 b4",
    "overlong /, two bytes": "c0 af",
    "overlong /, three bytes": "e0 80 af",
    "overlong /, four bytes": "f0 80 80 af",
    "the surrogate U+D800": "ed a0 80",
    "the surrogate U+DFFF": "ed bf bf",
    "U+110000, above U+10FFFF": "f4 90 80 80",
    "lead F5": "f5 80 80 80",
    "byte FF": "ff",
    "a two-byte lead cut short": "61 c3",
    "a three-byte lead cut short": "e3 81",
    "a four-byte lead cut short": "f0 9f 98",
    "a lone continuation byte": "80",
    "a continuation byte between letters": "61 bf 62",
  };

  it("RFC 3629 §4's syntax takes each well-formed sample and refuses each ill-formed one", () => {
    for (const [name, h] of Object.entries(wellFormed)) expect(wellFormedUtf8(hex(h)), name).toBe(true);
    for (const [name, h] of Object.entries(illFormed)) expect(wellFormedUtf8(hex(h)), name).toBe(false);
  });

  for (const [place, at] of Object.entries(PLACES)) {
    it(`a string of each format as ${place} is admitted, well-formed UTF-8 or not`, () => {
      for (const format of ["fixstr", "str 8", "str 16", "str 32"] as const) {
        for (const [name, h] of [...Object.entries(wellFormed), ...Object.entries(illFormed)]) {
          expect(scans(at(str(hex(h), format))), `${format}: ${name}`).toBe(true);
        }
      }
    });
  }

  // Every string of one or two bytes, as a fixstr. The test has no time bound (0): it checks a fixed list of strings and
  // returns, so how long it takes depends only on the machine.
  it("every string of one or two bytes is admitted as a fixstr", () => {
    const refused: string[] = [];
    let count = 0;
    for (let a = 0; a < 256; a++) {
      for (const s of [[a], ...Array.from({ length: 256 }, (_, b) => [a, b])]) {
        count++;
        if (!scans([0xa0 | s.length, ...s])) refused.push(Buffer.from(s).toString("hex"));
      }
    }
    expect([count, refused]).toEqual([256 + 256 * 256, []]);
  }, 0);

  it("binary (bin 8, bin 16, bin 32) and extension bytes pass whatever bytes they hold", () => {
    for (const h of Object.values(illFormed)) {
      const b = [...hex(h)];
      expect(scans([0xc4, b.length, ...b]), h).toBe(true);
      expect(scans([0xc5, 0, b.length, ...b]), h).toBe(true);
      expect(scans([0xc6, 0, 0, 0, b.length, ...b]), h).toBe(true);
      expect(scans([0xc7, b.length, 0x05, ...b]), h).toBe(true);
    }
  });

  // The msgpack rows that hold a string, each named here with its string's bytes, which the row writes as a fixstr or
  // a str 8; RFC 3629 §4's syntax refuses the string of each row whose case says it is not well-formed UTF-8, and the
  // scan admits every one.
  it("each msgpack row holding a string is admitted, its string well-formed UTF-8 or not", () => {
    const mark = "efbbbf";
    const strings: Record<string, string> = {
      MC11: "c1b4",
      MC12: "eda080",
      MC13: "f4908080",
      MC14: "7369c1",
      MC15: "80",
      MC16: "f09f9880",
      MC17: mark + "78".repeat(198),
      MC18: mark + "78".repeat(197),
      MC19: "78" + mark + "78".repeat(197),
    };
    const rows = rowsOf(V.msgpack.rows as (Row & { hex: string })[], "decoder-caps.json msgpack.rows", {
      exact: 9,
      keep: ["MC11 to MC19, whose string is named here", (r) => r.name in strings],
      leave: ["the rows that judge nesting, declared lengths, one value and formats; the rows loop above runs them", (r) => !(r.name in strings)],
    });
    for (const r of rows) {
      const s = Uint8Array.from(Buffer.from(strings[r.name]!, "hex"));
      const written = [str(s, s.length < 32 ? "fixstr" : "str 8"), str(s, "str 8")].map((w) => Buffer.from(w).toString("hex"));
      expect(written.some((w) => r.hex.includes(w)), r.name).toBe(true);
      expect(r.case.includes("not well-formed UTF-8"), r.name).toBe(!wellFormedUtf8(s));
      expect(r.accept, r.name).toBe(true);
    }
  });
});

describe("ScVal: vector and map nesting, and invocation nesting, in what decodeStellarTx reads", () => {
  it("the cap is the vectors'", () => {
    expect(SCVAL_MAX_DEPTH).toBe(V.scval.maxDepth);
  });
  for (const r of rowsOf(V.scval.rows as (Row & { xdr: string })[], "decoder-caps.json scval.rows")) {
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
  type EnvelopeRow = Row & { xdr: string; expect?: string };
  const envelopes = rowsOf(V.scval.envelopes as EnvelopeRow[], "decoder-caps.json scval.envelopes", { exact: 75 });
  for (const r of envelopes) {
    it(`${r.name}: ${r.case} → ${r.accept ? (r.expect ?? "decoded") : "stellar/tx-malformed"}`, () => {
      const d = decodeStellarTx(r.xdr, "stellar:testnet");
      if (r.accept && r.expect !== undefined) expect(d).toEqual({ refused: true, code: r.expect });
      else if (r.accept) expect("refused" in d).toBe(false);
      else expect(d).toEqual({ refused: true, code: "stellar/tx-malformed" });
    });
  }

  // The envelope rows as the file's `about` gives them: x402-exact-stellar.json V2's signed envelope, edited with
  // @stellar/stellar-sdk 17.2.1's XDR types and written with js-xdr 5.0.0's writer past its default depth. Each nesting
  // is counted by construction, the outermost level being 1.
  const X = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
  const VOID: ScValWire = { type: 1 };
  const vectors = (levels: number, inner: ScValWire = VOID): ScValWire => {
    let v = inner;
    for (let i = 0; i < levels; i++) v = { type: 16, vec: [v] };
    return v;
  };
  /** `levels` maps, each the value of the one entry of the map above it, whose key is void. */
  const maps = (levels: number, inner: ScValWire = VOID): ScValWire => {
    let v = inner;
    for (let i = 0; i < levels; i++) v = { type: 17, map: [{ key: VOID, val: v }] };
    return v;
  };
  /** `levels` contract instances of the Stellar asset, each the value of the one storage entry above it, keyed by void. */
  const instances = (levels: number, inner: ScValWire = VOID): ScValWire => {
    let v = inner;
    for (let i = 0; i < levels; i++) v = { type: 19, instance: { executable: { type: 1 }, storage: [{ key: VOID, val: v }] } };
    return v;
  };
  const key = (b: number) => ({ type: 0 as const, ed25519: new Uint8Array(32).fill(b) });
  /** `x(args)` on the contract of 32 bytes of 06. */
  const contractFn = (args: ScValWire[]) => ({
    contractAddress: { type: 1 as const, contractId: new Uint8Array(32).fill(6) },
    functionName: new XdrString("x"),
    args,
  });
  const call = (args: ScValWire[]): SorobanAuthorizedInvocationWire["function"] => ({ type: 0, contractFn: contractFn(args) });
  /** `levels` invocations of `x(void)`, each the one sub-invocation of the one above it. */
  const chain = (levels: number): SorobanAuthorizedInvocationWire => {
    let n: SorobanAuthorizedInvocationWire = { function: call([VOID]), subInvocations: [] };
    for (let i = 1; i < levels; i++) n = { function: call([VOID]), subInvocations: [n] };
    return n;
  };
  type Predicate = { type: 0 } | { type: 1; andPredicates: Predicate[] } | { type: 3; notPredicate: Predicate };
  /** A predicate `levels` deep: not-predicates around an unconditional one. */
  const nots = (levels: number): Predicate => {
    let p: Predicate = { type: 0 };
    for (let i = 1; i < levels; i++) p = { type: 3, notPredicate: p };
    return p;
  };
  /** A predicate `levels` deep: and-predicates, each of an unconditional one and the next. */
  const ands = (levels: number): Predicate => {
    let p: Predicate = { type: 0 };
    for (let i = 1; i < levels; i++) p = { type: 1, andPredicates: [{ type: 0 }, p] };
    return p;
  };
  /** A create-claimable-balance of 1 stroop of the native asset to the account of 32 bytes of 05 under `predicate`. */
  const claimableBalance = (predicate: Predicate) => ({
    type: 14,
    createClaimableBalanceOp: { asset: { type: 0 }, amount: 1n, claimants: [{ type: 0, v0: { destination: key(5), predicate } }] },
  });
  type Delegate = { address: { type: 0; accountId: ReturnType<typeof key> }; signature: ScValWire; nestedDelegates: Delegate[] };
  /** `levels` delegates of the account key of 32 bytes of 04, each the one nested delegate of the one above it. */
  const delegates = (levels: number, signature: ScValWire = VOID): Delegate => {
    let d: Delegate = { address: { type: 0, accountId: key(4) }, signature, nestedDelegates: [] };
    for (let i = 1; i < levels; i++) d = { address: { type: 0, accountId: key(4) }, signature: VOID, nestedDelegates: [d] };
    return d;
  };
  /** An entry under address credentials with one delegate chain: the account key of 32 bytes of 04, x(void). */
  const withDelegates = (d: Delegate) =>
    ({
      credentials: {
        type: 3,
        addressWithDelegates: {
          addressCredentials: { address: { type: 0, accountId: key(4) }, nonce: 0n, signatureExpirationLedger: 0, signature: VOID },
          delegates: [d],
        },
      },
      rootInvocation: chain(1),
    }) as never;
  /** An entry under the address credentials of the account key of 32 bytes of 08. */
  const addressEntry = (signature: ScValWire, rootInvocation: SorobanAuthorizedInvocationWire) =>
    ({
      credentials: { type: 1, address: { address: { type: 0, accountId: key(8) }, nonce: 0n, signatureExpirationLedger: 0, signature } },
      rootInvocation,
    }) as never;
  const write = (env: TransactionEnvelopeWire): string =>
    Buffer.from(xdr.TransactionEnvelope.schema.encode(env, { maxDepth: 1_000_000 })).toString("base64");
  /** An envelope edited: its operation's invocation, and the v1 envelope. */
  function edited(
    edit: (op: InvokeHostFunctionOpWire, env: Extract<TransactionEnvelopeWire, { type: 2 }>) => void,
    envelope: string = X.V2.expectEnvelope,
  ): string {
    const env = xdr.TransactionEnvelope.fromXdr(envelope, "base64").toXdrObject();
    if (env.type !== 2) throw new Error("not V2's envelope");
    const body = env.v1.tx.operations[0]!.body;
    if (body.type !== 24) throw new Error("not V2's invocation");
    edit(body.invokeHostFunctionOp, env);
    return write(env);
  }
  /** A second entry under the source account's credentials whose root invocation is x(value). */
  const unusedEntry = (value: ScValWire) => (op: InvokeHostFunctionOpWire) =>
    void op.auth.push({ credentials: { type: 0 }, rootInvocation: { function: call([value]), subInvocations: [] } });
  const reads = { reads: true } as const;
  const unread = { reads: false } as const;
  /** The places a nested ScVal can sit, and whether lcp reads it. */
  const scvalPlaces: Record<string, { reads: boolean; at: (v: ScValWire) => string }> = {
    "the payer entry's signature": { ...reads, at: (v) => edited((op) => {
      const c = op.auth[0]!.credentials;
      if (c.type === 1) c.address.signature = v;
    }) },
    "a fourth argument of the operation": { ...reads, at: (v) => edited((op) => {
      if (op.hostFunction.type === 0) op.hostFunction.invokeContract.args.push(v);
    }) },
    "an unused entry's argument": { ...unread, at: (v) => edited(unusedEntry(v)) },
    "an unused address entry's signature": { ...unread, at: (v) => edited((op) => void op.auth.push(addressEntry(v, chain(1)))) },
    "a delegate's signature in an unused entry": { ...unread, at: (v) => edited((op) => void op.auth.push(withDelegates(delegates(1, v)))) },
    "a footprint key": { ...unread, at: (v) => edited((_op, env) => {
      env.v1.tx.ext = {
        v: 1,
        sorobanData: {
          ext: { v: 0 },
          resources: {
            footprint: {
              readOnly: [{ type: 6, contractData: { contract: { type: 1, contractId: new Uint8Array(32).fill(7) }, key: v, durability: 1 } }],
              readWrite: [],
            },
            instructions: 0,
            diskReadBytes: 0,
            writeBytes: 0,
          },
          resourceFee: 0n,
        },
      } as never;
    }) },
    "a second operation's argument": { ...unread, at: (v) => edited((_op, env) => void env.v1.tx.operations.push({
      sourceAccount: null,
      body: { type: 24, invokeHostFunctionOp: { hostFunction: { type: 0, invokeContract: contractFn([v]) }, auth: [] } },
    } as never)) },
  };
  const shapes: Record<string, (levels: number) => ScValWire> = { vectors, maps, "contract instances": instances };
  /** The other nesting places, given the levels of their shape. */
  const otherPlaces: Record<string, { reads: boolean; at: (levels: number) => string }> = {
    // The payer's signature is a vector of one map, 2 levels: it is wrapped in vectors.
    "the payer entry's signature, wrapped in vectors": { ...reads, at: (n) => edited((op) => {
      const c = op.auth[0]!.credentials;
      if (c.type === 1) c.address.signature = vectors(n - 2, c.address.signature);
    }) },
    "the payer entry's invocations": { ...reads, at: (n) => edited((op) => void (op.auth[0]!.rootInvocation.subInvocations = [chain(n - 1)])) },
    "an unused entry's invocations": { ...unread, at: (n) => edited((op) => void op.auth.push({ credentials: { type: 0 }, rootInvocation: chain(n) })) },
    "an unused address entry's invocations": { ...unread, at: (n) => edited((op) => void op.auth.push(addressEntry(VOID, chain(n)))) },
    "not-predicates in the one operation": { ...unread, at: (n) => edited((_op, env) => {
      (env.v1.tx.operations[0] as { body: unknown }).body = claimableBalance(nots(n));
    }) },
    "not-predicates in a second operation": { ...unread, at: (n) => edited((_op, env) => void env.v1.tx.operations.push({ sourceAccount: null, body: claimableBalance(nots(n)) } as never)) },
    "and-predicates in a second operation": { ...unread, at: (n) => edited((_op, env) => void env.v1.tx.operations.push({ sourceAccount: null, body: claimableBalance(ands(n)) } as never)) },
    "delegates in an unused entry": { ...unread, at: (n) => edited((op) => void op.auth.push(withDelegates(delegates(n)))) },
  };
  /** What decodeStellarTx answers for V2's envelope with the place but without its nesting: V2's payment, or a refusal. */
  const unnested = (place: string): string | undefined =>
    /operation|fourth argument|payer entry's invocations/.test(place) ? "stellar/not-one-transfer" : undefined;
  /**
   * The rows in index order: a place, its shape (for a nested ScVal), and its levels, or "stop": the least levels at
   * which @stellar/stellar-sdk 17.2.1's decoder, at js-xdr's default depth, refuses the envelope.
   */
  type Spec = [place: string, shape: string | null, levels: number | "stop"];
  const specs: Spec[] = [
    ["the payer entry's signature, wrapped in vectors", null, 64],
    ["the payer entry's signature, wrapped in vectors", null, 65],
    ["an unused entry's argument", "vectors", 65],
    ["an unused entry's invocations", null, 65],
    ["the payer entry's invocations", null, 65],
    ["a fourth argument of the operation", "vectors", 65],
    ["delegates in an unused entry", null, 66],
    ["not-predicates in the one operation", null, 66],
    ["an unused entry's argument", "vectors", 64],
    ["an unused entry's invocations", null, 64],
    ...(["maps", "contract instances"] as const).flatMap((s): Spec[] => [["an unused entry's argument", s, 64], ["an unused entry's argument", s, 65]]),
    ...(["vectors", "maps", "contract instances"] as const).flatMap((s): Spec[] => [["a footprint key", s, 64], ["a footprint key", s, 65]]),
    ["not-predicates in a second operation", null, 64],
    ["not-predicates in a second operation", null, 65],
    ...(["maps", "contract instances"] as const).flatMap((s): Spec[] => [["the payer entry's signature", s, 64], ["the payer entry's signature", s, 65]]),
    ["a fourth argument of the operation", "vectors", 64],
    ...(["maps", "contract instances"] as const).flatMap((s): Spec[] => [["a fourth argument of the operation", s, 64], ["a fourth argument of the operation", s, 65]]),
    ["the payer entry's invocations", null, 64],
    ...(["vectors", "maps", "contract instances"] as const).map((s): Spec => ["an unused entry's argument", s, "stop"]),
    ...(["an unused address entry's signature", "a delegate's signature in an unused entry"] as const).flatMap((p) =>
      (["vectors", "maps", "contract instances"] as const).flatMap((s) => ([64, 65, "stop"] as const).map((n): Spec => [p, s, n])),
    ),
    ...(["vectors", "maps", "contract instances"] as const).map((s): Spec => ["a footprint key", s, "stop"]),
    ...(["vectors", "maps", "contract instances"] as const).flatMap((s) => ([64, 65, "stop"] as const).map((n): Spec => ["a second operation's argument", s, n])),
    ["an unused address entry's invocations", null, 64],
    ["an unused address entry's invocations", null, 65],
    ...([64, 65, "stop"] as const).map((n): Spec => ["not-predicates in the one operation", null, n]),
    ["not-predicates in a second operation", null, "stop"],
    ["and-predicates in a second operation", null, 64],
    ["and-predicates in a second operation", null, 65],
    ["delegates in an unused entry", null, 64],
    ["delegates in an unused entry", null, 65],
  ];
  const sdkDefaultDecodes = (b64: string): boolean => {
    try {
      xdr.TransactionEnvelope.fromXdr(b64, "base64");
      return true;
    } catch (e) {
      if (!/max recursion depth/.test(String(e))) throw e;
      return false;
    }
  };
  /** Each row as built: its place, whether lcp reads it, its levels, whether they are the decoder's stopping depth. */
  const built = rowsOf(specs, "the row specs above", { exact: 75 }).map(([place, shape, levels]) => {
    const p = shape === null ? otherPlaces[place]! : scvalPlaces[place]!;
    const at = shape === null ? (n: number) => otherPlaces[place]!.at(n) : (n: number) => scvalPlaces[place]!.at(shapes[shape]!(n));
    let n = levels === "stop" ? 64 : levels;
    if (levels === "stop") {
      let past = 128;
      while (sdkDefaultDecodes(at(past))) [n, past] = [past, past * 2];
      while (past - n > 1) {
        const mid = (n + past) >> 1;
        if (sdkDefaultDecodes(at(mid))) n = mid;
        else past = mid;
      }
      n = past;
    }
    return { place, reads: p.reads, levels: n, stop: levels === "stop", xdr: at(n) };
  });

  it("@stellar/stellar-sdk 17.2.1 writes each envelope row from V2's, at the levels its case gives", () => {
    expect(built.map((b) => b.xdr)).toEqual(envelopes.map((r) => r.xdr));
    for (const [i, b] of built.entries()) expect(envelopes[i]!.case, envelopes[i]!.name).toContain(` ${b.levels} `);
  });

  it("each row's verdict is the cap's on what is read: past 64 there it is refused, anywhere else it reads as unnested", () => {
    for (const [i, b] of built.entries()) {
      const r = envelopes[i]!;
      const refused = b.reads && b.levels > SCVAL_MAX_DEPTH;
      expect(r.accept, r.name).toBe(!refused);
      expect(r.expect, r.name).toBe(refused ? undefined : unnested(b.place));
    }
  });

  // js-xdr 5.0.0's default depth (1,500) refuses each row built at its stopping depth, and one level less decodes: those
  // rows are past what the decoder reads by default, and decodeStellarTx reads every one of them.
  it("every row fits in 8,192 characters and decodes at XDR_MAX_DEPTH; js-xdr's default refuses exactly the stopping rows", () => {
    for (const [i, b] of built.entries()) {
      const r = envelopes[i]!;
      expect(r.xdr.length, r.name).toBeLessThanOrEqual(8192);
      expect(() => xdr.TransactionEnvelope.schema.decode(Buffer.from(r.xdr, "base64"), { maxDepth: XDR_MAX_DEPTH }), r.name).not.toThrow();
      expect(sdkDefaultDecodes(r.xdr), r.name).toBe(!b.stop);
    }
    expect(built.filter((b) => b.stop).length).toBe(17);
  });

  it("a row that decodes reads V2's payment", () => {
    const payment = decodeStellarTx(X.V2.expectEnvelope, "stellar:testnet");
    expect("refused" in payment).toBe(false);
    const decoded = rowsOf(envelopes, "decoder-caps.json scval.envelopes", {
      exact: 46,
      keep: ["the rows decodeStellarTx decodes", (r) => r.accept && r.expect === undefined],
      leave: ["the rows it refuses", (r) => !r.accept || r.expect !== undefined],
    });
    for (const r of decoded) expect(decodeStellarTx(r.xdr, "stellar:testnet"), r.name).toEqual(payment);
  });

  // x402-exact-stellar.json V5: its ref is V2's (V3's) payer entry, and its first row is that envelope landed. Each row
  // that adds an unused entry, a footprint or a delegate is that payment, whatever the depth of what it adds.
  it("a landed payment whose envelope nests anything lcp does not read, at any depth, settles, is found and binds", async () => {
    const ref = X.V5.ref as StellarRef & { transaction: string };
    const landed = X.V5.rows[0];
    const unusedRows = rowsOf(envelopes, "decoder-caps.json scval.envelopes", {
      exact: 43,
      keep: ["the rows whose nesting is in a part lcp does not read, with V2's payment", (r, i) => !built[i]!.reads && r.expect === undefined],
      leave: ["the rows that nest in what lcp reads, or are not one transfer", (r, i) => built[i]!.reads || r.expect !== undefined],
    });
    for (const r of unusedRows) {
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

  // The most contract instances an unused entry's argument holds within 8,192 characters: past js-xdr's default depth,
  // and decoded at XDR_MAX_DEPTH as V2's payment.
  it("an unused entry nesting as many contract instances as 8,192 characters hold is V2's payment", () => {
    let n = 1;
    while (edited(unusedEntry(instances(n + 1))).length <= 8192) n++;
    const deepest = edited(unusedEntry(instances(n)));
    expect(n).toBeGreaterThan(186);
    expect(sdkDefaultDecodes(deepest)).toBe(false);
    expect(decodeStellarTx(deepest, "stellar:testnet")).toEqual(decodeStellarTx(X.V2.expectEnvelope, "stellar:testnet"));
  });

  // x402-exact-stellar.json V2: build over its simulated envelope with an unused entry added past js-xdr's default depth
  // (SE35's entry), and the payer's signature completes V2's envelope with that entry: the writer is not what decides.
  it("build and complete keep an unused entry nested past js-xdr's default depth", async () => {
    const entry = unusedEntry(instances(186));
    const simulatedXdr = edited(entry, X.V2.simulatedXdr);
    const accepted: PaymentRequirements = X.V3.accepted;
    const required: PaymentRequired = { x402Version: 2, resource: X.fixed.resource, accepts: [accepted] };
    const u = await exactStellar.build({ required, accepted, simulatedXdr, currentLedger: X.V2.currentLedger, payer: X.fixed.payer }, X.fixed.H);
    if ("refused" in u) throw new Error(u.code);
    const env = xdr.TransactionEnvelope.fromXdr(X.V2.expectEnvelope, "base64").toXdrObject();
    if (env.type !== 2 || env.v1.tx.operations[0]!.body.type !== 24) throw new Error("not V2's envelope");
    const c = env.v1.tx.operations[0]!.body.invokeHostFunctionOp.auth[0]!.credentials;
    if (c.type !== 1 || c.address.signature.type !== 16) throw new Error("not V2's signature");
    const sig = c.address.signature.vec![0]!;
    if (sig.type !== 17) throw new Error("not V2's signature");
    const signature = sig.map![1]!.val;
    if (signature.type !== 13) throw new Error("not V2's signature");
    expect(u.complete(signature.bytes)).toBe(edited(entry));
  });

  // @stellar/stellar-sdk 17.2.1's XDR schemas, walked as js-xdr 5.0.0 reads them: it enters one level for each union,
  // struct, array, fixed array, optional value and named type. A pass through a recursive type reads at least the bytes
  // of what it holds besides the next pass: a union's 4-byte discriminant, an array's 4-byte length, an optional value's
  // 4-byte flag, and a struct's other fields at their smallest. The rest of a path enters at most every entering schema
  // of the types it passes through, once each. So no envelope of 6,144 bytes enters more than that rest, plus 6,144
  // bytes at the most levels per byte of any pass.
  it("XDR_MAX_DEPTH is above the most levels the SDK's XDR schemas give an envelope of 8,192 characters", () => {
    type Arm = Schema | { kind: "field"; schema: Schema };
    type Schema = {
      kind: string;
      entries?: [string, Schema][];
      cases?: { arm: Arm }[];
      defaultArm?: Arm;
      element?: Schema;
      length?: number;
      getSchema?: () => Schema;
    };
    const ENTERS = new Set(["struct", "union", "array", "fixedArray", "option", "lazy"]);
    const childrenOf = (s: Schema): Schema[] => {
      const arm = (a: Arm): Schema => (a.kind === "field" ? (a as { schema: Schema }).schema : (a as Schema));
      if (s.kind === "struct") return s.entries!.map(([, c]) => c);
      if (s.kind === "union") return [...s.cases!.map((c) => arm(c.arm)), ...(s.defaultArm === undefined ? [] : [arm(s.defaultArm)])];
      if (s.kind === "array" || s.kind === "fixedArray" || s.kind === "option") return [s.element!];
      if (s.kind === "lazy") return [s.getSchema!()];
      return [];
    };
    const nodes: Schema[] = [];
    const id = new Map<Schema, number>();
    const visit = (s: Schema): number => {
      if (!id.has(s)) {
        id.set(s, nodes.length);
        nodes.push(s);
      }
      return id.get(s)!;
    };
    const edges: number[][] = [];
    for (let todo = [visit(xdr.TransactionEnvelope.schema as unknown as Schema)]; todo.length > 0; ) {
      const i = todo.pop()!;
      if (edges[i] !== undefined) continue;
      edges[i] = childrenOf(nodes[i]!).map((c) => {
        const fresh = !id.has(c);
        const j = visit(c);
        if (fresh) todo.push(j);
        return j;
      });
    }
    const fixed: Record<string, number> = { int32: 4, uint32: 4, bool: 4, enum: 4, float: 4, int64: 8, uint64: 8, double: 8, string: 4, varOpaque: 4, void: 0 };
    const least = nodes.map(() => Infinity);
    for (let changed = true; changed; ) {
      changed = false;
      nodes.forEach((s, i) => {
        const sizes = edges[i]!.map((j) => least[j]!);
        const v =
          s.kind in fixed ? fixed[s.kind]!
          : s.kind === "opaque" ? Math.ceil(s.length! / 4) * 4
          : s.kind === "struct" ? sizes.reduce((a, b) => a + b, 0)
          : s.kind === "union" ? 4 + Math.min(...sizes)
          : s.kind === "array" || s.kind === "option" ? 4
          : s.kind === "fixedArray" ? s.length! * sizes[0]!
          : s.kind === "lazy" ? sizes[0]!
          : NaN;
        if (Number.isNaN(v)) throw new Error(`a schema of kind ${s.kind}`);
        if (v < least[i]!) [least[i], changed] = [v, true];
      });
    }
    /** The bytes a pass reads at node i besides child k. */
    const besides = (i: number, k: number): number => {
      const s = nodes[i]!;
      if (s.kind === "struct") return edges[i]!.reduce((a, j, m) => (m === k ? a : a + least[j]!), 0);
      if (s.kind === "fixedArray") return (s.length! - 1) * least[edges[i]![0]!]!;
      return s.kind === "lazy" ? 0 : 4;
    };
    // The recursive types: every simple cycle, found from its least node, and the most levels per byte of any.
    let densest = { levels: 0, bytes: 1 };
    let cycles = 0;
    for (let start = 0; start < nodes.length; start++) {
      const walk = (i: number, levels: number, bytes: number, on: Set<number>): void => {
        edges[i]!.forEach((j, k) => {
          const [l, b] = [levels + (ENTERS.has(nodes[i]!.kind) ? 1 : 0), bytes + besides(i, k)];
          if (j === start) {
            cycles++;
            if (l * densest.bytes > densest.levels * b) densest = { levels: l, bytes: b };
          } else if (j > start && !on.has(j)) walk(j, l, b, new Set(on).add(j));
        });
      };
      walk(start, 0, 0, new Set([start]));
    }
    expect(cycles).toBe(10);
    expect(densest).toEqual({ levels: 8, bytes: 20 });
    // The rest of a path: the most entering schemas along the components' order, each component counted whole.
    const reach = (from: number): Set<number> => {
      const seen = new Set([from]);
      for (const todo = [from]; todo.length > 0; ) for (const j of edges[todo.pop()!]!) if (!seen.has(j)) todo.push(j), seen.add(j);
      return seen;
    };
    const reaches = nodes.map((_, i) => reach(i));
    const component = nodes.map((_, i) => [...reaches[i]!].filter((j) => reaches[j]!.has(i)));
    const memo = new Map<number, number>();
    const rest = (i: number): number => {
      const c = component[i]!;
      const key = Math.min(...c);
      if (memo.has(key)) return memo.get(key)!;
      const own = c.filter((j) => ENTERS.has(nodes[j]!.kind)).length;
      let after = 0;
      for (const j of c) for (const k of edges[j]!) if (!c.includes(k)) after = Math.max(after, rest(k));
      memo.set(key, own + after);
      return own + after;
    };
    const most = rest(0) + Math.floor((6144 * densest.levels) / densest.bytes);
    expect(rest(0)).toBe(37);
    expect(most).toBe(2494);
    expect(most).toBeLessThan(XDR_MAX_DEPTH);
  });
});
