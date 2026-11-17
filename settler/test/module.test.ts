import { secp256k1 } from "@noble/curves/secp256k1.js";
import { createHash } from "node:crypto";
import type { PairingData, PairingId } from "@integraledger/lcp";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import type { OperatorEntry } from "../src/answers.js";
import {
  outcomeOf,
  type ChainRead,
  type Charged,
  type Claim,
  type Core,
  type Descriptor,
  type FeeMeter,
  type FeeNeeds,
  type Handoff,
  type Instrument,
  type Instrumented,
  type Keep,
  type KeyPurpose,
  type Module,
  type ModuleStarter,
  type ModuleState,
  type ReadAnswer,
  type RecordNeeds,
  type Refused,
  type Registration,
  type Started,
  type X402Payment,
} from "../src/module.js";
import { createTron, tronModules } from "../src/modules/tron/index.js";
import { fixture, stub, type Stub } from "./support.js";

// The lcp vectors' V2 payment, as test/tron.test.ts builds it: the raw data, its id, its payer's key and its expiration.
const RAW_V2 =
  "0a0289ad22087d1ddbe0b0adbe8740a0b6f4b18d34524d6c63703a7368613235363a3078626137383136626638663031636665613431343134306465356461653232323362303033363161333936313737613963623431306666363166323030313561645aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541f39fd6e51aad88f6f4ce6ab8827279cfffb92266121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb000000000000000000000000209693bc6afc0c5328ba36faf03c514ef312287c000000000000000000000000000000000000000000000000000000000000271070c0e1f0b18d34900180c2d72f";
const TXID_V2 = "bc5ef82919472351c4e4640798f5d8e87a43c93edc9d867b5f9d40b5077c73f1";
/** The published Anvil key #0, the lcp vectors' V2 payer. */
const ANVIL_0 = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPIRATION_V2 = 1790300724000;
const NETWORK = "tron:728126428";
const O: PaymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  amount: "10000",
  asset: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  payTo: "TCwX1UeSkVfu43HD5xNMmFqDR2Xgjdxihx",
  maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: "lcp-trc20-memo" },
};
/** USDT-TRC20, V2's payer and V2's payTo, as 20-byte hex. */
const TOKEN = "a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const PAYER = "f39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const PAY_TO = "209693bc6afc0c5328ba36faf03c514ef312287c";
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** r ‖ s ‖ v over the transaction id, v in {0, 1}, as java-tron writes it. */
function sign(rawHex: string): string {
  const id = createHash("sha256").update(Buffer.from(rawHex, "hex")).digest();
  const sig = secp256k1.Signature.fromBytes(
    secp256k1.sign(id, Buffer.from(ANVIL_0, "hex"), { prehash: false, format: "recovered" }),
    "recovered",
  );
  return Buffer.from(sig.toBytes("compact")).toString("hex") + sig.recovery!.toString(16).padStart(2, "0");
}

/** The signed transaction: field 1 the raw data, then each signature as field 2. */
function transaction(rawHex: string, signatures: readonly string[]): string {
  const n = rawHex.length / 2;
  const varint: number[] = [];
  for (let v = n; ; v >>>= 7) {
    if (v <= 0x7f) {
      varint.push(v);
      break;
    }
    varint.push((v & 0x7f) | 0x80);
  }
  return `0a${Buffer.from(varint).toString("hex")}${rawHex}` + signatures.map((s) => `1241${s}`).join("");
}

function payment(tx: string, requirements: PaymentRequirements = O): X402Payment {
  return { payload: { x402Version: 2, accepted: requirements, payload: { transaction: tx } }, requirements };
}

/** A block id whose first eight bytes are its number, as java-tron writes one. */
function blockId(number: number): string {
  return BigInt(number).toString(16).padStart(16, "0") + "ab".repeat(24);
}

function now(number: number, timestamp: number) {
  return { blockID: blockId(number), block_header: { raw_data: { number, timestamp } } };
}

/** A SUCCESS receipt modelled on the recorded mainnet one, for V2's id, with V2's transfer of 10000 to payTo. */
function receiptV2() {
  const v1 = (fixture("tron-mainnet-answers.json") as Record<string, Record<string, unknown>>)["infoV1"]!;
  const word = (hex: string) => hex.padStart(64, "0");
  return {
    ...v1,
    id: TXID_V2,
    blockNumber: 86542790,
    log: [{ address: TOKEN, topics: [TRANSFER_TOPIC, word(PAYER), word(PAY_TO)], data: word((10000).toString(16)) }],
  };
}

const entries: OperatorEntry[] = [];
const log = (e: OperatorEntry) => void entries.push(e);
let node: Stub | undefined;
afterEach(async () => {
  await node?.close();
  node = undefined;
  entries.length = 0;
});

async function tronOn(answer: (path: string, body: unknown) => unknown): Promise<Module> {
  node = await stub(answer);
  const rail = createTron([{ network: NETWORK, fullNode: node.url, solidityNode: node.url }], 30_000, log);
  const modules = tronModules(rail, log);
  expect(modules).toHaveLength(1);
  return modules[0]!;
}

describe("the module contract", () => {
  it("types each member a module gives the core, and the Tron module is one", () => {
    expectTypeOf(tronModules).returns.toEqualTypeOf<Module[]>();
    expectTypeOf<Module>().toHaveProperty("descriptor").toEqualTypeOf<Descriptor>();
    expectTypeOf<Module>().toHaveProperty("network").toEqualTypeOf<Network>();
    expectTypeOf<Module>().toHaveProperty("facilitator").toEqualTypeOf<SchemeNetworkFacilitator>();
    expectTypeOf<Module>().toHaveProperty("record").toEqualTypeOf<RecordNeeds<X402Payment>>();
    expectTypeOf<Module>().toHaveProperty("fees").toEqualTypeOf<FeeNeeds<X402Payment>>();
    expectTypeOf<Descriptor["key"]>().toEqualTypeOf<KeyPurpose>();
    expectTypeOf<KeyPurpose>().toEqualTypeOf<"none" | "relayer" | "fee-payer">();
    expectTypeOf<Descriptor["pairings"]>().toEqualTypeOf<readonly PairingId[]>();
    expectTypeOf<Descriptor["acceptsZero"]>().toEqualTypeOf<boolean>();
    expectTypeOf<RecordNeeds["instrument"]>().parameter(0).toEqualTypeOf<X402Payment>();
    expectTypeOf<RecordNeeds["instrument"]>().returns.resolves.toEqualTypeOf<Instrumented | Refused>();
    expectTypeOf<RecordNeeds["read"]>().returns.resolves.toEqualTypeOf<ChainRead>();
    expectTypeOf<Instrumented["nonce"]>().toEqualTypeOf<PairingData["nonce"]>();
    expectTypeOf<Instrumented["instrument"]["by"]>().toEqualTypeOf<"single-use" | "transaction" | "digest">();
    expectTypeOf<Keep["until"]>().toEqualTypeOf<"lapse" | "life" | "settler">();
    expectTypeOf<FeeNeeds["paysFee"]>().returns.toEqualTypeOf<boolean>();
    expectTypeOf<FeeNeeds["payerBroadcast"]>().returns.toEqualTypeOf<boolean>();
    expectTypeOf<FeeMeter["sending"]>().returns.resolves.toEqualTypeOf<boolean>();
    expectTypeOf<Claim["by"]>().toEqualTypeOf<"option" | "payment">();
    expectTypeOf<Handoff>().toHaveProperty("module").toEqualTypeOf<Module>();
    expectTypeOf<Registration>().toHaveProperty("own").toEqualTypeOf<readonly Handoff[]>();
    expectTypeOf<Instrument>().toHaveProperty("network").toEqualTypeOf<Network>();
    expectTypeOf<X402Payment["payload"]>().toEqualTypeOf<PaymentPayload>();
    expectTypeOf<Descriptor["verifiesLanded"]>().toEqualTypeOf<true | undefined>();
    expectTypeOf<Descriptor["verifyForbidden"]>().toEqualTypeOf<true | undefined>();
    expectTypeOf<NonNullable<FeeNeeds["charged"]>>().parameter(1).toEqualTypeOf<{
      readonly transaction: string;
      readonly deadline: number;
    }>();
    expectTypeOf<NonNullable<FeeNeeds["charged"]>>().returns.resolves.toEqualTypeOf<Charged>();
    expectTypeOf<Charged>().toEqualTypeOf<{ readonly fee: bigint; readonly included: boolean }>();
    expectTypeOf<ModuleStarter<{ a: 1 }>["start"]>().parameters.toEqualTypeOf<[{ a: 1 }, Core]>();
    expectTypeOf<ModuleStarter<{ a: 1 }>["start"]>().returns.resolves.toEqualTypeOf<Started>();
    expectTypeOf<Started["registrations"]>().toEqualTypeOf<readonly Registration[]>();
    expectTypeOf<Core["state"]>().toEqualTypeOf<ModuleState>();
    expectTypeOf<Core["meter"]>().returns.toEqualTypeOf<FeeMeter>();
  });

  it("maps every state of lcp's read to final or live", () => {
    const answers: [ReadAnswer, ChainRead["outcome"]][] = [
      [{ state: "settled", transaction: "0x01", finality: "final", presented: "yes", foreign: [] }, "final"],
      [{ state: "failed", reason: "transaction-failed", foreign: [] }, "final"],
      [{ state: "failed", reason: "instrument-consumed", transaction: "0x02", foreign: [] }, "final"],
      [{ state: "failed", reason: "instrument-unused", foreign: [] }, "final"],
      [{ state: "failed", reason: "before-position", foreign: [] }, "final"],
      [{ state: "pending", reason: "below-mark", foreign: [] }, "live"],
      [{ state: "pending", reason: "instrument-live", foreign: [] }, "live"],
      [{ state: "pending", reason: "search-incomplete", foreign: [] }, "live"],
      [{ state: "pending", reason: "not-found", foreign: [] }, "live"],
      [{ state: "unreadable", reason: "transport", foreign: [] }, "live"],
    ];
    for (const [answer, outcome] of answers) expect(outcomeOf(answer)).toEqual({ outcome, answer });
  });
});

describe("the Tron module", () => {
  it("has every member, and states its kind as the rail's /supported does, with the settler's members added", async () => {
    const m = await tronOn(() => ({}));
    expect(Object.keys(m).sort()).toEqual(["descriptor", "facilitator", "fees", "network", "record"]);
    expect(m.descriptor).toEqual({ name: "tron", key: "none", pairings: ["x402/exact/tron/lcp-trc20-memo"], acceptsZero: false });
    expect(m.network).toBe(NETWORK);
    expect([m.facilitator.scheme, m.facilitator.caipFamily]).toEqual(["exact", "tron:*"]);
    expect(m.facilitator.getExtra(NETWORK)).toEqual({ assetTransferMethod: "lcp-trc20-memo" });
    expect(m.facilitator.getSigners(NETWORK)).toEqual([]);
    for (const f of [m.facilitator.verify, m.facilitator.settle, m.record.instrument, m.record.read, m.fees.paysFee, m.fees.payerBroadcast]) {
      expect(typeof f).toBe("function");
    }
    expect([m.fees.paysFee(payment("00")), m.fees.payerBroadcast(payment("00"))]).toEqual([false, false]);
  });

  it("keys a payment by its transaction id and keeps it until its signed expiration, reading no node", async () => {
    const m = await tronOn(() => ({}));
    const tx = transaction(RAW_V2, [sign(RAW_V2)]);
    expect(await m.record.instrument(payment(tx))).toEqual({
      pairing: "x402/exact/tron/lcp-trc20-memo",
      instrument: { by: "transaction", network: NETWORK, transaction: TXID_V2 },
      nonce: "single-use",
      keep: { until: "lapse", at: EXPIRATION_V2 },
    });
    expect(await m.record.instrument(payment("0a02"))).toEqual({ refused: "invalid_payload" });
    expect(await m.record.instrument(payment(tx, { ...O, network: "tron:3448148188" }))).toEqual({ refused: "invalid_network" });
    expect(node!.calls).toEqual([]);
  });

  it("answers verify and settle through the rail, unchanged", async () => {
    const m = await tronOn(() => ({}));
    const p = payment(transaction(RAW_V2, [sign(RAW_V2)]), { ...O, network: "tron:3448148188" });
    expect(await m.facilitator.verify(p.payload, p.requirements)).toEqual({ isValid: false, invalidReason: "invalid_network" });
    expect(await m.facilitator.settle(p.payload, p.requirements)).toEqual({
      success: false,
      errorReason: "invalid_network",
      transaction: "",
      network: "tron:3448148188",
    });
    expect(node!.calls).toEqual([]);
  });

  it("reads a payment the Solidity node shows succeeded as final, by lcp's read", async () => {
    const m = await tronOn((path) => {
      if (path === "/walletsolidity/getnowblock") return now(86542800, EXPIRATION_V2 - 30_000);
      if (path === "/wallet/getnowblock") return now(86542819, EXPIRATION_V2 - 27_000);
      if (path === "/walletsolidity/gettransactioninfobyid") return receiptV2();
      return {};
    });
    const read = await m.record.read(payment(transaction(RAW_V2, [sign(RAW_V2)])), { deadline: performance.now() + 10_000 });
    expect(read.outcome).toBe("final");
    expect(read.answer).toMatchObject({
      state: "settled",
      transaction: `0x${TXID_V2}`,
      finality: "solidified",
      presented: "yes",
      position: 86542790n,
    });
    expect(entries).toEqual([]);
  });

  it("reads a payment no node holds, before its expiration, as live: the identical transaction can still land", async () => {
    const m = await tronOn((path) => {
      if (path === "/walletsolidity/getnowblock") return now(86542800, EXPIRATION_V2 - 30_000);
      if (path === "/wallet/getnowblock") return now(86542819, EXPIRATION_V2 - 27_000);
      return {};
    });
    const read = await m.record.read(payment(transaction(RAW_V2, [sign(RAW_V2)])), { deadline: performance.now() + 10_000 });
    expect(read).toEqual({ outcome: "live", answer: expect.objectContaining({ state: "pending", reason: "instrument-live" }) });
    expect(node!.calls.map((c) => c.path)).not.toContain("/wallet/getblockbylimitnext");
  });
});
