// Failures are values (CONTRIBUTING.md): a caller's malformed input is answered with a value, never a throw. A status
// read given a ref or reader that is not an object is pending `unreadable` and reads nothing, as with a reader for
// another network, and a recover refuses with the code its rail gives such a reader (docs/concepts/refusals.md,
// "Readers"); a function whose type carries a refusal returns one, x402's `build` `x402/not-v2` for a choice that is not
// an object (docs/reference/refusals.md); a writer whose type carries none throws `TypeError` on an argument outside its
// type, as the core's carrier writers do (docs/concepts/refusals.md, "What throws"). Each well-formed counterpart of a
// replaced argument is a value from the rail's vector file.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aptosIdDigest, aptosStatus } from "../src/aptos.js";
import { avmRecover, avmStatus } from "../src/avm.js";
import { cardanoRecover, cardanoStatus } from "../src/cardano.js";
import { casperRecover, casperStatus, cep3009TypedData, exactCasper } from "../src/casper.js";
import { ccdRecover, ccdStatus, exactCcd } from "../src/ccd.js";
import { type AtrHash } from "../src/core.js";
import {
  eip3009Recover,
  eip3009Status,
  eip3009TypedData,
  evmStatus,
  paymentHash,
  permit2Status,
  permit2TypedData,
  redeemedLeafRecover,
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
import { nearLapsed, nearRecover, nearStatus } from "../src/near.js";
import { polkadotLocate, polkadotRecover, polkadotStatus } from "../src/polkadot.js";
import { chainIdFelt, outsideExecution, starknetLandedNonce, starknetStatus } from "../src/starknet.js";
import { stellarLocate, stellarStatus } from "../src/stellar.js";
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
import { exactStellar } from "../src/x402-exact-stellar.js";
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
import { xrplCloseStatus, xrplOpenStatus, xrplStatus } from "../src/xrpl.js";

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
const UNREADABLE = { state: "pending", why: "unreadable" };
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

describe("evm", () => {
  const evm = "x402-exact-eip155-eip3009.json";
  reads([
    ["eip3009Status", eip3009Status, evm, UNREADABLE],
    ["evmStatus", evmStatus, evm, UNREADABLE],
    ["permit2Status", permit2Status, evm, UNREADABLE],
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
  it("the EVM statuses read a malformed transaction, h, asset, binding log or transfer log as pending unreadable, with nothing read", async () => {
    const ref = load(evm).V6.ref;
    for (const [name, read, members] of [
      ["evmStatus", evmStatus, ["transaction", "bindingLog", "transferLog"]],
      ["eip3009Status", eip3009Status, ["transaction", "h", "asset", "transferLog"]],
    ] as const) {
      const quiet = quietReader(ref.network);
      expect(await read(ref, quiet as never), name).toEqual({ state: "pending", why: "not-found" });
      expect(quiet.reads(), name).toBe(1);
      for (const member of members) {
        const bads = member === "transaction" || member === "h" ? [null, undefined, 1, H.slice(0, 64), `${H}00`] : [null, "0x1234", 1, {}];
        for (const bad of bads) {
          const reader = quietReader(ref.network);
          const label = `${name} ${member} ${String(bad)}`;
          expect(await read({ ...ref, [member]: bad }, reader as never), label).toEqual(UNREADABLE);
          expect(reader.reads(), label).toBe(0);
        }
      }
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

describe("x402 over Solana, XRPL and Stellar", () => {
  answers([
    ["exactSvm.build", exactSvm.build, [undefined, H], 0, refused("x402/not-v2")],
    ["uptoSvm.build", uptoSvm.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactXrpl.build", exactXrpl.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactStellar.build", exactStellar.build, [undefined, H], 0, refused("x402/not-v2")],
  ]);
});

describe("casper and ccd", () => {
  reads([
    ["casperStatus", casperStatus, "x402-exact-casper.json", UNREADABLE],
    ["casperRecover", casperRecover, "x402-exact-casper.json", refused("casper/wrong-reader")],
    ["ccdStatus", ccdStatus, "x402-exact-ccd.json", UNREADABLE],
    ["ccdRecover", ccdRecover, "x402-exact-ccd.json", refused("ccd/wrong-reader")],
  ]);
  answers([
    ["exactCasper.build", exactCasper.build, [undefined, H], 0, refused("x402/not-v2")],
    ["exactCcd.build", exactCcd.build, [undefined, H], 0, refused("x402/not-v2")],
    ["cep3009TypedData", cep3009TypedData, [undefined], 0, refused("casper/network-malformed")],
  ]);
});

describe("aptos", () => {
  reads([["aptosStatus", aptosStatus, "x402-exact-aptos.json", UNREADABLE]]);
  answers([["aptosIdDigest", aptosIdDigest, [undefined], 0, refused("aptos/tx-malformed")]]);
  it("aptosIdDigest: an instrument whose sequence number is not a bigint is aptos/tx-malformed", async () => {
    const i = { sender: "0x1", sequenceNumber: "7", function: "0x1::f::g", typeArguments: [], arguments: [] };
    expect(await aptosIdDigest(i as never)).toEqual(refused("aptos/tx-malformed"));
  });
});

describe("avm", () => {
  reads([
    ["avmStatus", avmStatus, "x402-exact-algorand.json", UNREADABLE],
    ["avmRecover", avmRecover, "x402-exact-algorand.json", refused("avm/wrong-reader")],
  ]);
});

describe("cardano", () => {
  reads([
    ["cardanoStatus", cardanoStatus, "x402-exact-cardano.json", UNREADABLE, 0n],
    ["cardanoRecover", cardanoRecover, "x402-exact-cardano.json", refused("cardano/wrong-reader")],
  ]);
  it("cardanoRecover: a ref whose txId is not a string is cardano/unreadable when the reader answers a transaction", async () => {
    const V = load("x402-exact-cardano.json");
    const cbor = Uint8Array.from(Buffer.from(V.V2.transactionBase64, "base64"));
    const reader = { network: V.V5.ref.network, transaction: async () => ({ blockHeight: 1n, slot: 1n, valid: true, cbor }) };
    expect(await cardanoRecover(V.V5.ref, reader as never)).toBe(V.V5.recover[0].expect);
    for (const txId of [undefined, null, 5]) {
      expect(await cardanoRecover({ ...V.V5.ref, txId } as never, reader as never), String(txId)).toEqual(refused("cardano/unreadable"));
    }
  });
});

describe("hedera", () => {
  reads([
    ["hederaStatus", hederaStatus, "x402-exact-hedera.json", UNREADABLE],
    ["executorStatus", executorStatus, "x402-exact-hedera-transfer-executor.json", UNREADABLE],
    ["exactHedera.recover", exactHedera.recover, "x402-exact-hedera.json", refused("hedera/wrong-reader")],
  ]);

  it("hederaStatus: a ref whose expectMemo is not a string is pending unreadable, with nothing read", async () => {
    const V = load("x402-exact-hedera.json").V5;
    let reads = 0;
    const reader = { network: V.readerNetwork, transactions: async () => (reads++, V.rows[0].entries) };
    expect(await hederaStatus(V.reference, reader as never)).toEqual(V.rows[0].expect);
    for (const v of [undefined, null, 1, {}]) {
      reads = 0;
      expect(await hederaStatus({ ...V.reference, expectMemo: v }, reader as never), String(v)).toEqual(UNREADABLE);
      expect(reads, String(v)).toBe(0);
    }
  });

  it("executorStatus: a ref whose asset or idDigest is not of the form reference writes is pending unreadable, with nothing read", async () => {
    const V = load("x402-exact-hedera-transfer-executor.json").status;
    let reads = 0;
    const reader = { network: V.readerNetwork, transactions: async () => (reads++, V.rows[0].entries) };
    expect(await executorStatus(V.reference, reader as never)).toEqual(V.rows[0].expect);
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
      expect(await executorStatus({ ...V.reference, [k]: v }, reader as never), `${k} ${String(v)}`).toEqual(UNREADABLE);
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
  throwsTypeError("txIdText", badIds.map((b) => () => txIdText(b as never)));
  throwsTypeError("txIdMirror", badIds.map((b) => () => txIdMirror(b as never)));

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
    ["nearStatus", nearStatus, "x402-exact-near.json", UNREADABLE],
    ["nearRecover", nearRecover, "x402-exact-near.json", refused("near/wrong-reader")],
    ["nearLapsed", nearLapsed, "x402-exact-near.json", false],
  ]);
});

describe("polkadot", () => {
  const file = "x402-exact-polkadot-lcp-assets-remark.json";
  reads([
    ["polkadotStatus", polkadotStatus, file, UNREADABLE],
    ["polkadotRecover", polkadotRecover, file, refused("polkadot/wrong-reader")],
    ["polkadotLocate", polkadotLocate, file, refused("polkadot/wrong-reader"), 0n, 1n],
  ]);
});

describe("starknet", () => {
  reads([
    ["starknetStatus", starknetStatus, "x402-exact-starknet.json", UNREADABLE],
    ["starknetLandedNonce", starknetLandedNonce, "x402-exact-starknet.json", refused("starknet/wrong-reader")],
  ]);
  answers([["outsideExecution", outsideExecution, [undefined], 0, refused("starknet/network-malformed")]]);
  it("chainIdFelt: each network's chain id, the short string of its reference (Starknet's SN_MAIN and SN_SEPOLIA)", () => {
    expect(chainIdFelt("starknet:SN_MAIN")).toBe("0x534e5f4d41494e");
    expect(chainIdFelt("starknet:SN_SEPOLIA")).toBe("0x534e5f5345504f4c4941");
  });
  const notNetworks = [...NOT_OBJECTS, "starknet:XYZ", "eip155:1", "starknet:sn_main"];
  throwsTypeError("chainIdFelt", notNetworks.map((n) => () => chainIdFelt(n as never)));
});

describe("stellar", () => {
  reads([
    ["stellarStatus", stellarStatus, "x402-exact-stellar.json", UNREADABLE],
    ["stellarLocate", stellarLocate, "x402-exact-stellar.json", { complete: false }],
  ]);
  it("stellarStatus and stellarLocate: a ref whose authDigest is not a string reads nothing", async () => {
    const ref = refIn("x402-exact-stellar.json");
    for (const authDigest of [null, 1, {}]) {
      const reader = quietReader(ref.network);
      const bad = { ...ref, authDigest } as never;
      expect(await stellarStatus(bad, reader as never), String(authDigest)).toEqual(UNREADABLE);
      expect(await stellarLocate(bad, reader as never), String(authDigest)).toEqual({ complete: false });
      expect(reader.reads(), String(authDigest)).toBe(0);
    }
  });
});

describe("tron", () => {
  reads([
    ["tronStatus", tronStatus, "x402-exact-tron-lcp-trc20-memo.json", UNREADABLE],
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

describe("xrpl", () => {
  reads([
    ["xrplStatus", xrplStatus, "x402-exact-xrpl.json", UNREADABLE],
    ["xrplOpenStatus", xrplOpenStatus, "x402-exact-xrpl.json", UNREADABLE],
    ["xrplCloseStatus", xrplCloseStatus, "x402-exact-xrpl.json", UNREADABLE],
  ]);
});

describe("svm", () => {
  const file = "x402-exact-solana.json";
  reads([
    ["svmStatus", svmStatus, file, UNREADABLE],
    ["svmChannelStatus", svmChannelStatus, file, UNREADABLE],
    ["svmRecover", svmRecover, file, refused("svm/wrong-reader")],
    ["svmNonceMoved", svmNonceMoved, file, false],
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
      expect(await svmStatus({ ...ref, digest } as never, reader as never), String(digest)).toEqual(UNREADABLE);
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
});

describe("x402 batch settlement", () => {
  reads([
    ["batchEvm.status", batchEvm.status, "x402-exact-eip155-eip3009.json", UNREADABLE],
    ["batchEvm.recover", batchEvm.recover, "x402-exact-eip155-eip3009.json", refused("evm/wrong-reader")],
  ]);
  it("batchEvm.status: a reader that is not an object, beside the reference its reference writes, answers pending unreadable", async () => {
    const V = load("x402-batch-settlement.json");
    const ref = {
      network: `eip155:${V.fixed.evm.chainId}`,
      transaction: `0x${"ab".repeat(32)}`,
      bindingLog: { address: BATCH_SETTLEMENT, topic0: DEPOSITED_TOPIC, index: 1, value: V.EB1.channelId },
      transferLog: { address: V.fixed.evm.token, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: V.EB7.transferDigest },
    };
    const quiet = quietReader(ref.network);
    expect(await batchEvm.status(ref as never, quiet as never)).toEqual({ state: "pending", why: "not-found" });
    expect(quiet.reads()).toBe(1);
    for (const bad of MALFORMED) expect(await batchEvm.status(ref as never, bad as never), String(bad)).toEqual(UNREADABLE);
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
