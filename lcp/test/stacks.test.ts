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

  // SIP-005 writes a contract call's function name as a length byte and its bytes, which stacks-core 4.0.5 reads as a
  // Clarity name (clarity-types/src/representations.rs:96-116): EF BB BF then "transfer" is not one, so no Stacks node
  // decodes the transaction. @stacks/transactions 7.6.0 reads the same bytes as "transfer", its TextDecoder's default
  // removing a leading U+FEFF.
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

  // A multisig spending condition's public-key field holds 33 bytes, a compressed secp256k1 point (0x02 or 0x03 and
  // its x), which stacks-core 4.0.5 parses (stacks-common/src/types/mod.rs:54-73); the condition holds exactly the
  // signatures it requires (stacks-codec/src/transaction.rs:852). Where x^3 + 7 has no square root modulo the field
  // prime (SEC 2, 2.4.1), no point has that x, and an uncompressed spelling (0x04, x and y) is not 33 bytes of a
  // compressed point: neither is a transaction a Stacks node decodes.
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
    condition.fields = [
      S.createTransactionAuthField(S.PubKeyEncoding.Compressed, S.createStacksPublicKey(publicKey)),
      S.createTransactionAuthField(S.PubKeyEncoding.Compressed, S.createMessageSignature("00".repeat(65))),
    ];
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

  // stacks-core 4.0.5 (stacks-network/stacks-core d736ba0) reads a transaction with
  // `StacksTransaction::consensus_deserialize` (stacks-codec/src/transaction.rs:3065-3067, :3078-3165) and names it by
  // the hash of its serialization; each test cites the rule it reads, and each answer here is that deserializer's, run
  // on these bytes.
  // A transaction it decodes and serializes back to the same bytes binds H when it calls `transfer` with (some H) as
  // its fourth argument, else is `mpp/stacks-memo-not-h`; any other bytes are `mpp/stacks-tx-malformed`. Each
  // transaction is M4's with one part replaced, written as the serialization writes it; none is signed again.
  describe("transactions as stacks-core 4.0.5 decodes them", () => {
    const m4 = V.M4.wireHex.slice(2);
    /** M4's bytes from offset `a` to `b`, as hex. */
    const at = (a: number, b?: number) => m4.slice(2 * a, b === undefined ? undefined : 2 * b);
    const word = (n: bigint | number, bytes: number) => BigInt(n).toString(16).padStart(2 * bytes, "0");
    const ascii = (s: string) => Buffer.from(s, "latin1").toString("hex");
    /** A length byte and the name's bytes. */
    const name = (s: string) => word(s.length, 1) + ascii(s);
    const int = (n: number) => `00${word(n, 16)}`;
    const uint = (n: number) => `01${word(n, 16)}`;
    const buff = (len: number) => `02${word(len, 4)}${"41".repeat(len)}`;
    const some = (v: string) => `0a${v}`;
    const list = (items: string[]) => `0b${word(items.length, 4)}${items.join("")}`;
    const tuple = (entries: [string, string][]) => `0c${word(entries.length, 4)}${entries.map(([k, v]) => name(k) + v).join("")}`;
    const repeat = (n: number, v: string) => Array.from({ length: n }, () => v);
    // M4: its header up to the anchor mode (109 bytes), the anchor and post-condition modes, the post-condition count
    // and its one post-condition (to byte 186); then the contract call: type, address (21), contract name (1 + 5),
    // function name (1 + 8), argument count (4), and the four arguments, the amount at 227 and (some H) at 288.
    const sender = at(117, 138); // the post-condition's principal: version and hash160
    const contract = at(138, 159); // the asset's contract address
    const signer = at(7, 27);
    const first = (v: string) => at(0, 227) + v + at(244);
    const fourth = (v: string) => at(0, 288) + v;
    const payload = (p: string) => at(0, 186) + p;
    const anchored = (mode: string, p: string) => at(0, 109) + mode + at(110, 186) + p;
    const postCondition = (pc: string, mode = "02") => at(0, 110) + mode + "00000001" + pc + at(186);
    const authorization = (a: string) => at(0, 5) + a + at(109);
    const amount = word(1_000_000, 8);
    const H = V.M4.expectBound;
    const malformed = { refused: true, code: "mpp/stacks-tx-malformed" };
    const notH = { refused: true, code: "mpp/stacks-memo-not-h" };
    /** Each case's bound beside its label, and the expected answers beside theirs. */
    const check = async (cases: [string, string, unknown][]) => {
      const got: [string, unknown][] = [];
      for (const [label, text] of cases) got.push([label, await chargeUsdcStacks.bound(credential(Buffer.from(text, "hex")))]);
      expect(got).toEqual(cases.map(([label, , want]) => [label, want]));
    };

    // A tuple has members (clarity-types/src/types/mod.rs:1855-1870), named by Clarity names of at most 128 characters
    // (clarity-types/src/representations.rs:51-56, serialization.rs:233-252), which the serialization writes in name
    // order as bytes (serialization.rs:1185-1193), so a node writes {a, B} back as {B, a}.
    it("a tuple has members, each named once by a Clarity name, in name order as bytes", async () => {
      expect([at(186, 187), at(227, 244), at(288)]).toEqual(["02", uint(1_000_000), `0a0200000020${F.H.slice(2)}`]);
      await check([
        ["{B, a}", first(tuple([["B", int(1)], ["a", int(2)]])), H],
        ["{a-b, a_b}", first(tuple([["a-b", int(1)], ["a_b", int(2)]])), H],
        ["{a, aa}", first(tuple([["a", int(1)], ["aa", int(2)]])), H],
        ["{<, <=, =, >, >=}", first(tuple([["<", int(1)], ["<=", int(2)], ["=", int(3)], [">", int(4)], [">=", int(5)]])), H],
        ["a name of 128 characters", first(tuple([["a".repeat(128), int(1)]])), H],
        ["the empty tuple", first(tuple([])), malformed],
        ["(some <the empty tuple>)", first(some(tuple([]))), malformed],
        ["{a, B}", first(tuple([["a", int(2)], ["B", int(1)]])), malformed],
        ["{a_b, a-b}", first(tuple([["a_b", int(2)], ["a-b", int(1)]])), malformed],
        ["{a, a}", first(tuple([["a", int(1)], ["a", int(2)]])), malformed],
        ["a name of 129 characters", first(tuple([["a".repeat(129), int(1)]])), malformed],
        ["the name 1a", first(tuple([["1a", int(1)]])), malformed],
      ]);
    });

    // A list's type is its items' least common type (mod.rs:1149-1155; signatures.rs:1130-1281, :1336-1401): `none`
    // takes the type of a (some …), an ok and an err response combine, a tuple keeps the first's members if each is in
    // the next, an empty list takes the other's items; other types only when equal.
    it("a list's items have a least common type", async () => {
      await check([
        ["(none (some 1))", first(list(["09", some(int(1))])), H],
        ["((ok 1) (err u1))", first(list([`07${int(1)}`, `08${uint(1)}`])), H],
        ["({a 1} {a 2, b 3})", first(list([tuple([["a", int(1)]]), tuple([["a", int(2)], ["b", int(3)]])])), H],
        ["((list) (list 1))", first(list([list([]), list([int(1)])])), H],
        ["(0x41 0x4141)", first(list([buff(1), buff(2)])), H],
        ["(1 u1)", first(list([int(1), uint(1)])), malformed],
        ["(1 none)", first(list([int(1), "09"])), malformed],
        ["((some 1) (some u1))", first(list([some(int(1)), some(uint(1))])), malformed],
        ["({a 1, b 3} {a 2})", first(list([tuple([["a", int(1)], ["b", int(3)]]), tuple([["a", int(2)]])])), malformed],
        ["((list 1) (list u1))", first(list([list([int(1)]), list([uint(1)])])), malformed],
        ["(0x41 \"A\")", first(list([buff(1), `0d${word(1, 4)}41`])), malformed],
      ]);
    });

    // A string-ascii holds alphanumeric, punctuation and whitespace bytes (Rust's ASCII classes: space, tab, newline,
    // form feed, carriage return) and no others (mod.rs:1202-1214).
    it("a string-ascii holds alphanumeric, punctuation and whitespace bytes only", async () => {
      const text = (byte: number) => first(`0d${word(3, 4)}61${word(byte, 1)}62`);
      await check([
        ...[0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x21, 0x7e].map((b): [string, string, unknown] => [`byte 0x${word(b, 1)}`, text(b), H]),
        ...[0x00, 0x0b, 0x1f, 0x7f, 0x80, 0xff].map((b): [string, string, unknown] => [`byte 0x${word(b, 1)}`, text(b), malformed]),
      ]);
    });

    // A string-utf8 is well-formed UTF-8 (mod.rs:1261-1279, Rust's str::from_utf8), its bytes kept as they are: a
    // byte-order mark is a character like any other.
    it("a string-utf8 is well-formed UTF-8, a byte-order mark included", async () => {
      const text = (bytes: string) => first(`0e${word(bytes.length / 2, 4)}${bytes}`);
      await check([
        ["a byte-order mark", text("efbbbf61"), H],
        ["é", text("c3a9"), H],
        ["U+10FFFF", text("f48fbfbf"), H],
        ["a lone continuation byte", text("80"), malformed],
        ["an overlong /", text("c0af"), malformed],
        ["the surrogate U+D800", text("eda080"), malformed],
        ["past U+10FFFF", text("f4908080"), malformed],
        ["a truncated character", text("e282"), malformed],
      ]);
    });

    // A value's type is at most MAX_VALUE_SIZE, 1,048,576 bytes (mod.rs:48): a list's type is its length times its
    // item type's size plus a few bytes (signatures.rs:1553-1600), a buffer's or string-ascii's its length plus 4, a
    // string-utf8's 4 a character plus 4, a tuple's its members' and their names' plus 2 a member and its type's own,
    // and (some …), (ok …) and (err …) add 1 to the value's (mod.rs:1002-1063).
    it("a value's type is at most 1,048,576 bytes", async () => {
      const buffers = (n: number, longest: number) => list([buff(longest), ...repeat(n - 1, buff(0))]);
      const utf8 = (n: number, characters: number) => list([`0e${word(2 * characters, 4)}${"c3a9".repeat(characters)}`, ...repeat(n - 1, `0e${word(0, 4)}`)]);
      // 269 one-member tuples {key <buffer>}, the longest `longest` bytes: 269 × (longest + 13 + 2k) + 12 + k bytes for
      // a key of k characters.
      const tuples = (longest: number, key = "kk") => list([tuple([[key, buff(longest)]]), ...repeat(268, tuple([[key, buff(0)]]))]);
      await check([
        ["200 buffers, the longest 5,238 bytes: 1,048,410", first(buffers(200, 5238)), H],
        ["200 buffers, the longest 5,239 bytes: 1,048,610", first(buffers(200, 5239)), malformed],
        ["200 string-utf8, the longest 1,309 characters: 1,048,010", first(utf8(200, 1309)), H],
        ["200 string-utf8, the longest 1,310 characters: 1,048,810", first(utf8(200, 1310)), malformed],
        ["269 tuples: 1,048,576", first(tuples(3881)), H],
        ["(some …) of 1,048,576", first(some(tuples(3881))), malformed],
        ["(ok …) of 1,048,576", first(`07${tuples(3881)}`), malformed],
        ["(some …) of 1,048,575", first(some(tuples(3883, "k"))), H],
        ["{a <1,048,575>}", first(tuple([["a", tuples(3883, "k")]])), malformed],
      ]);
    });

    // A principal in a value has a version below 32 (mod.rs:106-111) and a contract principal's name is a contract
    // name of at most 128 characters: a letter, then letters, digits, - and _, or __transient
    // (representations.rs:36-60, serialization.rs:233-252).
    it("a principal in a value has a version below 32 and a contract name of up to 128 characters", async () => {
      const principal = (n: string) => `06${sender}${name(n)}`;
      await check([
        ["a name of 41 characters", first(principal("a".repeat(41))), H],
        ["a name of 128 characters", first(principal("a".repeat(128))), H],
        ["__transient", first(principal("__transient")), H],
        ["version 31", first(`051f${sender.slice(2)}`), H],
        ["a name of 129 characters", first(principal("a".repeat(129))), malformed],
        ["a name starting with a digit", first(principal("1abc")), malformed],
        ["a name holding a dot", first(principal("a.b")), malformed],
        ["version 32", first(`0520${sender.slice(2)}`), malformed],
      ]);
    });

    // A contract call names an address of version below 32 (stacks-common/src/types/chainstate.rs:383-395), a contract
    // name of 1 to 40 characters (representations.rs:138-160) and a function by its Clarity name (:96-116)
    // (stacks-codec/src/transaction.rs:2114-2135).
    it("a contract call names its contract by an address below version 32 and a name of 1 to 40 characters, and its function by a Clarity name", async () => {
      const call = (address: string, contractName: string, fn: string) => payload(`02${address}${name(contractName)}${name(fn)}${at(223)}`);
      const address = at(187, 208);
      await check([
        ["the contract __transient", call(address, "__transient", "transfer"), H],
        ["a contract name of 40 characters", call(address, `Token_A-${"x".repeat(32)}`, "transfer"), H],
        ["address version 31", call(`1f${address.slice(2)}`, "usdcx", "transfer"), H],
        ["a function transfer-memo", call(address, "usdcx", "transfer-memo"), notH],
        ["a contract name of 41 characters", call(address, "a".repeat(41), "transfer"), malformed],
        ["an empty contract name", call(address, "", "transfer"), malformed],
        ["a contract name starting with a digit", call(address, "1abc", "transfer"), malformed],
        ["address version 32", call(`20${address.slice(2)}`, "usdcx", "transfer"), malformed],
        ["the function !", call(address, "usdcx", "!"), malformed],
        ["the function 1a", call(address, "usdcx", "1a"), malformed],
        ["an empty function name", call(address, "usdcx", ""), malformed],
      ]);
    });

    // A smart contract names a Clarity version from 1 to 7 when versioned (transaction.rs:2825-2842), a contract name
    // of 1 to 40 characters, and code of printable ASCII, tab and newline (stacks-codec/src/strings.rs:63-112).
    it("a smart contract's Clarity version is 1 to 7, and its code printable ASCII, tab and newline", async () => {
      const code = (text: string) => `${word(text.length, 4)}${ascii(text)}`;
      const ok = code("(define-data-var a\tint\n1)");
      await check([
        ["Clarity version 7", payload(`0607${name("hello")}${ok}`), notH],
        ["Clarity version 1", payload(`0601${name("hello")}${ok}`), notH],
        ["unversioned, tab and newline", payload(`01${name("hello")}${ok}`), notH],
        ["Clarity version 8", payload(`0608${name("hello")}${ok}`), malformed],
        ["Clarity version 0", payload(`0600${name("hello")}${ok}`), malformed],
        ["a carriage return", payload(`01${name("hello")}${code("(a)\r")}`), malformed],
        ["the byte 0x7f", payload(`01${name("hello")}${code("(a)\x7f")}`), malformed],
        ["the byte 0x80", payload(`01${name("hello")}${code("(a)\x80")}`), malformed],
        ["a contract name of 41 characters", payload(`0603${name("a".repeat(41))}${ok}`), malformed],
      ]);
    });

    // A coinbase (payload types 4, 5 and 8) and a poisoned microblock (3) are anchored on chain only
    // (transaction.rs:3115-3135).
    it("a coinbase and a poisoned microblock are anchored on chain only", async () => {
      const coinbase = `04${"12".repeat(32)}`;
      await check([
        ["a coinbase on chain", anchored("01", coinbase), notH],
        ["a coinbase, any anchor mode", anchored("03", coinbase), malformed],
        ["a coinbase off chain", anchored("02", coinbase), malformed],
        ["a pay-to-alt coinbase, any anchor mode", anchored("03", `05${"12".repeat(32)}05${sender}`), malformed],
      ]);
    });

    // A poisoned-microblock payload holds two microblock headers that differ and share a sequence number or a parent
    // block (transaction.rs:2942-2962), each signed with a recoverable secp256k1 signature: a recovery id from 0 to 3,
    // r and s below the group order (:2563-2584; stacks-common/src/util/secp256k1/native.rs:104-115).
    it("a poisoned-microblock payload holds two headers that differ and share a sequence number or a parent", async () => {
      const n = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";
      const header = (sequence: number, parent: string, root: string, sig = `00${word(1, 32)}${word(1, 32)}`) =>
        `00${word(sequence, 2)}${parent.repeat(32)}${root.repeat(32)}${sig}`;
      const poison = (a: string, b: string) => payload(`03${a}${b}`);
      const h = header(1, "21", "31");
      await check([
        ["roots differ", poison(h, header(1, "21", "32")), notH],
        ["sequences differ", poison(h, header(2, "21", "31")), notH],
        ["s one below the group order", poison(h, header(1, "21", "32", `00${word(1, 32)}${(BigInt(`0x${n}`) - 1n).toString(16)}`)), notH],
        ["the same header twice", poison(h, h), malformed],
        ["sequence and parent differ", poison(h, header(2, "22", "31")), malformed],
        ["recovery id 4", poison(h, header(1, "21", "32", `04${word(1, 32)}${word(1, 32)}`)), malformed],
        ["r the group order", poison(h, header(1, "21", "32", `00${n}${word(1, 32)}`)), malformed],
        ["any anchor mode", anchored("03", `03${h}${header(1, "21", "32")}`), malformed],
      ]);
    });

    // A Nakamoto coinbase's VRF proof parses (stacks-common/src/util/vrf.rs:281-351): Gamma, its first 32 bytes, the
    // canonical encoding of an Edwards25519 point (RFC 8032 5.1.3) not of small order; c, 16 bytes; s, 32 bytes, a
    // scalar below the group order L (RFC 8032 5.1). The proof is stacks-core's own Nakamoto coinbase test's
    // (transaction.rs:3767-3778).
    it("a Nakamoto coinbase's VRF proof parses: Gamma a canonical point not of small order, s below L", async () => {
      const vrf =
        "9275df67a68c8745c0ff97b48201ee6db447f7c93b23ae24cdc2400f52fdb08a1a6ac7ec71bf9c9c76e96ee4675ebff60625af2871850104" +
        "7bfd87b810c2d2139b73c23bd69de66360953a642c2a330a";
      const [gamma, c, s] = [vrf.slice(0, 64), vrf.slice(64, 96), vrf.slice(96)];
      const nakamoto = (proof: string) => payload(`08${"12".repeat(32)}09${proof}`);
      const le = (n: bigint) => word(n, 32).match(/../g)!.reverse().join("");
      const p = 2n ** 255n - 19n;
      const L = 2n ** 252n + 27742317777372353535851937790883648493n;
      const flipped = gamma.slice(0, 62) + word(parseInt(gamma.slice(62), 16) ^ 0x80, 1);
      await check([
        ["stacks-core's proof", nakamoto(vrf), notH],
        ["Gamma negated", nakamoto(flipped + c + s), notH],
        ["c all 0xff", nakamoto(gamma + "ff".repeat(16) + s), notH],
        ["s = L - 1", nakamoto(gamma + c + le(L - 1n)), notH],
        ["all zero", nakamoto("00".repeat(80)), malformed],
        ["Gamma the identity, y = 1", nakamoto(le(1n) + c + s), malformed],
        ["Gamma (0, -1), of order 2", nakamoto(le(p - 1n) + c + s), malformed],
        ["Gamma y = 2, on no point", nakamoto(le(2n) + c + s), malformed],
        ["Gamma y = 3 + p, not canonical", nakamoto(le(3n + p) + c + s), malformed],
        ["s = L", nakamoto(gamma + c + le(L)), malformed],
      ]);
    });

    // A tenure change holds three 20-byte consensus hashes, a 32-byte block id, a count, a cause from 0 to 6 and a
    // 20-byte key hash (transaction.rs:300-345); a node reads them whole.
    it("a tenure change's cause is 0 to 6, and its fields are whole", async () => {
      const tenure = (cause: number) => `07${"01".repeat(20)}${"02".repeat(20)}${"03".repeat(20)}${"04".repeat(32)}${word(5, 4)}${word(cause, 1)}${"06".repeat(20)}`;
      await check([
        ["cause 6", payload(tenure(6)), notH],
        ["cause 7", payload(tenure(7)), malformed],
        ["one byte short", payload(tenure(0).slice(0, -2)), malformed],
      ]);
    });

    // A post-condition (transaction.rs:2452-2540) names its principal (:2345-2368) by an address of version below 32
    // and a contract name of 1 to 40 characters, an asset by a contract name and a Clarity name (:2177-2186), and a
    // condition code of its type: 1 to 5 for STX, fungible and Staking, 0x10 to 0x12 non-fungible, 0x30 to 0x32 Pox.
    // The post-condition mode is 1 to 3 (:3137-3152).
    it("a post-condition's principal, asset and condition code are ones a node reads", async () => {
      const stx = (principal: string, code = "01") => `00${principal}${code}${amount}`;
      const asset = (contractName: string, assetName: string) => `${contract}${name(contractName)}${name(assetName)}`;
      await check([
        ["Staking, code 5", postCondition(`0302${sender}05${amount}`), H],
        ["Pox, code 0x32", postCondition(`0401${"32"}`), H],
        ["non-fungible, code 0x12", postCondition(`0202${sender}${asset("usdcx", "nft")}${uint(1)}12`), H],
        ["a contract principal named by 40 characters", postCondition(stx(`03${contract}${name("a".repeat(40))}`)), H],
        ["the post-condition mode 3", postCondition(stx("01"), "03"), H],
        ["Staking, code 6", postCondition(`0302${sender}06${amount}`), malformed],
        ["Pox, code 0x33", postCondition(`0401${"33"}`), malformed],
        ["non-fungible, code 0x13", postCondition(`0202${sender}${asset("usdcx", "nft")}${uint(1)}13`), malformed],
        ["a contract principal named by 41 characters", postCondition(stx(`03${contract}${name("a".repeat(41))}`)), malformed],
        ["the asset name 1a", postCondition(`0102${sender}${asset("usdcx", "1a")}01${amount}`), malformed],
        ["an asset contract named by 41 characters", postCondition(`0102${sender}${asset("a".repeat(41), "usdcx-token")}01${amount}`), malformed],
        ["an address of version 32", postCondition(stx(`0220${sender.slice(2)}`)), malformed],
        ["the post-condition mode 4", postCondition(stx("01"), "04"), malformed],
      ]);
    });

    // A multisig spending condition (transaction.rs:805-871) holds exactly the signatures it requires, an
    // order-independent one (:997-1060) at least that many, and a P2WSH one (hash mode 3 or 7) compressed keys and
    // signatures only.
    it("a multisig authorization holds exactly the signatures it requires, an order-independent one at least that many", async () => {
      const key = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // the point of the scalar 1 (SEC 2)
      const sig = (id = "02") => `${id}${"00".repeat(65)}`;
      const multisig = (mode: string, fields: string[], required: number) =>
        authorization(`04${mode}${signer}${word(0, 8)}${word(1000, 8)}${word(fields.length, 4)}${fields.join("")}${word(required, 2)}`);
      await check([
        ["P2SH, a key and a signature, 1 required", multisig("01", [`00${key}`, sig()], 1), H],
        ["P2SH, an uncompressed signature", multisig("01", [sig("03")], 1), H],
        ["order-independent P2SH, two signatures, 1 required", multisig("05", [sig(), sig()], 1), H],
        ["order-independent P2WSH, two signatures, 1 required", multisig("07", [sig(), sig()], 1), H],
        ["P2SH, two signatures, 1 required", multisig("01", [sig(), sig()], 1), malformed],
        ["P2SH, one signature, 2 required", multisig("01", [`00${key}`, sig()], 2), malformed],
        ["order-independent P2SH, one signature, 2 required", multisig("05", [`00${key}`, sig()], 2), malformed],
        ["P2WSH, an uncompressed signature", multisig("03", [sig("03")], 1), malformed],
        ["order-independent P2WSH, an uncompressed key", multisig("07", [`01${key}`, sig()], 1), malformed],
      ]);
    });
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

  // A failed transaction's block is read for its tenure and the tip's, as status reads a failed answer's finality: one
  // call for the transaction, and two for a failed one's tenures.
  it.each(rowsOf(V.M4b.recover as Row[], "mpp-charge-usdc-stacks.json M4b.recover"))("recover: $case", async (row) => {
    const reader = readerFor(row);
    expect(await stacksRecover({ network: ref.network, contract: ref.contract, transaction: ref.transaction }, reader)).toEqual(
      row.expect,
    );
    expect(reader.calls).toBe(row.status === undefined ? 1 : 3);
  });

  // A Stacks block is final once the tip's tenure height is at least its own plus two (status's `bitcoin` finality, the
  // vector's M4b.rows "L with abort_by_response, tip tenure 256358"); a block above that can be replaced. A refusal names
  // no finality, so recover gives a failed transaction's verdict only at that mark, and a read to repeat below it, as
  // status gives the same failure with finality `block` (M4b.rows "L with abort_by_response").
  it("recover refuses a failed transaction stacks/not-success only where status reads bitcoin finality", async () => {
    const r = { network: ref.network, contract: ref.contract, transaction: ref.transaction };
    const rows = rowsOf(V.M4b.rows as Row[], "mpp-charge-usdc-stacks.json M4b.rows", {
      keep: ["the failed rows", (row) => row.status !== undefined],
      leave: ["the rows of a successful or unmined transaction", (row) => row.status === undefined],
      exact: 3,
    });
    for (const row of rows) {
      const code = (row.expect as { finality: string }).finality === "bitcoin" ? "stacks/not-success" : "stacks/not-final";
      expect([row.case, await stacksRecover(r, readerFor(row))]).toEqual([row.case, { refused: true, code }]);
    }
  });

  // A mined transaction's status is one of success, abort_by_response, abort_by_post_condition and problematic_skipped
  // (StacksReader's documented answer, `StacksLanded`); another value is an answer out of that form, which status reads
  // as pending unreadable (docs/reference/refusals.md, `stacks/unreadable`), with no tenure read.
  it("recover refuses a mined status of none of the documented values as stacks/unreadable", async () => {
    const r = { network: ref.network, contract: ref.contract, transaction: ref.transaction };
    for (const status of ["pending", "abort_by_timeout", "Success", ""]) {
      const reader = readerFor({ status, tip: "256358" });
      expect([status, await stacksRecover(r, reader)]).toEqual([status, { refused: true, code: "stacks/unreadable" }]);
      expect(reader.calls).toBe(1);
      expect(await stacksStatus(ref, readerFor({ status, tip: "256358" }))).toEqual({ state: "pending", why: "unreadable" });
    }
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

// The agreedRefusals rows: M4's signed transaction with one part replaced, each answer what stacks-core 4.0.5's
// deserializer reads (StacksTransaction::consensus_deserialize, stacks-codec/src/transaction.rs:3065-3067), the sources
// the tests above name: a token transfer's recipient (type 0), a pay-to-alt coinbase's (5), a Nakamoto coinbase's (8)
// and its VRF proof, a contract call's argument, contract and function (2), a smart contract (6 and 1), a coinbase's
// anchor mode (4), a poisoned microblock (3), a tenure change (7), a post-condition, and a multisig authorization.
describe("mpp-charge-usdc-stacks.json agreedRefusals", () => {
  // The part of M4's wire each row replaces, in the file's order: the rows the file holds, as this list states them.
  const PARTS = [
    ...["07", "08", "00", "00", "00", "05", "05", "05", "08", "08", "08", "08", "08", "02"].map((t) => `payload ${t}`),
    ...Array.from({ length: 11 }, () => "payload 02"),
    "payload 06",
    "payload 01",
    "payload 02",
    "payload 02",
    "payload 02",
    "anchor 03, payload 04",
    ...Array.from({ length: 4 }, () => "payload 08"),
    "payload 03",
    ...Array.from({ length: 3 }, () => "post-condition"),
    ...Array.from({ length: 3 }, () => "authorization"),
  ];
  const rows = rowsOf(V.agreedRefusals.rows as { case: string; wireHex: string; expect: string }[], "mpp-charge-usdc-stacks.json agreedRefusals.rows", {
    exact: PARTS.length,
  });
  it("each wire is M4's with the part its case names replaced", () => {
    const m4 = V.M4.wireHex;
    const payloadAt = m4.length - 2 * S.serializePayloadBytes(S.deserializeTransaction(Buffer.from(m4.slice(2), "hex")).payload).length;
    // M4's header up to its anchor mode is 109 bytes, then the anchor and post-condition modes and the post-condition
    // count; its authorization is bytes 5 to 109.
    const at = (a: number, b?: number) => m4.slice(2 + 2 * a, b === undefined ? undefined : 2 + 2 * b);
    const part = (w: string) => {
      if (w.startsWith(m4.slice(0, payloadAt))) return `payload ${w.slice(payloadAt, payloadAt + 2)}`;
      if (w.startsWith(`0x${at(0, 109)}03${at(110, 186)}`)) return `anchor 03, payload ${w.slice(payloadAt, payloadAt + 2)}`;
      if (w.startsWith(`0x${at(0, 115)}`) && w.endsWith(at(186))) return "post-condition";
      if (w.startsWith(`0x${at(0, 5)}`) && w.endsWith(at(109))) return "authorization";
      return "other";
    };
    expect(rows.map((r) => part(r.wireHex))).toEqual(PARTS);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      expect(await chargeUsdcStacks.bound(credential(Buffer.from(r.wireHex.slice(2), "hex")))).toEqual({ refused: true, code: r.expect });
    });
  }
});
