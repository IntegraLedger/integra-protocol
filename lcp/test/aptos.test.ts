// Expected values come from vectors/x402-exact-aptos.json: a real Aptos mainnet transfer read over REST, fixture F
// built with @aptos-labs/ts-sdk 7.3.0 and checked against the vector's SHA-256, and Python's hashlib digests. The
// signing key is generated here, at test time: the pairing never verifies the signer.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  AccountAddress,
  AccountAuthenticatorEd25519,
  ChainId,
  Ed25519PrivateKey,
  EntryFunction,
  RawTransaction,
  Script,
  SignedTransaction,
  SimpleTransaction,
  TransactionAuthenticatorEd25519,
  TransactionPayloadEntryFunction,
  TransactionPayloadScript,
  U64,
  generateSigningMessageForTransaction,
  parseTypeTag,
  type TransactionPayload,
} from "@aptos-labs/ts-sdk";
import { ReaderError } from "../src/evm.js";
import {
  aptosIdDigest,
  aptosPairingOf,
  committedInstrument,
  decodeAptosTx,
  exactAptos,
  type AptosCommitted,
  type AptosPaymentPayload,
  type AptosReader,
  type AptosRef,
} from "../src/aptos.js";
import type { PaymentRequired } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-aptos.json", import.meta.url), "utf8"));
const H: `0x${string}` = V.fixed.H;
const O = V.fixed.O;
const F = V.fixed.fixtureF;
const LINK: string = V.fixed.link;

function transferPayload(): TransactionPayload {
  return new TransactionPayloadEntryFunction(
    EntryFunction.build("0x1::primary_fungible_store", "transfer", [parseTypeTag(F.typeArgument)], [
      AccountAddress.from(F.metadata),
      AccountAddress.from(F.recipient),
      new U64(BigInt(F.amount)),
    ]),
  );
}

function raw(payload = transferPayload(), chainId: number = F.chainId): RawTransaction {
  return new RawTransaction(
    AccountAddress.from(F.sender),
    BigInt(F.sequenceNumber),
    payload,
    BigInt(F.maxGasAmount),
    BigInt(F.gasUnitPrice),
    BigInt(F.expiresAt),
    new ChainId(chainId),
  );
}

/** x402's reference wire form: base64 of the JSON {transaction, senderAuthenticator}, signed by a fresh key. */
function referenceWire(r: RawTransaction): string {
  const key = Ed25519PrivateKey.generate();
  const simple = new SimpleTransaction(r, AccountAddress.from(F.feePayer));
  const auth = new AccountAuthenticatorEd25519(key.publicKey(), key.sign(generateSigningMessageForTransaction(simple)));
  const json = JSON.stringify({ transaction: Array.from(simple.bcsToBytes()), senderAuthenticator: Array.from(auth.bcsToBytes()) });
  return Buffer.from(json).toString("base64");
}

/** The scheme's wire form: base64 of a BCS SignedTransaction. */
function signedWire(r: RawTransaction): string {
  const key = Ed25519PrivateKey.generate();
  const sig = key.sign(generateSigningMessageForTransaction(new SimpleTransaction(r)));
  return Buffer.from(new SignedTransaction(r, new TransactionAuthenticatorEd25519(key.publicKey(), sig)).bcsToBytes()).toString(
    "base64",
  );
}

function payment(transaction: string, extensions?: PaymentRequired["extensions"], accepted = O): AptosPaymentPayload {
  return { x402Version: 2, accepted, payload: { transaction }, ...(extensions ? { extensions } : {}) };
}

/** A reference as the issuer stores it: through JSON, which throws on a bigint. The round trip must change nothing. */
function throughJson<T>(v: T): T {
  const back = JSON.parse(JSON.stringify(v)) as T;
  expect(back).toEqual(v);
  return back;
}

function refOf(v: Record<string, string>): AptosRef {
  return {
    network: v["network"] as AptosRef["network"],
    sender: v["sender"] as `0x${string}`,
    sequenceNumber: v["sequenceNumber"]!,
    expiresAt: v["expiresAt"]!,
    idDigest: v["idDigest"] as `0x${string}`,
    ...(v["transaction"] !== undefined ? { transaction: v["transaction"] as `0x${string}` } : {}),
  };
}

type Row = { ledgerUsecs: string; byHash?: unknown; bySequence?: unknown; readerError?: boolean };

function reader(row: Row, network = "aptos:1", chainId = 1): AptosReader & { calls: number } {
  const r = {
    network: network as AptosReader["network"],
    calls: 0,
    async ledger() {
      r.calls++;
      if (row.readerError) throw new ReaderError("transport");
      return { chainId, timestampUsecs: BigInt(row.ledgerUsecs) };
    },
    async byHash() {
      r.calls++;
      return (row.byHash ?? null) as AptosCommitted | null;
    },
    async bySequence() {
      r.calls++;
      return (row.bySequence ?? null) as AptosCommitted | null;
    },
  };
  return r;
}

function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

describe("fixture F", () => {
  it("is the vector's RawTransaction", () => {
    const b = raw().bcsToBytes();
    expect(b.length).toBe(F.rawTransactionBytes);
    expect("0x" + createHash("sha256").update(b).digest("hex")).toBe(F.rawTransactionSha256);
  });
});

describe("V1 · idDigest from the rail", () => {
  it("committedInstrument of the real answer hashes to the vector", async () => {
    const i = committedInstrument(V.fixed.committed, 1);
    if ("refused" in i) throw new Error(i.code);
    expect({
      arguments: i.arguments,
      function: i.function,
      sender: i.sender,
      sequenceNumber: i.sequenceNumber.toString(),
      typeArguments: i.typeArguments,
    }).toEqual(V.V1.expectNormalForm);
    expect(await aptosIdDigest(i)).toBe(V.V1.expectIdDigest);
  });
});

describe("V2 · reference from the wire", () => {
  it("both wire forms give the rail's idDigest", async () => {
    for (const wire of [referenceWire(raw()), signedWire(raw())]) {
      expect(throughJson(await exactAptos.reference(payment(wire)))).toEqual(V.V2.expectReference);
    }
  });
  it("chain_id 2 on aptos:1", async () => {
    expect(await exactAptos.reference(payment(referenceWire(raw(transferPayload(), 2))))).toEqual({
      refused: true,
      code: V.V2.chainMismatch.expect,
    });
  });
  it("a script payload", async () => {
    const script = new TransactionPayloadScript(new Script(new Uint8Array([0xa1, 0x1c, 0xeb, 0x0b]), [], []));
    expect(decodeAptosTx(referenceWire(raw(script)))).toEqual({ refused: true, code: V.V2.script.expect });
    expect(await exactAptos.reference(payment(signedWire(raw(script))))).toEqual({ refused: true, code: V.V2.script.expect });
  });
  it("a transaction over 64 KiB, and one cut short", () => {
    expect(decodeAptosTx(Buffer.alloc(64 * 1024 + 1).toString("base64"))).toEqual({ refused: true, code: "aptos/tx-too-large" });
    const cut = Buffer.from(raw().bcsToBytes()).subarray(0, 100).toString("base64");
    expect(decodeAptosTx(cut)).toEqual({ refused: true, code: "aptos/tx-malformed" });
  });
});

describe("V3 · bound", () => {
  it("reads the echoed legal context and ignores an appended member", async () => {
    const extensions = { legalContext: { info: V.V3.echoedInfo, schema: {} } };
    expect(await exactAptos.bound(payment(referenceWire(raw()), extensions))).toBe(V.V3.expectBound);
    expect(await exactAptos.bound(payment(referenceWire(raw())))).toEqual({ refused: true, code: V.V3.noLegalContext });
  });
});

describe("V4 · status", () => {
  for (const row of V.V4.status) {
    it(row.case, async () => {
      const r = reader(row);
      expect(plain(await exactAptos.status(refOf(row.ref), r))).toEqual(row.expect);
      expect(r.calls).toBeLessThanOrEqual(3);
    });
  }
  it("a reader for another network, or a ledger for another chain, is unreadable", async () => {
    const row = V.V4.status[0];
    expect(await exactAptos.status(refOf(row.ref), reader(row, "aptos:2"))).toEqual({ state: "pending", why: "unreadable" });
    expect(await exactAptos.status(refOf(row.ref), reader(row, "aptos:1", 2))).toEqual({ state: "pending", why: "unreadable" });
  });
});

describe("plant", () => {
  it("an undocumented vm_status string on a successful commit is settled, never refused", async () => {
    expect(plain(await exactAptos.status(refOf(V.plant.ref), reader(V.plant)))).toEqual(V.plant.expect);
  });
});

describe("the pairing's filter, advertise, read, build and complete", () => {
  it("takes aptos:<1-255> and long-form addresses", () => {
    expect(aptosPairingOf(O)).toBe("x402/exact/aptos");
    expect(aptosPairingOf({ ...O, network: "aptos:2" })).toBe("x402/exact/aptos");
    expect(aptosPairingOf({ ...O, network: "aptos:01" })).toBeUndefined();
    expect(aptosPairingOf({ ...O, network: "aptos:256" })).toBeUndefined();
    expect(aptosPairingOf({ ...O, payTo: "0x1" })).toBeUndefined();
    expect(aptosPairingOf({ ...O, extra: { assetTransferMethod: "x" } })).toBeUndefined();
  });
  it("refuses an unnamed chain id as network-malformed", async () => {
    expect(await exactAptos.bound(payment("AAAA", undefined, { ...O, network: "aptos:0" }))).toEqual({
      refused: true,
      code: "aptos/network-malformed",
    });
  });
  it("advertise and read; build returns the scheme's own request; complete echoes the extensions", async () => {
    const required = exactAptos.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, LINK, O);
    if ("refused" in required) throw new Error(required.code);
    const r = exactAptos.read(required);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: LINK, options: [O] });
    const u = await exactAptos.build({ required, accepted: O }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request).toEqual({ kind: "aptos-transaction", accepted: O });
    const wire = referenceWire(raw());
    const signed = u.complete({ transaction: wire });
    if ("refused" in signed) throw new Error(signed.code);
    expect(signed).toEqual({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: O,
      payload: { transaction: wire },
      extensions: required.extensions,
    });
    expect(await exactAptos.bound(signed)).toBe(H);
    expect(u.complete({ transaction: referenceWire(raw(transferPayload(), 2)) })).toEqual({
      refused: true,
      code: "x402/signed-not-bound",
    });
  });
  it("the pattern states what the record proves, and claims nothing", () => {
    expect(exactAptos.pattern).toMatchObject({
      pattern: "http-advisory",
      canonical: true,
      buyerSigns: false,
      onChain: false,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
      publicProof: false,
    });
    expect(exactAptos.pattern.proves.startsWith("Before this payment, the buyer signed and paid an agreement transaction")).toBe(
      true,
    );
    expect(exactAptos.claims).toBe(false);
    expect("recover" in exactAptos).toBe(false);
  });
});
