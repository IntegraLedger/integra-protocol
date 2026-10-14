// The decoder caps: vectors/decoder-caps.json. XRPL binary, msgpack and ScVal each have a nesting cap, and each row
// says whether the caps admit its input.
import { readFileSync } from "node:fs";
import { xdr } from "@stellar/stellar-sdk/base";
import { msgpackRawDecodeAsMap } from "algosdk";
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
import { rowsOf } from "./rows.js";
import { wellFormedUtf8 } from "./utf8-syntax.js";

const V = JSON.parse(readFileSync(new URL("../vectors/decoder-caps.json", import.meta.url), "utf8"));
type Row = { name: string; case: string; accept: boolean };
/**
 * How x402-exact-algorand.json V3.refusals ends the case of each row that writes a string the scan refuses: one that is
 * not UTF-8, or one longer than 200 bytes that begins with the byte-order mark.
 */
const SCAN_REFUSES = [
  "a string that is not well-formed UTF-8 (RFC 3629 §4)",
  "a string longer than 200 bytes that begins with the byte-order mark EF BB BF, which algosdk 3.8.0's decoder reads without the mark",
];

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
  // The payment entries of x402-exact-algorand.json V3.refusals whose case ends in one of SCAN_REFUSES each hold a
  // string the scan refuses; every other signed transaction in the file passes the scan.
  it("every signed transaction in the Algorand vectors is within the caps, but the six with a string the scan refuses", () => {
    const A = readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8");
    const refusedByScan = (r: { case: string }) => SCAN_REFUSES.some((end) => r.case.endsWith(end));
    const refused = new Set(
      rowsOf(JSON.parse(A).V3.refusals as { case: string; paymentIndex: number; paymentGroup: string[] }[], "x402-exact-algorand.json V3.refusals", {
        exact: 6,
        keep: ["the rows with a string the scan refuses", refusedByScan],
        leave: ["every other row, whose entry the loop below finds within the caps", (r) => !refusedByScan(r)],
      }).map((r) => r.paymentGroup[r.paymentIndex]!),
    );
    expect(refused.size).toBe(6);
    const entries = rowsOf([...A.matchAll(/"(g[A-Za-z0-9+/]{40,}={0,2})"/g)].map((m) => m[1]!), "x402-exact-algorand.json signed transactions in base64", {
      min: refused.size + 1,
    });
    for (const e of entries) {
      expect(msgpackWithinCaps(Uint8Array.from(Buffer.from(e, "base64")), MSGPACK_MAX_DEPTH)).toBe(!refused.has(e));
    }
  });
});

// The msgpack specification's type system: "String extending Raw type represents a UTF-8 string", and a decoder's
// behaviour on "invalid byte sequence" in one "depends on the actual implementation". The scan admits a string only
// when it is well-formed UTF-8; each verdict below is RFC 3629 §4's syntax (utf8-syntax.ts), never the scan's own
// decoder.
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

describe("msgpack: every string is well-formed UTF-8", () => {
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
    for (const format of ["fixstr", "str 8", "str 16", "str 32"] as const) {
      it(`a ${format} as ${place}: admitted exactly when RFC 3629 §4's syntax takes it`, () => {
        for (const [name, h] of [...Object.entries(wellFormed), ...Object.entries(illFormed)]) {
          expect(scans(at(str(hex(h), format))), name).toBe(wellFormedUtf8(hex(h)));
        }
      });
    }
  }

  it("a str 16 of 300 bytes is refused for one ill-formed byte anywhere in it", () => {
    const text = new Uint8Array(300).fill(0x78);
    expect(scans(str(text, "str 16"))).toBe(true);
    for (const i of [0, 1, 150, 298, 299]) {
      const one = text.slice();
      one[i] = 0xc1;
      expect(scans(str(one, "str 16")), `byte ${i}`).toBe(false);
    }
  });

  // Every string of one or two bytes; and for each lead byte from 0xE0 to 0xF7, every second byte with the other bytes
  // at the edges of the continuation range, and every last byte after a second byte at those edges. The test has no time
  // bound (0): it checks a fixed list of strings and returns, so how long it takes depends only on the machine.
  it("every string of one or two bytes, and of three or four at each lead byte's edges, as a fixstr", () => {
    let count = 0;
    const differ: string[] = [];
    const check = (...s: number[]) => {
      count++;
      const value = Uint8Array.of(0xa0 | s.length, ...s);
      if (msgpackWithinCaps(value, MSGPACK_MAX_DEPTH) !== wellFormedUtf8(value.subarray(1))) {
        differ.push(Buffer.from(s).toString("hex"));
      }
    };
    for (let a = 0; a < 256; a++) {
      check(a);
      for (let b = 0; b < 256; b++) check(a, b);
    }
    const edges = [0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0];
    for (let a = 0xe0; a <= 0xf7; a++) {
      for (let x = 0; x < 256; x++) {
        for (const c of edges) {
          check(a, x, c);
          check(a, x, c, 0x80);
          check(a, x, c, 0xc0);
        }
        for (const b of edges) {
          check(a, b, x);
          check(a, b, 0x80, x);
        }
      }
    }
    expect([count, differ]).toEqual([256 + 256 * 256 + 24 * 256 * 8 * 5, []]);
  }, 0);

  it("binary (bin 8, bin 16, bin 32) and extension bytes are not text: they pass whatever bytes they hold", () => {
    for (const h of Object.values(illFormed)) {
      const b = [...hex(h)];
      expect(scans([0xc4, b.length, ...b]), h).toBe(true);
      expect(scans([0xc5, 0, b.length, ...b]), h).toBe(true);
      expect(scans([0xc6, 0, 0, 0, b.length, ...b]), h).toBe(true);
      expect(scans([0xc7, b.length, 0x05, ...b]), h).toBe(true);
    }
  });
});

// algosdk 3.8.0's decodeSignedTransaction reads a payment entry with its msgpackRawDecodeAsMap, through algorand-msgpack
// 1.1.0. The scan admits a string exactly when that decoder reads it as the text its bytes spell: the text a fatal
// TextDecoder that keeps a byte-order mark reads. On well-formed UTF-8 the two part only where algorand-msgpack drops a
// leading mark, which it does from a string longer than a threshold of its own. The test finds that threshold where
// the readings part, never from a written number, and checks the scan at every length on both sides of it.
describe("msgpack: algosdk reads every string the scan admits as the text its bytes spell", () => {
  const spelled = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  /** `length` bytes of x, the first three replaced by the byte-order mark EF BB BF when `marked`. */
  const text = (length: number, marked: boolean) =>
    Uint8Array.from({ length }, (_, k) => (marked && k < 3 ? [0xef, 0xbb, 0xbf][k]! : 0x78));
  /** `s` in the smallest string format that holds it. */
  const smallest = (s: Uint8Array) => str(s, s.length < 32 ? "fixstr" : s.length < 256 ? "str 8" : "str 16");
  /** A string as a fixmap's one key, and as its one value under the key a; and how each is read back from the map. */
  const AS: Record<string, [(s: number[]) => number[], (m: Map<unknown, unknown>) => unknown]> = {
    "a map key": [(s) => [0x81, ...s, 0x01], (m) => [...m.keys()][0]],
    "a map value": [(s) => [0x81, 0xa1, 0x61, ...s], (m) => m.get("a")],
  };

  it("a string of 1 to 400 bytes, with or without a leading mark, is admitted exactly when algosdk reads it as spelled", () => {
    const admittedOtherwise: string[] = [];
    const parted: Record<string, number[]> = {};
    for (const [as, [at, read]] of Object.entries(AS)) {
      for (const marked of [false, true]) {
        const where = `${as}${marked ? " that begins with the mark" : " without the mark"}`;
        const lengths: number[] = (parted[where] = []);
        for (let length = marked ? 3 : 1; length <= 400; length++) {
          const s = text(length, marked);
          const bytes = at(smallest(s));
          const asSpelled = read(msgpackRawDecodeAsMap(Uint8Array.from(bytes)) as Map<unknown, unknown>) === spelled.decode(s);
          if (!asSpelled) lengths.push(length);
          if (scans(bytes) !== asSpelled) admittedOtherwise.push(`${where}, ${length} bytes: ${scans(bytes) ? "admitted" : "refused"}`);
        }
      }
    }
    expect(admittedOtherwise).toEqual([]);
    expect([parted["a map key without the mark"], parted["a map value without the mark"]]).toEqual([[], []]);
    // The readings part at one length and stay apart to 400 bytes, as a key and as a value: algorand-msgpack's threshold
    // is the length before it, and a marked string of that length or shorter keeps its mark.
    const marked = parted["a map value that begins with the mark"]!;
    expect(marked.length).toBeGreaterThan(0);
    const threshold = marked[0]! - 1;
    expect(threshold).toBeGreaterThan(3);
    expect(marked).toEqual(Array.from({ length: 400 - threshold }, (_, k) => threshold + 1 + k));
    expect(parted["a map key that begins with the mark"]).toEqual(marked);
  });

  // The msgpack rows that hold a string the scan judges, each named here with its string's bytes, which the row writes
  // as a fixstr or a str 8. A row's accept is whether RFC 3629 §4's syntax (utf8-syntax.ts) takes the string and algosdk
  // reads it as the text its bytes spell; the rows loop above checks the scan against each accept.
  it("each msgpack row holding a judged string is admitted exactly when the string is UTF-8 that algosdk reads as spelled", () => {
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
      leave: ["MC1 to MC10, which judge nesting, declared lengths and one value; the rows loop above runs them", (r) => !(r.name in strings)],
    });
    for (const r of rows) {
      const s = Uint8Array.from(Buffer.from(strings[r.name]!, "hex"));
      const written = [smallest(s), str(s, "str 8")].map((w) => Buffer.from(w).toString("hex"));
      expect(written.some((w) => r.hex.includes(w)), r.name).toBe(true);
      const asSpelled = wellFormedUtf8(s) && msgpackRawDecodeAsMap(Uint8Array.from(smallest(s))) === spelled.decode(s);
      expect(asSpelled, r.name).toBe(r.accept);
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
  for (const r of rowsOf(V.scval.envelopes as (Row & { xdr: string; expect?: string })[], "decoder-caps.json scval.envelopes", { exact: 8 })) {
    it(`${r.name}: ${r.case} → ${r.accept ? (r.expect ?? "decoded") : "stellar/tx-malformed"}`, () => {
      const d = decodeStellarTx(r.xdr, "stellar:testnet");
      if (r.accept && r.expect !== undefined) expect(d).toEqual({ refused: true, code: r.expect });
      else if (r.accept) expect("refused" in d).toBe(false);
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
  const key = (b: number) => ({ type: 0 as const, ed25519: new Uint8Array(32).fill(b) });
  /** A second entry under address credentials with delegates, each delegate the one nested delegate of the one above. */
  const delegatesEntry = (levels: number) =>
    edited((op) => {
      type Delegate = { address: { type: 0; accountId: ReturnType<typeof key> }; signature: ScValWire; nestedDelegates: Delegate[] };
      let d: Delegate = { address: { type: 0, accountId: key(4) }, signature: { type: 1 }, nestedDelegates: [] };
      for (let i = 1; i < levels; i++) d = { address: { type: 0, accountId: key(4) }, signature: { type: 1 }, nestedDelegates: [d] };
      op.auth.push({
        credentials: {
          type: 3,
          addressWithDelegates: {
            addressCredentials: { address: { type: 0, accountId: key(4) }, nonce: 0n, signatureExpirationLedger: 0, signature: { type: 1 } },
            delegates: [d],
          },
        },
        rootInvocation: chain(1),
      } as never);
    });
  /** The operation replaced by a create-claimable-balance whose claimant's predicate is `levels` deep: nots around an unconditional. */
  const claimPredicate = (levels: number): string => {
    const env = xdr.TransactionEnvelope.fromXdr(X.V2.expectEnvelope, "base64").toXdrObject();
    if (env.type !== 2) throw new Error("not V2's envelope");
    type Predicate = { type: 0 } | { type: 3; notPredicate: Predicate };
    let p: Predicate = { type: 0 };
    for (let i = 1; i < levels; i++) p = { type: 3, notPredicate: p };
    (env.v1.tx.operations[0] as { body: unknown }).body = {
      type: 14,
      createClaimableBalanceOp: { asset: { type: 0 }, amount: 1n, claimants: [{ type: 0, v0: { destination: key(5), predicate: p } }] },
    };
    return xdr.TransactionEnvelope.fromXdrObject(env).toXdr("base64");
  };

  it("@stellar/stellar-sdk 17.2.1 writes each envelope row from V2's", () => {
    const built = [
      payerSignature(64),
      payerSignature(65),
      secondEntry(65, 1),
      secondEntry(0, 65),
      payerInvocations(65),
      operationArgument(65),
      delegatesEntry(66),
      claimPredicate(66),
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
    const unused = rowsOf(V.scval.envelopes as (Row & { xdr: string })[], "decoder-caps.json scval.envelopes", {
      exact: 3,
      keep: ["SE3, SE4 and SE7, whose second authorization entry decodeStellarTx never walks", (e) => ["SE3", "SE4", "SE7"].includes(e.name)],
      leave: [
        "SE1, SE2, SE5, SE6 and SE8, which change the payer's entry or the operation that decodeStellarTx reads; the envelope tests above run them",
        (e) => ["SE1", "SE2", "SE5", "SE6", "SE8"].includes(e.name),
      ],
    });
    expect(unused.length).toBe(3);
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
