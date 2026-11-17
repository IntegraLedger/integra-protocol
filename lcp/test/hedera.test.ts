// Runs the Hedera vector files through the hedera entry point. Every expected value is the files', or names its source.
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { pairingOf, toLcpString, type AtrHash } from "../src/index.js";
import {
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

/** A mirror's answers, as a vector row gives them. */
export interface Mirror {
  latest?: string;
  oldest?: string;
  byId: MirrorEntry[] | null | "reader-error";
  pages?: ({ transactions: MirrorEntry[]; next: string | null } | "refused")[];
}

/** A reader answering a row's mirror: the latest and oldest timestamps, the entries under the id, and the pages in order. */
function mirrorReader(m: Mirror, network = "hedera:testnet"): HederaReader {
  let page = 0;
  return {
    network: network as HederaReader["network"],
    transactions: async () => {
      if (m.byId === "reader-error") throw new Error("transport");
      return m.byId;
    },
    latest: async () => {
      if (m.latest === "reader-error") throw new Error("transport");
      return m.latest ?? "1700000010.000000000";
    },
    oldest: async () => m.oldest ?? "archival",
    accountTransactions: async () => {
      const p = m.pages?.[page++];
      if (p === undefined || p === "refused") throw new Error("refused");
      return p;
    },
  };
}

function readerOf(entries: MirrorEntry[] | null | "reader-error", network = "hedera:testnet", rest: Omit<Mirror, "byId"> = {}): HederaReader {
  return mirrorReader({ ...rest, byId: entries }, network);
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
    const ref = await exactHedera.reference(p, O);
    expect(ref).toEqual(V.V2.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    expect(await exactHedera.reference(p, {} as PaymentRequirements)).toEqual({ refused: true, code: "x402/option-malformed" });
    const decoded = decodeHederaTx(fromB64(V.V2.expectTransactionBase64));
    if ("refused" in decoded) throw new Error(decoded.code);
    expect(txIdText(decoded.bodies[0]!.id)).toBe(V.V2.expectTxIdText);
    expect(txIdMirror(decoded.bodies[0]!.id)).toBe(V.V2.expectReference.transactionId);
  });

  // bound and reference hold the presented option to the filter read applies: under an option read offers they give
  // H and V2's reference; under one it does not offer (a timeout that is not a positive integer, or an amount that is
  // not the canonical decimal of a positive integer: x402's PaymentRequirements gives `amount` as a string of atomic
  // units and `maxTimeoutSeconds` as a number of seconds, and build writes the transfers from the amount) they refuse
  // with the row's code, the one advertise and build give.
  it("V2 presented under an option read offers gives H and V2's reference, and under one it does not offer is refused", async () => {
    const doc = exactHedera.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    for (const row of rowsOf(V.V2.presentedOptions, "x402-exact-hedera.json V2.presentedOptions", { exact: 3 })) {
      const p = presentedOf(V.V2.expectTransactionBase64, row.accepted);
      const offered = !("refused" in exactHedera.read({ ...doc, accepts: [row.accepted] }));
      expect([row.case, offered]).toEqual([row.case, row.expect === undefined]);
      if (row.expect === undefined) {
        expect([row.case, await exactHedera.bound(p)]).toEqual([row.case, row.expectBound]);
        expect([row.case, await exactHedera.reference(p, row.accepted)]).toEqual([row.case, row.expectReference]);
      } else {
        expect([row.case, await exactHedera.bound(p)]).toEqual([row.case, { refused: true, code: row.expect }]);
        expect([row.case, await exactHedera.reference(p, row.accepted)]).toEqual([row.case, { refused: true, code: row.expect }]);
      }
    }
    const timeoutZero = V.V2.presentedOptions.find((r: { accepted: PaymentRequirements }) => r.accepted.maxTimeoutSeconds === 0);
    const { maxTimeoutSeconds: _, ...noTimeout } = O;
    for (const accepted of [timeoutZero.accepted, noTimeout as PaymentRequirements, { ...O, amount: "x" }]) {
      const doc = { ...required, accepts: [accepted] };
      expect(exactHedera.advertise(doc, H, V.fixed.link, accepted)).toEqual({ refused: true, code: timeoutZero.expect });
      await expect(unsigned(accepted)).rejects.toThrow(timeoutZero.expect);
      expect(await exactHedera.bound(presentedOf(V.V2.expectTransactionBase64, accepted))).toEqual({ refused: true, code: timeoutZero.expect });
    }
    const { feePayer: __, ...noFeePayer } = O.extra!;
    expect(await exactHedera.bound(presentedOf(V.V2.expectTransactionBase64, { ...O, extra: noFeePayer }))).toEqual({
      refused: true,
      code: "hedera/option-malformed",
    });
  });

  // x402 v2's PaymentRequirements gives `amount` as the atomic amount in a string, and the filter holds it to the
  // canonical decimal of a positive integer (x402-option-amount.test.ts), below 2^63, AccountAmount's `sint64`:
  // docs/reference/refusals.md gives `hedera/option-malformed` for an option outside that.
  it("an option whose amount is 0 or 2^63 is not served: advertise and build refuse it, read and pairingOf do not offer it", async () => {
    const doc = exactHedera.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    for (const amount of ["0", "9223372036854775808"]) {
      const o = { ...O, amount };
      expect(exactHedera.advertise({ ...required, accepts: [o] }, H, V.fixed.link, o)).toEqual({ refused: true, code: "hedera/option-malformed" });
      expect(exactHedera.read({ ...doc, accepts: [o] })).toEqual({ refused: true, code: "x402/no-payable-option" });
      expect(pairingOf(o)).toBeUndefined();
      await expect(unsigned(o)).rejects.toThrow("hedera/option-malformed");
    }
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

  const asked = { act: "payment", finality: "consensus" } as const;
  const recoverInput = { network: V.V5.reference.network, tx: V.V5.reference.transactionId, option: O };

  // Each V5 row gives a mirror's answers and status's answer under the profiles read-status and x402-exact-hedera.
  // A row's reference members replace V5's.
  for (const [i, row] of rowsOf(V.V5.rows as { case?: string; reference?: object; query?: object; mirror: Mirror; expect: unknown }[], "x402-exact-hedera.json V5.rows").entries()) {
    it(`V5: status, ${row.case ?? `row ${i}`}`, async () => {
      const ref = { ...V.V5.reference, ...(row.reference ?? {}) };
      expect(await hederaStatus(ref, mirrorReader(row.mirror), (row.query ?? asked) as never)).toEqual(row.expect);
    });
  }

  // recover's answer for each reader answer. A Hedera transaction that reaches consensus with a status other than
  // SUCCESS is final: the network charges its fee and makes none of its transfers (HAPI: the TransactionReceipt's
  // status, a ResponseCodeEnum, and the Mirror Node's `result`). recover refuses such entries hedera/not-success; a
  // transaction id that no counted user entry uses yet is a read to repeat, hedera/not-found (docs/reference/refusals.md).
  for (const [i, row] of rowsOf(V.V5.recoverRows as { case?: string; entries: MirrorEntry[] | null | "reader-error"; expectRecover: unknown }[], "x402-exact-hedera.json V5.recoverRows").entries()) {
    it(`V5: recover, ${row.case ?? `row ${i}`}`, async () => {
      expect(await exactHedera.recover(recoverInput, readerOf(row.entries))).toEqual(row.expectRecover);
    });
  }

  it("recover refuses an input whose tx is not a Mirror Node id or whose option is not an object, with nothing read", async () => {
    const reader = readerOf(V.V5.recoverRows[0].entries);
    for (const input of [{ ...recoverInput, tx: "0.0.1235@1700000000.000000000" }, { ...recoverInput, option: null }, null]) {
      expect(await exactHedera.recover(input as never, reader)).toEqual({ refused: true, code: "hedera/wrong-reader" });
    }
  });

  it("status of a reader for another network is unreadable chain-mismatch, and of a malformed reference unparseable", async () => {
    expect(await hederaStatus(V.V5.reference, mirrorReader(V.V5.rows[0].mirror, "hedera:mainnet"), asked)).toEqual({
      state: "unreadable",
      reason: "chain-mismatch",
      foreign: [],
    });
    expect(await hederaStatus({ ...V.V5.reference, validStart: 1700000000 }, mirrorReader(V.V5.rows[0].mirror), asked)).toEqual({
      state: "unreadable",
      reason: "unparseable",
      foreign: [],
    });
  });

  // read-status answers a malformed reference or query unparseable: the presented members are read only once each is in
  // its form, and the query only once it is an object asking about an act.
  it("status of a reference whose presented members are not in their form, or of a query that is not one, is unparseable", async () => {
    const p = V.V5.reference.presented;
    const row = (account: string, amount: unknown) => ({ account, amount, isApproval: false });
    const refs = [
      { ...p, transfer: {} },
      { ...p, transfer: { hbar: [row("0.0.5555", "-1000"), row("0.0.1234", "1.5")], tokens: [] } },
      { ...p, transfer: { hbar: [row("0.0.5555", "-1000"), row("0.0.1234", 1000)], tokens: [] } },
      { ...p, transfer: { hbar: [], tokens: [{ token: "0.0.6000", rows: "x" }] } },
      { ...p, nodes: ["node"] },
      { ...p, maxFee: "-1" },
    ];
    for (const presented of refs) {
      for (const m of [V.V5.rows[0].mirror, V.V5.rows.find((r: { case: string }) => r.case.startsWith("a failed result under the id")).mirror]) {
        expect(await hederaStatus({ ...V.V5.reference, presented }, mirrorReader(m), asked)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
      }
    }
    for (const query of [null, "payment", { finality: "consensus" }]) {
      expect(await hederaStatus(V.V5.reference, mirrorReader(V.V5.rows[0].mirror), query as never)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
    }
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

  it("the chain's longest valid duration, 180 seconds, is taken; reference refuses a fee payer's debit, two debits and another option", async () => {
    expect(await exactHedera.bound(presentedOf(V.life.transactionBase64))).toBe(V.life.expectBound);
    for (const row of rowsOf(V.referenceRefusals as { case: string; transactionBase64: string; optionAmount?: string; expect: string }[], "x402-exact-hedera.json referenceRefusals", { exact: 3 })) {
      const option = row.optionAmount === undefined ? O : { ...O, amount: row.optionAmount };
      expect([row.case, await exactHedera.reference(presentedOf(row.transactionBase64), option)]).toEqual([row.case, { refused: true, code: row.expect }]);
    }
  });

  // The network takes no valid start later than its consensus time (HAPI ResponseCode INVALID_TRANSACTION_START), so
  // build refuses one later than the time of the call; the clock is held at V2's valid start plus one second.
  it("build refuses a valid start later than the time of the call", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue((Number(V.fixed.validStart.seconds) + 1) * 1000);
    try {
      const at = (seconds: bigint) =>
        exactHedera.build(
          { required: { ...required, accepts: [O] }, accepted: O, payer: V.fixed.payer, node: V.fixed.node, validStart: { seconds, nanos: 0 }, maxFee: BigInt(V.fixed.maxFee) },
          H,
        );
      expect("refused" in (await at(BigInt(V.fixed.validStart.seconds) + 1n))).toBe(false);
      expect(await at(BigInt(V.fixed.validStart.seconds) + 2n)).toEqual({ refused: true, code: "hedera/valid-start-future" });
    } finally {
      clock.mockRestore();
    }
  });

  // The server's checks refuse a valid start later than the time of the check, as build does: bound and reference read
  // the clock, and each row's valid start is later than any time of the check before 2100, or passed.
  it("bound and reference refuse a valid start later than the time of the check", async () => {
    const rows = V.validStartChecked.rows as { case: string; transactionBase64: string; expect: unknown }[];
    for (const row of rowsOf(rows, "x402-exact-hedera.json validStartChecked.rows", { exact: 2 })) {
      const presented = presentedOf(row.transactionBase64);
      expect([row.case, await exactHedera.bound(presented)]).toEqual([row.case, row.expect]);
      const ref = await exactHedera.reference(presented, O);
      expect([row.case, "refused" in ref ? ref : V.V2.expectBound]).toEqual([row.case, row.expect]);
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

  // The executor's filter holds `amount` to the canonical decimal of a positive integer, as x402/exact/hedera's does.
  it("an option whose amount is 0 is not served: advertise and build refuse it, read and pairingOf do not offer it", async () => {
    const zero = { ...OX, amount: "0" };
    expect(exactHederaExecutor.advertise({ ...required, accepts: [zero] }, H, X.fixed.link, zero)).toEqual({
      refused: true,
      code: "hedera/option-malformed",
    });
    expect(exactHederaExecutor.read({ ...advertised(), accepts: [zero] })).toEqual({ refused: true, code: "x402/no-payable-option" });
    expect(pairingOf(zero)).toBeUndefined();
    expect(await exactHederaExecutor.build({ required: { ...required, accepts: [zero] }, accepted: zero, now: X.fixed.now }, H)).toEqual({
      refused: true,
      code: "hedera/option-malformed",
    });
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
      return exactHederaExecutor.reference(payment, doc.accepts[0]!);
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
    const ref = await exactHederaExecutor.reference(payment, OX);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.idDigest).toBe(X.reference.expectIdDigest);
    expect(ref.payee).toBe(OX.payTo);
    expect(await exactHederaExecutor.reference(payment, {} as PaymentRequirements)).toEqual({ refused: true, code: "x402/option-malformed" });
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    expect(await hederaIdDigest(X.fixed.payload.payer)).toBe(X.reference.expectIdDigest);
  });

  it("reference refuses a payment whose accepted is not the option it is given", async () => {
    const payment = (await built()).complete(X.fixed.payload);
    if ("refused" in payment) throw new Error(payment.code);
    const row = X.reference.notOption as { options: PaymentRequirements[]; expect: string };
    for (const option of rowsOf(row.options, "x402-exact-hedera-transfer-executor.json reference.notOption.options", { exact: 2 })) {
      expect(await exactHederaExecutor.reference(payment, option)).toEqual({ refused: true, code: row.expect });
    }
  });

  const asked = { act: "payment", finality: "consensus" } as const;
  for (const [i, row] of rowsOf(X.status.rows as { case?: string; reference?: object; mirror?: object; query?: object; entries: MirrorEntry[] | null; expect: unknown }[], "x402-exact-hedera-transfer-executor.json status.rows").entries()) {
    it(`executorStatus: ${row.case ?? `row ${i}`}`, async () => {
      const ref = { ...X.status.reference, ...(row.reference ?? {}) };
      const mirror = { ...X.status.mirror, ...(row.mirror ?? {}) };
      expect(await executorStatus(ref, readerOf(row.entries, "hedera:testnet", mirror), (row.query ?? asked) as never)).toEqual(row.expect);
    });
  }

  it("plant: a debit from an account other than the payer settles nothing, instrument-consumed", async () => {
    expect(await executorStatus(X.status.reference, readerOf(X.plant.entries, "hedera:testnet", X.status.mirror), asked)).toEqual(X.plant.expect);
  });

  it("the record states the agreement step and no public proof", () => {
    expect(exactHederaExecutor.data.coverage).toBe("none");
    expect(exactHederaExecutor.claims).toBe(false);
    expect(exactHedera.data.coverage).toBe("full");
    expect(exactHedera.claims).toBe(true);
  });
});
