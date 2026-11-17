// Runs the NEAR pairing's vector file through the near entry point. Every expected value is the file's, computed with
// borsh-construct 0.1.0, hashlib and PyNaCl 1.6.2.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { deserialize, serialize } from "borsh";
import { KeyType, PublicKey, SCHEMA } from "near-api-js";
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { rowsOf } from "./rows.js";
import {
  exactNear,
  ftTransferArgs,
  MAX_FT_TRANSFER_ARGS_BYTES,
  MAX_SIGNED_DELEGATE_BASE64,
  nearCarrier,
  type NearQuery,
  type NearReader,
  type NearRef,
} from "../src/near.js";
import { UNSHOWN, declaredFor, ledgerReader, onNear, runOnNear, type LedgerJson } from "./read-kit/forms/near.js";
import { READ_STATUS } from "./read-kit/harness.js";
import type { AtrHash } from "../src/core.js";
import { pairingOf } from "../src/index.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-near.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const seed = Uint8Array.from(Buffer.from(V.fixed.seedHex, "hex"));
const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
const choice = () => ({
  required,
  accepted: O,
  payer: V.fixed.payer as string,
  publicKey: V.fixed.publicKey as string,
  accessKeyNonce: BigInt(V.fixed.accessKeyNonce),
  finalHeight: BigInt(V.fixed.finalHeight),
});
const payment = (signedDelegateAction: string) => ({
  x402Version: 2,
  resource: V.fixed.resource,
  accepted: O,
  payload: { signedDelegateAction },
});
/** A row of the vector file's `read`: a constructed ledger, the query, and the answer on each act. */
type ReadRow = {
  case: string;
  ledger: LedgerJson;
  query: { finality: "optimistic" | "final"; after?: string; search?: string; others?: { ref: NearRef }[] };
  transaction?: string;
  expect: { payment: unknown; agreement: unknown };
};
const REF: NearRef = V.V2.expectReference;
const Q = { act: "payment", finality: "final" } as const;
const UNPARSEABLE = { state: "unreadable", reason: "unparseable", foreign: [] };
const readerOf = (l: LedgerJson): NearReader => ledgerReader(l, REF.payer, REF.publicKey);
const queryOf = (q: ReadRow["query"], act: "payment" | "agreement"): NearQuery => ({
  act,
  finality: q.finality,
  ...(q.after === undefined ? {} : { after: BigInt(q.after) }),
  ...(q.search === undefined ? {} : { search: BigInt(q.search) }),
  ...(q.others === undefined ? {} : { others: q.others }),
});
/** An answer with its block heights written as decimal strings, as the vector file writes them. */
const written = (a: unknown): unknown => JSON.parse(JSON.stringify(a, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
const ROWS: ReadRow[] = V.read.rows;
const SETTLED = ROWS[0] as ReadRow;
const LANDED: LedgerJson = V.read.recover[0].ledger;
const recoverInput = { network: REF.network, tx: "T1", option: O };

describe("x402-exact-near.json", () => {
  // The interface: "No function throws"; a value that is not a hash is x402's `payload-malformed`, as in `build`.
  it("V1: a value that is not a 32-byte hash is refused, not thrown", () => {
    for (const bad of ["0x12", H.slice(2)] as unknown as AtrHash[]) {
      expect(ftTransferArgs(O.payTo, O.amount, bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("V1: the arguments, the delegate action's bytes and the request hash", async () => {
    const args = ftTransferArgs(O.payTo, O.amount, H);
    if ("refused" in args) throw new Error(args.code);
    expect(new TextDecoder().decode(args)).toBe(V.V1.expectArgsUtf8);
    expect(createHash("sha256").update(args).digest("hex")).toBe(V.V1.expectArgsSha256);
    const u = await exactNear.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("near-delegate");
    expect(Buffer.from(u.request.hash).toString("hex")).toBe(V.V1.expectRequestHash);
    const sig = ed25519.sign(u.request.hash, seed);
    const hexSig = Buffer.from(sig).toString("hex");
    expect(hexSig.startsWith(V.V1.expectSignature.prefix) && hexSig.endsWith(V.V1.expectSignature.suffix)).toBe(true);
    expect(ed25519.verify(sig, u.request.hash, ed25519.getPublicKey(seed))).toBe(true);
    const signed = u.complete({ keyType: 0, bytes: sig });
    if ("refused" in signed) throw new Error(signed.code);
    const bytes = Buffer.from(signed.payload.signedDelegateAction, "base64");
    // SignedDelegate = DelegateAction ‖ key type ‖ 64-byte signature.
    const delegateBytes = bytes.subarray(0, bytes.length - 65);
    expect(delegateBytes.length).toBe(V.V1.expectDelegateActionBytes);
    const prefixed = Buffer.concat([Buffer.from(V.V1.expectPrefix, "hex"), delegateBytes]);
    expect(createHash("sha256").update(prefixed).digest("hex")).toBe(V.V1.expectRequestHash);
  });

  // JSON reads 0.0 as the number 0 (RFC 8259 section 6: a number is digits with an optional fraction), so a signer's
  // answer with keyType written 0.0 is keyType 0.
  // secp256k1: under a secp256k1 access key the delegate action ends in key type 1 and the key's 64 bytes, and complete
  // with keyType 1 writes a 65-byte signature. Each is held to the value written by hand from borsh, NEP-366 and NEP-461
  // (secp256k1's case); the signature verifies over the request hash under that key (@noble/curves).
  it("secp256k1: build under a secp256k1 key and complete with keyType 1 give the delegate written by hand", async () => {
    const S = V.secp256k1;
    const key = base58.decode(S.publicKey.slice("secp256k1:".length));
    expect(Buffer.from(secp256k1.getPublicKey(Uint8Array.from(Buffer.from(S.privateKey, "hex")), false)).toString("hex")).toBe(
      `04${Buffer.from(key).toString("hex")}`,
    );
    const u = await exactNear.build({ ...choice(), publicKey: S.publicKey }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.hash).toString("hex")).toBe(S.expectRequestHash);
    const signature = Uint8Array.from(Buffer.from(S.signature, "hex"));
    expect(secp256k1.verify(signature.subarray(0, 64), u.request.hash, Uint8Array.of(4, ...key), { prehash: false })).toBe(true);
    const p = u.complete({ keyType: 1, bytes: signature });
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.signedDelegateAction).toBe(S.expectSignedDelegateAction);
    expect(Buffer.from(p.payload.signedDelegateAction, "base64").length - 66).toBe(S.expectDelegateActionBytes);
    expect(await exactNear.bound(p)).toBe(H);
  });

  // nearcore's PublicKey::from_str (core/crypto/src/signature.rs) splits at the first ':', reads a key with no type as
  // Ed25519, lowercases the type in ASCII letters only, and decodes base58 of exactly the type's key size. Each spelling
  // in keyForms builds the request hash of its key, V1's or the secp256k1 vector's, and the payment it completes
  // carries the key as NEAR writes it.
  it("keyForms: build reads each spelling of the payer's key that nearcore reads", async () => {
    for (const row of rowsOf(V.keyForms.rows, "x402-exact-near.json keyForms.rows", { exact: 4 })) {
      const u = await exactNear.build({ ...choice(), publicKey: row.publicKey }, H);
      if ("refused" in u) throw new Error(`${row.case}: ${u.code}`);
      expect([row.case, Buffer.from(u.request.hash).toString("hex")]).toEqual([row.case, row.expectRequestHash]);
      const secp = row.expectRequestHash === V.secp256k1.expectRequestHash;
      const p = secp
        ? u.complete({ keyType: 1, bytes: Uint8Array.from(Buffer.from(V.secp256k1.signature, "hex")) })
        : u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) });
      if ("refused" in p) throw new Error(`${row.case}: ${p.code}`);
      const ref = await exactNear.reference(p, O);
      if ("refused" in ref) throw new Error(`${row.case}: ${ref.code}`);
      expect([row.case, ref.publicKey]).toEqual([row.case, secp ? V.secp256k1.publicKey : V.fixed.publicKey]);
    }
  });

  it("V2: complete with keyType written 0.0 gives V2's payment", async () => {
    expect(V.V2.keyTypeWritten.keyType).toBe(0);
    const u = await exactNear.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ keyType: V.V2.keyTypeWritten.keyType, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.signedDelegateAction).toBe(V.V2.expectSignedDelegateAction);
  });

  it("V2: complete, bound and reference, and each refusal", async () => {
    const u = await exactNear.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.signedDelegateAction).toBe(V.V2.expectSignedDelegateAction);
    expect(p).toEqual(payment(V.V2.expectSignedDelegateAction));
    expect(await exactNear.bound(p)).toBe(V.V2.expectBound);
    const ref = await exactNear.reference(p, O);
    expect(ref).toEqual(V.V2.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of rowsOf(V.V2.refusals, "x402-exact-near.json V2.refusals")) {
      expect([row.case, await exactNear.bound(payment(row.signedDelegateAction))]).toEqual([
        row.case,
        { refused: true, code: row.expect },
      ]);
    }
    const c = nearCarrier(V.V2.expectSignedDelegateAction);
    if ("refused" in c) throw new Error(c.code);
    expect(c.h).toBe(H);
  });

  // V2's signed delegate is borsh: the delegate action (sender and receiver as u32-length strings, a u32 count of
  // actions, nonce, max height, then the key as a one-byte type and its bytes), then the signature as a one-byte type
  // and its bytes. Its key is Ed25519 (type 0, 32 bytes) and its signature Ed25519 (type 0, 64 bytes).
  const v2Bytes = () => Buffer.from(V.V2.expectSignedDelegateAction, "base64");
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };

  // The borsh specification encodes a String as the u32 length and the bytes of its UTF-8 (github.com/near/borsh,
  // "String": utf8_encoding(x) as Vec<u8>). A receiver whose bytes are not UTF-8 is no borsh string. A sender in UTF-8
  // beyond ASCII is a string but no NEAR account id, which nearcore's AccountId reader refuses (near-account-id
  // src/borsh.rs); a sender that is one reads as the characters it encodes.
  it("V2: a delegate's strings are read as UTF-8, and bytes that are not UTF-8 are near/sda-malformed", async () => {
    const bytes = v2Bytes();
    const senderEnd = 4 + bytes.readUInt32LE(0);
    const receiverAt = senderEnd + 4;
    expect(bytes.subarray(receiverAt, receiverAt + 12).toString("latin1")).toBe(O.asset);
    const notUtf8 = Buffer.from(bytes);
    notUtf8[receiverAt + 4] = 0xff;
    const refused = { refused: true, code: "near/sda-malformed" };
    expect(nearCarrier(notUtf8.toString("base64"))).toEqual(refused);
    expect(await exactNear.bound(payment(notUtf8.toString("base64")))).toEqual(refused);
    const named = (payer: string) =>
      Buffer.concat([u32(Buffer.byteLength(payer)), Buffer.from(payer, "utf8"), bytes.subarray(senderEnd)]).toString("base64");
    expect(nearCarrier(named("payer-\u00e9.testnet"))).toEqual(refused);
    expect(await exactNear.bound(payment(named("payer-\u00e9.testnet")))).toEqual(refused);
    const c = nearCarrier(named("payer-e.testnet"));
    if ("refused" in c) throw new Error(c.code);
    expect([c.payer, c.h]).toEqual(["payer-e.testnet", H]);
  });

  // nearcore reads a delegate action's sender and receiver as AccountIds, each a borsh String that must be UTF-8
  // (near-account-id src/borsh.rs), before the Vec of actions and its length. A sender or receiver whose bytes are not
  // UTF-8 is refused there, whatever the count of actions says: C3 41 (a lead byte without its continuation), C0 80 (an
  // overlong NUL), ED A0 80 (the surrogate U+D800) and FF. A sender in UTF-8 beyond ASCII is no account id, and is
  // refused there too; a sender that is one reads, and the count follows.
  it("V2: a sender or receiver that is not UTF-8 is near/sda-malformed before the count of actions", async () => {
    const bytes = v2Bytes();
    const senderEnd = 4 + bytes.readUInt32LE(0);
    const receiverAt = senderEnd + 4;
    const countAt = receiverAt + bytes.readUInt32LE(senderEnd);
    const leads = [[0xc3, 0x41], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xff]];
    const refused = { refused: true, code: "near/sda-malformed" };
    for (const at of [4, receiverAt]) {
      for (const lead of leads) {
        const changed = Buffer.from(bytes);
        Buffer.from(lead).copy(changed, at);
        changed.writeUInt32LE(2, countAt);
        const sda = changed.toString("base64");
        expect([at, lead, nearCarrier(sda)]).toEqual([at, lead, refused]);
        expect([at, lead, await exactNear.bound(payment(sda))]).toEqual([at, lead, refused]);
      }
    }
    const utf8Sender = Buffer.from(bytes);
    Buffer.from([0xc3, 0xa9]).copy(utf8Sender, 4);
    utf8Sender.writeUInt32LE(2, countAt);
    expect(nearCarrier(utf8Sender.toString("base64"))).toEqual(refused);
    const otherSender = Buffer.from(bytes);
    Buffer.from("ab", "latin1").copy(otherSender, 4);
    otherSender.writeUInt32LE(2, countAt);
    expect(nearCarrier(otherSender.toString("base64"))).toEqual({ refused: true, code: "near/actions" });
  });

  // nearcore's Signature reader refuses an Ed25519 signature whose last byte has any of its top three bits set
  // (core/crypto/src/signature.rs: `array[63] & 0b1110_0000 != 0`), so a relayer cannot submit one. The last 32 bytes
  // are S, little-endian, and RFC 8032 §5.1.7 requires S below the group order L, which is below 2^253: every valid
  // signature's last byte is below 0x20, as V2's is.
  it("an Ed25519 signature whose last byte is 0x20 or more is near/sda-malformed when read, and x402/signature-malformed in complete", async () => {
    const bytes = v2Bytes();
    expect(bytes[bytes.length - 1]! < 0x20).toBe(true);
    const u = await exactNear.build(choice(), H);
    if ("refused" in u) throw new Error(u.code);
    const signature = ed25519.sign(u.request.hash, seed);
    for (const bit of [0x20, 0x40, 0x80]) {
      const changed = Buffer.from(bytes);
      changed[changed.length - 1] = changed[changed.length - 1]! | bit;
      expect([bit, nearCarrier(changed.toString("base64"))]).toEqual([bit, { refused: true, code: "near/sda-malformed" }]);
      expect([bit, await exactNear.bound(payment(changed.toString("base64")))]).toEqual([bit, { refused: true, code: "near/sda-malformed" }]);
      const high = Uint8Array.from(signature);
      high[63] = high[63]! | bit;
      expect([bit, u.complete({ keyType: 0, bytes: high })]).toEqual([bit, { refused: true, code: "x402/signature-malformed" }]);
    }
    const edge = Buffer.from(bytes);
    edge[edge.length - 1] = 0x1f;
    const c = nearCarrier(edge.toString("base64"));
    if ("refused" in c) throw new Error(c.code);
    expect(c.h).toBe(H);
    const atEdge = Uint8Array.from(signature);
    atEdge[63] = 0x1f;
    expect("refused" in u.complete({ keyType: 0, bytes: atEdge })).toBe(false);
  });

  // NEAR's key and signature enums give type 0 to Ed25519 and 1 to secp256k1, the two x402's NEAR scheme admits
  // ("Signature type and key type MUST be valid NEAR-supported types (`ed25519` or `secp256k1`)",
  // scheme_exact_near.md at f5dd40ef). near-api-js 7.3.1's schema adds type 2, ML-DSA-65, with a 1952-byte key and a
  // 3309-byte signature. V2 with the signature or the delegate's key written as type 2 is no delegate this pairing
  // reads. A delegate of two actions, the second a DeleteKey (variant 6) under a type-2 key, is refused by its count
  // of actions, which is read before the actions.
  it("V2: a delegate whose signature or key is neither Ed25519 nor secp256k1 is near/sda-malformed", async () => {
    const bytes = v2Bytes();
    const delegate = bytes.subarray(0, bytes.length - 65);
    const keyAt = delegate.length - 33;
    const tail = delegate.subarray(delegate.length - 49);
    const senderEnd = 4 + bytes.readUInt32LE(0);
    const actionsAt = senderEnd + 4 + bytes.readUInt32LE(senderEnd);
    const zeroSignature = Buffer.concat([Buffer.from([0]), Buffer.alloc(64)]);
    const mlDsaKey = Buffer.concat([Buffer.from([2]), Buffer.alloc(1952, 1)]);
    const cases = [
      Buffer.concat([delegate, Buffer.from([2]), Buffer.alloc(3309)]),
      Buffer.concat([delegate.subarray(0, keyAt), mlDsaKey, zeroSignature]),
      Buffer.concat([
        delegate.subarray(0, actionsAt),
        u32(2),
        delegate.subarray(actionsAt + 4, delegate.length - tail.length),
        Buffer.from([6]),
        mlDsaKey,
        tail,
        zeroSignature,
      ]),
    ];
    const codes = ["near/sda-malformed", "near/sda-malformed", "near/actions"];
    for (const [i, sda] of cases.map((b) => b.toString("base64")).entries()) {
      expect([i, nearCarrier(sda)]).toEqual([i, { refused: true, code: codes[i] }]);
      expect([i, await exactNear.bound(payment(sda))]).toEqual([i, { refused: true, code: codes[i] }]);
    }
    const mlDsaPublicKey = `ml-dsa-65:${base58.encode(new Uint8Array(1952).fill(1))}`;
    expect(await exactNear.build({ ...choice(), publicKey: mlDsaPublicKey }, H)).toEqual({ refused: true, code: "x402/option-malformed" });
  });

  it("V2 presented under an option with timeout 0 is refused; build under a timeout of 1 opens a window of one block", async () => {
    const [row] = rowsOf(V.V2.presentedOptions, "x402-exact-near.json V2.presentedOptions", { exact: 1 });
    const presented = { ...payment(V.V2.expectSignedDelegateAction), accepted: row.accepted };
    const want = { refused: true, code: row.expect };
    const doc = exactNear.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(row.accepted.maxTimeoutSeconds).toBe(0);
    expect(exactNear.read({ ...doc, accepts: [row.accepted] })).toEqual({ refused: true, code: "x402/no-payable-option" });
    expect([row.case, await exactNear.bound(presented)]).toEqual([row.case, want]);
    expect([row.case, await exactNear.reference(presented, row.accepted)]).toEqual([row.case, want]);
    expect(await exactNear.build({ ...choice(), required: { ...required, accepts: [row.accepted] }, accepted: row.accepted }, H)).toEqual(want);
    // x402's scheme_exact_near: timeoutBlocks = max(1, ceil(maxTimeoutSeconds / estimatedBlockSeconds)), 1 s blocks.
    const accepted = { ...O, maxTimeoutSeconds: 1 };
    const u = await exactNear.build({ ...choice(), required: { ...required, accepts: [accepted] }, accepted }, H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete({ keyType: 0, bytes: ed25519.sign(u.request.hash, seed) });
    if ("refused" in p) throw new Error(p.code);
    const ref = await exactNear.reference(p, accepted);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.maxBlockHeight).toBe((BigInt(V.fixed.finalHeight) + 1n).toString());
  });

  it("read: each row through status, on both acts, and recover", async () => {
    for (const row of rowsOf(ROWS, "x402-exact-near.json read.rows", { exact: 21 })) {
      const ref = row.transaction === undefined ? REF : { ...REF, transaction: row.transaction };
      for (const act of ["payment", "agreement"] as const) {
        const got = written(await exactNear.status(ref, readerOf(row.ledger), queryOf(row.query, act)));
        expect([row.case, act, got]).toEqual([row.case, act, row.expect[act]]);
      }
    }
    for (const row of rowsOf(V.read.recover, "x402-exact-near.json read.recover", { exact: 6 })) {
      const got = await exactNear.recover({ ...recoverInput, tx: row.tx }, readerOf(row.ledger));
      expect([row.case, got]).toEqual([row.case, typeof got === "string" ? row.expect : { refused: true, code: row.expect }]);
    }
  });

  // The read kit's form makes each case of read-status.json on a NEAR ledger. Two state a fact NEAR cannot hold, and run
  // in the two spellings read-status admits (rule 9, "names no account"; rule 16, who signed the consumer): an
  // ft_transfer always names its receiver_id, and only the payer's own key consumes its nonce. Every other case is made
  // as stated, and none holds two transactions outside the payer's key changes, which the form would fail.
  it("the read kit's cases that NEAR holds only as mapped", () => {
    const full = READ_STATUS.cases.filter((c) => c.coverage === "full");
    const mapped = full.flatMap((c) => {
      const m = [...new Set(["payment", "agreement"].flatMap((act) => onNear(c, act as "payment").mapped))];
      return m.length === 0 ? [] : [[c.case, m]];
    });
    expect(mapped).toEqual([
      ["an act carrying H that names no account and consumed nothing: a foreign item for a payment, settled for an agreement", ["t1: every ft_transfer names its receiver_id on NEAR; it names another account"]],
      ["a transaction that consumed the value at or before the position given answers before-position", ["t1: only the payer's own key consumes its nonce on NEAR; signed by the payer"]],
    ]);
    expect(full.flatMap((c) => (["payment", "agreement"] as const).flatMap((act) => onNear(c, act).unmet ?? []))).toEqual([]);
  });

  // Two failed transactions carrying H, the payer's and the payee's: the payer's delegate ran and its token receipt
  // failed, so the search reads it; the payee's is read through the hint. Both are read, and neither is a foreign item.
  it("the case of two failed transactions carrying H reads both, the payer's by the search and the payee's by the hint", async () => {
    const c = READ_STATUS.cases.find((x) => x.case.startsWith("transactions carrying H with a failed result, the payer's own and one the payee signed"))!;
    for (const act of ["payment", "agreement"] as const) {
      const made = onNear(c, act);
      expect(made.unmet).toBeUndefined();
      const asked: string[] = [];
      const reader = ledgerReader(made.ledger, REF.payer, REF.publicKey);
      const watched: NearReader = { ...reader, txStatus: async (hash, signer) => (asked.push(hash), reader.txStatus(hash, signer)) };
      expect(made.back(await exactNear.status(made.ref, watched, made.query))).toMatchObject(c.expect[act]);
      expect([made.ref.transaction, asked.sort()]).toEqual(["T2near", ["T1near", "T2near"]]);
    }
    // A case holding two transactions outside the payer's key changes cannot be met, and the form fails it.
    const two = { ...c, facts: { ...c.facts, seen: c.facts.seen.map((s) => ({ ...s, party: "other" as const })) } };
    const made = onNear(two, "payment");
    expect(made.unmet).toContain("t1 and t2 are each outside the payer's key changes");
    await expect(runOnNear(two, "payment").run()).rejects.toThrow("the case cannot be met on NEAR and the profile states no reason it cannot arise");
  });

  // Rule 8: a change whose transaction the reader cannot name stops the search at the block before it, from which the
  // next read resumes; an undecodable item met later never carries the position past it.
  it("an item the search could not decode never carries the search position past a change it could not read", async () => {
    const KEY2 = "ed25519:8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR";
    // The key's nonce below the signed one at a final block past max_block_height: what the search decides.
    const ledger: LedgerJson = {
      final: "200000070",
      latest: "200000075",
      key: { final: { nonce: "100", blockHeight: "200000070" }, optimistic: { nonce: "100", blockHeight: "200000075" } },
      changes: [
        { account: REF.payer, height: "200000010", publicKey: KEY2, nonce: "7" },
        { account: REF.payer, height: "200000020", publicKey: KEY2, nonce: "8", transaction: { hash: "B1", signer: "relayer.testnet" } },
      ],
      txs: {},
    };
    expect(written(await exactNear.status(REF, readerOf(ledger), { ...Q, after: 200000000n }))).toMatchObject({
      state: "pending",
      reason: "search-incomplete",
      search: "200000009",
      undecoded: ["B1"],
    });
  });

  // The two size bounds are lcp's own, exported once: a signed delegate action longer is near/sda-too-large before it
  // is decoded, and ft_transfer arguments longer are near/args-malformed.
  it("the size bounds: MAX_SIGNED_DELEGATE_BASE64 and MAX_FT_TRANSFER_ARGS_BYTES", async () => {
    expect([MAX_SIGNED_DELEGATE_BASE64, MAX_FT_TRANSFER_ARGS_BYTES]).toEqual([8192, 4096]);
    expect(nearCarrier("A".repeat(MAX_SIGNED_DELEGATE_BASE64 + 4))).toEqual({ refused: true, code: "near/sda-too-large" });
    const long = Buffer.from(JSON.stringify({ receiver_id: "merchant.testnet", amount: "1", memo: `lcp:sha256:${H}`, pad: "x".repeat(MAX_FT_TRANSFER_ARGS_BYTES) }));
    const ledger = JSON.parse(JSON.stringify(LANDED).replace(V.read.recover[0].ledger.txs.T1.delegate.actions[0].argsBase64, long.toString("base64")));
    expect(await exactNear.recover(recoverInput, readerOf(ledger))).toEqual({ refused: true, code: "near/args-malformed" });
  });

  // reference is given the option the payment answers: a presented accepted that is not that option is refused.
  it("reference refuses a presented accepted that is not the option it is given", async () => {
    const p = payment(V.V2.expectSignedDelegateAction);
    expect(await exactNear.reference(p, { ...O, amount: "2000000" })).toEqual({ refused: true, code: "x402/accepted-not-option" });
    expect(await exactNear.reference(p, { ...O, extra: {} })).toEqual({ refused: true, code: "x402/accepted-not-option" });
    expect(await exactNear.reference(p, { ...O })).toEqual(V.V2.expectReference);
  });

  // A ref that cannot name the delegate is unreadable before any read. A NEAR account id's letters are lowercase, and a
  // separator is never first, last or doubled (near-account-id's validate); a public key is written `ed25519:` and the
  // base58 of its 32 bytes (near-api-js PublicKey.toString), as nearCarrier and nearcore's RPC write it.
  it("a ref whose payee, nonce, asset, payer, key, digest, gas, deposit, H or hint is malformed is unreadable unparseable, with nothing read", async () => {
    const [, key] = REF.publicKey.split(":") as [string, string];
    const malformed = [
      { nonce: "x" }, { asset: "USDC.testnet" }, { asset: "usdc..testnet" }, { argsDigest: "0x12" }, { payee: "Merchant.testnet" },
      { payee: undefined }, { payer: REF.payer.toUpperCase() }, { payer: undefined }, { payer: "" }, { payer: `-${REF.payer.slice(1)}` },
      { publicKey: `ED25519:${key}` }, { publicKey: undefined }, { publicKey: key }, { publicKey: `ed25519:${key.slice(0, -2)}` },
      { publicKey: `secp256k1:${key}` }, { gas: "-1" }, { gas: undefined }, { deposit: "1.5" }, { h: "0x12" }, { h: undefined },
      { maxBlockHeight: "18446744073709551616" }, { transaction: "" }, { transaction: 7 },
    ];
    for (const change of malformed) {
      const { reader, calls } = counting(readerOf(SETTLED.ledger));
      expect([change, await exactNear.status({ ...REF, ...change } as typeof REF, reader, Q)]).toEqual([change, UNPARSEABLE]);
      expect(calls).toEqual([]);
    }
    const upper = `0x${REF.argsDigest.slice(2).toUpperCase()}` as const;
    expect(written(await exactNear.status({ ...REF, argsDigest: upper }, readerOf(SETTLED.ledger), Q))).toEqual(SETTLED.expect.payment);
  });

  // A secp256k1 key is written `secp256k1:` and the base58 of its 64 bytes, x then y (near-api-js 7.3.1
  // PublicKey.toString). The key here is the public key of the scalar 1, the generator G of secp256k1 (SEC 2 v2.0,
  // §2.4.1). The settled row with that key in the reference, the key changes and the delegate settles as that row.
  it("a ref whose public key is a secp256k1 key as near-api-js writes it settles", async () => {
    const G =
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" +
      "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
    const publicKey = new PublicKey({ keyType: KeyType.SECP256K1, data: Uint8Array.from(Buffer.from(G, "hex")) }).toString();
    const ledger: LedgerJson = JSON.parse(JSON.stringify(SETTLED.ledger).split(REF.publicKey).join(publicKey));
    const got = written(await exactNear.status({ ...REF, publicKey }, ledgerReader(ledger, REF.payer, publicKey), Q));
    expect(got).toEqual({ ...(SETTLED.expect.payment as object), authority: publicKey });
  });

  it("status reads a reader for another network as chain-mismatch, and a query that is not one as unparseable, with nothing read", async () => {
    const other = { ...readerOf(SETTLED.ledger), network: "near:mainnet" as const };
    expect(await exactNear.status(REF, other, Q)).toEqual({ state: "unreadable", reason: "chain-mismatch", foreign: [] });
    for (const query of [
      undefined, {}, { act: "payment" }, { act: "sale", finality: "final" }, { ...Q, finality: "safe" }, { ...Q, after: 1 },
      { ...Q, search: 1 }, { ...Q, search: -1n }, { ...Q, others: [7] },
    ]) {
      const { reader, calls } = counting(readerOf(SETTLED.ledger));
      expect(await exactNear.status(REF, reader, query as never), JSON.stringify(query, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))).toEqual(UNPARSEABLE);
      expect(calls).toEqual([]);
    }
  });

  // A read that rejects is unreadable by its reason, and an answer out of the reader's form, a change outside the range
  // asked among them, unparseable.
  it("status: a rejected read is transport or by its ReaderError kind; an answer out of form is unparseable", async () => {
    const base = readerOf(SETTLED.ledger);
    const rejecting = (e: unknown): NearReader => ({ ...base, accountKeyChanges: async () => Promise.reject(e) });
    expect(await exactNear.status(REF, rejecting(new Error("reset")), Q)).toEqual({ state: "unreadable", reason: "transport", foreign: [] });
    expect(await exactNear.status(REF, rejecting(new ReaderError("too-large")), Q)).toEqual({ state: "unreadable", reason: "too-large", foreign: [] });
    expect(await exactNear.status(REF, rejecting(new ReaderError("malformed")), Q)).toEqual(UNPARSEABLE);
    const outside: NearReader = {
      ...base,
      accessKeyChanges: async (_a, publicKey, _f, to) => ({ changes: [{ height: to + 1n, publicKey, nonce: 101n }], through: to }),
    };
    expect(await exactNear.status(REF, outside, Q)).toEqual(UNPARSEABLE);
    const noHeight: NearReader = { ...base, accessKeyNonce: async () => ({ nonce: 101n }) as never };
    expect(await exactNear.status(REF, noHeight, Q)).toEqual(UNPARSEABLE);
  });

  it("refusal codes left to the implementation", async () => {
    for (const row of rowsOf(V.agreedRefusals.rows, "x402-exact-near.json agreedRefusals.rows", {
      keep: ["the rows this test runs at advertise, build, complete, bound or recover", (r) => !r.expect.endsWith("/peer-missing")],
      leave: ["the peer-missing row, which ton-near-peer-missing.test.ts runs with borsh absent", (r) => r.expect.endsWith("/peer-missing")],
    })) {
      const want = { refused: true, code: row.expect };
      if (row.option !== undefined) {
        const doc: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [row.option] };
        expect([row.case, exactNear.advertise(doc, H, V.fixed.link, row.option)]).toEqual([row.case, want]);
        expect(pairingOf(row.option)).toBeUndefined();
      } else if (row.signedDelegateAction !== undefined) {
        expect([row.case, await exactNear.bound(payment(row.signedDelegateAction))]).toEqual([row.case, want]);
      } else if (row.publicKey !== undefined) {
        expect(await exactNear.build({ ...choice(), publicKey: row.publicKey }, H)).toEqual(want);
      } else if (row.payer !== undefined) {
        expect([row.case, await exactNear.build({ ...choice(), payer: row.payer }, H)]).toEqual([row.case, want]);
      } else if (row.signatureBytes !== undefined) {
        const u = await exactNear.build(choice(), H);
        if ("refused" in u) throw new Error(u.code);
        const bytes = new Uint8Array(row.signatureBytes);
        if (row.signatureLastByte !== undefined) bytes[bytes.length - 1] = row.signatureLastByte;
        expect([row.case, u.complete({ keyType: 0, bytes })]).toEqual([row.case, want]);
      } else if (row.case.startsWith("recover of a transaction whose delegate holds two actions")) {
        const two = (V.read.recover as { tx: string; ledger: LedgerJson }[]).find((r) => r.tx === "T9")!;
        expect([row.case, await exactNear.recover({ ...recoverInput, tx: "T9" }, readerOf(two.ledger))]).toEqual([row.case, want]);
      } else if (row.case.startsWith("recover when the reader fails")) {
        const r: NearReader = { ...readerOf(LANDED), txStatus: async () => Promise.reject(new ReaderError("transport")) };
        expect(await exactNear.recover(recoverInput, r)).toEqual(want);
      } else {
        throw new Error(`no runner for ${row.case}`);
      }
    }
  });

  // The token contract reads ft_transfer's arguments with serde's derived reader (near-sdk) and makes no transfer with
  // arguments it refuses, so a transaction whose delegate carries them carries no hash: recover reads a delegate's
  // arguments as bound does. Each agreedRefusals row that bound refuses as near/args-malformed, its arguments in the
  // landed ledger of read.recover: rows 35 to 42 (a key the contract reads named twice, a missing or malformed amount, a key that
  // decodes to a lone surrogate) and rows 7, 16 and 33.
  it("recover refuses as near/args-malformed the arguments of each agreedRefusals row bound refuses so", async () => {
    type Signed = { delegateAction: { actions: { functionCall: { args: Uint8Array } }[] } };
    type Row = { case: string; signedDelegateAction?: string; expect: string };
    const malformed = (r: Row) => r.signedDelegateAction !== undefined && r.expect === "near/args-malformed";
    const rows = rowsOf<Row>(V.agreedRefusals.rows, "x402-exact-near.json agreedRefusals.rows", {
      exact: 11,
      keep: ["the signed delegate actions bound refuses as near/args-malformed", malformed],
      leave: ["every other row", (r) => !malformed(r)],
    });
    expect(V.agreedRefusals.rows.flatMap((r: Row, i: number) => (malformed(r) ? [i] : []))).toEqual([
      7, 16, 33, 35, 36, 37, 38, 39, 40, 41, 42,
    ]);
    const got: unknown[] = [];
    for (const row of rows) {
      const sda = row.signedDelegateAction!;
      expect([row.case, await exactNear.bound(payment(sda))]).toEqual([row.case, { refused: true, code: row.expect }]);
      const signed = deserialize(SCHEMA.SignedDelegate, Buffer.from(sda, "base64")) as Signed;
      const argsBase64 = Buffer.from(signed.delegateAction.actions[0]!.functionCall.args).toString("base64");
      const ledger: LedgerJson = JSON.parse(JSON.stringify(LANDED).replace(LANDED.txs["T1"]!.delegate!.actions[0]!.argsBase64, argsBase64));
      got.push([row.case, await exactNear.recover(recoverInput, readerOf(ledger))]);
    }
    expect(got).toEqual(rows.map((row) => [row.case, { refused: true, code: "near/args-malformed" }]));
  });

  // RFC 8259 §8.1: implementations "MUST NOT add a byte order mark (U+FEFF) to the beginning of a networked-transmitted
  // JSON text". The agreedRefusals row whose arguments begin with one, read with borsh 2.0.0 and near-api-js 7.3.1's
  // SCHEMA: V2's delegate action with its ft_transfer arguments EF BB BF and V1's arguments, and nothing else changed,
  // signed with fixed.seedHex over SHA-256 of V1's NEP-461 prefix and the delegate action.
  it("the agreedRefusals row whose arguments begin with a byte-order mark is V2's delegate action with only them changed", () => {
    type Signed = {
      delegateAction: { actions: { functionCall: { args: Uint8Array } }[] };
      signature: { ed25519Signature: { data: Uint8Array } };
    };
    const row = V.agreedRefusals.rows.find((r: { case: string }) => r.case.startsWith("args that begin with a byte-order mark"));
    expect(row.expect).toBe("near/args-malformed");
    const read = (b64: string) => deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")) as Signed;
    const led = read(row.signedDelegateAction);
    const v2 = read(V.V2.expectSignedDelegateAction);
    const args = led.delegateAction.actions[0]!.functionCall.args;
    expect(Buffer.from(args).toString("hex")).toBe(`efbbbf${Buffer.from(V.V1.expectArgsUtf8, "utf8").toString("hex")}`);
    const prefix = Buffer.from(V.V1.expectPrefix, "hex");
    const digest = createHash("sha256").update(prefix).update(serialize(SCHEMA.DelegateAction, led.delegateAction)).digest();
    const key = PublicKey.fromString(V.fixed.publicKey).data;
    expect(ed25519.verify(Uint8Array.from(led.signature.ed25519Signature.data), digest, key)).toBe(true);
    led.delegateAction.actions[0]!.functionCall.args = v2.delegateAction.actions[0]!.functionCall.args;
    expect(serialize(SCHEMA.DelegateAction, led.delegateAction)).toEqual(serialize(SCHEMA.DelegateAction, v2.delegateAction));
  });

  it("the option filter, advertise and read follow x402's document", () => {
    expect(pairingOf(O)).toBe("x402/exact/near");
    const doc = exactNear.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts).toEqual([O]);
    const r = exactNear.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual({ h: H, link: V.fixed.link, options: [O] });
    expect(exactNear.data.coverage).toBe("full");
    expect(exactNear.pattern.profile).toBe("x402/exact/near/memo");
  });
});

describe("the read kit's cases that rest on the access-key search, through NEAR's read", () => {
  // The form skips them while no run shows the search whole; through the read each answers what the read gives.
  it("every case skipped while the search is unshown answers pending, search-incomplete", async () => {
    const resting = rowsOf(
      READ_STATUS.cases.filter((c) => c.coverage === "full").flatMap((c) =>
        (["payment", "agreement"] as const).flatMap((act) => (declaredFor(c, act)?.stated === UNSHOWN ? [{ c, act }] : [])),
      ),
      "the cases resting on the search",
      { exact: 15 },
    );
    for (const { c, act } of resting) {
      const a = await runOnNear(c, act).run();
      expect([c.case, act, a.state, "reason" in a ? a.reason : undefined]).toEqual([c.case, act, "pending", "search-incomplete"]);
    }
  });
});
