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

  // SIP-005: a multisig spending condition's public-key field holds a secp256k1 point: compressed (0x02 or 0x03 and
  // its x) or, after 0x04, its x and y. Where x^3 + 7 has no square root modulo the field prime (SEC 2, 2.4.1), no
  // point has that x, whatever the y, and the transaction does not decode and re-serialise to the same bytes.
  it("bound and reference refuse a multisig transaction whose key field is not a point on the curve", async () => {
    const [address, name] = F.contract.split(".");
    const publicKey = S.privateKeyToPublic(KEY) as string;
    const tx = await S.makeUnsignedContractCall({
      contractAddress: address,
      contractName: name,
      functionName: "transfer",
      functionArgs: [
        S.uintCV(BigInt(F.amount)),
        S.principalCV(F.sender),
        S.principalCV(F.recipient),
        S.someCV(S.bufferCV(Buffer.from(F.H.slice(2), "hex"))),
      ],
      network: "testnet",
      fee: BigInt(F.fee),
      nonce: BigInt(F.nonce),
      numSignatures: 1,
      publicKeys: [publicKey],
      postConditionMode: S.PostConditionMode.Deny,
      postConditions: [S.Pc.principal(F.sender).willSendEq(BigInt(F.amount)).ft(F.contract, F.asset)],
    });
    tx.anchorMode = S.AnchorMode.OnChainOnly;
    const condition = tx.auth.spendingCondition as { fields: unknown[] };
    condition.fields = [S.createTransactionAuthField(S.PubKeyEncoding.Compressed, S.createStacksPublicKey(publicKey))];
    const multisig = S.serializeTransactionBytes(tx);
    expect(await chargeUsdcStacks.bound(credential(multisig))).toBe(V.M4.expectBound);

    const p = 2n ** 256n - 2n ** 32n - 977n;
    const pow = (b: bigint, e: bigint): bigint => {
      let r = 1n;
      for (let x = b % p, k = e; k > 0n; k >>= 1n, x = (x * x) % p) if (k & 1n) r = (r * x) % p;
      return r;
    };
    const x = 5n;
    expect(pow(x ** 3n + 7n, (p - 1n) / 2n)).toBe(p - 1n);
    const field = `00${publicKey}`;
    const at = hex(multisig).indexOf(field, 2);
    expect(at % 2).toBe(0);
    const offCurve = Uint8Array.from(multisig);
    offCurve.set(Buffer.from(`02${x.toString(16).padStart(64, "0")}`, "hex"), (at - 2) / 2 + 1);
    expect(await chargeUsdcStacks.bound(credential(offCurve))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });
    expect(await chargeUsdcStacks.reference(credential(offCurve))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });

    const start = (at - 2) / 2;
    const word = (v: bigint) => v.toString(16).padStart(64, "0");
    const uncompressed = Buffer.from(`0004${word(x)}${word(7n)}`, "hex");
    expect(uncompressed.length).toBe(66);
    const offCurve65 = Uint8Array.from([
      ...multisig.subarray(0, start),
      ...uncompressed,
      ...multisig.subarray(start + 34),
    ]);
    const malformed = { refused: true, code: "mpp/stacks-tx-malformed" };
    expect(await chargeUsdcStacks.bound(credential(offCurve65))).toEqual(malformed);
    expect(await chargeUsdcStacks.reference(credential(offCurve65))).toEqual(malformed);
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
  tx?: "reader-error" | { mined: false; status: string } | { notFound: true; height: string };
  txAnswer?: unknown;
  confirmedNonce?: { nonce: string | null; height: string } | "reader-error" | "number";
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

type NotFound = { notFound: true; height: bigint };

/** A `txAnswer` as the reader returns it: a mined answer's decimal-string integers read as bigints. */
function answer(v: unknown): StacksLanded | StacksMempool | NotFound {
  if (typeof v !== "object" || v === null || (v as { mined?: unknown }).mined !== true) return v as StacksMempool;
  const o = { ...(v as Record<string, unknown>) };
  if (typeof o["blockHeight"] === "string") o["blockHeight"] = BigInt(o["blockHeight"]);
  const sender = o["sender"] as { address: string; nonce: string } | undefined;
  if (sender !== undefined) o["sender"] = { address: sender.address, nonce: BigInt(sender.nonce) };
  return o as unknown as StacksLanded;
}

function readerFor(row: Partial<Row>): StacksReader & { calls: number; order: string[] } {
  const r = {
    calls: 0,
    order: [] as string[],
    network: (row.readerNetwork ?? F.network) as StacksReader["network"],
    async transaction(): Promise<StacksLanded | StacksMempool | NotFound> {
      r.calls++;
      r.order.push("transaction");
      if (row.txAnswer !== undefined) return answer(row.txAnswer);
      if (row.tx === "reader-error") throw new ReaderError("transport");
      if (row.tx !== undefined && "notFound" in row.tx) return { notFound: true, height: BigInt(row.tx.height) };
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
      r.order.push("confirmedNonce");
      const n = row.confirmedNonce;
      if (n === "reader-error") throw new ReaderError("transport");
      if (n === "number") return { nonce: 0 as unknown as bigint, height: 9021840n };
      if (n === undefined) return { nonce: null, height: 9021840n };
      return { nonce: n.nonce === null ? null : BigInt(n.nonce), height: BigInt(n.height) };
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
    expect(reader.calls).toBeLessThanOrEqual(4);
    if (reader.calls > 0) expect(reader.order[0]).toBe("confirmedNonce");
  });

  it.each(V.M4b.recover as Row[])("recover: $case", async (row) => {
    const reader = readerFor(row);
    expect(await stacksRecover({ network: ref.network, contract: ref.contract, transaction: ref.transaction }, reader)).toEqual(
      row.expect,
    );
    expect(reader.calls).toBe(1);
  });

  // A nonce the origin's account has confirmed at or above the transaction's means the transaction can never be
  // mined (SIP-005: a transaction's nonce must equal its origin's next nonce). The reader below answers from an API
  // at which the transaction is mined, and the origin's nonce confirmed, between the two reads; each answer names the
  // API's chain-tip height, one block higher with every read.
  it("the confirmed nonce is read before the transaction, so a transaction mined between reads is never nonce-used", async () => {
    for (const minedAt of [0, 1, 2]) {
      let reads = 0;
      const mined = () => reads > minedAt;
      const height = () => 9021831n + BigInt(reads);
      const reader: StacksReader = {
        network: F.network as StacksReader["network"],
        async confirmedNonce() {
          const n = { nonce: mined() ? 0n : null, height: height() };
          reads++;
          return n;
        },
        async transaction() {
          const t = mined() ? landed({}) : { notFound: true as const, height: height() };
          reads++;
          return t;
        },
        async blockTenure() {
          return BigInt(V.M4b.blockTenure);
        },
        async tipTenure() {
          return 0n;
        },
      };
      const got = await stacksStatus(ref, reader);
      expect([minedAt, got.state]).not.toEqual([minedAt, "failed"]);
    }
  });

  // The same rule read across two APIs: the confirmed nonce from one whose tip has the block that mined the
  // transaction (9021832), the lookup from one whose tip does not yet. Each answer names its API's chain-tip height,
  // so an empty lookup shows the transaction unmined only up to that height.
  it("a lookup from an API behind the nonce read is pending, and nonce-used waits for one that has caught up", async () => {
    const minedAt = BigInt(V.M4b.L.blockHeight);
    const nonceAt = minedAt + 8n;
    const readerAt = (lookupAt: bigint, ours: boolean): StacksReader => ({
      ...readerFor({ tip: "256358" }),
      confirmedNonce: async () => ({ nonce: 0n, height: nonceAt }),
      transaction: async () => (ours && lookupAt >= minedAt ? landed({}) : { notFound: true, height: lookupAt }),
    });
    for (const lookupAt of [minedAt - 2n, minedAt - 1n, minedAt, nonceAt - 1n, nonceAt, nonceAt + 1n]) {
      const got = withBigints(await stacksStatus(ref, readerAt(lookupAt, true)));
      const want = lookupAt >= minedAt ? { state: "settled", finality: "bitcoin", blockHeight: minedAt.toString() } : { state: "pending", why: "not-found" };
      expect([lookupAt.toString(), got]).toEqual([lookupAt.toString(), want]);
      const other = await stacksStatus(ref, readerAt(lookupAt, false));
      const spent = lookupAt >= nonceAt ? { state: "failed", why: "nonce-used", finality: "block" } : { state: "pending", why: "not-found" };
      expect([lookupAt.toString(), other]).toEqual([lookupAt.toString(), spent]);
    }
    const unnamed = { ...readerAt(nonceAt, false), transaction: async () => ({ notFound: true }) as never };
    expect(await stacksStatus(ref, unnamed)).toEqual({ state: "pending", why: "not-found" });
    const bare = { ...readerAt(nonceAt, false), transaction: async () => null as never };
    expect(await stacksStatus(ref, bare)).toEqual({ state: "pending", why: "unreadable" });
    const oldNonce = { ...readerAt(nonceAt, false), confirmedNonce: async () => 0n as never };
    expect(await stacksStatus(ref, oldNonce)).toEqual({ state: "pending", why: "unreadable" });
    const r = { network: ref.network, contract: ref.contract, transaction: ref.transaction };
    expect(await stacksRecover(r, readerAt(nonceAt, false))).toEqual({ refused: true, code: "stacks/not-found" });
    expect(await stacksRecover(r, bare)).toEqual({ refused: true, code: "stacks/unreadable" });
  });

  // A block can land between a reader's two calls to one node. The nonce read's height is read after the nonce
  // (GET /extended's chain_tip.block_height), so the nonce read is at or below it, and a lookup's height before the
  // lookup, so the lookup is at or above it. Below, block 9021832 mines the transaction, confirming the origin's nonce
  // 0, just before the nonce call or between that call and its height read; the lookup comes from a node one block
  // behind.
  it("a nonce read's height read after the nonce keeps a lookup one block behind pending", async () => {
    const minedAt = BigInt(V.M4b.L.blockHeight);
    for (const landsAt of [0, 1]) {
      let tip = minedAt - 1n;
      let step = 0;
      const advance = () => {
        if (step++ === landsAt) tip = minedAt;
      };
      const reader: StacksReader = {
        ...readerFor({ tip: "256358" }),
        async confirmedNonce() {
          advance();
          const nonce = tip >= minedAt ? 0n : null;
          advance();
          return { nonce, height: tip };
        },
        transaction: async () => ({ notFound: true, height: minedAt - 1n }),
      };
      expect([landsAt, await stacksStatus(ref, reader)]).toEqual([landsAt, { state: "pending", why: "not-found" }]);
    }
  });

  // The Stacks Blockchain API's 404 for an unknown transaction and its nonces answer name no height, so a reader takes
  // the height from a second call (/extended), which a load-balanced endpoint can send to another node. A reader that
  // cannot read the height from the node that answered names none: an unknown transaction then never reads nonce-used,
  // and a dropped one reads it from the confirmed nonce alone.
  it("a lookup or nonce read naming a null height leaves an unknown transaction pending not-found", async () => {
    const at = 9021840n;
    const readerWith = (nonceAt: bigint | null, lookup: { notFound: true; height: bigint | null } | StacksMempool): StacksReader => ({
      ...readerFor({ tip: "256358" }),
      confirmedNonce: async () => ({ nonce: 0n, height: nonceAt }),
      transaction: async () => lookup,
    });
    const spent = { state: "failed", why: "nonce-used", finality: "block" };
    expect(await stacksStatus(ref, readerWith(at, { notFound: true, height: null }))).toEqual({ state: "pending", why: "not-found" });
    expect(await stacksStatus(ref, readerWith(null, { notFound: true, height: at }))).toEqual({ state: "pending", why: "not-found" });
    expect(await stacksStatus(ref, readerWith(at, { notFound: true, height: at }))).toEqual(spent);
    expect(await stacksStatus(ref, readerWith(null, { mined: false, status: "dropped_stale_garbage_collect" }))).toEqual(spent);
    const r = { network: ref.network, contract: ref.contract, transaction: ref.transaction };
    expect(await stacksRecover(r, readerWith(at, { notFound: true, height: null }))).toEqual({ refused: true, code: "stacks/not-found" });
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
