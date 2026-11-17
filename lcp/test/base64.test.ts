// The rails' standard base64 reader takes padded base64 (RFC 4648 §4) in its canonical form only (RFC 4648 §3.5): a
// last character before the padding with a bit set past the last byte spells the same bytes in another form. Expected
// values come from ECMA-262's Uint8Array.fromBase64 with lastChunkHandling "strict", as vectors/base64-platform.json
// records it (Node 24 has no such reader; on a Node that has it, the answers are also held to it live), and from
// @scure/base's base64; each
// reader's code is the one it gives a text that is not padded standard base64 ("AAA"), and, where the vector file has a
// row for that text, the row's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { base64 as scureBase64 } from "@scure/base";
import { Cell } from "@ton/core";
import { describe, expect, it } from "vitest";
import type { AtrHash } from "../src/core.js";
import { decodeAptosTx } from "../src/aptos.js";
import { avmCarrier, exactAvm, type AvmParams } from "../src/avm.js";
import { decodeCardanoTx, exactCardano } from "../src/cardano.js";
import { exactHedera, hederaStatus, type HederaReader, type MirrorEntry } from "../src/hedera.js";
import { exactNear, type NearReader } from "../src/near.js";
import { ledgerReader, type LedgerJson } from "./read-kit/forms/near.js";
import { base64Bytes, fromBase64, toBase64 } from "../src/rail-bytes.js";
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
const fromBase64Strict = (Uint8Array as unknown as { fromBase64?(s: string, o: object): Uint8Array }).fromBase64;
/** ECMA-262's strict reader, live, where this Node has it; null where it does not (Node 24). */
const live =
  fromBase64Strict === undefined
    ? null
    : (s: string): Uint8Array | null => {
        try {
          return fromBase64Strict(s, { lastChunkHandling: "strict" });
        } catch {
          return null;
        }
      };
const PLATFORM = load("base64-platform.json") as Record<string, { texts: number; read: Record<string, string> }>;
/** ECMA-262's strict reader as base64-platform.json records it over the set `name`, and as it answers live where it can. */
const ecmaOf = (name: string, texts: string[]) => {
  const set = PLATFORM[name]!;
  expect(texts.length).toBe(set.texts);
  const made = new Set(texts);
  expect(Object.keys(set.read).filter((s) => !made.has(s))).toEqual([]);
  return (s: string): Uint8Array | null => {
    const h = set.read[s];
    const want = h === undefined ? null : Uint8Array.from(Buffer.from(h, "hex"));
    if (live !== null) {
      const now = live(s);
      expect(now === null ? null : Buffer.from(now).toString("hex"), `the built-in reader on ${JSON.stringify(s)}`).toBe(h ?? null);
    }
    return want;
  };
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
    const ecma = ecmaOf("base64Short", texts);
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

  it("fromBase64 and base64Bytes refuse a character outside ASCII, whatever its low seven bits", () => {
    // U+00C1, U+00E1, U+00B0, U+00AB, U+00AF and U+0141 have the low seven bits of "A", "a", "0", "+", "/" and "A";
    // U+D800 is a lone surrogate. None is in the alphabet (RFC 4648 §4), and ECMA-262's strict reader refuses each.
    const texts = ["\u00c1", "\u00e1", "\u00b0", "\u00ab", "\u00af", "\u0141", "\ud800"].flatMap((c) => [`${c}QQ=`, `Q${c}Q=`, `QQ${c}=`, `Zm9v${c}mFy`]);
    const ecma = ecmaOf("base64NonAscii", texts);
    for (const c of ["\u00c1", "\u00e1", "\u00b0", "\u00ab", "\u00af", "\u0141", "\ud800"]) {
      for (const s of [`${c}QQ=`, `Q${c}Q=`, `QQ${c}=`, `Zm9v${c}mFy`]) {
        expect([fromBase64(s), base64Bytes(s, 8), ecma(s)], s).toEqual([null, "malformed", null]);
      }
    }
  });

  it("toBase64 writes 16 MiB as Node's Buffer writes it, and fromBase64 and base64Bytes read it back", () => {
    // 16 MiB is one byte more than a multiple of three, so the text ends in "==". The test has no time bound (0): the
    // reader and the writer each make one pass, in constant stack, and how long that takes depends only on the machine.
    const bytes = Uint8Array.from({ length: 16 * 1024 * 1024 }, (_, i) => (i * 31 + (i >>> 11)) & 0xff);
    const text = Buffer.from(bytes).toString("base64");
    expect([text.length, text.endsWith("==")]).toEqual([22369624, true]);
    expect(toBase64(bytes) === text).toBe(true);
    const read = fromBase64(text);
    const bounded = base64Bytes(text, bytes.length);
    expect(read !== null && Buffer.from(read).equals(bytes)).toBe(true);
    expect(bounded instanceof Uint8Array && Buffer.from(bounded).equals(bytes)).toBe(true);
    expect(base64Bytes(text, bytes.length - 1)).toBe("too-large");
    expect(fromBase64(`${text.slice(0, -3)}R==`)).toBeNull();
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

  it("a Hedera Mirror Node memo: status is unreadable unparseable and recover hedera/unreadable, as for any other", async () => {
    const V = load("x402-exact-hedera.json");
    const reader = (entries: MirrorEntry[]): HederaReader => ({
      network: V.V5.readerNetwork,
      transactions: async () => entries,
      latest: async () => V.V5.rows[0].mirror.latest,
      oldest: async () => "archival",
      accountTransactions: async () => ({ transactions: [], next: null }),
    });
    const memo = (entries: MirrorEntry[], m: (s: string) => string) =>
      entries.map((e) => ({ ...e, memo_base64: m(e.memo_base64!) }));
    const settled: MirrorEntry[] = V.V5.rows[0].mirror.byId;
    expect(settled[0]!.memo_base64!.endsWith("=")).toBe(true);
    const query = { act: "payment", finality: "consensus" } as const;
    const unparseable = { state: "unreadable", reason: "unparseable", foreign: [] };
    expect(await hederaStatus(V.V5.reference, reader(settled), query)).toEqual(V.V5.rows[0].expect);
    expect(await hederaStatus(V.V5.reference, reader(memo(settled, () => NOT_BASE64)), query)).toEqual(unparseable);
    expect(await hederaStatus(V.V5.reference, reader(memo(settled, raised)), query)).toEqual(unparseable);
    const landed: MirrorEntry[] = V.V5.recover.entries;
    const input = { network: V.V5.reference.network, tx: V.V5.reference.transactionId, option: V.fixed.O };
    const recover = (entries: MirrorEntry[]) => exactHedera.recover(input, reader(entries));
    expect(await recover(landed)).toBe(V.V5.recover.expect);
    expect(await recover(memo(landed, () => NOT_BASE64))).toEqual(refused("hedera/unreadable"));
    expect(await recover(memo(landed, raised))).toEqual(refused("hedera/unreadable"));
  });

  // A transaction the NEAR read meets in its search whose function-call arguments are not base64 is one it cannot read:
  // the search is held at the block before it (read-status rule 19), and recover answers near/unreadable.
  it("NEAR function-call arguments: status holds its search before the transaction and recover is near/unreadable", async () => {
    const V = load("x402-exact-near.json");
    const settled = V.read.rows[0] as { ledger: LedgerJson; expect: { payment: unknown } };
    const ref = V.V2.expectReference;
    const withArgs = (m: (s: string) => string): NearReader => {
      const t1 = settled.ledger.txs["T1"]!;
      const d = t1.delegate!;
      const call = d.actions[0]!;
      const ledger = { ...settled.ledger, txs: { T1: { ...t1, delegate: { ...d, actions: [{ ...call, argsBase64: m(call.argsBase64) }] } } } };
      return ledgerReader(ledger, ref.payer, ref.publicKey);
    };
    const q = { act: "payment", finality: "final" } as const;
    const held = { state: "pending", reason: "search-incomplete", search: 200000009n, undecoded: ["T1"], foreign: [] };
    expect(settled.ledger.txs["T1"]!.delegate!.actions[0]!.argsBase64.endsWith("=")).toBe(true);
    expect((await exactNear.status(ref, withArgs((s) => s), q)).state).toBe("settled");
    expect(await exactNear.status(ref, withArgs(() => NOT_BASE64), q)).toEqual(held);
    expect(await exactNear.status(ref, withArgs(raised), q)).toEqual(held);
    const recover = (r: NearReader) => exactNear.recover({ network: ref.network, tx: "T1", option: V.fixed.O }, r);
    expect(await recover(withArgs((s) => s))).toBe(V.fixed.H);
    expect(await recover(withArgs(() => NOT_BASE64))).toEqual(refused("near/unreadable"));
    expect(await recover(withArgs(raised))).toEqual(refused("near/unreadable"));
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
