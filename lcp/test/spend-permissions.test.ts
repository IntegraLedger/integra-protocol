// spend-permissions/eip155 against vectors/spend-permissions-eip155.json: the permission's hash, the encodings, the
// offer, the account's typed data and call, the header, the resource server's checks, the reference and the read of
// the transaction that should hold the approval. Every expected value is the file's, each hash and encoding viem's
// output, which this test also recomputes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeFunctionData, hashTypedData, parseAbi, recoverTypedDataAddress } from "viem";
import { ReaderError, type EvmReader, type Hex } from "../src/evm.js";
import { isRefusal } from "../src/index.js";
import {
  APPROVE_SELECTOR,
  APPROVE_WITH_SIGNATURE_SELECTOR,
  IS_APPROVED_SELECTOR,
  IS_REVOKED_SELECTOR,
  SPEND_PERMISSION_APPROVED_TOPIC,
  SPEND_PERMISSION_REVOKED_TOPIC,
  SPEND_PERMISSION_TYPEHASH,
  approvedIn,
  checkReturn,
  decodeSpendPermissionHeader,
  encodeSpendPermissionHeader,
  permissionHash,
  spendPermissionsEip155 as pairing,
} from "../src/spend-permissions.js";
import { readerOf, type ChainTx } from "./evm-chain.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/spend-permissions-eip155.json", import.meta.url), "utf8"));
const F = V.fixed;
type Obj = Record<string, unknown>;

/** A row's value with each {"$repeat": [s, n]} as s repeated n times, and each {"$repeat0x": [s, n]} with `0x` before. */
function expand(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expand);
  if (typeof v !== "object" || v === null) return v;
  const o = v as Obj;
  if (Array.isArray(o["$repeat"])) return (o["$repeat"][0] as string).repeat(o["$repeat"][1] as number);
  if (Array.isArray(o["$repeat0x"])) return `0x${(o["$repeat0x"][0] as string).repeat(o["$repeat0x"][1] as number)}`;
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, expand(x)]));
}

/** A copy of `o` with the member at `path` set to `value`, or removed where `absent`. */
function changed(o: unknown, path: readonly string[], value: unknown, absent = false): Obj {
  const c = structuredClone(o) as Obj;
  let x = c;
  for (const k of path.slice(0, -1)) x = x[k] as Obj;
  if (absent) delete x[path.at(-1)!];
  else x[path.at(-1)!] = value;
  return c;
}

const codeOf = (v: unknown): string | undefined => (isRefusal(v) ? v.code : undefined);

const TYPES = {
  SpendPermission: [
    { name: "account", type: "address" },
    { name: "spender", type: "address" },
    { name: "token", type: "address" },
    { name: "allowance", type: "uint160" },
    { name: "period", type: "uint48" },
    { name: "start", type: "uint48" },
    { name: "end", type: "uint48" },
    { name: "salt", type: "uint256" },
    { name: "extraData", type: "bytes" },
  ],
} as const;
const messageOf = (p: Record<string, string>) => ({
  account: p["account"] as Hex,
  spender: p["spender"] as Hex,
  token: p["token"] as Hex,
  allowance: BigInt(p["allowance"]!),
  period: Number(p["period"]),
  start: Number(p["start"]),
  end: Number(p["end"]),
  salt: BigInt(p["salt"]!),
  extraData: p["extraData"] as Hex,
});
const domainOf = (network: string, manager: string) => ({
  name: "Spend Permission Manager",
  version: "1",
  chainId: Number(network.split(":")[1]),
  verifyingContract: manager as Hex,
});
const ABI = parseAbi([
  "struct SpendPermission { address account; address spender; address token; uint160 allowance; uint48 period; uint48 start; uint48 end; uint256 salt; bytes extraData; }",
  "function approve(SpendPermission spendPermission) returns (bool)",
  "function isApproved(SpendPermission spendPermission) view returns (bool)",
  "function isRevoked(SpendPermission spendPermission) view returns (bool)",
]);

describe("spend-permissions-eip155.json: the permission's hash and the manager's encodings", () => {
  for (const r of rowsOf<{ case: string; permission: Record<string, string>; network: string; manager: string; expect: string }>(V.hash, "hash rows", { exact: 2 })) {
    it(`permissionHash: ${r.case}`, async () => {
      expect(permissionHash(r.permission as never, r.network as never, r.manager as Hex)).toBe(r.expect);
      expect(hashTypedData({ domain: domainOf(r.network, r.manager), types: TYPES, primaryType: "SpendPermission", message: messageOf(r.permission) })).toBe(r.expect);
    });
  }

  it("the typehash, the selectors, the event topics and the calls are the manager's", () => {
    const E = V.encodings;
    expect([SPEND_PERMISSION_TYPEHASH, APPROVE_SELECTOR, APPROVE_WITH_SIGNATURE_SELECTOR, IS_APPROVED_SELECTOR, IS_REVOKED_SELECTOR]).toEqual([
      E.typehash,
      E.selectors.approve,
      E.selectors.approveWithSignature,
      E.selectors.isApproved,
      E.selectors.isRevoked,
    ]);
    expect([SPEND_PERMISSION_APPROVED_TOPIC, SPEND_PERMISSION_REVOKED_TOPIC]).toEqual([E.approvedTopics[0], E.revokedTopics[0]]);
    const m = messageOf(F.permission);
    expect(encodeFunctionData({ abi: ABI, functionName: "approve", args: [m] })).toBe(E.approve);
    expect(encodeFunctionData({ abi: ABI, functionName: "isApproved", args: [m] })).toBe(E.isApproved);
    expect(encodeFunctionData({ abi: ABI, functionName: "isRevoked", args: [m] })).toBe(E.isRevoked);
    expect(encodeAbiParameters([{ type: "tuple", components: TYPES.SpendPermission }], [m])).toBe(E.eventData);
  });

  it("the file's signature is the account's over the permission's hash", async () => {
    const signer = await recoverTypedDataAddress({
      domain: domainOf(F.network, F.manager),
      types: TYPES,
      primaryType: "SpendPermission",
      message: messageOf(F.permission),
      signature: F.signature,
    });
    expect(signer.toLowerCase()).toBe(F.account);
  });
});

describe("spend-permissions-eip155.json: the offer", () => {
  it("advertise writes the body, read reads it back, and unplaced gives the offer before H", () => {
    expect(pairing.advertise({}, F.H, F.L, F.offerInput)).toEqual(F.body);
    expect(pairing.read(F.body)).toEqual({ h: F.H, link: F.L, offer: F.offer });
    expect(pairing.unplaced(F.offer)).toEqual(F.offerInput);
    expect(pairing.tie(F.offer)).toEqual(["spendPermission", F.offer]);
    const refused = pairing.advertise({}, F.H, F.L, F.offerInput, "spend-permissions/ended");
    expect(refused).toEqual({ ...F.body, error: "spend-permissions/ended" });
    expect(pairing.read(refused as never)).toEqual({ h: F.H, link: F.L, offer: F.offer, error: "spend-permissions/ended" });
  });

  for (const r of rowsOf<{ case: string; path: string[]; value: unknown; expect: string }>(V.offerRefusals, "offerRefusals", { exact: 12 })) {
    it(`the manager's refusals and the offer's form: ${r.case}`, () => {
      expect(codeOf(pairing.read(changed(F.body, ["spendPermission", ...r.path], r.value) as never))).toBe(r.expect);
      if (r.path[0] === "permission" || r.path[0] === "accepts" || r.path[0] === "extra" || r.path[0] === "manager") {
        expect(codeOf(pairing.advertise({}, F.H, F.L, changed(F.offerInput, r.path, r.value) as never))).toBe(r.expect);
      }
    });
  }

  for (const r of rowsOf<{ case: string; path: string[]; value?: unknown; absent?: boolean; expect: string }>(V.readRefusals, "readRefusals", { exact: 6 })) {
    it(`read: ${r.case}`, () => {
      expect(codeOf(pairing.read(changed(F.body, r.path, r.value, r.absent === true) as never))).toBe(r.expect);
    });
  }

  for (const r of rowsOf<{ case: string; path?: string[]; value?: unknown; link?: string; h?: string; error?: string; expect: string }>(V.advertiseRefusals, "advertiseRefusals", { exact: 4 })) {
    it(`advertise: ${r.case}`, () => {
      const offer = r.path === undefined ? F.offerInput : changed(F.offerInput, r.path, r.value);
      expect(codeOf(pairing.advertise({}, (r.h ?? F.H) as never, r.link ?? F.L, offer as never, r.error as never))).toBe(r.expect);
    });
  }
});

describe("spend-permissions-eip155.json: the account's act", () => {
  it("build gives the whole permission, its hash, the typed data that hashes to it and the approve call", async () => {
    const u = await pairing.build(V.build.choice, F.H);
    if (isRefusal(u)) throw new Error(u.code);
    expect({ permission: u.permission, hash: u.hash, approve: u.approve }).toEqual({
      permission: V.build.expect.permission,
      hash: V.build.expect.hash,
      approve: V.build.expect.approve,
    });
    expect(u.typedData).toMatchObject(V.build.expect.typedData);
    expect(hashTypedData(u.typedData as never)).toBe(V.build.expect.hash);
  });

  for (const r of rowsOf<{ case: string; h?: string; account?: string; expect: string }>(V.buildRefusals, "buildRefusals", { exact: 3 })) {
    it(`build: ${r.case}`, async () => {
      const choice = { ...V.build.choice, ...(r.account === undefined ? {} : { account: r.account }) };
      expect(codeOf(await pairing.build(choice, (r.h ?? F.H) as never))).toBe(r.expect);
    });
  }
});

describe("spend-permissions-eip155.json: the return", () => {
  for (const route of ["signature", "transaction"] as const) {
    it(`the header on the ${route} route: encoded and decoded as the file's`, () => {
      const H = V.header[route];
      expect(encodeSpendPermissionHeader(H.return)).toBe(H.value);
      expect(decodeSpendPermissionHeader(H.value)).toEqual(H.return);
    });
  }

  for (const r of rowsOf<{ case: string; value?: string; bytesHex?: string; json?: unknown; expect: string }>(V.headerRefusals, "headerRefusals", { exact: 21 })) {
    it(`the header: ${r.case}`, async () => {
      const value =
        r.value ??
        Buffer.from(r.bytesHex !== undefined ? Buffer.from(r.bytesHex, "hex") : Buffer.from(JSON.stringify(expand(r.json)), "utf8")).toString("base64url");
      expect(codeOf(decodeSpendPermissionHeader(value))).toBe(r.expect);
      if (r.json !== undefined) {
        const presented = expand(r.json);
        expect([codeOf(encodeSpendPermissionHeader(presented as never)), codeOf(await pairing.bound(presented))]).toEqual([r.expect, r.expect]);
      }
    });
  }

  it("bound gives the salt as H; given another H, not-bound; broadcaster names who sends each route", async () => {
    expect(await pairing.bound(V.header.signature.return)).toBe(F.H);
    expect(await pairing.bound(V.header.transaction.return)).toBe(F.H);
    expect(codeOf(await pairing.bound(V.header.signature.return, { act: "agreement", h: V.buildRefusals[0].h }))).toBe("spend-permissions/not-bound");
    expect(await pairing.broadcaster(V.header.signature.return)).toBe("payee");
    expect(await pairing.broadcaster(V.header.transaction.return)).toBe("payer");
  });

  it("checkReturn passes the return before end, at end's last second included", () => {
    expect(checkReturn(V.header.signature.return, F.offer, V.checkReturn.pass.now)).toEqual(V.checkReturn.pass.expect);
    expect(checkReturn(V.header.signature.return, F.offer, V.checkReturn.passAtLastSecond.now)).toEqual(V.checkReturn.passAtLastSecond.expect);
  });

  for (const r of rowsOf<{ case: string; path?: string[]; value?: unknown; now?: number; offerAccepts?: string[]; expect: string }>(V.checkReturn.refusals, "checkReturn refusals", { exact: 16 })) {
    it(`checkReturn: ${r.case}`, () => {
      const presented = r.path === undefined ? V.header.signature.return : changed(V.header.signature.return, r.path, r.value);
      const offer = r.offerAccepts === undefined ? F.offer : { ...F.offer, accepts: r.offerAccepts };
      expect(codeOf(checkReturn(presented, offer, r.now ?? V.checkReturn.pass.now))).toBe(r.expect);
    });
  }

  it("reference gives the read keys, and on the transaction route the transaction the return names", async () => {
    expect(await pairing.reference(V.header.signature.return, F.offer)).toEqual(V.expectReference);
    expect(await pairing.reference(V.header.transaction.return, F.offer)).toEqual({ ...V.expectReference, transaction: V.header.transaction.return.transaction });
  });

  for (const r of rowsOf<{ case: string; path?: string[]; value?: unknown; h?: string; expect: string }>(V.referenceRefusals, "referenceRefusals", { exact: 2 })) {
    it(`reference: ${r.case}`, async () => {
      const presented = r.path === undefined ? V.header.signature.return : changed(V.header.signature.return, r.path, r.value);
      const given = r.h === undefined ? undefined : { act: "agreement" as const, h: r.h as never };
      expect(codeOf(await pairing.reference(presented, F.offer, given))).toBe(r.expect);
    });
  }
});

describe("spend-permissions-eip155.json: approvedIn", () => {
  const A = V.approvedIn;
  const E = V.encodings;
  const tx = V.header.transaction.return.transaction as Hex;
  const logsOf = (kind: string) =>
    kind === "none"
      ? []
      : [{ address: (kind === "elsewhere" ? "0x00000000000000000000000000000000000e15e1" : F.manager) as Hex, topics: E.approvedTopics as Hex[], data: E.eventData as Hex }];
  for (const r of rowsOf<{ case: string; status: 0 | 1 | null; logs: string; revoked: boolean; readerNetwork?: string; expect: unknown }>(A.rows, "approvedIn rows", { exact: 7 })) {
    it(r.case, async () => {
      const txs: ChainTx[] = r.status === null ? [] : [{ hash: tx, block: BigInt(A.block), status: r.status, logs: logsOf(r.logs) }];
      const asked: string[] = [];
      const reader: EvmReader = {
        ...readerOf({
          network: (r.readerNetwork ?? F.network) as never,
          heads: { finalized: 2000n, safe: 2000n, latest: 2000n },
          time: (b) => b,
          txs,
          call: async (to, data) => {
            asked.push(data.slice(0, 10));
            if (to.toLowerCase() !== F.manager || data !== E.isRevoked) throw new ReaderError("transport");
            return `0x${(r.revoked ? 1n : 0n).toString(16).padStart(64, "0")}` as Hex;
          },
        }),
      };
      const got = await approvedIn(V.header.transaction.return, reader);
      if (typeof r.expect === "string") expect(codeOf(got)).toBe(r.expect);
      else expect(got).toEqual({ transaction: tx, block: BigInt(A.block) });
    });
  }
});

describe("spend-permissions-eip155.json: the read of the approval by the permission's hash", () => {
  const E = V.encodings;
  const permission = messageOf(F.permission);
  const call = (name: "revoke" | "revokeAsSpender") =>
    encodeFunctionData({ abi: parseAbi([`function ${name}((address,address,address,uint160,uint48,uint48,uint48,uint256,bytes))`]), functionName: name, args: [Object.values(permission)] as never }) as Hex;
  const revokedLog = { address: F.manager as Hex, topics: E.revokedTopics as Hex[], data: E.eventData as Hex };
  const approvedLog = { address: F.manager as Hex, topics: E.approvedTopics as Hex[], data: E.eventData as Hex };
  const T1 = `0x${"01".repeat(32)}` as Hex;
  /** A ledger whose finalized head is 1500, holding `txs`, the value read approved or revoked from each one's block. */
  const readerWith = (txs: ChainTx[]): EvmReader => {
    const from = (topic: string) => txs.filter((t) => t.status === 1 && t.logs.some((l) => l.topics[0] === topic)).map((t) => t.block)[0];
    return readerOf({
      network: F.network,
      heads: { finalized: 1500n, safe: 1600n, latest: 1700n },
      time: (b) => 1_790_000_000n + b,
      txs,
      call: async (_to, data, block) => {
        const at = data === E.isApproved ? from(E.approvedTopics[0]) : data === E.isRevoked ? from(E.revokedTopics[0]) : undefined;
        return `0x${(at !== undefined && block >= at ? 1n : 0n).toString(16).padStart(64, "0")}` as Hex;
      },
    });
  };
  const query = { act: "agreement", finality: "finalized", after: 100n } as const;

  it("the approval settles the act, signed by the account, moving nothing, presented yes", async () => {
    const ref = V.expectReference;
    const a = await pairing.status(ref, readerWith([{ hash: T1, block: 1000n, status: 1, logs: [approvedLog], from: F.permission.spender, input: "0x" }]), query);
    expect(a).toEqual({ state: "settled", transaction: T1, position: 1000n, finality: "finalized", signer: F.account, presented: "yes", foreign: [] });
  });

  it("an unapproved permission is instrument-live, for as long as the caller asks", async () => {
    expect(await pairing.status(V.expectReference, readerWith([]), query)).toEqual({ state: "pending", reason: "instrument-live", foreign: [] });
  });

  it("a revocation before any approval is instrument-consumed, its signer read from the call that revoked it", async () => {
    for (const [name, signer, carries] of [
      ["revoke", F.account, "other-kind"],
      ["revokeAsSpender", F.permission.spender, "payee-signed"],
    ] as const) {
      const tx: ChainTx = { hash: T1, block: 1000n, status: 1, logs: [revokedLog], from: signer, to: F.manager, input: call(name) };
      expect(await pairing.status(V.expectReference, readerWith([tx]), query), name).toEqual({
        state: "failed",
        reason: "instrument-consumed",
        transaction: T1,
        position: 1000n,
        finality: "finalized",
        signer,
        carries,
        foreign: [],
      });
    }
  });

  it("the act payment, which the pairing has none of, is unreadable with nothing read", async () => {
    const reader = readerWith([]) as EvmReader & { asked: string[] };
    expect(await pairing.status(V.expectReference, reader, { ...query, act: "payment" })).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
    expect(reader.asked).toEqual([]);
  });
});
