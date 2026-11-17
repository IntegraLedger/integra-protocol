// The Stacks charge: M4 (usdc/stacks bound and reference), M4b (status and recover on fixture reader answers) and
// the Stacks plant. Expected values are the vector file's. The transaction is built at test time with
// @stacks/transactions from the vector file's inputs; the signing key is the scalar 1.
import * as S from "@stacks/transactions";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { chargeUsdcStacks, network, pairingsOf, type MppChallenge, type MppCredential } from "../src/mpp.js";
import { stacksRecover, stacksStatus, stacksTxid, type StacksQuery, type StacksReader, type StacksRef } from "../src/stacks.js";
import { ledgerReader, type Ledger, type LedgerTx } from "./stacks-ledger.js";
import { b64u, load } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

const V = load("mpp-charge-usdc-stacks.json");
const F = V.fixed;
const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;
/** The private key whose scalar is 1, compressed. */
const KEY = `${"00".repeat(31)}0101`;

/**
 * M4's transfer with `memo` as its fourth argument, signed by KEY. `on` sets the transaction's version and chain id
 * before it is signed; without it they are network testnet's, 0x80 and 2147483648. `fifth` adds a fifth argument, a
 * buffer of that many zero bytes.
 */
async function transfer(memo: S.ClarityValue, on?: { transactionVersion: number; chainId: number }, fifth?: number): Promise<Uint8Array> {
  const [address, name] = F.contract.split(".");
  const args = [S.uintCV(BigInt(F.amount)), S.principalCV(F.sender), S.principalCV(F.recipient), memo];
  if (fifth !== undefined) args.push(S.bufferCV(new Uint8Array(fifth)));
  const tx = await S.makeUnsignedContractCall({
    contractAddress: address,
    contractName: name,
    functionName: "transfer",
    functionArgs: args,
    network: "testnet",
    fee: BigInt(F.fee),
    nonce: BigInt(F.nonce),
    publicKey: S.privateKeyToPublic(KEY) as string,
    postConditionMode: S.PostConditionMode.Deny,
    postConditions: [S.Pc.principal(F.sender).willSendEq(BigInt(F.amount)).ft(F.contract, F.asset)],
  });
  tx.anchorMode = S.AnchorMode.OnChainOnly;
  if (on !== undefined) {
    tx.transactionVersion = on.transactionVersion;
    tx.chainId = on.chainId;
  }
  new S.TransactionSigner(tx).signOrigin(KEY);
  return S.serializeTransactionBytes(tx);
}

const withMemo = (on?: { transactionVersion: number; chainId: number }) =>
  transfer(S.someCV(S.bufferCV(Buffer.from(F.H.slice(2), "hex"))), on);

function challenge(): MppChallenge & { id: string } {
  const c: MppChallenge = { realm: F.realm, method: "usdc", intent: "charge", request: b64u(JSON.stringify(F.request)), expires: F.expires };
  const doc = chargeUsdcStacks.advertise([c], F.H, F.link, c, 0);
  if (!Array.isArray(doc)) throw new Error(JSON.stringify(doc));
  return doc[0] as MppChallenge & { id: string };
}

/**
 * An agreedRefusals row; the rows that set a version and a chain id say which, as numbers, and the size rows their
 * length in bytes and, where they add one, the length of their fifth argument.
 */
type NetworkRow = {
  case: string;
  wireHex: string;
  expect: string;
  transactionVersion?: number;
  chainId?: number;
  bytes?: number;
  fifthArgumentBytes?: number;
};

/** `chargeUsdcStacks.reference` of a credential, with the challenge it echoes as the option the payment answers. */
const stacksReference = (c: MppCredential) => chargeUsdcStacks.reference(c, c.challenge);

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

  // The read compares the payee with the API's addresses as written, so the filter takes only a recipient spelled as a
  // Stacks node writes a principal; @stacks/transactions 7.6.0's c32check round trip is the oracle for each row.
  it.each(rowsOf(V.recipients.rows as { case: string; recipient: string; expect: unknown }[], "mpp-charge-usdc-stacks.json recipients.rows"))(
    "recipient: $case",
    (row) => {
      const c = challenge();
      const request = b64u(JSON.stringify({ ...F.request, recipient: row.recipient }));
      expect(pairingsOf({ ...c, request, id: undefined, opaque: undefined } as unknown as MppChallenge)).toEqual(row.expect);
      const [address, name] = row.recipient.split(".") as [string, string | undefined];
      let roundTrip: string | undefined;
      try {
        roundTrip = S.Address.stringify(S.Address.parse(address));
      } catch {
        roundTrip = undefined;
      }
      const accepted = roundTrip === address && (name === undefined || /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(name));
      expect(Array.isArray(row.expect)).toBe(accepted);
    },
  );

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
      chainId: Number(F.network.slice("stacks:".length)),
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
    expect(await stacksReference(credential(led))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });
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
    expect(await stacksReference(credential(offCurve))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });

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
    expect(await stacksReference(credential(offCurve65))).toEqual(malformed);
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
        expect(await stacksReference(credential(wire(text)))).toEqual(malformed);
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
    const ref = await stacksReference(credential(await withMemo()));
    expect(ref).toEqual({ ...V.M4.expectReference, payee: F.request.recipient });
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
  });

  // M4s: the origin's digest is @stacks/transactions 7.6.0's sigHashPreSign(signBegin(), Standard, fee, nonce) of each
  // body, recomputed here; under a sponsored authorization it is one for the origin's bytes and for every sponsor's,
  // and the reference names no transaction, a sponsored id being fixed only by the sponsor's signature.
  it("reference of a sponsored payment names the origin's digest and no transaction, whoever sponsors it (M4s)", async () => {
    const digest = (h: string) => {
      const tx = S.deserializeTransaction(h.slice(2));
      const c = tx.auth.spendingCondition;
      return `0x${S.sigHashPreSign(tx.signBegin(), S.AuthType.Standard, c.fee, c.nonce)}`;
    };
    const bodies = [V.M4s.originWireHex, V.M4s.sponsorA.wireHex, V.M4s.sponsorB.wireHex];
    for (const h of bodies) {
      expect(digest(h)).toBe(V.M4s.expectSigned);
      expect(await stacksReference(credential(Buffer.from(h.slice(2), "hex")))).toEqual({ ...V.M4s.expectReference, payee: F.request.recipient });
    }
    expect(stacksTxid(Buffer.from(V.M4s.sponsorA.wireHex.slice(2), "hex"))).toBe(V.M4s.sponsorA.txid);
    expect(stacksTxid(Buffer.from(V.M4s.sponsorB.wireHex.slice(2), "hex"))).toBe(V.M4s.sponsorB.txid);
    expect(digest(V.M4.wireHex)).toBe(V.M4.expectReference.signed);
    expect(digest(V.M4s.otherFee.wireHex)).toBe(V.M4s.otherFee.expectSigned);
    expect(V.M4s.otherFee.expectSigned).not.toBe(V.M4.expectReference.signed);
  });

  it("reference refuses a credential whose echoed challenge is not the option given", async () => {
    const c = credential(await withMemo());
    const other = { ...c.challenge, expires: "2026-09-21T14:14:21Z" };
    expect(await chargeUsdcStacks.reference(c, other)).toEqual({ refused: true, code: "mpp/challenge-not-option" });
    const reordered = { ...c.challenge, request: b64u(JSON.stringify({ methodDetails: F.request.methodDetails, ...F.request })) };
    expect(await chargeUsdcStacks.reference(c, reordered)).toEqual({ ...V.M4.expectReference, payee: F.request.recipient });
  });

  // A Stacks node takes a transaction only on its own chain id, and on mainnet only at version 0x00, elsewhere only at
  // 0x80 (stacks-core 4.0.5, stackslib/src/chainstate/stacks/db/transactions/processing/validation.rs:49-79); a mainnet
  // node runs chain id 1 and no other (stackslib/src/config/mod.rs:1844-1857). The agreedRefusals rows whose wire is M4's
  // transfer signed for another network are refused by bound, reference and build's complete alike.
  it("bound, reference and build's complete refuse a transaction signed for another network than the challenge's", async () => {
    const rows = rowsOf(V.agreedRefusals.rows as NetworkRow[], "mpp-charge-usdc-stacks.json agreedRefusals.rows", {
      exact: 4,
      keep: ["the rows that set a version and a chain id", (r) => r.chainId !== undefined],
      leave: ["the rows that replace a part of M4's wire, run by the agreedRefusals runner below", (r) => r.chainId === undefined],
    });
    const u = await chargeUsdcStacks.build({ challenge: challenge(), from: F.sender }, F.H);
    if ("refused" in u) throw new Error(u.code);
    for (const r of rows) {
      const wire = Buffer.from(r.wireHex.slice(2), "hex");
      const code = { refused: true, code: r.expect };
      expect([r.case, await chargeUsdcStacks.bound(credential(wire))]).toEqual([r.case, code]);
      expect([r.case, await stacksReference(credential(wire))]).toEqual([r.case, code]);
      expect([r.case, u.complete(Uint8Array.from(wire))]).toEqual([r.case, code]);
    }
  });

  // The control: a challenge naming chain id 1, mainnet, reads the transfer signed at version 0x00 on chain 1, whose
  // origin is then a mainnet address (version 22), and refuses M4, signed for testnet.
  it("a challenge on mainnet, chain id 1, reads a transaction of version 0x00 on chain 1 and refuses M4", async () => {
    const request = { ...F.request, methodDetails: { ...F.request.methodDetails, stacks: { ...F.request.methodDetails.stacks, network: "mainnet", chainId: "1" } } };
    const c: MppChallenge = { realm: F.realm, method: "usdc", intent: "charge", request: b64u(JSON.stringify(request)), expires: F.expires };
    const doc = chargeUsdcStacks.advertise([c], F.H, F.link, c, 0);
    if (!Array.isArray(doc)) throw new Error(JSON.stringify(doc));
    const onMainnet = (wire: Uint8Array): MppCredential => ({ ...credential(wire), challenge: doc[0] as MppChallenge & { id: string } });
    const mainnet = await withMemo({ transactionVersion: 0x00, chainId: 1 });
    expect(await chargeUsdcStacks.bound(onMainnet(mainnet))).toBe(F.H);
    expect(await stacksReference(onMainnet(mainnet))).toMatchObject({ network: "stacks:1", origin: S.getAddressFromPrivateKey(KEY, "mainnet") });
    const u = await chargeUsdcStacks.build({ challenge: doc[0] as MppChallenge & { id: string }, from: F.sender }, F.H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.complete(mainnet)).not.toHaveProperty("refused");
    const m4 = await withMemo();
    expect(await chargeUsdcStacks.bound(onMainnet(m4))).toEqual({ refused: true, code: "stacks/chain-mismatch" });
    expect(u.complete(m4)).toEqual({ refused: true, code: "stacks/chain-mismatch" });
  });

  // The size bound, one rule for bound, reference and build's complete: a transaction is 1 to 16,384 bytes, and an empty
  // one or one over 16,384 bytes is mpp/stacks-tx-malformed, the code of bytes a Stacks node does not decode. The rows
  // at the bound are agreedRefusals rows 46 to 48: 0 bytes, 1 byte, and M4's transfer padded by a fifth argument to
  // 16,385 bytes; padded to 16,384 bytes it is taken by all three.
  it("bound, reference and build's complete take 1 to 16,384 bytes, and refuse 0 bytes and 16,385 bytes with one code", async () => {
    const rows = rowsOf(V.agreedRefusals.rows as NetworkRow[], "mpp-charge-usdc-stacks.json agreedRefusals.rows", {
      exact: 3,
      keep: ["the size rows", (r) => r.bytes !== undefined],
      leave: ["every other row, run by the agreedRefusals runner below", (r) => r.bytes === undefined],
    });
    expect(rows.map((r) => [r.bytes, (r.wireHex.length - 2) / 2])).toEqual([[0, 0], [1, 1], [16_385, 16_385]]);
    const padded = rows[2]!.fifthArgumentBytes!;
    expect(hex(await transfer(S.someCV(S.bufferCV(Buffer.from(F.H.slice(2), "hex"))), undefined, padded))).toBe(rows[2]!.wireHex);
    const u = await chargeUsdcStacks.build({ challenge: challenge(), from: F.sender }, F.H);
    if ("refused" in u) throw new Error(u.code);
    const largest = await transfer(S.someCV(S.bufferCV(Buffer.from(F.H.slice(2), "hex"))), undefined, padded - 1);
    expect(largest.length).toBe(16_384);
    expect(await chargeUsdcStacks.bound(credential(largest))).toBe(F.H);
    expect(await stacksReference(credential(largest))).toMatchObject({ network: F.network, nonce: F.nonce });
    expect(u.complete(largest)).toMatchObject({ payload: { transaction: Buffer.from(largest).toString("base64") } });
    for (const r of rows) {
      const wire = Uint8Array.from(Buffer.from(r.wireHex.slice(2), "hex"));
      const code = { refused: true, code: r.expect };
      expect([r.bytes, await chargeUsdcStacks.bound(credential(wire))]).toEqual([r.bytes, code]);
      expect([r.bytes, await stacksReference(credential(wire))]).toEqual([r.bytes, code]);
      expect([r.bytes, u.complete(wire)]).toEqual([r.bytes, code]);
    }
  });

  // build's complete reads the transaction as bound reads it: bytes a Stacks node does not decode are
  // mpp/stacks-tx-malformed, the code bound gives them.
  it("build's complete refuses a truncated transaction and one with bytes after it, as bound does", async () => {
    const u = await chargeUsdcStacks.build({ challenge: challenge(), from: F.sender }, F.H);
    if ("refused" in u) throw new Error(u.code);
    const whole = await withMemo();
    for (const wire of [whole.subarray(0, whole.length - 1), Uint8Array.from([...whole, 0])]) {
      expect(u.complete(wire)).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });
      expect(await chargeUsdcStacks.bound(credential(wire))).toEqual({ refused: true, code: "mpp/stacks-tx-malformed" });
    }
  });

  it("states what it proves", () => {
    expect({ ...chargeUsdcStacks.pattern, proves: chargeUsdcStacks.data.proves, claims: chargeUsdcStacks.claims }).toEqual(V.pattern);
  });
});

/** A transaction of a row's ledger, as the vector file writes it: L or a filler with overrides, or an unmined one. */
type TxSpec = { like?: "L" | "filler"; mined?: false; [k: string]: unknown };

type Row = {
  case: string;
  txs: TxSpec[];
  ref?: "sponsored" | "nohint";
  query?: { act?: "payment" | "agreement"; finality?: "block" | "bitcoin"; after?: string; others?: unknown[] };
  finalThrough?: string;
  faults?: Ledger["faults"];
  answers?: Record<string, unknown>;
  byNonce?: Record<string, { txid: string; sender: string; nonce: string }[]>;
  unknownHeights?: string[];
  fillers?: { from: string; to: string; blockHeight: string };
  readerNetwork?: string;
  expect: unknown;
};

const RAW: Record<string, string> = { M4: V.M4.wireHex, otherFee: V.M4s.otherFee.wireHex, sponsorA: V.M4s.sponsorA.wireHex, sponsorB: V.M4s.sponsorB.wireHex };

/** A row's transaction as the ledger holds it: L's members, or a filler's, with the row's own in their place. */
function txOf(spec: TxSpec): LedgerTx {
  if (spec.mined === false) return spec as unknown as LedgerTx;
  const { like, memo, recipient, nonce, ...rest } = spec;
  const L = V.M4b.L;
  const base =
    like === "filler"
      ? { ...L, call: { contractId: L.call.contractId, functionName: "ping", args: ["0x09"] }, events: [], raw: null, sender: { address: L.sender.address, nonce: nonce as string } }
      : { ...L };
  const t = { ...base, ...rest } as Record<string, unknown> & typeof L;
  if (memo !== undefined) t.call = { ...t.call, args: [...t.call.args.slice(0, 3), memo as string] };
  if (recipient !== undefined) t.events = t.events.map((e: { recipient: string }) => ({ ...e, recipient: recipient as string }));
  return {
    ...(t as object),
    mined: true,
    sender: { address: t.sender.address, nonce: BigInt(t.sender.nonce) },
    blockHeight: BigInt(t.blockHeight),
    transfer: t.transfer === null ? null : { ...(t.transfer as object), amount: BigInt((t.transfer as { amount: string }).amount) },
    events: t.events.map((e: { amount: string }) => ({ ...e, amount: BigInt(e.amount) })),
    raw: t.raw === null ? null : Buffer.from((RAW[t.raw as string] ?? (t.raw as string)).slice(2), "hex"),
  } as unknown as LedgerTx;
}

/** A row's faults, a scan page's nonces as the reader gives them, numbers. */
function faultsOf(faults: NonNullable<Ledger["faults"]>): NonNullable<Ledger["faults"]> {
  const page = faults.byOrigin;
  if (page === undefined || !("answer" in page)) return faults;
  const a = page.answer as { results: { nonce: string }[]; total: number };
  return { ...faults, byOrigin: { answer: { ...a, results: a.results.map((r) => ({ ...r, nonce: BigInt(r.nonce) })) } } };
}

/** The reader over a row's ledger. */
function rowReader(row: Partial<Row>): StacksReader & { calls: string[] } {
  const txs = row.txs!.map(txOf);
  if (row.fillers !== undefined) {
    for (let n = BigInt(row.fillers.from); n <= BigInt(row.fillers.to); n++) {
      txs.push(txOf({ like: "filler", txid: `0x${n.toString(16).padStart(64, "e")}`, nonce: n.toString(), blockHeight: row.fillers.blockHeight }));
    }
  }
  const byNonce = row.byNonce === undefined ? undefined
    : new Map(Object.entries(row.byNonce).map(([n, l]) => [BigInt(n), l.map((x) => ({ ...x, txid: x.txid as `0x${string}`, nonce: BigInt(x.nonce) }))]));
  const reader = ledgerReader({
    network: (row.readerNetwork ?? F.network) as `stacks:${string}`,
    txs,
    tipHeight: BigInt(V.M4b.tipHeight),
    finalThrough: BigInt(row.finalThrough ?? V.M4b.finalThrough),
    ...(row.unknownHeights === undefined ? {} : { unknownHeights: row.unknownHeights.map(BigInt) }),
    ...(byNonce === undefined ? {} : { byNonce }),
    ...(row.faults === undefined ? {} : { faults: faultsOf(row.faults) }),
  });
  const answers = row.answers ?? {};
  const transaction = reader.transaction.bind(reader);
  reader.transaction = async (txid) => (txid.toLowerCase() in answers ? (answers[txid.toLowerCase()] as never) : transaction(txid));
  return reader;
}

const ref: StacksRef & { h: `0x${string}` } = { ...V.M4.expectReference, payee: F.request.recipient, h: F.H };
const sponsoredRef: StacksRef & { h: `0x${string}` } = { ...V.M4s.expectReference, payee: F.request.recipient, h: F.H };
const Q = { act: "payment", finality: "bitcoin" } as const;
/** The recover input: the transaction id, and the challenge whose request names the contract. */
const R = { network: ref.network, tx: ref.transaction!, option: challenge() };
const UNPARSEABLE = { state: "unreadable", reason: "unparseable", foreign: [] };

function queryOf(row: Partial<Row>): StacksQuery {
  const q = row.query ?? {};
  return {
    act: q.act ?? "payment",
    finality: q.finality ?? "bitcoin",
    ...(q.after === undefined ? {} : { after: BigInt(q.after) }),
    ...(q.others === undefined ? {} : { others: q.others as never }),
  };
}

describe("usdc/stacks status and recover (M4b, a constructed API ledger)", () => {
  it.each(rowsOf(V.M4b.rows as Row[], "mpp-charge-usdc-stacks.json M4b.rows"))("$case", async (row) => {
    const { transaction: _, ...nohint } = ref;
    const r = row.ref === "sponsored" ? sponsoredRef : row.ref === "nohint" ? nohint : ref;
    const reader = rowReader(row);
    expect(withBigints(await stacksStatus(r, reader, queryOf(row)))).toEqual(row.expect);
    // A row the scan for nonce 0 fails is read through the fallback: its nonce at a height, and where it settles, the
    // block's transactions.
    if (row.faults?.byOrigin !== undefined) {
      expect(reader.calls.filter((c) => c === "lastNonce").length).toBeGreaterThan(1);
      if ((row.expect as { state: string }).state === "settled") expect(reader.calls).toContain("inBlock");
    }
  });

  it.each(rowsOf(V.M4b.recover as Row[], "mpp-charge-usdc-stacks.json M4b.recover"))("recover: $case", async (row) => {
    expect(await stacksRecover(R, rowReader(row))).toEqual(row.expect);
  });

  it("plant: a post-condition abort is never settled, and recover refuses it", async () => {
    expect(withBigints(await stacksStatus(ref, rowReader(V.plant), Q))).toEqual(V.plant.expectStatus);
    expect(await stacksRecover(R, rowReader(V.plant))).toEqual(V.plant.expectRecover);
  });

  // An origin, a nonce, a payee or a hash not of its form cannot name the payer's act, so the read is unreadable
  // unparseable with nothing read; so is a query not of its form (read-status rule 12).
  it("a reference or query not of its form is unreadable unparseable, with nothing read", async () => {
    const row = (V.M4b.rows as Row[])[0]!;
    const bad = [
      { origin: ref.origin.toLowerCase() }, { origin: undefined }, { nonce: "01" }, { nonce: (1n << 64n).toString() },
      { payee: "" }, { payee: ref.payee.toLowerCase() }, { payee: `${ref.payee.slice(0, -1)}R` }, { h: "0x12" }, { signed: "0x12" }, { transaction: "0x12" },
    ];
    for (const change of bad) {
      const reader = rowReader(row);
      expect([change, await stacksStatus({ ...ref, ...change } as typeof ref, reader, Q)]).toEqual([change, UNPARSEABLE]);
      expect(reader.calls).toEqual([]);
    }
    for (const q of [{ ...Q, finality: "final" }, { ...Q, after: 5 }, { ...Q, search: -1n }, { act: "charge", finality: "bitcoin" }]) {
      const reader = rowReader(row);
      expect(await stacksStatus(ref, reader, q as never)).toEqual(UNPARSEABLE);
      expect(reader.calls).toEqual([]);
    }
  });

  // The search position an answer returns is where the next read resumes (read-status rule 19): given back, the
  // search reads the next 32 nonces, and from past the last executed nonce it is read whole.
  it("the search resumes from the position an answer returned", async () => {
    const row = (V.M4b.rows as Row[]).find((r) => r.case.startsWith("one read searches at most 32"))!;
    const first = await stacksStatus(ref, rowReader(row), Q);
    expect(withBigints(first)).toEqual(row.expect);
    const second = await stacksStatus(ref, rowReader(row), { ...Q, search: 33n });
    expect(withBigints(second)).toMatchObject({ state: "failed", reason: "instrument-consumed", transaction: `0x${"f0".repeat(32)}` });
  });

  it("recover with an option that names no contract is stacks/wrong-reader, with nothing read", async () => {
    const row = (V.M4b.rows as Row[])[0]!;
    const noContract = { ...challenge(), request: b64u(JSON.stringify({ ...F.request, methodDetails: { type: "stacks" } })) };
    for (const option of [undefined, {}, noContract]) {
      const reader = rowReader(row);
      expect(await stacksRecover({ ...R, option } as never, reader)).toEqual({ refused: true, code: "stacks/wrong-reader" });
      expect(reader.calls).toEqual([]);
    }
  });
});

function withBigints(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
}

// The agreedRefusals rows: M4's signed transaction with one part replaced, each answer what stacks-core 4.0.5's
// deserializer reads (StacksTransaction::consensus_deserialize, stacks-codec/src/transaction.rs:3065-3067), the sources
// the tests above name: a token transfer's recipient (type 0), a pay-to-alt coinbase's (5), a Nakamoto coinbase's (8)
// and its VRF proof, a contract call's argument, contract and function (2), a smart contract (6 and 1), a coinbase's
// anchor mode (4), a poisoned microblock (3), a tenure change (7), a post-condition, and a multisig authorization; then
// M4's transfer signed for another network, which a node's precheck refuses (the M4 test above names its source).
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
    ...Array.from({ length: 4 }, () => "network"),
    ...Array.from({ length: 3 }, () => "size"),
  ];
  const rows = rowsOf(V.agreedRefusals.rows as NetworkRow[], "mpp-charge-usdc-stacks.json agreedRefusals.rows", {
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
      // The version and chain id (bytes 0 to 5) and the signature they change (bytes 44 to 109).
      if (w.length === m4.length && w.slice(2 + 10, 2 + 88) === at(5, 44) && w.endsWith(at(109))) return "network";
      return "other";
    };
    expect(rows.map((r) => (r.bytes !== undefined ? "size" : part(r.wireHex)))).toEqual(PARTS);
  });
  // The network rows are @stacks/transactions 7.6.0's: M4's transfer, its version and chain id set to the row's before
  // signing, byte for byte; the same build without them is M4.
  it("each network row's wire is M4's transfer signed at its version and chain id", async () => {
    expect(hex(await withMemo())).toBe(V.M4.wireHex);
    const network = rows.filter((r) => r.chainId !== undefined);
    expect(network.map((r) => [r.transactionVersion, r.chainId])).toEqual([
      [0x80, 1],
      [0x80, 0x80000001],
      [0x00, 0x80000000],
      [0x00, 1],
    ]);
    for (const r of network) {
      const wire = await withMemo({ transactionVersion: r.transactionVersion!, chainId: r.chainId! });
      expect([r.case, hex(wire)]).toEqual([r.case, r.wireHex]);
      const decoded = S.deserializeTransaction(wire);
      expect([decoded.transactionVersion, decoded.chainId]).toEqual([r.transactionVersion, r.chainId]);
    }
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      expect(await chargeUsdcStacks.bound(credential(Buffer.from(r.wireHex.slice(2), "hex")))).toEqual({ refused: true, code: r.expect });
    });
  }
});
