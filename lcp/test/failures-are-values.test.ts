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
  transferDigest,
} from "../src/evm.js";
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
