// x402/exact/eip155/gateway-batched against x402-exact-eip155-gateway-batched.json, whose oracle is Circle's own client,
// @circle-fin/x402-batching 4.0.0, with viem 2.57.4 as the independent EIP-712 check. Every expected value is the
// file's; the client's outputs are made again here, so the file is held to the client as well as lcp to the file.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { supportsBatching } from "@circle-fin/x402-batching";
import { BatchEvmScheme, CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { BINDINGS, isRefusal, pairingOf, type AtrHash } from "../src/index.js";
import {
  exactEip3009,
  exactGatewayBatched,
  pairingOfPayment,
  type GatewayBatchedPayment,
  type GatewayBatchedTypedData,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-eip155-gateway-batched.json", import.meta.url), "utf8"));
const F = V.fixed;
const H: AtrHash = F.H;
const ID = "x402/exact/eip155/gateway-batched";
const OPTIONS: Record<string, PaymentRequirements> = { O1: F.O1, O2: F.O2, O3: F.O3 };

const docOf = (o: PaymentRequirements): PaymentRequired => ({ x402Version: 2, resource: F.resource, accepts: [o], extensions: F.extensions });
/** The document `advertise` places H in: the option alone, with no extension yet. */
const bareOf = (o: PaymentRequirements): PaymentRequired => ({ x402Version: 2, resource: F.resource, accepts: [o] });
const choiceOf = (o: PaymentRequirements, more: Record<string, unknown> = {}) => ({
  required: docOf(o),
  accepted: o,
  from: F.payer,
  now: F.now,
  minValiditySeconds: F.minValiditySeconds,
  ...more,
});

/** The value at a JSON Pointer (RFC 6901) into the file. */
const at = (pointer: string): unknown =>
  pointer
    .split("/")
    .slice(1)
    .reduce((o, k) => (o as Record<string, unknown>)[k], V as unknown);

/** A copy of `v` with each dotted path set to its value, or removed where the value is null. */
function withSet<T>(v: T, set: Record<string, unknown>): T {
  const copy = structuredClone(v) as Record<string, unknown>;
  for (const [path, value] of Object.entries(set)) {
    const keys = path.split(".");
    let o = copy;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    if (value === null) delete o[keys[keys.length - 1]!];
    else o[keys[keys.length - 1]!] = value;
  }
  return copy as T;
}

const forViem = (t: GatewayBatchedTypedData) => t as unknown as Parameters<typeof hashTypedData>[0];

/** Circle's client's signing step for an authorization it is given, with the typed data it hands its signer. */
async function circleSigns(key: `0x${string}`, authorization: unknown, o: PaymentRequirements) {
  const account = privateKeyToAccount(key);
  let seen: unknown;
  const signer = {
    address: account.address,
    signTypedData: async (td: Parameters<typeof account.signTypedData>[0]) => {
      seen = td;
      return account.signTypedData(td);
    },
  };
  const scheme = new BatchEvmScheme(signer) as unknown as {
    signAuthorization(a: unknown, r: unknown, verifyingContract: string, version: string): Promise<`0x${string}`>;
  };
  const extra = o.extra as Record<string, string>;
  const signature = await scheme.signAuthorization(authorization, o, extra["verifyingContract"]!, extra["version"] ?? "1");
  return { signature, typedData: seen as Parameters<typeof hashTypedData>[0] };
}

const lowerSalt = (d: Record<string, unknown>) => (typeof d["salt"] === "string" ? { ...d, salt: (d["salt"] as string).toLowerCase() } : d);

afterEach(() => {
  vi.useRealTimers();
});

describe("S: the authorization under each domain", () => {
  it.each(rowsOf<{ case: string; option: string; domain: Record<string, unknown>; digest: string; signature: `0x${string}`; payment: PaymentPayload }>(V.S, "S", { exact: 3 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, row) => {
      const o = OPTIONS[row.option]!;
      const circle = await circleSigns(F.payerKey, (row.payment.payload as { authorization: unknown }).authorization, o);
      expect(circle.signature).toBe(row.signature);
      expect(hashTypedData(circle.typedData)).toBe(row.digest);

      const unsigned = await exactGatewayBatched.build(choiceOf(o), H);
      if (isRefusal(unsigned)) throw new Error(unsigned.code);
      expect(lowerSalt(unsigned.typedData.domain)).toEqual(lowerSalt(row.domain));
      expect(hashTypedData(forViem(unsigned.typedData))).toBe(row.digest);
      expect(await recoverTypedDataAddress({ ...forViem(unsigned.typedData), signature: row.signature })).toBe(F.payer);
      expect(unsigned.complete(row.signature)).toEqual(row.payment);

      expect(await exactGatewayBatched.bound(row.payment)).toBe(H);
      expect(await exactGatewayBatched.authorizer(row.payment)).toBe(F.payer.toLowerCase());
      expect(await exactGatewayBatched.broadcaster(row.payment)).toBe("payee");
      expect(pairingOfPayment(row.payment)).toBe(ID);
      expect(pairingOf(o)).toBe(ID);
    },
  );

  it("complete takes a 65-byte signature alone", async () => {
    const unsigned = await exactGatewayBatched.build(choiceOf(F.O2), H);
    if (isRefusal(unsigned)) throw new Error(unsigned.code);
    const sig = V.S[1].signature as string;
    expect(unsigned.complete(sig.slice(0, -2) as `0x${string}`)).toEqual({ refused: true, code: "x402/signature-malformed" });
    expect(unsigned.complete(`${sig}00` as `0x${string}`)).toEqual({ refused: true, code: "x402/signature-malformed" });
  });
});

describe("W: the validity window", () => {
  it.each(rowsOf<{ case: string; maxTimeoutSeconds: number; now: number; minValiditySeconds: number; validAfter: string; validBefore: string }>(V.W, "W", { exact: 3 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, row) => {
      const o = { ...F.O2, maxTimeoutSeconds: row.maxTimeoutSeconds };
      vi.useFakeTimers({ now: row.now * 1000, toFake: ["Date"] });
      const circle = await new BatchEvmScheme(privateKeyToAccount(F.payerKey)).createPaymentPayload(2, o);
      vi.useRealTimers();
      const a = circle.payload.authorization;
      expect([a.validAfter, a.validBefore]).toEqual([row.validAfter, row.validBefore]);

      const unsigned = await exactGatewayBatched.build(choiceOf(o, { now: row.now, minValiditySeconds: row.minValiditySeconds }), H);
      if (isRefusal(unsigned)) throw new Error(unsigned.code);
      const m = unsigned.typedData.message;
      expect([m.validAfter.toString(), m.validBefore.toString()]).toEqual([row.validAfter, row.validBefore]);
    },
  );
});

describe("wallets: the Gateway Wallet and USDC on each network", () => {
  const rows = rowsOf<{ name: string; network: string; gatewayWallet: string; usdc: string }>(V.wallets, "wallets", { exact: 24 });
  it("is Circle's client's own table", () => {
    const circle = Object.entries(CHAIN_CONFIGS).map(([name, c]) => ({
      name,
      network: `eip155:${c.chain.id}`,
      gatewayWallet: c.gatewayWallet,
      usdc: c.tokens.USDC?.address,
    }));
    expect(circle).toEqual(rows);
  });
  it.each(rows.map((r) => [r.name, r] as const))("%s: version 1 is served for its USDC alone, as Circle's client signs it", async (_, row) => {
    const usdc = { ...F.O1, network: row.network, asset: row.usdc, extra: { ...F.O1.extra, verifyingContract: row.gatewayWallet } };
    const other = { ...usdc, asset: F.notUsdc };
    const client = new BatchEvmScheme(privateKeyToAccount(F.payerKey));
    await expect(client.createPaymentPayload(2, usdc)).resolves.toMatchObject({ x402Version: 2 });
    await expect(client.createPaymentPayload(2, other)).rejects.toThrow("Gateway accepts version 1 for USDC only");
    expect(isRefusal(exactGatewayBatched.read(docOf(usdc)))).toBe(false);
    expect(exactGatewayBatched.advertise(bareOf(other), H, F.link, other)).toEqual({ refused: true, code: "x402/option-malformed" });
    const v2 = { ...other, extra: { ...other.extra, version: "2" } };
    await expect(client.createPaymentPayload(2, v2)).resolves.toMatchObject({ x402Version: 2 });
    expect(isRefusal(exactGatewayBatched.read(docOf(v2)))).toBe(false);
  });
  it.each(rows.map((r) => [r.name, r] as const))("%s: its own wallet is served, the other refused", (_, row) => {
    const o = { ...F.O2, network: row.network, extra: { ...F.O2.extra, verifyingContract: row.gatewayWallet } };
    const otherWallet = row.gatewayWallet === F.O3.extra.verifyingContract ? F.O1.extra.verifyingContract : F.O3.extra.verifyingContract;
    expect(isRefusal(exactGatewayBatched.read(docOf(o)))).toBe(false);
    expect(exactGatewayBatched.read(docOf({ ...o, extra: { ...o.extra, verifyingContract: otherWallet } }))).toEqual({
      refused: true,
      code: "x402/no-payable-option",
    });
  });
});

describe("filter: the option filter", () => {
  const LINK = F.link;
  it.each(rowsOf<{ case: string; option: PaymentRequirements; expect: string; circle: boolean }>(V.filter, "filter", { exact: 21 }).map((r) => [r.case, r] as const))(
    "%s",
    (_, row) => {
      expect(supportsBatching(row.option as never)).toBe(row.circle);
      const doc = docOf(row.option);
      const advertised = exactGatewayBatched.advertise(bareOf(row.option), H, LINK, row.option);
      if (row.expect === "offered") {
        expect(isRefusal(advertised)).toBe(false);
        expect(isRefusal(exactGatewayBatched.read(doc))).toBe(false);
        expect(pairingOf(row.option)).toBe(ID);
      } else {
        expect(advertised).toEqual({ refused: true, code: row.expect });
        expect(exactGatewayBatched.read(doc)).toEqual({ refused: true, code: "x402/no-payable-option" });
        expect(pairingOf(row.option)).not.toBe(ID);
      }
    },
  );
});

describe("eip3009Filter: x402/exact/eip155/eip3009 refuses the batched option", () => {
  it.each(rowsOf<{ case: string; option: PaymentRequirements; expect: string }>(V.eip3009Filter, "eip3009Filter", { exact: 4 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, row) => {
      const doc = docOf(row.option);
      expect(exactEip3009.advertise(bareOf(row.option), H, F.link, row.option)).toEqual({ refused: true, code: row.expect });
      expect(exactEip3009.read(doc)).toEqual({ refused: true, code: "x402/no-payable-option" });
      expect(await exactEip3009.build({ required: doc, accepted: row.option, from: F.payer, now: F.now }, H)).toEqual({ refused: true, code: row.expect });
    },
  );
});

describe("build: the buyer's choice", () => {
  it.each(rowsOf<{ case: string; set: Record<string, unknown>; expect: string }>(V.build, "build", { exact: 5 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, row) => {
      const good = choiceOf(F.O2);
      expect(isRefusal(await exactGatewayBatched.build(good, H))).toBe(false);
      expect(await exactGatewayBatched.build(withSet(good, row.set), H)).toEqual({ refused: true, code: row.expect });
    },
  );
});

describe("bound: H as the authorization's nonce", () => {
  it.each(rowsOf<{ case: string; payment: string; set: Record<string, unknown>; expect: string }>(V.bound, "bound", { exact: 6 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, row) => {
      const got = await exactGatewayBatched.bound(withSet(at(row.payment), row.set));
      expect(got).toEqual(row.expect.startsWith("x402/") ? { refused: true, code: row.expect } : row.expect);
    },
  );
});

describe("authorizer: the account the signature recovers to", () => {
  it.each(rowsOf<{ case: string; payment: string; set: Record<string, unknown>; expect: string }>(V.authorizer, "authorizer", { exact: 10 }).map((r) => [r.case, r] as const))(
    "%s",
    async (_, row) => {
      const got = await exactGatewayBatched.authorizer(withSet(at(row.payment), row.set));
      expect(got).toEqual(row.expect.startsWith("x402/") ? { refused: true, code: row.expect } : row.expect);
    },
  );

  it("check: the other account's signature and the high-s signature are what the file says", async () => {
    const S1 = V.S[1].payment as PaymentPayload & { payload: { authorization: unknown } };
    const other = await circleSigns(F.otherKey, S1.payload.authorization, F.O2);
    expect(other.signature).toBe(V.check.otherSigned);
    expect(await recoverTypedDataAddress({ ...other.typedData, signature: V.check.otherSigned })).toBe(V.check.otherAddress);
    const own = await circleSigns(F.payerKey, S1.payload.authorization, F.O2);
    expect(await recoverTypedDataAddress({ ...own.typedData, signature: V.check.highS })).toBe(V.check.highSRecovers);
    expect(await recoverTypedDataAddress({ ...own.typedData, signature: V.check.v1SigUnderO2 })).toBe(V.check.v1SigUnderO2Recovers);
    const changed = await circleSigns(F.payerKey, { ...(S1.payload.authorization as object), value: "10001" }, F.O2);
    expect(await recoverTypedDataAddress({ ...changed.typedData, signature: V.S[1].signature })).toBe(V.check.value10001Recovers);
  });
});

describe("signer: the account authorizer gives, beside the authorization's from and the agreement's signer", () => {
  type Row = { case: string; payment: string; set: Record<string, unknown>; agreementSigner: string; signer: string; isFrom: boolean; isAgreementSigner: boolean };
  it.each(rowsOf<Row>(V.signer, "signer", { exact: 4 }).map((r) => [r.case, r] as const))("%s", async (_, row) => {
    const presented = withSet(at(row.payment), row.set) as GatewayBatchedPayment;
    const signer = await exactGatewayBatched.authorizer(presented);
    expect(signer).toBe(row.signer);
    expect(signer === presented.payload.authorization.from.toLowerCase()).toBe(row.isFrom);
    expect(signer === row.agreementSigner.toLowerCase()).toBe(row.isAgreementSigner);
  });
});

describe("the registry entry", () => {
  it("is in BINDINGS once, at coverage none with a link, after an agreement on the same network, with no read", () => {
    expect(BINDINGS.filter((b) => b.id === ID)).toEqual([exactGatewayBatched]);
    const d = exactGatewayBatched.data;
    expect([d.coverage, d.link, d.agreementOn, d.nonce, d.broadcasts, d.confirmed, d.read]).toEqual([
      "none",
      "h",
      "same-network",
      "unshown",
      "payee",
      "yes",
      undefined,
    ]);
    const members = exactGatewayBatched as Record<string, unknown>;
    expect([members["reference"], members["status"], members["recover"]]).toEqual([undefined, undefined, undefined]);
  });
});
