// Runs the Hedera vector files through the hedera entry point. Every expected value is the files', or names its source.
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { pairingOf, toLcpString, type AtrHash } from "../src/index.js";
import {
  chargeHedera,
  decodeHederaTx,
  exactHedera,
  exactHederaExecutor,
  executorStatus,
  hederaIdDigest,
  hederaStatus,
  txIdMirror,
  txIdText,
  type HederaReader,
  type HederaUnsigned,
  type MirrorEntry,
} from "../src/hedera.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const V = load("x402-exact-hedera.json");
const X = load("x402-exact-hedera-transfer-executor.json");
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

function readerOf(entries: MirrorEntry[] | null | "reader-error", network = "hedera:testnet"): HederaReader {
  return {
    network: network as HederaReader["network"],
    transactions: async () => {
      if (entries === "reader-error") throw new Error("transport");
      return entries;
    },
  };
}

function presentedOf(transaction: string, accepted: PaymentRequirements = O) {
  return { x402Version: 2 as const, resource: V.fixed.resource, accepted, payload: { transaction } };
}

describe("x402-exact-hedera.json", () => {
  const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
  const unsigned = async (accepted = O, decimals?: number) => {
    const u = await exactHedera.build(
      {
        required: { ...required, accepts: [accepted] },
        accepted,
        payer: V.fixed.payer,
        node: V.fixed.node,
        validStart: { seconds: BigInt(V.fixed.validStart.seconds), nanos: V.fixed.validStart.nanos },
        maxFee: BigInt(V.fixed.maxFee),
        ...(decimals !== undefined ? { decimals } : {}),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    return u as HederaUnsigned;
  };

  it("V1: the memo is H's LCP string, 77 bytes, and its memo_base64", () => {
    const memo = toLcpString(H);
    expect(memo).toBe(V.V1.expectMemo);
    expect(Buffer.byteLength(memo, "utf8")).toBe(V.fixed.Lbytes);
    expect(Buffer.from(memo, "utf8").toString("base64")).toBe(V.V1.expectMemoBase64);
  });

  it("V2: build gives the 131 body bytes; the signature over them completes the 241-byte transaction", async () => {
    const u = await unsigned();
    expect(u.request.kind).toBe("hedera-body");
    expect(hex(u.request.bodyBytes)).toBe(V.V2.expectBodyBytes);
    expect(u.request.bodyBytes.length).toBe(V.V2.expectBodyLength);
    const publicKey = fromHex(V.fixed.publicKey);
    const signature = fromHex(V.fixed.signature);
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") }, format: "jwk" });
    expect(verify(null, u.request.bodyBytes, key, signature)).toBe(true);
    const tx = u.complete({ publicKey, signature, type: "ed25519" });
    expect(tx).toBe(V.V2.expectTransactionBase64);
    expect(fromB64(tx as string).length).toBe(V.V2.expectTransactionLength);
  });

  it("V2: bound, reference and the two id forms", async () => {
    const p = presentedOf(V.V2.expectTransactionBase64);
    expect(await exactHedera.bound(p)).toBe(V.V2.expectBound);
    const ref = await exactHedera.reference(p);
    expect(ref).toEqual(V.V2.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const decoded = decodeHederaTx(fromB64(V.V2.expectTransactionBase64));
    if ("refused" in decoded) throw new Error(decoded.code);
    expect(txIdText(decoded.bodies[0]!.id)).toBe(V.V2.expectTxIdText);
    expect(txIdMirror(decoded.bodies[0]!.id)).toBe(V.V2.expectReference.transactionId);
  });

  it("V2 presented under an option whose amount or timeout bound does not read: H and V2's reference", async () => {
    for (const row of rowsOf(V.V2.presentedOptions, "x402-exact-hedera.json V2.presentedOptions")) {
      const p = presentedOf(V.V2.expectTransactionBase64, row.accepted);
      expect([row.case, await exactHedera.bound(p)]).toEqual([row.case, row.expectBound]);
      expect([row.case, await exactHedera.reference(p)]).toEqual([row.case, row.expectReference]);
    }
    // advertise and build need a positive timeout and a decimal amount: build writes the transfers from the amount.
    const timeoutZero = V.V2.presentedOptions.find((r: { accepted: PaymentRequirements }) => r.accepted.maxTimeoutSeconds === 0).accepted;
    for (const accepted of [timeoutZero, { ...O, amount: "x" }]) {
      const doc = { ...required, accepts: [accepted] };
      expect(exactHedera.advertise(doc, H, V.fixed.link, accepted)).toEqual({ refused: true, code: "hedera/option-malformed" });
      await expect(unsigned(accepted)).rejects.toThrow("hedera/option-malformed");
    }
    const { maxTimeoutSeconds: _, ...noTimeout } = O;
    for (const accepted of [noTimeout, { ...O, amount: "x" }]) {
      expect(await exactHedera.bound(presentedOf(V.V2.expectTransactionBase64, accepted as PaymentRequirements))).toBe(V.V2.expectBound);
    }
    const { feePayer: __, ...noFeePayer } = O.extra!;
    expect(await exactHedera.bound(presentedOf(V.V2.expectTransactionBase64, { ...O, extra: noFeePayer }))).toEqual({
      refused: true,
      code: "hedera/option-malformed",
    });
  });

  // x402's Hedera scheme gives `amount` no sign rule, and hiero-consensus-node's CryptoTransferValidator refuses a
  // transfer list for a non-zero sum or a repeated account, not for a zero row. The body bytes are hiero-sdk-python
  // 0.2.10's generated protobufs (protobuf 7.36.2, SerializeToString(deterministic=True)) for V2's inputs with amount
  // 0, the tool that wrote V2: a zero `amount` (AccountAmount field 2) is not written.
  const zeroAmountBody =
    "0a0d0a060880e2cfaa06120318d309120218031880c2d72f22020878324d6c63703a7368613235363a30786261373831366266386630316366" +
    "656134313431343064653564616532323233623030333631613339363137376139636234313066663631663230303135616472100a0e0a050a" +
    "0318b32b0a050a0318d209";
  it("an option whose amount is 0 is served: advertise, read, pairingOf and build", async () => {
    const zero = { ...O, amount: "0" };
    const doc = exactHedera.advertise({ ...required, accepts: [zero] }, H, V.fixed.link, zero);
    if ("refused" in doc) throw new Error(doc.code);
    const r = exactHedera.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.offer.options).toEqual([zero]);
    expect(pairingOf(zero)).toBe("x402/exact/hedera");
    expect(hex((await unsigned(zero)).request.bodyBytes)).toBe(zeroAmountBody);
    const tooLarge = { ...O, amount: "9223372036854775808" };
    expect(exactHedera.advertise({ ...required, accepts: [tooLarge] }, H, V.fixed.link, tooLarge)).toEqual({
      refused: true,
      code: "hedera/option-malformed",
    });
  });

  it("V3: the list form gives H; an inconsistent list is refused", async () => {
    expect(await exactHedera.bound(presentedOf(V.V3.listBase64))).toBe(V.V3.expectBound);
    expect(await exactHedera.bound(presentedOf(V.V3.inconsistentListBase64))).toEqual({
      refused: true,
      code: V.V3.expectInconsistent,
    });
  });

  it("V4 under x402: the attribution memo is not an LCP string", async () => {
    expect(await exactHedera.bound(presentedOf(V.V4x.transactionBase64))).toEqual({
      refused: true,
      code: V.V4x.expectRefusal,
    });
  });

  it("V5: status for each reader answer, and recover", async () => {
    for (const row of rowsOf(V.V5.rows, "x402-exact-hedera.json V5.rows")) {
      expect(await hederaStatus(V.V5.reference, readerOf(row.entries))).toEqual(row.expect);
    }
    expect(await exactHedera.recover(V.V5.reference, readerOf(V.V5.recover.entries))).toBe(V.V5.recover.expect);
  });

  // A Hedera transaction that reaches consensus with a status other than SUCCESS is final: the network charges its fee
  // and makes none of its transfers (HAPI: the TransactionReceipt's status, a ResponseCodeEnum, and the Mirror Node's
  // `result`), as the V5 status rows read it, failed with that result. recover refuses such entries hedera/not-success, as the MPP Hedera
  // charge's fetchPresented does; a transaction id that no counted user entry uses yet is a read to repeat,
  // hedera/not-found (docs/reference/refusals.md).
  it("V5: recover refuses counted user entries with no SUCCESS as hedera/not-success, and none yet as hedera/not-found", async () => {
    type Row = { entries: MirrorEntry[] | null | "reader-error"; expect: { state: string; why?: string } };
    const failedRow = (r: Row) => r.expect.state === "failed" && r.expect.why!.startsWith("result:");
    for (const row of rowsOf(V.V5.rows as Row[], "x402-exact-hedera.json V5.rows", {
      keep: ["the rows status answers failed with a result", failedRow],
      leave: ["every other row", (r) => !failedRow(r)],
    })) {
      expect(await exactHedera.recover(V.V5.reference, readerOf(row.entries)), JSON.stringify(row.entries)).toEqual({
        refused: true,
        code: "hedera/not-success",
      });
    }
    const notFound = (r: Row) => r.expect.state === "pending" && r.expect.why === "not-found";
    for (const row of rowsOf(V.V5.rows as Row[], "x402-exact-hedera.json V5.rows", {
      keep: ["the rows status answers pending not-found", notFound],
      leave: ["every other row", (r) => !notFound(r)],
    })) {
      expect(await exactHedera.recover(V.V5.reference, readerOf(row.entries)), JSON.stringify(row.entries)).toEqual({
        refused: true,
        code: "hedera/not-found",
      });
    }
  });

  it("status of a reader for another network is pending unreadable", async () => {
    expect(await hederaStatus(V.V5.reference, readerOf(V.V5.rows[0].entries, "hedera:mainnet"))).toEqual({
      state: "pending",
      why: "unreadable",
    });
  });

  it("plant 1: a duplicate read first never hides the settled entry", async () => {
    const plant = V.plants.duplicateFirst;
    expect(await hederaStatus(V.V5.reference, readerOf(plant.entries))).toEqual(plant.expect);
  });

  it("plant 2: a transfer with no memo is refused before anything is sent, though it echoes the extension", async () => {
    const plant = V.plants.noMemo;
    const doc = exactHedera.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    const echoed = { ...presentedOf(plant.transactionBase64), extensions: doc.extensions };
    expect(await exactHedera.bound(echoed)).toEqual({
      refused: true,
      code: plant.expectRefusal,
    });
  });

  it("the refusal rows", async () => {
    for (const row of rowsOf(V.refusals, "x402-exact-hedera.json refusals")) {
      if (row.transactionBase64 !== undefined) {
        expect(await exactHedera.bound(presentedOf(row.transactionBase64))).toEqual({ refused: true, code: row.expect });
      } else {
        expect(pairingOf(row.option)).toBeUndefined();
        const doc = { ...required, accepts: [row.option] };
        expect(exactHedera.advertise(doc, H, V.fixed.link, row.option)).toEqual({ refused: true, code: row.expect });
      }
    }
  });

  // P2's option check: assetTransferMethod absent or "cryptoTransfer" names this pairing, "transferExecutor" the
  // executor pairing, and any other value, null included, is hedera/option-malformed: at advertise (the row above) and
  // at each pairing's build. read skips such an option, as any other that fails the check.
  it("the null assetTransferMethod rows: each pairing's build refuses with the row's code", async () => {
    const rows = rowsOf(V.refusals as { case: string; option?: PaymentRequirements; expect: string; expectRead?: string }[], "x402-exact-hedera.json refusals", {
      exact: 2,
      keep: ["the option rows whose assetTransferMethod is null", (r) => r.option !== undefined && r.option.extra?.["assetTransferMethod"] === null],
      leave: [
        "the transaction rows and the option rows with another assetTransferMethod, which the refusal rows test runs at bound or advertise",
        (r) => r.option === undefined || r.option.extra?.["assetTransferMethod"] !== null,
      ],
    });
    expect(rows).toHaveLength(2);
    const [exact, executor] = rows as { case: string; option: PaymentRequirements; expect: string }[];
    const exactBuilt = await exactHedera.build(
      {
        required: { ...required, accepts: [exact!.option] },
        accepted: exact!.option,
        payer: V.fixed.payer,
        node: V.fixed.node,
        validStart: { seconds: BigInt(V.fixed.validStart.seconds), nanos: V.fixed.validStart.nanos },
        maxFee: BigInt(V.fixed.maxFee),
      },
      H,
    );
    expect(exactBuilt).toEqual({ refused: true, code: exact!.expect });
    const doc = { x402Version: 2 as const, resource: X.fixed.resource, accepts: [executor!.option] };
    const executorBuilt = await exactHederaExecutor.build({ required: doc, accepted: executor!.option, now: X.fixed.now }, H);
    expect(executorBuilt).toEqual({ refused: true, code: executor!.expect });
    const legalContext = { info: { type: "sha256", value: H, legalContextUrl: V.fixed.link } };
    for (const r of rows) {
      const d = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [r.option!], extensions: { legalContext } };
      expect(r.expectRead).toBe("x402/no-payable-option");
      expect(exactHedera.read(d as never)).toEqual({ refused: true, code: r.expectRead });
      expect(exactHederaExecutor.read(d as never)).toEqual({ refused: true, code: r.expectRead });
    }
  });

  it("token build: expected_decimals is written when given, even zero", async () => {
    const token = { ...O, asset: V.tokenBuild.asset };
    expect(hex((await unsigned(token, 6)).request.bodyBytes)).toBe(V.tokenBuild.expectBodyBytesDecimals6);
    expect(hex((await unsigned(token, 0)).request.bodyBytes)).toBe(V.tokenBuild.expectBodyBytesDecimals0);
  });

  it("advertise places the legal context and leaves the option; read gives it back", () => {
    const doc = exactHedera.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(O);
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: V.fixed.link });
    const r = exactHedera.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
    expect(r.link).toBe(V.fixed.link);
    expect(r.offer.options).toEqual([O]);
    expect(exactHedera.unplaced(O)).toBe(O);
  });

  it("MPP chain ids map to the two networks named, and nothing else", () => {
    const network = (chainId: number) => chargeHedera.network({ methodDetails: { chainId } });
    expect(network(295)).toBe("hedera:mainnet");
    expect(network(296)).toBe("hedera:testnet");
    expect(network(297)).toEqual({ refused: true, code: "hedera/chain-id-unnamed" });
  });
});

describe("x402-exact-hedera-transfer-executor.json", () => {
  const OX: PaymentRequirements = X.fixed.O;
  const required: PaymentRequired = { x402Version: 2, resource: X.fixed.resource, accepts: [OX] };
  const advertised = () => {
    const doc = exactHederaExecutor.advertise(required, H, X.fixed.link, OX);
    if ("refused" in doc) throw new Error(doc.code);
    return doc;
  };
  const built = async () => {
    const b = await exactHederaExecutor.build({ required: advertised(), accepted: OX, now: X.fixed.now }, H);
    if ("refused" in b) throw new Error(b.code);
    return b;
  };

  it("pairingOf names the pairing of each option it serves; advertise refuses the others", () => {
    for (const row of rowsOf(X.pairingOf as { option: PaymentRequirements; expect: string }[], "x402-exact-hedera-transfer-executor.json pairingOf")) {
      if (row.expect.startsWith("x402/")) {
        expect(pairingOf(row.option)).toBe(row.expect);
        continue;
      }
      expect(pairingOf(row.option)).toBeUndefined();
      const pairing = row.option.extra?.["assetTransferMethod"] === "transferExecutor" ? exactHederaExecutor : exactHedera;
      const doc = { ...required, accepts: [row.option] };
      expect(pairing.advertise(doc, H, X.fixed.link, row.option)).toEqual({ refused: true, code: row.expect });
    }
  });

  // x402's Hedera scheme gives `amount` no sign rule; the request carries the option's amount as written.
  it("an option whose amount is 0 is served: advertise, read, pairingOf and build", async () => {
    const zero = { ...OX, amount: "0" };
    const doc = exactHederaExecutor.advertise({ ...required, accepts: [zero] }, H, X.fixed.link, zero);
    if ("refused" in doc) throw new Error(doc.code);
    const r = exactHederaExecutor.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.offer.options).toEqual([zero]);
    expect(pairingOf(zero)).toBe("x402/exact/hedera/transfer-executor");
    const b = await exactHederaExecutor.build({ required: doc, accepted: zero, now: X.fixed.now }, H);
    if ("refused" in b) throw new Error(b.code);
    expect(b.request).toEqual({ ...X.build.expectRequest, amount: "0" });
  });

  it("build's request, and complete", async () => {
    const b = await built();
    expect(b.request).toEqual(X.build.expectRequest);
    const payment = b.complete(X.fixed.payload);
    if ("refused" in payment) throw new Error(payment.code);
    expect(payment.payload).toEqual(X.fixed.payload);
    expect(payment.accepted).toEqual(OX);
    for (const row of rowsOf(X.complete, "x402-exact-hedera-transfer-executor.json complete")) {
      const { expect: code, source: _, ...change } = row;
      expect(b.complete({ ...X.fixed.payload, ...change })).toEqual({ refused: true, code });
    }
  });

  // validBefore is now plus the option's maxTimeoutSeconds, 120 here; 9007199254740991 is Number.MAX_SAFE_INTEGER,
  // 2^53 - 1 (ECMA-262, Number.MAX_SAFE_INTEGER), the last integer a number holds exactly with its successor.
  it("build: validBefore is now plus maxTimeoutSeconds, and a now whose sum passes 2^53 - 1 is refused", async () => {
    const at = (now: number) => exactHederaExecutor.build({ required: advertised(), accepted: OX, now }, H);
    const last = await at(9007199254740991 - 120);
    if ("refused" in last) throw new Error(last.code);
    expect(last.request.validBefore).toBe(9007199254740991);
    for (const now of [9007199254740991 - 119, 9007199254740991]) {
      expect(await at(now)).toEqual({ refused: true, code: "hedera/option-malformed" });
    }
  });

  // settleBy is the time reference runs, in Unix seconds, plus maxTimeoutSeconds; the clock is held at the vector's now
  // (1755500000), and 9007199254740991 is Number.MAX_SAFE_INTEGER, 2^53 - 1 (ECMA-262). build runs at now 0 so that its
  // validBefore, 0 plus the timeout, stays a safe integer for every timeout here.
  it("reference: settleBy is the time reference runs plus maxTimeoutSeconds, and a sum past 2^53 - 1 is refused", async () => {
    const at = async (maxTimeoutSeconds: number) => {
      const o = { ...OX, maxTimeoutSeconds };
      const doc = exactHederaExecutor.advertise({ ...required, accepts: [o] }, H, X.fixed.link, o);
      if ("refused" in doc) throw new Error(doc.code);
      const b = await exactHederaExecutor.build({ required: doc, accepted: doc.accepts[0]!, now: 0 }, H);
      if ("refused" in b) throw new Error(b.code);
      const payment = b.complete(X.fixed.payload);
      if ("refused" in payment) throw new Error(payment.code);
      return exactHederaExecutor.reference(payment);
    };
    const clock = vi.spyOn(Date, "now").mockReturnValue(X.fixed.now * 1000);
    try {
      expect(await at(120)).toMatchObject({ settleBy: X.fixed.now + 120 });
      expect(await at(9007199254740991 - X.fixed.now)).toMatchObject({ settleBy: 9007199254740991 });
      for (const t of [9007199254740991 - X.fixed.now + 1, 9007199254740991]) {
        expect(await at(t), String(t)).toEqual({ refused: true, code: "hedera/option-malformed" });
      }
    } finally {
      clock.mockRestore();
    }
  });

  it("bound reads the echoed extension; reference gives the payer's digest", async () => {
    const payment = (await built()).complete(X.fixed.payload);
    if ("refused" in payment) throw new Error(payment.code);
    expect(await exactHederaExecutor.bound(payment)).toBe(X.bound.expectWithExtension);
    const { extensions: _, ...bare } = payment;
    expect(await exactHederaExecutor.bound(bare)).toEqual({ refused: true, code: X.bound.expectWithoutExtension });
    const ref = await exactHederaExecutor.reference(payment);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.idDigest).toBe(X.reference.expectIdDigest);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    expect(await hederaIdDigest(X.fixed.payload.payer)).toBe(X.reference.expectIdDigest);
  });

  for (const [i, row] of rowsOf(X.status.rows as { case?: string; reference?: object; entries: MirrorEntry[] | null; expect: unknown }[], "x402-exact-hedera-transfer-executor.json status.rows").entries()) {
    it(`executorStatus: ${row.case ?? `row ${i}`}`, async () => {
      const ref = { ...X.status.reference, ...(row.reference ?? {}) };
      expect(await executorStatus(ref, readerOf(row.entries))).toEqual(row.expect);
    });
  }

  it("plant: a debit from an account other than the payer settles nothing", async () => {
    expect(await executorStatus(X.status.reference, readerOf(X.plant.entries))).toEqual(X.plant.expect);
  });

  it("the record states the agreement step and no public proof", () => {
    expect(exactHederaExecutor.pattern.publicProof).toBe(false);
    expect(exactHederaExecutor.claims).toBe(false);
    expect(exactHedera.pattern.publicProof).toBe(true);
    expect(exactHedera.claims).toBe(true);
  });
});
