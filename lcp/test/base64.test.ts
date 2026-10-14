// The rails' standard base64 reader takes padded base64 (RFC 4648 §4) in its canonical form only (RFC 4648 §3.5): a
// last character before the padding with a bit set past the last byte spells the same bytes in another form. Expected
// values come from ECMA-262's Uint8Array.fromBase64 with lastChunkHandling "strict" and from @scure/base's base64; each
// reader's code is the one it gives a text that is not padded standard base64 ("AAA"), and, where the vector file has a
// row for that text, the row's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { base64 as scureBase64 } from "@scure/base";
import { Cell } from "@ton/core";
import { describe, expect, it } from "vitest";
import { canonicalJson, toLcpString, type AtrHash } from "../src/core.js";
import { decodeAptosTx } from "../src/aptos.js";
import { avmCarrier, exactAvm, type AvmParams } from "../src/avm.js";
import { decodeCardanoTx, exactCardano } from "../src/cardano.js";
import { chargeHedera, exactHedera, hederaStatus, type HederaReader, type MirrorEntry } from "../src/hedera.js";
import type { MppCredential } from "../src/mpp.js";
import { exactNear, type NearReader } from "../src/near.js";
import { base64Bytes, fromBase64 } from "../src/rail-bytes.js";
import { decodeStellarTx, transferEventOf } from "../src/stellar.js";
import { decodeSuiTx, exactSui } from "../src/sui.js";
import { exactTvm } from "../src/tvm.js";
import { exactSvm } from "../src/x402-exact-solana.js";
import type { PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const STANDARD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** `s`, padded base64, with the lowest bit past the last byte set (or cleared) in the character before its padding. */
const respelled = (s: string, set: boolean) => {
  const i = s.length - (s.endsWith("==") ? 3 : 2);
  const v = STANDARD.indexOf(s[i]!);
  return s.slice(0, i) + STANDARD[set ? v | 1 : v & ~1] + s.slice(i + 1);
};
const raised = (s: string) => respelled(s, true);
const lowered = (s: string) => respelled(s, false);
const refused = (code: string) => ({ refused: true, code });
const unreadable = { state: "pending", why: "unreadable" };
const NOT_BASE64 = "AAA";
const fromBase64Strict = (Uint8Array as unknown as { fromBase64(s: string, o: object): Uint8Array }).fromBase64;
const ecma = (s: string): Uint8Array | null => {
  try {
    return fromBase64Strict(s, { lastChunkHandling: "strict" });
  } catch {
    return null;
  }
};
const scure = (s: string): Uint8Array | null => {
  try {
    return scureBase64.decode(s);
  } catch {
    return null;
  }
};
/** The one row a vector array holds for a non-canonical spelling. */
const respelledRow = <T extends { case?: string }>(rows: T[]): T => {
  const found = rows.filter((r) => r.case?.endsWith("not in canonical form (RFC 4648 §3.5)") === true);
  expect(found).toHaveLength(1);
  return found[0]!;
};
/** The code of the row whose case starts with `head`. */
const codeOf = (rows: { case: string; expect: string }[], head: string) =>
  rows.find((r) => r.case.startsWith(head))!.expect;

describe("standard base64 in its canonical form", () => {
  it("fromBase64 and base64Bytes agree with ECMA-262's strict reader and @scure/base on every short text", () => {
    // No whitespace: ECMA-262's reader skips ASCII whitespace, which RFC 4648 §3.3 leaves out of base64.
    const chars = ["A", "Q", "B", "R", "/", "+", "=", "-"];
    const texts = [""];
    for (let n = 1; n <= 5; n++) {
      for (const t of texts.filter((x) => x.length === n - 1)) for (const c of chars) texts.push(t + c);
    }
    expect(texts.length).toBe(1 + 8 + 64 + 512 + 4096 + 32768);
    // Each text's three answers are compared with ECMA-262's, and every text where one differs is listed. The test has no
    // time bound (0): it reads a fixed list and returns, so how long it takes depends only on the machine.
    const same = (a: Uint8Array | null, b: Uint8Array | null) =>
      a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i]);
    const differ = rowsOf(texts, "every text of up to five of the eight characters", { exact: 1 + 8 + 64 + 512 + 4096 + 32768 }).filter((s) => {
      const want = ecma(s);
      const got = base64Bytes(s, 1 << 20);
      return !same(scure(s), want) || !same(fromBase64(s), want) || !same(got instanceof Uint8Array ? got : null, want);
    });
    expect(differ).toEqual([]);
    expect([raised("QQ=="), raised("QUI=")]).toEqual(["QR==", "QUJ="]);
    expect([fromBase64("QR=="), fromBase64("QUJ="), base64Bytes("QR==", 8)]).toEqual([null, null, "malformed"]);
  }, 0);
});

describe("each pairing's vector row for its signed payload with a pad bit set", () => {
  it("x402-exact-sui.json agreedRefusals: V2's transaction", async () => {
    const V = load("x402-exact-sui.json");
    const row = respelledRow<{ case: string; transaction: string; expect: string }>(V.agreedRefusals.rows);
    expect(lowered(row.transaction)).toBe(V.V2.tx.transactionBase64);
    expect(row.expect).toBe(codeOf(V.agreedRefusals.rows, "a transaction that is not padded standard base64"));
    expect("refused" in decodeSuiTx(V.V2.tx.transactionBase64)).toBe(false);
    expect(decodeSuiTx(NOT_BASE64)).toEqual(refused(row.expect));
    expect(decodeSuiTx(row.transaction)).toEqual(refused(row.expect));
    const payment = { x402Version: 2, accepted: V.fixed.O, payload: { signature: "AAAA", transaction: row.transaction } };
    expect(await exactSui.bound(payment)).toEqual(refused(row.expect));
  });

  it("x402-exact-cardano.json V4: V3's transaction", async () => {
    const V = load("x402-exact-cardano.json");
    const row = respelledRow<{ case: string; transactionBase64: string; expectBound: string }>(V.V4);
    expect(lowered(row.transactionBase64)).toBe(V.V3.transactionBase64);
    expect(row.expectBound).toBe(codeOf(V.agreedRefusals.rows, "a transaction that is not padded standard base64"));
    expect("refused" in (await decodeCardanoTx(V.V3.transactionBase64))).toBe(false);
    expect(await decodeCardanoTx(NOT_BASE64)).toEqual(refused(row.expectBound));
    expect(await decodeCardanoTx(row.transactionBase64)).toEqual(refused(row.expectBound));
    const payload = { transaction: row.transactionBase64, nonce: V.fixed.nonce };
    const payment = { x402Version: 2, accepted: V.fixed.O, payload };
    expect(await exactCardano.bound(payment)).toEqual(refused(row.expectBound));
  });

  it("x402-exact-aptos.json agreedRefusals: fixture F's RawTransaction", () => {
    const V = load("x402-exact-aptos.json");
    const row = respelledRow<{ case: string; transaction: string; expect: string }>(V.agreedRefusals.rows);
    const canonical = lowered(row.transaction);
    expect(canonical).not.toBe(row.transaction);
    const bytes = fromBase64(canonical)!;
    expect(bytes.length).toBe(V.fixed.fixtureF.rawTransactionBytes);
    expect("0x" + createHash("sha256").update(bytes).digest("hex")).toBe(V.fixed.fixtureF.rawTransactionSha256);
    expect(row.expect).toBe(codeOf(V.agreedRefusals.rows, "a transaction that is not padded standard base64"));
    expect("refused" in decodeAptosTx(canonical)).toBe(false);
    expect(decodeAptosTx(NOT_BASE64)).toEqual(refused(row.expect));
    expect(decodeAptosTx(row.transaction)).toEqual(refused(row.expect));
  });

  it("x402-exact-algorand.json V3.refusals: V2's payment entry", () => {
    const V = load("x402-exact-algorand.json");
    const row = respelledRow<{ case: string; paymentIndex: number; paymentGroup: string[]; expect: string }>(
      V.V3.refusals,
    );
    const i: number = V.V2.expectPaymentIndex;
    const group: string[] = V.V2.expectPaymentGroup;
    expect(row.paymentIndex).toBe(i);
    expect(row.paymentGroup[i]).not.toBe(group[i]);
    expect(row.paymentGroup.map((s, k) => (k === i ? lowered(s) : s))).toEqual(group);
    expect("refused" in avmCarrier({ paymentIndex: i, paymentGroup: group })).toBe(false);
    const malformed = group.map((s, k) => (k === i ? NOT_BASE64 : s));
    expect(avmCarrier({ paymentIndex: i, paymentGroup: malformed })).toEqual(refused(row.expect));
    expect(avmCarrier({ paymentIndex: i, paymentGroup: row.paymentGroup })).toEqual(refused(row.expect));
  });

  it("x402-exact-hedera.json refusals: V2's transaction", async () => {
    const V = load("x402-exact-hedera.json");
    const row = respelledRow<{ case: string; transactionBase64: string; expect: string }>(V.refusals);
    expect(lowered(row.transactionBase64)).toBe(V.V2.expectTransactionBase64);
    const presented = (transaction: string) => ({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: V.fixed.O,
      payload: { transaction },
    });
    expect(await exactHedera.bound(presented(V.V2.expectTransactionBase64))).toBe(V.V2.expectBound);
    expect(await exactHedera.bound(presented(NOT_BASE64))).toEqual(refused(row.expect));
    expect(await exactHedera.bound(presented(row.transactionBase64))).toEqual(refused(row.expect));
  });

  it("x402-exact-solana.json V3: V2's wire", async () => {
    const V = load("x402-exact-solana.json");
    const row = respelledRow<{ case: string; wireBase64: string; accepted: PaymentRequirements; expect: string }>(V.V3);
    expect(lowered(row.wireBase64)).toBe(V.V2.wireBase64);
    expect(row.accepted).toEqual(V.V2.accepted);
    expect(row.expect).toBe(codeOf(V.agreedRefusals.rows, "a payload whose transaction is not base64"));
    const payment = (transaction: string) => ({ x402Version: 2 as const, accepted: row.accepted, payload: { transaction } });
    expect(await exactSvm.bound(payment(V.V2.wireBase64))).toBe(V.V2.expectBound);
    expect(await exactSvm.bound(payment(NOT_BASE64))).toEqual(refused(row.expect));
    expect(await exactSvm.bound(payment(row.wireBase64))).toEqual(refused(row.expect));
  });

  it("x402-exact-near.json agreedRefusals: V2's signed delegate action", async () => {
    const V = load("x402-exact-near.json");
    const row = respelledRow<{ case: string; signedDelegateAction: string; expect: string }>(V.agreedRefusals.rows);
    expect(lowered(row.signedDelegateAction)).toBe(V.V2.expectSignedDelegateAction);
    const payment = (signedDelegateAction: string) => ({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: V.fixed.O,
      payload: { signedDelegateAction },
    });
    expect(await exactNear.bound(payment(V.V2.expectSignedDelegateAction))).toBe(V.V2.expectBound);
    expect(await exactNear.bound(payment(NOT_BASE64))).toEqual(refused(row.expect));
    expect(await exactNear.bound(payment(row.signedDelegateAction))).toEqual(refused(row.expect));
  });

  it("x402-exact-tvm.json agreedRefusals: buyer row B6's settlement message", async () => {
    const V = load("x402-exact-tvm.json");
    const row = respelledRow<{ case: string; settlementBoc: string; expect: string }>(V.agreedRefusals.rows);
    const b6 = V.buyer.rows.find((r: { name: string }) => r.name === "B6");
    expect(lowered(row.settlementBoc)).toBe(b6.input.presented.payload.settlementBoc);
    expect(row.expect).toBe(codeOf(V.agreedRefusals.rows, "bound with a settlementBoc that is not base64"));
    const placed: PaymentRequirements = V.fixed.placed;
    const payment = (settlementBoc: string) => ({
      x402Version: 2,
      resource: V.fixed.resource,
      accepted: placed,
      payload: { settlementBoc, asset: placed.asset },
    });
    expect(await exactTvm.bound(payment(lowered(row.settlementBoc)))).toBe(V.fixed.H);
    expect(await exactTvm.bound(payment(NOT_BASE64))).toEqual(refused(row.expect));
    expect(await exactTvm.bound(payment(row.settlementBoc))).toEqual(refused(row.expect));
  });

  it("x402-exact-stellar.json: the envelope, read in its canonical form only", () => {
    const V = load("x402-exact-stellar.json");
    const envelope: string = V.V3.envelope;
    expect(envelope.endsWith("=")).toBe(true);
    expect("refused" in decodeStellarTx(envelope, V.fixed.network)).toBe(false);
    expect(decodeStellarTx(NOT_BASE64, V.fixed.network)).toEqual(refused("stellar/tx-malformed"));
    expect(decodeStellarTx(raised(envelope), V.fixed.network)).toEqual(refused("stellar/tx-malformed"));
  });
});

describe("what a node answers, with a pad bit set", () => {
  it("an Algorand genesis hash given to build is avm/network-mismatch, as one that is not base64", async () => {
    const V = load("x402-exact-algorand.json");
    const O: PaymentRequirements = V.fixed.O;
    const params = (genesisHash: string): AvmParams => ({
      firstValid: BigInt(V.fixed.params.firstValid),
      genesisHash,
      genesisId: V.fixed.params.genesisId,
      minFee: BigInt(V.fixed.params.minFee),
      feePerByte: BigInt(V.fixed.params.feePerByte),
    });
    const required = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [O] };
    const build = (genesisHash: string) =>
      exactAvm.build({ required, accepted: O, payer: V.fixed.payer, params: params(genesisHash) }, V.fixed.H);
    const gh: string = V.fixed.params.genesisHash;
    expect(gh.endsWith("=")).toBe(true);
    expect("refused" in (await build(gh))).toBe(false);
    expect(await build(NOT_BASE64)).toEqual(refused("avm/network-mismatch"));
    expect(await build(raised(gh))).toEqual(refused("avm/network-mismatch"));
  });

  it("a Hedera Mirror Node memo: status is pending unreadable and recover hedera/unreadable, as for any other", async () => {
    const V = load("x402-exact-hedera.json");
    const reader = (entries: MirrorEntry[]): HederaReader => ({
      network: V.V5.readerNetwork,
      transactions: async () => entries,
    });
    const memo = (entries: MirrorEntry[], m: (s: string) => string) =>
      entries.map((e) => ({ ...e, memo_base64: m(e.memo_base64!) }));
    const settled: MirrorEntry[] = V.V5.rows[0].entries;
    expect(settled[0]!.memo_base64!.endsWith("=")).toBe(true);
    expect(await hederaStatus(V.V5.reference, reader(settled))).toEqual(V.V5.rows[0].expect);
    expect(await hederaStatus(V.V5.reference, reader(memo(settled, () => NOT_BASE64)))).toEqual(unreadable);
    expect(await hederaStatus(V.V5.reference, reader(memo(settled, raised)))).toEqual(unreadable);
    const landed: MirrorEntry[] = V.V5.recover.entries;
    const recover = (entries: MirrorEntry[]) => exactHedera.recover(V.V5.reference, reader(entries));
    expect(await recover(landed)).toBe(V.V5.recover.expect);
    expect(await recover(memo(landed, () => NOT_BASE64))).toEqual(refused("hedera/unreadable"));
    expect(await recover(memo(landed, raised))).toEqual(refused("hedera/unreadable"));
  });

  it("NEAR function-call arguments: status is pending unreadable and recover near/unreadable, as for others", async () => {
    const V = load("x402-exact-near.json");
    type Outcome = { delegate: { argsBase64: string; nonce: string } };
    const reader = (o: Outcome): NearReader => ({
      network: V.V3.ref.network,
      relayers: V.V3.relayers,
      txStatus: async () => ({ ...o, delegate: { ...o.delegate, nonce: BigInt(o.delegate.nonce) } }) as never,
      finalHeight: async () => 0n,
      accessKeyNonce: async () => null,
    });
    const args = (o: Outcome, m: (s: string) => string): Outcome => ({
      ...o,
      delegate: { ...o.delegate, argsBase64: m(o.delegate.argsBase64) },
    });
    const settled = V.V3.status[0];
    expect(settled.outcome.delegate.argsBase64.endsWith("=")).toBe(true);
    expect(await exactNear.status(V.V3.ref, reader(settled.outcome))).toEqual(settled.expect);
    expect(await exactNear.status(V.V3.ref, reader(args(settled.outcome, () => NOT_BASE64)))).toEqual(unreadable);
    expect(await exactNear.status(V.V3.ref, reader(args(settled.outcome, raised)))).toEqual(unreadable);
    const landed = V.V3.recover[0];
    const recover = (o: Outcome) => exactNear.recover(V.V3.ref, reader(o));
    expect(await recover(landed.outcome)).toBe(landed.expect);
    expect(await recover(args(landed.outcome, () => NOT_BASE64))).toEqual(refused("near/unreadable"));
    expect(await recover(args(landed.outcome, raised))).toEqual(refused("near/unreadable"));
  });

  it("Stellar event topics are stellar/event-malformed, as any other that does not decode", () => {
    const V = load("x402-exact-stellar.json");
    const row = V.events.rows[1];
    const topic = (t: string) => row.topic.map((x: string, i: number) => (i === 2 ? t : x));
    expect(row.topic[2].endsWith("=")).toBe(true);
    expect(transferEventOf(row.topic, row.value)).toEqual({ toBase: row.expect.toBase, toMuxedId: null });
    expect(transferEventOf(topic(NOT_BASE64), row.value)).toEqual(refused("stellar/event-malformed"));
    expect(transferEventOf(topic(raised(row.topic[2])), row.value)).toEqual(refused("stellar/event-malformed"));
  });
});

describe("a TON option's forward payload with a pad bit set", () => {
  it("advertise answers tvm/carrier-occupied, as for any forward payload that is not the hash's comment", () => {
    const V = load("x402-exact-tvm.json");
    const placed: PaymentRequirements = V.fixed.placed;
    const H: AtrHash = V.fixed.H;
    const forward = placed.extra!["forwardPayload"] as string;
    expect(forward.endsWith("=")).toBe(true);
    const advertise = (forwardPayload: string) => {
      const offer = { ...placed, extra: { ...placed.extra, forwardPayload } };
      const doc = { x402Version: 2 as const, resource: V.fixed.resource, accepts: [offer] };
      return exactTvm.advertise(doc, H, V.fixed.link, offer);
    };
    expect("refused" in advertise(forward)).toBe(false);
    expect(advertise(NOT_BASE64)).toEqual(refused("tvm/carrier-occupied"));
    expect(advertise(raised(forward))).toEqual(refused("tvm/carrier-occupied"));
  });

  it("build and bound answer tvm/carrier-mismatch, as for any forward payload that is not the hash's comment", async () => {
    const V = load("x402-exact-tvm.json");
    const placed: PaymentRequirements = V.fixed.placed;
    const H: AtrHash = V.fixed.H;
    const forward = placed.extra!["forwardPayload"] as string;
    const offered = (forwardPayload: string): PaymentRequirements => ({ ...placed, extra: { ...placed.extra, forwardPayload } });
    const build = (accepted: PaymentRequirements) =>
      exactTvm.build(
        {
          required: { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] },
          accepted,
          wallet: V.fixed.wallet,
          walletId: V.fixed.walletId,
          seqno: V.fixed.seqno,
          jettonWallet: V.fixed.jettonWallet,
          attachNanotons: BigInt(V.fixed.attachNanotons),
          now: V.fixed.now,
        },
        H,
      );
    const settlementBoc: string = V.buyer.rows.find((r: { name: string }) => r.name === "B6").input.presented.payload.settlementBoc;
    const bound = (accepted: PaymentRequirements) =>
      exactTvm.bound({ x402Version: 2, resource: V.fixed.resource, accepted, payload: { settlementBoc, asset: accepted.asset } });
    expect("refused" in (await build(offered(forward)))).toBe(false);
    expect(await bound(offered(forward))).toBe(H);
    for (const f of [NOT_BASE64, raised(forward)]) {
      expect([f, await build(offered(f))]).toEqual([f, refused("tvm/carrier-mismatch")]);
      expect([f, await bound(offered(f))]).toEqual([f, refused("tvm/carrier-mismatch")]);
    }
  });
});

describe("a TON state init given to build with a pad bit set", () => {
  it("build answers tvm/boc-malformed, as for a state init that is not base64 (V2b's refusal row)", async () => {
    const V = load("x402-exact-tvm.json");
    const placed: PaymentRequirements = V.fixed.placed;
    // V2b's state init cell as a BoC without CRC32C: the same cell, in a base64 text that ends in padding.
    const stateInit = Cell.fromBase64(V.V2b.stateInit).toBoc({ idx: false, crc32: false }).toString("base64");
    expect(stateInit.endsWith("=")).toBe(true);
    const build = (s: string) =>
      exactTvm.build(
        {
          required: { x402Version: 2, resource: V.fixed.resource, accepts: [placed] },
          accepted: placed,
          wallet: V.V2b.wallet,
          walletId: V.fixed.walletId,
          seqno: V.V2b.seqno,
          jettonWallet: V.fixed.jettonWallet,
          attachNanotons: BigInt(V.fixed.attachNanotons),
          now: V.fixed.now,
          stateInit: s,
        },
        V.fixed.H,
      );
    const code = V.V2b.refusals.find((r: { case: string }) => r.case === "a stateInit that is not base64").expect;
    expect("refused" in (await build(stateInit))).toBe(false);
    expect(await build(NOT_BASE64)).toEqual(refused(code));
    expect(await build(raised(stateInit))).toEqual(refused(code));
  });
});

describe("mpp-charge-hedera.json, with a pad bit set", () => {
  const V = load("mpp-charge-hedera.json");
  const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const challenge = {
    id: V.fixed.challengeId,
    realm: V.fixed.realm,
    method: "hedera",
    intent: "charge",
    request: b64u(canonicalJson(V.fixed.request) as string),
    expires: V.fixed.expires,
    opaque: b64u(canonicalJson({ legalContext: toLcpString(V.fixed.H), legalContextUrl: V.fixed.link }) as string),
  };
  const credential = (payload: MppCredential["payload"]): MppCredential => ({ challenge, payload });

  it("a pull credential's transaction: bound is hedera/tx-malformed, as for one that is not base64", async () => {
    const transaction: string = V.build.expectTransactionBase64;
    expect(transaction.endsWith("=")).toBe(true);
    const pull = (t: string) => credential({ type: "transaction", transaction: t });
    expect(await chargeHedera.bound(pull(transaction))).toBe(V.bound.expectBound);
    expect(await chargeHedera.bound(pull(NOT_BASE64))).toEqual(refused("hedera/tx-malformed"));
    expect(await chargeHedera.bound(pull(raised(transaction)))).toEqual(refused("hedera/tx-malformed"));
  });

  it("a push credential's landed memo: fetchPresented is hedera/unreadable, as for one that is not base64", async () => {
    // x402-exact-hedera.json V1's memo, 77 bytes, so its base64 ends in padding; fetchPresented reads any UTF-8 memo.
    const X = load("x402-exact-hedera.json");
    const memo: string = X.V1.expectMemoBase64;
    expect(memo.endsWith("=")).toBe(true);
    const push = credential({ type: "hash", transactionId: V.push.transactionId });
    const reader = (m: string) => ({
      network: V.fetchPresented.reader,
      transactions: async () => (V.fetchPresented.entries as MirrorEntry[]).map((e) => ({ ...e, memo_base64: m })),
    });
    const landed = await chargeHedera.fetchPresented(push, reader(memo) as never);
    expect((landed as { landed: { memo: string } }).landed.memo).toBe(X.V1.expectMemo);
    expect(await chargeHedera.fetchPresented(push, reader(NOT_BASE64) as never)).toEqual(refused("hedera/unreadable"));
    expect(await chargeHedera.fetchPresented(push, reader(raised(memo)) as never)).toEqual(refused("hedera/unreadable"));
  });
});
