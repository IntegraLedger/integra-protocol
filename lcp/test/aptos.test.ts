// Expected values come from vectors/x402-exact-aptos.json: a real Aptos mainnet transfer read over REST, fixture F
// built with @aptos-labs/ts-sdk 7.5.0 and checked against the vector's SHA-256, and Python's hashlib digests. The
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
  Identifier,
  Script,
  SignedTransaction,
  SimpleTransaction,
  StructTag,
  TransactionAuthenticatorEd25519,
  TransactionPayloadEntryFunction,
  TransactionPayloadScript,
  TypeTagStruct,
  U64,
  generateSigningMessageForTransaction,
  parseTypeTag,
  type TransactionPayload,
  type TypeTag,
} from "@aptos-labs/ts-sdk";
import { ReaderError } from "../src/evm.js";
import { pairingOf } from "../src/index.js";
import {
  aptosIdDigest,
  committedInstrument,
  decodeAptosTx,
  exactAptos,
  type AptosCommitted,
  type AptosReader,
  type AptosRef,
} from "../src/aptos.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-aptos.json", import.meta.url), "utf8"));
const H: `0x${string}` = V.fixed.H;
const O = V.fixed.O;
const F = V.fixed.fixtureF;
const LINK: string = V.fixed.link;

function transferPayload(
  module = "primary_fungible_store",
  name = "transfer",
  typeArgument: TypeTag = parseTypeTag(F.typeArgument),
): TransactionPayload {
  return new TransactionPayloadEntryFunction(
    EntryFunction.build(`0x1::${module}`, name, [typeArgument], [
      AccountAddress.from(F.metadata),
      AccountAddress.from(F.recipient),
      new U64(BigInt(F.amount)),
    ]),
  );
}

function raw(
  payload = transferPayload(),
  chainId: number = F.chainId,
  expiresAt: bigint = BigInt(F.expiresAt),
): RawTransaction {
  return new RawTransaction(
    AccountAddress.from(F.sender),
    BigInt(F.sequenceNumber),
    payload,
    BigInt(F.maxGasAmount),
    BigInt(F.gasUnitPrice),
    expiresAt,
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

function payment(transaction: string, extensions?: PaymentRequired["extensions"], accepted = O) {
  return { x402Version: 2, accepted, payload: { transaction }, ...(extensions ? { extensions } : {}) };
}

/** build's unsigned payment for the option O, advertised under H. */
async function built() {
  const required = exactAptos.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, LINK, O);
  if ("refused" in required) throw new Error(required.code);
  const u = await exactAptos.build({ required, accepted: O }, H);
  if ("refused" in u) throw new Error(u.code);
  return u;
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
    ...(v["maxGasAmount"] !== undefined ? { maxGasAmount: v["maxGasAmount"] } : {}),
    ...(v["gasUnitPrice"] !== undefined ? { gasUnitPrice: v["gasUnitPrice"] } : {}),
    payee: v["payee"]!,
  };
}

/** The query a row asks: the act payment at the one mark unless the row's query says otherwise, its position a version. */
const paymentAct = { act: "payment", finality: "committed" } as const;
function queryOf(q?: { act: "payment" | "agreement"; finality: "committed"; after?: string; others?: unknown[] }) {
  if (q === undefined) return paymentAct;
  const others = q.others === undefined ? {} : { others: q.others as never };
  return q.after === undefined ? { act: q.act, finality: q.finality, ...others } : { act: q.act, finality: q.finality, after: BigInt(q.after), ...others };
}
const unreadable = (reason: string) => ({ state: "unreadable", reason, foreign: [] });
const expired = { state: "failed", reason: "instrument-unused", finality: "committed", foreign: [] };

type Row = {
  ledgerUsecs: string;
  byHash?: unknown;
  bySequence?: unknown;
  account?: { sequenceNumber: string; timestampUsecs: string; oldestVersion: string };
  readerError?: boolean;
};

/** A scripted reader; `asked` holds the hash and the sender each lookup was given. */
function reader(row: Row, network = "aptos:1", chainId = 1): AptosReader & { calls: number; asked: unknown[] } {
  const r = {
    network: network as AptosReader["network"],
    calls: 0,
    asked: [] as unknown[],
    async ledger() {
      r.calls++;
      if (row.readerError) throw new ReaderError("transport");
      return { chainId, timestampUsecs: BigInt(row.ledgerUsecs) };
    },
    async byHash(hash: unknown) {
      r.calls++;
      r.asked.push(hash);
      return (row.byHash ?? null) as AptosCommitted | null;
    },
    async bySequence(sender: unknown) {
      r.calls++;
      r.asked.push(sender);
      const answer = row.bySequence as { notFound?: true; timestampUsecs?: string; oldestVersion?: string } | null | undefined;
      if (answer?.notFound === true) {
        const oldest = answer.oldestVersion === undefined ? {} : { oldestVersion: BigInt(answer.oldestVersion) };
        return { notFound: true as const, timestampUsecs: BigInt(answer.timestampUsecs!), ...oldest };
      }
      return (answer ?? null) as AptosCommitted;
    },
    async account(sender: unknown) {
      r.calls++;
      r.asked.push(sender);
      const a = row.account;
      if (a === undefined) throw new ReaderError("transport");
      return { sequenceNumber: BigInt(a.sequenceNumber), timestampUsecs: BigInt(a.timestampUsecs), oldestVersion: BigInt(a.oldestVersion) };
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
      expect(throughJson(await exactAptos.reference(payment(wire), O))).toEqual(V.V2.expectReference);
    }
  });
  it("the payee is the payTo of the option the payment answers, and an option with none is refused", async () => {
    expect(await exactAptos.reference(payment(signedWire(raw())), O)).toMatchObject({ payee: O.payTo });
    expect(await exactAptos.reference(payment(signedWire(raw())), {} as PaymentRequirements)).toEqual({
      refused: true,
      code: "x402/option-malformed",
    });
  });
  it("chain_id 2 on aptos:1", async () => {
    expect(await exactAptos.reference(payment(referenceWire(raw(transferPayload(), 2))), O)).toEqual({
      refused: true,
      code: V.V2.chainMismatch.expect,
    });
  });
  it("a script payload", async () => {
    const script = new TransactionPayloadScript(new Script(new Uint8Array([0xa1, 0x1c, 0xeb, 0x0b]), [], []));
    expect(decodeAptosTx(referenceWire(raw(script)))).toEqual({ refused: true, code: V.V2.script.expect });
    expect(await exactAptos.reference(payment(signedWire(raw(script))), O)).toEqual({ refused: true, code: V.V2.script.expect });
  });
  it("a module, function or struct name with a leading U+FEFF, a leading digit or over 255 characters is not a Move identifier", async () => {
    // Move identifiers are ASCII letters, digits and underscores that do not start with a digit (aptos-core,
    // move-core-types identifier.rs, `is_valid`), so the bytes EF BB BF before a name make it no identifier. The bound
    // of 255 characters and the code are the vector's row.
    const named = (r: { case: string }) => r.case.startsWith("a module, function or struct name");
    const row = V.agreedRefusals.rows.find(named);
    const bom = "\uFEFF";
    const struct = (m: string, n: string) =>
      new TypeTagStruct(new StructTag(AccountAddress.ONE, new Identifier(m), new Identifier(n), []));
    /** Fixture F's transfer with each of its four names, in turn, written as `name` writes it. */
    const each = (name: (n: string) => string) => [
      transferPayload(name("primary_fungible_store")),
      transferPayload("primary_fungible_store", name("transfer")),
      transferPayload("primary_fungible_store", "transfer", struct(name("fungible_asset"), "Metadata")),
      transferPayload("primary_fungible_store", "transfer", struct("fungible_asset", name("Metadata"))),
    ];
    // A name of 255 characters is an identifier, so the decoder reads past it: a module or function other than the
    // transfer's is then not an x402 transfer, and a longer struct name decodes.
    const longest = (n: string) => n + "_".repeat(255 - n.length);
    for (const payload of each(longest)) {
      for (const wire of [referenceWire(raw(payload)), signedWire(raw(payload))]) {
        expect(decodeAptosTx(wire)).not.toEqual({ refused: true, code: row.expect });
      }
    }
    const payloads = [(n: string) => `${bom}${n}`, (n: string) => `1${n}`, (n: string) => `${longest(n)}_`].flatMap(each);
    expect(payloads).toHaveLength(12);
    for (const payload of payloads) {
      for (const wire of [referenceWire(raw(payload)), signedWire(raw(payload))]) {
        expect(decodeAptosTx(wire)).toEqual({ refused: true, code: row.expect });
        expect(await exactAptos.reference(payment(wire), O)).toEqual({ refused: true, code: row.expect });
      }
    }
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
  for (const row of rowsOf(V.V4.status, "x402-exact-aptos.json V4.status")) {
    it(row.case, async () => {
      const r = reader(row);
      expect(plain(await exactAptos.status(refOf(row.ref), r, queryOf(row.query)))).toEqual(row.expect);
      expect(r.calls).toBeLessThanOrEqual(4);
    });
  }
  it("a retry with another expiry has the same idDigest, and its commit settles only its own row", async () => {
    // Aptos takes each sequence number once, so once the retry commits at 218 the first signed transaction never can:
    // the vector's retry row.
    const retry = V.V4.status.find((r: { case: string }) => r.case.includes("signed the number again"));
    const committed = retry.bySequence as AptosCommitted;
    const first = await exactAptos.reference(payment(signedWire(raw())), O);
    const second = await exactAptos.reference(
      payment(signedWire(raw(transferPayload(), F.chainId, BigInt(committed.expiration_timestamp_secs)))),
      O,
    );
    if ("refused" in first) throw new Error(first.code);
    if ("refused" in second) throw new Error(second.code);
    expect(first).toEqual(V.V2.expectReference);
    expect(second).toEqual({ ...V.V2.expectReference, expiresAt: committed.expiration_timestamp_secs });
    const at: Row = { ledgerUsecs: retry.ledgerUsecs, bySequence: committed };
    expect(plain(await exactAptos.status(first, reader(at), paymentAct))).toEqual(retry.expect);
    const named = { ...first, transaction: committed.hash as `0x${string}` };
    expect(plain(await exactAptos.status(named, reader({ ...at, byHash: committed }), paymentAct))).toEqual(retry.expect);
    // The second reference holds the signed gas members, which the trimmed REST answer does not show.
    expect(plain(await exactAptos.status(second, reader(at), paymentAct))).toEqual({ ...retry.expect, presented: "unshown" });
  });
  // aptos-core e53447e0, aptos-move/framework/aptos-framework/sources/transaction_validation.move:134-137: the
  // prologue asserts `timestamp::now_seconds() < txn_expiration_time`; timestamp.move:67-69 gives now_seconds as the
  // ledger's microseconds / 1000000. So from the ledger second equal to expiresAt, read in the answer that read the
  // account's sequence number, the transaction cannot commit: instrument-unused from that second, instrument-live before.
  it("an absent transaction is unused from the account read's ledger second that equals expiresAt, live before", async () => {
    const [row] = V.V4.status.filter((r: { case: string }) => r.case.endsWith("1790300896 s"));
    const second = BigInt(row.ref.expiresAt) * 1_000_000n;
    for (const at of [second - 1_000_000n, second - 1n, second, second + 1n, second + 999_999n, second + 1_000_000n]) {
      const r = reader({ ...row, account: { ...row.account, timestampUsecs: at.toString() } });
      const want = at >= second ? expired : { state: "pending", reason: "instrument-live", foreign: [] };
      expect([at, await exactAptos.status(refOf(row.ref), r, queryOf(row.query))]).toEqual([at, want]);
    }
    const bare = { ...reader(row), bySequence: async () => null as never };
    expect(await exactAptos.status(refOf(row.ref), bare, queryOf(row.query))).toEqual(unreadable("unparseable"));
  });
  it("a reader for another network, or a ledger for another chain, is unreadable chain-mismatch", async () => {
    const row = V.V4.status[0];
    expect(await exactAptos.status(refOf(row.ref), reader(row, "aptos:2"), paymentAct)).toEqual(unreadable("chain-mismatch"));
    expect(await exactAptos.status(refOf(row.ref), reader(row, "aptos:1", 2), paymentAct)).toEqual(unreadable("chain-mismatch"));
  });
  // docs/guides/rails.md, "Reading settlement": a reference that lacks a field status reads the payment by, or holds it
  // malformed, is unreadable unparseable with nothing read, and hex digits read the same in either case. reference() writes
  // the sender and the idDigest as 0x and 64 lowercase hex digits (V2), and a named transaction is an Aptos hash in the
  // same form (V4). Each row's reader would otherwise answer the row's expect.
  it("a ref whose sender, idDigest or named transaction is not 0x and 64 hex digits is unreadable unparseable, with nothing read", async () => {
    const named: string = V.V4.status[0].ref.transaction;
    for (const row of rowsOf(V.V4.status, "x402-exact-aptos.json V4.status")) {
      for (const key of ["sender", "idDigest", "transaction"] as const) {
        const good: string = row.ref[key] ?? named;
        const forms: unknown[] = [null, 1, {}, [], "", "0x12", good.slice(0, 64), `${good}00`, good.slice(2)];
        forms.push(`0X${good.slice(2)}`, `0xg${good.slice(3)}`);
        if (key !== "transaction") forms.push(undefined);
        if (key === "sender") forms.push("0x1");
        for (const v of forms) {
          const r = reader(row);
          const ref = { ...refOf(row.ref), [key]: v } as AptosRef;
          const got = await exactAptos.status(ref, r, paymentAct);
          expect([row.case, key, v, got, r.calls]).toEqual([row.case, key, v, unreadable("unparseable"), 0]);
        }
      }
    }
  });
  it("a ref in upper-case hex reads as the vector's ref, and the reader is given the sender and transaction in lowercase", async () => {
    const upper = (s: string) => `0x${s.slice(2).toUpperCase()}` as `0x${string}`;
    for (const row of rowsOf(V.V4.status, "x402-exact-aptos.json V4.status")) {
      const ref = refOf(row.ref);
      const shouted: AptosRef = { ...ref, sender: upper(ref.sender), idDigest: upper(ref.idDigest) };
      if (ref.transaction !== undefined) shouted.transaction = upper(ref.transaction);
      const r = reader(row);
      expect(plain(await exactAptos.status(shouted, r, queryOf(row.query)))).toEqual(row.expect);
      expect(r.asked).toEqual(r.asked.map((a) => String(a).toLowerCase()));
    }
  });
});

describe("plant", () => {
  it("an undocumented vm_status string on a successful commit is settled, never refused", async () => {
    expect(plain(await exactAptos.status(refOf(V.plant.ref), reader(V.plant), paymentAct))).toEqual(V.plant.expect);
  });
});

describe("the pairing's filter, advertise, read, build and complete", () => {
  it("takes aptos:<1-255> and long-form addresses", () => {
    const pays = (o: PaymentRequirements) => pairingOf(o) === "x402/exact/aptos";
    expect(pays(O)).toBe(true);
    expect(pays({ ...O, network: "aptos:2" })).toBe(true);
    expect(pays({ ...O, network: "aptos:01" })).toBe(false);
    expect(pays({ ...O, network: "aptos:256" })).toBe(false);
    expect(pays({ ...O, payTo: "0x1" })).toBe(false);
    expect(pays({ ...O, extra: { assetTransferMethod: "x" } })).toBe(false);
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
    // One fault, one code: a transaction for another chain is refused by complete as reference refuses it.
    expect(u.complete({ transaction: referenceWire(raw(transferPayload(), 2)) })).toEqual({
      refused: true,
      code: "aptos/chain-mismatch",
    });
  });
  it("the pattern states what the record proves, and claims nothing", () => {
    expect(exactAptos.pattern).toMatchObject({
      pattern: "http-advisory",
      onChain: false,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
    });
    expect(exactAptos.data.carrier.signed).toBeNull();
    expect(exactAptos.data.coverage).toBe("none");
    expect(exactAptos.data.proves.startsWith("Before this payment was taken, an account signed an agreement transaction")).toBe(
      true,
    );
    expect(exactAptos.data.proves).not.toMatch(/\b(buyer|payer) signed/);
    // What the challenge shows: the ATR existed before it went out, and it advertised the hash and the link. Where the
    // seller keeps the ATR is not something this record, or anything the package reads, can show.
    expect(exactAptos.data.proves).toContain(
      "The ATR was assembled before the challenge went out, and the challenge advertised its hash and link.",
    );
    expect(exactAptos.data.proves).not.toContain("storage");
    expect(exactAptos.claims).toBe(false);
    expect("recover" in exactAptos).toBe(false);
  });
});

type RefusalRow = { case: string; transaction?: { $repeat: [string, number] } | string; expect: string };

// One fault, one code: for each agreedRefusals row whose fault is in the transaction, build's complete gives the code
// reference gives, the row's. The transactions are the rows' own, or built as their runners build them: text that is
// not padded base64, fixture F cut inside its sequence number, a module name led by U+FEFF, a u64 type argument, a
// payload transaction that is not a string, the $repeat row's text and the text row's, the script payload (row 6) and
// fixture F on chain 2 (row 10).
describe("x402-exact-aptos.json agreedRefusals: build's complete gives each transaction row's code, as reference does", () => {
  const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  /** A $repeat row's text: s repeated n times. */
  const repeated = (r: RefusalRow) => {
    const [s, n] = (r.transaction as { $repeat: [string, number] }).$repeat;
    return s.repeat(n);
  };
  const script = () => raw(new TransactionPayloadScript(new Script(new Uint8Array([0xa1, 0x1c, 0xeb, 0x0b]), [], [])));
  const inputs: [string, () => unknown[]][] = [
    ["a transaction that is not padded standard base64", () => ["AAA"]],
    ["a RawTransaction prefix that ends early", () => [text(raw().bcsToBytes().subarray(0, 40))]],
    ["a module, function or struct name", () => [referenceWire(raw(transferPayload("\uFEFFprimary_fungible_store")))]],
    ["a type argument that is not a struct", () => [signedWire(raw(transferPayload("primary_fungible_store", "transfer", parseTypeTag("u64"))))]],
    ["payload.transaction not a string", () => [7, null]],
    ["reference and build's complete with a transaction whose payload is a script", () => [referenceWire(script()), signedWire(script())]],
    ["a transaction of 87384 UTF-16 code units", () => [repeated((V.agreedRefusals.rows as RefusalRow[])[8]!)]],
    ["a transaction whose last character before the padding", () => [(V.agreedRefusals.rows as RefusalRow[])[9]!.transaction]],
    ["reference and build's complete with a transaction signed for a chain other", () => [referenceWire(raw(transferPayload(), 2))]],
  ];
  const inputOf = (r: RefusalRow) => inputs.find(([head]) => r.case.startsWith(head));
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-aptos.json agreedRefusals.rows", {
    exact: inputs.length,
    keep: ["the rows whose fault is in the transaction", (r) => inputOf(r) !== undefined],
    leave: ["the option's network row and the status rows, whose fault is not in the transaction", (r) => inputOf(r) === undefined],
  });
  for (const r of rows) {
    it(`${r.case.slice(0, 80)}: ${r.expect}`, async () => {
      const u = await built();
      for (const transaction of inputOf(r)![1]()) {
        expect([transaction, await exactAptos.reference(payment(transaction as string), O)]).toEqual([transaction, { refused: true, code: r.expect }]);
        expect([transaction, u.complete({ transaction } as { transaction: string })]).toEqual([transaction, { refused: true, code: r.expect }]);
      }
    });
  }
});

// The agreedRefusals row whose transaction is written {"$repeat": [s, n]}: s repeated n times, each s four UTF-16 code
// units and three code points. Its length is counted in UTF-16 code units, as the about states.
describe("x402-exact-aptos.json agreedRefusals: a transaction beyond the BMP over the decoded bound", () => {
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-aptos.json agreedRefusals.rows", {
    exact: 1,
    keep: ["the row whose transaction is an object with $repeat", (r) => typeof r.transaction === "object"],
    leave: [
      "the row whose transaction is text, run by the describe block below, and the rows that give no transaction, run by base64.test.ts, the Move identifier test above and the runner at the end of this file",
      (r) => typeof r.transaction === "string" || r.transaction === undefined,
    ],
  }) as (RefusalRow & { transaction: { $repeat: [string, number] } })[];
  it("one row, whose text is 87384 UTF-16 code units and 65538 code points", () => {
    expect(rows).toHaveLength(1);
    const [s, n] = rows[0]!.transaction!.$repeat;
    const text = s.repeat(n);
    expect([text.length, [...text].length]).toEqual([87384, 65538]);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      const [s, n] = r.transaction!.$repeat;
      expect(await decodeAptosTx(s.repeat(n))).toEqual({ refused: true, code: r.expect });
    });
  }
});

// The agreedRefusals rows whose transaction is a string: the text as given.
describe("x402-exact-aptos.json agreedRefusals: a transaction given as text", () => {
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-aptos.json agreedRefusals.rows", {
    exact: 1,
    keep: ["the row whose transaction is text", (r) => typeof r.transaction === "string"],
    leave: [
      "the row whose transaction is an object with $repeat, run by the describe block above, and the rows that give no transaction, run by base64.test.ts, the Move identifier test above and the runner at the end of this file",
      (r) => typeof r.transaction === "object" || r.transaction === undefined,
    ],
  }) as (RefusalRow & { transaction: string })[];
  it("one row", () => {
    expect(rows).toHaveLength(1);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      expect(decodeAptosTx(r.transaction)).toEqual({ refused: true, code: r.expect });
      expect(await exactAptos.reference(payment(r.transaction), O)).toEqual({ refused: true, code: r.expect });
    });
  }
});

// Each agreedRefusals row that gives no transaction, run from the vector's own data: fixture F's RawTransaction with
// one part changed, the option O and its document, and V4's status row whose bySequence lookup is the real answer.
// The rows that give a transaction run in the two describe blocks above, the row for text that is not padded standard
// base64 in base64.test.ts, and the row for a name that is not a Move identifier in the Move identifier test above.
describe("x402-exact-aptos.json agreedRefusals: every row that gives no transaction runs", () => {
  const elsewhere = (r: RefusalRow) =>
    r.case.startsWith("a transaction that is not padded standard base64") ||
    r.case.startsWith("a module, function or struct name");
  const rows = rowsOf(V.agreedRefusals.rows as RefusalRow[], "x402-exact-aptos.json agreedRefusals.rows", {
    keep: ["the rows that give no transaction, run below", (r) => r.transaction === undefined && !elsewhere(r)],
    leave: [
      "the rows that give a transaction, run by the two describe blocks above; the row for text that is not padded standard base64, run by base64.test.ts; and the row for a name that is not a Move identifier, run by the Move identifier test above",
      (r) =>
        typeof r.transaction === "string" ||
        (typeof r.transaction === "object" && "$repeat" in r.transaction) ||
        elsewhere(r),
    ],
  });
  /** Both wire forms of `bytes`: base64 of the bytes, and x402's reference form, base64 of the JSON that holds them. */
  const wires = (bytes: Uint8Array) => [
    Buffer.from(bytes).toString("base64"),
    Buffer.from(JSON.stringify({ transaction: Array.from(bytes), senderAuthenticator: [] })).toString("base64"),
  ];
  /** Fixture F's RawTransaction with the payload's variant, the ULEB128 after the sender and sequence number, as `uleb`. */
  const withVariant = (uleb: number[]) => {
    const b = raw().bcsToBytes();
    expect(b[40]).toBe(2);
    return Uint8Array.from([...b.subarray(0, 40), ...uleb, ...b.subarray(41)]);
  };
  /** What a row's expect states: a refusal code, or, for the status rows, the status unreadable with its reason. */
  const wanted = (code: string) =>
    code.startsWith("unreadable ") ? unreadable(code.slice("unreadable ".length)) : { refused: true, code };

  const cases: Record<string, () => Promise<unknown[]>> = {
    // Cut inside the sequence number and before the chain id; the payload's variant as 2^32 (five bytes) and 2^35 (six
    // bytes), and its value 2 as the two bytes 0x82 0x00.
    "a RawTransaction prefix that ends early, or a ULEB128 that is over 2^32-1 or not in its shortest form": async () => {
      const b = raw().bcsToBytes();
      expect(decodeAptosTx(wires(b)[0]!)).not.toHaveProperty("refused");
      const out: unknown[] = [];
      for (const bytes of [
        b.subarray(0, 39),
        b.subarray(0, b.length - 1),
        withVariant([0x80, 0x80, 0x80, 0x80, 0x10]),
        withVariant([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]),
        withVariant([0x82, 0x00]),
      ]) {
        for (const wire of wires(bytes)) out.push(decodeAptosTx(wire), await exactAptos.reference(payment(wire), O));
      }
      return out;
    },
    "a type argument that is not a struct, or a struct with type arguments": async () => {
      const generic = new TypeTagStruct(
        new StructTag(AccountAddress.ONE, new Identifier("fungible_asset"), new Identifier("Metadata"), [parseTypeTag("u8")]),
      );
      const out: unknown[] = [];
      for (const typeArgument of [parseTypeTag("u64"), parseTypeTag("vector<u8>"), generic]) {
        const r = raw(transferPayload("primary_fungible_store", "transfer", typeArgument));
        for (const wire of [referenceWire(r), signedWire(r)]) {
          out.push(decodeAptosTx(wire), await exactAptos.reference(payment(wire), O));
        }
      }
      return out;
    },
    "an option with scheme exact and an aptos: network whose chain id is not 1 to 255 without a leading zero": async () => {
      const wire = referenceWire(raw());
      const out: unknown[] = [];
      for (const network of ["aptos:0", "aptos:256", "aptos:01", "aptos:1000"]) {
        const o = { ...O, network };
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [o] };
        out.push(
          await exactAptos.bound(payment(wire, undefined, o)),
          await exactAptos.reference(payment(wire, undefined, o), O),
          await exactAptos.build({ required: doc, accepted: o }, H),
          exactAptos.advertise(doc, H, LINK, o),
        );
      }
      return out;
    },
    "payload.transaction not a string": async () => {
      const out: unknown[] = [];
      for (const transaction of [7, null, undefined, Array.from(raw().bcsToBytes())]) {
        const p = { ...payment(""), payload: { transaction } };
        out.push(await exactAptos.bound(p), await exactAptos.reference(p, O));
      }
      return out;
    },
    // V2's script payload in both wire forms: reference and complete give one code.
    "reference and build's complete with a transaction whose payload is a script, not an entry function call: fixture F's RawTransaction with V2's script payload, built with @aptos-labs/ts-sdk 7.5.0, in x402's reference wire form and in the scheme's BCS form. build's complete gives each transaction reference refuses the code reference gives it, as every row whose fault is in the transaction shows":
      async () => {
        const u = await built();
        const script = raw(new TransactionPayloadScript(new Script(new Uint8Array([0xa1, 0x1c, 0xeb, 0x0b]), [], [])));
        const out: unknown[] = [];
        for (const transaction of [referenceWire(script), signedWire(script)]) {
          out.push(await exactAptos.reference(payment(transaction), O), u.complete({ transaction }));
        }
        return out;
      },
    // Fixture F on chain 2 for aptos:1, in both wire forms: reference and complete refuse it with one code. Fixture F
    // itself, on chain 1, is taken by both.
    "reference and build's complete with a transaction signed for a chain other than the option's network: fixture F's RawTransaction with chain id 2, for aptos:1, built with @aptos-labs/ts-sdk 7.5.0, in x402's reference wire form and in the scheme's BCS form":
      async () => {
        const u = await built();
        for (const transaction of [referenceWire(raw()), signedWire(raw())]) {
          expect(await exactAptos.reference(payment(transaction), O)).not.toHaveProperty("refused");
          expect(u.complete({ transaction })).not.toHaveProperty("refused");
        }
        const out: unknown[] = [];
        for (const transaction of [referenceWire(raw(transferPayload(), 2)), signedWire(raw(transferPayload(), 2))]) {
          out.push(await exactAptos.reference(payment(transaction), O), u.complete({ transaction }));
        }
        return out;
      },
    // V4's row whose bySequence lookup is the real answer, which settles; then a ledger for chain 2.
    "status: a ledger whose chain id is not the ref's network": async () => {
      const row = V.V4.status.find((r: { case: string }) => r.case === "byHash null, bySequence the real answer");
      const ref = refOf(row.ref);
      expect(plain(await exactAptos.status(ref, reader(row), paymentAct))).toEqual(row.expect);
      expect(row.expect.state).toBe("settled");
      return [await exactAptos.status(ref, reader(row, "aptos:1", 2), paymentAct)];
    },
    // The same row, its bySequence answer for another sender (fixture F's fee payer) and for the next sequence number.
    "status: a bySequence answer for another sender or sequence number": async () => {
      const row = V.V4.status.find((r: { case: string }) => r.case === "byHash null, bySequence the real answer");
      const ref = refOf(row.ref);
      const next = (BigInt(F.sequenceNumber) + 1n).toString();
      return [
        await exactAptos.status(ref, reader({ ...row, bySequence: { ...row.bySequence, sender: F.feePayer } }), paymentAct),
        await exactAptos.status(ref, reader({ ...row, bySequence: { ...row.bySequence, sequence_number: next } }), paymentAct),
      ];
    },
  };

  it("names a case for every row it runs, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(wanted(row.expect));
    });
  }
});
