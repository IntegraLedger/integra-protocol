// The Stacks charge: M4 (usdc/stacks bound and reference), M4b (status and recover on fixture reader answers) and
// the Stacks plant. Expected values are the vector file's. The transaction is built at test time with
// @stacks/transactions from the vector file's inputs; the signing key is the scalar 1.
import * as S from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { chargeUsdcStacks, network, pairingsOf, type MppChallenge, type MppCredential } from "../src/mpp.js";
import {
  stacksRecover,
  stacksStatus,
  stacksTxid,
  type StacksLanded,
  type StacksMempool,
  type StacksReader,
  type StacksRef,
} from "../src/stacks.js";
import { b64u, load } from "./mpp-fixtures.js";

const V = load("mpp-charge-usdc-stacks.json");
const F = V.fixed;
const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;
/** The private key whose scalar is 1, compressed. */
const KEY = `${"00".repeat(31)}0101`;

async function transfer(memo: S.ClarityValue): Promise<Uint8Array> {
  const [address, name] = F.contract.split(".");
  const tx = await S.makeUnsignedContractCall({
    contractAddress: address,
    contractName: name,
    functionName: "transfer",
    functionArgs: [S.uintCV(BigInt(F.amount)), S.principalCV(F.sender), S.principalCV(F.recipient), memo],
    network: "testnet",
    fee: BigInt(F.fee),
    nonce: BigInt(F.nonce),
    publicKey: S.privateKeyToPublic(KEY) as string,
    postConditionMode: S.PostConditionMode.Deny,
    postConditions: [S.Pc.principal(F.sender).willSendEq(BigInt(F.amount)).ft(F.contract, F.asset)],
  });
  tx.anchorMode = S.AnchorMode.OnChainOnly;
  new S.TransactionSigner(tx).signOrigin(KEY);
  return S.serializeTransactionBytes(tx);
}

const withMemo = () => transfer(S.someCV(S.bufferCV(Buffer.from(F.H.slice(2), "hex"))));

function challenge(): MppChallenge & { id: string } {
  const c: MppChallenge = { realm: F.realm, method: "usdc", intent: "charge", request: b64u(JSON.stringify(F.request)), expires: F.expires };
  const doc = chargeUsdcStacks.advertise([c], F.H, F.link, c);
  if (!Array.isArray(doc)) throw new Error(JSON.stringify(doc));
  return doc[0] as MppChallenge & { id: string };
}

function credential(wire: Uint8Array, format = "stacks_transaction_v1"): MppCredential {
  return {
    challenge: challenge(),
    source: `${F.network}:${F.sender}`,
    payload: { type: "transaction", transaction: Buffer.from(wire).toString("base64"), transactionFormat: format },
  };
}

describe("mpp/charge/usdc/stacks (M4)", () => {
  it("offers the pairing on stacks:2147483648", () => {
    const c = challenge();
    expect(pairingsOf({ ...c, id: undefined, opaque: undefined } as unknown as MppChallenge)).toEqual(["mpp/charge/usdc/stacks"]);
    expect(network(c)).toBe(F.network);
  });

  it("the signed transfer's bytes and txid are the vector's", async () => {
    const wire = await withMemo();
    expect(wire.length).toBe(V.M4.expectLength);
    expect(hex(wire.subarray(0, 6))).toBe(V.M4.expectPrefix);
    expect(hex(wire.subarray(7, 27))).toBe(V.M4.expectSigner);
    expect(hex(wire.subarray(wire.length - 38))).toBe(V.M4.expectSuffix);
    const sig = hex(wire.subarray(V.M4.expectSignature.offset, V.M4.expectSignature.offset + V.M4.expectSignature.length));
    expect(sig.startsWith(V.M4.expectSignature.prefix)).toBe(true);
    expect(sig.endsWith(V.M4.expectSignature.suffix)).toBe(true);
    expect(stacksTxid(wire)).toBe(V.M4.expectTxid);
    expect(hex(wire)).toBe(V.M4.wireHex);
  });

  it("build names the transfer the vector names", async () => {
    const u = await chargeUsdcStacks.build({ challenge: challenge(), from: F.sender }, F.H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request).toEqual({
      kind: "stacks-contract-call",
      contract: F.contract,
      functionName: "transfer",
      args: { amount: F.amount, sender: F.sender, recipient: F.recipient, memo: F.H },
      postCondition: "SentEq",
      postConditionMode: "deny",
      anchorMode: "onChainOnly",
    });
    const cred = u.complete(await withMemo());
    if ("refused" in cred) throw new Error(cred.code);
    expect(cred.source).toBe(`${F.network}:${F.sender}`);
    expect(await chargeUsdcStacks.bound(cred)).toBe(V.M4.expectBound);
  });

  it("bound gives H; the memo none and another format are refused", async () => {
    expect(await chargeUsdcStacks.bound(credential(await withMemo()))).toBe(V.M4.expectBound);
    const none = await transfer(S.noneCV());
    expect(none.length).toBe(V.M4.memoNoneLength);
    expect(await chargeUsdcStacks.bound(credential(none))).toEqual(V.M4.expectMemoNone);
    expect(await chargeUsdcStacks.bound(credential(await withMemo(), V.M4.otherFormat))).toEqual(V.M4.expectOtherFormat);
  });

  // SIP-005: a transaction is exactly its encoding, so bytes that the decoder reads short, or bytes after the encoding,
  // are not a transaction.
  it("bound refuses a truncated transaction and one with bytes after it", async () => {
    const whole = await withMemo();
    for (const wire of [whole.subarray(0, whole.length - 1), Uint8Array.from([...whole, 0])]) {
      expect(await chargeUsdcStacks.bound(credential(wire))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });
    }
  });

  it("reference gives the read keys, and survives JSON", async () => {
    const ref = await chargeUsdcStacks.reference(credential(await withMemo()));
    expect(ref).toEqual(V.M4.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
  });

  it("states what it proves", () => {
    expect({ ...chargeUsdcStacks.pattern, claims: chargeUsdcStacks.claims }).toEqual(V.pattern);
  });
});

type Row = {
  case: string;
  tip?: string;
  status?: string;
  senderNonce?: string;
  memo?: string;
  tx?: null | "reader-error" | { mined: false; status: string };
  confirmedNonce?: string | null;
  readerNetwork?: string;
  expect: unknown;
};

function landed(row: Partial<Row>): StacksLanded {
  const L = V.M4b.L;
  const args = [...L.call.args];
  if (row.memo !== undefined) args[3] = row.memo;
  return {
    mined: true,
    status: (row.status ?? L.status) as StacksLanded["status"],
    sender: { address: L.sender.address, nonce: BigInt(row.senderNonce ?? L.sender.nonce) },
    blockHeight: BigInt(L.blockHeight),
    call: { contractId: L.call.contractId, functionName: L.call.functionName, args },
  };
}

function readerFor(row: Partial<Row>): StacksReader & { calls: number } {
  const r = {
    calls: 0,
    network: (row.readerNetwork ?? F.network) as StacksReader["network"],
    async transaction(): Promise<StacksLanded | StacksMempool | null> {
      r.calls++;
      if (row.tx === "reader-error") throw new ReaderError("transport");
      if (row.tx !== undefined) return row.tx;
      return landed(row);
    },
    async blockTenure(height: bigint) {
      r.calls++;
      if (height !== BigInt(V.M4b.L.blockHeight)) throw new ReaderError("malformed");
      return BigInt(V.M4b.blockTenure);
    },
    async tipTenure() {
      r.calls++;
      if (row.tip === "reader-error") throw new ReaderError("timeout");
      return BigInt(row.tip ?? "0");
    },
    async confirmedNonce() {
      r.calls++;
      const n = row.confirmedNonce;
      return n === null || n === undefined ? null : BigInt(n);
    },
  };
  return r;
}

const ref: StacksRef & { transaction: `0x${string}`; h: `0x${string}` } = {
  ...V.M4.expectReference,
  h: F.H,
};

describe("usdc/stacks status and recover (M4b)", () => {
  it.each(V.M4b.rows as Row[])("$case", async (row) => {
    const reader = readerFor(row);
    expect(withBigints(await stacksStatus(ref, reader))).toEqual(row.expect);
    expect(reader.calls).toBeLessThanOrEqual(3);
  });

  it.each(V.M4b.recover as Row[])("recover: $case", async (row) => {
    const reader = readerFor(row);
    expect(await stacksRecover({ network: ref.network, contract: ref.contract, transaction: ref.transaction }, reader)).toEqual(
      row.expect,
    );
    expect(reader.calls).toBe(1);
  });

  it("plant: a post-condition abort is failed, never settled, and recover refuses it", async () => {
    const row = { status: V.plant.status, tip: V.plant.tip };
    expect(withBigints(await stacksStatus(ref, readerFor(row)))).toEqual(V.plant.expectStatus);
    const r = { network: ref.network, contract: ref.contract, transaction: ref.transaction };
    expect(await stacksRecover(r, readerFor(row))).toEqual(V.plant.expectRecover);
  });
});

function withBigints(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}
