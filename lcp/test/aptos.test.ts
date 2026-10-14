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
      const answer = row.bySequence as { notFound?: true; timestampUsecs?: string } | null | undefined;
      if (answer?.notFound === true) return { notFound: true as const, timestampUsecs: BigInt(answer.timestampUsecs!) };
      return (answer ?? null) as AptosCommitted;
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
  it("a module, function or struct name with a leading U+FEFF is not a Move identifier", async () => {
    // Move identifiers are ASCII (aptos-core, move-core-types identifier.rs, `is_valid`), so the bytes EF BB BF before
    // a name make it no identifier. The code is the vector's row.
    const named = (r: { case: string }) => r.case.startsWith("a module, function or struct name");
    const row = V.agreedRefusals.rows.find(named);
    const bom = "\uFEFF";
    const struct = (m: string, n: string) =>
      new TypeTagStruct(new StructTag(AccountAddress.ONE, new Identifier(m), new Identifier(n), []));
    const payloads = [
      transferPayload(`${bom}primary_fungible_store`),
      transferPayload("primary_fungible_store", `${bom}transfer`),
      transferPayload("primary_fungible_store", "transfer", struct(`${bom}fungible_asset`, "Metadata")),
      transferPayload("primary_fungible_store", "transfer", struct("fungible_asset", `${bom}Metadata`)),
    ];
    for (const payload of payloads) {
      for (const wire of [referenceWire(raw(payload)), signedWire(raw(payload))]) {
        expect(decodeAptosTx(wire)).toEqual({ refused: true, code: row.expect });
        expect(await exactAptos.reference(payment(wire))).toEqual({ refused: true, code: row.expect });
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
  for (const row of V.V4.status) {
    it(row.case, async () => {
      const r = reader(row);
      expect(plain(await exactAptos.status(refOf(row.ref), r))).toEqual(row.expect);
      expect(r.calls).toBeLessThanOrEqual(3);
    });
  }
  it("a retry with another expiry has the same idDigest, and its commit settles only its own row", async () => {
    // Aptos takes each sequence number once, so once the retry commits at 218 the first signed transaction never can:
    // the vector's retry row.
    const retry = V.V4.status.find((r: { case: string }) => r.case.includes("a retry"));
    const committed = retry.bySequence as AptosCommitted;
    const first = await exactAptos.reference(payment(signedWire(raw())));
    const second = await exactAptos.reference(
      payment(signedWire(raw(transferPayload(), F.chainId, BigInt(committed.expiration_timestamp_secs)))),
    );
    if ("refused" in first) throw new Error(first.code);
    if ("refused" in second) throw new Error(second.code);
    expect(first).toEqual(V.V2.expectReference);
    expect(second).toEqual({ ...V.V2.expectReference, expiresAt: committed.expiration_timestamp_secs });
    const at: Row = { ledgerUsecs: retry.ledgerUsecs, bySequence: committed };
    expect(plain(await exactAptos.status(first, reader(at)))).toEqual(retry.expect);
    const named = { ...first, transaction: committed.hash as `0x${string}` };
    expect(plain(await exactAptos.status(named, reader({ ...at, byHash: committed })))).toEqual(retry.expect);
    expect(plain(await exactAptos.status(second, reader(at)))).toEqual({
      state: "settled",
      version: committed.version,
      transaction: committed.hash,
    });
  });
  // Every successful Aptos REST response carries X-Aptos-Ledger-TimestampUsec, the ledger timestamp of that answer, and a
  // transaction cannot commit at or past its expiration_timestamp_secs. A lookup computed at a ledger before the one
  // read first cannot show the transaction absent at that ledger, whatever the ledger read first says.
  it("a not-found lookup computed before the ledger read first is pending, never expired", async () => {
    const [row] = V.V4.status.filter((r: { case: string }) => r.case.endsWith("1790300896 s"));
    const ledgerUsecs = 1790300896000000n;
    for (const at of [1790300865000000n, 1790300895000000n, 1790300895999999n, ledgerUsecs, ledgerUsecs + 1n]) {
      const r = reader({ ...row, bySequence: { notFound: true, timestampUsecs: at.toString() } });
      const want = at >= ledgerUsecs ? { state: "failed", why: "expired" } : { state: "pending", why: "not-found" };
      expect([at, await exactAptos.status(refOf(row.ref), r)]).toEqual([at, want]);
    }
    const unnamed = { ...reader(row), bySequence: async () => ({ notFound: true }) as never };
    expect(await exactAptos.status(refOf(row.ref), unnamed)).toEqual({ state: "pending", why: "not-found" });
    const bare = { ...reader(row), bySequence: async () => null as never };
    expect(await exactAptos.status(refOf(row.ref), bare)).toEqual({ state: "pending", why: "unreadable" });
  });
  // aptos-core e53447e0, aptos-move/framework/aptos-framework/sources/transaction_validation.move:134-137: the
  // prologue asserts `timestamp::now_seconds() < txn_expiration_time` and refuses with PROLOGUE_ETRANSACTION_EXPIRED
  // otherwise; timestamp.move:67-69 gives now_seconds as the ledger's microseconds / 1000000. So from the ledger second
  // equal to expiresAt the transaction cannot commit, and a lookup that covers that ledger shows it never will.
  it("an absent transaction is expired from the ledger second that equals expiresAt, not-found before", async () => {
    const [row] = V.V4.status.filter((r: { case: string }) => r.case.endsWith("1790300896 s"));
    const expiresAt = BigInt(row.ref.expiresAt);
    const second = expiresAt * 1_000_000n;
    for (const at of [second - 1_000_000n, second - 1n, second, second + 1n, second + 999_999n, second + 1_000_000n]) {
      const covering = { notFound: true, timestampUsecs: at.toString() };
      const r = reader({ ...row, ledgerUsecs: at.toString(), bySequence: covering });
      const want = at >= second ? { state: "failed", why: "expired" } : { state: "pending", why: "not-found" };
      expect([at, await exactAptos.status(refOf(row.ref), r)]).toEqual([at, want]);
    }
  });
  it("a reader for another network, or a ledger for another chain, is unreadable", async () => {
    const row = V.V4.status[0];
    expect(await exactAptos.status(refOf(row.ref), reader(row, "aptos:2"))).toEqual({ state: "pending", why: "unreadable" });
    expect(await exactAptos.status(refOf(row.ref), reader(row, "aptos:1", 2))).toEqual({ state: "pending", why: "unreadable" });
  });
  // docs/guides/rails.md, "Reading settlement": a reference that lacks a field status reads the payment by, or holds it
  // malformed, is pending unreadable with nothing read, and hex digits read the same in either case. reference() writes
  // the sender and the idDigest as 0x and 64 lowercase hex digits (V2), and a named transaction is an Aptos hash in the
  // same form (V4). Each row's reader would otherwise answer the row's expect.
  it("a ref whose sender, idDigest or named transaction is not 0x and 64 hex digits is unreadable, with nothing read", async () => {
    const named: string = V.V4.status[0].ref.transaction;
    for (const row of V.V4.status) {
      for (const key of ["sender", "idDigest", "transaction"] as const) {
        const good: string = row.ref[key] ?? named;
        const forms: unknown[] = [null, 1, {}, [], "", "0x12", good.slice(0, 64), `${good}00`, good.slice(2)];
        forms.push(`0X${good.slice(2)}`, `0xg${good.slice(3)}`);
        if (key !== "transaction") forms.push(undefined);
        if (key === "sender") forms.push("0x1");
        for (const v of forms) {
          const r = reader(row);
          const ref = { ...refOf(row.ref), [key]: v } as AptosRef;
          const got = await exactAptos.status(ref, r);
          expect([row.case, key, v, got, r.calls]).toEqual([row.case, key, v, { state: "pending", why: "unreadable" }, 0]);
        }
      }
    }
  });
  it("a ref in upper-case hex reads as the vector's ref, and the reader is given the sender and transaction in lowercase", async () => {
    const upper = (s: string) => `0x${s.slice(2).toUpperCase()}` as `0x${string}`;
    for (const row of V.V4.status) {
      const ref = refOf(row.ref);
      const shouted: AptosRef = { ...ref, sender: upper(ref.sender), idDigest: upper(ref.idDigest) };
      if (ref.transaction !== undefined) shouted.transaction = upper(ref.transaction);
      const r = reader(row);
      expect(plain(await exactAptos.status(shouted, r))).toEqual(row.expect);
      expect(r.asked).toEqual(r.asked.map((a) => String(a).toLowerCase()));
    }
  });
});

describe("plant", () => {
  it("an undocumented vm_status string on a successful commit is settled, never refused", async () => {
    expect(plain(await exactAptos.status(refOf(V.plant.ref), reader(V.plant)))).toEqual(V.plant.expect);
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
    // What the challenge shows: the ATR existed before it went out, and it advertised the hash and the link. Where the
    // seller keeps the ATR is not something this record, or anything the package reads, can show.
    expect(exactAptos.pattern.proves).toContain(
      "The ATR was assembled before the challenge went out, and the challenge advertised its hash and link.",
    );
    expect(exactAptos.pattern.proves).not.toContain("storage");
    expect(exactAptos.claims).toBe(false);
    expect("recover" in exactAptos).toBe(false);
  });
});

// The agreedRefusals row whose transaction is written {"$repeat": [s, n]}: s repeated n times, each s four UTF-16 code
// units and three code points. Its length is counted in UTF-16 code units, as the about states.
describe("x402-exact-aptos.json agreedRefusals: a transaction beyond the BMP over the decoded bound", () => {
  const rows = (V.agreedRefusals.rows as { case: string; transaction?: { $repeat: [string, number] }; expect: string }[]).filter(
    (r) => r.transaction !== undefined,
  );
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
