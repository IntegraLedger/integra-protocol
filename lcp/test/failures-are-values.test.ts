// Failures are values (CONTRIBUTING.md): a caller's malformed input is answered with a value, never a throw. A status
// read given a ref or reader that is not an object is pending `unreadable` and reads nothing, as with a reader for
// another network, and a recover refuses with the code its rail gives such a reader (docs/concepts/refusals.md,
// "Readers"); a function whose type carries a refusal returns one, x402's `build` `x402/not-v2` for a choice that is not
// an object (docs/reference/refusals.md); a writer whose type carries none throws `TypeError` on an argument outside its
// type, as the core's carrier writers do (docs/concepts/refusals.md, "What throws"). Each well-formed counterpart of a
// replaced argument is a value from the rail's vector file.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aptosIdDigest, aptosStatus } from "../src/aptos.js";
import { avmRecover, avmStatus } from "../src/avm.js";
import { cardanoRecover, cardanoStatus } from "../src/cardano.js";
import { casperRecover, casperStatus, cep3009TypedData, exactCasper } from "../src/casper.js";
import { ccdRecover, ccdStatus, exactCcd } from "../src/ccd.js";
import type { AtrHash } from "../src/core.js";
import {
  eip3009Recover,
  eip3009Status,
  eip3009TypedData,
  evmStatus,
  paymentHash,
  permit2TypedData,
  TRANSFER_TOPIC,
  transferDigest,
} from "../src/evm.js";
import {
  exactHedera,
  executorStatus,
  hederaChannelId,
  hederaStatus,
  hederaVoucher,
  txIdMirror,
  txIdText,
} from "../src/hedera.js";
import { BINDINGS } from "../src/index.js";
import { counting } from "./fixtures/counting-reader.js";
import { permit2Status, redeemedLeafRecover } from "../src/internal/evm.js";
import { signedWire } from "../src/internal/svm.js";
import { xrplCloseStatus } from "../src/internal/xrpl-session.js";
import { invoiceH } from "../src/lightning.js";
import {
  chargeCard,
  chargeNearIntents,
  chargeSolana,
  chargeUsdcSolana,
  chargeXrpl,
  sessionStatus,
  sessionTempo,
  sessionXrpl,
  subscriptionTempo,
} from "../src/mpp.js";
import { nearRecover, nearStatus } from "../src/near.js";
import { polkadotRecover, polkadotStatus } from "../src/polkadot.js";
import { chainIdFelt, outsideExecution, starknetLandedNonce, starknetStatus } from "../src/starknet.js";
import { muxedFor, stellarLocate, stellarStatus } from "../src/stellar.js";
import { decodeSuiTx, suiCarrier, suiRecover, suiStatus } from "../src/sui.js";
import {
  channelInstruction,
  channelPda,
  svmCarrier,
  svmChannelStatus,
  svmDigest,
  svmLocate,
  svmNonceMoved,
  svmRecover,
  svmStatus,
} from "../src/svm.js";
import { decodeTronTx, encodeTronRaw, tronCarrier, tronRecover, tronStatus } from "../src/tron.js";
import { exactTvm, tvmRecover } from "../src/tvm.js";
import { BATCH_SETTLEMENT, batchCloudflare, batchEvm, batchSvm, DEPOSITED_TOPIC } from "../src/x402-batch-settlement.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import {
  authCaptureEip3009,
  authCapturePermit2,
  exactEip3009,
  exactErc7710,
  exactErc7710Salt,
  exactPermit2,
  requestCommitment,
  uptoPermit2,
} from "../src/x402.js";
import { xrplOpenStatus, xrplStatus } from "../src/xrpl.js";
import { muxedForArgs } from "./peer-free-inputs.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const H: AtrHash = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/** Arguments that are not the object an argument's type names. */
const NOT_OBJECTS: readonly unknown[] = [null, undefined, "0x1234", 1];
/** The same, and an object of the wrong shape: a ref or reader with no members. */
const MALFORMED: readonly unknown[] = [...NOT_OBJECTS, {}];

/** The first ref in a vector file: an object under `ref`, `reference` or `expectReference` naming a network. */
function refIn(file: string): { network: string } {
  const found: { network: string }[] = [];
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o === null || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      const named = v !== null && typeof v === "object" && typeof (v as { network?: unknown }).network === "string";
      if (/^(ref|reference|expectReference)$/.test(k) && named && !Array.isArray(v)) found.push(v as { network: string });
      walk(v);
    }
  };
  walk(load(file));
  if (found[0] === undefined) throw new Error(`no ref in ${file}`);
  return found[0];
}

/** A reader of `network` that answers null to every read and counts the reads it is asked for. */
function quietReader(network: string): { network: string; reads(): number } {
  let reads = 0;
  return new Proxy({} as { network: string; reads(): number }, {
    get: (_, k) => {
      if (k === "network") return network;
      if (k === "reads") return () => reads;
      if (k === "then") return undefined;
      return async () => {
        reads++;
        return null;
      };
    },
  });
}

type Read = (ref: never, reader: never, ...rest: never[]) => Promise<unknown>;
const UNREADABLE_REASONS = ["history-gap", "transport", "unparseable", "too-large", "chain-mismatch"];
const refused = (code: string) => ({ refused: true, code });

/**
 * Each read, given a ref or reader that is not an object (or an object with no members), answers `expected`, and asks
 * the reader for nothing. `rest` are the read's further arguments.
 */
function reads(rows: readonly [string, Read, string, unknown, ...unknown[]][]): void {
  for (const [name, read, file, expected, ...rest] of rows) {
    it(`${name}: a ref or reader that is not an object answers ${JSON.stringify(expected)}, with nothing read`, async () => {
      const ref = refIn(file);
      const call = read as (...a: unknown[]) => Promise<unknown>;
      for (const bad of MALFORMED) {
        const reader = quietReader(ref.network);
        expect(await call(bad, reader, ...rest), String(bad)).toEqual(expected);
        expect(reader.reads(), String(bad)).toBe(0);
        expect(await call(structuredClone(ref), bad, ...rest), String(bad)).toEqual(expected);
      }
    });
  }
}

/** What an EVM `status` takes beside the reference and the reader: the act payment at the final mark. */
const Q = { act: "payment", finality: "finalized" } as const;
/** The pairings whose status reads an EVM or Tempo transaction and answers as the profile read-status does. */
const EVM_STATUS = /^(x402\/(exact|upto|auth-capture|batch-settlement)\/eip155\/|x402\/batch-settlement\/eip155$|mpp\/(charge\/evm\/|charge\/usdc\/evm$|session\/(evm|tempo)$|subscription\/tempo$))/;
/** An EVM status's unreadable answer for `reason`. */
const unreadable = (reason: string) => ({ state: "unreadable", reason, foreign: [] });
/** An EVM status's answer for a transaction it did not read as the act, with no search for H yet. */
const SEARCH_INCOMPLETE = { state: "pending", reason: "search-incomplete", foreign: [] };
/** The reason an EVM status gives for `bad` in place of the ref or the reader. */
type Reason = (bad: unknown, at: "ref" | "reader") => string;
const isObjectValue = (v: unknown): boolean => typeof v === "object" && v !== null;
/** A ref or reader that is not an object is unparseable or transport; one with no members names no network. */
const byNetwork: Reason = (bad, at) => (isObjectValue(bad) ? "chain-mismatch" : at === "ref" ? "unparseable" : "transport");

/**
 * Each EVM status, given a ref or reader that is not an object (or an object with no members), answers unreadable for
 * the reason `reason` gives, and asks the reader for nothing; given a query that is not one `status` takes, it answers
 * unreadable `unparseable`, and asks the reader for nothing.
 */
function evmStatusReads(rows: readonly [string, Read, string, Reason][]): void {
  for (const [name, read, file, reason] of rows) {
    it(`${name}: a ref, reader or query that is not an object answers unreadable, with nothing read`, async () => {
      const ref = refIn(file);
      const call = read as (...a: unknown[]) => Promise<unknown>;
      for (const bad of MALFORMED) {
        const reader = quietReader(ref.network);
        expect(await call(bad, reader, Q), String(bad)).toEqual(unreadable(reason(bad, "ref")));
        expect(reader.reads(), String(bad)).toBe(0);
        expect(await call(structuredClone(ref), bad, Q), String(bad)).toEqual(unreadable(reason(bad, "reader")));
        const quiet = quietReader(ref.network);
        expect(await call(structuredClone(ref), quiet, bad), `query ${String(bad)}`).toEqual(unreadable("unparseable"));
        expect(quiet.reads(), `query ${String(bad)}`).toBe(0);
      }
      for (const bad of [{ act: "payment" }, { ...Q, finality: "final" }, { ...Q, act: "charge" }, { ...Q, after: 100 }]) {
        const quiet = quietReader(ref.network);
        expect(await call(structuredClone(ref), quiet, bad), JSON.stringify(bad)).toEqual(unreadable("unparseable"));
        expect(quiet.reads(), JSON.stringify(bad)).toBe(0);
      }
    });
  }
}

/** Each call, given each value that is not an object in place of its argument `at`, answers `expected`. */
function answers(rows: readonly [string, (...a: never[]) => unknown, unknown[], number, unknown][]): void {
  for (const [name, f, args, at, expected] of rows) {
    it(`${name}: an argument that is not an object answers ${JSON.stringify(expected)}`, async () => {
      for (const bad of NOT_OBJECTS) {
        const a = args.slice();
        a[at] = bad;
        expect(await (f as (...x: unknown[]) => unknown)(...a), String(bad)).toEqual(expected);
      }
    });
  }
}

/** Each call throws TypeError. */
function throwsTypeError(name: string, calls: readonly (() => unknown)[]): void {
  it(`${name} throws TypeError on an argument outside its type`, () => {
    for (const c of calls) expect(c).toThrow(TypeError);
  });
}

// A node's receipt log carries `address`, `topics` and `data`, and its receipt a status of 0x0 or 0x1 and a block number
// (the Ethereum JSON-RPC API's eth_getTransactionReceipt), which a reader gives as the 0 or 1 and the bigint of the
// package's receipt type. Each shape below is not such a log: no object, or a member missing or of another type than the
// string address, array of string topics and string data the API gives. A receipt holding one is a reader answer that
// is not well formed: docs/reference/refusals.md gives `evm/unreadable` for a receipt or log that is not well formed,
// and `hedera/unreadable` for a Hedera reader's response that is not, and a reader that fails is never a failed payment
// (docs/concepts/refusals.md, "Readers").
const without = (member: string) => (l: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(l).filter(([k]) => k !== member));
const NOT_LOGS: readonly [string, (l: Record<string, unknown>) => unknown][] = [
  ["null", () => null],
  ["7", () => 7],
  ["no address", without("address")],
  ["a number address", (l) => ({ ...l, address: 1 })],
  ["no topics", without("topics")],
  ["topics as one string", (l) => ({ ...l, topics: (l.topics as string[]).join("") })],
  ["a number topic", (l) => ({ ...l, topics: [...(l.topics as unknown[]).slice(0, -1), 1] })],
  ["no data", without("data")],
  ["null data", (l) => ({ ...l, data: null })],
];
/** `logs` with each shape in place of its first log, in place of the log at `read`, and after its last log. */
function misshapen(logs: Record<string, unknown>[], read: number): [string, unknown[]][] {
  expect(read).toBeGreaterThan(0);
  return rowsOf(NOT_LOGS.flatMap(([shape, make]): [string, unknown[]][] => [
    [`${shape} first`, logs.map((l, i) => (i === 0 ? make(l) : l))],
    [`${shape} as the log read`, logs.map((l, i) => (i === read ? make(l) : l))],
    [`${shape} last`, [...logs, make(logs[0]!)]],
  ]), "NOT_LOGS, each shape first, as the log read and last");
}
/** `receipt` with its status, and then its block number, left as the node's hex string. */
const notReceipts = (receipt: Record<string, unknown>): [string, unknown][] => [
  ["status 0x1", { ...receipt, status: "0x1" }],
  ["block number as hex", { ...receipt, blockNumber: `0x${(receipt.blockNumber as bigint).toString(16)}` }],
];

describe("evm", () => {
  const evm = "x402-exact-eip155-eip3009.json";
  // The vector file's ref is EIP-3009's, which names no Permit2 authorization: permit2Status reads it as unparseable.
  evmStatusReads([
    ["eip3009Status", eip3009Status, evm, byNetwork],
    ["evmStatus", evmStatus, evm, byNetwork],
    ["permit2Status", permit2Status("full"), evm, () => "unparseable"],
  ]);
  reads([
    ["eip3009Recover", eip3009Recover, evm, refused("evm/wrong-reader")],
    ["redeemedLeafRecover", redeemedLeafRecover, evm, refused("evm/wrong-reader")],
  ]);
  const address = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
  answers([
    ["eip3009TypedData", eip3009TypedData, [undefined], 0, refused("evm/network-malformed")],
    ["permit2TypedData", permit2TypedData, [undefined], 0, refused("evm/network-malformed")],
    ["transferDigest", transferDigest, [undefined], 0, refused("evm/field-malformed")],
    ["paymentHash", paymentHash, [84532, address, undefined], 2, refused("evm/field-malformed")],
  ]);
  it("permit2TypedData: a permitted entry that is not an object is evm/field-malformed", () => {
    for (const bad of NOT_OBJECTS) {
      const a = { chainId: 84532, permitted: [bad], spender: address, nonce: 0n, deadline: 1n };
      expect(permit2TypedData(a as never), String(bad)).toEqual(refused("evm/field-malformed"));
    }
  });
  describe("permit2TypedData: a witness that is not an object of a type name, fields and a value is evm/field-malformed", () => {
    // The well-formed witness is x402-exact-eip155-permit2.json's: the Witness struct of EV1's witnessTypeString, with
    // the value {to: payTo, validAfter: "0"} its case names, over EV1's spender, nonce and deadline.
    const p2 = load("x402-exact-eip155-permit2.json");
    const struct = /\)Witness\(([^)]*)\)$/.exec(p2.EV1.witnessTypeString)![1]!;
    const fields = struct.split(",").map((member: string) => {
      const [type, name] = member.split(" ");
      return { name: name!, type: type! };
    });
    const value = { to: p2.fixed.option.payTo, validAfter: "0" };
    const witness = { type: "Witness", fields, value };
    const a = {
      chainId: 84532,
      permitted: { token: p2.fixed.option.asset, amount: BigInt(p2.fixed.option.amount) },
      spender: p2.EV1.expectSpender,
      nonce: BigInt(p2.EV1.expectNonceDecimal),
      deadline: BigInt(p2.EV1.expectDeadline),
    };
    it("the vector file's witness gives PermitWitnessTransferFrom with its Witness struct and value", () => {
      expect(fields).toEqual([
        { name: "to", type: "address" },
        { name: "validAfter", type: "uint256" },
      ]);
      const typed = permit2TypedData({ ...a, witness });
      expect(typed).toMatchObject({ primaryType: "PermitWitnessTransferFrom", types: { Witness: fields }, message: { witness: value } });
    });
    it("the fields of a witness are read by index: a map method of their own is never called", () => {
      const withMap = Object.assign([...fields], {
        map: () => {
          throw new RangeError("map");
        },
      });
      expect(permit2TypedData({ ...a, witness: { ...witness, fields: withMap } })).toMatchObject({ types: { Witness: fields } });
    });
    it("each member of a witness is read once: a getter's later answer never reaches the struct", () => {
      let reads = 0;
      const field = {
        get name() {
          return reads++ === 0 ? fields[0]!.name : 7;
        },
        type: fields[0]!.type,
      };
      expect(permit2TypedData({ ...a, witness: { ...witness, fields: [field] } } as never)).toMatchObject({
        types: { Witness: [fields[0]] },
      });
      expect(reads).toBe(1);
    });
    const hole: unknown[] = [fields[0]];
    hole.length = 2;
    const cases: [string, unknown][] = [
      ...rowsOf(NOT_OBJECTS, "NOT_OBJECTS", {
        keep: ["the values given as a witness that is not an object", (w) => w !== undefined],
        leave: ["undefined, which leaves the witness out: permit2TypedData gives the PermitTransferFrom of a permit without one", (w) => w === undefined],
      }).map((w): [string, unknown] => [`a witness of ${String(w)}`, w]),
      ["a witness that is an array", [witness]],
      ["a type that is an array", { ...witness, type: ["Witness"] }],
      ["a type that is an object with toString", { ...witness, type: { toString: () => "Witness" } }],
      ["a type that is a String object", { ...witness, type: new String("Witness") }],
      ["a type that is a number", { ...witness, type: 1 }],
      ["no fields", { type: "Witness", value }],
      ["fields of null", { ...witness, fields: null }],
      ["fields that are a string", { ...witness, fields: "to" }],
      ["fields that are an object with a map method", { ...witness, fields: { map: () => [] } }],
      ["a field of null", { ...witness, fields: [null] }],
      ["a field that is a number", { ...witness, fields: [1] }],
      ["a field that is an array", { ...witness, fields: [["address", "to"]] }],
      ["fields with a hole", { ...witness, fields: hole }],
      ["a field whose name is not a string", { ...witness, fields: [{ name: 1, type: "address" }] }],
      ["a field with no type", { ...witness, fields: [{ name: "to" }] }],
      ["no value", { type: "Witness", fields }],
      ["a value of null", { ...witness, value: null }],
      ["a value that is a string", { ...witness, value: "0x1234" }],
      ["a value that is an array", { ...witness, value: [value] }],
    ];
    for (const [name, bad] of cases) {
      it(name, () => {
        expect(permit2TypedData({ ...a, witness: bad } as never)).toEqual(refused("evm/field-malformed"));
      });
    }
  });
  it("the EVM statuses read a malformed transaction, h, asset, binding log or transfer log as unreadable unparseable, with nothing read", async () => {
    const ref = load(evm).V6.ref;
    for (const [name, read, members] of [
      ["evmStatus", evmStatus, ["transaction", "bindingLog", "transferLog"]],
      ["eip3009Status", eip3009Status, ["transaction", "h", "asset", "transferLog"]],
    ] as const) {
      const quiet = quietReader(ref.network);
      expect(await read(ref, quiet as never, Q), name).toEqual(SEARCH_INCOMPLETE);
      expect(quiet.reads(), name).toBe(1);
      for (const member of rowsOf(members, `${name}: the members it reads`)) {
        const bads = member === "transaction" || member === "h" ? [null, undefined, 1, H.slice(0, 64), `${H}00`] : [null, "0x1234", 1, {}];
        for (const bad of bads) {
          const reader = quietReader(ref.network);
          const label = `${name} ${member} ${String(bad)}`;
          expect(await read({ ...ref, [member]: bad }, reader as never, Q), label).toEqual(unreadable("unparseable"));
          expect(reader.reads(), label).toBe(0);
        }
      }
    }
  });
  // V6's logs carry all three members: `AuthorizationUsed` indexes both its members (EIP-3009), so its `data` is "0x".
  // The answer for a receipt holding a log of another shape is evmStatus's and redeemedLeafRecover's.
  /** The index of the log in `logs` that uses `h`: `AuthorizationUsed`'s topic 2 is the nonce. */
  const useOf = (logs: Record<string, unknown>[], h: string) => logs.findIndex((l) => (l.topics as string[])[2] === h);
  const receiptReader = (v: { reader: Record<string, string> }, receipt: { status: number; blockNumber: string }) =>
    (logs: unknown[]) => ({
      network: v.reader.network,
      receipt: async () => ({ status: receipt.status, blockNumber: BigInt(receipt.blockNumber), logs }),
      blockNumber: async (tag: "safe" | "finalized") => BigInt(v.reader[tag]!),
    });
  it("eip3009Status reads a receipt holding a log that is not an object with a string address, an array of string topics and a string data as unreadable unparseable, as evmStatus does", async () => {
    const v = load(evm).V6;
    const row = v.status[1];
    const reader = receiptReader(v, row.receipt);
    const evmRef = { network: v.ref.network, transaction: v.ref.transaction, transferLog: v.ref.transferLog };
    const plain = (a: unknown) => JSON.parse(JSON.stringify(a, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
    const query = { ...Q, finality: row.expect.finality };
    expect(plain(await eip3009Status(v.ref, reader(row.receipt.logs) as never, query))).toEqual(row.expect);
    expect(plain(await evmStatus(evmRef as never, reader(row.receipt.logs) as never, query))).toEqual(row.expect);
    for (const [label, logs] of misshapen(row.receipt.logs, useOf(row.receipt.logs, v.ref.h))) {
      expect(await eip3009Status(v.ref, reader(logs) as never, Q), label).toEqual(unreadable("unparseable"));
      expect(await evmStatus(evmRef as never, reader(logs) as never, Q), label).toEqual(unreadable("unparseable"));
    }
  });
  it("eip3009Recover reads a receipt holding a log that is not an object with a string address, an array of string topics and a string data as evm/unreadable, as redeemedLeafRecover does", async () => {
    const v = load(evm).V6;
    const row = v.recover[0];
    const reader = receiptReader(v, row.receipt);
    const tx = { network: v.ref.network, tx: v.ref.transaction, option: { ...load(evm).fixed.O, asset: v.ref.asset } };
    expect(await eip3009Recover(tx, reader(row.receipt.logs) as never)).toBe(row.expect);
    for (const [label, logs] of misshapen(row.receipt.logs, useOf(row.receipt.logs, v.ref.h))) {
      expect(await eip3009Recover(tx, reader(logs) as never), label).toEqual(refused("evm/unreadable"));
      expect(await redeemedLeafRecover(tx, reader(logs) as never), label).toEqual(refused("evm/unreadable"));
    }
  });
});

describe("x402 over EVM", () => {
  answers([
    ["exactEip3009.build", exactEip3009.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactPermit2.build", exactPermit2.build, [undefined, H], 0, refused("x402/not-v2")],
    ["uptoPermit2.build", uptoPermit2.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactErc7710.build", exactErc7710.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactErc7710Salt.build", exactErc7710Salt.build, [undefined, H], 0, refused("x402/not-v2")],
    ["authCaptureEip3009.build", authCaptureEip3009.build, [undefined, H], 0, refused("x402/not-v2")],
    ["authCapturePermit2.build", authCapturePermit2.build, [undefined, H], 0, refused("x402/not-v2")],
    ["requestCommitment", requestCommitment, [undefined], 0, refused("x402/request-target-invalid")],
  ]);
});

describe("x402 over Solana and XRPL", () => {
  answers([
    ["exactSvm.build", exactSvm.build, [undefined, H], 0, refused("x402/not-v2")],
    ["uptoSvm.build", uptoSvm.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactXrpl.build", exactXrpl.build, [undefined, H], 0, refused("x402/not-v2")],
  ]);
});

const UNPARSEABLE = { state: "unreadable", reason: "unparseable", foreign: [] };
const CHAIN_MISMATCH = { state: "unreadable", reason: "chain-mismatch", foreign: [] };

/**
 * Each `status` of the profile read-status, given a ref that is not an object (or an object with no members), answers
 * unreadable `unparseable` and asks the reader for nothing; given a reader that is not an object, or one that names no
 * network, it answers unreadable `chain-mismatch`. `query` is the query each call takes, and `ref`, where given, the
 * well-formed ref, in place of the vector file's first.
 */
function statusReads(rows: readonly [string, Read, string, unknown, { network: string }?][]): void {
  for (const [name, read, file, query, given] of rows) {
    it(`${name}: a ref that is not an object is unparseable and a reader that is not one chain-mismatch, with nothing read`, async () => {
      const ref = given ?? refIn(file);
      const call = read as (...a: unknown[]) => Promise<unknown>;
      for (const bad of MALFORMED) {
        const reader = quietReader(ref.network);
        expect(await call(bad, reader, query), String(bad)).toEqual(UNPARSEABLE);
        expect(reader.reads(), String(bad)).toBe(0);
        expect(await call(structuredClone(ref), bad, query), String(bad)).toEqual(CHAIN_MISMATCH);
      }
    });
  }
}

describe("casper and ccd", () => {
  statusReads([
    ["casperStatus", casperStatus, "x402-exact-casper.json", { act: "payment", finality: "finalized" }],
    ["ccdStatus", ccdStatus, "x402-exact-ccd.json", { act: "payment", finality: "finalized" }],
  ]);
  reads([
    ["casperRecover", casperRecover, "x402-exact-casper.json", refused("casper/wrong-reader")],
    ["ccdRecover", ccdRecover, "x402-exact-ccd.json", refused("ccd/wrong-reader")],
  ]);
  answers([
    ["exactCasper.build", exactCasper.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactCcd.build", exactCcd.build, [undefined, H], 0, refused("x402/not-v2")],
    ["cep3009TypedData", cep3009TypedData, [undefined], 0, refused("casper/network-malformed")],
  ]);
});

describe("aptos", () => {
  statusReads([["aptosStatus", aptosStatus, "x402-exact-aptos.json", { act: "payment", finality: "committed" }]]);
  answers([["aptosIdDigest", aptosIdDigest, [undefined], 0, refused("aptos/tx-malformed")]]);
  it("aptosIdDigest: an instrument whose sequence number is not a bigint is aptos/tx-malformed", async () => {
    const i = { sender: "0x1", sequenceNumber: "7", function: "0x1::f::g", typeArguments: [], arguments: [] };
    expect(await aptosIdDigest(i as never)).toEqual(refused("aptos/tx-malformed"));
  });
});

describe("avm", () => {
  statusReads([["avmStatus", avmStatus, "x402-exact-algorand.json", { act: "payment", finality: "final" }]]);
  reads([["avmRecover", avmRecover, "x402-exact-algorand.json", refused("avm/wrong-reader")]]);
});

describe("cardano", () => {
  statusReads([["cardanoStatus", cardanoStatus, "x402-exact-cardano.json", { act: "payment", finality: 0n }]]);
  reads([["cardanoRecover", cardanoRecover, "x402-exact-cardano.json", refused("cardano/wrong-reader")]]);
  it("cardanoRecover: an input whose tx is not a 32-byte hash is cardano/wrong-reader, with nothing read", async () => {
    const V = load("x402-exact-cardano.json");
    const cbor = Uint8Array.from(Buffer.from(V.V2.transactionBase64, "base64"));
    const reader = { network: V.V2.expectReference.network, transaction: async () => ({ blockHeight: 1n, slot: 1n, valid: true, cbor }) };
    const input = { network: V.V2.expectReference.network, tx: V.V2.expectReference.txId, option: V.fixed.O };
    expect(await cardanoRecover(input, reader as never)).toBe(V.V5.recover[0].expect);
    for (const tx of [undefined, null, 5]) {
      const { reader: r, calls } = counting(reader);
      expect(await cardanoRecover({ ...input, tx } as never, r as never), String(tx)).toEqual(refused("cardano/wrong-reader"));
      expect(calls).toEqual([]);
    }
  });
});

describe("hedera", () => {
  const consensus = { act: "payment", finality: "consensus" };
  statusReads([
    ["hederaStatus", hederaStatus, "x402-exact-hedera.json", consensus],
    ["executorStatus", executorStatus, "x402-exact-hedera-transfer-executor.json", consensus],
  ]);
  reads([["exactHedera.recover", exactHedera.recover, "x402-exact-hedera.json", refused("hedera/wrong-reader")]]);

  it("hederaStatus: a ref whose expectMemo is not a string is unreadable unparseable, with nothing read", async () => {
    const V = load("x402-exact-hedera.json").V5;
    let reads = 0;
    const m = V.rows[0].mirror;
    const reader = {
      network: V.readerNetwork,
      transactions: async () => (reads++, m.byId),
      latest: async () => (reads++, m.latest),
      oldest: async () => (reads++, "archival"),
      accountTransactions: async () => (reads++, { transactions: [], next: null }),
    };
    expect(await hederaStatus(V.reference, reader as never, consensus as never)).toEqual(V.rows[0].expect);
    for (const v of [undefined, null, 1, {}]) {
      reads = 0;
      expect(await hederaStatus({ ...V.reference, expectMemo: v }, reader as never, consensus as never), String(v)).toEqual(UNPARSEABLE);
      expect(reads, String(v)).toBe(0);
    }
  });

  it("executorStatus: a ref whose asset or idDigest is not of the form reference writes is unreadable unparseable, with nothing read", async () => {
    const V = load("x402-exact-hedera-transfer-executor.json").status;
    let reads = 0;
    const reader = {
      network: V.readerNetwork,
      transactions: async () => (reads++, V.rows[0].entries),
      latest: async () => (reads++, V.mirror.latest),
      oldest: async () => (reads++, V.mirror.oldest),
    };
    expect(await executorStatus(V.reference, reader as never, consensus as never)).toEqual(V.rows[0].expect);
    const bad: readonly [string, unknown][] = [
      ["idDigest", undefined],
      ["idDigest", null],
      ["idDigest", 1],
      ["idDigest", "0x12"],
      ["asset", undefined],
      ["asset", null],
      ["asset", "x"],
    ];
    for (const [k, v] of bad) {
      reads = 0;
      expect(await executorStatus({ ...V.reference, [k]: v }, reader as never, consensus as never), `${k} ${String(v)}`).toEqual(UNPARSEABLE);
      expect(reads, `${k} ${String(v)}`).toBe(0);
    }
  });

  // The id forms are the Hedera SDK's `TransactionId.toString()` and the Mirror Node REST API's path form.
  const id = { account: "0.0.1235", seconds: 1700000000n, nanos: 5 };
  it("txIdText and txIdMirror write a transaction id in its two forms", () => {
    expect(txIdText(id)).toBe("0.0.1235@1700000000.000000005");
    expect(txIdMirror(id)).toBe("0.0.1235-1700000000-000000005");
  });
  const badIds = [
    ...NOT_OBJECTS,
    {},
    { ...id, account: 1235 },
    { ...id, account: "1235" },
    { ...id, seconds: 1700000000 },
    { ...id, seconds: -1n },
    { ...id, nanos: -1 },
    { ...id, nanos: 1_000_000_000 },
    { ...id, nanos: 0.5 },
  ];
  throwsTypeError("txIdText", rowsOf(badIds.map((b) => () => txIdText(b as never)), "badIds, each a call of txIdText"));
  throwsTypeError("txIdMirror", rowsOf(badIds.map((b) => () => txIdMirror(b as never)), "badIds, each a call of txIdMirror"));

  const V = load("mpp-session-hedera-solana-xrpl.json");
  const signer = "0x0000000000000000000000000000000000000000" as const;
  const config = {
    payer: V.fixed.payer,
    payee: V.fixed.payee,
    token: V.fixed.token,
    authorizedSigner: signer,
    escrow: V.fixed.escrow,
    chainId: 296 as const,
  };
  it("hederaChannelId: the vector's channel id", () => {
    expect(hederaChannelId({ ...config, salt: V.fixed.H })).toBe(V.HS1.expectChannelId);
  });
  throwsTypeError("hederaChannelId", [
    ...NOT_OBJECTS.map((b) => () => hederaChannelId(b as never)),
    () => hederaChannelId({ ...config, salt: "0x12" } as never),
    () => hederaChannelId({ ...config, salt: V.fixed.H, payer: "0x12" } as never),
    () => hederaChannelId({ ...config, salt: V.fixed.H, escrow: V.fixed.H } as never),
    () => hederaChannelId({ ...config, salt: V.fixed.H, chainId: "x" } as never),
    () => hederaChannelId({ ...config, salt: V.fixed.H, chainId: 1 } as never),
  ]);
  const channel = { channelId: V.HS1.expectChannelId, escrow: V.fixed.escrow, chainId: 296 as const };
  it("hederaVoucher: the voucher of a channel", () => {
    expect(hederaVoucher(channel, 5n).message).toEqual({ channelId: V.HS1.expectChannelId.toLowerCase(), cumulativeAmount: 5n });
  });
  throwsTypeError("hederaVoucher", [
    ...NOT_OBJECTS.map((b) => () => hederaVoucher(b as never, 5n)),
    () => hederaVoucher({ ...channel, channelId: "x" } as never, 5n),
    () => hederaVoucher({ ...channel, escrow: "x" } as never, 5n),
    () => hederaVoucher({ ...channel, chainId: 1 } as never, 5n),
    () => hederaVoucher(channel, 5 as never),
    () => hederaVoucher(channel, -1n),
    () => hederaVoucher(channel, 1n << 128n),
  ]);
});

describe("near", () => {
  reads([
    ["nearStatus", nearStatus, "x402-exact-near.json", { state: "unreadable", reason: "unparseable", foreign: [] }, { act: "payment", finality: "final" }],
    ["nearRecover", nearRecover, "x402-exact-near.json", refused("near/wrong-reader")],
  ]);
});

describe("polkadot", () => {
  const file = "x402-exact-polkadot-lcp-assets-remark.json";
  reads([
    ["polkadotStatus", polkadotStatus, file, { state: "unreadable", reason: "unparseable", foreign: [] }, { act: "payment", finality: "finalized" }],
    ["polkadotRecover", polkadotRecover, file, refused("polkadot/wrong-reader")],
  ]);
});

describe("starknet", () => {
  reads([
    ["starknetStatus", starknetStatus, "x402-exact-starknet.json", { state: "unreadable", reason: "unparseable", foreign: [] }, { act: "payment", finality: "ACCEPTED_ON_L1" }],
    ["starknetLandedNonce", starknetLandedNonce, "x402-exact-starknet.json", refused("starknet/wrong-reader")],
  ]);
  answers([["outsideExecution", outsideExecution, [undefined], 0, refused("starknet/network-malformed")]]);
  it("chainIdFelt: each network's chain id, the short string of its reference (Starknet's SN_MAIN and SN_SEPOLIA)", () => {
    expect(chainIdFelt("starknet:SN_MAIN")).toBe("0x534e5f4d41494e");
    expect(chainIdFelt("starknet:SN_SEPOLIA")).toBe("0x534e5f5345504f4c4941");
  });
  const notNetworks = [...NOT_OBJECTS, "starknet:XYZ", "eip155:1", "starknet:sn_main"];
  throwsTypeError("chainIdFelt", rowsOf(notNetworks.map((n) => () => chainIdFelt(n as never)), "notNetworks, each a call of chainIdFelt"));
});

describe("stellar", () => {
  statusReads([["stellarStatus", stellarStatus, "x402-exact-stellar.json", { act: "payment", finality: "closed" }, load("x402-exact-stellar.json").V5.ref]]);
  reads([["stellarLocate", stellarLocate, "x402-exact-stellar.json", { complete: false }]]);
  it("stellarStatus and stellarLocate: a ref whose authDigest is not a string reads nothing", async () => {
    const ref = refIn("x402-exact-stellar.json");
    for (const authDigest of [null, 1, {}]) {
      const reader = quietReader(ref.network);
      const bad = { ...ref, authDigest } as never;
      expect(await stellarStatus(bad, reader as never, { act: "payment", finality: "closed" }), String(authDigest)).toEqual(UNPARSEABLE);
      expect(await stellarLocate(bad, reader as never), String(authDigest)).toEqual({ complete: false });
      expect(reader.reads(), String(authDigest)).toBe(0);
    }
  });
  // muxedFor's type carries a refusal: a base or H it cannot write from is refused, never thrown. The rows of
  // peer-free-inputs.ts get the same codes without the SDK (stellar-peer-missing.test.ts); a string that is not a `G…`
  // account, here a muxed address and the account's text cut short, needs the SDK to be read.
  it("muxedFor: a base that is not a G account is stellar/option-malformed, and an H that is not a 32-byte hash x402/payload-malformed", () => {
    const V = load("x402-exact-stellar.json");
    for (const row of rowsOf(muxedForArgs(), "peer-free-inputs.ts", { exact: 4 })) {
      expect([row.case, muxedFor(row.base as never, row.h as never)]).toEqual([row.case, refused(row.expect)]);
    }
    for (const base of ["", V.V1.M, V.fixed.seller.slice(0, -1)]) {
      expect(muxedFor(base, V.fixed.H), base).toEqual(refused("stellar/option-malformed"));
    }
    expect(muxedFor(V.fixed.seller, V.fixed.H)).toBe(V.V1.M);
  });
});

describe("tron", () => {
  reads([
    ["tronStatus", tronStatus, "x402-exact-tron-lcp-trc20-memo.json", { state: "unreadable", reason: "unparseable", foreign: [] }, { act: "payment", finality: "solidified" }],
    ["tronRecover", tronRecover, "x402-exact-tron-lcp-trc20-memo.json", refused("tron/wrong-reader")],
  ]);
  answers([["tronCarrier", tronCarrier, [undefined], 0, refused("tron/tx-malformed")]]);

  // V1 is a live mainnet transaction: its decoded fields re-encode to its raw bytes.
  const V = load("x402-exact-tron-lcp-trc20-memo.json");
  const d = V.V1.expectDecoded;
  const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
  const raw = {
    refBlockBytes: bytes(d.refBlockBytes),
    refBlockHash: bytes(d.refBlockHash),
    expiration: BigInt(d.expiration),
    data: bytes(d.data),
    owner: bytes(d.owner),
    contractAddress: bytes(d.contractAddress),
    callData: bytes(d.callData),
    timestamp: BigInt(d.timestamp),
    feeLimit: BigInt(d.feeLimit),
  };
  it("encodeTronRaw: V1's decoded fields re-encode to its raw bytes", () => {
    expect(Buffer.from(encodeTronRaw(raw)).toString("hex")).toBe(V.V1.rawHex);
  });
  it("tronCarrier: a raw transaction whose fields are not a TronRaw's is tron/tx-malformed", async () => {
    expect(await tronCarrier({ raw: { ...raw, callData: d.callData }, rawBytes: bytes(V.V1.rawHex) } as never)).toEqual(
      refused("tron/tx-malformed"),
    );
  });
  throwsTypeError("encodeTronRaw", [
    ...NOT_OBJECTS.map((b) => () => encodeTronRaw(b as never)),
    () => encodeTronRaw({ ...raw, owner: d.owner } as never),
    () => encodeTronRaw({ ...raw, data: [1, 2] } as never),
    () => encodeTronRaw({ ...raw, expiration: Number(d.expiration) } as never),
    () => encodeTronRaw({ ...raw, feeLimit: -1n }),
    () => encodeTronRaw({ ...raw, timestamp: 1n << 64n }),
    () => encodeTronRaw({ ...raw, expiration: 1n << 63n }),
    () => encodeTronRaw({ ...raw, feeLimit: 1n << 63n }),
  ]);
});

describe("tvm", () => {
  reads([["tvmRecover", tvmRecover, "x402-exact-tvm.json", refused("tvm/wrong-reader")]]);
  it("exactTvm.unplaced hands back a value that is not an option unchanged", () => {
    for (const bad of MALFORMED) expect(exactTvm.unplaced(bad as never), String(bad)).toBe(bad);
  });
});

const XRPL_QUERY = { act: "payment", finality: "validated" };
const SVM_QUERY = { act: "payment", finality: "finalized" };

describe("xrpl", () => {
  reads([
    ["xrplStatus", xrplStatus, "x402-exact-xrpl.json", UNPARSEABLE, XRPL_QUERY],
    ["xrplOpenStatus", xrplOpenStatus, "x402-exact-xrpl.json", UNPARSEABLE, XRPL_QUERY],
    ["xrplCloseStatus", xrplCloseStatus, "x402-exact-xrpl.json", UNPARSEABLE, XRPL_QUERY],
  ]);
});

describe("svm", () => {
  const file = "x402-exact-solana.json";
  reads([
    ["svmStatus", svmStatus, file, UNPARSEABLE, SVM_QUERY],
    ["svmChannelStatus", svmChannelStatus, file, UNPARSEABLE, SVM_QUERY],
    ["svmRecover", svmRecover, file, refused("svm/wrong-reader")],
    ["svmNonceMoved", svmNonceMoved, file, null],
    ["svmLocate", svmLocate, file, { complete: false }, H],
  ]);
  answers([
    ["svmCarrier", svmCarrier, [undefined], 0, refused("svm/tx-malformed")],
    ["channelInstruction", channelInstruction, [undefined], 0, refused("svm/tx-malformed")],
    ["channelPda", channelPda, [undefined], 0, refused("svm/input-malformed")],
  ]);
  it("svmStatus: a ref whose digest is not a string reads nothing", async () => {
    const ref = refIn(file);
    for (const digest of [null, 1, {}]) {
      const reader = quietReader(ref.network);
      expect(await svmStatus({ ...ref, transaction: "x", digest } as never, reader as never, SVM_QUERY as never), String(digest)).toEqual(
        UNPARSEABLE,
      );
      expect(reader.reads(), String(digest)).toBe(0);
    }
  });
  it("svmDigest rejects, never throws, on a transaction that is not one", async () => {
    for (const bad of MALFORMED) {
      let p: Promise<unknown> | undefined;
      expect(() => (p = svmDigest(bad as never))).not.toThrow();
      await expect(p).rejects.toThrow(TypeError);
    }
  });
  it("svmCarrier and channelInstruction: a transaction whose instructions are not objects is svm/tx-malformed", () => {
    const tx = { signatures: [], message: new Uint8Array(0), keys: [], instructions: [null], blockhash: new Uint8Array(32) };
    expect(svmCarrier(tx as never)).toEqual(refused("svm/tx-malformed"));
    expect(channelInstruction(tx as never)).toEqual(refused("svm/tx-malformed"));
  });
  // x402-exact-solana.json V2's wire is the compact-u16 count 2, the fee payer's empty slot, the payer's signature, then
  // a v0 message: the prefix byte 0x80, then the header, whose first byte is the required signature count. Its message
  // and signature give its wire back; a message too short to hold that prefix and count is refused, never a throw.
  it("signedWire: V2's message and signature give V2's wire; a message under 2 bytes is svm/tx-malformed", () => {
    const V = load("x402-exact-solana.json");
    const wire = new Uint8Array(Buffer.from(V.V2.wireBase64, "base64"));
    const built = signedWire(wire.subarray(1 + 2 * 64), V.fixed.payer, wire.subarray(1 + 64, 1 + 2 * 64));
    expect(built instanceof Uint8Array && Buffer.from(built).toString("base64")).toBe(V.V2.wireBase64);
    for (const message of [new Uint8Array(0), Uint8Array.of(0x80), Uint8Array.of(0x01)]) {
      let out: unknown;
      expect(() => (out = signedWire(message, V.fixed.payer, new Uint8Array(64))), String(message)).not.toThrow();
      expect(out, String(message)).toEqual(refused("svm/tx-malformed"));
    }
  });
});

describe("x402 batch settlement", () => {
  // The vector file's ref names no Deposited binding log: batchEvm.status reads it as unparseable once the reader is an
  // object.
  evmStatusReads([
    ["batchEvm.status", batchEvm.status, "x402-exact-eip155-eip3009.json", (bad, at) => (at === "reader" && !isObjectValue(bad) ? "transport" : "unparseable")],
  ]);
  reads([["batchEvm.recover", batchEvm.recover, "x402-exact-eip155-eip3009.json", refused("evm/wrong-reader")]]);
  it("batchEvm.status: a reader that is not an object, beside the reference its reference writes, answers unreadable transport, and one with no members chain-mismatch", async () => {
    const V = load("x402-batch-settlement.json");
    const ref = {
      network: `eip155:${V.fixed.evm.chainId}`,
      transaction: `0x${"ab".repeat(32)}`,
      bindingLog: { address: BATCH_SETTLEMENT, topic0: DEPOSITED_TOPIC, index: 1, value: V.EB1.channelId },
      transferLog: { address: V.fixed.evm.token, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: V.EB7.transferDigest },
    };
    const quiet = quietReader(ref.network);
    expect(await batchEvm.status(ref as never, quiet as never, Q)).toEqual(SEARCH_INCOMPLETE);
    expect(quiet.reads()).toBe(1);
    for (const bad of MALFORMED) {
      expect(await batchEvm.status(ref as never, bad as never, Q), String(bad)).toEqual(unreadable(byNetwork(bad, "reader")));
    }
  });
  // EB8's receipt holds its one ChannelCreated log, and EB7's full deposit call the same log fourth of five, beside the
  // token's AuthorizationUsed and Transfers and the channel contract's Deposited (x402-batch-settlement.json): recover
  // gives EB8's H from each.
  it("batchEvm.recover reads a reader answer that is not a receipt, or a receipt holding a log that is not an object with a string address, an array of string topics and a string data, as evm/unreadable, as eip3009Recover does", async () => {
    const V = load("x402-batch-settlement.json");
    const full = V.EB7.fullCall.receipt;
    const network = `eip155:${V.fixed.evm.chainId}`;
    const tx = { network, tx: `0x${"cd".repeat(32)}`, option: V.fixed.evm.option };
    const answering = (receipt: unknown) => ({ network, receipt: async () => receipt });
    const holding = (logs: unknown[]) => answering({ status: full.status, blockNumber: BigInt(full.blockNumber), logs });
    expect(await batchEvm.recover(tx as never, holding([V.EB8.log]) as never)).toBe(V.EB8.expect);
    expect(await batchEvm.recover(tx as never, holding(full.logs) as never)).toBe(V.EB8.expect);
    const read = full.logs.findIndex((l: unknown) => JSON.stringify(l) === JSON.stringify(V.EB8.log));
    for (const [label, logs] of misshapen(full.logs, read)) {
      expect(await batchEvm.recover(tx as never, holding(logs) as never), label).toEqual(refused("evm/unreadable"));
    }
    const receipt = { status: full.status, blockNumber: BigInt(full.blockNumber), logs: full.logs };
    for (const [label, bad] of notReceipts(receipt)) {
      expect(await batchEvm.recover(tx as never, answering(bad) as never), label).toEqual(refused("evm/unreadable"));
    }
  });
  answers([
    ["batchEvm.build", batchEvm.build, [undefined, H], 0, refused("x402/not-v2")],
    ["batchEvm.buildWithin", batchEvm.buildWithin, [undefined, H], 0, refused("x402/not-v2")],
    ["batchCloudflare.build", batchCloudflare.build, [undefined, H], 0, refused("x402/not-v2")],
    ["batchSvm.build", batchSvm.build, [undefined, H], 0, refused("x402/not-v2")],
    ["batchSvm.buildWithin", batchSvm.buildWithin, [undefined, H], 0, refused("x402/not-v2")],
  ]);
  it("batchSvm.build refuses an H that is not a 32-byte hash as x402/payload-malformed", async () => {
    const V = load("x402-batch-settlement.json");
    const S = V.fixed.svm;
    const doc = batchSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [S.option] }, V.fixed.H, V.fixed.link, S.option);
    if ("refused" in doc) throw new Error(doc.code);
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: S.payer,
      payerAuthorizer: S.payer,
      deposit: BigInt(S.deposit),
      salt: 42n,
      openSlot: BigInt(S.openSlot),
      tokenProgram: S.tokenProgram,
      recentBlockhash: S.blockhash,
    };
    for (const bad of [null, "0x12", H.slice(0, 64)]) {
      expect(await batchSvm.build(choice, bad as AtrHash), String(bad)).toEqual(refused("x402/payload-malformed"));
    }
  });
});

describe("mpp", () => {
  reads([
    ["chargeSolana.recover", chargeSolana.recover, "mpp-charge-solana.json", refused("svm/wrong-reader")],
    ["sessionXrpl.status", sessionXrpl.status, "x402-exact-xrpl.json", UNPARSEABLE, XRPL_QUERY],
    ["sessionXrpl.recover", sessionXrpl.recover, "x402-exact-xrpl.json", refused("xrpl/wrong-reader")],
  ]);

  // Each B2 document advertises H; its first challenge, unplaced, is the seller's offer.
  const link = "https://seller.example/atr";
  for (const [name, b, file] of [
    ["chargeSolana", chargeSolana, "mpp-charge-solana.json"],
    ["chargeUsdcSolana", chargeUsdcSolana, "mpp-charge-usdc-solana.json"],
    ["chargeXrpl", chargeXrpl, "mpp-charge-xrpl.json"],
    ["chargeNearIntents", chargeNearIntents, "mpp-charge-nearintents.json"],
    ["chargeCard", chargeCard, "mpp-charge-card.json"],
  ] as const) {
    it(`${name}.advertise: an H that is not a 32-byte hash is mpp/challenge-malformed`, () => {
      const doc = load(file).buyer.rows.find((r: { name: string }) => r.name === "B2").input.doc;
      const offer = (b.unplaced as (o: unknown) => unknown)(doc[0]);
      for (const bad of [...NOT_OBJECTS, "0x12", H.slice(0, 64)]) {
        const advertise = b.advertise as (...a: unknown[]) => unknown;
        expect(advertise([offer], bad, link, offer), String(bad)).toEqual(refused("mpp/challenge-malformed"));
      }
    });
  }

  it("sessionStatus reads a malformed opened, closes or accessKey as unreadable unparseable, with nothing read", async () => {
    const E = load("mpp-session-evm.json");
    const f = E.fixed;
    const ref = { network: `eip155:${f.chainId}`, transaction: E.ES9.hash };
    const channel = E.ES1.expectChannelId;
    const written = {
      opened: { address: f.escrow, version: "v2", channel, h: H, chainId: f.chainId },
      closes: { escrow: f.escrow, channel },
      accessKey: { keyId: f.payer, token: f.usdc, to: E.ES7.expectFromTo, account: f.payer },
    };
    for (const [member, value] of rowsOf(Object.entries(written), "written: opened, closes and accessKey", { exact: 3 })) {
      const quiet = quietReader(ref.network);
      const control = await sessionStatus({ ...ref, [member]: value } as never, quiet as never, Q);
      expect(control, member).toEqual(SEARCH_INCOMPLETE);
      expect(quiet.reads(), member).toBe(1);
      const first = Object.keys(value)[0]!;
      for (const bad of [null, "0x1234", 1, {}, { ...value, [first]: 5 }]) {
        const reader = quietReader(ref.network);
        const answer = await sessionStatus({ ...ref, [member]: bad } as never, reader as never, Q);
        expect(answer, `${member} ${JSON.stringify(bad)}`).toEqual(unreadable("unparseable"));
        expect(reader.reads(), `${member} ${JSON.stringify(bad)}`).toBe(0);
      }
    }
  });
});

describe("tempo", () => {
  reads([
    ["sessionTempo.recover", sessionTempo.recover, "mpp-charge-evm-hash.json", refused("tempo/wrong-reader")],
    ["subscriptionTempo.recover", subscriptionTempo.recover, "mpp-charge-evm-hash.json", refused("tempo/wrong-reader")],
  ]);
});

describe("lightning", () => {
  answers([
    ["invoiceH", invoiceH, [undefined, "h"], 0, refused("ln/invoice-malformed")],
  ]);
});

describe("sui", () => {
  reads([
    ["suiStatus", suiStatus, "x402-exact-sui.json", { state: "unreadable", reason: "unparseable", foreign: [] }, { act: "payment", finality: "final", after: 0n }],
    ["suiRecover", suiRecover, "x402-exact-sui.json", refused("sui/wrong-reader")],
  ]);
  answers([["suiCarrier", suiCarrier, [undefined], 0, refused("sui/tx-malformed")]]);
  it("suiCarrier: a transaction whose unused Pure inputs are not an array of byte arrays is sui/tx-malformed", () => {
    const V2 = load("x402-exact-sui.json").V2;
    const tx = decodeSuiTx(V2.tx.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(suiCarrier(tx)).toBe(V2.expectBound);
    for (const unusedPure of [undefined, "0x1234", [null], [H]]) {
      expect(suiCarrier({ ...tx, unusedPure } as never), String(unusedPure)).toEqual(refused("sui/tx-malformed"));
    }
  });
});

describe("every pairing", () => {
  it("every function member, given no argument or one to three that are not what it takes, answers with a value", async () => {
    let calls = 0;
    for (const b of rowsOf(BINDINGS, "BINDINGS, every pairing")) {
      const channel = (b as { channel?: object }).channel ?? {};
      const members: [string, unknown, object][] = rowsOf([
        ...Object.entries(b).map(([k, f]): [string, unknown, object] => [k, f, b]),
        ...Object.entries(channel).map(([k, f]): [string, unknown, object] => [`channel.${k}`, f, channel]),
      ], `${b.id}: its members and its channel's`);
      for (const [member, f, self] of members) {
        if (typeof f !== "function") continue;
        for (const bad of [...MALFORMED, []]) {
          for (let n = 0; n <= 3; n++) {
            calls++;
            const args = Array.from({ length: n }, () => bad);
            const answer = await Promise.resolve()
              .then(() => f.apply(self, args))
              .then(
                () => "a value",
                (e: unknown) => `throws ${String(e)}`,
              );
            expect(answer, `${b.id} ${member}(${n} x ${String(bad)})`).toBe("a value");
          }
        }
      }
    }
    expect(calls).toBeGreaterThan(5000);
  });

  it("every unplaced hands back a value that is not an option unchanged", () => {
    for (const b of rowsOf(BINDINGS, "BINDINGS, every pairing")) {
      for (const bad of MALFORMED) expect((b.unplaced as (o: unknown) => unknown)(bad), `${b.id} ${String(bad)}`).toBe(bad);
    }
  });

  // Each pairing's own B6 credential (and the same credential as a push, its payload type "signature" or "hash"), the
  // ref its reference writes and the close ref its closeRef writes, with a reader that is not an object: fetchPresented
  // answers what it answers a reader "x", and status is unreadable, with a reason of the profile read-status.
  const b6 = readdirSync(new URL("../vectors/", import.meta.url))
    .flatMap((name) => (load(name).buyer?.rows ?? []) as { name: string; pairing: string; input: { presented?: unknown } }[])
    .filter((r) => r.name === "B6");
  it("every read, given its pairing's own credential or ref and a reader that is not an object, answers with a value", async () => {
    let calls = 0;
    for (const b of rowsOf(BINDINGS, "BINDINGS, every pairing")) {
      const row = b6.find((r) => r.pairing === b.id);
      if (row === undefined) continue;
      const presented = row.input.presented as { challenge: unknown; payload: object };
      const p = b as unknown as { [k: string]: (...a: unknown[]) => Promise<unknown> } & { channel?: { ref(c: unknown): Promise<unknown> } };
      if (typeof p.fetchPresented === "function") {
        for (const type of [undefined, "signature", "hash"]) {
          const c = type === undefined ? presented : { ...presented, payload: { ...presented.payload, type } };
          const other = await p.fetchPresented(structuredClone(c), "x");
          for (const bad of [null, undefined]) {
            calls++;
            expect(await p.fetchPresented(structuredClone(c), bad), `${b.id} fetchPresented ${type} ${bad}`).toEqual(other);
          }
        }
      }
      if (typeof p.status !== "function") continue;
      const refs: unknown[] = [];
      const option = "challenge" in presented ? presented.challenge : (presented as { accepted?: unknown }).accepted;
      const opened = await p.reference?.(structuredClone(presented), structuredClone(option));
      if (opened !== null && typeof opened === "object" && !("refused" in opened)) refs.push({ transaction: "x", ...opened });
      const channel = (await p.channel?.ref(structuredClone(presented))) as { channel?: unknown } | undefined;
      if (typeof p.closeRef === "function" && typeof channel?.channel === "string") {
        refs.push({ ...(p.closeRef as unknown as (...a: unknown[]) => object)(presented.challenge, channel.channel), transaction: "x" });
      }
      // The EVM and Tempo pairings' status takes a query, and answers a reader that is not an object unreadable
      // transport; a close ref that closeRef refused names no key the pairing writes, and is unparseable before any read.
      const evm = EVM_STATUS.test(b.id);
      for (const ref of refs) {
        const expected = unreadable("refused" in (ref as object) ? "unparseable" : "transport");
        for (const bad of NOT_OBJECTS) {
          calls++;
          const answer = (await p.status(structuredClone(ref), bad, evm ? Q : { act: "payment" })) as { state?: unknown; reason?: unknown };
          const where = `${b.id} status ${JSON.stringify(ref).slice(0, 40)} ${String(bad)}`;
          if (evm) expect(answer, where).toEqual(expected);
          else expect([answer.state, UNREADABLE_REASONS.includes(answer.reason as string)], where).toEqual(["unreadable", true]);
        }
      }
    }
    expect(calls).toBeGreaterThan(100);
  });

  // These x402 pairings' builds read the choice's members before the document: their own codes answer first.
  const ownCodes = /(algorand|hedera|near|polkadot|starknet|tron|tvm)/;
  const x402Builds = rowsOf(BINDINGS, "BINDINGS", {
    min: 16,
    keep: ["the x402 pairings whose build reads the choice object first", (b) => b.id.startsWith("x402/") && !ownCodes.test(b.id)],
    leave: [
      "the pairings outside x402, and the x402 pairings whose builds answer their own codes first",
      (b) => !b.id.startsWith("x402/") || ownCodes.test(b.id),
    ],
  });
  it("every x402 build that reads a choice object refuses one that is not an object as x402/not-v2", async () => {
    expect(x402Builds.length).toBeGreaterThan(15);
    for (const b of x402Builds) {
      for (const member of ["build", "buildWithin"] as const) {
        const f = (b as unknown as { [k: string]: unknown })[member];
        if (typeof f !== "function") continue;
        for (const bad of NOT_OBJECTS) {
          expect(await f.call(b, bad, H), `${b.id} ${member} ${String(bad)}`).toEqual(refused("x402/not-v2"));
        }
      }
    }
  });
});
