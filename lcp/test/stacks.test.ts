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
import { rowsOf } from "./rows.js";

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

  // SIP-005 writes a contract call's function name as a length byte and its bytes. @stacks/transactions 7.6.0 decodes
  // it with TextDecoder's default, which removes a leading U+FEFF, so EF BB BF then "transfer" reads as "transfer";
  // written back, the name is three bytes shorter, so the transaction does not re-serialise to its own bytes.
  it("bound and reference refuse a call of transfer led by a byte-order mark, another function", async () => {
    const whole = Buffer.from(await withMemo()).toString("hex");
    const name = `08${Buffer.from("transfer").toString("hex")}`;
    expect(whole.split(name).length).toBe(2);
    expect(whole.indexOf(name) % 2).toBe(0);
    const led = Uint8Array.from(Buffer.from(whole.replace(name, `0befbbbf${name.slice(2)}`), "hex"));
    expect(S.deserializeTransaction(led).payload).toMatchObject({ functionName: { content: "transfer" } });
    expect(await chargeUsdcStacks.bound(credential(led))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });
    expect(await chargeUsdcStacks.reference(credential(led))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });
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

  // stacks-core reads a transaction's Clarity values (each function argument, and each non-fungible post-condition's
  // asset value) with `UNSANITIZED_DEPTH_CHECK` = 16 and refuses a value nested deeper, the outermost value counting 1
  // (stacks-network/stacks-core 4.0.5, clarity-types/src/types/serialization.rs:71 and :629-640, and
  // stacks-codec/src/transaction.rs:2118 and :2487).
  // The deep values are written by hand as Clarity's serialization writes them (`some` is the byte 0x0a before its
  // value; a `uint` is 0x01 and 16 bytes), so that building them reads no stack; the transactions are left unsigned,
  // which bound does not read.
  it("bound and reference refuse a Clarity value nested deeper than a Stacks node reads", async () => {
    const [address, name] = F.contract.split(".");
    const memo = S.someCV(S.bufferCV(Buffer.from(F.H.slice(2), "hex")));
    const A = 0xa1a2a3a4a5a6a7a8n;
    const B = 0xb1b2b3b4b5b6b7b8n;
    const leaf = (v: bigint) => `01${v.toString(16).padStart(32, "0")}`;
    const nested = (levels: number, v: bigint) => `${"0a".repeat(levels - 1)}${leaf(v)}`;
    const some = (levels: number, v: bigint): S.ClarityValue => {
      let cv: S.ClarityValue = S.uintCV(v);
      for (let i = 1; i < levels; i++) cv = S.someCV(cv);
      return cv;
    };
    const call = async (first: S.ClarityValue, nftValue: S.ClarityValue) => {
      const tx = await S.makeUnsignedContractCall({
        contractAddress: address,
        contractName: name,
        functionName: "transfer",
        functionArgs: [first, S.principalCV(F.sender), S.principalCV(F.recipient), memo],
        network: "testnet",
        fee: BigInt(F.fee),
        nonce: BigInt(F.nonce),
        publicKey: S.privateKeyToPublic(KEY) as string,
        postConditionMode: S.PostConditionMode.Deny,
        postConditions: [S.Pc.principal(F.sender).willNotSendAsset().nft(`${address}.${name}::nft`, nftValue)],
      });
      tx.anchorMode = S.AnchorMode.OnChainOnly;
      return hex(S.serializeTransactionBytes(tx)).slice(2);
    };
    const wire = (text: string) => Buffer.from(text, "hex");
    const malformed = { refused: true, code: "mpp/stacks-tx-malformed" };

    for (const [first, nft] of [
      [16, 1],
      [1, 16],
    ] as const) {
      expect(await chargeUsdcStacks.bound(credential(wire(await call(some(first, A), some(nft, B)))))).toBe(V.M4.expectBound);
    }
    const plain = await call(S.uintCV(A), S.uintCV(B));
    const [a, b] = [plain.indexOf(leaf(A)), plain.indexOf(leaf(B))];
    expect([a % 2, b % 2, plain.lastIndexOf(leaf(A)) === a, plain.lastIndexOf(leaf(B)) === b]).toEqual([0, 0, true, true]);
    const deepArgument = (levels: number) => plain.slice(0, a) + nested(levels, A) + plain.slice(a + leaf(A).length);
    const deepAsset = (levels: number) => plain.slice(0, b) + nested(levels, B) + plain.slice(b + leaf(B).length);
    expect(deepArgument(17)).toBe(await call(some(17, A), S.uintCV(B)));
    expect(deepAsset(17)).toBe(await call(S.uintCV(A), some(17, B)));
    for (const levels of [17, 1000, 20_000]) {
      for (const text of [deepArgument(levels), deepAsset(levels)]) {
        expect(await chargeUsdcStacks.bound(credential(wire(text)))).toEqual(malformed);
        expect(await chargeUsdcStacks.reference(credential(wire(text)))).toEqual(malformed);
      }
    }
  });

  // stacks-core 4.0.5 (stacks-network/stacks-core d736ba0) reads a token transfer's recipient as a principal, the byte
  // 0x05 or 0x06 and its fields (stacks-codec/src/transaction.rs:2923-2924, clarity-types/src/types/serialization.rs
  // :289-311); a pay-to-alt coinbase's as a Clarity value that must be a principal (transaction.rs:2967-2978); and a
  // Nakamoto coinbase's as a Clarity value that must be an optional (transaction.rs:2980-2998), reading `(some …)` of
  // anything but a principal as no recipient, which it writes back as `none` (transaction.rs:2886-2892). Each Clarity
  // value is read with `UNSANITIZED_DEPTH_CHECK` = 16, the outermost value counting 1 (serialization.rs:629-640), so a
  // Nakamoto recipient's `(some …)` is its level 1. Each transaction is M4's with its payload replaced. The coinbase
  // bytes and the VRF proof are those of stacks-core's own Nakamoto coinbase test (transaction.rs:3767-3778), a proof
  // stacks-core parses (stacks-common/src/types/chainstate.rs:470-478). The containers are written as Clarity's
  // serialization writes them: `some` 0x0a, `ok` 0x07, `err` 0x08, a list of one 0x0b and its length, a tuple of one
  // 0x0c, its length and the member name `a`.
  describe("recipients and Clarity depth as stacks-core 4.0.5 reads them", () => {
    const m4 = V.M4.wireHex.slice(2);
    const m4Payload = S.serializePayloadBytes(S.deserializeTransaction(Buffer.from(m4, "hex")).payload);
    const payloadAt = m4.length - 2 * m4Payload.length;
    // The contract call's payload type (1 byte), contract address (21), name (1 + 5), function name (1 + 8) and
    // argument count (4) come before its first argument, M4's amount.
    const amountAt = payloadAt + 2 * 41;
    const amount = S.serializeCV(S.uintCV(BigInt(F.amount)));
    const standard = S.serializeCV(S.principalCV(F.sender));
    const contract = S.serializeCV(S.principalCV(F.contract));
    const uint = S.serializeCV(S.uintCV(1n));
    const coinbase = "12".repeat(32);
    const vrf =
      "9275df67a68c8745c0ff97b48201ee6db447f7c93b23ae24cdc2400f52fdb08a1a6ac7ec71bf9c9c76e96ee4675ebff60625af2871850104" +
      "7bfd87b810c2d2139b73c23bd69de66360953a642c2a330a";
    const wrap = { some: "0a", ok: "07", err: "08", list: "0b00000001", tuple: "0c000000010161" } as const;
    const kinds = Object.keys(wrap) as (keyof typeof wrap)[];
    /** A value `levels` deep on the wire: `levels - 1` containers of `kind`, the outermost counting 1, around `leaf`. */
    const nest = (kind: keyof typeof wrap, levels: number, leaf: string) => wrap[kind].repeat(levels - 1) + leaf;
    const prefix = m4.slice(0, payloadAt);
    const transfer = (r: string) => `${prefix}00${r}${(1_000_000).toString(16).padStart(16, "0")}${"00".repeat(34)}`;
    const payToAlt = (r: string) => `${prefix}05${coinbase}${r}`;
    const nakamoto = (r: string) => `${prefix}08${coinbase}${r}${vrf}`;
    const argument = (v: string) => m4.slice(0, amountAt) + v + m4.slice(amountAt + amount.length);
    const bound = (text: string) => chargeUsdcStacks.bound(credential(Buffer.from(text, "hex")));
    const malformed = { refused: true, code: "mpp/stacks-tx-malformed" };
    const notH = { refused: true, code: "mpp/stacks-memo-not-h" };

    it("the payloads are built as the peer writes them", () => {
      expect(m4.slice(amountAt, amountAt + amount.length)).toBe(amount);
      expect(vrf.length).toBe(160);
      for (const text of [transfer(standard), payToAlt(contract), nakamoto("09"), nakamoto(`0a${standard}`)]) {
        expect(hex(S.serializeTransactionBytes(S.deserializeTransaction(Buffer.from(text, "hex")))).slice(2)).toBe(text);
      }
    });

    it("a principal recipient is read, and the transaction calls no transfer", async () => {
      for (const text of [
        transfer(standard),
        transfer(contract),
        payToAlt(standard),
        payToAlt(contract),
        nakamoto("09"),
        nakamoto(`0a${standard}`),
        nakamoto(`0a${contract}`),
      ]) {
        expect(await bound(text)).toEqual(notH);
      }
    });

    for (const [site, text] of [
      ["a token transfer's recipient that is a uint", transfer(uint)],
      ["a token transfer's recipient that is none", transfer("09")],
      ["a token transfer's recipient that is (some <principal>)", transfer(`0a${standard}`)],
      ["a pay-to-alt coinbase's recipient that is a uint", payToAlt(uint)],
      ["a pay-to-alt coinbase's recipient that is (some <principal>)", payToAlt(`0a${standard}`)],
      ["a Nakamoto coinbase's recipient that is (some <uint>)", nakamoto(`0a${uint}`)],
      ["a Nakamoto coinbase's recipient that is (some (some <principal>))", nakamoto(`0a0a${standard}`)],
    ] as const) {
      it(`bound refuses ${site}`, async () => {
        expect(await bound(text)).toEqual(malformed);
      });
    }

    for (const kind of kinds) {
      for (const levels of [16, 17]) {
        it(`bound refuses a token transfer's recipient nesting a principal ${levels} levels deep in ${kind} containers`, async () => {
          expect(await bound(transfer(nest(kind, levels, standard)))).toEqual(malformed);
        });
        it(`bound refuses a pay-to-alt coinbase's recipient nesting a principal ${levels} levels deep in ${kind} containers`, async () => {
          expect(await bound(payToAlt(nest(kind, levels, standard)))).toEqual(malformed);
        });
        it(`bound refuses a Nakamoto coinbase's (some …) nesting a principal ${levels} levels deep in ${kind} containers`, async () => {
          expect(await bound(nakamoto(`0a${nest(kind, levels - 1, standard)}`))).toEqual(malformed);
        });
        it(`bound ${levels === 16 ? "reads" : "refuses"} a function argument ${levels} levels deep in ${kind} containers`, async () => {
          expect(await bound(argument(nest(kind, levels, amount)))).toEqual(levels === 16 ? V.M4.expectBound : malformed);
        });
      }
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
  tx?: "reader-error" | { mined: false; status: string; height?: string } | { notFound: true; height: string };
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
      // An unmined row names its API's height as a decimal string, or no height (null).
      if (row.tx !== undefined) return { ...row.tx, height: row.tx.height === undefined ? null : BigInt(row.tx.height) };
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
  it.each(rowsOf(V.M4b.rows as Row[], "mpp-charge-usdc-stacks.json M4b.rows"))("$case", async (row) => {
    const reader = readerFor(row);
    expect(withBigints(await stacksStatus(ref, reader))).toEqual(row.expect);
    expect(reader.calls).toBeLessThanOrEqual(4);
    if (reader.calls > 0) expect(reader.order[0]).toBe("confirmedNonce");
  });

  it.each(rowsOf(V.M4b.recover as Row[], "mpp-charge-usdc-stacks.json M4b.recover"))("recover: $case", async (row) => {
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

  // A transaction the API lists as dropped can still be mined (SIP-005: it stays valid until its origin's nonce is
  // used), and an API learns of that only once its index holds the block. Below, block 9021832 mines the transaction
  // and confirms the origin's nonce 0; the confirmed nonce comes from an API whose tip has it, and the lookup from one
  // whose tip is at `lookupAt` and lists the transaction as dropped until its index holds 9021832. Each answer names
  // its API's chain-tip height, so a dropped answer shows the transaction unmined only up to that height. The dropped
  // states are the Stacks Blockchain API's mempool transaction statuses other than `pending`.
  it("a dropped answer from an API behind the nonce read is pending dropped, and nonce-used waits for one that has caught up", async () => {
    const minedAt = BigInt(V.M4b.L.blockHeight);
    const nonceAt = minedAt + 8n;
    const dropped = (height: bigint | null): StacksMempool => ({ mined: false, status: "dropped_replace_by_fee", height });
    const readerAt = (lookupAt: bigint, ours: boolean): StacksReader => ({
      ...readerFor({ tip: "256358" }),
      confirmedNonce: async () => ({ nonce: 0n, height: nonceAt }),
      transaction: async () => (ours && lookupAt >= minedAt ? landed({}) : dropped(lookupAt)),
    });
    for (const lookupAt of [minedAt - 2n, minedAt - 1n, minedAt, nonceAt - 1n, nonceAt, nonceAt + 1n]) {
      const got = withBigints(await stacksStatus(ref, readerAt(lookupAt, true)));
      const want = lookupAt >= minedAt ? { state: "settled", finality: "bitcoin", blockHeight: minedAt.toString() } : { state: "pending", why: "dropped" };
      expect([lookupAt.toString(), got]).toEqual([lookupAt.toString(), want]);
      const other = await stacksStatus(ref, readerAt(lookupAt, false));
      const spent = lookupAt >= nonceAt ? { state: "failed", why: "nonce-used", finality: "block" } : { state: "pending", why: "dropped" };
      expect([lookupAt.toString(), other]).toEqual([lookupAt.toString(), spent]);
    }
    for (const status of ["dropped_replace_across_fork", "dropped_too_expensive", "dropped_stale_garbage_collect", "dropped_problematic"]) {
      const at = { ...readerAt(nonceAt, false), transaction: async () => ({ mined: false as const, status, height: nonceAt }) };
      expect([status, await stacksStatus(ref, at)]).toEqual([status, { state: "failed", why: "nonce-used", finality: "block" }]);
      const behind = { ...readerAt(nonceAt, false), transaction: async () => ({ mined: false as const, status, height: nonceAt - 1n }) };
      expect([status, await stacksStatus(ref, behind)]).toEqual([status, { state: "pending", why: "dropped" }]);
    }
    const unnamed = { ...readerAt(nonceAt, false), transaction: async () => ({ mined: false, status: "dropped_replace_by_fee" }) as never };
    expect(await stacksStatus(ref, unnamed)).toEqual({ state: "pending", why: "dropped" });
    const pending = { ...readerAt(nonceAt, false), transaction: async () => ({ mined: false as const, status: "pending", height: minedAt - 1n }) };
    expect(await stacksStatus(ref, pending)).toEqual({ state: "pending", why: "mempool" });
    const r = { network: ref.network, contract: ref.contract, transaction: ref.transaction };
    expect(await stacksRecover(r, readerAt(nonceAt, false))).toEqual({ refused: true, code: "stacks/not-found" });
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
  // cannot read the height from the node that answered names none: an unknown or dropped transaction then never reads
  // nonce-used.
  it("a lookup or nonce read naming a null height leaves an unknown or dropped transaction pending", async () => {
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
    const dropped = (height: bigint | null): StacksMempool => ({ mined: false, status: "dropped_stale_garbage_collect", height });
    expect(await stacksStatus(ref, readerWith(at, dropped(null)))).toEqual({ state: "pending", why: "dropped" });
    expect(await stacksStatus(ref, readerWith(null, dropped(at)))).toEqual({ state: "pending", why: "dropped" });
    expect(await stacksStatus(ref, readerWith(at, dropped(at)))).toEqual(spent);
    const r = { network: ref.network, contract: ref.contract, transaction: ref.transaction };
    expect(await stacksRecover(r, readerWith(at, { notFound: true, height: null }))).toEqual({ refused: true, code: "stacks/not-found" });
  });

  // An origin or contract not in the form reference writes cannot name the landed call, so the read is pending, never
  // failed (docs/guides/rails.md, "Reading settlement"). c32check writes an address in upper case (c32check 2.0.0's
  // c32address); a contract principal is that address, "." and the contract's name.
  it("a ref whose origin or contract is malformed is pending unreadable, with nothing read", async () => {
    const settled = (V.M4b.rows as Row[]).find((r) => (r.expect as { state: string }).state === "settled")!;
    const [address, name] = ref.contract.split(".") as [string, string];
    const malformed = [
      { origin: ref.origin.toLowerCase() }, { origin: undefined }, { origin: `${ref.origin}.${name}` },
      { contract: `${address.toLowerCase()}.${name}` }, { contract: undefined }, { contract: address }, { contract: `${address}.` },
    ];
    for (const change of malformed) {
      const reader = readerFor(settled);
      expect(await stacksStatus({ ...ref, ...change } as typeof ref, reader)).toEqual({ state: "pending", why: "unreadable" });
      expect(reader.calls).toBe(0);
    }
    expect(withBigints(await stacksStatus(ref, readerFor(settled)))).toEqual(settled.expect);
  });

  // Principals at the edges of the forms reference writes settle when the landed call is theirs: an origin of 28
  // characters, version 20 and the zero hash160; the boot contract SP000000000000000000002Q6VF78.pox-4 (version 22, the
  // zero hash160; the Stacks mainnet PoX-4 contract); and a contract name of 40 characters in mixed case (SIP-005: a
  // contract name is a letter, then letters, digits, "-" or "_"). The addresses are as @stacks/transactions 7.6.0's
  // c32check encoding writes them.
  it("a ref whose origin or contract is at the edge of the written forms settles", async () => {
    const settled = (V.M4b.rows as Row[]).find((r) => (r.expect as { state: string }).state === "settled")!;
    const multisig = "SM0000000000000000000062QV6X";
    const boot = "SP000000000000000000002Q6VF78";
    expect(S.addressToString(S.addressFromVersionHash(20, "00".repeat(20)))).toBe(multisig);
    expect(S.addressToString(S.addressFromVersionHash(22, "00".repeat(20)))).toBe(boot);
    const [address] = ref.contract.split(".") as [string, string];
    const edges = [
      [multisig, ref.contract],
      [ref.origin, `${boot}.pox-4`],
      [ref.origin, `${address}.Token_A-${"x".repeat(32)}`],
    ] as const;
    for (const [origin, contract] of edges) {
      const tx = landed(settled);
      const txAnswer = { ...tx, sender: { ...tx.sender, address: origin }, call: { ...tx.call, contractId: contract } };
      const got = withBigints(await stacksStatus({ ...ref, origin, contract }, readerFor({ ...settled, txAnswer })));
      expect([origin, contract, got]).toEqual([origin, contract, settled.expect]);
    }
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

// The agreedRefusals rows: M4's signed transaction with its payload replaced. The decode and re-serialisation are
// @stacks/transactions 7.6.0's, the package's Stacks decoder: rows 0 and 1 give its outcome for payload types 7 and 8.
// Rows 2 to 13 give what stacks-core 4.0.5 reads in a token transfer's recipient (type 0), a pay-to-alt coinbase's (5),
// a Nakamoto coinbase's (8) and a contract call's argument (2), the sources the recipient tests above name.
describe("mpp-charge-usdc-stacks.json agreedRefusals", () => {
  const rows = rowsOf(V.agreedRefusals.rows as { case: string; wireHex: string; expect: string }[], "mpp-charge-usdc-stacks.json agreedRefusals.rows", { exact: 2 });
  it("each wire is M4's up to its payload", () => {
    const m4 = S.deserializeTransaction(Buffer.from(V.M4.wireHex.slice(2), "hex"));
    const prefix = V.M4.wireHex.slice(0, V.M4.wireHex.length - 2 * S.serializePayloadBytes(m4.payload).length);
    for (const r of rows) expect(r.wireHex.startsWith(prefix), r.case).toBe(true);
    expect(rows.map((r) => r.wireHex.slice(prefix.length, prefix.length + 2))).toEqual(
      ["07", "08", "00", "00", "00", "05", "05", "05", "08", "08", "08", "08", "08", "02"],
    );
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      expect(await chargeUsdcStacks.bound(credential(Buffer.from(r.wireHex.slice(2), "hex")))).toEqual({ refused: true, code: r.expect });
    });
  }
});
