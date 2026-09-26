// Expected values come from vectors/x402-exact-sui.json: its V2 bytes and recipe R, a real testnet
// transaction read over GraphQL, and Python's hashlib Blake2b digests. Nothing here is a snapshot of this code.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { ReaderError } from "../src/evm.js";
import {
  decodeSuiTx,
  exactSui,
  suiCarrier,
  suiPairingOf,
  type SuiPaymentPayload,
  type SuiReader,
  type SuiRef,
} from "../src/sui.js";
import type { PaymentRequired } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-sui.json", import.meta.url), "utf8"));
const H: `0x${string}` = V.fixed.H;
const O = V.fixed.O;
const LINK: string = V.fixed.link;
const REQUIRED: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const TX: Record<string, string> = { V1: V.V1.tx.transactionBase64, V2: V.V2.tx.transactionBase64 };

function bytesOf(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function payment(transaction: string, accepted = O): SuiPaymentPayload {
  return { x402Version: 2, accepted, payload: { signature: "AAAA", transaction } };
}

type Answer = { tx: string; status: "SUCCESS" | "FAILURE"; checkpoint: string } | null;

function reader(network: string, answer: Answer | "error", epoch = "1234"): SuiReader & { calls: number } {
  const r = {
    network: network as SuiReader["network"],
    calls: 0,
    async read() {
      r.calls++;
      if (answer === "error") throw new ReaderError("timeout");
      return {
        tx:
          answer === null
            ? null
            : { transactionBcs: bytesOf(TX[answer.tx]!), status: answer.status, checkpoint: BigInt(answer.checkpoint) },
        epoch: BigInt(epoch),
      };
    },
  };
  return r;
}

function refOf(v: { network: string; digest: string; untilEpoch: string; h: string }): SuiRef & { h: `0x${string}` } {
  return { network: v.network as SuiRef["network"], digest: v.digest, untilEpoch: v.untilEpoch, h: v.h as `0x${string}` };
}

/** A reference as the issuer stores it: through JSON, which throws on a bigint. The round trip must change nothing. */
function throughJson<T>(v: T): T {
  const back = JSON.parse(JSON.stringify(v)) as T;
  expect(back).toEqual(v);
  return back;
}

function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

describe("recipe R", () => {
  it("@mysten/sui 2.31.3 builds the vector's V2 bytes", async () => {
    const tx = new Transaction();
    tx.setSender(V.fixed.sender);
    tx.pure(bytesOf(Buffer.from(H.slice(2), "hex").toString("base64")));
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(10000)]);
    tx.transferObjects([coin!], tx.pure.address(V.fixed.payTo));
    tx.setGasPrice(1000);
    tx.setGasBudget(5000000);
    tx.setGasPayment([]);
    tx.setExpiration({ Epoch: 1234 });
    expect(Buffer.from(await tx.build()).toString("base64")).toBe(V.V2.tx.transactionBase64);
  });
});

describe("V1 · the real rail", () => {
  it("decodes to the chain's digest; every input is used", async () => {
    const tx = decodeSuiTx(V.V1.tx.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.bytes.length).toBe(V.V1.tx.bytes);
    expect(tx.digest).toBe(V.V1.tx.digest);
    expect(tx.digest).toBe("EV7D7z9gjzjrAQSKWSW8S1iLGdk8aEVPjn3zLA1aUSLE");
    expect(tx.untilEpoch).toBe(V.V1.expectUntilEpoch);
    expect(await exactSui.bound(payment(V.V1.tx.transactionBase64))).toEqual({ refused: true, code: V.V1.expectBound });
  });
});

describe("V2 · carried", () => {
  it("bound gives H; reference gives the digest and the epoch", async () => {
    const tx = decodeSuiTx(V.V2.tx.transactionBase64);
    if ("refused" in tx) throw new Error(tx.code);
    expect(tx.bytes.length).toBe(V.V2.tx.bytes);
    expect(tx.digest).toBe(V.V2.tx.digest);
    expect(suiCarrier(tx)).toBe(H);
    const p = payment(V.V2.tx.transactionBase64);
    expect(await exactSui.bound(p)).toBe(V.V2.expectBound);
    const ref = throughJson(await exactSui.reference(p));
    expect(ref).toEqual(V.V2.expectReference);
    const r = reader(V.V4.ref.network, { tx: "V2", status: "SUCCESS", checkpoint: "7" });
    expect(plain(await exactSui.status({ ...(ref as SuiRef), h: H }, r))).toEqual({ state: "settled", checkpoint: "7" });
  });
});

describe("the Validity expiration", () => {
  for (const row of V.validity.rows) {
    it(row.case, async () => {
      const tx = decodeSuiTx(row.tx.transactionBase64);
      if ("refused" in tx) throw new Error(tx.code);
      expect(tx.bytes.length).toBe(row.tx.bytes);
      expect(tx.digest).toBe(row.tx.digest);
      const p = payment(row.tx.transactionBase64);
      expect(await exactSui.bound(p)).toBe(row.expectBound);
      const ref = await exactSui.reference(p);
      if (typeof row.expectReference === "string") expect(ref).toEqual({ refused: true, code: row.expectReference });
      else expect(throughJson(ref)).toEqual(row.expectReference);
    });
  }
});

describe("V3 · refusals", () => {
  for (const row of V.V3) {
    it(row.case, async () => {
      const b64 = row.zeroBytes !== undefined ? Buffer.alloc(row.zeroBytes).toString("base64") : row.tx.transactionBase64;
      if (row.tx !== undefined) {
        const tx = decodeSuiTx(b64);
        if ("refused" in tx) throw new Error(tx.code);
        expect(tx.bytes.length).toBe(row.tx.bytes);
        expect(tx.digest).toBe(row.tx.digest);
      }
      const bound = await exactSui.bound(payment(b64));
      expect(bound).toEqual(row.expectBound.startsWith("0x") ? row.expectBound : { refused: true, code: row.expectBound });
      if (row.expectReference !== undefined) {
        expect(await exactSui.reference(payment(b64))).toEqual({ refused: true, code: row.expectReference });
      }
    });
  }
});

describe("V4 · status and recover", () => {
  for (const row of V.V4.status) {
    it(`status: ${row.case}`, async () => {
      const ref = refOf({ ...V.V4.ref, network: row.refNetwork ?? V.V4.ref.network });
      const r = reader(row.readerNetwork ?? V.V4.ref.network, row.readerError ? "error" : row.answer, row.epoch);
      expect(plain(await exactSui.status(ref, r))).toEqual(row.expect);
      expect(r.calls).toBeLessThanOrEqual(1);
    });
  }
  for (const row of V.V4.recover) {
    it(`recover: ${row.case}`, async () => {
      const r = reader(V.V4.ref.network, row.answer);
      const got = await exactSui.recover({ network: V.V4.ref.network, digest: row.digest }, r);
      expect(got).toEqual(row.expect.startsWith("0x") ? row.expect : { refused: true, code: row.expect });
    });
  }
  it("recover: a reader for another network, a failed read, and no transaction", async () => {
    const ref = { network: "sui:mainnet" as const, digest: V.V2.tx.digest };
    expect(await exactSui.recover(ref, reader("sui:testnet", null))).toEqual({ refused: true, code: "sui/wrong-reader" });
    const t = { ...ref, network: "sui:testnet" as const };
    expect(await exactSui.recover(t, reader("sui:testnet", "error"))).toEqual({ refused: true, code: "sui/unreadable" });
    expect(await exactSui.recover(t, reader("sui:testnet", null))).toEqual({ refused: true, code: "sui/not-found" });
    const failed = reader("sui:testnet", { tx: "V2", status: "FAILURE", checkpoint: "7" });
    expect(await exactSui.recover(t, failed)).toEqual({ refused: true, code: "sui/aborted" });
  });
});

describe("plant", () => {
  it("an aborted transaction with V2's digest and bytes is failed aborted, never settled", async () => {
    const r = reader(V.V4.ref.network, V.plant.answer, V.plant.epoch);
    expect(plain(await exactSui.status(refOf(V.V4.ref), r))).toEqual(V.plant.expect);
  });
});

describe("the pairing's filter", () => {
  it("takes the three named networks and the option's forms", () => {
    expect(suiPairingOf(O)).toBe("x402/exact/sui");
    for (const network of ["sui:mainnet", "sui:devnet"]) expect(suiPairingOf({ ...O, network })).toBe("x402/exact/sui");
    expect(suiPairingOf({ ...O, extra: { paymentFlow: "authorization" } })).toBe("x402/exact/sui");
    expect(suiPairingOf({ ...O, extra: { paymentFlow: "upfront" } })).toBeUndefined();
    expect(suiPairingOf({ ...O, extra: { assetTransferMethod: "eip3009" } })).toBeUndefined();
    expect(suiPairingOf({ ...O, payTo: O.payTo.toUpperCase().replace("0X", "0x") })).toBeUndefined();
    expect(suiPairingOf({ ...O, asset: "SUI" })).toBeUndefined();
    expect(suiPairingOf({ ...O, amount: "18446744073709551616" })).toBeUndefined();
    expect(suiPairingOf({ ...O, amount: "18446744073709551615" })).toBe("x402/exact/sui");
    expect(suiPairingOf({ ...O, network: "eip155:84532" })).toBeUndefined();
  });
  it("refuses an unnamed sui network as network-malformed", async () => {
    expect(await exactSui.bound(payment(V.V2.tx.transactionBase64, { ...O, network: "sui:localnet" }))).toEqual({
      refused: true,
      code: "sui/network-malformed",
    });
  });
});

describe("advertise, read, build and complete", () => {
  it("advertise writes only extensions.legalContext; read gives H, the link and the option", () => {
    const doc = exactSui.advertise(REQUIRED, H, LINK, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts).toEqual([O]);
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: LINK });
    const r = exactSui.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: LINK, options: [O] });
    expect(exactSui.advertise(REQUIRED, H, "http://atr.seller.example/x", O)).toEqual({
      refused: true,
      code: "x402/link-not-https",
    });
  });

  it("build asks the wallet for one unused Pure input holding H; complete accepts only a payment bound to H", async () => {
    const doc = exactSui.advertise(REQUIRED, H, LINK, O) as PaymentRequired;
    const u = await exactSui.build({ required: doc, accepted: O }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("sui-transaction");
    expect(u.request.expiration).toBe("epoch-bounded");
    expect(Buffer.from(u.request.pureInput).toString("hex")).toBe(H.slice(2));
    const signed = u.complete({ signature: "AAAA", transaction: V.V2.tx.transactionBase64 });
    if ("refused" in signed) throw new Error(signed.code);
    expect(signed).toEqual({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: O,
      payload: { signature: "AAAA", transaction: V.V2.tx.transactionBase64 },
      extensions: doc.extensions,
    });
    expect(u.complete({ signature: "AAAA", transaction: V.V1.tx.transactionBase64 })).toEqual({
      refused: true,
      code: "x402/signed-not-bound",
    });
    const unbounded = V.V3.find((r: { case: string }) => r.case.startsWith("setExpiration")).tx.transactionBase64;
    expect(u.complete({ signature: "AAAA", transaction: unbounded })).toEqual({
      refused: true,
      code: "x402/signed-not-bound",
    });
  });

  it("the pattern states what the record proves", () => {
    expect(exactSui.pattern).toMatchObject({
      pattern: "native-field",
      canonical: false,
      profile: "x402/exact/sui",
      buyerSigns: true,
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: false,
      publicProof: true,
    });
    expect(exactSui.claims).toBe(true);
    expect(exactSui.unplaced(O)).toBe(O);
  });
});
